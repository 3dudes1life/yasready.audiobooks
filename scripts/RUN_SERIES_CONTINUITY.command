#!/bin/bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PREP="${1:-}"
OUT="${2:-$HOME/Desktop/YasReady-Series-Continuity-$(date +%Y%m%d-%H%M%S)}"
EXISTING="${3:-}"

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
OUT="$(expand_home "$OUT")"
if [[ -n "$EXISTING" ]]; then EXISTING="$(expand_home "$EXISTING")"; fi

if [[ ! -f "$PREP" ]]; then
  echo "❌ Audio Bible Prep not found: $PREP"
  exit 2
fi

# Reusing an output folder is a refresh, never a destructive reset of locked series truth.
if [[ -z "$EXISTING" && -f "$OUT/series-continuity.json" ]]; then
  EXISTING="$OUT/series-continuity.json"
fi
if [[ -n "$EXISTING" && ! -f "$EXISTING" ]]; then
  echo "❌ Existing Series Continuity package not found: $EXISTING"
  exit 2
fi

mkdir -p "$OUT"
cd "$REPO"
ARGS=(series-continuity-seed "$PREP" --out "$OUT")
if [[ -n "$EXISTING" ]]; then
  echo "🔒 Refreshing existing Series Continuity truth; relationship and voice locks will be preserved."
  ARGS+=(--existing "$EXISTING")
fi
node src/cli.js "${ARGS[@]}"

echo
echo "✅ Series Continuity pack written to:"
echo "   $OUT"
echo "   Start with: series-continuity.md"
echo "   Machine truth: series-continuity.json"
if command -v open >/dev/null 2>&1; then open "$OUT" || true; fi
