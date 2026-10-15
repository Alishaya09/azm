# Request-extraction evaluation

- Data: `training/data/valid.jsonl` (200 examples the model never trained on)
- Server: http://127.0.0.1:8002/v1 · Temperature 0 · same prompt as the server
- Date: 2026-10-15 11:16

## Result

| Metric | azm-request-lora | azm-report-base |
|---|---:|---:|
| **Exact match** (all fields except the item-name text) | **95.5%** | **4.0%** |
| Valid JSON | 100.0% | 100.0% |
| Correct number of items | 99.0% | 96.5% |
| Item name (exact text) | 99.1% | 15.1% |
| Supply class | 99.4% | 48.3% |
| Quantity | 98.3% | 94.0% |
| Unit of measure | 98.0% | 63.6% |
| Priority | 99.5% | 72.0% |
| Deadline | 99.5% | 58.0% |
| Average response time | 1.2 s | 1.4 s |

## After the server guardrails

What actually reaches the user after automatic corrections and stops for confirmation (server/ai/request-evidence.mjs + the «not urgent» correction + catalog class).

| Metric | azm-request-lora | azm-report-base |
|---|---:|---:|
| **Correct request passes directly** | **96.5%** | **8.5%** |
| Error caught: the server asked the user or rejected | 3.5% | 82.5% |
| **Error that passes unnoticed** | **0.0%** | **9.0%** |
| Correct request wrongly stopped by the guardrails | 0 | 5 |

<details><summary>azm-report-base: errors that passed unnoticed (18)</summary>

- **val-0007**: من فصيل الصيانة: التسليم عند البوابة الشمالية نبي 25 كيس رز الأسبوع القادم والله يحفظكم
  - expected: `{"items":[{"item":"rice","supply_class":"I","quantity":25,"unit_of_measure":"bag"}],"priority":null,"deadline":"next week"}`
  - after guardrails: `{"items":[{"item":"rice","supply_class":"I","quantity":25,"unit_of_measure":"bag"}],"priority":"normal","deadline":"next week"}`
- **val-0010**: الأصناف المطلوبة:
1) كيس نوم عدد (50)
2) حقيبة إسعاف: 35
الموعد: خلال 3 أيام
  - expected: `{"items":[{"item":"sleeping bag","supply_class":"II","quantity":50,"unit_of_measure":"piece"},{"item":"first aid kit","supply_class":"VIII","quantity":35,"unit_of_measure":"kit"}],"priority":null,"deadline":"within 3 days"}`
  - after guardrails: `{"items":[{"item":"sleeping bag","supply_class":"II","quantity":50,"unit_of_measure":"bag"},{"item":"first aid kit","supply_class":"VIII","quantity":35,"unit_of_measure":"kit"}],"deadline":"within 3 days"}`
- **val-0033**: Resupply request:
- Motor oil: 10 cans
PRIORITY: HIGH
  - expected: `{"items":[{"item":"engine oil","supply_class":"III","quantity":10,"unit_of_measure":"can"}],"priority":"high","deadline":null}`
  - after guardrails: `{"items":[{"item":"motor oil","supply_class":"III","quantity":10,"unit_of_measure":"jerrycan"}],"priority":"high","deadline":null}`
- **val-0044**: From 2nd Company: please deliver 350 MREs, 44 coils of barbed wire, and 40 pairs of work gloves It's for the new site Thanks
  - expected: `{"items":[{"item":"MRE","supply_class":"I","quantity":350,"unit_of_measure":"piece"},{"item":"barbed wire","supply_class":"IV","quantity":44,"unit_of_measure":"roll"},{"item":"work gloves","supply_class":"II","quantity":40,"unit_of_measure":"pair"}],"priority":null,"deadline":null}`
  - after guardrails: `{"items":[{"item":"MRE","supply_class":"I","quantity":350,"unit_of_measure":"piece"},{"item":"barbed wire","supply_class":"IV","quantity":44,"unit_of_measure":"coil"},{"item":"work gloves","supply_class":"II","quantity":40,"unit_of_measure":"pair"}],"priority":"normal","deadline":null}`
- **val-0047**: السلام عليكم ورحمة الله
طلب إمداد:
- كيس نوم: 37
موعد التسليم: اليوم
الأولوية - عالية
  - expected: `{"items":[{"item":"sleeping bag","supply_class":"II","quantity":37,"unit_of_measure":"piece"}],"priority":"high","deadline":"today"}`
  - after guardrails: `{"items":[{"item":"sleeping bag","supply_class":"II","quantity":37,"unit_of_measure":"bag"}],"priority":"high","deadline":"today"}`
