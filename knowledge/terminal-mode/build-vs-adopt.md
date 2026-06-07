# Co-Live Terminal — build-vs-adopt landscape (sanity check)

> Confidence: 🧪 for our-own-code seams (cited file:line); 🟡 for external-project claims
> (single 2026-06-07 web-research sweep, agent-gathered — verify stars/license/status before acting).
> Source: 11-agent build-vs-adopt workflow, 2026-06-07. Owner question: "we're just passing Claude
> through and recreating its TUI — is there an OSS alternative we could wire the bridge into instead?"

## Verdict (one line)

**No off-the-shelf foundation replaces the stack** (headless Claude + single-writer co-live +
structured events + ring-routed approvals + Even wire protocol — nothing does all of it). **But the
M3.5 pixel-parity chase is genuine reinvention** and is the one safe thing to descope. The available
pivot is a **scope cut, not an architecture swap.**

## The reframe — which layers are/aren't reinvention 🧪

| Layer | LOC | What it really is | Reinvention? |
|---|---|---|---|
| Core | 2,186 | Official `@anthropic-ai/claude-agent-sdk` + **bespoke normalizer** (raw SDKMessage → 14-event `CoLiveEvent` union), single-writer FIFO, permission broker, id-reconciliation. ~80% original — but NOT TUI cloning. | No. Nothing speaks our event vocab. |
| Hub | 698 | The **Even-protocol shim** (QR `?token=&defaultProvider=claude`, `/api/events` SSE, `/api/permission-response`). | No — unavoidable (see below). |
| Desk TUI | 2,983 | Pure Hub SSE client. **~1,150 LOC (~39%) repaints native Claude** (banner, `●`, `›`, status line, "Worked for Ns"). Genuine co-live logic ≈250–400 LOC. | **YES — the real target.** |
| Remote | 205 | Tailscale. | No. |

Owner's intuition is **half right**: the *desk parity* is recreation; the *Core* is the thing that
makes co-live possible and can't be adopted away.

## Migration seams (clean cut-points) 🧪

- **SEAM 1** — the `CoLiveEvent` union (`src/core/events.ts`, 14 variants). The rendering contract BOTH
  desk + glasses speak. A replacement renderer consuming these 14 frames slots in with zero Core/Hub change.
- **SEAM 3** — `ManagerFacade`(7 methods: prompt/respondPermission/respondQuestion/interrupt/control/
  getStatus/subscribe) + `StoreFacade`(listSessions/getTranscript) at `routes.ts:50-69`. The engine-swap point.
- **SEAM 6** — the desk render pipeline (`src/desk/render/*` + `app.tsx` chrome) consumes only SEAM 1.
  **Highest-leverage cut for the owner's question**: delete `render/*` + reproduction JSX, keep `client.ts`
  + the event contract. Verified safe — `src/desk` has **zero `@anthropic` imports**.
- **SEAM 7** — the Even protocol shim (`src/hub/*`). Fixed/custom; depends only on the two facades.

## Why nothing off-the-shelf fits 🟡

**The inversion ("desk = real Claude Code, glasses mirror off it, delete the custom desk") is BLOCKED at
three walls:**
1. **No prompt-injection API** into a running *interactive* `claude` (open: anthropics/claude-code
   #24947/#27441/#53049, as of 2026-06) → glasses degrade to approve-and-observe only.
2. **`.jsonl` is too lossy** — no `permission_request`, no streaming deltas, no status (prompts live in
   the CLI process, never on disk) → can't drive the ring or live HUD.
3. **SDK-resume against the live id = two-writers collision** on one transcript — the exact failure the
   single-writer Core prevents.
   Even **Anthropic's own Remote Control** (shipped 2026-02-25) routes only to Anthropic clients over a
   closed relay — no third-party local hook.

**Engine-behind-Hub candidates:**
- **AgentAPI (coder/agentapi, MIT)** — screen-*scrapes* the real Claude TUI; **no structured permission
  interception** (you'd pattern-match scraped text + inject keystrokes). M3.5 fragility inverted → downgrade.
- **OpenCode / Crush / Goose / Codex** — real client/server + multi-client-one-session (the co-live
  capability our deferred M3.3c lacks — worth studying!), but each isn't-Claude (breaks `defaultProvider=claude`),
  adds a 2nd runtime (Go/Rust), and binds to its own schema → translation layer as big as the Core.
- **Official Agent SDK is the strong-fit engine — we're already on it.** Nothing above it to adopt.

**Closest prior art — Happy (slopus/happy, MIT, ~21.7k★):** architectural twin (SDK wrap + `canUseTool`
state machine + near-identical event vocab) BUT E2E-encrypted over its own socket.io relay → Hub would have
to *become a Happy client* + add a cloud hop. **Harvest, don't host** — lift its MIT permission-handler /
SDK-wrap patterns to harden our Core. (Omnara: archived 2026-01-19; authors quit the CLI-wrapper approach
as "unfeasible to maintain with Claude Code's constant updates" — a cautionary tale for our SDK coupling.)

## Two strategic flags (VERIFY — past knowledge cutoff) 🔴

- **`sam-siavoshian/claude-code-g2` (MIT)** — near-identical independent "Claude Code from G2" project
  (headless `claude` stream-json → SSE → HUD). **Validates our architecture**; contrast: it punts with
  `--dangerously-skip-permissions` + ships its own WebView plugin. We solved the harder version.
- **Even official dev platform (~April 2026): `@evenrealities/even_hub_sdk` + official Terminal Mode +
  Claude Code integration** (PermissionRequests via HTTP hooks to "Even Hub"). Plugin/WebView path — NOT
  the stock-app terminal-mode wire protocol → **confirms the Hub shim stays custom**, but watch it: if Even
  ships an official multi-client terminal protocol, parts of the Hub could someday retire.

## Recommendation

**Keep Core / Hub / Remote custom.** The pivot is the desk:
- **Option A (effort ≈0):** freeze the desk as a deliberately-reduced glasses-companion view; retire the
  M3.5 parity goal + the D-001..D-034 catalog. (Honest caveat: "use native `claude` for full fidelity"
  means a *separate* session — native CC can't co-attach to the shared one.)
- **Option B (medium, isolated):** only if Ink perf is the real pain — swap the render substrate to
  OpenTUI (`@opentui/react`, MIT) behind the unchanged 14-event contract (SEAM 6). Touches zero Core/Hub.
- **Do NOT:** adopt OpenCode/Crush as the desk (re-introduces parity chase as their UI + runtime switch),
  or pursue the inversion (blocked; would delete the Core we need).

Related: [[overview.md]] · [[limitations.md]] · [[streaming-input-probe.md]] · [[desk-rendering.md]]
