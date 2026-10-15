// صفحة القواعد (قواعد بيانات الإمداد) — حسب الدور:
//   القائد: كل القواعد مع اختيار قاعدة، أدوات الإنشاء وإضافة المخزون والتحويل، طلبات المركز الرئيسي، وأرشفة الوحدات
//   مسؤول القاعدة: قاعدته ومراكزها ووحداتها + التحويل داخل القاعدة
//   مسؤول الوحدة: مخزون وحدته وسلسلة إمدادها (أسماء فقط بدون أرصدة المستودعات)
const pctClass = p => p < 25 ? 'red' : p < 50 ? 'amber' : 'green';

// رصيد كل صنف من سعته، وبالطريق إليه. رصيد فوق السعة (بعد تخفيض سعة في الكتالوج) يبقى كما هو ويُعلَّم
function DepotRows({ stock, capacity, inTransit = {} }) {
  const { t } = useLang();
  return <div className="depot-rows">{resources.map(r => { const q = stock[r.key] || 0, cap = capacity[r.key] || 0, p = cap ? Math.min(100, q / cap * 100) : 0, over = cap && q > cap;
    return <div key={r.key} className={`depot-row ${over ? 'over' : ''}`}><span>{r.icon} {resName(t, r.key)}</span><div className="depot-bar"><i className={pctClass(p)} style={{ width: `${p}%` }}/></div><b dir="ltr">{fmtQty(q)}</b><small>/ {fmtQty(cap)} {resUnitName(t, r.key)}{inTransit[r.key] > 0 ? ` · 🚛 +${fmtQty(inTransit[r.key])}` : ''}{over ? ` · ⚠ ${t('db.overCapacity')}` : ''}</small></div>; })}</div>;
}

function UnitRows({ units, inventory = {}, onArchive = null, onEditResources = null, onService = null }) {
  const { t } = useLang();
  if (!units.length) return <p className="empty">{t('db.noUnits')}</p>;
  return <table className="db-units"><thead><tr><th>{t('common.unit')}</th><th>{t('ent.unitResources')}</th><th>{t('req.status')}</th>{onArchive && <th/>}</tr></thead>
    <tbody>{units.map(u => { const s = statusFor(u); return <tr key={u.id}><td><b>{unitName(t, u)}</b><small>{u.id} · {u.people} {t('unit.people')}</small></td>
      <td>{unitVisibleResources(u).map(r => { const condition=inventory[u.nodeId]?.maintenance?.[r.key]; return <span className="unit-resource-chip" key={r.key}>{r.icon} {resName(t, r.key)} <b>{fmtQty(unitQty(u,r.key))} / {fmtQty(capacityOf(u,r.key))} {resUnitName(t,r.key)}</b>{r.usage==='maintenance' && condition && <small> · {t('maintenance.condition', { n: Math.round(condition.condition) })}{condition.due && onService && <button onClick={()=>onService(u,r.key)}>{t('maintenance.service')}</button>}</small>}</span>; })}</td>
      <td><span className={`chip ${s}`}>{t(`state.${s}`)}</span></td>{onArchive && <td><button className="archive-btn" onClick={() => onArchive(u)}>🗄 {t('db.archiveUnit')}</button></td>}</tr>; })}</tbody></table>;
}

