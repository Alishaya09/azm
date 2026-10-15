// المساعد الذكي العائم
// شعار المساعد الذكي: شريحة معالج مكتوب عليها AI مع لمعة — يرمز للذكاء الاصطناعي بوضوح
const AiLogo = ({ size = 26 }) => <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
  <defs><linearGradient id="aiChip" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f2f6ff"/><stop offset="1" stopColor="#7fb0ff"/></linearGradient></defs>
  <g stroke="#c9dbff" strokeWidth="1.4" strokeLinecap="round">
    <path d="M9 2.5v2.5M12 2.5v2.5M15 2.5v2.5M9 19v2.5M12 19v2.5M15 19v2.5M2.5 9h2.5M2.5 12h2.5M2.5 15h2.5M19 9h2.5M19 12h2.5M19 15h2.5"/>
  </g>
  <rect x="5" y="5" width="14" height="14" rx="3.2" fill="url(#aiChip)"/>
  <text x="12" y="15.1" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight="800" fontSize="7.4" fill="#0f2547" letterSpacing=".2">AI</text>
  <path fill="#ffffff" d="M18.6 1.2c.15 1.1.65 1.6 1.75 1.75-1.1.15-1.6.65-1.75 1.75-.15-1.1-.65-1.6-1.75-1.75 1.1-.15 1.6-.65 1.75-1.75z"/>
</svg>;

// أيقونات خطية بأسلوب واجهات المحادثة الحديثة
const Icon = ({ d, size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d.map((p, i) => <path key={i} d={p}/>)}</svg>;
const icons = {
  newChat: ['M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7', 'M18.4 2.6a2.1 2.1 0 1 1 3 3L12 15l-4 1 1-4Z'],
  history: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5', 'M12 7v5l4 2'],
  close: ['M18 6 6 18', 'M6 6l12 12'],
  expand: ['M15 3h6v6', 'M9 21H3v-6', 'M21 3l-7 7', 'M3 21l7-7'],
  shrink: ['M4 14h6v6', 'M20 10h-6V4', 'M14 10l7-7', 'M3 21l7-7'],
  send: ['M12 19V5', 'M5 12l7-7 7 7'],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6'],
  chat: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
};
const aiSizeKey = 'azm-ai-expanded';

// إرسال رسالة مع بث الرد أثناء كتابته (NDJSON من /api/chats). نفس هوية التبويب والكوكي مثل api().
// إذا رجع الخادم JSON عادي (البث غير متاح) نستخدمه كما هو.
const streamChat = async (path, text, onDelta) => {
  await azmTabReady;
  const epoch = azmAuthEpoch;
  const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'X-Azm-Tab': azmTabId, 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, body: JSON.stringify({ text }) });
  const fail = (code, extra = {}) => { const e = new Error(code); Object.assign(e, extra, { status: r.status, code }); return e; };
  if (!r.ok || !r.body || !/x-ndjson/i.test(r.headers.get('content-type') || '')) {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw fail(data.error || 'error', data);
    return data;
  }
  const reader = r.body.getReader(), decoder = new TextDecoder();
  let buf = '', chat = null;
  const handle = line => {
    if (!line.trim()) return;
    let ev; try { ev = JSON.parse(line); } catch { return; }
    if (ev.type === 'delta' && typeof ev.text === 'string') onDelta(ev.text);
    else if (ev.type === 'reset') onDelta(null);
    else if (ev.type === 'done') chat = ev.chat;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let at;
    while ((at = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, at)); buf = buf.slice(at + 1); }
  }
  handle(buf);
  if (epoch !== azmAuthEpoch) throw fail('bad_request');
  if (!chat) throw fail('ai_error');
  return chat;
};

