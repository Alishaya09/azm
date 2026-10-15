// عقد JSON بين نموذج استخراج الطلبات والتطبيق. النموذج يقترح فقط؛ لا يكتب ولا يعتمد.
import { trainingCatalog } from '../store/catalog.mjs';
import { resDef } from '../store/catalog.mjs';
import { buildIndex, evidenceGuards, mentions, quantityNearItem } from './request-evidence.mjs';

// برومبت النظام المستخدم في تدريب LoRA (train.jsonl) حرفياً. لا تعدّله إلا مع إعادة التدريب بنفس النص؛ أي اختلاف يضعف دقة الأدابتر.
export const REQUEST_SYSTEM_PROMPT = "You are a military logistics request parser. Read the supply request (Arabic or English) and return only a JSON object with this schema:\n{\"items\": [{\"item\": string, \"supply_class\": string, \"quantity\": integer or null, \"unit_of_measure\": string or null}], \"priority\": string or null, \"deadline\": string or null}\nsupply_class: I (food, water), II (clothing, equipment, tools), III (fuel, oils), IV (construction, barrier), VIII (medical), IX (repair parts).\nunit_of_measure: piece, pair, set, kit, liter, barrel, jerrycan, can, carton, pallet, box, bag, kg, roll, sheet.\npriority: urgent, high, normal.\ndeadline: today, tonight, tomorrow, tomorrow morning, within 24 hours, within 48 hours, within 3 days, within a week, next week.\nRules: write every value in English, list items in the order they appear, use null for anything the message does not state, output the JSON only.";

const priorities = { normal: 'normal', high: 'urgent', urgent: 'urgent' };
// شبكة أمان بعد الأدابتر (بدون إعادة تدريب): نص المستخدم يقول صراحة إن الطلب غير عاجل، أو إنه لا يحتاج صنفاً معيناً
const NOT_URGENT = /مو مستعجل|مب مستعجل|غير مستعجل|مو عاجل|مب عاجل|غير عاجل|ليس عاجل|ليس مستعجل|مو ضروري|مب ضروري|على راحتكم|روتيني|اعتيادي|not urgent|no rush|routine|whenever possible/i;
const escapeRe = v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function negated(text, names) {
  for (const name of names || []) {
    const n = escapeRe(name);
    if (new RegExp(`(?:^|[\\s،,.])و?(?:ما|لا|مو|مب|بدون|بلا)\\s+(?:(?:نبي|نبغى|نبغي|نريد|نحتاج|احتاج|أحتاج|ابي|أبي|محتاجين|نبيه)\\s+)?(?:ال)?${n}(?=$|[\\s،,.؟?!])`, 'i').test(text)) return true;
    if (/^[\x00-\x7f]+$/.test(name) && new RegExp(`\\b(?:no|without|don't need|do not need|don't want|do not want)\\s+(?:any\\s+)?${n}\\b`, 'i').test(text)) return true;
  }
  return false;
}
export const requestToolSchema = {
  name: 'extract_supply_request',
  description: 'Extract items and quantities from Arabic or English supply request text. Do not invent missing values.',
  parameters: { type: 'object', additionalProperties: false, required: ['items', 'priority', 'deadline'], properties: {
    items: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'object', additionalProperties: false, required: ['item', 'supply_class', 'quantity', 'unit_of_measure'], properties: {
      item: { type: 'string' }, supply_class: { type: 'string' }, quantity: { type: ['number', 'null'] }, unit_of_measure: { type: ['string', 'null'] },
    } } }, priority: { type: ['string', 'null'] }, deadline: { type: ['string', 'null'] },
  } },
};