// تحويل فوري بين مستودعين: القائد بين أي مستودعين (بين قاعدتين بسبب إلزامي)، ومسؤول القاعدة داخل قاعدته
function DepotAction({ layout, depots, inventory, preset, onClose, onDone }) {
  const { t } = useLang();
  const depotNodes = layout.nodes.filter(n => (n.type === 'main' || n.type === 'fsb') && depots[n.id]);
  const [from, setFrom] = useState(preset.from || depotNodes[0]?.id);
  const [to, setTo] = useState(preset.to || depotNodes.find(n => n.id !== (preset.from || depotNodes[0]?.id))?.id);
  const [resource, setResource] = useState(resources[0]?.key || ''), [qty, setQty] = useState(null), [reason, setReason] = useState(''), [error, setError] = useState(null), [busy, setBusy] = useState(false), [done, setDone] = useState(null), sending=useRef(false);
  const [batch, setBatch] = useState(null), transferKey=useRef(newAzmTabId());
  useEffect(()=>{setBatch(preset.refill ? resources.map(r=>({resource:r.key,...depotRoomInfo(to,r.key,depots,inventory,'fsb')})).filter(i=>i.capacity>0).map(i=>({...i,qty:i.room,selected:i.room>0})) : null);transferKey.current=newAzmTabId();},[from,to]);
  // إذا فُتحت النافذة قبل وصول الأرصدة، يُختار المصدر والوجهة الافتراضيان عند وصولها
  useEffect(()=>{ const f=from&&depotNodes.some(n=>n.id===from)?from:depotNodes[0]?.id; if(f!==from)setFrom(f); if(!to||to===f||!depotNodes.some(n=>n.id===to))setTo(depotNodes.find(n=>n.id!==f)?.id); },[depotNodes.length]);
  useEffect(()=>{ if (!resources.some(r=>r.key===resource) && resources.length) setResource(resources[0].key); },[resource,resources.length]);
  const baseOfNode = id => { const n = depotNodes.find(x => x.id === id); return n ? (n.type === 'main' ? n.id : n.baseId) : null; };
  const crossBase = from && to && baseOfNode(from) !== baseOfNode(to);
  const available = Math.floor(depots[from]?.[resource] || 0), toNode = depotNodes.find(n => n.id === to);
  // المساحة في الوجهة = السعة − الرصيد − الشحنات بالطريق إليها (نفس حساب الخادم)
  const destinationInfo=depotRoomInfo(to,resource,depots,inventory,toNode?.type||'fsb'),room=destinationInfo.room,limit=Math.max(0,Math.min(room,available)),amount=qty===null?limit:Number(qty);
  const submit = e => {
    e.preventDefault(); if(sending.current)return;const n = amount; if (!batch && (!Number.isInteger(n) || n <= 0 || n>limit)) return setError({ code: 'invalid_quantity' });
    if (crossBase && !reason.trim()) return setError({ code: 'cross_base_reason_required' });
    sending.current=true;setBusy(true); setError(null);
    api(`/api/depots/${from}/transfer`, { method: 'POST', body: { to, refill: !!preset.refill, operationKey:transferKey.current, ...(batch?{items:batch.filter(i=>i.selected).map(i=>({resource:i.resource,qty:Number(i.qty)}))}:{resource,...(qty===null?{fill:true}:{qty:n})}), ...(reason.trim() ? { reason: reason.trim() } : {}) } })
      .then(r => { setDone(r); onDone(); }).catch(err => setError(err)).finally(() => {sending.current=false;setBusy(false);});
  };
  const opt = n => <option key={n.id} value={n.id}>{n.type === 'main' ? '★' : '▪'} {nodeName(n, t)}</option>;
  if (done) return <Modal title={t(preset.refill ? 'db.refillCenter' : 'db.transferTitle')} onClose={onClose}>
    <div className="req-banner delivered">✓ {t('db.transferDone', { op: done.opId })}</div>
    {done.movements.map(m=><div key={m.resource}><b>{resName(t,m.resource)}</b><table className="items-table"><thead><tr><th/><th>{t('stock.before')}</th><th>{t('stock.after')}</th></tr></thead><tbody>{['from','to'].map(side=><tr key={side}><td>{t(`db.${side}`)}: {nodeName(depotNodes.find(n=>n.id===m[side].entityId),t)}</td><td>{fmtQty(m[side].before)}</td><td>{fmtQty(m[side].after)}</td></tr>)}</tbody></table></div>)}
    <footer className="req-actions"><button className="approve" onClick={onClose}>{t('common.close')}</button></footer>
  </Modal>;
  return <Modal title={t(preset.refill ? 'db.refillCenter' : 'db.transferTitle')} onClose={onClose}>
    <form className="req-form" onSubmit={submit}>
      <label>{t('db.from')}<select disabled={!!preset.refill || busy} value={from} onChange={e => {setFrom(e.target.value);setQty(null);if(e.target.value===to)setTo(depotNodes.find(n=>n.id!==e.target.value)?.id);}}>{depotNodes.map(opt)}</select></label>
      <label>{t('db.to')}<select disabled={!!preset.refill || busy} value={to} onChange={e => {setTo(e.target.value);setQty(null);}}>{depotNodes.filter(n => n.id !== from).map(opt)}</select></label>
      <button type="button" className="bulk-fill-btn" disabled={busy||!from||!to||!!preset.refill} onClick={()=>{transferKey.current=newAzmTabId();setBatch(resources.map(r=>({resource:r.key,...depotRoomInfo(to,r.key,depots,inventory,toNode?.type||'fsb')})).filter(i=>i.capacity>0).map(i=>{const q=Math.max(0,Math.min(i.room,Math.floor(depots[from]?.[i.resource]||0)));return {...i,qty:q,selected:q>0};}));setError(null);}}>{t('db.fillAll')}</button>
      {batch && <div className="bulk-fill"><p className="bulk-fill-hint">{t('db.fillAllHint')}</p><div className="bulk-fill-list">{batch.map(i=><div key={i.resource} className={`bulk-fill-row${i.selected?'':' off'}`}><label className="pick"><input type="checkbox" disabled={busy} checked={i.selected} onChange={e=>{transferKey.current=newAzmTabId();setBatch(batch.map(x=>x.resource===i.resource?{...x,selected:e.target.checked}:x));}}/>{resName(t,i.resource)}</label><label className="qty">{t('db.qty',{unit:resUnitName(t,i.resource)})}<input type="number" dir="ltr" min="1" step="1" disabled={busy||!i.selected} value={i.qty} onChange={e=>{transferKey.current=newAzmTabId();setBatch(batch.map(x=>x.resource===i.resource?{...x,qty:e.target.value}:x));}}/></label><div className="meta"><StockRoomSummary info={i} resource={i.resource}/><small>{t('db.available',{n:fmtQty(depots[from]?.[i.resource]||0)})}</small></div></div>)}</div></div>}
      {!batch && <div className="req-grid">
        <label>{t('routes.type')}<select value={resource} onChange={e => {setResource(e.target.value);setQty(null);}}>{resources.map(r => <option key={r.key} value={r.key}>{r.icon} {resName(t, r.key)}</option>)}</select></label>
        <div><label>{t('db.qty', { unit: resUnitName(t, resource) })}</label><FillQuantity value={qty} onChange={setQty} info={{...destinationInfo,limit}} resource={resource}/></div>
      </div>}
      {!batch && <small className="route-info">{t('db.available', { n: fmtQty(available) })} · {t('db.room', { n: fmtQty(Math.max(0, room)) })}</small>}
      {!batch && <StockRoomSummary info={destinationInfo} resource={resource}/>}
      {crossBase && <label className="cross-reason">⚠ {t('db.crossBaseReason')}<input dir="auto" maxLength="300" value={reason} onChange={e => setReason(e.target.value)}/></label>}
      {error && <span className="form-error">{errText(t, error)}{errDetail(t, error)}{error.failures?.map(i=><div key={i.resource}>{resName(t,i.resource)}: {t(`err.${i.error}`)} / {t('db.available', { n: fmtQty(i.available) })} / {t('db.missing', { n: fmtQty(Math.max(0,i.qty-i.available)) })}</div>)}</span>}
      <footer><button type="button" className="reject" onClick={onClose}>{t('dash.cancel')}</button><button type="submit" className="approve" disabled={busy || !to || (batch ? !batch.some(i=>i.selected)||batch.some(i=>i.selected&&(!Number.isInteger(Number(i.qty))||Number(i.qty)<=0)) : !Number.isInteger(amount)||amount<=0||amount>limit)}>{t('db.transfer')}</button></footer>
    </form>
  </Modal>;
}

