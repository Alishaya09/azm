// إعداد أول تشغيل: ينشئ حساب المسؤول الخاص بك (بدل الحساب العشوائي).
//
//   npm run setup                         ← أسئلة تفاعلية (اسم المستخدم، الاسم، كلمة المرور)
//   npm run setup -- --reset-admin        ← نسيت كلمة مرور المسؤول؟ يعيد تعيينها (أو ينشئ مسؤول جديد)
//   node scripts/setup.mjs --username admin --password "MyPass123" --name "Ahmed" --yes   ← بدون أسئلة
//
// يكتب في مجلد البيانات (data/ أو AZM_DATA_DIR). أوقف الخادم قبل تشغيله.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import readline from 'node:readline';
import { DATA_DIR } from '../server/config.mjs';
import { hashPassword } from '../server/lib/password.mjs';

const args = process.argv.slice(2);
const flag = n => args.includes(`--${n}`);
const opt = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const usersFile = join(DATA_DIR, 'users.json');
const RANKS = ['private', 'private1', 'corporal', 'vsergeant', 'sergeant', 'ssergeant', 'msergeant', 'lt', '1lt', 'captain', 'major', 'ltcol', 'colonel', 'brigadier', 'majgen', 'ltgen', 'civilian'];

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
// قراءة الإجابات سطر سطر (تشتغل في الطرفية العادية وكذلك لو انمررت الإجابات عبر pipe)
let muted = false, closed = false, waiter = null;
const lines = [];
rl._writeToOutput = s => { if (!muted) process.stdout.write(s); }; // muted = لا نعرض كلمة المرور وهي تنكتب
rl.on('line', l => { if (waiter) { const w = waiter; waiter = null; w(l); } else lines.push(l); });
rl.on('close', () => { closed = true; if (waiter) { const w = waiter; waiter = null; w(null); } });
const nextLine = () => new Promise(ok => lines.length ? ok(lines.shift()) : closed ? ok(null) : (waiter = ok));
const ask = async (q, def = '') => {
  process.stdout.write(def ? `${q} [${def}]: ` : `${q}: `);
  const a = await nextLine(); if (!process.stdin.isTTY) process.stdout.write('\n');
  return a === null ? def : (a.trim() || def);
};
const askHidden = async q => {
  process.stdout.write(`${q}: `); muted = true;
  const a = await nextLine(); muted = false; process.stdout.write('\n');
  if (a === null) { console.error('\n✕ Input ended before the password was entered.'); process.exit(1); }
  return a;
};
const save = list => { mkdirSync(DATA_DIR, { recursive: true }); const tmp = `${usersFile}.tmp`; writeFileSync(tmp, JSON.stringify(list, null, 2)); renameSync(tmp, usersFile); };
const fail = msg => { console.error(`\n✕ ${msg}\n`); rl.close(); process.exit(1); };
const validName = s => /^[A-Za-z0-9_.-]{3,32}$/.test(s);

async function getPassword() {
  if (opt('password') || flag('yes')) { if (!opt('password')) fail('--yes needs --password.'); if (opt('password').length < 8) fail('Password must be at least 8 characters.'); return opt('password'); }
  for (;;) {
    const p = await askHidden('Password (min 8 characters)');
    if (p.length < 8) { console.log('  ✕ Too short — at least 8 characters.'); continue; }
    if (await askHidden('Confirm password') !== p) { console.log('  ✕ Passwords do not match.'); continue; }
    return p;
  }
}

console.log('\n=== AZM | عَزْم — Setup ===');
console.log(`Data folder: ${DATA_DIR}\n`);
const existing = existsSync(usersFile) ? JSON.parse(readFileSync(usersFile, 'utf8')) : null;

if (flag('reset-admin')) {
  // إعادة تعيين كلمة مرور مسؤول (أو إنشاء مسؤول جديد) في بيانات موجودة
  if (!existing) fail('No accounts yet — run "npm run setup" without --reset-admin.');
  const username = opt('username') || await ask('Admin username to reset or create', 'admin');
  if (!validName(username)) fail('Username: 3–32 letters, digits, "_", "." or "-".');
  const password = await getPassword();
  const u = existing.find(x => x.username === username);
  if (u) Object.assign(u, { password: hashPassword(password), role: 'admin', unitId: null, status: 'active' });
  else existing.push({ username, role: 'admin', unitId: null, status: 'active', fullName: opt('name') || username, rank: 'colonel', createdAt: Date.now(), password: hashPassword(password) });
  save(existing);
  console.log(`\n✓ Admin "${username}" is ready. Restart the server (node server.mjs) and sign in.\n`);
  rl.close(); process.exit(0);
}

if (existing) fail(`Accounts already exist in ${usersFile}.\n  To reset an admin password: npm run setup -- --reset-admin\n  To start completely fresh: stop the server and delete the data folder.`);

const auto = flag('yes'); // بدون أسئلة: أي قيمة ناقصة تاخذ الافتراضي
const username = opt('username') || (auto ? 'admin' : await ask('Admin username', 'admin'));
if (!validName(username)) fail('Username: 3–32 letters, digits, "_", "." or "-".');
const fullName = opt('name') || (auto ? 'System Administrator' : await ask('Full name', 'System Administrator'));
const rankIn = opt('rank') || (auto ? 'colonel' : await ask(`Rank (${RANKS.join(', ')})`, 'colonel'));
const rank = RANKS.includes(rankIn) ? rankIn : 'colonel';
const password = await getPassword();
const demo = flag('demo') || (!flag('yes') && /^y/i.test(await ask('Also create a demo unit user "user01" (UNIT-01)? (y/N)', 'N')));

const now = Date.now(), list = [{ username, role: 'admin', unitId: null, status: 'active', fullName, rank, position: 'Logistics Commander', createdAt: now, password: hashPassword(password) }];
let demoPass = null;
if (demo) {
  demoPass = Math.random().toString(36).slice(2, 10) + 'A1';
  list.push({ username: 'user01', role: 'user', unitId: 'UNIT-01', status: 'active', fullName: 'Unit 01 Officer', rank: 'captain', position: 'Unit Logistics Officer', createdAt: now, password: hashPassword(demoPass) });
}
save(list);
console.log(`\n✓ Admin account created: ${username}`);
if (demoPass) console.log(`✓ Demo user created: user01 / ${demoPass}   (write it down — it is not saved anywhere)`);
console.log('\nNext: node server.mjs   →   open http://localhost:5173 and sign in.\n');
rl.close();
