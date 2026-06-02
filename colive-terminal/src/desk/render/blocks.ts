// src/desk/render/blocks.ts
import type { CoLiveEvent } from '../../core/events'
import type { TranscriptEntry } from '../client'

export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  /** Set for items sourced from TaskCreate/TaskUpdate (correlates updates by id). */
  id?: string
}

/**
 * Tools that feed the todos/tasks panel rather than rendering as their own tool
 * one-liner. 🧪 This SDK build (0.3.158) drives the agent's task list via
 * TaskCreate/TaskUpdate/TaskList (the model finds them via ToolSearch), NOT
 * TodoWrite — so the panel must consume both vocabularies. TaskList is a
 * read-only listing; we suppress its one-liner but don't mutate the panel from it.
 */
const PANEL_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList'])

/** One logical unit of the transcript. Each kind renders to ANSI rows (rows.ts). */
export type Block =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; closed: boolean }
  | { kind: 'tool'; toolId: string; name: string; summary?: string; detail?: { input: unknown; output: unknown } }
  | { kind: 'thinking'; text: string; closed: boolean }
  | { kind: 'todos'; items: TodoItem[] }
  | { kind: 'note'; text: string }

export interface BlockState {
  blocks: Block[]
  /** Index of the open assistant block (text_delta target), or -1. */
  openAssistant: number
  /** Index of the open thinking block (thinking_delta target), or -1. */
  openThinking: number
}

export const initialBlockState = (): BlockState => ({ blocks: [], openAssistant: -1, openThinking: -1 })

export type BlockAction =
  | { type: 'reset'; entries: TranscriptEntry[] }
  | { type: 'clear' }
  | { type: 'event'; event: CoLiveEvent }
  | { type: 'localUser'; text: string }
  | { type: 'note'; text: string }

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {}

/** Parse the TodoWrite input.todos into typed items (defensive). */
function parseTodos(input: unknown): TodoItem[] {
  const todos = rec(input).todos
  if (!Array.isArray(todos)) return []
  return todos.map((t) => {
    const r = rec(t)
    const status = r.status === 'in_progress' || r.status === 'completed' ? r.status : 'pending'
    return { content: typeof r.content === 'string' ? r.content : '', status }
  })
}

/** The current todos-panel items, or [] if no panel exists yet. */
function currentTodos(blocks: Block[]): TodoItem[] {
  const b = blocks.find((x) => x.kind === 'todos')
  return b ? (b as Extract<Block, { kind: 'todos' }>).items : []
}

/**
 * Set the single todos panel to `items`, repositioned to the END so it renders
 * its current state next to the most recent activity (like native), instead of
 * staying frozen at its first-appearance index — where the final all-done state
 * would otherwise show ABOVE the steps that produced it. UAT A5.
 */
function setTodos(blocks: Block[], items: TodoItem[]): Block[] {
  const next: Block[] = blocks.filter((b) => b.kind !== 'todos')
  next.push({ kind: 'todos', items })
  return next
}

/** Pull the created task's id out of TaskCreate's output, else use `fallback`. */
function taskIdFromOutput(output: unknown, fallback: string): string {
  const o = rec(output)
  for (const k of ['id', 'taskId', 'task_id']) {
    if (typeof o[k] === 'string') return o[k]
    if (typeof o[k] === 'number') return String(o[k])
  }
  const task = rec(o.task)
  if (typeof task.id === 'string') return task.id
  if (typeof task.id === 'number') return String(task.id)
  if (typeof output === 'string') {
    const m = output.match(/\b(\d+)\b/)
    if (m) return m[1]
  }
  return fallback
}

/** TaskCreate → append a pending item (id from output, else creation-order index). */
function applyTaskCreate(items: TodoItem[], detail?: { input: unknown; output: unknown }): TodoItem[] {
  const input = rec(detail?.input)
  const content =
    typeof input.subject === 'string' ? input.subject
    : typeof input.description === 'string' ? input.description
    : ''
  const id = taskIdFromOutput(detail?.output, String(items.length + 1))
  return [...items, { id, content, status: 'pending' }]
}

/** TaskUpdate → set status / delete the matching item by taskId. */
function applyTaskUpdate(items: TodoItem[], detail?: { input: unknown; output: unknown }): TodoItem[] {
  const input = rec(detail?.input)
  const taskId = input.taskId != null ? String(input.taskId) : ''
  const status = input.status
  const ti = items.findIndex((it) => it.id === taskId)
  if (ti < 0) return items
  if (status === 'deleted') return items.filter((_, i) => i !== ti)
  if (status === 'pending' || status === 'in_progress' || status === 'completed') {
    const copy = items.slice()
    copy[ti] = { ...copy[ti], status }
    return copy
  }
  return items
}

function entryToBlock(entry: TranscriptEntry): Block {
  if (entry.role === 'assistant') return { kind: 'assistant', text: entry.text, closed: true }
  if (entry.role === 'user') return { kind: 'user', text: entry.text }
  return { kind: 'note', text: `${entry.role}: ${entry.text}` }
}

