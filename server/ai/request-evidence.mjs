// ضوابط الدليل بعد نموذج الاستخراج (بدون إعادة تدريب): كل صنف وكمية وموعد أخرجه النموذج لازم يكون له دليل في نص المستخدم.
// ملف مستقل بدون أي import: يستخدمه request-contract.mjs، ويستخدمه scripts/eval-extraction.mjs --guards بدون فتح data/.
// القاعدة: لا نخترع قيمة أبداً. الشك يتحول إلى null، فيسأل الشات «كم تحتاج من …؟» (نفس مسار الكمية الناقصة الحالي).
// قيس أثرها بـ: node scripts/eval-extraction.mjs --guards

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export function normText(s) {
  return String(s || '')
    .replace(/[ً-ْـ]/g, '')          // تشكيل وتطويل
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[٠-٩]/g, d => String(AR_DIGITS.indexOf(d)))
    .toLowerCase();
}

export function buildIndex(catalog) {
  // [{key, names:[normalized alias]}]؛ الأسماء الأطول أولاً حتى «فلتر ديزل» تغلب «ديزل»
  const entries = [];
  for (const row of catalog) {
    const names = [row.item, row.nameAr, ...(row.aliases?.ar || []), ...(row.aliases?.en || [])]
      .filter(x => typeof x === 'string' && x.trim()).map(x => normText(x).trim()).filter(x => x.length >= 2);
    const variants = new Set(names);
    for (const n of names) {
      if (/^[a-z]/.test(n)) {                      // جمع إنجليزي: battery→batteries، kit→kits
        const words = n.split(' '), last = words.pop();
        const pl = last.endsWith('y') ? last.slice(0, -1) + 'ies' : /(s|x|ch|sh)$/.test(last) ? last + 'es' : last + 's';
        variants.add([...words, pl].join(' '));
      } else {                                      // مثنى عربي للكلمة الأولى: حقيبه عده→حقيبتين عده، فلتر زيت→فلترين زيت
        const [first, ...rest] = n.split(' ');
        const dual = first.endsWith('ه') ? first.slice(0, -1) + 'تين' : first + 'ين';
        variants.add([dual, ...rest].join(' '));
      }
    }
    for (const n of variants) entries.push({ key: row.key, name: n });
  }
  return entries.sort((a, b) => b.name.length - a.name.length);
}

