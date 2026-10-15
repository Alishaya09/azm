// تقارير العمليات الذكية من صفحة سجل العمليات: لعملية واحدة، أو عمليات محددة، أو فترة وفلاتر.
// العمليات تُختار من نفس سجل /api/audit بنطاق الجلسة، والأرقام يحسبها الخادم. التقارير تُحفظ لصاحبها فقط.
import { readBody, cleanText, send } from '../lib/http.mjs';
import { createChat, deleteChat, listChats, saveChats, trimChat } from '../store/chats.mjs';
import { isKnownResource } from '../store/catalog.mjs';
import { auditEntries } from './audit.mjs';
import { opsStats, writeOpsReport } from '../ai/ops-report.mjs';
import { state } from '../store/db.mjs';
import { canSeeRequest, redactRequest } from '../store/scope.mjs';

const TYPES = ['entities','requests','catalog','simulation','layout','users','external_add','transfer','dispatch','delivery','return','consumption','retirement','maintenance','maintenance_due'];
const MAX_IDS = 100;
// تقارير صفحة سجل العمليات مبنية على الإجراءات على الطلبات والإرسال والتسليم فقط (نفس ما تعرضه الصفحة)
const PAGE_TYPES = ['requests', 'dispatch', 'delivery'];
const ownerOf = me => `${me.username}::ops`;
// بيانات قالب التقرير الموحّد (PDF): الطلبات المرتبطة بآخر حالة، وتسلسل العمليات — بنطاق الحساب الحالي، بدون أرصدة الأطراف
const docRequest = r => { const { route, history, comments, ...rest } = r;
  return { ...rest, route: route ? { km: route.km, ...(route.restricted ? { restricted: true } : {}) } : undefined,
    history: (history || []).map(({ status, at, by, note }) => ({ status, at, by, note: typeof note === 'string' ? note.slice(0, 300) : null })),
    comments: (comments || []).slice(-10).map(({ by, at, text, kind }) => ({ by, at, kind, text: String(text || '').slice(0, 500) })) }; };
const partyLabel = p => !p || p.restricted ? null : p.label || p.code || null;
const docEntry = e => ({ id: e.id, at: e.at, type: e.type, action: e.action || null, requestId: e.requestId || null, resource: e.resource || null, qty: Number.isFinite(e.qty) ? e.qty : null,
  by: e.by || null, from: partyLabel(e.from || e.transit?.from), to: partyLabel(e.to || e.transit?.to) });
const summary = r => ({ id: r.id, title: r.title, updatedAt: r.updatedAt, createdAt: r.createdAt, count: r.messages.length, selection: r.selection, total: r.stats?.total ?? 0 });

// التحقق من التحديد: إما أرقام عمليات، أو فلاتر (فترة/جهة/نوع/مورد/منفذ/بحث)
function parseSelection(body, scope) {
  if (body.ids !== undefined) {
    if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > MAX_IDS || body.ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_:.-]{1,80}$/.test(id))) return { error: 'bad_request' };
    return { selection: { mode: 'ids', ids: [...new Set(body.ids)] } };
  }
  const f = body.filters && typeof body.filters === 'object' && !Array.isArray(body.filters) ? body.filters : {};
  const filters = {};
  for (const k of ['from', 'to']) if (f[k] !== undefined && f[k] !== '' && f[k] !== null) {
    if (!Number.isFinite(Number(f[k])) || Number(f[k]) < 0) return { error: 'bad_request' };
    filters[k] = Number(f[k]);
  }
  if (filters.from && filters.to && filters.from > filters.to) return { error: 'bad_request' };
  if (f.entityId) { if (typeof f.entityId !== 'string' || (!scope.all && !scope.entityIds.has(f.entityId))) return { error: 'out_of_scope' }; filters.entityId = f.entityId; }
  if (f.type) { if (!TYPES.includes(f.type) || !PAGE_TYPES.includes(f.type)) return { error: 'bad_request' }; filters.type = f.type; }
  if (f.resource) { if (!isKnownResource(f.resource)) return { error: 'bad_request' }; filters.resource = f.resource; }
  if (f.actor) filters.actor = cleanText(f.actor, 32);
  if (f.search) filters.search = cleanText(f.search, 200);
  return { selection: { mode: 'filters', filters } };
}

