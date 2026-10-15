// سيناريو متصفح كامل بالعربية وثلاث جلسات مستقلة (قائد، مسؤول قاعدة، مسؤول وحدة) على بيانات ومنفذ مؤقتين فقط:
// طلب بعدة موارد تشغيلية ← تعبئة جميع الموارد (لا الأربعين) ← قائد يغيّر الوسيلة ثم يقرر (بلا خصم ولا قافلة)
// ← مسؤول القاعدة يستلم الأمر ويبدأ التنفيذ ← خصم وقافلة على الخريطة والعداد ← تقدم بالمحاكاة ← تسليم مرة واحدة
// ← السجل والتقارير ← استهلاك تشغيلي فقط ← إيقاف المحاكاة ← خروج دور واحد مع بقاء الآخرين.
// يحتاج Chrome/Edge (أو AZM_BROWSER) وNode مع WebSocket المدمج. لا يقرأ data/ ولا يلمس خادم 5182.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executable = [process.env.AZM_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => p && existsSync(p));
if (!executable || typeof WebSocket === 'undefined') throw new Error('Request-cycle UI test requires Chrome/Edge (AZM_BROWSER) and Node with built-in WebSocket.');
const folder = mkdtempSync(join(tmpdir(), 'azm-cycle-ui-')), children = [], errors = [], pending = new Map(), pageLoads = new Map(), targetBySession = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, serial = 0, checks = 0;
const freePort = async () => { const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const port = s.address().port; await new Promise(r => s.close(r)); return port; };
const cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 45000);
  pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const evaluate = async (session, expression) => { await cdp('Target.activateTarget', { targetId: targetBySession.get(session) }); const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + r.exceptionDetails.exception?.description); return r.result.value; };
