#!/usr/bin/env bun
/**
 * Quality gate entry point.
 *
 * Commands:
 *   quality:quick   — Static checks + targeted OMP unit tests. No packaging.
 *   quality:verify  — Full contract except installer creation. Requires a prior
 *                     packaged build (win-unpacked) by default.
 *   release:win     — Build Windows installer, run verify, emit report.
 *
 * The script exits non-zero on any failed required step. A JSON report is
 * written to quality-reports/ for every run.
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  createReport,
  writeReport,
  fileArtifact,
  type QualityReport,
  type QualityStepResult,
  type QualityArtifact,
} from './report'
import { runAllStaticChecks } from './static'
import { validatePackageIntegrity, resolvePackagePaths } from './package'
import { runtimeInfoFromCapabilityStep, validateRuntimeCapability } from './runtime'
import { isRecoverableArtifact, processFailed, runProcess } from './run-process'
import { probeWindowsSignature, type CodeSigningInfo } from './signing'

const ROOT = resolve(import.meta.dir ?? new URL('.', import.meta.url).pathname, '..', '..')
const ELECTRON_DIR = join(ROOT, 'apps/electron')
const APP_PACKAGE = join(ELECTRON_DIR, 'package.json')

/** electron-builder + full app compile can exceed 30 minutes on cold machines. */
const BUILD_INSTALLER_TIMEOUT_MS = Number(process.env.OMP_BUILD_TIMEOUT_MS ?? 45 * 60 * 1000)
/** Full packaged smoke including install can be long on first run. */
const RELEASE_SMOKE_TIMEOUT_MS = Number(process.env.OMP_SMOKE_TIMEOUT_MS ?? 30 * 60 * 1000)
/** Packaged Electron UI smoke needs startup plus route hydration. */
const RELEASE_UI_TIMEOUT_MS = Number(process.env.OMP_UI_TIMEOUT_MS ?? 10 * 60 * 1000)

function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, '/')
}

const VALID_COMMANDS = ['quality:quick', 'quality:verify', 'release:win'] as const
type Command = (typeof VALID_COMMANDS)[number]

function isCommand(arg: string): arg is Command {
  return VALID_COMMANDS.includes(arg as Command)
}

function readVersion(): string {
  const pkg = JSON.parse(require('node:fs').readFileSync(APP_PACKAGE, 'utf-8')) as { version?: string }
  return pkg.version ?? '0.0.0'
}

function runTestManifest(): QualityStepResult {
  const name = 'omp test manifest'
  const start = Date.now()
  const result = spawnSync(
    'bun',
    ['test', 'packages/shared/src/agent/backend/omp', 'scripts/quality/__tests__'],
    { cwd: ROOT, encoding: 'utf-8', shell: false },
  )
  const durationMs = Date.now() - start
  const failed = result.status !== 0
  return {
    name,
    status: failed ? 'failed' : 'passed',
    durationMs,
    output: result.stdout?.trim() || undefined,
    error: failed ? result.stderr?.trim() || undefined : undefined,
  }
}

async function runReleaseSmoke(): Promise<QualityStepResult> {
  const name = 'packaged release smoke'
  const result = await runProcess(
    'bun',
    ['run', 'scripts/smoke/runner.ts', '--run-installation'],
    {
      cwd: ROOT,
      timeoutMs: RELEASE_SMOKE_TIMEOUT_MS,
      captureTailBytes: 64 * 1024,
    },
  )
  const failed = processFailed(result)
  const tails = [result.stdoutTail, result.stderrTail].filter(Boolean).join('\n')
  return {
    name,
    status: failed ? 'failed' : 'passed',
    durationMs: result.durationMs,
    output: tails || undefined,
    error: failed
      ? result.error || result.stderrTail || `smoke exited with code ${result.status ?? 'null'}`
      : undefined,
  }
}