// المساعد الذكي: زر دائري عائم يفتح نافذة محادثة، والمحادثات محفوظة على الخادم لكل مستخدم
// مسؤول الوحدة يكتب طلب إمداد في المحادثة («ابي ديزل 1000»، «نحتاج موية»): تنفتح نافذة الطلب ويكمل فيها الاستخراج بالأدابتر.
// يبدأ بفعل طلب، وما فيه كلمة سؤال؛ «ابي اعرف كم الديزل» يبقى سؤالاً للمساعد.
const REQUEST_INTENT = /^(ابي|أبي|ابغى|أبغى|ابغي|ابغا|أبغا|نبي|نبغى|نبغي|نبغا|نبا|نحتاج|احتاج|أحتاج|محتاجين|محتاج|اطلب|أطلب|بطلب|بنطلب|ودي|ودنا|عطني|اعطني|أعطني|عطنا|اعطنا|أعطنا|عطونا|اعطونا|أعطونا|ارسلوا|أرسلوا|ارسل|أرسل|ابعثوا|ابعث|زودونا|زودني|وفروا|وفرو|ناقصنا|نقصنا|ناقصين|ناقصني|نقصني|ناقص|نقص)(\s|$)/;
const QUESTION_WORD = /(^|\s)(كم|وش|ايش|إيش|شنو|هل|متى|وين|ليش|كيف|اعرف|أعرف|اشوف|أشوف|حالة|وضع)(\s|$)|[؟?]/;
// وطلب معلومة («ابي احداثيات»، «ابي تقرير») يبقى للمساعد: لازم الطلب يذكر رقماً أو مورداً، وما يكون عن معلومة
// «عطني موارد القاعده» / «ابي مخزون وحدتي» سؤال عن الأرصدة، مو طلب
const INFO_WORD = /(احد?اثي|إحداثي|موقع|مكان|تقرير|ملخص|سجل|صلاحي|رتبت|اسمي|حساب|خريط|مسار|شرح|معلومة|معلومات|مخزون|رصيد|ارصد|أرصد|قاعدت|وحدتي|وحدتنا|(موارد|مواد|اغراض|أغراض)\s+(ال)?(قاعد|وحد))/;
const SUPPLY_HINT = /\d|[٠-٩]|موارد|مواد|مؤون|مؤن|مون[ةه]|اغراض|أغراض|تزويد|احتياج|لوازم|مستلزم|معدات|تجهيز|امداد|إمداد|تموين|موي|مويه|ماء|مياه|اكل|أكل|وجب|ارزاق|أرزاق|ديزل|بنزين|وقود|زيت|تمر|رز|معلب|خيام|خيم|خيمة|اسعاف|إسعاف|ذخير|قطع غيار|كفرات|بطاري|رمل|مصباح|كشاف|خوذ|نقال|فلتر|شحم|قريس|سولار|كفر|تاير|اطار|إطار/;
const namesResource = msg => (typeof resources !== 'undefined' ? resources : []).some(r => [r.name?.ar, r.name?.en].some(n => n && n.split(/\s+/).some(w => w.length >= 3 && msg.includes(w))));
// «ابي اطلب» / «ابي اسوي طلب» بدون أصناف: تنفتح نافذة الطلب فاضية ليكتب فيها
const ORDER_WORD = /(اطلب|أطلب|بطلب|بنطلب|طلب جديد|طلب امداد|طلب إمداد|اسوي طلب|أسوي طلب|ارفع طلب|أرفع طلب|نطلب)/;
// يبدأ باسم صنف وفيه كمية بدون فعل طلب: «ديزل 1000 لتر مويه 200 لتر»، «25 كيس رمل»
const SUPPLY_WORD = new RegExp(SUPPLY_HINT.source.replace('\\d|[٠-٩]|', ''));
const ITEM_FIRST = msg => /\d|[٠-٩]/.test(msg) && (head => SUPPLY_WORD.test(head) || namesResource(head))(msg.trim().split(/\s+/).slice(0, 3).join(' '));
// «ناقص وحدتنا … مويه 2000 لتر»: ذكر الوحدة مع كمية ما يخلي الرسالة سؤالاً عن مخزونها
const infoText = msg => /\d|[٠-٩]/.test(msg) ? msg.replace(/وحدت(ي|نا)/g, ' ') : msg;
const isSupplyRequest = (me, msg) => me?.role === 'user' && !QUESTION_WORD.test(msg) && !INFO_WORD.test(infoText(msg))
  && ((REQUEST_INTENT.test(msg) && (SUPPLY_HINT.test(msg) || namesResource(msg) || ORDER_WORD.test(msg))) || ITEM_FIRST(msg));
