// إدارة دورة تشغيل جديدة خارج الخادم حصراً. لا يستورد db.mjs ولا يرحّل أو يكتب أثناء الفحص.
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { lockDataDir } from '../lib/storage.mjs';

const json = file => JSON.parse(readFileSync(file, 'utf8'));
const write = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2));
const alive = pid => { try { process.kill(pid, 0); return true; } catch(e) { return e.code === 'EPERM'; } };
export const cycleTransactionFile = dir => join(dirname(resolve(dir)), `.${basename(resolve(dir))}-cycle-transaction.json`);
const assertDir = dir => {
  dir=resolve(dir);
  if (dirname(dir)===dir || !existsSync(join(dir,'state.json')) || lstatSync(dir).isSymbolicLink()) throw new Error('invalid_data_directory');
  return dir;
};
function files(dir, prefix='') {
  return readdirSync(dir).flatMap(name=>{
    const rel=join(prefix,name),p=join(dir,name),s=lstatSync(p);
    if(s.isSymbolicLink()) throw new Error('symlink_in_data_directory');
    return s.isDirectory()?files(p,rel):[rel];
  });
}
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');
function rowsFromShard(file) {
  const db=new DatabaseSync(file,{readOnly:true});
  try { return {
    entity:db.prepare('SELECT id,type,base_id,unit_id FROM entity').all(),
    balances:db.prepare('SELECT resource,stock,depot FROM balances').all(),
    requests:db.prepare('SELECT payload FROM requests').all().map(r=>JSON.parse(r.payload)),
    movements:db.prepare('SELECT payload FROM movements').all().map(r=>JSON.parse(r.payload)),
  }; } finally {db.close();}
}

export function inspectCycle(directory) {
  const dir=assertDir(directory), raw=json(join(dir,'state.json'));
  const pending=existsSync(join(dir,'entity-commit-pending.json'));
  const state=pending?json(join(dir,'entity-commit-pending.json')).state:raw;
  if(!state || !Array.isArray(state.layout?.nodes)) throw new Error('invalid_state');
  const nodes=state.layout.nodes,ids=new Set(nodes.map(n=>n.id)),units=new Set(nodes.filter(n=>n.type==='unit').map(n=>n.unitId));
  const users=json(join(dir,'users.json'));
  if(!Array.isArray(users)) throw new Error('invalid_users');
  const indexed=new Set(raw.entityIds||[]), archived=new Set(Object.keys(state.archivedEntities||{}));
  const requests=new Map([...(state.requests||[]),...(state.unassignedRequests||[])].map(r=>[r.id,r]));
  const movements=new Map([...(state.movements||[]),...(state.unassignedMovements||[])].map(r=>[r.id,r]));
  const shards=[],errors=[];
  for(const name of existsSync(join(dir,'entities'))?readdirSync(join(dir,'entities')):[]) {
    if(!name.endsWith('.sqlite')) continue;
    const id=Buffer.from(name.slice(0,-7),'hex').toString();
    try {
      const row=rowsFromShard(join(dir,'entities',name));
      const entity=row.entity[0];
      shards.push({id,file:name,indexed:indexed.has(id),onMap:ids.has(id),archived:archived.has(id),entityMatches:row.entity.length===1&&entity?.id===id,
        balances:row.balances.length,positiveBalances:row.balances.filter(b=>(b.stock||b.depot||0)>0).length});
      for(const r of row.requests) requests.set(r.id,r);
      for(const m of row.movements) movements.set(m.id,m);
    } catch {errors.push({file:name,error:'unreadable_entity_database'});}
  }
  const active=[...requests.values()].filter(r=>['pending','assigned','approved'].includes(r.status));
  const orphanAccounts=users.filter(u=>u.role==='base_manager'&&!nodes.some(n=>n.type==='main'&&n.id===u.baseId)||u.role==='user'&&!units.has(u.unitId));
  const hiddenBalances=[...Object.entries(state.depots||{}).filter(([id])=>!ids.has(id)).map(([id,q])=>({id,positive:Object.values(q).filter(v=>v>0).length})),
    ...Object.entries(state.stocks||{}).filter(([id])=>!units.has(id)).map(([id,q])=>({unitId:id,positive:Object.values(q).filter(v=>v>0).length}))];
  const lockFile=join(dir,'.server.lock'),lock=existsSync(lockFile)?json(lockFile):null;
  return {state,users,summary:{
    cycle:state.operationCycle||null,headquarters:nodes.filter(n=>n.type==='hq').map(n=>({id:n.id,code:n.code,pos:n.pos,fixed:n.fixed})),
    liveEntities:nodes.filter(n=>['main','fsb','unit'].includes(n.type)).length,
    invalidRelations:nodes.filter(n=>['fsb','unit'].includes(n.type)&&!nodes.some(b=>b.type==='main'&&b.id===n.baseId)).map(n=>n.id),
    danglingLinks:(state.layout.links||[]).filter(l=>!ids.has(l.from)||!ids.has(l.to)).map(l=>l.id),
    activeRequests:active.map(r=>({id:r.id,status:r.status,unitId:r.unitId,targetId:r.targetId,source:r.route?.fromId,stalled:!!r.stalled})),
    orphanAccounts:orphanAccounts.map(u=>({username:u.username,role:u.role,baseId:u.baseId,unitId:u.unitId,status:u.status})),
    accounts:users.length,commanders:users.filter(u=>u.role==='admin').length,archivedEntities:archived.size,
    hiddenBalances,archivedBalances:Object.entries(state.archivedSnapshots||{}).map(([id,r])=>({id,unitId:r.unitId||null,positiveBalances:Object.values(r.stock||r.depot||{}).filter(q=>q>0).length})),archivedSnapshots:Object.keys(state.archivedSnapshots||{}).length,shards,
    missingShards:[...indexed].filter(id=>!shards.some(s=>s.id===id)),errors,pendingRecovery:pending,
    historicalRequests:requests.size,historicalMovements:movements.size,logs:(state.logs||[]).length,audit:(state.audit||[]).length,
    catalogItems:state.catalog?.length||0,activeCatalogItems:state.catalog?.filter(c=>c.active).length||0,
    serverRunning:!!(lock?.pid&&lock.pid!==process.pid&&alive(lock.pid)),readOnly:true,
  }};
}

