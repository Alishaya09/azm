#!/usr/bin/env bash
# خدمة استرجاع منهجية عزم (BGE-M3) على 127.0.0.1:8010. تعمل على المعالج حتى تبقى ذاكرة GPU لنموذج Qwen.
# أول تشغيل: يُنشئ البيئة ~/azm-rag-venv ويثبت PyTorch للمعالج وsentence-transformers، وينزّل BGE-M3 (نحو 2.3GB).
#   Mac: PyTorch من PyPI مباشرة. Linux / WSL: نسخة المعالج من download.pytorch.org.
# الفهرس ~/.azm-rag/index.sqlite يُعاد بناؤه تلقائياً إذا تغير resources/report-knowledge.json.
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
venv="${AZM_RAG_VENV:-$HOME/azm-rag-venv}"
if [[ ! -x "$venv/bin/python" ]]; then
  if [[ "$(uname -s)" == Darwin ]]; then
    python="$(command -v python3.12 || command -v python3)"
    "$python" -m venv "$venv"
    "$venv/bin/python" -m pip install --upgrade pip
    "$venv/bin/python" -m pip install torch
  else
    python3 -m venv "$venv"
    "$venv/bin/python" -m pip install --upgrade pip
    "$venv/bin/python" -m pip install torch --index-url https://download.pytorch.org/whl/cpu
  fi
  "$venv/bin/python" -m pip install -r "$project_dir/rag/requirements.txt"
fi
echo 'AZM RAG (BGE-M3): http://127.0.0.1:8010/health'
exec "$venv/bin/python" -B "$project_dir/rag/service.py" serve --port "${AZM_RAG_PORT:-8010}" --device "${AZM_RAG_DEVICE:-cpu}"
