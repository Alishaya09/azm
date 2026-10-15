// أدوات الهيكل والمخزون للقائد الرئيسي: إنشاء كيان، إضافة مخزون خارجي، وإصلاح السجلات القديمة بدون قاعدة.
// التبعية ثابتة: تُحدد عند الإنشاء (القاعدة إلزامية للمركز والوحدة) وما تتغير بعده. مصدر الإمداد يُختار لكل شحنة.
// كل إجراء يرسل للخادم، والخادم هو اللي يتحقق من الصلاحية والعلاقات والسعة.
const entityIcon = { main: '★', fsb: '▪', unit: '⬢' };
// السعة الافتراضية للكيان الجديد — من كتالوج الموارد (نفس حساب الخادم)
const newEntityCapacity = type => type === 'unit' ? Object.fromEntries(resources.map(r => [r.key, capacityOf(newUnitDefaults, r.key)])) : depotCapOf(type);

// إنشاء قاعدة أو مركز إمداد أو وحدة: الاسم، الموقع، القاعدة التابع لها (إلزامية للمركز والوحدة)، والرصيد الافتتاحي
// unitOnly: مسؤول القاعدة ينشئ وحدات لقاعدته فقط (والخادم يفرض القاعدة والنوع)
function CreateEntityModal({ type: initialType = 'main', pos, layout, presetBaseId = null, unitOnly = false, onClose, onCreated }) {
  const { t } = useLang();
  const bases = layout.nodes.filter(n => n.type === 'main' && (!unitOnly || n.id === presetBaseId));
  const [type, setType] = useState(initialType), [label, setLabel] = useState(''), [baseId, setBaseId] = useState(presetBaseId || bases[0]?.id || '');
  const [people, setPeople] = useState(500), [vehicles, setVehicles] = useState(40);
  // جميع الأصناف النشطة مخصصة للوحدة؛ الرصيد الافتتاحي صفر.
  const starterKeys = resources.map(r => r.key);
  const createKey = useRef(newAzmTabId());
  const [error, setError] = useState(null), [busy, setBusy] = useState(false);
  const basePos = bases.find(b => b.id === baseId)?.pos;
  const [lat, setLat] = useState(String(pos?.[0] ?? (basePos ? +(basePos[0] - .4).toFixed(4) : 24.5))), [lng, setLng] = useState(String(pos?.[1] ?? (basePos ? +(basePos[1] - .4).toFixed(4) : 46.5)));
  const cap = type === 'unit' ? Object.fromEntries(resources.map(r => [r.key, capacityOf({ ...newUnitDefaults, people:Number(people), vehicles:Number(vehicles) }, r.key)])) : newEntityCapacity(type);
  const submit = e => {
    e.preventDefault(); if (busy) return; setError(null);
    const p = [Number(lat), Number(lng)];
    if (!label.trim()) return setError({ code: 'invalid_entity' });
    setBusy(true);
    api('/api/entities', { method: 'POST', body: { operationKey: createKey.current, type, label: label.trim(), pos: p, baseId: type === 'main' ? null : baseId, ...(type === 'unit' ? { people:Number(people), vehicles:Number(vehicles) } : {}) } })
      .then(r => { onCreated?.(r); onClose(); }).catch(err => { setError(err); setBusy(false); });
  };
  const blocked = type !== 'main' && !baseId;
  return <Modal title={t('ent.createTitle')} onClose={onClose}>
    <form className="req-form" onSubmit={submit}>
      <div className="segmented">{(unitOnly ? ['unit'] : ['main', 'fsb', 'unit']).map(x => <button type="button" key={x} className={type === x ? 'active' : ''} onClick={() => setType(x)}>{entityIcon[x]} {t(`info.type.${x}`)}</button>)}</div>
      <label>{t('ent.name')}<input dir="auto" maxLength="80" value={label} onChange={e => setLabel(e.target.value)} autoFocus required/></label>
      {type !== 'main' && <label>{t('ent.base')} *<select value={baseId} onChange={e => { setBaseId(e.target.value); }}>{bases.map(b => <option key={b.id} value={b.id}>★ {nodeName(b, t)}</option>)}</select><small className="route-info">{t('ent.baseFixed')}</small></label>}
      {type !== 'main' && !bases.length && <small className="no-route">{t('ent.noBases')}</small>}
      <div className="req-grid"><label>{t('ent.lat')}<input dir="ltr" value={lat} onChange={e => setLat(e.target.value)}/></label><label>{t('ent.lng')}<input dir="ltr" value={lng} onChange={e => setLng(e.target.value)}/></label></div>
      {type === 'unit' && <div className="req-grid"><label>{t('unit.people')}<input type="number" min="1" max="2000" step="1" value={people} onChange={e=>setPeople(e.target.value)}/></label><label>{t('unit.vehicles')}<input type="number" min="0" max="200" step="1" value={vehicles} onChange={e=>setVehicles(e.target.value)}/></label></div>}

      <small className="route-info">{t(type === 'unit' ? 'ent.starterHint' : type === 'main' ? 'ent.baseFullHint' : 'ent.centerEmptyHint')}</small>
      {type === 'unit' && <div className="unit-resource-list starter-preview"><small className="ni-muted">{t('ent.starterList', { n: starterKeys.length })}</small>{starterKeys.map(k => <span key={k}>{resIcon(k)} {resName(t,k)} · {`0 / ${fmtQty(cap[k] || 0)}`} {resUnitName(t,k)}</span>)}</div>}
      {error && <span className="form-error">{errText(t, error)}{errDetail(t, error)}{error.failures?.map(i => <div key={i.resource}>{resName(t,i.resource)}: {t('db.missing', { n: fmtQty(i.missing) })}</div>)}</span>}
      <footer><button type="button" className="reject" onClick={onClose}>{t('dash.cancel')}</button><button type="submit" className="approve" disabled={busy || blocked}>{t('ent.create')}</button></footer>
    </form>
  </Modal>;
}

