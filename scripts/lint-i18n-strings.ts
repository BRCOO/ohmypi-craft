#!/usr/bin/env bun
/**
 * lint-i18n-strings.ts — Targeted scan for application-owned hard-coded copy.
 *
 * Walks renderer and UI TypeScript/TSX source files and flags string literals
 * that look like user-facing English copy but are not routed through the i18n
 * catalog (`t(...)`, `i18nKey`, translation keys, etc.).
 *
 * The check is intentionally conservative: it only looks at JSX text and a
 * narrow set of JSX attributes known to carry user-facing copy. It ignores
 * identifiers, CSS classes, test IDs, URLs, file paths, code samples, upstream
 * model IDs, translation keys, and strings in test/fixture files. Remaining
 * hits are reported for human review.
 *
 * Exit codes:
 *   0 — no hard-coded copy detected (or only allowlisted hits)
 *   1 — potential hard-coded copy found
 *
 * Usage:
 *   bun run scripts/lint-i18n-strings.ts [--strict] [file1.tsx file2.tsx ...]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, relative, join } from 'node:path'
import ts from 'typescript'

const ROOT = resolve(import.meta.dir ?? new URL('.', import.meta.url).pathname, '..')
const strictMode = process.argv.includes('--strict')
const explicitFiles = process.argv.slice(2).filter((a) => !a.startsWith('--'))

const SCAN_DIRS = [
  resolve(ROOT, 'apps/electron/src/renderer'),
  resolve(ROOT, 'packages/ui/src'),
]

const EXTENSIONS = new Set(['.ts', '.tsx'])
const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '__tests__',
  '__fixtures__',
  '__mocks__',
])

// JSX attributes whose string values are almost always user-facing copy.
const USER_FACING_PROPS = new Set([
  'label',
  'placeholder',
  'title',
  'description',
  'aria-label',
  'tooltip',
  'hint',
  'helperText',
  'emptyText',
  'confirmText',
  'cancelText',
  'actionText',
  'submitText',
])

// JSX attributes we never want to flag.
const IGNORED_PROPS = new Set([
  'className',
  'class',
  'id',
  'name',
  'type',
  'role',
  'data-testid',
  'testId',
  'key',
  'href',
  'src',
  'alt',
  'htmlFor',
  'variant',
  'size',
  'value',
  'defaultValue',
  'as',
  'icon',
  'onClick',
  'onChange',
  'onSubmit',
  'ref',
])

// Allowlisted literal patterns.
const ALLOWLIST_PATTERNS = [
  /^\s*$/, // whitespace-only
  /^[A-Z][A-Z0-9_]*$/, // constants / enums
  /^[a-z][a-zA-Z0-9]*(?:[A-Z][a-zA-Z0-9]*)+$/, // camelCase identifiers
  /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/, // kebab/snake/i18n-key identifiers
  /^[#.][a-zA-Z0-9_.\-:[\]()]+$/, // CSS selectors / Tailwind class fragments
  /^(https?|file|mailto|vscode-):/, // URLs
  /^[a-zA-Z]:[\\/]/, // Windows paths
  /^\/[a-zA-Z0-9_\-./]+$/, // Unix paths
  /^[0-9a-f]{6,}$/i, // hex / ids
  /^\d+(\.\d+)?(px|rem|em|%|ms|s|mb|gb|kb)?$/, // numbers / units
  /^[\{\}\[\]()<>/\\|:=@#$%&*+!?~^`\-]+$/, // punctuation-only
]

// Allowlisted whole-string values.
const ALLOWLIST_STRINGS = new Set([
  ' ',
  '\n',
  '...',
  '->',
  '<-',
  '×',
  '—',
  '–',
  '•',
  'OK',
  'AI',
  'UI',
  'OMP',
  'MCP',
  'API',
  'URL',
  'ID',
  'JSON',
  'YAML',
  'HTML',
  'CSS',
  'CLI',
  'LLM',
  'GPT',
  'CSV',
  'PDF',
  'PNG',
  'JPG',
  'SVG',
  'md',
  'tsx',
  'ts',
  'js',
  'jsx',
  'json',
  'yml',
  'yaml',
  'toml',
  'env',
  'true',
  'false',
  'null',
  'undefined',
])

interface Hit {
  file: string
  line: number
  text: string
  context: string
}

function isAllowlisted(text: string): boolean {
  const trimmed = text.trim()
  if (ALLOWLIST_STRINGS.has(trimmed)) return true
  for (const pattern of ALLOWLIST_PATTERNS) {
    if (pattern.test(trimmed)) return true
  }
  return false
}

function looksLikeUserFacing(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 2) return false
  if (isAllowlisted(trimmed)) return false
  // Require at least one English word to reduce noise from punctuation/symbols.
  if (!/[a-zA-Z]{2,}/.test(trimmed)) return false
  return true
}

function collectFiles(dir: string): string[] {
  const result: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return result
  }
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry)) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      result.push(...collectFiles(full))
    } else if (st.isFile() && EXTENSIONS.has(entry.slice(entry.lastIndexOf('.')))) {
      result.push(full)
    }
  }
  return result
}

function findHits(file: string): Hit[] {
  const source = readFileSync(file, 'utf-8')
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const hits: Hit[] = []

  function lineOf(node: ts.Node): number {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  }

  function addHit(node: ts.Node, text: string, context: string) {
    if (!looksLikeUserFacing(text)) return
    hits.push({
      file: relative(ROOT, file),
      line: lineOf(node),
      text: text.trim().slice(0, 80),
      context,
    })
  }

  function isInsideCallName(node: ts.Node, name: string): boolean {
    let current: ts.Node | undefined = node
    while (current) {
      if (ts.isCallExpression(current)) {
        const expr = current.expression
        if (ts.isIdentifier(expr) && expr.text === name) return true
        if (ts.isPropertyAccessExpression(expr) && expr.name.text === name) return true
      }
      current = current.parent
    }
    return false
  }

  function visit(node: ts.Node) {
    // JSX text content (but not in expressions like `{condition && 'text'}`)
    if (ts.isJsxText(node)) {
      addHit(node, node.text, 'JSX text')
      return
    }

    // String literals / template literals inside JSX attributes
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      // Ignore import declarations and t()/i18n keys
      if (ts.isImportDeclaration(node.parent) || isInsideCallName(node, 't')) {
        return
      }

      // JSX attribute values
      if (ts.isJsxAttribute(node.parent)) {
        const attrName = node.parent.name.text
        if (IGNORED_PROPS.has(attrName) || !USER_FACING_PROPS.has(attrName)) {
          return
        }
        addHit(node, node.text, `JSX prop "${attrName}"`)
        return
      }

      return
    }

    // Template literals in JSX attributes (e.g. aria-label={`Foo ${bar}`})
    if (ts.isTemplateExpression(node) || ts.isTemplateLiteral(node)) {
      if (ts.isJsxAttribute(node.parent)) {
        const attrName = node.parent.name.text
        if (IGNORED_PROPS.has(attrName) || !USER_FACING_PROPS.has(attrName)) {
          return
        }
        addHit(node, node.getText(sourceFile).slice(0, 80), `JSX template prop "${attrName}"`)
      }
      return
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return hits
}

function main() {
  const files = explicitFiles.length
    ? explicitFiles.map((f) => resolve(ROOT, f))
    : SCAN_DIRS.flatMap(collectFiles)

  const allHits: Hit[] = []
  for (const file of files) {
    if (file.includes('.test.') || file.includes('.spec.')) continue
    allHits.push(...findHits(file))
  }

  if (allHits.length === 0) {
    console.log(`i18n strings lint OK (${files.length} files scanned)`)
    process.exit(0)
  }

  console.error(`i18n strings lint: ${allHits.length} potential hard-coded string(s) found`)
  for (const hit of allHits) {
    console.error(`  ${hit.file}:${hit.line} [${hit.context}] "${hit.text}"`)
  }

  if (!strictMode) {
    console.error('\nRun with --strict to treat these as errors, or add intentional literals to the allowlist.')
    process.exit(0)
  }

  process.exit(1)
}

main()
