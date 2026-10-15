// يعرض ملخص قواعد البيانات الفعلية (قراءة فقط — ما يعدّل أي شي)
//   npm run db:inspect
// للتفاصيل الكاملة لكل حقل: docs/DATABASE.md
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../server/config.mjs';

const read = f => { const p = join(DATA_DIR, f); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; };
const count = (arr, key) => arr.reduce((m, x) => (m[x[key] ?? '—'] = (m[x[key] ?? '—'] || 0) + 1, m), {});
const fmt = n => Math.round(n).toLocaleString('en-US');

console.log(`\n=== AZM databases — ${DATA_DIR} ===\n`);
const users = read('users.json'), state = read('state.json'), chats = read('chats.json');
if (!users && !state) { console.log('No data yet. Run "npm run setup" then "node server.mjs".\n'); process.exit(0); }

if (users) {
  console.log(`users.json — ${users.length} accounts`);
  console.log('  by status:', count(users, 'status'), ' by role:', count(users, 'role'));
  for (const u of users) console.log(`  · ${u.username.padEnd(16)} ${String(u.role).padEnd(13)} ${String(u.status).padEnd(10)} ${u.role === 'base_manager' ? `base ${u.baseId}` : u.unitId || '(all bases)'}  ${u.fullName || ''}`);
}
if (state) {
  const nodes = state.layout?.nodes || [];
  console.log(`\nstate.json`);
  console.log(`  map: ${state.layout ? `${nodes.length} points (${nodes.filter(n => n.type === 'main').length} bases, ${nodes.filter(n => n.type === 'fsb').length} supply points, ${nodes.filter(n => n.type === 'unit').length} units), ${state.layout.links.length} links` : 'default layout (not edited yet)'}`);
  console.log(`  requests: ${state.requests.length}`, count(state.requests, 'status'));
  console.log(`  logs: ${state.logs.length} · alerts: ${(state.alerts || []).length} · sim: speed ×${state.sim?.speed}, ${Math.round(state.sim?.hours || 0)} operational hours`);
  console.log('  unit stocks (%):');
  for (const [id, s] of Object.entries(state.stocks || {})) console.log(`    · ${id.padEnd(10)} ammo ${Math.round(s.ammo)}  fuel ${Math.round(s.fuel)}  food ${Math.round(s.food)}  medical ${Math.round(s.medical)}`);
  console.log('  depots (quantities):');
  for (const [id, d] of Object.entries(state.depots || {})) console.log(`    · ${id.padEnd(20)} ammo ${fmt(d.ammo)}  fuel ${fmt(d.fuel)}  food ${fmt(d.food)}  medical ${fmt(d.medical)}${nodes.some(n => n.id === id) ? '' : '   (not on map)'}`);
  console.log(`  schema v${state.schemaVersion || 1}${state.trackingStartedAt ? ` · tracking since ${new Date(state.trackingStartedAt).toISOString()}` : ''}${state.migrationBackup ? ` · migration backup: backups/${state.migrationBackup}` : ''}`);
  if (state.schemaVersion >= 2) {
    console.log(`  movements: ${(state.movements || []).length}`, count(state.movements || [], 'type'), `· archived entities: ${Object.keys(state.archivedEntities || {}).length}`);
    // سجل قديم بدون قاعدة صالحة فقط (التبعية ثابتة، ومركز الإمداد ما هو شرط)
    const review = nodes.filter(n => n.type !== 'main' && n.type !== 'hq' && !nodes.some(b => b.type === 'main' && b.id === n.baseId));
    console.log(`  legacy records without a valid base: ${review.length}`);
    console.log(`  main supply center: ${nodes.filter(n => n.type === 'hq').map(n => n.id).join(', ') || '— (added on next start)'} · catalog: ${(state.catalog || []).map(c => c.key + (c.active ? '' : ' (disabled)')).join(', ') || '— (added on next start)'}`);
    const stalled = (state.requests || []).filter(r => r.stalled); if (stalled.length) console.log(`  legacy approvals never dispatched: ${stalled.map(r => r.id).join(', ')}`);
    for (const n of review) console.log(`    · ${n.id.padEnd(20)} ${n.type.padEnd(5)} base=${n.baseId || '—'} supply=${n.supplyId || '—'} (${n.relationSource})`);
  }
}
if (chats) console.log(`\nchats.json — ${Object.values(chats).reduce((s, l) => s + l.length, 0)} chats across ${Object.keys(chats).length} users`);
console.log('');