function RelationInfo({ node, layout, canEdit = false, onChanged }) {
  const { t } = useLang();
  const [baseId, setBaseId] = useState(''), [error, setError] = useState(null), [busy, setBusy] = useState(false);
  useEffect(() => { setBaseId(''); setError(null); }, [node.id, node.baseId]);
  if (node.type === 'main' || node.type === 'hq') return null;
  const byId = Object.fromEntries(layout.nodes.map(n => [n.id, n])), bases = layout.nodes.filter(n => n.type === 'main');
  const broken = needsReview(node, layout);
  const repair = () => { setBusy(true); setError(null); api(`/api/entities/${node.id}/repair`, { method: 'POST', body: { baseId } }).then(r => onChanged?.(r)).catch(setError).finally(() => setBusy(false)); };
  return <div className="ni-parent relation-box">
    <small>{t('db.belongsTo')}</small>
    {!broken ? <b>★ {nodeName(byId[node.baseId], t)}</b> : <>
      <small className="stock-short">⚠ {t('ent.issue.missing_base')}</small>
      {canEdit && <><label>{t('ent.base')}<select value={baseId} onChange={e => setBaseId(e.target.value)}><option value="">—</option>{bases.map(b => <option key={b.id} value={b.id}>★ {nodeName(b, t)}</option>)}</select></label>
        <div className="relation-actions"><button type="button" className="approve" disabled={busy || !baseId} onClick={repair}>{t('ent.repair')}</button></div>
        <small className="ni-muted">{t('ent.repairHint')}</small></>}
      {error && <small className="form-error">{errText(t, error)}</small>}
    </>}
  </div>;
}
// إضافة مخزون خارجي لقاعدة (القائد فقط): القاعدة، الموارد والكميات، السبب/المرجع، مع الرصيد قبل وبعد
function AddStockModal({ layout, depots, inventory, presetBaseId, onClose, onDone }) {
  const { t } = useLang();
  const bases = layout.nodes.filter(n => n.type === 'main');
  const [baseId, setBaseId] = useState(presetBaseId || bases[0]?.id || ''), [qty, setQty] = useState({}), [reason, setReason] = useState(''), [error, setError] = useState(null), [busy, setBusy] = useState(false), [result, setResult] = useState(null);
  const cur = depots[baseId] || {}, cap = inventory[baseId]?.capacity || depotCapOf('main');
  const stockInfo = key => depotRoomInfo(baseId,key,depots,inventory);
  const toggleStock = key => setQty(v=>{const next={...v};if(key in next)delete next[key];else next[key]=null;return next;});
  const operationKey = useRef(newId('supply')), sending = useRef(false), lastPayload = useRef(null);
  const items = resources.filter(r=>r.key in qty).map(r => ({ resource: r.key, qty: qty[r.key]===null?stockInfo(r.key).room:Number(qty[r.key]), fill:qty[r.key]===null }));
  const invalid = items.some(i => !Number.isInteger(i.qty) || i.qty <= 0 || i.qty > stockInfo(i.resource).room);
  const submit = e => {
    e.preventDefault(); if (sending.current) return; setError(null);
    if (!items.length || invalid) return setError({ code: invalid ? 'over_capacity' : 'invalid_quantity' });
    if (!reason.trim()) return setError({ code: 'reason_required' });
    const supplyItems=items.map(i=>i.fill?{resource:i.resource,fill:true}:{resource:i.resource,qty:i.qty});
    const payload = JSON.stringify({ baseId, items:supplyItems, reason: reason.trim() });
    if (lastPayload.current && lastPayload.current !== payload) operationKey.current = newId('supply');
    lastPayload.current = payload; sending.current = true; setBusy(true);
    api('/api/inventory/add', { method: 'POST', body: { baseId, items:supplyItems, reason: reason.trim(), operationKey: operationKey.current } }).then(r => { setResult(r); onDone?.(); }).catch(setError).finally(() => { sending.current = false; setBusy(false); });
  };
  if (result) return <Modal title={t('stock.addTitle')} onClose={onClose}>
    <div className="req-banner delivered">✓ {t('stock.added', { op: result.opId })}</div>
    <table className="items-table"><thead><tr><th>{t('routes.type')}</th><th>{t('stock.before')}</th><th>{t('stock.added.col')}</th><th>{t('stock.after')}</th></tr></thead>
      <tbody>{result.movements.map(m => <tr key={m.id}><td>{resName(t, m.resource)}</td><td dir="ltr">{fmtQty(result.before[m.resource])}</td><td dir="ltr">+{fmtQty(m.qty)}</td><td dir="ltr"><b>{fmtQty(result.after[m.resource])}</b> {resUnitName(t, m.resource)}</td></tr>)}</tbody></table>
    <footer className="req-actions"><button className="approve" onClick={onClose}>{t('common.close')}</button></footer>
  </Modal>;
  return <Modal title={t('stock.addTitle')} onClose={onClose}>
    <form className="req-form" onSubmit={submit}>
      <label>{t('db.base')}<select value={baseId} onChange={e => {setBaseId(e.target.value);setQty(v=>Object.fromEntries(Object.keys(v).map(k=>[k,null])));}}>{bases.map(b => <option key={b.id} value={b.id}>★ {nodeName(b, t)}</option>)}</select></label>
      <table className="items-table stock-add"><thead><tr><th>{t('routes.type')}</th><th>{t('stock.before')}</th><th>{t('stock.qty')}</th><th>{t('stock.after')}</th></tr></thead>
        <tbody>{resources.map(r => { const x=stockInfo(r.key),selected=r.key in qty,q=selected?(qty[r.key]===null?x.room:Number(qty[r.key])):0, after=x.current+(Number.isFinite(q)?q:0),over=q>x.room;
          return <tr key={r.key}><td><label><input type="checkbox" checked={selected} disabled={x.room<=0} onChange={()=>toggleStock(r.key)}/>{r.icon} {resName(t, r.key)}</label><small>{resUnitName(t, r.key)}</small><StockRoomSummary info={x} resource={r.key}/></td><td dir="ltr">{fmtQty(cur[r.key] || 0)}</td>
            <td><FillQuantity value={selected?qty[r.key]:''} info={x} resource={r.key} onChange={value=>setQty(v=>({...v,[r.key]:value}))}/></td>
            <td dir="ltr" className={over ? 'bad' : ''}><b>{fmtQty(after)}</b><small> / {fmtQty(cap[r.key])}</small></td></tr>; })}</tbody></table>
      <label>{t('stock.reason')} *<input dir="auto" maxLength="300" value={reason} onChange={e => setReason(e.target.value)} placeholder={t('stock.reasonHint')}/></label>
      <small className="route-info">{t('stock.hint')}</small>
      {error && <span className="form-error">{errText(t, error)}{errDetail(t, error)}</span>}
      <footer><button type="button" className="reject" onClick={onClose}>{t('dash.cancel')}</button><button type="submit" className="approve" disabled={busy || !items.length || invalid || !reason.trim()}>{t('stock.add')}</button></footer>
    </form>
  </Modal>;
}

