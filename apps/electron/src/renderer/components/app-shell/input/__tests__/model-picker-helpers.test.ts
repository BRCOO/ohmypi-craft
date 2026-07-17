/**
 * Pure-helper coverage for the model-picker. The helpers are tiny but they
 * back both the desktop dropdown and the compact (drawer) selector — pinning
 * the behavior here so future refactors of the picker can't quietly diverge
 * the two surfaces.
 */

import { describe, test, expect } from 'bun:test'
import type { LlmConnection } from '@craft-agent/shared/config/llm-connections'
import {
  clampThinkingLevelToModel,
  formatTokenCount,
  getThinkingLevelsForModel,
  groupConnectionsByProvider,
  stripPiPrefixForDisplay,
} from '../model-picker-helpers'

// -----------------------------------------------------------------------------
// stripPiPrefixForDisplay
// -----------------------------------------------------------------------------

describe('stripPiPrefixForDisplay', () => {
  test('strips the "pi/" prefix when present', () => {
    expect(stripPiPrefixForDisplay('pi/claude-opus-4-7')).toBe('claude-opus-4-7')
  })

  test('returns input unchanged when prefix is absent', () => {
    expect(stripPiPrefixForDisplay('claude-opus-4-7')).toBe('claude-opus-4-7')
  })

  test('does NOT strip "pi:" (legacy other-form prefix)', () => {
    // The prefix is "pi/" — the alternative "pi:" form is intentionally not
    // collapsed because some IDs use a colon for unrelated purposes.
    expect(stripPiPrefixForDisplay('pi:claude-opus-4-7')).toBe('pi:claude-opus-4-7')
  })

  test('only strips at the start, not mid-string', () => {
    expect(stripPiPrefixForDisplay('foo-pi/bar')).toBe('foo-pi/bar')
  })

  test('handles empty string', () => {
    expect(stripPiPrefixForDisplay('')).toBe('')
  })
})

// -----------------------------------------------------------------------------
// formatTokenCount
// -----------------------------------------------------------------------------

describe('formatTokenCount', () => {
  test('renders zero as "0"', () => {
    expect(formatTokenCount(0)).toBe('0')
  })

  test('renders < 1k literally', () => {
    expect(formatTokenCount(42)).toBe('42')
    expect(formatTokenCount(999)).toBe('999')
  })

  test('renders 1k..<10k with one decimal', () => {
    expect(formatTokenCount(1000)).toBe('1.0k')
    expect(formatTokenCount(1500)).toBe('1.5k')
    expect(formatTokenCount(9999)).toBe('10.0k')
  })

  test('renders ≥ 10k as whole-k', () => {
    expect(formatTokenCount(10_000)).toBe('10k')
    expect(formatTokenCount(200_000)).toBe('200k')
    expect(formatTokenCount(999_999)).toBe('1000k')
  })

  test('renders ≥ 1M with one decimal', () => {
    expect(formatTokenCount(1_000_000)).toBe('1.0M')
    expect(formatTokenCount(1_500_000)).toBe('1.5M')
    expect(formatTokenCount(12_345_678)).toBe('12.3M')
  })
})

// -----------------------------------------------------------------------------
// Thinking levels
// -----------------------------------------------------------------------------