- **val-0056**: مساء الخير، الاستلام من المستودع الرئيسي. نطلب باليت مياه شرب واحد. ياليت توصل خلال ثلاث أيام.
  - expected: `{"items":[{"item":"bottled water","supply_class":"I","quantity":1,"unit_of_measure":"pallet"}],"priority":null,"deadline":"within 3 days"}`
  - after guardrails: `{"items":[{"item":"water","supply_class":"I","quantity":1,"unit_of_measure":"liter"}],"priority":"normal","deadline":"within 3 days"}`
- **val-0067**: السلام عليكم، ابغى ٦٠ بدلة ميدان خلال ٣ أيام، مهم الطلب للسرية الثالثة والله يحفظكم
  - expected: `{"items":[{"item":"combat uniform","supply_class":"II","quantity":60,"unit_of_measure":"piece"}],"priority":"high","deadline":"within 3 days"}`
  - after guardrails: `{"items":[{"item":"field uniform","supply_class":"II","quantity":60,"unit_of_measure":"piece"}],"priority":"normal","deadline":"within 3 days"}`
- **val-0068**: good morning, need 40 litres of hydraulic fluid required tonight over
  - expected: `{"items":[{"item":"hydraulic fluid","supply_class":"III","quantity":40,"unit_of_measure":"liter"}],"priority":null,"deadline":"tonight"}`
  - after guardrails: `{"items":[{"item":"hydraulic fluid","supply_class":"III","quantity":40,"unit_of_measure":"liter"}],"priority":"urgent","deadline":"tonight"}`
- **val-0081**: To logistics: Please provide 450 MREs. Delivery required by EOD. Thx.
  - expected: `{"items":[{"item":"MRE","supply_class":"I","quantity":450,"unit_of_measure":"piece"}],"priority":null,"deadline":"today"}`
  - after guardrails: `{"items":[{"item":"MRE","supply_class":"I","quantity":450,"unit_of_measure":"piece"}],"priority":"urgent","deadline":"today"}`
- **val-0090**: Send us 1600 sand bags asap.
  - expected: `{"items":[{"item":"sandbag","supply_class":"IV","quantity":1600,"unit_of_measure":"piece"}],"priority":"urgent","deadline":null}`
  - after guardrails: `{"items":[{"item":"sand bag","supply_class":"IV","quantity":1600,"unit_of_measure":"bag"}],"priority":"urgent","deadline":"today"}`
- **val-0100**: نبي 29 جالون ديزل، مهم المطلوب توصل خلال يومين الاستلام من المستودع الرئيسي الله يعطيكم العافية
  - expected: `{"items":[{"item":"diesel","supply_class":"III","quantity":29,"unit_of_measure":"jerrycan"}],"priority":"high","deadline":"within 48 hours"}`
  - after guardrails: `{"items":[{"item":"diesel","supply_class":"III","quantity":29,"unit_of_measure":"barrel"}],"priority":"urgent","deadline":"tomorrow"}`
- **val-0105**: Important: we need 46 boxes of medical gloves + 27 bbl of diesel fuel. We have 3 trucks down.
  - expected: `{"items":[{"item":"medical gloves","supply_class":"VIII","quantity":46,"unit_of_measure":"box"},{"item":"diesel","supply_class":"III","quantity":27,"unit_of_measure":"barrel"}],"priority":"high","deadline":null}`
  - after guardrails: `{"items":[{"item":"medical gloves","supply_class":"VIII","quantity":46,"unit_of_measure":"box"},{"item":"diesel fuel","supply_class":"III","quantity":27,"unit_of_measure":"bbl"}],"priority":"normal","deadline":null}`
- **val-0117**: 1st Platoon here, can you send 5 cartons of dates immediately. Regards.
  - expected: `{"items":[{"item":"dates","supply_class":"I","quantity":5,"unit_of_measure":"carton"}],"priority":"urgent","deadline":null}`
  - after guardrails: `{"items":[{"item":"dates","supply_class":"I","quantity":5,"unit_of_measure":"carton"}],"priority":"urgent","deadline":"today"}`
