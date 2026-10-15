// ترحيل state.json للبنية الحالية — خطوة لكل إصدار:
//   v2: الأدوار الثلاثة، التبعية المثبتة، سجل المخزون والحركات.
//   v3: تبعية الوحدة للقاعدة ثابتة، ومصدر الإمداد يُختار لكل شحنة (مركز الإمداد ما عاد جزء من التبعية).
//   v4: كتالوج الموارد، المركز الرئيسي (الرياض)، وفرز الاعتمادات القديمة بلا إرسال.
// - إضافي فقط: ما يحذف أي حقل ولا يغيّر أي رصيد أو حساب أو طلب أو مسار شحنة بالطريق.
// - آمن للتكرار: كل خطوة تشتغل مرة وحدة (state.schemaVersion)، وتتخطى اللي انعمل قبل.
// - ياخذ نسخة احتياطية من الملف كما هو في data/backups/ قبل أول كتابة.
// - التبعية القديمة تُشتق مرة وحدة بالمنطق القديم (parentId صريح، وإلا الأقرب). الملتبسة تبقى بدون قاعدة
//   وتظهر للقائد لإصلاحها، وما نخمّن علاقة تعطي أحد صلاحية على قاعدة ثانية.
import { SCHEMA_VERSION } from '../config.mjs';
import { backupState, existedBefore, saveState, state } from './db.mjs';
import { DEFAULT_CATALOG, FUEL_KEYS, LEGACY_CATALOG, OPERATIONAL_FOOD, isOperationalKey, legacyDefaultName, trainingCatalog, trainingItem, syncAllUnitResources, activeKeys } from './catalog.mjs';
import { DEFAULT_LAYOUT, anyNode, capacityOf, deriveLegacyParent, ensureInventory, isDepotNode, qtyOf, setQty, setRelation, unitLegacyKeys, unitNodeOf, unitRequestable } from './hierarchy.mjs';
import { applyMovement, flushConsumption } from './ledger.mjs';
import { assignEntityCodes } from './codes.mjs';

function toV2(legacy) {
  state.trackingStartedAt ||= Date.now();
  // الخريطة الافتراضية تصير خريطة محفوظة حتى تنحفظ التبعية على نقاطها
  if (!state.layout) { state.layout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT)); state.layoutVersion = (state.layoutVersion || 0) + 1; }
  const nodes = state.layout.nodes, byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  // مصدر العلاقة: explicit (حددها المسؤول) | derived (الأقرب) | default (الخريطة الافتراضية) | ambiguous | none
  const sourceOf = d => !legacy && d.source === 'derived' ? 'default' : d.source;
  for (const n of nodes.filter(n => n.type === 'fsb' && !('baseId' in n))) {
    const d = deriveLegacyParent(n, nodes);
    setRelation(n, d.parentId); n.relationSource = sourceOf(d);
  }
  for (const n of nodes.filter(n => n.type === 'unit' && !('baseId' in n))) {
    const d = deriveLegacyParent(n, nodes), p = byId[d.parentId];
    if (p?.type === 'fsb') { setRelation(n, p.baseId || null); n.supplyId = p.id; n.relationSource = p.baseId ? sourceOf(d) : 'none'; }
    else if (p?.type === 'main') { setRelation(n, p.id); n.relationSource = sourceOf(d); }
    else { setRelation(n, null); n.relationSource = d.source; }
  }
  // سجل مخزون لكل كيان: الرصيد الحالي = الرصيد الافتتاحي لبداية التتبع (بدون أي تعديل على الرصيد)
  for (const n of nodes) if (isDepotNode(n) || n.type === 'unit') ensureInventory(n, { source: legacy ? 'migration' : 'initial', at: state.trackingStartedAt });
  // نسخة التبعية على السجلات القديمة (للفلترة حسب القاعدة) — بدون اختلاق تاريخ
  for (const r of state.requests) if (r.baseId === undefined) { const u = unitNodeOf(r.unitId); r.baseId = u?.baseId || null; r.supplyId = u?.supplyId || null; r.scopeSource = 'migration'; }
  for (const a of state.alerts) if (a.baseId === undefined) a.baseId = unitNodeOf(a.unitId)?.baseId || null;
}

