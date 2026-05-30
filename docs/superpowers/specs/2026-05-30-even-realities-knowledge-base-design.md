# Even Realities Knowledge Base & Workspace — Design

**Date:** 2026-05-30
**Status:** Approved (pending spec review)
**Owner:** nealthomas77@gmail.com

## Purpose

Stand up a durable knowledge base and working environment for everything related to
the **Even Realities G2 smart glasses** and **R1 ring**. The environment must:

1. Capture extensive research (first-party docs, third-party repos, Reddit, Discord, teardowns, etc.).
2. Keep a clean, trustworthy reference separate from raw research output.
3. Track ideas, projects, and progress over time.
4. **Automatically** capture new findings so knowledge compounds across sessions without manual bookkeeping.

This spec covers the **structure + infrastructure** only. The research content itself
is produced in a later phase (a multi-agent research sweep) and distilled into this structure.

## Scope & Priorities

Research and documentation priorities, in order:

1. **Terminal mode & usage** — capabilities, daily-use tips, limitations, how to improve the experience.
2. **App / SDK development** — official + third-party SDKs, APIs, what's buildable, dev tooling.
3. **BLE / firmware / protocol** — Bluetooth protocol, reverse-engineering efforts, firmware, phone↔glasses comms.
4. **Hardware & specs** (secondary) — display, chipset, sensors, battery, R1 ring internals, teardowns.
5. **Ecosystem** (secondary) — companion app, community repos, people, channels.

## Directory Structure

```
even_realities/
├── CLAUDE.md                      # auto-loaded every session: overview, conventions, pointers
├── README.md                      # human entry point
│
├── knowledge/                     # distilled, verified reference (the "what we know")
│   ├── INDEX.md                   # master map + confidence/coverage at a glance
│   ├── hardware/                  # G2 glasses + R1 ring: specs, sensors, battery, teardowns
│   ├── firmware-ble/              # BLE protocol, firmware, reverse-engineering findings
│   ├── sdk-app-dev/               # official + third-party SDKs, APIs, dev tooling
│   ├── terminal-mode/             # terminal mode usage, capabilities, tips, limitations
│   ├── ecosystem/                 # companion app, community repos, Reddit/Discord, people
│   └── limitations.md             # cross-cutting known limits & open questions
│
├── projects/                      # one folder per project (per-project structure)
│   ├── INDEX.md                   # status board: all projects + state
│   └── <project-slug>/            # spec.md, plan.md, status.md, notes.md, log.md
│
├── ideas/
│   └── backlog.md                 # running idea list; graduates into projects/
│
├── research/                      # RAW sweep outputs, dated, fully cited (the audit trail)
│   └── YYYY-MM-DD-<topic>/        # findings.md + sources.md per sweep
│
├── PROGRESS.md                    # overarching changelog: what changed/learned, when
│
└── .claude/
    └── settings.json              # hooks + permissions for auto-capture
```

### Design principle: raw vs. curated separation

- **`research/` is raw and append-only.** Every sweep is preserved verbatim with full source list.
  Nothing is ever lost; it is the audit trail.
- **`knowledge/` is curated and trustworthy.** Facts are distilled from `research/`, deduped,
  cross-checked, and confidence-tagged. This is what we rely on day to day.

Distillation (research → knowledge) is a deliberate review step, not automatic, so the
reference never fills with unverified noise.

## Sourcing & Confidence Convention

Online specs for these glasses are frequently wrong or conflicting, so every claim in
`knowledge/` carries a confidence tag and links to its source(s) in the relevant
`research/.../sources.md`.

### Confidence levels

| Tag | Meaning |
|-----|---------|
| 🧪 **self-verified** | We proved it firsthand through our own development/testing. Highest trust. |
| ✅ **verified** | First-party docs, or multiple corroborating external sources. |
| 🟡 **community-claim** | A single third-party source (repo, Reddit, Discord post). |
| 🔴 **unverified / rumor** | Uncorroborated; treat with caution. |
| ❌ **disproven** | We tested it and it is false. **Kept in the record** (not deleted) with a note explaining what we found, so it is never re-investigated. |

### Lifecycle of a claim

- A fact enters as 🔴 or 🟡 from research.
- It can be **promoted** to ✅ when corroborated, or to 🧪 when our own dev work proves it.
- It can be **killed** to ❌ when our own dev work disproves it (with a note + date).
- Promotions/demotions are noted inline so the claim's history is visible.

### INDEX coverage

`knowledge/INDEX.md` summarizes, per domain: what's covered, confidence distribution,
and known gaps/open questions — so we always know where the shaky claims and blind spots are.

## Auto-Capture Infrastructure

Three cooperating layers (the combo selected during brainstorming):

1. **CLAUDE.md rules** — loaded every session. Instructs the assistant to:
   - update the relevant `knowledge/` doc when something new is learned;
   - append a dated entry to `PROGRESS.md`;
   - keep `knowledge/INDEX.md` and `projects/INDEX.md` current;
   - apply the confidence convention;
   - check `.remember/` on start for where we left off.

2. **Stop hook** (`.claude/settings.json`) — fires when a session ends and reminds the
   assistant to flush new findings into `knowledge/`/`PROGRESS.md` and update indexes
   *before* stopping. This is the automatic safety net so nothing slips through.

3. **`.remember/` integration** — the existing cross-session memory system carries the
   "where we left off / what's next" thread between sessions. CLAUDE.md points to it on start.

## Idea / Project / Progress Tracking

- **`ideas/backlog.md`** — running list of ideas. An idea graduates into a `projects/<slug>/`
  folder when we decide to act on it.
- **`projects/<slug>/`** — per-project folder: `spec.md`, `plan.md`, `status.md`, `notes.md`, `log.md`.
- **`projects/INDEX.md`** — status board listing every project and its current state.
- **`PROGRESS.md`** — overarching, dated changelog spanning the whole directory: what we
  learned, what changed, what was decided.

## Phase 1 Research Sweep (how content arrives)

A multi-agent research workflow (high-parallelism fan-out + adversarial verification +
synthesis) writes to `research/YYYY-MM-DD-<topic>/` as raw findings + sources, prioritizing
terminal mode, SDK/app-dev, and BLE/firmware. Afterward we review together, distill the
trustworthy parts into `knowledge/`, seed `ideas/backlog.md` with newly-possible builds,
and stand up the first `projects/` folder if an obvious first build emerges.

Seed sources from the user will be folded in once provided.

## Out of Scope (for this spec)

- The actual research content (produced in Phase 1).
- Any specific app/firmware build (becomes its own `projects/` entry with its own spec).
- Hardware modification or anything requiring physical disassembly.

## Open Items

- Seed sources from the user (pending).
- Git: this directory is not currently a git repo; initialization is optional and will be
  confirmed before any commit.
