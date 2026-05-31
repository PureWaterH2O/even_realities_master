/**
 * Co-Live Terminal CLI entry.
 *
 * Subcommands:
 *   - `colive serve [--model --permission-mode --host --port --project-dir]`
 *       Resolve config (args > env > M0 defaults) and start the Client Hub.
 *   - `colive desk  [--host --port --token --session]`
 *       Connect to a running Hub as a thin client and render the ink TUI.
 *
 * This module is import-safe: importing it never starts a server and never
 * renders the TUI. The CLI dispatch runs only when the file is the process
 * entrypoint (the guard at the bottom compares import.meta.url to argv[1]).
 */
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { render as inkRender } from 'ink'
import { resolveConfig, type ConfigArgs, type ConfigEnv } from './core/config'
import { startServer, type RunningServer } from './hub/server'
import { createHubClient } from './desk/client'
import { App } from './desk/app'

/**
 * Parse `colive serve` flags into a {@link ConfigArgs}.
 *
 * Pure: maps only the public flags and leaves unset keys undefined so
 * resolveConfig can apply env/defaults. `--port` is coerced to a number and
 * validated (a non-numeric value throws — fail fast over silently dropping it).
 * permissionMode is passed through as a string; resolveConfig validates it.
 */
export function parseServeArgs(argv: string[]): ConfigArgs {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      model: { type: 'string' },
      'permission-mode': { type: 'string' },
      host: { type: 'string' },
      port: { type: 'string' },
      'project-dir': { type: 'string' },
    },
  })

  const args: ConfigArgs = {}
  if (values.model !== undefined) args.model = values.model
  if (values['permission-mode'] !== undefined) {
    // Cast: the SDK PermissionMode union is validated downstream by resolveConfig.
    args.permissionMode = values['permission-mode'] as ConfigArgs['permissionMode']
  }
  if (values.host !== undefined) args.host = values.host
  if (values.port !== undefined) args.port = parsePort(values.port)
  if (values['project-dir'] !== undefined) args.projectDir = values['project-dir']

  return args
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10)
  if (!Number.isInteger(port) || String(port) !== value.trim() || port < 0 || port > 65535) {
    throw new Error(`Invalid --port "${value}". Expected an integer in [0, 65535].`)
  }
  return port
}

/**
 * Run the `serve` subcommand: parse flags, resolve config, start the server.
 * Returns the {@link RunningServer} handle so callers/tests own the lifecycle.
 * `env` defaults to process.env (overridable in tests).
 */
export function runServe(argv: string[], env: ConfigEnv = process.env): Promise<RunningServer> {
  const args = parseServeArgs(argv)
  const config = resolveConfig(env, args)
  return startServer(config)
}

/** Parsed `colive desk` flags. All optional; env/defaults fill the gaps. */
export interface DeskArgs {
  host?: string
  port?: number
  token?: string
  /** Attach to a specific existing session (omit to start a new one). */
  session?: string
}

/**
 * Parse `colive desk` flags. Mirrors {@link parseServeArgs}: only public flags,
 * unset keys left undefined, `--port` coerced + validated (reusing parsePort).
 */
export function parseDeskArgs(argv: string[]): DeskArgs {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      host: { type: 'string' },
      port: { type: 'string' },
      token: { type: 'string' },
      session: { type: 'string' },
    },
  })

  const args: DeskArgs = {}
  if (values.host !== undefined) args.host = values.host
  if (values.port !== undefined) args.port = parsePort(values.port)
  if (values.token !== undefined) args.token = values.token
  if (values.session !== undefined) args.session = values.session
  return args
}

/** Env vars the desk client reads (shares HOST/PORT/BRIDGE_TOKEN with the Hub). */
export interface DeskEnv {
  HOST?: string
  PORT?: string
  BRIDGE_TOKEN?: string
}

/** The resolved connection params for the desk client. */
export interface DeskConnection {
  baseUrl: string
  token: string
  sessionId: string | undefined
}

const DESK_DEFAULT_HOST = '127.0.0.1'
const DESK_DEFAULT_PORT = 3456

/**
 * Resolve the desk connection from args > env > M0 defaults. The desk attaches
 * to a *running* Hub, so it must present that Hub's bearer token — there is no
 * sensible default to generate, so a missing token is a hard error (precedence:
 * --token over BRIDGE_TOKEN).
 */
export function buildDeskClient(args: DeskArgs, env: DeskEnv = process.env): DeskConnection {
  const host = args.host ?? env.HOST ?? DESK_DEFAULT_HOST
  const port =
    args.port ?? (env.PORT !== undefined ? parsePort(env.PORT) : DESK_DEFAULT_PORT)
  const token = args.token ?? env.BRIDGE_TOKEN
  if (token === undefined || token === '') {
    throw new Error(
      'colive desk: no Hub token. Pass --token <t> or set BRIDGE_TOKEN to the token printed by `colive serve`.',
    )
  }
  return { baseUrl: `http://${host}:${port}`, token, sessionId: args.session }
}

/** The ink render contract we depend on (injectable so tests skip a real TTY). */
export type RenderFn = (element: ReturnType<typeof createElement>) => {
  unmount: () => void
  waitUntilExit?: () => Promise<void>
}

/**
 * Run the `desk` subcommand: resolve the connection, build a real HubClient, and
 * render the ink {@link App}. `render` is injectable (defaults to ink's render)
 * so tests can drive it without a TTY. Throws on a missing token (no silent
 * no-op) — the dispatcher turns that into a friendly message + non-zero exit.
 */
export function runDesk(
  argv: string[],
  env: DeskEnv = process.env,
  render: RenderFn = inkRender as unknown as RenderFn,
): void {
  const conn = buildDeskClient(parseDeskArgs(argv), env)
  const client = createHubClient({ baseUrl: conn.baseUrl, token: conn.token })
  render(createElement(App, { client, sessionId: conn.sessionId }))
}

/**
 * Top-level dispatch. `[subcommand, ...rest]`. Unknown/missing subcommands print
 * usage and exit non-zero. `serve` keeps the process alive (the server is
 * listening); we never resolve its promise back to the caller here.
 */
export async function main(argv: string[]): Promise<void> {
  const [subcommand, ...rest] = argv

  switch (subcommand) {
    case 'serve':
      await runServe(rest)
      return
    case 'desk':
      try {
        runDesk(rest)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err instanceof Error ? err.message : String(err))
        process.exitCode = 1
      }
      return
    default:
      // eslint-disable-next-line no-console
      console.error('Usage: colive <serve|desk> [options]')
      process.exitCode = 1
      return
  }
}

// Entrypoint guard: only dispatch the CLI when this file is the process entry,
// not when it is imported (e.g. by a test). Comparing the file URL of argv[1]
// to import.meta.url is the ESM-safe equivalent of `require.main === module`.
const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isEntrypoint) {
  main(process.argv.slice(2)).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
}
