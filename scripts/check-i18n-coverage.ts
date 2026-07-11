#!/usr/bin/env bun
/**
 * check-i18n-coverage.ts — Verify that required message keys exist.
 *
 * The catalog parity check guarantees every supported locale has every EN key.
 * This script adds a focused second line of defense: it ensures keys that are
 * critical to the Chinese-first OMP experience are present in every supported
 * locale.
 *
 * Required keys are enumerated explicitly rather than inferred from source so
 * the check stays deterministic and fast. Add new keys here when they become
 * essential to first-run or core OMP flows.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SUPPORTED_LANGUAGE_CODES } from '../packages/shared/src/i18n/languages'

const LOCALES_DIR = resolve(
  import.meta.dir ?? new URL('.', import.meta.url).pathname,
  '..',
  'packages',
  'shared',
  'src',
  'i18n',
  'locales',
)

/**
 * Required keys for a functional Chinese-first desktop experience.
 *
 * These keys must exist in en.json (the source of truth) and therefore also in
 * every other supported locale because parity runs before this check in CI.
 */
const REQUIRED_KEYS: string[] = [
  // Appearance / language switching
  'settings.appearance.language',
  'settings.appearance.title',

  // OMP settings page
  'settings.omp.title',
  'settings.omp.description',

  // OMP onboarding provider
  'onboarding.providerSelect.title',
  'onboarding.providerSelect.omp',
  'onboarding.providerSelect.ompDesc',
  'onboarding.providerSelect.setupLater',

  // OMP todo / subagent cards
  'omp.todo.title',
  'omp.todo.requests',
  'omp.todo.tokens',
  'omp.todo.subagentsActive',
  'omp.subagent.title',
  'omp.subagent.requests',
  'omp.subagent.tokens',

  // Resource send dialog
  'resources.send.title',
  'resources.send.description',
  'resources.send.send',
  'resources.send.cancel',

  // OMP Feature Center core actions
  'omp.featureCenter.loading',
  'omp.featureCenter.refresh',
  'omp.featureCenter.save',
]

const loadLocale = (code: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(LOCALES_DIR, `${code}.json`), 'utf-8')) as Record<string, string>

const errors: string[] = []
for (const code of SUPPORTED_LANGUAGE_CODES) {
  const locale = loadLocale(code)
  for (const key of REQUIRED_KEYS) {
    if (!(key in locale)) {
      errors.push(`${code}.json missing required key: ${key}`)
    }
  }
}

if (errors.length) {
  console.error('i18n coverage check failed:')
  for (const e of errors) console.error(`  ${e}`)
  process.exit(1)
}

console.log(
  `i18n coverage OK (${SUPPORTED_LANGUAGE_CODES.length} locales, ${REQUIRED_KEYS.length} required keys)`,
)
