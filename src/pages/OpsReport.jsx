// التقرير الذكي داخل سجل العمليات: لعملية واحدة أو عمليات محددة أو فترة وفلاتر.
// الأرقام يحسبها الخادم من السجل ضمن صلاحية الحساب؛ النموذج يكتب الشرح فقط ولا يغيّر شيئاً.
const OPS_MOVE_TYPES = ['external_add', 'transfer', 'dispatch', 'delivery', 'return', 'consumption', 'retirement', 'maintenance', 'maintenance_due'];
const opsTypeLabel = (t, type) => t(`${OPS_MOVE_TYPES.includes(type) ? 'mv.type' : 'audit'}.${type}`);
const opsDayStart = d => d ? new Date(`${d}T00:00:00`).getTime() : undefined;
const opsDayEnd = d => d ? new Date(`${d}T23:59:59.999`).getTime() : undefined;
const opsIsoDay = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// وصف التحديد بلغة المستخدم (عمليات محددة أو فلاتر)
function opsSelectionText(t, sel, layout) {
  if (!sel) return '';
  if (sel.mode === 'ids') return sel.ids.length === 1 ? t('ops.selOne', { id: sel.ids[0] }) : t('ops.selIds', { n: sel.ids.length });
  const f = sel.filters || {}, parts = [];
  parts.push(f.from || f.to ? t('ops.selRange', { from: f.from ? fmtDateTime(f.from) : '…', to: f.to ? fmtDateTime(f.to) : '…' }) : t('ops.selAllTime'));
  if (f.entityId) { const n = layout.nodes.find(x => x.id === f.entityId); parts.push(n ? nodeName(n, t) : f.entityId); }
  if (f.type) parts.push(opsTypeLabel(t, f.type));
  if (f.resource) parts.push(resName(t, f.resource));
  if (f.actor) parts.push(`${t('audit.actor')}: ${f.actor}`);
  if (f.search) parts.push(`«${f.search}»`);
  return parts.join(' · ');
}

// نص النموذج: سطر ينتهي بنقطتين = عنوان قسم، وسطر يبدأ بشرطة = بند
function OpsReportText({ text }) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  return <div className="ops-report-text" dir="auto">{lines.map((l, i) => /^[-•*]\s+/.test(l)
    ? <p key={i} className="ops-bullet" dir="auto">{l.replace(/^[-•*]\s+/, '').replace(/\*\*/g, '')}</p>
    : /[:：]$/.test(l) && l.length <= 40 ? <h4 key={i} dir="auto">{l.replace(/\*\*/g, '')}</h4> : <p key={i} dir="auto">{l.replace(/\*\*/g, '')}</p>)}</div>;
}

