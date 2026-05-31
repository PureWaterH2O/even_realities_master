/**
 * Co-Live Terminal CLI entry.
 *
 * Subcommands:
 *   - `colive serve [--model --permission-mode --host --port --project-dir]`
 *       Resolve config (args > env > M0 defaults) and start the Client Hub.
 *   - `colive desk`   — Phase 3 (the thin desk client). Stubbed for now.
 *
 * This module is import-safe: importing it never starts a server. The CLI
 * dispatch runs only when the file is the process entrypoint (the guard at the
 * bottom compares import.meta.url to process.argv[1]).
 */
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { resolveConfig, type ConfigArgs, type ConfigEnv } from './core/config'
import { startServer, type RunningServer } from './hub/server'

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

/** The `desk` subcommand (Phase 3). Stubbed until the thin desk client lands. */
export function runDesk(): void {
  // eslint-disable-next-line no-console
  console.log('colive desk: not yet implemented (Phase 3 — thin desk client).')
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
      runDesk()
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
