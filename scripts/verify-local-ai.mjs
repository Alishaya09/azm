// اختبار اختياري للنموذج الحقيقي: خادم عزم وبيانات مؤقتة، ولا اعتماد أو حركة مخزون.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { REQUEST_SYSTEM_PROMPT } from '../server/ai/request-contract.mjs';
const endpoint = process.env.AZM_TEST_LORA_URL, model = process.env.AZM_TEST_LORA_MODEL;
if(!endpoint||!model)throw new Error('Set AZM_TEST_LORA_URL and AZM_TEST_LORA_MODEL');
const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const folder=mkdtempSync(join(tmpdir(),'azm-real-lora-'));
const child=spawn(process.execPath,['server.mjs'],{cwd:resolve('.'),windowsHide:true,stdio:'ignore',env:{...process.env,PORT:String(port),HOST:'127.0.0.1',AZM_DATA_DIR:folder,AZM_ADMIN_PASSWORD:'temporary-real-test',AZM_AI_PROVIDER:'none',AZM_REPORT_AI_PROVIDER:'none',AZM_REQUEST_AI_PROVIDER:'openai',AZM_REQUEST_AI_BASE_URL:endpoint,AZM_REQUEST_AI_MODEL:model,AZM_REQUEST_AI_API_KEY:'',AZM_REQUEST_AI_TIMEOUT_MS:'180000'}});
const base=`http://127.0.0.1:${port}`;let cookie;
const api=async(path,body,method=body?'POST':'GET')=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});if(path==='/api/login')cookie=r.headers.get('set-cookie')?.split(';')[0];return {status:r.status,json:await r.json()};};
try{
 const direct=await fetch(endpoint.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,messages:[{role:'system',content:REQUEST_SYSTEM_PROMPT},{role:'user',content:'نبغى 12 برميل ديزل و5 علب زيت محرك، الأولوية عاجلة.'}],max_tokens:512,temperature:0})});
 console.log('REAL_DIRECT_OUTPUT',JSON.stringify(await direct.json()));
 for(let i=0;i<100;i++){try{await fetch(base+'/api/me');break;}catch{await new Promise(r=>setTimeout(r,100));}}
 await api('/api/login',{username:'admin',password:'temporary-real-test'});
 const own=(await api('/api/entities',{type:'unit',label:'Real LoRA temporary unit',baseId:'base',pos:[24.8,46.7],allowedResources:['azm_diesel','azm_engine_oil'],opening:{azm_diesel:0,azm_engine_oil:0}})).json.node;
 const before=(await api('/api/state')).json;
 console.log('REAL_SERVICE_STATUS',JSON.stringify((await api('/api/ai/request-status')).json));
 const draft=await api('/api/ai/request-draft',{unitId:own.unitId,text:'نبغى 12 برميل ديزل و5 علب زيت محرك، الأولوية عاجلة.'});
 console.log('REAL_DRAFT',JSON.stringify(draft));
 const after=(await api('/api/state')).json;
 if(before.requests.length!==after.requests.length||JSON.stringify(before.inventory[own.id].qty)!==JSON.stringify(after.inventory[own.id].qty))throw new Error('Extraction changed operations');
 console.log('PASS: real extraction creates no request and changes no stock');
 const items=draft.json.draft?.items;
 if(draft.status!==200||draft.json.draft.priority!=='urgent'||items?.length!==2||!items.some(x=>x.resource==='azm_diesel'&&x.quantity===12&&x.unit==='barrel'&&x.supplyClass==='III')||!items.some(x=>x.resource==='azm_engine_oil'&&x.quantity===5&&x.unit==='can'&&x.supplyClass==='III'))throw new Error('Real extraction did not match expected reviewed items');
 console.log('PASS: reviewed draft has both expected quantities, units, catalog classes and urgent priority');
}finally{
 child.kill();await new Promise(r=>child.once('exit',r));
 // لا يُحذف إلا المجلد المؤقت الذي أنشأه هذا الاختبار.
 rmSync(folder,{recursive:true,force:true});
}
