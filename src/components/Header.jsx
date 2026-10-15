// الشريط العلوي وشريط الحالة والتبويبات
function Header({ me, units, allUnits, layout, requests, speed, setSpeed, simHours = 0, onExit, onOpen, onRefresh, onHome }) {
  const { t } = useLang();
  // الإيقاف للقائد فقط؛ غيره يغيّر السرعة، وإذا أوقفها القائد تتعطل أزرارهم (والخادم يتحقق)
  const isAdmin = me.role === 'admin', lockedByCommander = !isAdmin && speed === 0;
  // أُزيلت من الشريط: وضع الطوارئ، SITREP، OPTECHO™، كيف يعمل؟، OPTEMPO، مستوى التهديد، ومؤشرات شريط الحالة (مكررة في لوحة التحكم)
  // الترتيب من اليمين: الحساب ← اللغة ← التحديث ← إعادة التشغيل ← الساعة وعداد المحاكاة
  const simText = `${String(Math.floor(simHours)).padStart(2,'0')}:${String(Math.floor((simHours%1)*60)).padStart(2,'0')}`;
  return <>
    <header className="topbar">
      {/* الشعار والاسم: الرجوع للوحة التحكم */}
      <div className="brand brand-home" role="button" tabIndex={0} title={t('header.home')} aria-label={t('header.home')} onClick={onHome} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onHome?.())}><AzmLogo className="brand-logo"/><div><b><span className="ar">عَزْم</span> | AZM</b><small>LOGISTICS COMMAND v2.0</small></div></div>
      <div className="top-time"><span className="clock">{new Date().toLocaleTimeString('en-GB')}</span><span className="sim-clock" title={t('sim.hint')}><small>{t('bot.sim')}</small><b>{simText}</b></span></div>
      {/* إعادة تحميل الواجهة بالكامل (بدون حذف أي بيانات): ترجع لوحة التحكم كأنها أول فتح */}
      <button className="restart-btn" onClick={() => window.location.reload()} title={t('header.restartHint')}>⟲ {t('header.restart')}</button>
      <button className="refresh-btn" onClick={onRefresh} title={t('common.refresh')}>↻ {t('common.refresh')}</button>
      <LangToggle/>
      <ProfileMenu me={me} allUnits={allUnits} layout={layout} onExit={onExit}/>
    </header>
    {/* شريط الحالة يحوي سرعات المحاكاة فقط، ولكل الأدوار (السرعة تطبّق على الجميع) */}
    <section className="statusbar">
      <div className="speeds" title={lockedByCommander ? t('sim.pausedByCommander') : undefined}><small>{lockedByCommander ? `⏸ ${t('sim.pausedByCommander')}` : t('status.speed')}</small>{(isAdmin ? [0,1,5,10,20] : [1,5,10,20]).map(x=><button className={speed===x?'selected':''} key={x} disabled={lockedByCommander} title={x===0?t('sim.pause'):undefined} onClick={()=>setSpeed(x)}>{x===0?'⏸':`×${x}`}</button>)}</div>
    </section>
  </>;
}

// قائمة الحساب: تفاصيل الحساب الحالي وتسجيل الخروج من نفس الخانة
function ProfileMenu({ me, allUnits, layout, onExit }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const outside = e => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', esc); };
  }, [open]);
  const baseNode = layout?.nodes.find(n => n.id === me.baseId);
  const scopeText = me.role === 'admin' ? t('role.adminFull') : me.role === 'base_manager' ? t('role.baseScope', { base: baseNode ? nodeName(baseNode, t) : (me.baseId || '—') }) : t('role.userScope', { unit: nameById(t, allUnits, me.unitId) });
  const rows = [['users.fullName', me.fullName || '—'], ['users.rank', me.rank ? t(`rank.${me.rank}`) : '—'], ['login.username', me.username], ['users.role', t(`role.${me.role}`)], ['header.scope', scopeText]];
  return <div className="profile-menu" ref={box}>
    <button className={`profile-btn ${me.role}${open ? ' open' : ''}`} onClick={() => setOpen(v => !v)} title={t('header.account')} aria-expanded={open}>👤</button>
    {open && <div className="profile-pop">
      <div className="profile-head"><b dir="auto">{me.fullName || me.username}</b><small>{t(`role.${me.role}`)}</small></div>
      <dl>{rows.map(([k, v]) => <React.Fragment key={k}><dt>{t(k)}</dt><dd dir="auto">{v}</dd></React.Fragment>)}</dl>
      <button className="profile-logout" onClick={onExit}>{t('header.logout')}</button>
    </div>}
  </div>;
}

function Nav({ tab, setTab, role, badges = {} }) { const { t } = useLang(); return <nav>{tabs.filter(([,,only])=>!only||only.includes(role)).map(([id,icon])=><button className={tab===id?'active':''} onClick={()=>setTab(id)} key={id}>{icon} {t(`tab.${id}`)}{badges[id] > 0 && <span className="nav-badge">{badges[id]}</span>}</button>)}</nav>; }
