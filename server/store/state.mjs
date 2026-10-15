// حالة العمليات المشتركة (data/state.json): الطلبات، السجل، الخريطة، المخزون، التنبيهات، والمحاكاة.
// التحميل والحفظ في db.mjs، والهيكل والكميات في hierarchy.mjs، وسجل الحركات في ledger.mjs، والأصناف في catalog.mjs.
// أنواع الطلبات:
//   unit (افتراضي)  طلب وحدة — يقرره القائد، وينفذه مسؤول قاعدة الوحدة، والوجهة الوحدة (unitId)
//   base            احتياج قاعدة — يزوّده القائد مباشرة من المورد الافتراضي، والوجهة مستودع القاعدة (targetId)
// حالات طلب الوحدة:
//   pending   بانتظار قرار القائد
//   assigned  وافق القائد (مصدر + كميات + وسيلة) — بانتظار مباشرة مسؤول القاعدة؛ لا خصم ولا شحنة بعد
//   approved  باشر مسؤول القاعدة: خُصمت الكميات مرة واحدة وانطلقت الشحنة (بالطريق) — الاسم القديم محفوظ للتوافق
//   delivered وصلت الشحنة وأُضيفت للوحدة مرة واحدة · rejected مرفوض
import { HOUR_MS, NEW_UNIT_START, OPTEMPO_RATE, SEVERITY, THRESHOLDS, UNIT_START } from '../config.mjs';
import { randomBytes } from 'node:crypto';
import { state, saveState, backupState, existedBefore } from './db.mjs';
import { resourceKeys, weightOf, resDef } from './catalog.mjs';
import { anyNode, capacityOf, ensureInventory, isDepotNode, layoutNodes, qtyOf, requiredQty, unitCapacityOf, unitIds, unitNodeOf, unitOperationalKeys, unitStock } from './hierarchy.mjs';
import { applyMovement, flushConsumption, partyOf, recordConsumption } from './ledger.mjs';
import { runMigrations } from './migrate.mjs';

export { state, saveState, unitIds };

// الترحيل للبنية الجديدة (مرة وحدة، آمن للتكرار، مع نسخة احتياطية قبل الكتابة)
runMigrations();
if (!state.entityStoreVersion) {
  if (existedBefore) backupState('pre-entity-split');
  saveState();
}

// سجل العمليات المختصر (آخر 500 سطر) لصفحة السجل — التقارير تعتمد على state.movements الدائم وليس عليه
// scope: { unitId, baseIds } لفلترة السطر حسب صلاحية المشاهد
export const addLog = (type, id, by, scope = {}) => {
  state.logs.unshift({ time: new Date().toLocaleTimeString('en-GB'), at: Date.now(), type, id, by, ...scope });
  state.logs = state.logs.slice(0, 500);
};
// الطلبات القديمة فيها مورد واحد؛ الجديدة فيها قائمة مواد
export const requestItems = r => r.items?.length ? r.items : [{ resource: r.resource, amount: r.amount ?? 70 }];
// تاريخ تغيّر حالة الطلب
export const pushHistory = (r, status, by, note = null) => { (r.history ||= []).push({ status, at: Date.now(), by, priority: r.priority || 'normal', ...(note ? { note } : {}) }); };
// الكميات المرسلة فعلياً في الطلب (الطلبات القديمة قبل المستودعات: من النسبة)
export const shipmentOf = r => r.dispatched?.length ? r.dispatched : requestItems(r).map(i => ({ resource: i.resource, qty: i.qty ?? requiredQty(r.unitId, i.resource, i.amount ?? 70) }));
// وجهة الطلب: الوحدة، أو مستودع القاعدة لطلبات القاعدة من المركز الرئيسي
export const destinationOf = r => r.kind === 'base' ? anyNode(r.targetId) : (unitNodeOf(r.unitId) || anyNode(`u-${r.unitId}`));
// شحنة فعلية بالطريق = معتمدة وانطلقت. اعتماد قديم ما له أي سجل إرسال (stalled) ما يُحسب بالطريق ولا يُسلَّم
export const isInTransit = r => r.status === 'approved' && !r.stalled;
// الكميات بالطريق لأي وجهة (وحدة أو قاعدة): { resource: qty }
export const inboundTo = nodeId => {
  const out = Object.fromEntries(resourceKeys().map(r => [r, 0]));
  for (const r of state.requests) if (isInTransit(r) && destinationOf(r)?.id === nodeId) for (const i of shipmentOf(r)) out[i.resource] = (out[i.resource] || 0) + i.qty;
  return out;
};
export const inTransitTo = unitId => inboundTo(unitNodeOf(unitId)?.id || `u-${unitId}`);
// قرار القائد بالموافقة دون مباشرة بعد: لا خصم ولا شحنة، لكن كمياته محجوزة في سعة الوجهة
// حتى لا يُعتمد طلب آخر يتجاوزها قبل أن يباشر مسؤول القاعدة التنفيذ.
export const isAssigned = r => r.status === 'assigned';
export const reservedTo = (nodeId, exceptId = null) => {
  const out = Object.fromEntries(resourceKeys().map(r => [r, 0]));
  for (const r of state.requests) if (isAssigned(r) && r.id !== exceptId && destinationOf(r)?.id === nodeId) for (const i of r.approvedItems || []) out[i.resource] = (out[i.resource] || 0) + i.qty;
  return out;
};

