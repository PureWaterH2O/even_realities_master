# M3.5 Aesthetic Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the comparison tooling (snap helper, scenario runbook, replay scenarios), then systematically implement rendering changes to make the desk client visually indistinguishable at a glance from native Claude Code.

**Architecture:** A two-phase approach: Phase A builds the comparison infrastructure (snap.sh, scenarios.md, 25 replay event sequences, and a new aesthetic preview test file). Phase B is the rendering fix implementation, grouped by UI element — each group modifies the relevant rendering file(s), re-runs the replay harness, and commits. Phase B tasks are structured as templates since the exact differences will be cataloged after the user captures reference frames; the plan covers the anticipated groups and the code paths each touches.

**Tech Stack:** TypeScript, Ink (React-based terminal UI), Vitest, macOS `screencapture`

---

## Execution Model

This plan is executed across **three roles**:

| Role | Who/what | Environment |
|---|---|---|
| **Planner** | This chat | Opus 4.6, stays alive throughout, reviews between runs |
| **Builder** | Separate chat | Opus 4.8, ultracode + automode, long unattended runs |
| **User** | You (Thomas) | VS Code terminal, hardware (G2+R1), manual captures |

### Handoff Sequence

```
┌─────────────────────────────────────────────────────────────┐
│ BUILDER RUN 1: Tasks 1-5 (comparison infrastructure)        │
│   snap.sh, scenarios.md, replay scenarios, test file, stub  │
│   ~30 min, fully autonomous                                 │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 👤 USER: Reference capture session (~15 min)                │
│   Run native Claude through 25 scenarios using snap.sh      │
│   Manual — cannot be automated                              │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ PLANNER: Catalog differences                                │
│   Compare reference PNGs vs replay frames                   │
│   Produce catalog.md with D-001..D-??? entries              │
│   Populate Phase B tasks with exact fixes                   │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ BUILDER RUN 2: Tasks 6-15 (rendering fixes)                 │
│   Work through element groups, fix loop per group           │
│   Long run (~2-4 hours), fully autonomous                   │
│   Re-runs replay harness after each group as regression     │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ PLANNER: Review builder output                              │
│   Verify catalog entries are checked off                    │
│   Spot-check replay frames vs references                    │
│   Kick off final verification if gaps remain                │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ BUILDER RUN 3: Task 16-17 (final verification + UAT prep)   │
│   Full replay, full test suite, UAT runbook generation      │
│   ~15 min, autonomous                                       │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 👤 USER: Hardware UAT (~30 min)                             │
│   All 25 scenarios on real desk + G2 + R1                   │
│   Manual — cannot be automated                              │
└─────────────────────────────────────────────────────────────┘
```

### Key Decision Points (planner gates)

1. **After Builder Run 1:** Planner verifies infra works (tests pass, frames dump correctly) before user capture.
2. **After User Capture:** Planner catalogs differences and decides whether Phase B tasks need refinement.
3. **After Builder Run 2:** Planner reviews the rendering changes before final verification.
4. **After UAT:** Planner records sign-off and transitions to customization brainstorm.

---

## Phase A — Comparison Infrastructure

### Task 1: Create the `snap.sh` capture helper

**Files:**
- Create: `projects/colive-terminal/aesthetic/snap.sh`

- [ ] **Step 1: Create the directory structure**

```bash
mkdir -p projects/colive-terminal/aesthetic/reference
```

- [ ] **Step 2: Write `snap.sh`**

```bash
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
```

- [ ] **Step 3: Make it executable**

Run: `chmod +x projects/colive-terminal/aesthetic/snap.sh`

- [ ] **Step 4: Verify it runs**

Run: `./projects/colive-terminal/aesthetic/snap.sh`
Expected: Prints usage with all 25 scenarios listed as `☐`

- [ ] **Step 5: Commit**

```bash
git add projects/colive-terminal/aesthetic/snap.sh projects/colive-terminal/aesthetic/reference/
git commit -m "feat(m3.5): snap.sh capture helper for native Claude reference screenshots"
```

---

### Task 2: Write the `scenarios.md` capture runbook

**Files:**
- Create: `projects/colive-terminal/aesthetic/scenarios.md`

- [ ] **Step 1: Write the runbook**

