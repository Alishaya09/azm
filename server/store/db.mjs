// التخزين الخام لحالة العمليات (data/state.json): التحميل، الحفظ، والنسخ الاحتياطي.
// كل وحدات store الأخرى تبني فوق هذا الملف، وما يستورد أي وحدة ثانية (حتى ما يصير استيراد دائري).
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from '../config.mjs';
import { readJson, writeJson } from '../lib/storage.mjs';
import { notifyStateSaved } from '../lib/events.mjs';
import { captureAudit } from './audit.mjs';

export const stateFile = join(DATA_DIR, 'state.json');
const entitiesDir = join(DATA_DIR, 'entities');
const pendingFile = join(DATA_DIR, 'entity-commit-pending.json');
mkdirSync(DATA_DIR, { recursive: true });

// existedBefore: هل كان فيه ملف بيانات قبل هذا التشغيل؟ (الترحيل ياخذ نسخة احتياطية منه قبل أي كتابة)
export const existedBefore = existsSync(stateFile);
const pending = existsSync(pendingFile) ? readJson(pendingFile, null) : null;
export const state = pending?.state || readJson(stateFile, null) || {
  requests: [
    { id: 'ORD-AZM-401', unitId: 'UNIT-01', resource: 'fuel', level: 27, mode: 'truck', eta: 2.2, status: 'pending', by: 'system' },
    { id: 'ORD-AZM-402', unitId: 'UNIT-03', resource: 'ammo', level: 22, mode: 'heli', eta: 1.0, status: 'pending', by: 'system' },
  ],
  logs: [], layout: null, layoutVersion: 0, nextOrder: 403,
};
state.stocks ||= {}; state.alerts ||= []; state.alertFlags ||= {}; state.depots ||= {};
state.sim ||= { speed: 1, emergency: false, hours: 0, at: Date.now() };
// وضع الطوارئ أُزيل كاملاً: الحقل يبقى للتوافق مع البيانات القديمة ويُطفأ دائماً
state.sim.emergency = false;

// ملف مستقل لكل جهة. الحالة في الذاكرة مجمّعة للتوافق مع بقية منطق النظام؛ على القرص
// يقتصر state.json على الفهرس والإعدادات، ولا يحفظ أرصدة الجهات أو طلباتها أو حركاتها.
const entityFile = id => join(entitiesDir, `${Buffer.from(id).toString('hex')}.sqlite`);
const decode = value => value == null ? null : JSON.parse(value);
function readEntity(id) {
  const db = new DatabaseSync(entityFile(id));
  try {
    const meta = db.prepare('SELECT * FROM entity WHERE id = ?').get(id);
    if (!meta) throw new Error(`Invalid entity database: ${id}`);
    const balances = db.prepare('SELECT resource, stock, depot FROM balances').all(), stock = {}, depot = {};
    for (const row of balances) { if (row.stock !== null) stock[row.resource] = row.stock; if (row.depot !== null) depot[row.resource] = row.depot; }
    return { entityId: id, type: meta.type, baseId: meta.base_id, unitId: meta.unit_id,
      stock: meta.unit_id ? stock : null, depot: meta.type !== 'unit' ? depot : null,
      inventory: decode(meta.inventory),
      requests: db.prepare('SELECT payload FROM requests ORDER BY id').all().map(x => decode(x.payload)),
      movements: db.prepare('SELECT payload FROM movements ORDER BY id').all().map(x => decode(x.payload)) };
  } finally { db.close(); }
}

