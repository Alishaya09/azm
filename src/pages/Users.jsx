// صفحة إدارة المستخدمين: إحصائيات، طلبات الانضمام بانتظار الموافقة، وجدول الحسابات مع الإجراءات
const initials = u => (u.fullName || u.username).trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const rankName = (t, r) => r ? t(`rank.${r}`) : '—';
const STATUS_ICON = { active: '●', pending: '◔', suspended: '⏸', rejected: '✕' };
// الأدوار الثلاثة: مسؤول وحدة (user)، مسؤول قاعدة (base_manager)، القائد الرئيسي (admin)
const USER_ROLES = ['user', 'base_manager', 'admin'];
const userEntityActive = n => !n.archived && !n.deletedAt && (!n.status || n.status === 'active');
const userBaseOption = (t, b) => `${nodeName(b, t)} — ${b.code || b.id}`;
const userUnitOption = (t, u, bases) => `${unitName(t, u)} — ${u.code || u.id} — ${bases.find(b=>b.id===u.baseId) ? userBaseOption(t,bases.find(b=>b.id===u.baseId)) : u.baseId || '—'}`;
const userAssignmentValid = (role, unitId, baseId, units, bases) => role === 'admin' || (role === 'user' ? units.some(u=>u.id===unitId) : bases.some(b=>b.id===baseId));
function UserAssignmentSelect({ role, unitId, baseId, units, bases, onChange }) {
  const { t } = useLang();
  if (role === 'admin') return null;
  const isUnit = role === 'user', options = isUnit ? units : bases, value = isUnit ? unitId : baseId;
  return <label>{t(isUnit ? 'users.unit' : 'users.base')}<select data-user-assignment={role} required value={options.some(x=>x.id===value) ? value : ''} onChange={e=>onChange(isUnit ? 'unitId' : 'baseId',e.target.value)} disabled={!options.length}>
    <option value="">{t('users.chooseEntity')}</option>{options.map(x=><option key={x.id} value={x.id}>{isUnit ? userUnitOption(t,x,bases) : userBaseOption(t,x)}</option>)}
  </select>{!options.length ? <small className="form-error">{t(isUnit ? 'users.noActiveUnits' : 'users.noActiveBases')}</small> : value && !options.some(x=>x.id===value) ? <small className="form-error">{t('users.assignmentMissing')}</small> : null}</label>;
}
// قاعدة مسؤول الوحدة تُشتق من تبعية وحدته
const baseNameOfUnit = (t, units, bases, unitId) => { const u = units.find(x => x.id === unitId), b = u && bases.find(x => x.id === u.baseId); return b ? nodeName(b, t) : ''; };
function RoleSelect({ value, onChange }) { const { t } = useLang(); return <select value={value} onChange={e => onChange(e.target.value)}>{USER_ROLES.map(r => <option key={r} value={r}>{t(`role.${r}`)}</option>)}</select>; }