function toV3() {
  const nodes = state.layout?.nodes || [], byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  for (const n of nodes) {
    if (n.type !== 'unit') continue;
    // وحدة بدون قاعدة لكن مركزها القديم له قاعدة واضحة: نستخرج القاعدة منه (غير ملتبس)
    const sp = byId[n.supplyId];
    if (!n.baseId && sp?.type === 'fsb' && byId[sp.baseId]?.type === 'main') { n.baseId = sp.baseId; n.relationSource = 'from_supply'; }
    // التبعية = القاعدة فقط؛ parentId القديم يتبعها. supplyId يبقى محفوظ كمعلومة قديمة بدون أي شرط
    if (n.baseId) n.parentId = n.baseId; else delete n.parentId;
  }
}

// v4: كتالوج الموارد + المركز الرئيسي في الرياض + فرز الاعتمادات القديمة اللي ما انرسلت أبداً
function toV4() {
  state.catalog ||= JSON.parse(JSON.stringify(LEGACY_CATALOG)); // تعريف النسخة التاريخية فقط؛ تزال من المخزون الحي في v7
  const nodes = state.layout.nodes;
  if (!nodes.some(n => n.type === 'hq')) { nodes.push({ id: 'hq-riyadh', type: 'hq', labelKey: 'map.hq', pos: [24.7136, 46.6753], createdAt: Date.now(), createdBy: 'system' }); state.layoutVersion = (state.layoutVersion || 0) + 1; }
  // اعتماد من النسخة الأولى بدون أي وقت انطلاق أو مسار أو صرف: ما هو شحنة حقيقية بالطريق ولا يقدر يوصل.
  // الحالة تبقى كما هي للتاريخ، لكن ما يُحسب بالطريق، والقائد يقدر يرجّعه للمراجعة.
  for (const r of state.requests) if (r.status === 'approved' && r.departAt == null && r.departSim == null && !r.route && !r.dispatched?.length) r.stalled = 'no_dispatch_record';
}

// نحفظ تعريف الرياض وروابطه للتاريخ فقط؛ الطلبات والحركات والأرصدة لا تتغير.
function toV5() {
  state.legacySupplySources ||= {};
  const nodes = state.layout.nodes, ids = new Set(nodes.filter(n => n.type === 'hq').map(n => n.id));
  for (const n of nodes.filter(n => ids.has(n.id))) state.legacySupplySources[n.id] ||= { node: { ...n }, links: state.layout.links.filter(l => l.from === n.id || l.to === n.id) };
  state.layout.nodes = nodes.filter(n => !ids.has(n.id));
  state.layout.links = state.layout.links.filter(l => !ids.has(l.from) && !ids.has(l.to));
  if (ids.size) state.layoutVersion = (state.layoutVersion || 0) + 1;
}

// v9: restore one fixed, unlimited headquarters node; it is a geographical
// reference for commander supply and has no finite balances.
function toV9() {
  state.layout ||= JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
  state.layout.nodes = state.layout.nodes.filter(n => n.type !== 'hq' || n.id === 'hq-riyadh');
  const hq = state.layout.nodes.find(n => n.id === 'hq-riyadh');
  if (hq) Object.assign(hq, { type: 'hq', pos: [24.90, 46.72], labelKey: 'map.hq', code: 'AZM-HQ-001', fixed: true });
  else state.layout.nodes.push({ id: 'hq-riyadh', type: 'hq', pos: [24.90, 46.72], labelKey: 'map.hq', code: 'AZM-HQ-001', fixed: true, createdBy: 'system' });
  assignEntityCodes(state.layout.nodes);
  state.layoutVersion = (state.layoutVersion || 0) + 1;
}

// الأصناف العامة متاحة فوراً، لكن كل وحدة تحتفظ بمجموعة أصنافها المستقلة.
// نحتفظ بما لها رصيد أو طلب فعلي، ولا نضيف الأربعين تلقائياً لكل وحدة قديمة.
function toV6() {
  syncTrainingCatalog();
  syncUnitResources();
}

