/**
 * Per-project command history for the desk composer.
 *
 * Two layers:
 *  - PURE: `appendEntry` (consecutive-dedup + cap) and a small `prev`/`next`
 *    navigation state-machine. No I/O — fully unit-tested.
 *  - ADAPTER: a `HistoryStore` interface (load/append by project key) with a
 *    real `fileHistoryStore` (JSONL under ~/.colive/history) and an in-memory
 *    `memoryHistoryStore` test double. The store is dependency-injected into
 *    the App, exactly like the HubClient — so tests never touch disk.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const HISTORY_CAP = 500

/** Append `entry` to chronological history (newest last); dedup consecutive; cap. */
export function appendEntry(entries: string[], entry: string, cap = HISTORY_CAP): string[] {
  const e = entry.trim()
  if (e === '') return entries
  if (entries.length > 0 && entries[entries.length - 1] === e) return entries
  const next = [...entries, e]
  return next.length > cap ? next.slice(next.length - cap) : next
}

/** Navigation cursor over a snapshot of history. `index === entries.length` ⇒ editing the draft. */
export interface HistoryNav {
  entries: string[]
  index: number
  /** The in-progress text stashed when the user first presses ↑. */
  draft: string | null
}

export const initNav = (entries: string[]): HistoryNav => ({
  entries,
  index: entries.length,
  draft: null,
})

/** ↑ — move toward older entries. Stashes the live draft on the first press. */
export function prev(nav: HistoryNav, currentText: string): { nav: HistoryNav; text: string } {
  if (nav.entries.length === 0) return { nav, text: currentText }
  const draft = nav.index === nav.entries.length ? currentText : nav.draft
  const index = Math.max(0, nav.index - 1)
  return { nav: { ...nav, index, draft }, text: nav.entries[index]! }
}

/** ↓ — move toward newer entries; past the newest, restore the stashed draft. */
export function next(nav: HistoryNav, currentText: string): { nav: HistoryNav; text: string } {
  if (nav.index >= nav.entries.length) return { nav, text: currentText }
  const index = nav.index + 1
  if (index >= nav.entries.length) {
    return { nav: { ...nav, index: nav.entries.length }, text: nav.draft ?? '' }
  }
  return { nav: { ...nav, index }, text: nav.entries[index]! }
}

/** Persistence boundary — injected into the App (DI, like HubClient). */
export interface HistoryStore {
  load(key: string): string[]
  append(key: string, entry: string): void
}

/** In-memory store for tests. */
export function memoryHistoryStore(): HistoryStore {
  const byKey = new Map<string, string[]>()
  return {
    load: (key) => byKey.get(key) ?? [],
    append: (key, entry) => byKey.set(key, appendEntry(byKey.get(key) ?? [], entry)),
  }
}

const sanitize = (key: string): string => key.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 120) || 'default'

/**
 * JSONL-on-disk store. One file per project key under ~/.colive/history. Each
 * line is a JSON-encoded string. Reads apply dedup/cap defensively; the append
 * is best-effort (a failed write must never crash the composer).
 */
export function fileHistoryStore(baseDir = join(homedir(), '.colive', 'history')): HistoryStore {
  const fileFor = (key: string): string => join(baseDir, `${sanitize(key)}.jsonl`)
  return {
    load(key) {
      try {
        const raw = readFileSync(fileFor(key), 'utf8')
        const out: string[] = []
        for (const line of raw.split('\n')) {
          if (line.trim() === '') continue
          try {
            const v = JSON.parse(line)
            if (typeof v === 'string') out.push(v)
          } catch {
            /* skip a corrupt line */
          }
        }
        return out.slice(-HISTORY_CAP)
      } catch {
        return []
      }
    },
    append(key, entry) {
      const e = entry.trim()
      if (e === '') return
      try {
        mkdirSync(baseDir, { recursive: true })
        appendFileSync(fileFor(key), JSON.stringify(e) + '\n', 'utf8')
      } catch {
        /* best-effort — never crash the UI on a history write */
      }
    },
  }
}
