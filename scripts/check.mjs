// فحص سلامة الكود بدون تشغيل الخادم:
//   npm run check
// - كل ملفات الخادم: صياغة سليمة (node --check)
// - كل ملفات الواجهة المذكورة في index.html: موجودة وتتحول بـ Babel بدون أخطاء
// - لا يوجد اسم معرّف مرتين على مستوى الملفات (كلها تتشارك نطاقاً واحداً)
// - كل مفتاح ترجمة مستخدم t('…') موجود في القاموس، وبدون مفاتيح مكررة
// - ملفات التنسيق المذكورة في index.html موجودة
// - تجميد الواجهة: ملفات الواجهة مطابقة للنسخة المعتمدة (scripts/ui-freeze.mjs)
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const walk = dir => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

// 1) الخادم
const serverFiles = [join(root, 'server.mjs'), ...walk(join(root, 'server')), ...walk(join(root, 'scripts'))].filter(f => f.endsWith('.mjs'));
for (const f of serverFiles) { const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' }); if (r.status !== 0) problems.push(`syntax: ${f}\n${r.stderr}`); }

// 2) الواجهة
const html = readFileSync(join(root, 'index.html'), 'utf8');
const jsx = [...html.matchAll(/<script type="text\/babel"[^>]*src="\/(src\/[^"]+\.jsx)"/g)].map(m => m[1]);
const css = [...html.matchAll(/<link rel="stylesheet" href="\/(src\/[^"]+\.css)"/g)].map(m => m[1]);
for (const f of css) if (!existsSync(join(root, f))) problems.push(`missing stylesheet: ${f}`);
const ctx = {}; ctx.self = ctx.window = ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'vendor/babel.min.js'), 'utf8'), ctx);
let all = '';
for (const f of jsx) {
  if (!existsSync(join(root, f))) { problems.push(`missing script: ${f}`); continue; }
  const code = readFileSync(join(root, f), 'utf8'); all += code + '\n';
  try { ctx.Babel.transform(code, { presets: ['react'] }); } catch (e) { problems.push(`JSX error in ${f}: ${e.message.split('\n')[0]}`); }
}
// ملفات jsx موجودة لكن غير محمّلة في index.html
for (const f of walk(join(root, 'src')).filter(f => f.endsWith('.jsx')).map(f => f.slice(root.length + 1).replace(/\\/g, '/'))) if (!jsx.includes(f)) problems.push(`not loaded in index.html: ${f}`);
if (jsx[jsx.length - 1] !== 'src/main.jsx') problems.push('src/main.jsx must be the last script in index.html');

// 3) أسماء مكررة على المستوى الأعلى
const names = [...all.matchAll(/^(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
const dupNames = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
if (dupNames.length) problems.push(`duplicate top-level names (all src files share one scope): ${dupNames.join(', ')}`);

// 4) الترجمة
const tr = readFileSync(join(root, 'src/i18n/translations.jsx'), 'utf8');
const dict = tr.slice(tr.indexOf('const dict'), tr.lastIndexOf('};'));
const keys = [...dict.matchAll(/'([^']+)': \[/g)].map(m => m[1]);
const dupKeys = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
if (dupKeys.length) problems.push(`duplicate translation keys: ${dupKeys.join(', ')}`);
const missing = [...new Set([...all.matchAll(/\bt\('([^']+)'/g)].map(m => m[1]))].filter(k => !keys.includes(k));
if (missing.length) problems.push(`translation keys used but not defined: ${missing.join(', ')}`);
const oneLang = [...dict.matchAll(/'([^']+)': \[\s*'((?:[^'\\]|\\.)*)'\s*\]/g)].map(m => m[1]);
if (oneLang.length) problems.push(`translation keys with only one language: ${oneLang.join(', ')}`);

// 5) تجميد الواجهة: أي تعديل أو إضافة أو حذف في index.html أو src/ يُفشل الفحص (AGENTS.md §0)
const { verifyUiFreeze } = await import('./ui-freeze.mjs');
problems.push(...verifyUiFreeze());

console.log(`Checked ${serverFiles.length} server/script files, ${jsx.length} UI files, ${css.length} stylesheets, ${keys.length} translation keys, UI freeze.`);
if (problems.length) { console.log(`\n✕ ${problems.length} problem(s):\n - ${problems.join('\n - ')}`); process.exit(1); }
console.log('✓ All checks passed');
