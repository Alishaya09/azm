// فحص المحادثة المباشرة بالمكوّن الحقيقي دون متصفح؛ الاسم محفوظ للتوافق مع أوامر الفحص القديمة.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const babel={};babel.self=babel;vm.createContext(babel);
vm.runInContext(readFileSync('vendor/babel.min.js','utf8'),babel);
const slots=[];let cursor=0,resolveChat;
const calls=[];
const ctx={React:{createElement:(type,props,...children)=>({type,props:props||{},children}),Fragment:'fragment'},
 useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
 useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect(){},
 useLang:()=>({t:k=>k}),fmtDateTime:String,errText:(_,e)=>e.code,
 AzmLogo:()=>null,localStorage:{getItem:()=>null,setItem(){}},confirm:()=>false,setTimeout:()=>0,
 api(path,options){calls.push({path,options});if(options?.method==='POST')return new Promise(r=>{resolveChat=r;});return Promise.resolve(path==='/api/chats'?[]:{connected:true,model:'base'});}
};
vm.createContext(ctx);vm.runInContext(babel.Babel.transform(readFileSync('src/assistant/Assistant.jsx','utf8'),{presets:['react']}).code,ctx);
const props={me:{role:'user',unitId:'UNIT-01',username:'tester'}};
const render=()=>{cursor=0;return ctx.Assistant(props);};
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.children)]:[];
let tree=render();nodes(tree).find(n=>n.props.className==='ai-fab ').props.onClick();tree=render();
assert.equal(nodes(tree).some(n=>n.type==='select'),false);
nodes(tree).find(n=>n.type==='textarea').props.onChange({target:{value:'inventory question'}});tree=render();
const submit=nodes(tree).find(n=>n.type==='form').props.onSubmit;
submit({preventDefault(){}});submit({preventDefault(){}});
assert.equal(calls.filter(x=>x.options?.method==='POST').length,1,'Repeated send is coalesced');
assert.equal(calls[0].path,'/api/chats');assert.equal(calls[0].options.body.text,'inventory question');
resolveChat({id:'C-test',messages:[{role:'assistant',text:'reply'}]});await new Promise(r=>setImmediate(r));tree=render();
nodes(tree).find(n=>n.type==='textarea').props.onChange({target:{value:'follow up'}});tree=render();
nodes(tree).find(n=>n.type==='textarea').props.onKeyDown({key:'Enter',shiftKey:false,nativeEvent:{isComposing:false},preventDefault(){}});
assert.equal(calls.find(x=>x.path==='/api/chats/C-test/messages').options.body.text,'follow up');
assert.equal(calls.some(x=>x.path.includes('request-draft')),false);
resolveChat({id:'C-test',messages:[]});await new Promise(r=>setImmediate(r));
console.log('All checks passed: Assistant sends conversation by form and Enter, coalesces duplicate sends, hides selectors and never extracts requests.');
slots.length=0;calls.length=0;const effects=[],pending=[];let invalidated;
Object.assign(ctx,{loadLang:()=> 'ar',CURRENT_LANG:'ar',HOUR_MS:60000,makeT:()=>k=>k,
 useEffect:fn=>effects.push(fn),useMemo:fn=>fn(),normalizeLayout:()=>({nodes:[],links:[]}),allResources:[],tabs:[['dashboard']],
 LangContext:{Provider:'provider'},setCatalog(){},setResourcePolicy(){},queueMicrotask,setInterval:()=>1,clearInterval(){},
 window:{addEventListener(){},removeEventListener(){}},watchAzmState:fn=>{invalidated=fn;return()=>{};},
 api(path){calls.push({path});return new Promise(resolve=>pending.push(resolve));}
});
for(const name of ['Login','Header','Nav','Dashboard','Inventory','Routes','Logs','Reports','ReportChat','Databases','Catalog','Users','Bottom','Toasts','RequestModal','RequestDetails','HowItWorks','Optecho','Sitrep'])ctx[name]=name;
vm.runInContext(babel.Babel.transform(readFileSync('src/App.jsx','utf8'),{presets:['react']}).code,ctx);
const account={role:'user',username:'tester',unitId:'UNIT-01'};slots[1]=account;slots[2]=false;cursor=0;ctx.App();
effects[2]();for(let i=0;i<8;i++)invalidated();assert.equal(pending.length,1,'Refresh must coalesce overlapping invalidations');
const state={user:account,requests:['pending','approved','delivered','rejected'].map((status,i)=>({id:'ORD-'+i,unitId:'UNIT-01',status})),logs:[],stocks:{},sim:{hours:0,speed:1},alerts:[],now:Date.now(),layout:{nodes:[],links:[]},layoutVersion:1};
pending[0](state);await new Promise(r=>setImmediate(r));cursor=0;tree=ctx.App();
assert.equal(nodes(tree).find(n=>n.type==='Dashboard').props.requests.length,4,'Slow response must populate requests despite later invalidations');
assert.equal(pending.length,2,'Only one follow-up refresh is scheduled');pending[1](state);await new Promise(r=>setImmediate(r));
console.log('All checks passed: actual App retains all request statuses during overlapping slow refreshes.');

