// شاشة تسجيل الدخول + طلب حساب جديد (يحتاج موافقة المسؤول)
function Login({ onEnter }) {
  const { t } = useLang();
  const [mode, setMode] = useState('login'); // login | register | sent
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [error, setError] = useState(null), [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(new Date());
  const submit = e => {
    e.preventDefault(); if (busy) return;
    setBusy(true); setError(null);
    api('/api/login', { method: 'POST', body: { username: username.trim(), password } }).then(onEnter).catch(err => { setError(err); setBusy(false); });
  };
  useEffect(() => { const id = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(id); }, []);
  return <div className="login-screen">
    <div className="scanlines" />
    <div className="sysbar"><span>SYSTEMS ONLINE <b className="online-dot" /></span><span>ENC: AES-256</span><span>NET: SECURE</span><strong>◆ RESTRICTED ACCESS ◆</strong><span>NODE: CENTRAL-01</span><span>{clock.toLocaleTimeString('en-GB')}</span><LangToggle/></div>
    <Radar />
    <i className="corner tl"/><i className="corner tr"/><i className="corner bl"/><i className="corner br"/>
    <main className={`login-wrap ${mode === 'register' ? 'wide' : ''}`}>
      <div className="emblem"><AzmLogo/></div>
      <h1><span className="ar">عَزْم</span> <span>|</span> AZM</h1>
      <p className="tagline">{t('app.tagline')}</p>
      <div className="login-card">
        {mode === 'login' && <>
          <h2>{t('login.title')}</h2><p>{t('login.subtitle')}</p>
          <form className="password-panel" onSubmit={submit}>
            <input autoComplete="username" placeholder={t('login.username')} value={username} onChange={e => setUsername(e.target.value)} dir="ltr" autoFocus/>
            <input type="password" autoComplete="current-password" placeholder={t('login.password')} value={password} onChange={e => setPassword(e.target.value)} dir="ltr"/>
            {error && <span className="form-error">{errText(t, error)}{error.reason ? ` — ${error.reason}` : ''}</span>}
            <button type="submit" disabled={busy || !username || !password}>{busy ? t('login.loading') : t('login.title')}</button>
          </form>
          <p className="login-switch">{t('reg.noAccount')} <button type="button" onClick={() => { setMode('register'); setError(null); }}>{t('reg.requestAccount')}</button></p>
        </>}
        {mode === 'register' && <RegisterForm onBack={() => setMode('login')} onSent={() => setMode('sent')}/>}
        {mode === 'sent' && <div className="reg-sent">
          <span>✓</span><h2>{t('reg.sentTitle')}</h2><p>{t('reg.sentBody')}</p>
          <button type="button" onClick={() => setMode('login')}>{t('reg.backToLogin')}</button>
        </div>}
      </div>
      <div className="classified"><span>RESTRICTED</span><span>v2.0</span></div>
    </main>
    <footer className="login-footer"><span>NODES <b>12/12</b> ONLINE</span><span>OPTEMPO <b>MODERATE</b></span><span>OPTECHO™ <b>ACTIVE</b></span><span>ENCRYPTION <b>AES-256</b></span><span>AZM BUILD <b>2025.03.31</b></span></footer>
  </div>;
}

// نموذج طلب حساب جديد: الحساب يُنشأ معلّق لين يوافق عليه المسؤول
function RegisterForm({ onBack, onSent }) {
  const { t } = useLang();
  // قائمة الوحدات ما تنكشف بدون دخول: طالب الحساب يكتب رمز وحدته (من مسؤوله) والخادم يتحقق منه
  const [f, setF] = useState({ fullName: '', rank: 'lt', serviceId: '', phone: '', position: '', unitId: '', username: '', password: '', confirm: '', note: '' });
  const [error, setError] = useState(null), [busy, setBusy] = useState(false), sending = useRef(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const submit = e => {
    e.preventDefault(); if (sending.current) return;
    if (f.password !== f.confirm) return setError({ code: 'password_mismatch' });
    sending.current = true; setBusy(true); setError(null);
    // طلب تسجيل فقط: الحساب ينشأ معلّق بدور مسؤول وحدة، والقائد يحدد الدور والجهة عند الموافقة
    const { confirm, ...body } = f;
    api('/api/register', { method: 'POST', body: { ...body, username: f.username.trim() } }).then(onSent).catch(err => { setError(err); setBusy(false); sending.current = false; });
  };
  return <form className="register-form" onSubmit={submit}>
    <h2>{t('reg.title')}</h2><p>{t('reg.subtitle')}</p>
    <div className="reg-grid">
      <label className="span2">{t('users.fullName')}<input dir="auto" value={f.fullName} onChange={e => set('fullName', e.target.value)} required autoFocus/></label>
      <label>{t('users.rank')}<select value={f.rank} onChange={e => set('rank', e.target.value)}>{RANKS.map(r => <option key={r} value={r}>{t(`rank.${r}`)}</option>)}</select></label>
      <label>{t('users.serviceId')}<input dir="ltr" inputMode="numeric" value={f.serviceId} onChange={e => set('serviceId', e.target.value.replace(/\D/g, ''))} required/></label>
      <label>{t('reg.unitCode')}<input dir="ltr" value={f.unitId} onChange={e => set('unitId', e.target.value)} placeholder="UNIT-05 / AZM-B-0001-U-001" required/><small className="ni-muted">{t('reg.unitCodeHint')}</small></label>
      <label>{t('users.phone')}<input dir="ltr" inputMode="tel" value={f.phone} onChange={e => set('phone', e.target.value)} placeholder="05xxxxxxxx"/></label>
      <label className="span2">{t('users.position')}<input dir="auto" value={f.position} onChange={e => set('position', e.target.value)}/></label>
      <label>{t('login.username')}<input dir="ltr" autoComplete="username" value={f.username} onChange={e => set('username', e.target.value)} required/></label>
      <label>{t('users.password')}<input type="password" dir="ltr" autoComplete="new-password" value={f.password} onChange={e => set('password', e.target.value)} required/></label>
      <label className="span2">{t('reg.confirm')}<input type="password" dir="ltr" autoComplete="new-password" value={f.confirm} onChange={e => set('confirm', e.target.value)} required/></label>
      <label className="span2">{t('reg.note')}<textarea dir="auto" rows="2" maxLength="500" value={f.note} onChange={e => set('note', e.target.value)} placeholder={t('reg.notePlaceholder')}/></label>
    </div>
    <small className="reg-hint">{t('reg.hint')}</small>
    {error && <span className="form-error">{errText(t, error)}</span>}
    <div className="reg-actions"><button type="button" className="back" onClick={onBack}>{t('reg.backToLogin')}</button><button type="submit" disabled={busy}>{busy ? t('login.loading') : t('reg.submit')}</button></div>
  </form>;
}

function Radar() {
  return <div className="radar"><div className="radar-grid"/><div className="radar-ring r1"/><div className="radar-ring r2"/><div className="radar-ring r3"/><div className="radar-cross h"/><div className="radar-cross v"/><div className="sweep"/><b className="blip b1"/><b className="blip b2"/><b className="blip b3"/><span className="north">N</span><span className="south">S</span></div>;
}
