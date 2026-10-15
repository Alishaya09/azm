// تنبيهات المخزون
// تنبيهات المخزون: نافذة منبثقة لكل تنبيه جديد، تختفي بعد 10 ثوانٍ
const alertIcon = { warning: '🟡', critical: '🔴', depleted: '⛔' };
const alertText = (t, a, units) => t(`alert.${a.level}`, { unit: nameById(t, units, a.unitId), res: resName(t, a.resource), v: a.value });
function Toasts({ toasts, dismiss, units }) {
  const { t } = useLang();
  return <div className="toasts">{toasts.map(a => <div key={a.id} className={`toast ${a.level}`} onClick={() => dismiss(a.id)}><b>{alertIcon[a.level]} {t(`alert.title.${a.level}`)}</b><span>{alertText(t, a, units)}</span></div>)}</div>;
}

// لوحة التنبيهات: زر "طلب إمداد" يفتح نموذج الطلب الكامل معبّأ بالوحدة والمورد
function AlertsPanel({ me, alerts, units, requests, onRequest }) {
  const { t } = useLang();
  const latest = new Map();
  for (const a of alerts) if (!latest.has(`${a.unitId}:${a.resource}`)) latest.set(`${a.unitId}:${a.resource}`, a);
  const active = [...latest.values()].filter(a => {
    const u = units.find(x => x.id === a.unitId);
    return u && (u[a.resource] ?? 100) <= 45;
  }).sort((a, b) => ({ depleted: 0, critical: 1, warning: 2 }[a.level] ?? 3) - ({ depleted: 0, critical: 1, warning: 2 }[b.level] ?? 3) || b.at - a.at);
  const hasOpen = a => requests.some(r => r.unitId === a.unitId && reqItems(r).some(i => i.resource === a.resource) && (r.status === 'pending' || r.status === 'assigned' || r.status === 'approved'));
  // القائد ومسؤول القاعدة لأي وحدة في نطاقهم (القائمة مفلترة من الخادم)، ومسؤول الوحدة لوحدته
  const canRequest = a => units.some(u => u.id === a.unitId) && (me.role !== 'user' || a.unitId === me.unitId);
  return <section><div className="section-heading"><b>{t('alerts.title')}</b><span>{active.length}</span></div>
    <div className="alert-list">{active.length ? active.slice(0, 6).map(a => <div key={a.id} className={`alert-row ${a.level}`}>
      <span>{alertIcon[a.level]}</span><div><b>{alertText(t, a, units)}</b><small>{a.time}</small></div>
      {canRequest(a) && (hasOpen(a) ? <em>{t('alerts.requested')}</em> : <button onClick={() => onRequest(a)}>{t('alerts.request')}</button>)}
    </div>) : <p className="empty">{t('alerts.none')}</p>}</div>
  </section>;
}
