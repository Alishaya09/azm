# مرجع الـ API — عَزْم | AZM

## سياسة دورة التشغيل الحالية

إنشاء `main` عبر `/api/entities` أو `/api/layout` يبدأ دفتره بصفر ثم يسجل `external_add` لكل صنف نشط من `hq-riyadh` إلى سعة القاعدة، بسبب `base_initial_fill` وبرقم عملية مشترك. إنشاء `fsb` يفحص كل أصناف قاعدته قبل الخصم ثم يحولها كاملة أو يرفض الإنشاء كله. إنشاء `unit` يخصص كل الأصناف النشطة تلقائياً ويبدأ بصفر؛ لا يوجد اختيار وقود أو تخصيص يدوي في الواجهة. التكرار بنفس `operationKey` يعيد النتيجة دون حركة ثانية. صلاحيات القرار والإرسال الحالية لمسؤول القاعدة والقائد محفوظة.

تضيف `/api/state` و`/api/reports` الحقل `operationCycle` (أو `null` للدورات السابقة)؛ يحمله دليل شرح التقارير ومسارات شات التقارير أيضاً. لا يوجد API للتنظيف: أداة [البداية الجديدة](NEW_CYCLE.md) تعمل فقط خارج الخادم بعد توقفه ونسخة كاملة.

## واجهات النموذج الجديدة

كلها تتطلب جلسة صالحة، ونطاق المستخدم يُحسب في الخادم:

| المسار | الاستخدام |
|---|---|
| `GET /api/ai/request-schema` | عقد JSON للدالة `extract_supply_request` |
| `POST /api/ai/request-draft` | `{text,unitId?}` → مسودة أصناف وكميات بعد التحقق والتحويل لوحدة التخزين؛ لا ينشئ طلباً |
| `GET /api/report-ai/status` | حالة اتصال نموذج التقارير المستقل، و`rag:{state,connected,source,chunks,model?}` حيث `state` هو `local_ready` أو `external_connected` (BGE-M3) أو `external_unavailable` (احتياط محلي) |
| `GET /api/report-chats` | محادثات تقارير هذا المستخدم |
| `POST /api/report-chats` | `{text,language}` → محادثة جديدة بتقرير حديث مفلتر |
| `GET /api/report-chats/:id` | محادثة التقارير الخاصة بالمستخدم |
| `POST /api/report-chats/:id/messages` | سؤال متابعة بتقرير جديد |
| `DELETE /api/report-chats/:id` | حذف محادثة التقارير الخاصة به (المسارات باقية للتوافق؛ صفحتها أزيلت من الواجهة) |
| `GET /api/ops-reports` | تقارير العمليات الذكية لهذا المستخدم: `{id,title,updatedAt,createdAt,count,selection,total}` |
| `POST /api/ops-reports` | تقرير جديد من سجل العمليات: `{ids:[…≤100]}` لعملية أو عمليات محددة، أو `{filters:{from,to,entityId,type,resource,actor,search}}` لفترة وفلاتر، مع `focus?` و`language`. العمليات من نفس سجل `/api/audit` بنطاق الجلسة (المحادثات الخاصة مستثناة)، ومقصورة دائماً على `requests` و`dispatch` و`delivery` (أي `type` آخر في الفلاتر → `400 bad_request`). رقم خارج النطاق → `403 out_of_scope`، تحديد فارغ → `400 no_operations`. الرد: التقرير مع `stats` (الإجماليات حسب النوع والمورد والجهة والمنفذ) ورسالة النموذج، أو `kind: not_connected/ai_error` مع بقاء الأرقام |
| `GET /api/ops-reports/:id` | تقرير محفوظ لصاحبه فقط |
| `POST /api/ops-reports/:id/messages` | `{text,language}` → سؤال لاحق؛ تُعاد قراءة العمليات بنطاق الجلسة الحالي |
| `DELETE /api/ops-reports/:id` | حذف تقرير محفوظ |
| `POST /api/catalog/import-training` | للتوافق القديم؛ الأصناف الأربعون تُضاف تلقائياً مفعّلة عند الترحيل، وتخصيصها للوحدة إجراء مستقل للقائد |

مسودة النموذج ترجع `draft.items[]` وفي كل عنصر `resource`, `quantity`, `unit`, `qty` بوحدة التخزين، و`stockUnit`. إذا نقصت كمية أو كان الصنف معطلاً تكون `ready=false`، ولا يصرف الخادم شيئاً. الاعتماد يظل للقائد عبر المسارات الحالية.

- **الأساس:** كل النقاط تحت `/api/` وترجع JSON.
- **الجلسة:** الواجهة ترسل `X-Azm-Tab` (32 خانة hexadecimal صغيرة) مع **كل** طلب API، بما فيه الدخول والخروج. يختار الخادم كوكي `azm_session_<tab>` الخاص بالتبويب؛ رمز المصادقة عشوائي ويظل في كوكي `HttpOnly; SameSite=Strict; Path=/` (و`Secure` عند HTTPS مباشر). المعرّف في `sessionStorage` ليس رمز مصادقة، ولا يكفي وحده للدخول. الترويسة غير الصالحة ترجع `400 bad_request`؛ كوكي التبويب المفقود/المنتهي يرجع `401` دون الرجوع لأي كوكي آخر. يبقى `azm_session` للعميل القديم الذي لا يرسل الترويسة فقط، ولا تستخدمه الواجهة الجديدة.
- **شكل الخطأ:**
  ```json
  { "error": "<code>" }
  ```

| الرمز | المعنى |
|---|---|
| 400 | مدخلات غير صالحة: `invalid_request`، `no_route`، `invalid_source`، `route_mismatch`، `invalid_layout`، `invalid_user`، `invalid_unit`، `invalid_base`، `invalid_relation`، `invalid_entity`، `invalid_quantity`، `reason_required`، `cross_base_reason_required` (تحويل مخزون بين قاعدتين)، `invalid_period`، `invalid_password`، `invalid_comment`، `cannot_delete_self`، `bad_request` |
| 401 | `invalid_credentials` أو `not_logged_in` |
| 403 | `forbidden` (خارج صلاحية الدور)، `out_of_scope` (قاعدة/وحدة خارج نطاق الحساب)، `source_out_of_scope` (مصدر شحنة خارج صلاحية المعتمد) |
| 404 | `not_found` (غير موجود أو خارج النطاق) |
| 409 | `user_exists`، `insufficient_stock`، `over_capacity`، `entity_in_use`، `entity_has_children`، `entity_archived`، `unit_id_taken`، `layout_conflict`، `relation_locked` |
| 429 | `too_many_attempts` |

## الأدوار والنطاق

الدور والقاعدة والوحدة تُقرأ من **حساب المستخدم على الخادم** (من جلسته)، وأي `role` أو `baseId` أو `unitId` يرسله المتصفح ما يُعتمد عليه للصلاحية. كل رد مفلتر في الخادم (`server/store/scope.mjs`):

| | القائد `admin` | مسؤول القاعدة `base_manager` | مسؤول الوحدة `user` |
|---|---|---|---|
| الخريطة والكيانات | الكل | قاعدته ومراكزها ووحداتها | وحدته + أسماء مركزها وقاعدتها |
| أرصدة المستودعات | الكل | مستودعات قاعدته | لا شي |
| الطلبات والتنبيهات والسجل | الكل | حسب `baseId` المحفوظ وقت الإنشاء | وحدته |
| إنشاء طلب | لأي وحدة | لوحدات قاعدته | لوحدته (يُتجاهل `unitId`) |
| اعتماد / رفض / طائرة | ✓ | ✗ | ✗ |
| تحويل مخزون | أي مستودعين (بين قاعدتين بسبب) | داخل قاعدته | ✗ |
| إضافة مخزون خارجي، الهيكل، الحسابات، المحاكاة | ✓ | ✗ | ✗ |