function OpsReportPanel({ me, layout, filters, selected, onClearSelection, onPreset, quick }) {
  const { t, lang } = useLang();
  const [list, setList] = useState([]), [report, setReport] = useState(null), [status, setStatus] = useState(null);
  const [mode, setMode] = useState('filters'), [focus, setFocus] = useState(''), [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [showHistory, setShowHistory] = useState(false), [copied, setCopied] = useState(false);
  const token = useRef(0), view = useRef(null);
  const loadList = () => api('/api/ops-reports').then(setList).catch(() => {});
  const checkStatus = () => api('/api/report-ai/status').then(setStatus).catch(() => setStatus({ connected: false, state: 'unavailable' }));
  useEffect(() => { loadList(); checkStatus(); }, []);
  useEffect(() => { setMode(selected.length ? 'selected' : 'filters'); }, [selected.length > 0]);

  const run = (path, body) => {
    if (busy) return; const my = ++token.current;
    setBusy(true); setError(null);
    return api(path, { method: 'POST', body: { ...body, language: lang } })
      .then(r => { if (token.current === my) { setReport(r); setTimeout(() => view.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50); } loadList(); checkStatus(); })
      .catch(setError).finally(() => setBusy(false));
  };
  const currentFilters = () => Object.fromEntries(Object.entries({ from: opsDayStart(filters.from), to: opsDayEnd(filters.to), entityId: filters.entityId, type: filters.type, resource: filters.resource, actor: filters.actor, search: filters.search }).filter(([, v]) => v !== undefined && v !== ''));
  const generate = () => run('/api/ops-reports', mode === 'selected' && selected.length ? { ids: selected, focus } : { filters: currentFilters(), focus });
  useEffect(() => { if (quick) run('/api/ops-reports', { ids: quick.ids }); }, [quick]);
  const ask = e => { e.preventDefault(); const q = question.trim(); if (!q || !report) return; run(`/api/ops-reports/${report.id}/messages`, { text: q }); setQuestion(''); };
  const open = id => { const my = ++token.current; setError(null); api(`/api/ops-reports/${id}`).then(r => { if (token.current === my) setReport(r); }).catch(setError); };
  const remove = id => { if (!confirm(t('ops.deleteConfirm'))) return; api(`/api/ops-reports/${id}`, { method: 'DELETE' }).then(() => { if (report?.id === id) setReport(null); loadList(); }).catch(setError); };
  const preset = days => { const now = Date.now(); onPreset(opsIsoDay(now - (days - 1) * 86400000), opsIsoDay(now)); setMode('filters'); };
  // التقرير بالقالب الموحّد (ReportTemplate.jsx): البيانات من الخادم بنطاق الحساب، ثم نافذة الطباعة/حفظ PDF
  const [exporting, setExporting] = useState(false);
  const print = () => { if (exporting) return; setExporting(true); setError(null);
    // إذا تعذّر جلب الجداول (مثلاً خادم قديم ما أُعيد تشغيله) نطبع التقرير من بياناته المحفوظة بدل ما يفشل الزر
    api(`/api/ops-reports/${report.id}/document`).catch(e => { console.warn('[report pdf] document data unavailable', e?.code || e); return null; })
    .then(data => printAzmReport(azmReportHtml(buildOpsReportDoc({ report: { ...report, selectionText: opsSelectionText(t, report.selection, layout) }, data, t, lang, layout, me }))))
    .catch(setError).finally(() => setExporting(false)); };
  const copy = () => {
    const s = report.stats, lines = [t('ops.reportTitle'), opsSelectionText(t, report.selection, layout), `${t('ops.statOps')}: ${s.total}`,
      ...Object.entries(s.quantities || {}).flatMap(([k, q]) => Object.entries(q.byType).map(([type, v]) => `- ${resName(t, k)}: ${fmtQty(v)} ${resUnitName(t, k)} — ${opsTypeLabel(t, type)}`)),
      '', ...report.messages.filter(m => m.text).map(m => m.role === 'user' ? `${t('ops.question')}: ${m.text}` : m.text)];
    navigator.clipboard?.writeText(lines.join('\n')).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };

  const s = report?.stats, qtyTypes = s ? [...new Set(Object.values(s.quantities || {}).flatMap(q => Object.keys(q.byType)))] : [];
  // صفوف جدول الكميات: كل مورد تحرك أو طُلب في التحديد (الكميات المطلوبة محسوبة لكل طلب مرة واحدة)
  const requested = s?.requested || {}, hasRequested = Object.keys(requested).length > 0;
  const rejectedQty = s?.rejectedRequested || {}, hasRejected = Object.keys(rejectedQty).length > 0;
  const qtyKeys = s ? [...new Set([...Object.keys(requested), ...Object.keys(rejectedQty), ...Object.keys(s.quantities || {})])] : [];
  const filterText = opsSelectionText(t, { mode: 'filters', filters: currentFilters() }, layout);
  return <section className="ops-report">
    <div className="ops-report-head">
      <div><h3>🧠 {t('ops.title')}</h3><small>{t('ops.sub')}</small></div>
      <div className="ops-statuses" role="status">
        <span className={`ops-model ${status?.connected ? 'connected' : ''}`}><i />{status?.connected ? t('ai.status.online', { model: status.model }) : t(`reportChat.status.${status?.state || 'unverified'}`)}</span>
        {status?.rag && <span className={`ops-model ${status.rag.state === 'external_unavailable' ? '' : 'connected'}`} title={t('ops.ragHint')}><i />{t(`ops.rag.${status.rag.state}`, { n: status.rag.chunks || 0 })}</span>}
      </div>
    </div>
    <div className="ops-report-form">
      <div className="ops-modes" role="radiogroup" aria-label={t('ops.scope')}>
        <label className={mode === 'filters' ? 'active' : ''}><input type="radio" checked={mode === 'filters'} onChange={() => setMode('filters')} />{t('ops.modeFilters')}<small>{filterText}</small></label>
        <label className={`${mode === 'selected' ? 'active' : ''} ${selected.length ? '' : 'disabled'}`}><input type="radio" disabled={!selected.length} checked={mode === 'selected'} onChange={() => setMode('selected')} />{t('ops.modeSelected', { n: selected.length })}<small>{selected.length ? <button type="button" className="ops-link" onClick={onClearSelection}>{t('ops.clearSelection')}</button> : t('ops.selectHint')}</small></label>
      </div>
      <div className="ops-presets"><span>{t('ops.quickRange')}</span>{[[1, 'ops.today'], [7, 'ops.last7'], [30, 'ops.last30']].map(([d, k]) => <button type="button" key={k} onClick={() => preset(d)}>{t(k)}</button>)}<button type="button" onClick={() => { onPreset('', ''); setMode('filters'); }}>{t('ops.allTime')}</button></div>
      <div className="ops-generate"><input dir="auto" maxLength="500" value={focus} onChange={e => setFocus(e.target.value)} placeholder={t('ops.focusPlaceholder')} aria-label={t('ops.focusPlaceholder')} />
        <button className="approve" disabled={busy} onClick={generate}>{busy ? t('ops.generating') : t('ops.generate')}</button>
        <button type="button" className={showHistory ? 'active' : ''} onClick={() => setShowHistory(v => !v)}>{t('ops.history')} ({list.length})</button></div>
      {showHistory && <div className="ops-history">{!list.length ? <p className="empty">{t('ops.noHistory')}</p> : list.map(r => <div key={r.id} className={r.id === report?.id ? 'active' : ''}>
        <button type="button" onClick={() => open(r.id)}><b dir="auto">{opsSelectionText(t, r.selection, layout)}</b><small>{fmtDateTime(r.updatedAt)} · {t('ops.statOps')}: {r.total}</small></button>
        <button type="button" aria-label={t('ai.delete')} onClick={() => remove(r.id)}>×</button></div>)}</div>}
    </div>
    {error && <p className="form-error" role="alert">{errText(t, error)}</p>}
    {busy && !report && <p className="ops-busy" role="status">{t('ops.generating')}</p>}
    {report && <article className="ops-report-view" ref={view}>
      <header><div><h3>{t('ops.reportTitle')}</h3><small dir="auto">{opsSelectionText(t, report.selection, layout)}</small></div>
        <div className="ops-actions"><button type="button" onClick={copy}>{copied ? t('ops.copied') : t('ops.copy')}</button><button type="button" onClick={print} disabled={exporting}>{t('rpt.export')}</button><button type="button" onClick={() => setReport(null)}>{t('common.close')}</button></div></header>
      <div className="ops-cards">
        <div><b>{fmtQty(s.total)}</b><small>{t('ops.statOps')}</small></div>
        <div><b dir="ltr">{s.firstAt ? `${fmtDateTime(s.firstAt)} → ${fmtDateTime(s.lastAt)}` : '—'}</b><small>{t('ops.statPeriod')}</small></div>
        <div><b>{fmtQty(s.requestCount)}</b><small>{t('ops.statRequests')}</small></div>
        <div><b>{fmtQty(s.entities.length)}</b><small>{t('ops.statEntities')}</small></div>
      </div>
      <div className="ops-chips">{Object.entries(s.byType).sort((a, b) => b[1] - a[1]).map(([type, n]) => <span key={type} className={`mv-badge ${type}`}>{opsTypeLabel(t, type)}: {n}</span>)}
        {Object.entries(s.requestActions || {}).map(([a, n]) => <span key={a} className="ops-chip-soft">{t(`audit.action.${a}`)}: {n}</span>)}</div>
      {Object.keys(s.requestStatus || {}).length > 0 && <div className="ops-chips"><span className="ops-chips-label">{t('ops.requestStatusNow')}</span>{Object.entries(s.requestStatus).map(([st, n]) => <span key={st} className="ops-chip-soft">{dict[`ops.reqStatus.${st}`] ? t(`ops.reqStatus.${st}`) : st}: {n}</span>)}</div>}
      {qtyKeys.length > 0 && <div className="srep-scroll"><table className="srep-table ops-qty"><thead><tr><th>{t('routes.type')}</th>{hasRequested && <th>{t('ops.requestedCol')}</th>}{hasRejected && <th>{t('ops.rejectedCol')}</th>}{qtyTypes.map(x => <th key={x}>{opsTypeLabel(t, x)}</th>)}</tr></thead>
        <tbody>{qtyKeys.map(k => { const q = s.quantities?.[k]; return <tr key={k}><td>{resName(t, k)} <small>{resUnitName(t, k)}</small></td>{hasRequested && <td dir="ltr">{requested[k] != null ? fmtQty(requested[k]) : '—'}</td>}{hasRejected && <td dir="ltr">{rejectedQty[k] != null ? fmtQty(rejectedQty[k]) : '—'}</td>}{qtyTypes.map(x => <td key={x} dir="ltr">{q?.byType[x] != null ? fmtQty(q.byType[x]) : '—'}</td>)}</tr>; })}</tbody></table></div>}
      {(s.entities.length > 0 || s.actors.length > 0) && <div className="ops-tops">
        {s.entities.length > 0 && <div><h4>{t('ops.topEntities')}</h4>{s.entities.map(e => { const n = layout.nodes.find(x => x.id === e.id); return <p key={e.id}><span>{n ? nodeName(n, t) : e.name}</span><b>{e.count}</b></p>; })}</div>}
        {s.actors.length > 0 && <div><h4>{t('ops.topActors')}</h4>{s.actors.map(a => <p key={a.by}><span>{a.by === 'simulation' ? t('mv.simulation') : a.by === 'system' ? t('req.system') : a.by}</span><b>{a.count}</b></p>)}</div>}
      </div>}
      <div className="ops-narrative">{report.messages.map((m, i) => m.role === 'user'
        ? (m.kind === 'report_request' ? (m.text ? <p key={i} className="ops-focus" dir="auto">{t('ops.focusLabel')}: {m.text}</p> : null) : <p key={i} className="ops-question" dir="auto">{m.text}</p>)
        : m.kind === 'not_connected' ? <div key={i} className="ops-offline">{t('ops.aiOffline')}</div>
        : m.kind === 'ai_error' ? <div key={i} className="ops-offline error">{t(dict[`err.${m.error}`] ? `err.${m.error}` : 'ops.aiError')}</div>
        : <div key={i} className="ops-answer"><OpsReportText text={m.text} />
          {m.sources?.length > 0 && <div className="ops-sources"><span>{t('ops.sources', { src: m.ragSource === 'bge-m3' ? 'BGE-M3' : t('ops.ragLocal') })}</span>{m.sources.map(id => <em key={id}>{dict[`rag.${id}`] ? t(`rag.${id}`) : id}</em>)}</div>}
          <small>{fmtDateTime(m.at)}{m.model ? ` · ${m.model}` : ''}</small></div>)}
        {busy && <p className="ops-busy" role="status">{t('ops.generating')}</p>}</div>
      <form className="ops-followup" onSubmit={ask}><input dir="auto" maxLength="2000" value={question} onChange={e => setQuestion(e.target.value)} placeholder={t('ops.followPlaceholder')} aria-label={t('ops.followPlaceholder')} /><button className="approve" disabled={busy || !question.trim()}>{t('ai.send')}</button></form>
      <small className="ops-note">{t('ops.note')}</small>
    </article>}
  </section>;
}