// مواقع ذكر الأصناف في النص (بدون تداخل؛ الاسم الأطول يحجز موقعه)
export function mentions(text, index) {
  const t = normText(text), taken = new Array(t.length).fill(false), out = [];
  for (const { key, name } of index) {
    let from = 0, at;
    while ((at = t.indexOf(name, from)) >= 0) {
      from = at + 1;
      const end = at + name.length;
      // حدود الكلمة للإنجليزي فقط (العربي يقبل السوابق مثل «وال» و«بـ» واللواحق مثل الجمع)
      if (/^[a-z]/.test(name) && ((at > 0 && /[a-z]/.test(t[at - 1])) || (end < t.length && /[a-z]/.test(t[end]) && !/^(s|es)\b/.test(t.slice(end, end + 3))))) continue;
      if (taken.slice(at, end).some(Boolean)) continue;
      for (let i = at; i < end; i++) taken[i] = true;
      out.push({ key, start: at, end });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

const WORDS = { واحد: 1, اثنين: 2, ثلاث: 3, ثلاثه: 3, اربع: 4, اربعه: 4, خمس: 5, خمسه: 5, ست: 6, سته: 6, سبع: 7, سبعه: 7, ثمان: 8, ثمانيه: 8, ثماني: 8, تسع: 9, تسعه: 9, عشر: 10, عشره: 10,
  عشرين: 20, ثلاثين: 30, اربعين: 40, خمسين: 50, ستين: 60, سبعين: 70, ثمانين: 80, تسعين: 90, ميه: 100, مايه: 100, ميتين: 200, مئتين: 200, مايتين: 200,
  الف: 1000, الفين: 2000, الاف: 1000,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000, dozen: 12 };
function wordCount(text, value) {
  const t = normText(text); let c = 0;
  for (const [w, v] of Object.entries(WORDS)) if (v === value) c += (t.match(new RegExp(`(?:^|[^\\p{L}])و?${w}(?=$|[^\\p{L}])`, 'gu')) || []).length;
  return c;
}
const anyNumberWord = text => { const t = normText(text); return Object.keys(WORDS).some(w => new RegExp(`(?:^|[^\\p{L}])و?${w}(?=$|[^\\p{L}])`, 'u').test(t)); };
// كلمات الوحدات كما يكتبها المستخدم بعد الرقم («200 لتر»، «5 علب»)
const UNIT_WORDS = Object.entries({
  liter: 'لتر|ليتر|لترات|liters?|litres?|ltrs?|l', pallet: 'طبليه|طبليات|بالته|بالتات|pallets?', carton: 'كرتون|كراتين|كرتونه|cartons?',
  barrel: 'برميل|براميل|برميلين|barrels?', jerrycan: 'جالون|جالونات|جركن|جراكن|jerrycans?|gallons?', can: 'علبه|علب|علبتين|cans?|tins?',
  box: 'صندوق|صناديق|box|boxes', bag: 'كيس|اكياس|كيسين|شوال|شوالات|bags?|sacks?', kg: 'كيلو|كيلوات|كجم|كغ|kgs?|kilos?',
  piece: 'حبه|حبات|قطعه|قطع|pieces?|pcs?', pair: 'زوج|ازواج|جوز|pairs?', set: 'طقم|اطقم|sets?', kit: 'شنطه|شنط|kits?',
  roll: 'لفه|لفات|رول|rolls?|coils?', sheet: 'لوح|الواح|sheets?',
}).map(([unit, words]) => [unit, new RegExp(`^(?:${words})(?=$|[^\\p{L}])`, 'u')]);
const unitAfter = (t, n) => { const rest = t.slice(n.end).replace(/^[\s)\]]+/, ''); return UNIT_WORDS.find(([, re]) => re.test(rest))?.[0] || null; };
function numbers(text) {
  const t = normText(text), out = [];
  for (const m of t.matchAll(/\d{1,3}(?:,\d{3})+(?!\d)|\d+(?:[.,]\d+)?/g)) {
    // ترقيم القوائم («1)» «2.» «- 3)» في بداية السطر) ليس كمية
    const before = t.slice(t.lastIndexOf('\n', m.index - 1) + 1, m.index);
    if (/^[\s\-•*]*$/.test(before) && /^[).]/.test(t.slice(m.index + m[0].length))) continue;
    out.push({ value: /^\d{1,3}(,\d{3})+$/.test(m[0]) ? Number(m[0].replace(/,/g, '')) : Number(m[0].replace(',', '.')), start: m.index, end: m.index + m[0].length });
  }
  return out;
}


const TIME_CUES = /اليوم|الليل|بكر|باكر|غدا|صباح|الصبح|الفجر|المساء|مساء|العصر|الظهر|خلال|ساع|يوم|ايام|اسبوع|اسابيع|شهر|موعد|اقصاها|قبل|حالا|فورا|الحين|today|tonight|tomorrow|morning|evening|noon|night|within|hour|day|week|month|asap|eod|by\b|before|deadline|required by|needed by|immediately/;

/**
 * items: [{ key, quantity }] بعد ربطها بالكتالوج، بنفس ترتيب النموذج.
 * يرجع { items (نسخ معدّلة), deadline, warnings: [{code, key?}] }.
 * لا يخترع قيمة أبداً: التصحيح إما null (يُسأل المستخدم) أو تحذير يمنع الإرسال المباشر.
 */
