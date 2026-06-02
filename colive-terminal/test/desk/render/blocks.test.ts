import { describe, it, expect } from 'vitest'
import { reduceBlocks, initialBlockState } from '../../../src/desk/render/blocks'
import type { BlockState } from '../../../src/desk/render/blocks'

const run = (events: any[]): BlockState =>
  events.reduce((s, event) => reduceBlocks(s, { type: 'event', event }), initialBlockState())

describe('reduceBlocks', () => {
  it('accumulates text_delta into one open assistant block', () => {
    const s = run([
      { type: 'text_delta', text: 'Hel' },
      { type: 'text_delta', text: 'lo' },
    ])
    expect(s.blocks).toEqual([{ kind: 'assistant', text: 'Hello', closed: false }])
  })

  it('folds tool_start then tool_end into ONE keyed tool block', () => {
    const s = run([
      { type: 'tool_start', name: 'Read', toolId: 't1' },
      { type: 'tool_end', name: 'Read', toolId: 't1', summary: 'read a', detail: { input: { file_path: '/a' }, output: 'x' } },
    ])
    const tools = s.blocks.filter((b) => b.kind === 'tool')
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({ kind: 'tool', toolId: 't1', name: 'Read', summary: 'read a' })
  })

  it('accumulates thinking_delta into a thinking block, even with no think_start', () => {
    const s = run([
      { type: 'thinking_delta', text: 'mulling ' },
      { type: 'thinking_delta', text: 'it over' },
    ])
    expect(s.blocks).toEqual([{ kind: 'thinking', text: 'mulling it over', closed: false }])
  })

  it('closes the open assistant on result so the next reply starts fresh', () => {
    const s = run([
      { type: 'text_delta', text: 'a' },
      { type: 'result', success: true, text: 'a', sessionId: 's', costUsd: 0, provider: 'claude', turns: 1, durationMs: 1, inputTokens: 1, outputTokens: 1 },
      { type: 'text_delta', text: 'b' },
    ])
    const assistants = s.blocks.filter((b) => b.kind === 'assistant')
    expect(assistants).toHaveLength(2)
    // the first (pre-result) assistant is CLOSED so it renders markdown, not raw text
    expect((assistants[0] as { closed: boolean }).closed).toBe(true)
  })

  it('renders TodoWrite as a single todos block that updates in place', () => {
    const s = run([
      { type: 'tool_start', name: 'TodoWrite', toolId: 'td1' },
      { type: 'tool_end', name: 'TodoWrite', toolId: 'td1', summary: '', detail: { input: { todos: [{ content: 'A', status: 'pending' }] }, output: '' } },
      { type: 'tool_start', name: 'TodoWrite', toolId: 'td2' },
      { type: 'tool_end', name: 'TodoWrite', toolId: 'td2', summary: '', detail: { input: { todos: [{ content: 'A', status: 'completed' }] }, output: '' } },
    ])
    const todos = s.blocks.filter((b) => b.kind === 'todos')
    expect(todos).toHaveLength(1)
    expect(todos[0]).toEqual({ kind: 'todos', items: [{ content: 'A', status: 'completed' }] })
  })

  it('builds the panel from TaskCreate/TaskUpdate and suppresses their one-liners', () => {
    // 🧪 This SDK build drives the task list via Task* tools, not TodoWrite.
    const s = run([
      { type: 'tool_start', name: 'TaskCreate', toolId: 'c1' },
      { type: 'tool_end', name: 'TaskCreate', toolId: 'c1', summary: '', detail: { input: { subject: 'Step one', description: 'do one' }, output: { id: '1' } } },
      { type: 'tool_start', name: 'TaskCreate', toolId: 'c2' },
      { type: 'tool_end', name: 'TaskCreate', toolId: 'c2', summary: '', detail: { input: { subject: 'Step two', description: 'do two' }, output: { id: '2' } } },
      { type: 'tool_start', name: 'TaskUpdate', toolId: 'u1' },
      { type: 'tool_end', name: 'TaskUpdate', toolId: 'u1', summary: '', detail: { input: { taskId: '1', status: 'in_progress' }, output: {} } },
      { type: 'tool_start', name: 'TaskUpdate', toolId: 'u2' },
      { type: 'tool_end', name: 'TaskUpdate', toolId: 'u2', summary: '', detail: { input: { taskId: '1', status: 'completed' }, output: {} } },
    ])
    const todos = s.blocks.filter((b) => b.kind === 'todos')
    expect(todos).toHaveLength(1)
    expect(s.blocks.some((b) => b.kind === 'tool')).toBe(false) // Task* not rendered as tool lines
    expect((todos[0] as Extract<typeof todos[0], { kind: 'todos' }>).items).toEqual([
      { id: '1', content: 'Step one', status: 'completed' },
      { id: '2', content: 'Step two', status: 'pending' },
    ])
  })

  it('moves the todos panel to the latest activity, not its first appearance', () => {
    // The panel must render its CURRENT state in context (next to recent work),
    // not sit frozen at the top showing the final state above the steps. UAT A5.
    const s = run([
      { type: 'tool_end', name: 'TaskCreate', toolId: 'c1', summary: '', detail: { input: { subject: 'A' }, output: { id: '1' } } },
      { type: 'tool_start', name: 'Bash', toolId: 'b1' },
      { type: 'tool_end', name: 'Bash', toolId: 'b1', summary: 'ran', detail: { input: {}, output: 'ok' } },
      { type: 'tool_end', name: 'TaskUpdate', toolId: 'u1', summary: '', detail: { input: { taskId: '1', status: 'completed' }, output: {} } },
    ])
    const todoIdx = s.blocks.findIndex((b) => b.kind === 'todos')
    const bashIdx = s.blocks.findIndex((b) => b.kind === 'tool' && (b as { name: string }).name === 'Bash')
    expect(s.blocks.filter((b) => b.kind === 'todos')).toHaveLength(1) // still a single panel
    expect(todoIdx).toBeGreaterThan(bashIdx) // followed the work downward
  })

  it('falls back to creation-order ids when TaskCreate output has no id', () => {
    const s = run([
      { type: 'tool_end', name: 'TaskCreate', toolId: 'c1', summary: '', detail: { input: { subject: 'A' }, output: 'Created task 1' } },
      { type: 'tool_end', name: 'TaskUpdate', toolId: 'u1', summary: '', detail: { input: { taskId: '1', status: 'completed' }, output: {} } },
    ])
    const todos = s.blocks.filter((b) => b.kind === 'todos')
    expect((todos[0] as Extract<typeof todos[0], { kind: 'todos' }>).items).toEqual([
      { id: '1', content: 'A', status: 'completed' },
    ])
  })

  it('clear empties the blocks; reset seeds from transcript entries', () => {
    const seeded = reduceBlocks(initialBlockState(), {
      type: 'reset',
      entries: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'yo' }],
    })
    expect(seeded.blocks).toEqual([
      { kind: 'user', text: 'hi' },
      { kind: 'assistant', text: 'yo', closed: true },
    ])
    expect(reduceBlocks(seeded, { type: 'clear' }).blocks).toEqual([])
  })
})