- **val-0119**: LOG REQUEST:
- Bottled water: 194 cartons
PRIORITY: ROUTINE
  - expected: `{"items":[{"item":"bottled water","supply_class":"I","quantity":194,"unit_of_measure":"carton"}],"priority":"normal","deadline":null}`
  - after guardrails: `{"items":[{"item":"bottled water","supply_class":"I","quantity":194,"unit_of_measure":"carton"}],"priority":"routine","deadline":null}`
- **val-0120**: السلام عليكم ورحمة الله وبركاته، يرجى صرف 10 علب قفازات لاتكس الأسبوع القادم. ولكم جزيل الشكر.
  - expected: `{"items":[{"item":"medical gloves","supply_class":"VIII","quantity":10,"unit_of_measure":"box"}],"priority":null,"deadline":"next week"}`
  - after guardrails: `{"items":[{"item":"latex gloves","supply_class":"VIII","quantity":10,"unit_of_measure":"pair"}],"priority":"normal","deadline":"next week"}`
- **val-0173**: إلى قسم الإمداد: نطلب تأمين 26 كيس رز و 20 تاير شاحنة.
  - expected: `{"items":[{"item":"rice","supply_class":"I","quantity":26,"unit_of_measure":"bag"},{"item":"truck tire","supply_class":"IX","quantity":20,"unit_of_measure":"piece"}],"priority":null,"deadline":null}`
  - after guardrails: `{"items":[{"item":"rice","supply_class":"I","quantity":26,"unit_of_measure":"bag"},{"item":"truck tire","supply_class":"IX","quantity":20,"unit_of_measure":"pair"}],"priority":null,"deadline":null}`
- **val-0174**: Supply request:
- Rice: 350 kg
- Diesel fuel: 1600 liters
NEEDED: within 2 days
  - expected: `{"items":[{"item":"rice","supply_class":"I","quantity":350,"unit_of_measure":"kg"},{"item":"diesel","supply_class":"III","quantity":1600,"unit_of_measure":"liter"}],"priority":null,"deadline":"within 48 hours"}`
  - after guardrails: `{"items":[{"item":"Rice","supply_class":"I","quantity":350,"unit_of_measure":"kg"},{"item":"Diesel fuel","supply_class":"III","quantity":1600,"unit_of_measure":"liter"}],"priority":"normal","deadline":"within 2 days"}`
- **val-0200**: السلام عليكم ورحمة الله وبركاته، نحتاج إلى 30 جالون ديزل. الطلب عاجل جداً. مع خالص التحية.
  - expected: `{"items":[{"item":"diesel","supply_class":"III","quantity":30,"unit_of_measure":"jerrycan"}],"priority":"urgent","deadline":null}`
  - after guardrails: `{"items":[{"item":"diesel","supply_class":"III","quantity":30,"unit_of_measure":"barrel"}],"priority":"urgent","deadline":null}`

</details>

## Exact match by language and style

| Language / style (examples) | azm-request-lora | azm-report-base |
|---|---:|---:|
| lang:ar | 94.0% (150) | 2.0% (150) |
| lang:en | 100.0% (50) | 10.0% (50) |
| style:ar_dialect | 94.0% (83) | 0.0% (83) |
| style:ar_formal | 92.1% (38) | 5.3% (38) |
| style:ar_list | 96.6% (29) | 3.4% (29) |
| style:en_casual | 100.0% (32) | 12.5% (32) |
| style:en_formal | 100.0% (7) | 0.0% (7) |
| style:en_list | 100.0% (11) | 9.1% (11) |

## Most common errors: azm-request-lora

Format: expected ← model output

**supply_class:** `IV ← null` (1) · `I ← IV` (1)

**unit_of_measure:** `null ← piece` (2) · `piece ← null` (2) · `kit ← piece` (1) · `carton ← sheet` (1) · `null ← kit` (1)

**quantity:** `null ← 70` (1) · `70 ← null` (1) · `null ← 25` (1) · `25 ← null` (1) · `null ← 2` (1) · `null ← 60` (1)

**priority:** `normal ← urgent` (1)

**deadline:** `null ← tomorrow` (1)

<details><summary>Failed examples (9 in total, first 15)</summary>

- **val-0030** (ar_list): الطلب:
- حقيبه عده عدد (10)
  - expected: `{"items":[{"item":"tool kit","supply_class":"II","quantity":10,"unit_of_measure":"kit"}],"priority":null,"deadline":null}`
  - model: `{"items":[{"item":"counting bag","supply_class":"II","quantity":10,"unit_of_measure":"piece"}],"priority":null,"deadline":null}`
