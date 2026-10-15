// أول شي يتحمّل في الخادم (قبل أي قراءة أو كتابة للبيانات): قفل مجلد البيانات.
// خادمين على نفس مجلد البيانات يطغى كل واحد على حفظ الثاني (حسابات وطلبات تختفي)، فالثاني يرفض التشغيل.
import { mkdirSync } from 'node:fs';
import { DATA_DIR, PORT } from './config.mjs';
import { lockDataDir } from './lib/storage.mjs';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const cycleTransaction = join(dirname(DATA_DIR), `.${basename(DATA_DIR)}-cycle-transaction.json`);
if (existsSync(cycleTransaction)) {
  console.error('AZM: unfinished offline cycle operation. Run node scripts/new-cycle.mjs --recover --confirm RECOVER before restarting.');
  process.exit(1);
}

mkdirSync(DATA_DIR, { recursive: true });
const lock = lockDataDir(DATA_DIR, { port: PORT });
if (existsSync(cycleTransaction)) { console.error('AZM: offline cycle operation is in progress.'); process.exit(1); }
if (!lock.ok) {
  console.error(`\n✕ AZM: another AZM server is already running on this data folder (pid ${lock.other.pid}, port ${lock.other.port ?? '?'}, since ${lock.other.startedAt}).`);
  console.error(`  Data folder: ${DATA_DIR}`);
  console.error('  Stop it first (Ctrl+C in its window), or use a different AZM_DATA_DIR. Running two servers on one data folder makes them overwrite each other.\n');
  process.exit(1);
}