**الجلسات مستقلة لكل تبويب:** ثلاثة تبويبات عادية على نفس العنوان ونفس ملف المتصفح يمكنها تشغيل الأدوار الثلاثة معاً. تحديث الصفحة يحافظ على معرّف التبويب وحسابه. الخروج ينهي جلسته وحدها، والدخول مجدداً فيه يدوّر رمزه ويبطل رمزه السابق. الخادم يتحقق من ربط الرمز باسم الكوكي ومن انتهاء مدة 12 ساعة ومن نشاط الحساب. إعادة تشغيل الخادم تنهي جميع الجلسات الموجودة في الذاكرة، دون تعديل الحسابات أو العمليات. لا توجد رموز مصادقة في JSON أو URL أو `localStorage` أو `sessionStorage`.

---

## الدخول

| الطريقة | المسار | الجسم | الرد |
|---|---|---|---|
| POST | `/api/login` | `{ username, password }` | `{ username, role, unitId, baseId, fullName, rank }` + كوكي |
| POST | `/api/logout` | — | `{ ok: true }` (جلسة هذا التبويب فقط عند إرسال الترويسة) |
| GET | `/api/me` | — | `{ username, role, unitId, baseId, fullName, rank }` |

## الحالة والمحاكاة

### `GET /api/state`

يحرّك المحاكاة، ويسلّم القوافل الواصلة، ثم يرجع الحالة مفلترة حسب الصلاحية:

```json
{
  "requests": [ /* الطلبات */ ],
  "logs": [{ "time": "14:02:11", "type": "approved", "id": "ORD-AZM-403", "by": "admin" }],
  "layout": { "nodes": [], "links": [] },
  "layoutVersion": 3,
  "now": 1760000000000,
  "hourMs": 60000,
  "stocks": { "UNIT-01": { "ammo": 61.2, "fuel": 39.8, "food": 75.0, "medical": 80.1 } },
  "alerts": [{ "id": "AL-…", "unitId": "UNIT-01", "resource": "fuel", "level": "warning", "value": 44, "time": "14:01:50" }],
  "sim": { "speed": 1, "emergency": false, "hours": 12.4 }
}
```

حقول إضافية (كلها داخل نطاق المستخدم فقط):
- `inventory`: `{ nodeId: { capacity, qty, opening, openingAt, openingSource, inTransit? } }` — الكميات الفعلية بوحدة كل مورد، و `inTransit` للوحدات.
- `scope`: `{ role, baseId, unitId }`، و `trackingStartedAt`: بداية التتبع الجديد.
- `layout`: نقاط النطاق فقط مع `baseId` (التبعية الثابتة) و `relationSource`، والروابط اللي طرفيها داخل النطاق. مسؤول الوحدة يستلم وحدته وقاعدته فقط. نقطة الوحدة تحمل `fuelType` (v8).
- `inventory[nodeId].reserved` (v8): كميات وافق عليها القائد ولم يباشرها مسؤول القاعدة بعد؛ تُطرح من المساحة مثل `inTransit` لكنها ليست بالطريق.
- `policy` (v8): `{ food: [...5 مفاتيح], fuel: ["azm_diesel","azm_gasoline"] }` — سياسة الأصناف التشغيلية.
- `sim` (v8): يضيف `paused` (السرعة 0) و`resumedAt` و`lastGapMs` (وقت توقف الخادم الذي لم يُعوَّض).
- للقائد فقط: `basesWithoutManager` — قواعد بلا مسؤول قاعدة نشط (لن يباشر أحد تكليفاتها).

### `POST /api/sim` — السرعة لكل الأدوار، والإيقاف للقائد فقط

`{ speed?: 0|1|5|10|20 }` ← `{ speed, emergency: false }`. السرعة يغيّرها أي حساب وتطبّق على الجميع. `speed: 0` (إيقاف) للقائد فقط وإلا `403`؛ وإذا كانت المحاكاة موقوفة يرجع لغير القائد `409 sim_paused`. وضع الطوارئ أُزيل: `emergency: true` ← `400`، و`emergency` في الردود دائماً `false`.

### `POST /api/requests/:id/reject` و`reopen` على قرار القائد

الطلب `assigned` بقرار من القائد (`decidedByRole: 'admin'`، وللسجلات القديمة دور صاحب `decidedBy`) لا يرفضه ولا يعيده للمراجعة إلا القائد؛ غيره ← `403 commander_decision`.

### `GET /api/public/units` و`POST /api/register`

`/api/public/units` بدون جلسة يرجع `[]` (لا تنكشف الوحدات لأي أحد على الشبكة)، ومع جلسة يرجع وحدات نطاقها فقط. التسجيل يرسل في `unitId` رمز الوحدة (`code`) أو معرّفها (`UNIT-05`)؛ رمز غير صحيح ← `400 invalid_unit_code`، والمحاولة تُحسب ضمن حد التسجيل بالساعة. السرعة `0` توقف المحاكاة (لا وقت ولا استهلاك ولا تقدم للقوافل). ساعة المحاكاة تعمل على الخادم كل ثانيتين حتى لو لم تُفتح أي صفحة، ووقت توقف الخادم نفسه لا يُعوَّض بعد إعادة التشغيل.

## طلبات الإمداد

### `POST /api/requests`

```json
{
  "unitId": "UNIT-02",
  "mode": "truck",
  "priority": "urgent",
  "notes": "سبب الطلب…",
  "eta": 4.2,
  "items": [
    { "resource": "fuel", "amount": 45, "level": 55, "qty": 21600 },
    { "resource": "ammo", "amount": 30, "level": 70 }
  ]
}
```

- `unitId` يُتجاهل لمسؤول الوحدة (الطلب لوحدته دائماً). مسؤول القاعدة لوحدات قاعدته فقط (غيرها 403 `out_of_scope`).
- `mode`: `truck` | `heli`.
- `priority`: `normal` | `urgent` | `emergency`.
- `resource`: مفتاح من الكتالوج، بدون تكرار. لطلب الوحدة (v8) يجب أن يكون صنفاً تشغيلياً للوحدة: من الأغذية والمياه المخصصة لها أو نوع وقودها؛ غير ذلك `400 resource_not_operational` (أو `resource_not_assigned`). `fill: true` لمورد ممتلئ (مع الوارد والمحجوز) يرجع `409 over_capacity` ولا يُنشأ بكمية صفر.
- `amount`: من 5 إلى 100، وهو نسبة الزيادة من سعة الوحدة. **الكمية الفعلية `qty` والمستوى `level` يحسبهما الخادم** (أي قيمة مرسلة تُتجاهل).
- إذا الرصيد + الشحنات بالطريق + الكمية تتجاوز سعة الوحدة: 409 `over_capacity` مع `room: [{ resource, qty, room }]` (ما يصير قص للنسبة).
- الصيغة القديمة `{ resource, amount, level }` بدل `items` مقبولة.

الرد هو الطلب الكامل، وحالته `pending`، ومعه `baseId` (نسخة تبعية الوحدة) و `history[]`. ممكن يكون لنفس الوحدة أكثر من طلب معلّق وأكثر من شحنة بالطريق — كل طلب مستقل.

### القرارات — القائد الرئيسي فقط (ثم مباشرة مسؤول القاعدة، v8)

