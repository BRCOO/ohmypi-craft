import { describe, expect, it } from 'bun:test'
import { unwrapOmpSessionCommandResult } from '../useOmpSessionCommand'

describe('unwrapOmpSessionCommandResult', () => {
  it('returns the raw OMP payload from a successful session-manager envelope', () => {
    expect(unwrapOmpSessionCommandResult({ success: true, data: [{ id: 'runtime_state' }] }))
      .toEqual([{ id: 'runtime_state' }])
  })

  it('rejects structured OMP command failures', () => {
    expect(() => unwrapOmpSessionCommandResult({ success: false, error: 'Not supported' }))
      .toThrow('Not supported')
  })

  it('does not mistake a raw OMP result with success for an envelope', () => {
    const result = { toolId: 'runtime_state', success: true, output: {} }
    expect(unwrapOmpSessionCommandResult(result)).toBe(result)
  })
})