Create `projects/colive-terminal/aesthetic/scenarios.md` with the following content. Each scenario has: what to type in native Claude, what state to wait for, and the snap command to run. The runbook is ordered for a single continuous Claude session where possible (later scenarios build on earlier state).

```markdown
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
Count from 1 to 20, one number per line
```

Snap **while the response is still streaming** (you'll see text appearing line by line).

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
```

- [ ] **Step 2: Commit**

```bash
git add projects/colive-terminal/aesthetic/scenarios.md
git commit -m "docs(m3.5): reference capture runbook — 25 scenario walk-through"
```

---

### Task 3: Add aesthetic replay scenarios to `test/preview/scenarios.ts`

**Files:**
- Modify: `colive-terminal/test/preview/scenarios.ts`

This task adds new exported event sequences matching the 25 reference scenarios. The existing scenarios (`cockpit`, `markdownDoc`, `inProgress`, `tall`, `thinking`, `diffEdit`) already cover some of these; we create new ones for gaps and re-export everything with aesthetic-prefixed names for the new test file.

- [ ] **Step 1: Study which existing scenarios already map to reference scenarios**

Map:
- `01-idle` → new (empty event sequence, just the app chrome)
- `02-simple-qa` → new
- `03-streaming` → new (text_delta without result — still streaming)
- `04-thinking` → existing `thinking` covers this
- `05-tool-read` → new
- `06-tool-bash` → partially covered by `cockpit` (has a Bash tool)
- `07-tool-edit` → existing `diffEdit` covers this
- `08-multi-tool` → existing `cockpit` covers this
- `09-permission` → new
- `10-todos` → existing `inProgress` covers this
- `11-markdown` → existing `markdownDoc` covers this
- `12-scrollback` → existing `tall` covers this
- `13-error` → new
- `14-status-line` → new (busy state with running_stats)
- `15-slash-menu` → new (needs keystroke sequence — capture() only)
- `16-question` → new
- `17-background-cmd` → new
- `18-subagent` → new
- `19-interrupt` → new (needs Esc keystroke — capture() only)
- `20-cost-summary` → partially covered by any scenario with `endTurn`
- `21-effort-picker` → new (needs keystroke sequence)
- `22-usage-display` → new (needs /usage command)
- `23-model-picker` → new (needs /model keystroke)
- `24-config-display` → new (needs /config command)
- `25-memory-display` → new (needs /memory command — may not be implemented yet)

- [ ] **Step 2: Add the new scenario event sequences**

Add these new exports to `colive-terminal/test/preview/scenarios.ts`:

```typescript
/** 01 — Idle: no events at all — just the app chrome (prompt + status line). */
export const idle: CoLiveEvent[] = []

/** 02 — Simple Q&A: one user prompt + one short assistant response. */
export const simpleQA: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Say hello' },
  { type: 'status', state: 'busy' },
  { type: 'text_delta', text: 'Hello! What can I help you with today?' },
  ...endTurn('Hello! What can I help you with today?'),
]

/** 03 — Streaming: a text_delta in progress (no result yet — still streaming). */
export const streaming: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Count from 1 to 20' },
  { type: 'status', state: 'busy' },
  { type: 'text_delta', text: '1\n2\n3\n4\n5\n6\n7\n8\n9\n10' },
]

/** 05 — Tool Read: a completed Read tool call. */
export const toolRead: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Read the file CLAUDE.md' },
  { type: 'status', state: 'busy' },
  toolStart('Read', 'r1'),
  toolEnd('Read', 'r1', 'Read completed', { file_path: 'CLAUDE.md' }, '# CLAUDE.md\n\nProject instructions...'),
  { type: 'text_delta', text: "I've read the file. Here's what it contains..." },
  ...endTurn("I've read the file. Here's what it contains..."),
]

/** 06 — Tool Bash: a completed Bash tool call with output. */
export const toolBash: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Run ls -la in the current directory' },
  { type: 'status', state: 'busy' },
  toolStart('Bash', 'b1'),
  toolEnd('Bash', 'b1', 'Bash completed', { command: 'ls -la', description: 'List files' }, { stdout: 'total 32\ndrwxr-xr-x  5 user  staff  160 Jun  6 12:00 .\n-rw-r--r--  1 user  staff  245 Jun  6 11:00 CLAUDE.md\n-rw-r--r--  1 user  staff  1024 Jun  6 10:00 package.json', stderr: '', interrupted: false }),
  { type: 'text_delta', text: "Here are the files in the current directory." },
  ...endTurn("Here are the files in the current directory."),
]

