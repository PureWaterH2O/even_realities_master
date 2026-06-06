# Co-Live Terminal — M3.5 "Aesthetic Pass" design

> **Status:** DRAFT — pending user review.
> **Branch:** TBD (will branch from `main` after M3.3b merges).
> **Relates to:** M3.0 roadmap `2026-06-01-colive-terminal-m3-design.md` (M3.5 = "Aesthetic pass — theming / polish gate").
> **Prerequisite:** M3.3b merged; M3.3c and M3.4 may land before or after this work — the aesthetic pass targets the desk rendering layer, which is independent of Core/Hub feature work.

## 0. Definition of done

Per M3.0 §0 (non-negotiable): green tests are the precondition, not done. This rung is **done** when:

1. The difference catalog is fully cleared (every entry checked off).
2. The replay harness confirms parity across all scenarios.
3. The user has exercised all 25 scenarios on real hardware and signed off.
4. The customization brainstorm has been completed as a separate session.

## 1. Goal

Make the desk client **visually indistinguishable at a glance** from native Claude Code running in the same VS Code integrated terminal. Same layout, same visual weight, same colors. A person glancing at both should not immediately tell which is which. Small details (exact token-count format, session ID display) may differ.

After parity is achieved, a separate customization brainstorm session will introduce a unique visual identity. This spec covers parity only.

## 2. Scope

**Three layers — all in scope:**

| Layer | What it covers |
|---|---|
| **Visual rendering** | Colors, spacing, borders, text styling (bold/dim/italic), status-line format |
| **Layout & structure** | Where elements sit on screen (prompt position, status-line content, how tool output is framed) |
| **Behavioral** | How things animate/transition (streaming text appearance, spinner during thinking, how diffs expand, scroll behavior) |

**Out of scope (this rung):**
- Custom theming / branding (separate brainstorm after parity).
- Glasses-side rendering changes (M3 = desk only, per M3.0 §2).
- New features — this is purely making existing features look and behave like native.

## 3. Fidelity target

**"Indistinguishable at a glance."** Not pixel-accurate, not ANSI-byte-identical. The bar is: same elements in the same places, same color palette, same visual weight. Muscle memory from native Claude Code should transfer to the desk without friction.

## 4. Comparison system — Reference Frame Catalog + Replay Harness

### 4.1 Approach

Two-sided comparison:

- **Reference frames (native Claude):** The user runs native Claude Code in VS Code's integrated terminal through a set of scripted scenarios, screenshotting each state. These are captured once and serve as the target.
- **Replay frames (our desk):** The existing `test/preview/` replay harness (`ReplayClient` + `capture()`) drives the desk App through matching event sequences and captures ANSI + plain-text frames. This is automated and repeatable.

Differences are cataloged by comparing each reference/replay pair. After each fix, the replay is re-run to confirm convergence — the harness doubles as the regression guard.

### 4.2 Scenario set

Each scenario becomes a reference/replay pair. The list below is the starting set; additional scenarios discovered during the native Claude `/help` survey are added as they're found.

| # | Scenario | What it captures |
|---|----------|-----------------|
| 1 | Idle / startup | Banner, prompt character, status line, empty state |
| 2 | Simple Q&A | User prompt bar styling, assistant text prefix/bullet, basic response |
| 3 | Streaming response | Cursor/caret during generation, partial text rendering |
| 4 | Thinking block | Collapsed thinking indicator, expand (Ctrl-O) |
| 5 | Tool call — Read | Tool header format, args display, completion indicator |
| 6 | Tool call — Bash | Command display, output rendering, timing badge |
| 7 | Tool call — Edit/Write | Inline diff rendering (green/red lines, gutters) |
| 8 | Multi-tool turn | Multiple sequential tools in one response |
| 9 | Permission prompt | Inline allow/deny UI, option rendering |
| 10 | Todos panel | Task list rendering (checked/unchecked/in-progress) |
| 11 | Markdown response | Headers, bold, code blocks, lists, links |
| 12 | Long scrollback | Viewport with scroll indicators, PgUp/PgDn behavior |
| 13 | Error / diagnostic | Error banner styling |
| 14 | Status line states | Idle, thinking, tool-running, token counts |
| 15 | Slash menu | `/` command picker appearance |
| 16 | Question prompt | When Claude asks the user a question (text input + multiple choice) |
| 17 | Background command | Bash running in background, status indicator, completion notification |
| 18 | Subagent / Agent tool | Agent spawning indicator, nested output |
| 19 | Interrupt (Esc) | Mid-response interrupt — how the truncation/stop is displayed |
| 20 | Cost summary | End-of-turn cost/token display |
| 21 | `/effort` picker | Effort level selection menu styling |
| 22 | `/usage` display | Usage statistics panel formatting |
| 23 | `/model` picker | Model selection menu |
| 24 | `/config` display | Configuration view layout |
| 25 | `/memory` display | Memory entries rendering |

