// تخطيط الخريطة — يحفظه القائد ويشوف كل مستخدم الجزء اللي في نطاقه.
// PUT /api/layout يقبل: تحريك النقاط، إعادة التسمية، والروابط.
//   - التبعية للنقاط الموجودة ثابتة وتبقى كما هي على الخادم مهما أرسل المتصفح (التحريك ما يغيّرها).
//   - نقطة جديدة لازم تحمل قاعدة صالحة (baseId، أو parentId القديم)، وتنشأ سجلاتها فوراً.
//   - نقطة محذوفة = أرشفة، وممنوعة إذا عليها طلبات نشطة أو شحنات أو لها توابع.
//   - baseVersion (اختياري): رقم التخطيط اللي بنى عليه المتصفح؛ إذا تغيّر من بعده يرجع 409 بدل ما يطغى على تعديل ثاني.
import { randomBytes } from 'node:crypto';
import { readBody, send, validPoint } from '../lib/http.mjs';
import { saveState, state } from '../store/state.mjs';
import { capacityOf, layoutNodes, qtyOf, setRelation } from '../store/hierarchy.mjs';
import { centerStarterItems, archiveBlockers, archiveEntity, createEntityRecords, newUnitResources, unitIdTaken, unitStarterItems } from '../store/entities.mjs';
import { nextEntityCode } from '../store/codes.mjs';

