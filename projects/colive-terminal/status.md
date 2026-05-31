# Co-Live Terminal — Status

**Current state:** 🟨 in progress — M1 (end-to-end loop)
**Phase:** Phases 0–2 ✅ (Session Core + Client Hub). `colive serve` boots and serves the
Even-app HTTP/SSE contract end-to-end (153 tests; controller smoke-tested).
**Branch:** `feat/colive-terminal-m1` (do NOT build on `main`).
**Next action:** ⏸️ **HARDWARE ACCEPTANCE (Task 2.3)** — user connects the real G2/R1/Even app
to `colive serve` and confirms: live stream, no ~20s first-turn delay, model = `claude-opus-4-8`,
ring permission works. Then Phase 3 (desk client) + Phase 4 (the end-to-end loop).
**Blockers:** none. (Tasks 2.3 + 4.2 need the user + real glasses — hardware pauses, not blockers.)
