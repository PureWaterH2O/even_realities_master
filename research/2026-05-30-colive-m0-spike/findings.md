# Co-Live Terminal — M0 De-Risking Spike, Findings

> Executes `docs/superpowers/plans/2026-05-30-colive-terminal-m0-spike.md`. Confidence-tagged; dated 2026-05-30.
> Legend: 🧪 self-verified · ✅ verified · 🟡 community-claim · 🔴 unverified · ❌ disproven

## Task 1 — Source availability & fork strategy

**Evidence (🧪, 2026-05-30):**
- `npm view @evenrealities/even-terminal repository bugs author homepage license keywords` → **all empty**; only `version: 0.7.9` resolves. The published `package.json` (shipped locally) contains **only `name`** — **no `license`, `repository`, `homepage`, `author`, or `bugs`.**
- No public repo at `evenrealities/even-terminal` **or** `even-realities/even-terminal` (both 404 via `gh`). Global `gh search repos even-terminal` returns only unrelated projects — **no mirror/fork exists.**
- Shipped `dist/` is clean compiled ESM (readable), **25 JS files**, `claude/session.js` = 687 lines, **no sourcemaps**, **no LICENSE** in the package.

**Conclusion:** `even-terminal` is **closed-source, compiled-only, with NO declared license.** No license ⇒ "all rights reserved" by default — redistributing/publishing a fork of their `dist` is legally murky, and **our repo is public.**

**Decision → fork strategy (c): reimplement our own thin Session Core/Hub.**
- Build a fresh, minimal **protocol-compatible** server in our own TypeScript on the public, licensed `@anthropic-ai/claude-agent-sdk` + Express — **interoperating** with the Even app's observed HTTP/SSE contract (an interface, which we reverse-engineered and documented), **not copying their source.**
- Rationale: avoids the licensing problem entirely; gives us **full ownership** of the Core (the natural home for model-config, permission-config, hook-leak handling, multi-client fan-out, full-history endpoint); depends only on public packages.
- **M1 implication:** M1 is a *clean build to spec*, not a patch of their dist. Slightly more work than patching, but owned and legally sound. Our reverse-engineered protocol (in `knowledge/terminal-mode/overview.md` + `research/2026-05-30-terminal-mode-live-probe/findings.md`) is the implementation target.
