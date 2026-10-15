// تقرير العمليات الذكي في سجل العمليات: نموذج تجريبي حتمي وبيانات مؤقتة؛ لا يختبر جودة النموذج الحقيقي.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { assignmentFixture } from './user-assignment-test.mjs';

const seen = [];
const model = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: 'report-mock' }] })); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  // الحقائق تصل نصاً جاهزاً بلغة الرد (لا JSON)؛ النموذج التجريبي يقرأ عدد العمليات منها
  const body = JSON.parse(raw), facts = body.messages[1].content, last = body.messages.at(-1);
  const total = Number((facts.match(/(?:عدد العمليات|Operations): ([\d,]+)/) || [])[1]?.replace(/,/g, ''));
  seen.push({ facts, total, size: facts.length, last: last.content, turns: body.messages.length, guide: body.messages.find(m => m.role === 'system' && m.content.startsWith('Methodology passages'))?.content || '' });
  // محاكاة نافذة سياق صغيرة: الخادم يجب أن يعيد المحاولة بأدلة أصغر
  if (last.content.includes('SMALL') && facts.length > 4000) { res.statusCode = 400; res.end(JSON.stringify({ error: 'context_too_long' })); return; }
  const tidy = last.content.includes('TIDY') ? '\n- إمداد (external_add) و(pending) два كلمة\n- النوع external_add مكشوف\n- لا توجد طلبات مرفوضة أو' : '';
  // نموذج يكتب قسم أرقام خاطئاً عمداً: الخادم يجب أن يحذفه ويضع أرقامه المحسوبة
  res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: `الملخص:\nعدد العمليات ${total}.${tidy}\nأبرز الأرقام:\n- رقم مخترع 999\nملاحظات:\n- لا شيء.\nتوصيات:\n- مراجعة الطلبات.\n- لا توجد توصيات محددة.` }, finish_reason: 'stop' }] }));
});
await new Promise(r => model.listen(0, '127.0.0.1', r));
// خدمة BGE-M3 تجريبية: ok تعيد فقرة عامة، down تفشل، leak تعيد فقرة خاصة بقاعدة أخرى (يجب رفضها)
let ragMode = 'ok', leakBase = null; const ragCalls = [];
const rag = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url === '/health') { res.end(JSON.stringify({ ok: true, model: 'BAAI/bge-m3', chunks: 12 })); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); ragCalls.push(body);
  if (ragMode === 'down') { res.statusCode = 500; res.end(JSON.stringify({ error: 'retrieval_failed' })); return; }
  const chunk = ragMode === 'leak' ? { id: 'private-b2', text: 'سر قاعدة أخرى', metadata: { baseIds: [leakBase] } } : { id: 'azm-ops-shipment-flow', text: 'BGE-M3-PASSAGE أنواع حركات المخزون', metadata: { visibility: 'all' } };
  res.end(JSON.stringify({ chunks: [chunk] }));
});
await new Promise(r => rag.listen(0, '127.0.0.1', r));
const f = await assignmentFixture({ AZM_AI_PROVIDER: 'none', AZM_REQUEST_AI_PROVIDER: 'none', AZM_REPORT_AI_PROVIDER: 'openai', AZM_REPORT_AI_MODEL: 'report-mock', AZM_REPORT_AI_BASE_URL: `http://127.0.0.1:${model.address().port}/v1`, AZM_RAG_URL: `http://127.0.0.1:${rag.address().port}` });
try {
  const { b1, b2, u1, u2 } = await f.entities();
  leakBase = b2.id;
  await f.api('/api/users', { password: f.password, username: 'ops.base', role: 'base_manager', baseId: b1.id }, f.admin);
  const manager = (await f.login('ops.base')).cookie;
  for (const u of [u1, u2]) await f.api('/api/requests', { unitId: u.unitId, mode: 'heli', items: [{ resource: 'azm_helmet', qty: 1 }] }, f.admin);
  const before = await f.get('/api/state', f.admin);
  // تقارير صفحة السجل مبنية على ما تعرضه الصفحة: الإجراءات على الطلبات والإرسال والتسليم
  const PAGE = '&types=requests,dispatch,delivery';
  assert((await f.get('/api/audit?limit=200', f.admin)).entries.some(e => !['requests', 'dispatch', 'delivery', 'chats'].includes(e.type)), 'other operations are still recorded');
  const all = (await f.get('/api/audit?limit=200' + PAGE, f.admin)).entries;
  assert(all.every(e => ['requests', 'dispatch', 'delivery'].includes(e.type)));
  assert(all.length >= 2, 'fixture produced request operations');

  // 1) حسب الفلاتر (كل الفترات): الإحصاءات تغطي كل العمليات، والنموذج يستلم نفس الأرقام
  const byFilters = (await f.api('/api/ops-reports', { filters: {}, language: 'ar' }, f.admin)).data;
  assert.equal(byFilters.stats.total, all.length);
  assert.equal(seen.at(-1).total, all.length);
  assert(byFilters.messages.at(-1).text.includes(String(all.length)) && byFilters.messages.at(-1).model === 'report-mock');
  assert(!seen.at(-1).facts.includes('password'), 'no secrets in facts');
  // أبرز الأرقام من الخادم: قسم النموذج المخترع محذوف، والقسم المحسوب قبل الملاحظات
  const reportText = byFilters.messages.at(-1).text;
  assert(!reportText.includes('999') && reportText.indexOf('أبرز الأرقام:') > reportText.indexOf('الملخص:') && reportText.indexOf('أبرز الأرقام:') < reportText.indexOf('ملاحظات:'), reportText);
  // تقرير الصفحة مبني على الطلبات والإرسال والتسليم فقط: التعبئة الافتتاحية والاستهلاك وغيرها لا تدخل
  // تقرير الصفحة مبني على الطلبات والإرسال والتسليم فقط: التعبئة الافتتاحية والاستهلاك وغيرها لا تدخل ولا تُذكر
  assert(!/تموين افتتاحي/.test(reportText) && !/تموين افتتاحي|استهلاك|صيانة|إرجاع/.test(seen.at(-1).facts), 'only requests, dispatch and delivery in the page report');
  assert(reportText.includes('مراجعة الطلبات') && !reportText.includes('لا توجد توصيات محددة'), 'contradictory "no recommendation" bullet removed');
  // RAG: فقرة BGE-M3 تصل للنموذج كمنهجية فقط، والمصدر محفوظ مع الرد، وفلتر الاسترجاع من جلسة الخادم
  assert(seen.at(-1).guide.includes('BGE-M3-PASSAGE'), 'methodology passage sent to the model');
  assert.equal(byFilters.messages.at(-1).ragSource, 'bge-m3'); assert.deepEqual(byFilters.messages.at(-1).sources, ['azm-ops-shipment-flow']);
  assert(ragCalls.at(-1).filter.role === 'admin' && ragCalls.at(-1).filter.all === true && ragCalls.at(-1).limit === 4 && /تقرير عمليات/.test(ragCalls.at(-1).question));
  assert.equal((await f.get('/api/report-ai/status', f.admin)).rag.state, 'external_connected');
  // تعطل BGE-M3 لا يُفشل التقرير: احتياط بالبحث المحلي في مرجع عزم
  ragMode = 'down';
  const fallback = (await f.api('/api/ops-reports', { filters: {}, focus: 'إرجاع' }, f.admin)).data.messages.at(-1);
  assert(!fallback.kind && fallback.ragSource === 'local' && fallback.sources.length > 0 && !seen.at(-1).guide.includes('BGE-M3-PASSAGE'));
  ragMode = 'ok';

  // 2) عملية واحدة، ثم عمليات محددة
  const one = (await f.api('/api/ops-reports', { ids: [all[0].id] }, f.admin)).data;
  assert.equal(one.stats.total, 1); assert.deepEqual(one.selection, { mode: 'ids', ids: [all[0].id] });
  const two = (await f.api('/api/ops-reports', { ids: all.slice(0, 2).map(e => e.id), focus: 'الطلبات' }, f.admin)).data;
  assert.equal(two.stats.total, 2); assert(seen.at(-1).last.includes('Focus: الطلبات'));

  // الكميات المطلوبة تُحسب لكل طلب مرة واحدة، وحالة الطلبات من آخر إجراء، والأدلة بلغة الرد بلا رموز الأنواع
  const reqReport = (await f.api('/api/ops-reports', { filters: { type: 'requests' }, focus: 'TIDY' }, f.admin)).data;
  assert.deepEqual(reqReport.stats.requested, { azm_helmet: 2 }); assert.deepEqual(reqReport.stats.requestStatus, { pending: 2 });
  const ev = seen.at(-1).facts;
  assert(ev.includes('خوذة') && ev.includes('إجراء على طلب') && ev.includes('بانتظار الموافقة 2') && !/\b(external_add|transfer|pending|requests)\b/.test(ev), 'facts use reply-language labels, no type codes');
  assert(/غير موجود في هذا التحديد: .*مرفوض/.test(ev), 'absent rejections stated explicitly');
  const reqText = reqReport.messages.at(-1).text;
  assert(!/external_add|\(pending\)|два/.test(reqText) && reqText.includes('كلمة') && /خوذة[^\n]*: 2 [^\n]*— مطلوب في الطلبات/.test(reqText), reqText);
  assert(reqText.includes('النوع إمداد من القاعدة الرئيسية مكشوف') && reqText.includes('مرفوضة.') && !/ أو$/m.test(reqText), 'bare codes worded, dangling conjunction trimmed');
  const enFacts = (await f.api('/api/ops-reports', { filters: { type: 'requests' }, language: 'en' }, f.admin), seen.at(-1).facts);
  assert(enFacts.includes('request action') && !enFacts.includes('إجراء على طلب'), 'english labels');

  // 3) فترة من تاريخ إلى تاريخ: فترة مستقبلية فارغة، وفترة معكوسة مرفوضة
  const now = Date.now();
  assert.equal((await f.api('/api/ops-reports', { filters: { from: now + 864e5, to: now + 2 * 864e5 } }, f.admin, 'POST', 400)).data.error, 'no_operations');
  await f.api('/api/ops-reports', { filters: { from: now, to: now - 1000 } }, f.admin, 'POST', 400);
  const ranged = (await f.api('/api/ops-reports', { filters: { from: now - 3600e3, to: now + 1000 } }, f.admin)).data;
  assert(ranged.stats.total >= 1 && ranged.stats.lastAt <= now + 1000);
  await f.api('/api/ops-reports', { ids: [] }, f.admin, 'POST', 400);
  await f.api('/api/ops-reports', { filters: { type: 'bogus' } }, f.admin, 'POST', 400);

  // 4) الصلاحيات: مسؤول القاعدة لا يرى عمليات القاعدة الأخرى ولا تقارير غيره
  const mine = (await f.get('/api/audit?limit=200' + PAGE, manager)).entries;
  const foreign = all.find(e => !mine.some(m => m.id === e.id));
  assert(foreign, 'an operation outside the base exists');
  assert.equal((await f.api('/api/ops-reports', { ids: [foreign.id] }, manager, 'POST', 403)).data.error, 'out_of_scope');
  assert.equal((await f.api('/api/ops-reports', { filters: { entityId: b2.id } }, manager, 'POST', 403)).data.error, 'out_of_scope');
  const managerReport = (await f.api('/api/ops-reports', { filters: {} }, manager)).data;
  assert.equal(managerReport.stats.total, mine.length);
  assert(ragCalls.at(-1).filter.role === 'base_manager' && ragCalls.at(-1).filter.all === false && ragCalls.at(-1).filter.baseIds.includes(b1.id) && !ragCalls.at(-1).filter.baseIds.includes(b2.id));
  // فقرة خاصة بقاعدة أخرى من المسترجع تُرفض ولا تصل للنموذج
  ragMode = 'leak';
  const leaked = (await f.api('/api/ops-reports', { filters: {} }, manager)).data.messages.at(-1);
  assert(leaked.ragSource === 'local' && !leaked.sources.includes('private-b2') && !seen.at(-1).guide.includes('سر قاعدة أخرى'));
  ragMode = 'ok';
  const otherRequest = all.find(e => e.type === 'requests' && e.unitId === u2.unitId)?.requestId;
  assert(otherRequest && !seen.at(-1).facts.includes(otherRequest), 'other base request absent from manager facts');
  await f.api(`/api/ops-reports/${byFilters.id}`, null, manager, 'GET', 404);
  assert.equal((await f.get('/api/ops-reports', manager)).length, 2);

  // 5) سؤال لاحق يستخدم نفس التحديد وسجل الحوار
  const follow = (await f.api(`/api/ops-reports/${byFilters.id}/messages`, { text: 'أي جهة أكثر نشاطاً؟' }, f.admin)).data;
  assert.equal(follow.messages.length, 4); assert(seen.at(-1).last.includes('أي جهة') && seen.at(-1).turns >= 5);
  assert(!follow.messages.at(-1).text.includes('تموين افتتاحي لجهات جديدة:'), 'follow-up answers are not padded with key figures');

  // 6) نافذة سياق صغيرة: إعادة المحاولة بأدلة أصغر، والأدلة دائماً ضمن الحد
  const small = (await f.api('/api/ops-reports', { filters: {}, focus: 'SMALL' }, f.admin)).data;
  assert(!small.messages.at(-1).kind, JSON.stringify(small.messages.at(-1)));
  assert(seen.every(s => s.size <= 10100), 'evidence within AZM_REPORT_AI_CONTEXT_CHARS');

  // 7) القائمة والحذف، وعدم تغيير أي رصيد أو طلب
  const list = await f.get('/api/ops-reports', f.admin);
  assert(list.length >= 5 && list.every(r => r.selection && Number.isFinite(r.total)));
  await f.api(`/api/ops-reports/${one.id}`, null, f.admin, 'DELETE');
  await f.api(`/api/ops-reports/${one.id}`, null, f.admin, 'GET', 404);
  const after = await f.get('/api/state', f.admin);
  for (const key of ['stocks', 'depots', 'requests', 'inventory']) assert.deepEqual(after[key], before[key], `${key} unchanged by ops reports`);
  assert.equal((await f.get('/api/report-ai/status', f.admin)).model, 'report-mock');
  console.log('All checks passed (ops report: filters, single/selected operations, date range, validation, base scope, private history, follow-up, context retry, read-only, BGE-M3 RAG with scope filter, local fallback, leaked chunk rejected)');
} finally { await f.stop(); for (const s of [model, rag]) { s.closeAllConnections(); await new Promise(r => s.close(r)); } }