async function runReleaseUiSmoke(): Promise<QualityStepResult> {
  const name = 'packaged AI settings UI smoke'
  const result = await runProcess(
    'bun',
    ['run', 'test:ui:ai-settings:strict'],
    {
      cwd: ROOT,
      timeoutMs: RELEASE_UI_TIMEOUT_MS,
      captureTailBytes: 64 * 1024,
    },
  )
  const failed = processFailed(result)
  const tails = [result.stdoutTail, result.stderrTail].filter(Boolean).join('\n')
  return {
    name,
    status: failed ? 'failed' : 'passed',
    durationMs: result.durationMs,
    output: tails || undefined,
    error: failed
      ? result.error || result.stderrTail || `UI smoke exited with code ${result.status ?? 'null'}`
      : undefined,
  }
}

async function packageIntegrityAsync(): Promise<QualityStepResult> {
  return validatePackageIntegrity({ root: ROOT })
}

async function runtimeCapabilityAsync(): Promise<QualityStepResult> {
  return validateRuntimeCapability({ root: ROOT })
}

function findLatestInstallerPath(): string | undefined {
  const releaseDir = join(ELECTRON_DIR, 'release')
  if (!existsSync(releaseDir)) return undefined
  const installers = readdirSync(releaseDir)
    .filter((name: string) => /^Oh-My-Pi-Setup-.*\.exe$/i.test(name) || name.endsWith('.exe'))
    .map((name: string) => join(releaseDir, name))
    .filter((path: string) => {
      try {
        return statSync(path).isFile()
      } catch {
        return false
      }
    })
  if (installers.length === 0) return undefined
  installers.sort((a: string, b: string) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return installers[0]
}

function findInstallerArtifact(): QualityArtifact | undefined {
  const path = findLatestInstallerPath()
  return path ? fileArtifact(path) : undefined
}

async function buildInstaller(): Promise<QualityStepResult> {
  const name = 'build installer'
  const processStartedAt = Date.now()
  const result = await runProcess('bun', ['run', 'electron:dist:win'], {
    cwd: ROOT,
    timeoutMs: BUILD_INSTALLER_TIMEOUT_MS,
    captureTailBytes: 64 * 1024,
  })

  const failed = processFailed(result)
  const installerPath = findLatestInstallerPath()
  const recoverable = failed
    && installerPath
    && isRecoverableArtifact({ path: installerPath, minBytes: 1_000_000 }, processStartedAt)

  if (recoverable && installerPath) {
    const note =
      `Process reported failure/timeout after the installer was written (${installerPath}). ` +
      `Treating build as passed (exit=${result.status ?? 'null'}, timedOut=${result.timedOut}, ` +
      `signal=${result.signal ?? 'none'}). Original error: ${result.error ?? result.stderrTail ?? 'n/a'}`
    console.warn(`[release:win] ${note}`)
    return {
      name,
      status: 'passed',
      durationMs: result.durationMs,
      output: [result.stdoutTail, note].filter(Boolean).join('\n\n'),
    }
  }

  const tails = [result.stdoutTail, result.stderrTail].filter(Boolean).join('\n')
  return {
    name,
    status: failed ? 'failed' : 'passed',
    durationMs: result.durationMs,
    output: tails || undefined,
    error: failed
      ? result.error
        || result.stderrTail
        || `build exited with code ${result.status ?? 'null'}${result.timedOut ? ' (timed out)' : ''}`
      : undefined,
  }
}

function staticCheckStep(): QualityStepResult {
  const name = 'static checks'
  const start = Date.now()
  const checks = runAllStaticChecks()
  const failed = checks.filter((c) => !c.passed)
  const output = checks.map((c) => `${c.name}: ${c.passed ? 'OK' : 'FAIL'}`).join('\n')
  return {
    name,
    status: failed.length === 0 ? 'passed' : 'failed',
    durationMs: Date.now() - start,
    output,
    error: failed.length > 0
      ? failed.map((c) => `${c.name}: ${c.error ?? c.output}`).join('\n')
      : undefined,
  }
}

async function runCommand(command: Command): Promise<QualityReport> {
  const base = createReport(command, readVersion())
  const steps: QualityStepResult[] = []

  steps.push(staticCheckStep())
  if (steps.some((step) => step.status === 'failed')) return finalizeReport(base, steps, command)

  // A quick gate still needs behavioral coverage; it is only allowed to skip
  // package/runtime work, never the OMP test manifest itself.
  steps.push(runTestManifest())
  if (steps.some((step) => step.status === 'failed')) return finalizeReport(base, steps, command)

  if (command === 'quality:quick') return finalizeReport(base, steps, command)

  if (command === 'release:win') {
    steps.push(await buildInstaller())
    if (steps.some((step) => step.status === 'failed')) return finalizeReport(base, steps, command)
  }

  steps.push(await packageIntegrityAsync())
  if (steps.some((step) => step.status === 'failed')) return finalizeReport(base, steps, command)

  steps.push(await runtimeCapabilityAsync())
  if (steps.some((step) => step.status === 'failed')) return finalizeReport(base, steps, command)

  if (command === 'release:win') {
    steps.push(await runReleaseUiSmoke())
    if (steps.some((step) => step.status === 'failed')) return finalizeReport(base, steps, command)
  }

  if (command === 'release:win') {
    steps.push(await runReleaseSmoke())
  }

  return finalizeReport(base, steps, command)
}

function finalizeReport(
  base: QualityReport,
  steps: QualityStepResult[],
  command: Command,
): QualityReport {
  const failed = steps.filter((s) => s.status === 'failed')
  const status = failed.length === 0 ? 'success' : 'failure'

  const installerPath = command === 'release:win' ? findLatestInstallerPath() : undefined
  const installer = command === 'release:win' && status === 'success' && installerPath
    ? fileArtifact(installerPath)
    : undefined

  const runtimePath = resolvePackagePaths({ root: ROOT }).ompRuntimePath
  const embeddedRuntime = status === 'success' && existsSync(runtimePath)
    ? fileArtifact(runtimePath)
    : undefined

  const runtimeStep = steps.find((s) => s.name === 'runtime capability')
  const runtimeInfo = runtimeInfoFromCapabilityStep(
    runtimeStep,
    normalizePathSeparators(embeddedRuntime?.path ?? relative(ROOT, runtimePath)),
  )

  let signing: CodeSigningInfo | undefined
  if (command === 'release:win' && installerPath) {
    signing = probeWindowsSignature(installerPath)
  }

  // A successful release report must never record a synthetic / dependency version.
  // If capability passed without a probed binary version, treat the run as failed.
  if (status === 'success' && runtimeStep?.status === 'passed' && !runtimeInfo) {
    return {
      ...base,
      status: 'failure',
      steps: [
        ...steps,
        {
          name: 'runtime version evidence',
          status: 'failed',
          durationMs: 0,
          error:
            'Runtime capability passed without a probed OMP binary version; refusing to emit a success report',
        },
      ],
      installer: undefined,
      embeddedRuntime: undefined,
      runtime: undefined,
      signing,
    }
  }

  return {
    ...base,
    status,
    steps,
    installer,
    embeddedRuntime,
    runtime: runtimeInfo,
    signing,
  }
}

async function main() {
  const command = process.argv[2]
  if (!command || !isCommand(command)) {
    console.error(`Usage: bun run scripts/quality/commands.ts <${VALID_COMMANDS.join(' | ')}>`)
    process.exit(1)
  }

  const report = await runCommand(command)
  const installerDir = report.installer ? join(ROOT, dirname(report.installer.path)) : undefined
  const reportPath = writeReport(report as QualityReport, installerDir)
  console.log(`Quality report written to ${reportPath}`)
  console.log(`Overall status: ${report.status}`)
  if (report.signing) {
    console.log(`  signing: ${report.signing.status}${report.signing.detail ? ` (${report.signing.detail})` : ''}`)
  }
  for (const step of report.steps) {
    console.log(`  [${step.status}] ${step.name} (${step.durationMs}ms)`)
  }
  process.exit(report.status === 'success' ? 0 : 1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
