// دورة الطلب v8 على مجلدات ومنافذ مؤقتة فقط (لا يقرأ data/ الحقيقي ولا يلمس خادم 5182):
// سياسة الأصناف التشغيلية، قرار القائد بلا خصم، مباشرة مسؤول القاعدة، الحجز والتعذر وإعادة المراجعة،
// المحاكاة (إيقاف/تسريع/إعادة تشغيل)، الصلاحيات، مسودة الشات بوت، وترحيل بيانات v7 القديمة دون خسارة.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const root = fileURLToPath(new URL('..', import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FUELS = ['azm_diesel', 'azm_gasoline'];
let checks = 0;
const assert = (cond, msg) => { if (!cond) throw new Error(msg); checks++; };
const km = (a, b) => { const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r, h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2; return 2 * 6371 * Math.asin(Math.sqrt(h)); };
const children = [], dirs = [];
const startServer = async (dir, port, extraEnv = {}) => {
  const child = spawn(process.execPath, [join(root, 'server.mjs')], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), AZM_DATA_DIR: dir, AZM_ADMIN_PASSWORD: 'cycle-test-password', AZM_AI_PROVIDER: 'none', AZM_HOUR_MS: '2000', ...extraEnv }, stdio: 'ignore' });
  children.push(child);
  for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${port}/api/me`); return child; } catch { await sleep(100); } }
  throw new Error('server did not start');
};
const stopServer = async child => { child.kill(); await new Promise(r => child.exitCode !== null ? r() : child.once('exit', r)); await sleep(150); };
const client = port => async (path, cookie, method = 'GET', body) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})), cookie: r.headers.get('set-cookie')?.split(';')[0] };
};

// مولّد ردود نموذج استخراج وهمي: النص "اسم|كمية|وحدة;..." يُعاد كما هو بصيغة العقد
const mock = http.createServer((req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'mock-extractor' }] })); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')), text = body.messages.at(-1).content;
    const items = text.split(';').map(p => { const [item, quantity, unit] = p.split('|'); return { item, supply_class: 'I', quantity: Number(quantity), unit_of_measure: unit }; });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ items, priority: 'normal', deadline: null }) } }] }));
  });
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
const mockUrl = `http://127.0.0.1:${mock.address().port}/v1`;

