// أدوات HTTP مشتركة: إرسال JSON، قراءة جسم الطلب، وتنظيف المدخلات.

// send ترجع true حتى يقدر كل معالج يكتب: return send(...)  ويعرف الموجّه إن الطلب انخدم
export const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
  return true;
};

export const readBody = req => new Promise((ok, fail) => {
  // نجمع البايتات ونفك ترميزها مرة وحدة، عشان الحروف العربية ما تنكسر إذا انقسمت بين دفعتين
  const chunks = []; let size = 0;
  req.on('data', c => { chunks.push(c); size += c.length; if (size > 4 * 1024 * 1024) { fail(new Error('too large')); req.destroy(); } });
  req.on('end', () => { try { const data = Buffer.concat(chunks).toString('utf8'); ok(data ? JSON.parse(data) : {}); } catch (e) { fail(e); } });
});

export const cleanText = (v, max = 1000) => typeof v === 'string' ? v.trim().slice(0, max) : '';
export const validName = s => typeof s === 'string' && /^[A-Za-z0-9_.-]{3,32}$/.test(s);
export const validPassword = s => typeof s === 'string' && s.length >= 6 && s.length <= 128;
export const validPoint = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;
