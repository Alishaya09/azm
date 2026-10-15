// دورة كاملة على بيانات ومنافذ مؤقتة، بما فيها أداة البداية الجديدة والاسترجاع.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { verifyBackup } from '../server/store/cycle.mjs';

const root=process.cwd(),folder=mkdtempSync(join(tmpdir(),'azm-new-cycle-')),dir=join(folder,'data');
const password='cycle-temporary-password',wait=ms=>new Promise(r=>setTimeout(r,ms));
const port=await new Promise(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const url=`http://127.0.0.1:${port}`,env={...process.env,AZM_DATA_DIR:dir,AZM_AI_PROVIDER:'none',AZM_ADMIN_PASSWORD:password,HOST:'127.0.0.1',PORT:String(port),AZM_HOUR_MS:'1000'};
let server,expectedOrphans;
const cli=(args,ok=true)=>{const r=spawnSync(process.execPath,['scripts/new-cycle.mjs','--data-dir',dir,...args],{env,encoding:'utf8',windowsHide:true});assert.equal(r.status,ok?0:1,r.stderr);return ok?JSON.parse(r.stdout):r.stderr;};
const request=async(path,body,cookie,method=body?'POST':'GET',status=200)=>{
  const r=await fetch(url+path,{method,headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();assert.equal(r.status,status,`${path}: ${JSON.stringify(data)}`);return {data,cookie:r.headers.get('set-cookie')?.split(';')[0]};
};
const login=async username=>(await request('/api/login',{username,password})).cookie;
async function start(){server=spawn(process.execPath,['server.mjs'],{cwd:root,env,stdio:'ignore',windowsHide:true});for(let i=0;i<120;i++){try{await fetch(url+'/api/me');return;}catch{await wait(100);}}throw new Error('temporary_server_not_ready');}
async function stop(){if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}server=null;}
const get=(path,cookie)=>request(path,undefined,cookie).then(r=>r.data);
const shard=id=>join(dir,'entities',Buffer.from(id).toString('hex')+'.sqlite');
try {
  await start();let admin=await login('admin');await request('/api/sim',{speed:0},admin);
  let s=await get('/api/state',admin),hq=s.layout.nodes.find(n=>n.type==='hq');assert(hq.fixed);
  await request('/api/catalog/azm_diesel',{weight:.31},admin,'PUT');
  await request('/api/users',{username:'old.manager',password,role:'base_manager',baseId:'base'},admin);
  s=await get('/api/state',admin);
  cpSync(shard('base'),shard('old-orphan'));
  await request('/api/layout',{nodes:[hq],links:[],baseVersion:s.layoutVersion,operationKey:'old-map-clear'},admin,'PUT');
  assert.match(cli(['--apply','--confirm','NEW-CYCLE'],false),/server_running/);
  assert(!existsSync(join(folder,'.data-cycle-transaction.json')));
  await stop();
  // بقية سجل طلب قديم وكمية مخفية وملف استعادة مؤقت، لا يجوز أن يعيدها الإقلاع إلى الدورة الجديدة.
  const raw=JSON.parse(readFileSync(join(dir,'state.json'),'utf8'));
  raw.unassignedRequests.push({id:'OLD-PENDING',unitId:'OLD-UNIT',status:'pending',items:[{resource:'azm_helmet',qty:1}]});
  raw.depots={'old-hidden':{azm_helmet:4}};writeFileSync(join(dir,'state.json'),JSON.stringify(raw));
  const before=cli(['--inspect']);assert.equal(before.headquarters.length,1);assert.equal(before.liveEntities,0);assert(before.orphanAccounts.some(u=>u.username==='old.manager'));expectedOrphans=before.orphanAccounts.length;assert(before.shards.some(x=>x.id==='old-orphan'&&!x.indexed));assert(before.hiddenBalances.length);assert(before.activeRequests.some(r=>r.id==='OLD-PENDING'));
  const result=cli(['--apply','--confirm','NEW-CYCLE']);verifyBackup(result.backup);
  assert.equal(result.removedAccounts,expectedOrphans);assert.equal(result.after.activeRequests.length,0);assert.equal(result.after.archivedEntities,0);assert.equal(result.after.shards.length,0);
  const preserved=JSON.parse(readFileSync(join(result.backup,'data','users.json'),'utf8')).filter(u=>u.role==='admin');
  assert.deepEqual(JSON.parse(readFileSync(join(dir,'users.json'),'utf8')),preserved);
  const fresh=JSON.parse(readFileSync(join(dir,'state.json'),'utf8'));assert.deepEqual(fresh.catalog,raw.catalog);assert.deepEqual(fresh.layout.nodes,[hq]);assert.equal(fresh.sim.hours,0);assert.equal(fresh.sim.speed,0);assert.equal(fresh.audit.length,0);assert.equal(fresh.movements.length,0);assert.deepEqual(JSON.parse(readFileSync(join(dir,'chats.json'),'utf8')),{});
  await start();admin=await login('admin');s=await get('/api/state',admin);assert.deepEqual(s.layout.nodes,[hq]);assert.equal(s.requests.length,0);assert.equal(s.logs.length,0);assert.equal(s.operationCycle.id,result.cycle.id);
  assert.deepEqual(s.catalog,raw.catalog,'commander catalogue edits survive a new cycle and restart');
  let report=await get('/api/reports',admin);assert.equal(report.entities.length,0);assert.equal(report.requests.total,0);assert.equal(report.operationCycle.id,result.cycle.id);
  const b1body={type:'main',label:'Cycle base A',pos:[24.7,46.7],operationKey:'cycle-base-a'};
  const b1=(await request('/api/entities',b1body,admin)).data.node;
  await request('/api/entities',b1body,admin);
  s=await get('/api/state',admin);
  const b2={id:'cycle-base-b',type:'main',label:'Cycle base B',pos:[25,47]};
  const mapBase={nodes:[...s.layout.nodes,b2],links:[],baseVersion:s.layoutVersion,operationKey:'cycle-map-base'};
  await request('/api/layout',mapBase,admin,'PUT');await request('/api/layout',mapBase,admin,'PUT');
  const p1=(await request('/api/entities',{type:'fsb',label:'Cycle point A',baseId:b1.id,pos:[24.71,46.7],operationKey:'cycle-point-a'},admin)).data.node;
  s=await get('/api/state',admin);
  const p2={id:'cycle-point-b',type:'fsb',label:'Cycle point B',baseId:b2.id,pos:[25.01,47]},u2={id:'u-UNIT-002',type:'unit',unitId:'UNIT-002',label:'Cycle unit B',baseId:b2.id,people:500,vehicles:40,pos:[25.02,47]};
  const mapKids={nodes:[...s.layout.nodes,p2,u2],links:[],baseVersion:s.layoutVersion,operationKey:'cycle-map-children'};
  await request('/api/layout',mapKids,admin,'PUT');await request('/api/layout',mapKids,admin,'PUT');
  const u1=(await request('/api/entities',{type:'unit',label:'Cycle unit A',baseId:b1.id,pos:[24.72,46.7],people:500,vehicles:40,operationKey:'cycle-unit-a'},admin)).data.node;
  s=await get('/api/state',admin);const active=s.catalog.filter(c=>c.active);assert.equal(active.length,40);
  const nodes=s.layout.nodes.filter(n=>n.type!=='hq');assert.equal(nodes.length,6);assert.equal(new Set(nodes.map(n=>n.code)).size,6);
  assert.equal(readdirSync(join(dir,'entities')).filter(f=>f.endsWith('.sqlite')).length,6);
  for(const n of nodes){const db=new DatabaseSync(shard(n.id),{readOnly:true});const row=db.prepare('SELECT * FROM entity').get();assert.equal(row.id,n.id);assert.equal(row.unit_id,n.unitId||null);assert.equal(row.base_id,n.type==='main'?n.id:n.baseId);db.close();}
  for(const [b,p,u] of [[b1,p1,u1],[b2,p2,u2]]) {
    assert.equal(s.layout.nodes.find(n=>n.id===u.id).allowedResources.length,40);
    for(const c of active) {assert.equal(s.inventory[b.id].opening[c.key],0);assert.equal(s.depots[b.id][c.key],c.capacity.main-c.capacity.fsb);assert.equal(s.depots[p.id][c.key],c.capacity.fsb);assert.equal(s.inventory[u.id].qty[c.key],0);}
  }
  report=await get('/api/reports',admin);assert.equal(report.virtualSupply.length,80);assert(report.virtualSupply.every(m=>m.reason==='base_initial_fill'));
  const initial=(await get('/api/movements?limit=200',admin)).movements.filter(m=>m.reason==='base_initial_fill');assert.equal(initial.length,80);
  assert(initial.every(m=>m.from.entityId===hq.id&&m.from.code===hq.code&&m.from.unlimited&&m.from.before===null&&m.from.after===null&&m.to.code&&m.to.before===0&&m.to.after===m.qty&&m.by==='admin'&&m.role==='admin'&&m.at&&m.opId));
  for(const b of [b1,b2])assert.equal(new Set(initial.filter(m=>m.to.entityId===b.id).map(m=>m.opId)).size,1);
  for(const c of active){assert.equal(report.hqOutgoing.totals[c.key].total,c.capacity.main*2);for(const b of [b1,b2]){const e=report.entities.find(e=>e.id===b.id);assert.equal(e.rows[c.key].initial,0);assert.equal(e.rows[c.key].external_add,c.capacity.main);assert.equal(e.rows[c.key].closing,e.rows[c.key].current);}}
  await request('/api/entities/hq-riyadh',undefined,admin,'DELETE',409);
  await request('/api/layout',{nodes:s.layout.nodes.map(n=>n.type==='hq'?{...n,pos:[0,0]}:n),links:[],baseVersion:s.layoutVersion},admin,'PUT',409);
  for(const x of [{username:'cycle.manager',role:'base_manager',baseId:b1.id},{username:'cycle.officer',role:'user',unitId:u1.unitId}])await request('/api/users',{...x,password},admin);
  const manager=await login('cycle.manager'),officer=await login('cycle.officer');
  await request('/api/entities',{type:'main',label:'Forbidden',pos:[20,40]},manager,'POST',403);
  await request('/api/catalog/azm_diesel',{weight:1},officer,'PUT',403);
  await request('/api/requests',{unitId:u2.unitId,mode:'heli',items:[{resource:'azm_helmet',qty:1}]},manager,'POST',403);
  await request('/api/inventory/add',{baseId:b1.id,items:[{resource:'azm_helmet',qty:1}],reason:'forbidden'},manager,'POST',403);
  const orderBody={unitId:u1.unitId,mode:'heli',items:[{resource:'azm_bottled_water',qty:1000},{resource:'azm_diesel',qty:500},{resource:'azm_helmet',qty:5}],operationKey:'cycle-order-one'};
  const order=(await request('/api/requests',orderBody,officer)).data;assert.equal((await request('/api/requests',orderBody,officer)).data.id,order.id);
  s=await get('/api/state',admin);const pointBefore={...s.depots[p1.id]};assert.equal(s.inventory[u1.id].qty.azm_diesel,0);
  const route={fromId:p1.id,path:[p1.pos,u1.pos],km:2,hours:.01};
  await request(`/api/requests/${order.id}/approve`,{route,operationKey:'cycle-approve-one'},officer,'POST',403);
  await request(`/api/requests/${order.id}/approve`,{route,operationKey:'cycle-approve-one'},manager);await request(`/api/requests/${order.id}/approve`,{route,operationKey:'cycle-approve-one'},manager);
  s=await get('/api/state',admin);assert.equal(s.depots[p1.id].azm_diesel,pointBefore.azm_diesel-500);assert.equal(s.inventory[u1.id].qty.azm_diesel,0);assert.equal(s.inventory[u1.id].inTransit.azm_diesel,500);
  await request('/api/sim',{speed:1},admin);
  for(let i=0;i<100;i++){s=await get('/api/state',admin);if(s.requests.find(r=>r.id===order.id).status==='delivered')break;await wait(100);}
  assert.equal(s.requests.find(r=>r.id===order.id).status,'delivered');const delivered={...s.inventory[u1.id].qty};assert.equal(delivered.azm_helmet,5);assert(delivered.azm_diesel>0);
  await wait(350);s=await get('/api/state',admin);assert(s.inventory[u1.id].qty.azm_diesel<delivered.azm_diesel);assert.equal(s.inventory[u1.id].qty.azm_helmet,5);assert.equal(s.depots[p1.id].azm_diesel,pointBefore.azm_diesel-500);
  await request('/api/sim',{speed:0},admin);s=await get('/api/state',admin);report=await get('/api/reports',admin);assert.equal(report.requests.total,1);assert(report.entities.find(e=>e.id===u1.id).rows.azm_diesel.consumption>0);
  const qty=structuredClone(s.inventory),requestCount=s.requests.length,opCount=report.hqOutgoing.shipments.length;
  await stop();assert.match(cli(['--apply','--confirm','NEW-CYCLE'],false),/remove_entities/);
  await start();admin=await login('admin');s=await get('/api/state',admin);assert.deepEqual(s.inventory,qty);assert.equal(s.requests.length,requestCount);assert.equal((await get('/api/reports',admin)).hqOutgoing.shipments.length,opCount);
  await stop();const restored=cli(['--restore',result.backup,'--confirm','RESTORE']);verifyBackup(restored.backup);
  const old=cli(['--inspect']);assert.equal(old.liveEntities,0);assert(old.activeRequests.some(r=>r.id==='OLD-PENDING'));assert.equal(old.orphanAccounts.length,expectedOrphans);assert(existsSync(shard('old-orphan')));
  assert.deepEqual(JSON.parse(readFileSync(join(dir,'state.json'),'utf8')).catalog,raw.catalog);
  // الاسترجاع يرفض نسخة متضررة قبل أي استبدال، والإقلاع محظور أثناء عملية متقطعة.
  const bad=join(folder,'bad-backup');mkdirSync(bad);cpSync(join(result.backup,'data'),join(bad,'data'),{recursive:true});cpSync(join(result.backup,'manifest.json'),join(bad,'manifest.json'));
  writeFileSync(join(bad,'data','state.json'),'{}');const untouched=readFileSync(join(dir,'state.json'),'utf8');
  assert.match(cli(['--restore',bad,'--confirm','RESTORE'],false),/backup_verification_failed/);assert.equal(readFileSync(join(dir,'state.json'),'utf8'),untouched);
  const transaction=join(folder,'.data-cycle-transaction.json');
  writeFileSync(transaction,JSON.stringify({version:1,pid:2147483647,action:'new-cycle',dataDir:dir,backup:result.backup,stage:join(result.backup,'stage'),displaced:join(result.backup,'displaced'),phase:'installed'}));
  const refused=spawnSync(process.execPath,['server.mjs'],{env,encoding:'utf8',windowsHide:true,timeout:5000});assert.equal(refused.status,1);assert.match(refused.stderr,/unfinished offline cycle/);
  const recovery=cli(['--recover','--confirm','RECOVER']);assert.equal(recovery.recovered,'previous_directory');assert(!existsSync(transaction));
  assert.equal(cli(['--inspect']).historicalRequests,old.historicalRequests);
  console.log('All checks passed (new cycle: offline lock, complete verified backup, HQ only, archive/orphan cleanup, two bases/centers/units, SQLite, HQ opening ledger, roles, idempotency, delivery, consumption, report, restart, restore)');
  console.log('Temporary cycle evidence: '+folder);
} finally {await stop();}
