// أدوات قراءة فقط. أسماء وأجسام الأدوات لا تتحول مطلقاً إلى مسارات كتابة.
import { state } from '../store/db.mjs';
import { canSeeRequest, redactRequest, scopeOf } from '../store/scope.mjs';
import { buildContext, nodeLabel } from './context.mjs';
import { layoutNodes } from '../store/hierarchy.mjs';
import { activeAccountEntity, accountBaseId } from '../store/account-scope.mjs';
import { users } from '../store/users.mjs';
import { canSeeAccount } from '../store/scope.mjs';
import { nodeById, unitNodeOf } from '../store/hierarchy.mjs';
import { buildReport } from '../store/reports.mjs';
import { reportEvidence } from './report.mjs';
import { isKnownResource } from '../store/catalog.mjs';
import { unitAllows } from '../store/hierarchy.mjs';

const fields = {
  read_requests: { requestId: { type: 'string' }, unitId: { type: 'string' }, status: { type: 'string', enum: ['pending','assigned','approved','delivered','rejected'] } },
  read_inventory: { entityId: { type: 'string' } },
  read_report: { unitId: { type: 'string' }, baseId: { type: 'string' }, resource: { type: 'string' }, from: { type: 'number' }, to: { type: 'number' } },
  // مواقع الجهات (إحداثيات) ضمن ما يظهر للسائل على الخريطة فقط
  read_locations: { nodeId: { type: 'string' } },
  // الحسابات (أشخاص النظام) ضمن ما يراه السائل في صفحة الحسابات: بدون كلمات مرور أو رقم عسكري أو جوال
  read_users: { username: { type: 'string' } },
};
export const readToolSchemas = Object.entries(fields).map(([name, properties]) => ({ type: 'function', function: { name, description: `Read permission-filtered AZM data: ${name}`, parameters: { type: 'object', additionalProperties: false, properties } } }));
const plain = v => v && typeof v === 'object' && !Array.isArray(v);
export function executeReadTool(me, scope, call) {
  // النطاق يُعاد اشتقاقه من حساب الجلسة حتى عند استدعاء الأداة داخلياً.
  scope = scopeOf(me);
  if (!plain(call) || Object.keys(call).some(k => !['name','arguments'].includes(k)) || !Object.hasOwn(fields,call.name) || !plain(call.arguments)) return { error: 'invalid_tool_call' };
  const args = call.arguments, allowed = fields[call.name];
  if (Object.entries(args).some(([k,v]) => !Object.hasOwn(allowed,k) || typeof v !== allowed[k].type || typeof v === 'number' && (!Number.isFinite(v)||v<0) || typeof v === 'string' && (!v||v.length>80) || allowed[k].enum && !allowed[k].enum.includes(v))) return { error: 'invalid_tool_call' };
  if ((args.unitId && !scope.unitIds.has(args.unitId)) || (args.baseId && !scope.baseIds.has(args.baseId)) || (args.entityId && !scope.entityIds.has(args.entityId)) || (args.resource && scope.role==='user' && !unitAllows(scope.unitId,args.resource))) return { error:'out_of_scope' };
  if (args.resource && !isKnownResource(args.resource) || args.from !== undefined && args.to !== undefined && args.from > args.to) return { error:'invalid_tool_call' };
  if (call.name==='read_requests') {
    const visible = state.requests.filter(r=>canSeeRequest(scope,r));
    if (args.requestId && !visible.some(r=>r.id===args.requestId)) return {error:'out_of_scope'};
    const found = visible.filter(r=>(!args.requestId||r.id===args.requestId)&&(!args.unitId||r.unitId===args.unitId)&&(!args.status||r.status===args.status));
    return { name:call.name, data:{ total:found.length, requests:found.slice(-100).map(r=>redactRequest(scope,r)), omitted:Math.max(0,found.length-100) } };
  }
  if (call.name==='read_inventory') {
    const snapshot=buildContext(me);
    return {name:call.name,data:{ units:snapshot.units.filter(u=>!args.entityId||state.layout.nodes.some(n=>n.id===args.entityId&&n.unitId===u.id)), depots:snapshot.depots.filter(d=>!args.entityId||d.id===args.entityId) }};
  }
  if (call.name==='read_locations') {
    // نفس نطاق الخريطة (scope.nodeIds): القائد الكل، مسؤول القاعدة قاعدته وتوابعها والقاعدة الرئيسية، مسؤول الوحدة وحدته وسلسلة إمدادها
    const TYPE = { hq: 'main_base', main: 'base', fsb: 'supply_point', unit: 'unit' };
    if (args.nodeId && !scope.nodeIds.has(args.nodeId)) return { error:'out_of_scope' };
    const list = layoutNodes().filter(activeAccountEntity).filter(n => scope.nodeIds.has(n.id) && (!args.nodeId || n.id === args.nodeId))
      .map(n => ({ id: n.id, name: nodeLabel(n), type: TYPE[n.type] || n.type, code: n.code || n.unitId || null, lat: n.pos?.[0] ?? null, lng: n.pos?.[1] ?? null }));
    return { name: call.name, data: { total: list.length, locations: list.slice(0, 60), omitted: Math.max(0, list.length - 60) } };
  }
  if (call.name==='read_users') {
    // القائد: الكل · مسؤول القاعدة: حسابات قاعدته (canSeeAccount) · مسؤول الوحدة: حسابه فقط
    const visible = users.filter(u => scope.all || (scope.role === 'base_manager' ? canSeeAccount(scope, u) : u.username === me.username));
    if (args.username && !visible.some(u => u.username === args.username)) return { error:'out_of_scope' };
    const name = id => { const n = id && nodeById(id); return n ? nodeLabel(n) : null; };
    const list = visible.filter(u => !args.username || u.username === args.username).map(u => {
      const unit = u.unitId ? unitNodeOf(u.unitId) : null;
      return { username: u.username, fullName: u.fullName ? String(u.fullName).replace(/\s+/g, ' ').slice(0, 60) : null, rank: u.rank || null, role: u.role, status: u.status,
        unit: unit ? nodeLabel(unit) : null, unitNodeId: unit?.id || null, base: name(accountBaseId(u)) };
    });
    return { name: call.name, data: { total: list.length, users: list.slice(0, 60), omitted: Math.max(0, list.length - 60) } };
  }
  const report=buildReport(me,args);
  return report.error ? report : {name:call.name,data:reportEvidence(report)};
}
