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
  "recording-01-full:shot-recording"
  # UAT walk (A1–A6), one canonical frame per runbook item
  "uat-a1-scroll-02-paged-up:shot-uat-a1-scroll"
  "uat-a2-diff-01-full:shot-uat-a2-diff"
  "uat-a3-verbose-02-full-verbose:shot-uat-a3-verbose"
  "uat-a4-markdown-01-full:shot-uat-a4-markdown"
  "uat-a5-todos-01-full:shot-uat-a5-todos"
  "uat-a6-thinking-01-open:shot-uat-a6-thinking-open"
  "uat-a6-thinking-02-collapsed:shot-uat-a6-thinking-collapsed"
  # M3.2A composer (driven by scripted keystrokes in m32a.preview.test.tsx)
  "m32a-a1-multiline:shot-m32a-a1-multiline"
  "m32a-a2-cursor:shot-m32a-a2-cursor"
  "m32a-a4-paste:shot-m32a-a4-paste"
  "m32a-a5-slash-all:shot-m32a-a5-slash-all"
  "m32a-a5-slash-filtered:shot-m32a-a5-slash-filtered"
  "m32a-a3-history-1:shot-m32a-a3-history-1"
  "m32a-layout:shot-m32a-layout"
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
