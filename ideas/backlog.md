# Idea Backlog

Running list of ideas for the glasses/ring. An idea graduates into a
`projects/<slug>/` folder when we decide to act on it.

> Seeded 2026-05-30 from the initial research survey. Effort is a rough guess; excitement is ours to fill in.

| Idea | Domain | Effort (guess) | Excitement | Notes |
|------|--------|----------------|------------|-------|
| Patch/fork `even-terminal` to make the Claude model configurable + bump off `claude-opus-4-6` to 4.8 | terminal-mode | S–M | TBD | Hard-coded in dist/claude/session.js:241, no override. High-value, well-scoped; could be a real upstream contribution. ([[overview]] terminal-mode) |
| Harden the `even-terminal` bridge: bind to localhost / add TLS / keep token out of URL+logs | terminal-mode | M | TBD | Default `0.0.0.0` + plaintext `?token=` + no TLS. Security-meaningful. |
| Build our own Even Hub app to learn the SDK (e.g. a focused dashboard/notifier) | sdk-app-dev | M | TBD | Validates the WebView/container model firsthand; first 🧪 self-verified facts. |
| Verify the open hardware/SDK questions firsthand on our G2+R1 | hardware / sdk-app-dev | S each | TBD | Authoritative image max, real BLE throughput, setLocalStorage quota, dual-peripheral L/R capture. Promotes 🟡→🧪. |
| Write a tiny BLE client against the G2 protocol (teleprompter/conversate) to validate the RE | firmware-ble | M–L | TBD | Confirms i-soxi/kalani service IDs on our firmware; brick-risk only for OTA paths (avoid). |
| Independent confirmation of the G2 SoC once FCC photos unlock (2026-07-20) or via teardown | hardware | S (watch) / L (teardown) | TBD | Resolve Apollo510 vs 510B + EM9305. Could be just monitoring fccid.io. |
| Capture an annotated dual-connection BLE sniff to resolve L/R pairing + PAwR | firmware-ble | M | TBD | Answers a foundational architecture open question no source has. |

## Glasses + Obsidian Vault Integration (explored 2026-06-03)

**Vision:** The glasses become a capture device and light viewer for the user's Obsidian
"second brain" vault (see `~/Documents/random_claude_stuff/obsidian_how_to/Project Brief.md`
for the full vault system). Two use cases: (1) hands-free voice capture of thoughts/todos/ideas
into the daily note while on the go or mid-coding-session, (2) reading vault state on the HUD
(today's todos, stale ideas, daily timeline).

**Key architectural decisions from the discussion:**
- Hybrid app (Terminal Mode + SDK app switching) is ruled out — glasses can't easily switch modes.
- Capture must work from ANY active session (not just a dedicated vault session) to avoid friction.
- Viewing is secondary — user is usually at the desk for browsing. HUD viewing is Claude-mediated
  text in Terminal Mode (no custom renderer unless we go full SDK app).
- Consistent formatting for views: tune the vault session's system prompt hard rather than building
  a custom renderer. Revisit only if this hits a ceiling.
- One Claude with routing > two separate Claudes. The user wants to capture a stray thought
  mid-coding and return to work without switching sessions.

**Phased approach (each phase independently useful, nothing thrown away):**
1. **Capture slash commands** — `/thought`, `/todo`, `/idea` work from any Co-Live session.
   Write to today's daily note with timestamp + tag in the vault's format. Minimal — just new
   slash commands + file writes. **← Start here. Being built in the Obsidian project first as
   Claude Code skills, then wired into Co-Live as slash commands.**
2. **"Vault" session** — a persistent session whose Claude is loaded with the vault's house rules.
   Tap into it to ask "what are my todos" or "tidy today." Text-only but prompt-tuned for
   consistent output.
3. **Routing layer** — one Claude handles both coding and vault. Context-aware: `/thought` captures,
   "what's on my plate" reads the vault, "explore that auth idea" starts a flesh-out. No session
   switching.
4. **Full SDK app (only if needed)** — custom renderer for persistent views (todo widget, daily
   summary always visible). Only build if phases 1–3 prove Terminal Mode's text-only HUD is
   insufficient.

**Dependency:** Phase 1 starts in the Obsidian project (skills/slash commands for capture +
tidy + resurface). Phases 2–4 live here in Co-Live Terminal, likely as a post-M3 milestone.

---

## Parking lot

Half-formed thoughts that aren't ready to be rows yet.

- A "better terminal" bridge that does full scrollable rendering like `claude-code-g2` but for our workflow (paginated transcript, not tail-only).
- Home Assistant / local-LLM HUD (community precedents exist: even-home-assistant, EvenHub-LocalLLM).
- Improve the terminal-mode reading experience (the project's stated long-term goal): smarter summarization of agent output into the ~50-char one-liner budget.
- A confidence-tagged, queryable knowledge export from `knowledge/` (dogfooding our own KB on the glasses?).
- **Cockpit liveness rung (M3.x, desk-side)** — deferred out of M3.1 (2026-06-02). Make the desk status line *feel alive* like native Claude's "Forging… 9s · ↓506 tokens": animated spinner, elapsed timer, and a live token counter that ticks during any busy state (tool runs, responding, thinking) — not just thinking. Cross-cutting status-line concern, not transcript rendering. Hooks already exist (we receive `status` + `running_stats` events and own the status line), so no rework needed — wants its own ~30-min design pass (tick rate? counters shown? desk-only vs glasses too?). Surfaced during M3.1 A6 UAT.