// ===== محاكاة الاستهلاك: تعمل على الخادم فيشوف الجميع نفس الأرقام وتستمر حتى لو الصفحة مسكّرة =====
export const unitStart = id => UNIT_START[id] || NEW_UNIT_START;
// ينشئ سجلات المخزون الفعلية لكل كيان على الخريطة (يُستدعى عند حفظ الخريطة حتى تنحفظ الكيانات الجديدة فوراً)
export const ensureEntityRecords = (opts = {}) => { for (const n of layoutNodes()) if (isDepotNode(n) || n.type === 'unit') ensureInventory(n, opts); };
export const ensureUnitStocks = ensureEntityRecords;
const levelOf = v => THRESHOLDS.find(([, limit]) => v <= limit)?.[0] || null;
const addAlert = (n, resource, level, value) => {
  state.alerts.unshift({ id: `AL-${Date.now().toString(36)}${randomBytes(2).toString('hex')}`, at: Date.now(), time: new Date().toLocaleTimeString('en-GB'), unitId: n.unitId, baseId: n.baseId || null, resource, level, value: Math.round(value) });
  state.alerts = state.alerts.slice(0, 300);
};

// نحرّك المحاكاة بمقدار الوقت اللي مضى منذ آخر مرة (مرة وحدة مهما كان عدد المستخدمين أو التبويبات المتصلة)،
// نسجل استهلاك الرصيد المستلم للأصناف الاستهلاكية وفق الكتالوج، مع احتياج واحد لمجموعة وقود المركبات.
// المعدل تجريبي للمحاكاة (weight في الكتالوج × OPTEMPO) وليس معدلاً ميدانياً. القواعد والمراكز ما تستهلك،
// الأصناف غير الاستهلاكية لا تنقص آلياً. السرعة 0 توقف الوقت والاستهلاك وتقدم القوافل.
export const advanceSim = () => {
  const now = Date.now(), periodStart = state.sim.at, hours = Math.min(6, Math.max(0, now - periodStart) / HOUR_MS) * state.sim.speed;
  state.sim.at = now; if (hours <= 0) return;
  const simStart = state.sim.hours; state.sim.hours += hours;
  for (const n of layoutNodes()) {
    if (n.type !== 'unit' || typeof n.unitId !== 'string') continue;
    const start = unitStart(n.unitId), s = unitStock(n.unitId); ensureInventory(n);
    const rate = OPTEMPO_RATE[start.optempo];
    const eligible = unitOperationalKeys(n.unitId).filter(r => unitCapacityOf(n.unitId,r) > 0 && weightOf(r) > 0);
    const fuels = eligible.filter(r => resDef(r).consumptionGroup === 'vehicle_fuel' && qtyOf(n.id,r) > 0);
    const fuelTotal = fuels.reduce((sum,r) => sum + qtyOf(n.id,r),0);
    const fuelDemand = Math.max(0,...fuels.map(r => unitCapacityOf(n.unitId,r)*weightOf(r)/100)) * rate * hours;
    for (const r of eligible) {
      const cap = unitCapacityOf(n.unitId,r), before = qtyOf(n.id,r);
      const demand = resDef(r).consumptionGroup === 'vehicle_fuel'
        ? (fuelTotal > 0 ? Math.min(fuelTotal,fuelDemand) * before/fuelTotal : 0)
        : cap * weightOf(r)/100 * rate * hours;
      const after = Math.max(0,before-demand);
      if (after < before) { s[r] = after/cap*100; recordConsumption(n.id,r,before,after,periodStart,simStart,state.sim.hours,now); }
      const key = `${n.unitId}:${r}`, level = levelOf(s[r] || 0), prev = state.alertFlags[key] || null;
      if (SEVERITY[level] > SEVERITY[prev]) addAlert(n,r,level,s[r] || 0);
      state.alertFlags[key] = level;
    }
  }
  saveState();
};
// ساعة المحاكاة على الخادم: تتقدم وتُسلّم القوافل حتى لو لم يفتح أحد الصفحة.
// وقت توقف الخادم نفسه لا يُعوَّض (لا قفزة مفاجئة بعد إعادة التشغيل)؛ يُسجَّل في sim.resumedAt وsim.lastGapMs للعرض.
export const startSimClock = (intervalMs = 2000) => {
  const now = Date.now(), gap = Math.max(0, now - (state.sim.at || now));
  Object.assign(state.sim, { at: now, resumedAt: now, lastGapMs: gap });
  saveState();
  const tick = () => { try { advanceSim(); if (deliverDueConvoys()) saveState(); } catch (e) { console.error(`[sim] ${e.message}`); } };
  const timer = setInterval(tick, intervalMs); timer.unref?.();
  return () => clearInterval(timer);
};