مسؤول القاعدة يتابع ويعلّق، ولا يملك قرار الموافقة أو الرفض: مسارات القرار ترجع `403 forbidden` لغير القائد، حتى للطلب الطارئ. [تفاصيل v5](history/SUPPLY_V5.md). كل إجراء يقبل `operationKey` (3–64 حرفاً): إعادة نفس المفتاح ونفس الجسم ترجع حالة الطلب دون تنفيذ ثانٍ، ونفس المفتاح بجسم مختلف `400 bad_request`.

| المسار | من | الجسم | التأثير |
|---|---|---|---|
| `POST /api/requests/:id/approve` | القائد | `{ route: { path, km, hours, fromId, fromLabel }, mode?, items?, crossBaseReason?, operationKey? }` | **`assigned`** (معتمد — بانتظار مباشرة مسؤول القاعدة). يحفظ المصدر و`approvedItems` والوسيلة والمسار. **لا خصم ولا حركة ولا قافلة**؛ الكميات تُحجز من سعة الوحدة |
| `POST /api/requests/:id/execute` | مسؤول قاعدة الوحدة فقط | `{ operationKey? }` | يعيد فحص المصدر والرصيد والسعة مع الوارد والمحجوز والمسار، ثم حركة `dispatch` لكل مادة برقم عملية واحد `DS-…` وخصم مرة واحدة → **`approved`** (بالطريق) مع `executedBy` و`executedAt` و`dispatched` و`departSim` |
| `POST /api/requests/:id/reject` | القائد | `{ reason?: "…" }` | من `pending` أو `assigned`: `rejected` + `rejectReason` + تعليق `kind: "reject"` |
| `POST /api/requests/:id/air` | القائد | — | تغيير الوسيلة فقط: `mode = heli`، والوقت × 0.25، **ويبقى `pending`** (لا اعتماد ولا شحنة) |
| `POST /api/requests/:id/reopen` | القائد | — | قرار `assigned` لم يُباشر (أو اعتماد قديم `stalled`) يرجع `pending`، ويُحفظ القرار السابق في `previousDecisions[]` |

- القرار على `pending` فقط (`409 not_pending` لغيره)، والمباشرة على `assigned` فقط (`409 not_assigned`)، فإعادة الإرسال لا تكرر الخصم.
- تعذر المباشرة (تغيّر الرصيد أو السعة بعد القرار): `409 execution_blocked` مع `failures: [{ resource, error: insufficient_stock|over_capacity|…, required, available?, capacity, current, inTransit, reserved, room }]`. لا يُنفذ أي صنف ولا يصير رصيد سالباً؛ يبقى الطلب `assigned` ويُحفظ `executionBlocked` ليراه القائد ويعيد المراجعة أو يرفض. `available` (رصيد المصدر) لا يظهر لمسؤول الوحدة، ولا لمسؤول قاعدة مصدره من قاعدة أخرى.
- المصدر من قاعدة أخرى: المنفّذ يرى اسم المصدر فقط (`source: { restricted, label }`) بلا مسار أو أرصدة، والخادم ينفذ الخصم بصلاحية التكليف نفسه دون توسيع نطاقه. لا يستطيع مسؤول القاعدة إنشاء تكليف أو تغيير مصدر قرره القائد.
- **المصدر** (`route.fromId`) يختاره القائد لكل شحنة من مستودع قاعدة أو مركز فعلي. المورد الافتراضي والرياض ليسا مصدرين لشحنات جديدة للوحدات. شحنة من قاعدة أخرى تحفظ `crossBase: true` و`crossBaseReason` اختياري، وتبعية الوحدة لا تتغير.
- **المسار** لازم يبدأ من المصدر المختار وينتهي عند الوحدة (±5 كم)، والمسافة ما تقل عن الخط المستقيم، وإلا 400 `route_mismatch`. الرد يحفظ `source` و `destination` (نسخة الكيانين وقت الاعتماد) و `route` (المسار والمسافة) و `eta` و `decidedBy`.
- اعتمادان متزامنان على نفس المصدر: كل اعتماد يتحقق ويخصم دفعة وحدة، فالثاني ياخذ `insufficient_stock` إذا ما بقي يكفي — الرصيد ما ينزل تحت الصفر.
- 409 `insufficient_stock` مع `{ depotId, shortages: [{ resource, qty, available }] }`، أو 409 `over_capacity` إذا الوحدة ما تتسع مع الشحنات المتجهة لها.

### `POST /api/requests/:id/comments`

`{ text }` (حتى 1000 حرف). على أي طلب داخل نطاق المستخدم. الرد هو الطلب مع `comments[]`.

## الكيانات والهيكل — للقائد فقط

| الطريقة | المسار | الجسم | الرد |
|---|---|---|---|
| POST | `/api/entities` | `{ type: "main"\|"fsb"\|"unit", label, pos, baseId?, sourceId?, people?, vehicles?, fuelType? }` | `{ node, inventory, layoutVersion }` |
| PUT | `/api/entities/:id/resources` | `{ allowedResources?, fuelType? }` | أصناف الوحدة ونوع وقودها (v8): الإضافة للأغذية الخمسة أو الوقود المحدد فقط (`400 resource_not_operational`)، وإزالة صنف له رصيد أو وارد أو طلب `409 resource_in_use` |
| POST | `/api/entities/:id/maintenance` | `{ resource, reason }` | القائد فقط؛ لسجلات صيانة قديمة. المحاكاة لا تُنشئ استحقاق صيانة في v8 |
| POST | `/api/entities/:id/repair` | `{ baseId }` | لسجل قديم بدون قاعدة صالحة فقط، ثم تثبت. غيره 409 `relation_locked` |
| PUT | `/api/entities/:id/relations` (قديم) | — | دائماً 409 `relation_locked` — التبعية ثابتة بعد الإنشاء |
| DELETE | `/api/entities/:id` | — | `{ archived, layoutVersion }` (أرشفة) |

- **المركز** و**الوحدة** يحتاجون `baseId` لقاعدة موجودة (غيرها `invalid_base`)، والتبعية ثابتة بعد الإنشاء. الوحدة **ما تحتاج مركز إمداد دائم** — مصدر كل شحنة يُختار عند الاعتماد.
- الوحدة تاخذ رقم `UNIT-NN` جديد وأصنافها التشغيلية فقط (v8): الأغذية والمياه الخمسة + `fuelType` إن كان `azm_diesel` أو `azm_gasoline` (`none` = بلا وقود، والغياب = غير محدد ولا يُخمَّن؛ الوقود مع `vehicles: 0` يرجع `fuel_needs_vehicles`). يُصرف لها 5% من سعة كل صنف منها من `sourceId` التابع لقاعدتها، مع خصم موثق وحفظ سجل المخزون فوراً. القاعدة الجديدة ممتلئة والمركز الجديد فارغ، والرصيد اليدوي وقت الإنشاء غير متاح.
- الأرشفة ممنوعة مع طلبات نشطة أو شحنات من/إلى الكيان أو كيانات تابعة.

## الخريطة

### `PUT /api/layout` — للقائد فقط

`{ nodes: [...], links: [...], baseVersion? }` ← `{ layoutVersion }`