const hasItems = msg => SUPPLY_HINT.test(msg.replace(ORDER_WORD, ' ')) || namesResource(msg);
// الطلب يُصاغ في المحادثة أولاً: الأصناف والكميات، وسؤال عن الناقص. بعد «تمام» تنفتح نافذة الطلب معبّأة بنفس المسودة
const CONFIRM = /^(تمام|تم|اوكي|أوكي|اوك|ok|okay|yes|نعم|ايه|إيه|ايوه|أيوه|اي|أكيد|اكيد|موافق|اعتمد|اعتمده|كمل|يلا|صح|ضبط|زين|ارسله|أرسله|افتح|افتحه|افتحها)(\s+(تمام|كذا|الطلب|ارسله|أرسله|افتحه|افتحها|يلا|ضبط))*\s*[.!]*$/i;
const CANCEL = /^(الغ|ألغ|إلغ|الغاء|إلغاء|كنسل|لا خلاص|خلاص لا|لا ما ابي|لا ما أبي|لا ما نبي|cancel)/i;
const usableItems = d => (d?.items || []).filter(i => i.requestable !== false && i.resource);

function Assistant({ me, onDraft }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false), [list, setList] = useState([]), [chat, setChat] = useState(null), [showHistory, setShowHistory] = useState(false);
  const [expanded, setExpanded] = useState(() => { try { return localStorage.getItem(aiSizeKey) === '1'; } catch { return false; } });
  const [text, setText] = useState(''), [sending, setSending] = useState(null), [error, setError] = useState(null), [live, setLive] = useState('');
  const [ai, setAi] = useState({ connected: false, model: null });
  const sendLock = useRef(false);
  const [flow, setFlow] = useState([]), [pending, setPending] = useState(null), [flowBusy, setFlowBusy] = useState(false);
  const addFlow = (role, text) => setFlow(f => [...f, { role, text }]);
  const uomName = k => dict[`uom.${k}`] ? t(`uom.${k}`) : k;
  const draftText = d => {
    const ok = usableItems(d), notUnit = d.items.filter(i => i.requestable === false).map(i => t('ai.flow.notUnit', { res: resName(t, i.resource) }));
    if (!ok.length) return [...notUnit, t('ai.flow.none')].join('\n');
    const ask = ok.filter(i => i.quantity == null).map(i => t('ai.flow.qty', { res: resName(t, i.resource) }));
    return [t('ai.flow.draft'), ...ok.map(i => `- ${resName(t, i.resource)}: ${i.quantity == null ? '؟' : `${i.quantity} ${uomName(i.unit || '')}`.trim()}`),
      d.priority ? t('ai.flow.priority', { p: t(`priority.${d.priority}`) }) : t('ai.flow.priorityDefault'),
      ...(d.deadline ? [t('ai.flow.deadline', { d: dict[`deadline.${d.deadline}`] ? t(`deadline.${d.deadline}`) : d.deadline })] : []),
      ...notUnit, '', ...(ask.length ? ask : [t('ai.flow.confirm')])].join('\n');
  };
  const draftFlow = txt => { setFlowBusy(true);
    api('/api/ai/request-draft', { method: 'POST', body: { text: txt, unitId: me.unitId } })
    .then(r => { setPending({ text: txt, draft: usableItems(r.draft).length ? r.draft : null }); addFlow('bot', draftText(r.draft)); })
    .catch(e => { setPending({ text: txt, draft: null }); addFlow('bot', t(e?.code === 'ai_not_connected' ? 'ai.flow.offline' : 'ai.flow.error')); })
    .finally(() => setFlowBusy(false)); };
  // يرجع true إذا الرسالة جزء من صياغة الطلب (ما تروح لنموذج المحادثة)
  const requestFlow = msg => {
    if (!onDraft || me?.role !== 'user') return false;
    if (pending && CANCEL.test(msg)) { setText(''); addFlow('user', msg); addFlow('bot', t('ai.flow.cancel')); setPending(null); return true; }
    if (pending && CONFIRM.test(msg)) { const p = pending; setText(''); setFlow([]); setPending(null); setOpen(false);
      onDraft({ unitId: me.unitId, sourceText: p.text, autoExtract: !!p.text && !p.draft, ...(p.draft ? { draft: p.draft } : {}) }); return true; }
    const answering = !!pending && !QUESTION_WORD.test(msg) && !INFO_WORD.test(msg);
    if (!answering && !isSupplyRequest(me, msg)) { setFlow([]); setPending(null); return false; }
    if (flowBusy) return true;
    setText(''); addFlow('user', msg);
    if (!answering && !hasItems(msg)) { setPending({ text: '', draft: null }); addFlow('bot', t('ai.flow.ask')); return true; }
    // جواب «كم تحتاج من الديزل؟» برقم فقط: نربطه بالصنف الناقص
    const missing = answering ? usableItems(pending.draft).filter(i => i.quantity == null) : [];
    const add = missing.length === 1 && /^[\d٠-٩]/.test(msg) ? `${resName(t, missing[0].resource)} ${msg}` : msg;
    draftFlow(answering && pending.text ? `${pending.text}، ${add}` : add);
    return true;
  };
  const bottom = useRef(null), input = useRef(null);
  const loadList = () => api('/api/chats').then(setList).catch(() => {});
  useEffect(() => { if (open) { api('/api/ai/status').then(setAi).catch(() => {}); loadList(); setTimeout(() => input.current?.focus(), 50); } }, [open]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [chat?.messages?.length, sending, expanded, live]);
  const toggleSize = () => setExpanded(v => { try { localStorage.setItem(aiSizeKey, v ? '0' : '1'); } catch {} return !v; });
  const send = q => {
    const msg = (q ?? text).trim(); if (!msg || sendLock.current) return;
    if (requestFlow(msg)) return;
    sendLock.current = true;
    setSending(msg); setText(''); setError(null); setLive('');
    streamChat(chat ? `/api/chats/${chat.id}/messages` : '/api/chats', msg, delta => setLive(v => delta === null ? '' : v + delta))
    .then(c => { setChat(c); loadList();api('/api/ai/status').then(setAi).catch(()=>{}); }).catch(e => { setError(e); setText(msg); }).finally(() => { sendLock.current = false; setSending(null); setLive(''); });
  };
  const openChat = id => api(`/api/chats/${id}`).then(c => { setChat(c); setShowHistory(false); }).catch(() => {});
  const remove = id => { if (!confirm(t('ai.deleteConfirm'))) return; api(`/api/chats/${id}`, { method: 'DELETE' }).then(() => { if (chat?.id === id) setChat(null); loadList(); }).catch(() => {}); };
  const newChat = () => { setFlow([]); setPending(null); setChat(null); setShowHistory(false); setText(''); setTimeout(() => input.current?.focus(), 50); };
  const onKey = e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } };
  const composer = <form className="ai-composer" onSubmit={e => { e.preventDefault(); send(); }}>
    <textarea ref={input} dir="auto" rows="1" maxLength="4000" placeholder={t('ai.placeholder')} value={text} onChange={e => setText(e.target.value)} onKeyDown={onKey}/>
    <button type="submit" disabled={!text.trim() || !!sending} aria-label={t('ai.send')}><Icon d={icons.send} size={16}/></button>
  </form>;
  const messages = [...(chat?.messages || []), ...flow, ...(sending ? [{ role: 'user', text: sending, pending: true }] : [])];
  // القائمة الجانبية مثل واجهات المحادثة: محادثة جديدة + المحادثات السابقة
  const sidebar = <aside className="ai-side">
    <button className="ai-new" onClick={newChat}><Icon d={icons.newChat} size={16}/><span>{t('ai.new')}</span></button>
    <h4>{t('ai.history')}</h4>
    {list.length ? list.map(c => <div key={c.id} className={`ai-hist-row ${chat?.id === c.id ? 'active' : ''}`} onClick={() => openChat(c.id)}>
      <Icon d={icons.chat} size={14}/>
      <div><b dir="auto">{c.title}</b><small>{fmtDateTime(c.updatedAt)}</small></div>
      <button onClick={e => { e.stopPropagation(); remove(c.id); }} title={t('ai.delete')} aria-label={t('ai.delete')}><Icon d={icons.trash} size={14}/></button>
    </div>) : <p className="empty">{t('ai.noHistory')}</p>}
  </aside>;
  const main = !messages.length ? <div className="ai-home">
    <span className="ai-home-logo"><AzmLogo/></span>
    <h3>{t('ai.greeting', { name: me.username })}</h3>
    <p>{t('ai.sub')}</p>
    {composer}
  </div> : <>
    <div className="ai-messages">
      {messages.map((m, i) => m.role === 'user'
        ? <div key={i} className={`ai-msg user ${m.pending ? 'pending' : ''}`}><p dir="auto">{m.text}</p></div>
        : <div key={i} className={`ai-msg bot ${m.kind || ''}`}><span className="ai-avatar sm"><AzmLogo/></span><p dir="auto">{m.kind === 'not_connected' ? <><b>⚠ {t('ai.status.offline')}</b><br/>{t('ai.notConnected')}</> : m.kind === 'ai_error' ? <><b>⚠ {t('ai.errorTitle')}</b><br/>{t('ai.error')}</> : m.text}</p></div>)}
      {flowBusy && <div className="ai-msg bot"><span className="ai-avatar sm"><AzmLogo/></span><p className="ai-typing"><i/><i/><i/></p></div>}
      {sending && <div className="ai-msg bot"><span className="ai-avatar sm"><AzmLogo/></span>{live ? <p dir="auto">{live}</p> : <p className="ai-typing"><i/><i/><i/></p>}</div>}
      <div ref={bottom}/>
    </div>
    {composer}
  </>;
  return <>
    {open && <div className={`ai-panel ${expanded ? 'expanded' : ''}`} role="dialog" aria-label={t('ai.title')}>
      <header>
        <span className="ai-avatar"><AzmLogo/></span>
        <div><b>{t('ai.title')}</b><small className={ai.connected ? 'on' : undefined}><i className={ai.connected ? 'ai-dot on' : 'ai-dot'}/>{ai.connected ? t('ai.status.online', { model: ai.model }) : t('ai.status.offline')}</small></div>
        <button onClick={newChat} title={t('ai.new')} aria-label={t('ai.new')}><Icon d={icons.newChat}/></button>
        {!expanded && <button className={showHistory ? 'active' : ''} onClick={() => { setShowHistory(v => !v); loadList(); }} title={t('ai.history')} aria-label={t('ai.history')}><Icon d={icons.history}/></button>}
        <button onClick={toggleSize} title={t(expanded ? 'ai.shrink' : 'ai.expand')} aria-label={t(expanded ? 'ai.shrink' : 'ai.expand')}><Icon d={expanded ? icons.shrink : icons.expand}/></button>
        <button onClick={() => setOpen(false)} title={t('common.close')} aria-label={t('common.close')}><Icon d={icons.close}/></button>
      </header>
      <div className="ai-body">
        {(expanded || showHistory) && sidebar}
        {(expanded || !showHistory) && <div className="ai-main">
          {main}
          {error && <span className="form-error ai-error">{errText(t, error)}</span>}<small className="ai-foot">{t('ai.disclaimer')}</small></div>}
      </div>
    </div>}
    <button className={`ai-fab ${open ? 'open' : ''}`} onClick={() => setOpen(v => !v)} aria-label={t('ai.open')} title={t('ai.title')}>{open ? <Icon d={icons.close} size={22}/> : <AiLogo size={34}/>}</button>
  </>;
}
