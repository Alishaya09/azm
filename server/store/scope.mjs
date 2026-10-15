// نطاق صلاحية كل حساب — المكان الوحيد اللي يحدد وش يشوف المستخدم ووش يقدر يدير.
// كل المسارات (routes/) وسياق المساعد (ai/context.mjs) تفلتر من هنا، ولاحقاً فلترة مستندات RAG (retrievalFilter).
//   admin         القائد الرئيسي: كل شي.
//   base_manager  مسؤول القاعدة: قاعدته (user.baseId) ومراكزها ووحداتها.
//   user          مسؤول الوحدة: وحدته (user.unitId) فقط، وأسماء سلسلة إمدادها بدون أرصدة المستودعات.
// المعرّفات تُقرأ من حساب المستخدم على الخادم، وما نثق بأي دور أو قاعدة أو وحدة يرسلها المتصفح.
// السجلات التاريخية تُفلتر بنسخة التبعية المحفوظة وقت العملية (baseId على الطلب والتنبيه والحركة)،
// فنقل وحدة لقاعدة ثانية ما يعطي مسؤول القاعدة الجديدة تاريخها القديم.
import { state } from './db.mjs';
import { chainOfUnit, isDepotNode, layoutNodes, nodeById, unitNodeOf } from './hierarchy.mjs';
import { accountBaseId, accountOperational, activeAccountEntity } from './account-scope.mjs';

const none = role => ({ role, all: false, baseId: null, unitId: null, nodeIds: new Set(), entityIds: new Set(), depotIds: new Set(), unitIds: new Set(), baseIds: new Set() });

export function scopeOf(user) {
  if (!accountOperational(user)) return none(user?.role || 'user');
  const nodes = layoutNodes().filter(activeAccountEntity);
  if (user?.role === 'admin') {
    const ids = new Set(nodes.map(n => n.id));
    return { role: 'admin', all: true, baseId: null, unitId: null, nodeIds: ids, entityIds: ids, depotIds: new Set(nodes.filter(isDepotNode).map(n => n.id)), unitIds: new Set(nodes.filter(n => n.type === 'unit').map(n => n.unitId)), baseIds: new Set(nodes.filter(n => n.type === 'main').map(n => n.id)) };
  }
  if (user?.role === 'base_manager') {
    const base = nodeById(user.baseId); if (!base || base.type !== 'main') return none('base_manager');
    const mine = nodes.filter(n => n.id === base.id || n.baseId === base.id), ids = new Set(mine.map(n => n.id));
    // headquarters is visible on the map, without exposing other bases or its balances.
    const visible = new Set([...ids, ...nodes.filter(n => n.type === 'hq').map(n => n.id)]);
    return { role: 'base_manager', all: false, baseId: base.id, unitId: null, nodeIds: visible, entityIds: ids, depotIds: new Set(mine.filter(isDepotNode).map(n => n.id)), unitIds: new Set(mine.filter(n => n.type === 'unit').map(n => n.unitId)), baseIds: new Set([base.id]) };
  }
  const u = unitNodeOf(user?.unitId); if (!u) return none('user');
  return { role: 'user', all: false, baseId: u.baseId || null, unitId: u.unitId, nodeIds: new Set(chainOfUnit(u.unitId).filter(id=>nodes.some(n=>n.id===id))), entityIds: new Set([u.id]), depotIds: new Set(), unitIds: new Set([u.unitId]), baseIds: new Set() };
}

// ===== الطلبات والتنبيهات والسجل =====
export const canSeeRequest = (s, r) => s.all || (s.role === 'base_manager' && !!s.baseId && r.baseId === s.baseId) || (s.role === 'user' && !!s.unitId && r.unitId === s.unitId);
// مسؤول القاعدة يقرر طلبات وحداته؛ القائد يقرر جميع الطلبات، وهو الوحيد الذي يموّن القواعد من المركز الرئيسي.
export const canManageRequest = (s, r) => s.all || (s.role === 'base_manager' && !!s.baseId && r.kind !== 'base' && r.baseId === s.baseId);
// مباشرة تنفيذ قرار القائد: مسؤول قاعدة الوحدة فقط (نسخة القاعدة المحفوظة على الطلب). لا ينشئ تكليفاً ولا يغيّر مصدره؛
// الصلاحية محصورة بهذا الطلب، ولا تمنحه رؤية مخزون قاعدة أخرى حتى لو كان المصدر منها.
export const canExecuteRequest = (s, r) => s.all && r.kind !== 'base' || s.role === 'base_manager' && !!s.baseId && r.kind !== 'base' && r.baseId === s.baseId;
export const canSeeAlert = (s, a) => s.all || (s.role === 'base_manager' && !!s.baseId && a.baseId === s.baseId) || (s.role === 'user' && a.unitId === s.unitId);
export const canSeeLog = (s, l) => {
  if (s.all) return true;
  if (l.unitId || l.baseIds) return s.role === 'user' ? l.unitId === s.unitId : !!s.baseId && (l.baseIds || []).includes(s.baseId);
  const r = state.requests.find(x => x.id === l.id); // سطر قديم بدون نطاق: يتبع طلبه، وغيره للقائد فقط
  return !!r && canSeeRequest(s, r);
};

