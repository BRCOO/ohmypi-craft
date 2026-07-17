import { isAdaptiveThinkingAlwaysOnModel, type ModelDefinition, type ModelThinkingLevel } from './models.ts'

/**
 * Return the thinking levels a provider/model pair can actually accept.
 *
 * `undefined` means the provider has not advertised a restriction, so callers
 * should preserve the existing generic behavior. An empty array means the
 * model explicitly does not support thinking.
 */
export function getSupportedThinkingLevels(
  model: ModelDefinition | string | undefined,
  providerType: string | undefined,
  modelId: string,
): readonly ModelThinkingLevel[] | undefined {
  const normalizedModelId = modelId.replace(/^pi\//, '')

  if (providerType === 'omp' && normalizedModelId === 'kimi-code/kimi-for-coding') {
    // Kimi Coding's K2.7 route supports four explicit efforts. Keep this
    // provider rule authoritative even if an older cached OMP catalog claims
    // a wider set of levels.
    return ['off', 'minimal', 'low', 'medium', 'high']
  }

  if (typeof model !== 'string' && model?.supportsThinking === false) return []

  if (typeof model !== 'string' && model?.supportedThinkingLevels) {
    return model.supportedThinkingLevels
  }

  if (providerType === 'anthropic' && isAdaptiveThinkingAlwaysOnModel(normalizedModelId)) {
    // Fable/Mythos reject disabled thinking; low is their minimum effort.
    return ['low', 'medium', 'high', 'xhigh', 'max']
  }

  return undefined
}

/** Clamp a persisted/requested effort to the highest supported level below it. */
export function clampThinkingLevelToSupported(
  level: ModelThinkingLevel,
  supportedLevels: readonly ModelThinkingLevel[],
): ModelThinkingLevel {
  if (supportedLevels.some(candidate => candidate === level)) return level

  const order: readonly ModelThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  const requestedIndex = order.indexOf(level)
  const atOrBelow = supportedLevels.filter(candidate => order.indexOf(candidate) <= requestedIndex)
  return atOrBelow.at(-1) ?? supportedLevels[0] ?? level
}
