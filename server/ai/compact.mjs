// تصغير ما يُرسل لنموذج المحادثة حتى يناسب نافذة سياقه (النموذج المحلي على 8002 يقبل 4096 توكن افتراضياً).
// اللقطة الكاملة (buildContext) تبقى كما هي للأدوات؛ هنا نقدّم الأهم (النقص، الطلبات المعلقة، آخر الحركات)
// ونذكر المحذوف صراحة حتى يطلب النموذج التفاصيل عبر أدوات القراءة بدل التخمين. الصلاحيات لا تتغير: نصغّر لقطة مفلترة أصلاً.
const REORDER = 45, CRITICAL = 25;
const size = v => JSON.stringify(v).length;
const nonZero = o => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v));
const minute = t => t ? new Date(t).toISOString().slice(0, 16) : null;
const text = v => typeof v === 'string' ? v : [v?.ar, v?.en].filter(Boolean).join(' / ');

// full = كل النسب · low = ما تحت نقطة إعادة الطلب فقط · counts = أعداد فقط
function stockView(percent, mode) {
  const entries = Object.entries(percent || {});
  if (mode === 'full') return { stockPercent: percent };
  const low = entries.filter(([, v]) => v < REORDER), okCount = entries.length - low.length;
  if (mode === 'low') return { depleted: low.filter(([, v]) => v <= 0).map(([k]) => k), belowReorderPercent: Object.fromEntries(low.filter(([, v]) => v > 0)), okCount };
  return { depletedCount: low.filter(([, v]) => v <= 0).length, criticalCount: low.filter(([, v]) => v > 0 && v < CRITICAL).length,
    belowReorderCount: low.filter(([, v]) => v >= CRITICAL).length, okCount };
}
const depotPercent = d => Object.fromEntries(Object.entries(d.capacity || {}).map(([k, c]) => [k, c ? Math.round((d.stockQty?.[k] || 0) / c * 100) : 0]));
// الموارد المذكورة في السؤال تُرسل بأرقامها الفعلية حتى في اللقطة المصغّرة
const focusView = (percent, qty, capacity, keys) => keys.length ? { askedResources: Object.fromEntries(keys.filter(k => k in (percent || {}))
  .map(k => [k, { percent: percent[k], qty: Math.round(qty?.[k] || 0), capacity: capacity?.[k] ?? null }])) } : {};
const unitRow = (u, mode, focus = NO_FOCUS) => {
  mode = focus.ids.includes(u.id) ? 'full' : mode;
  return { id: u.id, name: u.name, baseId: u.baseId, base: u.base, optempo: u.optempo, fuelType: u.fuelType,
    ...(u.people != null ? { people: u.people } : {}), ...(u.vehicles != null ? { vehicles: u.vehicles } : {}),
    ...focusView(u.stockPercent, u.stockQty, u.capacity, focus.keys),
    ...stockView(u.stockPercent, mode), ...(mode === 'full' ? { stockQty: nonZero(u.stockQty) } : {}), inTransit: nonZero(u.inTransit) };
};
const depotRow = (d, mode, focus = NO_FOCUS) => {
  mode = focus.ids.includes(d.id) ? 'full' : mode;
  const percent = depotPercent(d);
  return { id: d.id, type: d.type, name: d.name, baseId: d.baseId,
    ...focusView(percent, d.stockQty, d.capacity, focus.keys),
    ...stockView(percent, mode), ...(mode === 'full' ? { stockQty: nonZero(d.stockQty) } : {}), inTransit: nonZero(d.inTransit) };
};
const NO_FOCUS = { keys: [], ids: [] };