- **val-0061** (ar_formal): إلى قسم الإمداد: نرجو تزويدنا بـ ليات رديتر، وعدد (70) وتد خلال 3 أيام. الطلب ذو أولوية عالية. مع خالص التحية.
  - expected: `{"items":[{"item":"radiator hose","supply_class":"IX","quantity":null,"unit_of_measure":null},{"item":"barrier picket","supply_class":"IV","quantity":70,"unit_of_measure":"piece"}],"priority":"high","deadline":"within 3 days"}`
  - model: `{"items":[{"item":"radiator hose","supply_class":"IX","quantity":70,"unit_of_measure":"piece"}],"priority":"high","deadline":"within 3 days"}`
- **val-0079** (ar_formal): إلى قسم الإمداد: نحتاج إلى شوالات رمل وعدد (25) كشاف يدوي و9 علب زيت هيدروليك في مدة أقصاها أسبوع. ولكم جزيل الشكر.
  - expected: `{"items":[{"item":"sandbag","supply_class":"IV","quantity":null,"unit_of_measure":null},{"item":"flashlight","supply_class":"II","quantity":25,"unit_of_measure":"piece"},{"item":"hydraulic fluid","supply_class":"III","quantity":9,"unit_of_measure":"can"}],"priority":null,"deadline":"within a week"}`
  - model: `{"items":[{"item":"sandbag","supply_class":"IV","quantity":25,"unit_of_measure":"piece"},{"item":"flashlight","supply_class":"II","quantity":null,"unit_of_measure":null},{"item":"hydraulic fluid","supply_class":"III","quantity":9,"unit_of_measure":"can"}],"priority":null,"deadline":"within a week"}`
- **val-0088** (ar_dialect): عطونا خمسين علبة قفازات لاتكس، وسائل تبريد، ومستعجلين عليها. شاكرين لكم
  - expected: `{"items":[{"item":"medical gloves","supply_class":"VIII","quantity":50,"unit_of_measure":"box"},{"item":"coolant","supply_class":"III","quantity":null,"unit_of_measure":null}],"priority":"urgent","deadline":null}`
  - model: `{"items":[{"item":"medical gloves","supply_class":"VIII","quantity":50,"unit_of_measure":"box"},{"item":"coolant","supply_class":"III","quantity":null,"unit_of_measure":null},{"item":"first aid kit","supply_class":"VIII","quantity":null,"unit_of_measure":null}],"priority":"urgent","deadline":null}`
- **val-0131** (ar_dialect): مساء الخير، أبي 2 فلاتر هوا، وكراتين ماي، طلب روتيني. نحتاجها خلال ثلاث أيام. والله يحفظكم
  - expected: `{"items":[{"item":"air filter","supply_class":"IX","quantity":2,"unit_of_measure":"piece"},{"item":"bottled water","supply_class":"I","quantity":null,"unit_of_measure":"carton"}],"priority":"normal","deadline":"within 3 days"}`
  - model: `{"items":[{"item":"air filter","supply_class":"IX","quantity":2,"unit_of_measure":"piece"},{"item":"plywood","supply_class":"IV","quantity":2,"unit_of_measure":"sheet"}],"priority":"normal","deadline":"within 3 days"}`
- **val-0132** (ar_dialect): من السرية الثانيه: عاجل: نحتاج عشر اطقم فحمات بريك و ٤٠ كيس ارز وشكراً
  - expected: `{"items":[{"item":"brake pads","supply_class":"IX","quantity":10,"unit_of_measure":"set"},{"item":"rice","supply_class":"I","quantity":40,"unit_of_measure":"bag"}],"priority":"urgent","deadline":null}`
  - model: `{"items":[{"item":"brake pads","supply_class":"IX","quantity":10,"unit_of_measure":"set"},{"item":"rice","supply_class":"I","quantity":40,"unit_of_measure":"bag"}],"priority":"urgent","deadline":"tomorrow"}`
- **val-0141** (ar_formal): السلام عليكم، نحتاج إلى حقائب عدة، و100 لتر سائل تبريد غداً. الطلب عاجل جداً. ولكم جزيل الشكر.
  - expected: `{"items":[{"item":"tool kit","supply_class":"II","quantity":null,"unit_of_measure":null},{"item":"coolant","supply_class":"III","quantity":100,"unit_of_measure":"liter"}],"priority":"urgent","deadline":"tomorrow"}`
  - model: `{"items":[{"item":"tool kit","supply_class":"II","quantity":null,"unit_of_measure":"kit"},{"item":"coolant","supply_class":"III","quantity":100,"unit_of_measure":"liter"}],"priority":"urgent","deadline":"tomorrow"}`
