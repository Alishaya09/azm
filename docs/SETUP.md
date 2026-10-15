# دليل التشغيل — عَزْم | AZM

هذا الدليل يوصلك من الصفر لين النظام يشتغل كامل على جهازك: الموقع، ومساعد الإمداد، واستخراج الطلب من الشات، والتقرير الذكي في سجل العمليات، واسترجاع المنهجية (RAG). ويشرح الإعدادات وحل المشاكل الشائعة.

> **تبي الموقع وحده؟** يكفيه Node.js: نفّذ [الخطوة 1](#1-المشروع-والحساب) ثم `node server.mjs`. يشتغل بدون Python ولا نموذج، والمساعد يظهر «غير مربوط».

---

## 0) الأجزاء الثلاثة

| الجزء | المنفذ | التشغيل | يحتاج |
|---|---|---|---|
| **النموذج** Qwen3-4B + LoRA (المساعد، التقارير، استخراج الطلب) | 8002 | `bash scripts/start-ai.sh` | Python + MLX + Apple Silicon أو NVIDIA |
| **RAG** BGE-M3 (استرجاع المنهجية) | 8010 | `bash scripts/start-rag.sh` | Python + PyTorch (على المعالج) |
| **الموقع** (الواجهة + الخادم) | 5182 | `start-azm.cmd` (Windows) / `bash start-azm.sh` (Mac/Linux) | Node.js فقط |

نسخة وحدة من النموذج على 8002 تخدم اسمين: `azm-request-lora` (الأدابتر مفعّل، لاستخراج الطلب) و `azm-report-base` (الأدابتر معطّل، للمساعد والتقارير). لذلك يكفي جهاز بذاكرة 8GB.

- إذا النموذج مو شغال: الموقع يشتغل، والمساعد والتقارير الذكية يظهرون غير متصلين.
- إذا RAG مو شغال: التقارير تشتغل عادي بالبحث المحلي في `resources/report-knowledge.json`.

---

## 1) المتطلبات

### هل جهازي يشغّل النموذج؟

| الجهاز | الموقع | النموذج | RAG |
|---|:---:|:---:|:---:|
| **Mac** بمعالج Apple Silicon (M1 أو أحدث) | ✅ | ✅ مباشرة | ✅ |
| **Windows** مع بطاقة **NVIDIA** (8GB VRAM أو أكثر) | ✅ | ✅ داخل WSL2 | ✅ داخل WSL2 |
| **Linux** مع بطاقة **NVIDIA** | ✅ | ✅ | ✅ |
| Windows بدون NVIDIA، أو Mac بمعالج Intel | ✅ | ❌ | ✅ |

النموذج يشتغل بمكتبة **MLX**: على Apple Silicon مباشرة (Metal)، وعلى Linux مع NVIDIA عبر CUDA 12. على ويندوز يكون Linux داخل WSL2.

### المختبر عليه (Windows)

| المتطلب | المختبر عليه | ملاحظات |
|---|---|---|
| Windows | Windows 11 + WSL2 (Ubuntu 24.04) | |
| بطاقة رسوميات | NVIDIA RTX 5050 Laptop، **8GB** | تعريف NVIDIA حديث في ويندوز يدعم WSL. لا تثبّت تعريفاً داخل Ubuntu |
| ذاكرة RAM | 16GB (WSL يأخذ نحو 7.7GB) | النموذج نحو 3.5GB، وRAG نحو 2GB |
| مساحة قرص | نحو **12GB** | بيئة النموذج 4.4GB (مع CUDA) + النموذج 2.2GB + بيئة RAG 1.4GB + BGE-M3 نحو 2.3GB + كاش التنزيل |
| إنترنت | لأول إعداد فقط | بعده كل شي يشتغل بدون إنترنت، ما عدا صور الخريطة |

على Mac بيئة النموذج أصغر لأنها بدون مكتبات CUDA. الذاكرة الموحّدة المقترحة 16GB (8GB تكفي بدون RAG).

### البرامج

| البرنامج | Mac | Windows |
|---|---|---|
| **Node.js 24.15 أو أحدث** (مطلوب لـ `node:sqlite`) | [nodejs.org](https://nodejs.org) أو `brew install node` | [nodejs.org](https://nodejs.org) |
| **Python 3.12** (3.10 على الأقل) | `brew install python@3.12` | يأتي مع Ubuntu 24.04 داخل WSL |
| **WSL2 + Ubuntu 24.04** | — | في PowerShell كمسؤول: `wsl --install -d Ubuntu-24.04` ثم أعد تشغيل الجهاز |
| **python3-venv** | — | داخل Ubuntu: `sudo apt update && sudo apt install -y python3-venv python3-pip` |

**ما يحتاج** `npm install`: المشروع ما يعتمد على أي حزمة خارجية، ومكتبات الواجهة (React 18، Babel، Leaflet) موجودة في `vendor/`.

```bash
node --version      # v24.15 أو أحدث
python3 --version   # 3.12.x (على ويندوز: داخل Ubuntu)
nvidia-smi          # ويندوز/Linux فقط، داخل Ubuntu: لازم يظهر اسم البطاقة
```

### مكتبات Python: تثبّتها السكربتات تلقائياً، والقائمة للعلم

| البيئة | المكتبات | الملف |
|---|---|---|
| النموذج على Mac `~/azm-llm/venv` | `mlx` 0.32.3 · `mlx-lm` 0.32.0 (ومعها `transformers` · `huggingface_hub` · `sentencepiece` · `numpy`) | [scripts/requirements-mlx-mac.txt](../scripts/requirements-mlx-mac.txt) |
| النموذج على Windows/Linux `~/azm-llm/venv` | نفس المكتبات + `mlx-cuda-12` 0.32.3 ومكتبات `nvidia-*-cu12` 12.9 (CUDA داخل بايثون، بدون تثبيت CUDA على النظام). نسخ مجمّدة من البيئة المختبرة | [scripts/requirements-mlx.txt](../scripts/requirements-mlx.txt) |
| RAG `~/azm-rag-venv` | `torch` (نسخة **CPU** على Linux/WSL؛ من PyPI على Mac) · `sentence-transformers` | [rag/requirements.txt](../rag/requirements.txt) |

### النماذج

| النموذج | المصدر | المكان | الحجم |
|---|---|---|---|
| Qwen3-4B 4-bit | `mlx-community/Qwen3-4B-4bit` (ينزله `setup-ai.sh`) | `~/azm-llm/models/qwen3-4b-4bit` | 2.2GB |
| أدابتر LoRA لاستخراج الطلب | صفحة **Releases** في المستودع (`request-adapter.zip`) | `models/request-adapter/` | 59MB |
| BGE-M3 | `BAAI/bge-m3` (ينزل أول تشغيل لـ `start-rag.sh`) | `~/.cache/huggingface` | نحو 2.3GB |

---

## 2) الإعداد لأول مرة

> **على Windows:**
> - أوامر النموذج و RAG تنكتب في نافذة **Ubuntu** (اكتب `wsl` في CMD).
> - أوامر الموقع تنكتب في **CMD**.
> - المشروع اللي في `C:\AZM` يظهر داخل Ubuntu بالمسار `/mnt/c/AZM`.
> - **حط المشروع خارج OneDrive**، لأن المزامنة قد تفرّغ الملفات أثناء التشغيل.

### 1. المشروع والحساب

1. نزّل المشروع (git clone أو فك الضغط) في `C:\AZM` على ويندوز أو `~/AZM` على Mac.
2. نزّل `request-adapter.zip` من صفحة **Releases** وفكّه بحيث يصير:
   ```text
   models/request-adapter/adapters.safetensors
   models/request-adapter/adapter_config.json
   ```
3. أنشئ حساب القائد الخاص فيك **قبل أول تشغيل للخادم**:
   ```bash
   node scripts/setup.mjs
   ```
   | السؤال | مثال |
   |---|---|
   | Admin username | `ahmed.admin` (حروف إنجليزية أو أرقام) |
   | Full name | `أحمد السبيعي` |
   | Rank | `major`. الرتب المتاحة تطلع في السؤال، و Enter = عقيد |
   | Password | 8 أحرف على الأقل. ما تظهر وأنت تكتبها، وهذا طبيعي |
   | Demo user? | `y` إذا تبي حساب مستخدم تجريبي مرتبط بوحدة، و Enter = لا |

   إذا تخطيت هذي الخطوة، الخادم ينشئ في أول تشغيل حسابات بكلمات مرور عشوائية ويطبعها في الطرفية، وتلقاها كمان في `data/FIRST_RUN_CREDENTIALS.txt`. **احذف هذا الملف بعد ما تحفظها.**
4. تحقق إن النسخة سليمة (الاثنين لازم يطبعون `All checks passed`):
   ```bash
   node scripts/check.mjs
   node scripts/smoke-test.mjs
   ```

### 2. النموذج (مرة وحدة)

| Mac (Terminal) | Windows (Ubuntu) |
|---|---|
| `cd ~/AZM`<br>`bash scripts/setup-ai.sh` | `cd /mnt/c/AZM`<br>`bash scripts/setup-ai.sh` |

السكربت يتعرف على الجهاز تلقائياً:
- **Mac Apple Silicon:** يختار `python3.12` إذا موجود وإلا `python3` (لازم 3.10 أو أحدث)، ويثبّت `requirements-mlx-mac.txt`.
- **Mac Intel:** يطبع إن MLX ما يشتغل عليه ويقف. الموقع يشتغل بدون الذكاء الاصطناعي.
- **Linux / WSL:** يتأكد من `nvidia-smi` و `python3-venv`، ويثبّت `requirements-mlx.txt`.

بعدها ينشئ البيئة `~/azm-llm/venv` (أو `AZM_LLM_VENV`)، وينزّل Qwen3-4B-4bit إلى `~/azm-llm/models/qwen3-4b-4bit` (أو `AZM_MODEL_DIR`)، ويطبع `MLX OK` إذا البطاقة شغالة. ياخذ وقت حسب سرعة النت.

### 3. RAG

ما يحتاج أمر مستقل. أول مرة تشغّل `bash scripts/start-rag.sh` ينشئ البيئة `~/azm-rag-venv`، ويثبّت PyTorch وsentence-transformers، وينزّل BGE-M3، ويبني الفهرس `~/.azm-rag/index.sqlite`. أول تشغيل طويل، والمرات اللي بعده نحو نص دقيقة. التفاصيل في [RAG_SETUP.md](RAG_SETUP.md).

---

## 3) التشغيل اليومي: 3 نوافذ

> - كل خدمة في **نافذة خاصة فيها**، وتبقى مفتوحة.
> - **Ctrl+C في نافذة يوقف خدمتها**، فلا تكتب أوامر جديدة في نافذة شغّالة. افتح نافذة جديدة بدالها.
> - الترتيب: النموذج، ثم RAG، ثم الموقع.

| | Mac (3 نوافذ Terminal) | Windows | علامة الجاهزية |
|---|---|---|---|
| **1. النموذج** | `cd ~/AZM`<br>`bash scripts/start-ai.sh` | نافذة **Ubuntu**:<br>`cd /mnt/c/AZM`<br>`AZM_MAX_CONTEXT=7168 AZM_PROMPT_CACHE_SLOTS=1 bash scripts/start-ai.sh` | `"ready": true, "port": 8002` |
| **2. RAG** | `cd ~/AZM`<br>`bash scripts/start-rag.sh` | نافذة **Ubuntu** ثانية:<br>`cd /mnt/c/AZM`<br>`bash scripts/start-rag.sh` | `"ready": true, "port": 8010` |
| **3. الموقع** | `cd ~/AZM`<br>`bash start-azm.sh` | نافذة **CMD**:<br>`cd /d C:\AZM`<br>`start-azm.cmd` | الموقع على `http://localhost:5182` |

- `start-azm.cmd` و `start-azm.sh` يضبطون كل الإعدادات بنفسهم (نفس القيم في الاثنين): النموذج على 8002، وRAG على 8010، والمنفذ 5182، والبيانات في مجلد `data` داخل المشروع. ما تحتاج `.env`.
- على بطاقة 8GB استخدم `AZM_MAX_CONTEXT=7168 AZM_PROMPT_CACHE_SLOTS=1` كما في الجدول. مع ذاكرة أكبر تقدر تشغّله بدونها (الافتراضي 6144 و 2).
- الأسماء القديمة `start-ai-wsl.sh` و `start-rag-wsl.sh` و `setup-models-wsl.sh` باقية للتوافق وتشغّل نفس السكربتات.

### التأكد إن كل شي شغال

```bash
curl http://127.0.0.1:8002/v1/models   # لازم يرجّع azm-request-lora و azm-report-base
curl http://127.0.0.1:8010/health      # {"ok": true, "model": "BAAI/bge-m3", "chunks": 14}
```

في الموقع، صفحة **سجل العمليات**، فوق لوحة «التقرير الذكي للعمليات» لازم تشوف نقطتين خضر: **متصل — azm-report-base** و **مرجع المنهجية: BGE-M3 متصل (14 فقرة)**. بعدها جرّب المساعد (الزر الدائري)، وزر 📈 جنب أي عملية في سجل العمليات.

**جولة سريعة:** لوحة التحكم (الوحدات يسار، الخريطة بالنص، الطلبات يمين، والسرعة فوق يمين)، إنشاء طلب إمداد ثم اعتماده ومتابعة القافلة على الخريطة، صفحة القواعد، صفحة المستخدمين. السيناريوهات خطوة بخطوة في [SCENARIOS.md](SCENARIOS.md).

---

## 4) الإعدادات

`start-azm.cmd` / `start-azm.sh` يكفون للتشغيل المعتاد. لتشغيل `node server.mjs` مباشرة بإعدادات أخرى:

1. انسخ `.env.example` باسم `.env` في جذر المشروع (فيه كل المتغيرات مع شرحها).
2. عدّل القيم اللي تحتاجها.
3. أعد تشغيل الخادم.

متغيرات النظام تغلب قيم `.env`. أهمها:

| المتغير | الافتراضي في الخادم | في `start-azm` | الوصف |
|---|---|---|---|
| `PORT` | `5173` | `5182` | منفذ الموقع |
| `HOST` | `0.0.0.0` | — | `0.0.0.0` متاح للأجهزة الأخرى على الشبكة، و `127.0.0.1` لهذا الجهاز فقط |
| `AZM_DATA_DIR` | `./data` | `data` داخل المشروع | مكان حفظ البيانات |
| `AZM_ADMIN_PASSWORD` | عشوائية | — | كلمة مرور المسؤول عند **أول** تشغيل فقط |
| `AZM_HOUR_MS` | `60000` | — | مدة الساعة التشغيلية بالمللي ثانية |
| `AZM_AI_*` | `none` | 8002 `azm-report-base` | المساعد الذكي — [AI_INTEGRATION.md](AI_INTEGRATION.md) |
| `AZM_REQUEST_AI_*` | مثل `AZM_AI_*` | 8002 `azm-request-lora` | استخراج الطلب (Temperature مثبتة على 0) |
| `AZM_REPORT_AI_*` | `none` | 8002 `azm-report-base` | التقرير الذكي في سجل العمليات |
| `AZM_RAG_URL` | فارغ | `http://127.0.0.1:8010` | خدمة BGE-M3؛ بدونها بحث محلي |

متغيرات سكربتات Python: `AZM_LLM_VENV`، `AZM_MODEL_DIR`، `AZM_ADAPTER_DIR`، `AZM_MODEL_PORT`، `AZM_MAX_CONTEXT`، `AZM_PROMPT_CACHE_SLOTS` (للنموذج)، و `AZM_RAG_VENV`، `AZM_RAG_PORT`، `AZM_RAG_DEVICE` (لـ RAG).

يمكن أيضاً تمرير المتغيرات مباشرة:

```powershell
# PowerShell (Windows)
$env:PORT="8080"; $env:AZM_ADMIN_PASSWORD="<choose-a-strong-password>"; node server.mjs
```

```bash
# macOS / Linux
PORT=8080 AZM_ADMIN_PASSWORD=<choose-a-strong-password> node server.mjs
```

---

## 5) الوصول من أجهزة أخرى، وأكثر من حساب

1. خلّ `HOST=0.0.0.0` (الافتراضي).
2. اعرف عنوان جهازك: `ipconfig` في Windows، أو `ip addr` في Linux، أو `ipconfig getifaddr en0` في Mac.
3. من الجهاز الثاني افتح `http://<عنوان-جهازك>:5182`.
4. إذا ما فتح، اسمح للمنفذ في جدار الحماية.

**القائد ومسؤول القاعدة ومسؤول الوحدة بنفس الوقت:** خادم واحد فقط. افتح العنوان نفسه في ثلاثة تبويبات وسجّل حساباً مختلفاً في كل منها. لكل تبويب جلسة مستقلة، وتحديث الصفحة لا يغير حسابه، وخروجه لا يخرج الآخرين. التحديثات تظهر تلقائياً كل 3 ثوانٍ حسب صلاحية التبويب.

> **لا تشغّل خادمين على نفس مجلد البيانات.** كل خادم يحتفظ بنسخته في الذاكرة ويكتب فوق حفظ الثاني. الخادم يقفل المجلد (`data/.server.lock`) ويرفض تشغيل خادم ثاني عليه برسالة واضحة، ولو غيّر برنامج ثاني ملفات البيانات يحفظ نسختها في `data/backups/*-external-change.json` قبل الكتابة.

---

## 6) الحسابات والبيانات

- من حساب القائد افتح تبويب **👥 المستخدمين**: أضف حساب بأحد الأدوار الثلاثة (القائد الرئيسي، مسؤول القاعدة مع قاعدته، مسؤول الوحدة مع وحدته)، أو غيّر كلمة مرور، أو احذف حساب.
- **نسيت كلمة مرور المسؤول؟** أوقف الخادم ثم `node scripts/setup.mjs --reset-admin`. يعيد تعيين كلمة المرور، أو ينشئ مسؤول جديد إذا الاسم غير موجود، وكل البيانات تبقى.

| العملية | الطريقة |
|---|---|
| نسخة احتياطية | انسخ مجلد `data/` والخادم متوقف |
| دورة جديدة بعد حذف الجهات | لا تحذف ملفات البيانات يدوياً: اتبع [NEW_CYCLE.md](NEW_CYCLE.md) |
| تصفير كل شي | أوقف الخادم واحذف مجلد `data/` |
| مشاركة المشروع | `npm run package` (أو `node scripts/package.mjs`): ينشئ zip **بدون** `data/` و `.env` |
| عرض محتوى قواعد البيانات | `node scripts/db-inspect.mjs` (قراءة فقط) |

---

## 7) التحقق والنسخة الثابتة

```bash
node scripts/check.mjs       # فحص الكود بدون تشغيل
node scripts/smoke-test.mjs  # خادم مؤقت ببيانات مؤقتة يختبر كل الوظائف ويطبع All checks passed (ما يلمس بياناتك)
npm run build                # اختياري: ينسخ الواجهة والمكتبات إلى dist/
npm run preview              # يشغّل الخادم ويقدّم الواجهة من dist/
```

---

## 8) حل المشاكل الشائعة

| المشكلة | السبب والحل |
|---|---|
| المساعد يقول «غير مربوط» أو «غير متاح» | نافذة النموذج مو شغالة أو ما وصلت لـ «جاهز». افتح `http://127.0.0.1:8002/v1/models`. مع `node server.mjs` بدون إعدادات هذا الوضع الافتراضي |
| المساعد يرد «تعذّر الحصول على رد» | النموذج مربوط لكنه ما رد. راجع رسالة `[AI]` في طرفية الخادم، وسبب الفشل يُطبع في نافذة النموذج |
| «BGE-M3 لا يستجيب — يُستخدم البحث المحلي» | نافذة RAG مقفلة. شغّل `bash scripts/start-rag.sh` في نافذة جديدة. ما تحتاج تعيد تشغيل الموقع |
| `الأدابتر غير موجود` | تأكد من مسار `models/request-adapter/adapters.safetensors` (الخطوة 1) |
| `nvidia-smi` غير موجود داخل WSL | حدّث تعريف NVIDIA في ويندوز نفسه وأعد تشغيل الجهاز |
| `out of memory` في نافذة النموذج | استخدم `AZM_MAX_CONTEXT=7168 AZM_PROMPT_CACHE_SLOTS=1`، وسكّر البرامج اللي تستهلك بطاقة الرسوميات |
| `OSError: [Errno 98] Address already in use` | الخدمة شغالة أصلاً في نافذة ثانية. كمّل عادي، أو أوقفها: `pkill -f serve-mlx.py` للنموذج، أو `pkill -f rag/service.py` لـ RAG |
| `another AZM server is already running on this data folder` | الموقع شغال في نافذة ثانية. Ctrl+C في نافذته، أو `taskkill /PID <الرقم> /F` |
| `EADDRINUSE` / المنفذ 5182 مستخدم | Windows: `netstat -ano \| findstr :5182` ثم `taskkill /F /PID <رقم>`<br>Mac: `lsof -i :5182` ثم `kill <رقم>` |
| `BrokenPipe` في نافذة RAG | طبيعي وما يأثر على عمل الخدمة |
| `Command 'wsl' not found` | كتبت `wsl` وأنت داخل Ubuntu أصلاً. تجاهلها وكمّل |
| `'C:\...' is not recognized` أو `syntax of the command is incorrect` | نسخت سطر المسار المنتهي بـ `>` مع الأمر. انسخ الأمر نفسه فقط |
| ملف `.cmd` ما يطبع شي | الملف انفرغ (حصل مع OneDrive). انقل المشروع خارج OneDrive أو أعد التنزيل |
| `bash\r: No such file` أو `$'\r': command not found` | السكربت انحفظ بنهايات أسطر ويندوز. `.gitattributes` يمنع هذا مع git؛ أعد التنزيل بـ git clone |
| `npm.ps1 cannot be loaded` | سياسة PowerShell. استخدم `node` مباشرة، أو `npm.cmd`، أو `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `node` يقول إن الإصدار قديم | ثبّت Node.js 24.15 أو أحدث |
| عدّلت ملف ولا تغيّر شي | ملفات `src/` تكفيها إعادة تحميل الصفحة (Ctrl+F5). أي تعديل في `server/` أو `.env` **يحتاج إعادة تشغيل الخادم** |
| «بيانات الطلب غير مكتملة» بعد تحديث النظام | الخادم القديم لسا شغّال. أعد تشغيله |
| قواعد محفوظة ولا تظهر على الخريطة | تأكد أن الخادم على المنفذ المفتوح يقرأ مجلد البيانات نفسه: قارن `netstat -ano \| findstr :5182` مع `type "%AZM_DATA_DIR%\.server.lock"`. إذا اختلف رقم العملية، أوقف النسخة الأخرى وشغّل نسخة واحدة، ثم `Ctrl+F5`. لا تعِد تهيئة البيانات |
| الخريطة رمادية أو فاضية | ما فيه إنترنت لصور الخريطة. النقاط والخطوط تشتغل عادي |
| المسار البري خط مستقيم «تقريبي» | خدمة OSRM ما ردت. أعد تحريك النقطة لاحقاً |
| «محاولات كثيرة، حاول بعد 15 دقيقة» | 10 محاولات دخول خاطئة من نفس الجهاز. انتظر، أو أعد تشغيل الخادم |
| لا يوجد Apple Silicon ولا NVIDIA | شغّل الموقع لحاله: `node server.mjs`، والمساعد يظهر غير مربوط |

---

## 9) وين ألقى التفاصيل

| الملف | المحتوى |
|---|---|
| [../README.md](../README.md) | نظرة عامة، النتائج، والتشغيل المختصر |
| [FEATURES.md](FEATURES.md) | المزايا والأدوار والتخزين بالتفصيل |
| [AI_INTEGRATION.md](AI_INTEGRATION.md) | إعدادات النماذج وحدود السياق |
| [RAG_SETUP.md](RAG_SETUP.md) | RAG بالتفصيل: المرجع، تحديثه، الصلاحيات |
| [SCENARIOS.md](SCENARIOS.md) | سيناريوهات الاستخدام خطوة بخطوة |
| [API.md](API.md) / [DATABASE.md](DATABASE.md) | مرجع الواجهات وقواعد البيانات |
| [DEVELOPMENT.md](DEVELOPMENT.md) | قواعد إلزامية لأي تعديل على الكود |
