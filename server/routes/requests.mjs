// طلبات الإمداد: الإنشاء، القرارات (موافقة/رفض/تغيير الوسيلة لطائرة/إعادة للمراجعة)، المباشرة، والتعليقات.
// نوعان:
//   unit  طلب وحدة: القائد لأي وحدة، مسؤول القاعدة لوحدات قاعدته، مسؤول الوحدة لوحدته فقط (الخادم يتجاهل unitId المرسل).
//         الأصناف التشغيلية للوحدة فقط. مسؤول القاعدة يقرر ويصرف لوحداته؛ والقائد قد يكلّفه بالمباشرة أو يتدخل بنفسه.
//         ثم مسؤول قاعدة الوحدة يباشر (execute): يُعاد فحص كل شيء، ويُخصم مرة واحدة، وتنطلق الشحنة → approved (بالطريق).
//   base  احتياج قاعدة: يرفعه مسؤولها أو القائد، ويزوّد القائد مستودعها من المورد الافتراضي.
// الكميات فعلية بوحدة كل صنف (والنسبة القديمة لا تزال مقبولة للوحدات). الخادم يحسب السعة والرصيد والوارد والمحجوز،
// والإضافة للوجهة مرة وحدة عند التسليم. كل إجراء يقبل operationKey لمنع التنفيذ المكرر.
import { MODES, PRIORITIES } from '../config.mjs';
import { createHash } from 'node:crypto';
import { cleanText, readBody, send, validPoint } from '../lib/http.mjs';
import { addLog, advanceSim, destinationOf, pushHistory, requestItems, shipmentOf, saveState, state } from '../store/state.mjs';
import { activeKeys, isActiveResource, measureOf } from '../store/catalog.mjs';
import { baseIdOf, distanceKm, isDepotNode, isSourceNode, nodeById, qtyOf, requiredQty, unitAllows, unitCapacityOf, unitNodeOf, unitRequestable, unitStock } from '../store/hierarchy.mjs';
import { applyMovement, nextOpId, partyOf, supplyBase, virtualSupplyParty } from '../store/ledger.mjs';
import { canExecuteRequest, canManageRequest, canSeeRequest, redactRequest } from '../store/scope.mjs';
import { stockRoom, executionRoom } from '../store/limits.mjs';
import { findUser } from '../store/users.mjs';

const round = v => Math.round(v * 100) / 100;
// قرار اتخذه القائد (تكليف بانتظار المباشرة): لا يرفضه أو يعيده للمراجعة إلا القائد.
// decidedByRole يُحفظ من الآن؛ السجلات القديمة تُقرأ من دور صاحب القرار.
const commanderDecision = r => r.status === 'assigned' && (r.decidedByRole ? r.decidedByRole === 'admin' : findUser(r.decidedBy)?.role === 'admin');
// تفاصيل السعة لكل مادة في الوجهة: السعة، الرصيد، بالطريق، المتاح — ويرجع المواد اللي تتجاوز
const capacityOver = (dest, needs) => {
  return needs.map(n => {
    return { ...stockRoom(dest, n.resource), qty: n.qty };
  }).filter(x => x.qty > x.room);
};
// مواد الطلب: { resource, qty } بكميات صحيحة، أصناف فعّالة بدون تكرار
const parseItems = raw => {
  if (!Array.isArray(raw) || !raw.length || raw.length > activeKeys().length) return null;
  if (!raw.every(i => isActiveResource(i?.resource)) || new Set(raw.map(i => i.resource)).size !== raw.length) return null;
  if (!raw.every(i => i.fill === undefined || typeof i.fill === 'boolean')) return null;
  return raw;
};

// كمية الطلب الأصلية لا تتغير؛ اختيار القائد للتنفيذ يُحفظ منفصلاً بعد نجاح جميع الفحوص.
const approvalItems = (r, body, dest, source = null) => {
  if (body.items === undefined) return shipmentOf(r).map(i => ({ resource: i.resource, qty: i.qty }));
  const raw = body.items, keys = requestItems(r).map(i => i.resource);
  if (!Array.isArray(raw) || raw.length !== keys.length || raw.some(i => !keys.includes(i?.resource) || (i.fill !== undefined && typeof i.fill !== 'boolean')) || new Set(raw.map(i => i.resource)).size !== raw.length) return null;
  const needs = raw.map(i => ({ resource: i.resource, qty: i.fill === true ? executionRoom(dest, i.resource, source).limit : i.qty }));
  return needs.every(i => Number.isInteger(i.qty) && i.qty > 0 && i.qty <= 1e9) ? needs : null;
};

