// src/desk/record.ts
import { appendFileSync, readFileSync } from 'node:fs'
import type { HubClient } from './client'
import type { CoLiveEvent } from '../core/events'

/** Receives every event the desk gets — used to record a live session. */
export type EventSink = (event: CoLiveEvent) => void

/**
 * Wrap a {@link HubClient} so every event delivered to a subscriber is ALSO
 * passed to `sink` (Tier-3 record-replay: capture a real session to a fixture the
 * preview harness can replay deterministically). A pure decorator — every other
 * method passes straight through. The sink is best-effort: a throw (e.g. disk
 * full) is swallowed so recording can never break the live UI.
 */
export function recordingClient(client: HubClient, sink: EventSink): HubClient {
  return {
    ...client,
    subscribe(sessionId, onEvent, opts) {
      return client.subscribe(
        sessionId,
        (event) => {
          try {
            sink(event)
          } catch {
            /* recording is best-effort; never disturb the stream */
          }
          onEvent(event)
        },
        opts,
      )
    },
  }
}

/** An {@link EventSink} that appends each event to `path` as one JSON line. */
export function fileEventSink(path: string): EventSink {
  return (event) => appendFileSync(path, `${JSON.stringify(event)}\n`)
}

/** Load a recorded JSONL fixture back into events (blank lines ignored). */
export function loadEvents(path: string): CoLiveEvent[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as CoLiveEvent)
}
