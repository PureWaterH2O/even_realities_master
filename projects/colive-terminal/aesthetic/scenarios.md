# M3.5 Aesthetic Pass — Reference Capture Runbook

Setup: VS Code with two terminal panes side by side.
- **Left pane:** `claude` (native Claude Code)
- **Right pane:** Shell in this repo (for `snap.sh`)

Work through each scenario in order. Some scenarios build on earlier state.

---

## 01 — Idle / startup

Wait for Claude to finish loading (banner + prompt visible).

```
# Don't type anything — just wait for the idle state
```

Snap: `./projects/colive-terminal/aesthetic/snap.sh 01-idle`

---

## 02 — Simple Q&A

```
Say hello
```

Wait for the full response to finish. Snap the completed turn (user prompt bar + assistant response + idle prompt).

Snap: `./projects/colive-terminal/aesthetic/snap.sh 02-simple-qa`

---

## 03 — Streaming response

```
Count from 1 to 300, one number per line, slowly
```

Snap **while the response is still streaming** — numbers must still be actively
appearing, BEFORE the prompt box returns and BEFORE any `✱ …for Ns` summary line
shows. (A short count like 1→20 finishes in ~1s and can't be caught mid-stream —
use a long, slow one.)

Snap: `./projects/colive-terminal/aesthetic/snap.sh 03-streaming`

---

## 04 — Thinking block

```
Solve the 12-ball balance puzzle. Think through it step by step.
```

Wait for the response to finish. The thinking block should be collapsed. Snap showing the collapsed thinking indicator.

Snap: `./projects/colive-terminal/aesthetic/snap.sh 04-thinking`

---

## 05 — Tool call — Read

```
Read the file CLAUDE.md
```

Wait for the tool to complete. Snap showing the Read tool header.

Snap: `./projects/colive-terminal/aesthetic/snap.sh 05-tool-read`

---

## 06 — Tool call — Bash

```
Run ls -la in the current directory
```

Wait for the tool to complete. Snap showing the Bash tool header with timing.

Snap: `./projects/colive-terminal/aesthetic/snap.sh 06-tool-bash`

---

## 07 — Tool call — Edit/Write

```
Create a file /tmp/m35-test.txt with the content "hello from m3.5"
```

Wait for the tool to complete. Snap showing the Write tool header with the inline diff (green + lines).

Snap: `./projects/colive-terminal/aesthetic/snap.sh 07-tool-edit`

---

## 08 — Multi-tool turn

```
Read CLAUDE.md, then create /tmp/m35-summary.txt with a one-line summary of it
```

Wait for all tools to complete. Snap showing multiple tool headers in one response.

Snap: `./projects/colive-terminal/aesthetic/snap.sh 08-multi-tool`

---

## 09 — Permission prompt

Switch to default permission mode first if needed (`/mode` → Default), then:

```
Delete the file /tmp/m35-test.txt
```

Snap **while the permission prompt is visible** (before approving/denying).

Snap: `./projects/colive-terminal/aesthetic/snap.sh 09-permission`

---

## 10 — Todos panel

```
Create a 3-step todo list: (1) read a file, (2) summarize it, (3) write the summary. Then start working through them.
```

Snap when at least one task is complete, one is in-progress, and one is pending.

Snap: `./projects/colive-terminal/aesthetic/snap.sh 10-todos`

---

## 11 — Markdown response

```
Write a response that includes: a heading, bold text, a bullet list, a numbered list, a code block, a table, and a blockquote
```

Wait for the full response. Snap showing the rendered markdown.

Snap: `./projects/colive-terminal/aesthetic/snap.sh 11-markdown`

---

## 12 — Long scrollback

The session should now have enough turns to scroll. Press PgUp to scroll up. Snap showing the scroll indicator and partially-scrolled view.

Snap: `./projects/colive-terminal/aesthetic/snap.sh 12-scrollback`

Press End to return to the bottom.

---

## 13 — Error / diagnostic

```
Read a file that definitely does not exist: /tmp/no-such-file-12345.txt
```

Wait for the error. Snap showing how errors/diagnostics are rendered.

Snap: `./projects/colive-terminal/aesthetic/snap.sh 13-error`

---

## 14 — Status line states

Start a prompt that will take a few seconds:

```
Explain the theory of relativity in detail
```

Snap **while Claude is actively responding** (status shows thinking/responding, token count incrementing).

Snap: `./projects/colive-terminal/aesthetic/snap.sh 14-status-line`

---

## 15 — Slash menu

Type `/` (just the slash character, don't press Enter). The slash command menu should appear.

Snap: `./projects/colive-terminal/aesthetic/snap.sh 15-slash-menu`

Press Escape to dismiss.

---

## 16 — Question prompt

```
Ask me a multiple choice question about programming languages with 3 options
```

If Claude doesn't produce a question prompt (AskUserQuestion tool), try: ask Claude to use the AskUserQuestion tool to ask you a question.

Snap **while the question prompt is visible**.

Snap: `./projects/colive-terminal/aesthetic/snap.sh 16-question`

---

## 17 — Background command

```
Run this command in the background: sleep 5 && echo "done"
```

Snap **while the background command is running** (before it completes).

Snap: `./projects/colive-terminal/aesthetic/snap.sh 17-background-cmd`

---

## 18 — Subagent / Agent tool

```
Use the Agent tool to spawn a subagent that answers: what is 2+2?
```

Snap while or after the subagent runs, showing the Agent tool indicator.

Snap: `./projects/colive-terminal/aesthetic/snap.sh 18-subagent`

---

## 19 — Interrupt (Esc)

```
Write a very long essay about the history of computing
```

Press **Esc** while the response is mid-stream. Snap showing the interrupted state.

Snap: `./projects/colive-terminal/aesthetic/snap.sh 19-interrupt`

---

## 20 — Cost summary

The previous responses should show cost info. Type `/cost` or look at the status line after a completed turn showing the cost/token display.

Snap: `./projects/colive-terminal/aesthetic/snap.sh 20-cost-summary`

---

## 21 — `/effort` picker

Type `/effort` and press Enter (or just `/effort` if it opens a picker).

Snap showing the effort level selection UI.

Snap: `./projects/colive-terminal/aesthetic/snap.sh 21-effort-picker`

Press Escape to dismiss.

---

## 22 — `/usage` display

Type `/usage` and press Enter.

Snap showing the usage statistics display.

Snap: `./projects/colive-terminal/aesthetic/snap.sh 22-usage-display`

---

## 23 — `/model` picker

Type `/model` and press Enter.

Snap showing the model selection UI.

Snap: `./projects/colive-terminal/aesthetic/snap.sh 23-model-picker`

Press Escape to dismiss.

---

## 24 — `/config` display

Type `/config` and press Enter.

Snap showing the configuration display.

Snap: `./projects/colive-terminal/aesthetic/snap.sh 24-config-display`

---

## 25 — `/memory` display

Type `/memory` and press Enter.

Snap showing the memory entries display.

Snap: `./projects/colive-terminal/aesthetic/snap.sh 25-memory-display`

---

## Done

Run `./projects/colive-terminal/aesthetic/snap.sh` (no args) to verify all 25 are captured (all should show ✔).
