// المسارات اللي تشتغل بدون جلسة: تسجيل الدخول والخروج، طلب حساب جديد، وقائمة الوحدات لنموذج التسجيل.
import { RANKS, REGISTER_MAX_PER_HOUR } from '../config.mjs';
import { cleanText, readBody, send, validName, validPassword } from '../lib/http.mjs';
import { checkPassword, findUser, hashPassword, publicUser, saveUsers, users } from '../store/users.mjs';
import { clearFailures, createSession, currentUser, destroySession, isLocked, recordFailure, sessionCookieName } from '../store/sessions.mjs';
import { scopeOf } from '../store/scope.mjs';
import { unitIds } from '../store/state.mjs';
import { layoutNodes } from '../store/hierarchy.mjs';
import { auditContext } from '../store/audit.mjs';
import { accountOperational, accountBaseId, accountBindingError, activeAccountEntity } from '../store/account-scope.mjs';

const registrations = new Map(); // ip -> [timestamps] — حد أقصى لطلبات التسجيل من نفس الجهاز
export const validServiceId = s => typeof s === 'string' && /^[0-9]{4,15}$/.test(s);
export const validPhone = s => !s || (typeof s === 'string' && /^\+?[0-9]{7,15}$/.test(s));
export const validFullName = s => typeof s === 'string' && s.trim().length >= 3 && s.trim().length <= 60;

export async function handlePublic({ req, res, path, method }) {
  if (req.headers['x-azm-tab'] !== undefined && !sessionCookieName(req)) return send(res, 400, { error: 'bad_request' });
  if (path === '/api/login' && method === 'POST') {
    const ip = req.socket.remoteAddress;
    if (isLocked(ip)) return send(res, 429, { error: 'too_many_attempts' });
    const { username, password } = await readBody(req);
    const u = findUser(username);
    if (!u || typeof password !== 'string' || !checkPassword(password, u.password)) { recordFailure(ip); return send(res, 401, { error: 'invalid_credentials' }); }
    clearFailures(ip);
    // كلمة المرور صحيحة لكن الحساب غير نشط: نوضح السبب
    if (u.status !== 'active') return send(res, 403, { error: `account_${u.status}`, reason: u.status === 'rejected' ? u.rejectReason || null : undefined });
    if (!accountOperational(u)) return send(res, 403, { error: 'account_assignment_required' });
    u.lastLoginAt = Date.now(); auditContext.run({ by: u.username, role: u.role, reference: 'login' }, saveUsers);
    return send(res, 200, publicUser(u), { 'Set-Cookie': createSession(u.username, req) });
  }
  if (path === '/api/logout' && method === 'POST') return send(res, 200, { ok: true }, { 'Set-Cookie': destroySession(req) });

  // الوحدات (المعرّف والاسم) لمن سجّل دخوله فقط وضمن نطاقه. بدون جلسة ترجع قائمة فاضية حتى لا تنكشف
  // أسماء الوحدات لأي أحد على الشبكة؛ طالب الحساب يكتب رمز وحدته اللي يعطيه له مسؤوله.
  if (path === '/api/public/units' && method === 'GET') {
    const nodes = layoutNodes();
    const viewer = currentUser(req), scope = viewer ? scopeOf(viewer) : null;
    if (!scope) return send(res, 200, []);
    return send(res, 200, unitIds().filter(id => !accountBindingError('user',id) && scope.unitIds.has(id)).map(id => ({ id, label: nodes.find(n => n.unitId === id && activeAccountEntity(n))?.label || null })));
  }

  // طلب حساب جديد: يُنشأ بحالة pending ولا يقدر يدخل لين يوافق المسؤول
  if (path === '/api/register' && method === 'POST') {
    const ip = req.socket.remoteAddress, now = Date.now();
    const recent = (registrations.get(ip) || []).filter(t => now - t < 3600000);
    if (recent.length >= REGISTER_MAX_PER_HOUR) return send(res, 429, { error: 'too_many_attempts' });
    const b = await readBody(req);
    if (!validFullName(b.fullName) || !RANKS.includes(b.rank) || !validServiceId(b.serviceId) || !validPhone(b.phone) || !validName(b.username) || !validPassword(b.password)) return send(res, 400, { error: 'invalid_registration' });
    // رمز الوحدة (مثل AZM-B-0001-U-001) أو معرّفها (UNIT-05)؛ المحاولة الخاطئة تُحسب ضمن حد الساعة حتى لا تُخمَّن الرموز
    const code = typeof b.unitId === 'string' ? b.unitId.trim().toUpperCase() : '';
    const unitNode = code && layoutNodes().find(n => n.type === 'unit' && activeAccountEntity(n) && (n.unitId === code || String(n.code || '').toUpperCase() === code));
    if (!unitNode || accountBindingError('user', unitNode.unitId)) { registrations.set(ip, [...recent, now]); return send(res, 400, { error: 'invalid_unit_code' }); }
    b.unitId = unitNode.unitId;
    if (findUser(b.username)) return send(res, 409, { error: 'user_exists' });
    if (users.some(u => u.serviceId === b.serviceId && u.status !== 'rejected')) return send(res, 409, { error: 'service_id_exists' });
    users.push({
      username: b.username, role: 'user', unitId: b.unitId, baseId: accountBaseId({role:'user',unitId:b.unitId}), status: 'pending',
      fullName: b.fullName.trim(), rank: b.rank, serviceId: b.serviceId, phone: b.phone || null, position: cleanText(b.position, 60) || null,
      note: cleanText(b.note, 500) || null, createdAt: now, password: hashPassword(b.password),
    });
    auditContext.run({ by: b.username, role: 'applicant', reference: 'register' }, saveUsers); registrations.set(ip, [...recent, now]);
    return send(res, 200, { ok: true });
  }
  return false;
}

export async function handleMe({ res, path, method, me }) {
  if (path === '/api/me' && method === 'GET') return send(res, 200, publicUser(me));
  return false;
}
