-- مخطط PostgreSQL مرجعي لنظام عَزْم | AZM
-- v9: رمز الجهة ثابت ومستقل عن اسمها، ومركز الرياض ثابت وغير محدود؛ الأرشفة
-- تحفظ التاريخ قبل حذف ملف SQLite الخاص بالجهة في التخزين الحالي.
-- يقابل state.audit الدائم؛ لا تُنسخ حركات المخزون إلى هذا الجدول.
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL,
  actor TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  type TEXT NOT NULL,
  reference TEXT,
  entity_id TEXT,
  unit_id TEXT,
  base_id TEXT,
  request_id TEXT,
  changes JSONB
);
CREATE TABLE request_operations (
  actor TEXT NOT NULL,
  operation_key VARCHAR(64) NOT NULL,
  signature TEXT NOT NULL,
  request_id TEXT NOT NULL,
  PRIMARY KEY (actor, operation_key)
);
-- مرجع مستقبلي فقط: التخزين الحالي قاعدة SQLite مستقلة لكل جهة في data/entities/ وفهرس مشترك في state.json.
-- غير مستخدم حالياً — للانتقال من ملفات JSON إلى قاعدة بيانات عند الحاجة.

-- ===== الحسابات (users.json) =====
CREATE TABLE users (
  username       VARCHAR(32)  PRIMARY KEY CHECK (username ~ '^[A-Za-z0-9_.-]{3,32}$'),
  password_hash  TEXT         NOT NULL,                      -- "salt:hash" (scrypt)
  role           VARCHAR(16)  NOT NULL CHECK (role IN ('admin', 'base_manager', 'user')),  -- القائد، مسؤول القاعدة، مسؤول الوحدة
  unit_id        VARCHAR(16),                                -- مطلوب لمسؤول الوحدة (user)
  base_id        VARCHAR(64),                                -- لمسؤول القاعدة؛ ولمسؤول الوحدة مشتق من قاعدتها وقت ربط الحساب. حذف الجهة يوقف الوصول ولا يعيد التعيين.
  status         VARCHAR(10)  NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'suspended', 'rejected')),
  full_name      VARCHAR(60),
  rank           VARCHAR(16),
  service_id     VARCHAR(15),
  phone          VARCHAR(16),
  position       VARCHAR(60),
  note           VARCHAR(500),
  reject_reason  VARCHAR(300),
  approved_by    VARCHAR(32) REFERENCES users(username),
  approved_at    TIMESTAMPTZ,
  suspended_by   VARCHAR(32) REFERENCES users(username),
  suspended_at   TIMESTAMPTZ,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- الرقم العسكري ما يتكرر (إلا للطلبات المرفوضة)
CREATE UNIQUE INDEX users_service_id_uq ON users(service_id) WHERE service_id IS NOT NULL AND status <> 'rejected';

