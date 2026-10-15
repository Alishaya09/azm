// Request-extraction evaluation: fine-tuned model (azm-request-lora) vs base model (azm-report-base)
// on examples the model never trained on (training/data/valid.jsonl).
//
//   node scripts/eval-extraction.mjs                       ← default: 200 examples × both models
//   node scripts/eval-extraction.mjs --limit 20            ← quick check
//   node scripts/eval-extraction.mjs --models azm-request-lora
//   node scripts/eval-extraction.mjs --data training/data/test.jsonl --url http://127.0.0.1:8002/v1
//   node scripts/eval-extraction.mjs --guards             ← also measures after the server guardrails (server/ai/request-evidence.mjs)
//   node scripts/eval-extraction.mjs --temperature 0.3    ← effect of a higher temperature (the server uses 0 for extraction)
//
// Needs the model server running (bash scripts/start-ai.sh). Does not import server code and never touches data/.
// Output: eval-results/report.md (comparison and most common errors) and eval-results/run-<time>.json (every example).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GUARDS = process.argv.includes('--guards');
// The extraction prompt is read from the server file as text (no server code runs, so data/ is never opened); the evaluation matches production.
const contractSrc = readFileSync(join(root, 'server/ai/request-contract.mjs'), 'utf8');
const promptMatch = contractSrc.match(/export const REQUEST_SYSTEM_PROMPT = ("(?:[^"\\]|\\.)*");/);
if (!promptMatch) { console.error('Could not read REQUEST_SYSTEM_PROMPT from server/ai/request-contract.mjs'); process.exit(1); }
const REQUEST_SYSTEM_PROMPT = JSON.parse(promptMatch[1]);
const notUrgentMatch = contractSrc.match(/const NOT_URGENT = (\/.*\/[a-z]*);/);
const NOT_URGENT = notUrgentMatch ? new RegExp(notUrgentMatch[1].slice(1, notUrgentMatch[1].lastIndexOf('/')), notUrgentMatch[1].slice(notUrgentMatch[1].lastIndexOf('/') + 1)) : null;
// Server guardrails: a standalone module with no imports, so loading it never opens data/
const G = GUARDS ? await import('../server/ai/request-evidence.mjs') : null;
const catalog = GUARDS ? JSON.parse(readFileSync(join(root, 'resources/items.json'), 'utf8')).items : [];
const gIndex = GUARDS ? G.buildIndex(catalog) : null;
const keyOf = new Map(); for (const r of catalog) for (const n of [r.item, ...(r.aliases?.en || [])]) keyOf.set(n.trim().toLowerCase(), r);
// Applies what the server applies after the model and returns { out, flagged }: flagged = the server stopped the request or asked the user instead of passing it
function applyGuards(text, pred) {
  if (!pred) return { out: null, flagged: true };                       // invalid JSON: the server rejects it and the user is asked to rephrase
  const rows = pred.items.map(i => keyOf.get(String(i.item || '').trim().toLowerCase()));
  if (rows.some(r => !r)) return { out: pred, flagged: true };          // name outside the catalog: invalid_model_item
  const ev = G.evidenceGuards(text, rows.map((r, i) => ({ key: r.key, quantity: pred.items[i].quantity })), pred.deadline ?? null, gIndex);
  const items = pred.items.map((it, i) => ({ ...it, supply_class: rows[i].supplyClass, quantity: ev.items[i].quantity }));
  for (const w of ev.warnings) if (w.code === 'possible_missing_item' && !rows.some(r => r.key === w.key)) {
    const r = catalog.find(c => c.key === w.key); items.push({ item: r.item, supply_class: r.supplyClass, quantity: null, unit_of_measure: null });
  }
  let priority = pred.priority;
  if (priority === 'urgent' && NOT_URGENT?.test(text)) priority = 'normal';
  const flagged = ev.items.some(i => i.needsConfirm) || ev.warnings.some(w => w.code !== 'deadline_not_in_text');
  // item without a quantity: the chat asks for it before continuing, so the user reviews the draft
  const asks = items.some(i => i.quantity == null);
  return { out: { items, priority, deadline: ev.deadline }, flagged, asks };
}
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const DATA = opt('data', join(root, 'training/data/valid.jsonl'));
const URL_BASE = opt('url', 'http://127.0.0.1:8002/v1').replace(/\/$/, '');
const MODELS = opt('models', 'azm-request-lora,azm-report-base').split(',').map(s => s.trim()).filter(Boolean);
const LIMIT = Number(opt('limit', 0)) || Infinity;
const OUT = opt('out', join(root, 'eval-results'));
const TIMEOUT = Number(opt('timeout', 180000));
const TEMP = Number(opt('temperature', 0));

