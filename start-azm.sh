#!/usr/bin/env bash
# تشغيل عزم بإعدادات الاختبار الثابتة على Mac / Linux (نفس start-azm.cmd في ويندوز)
set -euo pipefail
cd "$(dirname "$0")"
export PORT=5182
export AZM_DATA_DIR="$PWD/data"

# المساعد الذكي والتقارير: Qwen3-4B الأساسي على 8002 (scripts/start-ai.sh)
export AZM_AI_PROVIDER=openai
export AZM_AI_BASE_URL=http://127.0.0.1:8002/v1
export AZM_AI_MODEL=azm-report-base
export AZM_REPORT_AI_PROVIDER=openai
export AZM_REPORT_AI_BASE_URL=http://127.0.0.1:8002/v1
export AZM_REPORT_AI_MODEL=azm-report-base

# استخراج الطلبات: Qwen3-4B + LoRA على نفس الخدمة 8002 باسم azm-request-lora
export AZM_REQUEST_AI_PROVIDER=openai
export AZM_REQUEST_AI_BASE_URL=http://127.0.0.1:8002/v1
export AZM_REQUEST_AI_MODEL=azm-request-lora

# بحث المنهجية BGE-M3 (اختياري؛ بدونه يرجع الخادم للبحث المحلي)
export AZM_RAG_URL=http://127.0.0.1:8010

# ثبات الردود + توازن السرعة والجودة
export AZM_AI_TEMPERATURE=0
export AZM_REPORT_AI_TEMPERATURE=0
export AZM_AI_STREAM=1
export AZM_AI_MAX_TOKENS=512
export AZM_AI_MAX_HISTORY=8
export AZM_AI_CONTEXT_CHARS=10000
export AZM_AI_TIMEOUT_MS=180000
export AZM_REQUEST_AI_TIMEOUT_MS=180000
export AZM_REPORT_AI_TIMEOUT_MS=180000

exec node server.mjs
