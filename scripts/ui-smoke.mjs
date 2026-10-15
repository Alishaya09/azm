// اختبار متصفح اختياري بلا حزم: Chrome/Edge وNode مع WebSocket؛ بيانات وجلسات مؤقتة فقط.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';

// الطلبات محفوظة في قاعدة الوحدة، وليس في الفهرس المركزي.
const persistedUiRequest = (folder, unit, id) => {
  const db = new DatabaseSync(join(folder, 'data', 'entities', Buffer.from(unit.id).toString('hex') + '.sqlite'));
  try { return JSON.parse(db.prepare('SELECT payload FROM requests WHERE id = ?').get(id).payload); }
  finally { db.close(); }
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executable = [process.env.AZM_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => p && existsSync(p));
if (!executable || typeof WebSocket === 'undefined') throw new Error('UI smoke requires Chrome/Edge (AZM_BROWSER) and Node with built-in WebSocket.');
const folder = mkdtempSync(join(tmpdir(), 'azm-ui-')), children = [], errors = [], pending = new Map(), pageLoads = new Map(), targetBySession = new Map(), statePolls = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, serial = 0;
const freePort = async () => { const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const port = s.address().port; await new Promise(r => s.close(r)); return port; };
const cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 45000);
  pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const evaluate = async (session, expression) => { if (targetBySession.has(session)) await cdp('Target.activateTarget', { targetId: targetBySession.get(session) }); const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + r.exceptionDetails.exception?.description); return r.result.value; };
