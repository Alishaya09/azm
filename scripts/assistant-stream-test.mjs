// اختبار بث رد المساعد (NDJSON) بنموذج تجريبي يرد بصيغة OpenAI SSE وبيانات مؤقتة؛ لا يختبر جودة النموذج الحقيقي.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { assignmentFixture } from './user-assignment-test.mjs';

const sse = (res, events) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
  for (const e of events) res.write(`data: ${JSON.stringify({ choices: [{ index: 0, ...e }] })}\n\n`);
  res.end('data: [DONE]\n\n');
};
let lastBody = null;
const model = createServer(async (req, res) => {
  if (req.url === '/v1/models') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'azm-report-base' }] })); }
  let raw = ''; for await (const c of req) raw += c;
  const body = JSON.parse(raw), last = body.messages.at(-1);
  lastBody = body;
  const q = [...body.messages].reverse().find(m => m.role === 'user').content;
  // خدمة قديمة لا تدعم البث: 400 على stream ثم رد عادي
  if (q === 'NOSTREAM') {
    res.setHeader('Content-Type', 'application/json');
    if (body.stream) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'invalid_request' })); }
    return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'رد كامل بدون بث' }, finish_reason: 'stop' }] }));
  }
  // حارس القائد: رفض خاطئ ثم تصحيح، أو رفض متكرر
  const corrected = body.messages.some(m => m.role === 'system' && m.content.startsWith('Correction:'));
  if (q === 'REFUSE_ONCE' && body.stream) return sse(res, [{ delta: { content: corrected ? 'عدد الوحدات 3' : 'هذه المعلومة خارج نطاق صلاحياتك.' } }, { delta: {}, finish_reason: 'stop' }]);
  if (q === 'REFUSE_ALWAYS' && body.stream) return sse(res, [{ delta: { content: 'هذه المعلومة خارج نطاق صلاحياتك.' } }, { delta: {}, finish_reason: 'stop' }]);
  // فحص الأرقام: رقم مخترع، ورقم موجود في اللقطة (إحداثي القاعدة الرئيسية)
  if (q === 'FAKE_NUMBER' && body.stream) return sse(res, [{ delta: { content: 'الديزل في الوحدة 987654 لتر.' } }, { delta: {}, finish_reason: 'stop' }]);
  if (q === 'REAL_NUMBER' && body.stream) return sse(res, [{ delta: { content: 'القاعدة الرئيسية: خط العرض 24.9، خط الطول 46.72' } }, { delta: {}, finish_reason: 'stop' }]);
  if (!body.stream) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'مرحباً بك' }, finish_reason: 'stop' }] })); }
  if (q === 'TOOL' && last.role !== 'tool') return sse(res, [
    { delta: { content: 'تمهيد ' } },
    { delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'read_requests', arguments: '{}' } }] }, finish_reason: 'tool_calls' },
  ]);
  if (last.role === 'tool') return sse(res, [{ delta: { content: 'نتيجة ' } }, { delta: { content: 'الأداة' } }, { delta: {}, finish_reason: 'stop' }]);
  sse(res, [{ delta: { content: 'مرحباً ' } }, { delta: { content: 'بك' } }, { delta: {}, finish_reason: 'stop' }]);
});
await new Promise(r => model.listen(0, '127.0.0.1', r));
const f = await assignmentFixture({ AZM_AI_PROVIDER: 'openai', AZM_AI_MODEL: 'azm-report-base', AZM_AI_BASE_URL: `http://127.0.0.1:${model.address().port}/v1`, AZM_REQUEST_AI_PROVIDER: 'none', AZM_REPORT_AI_PROVIDER: 'none', AZM_RAG_URL: '' });
try {
  const ask = async (text, path = '/api/chats') => {
    const r = await fetch(f.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', cookie: f.admin }, body: JSON.stringify({ text }) });
    assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /x-ndjson/);
    return (await r.text()).trim().split('\n').map(l => JSON.parse(l));
  };
  // 1) بث نصي: start ثم أجزاء ثم done بالمحادثة المحفوظة
  let ev = await ask('مرحبا');
  assert.equal(ev[0].type, 'start');
  assert.deepEqual(ev.filter(e => e.type === 'delta').map(e => e.text), ['مرحباً ', 'بك']);
  const done = ev.at(-1); assert.equal(done.type, 'done'); assert.equal(done.chat.messages.at(-1).text, 'مرحباً بك');
  // هوية الحساب تصل للنموذج برسالة صريحة من الجلسة
  const account = lastBody.messages.find(m => m.role === 'system' && m.content.startsWith('Signed-in account'));
  assert(account && /Role: Commander \(admin\)/.test(account.content), account?.content);
  // 2) استدعاء أداة بعد نص تمهيدي: reset يمسح التمهيد، والإجابة النهائية تُبث بعد تنفيذ الأداة
  ev = await ask('TOOL', `/api/chats/${done.chat.id}/messages`);
  const order = ev.map(e => e.type).join(',');
  assert.match(order, /^start,delta,reset,delta,delta,done$/, order);
  assert.equal(ev.at(-1).chat.messages.at(-1).text, 'نتيجة الأداة');
  // 3) خدمة لا تدعم البث: رجوع تلقائي للطلب العادي بدون خطأ
  ev = await ask('NOSTREAM');
  assert.equal(ev.at(-1).type, 'done'); assert.equal(ev.at(-1).chat.messages.at(-1).text, 'رد كامل بدون بث');
  assert(!ev.at(-1).chat.messages.at(-1).kind);
  // 5) القائد لا يُرفض له: إعادة واحدة بتصحيح، ثم «غير متوفر» بدل الرفض المتكرر
  ev = await ask('REFUSE_ONCE');
  assert.equal(ev.at(-1).chat.messages.at(-1).text, 'عدد الوحدات 3'); assert(ev.some(e => e.type === 'reset'));
  ev = await ask('REFUSE_ALWAYS');
  assert.equal(ev.at(-1).chat.messages.at(-1).text, 'This information is not in the current data. Name the base, unit or resource as it appears in the platform.');
  // 6) الإحداثيات الحقيقية في اللقطة (القاعدة الرئيسية في الرياض)
  const snap = JSON.parse(lastBody.messages[1].content.split('\n').slice(1).join('\n'));
  const hq = snap.locations.find(l => l.type === 'main_base');
  assert.deepEqual(hq.pos, [24.9, 46.72]);
  // 7) تحقق آلي من الأرقام: الرقم المخترع يُنبَّه عليه بآخر الرد (يُبث ويُحفظ)، والرقم الموجود في البيانات بدون تنبيه
  ev = await ask('FAKE_NUMBER');
  const fake = ev.at(-1).chat.messages.at(-1).text;
  assert.match(fake, /^الديزل في الوحدة 987654 لتر\.\n\nتنبيه آلي: الرقم 987654 غير موجود في بيانات النظام/, fake);
  assert(ev.some(e => e.type === 'delta' && e.text.includes('تنبيه آلي')));
  ev = await ask('REAL_NUMBER');
  assert.equal(ev.at(-1).chat.messages.at(-1).text, 'القاعدة الرئيسية: خط العرض 24.9، خط الطول 46.72');
  // 4) بدون Accept: الرد JSON كامل كما كان
  const plain = await (await fetch(f.url + '/api/chats', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: f.admin }, body: JSON.stringify({ text: 'مرحبا' }) })).json();
  assert.equal(plain.messages.at(-1).text, 'مرحباً بك');
  console.log('All checks passed (assistant stream: NDJSON deltas, tool-call reset, non-stream fallback, plain JSON unchanged, account identity message, commander refusal guard, real coordinates in snapshot, automatic number check)');
} finally { await f.stop(); model.closeAllConnections(); await new Promise(r => model.close(r)); }
