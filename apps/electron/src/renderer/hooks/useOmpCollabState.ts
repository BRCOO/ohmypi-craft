/**
 * useOmpCollabState — manages OMP collab session state in the renderer.
 *
 * Provides:
 * - collab state (connection, role, participants, invite URL)
 * - action methods (start, join, leave, refresh)
 * - event-driven participant list updates
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionEvent, OmpCollabState } from '@craft-agent/shared/protocol'
import { useOmpSessionCommand } from './useOmpSessionCommand'

export interface UseOmpCollabStateResult {
  /** Current collab state, or null if no collab session is active. */
  collabState: OmpCollabState | null
  /** True while a command is in flight. */
  loading: boolean
  /** Error message from the last failed action. */
  error: string | null
  /** Start a new collab session as host. */
  startCollab: (readOnly?: boolean) => Promise<void>
  /** Join an existing collab session via invite URL or code. */
  joinCollab: (invite: string, readOnly?: boolean) => Promise<void>
  /** Leave the current collab session. */
  leaveCollab: () => Promise<void>
  /** Stop the collab session (host only). */
  stopCollab: () => Promise<void>
  /** Manually refresh collab state from the OMP runtime. */
  refreshCollabState: () => Promise<void>
}

/**
 * Hook for managing OMP collab session state.
 * Listens to collab events from the session event stream and exposes
 * action methods wired through useOmpSessionCommand.
 */
export function useOmpCollabState(sessionId: string | undefined): UseOmpCollabStateResult {
  const { loading, error, execute } = useOmpSessionCommand(sessionId)
  const [collabState, setCollabState] = useState<OmpCollabState | null>(null)

  const unmountedRef = useRef(false)
  useEffect(() => {
    return () => {
      unmountedRef.current = true
    }
  }, [])

  /** Subscribe to collab session events via the global event stream. */
  useEffect(() => {
    if (!sessionId) return

    const cleanup = window.electronAPI.onSessionEvent((event: SessionEvent) => {
      if ('sessionId' in event && event.sessionId !== sessionId) return

      switch (event.type) {
        case 'collab_state_update':
          if (!unmountedRef.current) setCollabState(event.state)
          break
        case 'collab_participant_joined':
          if (!unmountedRef.current) {
            setCollabState(prev => {
              if (!prev) return prev
              const exists = prev.participants.findIndex(p => p.id === event.participant.id)
              const participants =
                exists >= 0
                  ? prev.participants.map((p, i) => (i === exists ? event.participant : p))
                  : [...prev.participants, event.participant]
              return { ...prev, participants }
            })
          }
          break
        case 'collab_participant_left':
          if (!unmountedRef.current) {
            setCollabState(prev => {
              if (!prev) return prev
              return { ...prev, participants: prev.participants.filter(p => p.id !== event.participantId) }
            })
          }
          break
        case 'collab_connection_update':
          if (!unmountedRef.current) {
            setCollabState(prev => {
              if (!prev) return prev
              return { ...prev, connection: event.connection as OmpCollabState['connection'], error: event.error }
            })
          }
          break
      }
    })

    return () => {
      cleanup()
    }
  }, [sessionId])

  /** Fetch the current collab state on mount. */
  const refreshCollabState = useCallback(async () => {
    if (!sessionId) return
    try {
      const result = (await execute({ type: 'getCollabState' })) as OmpCollabState | undefined
      if (result && !unmountedRef.current) {
        setCollabState(result)
      }
    } catch {
      // Error is tracked by useOmpSessionCommand
    }
  }, [sessionId, execute])

  useEffect(() => {
    void refreshCollabState()
  }, [refreshCollabState])

  const startCollab = useCallback(
    async (readOnly?: boolean) => {
      try {
        const result = (await execute({ type: 'startCollab', readOnly })) as OmpCollabState | undefined
        if (result && !unmountedRef.current) setCollabState(result)
      } catch {
        // Error tracked by hook
      }
    },
    [execute],
  )

  const joinCollab = useCallback(
    async (invite: string, readOnly?: boolean) => {
      try {
        const result = (await execute({ type: 'joinCollab', invite, readOnly })) as OmpCollabState | undefined
        if (result && !unmountedRef.current) setCollabState(result)
      } catch {
        // Error tracked by hook
      }
    },
    [execute],
  )

  const leaveCollab = useCallback(async () => {
    try {
      await execute({ type: 'leaveCollab' })
      if (!unmountedRef.current) setCollabState(null)
    } catch {
      // Error tracked by hook
    }
  }, [execute])

  const stopCollab = useCallback(async () => {
    try {
      await execute({ type: 'stopCollab' })
      if (!unmountedRef.current) setCollabState(null)
    } catch {
      // Error tracked by hook
    }
  }, [execute])

  return {
    collabState,
    loading,
    error,
    startCollab,
    joinCollab,
    leaveCollab,
    stopCollab,
    refreshCollabState,
  }
}
