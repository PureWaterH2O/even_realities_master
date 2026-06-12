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
import { recordingClient, fileEventSink } from './desk/record'
import { App } from './desk/app'
import { readRemoteConfig, resolveRemoteHost } from './remote/config'
import { detectTailscale, type ShellExec } from './remote/tailscale'
import { runSetup, createDefaultIO } from './remote/setup'
import { fileHistoryStore } from './desk/input/history'
import { MOUSE_ON, MOUSE_OFF, ALT_SCROLL_OFF, ALT_SCROLL_ON } from './desk/mouse-mode'

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
 *
 * When `--host` is NOT passed, reads the remote config and requires Tailscale
 * to be running. The server binds to `0.0.0.0` and advertises the Tailscale
 * address in the QR/banner so the glasses connect through the WireGuard tunnel.
 * `exec` is injectable for tests.
 */
export async function runServe(
  argv: string[],
  env: ConfigEnv = process.env,
  exec?: ShellExec,
): Promise<RunningServer> {
  const args = parseServeArgs(argv)
  const config = resolveConfig(env, args)

  if (args.host !== undefined) {
    return startServer(config)
  }

  const remoteConfig = await readRemoteConfig()
  if (remoteConfig === null) {
    throw new Error(
      'No remote config found. Run `colive setup` first, or pass `--host <ip>` manually.',
    )
  }

  const tsState = await detectTailscale(exec)
  if (tsState.state !== 'running') {
    const hint =
      tsState.state === 'not-installed'
        ? 'Tailscale is not installed. Run `colive setup` for installation guidance.'
        : `Tailscale is not connected (state: ${tsState.backendState}). Run \`tailscale up\` or open the menu bar app.`
    throw new Error(hint)
  }

  const advertiseHost = resolveRemoteHost(remoteConfig)
  return startServer({ ...config, host: '0.0.0.0', advertiseHost })
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
  /** When set, append every received event to this JSONL file (Tier-3 record). */
  COLIVE_RECORD?: string
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
  const base = createHubClient({ baseUrl: conn.baseUrl, token: conn.token })
  // Tier-3 record: with COLIVE_RECORD set, tee every event to a JSONL fixture the
  // preview harness can replay deterministically (catches Core data-shape bugs).
  const client =
    env.COLIVE_RECORD !== undefined && env.COLIVE_RECORD !== ''
      ? recordingClient(base, fileEventSink(env.COLIVE_RECORD))
      : base

  // Full-screen via the terminal's ALTERNATE SCREEN BUFFER (like vim/less/htop).
  // Entered here at the entry point on the real process.stdout — NOT in a React
  // effect, where ink's stdout wrapper hid the TTY check and it silently no-op'd.
  // Why it matters: in the alt buffer there is no scrollback, so VS Code's
  // integrated terminal stops capturing PageUp/PageDown for its own scrolling and
  // the keys reach the app; streamed frames can't leak into the host scrollback
  // either. The shell is restored on every exit path. Skipped when stdout is not a
  // TTY (tests / pipes) so nothing changes there.
  const isTTY = Boolean((process.stdout as { isTTY?: boolean }).isTTY)
  // enter alt-screen + clear + home, then DISABLE alternate scroll (1007l) so the
  // wheel/trackpad reports as SGR instead of being translated to ↑/↓ arrow keys
  // (which would drive the composer — see mouse-mode.ts), then enable SGR mouse
  // reporting so the wheel is delivered as distinct \x1b[<..M reports (M3.2A reads
  // them off ink's internal 'input' channel). 1000h = button tracking (incl.
  // wheel), 1006h = SGR encoding. Skipped when not a TTY (tests/pipes).
  if (isTTY) process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H' + ALT_SCROLL_OFF + MOUSE_ON)

  const instance = render(
    createElement(App, {
      client,
      sessionId: conn.sessionId,
      // cwd: NEW sessions must run where the USER launched the desk (like
      // native `claude`), not wherever serve was started — without it the
      // Core falls back to serve's projectDir and the desk silently works in
      // the wrong directory (while the banner shows the desk's own cwd).
      config: { historyStore: fileHistoryStore(), historyKey: conn.baseUrl, cwd: process.cwd() },
    }),
  )

  if (isTTY) {
    const leaveAlt = (): void => {
      try {
        // disable SGR mouse + RESTORE alternate scroll BEFORE leaving the alt-screen,
        // then restore the primary screen (so the user's shell keeps normal wheel scroll)
        process.stdout.write(MOUSE_OFF + ALT_SCROLL_ON + '\x1b[?1049l')
      } catch {
        /* stream already closed — nothing to restore */
      }
    }
    process.once('exit', leaveAlt) // backstop for crashes / process.exit
    if (instance.waitUntilExit) void instance.waitUntilExit().then(leaveAlt, leaveAlt)
  }
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
    case 'setup': {
      const io = createDefaultIO()
      try {
        await runSetup({ io })
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err instanceof Error ? err.message : String(err))
        process.exitCode = 1
      } finally {
        io.close()
      }
      return
    }
    default:
      // eslint-disable-next-line no-console
      console.error('Usage: colive <serve|desk|setup> [options]')
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
