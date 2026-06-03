# Co-Live Terminal M3.2B — `@`-file autocomplete + `!`bash — Design

> **Parent:** the LOCKED M3.0 roadmap `2026-06-01-colive-terminal-m3-design.md` §7 row **M3.2 — Input & autocomplete**,
> which the user split into two rungs: **M3.2A = the editor core (DONE, merged `278f7c8`)** and **M3.2B (this doc) =
> `@`-file autocomplete + `!`bash**.
> **Governing rule:** M3.0 **§0 (definition of done)** applies in full — green tests + clean typecheck are the
> *precondition only*; **M3.2B is DONE only when the user exercises it on the real G2 + R1 and signs off.**
> **Confidence legend:** 🧪 self-verified (read our code) · ✅ verified (SDK/lib) · 🟡 community · 🔴 unverified.

## 0. Scope (one sentence)

Add two composer affordances — typing `@` opens a fuzzy file-path picker that inserts a repo-relative `@path` mention,
and a line beginning with `!` is treated as a shell command — **desk-side only, with zero Core/Hub change**, by making
both features *typing aids that produce clean text Claude acts on* (its Read tool / its Bash tool), so the desk itself
**never reads file contents and never executes a shell**.

## 1. The load-bearing philosophy (why this stays inside the invariant)

The desk is a thin Hub client with no model and no SDK. M3.1 and M3.2A both shipped with **zero Core/Hub change**, and
M3.2B keeps that. The way it does so: `@` and `!` do **not** do the real work locally — they delegate to Claude, which
is already running in Core with the project filesystem and a permission-gated toolset.

| Feature | What native Claude Code does | What M3.2B does | Who does the real work |
|---|---|---|---|
| `@file` | Injects file *contents* into context | Sends the `@path` **mention as text** | Claude's **Read** tool (in Core) |
| `!cmd` | Runs locally, output → context (no model turn) | Sends a **"run this" instruction** | Claude's **Bash** tool (in Core) |

The desk's *only* new filesystem touch is **enumerating filenames** for autocomplete (a directory listing — names, never
contents). That is the lightweight, read-only metadata read the `@` feature inherently needs; it is **not** reading file
bodies, and the desk still never executes a shell.

**Consequences locked with the user (2026-06-03):**
- `@file` = *mention + let Claude read* (NOT desk-injects-contents). 🧪
- `!cmd` = *delegate to Claude's Bash tool* (NOT desk-local execution). 🧪
- Listing root = the **desk's own cwd**, **zero Hub change** (NOT exposing `projectDir` on `/api/info`).
- File universe = **`git ls-files`** (gitignore-correct for free), fallback to a bounded `readdir` walk for non-git dirs.

## 2. `@file` — trigger, source, matching, accept

### 2.1 Trigger (mid-line, cursor-aware) 🧪
Unlike `/` (which owns the whole buffer — see §5), `@` can appear anywhere in a line:
`compare @src/desk/app.tsx with @src/hub/routes.ts`. The menu is open exactly when the **whitespace-delimited token
under the cursor begins with `@`**; it filters on the text after the `@`. A new **pure** helper `atContext(text, cursor)`
returns `{ query, start, end }` for that token (or `null`). This is a sibling to today's `filterSlash` — the popup
**widget** (render + highlight + ↑/↓ + Tab/Enter + Esc, owned by `app.tsx`) is **reused verbatim**.

### 2.2 File source (`git ls-files`, cached) ✅
A new `src/desk/input/files.ts` provides the candidate list:
- Primary: `git ls-files --cached --others --exclude-standard` run in the desk cwd → **repo-relative paths**, already
  `.gitignore`-correct (no `node_modules`, no `.git`), tracked **and** untracked-not-ignored.
- Fallback (not a git repo / git absent): a **bounded** recursive `readdir` walk (skip dotdirs + `node_modules`, cap at
  a sane file count) so the feature degrades instead of breaking.
- The command runner / fs are **dependency-injected** so the module is unit-tested without touching the real disk.
- The list is **cached once per session** on first `@` (the repo file set rarely changes mid-session); a manual refresh
  path is out of scope (§10). Rationale: avoids re-shelling on every keystroke.

### 2.3 Matching (fuzzy, in-memory) 🧪
A pure `fuzzyFilter(paths, query, limit)` ranks candidates by subsequence match (favoring contiguous + basename hits),
returns the top *limit* (e.g. 10). `@app` surfaces `src/desk/app.tsx`. Empty query (`@` alone) lists the first *limit*
paths. No match ⇒ menu closed (consistent with `filterSlash` returning `null`).