// نشاط القاعدة: الطلبات المعلقة، القوافل بالطريق، وآخر التنبيهات (حسب تبعية السجل وقت إنشائه)
function BaseActivity({ base, requests, alerts, units }) {
  const { t } = useLang();
  const mine = requests.filter(r => r.baseId === base.id), pend = mine.filter(r => r.status === 'pending' || r.status === 'assigned'), moving = mine.filter(r => r.status === 'approved' && !r.stalled);
  const al = alerts.filter(a => a.baseId === base.id).slice(0, 5);
  const row = r => <li key={r.id}><span>{r.status === 'approved' ? (r.mode === 'heli' ? '✈️' : '🚛') : priorityIcon[r.priority || 'normal']} {r.id} · {t(`req.status.${r.status}`)} · {r.kind === 'base' ? t('req.kind.base') : nameById(t, units, r.unitId)}</span><b>{reqItems(r).map(i => resName(t, i.resource)).join(' + ')}</b></li>;
  return <div className="db-grid three">
    <div className="db-card"><h5>{t('dash.pending')} <em>{pend.length}</em></h5>{pend.length ? <ul className="ni-list">{pend.slice(0, 6).map(row)}</ul> : <small className="ni-muted">{t('info.none')}</small>}</div>
    <div className="db-card"><h5>{t('dash.convoys')} <em>{moving.length}</em></h5>{moving.length ? <ul className="ni-list">{moving.slice(0, 6).map(row)}</ul> : <small className="ni-muted">{t('info.none')}</small>}</div>
    <div className="db-card"><h5>{t('alerts.title')} <em>{al.length}</em></h5>{al.length ? <ul className="ni-list">{al.map(a => <li key={a.id}><span>{alertIcon[a.level]} {nameById(t, units, a.unitId)}</span><b>{resName(t, a.resource)} {a.value}%</b></li>)}</ul> : <small className="ni-muted">{t('alerts.none')}</small>}</div>
  </div>;
}

