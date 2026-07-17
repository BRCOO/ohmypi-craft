import { describe, expect, it } from 'bun:test'
import { buildRpcPayload, OMP_DOCTOR_RPC_COMMANDS, resolveOmpCliCommand } from './index.ts'
import { OMP_CLI_COMMANDS, OMP_CLI_GLOBAL_FLAGS, findOmpCliCommand } from './commands.ts'

describe('omp-cli', () => {
  it('builds hyphenated RPC command payloads', () => {
    expect(buildRpcPayload('get-state')).toEqual({ type: 'get_state' })
    expect(buildRpcPayload('set-model', '{"provider":"kimi-code","modelId":"kimi-for-coding"}')).toEqual({
      type: 'set_model',
      provider: 'kimi-code',
      modelId: 'kimi-for-coding',
    })
    expect(buildRpcPayload('set_model', 'provider=kimi-code modelId=kimi-for-coding')).toEqual({
      type: 'set_model',
      provider: 'kimi-code',
      modelId: 'kimi-for-coding',
    })
  })

  it('rejects non-object RPC payloads', () => {
    expect(() => buildRpcPayload('get_state', '[]')).toThrow('RPC payload must be a JSON object')
  })

  it('prefers OMP_COMMAND over the bundled runtime', () => {
    const result = resolveOmpCliCommand({ OMP_COMMAND: '"C:\\Program Files\\omp.exe" --profile work' })
    expect(result).toEqual({
      command: 'C:\\Program Files\\omp.exe',
      args: ['--profile', 'work'],
      source: 'env',
    })
  })

  it('mirrors the complete upstream command and global flag surface', () => {
    expect(OMP_CLI_COMMANDS.length).toBeGreaterThanOrEqual(30)
    expect(OMP_CLI_GLOBAL_FLAGS).toContain('--model')
    expect(OMP_CLI_GLOBAL_FLAGS).toContain('--mode')
    expect(findOmpCliCommand('acp')?.description).toContain('Agent Client Protocol')
    expect(findOmpCliCommand('worktree')).toBeDefined()
  })

  it('audits every desktop control-mode RPC surface', () => {
    expect(OMP_DOCTOR_RPC_COMMANDS).toContain('get_plan_mode_state')
    expect(OMP_DOCTOR_RPC_COMMANDS).toContain('get_goal_state')
    expect(OMP_DOCTOR_RPC_COMMANDS).toContain('get_loop_state')
    expect(OMP_DOCTOR_RPC_COMMANDS).toContain('get_runtime_resources')
  })
})
