// يجهّز نسخة نظيفة من المشروع للإرسال: بدون بياناتك (data/)، ولا إعداداتك (.env)، ولا ملفات البناء.
//   npm run package   →   release/AZM-<التاريخ>/  +  release/AZM-<التاريخ>.zip
// اللي يستلم النسخة يشغّل npm run setup وينشئ حساب المسؤول الخاص فيه.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve('.');
// المسموح ينرسل فقط — أي شي ثاني (data، .env، dist، .claude، release…) ما ينسخ
const INCLUDE = ['index.html', 'server.mjs', 'build.mjs', 'package.json', '.env.example', '.gitignore', '.gitattributes', 'start-azm.cmd', 'start-azm.sh',
  'README.md', 'AGENTS.md', 'CLAUDE.md', 'server', 'src', 'vendor', 'scripts', 'docs', 'branding', 'resources', 'models', 'rag', 'training'];
const name = `AZM-${new Date().toISOString().slice(0, 10)}`;
const outDir = join(root, 'release', name), zip = join(root, 'release', `${name}.zip`);

rmSync(outDir, { recursive: true, force: true }); rmSync(zip, { force: true });
mkdirSync(outDir, { recursive: true });
for (const item of INCLUDE) {
  const src = join(root, item);
  if (existsSync(src)) cpSync(src, join(outDir, item), { recursive: true });
  else console.warn(`  (skipped, not found: ${item})`);
}
// احتياط: تأكد إن ما فيه بيانات حساسة انسخت بالغلط
for (const bad of ['data', '.env', 'dist', '.claude']) if (existsSync(join(outDir, bad))) rmSync(join(outDir, bad), { recursive: true, force: true });
rmSync(join(outDir, 'scripts', '__pycache__'), { recursive: true, force: true });
rmSync(join(outDir, 'rag', '__pycache__'), { recursive: true, force: true });
console.log(`✓ Clean copy: ${outDir}`);
console.log(`  Contents: ${readdirSync(outDir).join(', ')}`);

// ضغط ZIP: tar المدمج في Windows 10+ يدعم zip، وفي Linux/macOS نستخدم zip إذا موجود
const winTar = process.env.SystemRoot && join(process.env.SystemRoot, 'System32', 'tar.exe');
const tries = [
  winTar && existsSync(winTar) ? [winTar, ['-a', '-c', '-f', zip, '-C', join(root, 'release'), name]] : null,
  ['zip', ['-rq', zip, name], { cwd: join(root, 'release') }],
].filter(Boolean);
for (const [cmd, cmdArgs, o = {}] of tries) {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'ignore', ...o });
  if (r.status === 0 && existsSync(zip)) { console.log(`✓ Zip ready to send: ${zip}`); process.exit(0); }
}
console.log('  (Could not create a zip automatically — compress the folder above manually.)');
