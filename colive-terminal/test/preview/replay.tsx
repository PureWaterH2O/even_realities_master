/**
 * Preview harness — drive the REAL desk App against a scripted event stream and
 * capture the exact rendered frames, so the desk can be iterated on WITHOUT a
 * live Hub, a model, or hardware. This is the controller's "see it before UAT"
 * loop: render → read the frame → fix → repeat.
 *
 * - `ReplayClient` is a HubClient whose subscribe() captures onEvent; the harness
 *   pushes a fixture sequence through it (same seam the unit tests use).
 * - `capture()` mounts App, plays events, runs a script of keystrokes, and returns
 *   labelled frames (raw ANSI + ANSI-stripped layout).
 * - Frames are written to `preview-out/` when PREVIEW=1 so they can be opened/read;
 *   without it the file still runs as a smoke test (no disk writes).
 */
import { act } from 'react'
import { render } from 'ink-testing-library'
import { App } from '../../src/desk/app'
import type { AppConfig } from '../../src/desk/app'
import { stripAnsi } from '../../src/desk/render/ansi'
import { reduceBlocks, initialBlockState } from '../../src/desk/render/blocks'
import { flattenRows } from '../../src/desk/render/rows'
import type {
  HubClient,
  SubscriptionHandle,
  TranscriptEntry,
} from '../../src/desk/client'
import type { CoLiveEvent } from '../../src/core/events'

/** A HubClient that replays a fixture: the harness emits, the App renders. */
export function makeReplayClient(transcript: TranscriptEntry[] = []): HubClient & {
  emit(e: CoLiveEvent): void
} {
  let onEvent: ((e: CoLiveEvent) => void) | undefined
  return {
    emit(e) {
      onEvent?.(e)
    },
    subscribe(_sessionId, cb) {
      onEvent = cb
      const handle = (() => {}) as SubscriptionHandle & (() => void)
      handle.close = handle
      return handle
    },
    async sendPrompt(args) {
      return { sessionId: args.sessionId }
    },
    async respondPermission() {},
    async respondQuestion() {},
    async interrupt() {},
    async fetchTranscript() {
      return transcript
    },
    async setControl() {},
    async getInfo() {
      return { model: 'claude-opus-4-8' }
    },
  }
}

/**
 * Render the WHOLE transcript (no viewport clipping) by running events through
 * the same reducer + flatten the App uses. Use this to eyeball everything at
 * once — the live App only shows the last screenful. Pure: no React/PTY.
 */
export function flattenAll(
  events: CoLiveEvent[],
  { width = 100, verbose = false }: { width?: number; verbose?: boolean } = {},
): Frame {
  const state = events.reduce(
    (s, event) => reduceBlocks(s, { type: 'event', event }),
    initialBlockState(),
  )
  const ansi = flattenRows(state.blocks, { width, verbose }).join('\n')
  return { label: verbose ? 'full-verbose' : 'full', ansi, plain: stripAnsi(ansi) }
}

/** Flush effects / microtasks / a macrotask tick inside act() so state settles. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
  })
}

/** A captured frame: a label + the raw ANSI string + an ANSI-stripped layout. */
export interface Frame {
  label: string
  ansi: string
  plain: string
}

/** A step in a capture script: emit an event, send a keystroke, or snapshot. */
export type Step =
  | { kind: 'emit'; event: CoLiveEvent }
  | { kind: 'key'; bytes: string }
  | { kind: 'snap'; label: string }

export const emit = (event: CoLiveEvent): Step => ({ kind: 'emit', event })
export const key = (bytes: string): Step => ({ kind: 'key', bytes })
export const snap = (label: string): Step => ({ kind: 'snap', label })

/** Common key byte sequences. */
export const KEYS = {
  ctrlO: '\x0f',
  pageUp: '\x1b[5~',
  pageDown: '\x1b[6~',
  up: '\x1b[A',
  down: '\x1b[B',
  end: '\x1b[F',
} as const

/**
 * Mount App with a replay client, run `steps` in order, and return every frame
 * captured by a `snap` step. `sessionId` seeds an existing session so no prompt
 * round-trip is needed.
 */
export async function capture(steps: Step[], sessionId = 's-preview', config?: AppConfig): Promise<Frame[]> {
  const client = makeReplayClient()
  const inst = render(<App client={client} sessionId={sessionId} config={config} />)
  const frames: Frame[] = []
  try {
    await settle()
    for (const step of steps) {
      if (step.kind === 'emit') {
        act(() => client.emit(step.event))
        await settle()
      } else if (step.kind === 'key') {
        act(() => inst.stdin.write(step.bytes))
        await settle()
        // ink debounces a LONE Esc (it waits to see if an escape SEQUENCE follows
        // before reporting `escape`); let that timer fire so the keybinding runs.
        if (step.bytes === '\x1b') await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
      } else {
        const ansi = inst.lastFrame() ?? ''
        frames.push({ label: step.label, ansi, plain: stripAnsi(ansi) })
      }
    }
  } finally {
    inst.unmount()
  }
  return frames
}