function syncUnitResources() {
  const originalKeys = new Set(LEGACY_CATALOG.map(c => c.key));
  let changed = false;
  for (const n of state.layout.nodes.filter(n => n.type === 'unit')) {
    // An empty selection cannot be created through the UI/API. Earlier
    // packages could persist it, leaving the unit with no visible resources
    // and no simulated consumption.
    if (Array.isArray(n.allowedResources)) continue;
    const keys = new Set([...originalKeys]);
    for (const [key, qty] of Object.entries(state.stocks[n.unitId] || {})) if (Number(qty) > 0) keys.add(key);
    for (const r of state.requests.filter(r => r.unitId === n.unitId && ['pending', 'approved'].includes(r.status)))
      for (const item of r.items || [{ resource: r.resource }]) if (item.resource) keys.add(item.resource);
    n.allowedResources = [...keys].filter(k => state.catalog.some(c => c.key === k));
    changed = true;
  }
  return changed;
}

// تقاعد الأصناف العامة الأربع من الأرصدة الحالية فقط. التاريخ والطلبات لا يُمحَيان.
// كل رصيد أزيل له حركة موثقة؛ والطلبات المفتوحة على صنف متقاعد تُغلق حتى لا تصل شحنة محذوفة لاحقاً.
function toV7() {
  syncTrainingCatalog();
  const retired = new Set(LEGACY_CATALOG.map(c => c.key));
  flushConsumption();
  for (const n of state.layout.nodes.filter(n => ['main', 'fsb', 'unit'].includes(n.type))) {
    for (const key of retired) {
      const q = qtyOf(n.id, key);
      if (q > 0) applyMovement({ type: 'retirement', resource: key, qty: q, fromId: n.id, by: 'system', reason: 'catalog_v7_retirement' });
      if (n.type === 'unit') delete state.stocks[n.unitId]?.[key];
      else delete state.depots[n.id]?.[key];
    }
    if (n.type === 'unit') n.allowedResources = (n.allowedResources || []).filter(k => !retired.has(k));
  }
  for (const r of state.requests || []) if (['pending', 'approved'].includes(r.status) && (r.items || [{ resource: r.resource }]).some(i => retired.has(i.resource))) {
    // الشحنة المختلطة قد تحتوي مواداً مفصلة سبق خصمها؛ أرجعها للمصدر إن اتسع، واحفظ الباقي كغير موضوع.
    if (r.status === 'approved' && r.route?.fromId) for (const i of r.dispatched || []) {
      if (retired.has(i.resource)) continue;
      const source = anyNode(r.route.fromId), room = isDepotNode(source) ? Math.max(0, (capacityOf(source)?.[i.resource] || 0) - qtyOf(source.id, i.resource)) : 0;
      const returned = Math.min(i.qty, room);
      if (returned) applyMovement({ type: 'return', resource: i.resource, qty: returned, toId: source.id, by: 'system', requestId: r.id, reason: 'catalog_v7_cancel_mixed' });
      if (i.qty > returned) (r.unplaced ||= []).push({ resource: i.resource, qty: i.qty - returned, reason: 'catalog_v7_cancel_mixed' });
    }
    r.status = 'rejected'; r.rejectedAt = Date.now(); r.rejectionReason = 'catalog_v7_retirement';
    (r.history ||= []).push({ status: 'rejected', by: 'system', at: r.rejectedAt, note: r.rejectionReason });
  }
  for (const n of state.layout.nodes.filter(n => n.type === 'main')) for (const c of DEFAULT_CATALOG) {
    const missing = Math.max(0, (capacityOf(n)[c.key] || 0) - qtyOf(n.id, c.key));
    if (missing) applyMovement({ type: 'external_add', resource: c.key, qty: missing, toId: n.id, by: 'system', reason: 'base_initial_fill_v7' });
  }
  state.catalog = state.catalog.filter(c => !retired.has(c.key));
  for (const row of trainingCatalog()) {
    const current = state.catalog.find(c => c.key === row.key), proposed = trainingItem(row);
    if (current && !current.updatedBy) {
      const balances = state.layout.nodes.filter(n=>n.type==='unit').map(n=>[n.id,qtyOf(n.id,row.key)]);
      current.usage = proposed.usage; current.weight = proposed.weight; current.unitBasis = proposed.unitBasis; current.unitFactor = proposed.unitFactor;
      if (current.unit?.ar === row.stockUnit) current.unit.ar = proposed.unit.ar;
      for (const [id,qty] of balances) setQty(id,row.key,qty); // تثبيت الكمية الفعلية عند تغيير سعة الوحدة
    }
    else if (current && !current.usage) current.usage = current.weight > 0 ? 'consumable' : 'maintenance';
  }
  for (const stock of Object.values(state.stocks || {})) for (const key of retired) delete stock[key];
  for (const depot of Object.values(state.depots || {})) for (const key of retired) delete depot[key];
  for (const n of state.layout.nodes) if (state.inventory[n.id]) state.inventory[n.id].capacity = capacityOf(n);
  state.layoutVersion = (state.layoutVersion || 0) + 1;
}

