// إدارة المستخدمين — القائد الرئيسي: إنشاء، تعديل الملف، الأدوار وربط الحساب بقاعدته أو وحدته،
// الموافقة على طلبات التسجيل أو رفضها، الإيقاف والتفعيل، الحذف.
// مسؤول القاعدة: يرى حسابات قاعدته، ويوافق/يرفض طلبات الانضمام لوحداتها ويوقف/يفعّل مسؤولي وحداتها فقط (scope.mjs).
import { RANKS, ROLES } from '../config.mjs';
import { cleanText, readBody, send, validName, validPassword } from '../lib/http.mjs';
import { adminUser, findUser, hashPassword, removeUser, saveUsers, users } from '../store/users.mjs';
import { dropSessionsOf } from '../store/sessions.mjs';
import { accountBindingError, accountBaseId } from '../store/account-scope.mjs';
import { canManageAccount, canSeeAccount } from '../store/scope.mjs';
import { validFullName, validPhone, validServiceId } from './auth.mjs';

// يتحقق من حقول الملف الشخصي اللي انرسلت فقط (الحقول الغائبة ما تتغيّر)
const profileError = b =>
  (b.fullName !== undefined && !validFullName(b.fullName)) || (b.rank !== undefined && b.rank !== null && !RANKS.includes(b.rank)) ||
  (b.serviceId !== undefined && b.serviceId !== null && b.serviceId !== '' && !validServiceId(b.serviceId)) || (b.phone !== undefined && !validPhone(b.phone));
const applyProfile = (u, b) => {
  if (b.fullName !== undefined) u.fullName = b.fullName.trim();
  if (b.rank !== undefined) u.rank = b.rank || null;
  if (b.serviceId !== undefined) u.serviceId = b.serviceId || null;
  if (b.phone !== undefined) u.phone = b.phone || null;
  if (b.position !== undefined) u.position = cleanText(b.position, 60) || null;
};
// الدور والجهة المرتبطة: مسؤول الوحدة (user) بوحدة موجودة، ومسؤول القاعدة (base_manager) بقاعدة موجودة
const roleError = accountBindingError;
const assignRole = (u, role, unitId, baseId) => { u.role = role; u.unitId = role === 'user' ? unitId : null; if (role === 'admin') delete u.baseId; else u.baseId = accountBaseId({role,unitId,baseId}); };

export async function handleUsers({ req, res, path, method, me, isAdmin, scope, forbidden }) {
  if (!path.startsWith('/api/users')) return false;
  if (!isAdmin && scope.role !== 'base_manager') return forbidden();
  if (!isAdmin) return handleBaseManagerUsers({ req, res, path, method, me, scope, forbidden });

  if (path === '/api/users' && method === 'GET') return send(res, 200, users.map(adminUser));
  if (path === '/api/users' && method === 'POST') {
    const b = await readBody(req);
    if (!validName(b.username) || !validPassword(b.password) || !ROLES.includes(b.role)) return send(res, 400, { error: 'invalid_user' });
    const roleErr = roleError(b.role, b.unitId, b.baseId); if (roleErr) return send(res, 400, { error: roleErr });
    if (profileError(b)) return send(res, 400, { error: 'invalid_profile' });
    if (findUser(b.username)) return send(res, 409, { error: 'user_exists' });
    if (b.serviceId && users.some(u => u.serviceId === b.serviceId && u.status !== 'rejected')) return send(res, 409, { error: 'service_id_exists' });
    const u = { username: b.username, role: b.role, unitId: b.role === 'user' ? b.unitId : null, ...(b.role === 'base_manager' ? { baseId: b.baseId } : {}), status: 'active', createdAt: Date.now(), approvedBy: me.username, approvedAt: Date.now(), password: hashPassword(b.password) };
    assignRole(u, b.role, b.unitId, b.baseId);
    applyProfile(u, b);
    users.push(u); saveUsers(); return send(res, 200, adminUser(u));
  }

  const m = path.match(/^\/api\/users\/([A-Za-z0-9_.-]+)(?:\/(approve|reject|suspend|activate))?$/);
  if (!m) return false;
  const u = findUser(m[1]); if (!u) return send(res, 404, { error: 'not_found' });
  const action = m[2], self = u.username === me.username;

  if (action && method === 'POST') {
    const b = await readBody(req);
    if (self) return send(res, 400, { error: 'cannot_change_self' });
    if (action === 'approve') {
      if (u.status !== 'pending' && u.status !== 'rejected') return send(res, 400, { error: 'bad_request' });
      const role = b.role || u.role, unitId = b.unitId !== undefined ? b.unitId : u.unitId, baseId = b.baseId !== undefined ? b.baseId : u.baseId, err = roleError(role, unitId, baseId);
      if (err) return send(res, 400, { error: err });
      assignRole(u, role, unitId, baseId);
      Object.assign(u, { status: 'active', approvedBy: me.username, approvedAt: Date.now(), rejectReason: undefined });
    } else if (action === 'reject') {
      if (u.status !== 'pending') return send(res, 400, { error: 'bad_request' });
      Object.assign(u, { status: 'rejected', rejectReason: cleanText(b.reason, 300) || null, reviewedBy: me.username, reviewedAt: Date.now() });
    } else if (action === 'suspend') {
      if (u.status !== 'active') return send(res, 400, { error: 'bad_request' });
      Object.assign(u, { status: 'suspended', suspendedBy: me.username, suspendedAt: Date.now() }); dropSessionsOf(u.username);
    } else {
      if (u.status !== 'suspended') return send(res, 400, { error: 'bad_request' });
      const err = roleError(u.role, u.unitId, u.baseId); if (err) return send(res, 400, { error: err });
      Object.assign(u, { status: 'active', suspendedBy: undefined, suspendedAt: undefined });
    }
    saveUsers(); return send(res, 200, adminUser(u));
  }

  if (!action && method === 'DELETE') {
    if (self) return send(res, 400, { error: 'cannot_delete_self' });
    removeUser(u); dropSessionsOf(u.username);
    return send(res, 200, { ok: true });
  }

  // تعديل: كلمة المرور و/أو الملف الشخصي و/أو الدور والوحدة
  if (!action && method === 'PUT') {
    const b = await readBody(req);
    if (b.password !== undefined && !validPassword(b.password)) return send(res, 400, { error: 'invalid_password' });
    if (profileError(b)) return send(res, 400, { error: 'invalid_profile' });
    {
      const role = b.role ?? u.role, unitId = b.unitId !== undefined ? b.unitId : u.unitId, baseId = b.baseId !== undefined ? b.baseId : u.baseId, err = roleError(role, unitId, baseId);
      if (err) return send(res, 400, { error: err });
      if (self && role !== 'admin') return send(res, 400, { error: 'cannot_change_self' });
      if (b.serviceId && users.some(x => x !== u && x.serviceId === b.serviceId && x.status !== 'rejected')) return send(res, 409, { error: 'service_id_exists' });
      assignRole(u, role, unitId, baseId);
    }
    applyProfile(u, b);
    if (b.password !== undefined) {
      u.password = hashPassword(b.password);
      // تغيير كلمة مرور مستخدم آخر ينهي جلساته؛ المسؤول اللي غيّر كلمته يبقى داخل
      if (!self) dropSessionsOf(u.username);
    }
    saveUsers(); return send(res, 200, { ok: true, user: adminUser(u) });
  }
  return false;
}