export function reduceBlocks(state: BlockState, action: BlockAction): BlockState {
  switch (action.type) {
    case 'reset':
      return { blocks: action.entries.map(entryToBlock), openAssistant: -1, openThinking: -1 }
    case 'clear':
      return initialBlockState()
    case 'note':
      return { ...state, blocks: [...state.blocks, { kind: 'note', text: action.text }], openAssistant: -1, openThinking: -1 }
    case 'localUser':
      return { ...state, blocks: [...state.blocks, { kind: 'user', text: action.text }], openAssistant: -1, openThinking: -1 }
    case 'event':
      return applyEvent(state, action.event)
    default:
      return state
  }
}

/**
 * Mark the currently-open assistant + thinking blocks `closed: true`, so a finished
 * assistant renders markdown (rows.ts gates markdown on `closed`) and finished
 * thinking collapses to its stub. Pure — returns a new blocks array. Call this
 * whenever we move off an open block.
 */
function closeOpen(state: BlockState): Block[] {
  const next = state.blocks.slice()
  if (state.openAssistant >= 0 && next[state.openAssistant]?.kind === 'assistant') {
    const a = next[state.openAssistant] as Extract<Block, { kind: 'assistant' }>
    next[state.openAssistant] = { ...a, closed: true }
  }
  if (state.openThinking >= 0 && next[state.openThinking]?.kind === 'thinking') {
    const t = next[state.openThinking] as Extract<Block, { kind: 'thinking' }>
    next[state.openThinking] = { ...t, closed: true }
  }
  return next
}

function applyEvent(state: BlockState, event: CoLiveEvent): BlockState {
  const blocks = state.blocks
  switch (event.type) {
    case 'user_prompt':
      // close any open assistant/thinking from the prior turn before the new prompt
      return { blocks: [...closeOpen(state), { kind: 'user', text: event.text }], openAssistant: -1, openThinking: -1 }

    case 'text_delta': {
      const next = blocks.slice()
      if (state.openAssistant >= 0 && next[state.openAssistant]?.kind === 'assistant') {
        const open = next[state.openAssistant] as Extract<Block, { kind: 'assistant' }>
        next[state.openAssistant] = { ...open, text: open.text + event.text }
        return { ...state, blocks: next }
      }
      next.push({ kind: 'assistant', text: event.text, closed: false })
      return { ...state, blocks: next, openAssistant: next.length - 1, openThinking: -1 }
    }

    case 'thinking_delta': {
      const next = blocks.slice()
      if (state.openThinking >= 0 && next[state.openThinking]?.kind === 'thinking') {
        const open = next[state.openThinking] as Extract<Block, { kind: 'thinking' }>
        next[state.openThinking] = { ...open, text: open.text + event.text }
        return { ...state, blocks: next }
      }
      next.push({ kind: 'thinking', text: event.text, closed: false })
      return { ...state, blocks: next, openThinking: next.length - 1, openAssistant: -1 }
    }

    case 'status': {
      // close the open thinking block when thinking ends; close assistant on text_end
      if (event.state === 'think_end' && state.openThinking >= 0) {
        const next = blocks.slice()
        const open = next[state.openThinking] as Extract<Block, { kind: 'thinking' }>
        next[state.openThinking] = { ...open, closed: true }
        return { ...state, blocks: next, openThinking: -1 }
      }
      return state
    }

    case 'tool_start': {
      if (PANEL_TOOLS.has(event.name)) return state // todos/tasks panel is built on tool_end
      // close the open assistant/thinking first so a pre-tool answer segment renders markdown
      return { blocks: [...closeOpen(state), { kind: 'tool', toolId: event.toolId, name: event.name }], openAssistant: -1, openThinking: -1 }
    }

    case 'tool_end': {
      if (PANEL_TOOLS.has(event.name)) {
        const had = blocks.some((b) => b.kind === 'todos')
        let items = currentTodos(blocks)
        if (event.name === 'TodoWrite') items = parseTodos(event.detail?.input)
        else if (event.name === 'TaskCreate') items = applyTaskCreate(items, event.detail)
        else if (event.name === 'TaskUpdate') items = applyTaskUpdate(items, event.detail)
        // TaskList: read-only listing — leave the panel unchanged.
        if (!had && items.length === 0) {
          return { ...state, openAssistant: -1, openThinking: -1 } // nothing to show yet
        }
        return { ...state, blocks: setTodos(blocks, items), openAssistant: -1, openThinking: -1 }
      }
      // fold into the matching open tool block (keyed by toolId)
      const next = blocks.slice()
      const idx = next.findIndex((b) => b.kind === 'tool' && b.toolId === event.toolId)
      const folded: Block = { kind: 'tool', toolId: event.toolId, name: event.name, summary: event.summary, detail: event.detail }
      if (idx >= 0) next[idx] = folded
      else next.push(folded)
      return { ...state, blocks: next, openAssistant: -1, openThinking: -1 }
    }

    case 'result':
      // close the open assistant + thinking so the finished answer renders markdown
      // (rows.ts gates markdown on `closed`) and thinking collapses to its stub.
      return { ...state, blocks: closeOpen(state), openAssistant: -1, openThinking: -1 }

    case 'notification':
      return { ...state, blocks: [...blocks, { kind: 'note', text: `${event.title}: ${event.message}` }], openAssistant: -1, openThinking: -1 }

    case 'error':
      return { ...state, blocks: [...blocks, { kind: 'note', text: `error: ${event.message}` }], openAssistant: -1, openThinking: -1 }

    default:
      // running_stats / permission_* / user_question / task_progress: handled outside the transcript
      return state
  }
}
