// سجل حركات المخزون الدائم (state.movements) — مصدر التقارير. لا يُقص ولا يُحذف منه شي.
// كل تغيير على رصيد قاعدة أو مركز أو وحدة يمر من applyMovement، فالرصيد والسجل يتغيران معاً دائماً.
// الأنواع:
//   external_add  إضافة خارجية للقاعدة (القائد)          to
//   transfer      تحويل فوري بين مستودعين                 from → to
//   dispatch      صرف شحنة لوحدة (اعتماد الطلب)            from → (بالطريق)
//   delivery      تسليم الشحنة للوحدة                       (بالطريق) → to
//   return        إرجاع كمية ما وسعتها الوحدة للمصدر        (بالطريق) → to
//   consumption   استهلاك محاكى للوحدة (مجمّع في فترات)     from
// كل طرف (from/to) يحفظ نسخة من تبعيته وقت العملية + الرصيد قبل وبعد، فالتقارير التاريخية ما تتغير لو تغيّرت التبعية.
import { CONSUMPTION_BUCKET_MS } from '../config.mjs';
import { auditActor } from './audit.mjs';
import { measureOf } from './catalog.mjs';
import { state } from './db.mjs';
import { anyNode, baseIdOf, qtyOf, round3, setQty, supplyIdOf } from './hierarchy.mjs';

state.movements ||= []; state.nextMovement ||= 1; state.nextOp ||= 1; state.consumptionOpen ||= {};
// أقدم وقت ممكن لبداية فترة استهلاك لكل كيان (إنشاؤه أو آخر إغلاق لفتراته) — حتى ما ينحسب استهلاك قبل وجوده أو قبل تسليم/نقل
state.consumptionFloor ||= {};

export const MOVEMENT_TYPES = ['external_add', 'transfer', 'dispatch', 'delivery', 'return', 'consumption', 'retirement', 'maintenance', 'maintenance_due'];
// رقم عملية (تحويل، إضافة خارجية…) يربط حركاتها ببعض
export const nextOpId = prefix => `${prefix}-${String(state.nextOp++).padStart(5, '0')}`;

// مصدر افتراضي بلا موقع ولا رصيد؛ يستخدم لتزويد مستودعات القواعد فقط.
export const virtualSupplyParty = () => ({ ...partyOf('hq-riyadh'), unlimited: true, before: null, after: null });
export const supplyBase = ({ baseId, items, by, reason, requestId = null }) => {
  const opId = nextOpId('EX');
  const movements = items.map(i => applyMovement({ type: 'external_add', resource: i.resource, qty: i.qty, fromId: 'hq-riyadh', toId: baseId, by, reason, requestId, opId }));
  return { opId, movements };
};

// نسخة من الكيان وتبعيته لحظة العملية
export const partyOf = nodeId => {
  const n = anyNode(nodeId);
  return { entityId: nodeId, type: n?.type || null, code: n?.code || null, baseId: n ? baseIdOf(n) : null, ...(n?.type === 'unit' ? { unitId: n.unitId, supplyId: supplyIdOf(n) } : {}), ...(n?.label ? { label: n.label } : n?.labelKey ? { labelKey: n.labelKey } : {}) };
};

export function applyMovement({ type, resource, qty, fromId = null, toId = null, by = 'system', reason = null, requestId = null, opId = null, transit = null, extra = {} }) {
  const m = { id: `MV-${String(state.nextMovement++).padStart(6, '0')}`, type, resource, qty: round3(qty), measure: measureOf(resource), at: Date.now(), simHours: round3(state.sim.hours), by };
  if (reason) m.reason = reason;
  m.role = by === 'simulation' || by === 'system' ? by : auditActor().role;
  if (requestId) m.requestId = requestId;
  if (opId) m.opId = opId;
  if (fromId) {
    const before = qtyOf(fromId, resource);
    // المركز الرئيسي غير محدود: الرصيد ما يتغير، لكن الحركة نفسها (الكمية والوجهة والوقت والمنفّذ) تُسجّل كاملة
    if (!Number.isFinite(before)) m.from = { ...partyOf(fromId), unlimited: true, before: null, after: null };
    else { setQty(fromId, resource, before - qty); m.from = { ...partyOf(fromId), before: round3(before), after: round3(qtyOf(fromId, resource)) }; }
  }
  if (toId) { const before = qtyOf(toId, resource); setQty(toId, resource, before + qty); m.to = { ...partyOf(toId), before: round3(before), after: round3(qtyOf(toId, resource)) }; }
  if (transit) m.transit = transit;
  if (m.from && m.to) m.crossBase = m.from.baseId !== m.to.baseId;
  Object.assign(m, extra);
  state.movements.push(m);
  return m;
}

// ===== الاستهلاك المحاكى: يتجمع لكل وحدة ومورد في فترة مفتوحة (محفوظة في state) ثم يُغلق كحركة consumption =====
const bucketMovement = (b, provisional = false) => ({
  id: provisional ? `OPEN-${b.entityId}-${b.resource}` : `MV-${String(state.nextMovement++).padStart(6, '0')}`,
  type: 'consumption', resource: b.resource, qty: round3(b.qty), measure: measureOf(b.resource),
  at: b.endAt, periodStart: b.startAt, simStart: round3(b.simStart), simHours: round3(b.simEnd), by: 'simulation', role: 'simulation', simulated: true,
  from: { ...b.party, before: round3(b.before), after: round3(b.after) }, ...(provisional ? { provisional: true } : {}),
});
export function recordConsumption(nodeId, resource, before, after, periodStart, simStart, simEnd, now = Date.now()) {
  if (!(before - after > 0)) return;
  const key = `${nodeId}:${resource}`, floor = Math.max(state.inventory[nodeId]?.openingAt || 0, state.consumptionFloor[nodeId] || 0);
  const b = state.consumptionOpen[key] ||= { entityId: nodeId, resource, qty: 0, startAt: Math.min(now, Math.max(periodStart, floor)), simStart, before, party: partyOf(nodeId) };
  b.qty += before - after; b.after = after; b.endAt = now; b.simEnd = simEnd;
  if (b.endAt - b.startAt >= CONSUMPTION_BUCKET_MS) closeBucket(key);
}
const closeBucket = key => { const b = state.consumptionOpen[key]; if (!b) return; delete state.consumptionOpen[key]; if (b.qty > 0) state.movements.push(bucketMovement(b)); };
// يغلق فترات الاستهلاك المفتوحة لكيان (قبل أي حركة ثانية عليه أو تغيير تبعيته) أو للكل
export const flushConsumption = (nodeId = null) => {
  for (const key of Object.keys(state.consumptionOpen)) if (!nodeId || key.startsWith(`${nodeId}:`)) closeBucket(key);
  if (nodeId) state.consumptionFloor[nodeId] = Date.now();
};
// الفترات المفتوحة كحركات مؤقتة (للتقارير) — ما تُحفظ في السجل
export const openConsumption = () => Object.values(state.consumptionOpen).filter(b => b.qty > 0).map(b => bucketMovement(b, true));
export const allMovements = () => [...state.movements, ...openConsumption()];

// نصيب حركة من الفترة حتى الوقت T (الاستهلاك موزّع بالتساوي على فترته)
export const portionUntil = (m, T) => {
  if (m.at <= T) return m.qty;
  if (m.type === 'consumption' && m.periodStart != null && T > m.periodStart && m.at > m.periodStart) return m.qty * (T - m.periodStart) / (m.at - m.periodStart);
  return 0;
};
