// داشبورد التقارير: فلاتر جانبية + مؤشرات + خمسة رسوم SVG (بدون مكتبات). كل البيانات مفلترة بالصلاحية من الخادم:
//   الطلبات والمخزون من /api/state، وعدد العمليات عبر الزمن من /api/reports/series.
// الكميات لا تُجمع بين أصناف مختلفة (وحدات قياس مختلفة)؛ نعرض أعداد العمليات أو نسب الامتلاء من السعة.
// الألوان: لوحة فئوية مُتحقق منها على سطح البطاقة الكحلي (بدون الأخضر المحجوز للحالة).
const RD_SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9', '#e66767'];
const RD_CLASSES = ['I', 'II', 'III', 'IV', 'VIII', 'IX'];
const RD_PRIORITIES = ['normal', 'urgent', 'emergency'];
const RD_TYPES = ['dispatch', 'delivery', 'external_add', 'transfer', 'return'];
const RD_REORDER = 45;
const rdClassOf = key => resDefOf(key)?.training?.supplyClass || 'other';
const rdFmt = v => { const a = Math.abs(v); return a >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : a >= 1e3 ? `${+(v / 1e3).toFixed(1)}K` : `${Math.round(v * 10) / 10}`; };
const rdTime = (ms, step) => new Date(ms).toLocaleString('en-GB', step >= 86400000 ? { day: '2-digit', month: '2-digit' } : step < 60000 ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
// فترة تجميع مقرّبة (10 ث، دقيقة، ساعة، يوم…) بحيث لا تتجاوز 24 فترة؛ الفترات تنتهي عند الآن تماماً
const RD_STEPS = [5, 10, 30, 60, 300, 900, 1800, 3600, 10800, 21600, 43200, 86400, 172800, 604800].map(s => s * 1000);
const rdBuckets = (from, to, max = 24) => { const span = Math.max(1000, to - from), step = RD_STEPS.find(s => span / s <= max) || RD_STEPS.at(-1), count = Math.max(2, Math.ceil(span / step)); return { step, count, from: to - count * step }; };
// تدريجات محور مقرّبة (0 / 5 / 10 …)؛ الأعداد الصغيرة بخطوة 1
const rdTicks = (max, count = 4) => {
  if (!(max > 0)) return [0, 1];
  const raw = max / count, p = 10 ** Math.floor(Math.log10(raw)), step = Math.max(max < count ? 1 : 0, [1, 2, 2.5, 5, 10].map(x => x * p).find(s => s >= raw));
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => +(i * step).toFixed(6));
};
// منحنى ناعم لا يتجاوز القيم (monotone cubic)
const rdSmooth = pts => {
  const n = pts.length; if (!n) return ''; if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const dx = [], m = [], tg = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = dx[i] ? (pts[i + 1][1] - pts[i][1]) / dx[i] : 0; }
  tg[0] = m[0]; tg[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) tg[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (!m[i]) { tg[i] = 0; tg[i + 1] = 0; continue; }
    const a = tg[i] / m[i], b = tg[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); tg[i] = k * a * m[i]; tg[i + 1] = k * b * m[i]; }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) { const h = dx[i] / 3; d += `C${pts[i][0] + h},${pts[i][1] + tg[i] * h} ${pts[i + 1][0] - h},${pts[i + 1][1] - tg[i + 1] * h} ${pts[i + 1][0]},${pts[i + 1][1]}`; }
  return d;
};
// عمود بحافة علوية مستديرة 4px ومربّع عند خط الأساس
const rdBar = (x, y, w, h) => { const r = Math.min(4, w / 2, h); return h <= 0 ? '' : `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`; };
const useRdWidth = () => {
  const ref = useRef(null), [w, setW] = useState(480);
  useEffect(() => { if (!ref.current || typeof ResizeObserver === 'undefined') return; const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.floor(e.contentRect.width)))); ro.observe(ref.current); return () => ro.disconnect(); }, []);
  return [ref, w];
};
const rdPointer = (e, svg) => { const b = svg.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };

