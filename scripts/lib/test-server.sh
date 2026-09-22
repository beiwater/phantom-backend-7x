#!/usr/bin/env bash
# Shared server lifecycle for the backend and API test runners.

test_server_port_in_use() {
  (echo >"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

stop_test_server() {
  local status=$?
  trap - EXIT INT TERM
  if [ -n "${SERVER_PID:-}" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    for ((attempt = 0; attempt < 20; attempt++)); do
      if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        break
      fi
      sleep 0.1
    done
    if kill -0 "$SERVER_PID" 2>/dev/null; then
      kill -KILL "$SERVER_PID" 2>/dev/null || true
    fi
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [ -n "${SERVER_LOG:-}" ]; then
    rm -f "$SERVER_LOG"
  fi
  return "$status"
}

start_test_server() {
  if test_server_port_in_use "$PORT"; then
    echo "FAIL: port $PORT is already in use; choose another PORT" >&2
    return 1
  fi

  SERVER_LOG="$(mktemp)"
  PORT="$PORT" HOST=127.0.0.1 DATA_DIR="$TEST_DATA_DIR" SPEED_MULTIPLIER="${SPEED_MULTIPLIER:-200}" $NODE_BIN server/index.ts >"$SERVER_LOG" 2>&1 &
  SERVER_PID=$!
  trap stop_test_server EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  for ((attempt = 0; attempt < 120; attempt++)); do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "FAIL: test server exited before becoming ready" >&2
      cat "$SERVER_LOG" >&2
      return 1
    fi
    if curl -fsS --max-time 1 "http://127.0.0.1:$PORT/version/" >/dev/null 2>&1 \
      && kill -0 "$SERVER_PID" 2>/dev/null; then
      return 0
    fi
    sleep 0.25
  done

  echo "FAIL: test server did not become ready on port $PORT" >&2
  cat "$SERVER_LOG" >&2
  return 1
}
