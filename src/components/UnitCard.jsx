// بطاقة الوحدة وشريط المستوى
function UnitCard({ unit }) {
  const { t } = useLang();
  const s=statusFor(unit), sector=unitSector(t, unit); return <article className={`unit-card ${s}`}>
    <div className="unit-title"><div><b>{unitName(t, unit)}</b><small>{unit.id}{sector && ` — ${sector}`}</small></div><span>{t(`state.${s}`)}</span></div>
    <div className="optempo">OPTEMPO: <b>{t(`optempo.${unit.optempo}`)}</b><small>{unit.people} {t('unit.people')} | {unit.vehicles} {t('unit.vehicles')}</small></div>
    {unitVisibleResources(unit).map(r=>{ const legacy=!unitResources(unit).some(x=>x.key===r.key); return <Meter key={r.key} label={`${r.icon} ${resName(t, r.key)}${r.active ? '' : ` (${t('cat.off')})`}${legacy && r.active ? ` (${t('policy.legacyShort')})` : ''}`} value={unit[r.key]} />; })}
    <div className="unit-metrics"><span><b>{mcr(unit)}%</b><small>MCR</small></span><span><b>{dos(unit)}</b><small>DOS</small></span><span><b>{fmtHours(unit.truck)}</b><small>Lead Time</small></span></div>
    <footer>{t('unit.rop')}: {unitResources(unit).slice(0,2).map(r=><span key={r.key}>{resName(t,r.key)} <b>{Math.round(unit[r.key]??0)}%</b> · </span>)}</footer>
  </article>;
}

function Meter({label,value}) { const cls=value<25?'red':value<50?'amber':'green'; return <div className="meter"><span>{label}</span><div><i className={cls} style={{width:`${Math.max(0,value)}%`}}/><em style={{left:'45%'}}/></div><b className={cls}>{Math.round(value)}%</b></div>; }
