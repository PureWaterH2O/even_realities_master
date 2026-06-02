# Desk preview rig — see the TUI without hardware

Render the **real** desk `App` against scripted or recorded event streams, capture
the exact frames, and (optionally) screenshot them — so the desk can be iterated
on and reviewed before a hardware UAT.

## Tier 1 — text frames (no deps)

```bash
PREVIEW=1 npx vitest run test/preview      # dump frames to preview-out/*.txt + *.ansi
npx vitest run test/preview                # just the smoke assertions
```

- `replay.tsx` — a replay `HubClient` drives the real `App` via the injected-client
  seam; `capture()` plays a `Step[]` (emit / key / snap) and returns frames;
  `flattenAll()` renders the WHOLE transcript (no viewport clipping).
- `scenarios.ts` — curated event scenarios (`cockpit`, `inProgress`, `markdownDoc`,
  `tall`) that exercise every render path.

## Tier 2 — PNG screenshots (needs `brew install vhs`)

```bash
./scripts/screenshots.sh                   # regenerate frames, then one vhs run per frame
```

Renders each full-colour `preview-out/*.ansi` to `preview-out/shot-*.png`.

## Tier 3 — record & replay a real session

Catches Core data-shape bugs the hand-written fixtures can't (e.g. an empty tool
`input`). Record once on real hardware, then replay deterministically:

```bash
# 1. record a live session (desk side) — tees every event to a JSONL fixture
COLIVE_RECORD=test/../colive-terminal/preview-out/recording.jsonl npm run dev -- desk

# 2. replay it (renders + screenshots if scripts/screenshots.sh is run)
PREVIEW=1 npx vitest run test/preview       # picks up preview-out/recording.jsonl
COLIVE_REPLAY=/path/to/other.jsonl PREVIEW=1 npx vitest run test/preview
```

`recordingClient` (src/desk/record.ts) wraps the Hub client; recording is
best-effort (a sink throw never disturbs the live stream). `preview-out/` is
gitignored.
