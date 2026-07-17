import { describe, expect, it } from 'bun:test'
import {
  clampThinkingLevelToSupported,
  getSupportedThinkingLevels,
} from '../model-capabilities.ts'

describe('model capability thinking levels', () => {
  it('limits Kimi Coding K2.7 to the four supported efforts', () => {
    const supported = getSupportedThinkingLevels(undefined, 'omp', 'kimi-code/kimi-for-coding')
    expect(supported).toEqual(['off', 'minimal', 'low', 'medium', 'high'])
    expect(clampThinkingLevelToSupported('max', supported!)).toBe('high')
  })

  it('keeps the Kimi restriction authoritative over stale cached metadata', () => {
    const supported = getSupportedThinkingLevels({
      id: 'kimi-code/kimi-for-coding', name: 'Kimi', shortName: 'Kimi',
      description: '', provider: 'omp', contextWindow: 128_000,
      supportedThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
    }, 'omp', 'kimi-code/kimi-for-coding')
    expect(supported).toEqual(['off', 'minimal', 'low', 'medium', 'high'])
  })

  it('does not expose disabled thinking for Fable/Mythos models', () => {
    const supported = getSupportedThinkingLevels('claude-fable-5', 'anthropic', 'claude-fable-5')
    expect(supported).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(clampThinkingLevelToSupported('off', supported!)).toBe('low')
  })

  it('preserves generic behavior for unknown models', () => {
    expect(getSupportedThinkingLevels(undefined, 'pi', 'future-model')).toBeUndefined()
  })
})
