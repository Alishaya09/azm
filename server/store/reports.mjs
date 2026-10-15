// التقارير: تُحسب من سجل الحركات الدائم + الرصيد الافتتاحي لكل كيان، وتُفلتر حسب نطاق المستخدم.
// لكل كيان ومورد خلال الفترة:
//   الختامي = الافتتاحي + رصيد الإنشاء + انضمام + إضافة خارجية + تحويل داخل − تحويل خارج − صرف + تسليم + إرجاع − استهلاك محاكى
// إجمالي القاعدة يُحسب من فترات انتماء كل كيان للقاعدة (من سجل تغيير التبعية)، والحركات حسب تبعيتها وقت العملية:
//   الموجود ختاماً + خروج (نقل/أرشفة) = الموجود افتتاحاً + رصيد الإنشاء + انضمام + إضافة خارجية + وارد من قواعد − صادر لقواعد − صرف + تسليم + إرجاع − استهلاك
// التحويل بين مستودعات نفس القاعدة يظهر كرقم مستقل للعلم وما يدخل في المعادلة، فما تنحسب الكمية مرتين.
// الشحنات بالطريق (الحالية) منفصلة عن الموجود، وما نجمع موارد بوحدات قياس مختلفة.
import { state } from './db.mjs';
import { measureOf, resourceKeys } from './catalog.mjs';
import { capacityOf, layoutNodes, qtyOf, requiredQty, round3 } from './hierarchy.mjs';
import { allMovements, portionUntil } from './ledger.mjs';
import { canSeeRequest, scopeOf } from './scope.mjs';
import { inboundTo, requestItems, shipmentOf } from './state.mjs';

const FLOWS = ['initial', 'relocated_in', 'external_add', 'transfer_in', 'transfer_out', 'dispatch', 'delivery', 'return', 'consumption'];
const SIGN = { initial: 1, relocated_in: 1, external_add: 1, transfer_in: 1, transfer_out: -1, dispatch: -1, delivery: 1, return: 1, consumption: -1 };
const zero = () => Object.fromEntries(FLOWS.map(f => [f, 0]));
const flowOf = (m, side) => m.type === 'transfer' ? (side === 'to' ? 'transfer_in' : 'transfer_out') : m.type;
const nodeLabel = n => ({ ...(n.label ? { label: n.label } : {}), ...(n.labelKey ? { labelKey: n.labelKey } : {}) });

// فترات انتماء الكيان للقواعد: [{ baseId, start, end }] من سجل تغيير التبعية، وتنتهي عند الأرشفة
function segmentsOf(n, rec) {
  const changes = (state.relationLog || []).filter(x => x.entityId === n.id && (x.before?.baseId || null) !== (x.after?.baseId || null)).sort((a, b) => a.at - b.at);
  const end = n.archived ? n.archivedAt : Infinity, out = [];
  let base = changes.length ? changes[0].before.baseId : (n.type === 'main' ? n.id : n.baseId || null), start = rec.openingAt;
  for (const c of changes) { out.push({ baseId: base, start, end: Math.min(c.at, end) }); base = c.after.baseId; start = c.at; }
  out.push({ baseId: base, start, end });
  return out.filter(s => s.end > s.start);
}