const until = async (session, expression, tries = 200) => { for (let i = 0; i < tries; i++) { if (await evaluate(session, expression)) return; await sleep(100); } throw new Error(`UI wait failed: ${expression}`); };
const reloadPage = async session => {
  const loaded = new Promise((resolve, reject) => { const timer = setTimeout(() => { pageLoads.delete(session); reject(new Error('Page reload timeout')); }, 45000); pageLoads.set(session, () => { clearTimeout(timer); resolve(); }); });
  await cdp('Page.reload', {}, session); await loaded;
};
const check = (name, value) => { if (!value) throw new Error(name); checks++; console.log(`ok   ${name}`); };
// إدخال قيمة في حقل React (input أو select) كما يفعل المستخدم
const setValue = (selectorExpr, value) => `(()=>{const el=${selectorExpr};const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;})()`;
try {
  const port = await freePort(), url = `http://127.0.0.1:${port}`, password = 'cycle-ui-pass';
  // ساعة تشغيلية = 60 ثانية حتى يمكن رؤية تقدم القافلة قبل وصولها
  children.push(spawn(process.execPath, [join(root, 'server.mjs')], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), AZM_DATA_DIR: join(folder, 'data'), AZM_ADMIN_PASSWORD: password, AZM_AI_PROVIDER: 'none', AZM_HOUR_MS: '60000' }, stdio: 'ignore', windowsHide: true }));
  for (let i = 0; i < 100; i++) { try { await fetch(url + '/api/me'); break; } catch { await sleep(100); } }
  const request = async (path, body, cookie, method = body ? 'POST' : 'GET') => { const r = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); if (!r.ok) throw new Error(`Fixture HTTP ${r.status} ${path} ${await r.text()}`); return { json: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] }; };
  const admin = (await request('/api/login', { username: 'admin', password })).cookie;
  await request('/api/sim', { speed: 0 }, admin);
  const unit = (await request('/api/entities', { type: 'unit', label: 'الكتيبة التجريبية', baseId: 'base', sourceId: 'base', pos: [24.0, 46.0], people: 500, vehicles: 40, fuelType: 'azm_diesel' }, admin)).json.node;
  await request('/api/users', { username: 'cy.bm', password, role: 'base_manager', baseId: 'base' }, admin);
  await request('/api/users', { username: 'cy.um', password, role: 'user', unitId: unit.unitId }, admin);
  const baseBefore = (await request('/api/state', null, admin)).json.depots.base;

  const browser = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--remote-debugging-port=0', `--user-data-dir=${join(folder, 'browser')}`, 'about:blank'], { stdio: 'ignore', windowsHide: true }); children.push(browser);
  const active = join(folder, 'browser', 'DevToolsActivePort');
  for (let i = 0; i < 150 && !existsSync(active); i++) await sleep(100);
  const [debugPort, browserPath] = readFileSync(active, 'utf8').trim().split(/\r?\n/);
  ws = new WebSocket(`ws://127.0.0.1:${debugPort}${browserPath}`);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', e => {
    const message = JSON.parse(e.data), waiter = pending.get(message.id);
    if (waiter) { pending.delete(message.id); if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Page.frameNavigated' && !message.params.frame.parentId) { const loaded = pageLoads.get(message.sessionId); if (loaded) { pageLoads.delete(message.sessionId); loaded(); } }
  });
  // ثلاث جلسات مستقلة (تبويب لكل دور بجلسة خادم خاصة به) في سياق متصفح واحد
  const { browserContextId } = await cdp('Target.createBrowserContext');
  const pages = {};
  for (const [role, username] of [['admin', 'admin'], ['base_manager', 'cy.bm'], ['user', 'cy.um']]) {
    const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true }); pages[role] = sessionId; targetBySession.set(sessionId, targetId);
    await cdp('Runtime.enable', {}, sessionId); await cdp('Page.enable', {}, sessionId); await cdp('Network.enable', {}, sessionId); await cdp('Network.setBlockedURLs', { urls: ['https://*'] }, sessionId);
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
    await cdp('Page.navigate', { url }, sessionId);
    await until(sessionId, "document.querySelector('input[autocomplete=\"username\"]') !== null");
    await evaluate(sessionId, `(()=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const [s,v] of [['input[autocomplete="username"]',${JSON.stringify(username)}],['input[type="password"]',${JSON.stringify(password)}]]){const el=document.querySelector(s);set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
    await until(sessionId, "!document.querySelector('button[type=submit]').disabled");
    await evaluate(sessionId, "document.querySelector('form').requestSubmit()");
    await until(sessionId, `document.querySelector('.role-${role} .intel-column') !== null`);
    check(`${role}: Arabic interface`, await evaluate(sessionId, "document.documentElement.lang==='ar' && document.querySelector('nav').innerText.includes('لوحة')"));
  }
  const { user, base_manager: bm, admin: ad } = pages;

  // ===== مسؤول الوحدة: طلب بعدة موارد + تعبئة جميع الموارد (لا الأربعين) =====
  await evaluate(user, "document.querySelector('.cta-request').click()");
  await until(user, "document.querySelector('.modal.pro .fill-all-btn') !== null");
  check('unit form lists 6 operational resources, not 40', await evaluate(user, "document.querySelectorAll('.modal.pro .item-check input').length === 6 && !document.querySelector('.modal.pro').innerText.includes('خوذة واقية')"));
  await evaluate(user, "document.querySelector('.modal.pro .fill-all-btn').click()");
  await until(user, "Array.from(document.querySelectorAll('.modal.pro .item-check input')).filter(i=>i.checked).length === 6");
  check('fill all selects exactly the six operational resources with room', await evaluate(user, "Array.from(document.querySelectorAll('.modal.pro .fill-quantity input')).every(q=>q.value===q.max && Number(q.value)>0)"));
  for (const i of [2, 3, 4]) await evaluate(user, `document.querySelectorAll('.modal.pro .item-check input')[${i}].click()`);
  await until(user, "Array.from(document.querySelectorAll('.modal.pro .item-check input')).filter(i=>i.checked).length === 3");
  await evaluate(user, setValue("document.querySelectorAll('.modal.pro .fill-quantity input')[0]", 2000));
  await until(user, "document.querySelectorAll('.modal.pro .fill-quantity input')[0].value === '2000'");
  check('user can edit a quantity and exclude resources', true);
  await evaluate(user, "document.querySelector('.modal.pro').requestSubmit()");
  await until(user, "document.querySelector('.request-list [data-status=\"pending\"]') !== null");
  const reqId = await evaluate(user, "document.querySelector('.request-list [data-status=\"pending\"]').dataset.requestId");
  const created = (await request('/api/state', null, admin)).json.requests.find(r => r.id === reqId);
  check('request saved once with 3 operational items and original quantity', created.items.length === 3 && created.items[0].qty === 2000 && created.items.map(i => i.resource).join() === 'azm_bottled_water,azm_mre,azm_diesel');
  check('unit card explains it awaits a base manager or commander', await evaluate(user, `document.querySelector('[data-request-id="${reqId}"] [data-stage="pending"]')?.innerText.includes('مسؤول القاعدة أو القائد')`));

  // ===== مسؤول القاعدة يرى الطلب ويملك قراره ضمن قاعدته =====
  await until(bm, `document.querySelector('.request-list [data-request-id="${reqId}"]') !== null`);
  check('base manager sees own unit decision buttons', await evaluate(bm, `!!document.querySelector('[data-request-id="${reqId}"] .approve')`));
  check('base manager approval requires source and route', await evaluate(bm, `api('/api/requests/${reqId}/approve',{method:'POST',body:{}}).then(()=>false,e=>e.code==='no_route')`));

  // ===== القائد: يغيّر الوسيلة ثم يقرر =====
  await until(ad, `document.querySelector('.request-list [data-request-id="${reqId}"]') !== null`);
  await evaluate(ad, `document.querySelector('.request-list [data-request-id="${reqId}"]').click()`);
  await until(ad, "document.querySelector('.modal .req-actions .air-btn') !== null");
  await evaluate(ad, "document.querySelector('.modal .req-actions .air-btn').click()");
  await until(ad, "document.querySelector('.modal [data-stage=\"pending_heli\"]') !== null");
  check('mode change keeps it awaiting decision with clear wording', await evaluate(ad, "document.querySelector('.modal [data-stage=\"pending_heli\"]').innerText.includes('مسؤول القاعدة أو القائد') && document.querySelectorAll('.convoy-card').length===0"));
  await evaluate(ad, setValue("document.querySelector('.modal .source-pick select')", 'base'));
  await until(ad, "document.querySelector('.modal .source-pick select').value === 'base'");
  await evaluate(ad, setValue("document.querySelector('.modal .request-current-limits input')", 1500));
  await until(ad, "document.querySelector('.modal .request-current-limits input').value === '1500' && !document.querySelector('.modal .req-actions .approve').disabled");
  check('commander decision panel explains base and emergency paths', await evaluate(ad, "document.querySelector('.modal .source-pick').innerText.includes('مسؤول القاعدة يوافق')"));
  await evaluate(ad, "document.querySelector('.modal .req-actions .approve').click()");
  await until(ad, "document.querySelector('.modal [data-stage=\"assigned\"]') !== null");
  let s = (await request('/api/state', null, admin)).json;
  check('commander decision alone deducts nothing', ['azm_bottled_water', 'azm_mre', 'azm_diesel'].every(k => s.depots.base[k] === baseBefore[k]));
  check('commander decision alone creates no convoy', await evaluate(ad, "document.querySelectorAll('.convoy-card').length===0 && document.querySelectorAll('.convoy-icon').length===0") && !s.requests.some(r => r.status === 'approved'));
  const saved = s.requests.find(r => r.id === reqId);
  check('requested 2000 / approved 1500 kept separately', saved.items[0].qty === 2000 && saved.approvedItems[0].qty === 1500 && saved.mode === 'heli');
  await evaluate(ad, "document.querySelector('.modal-close').click()");

  // ===== مسؤول القاعدة يستلم الأمر ويبدأ التنفيذ =====
  await until(bm, `document.querySelector('.exec-box [data-request-id="${reqId}"] .execute-btn') !== null`);
  check('assignment clearly shown to base manager', await evaluate(bm, `document.querySelector('.exec-box [data-request-id="${reqId}"]').innerText.includes('استلام الأمر وبدء التنفيذ')`));
  await evaluate(bm, `document.querySelector('.exec-box [data-request-id="${reqId}"] .execute-btn').click()`);
  await until(bm, `document.querySelector('[data-request-id="${reqId}"][data-status="approved"]') !== null`);
  s = (await request('/api/state', null, admin)).json;
  const moves = (await request('/api/movements?limit=200', null, admin)).json.movements;
  const dispatched = moves.filter(m => m.requestId === reqId && m.type === 'dispatch');
  check('execution deducts each item once under one operation', dispatched.length === 3 && new Set(dispatched.map(m => m.opId)).size === 1 && dispatched.every(m => m.by === 'cy.bm') && s.depots.base.azm_bottled_water === baseBefore.azm_bottled_water - 1500);
  for (const [role, page] of Object.entries(pages)) {
    await until(page, `document.querySelectorAll('.convoy-card').length >= 1 && document.querySelector('.convoy-icon') !== null`);
    check(`${role}: convoy appears on map and convoy list immediately`, await evaluate(page, "document.querySelectorAll('.convoy-card').length >= 1 && document.querySelector('.convoy-icon') !== null"));
  }
  check('simulation paused is explained on the convoy', await evaluate(user, "document.querySelector('.convoy-card').innerText.includes('المحاكاة متوقفة')"));

  // ===== التقدم بالمحاكاة ثم التسليم مرة واحدة =====
  await evaluate(ad, "Array.from(document.querySelectorAll('.speeds button')).find(b=>b.innerText==='×1').click()");
  await until(ad, "document.querySelector('.speeds button.selected')?.innerText === '×1'");
  await until(user, "(()=>{const p=Number((document.querySelector('.convoy-head span')?.innerText||'0').replace('%',''));return p>0&&p<100;})()", 300);
  check('convoy progresses with the simulation from execution time', true);
  await evaluate(ad, "Array.from(document.querySelectorAll('.speeds button')).find(b=>b.innerText==='×20').click()");
  await until(user, `document.querySelector('[data-request-id="${reqId}"][data-status="delivered"]') !== null`, 400);
  await evaluate(ad, "Array.from(document.querySelectorAll('.speeds button')).find(b=>b.title).click()");
  const afterMoves = (await request('/api/movements?limit=200', null, admin)).json.movements;
  const deliveries = afterMoves.filter(m => m.requestId === reqId && m.type === 'delivery');
  check('delivered once, executed quantities added to the unit', deliveries.length === 3 && deliveries.find(m => m.resource === 'azm_bottled_water').qty === 1500 && deliveries.every(m => Math.abs(m.to.after - m.to.before - m.qty) < .01));
  check('unit card shows delivered stage', await evaluate(user, `document.querySelector('[data-request-id="${reqId}"] [data-stage="delivered"]') !== null`));
  await sleep(2500);
  check('no second delivery after further ticks', (await request('/api/movements?limit=200', null, admin)).json.movements.filter(m => m.requestId === reqId && m.type === 'delivery').length === 3);

  // ===== السجل والتقارير =====
  const audit = await evaluate(user, `api('/api/audit?search=${reqId}&limit=100').then(d=>d.entries.filter(e=>e.requestId===${JSON.stringify(reqId)}).map(e=>e.action))`);
  check(`unit manager log shows request, mode change, decision, execution and delivery (${audit.join(',')})`, ['pending', 'air', 'assigned', 'approved', 'delivered'].every(a => audit.includes(a)));
  await evaluate(user, "Array.from(document.querySelectorAll('nav button')).find(b=>b.innerText.includes('سجل')).click()");
  await until(user, `document.querySelector('.ops-table') !== null && document.querySelector('.ops-table').innerText.includes(${JSON.stringify(reqId)})`);
  check('operations log page lists the request', true);
  const report = (await request(`/api/reports?unitId=${unit.unitId}`, null, admin)).json;
  check('report shows executed and delivered quantities', report.requests.qty.azm_bottled_water.dispatched === 1500 && report.requests.qty.azm_bottled_water.delivered === 1500);

  // مسؤول القاعدة يوافق ويرسل مباشرة من نفس الواجهة؛ لا ينتظر قرار القائد.
  const unitCookie = (await request('/api/login', {username:'cy.um',password})).cookie;
  const ownRequest = (await request('/api/requests', {mode:'truck',items:[{resource:'azm_mre',qty:5}]}, unitCookie)).json;
  await until(bm, `document.querySelector('[data-request-id="${ownRequest.id}"][data-status="pending"]') !== null`);
  await evaluate(bm, `document.querySelector('[data-request-id="${ownRequest.id}"][data-status="pending"]').click()`);
  await until(bm, "document.querySelector('.modal .source-pick select') !== null");
  await evaluate(bm, "document.querySelector('.modal .req-actions .approve').click()");
  await until(bm, `document.querySelector('.modal [data-stage="approved"]') !== null`);
  const bmDecision = (await request('/api/state', null, admin)).json.requests.find(r=>r.id===ownRequest.id);
  check('base manager UI approval dispatches directly', bmDecision.status==='approved' && bmDecision.executedBy==='cy.bm' && bmDecision.dispatched[0].qty===5);
  await evaluate(bm, "document.querySelector('.modal-close').click()");

  // ===== الاستهلاك التشغيلي فقط =====
  const consumption = (await request('/api/movements?type=consumption&limit=200', null, admin)).json.movements;
  check('consumption only for operational resources of units', consumption.length > 0 && consumption.every(m => m.from?.type === 'unit' && ['azm_bottled_water', 'azm_mre', 'azm_canned_food', 'azm_dates', 'azm_rice', 'azm_diesel'].includes(m.resource)) && !consumption.some(m => m.from.entityId === unit.id && m.resource === 'azm_gasoline'));

  // ===== خروج دور واحد مع بقاء الآخرين =====
  await evaluate(bm, "document.querySelector('.topbar .profile-btn').click()");
  await until(bm, "document.querySelector('.topbar .profile-logout') !== null");
  await evaluate(bm, "document.querySelector('.topbar .profile-logout').click()");
  await until(bm, "document.querySelector('.login-screen') !== null");
  for (const role of ['admin', 'user']) {
    await reloadPage(pages[role]);
    await until(pages[role], `document.querySelector('.role-${role} .intel-column') !== null`);
    check(`${role}: session continues after base manager logout`, await evaluate(pages[role], `api('/api/me').then(u=>u.role===${JSON.stringify(role)})`));
  }
  check('paused state visible after refresh', await evaluate(pages.admin, "document.querySelector('.speeds button.selected')?.innerText === '⏸'"));
  check('no uncaught browser exceptions', errors.length === 0);
  console.log(`All UI checks passed (${checks} request-cycle UI checks)`);
} finally {
  if (ws) ws.close();
  for (const child of children.reverse()) { child.kill(); await sleep(400); }
  for (let i = 0; i < 10; i++) { try { rmSync(folder, { recursive: true, force: true }); break; } catch { await sleep(200); } }
}
