// يبني نسخة ثابتة في مجلد dist (الواجهة + المكتبات). الخادم نفسه يبقى في جذر المشروع.
// التشغيل: npm run build  ثم  npm run preview
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve('.');
const out = resolve('dist');
if (existsSync(out)) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const item of ['index.html', 'src', 'vendor']) cpSync(resolve(root, item), resolve(out, item), { recursive: true });
console.log(`Built static site in ${out}`);
