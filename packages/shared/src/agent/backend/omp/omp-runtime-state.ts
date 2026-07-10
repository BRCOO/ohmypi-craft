import type {
  OmpCompactionResult,
  OmpQueueMode,
  OmpRpcSessionState,
  OmpRuntimeConfig,
  OmpRuntimeEvent,
  OmpRuntimeExtensionErrorEntry,
  OmpRuntimePendingAction,
  OmpRuntimeState,
  OmpRuntimeStderrEntry,
  OmpSessionShutdownReason,
  OmpSessionStats,
  OmpStderrLevel,
} from './omp-rpc-protocol.ts';

export type OmpRuntimeStateAction =
  | { type: 'pending'; action: OmpRuntimePendingAction }
  | { type: 'failed'; action: OmpRuntimePendingAction; error: string }
  | { type: 'session_state'; state: OmpRpcSessionState }
  | { type: 'stats'; stats: OmpSessionStats }
  | { type: 'manual_compaction_started' }
  | { type: 'manual_compaction_succeeded'; result: OmpCompactionResult }
  | { type: 'auto_compaction_set'; enabled: boolean }
  | { type: 'auto_retry_set'; enabled: boolean }
  | { type: 'retry_aborted' }
  | { type: 'runtime_event'; event: OmpRuntimeEvent }
  | { type: 'unavailable'; error?: string }
  | { type: 'config_update'; config: OmpRuntimeConfig }
  | { type: 'session_info_update'; sessionId?: string; sessionFile?: string; sessionName?: string }
  | { type: 'session_shutdown'; reason: OmpSessionShutdownReason; errorMessage?: string }
  | { type: 'version_info'; ompVersion?: string; protocolVersion?: string; versionWarning?: string }
  | { type: 'stderr'; level: OmpStderrLevel; text: string }
  | { type: 'extension_error'; error: Omit<OmpRuntimeExtensionErrorEntry, 'at'> };

export function createOmpRuntimeState(now = Date.now()): OmpRuntimeState {
  return {
    compaction: { phase: 'idle' },
    retry: { phase: 'idle' },
    available: false,
    updatedAt: now,
    recentStderr: [],
    recentExtensionErrors: [],
  };
}

export function cloneOmpRuntimeState(state: OmpRuntimeState): OmpRuntimeState {
  return {
    ...state,
    contextUsage: state.contextUsage ? { ...state.contextUsage } : undefined,
    stats: state.stats
      ? { ...state.stats, tokens: { ...state.stats.tokens } }
      : undefined,
    compaction: {
      ...state.compaction,
      result: state.compaction.result
        ? {
            ...state.compaction.result,
            preserveData: state.compaction.result.preserveData
              ? { ...state.compaction.result.preserveData }
              : undefined,
          }
        : undefined,
    },
    retry: { ...state.retry },
    fallback: state.fallback ? { ...state.fallback } : undefined,
    config: state.config ? { ...state.config } : undefined,
    recentStderr: state.recentStderr ? [...state.recentStderr] : undefined,
    recentExtensionErrors: state.recentExtensionErrors ? [...state.recentExtensionErrors] : undefined,
  };
}

