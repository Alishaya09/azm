// التخطيط الافتراضي للخريطة وأدوات الرسم
// تخطيط الخريطة الافتراضي (مواقع تقريبية للعرض)
// النقاط الافتراضية تحمل labelKey فتتبع لغة الواجهة، والنقاط اللي يسميها المسؤول تحمل label
const defaultLayout = {
  nodes: [
    { id: 'hq-riyadh', type: 'hq', labelKey: 'map.hq', pos: [24.90, 46.72], code: 'AZM-HQ-001', fixed: true },
    { id: 'base', type: 'main', labelKey: 'map.base', pos: [24.71, 46.68] },
    { id: 'fsb-1', type: 'fsb', labelKey: 'map.fsbWest', pos: [23.4, 43.6] },
    { id: 'fsb-2', type: 'fsb', labelKey: 'map.fsbCenter', pos: [25.0, 46.0] },
    { id: 'fsb-3', type: 'fsb', labelKey: 'map.fsbSouth', pos: [20.5, 45.2] },
    { id: 'u-UNIT-01', type: 'unit', unitId: 'UNIT-01', pos: [22.3, 41.6] },
    { id: 'u-UNIT-02', type: 'unit', unitId: 'UNIT-02', pos: [25.25, 45.25] },
    { id: 'u-UNIT-03', type: 'unit', unitId: 'UNIT-03', pos: [17.6, 44.2] },
  ],
  links: [
    { id: 'l1', from: 'base', to: 'fsb-1', kind: 'road' }, { id: 'l2', from: 'fsb-1', to: 'u-UNIT-01', kind: 'road' },
    { id: 'l3', from: 'base', to: 'fsb-2', kind: 'road' }, { id: 'l4', from: 'fsb-2', to: 'u-UNIT-02', kind: 'road' },
    { id: 'l5', from: 'base', to: 'fsb-3', kind: 'road' }, { id: 'l6', from: 'fsb-3', to: 'u-UNIT-03', kind: 'road' },
    { id: 'l7', from: 'base', to: 'u-UNIT-03', kind: 'air' },
  ],
};
// التخطيط محفوظ على الخادم ومشترك بين الجميع، والمسؤول فقط يعدّله
// مفتاح التخزين المحلي القديم (قبل الحسابات) — يُرفع للخادم مرة واحدة إذا كان الخادم بلا تخطيط
const legacyLayoutKey = 'azm-map-layout';
// تخطيطات محفوظة قبل دعم اللغتين فيها أسماء عربية ثابتة للنقاط الافتراضية — نحوّلها لمفاتيح ترجمة
const legacyLabels = { 'القاعدة الرئيسية': 'map.base', 'مركز إمداد الغرب': 'map.fsbWest', 'مركز إمداد الوسط': 'map.fsbCenter', 'مركز إمداد الجنوب': 'map.fsbSouth', 'قاعدة جديدة': 'map.newBase', 'مركز إمداد جديد': 'map.newFsb' };
const normalizeLayout = v => v && Array.isArray(v.nodes) && Array.isArray(v.links)
  ? { ...v, nodes: v.nodes.map(n => n.label && legacyLabels[n.label] ? { ...n, label: undefined, labelKey: legacyLabels[n.label] } : n) }
  : { nodes: [], links: [] };
const takeLegacyLayout = () => { try { const v = JSON.parse(localStorage.getItem(legacyLayoutKey)); localStorage.removeItem(legacyLayoutKey); return v && v.nodes && v.links ? normalizeLayout(v) : null; } catch { return null; } };
const newId = p => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const nextUnitId = layout => { const max = layout.nodes.reduce((m, n) => n.unitId ? Math.max(m, Number(n.unitId.split('-')[1]) || 0) : m, 0); return `UNIT-${String(max + 1).padStart(2, '0')}`; };
// شعار القاعدة الرئيسية: صورة صاحب المشروع ملوّنة بلون النظام عبر CSS (12-roles-reports.css)
const MAIN_BASE_EMBLEM = '<span class="main-base-emblem" aria-hidden="true"></span>';
const mapIcon = (cls, text) => L.divIcon({ className: 'azm-icon', iconSize: [0, 0], html: `<div class="node ${cls}">${text}</div>` });
// myUnitId: للمستخدم العادي — الوحدات الأخرى تظهر على الخريطة بدون حالتها أو جاهزيتها
const hiddenUnit = (n, myUnitId) => myUnitId && n.unitId !== myUnitId;
const nodeIcon = (n, units, extra = '', myUnitId = null) => {
  if (n.type === 'unit') { const u = units.find(x => x.id === n.unitId); return mapIcon(`unit ${hiddenUnit(n, myUnitId) ? 'other' : u ? statusFor(u) : ''} ${n.unitId === myUnitId ? 'mine' : ''} ${extra}`, escapeHtml(n.unitId.slice(-2))); }
  return mapIcon(`${n.type} ${extra}`, n.type === 'hq' ? MAIN_BASE_EMBLEM : n.type === 'main' ? '★' : '▪');
};
const nodeName = (n, t) => n.type === 'unit' ? (n.label || (dict[`unit.${n.unitId}.name`] ? t(`unit.${n.unitId}.name`) : n.unitId)) : (n.label || t(n.labelKey));
const nodeLabel = (n, units, t, myUnitId = null) => {
  if (n.type !== 'unit') return nodeName(n, t);
  const u = units.find(x => x.id === n.unitId); if (!u) return nodeName(n, t);
  return hiddenUnit(n, myUnitId) ? unitName(t, u) : `${unitName(t, u)} — MCR ${mcr(u)}%`;
};
// خطوط الشبكة: خط ملوّن واضح فوق هالة متوهجة حتى تبان فوق صور القمر الصناعي
const linkStyle = {
  road: { color: '#4fc3ff', weight: 4, opacity: 1, className: 'azm-link' },
  air: { color: '#a78bfa', weight: 4, opacity: 1, dashArray: '10 7', className: 'azm-link' },
  pending: { color: '#4fc3ff', weight: 3, opacity: .9, dashArray: '4 7', className: 'azm-link' },
};
const linkGlow = { road: '#4fc3ff', air: '#a78bfa', pending: '#4fc3ff' };
const mapTools = ['main', 'fsb', 'unit', 'link', 'delete'];
