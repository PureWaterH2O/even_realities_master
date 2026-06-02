# Projects

Status board for everything we're building. Each active project has a folder
(`<slug>/`) cloned from `_TEMPLATE/`.

| Project | Slug | Status | Started | Last update |
|---------|------|--------|---------|-------------|
| Co-Live Terminal | `colive-terminal` | ✅ M1 + M2 done (merged to `main`, 237 tests, hardware-validated). 🟨 M3 "Desk Cockpit" (native-parity daily driver) — **M3.0 ✅ LOCKED** (`docs/superpowers/specs/2026-06-01-colive-terminal-m3-design.md`); substrate=Terminal TUI, DESK-only; control layer needs a string→streaming-input Core refactor (M3.3). **Next: brainstorm M3.1 (readable transcript) when user gives the word** — no M3.1 planning until then | 2026-05-30 | 2026-06-01 |

Status key: 💡 idea · 🟦 planned · 🟨 in progress · ✅ done · 🟥 blocked · ⬛ abandoned

## Starting a project

1. Copy `_TEMPLATE/` to `<slug>/`.
2. Fill `spec.md` (or link to a `docs/superpowers/specs/` spec).
3. Add a row above and append to `../PROGRESS.md`.