export function reduceOmpRuntimeState(
  state: OmpRuntimeState,
  action: OmpRuntimeStateAction,
  now = Date.now(),
): OmpRuntimeState {
  switch (action.type) {
    case 'pending':
      return {
        ...state,
        pendingAction: action.action,
        error: undefined,
        updatedAt: now,
      };

    case 'failed':
      return {
        ...state,
        pendingAction: state.pendingAction === action.action ? undefined : state.pendingAction,
        error: action.error,
        compaction: action.action === 'compact'
          ? { ...state.compaction, phase: 'failed', manual: true, error: action.error }
          : state.compaction,
        updatedAt: now,
      };

    case 'session_state':
      return {
        ...state,
        contextUsage: action.state.contextUsage
          ? { ...action.state.contextUsage }
          : state.contextUsage,
        autoCompactionEnabled: action.state.autoCompactionEnabled,
        available: true,
        pendingAction: state.pendingAction === 'refresh' ? undefined : state.pendingAction,
        error: state.pendingAction === 'refresh' ? undefined : state.error,
        updatedAt: now,
      };

    case 'stats':
      return {
        ...state,
        stats: { ...action.stats, tokens: { ...action.stats.tokens } },
        available: true,
        pendingAction: state.pendingAction === 'refresh' ? undefined : state.pendingAction,
        error: state.pendingAction === 'refresh' ? undefined : state.error,
        updatedAt: now,
      };

    case 'manual_compaction_started':
      return {
        ...state,
        pendingAction: 'compact',
        error: undefined,
        compaction: { phase: 'running', manual: true },
        updatedAt: now,
      };

    case 'manual_compaction_succeeded':
      return {
        ...state,
        pendingAction: state.pendingAction === 'compact' ? undefined : state.pendingAction,
        error: undefined,
        compaction: {
          phase: 'succeeded',
          manual: true,
          result: { ...action.result },
        },
        updatedAt: now,
      };

    case 'auto_compaction_set':
      return {
        ...state,
        autoCompactionEnabled: action.enabled,
        pendingAction: state.pendingAction === 'set-auto-compaction' ? undefined : state.pendingAction,
        error: undefined,
        updatedAt: now,
      };

    case 'auto_retry_set':
      return {
        ...state,
        autoRetryEnabled: action.enabled,
        pendingAction: state.pendingAction === 'set-auto-retry' ? undefined : state.pendingAction,
        error: undefined,
        updatedAt: now,
      };

    case 'retry_aborted':
      return {
        ...state,
        pendingAction: state.pendingAction === 'abort-retry' ? undefined : state.pendingAction,
        error: undefined,
        retry: { ...state.retry, phase: 'cancelled' },
        updatedAt: now,
      };

    case 'runtime_event':
      return reduceRuntimeEvent(state, action.event, now);

    case 'unavailable':
      return {
        ...createOmpRuntimeState(now),
        error: action.error,
      };

    case 'config_update': {
      const config: OmpRuntimeConfig = { ...(state.config ?? {}), ...action.config };
      return {
        ...state,
        config,
        autoCompactionEnabled: config.autoCompactionEnabled ?? state.autoCompactionEnabled,
        autoRetryEnabled: config.autoRetryEnabled ?? state.autoRetryEnabled,
        updatedAt: now,
      };
    }

    case 'session_info_update':
      return {
        ...state,
        updatedAt: now,
      };

    case 'session_shutdown':
      return {
        ...state,
        sessionShutdown: {
          reason: action.reason,
          errorMessage: action.errorMessage,
          at: now,
        },
        updatedAt: now,
      };

    case 'version_info':
      return {
        ...state,
        ompVersion: action.ompVersion,
        protocolVersion: action.protocolVersion,
        versionWarning: action.versionWarning,
        updatedAt: now,
      };

    case 'stderr':
      return {
        ...state,
        recentStderr: appendLimited(
          state.recentStderr ?? [],
          { level: action.level, text: action.text, at: now },
          32,
        ),
        updatedAt: now,
      };

    case 'extension_error':
      return {
        ...state,
        recentExtensionErrors: appendLimited(
          state.recentExtensionErrors ?? [],
          { ...action.error, at: now },
          16,
        ),
        updatedAt: now,
      };
  }
}

function appendLimited<T>(items: T[], item: T, max: number): T[] {
  const next = [...items, item];
  if (next.length > max) next.splice(0, next.length - max);
  return next;
}

function reduceRuntimeEvent(
  state: OmpRuntimeState,
  event: OmpRuntimeEvent,
  now: number,
): OmpRuntimeState {
  switch (event.type) {
    case 'auto_compaction_start':
      return {
        ...state,
        available: true,
        compaction: {
          phase: 'running',
          manual: false,
          reason: event.reason,
          action: event.action,
        },
        updatedAt: now,
      };

    case 'auto_compaction_end': {
      const phase = event.skipped
        ? 'skipped'
        : event.aborted
          ? 'aborted'
          : event.errorMessage
            ? 'failed'
            : 'succeeded';
      return {
        ...state,
        available: true,
        compaction: {
          ...state.compaction,
          phase,
          manual: false,
          action: event.action,
          result: event.result ? { ...event.result } : undefined,
          willRetry: event.willRetry,
          error: event.errorMessage,
        },
        updatedAt: now,
      };
    }

    case 'auto_retry_start':
      return {
        ...state,
        available: true,
        retry: {
          phase: 'waiting',
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          error: event.errorMessage,
        },
        updatedAt: now,
      };

    case 'auto_retry_end':
      return {
        ...state,
        available: true,
        retry: {
          ...state.retry,
          phase: event.success ? 'succeeded' : 'failed',
          attempt: event.attempt,
          error: event.finalError,
        },
        updatedAt: now,
      };

    case 'retry_fallback_applied':
      return {
        ...state,
        available: true,
        fallback: {
          phase: 'applied',
          from: event.from,
          to: event.to,
          role: event.role,
        },
        updatedAt: now,
      };

    case 'retry_fallback_succeeded':
      return {
        ...state,
        available: true,
        fallback: {
          phase: 'succeeded',
          from: state.fallback?.role === event.role ? state.fallback.from : undefined,
          to: event.model,
          role: event.role,
        },
        updatedAt: now,
      };
  }
}
