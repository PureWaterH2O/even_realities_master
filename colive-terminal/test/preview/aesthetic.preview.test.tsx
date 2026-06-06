/**
 * M3.5 Aesthetic Pass — renders all 25 scenarios and dumps comparison frames.
 *
 *   PREVIEW=1 npx vitest run test/preview/aesthetic.preview.test.tsx
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { capture, flattenAll, emit, snap, key, KEYS, type Frame } from './replay'
import {
  idle, simpleQA, streaming, thinking, toolRead, toolBash, diffEdit,
  cockpit, permission, inProgress, markdownDoc, tall, errorDiag,
  statusBusy, question, backgroundCmd, subagent, costSummary,
} from './scenarios'

const WRITE = process.env.PREVIEW === '1'
const OUT = resolve(__dirname, '../../preview-out/aesthetic')
const written: string[] = []

function dump(name: string, frames: Frame[]): void {
  if (!WRITE) return
  mkdirSync(OUT, { recursive: true })
  frames.forEach((f, i) => {
    const base = `${name}-${String(i + 1).padStart(2, '0')}-${f.label}`
    writeFileSync(resolve(OUT, `${base}.txt`), `${f.plain}\n`, 'utf8')
    writeFileSync(resolve(OUT, `${base}.ansi`), `${f.ansi}\n`, 'utf8')
    written.push(base)
  })
}

afterAll(() => {
  if (WRITE) {
    // eslint-disable-next-line no-console
    console.log(`\n[aesthetic] wrote ${written.length} frame(s) to preview-out/aesthetic/:\n  ${written.join('\n  ')}`)
  }
})

describe('aesthetic preview', () => {
  it('01-idle: app chrome with no events', async () => {
    const frames = await capture([snap('idle')])
    dump('01-idle', frames)
    expect(frames[0]!.plain).toContain('>')
  })

  it('02-simple-qa: one turn', async () => {
    const full = flattenAll(simpleQA)
    dump('02-simple-qa', [full])
    expect(full.plain).toContain('Say hello')
    expect(full.plain).toContain('Hello!')
  })

  it('03-streaming: mid-stream (no result yet)', async () => {
    const full = flattenAll(streaming)
    dump('03-streaming', [full])
    expect(full.plain).toContain('Count from 1 to 20')
    expect(full.plain).toContain('10')
  })

  it('04-thinking: collapsed thinking block', async () => {
    const full = flattenAll(thinking)
    dump('04-thinking', [full])
    expect(full.plain).toContain('thinking')
  })

  it('05-tool-read: Read tool header', async () => {
    const full = flattenAll(toolRead)
    dump('05-tool-read', [full])
    expect(full.plain).toContain('Read')
    expect(full.plain).toContain('CLAUDE.md')
  })

  it('06-tool-bash: Bash tool with output', async () => {
    const full = flattenAll(toolBash)
    dump('06-tool-bash', [full])
    expect(full.plain).toContain('Bash')
    expect(full.plain).toContain('ls -la')
  })

  it('07-tool-edit: Edit with inline diff', async () => {
    const full = flattenAll(diffEdit)
    dump('07-tool-edit', [full])
    expect(full.plain).toContain('Edit')
    expect(full.plain).toContain('greet')
  })

  it('08-multi-tool: multiple tools in one turn', async () => {
    const full = flattenAll(cockpit)
    dump('08-multi-tool', [full])
    expect(full.plain).toContain('Bash')
    expect(full.plain).toContain('Edit')
    expect(full.plain).toContain('Read')
  })

  it('09-permission: inline permission prompt', async () => {
    const frames = await capture([...permission.map(emit), snap('permission')])
    dump('09-permission', frames)
    expect(frames[0]!.plain).toContain('permission')
    expect(frames[0]!.plain).toContain('Allow')
  })

  it('10-todos: task panel with mixed states', async () => {
    const full = flattenAll(inProgress)
    dump('10-todos', [full])
    expect(full.plain).toMatch(/✔/)
    expect(full.plain).toMatch(/▶/)
    expect(full.plain).toMatch(/☐/)
  })

  it('11-markdown: rendered markdown elements', async () => {
    const full = flattenAll(markdownDoc)
    dump('11-markdown', [full])
    expect(full.plain).toContain('Heading two')
    expect(full.plain).not.toContain('## Heading two')
  })

  it('12-scrollback: scrolled viewport', async () => {
    const frames = await capture([
      ...tall.map(emit),
      snap('bottom'),
      key(KEYS.pageUp),
      snap('scrolled'),
    ])
    dump('12-scrollback', frames)
    expect(frames[0]!.plain).toContain('pinned')
  })

  it('13-error: failed tool rendering', async () => {
    const full = flattenAll(errorDiag)
    dump('13-error', [full])
    expect(full.plain).toContain('Read')
    // The error state is color-only in rows.ts (the dot/name are painted red,
    // computed from the summary), and stripAnsi drops color — so "failed" never
    // appears in plain text. Assert on the rendered file path, which survives.
    expect(full.plain).toContain('/tmp/no-such-file-12345.txt')
  })

  it('14-status-line: busy state with running stats', async () => {
    const frames = await capture([...statusBusy.map(emit), snap('busy')])
    dump('14-status-line', frames)
    expect(frames[0]!.plain).toContain('850')
  })

  it('15-slash-menu: / command picker', async () => {
    const frames = await capture([snap('before'), key('/'), snap('menu-open')])
    dump('15-slash-menu', frames)
    expect(frames[1]!.plain).toContain('clear')
  })

  it('16-question: inline question prompt', async () => {
    const frames = await capture([...question.map(emit), snap('question')])
    dump('16-question', frames)
    expect(frames[0]!.plain).toContain('programming language')
    expect(frames[0]!.plain).toContain('TypeScript')
  })

  it('17-background-cmd: tool running (no end yet)', async () => {
    const full = flattenAll(backgroundCmd)
    dump('17-background-cmd', [full])
    expect(full.plain).toContain('Bash')
  })

  it('18-subagent: Agent tool call', async () => {
    const full = flattenAll(subagent)
    dump('18-subagent', [full])
    expect(full.plain).toContain('Agent')
  })

  it('19-interrupt: Esc mid-stream', async () => {
    const frames = await capture([
      ...streaming.map(emit),
      snap('pre-interrupt'),
      key('\x1b'),
      snap('post-interrupt'),
    ])
    dump('19-interrupt', frames)
  })

  it('20-cost-summary: token/cost display', async () => {
    const frames = await capture([...costSummary.map(emit), snap('cost')])
    dump('20-cost-summary', frames)
    expect(frames[0]!.plain).toContain('12480')
  })

  it('21-effort-picker: /effort UI', async () => {
    // /effort may not be implemented — capture what we have
    const frames = await capture([
      key('/'),
      key('e'), key('f'), key('f'), key('o'), key('r'), key('t'),
      snap('effort'),
    ])
    dump('21-effort-picker', frames)
  })

  it('22-usage-display: /usage output', async () => {
    const frames = await capture([
      ...simpleQA.map(emit),
      key('/'),
      key('u'), key('s'), key('a'), key('g'), key('e'),
      key('\r'),
      snap('usage'),
    ])
    dump('22-usage-display', frames)
  })

  it('23-model-picker: /model UI', async () => {
    const frames = await capture([
      key('/'),
      key('m'), key('o'), key('d'), key('e'), key('l'),
      snap('model-menu'),
    ])
    dump('23-model-picker', frames)
  })

  it('24-config-display: /config output', async () => {
    // /config may render a note — capture what we have
    const frames = await capture([
      key('/'),
      key('c'), key('o'), key('n'), key('f'), key('i'), key('g'),
      key('\r'),
      snap('config'),
    ])
    dump('24-config-display', frames)
  })

  it('25-memory-display: /memory output', async () => {
    // /memory may not be implemented — capture what we have
    const frames = await capture([
      key('/'),
      key('m'), key('e'), key('m'), key('o'), key('r'), key('y'),
      key('\r'),
      snap('memory'),
    ])
    dump('25-memory-display', frames)
  })
})
