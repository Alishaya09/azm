// صفحة كتالوج الموارد (القائد فقط): إضافة صنف، تعديل اسمه ووحدة قياسه وسعاته ومعدل استهلاكه، وتعطيله.
// معدل الاستهلاك تجريبي للمحاكاة ويُطبق على الأصناف التشغيلية فقط (الغذاء والماء + نوع وقود الوحدة).
// ما فيه حذف — الصنف المعطّل يختفي من الطلبات الجديدة والمحاكاة، وتبقى سجلاته وحركاته في التقارير.
// السعات لازم تتدرج: مستودع القاعدة > مركز الإمداد > أكبر وحدة (الخادم يتحقق).
const BASES_OF_UNIT_CAP = ['people', 'vehicles', 'fixed'];
const emptyItem = () => ({ key: '', icon: '📦', name: { ar: '', en: '' }, unit: { ar: '', en: '' }, measure: '', active: true, usage: 'consumable', consumptionGroup: null, capacity: { main: '', fsb: '' }, unitBasis: 'people', unitFactor: '', weight: '1' });

function CatalogForm({ item, onClose, onSaved }) {
  const { t } = useLang();
  const editing = !!item;
  const [f, setF] = useState(() => item ? JSON.parse(JSON.stringify(item)) : emptyItem());
  const [error, setError] = useState(null), [busy, setBusy] = useState(false), sending = useRef(false);
  const set = (path, v) => setF(x => { const n = JSON.parse(JSON.stringify(x)); const ks = path.split('.'); let o = n; ks.slice(0, -1).forEach(k => o = o[k]); o[ks.at(-1)] = v; return n; });
  const submit = e => {
    e.preventDefault(); if (sending.current) return; sending.current = true; setBusy(true); setError(null);
    const body = { ...f, capacity: { main: Number(f.capacity.main), fsb: Number(f.capacity.fsb) }, unitFactor: Number(f.unitFactor), weight: Number(f.weight) };
    (editing ? api(`/api/catalog/${item.key}`, { method: 'PUT', body }) : api('/api/catalog', { method: 'POST', body }))
      .then(() => { onSaved(editing ? 'cat.saved' : 'cat.added'); onClose(); }).catch(err => { setError(err); setBusy(false); sending.current = false; });
  };
  const detail = error?.detail ? ` — ${Object.entries(error.detail).map(([k, v]) => `${t(`cat.cap.${k}`)} ${fmtQty(v)}`).join(' · ')}` : '';
  return <Modal title={editing ? t('cat.editTitle', { name: item.name?.[CURRENT_LANG] || item.key }) : t('cat.addTitle')} onClose={onClose} wide>
    <form className="req-form" onSubmit={submit}>
      <div className="req-grid">
        <label>{t('cat.key')}<input dir="ltr" value={f.key} disabled={editing} onChange={e => set('key', e.target.value.toLowerCase())} placeholder="water" required/><small className="ni-muted">{t('cat.keyHint')}</small></label>
        <label>{t('cat.icon')}<input dir="ltr" maxLength="4" value={f.icon} onChange={e => set('icon', e.target.value)}/></label>
        <label>{t('cat.nameAr')}<input dir="rtl" value={f.name.ar} onChange={e => set('name.ar', e.target.value)} required/></label>
        <label>{t('cat.nameEn')}<input dir="ltr" value={f.name.en} onChange={e => set('name.en', e.target.value)} required/></label>
        <label>{t('cat.unitAr')}<input dir="rtl" value={f.unit.ar} onChange={e => set('unit.ar', e.target.value)} required/></label>
        <label>{t('cat.unitEn')}<input dir="ltr" value={f.unit.en} onChange={e => set('unit.en', e.target.value)} required/></label>
        <label>{t('cat.capMain')}<input type="number" min="1" step="1" dir="ltr" value={f.capacity.main} onChange={e => set('capacity.main', e.target.value)} required/></label>
        <label>{t('cat.capFsb')}<input type="number" min="1" step="1" dir="ltr" value={f.capacity.fsb} onChange={e => set('capacity.fsb', e.target.value)} required/></label>
        <label>{t('cat.unitBasis')}<select value={f.unitBasis} onChange={e => set('unitBasis', e.target.value)}>{BASES_OF_UNIT_CAP.map(b => <option key={b} value={b}>{t(`cat.basis.${b}`)}</option>)}</select></label>
        <label>{t('cat.unitFactor')}<input type="number" min="0" step="any" dir="ltr" value={f.unitFactor} onChange={e => set('unitFactor', e.target.value)} required/></label>
        <label>{t('cat.usage')}<select value={f.usage || 'consumable'} onChange={e=>setF(v=>({...v,usage:e.target.value,weight:e.target.value==='maintenance'?0:v.weight}))}><option value="consumable">{t('cat.consumable')}</option><option value="maintenance">{t('cat.maintenance')}</option></select></label>
        <label>{t('cat.weight')}<input type="number" min="0" max="20" step="any" dir="ltr" value={f.weight} disabled={f.usage==='maintenance'} onChange={e => set('weight', e.target.value)} required/><small className="ni-muted">{t('cat.weightHint')}</small></label>
        <label>{t('cat.group')}<select value={f.consumptionGroup || ''} onChange={e=>set('consumptionGroup',e.target.value || null)}><option value="">{t('cat.groupNone')}</option><option value="vehicle_fuel">{t('cat.groupFuel')}</option></select><small>{t('cat.groupHint')}</small></label>
        <label className="cat-active"><input type="checkbox" checked={f.active} onChange={e => set('active', e.target.checked)}/> {t('cat.active')}</label>
      </div>
      <small className="route-info">{t('cat.capHint')}</small>
      {error && <span className="form-error">{errText(t, error)}{detail}</span>}
      <footer><button type="button" className="reject" onClick={onClose}>{t('dash.cancel')}</button><button type="submit" className="approve" disabled={busy}>{editing ? t('users.save') : t('cat.add')}</button></footer>
    </form>
  </Modal>;
}

