import { connectClient, createSmokeWorkspace, cleanup, screenshot, spawnPackagedApp, type RunnerOptions, type ScenarioResult, type SmokeContext } from '../helpers.ts'

export const name = 'runtime-resolution'

export async function run(ctx: SmokeContext, opts: RunnerOptions): Promise<ScenarioResult> {
  const start = Date.now()
  const evidence: string[] = []
  let succeeded = false

  try {
    ctx.child = spawnPackagedApp(ctx)
    const client = await connectClient(ctx, opts.timeoutMs)

    await client.invoke('system:versions').catch(() => {})
    await createSmokeWorkspace(client, ctx.workspaceDir)

    const status = await client.invoke('omp:getStatus') as {
      ok?: boolean
      source?: string
      version?: string
      error?: string
    }

    await screenshot(ctx, 'runtime-status')

    if (!status?.ok) {
      throw new Error(`OMP runtime not ok: ${status?.error ?? JSON.stringify(status)}`)
    }
    if (status.source !== 'bundled') {
      throw new Error(`Expected bundled OMP runtime, got: ${status.source}`)
    }
    if (!status.version || typeof status.version !== 'string') {
      throw new Error(`Expected OMP runtime version string, got: ${status.version}`)
    }

    succeeded = true
    return {
      name,
      status: 'passed',
      durationMs: Date.now() - start,
      output: `OMP runtime ok, source=${status.source}, version=${status.version}`,
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
