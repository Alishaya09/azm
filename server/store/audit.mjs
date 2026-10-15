// سياق المنفذ منفصل لكل طلب متزامن. لا ننسخ أجسام الطلبات أو بيانات المصادقة.
import { AsyncLocalStorage } from 'node:async_hooks';
export const auditContext = new AsyncLocalStorage();
export const auditActor = () => auditContext.getStore() || { by: 'system', role: 'system' };
let previous = null;
const projection = state => ({
  entities: Object.fromEntries((state.layout?.nodes || []).map(n => [n.id, { ...Object.fromEntries(['id','type','unitId','baseId','supplyId','parentId','label','labelKey','pos','allowedResources','fuelType','createdBy','createdAt','relationSource'].filter(k => n[k] !== undefined).map(k => [k,n[k]])), opening: state.inventory?.[n.id]?.opening }])),
  requests: Object.fromEntries((state.requests || []).map(r => [r.id, { id: r.id, unitId: r.unitId, baseId: r.baseId, status: r.status, mode: r.mode, items: r.items, approvedItems: r.approvedItems, dispatched: r.dispatched, executedBy: r.executedBy, reason: r.rejectReason||r.supplyReason||null, comments: r.comments?.length || 0, history: r.history?.length || 0, lastBy: r.history?.at(-1)?.by }])),
  catalog: { catalog: state.catalog },
  simulation: { simulation: { speed: state.sim?.speed, emergency: state.sim?.emergency } },
  layout: { links: state.layout?.links },
});
export function appendAudit(state, type, reference, scope = {}, changes = null) {
  state.audit ||= []; state.nextAudit ||= 1;
  const { by, role } = auditActor();
  state.audit.push({ id: `AU-${state.nextAudit++}`, at: Date.now(), type, reference, by, role, ...scope, ...(changes ? { changes } : {}) });
}
export function captureAudit(state) {
  const next = JSON.parse(JSON.stringify(projection(state)));
  if (previous) for (const group of Object.keys(next)) {
    for (const id of new Set([...Object.keys(previous[group]), ...Object.keys(next[group])])) {
      const before = previous[group][id], after = next[group][id];
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      const record = after || before || {};
      const node = group === 'entities' ? record : null;
      const action = group === 'requests' ? !before ? 'pending' : before.status !== after?.status ? after?.status : before.comments !== after?.comments ? 'comment' : before.mode !== after?.mode ? 'air' : 'update' : !before ? 'create' : !after ? 'archive' : 'update';
      appendAudit(state, group, id, { action, entityId: node?.id || null, unitId: record.unitId || null, baseId: record.baseId || (node?.type === 'main' ? node.id : null), requestId: group === 'requests' ? id : null, ...(group === 'requests' && record.lastBy === 'system' && before?.history !== after?.history ? { by: 'system', role: 'system' } : {}) }, { before: before || null, after: after || null });
    }
  }
  previous = next;
}
