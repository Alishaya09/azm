import { send } from '../lib/http.mjs';
import { state } from '../store/db.mjs';
import { allMovements } from '../store/ledger.mjs';
import { canSeeMovement, redactMovement } from '../store/scope.mjs';

// عمليات السجل المرئية لهذا الحساب بعد الفلاتر، الأحدث أولاً. يستخدمها عرض السجل وتقرير العمليات الذكي.
export function auditEntries(scope, me, f = {}) {
  const visible = e => scope.all || (e.type === 'chats' && e.owner === me.username) || (scope.role === 'base_manager' && !!scope.baseId && e.baseId === scope.baseId) || (scope.role === 'user' && !!scope.unitId && e.unitId === scope.unitId);
  // تغييرات الحسابات والإعدادات العامة للقائد فقط؛ أرصدة الأطراف الخارجية تُحجب قبل البحث.
  const entries = [...(state.audit || []).filter(visible), ...allMovements().filter(m => canSeeMovement(scope, m)).map(m => redactMovement(scope, m))];
  const term = (f.search || '').slice(0, 200).toLowerCase();
  return entries.filter(e => (!f.actor || e.by===f.actor) && (!f.entityId || e.entityId===f.entityId || [e.from,e.to,e.transit?.from,e.transit?.to].some(p=>p?.entityId===f.entityId) || state.layout?.nodes.some(n=>n.id===f.entityId&&n.unitId&&n.unitId===e.unitId)) && (!f.type || e.type === f.type) && (!f.types || f.types.includes(e.type)) && (!f.resource || e.resource === f.resource) && (!f.from || e.at >= Number(f.from)) && (!f.to || e.at <= Number(f.to)) && (!term || JSON.stringify(e).toLowerCase().includes(term))).sort((a,b) => b.at-a.at || b.id.localeCompare(a.id));
}

export async function handleAudit({ req, res, path, method, scope, me }) {
  if (path !== '/api/audit' || method !== 'GET') return false;
  const q = new URL(req.url, 'http://localhost').searchParams;
  if (q.get('entityId') && !scope.all && !scope.entityIds.has(q.get('entityId'))) return send(res,403,{error:'out_of_scope'});
  if (['from','to','offset','limit'].some(k=>q.has(k)&&(!Number.isFinite(Number(q.get(k)))||Number(q.get(k))<0))) return send(res,400,{error:'bad_request'});
  // types (اختياري): أنواع مفصولة بفاصلة؛ صفحة سجل العمليات تطلب الطلبات والإرسال والتسليم فقط، وبقية العمليات تبقى مسجلة
  const types = q.get('types') ? q.get('types').split(',').filter(x => /^[a-z_]{1,32}$/.test(x)) : null;
  const entries = auditEntries(scope, me, { ...Object.fromEntries(['search','actor','entityId','type','resource','from','to'].map(k => [k, q.get(k) || ''])), ...(types?.length ? { types } : {}) });
  const offset = Math.max(0, Math.floor(Number(q.get('offset')) || 0)), limit = Math.max(1, Math.min(200, Math.floor(Number(q.get('limit')) || 25)));
  return send(res, 200, { total: entries.length, entries: entries.slice(offset, offset + limit) });
}
