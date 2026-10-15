// نافذة OPTECHO™
function Optecho({ onClose }) {
  const { t } = useLang();
  const sensors = [['🎯', 'ARMS — Automated Round Management System', 'opt.arms', 'IoT RFID • Round Counter • Fire Mission Logger'],
    ['⛽', 'FUELS — Fuel Usage Engine Logistics Sensor', 'opt.fuels', 'Vehicle Telematics • Smart Fuel Gauge • GPS Engine Hours'],
    ['🍱', 'VICTUALING — Virtual Inventory Consumption Tracker', 'opt.vict', 'RFID Smart Ration Packs • Automated Inventory'],
    ['💊', 'MEDTRACK — Medical Equipment Dispensing Tracker', 'opt.med', 'Smart Dispensers • MEDEVAC Rate Monitor • Digital Log']];
  return <Modal title={t('opt.title')} onClose={onClose} wide>
    <p className="opt-intro">{t('opt.intro')} <b>{t('opt.question')}</b></p>
    {sensors.map(([icon, name, key, tech]) => <div key={key} className="sensor-card"><span className="sensor-icon">{icon}</span><div>
      <header><b dir="ltr">{name}</b><span className="online">● {t('opt.online')}</span></header>
      <p>{t(key)}</p><small dir="ltr">TECH: {tech}</small></div></div>)}
    <div className="sensor-card engine"><span className="sensor-icon">🧠</span><div><header><b>{t('opt.engine')}</b></header><p>{t('opt.engineDesc')}</p></div></div>
  </Modal>;
}
