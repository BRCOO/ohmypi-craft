import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { CliRpcClient } from '../../apps/cli/src/client.ts'

const ROOT_DIR = join(import.meta.dir, '..', '..')

export interface RunnerOptions {
  exe: string
  timeoutMs: number
  sendTimeoutMs: number
  keepArtifacts: boolean
  runInstallation: boolean
  scenario?: string
}

export interface ScenarioResult {
  name: string
  status: 'passed' | 'failed' | 'skipped'
  durationMs: number
  output?: string
  error?: string
  evidence?: string[]
}

export interface SmokeContext {
  exe: string
  runRoot: string
  configDir: string
  workspaceDir: string
  headlessFile: string
  logsDir: string
  screenshotsDir: string
  child?: ChildProcessWithoutNullStreams & { stdoutTail?: string; stderrTail?: string }
  client?: CliRpcClient
}

export interface HeadlessInfo {
  url: string
  token: string
}

export interface Workspace {
  id: string
}

export interface Session {
  id: string
}

export function defaultPackagedExe(): string {
  if (process.platform === 'win32') {
    return join(ROOT_DIR, 'apps', 'electron', 'release', 'win-unpacked', 'Oh My Pi.exe')
  }
  if (process.platform === 'darwin') {
    return join(ROOT_DIR, 'apps', 'electron', 'release', 'mac', 'Oh My Pi.app', 'Contents', 'MacOS', 'Oh My Pi')
  }
  return join(ROOT_DIR, 'apps', 'electron', 'release', 'linux-unpacked', 'oh-my-pi')
}

export function parseHeadlessInfo(raw: string): HeadlessInfo {
  const pairs = new Map<string, string>()
  for (const line of raw.split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index <= 0) continue
    pairs.set(line.slice(0, index), line.slice(index + 1))
  }

  const url = pairs.get('CRAFT_SERVER_URL')
  const token = pairs.get('CRAFT_SERVER_TOKEN')
  if (!url || !token) {
    throw new Error('Headless connection file did not contain CRAFT_SERVER_URL and CRAFT_SERVER_TOKEN')
  }
  return { url, token }
}

export async function waitForHeadlessInfo(filePath: string, timeoutMs: number): Promise<HeadlessInfo> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      return parseHeadlessInfo(await readFile(filePath, 'utf8'))
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }

  throw new Error(`Timed out waiting for headless connection file (${filePath}): ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

export async function createSmokeContext(exe: string): Promise<SmokeContext> {
  const runRoot = join(ROOT_DIR, '.tmp', `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const configDir = join(runRoot, 'config')
  const workspaceDir = join(runRoot, 'workspace')
  const headlessFile = join(runRoot, 'headless.env')
  const logsDir = join(runRoot, 'logs')
  const screenshotsDir = join(runRoot, 'screenshots')

  await mkdir(configDir, { recursive: true })
  await mkdir(workspaceDir, { recursive: true })
  await mkdir(logsDir, { recursive: true })
  await mkdir(screenshotsDir, { recursive: true })

  return {
    exe: resolve(exe),
    runRoot,
    configDir,
    workspaceDir,
    headlessFile,
    logsDir,
    screenshotsDir,
  }
}

export function spawnPackagedApp(
  ctx: SmokeContext,
  extraEnv?: Record<string, string>,
): ChildProcessWithoutNullStreams & { stdoutTail?: string; stderrTail?: string } {
  const exe = ctx.exe
  if (!existsSync(exe)) {
    throw new Error(`Packaged Electron app not found: ${exe}`)
  }

  const appName = `Oh My Pi Smoke ${Date.now()}`
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    CRAFT_HEADLESS: '1',
    CRAFT_CONFIG_DIR: ctx.configDir,
    CRAFT_HEADLESS_LOG_FILE: ctx.headlessFile,
    CRAFT_IS_PACKAGED: 'true',
    CRAFT_APP_NAME: appName,
    CRAFT_RPC_PORT: '0',
    NO_UPDATE_NOTIFIER: '1',
    ELECTRON_ENABLE_LOGGING: '1',
    ELECTRON_ENABLE_STACK_DUMPING: '1',
    ...extraEnv,
  }

  const child = spawn(exe, [], {
    cwd: dirname(exe),
    env,
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams & { stdoutTail?: string; stderrTail?: string }

  let stdoutTail = ''
  let stderrTail = ''
  child.stdout.on('data', chunk => {
    stdoutTail = `${stdoutTail}${String(chunk)}`.slice(-4096)
    child.stdoutTail = stdoutTail
  })
  child.stderr.on('data', chunk => {
    stderrTail = `${stderrTail}${String(chunk)}`.slice(-4096)
    child.stderrTail = stderrTail
  })

  ctx.child = child
  return child
}

export async function connectClient(ctx: SmokeContext, timeoutMs: number): Promise<CliRpcClient> {
  const info = await waitForHeadlessInfo(ctx.headlessFile, timeoutMs)
  const client = new CliRpcClient(info.url, {
    token: info.token,
    requestTimeout: 60_000,
    connectTimeout: 30_000,
  })
  await client.connect()
  ctx.client = client
  return client
}

export async function createSmokeWorkspace(client: CliRpcClient, workspaceDir: string): Promise<string> {
  const workspace = await client.invoke('workspaces:create', workspaceDir, 'smoke-workspace') as Workspace
  await client.invoke('window:switchWorkspace', workspace.id).catch(() => {})
  return workspace.id
}

export async function createSmokeSession(client: CliRpcClient, workspaceId: string, name: string): Promise<string> {
  const session = await client.invoke('sessions:create', workspaceId, {
    permissionMode: 'allow-all',
    name,
  }) as Session
  return session.id
}

export async function stopApp(child: ChildProcessWithoutNullStreams | undefined): Promise<void> {
  if (!child) return
  const hasExited = () => child.exitCode !== null || child.signalCode !== null
  const waitForExit = async (timeoutMs: number): Promise<boolean> => {
    if (hasExited()) return true
    return await Promise.race([
      new Promise<boolean>(resolve => child.once('exit', () => resolve(true))),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), timeoutMs)),
    ])
  }

  if (hasExited()) return
  child.kill()
  if (await waitForExit(5_000)) return

  if (!hasExited()) {
    child.kill('SIGKILL')
    await waitForExit(5_000)
  }
}

