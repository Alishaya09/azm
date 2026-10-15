// قراءة وكتابة ملفات JSON. الكتابة تمر بملف مؤقت ثم إعادة تسمية، فما ينكتب ملف ناقص لو انقطع التشغيل.
// حماية من كاتب ثاني: نتذكر وقت تعديل كل ملف بعد آخر قراءة/كتابة منا. إذا تغيّر الملف من برنامج ثاني
// (مثلاً خادم ثاني شغّال على نفس مجلد البيانات) نحفظ نسخته في backups/ قبل ما نكتب، ونطبع تحذير واضح.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const known = new Map(); // file -> mtimeMs بعد آخر قراءة/كتابة منا (null = الملف ما كان موجود)
const mtimeOf = file => { try { return statSync(file).mtimeMs; } catch { return null; } };

export const readJson = (file, fallback) => {
  known.set(file, mtimeOf(file));
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
};

export const writeJson = (file, value) => {
  const now = mtimeOf(file);
  if (known.has(file) && now !== known.get(file) && now !== null) {
    const dir = join(dirname(file), 'backups'); mkdirSync(dir, { recursive: true });
    const copy = join(dir, `${basename(file, '.json')}-${new Date().toISOString().replace(/[:.]/g, '-')}-external-change.json`);
    copyFileSync(file, copy);
    console.error(`\n⚠ AZM: ${basename(file)} was changed by another program (is a second server running on the same data folder?).\n  Its version was saved to ${copy} before overwriting.\n`);
  }
  const tmp = `${file}.tmp`; writeFileSync(tmp, JSON.stringify(value, null, 2)); renameSync(tmp, file);
  known.set(file, mtimeOf(file));
};

// قفل مجلد البيانات: خادم واحد فقط لكل مجلد بيانات. خادم ثاني يرفض التشغيل بدل ما يطغى كل واحد على بيانات الثاني.
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export function lockDataDir(dataDir, info = {}) {
  const lock = join(dataDir, '.server.lock');
  if (existsSync(lock)) {
    let other = null; try { other = JSON.parse(readFileSync(lock, 'utf8')); } catch {}
    if (other?.pid && other.pid !== process.pid && alive(other.pid)) return { ok: false, other, lock };
  }
  writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), ...info }));
  const release = () => { try { const cur = JSON.parse(readFileSync(lock, 'utf8')); if (cur.pid === process.pid) rmSync(lock); } catch {} };
  process.on('exit', release);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => process.exit(0));
  return { ok: true, lock };
}
