#!/usr/bin/env bash
# نسخة وحدة من Qwen3-4B على 127.0.0.1:8002 تخدم الاثنين معاً (مناسب لبطاقة 8GB):
#   azm-report-base  ← المساعد الذكي والتقارير (الأدابتر معطّل لهذا الاسم)
#   azm-request-lora ← استخراج طلب الوحدة من النص (الأدابتر مفعّل)
# في start-azm.cmd / start-azm.sh يكون AZM_REQUEST_AI_BASE_URL=http://127.0.0.1:8002/v1
# AZM_MAX_CONTEXT (6144 افتراضياً؛ 7168 جُرّب على 8GB مع AZM_PROMPT_CACHE_SLOTS=1) و AZM_PROMPT_CACHE_SLOTS (2 افتراضياً)
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
venv="${AZM_LLM_VENV:-$HOME/azm-llm/venv}"
model_dir="${AZM_MODEL_DIR:-$HOME/azm-llm/models/qwen3-4b-4bit}"
adapter_dir="${AZM_ADAPTER_DIR:-$project_dir/models/request-adapter}"
if [[ ! -x "$venv/bin/python" || ! -f "$model_dir/config.json" ]]; then
  echo 'البيئة أو النموذج غير موجود. نفّذ أولاً: bash scripts/setup-ai.sh' >&2; exit 1
fi
if [[ ! -f "$adapter_dir/adapters.safetensors" ]]; then
  echo "الأدابتر غير موجود في $adapter_dir (ضع AZM_ADAPTER_DIR على مجلده)" >&2; exit 1
fi
echo 'AZM AI (chat + request extraction): http://127.0.0.1:8002/v1/models'
exec "$venv/bin/python" -B "$project_dir/scripts/serve-mlx.py" --model "$model_dir" --adapter "$adapter_dir" \
  --name azm-request-lora --base-name azm-report-base --port "${AZM_MODEL_PORT:-8002}" \
  --max-context "${AZM_MAX_CONTEXT:-6144}" --prompt-cache-slots "${AZM_PROMPT_CACHE_SLOTS:-2}"