function RdCard({ title, sub, legend, className = '', children }) {
  return <section className={`rd-card ${className}`}>
    <header><h3>{title}</h3>{sub && <small>{sub}</small>}</header>
    {legend && <ul className="rd-legend">{legend.map(l => <li key={l.label}><i style={{ background: l.color }}/>{l.label}</li>)}</ul>}
    {children}
  </section>;
}
function RdTip({ tip }) {
  if (!tip) return null;
  return <div className="rd-tip" style={{ left: tip.x, top: tip.y }} role="status"><b>{tip.title}</b>{tip.rows.map((r, i) => <div key={i}>{r.color && <i style={{ background: r.color }}/>}<span>{r.label}</span><strong dir="ltr">{r.value}</strong></div>)}</div>;
}
// محاور مشتركة: شبكة أفقية خفيفة وتدريجات المحور الرأسي
function RdGrid({ ticks, y, m, w, fmt = rdFmt }) {
  return <g className="rd-grid">{ticks.map(v => <g key={v}><line x1={m.l} x2={w - m.r} y1={y(v)} y2={y(v)}/><text x={m.l - 8} y={y(v)} dy="0.32em" textAnchor="end">{fmt(v)}</text></g>)}</g>;
}
function RdTimeAxis({ buckets, x, y0, step }) {
  const every = Math.max(1, Math.ceil(buckets.length / 6));
  return <g className="rd-axis">{buckets.map((b, i) => i % every === 0 && <text key={b.at} x={x(i)} y={y0 + 18} textAnchor="middle">{rdTime(b.at, step)}</text>)}</g>;
}
function RdEmpty({ show }) { const { t } = useLang(); return show ? <div className="rd-empty">{t('rd.empty')}</div> : null; }

