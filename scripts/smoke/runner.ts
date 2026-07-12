import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  cleanupStaleSmokeArtifacts,
  createSmokeContext,
  defaultPackagedExe,
  tailLogFile,
  type RunnerOptions,
  type ScenarioResult,
  type SmokeContext,
} from './helpers.ts'

import * as runtimeResolution from './scenarios/runtime-resolution.ts'
import * as sessionHandshake from './scenarios/session-handshake.ts'
import * as planMode from './scenarios/plan-mode.ts'
import * as featureDiscovery from './scenarios/feature-discovery.ts'
import * as language from './scenarios/language.ts'
import * as installation from './scenarios/installation.ts'
import * as offlineInstall from './scenarios/offline-install.ts'
import * as upgrade from './scenarios/upgrade.ts'

const ROOT_DIR = join(import.meta.dir, '..', '..')
const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_SEND_TIMEOUT_MS = 180_000

interface ScenarioModule {
  name: string
  run: (ctx: SmokeContext, opts: RunnerOptions) => Promise<ScenarioResult>
  shouldSkip?: (opts: RunnerOptions) => string | false
}

const SCENARIOS: ScenarioModule[] = [
  runtimeResolution,
  sessionHandshake,
  planMode,
  featureDiscovery,
  language,
  installation,
  offlineInstall,
  upgrade,
]

