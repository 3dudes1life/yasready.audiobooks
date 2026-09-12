#!/bin/bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE="${1:-}"
MEMBERS="${2:-}"
KIND="${3:-partner}"
LABEL="${4:-romantic partner}"

expand_home() {
  local value="$1"
  if [[ "$value" == "~/"* ]]; then printf '%s/%s' "$HOME" "${value#~/}"; else printf '%s' "$value"; fi
}

if [[ -z "$PACKAGE" ]]; then
  echo "🔒 YasReady Audiobooks — Series Relationship Lock"
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

if [[ -z "$MEMBERS" ]]; then
  echo "Enter comma-separated series character keys (example: michael-rawlins,juan-delgado,christopher-lancaster):"
  read -r MEMBERS
fi

cd "$REPO"
node src/cli.js series-continuity-lock-group "$PACKAGE" \
  --members "$MEMBERS" \
  --kind "$KIND" \
  --label "$LABEL" \
  --approved-by "operator" \
  --out "$PACKAGE"

echo
echo "✅ Relationship truth locked into:"
echo "   $PACKAGE"
