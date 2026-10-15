// بطاقة بيانات النقطة
// بطاقة بيانات النقطة: تظهر عند الضغط على قاعدة أو مركز إمداد أو وحدة في الخريطة
const nodeTypeIcon = { hq: '◆', main: '★', fsb: '▪', unit: '⬢' };
function NodeInfo({ node, layout, units, convoys, requests, myUnitId, simClock, onClose, onRequest, onOpenRequest = null, depots = {}, inventory = {}, hierarchy = {}, canEdit = false, onRelationChanged = null }) {
  const { t } = useLang();
  const [refilling, setRefilling] = useState(false);
  const byId = Object.fromEntries(layout.nodes.map(n => [n.id, n]));
  const links = layout.links.filter(l => (l.from === node.id || l.to === node.id) && byId[l.from] && byId[l.to])
    .map(l => ({ l, other: byId[l.from === node.id ? l.to : l.from], km: linkKm(l, byId) }));
  const convoyRow = c => { const p = convoyProgress(c, simClock()); return <li key={c.id}><span>{c.mode === 'heli' ? '✈️' : '🚛'} {c.id}</span><b>{Math.round(p * 100)}%</b></li>; };
  const isUnit = node.type === 'unit', u = isUnit && units.find(x => x.id === node.unitId);
  const hidden = isUnit && myUnitId && node.unitId !== myUnitId;
  let body;
  if (isUnit && u && !hidden) {
    const s = statusFor(u), lines = ['truck', 'heli'].map(m => [m, planRoute(layout, u.id, m)]);
    const incoming = convoys.filter(c => c.unitId === u.id), pending = requests.filter(r => r.unitId === u.id && r.status === 'pending');
    body = <>
      <div className="ni-stats"><span className={`chip ${s}`}>{t(`state.${s}`)}</span><span><b>{mcr(u)}%</b><small>MCR</small></span><span><b>{dos(u)}</b><small>DOS</small></span><span><b>{t(`optempo.${u.optempo}`)}</b><small>OPTEMPO</small></span></div>
      <small className="ni-muted">{t('info.personnel')}: {u.people} {t('unit.people')} · {u.vehicles} {t('unit.vehicles')}</small>
      <div className="ni-meters">{unitVisibleResources(u).map(r => <Meter key={r.key} label={`${r.icon} ${resName(t, r.key)}${r.active ? '' : ` (${t('cat.off')})`}`} value={u[r.key]}/>)}</div>
      <h5>{t('info.supply')}</h5>
      <ul className="ni-list">{lines.map(([m, r]) => <li key={m}><span>{m === 'heli' ? '✈️' : '🚛'} {r ? nodeName(r.from, t) : t('req.noRouteShort')}</span>{r && <b><bdi dir="ltr">{Math.round(r.km)} {t('common.km')}</bdi> · {fmtHours(r.hours)}</b>}</li>)}</ul>
      <h5>{t('info.incoming')} <em>{incoming.length}</em></h5>
      {incoming.length ? <ul className="ni-list">{incoming.map(convoyRow)}</ul> : <small className="ni-muted">{t('info.none')}</small>}
      <h5>{t('info.pending')} <em>{pending.length}</em></h5>
      {!!pending.length && <ul className="ni-list map-requests">{pending.map(r=><li key={r.id}><button type="button" data-request-id={r.id} onClick={()=>onOpenRequest?.(r.id)}>{r.id} · {t(`priority.${r.priority||'normal'}`)}</button></li>)}</ul>}
      {onRequest && <button className="ni-action" onClick={() => onRequest(u.id)}>{t('info.request')}</button>}
    </>;
  } else if (isUnit) {
    body = <p className="ni-muted">{t('info.restricted')}</p>;
  } else {
    const served = units.filter(x => ['truck', 'heli'].some(m => planRoute(layout, x.id, m)?.from.id === node.id));
    const outgoing = convoys.filter(c => c.route?.fromId === node.id);
    body = <>
      <h5>{t('info.served')} <em>{served.length}</em></h5>
      {served.length ? <ul className="ni-list">{served.map(x => <li key={x.id}><span>⬢ {unitName(t, x)}</span><b>{x.id}</b></li>)}</ul> : <small className="ni-muted">{t('info.noServed')}</small>}
      <h5>{t('info.outgoing')} <em>{outgoing.length}</em></h5>
      {outgoing.length ? <ul className="ni-list">{outgoing.map(convoyRow)}</ul> : <small className="ni-muted">{t('info.none')}</small>}
    </>;
  }
  return <div className="node-info" onClick={e => e.stopPropagation()}>
    <header>{node.type === 'hq' ? <span className="ni-icon hq" dangerouslySetInnerHTML={{ __html: MAIN_BASE_EMBLEM }} /> : <span className={`ni-icon ${node.type}`}>{nodeTypeIcon[node.type]}</span>}<div><b>{nodeName(node, t)}</b><small>{t(`info.type.${node.type}`)} · {node.code || node.unitId || node.id}</small></div><button onClick={onClose} aria-label={t('common.close')}>✕</button></header>
    {body}
    {!isUnit&&onOpenRequest&&<><h5>{t('info.pending')}</h5><ul className="ni-list map-requests">{requests.filter(r=>r.status==='pending'&&(r.baseId===node.id||r.targetId===node.id)).map(r=><li key={r.id}><button type="button" data-request-id={r.id} onClick={()=>onOpenRequest(r.id)}>{r.id} · {t(`priority.${r.priority||'normal'}`)}</button></li>)}</ul></>}
    {onOpenRequest&&<><h5>{t('req.history')}</h5><ul className="ni-list map-request-history">{requests.filter(r=>isUnit?r.unitId===node.unitId:r.baseId===node.id||r.route?.fromId===node.id).filter(r=>r.status!=='pending').slice(-8).reverse().map(r=><li key={r.id}><button type="button" data-request-id={r.id} onClick={()=>onOpenRequest(r.id)}>{r.id} · {t(`req.status.${r.status}`)}</button></li>)}</ul></>}
    {node.type === 'hq' && <p className="ni-muted hq-note">◆ {t('hq.unlimitedNote')}</p>}
    <RelationInfo node={node} layout={layout} canEdit={canEdit} onChanged={onRelationChanged}/>
    {depots[node.id] && <><h5>{t('db.depot')}</h5><DepotRows stock={depots[node.id]} capacity={inventory[node.id]?.capacity || depotCapOf(node.type)} inTransit={inventory[node.id]?.inTransit}/></>}
    {node.type === 'fsb' && depots[node.id] && depots[node.baseId] && <button className="ni-action" onClick={() => setRefilling(true)}>{t('db.refillCenter')}</button>}
    {refilling && ReactDOM.createPortal(<DepotAction layout={layout} depots={depots} inventory={inventory} preset={{from:node.baseId,to:node.id,refill:true}} onClose={() => setRefilling(false)} onDone={onRelationChanged || (() => {})}/>, document.body)}
    <h5>{t('info.links')} <em>{links.length}</em></h5>
    {links.length ? <ul className="ni-list">{links.map(({ l, other, km }) => <li key={l.id}><span>{l.kind === 'air' ? '✈️' : '🛣️'} {nodeName(other, t)}</span><b><bdi dir="ltr">{Math.round(km)} {t('common.km')}</bdi></b></li>)}</ul> : <small className="ni-muted">{t('info.noLinks')}</small>}
    <small className="ni-coords">{t('info.coords')}: <bdi dir="ltr">{node.pos[0].toFixed(3)}°, {node.pos[1].toFixed(3)}°</bdi></small>
  </div>;
}
