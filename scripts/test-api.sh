#!/usr/bin/env bash
# test-api.sh — Run API/REST contract suites only (skip slow E2E/browser ones).
set -uo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-3100}"
BASE="${BASE_URL:-http://127.0.0.1:$PORT}"
NODE_BIN="${NODE_BIN:-/opt/magnate/.node22/bin/node --experimental-strip-types}"

# Suites that must run standalone (spawn isolated servers).
STANDALONE_RE="verify-issue-70-rest|verify-issue-7[8-9]|verify-issue-8[0-9]|verify-issue-9[0-9]|verify-issue-84-90"

pkill -9 -f "server/index.ts" 2>/dev/null || true
sleep 1
PORT="$PORT" SPEED_MULTIPLIER="${SPEED_MULTIPLIER:-200}" $NODE_BIN server/index.ts >/dev/null 2>&1 &
SERVER_PID=$!
sleep 2

FAILED=()
TOTAL=0
for t in tests/verify-*.test.ts tests/test-*.test.ts; do
  [ -e "$t" ] || continue
  TOTAL=$((TOTAL + 1))
  if echo "$t" | grep -qE "$STANDALONE_RE"; then
    env -u PORT -u BASE_URL $NODE_BIN "$t" >/dev/null 2>&1
  else
    PORT="$PORT" BASE_URL="$BASE" $NODE_BIN "$t" >/dev/null 2>&1
  fi
  if [ $? -ne 0 ]; then
    FAILED+=("$t")
    echo "FAIL: $t"
  else
    echo "PASS: $t"
  fi
done

kill -9 $SERVER_PID 2>/dev/null || true
echo "=============================="
echo "Suites: $TOTAL, Failed: ${#FAILED[@]}"
[ ${#FAILED[@]} -eq 0 ] && echo "ALL API SUITES PASSED" || { printf 'Failed: %s\n' "${FAILED[@]}"; exit 1; }
