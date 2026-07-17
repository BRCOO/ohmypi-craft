import { useCallback, useEffect, useState } from 'react'
import type { OmpCapabilityManifest, OmpFeatureId } from '@craft-agent/shared/protocol'

interface UseOmpCapabilitiesResult {
  manifest: OmpCapabilityManifest | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  isCommandSupported: (command: string) => boolean
  isFeatureSupported: (feature: OmpFeatureId) => boolean
  getFeatureReason: (feature: OmpFeatureId) => string | undefined
}

/**
 * Per-session OMP capability manifest hook.
 *
 * Fetches the manifest via the consolidated session command channel and
 * exposes command/feature support helpers for capability-driven UI gating.
 */
export function useOmpCapabilities(sessionId: string | undefined): UseOmpCapabilitiesResult {
  const [manifest, setManifest] = useState<OmpCapabilityManifest | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setManifest(null)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = (await window.electronAPI.sessionCommand(sessionId, { type: 'getOmpCapabilities' })) as
        | { success: true; manifest?: OmpCapabilityManifest }
        | { success: false; error?: string }
        | undefined
      if (!result || !('success' in result)) {
        throw new Error('Invalid capability response')
      }
      if (!result.success) {
        throw new Error('error' in result ? result.error ?? 'Unknown error' : 'Capability fetch failed')
      }
      setManifest(result.manifest ?? null)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setManifest(null)
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const isCommandSupported = useCallback(
    (command: string) => {
      if (!manifest) return true // legacy OMP: allow all known commands
      return manifest.commands.includes(command)
    },
    [manifest],
  )

  const isFeatureSupported = useCallback(
    (feature: OmpFeatureId) => {
      return manifest?.features[feature]?.supported ?? false
    },
    [manifest],
  )

  const getFeatureReason = useCallback(
    (feature: OmpFeatureId) => {
      return manifest?.features[feature]?.reason
    },
    [manifest],
  )

  return {
    manifest,
    loading,
    error,
    refresh,
    isCommandSupported,
    isFeatureSupported,
    getFeatureReason,
  }
}
