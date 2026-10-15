// اختبار شاشة المستخدمين فعلياً وثلاثة تبويبات تشترك في كوكي المتصفح.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assignmentFixture } from './user-assignment-test.mjs';
const executable=[process.env.AZM_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&existsSync(p));
if(!executable)throw Error('Chromium browser required');
const f=await assignmentFixture(),pause=ms=>new Promise(r=>setTimeout(r,ms));
let browser,ws,serial=0;const pending=new Map(),targets=new Map(),errors=[];
const cdp=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},45000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
const evaluate=async(s,expression)=>{await cdp('Target.activateTarget',{targetId:targets.get(s)});const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},s);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const until=async(s,expression)=>{for(let i=0;i<250;i++){if(await evaluate(s,expression))return;await pause(100);}throw Error('UI wait failed '+expression);};
const input=async(s,selector,value)=>{await evaluate(s,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('input missing');Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);};
const click=async(s,selector)=>evaluate(s,`document.querySelector(${JSON.stringify(selector)}).click()`);
const check=(name,value)=>{assert(value,name);console.log('ok   '+name);};
try {
  browser=spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--remote-debugging-port=0',`--user-data-dir=${join(f.folder,'browser')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
  const active=join(f.folder,'browser','DevToolsActivePort');for(let i=0;i<150&&!existsSync(active);i++)await pause(100);
  const [port,path]=readFileSync(active,'utf8').trim().split(/\r?\n/);ws=new WebSocket(`ws://127.0.0.1:${port}${path}`);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);});
  const {browserContextId}=await cdp('Target.createBrowserContext');
  async function page(username){const {targetId}=await cdp('Target.createTarget',{url:'about:blank',browserContextId});const {sessionId:s}=await cdp('Target.attachToTarget',{targetId,flatten:true});targets.set(s,targetId);await cdp('Page.enable',{},s);await cdp('Runtime.enable',{},s);await cdp('Network.enable',{},s);await cdp('Network.setBlockedURLs',{urls:['https://*']},s);await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},s);await cdp('Page.navigate',{url:f.url},s);await until(s,"!!document.querySelector('.login-screen')");await input(s,'.password-panel input[autocomplete=username]',username);await input(s,'.password-panel input[type=password]',f.password);await click(s,'.password-panel button[type=submit]');await until(s,"!!document.querySelector('nav')");return s;}
  const admin=await page('admin');
  await evaluate(admin,"[...document.querySelectorAll('nav button')].find(e=>e.textContent.includes(makeT(CURRENT_LANG)('tab.users'))).click()");await until(admin,"!!document.querySelector('.users-page')");
  await click(admin,'.add-user');await until(admin,"!!document.querySelector('[data-user-assignment=user]')");
  check('HQ-only unit role cannot save and explains missing units',await evaluate(admin,"document.querySelector('.modal button[type=submit]').disabled && document.querySelector('.modal').textContent.includes(makeT(CURRENT_LANG)('users.noActiveUnits'))"));
  await input(admin,'.modal select:not([data-user-assignment])','lt');
  // الدور هو ثاني select في النموذج بعد الرتبة.
  const role=async value=>{await evaluate(admin,`(()=>{const e=[...document.querySelectorAll('.modal select')].find(e=>[...e.options].some(o=>o.value==='base_manager'));Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`);};
  await role('base_manager');check('HQ-only base role cannot save and explains missing bases',await evaluate(admin,"document.querySelector('.modal button[type=submit]').disabled && document.querySelector('.modal').textContent.includes(makeT(CURRENT_LANG)('users.noActiveBases'))"));
  await role('admin');check('commander has no assignment field',await evaluate(admin,"!document.querySelector('[data-user-assignment]')"));await click(admin,'.modal-close');
  const {b1,b2,p1,p2,u1,u2}=await f.entities();
  await until(admin,`(async()=>{const s=await api('/api/state');return s.layout.nodes.length===7;})()`);
  async function fillAccount(username,accountRole,entity){await click(admin,'.add-user');await until(admin,"!!document.querySelector('.modal')");
    await input(admin,'.modal input[dir=auto]','Test Account');await input(admin,'.modal input[autocomplete=off]',username);await input(admin,'.modal input[type=password]',f.password);await role(accountRole);
    if(entity){await until(admin,`document.querySelector('[data-user-assignment]').options.length===3`);check('no entity chosen implicitly',await evaluate(admin,"document.querySelector('[data-user-assignment]').value==='' && document.querySelector('.modal button[type=submit]').disabled"));await input(admin,'[data-user-assignment]',entity);}
    await click(admin,'.modal button[type=submit]');await until(admin,"!document.querySelector('.modal')");await until(admin,`!!document.querySelector('[data-username="${username}"]')`);
  }
  await fillAccount('ui.commander','admin');
  await fillAccount('ui.base','base_manager',b1.id);
  await click(admin,'.add-user');await until(admin,"document.querySelectorAll('[data-user-assignment] option').length===3");
  for(const [u,b]of [[u1,b1],[u2,b2]])check('unit option distinguishes code and base '+u.code,await evaluate(admin,`document.querySelector('[data-user-assignment] option[value="${u.unitId}"]').textContent.includes(${JSON.stringify(u.code)}) && document.querySelector('[data-user-assignment] option[value="${u.unitId}"]').textContent.includes(${JSON.stringify(b.code)})`));
  await click(admin,'.modal-close');await fillAccount('ui.unit','user',u1.unitId);
  check('saved user row shows code and base immediately',await evaluate(admin,`document.querySelector('[data-username="ui.unit"]').textContent.includes(${JSON.stringify(u1.code)}) && document.querySelector('[data-username="ui.unit"]').textContent.includes(${JSON.stringify(b1.code)})`));
  const manager=await page('ui.base'),officer=await page('ui.unit');
  for(const [s,r]of [[admin,'admin'],[manager,'base_manager'],[officer,'user']])check('simultaneous tab '+r,await evaluate(s,`api('/api/me').then(u=>u.role===${JSON.stringify(r)})`));
  const distinct=await Promise.all([admin,manager,officer].map(s=>evaluate(s,"sessionStorage.getItem('azm-tab-id')")));check('three selectors in one cookie context',new Set(distinct).size===3);
  check('unit role hides foreign base and unit, and depot quantities',await evaluate(officer,`api('/api/state').then(s=>!s.layout.nodes.some(n=>n.id===${JSON.stringify(b2.id)}||n.id===${JSON.stringify(u2.id)})&&Object.keys(s.depots).length===0)`));
  check('base role hides other base',await evaluate(manager,`api('/api/state').then(s=>!s.layout.nodes.some(n=>n.id===${JSON.stringify(b2.id)}))`));
  await click(admin,'[data-username="ui.unit"] .row-actions button');await until(admin,"!!document.querySelector('.modal')");await input(admin,'[data-user-assignment]',u2.unitId);await click(admin,'.modal button[type=submit]');await until(admin,"!document.querySelector('.modal')");
  await until(officer,`document.querySelector('.role-user') && api('/api/me').then(u=>u.unitId===${JSON.stringify(u2.unitId)}&&u.baseId===${JSON.stringify(b2.id)})`);
  await until(officer,`document.querySelector('.units-column').textContent.includes(${JSON.stringify(u2.label)})`);
  check('same session now has new unit and excludes previous base',await evaluate(officer,`api('/api/state').then(s=>s.layout.nodes.some(n=>n.id===${JSON.stringify(u2.id)})&&!s.layout.nodes.some(n=>n.id===${JSON.stringify(u1.id)}))`));
  await click(admin,'[data-username="ui.base"] .row-actions button');await until(admin,"!!document.querySelector('.modal')");await input(admin,'[data-user-assignment]',b2.id);await click(admin,'.modal button[type=submit]');await until(admin,"!document.querySelector('.modal')");await until(manager,`api('/api/me').then(u=>u.baseId===${JSON.stringify(b2.id)})`);
  await f.api(`/api/entities/${u2.id}`,null,f.admin,'DELETE');await until(officer,"!!document.querySelector('.login-screen')");
  await input(officer,'.password-panel input[autocomplete=username]','ui.unit');await input(officer,'.password-panel input[type=password]',f.password);await click(officer,'.password-panel button[type=submit]');await until(officer,"document.querySelector('.login-screen .form-error')?.textContent.includes(makeT(CURRENT_LANG)('err.account_assignment_required'))");
  await until(admin,"document.querySelector('[data-username=\"ui.unit\"]')?.textContent.includes(makeT(CURRENT_LANG)('users.assignmentMissing'))");
  await click(admin,'[data-username="ui.unit"] .row-actions button');await until(admin,"!!document.querySelector('.modal')");check('deleted unit never falls back to first available unit',await evaluate(admin,"document.querySelector('[data-user-assignment]').value==='' && document.querySelector('.modal button[type=submit]').disabled"));
  check('deleted and archived entities excluded',await evaluate(admin,`![...document.querySelectorAll('[data-user-assignment] option')].some(o=>o.value===${JSON.stringify(u2.unitId)})`));await input(admin,'[data-user-assignment]',u1.unitId);await click(admin,'.modal button[type=submit]');await until(admin,"!document.querySelector('.modal')");
  await click(officer,'.password-panel button[type=submit]');await until(officer,"!!document.querySelector('.role-user')");check('reassignment restores login',await evaluate(officer,`api('/api/me').then(u=>u.unitId===${JSON.stringify(u1.unitId)})`));
  await f.api(`/api/entities/${p2.id}`,null,f.admin,'DELETE');await f.api(`/api/entities/${b2.id}`,null,f.admin,'DELETE');await until(manager,"!!document.querySelector('.login-screen')");check('other two sessions survive base deletion',await evaluate(admin,"api('/api/me').then(u=>u.role==='admin')")&&await evaluate(officer,"api('/api/me').then(u=>u.role==='user')"));
  const screenshot=await cdp('Page.captureScreenshot',{format:'png'},admin);writeFileSync(join(f.folder,'user-assignment.png'),Buffer.from(screenshot.data,'base64'));
  assert.equal(errors.length,0,'no uncaught browser exceptions');console.log('All checks passed (Chromium account forms: empty cycle, duplicate names/codes, create/edit, three shared-context tabs, live scope, deleted unit/base, reassignment)');console.log('UI evidence: '+join(f.folder,'user-assignment.png'));
} finally {
  if(ws){try{await cdp('Browser.close');}catch{}ws.close();}
  if(browser&&browser.exitCode===null)browser.kill();await f.stop();
}
