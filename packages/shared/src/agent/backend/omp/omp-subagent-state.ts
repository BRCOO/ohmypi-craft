import type { OmpSubagentSnapshot } from './omp-rpc-protocol.ts';
import { cloneOmpTodoPhases } from './omp-todo.ts';

export interface OmpSubagentTranscriptCursor {
  fromByte: number;
  nextByte?: number;
  hasMore: boolean;
}

export interface OmpSubagentStateItem extends OmpSubagentSnapshot {
  transcriptEntries: unknown[];
  transcriptMessages: unknown[];
  cursor?: OmpSubagentTranscriptCursor;
  transcriptError?: string;
  transcriptLoading: boolean;
}

export type OmpSubagentPendingAction = 'refresh' | 'load-transcript';

export interface OmpSubagentState {
  available: boolean;
  sessionId?: string;
  subagents: OmpSubagentStateItem[];
  revision: number;
  pendingAction?: OmpSubagentPendingAction;
  error?: string;
  updatedAt: number;
}

export type OmpSubagentStateAction =
  | { type: 'unavailable'; error?: string }
  | { type: 'session_state'; sessionId: string }
  | { type: 'snapshot'; subagents: OmpSubagentSnapshot[] }
  | { type: 'upsert'; subagent: OmpSubagentSnapshot }
  | { type: 'remove'; id: string }
  | { type: 'pending'; action: OmpSubagentPendingAction }
  | { type: 'failed'; action: OmpSubagentPendingAction; error: string }
  | { type: 'transcript_pending'; id: string }
  | { type: 'transcript_loaded'; id: string; entries: unknown[]; messages: unknown[]; cursor?: OmpSubagentTranscriptCursor }
  | { type: 'transcript_failed'; id: string; error: string };

function cloneSubagentSnapshot(subagent: OmpSubagentSnapshot): OmpSubagentSnapshot {
  return {
    ...subagent,
    progress: subagent.progress
      ? {
          ...subagent.progress,
          recentTools: subagent.progress.recentTools?.map((tool) => ({ ...tool })),
          recentOutput: subagent.progress.recentOutput ? [...subagent.progress.recentOutput] : undefined,
          modelOverride: Array.isArray(subagent.progress.modelOverride)
            ? [...subagent.progress.modelOverride]
            : subagent.progress.modelOverride,
          retryState: subagent.progress.retryState ? { ...subagent.progress.retryState } : undefined,
          retryFailure: subagent.progress.retryFailure ? { ...subagent.progress.retryFailure } : undefined,
        }
      : undefined,
    todoPhases: subagent.todoPhases ? cloneOmpTodoPhases(subagent.todoPhases) : undefined,
  };
}

function createStateItem(subagent: OmpSubagentSnapshot): OmpSubagentStateItem {
  return {
    ...cloneSubagentSnapshot(subagent),
    transcriptEntries: [],
    transcriptMessages: [],
    transcriptLoading: false,
  };
}

function sortSubagents(subagents: OmpSubagentStateItem[]): OmpSubagentStateItem[] {
  return subagents
    .map((subagent) => ({ ...subagent }))
    .sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
}

export function createOmpSubagentState(): OmpSubagentState {
  return {
    available: false,
    subagents: [],
    revision: 0,
    updatedAt: Date.now(),
  };
}

export function cloneOmpSubagentState(state: OmpSubagentState): OmpSubagentState {
  return {
    available: state.available,
    sessionId: state.sessionId,
    subagents: state.subagents.map((subagent) => ({
      ...cloneSubagentSnapshot(subagent),
      transcriptEntries: [...subagent.transcriptEntries],
      transcriptMessages: [...subagent.transcriptMessages],
      cursor: subagent.cursor ? { ...subagent.cursor } : undefined,
      transcriptError: subagent.transcriptError,
      transcriptLoading: subagent.transcriptLoading,
    })),
    revision: state.revision,
    pendingAction: state.pendingAction,
    error: state.error,
    updatedAt: state.updatedAt,
  };
}

