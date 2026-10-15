// Stable report identifiers. Names can repeat; codes never get reused after archive.
import { state } from './db.mjs';

const entities = () => [...(state.layout?.nodes || []), ...Object.values(state.archivedEntities || {}).map(a => a.node).filter(Boolean)];
const numbers = (prefix, pool) => pool.map(n => n.code).filter(c => typeof c === 'string' && c.startsWith(prefix)).map(c => Number(c.slice(prefix.length))).filter(Number.isInteger);
export function nextEntityCode(type, baseId = null, pool = entities()) {
  if (type === 'hq') return 'AZM-HQ-001';
  if (type === 'main') return `AZM-B-${String(Math.max(0, ...numbers('AZM-B-', pool)) + 1).padStart(4, '0')}`;
  const base = pool.find(n => n.id === baseId), prefix = `${base?.code || baseId}-${type === 'fsb' ? 'P' : 'U'}-`;
  return `${prefix}${String(Math.max(0, ...numbers(prefix, pool)) + 1).padStart(3, '0')}`;
}
export function assignEntityCodes(nodes = []) {
  const pool = [...nodes, ...Object.values(state.archivedEntities || {}).map(a => a.node).filter(Boolean)];
  for (const type of ['main', 'fsb', 'unit']) for (const n of nodes.filter(n => n.type === type && !n.code)) n.code = nextEntityCode(type, n.baseId, pool);
}
