#!/usr/bin/env bash
# test-unit.sh — Run all non-E2E backend suites (fast, no browser).
# Suits CI and local development. Each suite manages its own server or
# connects to BASE_URL (default http://127.0.0.1:3100).
set -uo pipefail
cd "$(dirname "$0")/.."

# The server and legacy contract suites default to port 3000. Keeping this
# aligned avoids false failures from suites that intentionally use that public
# default rather than BASE_URL.
PORT="${PORT:-3000}"
BASE="${BASE_URL:-http://127.0.0.1:$PORT}"
# Use a fresh database unless a caller deliberately provides one. Old local
# schemas must not make a regression run fail before the server can start.
TEST_DATA_DIR="${DATA_DIR:-$(mktemp -d)}"
if [ -z "${NODE_BIN:-}" ]; then
  if [ -x "/opt/magnate/.node22/bin/node" ]; then
    NODE_BIN="/opt/magnate/.node22/bin/node --experimental-strip-types"
  else
    NODE_BIN="node --experimental-strip-types"
  fi
fi

# Suites that must run standalone (they spawn their own isolated server).
STANDALONE_RE="verify-issue-70-rest|verify-issue-7[8-9]|verify-issue-8[0-9]|verify-issue-9[0-9]|verify-issue-84-90|bfs-crawler|white-screen|dom-verify"
# Start shared server for API suites
pkill -9 -f "server/index.ts" 2>/dev/null || true
sleep 1
PORT="$PORT" DATA_DIR="$TEST_DATA_DIR" SPEED_MULTIPLIER="${SPEED_MULTIPLIER:-200}" $NODE_BIN server/index.ts >/dev/null 2>&1 &
SERVER_PID=$!
sleep 2

BACKEND_TESTS=(
  tests/test-architecture-gates.test.ts
  tests/test-issue-65-simboosts.test.ts
  tests/test-realm-rules.test.ts
  tests/test-route-registry.test.ts
  tests/test-transaction-rollback.test.ts
  tests/verify-accounting-metrics.test.ts
  tests/verify-attack-fix-chat.test.ts
  tests/verify-backup-restore.test.ts
  tests/verify-chat-persistence.test.ts
  tests/verify-db-migrations.test.ts
  tests/verify-executive-offer-nan.test.ts
  tests/verify-executive-slots.test.ts
  tests/verify-issue-144-executives.test.ts
  tests/verify-issue-17-rest.test.ts
  tests/verify-issue-27-password-security.test.ts
  tests/verify-issue-29-server-hardening.test.ts
  tests/verify-issue-3-database-indexes.test.ts
  tests/verify-issue-36-read-idempotency.test.ts
  tests/verify-issue-39-research.test.ts
  tests/verify-issue-42-bonds.test.ts
  tests/verify-issue-46-financial-reports.test.ts
  tests/verify-issue-80-aerospace.test.ts
  tests/verify-issue-84-90-security.test.ts
  tests/verify-issue-86-research.test.ts
  tests/verify-issue-89-finance.test.ts
  tests/verify-issues-110-121.test.ts
  tests/verify-market-pricing-modes.test.ts
  tests/verify-p1-03-research-guide.test.ts
  tests/verify-production-process.test.ts
  tests/verify-security-hardening.test.ts
  tests/verify-warehouse-statistics.test.ts
)

FAILED=()
TOTAL=0
for t in "${BACKEND_TESTS[@]}"; do
  if [ ! -f "$t" ]; then
    echo "FAIL: missing $t"
    FAILED+=("$t")
    continue
  fi
  TOTAL=$((TOTAL + 1))
  if echo "$t" | grep -qE "$STANDALONE_RE"; then
    DATA_DIR="$TEST_DATA_DIR" env -u PORT -u BASE_URL $NODE_BIN "$t" >/dev/null 2>&1
  else
    DATA_DIR="$TEST_DATA_DIR" PORT="$PORT" BASE_URL="$BASE" $NODE_BIN "$t" >/dev/null 2>&1
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
[ ${#FAILED[@]} -eq 0 ] && echo "ALL UNIT/API SUITES PASSED" || { printf 'Failed: %s\n' "${FAILED[@]}"; exit 1; }
