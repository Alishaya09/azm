// حساب المسارات (Dijkstra + OSRM) وتقدّم القوافل
// ===== المسارات والتتبع =====
const TRUCK_KMH = 60, AIR_KMH = 240;
// مدة العرض: كل ساعة تشغيلية = دقيقة فعلية. القيمة الفعلية تجي من الخادم (hourMs في /api/state)
let HOUR_MS = 60000;
const haversineKm = (a, b) => {
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
// مسار بري فعلي على الطرق من خدمة OSRM المجانية (يحتاج إنترنت)
const fetchRoadRoute = async (a, b) => {
  const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=simplified&geometries=geojson`);
  const d = await r.json(); if (d.code !== 'Ok' || !d.routes?.length) throw new Error('no_route');
  return { geometry: [a, ...d.routes[0].geometry.coordinates.map(([lng, lat]) => [+lat.toFixed(5), +lng.toFixed(5)]), b], km: Math.round(d.routes[0].distance / 100) / 10 };
};
const linkKm = (l, byId) => l.km ?? haversineKm(byId[l.from].pos, byId[l.to].pos);
const linkPathFrom = (l, startId, byId) => { const g = l.geometry || [byId[l.from].pos, byId[l.to].pos]; return l.from === startId ? g : [...g].reverse(); };
// مصدر شحنة جديدة: مستودع قاعدة أو مركز فعلي فقط.
const isSupply = n => n.type === 'main' || n.type === 'fsb';
// أقصر مسار (Dijkstra) بين المصدر والوحدة عبر روابط من نوع واحد، ويرجع المسار من المصدر إلى الوحدة
const shortestBetween = (layout, sourceId, targetId, kind) => {
  const byId = Object.fromEntries(layout.nodes.map(n => [n.id, n]));
  const links = layout.links.filter(l => l.kind === kind && byId[l.from] && byId[l.to]);
  const dist = { [targetId]: 0 }, prev = {}, done = new Set();
  for (;;) {
    let cur = null; for (const id in dist) if (!done.has(id) && (cur === null || dist[id] < dist[cur])) cur = id;
    if (cur === null) return null;
    if (cur === sourceId) {
      const path = []; let node = cur;
      while (node !== targetId) { const { via, link } = prev[node]; const seg = linkPathFrom(link, node, byId); path.push(...(path.length ? seg.slice(1) : seg)); node = via; }
      return { from: byId[cur], path, km: dist[cur] };
    }
    done.add(cur);
    for (const l of links) {
      if (l.from !== cur && l.to !== cur) continue;
      const other = l.from === cur ? l.to : l.from; if (done.has(other)) continue;
      const d = dist[cur] + linkKm(l, byId); if (dist[other] === undefined || d < dist[other]) { dist[other] = d; prev[other] = { via: cur, link: l }; }
    }
  }
};
// المصدر المقترح للوحدة: مركز تابع لقاعدتها أولاً، وإلا مستودع القاعدة. القائد يختاره لكل شحنة.
const defaultSourceId = (layout, unitId) => {
  const u = layout.nodes.find(n => n.type === 'unit' && n.unitId === unitId); if (!u) return null;
  const legacy = u.supplyId && layout.nodes.find(n => n.id === u.supplyId && n.type === 'fsb');
  return legacy && legacy.baseId === u.baseId ? legacy.id : (layout.nodes.find(n => n.type === 'fsb' && u.baseId && n.baseId === u.baseId)?.id || u.baseId || null);
};
// المسار يبدأ دائماً من المصدر المختار — ما يُستبدل تلقائياً بمصدر أقرب
// الشاحنة تمشي على الروابط البرية فقط؛ الطائرة تستخدم الروابط الجوية إن وجدت، وإلا تطير مباشرة من المصدر
// مسار من مصدر محدد إلى أي وجهة (وحدة أو مستودع قاعدة)
const planRouteBetween = (layout, fromId, targetId, mode) => {
  const from = layout.nodes.find(n => n.id === fromId), target = layout.nodes.find(n => n.id === targetId);
  if (!from || !target || !isSupply(from)) return null;
  if (mode === 'truck') { const r = shortestBetween(layout, from.id, target.id, 'road'); return r && { ...r, hours: r.km / TRUCK_KMH }; }
  const viaAir = shortestBetween(layout, from.id, target.id, 'air'); if (viaAir) return { ...viaAir, hours: viaAir.km / AIR_KMH };
  const km = haversineKm(from.pos, target.pos); return { from, path: [from.pos, target.pos], km, hours: km / AIR_KMH };
};
const planRoute = (layout, unitId, mode, fromId = null) => {
  const target = layout.nodes.find(n => n.type === 'unit' && n.unitId === unitId); if (!target) return null;
  return planRouteBetween(layout, fromId || defaultSourceId(layout, unitId), target.id, mode);
};
// طلب الوحدة له مسار من المصدر المختار؛ احتياج القاعدة الجديد بلا مسار.
const hqNodeOf = layout => layout.nodes.find(n => n.type === 'hq') || null;
const routeForRequest = (layout, r, fromId = null) => r.kind === 'base' ? null : planRoute(layout, r.unitId, r.mode, fromId);
// المصادر الممكنة لشحنة: مستودع قاعدة الوحدة ومراكزها أولاً، والقائد بعدها أي مستودع قاعدة أو مركز في النظام.
// (الخريطة اللي يستلمها مسؤول القاعدة فيها مستودعات قاعدته فقط، والخادم يتحقق من الصلاحية مرة ثانية)
const sourceOptions = (layout, unitId, includeOtherBases) => {
  const u = layout.nodes.find(n => n.type === 'unit' && n.unitId === unitId); if (!u) return { same: [], other: [] };
  const depotBase = n => n.type === 'main' ? n.id : n.baseId;
  const all = layout.nodes.filter(isSupply), same = all.filter(n => u.baseId && depotBase(n) === u.baseId).sort((a, b) => (a.type === 'main' ? 0 : 1) - (b.type === 'main' ? 0 : 1));
  return { same, other: includeOtherBases ? all.filter(n => !same.includes(n)).sort((a, b) => (a.type === 'hq' ? 0 : 1) - (b.type === 'hq' ? 0 : 1)) : [] };
};
const pointAlong = (path, p) => {
  if (path.length < 2) return path[0];
  const seg = path.slice(1).map((b, i) => haversineKm(path[i], b)), total = seg.reduce((s, x) => s + x, 0);
  let left = total * Math.min(1, Math.max(0, p));
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i] || i === seg.length - 1) { const f = seg[i] ? Math.min(1, left / seg[i]) : 0; const a = path[i], b = path[i + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; }
    left -= seg[i];
  }
};
// التقدم بساعات المحاكاة: simHours من simClock() (تتأثر بسرعة المحاكاة)
const convoyProgress = (c, simHours) => c.departSim != null ? Math.min(1, Math.max(0, (simHours - c.departSim) / c.eta)) : 0;
