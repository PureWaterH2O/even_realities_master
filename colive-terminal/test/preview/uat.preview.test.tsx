/**
 * UAT walk — one canonical captured frame per runbook item (A1–A6), so each desk
 * feature can be eyeballed in isolation and mapped 1:1 to
 * projects/colive-terminal/m3.1-uat-runbook.md. Dumps to preview-out/ under
 * PREVIEW=1; always runs as assertions.
 *
 *   PREVIEW=1 npx vitest run test/preview/uat.preview.test.tsx
 *   ./scripts/screenshots.sh   # then renders uat-* frames to shot-uat-*.png
 */
import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { capture, flattenAll, emit, snap, key, KEYS, type Frame } from './replay'
import { diffEdit, thinking, markdownDoc, inProgress, cockpit, tall } from './scenarios'

const WRITE = process.env.PREVIEW === '1'
const OUT = resolve(__dirname, '../../preview-out')
function dump(name: string, frames: Frame[]): void {
  if (!WRITE) return
  mkdirSync(OUT, { recursive: true })
  frames.forEach((f, i) => {
    const base = `uat-${name}-${String(i + 1).padStart(2, '0')}-${f.label}`
    writeFileSync(resolve(OUT, `${base}.txt`), `${f.plain}\n`, 'utf8')
    writeFileSync(resolve(OUT, `${base}.ansi`), `${f.ansi}\n`, 'utf8')
  })
}

describe('UAT walk (A1–A6)', () => {
  it('A1 scroll: pinned bottom → paged up → arrow up', async () => {
    const frames = await capture([
      ...tall.map(emit),
      snap('bottom'),
      key(KEYS.pageUp),
      snap('paged-up'),
      key(KEYS.up),
      snap('arrow-up'),
    ])
    dump('a1-scroll', frames)
    expect(frames.find((f) => f.label === 'bottom')!.plain).toContain('(pinned ▼)')
    expect(frames.find((f) => f.label === 'paged-up')!.plain).toContain('PgUp/PgDn')
  })

  it('A2 diff: inline +/- for a multi-line Edit', () => {
    const full = flattenAll(diffEdit)
    dump('a2-diff', [full])
    expect(full.plain).toContain('- export function greet() {')
    expect(full.plain).toContain('+ export function greet(name: string) {')
    expect(full.plain).toContain('Edit(src/greet.ts)')
  })

  it('A3 verbose: Ctrl-O reveals tool input/output', async () => {
    const def = flattenAll(cockpit)
    const verbose = flattenAll(cockpit, { verbose: true })
    dump('a3-verbose', [def, verbose])
    expect(def.plain).not.toContain('Create the file') // hidden by default
    expect(verbose.plain).toContain('Create the file') // shown under Ctrl-O
  })

  it('A4 markdown: every block type', () => {
    const full = flattenAll(markdownDoc)
    dump('a4-markdown', [full])
    expect(full.plain).not.toContain('## Heading two')
    expect(full.plain).toContain('− First bullet') // native dash bullet (D-015)
  })

  it('A5 todos: live mixed states (✔ / ■ / □)', () => {
    const full = flattenAll(inProgress)
    dump('a5-todos', [full])
    expect(full.plain).toMatch(/✔/)
    expect(full.plain).toMatch(/■/)
    expect(full.plain).toMatch(/□/)
  })

  it('A6 thinking: streaming open → collapsed stub → ctrl+o expanded', async () => {
    const frames = await capture([
      // up to (but not including) the answer: thinking is still open + streaming
      ...thinking.slice(0, 4).map(emit),
      snap('open'),
      // the answer + result close & collapse the thinking block
      ...thinking.slice(4).map(emit),
      snap('collapsed'),
      key(KEYS.ctrlO),
      snap('expanded'),
    ])
    dump('a6-thinking', frames)
    expect(frames.find((f) => f.label === 'open')!.plain).toContain('trisects')
    expect(frames.find((f) => f.label === 'collapsed')!.plain).toMatch(/· thinking \(\d+ line/)
    expect(frames.find((f) => f.label === 'expanded')!.plain).toContain('trisects')
  })
})