- **النقطة:** `{ id, type: "main"|"fsb"|"unit", pos: [lat,lng], label?, labelKey?, unitId? }`. الوحدة لازم يكون لها `unitId` بصيغة `UNIT-<رقم>`.
- **النقاط الموجودة:** يتغير الموقع والاسم فقط؛ النوع ورقم الوحدة والتبعية تبقى كما هي على الخادم.
- **نقطة جديدة:** لازم تحمل قاعدة صالحة (`baseId`، أو `parentId` القديم لقاعدة أو لمركز فتاخذ قاعدته).
- **نقطة محذوفة:** أرشفة بنفس شروط `DELETE /api/entities/:id`.
- `baseVersion`: رقم التخطيط اللي بنى عليه المتصفح؛ إذا تغيّر من بعده يرجع 409 `layout_conflict`.
- **الرابط:** `{ id, from, to, kind: "road"|"air", geometry?: [[lat,lng],…], km?, approx? }`
- **الحدود:** 500 نقطة و 1000 رابط.

## المساعد الذكي

| الطريقة | المسار | الوصف |
|---|---|---|
| GET | `/api/ai/status` | `{ connected, provider, model }` |
| GET | `/api/chats` | محادثاتي: `[{ id, title, updatedAt, count }]` الأحدث أولاً |
| POST | `/api/chats` | `{ text }` ← محادثة جديدة فيها السؤال والرد |
| GET | `/api/chats/:id` | المحادثة كاملة `{ id, title, messages[] }` |
| POST | `/api/chats/:id/messages` | `{ text }` ← المحادثة بعد إضافة السؤال والرد |
| DELETE | `/api/chats/:id` | `{ ok: true }` |

**الرسالة:**

```json
{ "role": "user" | "assistant", "text": "…", "at": 1760000000000, "kind": "not_connected" | "ai_error", "model": "…" }
```

- `kind` يظهر فقط في ردود غير مربوط أو عند الخطأ.
- `model` يظهر فقط في ردود النموذج.
- بعض الأسئلة يجاوبها الخادم مباشرة بدون النموذج وبنفس شكل الرسالة. أسئلة الهوية يجاوبها `identity.mjs`، والإحداثيات `direct.mjs`. وسؤال مسؤول الوحدة البسيط عن رصيد صنف من الكتالوج («كم الديزل عندنا؟») يجاوبه `server/ai/stock-direct.mjs` من لقطة وحدته نفسها (`buildContext`)، بسطر لكل صنف: الكمية من السعة، والنسبة، والحالة (نافد / حرج / تحت نقطة الطلب / متوفر)، وما في الطريق إن وُجد. الأدوار الأخرى، وأسئلة الكفاية والاستهلاك والتوقيت والطلبات والقوافل والقاعدة، وأي سؤال فيه رقم، تبقى للنموذج كالعادة.

**بث الرد أثناء الكتابة:** إذا أرسل المتصفح الرأس `Accept: application/x-ndjson` مع `POST /api/chats` أو `POST /api/chats/:id/messages`، يرد الخادم بـ `application/x-ndjson`، سطر JSON لكل حدث بالترتيب:

```json
{ "type": "start", "chatId": "…" }
{ "type": "delta", "text": "جزء من الرد" }
{ "type": "reset" }
{ "type": "done", "chat": { "id": "…", "title": "…", "messages": [] } }
```

- `delta` يتكرر لكل جزء من النص. و`reset` يعني امسح ما وصل، لأن الرد طلع استدعاء أداة، وبعده تجي أجزاء الإجابة النهائية.
- `done` يحمل المحادثة كاملة ومحفوظة، بنفس شكل الرد العادي.
- بدون هذا الرأس يبقى الرد JSON كامل كما كان. ومع `AZM_AI_STREAM=0` يبقى الرد NDJSON، لكن بدون أحداث `delta` (`start` ثم `done` فقط).

## طلب حساب جديد (بدون جلسة)

| الطريقة | المسار | الجسم | الرد |
|---|---|---|---|
| GET | `/api/public/units` | — | `[{ id, label }]` للوحدات المتاحة في النموذج |
| POST | `/api/register` | `{ fullName, rank, serviceId, phone?, position?, unitId, username, password, note? }` | `{ ok: true }`، والحساب يُنشأ بحالة `pending` |

- **الشروط:** الاسم 3–60 حرف، `rank` من قائمة الرتب، `serviceId` من 4 إلى 15 رقم، و `phone` من 7 إلى 15 رقم (اختياري).
- **الحد:** 5 طلبات في الساعة من نفس الجهاز.
- **الأخطاء:** `invalid_registration` و `user_exists` و `service_id_exists` و `too_many_attempts`.
- **الدخول بحساب غير نشط** يرجع 403 بأحد الرموز `account_pending` أو `account_suspended` أو `account_rejected`، والأخير يرجع معه `reason`.

## المستودعات والمخزون

| الطريقة | المسار | الجسم | من | التأثير |
|---|---|---|---|---|
| POST | `/api/depots/:id/transfer` | `{ to, resource, qty, reason? }` | القائد؛ مسؤول القاعدة داخل قاعدته | تحويل فوري (حركة `transfer`). بين قاعدتين: للقائد مع `reason` إلزامي |
| POST | `/api/inventory/add` | `{ baseId, items: [{ resource, qty }], reason }` | القائد | إضافة خارجية لقاعدة (كل المواد أو ولا وحدة). الرد `{ opId, before, after, movements }` |
| POST | `/api/depots/:id/restock` | `{ resource, qty, reason? }` | القائد | الصيغة القديمة للإضافة الخارجية (قاعدة فقط) |

- **الكمية:** عدد صحيح بوحدة المورد (طلقة، لتر، حصة، وحدة طبية).
- **الأخطاء:** `insufficient_stock` (ومعه `available`)، `over_capacity` (ومعه `room`)، `restock_main_only`، `invalid_target`، `invalid_quantity`، `reason_required`، `cross_base_reason_required`.

**في `GET /api/state`:**
- `depots`: `{ nodeId: { ammo, fuel, food, medical } }` — القائد الكل، مسؤول القاعدة مستودعات قاعدته، مسؤول الوحدة لا شي.
- `hierarchy`: `{ nodeId: parentId }` للنقاط الظاهرة.
- `pendingUsers`: عدد طلبات الانضمام. القائد: الكل، ومسؤول القاعدة: طلبات الانضمام لوحدات قاعدته فقط.
- `mapOthers` (مسؤول القاعدة فقط): بقية القواعد والوحدات للرسم على الخريطة بالاسم فقط `[{ id, type: 'main'|'unit', pos, label?, labelKey?, unitId? }]` — بلا أرصدة أو سعات أو أعداد أو تبعية، ومنفصلة عن `layout` فلا تدخل في المسارات أو المصادر.

## التقارير وسجل الحركات — للجميع، داخل النطاق

### `GET /api/reports`

الاستعلام (كلها اختيارية): `from`، `to` (ms)، `baseId`، `supplyId`، `unitId`، `resource`، `status`. فلتر خارج النطاق ← 403 `out_of_scope`.

```json
{ "trackingStartedAt": 0, "period": { "from": 0, "to": 0, "effectiveFrom": 0 }, "historyUnavailableBefore": 0,
  "requests": { "total": 3, "byStatus": { "pending": 1, "approved": 0, "delivered": 2, "rejected": 0 },
                "qty": { "fuel": { "measure": "liter", "requested": 1600, "dispatched": 800, "delivered": 800 } }, "list": [] },
  "entities": [{ "id": "fsb-y", "type": "fsb", "rows": { "fuel": { "opening": 0, "initial": 0, "relocated_in": 0, "external_add": 0,
                 "transfer_in": 3000, "transfer_out": 0, "dispatch": 800, "delivery": 0, "return": 0, "consumption": 0,
                 "closing": 2200, "current": 2200, "inTransit": 0 } } }],
  "bases": [{ "id": "main-x", "totals": { "fuel": { "openingOnHand": 0, "initial": 0, "relocatedIn": 0, "external_add": 10000,
              "crossBaseIn": 0, "crossBaseOut": 0, "internalTransfers": 3000, "dispatch": 800, "delivery": 800, "return": 0,
              "consumption": 1400, "relocatedOut": 0, "closingOnHand": 8600, "currentOnHand": 8600, "inTransit": 0 } } }] }
```