- **val-0146** (ar_dialect): صباح الخير، نطلب علب قريس، 60 خوذة وخمس جالونات petrol بكرة، مو مستعجل. وشكراً
  - expected: `{"items":[{"item":"grease","supply_class":"III","quantity":null,"unit_of_measure":"can"},{"item":"helmet","supply_class":"II","quantity":60,"unit_of_measure":"piece"},{"item":"gasoline","supply_class":"III","quantity":5,"unit_of_measure":"jerrycan"}],"priority":"normal","deadline":"tomorrow"}`
  - model: `{"items":[{"item":"grease","supply_class":"III","quantity":60,"unit_of_measure":"can"},{"item":"helmet","supply_class":"II","quantity":60,"unit_of_measure":"piece"},{"item":"gasoline","supply_class":"III","quantity":5,"unit_of_measure":"jerrycan"}],"priority":"normal","deadline":"tomorrow"}`
- **val-0157** (ar_dialect): مو مستعجل: ابغى 70 لوح plywood، و15 كفر شاحنة. نحتاجها خلال ثلاثة أيام. الطلب للسرية الثالثة.
  - expected: `{"items":[{"item":"plywood","supply_class":"IV","quantity":70,"unit_of_measure":"sheet"},{"item":"truck tire","supply_class":"IX","quantity":15,"unit_of_measure":"piece"}],"priority":"normal","deadline":"within 3 days"}`
  - model: `{"items":[{"item":"plywood","supply_class":"IV","quantity":70,"unit_of_measure":"sheet"},{"item":"truck tire","supply_class":"IX","quantity":15,"unit_of_measure":"piece"}],"priority":"urgent","deadline":"within 3 days"}`

</details>

## Most common errors: azm-report-base

Format: expected ← model output

**supply_class:** `IX ← II` (64) · `IV ← II` (25) · `IX ← III` (22) · `VIII ← II` (20) · `VIII ← I` (17) · `III ← I` (9) · `IX ← I` (7) · `II ← I` (3)

**unit_of_measure:** `null ← piece` (14) · `piece ← bag` (13) · `jerrycan ← barrel` (8) · `can ← jerrycan` (7) · `piece ← liter` (7) · `piece ← set` (5) · `kit ← set` (5) · `kit ← piece` (5)

**quantity:** `null ← 1` (6) · `null ← 2` (3) · `100 ← 60` (1) · `60 ← 100` (1) · `null ← 70` (1) · `70 ← null` (1) · `null ← 3` (1) · `null ← 25` (1)

**priority:** `null ← normal` (30) · `high ← urgent` (9) · `null ← urgent` (8) · `high ← normal` (3) · `normal ← null` (2) · `normal ← urgent` (2) · `null ← tomorrow morning` (1) · `normal ← routine` (1)

**deadline:** `null ← today` (38) · `null ← tomorrow` (14) · `tomorrow ← today` (9) · `tomorrow morning ← today` (5) · `within 48 hours ← tomorrow` (5) · `within 24 hours ← today` (3) · `within a week ← next week` (3) · `within 48 hours ← within 2 days` (2)

<details><summary>Failed examples (192 in total, first 15)</summary>

- **val-0001** (en_casual): 1st Platoon here, requesting resupply of 70 sacks of IV fluid, high priority Per our previous request
  - expected: `{"items":[{"item":"IV saline","supply_class":"VIII","quantity":70,"unit_of_measure":"bag"}],"priority":"high","deadline":null}`
  - model: `{"items":[{"item":"IV fluid","supply_class":"III","quantity":70,"unit_of_measure":"bag"}],"priority":"high","deadline":"today"}`
- **val-0002** (ar_formal): نأمل توفير عدد (23) كيس نوم و عدد (2) لمبة كشاف. ونأمل أن يتم التسليم خلال أربع وعشرين ساعة. الأولوية: عالية.
  - expected: `{"items":[{"item":"sleeping bag","supply_class":"II","quantity":23,"unit_of_measure":"piece"},{"item":"headlight bulb","supply_class":"IX","quantity":2,"unit_of_measure":"piece"}],"priority":"high","deadline":"within 24 hours"}`
  - model: `{"items":[{"item":"nem","supply_class":"II","quantity":23,"unit_of_measure":"bag"},{"item":"lamp","supply_class":"II","quantity":2,"unit_of_measure":"set"}],"priority":"high","deadline":"within 24 hours"}`
