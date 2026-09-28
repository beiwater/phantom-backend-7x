#!/usr/bin/env bash
# test-unit.sh — Run all non-E2E backend suites (fast, no browser).
# Suits CI and local development. Each suite manages its own server or
# connects to BASE_URL (default http://127.0.0.1:3100).
set -uo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"
if [ -z "${NODE_BIN:-}" ]; then
  if [ -x "/opt/magnate/.node22/bin/node" ]; then
    NODE_BIN="/opt/magnate/.node22/bin/node --experimental-strip-types"
  else
    NODE_BIN="node --experimental-strip-types"
  fi
fi

# Suites that must run standalone (they spawn isolated servers).
STANDALONE_RE='verify-all-16-achievements|verify-issue-7[8-9]|verify-issue-8[0-9]|verify-issue-9[0-9]|verify-issue-100-|verify-issue-102-|verify-issue-170-|verify-issue-199|verify-issue-200'

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


ALL_TEST_FILES=()
DISCOVERED_BACKEND_TESTS=()
BACKEND_TESTS=()
UNCLASSIFIED_TESTS=()
SKIPPED_TESTS=()
for t in tests/*.test.ts; do
  [ -e "$t" ] || continue
  ALL_TEST_FILES+=("$t")
  if is_excluded_test "$t"; then
    SKIPPED_TESTS+=("$t")
  elif [[ "$t" == tests/test-*.test.ts || "$t" == tests/verify-*.test.ts ]]; then
    DISCOVERED_BACKEND_TESTS+=("$t")
    BACKEND_TESTS+=("$t")
  else
    UNCLASSIFIED_TESTS+=("$t")
  fi
done

for t in "${EXCLUDED_TESTS[@]}"; do
  if [ ! -f "$t" ]; then
    echo "FAIL: configured test no longer exists: $t"
    UNCLASSIFIED_TESTS+=("$t")
  fi
done

echo "Discovered ${#ALL_TEST_FILES[@]} test files"
echo "Discovered ${#DISCOVERED_BACKEND_TESTS[@]} backend/API suites"
echo "Selected ${#BACKEND_TESTS[@]} backend/API suites"
echo "Explicitly skipped ${#SKIPPED_TESTS[@]} browser/diagnostic suites"
printf 'Selected backend/API suites:\n'
printf '  %s\n' "${BACKEND_TESTS[@]}"
printf 'Skipped suites (require a browser or a manually prepared scenario; run through their documented entry points):\n'
printf '  %s\n' "${SKIPPED_TESTS[@]}"
if [ "${#UNCLASSIFIED_TESTS[@]}" -ne 0 ]; then
  echo "FAIL: unclassified or missing test files:"
  printf '  %s\n' "${UNCLASSIFIED_TESTS[@]}"
  exit 1
fi


if [ "${TEST_DISCOVERY_ONLY:-0}" = "1" ]; then
  echo "TEST DISCOVERY PASSED"
  exit 0
fi

# Only the per-suite directories below are disposable when DATA_DIR is supplied.
TEST_DATA_DIR="${DATA_DIR:-$(mktemp -d)}"
TEST_DATA_DIR_OWNED=0
[ -n "${DATA_DIR:-}" ] || TEST_DATA_DIR_OWNED=1
mkdir -p "$TEST_DATA_DIR"

cleanup_suite_data() {
  [ -n "${SUITE_DATA_DIR:-}" ] || return 0
  local suite_path root_path
  suite_path="$(realpath "$SUITE_DATA_DIR")" || return 1
  root_path="$(realpath "$TEST_DATA_DIR")" || return 1
  case "$suite_path" in
    "$root_path"/*) rm -rf -- "$suite_path" ;;
    *) echo "FAIL: test cleanup path is outside its temporary root"; return 1 ;;
  esac
  SUITE_DATA_DIR=""
}
cleanup_run() {
  cleanup_suite_data
  # rmdir only removes an empty root created by this run.
  [ "$TEST_DATA_DIR_OWNED" -eq 0 ] || rmdir -- "$TEST_DATA_DIR"
}
trap cleanup_run EXIT

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
  mkdir -p "$TEST_DATA_DIR"
  SUITE_DATA_DIR="$(mktemp -d "$TEST_DATA_DIR/$(basename "$t" .test.ts).XXXXXX")"
  # Shared-helper suites own their server/database; do not prepare a second
  # unused service for them. grep keeps discovery portable in minimal CI.
  if [[ "$t" =~ $STANDALONE_RE ]] || grep -q 'support/test-server.ts' "$t"; then
    DATA_DIR="$SUITE_DATA_DIR" env -u PORT -u BASE_URL $NODE_BIN "$t" >"$LOG" 2>&1
    RESULT=$?
  else
    # The same helper owns service readiness, temporary database and cleanup
    # for legacy backend suites and Playwright.
    PORT="$PORT" SPEED_MULTIPLIER="${SPEED_MULTIPLIER:-200}" $NODE_BIN tests/support/run-backend-suite.ts "$t" >"$LOG" 2>&1
    RESULT=$?
  fi
  if [ "$RESULT" -ne 0 ]; then
    FAILED+=("$t")
    echo "FAIL: $t"
    cat "$LOG"
  else
    echo "PASS: $t"
  fi
  rm -f "$LOG"
  cleanup_suite_data || exit 1
done

echo "=============================="
echo "Suites: $TOTAL, Failed: ${#FAILED[@]}"
[ ${#FAILED[@]} -eq 0 ] && echo "ALL UNIT/API SUITES PASSED" || { printf 'Failed: %s\n' "${FAILED[@]}"; exit 1; }
