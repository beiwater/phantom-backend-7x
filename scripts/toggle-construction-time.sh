#!/usr/bin/env bash
# toggle-construction-time.sh — One-click toggle for real construction time based on encyclopedia
# Usage:
#   bash scripts/toggle-construction-time.sh              # Toggles between realistic and test
#   bash scripts/toggle-construction-time.sh realistic    # Sets to authentic encyclopedia buildDuration
#   bash scripts/toggle-construction-time.sh test         # Sets to 10s fast testing mode
#   bash scripts/toggle-construction-time.sh status       # Displays current mode and sample durations

set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-toggle}"

if [ "$MODE" = "toggle" ]; then
  node --experimental-strip-types scripts/dev-tool.ts construction --toggle
elif [ "$MODE" = "status" ]; then
  node --experimental-strip-types scripts/dev-tool.ts construction --status
else
  node --experimental-strip-types scripts/dev-tool.ts construction --mode "$MODE"
fi
