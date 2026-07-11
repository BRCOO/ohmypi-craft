#!/usr/bin/env bun
/**
 * CI counterpart to the staged i18n copy lint.
 *
 * Checks only TypeScript files introduced or changed by the current change set,
 * so inherited upstream literals do not mask new untranslated product copy.
 *
 * Modes:
 *   - Developer (no CI): check the working tree relative to HEAD.
 *   - CI: require an explicit merge baseline (I18N_BASE_REF, or CI target branch
 *     via GITHUB_BASE_REF / CI_MERGE_REQUEST_TARGET_BRANCH_NAME) and compare
 *     `base...HEAD` so every commit in the PR is covered. Never fall back to
 *     HEAD~1 — a clean CI checkout would otherwise only scan the tip commit.
 */

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir ?? new URL('.', import.meta.url).pathname, '..')
const SCANNER = resolve(ROOT, 'scripts/lint-i18n-strings.ts')

export interface I18nChangedEnv {
  CI?: string
  I18N_BASE_REF?: string
  GITHUB_BASE_REF?: string
  CI_MERGE_REQUEST_TARGET_BRANCH_NAME?: string
}

export interface ResolveI18nBaseResult {
  mode: 'developer' | 'ci'
  /** Diff range passed to `git diff --name-only`. */
  diffRange: string
  /** Human-readable description of how the baseline was chosen. */
  description: string
}

function isTruthyCi(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized !== '' && normalized !== '0' && normalized !== 'false'
}

/**
 * Resolve the git diff range for the changed-file lint.
 *
 * Throws in CI when no explicit baseline can be determined.
 */
export function resolveI18nChangeBase(
  env: I18nChangedEnv = process.env,
  options: {
    mergeBase?: (ref: string) => string
  } = {},
): ResolveI18nBaseResult {
  const configured = env.I18N_BASE_REF?.trim()
  const githubBase = env.GITHUB_BASE_REF?.trim()
  const gitlabBase = env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME?.trim()
  const ciMode = isTruthyCi(env.CI)

  if (!ciMode) {
    // Developer mode: working tree (including staged) vs HEAD.
    return {
      mode: 'developer',
      diffRange: 'HEAD',
      description: 'working tree relative to HEAD',
    }
  }

  if (configured) {
    // Explicit base ref — use triple-dot so the full PR range is covered when
    // the ref is a branch tip, and merge-base..HEAD when it is already a commit.
    return {
      mode: 'ci',
      diffRange: `${configured}...HEAD`,
      description: `I18N_BASE_REF=${configured} (triple-dot against HEAD)`,
    }
  }

  const targetBranch = githubBase || gitlabBase
  if (targetBranch) {
    const remoteRef = targetBranch.startsWith('origin/')
      ? targetBranch
      : `origin/${targetBranch}`
    const mergeBase =
      options.mergeBase?.(remoteRef) ??
      (() => {
        throw new Error(
          `CI i18n changed lint: cannot compute merge-base with ${remoteRef}. ` +
            'Ensure the target branch is fetched, or set I18N_BASE_REF explicitly.',
        )
      })()
    return {
      mode: 'ci',
      diffRange: `${mergeBase}...HEAD`,
      description: `merge-base(${remoteRef}, HEAD)=${mergeBase}`,
    }
  }

  throw new Error(
    [
      'CI i18n changed lint requires an explicit merge baseline.',
      'Set I18N_BASE_REF to the PR base commit/branch, or provide GITHUB_BASE_REF',
      '(GitHub Actions) / CI_MERGE_REQUEST_TARGET_BRANCH_NAME (GitLab) so the',
      'script can compute the merge-base. Refusing to fall back to HEAD~1.',
    ].join(' '),
  )
}

export function changedTypescriptFiles(
  diffRange: string,
  options: {
    gitDiff?: (range: string) => string
  } = {},
): string[] {
  const output =
    options.gitDiff?.(diffRange) ??
    (() => {
      throw new Error('gitDiff dependency required when not running as a script')
    })()

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((path) => path.endsWith('.ts') || path.endsWith('.tsx'))
}

function git(args: string[]): string {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf-8', shell: false })
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `git ${args.join(' ')} failed`)
  }
  return result.stdout
}

function runMain(): void {
  let base: ResolveI18nBaseResult
  try {
    base = resolveI18nChangeBase(process.env, {
      mergeBase: (ref) => git(['merge-base', ref, 'HEAD']).trim(),
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }

  let files: string[]
  try {
    files = changedTypescriptFiles(base.diffRange, {
      gitDiff: (range) => git(['diff', '--name-only', '--diff-filter=ACMR', range]),
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }

  if (files.length === 0) {
    console.log(`i18n changed lint: no changed TS/TSX files (${base.description})`)
    process.exit(0)
  }

  console.log(`i18n changed lint: scanning ${files.length} file(s) via ${base.description}`)

  const result = spawnSync(process.execPath, [SCANNER, '--strict', ...files], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
  })

  process.exit(result.status ?? 1)
}

// Only execute when this file is the entry script (not when imported by tests).
if (import.meta.main) {
  runMain()
}
