// أسئلة الإحداثيات يجاوبها الخادم مباشرة من الخريطة (بدون النموذج) حتى لا تُخترع أو تُخلط الأرقام.
// النطاق نفس ما يظهر للسائل على الخريطة (scope.nodeIds)، والأشخاص بنفس نطاق صفحة الحسابات.
// يُفعَّل فقط إذا السؤال عن موقع/إحداثيات وتعرّفنا على المقصود؛ غير ذلك يمر للنموذج.
import { users } from '../store/users.mjs';
import { canSeeAccount, scopeOf } from '../store/scope.mjs';
import { layoutNodes, unitNodeOf } from '../store/hierarchy.mjs';
import { activeAccountEntity, accountBaseId } from '../store/account-scope.mjs';
import { nodeLabel } from './context.mjs';
import { norm, RANK_PREFIX, REFUSE } from './identity.mjs';

const WHERE = /(احد?اثي|احاثي|احداثيات|موقع|مكان|وين|وسن|فين|coordinat|location|where)/;
const GROUPS = [[/(جميع|كل|كافه)? ?(ال)?وحدات|all units/, ['unit']], [/(جميع|كل|كافه)? ?(ال)?قواعد|all bases/, ['hq', 'main']],
  [/مراكز (ال)?امداد|نقاط (ال)?امداد|supply points/, ['fsb']], [/(كل|جميع) (ال)?(جهات|مواقع|نقاط)|everything|all locations/, ['hq', 'main', 'fsb', 'unit']]];
// يتحمل الأخطاء الإملائية الشائعة: الرئيسيه، الرييسيه، الريسيه، الرسيه
const MAIN_BASE = /(ال)?(قاعده|مركز) (ال)?ر[ئي]*سي|main base|headquarters/;
const compact = s => norm(s).replace(/ /g, '');
const fmt = (n, L) => L ? `- ${nodeLabel(n)}: latitude ${+n.pos[0].toFixed(4)}, longitude ${+n.pos[1].toFixed(4)}` : `- ${nodeLabel(n)}: خط العرض ${+n.pos[0].toFixed(4)}، خط الطول ${+n.pos[1].toFixed(4)}`;
const ORDER = { hq: 0, main: 1, fsb: 2, unit: 3 };

export function locationReply(chat, me) {
  const text = [...(chat.messages || [])].reverse().find(m => m.role === 'user')?.text || '';
  const q = norm(text), L = /[؀-ۿ]/.test(text) || !/[a-z]/i.test(text) ? 0 : 1;
  if (!WHERE.test(q) || /^من وين|تتمون|يتمون/.test(q)) return null;
  const scope = scopeOf(me), all = layoutNodes().filter(activeAccountEntity).filter(n => Array.isArray(n.pos));
  const visible = all.filter(n => scope.nodeIds.has(n.id));
  const list = nodes => nodes.length ? [...nodes].sort((a, b) => ORDER[a.type] - ORDER[b.type]).slice(0, 40).map(n => fmt(n, L)).join('\n') : (L ? 'No places in your scope.' : 'لا توجد مواقع ضمن نطاقك.');
  // 1) مجموعة: كل الوحدات / كل القواعد / مراكز الإمداد
  const group = GROUPS.find(([re]) => re.test(q));
  if (group) return list(visible.filter(n => group[1].includes(n.type)));
  // 2) القاعدة الرئيسية أو جهة بالاسم (قبل الأشخاص، وبدون مسافات: «عبد العزيز» = «عبدالعزيز»)
  if (MAIN_BASE.test(q)) { const hq = visible.filter(n => n.type === 'hq'); return hq.length ? list(hq) : REFUSE[L]; }
  const qc = compact(text);
  const named = all.filter(n => { const v = compact(nodeLabel(n)); return v.length >= 4 && qc.includes(v); });
  if (named.length) {
    const longest = Math.max(...named.map(n => compact(nodeLabel(n)).length)), best = named.filter(n => compact(nodeLabel(n)).length === longest);
    const ok = best.filter(n => scope.nodeIds.has(n.id));
    return ok.length ? list(ok) : REFUSE[L];
  }
  // 3) «احداثيات القاعده/قاعدتي» و«وحدتي» ← قاعدة السائل أو وحدته (للقائد: القاعدة الرئيسية). سؤال مركّب («...ووش أغراضها») يمر للنموذج
  if (!/ و ?(وش|ايش|كم|شنو|ما|ماهي|اغراض|موارد|مخزون|حاله|وضع)( |$)/.test(q)) {
    const myBase = /(^| )(ال)?قاعد(ه|تي|تنا)( |$)|\bmy base\b|\bour base\b/.test(q), myUnit = /(^| )(ال)?وحد(ه|تي|تنا)( |$)|\bmy unit\b|\bour unit\b/.test(q);
    const pick = myUnit && me.role === 'user' ? unitNodeOf(scope.unitId) : myBase ? (scope.all ? all.find(n => n.type === 'hq') : all.find(n => n.id === scope.baseId)) : null;
    if (pick) return Array.isArray(pick.pos) && scope.nodeIds.has(pick.id) ? list([pick]) : REFUSE[L];
  }
  // 4) شخص: اسم مستخدم أو اسمه الكامل (مع رتبة قبله أو بدونها) ← موقع وحدته، أو قاعدته، أو القاعدة الرئيسية للقائد
  const words = ` ${q.replace(RANK_PREFIX, '')} `;
  const person = users.find(u => u.status !== 'deleted' && [u.username, u.fullName].some(v => v && norm(v).length >= 2 && words.includes(` ${norm(v)} `)));
  if (person) {
    const seen = scope.all || (scope.role === 'base_manager' ? canSeeAccount(scope, person) : person.username === me.username);
    if (!seen) return REFUSE[L];
    const name = String(person.fullName || person.username).slice(0, 60);
    const unit = person.unitId && unitNodeOf(person.unitId), baseId = accountBaseId(person), base = baseId && all.find(n => n.id === baseId);
    const hq = person.role === 'admin' && all.find(n => n.type === 'hq');
    const [node, where] = unit ? [unit, ['في وحدته', 'is at their unit']] : base ? [base, ['في قاعدته', 'is at their base']] : hq ? [hq, ['في القاعدة الرئيسية', 'is at the main base']] : [];
    if (!node || !Array.isArray(node.pos) || !scope.nodeIds.has(node.id)) return L ? 'This person has no location in the current data.' : 'لا يوجد موقع لهذا الشخص في البيانات الحالية.';
    return L ? `${name} ${where[1]}:\n${fmt(node, 1)}` : `${name} ${where[0]}:\n${fmt(node, 0)}`;
  }
  return null;
}
