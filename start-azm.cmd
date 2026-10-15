@echo off
rem تشغيل عزم بإعدادات الاختبار الثابتة (من مجلد المشروع نفسه، خارج OneDrive)
cd /d "%~dp0"
set "PORT=5182"
set "AZM_DATA_DIR=%~dp0data"

rem المساعد الذكي والتقارير: Qwen3-4B الأساسي على 8002 (scripts/start-ai.sh)
set "AZM_AI_PROVIDER=openai"
set "AZM_AI_BASE_URL=http://127.0.0.1:8002/v1"
set "AZM_AI_MODEL=azm-report-base"
set "AZM_REPORT_AI_PROVIDER=openai"
set "AZM_REPORT_AI_BASE_URL=http://127.0.0.1:8002/v1"
set "AZM_REPORT_AI_MODEL=azm-report-base"

rem استخراج الطلبات: Qwen3-4B + LoRA على نفس الخدمة 8002 باسم azm-request-lora
set "AZM_REQUEST_AI_PROVIDER=openai"
set "AZM_REQUEST_AI_BASE_URL=http://127.0.0.1:8002/v1"
set "AZM_REQUEST_AI_MODEL=azm-request-lora"

rem بحث المنهجية BGE-M3 (اختياري؛ بدونه يرجع الخادم للبحث المحلي)
set "AZM_RAG_URL=http://127.0.0.1:8010"

rem ثبات الردود + توازن السرعة والجودة
set "AZM_AI_TEMPERATURE=0"
set "AZM_REPORT_AI_TEMPERATURE=0"
set "AZM_AI_STREAM=1"
set "AZM_AI_MAX_TOKENS=512"
set "AZM_AI_MAX_HISTORY=8"
set "AZM_AI_CONTEXT_CHARS=10000"
set "AZM_AI_TIMEOUT_MS=180000"
set "AZM_REQUEST_AI_TIMEOUT_MS=180000"
set "AZM_REPORT_AI_TIMEOUT_MS=180000"

node server.mjs
pause