// مراجعة سياسة الموارد (القائد): ما بقي من السياسة السابقة دون حذف — أرصدة أصناف غير تشغيلية لدى الوحدات،
// وحدات نوع وقودها غير محدد، طلبات قديمة بانتظار قرار، وشحنات قديمة بالطريق تُسلَّم مرة واحدة كالمعتاد.
function PolicyReview({ layout, units, requests, onEditUnit }) {
  const { t } = useLang();
  const [data, setData] = useState(null), [error, setError] = useState(null);
  const pendingCount = requests.filter(r => r.status === 'pending' || r.status === 'assigned').length;
  useEffect(() => { api('/api/policy/review').then(setData).catch(setError); }, [layout, pendingCount]);
  if (error) return <p className="form-error">{errText(t, error)}</p>;
  if (!data) return null;
  const empty = !data.units.length && !data.legacyRequests.length && !data.legacyInTransit.length && !data.basesWithoutManager.length;
  const unitOf = id => units.find(u => u.id === id);
  const baseName = id => { const n = layout.nodes.find(x => x.id === id); return n ? nodeName(n, t) : id; };
  return <section className="db-base policy-review" data-empty={empty}>
    <header className="db-base-head"><div><h3>🧭 {t('policy.title')}</h3><small>{t('policy.sub')}</small></div></header>
    {empty ? <p className="ni-muted">{t('policy.clean')}</p> : <div className="db-grid">
      {data.units.length > 0 && <div className="db-card"><h4>{t('policy.unitsTitle')}</h4><ul className="ni-list">{data.units.map(u => { const unit = unitOf(u.unitId); return <li key={u.unitId}><span>{unit ? unitName(t, unit) : u.unitId} · {u.missingFood.length > 0 && <small> · {t('policy.missingFood', { n: u.missingFood.length })}</small>}{u.legacy.length > 0 && <small> · {t('policy.legacyHoldings', { list: u.legacy.map(l => `${resName(t, l.resource)} ${fmtQty(l.qty)}${l.inTransit ? ` (+${fmtQty(l.inTransit)})` : ''}`).join('، ') })}</small>}</span></li>; })}</ul></div>}
      {(data.legacyRequests.length > 0 || data.legacyInTransit.length > 0) && <div className="db-card"><h4>{t('policy.requestsTitle')}</h4><small className="ni-muted">{t('policy.requestsHint')}</small><ul className="ni-list">{[...data.legacyRequests, ...data.legacyInTransit].map(r => <li key={r.id}><span><code>{r.id}</code> · {t(`req.status.${r.status}`)}</span><b>{r.items.map(i => resName(t, i.resource)).join(' + ')}</b></li>)}</ul></div>}
      {data.basesWithoutManager.length > 0 && <div className="db-card"><h4>{t('policy.noManagerTitle')}</h4><small className="ni-muted">{t('exec.noManager')}</small><ul className="ni-list">{data.basesWithoutManager.map(id => <li key={id}>★ {baseName(id)}</li>)}</ul></div>}
    </div>}
  </section>;
}

