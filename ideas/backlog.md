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

## Parking lot

Half-formed thoughts that aren't ready to be rows yet.

- A "better terminal" bridge that does full scrollable rendering like `claude-code-g2` but for our workflow (paginated transcript, not tail-only).
- Home Assistant / local-LLM HUD (community precedents exist: even-home-assistant, EvenHub-LocalLLM).
- Improve the terminal-mode reading experience (the project's stated long-term goal): smarter summarization of agent output into the ~50-char one-liner budget.
- A confidence-tagged, queryable knowledge export from `knowledge/` (dogfooding our own KB on the glasses?).
