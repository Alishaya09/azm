// نافذة "كيف يعمل؟"
// ===== نوافذ الشريط العلوي: كيف يعمل؟ / OPTECHO™ / SITREP =====
function HowItWorks({ onClose }) {
  const { t } = useLang();
  const scores = resources.filter(r=>[...resourcePolicy.food,...resourcePolicy.fuel].includes(r.key)).slice(0,4).map((r,i)=>[r.key,i<2?'< 25%':'< 45%',100-i*10,i<2?'red':'amber']);
  const threats = [['high', '×0.5', 'red', true], ['medium', '×0.75', 'amber'], ['low', '×1.0', 'green']];
  return <Modal title={t('how.title')} onClose={onClose} wide>
    <section className="how-card"><h4><i>1</i>{t('how.s1')}</h4>
      <div className="score-grid">{scores.map(([k, cond, v, c]) => <div key={k} className={`score ${c}`}><small>{resName(t, k)} <bdi dir="ltr">{cond}</bdi></small><b>{v}</b></div>)}</div>
      <p className="how-note">{t('how.s1note')}</p>
    </section>
    <section className="how-card"><h4><i>2</i>{t('how.s2')}</h4>
      <p>{t('how.s2desc')}</p>
      <code className="formula" dir="ltr">ROP = Critical_Threshold + (Rate_per_sec × Lead_Time_sec × 1.2)</code>
      <p className="how-note">{t('how.s2note')}</p>
    </section>
    <section className="how-card"><h4><i>3</i>{t('how.s3')}</h4>
      {threats.map(([k, f, c, air]) => <div key={k} className={`threat-row ${c}`}><span>{t(`how.threat.${k}`)}</span><b><bdi dir="ltr">{f}</bdi>{air && <em> — {t('how.airOnly')}</em>}</b></div>)}
    </section>
    <section className="how-card"><h4><i>4</i>{t('how.s4')}</h4><p>{t('how.s4desc')}</p></section>
    <section className="how-card"><h4><i>5</i>{t('how.s5')}</h4>
      <p>{t('how.s5formula')}</p>
      <div className="dos-grid"><div className="green"><small><bdi dir="ltr">≥ 3 DOS</bdi></small><b>{t('how.dos.safe')}</b></div><div className="amber"><small><bdi dir="ltr">1.5 – 3 DOS</bdi></small><b>{t('state.warning')}</b></div><div className="red"><small><bdi dir="ltr">&lt; 1.5 DOS</bdi></small><b>{t('state.critical')}</b></div></div>
    </section>
  </Modal>;
}
