// لقطة من حالة العمليات تُرسل للنموذج مع كل سؤال، حتى يجاوب على بيانات حقيقية.
// تحترم الصلاحيات عبر نفس نطاق الواجهة (store/scope.mjs):
//   القائد: كل القواعد والمراكز والوحدات · مسؤول القاعدة: قاعدته وما تحتها · مسؤول الوحدة: وحدته فقط + أسماء سلسلة إمدادها.
// النموذج للقراءة والتحليل فقط — ما يستلم كلمات مرور أو جلسات، والخادم ما ينفّذ أي شي من رده.
import { activeKeys, catalog } from '../store/catalog.mjs';
import { state, unitStart, requestItems, inTransitTo, inboundTo } from '../store/state.mjs';
import { capacityOf, layoutNodes, qtyAll, requiredQty, unitAllows, unitFuelType } from '../store/hierarchy.mjs';
import { canSeeAlert, canSeeMovement, canSeeRequest, redactMovement, redactRequest, scopeOf } from '../store/scope.mjs';
import { allMovements } from '../store/ledger.mjs';

const round = v => Math.round(v * 10) / 10;
// أسماء النقاط والوحدات الافتراضية (في الواجهة تُترجم من مفاتيح؛ هنا نرسل الاسم الإنجليزي للنموذج)
const DEFAULT_NAMES = {
  'map.hq': 'Main Base near Riyadh',
  'map.base': 'Main Base', 'map.fsbWest': 'West Supply Point', 'map.fsbCenter': 'Central Supply Point', 'map.fsbSouth': 'South Supply Point',
  'map.newBase': 'New Base', 'map.newFsb': 'New Supply Point',
  'UNIT-01': '1st Infantry Division', 'UNIT-02': '2nd Armored Division', 'UNIT-03': 'Southern Border Division',
};
export const nodeLabel = n => n.label || DEFAULT_NAMES[n.labelKey] || DEFAULT_NAMES[n.unitId] || n.id;
const qtyRow = (q, keys = activeKeys()) => Object.fromEntries(keys.map(r => [r, Math.round(q[r] || 0)]));

