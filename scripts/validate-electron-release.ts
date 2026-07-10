import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT_DIR = join(import.meta.dir, '..')
const ELECTRON_DIR = join(ROOT_DIR, 'apps/electron')

type Failure = {
  message: string
  file?: string
  line?: number
}

const failures: Failure[] = []

function rel(path: string): string {
  return relative(ROOT_DIR, path).replace(/\\/g, '/')
}

function fail(message: string, file?: string, line?: number): void {
  failures.push({ message, file: file ? rel(file) : undefined, line })
}

function requireFile(path: string, minBytes = 1): void {
  if (!existsSync(path)) {
    fail(`missing file`, path)
    return
  }
  const stats = statSync(path)
  if (!stats.isFile()) {
    fail(`expected file`, path)
    return
  }
  if (stats.size < minBytes) {
    fail(`file too small (${stats.size} bytes, expected >= ${minBytes})`, path)
  }
}

function requireAbsent(path: string): void {
  if (existsSync(path)) {
    fail(`stale legacy path should not exist`, path)
  }
}

function requireTextIncludes(file: string, expected: string): void {
  const text = readFileSync(file, 'utf8')
  if (!text.includes(expected)) {
    fail(`expected to include ${JSON.stringify(expected)}`, file)
  }
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T
}

function walkTextFiles(path: string, visitor: (file: string) => void): void {
  if (!existsSync(path)) return
  const stats = statSync(path)
  if (stats.isFile()) {
    visitor(path)
    return
  }
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name === 'dist' || entry.name === 'release' || entry.name === 'node_modules') {
      continue
    }
    const child = join(path, entry.name)
    if (entry.isDirectory()) {
      walkTextFiles(child, visitor)
    } else if (/\.(cjs|html|js|json|md|ps1|sh|svg|ts|tsx|ya?ml)$/i.test(entry.name)) {
      visitor(child)
    }
  }
}

function scanForbiddenBranding(): void {
  const forbidden = [
    /Craft Agents/g,
    /Craft Agent/g,
    /Craft-Agents/g,
    /agents\.craft\.do/g,
    /craft_logo_c/g,
    /craft-logos/g,
    /com\.lukilabs\.craft-agent/g,
  ]
  const scanRoots = [
    join(ELECTRON_DIR, 'electron-builder.yml'),
    join(ELECTRON_DIR, 'package.json'),
    join(ELECTRON_DIR, 'resources/AGENTS.md'),
    join(ELECTRON_DIR, 'resources/bridge-mcp-server/index.js'),
    join(ELECTRON_DIR, 'resources/config-defaults.json'),
    join(ELECTRON_DIR, 'resources/docs'),
    join(ELECTRON_DIR, 'resources/scripts/tests'),
    join(ELECTRON_DIR, 'resources/themes'),
    join(ELECTRON_DIR, 'resources/tool-icons/tool-icons.json'),
    join(ELECTRON_DIR, 'scripts'),
    join(ELECTRON_DIR, 'src'),
    join(ROOT_DIR, 'packages/shared/src/i18n/locales'),
  ]

  for (const root of scanRoots) {
    walkTextFiles(root, file => {
      if (rel(file) === 'apps/electron/scripts/validate-assets.ts') {
        return
      }
      const lines = readFileSync(file, 'utf8').split(/\r?\n/)
      lines.forEach((line, index) => {
        for (const pattern of forbidden) {
          pattern.lastIndex = 0
          if (pattern.test(line)) {
            fail(`forbidden legacy branding matched ${pattern}`, file, index + 1)
          }
        }
      })
    })
  }
}

const appPackage = readJson<{
  description?: string
  author?: { name?: string; email?: string }
  homepage?: string
}>(join(ELECTRON_DIR, 'package.json'))

if (appPackage.description !== 'Oh My Pi desktop app') {
  fail(`unexpected Electron package description: ${appPackage.description ?? '(missing)'}`, join(ELECTRON_DIR, 'package.json'))
}
if (appPackage.author?.name !== 'Oh My Pi' || appPackage.author?.email !== 'support@ohmypi.com') {
  fail(`unexpected Electron package author`, join(ELECTRON_DIR, 'package.json'))
}
if (appPackage.homepage !== 'https://ohmypi.com') {
  fail(`unexpected Electron package homepage: ${appPackage.homepage ?? '(missing)'}`, join(ELECTRON_DIR, 'package.json'))
}

const builderFile = join(ELECTRON_DIR, 'electron-builder.yml')
requireTextIncludes(builderFile, 'appId: com.ohmypi.desktop')
requireTextIncludes(builderFile, 'productName: Oh My Pi')
requireTextIncludes(builderFile, 'executableName: Oh My Pi')
requireTextIncludes(builderFile, 'url: https://ohmypi.com/electron/latest')
requireTextIncludes(builderFile, 'artifactName: "Oh-My-Pi-Setup-${version}-${arch}.${ext}"')
requireTextIncludes(builderFile, 'artifactName: "Oh-My-Pi-${arch}.dmg"')
requireTextIncludes(builderFile, 'shortcutName: "Oh My Pi"')
requireTextIncludes(builderFile, 'uninstallDisplayName: "Oh My Pi"')
requireTextIncludes(builderFile, 'installerIcon: resources/installer.ico')
requireTextIncludes(builderFile, 'uninstallerIcon: resources/uninstaller.ico')
requireTextIncludes(builderFile, 'installerHeaderIcon: resources/installer.ico')

requireFile(join(ELECTRON_DIR, 'resources/icon.icns'), 1024)
requireFile(join(ELECTRON_DIR, 'resources/icon.ico'), 1024)
requireFile(join(ELECTRON_DIR, 'resources/installer.ico'), 1024)
requireFile(join(ELECTRON_DIR, 'resources/uninstaller.ico'), 1024)
requireFile(join(ELECTRON_DIR, 'resources/icon.png'), 1024)
requireFile(join(ELECTRON_DIR, 'resources/source.png'), 1024)
requireFile(join(ELECTRON_DIR, 'resources/icon.svg'), 128)
requireFile(join(ELECTRON_DIR, 'resources/icon.icon/Assets/icon.svg'), 128)
requireFile(join(ELECTRON_DIR, 'src/renderer/assets/ohmypi_logo.svg'), 128)

requireAbsent(join(ELECTRON_DIR, 'resources/craft-logos'))
requireAbsent(join(ELECTRON_DIR, 'src/renderer/assets/craft_logo_c.svg'))

scanForbiddenBranding()

if (failures.length > 0) {
  console.error('Electron release validation failed:')
  for (const failure of failures) {
    const location = failure.file ? `${failure.file}${failure.line ? `:${failure.line}` : ''}` : 'release'
    console.error(`- ${location}: ${failure.message}`)
  }
  process.exit(1)
}

console.log('Electron release metadata validated.')
