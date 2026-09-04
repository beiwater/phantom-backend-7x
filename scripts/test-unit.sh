#!/usr/bin/env bash
# test-unit.sh — Run all non-E2E backend suites (fast, no browser).
# Suits CI and local development. Each suite manages its own server or
# connects to BASE_URL (default http://127.0.0.1:3100).
set -uo pipefail
cd "$(dirname "$0")/.."

# The server and legacy contract suites default to port 3000. Keeping this
# aligned avoids false failures from suites that intentionally use that public
# default rather than BASE_URL.
if [ -z "${PORT:-}" ]; then
  if ss -tulpn 2>/dev/null | grep -qE "(:| )3000 "; then
    PORT="3100"
  else
    PORT="3000"
  fi
fi
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

# Suites that must run standalone (they spawn isolated servers).
STANDALONE_RE='verify-issue-70-rest|verify-issue-7[8-9]|verify-issue-8[0-9]|verify-issue-84-90|verify-issue-9[0-9]|verify-issue-199|bfs-crawler|white-screen|dom-verify'

# Suites admitted to the default CI gate. New test files are discovered below
# and reported as quarantined until their runtime assumptions and baseline
# result are reviewed; they are never silently omitted.
ADMITTED_TESTS=(
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
  tests/verify-issue-83-newspaper.test.ts
  tests/verify-issue-84-90-security.test.ts
  tests/verify-issue-86-research.test.ts
  tests/verify-issue-89-finance.test.ts
  tests/verify-issues-110-121.test.ts
  tests/verify-market-pricing-modes.test.ts
  tests/verify-construction-time-mode.test.ts
  tests/verify-demand-pricing-and-chatrooms.test.ts
  tests/verify-economy-and-library-guides.test.ts
  tests/verify-p1-03-research-guide.test.ts
  tests/verify-issue-183-production-economy.test.ts
  tests/verify-issue-184-government-content.test.ts
  tests/verify-issue-185-economy.test.ts
  tests/verify-issue-197-launchpad-mapping.test.ts
  tests/verify-issue-182-certificates.test.ts
  tests/verify-production-process.test.ts
  tests/verify-issue-186-time-warp-consistency.test.ts
  tests/verify-issue-187-executive-offer-flow.test.ts
  tests/verify-issue-188-chat-timestamps.test.ts
  tests/verify-issue-189-chat-ordering.test.ts
  tests/verify-issue-190-production-duration.test.ts
  tests/verify-issue-199-encyclopedia.test.ts
  tests/verify-issue-192-company-map-slots.test.ts
  tests/verify-issue-193-contract-submission.test.ts
  tests/verify-issue-194-newspaper-unpublished.test.ts
  tests/verify-issue-195-196-executives.test.ts
  tests/verify-security-hardening.test.ts
  tests/verify-warehouse-statistics.test.ts
)

# Browser/diagnostic suites are intentionally not part of this backend gate.
# Keep this list explicit: an unclassified tests/*.test.ts file must fail the
# discovery check instead of silently disappearing from CI.
EXCLUDED_TESTS=(
  tests/bfs-crawler-e2e.test.ts
  tests/comprehensive-white-screen-audit.test.ts
  tests/dom-verify-p0-03-checkout.test.ts
  tests/e2e-b0-construct-production.test.ts
  tests/full-user-journey.test.ts
  tests/guest-flow.test.ts
  tests/interactive-gameplay.test.ts
  tests/multi-account.test.ts
  tests/repro-retail-duration-limit-dom.test.ts
  tests/scientific-white-screen-audit.test.ts
  tests/smart-heuristic-traversal.test.ts
  tests/tree-recursive-crawler-e2e.test.ts
  tests/ultra-high-coverage-e2e.test.ts
  tests/test-avatar-profile.test.ts
  tests/test-slot-unlock.test.ts
  tests/verify-slot2-building-construction.test.ts
  tests/verify-spending-money.test.ts
)

is_excluded_test() {
  local candidate="$1"
  local excluded
  for excluded in "${EXCLUDED_TESTS[@]}"; do
    if [ "$candidate" = "$excluded" ]; then
      return 0
    fi
  done
  return 1
}

is_admitted_test() {
  local candidate="$1"
  local admitted
  for admitted in "${ADMITTED_TESTS[@]}"; do
    if [ "$candidate" = "$admitted" ]; then
      return 0
    fi
  done
  return 1
}

