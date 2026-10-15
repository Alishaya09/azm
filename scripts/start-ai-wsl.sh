#!/usr/bin/env bash
# باقٍ للتوافق مع الاسم القديم؛ التشغيل الفعلي في scripts/start-ai.sh
exec bash "$(dirname "$0")/start-ai.sh" "$@"
