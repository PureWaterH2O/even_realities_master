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