// مراجعة العلاقات (القائد): علاقات ناقصة أو ملتبسة أو مشتقة من الترحيل تحتاج تأكيد
function StructureReview({ layout, onChanged }) {
  const { t } = useLang();
  const list = layout.nodes.filter(n => needsReview(n, layout));
  if (!list.length) return null;
  return <section className="db-review"><h3>◔ {t('ent.reviewTitle')} <span>{list.length}</span></h3><p className="ni-muted">{t('ent.reviewHint')}</p>
    <div className="review-grid">{list.map(n => <article key={n.id} className="db-card"><h5>{entityIcon[n.type]} {nodeName(n, t)} <small>{n.unitId || n.id}</small></h5><RelationInfo node={n} layout={layout} canEdit onChanged={onChanged}/></article>)}</div>
  </section>;
}

// احتياج قاعدة: الأصناف والكميات والسبب؛ يزوّد القائد مستودعها عند الاعتماد.
// الحد الوحيد: سعة مستودع القاعدة بعد احتساب رصيده والشحنات المتجهة له.
function BaseRequestModal({ me, layout, depots, inventory, presetBaseId = null, onClose, onCreated }) {
  const { t } = useLang();
  const bases = layout.nodes.filter(n => n.type === 'main' && depots[n.id]);
  const [baseId, setBaseId] = useState(presetBaseId || (me.role === 'base_manager' ? me.baseId : bases[0]?.id) || '');
  const [qty, setQty] = useState({}), [notes, setNotes] = useState(''), [priority, setPriority] = useState('normal');
  const [error, setError] = useState(null), [busy, setBusy] = useState(false), sending = useRef(false);
  const inv = inventory[baseId] || {}, cur = depots[baseId] || {};
  const info = key => depotRoomInfo(baseId,key,depots,inventory);
  const toggleBaseItem=key=>setQty(v=>{const next={...v};if(key in next)delete next[key];else next[key]=null;return next;});
  const items = resources.filter(r=>r.key in qty).map(r => ({ resource: r.key, qty: qty[r.key]===null?info(r.key).room:Number(qty[r.key]), fill:qty[r.key]===null, info: info(r.key) }));
  const invalid = items.some(i => !Number.isInteger(i.qty) || i.qty <= 0 || i.qty > i.info.room);
  const submit = e => {
    e.preventDefault(); if (sending.current) return; setError(null);
    if (!items.length || invalid) return setError({ code: invalid ? 'invalid_quantity' : 'pick_one' });
    if (!notes.trim()) return setError({ code: 'reason_required' });
    sending.current = true; setBusy(true);
    api('/api/requests', { method: 'POST', body: { kind: 'base', baseId, items: items.map(i => i.fill?{resource:i.resource,fill:true}:{ resource: i.resource, qty: i.qty }), notes: notes.trim(), priority } })
      .then(r => { onCreated?.(r); onClose(); }).catch(err => { setError(err); setBusy(false); sending.current = false; });
  };
  return <Modal title={t('breq.title')} onClose={onClose} wide>
    <form className="req-form" onSubmit={submit}>
      <p className="ni-muted">◆ {t('breq.sub')}</p>
      <label>{t('db.base')}<select value={baseId} disabled={me.role !== 'admin'} onChange={e => {setBaseId(e.target.value);setQty(v=>Object.fromEntries(Object.keys(v).map(k=>[k,null])));}}>{bases.map(b => <option key={b.id} value={b.id}>★ {nodeName(b, t)}</option>)}</select></label>
      <table className="items-table stock-add"><thead><tr><th>{t('routes.type')}</th><th>{t('db.colCurrent')}</th><th>{t('db.colInTransit')}</th><th>{t('db.colCapacity')}</th><th>{t('stock.qty')}</th></tr></thead>
        <tbody>{resources.map(r => { const x = info(r.key),selected=r.key in qty,q=selected?(qty[r.key]===null?x.room:Number(qty[r.key])):0,bad=selected&&(!Number.isInteger(q)||q<=0||q>x.room);
          return <tr key={r.key}><td><label><input type="checkbox" checked={selected} disabled={x.room<=0} onChange={()=>toggleBaseItem(r.key)}/>{r.icon} {resName(t, r.key)}</label><small>{resUnitName(t, r.key)}</small></td><td dir="ltr">{fmtQty(x.current)}</td><td dir="ltr">{fmtQty(x.inTransit)}</td><td dir="ltr">{fmtQty(x.capacity)}</td>
            <td><FillQuantity value={selected?qty[r.key]:''} info={x} resource={r.key} onChange={value=>setQty(v=>({...v,[r.key]:value}))}/><small className={bad ? 'bad' : ''}>{x.room > 0 ? t('req.maxRoom', { n: fmtQty(x.room), unit: resUnitName(t, r.key) }) : t('breq.full')}</small></td></tr>; })}</tbody></table>
      <div className="req-grid">
        <label>{t('req.priority')}<select value={priority} onChange={e => setPriority(e.target.value)}>{PRIORITIES.map(p => <option key={p} value={p}>{priorityIcon[p]} {t(`priority.${p}`)}</option>)}</select></label>
      </div>
      <label>{t('breq.reason')} *<textarea dir="auto" rows="3" maxLength="1000" value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('breq.reasonHint')}/></label>
      {error && <span className="form-error">{errText(t, error)}{errDetail(t, error)}</span>}
      <footer><button type="button" className="reject" onClick={onClose}>{t('dash.cancel')}</button><button type="submit" className="approve" disabled={busy || !items.length || invalid || !notes.trim()}>{t('breq.submit')}</button></footer>
    </form>
  </Modal>;
}
