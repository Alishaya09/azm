# دليل التطوير — عَزْم | AZM

إرشادات عملية لتعديل المشروع وإضافة مزايا بدون ما يتأثر شي.

> ## ⛔ الواجهة مجمّدة
> بقرار صاحب المشروع، **الواجهة والتصميم ثابتان نهائياً**: ممنوع تعديل أو إضافة أو حذف أي ملف في `index.html` أو `src/` (الصفحات، التنسيقات، النصوص والترجمات، الصور). أقسام هذا الدليل الخاصة بالواجهة (إضافة صفحة، نص مترجم…) **للفهم فقط**.
> `node scripts/check.mjs` يفشل تلقائياً عند أي تغيير في الواجهة. التعديل المسموح: الخادم والتوثيق والاختبارات وإعداد الذكاء الاصطناعي، بشرط أن يبقى كل شيء يعمل مع الواجهة الحالية كما هي.

---

## قواعد مهمة

1. **ملفات الواجهة ما تستخدم `import`.** كل ملف في `src/` يتحمّل من `index.html` بالترتيب، وكلها تتشارك نفس النطاق.
   - **ملف جديد:** أضف له سطر `<script type="text/babel" ...>` في `index.html` قبل `App.jsx`.
   - **الأسماء:** ممنوع تعريف نفس الاسم (`const` أو `function`) في ملفين، لأنه يوقف الصفحة.
2. **أي نص يظهر للمستخدم يكون مترجم.** أضفه في `src/i18n/translations.jsx` بالعربي والإنجليزي، واستخدمه بـ `t('key')`.
3. **الصلاحيات تُفرض في الخادم.** إخفاء زر في الواجهة ما يكفي. أي إجراء للمسؤول لازم يتحقق من `isAdmin` في `server/routes/`.
4. **الخادم يحتاج إعادة تشغيل** بعد أي تعديل في `server.mjs` أو `server/` أو `.env`. ملفات `src/` يكفيها تحديث الصفحة.
5. **شغّل `npm test` بعد أي تعديل في الخادم.**
6. **كل طلب API يمر من `api()` في `src/core/api.jsx`.** ترسل هوية التبويب بـ`X-Azm-Tab`؛ لا تستخدم `fetch` مباشر لمسارات `/api/` في مكونات الواجهة ولا تحفظ رموز جلسات في JavaScript. اتصال الأحداث وحده تديره `watchAzmState` في الملف المركزي نفسه، بالترويسة والكوكي الخاصين بالتبويب. اختبر الجلسات بثلاث تبويبات عادية تشترك في مخزن كوكي واحد عبر `node scripts/ui-smoke.mjs`، وليس بثلاث سياقات متصفح معزولة فقط؛ ويغطي الاختبار التعبئة ومعالجة الطلب الأصلي من الخريطة أيضاً.

## إضافة نص مترجم

```js
// src/i18n/translations.jsx — داخل dict
'inv.export': ['تصدير', 'Export'],
'inv.count': ['{n} وحدة', '{n} units'],
```

```jsx
const { t } = useLang();
<button>{t('inv.export')}</button>
<small>{t('inv.count', { n: units.length })}</small>
```

## إضافة صفحة جديدة

1. أنشئ `src/pages/MyPage.jsx`:
   ```jsx
   // صفحة ...
   function MyPage({ units }) {
     const { t } = useLang();
     return <div className="page-pad"><div className="page-heading"><h2>{t('tab.mypage')}</h2></div>…</div>;
   }
   ```
2. أضفها في `index.html` قبل `App.jsx`.
3. أضف التبويب في `tabs` داخل `src/domain/units.jsx`. العنصر الثالث `'admin'` يخليه للمسؤول فقط:
   ```js
   ['mypage', '🧭'],
   ```
4. أضف الترجمة `'tab.mypage': ['صفحتي', 'My Page']`.
5. في `src/App.jsx` أضف السطر هذا داخل `<main className="workspace">`:
   ```jsx
   {tab==='mypage'&&<MyPage units={visible}/>}
   ```

## الصلاحيات والمخزون (لأي ميزة جديدة)

- النطاق من `ctx.scope` (`server/store/scope.mjs`): `scope.all` للقائد، و `entityIds` / `depotIds` / `unitIds` / `baseIds` للنطاق. فلتر البيانات قبل الإرسال، وما تعتمد على أي دور أو معرّف من المتصفح.
- أي تغيير على رصيد قاعدة أو مركز أو وحدة لازم يمر بـ `applyMovement` (`server/store/ledger.mjs`) حتى ينحفظ في سجل الحركات والتقارير.
- التحويل بين النسبة والكمية للوحدات: `qtyOf` / `setQty` / `requiredQty` في `server/store/hierarchy.mjs` فقط.

## إضافة نقطة API

1. أضف معالج في ملف مناسب داخل `server/routes/`، أو أنشئ ملف جديد:
   ```js
   export async function handleReports({ req, res, path, method, me, isAdmin, forbidden }) {
     if (path === '/api/reports/summary' && method === 'GET') {
       if (!isAdmin) return forbidden();
       return send(res, 200, { /* ... */ });
     }
     return false; // مو لي — خلّ الموجّه يجرب المعالج اللي بعدي
   }
   ```
2. سجّله في `protectedHandlers` داخل `server/routes/index.mjs`.
3. من الواجهة: `api('/api/reports/summary').then(...)`.
4. أضف حالة اختبار في `scripts/smoke-test.mjs`.

## تعديل المحاكاة

كل الأرقام في `server/config.mjs`:

| الثابت | الوظيفة |
|---|---|
| `UNIT_START` | المخزون الابتدائي للوحدات الافتراضية |
| `OPTEMPO_RATE` و `RESOURCE_WEIGHT` | سرعة الاستهلاك |
| `THRESHOLDS` | حدود التنبيهات |
| `SPEEDS` | سرعات المحاكاة المسموحة |

وإذا غيّرت أسماء الحالات أو الحدود، حدّث `statusFor` في `src/domain/units.jsx`.

## تغيير مزوّد الخرائط أو الطرق

| تبي تغيّر | المكان |
|---|---|
| طبقات الخريطة | `src/map/TacticalMap.jsx` (`L.tileLayer(...)`) |
| خدمة الطرق | `fetchRoadRoute` في `src/domain/routing.jsx` |

لشبكة مغلقة: استضف خادم Tiles وخادم OSRM داخلياً وغيّر الروابط.

## الاختبار

| الاختبار | الطريقة |
|---|---|
| اختبار الخادم | `npm test` يشغّل خادم مؤقت ببيانات مؤقتة ويختبر كل الوظائف |
| المساعد الذكي | `npm run mock-llm` (شوف [AI_INTEGRATION.md](AI_INTEGRATION.md)) |

## قبل ما تعتبر التعديل خلص

```bash
node scripts/check.mjs        # صياغة + JSX + ترجمة + أسماء مكررة
node scripts/smoke-test.mjs   # اختبار الخادم كامل على بيانات مؤقتة
```

الاثنين لازم يطبعون `All checks passed`.
