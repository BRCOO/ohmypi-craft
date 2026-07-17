/**
 * Model defaults for branded Anthropic-compatible endpoints that are also
 * first-class Pi providers.
 *
 * Keep these IDs in one renderer-safe module so onboarding fallbacks and
 * startup migrations cannot drift apart. New connections normally use the
 * live Pi SDK catalog; these values are the safe fallback when model discovery
 * is unavailable and the legacy-connection migration baseline.
 */

export type KnownCompatProvider = 'kimi-coding' | 'minimax-global' | 'minimax-cn'

const KNOWN_COMPAT_MODEL_DEFAULTS: Record<KnownCompatProvider, readonly string[]> = {
  'kimi-coding': ['k2p7', 'kimi-for-coding', 'kimi-k2-thinking'],
  'minimax-global': ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M3'],
  'minimax-cn': ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M3'],
}

const KNOWN_COMPAT_LEGACY_DEFAULTS: Record<KnownCompatProvider, readonly string[]> = {
  'kimi-coding': ['k2p5', 'kimi-k2-thinking'],
  'minimax-global': ['MiniMax-M2.5', 'MiniMax-M2.5-highspeed'],
  'minimax-cn': ['MiniMax-M2.5', 'MiniMax-M2.5-highspeed'],
}

export function getKnownCompatModelDefaults(provider: KnownCompatProvider): string[] {
  return [...KNOWN_COMPAT_MODEL_DEFAULTS[provider]]
}

export function getKnownCompatLegacyDefaults(provider: KnownCompatProvider): string[] {
  return [...KNOWN_COMPAT_LEGACY_DEFAULTS[provider]]
}

/** Resolve a known Pi provider from its branded built-in endpoint URL. */
export function getKnownCompatProviderForUrl(baseUrl?: string): KnownCompatProvider | undefined {
  if (!baseUrl?.trim()) return undefined

  try {
    const url = new URL(baseUrl.trim())
    const host = url.hostname.toLowerCase()
    const path = url.pathname.replace(/\/+$/, '').toLowerCase()

    if (host === 'api.kimi.com' && (path === '/coding' || path === '/coding/v1')) {
      return 'kimi-coding'
    }
    if (host === 'api.minimax.io' && path === '/anthropic') {
      return 'minimax-global'
    }
    if (host === 'api.minimaxi.com' && path === '/anthropic') {
      return 'minimax-cn'
    }
  } catch {
    // A malformed custom URL is not a known branded endpoint.
  }

  return undefined
}
