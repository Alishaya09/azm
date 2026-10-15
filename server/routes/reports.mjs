// التقارير وسجل حركات المخزون — لكل المستخدمين، ومفلترة حسب النطاق في الخادم.
//   GET /api/reports?from=&to=&baseId=&supplyId=&unitId=&resource=&status=
//   GET /api/movements?from=&to=&entityId=&type=&resource=&offset=&limit=   (صفحات، الأحدث أولاً)
// فلتر خارج نطاق المستخدم (قاعدة أو وحدة ثانية) يرجع 403، وما يرجع بيانات فاضية توحي إنها موجودة.
import { isKnownResource } from '../store/catalog.mjs';
import { readBody, send } from '../lib/http.mjs';
import { advanceSim, state } from '../store/state.mjs';
import { nodeById, unitNodeOf } from '../store/hierarchy.mjs';
import { MOVEMENT_TYPES, allMovements } from '../store/ledger.mjs';
import { canSeeMovement, redactMovement } from '../store/scope.mjs';
import { buildReport } from '../store/reports.mjs';
import { explainReport } from '../ai/report.mjs';

const query = req => Object.fromEntries(new URL(req.url, 'http://x').searchParams);
// الفلاتر لازم تكون داخل نطاق المستخدم
const outOfScope = (s, q) => {
  if (s.all) return false;
  if (q.baseId && !s.baseIds.has(q.baseId)) return true;
  if (q.supplyId && !s.depotIds.has(q.supplyId)) return true;
  if (q.unitId && !s.unitIds.has(q.unitId)) return true;
  if (q.entityId && !s.entityIds.has(q.entityId)) return true;
  return false;
};

// سلسلة زمنية لداشبورد التقارير: عدد العمليات (لا الكميات، لأن الأصناف بوحدات قياس مختلفة) لكل نوع حركة في كل فترة.
// العملية = opId واحد ولو شملت عدة أصناف. مفلترة بنطاق الجلسة (canSeeMovement) وبالقواعد والأصناف المختارة.
const SERIES_TYPES = ['dispatch', 'delivery', 'external_add', 'transfer', 'return'];
function movementSeries(scope, q) {
  const now = Date.now(), from = Math.max(0, Number(q.from) || state.trackingStartedAt || now - 86400000), to = Math.min(now, Number(q.to) || now);
  if (!(to > from)) return { error: 'invalid_period' };
  const list = v => v ? String(v).split(',').filter(Boolean).slice(0, 80) : null;
  const baseIds = list(q.baseIds), keys = list(q.resources);
  if (baseIds && !scope.all && baseIds.some(id => !scope.baseIds.has(id))) return { error: 'out_of_scope' };
  if (keys && keys.some(k => !isKnownResource(k))) return { error: 'bad_request' };
  const n = Math.max(2, Math.min(60, Math.floor(Number(q.buckets)) || 24)), step = (to - from) / n;
  const buckets = Array.from({ length: n }, (_, i) => ({ at: Math.round(from + i * step), ...Object.fromEntries(SERIES_TYPES.map(t => [t, new Set()])) }));
  for (const m of allMovements()) {
    if (m.at < from || m.at > to || !SERIES_TYPES.includes(m.type) || (keys && !keys.includes(m.resource))) continue;
    if (baseIds && ![m.from, m.to, m.transit?.to].some(p => p && baseIds.includes(p.baseId))) continue;
    if (!canSeeMovement(scope, m)) continue;
    buckets[Math.min(n - 1, Math.floor((m.at - from) / step))][m.type].add(m.opId || m.id);
  }
  return { from, to, step, types: SERIES_TYPES, buckets: buckets.map(b => ({ at: b.at, ...Object.fromEntries(SERIES_TYPES.map(t => [t, b[t].size])) })) };
}

export async function handleReports({ req, res, path, method, me, scope }) {
  if (path === '/api/reports/series' && method === 'GET') {
    advanceSim();
    const out = movementSeries(scope, query(req));
    return out.error ? send(res, out.error === 'out_of_scope' ? 403 : 400, { error: out.error }) : send(res, 200, out);
  }
  if (path === '/api/reports/explain' && method === 'POST') {
    const body = await readBody(req);
    const q = Object.fromEntries(['from', 'to', 'baseId', 'supplyId', 'unitId', 'resource', 'status'].filter(k => body[k] !== undefined).map(k => [k, body[k]]));
    if (outOfScope(scope, q)) return send(res, 403, { error: 'out_of_scope' });
    if ((q.resource && !isKnownResource(q.resource)) || (q.status && !['pending', 'assigned', 'approved', 'delivered', 'rejected'].includes(q.status))) return send(res, 400, { error: 'bad_request' });
    advanceSim();
    const report = buildReport(me, q);
    if (report.error) return send(res, 400, report);
    return send(res, 200, await explainReport(report, body.language === 'en' ? 'en' : 'ar'));
  }
  if (method !== 'GET' || (path !== '/api/reports' && path !== '/api/movements')) return false;
  const q = query(req);
  if (outOfScope(scope, q)) return send(res, 403, { error: 'out_of_scope' });
  advanceSim();

  if (path === '/api/reports') {
    const report = buildReport(me, q);
    return report.error ? send(res, 400, report) : send(res, 200, report);
  }

  const from = Number(q.from) || 0, to = Number(q.to) || Infinity;
  const limit = Math.max(1, Math.min(200, Number(q.limit) || 50)), offset = Math.max(0, Number(q.offset) || 0);
  if ((q.type && !MOVEMENT_TYPES.includes(q.type)) || (q.resource && !isKnownResource(q.resource))) return send(res, 400, { error: 'bad_request' });
  const entityId = q.entityId || (q.unitId ? unitNodeOf(q.unitId)?.id : null);
  const touches = m => [m.from, m.to, m.transit?.from, m.transit?.to].some(p => p?.entityId === entityId);
  const list = allMovements().filter(m => m.at >= from && m.at <= to && (!q.type || m.type === q.type) && (!q.resource || m.resource === q.resource)
    && (!entityId || touches(m)) && (!q.baseId || [m.from, m.to].some(p => p?.baseId === q.baseId)) && canSeeMovement(scope, m)).reverse();
  return send(res, 200, { total: list.length, offset, limit, movements: list.slice(offset, offset + limit).map(m => redactMovement(scope, m)), entity: entityId ? nodeById(entityId)?.id || entityId : null });
}
