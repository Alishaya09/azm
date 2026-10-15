// ثوابت ودوال مساعدة لطلبات الإمداد
const PRIORITIES = ['normal', 'urgent', 'emergency'];
const priorityIcon = { normal: '⚪', urgent: '🟠', emergency: '🔴' };
const fmtDateTime = ms => ms ? new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

// السعة التقديرية لكل مورد حسب حجم الوحدة — نستخدمها لتحويل النسبة إلى كمية فعلية (طلقة، لتر، حصة، وحدة)
// السعة الرسمية تجي من الخادم (inventory) إذا متوفرة، وإلا نفس معادلة الخادم
const capacityOf = (u, key) => { if (u.capacity?.[key] != null) return u.capacity[key]; const d = resDefOf(key); if (!d) return 0; return Math.round((d.unitBasis === 'fixed' ? 1 : Number(u[d.unitBasis]) || 0) * (Number(d.unitFactor) || 0)); };
// النسبة المتاحة للطلب = السعة − الرصيد − الشحنات بالطريق، مقرّبة لأسفل لأقرب 5% (الخادم يتحقق بنفس الحساب)
const roomPct = (u, key) => { const cap = capacityOf(u, key); return cap ? Math.max(0, (cap - cap * (u[key] || 0) / 100 - (u.inTransit?.[key] || 0)) / cap * 100) : 0; };
const maxAmount = (u, key) => Math.min(100, Math.floor(roomPct(u, key) / 5) * 5);
// المساحة بالكمية الفعلية في الوحدة (السعة − الرصيد − بالطريق) + تفاصيلها للعرض
// reserved = كميات وافق عليها القائد ولم يباشرها مسؤول القاعدة بعد (محجوزة من السعة، ليست بالطريق). exceptId يستثني طلباً بعينه.
const roomInfo = (u, key, exceptReserved = 0) => { const capacity = capacityOf(u, key), current = u.qty?.[key] ?? capacity * (u[key] || 0) / 100, inTransit = u.inTransit?.[key] || 0, reserved = Math.max(0, (u.reserved?.[key] || 0) - exceptReserved); return { capacity, current, inTransit, reserved, room: Math.max(0, Math.floor(capacity - current - inTransit - reserved + 1e-7)) }; };
const depotRoomInfo = (id, key, depots, inventory, type='main') => {
  const capacity=inventory[id]?.capacity?.[key]??depotCapOf(type)[key]??0, current=depots[id]?.[key]||0, inTransit=inventory[id]?.inTransit?.[key]||0, reserved=inventory[id]?.reserved?.[key]||0;
  return {capacity,current,inTransit,reserved,room:Math.max(0,Math.floor(capacity-current-inTransit-reserved+1e-7))};
};
function StockRoomSummary({info,resource}) {
  const {t}=useLang(), number=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:3});
  return <small className="stock-room-summary" dir="auto">{t('stock.roomSummary',{cur:number(info.current),cap:number(info.capacity),tr:number(info.inTransit),room:fmtQty(info.room),unit:resUnitName(t,resource)})}{info.reserved>0?` · ${t('stock.reserved',{n:number(info.reserved)})}`:''}</small>;
}
// مرحلة الطلب الحالية والخطوة التالية — نص واحد واضح لكل الأدوار (لا يوحي بإرسال قبل المباشرة)
const requestStage = r => r.stalled ? 'stalled' : r.status === 'pending' ? (r.mode === 'heli' && (r.history || []).some(h => h.note === 'mode_heli') ? 'pending_heli' : 'pending') : r.status === 'assigned' ? (r.executionBlocked ? 'assigned_blocked' : 'assigned') : r.status;
function RequestStage({ r, me, simClock = null, paused = false }) {
  const { t } = useLang();
  const stage = requestStage(r), who = me?.role === 'admin' ? 'admin' : canExecute(me, r) ? 'executor' : 'viewer';
  const progress = r.status === 'approved' && !r.stalled && simClock ? Math.round(convoyProgress(r, simClock()) * 100) : null;
  return <div className={`req-stage stage-${stage}`} data-stage={stage}>
    <b>{t(`stage.${stage}`)}{progress != null ? ` · ${progress}%` : ''}</b>
    <small>{t(`stage.${stage}.next.${who}`)}</small>
    {r.status === 'approved' && paused && <small className="stage-paused">⏸ {t('sim.pausedConvoy')}</small>}
    {r.legacyPolicy && <small className="stage-legacy">⚠ {t('policy.legacyRequest')}</small>}
  </div>;
}
function FillQuantity({value,onChange,info,resource,disabled=false}) {
  const {t}=useLang(), limit=info.limit??info.room, displayed=value===null?limit:(value??'');
  return <div className="fill-quantity"><input type="number" min="1" max={limit} step="1" dir="ltr" className="qty-input" aria-label={resName(t,resource)} disabled={disabled||limit<=0} value={displayed} onChange={e=>onChange(e.target.value)}/><button type="button" className={value===null?'fill active':'fill'} disabled={disabled||limit<=0} onClick={()=>onChange(null)}>{t('stock.fill')}</button></div>;
}
const fmtQty = n => Math.round(n).toLocaleString('en-US');
// الطلبات القديمة فيها مورد واحد؛ الجديدة فيها قائمة مواد
const reqItems = r => r.items?.length ? r.items : [{ resource: r.resource, amount: r.amount ?? 70, level: r.level }];
const defaultAmount = (level, max = 100) => Math.max(Math.min(5, max), Math.min(max, Math.floor((100 - level) / 5) * 5));
