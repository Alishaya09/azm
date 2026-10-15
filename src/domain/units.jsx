// بيانات الوحدات والموارد ودوال الحالة (MCR، DOS)
// ===== الأصناف: من كتالوج الموارد في الخادم (القائد يديره) =====
// resources = الأصناف الفعّالة (المخزون والطلبات والنماذج)، allResources = كل الأصناف حتى المعطّلة (السجلات والتقارير).
// المصفوفتان تتحدثان في مكانهما من /api/state، فأي صنف جديد يظهر تلقائياً في كل الصفحات.
const resources = [];
const allResources = [...resources];
const setCatalog = list => { if (!Array.isArray(list)) return; allResources.splice(0, allResources.length, ...list); resources.splice(0, resources.length, ...list.filter(c => c.active)); };
const resDefOf = key => allResources.find(r => r.key === key);
const assignedResources = u => Array.isArray(u?.allowedResources) ? u.allowedResources : [];
// سياسة الموارد التشغيلية من الخادم (/api/state → policy): الغذاء بحسب الأفراد + نوع وقود واحد لكل وحدة
const resourcePolicy = { food: [], fuel: [] };
const setResourcePolicy = p => { if (p && Array.isArray(p.food) && Array.isArray(p.fuel)) Object.assign(resourcePolicy, { food: p.food, fuel: p.fuel }); };
const isFuelKey = key => resourcePolicy.fuel.includes(key);
// الأصناف التشغيلية للوحدة الآن (تُطلب وتُستهلك بالمحاكاة) — نفس حساب الخادم unitOperationalKeys
const unitResources = u => resources.filter(r => assignedResources(u).includes(r.key));
const unitConsumables = u => unitResources(u).filter(r => r.usage === 'consumable' && Number(r.weight) > 0);
// أصناف مخصصة من السياسة السابقة: تُعرض برصيدها للقراءة والمراجعة فقط
const unitLegacyResources = u => allResources.filter(r => assignedResources(u).includes(r.key) && !unitResources(u).some(x => x.key === r.key));
// Historical balances stay visible if a commander disabled a resource. Only
// active resources above participate in new requests and simulated use.
const unitVisibleResources = u => allResources.filter(r => assignedResources(u).includes(r.key));
// اللغة الحالية لأسماء الأصناف (تتحدث من App)
let CURRENT_LANG = 'ar';
// اسم الصنف ووحدة قياسه: من الكتالوج، وإلا من القاموس (الأصناف الأصلية)
const resName = (t, key) => { const d = resDefOf(key); return d?.name ? d.name[CURRENT_LANG] || d.name.en : (dict[`res.${key}`] ? t(`res.${key}`) : key); };
const resUnitName = (t, key) => { const d = resDefOf(key); return d?.unit ? d.unit[CURRENT_LANG] || d.unit.en : (dict[`resUnit.${key}`] ? t(`resUnit.${key}`) : ''); };
const resIcon = key => resDefOf(key)?.icon || '📦';

// القيم الابتدائية للوحدات الثلاث الأولى — الوحدات اللي يضيفها المسؤول من الخريطة تاخذ newUnitDefaults
const initialUnits = [
  { id: 'UNIT-01', people: 850, vehicles: 45, optempo: 'medium' },
  { id: 'UNIT-02', people: 620, vehicles: 120, optempo: 'low' },
  { id: 'UNIT-03', people: 1200, vehicles: 80, optempo: 'high' },
];
const newUnitDefaults = { people: 500, vehicles: 40, optempo: 'medium' };
const unitDefaults = id => initialUnits.find(u => u.id === id) || { id, ...newUnitDefaults };

// التبويبات: [المعرّف، الأيقونة، الأدوار المسموحة (بدونها = الكل)]
// الأدوار: admin = القائد الرئيسي، base_manager = مسؤول القاعدة، user = مسؤول الوحدة
const tabs = [['dashboard', '📊'], ['databases', '🗄️'], ['inventory', '📦'], ['routes', '🛣️', ['admin', 'base_manager']], ['log', '📋'], ['reports', '📈'], ['catalog', '🧾', ['admin']], ['users', '👥', ['admin', 'base_manager']]];
const isCommander = me => me?.role === 'admin';
// قرار الطلب (موافقة/رفض/وسيلة/إعادة مراجعة): القائد وحده (الخادم يتحقق أيضاً)
const canDecide = me => me?.role === 'admin' || me?.role === 'base_manager';
// مباشرة تنفيذ قرار القائد: مسؤول قاعدة الوحدة فقط
const canExecute = (me, r) => r?.kind !== 'base' && (me?.role === 'admin' || me?.role === 'base_manager' && !!me.baseId && r?.baseId === me.baseId);

// أدنى نسبة بين الأصناف الفعّالة (الحالة و DOS)
const minLevel = u => { const items=unitConsumables(u); return items.length ? Math.min(...items.map(r=>u[r.key]??0)) : 0; };
const statusFor = u => minLevel(u) < 25 ? 'critical' : minLevel(u) < 50 ? 'warning' : 'ready';
// MCR مؤشر عرض مبني على الأصناف الاستهلاكية النشطة ذات معدل موجب.
const mcr = u => { const keys = unitConsumables(u); return Math.round(keys.length ? keys.reduce((n,r)=>n+(u[r.key]??0),0)/keys.length : minLevel(u)); };
const dos = u => Math.max(0, minLevel(u) / (u.optempo === 'high' ? 34 : u.optempo === 'medium' ? 22 : 14)).toFixed(1);
// اسم الوحدة: الاسم اللي كتبه المسؤول، وإلا الاسم المترجم للوحدات الافتراضية
const unitName = (t, u) => u.label || (dict[`unit.${u.id}.name`] ? t(`unit.${u.id}.name`) : u.id);
const unitSector = (t, u) => dict[`unit.${u.id}.sector`] ? t(`unit.${u.id}.sector`) : '';
const nameById = (t, units, id) => { const u = units.find(x => x.id === id); return u ? unitName(t, u) : (id || ''); };
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtHours = h => h == null ? '—' : `${h.toFixed(1)}h`;
