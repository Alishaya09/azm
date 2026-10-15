// فحص حتمي مستقل ببيانات SQLite مؤقتة فقط: ترحيل v9 ودورة المورد ومشاركة الوقود.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';

const mode = process.argv[2];
if (!mode) {
  const dir = mkdtempSync(join(tmpdir(),'azm-unit-v10-'));
  for (const phase of ['seed','migrate','cycle','restart']) {
    const result = spawnSync(process.execPath,[import.meta.filename,phase],{env:{...process.env,AZM_DATA_DIR:dir,AZM_AI_PROVIDER:'none',AZM_ADMIN_PASSWORD:'temporary-v10-test',AZM_HOUR_MS:'60000'},stdio:'inherit',windowsHide:true});
    assert.equal(result.status,0,`v10 ${phase}`);
  }
  console.log('All checks passed (unit-policy-v10: migration, catalog, stock cycle, deterministic fuel sharing, concurrent readers, restart)');
} else {
  if (!existsSync(join(process.env.AZM_DATA_DIR,'users.json'))) writeFileSync(join(process.env.AZM_DATA_DIR,'users.json'),'[]');
  const { state, saveState, advanceSim, deliverDueConvoys, startSimClock } = await import('../server/store/state.mjs');
  const { activeKeys, resDef } = await import('../server/store/catalog.mjs');
  const { qtyAll, qtyOf, capacityOf } = await import('../server/store/hierarchy.mjs');
  const { applyMovement, allMovements, flushConsumption } = await import('../server/store/ledger.mjs');
  const { scopeOf } = await import('../server/store/scope.mjs');
  const { handleEntities } = await import('../server/routes/entities.mjs');
  const { handleLayout } = await import('../server/routes/layout.mjs');
  const { handleCatalog } = await import('../server/routes/catalog.mjs');
  const { handleRequests } = await import('../server/routes/requests.mjs');
  const { handleDepots } = await import('../server/routes/depots.mjs');
  const { handleState } = await import('../server/routes/state.mjs');
  const { buildReport } = await import('../server/store/reports.mjs');
  const dir=process.env.AZM_DATA_DIR, marker=join(dir,'v10-expected.json');
  const allBalances = () => Object.fromEntries(state.layout.nodes.filter(n=>['unit','main','fsb'].includes(n.type)).map(n=>[n.id,qtyAll(n.id)]));
  const shard = id => join(dir,'entities',Buffer.from(id).toString('hex')+'.sqlite');
  const commander={username:'admin',role:'admin'}, base=state.layout.nodes.find(n=>n.type==='main');
  const manager={username:'test-manager',role:'base_manager',baseId:base.id};
  const run = async (handler,path,method,body,me=commander) => {
    let out;
    const req=Readable.from([Buffer.from(JSON.stringify(body || {}))]);
    const res={writeHead(status){this.status=status;},end(b){out={status:this.status,body:JSON.parse(b)};}};
    const forbidden=()=>{res.writeHead(403);res.end(JSON.stringify({error:'forbidden'}));return true;};
    assert(await handler({req,res,path,method,me,isAdmin:me.role==='admin',scope:scopeOf(me),forbidden}),`unhandled ${path}`);
    return out;
  };
  if (mode==='seed') {
    state.sim.speed=0;
    const n=state.layout.nodes.find(n=>n.unitId==='UNIT-01');
    n.allowedResources=['azm_bottled_water','azm_helmet','azm_diesel'];n.fuelType='azm_diesel';
    for(const [resource,qty] of [['azm_bottled_water',125],['azm_helmet',7],['azm_diesel',50]]) applyMovement({type:'delivery',resource,qty,toId:n.id,by:'system',requestId:'V9-HISTORY'});
    state.requests.push({id:'V9-HISTORY',unitId:n.unitId,baseId:n.baseId,status:'delivered',items:[{resource:'azm_helmet',qty:7}],dispatched:[{resource:'azm_helmet',qty:7}],delivered:[{resource:'azm_helmet',qty:7}],createdAt:Date.now()});
    resDef('azm_engine_oil').usage='consumable';resDef('azm_engine_oil').weight=.77;resDef('azm_engine_oil').updatedBy='admin';
    for(const c of state.catalog) delete c.consumptionGroup;
    for(const unit of state.layout.nodes.filter(n=>n.type==='unit')) for(const k of Object.keys(state.stocks[unit.unitId])) if(!unit.allowedResources.includes(k)&&state.stocks[unit.unitId][k]===0)delete state.stocks[unit.unitId][k];
    state.schemaVersion=9;delete state.policyV10;saveState();
    writeFileSync(marker,JSON.stringify({balances:allBalances(),node:{...n},requests:state.requests,moves:allMovements(),codes:state.layout.nodes.map(n=>[n.id,n.code])}));
  }
  if (mode==='migrate') {
    const before=JSON.parse(readFileSync(marker,'utf8'));
    assert.equal(state.schemaVersion,10);assert.deepEqual(allBalances(),before.balances);
    assert.deepEqual(state.requests,before.requests);assert.deepEqual(allMovements(),before.moves);
    assert.deepEqual(state.layout.nodes.map(n=>[n.id,n.code]),before.codes);
    const n=state.layout.nodes.find(n=>n.id===before.node.id);
    for(const k of activeKeys())assert(n.allowedResources.includes(k));
    assert.equal(n.allowedResources.length,40);assert.equal(qtyOf(n.id,'azm_gasoline'),0);assert(Math.abs(qtyOf(n.id,'azm_helmet')-7)<1e-9);
    assert.equal(resDef('azm_engine_oil').weight,.77);assert.equal(resDef('azm_engine_oil').usage,'consumable');
    const backups=readdirSync(join(dir,'backups')).filter(f=>f.includes('pre-v10')&&f.endsWith('.json'));assert.equal(backups.length,1);
    const backup=JSON.parse(readFileSync(join(dir,'backups',backups[0]),'utf8'));assert.equal(backup.schemaVersion,9);
    const backupShard=join(dir,'backups',backups[0].replace('.json','-entities'),Buffer.from(n.id).toString('hex')+'.sqlite');
    const db=new DatabaseSync(backupShard,{readOnly:true});assert.equal(db.prepare('SELECT stock FROM balances WHERE resource=?').get('azm_helmet').stock,7/capacityOf(n).azm_helmet*100);db.close();
    assert(existsSync(shard(n.id)));assert.equal(state.policyV10.units.find(u=>u.unitId===n.unitId).added,37);
    writeFileSync(join(dir,'migration-proof.json'),JSON.stringify({version:state.layoutVersion,policy:state.policyV10}));
  }
  if (mode==='cycle') {
    const proof=JSON.parse(readFileSync(join(dir,'migration-proof.json'),'utf8'));assert.equal(state.layoutVersion,proof.version);assert.deepEqual(state.policyV10,proof.policy);
    let now=Date.now();const originalNow=Date.now;Date.now=()=>now;state.sim.at=now;state.sim.speed=0;
    const step = hours => { now+=hours*60000;advanceSim();if(deliverDueConvoys())saveState(); };
    const beforeBase={...state.depots[base.id]}, beforeMoves=allMovements().length;
    const created=await run(handleEntities,'/api/entities','POST',{type:'unit',label:'v10 cycle',pos:[24.8,46.8],baseId:base.id,people:500,vehicles:40,operationKey:'v10-create'});
    assert.equal(created.status,200);let n=created.body.node;
    assert.equal(n.allowedResources.length,40);assert.equal(n.fuelType,undefined);assert(Object.values(qtyAll(n.id)).every(q=>q===0));assert.deepEqual(state.depots[base.id],beforeBase);assert.equal(allMovements().length,beforeMoves);
    const mapNode={id:'v10-map-unit',type:'unit',unitId:'UNIT-099',baseId:base.id,people:500,vehicles:0,pos:[24.81,46.81]};
    assert.equal((await run(handleLayout,'/api/layout','PUT',{...state.layout,nodes:[...state.layout.nodes,mapNode],baseVersion:state.layoutVersion,operationKey:'map-unit-v10'})).status,200);
    assert.equal(state.layout.nodes.find(x=>x.id===mapNode.id).allowedResources.length,40);assert(Object.values(qtyAll(mapNode.id)).every(q=>q===0));
    n=state.layout.nodes.find(x=>x.id===n.id);
    const officer={username:'test-officer',role:'user',unitId:n.unitId};
    for(const me of [manager,officer]) {
      assert.equal((await run(handleEntities,`/api/entities/${n.id}/resources`,'PUT',{allowedResources:[]},me)).status,403);
      assert.equal((await run(handleCatalog,'/api/catalog/azm_diesel','PUT',{weight:2},me)).status,403);
    }
    assert.equal((await run(handleEntities,`/api/entities/${n.id}/resources`,'PUT',{allowedResources:['azm_diesel']})).status,400);
    const definitions=[{key:'v10_snack',usage:'consumable',weight:2},{key:'v10_radio',usage:'maintenance',weight:0}];
    for(const d of definitions) {
      assert.equal((await run(handleCatalog,'/api/catalog','POST',{...d,name:{ar:'اختبار',en:d.key},unit:{ar:'قطعة',en:'piece'},measure:'piece',capacity:{main:10000,fsb:1000},unitBasis:'fixed',unitFactor:100})).status,200);
      assert(state.layout.nodes.filter(x=>x.type==='unit').every(x=>x.allowedResources.includes(d.key)&&qtyOf(x.id,d.key)===0));
      assert.equal((await run(handleDepots,'/api/inventory/add','POST',{baseId:base.id,items:[{resource:d.key,qty:1000}],reason:'test stock',operationKey:d.key})).status,200);
    }
    const request = async items => {const r=await run(handleRequests,'/api/requests','POST',{unitId:n.unitId,mode:'truck',items},officer);assert.equal(r.status,200,JSON.stringify(r));return r.body;};
    const approve = async r => {const result=await run(handleRequests,`/api/requests/${r.id}/approve`,'POST',{route:{fromId:base.id,path:[base.pos,n.pos],km:30,hours:1},operationKey:r.id},manager);assert.equal(result.status,200,JSON.stringify(result));return result;};
    const r=await request([{resource:'v10_snack',qty:30},{resource:'v10_radio',qty:10}]);await approve(r);
    assert.equal(qtyOf(n.id,'v10_snack'),0);state.sim.speed=1;step(.5);assert.equal(qtyOf(n.id,'v10_snack'),0);assert(!allMovements().some(m=>m.type==='consumption'&&m.from?.entityId===n.id));
    step(.5);assert.equal(qtyOf(n.id,'v10_snack'),30);assert.equal(qtyOf(n.id,'v10_radio'),10);assert.equal(allMovements().filter(m=>m.type==='delivery'&&m.requestId===r.id).length,2);
    step(1);assert(Math.abs(qtyOf(n.id,'v10_snack')-25.2)<1e-7);assert.equal(qtyOf(n.id,'v10_radio'),10);
    const depots=JSON.stringify(state.depots);step(1);assert.equal(JSON.stringify(state.depots),depots);
    assert.equal(qtyOf(n.id,'azm_bottled_water'),0);
    const one=await request([{resource:'azm_diesel',qty:1000}]);await approve(one);step(1);
    const singleBefore=qtyOf(n.id,'azm_diesel'),cap=capacityOf(n),singleDemand=cap.azm_diesel*.25/100*2.4;
    step(1);assert(Math.abs(singleBefore-qtyOf(n.id,'azm_diesel')-singleDemand)<1e-7);assert.equal(qtyOf(n.id,'azm_gasoline'),0);
    const two=await request([{resource:'azm_gasoline',qty:1000}]);await approve(two);step(1);
    const diesel=qtyOf(n.id,'azm_diesel'),gas=qtyOf(n.id,'azm_gasoline'),fuelDemand=Math.max(cap.azm_diesel,cap.azm_gasoline)*.25/100*2.4;
    step(1);assert(Math.abs(diesel+gas-qtyOf(n.id,'azm_diesel')-qtyOf(n.id,'azm_gasoline')-fuelDemand)<1e-7);
    assert(Math.abs(diesel-qtyOf(n.id,'azm_diesel')-fuelDemand*diesel/(diesel+gas))<1e-7);
    const at=state.sim.hours,balances=allBalances();
    const views=await Promise.all([commander,manager,officer].map(me=>run(handleState,'/api/state','GET',null,me)));
    assert(views.every(v=>v.status===200));assert.deepEqual(allBalances(),balances);assert.equal(state.sim.hours,at);assert.equal(views[2].body.catalog.length,42);assert.deepEqual(Object.keys(views[2].body.depots),[]);
    assert.equal((await run(handleCatalog,'/api/catalog/v10_snack','PUT',{active:false})).status,200);
    const disabled=qtyOf(n.id,'v10_snack');step(1);assert.equal(qtyOf(n.id,'v10_snack'),disabled);assert(n.allowedResources.includes('v10_snack'));
    assert.equal((await run(handleCatalog,'/api/catalog/v10_snack','PUT',{active:true})).status,200);
    assert.equal(qtyOf(n.id,'v10_snack'),disabled);
    // تعديل معدل القائد يطبق عند الحد الجديد، دون تغيير كمية موجودة أو مضاعفة الوقود.
    const fuelBeforeEdit=qtyOf(n.id,'azm_diesel')+qtyOf(n.id,'azm_gasoline');
    now+=30000;
    assert.equal((await run(handleCatalog,'/api/catalog/azm_gasoline','PUT',{weight:.5})).status,200);
    assert(Math.abs(fuelBeforeEdit-qtyOf(n.id,'azm_diesel')-qtyOf(n.id,'azm_gasoline')-Math.max(cap.azm_diesel,cap.azm_gasoline)*.25/100*2.4*.5)<1e-7,'catalog edit must retain consumption accrued before changing rates');
    const dbefore=qtyOf(n.id,'azm_diesel'),gbefore=qtyOf(n.id,'azm_gasoline');step(1);
    assert(Math.abs(dbefore+gbefore-qtyOf(n.id,'azm_diesel')-qtyOf(n.id,'azm_gasoline')-Math.max(cap.azm_diesel*.25,cap.azm_gasoline*.5)/100*2.4)<1e-7);
    state.sim.speed=20;step(6);assert(Object.values(allBalances()).every(row=>Object.values(row).every(q=>q>=0)));assert.equal(qtyOf(n.id,'v10_radio'),10);
    flushConsumption();saveState();
    const consumes=allMovements().filter(m=>m.type==='consumption'&&m.from?.entityId===n.id);assert(consumes.length>0);
    for(const m of consumes){assert(m.from.type==='unit');assert(Math.abs(m.from.before-m.from.after-m.qty)<.002);assert(m.periodStart<=m.at);assert(m.simStart<=m.simHours);assert.notEqual(m.resource,'v10_radio');}
    const report=buildReport(commander,{}),entity=report.entities.find(e=>e.id===n.id);
    assert(entity.allowedResources.includes('v10_radio'));assert.equal(entity.capacity.v10_radio,100);assert.equal(entity.rows.v10_radio.current,10);
    for(const k of activeKeys())assert(Math.abs(entity.rows[k].closing-entity.rows[k].current)<.01,`ledger reconciliation ${k}`);
    state.sim.speed=0;saveState();writeFileSync(join(dir,'restart-proof.json'),JSON.stringify({balances:allBalances(),moves:allMovements(),hours:state.sim.hours,policy:state.policyV10,version:state.layoutVersion}));
    Date.now=originalNow;
  }
  if (mode==='restart') {
    const expected=JSON.parse(readFileSync(join(dir,'restart-proof.json'),'utf8'));
    const stop=startSimClock(60000);stop();advanceSim();deliverDueConvoys();
    assert.deepEqual(allBalances(),expected.balances);assert.deepEqual(allMovements(),expected.moves);assert.equal(state.sim.hours,expected.hours);assert.deepEqual(state.policyV10,expected.policy);assert.equal(state.layoutVersion,expected.version);
    assert.equal(readdirSync(join(dir,'backups')).filter(f=>f.includes('pre-v10')&&f.endsWith('.json')).length,1);
  }
  console.log(`All checks passed (v10 ${mode})`);
}
