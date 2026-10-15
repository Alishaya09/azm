// صفحة سجل العمليات: السجل المختصر للأحداث + سجل حركات المخزون الدائم (صفحات، مفلتر حسب النطاق في الخادم)
function Logs({me,logs,layout}) {
  const { t } = useLang();
  const [search,setSearch] = useState(''), [type,setType] = useState(''), [resource,setResource] = useState(''), [page,setPage] = useState(0), [data,setData] = useState(null), [error,setError] = useState(null);
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[entityId,setEntityId]=useState(''),[actor,setActor]=useState('');
  // تحديد عمليات للتقرير الذكي (يبقى عبر الصفحات؛ حد الخادم 100) وطلب تقرير سريع لعملية واحدة
  const [selected,setSelected]=useState([]),[quick,setQuick]=useState(null),[opened,setOpened]=useState(null);
  const toggle=id=>setSelected(s=>s.includes(id)?s.filter(x=>x!==id):s.length>=100?s:[...s,id]);
  const pageIds=(data?.entries||[]).filter(e=>e.type!=='chats').map(e=>e.id),allOnPage=pageIds.length>0&&pageIds.every(id=>selected.includes(id));
  const togglePage=()=>setSelected(s=>allOnPage?s.filter(id=>!pageIds.includes(id)):[...new Set([...s,...pageIds])].slice(0,100));
  useEffect(() => { let active = true; const q = new URLSearchParams({ search, type, resource, entityId, actor, types: LOG_PAGE_TYPES.join(','), offset: page * 25, limit: 25, ...(from?{from:new Date(`${from}T00:00:00`).getTime()}:{}), ...(to?{to:new Date(`${to}T23:59:59.999`).getTime()}:{}) }); api(`/api/audit?${q}`).then(d => { if(active) { setData(d); setError(null); } }).catch(e => { if(active) setError(e); }); return () => { active = false; }; }, [search,type,resource,page,from,to,entityId,actor,logs]);
  const updateFilter=setter=>e=>{setter(e.target.value);setPage(0);};
  const auditEntity=e=>{const n=layout.nodes.find(n=>n.id===e.entityId||n.unitId&&n.unitId===e.unitId);return n?nodeName(n,t):e.entityId||e.unitId||e.baseId||'—';};
  const auditQuantities=e=>e.resource?[{resource:e.resource,qty:e.qty}]:(e.changes?.after?.items||[]);
  const types = LOG_PAGE_TYPES;
  return <div className="page-pad"><div className="page-heading"><h2>{t('logs.title')}</h2><small>{t('logs.sub')}</small></div>
    <p className="ni-muted">{t('audit.storageHint')}</p><div className="audit-filters"><label>{t('audit.fromDate')}<input type="date" value={from} onChange={updateFilter(setFrom)}/></label><label>{t('audit.toDate')}<input type="date" value={to} onChange={updateFilter(setTo)}/></label><label>{t('audit.entity')}<select value={entityId} onChange={updateFilter(setEntityId)}><option value="">{t('common.all')}</option>{layout.nodes.filter(n=>me.role!=='user'||n.unitId===me.unitId).map(n=><option key={n.id} value={n.id}>{nodeName(n,t)}</option>)}</select></label><label>{t('audit.actor')}<input value={actor} maxLength="32" onChange={updateFilter(setActor)}/></label></div>
    <OpsReportPanel me={me} layout={layout} filters={{from,to,entityId,type,resource,actor,search}} selected={selected} onClearSelection={()=>setSelected([])} onPreset={(f,tt)=>{setFrom(f);setTo(tt);setPage(0);}} quick={quick}/>
    <div className="filter-chips"><input aria-label={t('audit.search')} placeholder={t('audit.search')} value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/><select aria-label={t('mv.type')} value={type} onChange={e=>{setType(e.target.value);setPage(0);}}><option value="">{t('common.all')}</option>{types.map(x=><option key={x} value={x}>{t(`${MOVE_TYPES.includes(x)?'mv.type':'audit'}.${x}`)}</option>)}</select><select aria-label={t('routes.type')} value={resource} onChange={e=>{setResource(e.target.value);setPage(0);}}><option value="">{t('common.all')}</option>{resources.map(r=><option key={r.key} value={r.key}>{resName(t,r.key)}</option>)}</select></div>
    {error&&<p className="form-error">{errText(t,error)}</p>}
    {/* كل عملية صف مختصر بتصميم صفحة الحسابات (المهم فقط)، والضغط عليه يفتح نافذة بكل التفاصيل وزر إنشاء تقرير */}
    {data&&<div className="users-table-wrap ops-table-wrap"><table className="users-table ops-table"><thead><tr><th>{t('logs.col.op')}</th><th>{t('logs.col.parties')}</th><th>{t('mv.by')}</th><th>{t('logs.col.status')}</th><th>{t('mv.time')}</th><th className="ops-select-all"><label title={t('ops.selectPage')}><input type="checkbox" aria-label={t('ops.selectPage')} checked={allOnPage} onChange={togglePage}/>{t('logs.selectAll')}</label></th></tr></thead>
      <tbody>{data.entries.length ? data.entries.map(e=><OpsLogRow key={e.id} e={e} layout={layout} entity={auditEntity(e)} selected={selected.includes(e.id)} onToggle={()=>toggle(e.id)} onOpen={()=>setOpened(e)}/>) : <tr><td colSpan="6" className="empty">{t('mv.none')}</td></tr>}</tbody></table></div>}
    {opened&&<OpsDetails e={opened} layout={layout} entity={auditEntity(opened)} quantities={auditQuantities(opened)} onClose={()=>setOpened(null)} onReport={()=>{setQuick({ids:[opened.id]});setOpened(null);setTimeout(()=>document.querySelector('.ops-report')?.scrollIntoView({behavior:'smooth',block:'start'}),50);}}/>}
    {data&&<div className="pager"><button disabled={!page} onClick={()=>setPage(p=>p-1)}>‹</button><span>{t('mv.page',{p:page+1,n:Math.max(1,Math.ceil(data.total/25)),total:data.total})}</span><button disabled={(page+1)*25>=data.total} onClick={()=>setPage(p=>p+1)}>›</button></div>}
  </div>;
}

