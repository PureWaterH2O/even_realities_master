# Projects

Status board for everything we're building. Each active project has a folder
(`<slug>/`) cloned from `_TEMPLATE/`.

| Project | Slug | Status | Started | Last update |
|---------|------|--------|---------|-------------|
| Co-Live Terminal | `colive-terminal` | ✅ M1 + M2 + **M3.1 done (merged to `main`)**. M3 "Desk Cockpit" (native-parity daily driver) — **M3.0 ✅ LOCKED**; **M3.1 "Readable transcript" ✅ DONE 2026-06-02** (scrollback viewport, inline diff, syntax/markdown, Ctrl-O verbose, todos panel, desk-only thinking; 314 tests; hardware-signed-off A1–A6 + B1–B4). **M3.2A "Composer" 🔧 UAT fix pass 2026-06-03 — branch `colive-terminal-m3.2a` (multiline/cursor/word nav, per-project history, paste, mouse-wheel scroll, slash menu; zero Core change). First hardware UAT flagged A2/A4/A6 → all fixed via subagent-driven TDD (A2 readline Option+word-nav; A4 real stale-closure arrow bug; A6 `/select`⇄`/scroll` mouse-mode toggle for copy); 391 tests, clean-tree re-verified. Re-UAT pending (focus A2/A4/A6), NOT merged.** Deferred: `/copy` OSC 52 → M3.2B; full slash set (A5) → M3.3 (needs Hub-reported commands + string→streaming-input Core refactor). | 2026-05-30 | 2026-06-03 |

Status key: 💡 idea · 🟦 planned · 🟨 in progress · ✅ done · 🟥 blocked · ⬛ abandoned

## Starting a project

1. Copy `_TEMPLATE/` to `<slug>/`.
2. Fill `spec.md` (or link to a `docs/superpowers/specs/` spec).
3. Add a row above and append to `../PROGRESS.md`.
