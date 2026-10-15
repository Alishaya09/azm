// الكيانات (قواعد، مراكز إمداد، وحدات) — للقائد الرئيسي، ومسؤول القاعدة ينشئ وحدات لقاعدته فقط:
//   POST   /api/entities               إنشاء كيان: { type, label, pos, baseId?, opening? }
//                                     مسؤول القاعدة: type=unit فقط، والقاعدة قاعدته دائماً، ومصدر رصيد البداية من مستودعات قاعدته
//                                     المركز والوحدة: القاعدة إلزامية وتبقى ثابتة. الوحدة ما تحتاج مركز إمداد دائم.
//   POST   /api/entities/:id/repair    إصلاح سجل قديم قاعدته مفقودة أو ملتبسة فقط: { baseId } ثم تثبت
//   PUT    /api/entities/:id/relations (قديم) — مرفوض: التبعية ثابتة بعد الإنشاء (409 relation_locked)
//   DELETE /api/entities/:id           أرشفة (حذف من الخريطة مع حفظ التاريخ)
import { cleanText, readBody, send, validPoint } from '../lib/http.mjs';
import { addLog, saveState, state } from '../store/state.mjs';
import { inboundTo } from '../store/state.mjs';
import { activeKeys, resDef } from '../store/catalog.mjs';
import { needsBaseRepair, nodeById, qtyOf, relationError, setRelation } from '../store/hierarchy.mjs';
import { applyMovement, flushConsumption, nextOpId } from '../store/ledger.mjs';
import { centerStarterError, archiveBlockers, archiveEntity, createEntityRecords, newUnitResources, nextUnitId, starterError } from '../store/entities.mjs';
import { newNodeId } from './layout.mjs';
import { nextEntityCode } from '../store/codes.mjs';

