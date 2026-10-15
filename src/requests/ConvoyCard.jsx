// بطاقة تتبع القافلة
function ConvoyCard({ c, allUnits, layout, simClock, paused = false }) {
  const { t } = useLang();
  const [, setTick] = useState(0); useEffect(() => { const id = setInterval(() => setTick(x => x + 1), 250); return () => clearInterval(id); }, []);
  const p = convoyProgress(c, simClock()), from = c.route?.fromId && layout.nodes.find(n => n.id === c.route.fromId);
  return <div className="convoy-card tracked">
    <div className="convoy-head">{c.mode === 'heli' ? '✈️' : '🚛'} <b>{c.id}</b>{c.fromHq && <em className="hq-tag">◆</em>}<span>{Math.round(p * 100)}%</span></div>
    <small>{t('convoy.path', { from: from ? nodeName(from, t) : (c.route?.fromLabel || '—'), to: c.kind === 'base' ? (() => { const b = layout.nodes.find(n => n.id === c.targetId); return b ? `★ ${nodeName(b, t)}` : c.targetId; })() : nameById(t, allUnits, c.unitId) })}</small>
    <div className="progress"><i style={{ width: `${p * 100}%` }}/></div>
    <small>{(c.dispatched?.length ? c.dispatched : reqItems(c)).map(i => resName(t, i.resource)).join(' + ')} — {t('convoy.remaining', { h: ((1 - p) * c.eta).toFixed(1) })}</small>
    {paused && <small className="stage-paused">⏸ {t('sim.pausedConvoy')}</small>}
  </div>;
}
