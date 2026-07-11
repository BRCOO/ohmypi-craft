import { setupLlmConnection, type CliArgs } from '../../../apps/cli/src/index.ts'
import { cleanup, connectClient, createSmokeSession, createSmokeWorkspace, screenshot, spawnPackagedApp, waitForSessionTerminal, type RunnerOptions, type ScenarioResult, type SmokeContext } from '../helpers.ts'

export const name = 'session-handshake'

function cliSetupArgs(sendTimeoutMs: number): CliArgs {
  return {
    url: '',
    token: '',
    timeout: 30_000,
    json: false,
    sendTimeout: sendTimeoutMs,
    command: '',
    rest: [],
    sources: [],
    mode: '',
    outputFormat: 'text',
    noCleanup: false,
    noSpinner: true,
    verbose: false,
    provider: 'omp',
    model: '',
    apiKey: '',
    baseUrl: '',
  }
}

export async function run(ctx: SmokeContext, opts: RunnerOptions): Promise<ScenarioResult> {
  const start = Date.now()
  const evidence: string[] = []
  let succeeded = false

  try {
    ctx.child = spawnPackagedApp(ctx)
    const client = await connectClient(ctx, opts.timeoutMs)

    const workspaceId = await createSmokeWorkspace(client, ctx.workspaceDir)
    await setupLlmConnection(client, cliSetupArgs(opts.sendTimeoutMs))

    const sessionId = await createSmokeSession(client, workspaceId, 'Smoke session handshake')
    await client.invoke('sessions:sendMessage', sessionId, '/context')

    const result = await waitForSessionTerminal(client, sessionId, opts.sendTimeoutMs)
    await screenshot(ctx, 'session-handshake')

    const hasMeaningfulEvent = result.seenTypes.some(t =>
      ['text_delta', 'info', 'tool_start', 'complete'].includes(t),
    )

    if (result.terminalError) {
      throw new Error(`Session emitted terminal error: ${result.terminalError}. Events: ${result.seenTypes.join(', ') || 'none'}`)
    }
    if (!hasMeaningfulEvent) {
      throw new Error(`Session did not emit any meaningful event. Events: ${result.seenTypes.join(', ') || 'none'}`)
    }

    succeeded = true
    return {
      name,
      status: 'passed',
      durationMs: Date.now() - start,
      output: `Session ${sessionId} received events: ${result.seenTypes.join(', ')}`,
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
