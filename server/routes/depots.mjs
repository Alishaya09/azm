// المستودعات (قواعد بيانات القواعد ومراكز الإمداد):
//   POST /api/depots/:id/transfer  تحويل فوري بين مستودعين — القائد (أي مستودعين؛ بين قاعدتين بسبب مسجّل)،
//                                  ومسؤول القاعدة بين مستودعات قاعدته فقط.
//   POST /api/inventory/add        إضافة مخزون خارجي لقاعدة (عدة موارد، بسبب/مرجع) — القائد فقط.
//   POST /api/depots/:id/restock   الصيغة القديمة للإضافة الخارجية (مورد واحد) — القائد فقط.
// كل عملية تمر بسجل الحركات (ledger) ويُحفظ معها المنفّذ والوقت والرصيد قبل وبعد.
import { cleanText, readBody, send } from '../lib/http.mjs';
import { addLog, saveState, state } from '../store/state.mjs';
import { activeKeys, isActiveResource } from '../store/catalog.mjs';
import { baseIdOf, depotOf, isDepotNode, nodeById, qtyAll, qtyOf } from '../store/hierarchy.mjs';
import { applyMovement, nextOpId, supplyBase } from '../store/ledger.mjs';
import { stockRoom, executionRoom } from '../store/limits.mjs';

const validQty = q => Number.isInteger(q) && q > 0 && q <= 10_000_000;
// المساحة = السعة − الرصيد − الشحنات المعتمدة المتجهة له (ما نقص أي رصيد موجود لو صار فوق سعة جديدة أقل)
const capInfo = stockRoom;

// إضافة خارجية لقاعدة: كل المواد تُفحص أولاً، ثم تُطبّق كلها أو ولا وحدة
function externalAdd(res, me, base, items, reason, operationKey = null) {
  const signature = JSON.stringify({ baseId: base.id, items, reason }), key = operationKey ? `${me.username}:${operationKey}` : null;
  const previous = key && state.supplyOperations?.[key];
  if (previous) return previous.signature === signature ? send(res, 200, previous.result) : send(res, 400, { error: 'bad_request' });
  items = items.map(i=>({resource:i.resource,qty:i.fill===true?capInfo(base,i.resource).room:i.qty}));
  if (items.some(i=>!validQty(i.qty))) return send(res,400,{error:'invalid_quantity'});
  const over = items.map(i => ({ ...capInfo(base, i.resource), qty: i.qty })).filter(i => i.qty > i.room);
  if (over.length) return send(res, 409, { error: 'over_capacity', room: over[0].room, rooms: over });
  const before = qtyAll(base.id);
  const { opId, movements } = supplyBase({ baseId: base.id, items, by: me.username, reason });
  const result = { opId, baseId: base.id, before, after: qtyAll(base.id), movements, depots: { [base.id]: { ...depotOf(base) } } };
  if (key) (state.supplyOperations ||= {})[key] = { signature, result };
  addLog('restock', `${base.id} · ${items.map(i => `${i.resource} +${i.qty}`).join(' · ')}`, me.username, { baseIds: [base.id] }); saveState();
  return send(res, 200, result);
}

