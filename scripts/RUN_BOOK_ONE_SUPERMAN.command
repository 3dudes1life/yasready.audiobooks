#!/bin/bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BOOK=""
OUT="$HOME/Desktop/YasReady-Book-One-Superman-$(date +%Y%m%d-%H%M%S)"
MODEL="eleven_multilingual_v2"
TITLE="${YASREADY_BOOK_ONE_TITLE:-Tres Amigos, Una Vida – A Throuple Love Story}"
AUTHOR="${YASREADY_BOOK_ONE_AUTHOR:-}"

if [[ $# -gt 0 && "${1:-}" != --* ]]; then
  BOOK="$1"
  shift
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)
      OUT="${2:-}"; shift 2 ;;
    --model)
      MODEL="${2:-}"; shift 2 ;;
    --title)
      TITLE="${2:-}"; shift 2 ;;
    --author)
      AUTHOR="${2:-}"; shift 2 ;;
    *)
      echo "❌ Unknown option: $1"
      echo "Usage: bash scripts/RUN_BOOK_ONE_SUPERMAN.command [BOOK] [--out DIR] [--model MODEL] [--title TITLE] [--author AUTHOR]"
      exit 2 ;;
  esac
done

if [[ -z "$BOOK" ]]; then
  echo "🎧 YasReady Audiobooks — Book One Superman Cleanup"
  echo
  echo "Enter the full path to the EPUB/DOCX/TXT manuscript."
  read -r BOOK
fi

# Make pasted Finder/Terminal paths forgiving.
BOOK="${BOOK#\"}"; BOOK="${BOOK%\"}"
BOOK="${BOOK//\\ / }"
if [[ "$BOOK" == "~/"* ]]; then BOOK="$HOME/${BOOK#\~/}"; fi
if [[ "$OUT" == "~/"* ]]; then OUT="$HOME/${OUT#\~/}"; fi

if [[ ! -f "$BOOK" ]]; then
  echo "❌ Manuscript not found: $BOOK"
  exit 2
fi

mkdir -p "$OUT"
cd "$REPO"

ARGS=(superman "$BOOK" --out "$OUT" --model "$MODEL" --title "$TITLE")
if [[ -n "$AUTHOR" ]]; then ARGS+=(--author "$AUTHOR"); fi
node src/cli.js "${ARGS[@]}"

echo
echo "✅ Book One Superman report written to:"
echo "   $OUT"
echo "   Title: $TITLE"
if [[ -n "$AUTHOR" ]]; then echo "   Author override: $AUTHOR"; else echo "   Author: inferred from manuscript when available"; fi
if command -v open >/dev/null 2>&1; then open "$OUT" || true; fi