// مسؤول الوحدة: مخزون وحدته بالكمية والنسبة، الرصيد الافتتاحي، الشحنات بالطريق، وسلسلة الإمداد بالأسماء
function MyUnitView({ me, units, layout, inventory }) {
  const { t } = useLang();
  const u = units.find(x => x.id === me.unitId), node = layout.nodes.find(n => n.type === 'unit' && n.unitId === me.unitId);
  if (!u || !node) return <p className="empty">{t('dash.noUnitsScope')}</p>;
  const byId = Object.fromEntries(layout.nodes.map(n => [n.id, n])), inv = inventory[node.id];
  const lines = ['truck', 'heli'].map(m => [m, planRoute(layout, u.id, m)]);
  return <section className="db-base">
    <header className="db-base-head"><span className="ni-icon unit">⬢</span><div><h3>{unitName(t, u)}</h3><small><code>{node.code || node.id}</code> · {t('db.chainBase', { base: byId[node.baseId] ? nodeName(byId[node.baseId], t) : '—' })}</small></div></header>
    <div className="db-grid">
      <div className="db-card"><h4>{t('db.myStock')}</h4>
        <table className="db-sum"><thead><tr><th/><th>{t('db.colCurrent')}</th><th>{t('db.colCapacity')}</th><th>{t('db.colInTransit')}</th><th>{t('db.colOpening')}</th></tr></thead>
          <tbody>{unitVisibleResources(u).map(r => <tr key={r.key}><td>{r.icon} {resName(t, r.key)}<small>{resUnitName(t, r.key)}</small></td><td dir="ltr"><b>{fmtQty(unitQty(u, r.key))}</b> <small className={`pct-text ${pctClass(u[r.key])}`}>{Math.round(u[r.key])}%</small></td><td dir="ltr">{fmtQty(capacityOf(u, r.key))}</td><td dir="ltr">{fmtQty(u.inTransit?.[r.key] || 0)}</td><td dir="ltr">{inv ? fmtQty(inv.opening[r.key]) : '—'}</td></tr>)}</tbody></table>
        {inv && <small className="ni-muted">{t('db.openingAt', { at: fmtDateTime(inv.openingAt) })}</small>}
      </div>
      <div className="db-card"><h4>{t('info.supply')}</h4>
        <ul className="ni-list">{lines.map(([m, r]) => <li key={m}><span>{m === 'heli' ? '✈️' : '🚛'} {r ? nodeName(r.from, t) : t('req.noRouteShort')}</span>{r && <b><bdi dir="ltr">{Math.round(r.km)} {t('common.km')}</bdi> · {fmtHours(r.hours)}</b>}</li>)}</ul>
        <ul className="ni-list">{layout.nodes.filter(n => n.type === 'main' || n.type === 'fsb').map(n => <li key={n.id}>{nodeName(n, t)}</li>)}</ul><small className="ni-muted">{t('db.unitPrivacy')}</small>
      </div>
    </div>
  </section>;
}

