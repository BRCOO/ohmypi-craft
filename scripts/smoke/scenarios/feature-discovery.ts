import { cleanup, connectClient, createSmokeWorkspace, screenshot, spawnPackagedApp, type RunnerOptions, type ScenarioResult, type SmokeContext } from '../helpers.ts'

export const name = 'feature-discovery'

interface CapabilityDto {
  items?: unknown[]
  error?: string
  parseErrors?: string[]
}

interface FeatureCenterState {
  skills?: CapabilityDto
  mcp?: CapabilityDto
  agents?: CapabilityDto
}

export async function run(ctx: SmokeContext, opts: RunnerOptions): Promise<ScenarioResult> {
  const start = Date.now()
  const evidence: string[] = []
  let succeeded = false

  try {
    ctx.child = spawnPackagedApp(ctx)
    const client = await connectClient(ctx, opts.timeoutMs)
    await createSmokeWorkspace(client, ctx.workspaceDir)

    const state = await client.invoke('omp:getFeatureCenterState') as FeatureCenterState

    await screenshot(ctx, 'feature-discovery')

    const diagnostics: string[] = []
    const categories: (keyof FeatureCenterState)[] = ['skills', 'mcp', 'agents']
    for (const key of categories) {
      const category = state?.[key]
      if (!category) {
        diagnostics.push(`Missing category: ${key}`)
        continue
      }
      const parseErrors = category.parseErrors ?? []
      if (parseErrors.length > 0) {
        diagnostics.push(`${key} parse errors: ${parseErrors.join('; ')}`)
      }
      if (category.error) {
        diagnostics.push(`${key} error: ${category.error}`)
      }
    }

    if (diagnostics.length > 0) {
      throw new Error(`Feature discovery diagnostics: ${diagnostics.join(' | ')}`)
    }

    succeeded = true
    return {
      name,
      status: 'passed',
      durationMs: Date.now() - start,
      output: `Feature center categories present: ${categories.join(', ')}`,
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