export async function handleEntities({ req, res, path, method, me, isAdmin, scope, forbidden }) {
  if (!path.startsWith('/api/entities')) return false;
  const baseManagerCreate = scope.role === 'base_manager' && path === '/api/entities' && method === 'POST';
  if (!isAdmin && !baseManagerCreate) return forbidden();

  if (path === '/api/entities' && method === 'POST') {
    const b = await readBody(req), label = cleanText(b.label, 80);
    if (!['main', 'fsb', 'unit'].includes(b.type) || !label || !validPoint(b.pos)) return send(res, 400, { error: 'invalid_entity' });
    // مسؤول القاعدة: وحدات فقط، لقاعدته فقط، ومصدر رصيد البداية مستودع داخل قاعدته
    if (!isAdmin && (b.type !== 'unit' || (b.baseId != null && b.baseId !== scope.baseId) || (b.sourceId != null && !scope.depotIds.has(b.sourceId)))) return forbidden();
    if (!isAdmin) b.baseId = scope.baseId;
    // التبعية إلزامية من البداية: المركز والوحدة لقاعدة موجودة
    const baseId = b.type === 'main' ? null : b.baseId;
    const err = relationError(b.type, baseId);
    if (err) return send(res, 400, { error: err });
    if (b.operationKey !== undefined && (typeof b.operationKey !== 'string' || !/^[A-Za-z0-9_-]{3,64}$/.test(b.operationKey))) return send(res, 400, { error: 'bad_request' });
    const key = b.operationKey ? `${me.username}:create:${b.operationKey}` : null, signature = JSON.stringify(b);
    const previous = key && state.supplyOperations?.[key];
    if (previous) return previous.signature === signature ? send(res, 200, previous.result) : send(res, 400, { error: 'bad_request' });
    const unitId = b.type === 'unit' ? nextUnitId() : null;
    const n = { id: b.type === 'unit' ? `u-${unitId}` : newNodeId(b.type), type: b.type, code: nextEntityCode(b.type, baseId), label, pos: b.pos.map(v => +Number(v).toFixed(5)), ...(unitId ? { unitId } : {}), createdAt: Date.now(), createdBy: me.username, relationSource: isAdmin ? 'admin' : 'base_manager' };
    if (unitId) {
      if (!Number.isInteger(b.people ?? 500) || (b.people ?? 500) < 1 || (b.people ?? 500) > 2000 || !Number.isInteger(b.vehicles ?? 40) || (b.vehicles ?? 40) < 0 || (b.vehicles ?? 40) > 200) return send(res, 400, { error: 'invalid_capacity' });
      n.people = b.people ?? 500; n.vehicles = b.vehicles ?? 40;
      // التخصيص شامل لكل الأصناف النشطة؛ حقل الوقود التاريخي لا يتحكم فيه.
      n.allowedResources = newUnitResources();
    }
    setRelation(n, baseId);
    // رصيد الإنشاء ثابت ويمكن تتبعه؛ المدخلات القديمة ذات الرصيد اليدوي لا تتجاوز مسار الخصم والسجل.
    if (b.opening && (typeof b.opening !== 'object' || Object.values(b.opening).some(v => Number(v) !== 0))) return send(res, 400, { error: 'invalid_quantity' });
    if (unitId) { const problem = starterError(n, b.sourceId || baseId); if (problem) return send(res, problem.error === 'insufficient_stock' ? 409 : 400, problem); }
    if (n.type === 'fsb') { const problem = centerStarterError(n); if (problem) return send(res, 409, problem); }
    state.layout.nodes.push(n);
    const inventory = createEntityRecords(n, me.username, { sourceId: unitId ? (b.sourceId || baseId) : null });
    state.layoutVersion++;
    const result = { node: n, inventory, layoutVersion: state.layoutVersion };
    if (key) (state.supplyOperations ||= {})[key] = { signature, result };
    saveState();
    return send(res, 200, result);
  }

  const m = path.match(/^\/api\/entities\/([A-Za-z0-9_-]+)(?:\/(relations|confirm|repair|resources|maintenance))?$/);
  if (!m) return false;
  const n = nodeById(m[1]);
  if (!n) return send(res, 404, { error: 'not_found' });

  // التبعية ثابتة: ما فيه تعديل عام (القائد ولا غيره)
  if (m[2] === 'relations' || m[2] === 'confirm') return send(res, 409, { error: 'relation_locked' });

  if (m[2] === 'resources' && method === 'PUT') {
    if (n.type !== 'unit') return send(res, 400, { error: 'invalid_entity' });
    const b = await readBody(req), existing = n.allowedResources || [];
    const selected = b.allowedResources === undefined ? [...existing] : b.allowedResources;
    if (!Array.isArray(selected) || new Set(selected).size !== selected.length || selected.some(k => !activeKeys().includes(k) && !existing.includes(k)) || activeKeys().some(k => !selected.includes(k))) return send(res, 400, { error: 'invalid_unit_resources' });
    const blocked = existing.filter(k => !selected.includes(k)).filter(k => qtyOf(n.id, k) > 0 || (inboundTo(n.id)[k] || 0) > 0 || state.requests.some(r => r.unitId === n.unitId && ['pending', 'assigned', 'approved'].includes(r.status) && (r.items || [{ resource: r.resource }]).some(i => i.resource === k)));
    if (blocked.length) return send(res, 409, { error: 'resource_in_use', resources: blocked });
    flushConsumption(n.id);
    n.allowedResources = [...new Set([...selected, ...activeKeys()])];
    state.layoutVersion++; saveState();
    return send(res, 200, { node: n, layoutVersion: state.layoutVersion });
  }

  if (m[2] === 'maintenance' && method === 'POST') {
    if (n.type !== 'unit') return send(res, 400, { error: 'invalid_entity' });
    const b = await readBody(req), resource = resDef(b.resource), reason = cleanText(b.reason, 300);
    if (!resource || resource.usage !== 'maintenance' || !n.allowedResources?.includes(resource.key) || qtyOf(n.id, resource.key) <= 0 || !reason) return send(res, 400, { error: 'bad_request' });
    const rec = state.inventory[n.id], item = (rec.maintenance ||= {})[resource.key] ||= { condition: 100 };
    const before = item.condition;
    item.condition = 100; item.due = false; item.servicedAt = Date.now();
    const opId = nextOpId('MT');
    const movement = applyMovement({ type: 'maintenance', resource: resource.key, qty: 0, fromId: n.id, by: me.username, reason, opId, extra: { conditionBefore: before, conditionAfter: 100 } });
    addLog('maintenance', `${n.unitId} · ${resource.key}`, me.username, { unitId: n.unitId, baseIds: [n.baseId] });
    saveState();
    return send(res, 200, { movement, maintenance: item });
  }

  if (m[2] === 'repair' && method === 'POST') {
    // فقط لسجل قديم بدون قاعدة صالحة — الكيانات اللي قاعدتها صالحة ما تتغير
    if (!needsBaseRepair(n)) return send(res, 409, { error: 'relation_locked' });
    const b = await readBody(req), err = relationError(n.type, b.baseId);
    if (err) return send(res, 400, { error: err });
    flushConsumption(n.id);
    const before = { baseId: n.baseId || null, supplyId: n.supplyId || null };
    setRelation(n, b.baseId);
    Object.assign(n, { relationSource: 'repaired', relationChangedAt: Date.now(), relationChangedBy: me.username });
    (state.relationLog ||= []).push({ at: Date.now(), by: me.username, entityId: n.id, kind: 'repair', before, after: { baseId: n.baseId, supplyId: n.supplyId || null } });
    state.layoutVersion++; saveState();
    return send(res, 200, { node: n, layoutVersion: state.layoutVersion });
  }

  if (!m[2] && method === 'DELETE') {
    // الإزالة = أرشفة تحفظ الطلبات والحركات. إذا فيه طلبات نشطة أو شحنات نرجع السبب مع قائمتها
    const blocker = archiveBlockers(n);
    if (blocker) return send(res, 409, blocker);
    archiveEntity(n, me.username);
    state.layout.nodes = state.layout.nodes.filter(x => x.id !== n.id);
    state.layout.links = state.layout.links.filter(l => l.from !== n.id && l.to !== n.id);
    state.layoutVersion++; saveState();
    return send(res, 200, { archived: n.id, layoutVersion: state.layoutVersion });
  }
  return false;
}
