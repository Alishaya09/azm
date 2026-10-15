// صفحة لوحة التحكم — نفس الصفحة للأدوار الثلاثة، والمحتوى حسب النطاق اللي يرسله الخادم:
//   القائد: كل الوحدات والطلبات واحتياجات القواعد + قرارات الطلبات وتعديل الخريطة
//   مسؤول القاعدة: قاعدته، ومتابعة طلبات وحداتها، ومباشرة تكليفات القائد (استلام الأمر وبدء التنفيذ)
//   مسؤول الوحدة: وحدته وطلباتها وشحناتها
// كل بطاقة طلب تعرض مرحلته الحالية والخطوة التالية (RequestStage) حتى لا يبدو تغيير الوسيلة أو القرار وكأنه إرسال.
function Dashboard({me, units, allUnits, layout, requests, alerts, refresh, serverLayout, simClock, simPaused = false, basesWithoutManager = [], mapOthers = [], onSaveLayout, depots, hierarchy, inventory, onOpenRequest}) {
  const { t } = useLang();
  const isAdmin = me.role === 'admin', decide = canDecide(me), isBaseManager = me.role === 'base_manager';
  const [creating, setCreating] = useState(null), [baseReq, setBaseReq] = useState(false), [error, setError] = useState(null), [notice, setNotice] = useState(null), [busyId, setBusyId] = useState(null);
  const known = r => r.kind === 'base' || allUnits.some(u => u.id === r.unitId);
  // كل قرارات الطلبات للقائد وحده (ويتحقق الخادم أيضاً).
  const canDecideReq = r => r.kind === 'base' ? isAdmin : decide && (isAdmin || r.baseId === me.baseId);
  const pending = requests.filter(r => r.status === 'pending' && known(r) && canDecideReq(r));
  const assigned = requests.filter(r => r.status === 'assigned' && known(r));
  const approved = requests.filter(r => r.status === 'approved' && !r.stalled), stalled = requests.filter(r => r.stalled && r.status === 'approved');
  const baseShortages = me.role === 'user' ? [] : layout.nodes.filter(n => n.type === 'main' && inventory[n.id]).flatMap(n =>
    Object.entries(inventory[n.id].capacity || {}).filter(([key, cap]) => cap > 0 && resources.some(r => r.key === key && r.active) && (depots[n.id]?.[key] || 0) / cap <= .45)
      .map(([key, cap]) => ({ base: n, resource: key, qty: depots[n.id]?.[key] || 0, cap })));
  // كل إجراء يحمل operationKey خاصاً بهذه الضغطة؛ الضغط المكرر يعيد نفس النتيجة دون تنفيذ ثانٍ
  const act = (id, action, body = {}) => { if (busyId) return Promise.reject(null); setBusyId(id); setError(null); setNotice(null);
    return api(`/api/requests/${id}/${action}`, { method: 'POST', body: { ...body, operationKey: newAzmTabId() } }).then(() => { setNotice(t(`dash.done.${action}`, { id })); refresh(); }).catch(e => { setError(e); throw e; }).finally(() => setBusyId(null)); };
  const stop = fn => e => { e.stopPropagation(); fn(); };
  const titleOf = r => { if (r.kind === 'base') { const b = layout.nodes.find(n => n.id === r.targetId); return `★ ${b ? nodeName(b, t) : r.targetId}`; } const u = allUnits.find(x => x.id === r.unitId); return u ? unitName(t, u) : r.unitId; };
  const requestCard = r => { const u=allUnits.find(x=>x.id===r.unitId), pr=r.priority||'normal', route = r.status==='pending' ? routeForRequest(layout, r) : null, check = canDecideReq(r) && route && r.kind !== 'base' ? stockCheck(r, route, depots, u) : null;
    const shown = r.status === 'pending' ? reqItems(r) : (r.dispatched?.length ? r.dispatched : r.approvedItems?.length ? r.approvedItems : reqItems(r));
    return <article data-request-id={r.id} data-status={r.status} className={`request priority-${pr} ${r.kind === 'base' ? 'base-req' : ''}`} key={r.id} onClick={() => onOpenRequest(r.id)} title={t('req.open')}>
      <header><b>{titleOf(r)}</b><code>{r.id}</code></header>
      <div className="req-tags">{r.kind === 'base' && <span className="tag hq">◆ {t('req.kind.base')}</span>}<span className={`tag ${pr}`}>{priorityIcon[pr]} {t(`priority.${pr}`)}</span>{(r.kind !== 'base' || r.route) && <span className="tag">{t(`mode.${r.mode}`)}</span>}{(r.comments||[]).length>0&&<span className="tag">💬 {r.comments.length}</span>}</div>
      <div className="req-items">{shown.map(i => <span key={i.resource}>{resIcon(i.resource)} <bdi>{resName(t, i.resource)}</bdi> <b><bdi dir="ltr">{i.qty != null ? `+${fmtQty(i.qty)}` : `+${i.amount}%`}</bdi></b><small><bdi dir="ltr">{i.qty != null ? resUnitName(t, i.resource) : `${i.level}%`}</bdi></small></span>)}</div>
      {r.notes && <p dir="auto" className="req-snippet">“{r.notes}”</p>}
      {r.by&&r.by!=='system'&&<small>{t('dash.by', { by: r.by })}</small>}
      <RequestStage r={r} me={me} simClock={simClock} paused={simPaused}/>
      {r.status==='pending' && r.kind!=='base' && canDecideReq(r) ? <><RouteInfo route={route} mode={r.mode}/><StockCheck check={check}/></> : null}
      {isAdmin && r.status === 'assigned' && basesWithoutManager.includes(r.baseId) && <small className="stage-legacy">⚠ {t('exec.noManager')}</small>}
      {canDecideReq(r) && r.status==='pending' ? <div><button className="approve" onClick={stop(()=>onOpenRequest(r.id))}>{r.kind === 'base' ? t('supply.fulfill') : t('dash.chooseSource')}</button>{r.kind!=='base'&&r.mode!=='heli'&&<button className="air-btn" disabled={busyId===r.id} onClick={stop(()=>act(r.id,'air').catch(()=>{}))}>{t('dash.heli')}</button>}<button className="reject" onClick={stop(()=>onOpenRequest(r.id))}>{t('dash.reject')}</button></div>
      : r.status === 'assigned' && canExecute(me, r) ? <div><button className="approve execute-btn" disabled={busyId===r.id} onClick={stop(()=>act(r.id,'execute').catch(()=>{}))}>{t('exec.start')}</button></div>
      : <span className={`req-status ${r.status}`}>{t(`req.status.${r.status}`)}</span>}
    </article>; };
  const mine = isBaseManager ? assigned.filter(r => canExecute(me, r)) : [];
  return <div className="dashboard-grid">
    <aside className="units-column"><div className="section-heading"><b>{t('dash.units')}</b><small>{t('dash.live')}</small></div>{units.length ? units.map(u=><UnitCard key={u.id} unit={u}/>) : <p className="empty">{t('dash.noUnitsScope')}</p>}</aside>
    <TacticalMap units={allUnits} convoys={approved} requests={requests} depots={depots} inventory={inventory} hierarchy={hierarchy} onRequest={id => setCreating({ unitId: id })} serverLayout={serverLayout} simClock={simClock} onSaveLayout={onSaveLayout} onChanged={refresh} onOpenRequest={onOpenRequest} canEdit={isAdmin} myUnitId={me.role === 'user' ? me.unitId : null} mapOthers={mapOthers}/>
    <aside className="intel-column">
      {units.length > 0 && <button className="cta-request" onClick={() => setCreating({})}><span>＋</span><div><b>{t('dash.cta.title')}</b><small>{t('dash.cta.sub')}</small></div></button>}
      {me.role !== 'user' && <button className="cta-request hq" onClick={() => setBaseReq(true)}><span>◆</span><div><b>{t('breq.cta')}</b><small>{t('breq.ctaSub')}</small></div></button>}
      {baseShortages.length > 0 && <section className="base-stock-alerts"><div className="section-heading"><b>{t('dash.baseShortages')}</b><span>{baseShortages.length}</span></div>
        <div className="base-stock-list">{baseShortages.slice(0,5).map(x=><div key={`${x.base.id}:${x.resource}`}><span><b>{nodeName(x.base,t)}</b><small>{resName(t,x.resource)}</small></span><strong dir="ltr">{Math.round(x.qty/x.cap*100)}%</strong></div>)}</div>
        {baseShortages.length>5&&<small className="ni-muted">{t('dash.moreShortages',{n:baseShortages.length-5})}</small>}
      </section>}
      {error && <span className="form-error">{errText(t, error)}{errDetail(t, error)}{error.failures?.length > 0 && <ExecutionFailures failures={error.failures}/>}</span>}
      {notice && <span className="form-notice">{notice}</span>}
      {isBaseManager && <section className="exec-box"><div className="section-heading"><b>{t('exec.myTasks')}</b><span>{mine.length}</span></div><p className="ni-muted">{t('exec.myTasksHint')}</p>
        <div className="request-list exec-list">{mine.length ? mine.map(requestCard) : <p className="empty">{t('exec.none')}</p>}</div></section>}
      <section><div className="section-heading"><b>{decide ? t('dash.pending') : t('dash.myRequests')}</b><span>{decide ? pending.length : requests.length}</span></div>
        <div className="request-list">{decide
          ? (pending.length?pending.map(requestCard):<p className="empty">{t('dash.noPending')}</p>)
          : (requests.length?[...requests].reverse().filter(r=>!mine.includes(r)).map(requestCard):<p className="empty">{t('dash.noMyRequests')}</p>)}</div></section>
      {isAdmin && <section><div className="section-heading"><b>{t('exec.awaiting')}</b><span>{assigned.length}</span></div><p className="ni-muted">{t('exec.awaitingHint')}</p>
        <div className="request-list assigned-list">{assigned.length ? assigned.map(requestCard) : <p className="empty">{t('exec.noneAdmin')}</p>}</div></section>}
      {isAdmin && stalled.length > 0 && <section className="stalled-box"><div className="section-heading"><b>⚠ {t('dash.stalled')}</b><span>{stalled.length}</span></div><p className="ni-muted">{t('dash.stalledHint')}</p>
        {stalled.map(r => <div key={r.id} className="stalled-row"><span><code>{r.id}</code> {titleOf(r)} · {reqItems(r).map(i => resName(t, i.resource)).join(' + ')}</span><button onClick={() => act(r.id, 'reopen').catch(() => {})}>{t('dash.reopen')}</button></div>)}</section>}
      <section><div className="section-heading"><b>{t('dash.convoys')}</b><span>{approved.length}</span></div>{approved.length?approved.map(c=><ConvoyCard key={c.id} c={c} allUnits={allUnits} layout={layout} simClock={simClock} paused={simPaused}/>):<p className="empty">{t('dash.noConvoys')}</p>}</section>
      <AlertsPanel me={me} alerts={alerts} units={allUnits} requests={requests} onRequest={a => setCreating({ unitId: a.unitId, resource: a.resource, priority: a.level === 'warning' ? 'normal' : a.level === 'critical' ? 'urgent' : 'emergency' })}/>

    </aside>
    {creating && <RequestModal me={me} units={units} layout={layout} prefill={creating} onClose={() => setCreating(null)} onCreated={r => { setNotice(t('req.created', { id: r.id })); refresh(); }}/>}
    {baseReq && <BaseRequestModal me={me} layout={layout} depots={depots} inventory={inventory} onClose={() => setBaseReq(false)} onCreated={r => { setNotice(t('req.created', { id: r.id })); refresh(); }}/>}
  </div>;
}

// أسباب تعذر المباشرة لكل مورد: الصنف، المطلوب، والحد المتأثر (المتاح بالمصدر أو المساحة في الوحدة)
function ExecutionFailures({ failures }) {
  const { t } = useLang();
  return <ul className="exec-failures">{failures.map((f, i) => <li key={i}>{f.resource ? <b>{resName(t, f.resource)}: </b> : null}{t(`err.${f.error}`)}{f.required != null ? ` — ${t('exec.required', { n: fmtQty(f.required), unit: f.resource ? resUnitName(t, f.resource) : '' })}` : ''}{f.available != null ? ` · ${t('exec.available', { n: fmtQty(f.available) })}` : ''}{f.error === 'over_capacity' && f.room != null ? ` · ${t('exec.room', { n: fmtQty(f.room), cap: fmtQty(f.capacity), cur: fmtQty(f.current), tr: fmtQty(f.inTransit || 0) })}` : ''}</li>)}</ul>;
}
