// تفاصيل الطلب والتعليقات والقرارات
// تفاصيل الطلب الكاملة + المرحلة الحالية والخطوة التالية + سجل الحالة + التعليقات.
// القائد وحده يقرر: المصدر (مستودع فعلي) + كميات التنفيذ + وسيلة النقل → «معتمد — بانتظار مباشرة مسؤول القاعدة» بلا خصم ولا شحنة.
// مسؤول قاعدة الوحدة يستلم الأمر ويبدأ التنفيذ؛ الخادم يعيد الفحص ويخصم مرة واحدة وتنطلق الشحنة.
// الوحدة تبقى تابعة لقاعدتها. المسار يُحسب من المصدر المختار فعلاً (ما يُستبدل بمصدر أقرب).
// احتياج القاعدة: القائد يزوّد مستودعها من المورد الافتراضي دون شحنة جغرافية جديدة.
const nodeTitle0 = (layout, t, id) => { const n = layout.nodes.find(x => x.id === id); return n ? nodeName(n, t) : (id || '—'); };
function RequestDetails({ me, id, requests, units, layout, depots, inventory = {}, simClock = null, simPaused = false, basesWithoutManager = [], onClose, onApprove, refresh }) {
  const { t } = useLang();
  const r = requests.find(x => x.id === id);
  const [comment, setComment] = useState(''), [rejecting, setRejecting] = useState(false), [reason, setReason] = useState(''), [error, setError] = useState(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState(null);
  const [fromId, setFromId] = useState(null), [crossReason, setCrossReason] = useState(''), [mode, setMode] = useState(null);
  const [executionQty, setExecutionQty] = useState({});
  // مفتاح عملية لكل نافذة قرار: الضغط المكرر أو انقطاع الرد لا يكرر الإجراء على الخادم
  const opKeys = useRef({});
  const opKey = action => opKeys.current[action] ||= newAzmTabId();
  if (!r) return null;
  const isAdmin = me.role === 'admin', isBase = r.kind === 'base', decide = isBase ? isAdmin : canDecide(me) && (isAdmin || me.baseId === r.baseId), pending = r.status === 'pending', assigned = r.status === 'assigned';
  const executor = assigned && canExecute(me, r);
  const decideMode = mode || r.mode;
  const opts = decide && pending && !isBase ? sourceOptions(layout, r.unitId, isAdmin) : { same: [], other: [] };
  const chosen = isBase ? null : (fromId || defaultSourceId(layout, r.unitId));
  const chosenNode = layout.nodes.find(n => n.id === chosen), crossBase = !isBase && chosenNode?.type !== 'hq' && !!opts.other.find(n => n.id === chosen);
  const limitsFor = key => {
    const unit=units.find(u=>u.id===r.unitId), info=isBase?depotRoomInfo(r.targetId,key,depots,inventory):unit?roomInfo(unit,key):{capacity:0,current:0,inTransit:0,reserved:0,room:0};
    const available=isBase?null:Math.max(0,Math.floor(depots[chosen]?.[key]||0));
    return {...info,available,limit:isBase?info.room:Math.min(info.room,available)};
  };
  const executionItems=reqItems(r).map(i=>{
    const info=limitsFor(i.resource), original=i.qty??Math.round(info.capacity*(i.amount??70)/100), value=i.resource in executionQty?executionQty[i.resource]:original;
    return {resource:i.resource,qty:value===null?info.limit:Number(value),fill:value===null,value,info};
  });
  const invalidExecution=executionItems.some(i=>!Number.isInteger(i.qty)||i.qty<=0||i.qty>i.info.limit);
  const route = pending && !isBase ? planRoute(layout, r.unitId, decideMode, chosen) : null, check = decide && route && !isBase ? stockCheck({...r,items:executionItems}, route, depots, units.find(x => x.id === r.unitId)) : null;
  const destName = isBase ? nodeTitle0(layout, t, r.targetId) : nameById(t, units, r.unitId);
  const run = (p, done = null) => { setBusy(true); setError(null); setNotice(null); return p.then(x => { if (done) setNotice(done); return refresh(); }).catch(e => { setError(e); throw e; }).finally(() => setBusy(false)); };
  const post = e => { e.preventDefault(); if (!comment.trim()) return; run(api(`/api/requests/${r.id}/comments`, { method: 'POST', body: { text: comment.trim() } })).then(() => setComment('')).catch(() => {}); };
  const action = (name, body = {}) => run(api(`/api/requests/${r.id}/${name}`, { method: 'POST', body: { ...body, operationKey: opKey(name) } }), t(`dash.done.${name}`, { id: r.id }));
  const reject = () => action('reject', { reason: reason.trim() }).then(() => setRejecting(false)).catch(() => {});
  const approve = () => { if (busy||invalidExecution) return; setBusy(true); setError(null); onApprove(r, chosen, {items:executionItems.map(i=>i.fill?{resource:i.resource,fill:true}:{resource:i.resource,qty:i.qty}),...(isBase?{}:{mode:decideMode}),...(crossBase ? { crossBase: true, crossBaseReason: crossReason.trim() } : {})}, opKey('approve')).then(() => setNotice(t(isBase ? 'dash.done.supply' : isAdmin && r.priority !== 'emergency' ? 'dash.done.approve' : 'dash.done.dispatch', { id: r.id }))).catch(e => e && setError(e)).finally(() => setBusy(false)); };
  const fromNode = r.route?.fromId && layout.nodes.find(n => n.id === r.route.fromId);
  const nodeTitle = id => { const n = layout.nodes.find(x => x.id === id); return n ? nodeName(n, t) : (id || '—'); };
  const sourceName = r.source ? (r.source.type === 'virtual' ? t('supply.virtual') : r.source.label || (r.source.labelKey ? t(r.source.labelKey) : r.source.restricted ? t('req.restrictedSource') : r.source.entityId)) : null;
  const rows = [
    isBase ? [t('breq.dest'), `★ ${destName}`] : [t('common.unit'), `${r.unitId} — ${destName}`],
    [t('req.base'), r.baseId ? nodeTitle(r.baseId) : '—'],
    [t('req.priority'), `${priorityIcon[r.priority || 'normal']} ${t(`priority.${r.priority || 'normal'}`)}`],
    ...(!isBase || r.route ? [[t('routes.transport'), t(`mode.${r.mode}`)]] : []),
    [t('req.by'), r.by === 'system' ? t('req.system') : r.by],
    [t('req.createdAt'), fmtDateTime(r.createdAt)],
    ...(r.deadline?[[t('req.deadline'),r.deadline]]:[]),
    [t('req.status'), t(`req.status.${r.status}`)],
  ];
  if (r.decidedBy) rows.push([t('req.decidedBy'), `${r.decidedBy} — ${fmtDateTime(r.decidedAt)}`]);
  if (r.executedBy) rows.push([t('req.executedBy'), `${r.executedBy} — ${fmtDateTime(r.executedAt)}`]);
  if (r.route && !r.route.restricted) rows.push([t('req.route'), `${fromNode ? nodeName(fromNode, t) : r.route.fromLabel || '—'} → ${destName} — ${r.route.km} ${t('common.km')} — ${fmtHours(r.eta)}`]);
  if (r.departAt) rows.push([t('req.departedAt'), fmtDateTime(r.departAt)]);
  if (r.deliveredAt) rows.push([t('req.deliveredAt'), fmtDateTime(r.deliveredAt)]);
  if (r.crossBase) rows.push([t('req.crossBase'), r.crossBaseReason || '—']);
  if (r.fromHq) rows.push([t('req.fromHq'), t('req.fromHqHint')]);
  if (r.stalled) rows.push([t('req.stalledShort'), t('dash.stalledHint')]);
  if (sourceName) rows.push([t('req.source'), sourceName]);
  // ثلاثة أرقام منفصلة: ما طلبته الوحدة، ما وافق عليه القائد، ما نُفذ فعلاً — ثم ما استُلم
  const approvedQ = Object.fromEntries((r.approvedItems || []).map(i => [i.resource, i.qty])), sent = Object.fromEntries((r.dispatched || []).map(i => [i.resource, i.qty])), got = Object.fromEntries((r.delivered || []).map(i => [i.resource, i.qty]));
  const cell = (map, key) => <td dir="ltr">{map[key] != null ? fmtQty(map[key]) : '—'}</td>;
  // كل مصدر مع رصيده من كل صنف مطلوب (المركز الرئيسي غير محدود)
  const opt = n => <option key={n.id} value={n.id}>{n.type === 'hq' ? '◆' : n.type === 'main' ? '★' : '▪'} {nodeName(n, t)}{n.type === 'hq' ? ` · ${t('hq.unlimited')}` : depots[n.id] ? ` · ${reqItems(r).map(i => `${resName(t, i.resource)} ${fmtQty(depots[n.id][i.resource] || 0)}`).join(' · ')}` : ''}</option>;
  return <Modal title={t('req.details', { id: r.id })} onClose={onClose}>
    <div className={`req-banner ${r.status}`}>{t(`req.status.${r.status}`)}</div>
    <RequestStage r={r} me={me} simClock={simClock} paused={simPaused}/>
    {isAdmin && assigned && basesWithoutManager.includes(r.baseId) && <p className="form-error">⚠ {t('exec.noManager')}</p>}
    {r.executionBlocked && <div className="exec-blocked"><b>⚠ {t('exec.blockedTitle', { by: r.executionBlocked.by, at: fmtDateTime(r.executionBlocked.at) })}</b><ExecutionFailures failures={r.executionBlocked.failures}/><small>{t(isAdmin ? 'exec.blockedAdmin' : 'exec.blockedOthers')}</small></div>}
    <dl className="req-info">{rows.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd dir="auto">{v}</dd></React.Fragment>)}</dl>
    <h4>{t('req.items')}</h4>
    <table className="items-table qty-trail"><thead><tr><th>{t('routes.type')}</th><th>{t('req.levelAt')}</th><th>{t('req.requestedQty')}</th><th>{t('req.approvedQty')}</th><th>{t('req.sent')}</th><th>{t('req.received')}</th></tr></thead>
      <tbody>{reqItems(r).map(i => <tr key={i.resource}><td>{resources.find(x => x.key === i.resource)?.icon} {resName(t, i.resource)}</td><td>{i.level != null ? `${i.level}%` : '—'}</td><td dir="ltr">{i.qty != null ? `${fmtQty(i.qty)} ${resUnitName(t, i.resource)}` : i.amount != null ? `+${i.amount}%` : '—'}</td>{cell(approvedQ, i.resource)}{cell(sent, i.resource)}{cell(got, i.resource)}</tr>)}</tbody></table>
    {pending && decide && isBase && <p className="route-info">◆ {t('breq.fromHqNote')}</p>}
    {pending && decide && <div className="request-current-limits"><h4>{t('req.executionQty')}</h4><p>{t('req.executionHint')}</p>{executionItems.map(i=><div key={i.resource}><b>{resName(t,i.resource)}</b><StockRoomSummary info={i.info} resource={i.resource}/>{!isBase&&<small>{t('db.available',{n:fmtQty(i.info.available)})}</small>}<small>{t('req.maxRoom',{n:fmtQty(i.info.limit),unit:resUnitName(t,i.resource)})}</small><FillQuantity value={i.value} resource={i.resource} info={i.info} disabled={busy} onChange={value=>setExecutionQty(p=>({...p,[i.resource]:value}))}/></div>)}{invalidExecution&&<small className="form-error">{t('req.qtyInvalid')}</small>}</div>}
    {pending && decide && !isBase && <div className="source-pick">
      <label>{t('req.source')}<select value={chosen || ''} onChange={e => setFromId(e.target.value)}>
        {opts.same.length > 0 && <optgroup label={t('req.sameBase')}>{opts.same.map(opt)}</optgroup>}
        {opts.other.length > 0 && <optgroup label={t('req.otherBase')}>{opts.other.map(opt)}</optgroup>}
      </select></label>
      <div className="segmented decide-mode">{['truck', 'heli'].map(m => <button type="button" key={m} data-mode={m} className={decideMode === m ? 'active' : ''} onClick={() => setMode(m)}>{t(`mode.${m}`)}</button>)}</div>
      {crossBase && <label className="cross-reason">ⓘ {t('req.crossBaseNote')}<input dir="auto" maxLength="300" value={crossReason} onChange={e => setCrossReason(e.target.value)} placeholder={t('req.crossBaseHint')}/></label>}
      <small className="route-info">{t('req.decisionNoDispatch')}</small>
    </div>}
    {pending && !isBase && decide && <><RouteInfo route={route} mode={decideMode}/><StockCheck check={check}/></>}
    {executor && <div className="exec-panel"><h4>{t('exec.panelTitle')}</h4><p>{t('exec.panelHint', { source: sourceName || '—', mode: t(`mode.${r.mode}`) })}</p>
      <ul>{(r.approvedItems || []).map(i => <li key={i.resource}>{resName(t, i.resource)}: <b dir="ltr">{fmtQty(i.qty)}</b> {resUnitName(t, i.resource)}</li>)}</ul></div>}
    <h4>{t('req.notes')}</h4>
    <p dir="auto" className={`req-notes ${r.notes ? '' : 'empty'}`}>{r.notes || t('req.noNotes')}</p>
    {(r.history || []).length > 0 && <><h4>{t('req.history')}</h4><ol className="req-history">{r.history.map((h, i) => <li key={i}><b>{t(`req.status.${h.status}`)}</b> <small>{fmtDateTime(h.at)}{h.priority ? ` · ${t(`priority.${h.priority}`)}` : ''} · {h.by === 'system' ? t('req.system') : h.by}{h.note ? ` · ${historyNote(t, h.note)}` : ''}</small>{h.items?.length>0&&<small>{h.items.map(i=>resName(t,i.resource)+' '+fmtQty(i.qty)+' '+resUnitName(t,i.resource)).join(' / ')}</small>}</li>)}</ol></>}
    <h4>{t('req.comments')} <span>{(r.comments || []).length}</span></h4>
    <div className="comments">{(r.comments || []).length ? r.comments.map((c, i) => <div key={i} className={`comment ${c.role} ${c.kind || ''}`}><header><b>{c.by}</b><small>{t(`role.${c.role}`)} · {fmtDateTime(c.at)}</small></header>{c.kind === 'reject' && <em>{t('req.rejectLabel')}</em>}<p dir="auto">{c.text}</p></div>) : <p className="empty">{t('req.noComments')}</p>}</div>
    <form className="comment-form" onSubmit={post}><textarea dir="auto" rows="2" maxLength="1000" placeholder={t('req.commentPlaceholder')} value={comment} onChange={e => setComment(e.target.value)}/><button type="submit" className="approve" disabled={busy || !comment.trim()}>{t('req.addComment')}</button></form>
    {notice && <span className="form-notice">{notice}</span>}
    {error && <span className="form-error">{errText(t, error)}{errDetail(t, error)}{error.failures?.length > 0 && <ExecutionFailures failures={error.failures}/>}</span>}
    {decide && (pending || (assigned && isAdmin)) && (rejecting
      ? <div className="reject-box"><label>{t('req.rejectReason')}<textarea dir="auto" rows="2" maxLength="1000" value={reason} onChange={e => setReason(e.target.value)}/></label><footer><button type="button" className="reject" onClick={() => setRejecting(false)}>{t('dash.cancel')}</button><button type="button" className="danger" disabled={busy} onClick={reject}>{t('req.confirmReject')}</button></footer></div>
      : <footer className="req-actions">
        {pending && <button type="button" className="approve" disabled={busy || invalidExecution || (!isBase && !route) || !!check?.shortages.length} onClick={approve}>{t(isBase ? 'supply.fulfill' : isAdmin && r.priority !== 'emergency' ? 'dash.approveAssign' : 'dash.approveSend')}</button>}
        {pending && !isBase && r.mode !== 'heli' && <button type="button" className="air-btn" disabled={busy} onClick={() => action('air').catch(() => {})}>{t('dash.heli')}</button>}
        {assigned && <button type="button" className="reopen-btn" disabled={busy} onClick={() => action('reopen').catch(() => {})}>{t('exec.reopen')}</button>}
        <button type="button" className="reject" onClick={() => setRejecting(true)}>{t('dash.reject')}</button></footer>)}
    {executor && <footer className="req-actions"><button type="button" className="approve execute-btn" disabled={busy} onClick={() => action('execute').catch(() => {})}>{t('exec.start')}</button></footer>}
  </Modal>;
}
// ملاحظات سجل الحالة: تغيير الوسيلة لا يعني إرسالاً، وتعذر المباشرة وإعادة المراجعة تظهر بنص واضح
const historyNote = (t, note) => note.split(' · ').map(n => ['mode_heli', 'mode_truck', 'executed', 'execution_blocked', 'decision_reopened', 'reopened_never_dispatched'].includes(n) ? t(`hist.${n}`) : n).join(' · ');