// مسؤول القاعدة: قراءة حسابات قاعدته، وإدارة مسؤولي وحداتها فقط. الدور يبقى «مسؤول وحدة» والوحدة داخل قاعدته؛
// لا إنشاء ولا تعديل ملف أو كلمة مرور ولا حذف، ولا يمس حسابه أو حساب مسؤول قاعدة أو القائد.
async function handleBaseManagerUsers({ req, res, path, method, me, scope, forbidden }) {
  if (path === '/api/users' && method === 'GET') return send(res, 200, users.filter(u => canSeeAccount(scope, u)).map(adminUser));
  const m = path.match(/^\/api\/users\/([A-Za-z0-9_.-]+)\/(approve|reject|suspend|activate)$/);
  if (!m || method !== 'POST') return forbidden();
  const u = findUser(m[1]);
  // حساب خارج قاعدته يُعامل كغير موجود حتى لا يُكشف وجوده
  if (!u || !canSeeAccount(scope, u)) return send(res, 404, { error: 'not_found' });
  if (u.username === me.username) return send(res, 400, { error: 'cannot_change_self' });
  if (!canManageAccount(scope, u)) return forbidden();
  const b = await readBody(req), action = m[2];
  if (action === 'approve') {
    if (u.status !== 'pending' && u.status !== 'rejected') return send(res, 400, { error: 'bad_request' });
    if ((b.role !== undefined && b.role !== 'user') || (b.baseId !== undefined && b.baseId !== null)) return forbidden();
    const unitId = b.unitId !== undefined ? b.unitId : u.unitId;
    if (!scope.unitIds.has(unitId)) return forbidden();
    const err = accountBindingError('user', unitId, null); if (err) return send(res, 400, { error: err });
    assignRole(u, 'user', unitId, null);
    Object.assign(u, { status: 'active', approvedBy: me.username, approvedAt: Date.now(), rejectReason: undefined });
  } else if (action === 'reject') {
    if (u.status !== 'pending') return send(res, 400, { error: 'bad_request' });
    Object.assign(u, { status: 'rejected', rejectReason: cleanText(b.reason, 300) || null, reviewedBy: me.username, reviewedAt: Date.now() });
  } else if (action === 'suspend') {
    if (u.status !== 'active') return send(res, 400, { error: 'bad_request' });
    Object.assign(u, { status: 'suspended', suspendedBy: me.username, suspendedAt: Date.now() }); dropSessionsOf(u.username);
  } else {
    if (u.status !== 'suspended') return send(res, 400, { error: 'bad_request' });
    const err = roleError(u.role, u.unitId, u.baseId); if (err) return send(res, 400, { error: err });
    Object.assign(u, { status: 'active', suspendedBy: undefined, suspendedAt: undefined });
  }
  saveUsers(); return send(res, 200, adminUser(u));
}