/** 09 — Permission prompt: a tool requiring permission (rendered as inline prompt). */
export const permission: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Delete the file /tmp/m35-test.txt' },
  { type: 'status', state: 'busy' },
  { type: 'text_delta', text: "I'll delete that file for you." },
  toolStart('Bash', 'b1'),
  {
    type: 'permission_request',
    toolName: 'Bash',
    toolUseId: 'b1',
    description: 'rm /tmp/m35-test.txt',
    detail: 'Delete file /tmp/m35-test.txt',
    options: [
      { key: 'allow', text: 'Allow' },
      { key: 'deny', text: 'Deny' },
      { key: 'allow_always', text: 'Allow always' },
    ],
  } as CoLiveEvent,
]

/** 13 — Error diagnostic: a failed tool result. */
export const errorDiag: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Read /tmp/no-such-file-12345.txt' },
  { type: 'status', state: 'busy' },
  toolStart('Read', 'r1'),
  toolEnd('Read', 'r1', 'Read failed', { file_path: '/tmp/no-such-file-12345.txt' }, { error: 'ENOENT: no such file or directory' }),
  { type: 'text_delta', text: "The file doesn't exist." },
  ...endTurn("The file doesn't exist."),
]

/** 14 — Status line while busy: running_stats mid-turn (no result yet). */
export const statusBusy: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Explain the theory of relativity in detail' },
  { type: 'status', state: 'busy' },
  { type: 'thinking_delta', text: 'Let me organize my thoughts about relativity...' },
  { type: 'running_stats', durationMs: 3200, inputTokens: 850, outputTokens: 120 },
  { type: 'text_delta', text: "## Special Relativity\n\nEinstein's theory of special relativity..." },
]

/** 16 — Question prompt: Claude asks the user a question with multiple-choice options. */
export const question: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Ask me about my preferences' },
  { type: 'status', state: 'busy' },
  { type: 'text_delta', text: "I'd like to understand your preferences better." },
  toolStart('AskUserQuestion', 'q1'),
  {
    type: 'user_question',
    question: 'Which programming language do you prefer?',
    toolUseId: 'q1',
    options: ['TypeScript', 'Python', 'Rust'],
  } as CoLiveEvent,
]

/** 17 — Background Bash: a tool_start with no tool_end yet (still running). */
export const backgroundCmd: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Run sleep 5 && echo done in the background' },
  { type: 'status', state: 'busy' },
  { type: 'text_delta', text: "I'll run that command in the background." },
  toolStart('Bash', 'bg1'),
]

/** 18 — Subagent: an Agent tool invocation. */
export const subagent: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Spawn a subagent to answer: what is 2+2?' },
  { type: 'status', state: 'busy' },
  toolStart('Agent', 'a1'),
  toolEnd('Agent', 'a1', 'Agent completed', { prompt: 'What is 2+2?', description: 'Math question' }, { result: '4' }),
  { type: 'text_delta', text: 'The subagent reports: 2+2 = 4.' },
  ...endTurn('The subagent reports: 2+2 = 4.'),
]