// العمليات بنطاق الجلسة الحالي (يعاد حسابها عند كل سؤال حتى لو تغيرت الصلاحية)؛ المحادثات الخاصة لا تدخل التقرير
function selectEntries(selection, scope, me) {
  if (selection.mode === 'ids') {
    const wanted = new Set(selection.ids);
    return auditEntries(scope, me).filter(e => wanted.has(e.id) && PAGE_TYPES.includes(e.type));
  }
  return auditEntries(scope, me, selection.filters).filter(e => PAGE_TYPES.includes(e.type));
}

// isReport يعلّم طلب التقرير (يُضاف له قسم «أبرز الأرقام» المحسوب) مقابل السؤال اللاحق
const historyOf = r => r.messages.filter(m => !m.kind || m.kind === 'report_request').map(m => ({ role: m.role, isReport: m.kind === 'report_request',
  text: m.kind === 'report_request' ? `Write the operations report for this selection.${m.text ? ` Focus: ${m.text}` : ''}` : m.text }));

export async function handleOpsReports({ req, res, path, method, me, scope }) {
  if (!path.startsWith('/api/ops-reports')) return false;
  const owner = ownerOf(me), list = listChats(owner);
  if (path === '/api/ops-reports' && method === 'GET') return send(res, 200, list.map(summary).sort((a, b) => b.updatedAt - a.updatedAt));
  const m = path.match(/^\/api\/ops-reports(?:\/([A-Za-z0-9-]+))?(\/messages|\/document)?$/);
  if (!m) return false;
  const [, id, messages] = m;
  const report = id && list.find(x => x.id === id);
  if (id && !report) return send(res, 404, { error: 'not_found' });
  if (id && !messages && method === 'GET') return send(res, 200, report);
  if (messages === '/document' && method !== 'GET') return false;
  if (id && messages === '/document') {
    const entries = selectEntries(report.selection, scope, me), ids = [...new Set(entries.map(e => e.requestId).filter(Boolean))];
    const requests = ids.slice(0, 30).map(x => state.requests.find(r => r.id === x)).filter(r => r && canSeeRequest(scope, r)).map(r => docRequest(redactRequest(scope, r)));
    return send(res, 200, { requests, requestTotal: ids.length, total: entries.length, timeline: entries.slice(0, 40).reverse().map(docEntry) });
  }
  if (id && !messages && method === 'DELETE') { deleteChat(owner, id); return send(res, 200, { ok: true }); }
  if (method !== 'POST' || (id && !messages)) return false;
  const body = await readBody(req), language = body.language === 'en' ? 'en' : 'ar';

  // سؤال لاحق على تقرير محفوظ
  if (id) {
    const question = cleanText(body.text, 2000);
    if (!question) return send(res, 400, { error: 'invalid_comment' });
    const entries = selectEntries(report.selection, scope, me);
    if (!entries.length) return send(res, 400, { error: 'no_operations' });
    report.messages.push({ role: 'user', text: question, at: Date.now() });
    const reply = await writeOpsReport(entries, report.selection, historyOf(report), language, me);
    report.messages.push({ role: 'assistant', at: Date.now(), ...(reply.kind ? { kind: reply.kind, error: reply.error, text: '' } : reply) });
    report.stats = opsStats(entries);
    trimChat(report); saveChats();
    return send(res, 200, report);
  }

  // تقرير جديد
  const parsed = parseSelection(body, scope);
  if (parsed.error) return send(res, parsed.error === 'out_of_scope' ? 403 : 400, { error: parsed.error });
  // رقم عملية غير مرئي لهذا الحساب يُرفض كله بدل تقرير ناقص بصمت
  if (parsed.selection.mode === 'ids') {
    const visible = new Set(auditEntries(scope, me).map(e => e.id));
    if (parsed.selection.ids.some(x => !visible.has(x))) return send(res, 403, { error: 'out_of_scope' });
  }
  const entries = selectEntries(parsed.selection, scope, me);
  if (!entries.length) return send(res, 400, { error: 'no_operations' });
  const focus = cleanText(body.focus, 500);
  const r = createChat(owner, focus || (parsed.selection.mode === 'ids' ? parsed.selection.ids.slice(0, 3).join(', ') : 'filters'));
  r.selection = parsed.selection; r.stats = opsStats(entries); r.language = language;
  r.messages.push({ role: 'user', kind: 'report_request', text: focus, at: Date.now() });
  const reply = await writeOpsReport(entries, r.selection, historyOf(r), language, me);
  r.messages.push({ role: 'assistant', at: Date.now(), ...(reply.kind ? { kind: reply.kind, error: reply.error, text: '' } : reply) });
  trimChat(r); saveChats();
  return send(res, 200, r);
}
