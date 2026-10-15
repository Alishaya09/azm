// صفحة التقارير: المؤشرات الحية (MCR/DOS) + تقارير الإمداد الفعلية من سجل الحركات في الخادم (مفلترة حسب النطاق)
// أعلى الصفحة داشبورد احترافي (ReportsDashboard.jsx)، ثم جدول الوحدات وتقرير الإمداد التفصيلي كما هما
function Reports({me,units,requests,layout,inventory,trackingStartedAt}) { const { t } = useLang(); return <div className="page-pad reports"><div className="page-heading report-heading"><AzmLogo className="report-logo"/><h2>{t('rep.title')}</h2></div><ReportsDashboard me={me} units={units} requests={requests} layout={layout} inventory={inventory} trackingStartedAt={trackingStartedAt}/><h3>{t('rd.unitsTable')}</h3><table><thead><tr><th>{t('common.unit')}</th><th>{t('ent.unitResources')}</th><th>MCR</th><th>DOS</th><th>OPTEMPO</th></tr></thead><tbody>{units.map(u=><tr key={u.id}><td>{unitName(t, u)}</td><td>{unitVisibleResources(u).map(r=><span className="unit-resource-chip" key={r.key}>{resName(t,r.key)} {Math.round(u[r.key]??0)}% <small>{fmtQty(unitQty(u,r.key))}</small></span>)}</td><td>{mcr(u)}%</td><td>{dos(u)}d</td><td>{t(`optempo.${u.optempo}`)}</td></tr>)}</tbody></table><SupplyReport me={me} layout={layout} trackingStartedAt={trackingStartedAt}/></div>; }

function Chart({title,units,value}) { return <div className="chart"><h3>{title}</h3><div>{units.map(u=><span key={u.id}><i style={{height:`${Math.max(4,Math.min(100,value(u)))}%`}}/><b>{u.id.slice(-2)}</b></span>)}</div></div>; }
function Kpi({value,label}) { return <div className="kpi"><b>{value}</b><small>{label}</small></div>; }