// v8: سياسة الموارد التشغيلية + الأسماء الفصيحة + دورة قرار القائد ثم مباشرة مسؤول القاعدة.
// - الاسم العربي يتغير للفصحى فقط إذا كان لا يزال الاسم الافتراضي القديم (ما عدّله القائد يدوياً يبقى).
// - الأصناف التشغيلية السبعة تُستهلك بالمحاكاة: usage=consumable ومعدل تجريبي إن كان صفراً، وأساس السعة
//   أفراد للغذاء ومركبات للوقود. الكمية الفعلية لكل وحدة تُثبَّت عند تغيير السعة (لا تتغير أي كمية محفوظة).
// - نوع وقود الوحدة: يُستنتج فقط إذا كان مخصصاً لها نوع واحد بالضبط؛ غير ذلك يبقى غير محدد (null) للمراجعة.
// - لا يُحذف أي رصيد أو حركة أو طلب. الطلبات المعلقة لأصناف خارج السياسة تُعلَّم legacyPolicy وتبقى للقائد.
// - الشحنات بالطريق لا تُمس وتُسلَّم مرة واحدة كالمعتاد. ملخص ما تغيّر يُحفظ في state.policyV8.
function toV8(legacy) {
  syncTrainingCatalog();
  const report = { at: Date.now(), renamed: [], operationalFixed: [], fuelTypes: {}, legacyRequests: [], legacyHoldings: [] };
  const units = state.layout.nodes.filter(n => n.type === 'unit');
  for (const row of trainingCatalog()) {
    const c = state.catalog.find(x => x.key === row.key); if (!c) continue;
    if (row.nameAr && c.name?.ar === legacyDefaultName(row) && c.name.ar !== row.nameAr) { report.renamed.push({ key: row.key, from: c.name.ar, to: row.nameAr }); c.name = { ...c.name, ar: row.nameAr }; }
    if (c.training) c.training.aliases = row.aliases;
    if (!isOperationalKey(row.key)) continue;
    const changes = {}, basis = FUEL_KEYS.includes(row.key) ? 'vehicles' : 'people';
    if (c.usage !== 'consumable') { changes.usage = [c.usage || null, 'consumable']; c.usage = 'consumable'; }
    if (!(Number(c.weight) > 0)) { changes.weight = [c.weight ?? null, .25]; c.weight = .25; }
    if (c.unitBasis !== basis) {
      const balances = units.map(n => [n.id, qtyOf(n.id, row.key)]), factor = trainingItem(row).unitFactor;
      changes.unitBasis = [`${c.unitBasis}×${c.unitFactor}`, `${basis}×${factor}`];
      c.unitBasis = basis; c.unitFactor = factor;
      for (const [id, qty] of balances) setQty(id, row.key, qty);
    }
    if (Object.keys(changes).length) report.operationalFixed.push({ key: row.key, changes });
  }
  for (const n of units) {
    // تثبيت جديد: الوحدات الافتراضية تأخذ الأصناف الغذائية الخمسة فقط (بلا رصيد مختلق)، والوقود غير محدد.
    if (!legacy && Array.isArray(n.allowedResources) && !n.allowedResources.length) n.allowedResources = OPERATIONAL_FOOD.filter(k => state.catalog.some(c => c.key === k));
    if (n.fuelType === undefined) {
      const fuels = (n.allowedResources || []).filter(k => FUEL_KEYS.includes(k));
      n.fuelType = fuels.length === 1 ? fuels[0] : null;
      n.fuelTypeSource = fuels.length === 1 ? 'migration_assignment' : fuels.length ? 'migration_ambiguous' : 'migration_unknown';
    }
    report.fuelTypes[n.unitId] = { fuelType: n.fuelType, source: n.fuelTypeSource || null };
    for (const k of unitLegacyKeys(n.unitId)) { const q = qtyOf(n.id, k); if (q > 0) report.legacyHoldings.push({ unitId: n.unitId, resource: k, qty: q }); }
  }
  for (const r of state.requests || []) {
    if (r.kind === 'base' || r.status !== 'pending') continue;
    const items = r.items?.length ? r.items : [{ resource: r.resource }];
    if (items.some(i => !unitRequestable(r.unitId, i.resource))) { r.legacyPolicy = 'pre_v8'; report.legacyRequests.push(r.id); }
  }
  for (const n of state.layout.nodes) if (state.inventory[n.id]) state.inventory[n.id].capacity = capacityOf(n);
  state.policyV8 = report;
  state.layoutVersion = (state.layoutVersion || 0) + 1;
}

