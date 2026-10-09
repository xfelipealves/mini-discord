#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${1:-}" == "--scylla" ]]; then
  shift
  npm run test:scylla -- "$@"
else
  npm test -- "$@"
fi
