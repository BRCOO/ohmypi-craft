/**
 * Upgrade install smoke.
 *
 * Simulates upgrading on a machine that already has a prior install:
 * 1. Silent-install the current NSIS into a temp directory (baseline).
 * 2. Seed user config (a marker file) under the isolated CRAFT_CONFIG_DIR.
 * 3. Re-run the same (or previous) installer over the same install directory.
 * 4. Launch the upgraded app with that config dir and assert the seeded user
 *    config remains available.
 *
 * When OMP_PREVIOUS_INSTALLER is set to an older Setup.exe path, that binary
 * is used for step 1 and the current release installer is used for step 3.
 */

import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import {
  cleanup,
  connectClient,
  spawnPackagedApp,
  type RunnerOptions,
  type ScenarioResult,
  type SmokeContext,
} from '../helpers.ts'

export const name = 'upgrade'

async function findCurrentInstaller(): Promise<string | null> {
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

function runInstaller(args: string[], timeoutMs: number, cwd?: string): Promise<{ code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0]!, args.slice(1), { windowsHide: true, cwd })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`Upgrade installer timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.on('exit', code => {
      clearTimeout(timer)
      resolve({ code })
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

  try {
    const skipReason = shouldSkip(opts)
    if (skipReason) {
      succeeded = true
      return { name, status: 'skipped', durationMs: Date.now() - start, output: skipReason, evidence }
    }

    const currentInstaller = await findCurrentInstaller()
    if (!currentInstaller || !existsSync(currentInstaller)) {
      throw new Error('Current NSIS installer not found (Oh-My-Pi-Setup-*.exe)')
    }

    const previousInstaller = process.env.OMP_PREVIOUS_INSTALLER
    const baselineInstaller = previousInstaller && existsSync(previousInstaller)
      ? previousInstaller
      : currentInstaller

    if (previousInstaller && !existsSync(previousInstaller)) {
      throw new Error(`OMP_PREVIOUS_INSTALLER not found: ${previousInstaller}`)
    }

    evidence.push(`baseline=${baselineInstaller}`)
    evidence.push(`upgrade=${currentInstaller}`)

    const installDir = join(ctx.runRoot, 'upgrade-installed')
    // The smoke harness passes ctx.configDir as CRAFT_CONFIG_DIR to the app.
    // Keep the marker there so the scenario exercises the same persistence
    // boundary as a real user configuration, while remaining isolated.
    const userConfigDir = ctx.configDir
    await mkdir(userConfigDir, { recursive: true })

    // Step 1: baseline install (previous candidate or current as stand-in).
    const baseline = await runInstaller([baselineInstaller, '/S', `/D=${installDir}`], opts.timeoutMs)
    if (baseline.code !== 0) {
      throw new Error(`Baseline install exited with code ${baseline.code}`)
    }

    const appExe = join(installDir, 'Oh My Pi.exe')
    const ompExe = join(installDir, 'resources', 'omp', 'win32-x64', 'omp.exe')
    if (!existsSync(appExe) || !existsSync(ompExe)) {
      throw new Error('Baseline install missing app or OMP runtime')
    }

    // Step 2: seed user data that must survive upgrade.
    const markerPath = join(userConfigDir, 'upgrade-marker.json')
    const marker = { upgraded: false, seed: `omp-upgrade-${Date.now()}` }
    await writeFile(markerPath, JSON.stringify(marker), 'utf-8')

    // Allow file handles to settle before re-running the installer.
    await new Promise(resolve => setTimeout(resolve, 2_000))

    // Step 3: upgrade with current installer into the same directory.
    const upgraded = await runInstaller([currentInstaller, '/S', `/D=${installDir}`], opts.timeoutMs)
    if (upgraded.code !== 0) {
      throw new Error(`Upgrade install exited with code ${upgraded.code}`)
    }

    if (!existsSync(appExe)) throw new Error(`App missing after upgrade: ${appExe}`)
    if (!existsSync(ompExe)) throw new Error(`OMP runtime missing after upgrade: ${ompExe}`)

    const after = JSON.parse(await readFile(markerPath, 'utf-8')) as typeof marker
    if (after.seed !== marker.seed) {
      throw new Error('User config marker was modified or replaced during upgrade')
    }

    // Prove that the upgraded executable can start against the preserved
    // configuration directory. This ensures the marker is in the config path
    // actually consumed by the packaged app, not an unrelated temp directory.
    ctx.exe = appExe
    const child = spawnPackagedApp(ctx)
    await connectClient(ctx, opts.timeoutMs)
    evidence.push(`upgraded app launched with CRAFT_CONFIG_DIR=${userConfigDir}`)
    ctx.client?.destroy()
    ctx.client = undefined
    await new Promise<void>(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve()
      child.once('exit', () => resolve())
      child.kill()
    })
    ctx.child = undefined

    // Cleanup product files.
    const uninstaller = join(installDir, 'Uninstall Oh My Pi.exe')
    if (existsSync(uninstaller)) {
      await runInstaller([uninstaller, '/S'], opts.timeoutMs, installDir)
    }

    succeeded = true
    return {
      name,
      status: 'passed',
      durationMs: Date.now() - start,
      output: previousInstaller
        ? `Upgrade from previous installer preserved user config`
        : `In-place reinstall (same version stand-in) preserved user config`,
      evidence,
    }
  } catch (error) {
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
