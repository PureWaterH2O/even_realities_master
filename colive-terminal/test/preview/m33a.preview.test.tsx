/**
 * M3.3a desk-render regression preview. The Core refactor (persistent streaming
 * query) must NOT change what the desk renders — the emitted CoLiveEvents are
 * byte-identical — so these frames should match the pre-refactor render of the
 * same canned session.
 *
 *   PREVIEW=1 npx vitest run test/preview/m33a.preview.test.tsx   # dump frames
 *   npx vitest run test/preview/m33a.preview.test.tsx             # smoke assertions only
 *   ./scripts/screenshots.sh m33a-session                         # frame -> PNG (needs vhs)
 *
 * Frames land in preview-out/ (gitignored). The smoke assertions double as a
 * regression guard for the desk's rendered layout in the normal suite.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { capture, snap, emit, type Frame } from './replay'

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
  if (WRITE) console.log(`\n[m33a preview] wrote ${written.length} frame(s) to preview-out/:\n  ${written.join('\n  ')}`)
})

describe('M3.3a desk-render regression', () => {
  it('renders a multi-tool session unchanged', async () => {
    const frames = await capture([
      emit({ type: 'user_prompt', text: 'refactor the turn driver' }),
      emit({ type: 'status', state: 'busy' }),
      emit({ type: 'status', state: 'text_start' }),
      emit({ type: 'text_delta', text: 'On it — reading the session module.' }),
      emit({ type: 'status', state: 'text_end' }),
      emit({ type: 'tool_start', name: 'Read', toolId: 't1' }),
      emit({
        type: 'tool_end',
        name: 'Read',
        toolId: 't1',
        summary: 'Read session.ts',
        detail: { input: { path: 'session.ts' }, output: 'export class Session {}' },
      }),
      emit({ type: 'tool_start', name: 'Edit', toolId: 't2' }),
      emit({
        type: 'tool_end',
        name: 'Edit',
        toolId: 't2',
        summary: 'Edit session.ts',
        detail: { input: { path: 'session.ts' }, output: 'ok' },
      }),
      emit({ type: 'status', state: 'text_start' }),
      emit({ type: 'text_delta', text: 'Done — extracted the turn driver into its own module.' }),
      emit({ type: 'status', state: 'text_end' }),
      emit({ type: 'status', state: 'idle' }),
      snap('m33a-session'),
    ])
    dump(frames)
    const f = frames[0]!.plain
    expect(f).toContain('refactor the turn driver')
    expect(f).toContain('Read')
    expect(f).toContain('Edit')
  })
})
