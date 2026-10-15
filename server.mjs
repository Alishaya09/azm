// نقطة تشغيل الخادم: يقدّم ملفات الواجهة الثابتة ويحوّل طلبات /api للموجّه.
//   node server.mjs          → يقدّم المشروع من جذره (التطوير)
//   node server.mjs dist     → يقدّم النسخة المبنية من مجلد dist
// الإعدادات (المنفذ، مجلد البيانات، ربط النموذج...) في server/config.mjs و .env
import './server/boot.mjs'; // قفل مجلد البيانات — لازم يكون أول استيراد
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { HOST, MIME_TYPES, PORT, PUBLIC_DIRS } from './server/config.mjs';
import { send } from './server/lib/http.mjs';
import { handleApi } from './server/routes/index.mjs';
import { aiStatus } from './server/ai/index.mjs';
import { startSimClock } from './server/store/state.mjs';

const root = resolve(process.argv[2] || '.');

const server = http.createServer(async (req, res) => {
  let clean;
  try { clean = decodeURIComponent((req.url || '/').split('?')[0]); } catch { return send(res, 400, { error: 'bad_url' }); }
  if (clean.startsWith('/api/')) {
    try { return await handleApi(req, res, clean); } catch { return send(res, 400, { error: 'bad_request' }); }
  }
  // الملفات الثابتة: فقط من المجلدات المسموحة؛ أي مسار ثاني (data، server، ...) يرجع الصفحة الرئيسية
  let file = normalize(join(root, clean === '/' ? 'index.html' : clean));
  const allowed = PUBLIC_DIRS.some(d => file.startsWith(join(root, d) + sep));
  if (!allowed || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
});

server.listen(PORT, HOST, () => {
  // ساعة المحاكاة تعمل على الخادم دون انتظار متصفح مفتوح؛ وقت توقف الخادم لا يُعوَّض
  startSimClock();
  const ai = aiStatus();
  console.log(`AZM Reference UI: http://127.0.0.1:${PORT}`);
  console.log(`AI assistant: ${ai.configured ? `configured, connectivity unverified (${ai.provider} · ${ai.model})` : 'not configured'}`);
});
