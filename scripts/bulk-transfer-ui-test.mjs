// اختبار متصفح اختياري بلا حزم: Chrome/Edge وNode مع WebSocket؛ بيانات وجلسات مؤقتة فقط.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

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
const check = (name, value) => { if (!value) throw new Error(name); console.log(`ok   ${name}`); };
try {
  const port = await freePort(), url = `http://127.0.0.1:${port}`, adminPassword = 'ui-temporary-pass';
  const server = spawn(process.execPath, [join(root, 'server.mjs')], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), AZM_DATA_DIR: join(folder, 'data'), AZM_ADMIN_PASSWORD: adminPassword, AZM_AI_PROVIDER: 'none', AZM_HOUR_MS: '600000' }, stdio: 'ignore', windowsHide: true }); children.push(server);
  for (let i = 0; i < 100; i++) { try { await fetch(url + '/api/me'); break; } catch { await sleep(100); } }
  const request = async (path, body, cookie, method = body ? 'POST' : 'GET') => { const r = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); if (!r.ok) throw new Error(`Fixture HTTP ${r.status} ${path}`); return { json: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] }; };
  const admin = (await request('/api/login', { username: 'admin', password: adminPassword })).cookie;
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

  const {targetId}=await cdp('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await cdp('Target.attachToTarget',{targetId,flatten:true});
  targetBySession.set(sessionId,targetId);
  await cdp('Runtime.enable',{},sessionId); await cdp('Page.enable',{},sessionId);
  await cdp('Network.enable',{},sessionId); await cdp('Network.setBlockedURLs',{urls:['https://*']},sessionId);
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sessionId);
  await cdp('Page.navigate',{url},sessionId);
  await until(sessionId,`document.querySelector('input[autocomplete="username"]')!==null`);
  await evaluate(sessionId,`(()=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const [selector,value] of [['input[autocomplete="username"]','admin'],['input[type="password"]','ui-temporary-pass']]){const el=document.querySelector(selector);set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
  await until(sessionId,"!document.querySelector('button[type=submit]').disabled");
  await evaluate(sessionId,"document.querySelector('form').requestSubmit()");
  await until(sessionId,"document.querySelector('nav button')!==null");
  await evaluate(sessionId,"document.querySelectorAll('nav button')[1].click()");
  await until(sessionId,"document.querySelector('.db-actions')!==null");
  await evaluate(sessionId,"Array.from(document.querySelectorAll('.db-actions button')).find(b=>b.textContent.includes(makeT(CURRENT_LANG)('db.transfer'))).click()");
  await until(sessionId,"document.querySelector('.modal .req-form')!==null");
  await until(sessionId,"Array.from(document.querySelectorAll('.modal button')).some(b=>b.textContent===makeT(CURRENT_LANG)('db.fillAll')&&!b.disabled)");
  await evaluate(sessionId,"Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent===makeT(CURRENT_LANG)('db.fillAll')).click()");
  await until(sessionId,"document.querySelectorAll('.modal input[type=checkbox]').length===40");
  check('40 resource preview rows',true);
  const chosen=await evaluate(sessionId,"document.querySelectorAll('.modal input[type=checkbox]:checked').length");
  await evaluate(sessionId,"document.querySelector('.modal input[type=checkbox]:checked').click()");
  check('can exclude a resource',await evaluate(sessionId,`document.querySelectorAll('.modal input[type=checkbox]:checked').length===${chosen-1}`));
  await evaluate(sessionId,"(()=>{const el=Array.from(document.querySelectorAll('.modal input[type=number]')).find(e=>!e.disabled);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'1');el.dispatchEvent(new Event('input',{bubbles:true}));})()");
  check('can edit quantity',await evaluate(sessionId,"Array.from(document.querySelectorAll('.modal input[type=number]')).some(e=>e.value==='1'&&!e.disabled)"));
  await evaluate(sessionId,"document.querySelector('.modal form').requestSubmit();document.querySelector('.modal form').requestSubmit()");
  await until(sessionId,"document.querySelector('.modal .delivered')!==null");
  check('double submit renders operation receipt',await evaluate(sessionId,"document.querySelectorAll('.modal .items-table').length===39"));
  check('no browser exceptions',errors.length===0);
  console.log('All UI checks passed (bulk transfer)');
} finally {
  if(ws)ws.close();
  for(const child of children.reverse()){child.kill();await sleep(400);}
}
