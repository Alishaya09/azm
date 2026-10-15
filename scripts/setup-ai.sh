#!/usr/bin/env bash
# تجهيز نموذج عزم (مرة وحدة): بيئة Python فيها MLX بنفس النسخ المختبرة، ثم تنزيل Qwen3-4B-4bit (نحو 2.2GB) من mlx-community.
#   Mac (Apple Silicon): MLX على Metal (scripts/requirements-mlx-mac.txt)
#   Linux / Windows WSL2: MLX على CUDA 12، يحتاج بطاقة NVIDIA ظاهرة (scripts/requirements-mlx.txt)
# يحتاج إنترنت. بعده: bash scripts/start-ai.sh   (المساعد والتقارير واستخراج الطلبات على 8002)
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
venv="${AZM_LLM_VENV:-$HOME/azm-llm/venv}"
model_dir="${AZM_MODEL_DIR:-$HOME/azm-llm/models/qwen3-4b-4bit}"
os="$(uname -s)" arch="$(uname -m)"

if [[ "$os" == Darwin && "$arch" == arm64 ]]; then
  python="$(command -v python3.12 || command -v python3 || true)"
  if [[ -z "$python" ]]; then
    echo 'Python 3 غير موجود. ثبّته (مثلاً: brew install python@3.12) ثم أعد المحاولة.' >&2; exit 1
  fi
  if ! "$python" -c 'import sys; sys.exit(sys.version_info < (3, 10))'; then
    echo "MLX يحتاج Python 3.10 أو أحدث، والموجود: $("$python" --version 2>&1). ثبّت python@3.12 ثم أعد المحاولة." >&2; exit 1
  fi
  requirements="$project_dir/scripts/requirements-mlx-mac.txt"
elif [[ "$os" == Darwin ]]; then
  echo 'أجهزة Mac بمعالج Intel لا تشغّل MLX. الموقع يشتغل بدون الذكاء الاصطناعي (AZM_AI_PROVIDER=none).' >&2; exit 1
elif [[ "$os" == Linux ]]; then
  if ! command -v nvidia-smi >/dev/null; then
    echo 'nvidia-smi غير موجود داخل WSL: ثبّت تعريف NVIDIA الحديث في ويندوز (يدعم WSL) ثم أعد تشغيل الجهاز.' >&2; exit 1
  fi
  nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
  if ! python3 -m venv --help >/dev/null 2>&1; then
    echo 'حزمة python3-venv ناقصة. نفّذ: sudo apt update && sudo apt install -y python3-venv python3-pip' >&2; exit 1
  fi
  python=python3
  requirements="$project_dir/scripts/requirements-mlx.txt"
else
  echo "نظام غير مدعوم: $os $arch. الموقع يشتغل بدون الذكاء الاصطناعي (AZM_AI_PROVIDER=none)." >&2; exit 1
fi

[[ -x "$venv/bin/python" ]] || "$python" -m venv "$venv"
"$venv/bin/python" -m pip install --upgrade pip
"$venv/bin/python" -m pip install -r "$requirements"

if [[ ! -f "$model_dir/config.json" ]]; then
  mkdir -p "$model_dir"
  "$venv/bin/hf" download mlx-community/Qwen3-4B-4bit --local-dir "$model_dir"
fi

# فحص أن MLX يرى بطاقة الرسوميات
"$venv/bin/python" -c 'import mlx.core as mx; a = mx.array([1, 2]) + 1; mx.eval(a); print("MLX OK:", a.tolist(), mx.default_device())'
echo "جاهز. النموذج في: $model_dir"
echo "للتشغيل: bash scripts/start-ai.sh"