// One dispatch path for a base manager accepting a normal request, an assigned
// commander order, and an urgent commander intervention. No awaits between
// validation, ledger movements, and changing status.
function dispatchAssigned(r, by) {
  advanceSim();
  const source = nodeById(r.route?.fromId), dest = destinationOf(r), needs = (r.approvedItems || []).map(i => ({ resource: i.resource, qty: i.qty }));
  const failures = [];
  if (!isSourceNode(source)) failures.push({ error: 'invalid_source' });
  else if (!dest) failures.push({ error: 'invalid_unit' });
  else if (!r.route?.path?.length || distanceKm(r.route.path[0], source.pos) > 5 || distanceKm(r.route.path.at(-1), dest.pos) > 5) failures.push({ error: 'route_mismatch' });
  else for (const n of needs) {
    if (!unitAllows(r.unitId, n.resource)) { failures.push({ resource: n.resource, error: 'resource_not_assigned' }); continue; }
    const available = qtyOf(source.id, n.resource), room = stockRoom(dest, n.resource, r.id);
    if (available + 1e-7 < n.qty) failures.push({ resource: n.resource, error: 'insufficient_stock', required: n.qty, available: Math.floor(available), sourceId: source.id });
    if (n.qty > room.room) failures.push({ ...room, resource: n.resource, error: 'over_capacity', required: n.qty });
  }
  if (failures.length || !needs.length) {
    r.executionBlocked = { at: Date.now(), by, failures: failures.length ? failures : [{ error: 'invalid_quantity' }] };
    pushHistory(r, 'assigned', by, 'execution_blocked');
    addLog('execution_blocked', r.id, by, { unitId: r.unitId, baseIds: [...new Set([r.baseId, baseIdOf(source)].filter(Boolean))] });
    return r.executionBlocked.failures;
  }
  const opId = nextOpId('DS'), srcBase = baseIdOf(source), now = Date.now();
  for (const n of needs) applyMovement({ type: 'dispatch', resource: n.resource, qty: n.qty, fromId: source.id, by, requestId: r.id, opId, transit: { to: partyOf(dest.id) }, extra: { decidedBy: r.decidedBy || null, ...(r.crossBase ? { crossBase: true, ...(r.crossBaseReason ? { reason: r.crossBaseReason } : {}) } : {}) } });
  r.dispatched = needs;
  if (r.executionBlocked) { (r.blockedAttempts ||= []).push(r.executionBlocked); delete r.executionBlocked; }
  Object.assign(r, { status: 'approved', executedBy: by, executedAt: now, dispatchOpId: opId, departAt: now, departSim: state.sim.hours, source: partyOf(source.id), destination: partyOf(dest.id) });
  pushHistory(r, 'approved', by, 'executed'); r.history.at(-1).items = needs.map(i => ({ ...i }));
  addLog('dispatched', r.id, by, { unitId: r.unitId, baseIds: [...new Set([r.baseId, srcBase].filter(Boolean))] });
  return null;
}