if (!existsSync(DATA)) { console.error(`File not found: ${DATA}`); process.exit(1); }
const rows = readFileSync(DATA, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).slice(0, LIMIT);
const datasetPrompt = rows[0]?.messages?.find(m => m.role === 'system')?.content;
if (datasetPrompt && datasetPrompt !== REQUEST_SYSTEM_PROMPT) {
  console.warn('Warning: the server prompt differs from the training-data prompt. The evaluation uses the server prompt (the one actually in use).');
}

// ---------- comparison ----------
const norm = v => (v === null || v === undefined) ? null : String(v).trim().toLowerCase().replace(/\s+/g, ' ');
const sameNum = (a, b) => (a === null || a === undefined) ? (b === null || b === undefined) : Number(a) === Number(b);

function parseAnswer(text) {
  if (typeof text !== 'string') return null;
  let t = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const j = JSON.parse(t.slice(a, b + 1));
    return j && Array.isArray(j.items) ? j : null;
  } catch { return null; }
}

function score(gold, pred) {
  const s = { json: !!pred, exact: false, count: false, fields: { item: [0, 0], supply_class: [0, 0], quantity: [0, 0], unit_of_measure: [0, 0] }, priority: false, deadline: false };
  for (const k of Object.keys(s.fields)) s.fields[k][1] = gold.items.length;
  if (!pred) return s;
  s.count = pred.items.length === gold.items.length;
  gold.items.forEach((g, i) => {
    const p = pred.items[i] || {};
    if (norm(p.item) === norm(g.item)) s.fields.item[0]++;
    if (norm(p.supply_class) === norm(g.supply_class)) s.fields.supply_class[0]++;
    if (sameNum(p.quantity, g.quantity)) s.fields.quantity[0]++;
    if (norm(p.unit_of_measure) === norm(g.unit_of_measure)) s.fields.unit_of_measure[0]++;
  });
  s.priority = norm(pred.priority) === norm(gold.priority);
  s.deadline = norm(pred.deadline) === norm(gold.deadline);
  // exact match: every field except the literal item name (a correct name can be worded differently; measured separately)
  s.exact = s.count && s.priority && s.deadline && Object.entries(s.fields).every(([k, [ok, n]]) => k === 'item' || ok === n);
  return s;
}

// ---------- model call ----------
async function ask(model, text) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  const t0 = Date.now();
  try {
    const r = await fetch(`${URL_BASE}/chat/completions`, {
      method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, temperature: TEMP, max_tokens: 512, stream: false, messages: [{ role: 'system', content: REQUEST_SYSTEM_PROMPT }, { role: 'user', content: text }] }),
    });
    const j = await r.json();
    return { text: j?.choices?.[0]?.message?.content ?? '', ms: Date.now() - t0, error: r.ok ? null : `HTTP ${r.status}` };
  } catch (e) {
    return { text: '', ms: Date.now() - t0, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally { clearTimeout(timer); }
}

async function checkServer() {
  try {
    const r = await fetch(`${URL_BASE}/models`);
    const ids = ((await r.json()).data || []).map(m => m.id);
    const missing = MODELS.filter(m => !ids.includes(m));
    if (missing.length) { console.error(`The server is up but these model names are missing: ${missing.join(', ')} (available: ${ids.join(', ')})`); process.exit(1); }
  } catch { console.error(`Model server not reachable at ${URL_BASE}. Start it first: bash scripts/start-ai.sh`); process.exit(1); }
}

// ---------- aggregation ----------
const pct = (a, b) => b ? `${(100 * a / b).toFixed(1)}%` : '—';
function summarize(results) {
  const n = results.length, sum = { n, json: 0, exact: 0, count: 0, priority: 0, deadline: 0, ms: 0, fields: { item: [0, 0], supply_class: [0, 0], quantity: [0, 0], unit_of_measure: [0, 0] }, by: {} };
  for (const r of results) {
    const s = r.score;
    sum.json += s.json; sum.exact += s.exact; sum.count += s.count; sum.priority += s.priority; sum.deadline += s.deadline; sum.ms += r.ms;
    for (const k in s.fields) { sum.fields[k][0] += s.fields[k][0]; sum.fields[k][1] += s.fields[k][1]; }
    for (const key of [`lang:${r.lang}`, `style:${r.style}`]) { const b = sum.by[key] ||= [0, 0]; b[0] += s.exact; b[1]++; }
  }
  return sum;
}

function confusions(results, field) {
  const c = {};
  for (const r of results) r.gold.items.forEach((g, i) => {
    const p = r.pred?.items?.[i]?.[field];
    if (norm(p) !== norm(g[field])) { const k = `${g[field]} ← ${p ?? (r.pred ? 'null' : 'invalid JSON')}`; c[k] = (c[k] || 0) + 1; }
  });
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 8);
}

