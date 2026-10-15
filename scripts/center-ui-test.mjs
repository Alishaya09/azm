// متصفح حقيقي وخادم وملف تعريف مؤقتان؛ لا يستخدم بيانات التشغيل أو منفذ 5182.
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

const edge = process.env.AZM_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
if (!existsSync(edge)) throw new Error('Set AZM_TEST_BROWSER to a Chromium browser executable');
const dir = mkdtempSync(join(tmpdir(), 'azm-center-ui-'));
const pause = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(r => { const s = createServer(); s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));}); });
const port = await freePort(), debug = await freePort(), url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath,['server.mjs'],{windowsHide:true,stdio:'ignore',env:{...process.env,HOST:'127.0.0.1',PORT:String(port),AZM_DATA_DIR:join(dir,'store'),AZM_ADMIN_PASSWORD:'ui-test-password',AZM_AI_PROVIDER:'none'}});
let browser, socket, seq=0, browserError='';
const pending=new Map(), exceptions=[];
async function until(fn, message) { for(let i=0;i<100;i++){try{const v=await fn();if(v)return v;}catch{}await pause(100);}throw new Error(message); }
function cdp(method, params={}) { const id=++seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},15000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method,params}));}); }
async function evaluate(expression) { const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text+JSON.stringify(r.exceptionDetails.exception));return r.result.value; }
const clickText = text => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(text)}));if(!b)throw Error('button missing');b.click();return true;})()`);
try {
  await until(()=>fetch(url+'/api/me'),'temporary server not ready');
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
  const labels=await evaluate(`({db:makeT(CURRENT_LANG)('tab.databases'),fill:makeT(CURRENT_LANG)('db.refillCenter'),dashboard:makeT(CURRENT_LANG)('tab.dashboard')})`);
  await clickText(labels.db);
  await until(()=>evaluate(`!!document.querySelector('.db-fsb button')`),'database screen not rendered');
  await clickText(labels.fill);
  await until(()=>evaluate(`document.querySelectorAll('.bulk-fill-row').length===40`),'all forty preview rows not rendered');
  assert.equal(await evaluate(`document.querySelectorAll('select:disabled').length>=2`),true,'refill fixes source and destination');
  // Exclude one item and edit another, then execute the actual form.
  await evaluate(`(()=>{const rows=document.querySelectorAll('.bulk-fill-row');rows[0].querySelector('input[type=checkbox]').click();const input=rows[1].querySelector('input[type=number]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'2');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await pause(100);
  const selected=await evaluate(`document.querySelectorAll('.bulk-fill-row input[type=checkbox]:checked').length`);assert.equal(selected,39);
  await evaluate(`document.querySelector('.req-form button[type=submit]').click()`);
  await until(()=>evaluate(`!!document.querySelector('.req-banner.delivered')`),'refill did not complete');
  const result=await evaluate(`(async()=>{const s=await api('/api/state');const n=s.layout.nodes.find(n=>n.id==='fsb-1');return {qty:s.depots[n.id],keys:s.catalog.map(c=>c.key)};})()`);
  assert.equal(result.qty[result.keys[0]],0);assert.equal(result.qty[result.keys[1]],2);
  await evaluate(`document.querySelector('.modal button[aria-label]')?.click() || document.querySelector('.modal footer button')?.click()`);
  await clickText(labels.dashboard);
  await until(()=>evaluate(`!!document.querySelector('.leaflet-map')`),'map not rendered');
  await until(()=>evaluate(`!!document.querySelector('.leaflet-marker-icon .node.fsb')`),'supply marker not rendered');
  await evaluate(`document.querySelector('.leaflet-marker-icon .node.fsb').closest('.leaflet-marker-icon').click()`);
  await until(()=>evaluate(`!!document.querySelector('.node-info .ni-action')`),'map point refill action missing');
  await evaluate(`document.querySelector('.node-info .ni-action').click()`);
  await until(()=>evaluate(`document.querySelectorAll('.bulk-fill-row').length===40`),'map refill preview not rendered');
  await pause(300);
  assert.equal(await evaluate(`(()=>{const b=document.querySelector('.modal button[type=submit]'),r=b.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b;})()`),true,'map layers do not cover the confirmation button');
  const screenshot=await cdp('Page.captureScreenshot',{format:'png'});writeFileSync(join(dir,'center-preview.png'),Buffer.from(screenshot.data,'base64'));
  assert.equal(exceptions.length,0,JSON.stringify(exceptions));
  console.log('All checks passed (Chromium browser: databases, editable 40-item preview, execution, map panel, no runtime exceptions)');
  console.log(`UI evidence: ${join(dir,'center-preview.png')}`);
} catch(error) { console.error(browserError.slice(0,2500)); throw error; } finally {
  if(socket?.readyState===1){await cdp('Browser.close').catch(()=>{});socket.close();}
  if(browser && browser.exitCode===null)browser.kill();
  if(server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}
}
