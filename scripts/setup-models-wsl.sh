#!/usr/bin/env bash
# باقٍ للتوافق مع الاسم القديم؛ التجهيز الفعلي في scripts/setup-ai.sh
exec bash "$(dirname "$0")/setup-ai.sh" "$@"