- **val-0003** (ar_list): المطلوب:
- إطار شاحنة: 1
الأولوية - عالية
  - expected: `{"items":[{"item":"truck tire","supply_class":"IX","quantity":1,"unit_of_measure":"piece"}],"priority":"high","deadline":null}`
  - model: `{"items":[{"item":"إطار شاحنة","supply_class":"II","quantity":1,"unit_of_measure":"piece"}],"priority":"high","deadline":"tomorrow"}`
- **val-0004** (ar_formal): الرجاء إرسال ١٥ علبة ماي رديتر و ١٢٠ كرتون ماء. الطلب اعتيادي وغير مستعجل. وشكراً.
  - expected: `{"items":[{"item":"coolant","supply_class":"III","quantity":15,"unit_of_measure":"can"},{"item":"bottled water","supply_class":"I","quantity":120,"unit_of_measure":"carton"}],"priority":"normal","deadline":null}`
  - model: `{"items":[{"item":"may rdiتر","supply_class":"I","quantity":15,"unit_of_measure":"carton"},{"item":"ماء","supply_class":"I","quantity":120,"unit_of_measure":"carton"}],"priority":"normal","deadline":"next week"}`
- **val-0005** (ar_dialect): عاجل: ارسلوا لنا ٤٠ شمعة احتراق.
  - expected: `{"items":[{"item":"spark plug","supply_class":"IX","quantity":40,"unit_of_measure":"piece"}],"priority":"urgent","deadline":null}`
  - model: `{"items":[{"item":"wicks","supply_class":"II","quantity":40,"unit_of_measure":"piece"}],"priority":"urgent","deadline":"today"}`
- **val-0006** (ar_list): السلام عليكم ورحمة الله
المطلوب:
1) 270 وتد حديد
2) لمبات كشافات
الأولوية - قصوى
  - expected: `{"items":[{"item":"barrier picket","supply_class":"IV","quantity":270,"unit_of_measure":"piece"},{"item":"headlight bulb","supply_class":"IX","quantity":null,"unit_of_measure":null}],"priority":"urgent","deadline":null}`
  - model: `{"items":[{"item":"270 وتد حديد","supply_class":"II","quantity":270,"unit_of_measure":"piece"},{"item":"لمبات كشافات","supply_class":"II","quantity":null,"unit_of_measure":null}],"priority":"urgent","deadline":"today"}`
- **val-0007** (ar_dialect): من فصيل الصيانة: التسليم عند البوابة الشمالية نبي 25 كيس رز الأسبوع القادم والله يحفظكم
  - expected: `{"items":[{"item":"rice","supply_class":"I","quantity":25,"unit_of_measure":"bag"}],"priority":null,"deadline":"next week"}`
  - model: `{"items":[{"item":"rice","supply_class":"I","quantity":25,"unit_of_measure":"bag"}],"priority":"normal","deadline":"next week"}`
- **val-0009** (en_formal): Good morning. Requesting 6 vehicle batteries. Regards.
  - expected: `{"items":[{"item":"vehicle battery","supply_class":"IX","quantity":6,"unit_of_measure":"piece"}],"priority":null,"deadline":null}`
  - model: `{"items":[{"item":"vehicle batteries","supply_class":"II","quantity":6,"unit_of_measure":"piece"}],"priority":null,"deadline":null}`
- **val-0010** (ar_list): الأصناف المطلوبة:
1) كيس نوم عدد (50)
2) حقيبة إسعاف: 35
الموعد: خلال 3 أيام
  - expected: `{"items":[{"item":"sleeping bag","supply_class":"II","quantity":50,"unit_of_measure":"piece"},{"item":"first aid kit","supply_class":"VIII","quantity":35,"unit_of_measure":"kit"}],"priority":null,"deadline":"within 3 days"}`
  - model: `{"items":[{"item":"sleeping bag","supply_class":"II","quantity":50,"unit_of_measure":"bag"},{"item":"first aid kit","supply_class":"VIII","quantity":35,"unit_of_measure":"kit"}],"deadline":"within 3 days"}`
