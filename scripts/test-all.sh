#!/usr/bin/env bash
# test-all.sh — Full layered test gate:
#   Layer 1: unit/API contract suites (fast)
#   Layer 2: Playwright E2E (browser; requires a built frontend)
# Fails fast on Layer 1 errors. E2E is opt-out via SKIP_E2E=1.
set -uo pipefail
cd "$(dirname "$0")/.."

echo "=== Layer 1: unit + API contract suites ==="
bash scripts/test-unit.sh || exit 1

if [ "${SKIP_E2E:-0}" = "1" ]; then
  echo "=== SKIP_E2E=1 set; skipping Layer 2 ==="
  exit 0
fi

echo "=== Layer 2: Playwright E2E ==="
if [ ! -d "frontend-original/static/bundle" ]; then
  echo "frontend bundle missing; skipping E2E layer"
  exit 0
fi
npx playwright test