try {
  // ===== المرادفات: لا اسم يطابق صنفين =====
  const catalogRows = JSON.parse(readFileSync(join(root, 'resources', 'items.json'), 'utf8')).items;
  const norm = v => v.trim().toLowerCase().replace(/\s+/g, ' '), owners = new Map();
  for (const row of catalogRows) for (const name of new Set([row.item, row.nameAr, ...row.aliases.ar, ...row.aliases.en].map(norm))) owners.set(name, [...new Set([...(owners.get(name) || []), row.key])]);
  const clashes = [...owners].filter(([, keys]) => keys.length > 1);
  assert(!clashes.length, `ambiguous aliases: ${JSON.stringify(clashes)}`);
  assert(catalogRows.every(r => r.nameAr && r.aliases.ar.includes(r.nameAr)), 'every fusha name is also a chatbot alias');
  for (const [key, colloquial] of [['azm_bottled_water', 'موية'], ['azm_combat_boots', 'بساطير'], ['azm_radiator_hose', 'لي رديتر'], ['azm_spark_plug', 'بوجي'], ['azm_oil_filter', 'فلتر زيت']])
    assert(owners.get(norm(colloquial))?.join() === key, `${colloquial} remains a synonym of ${key}`);

  const dir = mkdtempSync(join(tmpdir(), 'azm-cycle-')); dirs.push(dir);
  const port = 7000 + Math.floor(Math.random() * 1500), call = client(port);
  const aiEnv = { AZM_REQUEST_AI_PROVIDER: 'openai', AZM_REQUEST_AI_BASE_URL: mockUrl, AZM_REQUEST_AI_MODEL: 'mock-extractor' };
  let server = await startServer(dir, port, aiEnv);
  const login = async (username, password) => (await call('/api/login', null, 'POST', { username, password })).cookie;
  let admin = await login('admin', 'cycle-test-password');
  assert(!!admin, 'admin login');
  let s = (await call('/api/state', admin)).body;
  const name = key => s.catalog.find(c => c.key === key).name.ar;
  assert(name('azm_bottled_water') === 'مياه شرب معبأة' && name('azm_combat_boots') === 'أحذية ميدانية' && name('azm_spark_plug') === 'شمعة إشعال', 'fusha names displayed');
  assert(s.catalog.length === 40 && s.policy.food.length === 5 && s.policy.fuel.join() === 'azm_diesel,azm_gasoline', 'all 40 items kept; 7 operational in policy');
  const defaultUnit = s.layout.nodes.find(n => n.unitId === 'UNIT-01');
  assert(defaultUnit.allowedResources.join() === s.catalog.map(c=>c.key).join(), 'fresh default unit: all active items without a fuel requirement');
  await call('/api/sim', admin, 'POST', { speed: 0 });
  const base = s.layout.nodes.find(n => n.id === 'base'), fsb1 = s.layout.nodes.find(n => n.id === 'fsb-1');

  // ===== إنشاء الوحدة: 5% من سعة كل صنف تشغيلي مخصص فقط =====
  const before = (await call('/api/state', admin)).body.depots.base;
  const made = await call('/api/entities', admin, 'POST', { type: 'unit', label: 'وحدة الدورة', baseId: 'base', sourceId: 'base', pos: [24.8, 46.8], people: 500, vehicles: 40, fuelType: 'azm_diesel' });
  assert(made.status === 200, `create unit ${JSON.stringify(made.body)}`);
  const A = made.body.node, ops = ['azm_bottled_water', 'azm_mre', 'azm_canned_food', 'azm_dates', 'azm_rice', 'azm_diesel'];
  assert(A.allowedResources.join() === s.catalog.map(c=>c.key).join() && A.fuelType === undefined, 'new unit gets all items; fuel selection ignored');
  const starter = Object.fromEntries(ops.map(k=>[k,0]));
  s = (await call('/api/state', admin)).body;
  for (const k of ops) assert(Math.abs(s.inventory[A.id].qty[k] - starter[k]) < .001 && Math.abs(s.depots.base[k] - (before[k] - starter[k])) < .001, `${k}: zero physical stock without any base debit`);
  assert(['azm_helmet', 'azm_gasoline', 'azm_spark_plug'].every(k => !s.inventory[A.id].qty[k] && s.depots.base[k] === before[k]), 'non-operational items not issued');
  let moves = (await call('/api/movements?limit=200', admin)).body.movements;
  assert(moves.filter(m => m.to?.entityId === A.id && m.reason === 'unit_initial_issue').length === 0, 'zero allocation movements before supply');
  const B = (await call('/api/entities', admin, 'POST', { type: 'unit', label: 'وقود غير محدد', baseId: 'base', sourceId: 'base', pos: [24.6, 46.9], people: 300, vehicles: 10 })).body.node;
  assert(B.fuelType === undefined && B.allowedResources.join() === s.catalog.map(c=>c.key).join(), 'all resources assigned without fuel type');
  assert((await call('/api/entities', admin, 'POST', { type: 'unit', label: 'بلا مركبات', baseId: 'base', pos: [24.5, 46.9], vehicles: 0, fuelType: 'azm_gasoline' })).status === 200, 'zero-vehicle units need no fuel selection');
  assert((await call('/api/entities', admin, 'POST', { type: 'unit', label: 'خطأ', baseId: 'base', pos: [24.5, 46.9], fuelType: 'azm_helmet' })).status === 200, 'legacy fuel field is ignored');
  const C = (await call('/api/entities', admin, 'POST', { type: 'unit', label: 'بلا وقود', baseId: 'base', pos: [24.55, 46.95], vehicles: 0, fuelType: 'none' })).body.node;
  assert(C.fuelType === undefined && C.allowedResources.length === 40, 'zero-vehicle unit still shows all items');
  assert((await call(`/api/entities/${B.id}/resources`, admin, 'PUT', { allowedResources: [...B.allowedResources, 'azm_helmet'] })).body.error === 'invalid_unit_resources', 'duplicate allocations are rejected');
  const setFuel = await call(`/api/entities/${B.id}/resources`, admin, 'PUT', { fuelType: 'azm_gasoline' });
  assert(setFuel.status === 200 && setFuel.body.node.fuelType === undefined && setFuel.body.node.allowedResources.includes('azm_gasoline'), 'legacy fuel update cannot restrict assignments');

  // ===== الحسابات الثلاثة =====
  const base2 = (await call('/api/entities', admin, 'POST', { type: 'main', label: 'قاعدة ثانية', pos: [26.4, 50.1] })).body.node;
  for (const u of [{ username: 'cy.bm', role: 'base_manager', baseId: 'base' }, { username: 'cy.bm2', role: 'base_manager', baseId: base2.id }, { username: 'cy.um', role: 'user', unitId: A.unitId }])
    assert((await call('/api/users', admin, 'POST', { ...u, password: 'cycle-secret-1' })).status === 200, `create ${u.username}`);
  const bm = await login('cy.bm', 'cycle-secret-1'), bm2 = await login('cy.bm2', 'cycle-secret-1'), um = await login('cy.um', 'cycle-secret-1');

  // ===== إنشاء الطلب =====
  const unitState = (await call('/api/state', um)).body;
  assert(unitState.catalog.map(c => c.key).join() === A.allowedResources.join(), 'unit manager sees only its assigned resources');
  assert((await call('/api/requests', um, 'POST', { mode: 'truck', items: [{ resource: 'azm_helmet', qty: 1 }] })).status === 200, 'non-consumable item can be requested');
  assert((await call('/api/requests', um, 'POST', { mode: 'truck', items: [{ resource: 'azm_gasoline', qty: 1 }] })).status === 200, 'both fuel types can be requested');
  const fillAll = await call('/api/requests', um, 'POST', { mode: 'truck', operationKey: 'fill-all-1', items: ops.map(resource => ({ resource, fill: true })) });
  assert(fillAll.status === 200 && fillAll.body.items.length === 6 && fillAll.body.items.every(i => i.qty > 0), 'fill all requests the six operational resources');
  assert(fillAll.body.items.find(i => i.resource === 'azm_mre').qty === 600, 'fill = capacity − balance − in transit');
  const replayCreate = await call('/api/requests', um, 'POST', { mode: 'truck', operationKey: 'fill-all-1', items: ops.map(resource => ({ resource, fill: true })) });
  assert(replayCreate.body.id === fillAll.body.id, 'same operationKey does not create a second request');
  assert((await call(`/api/requests/${fillAll.body.id}/reject`, admin, 'POST', { reason: 'اختبار' })).body.status === 'rejected', 'commander rejects');
  // تحضير مركز الإمداد كمصدر محدود
  for (const [resource, qty] of [['azm_bottled_water', 2000], ['azm_mre', 600]]) assert((await call('/api/depots/base/transfer', admin, 'POST', { to: 'fsb-1', resource, qty })).status === 200, 'stock fsb-1');
  const R1 = (await call('/api/requests', um, 'POST', { mode: 'truck', priority: 'urgent', notes: 'دورة كاملة', items: [{ resource: 'azm_bottled_water', qty: 2000 }, { resource: 'azm_mre', fill: true }] })).body;
  assert(R1.status === 'pending' && R1.items[0].qty === 2000 && R1.items[1].qty === 600 && R1.priority === 'urgent', 'request saved once with original quantities');
  const R2 = (await call('/api/requests', um, 'POST', { mode: 'truck', items: [{ resource: 'azm_rice', qty: 300 }] })).body;

  // ===== الأدوار =====
  const bmView = (await call('/api/state', bm)).body;
  assert(bmView.requests.some(r => r.id === R1.id), 'base manager sees unit request');
  assert(!(await call('/api/state', bm2)).body.requests.some(r => r.id === R1.id), 'other base manager does not see it');
  assert((await call(`/api/requests/${R1.id}/approve`, bm, 'POST', {})).body.error === 'no_route', 'base manager decision requires source and route');
  assert((await call(`/api/requests/${R1.id}/reject`, bm2, 'POST', {})).status === 404, 'other base manager cannot reject');
  assert((await call(`/api/requests/${R1.id}/execute`, bm, 'POST', {})).body.error === 'not_assigned', 'nothing to execute before decision');

  // ===== تغيير الوسيلة فقط =====
  const movesBefore = (await call('/api/movements?limit=1', admin)).body.total;
  const air = await call(`/api/requests/${R1.id}/air`, admin, 'POST', { operationKey: 'air-1' });
  assert(air.status === 200 && air.body.status === 'pending' && air.body.mode === 'heli' && air.body.history.at(-1).note === 'mode_heli', 'aircraft switch keeps request awaiting decision');
  assert((await call('/api/movements?limit=1', admin)).body.total === movesBefore, 'mode change moves no stock');

  // ===== قرار القائد: لا خصم ولا قافلة =====
  const route = (from, to, hours) => ({ fromId: from.id, path: [from.pos, to.pos], km: Math.ceil(km(from.pos, to.pos)), hours });
  const approve = (r, body, key) => call(`/api/requests/${r.id}/approve`, admin, 'POST', { ...body, ...(key ? { operationKey: key } : {}) });
  const fsbBefore = (await call('/api/state', admin)).body.depots['fsb-1'];
  const decision = { mode: 'heli', route: route(fsb1, A, 1.5), items: [{ resource: 'azm_bottled_water', qty: 1500 }, { resource: 'azm_mre', fill: true }] };
  const decided = await approve(R1, decision, 'approve-1');
  assert(decided.status === 200 && decided.body.status === 'assigned', `decision → assigned ${JSON.stringify(decided.body)}`);
  assert(decided.body.items[0].qty === 2000 && decided.body.approvedItems[0].qty === 1500 && decided.body.approvedItems[1].qty === 600 && !decided.body.dispatched, 'requested and approved quantities kept separately');
  s = (await call('/api/state', admin)).body;
  assert(s.depots['fsb-1'].azm_bottled_water === fsbBefore.azm_bottled_water && (await call('/api/movements?limit=1', admin)).body.total === movesBefore, 'commander decision debits nothing');
  assert(!s.requests.some(r => r.status === 'approved'), 'no convoy after decision alone');
  assert(s.inventory[A.id].reserved.azm_bottled_water === 1500 && s.inventory[A.id].inTransit.azm_bottled_water === 0, 'decision reserves unit capacity without counting as in transit');
  assert((await approve(R1, decision, 'approve-1')).body.status === 'assigned', 'replayed decision returns same state');
  assert((await approve(R1, { route: route(fsb1, A, 1.5) }, 'approve-1')).body.error === 'bad_request', 'same key with different payload refused');
  assert((await approve(R1, { route: route(fsb1, A, 1.5) }, 'approve-2')).body.error === 'not_pending', 'second decision refused');
  const fillView = (await call('/api/requests', um, 'POST', { mode: 'truck', items: [{ resource: 'azm_bottled_water', fill: true }] })).body;
  assert(fillView.items[0].qty === 10800 - 1500, 'new fill subtracts the reserved approved quantity');
  await call(`/api/requests/${fillView.id}/reject`, admin, 'POST', { reason: 'تنظيف' });
  assert((await approve(R2, { route: route(base, A, .5) })).body.status === 'assigned', 'second request approved');

  // ===== تغيّر الرصيد بين القرار والمباشرة =====
  assert((await call('/api/depots/fsb-1/transfer', admin, 'POST', { to: 'fsb-2', resource: 'azm_bottled_water', qty: 1000 })).status === 200, 'source stock reduced after decision');
  const blocked = await call(`/api/requests/${R1.id}/execute`, bm, 'POST', { operationKey: 'exec-fail' });
  const waterFail = blocked.body.failures?.find(f => f.resource === 'azm_bottled_water');
  assert(blocked.status === 409 && blocked.body.error === 'execution_blocked' && waterFail?.error === 'insufficient_stock' && waterFail.required === 1500 && waterFail.available === 1000, `execution names the resource and limits ${JSON.stringify(blocked.body)}`);
  s = (await call('/api/state', admin)).body;
  assert(s.depots['fsb-1'].azm_bottled_water === 1000 && s.depots['fsb-1'].azm_mre === 600 && s.requests.find(r => r.id === R1.id).status === 'assigned', 'blocked execution changes nothing (no partial debit)');
  assert(s.requests.find(r => r.id === R1.id).executionBlocked?.failures.length >= 1, 'commander sees why execution failed');
  const unitBlocked = (await call('/api/state', um)).body.requests.find(r => r.id === R1.id).executionBlocked;
  assert(unitBlocked && unitBlocked.failures.every(f => f.available === undefined), 'unit manager does not see source balances');
  const reopened = await call(`/api/requests/${R1.id}/reopen`, admin, 'POST', { operationKey: 'reopen-1' });
  assert(reopened.body.status === 'pending' && reopened.body.previousDecisions?.length === 1 && reopened.body.items[0].qty === 2000, 'commander re-reviews decision; original request kept');
  assert((await approve(R1, { mode: 'heli', route: route(fsb1, A, 1.5), items: [{ resource: 'azm_bottled_water', qty: 1000 }, { resource: 'azm_mre', fill: true }] })).body.status === 'assigned', 'new decision within current stock');

  // ===== تغيّر السعة بين القرار والمباشرة =====
  const mreDef = s.catalog.find(c => c.key === 'azm_mre');
  const qtyBeforeCap = s.inventory[A.id].qty.azm_mre;
  assert((await call('/api/catalog/azm_mre', admin, 'PUT', { unitFactor: .5 })).status === 200, 'commander lowers MRE unit capacity');
  s = (await call('/api/state', admin)).body;
  assert(Math.abs(s.inventory[A.id].qty.azm_mre - qtyBeforeCap) < .001, 'capacity edit preserves the physical quantity');
  const capBlocked = await call(`/api/requests/${R1.id}/execute`, bm, 'POST', {});
  assert(capBlocked.status === 409 && capBlocked.body.failures.some(f => f.resource === 'azm_mre' && f.error === 'over_capacity' && f.room === 250), `capacity change blocks execution precisely ${JSON.stringify(capBlocked.body)}`);
  assert((await call('/api/catalog/azm_mre', admin, 'PUT', { unitFactor: mreDef.unitFactor })).status === 200, 'capacity restored');

  // ===== المباشرة =====
  assert((await call(`/api/requests/${R1.id}/execute`, um, 'POST', {})).status === 403, 'unit manager cannot execute');
  assert((await call('/api/state', admin)).body.requests.find(r => r.id === R1.id).status === 'assigned', 'commander may leave normal approval assigned for the base manager');
  assert((await call(`/api/requests/${R1.id}/execute`, bm2, 'POST', {})).status === 404, 'other base manager cannot execute');
  const movesBeforeExec = (await call('/api/movements?limit=1', admin)).body.total;
  const [e1, e2] = await Promise.all([call(`/api/requests/${R1.id}/execute`, bm, 'POST', { operationKey: 'exec-1' }), call(`/api/requests/${R1.id}/execute`, bm, 'POST', { operationKey: 'exec-1' })]);
  assert(e1.status === 200 && e2.status === 200 && e1.body.status === 'approved' && e1.body.executedBy === 'cy.bm', 'double click executes once');
  assert((await call(`/api/requests/${R1.id}/execute`, bm, 'POST', { operationKey: 'exec-other' })).body.error === 'not_assigned', 'later execution refused');
  s = (await call('/api/state', admin)).body;
  moves = (await call('/api/movements?limit=200', admin)).body.movements;
  const dispatch = moves.filter(m => m.requestId === R1.id && m.type === 'dispatch');
  assert(dispatch.length === 2 && new Set(dispatch.map(m => m.opId)).size === 1 && dispatch.every(m => m.by === 'cy.bm' && m.decidedBy === 'admin'), 'one dispatch per item, one operation, linked to executor and decider');
  assert((await call('/api/movements?limit=1', admin)).body.total === movesBeforeExec + 2, 'debited exactly once');
  assert(s.depots['fsb-1'].azm_bottled_water === 0 && s.depots['fsb-1'].azm_mre === 0, 'source debited by approved quantities');
  const r1 = s.requests.find(r => r.id === R1.id);
  assert(r1.items[0].qty === 2000 && r1.approvedItems[0].qty === 1000 && r1.dispatched[0].qty === 1000, 'requested / approved / executed kept as three numbers');
  assert(s.requests.filter(r => r.status === 'approved').length === 1 && s.inventory[A.id].inTransit.azm_bottled_water === 1000 && s.inventory[A.id].reserved.azm_bottled_water === 0, 'convoy appears immediately and reservation becomes in-transit');
  assert(r1.departSim === s.sim.hours, 'tracking starts at execution time');
  // شحنتان متزامنتان للوحدة نفسها
  assert((await call(`/api/requests/${R2.id}/execute`, bm, 'POST', { operationKey: 'exec-2' })).body.status === 'approved', 'second shipment executed');

  // ===== المحاكاة: إيقاف ثم إعادة تشغيل الخادم =====
  const pausedAt = (await call('/api/state', admin)).body.sim.hours;
  await sleep(2500);
  s = (await call('/api/state', admin)).body;
  assert(s.sim.paused && s.sim.hours === pausedAt && s.requests.filter(r => r.status === 'approved').length === 2, 'paused simulation: no time, no delivery');
  await stopServer(server);
  server = await startServer(dir, port, aiEnv);
  admin = await login('admin', 'cycle-test-password');
  s = (await call('/api/state', admin)).body;
  assert(s.sim.hours === pausedAt && s.requests.filter(r => r.status === 'approved').length === 2 && s.sim.resumedAt, 'restart preserves sim time and in-transit shipments');
  const umAgain = await login('cy.um', 'cycle-secret-1'), bmAgain = await login('cy.bm', 'cycle-secret-1');
  const unitBefore = s.inventory[A.id].qty;
  assert((await call('/api/sim', admin, 'POST', { speed: 5 })).status === 200, 'speed up');
  for (let i = 0; i < 40 && (await call('/api/state', admin)).body.requests.some(r => r.status === 'approved'); i++) await sleep(250);
  s = (await call('/api/state', admin)).body;
  await call('/api/sim', admin, 'POST', { speed: 0 });
  assert([R1.id, R2.id].every(id => s.requests.find(r => r.id === id).status === 'delivered'), 'both shipments delivered');
  moves = (await call('/api/movements?limit=200', admin)).body.movements;
  const deliveries = moves.filter(m => [R1.id, R2.id].includes(m.requestId) && m.type === 'delivery');
  assert(deliveries.length === 3 && deliveries.every(m => Math.abs(m.to.after - m.to.before - m.qty) < .01), 'each item delivered once and added to the unit');
  assert(deliveries.find(m => m.resource === 'azm_bottled_water').qty === 1000 && deliveries.find(m => m.resource === 'azm_rice').qty === 300, 'delivered quantities equal executed quantities');
  assert(s.inventory[A.id].qty.azm_rice > unitBefore.azm_rice + 250, 'unit balance rises after delivery');
  await sleep(2500);
  assert((await call('/api/movements?limit=200', admin)).body.movements.filter(m => [R1.id, R2.id].includes(m.requestId) && m.type === 'delivery').length === 3, 'no duplicate delivery on later ticks');

  // ===== الاستهلاك التشغيلي فقط =====
  const consumed = (await call('/api/movements?type=consumption&limit=200', admin)).body.movements;
  const opsOf = { [A.id]: ops, [B.id]: [...s.policy.food, 'azm_gasoline'], [C.id]: s.policy.food };
  assert(consumed.length > 0 && consumed.every(m => m.from?.type === 'unit'), 'only units consume');
  assert(consumed.every(m => !opsOf[m.from.entityId] || opsOf[m.from.entityId].includes(m.resource)), 'only operational resources are consumed');
  assert(!consumed.some(m => m.from.entityId === A.id && m.resource === 'azm_gasoline') && !consumed.some(m => m.from.entityId === C.id && FUELS.includes(m.resource)), 'no guessed fuel consumption');
  assert(Object.values(s.inventory).every(inv => Object.values(inv.qty).every(q => q >= 0)), 'no negative balances');

  // ===== السجل والتقارير =====
  const logIds = s.logs.filter(l => l.id === R1.id).map(l => l.type);
  for (const type of ['submitted', 'mode_changed', 'assigned', 'execution_blocked', 'reopened', 'dispatched', 'delivered']) assert(logIds.includes(type), `log has ${type}`);
  const report = (await call(`/api/reports?unitId=${A.unitId}`, admin)).body;
  assert(report.requests.byStatus.delivered >= 2 && report.requests.qty.azm_bottled_water.dispatched === 1000 && report.requests.qty.azm_bottled_water.delivered === 1000, 'reports count executed and delivered quantities');
  const audit = (await call(`/api/audit?search=${R1.id}&limit=200`, admin)).body.entries.filter(e => e.requestId === R1.id).map(e => e.action);
  assert(['pending', 'air', 'assigned', 'approved', 'delivered'].every(a => audit.includes(a)), `audit trail ${audit.join()}`);

  // ===== مصدر من قاعدة أخرى: تكليف بأقل بيانات =====
  const R5 = (await call('/api/requests', umAgain, 'POST', { mode: 'truck', items: [{ resource: 'azm_dates', qty: 20 }] })).body;
  assert((await approve(R5, { route: route(base2, A, 3), crossBaseReason: 'نقص محلي' })).body.status === 'assigned', 'cross-base decision');
  const execView = (await call('/api/state', bmAgain)).body, seen = execView.requests.find(r => r.id === R5.id);
  assert(seen.source.restricted && seen.source.label === 'قاعدة ثانية' && seen.route.restricted && !execView.depots[base2.id], 'executor sees source name only, not its stock or route');
  const base2Before = (await call('/api/state', admin)).body.depots[base2.id].azm_dates;
  assert((await call(`/api/requests/${R5.id}/execute`, bmAgain, 'POST', {})).body.status === 'approved', 'executor dispatches from assigned source');
  assert((await call('/api/state', admin)).body.depots[base2.id].azm_dates === base2Before - 20, 'other base debited once');
  const bm2Again = await login('cy.bm2', 'cycle-secret-1');
  assert((await call('/api/movements?limit=50', bm2Again)).body.movements.some(m => m.requestId === R5.id && m.type === 'dispatch' && m.from.before != null), 'source base manager sees its own debit');
  assert(!(await call('/api/state', bm2Again)).body.requests.some(r => r.id === R5.id), 'source base manager does not gain the unit request');

  // ===== تسجيل خروج دور واحد =====
  assert((await call('/api/logout', bmAgain, 'POST')).status === 200, 'base manager logs out');
  const [bmOut, adminOk, umOk] = await Promise.all([call('/api/state', bmAgain), call('/api/state', admin), call('/api/state', umAgain)]);
  assert(bmOut.status === 401 && adminOk.status === 200 && umOk.status === 200 && umOk.body.user.role === 'user', 'other two sessions continue');

  // ===== مسودة الشات بوت: فصيح وعامي وإنجليزي، دون إنشاء طلب =====
  const countBefore = (await call('/api/state', admin)).body.requests.length;
  const draft = await call('/api/ai/request-draft', umAgain, 'POST', { text: 'مياه شرب معبأة|100|liter;dates|5|kg;بوجي|4|piece' });
  assert(draft.status === 200, `draft ${JSON.stringify(draft.body)}`);
  const byKey = Object.fromEntries(draft.body.draft.items.map(i => [i.resource, i]));
  assert(byKey.azm_bottled_water?.requestable && byKey.azm_dates?.requestable && byKey.azm_spark_plug?.requestable === true && !byKey.azm_spark_plug.blockedReason, 'fusha / English / colloquial names map for all assigned active items');
  const colloquial = await call('/api/ai/request-draft', umAgain, 'POST', { text: 'موية|50|liter;وجبة جاهزة للأكل|10|piece' });
  assert(colloquial.body.draft.items.map(i => i.resource).join() === 'azm_bottled_water,azm_mre' && colloquial.body.draft.ready, 'colloquial and fusha names resolve');
  assert((await call('/api/state', admin)).body.requests.length === countBefore, 'drafts never create requests');

  // ===== قراءة سياق الشات بوت حسب النطاق =====
  const ctxTool = await call('/api/ai/tools/read', umAgain, 'POST', { name: 'read_requests', arguments: {} });
  assert(ctxTool.status === 200 && JSON.stringify(ctxTool.body).includes(R1.id) && !JSON.stringify(ctxTool.body).includes(B.unitId), 'chatbot read tools stay in unit scope');
  await stopServer(server);

  // ===== ترحيل بيانات v7 قديمة =====
  const legacyDir = mkdtempSync(join(tmpdir(), 'azm-v7-to-v8-')); dirs.push(legacyDir);
  const legacyPort = port + 1, lcall = client(legacyPort);
  const catalog = catalogRows.map(row => {
    const unitBasis = ['I', 'II', 'VIII'].includes(row.supplyClass) ? 'people' : 'vehicles';
    return { key: row.key, icon: '📦', name: { ar: row.aliases.ar[0], en: row.item }, unit: { ar: row.stockUnit, en: row.stockUnit }, measure: row.stockUnit, capacity: { main: row.suggestedCapacity.main, fsb: row.suggestedCapacity.fsb }, unitBasis, unitFactor: row.suggestedCapacity.unit / (unitBasis === 'people' ? 500 : 40), usage: 'maintenance', weight: 0, active: true, training: { item: row.item, supplyClass: row.supplyClass, aliases: row.aliases }, updatedBy: 'admin' };
  });
  Object.assign(catalog.find(c => c.key === 'azm_bottled_water'), { unitBasis: 'fixed', unitFactor: 10800 });
  catalog.find(c => c.key === 'azm_helmet').name.ar = 'خوذة مخصصة';
  const now = Date.now(), nodes = [{ id: 'oldbase', type: 'main', label: 'قديمة', pos: [24, 46] },
    { id: 'u-UNIT-01', type: 'unit', unitId: 'UNIT-01', label: 'وحدة قديمة', baseId: 'oldbase', people: 500, vehicles: 40, allowedResources: ['azm_bottled_water', 'azm_diesel', 'azm_helmet'], pos: [24.1, 46.1] },
    { id: 'u-UNIT-02', type: 'unit', unitId: 'UNIT-02', label: 'وقودان', baseId: 'oldbase', people: 500, vehicles: 40, allowedResources: ['azm_bottled_water', 'azm_diesel', 'azm_gasoline'], pos: [24.2, 46.2] }];
  const depot = Object.fromEntries(catalog.map(c => [c.key, c.capacity.main - 1000]));
  const reqs = [
    { id: 'ORD-AZM-901', kind: 'unit', unitId: 'UNIT-01', baseId: 'oldbase', status: 'pending', mode: 'truck', eta: 1, items: [{ resource: 'azm_helmet', qty: 5 }], history: [{ status: 'pending', at: now - 5000, by: 'admin' }] },
    { id: 'ORD-AZM-902', kind: 'unit', unitId: 'UNIT-01', baseId: 'oldbase', status: 'pending', mode: 'truck', eta: 1, items: [{ resource: 'azm_bottled_water', qty: 100 }], history: [{ status: 'pending', at: now - 5000, by: 'admin' }] },
    { id: 'ORD-AZM-903', kind: 'unit', unitId: 'UNIT-01', baseId: 'oldbase', status: 'approved', mode: 'truck', eta: 1, departAt: now - 1000, departSim: 0, items: [{ resource: 'azm_helmet', qty: 10 }, { resource: 'azm_bottled_water', qty: 100 }], dispatched: [{ resource: 'azm_helmet', qty: 10 }, { resource: 'azm_bottled_water', qty: 100 }], route: { fromId: 'oldbase', path: [[24, 46], [24.1, 46.1]], km: 15 }, history: [] },
  ];
  const old = { schemaVersion: 7, layoutVersion: 5, layout: { nodes, links: [] }, catalog, logs: [], alerts: [], alertFlags: {}, sim: { hours: 0, at: now, speed: 0, emergency: false }, nextOrder: 904, nextMovement: 1, nextOp: 1, trackingStartedAt: now - 10000 };
  const records = [{ id: 'oldbase', type: 'main', base: 'oldbase', unit: null, stock: null, depot, inv: { entityId: 'oldbase', type: 'main', opening: depot, openingAt: now - 10000 }, requests: reqs },
    { id: 'u-UNIT-01', type: 'unit', base: 'oldbase', unit: 'UNIT-01', stock: { azm_bottled_water: 50, azm_helmet: 20, azm_diesel: 10 }, depot: null, inv: { entityId: 'u-UNIT-01', type: 'unit', unitId: 'UNIT-01', opening: {}, openingAt: now - 10000 }, requests: reqs },
    { id: 'u-UNIT-02', type: 'unit', base: 'oldbase', unit: 'UNIT-02', stock: { azm_bottled_water: 10 }, depot: null, inv: { entityId: 'u-UNIT-02', type: 'unit', unitId: 'UNIT-02', opening: {}, openingAt: now - 10000 }, requests: [] }];
  mkdirSync(join(legacyDir, 'entities'));
  for (const row of records) {
    const db = new DatabaseSync(join(legacyDir, 'entities', Buffer.from(row.id).toString('hex') + '.sqlite'));
    db.exec('CREATE TABLE entity (id TEXT PRIMARY KEY, type TEXT, base_id TEXT, unit_id TEXT, inventory TEXT); CREATE TABLE balances (resource TEXT PRIMARY KEY, stock REAL, depot REAL); CREATE TABLE requests (id TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE movements (id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
    db.prepare('INSERT INTO entity VALUES (?,?,?,?,?)').run(row.id, row.type, row.base, row.unit, JSON.stringify(row.inv));
    for (const resource of new Set([...Object.keys(row.stock || {}), ...Object.keys(row.depot || {})])) db.prepare('INSERT INTO balances VALUES (?,?,?)').run(resource, row.stock?.[resource] ?? null, row.depot?.[resource] ?? null);
    for (const r of row.requests) db.prepare('INSERT INTO requests VALUES (?,?)').run(r.id, JSON.stringify(r));
    db.close();
  }
  writeFileSync(join(legacyDir, 'state.json'), JSON.stringify({ ...old, entityStoreVersion: 2, entityIds: records.map(r => r.id) }));
  let legacy = await startServer(legacyDir, legacyPort);
  let la = (await lcall('/api/login', null, 'POST', { username: 'admin', password: 'cycle-test-password' })).cookie;
  let ls = (await lcall('/api/state', la)).body;
  const lname = key => ls.catalog.find(c => c.key === key).name.ar;
  assert(lname('azm_bottled_water') === 'مياه شرب معبأة' && lname('azm_mre') === 'وجبة جاهزة للأكل' && lname('azm_helmet') === 'خوذة مخصصة', 'default names become fusha; manual name kept');
  const water = ls.catalog.find(c => c.key === 'azm_bottled_water');
  assert(water.usage === 'consumable' && water.weight > 0 && water.unitBasis === 'people', 'operational item restored to simulated consumption');
  assert(ls.catalog.find(c => c.key === 'azm_helmet').usage === 'maintenance', 'non-operational items untouched');
  assert(Math.abs(ls.inventory['u-UNIT-01'].qty.azm_bottled_water - 5400) < .01 && Math.abs(ls.inventory['u-UNIT-01'].qty.azm_helmet - 20) < .01, 'legacy balances preserved exactly');
  const n1 = ls.layout.nodes.find(n => n.unitId === 'UNIT-01'), n2 = ls.layout.nodes.find(n => n.unitId === 'UNIT-02');
  assert(n1.fuelType === 'azm_diesel' && n2.fuelType === null && n1.allowedResources.includes('azm_helmet'), 'fuel inferred only when unambiguous; legacy item kept');
  const p901 = ls.requests.find(r => r.id === 'ORD-AZM-901');
  assert(p901.status === 'pending' && !p901.legacyPolicy && !ls.requests.find(r => r.id === 'ORD-AZM-902').legacyPolicy, 'old pending item kept for review, not approved automatically');
  const review = (await lcall('/api/policy/review', la)).body;
  assert(!review.legacyRequests.length && !review.legacyInTransit.length && !review.unknownFuel.length, 'review no longer flags fuel choice or active equipment');
  assert(n1.allowedResources.length===40 && ls.inventory[n1.id].qty.azm_helmet===20, 'legacy active equipment remains assigned and stocked');
  assert(review.migration.renamed.some(r => r.key === 'azm_bottled_water') && review.migration.operationalFixed.some(r => r.key === 'azm_bottled_water'), 'migration report stored');
  assert((await lcall('/api/policy/review', (await lcall('/api/login', null, 'POST', { username: 'user01', password: readFileSync(join(legacyDir, 'FIRST_RUN_CREDENTIALS.txt'), 'utf8').match(/user01 \/ (\S+)/)?.[1] || 'x' })).cookie)).status !== 200, 'review is commander-only');
  assert((await lcall('/api/requests', la, 'POST', { unitId: 'UNIT-01', mode: 'truck', items: [{ resource: 'azm_helmet', qty: 1 }] })).status === 200, 'non-consumable active items can now be requested');
  assert(readdirSync(join(legacyDir, 'backups')).some(f => f.includes('pre-v10') && f.endsWith('-entities')), 'pre-v9 backup with entity databases');
  await lcall('/api/sim', la, 'POST', { speed: 20 });
  for (let i = 0; i < 40 && (await lcall('/api/state', la)).body.requests.find(r => r.id === 'ORD-AZM-903').status !== 'delivered'; i++) await sleep(250);
  await lcall('/api/sim', la, 'POST', { speed: 0 });
  const legacyMoves = (await lcall('/api/movements?limit=200', la)).body;
  assert(legacyMoves.movements.filter(m => m.requestId === 'ORD-AZM-903' && m.type === 'delivery').length === 2, 'old in-transit shipment delivered once, including legacy item');
  ls = (await lcall('/api/state', la)).body;
  assert(Math.abs(ls.inventory['u-UNIT-01'].qty.azm_helmet - 30) < .01, 'legacy item not consumed by simulation');
  assert(legacyMoves.movements.filter(m => m.type === 'consumption').every(m => ['azm_bottled_water', 'azm_diesel'].includes(m.resource)), 'legacy unit consumes water and its single fuel only');
  await stopServer(legacy);
  legacy = await startServer(legacyDir, legacyPort);
  la = (await lcall('/api/login', null, 'POST', { username: 'admin', password: 'cycle-test-password' })).cookie;
  const again = (await lcall('/api/movements?limit=200', la)).body;
  ls = (await lcall('/api/state', la)).body;
  assert(again.movements.filter(m => m.requestId === 'ORD-AZM-903' && m.type === 'delivery').length === 2 && ls.requests.find(r => r.id === 'ORD-AZM-901').status === 'pending', 'restart: no duplicate delivery, no re-migration');
  await stopServer(legacy);
  console.log(`All checks passed (${checks} request-cycle checks)`);
} finally {
  for (const c of children) c.kill();
  mock.close();
  await sleep(300);
  for (const d of dirs) { for (let i = 0; i < 10; i++) { try { rmSync(d, { recursive: true, force: true }); break; } catch { await sleep(200); } } }
}
