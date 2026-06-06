/**
 * Desk-side definitions for the M3.3b runtime-control pickers. Pure: no ink, no client.
 * A "picker command" (/model, /mode) opens a second-level menu of these choices; selecting
 * one POSTs /api/control. The model list is curated (the SDK has no "list models" call).
 */

/** A picker choice: the menu label (`name`) + the value sent to /api/control. `desc` is the hint. */
export interface ControlChoice {
  name: string
  desc: string
  value: string
}

export const MODEL_CHOICES: ControlChoice[] = [
  { name: 'Opus 4.8', desc: 'most capable', value: 'claude-opus-4-8' },
  { name: 'Sonnet 4.6', desc: 'balanced', value: 'claude-sonnet-4-6' },
  { name: 'Haiku 4.5', desc: 'fastest', value: 'claude-haiku-4-5-20251001' },
]

export const MODE_CHOICES: ControlChoice[] = [
  { name: 'Default', desc: 'ask before edits/commands', value: 'default' },
  { name: 'Accept-edits', desc: 'auto-accept file edits', value: 'acceptEdits' },
  { name: 'Plan', desc: 'plan only — no edits/commands', value: 'plan' },
]

/** Which control a picker command drives. */
export function actionForCommand(text: string): 'setModel' | 'setMode' | null {
  if (text === '/model') return 'setModel'
  if (text === '/mode') return 'setMode'
  return null
}

/** The value list for an EXACT picker command (`/model` / `/mode`), else null. */
export function menuForCommand(text: string): ControlChoice[] | null {
  if (text === '/model') return MODEL_CHOICES
  if (text === '/mode') return MODE_CHOICES
  return null
}
