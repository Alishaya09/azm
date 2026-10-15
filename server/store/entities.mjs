// إنشاء الكيانات وأرشفتها وتعديل تبعيتها — يستخدمها /api/entities و /api/layout.
// - الإنشاء: نقطة على الخريطة + سجل مخزون (سعة + رصيد افتتاحي) يُحفظ فوراً.
// - الحذف = أرشفة: النقطة تنشال من الخريطة، وسجلها ورصيدها وتاريخها يبقى في state.archivedEntities.
//   ممنوع إذا عليها طلبات نشطة أو شحنات بالطريق، أو (للقاعدة) لها مراكز أو وحدات تابعة — والسبب يرجع مع قائمة الطلبات
//   حتى يعرف القائد وش يسوي قبل الإزالة (ينتظر التسليم، أو يرفض/يرجّع الطلبات المعلقة).
//   المركز الرئيسي (الرياض) ما يُؤرشف.
import { state } from './db.mjs';
import { activeKeys, isKnownResource, resourceKeys } from './catalog.mjs';
import { capacityOf, ensureInventory, isDepotNode, isHqNode, layoutNodes, nodeById, qtyAll, qtyOf } from './hierarchy.mjs';
import { applyMovement, flushConsumption, nextOpId, supplyBase } from './ledger.mjs';

const ACTIVE = ['pending', 'assigned', 'approved'];
// سبب منع الأرشفة (أو null). remaining: النقاط اللي بتبقى بعد العملية (لحذف قاعدة مع كل توابعها مرة وحدة)
export function archiveBlockers(n, remaining = layoutNodes()) {
  if (isHqNode(n)) return { error: 'hq_locked' };
  const brief = r => ({ id: r.id, status: r.status, ...(r.stalled ? { stalled: true } : {}), kind: r.kind || 'unit' });
  const reqs = state.requests.filter(r => ACTIVE.includes(r.status) && ((n.type === 'unit' && r.unitId === n.unitId) || (r.kind === 'base' && r.targetId === n.id) || (r.status !== 'pending' && r.route?.fromId === n.id)));
  if (reqs.length) return { error: 'entity_in_use', requests: reqs.map(brief) };
  if (n.type === 'main') { const kids = remaining.filter(x => x.id !== n.id && x.baseId === n.id); if (kids.length) return { error: 'entity_has_children', children: kids.map(x => x.unitId || x.id) }; }
  return null;
}
export const archiveBlocker = (n, remaining) => archiveBlockers(n, remaining)?.error || null;
export function archiveEntity(n, by) {
  flushConsumption(n.id);
  state.archivedEntities[n.id] = { node: { ...n }, archivedAt: Date.now(), archivedBy: by, balance: qtyAll(n.id) };
  if (state.inventory[n.id]) Object.assign(state.inventory[n.id], { archived: true, archivedAt: Date.now() });
}

// رقم وحدة جديد ما سبق استخدامه (لا على الخريطة ولا في المخزون القديم ولا في الأرشيف ولا في الطلبات)
export function nextUnitId() {
  const used = new Set([...layoutNodes().map(n => n.unitId), ...Object.keys(state.stocks), ...Object.values(state.archivedEntities).map(a => a.node.unitId), ...state.requests.map(r => r.unitId)].filter(Boolean));
  let max = 0; for (const id of used) { const m = /^UNIT-(\d+)$/.exec(id); if (m) max = Math.max(max, Number(m[1])); }
  return `UNIT-${String(max + 1).padStart(2, '0')}`;
}
export const unitIdTaken = unitId => !!(state.stocks[unitId] || Object.values(state.archivedEntities).some(a => a.node.unitId === unitId) || state.requests.some(r => r.unitId === unitId));

// يتحقق من الرصيد الافتتاحي المرسل عند الإنشاء: أعداد صحيحة من 0 إلى السعة. يرجع الكائن أو null إذا غير صالح
export function parseOpening(n, opening) {
  if (opening === undefined || opening === null) return {};
  if (typeof opening !== 'object') return null;
  const cap = capacityOf(n), out = {};
  for (const [r, q] of Object.entries(opening)) { if (!isKnownResource(r) || (n.type === 'unit' && !n.allowedResources.includes(r)) || !Number.isInteger(q) || q < 0 || q > cap[r]) return null; out[r] = q; }
  return out;
}
// جميع الأصناف النشطة لوحدة جديدة، دون صرف رصيد تجهيز أولي.
export const newUnitResources = () => activeKeys();
export const unitStarterItems = () => [];
export const centerStarterItems = n => activeKeys().map(resource => ({ resource, qty: capacityOf(n)[resource] })).filter(i => i.qty > 0);
export function centerStarterError(n) {
  const failures = centerStarterItems(n).filter(i => qtyOf(n.baseId, i.resource) < i.qty).map(i => ({ ...i, available: qtyOf(n.baseId, i.resource), missing: i.qty - qtyOf(n.baseId, i.resource), error: 'insufficient_stock' }));
  return failures.length ? { error: 'insufficient_stock', failures } : null;
}
export function starterError(n, sourceId = n.baseId) {
  const source = nodeById(sourceId);
  if (!isDepotNode(source) || (source.type === 'main' ? source.id : source.baseId) !== n.baseId) return { error: 'invalid_target' };
  const oversized = (n.allowedResources || []).find(k => (capacityOf(n)?.[k] || 0) >= (capacityOf({type:'fsb'})?.[k] || 0));
  if (oversized) return { error: 'invalid_capacity', resource: oversized };
  const short = unitStarterItems(n).find(i => qtyOf(source.id, i.resource) < i.qty);
  return short ? { error: 'insufficient_stock', resource: short.resource, available: qtyOf(source.id, short.resource) } : null;
}
// الوحدة تبدأ بصفر؛ المركز يستلم من قاعدته بحركات تحويل، والقاعدة تبدأ ممتلئة وفق السياسة القائمة.
export function createEntityRecords(n, by, { sourceId = n.baseId } = {}) {
  if (n.type === 'unit') state.stocks[n.unitId] = Object.fromEntries((n.allowedResources || []).map(k => [k, 0]));
  // القاعدة الجديدة لا تحصل على رصيد ضمني: يبدأ الدفتر بصفر ثم يمونها المركز الرئيسي بحركات موثقة.
  if (n.type === 'main') state.depots[n.id] = Object.fromEntries(resourceKeys().map(k => [k, 0]));
  // فرق ميلي ثانية يضمن إدراج حركات تجهيز الوحدة في التقرير حتى لو تم الإنشاء والصرف في نفس اللحظة.
  const inventory = ensureInventory(n, { source: 'created', by, at: Date.now()-1 });
  if (n.type === 'main') supplyBase({ baseId: n.id, items: activeKeys().map(resource => ({ resource, qty: capacityOf(n)[resource] })).filter(i => i.qty > 0), by, reason: 'base_initial_fill' });
  if (n.type === 'unit' && unitStarterItems(n).length) {
    const opId = nextOpId('IN');
    for (const i of unitStarterItems(n)) applyMovement({ type: 'transfer', resource: i.resource, qty: i.qty, fromId: sourceId, toId: n.id, by, reason: 'unit_initial_issue', opId });
  }
  if (n.type === 'fsb') {
    const opId = nextOpId('IN');
    for (const i of centerStarterItems(n)) applyMovement({ type: 'transfer', ...i, fromId: n.baseId, toId: n.id, by, reason: 'center_initial_fill', opId });
  }
  return inventory;
}
