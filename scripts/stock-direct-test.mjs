// رصيد صنف لمسؤول الوحدة يجاوبه الخادم من لقطة وحدته (server/ai/stock-direct.mjs) بدون النموذج؛ وغير ذلك يمر للنموذج. بيانات مؤقتة.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.AZM_DATA_DIR = mkdtempSync(join(tmpdir(), 'azm-stock-'));
const { stockReply } = await import('../server/ai/stock-direct.mjs');

const unitCtx = { units: [{ id: 'UNIT-01', name: 'الوحدة الأولى', stockQty: { azm_diesel: 1200, azm_bottled_water: 0 }, capacity: { azm_diesel: 6000, azm_bottled_water: 2000 },
  stockPercent: { azm_diesel: 20, azm_bottled_water: 0 }, inTransit: { azm_diesel: 500, azm_bottled_water: 0 } }] };
const ask = (text, role = 'user', ctx = unitCtx) => stockReply({ messages: [{ role: 'user', text }] }, { role }, ctx);

let r = ask('كم الديزل عندنا؟');
assert.match(r, /الوحدة الأولى/); assert.match(r, /1,200/); assert.match(r, /6,000/); assert.match(r, /حرج/); assert.match(r, /في الطريق 500/);
r = ask('وش باقي عندي من الموية والديزل');
assert.match(r, /نافد/); assert.equal(r.split('\n').length, 3);
assert.match(ask('كم البنزين عندنا؟'), /ليس من موارد وحدتك/);
assert.match(ask('how much diesel do we have?'), /1,200/);
assert.match(ask('كم الديزل؟'), /1,200/);
// يمر للنموذج: أدوار أخرى، أسئلة كفاية/استهلاك/طلبات، رقم في السؤال، بدون صنف، أو ذكر قاعدة
for (const [text, role] of [['كم الديزل عندنا؟', 'base_manager'], ['كم الديزل عندنا؟', 'admin'], ['كم الديزل عندنا يكفي؟', 'user'], ['كم نحتاج ديزل لثلاث أيام؟', 'user'],
  ['كم الديزل عندنا بعد 3 أيام؟', 'user'], ['كم عندنا؟', 'user'], ['كم ديزل في القاعدة عندنا؟', 'user'], ['ديزل 1000 لتر', 'user']]) assert.equal(ask(text, role), null, `${role}: ${text}`);

console.log('All checks passed (stock direct reply: unit manager item balance from the unit snapshot, other roles and complex questions go to the model)');
