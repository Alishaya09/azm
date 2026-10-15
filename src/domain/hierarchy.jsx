// الهيكل التنظيمي والمستودعات: القيادة ← القواعد ← (مراكز الإمداد + الوحدات)
// التبعية ثابتة على نقاط الخريطة من الخادم: المركز والوحدة baseId فقط (مصدر الإمداد يُختار لكل شحنة)
// سعة المستودعات من كتالوج الموارد (القائد يعدّلها). السعة الرسمية لكل كيان تجي من الخادم في inventory
const depotCapOf = type => Object.fromEntries(allResources.map(r => [r.key, r.capacity?.[type] ?? 0]));
const RANKS = ['private', 'private1', 'corporal', 'vsergeant', 'sergeant', 'ssergeant', 'msergeant', 'lt', '1lt', 'captain', 'major', 'ltcol', 'colonel', 'brigadier', 'majgen', 'ltgen', 'civilian'];

// الكمية الفعلية في الوحدة = النسبة × سعتها
const unitQty = (u, key) => u.qty?.[key] ?? capacityOf(u, key) * (u[key] || 0) / 100;
// التبعية ثابتة: المركز والوحدة ← القاعدة (مصدر الإمداد يُختار لكل شحنة وما هو جزء من التبعية)
const parentOf = (node, hierarchy) => node.type === 'main' || node.type === 'hq' ? null : (node.baseId || hierarchy?.[node.id] || null);
// سجل قديم بدون قاعدة صالحة — الوحيد اللي يحتاج إصلاح من القائد
const needsReview = (n, layout) => n.type !== 'main' && n.type !== 'hq' && !layout.nodes.some(b => b.type === 'main' && b.id === n.baseId);

// يبني الشجرة: [{ base, fsbs: [node], units: [node] }]
function buildTree(layout) {
  const nodes = layout.nodes, bases = nodes.filter(n => n.type === 'main');
  return bases.map(base => ({ base, fsbs: nodes.filter(n => n.type === 'fsb' && n.baseId === base.id), units: nodes.filter(n => n.type === 'unit' && n.baseId === base.id) }));
}

// هل مستودع المصدر يكفي لطلب؟ يرجع null إذا ما نعرف المستودع (مسؤول الوحدة ما يستلم أرصدة المستودعات)
function stockCheck(r, route, depots, unit) {
  const depot = route && depots?.[route.from.id];
  if (!depot || !unit) return null;
  const needs = reqItems(r).map(i => ({ resource: i.resource, qty: i.qty ?? Math.round(capacityOf(unit, i.resource) * i.amount / 100) }));
  return { from: route.from, needs, shortages: needs.filter(n => depot[n.resource] < n.qty).map(n => ({ ...n, available: Math.floor(depot[n.resource]) })) };
}
function StockCheck({ check }) {
  const { t } = useLang();
  if (!check) return null;
  if (!check.shortages.length) return <small className="stock-ok">✓ {t('db.stockOk', { from: nodeName(check.from, t) })}</small>;
  return <small className="stock-short">⚠ {t('db.stockShort', { from: nodeName(check.from, t) })} {check.shortages.map(s => `${resName(t, s.resource)} (${fmtQty(s.available)} / ${fmtQty(s.qty)})`).join('، ')}</small>;
}