// نموذج إضافة مستخدم أو تعديل ملفه (المسؤول)
function UserForm({ user, allUnits, bases, onClose, onSaved }) {
  const { t } = useLang();
  const editing = !!user;
  const [f, setF] = useState({ username: user?.username || '', password: '', fullName: user?.fullName || '', rank: user?.rank || 'lt', serviceId: user?.serviceId || '', position: user?.position || '', phone: user?.phone || '', role: user?.role || 'user', unitId: user?.unitId || '', baseId: user?.baseId || '' });
  const [error, setError] = useState(null), [busy, setBusy] = useState(false), sending = useRef(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  // إنشاء حساب نشط مباشرة (القائد) — الرسالة تظهر بعد تأكيد الخادم فقط، والضغط المتكرر ما يرسل مرتين
  const submit = e => {
    e.preventDefault(); if (sending.current || !userAssignmentValid(f.role,f.unitId,f.baseId,allUnits,bases)) return; sending.current = true; setBusy(true); setError(null);
    const body = { fullName: f.fullName, rank: f.rank, serviceId: f.serviceId, position: f.position, phone: f.phone, role: f.role, unitId: f.role === 'user' ? f.unitId : null, baseId: f.role === 'base_manager' ? f.baseId : null };
    const req = editing ? api(`/api/users/${user.username}`, { method: 'PUT', body: { ...body, ...(f.password ? { password: f.password } : {}) } })
      : api('/api/users', { method: 'POST', body: { ...body, username: f.username, password: f.password } });
    req.then(u => { onSaved(editing ? 'users.saved' : 'users.created', u); onClose(); }).catch(err => { setError(err); setBusy(false); sending.current = false; });
  };
  return <Modal title={editing ? t('users.editTitle', { name: user.fullName || user.username }) : t('users.addTitle')} onClose={onClose}>
    <form className="req-form" onSubmit={submit}>
      <div className="req-grid">
        <label>{t('users.fullName')}<input dir="auto" value={f.fullName} onChange={e => set('fullName', e.target.value)} required/></label>
        <label>{t('users.rank')}<select value={f.rank} onChange={e => set('rank', e.target.value)}>{RANKS.map(r => <option key={r} value={r}>{t(`rank.${r}`)}</option>)}</select></label>
        <label>{t('users.serviceId')}<input dir="ltr" inputMode="numeric" value={f.serviceId} onChange={e => set('serviceId', e.target.value.replace(/\D/g, ''))}/></label>
        <label>{t('users.phone')}<input dir="ltr" inputMode="tel" value={f.phone} onChange={e => set('phone', e.target.value)}/></label>
        <label>{t('users.position')}<input dir="auto" value={f.position} onChange={e => set('position', e.target.value)}/></label>
        <label>{t('users.role')}<RoleSelect value={f.role} onChange={v => set('role', v)}/></label>
        <UserAssignmentSelect role={f.role} unitId={f.unitId} baseId={f.baseId} units={allUnits} bases={bases} onChange={set}/>
        <label>{t('login.username')}<input dir="ltr" value={f.username} disabled={editing} onChange={e => set('username', e.target.value)} autoComplete="off" required/></label>
        <label>{editing ? t('users.newPassword') : t('users.password')}<input type="password" dir="ltr" value={f.password} onChange={e => set('password', e.target.value)} autoComplete="new-password" required={!editing}/></label>
      </div>
      {error && <span className="form-error">{errText(t, error)}</span>}
      <footer><button type="button" className="reject" onClick={onClose}>{t('dash.cancel')}</button><button type="submit" className="approve" disabled={busy || !userAssignmentValid(f.role,f.unitId,f.baseId,allUnits,bases)}>{editing ? t('users.save') : t('users.add')}</button></footer>
    </form>
  </Modal>;
}

// بطاقة طلب انضمام بانتظار الموافقة
// unitOnly: مسؤول القاعدة يوافق كمسؤول وحدة فقط ولوحدات قاعدته (والخادم يتحقق)
function PendingCard({ u, allUnits, bases, run, unitOnly = false }) {
  const { t } = useLang();
  const [role, setRole] = useState(unitOnly ? 'user' : u.role || 'user'), [unitId, setUnitId] = useState(u.unitId || ''), [baseId, setBaseId] = useState(u.baseId || ''), [rejecting, setRejecting] = useState(false), [reason, setReason] = useState('');
  return <article className="pending-card">
    <header><span className="avatar pending">{initials(u)}</span><div><b dir="auto">{u.fullName}</b><small>{rankName(t, u.rank)} · <bdi dir="ltr">@{u.username}</bdi></small></div><span className="status-badge pending">{STATUS_ICON.pending} {t('ustatus.pending')}</span></header>
    <dl className="req-info">
      <dt>{t('users.serviceId')}</dt><dd dir="ltr">{u.serviceId || '—'}</dd>
      <dt>{t('users.requestedUnit')}</dt><dd>{u.unitId ? `${u.unitId} — ${nameById(t, allUnits, u.unitId)}` : '—'}</dd>
      <dt>{t('users.phone')}</dt><dd dir="ltr">{u.phone || '—'}</dd>
      <dt>{t('users.position')}</dt><dd dir="auto">{u.position || '—'}</dd>
      <dt>{t('users.requestedAt')}</dt><dd>{fmtDateTime(u.createdAt)}</dd>
    </dl>
    {u.note && <p dir="auto" className="req-notes">{u.note}</p>}
    {rejecting
      ? <div className="reject-box"><label>{t('users.rejectReason')}<textarea dir="auto" rows="2" value={reason} onChange={e => setReason(e.target.value)}/></label><footer><button className="reject" onClick={() => setRejecting(false)}>{t('dash.cancel')}</button><button className="danger" onClick={() => run(api(`/api/users/${u.username}/reject`, { method: 'POST', body: { reason } }), 'users.rejectedMsg')}>{t('users.confirmReject')}</button></footer></div>
      : <footer className="pending-actions">
          {!unitOnly && <RoleSelect value={role} onChange={setRole}/>}
          <UserAssignmentSelect role={role} unitId={unitId} baseId={baseId} units={allUnits} bases={bases} onChange={(k,v)=>k==='unitId'?setUnitId(v):setBaseId(v)}/>
          <button className="approve" disabled={!userAssignmentValid(role,unitId,baseId,allUnits,bases)} onClick={() => run(api(`/api/users/${u.username}/approve`, { method: 'POST', body: { role, unitId: role === 'user' ? unitId : null, baseId: role === 'base_manager' ? baseId : null } }), 'users.approvedMsg')}>✓ {t('users.approve')}</button>
          <button className="reject" onClick={() => setRejecting(true)}>✕ {t('users.rejectBtn')}</button>
        </footer>}
  </article>;
}

// القائد: كل الحسابات وكل الإجراءات. مسؤول القاعدة: حسابات قاعدته فقط (الخادم يرسلها مفلترة)،
// يوافق/يرفض طلبات الانضمام لوحداته ويوقف/يفعّل مسؤولي وحداته؛ بلا إضافة أو تعديل أو حذف.
function Users({ me, allUnits, layout, onChanged }) {
  const { t } = useLang();
  const isAdmin = me.role === 'admin';
  const canToggle = u => isAdmin || u.role === 'user';
  const bases = layout.nodes.filter(n => n.type === 'main' && userEntityActive(n));
  allUnits = allUnits.filter(u=>userEntityActive(u) && bases.some(b=>b.id===u.baseId));
  const [list, setList] = useState([]), [error, setError] = useState(null), [notice, setNotice] = useState(null);
  const [filter, setFilter] = useState('all'), [query, setQuery] = useState(''), [form, setForm] = useState(null);
  const load = () => api('/api/users').then(setList).catch(setError);
  useEffect(() => { load(); }, [layout]);
  // الرسالة تظهر بعد نجاح الخادم فقط، والخطأ الحقيقي يظهر كما هو
  const run = (p, msg = 'users.saved') => { setError(null); setNotice(null); return p.then(() => { setNotice(t(msg)); load(); onChanged?.(); }).catch(e => { setError(e); load(); }); };
  const count = s => list.filter(u => u.status === s).length;
  const q = query.trim().toLowerCase();
  const shown = list.filter(u => (filter === 'all' || u.status === filter) && u.status !== (filter === 'all' ? 'pending' : '') &&
    (!q || [u.username, u.fullName, u.serviceId, u.position].some(v => v && String(v).toLowerCase().includes(q))));
  const pending = list.filter(u => u.status === 'pending');
  const remove = u => { if (confirm(t('users.deleteConfirm', { name: u.fullName || u.username }))) run(api(`/api/users/${u.username}`, { method: 'DELETE' }), 'users.deletedMsg'); };
  const toggle = u => run(api(`/api/users/${u.username}/${u.status === 'active' ? 'suspend' : 'activate'}`, { method: 'POST' }), u.status === 'active' ? 'users.suspendedMsg' : 'users.activatedMsg');
  const filters = [['all', t('common.all'), list.length - count('pending')], ['active', t('ustatus.active'), count('active')], ['pending', t('ustatus.pending'), count('pending')], ['suspended', t('ustatus.suspended'), count('suspended')], ['rejected', t('ustatus.rejected'), count('rejected')]];
  return <div className="page-pad users-page">
    <div className="page-heading"><h2>{t('users.title')}</h2><small>{t(isAdmin ? 'users.sub' : 'users.subBase')}</small>{isAdmin && <button className="approve add-user" onClick={() => setForm({})}>{t('users.add')}</button>}</div>
    <div className="user-stats">
      <div><b>{list.length}</b><small>{t('users.total')}</small></div>
      <div className="green"><b>{count('active')}</b><small>{t('ustatus.active')}</small></div>
      <div className="amber"><b>{count('pending')}</b><small>{t('users.pendingReq')}</small></div>
      <div className="red"><b>{count('suspended')}</b><small>{t('ustatus.suspended')}</small></div>
    </div>
    {error && <p className="form-error">{errText(t, error)}</p>}{notice && <p className="form-notice">{notice}</p>}
    {pending.length > 0 && filter !== 'pending' && <section className="pending-section"><h3>◔ {t('users.pendingTitle')} <span>{pending.length}</span></h3><div className="pending-grid">{pending.map(u => <PendingCard key={u.username} u={u} allUnits={allUnits} bases={bases} run={run} unitOnly={!isAdmin}/>)}</div></section>}
    <div className="user-toolbar">
      <div className="filter-chips">{filters.map(([id, label, n]) => <button key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{label} <span>{n}</span></button>)}</div>
      <input className="user-search" dir="auto" placeholder={t('users.search')} value={query} onChange={e => setQuery(e.target.value)}/>
    </div>
    {filter === 'pending'
      ? <div className="pending-grid">{pending.length ? pending.map(u => <PendingCard key={u.username} u={u} allUnits={allUnits} bases={bases} run={run} unitOnly={!isAdmin}/>) : <p className="empty">{t('users.noPending')}</p>}</div>
      : <div className="users-table-wrap"><table className="users-table"><thead><tr><th>{t('users.member')}</th><th>{t('users.serviceId')}</th><th>{t('users.responsibility')}</th><th>{t('users.role')}</th><th>{t('users.status')}</th><th>{t('users.lastLogin')}</th><th/></tr></thead>
        <tbody>{shown.map(u => { const self = u.username === me.username;
          return <tr key={u.username} data-username={u.username} className={u.status}>
            <td><div className="member"><span className={`avatar ${u.role}`}>{initials(u)}</span><div><b dir="auto">{u.fullName || u.username}{self && <em> {t('users.you')}</em>}</b><small>{rankName(t, u.rank)}{u.position ? ` · ${u.position}` : ''} · <bdi dir="ltr">@{u.username}</bdi></small></div></div></td>
            <td dir="ltr">{u.serviceId || '—'}</td>
            <td>{u.role === 'admin' ? <span className="muted">{t('users.allUnits')}</span> : u.role === 'base_manager' ? <>{bases.find(b=>b.id===u.baseId) ? userBaseOption(t,bases.find(b=>b.id===u.baseId)) : u.baseId || '—'}</> : <>{allUnits.find(x=>x.id===u.unitId) ? userUnitOption(t,allUnits.find(x=>x.id===u.unitId),bases) : u.unitId || '—'}</>}{u.assignmentValid === false && <small className="form-error">{t('users.assignmentMissing')}</small>}</td>
            <td><span className={`role-badge ${u.role}`}>{t(`role.${u.role}`)}</span></td>
            <td><span className={`status-badge ${u.status}`}>{STATUS_ICON[u.status]} {t(`ustatus.${u.status}`)}</span>{u.status === 'rejected' && u.rejectReason && <small dir="auto">{u.rejectReason}</small>}</td>
            <td>{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : <span className="muted">{t('users.never')}</span>}</td>
            <td className="row-actions">
              {isAdmin && <button onClick={() => setForm({ user: u })}>✎ {t('users.edit')}</button>}
              {!self && canToggle(u) && (u.status === 'active' || u.status === 'suspended') && <button className={u.status === 'active' ? 'warn' : ''} onClick={() => toggle(u)}>{u.status === 'active' ? `⏸ ${t('users.suspend')}` : `▶ ${t('users.activate')}`}</button>}
              {!self && isAdmin && <button className="reject" onClick={() => remove(u)}>{t('users.delete')}</button>}
            </td></tr>; })}
          {!shown.length && <tr><td colSpan="7" className="empty">{t('users.noResults')}</td></tr>}</tbody></table></div>}
    {form && <UserForm user={form.user} allUnits={allUnits} bases={bases} onClose={() => setForm(null)} onSaved={msg => { setError(null); setNotice(t(msg)); load(); onChanged?.(); }}/>}
  </div>;
}
