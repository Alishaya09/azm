// الحد بالكمية الصحيحة: المساحة الفارغة بعد حجز الوارد بالطريق والمعتمد بانتظار المباشرة. سماحية صغيرة لأخطاء الكسور الثنائية فقط.
// exceptId: طلب معتمد نستثني حجزه (عند مباشرة تنفيذه هو نفسه).
import { capacityOf, qtyOf } from './hierarchy.mjs';
import { inboundTo, reservedTo } from './state.mjs';

export const stockRoom = (node, resource, exceptId = null) => {
  const capacity = capacityOf(node)?.[resource] || 0, current = qtyOf(node.id, resource), inTransit = inboundTo(node.id)[resource] || 0, reserved = reservedTo(node.id, exceptId)[resource] || 0;
  return { resource, capacity, current, inTransit, reserved, room: Math.max(0, Math.floor(capacity - current - inTransit - reserved + 1e-7)) };
};
export const executionRoom = (node, resource, source = null, exceptId = null) => {
  const info = stockRoom(node, resource, exceptId);
  const available = source ? Math.max(0, Math.floor(qtyOf(source.id, resource) + 1e-7)) : null;
  return { ...info, available, limit: available === null ? info.room : Math.min(info.room, available) };
};