// مطابقة السؤال بأسماء الموارد (وأسمائها البديلة) والوحدات والمستودعات؛ تقريبية ولا تمنح أي صلاحية إضافية
const norm = s => ` ${String(s || '').toLowerCase().normalize('NFKC').replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(Boolean).map(w => w.length > 4 && w.startsWith('ال') ? w.slice(2) : w).join(' ')} `;
const mentions = (q, names) => names.some(n => { const v = norm(n); return v.trim().length >= 3 && q.includes(v); });
export function questionFocus(question, ctx, aliases = {}) {
  const q = norm(question);
  return {
    keys: ctx.resources.filter(r => mentions(q, [r.key.replace(/^azm_/, '').replace(/_/g, ' '), r.name?.ar, r.name?.en, ...(aliases[r.key] || [])])).map(r => r.key),
    ids: [...ctx.units, ...ctx.depots].filter(e => mentions(q, [e.name, e.id])).map(e => e.id),
  };
}
const severity = r => (r.depletedCount || 0) * 2 + (r.criticalCount || 0);
const requestRow = r => ({ id: r.id, kind: r.kind, unitId: r.unitId, baseId: r.baseId, target: r.target?.name || null,
  source: r.source?.restricted ? 'restricted' : r.source?.name || null, status: r.status, shipmentStatus: r.shipmentStatus,
  priority: r.priority, mode: r.mode, items: Object.fromEntries((r.items || []).map(i => [i.resource, i.qty])),
  ...(r.dispatched?.length ? { dispatched: r.dispatched } : {}), ...(r.delivered?.length ? { delivered: r.delivered } : {}),
  etaHours: r.etaHours, createdAt: minute(r.createdAt), decidedBy: r.decidedBy || undefined, notes: typeof r.notes === 'string' ? r.notes.slice(0, 200) : r.notes });
const movementRow = m => ({ at: minute(m.at), type: m.type, resource: m.resource, qty: m.qty, measure: m.measure,
  from: m.from?.label || m.from?.code || null, to: m.to?.label || m.to?.code || null, requestId: m.requestId || undefined });
// المعلقة أولاً ثم الأحدث
const pickRequests = (list, n) => {
  if (n <= 0) return [];
  const pending = list.filter(r => r.status === 'pending').slice(-n), rest = n - pending.length;
  return [...pending, ...(rest > 0 ? list.filter(r => r.status !== 'pending').slice(-rest) : [])];
};

const LEAN = { stock: 'counts', requests: 0, movements: 0, alerts: 0, locations: 0 };
const LEVELS = [
  { stock: 'full', requests: 30, movements: 20, alerts: 15 },
  { stock: 'low', requests: 20, movements: 10, alerts: 10 },
  { stock: 'low', requests: 10, movements: 5, alerts: 5 },
  // الطلبات أهم من تفصيل كل مورد: تبقى حتى في أصغر مستوى
  { stock: 'counts', requests: 10, movements: 3, alerts: 3 },
  { stock: 'counts', requests: 5, movements: 0, alerts: 0 },
];

function buildLevel(ctx, lv, limit = Infinity, focus = NO_FOCUS) {
  let units = ctx.units.map(u => unitRow(u, lv.stock, focus)), depots = ctx.depots.map(d => depotRow(d, lv.stock, focus));
  if (limit < Infinity) {
    // المذكور في السؤال أولاً ثم الأشد نقصاً
    const rank = r => (focus.ids.includes(r.id) ? 1e6 : 0) + severity(r);
    units = units.sort((a, b) => rank(b) - rank(a)).slice(0, limit);
    depots = depots.sort((a, b) => rank(b) - rank(a)).slice(0, limit);
  }
  const requests = pickRequests(ctx.requests, lv.requests).map(requestRow);
  // مواقع الجهات الظاهرة للسائل (من نفس اللقطة المفلترة): صغيرة وثابتة في كل المستويات حتى لا يخمّن النموذج إحداثيات
  const coord = p => Array.isArray(p) ? [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4] : null;
  const locations = [...(ctx.mainSupplyCenter || []).map(n => ({ name: n.name, type: 'main_base', pos: coord(n.pos) })),
    ...ctx.depots.map(d => ({ name: d.name, type: d.type, pos: coord(d.pos) })), ...ctx.units.map(u => ({ name: u.name, type: 'unit', pos: coord(u.pos) }))].filter(l => l.pos).slice(0, lv.locations ?? 40);
  const body = {
    simulation: ctx.simulation, thresholds: ctx.thresholds, locations,
    mainSupplyCenter: (ctx.mainSupplyCenter || []).map(n => ({ id: n.id, code: n.code, name: n.name, unlimited: true, replenishedBy: 'admin' })),
    ...(ctx.virtualSupply ? { virtualSupply: ctx.virtualSupply } : {}),
    units, unitsOmitted: ctx.units.length - units.length,
    depots, depotsOmitted: ctx.depots.length - depots.length,
    ...(ctx.supplyChain ? { supplyChain: ctx.supplyChain } : {}),
    requests, requestCount: ctx.requestCount, requestsOmitted: ctx.requestCount - requests.length,
    recentMovements: (lv.movements ? ctx.recentMovements.slice(-lv.movements) : []).map(movementRow),
    recentAlerts: ctx.recentAlerts.slice(0, lv.alerts),
  };
  // أسماء الموارد المذكورة فقط (كلها في المستوى الكامل)
  const used = JSON.stringify(body);
  const resources = Object.fromEntries(ctx.resources.filter(r => lv.stock === 'full' || used.includes(`"${r.key}"`)).map(r => [r.key, `${text(r.name)} (${text(r.unit) || r.measure})`]));
  return { generatedAt: ctx.generatedAt, viewer: ctx.viewer, scopeNote: ctx.scopeNote,
    detailNote: (lv.stock === 'full' ? 'Unit stockPercent lists the resources each unit may request; depot stockPercent is of capacity.'
      : 'Compacted snapshot: resources below the 45% reorder point are listed by name. okCount, depletedCount, criticalCount and belowReorderCount are NUMBERS OF RESOURCES, never stock levels. If a resource is not listed for an entity, its exact level is not in this snapshot: call read_inventory with that entity id.')
      + (focus.keys.length ? ' askedResources gives the exact percent, quantity and capacity of the resources the user asked about; answer from it.' : ''),
    resources, ...body };
}