export async function cleanup(ctx: SmokeContext, succeeded: boolean, keepArtifacts: boolean): Promise<void> {
  try {
    ctx.client?.destroy()
    await stopApp(ctx.child)
  } catch {
    // best effort
  }

  // Always remove successful run roots so release reports stay clean.
  // On failure, keep the tree for debugging unless the caller opts out.
  if (!keepArtifacts && (succeeded || process.env.OMP_SMOKE_ALWAYS_CLEAN === '1')) {
    await rm(ctx.runRoot, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Remove stale smoke directories under `.tmp/` that were left behind by
 * killed/timeout runs. Safe: only deletes `smoke-*` / `packaged-e2e-*` / `smoke-artifacts-*`.
 */
export async function cleanupStaleSmokeArtifacts(options: {
  maxAgeMs?: number
  keepLatest?: number
} = {}): Promise<{ removed: string[]; kept: string[] }> {
  const maxAgeMs = options.maxAgeMs ?? 24 * 60 * 60 * 1000
  const keepLatest = options.keepLatest ?? 3
  const tmpRoot = join(ROOT_DIR, '.tmp')
  const removed: string[] = []
  const kept: string[] = []

  if (!existsSync(tmpRoot)) return { removed, kept }

  const { readdir, stat } = await import('node:fs/promises')
  const entries = await readdir(tmpRoot, { withFileTypes: true }).catch(() => [])
  const candidates = entries
    .filter(e => e.isDirectory())
    .filter(e => /^(smoke-|packaged-e2e-|smoke-artifacts-)/.test(e.name))
    .map(e => join(tmpRoot, e.name))

  const withMtime = await Promise.all(
    candidates.map(async path => {
      try {
        const s = await stat(path)
        return { path, mtimeMs: s.mtimeMs }
      } catch {
        return { path, mtimeMs: 0 }
      }
    }),
  )
  withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs)

  const now = Date.now()
  for (let i = 0; i < withMtime.length; i += 1) {
    const entry = withMtime[i]!
    const isRecentKeep = i < keepLatest
    const isStale = now - entry.mtimeMs > maxAgeMs
    if (isRecentKeep && !isStale) {
      kept.push(entry.path)
      continue
    }
    if (isStale || i >= keepLatest) {
      await rm(entry.path, { recursive: true, force: true }).catch(() => {})
      removed.push(entry.path)
    } else {
      kept.push(entry.path)
    }
  }

  return { removed, kept }
}

export async function screenshot(ctx: SmokeContext, name: string): Promise<string> {
  const path = join(ctx.screenshotsDir, `${name}.txt`)
  const text = `Screenshot placeholder for ${name}\nCaptured at: ${new Date().toISOString()}\n`
  await writeFile(path, text, 'utf-8')
  return path
}

export function waitForSessionEvents(
  client: CliRpcClient,
  sessionId: string,
  predicate: (event: Record<string, unknown>, seenTypes: Set<string>) => boolean,
  timeoutMs: number,
): Promise<{ seenTypes: string[]; matchedEvent: Record<string, unknown> | null }> {
  return new Promise((resolve, reject) => {
    const seen = new Set<string>()
    let matched: Record<string, unknown> | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const unsub = client.on('session:event', (event: unknown) => {
      const ev = event as Record<string, unknown>
      if (ev.sessionId !== sessionId) return
      const type = String(ev.type ?? '')
      if (type) seen.add(type)

      if (!matched && predicate(ev, seen)) {
        matched = ev
        if (timer) clearTimeout(timer)
        unsub()
        resolve({ seenTypes: [...seen], matchedEvent: matched })
      }
    })

    timer = setTimeout(() => {
      unsub()
      resolve({ seenTypes: [...seen], matchedEvent: null })
    }, timeoutMs)
  })
}

export async function waitForSessionTerminal(
  client: CliRpcClient,
  sessionId: string,
  timeoutMs: number,
): Promise<{ seenTypes: string[]; terminalError: string | null }> {
  return new Promise((resolve) => {
    const seen = new Set<string>()
    let terminalError: string | null = null
    let finished = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const unsub = client.on('session:event', (event: unknown) => {
      const ev = event as Record<string, unknown>
      if (ev.sessionId !== sessionId) return
      const type = String(ev.type ?? '')
      if (type) seen.add(type)

      if (type === 'error') {
        terminalError = String(ev.error ?? 'unknown session error')
        finished = true
      } else if (type === 'complete' || type === 'interrupted') {
        finished = true
      }

      if (finished) {
        if (timer) clearTimeout(timer)
        unsub()
        resolve({ seenTypes: [...seen], terminalError })
      }
    })

    timer = setTimeout(() => {
      unsub()
      resolve({ seenTypes: [...seen], terminalError })
    }, timeoutMs)
  })
}

export async function tailLogFile(filePath: string, maxBytes = 4096): Promise<string> {
  try {
    const data = await readFile(filePath)
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
    const start = Math.max(0, buffer.length - maxBytes)
    return buffer.subarray(start).toString('utf-8')
  } catch {
    return ''
  }
}
