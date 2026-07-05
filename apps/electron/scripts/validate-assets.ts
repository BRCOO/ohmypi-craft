import { existsSync, statSync } from 'fs'
import { join, relative } from 'path'

const electronDir = join(import.meta.dir, '..')
const requireDist = !process.argv.includes('--skip-dist')

type Check = {
  path: string
  minBytes?: number
  kind?: 'file' | 'directory'
}

const resourceChecks: Check[] = [
  { path: 'resources/icon.icns', minBytes: 1024 },
  { path: 'resources/icon.ico', minBytes: 1024 },
  { path: 'resources/icon.png', minBytes: 1024 },
  { path: 'resources/icon.svg', minBytes: 128 },
  { path: 'resources/source.png', minBytes: 1024 },
  { path: 'resources/icon.icon/Assets/icon.svg', minBytes: 128 },
  { path: 'resources/config-defaults.json', minBytes: 128 },
  { path: 'resources/bin', kind: 'directory' },
  { path: 'resources/bridge-mcp-server', kind: 'directory' },
  { path: 'resources/docs', kind: 'directory' },
  { path: 'resources/permissions', kind: 'directory' },
  { path: 'resources/scripts', kind: 'directory' },
  { path: 'resources/themes', kind: 'directory' },
  { path: 'resources/tool-icons', kind: 'directory' },
]

const distChecks: Check[] = [
  { path: 'dist/resources/icon.icns', minBytes: 1024 },
  { path: 'dist/resources/icon.ico', minBytes: 1024 },
  { path: 'dist/resources/icon.png', minBytes: 1024 },
  { path: 'dist/resources/config-defaults.json', minBytes: 128 },
  { path: 'dist/resources/powershell-parser.ps1', minBytes: 128 },
  { path: 'dist/resources/docs', kind: 'directory' },
  { path: 'dist/resources/tool-icons', kind: 'directory' },
]

const stalePaths = [
  'resources/craft-logos',
  'resources/craft_logo_c.svg',
]

const failures: string[] = []

function describe(path: string): string {
  return relative(electronDir, join(electronDir, path)).replace(/\\/g, '/')
}

function checkPath(check: Check): void {
  const absolute = join(electronDir, check.path)
  const display = describe(check.path)
  if (!existsSync(absolute)) {
    failures.push(`missing ${check.kind ?? 'file'}: ${display}`)
    return
  }

  const stats = statSync(absolute)
  if (check.kind === 'directory') {
    if (!stats.isDirectory()) {
      failures.push(`expected directory: ${display}`)
    }
    return
  }

  if (!stats.isFile()) {
    failures.push(`expected file: ${display}`)
    return
  }

  if (check.minBytes && stats.size < check.minBytes) {
    failures.push(`file too small: ${display} (${stats.size} bytes, expected >= ${check.minBytes})`)
  }
}

for (const check of resourceChecks) {
  checkPath(check)
}

for (const stalePath of stalePaths) {
  if (existsSync(join(electronDir, stalePath))) {
    failures.push(`stale legacy asset should not be present: ${describe(stalePath)}`)
  }
}

if (requireDist) {
  for (const check of distChecks) {
    checkPath(check)
  }
} else {
  console.log('Skipping dist/resources checks (--skip-dist).')
}

if (failures.length > 0) {
  console.error('Electron asset validation failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Electron assets validated.')
