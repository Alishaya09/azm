// إعدادات الخادم: كل الثوابت ومتغيرات البيئة في مكان واحد.
// القيم تُقرأ من متغيرات البيئة أو من ملف .env في جذر المشروع (انظر .env.example).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// قارئ بسيط لملف .env (بدون مكتبات خارجية) — لا يغيّر متغير موجود مسبقاً في البيئة
const envFile = join(PROJECT_ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
const env = (name, fallback) => process.env[name] !== undefined && process.env[name] !== '' ? process.env[name] : fallback;

// ===== الخادم =====
export const PORT = Number(env('PORT', 5173));
export const HOST = env('HOST', '0.0.0.0');
// مجلد البيانات: الحسابات وحالة العمليات والمحادثات (لا يُقدَّم للمتصفح أبداً)
export const DATA_DIR = resolve(env('AZM_DATA_DIR', join(PROJECT_ROOT, 'data')));
// كلمة مرور المسؤول عند أول تشغيل فقط (إذا ما فيه data/users.json)
export const FIRST_ADMIN_PASSWORD = env('AZM_ADMIN_PASSWORD', null);
// المجلدات اللي يقدر المتصفح يطلب ملفاتها — غيرها يرجع index.html
export const PUBLIC_DIRS = ['src', 'vendor'];
export const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jsx': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

// ===== المحاكاة =====
// مدة العرض: كل ساعة تشغيلية = دقيقة فعلية. الواجهة تستلم هذي القيمة من الخادم تلقائياً.
export const HOUR_MS = Number(env('AZM_HOUR_MS', 60000));
export const DEFAULT_UNITS = ['UNIT-01', 'UNIT-02', 'UNIT-03'];
export const MODES = ['truck', 'heli'];
export const PRIORITIES = ['normal', 'urgent', 'emergency'];
// 0 = المحاكاة متوقفة (لا وقت ولا استهلاك ولا تقدم للقوافل)
export const SPEEDS = [0, 1, 5, 10, 20];
// people/vehicles تحدد سعة الوحدة الفعلية حسب أساس كل صنف في الكتالوج (server/store/catalog.mjs) — نفس القيم في src/domain/units.jsx
// ملفات الوحدات الافتراضية للأفراد والمركبات فقط؛ الأرصدة من الحركات والكتالوج.
export const UNIT_START = {
  'UNIT-01': { people: 850, vehicles: 45, optempo: 'medium' },
  'UNIT-02': { people: 620, vehicles: 120, optempo: 'low' },
  'UNIT-03': { people: 1200, vehicles: 80, optempo: 'high' },
};
export const NEW_UNIT_START = { people: 500, vehicles: 40, optempo: 'medium' };
// ===== المستودعات والأصناف =====
// الأصناف وسعاتها ووحدات قياسها ومعدلات استهلاكها في كتالوج الموارد (server/store/catalog.mjs) — القائد يعدّلها.
// المستودع اللي ينشأ من الخريطة القديمة بدون رصيد افتتاحي يبدأ بـ 80% من سعته
export const DEPOT_START_RATIO = 0.8;
// الاستهلاك المحاكى يُجمَّع لكل وحدة ومورد في فترة، ثم يُغلق كحركة دائمة في سجل الحركات
export const CONSUMPTION_BUCKET_MS = Number(env('AZM_CONSUMPTION_BUCKET_MS', 3600000));
// إصدار بنية state.json — الترحيل في server/store/migrate.mjs
export const SCHEMA_VERSION = 10;

// ===== الحسابات =====
// الأدوار: admin = القائد الرئيسي، base_manager = مسؤول القاعدة، user = مسؤول الوحدة (الاسم القديم محفوظ للتوافق)
export const ROLES = ['admin', 'base_manager', 'user'];
export const RANKS = ['private', 'private1', 'corporal', 'vsergeant', 'sergeant', 'ssergeant', 'msergeant', 'lt', '1lt', 'captain', 'major', 'ltcol', 'colonel', 'brigadier', 'majgen', 'ltgen', 'civilian'];
export const USER_STATUSES = ['active', 'pending', 'suspended', 'rejected'];
export const REGISTER_MAX_PER_HOUR = 5;
// نسبة الاستهلاك لكل ساعة تشغيلية حسب OPTEMPO، مضروبة في معدل كل صنف (weight في الكتالوج)
export const OPTEMPO_RATE = { low: 1.4, medium: 2.4, high: 3.8 };
export const THRESHOLDS = [['depleted', 0], ['critical', 25], ['warning', 45]]; // 45% = نقطة إعادة الطلب
export const SEVERITY = { null: 0, warning: 1, critical: 2, depleted: 3 };

// ===== الجلسات =====
export const SESSION_COOKIE = 'azm_session';
export const SESSION_MAX_AGE_S = 43200; // 12 ساعة
export const LOGIN_MAX_FAILS = 10, LOGIN_LOCK_MS = 15 * 60 * 1000;

// ===== المساعد الذكي (نموذج اللغة) =====
// AZM_AI_PROVIDER: none (افتراضي — النموذج غير مربوط) أو openai (أي خادم متوافق مع OpenAI API:
// Ollama، vLLM، LM Studio، llama.cpp، أو خدمة سحابية). التفاصيل في docs/AI_INTEGRATION.md
export const AI = {
  provider: env('AZM_AI_PROVIDER', 'none').toLowerCase(),
  baseUrl: env('AZM_AI_BASE_URL', 'http://127.0.0.1:8002/v1').replace(/\/+$/, ''),
  model: env('AZM_AI_MODEL', ''),
  apiKey: env('AZM_AI_API_KEY', ''),
  timeoutMs: Number(env('AZM_AI_TIMEOUT_MS', 60000)),
  temperature: Number(env('AZM_AI_TEMPERATURE', 0.3)),
  maxHistory: Number(env('AZM_AI_MAX_HISTORY', 20)),
  maxTokens: Number(env('AZM_AI_MAX_TOKENS', 768)),
  // بث الرد للمتصفح أثناء الكتابة (1 افتراضياً). 0 = رد كامل دفعة وحدة
  stream: env('AZM_AI_STREAM', '1') !== '0',
  // تنبيه آلي بآخر الرد إذا فيه رقم ما له أصل في البيانات (verify-numbers.mjs). 0 = إيقاف
  numberCheck: env('AZM_AI_NUMBER_CHECK', '1') !== '0',
  // ميزانية الأحرف للقطة + السجل + نتائج الأدوات حتى يناسب الطلب نافذة سياق النموذج المحلي (serve-mlx.py: 6144 توكن افتراضياً)
  contextChars: Number(env('AZM_AI_CONTEXT_CHARS', 14000)),
};
// نموذج شرح التقارير مستقل عن نموذج استخراج الطلبات. RAG سيُوصل في report.mjs لاحقاً.
export const REPORT_AI = {
  provider: env('AZM_REPORT_AI_PROVIDER', 'none').toLowerCase(),
  baseUrl: env('AZM_REPORT_AI_BASE_URL', 'http://localhost:11434/v1').replace(/\/+$/, ''),
  model: env('AZM_REPORT_AI_MODEL', ''),
  apiKey: env('AZM_REPORT_AI_API_KEY', ''),
  timeoutMs: Number(env('AZM_REPORT_AI_TIMEOUT_MS', 60000)),
  temperature: Number(env('AZM_REPORT_AI_TEMPERATURE', 0.2)),
  maxHistory: Number(env('AZM_REPORT_AI_MAX_HISTORY', 12)),
  maxTokens: Number(env('AZM_REPORT_AI_MAX_TOKENS', 1024)),
  // حد أحرف بيانات تقرير العمليات المرسلة للنموذج (نافذة 6144 توكن في serve-mlx.py)
  contextChars: Number(env('AZM_REPORT_AI_CONTEXT_CHARS', 10000)),
  numberCheck: env('AZM_AI_NUMBER_CHECK', '1') !== '0',
};
// Optional external retriever. Without it, a small authoritative local corpus
// is searched with a deterministic bilingual lexical ranking.
export const RAG_URL = env('AZM_RAG_URL', '').replace(/\/+$/, '');
// مستخرج الطلبات LoRA منفصل عن الشرح العام. الرجوع للإعداد القديم للتوافق فقط.
export const REQUEST_AI = {
  provider: env('AZM_REQUEST_AI_PROVIDER', AI.provider).toLowerCase(),
  baseUrl: env('AZM_REQUEST_AI_BASE_URL', AI.baseUrl).replace(/\/+$/, ''),
  model: env('AZM_REQUEST_AI_MODEL', AI.model),
  apiKey: env('AZM_REQUEST_AI_API_KEY', AI.apiKey),
  timeoutMs: Number(env('AZM_REQUEST_AI_TIMEOUT_MS', AI.timeoutMs)),
  temperature: 0,
  maxTokens: Number(env('AZM_REQUEST_AI_MAX_TOKENS', 512)),
};
