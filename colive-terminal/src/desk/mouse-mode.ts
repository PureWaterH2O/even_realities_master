/**
 * M3.2A (UAT A6) — the SGR mouse-reporting DECSET sequences, in ONE place.
 *
 * The desk turns on button/wheel tracking so the mouse WHEEL scrolls the
 * transcript (the wheel arrives as `\x1b[<..M` SGR reports we parse off ink's
 * internal input channel). The cost: while reporting is on, the terminal
 * captures click-drag, so NATIVE text selection / copy is suppressed.
 *
 * These literals are the single source of truth for that toggle:
 *   - the CLI entry (src/index.ts) writes MOUSE_ON when entering the alt-screen
 *     and MOUSE_OFF when leaving, so on-exit cleanup always matches;
 *   - the runtime `/select` · `/scroll` commands (src/desk/app.tsx) write the
 *     same literals to flip modes mid-session without restarting.
 *
 * 1000h = button tracking (incl. wheel); 1006h = SGR encoding. DISABLE in the
 * mirror order (1006 then 1000). DECSET/DECRST toggles set terminal MODES — they
 * write nothing to the screen buffer, so emitting them at runtime does not
 * corrupt ink's rendered frame (ink only diffs its own frame string).
 */

/** Enable SGR mouse reporting (button + wheel tracking). Wheel scroll ON. */
export const MOUSE_ON = '\x1b[?1000h\x1b[?1006h'

/** Disable SGR mouse reporting. Wheel scroll OFF; native click-drag selection ON. */
export const MOUSE_OFF = '\x1b[?1006l\x1b[?1000l'

/**
 * Disable / restore "alternate scroll mode" (DECSET 1007).
 *
 * In the alternate screen, xterm-family terminals (incl. VS Code's integrated
 * terminal) translate mouse-wheel / trackpad scroll into ARROW-KEY sequences
 * (`\x1b[A` / `\x1b[B`) so pagers like less/man scroll with the wheel. That
 * collides head-on with M3.2A's composer, where ↑/↓ drive the input — a captured
 * UAT log showed an Option+double-click / trackpad scroll arriving as a burst of
 * `\x1b[A`, which is byte-identical to a real Up press and so recalled history
 * into the composer (no in-app guard can tell them apart).
 *
 * We turn alternate scroll OFF for the whole desk session so the wheel instead
 * reports as SGR (button 64/65 — what our wheel handler reads off ink's 'input'
 * channel) and arrow keys remain genuine keystrokes. Restored on exit so the
 * user's shell keeps its normal wheel-scroll behaviour. Session-level (set on
 * enter / restored on leave) — independent of the /select·/scroll toggle.
 */
export const ALT_SCROLL_OFF = '\x1b[?1007l'
export const ALT_SCROLL_ON = '\x1b[?1007h'