// Some previously packaged installations already have schema v6 but lack some
// catalog rows. Repair only missing definitions; never overwrite commander edits.
function syncTrainingCatalog() {
  state.catalog ||= [];
  let changed = false;
  for (const row of trainingCatalog()) {
    const existing = state.catalog.find(c => c.key === row.key);
    if (existing) {
      // The old manual import created inactive entries. An explicit edit has
      // updatedBy, so preserve the commander's choice in that case.
      if (existing.training && existing.active === false && !existing.updatedBy) {
        existing.active = true; changed = true;
      }
      continue;
    }
    state.catalog.push({ ...trainingItem(row), createdAt: Date.now(), createdBy: 'migration' });
    changed = true;
  }
  return changed;
}

function toV10() {
  flushConsumption();
  // إبقاء أسماء الأصناف وتصنيفاتها ومعدلات القائد وأرصدة الجهات دون تعديل.
  for (const c of state.catalog) if (c.consumptionGroup === undefined) c.consumptionGroup = FUEL_KEYS.includes(c.key) ? 'vehicle_fuel' : null;
  const units = state.layout.nodes.filter(n => n.type === 'unit');
  const before = Object.fromEntries(units.map(n => [n.unitId, (n.allowedResources || []).length]));
  syncAllUnitResources();
  state.policyV10 = { at: Date.now(), assignment: 'all_active', consumption: 'catalog', fuelDistribution: 'proportional_available_max_rate', units: units.map(n => ({ unitId: n.unitId, added: n.allowedResources.length - before[n.unitId] })) };
  state.layoutVersion = (state.layoutVersion || 0) + 1;
}

export function runMigrations() {
  const from = state.schemaVersion || 1;
  if (from >= SCHEMA_VERSION) {
    // A compatible schema number does not guarantee that an earlier package
    // included the full resource catalog. Preserve existing entries and stock.
    const missingCatalog = !state.catalog || trainingCatalog().some(row => {
      const existing = state.catalog.find(c => c.key === row.key);
      return !existing || (existing.training && existing.active === false && !existing.updatedBy);
    });
    const missingAssignments = state.layout?.nodes?.some(n => n.type === 'unit' && (!Array.isArray(n.allowedResources) || activeKeys().some(k=>!n.allowedResources.includes(k) || !(k in (state.stocks[n.unitId] || {})))));
    if (missingCatalog || missingAssignments) {
      const backup = existedBefore ? backupState('catalog-repair') : null;
      const catalogChanged = syncTrainingCatalog();
      const unitsChanged = syncUnitResources();
      const allChanged = syncAllUnitResources();
      if (catalogChanged || unitsChanged || allChanged) saveState();
      return backup;
    }
    return null;
  }
  const legacy = existedBefore, backup = legacy ? backupState(`pre-v${SCHEMA_VERSION}`) : null;
  if (from < 2) toV2(legacy);
  if (from < 3) toV3();
  if (from < 4) toV4();
  if (from < 5) toV5();
  if (from < 6) toV6();
  if (from < 7) toV7();
  if (from < 8) toV8(legacy);
  if (from < 9) toV9();
  if (from < 10) toV10();
  state.schemaVersion = SCHEMA_VERSION; state.migratedAt = Date.now();
  if (backup) state.migrationBackup = backup.split(/[\\/]/).pop();
  saveState();
  if (legacy) console.log(`AZM: data migrated v${from} → v${SCHEMA_VERSION} (backup: ${state.migrationBackup})`);
  return backup;
}
