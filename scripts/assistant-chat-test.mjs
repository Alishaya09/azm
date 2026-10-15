// اختبار محادثة بنموذج تجريبي حتمي وبيانات مؤقتة؛ لا يختبر جودة النموذج الحقيقي.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { assignmentFixture } from './user-assignment-test.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compactContext, questionFocus } from '../server/ai/compact.mjs';

export async function chatFixture() {
  const snapshots=[], results=[], models=[], guides=[];
  const model=createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'azm-report-base'}]}));return;}
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);models.push(body.model);
    const snapshot=JSON.parse(body.messages[1].content.split('\n').slice(1).join('\n'));
    snapshots.push(snapshot);
    guides.push(body.messages.find(m=>m.role==='system'&&m.content.startsWith('AZM methodology and policies'))?.content||null);
    const last=body.messages.at(-1);
    // محاكاة نافذة سياق صغيرة مثل serve-mlx.py: الخادم يجب أن يعيد المحاولة بلقطة أصغر
    if(last.role==='user'&&last.content==='CTX_LIMIT'){
      if(body.messages[1].content.length>3500){res.statusCode=400;res.end(JSON.stringify({error:'context_too_long'}));return;}
      res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'لقطة مصغرة'},finish_reason:'stop'}]}));return;
    }
    let message;
    if(last.role==='tool'){
      const result=JSON.parse(last.content);results.push(result);
      message={role:'assistant',content:result.error?'رفض خارج الصلاحية: '+result.error:'إجابة ضمن الصلاحية: تمت قراءة البيانات المسموحة من الخادم دون تعديلها.'};
    } else {
      const text=[...body.messages].reverse().find(m=>m.role==='user').content;
      const call=JSON.parse(text.slice(text.indexOf('{')));
      message={role:'assistant',content:null,tool_calls:[{id:'read-1',type:'function',function:{name:call.name,arguments:JSON.stringify(call.arguments)}}]};
    }
    res.end(JSON.stringify({choices:[{message,finish_reason:'stop'}]}));
  });
  await new Promise(r=>model.listen(0,'127.0.0.1',r));
  let f;
  try {
    f=await assignmentFixture({AZM_AI_PROVIDER:'openai',AZM_AI_MODEL:'azm-report-base',AZM_AI_BASE_URL:`http://127.0.0.1:${model.address().port}/v1`,AZM_REQUEST_AI_PROVIDER:'none',AZM_REPORT_AI_PROVIDER:'none',AZM_RAG_URL:''});
    const entities=await f.entities(),{b1,u1,u2}=entities;
    for(const user of [{username:'chat.base',role:'base_manager',baseId:b1.id},{username:'chat.unit',role:'user',unitId:u1.unitId}])await f.api('/api/users',{password:f.password,...user},f.admin);
    const manager=(await f.login('chat.base')).cookie,officer=(await f.login('chat.unit')).cookie;
    const orders=[];
    for(const u of [u1,u2])orders.push((await f.api('/api/requests',{unitId:u.unitId,mode:'heli',items:[{resource:'azm_helmet',qty:1}]},f.admin)).data);
    return {...f,...entities,manager,officer,orders,snapshots,results,models,guides,stop:async()=>{await f.stop();model.closeAllConnections();await new Promise(r=>model.close(r));}};
  } catch(e){if(f)await f.stop();await new Promise(r=>model.close(r));throw e;}
}
export const question=(name,args)=>'حلّل البيانات ضمن صلاحياتي فقط '+JSON.stringify({name,arguments:args});

