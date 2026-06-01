/**
 * Resolves the Session Core's runtime config from environment + CLI args.
 *
 * Owns the values the stock even-terminal bridge hard-codes (M0 ground truth):
 *   - model              default 'claude-opus-4-8'
 *   - permissionMode     default 'default'
 *   - settingSources     default []        (kills a ~20s/turn SessionStart-hook
 *                                            latency + a HUD leak)
 *   - projectDir         realpath(cwd)     (/tmp -> /private/tmp symlink gotcha)
 * plus the server's host / port / token.
 *
 * Precedence: args override env override default.
 */
import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import type { PermissionMode, SettingSource } from '@anthropic-ai/claude-agent-sdk'

/** Env vars this resolver reads. All optional. */
export interface ConfigEnv {
  MODEL?: string
  PERMISSION_MODE?: string
  HOST?: string
  PORT?: string
  BRIDGE_TOKEN?: string
  PROJECT_DIR?: string
}

/** CLI/programmatic overrides. All optional; each wins over env + default. */
export interface ConfigArgs {
  model?: string
  permissionMode?: PermissionMode
  settingSources?: SettingSource[]
  host?: string
  port?: number
  token?: string
  projectDir?: string
}

/** Fully-resolved config consumed by session.ts and the server. */
export interface ResolvedConfig {
  model: string
  permissionMode: PermissionMode
  settingSources: SettingSource[]
  host: string
  port: number
  token: string
  projectDir: string
  advertiseHost?: string
}

/** The complete set of valid SDK PermissionMode values. */
const PERMISSION_MODES: readonly PermissionMode[] = [
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
  'dontAsk',
  'auto',
]

function asPermissionMode(value: string): PermissionMode {
  if ((PERMISSION_MODES as readonly string[]).includes(value)) {
    return value as PermissionMode
  }
  throw new Error(
    `Invalid permissionMode "${value}". Expected one of: ${PERMISSION_MODES.join(', ')}.`,
  )
}

const DEFAULTS = {
  model: 'claude-opus-4-8',
  permissionMode: 'default' as PermissionMode,
  host: '127.0.0.1',
  port: 3456,
} as const

/**
 * Resolve config. `args` override `env` override built-in defaults.
 * - PORT is parsed from string to number.
 * - permissionMode (from env) is validated against the SDK's PermissionMode set.
 * - token is generated (random) when neither args nor env supply one.
 * - projectDir is realpath-resolved.
 */
export function resolveConfig(env: ConfigEnv, args: ConfigArgs): ResolvedConfig {
  const model = args.model ?? env.MODEL ?? DEFAULTS.model

  const permissionMode =
    args.permissionMode ??
    (env.PERMISSION_MODE !== undefined
      ? asPermissionMode(env.PERMISSION_MODE)
      : DEFAULTS.permissionMode)

  // settingSources is owned, not env-driven (M0): default [] unless args override.
  const settingSources = args.settingSources ?? []

  const host = args.host ?? env.HOST ?? DEFAULTS.host

  const port = args.port ?? (env.PORT !== undefined ? parsePort(env.PORT) : DEFAULTS.port)

  const token = args.token ?? env.BRIDGE_TOKEN ?? randomUUID().replace(/-/g, '')

  const rawProjectDir = args.projectDir ?? env.PROJECT_DIR ?? process.cwd()
  const projectDir = realpathSync(rawProjectDir)

  return { model, permissionMode, settingSources, host, port, token, projectDir }
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT "${value}". Expected an integer in [0, 65535].`)
  }
  return port
}
