#!/usr/bin/env bun
/**
 * sort-locales.ts — Sort top-level keys alphabetically in every locale JSON.
 *
 * Locale keys are kept sorted and validated alongside the parity checks. New
 * keys appended to a file in any order get
 * normalized in-place. Run via `bun run sort-locales` (or `--check` in CI).
 *
 * Format: 2-space indent, trailing newline, no other transformations.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const LOCALES_DIR = resolve(
  import.meta.dir ?? new URL('.', import.meta.url).pathname,
  '..',
  'packages',
  'shared',
  'src',
  'i18n',
  'locales',
)

const checkOnly = process.argv.includes('--check')

const localeFiles = readdirSync(LOCALES_DIR)
  .filter(f => f.endsWith('.json'))
  .sort()

let drift = 0
for (const file of localeFiles) {
  const path = resolve(LOCALES_DIR, file)
  const original = readFileSync(path, 'utf-8')
  const newline = original.includes('\r\n') ? '\r\n' : '\n'
  const parsed = JSON.parse(original) as Record<string, unknown>

  const sortedKeys = Object.keys(parsed).sort()
  const sorted: Record<string, unknown> = {}
  for (const key of sortedKeys) sorted[key] = parsed[key]

  // Git checkout settings can materialize locale files as CRLF on Windows.
  // Normalize every generated line (not only the final newline) so the check
  // compares the same representation that the formatter would write locally.
  const formatted = JSON.stringify(sorted, null, 2).replace(/\n/g, newline) + newline

  if (formatted === original) continue

  drift++
  if (checkOnly) {
    console.error(`drift: ${file} is not sorted`)
  } else {
    writeFileSync(path, formatted, 'utf-8')
    console.log(`sorted: ${file}`)
  }
}

if (checkOnly && drift > 0) {
  console.error(`\n${drift} locale file(s) out of order. Run \`bun run sort-locales\` to fix.`)
  process.exit(1)
}

if (!checkOnly && drift === 0) {
  console.log('all locale files already sorted')
}
