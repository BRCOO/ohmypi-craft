import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  OmpAgentCreateSpec,
  OmpAgentDefinitionState,
  OmpAgentPatch,
} from '@craft-agent/shared/protocol'
import { parseOmpAgentDefinitionState } from '@craft-agent/shared/protocol'
import { useOmpSessionCommand } from './useOmpSessionCommand'

export interface UseOmpAgentsResult {
  agents: OmpAgentDefinitionState[]
  loading: boolean
  error: string | null
  refreshing: boolean
  refresh: () => Promise<void>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  setModelOverride: (id: string, model?: string) => Promise<void>
  createAgent: (spec: OmpAgentCreateSpec) => Promise<void>
  updateAgent: (id: string, patch: OmpAgentPatch) => Promise<void>
  reloadAgents: () => Promise<void>
}

/**
 * Manages OMP agent definitions via session commands.
 *
 * Fetches the initial list on mount and provides actions for all
 * agent lifecycle operations. Parses the raw RPC data using the
 * canonical protocol parser.
 */
export function useOmpAgents(sessionId: string | undefined): UseOmpAgentsResult {
  const [agents, setAgents] = useState<OmpAgentDefinitionState[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const { execute } = useOmpSessionCommand(sessionId)
  const mountedRef = useRef(true)

  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  const parseAgents = useCallback((raw: unknown): OmpAgentDefinitionState[] => {
    if (Array.isArray(raw)) {
      return raw
        .map(item => parseOmpAgentDefinitionState(item))
        .filter((a): a is OmpAgentDefinitionState => a !== null)
    }
    if (raw && typeof raw === 'object' && 'agents' in raw && Array.isArray((raw as Record<string, unknown>).agents)) {
      return ((raw as Record<string, unknown>).agents as unknown[])
        .map(item => parseOmpAgentDefinitionState(item))
        .filter((a): a is OmpAgentDefinitionState => a !== null)
    }
    return []
  }, [])

  const fetchAgents = useCallback(async () => {
    if (!sessionId) {
      setAgents([])
      setLoading(false)
      setError(null)
      return
    }
    try {
      const result = await execute({ type: 'getAgentDefinitions' }) as { success?: boolean; data?: unknown; error?: string }
      if (!mountedRef.current) return
      if (result && typeof result === 'object' && 'success' in result && !result.success) {
        throw new Error((result as Record<string, unknown>).error as string ?? 'Failed to fetch agent definitions')
      }
      const raw = result && typeof result === 'object' && 'data' in result
        ? (result as Record<string, unknown>).data
        : result
      setAgents(parseAgents(raw))
      setError(null)
    } catch (err) {
      if (!mountedRef.current) return
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      if (mountedRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [sessionId, execute, parseAgents])

  useEffect(() => {
    void fetchAgents()
  }, [fetchAgents])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    await fetchAgents()
  }, [fetchAgents])

  const setEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      setError(null)
      try {
        await execute({ type: 'setAgentEnabled', id, enabled })
        // Optimistic update — keep state responsive
        setAgents(prev => prev.map(a => (a.id === id ? { ...a, enabled } : a)))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        throw err
      }
    },
    [execute],
  )

  const setModelOverride = useCallback(
    async (id: string, model?: string) => {
      setError(null)
      try {
        await execute({ type: 'setAgentModelOverride', id, model })
        setAgents(prev => prev.map(a => (a.id === id ? { ...a, modelOverride: model } : a)))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        throw err
      }
    },
    [execute],
  )

  const createAgent = useCallback(
    async (spec: OmpAgentCreateSpec) => {
      setError(null)
      try {
        const result = await execute({ type: 'createAgent', spec }) as { success?: boolean; data?: unknown; error?: string }
        if (result && typeof result === 'object' && 'success' in result && !result.success) {
          throw new Error((result as Record<string, unknown>).error as string ?? 'Failed to create agent')
        }
        await fetchAgents()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        throw err
      }
    },
    [execute, fetchAgents],
  )

  const updateAgent = useCallback(
    async (id: string, patch: OmpAgentPatch) => {
      setError(null)
      try {
        const result = await execute({ type: 'updateAgent', id, patch }) as { success?: boolean; data?: unknown; error?: string }
        if (result && typeof result === 'object' && 'success' in result && !result.success) {
          throw new Error((result as Record<string, unknown>).error as string ?? 'Failed to update agent')
        }
        await fetchAgents()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        throw err
      }
    },
    [execute, fetchAgents],
  )

  const reloadAgents = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      await execute({ type: 'reloadAgents' })
      await fetchAgents()
    } catch (err) {
      if (!mountedRef.current) return
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      if (mountedRef.current) setRefreshing(false)
    }
  }, [execute, fetchAgents])

  return {
    agents,
    loading,
    error,
    refreshing,
    refresh,
    setEnabled,
    setModelOverride,
    createAgent,
    updateAgent,
    reloadAgents,
  }
}
