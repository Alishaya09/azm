// الحالة المشتركة اللي تسحبها الواجهة كل 3 ثوانٍ (مفلترة حسب نطاق المستخدم)، + إعدادات المحاكاة.
// ما نرسل أي بيانات خارج نطاق المستخدم ثم نخفيها في الواجهة — الفلترة كلها هنا.
import { HOUR_MS, SPEEDS } from '../config.mjs';
import { readBody, send } from '../lib/http.mjs';
import { advanceSim, deliverDueConvoys, inboundTo, reservedTo, saveState, state } from '../store/state.mjs';
import { allDepots, capacityOf, layoutNodes, parentMap, qtyAll, unitAllows } from '../store/hierarchy.mjs';
import { FUEL_KEYS, OPERATIONAL_FOOD, catalog } from '../store/catalog.mjs';
import { publicUser, users } from '../store/users.mjs';
import { canSeeAccount, canSeeAlert, canSeeLog, canSeeRequest, filterLayout, mapNamesOnly, redactRequest, redactLog } from '../store/scope.mjs';
import { pendingCount } from '../store/users.mjs';

export async function handleState({ req, res, path, method, me, isAdmin, scope, forbidden }) {
  if (path === '/api/state' && method === 'GET') {
    advanceSim();
    if (deliverDueConvoys()) saveState();
    const s = scope;
    // مخزون الوحدات (نسب — التخزين القديم) والمستودعات (كميات) داخل النطاق فقط
    const stocks = Object.fromEntries(Object.entries(state.stocks).filter(([id]) => s.unitIds.has(id)));
    const depotsAll = allDepots(), depots = Object.fromEntries(Object.entries(depotsAll).filter(([id]) => s.depotIds.has(id)));
    // سجل المخزون لكل كيان داخل النطاق: السعة الحالية (من الكتالوج)، الرصيد بالكمية، الرصيد الافتتاحي، والشحنات بالطريق إليه
    const inventory = {};
    for (const n of layoutNodes()) {
      if (!s.entityIds.has(n.id) || !state.inventory[n.id]) continue;
      const rec = state.inventory[n.id];
      inventory[n.id] = { capacity: capacityOf(n), qty: qtyAll(n.id), opening: Object.fromEntries(Object.entries(rec.opening || {}).filter(([key]) => catalog().some(c => c.key === key))), openingAt: rec.openingAt, openingSource: rec.openingSource, inTransit: inboundTo(n.id), reserved: reservedTo(n.id), maintenance: rec.maintenance || {} };
    }
    // للقائد: القواعد التي لا يوجد لها مسؤول قاعدة نشط (لن يباشر أحد تكليفاتها)
    const noManager = isAdmin ? layoutNodes().filter(n => n.type === 'main' && !users.some(u => u.role === 'base_manager' && u.baseId === n.id && u.status === 'active')).map(n => n.id) : undefined;
    const layout = filterLayout(s, state.layout), visible = new Set((layout?.nodes || []).map(n => n.id));
    const hierarchy = Object.fromEntries(Object.entries(parentMap()).filter(([id]) => visible.has(id)).map(([id, p]) => [id, visible.has(p) ? p : null]));
    return send(res, 200, {
      // الحساب صاحب هذي الجلسة — لو تبويب ثاني في نفس المتصفح دخل بحساب ثاني، الواجهة تنتبه وتتحول له
      user: publicUser(me), catalog: s.role === 'user' ? catalog().filter(c => unitAllows(s.unitId, c.key)) : catalog(),
      requests: state.requests.filter(r => canSeeRequest(s, r)).map(r => redactRequest(s, r)),
      logs: state.logs.filter(l => canSeeLog(s, l)).map(l => redactLog(s, l)),
      layout, layoutVersion: state.layoutVersion, now: Date.now(), hourMs: HOUR_MS,
      stocks, alerts: state.alerts.filter(a => canSeeAlert(s, a)).slice(0, 50), sim: { speed: state.sim.speed, emergency: state.sim.emergency, hours: state.sim.hours, paused: state.sim.speed === 0, resumedAt: state.sim.resumedAt || null, lastGapMs: state.sim.lastGapMs || 0 },
      depots, inventory, hierarchy, trackingStartedAt: state.trackingStartedAt, operationCycle: state.operationCycle || null,
      scope: { role: s.role, baseId: s.baseId, unitId: s.unitId },
      // جميع الأصناف النشطة مخصصة، والاستهلاك وفق الكتالوج مع مشاركة احتياج وقود المركبات.
      policy: { food: OPERATIONAL_FOOD, fuel: FUEL_KEYS, assignment: 'all_active', consumption: 'catalog', fuelDistribution: 'proportional_available_max_rate' },
      ...(isAdmin ? { pendingUsers: pendingCount(), basesWithoutManager: noManager } : {}),
      // مسؤول القاعدة: طلبات الانضمام لوحدات قاعدته، وبقية القواعد والوحدات بالاسم فقط على الخريطة
      ...(s.role === 'base_manager' ? { pendingUsers: users.filter(u => u.status === 'pending' && canSeeAccount(s, u)).length, mapOthers: mapNamesOnly(s) } : {}),
    });
  }
  // سرعة المحاكاة: كل الأدوار يغيّرونها وتطبّق على الجميع. الإيقاف (السرعة 0) للقائد فقط،
  // وإذا أوقفها القائد ما يشغّلها غيره. وضع الطوارئ أُزيل كاملاً (emergency=true يُرفض).
  if (path === '/api/sim' && method === 'POST') {
    const b = await readBody(req);
    if (b.emergency === true) return send(res, 400, { error: 'bad_request' });
    if (b.speed !== undefined && !SPEEDS.includes(b.speed)) return send(res, 400, { error: 'bad_request' });
    if (!isAdmin && b.speed === 0) return forbidden();
    if (!isAdmin && b.speed !== undefined && state.sim.speed === 0) return send(res, 409, { error: 'sim_paused' });
    advanceSim();
    if (b.speed !== undefined) state.sim.speed = b.speed;
    saveState(); return send(res, 200, { speed: state.sim.speed, emergency: false });
  }
  return false;
}
