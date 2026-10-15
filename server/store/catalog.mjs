// كتالوج الموارد (state.catalog) — يديره القائد. كل الأصناف تُقرأ من هنا (المخزون، الطلبات، الشحنات، التقارير، المحاكاة)،
// فأي صنف جديد يظهر تلقائياً حسب إعداداته. الصنف ما يُحذف — يُعطّل (active: false) وتبقى سجلاته السابقة.
// لكل صنف:
//   key        معرّف ثابت (ما يتغير بعد الإنشاء)
//   name/unit  الاسم ووحدة القياس { ar, en }، و measure رمز وحدة القياس في السجلات
//   capacity   سعة مستودع القاعدة (main) ومركز الإمداد (fsb) بالكمية الفعلية
//   unitBasis  أساس سعة الوحدة: people (الأفراد) | vehicles (المركبات) | fixed (رقم ثابت)، × unitFactor
//   weight     معدل الاستهلاك المحاكى (نسبة من السعة لكل ساعة تشغيلية × معدل OPTEMPO)
// السعات لازم تتدرج: القاعدة > المركز > أكبر وحدة. المركز الرئيسي (الرياض) غير محدود ومستثنى.
import { NEW_UNIT_START, UNIT_START } from '../config.mjs';
import { existedBefore, state } from './db.mjs';
import { readFileSync } from 'node:fs';

// بيانات الأصناف فقط من ملف التدريب؛ لا نستورد أحكام SOP أو الجهات الوهمية.
const azmResources = JSON.parse(readFileSync(new URL('../../resources/items.json', import.meta.url), 'utf8')).items;
export const trainingCatalog = () => azmResources;
const AR_STOCK_UNIT = { liter:'لتر', piece:'قطعة', carton:'كرتون', kg:'كيلوغرام', pair:'زوج', kit:'عدة', can:'عبوة', roll:'لفة', sheet:'لوح', bag:'كيس', box:'صندوق', set:'طقم' };
// ===== تصنيف الكتالوج الافتراضي؛ المحاكاة الفعلية تقرأ usage وweight دون قائمة أسماء =====
// جميع الأصناف النشطة مخصصة للوحدات، ومجموعة الوقود تشترك في احتياج المركبات مرة واحدة.
export const OPERATIONAL_FOOD = ['azm_bottled_water', 'azm_mre', 'azm_canned_food', 'azm_dates', 'azm_rice'];
export const FUEL_KEYS = ['azm_diesel', 'azm_gasoline'];
export const OPERATIONAL_KEYS = [...OPERATIONAL_FOOD, ...FUEL_KEYS];
export const isOperationalKey = key => OPERATIONAL_KEYS.includes(key);
// توافق وترحيل الحقول التاريخية فقط؛ لا يتحكم هذا الحقل في استهلاك v10.
export const validFuelType = v => v === null || v === 'none' || FUEL_KEYS.includes(v);
// الاسم الافتراضي القديم (قبل الفصحى) لمقارنة ما لم يعدّله القائد يدوياً
export const legacyDefaultName = row => row.aliases.ar[0];
// أصناف التدريب تضاف مرة واحدة عند الترحيل؛ التعديل اليدوي اللاحق لا يُستبدل.
export function trainingItem(row) {
  const unitBasis = ['I','II','VIII'].includes(row.supplyClass) ? 'people' : ['III','IX'].includes(row.supplyClass) ? 'vehicles' : 'fixed';
  return { key: row.key, icon: '📦', name: { ar: row.nameAr || row.aliases.ar[0], en: row.item },
    unit: { ar: AR_STOCK_UNIT[row.stockUnit] || row.stockUnit, en: row.stockUnit }, measure: row.stockUnit,
    capacity: { main: row.suggestedCapacity.main, fsb: row.suggestedCapacity.fsb },
    unitBasis, unitFactor: row.suggestedCapacity.unit / (unitBasis === 'people' ? 500 : unitBasis === 'vehicles' ? 40 : 1),
    // معدل المحاكاة التجريبي للأصناف التشغيلية فقط؛ القائد يعدّله من الكتالوج. البقية لا تُستهلك آلياً.
    usage: isOperationalKey(row.key) ? 'consumable' : 'maintenance',
    weight: isOperationalKey(row.key) ? .25 : 0, active: true,
    consumptionGroup: FUEL_KEYS.includes(row.key) ? 'vehicle_fuel' : null,
    training: { item: row.item, supplyClass: row.supplyClass, stockUnit: row.stockUnit,
      perUnit: row.perUnit, aliases: row.aliases, maxPerRequest: row.maxPerRequest } };
}

