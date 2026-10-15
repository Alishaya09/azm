// المساعد الذكي بالمكوّن الحقيقي دون متصفح: مسؤول الوحدة يكتب طلب إمداد («ابي ديزل 1000») فيصيغه المساعد في المحادثة
// (الأصناف والكميات، وسؤال عن الناقص) بدون نموذج المحادثة، وبعد «تمام» تنفتح نافذة الطلب بنفس المسودة (onDraft).
// الأسئلة («ابي اعرف كم الديزل»، «ابي احداثيات») تبقى للمساعد. القائد ومسؤول القاعدة ما يتغير عندهم شي.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const babel = {}; babel.self = babel; vm.createContext(babel);
vm.runInContext(readFileSync('vendor/babel.min.js', 'utf8'), babel);
const slots = []; let cursor = 0; const posts = [], extracts = [];
// نموذج الاستخراج الوهمي: ديزل/ماء بالكمية المكتوبة، وبدون رقم = كمية ناقصة
const fakeDraft = text => { const items = [];
  for (const [re, resource, unit] of [[/(?:ديزل|azm_diesel)(?:\s+(\d+))?/, 'azm_diesel', 'liter'], [/(?:ماء|موي[هة]?)(?:\s+(\d+))?/, 'azm_water', 'liter']]) {
    const all = [...text.matchAll(new RegExp(re, 'g'))]; if (!all.length) continue; const n = all.map(m => m[1]).filter(Boolean).at(-1);
    items.push({ resource, quantity: n ? Number(n) : null, unit: n ? unit : null, perUnit: { liter: 1 }, requestable: true }); }
  return { items, priority: /عاجل/.test(text) ? 'urgent' : null, deadline: null, missing: [], warnings: [] }; };
const ctx = { React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), Fragment: 'fragment' },
  useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
  useRef(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }); }, useEffect() {},
  useLang: () => ({ t: (k, v = {}) => k + (Object.keys(v).length ? JSON.stringify(v) : '') }), fmtDateTime: String, errText: (_, e) => e.code, AzmLogo: () => null,
  dict: { 'uom.liter': 1 }, resName: (_, k) => k,
  localStorage: { getItem: () => null, setItem() {} }, confirm: () => false, setTimeout: () => 0,
  azmTabReady: Promise.resolve(), azmAuthEpoch: 0, azmTabId: 't',
  fetch: (path, options) => { posts.push({ path, text: JSON.parse(options.body).text }); return new Promise(() => {}); },
  api: (path, o) => { if (path === '/api/ai/request-draft') { extracts.push(o.body.text); return Promise.resolve({ draft: fakeDraft(o.body.text) }); } return Promise.resolve(path === '/api/chats' ? [] : { connected: true, model: 'base' }); } };