function parseArgs(argv: string[]): RunnerOptions {
  const args = argv.slice(2)
  const parsed: RunnerOptions = {
    exe: defaultPackagedExe(),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    sendTimeoutMs: DEFAULT_SEND_TIMEOUT_MS,
    keepArtifacts: false,
    // This is a release suite, not a developer convenience probe. A Windows
    // candidate has to prove its installer works unless callers explicitly run
    // one narrow scenario with `--scenario`.
    runInstallation: true,
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    switch (arg) {
      case '--exe':
        parsed.exe = args[++i] ?? parsed.exe
        break
      case '--timeout':
        parsed.timeoutMs = Number.parseInt(args[++i] ?? String(DEFAULT_TIMEOUT_MS), 10)
        break
      case '--send-timeout':
        parsed.sendTimeoutMs = Number.parseInt(args[++i] ?? String(DEFAULT_SEND_TIMEOUT_MS), 10)
        break
      case '--keep-artifacts':
        parsed.keepArtifacts = true
        break
      case '--run-installation':
        parsed.runInstallation = true
        break
      case '--scenario':
        parsed.scenario = args[++i]
        break
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return parsed
}

function printHelp(): void {
  console.log(`OMP Release QA smoke runner

Usage: bun run scripts/smoke/runner.ts [options]

Options:
  --exe <path>              Packaged Electron executable (default: ${defaultPackagedExe()})
  --timeout <ms>            Startup/operation timeout (default: ${DEFAULT_TIMEOUT_MS})
  --send-timeout <ms>       Session send timeout (default: ${DEFAULT_SEND_TIMEOUT_MS})
  --keep-artifacts          Do not delete temporary run directories
  --run-installation        Run the Windows NSIS install/uninstall scenario
  --scenario <name>         Run a single scenario instead of the full suite
  --help, -h                Show this help message
`)
}

async function runScenario(module: ScenarioModule, opts: RunnerOptions): Promise<ScenarioResult> {
  const skipReason = module.shouldSkip?.(opts)
  if (skipReason) {
    return {
      name: module.name,
      status: 'skipped',
      durationMs: 0,
      output: skipReason,
    }
  }

  const ctx = await createSmokeContext(opts.exe)
  const result = await module.run(ctx, opts)

  // Attach captured process tails to failed results for debugging.
  if (result.status === 'failed' && ctx.child) {
    const stdout = ctx.child.stdoutTail?.length ? `STDOUT tail:\n${ctx.child.stdoutTail}` : ''
    const stderr = ctx.child.stderrTail?.length ? `STDERR tail:\n${ctx.child.stderrTail}` : ''
    const logTail = await tailLogFile(ctx.headlessFile)
    const parts = [stdout, stderr, logTail ? `HEADLESS LOG tail:\n${logTail}` : ''].filter(Boolean)
    if (parts.length > 0) {
      result.error = `${result.error ?? 'Unknown error'}\n\n${parts.join('\n\n')}`
    }
  }

  return result
}

async function getVersion(exe: string): Promise<string | undefined> {
  try {
    const pkg = await import(join(ROOT_DIR, 'package.json'), { assert: { type: 'json' } })
    return pkg.default?.version ?? pkg.version
  } catch {
    return undefined
  }
}

async function getCommit(): Promise<{ commit?: string; dirty?: boolean }> {
  try {
    const { execSync } = await import('node:child_process')
    const commit = execSync('git rev-parse HEAD', { cwd: ROOT_DIR, encoding: 'utf-8' }).trim()
    const dirty = execSync('git status --porcelain', { cwd: ROOT_DIR, encoding: 'utf-8' }).trim().length > 0
    return { commit, dirty }
  } catch {
    return {}
  }
}

interface SmokeReport {
  id: string
  createdAt: string
  command: string
  version?: string
  commit?: string
  dirty?: boolean
  environment: {
    os: string
    arch: string
    node: string
    bun: string
  }
  executable: string
  status: 'success' | 'failure'
  scenarios: ScenarioResult[]
  artifactsRoot: string
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv)
  const exe = resolve(opts.exe)

  if (!existsSync(exe)) {
    console.error(`Packaged Electron app not found: ${exe}`)
    console.error('Run "bun run electron:dist:dev:win" (or the appropriate platform target) first.')
    process.exit(1)
  }

  opts.exe = exe

  const scenariosToRun = opts.scenario
    ? SCENARIOS.filter(s => s.name === opts.scenario)
    : SCENARIOS

  if (opts.scenario && scenariosToRun.length === 0) {
    console.error(`Unknown scenario: ${opts.scenario}`)
    console.error(`Available scenarios: ${SCENARIOS.map(s => s.name).join(', ')}`)
    process.exit(1)
  }

  const results: ScenarioResult[] = []
  for (const module of scenariosToRun) {
    const result = await runScenario(module, opts)
    results.push(result)
    const icon = result.status === 'passed' ? '✅' : result.status === 'skipped' ? '⏭️' : '❌'
    console.log(`${icon} ${result.name} (${result.durationMs}ms): ${result.status}`)
    if (result.output) console.log(`   ${result.output}`)
    if (result.error) console.error(`   ${result.error}`)
  }

  // A skipped required scenario provides no release evidence. Treat it as a
  // failure so an unsupported Plan runtime or skipped installer check cannot
  // be reported as a successful Release QA run.
  // Optional environments (offline / upgrade) may legitimately skip when
  // prerequisites are missing; those skips do not fail the suite.
  const optionalScenarios = new Set(['offline-install', 'upgrade'])
  const incomplete = results.filter(r => {
    if (r.status === 'passed') return false
    if (r.status === 'skipped' && optionalScenarios.has(r.name)) return false
    return true
  })
  const overallStatus = incomplete.length === 0 ? 'success' : 'failure'

  const artifactsRoot = join(ROOT_DIR, '.tmp')
  await mkdir(artifactsRoot, { recursive: true })

  // Prune leftover smoke trees so git status / release reports stay clean.
  const prune = await cleanupStaleSmokeArtifacts({ maxAgeMs: 6 * 60 * 60 * 1000, keepLatest: 2 })
  if (prune.removed.length > 0) {
    console.log(`Cleaned ${prune.removed.length} stale smoke artifact dir(s) under .tmp/`)
  }

  const { commit, dirty } = await getCommit()
  const report: SmokeReport = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    command: 'smoke:release-qa',
    version: await getVersion(exe),
    commit,
    dirty,
    environment: {
      os: process.platform,
      arch: process.arch,
      node: process.version,
      bun: `bun ${Bun.version}`,
    },
    executable: exe,
    status: overallStatus,
    scenarios: results,
    artifactsRoot,
  }

  const reportsDir = join(ROOT_DIR, 'quality-reports')
  await mkdir(reportsDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = join(reportsDir, `smoke-${timestamp}.json`)
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8')

  console.log(`\nSmoke ${overallStatus === 'success' ? 'passed' : 'failed'}: ${results.filter(r => r.status === 'passed').length}/${results.length} passed`)
  console.log(`Report written to: ${reportPath}`)

  if (overallStatus === 'failure') {
    process.exit(1)
  }
}

main().catch(error => {
  console.error('Smoke runner failed:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
