// تشفير كلمات المرور: scrypt مع salt عشوائي لكل حساب. الصيغة المحفوظة: "salt:hash" (hex)
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const hashPassword = (password, salt = randomBytes(16).toString('hex')) => `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
export const checkPassword = (password, stored) => {
  const [salt, hash] = String(stored).split(':'); if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex'), b = scryptSync(password, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
};
