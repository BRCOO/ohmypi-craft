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

import { existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  createReport,
  writeReport,
  fileArtifact,
  type QualityReport,
  type QualityStepResult,
  type QualityStepStatus,
  type QualityArtifact,
} from './report'
import { runAllStaticChecks } from './static'
import { validatePackageIntegrity, resolvePackagePaths } from './package'
import { runtimeInfoFromCapabilityStep, validateRuntimeCapability } from './runtime'

const ROOT = resolve(import.meta.dir ?? new URL('.', import.meta.url).pathname, '..', '..')
const ELECTRON_DIR = join(ROOT, 'apps/electron')
const APP_PACKAGE = join(ELECTRON_DIR, 'package.json')

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
    ['test', 'packages/shared/src/agent/backend/omp'],
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

function runReleaseSmoke(): QualityStepResult {
  const name = 'packaged release smoke'
  const start = Date.now()
  const result = spawnSync(
    'bun',
    ['run', 'scripts/smoke/runner.ts', '--run-installation'],
    { cwd: ROOT, encoding: 'utf-8', shell: false, maxBuffer: 10 * 1024 * 1024 },
  )
  const failed = result.status !== 0
  return {
    name,
    status: failed ? 'failed' : 'passed',
    durationMs: Date.now() - start,
    output: result.stdout?.trim() || undefined,
    error: failed ? result.stderr?.trim() || undefined : undefined,
  }
}

async function packageIntegrityAsync(): Promise<QualityStepResult> {
  return validatePackageIntegrity({ root: ROOT })
}

async function runtimeCapabilityAsync(): Promise<QualityStepResult> {
  return validateRuntimeCapability({ root: ROOT })
}

function buildInstaller(): QualityStepResult {
  const name = 'build installer'
  const start = Date.now()
  const result = spawnSync('bun', ['run', 'electron:dist:win'], {
    cwd: ROOT,
    encoding: 'utf-8',
    shell: false,
  })
  const failed = result.status !== 0
  return {
    name,
    status: failed ? 'failed' : 'passed',
    durationMs: Date.now() - start,
    output: result.stdout?.trim() || undefined,
    error: failed ? result.stderr?.trim() || undefined : undefined,
  }
}

function findInstallerArtifact(): QualityArtifact | undefined {
  const releaseDir = join(ELECTRON_DIR, 'release')
  if (!existsSync(releaseDir)) return undefined
  const installers = require('node:fs')
    .readdirSync(releaseDir)
    .filter((name: string) => name.endsWith('.exe'))
    .map((name: string) => join(releaseDir, name))
    .filter((path: string) => require('node:fs').statSync(path).isFile())
  if (installers.length === 0) return undefined
  installers.sort((a: string, b: string) => require('node:fs').statSync(b).mtimeMs - require('node:fs').statSync(a).mtimeMs)
  return fileArtifact(installers[0])
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
    steps.push(buildInstaller())
    if (steps.some((step) => step.status === 'failed')) return finalizeReport(base, steps, command)
  }

  steps.push(await packageIntegrityAsync())
  if (steps.some((step) => step.status === 'failed')) return finalizeReport(base, steps, command)

  steps.push(await runtimeCapabilityAsync())
  if (steps.some((step) => step.status === 'failed')) return finalizeReport(base, steps, command)

  if (command === 'release:win') {
    steps.push(runReleaseSmoke())
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

  const installer = command === 'release:win' && status === 'success'
    ? findInstallerArtifact()
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
    }
  }

  return {
    ...base,
    status,
    steps,
    installer,
    embeddedRuntime,
    runtime: runtimeInfo,
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
  for (const step of report.steps) {
    console.log(`  [${step.status}] ${step.name} (${step.durationMs}ms)`)
  }
  process.exit(report.status === 'success' ? 0 : 1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