describe('model-specific thinking levels', () => {
  test('shows only Kimi Coding K2.7 efforts for a persisted OMP catalog', () => {
    const levels = getThinkingLevelsForModel(
      undefined,
      'omp',
      'kimi-code/kimi-for-coding',
    )
    expect(levels.map(level => level.id)).toEqual(['off', 'minimal', 'low', 'medium', 'high'])
  })

  test('uses the model-advertised levels before provider fallbacks', () => {
    const levels = getThinkingLevelsForModel({
      id: 'pi/example',
      name: 'Example',
      shortName: 'Example',
      description: 'Example model',
      provider: 'pi',
      contextWindow: 1,
      supportsThinking: true,
      supportedThinkingLevels: ['low', 'high'],
    }, 'pi', 'pi/example')
    expect(levels.map(level => level.id)).toEqual(['low', 'high'])
  })

  test('does not invent OMP/Pi minimal effort for an unadvertised provider', () => {
    const levels = getThinkingLevelsForModel(undefined, 'anthropic', 'future-model')
    expect(levels.map(level => level.id)).toEqual(['off', 'low', 'medium', 'high', 'xhigh', 'max'])
  })

  test('hides the selector for models that explicitly do not support reasoning', () => {
    const levels = getThinkingLevelsForModel({
      id: 'pi/plain-chat',
      name: 'Plain chat',
      shortName: 'Plain',
      description: 'No reasoning',
      provider: 'pi',
      contextWindow: 1,
      supportsThinking: false,
    }, 'pi', 'pi/plain-chat')
    expect(levels).toEqual([])
  })

  test('clamps an incompatible persisted effort down to the model ceiling', () => {
    const k27Levels = getThinkingLevelsForModel(
      undefined,
      'omp',
      'kimi-code/kimi-for-coding',
    )
    expect(clampThinkingLevelToModel('max', k27Levels)).toBe('high')
    expect(clampThinkingLevelToModel('xhigh', k27Levels)).toBe('high')
  })
})

// -----------------------------------------------------------------------------
// groupConnectionsByProvider
// -----------------------------------------------------------------------------

function conn(
  slug: string,
  providerType: LlmConnection['providerType'],
  extras: Partial<LlmConnection> = {},
): LlmConnection {
  return {
    slug,
    name: slug,
    providerType,
    authType: 'api_key',
    createdAt: 0,
    ...extras,
  }
}

describe('groupConnectionsByProvider', () => {
  test('returns empty array for empty input', () => {
    expect(groupConnectionsByProvider([])).toEqual([])
  })

  test('groups anthropic providers into "Anthropic"', () => {
    const a = conn('a', 'anthropic')
    const b = conn('b', 'anthropic')
    const result = groupConnectionsByProvider([a, b])
    expect(result).toEqual([['Anthropic', [a, b]]])
  })

  test('preserves intra-group order', () => {
    const a = conn('first', 'anthropic')
    const b = conn('second', 'anthropic')
    const c = conn('third', 'anthropic')
    const result = groupConnectionsByProvider([a, b, c])
    expect(result[0][1].map(c => c.slug)).toEqual(['first', 'second', 'third'])
  })

  test('places "Anthropic" group before pi groups (display order)', () => {
    const piConn = conn('pi-1', 'pi')
    const anth = conn('anthropic-1', 'anthropic')
    const result = groupConnectionsByProvider([piConn, anth])
    expect(result.map(([k]) => k)).toEqual(['Anthropic', 'Oh My Pi Backend'])
  })

  test('"pi_compat" with localhost baseUrl goes to "Local"', () => {
    const local = conn('ollama', 'pi_compat', { baseUrl: 'http://localhost:11434' })
    const result = groupConnectionsByProvider([local])
    expect(result).toEqual([['Local', [local]]])
  })

  test('"pi_compat" with remote baseUrl goes to "Oh My Pi Backend"', () => {
    const remote = conn('openrouter', 'pi_compat', { baseUrl: 'https://openrouter.ai/api/v1' })
    const result = groupConnectionsByProvider([remote])
    expect(result).toEqual([['Oh My Pi Backend', [remote]]])
  })

  test('drops empty groups from the output', () => {
    const a = conn('a', 'anthropic')
    const result = groupConnectionsByProvider([a])
    // Only "Anthropic" appears; "Local" and "Oh My Pi Backend" are dropped.
    expect(result.length).toBe(1)
    expect(result[0][0]).toBe('Anthropic')
  })

  test('full mixed input — anthropic + local + remote pi_compat + pi', () => {
    const anth = conn('a', 'anthropic')
    const local = conn('ollama', 'pi_compat', { baseUrl: 'http://127.0.0.1:1234' })
    const remote = conn('or', 'pi_compat', { baseUrl: 'https://openrouter.ai' })
    const pi = conn('p', 'pi')
    const result = groupConnectionsByProvider([anth, local, remote, pi])
    expect(result.map(([k, conns]) => [k, conns.map(c => c.slug)])).toEqual([
      ['Anthropic', ['a']],
      ['Local', ['ollama']],
      ['Oh My Pi Backend', ['or', 'p']],
    ])
  })
})
