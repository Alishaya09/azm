// التطبيق الرئيسي: الجلسة، سحب البيانات من الخادم، والتوجيه بين الصفحات
// الواجهة تتحدد تلقائياً حسب دور الحساب: القائد (admin)، مسؤول القاعدة (base_manager)، مسؤول الوحدة (user).
// كل البيانات اللي توصل هنا مفلترة في الخادم حسب نطاق الحساب.
function App() {
  const [lang,setLang]=useState(loadLang);
  const [me,setMe]=useState(null),[checking,setChecking]=useState(true);
  const [tab,setTab]=useState('dashboard'),[stocks,setStocks]=useState({}),[sim,setSim]=useState({speed:1,emergency:false,hours:0});
  const [requests,setRequests]=useState([]),[logs,setLogs]=useState([]),[alerts,setAlerts]=useState([]),[toasts,setToasts]=useState([]),[serverLayout,setServerLayout]=useState(null),[serverOffset,setServerOffset]=useState(0);
  const [depots,setDepots]=useState({}),[hierarchy,setHierarchy]=useState({}),[pendingUsers,setPendingUsers]=useState(0),[inventory,setInventory]=useState({}),[trackingStartedAt,setTrackingStartedAt]=useState(null);
  const [refreshError,setRefreshError]=useState(false),[basesWithoutManager,setBasesWithoutManager]=useState([]);
  // مسؤول القاعدة: بقية القواعد والوحدات بالاسم والموقع فقط، للرسم على الخريطة فقط (منفصلة عن layout)
  const [mapOthers,setMapOthers]=useState([]);
  // ساعة المحاكاة: آخر قيمة من الخادم + الوقت اللي مضى من بعدها × السرعة، عشان الحركة تكون سلسة بين التحديثات
  const simRef=useRef({hours:0,at:Date.now(),speed:1}),offsetRef=useRef(0); offsetRef.current=serverOffset;
  const simClock=()=>{const r=simRef.current;return r.hours+Math.max(0,Date.now()+offsetRef.current-r.at)/HOUR_MS*r.speed;};
  const seenAlerts=useRef(null),[infoModal,setInfoModal]=useState(null),[refreshing,setRefreshing]=useState(false),[,setCatalogVer]=useState(0);
  const meRef=useRef(null); meRef.current=me;
  const refreshSeq=useRef(0),[openRequestId,setOpenRequestId]=useState(null),[aiDraft,setAiDraft]=useState(null);
  const refreshFlight=useRef(null),refreshAgain=useRef(false);
  CURRENT_LANG=lang;
  const t=makeT(lang);
  // الاتجاه ثابت من اليسار في اللغتين، ونغيّر فقط لغة المستند والعنوان
  useEffect(()=>{document.documentElement.lang=lang;document.documentElement.dir='ltr';document.title=t('app.title');try{localStorage.setItem(langKey,lang);}catch{}},[lang]);
  // استرجاع الجلسة الحالية عند فتح الصفحة
  useEffect(()=>{api('/api/me').then(setMe).catch(()=>{}).finally(()=>setChecking(false));},[]);
  const dismiss=id=>setToasts(v=>v.filter(a=>a.id!==id));
  // مسح بيانات الحساب عند انتهاء جلسته أيضاً، قبل إظهار دخول حساب آخر في التبويب نفسه.
  const clearSession=()=>{meRef.current=null;setMe(null);setTab('dashboard');setRequests([]);setLogs([]);setAlerts([]);setToasts([]);setStocks({});setDepots({});setInventory({});setHierarchy({});setPendingUsers(0);setMapOthers([]);setTrackingStartedAt(null);setServerLayout(null);setInfoModal(null);setOpenRequestId(null);setRefreshError(false);refreshSeq.current++;seenAlerts.current=null;};
  // كل شي مشترك على الخادم (المخزون، الطلبات، السجل، التنبيهات، الخريطة) — نسحبه كل 3 ثوانٍ
  const refresh=()=>{
    // الإشعارات المتزامنة لا تلغي الرد الجاري: نطبقه ثم نجلب أحدث حالة مرة إضافية.
    if(refreshFlight.current){refreshAgain.current=true;return refreshFlight.current;}
    const seq=++refreshSeq.current;const work=api('/api/state').then(s=>{
    if(seq!==refreshSeq.current)return;
    // الجلسة خاصة بالتبويب. أي اختلاف غير متوقع يفشل مغلقاً دون عرض بيانات الحساب الآخر.
    const cur=meRef.current; if(!cur)return; if(!s.user||s.user.username!==cur.username){clearSession();return;}
    if(cur.role!==s.user.role || cur.unitId!==s.user.unitId || cur.baseId!==s.user.baseId){setMe(s.user);setOpenRequestId(null);setInfoModal(null);setAiDraft(null);}
    if(s.catalog){setCatalog(s.catalog);setCatalogVer(v=>v+1);}
    setResourcePolicy(s.policy);setBasesWithoutManager(s.basesWithoutManager||[]);
    setMapOthers(p=>JSON.stringify(p)===JSON.stringify(s.mapOthers||[])?p:(s.mapOthers||[]));
    setRefreshError(false);
    if(s.hourMs)HOUR_MS=s.hourMs;setRequests(s.requests);setLogs(s.logs);setStocks(s.stocks||{});setSim(s.sim);simRef.current={hours:s.sim.hours,at:s.now,speed:s.sim.speed};setAlerts(s.alerts||[]);setServerOffset(s.now-Date.now());setDepots(s.depots||{});setHierarchy(s.hierarchy||{});setPendingUsers(s.pendingUsers||0);setInventory(s.inventory||{});setTrackingStartedAt(s.trackingStartedAt||null);
    // قد يتغير محتوى التخطيط بعد استعادة بيانات قديمة مع بقاء رقم النسخة نفسه.
    setServerLayout(p=>p&&p.version===s.layoutVersion&&JSON.stringify(p.layout)===JSON.stringify(s.layout)?p:{layout:s.layout,version:s.layoutVersion});
    // التنبيهات اللي كانت موجودة قبل فتح الصفحة ما تطلع كنوافذ منبثقة
    const list=s.alerts||[];
    if(!seenAlerts.current){seenAlerts.current=new Set(list.map(a=>a.id));return;}
    const fresh=list.filter(a=>!seenAlerts.current.has(a.id));fresh.forEach(a=>seenAlerts.current.add(a.id));
    if(fresh.length){setToasts(v=>[...fresh,...v].slice(0,4));fresh.forEach(a=>setTimeout(()=>dismiss(a.id),10000));}
  }).catch(e=>{if(seq===refreshSeq.current){if(e.status===401)clearSession();else setRefreshError(true);}}).finally(()=>{
    refreshFlight.current=null;
    if(refreshAgain.current){refreshAgain.current=false;if(meRef.current)queueMicrotask(refresh);}
  });refreshFlight.current=work;return work;};
  useEffect(()=>{if(!me)return;refresh();const changed=()=>{if(meRef.current)refresh();};window.addEventListener('azm-state-invalidated',changed);const stop=watchAzmState(changed,clearSession);const id=setInterval(refresh,3000);return()=>{stop();clearInterval(id);window.removeEventListener('azm-state-invalidated',changed);};},[me]);
  // قرار القائد على الطلب الأصلي من الخريطة أو الداشبورد: المصدر + الكميات + الوسيلة. لا خصم ولا شحنة؛
  // يصير الطلب «معتمد — بانتظار مباشرة مسؤول القاعدة». نعرض رد الخادم ثم نزامن الحالة المشتركة.
  const decideRequest=(r,fromId=null,extra={},operationKey=null)=>{
    const mode=extra.mode||r.mode,route=r.kind==='base'?null:planRoute(layout,r.unitId,mode,fromId);
    if(r.kind!=='base'&&!route)return Promise.reject({code:'no_route'});
    const body={...(r.kind==='base'?extra:{route:{path:route.path,km:Math.round(route.km),hours:+route.hours.toFixed(2),fromId:route.from.id,fromLabel:nodeName(route.from,t)},...extra,mode}),...(operationKey?{operationKey}:{})};
    return api(`/api/requests/${r.id}/approve`,{method:'POST',body}).then(updated=>{setRequests(v=>v.map(x=>x.id===updated.id?updated:x));return refresh();});
  };
  // حفظ الخريطة (القائد): يرجع رقم التخطيط الجديد، أو يرفض بالخطأ (تعارض، كيان مستخدم…) حتى ترجع الخريطة لنسخة الخادم
  const saveLayout=(next,baseVersion)=>api('/api/layout',{method:'PUT',body:{...next,...(baseVersion!=null?{baseVersion}:{})}}).then(r=>{setServerLayout({layout:next,version:r.layoutVersion});return r.layoutVersion;});
  const setSimOption=body=>api('/api/sim',{method:'POST',body}).then(r=>{simRef.current={hours:simClock(),at:Date.now()+offsetRef.current,speed:r.speed};setSim(v=>({...v,...r}));}).catch(()=>{});

  // الوحدات تُشتق من نقاط الخريطة (المفلترة حسب النطاق): كل نقطة وحدة = وحدة حقيقية بمخزون ومسارات، والمخزون والسعة من الخادم
  const layout=useMemo(()=>normalizeLayout(serverLayout?.layout),[serverLayout]);
  const routes=useMemo(()=>Object.fromEntries(layout.nodes.filter(n=>n.type==='unit').map(n=>[n.unitId,{truck:planRoute(layout,n.unitId,'truck'),heli:planRoute(layout,n.unitId,'heli')}])),[layout]);
  const units=layout.nodes.filter(n=>n.type==='unit'&&(stocks[n.unitId]||inventory[n.id])).map(n=>{const d=unitDefaults(n.unitId),s=stocks[n.unitId]||d,r=routes[n.unitId],inv=inventory[n.id];return {...d,id:n.unitId,nodeId:n.id,code:n.code,status:n.status,archived:n.archived,deletedAt:n.deletedAt,label:n.label,people:n.people??d.people,vehicles:n.vehicles??d.vehicles,baseId:n.baseId||null,supplyId:n.supplyId||null,allowedResources:n.allowedResources,fuelType:n.fuelType??null,capacity:inv?.capacity,qty:inv?.qty,inTransit:inv?.inTransit,reserved:inv?.reserved,...Object.fromEntries(allResources.map(x=>[x.key,s[x.key]??0])),distance:Math.round(r.truck?.km??r.heli?.km??0),truck:r.truck?r.truck.hours:null,heli:r.heli?r.heli.hours:null,supplyFrom:(r.truck||r.heli)?.from||null};});

  const logout=()=>{api('/api/logout',{method:'POST'}).catch(()=>{}).finally(clearSession);};
  const isAdmin=me?.role==='admin';
  // الخادم يرسل وحدات نطاق الحساب فقط: القائد كلها، مسؤول القاعدة وحدات قاعدته، مسؤول الوحدة وحدته
  const visible=me?units:[];
  const allowedTab=id=>tabs.some(([x,,only])=>x===id&&(!only||only.includes(me?.role)));
  const page=allowedTab(tab)?tab:'dashboard';
  const shared={me,units:visible,allUnits:units,layout,requests,alerts,serverLayout,simClock,simPaused:sim.speed===0,basesWithoutManager,mapOthers,onSaveLayout:saveLayout,depots,hierarchy,inventory,refresh,onOpenRequest:setOpenRequestId};
  return <LangContext.Provider value={{lang,setLang,t}}>
    {checking?null:!me?<Login onEnter={u=>{clearSession();setMe(u);}}/>:
    <div className={`app-shell role-${me.role}`}><Header me={me} units={visible} allUnits={units} layout={layout} requests={requests} speed={sim.speed} setSpeed={x=>setSimOption({speed:x})} simHours={sim.hours} onHome={()=>setTab('dashboard')} onExit={logout} onOpen={setInfoModal} onRefresh={()=>{setRefreshing(true);Promise.resolve(refresh()).finally(()=>setTimeout(()=>setRefreshing(false),400));}}/><Nav tab={page} setTab={setTab} role={me.role} badges={{users:pendingUsers}}/><main className="workspace">{refreshError&&<div className="form-error state-refresh-error">{t('state.refreshFailed')} <button onClick={refresh}>{t('common.refresh')}</button></div>}{page==='dashboard'&&<Dashboard {...shared}/>} {page==='inventory'&&<Inventory units={visible}/>} {page==='routes'&&<Routes {...shared}/>} {page==='log'&&<Logs me={me} logs={logs} layout={layout}/>} {page==='reports'&&<Reports me={me} units={visible} requests={requests} layout={layout} inventory={inventory} trackingStartedAt={trackingStartedAt}/>} {page==='databases'&&<Databases {...shared}/>} {page==='catalog'&&isAdmin&&<Catalog onChanged={refresh} onOpenUnits={()=>setTab('databases')}/>} {page==='users'&&(isAdmin||me.role==='base_manager')&&<Users me={me} allUnits={units} layout={layout} onChanged={refresh}/>}</main>
      <Bottom units={visible} requests={requests} simHours={sim.hours}/><Toasts toasts={toasts} dismiss={dismiss} units={units}/><Assistant me={me} units={visible} onDraft={setAiDraft}/>
      {aiDraft&&<RequestModal me={me} units={visible} layout={layout} prefill={aiDraft} onClose={()=>setAiDraft(null)} onCreated={refresh}/>}
      {openRequestId&&<RequestDetails key={openRequestId} me={me} id={openRequestId} requests={requests} units={units} layout={layout} depots={depots} inventory={inventory} simClock={simClock} simPaused={sim.speed===0} basesWithoutManager={basesWithoutManager} onClose={()=>setOpenRequestId(null)} onApprove={decideRequest} refresh={refresh}/>}
      {infoModal==='how'&&<HowItWorks onClose={()=>setInfoModal(null)}/>}
      {infoModal==='optecho'&&<Optecho onClose={()=>setInfoModal(null)}/>}
      {infoModal==='sitrep'&&<Sitrep units={visible} requests={requests} refresh={refresh} onClose={()=>setInfoModal(null)}/>}
      {refreshing&&<div className="refresh-flash">↻ {t('common.refreshed')}</div>}</div>}
  </LangContext.Provider>;
}
