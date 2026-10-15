// متصفح حقيقي وخادم وملف تعريف مؤقتان؛ لا يستخدم بيانات التشغيل أو منفذ 5182.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

const edge = process.env.AZM_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
if (!existsSync(edge)) throw new Error('Set AZM_TEST_BROWSER to a Chromium browser executable');
const dir = mkdtempSync(join(tmpdir(), 'azm-unit-ui-'));
const pause = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(r => { const s = createServer(); s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));}); });
const port = await freePort(), debug = await freePort(), url = `http://127.0.0.1:${port}`;
const testEnv={...process.env,HOST:'127.0.0.1',PORT:String(port),AZM_HOUR_MS:'1000',AZM_DATA_DIR:join(dir,'store'),AZM_ADMIN_PASSWORD:'ui-test-password',AZM_AI_PROVIDER:'none'};
const startTestServer=()=>spawn(process.execPath,['server.mjs'],{windowsHide:true,stdio:'ignore',env:testEnv});
let server=startTestServer();
let browser, socket, seq=0, browserError='';
const pending=new Map(), exceptions=[];
async function until(fn, message) { for(let i=0;i<400;i++){try{const v=await fn();if(v)return v;}catch{}await pause(100);}throw new Error(message); }
function cdp(method, params={}) { const id=++seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},15000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method,params}));}); }
async function evaluate(expression) { await cdp('Page.bringToFront');const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text+JSON.stringify(r.exceptionDetails.exception));return r.result.value; }
const clickText = text => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(text)}));if(!b)throw Error('button missing');b.click();return true;})()`);
try {
  await until(()=>fetch(url+'/api/me'),'temporary server not ready');
  // بداية جديدة حقيقية على نسخة مؤقتة قبل إنشاء أي جهة عبر المتصفح.
  const auth=await fetch(url+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'ui-test-password'})});
  const cookie=auth.headers.get('set-cookie').split(';')[0];
  const fixture=async(path,body,method='POST')=>{const r=await fetch(url+path,{method,headers:{cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(r.status,200);return r.json();};
  await fixture('/api/sim',{speed:0});const old=await fixture('/api/state',null,'GET');
  await fixture('/api/layout',{nodes:old.layout.nodes.filter(n=>n.type==='hq'),links:[],baseVersion:old.layoutVersion,operationKey:'ui-clear-old-map'},'PUT');
  server.kill();await new Promise(r=>server.once('exit',r));
  const reset=spawnSync(process.execPath,['scripts/new-cycle.mjs','--apply','--confirm','NEW-CYCLE'],{env:testEnv,encoding:'utf8',windowsHide:true});assert.equal(reset.status,0,reset.stderr);
  server=startTestServer();await until(()=>fetch(url+'/api/me'),'new cycle server not ready');
  browser=spawn(edge,['--headless=new','--disable-gpu','--disable-crash-reporter','--disable-extensions','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${debug}`,`--user-data-dir=${join(dir,'profile')}`,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  browser.stderr.on('data',b=>{browserError+=b.toString();});
  browser.on('exit',code=>{if(code)console.error('Browser exit',code,browserError.slice(0,1800));});
  const pages=await until(async()=>{const r=await fetch(`http://127.0.0.1:${debug}/json/list`,{signal:AbortSignal.timeout(1000)});const a=await r.json();return a.some(p=>p.type==='page')&&a;},'browser not ready');
  console.log('Browser control connected');
  socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise(r=>socket.addEventListener('open',r,{once:true}));
  socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(new Error(m.error.message)):p?.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails);});
  await cdp('Runtime.enable');await cdp('Page.enable');await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url});
  console.log('Page navigated');
  await until(()=>evaluate(`!!document.querySelector('.login-screen')`),'login screen not rendered');
  console.log('Login rendered');
  await evaluate(`(async()=>{await api('/api/login',{method:'POST',body:{username:'admin',password:'ui-test-password'}});await api('/api/sim',{method:'POST',body:{speed:0}});location.reload();})()`);
  await until(()=>evaluate(`!!document.querySelector('nav')`),'dashboard not rendered');

  const labels=await evaluate(`({db:makeT(CURRENT_LANG)('tab.databases'),create:makeT(CURRENT_LANG)('ent.createTitle')})`);
  assert.equal(await evaluate(`(async()=>{const s=await api('/api/state');return s.layout.nodes.length===1&&s.layout.nodes[0].type==='hq'&&s.sim.hours===0&&s.requests.length===0;})()`),true,'fresh cycle contains fixed headquarters only');
  await until(()=>evaluate(`document.querySelectorAll('.node.hq').length===1`),'fixed HQ marker missing');
  assert.equal(await evaluate(`document.querySelectorAll('.node.main,.node.fsb,.node.unit').length`),0,'no old entity markers in new cycle');
  await clickText(await evaluate(`makeT(CURRENT_LANG)('tab.reports')`));
  await until(()=>evaluate(`(async()=>{const s=await api('/api/state');return [...document.querySelectorAll('.srep-note')].some(e=>e.textContent.includes(s.operationCycle.id.slice(0,8)));})()`),'new cycle identifier missing from report UI');
  await clickText(labels.db);
  async function createThroughUi(type,label,baseId) {
    await clickText(labels.create);await evaluate(`document.querySelectorAll('.modal .segmented button')[${type}].click()`);await pause(100);
    await evaluate(`(()=>{const e=document.querySelector('.modal input[maxlength]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(label)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    if(baseId)await evaluate(`(()=>{const e=document.querySelector('.modal select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(baseId)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await pause(150);await evaluate(`document.querySelector('.modal button[type=submit]').click()`);await until(()=>evaluate(`!document.querySelector('.modal')`),'entity creation failed '+label);
    return evaluate(`(async()=>{const s=await api('/api/state');return s.layout.nodes.find(n=>n.label===${JSON.stringify(label)});})()`);
  }
  const uiBaseA=await createThroughUi(0,'UI base A'),uiBaseB=await createThroughUi(0,'UI base B');
  await createThroughUi(1,'UI point A',uiBaseA.id);await createThroughUi(1,'UI point B',uiBaseB.id);
  await createThroughUi(2,'UI second unit',uiBaseB.id);
  await clickText(labels.create);
  await evaluate(`document.querySelectorAll('.modal .segmented button')[2].click()`);
  await until(()=>evaluate(`document.querySelectorAll('.starter-preview span').length===40`),'forty creation previews missing');
  assert.equal(await evaluate(`[...document.querySelectorAll('.starter-preview span')].every(e=>e.textContent.includes('0 /'))`),true);
  assert.equal(await evaluate(`document.querySelectorAll('.modal select').length`),1,'no fuel selector');
  await evaluate(`(()=>{const e=document.querySelector('.modal input[maxlength]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'UI zero unit');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await pause(150);await evaluate(`document.querySelector('.modal button[type=submit]').click()`);
  await until(()=>evaluate(`!document.querySelector('.modal')`),'creation failed');
  const getUnit=`(async()=>{const s=await api('/api/state');const n=s.layout.nodes.find(n=>n.label==='UI zero unit');return n&&{...n,qty:s.inventory[n.id].qty};})()`;
  const u=await evaluate(getUnit);assert.ok(u,'created unit persisted');assert.equal(u.allowedResources.length,40);assert.ok(Object.values(u.qty).every(q=>q===0));
  assert.equal(await evaluate(`[...document.querySelectorAll('.db-units button')].some(b=>b.textContent.includes(makeT(CURRENT_LANG)('ent.editUnitResources')))`),false,'no manual unit resource assignment');
  await cdp('Page.reload');await until(()=>evaluate(`!!document.querySelector('nav')`),'reload failed');
  assert.deepEqual((await evaluate(getUnit)).qty,u.qty);
  await evaluate(`(async()=>{await api('/api/users',{method:'POST',body:{username:'ui_officer',password:'ui-test-password',role:'user',unitId:${JSON.stringify(u.unitId)}}});await api('/api/users',{method:'POST',body:{username:'ui_manager',password:'ui-test-password',role:'base_manager',baseId:${JSON.stringify(u.baseId)}}});})()`);
  const adminSocket=socket;
  const version=await (await fetch(`http://127.0.0.1:${debug}/json/version`)).json();
  const browserSocket=new WebSocket(version.webSocketDebuggerUrl);
  await new Promise(r=>browserSocket.addEventListener('open',r,{once:true}));
  browserSocket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(new Error(m.error.message)):p?.resolve(m.result);}});
  async function openRole(username) {
    console.log('Opening isolated role',username);
    socket=browserSocket;
    const context=await cdp('Target.createBrowserContext');
    const target=await cdp('Target.createTarget',{url:'about:blank',browserContextId:context.browserContextId});
    console.log('Role target created',username);
    const pages=await (await fetch(`http://127.0.0.1:${debug}/json/list`)).json();
    socket=new WebSocket(pages.find(p=>p.id===target.targetId).webSocketDebuggerUrl);
    await new Promise(r=>socket.addEventListener('open',r,{once:true}));
    console.log('Role control connected',username);
    socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(new Error(m.error.message)):p?.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails);});
    await cdp('Runtime.enable');await cdp('Page.enable');
    await cdp('Page.navigate',{url});
    await until(()=>evaluate(`!!document.querySelector('.login-screen') || !!document.querySelector('nav')`),'role login missing').catch(async e=>{console.error('Role page diagnostics',await evaluate(`({url:location.href,ready:document.readyState,text:document.body.innerText.slice(0,400)})`),exceptions);throw e;});
    console.log('Role login rendered',username);
    await evaluate(`(async()=>{await api('/api/login',{method:'POST',body:{username:${JSON.stringify(username)},password:'ui-test-password'}});location.reload();})()`);
    await until(()=>evaluate(`!!document.querySelector('nav')`),'role dashboard missing');
    return socket;
  }
  const managerSocket=await openRole('ui_manager');
  assert.equal(await evaluate(`(async()=>{const s=await api('/api/state');return s.scope.role;})()`),'base_manager');
  const officerSocket=await openRole('ui_officer');
  const inventoryLabel=await evaluate(`makeT(CURRENT_LANG)('tab.inventory')`);await clickText(inventoryLabel);
  await until(()=>evaluate(`document.querySelectorAll('.inventory-row').length===40`),'officer forty inventory rows missing');
  assert.equal(await evaluate(`[...document.querySelectorAll('.inventory-row bdi')].every(e=>e.textContent.trim().startsWith('0 /'))`),true);
  await cdp('Page.reload');await until(()=>evaluate(`!!document.querySelector('nav')`),'officer reload missing');
  const before=(await evaluate(getUnit)).qty;
  for(const tab of [adminSocket,managerSocket,officerSocket]) {socket=tab;assert.deepEqual((await evaluate(getUnit)).qty,before);}
  socket=officerSocket;
  await clickText(await evaluate(`makeT(CURRENT_LANG)('tab.dashboard')`));
  await evaluate(`document.querySelector('.cta-request').click()`);
  await until(()=>evaluate(`document.querySelectorAll('.item-row').length===40`),'forty request items missing');
  await evaluate(`(()=>{document.querySelectorAll('.mode-cards button')[1].click();const keep=['azm_bottled_water','azm_helmet','azm_diesel','azm_gasoline'];document.querySelectorAll('.item-row').forEach((row,i)=>{const box=row.querySelector('input[type=checkbox]');if(box.checked!==keep.includes(resources[i].key))box.click();});})()`);
  await pause(200);
  await evaluate(`(()=>{const q={azm_bottled_water:5000,azm_helmet:5,azm_diesel:1000,azm_gasoline:1000};document.querySelectorAll('.item-row').forEach((row,i)=>{if(q[resources[i].key]){const e=row.querySelector('input[type=number]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,String(q[resources[i].key]));e.dispatchEvent(new Event('input',{bubbles:true}));}});})()`);
  await pause(200);await evaluate(`document.querySelector('.modal.pro button[type=submit]').click()`);
  await until(()=>evaluate(`!document.querySelector('.modal.pro')`),'request submission failed').catch(async e=>{console.error('Request diagnostics',await evaluate(`({error:document.querySelector('.form-error')?.textContent,disabled:document.querySelector('.modal.pro button[type=submit]')?.disabled,selected:document.querySelectorAll('.item-row input[type=checkbox]:checked').length,summary:document.querySelector('.sum-items')?.innerText})`));throw e;});
  const request=await evaluate(`(async()=>{const s=await api('/api/state');return s.requests.find(r=>r.unitId===${JSON.stringify(u.unitId)});})()`);assert.equal(request.items.length,4);
  socket=managerSocket;await cdp('Page.reload');await until(()=>evaluate(`!!document.querySelector('[data-request-id="${request.id}"]')`),'manager request missing');
  await evaluate(`document.querySelector('[data-request-id="${request.id}"]').click()`);
  await until(()=>evaluate(`!!document.querySelector('.source-pick select')`),'source selector missing');
  await evaluate(`(()=>{const e=document.querySelector('.source-pick select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(u.baseId)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await pause(200);await evaluate(`document.querySelector('.req-actions .approve').click()`);
  await until(()=>evaluate(`(async()=>{const s=await api('/api/state');return s.requests.find(r=>r.id==='${request.id}').status==='approved';})()`),'manager dispatch failed');
  assert.deepEqual((await evaluate(getUnit)).qty,before,'on-the-way stock is not consumed or received');
  socket=adminSocket;await evaluate(`api('/api/sim',{method:'POST',body:{speed:1}})`);
  await until(()=>evaluate(`(async()=>{const s=await api('/api/state');return s.requests.find(r=>r.id==='${request.id}').status==='delivered';})()`),'delivery missing');
  const delivered=(await evaluate(getUnit)).qty;assert.equal(delivered.azm_helmet,5);assert.ok(delivered.azm_bottled_water>0);
  await until(async()=>{const q=(await evaluate(getUnit)).qty;return q.azm_bottled_water<delivered.azm_bottled_water&&q.azm_diesel+q.azm_gasoline<delivered.azm_diesel+delivered.azm_gasoline;},'received consumables did not decrease');
  await evaluate(`api('/api/sim',{method:'POST',body:{speed:0}})`);
  assert.equal((await evaluate(getUnit)).qty.azm_helmet,5,'non-consumable stays constant');
  socket=officerSocket;await clickText(inventoryLabel);
  await until(()=>evaluate(`document.querySelectorAll('.inventory-row').length===40`),'inventory after delivery missing');
  await until(()=>evaluate(`(async()=>{const s=await api('/api/state');return s.inventory[${JSON.stringify(u.id)}].qty.azm_helmet===5;})()`),'officer delivery not refreshed');
  socket=adminSocket;
  await evaluate(`api('/api/catalog',{method:'POST',body:{key:'v10_ui_food',icon:'📦',name:{ar:'صنف اختبار واجهة',en:'UI consumable'},unit:{ar:'قطعة',en:'piece'},measure:'piece',capacity:{main:10000,fsb:1000},unitBasis:'fixed',unitFactor:100,usage:'consumable',weight:.2,active:true}})`);
  socket=officerSocket;
  await until(()=>evaluate(`document.querySelectorAll('.inventory-row').length===41`),'future catalogue item did not appear automatically');
  assert.equal((await evaluate(getUnit)).qty.v10_ui_food,0,'assignment of future item creates no balance');
  socket=adminSocket;
  const screenshot=await cdp('Page.captureScreenshot',{format:'png'});writeFileSync(join(dir,'unit-policy.png'),Buffer.from(screenshot.data,'base64'));
  assert.equal(exceptions.length,0,JSON.stringify(exceptions));
  console.log('All checks passed (Chromium: fresh HQ-only cycle, two bases/centers/units created by UI, forty items, no fuel or assignment selector, three roles, request, base dispatch, delivery, consumption, stable non-consumable, future item and reload)');
  console.log('UI evidence: '+join(dir,'unit-policy.png'));
} catch(error) { console.error(browserError.slice(0,2500)); throw error; } finally {
  if(socket?.readyState===1){await cdp('Browser.close').catch(()=>{});socket.close();}
  if(browser && browser.exitCode===null)browser.kill();
  if(server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}
}
