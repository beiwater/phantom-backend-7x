#!/usr/bin/env bash
set -euo pipefail

# Resolve the checkout from this file, not from the caller's current directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_DIR="$SCRIPT_DIR"
cd "$ROOT_DIR"

die() {
  printf 'start.command: %s\n' "$*" >&2
  exit 1
}

if ! command -v node >/dev/null 2>&1; then
  die 'Node.js is required. Install Node.js 22.12 or newer and try again.'
fi

NODE_VERSION="$(node --version 2>/dev/null)" || die 'Could not read the installed Node.js version.'
if [[ "$NODE_VERSION" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+) ]]; then
  NODE_MAJOR="${BASH_REMATCH[1]}"
  NODE_MINOR="${BASH_REMATCH[2]}"
else
  die "Unrecognized Node.js version: $NODE_VERSION"
fi
if (( NODE_MAJOR < 22 || (NODE_MAJOR == 22 && NODE_MINOR < 12) )); then
  die "Node.js 22.12 or newer is required (server uses node:sqlite and native TypeScript stripping); found $NODE_VERSION."
fi

if ! command -v npm >/dev/null 2>&1; then
  die 'npm is required. Install npm 7 or newer and try again.'
fi

NPM_VERSION="$(npm --version 2>/dev/null)" || die 'Could not read the installed npm version.'
if [[ "$NPM_VERSION" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+) ]]; then
  NPM_MAJOR="${BASH_REMATCH[1]}"
else
  die "Unrecognized npm version: $NPM_VERSION"
fi
if (( NPM_MAJOR < 7 )); then
  die "npm 7 or newer is required to install this project; found $NPM_VERSION."
fi

# Read only network settings from .env in a child process. Nothing is sourced into
# this shell, so credentials and other user settings are never printed or rewritten.
env_file_value() {
  local key="$1"
  [[ -f "$ROOT_DIR/.env" ]] || return 0
  node -e '
const key = process.argv[2];
delete process.env[key];
try {
  process.loadEnvFile(process.argv[1]);
} catch {
  // The server treats an unreadable .env as optional; use the same fallback here.
}
const value = process.env[key];
if (value !== undefined) process.stdout.write(value);
' "$ROOT_DIR/.env" "$key" 2>/dev/null
}

if [[ -z "${HOST:-}" ]]; then
  HOST="$(env_file_value HOST || true)"
fi
HOST="${HOST:-127.0.0.1}"

if [[ -z "${PORT:-}" ]]; then
  PORT="$(env_file_value PORT || true)"
fi
PORT="${PORT:-3100}"

if [[ "$HOST" == *:* ]]; then
  URL_HOST="[$HOST]"
else
  URL_HOST="$HOST"
fi

if [[ -z "${BASE_URL:-}" ]]; then
  BASE_URL="$(env_file_value BASE_URL || true)"
fi
BASE_URL="${BASE_URL:-http://${URL_HOST}:${PORT}}"

if [[ ! "$PORT" =~ ^[0-9]{1,5}$ ]]; then
  die "PORT must be an integer from 1 to 65535; found: $PORT"
fi
PORT_NUMBER=$((10#$PORT))
if (( PORT_NUMBER < 1 || PORT_NUMBER > 65535 )); then
  die "PORT must be an integer from 1 to 65535; found: $PORT"
fi
[[ -n "$HOST" ]] || die 'HOST must not be empty.'

export HOST PORT BASE_URL

# The launcher applies this playable preset for this invocation only. It never
# edits .env or database files; initial balances are used only for new companies.
export SPEED_MULTIPLIER='1.0'
export CONSTRUCTION_SPEED_MULTIPLIER='1.0'
export CONSTRUCTION_TIME_MODE='realistic'
export MARKET_PRICING_MODE='realistic'
export REALM_PHASE_PRESET='full'
export REALM_PHASE='8'
export REALM_RESEARCH_LIMIT='12'
export REALM_BONDS_ENABLED='true'
export REALM_GOV_ORDERS_ENABLED='true'
export REALM_EXECUTIVES_ENABLED='true'
export REALM_REC_BUILDINGS_ENABLED='true'
export REALM_COLLECTIBLES_ENABLED='true'
export REALM_ROBOTS_ENABLED='true'
export CHATROOM_PRESET='single'
export INITIAL_SIMBOOSTS='50'
export INITIAL_MONEY='100000'


if [[ ! -d "$ROOT_DIR/node_modules" ]] || ! npm ls --depth=0 --silent >/dev/null 2>&1; then
  if [[ -f "$ROOT_DIR/package-lock.json" ]]; then
    printf '[start.command] Installing locked dependencies with npm ci...\n'
    npm ci
  elif [[ -f "$ROOT_DIR/package.json" ]]; then
    printf '[start.command] Installing dependencies with npm install...\n'
    npm install
  else
    die 'package.json is missing; cannot install dependencies.'
  fi
fi

START_URL="http://${URL_HOST}:${PORT}/zh-cn/"
printf '\nSimCompanies 私服启动配置\n'
printf 'URL: %s\n' "$START_URL"
printf 'Preset: full / 1x / realistic construction / realistic market / single Game\n'
printf 'New company: 50 SimBoosts + $100000 cash\n'
printf 'Existing .env, database, accounts, and assets are preserved; initial values apply only to new companies.\n\n'

exec npm run start
