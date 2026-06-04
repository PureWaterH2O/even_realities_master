# Projects

Status board for everything we're building. Each active project has a folder
(`<slug>/`) cloned from `_TEMPLATE/`.

| Project | Slug | Status | Started | Last update |
|---------|------|--------|---------|-------------|
| Co-Live Terminal | `colive-terminal` | ✅ M1 + M2 + **M3.1 done (merged to `main`)**. M3 "Desk Cockpit" (native-parity daily driver) — **M3.0 ✅ LOCKED**; **M3.1 "Readable transcript" ✅ DONE 2026-06-02** (scrollback viewport, inline diff, syntax/markdown, Ctrl-O verbose, todos panel, desk-only thinking; 314 tests; hardware-signed-off A1–A6 + B1–B4). **M3.2A "Composer" ✅ DONE 2026-06-03 (merged to `main` `278f7c8`; planner-validated)** (multiline/cursor/word nav, per-project history, paste, mouse-wheel scroll, slash menu, `/select`·`/scroll` toggle; zero Core change; 391 tests, clean-tree verified; hardware-signed-off composer core). **A6 copy RESOLVED via Option+drag** (native selection bypass; user accepted) → copy/paste phase **descoped** to one fix: the **mouse-history-leak fix ✅ MERGED `2370b25` 2026-06-03** (VS Code alt-scroll 1007 → wheel becomes dense arrow-bursts → polluted the composer; fixed via `isMouseReport` drop + `1007l` + density burst-detection; 412 tests; hardware-validated). **Tradeoff (accepted):** wheel no longer scrolls → PageUp/PageDown scroll; routing bursts→scroll is a future enhancement. **Deferred:** A4 post-paste ↑/↓ stepping (`COLIVE_A4_LOG` wired); A5 full slash set → M3.3. **M3.2B "`@`-file + `!`bash" ✅ HARDWARE UAT C1–C6 PASS 2026-06-03 — branch `colive-terminal-m3.2b`, NOT merged (awaiting planner validation + merge)** (mid-line `@` fuzzy file menu inserts a repo-relative `@path` for Claude's Read tool; `!`cmd delegated to Claude's Bash tool, permission-gated; desk reads filenames only — never contents, never a shell; zero Core/Hub change, **empty diff proven**; **442 tests, +30**; self-test gate passed; **spec R1 `@`-mention auto-read RESOLVED positive on hardware** — no nudge needed). | 2026-05-30 | 2026-06-03 |

Status key: 💡 idea · 🟦 planned · 🟨 in progress · ✅ done · 🟥 blocked · ⬛ abandoned

## Starting a project

1. Copy `_TEMPLATE/` to `<slug>/`.
2. Fill `spec.md` (or link to a `docs/superpowers/specs/` spec).
3. Add a row above and append to `../PROGRESS.md`.
