/**
 * M3.2A "Composer" preview rig — drive the REAL desk App's composer via scripted
 * KEYSTROKES (the M3.1 rig was event-driven; the composer is input-driven) and
 * capture the exact rendered frames so the controller can SEE multiline / cursor /
 * paste / slash-menu / history / layout before the user runs the hardware UAT.
 *
 *   PREVIEW=1 npx vitest run test/preview/m32a.preview.test.tsx   # dump frames
 *   npx vitest run test/preview/m32a.preview.test.tsx             # smoke assertions only
 *   ./scripts/screenshots.sh                                      # frames -> PNGs (needs vhs)
 *
 * Frames land in preview-out/ (gitignored). The smoke assertions double as a
 * regression guard for the composer's rendered layout in the normal suite.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { capture, snap, key, emit, type Frame } from './replay'

const WRITE = process.env.PREVIEW === '1'
const OUT = resolve(__dirname, '../../preview-out')
const written: string[] = []

/** Write each frame to preview-out/<label>.{txt,ansi} (label is already unique). */
function dump(frames: Frame[]): void {
  if (!WRITE) return
  mkdirSync(OUT, { recursive: true })
  for (const f of frames) {
    writeFileSync(resolve(OUT, `${f.label}.txt`), `${f.plain}\n`, 'utf8')
    writeFileSync(resolve(OUT, `${f.label}.ansi`), `${f.ansi}\n`, 'utf8')
    written.push(f.label)
  }
}

afterAll(() => {
  // eslint-disable-next-line no-console
  if (WRITE) console.log(`\n[m32a preview] wrote ${written.length} frame(s) to preview-out/:\n  ${written.join('\n  ')}`)
})

describe('M3.2A composer preview', () => {
  it('A1 multiline authoring (Ctrl-J inserts a newline; continuation lines indent under the prompt)', async () => {
    const frames = await capture([
      key('Summarize the repo architecture'),
      key('\n'), // Ctrl-J -> newline, NOT submit
      key('and list the top three risks.'),
      snap('m32a-a1-multiline'),
    ])
    dump(frames)
    const f = frames[0]!.plain
    expect(f).toContain('› Summarize the repo architecture') // first line keeps the "› " prompt
    expect(f).toContain('  and list the top three risks.')   // continuation line is indented
  })

  it('A2 mid-line cursor edit (← moves the visible inverse-video cursor)', async () => {
    const frames = await capture([
      key('helloworld'),
      key('\x1b[D'), key('\x1b[D'), key('\x1b[D'), key('\x1b[D'), key('\x1b[D'), // ← x5 -> between "hello" and "world"
      snap('m32a-a2-cursor'),
    ])
    dump(frames)
    expect(frames[0]!.plain).toContain('› helloworld')
    expect(frames[0]!.ansi).toContain('[7m') // inverse cursor cell sits mid-line, not only at the end
  })

  it('A4 multi-line paste lands in the composer without submitting', async () => {
    const frames = await capture([
      key('\x1b[200~function add(a, b) {\n  return a + b\n}\x1b[201~'), // bracketed paste -> usePaste
      snap('m32a-a4-paste'),
    ])
    dump(frames)
    const f = frames[0]!.plain
    expect(f).toContain('› function add(a, b) {')
    expect(f).toContain('return a + b')
    expect(f).toContain('}')
  })

  it('A5 slash menu opens on "/" and filters as you type', async () => {
    const frames = await capture([
      key('/'),
      snap('m32a-a5-slash-all'),
      key('c'), // "/c" -> clear / compact / context
      snap('m32a-a5-slash-filtered'),
    ])
    dump(frames)
    const all = frames.find((f) => f.label === 'm32a-a5-slash-all')!.plain
    const filtered = frames.find((f) => f.label === 'm32a-a5-slash-filtered')!.plain
    expect(all).toContain('/clear')
    expect(all).toContain('/help')
    expect(filtered).toContain('/clear')
    expect(filtered).not.toContain('/help') // 'help' filtered out by the "c" prefix
  })

  it('A3 history recall (↑ after submitting walks newest→oldest)', async () => {
    const frames = await capture([
      key('say one'), key('\r'),
      key('say two'), key('\r'),
      key('\x1b[A'), // ↑ -> recalls "say two"
      snap('m32a-a3-history-1'),
      key('\x1b[A'), // ↑ -> recalls "say one"
      snap('m32a-a3-history-2'),
    ])
    dump(frames)
    expect(frames.find((f) => f.label === 'm32a-a3-history-1')!.plain).toContain('› say two')
    expect(frames.find((f) => f.label === 'm32a-a3-history-2')!.plain).toContain('› say one')
  })

  it('layout: a multi-line composer below a live transcript (dynamic viewport reservation)', async () => {
    const frames = await capture([
      emit({ type: 'user_prompt', text: 'render a haiku about terminals' }),
      emit({ type: 'text_delta', text: 'Glowing prompt awaits\nfingers dance on warm keycaps\nthoughts compile to light' }),
      key('draft line one'), key('\n'), key('draft line two'),
      snap('m32a-layout'),
    ])
    dump(frames)
    const f = frames[0]!.plain
    expect(f).toContain('render a haiku about terminals') // transcript above
    expect(f).toContain('› draft line one')               // composer below, line 1
    expect(f).toContain('  draft line two')               // composer below, line 2
  })
})
