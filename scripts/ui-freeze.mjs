// تجميد الواجهة: التصميم والواجهة ثابتان بقرار صاحب المشروع، ولا يُعدَّل أي ملف منها.
// يحسب بصمة (SHA-256) لكل ملف واجهة ويقارنها بالبصمات المعتمدة في scripts/ui-freeze.lock.json.
// check.mjs يستدعيه، فأي تعديل أو إضافة أو حذف في ملفات الواجهة يُفشل الفحص الإلزامي.
//
//   node scripts/ui-freeze.mjs            → فحص فقط (لا يغيّر شيئاً)
//   node scripts/ui-freeze.mjs --update --confirm UI-CHANGE-APPROVED-BY-OWNER
//                                         → اعتماد الواجهة الحالية كنسخة ثابتة جديدة.
//                                           ممنوع إلا بموافقة صريحة ومكتوبة من صاحب المشروع.
//
// ملفات الواجهة: index.html وكل ما في src/ (الصفحات، المكونات، التنسيقات، الترجمات، الشعار والصور).
// نهايات الأسطر تُوحَّد قبل الحساب، فاختلاف Windows/Linux أو git لا يُعد تعديلاً.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const UI_LOCK = join(root, 'scripts', 'ui-freeze.lock.json');
const CONFIRM = 'UI-CHANGE-APPROVED-BY-OWNER';
const TEXT = /\.(jsx?|mjs|css|html|json|md|svg|txt)$/i;
const walk = dir => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

export function uiFiles() {
  return ['index.html', ...walk(join(root, 'src')).map(f => relative(root, f))].map(f => f.replace(/\\/g, '/')).sort();
}
const fingerprint = file => {
  const raw = readFileSync(join(root, file));
  const data = TEXT.test(file) ? Buffer.from(raw.toString('utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n'), 'utf8') : raw;
  return createHash('sha256').update(data).digest('hex');
};
export const currentUi = () => Object.fromEntries(uiFiles().map(f => [f, fingerprint(f)]));

// يرجع قائمة المشاكل (فاضية = الواجهة كما اعتُمدت)
export function verifyUiFreeze() {
  if (!existsSync(UI_LOCK)) return [`UI freeze lock missing: scripts/ui-freeze.lock.json`];
  const locked = JSON.parse(readFileSync(UI_LOCK, 'utf8')).files || {}, now = currentUi();
  const changed = Object.keys(locked).filter(f => f in now && now[f] !== locked[f]);
  const removed = Object.keys(locked).filter(f => !(f in now));
  const added = Object.keys(now).filter(f => !(f in locked));
  if (!changed.length && !removed.length && !added.length) return [];
  return [`UI FREEZE: the interface and its design are frozen by the project owner and must not be modified (see AGENTS.md §0).`
    + (changed.length ? `\n     changed: ${changed.join(', ')}` : '') + (added.length ? `\n     added:   ${added.join(', ')}` : '') + (removed.length ? `\n     removed: ${removed.join(', ')}` : '')
    + `\n     Revert these files. Only the owner may approve a UI change.`];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--update')) {
    if (args[args.indexOf('--confirm') + 1] !== CONFIRM || !args.includes('--confirm')) {
      console.error('✕ Refused. Re-locking the UI is reserved for the project owner (AGENTS.md §0). AI assistants and contributors must never run it.');
      process.exit(1);
    }
    const files = currentUi();
    writeFileSync(UI_LOCK, JSON.stringify({ note: 'UI freeze: approved interface fingerprints. Do not edit by hand. See AGENTS.md §0 and scripts/ui-freeze.mjs.', lockedAt: new Date().toISOString(), files }, null, 2) + '\n');
    console.log(`✓ UI locked: ${Object.keys(files).length} files`);
  } else {
    const problems = verifyUiFreeze();
    if (problems.length) { console.log(`✕ ${problems.join('\n')}`); process.exit(1); }
    console.log(`✓ UI unchanged (${uiFiles().length} files match the approved freeze)`);
  }
}
