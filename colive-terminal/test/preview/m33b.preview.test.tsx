/**
 * M3.3b control-picker preview frames: the /model and /mode value pickers and the
 * status line after a pick. Mirrors m33a.preview.test.tsx.
 *   PREVIEW=1 npx vitest run test/preview/m33b.preview.test.tsx   # dump frames
 *   npx vitest run test/preview/m33b.preview.test.tsx             # smoke assertions only
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { capture, snap, key, type Frame } from './replay'

const WRITE = process.env.PREVIEW === '1'
const OUT = resolve(__dirname, '../../preview-out')
const written: string[] = []
function dump(frames: Frame[]): void {
  if (!WRITE) return
  mkdirSync(OUT, { recursive: true })
  for (const f of frames) {
    writeFileSync(resolve(OUT, `${f.label}.txt`), `${f.plain}\n`, 'utf8')
    writeFileSync(resolve(OUT, `${f.label}.ansi`), `${f.ansi}\n`, 'utf8')
    written.push(f.label)
  }
}
afterAll(() => { if (WRITE) console.log(`[m33b preview] wrote ${written.length} frame(s): ${written.join(', ')}`) })

describe('M3.3b control pickers preview', () => {
  it('/model value picker', async () => {
    const frames = await capture([key('/model'), snap('m33b-model-picker')])
    dump(frames)
    expect(frames[0]!.plain).toContain('Opus 4.8')
    expect(frames[0]!.plain).toContain('Sonnet 4.6')
    expect(frames[0]!.plain).toContain('Haiku 4.5')
  })
  it('/mode value picker', async () => {
    const frames = await capture([key('/mode'), snap('m33b-mode-picker')])
    dump(frames)
    expect(frames[0]!.plain).toContain('Default')
    expect(frames[0]!.plain).toContain('Accept-edits')
    expect(frames[0]!.plain).toContain('Plan')
  })
  it('status line shows the active model + mode after a pick', async () => {
    const frames = await capture([key('/mode'), key('\x1b[B'), key('\x1b[B'), key('\r'), snap('m33b-status-plan')])
    dump(frames)
    expect(frames[0]!.plain).toContain('plan')      // mode picked
    expect(frames[0]!.plain).toContain('opus-4-8')  // model seeded from getInfo (short label)
  })
})