### 4.3 Reference capture process

**Setup:** VS Code with two terminal panes side by side — native Claude on the left, a shell on the right for the `snap` command.

**The `snap.sh` helper:**

```bash
# Usage from the right pane:
./snap.sh 01-idle
```

Behavior:
- Accepts a scenario name (validated against the known list — rejects typos).
- Runs `screencapture -i <reference-dir>/<name>.png` (macOS crosshair area-select).
- Prints the scenario checklist showing done vs remaining.

**Per-scenario flow (~3 seconds each):**
1. Read the instruction from `scenarios.md` (what to type, what state to wait for).
2. Set up the state in native Claude (type the prompt, wait for the response).
3. In the right pane, run `./snap.sh <name>`.
4. Crosshair appears — drag-select the native Claude terminal area.
5. Screenshot saved to `reference/<name>.png`. Move to the next scenario.

**`scenarios.md`** is a copy-paste runbook — for each scenario it provides:
- The exact text to type in native Claude.
- What state to wait for before snapping (e.g., "wait for the response to finish streaming").
- The `snap.sh` command to run.

### 4.4 Replay capture process

**Existing infrastructure** (no new tooling needed for basic capture):

```bash
cd colive-terminal
PREVIEW=1 npx vitest run test/preview
# Dumps frames to preview-out/
```

**Extension needed:** new scenario event sequences in `test/preview/scenarios.ts` matching the 25 reference scenarios. Each scenario is a sequence of `CoLiveEvent` objects that drive the desk into the matching visual state.

The replay produces `.ansi` files (viewable via `cat` in a terminal — preserves colors) and `.txt` files (plain text for structural comparison).

## 5. Difference catalog

### 5.1 Format

Each difference is a numbered entry:

```markdown
### D-014: User prompt bar — missing inverted background
- **Category:** visual | layout | behavioral
- **Severity:** major | medium | minor
- **Element:** user prompt block
- **Native:** `❯ Say hello` rendered as white text on a full-width dark gray bar
- **Ours:** `you  Say hello` rendered as colored label + plain text, no background bar
- **Fix scope:** `rows.ts` — user block rendering
- **Status:** ☐ pending
```

### 5.2 Organization

- Entries numbered sequentially (`D-001` through `D-???`).
- Grouped by **element** (status line, tool headers, prompt bar, etc.).
- Sorted by **severity** within each group (major → medium → minor).
- Each entry is a checkbox — checked off when the fix lands and the replay confirms the match.

### 5.3 Severity definitions

| Severity | Definition | Example |
|---|---|---|
| **Major** | Structurally different — wrong element, wrong position, missing entirely | No startup banner; user prompt has no background bar |
| **Medium** | Noticeably different on casual inspection — wrong color, wrong prefix, different spacing | `>` instead of `❯`; tool timing shows differently |
| **Minor** | Subtle — slightly different shade, minor spacing, would only notice side-by-side | Exact dim-text opacity; padding between elements |

## 6. Implementation strategy

### 6.1 Grouping by element

Differences that touch the same rendering code are fixed together as a group. Anticipated groups:

| Group | Likely files | Example differences |
|---|---|---|
| Banner / chrome | `app.tsx` | Startup banner, prompt character (`❯` vs `>`), overall frame |
| Prompt bar | `rows.ts` | Inverted background bar, no "you" label, `❯` prefix |
| Tool headers | `rows.ts` | `✱ Verb for Ns` compact format, collapsible `❯` bars, timing badge |
| Status line | `app.tsx` | Format, content (ctx%, usage%), position |
| Assistant text | `rows.ts` | `●` bullet prefix, text styling |
| Thinking | `rows.ts` | Collapsed indicator style, Ctrl-O expand appearance |
| Diffs | `diff.ts` | Gutter style, colors, spacing |
| Permission / Question | `app.tsx` | Border style, option rendering, input styling |
| Markdown | `rows.ts` | Headers, code blocks, lists rendering |
| Menus / Pickers | `app.tsx` | Slash menu, model picker, effort picker appearance |
| Behavioral | Various | Streaming cursor, spinner animation, timing display |

### 6.2 Implementation order

Ordered by visual impact (biggest bang first) and dependency (chrome before content):

1. **Banner / chrome** — biggest visual impact, smallest code change.
2. **Prompt bar** — the most prominent per-turn element.
3. **Tool headers** — second most prominent; appears many times per session.
4. **Status line** — always visible, high attention area.
5. **Assistant text** — body of every response.
6. **Thinking / Todos / Markdown** — content formatting.
7. **Diffs** — specialized rendering.
8. **Permission / Question prompts** — interactive elements.
9. **Menus / Pickers** — modal overlays.
10. **Behavioral** — animations, transitions, timing (last because hardest to compare statically).

### 6.3 Fix loop (per group)

1. Implement the rendering changes for all differences in the group.
2. Re-run `PREVIEW=1 npx vitest run test/preview`.
3. Compare replay frames against reference screenshots.
4. Check off resolved catalog entries.
5. If a fix regresses another scenario, fix before moving on.
6. Commit the group.

### 6.4 Branch strategy

One branch (`colive-terminal-m3.5`), frequent commits (one per element group). All work rolls up into a single UAT session.

## 7. File structure

```
projects/colive-terminal/aesthetic/
├── snap.sh                         # macOS screencapture helper
├── scenarios.md                    # copy-paste runbook for reference capture
├── catalog.md                      # difference catalog (D-001..D-???)
├── reference/                      # native Claude screenshots (captured once)
│   ├── 01-idle.png
│   ├── 02-simple-qa.png
│   ├── ...
│   └── 25-memory-display.png
└── replay/                         # symlink → colive-terminal/preview-out/
```

Test infrastructure (in `colive-terminal/`):
```
test/preview/
├── replay.tsx                      # existing replay harness (unchanged)
├── capture.preview.test.tsx        # extended with 25 aesthetic scenarios
└── scenarios.ts                    # extended with matching event sequences
```

## 8. UAT

One large UAT session after the catalog is cleared. The user runs through all 25 scenarios on the real desk (VS Code terminal) comparing against native Claude, confirming "indistinguishable at a glance" for each. Hardware (glasses) included to verify no regressions in co-live rendering.

UAT runbook will be generated from `scenarios.md` with the same copy-paste format used in previous rungs.

## 9. Post-parity: customization

A separate brainstorm session after parity UAT is signed off. That session will explore what makes the desk visually unique — branding, color adjustments, layout innovations, personality. The rendering layer built during parity work provides the foundation to customize from.

## 10. Risks

- **Scenario coverage gaps.** The 25 scenarios may not cover every visual state. Mitigation: the native Claude `/help` survey during build discovers additional states; the catalog is append-only.
- **Ink rendering constraints.** Some native Claude visual effects may be difficult to reproduce in Ink (e.g., full-width background bars, exact cursor behavior). Mitigation: "at a glance" fidelity — if Ink can get 95% of the way there, that's sufficient.
- **Native Claude Code UI changes.** If Claude Code ships a visual update between our reference capture and implementation, references may be stale. Mitigation: reference recapture is fast (~5 minutes with `snap.sh`); fidelity target is "at a glance" not pixel-perfect, so minor native changes don't invalidate the work.
- **Behavioral differences are hard to capture statically.** Streaming, spinners, and animations don't show well in screenshots. Mitigation: behavioral group is last; we may need short screen recordings (VHS or QuickTime) for those comparisons rather than static frames.