- `historyUnavailableBefore` يظهر إذا الفترة تبدأ قبل بداية التتبع الجديد — الأرقام تبدأ من `trackingStartedAt`.
- معادلة القاعدة: `closingOnHand + relocatedOut = openingOnHand + initial + relocatedIn + external_add + crossBaseIn − crossBaseOut − dispatch + delivery + return − consumption`. التحويل الداخلي (`internalTransfers`) للعلم فقط.
- مسؤول القاعدة: قاعدته فقط، وتفاصيل الوحدة اللي انضمت لقاعدته تبدأ من لحظة انضمامها. مسؤول الوحدة: وحدته فقط، بدون إجماليات قاعدة.

### `GET /api/reports/series` — سلسلة داشبورد التقارير

الاستعلام: `from`, `to` (ms)، `buckets` (2–60)، `baseIds` (قائمة بفواصل؛ قاعدة خارج النطاق ← `403 out_of_scope`)، `resources` (قائمة أصناف؛ صنف غير معروف ← `400`). يرجع عدد **العمليات** (`opId` واحد ولو شمل عدة أصناف، لا الكميات لأن وحدات القياس مختلفة) لكل نوع حركة في كل فترة، بنطاق الجلسة نفسه (`canSeeMovement`):

```json
{ "from": 0, "to": 0, "step": 0, "types": ["dispatch", "delivery", "external_add", "transfer", "return"],
  "buckets": [{ "at": 0, "dispatch": 2, "delivery": 1, "external_add": 0, "transfer": 0, "return": 0 }] }
```

### `POST /api/reports/explain`

جسم الطلب: نفس فلاتر التقرير (`from`, `to`, `baseId`, `supplyId`, `unitId`, `resource`, `status`) مع `language: "ar" | "en"`. يحسب الخادم تقريرًا جديدًا ضمن صلاحية صاحب الجلسة، ثم يرسل للنموذج **ملخص الأرقام المحسوبة فقط**، دون سجل الطلبات الخام أو ملاحظاتها. لا يثق الخادم بأي دور أو نطاق يرسله المتصفح.

- نجاح: `{ "text": "...", "model": "...", "period": { "from": 0, "to": 0, "effectiveFrom": 0 } }`.
- نموذج غير مربوط: `200 { "kind": "not_connected" }`؛ تعذر الاتصال: `200 { "kind": "ai_error" }`. واجهة التقرير تعرض الحالتين برسالة واضحة.
- فلاتر خارج النطاق: `403 { "error": "out_of_scope" }`؛ صنف أو حالة أو فترة غير صحيحة: `400`.
- الشرح نص للقراءة فقط؛ الأرقام الرسمية والتصدير CSV تظل من `GET /api/reports`.

### `GET /api/movements`

`?from&to&entityId|unitId&type&resource&offset&limit(≤200)` ← `{ total, offset, limit, movements[] }` (الأحدث أولاً). أرصدة الأطراف اللي خارج النطاق تُحذف (`restricted: true`). الفترات المفتوحة للاستهلاك تظهر كـ `OPEN-…` مع `provisional: true`.

## المستخدمين — القائد كاملاً، ومسؤول القاعدة لحسابات قاعدته

مسؤول القاعدة: `GET /api/users` يرجع حسابات قاعدته فقط (مسؤولو القاعدة ومسؤولو وحداتها وطلبات الانضمام لوحداتها). يقدر يستخدم `approve` (كمسؤول وحدة ولوحدة داخل قاعدته فقط؛ أي `role` غير `user` أو وحدة خارج قاعدته ← `403`) و`reject` و`suspend`/`activate` لحسابات مسؤولي الوحدات في قاعدته. حساب خارج قاعدته ← `404 not_found`، وحسابه هو ← `400 cannot_change_self`. الإنشاء والتعديل والحذف ← `403`.

| الطريقة | المسار | الجسم | الرد |
|---|---|---|---|
| GET | `/api/users` | — | كل الحسابات بملفاتها (بدون كلمة المرور): `status`, `fullName`, `rank`, `serviceId`, `phone`, `position`, `createdAt`, `lastLoginAt`, `approvedBy`… |
| POST | `/api/users` | `{ username, password, role, unitId?, baseId?, fullName?, rank?, serviceId?, phone?, position? }` | المستخدم (نشط مباشرة) |
| POST | `/api/users/:username/approve` | `{ role?, unitId?, baseId? }` | تفعيل طلب انضمام (أو حساب مرفوض) |
| POST | `/api/users/:username/reject` | `{ reason? }` | رفض طلب انضمام |
| POST | `/api/users/:username/suspend` / `activate` | — | إيقاف حساب (ينهي جلساته) أو إعادة تفعيله |
| PUT | `/api/users/:username` | أي من: `{ password, fullName, rank, serviceId, phone, position, role, unitId }` | `{ ok: true }`، وتنتهي جلسات المستخدم إذا ما كان هو نفسه |
| DELETE | `/api/users/:username` | — | `{ ok: true }`، وما تقدر تحذف نفسك |

**الشروط:**
- `username`: من 3 إلى 32 حرف أو رقم أو `_` أو `.` أو `-`.
- `password`: 6 أحرف على الأقل.
- `role`: `admin` | `base_manager` | `user`.
- `unitId`: مطلوب لمسؤول الوحدة (`user`)، ولازم يكون وحدة موجودة على الخريطة. `baseId`: مطلوب لمسؤول القاعدة، ولازم يكون قاعدة (`main`).
- `/api/register` ينشئ دائماً حساب `user` معلّق — أي `role` أو `baseId` في الطلب يُتجاهل، والدور يحدده القائد عند الموافقة.

---

## مثال كامل (PowerShell)

```powershell
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Invoke-RestMethod http://localhost:5173/api/login -Method Post -WebSession $s -ContentType 'application/json' -Body '{"username":"admin","password":"..."}'
(Invoke-RestMethod http://localhost:5173/api/state -WebSession $s).stocks
```

## المورد الافتراضي وطلبات احتياج القواعد (v5)

- **المورد الافتراضي** بلا نقطة على الخريطة أو موقع. يستخدمه القائد فقط في `POST /api/inventory/add` لتزويد مستودع قاعدة `main` بكميات محددة وسبب إلزامي؛ حركة `external_add` مع `from.type: virtual` ورصيد `null`، دون شحنة. `operationKey` اختياري لمنع تكرار العملية عند إعادة المحاولة، حتى بعد إعادة التشغيل؛ نفس المفتاح بمحتوى مختلف يرجع `400 bad_request`.
- تعريف الرياض السابق محفوظ في `legacySupplySources` داخلياً؛ الشحنات المعتمدة سابقاً تكمل مسارها وتسليمها مرة واحدة. لا ينشئ API نقطة `hq` جديدة، ولا يقبلها كمصدر إرسال جديد.
- **طلب قاعدة** — `POST /api/requests` مع `kind: "base"`:

