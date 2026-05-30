# Even Realities Knowledge Base & Workspace — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the knowledge-base directory structure, conventions, CLAUDE.md context, and the auto-capture Stop hook so every future session loads context and reliably records new findings.

**Architecture:** A curated `knowledge/` tree (confidence-tagged reference) separated from a raw, append-only `research/` audit trail; `projects/` + `ideas/` for work tracking; overarching trackers (`PROGRESS.md`, the `INDEX.md` files). Auto-capture is three layers: CLAUDE.md rules (in-session discipline), a Stop hook (one end-of-session reminder to flush findings), and the existing `.remember/` system (cross-session continuity).

**Tech Stack:** Markdown, JSON (Claude Code `settings.json` hooks), POSIX shell (`jq` for the hook), git/`gh`.

**Reference spec:** `docs/superpowers/specs/2026-05-30-even-realities-knowledge-base-design.md`

---

## File Structure

Files created by this plan:

```
knowledge/INDEX.md                     # master map + per-domain coverage/confidence
knowledge/_TEMPLATE.md                 # template for a knowledge doc
knowledge/limitations.md               # cross-cutting limits & open questions
knowledge/hardware/.gitkeep            # (domain dirs seeded empty until research lands)
knowledge/firmware-ble/.gitkeep
knowledge/sdk-app-dev/.gitkeep
knowledge/terminal-mode/.gitkeep
knowledge/ecosystem/.gitkeep
projects/INDEX.md                      # project status board
projects/_TEMPLATE/spec.md             # per-project file templates
projects/_TEMPLATE/plan.md
projects/_TEMPLATE/status.md
projects/_TEMPLATE/notes.md
projects/_TEMPLATE/log.md
ideas/backlog.md                       # running idea list
research/README.md                     # explains raw/cited sweep format + template
PROGRESS.md                            # overarching dated changelog
CLAUDE.md                              # auto-loaded context + conventions
.claude/hooks/capture-reminder.sh      # Stop-hook script (one reminder/session)
.claude/settings.json                  # registers the Stop hook (shared, committed)
```

A shared, reusable legend block (the 5-level confidence scheme) is duplicated into
`README.md` (done), `CLAUDE.md`, and `knowledge/INDEX.md` deliberately — these are the
three entry points a reader/agent hits, and each must be self-contained.

---

## Task 1: Knowledge base trackers & templates

**Files:**
- Create: `knowledge/INDEX.md`
- Create: `knowledge/_TEMPLATE.md`
- Create: `knowledge/limitations.md`
- Create: `knowledge/hardware/.gitkeep`, `knowledge/firmware-ble/.gitkeep`, `knowledge/sdk-app-dev/.gitkeep`, `knowledge/terminal-mode/.gitkeep`, `knowledge/ecosystem/.gitkeep`

- [ ] **Step 1: Create the domain directories with `.gitkeep`**

```bash
mkdir -p knowledge/hardware knowledge/firmware-ble knowledge/sdk-app-dev knowledge/terminal-mode knowledge/ecosystem
touch knowledge/hardware/.gitkeep knowledge/firmware-ble/.gitkeep knowledge/sdk-app-dev/.gitkeep knowledge/terminal-mode/.gitkeep knowledge/ecosystem/.gitkeep
```

- [ ] **Step 2: Write `knowledge/_TEMPLATE.md`**

```markdown
---
title: <Topic>
domain: <hardware | firmware-ble | sdk-app-dev | terminal-mode | ecosystem>
last_updated: YYYY-MM-DD
overall_confidence: <🧪 | ✅ | 🟡 | 🔴>
---

# <Topic>

> Confidence legend: 🧪 self-verified · ✅ verified · 🟡 community-claim · 🔴 unverified · ❌ disproven

## Summary

<2–4 sentence overview of what we know.>

## Facts

- 🟡 **<claim>** — <detail>. _Source: [research/YYYY-MM-DD-<topic>/sources.md#sN]_
- ✅ **<claim>** — <detail>. _Source: ..._

## Open questions

- <thing we don't yet know>

## Change log

- YYYY-MM-DD: created.
- YYYY-MM-DD: promoted "<claim>" 🟡→🧪 after <our test>. / killed "<claim>" →❌ because <finding>.
```

- [ ] **Step 3: Write `knowledge/INDEX.md`**

