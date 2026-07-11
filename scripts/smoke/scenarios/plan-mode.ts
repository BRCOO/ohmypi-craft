import { setupLlmConnection, type CliArgs } from '../../../apps/cli/src/index.ts'
import { cleanup, connectClient, createSmokeSession, createSmokeWorkspace, screenshot, spawnPackagedApp, waitForSessionEvents, type RunnerOptions, type ScenarioResult, type SmokeContext } from '../helpers.ts'

export const name = 'plan-mode'

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

function isPlanModeEvent(ev: Record<string, unknown>): boolean {
  const type = String(ev.type ?? '')
  if (type === 'omp_control_state_changed') {
    const state = (ev.state ?? {}) as Record<string, unknown>
    const plan = (state.plan ?? {}) as Record<string, unknown>
    const planState = (plan.state ?? {}) as Record<string, unknown>
    return planState.phase === 'planning'
  }
  if (type === 'info') {
    const text = String(ev.text ?? '')
    return /plan|planning/i.test(text)
  }
  if (type === 'extension_ui_request') {
    const request = ev.request as Record<string, unknown> | undefined
    const kind = String(request?.kind ?? request?.type ?? '')
    return /plan/i.test(kind)
  }
  return false
}

function isPlanModeExitEvent(ev: Record<string, unknown>): boolean {
  if (String(ev.type ?? '') !== 'omp_control_state_changed') return false
  const state = (ev.state ?? {}) as Record<string, unknown>
  const plan = (state.plan ?? {}) as Record<string, unknown>
  const planState = (plan.state ?? {}) as Record<string, unknown>
  return planState.phase === 'inactive' && planState.enabled === false
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

    const sessionId = await createSmokeSession(client, workspaceId, 'Smoke plan mode')

    // Subscribe before sending the command. The RPC handler publishes its
    // authoritative control-state frame before it resolves, so subscribing
    // afterwards races the event and turns a successful transition into a
    // long timeout.
    const enterWait = waitForSessionEvents(
      client,
      sessionId,
      (ev) => isPlanModeEvent(ev),
      opts.sendTimeoutMs,
    )

    // The packaged candidate is required to ship a Plan-capable runtime. An
    // unavailable capability is a test failure, not an acceptable skip.
    await client.invoke('sessions:command', sessionId, { type: 'setOmpPlanMode', enabled: true })

    const enterResult = await enterWait

    if (!enterResult.matchedEvent) {
      throw new Error(`Plan mode entry event not received. Events: ${enterResult.seenTypes.join(', ') || 'none'}`)
    }

    const exitWait = waitForSessionEvents(
      client,
      sessionId,
      (ev) => isPlanModeExitEvent(ev),
      opts.sendTimeoutMs,
    )

    // Exit plan mode and wait for the corresponding authoritative state.
    await client.invoke('sessions:command', sessionId, { type: 'setOmpPlanMode', enabled: false })
    const exitResult = await exitWait
    if (!exitResult.matchedEvent) {
      throw new Error(`Plan mode exit event not received. Events: ${exitResult.seenTypes.join(', ') || 'none'}`)
    }

    await screenshot(ctx, 'plan-mode')

    succeeded = true
    return {
      name,
      status: 'passed',
      durationMs: Date.now() - start,
      output: `Plan mode entered and exited. Entry event type: ${enterResult.matchedEvent.type}. Exit event type: ${exitResult.matchedEvent.type}.`,
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
