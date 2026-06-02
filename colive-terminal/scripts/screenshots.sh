#!/usr/bin/env bash
# Regenerate the preview frames and render them to PNG screenshots.
#   1. PREVIEW=1 vitest  -> preview-out/*.ansi  (captured desk frames)
#   2. vhs tape          -> preview-out/shot-*.png
# Requires vhs (`brew install vhs`). Run from colive-terminal/.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[1/2] capturing frames (PREVIEW=1 vitest test/preview)…"
PREVIEW=1 npx vitest run test/preview >/dev/null

echo "[2/2] rendering screenshots (vhs)…"
vhs scripts/screenshots.tape

echo "done. PNGs:"
ls -1 preview-out/shot-*.png