function Databases({ me, units, layout, depots, inventory = {}, requests = [], alerts = [], refresh }) {
  const { t } = useLang();
  const isAdmin = me.role === 'admin';
  const [action, setAction] = useState(null), [pick, setPick] = useState('all'), [msg, setMsg] = useState(null), [err, setErr] = useState(null);
  if (me.role === 'user') return <div className="page-pad db-page"><div className="page-heading"><h2>🗄️ {t('db.myUnitTitle')}</h2><small>{t('db.myUnitSub')}</small></div><MyUnitView me={me} units={units} layout={layout} inventory={inventory}/></div>;
  const unitByNode = n => units.find(u => u.id === n.unitId);
  // الخادم يرسل مستودعات النطاق فقط: القائد كل القواعد، ومسؤول القاعدة قاعدته
  const tree = buildTree(layout).filter(b => depots[b.base.id]);
  const shown = tree.filter(b => pick === 'all' || b.base.id === pick);
  const sum = (list, key) => list.reduce((s, u) => s + unitQty(u, key), 0);
  const unassigned = isAdmin ? layout.nodes.filter(n => n.type !== 'main' && n.type !== 'hq' && !n.baseId) : [];
  const hq = isAdmin;
  const hqPending = requests.filter(r => r.kind === 'base' && r.status === 'pending').length, hqMoving = requests.filter(r => r.kind === 'base' && r.status === 'approved' && !r.stalled).length;
  // إزالة وحدة (القائد) = أرشفة تحفظ الطلبات والحركات. الخادم يرفض مع السبب إذا عليها طلبات نشطة أو شحنات
  const archiveUnit = u => {
    if (!confirm(t('db.archiveConfirm', { name: unitName(t, u) }))) return;
    setMsg(null); setErr(null);
    api(`/api/entities/${u.nodeId}`, { method: 'DELETE' }).then(() => { setMsg(t('db.archived', { name: unitName(t, u) })); refresh(); }).catch(e => setErr({ ...e, unitName: unitName(t, u) }));
  };
  const serviceUnit = (u, resource) => {
    const reason = prompt(t('maintenance.reason'));
    if (!reason?.trim()) return;
    setErr(null);
    api(`/api/entities/${u.nodeId}/maintenance`, { method: 'POST', body: { resource, reason: reason.trim() } }).then(refresh).catch(setErr);
  };
  return <div className="page-pad db-page">
    <div className="page-heading"><h2>🗄️ {t(isAdmin ? 'db.title' : 'db.titleBase')}</h2><small>{t(isAdmin ? 'db.sub' : 'db.subBase')}</small>
      <div className="db-actions">
        {isAdmin && <button onClick={() => setAction({ kind: 'create', type: 'main' })}>＋ {t('ent.createTitle')}</button>}
        {isAdmin && <button onClick={() => setAction({ kind: 'add', preset: pick !== 'all' ? pick : null })}>＋ {t('stock.addTitle')}</button>}
        <button onClick={() => setAction({ kind: 'transfer', preset: {} })}>⇄ {t('db.transfer')}</button>
      </div>
    </div>
    {msg && <p className="form-notice">{msg}</p>}
    {err && <p className="form-error">{errText(t, err)}{errDetail(t, err)}{err.code === 'entity_in_use' ? ` ${t('db.archiveHowTo')}` : ''}</p>}
    {hq && <section className="db-hq"><span className="ni-icon hq">◆</span><div><h3>{t('supply.virtual')}</h3><small>{t('hq.unlimitedNote')}</small></div><span className="hq-stat">{t('hq.pending', { n: hqPending })}</span><span className="hq-stat">{t('hq.moving', { n: hqMoving })}</span></section>}
    {isAdmin && <StructureReview layout={layout} onChanged={refresh}/>}
    {isAdmin && <PolicyReview layout={layout} units={units} requests={requests}/>}
    {isAdmin && tree.length > 1 && <div className="filter-chips base-pick"><button className={pick === 'all' ? 'active' : ''} onClick={() => setPick('all')}>{t('db.allBases')} <span>{tree.length}</span></button>{tree.map(b => <button key={b.base.id} className={pick === b.base.id ? 'active' : ''} onClick={() => setPick(b.base.id)}>★ {nodeName(b.base, t)}</button>)}</div>}
    {!tree.length && <p className="empty">{t('db.none')}</p>}
    {shown.map(({ base, fsbs, units: unitNodes }) => {
      const fsbList = fsbs.filter(f => depots[f.id]);
      const allUnits = unitNodes.map(unitByNode).filter(Boolean);
      return <section key={base.id} className="db-base">
        <header className="db-base-head">
          <span className="ni-icon main">★</span>
          <div><h3>{nodeName(base, t)}</h3><small><code>{base.code || base.id}</code> · {t('info.type.main')} · {t('db.counts', { f: fsbList.length, u: allUnits.length })}</small></div>
          {me.role === 'base_manager' && <><button className="hq-btn" onClick={() => setAction({ kind: 'hqreq', baseId: base.id })}>◆ {t('breq.cta')}</button><button onClick={() => setAction({ kind: 'create', type: 'unit', baseId: base.id, unitOnly: true })}>⬢ {t('ent.newUnit')}</button></>}
          {isAdmin && <><button onClick={() => setAction({ kind: 'add', preset: base.id })}>＋ {t('stock.addTitle')}</button><button onClick={() => setAction({ kind: 'create', type: 'fsb', baseId: base.id })}>▪ {t('ent.newFsb')}</button><button onClick={() => setAction({ kind: 'create', type: 'unit', baseId: base.id })}>⬢ {t('ent.newUnit')}</button></>}
        </header>
        <div className="db-grid">
          <div className="db-card">
            <h4>{t('db.baseDepot')}</h4>
            <DepotRows stock={depots[base.id]} capacity={inventory[base.id]?.capacity || depotCapOf('main')} inTransit={inventory[base.id]?.inTransit}/>
          </div>
          <div className="db-card">
            <h4>{t('db.summary')}</h4>
            <table className="db-sum"><thead><tr><th/><th>{t('db.colBase')}</th><th>{t('db.colFsb')}</th><th>{t('db.colUnits')}</th><th>{t('db.colTotal')}</th><th>{t('db.colInTransit')}</th></tr></thead>
              <tbody>{resources.map(r => { const a = depots[base.id][r.key], b = fsbList.reduce((s, f) => s + depots[f.id][r.key], 0), c = sum(allUnits, r.key), tr = allUnits.reduce((s, u) => s + (u.inTransit?.[r.key] || 0), 0) + [base, ...fsbList].reduce((s, n) => s + (inventory[n.id]?.inTransit?.[r.key] || 0), 0);
                return <tr key={r.key}><td>{r.icon} {resName(t, r.key)}<small>{resUnitName(t, r.key)}</small></td><td dir="ltr">{fmtQty(a)}</td><td dir="ltr">{fmtQty(b)}</td><td dir="ltr">{fmtQty(c)}</td><td dir="ltr"><b>{fmtQty(a + b + c)}</b></td><td dir="ltr">{fmtQty(tr)}</td></tr>; })}</tbody></table>
            <small className="ni-muted">{t('db.summaryHint')}</small>
          </div>
        </div>
        <BaseActivity base={base} requests={requests} alerts={alerts} units={units}/>
        {fsbList.length > 0 && <div className="db-fsb-grid">{fsbList.map(node => <div key={node.id} className="db-fsb">
            <header><span className="ni-icon fsb">▪</span><div><h4>{nodeName(node, t)}</h4><small><code>{node.code || node.id}</code> · {t('info.type.fsb')}</small></div>
              <button onClick={() => setAction({ kind: 'transfer', preset: { from: base.id, to: node.id } })}>⇄ {t('db.transferFromBase')}</button><button onClick={() => setAction({ kind: 'transfer', preset: { from: base.id, to: node.id, refill: true } })}>{t('db.refillCenter')}</button></header>
            <DepotRows stock={depots[node.id]} capacity={inventory[node.id]?.capacity || depotCapOf('fsb')} inTransit={inventory[node.id]?.inTransit}/>
          </div>)}</div>}
        <div className="db-fsb direct"><header><div><h4>{t('db.baseUnits')}</h4><small>{t('db.baseUnitsHint')}</small></div></header><UnitRows units={allUnits} inventory={inventory} onArchive={isAdmin ? archiveUnit : null} onService={isAdmin ? serviceUnit : null}/></div>
      </section>;
    })}
    {unassigned.length > 0 && <section className="db-base"><header className="db-base-head"><div><h3>⚠ {t('db.unassigned')}</h3><small>{t('ent.reviewHint')}</small></div></header><ul className="ni-list">{unassigned.map(n => <li key={n.id}><span>{entityIcon[n.type]} {nodeName(n, t)}</span><b>{n.unitId || n.id}</b></li>)}</ul></section>}
    {action?.kind === 'transfer' && <DepotAction preset={action.preset} layout={layout} depots={depots} inventory={inventory} onClose={() => setAction(null)} onDone={refresh}/>}
    {action?.kind === 'add' && <AddStockModal layout={layout} depots={depots} inventory={inventory} presetBaseId={action.preset} onClose={() => setAction(null)} onDone={refresh}/>}
    {action?.kind === 'hqreq' && <BaseRequestModal me={me} layout={layout} depots={depots} inventory={inventory} presetBaseId={action.baseId} onClose={() => setAction(null)} onCreated={r => { setMsg(t('req.created', { id: r.id })); refresh(); }}/>}
    {action?.kind === 'create' && <CreateEntityModal type={action.type} layout={layout} presetBaseId={action.baseId} unitOnly={!!action.unitOnly} onClose={() => setAction(null)} onCreated={refresh}/>}
  </div>;
}