export async function handleDepots({ req, res, path, method, me, isAdmin, scope, forbidden }) {
  if (path === '/api/inventory/add' && method === 'POST') {
    if (!isAdmin) return forbidden();
    const b = await readBody(req), base = nodeById(b.baseId);
    if (!base || base.type !== 'main') return send(res, 400, { error: 'invalid_target' });
    const items = Array.isArray(b.items) ? b.items.map(i => ({ resource: i?.resource, qty: i?.qty, ...(i?.fill !== undefined ? {fill:i.fill} : {}) })) : [];
    if (!items.length || items.length > activeKeys().length || !items.every(i => isActiveResource(i.resource) && (i.fill===undefined||typeof i.fill==='boolean') && (i.fill===true||validQty(i.qty))) || new Set(items.map(i => i.resource)).size !== items.length) return send(res, 400, { error: 'invalid_quantity' });
    const reason = cleanText(b.reason, 300);
    if (!reason) return send(res, 400, { error: 'reason_required' });
    if (b.operationKey !== undefined && (typeof b.operationKey !== 'string' || !/^[A-Za-z0-9_-]{3,64}$/.test(b.operationKey))) return send(res, 400, { error: 'bad_request' });
    return externalAdd(res, me, base, items, reason, b.operationKey || null);
  }

  const m = path.match(/^\/api\/depots\/([A-Za-z0-9_-]+)\/(transfer|restock)$/);
  if (!m || method !== 'POST') return false;
  if (scope.role === 'user') return forbidden();
  const from = nodeById(m[1]);
  if (!isDepotNode(from)) return send(res, 404, { error: 'not_found' });
  if (!scope.depotIds.has(from.id)) return forbidden();
  const b = await readBody(req);
  if (b.refill !== undefined && typeof b.refill !== 'boolean') return send(res, 400, { error: 'bad_request' });
  if (b.refill === true && (typeof b.operationKey !== 'string' || !/^[A-Za-z0-9_-]{3,64}$/.test(b.operationKey))) return send(res, 400, { error: 'bad_request' });
  if (b.operationKey !== undefined && (typeof b.operationKey !== 'string' || !/^[A-Za-z0-9_-]{3,64}$/.test(b.operationKey))) return send(res,400,{error:'bad_request'});
  if ((m[2] === 'restock' || !Array.isArray(b.items)) && (!isActiveResource(b.resource) || (b.fill!==undefined&&typeof b.fill!=='boolean') || (b.fill!==true&&!validQty(b.qty)))) return send(res, 400, { error: 'invalid_quantity' });

  // استلام إمداد خارجي (الصيغة القديمة) — القائد فقط، وللقواعد الرئيسية فقط
  if (m[2] === 'restock') {
    if (!isAdmin) return forbidden();
    if (from.type !== 'main') return send(res, 400, { error: 'restock_main_only' });
    const reason = cleanText(b.reason, 300);
    if (!reason) return send(res, 400, { error: 'reason_required' });
    return externalAdd(res, me, from, [{ resource: b.resource, qty: b.qty, ...(b.fill===true?{fill:true}:{}) }], reason);
  }

  // تحويل فوري بين مستودعين
  const to = nodeById(b.to);
  if (!isDepotNode(to) || to.id === from.id) return send(res, 400, { error: 'invalid_target' });
  if (!scope.depotIds.has(to.id)) return forbidden();
  if (b.refill === true && (to.type !== 'fsb' || from.type !== 'main' || to.baseId !== from.id)) return send(res, 400, { error: 'invalid_target' });
  const crossBase = baseIdOf(from) !== baseIdOf(to), reason = cleanText(b.reason, 300);
  // بين قاعدتين مختلفتين: للقائد فقط (مسؤول القاعدة ما يشوف إلا مستودعات قاعدته أصلاً) وبسبب مسجّل
  if (crossBase && !isAdmin) return forbidden();
  if (crossBase && !reason) return send(res, 400, { error: 'cross_base_reason_required' });
  const batch = Array.isArray(b.items);
  if (batch && (typeof b.operationKey !== 'string' || !/^[A-Za-z0-9_-]{3,64}$/.test(b.operationKey))) return send(res,400,{error:'bad_request'});
  const requested = batch ? b.items.map(i=>({resource:i?.resource,qty:i?.qty})) : [{resource:b.resource,...(b.fill===true?{fill:true}:{qty:b.qty})}];
  // إعادة نفس المفتاح تُفحص قبل حساب «ملئ»: البصمة من الحمولة المرسلة، فتعود النتيجة المحفوظة حتى لو امتلأت الوجهة بعدها
  const key = b.operationKey ? `${me.username}:transfer:${b.operationKey}` : null;
  const signature = JSON.stringify({from:from.id,to:to.id,items:requested,reason});
  const previous = key && state.supplyOperations?.[key];
  if (previous) return previous.signature===signature ? send(res,200,previous.result) : send(res,400,{error:'bad_request'});
  const items = batch ? requested : [{resource:b.resource,qty:b.fill===true?executionRoom(to,b.resource,from).limit:b.qty}];
  if (!items.length || items.length>activeKeys().length || new Set(items.map(i=>i.resource)).size!==items.length || items.some(i=>!isActiveResource(i.resource)||!validQty(i.qty))) return send(res,400,{error:'invalid_quantity'});
  if (![from,to].every(n=>nodeById(baseIdOf(n))?.type==='main')) return send(res,400,{error:'invalid_target'});
  const failures = items.flatMap(i=>{
    const info=capInfo(to,i.resource), available=Math.floor(qtyOf(from.id,i.resource));
    const error = info.capacity<=0 ? 'invalid_target' : i.qty>available ? 'insufficient_stock' : i.qty>info.room ? 'over_capacity' : null;
    return error ? [{...info,qty:i.qty,available,error}] : [];
  });
  if(failures.length) return send(res,409,{error:failures[0].error,failures,rooms:failures});
  // الفحص والتطبيق والحفظ متتابعة بلا انتظار يمنح عملية أخرى فرصة للتداخل.
  const opId = nextOpId('TR');
  const movements=items.map(i=>applyMovement({type:'transfer',resource:i.resource,qty:i.qty,fromId:from.id,toId:to.id,by:me.username,reason:reason||null,opId}));
  const result={opId,movement:movements[0],movements,depots:{[from.id]:{...depotOf(from)},[to.id]:{...depotOf(to)}}};
  if(key) (state.supplyOperations ||= {})[key]={signature,result};
  addLog('transfer', `${from.id} → ${to.id} · ${items.map(i=>`${i.resource} ${i.qty}`).join(' · ')}`,me.username,{baseIds:[...new Set([baseIdOf(from),baseIdOf(to)])]}); saveState();
  return send(res,200,result);
}
