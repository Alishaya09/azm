// نافذة SITREP
// تاريخ ووقت عسكري: DDHHMMZ MON YYYY بتوقيت غرينتش
const dtg = d => { const p = n => String(n).padStart(2, '0'); return `${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z ${['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

function Sitrep({ units, requests, refresh, onClose }) {
  const { t } = useLang();
  const [at, setAt] = useState(new Date()), [busy, setBusy] = useState(false);
  const doRefresh = () => { setBusy(true); Promise.resolve(refresh()).finally(() => { setAt(new Date()); setBusy(false); }); };
  const critical = units.filter(u => statusFor(u) === 'critical');
  const pending = requests.filter(r => r.status === 'pending').length, moving = requests.filter(r => r.status === 'approved').length;
  const sent = requests.filter(r => r.status === 'approved' || r.status === 'delivered').length, emergency = requests.filter(r => r.priority === 'emergency').length;
  // تقدير عَزْم: ملخص آلي مبني على البيانات الحالية (يتحول لتحليل النموذج لما ينربط)
  const worst = units.flatMap(u => unitResources(u).filter(r=>r.usage!=='maintenance').map(r => ({ u, r: r.key, v: u[r.key]??0 }))).sort((a, b) => a.v - b.v)[0];
  const assessment = !units.length ? t('sit.noUnits') : [
    t('sit.a.summary', { c: critical.length, n: units.length, p: pending, m: moving }),
    worst && t('sit.a.priority', { unit: unitName(t, worst.u), res: resName(t, worst.r), v: Math.round(worst.v) }),
    t(critical.length ? 'sit.a.actCritical' : worst && worst.v < 50 ? 'sit.a.actWarn' : 'sit.a.actOk'),
  ].filter(Boolean).join(' ');
  return <Modal title={<><AzmLogo className="sit-logo"/><span><span>{t('sit.title')}</span><small dir="ltr">DTG: {dtg(at)}</small></span></>} onClose={onClose} wide
    actions={<button type="button" className="approve sit-refresh" disabled={busy} onClick={doRefresh}>↻ {t('common.refresh')}</button>}>
    <h4 className="sit-h">{t('sit.units')}</h4>
    <div className="sit-table-wrap"><table className="sit-table"><thead><tr><th>{t('sit.id')}</th><th>{t('common.unit')}</th><th>{t('ent.unitResources')}</th><th>MCR</th><th>DOS</th><th>{t('req.status')}</th><th>OPTEMPO</th></tr></thead>
      <tbody>{units.map(u => { const s = statusFor(u), cls = v => v < 25 ? 'bad' : v < 50 ? 'warn' : ''; return <tr key={u.id}><td><b>{u.id}</b></td><td>{unitName(t, u)}</td><td>{unitResources(u).filter(r=>r.usage!=='maintenance').slice(0,3).map(r=><span key={r.key}>{resName(t,r.key)} {Math.round(u[r.key]??0)}% · </span>)}</td><td className={cls(mcr(u))}>{mcr(u)}%</td><td className={Number(dos(u)) < 1.5 ? 'bad' : Number(dos(u)) < 3 ? 'warn' : ''}>{dos(u)}d</td><td className={`st ${s}`}>{t(`state.${s}`)}</td><td className={u.optempo === 'high' ? 'bad' : ''}>{t(`optempo.${u.optempo}`)}</td></tr>; })}</tbody></table></div>
    <div className="sit-kpis"><div className="green"><b>{sent}</b><small>{t('rep.sent')}</small></div><div className="red"><b>{emergency}</b><small>{t('rep.emergency')}</small></div><div><b>0</b><small>Cross-Level</small></div></div>
    {critical.length ? <div className="sit-box red"><h5>🔴 {t('sit.critical')}</h5>{critical.map(u => <p key={u.id}>• {unitName(t, u)} — MCR: {mcr(u)}% | DOS: {dos(u)} {t('common.days')}</p>)}</div>
      : <div className="sit-box green"><h5>🟢 {t('sit.noCritical')}</h5></div>}
    <div className="sit-box assess"><h5>🤖 {t('sit.assessment')}</h5><p>{assessment}</p></div>
  </Modal>;
}
