// كتالوج الموارد:
//   GET  /api/catalog          للجميع (الواجهة تبني منه المخزون والطلبات والتقارير)
//   POST /api/catalog          إضافة صنف — القائد فقط
//   PUT  /api/catalog/:key     تعديل الاسم ووحدة القياس والسعات والاستهلاك والتفعيل — القائد فقط
// ما فيه حذف: الصنف يُعطّل (active: false) وتبقى سجلاته وحركاته وتقاريره.
// تغيير السعة ما يقص أي رصيد موجود: إذا صار الرصيد فوق السعة الجديدة يبقى كما هو، ويُمنع أي وارد جديد لين ينزل.
import { readBody, send } from '../lib/http.mjs';
import { advanceSim, saveState, state, unitIds } from '../store/state.mjs';
import { catalog, cleanCatalogItem, resDef, trainingCatalog, trainingItem, syncAllUnitResources } from '../store/catalog.mjs';
import { layoutNodes, qtyOf, setQty, unitAllows } from '../store/hierarchy.mjs';
import { flushConsumption } from '../store/ledger.mjs';

export async function handleCatalog({ req, res, path, method, me, isAdmin, forbidden }) {
  if (!path.startsWith('/api/catalog')) return false;
  if (path === '/api/catalog' && method === 'GET') return send(res, 200, me.role === 'user' ? catalog().filter(c => unitAllows(me.unitId, c.key)) : catalog());
  if (!isAdmin) return forbidden();
  if (path === '/api/catalog/import-training' && method === 'POST') {
    let count = 0;
    for (const row of trainingCatalog()) {
      if (resDef(row.key)) continue;
      const candidate = trainingItem(row);
      const result = cleanCatalogItem(candidate, null, unitIds());
      if (result.error) return send(res, 400, { ...result, item: row.item });
      state.catalog.push({ ...result.item, createdAt: Date.now(), createdBy: me.username });
      count++;
    }
    if (count) { syncAllUnitResources(); state.layoutVersion++; saveState(); }
    return send(res, 200, { added: count, total: trainingCatalog().length, catalog: catalog() });
  }
  if (path === '/api/catalog' && method === 'POST') {
    const r = cleanCatalogItem(await readBody(req), null, unitIds());
    if (r.error) return send(res, 400, r);
    advanceSim();
    state.catalog.push({ ...r.item, createdAt: Date.now(), createdBy: me.username });
    syncAllUnitResources(); state.layoutVersion++;
    saveState(); return send(res, 200, r.item);
  }
  const m = path.match(/^\/api\/catalog\/([a-z][a-z0-9_]{1,23})$/);
  if (m && method === 'PUT') {
    const cur = resDef(m[1]); if (!cur) return send(res, 404, { error: 'not_found' });
    const r = cleanCatalogItem(await readBody(req), cur, unitIds());
    if (r.error) return send(res, 400, r);
    // رصيد الوحدة محفوظ كنسبة من سعتها؛ نثبّت الكمية الفعلية حتى لا يغيّر تعديل السعة أي رصيد دون حركة.
    advanceSim();
    flushConsumption();
    const units = layoutNodes().filter(n => n.type === 'unit'), balances = units.map(n => [n.id, qtyOf(n.id, cur.key)]);
    Object.assign(cur, r.item, { updatedAt: Date.now(), updatedBy: me.username });
    for (const [id, qty] of balances) setQty(id, cur.key, qty);
    syncAllUnitResources(); state.layoutVersion++;
    saveState(); return send(res, 200, cur);
  }
  return false;
}
