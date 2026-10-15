// الهيكل التنظيمي والمخزون: القيادة ← القواعد ← (مراكز الإمداد + الوحدات).
// - التبعية ثابتة تُحدد عند الإنشاء ومحفوظة على نقطة الخريطة:
//     مركز الإمداد (fsb): baseId = القاعدة التابع لها.
//     الوحدة (unit): baseId = قاعدتها. مصدر الإمداد ما هو جزء من التبعية — يُختار لكل شحنة عند الاعتماد.
//     supplyId قديم (من النسخ السابقة) يبقى محفوظ للتوافق فقط، ويُستخدم كمصدر مقترح إذا كان من نفس القاعدة.
//   parentId القديم يبقى محدّث للتوافق (المركز ← القاعدة، الوحدة ← القاعدة).
//   تحريك النقطة ما يغيّر تبعيتها، وما نستخدم "الأقرب" أبداً بعد الترحيل.
// - المخزون: لكل قاعدة ومركز كميات فعلية في state.depots، ولكل وحدة نسبة من سعتها في state.stocks (التخزين القديم).
//   سجل state.inventory[nodeId] يحفظ الرصيد الافتتاحي وتاريخ بداية التتبع لكل كيان. السعات من كتالوج الموارد (catalog.mjs).
// - المركز الرئيسي (type: 'hq'، الرياض): مصدر الموارد للقواعد، مخزونه غير محدود في المحاكاة — ما له رصيد ولا ينقص،
//   لكن كل كمية تطلع منه تُسجّل كحركة dispatch في سجل الحركات (ledger) مثل أي مصدر.
import { state } from './db.mjs';
import { depotCapacityFor, isActiveResource, resourceKeys, unitCapacityFor, unitProfileOf, validFuelType, resDef } from './catalog.mjs';

// نفس التخطيط الافتراضي في src/map/layout.jsx — يُستخدم قبل ما يحفظ المسؤول أي خريطة (والترحيل يثبّته)
export const DEFAULT_LAYOUT = {
  nodes: [
    { id: 'hq-riyadh', type: 'hq', labelKey: 'map.hq', pos: [24.90, 46.72], code: 'AZM-HQ-001', fixed: true },
    { id: 'base', type: 'main', labelKey: 'map.base', pos: [24.71, 46.68] },
    { id: 'fsb-1', type: 'fsb', labelKey: 'map.fsbWest', pos: [23.4, 43.6] },
    { id: 'fsb-2', type: 'fsb', labelKey: 'map.fsbCenter', pos: [25.0, 46.0] },
    { id: 'fsb-3', type: 'fsb', labelKey: 'map.fsbSouth', pos: [20.5, 45.2] },
    { id: 'u-UNIT-01', type: 'unit', unitId: 'UNIT-01', pos: [22.3, 41.6] },
    { id: 'u-UNIT-02', type: 'unit', unitId: 'UNIT-02', pos: [25.25, 45.25] },
    { id: 'u-UNIT-03', type: 'unit', unitId: 'UNIT-03', pos: [17.6, 44.2] },
  ],
  links: [
    { id: 'l1', from: 'base', to: 'fsb-1', kind: 'road' }, { id: 'l2', from: 'fsb-1', to: 'u-UNIT-01', kind: 'road' },
    { id: 'l3', from: 'base', to: 'fsb-2', kind: 'road' }, { id: 'l4', from: 'fsb-2', to: 'u-UNIT-02', kind: 'road' },
    { id: 'l5', from: 'base', to: 'fsb-3', kind: 'road' }, { id: 'l6', from: 'fsb-3', to: 'u-UNIT-03', kind: 'road' },
    { id: 'l7', from: 'base', to: 'u-UNIT-03', kind: 'air' },
  ],
};
state.inventory ||= {}; state.archivedEntities ||= {};

