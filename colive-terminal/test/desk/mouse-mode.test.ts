import { describe, expect, it } from 'vitest'
import { MOUSE_ON, MOUSE_OFF, ALT_SCROLL_OFF, ALT_SCROLL_ON } from '../../src/desk/mouse-mode'

describe('mouse-mode DECSET sequences', () => {
  it('MOUSE_ON enables button tracking (1000h) then SGR encoding (1006h)', () => {
    expect(MOUSE_ON).toBe('\x1b[?1000h\x1b[?1006h')
  })

  it('MOUSE_OFF disables in mirror order (1006l then 1000l)', () => {
    expect(MOUSE_OFF).toBe('\x1b[?1006l\x1b[?1000l')
  })

  // Alternate scroll mode (1007): in the alt-screen, xterm-family terminals (incl.
  // VS Code) translate wheel/trackpad scroll into ↑/↓ arrow keys, which collide with
  // the composer. We disable it for the session so the wheel reports as SGR instead.
  it('ALT_SCROLL_OFF is DECRST 1007 (disable alternate scroll)', () => {
    expect(ALT_SCROLL_OFF).toBe('\x1b[?1007l')
  })

  it('ALT_SCROLL_ON is DECSET 1007 (restore alternate scroll on exit)', () => {
    expect(ALT_SCROLL_ON).toBe('\x1b[?1007h')
  })

  it('disable/restore sequences are exact inverses (mode 1007, l vs h)', () => {
    expect(ALT_SCROLL_OFF).toBe(ALT_SCROLL_ON.replace(/h$/, 'l'))
  })
})
