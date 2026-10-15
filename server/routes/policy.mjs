// مراجعة سياسة موارد الوحدات — للقائد فقط (قراءة فقط، لا تغيّر أي رصيد أو طلب):
//   GET /api/policy/review
// تعرض ما بقي من السياسة السابقة دون حذفه: أصناف غير تشغيلية مخصصة لوحدات وبرصيدها، وحدات نوع وقودها غير محدد،
// طلبات معلقة أو معتمدة لأصناف خارج السياسة، وشحنات قديمة بالطريق تُسلَّم مرة واحدة كالمعتاد، وملخص ترحيل v8.
import { send } from '../lib/http.mjs';
import { inboundTo, requestItems, shipmentOf, state } from '../store/state.mjs';
import { FUEL_KEYS, OPERATIONAL_FOOD } from '../store/catalog.mjs';
import { layoutNodes, qtyOf, round3, unitFuelType, unitLegacyKeys, unitOperationalKeys, unitRequestable } from '../store/hierarchy.mjs';
import { users } from '../store/users.mjs';

export async function handlePolicy({ path, method, isAdmin, forbidden, res }) {
  if (path !== '/api/policy/review' || method !== 'GET') return false;
  if (!isAdmin) return forbidden();
  const units = layoutNodes().filter(n => n.type === 'unit').map(n => {
    const inbound = inboundTo(n.id);
    return {
      unitId: n.unitId, nodeId: n.id, baseId: n.baseId || null, label: n.label || null,
      fuelType: unitFuelType(n), fuelTypeSource: n.fuelTypeSource || null,
      operational: unitOperationalKeys(n.unitId),
      missingFood: OPERATIONAL_FOOD.filter(k => !(n.allowedResources || []).includes(k)),
      legacy: unitLegacyKeys(n.unitId).map(k => ({ resource: k, qty: round3(qtyOf(n.id, k)), inTransit: inbound[k] || 0, fuel: FUEL_KEYS.includes(k) })),
    };
  });
  const legacyRequest = r => r.kind !== 'base' && requestItems(r).some(i => !unitRequestable(r.unitId, i.resource));
  const brief = r => ({ id: r.id, unitId: r.unitId, baseId: r.baseId || null, status: r.status, legacyPolicy: r.legacyPolicy || null, items: (r.status === 'approved' ? shipmentOf(r) : requestItems(r)).map(i => ({ resource: i.resource, qty: i.qty ?? null })) });
  const activeManagers = Object.fromEntries(layoutNodes().filter(n => n.type === 'main').map(b => [b.id, users.filter(u => u.role === 'base_manager' && u.baseId === b.id && u.status === 'active').length]));
  return send(res, 200, {
    policy: { food: OPERATIONAL_FOOD, fuel: FUEL_KEYS },
    units: units.filter(u => u.legacy.length || u.missingFood.length),
    unknownFuel: [],
    legacyRequests: state.requests.filter(r => ['pending', 'assigned'].includes(r.status) && legacyRequest(r)).map(brief),
    legacyInTransit: state.requests.filter(r => r.status === 'approved' && !r.stalled && legacyRequest(r)).map(brief),
    basesWithoutManager: Object.entries(activeManagers).filter(([, n]) => !n).map(([id]) => id),
    migration: state.policyV8 || null,
    currentMigration: state.policyV10 || null,
  });
}