### 2.4 Accept (token replacement) 🧪
Tab/Enter replaces **only** the `@query` token (from `atContext`'s `start`..`end`) with the chosen repo-relative
`@path`, leaves the rest of the line intact, moves the cursor to just after the inserted path, and closes the menu.
This needs a buffer op `replaceRange(start, end, str)` on the immutable `EditBuffer` (add if absent). The user can then
keep typing or add another `@`.

### 2.5 Delivery (verbatim) 🧪
On submit, an `@`-bearing line is an **ordinary prompt** — `interpretInput` needs **no** `@` awareness; the `@path`
tokens are just text and are POSTed exactly as typed. Claude reads the mentioned file(s) with its Read tool. Repo-relative
paths from `git ls-files` resolve correctly because Claude's Read runs in Core's `projectDir` (= the desk cwd in the
co-located flow). See §6 for the reliability risk + fallback.

## 3. `!bash` — trigger, transform, delegation

### 3.1 Trigger (whole-line `!`) 🧪
Like `/`, the `!` owns the **whole line** — no menu, no autocomplete (native CC does not complete bash either). A submit
whose first non-whitespace char is `!` is a bash command; everything after the `!` is the command. **One command per
submit.**

### 3.2 Transform + delegation 🧪
`interpretInput` gains a `bash` result kind. A pure `formatBashPrompt(cmd)` turns `!npm test` into an explicit
instruction the raw SDK reliably acts on (the payload itself contains a fenced code block around the command):

````
Run this shell command and show me its output:
```
npm test
```
````

`app.tsx` POSTs that transformed text like any prompt. Claude runs it with its **Bash** tool, in Core's `projectDir`,
**gated by the M1 permission flow**, and it renders as a normal `Bash(...)` tool call in the M3.1 transcript — no new
rendering. An empty `!` (nothing after it) is a no-op (treated like empty input, mirroring the lone-`/` rule).

### 3.3 The honest divergence from native (accepted) 🟡
Native `!` is a *silent, deterministic peek*: it runs instantly, adds output to context, and spends **no** model turn.
Delegation makes `!cmd` a **model turn** — Claude may editorialize, and the permission prompt can feel redundant for a
harmless `!ls` you typed yourself. **Accepted tradeoff** for staying inside the invariant + reusing permissions and tool
rendering. **Fallback (future, NOT in M3.2B):** a desk-local "run + show locally, never sent to Claude" toggle, only if
the friction bites in real use (§10).

## 4. File / module map (decomposition)

| File | New? | Responsibility |
|---|---|---|
| `src/desk/input/files.ts` | **new** | `listProjectFiles(cwd, {exec, fs})` (git-first, walk-fallback, cached) + pure `fuzzyFilter(paths, query, limit)`. No ink. |
| `src/desk/input/menu.ts` | modify | add pure `atContext(text, cursor)`; keep `filterSlash` untouched. No ink. |
| `src/desk/input/buffer.ts` | modify | add `replaceRange(start, end, str)` to the immutable `EditBuffer` (if not already expressible). |
| `src/desk/slash.ts` | modify | add `{ kind: 'bash'; command: string; text: string }` to `InterpretedInput`; pure `formatBashPrompt(cmd)`; `!`-prefix branch in `interpretInput`. |
| `src/desk/app.tsx` | modify | wire `@` menu (open on `atContext`, source = cached files, fuzzy-filtered; reuse popup widget + nav; accept = `replaceRange`); dispatch the `bash` kind on submit. Functional `setState` only (A4 lesson). |

**Boundaries:** all of `files.ts`, `menu.ts`, `slash.ts`, `buffer.ts` stay **pure / DI'd and unit-tested**; `app.tsx`
remains the thin wiring layer. The popup render widget is reused, not duplicated.

## 5. Interaction with the existing menus (no conflict) 🧪
- `/` menu (`filterSlash`) opens only when the **whole buffer** is a single leading-`/` token with no whitespace. `@`
  menu opens only on a **mid-line `@` token under the cursor**. These conditions are mutually exclusive by construction,
  so the two popups never both want to be open.
- `!` opens **no** menu, so it never competes.
- `@`/`!` lines flow into composer history (M3.2A) like any other submit — no new history behavior.

## 6. Risks + mitigations

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R1 | **`@`-mention not auto-read.** Raw SDK Core has no CC harness to inject content, so reading the mention relies on Claude's *initiative*. | Med | Ship verbatim; **UAT checkpoint**. If flaky, add a faint desk-appended nudge (e.g. `(please read the @-mentioned files)`) — **only if UAT shows it's needed (YAGNI)**. |
| R2 | **Listing-root mismatch.** If `colive desk` is launched outside the project root, `@` suggests the wrong files and Claude can't find them. | Low | Same assumption per-project history already makes; **document "run `colive desk` from the project root."** Failure is self-evident (wrong suggestions immediately). Robustness option (expose `projectDir` on `/api/info`) deferred (§10). |
| R3 | **`git ls-files` perf / huge repos.** | Low | Cache once per session (§2.2); fuzzy filter is in-memory. |
| R4 | **Bash delegation friction** (model turn + redundant-feeling permission prompt). | Known | Accepted tradeoff (§3.3); desk-local toggle deferred (§10). |

## 7. Invariants (must hold) 🧪
- **Zero Core/Hub change** — verified by an empty `git diff main..branch -- src/core src/hub`.
- The desk **never reads file contents** and **never executes a shell** (only `git ls-files`/`readdir` for *names*).
- New input logic is **pure / DI'd and unit-tested**; `app.tsx` stays a thin wiring layer.
- State-dependent key handlers use **functional `setState`** (the A4 batching lesson).
- No test gaming (no deleted tests, no `.skip`/`.only`); typecheck clean.

## 8. Testing

**Unit (the bulk):**
- `files.ts`: `git ls-files` parsing (DI'd exec — multi-line, trailing newline, empty); fallback walk (DI'd fs — skips `node_modules`/dotdirs, respects cap); `fuzzyFilter` ranking (basename hit > scattered; empty query; no match → `[]`; limit honored).
- `menu.ts` `atContext`: `@` at line start, mid-line, multiple `@` (returns the one under the cursor), `@` inside a longer word, cursor before/after the token, no `@` → `null`, whitespace boundary ends the token.
- `buffer.ts` `replaceRange`: replaces the exact span, cursor lands after insertion, no off-by-one at line/`@`-token edges.
- `slash.ts`: `!cmd` → `bash` kind with correct `command` + `formatBashPrompt` text; `!` alone → empty no-op; leading whitespace before `!`; an `@`-bearing line → `prompt` kind unchanged (verbatim).

**Integration (`app.tsx`, ink-testing-library):** `@` opens the popup and filters; Tab inserts the path mid-line and closes; `↑/↓/Esc` behave; submitting a `bash` line POSTs the transformed instruction (assert against the DI'd HubClient); `@` and `/` never both open.

**Self-test before UAT:** render + screenshot the composer with the `@` popup open (preview harness) and iterate — per the "self-test the TUI before UAT" rule.

## 9. UAT (the real bar — hardware G2 + R1)

| # | Walk | Pass = |
|---|---|---|
| C1 | Type `@app`, Tab to pick `src/desk/app.tsx`, finish the line, submit | Path inserted mid-line; **Claude actually reads the file** and answers about it (R1 checkpoint) |
| C2 | One line with **two** `@` mentions | Both files read |
| C3 | `!git status` | Renders as a `Bash` tool call; **permission prompt fires**; output shown in transcript |
| C4 | `@` popup nav: `↑/↓` move, Tab/Enter insert, Esc closes; confirm `/` menu still works and they never collide | All nav correct; no menu conflict |
| C5 | `@` suggestions exclude `node_modules`/ignored files | Only tracked/untracked-not-ignored paths offered |
| C6 | A `!` command that needs approval (e.g. a write) vs a safe read | Permission flow correct both ways |

**Sign-off recorded in** `projects/colive-terminal/m3.2b-uat-runbook.md`.

## 10. Out of scope (later rungs)
- **Bash autocomplete** (completing command names/flags) — native CC doesn't either.
- **Desk-local `!` "silent peek" toggle** (run + show locally, never sent to Claude) — only if §3.3 friction bites.
- **`@` for non-files**: images, MCP resources, URLs.
- **Exposing `projectDir` on `/api/info`** (the robust listing-root option) — revisit only if R2 bites.
- **Mid-session file-list refresh / file watching** — cache-once is enough for M3.2B.
- `#`memory capture, streaming-input Core, `/model`, full slash set → **M3.3** / Obsidian milestone.
