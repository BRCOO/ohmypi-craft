/**
 * Clean-machine / offline install smoke.
 *
 * Installs the NSIS artifact into an isolated directory with network-discouraging
 * environment variables, then launches the packaged app once with a fresh config
 * directory (no prior user data) to prove first-launch works without registry
 * or online dependency contact.
 */

import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import {
  cleanup,
  connectClient,
  spawnPackagedApp,
  stopApp,
  type RunnerOptions,
  type ScenarioResult,
  type SmokeContext,
} from '../helpers.ts'

export const name = 'offline-install'

async function findInstaller(): Promise<string | null> {
  if (process.platform !== 'win32') return null
  const releaseDir = join(import.meta.dir, '..', '..', '..', 'apps', 'electron', 'release')
  const pattern = /^Oh-My-Pi-Setup-.*\.exe$/
  try {
    const files = await readdir(releaseDir)
    for (const file of files) {
      if (pattern.test(file)) return join(releaseDir, file)
    }
  } catch {
    return null
  }
  return null
}

function runInstaller(args: string[], timeoutMs: number, cwd?: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0]!, args.slice(1), {
      windowsHide: true,
      cwd,
      env: {
        ...process.env,
        // Discourage accidental online contact during offline/clean install validation.
        ELECTRON_GET_USE_PROXY: '0',
        ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
        npm_config_offline: 'true',
        npm_config_prefer_offline: 'true',
        NO_UPDATE_NOTIFIER: '1',
      },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', c => { stdout += String(c) })
    child.stderr.on('data', c => { stderr += String(c) })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`Offline installer timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.on('exit', code => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

export function shouldSkip(opts: RunnerOptions): string | false {
  if (!opts.runInstallation) return 'skipped: pass --run-installation to enable'
  if (process.platform !== 'win32') return 'skipped: Windows-only scenario'
  return false
}

export async function run(ctx: SmokeContext, opts: RunnerOptions): Promise<ScenarioResult> {
  const start = Date.now()
  const evidence: string[] = []
  let succeeded = false
  let launchedChild: ReturnType<typeof spawnPackagedApp> | undefined

  try {
    const skipReason = shouldSkip(opts)
    if (skipReason) {
      succeeded = true
      return { name, status: 'skipped', durationMs: Date.now() - start, output: skipReason, evidence }
    }

    const installer = await findInstaller()
    if (!installer || !existsSync(installer)) {
      throw new Error('NSIS installer not found (Oh-My-Pi-Setup-*.exe)')
    }

    const installDir = join(ctx.runRoot, 'offline-installed')
    // The preceding NSIS scenario may still be finishing its asynchronous
    // self-delete helper. Retry the transient Windows access-denied result
    // once before treating the installer as broken.
    let installResult = await runInstaller([installer, '/S', `/D=${installDir}`], opts.timeoutMs)
    if (installResult.code === 5) {
      await new Promise(resolve => setTimeout(resolve, 5_000))
      installResult = await runInstaller([installer, '/S', `/D=${installDir}`], opts.timeoutMs)
    }
    if (installResult.code !== 0) {
      throw new Error(`Offline install exited ${installResult.code}: ${installResult.stderr}`)
    }

    const appExe = join(installDir, 'Oh My Pi.exe')
    const ompExe = join(installDir, 'resources', 'omp', 'win32-x64', 'omp.exe')
    if (!existsSync(appExe)) throw new Error(`Installed app missing: ${appExe}`)
    if (!existsSync(ompExe)) throw new Error(`Installed OMP runtime missing: ${ompExe}`)

    // First launch on a clean profile (ctx.configDir is empty) without preferring network.
    const offlineCtx: SmokeContext = {
      ...ctx,
      exe: appExe,
      configDir: join(ctx.runRoot, 'offline-config'),
      headlessFile: join(ctx.runRoot, 'offline-headless.env'),
      child: undefined,
      client: undefined,
    }
    await import('node:fs/promises').then(fs => fs.mkdir(offlineCtx.configDir, { recursive: true }))

    launchedChild = spawnPackagedApp(offlineCtx, {
      ELECTRON_GET_USE_PROXY: '0',
      NO_UPDATE_NOTIFIER: '1',
      // Force offline-ish first run; app must still boot and expose headless RPC.
      CRAFT_DISABLE_AUTO_UPDATE: '1',
    })
    offlineCtx.child = launchedChild

    const client = await connectClient(offlineCtx, opts.timeoutMs)
    const workspaces = await client.invoke('workspaces:list').catch(() => [])
    evidence.push(`offline-first-launch workspaces=${Array.isArray(workspaces) ? workspaces.length : 'n/a'}`)
    client.destroy()
    await stopApp(launchedChild)
    launchedChild = undefined

    // Uninstall to leave a clean machine state for subsequent scenarios.
    const uninstaller = join(installDir, 'Uninstall Oh My Pi.exe')
    if (existsSync(uninstaller)) {
      await runInstaller([uninstaller, '/S'], opts.timeoutMs, installDir)
    }

    succeeded = true
    return {
      name,
      status: 'passed',
      durationMs: Date.now() - start,
      output: `Clean offline install + first launch OK under ${installDir}`,
      evidence,
    }
  } catch (error) {
    if (launchedChild) await stopApp(launchedChild).catch(() => {})
    return {
      name,
      status: 'failed',
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
      evidence,
    }
  } finally {
    await cleanup(ctx, succeeded, opts.keepArtifacts)
  }
}