vm.createContext(ctx);
vm.runInContext(babel.Babel.transform(readFileSync('src/assistant/Assistant.jsx', 'utf8'), { presets: ['react'] }).code, ctx);
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.children)] : [];
const tick = () => new Promise(r => setImmediate(r));
const session = me => {
  slots.length = 0; const drafts = [], props = { me, onDraft: d => drafts.push(d) }, render = () => { cursor = 0; return ctx.Assistant(props); };
  nodes(render()).find(n => n.props.className === 'ai-fab ').props.onClick();
  const send = async text => { nodes(render()).find(n => n.type === 'textarea').props.onChange({ target: { value: text } });
    nodes(render()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await tick(); await tick(); };
  // آخر رد للمساعد في المحادثة (نص الفقاعة)
  const last = () => { const ps = nodes(render()).filter(n => n.type === 'p' && n.props.dir === 'auto'); return String(ps.at(-1)?.children?.flat(Infinity).join('') ?? ''); };
  return { send, drafts, last };
};
const unit = { role: 'user', unitId: 'UNIT-04', username: 'ali' };

// 1) طلب فيه أصناف: يُصاغ في المحادثة (بدون نموذج المحادثة وبدون فتح النافذة)، و«تمام» تفتح النافذة بنفس المسودة
for (const text of ['ابي ديزل 1000', 'ابي موارد', 'نحتاج 500 لتر موية وزيت', 'نبي 20 وجبه بكره ضروري', 'ابي مواد', 'ابي مؤون', 'ابي مؤونة', 'ابي اغراض', 'ابي أغراض', 'ابي تزويد', 'نحتاج مستلزمات', 'ناقصنا ماء', 'عطني ماء 1000 لتر ووجبه 400', 'اعطني ديزل', 'ارسلوا لنا موية']) {
  const s = session(unit), before = posts.length, ex = extracts.length;
  await s.send(text);
  assert.equal(s.drafts.length, 0, `${text}: no form before confirmation`);
  assert.equal(posts.length, before, `${text}: not sent to the chat model`);
  assert.equal(extracts.length, ex + 1, `${text}: drafted by the request model`); assert.equal(extracts.at(-1), text);
}
let s = session(unit);
await s.send('عطني ماء 1000 لتر');
assert.match(s.last(), /ai\.flow\.draft/); assert.match(s.last(), /- azm_water: 1000 ai\.uom|azm_water: 1000/); assert.match(s.last(), /ai\.flow\.confirm/);
await s.send('تمام');
assert.equal(s.drafts.length, 1); assert.equal(s.drafts[0].sourceText, 'عطني ماء 1000 لتر'); assert.equal(s.drafts[0].autoExtract, false);
assert.equal(s.drafts[0].draft.items[0].quantity, 1000, 'the confirmed draft goes to the form as is');

// 1ب) طلب يبدأ باسم صنف وفيه كمية (بدون فعل طلب)، و«ناقص»، و«ناقص وحدتنا … 2000 لتر»
for (const text of ['ديزل 1000 لتر مويه 200 لتر وجبه 200', '25 كيس رمل 25 مصباح', 'ماء 500 لتر', 'ناقص مويه 2000 لتر', 'ناقص وحدتنا الوحده 1 مويه 2000 لتر وبنزين 2000 لتر']) {
  const s1 = session(unit), before = posts.length, ex = extracts.length;
  await s1.send(text);
  assert.equal(posts.length, before, `${text}: not sent to the chat model`);
  assert.equal(extracts.length, ex + 1, `${text}: drafted by the request model`);
}
// وبدون كمية أو بصيغة سؤال يبقى للمساعد
for (const text of ['ديزل', 'ديزل كم عندنا؟', 'كم ديزل 1000 لتر يكفي؟', 'وحدتنا عندها 25 كيس رمل', 'ناقص وش؟']) {
  const s1 = session(unit), before = posts.length, ex = extracts.length;
  await s1.send(text);
  assert.equal(extracts.length, ex, `${text}: not drafted`); assert.equal(posts.length, before + 1, `${text}: goes to the assistant`);
}

// 2) كمية ناقصة: يسأل «كم تحتاج من …؟»، والجواب برقم يُربط بالصنف، وبعدها «تمام»
s = session(unit);
await s.send('ابي ديزل');
assert.match(s.last(), /ai\.flow\.qty\{"res":"azm_diesel"\}/);
await s.send('1000');
assert.equal(extracts.at(-1), 'ابي ديزل، azm_diesel 1000'); assert.match(s.last(), /azm_diesel: 1000/);
await s.send('ضيف ماء 300 عاجل');
assert.match(extracts.at(-1), /ماء 300 عاجل$/); assert.match(s.last(), /azm_water: 300/); assert.match(s.last(), /priority\.urgent/);
await s.send('تمام ارسله');
assert.equal(s.drafts.length, 1); assert.equal(s.drafts[0].draft.items.length, 2);

// 3) «ابي اطلب» / «بطلب» بدون أصناف: يسأل وش تحتاج، والجواب يُصاغ
for (const text of ['ابي اطلب', 'ابي اسوي طلب', 'ابي ارفع طلب جديد', 'بطلب', 'بطلب طلب جديد']) {
  s = session(unit); const before = posts.length, ex = extracts.length;
  await s.send(text);
  assert.match(s.last(), /ai\.flow\.ask/, text); assert.equal(extracts.length, ex); assert.equal(posts.length, before); assert.equal(s.drafts.length, 0);
}
await s.send('ديزل 200'); assert.equal(extracts.at(-1), 'ديزل 200'); assert.match(s.last(), /azm_diesel: 200/);
// إلغاء، وبعده «تمام» ما تفتح شي
await s.send('الغ'); assert.match(s.last(), /ai\.flow\.cancel/);
const before = posts.length; await s.send('تمام'); assert.equal(s.drafts.length, 0); assert.equal(posts.length, before + 1, 'after cancel, chat as usual');
// سؤال أثناء الصياغة يروح للمساعد
s = session(unit); await s.send('ابي ديزل 100'); const b2 = posts.length; await s.send('كم الديزل عندي؟'); assert.equal(posts.length, b2 + 1);

// 4) الأسئلة وطلب المعلومات تبقى للمساعد
for (const text of ['ابي اعرف كم الديزل', 'ابي وضع الوحدة', 'كم الديزل؟', 'من انت', 'ابي احداثيات', 'ابي احداثيات الوحدة', 'ابي تقرير', 'ابي موقع القاعدة', 'ابي اشياء', 'عطني احاثيات القاعده', 'عطني موارد القاعده', 'ابي مخزون وحدتي', 'ناقصنا وش؟', 'ليه']) {
  s = session(unit); const before = posts.length, ex = extracts.length;
  await s.send(text);
  assert.equal(s.drafts.length, 0, text); assert.equal(extracts.length, ex, text);
  assert.equal(posts.length, before + 1, `${text}: question goes to the assistant`);
}
// 5) القائد ومسؤول القاعدة ما يتغير عندهم شي
for (const role of ['admin', 'base_manager']) {
  s = session({ role, username: 'x' }); const before = posts.length, ex = extracts.length;
  await s.send('ابي ديزل 1000');
  assert.equal(s.drafts.length, 0, role); assert.equal(extracts.length, ex); assert.equal(posts.length, before + 1, `${role}: unchanged, goes to the assistant`);
}
console.log('All checks passed (assistant: unit manager supply request is drafted in chat, asks for missing quantities, opens the request form after confirmation; questions and other roles stay in chat)');