- **val-0011** (ar_list): طلب إمداد:
1) أحذية عسكرية: 50 زوج
2) خيمة: 14
3) سولار: 3800 لتر
الموعد: غداً
الأولوية: عادية
  - expected: `{"items":[{"item":"combat boots","supply_class":"II","quantity":50,"unit_of_measure":"pair"},{"item":"tent","supply_class":"II","quantity":14,"unit_of_measure":"piece"},{"item":"diesel","supply_class":"III","quantity":3800,"unit_of_measure":"liter"}],"priority":"normal","deadline":"tomorrow"}`
  - model: `{"items":[{"item":"أحذية عسكرية","supply_class":"II","quantity":50,"unit_of_measure":"pair"},{"item":"خيمة","supply_class":"II","quantity":14,"unit_of_measure":"set"},{"item":"سولار","supply_class":"III","quantity":3800,"unit_of_measure":"liter"}],"priority":"normal","deadline":"tomorrow"}`
- **val-0012** (ar_dialect): يا شباب، نبي 39 تاير شاحنة الاستلام من المستودع الرئيسي وشكراً
  - expected: `{"items":[{"item":"truck tire","supply_class":"IX","quantity":39,"unit_of_measure":"piece"}],"priority":null,"deadline":null}`
  - model: `{"items":[{"item":"39 تاير شاحنة","supply_class":"II","quantity":39,"unit_of_measure":"piece"}],"priority":null,"deadline":null}`
- **val-0013** (en_casual): From 2nd Company: can you send 20 coils of gauze bandages + more helmets Must arrive today
  - expected: `{"items":[{"item":"gauze bandage","supply_class":"VIII","quantity":20,"unit_of_measure":"roll"},{"item":"helmet","supply_class":"II","quantity":null,"unit_of_measure":null}],"priority":null,"deadline":"today"}`
  - model: `{"items":[{"item":"gauze bandages","supply_class":"VIII","quantity":20,"unit_of_measure":"coil"},{"item":"helmets","supply_class":"II","quantity":null,"unit_of_measure":"piece"}],"priority":"urgent","deadline":"today"}`
- **val-0014** (ar_list): الأصناف المطلوبة:
- إطار شاحنة عدد (40)
- خوذة عدد (40)
- فلتر ديزل: 25
الأولوية - عالية
  - expected: `{"items":[{"item":"truck tire","supply_class":"IX","quantity":40,"unit_of_measure":"piece"},{"item":"helmet","supply_class":"II","quantity":40,"unit_of_measure":"piece"},{"item":"fuel filter","supply_class":"IX","quantity":25,"unit_of_measure":"piece"}],"priority":"high","deadline":null}`
  - model: `{"items":[{"item":"إطار شاحنة","supply_class":"II","quantity":40,"unit_of_measure":"piece"},{"item":"خوذة","supply_class":"II","quantity":40,"unit_of_measure":"piece"},{"item":"فلتر ديزل","supply_class":"III","quantity":25,"unit_of_measure":"piece"}],"priority":"high","deadline":"tomorrow"}`
- **val-0015** (en_list): Supply request:
- 20 cans of grease
- Combat boots (qty TBD)
REQUIRED BY: by tonight
PRIORITY: IMMEDIATE
  - expected: `{"items":[{"item":"grease","supply_class":"III","quantity":20,"unit_of_measure":"can"},{"item":"combat boots","supply_class":"II","quantity":null,"unit_of_measure":null}],"priority":"urgent","deadline":"tonight"}`
  - model: `{"items":[{"item":"grease","supply_class":"III","quantity":20,"unit_of_measure":"jerrycan"},{"item":"combat boots","supply_class":"II","quantity":null,"unit_of_measure":"pair"}],"priority":"urgent","deadline":"tonight"}`
- **val-0017** (ar_dialect): عدد الأفراد عندنا 40. نحتاج 25 فلتر هواء و15 طقم فحمات فرامل.
  - expected: `{"items":[{"item":"air filter","supply_class":"IX","quantity":25,"unit_of_measure":"piece"},{"item":"brake pads","supply_class":"IX","quantity":15,"unit_of_measure":"set"}],"priority":null,"deadline":null}`
  - model: `{"items":[{"item":"filtered air","supply_class":"I","quantity":25,"unit_of_measure":"liter"},{"item":"brake sets","supply_class":"II","quantity":15,"unit_of_measure":"set"}],"priority":null,"deadline":null}`

</details>