// الصفحة تعرض الإجراءات على الطلبات والإرسال والتسليم فقط؛ بقية العمليات (المحاكاة، الحسابات، المحادثات…) تعمل وتُسجَّل ولا تُعرض هنا
const LOG_PAGE_TYPES = ['requests', 'dispatch', 'delivery'];
const MOVE_TYPES = ['external_add', 'transfer', 'dispatch', 'delivery', 'return', 'consumption', 'retirement', 'maintenance', 'maintenance_due'];
// أيقونة ولون كل نوع عملية في السجل؛ الطلبات تأخذ لون حالتها (معلق/معتمد/بالطريق/مسلّم/مرفوض)
const OPS_ICON = { external_add: '◆', transfer: '⇄', dispatch: '🚛', delivery: '📦', return: '↩', consumption: '🔥', retirement: '🗑', maintenance: '🛠', maintenance_due: '⏰', requests: '📋', entities: '⬢', catalog: '🧾', simulation: '⏱', layout: '🗺', users: '👤', chats: '💬' };
const opsTone = e => e.type === 'requests' ? ({ pending: 'warn', assigned: 'info', approved: 'info', delivered: 'good', rejected: 'bad' }[e.action] || 'neutral')
  : ({ external_add: 'supply', transfer: 'info', dispatch: 'info', delivery: 'good', return: 'warn', consumption: 'muted', retirement: 'bad', maintenance: 'neutral', maintenance_due: 'warn' }[e.type] || 'neutral');
