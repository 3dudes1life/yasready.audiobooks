#!/bin/bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BOOK="${1:-}"
OUT="${2:-$HOME/Desktop/YasReady-Book-One-Audio-Bible-Prep-$(date +%Y%m%d-%H%M%S)}"

expand_home() {
  local value="$1"
  if [[ "$value" == "~/"* ]]; then printf '%s/%s' "$HOME" "${value#~/}"; else printf '%s' "$value"; fi
}

if [[ -z "$BOOK" ]]; then
  echo "🎭 YasReady Audiobooks — Book One Audio Bible Prep"
  echo
  echo "Enter the full path to the EPUB/DOCX/TXT manuscript."
  read -r BOOK
  BOOK="${BOOK#\"}"; BOOK="${BOOK%\"}"
  BOOK="${BOOK//\\ / }"
fi
BOOK="$(expand_home "$BOOK")"

if [[ ! -f "$BOOK" ]]; then
  echo "❌ Manuscript not found: $BOOK"
  exit 2
fi

mkdir -p "$OUT"
cd "$REPO"
node src/cli.js audio-bible-prep "$BOOK" --out "$OUT"

echo
echo "✅ Book One Audio Bible Prep written to:"
echo "   $OUT"
echo "   Start with: book-one-audio-bible-prep.md"
echo "   Then review: dialogue-review.csv and pronunciation-review.csv"
if command -v open >/dev/null 2>&1; then open "$OUT" || true; fi
