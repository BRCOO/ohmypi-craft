import { describe, expect, it } from 'bun:test'
import {
  getKnownCompatLegacyDefaults,
  getKnownCompatModelDefaults,
  getKnownCompatProviderForUrl,
} from '../src/config/compat-models.ts'

describe('known compatible provider model defaults', () => {
  it('tracks the current Kimi Coding catalog instead of the K2.5 legacy list', () => {
    expect(getKnownCompatModelDefaults('kimi-coding')).toEqual([
      'k2p7',
      'kimi-for-coding',
      'kimi-k2-thinking',
    ])
    expect(getKnownCompatLegacyDefaults('kimi-coding')).toEqual([
      'k2p5',
      'kimi-k2-thinking',
    ])
  })

  it('tracks current MiniMax models for both regional endpoints', () => {
    expect(getKnownCompatModelDefaults('minimax-global')).toContain('MiniMax-M2.7')
    expect(getKnownCompatModelDefaults('minimax-cn')).toContain('MiniMax-M3')
    expect(getKnownCompatLegacyDefaults('minimax-cn')).toEqual([
      'MiniMax-M2.5',
      'MiniMax-M2.5-highspeed',
    ])
  })

  it('recognizes only the built-in branded endpoints', () => {
    expect(getKnownCompatProviderForUrl('https://api.kimi.com/coding')).toBe('kimi-coding')
    expect(getKnownCompatProviderForUrl('https://api.kimi.com/coding/v1/')).toBe('kimi-coding')
    expect(getKnownCompatProviderForUrl('https://api.minimax.io/anthropic')).toBe('minimax-global')
    expect(getKnownCompatProviderForUrl('https://api.minimaxi.com/anthropic/')).toBe('minimax-cn')
    expect(getKnownCompatProviderForUrl('https://example.com/anthropic')).toBeUndefined()
  })
})
