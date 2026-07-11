/**
 * Release quality report types and serialization.
 *
 * Every quality gate run produces a JSON report with step results, environment
 * metadata, and artifact information. Reports are written next to the installer
 * on release, or to a local `quality-reports/` directory for verify runs.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

export type QualityStepStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped'

export interface QualityStepResult {
  name: string
  status: QualityStepStatus
  durationMs: number
  output?: string
  error?: string
  /**
   * Structured step-specific data for report finalization.
   * Runtime capability uses this to surface the probed OMP binary version.
   */
  data?: {
    ompVersion?: string
    capabilities?: string[]
    runtimePath?: string
  }
}

export interface QualityArtifact {
  path: string
  bytes: number
  sha256: string
}

export interface QualityReport {
  id: string
  createdAt: string
  command: 'quality:quick' | 'quality:verify' | 'release:win'
  status: 'success' | 'failure'
  version: string
  commit: string
  dirty: boolean
  runtime?: {
    version: string
    path: string
    capabilities: string[]
  }
  steps: QualityStepResult[]
  installer?: QualityArtifact
  embeddedRuntime?: QualityArtifact
  environment: {
    os: string
    arch: string
    node: string
    bun: string | undefined
  }
}

const ROOT = resolve(import.meta.dir ?? new URL('.', import.meta.url).pathname, '..', '..')
const REPORTS_DIR = join(ROOT, 'quality-reports')

export function sha256File(path: string): string {
  const hash = createHash('sha256')
  hash.update(require('node:fs').readFileSync(path))
  return hash.digest('hex')
}

export function fileArtifact(path: string): QualityArtifact | undefined {
  if (!existsSync(path)) return undefined
  const stats = require('node:fs').statSync(path)
  if (!stats.isFile()) return undefined
  return {
    path: require('node:path').relative(ROOT, path).replace(/\\/g, '/'),
    bytes: stats.size,
    sha256: sha256File(path),
  }
}

export function gitCommit(): { commit: string; dirty: boolean } {
  const { spawnSync } = require('node:child_process')
  const commitResult = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf-8' })
  const dirtyResult = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf-8' })
  return {
    commit: commitResult.status === 0 ? commitResult.stdout.trim() : 'unknown',
    dirty: dirtyResult.status === 0 ? dirtyResult.stdout.trim().length > 0 : false,
  }
}

export function createReport(
  command: QualityReport['command'],
  version: string,
): Omit<QualityReport, 'steps' | 'status' | 'installer' | 'embeddedRuntime'> {
  const { commit, dirty } = gitCommit()
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    command,
    version,
    commit,
    dirty,
    environment: {
      os: process.platform,
      arch: process.arch,
      node: process.version,
      bun: process.versions.bun,
    },
  }
}

export function writeReport(report: QualityReport, installerDir?: string): string {
  if (!existsSync(REPORTS_DIR)) {
    mkdirSync(REPORTS_DIR, { recursive: true })
  }
  const filename = `${report.command}-${report.status}-${report.createdAt.replace(/[:.]/g, '-')}-${report.commit.slice(0, 8)}.json`
    .replace(/:/g, '-')
  const contents = JSON.stringify(report, null, 2)
  const primaryPath = join(REPORTS_DIR, filename)
  writeFileSync(primaryPath, contents, 'utf-8')

  if (installerDir && existsSync(installerDir)) {
    const installerPath = join(installerDir, filename)
    writeFileSync(installerPath, contents, 'utf-8')
  }

  return primaryPath
}
