// شبكات الأمان بالكود حول النموذج: فحص الأرقام (verify-numbers.mjs) وتصحيحات مسودة الطلب بعد الأدابتر (request-contract.mjs). بدون نموذج.
import assert from 'node:assert/strict';
import { unverifiedNumbers, numberNote } from '../server/ai/verify-numbers.mjs';
import { validateRequestDraft } from '../server/ai/request-contract.mjs';
import { compactContext } from '../server/ai/compact.mjs';

// 1) الأرقام: الموجود في البيانات يمر (بفواصل الآلاف، وبالأرقام العربية، وبالتقريب)، والمخترع يُكشف
const evidence = '{"pos":[24.9123,46.7234],"stockPercent":{"diesel":45.3},"stockQty":{"diesel":1200},"capacity":{"diesel":2000}}';
assert.deepEqual(unverifiedNumbers('الديزل: 45.3% (1,200 لتر من ٢٬٠٠٠)', evidence), []);
assert.deepEqual(unverifiedNumbers('خط العرض 24.91، خط الطول 46.72، تقريباً 45%', evidence), []);
assert.deepEqual(unverifiedNumbers('صحيح، الديزل عندك 90%', evidence), ['90']);
assert.deepEqual(unverifiedNumbers('الطلب ORD-0042 بتاريخ 2026-10-13 الساعة 14:30، 3 وحدات', evidence), []);
assert.deepEqual(unverifiedNumbers('1,500 و 1,500 و 77.7', [evidence, 'other 1500']), ['77.7']);
assert.match(numberNote(['90'], true), /تنبيه آلي: الرقم 90 غير موجود/);
assert.match(numberNote(['90', '77'], false), /Automatic check: 90, 77 are not/);

// 2) مسودة الطلب: صنف نفاه المستخدم يُحذف، و«مو مستعجل» يصحح urgent إلى normal
const raw = (items, priority = 'urgent') => JSON.stringify({ items: items.map(([item, quantity, unit_of_measure]) => ({ item, supply_class: 'I', quantity, unit_of_measure })), priority, deadline: null });
let d = validateRequestDraft(raw([['bottled water', 100, 'liter'], ['dates', 5, 'kg']]), 'نبي 100 لتر موية وما نبي تمر، مو مستعجل').draft;
assert.deepEqual(d.items.map(i => i.item), ['bottled water']); assert.equal(d.priority, 'normal');
assert.deepEqual(d.warnings.map(w => w.code), ['negated_item_removed', 'not_urgent_corrected']);
// وحدات القياس ومعاملاتها تصل للواجهة حتى يعدّل مسؤول الوحدة الكمية ووحدتها (طبلية مياه = 1080 لتر)
assert.equal(d.items[0].perUnit.liter, 1); assert.equal(d.items[0].perUnit.pallet, 1080);
d = validateRequestDraft(raw([['bottled water', 50, 'liter'], ['rice', null, null]]), 'need 50 liters water, no rice please').draft;
assert.deepEqual(d.items.map(i => i.item), ['bottled water']); assert.deepEqual(d.missing, []);
// بدون نفي صريح أو إذا ما بقي غيره: لا يتغير شيء
d = validateRequestDraft(raw([['bottled water', 100, 'liter'], ['dates', 5, 'kg']]), 'نبي 100 لتر موية و5 كيلو تمر عاجل').draft;
assert.equal(d.items.length, 2); assert.equal(d.priority, 'urgent'); assert.deepEqual(d.warnings, []);
d = validateRequestDraft(raw([['bottled water', null, null], ['rice', 20, 'kg']]), 'لا تنسون الموية ونبي رز 20 كيلو').draft;
assert.equal(d.items.length, 2);
d = validateRequestDraft(raw([['bottled water', 100, 'liter']]), 'ما نبي موية').draft;
assert.equal(d.items.length, 1);
// بدون نص (الاستدعاء القديم): نفس السلوك السابق
d = validateRequestDraft(raw([['bottled water', 100, 'liter'], ['dates', 5, 'kg']])).draft;
assert.equal(d.items.length, 2); assert.equal(d.priority, 'urgent');

// 3) اللقطة تلتزم بالميزانية مهما كبرت البيانات (كانت 11 ألف حرف كحد أدنى مع 60 وحدة وملاحظات طويلة ← ai_context_too_long)
const long = 'قاعدة الملك عبدالعزيز الجوية الشمالية الغربية';
const big = { generatedAt: 1, viewer: { username: 'x', role: 'admin' }, scopeNote: 'Commander', simulation: {}, thresholds: {}, mainSupplyCenter: [{ id: 'HQ', code: 'HQ', name: 'HQ', pos: [24.9, 46.72] }],
  units: Array.from({ length: 60 }, (_, i) => ({ id: `U${i}`, name: `${long} ${i}`, base: long, stockPercent: { azm_diesel: 30 }, stockQty: {}, capacity: {}, inTransit: {}, pos: [24 + i / 10, 46] })),
  depots: Array.from({ length: 30 }, (_, i) => ({ id: `D${i}`, type: 'base', name: `${long} ${i}`, stockQty: {}, capacity: { azm_diesel: 1 }, inTransit: {}, pos: [25, 45] })),
  requests: Array.from({ length: 50 }, (_, i) => ({ id: `ORD-${i}`, status: 'pending', items: [], notes: 'ملاحظة طويلة '.repeat(80) })), requestCount: 50,
  recentMovements: [], recentAlerts: [], resources: [{ key: 'azm_diesel', name: { ar: 'ديزل' } }] };
for (const max of [5000, 2500, 800]) assert(JSON.stringify(compactContext(big, max)).length <= Math.max(max, 900), `snapshot over budget at ${max}`);
assert(compactContext(big, 5000).units.length > 0);

console.log('All checks passed (AI safety nets: number check, negated item removal, not-urgent correction, snapshot within budget)');
