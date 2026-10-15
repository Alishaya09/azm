// صلاحيات الأدوار (بيانات مؤقتة فقط): سرعة المحاكاة لكل الأدوار ووضع الطوارئ للقائد، خريطة مسؤول القاعدة
// (بقية القواعد والوحدات بالاسم فقط)، إنشاء مسؤول القاعدة لوحدات قاعدته فقط، وحسابات قاعدته فقط.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignmentFixture } from './user-assignment-test.mjs';

async function run() {
  const f = await assignmentFixture(), { api, get, login, password, admin } = f;
  let checks = 0; const ok = (v, name) => { assert(v, name); checks++; };
  try {
    const { b1, b2, p1, p2, u1, u2 } = await f.entities();
    for (const x of [{ username: 'perm.bm1', role: 'base_manager', baseId: b1.id }, { username: 'perm.bm2', role: 'base_manager', baseId: b2.id }, { username: 'perm.um1', role: 'user', unitId: u1.unitId }, { username: 'perm.um2', role: 'user', unitId: u2.unitId }])
      await api('/api/users', { ...x, password }, admin);
    const bm1 = (await login('perm.bm1')).cookie, um1 = (await login('perm.um1')).cookie;

    // ===== سرعة المحاكاة لكل الأدوار، والإيقاف للقائد فقط، ووضع الطوارئ محذوف =====
    await api('/api/sim', { speed: 1 }, admin);
    ok((await api('/api/sim', { speed: 5 }, um1)).data.speed === 5, 'unit manager changes the simulation speed');
    ok((await get('/api/state', admin)).sim.speed === 5, 'speed change applies to everyone');
    ok((await api('/api/sim', { speed: 10 }, bm1)).data.speed === 10, 'base manager changes the simulation speed');
    await api('/api/sim', { speed: 0 }, um1, 'POST', 403); await api('/api/sim', { speed: 0 }, bm1, 'POST', 403);
    await api('/api/sim', { speed: 0 }, admin);
    ok((await api('/api/sim', { speed: 5 }, um1, 'POST', 409)).data.error === 'sim_paused', 'only the commander resumes a commander pause');
    await api('/api/sim', { speed: 5 }, bm1, 'POST', 409);
    ok((await get('/api/state', admin)).sim.speed === 0, 'pause stays after other roles try');
    for (const cookie of [admin, bm1, um1]) await api('/api/sim', { emergency: true }, cookie, 'POST', 400);
    ok((await get('/api/state', admin)).sim.emergency === false, 'emergency mode removed for every role');
    await api('/api/sim', { speed: 3 }, um1, 'POST', 400);

    // ===== خريطة مسؤول القاعدة: قاعدته كاملة، وبقية القواعد والوحدات بالاسم فقط =====
    const bmState = await get('/api/state', bm1);
    ok(!bmState.layout.nodes.some(n => [b2.id, u2.id, p2.id].includes(n.id)), 'other bases stay out of the base manager layout');
    const others = bmState.mapOthers || [];
    ok(others.some(n => n.id === b2.id) && others.some(n => n.id === u2.id) && !others.some(n => [b1.id, p1.id, u1.id, p2.id].includes(n.id)), 'map names cover other bases and units only');
    ok(others.every(n => Object.keys(n).every(k => ['id', 'type', 'pos', 'label', 'labelKey', 'unitId'].includes(k))), 'map names carry no balances, capacities, counts or relations');
    ok(!Object.keys(bmState.depots).some(id => [b2.id, p2.id].includes(id)) && !Object.keys(bmState.inventory).some(id => [b2.id, p2.id, u2.id].includes(id)), 'no other-base balances');
    ok(!('mapOthers' in await get('/api/state', um1)) && !('mapOthers' in await get('/api/state', admin)), 'map names only for base managers');

    // ===== مسؤول القاعدة ينشئ وحدات لقاعدته فقط =====
    const made = (await api('/api/entities', { type: 'unit', label: 'وحدة مسؤول القاعدة', pos: [24.73, 46.71], people: 200, vehicles: 10 }, bm1)).data.node;
    ok(made.baseId === b1.id && made.createdBy === 'perm.bm1', 'base manager creates a unit fixed to their base');
    ok((await get('/api/state', bm1)).layout.nodes.some(n => n.id === made.id), 'new unit is in the base manager scope');
    await api('/api/entities', { type: 'unit', label: 'خارج القاعدة', baseId: b2.id, pos: [25.03, 47] }, bm1, 'POST', 403);
    await api('/api/entities', { type: 'unit', label: 'مصدر خارجي', sourceId: p2.id, pos: [24.74, 46.7] }, bm1, 'POST', 403);
    await api('/api/entities', { type: 'fsb', label: 'مركز', baseId: b1.id, pos: [24.75, 46.7] }, bm1, 'POST', 403);
    await api('/api/entities', { type: 'main', label: 'قاعدة', pos: [23, 45] }, bm1, 'POST', 403);
    await api('/api/entities', { type: 'unit', label: 'مسؤول وحدة', pos: [24.76, 46.7] }, um1, 'POST', 403);
    await api(`/api/entities/${made.id}`, null, bm1, 'DELETE', 403);
    ok(true, 'base manager cannot create other entity types, other bases, foreign sources, or archive');

    // ===== قرار القائد لا يرفضه أو يعيده للمراجعة غير القائد =====
    const order = (await api('/api/requests', { mode: 'truck', items: [{ resource: 'azm_bottled_water', qty: 10 }] }, um1)).data;
    const route = { path: [b1.pos, u1.pos], km: 5, hours: 0.1, fromId: b1.id, fromLabel: 'base' };
    ok((await api(`/api/requests/${order.id}/approve`, { route }, admin)).data.status === 'assigned', 'commander assigns the order to the base');
    ok((await api(`/api/requests/${order.id}/reject`, { reason: 'x' }, bm1, 'POST', 403)).data.error === 'commander_decision', 'base manager cannot reject a commander decision');
    await api(`/api/requests/${order.id}/reopen`, {}, bm1, 'POST', 403);
    ok((await get('/api/state', admin)).requests.find(r => r.id === order.id).status === 'assigned', 'commander decision unchanged');
    ok((await api(`/api/requests/${order.id}/reopen`, {}, admin)).data.status === 'pending', 'commander can still reopen');

    // ===== سلسلة داشبورد التقارير: عدد العمليات بنطاق الجلسة =====
    const t0 = Date.now();
    const sent = (await api('/api/requests', { mode: 'truck', items: [{ resource: 'azm_mre', qty: 5 }] }, um1)).data;
    ok((await api(`/api/requests/${sent.id}/approve`, { route }, bm1)).data.status === 'approved', 'base manager dispatches for the series check');
    const seriesOf = async cookie => (await api(`/api/reports/series?from=${Date.now() - 600000}&to=${Date.now()}&buckets=6`, null, cookie)).data;
    const total = s => s.buckets.reduce((n, b) => n + s.types.reduce((m, k) => m + b[k], 0), 0);
    const adminSeries = await seriesOf(admin);
    ok(adminSeries.buckets.length === 6 && adminSeries.buckets.some(b => b.dispatch >= 1), 'series counts the dispatch operation');
    ok(total(await seriesOf(um1)) >= 1, 'unit manager sees operations of their unit');
    ok(total(await seriesOf((await login('perm.um2')).cookie)) === 0, 'other base unit manager sees none of them');
    await api(`/api/reports/series?baseIds=${b2.id}`, null, bm1, 'GET', 403);
    await api('/api/reports/series?resources=not_a_resource', null, admin, 'GET', 400);
    const since = r => api(`/api/reports/series?from=${t0}&resources=${r}`, null, admin).then(x => total(x.data));
    ok(await since('azm_diesel') === 0 && await since('azm_mre') >= 1, 'resource filter keeps only the chosen items');

    // ===== قائمة الوحدات لا تنكشف بدون دخول، والتسجيل برمز الوحدة =====
    ok((await api('/api/public/units')).data.length === 0, 'no unit list without a session');
    ok((await api('/api/public/units', null, bm1)).data.every(u => [u1.unitId, made.unitId].includes(u.unitId || u.id)), 'signed-in list stays within scope');
    ok((await api('/api/register', { username: 'perm.bad', password, unitId: 'AZM-NOPE-1', fullName: 'رمز خاطئ', rank: 'lt', serviceId: '7001009' }, null, 'POST', 400)).data.error === 'invalid_unit_code', 'unknown unit code rejected');

    // ===== حسابات القاعدة =====
    const register = (username, unitId, serviceId) => api('/api/register', { username, password, unitId, fullName: 'منتسب تجريبي', rank: 'lt', serviceId, phone: '0500000000' });
    await register('perm.join1', u1.code, '7001001'); await register('perm.join2', u2.unitId, '7001002');
    ok((await get('/api/users', admin)).find(u => u.username === 'perm.join1').unitId === u1.unitId, 'registration by unit code binds the right unit');
    const seen = (await get('/api/users', bm1)).map(u => u.username);
    ok(['perm.bm1', 'perm.um1', 'perm.join1'].every(n => seen.includes(n)) && !['admin', 'perm.bm2', 'perm.um2', 'perm.join2'].some(n => seen.includes(n)), 'base manager sees only their base accounts');
    ok((await get('/api/state', bm1)).pendingUsers === 1, 'pending count limited to the base');
    await api('/api/users', null, um1, 'GET', 403);
    await api('/api/users/perm.join1/approve', { role: 'base_manager', baseId: b1.id }, bm1, 'POST', 403);
    await api('/api/users/perm.join1/approve', { unitId: u2.unitId }, bm1, 'POST', 403);
    ok((await api('/api/users/perm.join1/approve', { role: 'user', unitId: u1.unitId, baseId: null }, bm1)).data.status === 'active', 'base manager approves a join request for their unit');
    await api('/api/users/perm.join2/approve', {}, bm1, 'POST', 404);
    ok((await api('/api/users/perm.um1/suspend', {}, bm1)).data.status === 'suspended', 'base manager suspends their unit manager');
    await api('/api/state', null, um1, 'GET', 401);
    ok((await api('/api/users/perm.um1/activate', {}, bm1)).data.status === 'active', 'base manager reactivates their unit manager');
    await api('/api/users/perm.bm1/suspend', {}, bm1, 'POST', 400);
    for (const name of ['admin', 'perm.bm2', 'perm.um2']) await api(`/api/users/${name}/suspend`, {}, bm1, 'POST', 404);
    await api('/api/users/perm.um1', { fullName: 'تعديل ممنوع' }, bm1, 'PUT', 403);
    await api('/api/users/perm.um1', null, bm1, 'DELETE', 403);
    await api('/api/users', { username: 'perm.new', password, role: 'user', unitId: u1.unitId }, bm1, 'POST', 403);
    ok(true, 'base manager cannot touch other bases, the commander, themselves, or create/edit/delete accounts');

    console.log(`All checks passed (role permissions: simulation speed for all roles, names-only map, base unit creation, base accounts; ${checks} checks)`);
  } finally { await f.stop(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