export const layoutNodes = () => (state.layout || DEFAULT_LAYOUT).nodes;
export const layoutLinks = () => (state.layout || DEFAULT_LAYOUT).links;
export const nodeById = id => layoutNodes().find(n => n.id === id) || null;
// نقطة محذوفة (مؤرشفة) — تُستخدم للسجلات التاريخية فقط
export const archivedNode = id => state.archivedEntities[id]?.node || null;
export const anyNode = id => nodeById(id) || archivedNode(id) || state.legacySupplySources?.[id]?.node || null;
export const unitNodeOf = unitId => layoutNodes().find(n => n.type === 'unit' && n.unitId === unitId) || null;
export const unitAllows = (unitId, resource) => {
  const n = unitNodeOf(unitId);
  // A malformed/older node must not gain every newly added catalog item.
  return !!n && Array.isArray(n.allowedResources) && n.allowedResources.includes(resource);
};
export const unitIds = () => layoutNodes().filter(n => n.type === 'unit' && typeof n.unitId === 'string').map(n => n.unitId);
// نوع وقود الوحدة كما حدده القائد: مفتاح وقود، 'none'، أو null (غير محدد — لا نخمّن ولا نستهلك وقوداً)
export const unitFuelType = n => n && validFuelType(n.fuelType ?? null) ? (n.fuelType ?? null) : null;
// الأصناف التشغيلية للوحدة الآن: الغذائية المخصصة لها + وقودها المحدد فقط (إذا كان مخصصاً وفعّالاً).
// أصناف قديمة أخرى مخصصة للوحدة تبقى برصيدها وتاريخها، لكنها لا تُطلب جديداً ولا تُستهلك بالمحاكاة.
export const unitOperationalKeys = unitId => {
  const n = unitNodeOf(unitId); if (!n || !Array.isArray(n.allowedResources)) return [];
  return n.allowedResources.filter(k => isActiveResource(k) && resDef(k)?.usage === 'consumable');
};
export const unitRequestable = (unitId, resource) => isActiveResource(resource) && unitAllows(unitId, resource);
// أصناف مخصصة للوحدة من السياسة السابقة (ليست تشغيلية الآن) — تُعرض للقائد للمراجعة فقط
export const unitLegacyKeys = unitId => { const n = unitNodeOf(unitId); return (n?.allowedResources || []).filter(k => !isActiveResource(k)); };
// مستودع برصيد محدود (قاعدة أو مركز إمداد)
export const isDepotNode = n => !!n && (n.type === 'main' || n.type === 'fsb');
export const isBaseNode = n => !!n && n.type === 'main';
// المركز الرئيسي (غير محدود) — واحد فقط
export const isHqNode = n => !!n && n.type === 'hq';
export const hqNode = () => layoutNodes().find(isHqNode) || null;
// أي مصدر يقدر يرسل شحنة: مستودع أو المركز الرئيسي
export const isSourceNode = n => isDepotNode(n);

// ===== التبعية =====
// القاعدة اللي تتبعها النقطة (القاعدة نفسها لنفسها)
export const baseIdOf = n => !n ? null : n.type === 'main' ? n.id : (n.baseId || null);
export const supplyIdOf = n => n?.type === 'unit' ? (n.supplyId || null) : null;
// المصدر المقترح للوحدة (للعرض فقط): مركزها القديم إذا من نفس القاعدة، وإلا مستودع قاعدتها
export const defaultSourceIdOf = n => { const s = nodeById(supplyIdOf(n)); return s && s.baseId === n.baseId ? s.id : baseIdOf(n); };

// { nodeId: parentId|null } — من التبعية الثابتة (الوحدة والمركز ← القاعدة)
export function parentMap(nodes = layoutNodes()) {
  const out = {};
  for (const n of nodes) out[n.id] = n.type === 'main' ? null : (n.baseId || null);
  return out;
}
export const baseOf = nodeId => baseIdOf(nodeById(nodeId));
// سلسلة الوحدة: [نقطة الوحدة، قاعدتها]
export const chainOfUnit = unitId => {
  const n = unitNodeOf(unitId); if (!n) return [];
  return [n.id, n.baseId, ...layoutNodes().filter(x => x.type === 'fsb' && n.baseId && x.baseId === n.baseId).map(x => x.id)].filter(id => id && nodeById(id));
};

