#!/usr/bin/env bun
/**
 * lint-i18n-staged.ts — Pre-commit wrapper for lint-i18n-strings.ts.
 *
 * Runs the hard-coded copy scanner only on staged TSX/TS files. If no relevant
 * files are staged, exits successfully without invoking the scanner.
 */

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir ?? new URL('.', import.meta.url).pathname, '..')
const SCANNER = resolve(ROOT, 'scripts/lint-i18n-strings.ts')

function git(args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf-8',
    shell: false,
  })
  if (result.error) {
    console.error('Failed to run git:', result.error.message)
    process.exit(1)
  }
  return result.stdout
}

const staged = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.endsWith('.ts') || l.endsWith('.tsx'))

if (staged.length === 0) {
  console.log('i18n staged lint: no staged TS/TSX files')
  process.exit(0)
}

const result = spawnSync(
  process.execPath,
  [SCANNER, '--strict', ...staged],
  {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
  },
)

process.exit(result.status ?? 1)