// ===== تقرير الإمداد (من الخادم) =====
const REPORT_FLOWS = ['opening', 'initial', 'relocated_in', 'external_add', 'transfer_in', 'transfer_out', 'dispatch', 'delivery', 'return', 'consumption', 'closing', 'current', 'inTransit'];
const BASE_FLOWS = ['openingOnHand', 'initial', 'relocatedIn', 'external_add', 'crossBaseIn', 'crossBaseOut', 'internalTransfers', 'dispatch', 'delivery', 'return', 'consumption', 'relocatedOut', 'closingOnHand', 'currentOnHand', 'inTransit'];
const toLocalInput = ms => { if (!ms) return ''; const d = new Date(ms - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
const entityTitle = (e, t) => e.type === 'unit' ? (e.label || (dict[`unit.${e.unitId}.name`] ? t(`unit.${e.unitId}.name`) : e.unitId)) : (e.label || (e.labelKey ? t(e.labelKey) : e.id));

function SupplyReport({ me, layout, trackingStartedAt }) {
  const { t, lang } = useLang();
  const [period, setPeriod] = useState('tracking'), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [f, setF] = useState({ baseId: '', supplyId: '', unitId: '', resource: '', status: '' }), [view, setView] = useState(resources[0]?.key || '');
  const [data, setData] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false);
  const [explanation, setExplanation] = useState(null), [explaining, setExplaining] = useState(false), explanationVersion = useRef(0);
  const set = (k, v) => setF(x => ({ ...x, [k]: v, ...(k === 'baseId' ? { supplyId: '', unitId: '' } : {}) }));
  const isUnitMgr = me.role === 'user';
  const bases = layout.nodes.filter(n => n.type === 'main'), fsbs = layout.nodes.filter(n => n.type === 'fsb' && (!f.baseId || n.baseId === f.baseId));
  const unitNodes = layout.nodes.filter(n => n.type === 'unit' && (!f.baseId || n.baseId === f.baseId) );
  const range = () => { const now = Date.now(), h = 3600000; if (period === '24h') return { from: now - 24 * h }; if (period === '7d') return { from: now - 168 * h }; if (period === '30d') return { from: now - 720 * h }; if (period === 'custom') return { from: from ? new Date(from).getTime() : undefined, to: to ? new Date(to).getTime() : undefined }; return {}; };
  const load = () => {
    const q = { ...range(), ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) };
    explanationVersion.current++; setExplanation(null); setExplaining(false);
    setBusy(true); setError(null);
    api(`/api/reports?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '')).toString()}`).then(d => { setData(d); if (f.resource) setView(f.resource); }).catch(setError).finally(() => setBusy(false));
  };
  useEffect(() => { load(); }, [period, from, to, f.baseId, f.supplyId, f.unitId, f.resource, f.status]);
  const explain = () => {
    const version = ++explanationVersion.current;
    setExplaining(true); setExplanation(null);
    api('/api/reports/explain', { method: 'POST', body: { ...range(), ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), language: lang } })
      .then(result => { if (version === explanationVersion.current) setExplanation(result); })
      .catch(e => { if (version === explanationVersion.current) setExplanation({ kind: 'ai_error', error: e }); })
      .finally(() => { if (version === explanationVersion.current) setExplaining(false); });
  };
  const res = data && data.resources.includes(view) ? view : data?.resources[0];
  const csv = () => {
    if (!data) return;
    const rows = [['section', 'entity', 'type', 'base', 'resource', 'measure', ...REPORT_FLOWS]];
    for (const e of data.entities) for (const r of data.resources) rows.push(['entity', `${entityTitle(e, t)} (${e.code || e.id})`, e.type, e.baseId || '', r, data.measures[r], ...REPORT_FLOWS.map(k => e.rows[r][k] ?? '')]);
    for (const b of data.bases) for (const r of data.resources) rows.push(['base_total', `${entityTitle(b, t)} (${b.code || b.id})`, 'main', b.id, r, data.measures[r], ...BASE_FLOWS.map(k => b.totals[r][k] ?? '')]);
    rows.push([]); rows.push(['requests', 'total', data.requests.total, ...Object.entries(data.requests.byStatus).map(([k, v]) => `${k}:${v}`)]);
    for (const r of data.resources) rows.push(['request_qty', r, data.measures[r], data.requests.qty[r].requested, data.requests.qty[r].dispatched, data.requests.qty[r].delivered]);
    for (const s of data.hqOutgoing?.shipments || []) rows.push(['hq_dispatch', s.requestId, s.resource, s.measure, s.qty, s.to.entityId, s.to.baseId || '', new Date(s.at).toISOString(), s.by]);
    for (const s of data.virtualSupply || []) rows.push(['virtual_supply', s.opId, s.requestId || '', s.resource, s.measure, s.qty, s.baseId, new Date(s.at).toISOString(), s.by, s.reason]);
    const text = rows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = `azm-report-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const q = v => v == null ? '—' : fmtQty(v);
  return <section className="supply-report">
    <div className="page-heading"><h2>📑 {t('srep.title')}</h2><small>{t('srep.sub')}</small><button className="approve" disabled={!data || busy || explaining} onClick={explain}>✦ {explaining ? t('srep.explaining') : t('srep.explain')}</button><button className="approve" disabled={!data} onClick={csv}>⬇ {t('srep.export')}</button></div>
    <div className="srep-filters">
      <label>{t('srep.period')}<select value={period} onChange={e => setPeriod(e.target.value)}>{['tracking', '24h', '7d', '30d', 'custom'].map(p => <option key={p} value={p}>{t(`srep.p.${p}`)}</option>)}</select></label>
      {period === 'custom' && <><label>{t('srep.from')}<input type="datetime-local" value={from} min={toLocalInput(trackingStartedAt)} onChange={e => setFrom(e.target.value)}/></label><label>{t('srep.to')}<input type="datetime-local" value={to} onChange={e => setTo(e.target.value)}/></label></>}
      {!isUnitMgr && me.role === 'admin' && <label>{t('db.base')}<select value={f.baseId} onChange={e => set('baseId', e.target.value)}><option value="">{t('common.all')}</option>{bases.map(b => <option key={b.id} value={b.id}>★ {nodeName(b, t)}</option>)}</select></label>}
      {!isUnitMgr && <label>{t('srep.source')}<select value={f.supplyId} onChange={e => set('supplyId', e.target.value)}><option value="">{t('common.all')}</option>{fsbs.map(n => <option key={n.id} value={n.id}>▪ {nodeName(n, t)}</option>)}</select></label>}
      {!isUnitMgr && <label>{t('common.unit')}<select value={f.unitId} onChange={e => set('unitId', e.target.value)}><option value="">{t('common.all')}</option>{unitNodes.map(n => <option key={n.id} value={n.unitId}>⬢ {nodeName(n, t)}</option>)}</select></label>}
      <label>{t('routes.type')}<select value={f.resource} onChange={e => set('resource', e.target.value)}><option value="">{t('common.all')}</option>{resources.map(r => <option key={r.key} value={r.key}>{r.icon} {resName(t, r.key)}</option>)}</select></label>
      <label>{t('req.status')}<select value={f.status} onChange={e => set('status', e.target.value)}><option value="">{t('common.all')}</option>{['pending', 'approved', 'delivered', 'rejected'].map(s => <option key={s} value={s}>{t(`req.status.${s}`)}</option>)}</select></label>
    </div>
    {error && <p className="form-error">{errText(t, error)}</p>}
    {busy && !data && <p className="empty">{t('login.loading')}</p>}
    {explanation && <div className="srep-ai-explanation" role="status"><h3>{t('srep.explanationTitle')}</h3><p dir="auto">{explanation.kind === 'not_connected' ? t('ai.status.offline') : explanation.kind === 'ai_error' ? t('ai.error') : explanation.text}</p>{explanation.model && <small>{t('srep.explanationModel', { model: explanation.model })}</small>}</div>}
    {data && <>
      {data.operationCycle && <p className="srep-note">{t('cycle.current', { id: data.operationCycle.id.slice(0,8), at: fmtDateTime(data.operationCycle.startedAt) })}</p>}
      <p className="srep-note">ⓘ {t('srep.tracking', { at: fmtDateTime(data.trackingStartedAt) })} · {t('srep.window', { from: fmtDateTime(data.period.effectiveFrom), to: fmtDateTime(data.period.to) })}</p>
      {data.historyUnavailableBefore && <p className="srep-warn">⚠ {t('srep.noHistory', { at: fmtDateTime(data.historyUnavailableBefore) })}</p>}
      <h3>{t('srep.requests')}</h3>
      <div className="kpis"><Kpi value={data.requests.total} label={t('srep.total')}/>{Object.entries(data.requests.byStatus).map(([k, v]) => <Kpi key={k} value={v} label={t(`req.status.${k}`)}/>)}</div>
      <table className="srep-table"><thead><tr><th>{t('routes.type')}</th><th>{t('srep.requested')}</th><th>{t('srep.dispatched')}</th><th>{t('srep.delivered')}</th></tr></thead>
        <tbody>{data.resources.map(r => <tr key={r}><td>{resName(t, r)} <small>{resUnitName(t, r)}</small></td><td dir="ltr">{q(data.requests.qty[r].requested)}</td><td dir="ltr">{q(data.requests.qty[r].dispatched)}</td><td dir="ltr">{q(data.requests.qty[r].delivered)}</td></tr>)}</tbody></table>
      {data.hqOutgoing && data.hqOutgoing.shipments.length > 0 && <><h3>◆ {t('srep.hqOut')}</h3><p className="ni-muted">{t('srep.hqOutHint')}</p>
        <div className="kpis">{data.resources.filter(r => data.hqOutgoing.totals[r]?.total > 0).map(r => <Kpi key={r} value={fmtQty(data.hqOutgoing.totals[r].total)} label={`${resName(t, r)} · ${resUnitName(t, r)}`}/>)}</div>
        <div className="srep-scroll"><table className="srep-table"><thead><tr><th>{t('mv.time')}</th><th>{t('mv.ref')}</th><th>{t('routes.type')}</th><th>{t('mv.qty')}</th><th>{t('db.to')}</th><th>{t('req.decidedBy')}</th></tr></thead>
          <tbody>{data.hqOutgoing.shipments.slice(0, 50).map(s => <tr key={s.movementId}><td>{fmtDateTime(s.at)}</td><td><code>{s.requestId}</code></td><td>{resName(t, s.resource)}</td><td dir="ltr"><b>{fmtQty(s.qty)}</b> <small>{resUnitName(t, s.resource)}</small></td><td>{s.to.label || (s.to.labelKey ? t(s.to.labelKey) : s.to.entityId)} <small><code>{s.to.code || s.to.entityId}</code></small></td><td>{s.by}</td></tr>)}</tbody></table></div></>}
      {data.virtualSupply?.length > 0 && <><h3>{t('supply.records')}</h3><div className="srep-scroll"><table className="srep-table"><thead><tr><th>{t('mv.time')}</th><th>{t('mv.ref')}</th><th>{t('db.base')}</th><th>{t('routes.type')}</th><th>{t('mv.qty')}</th><th>{t('req.decidedBy')}</th><th>{t('stock.reason')}</th></tr></thead><tbody>{data.virtualSupply.map(s => <tr key={s.id}><td>{fmtDateTime(s.at)}</td><td>{s.opId}</td><td>{entityTitle(layout.nodes.find(n => n.id === s.baseId) || { id: s.baseId }, t)}</td><td>{resName(t, s.resource)}</td><td>{fmtQty(s.qty)} {resUnitName(t, s.resource)}</td><td>{s.by}</td><td dir="auto">{s.reason}</td></tr>)}</tbody></table></div></>}
      {data.bases.length > 0 && <><h3>{t('srep.baseTotals')}</h3><p className="ni-muted">{t('srep.baseHint')}</p>
        {data.bases.map(b => <div key={b.id} className="srep-base"><h4>★ {entityTitle(b, t)} <code>{b.code || b.id}</code> <small>{t('srep.entities', { n: b.entities })}</small></h4>
          <div className="srep-scroll"><table className="srep-table"><thead><tr><th>{t('routes.type')}</th>{BASE_FLOWS.map(k => <th key={k}>{t(`srep.f.${k}`)}</th>)}</tr></thead>
            <tbody>{data.resources.map(r => <tr key={r}><td>{resName(t, r)} <small>{resUnitName(t, r)}</small></td>{BASE_FLOWS.map(k => <td key={k} dir="ltr" className={k === 'internalTransfers' ? 'muted' : k.includes('OnHand') ? 'strong' : ''}>{q(b.totals[r][k])}</td>)}</tr>)}</tbody></table></div></div>)}</>}
      <h3>{t('srep.entitiesTitle')}</h3>
      {data.resources.length > 1 && <div className="filter-chips">{data.resources.map(r => <button key={r} className={res === r ? 'active' : ''} onClick={() => setView(r)}>{resources.find(x => x.key === r)?.icon} {resName(t, r)}</button>)}</div>}
      <p className="ni-muted">{t('srep.unitNote', { unit: resUnitName(t, res) })}</p>
      <div className="srep-scroll"><table className="srep-table"><thead><tr><th>{t('srep.entity')}</th><th>{t('policy.assigned')}</th><th>{t('db.colCapacity')}</th>{REPORT_FLOWS.map(k => <th key={k}>{t(`srep.f.${k}`)}</th>)}</tr></thead>
        <tbody>{data.entities.length ? data.entities.map(e => <tr key={e.id} className={e.archived ? 'archived' : ''}><td><b>{entityIcon[e.type]} {entityTitle(e, t)}</b><small><code>{e.code || e.id}</code> · {e.unitId || e.id}{e.archived ? ` · ${t('srep.archived')}` : ''}{e.createdInPeriod ? ` · ${t('srep.created')}` : ''}</small></td><td>{e.type==='unit' && e.allowedResources?.includes(res) ? t('policy.assigned') : t('info.none')}</td><td dir="ltr">{q(e.capacity?.[res] || 0)}</td>{REPORT_FLOWS.map(k => <td key={k} dir="ltr" className={k === 'consumption' ? 'sim' : k === 'opening' || k === 'closing' ? 'strong' : ''}>{q(e.rows[res][k])}</td>)}</tr>) : <tr><td colSpan={REPORT_FLOWS.length + 3} className="empty">{t('srep.none')}</td></tr>}</tbody></table></div>
      <small className="ni-muted">🧪 {t('srep.simNote')}</small>
    </>}
  </section>;
}
