# Progress Log

Overarching, dated changelog for the whole workspace: what we learned, what we
built, what we decided. Newest entries on top.

## 2026-05-30

### Phase 1 research sweep — COMPLETE & distilled

- Sweep `wf_302a9f4e-3e2` returned: **80 agents, ~2.9M tokens, 1,649 tool calls, ~38 min**, **207 unique sources, 142 findings** across 5 domains (terminal-mode 35, sdk-app-dev 37, firmware-ble 43, hardware 12, ecosystem 15) + 8 critic gaps filled.
- Raw audit trail written to `research/2026-05-30-initial-survey/` (`findings.md`, `sources.md`, `raw-result.json`).
- Distilled into curated, confidence-tagged docs: `knowledge/{terminal-mode,sdk-app-dev,firmware-ble,hardware,ecosystem}/` + updated `INDEX.md` and `limitations.md`.
- Seeded `ideas/backlog.md` with 7 build ideas (top: fork `even-terminal` to unpin/bump the Claude model; harden the bridge; build a first Hub app).
- **Headline learnings:** Terminal Mode is an official feature (app v2.2.0+) whose host bridge `@evenrealities/even-terminal` hard-codes `claude-opus-4-6`; G2 apps are web apps in the phone WebView (phone = BLE proxy), 576×288/4-bit canvas; BLE is fully community-RE'd (no vendor spec); the internal chip BOM is single-source/unconfirmed (Apollo510-class + EM9305, SKU unresolved).
- **Next:** pick a first project from `ideas/backlog.md` (likely the `even-terminal` model-unpin or a first Hub app) and/or start promoting 🟡 facts to 🧪 by testing on our own G2+R1.

### Setup

- Set up the workspace: knowledge base structure, project/idea tracking, research
  audit-trail format, CLAUDE.md context, and the auto-capture Stop hook.
- Approved design spec: `docs/superpowers/specs/2026-05-30-even-realities-knowledge-base-design.md`.
- Seed sources captured: evenrealities hub docs, GitHub repos nickustinov/even-g2-notes,
  fabioglimb/even-toolkit, even-realities org, i-soxi/even-g2-protocol.
- **Launched** the Phase 1 multi-agent research sweep (ultracode workflow, run `wf_302a9f4e-3e2`):
  scout → per-domain deep-dive → adversarial verify → synthesize → critic → gap-fill.
  Running in background; results pending.
- Next (when sweep returns): write `research/2026-05-30-initial-survey/{findings,sources}.md`,
  distill into `knowledge/<domain>/`, update INDEX/limitations, seed `ideas/backlog.md`.