export function makeCycleState(old, schemaVersion, now=Date.now()) {
  const hq=old.layout?.nodes?.filter(n=>n.type==='hq');
  if(hq?.length!==1 || hq[0].id!=='hq-riyadh' || !Array.isArray(hq[0].pos) || hq[0].pos.length!==2 || hq[0].pos.some(v=>!Number.isFinite(v))) throw new Error('invalid_headquarters');
  if(old.layout.nodes.some(n=>n.type!=='hq')) throw new Error('remove_entities_before_new_cycle');
  if(!Array.isArray(old.catalog)||!old.catalog.length) throw new Error('missing_catalog');
  if(old.schemaVersion!==schemaVersion) throw new Error('upgrade_server_before_new_cycle');
  const id=randomUUID();
  // قائمة صريحة تمنع تسرب أي تاريخ أو مفاتيح إعادة محاولة أو أرصدة قديمة إلى الدورة الجديدة.
  return {
    schemaVersion,entityStoreVersion:2,entityIds:[],catalog:structuredClone(old.catalog),
    layout:{nodes:[{...structuredClone(hq[0]),fixed:true}],links:[]},layoutVersion:(old.layoutVersion||0)+1,
    requests:[],movements:[],stocks:{},depots:{},inventory:{},archivedEntities:{},archivedSnapshots:{},
    unassignedRequests:[],unassignedMovements:[],legacySupplySources:{},logs:[],audit:[],alerts:[],alertFlags:{},
    consumptionOpen:{},consumptionFloor:{},supplyOperations:{},requestOperations:{},
    nextOrder:1,nextMovement:1,nextOp:1,nextAudit:1,trackingStartedAt:now,
    sim:{speed:0,emergency:false,hours:0,at:now,resumedAt:now,lastGapMs:0},
    operationCycle:{id,startedAt:now,policy:'all_active_zero_units_hq_funded_bases',startedBy:'offline_new_cycle'},
    policyV10:{at:now,assignment:'all_active',consumption:'catalog',fuelDistribution:'proportional_available_max_rate',units:[]},
  };
}

