// تحقق آلي من أرقام رد النموذج: كل رقم في الرد لازم يكون موجوداً في البيانات اللي وصلت للنموذج (اللقطة، نتائج الأدوات، الحقائق).
// النموذج الصغير قد يخترع رقماً أو يجاري المستخدم في رقم خاطئ؛ هنا نكشف ذلك بالكود بدل الاعتماد على البرومبت.
// الرقم يُعد موجوداً إذا ساوى رقماً في البيانات بعد تقريبه لنفس عدد المنازل العشرية (46.7234 في البيانات يقبل 46.72 و47).
const DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '٬': ',', '٫': '.' };
const toLatin = s => String(s ?? '').replace(/[٠-٩٬٫]/g, c => DIGITS[c]);
// ما ليس كمية: التواريخ والأوقات ومعرّفات الطلبات والجهات
const NOT_QUANTITY = /\b\d{4}-\d{1,2}-\d{1,2}(?:[T ][\d:.]+Z?)?\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{1,2}:\d{2}(?::\d{2})?\b|\b[A-Za-z]+-\d+\b/g;
const WITH_THOUSANDS = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
const PLAIN = /\d+(?:\.\d+)?/g;
const decimals = n => (n.split('.')[1] || '').length;

export function evidenceNumbers(...sources) {
  const values = new Set();
  for (const source of sources) {
    const text = toLatin(source);
    for (const re of [WITH_THOUSANDS, PLAIN]) for (const m of text.matchAll(re)) values.add(Number(m[0].replace(/,/g, '')));
  }
  return [...values].filter(Number.isFinite);
}

// يرجع الأرقام اللي في الرد وما لها أصل في البيانات. الأعداد الصحيحة من 0 إلى 20 تُتجاوز (عدّ وترقيم).
export function unverifiedNumbers(answer, sources) {
  const have = Array.isArray(sources) ? evidenceNumbers(...sources) : evidenceNumbers(sources);
  const out = [];
  for (const m of toLatin(answer).replace(NOT_QUANTITY, ' ').matchAll(WITH_THOUSANDS)) {
    const raw = m[0].replace(/,/g, ''), value = Number(raw), k = decimals(raw);
    if (!Number.isFinite(value) || (k === 0 && value <= 20)) continue;
    const f = 10 ** k;
    if (!have.some(d => Math.round(d * f) / f === value) && !out.includes(m[0])) out.push(m[0]);
  }
  return out;
}

export const numberNote = (list, arabic) => arabic
  ? `\n\nتنبيه آلي: ${list.length > 1 ? 'الأرقام' : 'الرقم'} ${list.join('، ')} ${list.length > 1 ? 'غير موجودة' : 'غير موجود'} في بيانات النظام؛ راجعه قبل الاعتماد عليه.`
  : `\n\nAutomatic check: ${list.join(', ')} ${list.length > 1 ? 'are' : 'is'} not in the system data; verify before relying on it.`;
