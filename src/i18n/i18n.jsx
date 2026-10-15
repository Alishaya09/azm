// نظام اللغة: سياق اللغة، دالة الترجمة t، وزر التبديل
const errText = (t, e) => dict[`err.${e?.code}`] ? t(`err.${e.code}`) : t('err.generic');
// تفاصيل الخطأ من الخادم (تُعرض بعد نص الخطأ): السعة والرصيد وبالطريق لكل صنف، نقص المصدر، أو الطلبات اللي تمنع الأرشفة
const errDetail = (t, e) => {
  if (!e) return '';
  const rooms = Array.isArray(e.room) ? e.room : Array.isArray(e.rooms) ? e.rooms : null;
  if (rooms) return ' — ' + rooms.map(x => t('err.detail.capacity', { res: resName(t, x.resource), qty: fmtQty(x.qty ?? 0), cap: fmtQty(x.capacity ?? 0), cur: fmtQty(x.current ?? 0), tr: fmtQty(x.inTransit ?? 0), room: fmtQty(x.room ?? 0), unit: resUnitName(t, x.resource) })).join(' · ');
  if (Array.isArray(e.shortages)) return ' — ' + e.shortages.map(x => t('err.detail.shortage', { res: resName(t, x.resource), qty: fmtQty(x.qty), av: fmtQty(x.available), unit: resUnitName(t, x.resource) })).join(' · ');
  if (Array.isArray(e.requests) && e.requests.length) return ' — ' + t('err.detail.inUse', { list: e.requests.map(r => `${r.id} (${t(`req.status.${r.status}`)}${r.stalled ? ` · ${t('req.stalledShort')}` : ''})`).join('، ') });
  if (Array.isArray(e.children) && e.children.length) return ' — ' + t('err.detail.children', { list: e.children.join('، ') });
  return '';
};

const LangContext = createContext(null);
const useLang = () => useContext(LangContext);
const makeT = lang => (key, vars = {}) => {
  const s = dict[key] ? dict[key][lang === 'ar' ? 0 : 1] : String(key ?? '');
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
};
const langKey = 'azm-lang';
const loadLang = () => { try { return localStorage.getItem(langKey) === 'en' ? 'en' : 'ar'; } catch { return 'ar'; } };

function LangToggle() {
  const { t, setLang, lang } = useLang();
  return <button className="lang-toggle" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>🌐 {t('lang.switch')}</button>;
}