```markdown
# Knowledge Index

Master map of what we know about the Even Realities G2 glasses and R1 ring.
Curated reference only — raw research lives in `../research/`.

> Confidence legend: 🧪 self-verified · ✅ verified · 🟡 community-claim · 🔴 unverified · ❌ disproven
> A claim is **promoted** (🟡/🔴 → ✅/🧪) or **killed** (→ ❌) as our own dev work generates ground truth.

## Coverage by domain

| Domain | Folder | Status | Top confidence | Notes |
|--------|--------|--------|----------------|-------|
| Terminal mode & usage | `terminal-mode/` | ⬜ not started | — | Priority 1 |
| App / SDK development | `sdk-app-dev/` | ⬜ not started | — | Priority 2 |
| BLE / firmware / protocol | `firmware-ble/` | ⬜ not started | — | Priority 3 |
| Hardware & specs | `hardware/` | ⬜ not started | — | Secondary |
| Ecosystem | `ecosystem/` | ⬜ not started | — | Secondary |

Status key: ⬜ not started · 🟨 partial · 🟩 solid coverage

## Cross-cutting

- Limitations & open questions: `limitations.md`

## How to add knowledge

1. Run/append a research sweep into `../research/YYYY-MM-DD-<topic>/`.
2. Distill trustworthy facts into the relevant `<domain>/` doc using `_TEMPLATE.md`.
3. Tag each fact's confidence and link its source.
4. Update this table and append to `../PROGRESS.md`.
```

- [ ] **Step 4: Write `knowledge/limitations.md`**

```markdown
---
title: Cross-cutting Limitations & Open Questions
last_updated: YYYY-MM-DD
---

# Limitations & Open Questions

> Confidence legend: 🧪 self-verified · ✅ verified · 🟡 community-claim · 🔴 unverified · ❌ disproven

Known limits that span domains, and the biggest unknowns we want to resolve.

## Known limitations

- _(populated by research)_

## Top open questions

- _(populated by research)_
```

- [ ] **Step 5: Verify and commit**

```bash
ls -R knowledge
git add knowledge
git commit -m "feat: knowledge base index, template, and domain dirs"
```
Expected: `knowledge/INDEX.md`, `_TEMPLATE.md`, `limitations.md`, and 5 domain dirs with `.gitkeep` present.

---

## Task 2: Project & idea tracking

**Files:**
- Create: `projects/INDEX.md`
- Create: `projects/_TEMPLATE/spec.md`, `projects/_TEMPLATE/plan.md`, `projects/_TEMPLATE/status.md`, `projects/_TEMPLATE/notes.md`, `projects/_TEMPLATE/log.md`
- Create: `ideas/backlog.md`

- [ ] **Step 1: Write `projects/INDEX.md`**

```markdown
# Projects

Status board for everything we're building. Each active project has a folder
(`<slug>/`) cloned from `_TEMPLATE/`.

| Project | Slug | Status | Started | Last update |
|---------|------|--------|---------|-------------|
| _(none yet)_ | | | | |

Status key: 💡 idea · 🟦 planned · 🟨 in progress · ✅ done · 🟥 blocked · ⬛ abandoned

## Starting a project

1. Copy `_TEMPLATE/` to `<slug>/`.
2. Fill `spec.md` (or link to a `docs/superpowers/specs/` spec).
3. Add a row above and append to `../PROGRESS.md`.
```

- [ ] **Step 2: Write the five `projects/_TEMPLATE/` files**

```bash
mkdir -p projects/_TEMPLATE
```

`projects/_TEMPLATE/spec.md`:
```markdown
# <Project> — Spec

**Status:** 💡 idea
**Goal:** <one sentence>

## Problem / motivation
## Requirements
## Out of scope
## Open questions
```

`projects/_TEMPLATE/plan.md`:
```markdown
# <Project> — Plan

Link to the full implementation plan in `docs/superpowers/plans/` if large,
or list bite-sized tasks here.

- [ ] Task 1
```

`projects/_TEMPLATE/status.md`:
```markdown
# <Project> — Status

**Current state:** 🟦 planned
**Next action:** <what to do next session>
**Blockers:** none
```

`projects/_TEMPLATE/notes.md`:
```markdown
# <Project> — Notes

Working notes, decisions, dead ends. Confidence-tag any hardware/protocol claims
(🧪/✅/🟡/🔴/❌) so they can graduate into `knowledge/`.
```

`projects/_TEMPLATE/log.md`:
```markdown
# <Project> — Log

- YYYY-MM-DD: created.
```

- [ ] **Step 3: Write `ideas/backlog.md`**

