#!/bin/bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PREP="${1:-}"
PACKAGE="${2:-}"

expand_home() {
  local value="$1"
  if [[ "$value" == "~/"* ]]; then printf '%s/%s' "$HOME" "${value#~/}"; else printf '%s' "$value"; fi
}
clean_path() {
  local value="$1"
  value="${value#\"}"; value="${value%\"}"
  value="${value//\\ / }"
  expand_home "$value"
}

if [[ -z "$PREP" ]]; then
  echo "🔄 YasReady Audiobooks — Safe Series Continuity Refresh"
  echo
  echo "Enter the locked book-one-audio-bible-prep.json path:"
  read -r PREP
fi
if [[ -z "$PACKAGE" ]]; then
  echo "Enter the existing series-continuity.json path to preserve relationship/voice locks:"
  read -r PACKAGE
fi
PREP="$(clean_path "$PREP")"
PACKAGE="$(clean_path "$PACKAGE")"

[[ -f "$PREP" ]] || { echo "❌ Audio Bible Prep not found: $PREP"; exit 2; }
[[ -f "$PACKAGE" ]] || { echo "❌ Series Continuity package not found: $PACKAGE"; exit 2; }
OUT="$(dirname "$PACKAGE")"

cd "$REPO"
node src/cli.js series-continuity-seed "$PREP" --existing "$PACKAGE" --out "$OUT"

echo
echo "✅ Series Continuity refreshed in place without dropping operator-confirmed relationship or voice locks:"
echo "   $PACKAGE"
if command -v open >/dev/null 2>&1; then open "$OUT" || true; fi
