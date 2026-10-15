// قالب التقارير الموحّد (ReportTemplate.jsx) مع بيانات /api/ops-reports/:id/document: بيانات مؤقتة وبدون نموذج.
// يتأكد من: نطاق الحساب (مسؤول القاعدة ما يشوف طلبات قاعدة ثانية)، عدم كشف الأرصدة والمسار، تعبئة القالب ديناميكياً
// (تقرير طلب واحد وتقرير عمليات)، حذف الأقسام الفارغة وإعادة الترقيم، وتهريب النصوص.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { assignmentFixture } from './user-assignment-test.mjs';

const f = await assignmentFixture({ AZM_AI_PROVIDER: 'none', AZM_REQUEST_AI_PROVIDER: 'none', AZM_REPORT_AI_PROVIDER: 'none', AZM_RAG_URL: '' });
try {
  const { b1, b2, u1, u2 } = await f.entities();
  await f.api('/api/users', { password: f.password, username: 'tpl.base', role: 'base_manager', baseId: b1.id }, f.admin);
  const manager = (await f.login('tpl.base')).cookie;
  const dist = (a, b) => { const R = 6371, r = x => x * Math.PI / 180, h = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const req = (await f.api('/api/requests', { unitId: u1.unitId, mode: 'heli', priority: 'urgent', notes: '<img src=x onerror=alert(1)> عند البوابة', items: [{ resource: 'azm_helmet', qty: 40 }] }, f.admin)).data;
  await f.api(`/api/requests/${req.id}/approve`, { mode: 'heli', route: { fromId: b1.id, path: [b1.pos, u1.pos], km: dist(b1.pos, u1.pos) * 1.01, hours: 1 } }, f.admin);
  await f.api(`/api/requests/${req.id}/execute`, {}, f.admin);
  const other = (await f.api('/api/requests', { unitId: u2.unitId, mode: 'heli', items: [{ resource: 'azm_helmet', qty: 3 }] }, f.admin)).data;

  // 1) بيانات المستند بنطاق الحساب
  const ops = (await f.get('/api/audit?limit=100&types=requests,dispatch,delivery', f.admin)).entries;
  const single = (await f.api('/api/ops-reports', { ids: ops.filter(e => e.requestId === req.id).map(e => e.id), language: 'ar' }, f.admin)).data;
  const doc1 = await f.get(`/api/ops-reports/${single.id}/document`, f.admin);
  assert.deepEqual(doc1.requests.map(r => r.id), [req.id]); assert.equal(doc1.requestTotal, 1);
  assert(doc1.timeline.length === doc1.total && doc1.timeline.every((e, i, a) => !i || a[i - 1].at <= e.at), 'timeline in time order');
  const raw = JSON.stringify(doc1);
  assert(!/"before"|"after"|"path"/.test(raw), 'no balances or route path in the document data');
  const all = (await f.api('/api/ops-reports', { filters: {}, language: 'ar' }, f.admin)).data;
  assert.deepEqual((await f.get(`/api/ops-reports/${all.id}/document`, f.admin)).requests.map(r => r.id).sort(), [req.id, other.id].sort());
  const mine = (await f.api('/api/ops-reports', { filters: {}, language: 'ar' }, manager)).data;
  const doc2 = await f.get(`/api/ops-reports/${mine.id}/document`, manager);
  assert.deepEqual(doc2.requests.map(r => r.id), [req.id], 'base manager sees only own base requests');
  assert(!JSON.stringify(doc2).includes(other.id));
  await f.api(`/api/ops-reports/${all.id}/document`, null, manager, 'GET', 404); // تقرير غيره
  await f.api(`/api/ops-reports/${single.id}/document`, { text: 'x' }, f.admin, 'POST', 404);
  const state = await f.get('/api/state', f.admin);

  // 2) القالب بالكود الحقيقي (Babel) وترجمات الواجهة
  const babel = {}; babel.self = babel; vm.createContext(babel);
  vm.runInContext(readFileSync('vendor/babel.min.js', 'utf8'), babel);
  const load = file => babel.Babel.transform(readFileSync(file, 'utf8'), { presets: ['react'] }).code;
  const ctx = { location: { origin: 'http://azm.test' }, Intl, Date, Math, Number, String, Object, Set, JSON, console, createContext: () => null, useContext: () => null, localStorage: { getItem: () => null } };
  vm.createContext(ctx);
  vm.runInContext(`${load('src/i18n/translations.jsx')};${load('src/i18n/i18n.jsx').replace(/function LangToggle[\s\S]*$/, '')};
    var resName = (t, k) => k === 'azm_helmet' ? 'خوذة واقية' : k, resUnitName = () => 'قطعة', fmtQty = n => Number(n).toLocaleString('en-US'), nodeName = n => n.label;
    ${load('src/reports/ReportTemplate.jsx')}; this.makeT = makeT; this.dict = dict; this.build = buildOpsReportDoc; this.html = azmReportHtml;`, ctx);
  const t = ctx.makeT('ar');
  const src = readFileSync('src/reports/ReportTemplate.jsx', 'utf8');
  const used = [...[...src.matchAll(/(?<![\w.])L\('([a-zA-Z.]+)'\)/g)].map(m => `rpt.${m[1]}`), ...[...src.matchAll(/\bt\('(rpt\.[a-zA-Z.]+)'/g)].map(m => m[1]),
    ...['pending', 'reopen', 'assigned', 'approved', 'delivered', 'rejected', 'mode'].map(x => `rpt.stage.${x}`), ...['assigned', 'approved', 'rejected', 'delivered', 'reopen'].map(x => `rpt.dec.${x}`)];
  const missing = used.filter(k => !ctx.dict[k]);
  assert.deepEqual([...new Set(missing)], [], 'every template label is translated');
  const render = (report, data, lang = 'ar') => { const doc = ctx.build({ report: { ...report, selectionText: 'كل الفترات' }, data, t: ctx.makeT(lang), lang, layout: state.layout, me: { username: 'admin' } }); return { doc, html: ctx.html(doc) }; };

  const one = render(single, doc1);
  assert.equal(one.doc.title, 'تقرير طلب إمداد'); assert.equal(one.doc.status.label, t('ops.reqStatus.approved'));
  assert.match(one.html, new RegExp(req.id)); assert.match(one.html, /خوذة واقية/); assert.match(one.html, /عاجل/); assert.match(one.html, /DS-\d+/);
  assert(one.html.includes('&lt;img src=x onerror=alert(1)&gt;') && !one.html.includes('<img src=x'), 'user text is escaped');
  assert.match(one.html, /<html lang="ar" dir="rtl">/); assert.match(one.html, /RPT-\d{4}-\d{6}/); assert.match(one.html, /AZM-[0-9A-F]{4}-[0-9A-F]{4}/);
  // بدون نموذج: ملخص محسوب، وما في قسم توصيات فارغ، والأقسام مرقمة بالتسلسل
  assert.match(one.html, new RegExp(`طلب الإمداد ${req.id}`));
  assert(!one.html.includes('التوصيات'), 'empty sections are dropped');
  const nums = [...one.html.matchAll(/<span class="num">(\d+)<\/span>/g)].map(m => +m[1]);
  assert.deepEqual(nums, nums.map((_, i) => i + 1));
  assert.equal(JSON.stringify(one.doc.kpis.map(k => k.value).slice(0, 3)), JSON.stringify(['1', '40 قطعة', '100%']));

  // مع نص النموذج: الملخص والملاحظات والتوصيات في أقسامها، و«أبرز الأرقام» ما تتكرر
  const withAi = { ...all, messages: [...all.messages.slice(0, 1), { role: 'assistant', text: 'الملخص:\nملخص تجريبي.\nأبرز الأرقام:\n- رقم مخترع للنموذج\nملاحظات:\n- ملاحظة أولى.\nتوصيات:\n- توصية أولى.', at: 1 }, { role: 'user', text: 'وش المتأخر؟', at: 2 }, { role: 'assistant', text: '- لا شيء متأخر.', at: 3 }] };
  const many = render(withAi, await f.get(`/api/ops-reports/${all.id}/document`, f.admin));
  assert.equal(many.doc.title, 'تقرير العمليات'); assert.equal(many.doc.status, null);
  assert.equal(JSON.stringify(many.doc.summary), JSON.stringify(['ملخص تجريبي.']));
  for (const s of ['ملاحظة أولى.', 'توصية أولى.', 'وش المتأخر؟', 'لا شيء متأخر.', other.id, req.id]) assert(many.html.includes(s), s);
  assert(!many.html.includes('رقم مخترع للنموذج'), 'model figures section is not repeated');
  const en = render(withAi, await f.get(`/api/ops-reports/${all.id}/document`, f.admin), 'en');
  assert.match(en.html, /<html lang="en" dir="ltr">/); assert.equal(en.doc.title, 'Operations report');
  console.log('All checks passed (report template: document data in account scope without balances, single request and operations reports filled dynamically, empty sections dropped, text escaped, Arabic and English)');
} finally { await f.stop(); }
