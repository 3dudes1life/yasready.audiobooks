#!/bin/bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SERIES="${1:-}"
NEXT="${2:-}"
OUT="${3:-$HOME/Desktop/YasReady-Series-Continuity-Compare-$(date +%Y%m%d-%H%M%S).json}"

expand_home() {
  local value="$1"
  if [[ "$value" == "~/"* ]]; then printf '%s/%s' "$HOME" "${value#~/}"; else printf '%s' "$value"; fi
}

SERIES="$(expand_home "$SERIES")"
NEXT="$(expand_home "$NEXT")"

if [[ ! -f "$SERIES" || ! -f "$NEXT" ]]; then
  echo "Usage: bash scripts/RUN_SERIES_CONTINUITY_COMPARE.command <series-continuity.json> <next-book-audio-bible-prep.json> [output.json]"
  exit 2
fi

mkdir -p "$(dirname "$OUT")"
cd "$REPO"
node src/cli.js series-continuity-compare "$SERIES" "$NEXT" --out "$OUT"

echo
echo "✅ Series continuity comparison written to: $OUT"