```json
{ "kind": "base", "baseId": "main-x", "items": [{ "resource": "fuel", "qty": 10000 }], "notes": "السبب (إلزامي)", "priority": "normal", "mode": "truck" }
```

  - مسؤول القاعدة لقاعدته فقط (يُتجاهل `baseId`)، والقائد لأي قاعدة. مسؤول الوحدة 403.
  - الرد: `kind: "base"` و`targetId` و`fulfillment: "virtual_supply"`؛ دون موقع أو `sourceId` جديد.
  - **القائد فقط** يعتمد أو يرفض. `approve` لا يحتاج `route`، ويستخدم `reason` أو مبرر الطلب. يفحص السعة ثم يزوّد القاعدة فوراً مرة واحدة، ويحفظ `supplied` و`delivered` و`supplyOpId` و`supplyReason` وحالة `delivered` وتاريخ الاعتماد والتسليم. لا يحسب `dispatch` ولا ينشئ قافلة. طلبات القاعدة القديمة المعلقة تستخدم هذا السلوك عند اعتمادها.
  - تقارير القائد تضيف `virtualSupply[]` للتزويد و`hqOutgoing` للتاريخ فقط. غير القائد يحصل على قيمة الإضافة ضمن قاعدته دون تعريف المورد. الوارد بالطريق يشمل شحنات الرياض القديمة إلى القواعد.
- **طلب وحدة بالكمية:** `items: [{ resource, qty }]` (كمية فعلية). الصيغة القديمة `amount` (نسبة) مقبولة، و `qty` يُعتمد فقط إذا ما فيه `amount`.
- **السعة:** أي إنشاء طلب أو اعتماد أو تحويل أو إضافة خارجية يتجاوز سعة الوجهة يرجع 409 `over_capacity` مع تفاصيل لكل صنف: `{ resource, qty, capacity, current, inTransit, room }` (في `room` لمسارات الطلبات، و `rooms` لمسارات المستودعات). الشحنات المعتمدة بالطريق للوجهة محسوبة.
- **`POST /api/requests/:id/reopen`** (القائد): اعتماد قديم من النسخة الأولى بلا أي إرسال (`stalled`) يرجع `pending` للمراجعة. غيره `not_stalled`.
- **الأرشفة:** `DELETE /api/entities/:id` يرجع 409 مع السبب والقائمة: `{ error: "entity_in_use", requests: [{ id, status, stalled? }] }` أو `{ error: "entity_has_children", children: [...] }`.

## كتالوج الموارد (v4)

| الطريقة | المسار | من | الوصف |
|---|---|---|---|
| GET | `/api/catalog` | الجميع | كل الأصناف (الفعّالة والمعطّلة) |
| POST | `/api/catalog` | القائد | صنف جديد |
| PUT | `/api/catalog/:key` | القائد | تعديل الاسم ووحدة القياس والسعات والاستهلاك والتفعيل (`active`) |

```json
{ "key": "water", "icon": "💧", "name": { "ar": "مياه", "en": "Water" }, "unit": { "ar": "لتر", "en": "liters" }, "measure": "liter_water",
  "active": true, "capacity": { "main": 500000, "fsb": 100000 }, "unitBasis": "people", "unitFactor": 20, "weight": 1 }
```

- `key` ثابت بعد الإضافة (`resource_exists` للمكرر). ما فيه حذف — التعطيل يخفي الصنف من الطلبات الجديدة والمحاكاة ويبقي سجلاته.
- التدرج إلزامي: `capacity.main > capacity.fsb > أكبر سعة وحدة` وإلا 400 `capacity_order` مع `detail`.
- تخفيض السعة ما يقص أي رصيد — يُمنع الوارد الجديد فقط.
- `GET /api/state` يرجع `catalog` و `user` (الحساب صاحب الجلسة — الواجهة تتحول له إذا تغيّر من تبويب ثاني)، و `inventory[id].inTransit` للمستودعات والوحدات.
# تحديث الطلبات وحساب التعبئة

يدعم `POST /api/requests/:id/approve` حقل `items` اختياري للقائد وحده: نفس أصناف الطلب دون إضافة أو حذف، ولكل صنف كمية صحيحة موجبة أو `fill: true`. يعاد حساب المساحة ورصيد المصدر بعد قراءة الجسم وقبل الصرف؛ التعبئة عند الاعتماد هي الأقل منهما. تبقى `items` الأصلية محفوظة، وتُضاف `approvedItems` وتفاصيل الكميات إلى حدث الاعتماد في التاريخ. إذا لم يُرسل الحقل، تبقى دلالة الاعتماد القديمة (الكمية المطلوبة كما هي)، مع رفض الزيادة عن الحدود الحالية. لا يحدث خفض تلقائي لطلب معلّق أو إرسال دون اعتماد.

`GET /api/events` اتصال أحداث للمستخدم المسجل، ويحمل `X-Azm-Tab` مثل بقية الطلبات. يرسل `ready` و`changed` دون بيانات عمليات؛ يعيد المتصفح جلب `/api/state` بصلاحية تبويبه. عند انتهاء الجلسة ينتهي الاتصال. يبقى التحديث الدوري بديلاً عند انقطاعه.

في إنشاء طلب الوحدة أو احتياج القاعدة يمكن إرسال `{resource, fill: true}` بدلاً من `qty` داخل `items`. يحسب الخادم الكمية الصحيحة: أكبر عدد صحيح لا يتجاوز السعة ناقص الرصيد الفعلي والوارد المعتمد بالطريق. إذا لم توجد مساحة يرفض العملية. الطلب المعلّق وحده لا يحجز مساحة. تبقى صيغة الكمية اليدوية والطلبات القديمة مدعومة.

تدعم `/api/inventory/add` الصيغة نفسها للقائد والقواعد فقط، مع السبب و`operationKey` لمنع تكرار إعادة المحاولة. ويدعم `/api/depots/:id/transfer` إرسال `fill: true`، فيحسب الأقل بين مساحة الوجهة ورصيد المصدر. جميع الحدود تُفحص في الخادم قبل تسجيل أي حركة.

# التعبئة والسجل الدائم

`POST /api/requests` يقبل `operationKey` اختيارياً (3–64 حرفاً إنجليزياً أو رقماً أو `_` أو `-`). إعادة نفس الجسم والمفتاح من الحساب نفسه ترجع الطلب المحفوظ، حتى بعد إعادة التشغيل؛ تغيير الجسم مع المفتاح نفسه مرفوض بـ `400 bad_request`. تستخدم نافذة الإنشاء مفتاحاً ثابتاً لكل محاولة طلب. عناصر `fill: true` تُحسب في الخادم من السعة ناقص الرصيد والوارد المعتمد، ولا تقبل صنفاً غير مخصص للوحدة. يبقى فحص السعة ومخزون المصدر إلزامياً عند الاعتماد.

`GET /api/audit?search=&type=&resource=&from=&to=&offset=&limit=` يرجع `{total, entries}`. الوقت بالمللي ثانية، والحد الأقصى 200 سطر. يجمع الأحداث الإدارية الدائمة وحركات المخزون الأصلية مرة واحدة؛ `type` أحد `entities, requests, catalog, simulation, layout, users, chats` أو أنواع الحركات المعتادة. الفلترة بالصلاحيات وحجب أرصدة الأطراف الخارجية يسبقان البحث وحساب الإجمالي. الأحداث العامة والحسابات للقائد فقط، وأحداث الجهات والطلبات حسب تبعيتها المحفوظة وقت الحدث. سجل المحادثات بيانات إجراء فقط دون النصوص، ويراه صاحبه والقائد. لا يحتوي السجل كلمات مرور أو تجزئاتها أو رموز جلسات.

