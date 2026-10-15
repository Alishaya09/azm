// الحسابات: تُحفظ في data/users.json، وكلمات المرور مشفّرة بـ scrypt مع salt عشوائي لكل حساب.
// حالة الحساب: active (نشط) · pending (طلب تسجيل بانتظار المسؤول) · suspended (موقوف) · rejected (مرفوض)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DATA_DIR, FIRST_ADMIN_PASSWORD } from '../config.mjs';
import { readJson, writeJson } from '../lib/storage.mjs';
import { hashPassword, checkPassword } from '../lib/password.mjs';
import { appendAudit, auditContext } from './audit.mjs';
import { state, saveState } from './db.mjs';
import { accountOperational, accountBaseId } from './account-scope.mjs';
export { hashPassword, checkPassword };

const usersFile = join(DATA_DIR, 'users.json');
// اللي يرجع لصاحب الحساب نفسه (/api/me وتسجيل الدخول)
// role: admin (القائد) | base_manager (مسؤول قاعدة، baseId) | user (مسؤول وحدة، unitId)
export const publicUser = u => ({ username: u.username, role: u.role, unitId: u.unitId, baseId: accountBaseId(u), fullName: u.fullName || null, rank: u.rank || null });
// اللي يشوفه المسؤول في إدارة المستخدمين — كل شي ما عدا كلمة المرور
export const adminUser = u => { const { password, ...rest } = u; return { ...rest, baseId: accountBaseId(u), assignmentValid: accountOperational(u) }; };
// حقول الملف الشخصي اللي يقدر المسؤول يعدّلها
export const PROFILE_FIELDS = ['fullName', 'rank', 'serviceId', 'position', 'phone'];

mkdirSync(DATA_DIR, { recursive: true });
// المصفوفة نفسها تُعدَّل في مكانها (push/splice) فكل الوحدات تشوف نفس القائمة
export const users = readJson(usersFile, null) || (() => {
  // أول تشغيل: ننشئ حساب مسؤول وحساب مستخدم تجريبي بكلمات مرور عشوائية
  const adminPass = FIRST_ADMIN_PASSWORD || randomBytes(6).toString('base64url');
  const userPass = randomBytes(6).toString('base64url');
  const now = Date.now();
  const list = [
    { username: 'admin', role: 'admin', unitId: null, status: 'active', fullName: 'System Administrator', rank: 'colonel', position: 'Logistics Commander', createdAt: now, password: hashPassword(adminPass) },
    { username: 'user01', role: 'user', unitId: 'UNIT-01', status: 'active', fullName: 'Unit 01 Officer', rank: 'captain', position: 'Unit Logistics Officer', createdAt: now, password: hashPassword(userPass) },
  ];
  writeJson(usersFile, list);
  const note = `AZM first-run accounts (change or delete this file after reading):\n  admin  / ${adminPass}\n  user01 / ${userPass}   (UNIT-01)\n\nTip: run "npm run setup" (before the first start) to choose your own admin account instead.\n`;
  writeFileSync(join(DATA_DIR, 'FIRST_RUN_CREDENTIALS.txt'), note);
  console.log(`\n${note}`);
  return list;
})();
// الحسابات القديمة (قبل حالة الحساب) تعتبر نشطة
for (const u of users) u.status ||= 'active';

const auditUsersView = () => users.map(u => ({ username: u.username, role: u.role, status: u.status, unitId: u.unitId || null, baseId: u.baseId || null, fullName: u.fullName || null, rank: u.rank || null, lastLoginAt: u.lastLoginAt || null }));
let previousAuditUsers = auditUsersView();
export const saveUsers = () => {
  writeJson(usersFile, users);
  const next = auditUsersView();
  const changed = [...new Set([...previousAuditUsers, ...next].map(u => u.username))].filter(id => JSON.stringify(previousAuditUsers.find(u => u.username === id)) !== JSON.stringify(next.find(u => u.username === id)));
  if (changed.length) for (const id of changed) appendAudit(state, 'users', id, {}, { before: previousAuditUsers.find(u => u.username === id) || null, after: next.find(u => u.username === id) || null });
  else appendAudit(state, 'users', auditContext.getStore()?.reference || 'users');
  previousAuditUsers = next;
  saveState();
};
export const findUser = username => users.find(u => u.username === username);
export const removeUser = u => { const i = users.indexOf(u); if (i >= 0) users.splice(i, 1); saveUsers(); };
export const pendingCount = () => users.filter(u => u.status === 'pending').length;