-- ===== الخريطة والهيكل (state.layout) =====
CREATE TABLE map_nodes (
  id         VARCHAR(64) PRIMARY KEY,
  type       VARCHAR(4)  NOT NULL CHECK (type IN ('main', 'fsb', 'unit')),
  lat        DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng        DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  label      VARCHAR(80),
  label_key  VARCHAR(40),                                    -- مفتاح ترجمة للنقاط الافتراضية
  unit_id    VARCHAR(16) UNIQUE,                             -- للوحدات فقط (UNIT-NN)
  parent_id  VARCHAR(64) REFERENCES map_nodes(id) ON DELETE SET NULL,  -- التبعية القديمة (تُحدَّث تلقائياً للتوافق)
  base_id    VARCHAR(64) REFERENCES map_nodes(id),         -- القاعدة (للمركز والوحدة)
  supply_id  VARCHAR(64),                                  -- قديم فقط (معلومة) — مصدر كل شحنة على الطلب
  relation_source VARCHAR(12),                             -- admin | explicit | derived | default | from_supply | repaired | ambiguous | none
  created_at TIMESTAMPTZ, created_by VARCHAR(32),
  CHECK ((type = 'unit') = (unit_id IS NOT NULL)),
  CHECK (type <> 'main' OR (base_id IS NULL AND supply_id IS NULL)),
  CHECK (type = 'unit' OR supply_id IS NULL)
);
-- الكيانات المحذوفة من الخريطة (أرشفة — التاريخ والرصيد يبقون)
CREATE TABLE archived_entities (
  node_id     VARCHAR(64) PRIMARY KEY,
  node        JSONB NOT NULL,                              -- نسخة النقطة وقت الأرشفة (مع تبعيتها)
  balance     JSONB NOT NULL,                              -- الرصيد وقت الأرشفة
  archived_by VARCHAR(32), archived_at TIMESTAMPTZ NOT NULL
);
-- سجل تغيير التبعية (للتقارير التاريخية)
CREATE TABLE relation_log (
  id BIGSERIAL PRIMARY KEY, entity_id VARCHAR(64) NOT NULL, actor VARCHAR(32),
  before_base VARCHAR(64), before_supply VARCHAR(64), after_base VARCHAR(64), after_supply VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- سجل المخزون لكل كيان: السعة والرصيد الافتتاحي (بداية التتبع أو الإنشاء)
CREATE TABLE inventory_records (
  entity_id      VARCHAR(64) NOT NULL,
  resource       VARCHAR(8)  NOT NULL CHECK (resource IN ('ammo', 'fuel', 'food', 'medical')),
  capacity       NUMERIC(14,3) NOT NULL,
  opening_qty    NUMERIC(14,3) NOT NULL,
  opening_at     TIMESTAMPTZ NOT NULL,
  opening_source VARCHAR(10) NOT NULL CHECK (opening_source IN ('migration', 'initial', 'created')),
  created_by     VARCHAR(32),
  archived       BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (entity_id, resource)
);
CREATE TABLE map_links (
  id        VARCHAR(64) PRIMARY KEY,
  from_id   VARCHAR(64) NOT NULL REFERENCES map_nodes(id) ON DELETE CASCADE,
  to_id     VARCHAR(64) NOT NULL REFERENCES map_nodes(id) ON DELETE CASCADE,
  kind      VARCHAR(4)  NOT NULL CHECK (kind IN ('road', 'air')),
  geometry  JSONB,                                           -- [[lat,lng],...] شكل الطريق
  km        NUMERIC(10,1),
  approx    BOOLEAN NOT NULL DEFAULT false
);

-- ===== مخزون الوحدات (state.stocks) — نسبة مئوية من سعة الوحدة =====
CREATE TABLE unit_stocks (
  unit_id  VARCHAR(16) NOT NULL,
  resource VARCHAR(8)  NOT NULL CHECK (resource IN ('ammo', 'fuel', 'food', 'medical')),
  percent  NUMERIC(6,3) NOT NULL CHECK (percent BETWEEN 0 AND 100),
  PRIMARY KEY (unit_id, resource)
);
CREATE TABLE unit_profiles (                                -- يحدد السعة الفعلية
  unit_id  VARCHAR(16) PRIMARY KEY,
  people   INTEGER NOT NULL,
  vehicles INTEGER NOT NULL,
  optempo  VARCHAR(8) NOT NULL CHECK (optempo IN ('low', 'medium', 'high'))
);

-- ===== مستودعات القواعد ومراكز الإمداد (state.depots) — كميات فعلية =====
CREATE TABLE depots (
  node_id  VARCHAR(64) NOT NULL REFERENCES map_nodes(id) ON DELETE CASCADE,
  resource VARCHAR(8)  NOT NULL CHECK (resource IN ('ammo', 'fuel', 'food', 'medical')),
  quantity BIGINT      NOT NULL CHECK (quantity >= 0),
  capacity BIGINT      NOT NULL,
  PRIMARY KEY (node_id, resource)
);

-- ===== طلبات الإمداد (state.requests) =====
CREATE TABLE requests (
  deadline     VARCHAR(80),                                  -- موعد نصي اختياري؛ لا يفرضه النموذج ولا المجدول
  id           VARCHAR(20) PRIMARY KEY,                      -- ORD-AZM-NNN
  unit_id      VARCHAR(16),                                  -- null لاحتياج القاعدة
  kind         VARCHAR(4) NOT NULL DEFAULT 'unit' CHECK (kind IN ('unit', 'base')),
  target_id    VARCHAR(64),
  fulfillment  VARCHAR(24),                                  -- virtual_supply للتزويد الفوري الجديد
  supplied     JSONB, supply_op_id VARCHAR(16), supply_reason VARCHAR(300),
  base_id      VARCHAR(64),                                  -- نسخة التبعية وقت الإنشاء (للفلترة التاريخية)
  supply_id    VARCHAR(64),                                  -- قديم
  source_entity VARCHAR(64), source_base VARCHAR(64),         -- المصدر المختار للشحنة عند الاعتماد
  created_by_role VARCHAR(16),
  decided_by   VARCHAR(32), decided_at TIMESTAMPTZ, reject_reason VARCHAR(1000),
  cross_base   BOOLEAN NOT NULL DEFAULT false, cross_base_reason VARCHAR(300),
  priority     VARCHAR(10) NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent', 'emergency')),
  mode         VARCHAR(5)  NOT NULL CHECK (mode IN ('truck', 'heli')),
  notes        VARCHAR(1000),
  eta_hours    NUMERIC(8,2) NOT NULL,
  status       VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'delivered', 'rejected')),
  created_by   VARCHAR(32) REFERENCES users(username) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- عند الاعتماد
  from_node_id VARCHAR(64) REFERENCES map_nodes(id) ON DELETE SET NULL,
  from_label   VARCHAR(80),
  route_path   JSONB,
  route_km     INTEGER,
  depart_at    TIMESTAMPTZ,
  depart_sim   NUMERIC(14,4),                                -- ساعة المحاكاة عند الانطلاق
  delivered_at TIMESTAMPTZ
);
CREATE TABLE request_items (
  request_id     VARCHAR(20) NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  resource       VARCHAR(8)  NOT NULL CHECK (resource IN ('ammo', 'fuel', 'food', 'medical')),
  amount_percent SMALLINT    NOT NULL CHECK (amount_percent BETWEEN 5 AND 100),
  level_percent  SMALLINT    NOT NULL CHECK (level_percent BETWEEN 0 AND 100),
  qty_estimate   BIGINT,
  fill_to_limit  BOOLEAN NOT NULL DEFAULT FALSE,             -- items[].fill: اختيار التعبئة عند إنشاء الطلب
  approved_qty   BIGINT,                                     -- approvedItems[].qty، دون استبدال qty_estimate
  dispatched_qty BIGINT,                                     -- اللي انخصم فعلياً من المستودع عند الاعتماد
  delivered_qty  NUMERIC(14,3),                              -- اللي انضاف للوحدة عند التسليم
  measure        VARCHAR(16),                                -- round | liter | ration | medical_unit
  PRIMARY KEY (request_id, resource)
);
CREATE TABLE request_comments (
  id         BIGSERIAL PRIMARY KEY,
  request_id VARCHAR(20) NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  author     VARCHAR(32) REFERENCES users(username) ON DELETE SET NULL,
  role       VARCHAR(10) NOT NULL,
  kind       VARCHAR(10),                                    -- 'reject' لسبب الرفض
  text       VARCHAR(1000) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE request_history (                              -- تاريخ تغيّر حالة الطلب
  id BIGSERIAL PRIMARY KEY, request_id VARCHAR(20) NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  status VARCHAR(10) NOT NULL, actor VARCHAR(32), note VARCHAR(1000), priority VARCHAR(10), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== سجل حركات المخزون الدائم (state.movements) — مصدر التقارير =====
CREATE TABLE inventory_movements (
  id            VARCHAR(16) PRIMARY KEY,                     -- MV-NNNNNN
  type          VARCHAR(14) NOT NULL CHECK (type IN ('external_add', 'transfer', 'dispatch', 'delivery', 'return', 'consumption')),
  resource      VARCHAR(8)  NOT NULL CHECK (resource IN ('ammo', 'fuel', 'food', 'medical')),
  qty           NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  measure       VARCHAR(16) NOT NULL,
  from_entity   VARCHAR(64), from_base VARCHAR(64), from_before NUMERIC(14,3), from_after NUMERIC(14,3),
  from_type     VARCHAR(12), from_unlimited BOOLEAN,           -- virtual للمورد الافتراضي، hq للتاريخ فقط
  to_entity     VARCHAR(64), to_base VARCHAR(64), to_before NUMERIC(14,3), to_after NUMERIC(14,3),
  transit       JSONB,                                       -- الطرف الآخر للشحنة بالطريق (للإرسال والتسليم)
  cross_base    BOOLEAN NOT NULL DEFAULT false,
  actor         VARCHAR(32) NOT NULL,                        -- اسم المستخدم أو system أو simulation
  reason        VARCHAR(300),
  request_id    VARCHAR(20), op_id VARCHAR(16),              -- رقم الطلب أو العملية (TR-/EX-)
  sim_hours     NUMERIC(14,3),
  period_start  TIMESTAMPTZ,                                 -- للاستهلاك المجمّع
  created_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX inventory_movements_time ON inventory_movements(created_at);

-- v5: المصدر الافتراضي ليس صفاً في map_nodes ولا مستودعاً؛ الإضافة إلى main فقط.
-- تعريف الرياض وروابطه السابقة محفوظان خارج الخريطة لتسليم الشحنات القديمة.
CREATE TABLE legacy_supply_sources (
  id VARCHAR(64) PRIMARY KEY, node JSONB NOT NULL, links JSONB NOT NULL
);
CREATE TABLE supply_operations (
  operation_key VARCHAR(100) PRIMARY KEY,                     -- username:operationKey
  signature TEXT NOT NULL, result JSONB NOT NULL              -- منع تكرار التزويد بعد إعادة المحاولة أو التشغيل
);

-- ===== السجل والتنبيهات والمحاكاة =====
CREATE TABLE operation_logs (
  id         BIGSERIAL PRIMARY KEY,
  type       VARCHAR(12) NOT NULL CHECK (type IN ('submitted', 'approved', 'rejected', 'delivered', 'transfer', 'restock')),
  ref        VARCHAR(120) NOT NULL,                          -- رقم الطلب أو وصف التحويل
  unit_id    VARCHAR(16), base_ids JSONB,                    -- نطاق السطر (للفلترة حسب الصلاحية)
  actor      VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE stock_alerts (
  id         VARCHAR(24) PRIMARY KEY,
  unit_id    VARCHAR(16) NOT NULL,
  base_id    VARCHAR(64),                                    -- نسخة التبعية وقت التنبيه
  resource   VARCHAR(8)  NOT NULL,
  level      VARCHAR(10) NOT NULL CHECK (level IN ('warning', 'critical', 'depleted')),
  value      SMALLINT    NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE simulation_state (                             -- صف واحد فقط
  id         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  speed      SMALLINT NOT NULL DEFAULT 1 CHECK (speed IN (1, 5, 10, 20)),
  emergency  BOOLEAN  NOT NULL DEFAULT false,
  hours      NUMERIC(14,4) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== المساعد الذكي (chats.json) =====
CREATE TABLE chats (
  id         VARCHAR(24) PRIMARY KEY,
  owner      VARCHAR(32) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  title      VARCHAR(60) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE chat_messages (
  id         BIGSERIAL PRIMARY KEY,
  chat_id    VARCHAR(24) NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role       VARCHAR(10) NOT NULL CHECK (role IN ('user', 'assistant')),
  kind       VARCHAR(16),                                    -- not_connected | ai_error
  model      VARCHAR(80),
  text       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== الجلسات (حالياً في الذاكرة) =====
CREATE TABLE sessions (
  token      CHAR(64) PRIMARY KEY,
  username   VARCHAR(32) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  cookie_name VARCHAR(80) NOT NULL, -- azm_session_<tab>؛ اسم الكوكي المرتبط بالرمز، والجلسات حالياً في الذاكرة
  expires_at TIMESTAMPTZ NOT NULL
);
-- التموين الشامل: supplyOperations يحتفظ بمفتاح username:transfer:operationKey
-- وبصمة الحمولة ونتيجتها ضمن الحالة الحالية؛ كل مورد حركة مستقلة بنفس opId.

-- v8: دورة القرار ثم المباشرة وسياسة الموارد التشغيلية
-- requests.status: pending | assigned (قرار القائد بلا خصم) | approved (باشر مسؤول القاعدة: خصم وبالطريق) | delivered | rejected
-- requests: approvedItems JSON، executedBy TEXT، executedAt INTEGER، dispatchOpId TEXT، executorBaseId TEXT،
--           executionBlocked JSON، blockedAttempts JSON، previousDecisions JSON، legacyPolicy TEXT ('pre_v8')
-- layout node (unit): fuelType TEXT ('azm_diesel' | 'azm_gasoline' | 'none' | NULL = غير محدد)، fuelTypeSource TEXT
-- state: actionOperations JSON (منع تكرار الإجراءات)، policyV8 JSON (ملخص الترحيل)، sim.resumedAt / sim.lastGapMs
-- تعبئة المراكز تستخدم حركات transfer وopId ومفاتيح supplyOperations القائمة؛ لا تغيير في المخطط أو ترحيل للأرصدة.

-- v10: catalog.consumptionGroup = null | vehicle_fuel; all active keys assigned to every unit.
-- state.policyV10 records migration; missing stock keys start at zero, existing balances preserved.
-- دورة جديدة اختيارية: state.operationCycle JSON {id, startedAt, policy, startedBy}.
-- القاعدة الجديدة: balances تبدأ بصفر، ثم external_add من hq-riyadh، reason=base_initial_fill.
-- أداة البداية الجديدة تنسخ المجلد كاملاً خارج data مع manifest SHA-256؛ لا تغيير في جداول SQLite.