export const LEGACY_CATALOG = [
  { key: 'ammo', icon: '🎯', name: { ar: 'ذخيرة', en: 'Ammunition' }, unit: { ar: 'طلقة', en: 'rounds' }, measure: 'round', active: true, capacity: { main: 1000000, fsb: 250000 }, unitBasis: 'people', unitFactor: 120, weight: 1.15 },
  { key: 'fuel', icon: '⛽', name: { ar: 'وقود', en: 'Fuel' }, unit: { ar: 'لتر', en: 'liters' }, measure: 'liter', active: true, capacity: { main: 800000, fsb: 200000 }, unitBasis: 'vehicles', unitFactor: 400, weight: 1.35 },
  { key: 'food', icon: '🍱', name: { ar: 'غذاء', en: 'Food' }, unit: { ar: 'حصة', en: 'rations' }, measure: 'ration', active: true, capacity: { main: 100000, fsb: 25000 }, unitBasis: 'people', unitFactor: 9, weight: 0.6 },
  { key: 'medical', icon: '💊', name: { ar: 'مواد طبية', en: 'Medical' }, unit: { ar: 'وحدة طبية', en: 'medical units' }, measure: 'medical_unit', active: true, capacity: { main: 20000, fsb: 5000 }, unitBasis: 'people', unitFactor: 2, weight: 0.4 },
];
export const DEFAULT_CATALOG = azmResources.map(trainingItem);
state.catalog ||= JSON.parse(JSON.stringify(existedBefore && (state.schemaVersion || 1) < 7 ? [...LEGACY_CATALOG, ...DEFAULT_CATALOG] : DEFAULT_CATALOG));

export const catalog = () => state.catalog;
export const resDef = key => state.catalog.find(c => c.key === key) || null;
// كل الأصناف (للسجلات والتقارير) — والفعّالة فقط (للطلبات الجديدة والمحاكاة)
export const resourceKeys = () => state.catalog.map(c => c.key);
export const activeKeys = () => state.catalog.filter(c => c.active).map(c => c.key);
// التخصيص لا يصرف مخزوناً: الأصناف الجديدة تظهر بصفر مع إبقاء كل كمية وتاريخ قائمين.
export function syncAllUnitResources() {
  let changed = false;
  for (const n of state.layout?.nodes || []) {
    if (n.type !== 'unit') continue;
    const keys = [...new Set([...(n.allowedResources || []), ...activeKeys()])];
    if (JSON.stringify(keys) !== JSON.stringify(n.allowedResources)) { n.allowedResources = keys; changed = true; }
    const stock = state.stocks[n.unitId] ||= {};
    for (const k of keys) if (!(k in stock)) { stock[k] = 0; changed = true; }
  }
  return changed;
}
export const isActiveResource = key => !!resDef(key)?.active;
export const isKnownResource = key => !!resDef(key);
export const measureOf = key => resDef(key)?.measure || key;
export const weightOf = key => Number(resDef(key)?.weight) || 0;
export const depotCapacityFor = (type, key) => Number(resDef(key)?.capacity?.[type]) || 0;
export const unitCapacityFor = (profile, key) => {
  const d = resDef(key); if (!d) return 0;
  const basis = d.unitBasis === 'fixed' ? 1 : Number(profile?.[d.unitBasis]) || 0;
  return Math.round(basis * (Number(d.unitFactor) || 0));
};
export const unitProfileOf = unitId => {
  const node = state.layout?.nodes?.find(n=>n.type==='unit'&&n.unitId===unitId);
  return { ...(UNIT_START[unitId] || NEW_UNIT_START), ...(node?.people!==undefined?{people:node.people}:{}), ...(node?.vehicles!==undefined?{vehicles:node.vehicles}:{}) };
};

