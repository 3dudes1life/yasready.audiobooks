#!/bin/bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PREP="${1:-}"
OUT="${2:-$HOME/Desktop/YasReady-Series-Continuity-$(date +%Y%m%d-%H%M%S)}"

expand_home() {
  local value="$1"
  if [[ "$value" == "~/"* ]]; then printf '%s/%s' "$HOME" "${value#~/}"; else printf '%s' "$value"; fi
}

if [[ -z "$PREP" ]]; then
  echo "🔗 YasReady Audiobooks — Series Continuity"
  echo
  echo "Enter the full path to a locked book-one-audio-bible-prep.json file."
  read -r PREP
  PREP="${PREP#\"}"; PREP="${PREP%\"}"
  PREP="${PREP//\\ / }"
fi
PREP="$(expand_home "$PREP")"

if [[ ! -f "$PREP" ]]; then
  echo "❌ Audio Bible Prep not found: $PREP"
  exit 2
fi

mkdir -p "$OUT"
cd "$REPO"
node src/cli.js series-continuity-seed "$PREP" --out "$OUT"

echo
echo "✅ Series Continuity pack written to:"
echo "   $OUT"
echo "   Start with: series-continuity.md"
echo "   Machine truth: series-continuity.json"
if command -v open >/dev/null 2>&1; then open "$OUT" || true; fi
