#!/bin/bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BOOK="${1:-}"
OUT="${2:-$HOME/Desktop/YasReady-Book-One-Superman-$(date +%Y%m%d-%H%M%S)}"

if [[ -z "$BOOK" ]]; then
  echo "🎧 YasReady Audiobooks — Book One Superman"
  echo
  echo "Enter the full path to the EPUB/DOCX/TXT manuscript."
  echo "Tip: type this command again with the file path in quotes for the easiest run."
  read -r BOOK
  BOOK="${BOOK#\"}"; BOOK="${BOOK%\"}"
  BOOK="${BOOK//\\ / }"
fi

if [[ ! -f "$BOOK" ]]; then
  echo "❌ Manuscript not found: $BOOK"
  exit 2
fi

mkdir -p "$OUT"
cd "$REPO"
node src/cli.js superman "$BOOK" --out "$OUT"

echo
echo "✅ Book One Superman report written to:"
echo "   $OUT"
if command -v open >/dev/null 2>&1; then open "$OUT" || true; fi
