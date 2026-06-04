/**
 * M3.2B preview rig — drive the REAL composer's @-file menu + !bash via scripted
 * keystrokes and capture the rendered frames, so the controller SEES the menu,
 * mid-line insertion, and bash echo before the hardware UAT.
 *
 *   PREVIEW=1 npx vitest run test/preview/m32b.preview.test.tsx   # dump frames
 *   npx vitest run test/preview/m32b.preview.test.tsx             # smoke assertions only
 *   ./scripts/screenshots.sh                                      # frames -> PNGs (needs vhs)
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { capture, snap, key, emit, type Frame } from './replay'

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

afterAll(() => {
  // eslint-disable-next-line no-console
  if (WRITE) console.log(`\n[m32b preview] wrote ${written.length} frame(s) to preview-out/:\n  ${written.join('\n  ')}`)
})

const FILES = ['src/desk/app.tsx', 'src/desk/slash.ts', 'src/hub/routes.ts', 'src/index.ts', 'README.md']
const CFG = { listFiles: () => FILES }

describe('M3.2B @-file + !bash preview', () => {
  it('C1 @ opens a fuzzy file menu; Tab inserts the path', async () => {
    const frames = await capture([
      key('explain @app'),
      snap('m32b-c1-at-menu'),
      key('\t'),
      snap('m32b-c1-at-inserted'),
    ], 's-preview', CFG)
    dump(frames)
    expect(frames.find((f) => f.label === 'm32b-c1-at-menu')!.plain).toContain('@src/desk/app.tsx')
    expect(frames.find((f) => f.label === 'm32b-c1-at-inserted')!.plain).toContain('explain @src/desk/app.tsx')
  })

  it('C2 @ works mid-line on a later token', async () => {
    const frames = await capture([
      key('compare @app.tsx with @rou'),
      snap('m32b-c2-at-midline'),
    ], 's-preview', CFG)
    dump(frames)
    expect(frames[0]!.plain).toContain('@src/hub/routes.ts')
  })

  it('C3 !bash echoes the command on submit', async () => {
    const frames = await capture([
      key('!git status'),
      snap('m32b-c3-bash-typed'),
      key('\r'),
      snap('m32b-c3-bash-submitted'),
    ], 's-preview', CFG)
    dump(frames)
    expect(frames.find((f) => f.label === 'm32b-c3-bash-typed')!.plain).toContain('!git status')
    expect(frames.find((f) => f.label === 'm32b-c3-bash-submitted')!.plain).toContain('git status')
  })

  it('C4 layout: transcript above, composer with an open @ menu below', async () => {
    const frames = await capture([
      emit({ type: 'user_prompt', text: 'wire up the file picker' }),
      emit({ type: 'text_delta', text: 'Sure — point me at the file.' }),
      key('start from @app'),
      snap('m32b-layout'),
    ], 's-preview', CFG)
    dump(frames)
    const f = frames[0]!.plain
    expect(f).toContain('wire up the file picker')
    expect(f).toContain('@src/desk/app.tsx')
  })
})
