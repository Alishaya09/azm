// ضوابط الدليل بعد نموذج الاستخراج (server/ai/request-evidence.mjs) ودمجها في validateRequestDraft. بدون نموذج، وبمجلد بيانات مؤقت.
// الحالات مأخوذة من أخطاء النموذج الحقيقية في التقييم (eval-results) ومن جمل كتبها المستخدم.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.AZM_DATA_DIR = mkdtempSync(join(tmpdir(), 'azm-evidence-'));
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { buildIndex, evidenceGuards, normText } = await import('../server/ai/request-evidence.mjs');
const { validateRequestDraft } = await import('../server/ai/request-contract.mjs');

const catalog = JSON.parse(readFileSync(join(root, 'resources/items.json'), 'utf8')).items;
const index = buildIndex(catalog);
const keyOf = new Map(); for (const r of catalog) for (const n of [r.item, ...(r.aliases?.en || [])]) keyOf.set(normText(n).trim(), r.key);
const guard = (text, items, deadline = null) => evidenceGuards(text, items.map(([item, quantity]) => ({ key: keyOf.get(normText(item).trim()), quantity })), deadline, index);
const codes = r => r.warnings.map(w => w.code);

// 1) كمية تخص صنفاً آخر: «شوالات رمل وعدد (25) كشاف» والنموذج أعطى 25 للرمل
let r = guard('إلى قسم الإمداد: نحتاج إلى شوالات رمل وعدد (25) كشاف يدوي و9 علب زيت هيدروليك في مدة أقصاها أسبوع.', [['sandbag', 25], ['flashlight', null], ['hydraulic fluid', 9]], 'within a week');
assert.deepEqual(codes(r), ['quantity_belongs_to_other_item']); assert.equal(r.items[0].quantity, null); assert.equal(r.items[2].quantity, 9); assert.equal(r.deadline, 'within a week');

// 2) الكمية ذهبت لصنف وضاع الصنف الثاني: يرجع كصنف ناقص
r = guard('نرجو تزويدنا بـ ليات رديتر، وعدد (70) وتد خلال 3 أيام.', [['radiator hose', 70]]);
assert.deepEqual(codes(r), ['quantity_belongs_to_other_item', 'possible_missing_item']);
assert.equal(r.warnings[1].key, 'azm_barrier_picket');

// 3) نفس الرقم لصنفين وهو مكتوب مرة وحدة
r = guard('صباح الخير، نطلب علب قريس، 60 خوذة وخمس جالونات petrol بكرة', [['grease', 60], ['helmet', 60], ['gasoline', 5]], 'tomorrow');
assert.ok(codes(r).includes('duplicate_quantity')); assert.equal(r.items[0].quantity, null); assert.equal(r.items[2].quantity, 5);

// 4) صنف ليس له ذكر في النص (مختلق)
r = guard('مساء الخير، أبي 2 فلاتر هوا، وكراتين ماي، طلب روتيني. نحتاجها خلال ثلاث أيام.', [['air filter', 2], ['plywood', 2]], 'within 3 days');
assert.deepEqual(codes(r), ['item_not_in_text']); assert.equal(r.items[1].needsConfirm, true);

// 5) موعد بدون أي كلمة وقت
r = guard('من السرية الثانيه: عاجل: نحتاج عشر اطقم فحمات بريك و ٤٠ كيس ارز وشكراً', [['brake pads', 10], ['rice', 40]], 'tomorrow');
assert.deepEqual(codes(r), ['deadline_not_in_text']); assert.equal(r.deadline, null);

// 6) جمل صحيحة لا تُلمس: أسماء قصيرة، أرقام بالحروف، ترقيم قوائم، رقم مكرر فعلاً في النص
for (const [text, items, deadline] of [
  ['ديزل 1000 لتر مويه 200 تر وجبه 200', [['diesel', 1000], ['bottled water', 200], ['MRE', 200]], null],
  ['ناقص وحدتنا الوحده 1 مويه 2000 لتر وبنزين 2000 لتر وزيت مكينه 200', [['bottled water', 2000], ['gasoline', 2000], ['engine oil', 200]], null],
  ['عطونا 60 علبة زيت محرك و350 كيلو رز. المطلوب توصل خلال 48 ساعة.', [['engine oil', 60], ['rice', 350]], 'within 48 hours'],
  ['نبغى 5 ليات رديتر و خمس نقالات. وشكراً', [['radiator hose', 5], ['stretcher', 5]], null],
  ['طلب امداد:\n1) ديزل: برميلين\n2) 10 علب زيت هيدروليك\nموعد التسليم: خلال اسبوع', [['diesel', 2], ['hydraulic fluid', 10]], 'within a week'],
  ['Resupply request:\n- 120 pcs combat uniforms\n- 23 cans of grease\n- 40 pairs of military boots', [['combat uniform', 120], ['grease', 23], ['combat boots', 40]], null],
]) assert.deepEqual(guard(text, items, deadline).warnings, [], text);