// ---------- run ----------
await checkServer();
mkdirSync(OUT, { recursive: true });
const all = {};
for (const model of MODELS) {
  all[model] = [];
  console.log(`\n▶ ${model}: ${rows.length} examples`);
  for (const [i, row] of rows.entries()) {
    const user = row.messages.find(m => m.role === 'user').content;
    const gold = JSON.parse(row.messages.find(m => m.role === 'assistant').content);
    const a = await ask(model, user);
    const pred = parseAnswer(a.text);
    const rec = { id: row.id, lang: row.lang, style: row.style, input: user, gold, raw: a.text, pred, ms: a.ms, error: a.error, score: score(gold, pred) };
    if (GUARDS) { const g = applyGuards(user, pred); rec.guarded = g.out; rec.flagged = g.flagged; rec.asks = !!g.asks; rec.guardedScore = score(gold, g.out); }
    all[model].push(rec);
    process.stdout.write(`\r  ${i + 1}/${rows.length}`);
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
writeFileSync(join(OUT, `run-${stamp}.json`), JSON.stringify({ data: DATA, url: URL_BASE, models: MODELS, results: all }, null, 1));

const S = Object.fromEntries(MODELS.map(m => [m, summarize(all[m])]));
const head = `| Metric | ${MODELS.join(' | ')} |\n|---|${MODELS.map(() => '---:').join('|')}|`;
const line = (label, f) => `| ${label} | ${MODELS.map(m => f(S[m])).join(' | ')} |`;
const fieldNames = { item: 'Item name (exact text)', supply_class: 'Supply class', quantity: 'Quantity', unit_of_measure: 'Unit of measure' };
const keys = [...new Set(MODELS.flatMap(m => Object.keys(S[m].by)))].sort();

let md = `# Request-extraction evaluation\n\n- Data: \`${relative(root, DATA).split(sep).join('/')}\` (${rows.length} examples the model never trained on)\n- Server: ${URL_BASE} · Temperature ${TEMP} · same prompt as the server\n- Date: ${new Date().toLocaleString('sv-SE').slice(0, 16)}\n\n## Result\n\n${head}\n`;
md += line('**Exact match** (all fields except the item-name text)', s => `**${pct(s.exact, s.n)}**`) + '\n';
md += line('Valid JSON', s => pct(s.json, s.n)) + '\n';
md += line('Correct number of items', s => pct(s.count, s.n)) + '\n';
for (const k in fieldNames) md += line(fieldNames[k], s => pct(...s.fields[k])) + '\n';
md += line('Priority', s => pct(s.priority, s.n)) + '\n';
md += line('Deadline', s => pct(s.deadline, s.n)) + '\n';
md += line('Average response time', s => `${(s.ms / s.n / 1000).toFixed(1)} s`) + '\n';
if (GUARDS) {
  const G2 = m => { const r = all[m], n = r.length;
    const ok = r.filter(x => x.guardedScore.exact).length, flagged = r.filter(x => !x.guardedScore.exact && (x.flagged || x.asks)).length;
    const silent = r.filter(x => !x.guardedScore.exact && !x.flagged && !x.asks).length, falseFlags = r.filter(x => x.score.exact && x.flagged).length;
    return { n, ok, flagged, silent, falseFlags }; };
  const GS = Object.fromEntries(MODELS.map(m => [m, G2(m)]));
  md += `\n## After the server guardrails\n\nWhat actually reaches the user after automatic corrections and stops for confirmation (server/ai/request-evidence.mjs + the «not urgent» correction + catalog class).\n\n${head}\n`;
  md += `| **Correct request passes directly** | ${MODELS.map(m => `**${pct(GS[m].ok, GS[m].n)}**`).join(' | ')} |\n`;
  md += `| Error caught: the server asked the user or rejected | ${MODELS.map(m => pct(GS[m].flagged, GS[m].n)).join(' | ')} |\n`;
  md += `| **Error that passes unnoticed** | ${MODELS.map(m => `**${pct(GS[m].silent, GS[m].n)}**`).join(' | ')} |\n`;
  md += `| Correct request wrongly stopped by the guardrails | ${MODELS.map(m => `${GS[m].falseFlags}`).join(' | ')} |\n`;
  for (const m of MODELS) {
    const silent = all[m].filter(x => !x.guardedScore.exact && !x.flagged && !x.asks);
    if (silent.length && silent.length <= 30) {
      md += `\n<details><summary>${m}: errors that passed unnoticed (${silent.length})</summary>\n\n`;
      for (const r of silent) md += `- **${r.id}**: ${r.input}\n  - expected: \`${JSON.stringify(r.gold)}\`\n  - after guardrails: \`${JSON.stringify(r.guarded)}\`\n`;
      md += `\n</details>\n`;
    }
  }
}
md += `\n## Exact match by language and style\n\n${head.replace('Metric', 'Language / style (examples)')}\n`;
for (const k of keys) md += `| ${k} | ${MODELS.map(m => S[m].by[k] ? `${pct(...S[m].by[k])} (${S[m].by[k][1]})` : '—').join(' | ')} |\n`;
for (const m of MODELS) {
  md += `\n## Most common errors: ${m}\n\nFormat: expected ← model output\n`;
  for (const f of ['supply_class', 'unit_of_measure', 'quantity']) {
    const c = confusions(all[m], f);
    md += `\n**${f}:** ${c.length ? c.map(([k, v]) => `\`${k}\` (${v})`).join(' · ') : 'no errors'}\n`;
  }
  const pr = {}, dl = {};
  for (const r of all[m]) if (r.pred) {
    if (!r.score.priority) { const k = `${r.gold.priority} ← ${r.pred.priority}`; pr[k] = (pr[k] || 0) + 1; }
    if (!r.score.deadline) { const k = `${r.gold.deadline} ← ${r.pred.deadline}`; dl[k] = (dl[k] || 0) + 1; }
  }
  const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `\`${k}\` (${v})`).join(' · ') || 'no errors';
  md += `\n**priority:** ${top(pr)}\n\n**deadline:** ${top(dl)}\n`;
  const fails = all[m].filter(r => !r.score.exact).slice(0, 15);
  if (fails.length) {
    md += `\n<details><summary>Failed examples (${all[m].filter(r => !r.score.exact).length} in total, first 15)</summary>\n\n`;
    for (const r of fails) md += `- **${r.id}** (${r.style}): ${r.input}\n  - expected: \`${JSON.stringify(r.gold)}\`\n  - model: \`${r.pred ? JSON.stringify(r.pred) : (r.error || r.raw.slice(0, 200))}\`\n`;
    md += `\n</details>\n`;
  }
}
writeFileSync(join(OUT, 'report.md'), md);

console.log('\n\n' + head.split('\n')[0]);
console.log(line('Exact match', s => pct(s.exact, s.n)));
console.log(line('Supply class', s => pct(...s.fields.supply_class)));
console.log(line('Quantity', s => pct(...s.fields.quantity)));
console.log(line('Unit', s => pct(...s.fields.unit_of_measure)));
console.log(line('Priority', s => pct(s.priority, s.n)));
console.log(line('Deadline', s => pct(s.deadline, s.n)));
if (GUARDS) for (const m of MODELS) {
  const r = all[m], ok = r.filter(x => x.guardedScore.exact).length, silent = r.filter(x => !x.guardedScore.exact && !x.flagged && !x.asks).length;
  console.log(`After guardrails (${m}): correct ${pct(ok, r.length)} · errors passing unnoticed ${pct(silent, r.length)}`);
}
console.log(`\nReport: ${join(OUT, 'report.md')}`);