```bash
mkdir -p ideas
```
```markdown
# Idea Backlog

Running list of ideas for the glasses/ring. An idea graduates into a
`projects/<slug>/` folder when we decide to act on it.

| Idea | Domain | Effort (guess) | Excitement | Notes |
|------|--------|----------------|------------|-------|
| _(add ideas here)_ | | | | |

## Parking lot

Half-formed thoughts that aren't ready to be rows yet.
```

- [ ] **Step 4: Verify and commit**

```bash
ls -R projects ideas
git add projects ideas
git commit -m "feat: project status board, project templates, idea backlog"
```
Expected: `projects/INDEX.md`, 5 template files, `ideas/backlog.md` present.

---

## Task 3: Research audit-trail format

**Files:**
- Create: `research/README.md`

- [ ] **Step 1: Create `research/` and write `research/README.md`**

```bash
mkdir -p research
```
```markdown
# Research (raw, append-only audit trail)

Every research sweep gets its own dated folder. Nothing here is edited after the
fact — this is the source-of-truth audit trail. Trustworthy facts get **distilled**
from here into `../knowledge/` (a deliberate review step, not automatic).

## Folder format

```
research/YYYY-MM-DD-<topic-slug>/
├── findings.md     # raw findings, grouped by sub-topic, each linked to a source id
└── sources.md      # numbered source list (s1, s2, ...) with URL + access date + type
```

## `sources.md` format

```markdown
# Sources — <topic> (YYYY-MM-DD)

- **s1** — <title>. <url> · accessed YYYY-MM-DD · type: first-party | repo | reddit | discord | article | video
- **s2** — ...
```

## `findings.md` format

Tag each finding with the confidence it deserves *from the source alone*
(🟡 single source, ✅ corroborated, 🔴 rumor) and cite the source id:

```markdown
- 🟡 <finding>. _[s1]_
- ✅ <finding>. _[s2][s5]_
```
```

- [ ] **Step 2: Verify and commit**

```bash
cat research/README.md
git add research
git commit -m "docs: define raw research audit-trail format"
```
Expected: `research/README.md` present and readable.

---

## Task 4: PROGRESS.md and CLAUDE.md

**Files:**
- Create: `PROGRESS.md`
- Create: `CLAUDE.md`

- [ ] **Step 1: Write `PROGRESS.md`**

```markdown
# Progress Log

Overarching, dated changelog for the whole workspace: what we learned, what we
built, what we decided. Newest entries on top.

## 2026-05-30

- Set up the workspace: knowledge base structure, project/idea tracking, research
  audit-trail format, CLAUDE.md context, and the auto-capture Stop hook.
- Approved design spec: `docs/superpowers/specs/2026-05-30-even-realities-knowledge-base-design.md`.
- Next: run the Phase 1 research sweep (priorities: terminal mode → SDK/app-dev → BLE/firmware).
```

- [ ] **Step 2: Write `CLAUDE.md`**

```markdown
# CLAUDE.md — Even Realities Workspace

Knowledge base + workspace for the **Even Realities G2 smart glasses** and **R1 ring**:
research, documentation, app/SDK development, and improving terminal mode.

## On session start

1. Read `PROGRESS.md` (top entries) for where we left off.
2. Check `.remember/` for the latest session handoff/context.
3. Skim `knowledge/INDEX.md` for current coverage and shaky claims.

## Research priorities (in order)

1. Terminal mode & usage  2. App / SDK development  3. BLE / firmware / protocol
4. Hardware & specs (secondary)  5. Ecosystem (secondary)

## Directory map

- `knowledge/` — curated, confidence-tagged reference. **Trust this.**
- `research/` — raw, append-only, fully-cited sweeps. The audit trail. Never edit past sweeps.
- `projects/` — one folder per project (`_TEMPLATE/` to start) + `INDEX.md` status board.
- `ideas/backlog.md` — idea list; graduates into `projects/`.
- `PROGRESS.md` — overarching dated changelog.
- `docs/superpowers/` — specs and plans.

## Confidence convention (apply to every claim in `knowledge/`)

🧪 self-verified (our own dev/testing) · ✅ verified (first-party / corroborated) ·
🟡 community-claim (single source) · 🔴 unverified/rumor · ❌ disproven (tested false; keep with a note).
**Promote** 🟡/🔴 → ✅/🧪 when proven; **kill** → ❌ when disproven. Note promotions/kills inline with a date.

## Auto-capture rules (do these as you work)

- When you learn something new, write it into the right `knowledge/<domain>/` doc using
  `knowledge/_TEMPLATE.md`, tagged + sourced. Update `knowledge/INDEX.md` coverage.
- Append a dated bullet to `PROGRESS.md` for anything learned, built, or decided.
- Keep `projects/INDEX.md` current when project state changes.
- Distill from `research/` → `knowledge/`; never let unverified noise into `knowledge/`.

A Stop hook will remind you once per session to flush findings before ending — but do it
as you go, not only at the end.

## Conventions

- Commits: small and frequent. Push to `origin main` (repo is public).
- New project specs/plans go in `docs/superpowers/specs|plans/`.
```