export function buildReport(user, q = {}) {
  const s = scopeOf(user), now = Date.now(), start = state.trackingStartedAt || now;
  const num = v => (v === undefined || v === null || v === '' ? null : Number(v));
  const from = Math.max(0, num(q.from) ?? start), to = Math.min(now, num(q.to) ?? now);
  if (!(to >= from)) return { error: 'invalid_period' };
  const effFrom = Math.max(from, start);
  const allKeys = resourceKeys(), resources = allKeys.includes(q.resource) ? [q.resource] : allKeys;
  const RESOURCE_MEASURE = Object.fromEntries(allKeys.map(k => [k, measureOf(k)]));

  // كل الكيانات اللي لها سجل مخزون (الحالية + المؤرشفة)
  const everyone = [...layoutNodes(), ...Object.values(state.archivedEntities).map(a => ({ ...a.node, archived: true, archivedAt: a.archivedAt }))].filter(n => state.inventory[n.id]);
  const moves = allMovements(), byEntity = {};
  for (const m of moves) for (const side of ['from', 'to']) { const p = m[side]; if (p) (byEntity[p.entityId] ||= []).push({ m, side }); }
  // رصيد الكيان في أي لحظة = الافتتاحي + نصيب الحركات حتى تلك اللحظة
  const balanceAt = (n, r, T) => { const rec = state.inventory[n.id]; if (T < rec.openingAt) return 0; return (byEntity[n.id] || []).reduce((q, { m, side }) => m.resource !== r ? q : q + (side === 'to' ? 1 : -1) * portionUntil(m, T), rec.opening[r] || 0); };

  // ===== تفاصيل الكيانات داخل النطاق الحالي (المؤرشفة للقائد فقط) =====
  const match = n => (!q.baseId || n.id === q.baseId || n.baseId === q.baseId) && (!q.supplyId || n.id === q.supplyId) && (!q.unitId || n.unitId === q.unitId);
  const visible = everyone.filter(n => (n.archived ? s.all : s.entityIds.has(n.id)) && match(n));
  const entityRows = visible.map(n => {
    const rec = state.inventory[n.id];
    // بداية نافذة الكيان: بداية الفترة، أو إنشاؤه، أو (لغير القائد) لحظة انضمامه لقاعدة المستخدم — فما ينكشف تاريخه في قاعدة أخرى
    const joined = s.all ? null : (state.relationLog || []).filter(x => x.entityId === n.id && x.after?.baseId === s.baseId && x.before?.baseId !== s.baseId && x.at <= to).sort((a, b) => b.at - a.at)[0];
    const ws = Math.max(effFrom, rec.openingAt, joined?.at || 0), created = rec.openingAt > effFrom && ws === rec.openingAt, relocated = !!joined && ws === joined.at;
    const exists = rec.openingAt <= to;
    const rows = Object.fromEntries(resources.map(r => {
      const flows = zero();
      for (const { m, side } of byEntity[n.id] || []) { if (m.resource !== r) continue; const inP = portionUntil(m, to) - portionUntil(m, ws); if (inP) flows[flowOf(m, side)] += inP; }
      let opening = exists ? balanceAt(n, r, ws) : 0;
      if (created) { flows.initial = rec.opening[r] || 0; opening = 0; }
      else if (relocated) { flows.relocated_in = opening; opening = 0; }
      const closing = exists ? opening + FLOWS.reduce((sum, f) => sum + SIGN[f] * flows[f], 0) : 0;
      return [r, { opening: round3(opening), ...Object.fromEntries(FLOWS.map(f => [f, round3(flows[f])])), closing: round3(closing), current: round3(qtyOf(n.id, r)), inTransit: !n.archived ? round3(inboundTo(n.id)[r] || 0) : 0 }];
    }));
    return { id: n.id, code: n.code || null, type: n.type, ...nodeLabel(n), unitId: n.unitId || null, baseId: n.type === 'main' ? n.id : n.baseId || null, supplyId: n.supplyId || null, archived: !!n.archived, createdInPeriod: created, joinedInPeriod: relocated, windowStart: ws, openingAt: rec.openingAt, openingSource: rec.openingSource, allowedResources: n.allowedResources || [], capacity: capacityOf(n), rows };
  });

  // ===== إجماليات القواعد (القائد: كل القواعد؛ مسؤول القاعدة: قاعدته؛ مسؤول الوحدة: لا شي) =====
  const baseIds = s.role === 'user' ? [] : layoutNodes().filter(n => n.type === 'main' && (s.all || s.baseIds.has(n.id)) && (!q.baseId || n.id === q.baseId)).map(n => n.id);
  const KEYS = ['openingOnHand', 'initial', 'relocatedIn', 'external_add', 'crossBaseIn', 'crossBaseOut', 'internalTransfers', 'dispatch', 'delivery', 'return', 'consumption', 'relocatedOut', 'closingOnHand', 'currentOnHand', 'inTransit'];
  const T = Object.fromEntries(baseIds.map(b => [b, Object.fromEntries(resources.map(r => [r, Object.fromEntries(KEYS.map(k => [k, 0]))]))]));
  // الأرصدة: من فترات انتماء كل كيان (حتى لو انتقل أو تأرشف لاحقاً)
  for (const n of everyone) {
    const rec = state.inventory[n.id];
    for (const seg of segmentsOf(n, rec)) {
      if (!T[seg.baseId]) continue;
      const a = Math.max(seg.start, effFrom), b = Math.min(seg.end, to); if (a > b) continue;
      for (const r of resources) {
        const t = T[seg.baseId][r], startBal = balanceAt(n, r, a), endBal = balanceAt(n, r, b);
        if (seg.start <= effFrom) t.openingOnHand += startBal; else if (seg.start === rec.openingAt) t.initial += rec.opening[r] || 0; else t.relocatedIn += startBal;
        if (seg.end > to) t.closingOnHand += endBal; else t.relocatedOut += endBal;
      }
    }
    if (!n.archived) { const b = n.type === 'main' ? n.id : n.baseId; if (T[b]) for (const r of resources) { T[b][r].currentOnHand += qtyOf(n.id, r); T[b][r].inTransit += inboundTo(n.id)[r] || 0; } }
  }
  // الحركات: حسب تبعية الطرفين وقت العملية
  for (const m of moves) {
    if (!resources.includes(m.resource)) continue;
    const inP = portionUntil(m, to) - portionUntil(m, effFrom); if (inP <= 0) continue;
    const fb = m.from?.baseId, tb = m.to?.baseId;
    if (m.type === 'transfer') {
      if (fb && fb === tb) { if (T[fb]) T[fb][m.resource].internalTransfers += inP; }
      else { if (T[tb]) T[tb][m.resource].crossBaseIn += inP; if (T[fb]) T[fb][m.resource].crossBaseOut += inP; }
    } else {
      const b = m.to ? tb : fb;
      if (T[b]) T[b][m.resource][m.type] += inP;
    }
  }
  const bases = baseIds.map(id => { const n = layoutNodes().find(x => x.id === id); return { id, code: n?.code || null, ...nodeLabel(n), entities: everyone.filter(e => !e.archived && (e.id === id || e.baseId === id)).length, totals: Object.fromEntries(resources.map(r => [r, { measure: RESOURCE_MEASURE[r], ...Object.fromEntries(KEYS.map(k => [k, round3(T[id][r][k])])) }])) }; });

  // ===== الطلبات: المنشأة خلال الفترة داخل النطاق والفلاتر =====
  const reqs = state.requests.filter(r => canSeeRequest(s, r) && (r.createdAt || 0) >= from && (r.createdAt || 0) <= to
    && (!q.baseId || r.baseId === q.baseId) && (!q.supplyId || r.route?.fromId === q.supplyId) && (!q.unitId || r.unitId === q.unitId)
    && (!q.status || r.status === q.status) && (!q.resource || requestItems(r).some(i => i.resource === q.resource)));
  const byStatus = { pending: 0, approved: 0, delivered: 0, rejected: 0 };
  const qty = Object.fromEntries(resources.map(r => [r, { measure: RESOURCE_MEASURE[r], requested: 0, dispatched: 0, delivered: 0 }]));
  for (const r of reqs) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    for (const i of requestItems(r)) if (qty[i.resource]) qty[i.resource].requested += i.qty ?? requiredQty(r.unitId, i.resource, i.amount ?? 70);
    if (!r.stalled && r.fulfillment !== 'virtual_supply' && (r.status === 'approved' || r.status === 'delivered')) for (const i of shipmentOf(r)) if (qty[i.resource]) qty[i.resource].dispatched += i.qty;
    if (r.status === 'delivered') for (const i of (r.delivered || shipmentOf(r))) if (qty[i.resource]) qty[i.resource].delivered += i.qty;
  }
  for (const k of Object.keys(qty)) for (const f of ['requested', 'dispatched', 'delivered']) qty[k][f] = round3(qty[k][f]);

  // ===== الصادر من المركز الرئيسي (غير محدود، لكن كل إرسال مسجّل): لكل صنف المجموع وكل وجهة =====
  // القائد يشوف الكل، ومسؤول القاعدة يشوف اللي اتجه لقاعدته أو كياناتها، ومسؤول الوحدة لوحدته
  const hqOut = Object.fromEntries(resources.map(r => [r, { measure: RESOURCE_MEASURE[r], total: 0, byDestination: {} }])), hqShipments = [];
  for (const m of moves) {
    if (!['dispatch', 'external_add'].includes(m.type) || !['hq', 'virtual'].includes(m.from?.type) || !resources.includes(m.resource) || m.at < effFrom || m.at > to) continue;
    const d = m.transit?.to || m.to || {};
    const visibleTo = s.all || (s.role === 'base_manager' && d.baseId === s.baseId);
    if (!visibleTo || (q.baseId && d.baseId !== q.baseId) || (q.unitId && d.unitId !== q.unitId)) continue;
    const h = hqOut[m.resource]; h.total = round3(h.total + m.qty); h.byDestination[d.entityId] = round3((h.byDestination[d.entityId] || 0) + m.qty);
    hqShipments.push({ movementId: m.id, requestId: m.requestId, resource: m.resource, qty: m.qty, measure: m.measure, at: m.at, by: m.by, to: { entityId: d.entityId, code: d.code || null, type: d.type, baseId: d.baseId, ...(d.label ? { label: d.label } : {}), ...(d.labelKey ? { labelKey: d.labelKey } : {}) } });
  }

  return {
    generatedAt: now, trackingStartedAt: start, operationCycle: state.operationCycle || null, period: { from, to, effectiveFrom: effFrom },
    ...(from < start ? { historyUnavailableBefore: start } : {}),
    scope: { role: s.role, baseId: s.baseId, unitId: s.unitId }, resources, measures: RESOURCE_MEASURE,
    requests: { total: reqs.length, byStatus, qty, list: reqs.slice(-200).reverse().map(r => ({ id: r.id, unitId: r.unitId, baseId: r.baseId, status: r.status, priority: r.priority || 'normal', mode: r.mode, createdAt: r.createdAt || null, decidedAt: r.decidedAt || null, deliveredAt: r.deliveredAt || null, by: r.by, items: requestItems(r).map(i => ({ resource: i.resource, amount: i.amount, qty: i.qty ?? requiredQty(r.unitId, i.resource, i.amount ?? 70) })) })) },
    entities: entityRows, bases, hqOutgoing: { totals: hqOut, shipments: hqShipments.reverse().slice(0, 300) },
    ...(s.all ? { virtualSupply: moves.filter(m => m.type === 'external_add' && ['virtual', 'hq'].includes(m.from?.type) && m.at >= effFrom && m.at <= to && resources.includes(m.resource) && (!q.baseId || m.to?.baseId === q.baseId) && !q.unitId && !q.supplyId).map(m => ({ id: m.id, opId: m.opId, requestId: m.requestId || null, resource: m.resource, qty: m.qty, measure: m.measure, baseId: m.to.baseId, by: m.by, reason: m.reason, at: m.at })) } : {}),
  };
}
