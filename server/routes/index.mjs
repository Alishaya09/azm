// موجّه طلبات /api: يجرّب المعالجات بالترتيب، وأول واحد يخدم الطلب يوقف البحث.
// كل طلب يحدد المستخدم من كوكي جلسته هو (جلسات مستقلة لكل حساب)، ونطاق صلاحيته يُحسب من حسابه على الخادم.
import { send } from '../lib/http.mjs';
import { currentUser } from '../store/sessions.mjs';
import { scopeOf } from '../store/scope.mjs';
import { handleMe, handlePublic } from './auth.mjs';
import { handleState } from './state.mjs';
import { handleRequests } from './requests.mjs';
import { handleLayout } from './layout.mjs';
import { handleEntities } from './entities.mjs';
import { handleChats } from './chats.mjs';
import { handleUsers } from './users.mjs';
import { handleDepots } from './depots.mjs';
import { handleReports } from './reports.mjs';
import { handleCatalog } from './catalog.mjs';
import { handleEvents } from './events.mjs';
import { handleAiTools } from './ai-tools.mjs';
import { handleReportChats } from './report-chats.mjs';
import { auditContext } from '../store/audit.mjs';
import { handleAudit } from './audit.mjs';
import { handleOpsReports } from './ops-reports.mjs';
import { handlePolicy } from './policy.mjs';

// كل هذي تحتاج جلسة صالحة
const protectedHandlers = [handleMe, handleState, handleEvents, handleRequests, handleLayout, handleEntities, handleDepots, handleReports, handleCatalog, handleChats, handleAiTools, handleReportChats, handleOpsReports, handlePolicy, handleUsers];

export async function handleApi(req, res, path) {
  const ctx = { req, res, path, method: req.method };
  if (await handlePublic(ctx)) return;
  const me = currentUser(req);
  if (!me) return send(res, 401, { error: 'not_logged_in' });
  // scope: نطاق المستخدم (scope.mjs). isAdmin = القائد الرئيسي فقط
  Object.assign(ctx, { me, isAdmin: me.role === 'admin', scope: scopeOf(me), forbidden: () => send(res, 403, { error: 'forbidden' }) });
  if (await handleAudit(ctx)) return;
  for (const handler of protectedHandlers) if (await auditContext.run({ by: me.username, role: me.role, reference: path }, () => handler(ctx))) return;
  send(res, 404, { error: 'not_found' });
}
