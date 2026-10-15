// ملخص المسار
// ملخص المسار (من وين، كم كيلو، كم ساعة) أو تنبيه إذا ما فيه مسار
function RouteInfo({ route, mode }) {
  const { t } = useLang();
  if (!route) return <small className="no-route">{t(mode === 'truck' ? 'dash.noRoute' : 'dash.noSource')}</small>;
  return <small className="route-info">{t('dash.route', { from: nodeName(route.from, t), km: Math.round(route.km), h: route.hours.toFixed(1) })}</small>;
}