// 7) لا إيقاف خاطئ على بيانات التدريب والتحقق (إن وُجدت): كل الإجابات الصحيحة تمر بدون تحذير
let checked = 0;
for (const f of ['training/data/train.jsonl', 'training/data/valid.jsonl'].map(p => join(root, p)).filter(existsSync)) {
  for (const line of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line), gold = JSON.parse(row.messages.find(m => m.role === 'assistant').content);
    const res = guard(row.messages.find(m => m.role === 'user').content, gold.items.map(i => [i.item, i.quantity]), gold.deadline);
    assert.deepEqual(res.warnings, [], `${row.id}: ${JSON.stringify(res.warnings)}`); checked++;
  }
}

// 8) الدمج في validateRequestDraft: الكمية المشكوك فيها تصير ناقصة فيسأل الشات، والوحدة الغائبة تصير الوحدة الأساسية صراحة
const raw = (items, priority = 'high', deadline = null) => JSON.stringify({ items: items.map(([item, supply_class, quantity, unit_of_measure]) => ({ item, supply_class, quantity, unit_of_measure })), priority, deadline });
let d = validateRequestDraft(raw([['sandbag', 'IV', 25, 'piece'], ['flashlight', 'II', null, null], ['hydraulic fluid', 'III', 9, 'can']], null, 'within a week'),
  'إلى قسم الإمداد: نحتاج إلى شوالات رمل وعدد (25) كشاف يدوي و9 علب زيت هيدروليك في مدة أقصاها أسبوع.').draft;
