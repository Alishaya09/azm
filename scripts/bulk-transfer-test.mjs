// حالات الوارد القديم والسعة في مجلد مؤقت مستقل، دون تشغيل خادم آخر.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import assert from 'node:assert/strict';

process.env.AZM_DATA_DIR = mkdtempSync(join(tmpdir(), 'azm-bulk-transfer-'));
const { state } = await import('../server/store/state.mjs');
const { handleDepots } = await import('../server/routes/depots.mjs');
const { stockRoom } = await import('../server/store/limits.mjs');
const { capacityOf } = await import('../server/store/hierarchy.mjs');
const key = state.catalog.find(c=>c.active!==false).key;
const source = state.layout.nodes.find(n=>n.type==='main');
const dest = {id:'bulk-target',type:'main',label:'اختبار وارد',pos:[25,46]};
state.layout.nodes.push(dest);
const cap=capacityOf(dest)[key];
state.depots[dest.id]={[key]:cap-20};
state.requests.push({id:'BULK-INBOUND',kind:'base',targetId:dest.id,status:'approved',dispatched:[{resource:key,qty:15}]});
assert.equal(stockRoom(dest,key).room,5);
const run = async qty => {
  let result;
  const req=Readable.from([Buffer.from(JSON.stringify({to:dest.id,items:[{resource:key,qty}],operationKey:`bulk-${qty}`,reason:'اختبار'}))]);
  const res={writeHead(status){this.status=status;},end(body){result={status:this.status,body:JSON.parse(body)};}};
  await handleDepots({req,res,path:`/api/depots/${source.id}/transfer`,method:'POST',me:{username:'bulk-test'},isAdmin:true,scope:{role:'admin',depotIds:new Set([source.id,dest.id])},forbidden(){throw new Error('unexpected forbidden');}});
  return result;
};
const before=state.depots[source.id][key], movements=state.movements.length;
assert.equal((await run(6)).body.error,'over_capacity');
assert.equal(state.depots[source.id][key],before);
assert.equal(state.movements.length,movements);
assert.equal((await run(5)).status,200);
assert.equal(state.depots[dest.id][key],cap-15);
assert.equal(stockRoom(dest,key).room,0);
assert.equal((await run(5)).status,200);
assert.equal(state.depots[source.id][key],before-5);
// «ملئ» لمورد واحد: إعادة نفس المفتاح بعد امتلاء الوجهة تعيد النتيجة المحفوظة دون خصم ثانٍ
const key2=state.catalog.filter(c=>c.active!==false).map(c=>c.key).find(k=>k!==key&&capacityOf(dest)[k]>=10&&state.depots[source.id][k]>=10);
state.depots[dest.id][key2]=capacityOf(dest)[key2]-10;
const fillOne = async () => {
  let result;
  const req=Readable.from([Buffer.from(JSON.stringify({to:dest.id,resource:key2,fill:true,operationKey:'fill-one',reason:'اختبار'}))]);
  const res={writeHead(status){this.status=status;},end(body){result={status:this.status,body:JSON.parse(body)};}};
  await handleDepots({req,res,path:`/api/depots/${source.id}/transfer`,method:'POST',me:{username:'bulk-test'},isAdmin:true,scope:{role:'admin',depotIds:new Set([source.id,dest.id])},forbidden(){throw new Error('unexpected forbidden');}});
  return result;
};
const before2=state.depots[source.id][key2], first=await fillOne(), again=await fillOne();
assert.equal(first.status,200); assert.equal(first.body.movements[0].qty,10);
assert.equal(again.status,200); assert.equal(again.body.opId,first.body.opId);
assert.equal(state.depots[source.id][key2],before2-10);
console.log('All checks passed (bulk inbound capacity and replay)');
