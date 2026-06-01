import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface RemoteConfig {
  tailscaleHostname: string
  tailscaleIp: string
  prefer: 'hostname' | 'ip'
}

const CONFIG_DIR_NAME = '.config/colive'
const CONFIG_FILE_NAME = 'remote.json'

function configPath(configDir?: string): string {
  return join(configDir ?? join(homedir(), CONFIG_DIR_NAME), CONFIG_FILE_NAME)
}

export async function readRemoteConfig(configDir?: string): Promise<RemoteConfig | null> {
  const path = configPath(configDir)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return null
  }

  const data = JSON.parse(raw)
  if (
    typeof data.tailscaleHostname !== 'string' ||
    typeof data.tailscaleIp !== 'string' ||
    (data.prefer !== 'hostname' && data.prefer !== 'ip')
  ) {
    throw new Error(`Invalid remote config at ${path}: missing or malformed fields`)
  }

  return {
    tailscaleHostname: data.tailscaleHostname,
    tailscaleIp: data.tailscaleIp,
    prefer: data.prefer,
  }
}

export async function writeRemoteConfig(config: RemoteConfig, configDir?: string): Promise<string> {
  const dir = configDir ?? join(homedir(), CONFIG_DIR_NAME)
  await mkdir(dir, { recursive: true })
  const path = join(dir, CONFIG_FILE_NAME)
  await writeFile(path, JSON.stringify(config, null, 2) + '\n', 'utf8')
  return path
}

export function resolveRemoteHost(config: RemoteConfig): string {
  if (config.prefer === 'hostname' && config.tailscaleHostname !== '') {
    return config.tailscaleHostname
  }
  return config.tailscaleIp
}
