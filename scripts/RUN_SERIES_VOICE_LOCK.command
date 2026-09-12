#!/bin/bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE="${1:-}"
CHARACTER="${2:-}"
PROVIDER="${3:-elevenlabs}"
VOICE_ID="${4:-}"
SAFETY_SCORE="${5:-}"

expand_home() {
  local value="$1"
  if [[ "$value" == "~/"* ]]; then printf '%s/%s' "$HOME" "${value#~/}"; else printf '%s' "$value"; fi
}

if [[ -z "$PACKAGE" ]]; then
  echo "🎙️ YasReady Audiobooks — Series Voice Lock"
  echo
  echo "Enter the full path to series-continuity.json:"
  read -r PACKAGE
  PACKAGE="${PACKAGE#\"}"; PACKAGE="${PACKAGE%\"}"
  PACKAGE="${PACKAGE//\\ / }"
fi
PACKAGE="$(expand_home "$PACKAGE")"

if [[ ! -f "$PACKAGE" ]]; then
  echo "❌ Series Continuity package not found: $PACKAGE"
  exit 2
fi
if [[ -z "$CHARACTER" ]]; then echo "Enter series character key:"; read -r CHARACTER; fi
if [[ -z "$VOICE_ID" ]]; then echo "Enter provider voice ID:"; read -r VOICE_ID; fi
if [[ -z "$SAFETY_SCORE" ]]; then echo "Enter Casting Room series-safety score (0-100):"; read -r SAFETY_SCORE; fi
if ! [[ "$SAFETY_SCORE" =~ ^[0-9]+([.][0-9]+)?$ ]]; then echo "❌ Safety score must be numeric."; exit 2; fi

ARGS=(series-continuity-lock-voice "$PACKAGE" --character "$CHARACTER" --provider "$PROVIDER" --voice-id "$VOICE_ID" --approved-by operator --out "$PACKAGE")
ARGS+=(--safety-score "$SAFETY_SCORE")

cd "$REPO"
node src/cli.js "${ARGS[@]}"

echo
echo "✅ Voice lock written into:"
echo "   $PACKAGE"
