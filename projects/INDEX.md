# Projects

Status board for everything we're building. Each active project has a folder
(`<slug>/`) cloned from `_TEMPLATE/`.

| Project | Slug | Status | Started | Last update |
|---------|------|--------|---------|-------------|
| Co-Live Terminal | `colive-terminal` | ✅ M1 + M2 + **M3.1 done (merged to `main`)**. M3 "Desk Cockpit" (native-parity daily driver) — **M3.0 ✅ LOCKED**; **M3.1 "Readable transcript" ✅ DONE 2026-06-02** (scrollback viewport, inline diff, syntax/markdown, Ctrl-O verbose, todos panel, desk-only thinking; 314 tests; hardware-signed-off A1–A6 + B1–B4). **M3.2A "Composer" ✅ DONE 2026-06-03 (merged to `main` `278f7c8`; planner-validated)** (multiline/cursor/word nav, per-project history, paste, mouse-wheel scroll, slash menu, `/select`·`/scroll` toggle; zero Core change; 391 tests, clean-tree verified; hardware-signed-off composer core). **Deferred to follow-on (user decision: merge as-is):** A4 post-paste one-line ↑/↓ stepping (fix corrected a real stale-closure bug but a hardware symptom persists; not mission-critical; `COLIVE_A4_LOG` logger wired), and A6 copy → a **dedicated copy/paste phase next** (OSC 52 `/copy`, terminal-agnostic + Tailscale-safe). A5 full slash set → M3.3. | 2026-05-30 | 2026-06-03 |

Status key: 💡 idea · 🟦 planned · 🟨 in progress · ✅ done · 🟥 blocked · ⬛ abandoned

## Starting a project

1. Copy `_TEMPLATE/` to `<slug>/`.
2. Fill `spec.md` (or link to a `docs/superpowers/specs/` spec).
3. Add a row above and append to `../PROGRESS.md`.