export function reduceOmpSubagentState(
  state: OmpSubagentState,
  action: OmpSubagentStateAction,
): OmpSubagentState {
  const updatedAt = Date.now();

  switch (action.type) {
    case 'unavailable':
      return {
        available: false,
        subagents: [],
        revision: state.revision + 1,
        error: action.error,
        updatedAt,
      };

    case 'session_state': {
      const sameSession = state.sessionId === action.sessionId;
      return {
        available: true,
        sessionId: action.sessionId,
        subagents: sameSession ? state.subagents.map((s) => ({ ...s })) : [],
        revision: sameSession ? state.revision + 1 : 1,
        updatedAt,
      };
    }

    case 'snapshot': {
      const existing = new Map(state.subagents.map((s) => [s.id, s]));
      const merged = action.subagents.map((subagent) => {
        const prev = existing.get(subagent.id);
        if (!prev) return createStateItem(subagent);
        return {
          ...createStateItem(subagent),
          transcriptEntries: prev.transcriptEntries,
          transcriptMessages: prev.transcriptMessages,
          cursor: prev.cursor,
          transcriptError: prev.transcriptError,
          transcriptLoading: false,
        };
      });
      return {
        ...cloneOmpSubagentState(state),
        subagents: sortSubagents(merged),
        pendingAction: state.pendingAction === 'refresh' ? undefined : state.pendingAction,
        error: undefined,
        revision: state.revision + 1,
        updatedAt,
      };
    }

    case 'upsert': {
      const existing = new Map(state.subagents.map((s) => [s.id, s]));
      const prev = existing.get(action.subagent.id);
      const next = createStateItem(action.subagent);
      existing.set(action.subagent.id, prev
        ? {
            ...next,
            transcriptEntries: prev.transcriptEntries,
            transcriptMessages: prev.transcriptMessages,
            cursor: prev.cursor,
            transcriptError: prev.transcriptError,
            transcriptLoading: prev.transcriptLoading,
          }
        : next);
      return {
        ...cloneOmpSubagentState(state),
        subagents: sortSubagents([...existing.values()]),
        revision: state.revision + 1,
        updatedAt,
      };
    }

    case 'remove':
      return {
        ...cloneOmpSubagentState(state),
        subagents: state.subagents
          .filter((subagent) => subagent.id !== action.id)
          .map((subagent) => ({ ...subagent })),
        revision: state.revision + 1,
        updatedAt,
      };

    case 'pending':
      return {
        ...cloneOmpSubagentState(state),
        pendingAction: action.action,
        error: undefined,
        updatedAt,
      };

    case 'failed':
      return {
        ...cloneOmpSubagentState(state),
        pendingAction: state.pendingAction === action.action ? undefined : state.pendingAction,
        error: action.error,
        updatedAt,
      };

    case 'transcript_pending': {
      const subagents = state.subagents.map((subagent) =>
        subagent.id === action.id
          ? { ...subagent, transcriptLoading: true, transcriptError: undefined }
          : { ...subagent }
      );
      return {
        ...cloneOmpSubagentState(state),
        subagents,
        updatedAt,
      };
    }

    case 'transcript_loaded': {
      const subagents = state.subagents.map((subagent) => {
        if (subagent.id !== action.id) return { ...subagent };
        const reset = action.cursor && action.cursor.fromByte === 0;
        const existingEntries = reset ? [] : subagent.transcriptEntries;
        const existingMessages = reset ? [] : subagent.transcriptMessages;
        return {
          ...subagent,
          transcriptEntries: [...existingEntries, ...action.entries],
          transcriptMessages: [...existingMessages, ...action.messages],
          cursor: action.cursor,
          transcriptLoading: false,
          transcriptError: undefined,
        };
      });
      return {
        ...cloneOmpSubagentState(state),
        subagents,
        pendingAction: state.pendingAction === 'load-transcript' ? undefined : state.pendingAction,
        updatedAt,
      };
    }

    case 'transcript_failed': {
      const subagents = state.subagents.map((subagent) =>
        subagent.id === action.id
          ? { ...subagent, transcriptLoading: false, transcriptError: action.error }
          : { ...subagent }
      );
      return {
        ...cloneOmpSubagentState(state),
        subagents,
        pendingAction: state.pendingAction === 'load-transcript' ? undefined : state.pendingAction,
        updatedAt,
      };
    }

    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
