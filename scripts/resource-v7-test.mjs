// فحص سياسة الموارد الجديدة على مجلد مؤقت فقط. لا يقرأ data/ الحقيقي.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'azm-resources-v7-'));
const port = 6000 + Math.floor(Math.random()*2000), base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [join(root,'server.mjs')], { env: { ...process.env, PORT:String(port), AZM_DATA_DIR:dir, AZM_ADMIN_PASSWORD:'resource-test-password', AZM_AI_PROVIDER:'none', AZM_HOUR_MS:'1000' }, stdio:'ignore' });
let checks=0;
const assert = (cond,msg) => { if(!cond) throw new Error(msg); checks++; };
const call = async (path, cookie, method='GET', body) => { const r=await fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}; };
try {
  for(let i=0;i<80;i++){try {await fetch(base+'/api/me');break;}catch {await new Promise(r=>setTimeout(r,100));}}
  const cookie=(await call('/api/login',null,'POST',{username:'admin',password:'resource-test-password'})).cookie;
  assert(!!cookie,'admin login');
  let s=(await call('/api/state',cookie)).body;
  const retired=['ammo','fuel','food','medical'];
  assert(s.catalog.length===40 && retired.every(k=>!s.catalog.some(c=>c.key===k)),'only 40 detailed catalog items');
  const userPass=readFileSync(join(dir,'FIRST_RUN_CREDENTIALS.txt'),'utf8').match(/user01 \/ (\S+)/)[1];
  const userCookie=(await call('/api/login',null,'POST',{username:'user01',password:userPass})).cookie;
  assert(Object.values(s.stocks).every(stock=>retired.every(k=>!(k in stock))),'no retired unit balances');
  assert(Object.values(s.depots).every(stock=>retired.every(k=>!(k in stock))),'no retired depot balances');
  const baseNode=s.layout.nodes.find(n=>n.type==='main');
  for(const c of s.catalog) assert(s.depots[baseNode.id][c.key]===c.capacity.main,`${c.key}: base starts full`);
  const srcBefore={...s.depots[baseNode.id]};
  const point=(await call('/api/entities',cookie,'POST',{type:'fsb',label:'نقطة اختبار',baseId:baseNode.id,pos:[24.75,46.75],operationKey:'create-center'}));
  assert(point.status===200,'full supply point created');
  let filled=(await call('/api/state',cookie)).body;
  for(const c of s.catalog) {
    assert(filled.depots[point.body.node.id][c.key]===c.capacity.fsb,`${c.key}: center starts full`);
    assert(filled.depots[baseNode.id][c.key]===srcBefore[c.key]-c.capacity.fsb,`${c.key}: initial fill debited from base`);
  }
  const createReplay=await call('/api/entities',cookie,'POST',{type:'fsb',label:'نقطة اختبار',baseId:baseNode.id,pos:[24.75,46.75],operationKey:'create-center'});
  assert(createReplay.status===200 && createReplay.body.node.id===point.body.node.id,'creation replay returns original center');
  const initialMoves=(await call('/api/movements?limit=200',cookie)).body.movements.filter(m=>m.to?.entityId===point.body.node.id);
  assert(initialMoves.length===s.catalog.length && new Set(initialMoves.map(m=>m.opId)).size===1,'initial fill records all catalog items in one operation');
  assert(initialMoves.every(m=>m.from.before-m.from.after===m.qty && m.to.after-m.to.before===m.qty && m.by==='admin' && m.at),'initial fill audit contains balances, actor and time');
  // Restore an empty center through recorded transfers to reproduce the previous empty-source scenario.
  const drained=await call(`/api/depots/${point.body.node.id}/transfer`,cookie,'POST',{to:baseNode.id,operationKey:'drain-center',items:s.catalog.map(c=>({resource:c.key,qty:c.capacity.fsb}))});
  assert(drained.status===200,'empty-center fixture is ledger backed');
  const empty=(await call('/api/entities',cookie,'POST',{type:'unit',label:'لا مخزون',baseId:baseNode.id,sourceId:point.body.node.id,pos:[24.78,46.78]}));
  assert(empty.status===200&&Object.values(empty.body.inventory.opening).every(q=>q===0),'unit can be created without stock and receives no phantom opening balance');
  const made=await call('/api/entities',cookie,'POST',{type:'unit',label:'وحدة تجربة',baseId:baseNode.id,sourceId:baseNode.id,pos:[24.8,46.8],fuelType:'azm_diesel'});
  assert(made.status===200,`create unit ${JSON.stringify(made.body)}`);
  s=(await call('/api/state',cookie)).body;
  const n=made.body.node;
  // سياسة v8: الأصناف التشغيلية فقط (الغذاء الخمسة + نوع الوقود المحدد)، لا الأربعين
  assert(n.allowedResources.join()===s.catalog.map(c=>c.key).join(),'all active catalog resources assigned');
  for(const c of s.catalog) {
    assert(s.inventory[n.id].qty[c.key]===0,`${c.key}: assignment starts at zero`);
    assert(s.depots[baseNode.id][c.key]===srcBefore[c.key],`${c.key}: creation does not debit base`);
    assert(s.inventory[n.id].capacity[c.key]>0,`${c.key}: unit capacity is independent of stock`);
  }
  const movements=(await call('/api/movements?limit=200',cookie)).body.movements;
  assert(!movements.some(m=>m.to?.entityId===n.id),'assignment creates no stock movement');
  const report=await call('/api/reports',cookie);
  assert(report.status===200&&report.body.resources.length===40,'reports use 40 current resources');
  const unitRows=report.body.entities.find(e=>e.id===n.id)?.rows;
  assert(s.catalog.every(c=>Math.abs(unitRows[c.key].closing-unitRows[c.key].current)<2),`report balances match unit stock: ${JSON.stringify(s.catalog.filter(c=>Math.abs(unitRows[c.key].closing-unitRows[c.key].current)>=2).slice(0,3).map(c=>[c.key,unitRows[c.key]]))}`);
  for(const k of n.allowedResources){const moved=await call(`/api/depots/${baseNode.id}/transfer`,cookie,'POST',{to:point.body.node.id,resource:k,qty:1});assert(moved.status===200,`${k}: center receives recorded transfer`);}
  const supplied=await call('/api/entities',cookie,'POST',{type:'unit',label:'zero stock unit',baseId:baseNode.id,sourceId:point.body.node.id,pos:[24.77,46.76]});
  assert(supplied.status===200,'unit can be created under its base');
  const afterCenter=(await call('/api/state',cookie)).body;
  assert(s.catalog.every(c=>afterCenter.depots[point.body.node.id][c.key]===1&&afterCenter.inventory[supplied.body.node.id].qty[c.key]===0),'unit creation cannot consume or invent center stock');
  assert((await call(`/api/depots/${point.body.node.id}/transfer`,cookie,'POST',{to:baseNode.id,items:s.catalog.map(c=>({resource:c.key,qty:1})),operationKey:'restore-center'})).status===200,'restore empty center through ledger');
  assert(supplied.body.node.baseId===baseNode.id,'unit remains linked to base, not supply point');
  assert((await call('/api/users',cookie,'POST',{username:'bm.v7',password:'bm-v7-secret',role:'base_manager',baseId:baseNode.id})).status===200,'commander creates base manager');
  assert((await call('/api/users',cookie,'POST',{username:'um.v7',password:'um-v7-secret',role:'user',unitId:n.unitId})).status===200,'commander creates unit manager');
  const baseCookie=(await call('/api/login',null,'POST',{username:'bm.v7',password:'bm-v7-secret'})).cookie;
  const ownCookie=(await call('/api/login',null,'POST',{username:'um.v7',password:'um-v7-secret'})).cookie;
  const [commanderView,baseView,unitView]=await Promise.all([call('/api/state',cookie),call('/api/state',baseCookie),call('/api/state',ownCookie)]);
  assert(commanderView.body.user.role==='admin'&&baseView.body.user.role==='base_manager'&&unitView.body.user.role==='user','three independent role sessions');
  assert(baseView.body.layout.nodes.some(x=>x.id===supplied.body.node.id)&&baseView.body.depots[baseNode.id],'base manager sees own depots and units');
  assert(unitView.body.layout.nodes.filter(x=>x.type==='unit').map(x=>x.unitId).join()===n.unitId&&Object.keys(unitView.body.depots).length===0,'unit manager sees only self and no depot balances');
  assert((await call('/api/entities',baseCookie,'POST',{type:'main',label:'ممنوع',pos:[25,46]})).status===403,'base manager cannot create entities');
  assert((await call('/api/inventory/add',baseCookie,'POST',{baseId:baseNode.id,items:[{resource:'azm_mre',qty:1}],reason:'ممنوع'})).status===403,'base manager cannot fill base');
  // Batch transfers validate every item before any debit and replay the persisted result.
  const dest=point.body.node.id, keys=s.catalog.slice(0,2).map(c=>c.key);
  const transfer=(items,operationKey,who=cookie,to=dest,from=baseNode.id)=>call(`/api/depots/${from}/transfer`,who,'POST',{to,items,operationKey});
  const beforeBatch=(await call('/api/state',cookie)).body;
  const failed=await transfer([{resource:keys[0],qty:1},{resource:keys[1],qty:10000000}],'batch-short');
  assert(failed.status===409&&failed.body.failures.length===1,'batch reports insufficient source');
  const afterFailed=(await call('/api/state',cookie)).body;
  assert(keys.every(k=>afterFailed.depots[baseNode.id][k]===beforeBatch.depots[baseNode.id][k]&&afterFailed.depots[dest][k]===beforeBatch.depots[dest][k]),'failed batch changes no balances');
  const items=keys.map(resource=>({resource,qty:1}));
  const twice=await Promise.all([transfer(items,'batch-double',baseCookie),transfer(items,'batch-double',baseCookie)]);
  assert(twice.every(r=>r.status===200)&&twice[0].body.opId===twice[1].body.opId,'double click returns one operation');
  const afterBatch=(await call('/api/state',cookie)).body;
  assert(keys.every(k=>afterBatch.depots[baseNode.id][k]===beforeBatch.depots[baseNode.id][k]-1&&afterBatch.depots[dest][k]===beforeBatch.depots[dest][k]+1),'double click debits and credits once');
  const batchLedger=(await call('/api/movements?limit=200',cookie)).body.movements.filter(m=>m.opId===twice[0].body.opId);
  assert(batchLedger.length===2&&batchLedger.every(m=>m.type==='transfer'),'one movement per item under one operation');
  assert((await transfer(items,'batch-user',ownCookie)).status===403,'unit manager cannot batch transfer');
  assert((await transfer(items,'batch-unit',cookie,n.id)).status===400,'batch cannot bypass unit request approval');
  assert((await transfer([{resource:'not_assigned',qty:1}],'batch-invalid')).status===400,'unknown resource rejected');
  const cap=afterBatch.inventory[dest].capacity[keys[0]], gap=cap-afterBatch.depots[dest][keys[0]];
  assert((await transfer([{resource:keys[0],qty:gap}],'batch-fill')).status===200,'destination can fill exactly');
  const full=await transfer(items,'batch-full');
  assert(full.status===409&&full.body.failures.some(f=>f.error==='over_capacity'),'full destination rejects whole batch');
  const other=await call('/api/entities',cookie,'POST',{type:'main',label:'Batch other base',pos:[25,47]});
  assert((await transfer(items,'batch-scope',baseCookie,other.body.node.id)).status===403,'base manager cannot cross scope');
  assert((await transfer(items,'batch-reason',cookie,other.body.node.id)).body.error==='cross_base_reason_required','cross base requires reason');
  const requested=await call('/api/requests',cookie,'POST',{unitId:n.unitId,mode:'truck',priority:'normal',items:[{resource:'azm_diesel',amount:5}]});
  assert(requested.status===200&&requested.body.status==='pending','unit requests detailed resource');
  // v8: قرار القائد لا يخصم ولا يطلق شحنة؛ مسؤول القاعدة يباشر التنفيذ
  const shipment=await call(`/api/requests/${requested.body.id}/approve`,cookie,'POST',{route:{fromId:baseNode.id,path:[baseNode.pos,n.pos],km:30,hours:1}});
  assert(shipment.status===200&&shipment.body.status==='assigned'&&!shipment.body.dispatched,'commander decision assigns without dispatch');
  const executed=await call(`/api/requests/${requested.body.id}/execute`,baseCookie,'POST',{operationKey:'v7-exec'});
  assert(executed.status===200&&executed.body.status==='approved','base manager dispatches detailed resource');
  const replay=await call(`/api/requests/${requested.body.id}/approve`,cookie,'POST',{route:{fromId:baseNode.id,path:[baseNode.pos,n.pos],km:30,hours:1}});
  assert(replay.status!==200,'replayed approval cannot deduct again');
  assert((await call(`/api/requests/${requested.body.id}/execute`,baseCookie,'POST',{operationKey:'v7-exec-2'})).status!==200,'replayed execution cannot deduct again');
  const maintained=s.catalog.find(c=>c.usage==='maintenance');
  await call('/api/sim',cookie,'POST',{speed:20});
  await new Promise(r=>setTimeout(r,3100));
  const worn=(await call('/api/state',cookie)).body;
  assert(worn.requests.find(r=>r.id===requested.body.id)?.status==='delivered','shipment delivered once');
  // لا نظام صيانة في هذه المرحلة: المحاكاة لا تُدهور المعدات ولا تُصدر حركات maintenance_due
  assert(!worn.inventory[n.id].maintenance?.[maintained.key]?.due,'simulation does not flag equipment for maintenance');
  assert(!worn.inventory[n.id].qty[maintained.key],'non-operational equipment is neither assigned nor consumed');
  assert(worn.inventory[n.id].qty.azm_diesel<executed.body.dispatched[0].qty,'simulation consumes received fuel without a fuel selection');
  assert(worn.inventory[n.id].qty.azm_bottled_water===0,'unreceived water remains zero without consumption');
  const dueMoves=(await call('/api/movements?limit=200',cookie)).body.movements;
  assert(!dueMoves.some(m=>m.type==='maintenance_due'),'no maintenance due movements generated');
  const audit=await call('/api/audit?limit=200',cookie);
  assert(audit.status===200&&audit.body.total>0,'permanent operation audit available');
  assert(!JSON.stringify(audit.body).includes('bm-v7-secret'),'audit never exposes password');
  assert((await call(`/api/entities/${n.id}/maintenance`,cookie,'POST',{resource:maintained.key,reason:'فحص دوري'})).status===400,'no maintenance record for an item the unit does not hold');
  assert((await call(`/api/entities/${n.id}/maintenance`,userCookie,'POST',{resource:maintained.key,reason:'غير مصرح'})).status===403,'unit user cannot mark maintenance');
  assert((await call('/api/inventory/add',userCookie,'POST',{baseId:baseNode.id,items:[{resource:'azm_mre',qty:1}],reason:'غير مصرح'})).status===403,'unit user cannot fill base');
  // حالة قديمة صغيرة: رصيد من الأصناف الأربع، طلب مفتوح، وقاعدة تحتاج تعبئة الأربعين.
  const legacyDir=mkdtempSync(join(tmpdir(),'azm-v6-migrate-'));
  const legacyPort=port+1, legacyBase=`http://127.0.0.1:${legacyPort}`;
  const old={schemaVersion:6,layoutVersion:3,layout:{nodes:[{id:'oldbase',type:'main',label:'قديم',pos:[24,46]},{id:'u-UNIT-01',unitId:'UNIT-01',type:'unit',label:'قديمة',baseId:'oldbase',allowedResources:['fuel'],pos:[24.1,46.1]}],links:[]},
    catalog:[{key:'fuel',measure:'liter',capacity:{main:1000,fsb:100},unitBasis:'fixed',unitFactor:100,active:true,weight:1},
      {key:'azm_bottled_water',measure:'liter',unit:{ar:'liter',en:'liter'},capacity:{main:1080000,fsb:108000},unitBasis:'fixed',unitFactor:10800,active:true,weight:0,training:{item:'bottled water'}}],
    depots:{oldbase:{fuel:70,azm_bottled_water:200}},stocks:{'UNIT-01':{fuel:50,azm_bottled_water:10}},inventory:{oldbase:{entityId:'oldbase',type:'main',opening:{fuel:70,azm_bottled_water:200},openingAt:Date.now()-1000},'u-UNIT-01':{entityId:'u-UNIT-01',type:'unit',unitId:'UNIT-01',opening:{fuel:50,azm_bottled_water:1080},openingAt:Date.now()-1000}},
    requests:[{id:'OLD-1',status:'pending',unitId:'UNIT-01',items:[{resource:'fuel',qty:1}]}],movements:[],logs:[],sim:{hours:0,at:Date.now(),speed:0,emergency:false}};
  const entities=join(legacyDir,'entities');mkdirSync(entities);
  const oldRecords=[{id:'oldbase',type:'main',base:'oldbase',unit:null,stock:null,depot:old.depots.oldbase,inv:old.inventory.oldbase,requests:[]},
    {id:'u-UNIT-01',type:'unit',base:'oldbase',unit:'UNIT-01',stock:old.stocks['UNIT-01'],depot:null,inv:old.inventory['u-UNIT-01'],requests:old.requests}];
  for(const row of oldRecords){const db=new DatabaseSync(join(entities,Buffer.from(row.id).toString('hex')+'.sqlite'));
    db.exec('CREATE TABLE entity (id TEXT PRIMARY KEY, type TEXT, base_id TEXT, unit_id TEXT, inventory TEXT); CREATE TABLE balances (resource TEXT PRIMARY KEY, stock REAL, depot REAL); CREATE TABLE requests (id TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE movements (id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
    db.prepare('INSERT INTO entity VALUES (?,?,?,?,?)').run(row.id,row.type,row.base,row.unit,JSON.stringify(row.inv));
    for(const resource of ['fuel','azm_bottled_water']) db.prepare('INSERT INTO balances VALUES (?,?,?)').run(resource,row.stock?.[resource]??null,row.depot?.[resource]??null);
    for(const req of row.requests)db.prepare('INSERT INTO requests VALUES (?,?)').run(req.id,JSON.stringify(req));db.close();}
  old.entityStoreVersion=2;old.entityIds=oldRecords.map(x=>x.id);
  delete old.depots;delete old.stocks;delete old.inventory;delete old.requests;delete old.movements;
  writeFileSync(join(legacyDir,'state.json'),JSON.stringify(old));
  const legacyChild=spawn(process.execPath,[join(root,'server.mjs')],{env:{...process.env,PORT:String(legacyPort),AZM_DATA_DIR:legacyDir,AZM_ADMIN_PASSWORD:'resource-test-password',AZM_AI_PROVIDER:'none'},stdio:'ignore'});
  try {
    for(let i=0;i<80;i++){try{await fetch(legacyBase+'/api/me');break;}catch{await new Promise(r=>setTimeout(r,100));}}
    const lc=(await fetch(legacyBase+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'resource-test-password'})})).headers.get('set-cookie')?.split(';')[0];
    const ls=await (await fetch(legacyBase+'/api/state',{headers:{cookie:lc}})).json();
    assert(ls.catalog.length===40&&!ls.catalog.some(c=>c.key==='fuel'),'legacy catalog retired');
    assert(!('fuel' in ls.depots.oldbase)&&!('fuel' in ls.stocks['UNIT-01']),'legacy balances removed');
    assert(ls.requests[0].status==='rejected','pending retired request stopped');
    assert(ls.catalog.every(c=>ls.depots.oldbase[c.key]===c.capacity.main),'legacy base filled');
    assert(Math.abs(ls.inventory['u-UNIT-01'].qty.azm_bottled_water-1080)<.001,'changing legacy unit capacity preserves physical quantity');
    const assign=await fetch(legacyBase+'/api/entities/u-UNIT-01/resources',{method:'PUT',headers:{cookie:lc,'Content-Type':'application/json'},body:JSON.stringify({allowedResources:ls.catalog.map(c=>c.key)})});
    assert(assign.status===200,'commander can assign a detailed item to existing unit');
    const assigned=await (await fetch(legacyBase+'/api/state',{headers:{cookie:lc}})).json();
    assert(assigned.layout.nodes.find(x=>x.id==='u-UNIT-01').allowedResources.length===40&&(!assigned.stocks['UNIT-01'].azm_diesel),'assignment does not invent stock');
    const lm=await (await fetch(legacyBase+'/api/movements?limit=200',{headers:{cookie:lc}})).json();
    assert(lm.movements.some(m=>m.type==='retirement'&&m.resource==='fuel'&&m.from?.entityId==='oldbase'&&m.qty===70),'base legacy retirement audited');
    assert(lm.movements.some(m=>m.type==='retirement'&&m.resource==='fuel'&&m.from?.entityId==='u-UNIT-01'&&m.qty===50),'unit legacy retirement audited');
    // اسم النسخة يحمل الإصدار الهدف (v6 ← v8 الآن)
    assert(readdirSync(join(legacyDir,'backups')).some(x=>/pre-v(?:[789]|10)/.test(x)),'migration backup exists');
    const shardBackup=readdirSync(join(legacyDir,'backups')).find(x=>/pre-v(?:[789]|10)/.test(x)&&x.endsWith('-entities'));
    assert(shardBackup&&readdirSync(join(legacyDir,'backups',shardBackup)).length===2,'backup contains both entity SQLite files');
    legacyChild.kill();
    await new Promise(r=>setTimeout(r,350));
    const reboot=spawn(process.execPath,[join(root,'server.mjs')],{env:{...process.env,PORT:String(legacyPort),AZM_DATA_DIR:legacyDir,AZM_ADMIN_PASSWORD:'resource-test-password',AZM_AI_PROVIDER:'none'},stdio:'ignore'});
    try {
      for(let i=0;i<80;i++){try{await fetch(legacyBase+'/api/me');break;}catch{await new Promise(r=>setTimeout(r,100));}}
      const again=(await fetch(legacyBase+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'resource-test-password'})})).headers.get('set-cookie')?.split(';')[0];
      const next=await (await fetch(legacyBase+'/api/state',{headers:{cookie:again}})).json();
      const nextMoves=await (await fetch(legacyBase+'/api/movements?limit=200',{headers:{cookie:again}})).json();
      assert(next.catalog.length===40&&next.depots.oldbase.azm_mre===ls.depots.oldbase.azm_mre,'migration persisted on restart');
      assert(nextMoves.total===lm.total,'retirement and base fill are not duplicated on restart');
    } finally {reboot.kill();}
  } finally {legacyChild.kill();rmSync(legacyDir,{recursive:true,force:true});}
  console.log(`All checks passed (${checks} resource-v7 checks)`);
} finally {
  child.kill();
  rmSync(dir,{recursive:true,force:true});
}
