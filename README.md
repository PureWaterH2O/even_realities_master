# even_realities_master

A knowledge base and working environment for the **Even Realities G2 smart glasses** and **R1 ring** —
research, documentation, app/SDK development, and improving the terminal-mode experience.

## What's here

| Path | Purpose |
|------|---------|
| `knowledge/` | Distilled, confidence-tagged reference (the "what we know"). |
| `research/` | Raw, dated, fully-cited research sweeps (the audit trail). |
| `projects/` | One folder per project, plus a status board (`INDEX.md`). |
| `ideas/` | Running idea backlog. |
| `PROGRESS.md` | Overarching dated changelog of what we've learned and done. |
| `docs/superpowers/specs/` | Design specs for the workspace and projects. |
| `CLAUDE.md` | Context + conventions auto-loaded by Claude Code each session. |

## Confidence convention

Every claim in `knowledge/` is tagged:

- 🧪 **self-verified** — proven firsthand through our own development/testing (highest trust)
- ✅ **verified** — first-party docs or multiple corroborating sources
- 🟡 **community-claim** — single third-party source
- 🔴 **unverified / rumor** — uncorroborated
- ❌ **disproven** — tested and false; kept in the record with a note so it's never re-investigated

Facts get **promoted** (🟡/🔴 → ✅/🧪) or **killed** (→ ❌) as our own work generates ground truth.

## Status

Setup phase. Design spec: `docs/superpowers/specs/2026-05-30-even-realities-knowledge-base-design.md`.
Next: scaffold the structure + Claude infrastructure, then run the Phase 1 research sweep.