async function run(){
  const f=await chatFixture();
  try{
    const before=await f.get('/api/state',f.admin);
    for(const [cookie,role] of [[f.admin,'admin'],[f.manager,'base_manager'],[f.officer,'user']]){
      const status=await f.get('/api/ai/status',cookie);assert.equal(status.connected,true);assert.equal(status.model,'azm-report-base');
      const allowed=[['read_inventory',{entityId:f.u1.id}],['read_requests',{requestId:f.orders[0].id}],['read_report',{unitId:f.u1.unitId}]];
      const denied=role==='admin'?[['read_inventory',{entityId:'missing'}],['read_requests',{requestId:'missing'}],['read_report',{unitId:'missing'}]]:[['read_inventory',{entityId:f.u2.id}],['read_requests',{requestId:f.orders[1].id}],['read_report',{unitId:f.u2.unitId}],['read_report',{baseId:f.b2.id}]];
      if(role==='user')denied.push(['read_inventory',{entityId:f.b1.id}],['read_inventory',{entityId:f.p1.id}],['read_report',{baseId:f.b1.id}]);
      for(const [pairs,expected] of [[allowed,200],[denied,403]])for(const [name,args]of pairs){
        const direct=await f.api('/api/ai/tools/read',{name,arguments:args},cookie,'POST',expected);
        if(expected===403)assert.equal(direct.data.error,'out_of_scope');
        const chat=(await f.api('/api/chats',{text:question(name,args),role:'admin',unitId:f.u2.unitId,baseId:f.b2.id},cookie)).data;
        assert.equal(f.results.at(-1).error,expected===403?'out_of_scope':undefined);
        assert(!chat.messages.at(-1).kind,JSON.stringify(chat.messages.at(-1)));
        const snapshot=f.snapshots.at(-1);assert.equal(snapshot.viewer.role,role);
        assert.equal(snapshot.units.length,role==='admin'?2:1);
        if(role!=='admin'){
          assert(!snapshot.depots.some(d=>d.id===f.b2.id||d.id===f.p2.id));
          assert(!snapshot.requests.some(r=>r.id===f.orders[1].id));
        }
        if(role==='user'){
          assert.deepEqual(snapshot.depots,[]);
          assert(snapshot.supplyChain.some(n=>n.id===f.b1.id));
          assert(snapshot.supplyChain.every(n=>Object.keys(n).every(k=>['id','type','name'].includes(k))));
        }
      }
    }
    // القوانين العامة والموافقات والسياسات تصل للنموذج لكل الأدوار (مقاطع عامة، دون بيانات تشغيلية إضافية)
    for(const [cookie,role] of [[f.officer,'user'],[f.manager,'base_manager']]){
      await f.api('/api/chats',{text:'ما صلاحيات مسؤول الوحدة ومسؤول القاعدة وكيف تتم الموافقة على الطلب؟ '+JSON.stringify({name:'read_inventory',arguments:{entityId:f.u1.id}})},cookie);
      const guide=f.guides.find((g,i)=>i>=f.guides.length-2&&g);
      assert(guide&&guide.includes('مسؤول'),`${role}: policies reach the model`);
      assert.equal(f.snapshots.at(-1).viewer.role,role);
    }
    const after=await f.get('/api/state',f.admin);
    for(const key of ['stocks','depots','requests','inventory'])assert.deepEqual(after[key],before[key],key+' unchanged by chat/tools');
    assert(f.models.every(m=>m==='azm-report-base'));
    const chats=await f.get('/api/chats',f.officer),own=chats[0];assert(own.title&&own.updatedAt&&own.count===2);
    await f.api('/api/chats/'+own.id,null,f.manager,'GET',404);
    await f.api('/api/chats/'+own.id+'/messages',{text:question('read_inventory',{entityId:f.u1.id})},f.officer);
    assert.equal((await f.get('/api/chats/'+own.id,f.officer)).messages.length,4);
    // اللقطة المرسلة للنموذج ضمن ميزانية AZM_AI_CONTEXT_CHARS (14000)، ورفض الطول يعيد المحاولة بأصغر
    assert(f.snapshots.every(s=>JSON.stringify(s).length<=14000),'snapshot within context budget');
    const small=(await f.api('/api/chats',{text:'CTX_LIMIT'},f.admin)).data.messages.at(-1);
    assert(!small.kind&&small.text==='لقطة مصغرة',JSON.stringify(small));
    assert.equal((await f.get('/api/ai/status',f.admin)).connected,true,'context limit is not an outage');
    const big={generatedAt:'',viewer:{role:'admin'},scopeNote:'',simulation:{},thresholds:{},resources:Array.from({length:40},(_,i)=>({key:'r'+i,name:{ar:'مورد',en:'res'},unit:{ar:'و',en:'u'},measure:'u'})),
      units:Array.from({length:30},(_,i)=>({id:'U'+i,name:'unit',stockPercent:Object.fromEntries(Array.from({length:40},(_,k)=>['r'+k,i===7?0:80])),stockQty:{},capacity:{},inTransit:{}})),
      depots:[],requests:Array.from({length:60},(_,i)=>({id:'R'+i,status:i%3?'delivered':'pending',items:[{resource:'r1',qty:1}],dispatched:[],delivered:[]})),requestCount:60,recentMovements:[],recentAlerts:[]};
    const fitted=compactContext(big,3000);
    assert(JSON.stringify(fitted).length<=3000&&fitted.units.some(u=>u.id==='U7')&&fitted.unitsOmitted>0,'compaction keeps the most depleted unit');
    // المورد والموقع المذكوران في السؤال يُرسلان بأرقامهما الفعلية في اللقطة المصغّرة
    const fuel={...big,resources:[...big.resources,{key:'azm_diesel',name:{ar:'وقود ديزل',en:'diesel'},unit:{ar:'لتر',en:'liter'},measure:'liter'}],
      depots:[{id:'main-ne',type:'base',name:'قاعدة الشمال الشرقي',stockQty:{azm_diesel:62000},capacity:{azm_diesel:100000},inTransit:{}}]};
    const focus=questionFocus('كم الديزل في قاعدة الشمال الشرقي؟',fuel,{azm_diesel:['ديزل']});
    assert(focus.keys.includes('azm_diesel')&&focus.ids.includes('main-ne'),JSON.stringify(focus));
    const asked=compactContext(fuel,3000,focus).depots.find(d=>d.id==='main-ne');
    assert.deepEqual(asked?.askedResources?.azm_diesel,{percent:62,qty:62000,capacity:100000});
    console.log('All checks passed (chat: session scope, snapshots, all three tools, forged role/IDs, forbidden IDs, read-only operations, base model status, private history, context budget and retry).');
  } finally{await f.stop();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await run();