export function buildContext(user) {
  const s = scopeOf(user), nodes = layoutNodes(), byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  const units = nodes.filter(n => n.type === 'unit' && s.unitIds.has(n.unitId));
  const depots = nodes.filter(n => s.depotIds.has(n.id));
  const visibleRequests = state.requests.filter(r => canSeeRequest(s, r)).map(r => redactRequest(s, r));
  // الطلبات المعلقة القديمة تبقى مرئية ولو تجاوزت آخر ثلاثين طلباً؛ اللقطة محدودة الحجم.
  const selected = [...new Map([...visibleRequests.filter(r => r.status === 'pending').slice(-30), ...visibleRequests.slice(-30)].map(r => [r.id, r])).values()];
  const party = id => id && s.nodeIds.has(id) && byId[id] ? { id, name: nodeLabel(byId[id]), type: byId[id].type } : id ? { restricted: true } : null;
  return {
    generatedAt: new Date().toISOString(),
    viewer: { username: user.username, fullName: user.fullName || null, rank: user.rank || null, role: user.role, baseId: s.baseId, unitId: s.unitId },
    scopeNote: s.all ? 'Commander: detailed resources of all bases, supply points and units.' : s.role === 'base_manager' ? 'Base manager: only this base, its supply points and the units under it.' : 'Unit manager: only this unit; base and supply point names only, no balances.',
    simulation: { speed: state.sim.speed, paused: state.sim.speed === 0, operationalHours: round(state.sim.hours), note: 'Consumption rates are editable simulation values, not confirmed field rates. All received consumables use catalog rates; vehicle fuel demand is shared proportionally across available fuels.' },
    thresholds: { reorderPointPercent: 45, criticalPercent: 25 },
    resources: catalog().filter(c => c.active && (s.role !== 'user' || unitAllows(s.unitId, c.key))).map(c => ({ key: c.key, name: c.name, unit: c.unit, measure: c.measure })),
    mainSupplyCenter: s.role === 'user' ? [] : nodes.filter(n => n.type === 'hq' && s.nodeIds.has(n.id)).map(n => ({ id: n.id, code: n.code, name: nodeLabel(n), unlimited: true, pos: n.pos, baseDepotsOnly: true, replenishedBy: 'admin' })),
    ...(s.all ? { virtualSupply: { unlimited: true, baseDepotsOnly: true, geographic: true, entityId: 'hq-riyadh' } } : {}),
    units: units.map(n => {
      const s2 = state.stocks[n.unitId] || unitStart(n.unitId), keys = activeKeys().filter(k => unitAllows(n.unitId, k));
      return { id: n.unitId, name: nodeLabel(n), pos: n.pos, baseId: n.baseId || null, base: byId[n.baseId] ? nodeLabel(byId[n.baseId]) : null, optempo: unitStart(n.unitId).optempo,
        people: n.people ?? unitStart(n.unitId).people ?? null, vehicles: n.vehicles ?? unitStart(n.unitId).vehicles ?? null,
        fuelType: unitFuelType(n) || 'not_set', requestableResources: activeKeys().filter(k=>unitAllows(n.unitId,k)),
        stockPercent: Object.fromEntries(keys.map(k => [k, round(s2[k] || 0)])), stockQty: qtyRow(qtyAll(n.id), keys), capacity: Object.fromEntries(keys.map(k => [k, capacityOf(n)[k]])), inTransit: qtyRow(inTransitTo(n.unitId), keys) };
    }),
    // المستودعات بأرصدتها داخل النطاق فقط (مسؤول الوحدة: ولا وحدة)
    depots: depots.map(n => ({ id: n.id, type: n.type === 'main' ? 'base' : 'supply_point', name: nodeLabel(n), pos: n.pos, baseId: n.type === 'main' ? n.id : n.baseId || null, stockQty: qtyRow(qtyAll(n.id)), capacity: Object.fromEntries(activeKeys().map(k => [k, capacityOf(n)[k]])), inTransit: qtyRow(inboundTo(n.id)) })),
    // سلسلة الإمداد (أسماء فقط) — لمسؤول الوحدة
    supplyChain: s.role === 'user' ? nodes.filter(n => s.nodeIds.has(n.id) && n.type !== 'unit').map(n => ({ id: n.id, type: n.type === 'main' ? 'base' : 'supply_point', name: nodeLabel(n) })) : undefined,
    requests: selected.map(r => ({
      id: r.id, kind: r.kind === 'base' ? 'base' : 'unit', unitId: r.unitId, baseId: r.baseId || null,
      target: party(r.kind === 'base' ? r.targetId : units.find(n => n.unitId === r.unitId)?.id),
      source: r.fulfillment === 'virtual_supply' ? party('hq-riyadh') : party(r.route?.fromId || r.sourceId), status: r.status,
      shipmentStatus: r.stalled ? 'legacy_approval_without_dispatch' : r.status === 'approved' ? 'in_transit' : r.status === 'assigned' ? 'approved_awaiting_base_manager_execution_no_stock_deducted' : r.status === 'pending' ? 'awaiting_base_manager_or_commander' : r.status,
      executedBy: r.executedBy || null, legacyPolicy: r.legacyPolicy || undefined,
      priority: r.priority || 'normal', mode: r.mode === 'heli' ? 'aircraft' : 'truck',
      items: requestItems(r).map(i => ({ resource: i.resource, amountPercent: i.amount, qty: i.qty ?? requiredQty(r.unitId, i.resource, i.amount ?? 70) })),
      dispatched: r.stalled ? [] : (r.dispatched || []), delivered: r.delivered || [],
      routeKm: r.route?.km ?? null, createdAt: r.createdAt || null, departedAt: r.departAt || null,
      // نص يكتبه المستخدم: بيانات غير موثوقة (لا تعليمات) ومحدودة الطول
      etaHours: r.eta, decidedBy: r.decidedBy || null, notes: r.notes ? String(r.notes).slice(0, 300) : undefined,
    })),
    requestCount: visibleRequests.length,
    requestsOmitted: visibleRequests.length - selected.length,
    recentMovements: allMovements().filter(m => canSeeMovement(s, m)).slice(-20).map(m => {
      const safe = redactMovement(s, m);
      return { id: safe.id, at: safe.at, type: safe.type, resource: safe.resource, qty: safe.qty, measure: safe.measure,
        requestId: safe.requestId || null, from: safe.from || null, to: safe.to || null,
        transit: safe.transit || null, simulated: safe.type === 'consumption' };
    }),
    recentAlerts: state.alerts.filter(a => canSeeAlert(s, a)).slice(0, 15).map(a => ({ unitId: a.unitId, resource: a.resource, level: a.level, valuePercent: a.value, time: a.time })),
  };
}