export function compactContext(ctx, max, focus = NO_FOCUS) {
  let out;
  for (const lv of LEVELS) if (size(out = buildLevel(ctx, lv, Infinity, focus)) <= max) return out;
  // آخر حل: نعرض المذكور في السؤال والأشد نقصاً فقط مع عدد المحذوف
  const last = LEVELS.at(-1);
  // ثم نفس الشي بدون قائمة المواقع (الإحداثيات يجاوبها الخادم من direct.mjs)
  for (const lv of [last, { ...last, locations: 0 }])
    for (let n = Math.max(ctx.units.length, ctx.depots.length); n > 0; n = Math.floor(n / 2)) if (size(out = buildLevel(ctx, lv, n, focus)) <= max) return out;
  // بدون صفوف ولا طلبات ولا مواقع (الإحداثيات يجاوبها الخادم من direct.mjs، والتفاصيل من أدوات القراءة)
  if (size(out = buildLevel(ctx, LEAN, 0, focus)) <= max) return out;
  // الحد الأدنى المضمون: هوية السائل ونطاقه والأعداد فقط، حتى لا يتجاوز البرومبت نافذة النموذج مهما كبرت البيانات
  return { generatedAt: ctx.generatedAt, viewer: ctx.viewer, scopeNote: ctx.scopeNote,
    detailNote: 'Minimal snapshot: no entity rows fit the model context. Call read_inventory, read_requests, read_report, read_locations or read_users for any detail.',
    unitsOmitted: ctx.units.length, depotsOmitted: ctx.depots.length, requestCount: ctx.requestCount, requestsOmitted: ctx.requestCount };
}

// نتيجة أداة قراءة داخل حدود السياق؛ لا تغيّر نتيجة مسار /api/ai/tools/read نفسه
export function fitToolResult(result, max) {
  if (result?.error || size(result) <= max) return JSON.stringify(result);
  const d = result.data || {};
  if (result.name === 'read_inventory') for (const mode of ['full', 'low', 'counts']) {
    const v = { name: result.name, data: { units: d.units.map(u => unitRow(u, mode)), depots: d.depots.map(x => depotRow(x, mode)) } };
    if (size(v) <= max) return JSON.stringify(v);
  }
  if (result.name === 'read_requests') for (let n = Math.min(30, d.requests.length); n > 0; n = Math.floor(n / 2)) {
    const v = { name: result.name, data: { total: d.total, requests: d.requests.slice(-n), omitted: d.total - n } };
    if (size(v) <= max) return JSON.stringify(v);
  }
  return JSON.stringify({ name: result.name, truncated: true, note: 'Result truncated to fit the model context. Ask a narrower question (one unit, resource or period).',
    partial: JSON.stringify(result.data).slice(0, Math.max(0, max - 300)) });
}