export async function handleRequests({ req, res, path, method, me, isAdmin, scope, forbidden }) {
  if (path === '/api/requests' && method === 'POST') {
    const b = await readBody(req);
    if(b.deadline!==undefined&&b.deadline!==null&&(typeof b.deadline!=='string'||b.deadline.length>80))return send(res,400,{error:'invalid_request'});
    if (b.operationKey !== undefined && (typeof b.operationKey !== 'string' || !/^[A-Za-z0-9_-]{3,64}$/.test(b.operationKey))) return send(res, 400, { error: 'bad_request' });
    const key = b.operationKey ? `${me.username}:${b.operationKey}` : null;
    const signature = createHash('sha256').update(JSON.stringify(b)).digest('hex');
    const previous = key && state.requestOperations?.[key];
    if (previous) {
      if (previous.signature !== signature) return send(res, 400, { error: 'bad_request' });
      const existing = state.requests.find(r => r.id === previous.id);
      return existing && canSeeRequest(scope, existing) ? send(res, 200, redactRequest(scope, existing)) : forbidden();
    }
    const remember = r => { if (key) (state.requestOperations ||= {})[key] = { signature, id: r.id }; };
    const priority = PRIORITIES.includes(b.priority) ? b.priority : 'normal';
    const mode = MODES.includes(b.mode) ? b.mode : (b.kind === 'base' ? 'truck' : null);

    // ===== طلب احتياج قاعدة =====
    if (b.kind === 'base') {
      if (scope.role === 'user') return forbidden();
      const base = nodeById(scope.role === 'base_manager' ? scope.baseId : b.baseId);
      if (!base || base.type !== 'main') return send(res, 400, { error: 'invalid_base' });
      const raw = parseItems(b.items);
      if (!raw || !raw.every(i => i.fill === true || Number.isInteger(i.qty) && i.qty > 0 && i.qty <= 1e9)) return send(res, 400, { error: 'invalid_quantity' });
      const notes = cleanText(b.notes ?? b.reason);
      if (!notes) return send(res, 400, { error: 'reason_required' });
      const items = raw.map(i => ({ resource: i.resource, qty: i.fill === true ? stockRoom(base, i.resource).room : i.qty, measure: measureOf(i.resource), ...(i.fill === true ? { fill: true } : {}) }));
      if (items.some(i=>i.qty<=0)) return send(res, 400, { error: 'invalid_quantity' });
      const over = capacityOver(base, items);
      if (over.length) return send(res, 409, { error: 'over_capacity', destination: base.id, room: over });
      const eta = Math.max(0.1, Math.min(48, Number(b.eta) || 1));
      const r = { id: `ORD-AZM-${state.nextOrder++}`, kind: 'base', fulfillment: 'virtual_supply', targetId: base.id, baseId: base.id, unitId: null, items, resource: items[0].resource, priority, notes, mode, eta, status: 'pending', by: me.username, byRole: me.role, createdAt: Date.now(), comments: [] };
      pushHistory(r, 'pending', me.username);
      state.requests.push(r); remember(r); addLog('submitted', r.id, me.username, { baseIds: [base.id] }); saveState();
      return send(res, 200, redactRequest(scope, r));
    }

    // ===== طلب وحدة =====
    // الوحدة: مسؤول الوحدة لوحدته دائماً مهما أرسل؛ مسؤول القاعدة لوحدات قاعدته فقط
    const unitId = scope.role === 'user' ? me.unitId : b.unitId;
    if (scope.role === 'base_manager' && !scope.unitIds.has(unitId)) return send(res, 403, { error: 'out_of_scope' });
    const node = unitNodeOf(unitId);
    // قائمة المواد (الجديدة) أو مورد واحد (الصيغة القديمة)
    const raw = parseItems(Array.isArray(b.items) ? b.items : [{ resource: b.resource, amount: b.amount, level: b.level }]);
    if (!node || !mode || !raw) return send(res, 400, { error: 'invalid_request' });
    if (raw.some(i => !unitAllows(unitId, i.resource))) return send(res, 400, { error: 'resource_not_assigned' });
    // الطلبات الجديدة للأصناف التشغيلية للوحدة فقط (الغذاء المخصص + نوع وقودها). بقية الأصناف سياستها لاحقاً.
    const notOperational = raw.filter(i => !unitRequestable(unitId, i.resource)).map(i => i.resource);
    if (notOperational.length) return send(res, 400, { error: 'resource_not_operational', resources: notOperational });
    advanceSim();
    const stock = unitStock(unitId);
    // الكمية الفعلية (qty) أو النسبة القديمة (amount) — التحويل بينهما في الخادم من سعة الوحدة.
    // الصيغة القديمة كانت ترسل qty تقديري مع amount، فـ qty يُعتمد فقط إذا ما فيه amount
    const items = [];
    for (const i of raw) {
      const cap = unitCapacityOf(unitId, i.resource), level = Math.round(stock[i.resource] || 0);
      if (i.fill === true) {
        const room = stockRoom(node, i.resource), qty = room.room;
        // مورد ممتلئ (مع الوارد والمحجوز) لا يُطلب بكمية صفر
        if (!qty) return send(res, 409, { error: 'over_capacity', unitId, destination: node.id, room: [{ ...room, qty: 0 }] });
        items.push({ resource: i.resource, qty, amount: cap ? round(qty / cap * 100) : 0, level, measure: measureOf(i.resource), fill: true });
      } else if (i.amount === undefined && i.qty !== undefined && i.qty !== null) {
        if (!Number.isInteger(i.qty) || i.qty <= 0) return send(res, 400, { error: 'invalid_quantity' });
        items.push({ resource: i.resource, qty: i.qty, amount: cap ? round(i.qty / cap * 100) : 0, level, measure: measureOf(i.resource) });
      } else {
        const amount = Math.max(5, Math.min(100, Math.round(Number(i.amount) || 70)));
        items.push({ resource: i.resource, amount, level, qty: requiredQty(unitId, i.resource, amount), measure: measureOf(i.resource) });
      }
    }
    // يُمنع فقط ما يتجاوز سعة الوحدة بعد احتساب رصيدها والشحنات بالطريق. توفر المصدر يُفحص عند الاعتماد
    const over = capacityOver(node, items);
    if (over.length) return send(res, 409, { error: 'over_capacity', unitId, destination: node.id, room: over });
    const eta = Math.max(0.1, Math.min(48, Number(b.eta) || 1));
    const r = { id: `ORD-AZM-${state.nextOrder++}`, kind: 'unit', unitId, baseId: node.baseId || null, supplyId: node.supplyId || null, items, resource: items[0].resource, level: items[0].level, amount: items[0].amount, priority, notes: cleanText(b.notes), mode, eta, status: 'pending', by: me.username, byRole: me.role, createdAt: Date.now(), comments: [] };
    pushHistory(r, 'pending', me.username);
    if(b.deadline!==undefined)r.deadline=cleanText(b.deadline,80)||null;
    state.requests.push(r); remember(r); addLog('submitted', r.id, me.username, { unitId, baseIds: [r.baseId].filter(Boolean) }); saveState();
    return send(res, 200, redactRequest(scope, r));
  }

  const action = path.match(/^\/api\/requests\/([A-Za-z0-9-]+)\/(approve|reject|air|reopen|execute)$/);
  if (action && method === 'POST') {
    const r = state.requests.find(x => x.id === action[1]);
    if (!r || !canSeeRequest(scope, r)) return send(res, 404, { error: 'not_found' });
    // مسؤول القاعدة يقرر وينفذ طلبات وحداته، والقائد يملك صلاحية التدخل في كل الطلبات.
    if (action[2] === 'execute' ? !canExecuteRequest(scope, r) : !canManageRequest(scope, r)) return forbidden();
    if (!isAdmin && (action[2] === 'reject' || action[2] === 'reopen') && commanderDecision(r)) return send(res, 403, { error: 'commander_decision' });
    const b = await readBody(req);
    // إعادة إرسال نفس الإجراء بنفس operationKey (ضغط مكرر أو انقطاع الرد) ترجع حالة الطلب دون تنفيذ ثانٍ
    if (b.operationKey !== undefined && (typeof b.operationKey !== 'string' || !/^[A-Za-z0-9_-]{3,64}$/.test(b.operationKey))) return send(res, 400, { error: 'bad_request' });
    const opKey = b.operationKey ? `${me.username}:${action[2]}:${r.id}:${b.operationKey}` : null;
    const { operationKey: _ignored, ...payload } = b, opSignature = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const done = opKey && state.actionOperations?.[opKey];
    if (done) return done.signature === opSignature ? send(res, 200, redactRequest(scope, r)) : send(res, 400, { error: 'bad_request' });
    const finish = () => { if (opKey) (state.actionOperations ||= {})[opKey] = { signature: opSignature, at: Date.now() }; saveState(); return send(res, 200, redactRequest(scope, r)); };
    const logScope = (extra = []) => ({ unitId: r.unitId || undefined, baseIds: [...new Set([r.baseId, ...extra].filter(Boolean))] });

    // ===== مباشرة مسؤول القاعدة: إعادة فحص كل شيء ثم خصم مرة واحدة وانطلاق الشحنة =====
    if (action[2] === 'execute') {
      if (r.status !== 'assigned') return send(res, 409, { error: 'not_assigned', status: r.status });
      const failures = dispatchAssigned(r, me.username);
      if (failures) { saveState(); return send(res, 409, { error: 'execution_blocked', failures: redactRequest(scope, r).executionBlocked.failures }); }
      return finish();
    }

    if (action[2] === 'reopen') {
      // اعتماد قديم ما انرسل أبداً: القائد يرجّعه للمراجعة (ما يتغير أي رصيد)
      if (r.stalled) {
        r.reopenedFrom = r.stalled; delete r.stalled; r.status = 'pending';
        pushHistory(r, 'pending', me.username, 'reopened_never_dispatched');
        addLog('submitted', r.id, me.username, logScope());
        return finish();
      }
      // قرار معتمد لم يُباشر بعد: يرجع لقرار القائد مع حفظ القرار السابق كاملاً (لا رصيد تغيّر أصلاً)
      if (r.status !== 'assigned') return send(res, 409, { error: 'not_reopenable', status: r.status });
      (r.previousDecisions ||= []).push({ decidedBy: r.decidedBy, decidedAt: r.decidedAt, approvedItems: r.approvedItems, sourceId: r.route?.fromId || null, mode: r.mode, reopenedBy: me.username, reopenedAt: Date.now(), ...(r.executionBlocked ? { executionBlocked: r.executionBlocked } : {}) });
      for (const k of ['approvedItems', 'route', 'source', 'destination', 'decidedBy', 'decidedByRole', 'decidedAt', 'crossBase', 'crossBaseReason', 'executionBlocked']) delete r[k];
      r.status = 'pending';
      pushHistory(r, 'pending', me.username, 'decision_reopened');
      addLog('reopened', r.id, me.username, logScope());
      return finish();
    }
    // الرفض ممكن قبل المباشرة (معلق أو معتمد بانتظار المباشرة). بقية القرارات للمعلق فقط.
    if (!(r.status === 'pending' || (action[2] === 'reject' && r.status === 'assigned'))) return send(res, 409, { error: 'not_pending', status: r.status });
    // تغيير الوسيلة فقط: يبقى الطلب بانتظار قرار القائد — لا اعتماد ولا شحنة
    if (action[2] === 'air') { if (r.kind === 'base') return send(res, 400, { error: 'invalid_request' }); if (r.mode === 'heli') return finish(); r.mode = 'heli'; r.eta = Math.max(.1, r.eta * .25); pushHistory(r, 'pending', me.username, 'mode_heli'); addLog('mode_changed', r.id, me.username, logScope()); return finish(); }
    else if (action[2] === 'reject') {
      // سبب الرفض ينحفظ على الطلب وكتعليق عشان يشوفه مقدّم الطلب
      const reason = cleanText(b.reason);
      if (reason) (r.comments ||= []).push({ by: me.username, role: me.role, at: Date.now(), text: reason, kind: 'reject' });
      Object.assign(r, { status: 'rejected', decidedBy: me.username, decidedAt: Date.now(), rejectReason: reason || null });
      pushHistory(r, 'rejected', me.username, reason || null);
      addLog('rejected', r.id, me.username, { unitId: r.unitId || undefined, baseIds: [r.baseId].filter(Boolean) });
    } else {
      // احتياج القاعدة: اعتماد القائد يزوّد مستودعها فوراً، بلا موقع مصدر أو شحنة جديدة.
      if (r.kind === 'base') {
        const dest = destinationOf(r);
        if (!dest || dest.type !== 'main') return send(res, 400, { error: 'invalid_target' });
        const needs = approvalItems(r, b, dest);
        if (!needs) return send(res, 400, { error: 'invalid_quantity' });
        const reason = cleanText(b.reason, 300) || cleanText(r.notes, 300);
        if (!reason) return send(res, 400, { error: 'reason_required' });
        const over = capacityOver(dest, needs);
        if (over.length) return send(res, 409, { error: 'over_capacity', destination: dest.id, room: over });
        const { opId } = supplyBase({ baseId: dest.id, items: needs, by: me.username, reason, requestId: r.id });
        Object.assign(r, { fulfillment: 'virtual_supply', supplyOpId: opId, supplied: needs, dispatched: [], delivered: needs, source: virtualSupplyParty(), destination: partyOf(dest.id), status: 'delivered', decidedBy: me.username, decidedAt: Date.now(), deliveredAt: Date.now(), supplyReason: reason });
        r.approvedItems = needs.map(i => ({ ...i }));
        pushHistory(r, 'approved', me.username); r.history.at(-1).items = r.approvedItems;
        pushHistory(r, 'delivered', me.username);
        addLog('approved', r.id, me.username, { baseIds: [r.baseId] });
        addLog('delivered', r.id, me.username, { baseIds: [r.baseId] });
        return finish();
      }
      // قرار المسؤول المخوّل: المصدر + كميات التنفيذ + وسيلة النقل + المسار المحسوب في الواجهة. لا خصم ولا شحنة هنا؛
      // الطلب يصير «معتمد — بانتظار مباشرة مسؤول القاعدة» وتُحجز كمياته في سعة الوحدة.
      const mode = b.mode === undefined ? r.mode : b.mode;
      if (!MODES.includes(mode)) return send(res, 400, { error: 'invalid_request' });
      const route = b.route, hours = Number(route?.hours);
      if (!route || !Array.isArray(route.path) || route.path.length < 2 || route.path.length > 20000 || !route.path.every(validPoint) || !(hours > 0 && hours <= 500)) return send(res, 400, { error: 'no_route' });
      const source = nodeById(route.fromId), dest = destinationOf(r);
      if (!isSourceNode(source)) return send(res, 400, { error: 'invalid_source' });
      if (!dest) return send(res, 400, { error: 'invalid_unit' });
      // مصادر شحنات الوحدات مستودعات فعلية فقط؛ القرار للقائد.
      if (!scope.depotIds.has(source.id)) return send(res, 403, { error: 'source_out_of_scope' });
      // المسار لازم يبدأ من المصدر المختار وينتهي عند الوجهة، والمسافة ما تكون أقصر من الخط المستقيم
      const straight = distanceKm(source.pos, dest.pos), km = Number(route.km) || 0;
      if (distanceKm(route.path[0], source.pos) > 5 || distanceKm(route.path[route.path.length - 1], dest.pos) > 5 || km < straight * 0.95) return send(res, 400, { error: 'route_mismatch' });
      const srcBase = baseIdOf(source), crossBase = r.kind !== 'base' && isDepotNode(source) && srcBase !== dest.baseId;
      const crossReason = cleanText(b.crossBaseReason, 300);
      // فحص مبدئي للقائد: المصدر يكفي الآن، والوحدة تتسع مع الوارد بالطريق والمعتمد غيره. يُعاد كله عند المباشرة.
      advanceSim();
      const needs = approvalItems(r, b, dest, source);
      if (!needs) return send(res, 400, { error: 'invalid_quantity' });
      if (needs.some(i => !unitAllows(r.unitId, i.resource))) return send(res, 409, { error: 'resource_not_assigned' });
      const shortages = needs.filter(n => qtyOf(source.id, n.resource) < n.qty).map(n => ({ ...n, available: Math.floor(qtyOf(source.id, n.resource)) }));
      if (shortages.length) return send(res, 409, { error: 'insufficient_stock', depotId: source.id, shortages });
      const over = capacityOver(dest, needs);
      if (over.length) return send(res, 409, { error: 'over_capacity', unitId: r.unitId, destination: dest.id, room: over });
      r.approvedItems = needs.map(i => ({ ...i }));
      r.route = { path: route.path, km: Math.round(km), fromId: source.id, fromLabel: String(route.fromLabel || '').slice(0, 80), fromBaseId: srcBase };
      // المصدر والوجهة بتبعيتهما وقت القرار؛ تُحدَّث عند المباشرة
      r.source = partyOf(source.id); r.destination = partyOf(dest.id);
      if (crossBase) Object.assign(r, { crossBase: true, ...(crossReason ? { crossBaseReason: crossReason } : {}) });
      const modeChanged = mode !== r.mode;
      Object.assign(r, { mode, eta: hours, status: 'assigned', decidedBy: me.username, decidedByRole: me.role, decidedAt: Date.now(), executorBaseId: r.baseId || null });
      delete r.executionBlocked;
      pushHistory(r, 'assigned', me.username, [crossBase ? `cross_base${crossReason ? `: ${crossReason}` : ''}` : null, modeChanged ? `mode_${mode}` : null].filter(Boolean).join(' · ') || null);
      r.history.at(-1).items = r.approvedItems;
      addLog('assigned', r.id, me.username, { unitId: r.unitId || undefined, baseIds: [...new Set([r.baseId, srcBase].filter(Boolean))] });
      // The base manager dispatches as part of acceptance. The commander may
      // dispatch immediately for an emergency or explicitly choose to do so.
      if (!isAdmin || r.priority === 'emergency' || b.dispatchNow === true) {
        const failures = dispatchAssigned(r, me.username);
        if (failures) { saveState(); return send(res, 409, { error: 'execution_blocked', failures: redactRequest(scope, r).executionBlocked.failures }); }
      }
    }
    return finish();
  }

  // التعليقات: على أي طلب داخل نطاق المستخدم
  const comment = path.match(/^\/api\/requests\/([A-Za-z0-9-]+)\/comments$/);
  if (comment && method === 'POST') {
    const r = state.requests.find(x => x.id === comment[1]);
    if (!r || !canSeeRequest(scope, r)) return send(res, 404, { error: 'not_found' });
    const text = cleanText((await readBody(req)).text);
    if (!text || (r.comments || []).length >= 200) return send(res, 400, { error: 'invalid_comment' });
    (r.comments ||= []).push({ by: me.username, role: me.role, at: Date.now(), text });
    saveState(); return send(res, 200, redactRequest(scope, r));
  }
  return false;
}