export const newNodeId = p => `${p}-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const okNode = n => n && typeof n.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(n.id) && ['main', 'fsb', 'unit', 'hq'].includes(n.type) && validPoint(n.pos) && (n.label === undefined || n.label === null || (typeof n.label === 'string' && n.label.length <= 80)) && (n.labelKey === undefined || n.labelKey === null || (typeof n.labelKey === 'string' && n.labelKey.length <= 64)) && (n.type !== 'unit' || (/^UNIT-\d{1,4}$/.test(n.unitId) && (n.people === undefined || (Number.isInteger(n.people) && n.people >= 1 && n.people <= 2000)) && (n.vehicles === undefined || (Number.isInteger(n.vehicles) && n.vehicles >= 0 && n.vehicles <= 200)))) && (n.parentId == null || (typeof n.parentId === 'string' && n.parentId.length <= 64));
const okLink = l => l && typeof l.id === 'string' && ['road', 'air'].includes(l.kind) && (l.geometry === undefined || (Array.isArray(l.geometry) && l.geometry.length <= 20000 && l.geometry.every(validPoint)));
const setText = (n, raw) => { for (const k of ['label', 'labelKey']) { if (typeof raw[k] === 'string' && raw[k].trim()) n[k] = raw[k].trim(); else delete n[k]; } return n; };

export async function handleLayout({ req, res, path, method, me, isAdmin, forbidden }) {
  if (path !== '/api/layout' || method !== 'PUT') return false;
  if (!isAdmin) return forbidden();
  const b = await readBody(req);
  if (b.operationKey !== undefined && (typeof b.operationKey !== 'string' || !/^[A-Za-z0-9_-]{3,64}$/.test(b.operationKey))) return send(res, 400, { error: 'bad_request' });
  const operationKey = b.operationKey ? `${me.username}:layout:${b.operationKey}` : null, signature = JSON.stringify(b);
  const previous = operationKey && state.supplyOperations?.[operationKey];
  if (previous) return previous.signature === signature ? send(res, 200, previous.result) : send(res, 400, { error: 'bad_request' });
  if (!b || !Array.isArray(b.nodes) || !Array.isArray(b.links) || b.nodes.length > 500 || b.links.length > 1000) return send(res, 400, { error: 'invalid_layout' });
  if (!b.nodes.every(okNode) || !b.links.every(okLink) || new Set(b.nodes.map(n => n.id)).size !== b.nodes.length) return send(res, 400, { error: 'invalid_layout' });
  if (b.baseVersion !== undefined && b.baseVersion !== state.layoutVersion) return send(res, 409, { error: 'layout_conflict', layoutVersion: state.layoutVersion });

  const current = layoutNodes(), curById = Object.fromEntries(current.map(n => [n.id, n]));
  const final = [], added = [];
  for (const raw of b.nodes) {
    const cur = curById[raw.id];
    if (cur) {
      // النوع ورقم الوحدة والتبعية ما تتغير من هنا
      if (raw.type !== cur.type || (cur.type === 'unit' && raw.unitId !== cur.unitId)) return send(res, 400, { error: 'invalid_layout' });
      if (cur.type === 'hq') { if (raw.id !== 'hq-riyadh' || raw.pos[0] !== cur.pos[0] || raw.pos[1] !== cur.pos[1]) return send(res, 409, { error: 'hq_locked' }); final.push(cur); continue; }
      final.push(setText({ ...cur, pos: raw.pos }, raw));
    } else {
      if (state.archivedEntities[raw.id]) return send(res, 409, { error: 'entity_archived', entityId: raw.id });
      if (raw.type === 'hq') return send(res, 400, { error: 'invalid_layout', entityId: raw.id }); // المركز الرئيسي واحد فقط
      const n = setText({ id: raw.id, type: raw.type, pos: raw.pos, ...(raw.type === 'unit' ? { unitId: raw.unitId, people: raw.people ?? 500, vehicles: raw.vehicles ?? 40 } : {}), createdAt: Date.now(), createdBy: me.username, relationSource: 'admin' }, raw);
      added.push({ n, raw }); final.push(n);
    }
  }
  // تبعية النقاط الجديدة (إلزامية): القاعدة صريحة (baseId)، أو parentId قديم لقاعدة، أو لمركز فتاخذ قاعدته
  const byId = Object.fromEntries(final.map(n => [n.id, n])), rank = { main: 0, fsb: 1, unit: 2 };
  for (const { n, raw } of [...added].sort((a, c) => rank[a.n.type] - rank[c.n.type])) {
    if (n.type === 'main') { setRelation(n, null); continue; }
    const p = byId[raw.parentId], baseId = raw.baseId ?? (p?.type === 'main' ? p.id : n.type === 'unit' && p?.type === 'fsb' ? p.baseId : null);
    if (byId[baseId]?.type !== 'main') return send(res, 400, { error: 'invalid_base', entityId: n.id });
    if (n.type === 'unit' && (final.some(x => x !== n && x.unitId === n.unitId) || unitIdTaken(n.unitId))) return send(res, 409, { error: 'unit_id_taken', entityId: n.id });
    if (n.type === 'unit') {
      // نفس سياسة /api/entities: جميع الأصناف النشطة مخصصة برصيد صفر.
      n.allowedResources = newUnitResources();
    }
    setRelation(n, baseId);
  }
  // الحذف = أرشفة، بعد التأكد إن ما فيه طلبات نشطة أو شحنات أو توابع باقية
  const keep = new Set(final.map(n => n.id)), removed = current.filter(n => !keep.has(n.id));
  for (const n of removed) { const blocker = archiveBlockers(n, final); if (blocker) return send(res, 409, { ...blocker, entityId: n.id }); }
  const codePool = [...final, ...Object.values(state.archivedEntities || {}).map(a => a.node).filter(Boolean)];
  for (const { n } of [...added].sort((a, b) => rank[a.n.type] - rank[b.n.type])) n.code = nextEntityCode(n.type, n.baseId, codePool);
  const issues = new Map();
  const failures = [];
  for (const { n } of added.filter(x => x.n.type === 'unit')) {
    const resource = (n.allowedResources || []).find(k => capacityOf(n)[k] >= capacityOf({type:'fsb'})[k]);
    if (resource) return send(res,400,{error:'invalid_capacity',resource});
  }
  for (const { n } of added.filter(x => ['unit', 'fsb'].includes(x.n.type))) for (const i of n.type === 'fsb' ? centerStarterItems(n) : unitStarterItems(n)) {
    if (n.type === 'unit' && capacityOf(n)[i.resource] >= capacityOf({type:'fsb'})[i.resource]) return send(res, 400, { error: 'invalid_capacity', resource: i.resource });
    const key = `${n.baseId}:${i.resource}`, required = (issues.get(key) || 0) + i.qty;
    issues.set(key, required);
    const base = byId[n.baseId], available = curById[n.baseId] ? qtyOf(n.baseId, i.resource) : base ? capacityOf(base)?.[i.resource] || 0 : 0;
    if (required > available) failures.push({ entityId: n.id, resource: i.resource, qty: required, available, missing: required - available, error: 'insufficient_stock' });
  }
  if (failures.length) return send(res, 409, { error: 'insufficient_stock', failures });
  for (const n of removed) archiveEntity(n, me.username);

  state.layout = { nodes: final, links: b.links.filter(l => keep.has(l.from) && keep.has(l.to)) }; state.layoutVersion++;
  // كل نقطة جديدة تنشأ لها سجلات فعلية فوراً: مستودع للقاعدة أو المركز، ومخزون للوحدة، وسجل مخزون بالرصيد الافتتاحي
  for (const { n } of [...added].sort((a, b) => rank[a.n.type] - rank[b.n.type])) createEntityRecords(n, me.username);
  const result = { layoutVersion: state.layoutVersion };
  if (operationKey) (state.supplyOperations ||= {})[operationKey] = { signature, result };
  saveState();
  return send(res, 200, result);
}