// A legacy approved request can lack ETA and must not blank the entire list.
slots.length=0;cursor=0;
Object.assign(ctx,{useLang:()=>({t:k=>k}),canDecide:()=>false,canExecute:()=>false,newAzmTabId:()=>'k',RequestStage:'RequestStage',priorityIcon:{normal:'•'},
 reqItems:r=>r.items||[],resIcon:()=>'',resName:(_,k)=>k,resUnitName:()=>'',fmtQty:String,
 routeForRequest:()=>null,unitName:(_,u)=>u.id,unitResources:()=>[],nameById:()=>'',
 UnitCard:'UnitCard',TacticalMap:'TacticalMap',AlertsPanel:'AlertsPanel',ConvoyCard:'ConvoyCard',RouteInfo:'RouteInfo',StockCheck:'StockCheck',statusFor:()=> 'ready',resources:[]});
vm.runInContext(babel.Babel.transform(readFileSync('src/pages/Dashboard.jsx','utf8'),{presets:['react']}).code,ctx);
const requestProps={me:account,units:[{id:'UNIT-01'}],allUnits:[{id:'UNIT-01'}],layout:{nodes:[],links:[]},
 requests:[{id:'OLD',unitId:'UNIT-01',status:'approved',stalled:'no_dispatch_record',priority:'normal',items:[]},
 {id:'NEW',unitId:'UNIT-01',status:'pending',priority:'normal',mode:'truck',items:[]}],alerts:[],depots:{},hierarchy:{}};
tree=ctx.Dashboard(requestProps);
assert.equal(nodes(tree).filter(n=>n.type==='article').length,2,'Both legacy and pending unit requests remain visible');
console.log('All checks passed: Dashboard displays unit requests even when an old approval has no ETA.');

// The side cards show assigned stock even if a catalog item was disabled or is from the previous policy;
// request/simulation selections use active operational items only (food + the unit's declared fuel).
const stockUI={React:ctx.React,useLang:()=>({t:k=>k}),dict:{},HOUR_MS:60000};
vm.createContext(stockUI);
vm.runInContext(readFileSync('src/domain/units.jsx','utf8'),stockUI);
vm.runInContext(babel.Babel.transform(readFileSync('src/components/UnitCard.jsx','utf8'),{presets:['react']}).code,stockUI);
vm.runInContext("setResourcePolicy({food:['azm_bottled_water','azm_mre'],fuel:['azm_diesel','azm_gasoline']});setCatalog([{key:'azm_diesel',icon:'⛽',active:true,name:{ar:'وقود ديزل',en:'Diesel'}},{key:'azm_gasoline',icon:'⛽',active:true,name:{ar:'بنزين',en:'Gasoline'}},{key:'azm_bottled_water',icon:'💧',active:false,name:{ar:'مياه',en:'Water'}},{key:'azm_helmet',icon:'⛑',active:true,name:{ar:'خوذة واقية',en:'Helmet'}}]);",stockUI);
const uCard={id:'CUSTOM',people:10,vehicles:2,optempo:'medium',fuelType:'azm_diesel',azm_diesel:42,azm_gasoline:20,azm_bottled_water:35,azm_helmet:50,allowedResources:['azm_diesel','azm_gasoline','azm_bottled_water','azm_helmet']};
const active=vm.runInContext('unitResources',stockUI)(uCard);
assert.equal(active.map(r=>r.key).join(),'azm_diesel,azm_gasoline,azm_helmet','v10 includes every active assigned item; disabled water stays outside operations');
const card=stockUI.UnitCard({unit:uCard});
const meters=nodes(card).filter(n=>n.type===stockUI.Meter);
assert.equal(meters.length,4,'All assigned balances appear on the sidebar');
assert.ok(meters.some(n=>n.props.label.includes('cat.off')),'Disabled stock is marked on read-only views');
assert.ok(!meters.some(n=>n.props.label.includes('policy.legacyShort')),'v10 active assigned items are not marked as previous-policy stock');
console.log('All checks passed: assigned resources appear on the side card; v10 includes all active assigned items and excludes disabled items from operations.');
