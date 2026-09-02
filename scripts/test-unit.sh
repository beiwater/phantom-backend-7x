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

FAILED=()
TOTAL=0
for t in tests/*.test.ts; do
  case "$(basename "$t")" in
    *e2e*|*crawler*|*white-screen*|*dom-verify*|*spending-money*|*slot2*) continue ;;
  esac
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
[ ${#FAILED[@]} -eq 0 ] && echo "ALL UNIT/API SUITES PASSED" || { printf 'Failed: %s\n' "${FAILED[@]}"; exit 1; }
