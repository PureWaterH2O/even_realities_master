/**
 * Renders the desk scenarios and (when PREVIEW=1) writes each captured frame to
 * `preview-out/` for the controller to read. Always runs a couple of smoke
 * assertions so it doubles as a regression guard in the normal suite.
 *
 *   PREVIEW=1 npx vitest run test/preview     # dump frames to preview-out/
 *   npx vitest run test/preview               # just the smoke assertions
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { capture, flattenAll, emit, snap, key, KEYS, type Frame } from './replay'
import { cockpit, tall } from './scenarios'

const WRITE = process.env.PREVIEW === '1'
const OUT = resolve(__dirname, '../../preview-out')
const written: string[] = []

function dump(scenario: string, frames: Frame[]): void {
  if (!WRITE) return
  mkdirSync(OUT, { recursive: true })
  frames.forEach((f, i) => {
    const base = `${scenario}-${String(i + 1).padStart(2, '0')}-${f.label}`
    writeFileSync(resolve(OUT, `${base}.txt`), f.plain, 'utf8')
    writeFileSync(resolve(OUT, `${base}.ansi`), f.ansi, 'utf8')
    written.push(base)
  })
}

afterAll(() => {
  if (WRITE) {
    // eslint-disable-next-line no-console
    console.log(`\n[preview] wrote ${written.length} frame(s) to preview-out/:\n  ${written.join('\n  ')}`)
  }
})

describe('desk preview', () => {
  it('cockpit: tasks + tools + diff + markdown (default, then Ctrl-O verbose)', async () => {
    // Windowed frames (what the live App actually shows) + full unclipped flatten.
    const frames = await capture([
      ...cockpit.map(emit),
      snap('window-default'),
      key(KEYS.ctrlO),
      snap('window-verbose'),
    ])
    const full = flattenAll(cockpit)
    const fullVerbose = flattenAll(cockpit, { verbose: true })
    dump('cockpit', [...frames, full, fullVerbose])

    // Assert against the FULL transcript (the window clips the top off-screen).
    expect(full.plain).toContain('Task complete')
    expect(full.plain).not.toContain('## Task complete') // markdown rendered, not raw
    expect(full.plain).toContain('Todos')
    expect(full.plain).toMatch(/✔/) // a completed todo glyph
    // The diff for the Edit tool shows the new line.
    expect(full.plain).toContain('hello from m3.1')
    // Verbose reveals tool input that is hidden by default.
    expect(full.plain).not.toContain('touch /tmp/m31todo.txt')
    expect(fullVerbose.plain).toContain('touch /tmp/m31todo.txt')
  })

  it('tall: scrolls up from the pinned bottom', async () => {
    const frames = await capture([
      ...tall.map(emit),
      snap('bottom'),
      key(KEYS.pageUp),
      snap('paged-up'),
    ])
    dump('tall', frames)
    const bottom = frames.find((f) => f.label === 'bottom')!.plain
    const up = frames.find((f) => f.label === 'paged-up')!.plain
    expect(bottom).toContain('(pinned ▼)')
    expect(up).not.toContain('(pinned ▼)')
  })
})