// التبعية القديمة (قبل التثبيت): parentId صريح صالح، وإلا الأقرب. ترجع { parentId, source }
//   source: explicit | derived | ambiguous (تعادل في المسافة) | none (ما فيه أب ممكن)
const km = (a, b) => {
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
export const distanceKm = km;
const LEGACY_PARENT_TYPES ={ unit: ['fsb', 'main'], fsb: ['main'], main: [] };
export function deriveLegacyParent(n, nodes) {
  const allowed = LEGACY_PARENT_TYPES[n.type] || [];
  const byId = Object.fromEntries(nodes.map(x => [x.id, x]));
  if (n.parentId && byId[n.parentId] && allowed.includes(byId[n.parentId].type)) return { parentId: n.parentId, source: 'explicit' };
  const ranked = nodes.filter(c => c.id !== n.id && allowed.includes(c.type)).map(c => ({ c, d: km(n.pos, c.pos) })).sort((a, b) => a.d - b.d);
  if (!ranked.length) return { parentId: null, source: 'none' };
  // تعادل تقريبي (فرق أقل من 1% أو 1 كم) = علاقة ملتبسة، ما نخمّن
  if (ranked[1] && ranked[1].d - ranked[0].d < Math.max(1, ranked[0].d * 0.01)) return { parentId: null, source: 'ambiguous', candidates: ranked.slice(0, 2).map(x => x.c.id) };
  return { parentId: ranked[0].c.id, source: 'derived' };
}

// يتحقق من تبعية كيان جديد: المركز والوحدة يحتاجون قاعدة موجودة فقط. يرجع رمز الخطأ أو null
export function relationError(type, baseId) {
  if (type === 'main') return baseId ? 'invalid_relation' : null;
  if (type !== 'fsb' && type !== 'unit') return 'invalid_relation';
  return isBaseNode(nodeById(baseId)) ? null : 'invalid_base';
}
// يثبّت التبعية على النقطة ويحدّث parentId القديم معها. supplyId قديم يبقى كما هو (للتوافق) ولا ينضاف لجديد
export function setRelation(n, baseId) {
  if (n.type === 'main') { delete n.baseId; delete n.supplyId; delete n.parentId; return n; }
  n.baseId = baseId || null;
  if (n.type !== 'unit') delete n.supplyId;
  if (n.baseId) n.parentId = n.baseId; else delete n.parentId;
  return n;
}
// سجل قديم بقاعدة مفقودة أو ملتبسة (أو قاعدته انحذفت) — الوحيد اللي يقبل "إصلاح" تبعية من القائد
export const needsBaseRepair = n => n.type !== 'main' && !isBaseNode(nodeById(n.baseId));

// ===== السعة والكميات =====
export const round3 = v => Math.round(v * 1000) / 1000;
export const unitProfile = unitProfileOf;
// السعة الحالية من الكتالوج (القائد يعدّلها). المركز الرئيسي ما له سعة (null = غير محدود)
export const capacityOf = n => {
  if (!n || isHqNode(n)) return null;
  return Object.fromEntries(resourceKeys().map(r => [r, n.type === 'unit' ? unitCapacityFor({ ...unitProfile(n.unitId), ...(n.people!==undefined?{people:n.people}:{}), ...(n.vehicles!==undefined?{vehicles:n.vehicles}:{}) }, r) : depotCapacityFor(n.type, r)]));
};
export const depotCapacity = n => capacityOf(n);
export const unitCapacityOf = (unitId, resource) => unitCapacityFor(unitProfile(unitId), resource);

// القاعدة تبدأ ممتلئة، والمركز يبدأ فارغاً حتى تصله حركة إمداد مسجلة.
export function depotOf(node) {
  if (!isDepotNode(node)) return null;
  return state.depots[node.id] ||= Object.fromEntries(resourceKeys().map(r => [r, node.type === 'main' ? depotCapacityFor('main', r) : 0]));
}
export const allDepots = () => Object.fromEntries(layoutNodes().filter(isDepotNode).map(n => [n.id, depotOf(n)]));
// مخزون الوحدة: نسب مئوية (التخزين القديم)، ويُنشأ من القيم الابتدائية أول مرة
export const unitStock = unitId => state.stocks[unitId] ||= {};

// الكمية الفعلية لأي كيان (قاعدة، مركز، وحدة) — التحويل بين النسبة والكمية يتم هنا فقط
export function qtyOf(nodeId, resource) {
  const n = anyNode(nodeId); if (!n) return 0;
  if (isHqNode(n)) return Infinity; // غير محدود
  if (isDepotNode(n)) return (state.depots[n.id] || depotOf(n))[resource] || 0;
  return (unitStock(n.unitId)[resource] || 0) * unitCapacityOf(n.unitId, resource) / 100;
}
export function setQty(nodeId, resource, qty) {
  const n = anyNode(nodeId); if (!n || isHqNode(n)) return; // رصيد المركز الرئيسي ما يتغير
  const q = Math.max(0, qty);
  if (isDepotNode(n)) { (state.depots[n.id] || depotOf(n))[resource] = round3(q); return; }
  const cap = unitCapacityOf(n.unitId, resource);
  unitStock(n.unitId)[resource] = cap > 0 ? q / cap * 100 : 0;
}
export const qtyAll = nodeId => Object.fromEntries(resourceKeys().map(r => [r, qtyOf(nodeId, r)]));
// الكمية الفعلية المطلوبة لمادة في طلب (نسبة من سعة الوحدة)
export const requiredQty = (unitId, resource, amountPercent) => Math.round(unitCapacityOf(unitId, resource) * amountPercent / 100);

// ===== سجل المخزون لكل كيان =====
// يُنشأ مرة وحدة: السعة + الرصيد الافتتاحي (الرصيد وقت الإنشاء أو وقت بداية التتبع للكيانات القديمة)
export function ensureInventory(n, { source = 'created', by = 'system', at = Date.now() } = {}) {
  if (!n || state.inventory[n.id]) return state.inventory[n.id] || null;
  if (isDepotNode(n)) depotOf(n); else if (n.type === 'unit') unitStock(n.unitId);
  const rec = { entityId: n.id, type: n.type, ...(n.unitId ? { unitId: n.unitId } : {}), capacity: capacityOf(n), opening: Object.fromEntries(resourceKeys().map(r => [r, round3(qtyOf(n.id, r))])), openingAt: at, openingSource: source, createdBy: by };
  state.inventory[n.id] = rec;
  return rec;
}