- [ ] **Step 3: Verify and commit**

```bash
git add PROGRESS.md CLAUDE.md
git commit -m "docs: add PROGRESS log and CLAUDE.md context/conventions"
```
Expected: both files committed.

---

## Task 5: Auto-capture Stop hook

**Files:**
- Create: `.claude/hooks/capture-reminder.sh`
- Create: `.claude/settings.json`

The hook fires when the assistant tries to stop. On the **first** stop of a session it
blocks once with a reminder to flush findings; a per-session marker file prevents a loop,
so the second stop attempt is allowed.

- [ ] **Step 1: Write `.claude/hooks/capture-reminder.sh`**

```bash
mkdir -p .claude/hooks
```
```bash
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
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x .claude/hooks/capture-reminder.sh
```

- [ ] **Step 3: Write `.claude/settings.json`**

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/capture-reminder.sh"
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 4: Test the hook fires a block on first call**

Run:
```bash
echo '{"session_id":"test123","stop_hook_active":false}' | .claude/hooks/capture-reminder.sh
```
Expected: prints the JSON with `"decision":"block"`, and creates `.remember/tmp/capture-reminded-test123`.

- [ ] **Step 5: Test the hook stays silent on the second call (no loop)**

Run:
```bash
echo '{"session_id":"test123","stop_hook_active":false}' | .claude/hooks/capture-reminder.sh; echo "exit=$?"
```
Expected: no output, `exit=0` (marker already exists).

- [ ] **Step 6: Clean up the test marker**

```bash
rm -f .remember/tmp/capture-reminded-test123
```

- [ ] **Step 7: Verify `jq` is available (hook dependency)**

Run: `command -v jq`
Expected: a path prints. If empty, the hook degrades safely (jq failure under `set -e`
exits non-zero → Claude Code ignores the hook output and allows stop), but install with
`brew install jq` for the reminder to work.

- [ ] **Step 8: Commit**

```bash
git add .claude/hooks/capture-reminder.sh .claude/settings.json
git commit -m "feat: Stop hook reminding to capture findings once per session"
```

---

## Task 6: Push everything

- [ ] **Step 1: Push to GitHub**

```bash
git push origin main
git log --oneline -8
```
Expected: push succeeds; log shows the scaffold commits on `origin/main`.

- [ ] **Step 2: Confirm the working tree is clean**

Run: `git status`
Expected: "nothing to commit, working tree clean" (the `.claude/settings.local.json` and
`.remember/` runtime are gitignored).

---

## Self-Review

**Spec coverage:**
- Directory structure → Tasks 1–4 ✅
- Raw `research/` vs curated `knowledge/` split → Task 1 + Task 3 (README states the rule) ✅
- 5-level confidence scheme + promote/kill lifecycle → Task 1 template/INDEX + Task 4 CLAUDE.md ✅
- Auto-capture: CLAUDE.md rules → Task 4; Stop hook → Task 5; `.remember/` integration → CLAUDE.md "On session start" ✅
- Idea/project/progress tracking → Task 2 + Task 4 (PROGRESS) ✅
- Research priorities recorded → CLAUDE.md + INDEX ✅
- Phase 1 sweep handoff → recorded as "next" in PROGRESS; the sweep itself is out of scope for this plan ✅

**Placeholder scan:** Template files intentionally contain `<placeholder>` tokens — these are
*content templates for future use*, not plan gaps. All plan steps have concrete commands/content.

**Type/name consistency:** Domain slugs (`hardware`, `firmware-ble`, `sdk-app-dev`,
`terminal-mode`, `ecosystem`) are identical across the directory creation, INDEX table,
CLAUDE.md map, and template front-matter. Confidence emoji set is identical across README,
INDEX, CLAUDE.md, template, and the hook reminder text.
