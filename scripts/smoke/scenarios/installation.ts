import { existsSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { cleanup, type RunnerOptions, type ScenarioResult, type SmokeContext } from '../helpers.ts'

export const name = 'installation'

async function findInstaller(): Promise<string | null> {
  if (process.platform !== 'win32') return null
  const releaseDir = join(import.meta.dir, '..', '..', '..', 'apps', 'electron', 'release')
  const pattern = /^Oh-My-Pi-Setup-.*\.exe$/
  try {
    const files = await readdir(releaseDir)
    for (const file of files) {
      if (pattern.test(file)) {
        return join(releaseDir, file)
      }
    }
  } catch {
    return null
  }
  return null
}

function runInstaller(args: string[], timeoutMs: number, cwd?: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0]!, args.slice(1), { windowsHide: true, cwd })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', c => { stdout += String(c) })
    child.stderr.on('data', c => { stderr += String(c) })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`Installer/uninstaller timed out after ${timeoutMs}ms`))
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

  try {
    const skipReason = shouldSkip(opts)
    if (skipReason) {
      succeeded = true
      return {
        name,
        status: 'skipped',
        durationMs: Date.now() - start,
        output: skipReason,
        evidence,
      }
    }

    const installer = await findInstaller()
    if (!installer || !existsSync(installer)) {
      throw new Error(`NSIS installer not found in apps/electron/release (Oh-My-Pi-Setup-*.exe)`)
    }

    const installDir = join(ctx.runRoot, 'installed')

    // Silent NSIS install. The packaged UI smoke runs immediately before this
    // scenario and Windows can briefly keep a file handle open. NSIS reports
    // that transient access-denied state as exit code 5; match the retry
    // behavior used by offline-install instead of rejecting a valid installer.
    let installResult = await runInstaller([installer, '/S', `/D=${installDir}`], opts.timeoutMs)
    for (let attempt = 1; installResult.code === 5 && attempt <= 3; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5_000 * attempt))
      installResult = await runInstaller([installer, '/S', `/D=${installDir}`], opts.timeoutMs)
    }
    if (installResult.code !== 0) {
      throw new Error(`Installer exited with code ${installResult.code}. stderr: ${installResult.stderr}`)
    }

    const appExe = join(installDir, 'Oh My Pi.exe')
    const ompExe = join(installDir, 'resources', 'omp', 'win32-x64', 'omp.exe')

    if (!existsSync(appExe)) {
      throw new Error(`Installed app executable missing: ${appExe}`)
    }
    if (!existsSync(ompExe)) {
      throw new Error(`Installed OMP runtime missing: ${ompExe}`)
    }

    // Allow the installer process to release file handles before uninstalling.
    await new Promise(resolve => setTimeout(resolve, 3_000))

    const uninstaller = join(installDir, 'Uninstall Oh My Pi.exe')
    if (!existsSync(uninstaller)) {
      throw new Error(`Uninstaller missing: ${uninstaller}`)
    }

    const uninstallResult = await runInstaller([uninstaller, '/S'], opts.timeoutMs, installDir)
    if (uninstallResult.code !== 0) {
      throw new Error(`Uninstaller exited with code ${uninstallResult.code}. stdout: ${uninstallResult.stdout} stderr: ${uninstallResult.stderr}`)
    }

    // NSIS uninstallers may delete files asynchronously after the parent exits.
    // Poll for up to 60 seconds, allowing log files to remain.
    const pollDeadline = Date.now() + 60_000
    let appStillExists = true
    let ompStillExists = true
    while (Date.now() < pollDeadline) {
      appStillExists = existsSync(appExe)
      ompStillExists = existsSync(ompExe)
      if (!appStillExists && !ompStillExists) break
      await new Promise(resolve => setTimeout(resolve, 2_000))
    }

    if (appStillExists || ompStillExists) {
      throw new Error(`Uninstall did not remove product files after 60s: app=${appStillExists}, omp=${ompStillExists}. stdout: ${uninstallResult.stdout} stderr: ${uninstallResult.stderr}`)
    }

    succeeded = true
    return {
      name,
      status: 'passed',
      durationMs: Date.now() - start,
      output: `Installed and uninstalled from ${installDir}`,
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
