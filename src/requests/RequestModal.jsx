// نموذج إنشاء طلب إمداد لوحدة
// كل الأصناف النشطة المخصصة للوحدة، والطلب بالكمية الفعلية بوحدة الصنف.
// «تعبئة جميع الموارد» = هذه الأصناف فقط بعد طرح الرصيد والوارد والمحجوز، والممتلئ لا يُطلب بصفر.
// الحد الوحيد هنا سعة الوحدة: السعة − الرصيد − الشحنات بالطريق (نفس حساب الخادم). توفر المصدر يُفحص عند الاعتماد واختيار المصدر.
function RequestModal({ me, units, layout, prefill = {}, onClose, onCreated }) {
  const { t } = useLang();
  // القائد ومسؤول القاعدة يختارون من وحدات نطاقهم (القائمة من الخادم)، ومسؤول الوحدة لوحدته فقط
  const pickUnit = me.role !== 'user', choices = pickUnit ? units : units.filter(u => u.id === me.unitId);
  const initialUnit = choices.find(x => x.id === prefill.unitId) || choices[0];
  // الكمية المقترحة: تعبئة الوحدة لسعتها (بعد احتساب الرصيد والشحنات بالطريق)
  const suggest = (u, key) => roomInfo(u, key).room;
  // المواد المختارة مبدئياً: المورد من التنبيه، وإلا كل مورد تحت نقطة الطلب وفيه مساحة، وإلا أول مورد فيه مساحة
  const preselect = u => { if (!u) return {}; const open = unitResources(u).filter(r => suggest(u, r.key) > 0).map(r => r.key); const keys = prefill.resource && open.includes(prefill.resource) ? [prefill.resource] : (open.filter(k => (u[k] ?? 0) < 50).length ? open.filter(k => (u[k] ?? 0) < 50) : open.slice(0, 1)); return Object.fromEntries(keys.map(k => [k, null])); };
  const [unitId, setUnitId] = useState(initialUnit?.id), [mode, setMode] = useState('truck'), [priority, setPriority] = useState(prefill.priority || 'normal'), [notes, setNotes] = useState((prefill.sourceText || '').slice(0, 1000));
  // مسؤول الوحدة: ما يُختار شي مسبقاً؛ الأصناف تجي من النص المكتوب أو من «إضافة صنف» (أو المورد من التنبيه إذا فُتحت النافذة منه)
  const unitMode = me.role === 'user';
  const initLines = () => !unitMode ? null : prefill.resource && unitResources(initialUnit).some(r => r.key === prefill.resource) && suggest(initialUnit, prefill.resource) > 0 ? [{ resource: prefill.resource, perUnit: {}, uom: '', n: String(Math.floor(suggest(initialUnit, prefill.resource))) }] : [];
  const [picked, setPicked] = useState(() => unitMode ? Object.fromEntries((initLines() || []).map(l => [l.resource, Number(l.n)])) : prefill.items?.length ? Object.fromEntries(prefill.items.filter(i => i.qty > 0 && unitResources(initialUnit).some(r => r.key === i.resource)).map(i => [i.resource, i.qty])) : preselect(initialUnit));
  // أصناف المسودة غير القابلة للطلب لهذه الوحدة (خارج السياسة التشغيلية) تُعرض ولا تدخل النموذج
  const [excludedDraft] = useState(() => (prefill.items || []).filter(i => !unitResources(initialUnit).some(r => r.key === i.resource)).map(i => i.resource));
  const [error, setError] = useState(null), [busy, setBusy] = useState(false), sending = useRef(false);
  const operationKey = useRef(`request-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [deadline,setDeadline]=useState(prefill.deadline||'');
  // طلب بالنص (مسؤول الوحدة): الأدابتر يطلع مسودة، والنافذة تعرض الأصناف المطلوبة فقط بكمياتها ووحدة قياسها للتعديل
  const [aiText,setAiText]=useState(()=>prefill.autoExtract||prefill.draft?String(prefill.sourceText||'').slice(0,4000):''),[aiBusy,setAiBusy]=useState(false),[aiResult,setAiResult]=useState(null),[aiError,setAiError]=useState(null),[aiLines,setAiLines]=useState(initLines);
  const u = choices.find(x => x.id === unitId);
  const routes = { truck: u && planRoute(layout, u.id, 'truck'), heli: u && planRoute(layout, u.id, 'heli') }, route = routes[mode];
  const items = u ? unitResources(u).filter(r => r.key in picked).map(r => { const info = roomInfo(u, r.key), qty = picked[r.key]===null?info.room:Number(picked[r.key]); return { resource: r.key, icon: r.icon, qty, fill:picked[r.key]===null, info, valid: Number.isInteger(qty) && qty > 0 && qty <= info.room }; }) : [];
  const invalid = items.some(i => !i.valid);
  // سطر المسودة: الكمية بوحدة القياس المختارة × معامل التحويل = الكمية بوحدة المخزون (التي يرسلها الطلب)
  const factor=l=>l.perUnit[l.uom]??1, lineQty=l=>Number(l.n)*factor(l);
  const baseUom=perUnit=>Object.keys(perUnit).find(k=>perUnit[k]===1)||Object.keys(perUnit)[0]||'';
  const uomName=k=>dict[`uom.${k}`]?t(`uom.${k}`):k;
  const applyLines=lines=>{ setAiLines(lines); setPicked(Object.fromEntries(lines.map(l=>[l.resource,lineQty(l)]))); };
  const setLine=(i,patch)=>applyLines(aiLines.map((l,j)=>j===i?{...l,...patch}:l));
  const extract=(txt=aiText)=>{ if(!txt.trim()||aiBusy||!u)return; setAiBusy(true); setAiError(null);
    api('/api/ai/request-draft',{method:'POST',body:{text:txt.trim(),unitId:u.id}}).then(r=>applyDraft(r.draft,txt.trim()))
      .catch(err=>setAiError(err)).finally(()=>setAiBusy(false)); };
  const applyDraft=(d,txt)=>{
      applyLines(d.items.filter(i=>i.requestable!==false&&unitResources(u).some(x=>x.key===i.resource))
        .map(i=>({resource:i.resource,perUnit:i.perUnit||{},uom:i.unit||baseUom(i.perUnit||{}),n:i.quantity??''})));
      if(d.priority)setPriority(d.priority); setDeadline(d.deadline?(dict[`deadline.${d.deadline}`]?t(`deadline.${d.deadline}`):d.deadline):''); setNotes(txt.slice(0,1000)); setAiResult(d); };
  // ما صححه الخادم بعد النموذج (ثابت من المسودة) + ما يحتاج تعديل الحين (يتحدث مع كل تعديل)
  const aiNotes=d=>[
    ...d.warnings.filter(w=>w.code==='negated_item_removed').map(w=>['fix',t('ai.fix.negated',{res:resName(t,w.resource)})]),
    ...d.warnings.filter(w=>w.code==='not_urgent_corrected').map(()=>['fix',t('ai.fix.notUrgent')]),
    ...d.warnings.filter(w=>w.code==='catalog_class_corrected').map(w=>['fix',t('ai.fix.class',{res:resName(t,w.resource)})]),
    ...(aiLines||[]).filter(l=>!(lineQty(l)>0)).map(l=>['warn',t('ai.warn.qty',{res:resName(t,l.resource)})]),
    ...(aiLines||[]).filter(l=>u&&lineQty(l)>roomInfo(u,l.resource).room).map(l=>['warn',t('ai.warn.room',{res:resName(t,l.resource),n:l.n,uom:uomName(l.uom),qty:fmtQty(lineQty(l)),unit:resUnitName(t,l.resource),room:fmtQty(roomInfo(u,l.resource).room)})]),
    ...d.items.filter(i=>i.requestable===false).map(i=>['warn',t('ai.warn.notUnit',{res:resName(t,i.resource)})]),
    ...(d.priority?[]:[['warn',t('ai.warn.priority')]]),
    ...(deadline.trim()?[]:[['warn',t('ai.warn.deadline')]])];
  // جاي من المحادثة: المسودة اللي وافق عليها («تمام») تتعبّى كما هي، وبدونها نستخرج أول ما تنفتح النافذة
  useEffect(()=>{ if(unitMode&&prefill.draft&&u)applyDraft(prefill.draft,aiText.trim()); else if(unitMode&&prefill.autoExtract&&aiText.trim())extract(aiText); },[]);
  const addable=aiLines&&u?unitResources(u).filter(r=>!aiLines.some(l=>l.resource===r.key)):[];
  const toggle = k => setPicked(p => { const n = { ...p }; if (k in n) delete n[k]; else n[k] = null; return n; });
  const changeUnit = id => { setUnitId(id); setPicked(preselect(choices.find(x => x.id === id))); };
  const submit = e => {
    e.preventDefault(); if (!u || sending.current || !items.length || invalid) return;
    sending.current = true; setBusy(true); setError(null);
    api('/api/requests', { method: 'POST', body: { operationKey: operationKey.current, unitId: u.id, mode, priority, deadline:deadline.trim()||null, notes: notes.trim(), eta: route ? route.hours : 1, items: items.map(({ resource, qty, fill }) => fill?{ resource, fill:true }:{ resource, qty }) } })
      .then(r => { onCreated(r); onClose(); }).catch(err => { setError(err); setBusy(false); sending.current = false; });
  };
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <form className="modal pro" role="dialog" aria-modal="true" onSubmit={submit}>
      <header><div className="pro-title"><span className="pro-icon">📦</span><div><h3>{t('req.new.title')}</h3><small>{t('req.new.sub')}</small></div></div><button type="button" className="modal-close" onClick={onClose} aria-label={t('common.close')}>✕</button></header>
      <div className="pro-body">
        <div className="pro-main">
          {me.role === 'user' && <section className="pro-section"><h4><i>✦</i>{t('ai.extract.title')}</h4>
            <label>{t('ai.extract.label')}<textarea dir="auto" rows="2" maxLength="4000" placeholder={t('ai.extract.placeholder')} value={aiText} onChange={e=>setAiText(e.target.value)}/></label>
            <button type="button" className="fill-all-btn" disabled={aiBusy||!aiText.trim()||!u} onClick={()=>extract()}>{aiBusy?t('ai.extract.busy'):t('ai.extractDraft')}</button>
            {aiError&&<small className="no-route">{errText(t,aiError)}</small>}
            {aiResult&&<div className="ai-notes">{aiNotes(aiResult).length?aiNotes(aiResult).map(([kind,text],i)=><small key={i} className={kind==='fix'?'route-info':'stage-legacy'}>{kind==='fix'?'ⓘ':'⚠'} {text}</small>):<small className="route-info">ⓘ {t('ai.extract.clean')}</small>}</div>}
          </section>}
          <section className="pro-section"><h4><i>1</i>{t('req.step.unit')}</h4>
            <label>{t('common.unit')}<select value={unitId} disabled={!pickUnit} onChange={e => changeUnit(e.target.value)}>{choices.map(x => <option key={x.id} value={x.id}>{x.id} — {unitName(t, x)}</option>)}</select></label>
            <div className="mode-cards">{['truck', 'heli'].map(m => <button type="button" key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
              <span>{m === 'truck' ? '🚛' : '✈️'}</span><b>{t(`mode.${m}`).replace(/^\S+\s/, '')}</b><small>{routes[m] ? <><bdi dir="ltr">{Math.round(routes[m].km)} {t('common.km')}</bdi> · <bdi>{fmtHours(routes[m].hours)}</bdi></> : t('req.noRouteShort')}</small>
            </button>)}</div>
          </section>
          <section className="pro-section"><h4><i>2</i>{t('req.step.items')}</h4>
            {aiLines ? <div className="ai-lines">{aiLines.map((l,i)=>{ const units=Object.keys(l.perUnit), qty=lineQty(l), room=u?roomInfo(u,l.resource).room:0, over=qty>room;
              return <div key={l.resource} className="ai-line">
                <b>{resName(t,l.resource)}</b>
                <input type="number" min="0" step="any" dir="ltr" className={over||!(qty>0)?'over':''} value={l.n} onChange={e=>setLine(i,{n:e.target.value})}/>
                {units.length>1?<select value={l.uom} onChange={e=>setLine(i,{uom:e.target.value})}>{units.map(k=><option key={k} value={k}>{uomName(k)}</option>)}</select>:<span>{units.length?uomName(units[0]):resUnitName(t,l.resource)}</span>}
                <small className={over?'stage-legacy':'route-info'}>= <bdi dir="ltr">{fmtQty(qty)}</bdi> {resUnitName(t,l.resource)} · {t('ai.line.room')} <bdi dir="ltr">{fmtQty(room)}</bdi></small>
                <button type="button" className="ai-x" aria-label={t('ai.line.remove')} onClick={()=>applyLines(aiLines.filter((_,j)=>j!==i))}>✕</button>
              </div>; })}
              {!aiLines.length&&<small className="route-info">{t('ai.line.empty')}</small>}
              {addable.length>0&&<select className="ai-add" value="" onChange={e=>e.target.value&&applyLines([...aiLines,{resource:e.target.value,perUnit:{},uom:'',n:''}])}><option value="">＋ {t('ai.line.add')}</option>{addable.map(r=><option key={r.key} value={r.key}>{resName(t,r.key)}</option>)}</select>}
            </div> : <>
            <button type="button" className="fill-all-btn" disabled={busy || !u} onClick={() => setPicked(Object.fromEntries(unitResources(u).filter(r => suggest(u, r.key) > 0).map(r => [r.key, null])))}>{t('req.fillAll')}</button>
            <small className="route-info">{t('req.fillAllHint')}</small>
            {u && unitLegacyResources(u).length > 0 && <small className="stage-legacy">{t('policy.legacyInForm', { list: unitLegacyResources(u).map(r => resName(t, r.key)).join('، ') })}</small>}
            {excludedDraft.length > 0 && <small className="stage-legacy">{t('ai.excludedFromForm', { list: excludedDraft.map(k => resName(t, k)).join('، ') })}</small>}
            <div className="items">{u && unitResources(u).map(r => { const info = roomInfo(u, r.key), full = info.room <= 0, on = r.key in picked && !full, level = Math.round(u[r.key] ?? 0), qty = picked[r.key]===null?info.room:Number(picked[r.key]);
              return <div key={r.key} className={`item-row qty-mode ${on ? 'on' : ''}`}>
                <label className="item-check"><input type="checkbox" checked={on} disabled={full} onChange={() => toggle(r.key)}/><span>{r.icon}</span><b>{resName(t, r.key)}</b></label>
                <div className="item-level"><div className="mini-bar"><i className={level < 25 ? 'red' : level < 50 ? 'amber' : 'green'} style={{ width: `${level}%` }}/></div><small dir="ltr">{fmtQty(info.current)} / {fmtQty(info.capacity)}{info.inTransit > 0 ? ` · 🚛 +${fmtQty(info.inTransit)}` : ''}</small></div>
                {full ? <small className="item-full">{t('req.noRoomDetail', { cap: fmtQty(info.capacity), cur: fmtQty(info.current), tr: fmtQty(info.inTransit), unit: resUnitName(t, r.key) })}</small> : <>
                  <FillQuantity value={on?picked[r.key]:''} disabled={!on} info={info} resource={r.key} onChange={value=>setPicked(p=>({...p,[r.key]:value}))}/>
                  <div className="item-qty"><b dir="ltr">{on && qty > 0 ? `+${Math.round(qty / info.capacity * 100)}%` : ''}</b><small>{t('req.maxRoom', { n: fmtQty(info.room), unit: resUnitName(t, r.key) })}</small></div>
                </>}
                <StockRoomSummary info={info} resource={r.key}/>
              </div>; })}</div>
            </>}
            {!items.length && !aiLines && <small className="no-route">{u && !unitResources(u).length ? t('inv.noActiveResources') : t('req.pickOne')}</small>}
            {invalid && <small className="no-route">{t('req.qtyInvalid')}</small>}
          </section>
          <section className="pro-section"><h4><i>3</i>{t('req.step.reason')}</h4>
            <label>{t('req.deadline')}<input value={deadline} maxLength="80" dir="auto" placeholder={t('ai.deadlineMissing')} onChange={e=>setDeadline(e.target.value)}/></label>
            <div className="segmented">{PRIORITIES.map(p => <button type="button" key={p} className={`${p} ${priority === p ? 'active' : ''}`} onClick={() => setPriority(p)}>{priorityIcon[p]} {t(`priority.${p}`)}</button>)}</div>
            <label>{t('req.notes')}<textarea dir="auto" rows="4" maxLength="1000" placeholder={t('req.notesPlaceholder')} value={notes} onChange={e => setNotes(e.target.value)}/><small className="counter">{notes.length}/1000</small></label>
          </section>
        </div>
        <aside className="pro-summary">
          <h4>{t('req.summary')}</h4>
          {u && <div className="sum-unit"><b>{unitName(t, u)}</b><small>{u.id} · MCR {mcr(u)}%</small><span className={`chip ${statusFor(u)}`}>{t(`state.${statusFor(u)}`)}</span></div>}
          <div className="sum-items">{items.length ? items.map(i => <div key={i.resource}><span>{i.icon} {resName(t, i.resource)}</span><b dir="ltr">{fmtQty(i.info.current)} → {i.valid ? fmtQty(i.info.current + i.qty) : '—'}</b><small>{i.valid ? `+${fmtQty(i.qty)}` : '—'} {resUnitName(t, i.resource)}</small></div>) : <p className="empty">{t('req.pickOne')}</p>}</div>
          <dl>
            <dt>{t('routes.transport')}</dt><dd>{t(`mode.${mode}`)}</dd>
            <dt>{t('req.from')}</dt><dd>{route ? `${nodeName(route.from, t)} ${t('req.fromSuggested')}` : '—'}</dd>
            <dt>{t('dash.distance')}</dt><dd>{route ? `${Math.round(route.km)} ${t('common.km')}` : '—'}</dd>
            <dt>ETA</dt><dd>{route ? fmtHours(route.hours) : '—'}</dd>
            <dt>{t('req.priority')}</dt><dd className={`prio ${priority}`}>{priorityIcon[priority]} {t(`priority.${priority}`)}</dd>
          </dl>
          <small className="route-info">{t('req.sourceAtApproval')}</small>
        </aside>
      </div>
      <footer>{error && <span className="form-error">{errText(t, error)}{errDetail(t, error)}</span>}<button type="button" className="reject" onClick={onClose}>{t('dash.cancel')}</button><button type="submit" className="approve" disabled={busy || !u || !items.length || invalid}>{t('req.submitN', { n: items.length })}</button></footer>
    </form>
  </div>;
}