function Catalog({ onChanged, onOpenUnits }) {
  const { t } = useLang();
  const [list, setList] = useState([]), [form, setForm] = useState(null), [notice, setNotice] = useState(null), [error, setError] = useState(null), [search, setSearch] = useState('');
  const load = () => api('/api/catalog').then(setList).catch(setError);
  useEffect(() => { load(); }, []);
  const toggle = c => { setNotice(null); setError(null); api(`/api/catalog/${c.key}`, { method: 'PUT', body: { active: !c.active } }).then(() => { setNotice(t(c.active ? 'cat.disabled' : 'cat.enabled')); load(); onChanged?.(); }).catch(setError); };
  const shown = list.filter(c => `${c.key} ${c.name?.ar || ''} ${c.name?.en || ''} ${(c.training?.aliases?.ar || []).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="page-pad catalog-page">
    <div className="page-heading"><h2>🧾 {t('cat.title')}</h2><small>{t('cat.sub')}</small><button className="approve add-user" onClick={() => setForm({})}>＋ {t('cat.addTitle')}</button></div>
    <div className="catalog-actions"><button type="button" onClick={onOpenUnits}>{t('cat.assign')}</button><small>{t('cat.assignHint')}</small></div>
    <div className="catalog-actions"><input aria-label={t('cat.search')} placeholder={t('cat.search')} value={search} onChange={e => setSearch(e.target.value)}/><small>{t('cat.count', { n: shown.length, total: list.length })}</small></div>
    {notice && <p className="form-notice">{notice}</p>}{error && <p className="form-error">{errText(t, error)}</p>}
    <div className="srep-scroll"><table className="srep-table cat-table"><thead><tr><th>{t('cat.item')}</th><th>{t('cat.unit')}</th><th>{t('cat.capMain')}</th><th>{t('cat.capFsb')}</th><th>{t('cat.unitCap')}</th><th>{t('cat.weight')}</th><th>{t('users.status')}</th><th/></tr></thead>
      <tbody>{shown.map(c => <tr key={c.key} className={c.active ? '' : 'archived'}>
        <td><b>{c.icon} {c.name.ar}</b><small>{c.name.en} · <code>{c.key}</code></small></td>
        <td>{c.unit.ar}<small>{c.unit.en}</small></td>
        <td dir="ltr">{fmtQty(c.capacity.main)}</td><td dir="ltr">{fmtQty(c.capacity.fsb)}</td>
        <td>{c.unitBasis === 'fixed' ? fmtQty(c.unitFactor) : `${t(`cat.basis.${c.unitBasis}`)} × ${c.unitFactor}`}</td>
        <td>{t(c.usage==='consumable'?'cat.consumable':'cat.maintenance')}<small>{t('cat.simRate')}: {c.weight} / {t(c.consumptionGroup==='vehicle_fuel'?'cat.groupFuel':'cat.groupNone')}</small></td>
        <td><span className={`status-badge ${c.active ? 'active' : 'suspended'}`}>{c.active ? t('cat.on') : t('cat.off')}</span></td>
        <td className="row-actions"><button onClick={() => setForm({ item: c })}>✎ {t('users.edit')}</button><button className={c.active ? 'warn' : ''} onClick={() => toggle(c)}>{c.active ? `⏸ ${t('cat.disable')}` : `▶ ${t('cat.enable')}`}</button></td>
      </tr>)}</tbody></table></div>
    <p className="ni-muted">{t('cat.note')}</p>
    {form && <CatalogForm item={form.item} onClose={() => setForm(null)} onSaved={k => { setNotice(t(k)); load(); onChanged?.(); }}/>}
  </div>;
}
