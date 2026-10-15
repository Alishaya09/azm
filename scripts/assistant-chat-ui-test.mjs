// اختبار المساعد فعلياً بثلاثة تبويبات وجلسات مستقلة في متصفح واحد.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chatFixture, question } from './assistant-chat-test.mjs';
const executable=[process.env.AZM_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&existsSync(p));
if(!executable)throw Error('Chromium browser required');
const f=await chatFixture(),pause=ms=>new Promise(r=>setTimeout(r,ms));
console.log('Temporary chat fixture ready: '+f.url);
let browser,ws,serial=0;const pending=new Map(),targets=new Map(),errors=[];
const cdp=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},45000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
const evaluate=async(s,expression)=>{await cdp('Target.activateTarget',{targetId:targets.get(s)});const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},s);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const until=async(s,expression)=>{for(let i=0;i<250;i++){if(await evaluate(s,expression))return;await pause(100);}throw Error('UI wait failed '+expression);};
const input=async(s,selector,value)=>{await evaluate(s,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('input missing');Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype),'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);};
const click=async(s,selector)=>evaluate(s,`document.querySelector(${JSON.stringify(selector)}).click()`);
const check=(name,value)=>{assert(value,name);console.log('ok   '+name);};
try {
  browser=spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--remote-debugging-port=0',`--user-data-dir=${join(f.folder,'browser')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
  const active=join(f.folder,'browser','DevToolsActivePort');for(let i=0;i<150&&!existsSync(active);i++)await pause(100);
  const [port,path]=readFileSync(active,'utf8').trim().split(/\r?\n/);console.log('Connecting Chromium CDP on '+port);ws=new WebSocket(`ws://127.0.0.1:${port}${path}`);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CDP connection timeout')),15000);ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('CDP connection failed'));},{once:true});});
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);});
  const {browserContextId}=await cdp('Target.createBrowserContext');
  async function page(username){
    const {targetId}=await cdp('Target.createTarget',{url:'about:blank',browserContextId});const {sessionId:s}=await cdp('Target.attachToTarget',{targetId,flatten:true});targets.set(s,targetId);
    await cdp('Page.enable',{},s);await cdp('Runtime.enable',{},s);await cdp('Network.enable',{},s);await cdp('Network.setBlockedURLs',{urls:['https://*']},s);await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},s);
    console.log('Loading browser session '+username);await cdp('Page.navigate',{url:f.url},s);await until(s,"!!document.querySelector('.login-screen')");
    await input(s,'.password-panel input[autocomplete=username]',username);await input(s,'.password-panel input[type=password]',f.password);await click(s,'.password-panel button[type=submit]');await until(s,"!!document.querySelector('nav')");
    await evaluate(s,"window.chatCalls=[];const originalFetch=window.fetch;window.fetch=(p,o)=>{window.chatCalls.push({path:String(p),method:o?.method});return originalFetch(p,o);}");
    await click(s,'.ai-fab');await until(s,"!!document.querySelector('.ai-panel')");return s;
  }
  const before=await f.get('/api/state',f.admin);
  const pages=[await page('admin'),await page('chat.base'),await page('chat.unit')];
  check('three independent sessions in shared browser context',new Set(await Promise.all(pages.map(s=>evaluate(s,"sessionStorage.getItem('azm-tab-id')")))).size===3);
  for(const [i,s] of pages.entries()){
    const role=['admin','base_manager','user'][i];
    check('session '+role,await evaluate(s,`api('/api/me').then(u=>u.role===${JSON.stringify(role)})`));
    await until(s,"document.querySelector('.ai-panel header').textContent.includes('azm-report-base')");
    check('plain composer '+role,await evaluate(s,"!document.querySelector('.ai-panel select,.ai-extract-button,.ai-suggestions,.ai-draft')"));
    const ask=async(text,enter)=>{
      const count=await evaluate(s,"document.querySelectorAll('.ai-msg.bot').length");
      await input(s,'.ai-composer textarea',text);
      if(enter){await evaluate(s,"document.querySelector('.ai-composer textarea').focus()");await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},s);await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},s);}
      else await click(s,'.ai-composer button[type=submit]');
      await until(s,`document.querySelectorAll('.ai-msg.bot').length>${count} && !document.querySelector('.ai-typing')`);
    };
    const first=question('read_inventory',{entityId:f.u1.id});await ask(first,true);
    check('Enter sends allowed question '+role,await evaluate(s,"[...document.querySelectorAll('.ai-msg.bot')].at(-1).textContent.includes('إجابة ضمن الصلاحية')"));
    await ask(question('read_inventory',{entityId:i===0?'missing':f.u2.id}),false);
    check('button sends forbidden question '+role,await evaluate(s,"[...document.querySelectorAll('.ai-msg.bot')].at(-1).textContent.includes('out_of_scope')"));
    const list=await evaluate(s,"api('/api/chats')");check('title and date saved '+role,list[0].title===first.slice(0,60)&&list[0].updatedAt>0&&list[0].count===4);
    await evaluate(s,"document.querySelector('.ai-panel header button[aria-label=\"'+makeT(CURRENT_LANG)('ai.new')+'\"]').click()");
    check('new chat clears messages '+role,await evaluate(s,"!document.querySelector('.ai-msg')"));
    await evaluate(s,"document.querySelector('.ai-panel header button[aria-label=\"'+makeT(CURRENT_LANG)('ai.history')+'\"]').click()");await until(s,"!!document.querySelector('.ai-hist-row small')");
    check('history displays title and date '+role,await evaluate(s,`document.querySelector('.ai-hist-row b').textContent===${JSON.stringify(list[0].title)} && !!document.querySelector('.ai-hist-row small').textContent`));
    await click(s,'.ai-hist-row');await until(s,"document.querySelectorAll('.ai-msg').length===4");
    check('only conversation POSTs '+role,await evaluate(s,"window.chatCalls.filter(c=>c.method==='POST').every(c=>c.path.startsWith('/api/chats')) && !window.chatCalls.some(c=>c.path.includes('request-status')||c.path.includes('request-draft'))"));
    const screenshot=await cdp('Page.captureScreenshot',{format:'png'},s);writeFileSync(join(f.folder,`assistant-${role}.png`),Buffer.from(screenshot.data,'base64'));
    await cdp('Page.reload',{},s);await until(s,"!!document.querySelector('nav')");await click(s,'.ai-fab');await until(s,"!!document.querySelector('.ai-panel')");
    check('saved history survives refresh '+role,await evaluate(s,`api('/api/chats').then(c=>c[0].id===${JSON.stringify(list[0].id)}&&c[0].count===4)`));
  }
  const after=await f.get('/api/state',f.admin);for(const key of ['stocks','depots','requests','inventory'])assert.deepEqual(after[key],before[key]);
  assert.equal(errors.length,0,'no uncaught browser exceptions');
  console.log('All checks passed (Chromium: three sessions, allowed/forbidden questions, Enter/button, base model status, new chat, names/dates/history/reload, no mutations).');console.log('UI evidence: '+f.folder);
} finally {
  if(ws){if(ws.readyState===WebSocket.OPEN){try{await cdp('Browser.close');}catch{}}ws.close();}
  if(browser&&browser.exitCode===null)browser.kill();await f.stop();
}
