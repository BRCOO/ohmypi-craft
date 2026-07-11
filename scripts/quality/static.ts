/**
 * Static quality checks for release gates.
 *
 * These checks do not require a packaged build and can run quickly on a dev
 * workstation or in CI.
 */

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir ?? new URL('.', import.meta.url).pathname, '..', '..')

export interface StaticCheckResult {
  name: string
  passed: boolean
  output: string
  error?: string
}

function run(cmd: string[], cwd: string = ROOT): { exitCode: number; output: string; error: string } {
  const result = spawnSync(cmd[0], cmd.slice(1), {
    cwd,
    encoding: 'utf-8',
    shell: false,
    maxBuffer: 10 * 1024 * 1024,
  })
  return {
    exitCode: result.status ?? 1,
    output: result.stdout?.trim() ?? '',
    error: result.stderr?.trim() ?? '',
  }
}

function makeResult(name: string, { exitCode, output, error }: ReturnType<typeof run>): StaticCheckResult {
  return {
    name,
    passed: exitCode === 0,
    output: output || '(no output)',
    error: error || undefined,
  }
}

export function rootTypeCheck(): StaticCheckResult {
  return makeResult('typecheck:all', run(['bun', 'run', 'typecheck:all'], ROOT))
}

export function electronLint(): StaticCheckResult {
  return makeResult('lint:electron', run(['bun', 'run', 'lint:electron'], ROOT))
}

export function sharedLint(): StaticCheckResult {
  return makeResult('lint:shared', run(['bun', 'run', 'lint:shared'], ROOT))
}

export function uiLint(): StaticCheckResult {
  return makeResult('lint:ui', run(['bun', 'run', 'lint:ui'], ROOT))
}

export function gitDiffCheck(): StaticCheckResult {
  return makeResult('git diff --check', run(['git', 'diff', '--check'], ROOT))
}

export function i18nParity(): StaticCheckResult {
  return makeResult('lint:i18n:parity', run(['bun', 'run', 'lint:i18n:parity'], ROOT))
}

export function i18nSorted(): StaticCheckResult {
  return makeResult('lint:i18n:sorted', run(['bun', 'run', 'lint:i18n:sorted'], ROOT))
}

export function i18nCoverage(): StaticCheckResult {
  return makeResult('lint:i18n:coverage', run(['bun', 'run', 'lint:i18n:coverage'], ROOT))
}

export function runAllStaticChecks(): StaticCheckResult[] {
  return [
    rootTypeCheck(),
    electronLint(),
    sharedLint(),
    uiLint(),
    gitDiffCheck(),
    i18nParity(),
    i18nSorted(),
    i18nCoverage(),
  ]
}
