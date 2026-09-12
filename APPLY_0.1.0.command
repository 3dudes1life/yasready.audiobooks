#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-}"

if [[ -z "$TARGET" ]]; then
  echo "Usage: bash APPLY_0.1.0.command /path/to/yasready.audiobooks"
  echo "Example: bash APPLY_0.1.0.command ~/Downloads/yasready.audiobooks"
  exit 1
fi

if [[ ! -d "$TARGET/.git" ]]; then
  echo "ERROR: $TARGET is not a cloned git repository."
  exit 1
fi

rsync -a --exclude '.git' --exclude 'APPLY_0.1.0.command' "$SCRIPT_DIR/" "$TARGET/"
cd "$TARGET"
npm test
npm run check

git add .
git commit -m "build: YasReady Audiobooks 0.1.0 production foundation" || true
git push origin main

echo "✅ YasReady Audiobooks 0.1.0 applied, tested, committed and pushed."