function writeEntity(row) {
  const db = new DatabaseSync(entityFile(row.entityId));
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS entity (id TEXT PRIMARY KEY, type TEXT, base_id TEXT, unit_id TEXT, inventory TEXT);
      CREATE TABLE IF NOT EXISTS balances (resource TEXT PRIMARY KEY, stock REAL, depot REAL);
      CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS movements (id TEXT PRIMARY KEY, payload TEXT NOT NULL);`);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('DELETE FROM entity; DELETE FROM balances; DELETE FROM requests; DELETE FROM movements;');
      db.prepare('INSERT INTO entity VALUES (?, ?, ?, ?, ?)').run(row.entityId, row.type, row.baseId, row.unitId, JSON.stringify(row.inventory));
      const bal = db.prepare('INSERT INTO balances VALUES (?, ?, ?)');
      for (const resource of new Set([...Object.keys(row.stock || {}), ...Object.keys(row.depot || {})])) bal.run(resource, row.stock?.[resource] ?? null, row.depot?.[resource] ?? null);
      const req = db.prepare('INSERT INTO requests VALUES (?, ?)');
      for (const x of row.requests) req.run(x.id, JSON.stringify(x));
      const move = db.prepare('INSERT INTO movements VALUES (?, ?)');
      for (const x of row.movements) move.run(x.id, JSON.stringify(x));
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  } finally { db.close(); }
}
const touches = (m, id) => [m.from, m.to, m.transit?.from, m.transit?.to].some(p => p?.entityId === id);
const nodes = () => [...(state.layout?.nodes || []), ...Object.values(state.archivedEntities || {}).map(x => x.node).filter(Boolean)];
const archived = id => Object.hasOwn(state.archivedEntities || {}, id);
const entityIds = () => [...new Set([...nodes().filter(n => ['main', 'fsb', 'unit'].includes(n.type)).map(n => n.id),
  ...Object.keys(state.inventory || {}), ...Object.keys(state.depots || {}),
  ...Object.keys(state.stocks || {}).map(unitId => nodes().find(n => n.unitId === unitId)?.id || `u-${unitId}`)].filter(id => !archived(id)))].sort();
const nodeFor = id => nodes().find(n => n.id === id) || (id.startsWith('u-') && state.stocks?.[id.slice(2)] ? { id, type: 'unit', unitId: id.slice(2) } : null);
const requestFor = (r, n) => n?.type === 'unit' ? r.unitId === n.unitId || r.route?.fromId === n.id
  : r.targetId === n?.id || r.route?.fromId === n?.id || (n?.type === 'main' && r.baseId === n.id);

function loadEntityFiles() {
  if (pending || !state.entityStoreVersion || !existsSync(entitiesDir)) return;
  state.stocks = {}; state.depots = {}; state.inventory = {}; state.requests = []; state.movements = [];
  const seenRequests = new Set(), seenMovements = new Set();
  for (const id of state.entityIds || []) {
    const file = entityFile(id);
    if (!existsSync(file)) throw new Error(`Missing entity database: ${id}`);
    const row = readEntity(id);
    if (row.stock && row.unitId) state.stocks[row.unitId] = row.stock;
    if (row.depot) state.depots[id] = row.depot;
    if (row.inventory) state.inventory[id] = row.inventory;
    for (const r of row.requests || []) if (!seenRequests.has(r.id)) { seenRequests.add(r.id); state.requests.push(r); }
    for (const m of row.movements || []) if (!seenMovements.has(m.id)) { seenMovements.add(m.id); state.movements.push(m); }
  }
  // Archived entities have no private database file. Their last balances and
  // inventory metadata live in the central historical index for reporting.
  for (const [id, row] of Object.entries(state.archivedSnapshots || {})) {
    if (row.stock && row.unitId) state.stocks[row.unitId] = row.stock;
    if (row.depot) state.depots[id] = row.depot;
    if (row.inventory) state.inventory[id] = row.inventory;
  }
  for (const r of state.unassignedRequests || []) if (!seenRequests.has(r.id)) state.requests.push(r);
  for (const m of state.unassignedMovements || []) if (!seenMovements.has(m.id)) state.movements.push(m);
  state.movements.sort((a, b) => (Number(a.id?.slice(3)) || 0) - (Number(b.id?.slice(3)) || 0));
  delete state.unassignedRequests; delete state.unassignedMovements;
}
loadEntityFiles();
captureAudit(state);

export const saveState = () => {
  captureAudit(state);
  state.archivedSnapshots ||= {};
  for (const [id, archivedRecord] of Object.entries(state.archivedEntities || {})) {
    const n = archivedRecord.node;
    state.archivedSnapshots[id] = { unitId: n?.unitId || null,
      stock: n?.unitId ? state.stocks?.[n.unitId] || {} : null,
      depot: state.depots?.[id] || null, inventory: state.inventory?.[id] || null };
  }
  // سجل الاستعادة يُكتب أولاً: إذا توقف الخادم وسط تحديث ملفات الجهات نعيد تشغيل العملية منه.
  writeJson(pendingFile, { state });
  mkdirSync(entitiesDir, { recursive: true });
  const ids = entityIds(), assignedReq = new Set(), assignedMov = new Set();
  for (const id of ids) {
    const n = nodeFor(id), requests = (state.requests || []).filter(r => requestFor(r, n));
    const movements = (state.movements || []).filter(m => touches(m, id));
    requests.forEach(r => assignedReq.add(r.id)); movements.forEach(m => assignedMov.add(m.id));
    writeEntity({ entityId: id, type: n?.type || state.inventory?.[id]?.type || (state.depots?.[id] ? 'main' : null),
      baseId: n?.baseId || (n?.type === 'main' ? id : null), unitId: n?.unitId || null,
      stock: n?.unitId ? state.stocks?.[n.unitId] || {} : null, depot: state.depots?.[id] || null,
      inventory: state.inventory?.[id] || null, requests, movements });
  }
  const core = { ...state, entityStoreVersion: 2, entityIds: ids,
    unassignedRequests: state.requests.filter(r => !assignedReq.has(r.id)),
    unassignedMovements: (state.movements || []).filter(m => !assignedMov.has(m.id)) };
  delete core.stocks; delete core.depots; delete core.inventory; delete core.requests; delete core.movements;
  writeJson(stateFile, core);
  state.entityStoreVersion = 2; state.entityIds = ids;
  // Do this only after the historical index has committed successfully.
  for (const id of Object.keys(state.archivedEntities || {})) rmSync(entityFile(id), { force: true });
  rmSync(pendingFile, { force: true });
  notifyStateSaved();
};
if (pending) saveState();

// نسخة من الملف كما هو على القرص قبل الكتابة عليه (data/backups/state-<وقت>-<سبب>.json)
export const backupState = tag => {
  if (!existsSync(stateFile)) return null;
  const dir = join(DATA_DIR, 'backups'); mkdirSync(dir, { recursive: true });
  const file = join(dir, `state-${new Date().toISOString().replace(/[:.]/g, '-')}-${tag}.json`);
  copyFileSync(stateFile, file);
  // أرصدة الجهات والطلبات والحركات محفوظة في ملفات مستقلة؛ نسخة state.json وحدها لا تكفي للاستعادة.
  if (existsSync(entitiesDir)) cpSync(entitiesDir, join(dir, `${basename(file, '.json')}-entities`), { recursive: true });
  return file;
};