const until = async (session, expression) => { for (let i = 0; i < 150; i++) { if (await evaluate(session, expression)) return; await sleep(100); } throw new Error(`UI wait failed: ${expression}`); };
const reloadPage = async session => {
  const loaded = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pageLoads.delete(session); reject(new Error('Page reload timeout')); }, 45000);
    pageLoads.set(session, () => { clearTimeout(timer); resolve(); });
  });
  await cdp('Page.reload', {}, session); await loaded;
};
const check = (name, value) => { if (!value) throw new Error(name); console.log(`ok   ${name}`); };
try {
  const port = await freePort(), url = `http://127.0.0.1:${port}`, adminPassword = 'ui-temporary-pass';
  const server = spawn(process.execPath, [join(root, 'server.mjs')], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), AZM_DATA_DIR: join(folder, 'data'), AZM_ADMIN_PASSWORD: adminPassword, AZM_AI_PROVIDER: 'none', AZM_HOUR_MS: '600000' }, stdio: 'ignore', windowsHide: true }); children.push(server);
  for (let i = 0; i < 100; i++) { try { await fetch(url + '/api/me'); break; } catch { await sleep(100); } }
  const request = async (path, body, cookie, method = body ? 'POST' : 'GET') => { const r = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); if (!r.ok) throw new Error(`Fixture HTTP ${r.status} ${path}`); return { json: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] }; };
  const admin = (await request('/api/login', { username: 'admin', password: adminPassword })).cookie;
  await request('/api/users', { username: 'ui.bm', password: adminPassword, role: 'base_manager', baseId: 'base' }, admin);
  // أصناف v7: الديزل بسعة ثابتة 18000 لتر للوحدة وبلا استهلاك محاكى حتى تبقى الأرقام ثابتة أثناء الفحص
  const zero = {}, FUEL = 'azm_diesel';
  await request(`/api/catalog/${FUEL}`, { unitBasis: 'fixed', unitFactor: 18000, weight: 0, consumptionGroup: null }, admin, 'PUT');
  // الوحدة الجديدة تستلم 5% من سعة كل صنف تشغيلي: 900 لتر ديزل من 18000
  const own = (await request('/api/entities', { type: 'unit', label: 'UI Own Unit', baseId: 'base', pos: [24.8, 46.7], fuelType: FUEL }, admin)).json.node;
  await request('/api/users', { username: 'ui.um', password: adminPassword, role: 'user', unitId: own.unitId }, admin);
  await request('/api/entities', { type: 'unit', label: 'UI Hidden Sibling', baseId: 'base', pos: [24.9, 46.7], opening: zero }, admin);
  const foreignBase = (await request('/api/entities', { type: 'main', label: 'UI Foreign Base', pos: [26.4, 50.1], opening: zero }, admin)).json.node;
  const foreignUnit = (await request('/api/entities', { type: 'unit', label: 'UI Foreign Unit', baseId: foreignBase.id, pos: [26.5, 50.1], opening: zero }, admin)).json.node;
  const um = (await request('/api/login', { username: 'ui.um', password: adminPassword })).cookie;
  const normal = (await request('/api/requests', { mode: 'heli', priority: 'normal', items: [{ resource: FUEL, qty: 100 }] }, um)).json;
  const emergency = (await request('/api/requests', { mode: 'heli', priority: 'emergency', items: [{ resource: FUEL, qty: 100 }] }, um)).json;
  await request('/api/depots/base/transfer', { to: 'fsb-1', resource: FUEL, qty: 1000 }, admin);
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
    if (message.method === 'Network.requestWillBeSent' && message.params.request.url.endsWith('/api/state')) {
      const row = statePolls.get(message.sessionId) || { count: 0, ids: new Set() };
      row.count++; row.ids.add(message.params.request.headers['X-Azm-Tab']); statePolls.set(message.sessionId, row);
    }
  });
  const pages = {}, tabChats = {};
  // تبويبات عادية داخل ملف واحد ومخزن كوكي واحد، وليست سياقات معزولة.
  const { browserContextId } = await cdp('Target.createBrowserContext');
  for (const [role, username] of [['admin', 'admin'], ['base_manager', 'ui.bm'], ['user', 'ui.um']]) {
    const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true }); pages[role] = sessionId; targetBySession.set(sessionId, targetId);
    await cdp('Runtime.enable', {}, sessionId); await cdp('Page.enable', {}, sessionId);
    if (process.env.AZM_UI_DISABLE_LOCKS === '1') await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(navigator, 'locks', {value:undefined})" }, sessionId);
    await cdp('Network.enable', {}, sessionId); await cdp('Network.setBlockedURLs', { urls: ['https://*'] }, sessionId);
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
    await cdp('Page.navigate', { url }, sessionId);
    await until(sessionId, "document.querySelector('.login-screen, .login, form') !== null");
    await evaluate(sessionId, `(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      for (const [selector, value] of [['input[autocomplete="username"]', ${JSON.stringify(username)}], ['input[type="password"]', ${JSON.stringify(adminPassword)}]]) {
        const input = document.querySelector(selector); set.call(input, value); input.dispatchEvent(new Event('input', {bubbles:true}));
      }
    })()`);
    await until(sessionId, "!document.querySelector('button[type=submit]').disabled");
    await evaluate(sessionId, "document.querySelector('form').requestSubmit()");
    await until(sessionId, `document.querySelector('.role-${role} .request-list .request') !== null`);
    check(`${role}: page rendered with normal and emergency requests`, await evaluate(sessionId, "document.querySelectorAll('.request-list .priority-normal').length > 0 && document.querySelectorAll('.request-list .priority-emergency').length > 0"));
    check(`${role}: HQ map visibility by role`, await evaluate(sessionId, `document.querySelectorAll('.node.hq').length === ${role === 'user' ? 0 : 1}`));
    if (role === 'admin') check('commander can open source chooser even when proposed depot is empty', await evaluate(sessionId, "Array.from(document.querySelectorAll('.request-list button.approve')).every(b=>!b.disabled)"));
    if (role === 'user') check('unit: no request decision controls', await evaluate(sessionId, "document.querySelectorAll('.request-list button.approve,.request-list button.reject,.request-list button.air-btn').length === 0"));
    if (role === 'base_manager') check('base manager: own unit request decision controls', await evaluate(sessionId, "document.querySelectorAll('.request-list button.approve').length > 0"));
    if (role === 'user') check('unit UI hides sibling and other unit IDs', await evaluate(sessionId, "!document.body.innerText.includes('UI Hidden Sibling') && !document.body.innerText.includes('UNIT-01')"));
    if (role === 'user') {
      await evaluate(sessionId, "document.querySelector('.cta-request').click()");
      await until(sessionId, "document.querySelector('.modal.pro .fill-quantity input')!==null");
      // 18000 − 900 رصيد − 200 بطلبين معلقين؟ لا: المعلق لا يُحجز؛ المحجوز فقط ما وافق عليه القائد
      check('unit full computes 18000 from zero physical stock', await evaluate(sessionId, "(()=>{const q=Array.from(document.querySelectorAll('.modal.pro .fill-quantity input')).find(q=>q.getAttribute('aria-label')===resName(makeT(CURRENT_LANG),'azm_diesel'));return q.value==='18000' && q.max==='18000'})()"));
      await evaluate(sessionId, "(()=>{const q=Array.from(document.querySelectorAll('.modal.pro .fill-quantity input')).find(q=>q.getAttribute('aria-label')===resName(makeT(CURRENT_LANG),'azm_diesel'));Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(q,'500');q.dispatchEvent(new Event('input',{bubbles:true}))})()");
      await until(sessionId, "Array.from(document.querySelectorAll('.modal.pro .fill-quantity input')).some(q=>q.value==='500')");
      await evaluate(sessionId, "Array.from(document.querySelectorAll('.modal.pro .fill-quantity input')).find(q=>q.getAttribute('aria-label')===resName(makeT(CURRENT_LANG),'azm_diesel')).parentElement.querySelector('button.fill').click()");
      await until(sessionId, "Array.from(document.querySelectorAll('.modal.pro .fill-quantity input')).some(q=>q.value==='18000')");
      check('unit can override quantity manually then restore full', true);
      await evaluate(sessionId, "Array.from(document.querySelectorAll('.modal.pro button')).find(b=>b.textContent===makeT(CURRENT_LANG)('req.fillAll')).click()");
      check('fill all selects every assigned resource with room', await evaluate(sessionId, "Array.from(document.querySelectorAll('.modal.pro .item-check input')).every(q=>q.disabled||q.checked) && Array.from(document.querySelectorAll('.modal.pro .fill-quantity input')).every(q=>q.disabled||q.value===q.max)"));
      await evaluate(sessionId, "document.querySelector('.modal.pro .item-check input:checked').click()");
      check('fill all permits removing a resource before submission', await evaluate(sessionId, "Array.from(document.querySelectorAll('.modal.pro .item-check input')).some(q=>!q.disabled&&!q.checked)"));
      await evaluate(sessionId, "document.querySelector('.modal-close').click()");
    }
    await evaluate(sessionId, "document.querySelectorAll('nav button')[1].click()");
    await until(sessionId, "document.querySelector('.db-page') !== null");
    check(`${role}: depot page has correct supply access`, await evaluate(sessionId, role === 'admin' ? "document.querySelector('.db-actions button:nth-child(2)') !== null && document.querySelector('.db-hq') !== null" : "document.querySelector('.db-hq') === null && document.querySelectorAll('.db-actions button').length <= 1"));
  }
  const selectors = [];
  for (const session of Object.values(pages)) selectors.push(await evaluate(session, "sessionStorage.getItem('azm-tab-id')"));
  check('three ordinary tabs have distinct selectors in one browser context', new Set(selectors).size === 3);
  // نترك التحديث التلقائي يعمل بعد آخر دخول، ثم نختبر كل API من التبويب نفسه.
  await sleep(3500);
  for (const [role, session] of Object.entries(pages)) {
    console.log(`Testing ${role}: tab APIs and reload`);
    const scoped = await evaluate(session, `(async () => {
      const me = await api('/api/me'), state = await api('/api/state'), report = await api('/api/reports');
      const chat = await api('/api/chats', {method:'POST',body:{text:'tab-isolation-check'}});
      const list = await api('/api/chats');
      return {role:me.role, stateRole:state.user.role, units:Object.keys(state.stocks), depots:Object.keys(state.depots), nodes:state.layout.nodes.filter(n=>n.type==='unit').map(n=>n.unitId), reportUnits:report.entities.filter(n=>n.type==='unit').map(n=>n.unitId), chatId:chat.id, chats:list.map(c=>c.id)};
    })()`);
    check(`${role}: APIs retain tab identity after all logins and polling`, scoped.role === role && scoped.stateRole === role);
    const polled = statePolls.get(session);
    check(`${role}: automatic polling uses this tab selector`, polled?.count >= 2 && polled.ids.size === 1 && polled.ids.has(await evaluate(session, "sessionStorage.getItem('azm-tab-id')")));
    check(`${role}: map and reports contain only scoped units`, scoped.nodes.length === scoped.units.length && scoped.reportUnits.every(id => scoped.units.includes(id)) && (role !== 'user' || scoped.units.length === 1 && scoped.depots.length === 0 && scoped.units[0] === own.unitId));
    check(`${role}: foreign base unit follows role scope`, role === 'admin' ? scoped.units.includes(foreignUnit.unitId) : !scoped.units.includes(foreignUnit.unitId) && !scoped.reportUnits.includes(foreignUnit.unitId));
    tabChats[role] = scoped.chatId;
    await reloadPage(session);
    await until(session, `document.querySelector('.role-${role} .request-list .request') !== null`);
    check(`${role}: refresh preserves tab account`, await evaluate(session, `api('/api/me').then(u=>u.role===${JSON.stringify(role)})`));
    // نرجع لشاشة المستودعات حتى تبقى فحوص الواجهة السابقة كما هي.
    await evaluate(session, "document.querySelectorAll('nav button')[1].click()");
    await until(session, "document.querySelector('.db-page') !== null");
  }
  const adminPage = pages.admin;
  await evaluate(adminPage, "document.querySelector('.db-actions button:nth-child(2)').click()");
  await until(adminPage, "document.querySelector('.modal .stock-add') !== null");
  check('commander virtual supply form renders with base selector and reason', await evaluate(adminPage, "document.querySelector('.modal select').options.length > 0 && document.querySelector('.modal input[maxlength=\"300\"]') !== null"));
  await evaluate(adminPage, "document.querySelector('.stock-add input[type=checkbox]:not(:disabled)').click()");
  check('supply defaults to available room with editable quantity and full button', await evaluate(adminPage, "(()=>{const q=document.querySelector('.stock-add .fill-quantity input:not(:disabled)');return Number(q.value)>0 && q.value===q.max && document.querySelector('.stock-add .fill.active')!==null && document.querySelector('.stock-room-summary')!==null})()"));
  await evaluate(adminPage, "document.querySelector('.modal-close').click(); document.querySelectorAll('nav button')[0].click()");
  await until(adminPage, "document.querySelector('.request-list') !== null");
  await evaluate(adminPage, `Array.from(document.querySelectorAll('.request')).find(e=>e.innerText.includes(${JSON.stringify(normal.id)})).click()`);
  await until(adminPage, "document.querySelector('.source-pick select') !== null");
  check('commander source chooser contains real depots only and suggests supply point', await evaluate(adminPage, "!Array.from(document.querySelector('.source-pick select').options).some(o=>o.value==='hq-riyadh') && document.querySelector('.source-pick select').value.startsWith('fsb-')"));
  await evaluate(adminPage, "document.querySelector('.modal-close').click()");
  for (const [record, action] of [[normal, 'approve'], [emergency, 'reject']]) {
    await evaluate(adminPage, `if(!document.querySelector('.map-requests [data-request-id="${record.id}"]')) Array.from(document.querySelectorAll('.node.unit')).find(n=>n.textContent.trim()===${JSON.stringify(own.unitId.slice(-2))}).click()`);
    await until(adminPage, `document.querySelector('.map-requests [data-request-id="${record.id}"]') !== null`);
    await evaluate(adminPage, `document.querySelector('.map-requests [data-request-id="${record.id}"]').click()`);
    await until(adminPage, "document.querySelector('.req-actions') !== null");
    if (action === 'approve') {
      // مصدر له رصيد فعلي في تجهيز الاختبار، لا مركز مقترح فارغ.
      await evaluate(adminPage, "(()=>{const e=document.querySelector('.source-pick select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'fsb-1');e.dispatchEvent(new Event('change',{bubbles:true}))})()");
      await until(adminPage, "document.querySelector('.source-pick select').value==='fsb-1'");
      check('commander sees current destination and source limits', await evaluate(adminPage, "document.querySelector('.request-current-limits .stock-room-summary')!==null && Number(document.querySelector('.request-current-limits input').max)>0"));
      await evaluate(adminPage, "(()=>{const q=document.querySelector('.request-current-limits input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(q,'50');q.dispatchEvent(new Event('input',{bubbles:true}))})()");
      await until(adminPage, "document.querySelector('.request-current-limits input').value === '50'");
    }
    await evaluate(adminPage, `document.querySelector('.req-actions .${action}').click()`);
    if (action === 'reject') {
      await until(adminPage, "document.querySelector('.reject-box .danger') !== null");
      await evaluate(adminPage, "document.querySelector('.reject-box .danger').click()");
    }
    // v8: موافقة القائد = «معتمد — بانتظار مباشرة مسؤول القاعدة» بلا خصم؛ المباشرة لاحقاً من مسؤول القاعدة
    const status = action === 'approve' ? 'assigned' : 'rejected';
    // يخرج من قائمة «بانتظار القرار»؛ المعتمد ينتقل لقائمة القائد «بانتظار مباشرة مسؤول القاعدة»
    await until(adminPage, `!document.querySelector('.request-list:not(.assigned-list) [data-request-id="${record.id}"]')`);
    if (action === 'approve') check('approved request listed as awaiting base manager execution', await evaluate(adminPage, `document.querySelector('.assigned-list [data-request-id="${record.id}"] [data-stage="assigned"]') !== null`));
    if (action === 'reject') await evaluate(adminPage, "document.querySelector('.modal-close').click()");
    for (const role of ['base_manager', 'user']) {
      const page = pages[role];
      await evaluate(page, "document.querySelectorAll('nav button')[0].click()");
      if (action === 'reject' && role === 'base_manager') {
        await until(page, `api('/api/state').then(s=>s.requests.find(r=>r.id===${JSON.stringify(record.id)})?.status==='rejected')`);
        check('base manager rejected request leaves the pending decision list', await evaluate(page, `!document.querySelector('.request-list [data-request-id="${record.id}"]')`));
      } else await until(page, `document.querySelector('.request-list [data-request-id="${record.id}"][data-status="${status}"]') !== null`);
      check(`${role}: map ${action} synchronized and retained in history`, await evaluate(page, `api('/api/state').then(s=>s.requests.find(r=>r.id===${JSON.stringify(record.id)})?.status===${JSON.stringify(status)})`));
    }
    check(`map ${action} updates persisted request`, persistedUiRequest(folder, own, record.id)?.status === status);
    if (action === 'approve') {
      const saved=persistedUiRequest(folder, own, record.id);
      check('map approval retains requested 100, approves commander edited 50, dispatches nothing yet', saved.items[0].qty===100 && saved.approvedItems[0].qty===50 && !saved.dispatched);
      // مسؤول القاعدة يستلم الأمر ويبدأ التنفيذ من لوحته
      await until(pages.base_manager, `document.querySelector('.exec-box [data-request-id="${record.id}"] .execute-btn') !== null`);
      await evaluate(pages.base_manager, `document.querySelector('.exec-box [data-request-id="${record.id}"] .execute-btn').click()`);
      await until(pages.base_manager, `Array.from(document.querySelectorAll('.convoy-card .convoy-head b')).some(e=>e.textContent===${JSON.stringify(record.id)})`).catch(async error=>{console.error('Execution diagnostics',await evaluate(pages.base_manager,`api('/api/state').then(s=>{const r=s.requests.find(r=>r.id===${JSON.stringify(record.id)});return {status:r.status,blocked:r.executionBlocked,source:r.route?.fromId,error:document.querySelector('.form-error')?.innerText};})`));throw error;});
      const executed=persistedUiRequest(folder, own, record.id);
      check('base manager execution dispatches the approved 50 once', executed.status==='approved' && executed.dispatched[0].qty===50 && executed.executedBy==='ui.bm');
    }
  }
  for (const [role, session] of Object.entries(pages)) {
    await evaluate(session, "document.querySelector('.lang-toggle').click()");
    await until(session, "localStorage.getItem('azm-lang') === 'en' && document.querySelector('nav').innerText.includes('Dashboard')");
    check(`${role}: English interface renders`, await evaluate(session, "document.querySelector('.lang-toggle').textContent.length > 0 && document.querySelector('nav').innerText.includes('Dashboard')"));
  }
  const { cookies } = await cdp('Network.getCookies', { urls: [url] }, pages.admin);
  check('one cookie jar contains three HttpOnly tab cookies', cookies.filter(c => c.name.startsWith('azm_session_') && c.httpOnly && c.sameSite === 'Strict').length === 3);
  for (const [role, session] of Object.entries(pages)) {
    check(`${role}: JavaScript cannot read authentication cookie`, await evaluate(session, "!document.cookie.includes('azm_session')"));
    const foreign = tabChats[role === 'admin' ? 'user' : 'admin'];
    check(`${role}: cannot access another account chat`, await evaluate(session, `api('/api/chats/${foreign}').then(()=>false,e=>e.status===404)`));
  }
  // sessionStorage المنسوخ (Duplicate tab / opener) لا يرث جلسة التبويب الأصلي.
  const originalSelector = await evaluate(pages.admin, "sessionStorage.getItem('azm-tab-id')");
  const { targetId: cloneTarget } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId: clonePage } = await cdp('Target.attachToTarget', { targetId: cloneTarget, flatten: true });
  targetBySession.set(clonePage, cloneTarget);
  await cdp('Page.enable', {}, clonePage); await cdp('Runtime.enable', {}, clonePage);
  if (process.env.AZM_UI_DISABLE_LOCKS === '1') await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(navigator, 'locks', {value:undefined})" }, clonePage);
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `sessionStorage.setItem('azm-tab-id', ${JSON.stringify(originalSelector)})` }, clonePage);
  await cdp('Page.navigate', { url }, clonePage);
  await until(clonePage, "document.querySelector('.login-screen') !== null");
  check('copied tab selector is replaced without inheriting commander session', await evaluate(clonePage, `sessionStorage.getItem('azm-tab-id') !== ${JSON.stringify(originalSelector)} && !document.querySelector('.app-shell')`));
  await cdp('Target.closeTarget', { targetId: cloneTarget });
  await evaluate(pages.base_manager, "document.querySelector('.topbar .profile-btn').click()");
  await until(pages.base_manager, "document.querySelector('.topbar .profile-logout') !== null");
  check('profile menu shows account details', await evaluate(pages.base_manager, "document.querySelectorAll('.profile-pop dd').length === 5"));
  await evaluate(pages.base_manager, "document.querySelector('.topbar .profile-logout').click()");
  await until(pages.base_manager, "document.querySelector('.login-screen') !== null");
  check('logout tab loses API access', await evaluate(pages.base_manager, "api('/api/me').then(()=>false,e=>e.status===401)"));
  for (const role of ['admin', 'user']) {
    await reloadPage(pages[role]);
    // قائمة القائد قد تكون فارغة بعد القرارين؛ يكفي أن تُعرض لوحة الحساب نفسه
    await until(pages[role], `document.querySelector('.role-${role} .intel-column') !== null`);
    check(`${role}: survives other tab logout and refresh`, await evaluate(pages[role], `api('/api/me').then(u=>u.role===${JSON.stringify(role)})`));
  }
  await reloadPage(pages.base_manager);
  await until(pages.base_manager, "document.querySelector('.login-screen') !== null");
  check('logged-out tab stays logged out after refresh', await evaluate(pages.base_manager, "api('/api/state').then(()=>false,e=>e.status===401)"));
  check('no uncaught browser exceptions', errors.length === 0);
  console.log('All UI checks passed');
} finally {
  if (ws) ws.close();
  for (const child of children.reverse()) { child.kill(); await sleep(400); }
  // نحذف مجلد التجربة الذي أنشأناه فقط، ولا أي مسار بيانات قائم.
  for (let i = 0; i < 10; i++) { try { rmSync(folder, { recursive: true, force: true }); break; } catch { await sleep(200); } }
}
