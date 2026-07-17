import { useCallback, useState } from 'react'
import type { SessionCommand } from '@craft-agent/shared/protocol'

interface UseOmpSessionCommandResult {
  loading: boolean
  error: string | null
  execute: (command: SessionCommand) => Promise<unknown>
}

type OmpCommandEnvelope = {
  success: boolean
  data?: unknown
  error?: string
}

/**
 * The session manager wraps raw OMP RPC payloads so that capability and
 * transport failures can be represented without throwing across the process
 * boundary. Renderer callers, however, should receive the actual OMP payload
 * and use normal promise rejection for errors.
 */
export function unwrapOmpSessionCommandResult(result: unknown): unknown {
  if (
    !result
    || typeof result !== 'object'
    || !('success' in result)
    || typeof (result as { success?: unknown }).success !== 'boolean'
    || (!('data' in result) && !('error' in result))
  ) {
    return result
  }

  const envelope = result as OmpCommandEnvelope
  if (!envelope.success) {
    throw new Error(envelope.error || 'OMP command failed')
  }
  return envelope.data
}

/**
 * Thin wrapper around `window.electronAPI.sessionCommand` that tracks loading
 * and error state for one-off OMP session commands.
 */
export function useOmpSessionCommand(sessionId: string | undefined): UseOmpSessionCommandResult {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const execute = useCallback(
    async (command: SessionCommand) => {
      if (!sessionId) {
        setError('No session selected')
        return Promise.reject(new Error('No session selected'))
      }
      setLoading(true)
      setError(null)
      try {
        const result = await window.electronAPI.sessionCommand(sessionId, command)
        return unwrapOmpSessionCommandResult(result)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        throw err
      } finally {
        setLoading(false)
      }
    },
    [sessionId],
  )

  return { loading, error, execute }
}
