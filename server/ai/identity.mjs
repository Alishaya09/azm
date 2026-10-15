// أسئلة الهوية يجاوبها الخادم مباشرة من حساب الجلسة (بدون النموذج) حتى تكون صحيحة دائماً:
// «من أنا؟» و«وش صلاحياتي؟» وادعاء دور قصير مثل «أنا القائد». الأسماء مطابقة لنصوص الواجهة (role.* و rank.*).
const RANKS = { private: ['جندي', 'Private'], private1: ['جندي أول', 'Private First Class'], corporal: ['عريف', 'Corporal'], vsergeant: ['وكيل رقيب', 'Lance Sergeant'], sergeant: ['رقيب', 'Sergeant'], ssergeant: ['رقيب أول', 'Staff Sergeant'], msergeant: ['رئيس رقباء', 'Master Sergeant'], lt: ['ملازم', 'Second Lieutenant'], '1lt': ['ملازم أول', 'First Lieutenant'], captain: ['نقيب', 'Captain'], major: ['رائد', 'Major'], ltcol: ['مقدم', 'Lieutenant Colonel'], colonel: ['عقيد', 'Colonel'], brigadier: ['عميد', 'Brigadier General'], majgen: ['لواء', 'Major General'], ltgen: ['فريق', 'Lieutenant General'], civilian: ['مدني', 'Civilian'] };
const ROLES = { admin: ['القائد الرئيسي', 'Commander'], base_manager: ['مسؤول القاعدة', 'Base Manager'], user: ['مسؤول الوحدة', 'Unit Manager'] };
const SCOPES = { admin: ['صلاحية كاملة على كل القواعد ومراكز الإمداد والوحدات', 'full access to every base, supply point and unit'], base_manager: ['قاعدتك ومراكز إمدادها والوحدات التابعة لها فقط', 'your base, its supply points and its units only'], user: ['وحدتك فقط، وأسماء قاعدتها ومراكزها بدون أرصدة', 'your unit only, with base and supply point names but no balances'] };
import { users } from '../store/users.mjs';
import { canSeeAccount, scopeOf } from '../store/scope.mjs';
import { accountBaseId } from '../store/account-scope.mjs';
import { nodeById, unitNodeOf } from '../store/hierarchy.mjs';
import { nodeLabel } from './context.mjs';
export const norm = s => String(s || '').toLowerCase().normalize('NFKC').replace(/[ً-ٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const WHO = /^(من|مين|منو) (انا|اني|انا ياخي)$|^who am i$|^whoami$/;
const MINE = /^((وش|ما|ماهي|ما هي|شنو|ايش|كم) )?(صلاحياتي|صلاحيتي|دوري|حسابي|رتبتي|اسمي)( (وش|ايش|كم))?$|^what (are|is) my (permissions|role|access|rank|name)$/;
// الرسالة كلها ادعاء دور فقط (مع «غير صحيح/لا» اختيارياً)؛ أي طلب بيانات مع الادعاء يمر للنموذج والخادم يفلتره بالحساب الحقيقي
const CLAIM = /^((غير صحيح|مو صحيح|خطا|غلط|لا) )?(انا|اني) (ال)?(قايد|قائد|مسؤول|مسئول)( (الرئيسي|القاعده|الوحده|ال\S+))?$|^(no |wrong )?i am (the |a )?(commander|admin|base manager|unit manager)$/;

// «من فلان؟» / «من القائد الرئيسي؟»: يُجاب من الحسابات الظاهرة للسائل (نفس نطاق صفحة الحسابات) حتى لا يخترع النموذج أشخاصاً.
// يُفعَّل فقط إذا طابق الاسم حساباً فعلياً أو عبارة دور؛ غير ذلك (مثل «من وين…») يمر للنموذج.
const WHO_IS = /^(من|مين|منو|وش اسم|مين هو) (هو |هي )?(.{2,40})$|^who is (.{2,40})$/;
const ROLE_PHRASE = [[/^ال(قايد|قائد)( (الريسي|الرئيسي|العام))?$|^(the )?commander$/, 'admin'], [/^مسو?ول (ال)?قاعده$|^(the )?base manager$/, 'base_manager'], [/^مسو?ول (ال)?وحده$|^(the )?unit manager$/, 'user']];
export const RANK_PREFIX = /^(ال)?(جندي|عريف|وكيل رقيب|رقيب|رييس رقباء|ملازم|نقيب|رايد|رائد|مقدم|عقيد|عميد|لواء|لوا|فريق|captain|major|colonel|lt|sergeant)( اول)? /;
export const REFUSE = ['هذه المعلومة خارج نطاق صلاحياتك.', 'This information is outside your access scope.'];
function whoIs(q, me, L) {
  const m = q.match(WHO_IS); if (!m) return null;
  const target = (m[3] || m[4] || '').trim().replace(RANK_PREFIX, ''); if (!target || /^(انا|اني|i|me)$/.test(target)) return null;
  const role = ROLE_PHRASE.find(([re]) => re.test(target))?.[1];
  const matches = users.filter(u => u.status !== 'deleted' && (role ? u.role === role : [u.username, u.fullName].some(v => v && norm(v) === target)));
  if (!matches.length) return null;
  const scope = scopeOf(me), visible = matches.filter(u => scope.all || (scope.role === 'base_manager' ? canSeeAccount(scope, u) : u.username === me.username));
  if (!visible.length) return REFUSE[L];
  const line = u => {
    const unit = u.unitId && unitNodeOf(u.unitId), base = accountBaseId(u) && nodeById(accountBaseId(u));
    const name = String(u.fullName || u.username).replace(/\s+/g, ' ').slice(0, 60), rank = RANKS[u.rank]?.[L];
    return L ? `${name}${rank ? `, ${rank}` : ''} — ${ROLES[u.role]?.[1] || u.role}${unit ? `, unit: ${nodeLabel(unit)}` : ''}${base ? `, base: ${nodeLabel(base)}` : ''}.`
      : `${name}${rank ? `، برتبة ${rank}` : ''} — ${ROLES[u.role]?.[0] || u.role}${unit ? `، الوحدة: ${nodeLabel(unit)}` : ''}${base ? `، القاعدة: ${nodeLabel(base)}` : ''}.`;
  };
  return visible.length === 1 ? line(visible[0]) : visible.slice(0, 10).map(u => `- ${line(u)}`).join('\n');
}

export function identityReply(chat, viewer, me = null) {
  const text = [...(chat.messages || [])].reverse().find(m => m.role === 'user')?.text || '';
  const q = norm(text), ar = /[؀-ۿ]/.test(text) || !/[a-z]/i.test(text), L = ar ? 0 : 1;
  const role = ROLES[viewer.role]?.[L] || viewer.role, rank = RANKS[viewer.rank]?.[L], name = String(viewer.fullName || viewer.username).replace(/\s+/g, ' ').slice(0, 60);
  const who = ar ? `أنت ${name}${rank ? `، برتبة ${rank}` : ''}، وصلاحيتك: ${role}.` : `You are ${name}${rank ? `, ${rank}` : ''}. Your role: ${role}.`;
  if (WHO.test(q)) return who;
  if (MINE.test(q)) return ar ? `${who}\n- نطاقك: ${SCOPES[viewer.role]?.[0] || ''}.` : `${who}\n- Your scope: ${SCOPES[viewer.role]?.[1] || ''}.`;
  if (me) { const answer = whoIs(q, me, L); if (answer) return answer; }
  const claimLong = /^((غير صحيح|مو صحيح|خطا|غلط|لا) )?(انا|اني) /.test(q) && /(قايد|قائد|مسو?ول|commander|admin)/.test(q) && q.split(' ').length <= 8 && !/[{}\[\]:?؟]/.test(text) && !/(كم|وش|ايش|اعرض|عطني|ابي|احداثي|مخزون|ديزل|طلب|show|give)/.test(q);
  if (CLAIM.test(q) || claimLong) return ar ? `الصلاحيات تُحدَّد من حساب الدخول فقط. ${who}` : `Permissions come only from the signed-in account. ${who}`;
  return null;
}