assert.equal(d.items[0].quantity, null); assert.equal(d.items[0].qty, null); assert.ok(d.missing.includes('sandbag')); assert.equal(d.ready, false);
assert.ok(d.warnings.some(w => w.code === 'quantity_belongs_to_other_item' && w.resource === 'azm_sandbag'));
d = validateRequestDraft(raw([['radiator hose', 'IX', 70, 'piece']], 'high', 'within 3 days'), 'نرجو تزويدنا بـ ليات رديتر، وعدد (70) وتد خلال 3 أيام.').draft;
assert.deepEqual(d.items.map(i => i.resource), ['azm_radiator_hose', 'azm_barrier_picket']); assert.ok(d.items.every(i => i.quantity === null));
// صنف بلا ذكر في النص (مختلق) لا يمر بكميته
d = validateRequestDraft(raw([['air filter', 'IX', 2, 'piece'], ['plywood', 'IV', 2, 'sheet']], 'normal', 'within 3 days'), 'مساء الخير، أبي 2 فلاتر هوا، وكراتين ماي، طلب روتيني. نحتاجها خلال ثلاث أيام.').draft;
// والمذكور في النص («كراتين ماي») يحل محله بدون كمية، لأن الرقم 2 مكتوب مع الفلاتر لا مع الماء
assert.deepEqual([d.items[1].resource, d.items[1].quantity], ['azm_bottled_water', null]); assert.ok(d.missing.includes('bottled water')); assert.equal(d.ready, false);
// وحدة غير مسموحة للصنف: «كيس رمل» ← bag تصير piece (وحدته الوحيدة) بدل رفض الطلب كاملاً
d = validateRequestDraft(raw([['sandbag', 'IV', 25, 'bag'], ['flashlight', 'II', 25, 'piece']], null), '25 كيس رمل 25 مصباح').draft;
assert.deepEqual(d.items.map(i => [i.resource, i.quantity, i.unit]), [['azm_sandbag', 25, 'piece'], ['azm_flashlight', 25, 'piece']]);
assert.ok(d.warnings.some(w => w.code === 'unit_not_allowed'));
// صنف بأكثر من وحدة ووحدة غير مسموحة: الكمية ناقصة (لا تحويل مخمَّن)
d = validateRequestDraft(raw([['coolant', 'III', 2, 'barrel']], 'normal'), 'نبي 2 برميل سائل تبريد').draft;
assert.equal(d.items[0].quantity, null); assert.equal(d.items[0].unit, null); assert.ok(d.missing.includes('coolant'));
// اسم صنف خارج الكتالوج: يُطابق من النص بدون كمية، ولو ما فيه مقابل يبقى الخطأ القديم
d = validateRequestDraft(raw([['sandbag', 'IV', 25, 'piece'], ['lamp', 'II', 25, 'piece']], null), '25 كيس رمل 25 مصباح').draft;
assert.deepEqual(d.items.map(i => [i.resource, i.quantity]), [['azm_sandbag', 25], ['azm_flashlight', null]]);
assert.equal(validateRequestDraft(raw([['diesel', 'III', 100, 'liter'], ['laser', 'II', 1, 'piece']]), 'نبي ديزل 100 لتر وليزر').error, 'invalid_model_item');
// من تجربة الشات الحية: الوحدة المكتوبة تغلب وحدة النموذج، والكمية غير المكتوبة لا تمر، والصنف غير المذكور يُستبدل بالمذكور
d = validateRequestDraft(raw([['diesel', 'III', 1000, 'liter'], ['bottled water', 'I', 200, 'pallet'], ['MRE', 'I', 200, 'piece']], null), 'ديزل 1000 لتر مويه 200 لتر وجبه 200').draft;
assert.deepEqual(d.items.map(i => [i.resource, i.quantity, i.unit, i.qty]), [['azm_diesel', 1000, 'liter', 1000], ['azm_bottled_water', 200, 'liter', 200], ['azm_mre', 200, 'piece', 200]]);
assert.ok(d.warnings.some(w => w.code === 'unit_from_text'));
d = validateRequestDraft(raw([['bottled water', 'I', 2000, 'liter'], ['gasoline', 'III', 2000, 'liter'], ['engine oil', 'III', 20, 'liter']], null), 'ناقص مويه 2000 لتر وبنزين 2000 لتر وزيت مكينه 200').draft;
assert.equal(d.items[2].quantity, null); assert.ok(d.missing.includes('engine oil')); assert.ok(d.warnings.some(w => w.code === 'quantity_not_in_text'));
d = validateRequestDraft(raw([['sandbag', 'IV', 25, 'bag'], ['headlight bulb', 'IX', 25, 'piece']], null), '25 كيس رمل 25 مصباح').draft;
assert.deepEqual(d.items.map(i => [i.resource, i.quantity]), [['azm_sandbag', 25], ['azm_flashlight', 25]]);
d = validateRequestDraft(raw([['engine oil', 'III', 5, 'liter']], null), 'نبي 5 علب زيت محرك').draft;
assert.deepEqual([d.items[0].unit, d.items[0].qty], ['can', 20]);
d = validateRequestDraft(raw([['gasoline', 'III', 1800, 'liter']], null), 'Can you send 1,800 litres of petrol').draft;
assert.equal(d.items[0].quantity, 1800); assert.deepEqual(d.missing.filter(m => m !== 'priority'), []);
d = validateRequestDraft(raw([['brake pads', 'IX', 10, 'set'], ['rice', 'I', 40, 'bag']], 'urgent', 'tomorrow'), 'من السرية الثانيه: عاجل: نحتاج عشر اطقم فحمات بريك و ٤٠ كيس ارز وشكراً').draft;
assert.equal(d.deadline, null);
d = validateRequestDraft(raw([['bottled water', 'I', 2000, 'liter'], ['gasoline', 'III', 2000, 'liter'], ['engine oil', 'III', 200, null]], 'normal'),
  'ناقص وحدتنا الوحده 1 مويه 2000 لتر وبنزين 2000 لتر وزيت مكينه 200').draft;
assert.equal(d.items[2].unit, 'liter'); assert.equal(d.items[2].qty, 200); assert.deepEqual(d.missing, []);
assert.ok(d.warnings.some(w => w.code === 'unit_assumed_base' && w.resource === 'azm_engine_oil'));

console.log(`All checks passed (request evidence guards: quantity binding, duplicate quantity, item not in text, deadline evidence, base unit; ${checked} correct examples with no false flags)`);