ALL_TEST_FILES=()
DISCOVERED_BACKEND_TESTS=()
BACKEND_TESTS=()
QUARANTINED_TESTS=()
UNCLASSIFIED_TESTS=()
SKIPPED_TESTS=()
for t in tests/*.test.ts; do
  [ -e "$t" ] || continue
  ALL_TEST_FILES+=("$t")
  if is_excluded_test "$t"; then
    SKIPPED_TESTS+=("$t")
  elif [[ "$t" == tests/test-*.test.ts || "$t" == tests/verify-*.test.ts ]]; then
    DISCOVERED_BACKEND_TESTS+=("$t")
    if is_admitted_test "$t"; then
      BACKEND_TESTS+=("$t")
    else
      QUARANTINED_TESTS+=("$t")
    fi
  else
    UNCLASSIFIED_TESTS+=("$t")
  fi
done

for t in "${ADMITTED_TESTS[@]}" "${EXCLUDED_TESTS[@]}"; do
  if [ ! -f "$t" ]; then
    echo "FAIL: configured test no longer exists: $t"
    UNCLASSIFIED_TESTS+=("$t")
  fi
done

echo "Discovered ${#ALL_TEST_FILES[@]} test files"
echo "Discovered ${#DISCOVERED_BACKEND_TESTS[@]} backend/API suites"
echo "Selected ${#BACKEND_TESTS[@]} admitted backend/API suites"
echo "Quarantined ${#QUARANTINED_TESTS[@]} backend/API suites (not run by default)"
echo "Explicitly skipped ${#SKIPPED_TESTS[@]} browser/diagnostic suites"
if [ "${#QUARANTINED_TESTS[@]}" -ne 0 ]; then
  printf 'Quarantined (set RUN_QUARANTINED=1 to run):\n'
  printf '  %s\n' "${QUARANTINED_TESTS[@]}"
fi
if [ "${#UNCLASSIFIED_TESTS[@]}" -ne 0 ]; then
  echo "FAIL: unclassified or missing test files:"
  printf '  %s\n' "${UNCLASSIFIED_TESTS[@]}"
  exit 1
fi

if [ "${RUN_QUARANTINED:-0}" = "1" ]; then
  BACKEND_TESTS+=("${QUARANTINED_TESTS[@]}")
fi

if [ "${TEST_DISCOVERY_ONLY:-0}" = "1" ]; then
  echo "TEST DISCOVERY PASSED"
  exit 0
fi

# Start shared server for API suites
pkill -9 -f "server/index.ts" 2>/dev/null || true
sleep 1
PORT="$PORT" DATA_DIR="$TEST_DATA_DIR" SPEED_MULTIPLIER="${SPEED_MULTIPLIER:-200}" $NODE_BIN server/index.ts >/dev/null 2>&1 &
SERVER_PID=$!
sleep 2

echo "Running backend/API suites:"
printf '  %s\n' "${BACKEND_TESTS[@]}"


FAILED=()
TOTAL=0
for t in "${BACKEND_TESTS[@]}"; do
  if [ ! -f "$t" ]; then
    echo "FAIL: missing $t"
    FAILED+=("$t")
    continue
  fi
  TOTAL=$((TOTAL + 1))
  LOG="$(mktemp)"
  if [[ "$t" =~ $STANDALONE_RE ]]; then
    DATA_DIR="$TEST_DATA_DIR" env -u PORT -u BASE_URL $NODE_BIN "$t" >"$LOG" 2>&1
  else
    DATA_DIR="$TEST_DATA_DIR" PORT="$PORT" BASE_URL="$BASE" $NODE_BIN "$t" >"$LOG" 2>&1
  fi
  if [ $? -ne 0 ]; then
    FAILED+=("$t")
    echo "FAIL: $t"
    cat "$LOG"
  else
    echo "PASS: $t"
  fi
  rm -f "$LOG"
done

kill -9 $SERVER_PID 2>/dev/null || true
echo "=============================="
echo "Suites: $TOTAL, Failed: ${#FAILED[@]}"
[ ${#FAILED[@]} -eq 0 ] && echo "ALL UNIT/API SUITES PASSED" || { printf 'Failed: %s\n' "${FAILED[@]}"; exit 1; }
