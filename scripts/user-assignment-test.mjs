// بيانات مؤقتة فقط: بداية دورة ثم ربط الحسابات ومعاينة النطاق عند كل طلب.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

export async function assignmentFixture(aiEnv = {}) {
  const folder=mkdtempSync(join(tmpdir(),'azm-account-scope-')), password='temporary-account-pass';
  const port=await new Promise(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
  const url=`http://127.0.0.1:${port}`,env={...process.env,HOST:'127.0.0.1',PORT:String(port),AZM_DATA_DIR:join(folder,'data'),AZM_ADMIN_PASSWORD:password,AZM_AI_PROVIDER:'none',...aiEnv};
  let server;
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  const start=async()=>{server=spawn(process.execPath,['server.mjs'],{env,stdio:'ignore',windowsHide:true});for(let i=0;i<150;i++){try{await fetch(url+'/api/me');return;}catch{await pause(100);}}throw Error('temporary_server_not_ready');};
  const stop=async()=>{if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}};
  const api=async(path,body,cookie,method=body?'POST':'GET',status=200)=>{const r=await fetch(url+path,{method,headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();assert.equal(r.status,status,`${path}: ${JSON.stringify(data)}`);return {data,cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const login=async(username='admin',status=200)=>(await api('/api/login',{username,password},null,'POST',status));
  const get=async(path,cookie)=>(await api(path,null,cookie)).data;
  try {
    await start();let admin=(await login()).cookie;await api('/api/sim',{speed:0},admin);
    const old=await get('/api/state',admin);await api('/api/layout',{nodes:old.layout.nodes.filter(n=>n.type==='hq'),links:[],baseVersion:old.layoutVersion,operationKey:'account-clear'},admin,'PUT');
    await stop();const reset=spawnSync(process.execPath,['scripts/new-cycle.mjs','--apply','--confirm','NEW-CYCLE'],{env,encoding:'utf8',windowsHide:true});assert.equal(reset.status,0,reset.stderr);
    await start();admin=(await login()).cookie;
    const create=async body=>(await api('/api/entities',body,admin)).data.node;
    const entities=async()=>{
      const b1=await create({type:'main',label:'قاعدة متشابهة',pos:[24.7,46.7]}),b2=await create({type:'main',label:'قاعدة متشابهة',pos:[25,47]});
      const p1=await create({type:'fsb',label:'مركز متشابه',baseId:b1.id,pos:[24.71,46.7]}),p2=await create({type:'fsb',label:'مركز متشابه',baseId:b2.id,pos:[25.01,47]});
      const u1=await create({type:'unit',label:'وحدة متشابهة',baseId:b1.id,pos:[24.72,46.7]}),u2=await create({type:'unit',label:'وحدة متشابهة',baseId:b2.id,pos:[25.02,47]});
      return {b1,b2,p1,p2,u1,u2};
    };
    return {folder,password,url,env,api,get,login,start,stop,admin,entities};
  } catch(e){await stop();throw e;}
}

async function run() {
  const f=await assignmentFixture(),{api,get,login,password}=f;let admin=f.admin;
  try {
    assert.equal((await get('/api/state',admin)).layout.nodes.length,1);
    for(const role of ['user','base_manager'])await api('/api/users',{username:'no.entity',password,role},admin,'POST',400);
    const {b1,b2,p1,p2,u1,u2}=await f.entities();
    for(const body of [{role:'user',unitId:'وحدة متشابهة'},{role:'user',unitId:u1.id},{role:'base_manager',baseId:'missing'},{role:'unexpected',unitId:u1.unitId}])await api('/api/users',{username:'invalid',password,...body},admin,'POST',400);
    for(const body of [{username:'scope.commander',role:'admin',baseId:b2.id,unitId:u2.unitId},{username:'scope.base',role:'base_manager',baseId:b1.id},{username:'scope.unit',role:'user',unitId:u1.unitId,baseId:b2.id}])await api('/api/users',{password,...body},admin);
    let list=await get('/api/users',admin);assert.equal(list.find(u=>u.username==='scope.unit').baseId,b1.id);assert.equal(list.find(u=>u.username==='scope.commander').baseId,null);assert.equal(list.find(u=>u.username==='scope.commander').unitId,null);
    assert(list.every(u=>!('password'in u)));
    const commander=(await login('scope.commander')).cookie,manager=(await login('scope.base')).cookie,officer=(await login('scope.unit')).cookie;
    const assertScope=async(cookie,unitIds,ids)=>{const s=await get('/api/state',cookie);assert.deepEqual(s.layout.nodes.filter(n=>n.type==='unit').map(n=>n.unitId).sort(),unitIds.sort());assert.deepEqual(s.layout.nodes.map(n=>n.id).sort(),ids.sort());return s;};
    await assertScope(manager,[u1.unitId],[b1.id,p1.id,u1.id,'hq-riyadh']);const unitState=await assertScope(officer,[u1.unitId],[b1.id,p1.id,u1.id]);assert.deepEqual(unitState.depots,{});
    assert.equal((await get('/api/state',commander)).layout.nodes.length,7);
    await api('/api/users',{username:'forbidden',password,role:'admin'},manager,'POST',403);
    await api('/api/users/scope.unit',{role:'admin'},officer,'PUT',403);
    await api('/api/requests',{unitId:u2.unitId,mode:'heli',items:[{resource:'azm_helmet',qty:1}]},manager,'POST',403);
    const ownOrder=(await api('/api/requests',{unitId:u2.unitId,mode:'heli',items:[{resource:'azm_helmet',qty:1}]},officer)).data;
    assert.equal(ownOrder.unitId,u1.unitId,'unit role cannot redirect the request using a client unitId');
    await api(`/api/requests/${ownOrder.id}/reject`,{reason:'temporary test cleanup'},admin);
    await api(`/api/depots/${b2.id}/transfer`,{to:p2.id,resource:'azm_helmet',qty:1},manager,'POST',403);
    const oldList=await get('/api/users',admin);await api('/api/users/scope.unit',{unitId:'missing'},admin,'PUT',400);assert.deepEqual(await get('/api/users',admin),oldList);
    await api('/api/users/scope.unit',{unitId:u2.unitId,baseId:b1.id},admin,'PUT');assert.equal((await get('/api/me',officer)).baseId,b2.id);await assertScope(officer,[u2.unitId],[b2.id,p2.id,u2.id]);
    await api('/api/users/scope.base',{baseId:b2.id},admin,'PUT');await assertScope(manager,[u2.unitId],[b2.id,p2.id,u2.id,'hq-riyadh']);
    await api('/api/users/scope.unit',{role:'base_manager',baseId:b1.id},admin,'PUT');await assertScope(officer,[u1.unitId],[b1.id,p1.id,u1.id,'hq-riyadh']);
    await api('/api/users/scope.unit',{role:'user',unitId:u1.unitId},admin,'PUT');
    await api(`/api/entities/${u1.id}`,null,admin,'DELETE');
    assert.equal((await get('/api/users',admin)).find(u=>u.username==='scope.unit').assignmentValid,false);
    for(const path of ['/api/me','/api/state','/api/reports','/api/movements','/api/events','/api/chats'])await api(path,null,officer,'GET',401);
    assert.equal((await login('scope.unit',403)).data.error,'account_assignment_required');
    await api('/api/users/scope.unit',{fullName:'Changed profile'},admin,'PUT',400);
    await api('/api/users/scope.unit',{unitId:u2.unitId},admin,'PUT');await assertScope(officer,[u2.unitId],[b2.id,p2.id,u2.id]);
    await api(`/api/entities/${p1.id}`,null,admin,'DELETE');await api(`/api/entities/${b1.id}`,null,admin,'DELETE');
    await api('/api/users/scope.base',{baseId:b1.id},admin,'PUT',400);
    // جهة مسؤول القاعدة تُحذف بعد إزالة توابعها، ولا يُعاد ربطه بأول قاعدة متاحة.
    await api('/api/users/scope.base',{baseId:b2.id},admin,'PUT');await api(`/api/entities/${u2.id}`,null,admin,'DELETE');await api(`/api/entities/${p2.id}`,null,admin,'DELETE');await api(`/api/entities/${b2.id}`,null,admin,'DELETE');
    await api('/api/state',null,manager,'GET',401);assert.equal((await login('scope.base',403)).data.error,'account_assignment_required');
    assert.equal((await get('/api/users',admin)).find(u=>u.username==='scope.base').baseId,b2.id);
    await f.stop();await f.start();admin=(await login()).cookie;assert.equal((await get('/api/users',admin)).find(u=>u.username==='scope.unit').assignmentValid,false);await login('scope.unit',403);
    console.log('All checks passed (account assignment: fresh cycle, duplicate names, stable IDs/base, three roles, edit/live scopes, deleted entities, blocked APIs/login, restart)');
  } finally {await f.stop();}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))await run();