// ===== حركات المخزون =====
const partiesOf = m => [m.from, m.to, m.transit?.from, m.transit?.to].filter(Boolean);
// طرف داخل النطاق = نشوف رصيده قبل وبعد (حسب التبعية وقت العملية)
const ownsParty = (s, p) => s.all || (s.role === 'base_manager' && !!s.baseId && p.baseId === s.baseId) || (s.role === 'user' && p.type === 'unit' && p.unitId === s.unitId);
export const canSeeMovement = (s, m) => s.all || partiesOf(m).some(p => ownsParty(s, p));
// يخفي أرصدة الأطراف اللي خارج النطاق (مثلاً رصيد مركز الإمداد عن مسؤول الوحدة، أو قاعدة ثانية في تحويل بين قواعد)
export const redactMovement = (s, m) => {
  if (s.all) return m;
  const strip = p => p && (ownsParty(s, p) ? p : s.nodeIds.has(p.entityId) ? { entityId: p.entityId, type: p.type, ...(p.label ? { label: p.label } : {}), ...(p.labelKey ? { labelKey: p.labelKey } : {}), restricted: true } : { restricted: true });
  return { ...m, from: strip(m.from), to: strip(m.to), ...(m.transit ? { transit: { from: strip(m.transit.from), to: strip(m.transit.to) } } : {}) };
};

// نسخة العرض: لا نرسل مسارات أو أسماء مصادر خارج النطاق، والتاريخ الأصلي يبقى محفوظاً.
export const redactRequest = (s, r) => {
  if (s.all) return r;
  const out = { ...r };
  const hideSource = (r.route?.fromId && !s.nodeIds.has(r.route.fromId)) || (r.sourceId && !s.nodeIds.has(r.sourceId)) || (r.source?.entityId && !s.nodeIds.has(r.source.entityId));
  if (hideSource) {
    if (r.route) out.route = { km: r.route.km, restricted: true };
    // منفّذ التكليف (مسؤول قاعدة الوحدة) يحتاج اسم المصدر فقط ليعرف من أين ينطلق الأمر — بلا أرصدة ولا مسار.
    if (r.source) out.source = canExecuteRequest(s, r) ? { restricted: true, type: r.source.type, ...(r.source.label ? { label: r.source.label } : r.source.labelKey ? { labelKey: r.source.labelKey } : {}) } : { restricted: true };
    delete out.sourceId; delete out.fromHq; delete out.crossBaseReason; delete out.blockedAttempts; delete out.previousDecisions;
  }
  // رصيد المصدر في سبب تعذر المباشرة: لا يظهر لمسؤول الوحدة، ولا لمسؤول قاعدة المصدر فيها خارج نطاقه
  if (r.executionBlocked && (hideSource || s.role === 'user')) out.executionBlocked = { ...r.executionBlocked, failures: r.executionBlocked.failures.map(({ available, sourceId, ...f }) => f) };
  if (r.supplyId && !s.nodeIds.has(r.supplyId)) delete out.supplyId;
  if (r.kind === 'base') { delete out.sourceId; delete out.fromHq; }
  return out;
};
export const redactLog = (s, l) => s.all ? l : { ...l, ...(l.baseIds ? { baseIds: l.baseIds.filter(id => s.baseIds.has(id)) } : {}), ...(!state.requests.some(r => r.id === l.id) ? { id: l.type } : {}) };

// ===== الخريطة =====
export const filterLayout = (s, layout) => {
  if (s.all || !layout) return layout;
  const nodes = layout.nodes.filter(n => s.nodeIds.has(n.id));
  return { nodes, links: layout.links.filter(l => s.nodeIds.has(l.from) && s.nodeIds.has(l.to)) };
};

// مسؤول القاعدة يرى بقية القواعد والوحدات على الخريطة بالاسم والموقع فقط (بدون أرصدة أو سعات أو أعداد أو تبعية).
// منفصلة عن layout حتى لا تدخل في المسارات أو المصادر أو صفحات البيانات.
export const mapNamesOnly = s => s.role !== 'base_manager' ? [] : layoutNodes().filter(activeAccountEntity)
  .filter(n => (n.type === 'main' || n.type === 'unit') && !s.nodeIds.has(n.id))
  .map(n => ({ id: n.id, type: n.type, pos: n.pos, ...(n.label ? { label: n.label } : {}), ...(n.labelKey ? { labelKey: n.labelKey } : {}), ...(n.unitId ? { unitId: n.unitId } : {}) }));

// ===== الحسابات =====
// مسؤول القاعدة يرى حسابات قاعدته (مسؤولو القاعدة ومسؤولو وحداتها، ومنها طلبات الانضمام لوحداتها)،
// ويدير حسابات مسؤولي الوحدات فقط: موافقة/رفض طلب الانضمام، إيقاف/تفعيل. الإنشاء والتعديل والحذف للقائد.
export const canSeeAccount = (s, u) => s.all || (s.role === 'base_manager' && !!s.baseId && (u.role === 'user' || u.role === 'base_manager') && accountBaseId(u) === s.baseId);
export const canManageAccount = (s, u) => s.all || (s.role === 'base_manager' && u.role === 'user' && canSeeAccount(s, u));

// ===== تجهيز RAG لاحقاً =====
// فلتر بيانات وصفية جاهز لمحرك البحث: أي مستند يحمل { baseIds?, entityIds?, unitIds? } أو visibility: 'all'.
// يُطبق قبل البحث/الاسترجاع، فالنموذج ما يستلم إلا نتائج داخل نطاق السائل.
export const retrievalFilter = user => {
  const s = scopeOf(user);
  return { all: s.all, role: s.role, baseIds: [...s.baseIds], entityIds: [...s.entityIds], unitIds: [...s.unitIds] };
};
export const canAccessDocument = (user, meta = {}) => {
  const f = retrievalFilter(user);
  if (f.all || meta.visibility === 'all') return true;
  const hit = (a, b) => (a || []).some(x => b.includes(x));
  return hit(meta.baseIds, f.baseIds) || hit(meta.entityIds, f.entityIds) || hit(meta.unitIds, f.unitIds);
};
