// أسئلة رصيد صنف عند مسؤول الوحدة («كم الديزل عندنا؟»، «كم الموية؟») يجاوبها الخادم مباشرة من لقطة وحدته نفسها،
// لأن النموذج الصغير قد يرفضها خطأً بجملة «خارج نطاق صلاحياتك» وهي ضمن نطاقه. نفس فكرة direct.mjs و identity.mjs:
// الأرقام من البيانات حرفياً، وأي سؤال أعقد (كفاية، استهلاك، توقع، طلبات، رقم في السؤال) يمر للنموذج كالعادة.
import { trainingCatalog, catalog } from '../store/catalog.mjs';
import { buildIndex, mentions, normText } from './request-evidence.mjs';

const ASK = /(^|\s)(كم|قد ايش|قديش|وش|ايش|اش|شكثر)(\s|$)|كم باقي|how much|how many/;
const SKIP = /\d|يكفي|يكفينا|تكفي|نحتاج|احتاج|محتاج|استهلاك|يستهلك|معدل|متى|ليش|لماذا|كيف|توقع|خلال|طلب|شحن|الطريق|قافل|قاعد[هت]|مركز|enough|need|consum|rate|when|why|how long|order|request|base|convoy/;

const fmt = n => Math.round(n).toLocaleString('en-US');
function status(pct, L) {
  if (pct <= 0) return L ? 'out of stock' : 'نافد';
  if (pct < 25) return L ? 'critical' : 'حرج';
  if (pct < 45) return L ? 'below reorder point' : 'تحت نقطة الطلب';
  return L ? 'available' : 'متوفر';
}

export function stockReply(chat, me, context) {
  if (me?.role !== 'user') return null;
  const text = [...(chat.messages || [])].reverse().find(m => m.role === 'user')?.text || '';
  const q = normText(text), L = /[؀-ۿ]/.test(text) ? 0 : 1;
  // مسؤول الوحدة نطاقه وحدته فقط، فـ«كم الديزل؟» و«كم الديزل عندنا؟» نفس السؤال
  if (!ASK.test(q) || SKIP.test(q)) return null;
  const unit = context?.units?.[0];
  if (!unit || context.units.length !== 1) return null;
  // أسماء الأصناف: أسماء الكتالوج التدريبي وأسماؤه العامية + الأسماء كما يعدّلها القائد + أصناف القائد الجديدة
  const live = new Map(catalog().map(c => [c.key, c]));
  const rows = [...trainingCatalog().map(r => ({ ...r, aliases: { ar: [...(r.aliases?.ar || []), live.get(r.key)?.name?.ar].filter(Boolean), en: [...(r.aliases?.en || []), live.get(r.key)?.name?.en].filter(Boolean) } })),
    ...catalog().filter(c => !trainingCatalog().some(r => r.key === c.key)).map(c => ({ key: c.key, item: c.name?.en, nameAr: c.name?.ar, aliases: {} }))];
  const keys = [...new Set(mentions(text, buildIndex(rows)).map(m => m.key))];
  if (!keys.length) return null;
  const lines = keys.map(k => {
    const c = live.get(k), name = c?.name?.[L ? 'en' : 'ar'] || c?.name?.en || k, u = c?.unit?.[L ? 'en' : 'ar'] || '';
    if (!(k in (unit.stockQty || {}))) return L ? `- ${name}: not one of your unit's resources.` : `- ${name}: ليس من موارد وحدتك.`;
    const qty = unit.stockQty[k] || 0, cap = unit.capacity?.[k] || 0, pct = unit.stockPercent?.[k] ?? (cap ? 100 * qty / cap : 0), way = unit.inTransit?.[k] || 0;
    const base = L ? `- ${name}: ${fmt(qty)} ${u} of ${fmt(cap)} ${u} (${Math.round(pct)}%, ${status(pct, 1)})` : `- ${name}: ${fmt(qty)} ${u} من ${fmt(cap)} ${u} (${Math.round(pct)}%، ${status(pct, 0)})`;
    return way > 0 ? base + (L ? `, ${fmt(way)} ${u} on the way` : `، وفي الطريق ${fmt(way)} ${u}`) : base;
  });
  return (L ? `${unit.name}:\n` : `${unit.name}:\n`) + lines.join('\n');
}