// ① مساحات متراكبة: عدد العمليات لكل نوع عبر الزمن، مع خط عمودي وتلميح عند المرور
function RdArea({ data, series }) {
  const { t } = useLang(); const [ref, w] = useRdWidth(); const [hi, setHi] = useState(null);
  const buckets = data?.buckets || [], n = buckets.length, H = 260, m = { l: 40, r: 16, t: 12, b: 30 }, iw = w - m.l - m.r, ih = H - m.t - m.b;
  const x = i => m.l + (n <= 1 ? iw / 2 : i * iw / (n - 1));
  const totals = buckets.map(b => series.reduce((s, k) => s + (b[k.key] || 0), 0)), ticks = rdTicks(Math.max(0, ...totals)), top = ticks.at(-1), y = v => m.t + ih - v / top * ih;
  let base = buckets.map(() => 0);
  const layers = series.map(s => { const lo = base, up = base.map((v, i) => v + (buckets[i][s.key] || 0)); base = up; return { s, lo, up }; });
  const area = (lo, up) => rdSmooth(up.map((v, i) => [x(i), y(v)])) + rdSmooth(lo.map((v, i) => [x(i), y(v)]).reverse()).replace(/^M/, 'L') + 'Z';
  const move = e => { if (!n) return; const [px] = rdPointer(e, e.currentTarget); setHi(Math.max(0, Math.min(n - 1, Math.round((px - m.l) / (n <= 1 ? 1 : iw / (n - 1)))))); };
  const tip = hi != null && buckets[hi] ? { x: Math.min(x(hi) + 12, w - 170), y: 12, title: rdTime(buckets[hi].at, data.step), rows: [...series].reverse().map(s => ({ color: s.color, label: s.label, value: buckets[hi][s.key] || 0 })).concat([{ label: t('rd.total'), value: totals[hi] }]) } : null;
  return <div className="rd-plot" ref={ref}>
    <svg width={w} height={H} onMouseMove={move} onMouseLeave={() => setHi(null)} role="img" aria-label={t('rd.c1')}>
      <RdGrid ticks={ticks} y={y} m={m} w={w}/>
      {n > 0 && layers.map(({ s, lo, up }) => <g key={s.key}><path d={area(lo, up)} fill={s.color} fillOpacity=".5"/><path d={rdSmooth(up.map((v, i) => [x(i), y(v)]))} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round"/></g>)}
      {hi != null && <line className="rd-cross" x1={x(hi)} x2={x(hi)} y1={m.t} y2={m.t + ih}/>}
      <line className="rd-base" x1={m.l} x2={w - m.r} y1={m.t + ih} y2={m.t + ih}/>
      <RdTimeAxis buckets={buckets} x={x} y0={m.t + ih} step={data?.step || 0}/>
    </svg>
    {data ? <RdEmpty show={!totals.some(Boolean)}/> : <div className="rd-empty">{t('login.loading')}</div>}<RdTip tip={tip}/>
  </div>;
}

// ② فقاعات: الطلبات في كل فترة حسب الأولوية؛ الارتفاع = عدد الطلبات، الحجم = عدد الأصناف المطلوبة
function RdBubbles({ buckets, step, points, series }) {
  const { t } = useLang(); const [ref, w] = useRdWidth(); const [hi, setHi] = useState(null);
  const n = buckets.length, H = 260, m = { l: 40, r: 22, t: 18, b: 30 }, iw = w - m.l - m.r, ih = H - m.t - m.b;
  const x = i => m.l + (n <= 1 ? iw / 2 : i * iw / (n - 1));
  const ticks = rdTicks(Math.max(0, ...points.map(p => p.count))), top = ticks.at(-1), y = v => m.t + ih - v / top * ih;
  const maxItems = Math.max(1, ...points.map(p => p.items)), r = p => 5 + 15 * Math.sqrt(p.items / maxItems);
  const color = k => series.find(s => s.key === k)?.color;
  const p = hi != null ? points[hi] : null;
  const tip = p ? { x: Math.min(x(p.i) + 14, w - 170), y: Math.max(4, y(p.count) - 30), title: `${rdTime(buckets[p.i].at, step)} · ${series.find(s => s.key === p.key)?.label}`, rows: [{ label: t('rd.requests'), value: p.count }, { label: t('rd.items'), value: p.items }] } : null;
  return <div className="rd-plot" ref={ref}>
    <svg width={w} height={H} role="img" aria-label={t('rd.c2')}>
      <RdGrid ticks={ticks} y={y} m={m} w={w}/>
      <line className="rd-base" x1={m.l} x2={w - m.r} y1={m.t + ih} y2={m.t + ih}/>
      {[...points].sort((a, b) => b.items - a.items).map(pt => { const idx = points.indexOf(pt); return <g key={`${pt.i}-${pt.key}`} onMouseEnter={() => setHi(idx)} onMouseLeave={() => setHi(null)}>
        <circle cx={x(pt.i)} cy={y(pt.count)} r={r(pt) + 6} fill="transparent"/>
        <circle className="rd-dot" cx={x(pt.i)} cy={y(pt.count)} r={r(pt)} fill={color(pt.key)} fillOpacity={hi === idx ? 1 : .8}/>
      </g>; })}
      <RdTimeAxis buckets={buckets} x={x} y0={m.t + ih} step={step}/>
    </svg>
    <RdEmpty show={!points.length}/><RdTip tip={tip}/>
  </div>;
}

// ③ أعمدة مجمّعة: متوسط امتلاء كل وحدة حسب فئة الإمداد (% من السعة) مع خط نقطة إعادة الطلب
function RdGroupedBars({ groups, series }) {
  const { t } = useLang(); const [ref, w] = useRdWidth(); const [hi, setHi] = useState(null);
  // أسماء الوحدات تميل إذا ضاق عرضها حتى لا تتداخل
  const H = 280, m = { l: 40, r: 14, t: 12, b: 64 }, iw = w - m.l - m.r, ih = H - m.t - m.b, tilt = groups.length && iw / groups.length < 84;
  const ticks = [0, 25, 50, 75, 100], y = v => m.t + ih - v / 100 * ih;
  const band = groups.length ? iw / groups.length : iw, k = Math.max(1, series.length), bw = Math.max(3, Math.min(24, (band * .8 - (k - 1) * 2) / k)), gw = k * bw + (k - 1) * 2;
  const bx = (gi, si) => m.l + gi * band + (band - gw) / 2 + si * (bw + 2);
  const cut = s => s.length > 14 ? `${s.slice(0, 13)}…` : s;
  const h = hi && groups[hi.g] ? { g: groups[hi.g], s: series[hi.s] } : null;
  const tip = h ? { x: Math.min(bx(hi.g, hi.s) + bw + 8, w - 170), y: Math.max(4, y(h.g.values[h.s.key] ?? 0) - 34), title: h.g.label, rows: [{ color: h.s.color, label: h.s.label, value: `${Math.round(h.g.values[h.s.key])}%` }] } : null;
  return <div className="rd-plot" ref={ref}>
    <svg width={w} height={H} role="img" aria-label={t('rd.c3')}>
      <RdGrid ticks={ticks} y={y} m={m} w={w} fmt={v => `${v}%`}/>
      <line className="rd-ref" x1={m.l} x2={w - m.r} y1={y(RD_REORDER)} y2={y(RD_REORDER)}/><text className="rd-ref-label" x={w - m.r} y={y(RD_REORDER) - 5} textAnchor="end">{t('rd.reorder')}</text>
      {groups.map((g, gi) => <g key={g.id}>
        {series.map((s, si) => g.values[s.key] == null ? null : <g key={s.key} onMouseEnter={() => setHi({ g: gi, s: si })} onMouseLeave={() => setHi(null)}>
          <rect x={bx(gi, si) - 1} y={m.t} width={bw + 2} height={ih} fill="transparent"/>
          <path d={rdBar(bx(gi, si), y(g.values[s.key]), bw, m.t + ih - y(g.values[s.key]))} fill={s.color} opacity={hi && (hi.g !== gi || hi.s !== si) ? .55 : 1}/>
        </g>)}
        <text className="rd-axis-label" x={m.l + gi * band + band / 2} y={m.t + ih + 16} textAnchor={tilt ? 'end' : 'middle'} transform={tilt ? `rotate(-35 ${m.l + gi * band + band / 2} ${m.t + ih + 16})` : undefined}><title>{g.label}</title>{cut(g.label)}</text>
      </g>)}
      <line className="rd-base" x1={m.l} x2={w - m.r} y1={m.t + ih} y2={m.t + ih}/>
    </svg>
    <RdEmpty show={!groups.length}/><RdTip tip={tip}/>
  </div>;
}

// ④ خطوط: دورة الطلبات في كل فترة (إنشاء، إرسال، تسليم) مع نقاط ذات حلقة وخط عمودي عند المرور
function RdLines({ buckets, step, series }) {
  const { t } = useLang(); const [ref, w] = useRdWidth(); const [hi, setHi] = useState(null);
  const n = buckets.length, H = 260, m = { l: 40, r: 16, t: 12, b: 30 }, iw = w - m.l - m.r, ih = H - m.t - m.b;
  const x = i => m.l + (n <= 1 ? iw / 2 : i * iw / (n - 1));
  const ticks = rdTicks(Math.max(0, ...buckets.flatMap(b => series.map(s => b[s.key] || 0)))), top = ticks.at(-1), y = v => m.t + ih - v / top * ih;
  const move = e => { if (!n) return; const [px] = rdPointer(e, e.currentTarget); setHi(Math.max(0, Math.min(n - 1, Math.round((px - m.l) / (n <= 1 ? 1 : iw / (n - 1)))))); };
  const tip = hi != null && buckets[hi] ? { x: Math.min(x(hi) + 12, w - 170), y: 12, title: rdTime(buckets[hi].at, step), rows: series.map(s => ({ color: s.color, label: s.label, value: buckets[hi][s.key] || 0 })) } : null;
  const showDots = n <= 16;
  return <div className="rd-plot" ref={ref}>
    <svg width={w} height={H} onMouseMove={move} onMouseLeave={() => setHi(null)} role="img" aria-label={t('rd.c4')}>
      <RdGrid ticks={ticks} y={y} m={m} w={w}/>
      {hi != null && <line className="rd-cross" x1={x(hi)} x2={x(hi)} y1={m.t} y2={m.t + ih}/>}
      {n > 0 && series.map(s => <g key={s.key}>
        <path d={rdSmooth(buckets.map((b, i) => [x(i), y(b[s.key] || 0)]))} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
        {buckets.map((b, i) => (showDots || i === hi) && <circle key={i} className="rd-dot" cx={x(i)} cy={y(b[s.key] || 0)} r={i === hi ? 5 : 4} fill={s.color}/>)}
      </g>)}
      <line className="rd-base" x1={m.l} x2={w - m.r} y1={m.t + ih} y2={m.t + ih}/>
      <RdTimeAxis buckets={buckets} x={x} y0={m.t + ih} step={step}/>
    </svg>
    <RdEmpty show={!buckets.some(b => series.some(s => b[s.key]))}/><RdTip tip={tip}/>
  </div>;
}

// ⑤ أشرطة أفقية (bullet): امتلاء كل مستودع مقابل نقطة إعادة الطلب 45%، والخلفية نطاقات حرج/تحت النقطة/جيد بدرجات رمادية
function RdBullet({ rows }) {
  const { t } = useLang(); const [ref, w] = useRdWidth(); const [hi, setHi] = useState(null);
  const lw = Math.min(150, Math.max(90, w * .3)), row = 30, m = { l: lw + 8, r: 46, t: 6, b: 26 }, H = m.t + m.b + Math.max(1, rows.length) * row, iw = w - m.l - m.r;
  const x = v => m.l + Math.max(0, Math.min(100, v)) / 100 * iw;
  const cut = s => s.length > 20 ? `${s.slice(0, 19)}…` : s;
  const r = hi != null ? rows[hi] : null;
  const tip = r ? { x: Math.min(x(r.value) + 10, w - 170), y: m.t + hi * row - 4, title: r.label, rows: [{ label: t('rd.fill'), value: `${Math.round(r.value)}%` }, ...(r.detail ? [{ label: t('rd.resources'), value: r.detail }] : [])] } : null;
  return <div className="rd-plot" ref={ref}>
    <svg width={w} height={H} role="img" aria-label={t('rd.c5')}>
      {[0, 25, 45, 75, 100].map(v => <g key={v} className="rd-grid"><line x1={x(v)} x2={x(v)} y1={m.t} y2={H - m.b}/><text x={x(v)} y={H - m.b + 16} textAnchor="middle">{v}%</text></g>)}
      {rows.map((rw, i) => { const cy = m.t + i * row + row / 2; return <g key={rw.id} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)}>
        <rect x={0} y={cy - row / 2} width={w} height={row} fill="transparent"/>
        <text className="rd-axis-label" x={lw} y={cy} dy="0.32em" textAnchor="end"><title>{rw.label}</title>{cut(rw.label)}</text>
        <rect className="rd-band c" x={x(0)} y={cy - 9} width={x(25) - x(0)} height={18}/>
        <rect className="rd-band w" x={x(25)} y={cy - 9} width={x(45) - x(25)} height={18}/>
        <rect className="rd-band g" x={x(45)} y={cy - 9} width={x(100) - x(45)} height={18}/>
        <path d={`M${x(0)},${cy - 5}H${Math.max(x(0), x(rw.value) - 4)}Q${x(rw.value)},${cy - 5} ${x(rw.value)},${cy - 1}V${cy + 1}Q${x(rw.value)},${cy + 5} ${Math.max(x(0), x(rw.value) - 4)},${cy + 5}H${x(0)}Z`} fill={RD_SERIES[0]} opacity={hi != null && hi !== i ? .6 : 1}/>
        <line className="rd-marker" x1={x(RD_REORDER)} x2={x(RD_REORDER)} y1={cy - 9} y2={cy + 9}/>
        <text className="rd-value" x={x(rw.value) + 6} y={cy} dy="0.32em">{Math.round(rw.value)}%</text>
      </g>; })}
    </svg>
    <RdEmpty show={!rows.length}/><RdTip tip={tip}/>
  </div>;
}

