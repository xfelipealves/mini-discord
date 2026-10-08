#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Current contract suite replaces the legacy curl checks with stale assumptions.
if [[ "$#" -gt 0 && "$1" != "all" ]]; then
  echo "Use all (or npm run test:scylla -- --testNamePattern=...)" >&2
  exit 2
fi
exec npm run test:scylla