// ===== التحقق من صنف (إنشاء أو تعديل) — يرجع رمز الخطأ أو null =====
const okText = (v, max) => typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= max;
const okPair = (v, max) => v && okText(v.ar, max) && okText(v.en, max);
export function cleanCatalogItem(b, existing = null, unitIds = []) {
  const key = existing ? existing.key : b.key;
  if (!existing && (typeof key !== 'string' || !/^[a-z][a-z0-9_]{1,23}$/.test(key))) return { error: 'invalid_resource_key' };
  if (!existing && resDef(key)) return { error: 'resource_exists' };
  const pick = (k, d) => b[k] !== undefined ? b[k] : existing?.[k] ?? d;
  const item = {
    key, icon: String(pick('icon', '📦')).slice(0, 4) || '📦',
    name: pick('name', null), unit: pick('unit', null),
    measure: String(pick('measure', key)).replace(/[^a-z0-9_]/gi, '').slice(0, 24) || key,
    active: !!pick('active', true), usage: pick('usage', 'consumable'),
    consumptionGroup: pick('consumptionGroup', null),
    capacity: { main: Number(pick('capacity', {})?.main), fsb: Number(pick('capacity', {})?.fsb) },
    unitBasis: pick('unitBasis', 'people'), unitFactor: Number(pick('unitFactor', 1)), weight: Number(pick('weight', 0)),
    ...(existing?.training ? { training: existing.training } : {}),
  };
  if (!okPair(item.name, 40) || !okPair(item.unit, 30)) return { error: 'invalid_resource_name' };
  item.name = { ar: item.name.ar.trim(), en: item.name.en.trim() }; item.unit = { ar: item.unit.ar.trim(), en: item.unit.en.trim() };
  if (!['people', 'vehicles', 'fixed'].includes(item.unitBasis) || !(item.unitFactor > 0) || item.unitFactor > 1e7) return { error: 'invalid_capacity' };
  if (!(item.weight >= 0 && item.weight <= 20)) return { error: 'invalid_consumption' };
  if (!['consumable', 'maintenance'].includes(item.usage) || (item.usage === 'maintenance' && item.weight !== 0)) return { error: 'invalid_consumption' };
  if (![null, 'vehicle_fuel'].includes(item.consumptionGroup) || (item.consumptionGroup === 'vehicle_fuel' && (item.unitBasis !== 'vehicles' || item.measure !== 'liter'))) return { error: 'invalid_consumption' };
  if (!Number.isInteger(item.capacity.main) || !Number.isInteger(item.capacity.fsb) || item.capacity.fsb <= 0 || item.capacity.main > 1e10) return { error: 'invalid_capacity' };
  // التدرج: القاعدة > المركز > أكبر وحدة
  const unitCap = u => Math.round((item.unitBasis === 'fixed' ? 1 : Number(unitProfileOf(u)[item.unitBasis]) || 0) * item.unitFactor);
  const maxUnit = Math.max(0, ...unitIds.map(unitCap));
  if (!(item.capacity.main > item.capacity.fsb)) return { error: 'capacity_order', detail: { main: item.capacity.main, fsb: item.capacity.fsb } };
  if (!(item.capacity.fsb > maxUnit)) return { error: 'capacity_order', detail: { fsb: item.capacity.fsb, unit: maxUnit } };
  return { item };
}