function RdChecks({ title, options, selected, onChange }) {
  const { t } = useLang();
  const all = options.every(o => selected.has(o.id));
  const toggle = id => { const next = new Set(selected); next.has(id) ? next.delete(id) : next.add(id); onChange(next); };
  return <fieldset className="rd-filter"><legend>{title}</legend>
    <label><input type="checkbox" checked={all} onChange={() => onChange(all ? new Set() : new Set(options.map(o => o.id)))}/>{t('common.all')}</label>
    {options.map(o => <label key={o.id}><input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)}/>{o.color && <i style={{ background: o.color }}/>}{o.label}</label>)}
  </fieldset>;
}

function ReportsDashboard({ me, units, requests, layout, inventory = {}, trackingStartedAt }) {
  const { t } = useLang();
  const [period, setPeriod] = useState('tracking');
  const bases = layout.nodes.filter(n => n.type === 'main');
  const [baseSel, setBaseSel] = useState(() => new Set(bases.map(b => b.id)));
  const [classSel, setClassSel] = useState(() => new Set(RD_CLASSES));
  const [prioSel, setPrioSel] = useState(() => new Set(RD_PRIORITIES));
  const [series, setSeries] = useState(null);
  // تغيير الفترة أو الفلاتر يعرض «جارٍ التحميل» بدل بيانات الفلتر السابق
  // قاعدة جديدة تظهر محددة تلقائياً، واختيار المستخدم للقواعد الموجودة يبقى كما هو
  const baseKey = bases.map(b => b.id).join(','), seenBases = useRef(new Set(bases.map(b => b.id)));
  useEffect(() => { const fresh = bases.map(b => b.id).filter(id => !seenBases.current.has(id)); fresh.forEach(id => seenBases.current.add(id)); if (fresh.length) setBaseSel(prev => new Set([...prev, ...fresh])); }, [baseKey]);
  const showBases = me.role === 'admin' && bases.length > 1;
  const now = Date.now(), H = 3600000;
  const start = period === '24h' ? now - 24 * H : period === '7d' ? now - 168 * H : period === '30d' ? now - 720 * H : Math.min(trackingStartedAt || now - 24 * H, ...requests.map(r => r.createdAt || now));
  const { step, count, from } = rdBuckets(start, now, period === '30d' ? 30 : 24);
  const buckets = Array.from({ length: count }, (_, i) => ({ at: Math.round(from + i * step) }));
  const slot = at => at < from || at > now ? -1 : Math.min(count - 1, Math.floor((at - from) / step));
  const keysOf = cls => allResources.filter(r => cls.has(rdClassOf(r.key))).map(r => r.key);
  const keys = keysOf(classSel), allClasses = RD_CLASSES.every(c => classSel.has(c));
  const baseOf = n => n.type === 'main' ? n.id : n.baseId;
  const inBases = id => !showBases || baseSel.has(id);
  // ① عدد العمليات عبر الزمن من الخادم (بنطاق الجلسة)
  // الاستعلام يُبنى عند كل تحميل حتى تتقدم الفترة مع الوقت
  const seriesFilters = { ...(showBases && baseSel.size < bases.length ? { baseIds: [...baseSel].join(',') } : {}), ...(!allClasses ? { resources: keys.join(',') } : {}) };
  const latest = useRef(null); latest.current = () => { const end = Date.now(), b = rdBuckets(period === 'tracking' ? start : end - (now - start), end, period === '30d' ? 30 : 24); return new URLSearchParams({ from: String(Math.round(b.from)), to: String(end), buckets: String(b.count), ...seriesFilters }).toString(); };
  const seriesKey = `${period}|${[...baseSel].sort()}|${[...classSel].sort()}|${!!trackingStartedAt}`;
  useEffect(() => { setSeries(null); }, [seriesKey]);
  useEffect(() => {
    if ((showBases && !baseSel.size) || !classSel.size) { setSeries({ step, buckets: buckets.map(b => ({ ...b })) }); return; }
    // فشل تحديث عابر لا يمسح الرسم: نبقي آخر بيانات صحيحة ونعيد المحاولة بعد ثوانٍ
    let live = true, retry = null; const load = () => api(`/api/reports/series?${latest.current()}`).then(d => { if (live) setSeries(d); }).catch(() => { if (live) retry = setTimeout(load, 3000); });
    load(); const id = setInterval(load, 15000); return () => { live = false; clearInterval(id); clearTimeout(retry); };
  }, [seriesKey, requests.length]);
  // الطلبات المفلترة (القاعدة، فئة الإمداد، الأولوية)
  const reqClasses = r => new Set(reqItems(r).map(i => rdClassOf(i.resource)));
  const shown = requests.filter(r => inBases(r.baseId || r.targetId) && [...reqClasses(r)].some(c => classSel.has(c)) && prioSel.has(r.priority || 'normal'));
  const eventAt = (r, status) => (r.history || []).find(h => h.status === status)?.at;
  // ② فقاعات لكل فترة × أولوية
  const prioSeries = RD_PRIORITIES.map((k, i) => ({ key: k, label: t(`priority.${k}`), color: RD_SERIES[i] }));
  const bubbleMap = {};
  for (const r of shown) { const i = slot(r.createdAt || 0); if (i < 0) continue; const b = bubbleMap[`${i}|${r.priority || 'normal'}`] ||= { i, key: r.priority || 'normal', count: 0, items: 0 }; b.count++; b.items += reqItems(r).length; }
  const points = Object.values(bubbleMap);
  // ④ دورة الطلبات
  const cycleSeries = [{ key: 'created', label: t('srep.requested'), color: RD_SERIES[0] }, { key: 'dispatched', label: t('srep.dispatched'), color: RD_SERIES[1] }, { key: 'delivered', label: t('srep.delivered'), color: RD_SERIES[2] }];
  const cycle = buckets.map(b => ({ ...b, created: 0, dispatched: 0, delivered: 0 }));
  for (const r of shown) for (const [k, at] of [['created', r.createdAt], ['dispatched', eventAt(r, 'approved')], ['delivered', eventAt(r, 'delivered')]]) { const i = slot(at || 0); if (i >= 0) cycle[i][k]++; }
  // ③ امتلاء الوحدات حسب الفئة (أسوأ 10 وحدات أولاً)
  const classSeries = RD_CLASSES.map((c, i) => ({ key: c, label: t(`rd.class.${c}`), color: RD_SERIES[i] }));
  const activeClassSeries = classSeries.filter(s => classSel.has(s.key));
  const unitsShown = units.filter(u => inBases(u.baseId));
  const unitGroups = unitsShown.map(u => {
    const values = {};
    for (const c of activeClassSeries) { const list = unitVisibleResources(u).filter(r => rdClassOf(r.key) === c.key && capacityOf(u, r.key) > 0); if (list.length) values[c.key] = list.reduce((s, r) => s + Math.min(100, u[r.key] || 0), 0) / list.length; }
    const vals = Object.values(values);
    return { id: u.id, label: unitName(t, u), values, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 100 };
  }).filter(g => Object.keys(g.values).length).sort((a, b) => a.avg - b.avg).slice(0, 10);
  // ⑤ امتلاء المستودعات (القواعد والمراكز)، ولمسؤول الوحدة: وحدته حسب الفئة
  const depotRows = layout.nodes.filter(n => (n.type === 'main' || n.type === 'fsb') && inventory[n.id] && inBases(baseOf(n))).map(n => {
    const inv = inventory[n.id], list = keys.filter(k => (inv.capacity?.[k] || 0) > 0);
    const value = list.length ? list.reduce((s, k) => s + Math.min(100, (inv.qty?.[k] || 0) / inv.capacity[k] * 100), 0) / list.length : null;
    return { id: n.id, label: `${n.type === 'main' ? '★' : '▪'} ${nodeName(n, t)}`, value, detail: list.length };
  }).filter(r => r.value != null).sort((a, b) => a.value - b.value).slice(0, 12);
  const unitClassRows = me.role === 'user' && unitGroups[0] ? activeClassSeries.filter(c => unitGroups[0].values[c.key] != null).map(c => ({ id: c.key, label: c.label, value: unitGroups[0].values[c.key] })) : [];
  const bulletRows = me.role === 'user' ? unitClassRows : depotRows;
  // المؤشرات
  const inPeriod = shown.filter(r => slot(r.createdAt || 0) >= 0);
  const transit = shown.filter(r => r.status === 'approved' && !r.stalled).length;
  const delivered = shown.filter(r => slot(eventAt(r, 'delivered') || 0) >= 0).length;
  const fills = unitGroups.map(g => g.avg), avgFill = fills.length ? Math.round(fills.reduce((a, b) => a + b, 0) / fills.length) : null;
  const critical = unitsShown.filter(u => statusFor(u) === 'critical').length;
  const typeSeries = RD_TYPES.map((k, i) => ({ key: k, label: t(`mv.type.${k}`), color: RD_SERIES[i] }));
  return <div className="rd-root">
    <aside className="rd-filters">
      <fieldset className="rd-filter"><legend>{t('rd.period')}</legend>{['24h', '7d', '30d', 'tracking'].map(p => <label key={p}><input type="radio" name="rd-period" checked={period === p} onChange={() => setPeriod(p)}/>{t(`srep.p.${p}`)}</label>)}</fieldset>
      {showBases && <RdChecks title={t('rd.bases')} options={bases.map(b => ({ id: b.id, label: nodeName(b, t) }))} selected={baseSel} onChange={setBaseSel}/>}
      <RdChecks title={t('rd.classes')} options={classSeries.map(c => ({ id: c.key, label: c.label, color: c.color }))} selected={classSel} onChange={setClassSel}/>
      <RdChecks title={t('req.priority')} options={prioSeries.map(p => ({ id: p.key, label: p.label, color: p.color }))} selected={prioSel} onChange={setPrioSel}/>
    </aside>
    <div className="rd-main">
      <div className="rd-kpis">
        <div className="rd-kpi hero"><small>{t('rd.kpi.requests')}</small><b>{inPeriod.length}</b></div>
        <div className="rd-kpi"><small>{t('rd.kpi.transit')}</small><b>{transit}</b></div>
        <div className="rd-kpi"><small>{t('rd.kpi.delivered')}</small><b>{delivered}</b></div>
        <div className="rd-kpi"><small>{t('rd.kpi.avgFill')}</small><b>{avgFill == null ? '—' : `${avgFill}%`}</b></div>
        <div className="rd-kpi"><small>{t('rd.kpi.critical')}</small><b>{critical > 0 && <span className="rd-status critical">●</span>}{critical}</b></div>
      </div>
      <div className="rd-row two">
        <RdCard title={t('rd.c1')} sub={t('rd.c1sub')} legend={typeSeries}><RdArea data={series} series={typeSeries}/></RdCard>
        <RdCard title={t('rd.c2')} sub={t('rd.c2sub')} legend={prioSeries}><RdBubbles buckets={buckets} step={step} points={points} series={prioSeries}/></RdCard>
      </div>
      <div className="rd-row three">
        <RdCard title={t('rd.c3')} sub={t('rd.c3sub')} legend={activeClassSeries}><RdGroupedBars groups={unitGroups} series={activeClassSeries}/></RdCard>
        <RdCard title={t('rd.c4')} sub={t('rd.c4sub')} legend={cycleSeries}><RdLines buckets={cycle} step={step} series={cycleSeries}/></RdCard>
        <RdCard title={me.role === 'user' ? t('rd.c5unit') : t('rd.c5')} sub={t('rd.c5sub')}><RdBullet rows={bulletRows}/></RdCard>
      </div>
    </div>
  </div>;
}