/** 20 — Cost summary: a completed turn with cost/token data visible. */
export const costSummary: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Summarize this project' },
  { type: 'status', state: 'busy' },
  { type: 'text_delta', text: 'This project builds a Co-Live Terminal for Even Realities G2 smart glasses.' },
  {
    type: 'result',
    success: true,
    text: 'This project builds a Co-Live Terminal for Even Realities G2 smart glasses.',
    sessionId: 's-preview',
    costUsd: 0.0342,
    provider: 'claude',
    turns: 5,
    durationMs: 8700,
    inputTokens: 12480,
    outputTokens: 2106,
  } as CoLiveEvent,
  { type: 'running_stats', durationMs: 8700, inputTokens: 12480, outputTokens: 2106 },
  { type: 'status', state: 'idle' },
]
```

- [ ] **Step 3: Verify the file compiles**

Run: `cd colive-terminal && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add test/preview/scenarios.ts
git commit -m "feat(m3.5): aesthetic replay scenarios — 13 new event sequences for reference comparison"
```

---

### Task 4: Create the aesthetic preview test file

**Files:**
- Create: `colive-terminal/test/preview/aesthetic.preview.test.tsx`

This test file exercises every scenario, writes frames when `PREVIEW=1`, and runs smoke assertions. It reuses the `capture()` and `flattenAll()` helpers from `replay.tsx`.

- [ ] **Step 1: Write the test file**

```typescript
/**
 * M3.5 Aesthetic Pass — renders all 25 scenarios and dumps comparison frames.
 *
 *   PREVIEW=1 npx vitest run test/preview/aesthetic.preview.test.tsx
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { capture, flattenAll, emit, snap, key, KEYS, type Frame } from './replay'
import {
  idle, simpleQA, streaming, thinking, toolRead, toolBash, diffEdit,
  cockpit, permission, inProgress, markdownDoc, tall, errorDiag,
  statusBusy, question, backgroundCmd, subagent, costSummary,
} from './scenarios'

const WRITE = process.env.PREVIEW === '1'
const OUT = resolve(__dirname, '../../preview-out/aesthetic')
const written: string[] = []

function dump(name: string, frames: Frame[]): void {
  if (!WRITE) return
  mkdirSync(OUT, { recursive: true })
  frames.forEach((f, i) => {
    const base = `${name}-${String(i + 1).padStart(2, '0')}-${f.label}`
    writeFileSync(resolve(OUT, `${base}.txt`), `${f.plain}\n`, 'utf8')
    writeFileSync(resolve(OUT, `${base}.ansi`), `${f.ansi}\n`, 'utf8')
    written.push(base)
  })
}

afterAll(() => {
  if (WRITE) {
    // eslint-disable-next-line no-console
    console.log(`\n[aesthetic] wrote ${written.length} frame(s) to preview-out/aesthetic/:\n  ${written.join('\n  ')}`)
  }
})

describe('aesthetic preview', () => {
  it('01-idle: app chrome with no events', async () => {
    const frames = await capture([snap('idle')])
    dump('01-idle', frames)
    expect(frames[0]!.plain).toContain('>')
  })

  it('02-simple-qa: one turn', async () => {
    const full = flattenAll(simpleQA)
    dump('02-simple-qa', [full])
    expect(full.plain).toContain('Say hello')
    expect(full.plain).toContain('Hello!')
  })

  it('03-streaming: mid-stream (no result yet)', async () => {
    const full = flattenAll(streaming)
    dump('03-streaming', [full])
    expect(full.plain).toContain('Count from 1 to 20')
    expect(full.plain).toContain('10')
  })

  it('04-thinking: collapsed thinking block', async () => {
    const full = flattenAll(thinking)
    dump('04-thinking', [full])
    expect(full.plain).toContain('thinking')
  })

  it('05-tool-read: Read tool header', async () => {
    const full = flattenAll(toolRead)
    dump('05-tool-read', [full])
    expect(full.plain).toContain('Read')
    expect(full.plain).toContain('CLAUDE.md')
  })

  it('06-tool-bash: Bash tool with output', async () => {
    const full = flattenAll(toolBash)
    dump('06-tool-bash', [full])
    expect(full.plain).toContain('Bash')
    expect(full.plain).toContain('ls -la')
  })

  it('07-tool-edit: Edit with inline diff', async () => {
    const full = flattenAll(diffEdit)
    dump('07-tool-edit', [full])
    expect(full.plain).toContain('Edit')
    expect(full.plain).toContain('greet')
  })

  it('08-multi-tool: multiple tools in one turn', async () => {
    const full = flattenAll(cockpit)
    dump('08-multi-tool', [full])
    expect(full.plain).toContain('Bash')
    expect(full.plain).toContain('Edit')
    expect(full.plain).toContain('Read')
  })

  it('09-permission: inline permission prompt', async () => {
    const frames = await capture([...permission.map(emit), snap('permission')])
    dump('09-permission', frames)
    expect(frames[0]!.plain).toContain('permission')
    expect(frames[0]!.plain).toContain('Allow')
  })

  it('10-todos: task panel with mixed states', async () => {
    const full = flattenAll(inProgress)
    dump('10-todos', [full])
    expect(full.plain).toMatch(/✔/)
    expect(full.plain).toMatch(/▶/)
    expect(full.plain).toMatch(/☐/)
  })

  it('11-markdown: rendered markdown elements', async () => {
    const full = flattenAll(markdownDoc)
    dump('11-markdown', [full])
    expect(full.plain).toContain('Heading two')
    expect(full.plain).not.toContain('## Heading two')
  })

  it('12-scrollback: scrolled viewport', async () => {
    const frames = await capture([
      ...tall.map(emit),
      snap('bottom'),
      key(KEYS.pageUp),
      snap('scrolled'),
    ])
    dump('12-scrollback', frames)
    expect(frames[0]!.plain).toContain('pinned')
  })

  it('13-error: failed tool rendering', async () => {
    const full = flattenAll(errorDiag)
    dump('13-error', [full])
    expect(full.plain).toContain('Read')
    expect(full.plain).toContain('failed')
  })

  it('14-status-line: busy state with running stats', async () => {
    const frames = await capture([...statusBusy.map(emit), snap('busy')])
    dump('14-status-line', frames)
    expect(frames[0]!.plain).toContain('850')
  })

  it('15-slash-menu: / command picker', async () => {
    const frames = await capture([snap('before'), key('/'), snap('menu-open')])
    dump('15-slash-menu', frames)
    expect(frames[1]!.plain).toContain('clear')
  })

  it('16-question: inline question prompt', async () => {
    const frames = await capture([...question.map(emit), snap('question')])
    dump('16-question', frames)
    expect(frames[0]!.plain).toContain('programming language')
    expect(frames[0]!.plain).toContain('TypeScript')
  })

  it('17-background-cmd: tool running (no end yet)', async () => {
    const full = flattenAll(backgroundCmd)
    dump('17-background-cmd', [full])
    expect(full.plain).toContain('Bash')
  })

  it('18-subagent: Agent tool call', async () => {
    const full = flattenAll(subagent)
    dump('18-subagent', [full])
    expect(full.plain).toContain('Agent')
  })

  it('19-interrupt: Esc mid-stream', async () => {
    const frames = await capture([
      ...streaming.map(emit),
      snap('pre-interrupt'),
      key('\x1b'),
      snap('post-interrupt'),
    ])
    dump('19-interrupt', frames)
  })

  it('20-cost-summary: token/cost display', async () => {
    const frames = await capture([...costSummary.map(emit), snap('cost')])
    dump('20-cost-summary', frames)
    expect(frames[0]!.plain).toContain('12480')
  })

  it('21-effort-picker: /effort UI', async () => {
    // /effort may not be implemented — capture what we have
    const frames = await capture([
      key('/'),
      key('e'), key('f'), key('f'), key('o'), key('r'), key('t'),
      snap('effort'),
    ])
    dump('21-effort-picker', frames)
  })

  it('22-usage-display: /usage output', async () => {
    const frames = await capture([
      ...simpleQA.map(emit),
      key('/'),
      key('u'), key('s'), key('a'), key('g'), key('e'),
      key('\r'),
      snap('usage'),
    ])
    dump('22-usage-display', frames)
  })

  it('23-model-picker: /model UI', async () => {
    const frames = await capture([
      key('/'),
      key('m'), key('o'), key('d'), key('e'), key('l'),
      snap('model-menu'),
    ])
    dump('23-model-picker', frames)
  })

  it('24-config-display: /config output', async () => {
    // /config may render a note — capture what we have
    const frames = await capture([
      key('/'),
      key('c'), key('o'), key('n'), key('f'), key('i'), key('g'),
      key('\r'),
      snap('config'),
    ])
    dump('24-config-display', frames)
  })

  it('25-memory-display: /memory output', async () => {
    // /memory may not be implemented — capture what we have
    const frames = await capture([
      key('/'),
      key('m'), key('e'), key('m'), key('o'), key('r'), key('y'),
      key('\r'),
      snap('memory'),
    ])
    dump('25-memory-display', frames)
  })
})
```

- [ ] **Step 2: Run the tests to verify they compile and pass**

Run: `cd colive-terminal && npx vitest run test/preview/aesthetic.preview.test.tsx`
Expected: All 25 tests pass (some may skip gracefully if features aren't implemented)

- [ ] **Step 3: Run with PREVIEW=1 to dump frames**

Run: `cd colive-terminal && PREVIEW=1 npx vitest run test/preview/aesthetic.preview.test.tsx`
Expected: Frames written to `preview-out/aesthetic/`. Verify with `ls preview-out/aesthetic/`

- [ ] **Step 4: Verify a frame is viewable**

Run: `cat colive-terminal/preview-out/aesthetic/02-simple-qa-01-full.ansi`
Expected: Colored ANSI output showing the Q&A turn

- [ ] **Step 5: Commit**

```bash
git add test/preview/aesthetic.preview.test.tsx
git commit -m "test(m3.5): aesthetic preview suite — 25 scenarios for reference comparison"
```

---

### Task 5: Create the symlink and initial catalog stub

**Files:**
- Create: `projects/colive-terminal/aesthetic/replay` (symlink)
- Create: `projects/colive-terminal/aesthetic/catalog.md`

- [ ] **Step 1: Create the replay symlink**

```bash
ln -s ../../../colive-terminal/preview-out/aesthetic projects/colive-terminal/aesthetic/replay
```

- [ ] **Step 2: Create the catalog stub**

```markdown
# M3.5 Aesthetic Pass — Difference Catalog

Generated by comparing native Claude reference screenshots (`reference/`) against
our replay frames (`replay/`). Each entry is one visual difference.

Severity: **major** (structurally wrong) · **medium** (noticeably different) · **minor** (subtle)

---

_Catalog will be populated after reference frames are captured._
```

- [ ] **Step 3: Commit**

```bash
git add projects/colive-terminal/aesthetic/replay projects/colive-terminal/aesthetic/catalog.md
git commit -m "feat(m3.5): catalog stub + replay symlink for aesthetic comparison"
```

---

## Phase B — Rendering Fixes (post-catalog)

> **Note:** Phase B tasks are structured by element group. The exact differences within each group will be filled in from the catalog after the user captures reference frames. Each task follows the same fix loop: implement → re-run replay → compare → check off catalog entries → commit.

### Task 6: Banner / chrome group

**Files:**
- Modify: `colive-terminal/src/desk/app.tsx` (startup banner, overall frame)
- Modify: `colive-terminal/src/desk/input/input-rows.ts` (prompt character)

**Anticipated differences (to be confirmed by catalog):**
- No startup banner (native shows ASCII robot + version + model info + "feature of the week")
- Prompt character `>` instead of native's `❯`
- No "feature of the week" tip

- [ ] **Step 1: Add a startup banner component to `app.tsx`**

Study the native Claude banner from the reference screenshot (`01-idle.png`). Implement a `Banner` component that renders:
- A simplified version of the robot ASCII art (or skip the art — match what native shows)
- Version line: `Claude Code vX.Y.Z`
- Model + effort line
- Working directory
- Separator

Render the banner as the first block in the transcript when the session is new (no events yet).

- [ ] **Step 2: Change the prompt character from `>` to `❯` in `input-rows.ts`**

In `colive-terminal/src/desk/input/input-rows.ts`, change:
```typescript
const prefix = row === 0 ? '> ' : '  '
```
to:
```typescript
const prefix = row === 0 ? '❯ ' : '  '
```

- [ ] **Step 3: Run tests to verify nothing breaks**

Run: `cd colive-terminal && npx vitest run`
Expected: All tests pass. Some tests may assert on `>` — update those assertions to `❯`.

- [ ] **Step 4: Re-run aesthetic preview and compare**

Run: `cd colive-terminal && PREVIEW=1 npx vitest run test/preview/aesthetic.preview.test.tsx`
Compare `01-idle` frames against `reference/01-idle.png`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "fix(m3.5): banner + prompt character — match native Claude chrome"
```

---

### Task 7: Prompt bar group

**Files:**
- Modify: `colive-terminal/src/desk/render/rows.ts` (user block rendering)
- Modify: `colive-terminal/src/desk/render/ansi.ts` (may need `bgGray` or similar)

**Anticipated differences (to be confirmed by catalog):**
- Native renders user prompts as `❯ text` on a full-width dark background bar
- Ours renders as `you  text` with cyan label, no background

- [ ] **Step 1: Study the native prompt bar from `02-simple-qa.png`**

Note the exact styling: background color, text color, `❯` prefix, full-width bar, spacing.

- [ ] **Step 2: Update the `case 'user'` branch in `renderBlockRows`**

In `rows.ts`, change:
```typescript
case 'user':
  return toRows(`${cyan('you')}  ${block.text}`, width)
```
to match native's styling (full-width inverted/background bar with `❯` prefix). The exact ANSI codes depend on what the reference shows — likely:
```typescript
case 'user': {
  const line = `❯ ${block.text}`
  const padded = line.padEnd(width)
  return toRows(inverse(bold(padded)), width)
}
```

- [ ] **Step 3: Run tests — update any assertions that match on `you `**

Run: `cd colive-terminal && npx vitest run`
Fix any tests that assert on the old `you  ` prefix.

- [ ] **Step 4: Re-run aesthetic preview and compare `02-simple-qa`**

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(m3.5): prompt bar — full-width inverted bar matching native"
```

---

### Task 8: Tool headers group

**Files:**
- Modify: `colive-terminal/src/desk/render/rows.ts` (tool block rendering)

**Anticipated differences (to be confirmed by catalog):**
- Native uses `✱ Cooked for 3s` (star prefix, verb-based summary, timing)
- Native uses `❯ Collapsible header` (full-width dark bar for collapsible sections)
- Ours uses `⏺ ToolName(arg)` (dot prefix, raw tool name)

- [ ] **Step 1: Study native tool headers from `05-tool-read.png`, `06-tool-bash.png`, `07-tool-edit.png`, `08-multi-tool.png`**

Catalog the exact rendering per tool type: what prefix, what text, what colors, what timing format.

- [ ] **Step 2: Update the `case 'tool'` branch in `renderBlockRows`**

Adjust the tool header rendering to match native's style. This likely involves:
- Changing the status dot style
- Adjusting the tool name/arg format
- Adding timing display (if available from `tool_end` detail)
- Matching the collapsible section header style for multi-step tools

- [ ] **Step 3: Run tests and fix assertions**

- [ ] **Step 4: Re-run aesthetic preview and compare tool scenarios**

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(m3.5): tool headers — match native prefix/format/timing"
```

---

### Task 9: Status line group

**Files:**
- Modify: `colive-terminal/src/desk/app.tsx` (status line JSX)

**Anticipated differences (to be confirmed by catalog):**
- Native: `Opus 4.6 (1M context) | ctx: 3% | tokens: 29046 | 5h: 4% | 7d: 26%`
- Ours: `[idle · opus-4-8 · plan · 41 tokens (3 in / 38 out)] session 50ddff0e-...`

- [ ] **Step 1: Study native status line from `01-idle.png` and `14-status-line.png`**

Note: format, separators, what data is shown, position, colors.

- [ ] **Step 2: Update the status line rendering in `app.tsx`**

In `app.tsx` around line 670, replace the bracketed format with native's pipe-separated format. Remove the session ID (or move it elsewhere). Match the data shown.

- [ ] **Step 3: Run tests and fix assertions**

- [ ] **Step 4: Re-run aesthetic preview and compare**

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(m3.5): status line — match native format and content"
```

---

### Task 10: Assistant text group

**Files:**
- Modify: `colive-terminal/src/desk/render/rows.ts` (assistant block rendering)

**Anticipated differences (to be confirmed by catalog):**
- Native uses `●` green bullet prefix for assistant text
- Our streaming text uses `claude  ` label, closed text has no prefix (just rendered markdown)

- [ ] **Step 1: Study native assistant text from `02-simple-qa.png` and `03-streaming.png`**

- [ ] **Step 2: Update the `case 'assistant'` branch**

Adjust both streaming and closed assistant rendering to match native's prefix/style.

- [ ] **Step 3: Run tests and fix assertions**

- [ ] **Step 4: Re-run aesthetic preview and compare**

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(m3.5): assistant text — match native bullet prefix and styling"
```

---

### Task 11: Thinking / Todos / Markdown group

**Files:**
- Modify: `colive-terminal/src/desk/render/rows.ts` (thinking + todos rendering)
- Possibly: `colive-terminal/src/desk/render/markdown.ts`

**Anticipated differences (to be confirmed by catalog):**
- Thinking: collapsed indicator style
- Todos: header style, glyph alignment
- Markdown: code block borders, heading weight, list bullets

- [ ] **Step 1: Compare `04-thinking.png`, `10-todos.png`, `11-markdown.png` against replay frames**

- [ ] **Step 2: Implement fixes for each sub-element**

- [ ] **Step 3: Run tests and fix assertions**

- [ ] **Step 4: Re-run aesthetic preview and compare**

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(m3.5): thinking/todos/markdown — match native formatting"
```

---

### Task 12: Diffs group

**Files:**
- Modify: `colive-terminal/src/desk/render/diff.ts`

**Anticipated differences (to be confirmed by catalog):**
- Gutter characters and colors
- Line prefix spacing
- Context line styling

- [ ] **Step 1: Compare `07-tool-edit.png` against replay frames**

- [ ] **Step 2: Adjust diff rendering to match**

- [ ] **Step 3: Run tests and fix assertions**

- [ ] **Step 4: Re-run aesthetic preview and compare**

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(m3.5): diff rendering — match native gutter/colors"
```

---

### Task 13: Permission / Question prompts group

**Files:**
- Modify: `colive-terminal/src/desk/app.tsx` (PendingPrompt component)

**Anticipated differences (to be confirmed by catalog):**
- Border style
- Option rendering format
- Color scheme for permission vs question
- Input field styling

- [ ] **Step 1: Compare `09-permission.png` and `16-question.png` against replay frames**

- [ ] **Step 2: Adjust PendingPrompt rendering**

- [ ] **Step 3: Run tests and fix assertions**

- [ ] **Step 4: Re-run aesthetic preview and compare**

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(m3.5): permission/question prompts — match native styling"
```

---

### Task 14: Menus / Pickers group

**Files:**
- Modify: `colive-terminal/src/desk/app.tsx` (menu rendering JSX)

**Anticipated differences (to be confirmed by catalog):**
- Slash menu appearance
- Model/mode picker styling
- Highlight/selection indicator

- [ ] **Step 1: Compare `15-slash-menu.png`, `21-effort-picker.png`, `23-model-picker.png` against replay frames**

- [ ] **Step 2: Adjust menu rendering**

- [ ] **Step 3: Run tests and fix assertions**

- [ ] **Step 4: Re-run aesthetic preview and compare**

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(m3.5): menus/pickers — match native styling"
```

---

### Task 15: Behavioral group

**Files:**
- Modify: Various (depends on specific behavioral differences found)

**Anticipated differences (to be confirmed by catalog):**
- Streaming text cursor/caret appearance
- Spinner or animation during thinking
- Scroll indicator style
- Transition effects between states

- [ ] **Step 1: Compare behavioral scenarios (03, 12, 14, 19) — may need screen recordings rather than static frames**

- [ ] **Step 2: Implement behavioral adjustments**

- [ ] **Step 3: Run full test suite**

Run: `cd colive-terminal && npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git commit -am "fix(m3.5): behavioral parity — streaming/scroll/animation"
```

---

### Task 16: Final verification pass

**Files:**
- Modify: `projects/colive-terminal/aesthetic/catalog.md` (check off remaining items)

- [ ] **Step 1: Re-run the full aesthetic preview suite**

Run: `cd colive-terminal && PREVIEW=1 npx vitest run test/preview/aesthetic.preview.test.tsx`

- [ ] **Step 2: Compare every frame against its reference screenshot**

Walk through all 25 scenarios. Any remaining differences get added to the catalog and fixed.

- [ ] **Step 3: Run the full test suite**

Run: `cd colive-terminal && npx vitest run`
Expected: All tests pass (no regressions)

- [ ] **Step 4: Run typecheck**

Run: `cd colive-terminal && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 5: Update catalog — all entries checked off**

- [ ] **Step 6: Commit**

```bash
git commit -am "docs(m3.5): catalog cleared — all differences resolved"
```

---

## Phase C — UAT

### Task 17: Generate UAT runbook and hand off for hardware testing

**Files:**
- Create: `projects/colive-terminal/m3.5-uat-runbook.md`

- [ ] **Step 1: Generate the UAT runbook from scenarios.md**

Use the same copy-paste format as previous rungs. Cover all 25 scenarios with:
- Exact commands to type
- What to look for (should now match native Claude)
- Pass/fail for each scenario

- [ ] **Step 2: Commit and hand off**

```bash
git add projects/colive-terminal/m3.5-uat-runbook.md
git commit -m "docs(m3.5): UAT runbook — 25 scenario hardware walk-through"
```

Hand off to the user for hardware UAT on real G2 + R1.
