#!/usr/bin/env bash
# Regenerate the preview frames and render each to a PNG screenshot.
#   1. PREVIEW=1 vitest  -> preview-out/*.ansi  (captured desk frames)
#   2. one vhs run per frame -> preview-out/shot-*.png
# One tape per frame (a single multi-screenshot tape races — each Screenshot can
# capture the *next* cat's output). Requires vhs (`brew install vhs`).
# Run from colive-terminal/.  Optionally pass frame basenames to limit the set.
set -euo pipefail
cd "$(dirname "$0")/.."

VHS="$(command -v vhs || echo /opt/homebrew/bin/vhs)"

# frame-basename (in preview-out, without .ansi) : output-png-basename
FRAMES=(
  "cockpit-03-full:shot-cockpit-full"
  "cockpit-04-full-verbose:shot-cockpit-full-verbose"
  "cockpit-01-window-default:shot-cockpit-window"
  "markdown-01-full:shot-markdown"
  "inprogress-01-full:shot-inprogress"
  "tall-01-bottom:shot-tall"
)

echo "[1/2] capturing frames (PREVIEW=1 vitest test/preview)…"
PREVIEW=1 npx vitest run test/preview >/dev/null

echo "[2/2] rendering screenshots (one vhs run per frame)…"
tape="$(mktemp -t colive-shot-XXXX).tape"
trap 'rm -f "$tape"' EXIT
for pair in "${FRAMES[@]}"; do
  frame="${pair%%:*}"; out="${pair##*:}"
  [ -f "preview-out/${frame}.ansi" ] || { echo "  skip ${frame} (no frame)"; continue; }
  cat > "$tape" <<TAPE
Set Shell "bash"
Set FontSize 14
Set Width 1280
Set Height 1160
Set Padding 12
Hide
Type "clear && cat preview-out/${frame}.ansi" Enter
Sleep 400ms
Show
Sleep 600ms
Screenshot preview-out/${out}.png
TAPE
  "$VHS" "$tape" >/dev/null 2>&1 && echo "  ✓ ${out}.png" || echo "  ✗ ${out}.png (vhs failed)"
done

echo "done."
ls -1 preview-out/shot-*.png
