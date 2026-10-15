// الجلسات في الذاكرة (تنمسح عند إعادة تشغيل الخادم) + حماية تسجيل الدخول من التخمين.
import { randomBytes } from 'node:crypto';
import { LOGIN_LOCK_MS, LOGIN_MAX_FAILS, SESSION_COOKIE, SESSION_MAX_AGE_S } from '../config.mjs';
import { findUser } from './users.mjs';
import { accountOperational } from './account-scope.mjs';

const sessions = new Map(); // token -> { username, cookieName, expiresAt }
const failedLogins = new Map(); // ip -> { count, until }

const getCookie = (req, name) => (req.headers.cookie || '').split(';').map(s => s.trim().split('=')).find(([k]) => k === name)?.[1];
// معرّف التبويب ليس رمز مصادقة؛ يختار كوكي HttpOnly فقط. المدخل غير الصالح لا يرجع للكوكي المشترك.
export const sessionCookieName = req => {
  const tab = req.headers['x-azm-tab'];
  if (tab === undefined) return SESSION_COOKIE; // توافق عملاء API السابقين
  return typeof tab === 'string' && /^[a-f0-9]{32}$/.test(tab) ? `${SESSION_COOKIE}_${tab}` : null;
};
const sessionToken = req => { const name = sessionCookieName(req); return name ? getCookie(req, name) : null; };
// الجلسة صالحة فقط إذا الحساب نشط، والرمز مربوط بالكوكي المختار ولم تنته مدته.
export const currentUser = req => {
  const token = sessionToken(req), session = sessions.get(token);
  if (!session || session.cookieName !== sessionCookieName(req)) return null;
  if (session.expiresAt <= Date.now()) { sessions.delete(token); return null; }
  const u = findUser(session.username);
  return u && u.status === 'active' && accountOperational(u) ? u : null;
};

export const createSession = (username, req) => {
  const cookieName = sessionCookieName(req);
  // الدخول مجدداً في التبويب نفسه يستبدل جلسته وحدها. عملاء الكوكي القديم يبقون متوافقين.
  if (req.headers['x-azm-tab'] !== undefined) sessions.delete(sessionToken(req));
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { username, cookieName, expiresAt: Date.now() + SESSION_MAX_AGE_S * 1000 });
  return `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE_S}${req.socket.encrypted ? '; Secure' : ''}`;
};
export const destroySession = req => { sessions.delete(sessionToken(req)); return `${sessionCookieName(req)}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${req.socket.encrypted ? '; Secure' : ''}`; };
// إنهاء كل جلسات مستخدم (عند حذفه، أو عند تغيير كلمة مروره من مسؤول آخر)
export const dropSessionsOf = username => { for (const [token, session] of sessions) if (session.username === username) sessions.delete(token); };

export const isLocked = ip => { const f = failedLogins.get(ip); return !!(f && f.count >= LOGIN_MAX_FAILS && f.until > Date.now()); };
export const recordFailure = ip => { const f = failedLogins.get(ip); const next = f && f.until > Date.now() ? f.count + 1 : 1; failedLogins.set(ip, { count: next, until: Date.now() + LOGIN_LOCK_MS }); };
export const clearFailures = ip => failedLogins.delete(ip);