// نصوص مشتركة بين صف العملية ونافذة تفاصيلها
const opsText = (e, layout, t) => {
  const typeLabel = t(`${MOVE_TYPES.includes(e.type) ? 'mv.type' : 'audit'}.${e.type}`);
  const actionLabel = e.action ? t(`audit.action.${e.action}`) : null;
  const parties = e.resource ? [e.from || e.transit?.from, e.to || e.transit?.to].map(p => p && !p.restricted ? partyName(p, layout, t) : null) : null;
  const byName = e.by === 'simulation' ? t('mv.simulation') : e.by === 'system' ? t('req.system') : e.by;
  return { typeLabel, actionLabel, parties, byName, ref: e.requestId || e.reference || e.opId || e.id, roleKnown: ['admin', 'base_manager', 'user'].includes(e.role),
    from: parties ? parties[0] || (e.type === 'external_add' ? t('mv.external') : '—') : null, to: parties ? parties[1] || (e.type === 'consumption' ? t('mv.consumed') : '—') : null };
};
// صف مختصر: العملية ومرجعها، الجهة أو المسار، المنفّذ، الحالة، الوقت، والتحديد. الضغط على الصف يفتح التفاصيل.
function OpsLogRow({ e, layout, entity, selected, onToggle, onOpen }) {
  const { t } = useLang();
  const x = opsText(e, layout, t);
  const open = ev => { if (ev.target.closest('.op-check')) return; onOpen(); };
  return <tr data-op-id={e.id} className={`ops-row ${selected ? 'ops-selected' : ''}`} onClick={open} onKeyDown={ev => (ev.key === 'Enter' || ev.key === ' ') && !ev.target.closest('.op-check') && (ev.preventDefault(), onOpen())} tabIndex={0} role="button" title={t('logs.openDetails')}>
    <td><div className="member"><span className={`avatar op-icon ${opsTone(e)}`} aria-hidden="true">{OPS_ICON[e.type] || '•'}</span><div><b>{x.typeLabel}</b><small><code dir="ltr">{x.ref}</code></small></div></div></td>
    <td>{x.parties ? <div className="op-route"><span>{x.from}</span><i>→</i><span>{x.to}</span></div> : <span className="op-entity">{entity}</span>}</td>
    <td><b className="op-by">{x.byName}</b>{x.roleKnown && <span className={`role-badge ${e.role}`}>{t(`role.${e.role}`)}</span>}</td>
    <td><span className={`status-badge op-badge ${opsTone(e)}`}>{x.actionLabel || x.typeLabel}</span></td>
    <td className="op-time">{fmtDateTime(e.at)}</td>
    <td className="row-actions">{e.type !== 'chats' && <label className="op-check" title={t('ops.selectRow')}><input type="checkbox" aria-label={t('ops.selectRow')} checked={selected} onChange={onToggle}/></label>}<span className="op-open" aria-hidden="true">›</span></td>
  </tr>;
}
// نافذة تفاصيل العملية: كل البيانات المسموحة لهذا الحساب، وزر إنشاء تقرير ذكي لها
function OpsDetails({ e, layout, entity, quantities, onClose, onReport }) {
  const { t } = useLang();
  const x = opsText(e, layout, t);
  const reason = e.reason || e.changes?.after?.reason;
  const executed = i => e.changes?.after?.approvedItems?.find(a => a.resource === i.resource)?.qty;
  const balances = [e.from, e.to].filter(p => p?.before != null && !p.restricted);
  const refs = [['mv.ref', e.requestId], ['logs.opId', e.opId], [e.resource ? 'mv.id' : 'logs.recordId', e.id]].filter(([, v]) => v);
  return <Modal title={<span className="op-modal-title"><span className={`avatar op-icon ${opsTone(e)}`}>{OPS_ICON[e.type] || '•'}</span>{x.typeLabel}</span>} onClose={onClose} wide>
    <div className="op-details">
      <div className="op-detail-head"><span className={`status-badge op-badge ${opsTone(e)}`}>{x.actionLabel || x.typeLabel}</span><span className="op-time">{fmtDateTime(e.at)}</span></div>
      <dl className="op-facts">
        <dt>{t('mv.by')}</dt><dd><b>{x.byName}</b> {x.roleKnown && <span className={`role-badge ${e.role}`}>{t(`role.${e.role}`)}</span>}</dd>
        {x.parties ? <><dt>{t('logs.col.parties')}</dt><dd><div className="op-route"><span>{x.from}</span><i>→</i><span>{x.to}</span></div></dd></> : <><dt>{t('audit.entity')}</dt><dd>{entity}</dd></>}
        {refs.map(([k, v]) => <React.Fragment key={k}><dt>{t(k)}</dt><dd><code dir="ltr">{v}</code></dd></React.Fragment>)}
        {e.crossBase && <><dt>{t('req.crossBase')}</dt><dd>✓</dd></>}
        {reason && <><dt>{t('audit.reason')}</dt><dd dir="auto">{reason}</dd></>}
      </dl>
      {quantities.length > 0 && <><h4>{t('mv.qty')}</h4><table className="op-detail-table"><thead><tr><th>{t('routes.type')}</th><th>{t('logs.qty')}</th>{e.changes?.after?.approvedItems && <th>{t('logs.executed')}</th>}<th>{t('logs.measure')}</th></tr></thead>
        <tbody>{quantities.map(i => <tr key={i.resource}><td>{resIcon(i.resource)} {resName(t, i.resource)}</td><td dir="ltr"><b>{fmtQty(i.qty)}</b></td>{e.changes?.after?.approvedItems && <td dir="ltr"><b>{executed(i) != null ? fmtQty(executed(i)) : '—'}</b></td>}<td>{resUnitName(t, i.resource)}</td></tr>)}</tbody></table></>}
      {balances.length > 0 && <><h4>{t('audit.balance')}</h4><table className="op-detail-table"><thead><tr><th>{t('audit.entity')}</th><th>{t('logs.before')}</th><th>{t('logs.after')}</th><th>{t('logs.change')}</th></tr></thead>
        <tbody>{balances.map((p, i) => <tr key={i}><td>{partyName(p, layout, t)}</td><td dir="ltr">{fmtQty(p.before)}</td><td dir="ltr"><b>{fmtQty(p.after)}</b></td><td dir="ltr" className={p.after >= p.before ? 'op-up' : 'op-down'}>{p.after >= p.before ? '+' : '−'}{fmtQty(Math.abs(p.after - p.before))}</td></tr>)}</tbody></table></>}
    </div>
    {e.type !== 'chats' && <footer className="op-detail-actions"><button type="button" className="reject" onClick={onClose}>{t('common.close')}</button><button type="button" className="approve" onClick={onReport}>📈 {t('logs.createReport')}</button></footer>}
  </Modal>;
}
const PAGE_SIZE = 25;
// اسم طرف الحركة: من الخريطة الحالية، وإلا من النسخة المحفوظة مع الحركة (كيان مؤرشف أو خارج النطاق)
const partyName = (p, layout, t) => { if (!p) return '—'; if (p.type === 'virtual') return t('supply.virtual'); const n = layout.nodes.find(x => x.id === p.entityId); if (n) return nodeName(n, t); return p.label || (p.labelKey ? t(p.labelKey) : p.unitId || p.entityId || t('req.restrictedSource')); };
function Movements({ layout }) {
  const { t } = useLang();
  const [type, setType] = useState(''), [resource, setResource] = useState(''), [page, setPage] = useState(0), [data, setData] = useState(null), [error, setError] = useState(null);
  useEffect(() => { const q = new URLSearchParams({ offset: page * PAGE_SIZE, limit: PAGE_SIZE, ...(type ? { type } : {}), ...(resource ? { resource } : {}) }); api(`/api/movements?${q}`).then(setData).catch(setError); }, [type, resource, page]);
  const bal = p => p && !p.restricted && p.before != null ? `${fmtQty(p.before)} → ${fmtQty(p.after)}` : '';
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  return <section className="movements">
    <div className="page-heading"><h2>{t('mv.title')}</h2><small>{t('mv.sub')}</small></div>
    <div className="filter-chips"><button className={!type ? 'active' : ''} onClick={() => { setType(''); setPage(0); }}>{t('common.all')}</button>{MOVE_TYPES.map(x => <button key={x} className={type === x ? 'active' : ''} onClick={() => { setType(x); setPage(0); }}>{t(`mv.type.${x}`)}</button>)}
      <select value={resource} onChange={e => { setResource(e.target.value); setPage(0); }}><option value="">{t('common.all')}</option>{resources.map(r => <option key={r.key} value={r.key}>{r.icon} {resName(t, r.key)}</option>)}</select></div>
    {error && <p className="form-error">{errText(t, error)}</p>}
    {data && <div className="srep-scroll"><table className="srep-table mv-table"><thead><tr><th>{t('mv.id')}</th><th>{t('mv.time')}</th><th>{t('mv.type')}</th><th>{t('routes.type')}</th><th>{t('mv.qty')}</th><th>{t('db.from')}</th><th>{t('db.to')}</th><th>{t('mv.by')}</th><th>{t('mv.ref')}</th></tr></thead>
      <tbody>{data.movements.length ? data.movements.map(m => <tr key={m.id} className={m.type === 'consumption' ? 'sim' : ''}>
        <td><code>{m.id.startsWith('OPEN-') ? t('mv.open') : m.id}</code></td>
        <td>{m.periodStart ? `${fmtDateTime(m.periodStart)} → ` : ''}{fmtDateTime(m.at)}<small>{t('mv.simH', { h: (m.simHours || 0).toFixed(1) })}</small></td>
        <td><span className={`mv-badge ${m.type}`}>{t(`mv.type.${m.type}`)}</span>{m.crossBase && <small className="stock-short">{t('req.crossBase')}</small>}</td>
        <td>{resName(t, m.resource)}</td>
        <td dir="ltr"><b>{fmtQty(m.qty)}</b> <small>{resUnitName(t, m.resource)}</small></td>
        <td>{m.from ? partyName(m.from, layout, t) : m.type === 'delivery' || m.type === 'return' ? `🚛 ${partyName(m.transit?.from || m.transit?.to, layout, t)}` : m.type === 'external_add' ? t('mv.external') : '—'}<small dir="ltr">{bal(m.from)}</small></td>
        <td>{m.to ? partyName(m.to, layout, t) : m.type === 'dispatch' ? `🚛 ${partyName(m.transit?.to, layout, t)}` : m.type === 'consumption' ? t('mv.consumed') : '—'}<small dir="ltr">{bal(m.to)}</small></td>
        <td>{m.by === 'simulation' ? t('mv.simulation') : m.by === 'system' ? t('req.system') : m.by}</td>
        <td dir="auto">{m.requestId || m.opId || ''}{m.reason && <small>{m.reason}</small>}</td>
      </tr>) : <tr><td colSpan="9" className="empty">{t('mv.none')}</td></tr>}</tbody></table></div>}
    {data && <div className="pager"><button disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹</button><span>{t('mv.page', { p: page + 1, n: pages, total: data.total })}</span><button disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>›</button></div>}
  </section>;
}