export function validateRequestDraft(raw, text = '') {
  let payload = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { payload = JSON.parse(trimmed); } catch { return { error: 'invalid_model_json' }; }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(k=>!['items','priority','deadline'].includes(k)) || !['items','priority'].every(k=>Object.hasOwn(payload,k)) || !Array.isArray(payload.items) || !payload.items.length || payload.items.length > 10 || (payload.deadline!==undefined && payload.deadline!==null && (typeof payload.deadline!=='string'||payload.deadline.length>80))) return { error: 'invalid_model_json' };
  const normalize = v=>v.trim().toLowerCase().replace(/\s+/g,' ');
  const byName = new Map(), namesOf = new Map();
  for(const original of trainingCatalog()) {
    const live = resDef(original.key);
    const row = { ...original, supplyClass: live?.training?.supplyClass || original.supplyClass };
    const names = [row.item,...(row.aliases?.en||[]),...(row.aliases?.ar||[]),live?.name?.ar,live?.name?.en].filter(x=>typeof x==='string'&&x.trim());
    namesOf.set(row.key, [...new Set(names.map(normalize))]);
    for(const name of new Set(names.map(normalize))) { const matches=byName.get(name)||[]; if(!matches.some(x=>x.key===row.key))matches.push(row); byName.set(name,matches); }
  }
  const items = [], missing = [], warnings = [];
  if(!Object.hasOwn(payload,'deadline'))warnings.push({code:'missing_model_deadline'}); // الموعد الغائب يبقى null؛ لا نختلق موعداً.
  const seen = new Set(), unknown = [];
  for (const input of payload.items) {
    if (!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(k=>!['item','supply_class','quantity','unit_of_measure'].includes(k)) || !['item','supply_class','quantity','unit_of_measure'].every(k=>Object.hasOwn(input,k)) || typeof input.item!=='string' || (input.quantity!==null && (typeof input.quantity!=='number'||!Number.isFinite(input.quantity)||input.quantity<=0)) || (input.unit_of_measure!==null&&typeof input.unit_of_measure!=='string')) return {error:'invalid_model_json'};
    const matches = byName.get(normalize(input.item)) || [];
    if(matches.length>1)return {error:'ambiguous_model_item'};
    const row = matches[0];
    // اسم صنف خارج الكتالوج: لا نرفض الطلب كاملاً بسببه؛ نحاول نطابقه من نص المستخدم بعد الحلقة
    if (!row) { unknown.push(input); continue; }
    if (seen.has(row.key) || typeof input.supply_class!=='string' || input.supply_class.length>64) return { error: 'invalid_model_item' };
    if(input.supply_class!==row.supplyClass)warnings.push({code:'catalog_class_corrected',resource:row.key});
    seen.add(row.key);
    // كمية بدون وحدة: نأخذ وحدة المخزون الأساسية ونكتبها صراحة («200 لتر») بدل ما تبقى ناقصة، والمستخدم يصححها إذا قصد علب
    let unit = input.unit_of_measure;
    if (unit == null && input.quantity != null) { unit = Object.keys(row.perUnit).find(k => row.perUnit[k] === 1) || row.stockUnit; warnings.push({ code: 'unit_assumed_base', resource: row.key, unit }); }
    // وحدة غير مسموحة لهذا الصنف («كيس رمل» ← bag والرمل يُحسب بالحبة): صنف بوحدة وحدة تُستخدم وحدته،
    // وصنف بأكثر من وحدة تصير كميته ناقصة ويُسأل عنها (لا نخمّن تحويلاً)
    let qtyIn = input.quantity;
    if (unit != null && !Number.isFinite(row.perUnit[unit])) {
      const units = Object.keys(row.perUnit);
      warnings.push({ code: 'unit_not_allowed', resource: row.key, unit });
      if (units.length === 1) unit = units[0]; else { unit = null; qtyIn = null; }
    }
    const factor = row.perUnit[unit];
    const qty = qtyIn;
    if (unit == null || qty == null) { missing.push(row.item); items.push({ resource: row.key, item: row.item, supplyClass: row.supplyClass, modelSupplyClass: input.supply_class, quantity: qty ?? null, unit: unit ?? null, qty: null, perUnit: row.perUnit }); continue; }
    // maxPerRequest يوثّق مدى أمثلة التدريب فقط، وليس حداً تشغيلياً للطلبات.
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(factor) || !Number.isFinite(qty * factor) || !(unit in row.maxPerRequest) || qty * factor > 1e10) return { error: 'invalid_model_quantity' };
    const stockQty = Math.round(qty * factor * 1000) / 1000;
    items.push({ resource: row.key, item: row.item, supplyClass: row.supplyClass, modelSupplyClass: input.supply_class, quantity: qty, unit,
      qty: stockQty, stockUnit: row.stockUnit, availableInCatalog: !!resDef(row.key)?.active, perUnit: row.perUnit });
  }
  // أصناف أخرجها النموذج بأسماء خارج الكتالوج: نأخذ بدلها أصنافاً مذكورة في النص ولم تُستخرج، بدون كمية (يُسأل عنها).
  // إذا ما فيه صنف مذكور يقابلها نرجع الخطأ القديم (الشات يعرض «ما قدرت أصيغ الطلب») بدل ما نحذف صنفاً طلبه المستخدم بصمت.
  if (unknown.length) {
    const rows = trainingCatalog(), byKey = new Map(rows.map(r => [r.key, r]));
    const named = rows.map(r => { const live = resDef(r.key); return { ...r, aliases: { ar: [...(r.aliases?.ar || []), live?.name?.ar].filter(Boolean), en: [...(r.aliases?.en || []), live?.name?.en].filter(Boolean) } }; });
    const spare = [...new Set(mentions(String(text || ''), buildIndex(named)).map(m => m.key))].filter(k => !seen.has(k));
    if (spare.length < unknown.length) return { error: 'invalid_model_item' };
    for (const input of unknown) {
      const r = byKey.get(spare.shift()), live = resDef(r.key);
      seen.add(r.key); missing.push(r.item);
      items.push({ resource: r.key, item: r.item, supplyClass: live?.training?.supplyClass || r.supplyClass, modelSupplyClass: input.supply_class, quantity: null, unit: null, qty: null, perUnit: r.perUnit });
      warnings.push({ code: 'unknown_item_matched_from_text', resource: r.key, modelItem: String(input.item).slice(0, 60) });
    }
  }
  // صنف نفاه المستخدم («ما نبي بنزين») ويبقى صنف آخر على الأقل: يُحذف من المسودة مع تنبيه
  const said = normalize(String(text || ''));
  for (const it of [...items]) if (said && items.length > 1 && negated(said, namesOf.get(it.resource))) {
    items.splice(items.indexOf(it), 1); warnings.push({ code: 'negated_item_removed', resource: it.resource });
    const at = missing.indexOf(it.item); if (at >= 0) missing.splice(at, 1);
  }
  // ضوابط الدليل: صنف بلا ذكر في النص، كمية تخص صنفاً آخر، كمية مكررة، موعد بلا كلمة وقت
  let deadlineChecked = payload.deadline == null ? null : String(payload.deadline).slice(0, 80);
  if (said) {
    const rows = trainingCatalog(), byKey = new Map(rows.map(r => [r.key, r]));
    // أسماء الأصناف كما يعدّلها القائد في الكتالوج تُحسب دليلاً أيضاً
    const named = rows.map(r => { const live = resDef(r.key); return { ...r, aliases: { ar: [...(r.aliases?.ar || []), live?.name?.ar].filter(Boolean), en: [...(r.aliases?.en || []), live?.name?.en].filter(Boolean) } }; });
    const index = buildIndex(named), run = () => evidenceGuards(String(text), items.map(it => ({ key: it.resource, quantity: it.quantity, unit: it.unit, perUnit: it.perUnit })), deadlineChecked, index);
    let ev = run();
    // صنف بلا ذكر في النص وفيه صنف مذكور لم يُستخرج («25 مصباح» والنموذج قال مصباح السيارة): نستبدله بالمذكور ونعيد الفحص،
    // فتبقى الكمية فقط إذا كانت في نفس جزء الجملة مع الصنف المذكور
    const spare = [...new Set(mentions(String(text), index).map(m => m.key))].filter(k => !items.some(x => x.resource === k) && byKey.has(k));
    const swapped = [];
    ev.items.forEach((g, i) => {
      if (!spare.length || !ev.warnings.some(w => w.code === 'item_not_in_text' && w.key === g.key)) return;
      const r = byKey.get(spare.shift()), live = resDef(r.key), it = items[i];
      const unit = it.unit && Number.isFinite(r.perUnit[it.unit]) ? it.unit : Object.keys(r.perUnit).find(k => r.perUnit[k] === 1) || r.stockUnit;
      swapped.push({ code: 'item_replaced_from_text', resource: r.key, model: it.resource });
      Object.assign(it, { resource: r.key, item: r.item, supplyClass: live?.training?.supplyClass || r.supplyClass, unit, perUnit: r.perUnit, stockUnit: r.stockUnit, availableInCatalog: !!live?.active,
        qty: it.quantity == null ? null : Math.round(it.quantity * r.perUnit[unit] * 1000) / 1000 });
      // الكمية تنتقل مع الصنف البديل فقط إذا كانت مكتوبة معه في نفس جزء الجملة؛ غير ذلك يُسأل عنها
      if (!quantityNearItem(String(text), r.key, it.quantity, index)) { Object.assign(it, { quantity: null, qty: null }); if (!missing.includes(it.item)) missing.push(it.item); }
    });
    if (swapped.length) { warnings.push(...swapped); ev = run(); }
    ev.items.forEach((g, i) => {
      const it = items[i];
      // الوحدة المكتوبة في النص بعد الرقم («200 لتر») تغلب وحدة النموذج
      if (g.unit && g.unit !== it.unit && it.quantity != null && Number.isFinite(it.perUnit?.[g.unit])) Object.assign(it, { unit: g.unit, qty: Math.round(it.quantity * it.perUnit[g.unit] * 1000) / 1000 });
      if (!g.needsConfirm) return;                 // كل شك (صنف بلا ذكر، كمية مشكوك فيها) يصير كمية ناقصة يُسأل عنها
      Object.assign(it, { quantity: null, qty: null });
      if (!missing.includes(it.item)) missing.push(it.item);
    });
    for (const w of ev.warnings) {
      warnings.push(w.key ? { code: w.code, resource: w.key, ...(w.other ? { other: w.other } : {}) } : { code: w.code });
      // صنف مذكور في النص وكميته ذهبت لصنف آخر: نرجعه بدون كمية حتى يُسأل عنه
      if (w.code === 'possible_missing_item' && !items.some(x => x.resource === w.key) && byKey.has(w.key)) {
        const r = byKey.get(w.key), live = resDef(r.key), cls = live?.training?.supplyClass || r.supplyClass;
        items.push({ resource: r.key, item: r.item, supplyClass: cls, modelSupplyClass: null, quantity: null, unit: null, qty: null, perUnit: r.perUnit });
        missing.push(r.item);
      }
    }
    deadlineChecked = ev.deadline;
  }
  let priority = payload.priority == null ? null : priorities[payload.priority];
  if (payload.priority != null && !priority) return { error: 'invalid_model_json' };
  const deadline = deadlineChecked;
  if (priority === 'urgent' && NOT_URGENT.test(said)) { priority = 'normal'; warnings.push({ code: 'not_urgent_corrected' }); }
  if (!priority) missing.push('priority');
  return { draft: { items, priority, modelPriority: payload.priority, deadline, missing, warnings, ready: !missing.length && items.every(x => x.availableInCatalog && Number.isInteger(x.qty)) } };
}
