import {
  isLocalConnection,
  type LlmConnection,
} from '@config/llm-connections'
import type { ModelDefinition } from '@config/models'
import {
  clampThinkingLevelToSupported,
  getSupportedThinkingLevels,
} from '@config/model-capabilities'
import {
  THINKING_LEVELS,
  type ThinkingLevel,
  type ThinkingLevelDefinition,
} from '@craft-agent/shared/agent/thinking-levels'

/**
 * Format token count for display (e.g., 1500 -> "1.5k", 200000 -> "200k").
 * Shared by the desktop model dropdown and the compact (drawer) model picker.
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1)}k`
  }
  return tokens.toString()
}

/**
 * Strip the "pi/" prefix from model IDs/display names so the user sees a
 * provider-agnostic label in the picker (e.g., "pi/claude-opus" → "claude-opus").
 */
export function stripPiPrefixForDisplay(value: string): string {
  return value.startsWith('pi/') ? value.slice(3) : value
}

/**
 * Use model-advertised effort levels when they are available. The Kimi Coding
 * K2.7 route is also recognized explicitly so an already-saved OMP catalog
 * gets the correct four non-off efforts before its next discovery refresh.
 */
export function getThinkingLevelsForModel(
  model: ModelDefinition | string | undefined,
  providerType: string | undefined,
  modelId: string,
): readonly ThinkingLevelDefinition[] {
  const supported = getSupportedThinkingLevels(model, providerType, modelId)
  return supported
    ? THINKING_LEVELS.filter(level => supported.includes(level.id))
    // `minimal` is a native effort exposed by OMP/Pi model catalogs. Do not
    // invent it for providers that have not advertised that exact effort.
    : THINKING_LEVELS.filter(level => level.id !== 'minimal')
}

/**
 * Keep a persisted session effort valid when its model or provider changes.
 * Prefer the highest supported level that does not exceed the user's prior
 * choice (for example, K2.7 changes `max` to `high`). If a model cannot turn
 * thinking off, choose its lowest available reasoning effort.
 */
export function clampThinkingLevelToModel(
  level: ThinkingLevel,
  supportedLevels: readonly ThinkingLevelDefinition[],
): ThinkingLevel {
  return clampThinkingLevelToSupported(level, supportedLevels.map(candidate => candidate.id)) as ThinkingLevel
}

export type ConnectionGroup = [groupName: string, connections: LlmConnection[]]

/**
 * Group connections by provider type for hierarchical picker rendering.
 * Each provider section can contain multiple connections (API Key, OAuth, …).
 * Order is significant for UI: Anthropic, Local, Oh My Pi Backend.
 * Empty groups are dropped.
 */
export function groupConnectionsByProvider<T extends LlmConnection>(
  connections: readonly T[],
): Array<[string, T[]]> {
  const groups: Record<string, T[]> = {
    'Anthropic': [],
    'Local': [],
    'Oh My Pi Backend': [],
  }
  for (const conn of connections) {
    const provider = conn.providerType || 'anthropic'
    if (provider === 'anthropic') {
      groups['Anthropic'].push(conn)
    } else if (provider === 'pi_compat' && isLocalConnection(conn)) {
      groups['Local'].push(conn)
    } else if (provider === 'pi' || provider === 'pi_compat' || provider === 'omp') {
      groups['Oh My Pi Backend'].push(conn)
    }
  }
  return Object.entries(groups).filter(([, conns]) => conns.length > 0)
}