export function evidenceGuards(text, items, deadline, index) {
  const warnings = [], out = items.map(i => ({ ...i }));
  const ms = mentions(text, index), nums = numbers(text);
  const mentionedKeys = new Set(ms.map(m => m.key));

  // 1) صنف ليس له أي ذكر في النص ← غالباً مُختلق: يُعلَّم للتأكيد
  for (const it of out) if (!mentionedKeys.has(it.key)) { it.needsConfirm = true; warnings.push({ code: 'item_not_in_text', key: it.key }); }

  // 2) نفس الكمية لأكثر من صنف وهي مذكورة في النص مرات أقل ← الكمية مكررة بالخطأ: تُلغى وتُسأل
  const byQty = new Map();
  for (const it of out) if (Number.isFinite(it.quantity)) byQty.set(it.quantity, [...(byQty.get(it.quantity) || []), it]);
  for (const [q, list] of byQty) if (list.length > 1) {
    const digits = nums.filter(n => n.value === q).length, inText = digits + wordCount(text, q);
    if (q > 2 && digits > 0 && inText < list.length) for (const it of list) { it.quantity = null; it.needsConfirm = true; warnings.push({ code: 'duplicate_quantity', key: it.key }); }
  }

  // 3) ربط الكمية بالصنف: الرقم يجب أن يقع في نفس جزء الجملة مع ذكر صنفه.
  //    الأجزاء تُقسم عند الفواصل والأسطر و«و» العطف (إلا إذا كانت «و» من اسم صنف مثل «وتد»).
  const t = normText(text), inMention = i => ms.some(m => i >= m.start && i < m.end);
  const cuts = [0];
  for (const m of t.matchAll(/[،,;\n+]|\s-\s|\.\s|\band\b|(?:^|\s)و(?=\S)|\sو\s/g)) {
    const at = m.index + m[0].indexOf('و') >= m.index && m[0].includes('و') ? m.index + m[0].indexOf('و') : m.index;
    if (!inMention(at)) cuts.push(at);
  }
  cuts.push(t.length);
  const seg = i => { let k = 0; while (k + 1 < cuts.length && cuts[k + 1] <= i) k++; return k; };
  for (const it of out) {
    if (!Number.isFinite(it.quantity)) continue;
    const occ = nums.filter(n => n.value === it.quantity);
    if (!occ.length) {
      // الكمية غير موجودة في النص: إن لم يكن فيه أي رقم مكتوب بالحروف فهي مختلقة («2000 … 200» ← 20)
      if (it.quantity > 2 && !anyNumberWord(text)) { it.quantity = null; it.needsConfirm = true; warnings.push({ code: 'quantity_not_in_text', key: it.key }); }
      continue;
    }
    // الوحدة المكتوبة بعد الرقم في جزء الصنف تغلب وحدة النموذج إذا كانت مسموحة للصنف («مويه 200 لتر» والنموذج قال طبلية)
    if (it.perUnit && it.unit) {
      const own0 = ms.filter(m => m.key === it.key), segs0 = new Set(own0.map(m => seg(m.start)));
      const said = occ.filter(n => !own0.length || segs0.has(seg(n.start))).map(n => unitAfter(t, n)).find(Boolean);
      if (said && said !== it.unit && Number.isFinite(it.perUnit[said])) { warnings.push({ code: 'unit_from_text', key: it.key, unit: said, model: it.unit }); it.unit = said; }
    }
    if (it.quantity <= 2 || wordCount(text, it.quantity) > 0) continue; // «برميلين» و«خمس» تعطي نفس القيمة بالحروف: غامض، لا نحكم
    const own = ms.filter(m => m.key === it.key);
    if (!own.length) continue;                       // عولج في (1)
    const ownSegs = new Set(own.map(m => seg(m.start)));
    if (occ.some(n => ownSegs.has(seg(n.start)))) continue;
    // الرقم ليس في جزء صنفه: نحكم فقط إذا كان في جزء فيه صنف آخر
    const other = occ.map(n => ms.find(m => m.key !== it.key && seg(m.start) === seg(n.start))).find(Boolean);
    if (!other) continue;
    it.quantity = null; it.needsConfirm = true;
    warnings.push({ code: 'quantity_belongs_to_other_item', key: it.key, other: other.key });
    if (!out.some(x => x.key === other.key)) warnings.push({ code: 'possible_missing_item', key: other.key });
  }

  // 4) موعد بدون أي كلمة وقت في النص ← null
  if (deadline != null && !TIME_CUES.test(normText(text))) { deadline = null; warnings.push({ code: 'deadline_not_in_text' }); }

  return { items: out, deadline, warnings };
}

// هل الرقم q مكتوب بالأرقام في نفس جزء الجملة مع ذكر الصنف key؟ (يُستخدم عند استبدال صنف غير مذكور بصنف مذكور)
export function quantityNearItem(text, key, q, index) {
  if (!Number.isFinite(q)) return false;
  const t = normText(text), ms = mentions(text, index), own = ms.filter(m => m.key === key);
  if (!own.length) return false;
  const cuts = [0];
  for (const m of t.matchAll(/[،,;\n+]|\s-\s|\.\s|\band\b|(?:^|\s)و(?=\S)|\sو\s/g)) {
    const at = m[0].includes('و') ? m.index + m[0].indexOf('و') : m.index;
    if (!ms.some(x => at >= x.start && at < x.end)) cuts.push(at);
  }
  const seg = i => cuts.filter(c => c <= i).length;
  const segs = new Set(own.map(m => seg(m.start)));
  return numbers(text).some(n => n.value === q && segs.has(seg(n.start)));
}