`GET /api/audit` يقبل أيضاً `types` اختيارياً: أنواع مفصولة بفاصلة (مثل `requests,dispatch,delivery`) تقصر النتيجة عليها. صفحة سجل العمليات تستخدمه لعرض الإجراءات على الطلبات والإرسال والتسليم فقط. وبدونه يرجّع كل العمليات مثل قبل، فباقي العمليات تبقى مسجلة.

# عقد مسودة الطلب والاستخراج

`GET /api/ai/request-schema` يعيد مخطط `extract_supply_request` للمستخدم المسجل. `POST /api/ai/request-draft` يقبل `{text,unitId}`؛ لمسؤول الوحدة يفرض الخادم وحدته من الجلسة، ولغيره يتحقق من النطاق. النتيجة `{draft,unitId,sourceText}`؛ تشمل المسودة `items,priority,modelPriority,deadline,missing,warnings,ready`.

كل مادة مراجعة تحمل `resource,item,supplyClass,modelSupplyClass,quantity,unit,qty,stockUnit,availableInCatalog`. `supplyClass` من الكتالوج؛ `modelSupplyClass` للمقارنة فقط. اختلافهما ينتج تحذير `catalog_class_corrected`. الاسم غير المعروف أو المكرر ينتج `422 invalid_model_item`، والملتبس `422 ambiguous_model_item`، والصنف غير المخصص `422 resource_not_assigned`. JSON غير مطابق يُرفض بـ `422 invalid_model_json`. الكمية أو وحدة القياس الناقصة تجعل `ready:false` ولا تنشئ طلباً. غياب `deadline` يطبّع إلى `null` مع تحذير `missing_model_deadline`.

ضوابط الدليل (`server/ai/request-evidence.mjs`) تعمل بعد النموذج: كل صنف وكمية وموعد لازم يكون له دليل في نص المستخدم (أسماء الكتالوج وأسماؤه البديلة واسم القائد الحالي). الشك لا يُخترع بديله أبداً، بل يصير `null` فيسأل الشات عن الكمية. التحذيرات الإضافية: `unit_assumed_base` (كمية بلا وحدة ← وحدة المخزون الأساسية، مع `unit`)، `item_not_in_text` (صنف بلا ذكر في النص ← كميته `null`)، `quantity_belongs_to_other_item` (الرقم في جزء جملة صنف آخر، مع `other` ← الكمية `null`)، `possible_missing_item` (صنف مذكور أسقطه النموذج ← يُضاف بكمية `null`)، `duplicate_quantity` (نفس الرقم لصنفين وهو مكتوب مرة ← الكميتان `null`)، `deadline_not_in_text` (موعد بلا كلمة وقت ← `null`)، `unit_not_allowed` (وحدة غير مسموحة للصنف، مع `unit`: صنف بوحدة واحدة تُستخدم وحدته، وصنف بأكثر من وحدة تصير كميته ووحدته `null` بدون تحويل مخمّن)، `unknown_item_matched_from_text` (اسم خارج الكتالوج، مع `modelItem` ← يُستبدل بصنف مذكور في النص ولم يُستخرج، بكمية `null`؛ وإذا ما فيه صنف مقابل يبقى `422 invalid_model_item`)، `quantity_not_in_text` (كمية أكبر من 2 غير مكتوبة بالأرقام في النص وما فيه أرقام بالحروف ← `null`)، `unit_from_text` (وحدة مكتوبة بعد الرقم في جزء الصنف ومسموحة له، مع `unit` و`model` ← تغلب وحدة النموذج ويُعاد حساب `qty`)، `item_replaced_from_text` (صنف بلا ذكر في النص وفيه صنف مذكور لم يُستخرج، مع `model` ← يُستبدل بالمذكور، وتبقى الكمية فقط إذا كانت في نفس جزء الجملة معه وإلا `null`). أي شك من ضوابط الدليل يجعل الكمية `null`، وأي صنف كميته `null` يدخل `missing` فيصير `ready:false`.

هذا المسار لا يحفظ طلباً ولا يغيّر المخزون. بعد المراجعة، يرسل المستخدم نموذج الطلب العادي إلى `POST /api/requests`؛ الموعد النصي الاختياري `deadline` محدود بـ80 حرفاً. تحقق السعة والمصدر والصلاحيات يبقى في مسار الطلب والاعتماد.

`GET /api/ai/request-status` يفحص خدمة الاستخراج؛ و`GET /api/ai/status` خدمة المحادثة. حقول الحالة `configured,connected,state,checkedAt,error` تميّز الإعداد عن الاتصال المقاس. نجاح `/models` لا يضمن جودة الاستخراج. `GET /api/ai/tools` يعرض أدوات قراءة محددة، و`POST /api/ai/tools/read` يتحقق من `{name,arguments}` ومن صلاحيات الحساب قبل إرجاع البيانات. لا تقبل الأدوات إنشاء الطلبات أو اعتمادها.

# التموين الشامل بين المستودعات

يدعم `POST /api/depots/:id/transfer` الحقل الإضافي `items: [{resource, qty}]` مع `to` و`operationKey` إلزامي للمجموعة (٣–٦٤ محرفاً من الأحرف اللاتينية والأرقام والشرطة والشرطة السفلية). تبقى صيغة المورد الواحد مدعومة. السبب إلزامي للتحويل بين قاعدتين، وهو للقائد وحده؛ مسؤول القاعدة يحوّل داخل نطاق قاعدته فقط. الوحدات ليست وجهة لهذا المسار وتبقى ضمن طلباتها واعتماد القائد.

يفحص الخادم التبعية والصلاحيات والأصناف النشطة ورصيد المصدر والسعة بعد خصم الوارد بالطريق لجميع المواد قبل أي تغيير. عند التعذر يرجع `409` مع `failures[]`؛ كل عنصر يضم `resource, error, available, capacity, current, inTransit, room, qty` ولا ينفذ أي مادة. النجاح يرجع `opId, movements[]` وحركة `movement` الأولى للتوافق. جميع الحركات تحمل رقم عملية واحد. إعادة نفس المفتاح والحمولة بواسطة المستخدم نفسه تعيد النتيجة المحفوظة دون خصم جديد؛ تغيير الحمولة بنفس المفتاح مرفوض.


# سياسة الموارد ودورة القرار والمباشرة (v8)

- `GET /api/policy/review` — للقائد فقط، قراءة فقط: `{ policy, units: [{ unitId, fuelType, fuelTypeSource, operational, missingFood, legacy: [{ resource, qty, inTransit }] }], unknownFuel, legacyRequests, legacyInTransit, basesWithoutManager, migration }`. يعرض ما بقي من السياسة السابقة دون حذفه.
- `POST /api/ai/request-draft`: كل مادة في المسودة تحمل `requestable` و`blockedReason` (`resource_not_operational` أو `resource_not_assigned`) لصنف خارج أصناف الوحدة التشغيلية. `ready` يعتمد على المواد القابلة للطلب فقط. المسودة للمراجعة ولا تنشئ طلباً. الاسم الفصيح والعامي والإنجليزي كلها مرادفات من `resources/items.json` (`nameAr` + `aliases`).
- أنواع سطور `logs[]` الجديدة: `mode_changed`، `assigned`، `execution_blocked`، `reopened`، `dispatched` (مع `submitted` و`rejected` و`delivered`). سجل العمليات الدائم (`/api/audit`) يعرض الإجراءات `pending` و`air` و`assigned` و`approved` (مباشرة وانطلاق) و`delivered` لكل طلب.
# تحديث API في v9

