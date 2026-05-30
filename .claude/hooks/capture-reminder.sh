#!/usr/bin/env bash
# Stop hook: remind once per session to capture new findings before stopping.
# Reads the hook JSON on stdin; uses session_id to gate to a single reminder.
set -euo pipefail

input="$(cat)"
session_id="$(printf '%s' "$input" | jq -r '.session_id // "unknown"')"
stop_active="$(printf '%s' "$input" | jq -r '.stop_hook_active // false')"

marker_dir=".remember/tmp"
marker="${marker_dir}/capture-reminded-${session_id}"

# Never loop: if we've already reminded this session, or we're inside a
# hook-triggered continuation, allow the stop.
if [ "$stop_active" = "true" ] || [ -f "$marker" ]; then
  exit 0
fi

mkdir -p "$marker_dir"
touch "$marker"

cat <<'JSON'
{"decision":"block","reason":"Before stopping: have you captured this session's new findings? If you learned/built/decided anything, (1) update the relevant knowledge/<domain>/ doc (tagged + sourced), (2) append a dated bullet to PROGRESS.md, (3) update knowledge/INDEX.md or projects/INDEX.md if coverage/state changed, and commit. If there's nothing new to capture, just continue and stop."}
JSON