function backupComplete(dir, tag) {
  const folder=join(dirname(dir),`${basename(dir)}-cycle-backups`,`${new Date().toISOString().replace(/[:.]/g,'-')}-${tag}-${randomUUID().slice(0,8)}`);
  const sourceFiles=files(dir);mkdirSync(folder,{recursive:true});
  cpSync(dir,join(folder,'data'),{recursive:true,errorOnExist:true,force:false});
  const manifest={version:1,source:dir,at:Date.now(),files:Object.fromEntries(sourceFiles.map(f=>[f,digest(join(dir,f))]))};
  write(join(folder,'manifest.json'),manifest);verifyBackup(folder);
  return folder;
}
export function verifyBackup(folder) {
  folder=resolve(folder);const manifest=json(join(folder,'manifest.json')),snapshot=join(folder,'data');
  if(manifest.version!==1||!manifest.files||!existsSync(snapshot)||lstatSync(snapshot).isSymbolicLink()||lstatSync(join(folder,'manifest.json')).isSymbolicLink()) throw new Error('invalid_cycle_backup');
  const actual=files(snapshot);
  if(actual.length!==Object.keys(manifest.files).length)throw new Error('backup_file_count_mismatch');
  for(const [f,hash] of Object.entries(manifest.files)) {
    const p=resolve(snapshot,f),rel=relative(snapshot,p);
    if(!rel||rel==='..'||rel.startsWith(`..${sep}`)||!actual.includes(f)||digest(p)!==hash)throw new Error('backup_verification_failed');
  }
  return manifest;
}
function claim(dir, action) {
  const transaction=cycleTransactionFile(dir);
  writeFileSync(transaction,JSON.stringify({version:1,pid:process.pid,action,dataDir:dir,phase:'claimed'}),{flag:'wx'});
  try {
    const lock=lockDataDir(dir,{purpose:action});
    if(!lock.ok) throw new Error('server_running_stop_it_first');
    return transaction;
  } catch(e) {rmSync(transaction,{force:true});throw e;}
}
const release = dir => {
  const file=join(dir,'.server.lock');
  if(existsSync(file)&&json(file).pid===process.pid)rmSync(file);
};
function swap(dir,stage,backup,transaction,action) {
  const record={version:1,pid:process.pid,action,dataDir:dir,stage,backup,displaced:join(backup,'displaced'),phase:'prepared'};
  write(transaction,record);
  renameSync(dir,record.displaced);
  write(transaction,{...record,phase:'displaced'});
  renameSync(stage,dir);
  write(transaction,{...record,phase:'installed'});
  release(dir);rmSync(transaction);
  return backup;
}
export function startNewCycle(directory,schemaVersion) {
  const dir=assertDir(directory),transaction=claim(dir,'new-cycle');let displaced=false;
  try {
    const inspected=inspectCycle(dir),fresh=makeCycleState(inspected.state,schemaVersion);
    const commanders=inspected.users.filter(u=>u.role==='admin');
    if(!commanders.some(u=>u.status==='active'))throw new Error('no_active_commander');
    const backup=backupComplete(dir,'before-new-cycle'),stage=join(backup,'stage');
    write(join(backup,'review.json'),inspected.summary);
    mkdirSync(stage);write(join(stage,'state.json'),fresh);write(join(stage,'users.json'),commanders);write(join(stage,'chats.json'),{});
    write(join(stage,'.server.lock'),{pid:process.pid,purpose:'new-cycle'});
    const after=inspectCycle(stage).summary;
    if(after.liveEntities||after.activeRequests.length||after.orphanAccounts.length||after.shards.length||after.historicalMovements||after.historicalRequests)throw new Error('new_cycle_validation_failed');
    displaced=true;swap(dir,stage,backup,transaction,'new-cycle');
    return {backup,cycle:fresh.operationCycle,review:inspected.summary,after,removedAccounts:inspected.users.length-commanders.length};
  } finally {if(!displaced){release(dir);rmSync(transaction,{force:true});}}
}
export function restoreCycle(directory,backupFolder) {
  const dir=assertDir(directory),source=resolve(backupFolder);verifyBackup(source);
  if(source===dir||source.startsWith(dir+sep))throw new Error('backup_must_be_outside_data');
  const transaction=claim(dir,'restore-cycle');let displaced=false;
  try {
    const backup=backupComplete(dir,'before-restore'),stage=join(backup,'stage');
    cpSync(join(source,'data'),stage,{recursive:true});
    write(join(stage,'.server.lock'),{pid:process.pid,purpose:'restore-cycle'});
    displaced=true;swap(dir,stage,backup,transaction,'restore-cycle');return {backup,restoredFrom:source};
  } finally {if(!displaced){release(dir);rmSync(transaction,{force:true});}}
}
export function recoverCycle(directory) {
  const dir=resolve(directory),transaction=cycleTransactionFile(dir),record=json(transaction);
  if(record.version!==1||resolve(record.dataDir)!==dir||record.pid!==process.pid&&alive(record.pid))throw new Error('cycle_transaction_active_or_invalid');
  const currentLock=join(dir,'.server.lock');
  if(existsSync(currentLock)){const l=json(currentLock);if(l.pid!==process.pid&&alive(l.pid))throw new Error('server_running_stop_it_first');}
  if(record.phase==='claimed') {releaseStale(dir);rmSync(transaction);return {recovered:'unchanged'};}
  const root=join(dirname(dir),`${basename(dir)}-cycle-backups`),backup=resolve(record.backup||'');
  if(dirname(backup)!==root||record.displaced!==join(backup,'displaced')||record.stage!==join(backup,'stage'))throw new Error('invalid_recovery_paths');
  verifyBackup(backup);
  if(existsSync(record.displaced)) {
    if(existsSync(dir))renameSync(dir,join(backup,`interrupted-${randomUUID()}`));
    renameSync(record.displaced,dir);
  } else if(record.phase!=='prepared') throw new Error('missing_recovery_directory');
  releaseStale(dir);rmSync(transaction);return {recovered:'previous_directory',backup};
}
function releaseStale(dir) {
  const file=join(dir,'.server.lock');
  if(existsSync(file)){const l=json(file);if(l.pid!==process.pid&&alive(l.pid))throw new Error('server_running_stop_it_first');rmSync(file);}
}