مرجع الصلاحيات والتدفق الحالي: [SUPPLY_V9.md](SUPPLY_V9.md). `POST /api/requests/:id/approve` لطلب وحدة يسمح لمسؤول قاعدتها أو القائد: المسؤول يعتمد ويصرف فوراً من مستودع قاعدته أو مراكزها، والقائد يكلّف القاعدة بالاعتماد العادي (`assigned`) أو يرسل فوراً إذا كانت الأولوية `emergency` أو الحمولة `dispatchNow: true`. `POST /api/requests/:id/execute` متاح لمسؤول القاعدة المعنية والقائد عندما يكون الطلب `assigned`؛ `operationKey` يمنع تكرار الخصم. طلب قاعدة من الرياض يقرره القائد وحده. `POST /api/inventory/add` للقائد وحده وسبب إلزامي، `external_add` يسجل `from.entityId: hq-riyadh`, `from.unlimited: true`, `to.entityId: <base>`. كل جهة لها `code` ثابت؛ الخريطة المفلترة تعرض الرياض لمسؤول القاعدة ولا تعرضها لمسؤول الوحدة. `PUT /api/layout` و`DELETE /api/entities/hq-riyadh` يرفضان تعديل/حذف مركز الرياض. التقرير الذكي (`/api/ops-reports`) ومسارات شات التقارير تسترجع من `AZM_RAG_URL` (BGE-M3: `POST /retrieve` و`GET /health`) أو محلياً عند تعذرها، بعقد `{question,filter,limit}` → `{chunks:[{id,text,metadata}]}` مع التحقق من النطاق.

# تعبئة مراكز الإمداد — تحديث v9

- `POST /api/entities` لمسؤول القاعدة: `type: 'unit'` فقط، والقاعدة قاعدته دائماً (قاعدة ثانية أو `sourceId` خارج مستودعات قاعدته أو نوع آخر ← `403`). بقية مسارات `/api/entities` للقائد فقط.
- `POST /api/entities`: المركز الجديد يستلم سعة كل صنف نشط من قاعدته فقط. تقبل العملية `operationKey`؛ الإعادة بنفس الحمولة تعيد نفس الجهة دون خصم جديد. نقص أي صنف يعيد `409 insufficient_stock` و`failures` تتضمن `resource`, `qty`, `available`, `missing`، دون إنشاء أو خصم جزئي.
- `PUT /api/layout`: يفحص إجمالي تجهيز المراكز والوحدات الجديدة لكل قاعدة وصنف قبل الكتابة. يدعم `operationKey` مع `baseVersion`؛ يعاد الرد المحفوظ قبل فحص تعارض النسخة عند إعادة نفس العملية.
- `POST /api/depots/:baseId/transfer`: تعبئة المركز تستخدم `{to, refill:true, items:[{resource,qty}], operationKey}`. المصدر يجب أن يكون القاعدة التابعة للمركز حصراً. الصلاحية للقائد أو مسؤول القاعدة في نطاقه؛ مسؤول الوحدة ممنوع. يحسب فحص السعة الوارد المعتمد بالطريق، وتُفحص الدفعة كاملة قبل الخصم. الرد المعتاد يحمل `opId`, `movements`, `depots`.



> **تحديث الوحدات v10:** جميع الأصناف النشطة مخصصة لكل وحدة، والوحدة الجديدة تبدأ بصفر. الاستهلاك من الرصيد المستلم وفق الكتالوج، مع احتياج وقود مشترك. راجع [UNIT_RESOURCES_V10.md](UNIT_RESOURCES_V10.md). حقول نوع الوقود التاريخية محفوظة للتوافق فقط.
# ربط الحسابات بالجهات الحية

`POST /api/users` و`PUT /api/users/:username` وموافقة التسجيل وتفعيل الحساب تتحقق في الخادم من الدور والجهة الحالية. `user` يتطلب `unitId` الثابت لوحدة حية ذات قاعدة حية؛ يحفظ الخادم `baseId` من تبعية الوحدة ويتجاهل قاعدة مخالفة يرسلها العميل. `base_manager` يتطلب `baseId` لقاعدة حية. `admin` بلا ربط، وتزال منه حقول الجهات. الاسم أو رمز العرض لا يستخدمان مفتاحاً للربط. تعديل الملف وحده لا يتجاوز فحص ربط غير صالح.

قائمة المستخدمين ترجع `assignmentValid` دون كلمة المرور. حذف الجهة لا يغيّر الربط ولا يختار جهة بديلة: الدخول يرجع `403 account_assignment_required`، والجلسة القائمة تفقد الوصول إلى كل API محمي (`401`) وينتهي اتصال الأحداث. يعاد فحص الحساب والجهة في كل طلب ونبضة اتصال. يمكن للقائد إعادة تعيين الحساب ليستعيد الدخول. تغيير الربط الصحيح يحدّث نطاق الجلسة الحالية والواجهة دون إنهاء جلسات الحسابات الأخرى. الحسابات القديمة التي لا تحمل `baseId` لمسؤول الوحدة تقرأ القاعدة من وحدتها، ويحفظ الربط الكامل عند التعديل التالي؛ القاعدة المحفوظة المخالفة تفشل مغلقاً.

# واجهة المحادثة المباشرة

نافذة مساعد عزم تستخدم `POST /api/chats` لبدء المحادثة و`POST /api/chats/:id/messages` لاستكمالها، بجسم `{text}`. لا ترسل اختيار وحدة أو نوع رسالة. `/api/ai/status` يعرض حالة نموذج المحادثة الأساسي (`AZM_AI_*`، محلياً 8002)، ولا يعرض أدابتر الطلب. تبقى مسارات استخراج المسودة و`AZM_REQUEST_AI_*` (محلياً 8002 باسم `azm-request-lora`) للتوافق دون خيار في هذه النافذة. الخادم يصغّر اللقطة المرسلة للنموذج (`AZM_AI_CONTEXT_CHARS`)، ويعيد المحاولة بحد أصغر إذا رد النموذج بأن السياق طويل (`ai_context_too_long`)؛ شكل الطلب والرد عبر API لم يتغير. التقرير الذكي (`/api/ops-reports`) و`/api/report-chats` وRAG مستقلة عن المحادثة.

أدوات القراءة تعيد اشتقاق النطاق من حساب الجلسة، وترفض معرّفات الوحدات والقواعد والمخزون والطلبات خارجه بـ`out_of_scope`؛ مسار `/api/ai/tools/read` يعيد HTTP 403. نص الرد للعرض والتحليل فقط ولا يُنفّذ كإجراء.

أداة القراءة الرابعة `read_locations` (`{ nodeId? }`) ترجع `{ total, locations: [{ id, name, type, code, lat, lng }], omitted }` (حتى 60 موقعاً)، و`type` واحد من `main_base` و`base` و`supply_point` و`unit`. نطاقها نفس نطاق الخريطة: القائد الكل، ومسؤول القاعدة قاعدته وتوابعها والقاعدة الرئيسية، ومسؤول الوحدة وحدته وسلسلة إمدادها. أي `nodeId` خارج النطاق يرجع `out_of_scope` (HTTP 403).

أداة القراءة الخامسة `read_users` (`{ username? }`) ترجع `{ total, users: [{ username, fullName, rank, role, status, unit, unitNodeId, base }], omitted }` (حتى 60 حساباً)، بدون كلمة المرور أو الرقم العسكري أو الجوال. نطاقها نفس صفحة الحسابات: القائد الكل، ومسؤول القاعدة حسابات قاعدته، ومسؤول الوحدة حسابه فقط. أي `username` خارج النطاق يرجع `out_of_scope` (HTTP 403).

