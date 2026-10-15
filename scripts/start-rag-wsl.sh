#!/usr/bin/env bash
# باقٍ للتوافق مع الاسم القديم؛ التشغيل الفعلي في scripts/start-rag.sh
exec bash "$(dirname "$0")/start-rag.sh" "$@"
