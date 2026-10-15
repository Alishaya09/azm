// ربط الحساب بجهة حية فقط؛ الاسم المعروض لا يدخل في تحديد الصلاحيات.
import { nodeById, unitNodeOf } from './hierarchy.mjs';

export const activeAccountEntity = n => !!n && !n.archived && !n.deletedAt && (!n.status || n.status === 'active');
export function accountBindingError(role, unitId, baseId, { saved = false } = {}) {
  if (role === 'admin') return null;
  if (role === 'base_manager') {
    const b = nodeById(baseId);
    return b?.type === 'main' && activeAccountEntity(b) ? null : 'invalid_base';
  }
  if (role !== 'user') return 'invalid_user';
  const u = unitNodeOf(unitId), b = u && nodeById(u.baseId);
  if (!activeAccountEntity(u) || b?.type !== 'main' || !activeAccountEntity(b)) return 'invalid_unit';
  // الحسابات القديمة بلا baseId تُقرأ من تبعية الوحدة؛ الربط المحفوظ المخالف يفشل مغلقاً.
  if (saved && baseId != null && baseId !== u.baseId) return 'invalid_base';
  return null;
}
export const accountOperational = u => !!u && !accountBindingError(u.role, u.unitId, u.baseId, { saved: true });
export const accountBaseId = u => u.role === 'user' ? unitNodeOf(u.unitId)?.baseId || u.baseId || null : u.role === 'base_manager' ? u.baseId || null : null;