// تسليم شحنة: تنضاف الكمية المرسلة فعلياً للوجهة (وحدة أو مستودع قاعدة) مرة وحدة.
// إذا ما وسعتها الوجهة (حالة نادرة) يرجع الزائد للمصدر بحركة return محفوظة.
const deliver = r => {
  const now = Date.now(), node = destinationOf(r);
  r.status = 'delivered'; r.deliveredAt = now; pushHistory(r, 'delivered', 'system');
  if (!node) { r.undeliverable = true; return; }
  flushConsumption(node.id);
  const src = r.route?.fromId && anyNode(r.route.fromId), legacy = !r.dispatched?.length;
  r.delivered = [];
  for (const { resource, qty } of shipmentOf(r)) {
    const cap = node.type === 'unit' ? unitCapacityOf(node.unitId, resource) : capacityOf(node)?.[resource] ?? 0;
    const room = Math.max(0, cap - qtyOf(node.id, resource));
    const put = qty - room < 0.001 ? qty : room;
    if (put > 0) applyMovement({ type: 'delivery', resource, qty: put, toId: node.id, requestId: r.id, transit: src ? { from: partyOf(src.id) } : null, extra: legacy ? { legacy: true } : {} });
    r.delivered.push({ resource, qty: put });
    const excess = qty - put;
    if (excess > 0) {
      const back = isDepotNode(src) ? Math.min(excess, Math.max(0, capacityOf(src)[resource] - qtyOf(src.id, resource))) : 0;
      if (back > 0) { applyMovement({ type: 'return', resource, qty: back, toId: src.id, requestId: r.id, reason: 'destination_capacity', transit: { to: partyOf(node.id) } }); (r.returned ||= []).push({ resource, qty: back }); }
      if (excess - back > 0) (r.unplaced ||= []).push({ resource, qty: excess - back });
    }
    if (node.type === 'unit') state.alertFlags[`${node.unitId}:${resource}`] = levelOf(unitStock(node.unitId)[resource] || 0);
  }
};

// القوافل اللي خلص وقتها (بساعات المحاكاة) تتحول إلى "تم التسليم" وتعبّي الوجهة. ترجع true إذا تغيّر شي.
// الحالة تتغير approved → delivered مرة وحدة، فالتسليم ما يتكرر مع التحديث أو إعادة المحاولة أو إعادة التشغيل.
export const deliverDueConvoys = () => {
  const now = Date.now(); let changed = false;
  for (const r of state.requests) {
    if (!isInTransit(r)) continue;
    // قوافل اعتُمدت قبل ربط الحركة بالمحاكاة: نحوّل وقت انطلاقها الفعلي إلى ساعات محاكاة
    if (r.departSim == null && r.departAt) { r.departSim = state.sim.hours - (now - r.departAt) / HOUR_MS; changed = true; }
    // القافلة تتقدم بساعات المحاكاة، فسرعة المحاكاة (×1، ×5…) تسرّعها
    if (r.departSim != null && state.sim.hours >= r.departSim + r.eta) {
      deliver(r);
      addLog('delivered', r.id, 'system', { unitId: r.unitId || undefined, baseIds: [r.baseId].filter(Boolean) }); changed = true;
    }
  }
  return changed;
};
