#!/usr/bin/env bash
# snap.sh — capture a native Claude reference screenshot via macOS screencapture.
# Usage: ./snap.sh 01-idle

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REF_DIR="$SCRIPT_DIR/reference"

SCENARIOS=(
  "01-idle"
  "02-simple-qa"
  "03-streaming"
  "04-thinking"
  "05-tool-read"
  "06-tool-bash"
  "07-tool-edit"
  "08-multi-tool"
  "09-permission"
  "10-todos"
  "11-markdown"
  "12-scrollback"
  "13-error"
  "14-status-line"
  "15-slash-menu"
  "16-question"
  "17-background-cmd"
  "18-subagent"
  "19-interrupt"
  "20-cost-summary"
  "21-effort-picker"
  "22-usage-display"
  "23-model-picker"
  "24-config-display"
  "25-memory-display"
)

if [[ $# -ne 1 ]]; then
  echo "Usage: ./snap.sh <scenario-name>"
  echo "Example: ./snap.sh 01-idle"
  echo ""
  echo "Scenarios:"
  for s in "${SCENARIOS[@]}"; do
    if [[ -f "$REF_DIR/$s.png" ]]; then
      echo "  ✔ $s"
    else
      echo "  ☐ $s"
    fi
  done
  exit 1
fi

NAME="$1"

# Validate the name against the known list
VALID=false
for s in "${SCENARIOS[@]}"; do
  if [[ "$s" == "$NAME" ]]; then
    VALID=true
    break
  fi
done

if [[ "$VALID" == "false" ]]; then
  echo "Error: '$NAME' is not a valid scenario name."
  echo "Valid names:"
  for s in "${SCENARIOS[@]}"; do echo "  $s"; done
  exit 1
fi

OUTPUT="$REF_DIR/$NAME.png"
echo "📸 Select the native Claude terminal area..."
screencapture -i "$OUTPUT"

if [[ -f "$OUTPUT" ]]; then
  echo "✔ Saved: $OUTPUT"
else
  echo "✘ Cancelled (no file saved)"
  exit 1
fi

echo ""
echo "Progress:"
DONE=0
TOTAL=${#SCENARIOS[@]}
for s in "${SCENARIOS[@]}"; do
  if [[ -f "$REF_DIR/$s.png" ]]; then
    echo "  ✔ $s"
    ((DONE++))
  else
    echo "  ☐ $s"
  fi
done
echo ""
echo "$DONE/$TOTAL captured"
