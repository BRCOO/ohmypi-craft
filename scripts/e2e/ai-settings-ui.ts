#!/usr/bin/env bun
/**
 * Packaged Electron + Playwright CDP UI test for the AI settings OMP
 * diagnostics panel.
 *
 * Covers:
 *   - feature count tiles (MCP / Skills / Agents)
 *   - failure / unavailable status attributes
 *   - navigation click to Feature Center section
 *   - Browser/LSP/GitHub/SSH "diagnostics not wired" rows
 *
 * Requirements:
 *   - playwright-core installed (`bun add -d playwright-core`)
 *   - packaged or built Electron app available
 *
 * Usage:
 *   bun run scripts/e2e/ai-settings-ui.ts
 *   bun run scripts/e2e/ai-settings-ui.ts --exe "apps/electron/release/win-unpacked/Oh My Pi.exe"
 *
 * Skip (exit 0) when playwright-core is missing or the exe is absent, so
 * quality:quick stays green without Electron packaging.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

function defaultExe(): string {
  if (process.platform === 'win32') {
    return join(ROOT, 'apps', 'electron', 'release', 'win-unpacked', 'Oh My Pi.exe')
  }
  if (process.platform === 'darwin') {
    return join(ROOT, 'apps', 'electron', 'release', 'mac', 'Oh My Pi.app', 'Contents', 'MacOS', 'Oh My Pi')
  }
  return join(ROOT, 'apps', 'electron', 'release', 'linux-unpacked', 'oh-my-pi')
}

function parseArgs(argv: string[]): { exe: string; timeoutMs: number; strict: boolean } {
  let exe = defaultExe()
  let timeoutMs = 120_000
  let strict = false
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--exe') exe = argv[++i] ?? exe
    else if (arg === '--timeout') timeoutMs = Number(argv[++i] ?? timeoutMs)
    else if (arg === '--strict') strict = true
  }
  return { exe: resolve(exe), timeoutMs, strict }
}

async function loadPlaywright(): Promise<typeof import('playwright-core') | null> {
  try {
    return await import('playwright-core')
  } catch {
    return null
  }
}

async function findFreePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise<void>(resolve => server.close(() => resolve()))
  if (!port) throw new Error('Could not allocate a free CDP port for the UI test')
  return port
}

async function waitForPage(
  context: import('playwright-core').BrowserContext,
  timeoutMs: number,
): Promise<import('playwright-core').Page> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const page = context.pages()[0]
    if (page) return page
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`No Electron renderer page appeared within ${timeoutMs}ms`)
}

async function connectToElectronCdp(
  chromium: typeof import('playwright-core').chromium,
  port: number,
  timeoutMs: number,
): Promise<import('playwright-core').Browser> {
  const deadline = Date.now() + timeoutMs
  let lastError = 'unknown error'
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP({
        endpointURL: `http://127.0.0.1:${port}`,
        timeout: Math.min(5_000, Math.max(500, deadline - Date.now())),
      })
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }
  throw new Error(`Timed out connecting to Electron CDP on port ${port}: ${lastError}`)
}

function stopChild(child: ChildProcessWithoutNullStreams | undefined): void {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill()
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv)
  const pw = await loadPlaywright()
  if (!pw) {
    const msg = 'playwright-core not installed — skipping Electron AI settings UI test'
    if (opts.strict) {
      console.error(msg)
      process.exit(1)
    }
    console.warn(msg)
    process.exit(0)
  }

  if (!existsSync(opts.exe)) {
    const msg = `Electron exe not found at ${opts.exe} — skipping AI settings UI test`
    if (opts.strict) {
      console.error(msg)
      process.exit(1)
    }
    console.warn(msg)
    process.exit(0)
  }

  const userDataDir = join(ROOT, '.tmp', `ai-settings-ui-${Date.now()}`)
  mkdirSync(userDataDir, { recursive: true })
  const configDir = join(userDataDir, 'config')
  const fakeGitBashPath = join(userDataDir, 'bash.exe')
  mkdirSync(configDir, { recursive: true })
  // This test targets the settings page, not onboarding. Seed the isolated
  // profile as a deferred setup and provide a file-shaped bash.exe path so the
  // Windows onboarding guard cannot obscure the panel under test.
  writeFileSync(fakeGitBashPath, 'ui-test placeholder', 'utf-8')
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({
    workspaces: [],
    activeWorkspaceId: null,
    activeSessionId: null,
    setupDeferred: true,
    gitBashPath: fakeGitBashPath,
  }), 'utf-8')

  // The Electron main process treats the presence of CRAFT_HEADLESS as
  // headless mode (`Boolean(process.env.CRAFT_HEADLESS)`), so a value such as
  // "0" still suppresses BrowserWindow creation. Remove any inherited flag
  // instead of setting a false-looking string.
  const testEnv = {
    ...process.env,
    CRAFT_CONFIG_DIR: configDir,
    // Keep main-process diagnostics enabled for failures while Electron still
    // reports its real packaged state via app.isPackaged at startup.
    CRAFT_IS_PACKAGED: 'false',
    CRAFT_APP_NAME: `Oh My Pi UI Test ${Date.now()}`,
    NO_UPDATE_NOTIFIER: '1',
  }
  delete testEnv.CRAFT_HEADLESS
  // Playwright's Electron launcher injects a loader only when it starts the
  // Electron binary itself. A packaged executable does not load that helper,
  // so use Chromium CDP against the packaged app's own remote-debugging port.
  const cdpPort = await findFreePort()
  let child: ChildProcessWithoutNullStreams | undefined
  let browser: import('playwright-core').Browser | undefined

  const failures: string[] = []
  try {
    child = spawn(opts.exe, [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${userDataDir}`,
    ], {
      cwd: dirname(opts.exe),
      env: testEnv,
      windowsHide: true,
      stdio: 'pipe',
    })
    // Drain both streams so a verbose packaged build cannot block on a full
    // pipe while the test is waiting for the CDP endpoint.
    child.stdout.on('data', () => {})
    child.stderr.on('data', () => {})
    browser = await connectToElectronCdp(pw.chromium, cdpPort, opts.timeoutMs)
    const context = browser.contexts()[0]
    if (!context) throw new Error('Electron CDP connected without a browser context')
    const window = await waitForPage(context, opts.timeoutMs)
    await window.waitForLoadState('domcontentloaded', { timeout: opts.timeoutMs })

    // Clean profiles may still render the provider wizard even with deferred
    // setup seeded above. Dismiss it through the real UI before navigating to
    // Settings so the test validates the page rather than onboarding.
    const setupLater = window.getByRole('button', { name: /稍后设置|set up later/i })
    if ((await setupLater.count()) > 0) {
      await setupLater.first().click()
      await window.waitForTimeout(1_000)
    }

    // Use the real sidebar navigation first. The renderer's route is not a
    // browser hash route in packaged builds, so changing location.hash alone
    // leaves the shell on All Sessions.
    const settingsNav = window.getByText('设置', { exact: true }).first()
    if ((await settingsNav.count()) > 0) {
      await settingsNav.click()
      await window.waitForTimeout(500)
    }
    const aiNav = window.getByText('AI', { exact: true }).first()
    if ((await aiNav.count()) > 0) {
      await aiNav.click()
      await window.waitForTimeout(500)
    }

    // Keep a route fallback for builds whose settings navigation is collapsed.
    // Prefer in-app navigation through evaluate when electronAPI is ready.
    await window.waitForTimeout(2_000)
    await window.evaluate(() => {
      // Deep-link style: many Craft builds restore route from query or hash.
      const target = '#/settings/ai'
      if (location.hash !== target) {
        location.hash = target
      }
      // Also try the typed navigate helper if present.
      try {
        // @ts-expect-error runtime optional
        window.dispatchEvent(new CustomEvent('craft:navigate', { detail: { path: 'settings/ai' } }))
      } catch {
        // ignore
      }
    })

    // Wait for diagnostics panel if rendered; if the shell requires onboarding,
    // record a soft skip rather than hard-failing clean profiles.
    const panel = window.locator('[data-testid="omp-ai-diagnostics-panel"]')
    const appeared = await panel.waitFor({ state: 'visible', timeout: 45_000 }).then(() => true).catch(() => false)
    if (!appeared) {
      const body = await window.locator('body').innerText().catch(() => '')
      writeFileSync(join(userDataDir, 'page.txt'), body, 'utf-8')
      throw new Error(
        'omp-ai-diagnostics-panel not visible within 45s (onboarding or route may have blocked AI settings). ' +
          `url=${window.url()} bodyPreview=${body.slice(0, 400)}`,
      )
    }

    // Feature count tiles exist and expose status attributes.
    for (const section of ['mcp', 'skills', 'agents'] as const) {
      const tile = window.locator(`[data-testid="omp-feature-count-${section}"]`)
      if ((await tile.count()) === 0) {
        failures.push(`missing feature count tile: ${section}`)
        continue
      }
      const status = await tile.getAttribute('data-status')
      if (!status || !['ok', 'loading', 'error'].includes(status)) {
        failures.push(`feature count ${section} has unexpected status=${status}`)
      }
    }

    // Unwired diagnostics always show not-wired for Browser/LSP/GitHub/SSH.
    for (const id of ['browser', 'lsp', 'github', 'ssh'] as const) {
      const row = window.locator(`[data-testid="omp-unwired-${id}"]`)
      if ((await row.count()) === 0) {
        failures.push(`missing unwired diagnostic row: ${id}`)
        continue
      }
      const diag = await row.getAttribute('data-diagnostic-status')
      if (diag !== 'not-wired') {
        failures.push(`unwired row ${id} status=${diag}, expected not-wired`)
      }
    }

    // Navigation: click skills tile and expect route/section focus side effect.
    const skills = window.locator('[data-testid="omp-feature-count-skills"]')
    if ((await skills.count()) > 0) {
      await skills.click()
      await window.waitForTimeout(1_000)
      const afterUrl = window.url()
      const body = await window.locator('body').innerText().catch(() => '')
      const navigated =
        /settings\/omp|omp/i.test(afterUrl)
        || /功能中心|Feature Center|Skills|技能/i.test(body)
      if (!navigated) {
        failures.push(`clicking skills tile did not navigate toward Feature Center (url=${afterUrl})`)
      }
    }

    if (failures.length > 0) {
      throw new Error(`AI settings UI assertions failed:\n- ${failures.join('\n- ')}`)
    }

    console.log('AI settings Electron/Playwright UI test passed')
    console.log(`  exe: ${opts.exe}`)
    console.log(`  userData: ${userDataDir}`)
  } finally {
    await browser?.close().catch(() => {})
    stopChild(child)
  }
}

main().catch((error) => {
  console.error('AI settings UI test failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
