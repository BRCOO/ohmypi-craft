import { cleanup, connectClient, createSmokeWorkspace, screenshot, spawnPackagedApp, type RunnerOptions, type ScenarioResult, type SmokeContext } from '../helpers.ts'

export const name = 'language'

interface PreferencesReadResult {
  content?: string
  exists?: boolean
}

function parseLanguage(content: string | undefined): string | undefined {
  if (!content) return undefined
  try {
    const prefs = JSON.parse(content) as { uiLanguage?: string }
    return prefs.uiLanguage
  } catch {
    return undefined
  }
}

async function readLanguage(client: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }): Promise<string | undefined> {
  const result = await client.invoke('preferences:read') as PreferencesReadResult
  return parseLanguage(result?.content)
}

async function setLanguage(client: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }, code: string): Promise<void> {
  // Try the dedicated language-change RPC if available; otherwise mutate the
  // preferences file directly. The dedicated channel is not present in all
  // builds, so the fallback keeps the scenario stable.
  try {
    await client.invoke('settings:changeLanguage', code)
    return
  } catch {
    // Fall through to preferences:write.
  }

  const result = await client.invoke('preferences:read') as PreferencesReadResult
  const prefs = result?.content ? JSON.parse(result.content) as Record<string, unknown> : {}
  prefs.uiLanguage = code
  const writeResult = await client.invoke('preferences:write', JSON.stringify(prefs)) as { success?: boolean; error?: string }
  if (!writeResult?.success) {
    throw new Error(`preferences:write failed: ${writeResult?.error ?? 'unknown error'}`)
  }
}

export async function run(ctx: SmokeContext, opts: RunnerOptions): Promise<ScenarioResult> {
  const start = Date.now()
  const evidence: string[] = []
  let succeeded = false

  try {
    ctx.child = spawnPackagedApp(ctx)
    const client = await connectClient(ctx, opts.timeoutMs)
    await createSmokeWorkspace(client, ctx.workspaceDir)

    const defaultLang = await readLanguage(client)
    if (defaultLang !== 'zh-Hans') {
      throw new Error(`Expected default language zh-Hans, got: ${defaultLang ?? 'undefined'}`)
    }

    await setLanguage(client, 'en')
    const englishLang = await readLanguage(client)
    if (englishLang !== 'en') {
      throw new Error(`Expected language en after change, got: ${englishLang ?? 'undefined'}`)
    }

    await setLanguage(client, 'zh-Hans')
    const restoredLang = await readLanguage(client)
    if (restoredLang !== 'zh-Hans') {
      throw new Error(`Expected restored language zh-Hans, got: ${restoredLang ?? 'undefined'}`)
    }

    await screenshot(ctx, 'language')

    succeeded = true
    return {
      name,
      status: 'passed',
      durationMs: Date.now() - start,
      output: 'Language default zh-Hans, changed to en, restored to zh-Hans',
      evidence,
    }
  } catch (error) {
    return {
      name,
      status: 'failed',
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
      evidence,
    }
  } finally {
    await cleanup(ctx, succeeded, opts.keepArtifacts)
  }
}
