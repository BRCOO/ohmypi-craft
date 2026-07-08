import type { OmpSubagentSnapshot, OmpTodoItem, OmpTodoPhase } from './omp-rpc-protocol.ts';
import { cloneOmpTodoItem, cloneOmpTodoPhases } from './omp-todo.ts';

export type OmpTodoPendingAction = 'refresh' | 'write';

export interface OmpTodoReminderState {
  todos: OmpTodoItem[];
  attempt: number;
  maxAttempts: number;
}

export interface OmpTodoState {
  available: boolean;
  sessionId?: string;
  phases: OmpTodoPhase[];
  subagents: OmpSubagentSnapshot[];
  revision: number;
  pendingAction?: OmpTodoPendingAction;
  error?: string;
  reminder?: OmpTodoReminderState;
  updatedAt: number;
}

export type OmpTodoStateAction =
  | { type: 'unavailable'; error?: string }
  | { type: 'session_state'; sessionId: string; phases: OmpTodoPhase[] }
  | { type: 'subagents_snapshot'; subagents: OmpSubagentSnapshot[] }
  | { type: 'subagent_upsert'; subagent: OmpSubagentSnapshot }
  | { type: 'subagent_remove'; id: string }
  | { type: 'pending'; action: OmpTodoPendingAction }
  | { type: 'failed'; action: OmpTodoPendingAction; error: string }
  | { type: 'reminder'; todos: OmpTodoItem[]; attempt: number; maxAttempts: number }
  | { type: 'auto_clear' };

export function createOmpTodoState(): OmpTodoState {
  return {
    available: false,
    phases: [],
    subagents: [],
    revision: 0,
    updatedAt: Date.now(),
  };
}

function cloneOmpSubagentSnapshot(subagent: OmpSubagentSnapshot): OmpSubagentSnapshot {
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

function sortSubagents(subagents: OmpSubagentSnapshot[]): OmpSubagentSnapshot[] {
  return subagents
    .map(cloneOmpSubagentSnapshot)
    .sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
}

export function cloneOmpTodoState(state: OmpTodoState): OmpTodoState {
  return {
    available: state.available,
    sessionId: state.sessionId,
    phases: cloneOmpTodoPhases(state.phases),
    subagents: state.subagents.map(cloneOmpSubagentSnapshot),
    revision: state.revision,
    pendingAction: state.pendingAction,
    error: state.error,
    reminder: state.reminder
      ? {
          todos: state.reminder.todos.map(cloneOmpTodoItem),
          attempt: state.reminder.attempt,
          maxAttempts: state.reminder.maxAttempts,
        }
      : undefined,
    updatedAt: state.updatedAt,
  };
}

export function reduceOmpTodoState(state: OmpTodoState, action: OmpTodoStateAction): OmpTodoState {
  const updatedAt = Date.now();

  switch (action.type) {
    case 'unavailable':
      return {
        available: false,
        phases: [],
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
        phases: cloneOmpTodoPhases(action.phases),
        subagents: sameSession ? state.subagents.map(cloneOmpSubagentSnapshot) : [],
        revision: sameSession ? state.revision + 1 : 1,
        reminder: sameSession ? state.reminder : undefined,
        updatedAt,
      };
    }

    case 'subagents_snapshot':
      return {
        ...cloneOmpTodoState(state),
        subagents: sortSubagents(action.subagents),
        updatedAt,
      };

    case 'subagent_upsert': {
      const existing = new Map(state.subagents.map((subagent) => [subagent.id, cloneOmpSubagentSnapshot(subagent)]));
      existing.set(action.subagent.id, cloneOmpSubagentSnapshot(action.subagent));
      return {
        ...cloneOmpTodoState(state),
        subagents: sortSubagents([...existing.values()]),
        updatedAt,
      };
    }

    case 'subagent_remove':
      return {
        ...cloneOmpTodoState(state),
        subagents: state.subagents
          .filter((subagent) => subagent.id !== action.id)
          .map(cloneOmpSubagentSnapshot),
        updatedAt,
      };

    case 'pending':
      return {
        ...cloneOmpTodoState(state),
        pendingAction: action.action,
        error: undefined,
        updatedAt,
      };

    case 'failed':
      return {
        ...cloneOmpTodoState(state),
        pendingAction: state.pendingAction === action.action ? undefined : state.pendingAction,
        error: action.error,
        updatedAt,
      };

    case 'reminder':
      return {
        ...cloneOmpTodoState(state),
        reminder: {
          todos: action.todos.map(cloneOmpTodoItem),
          attempt: action.attempt,
          maxAttempts: action.maxAttempts,
        },
        updatedAt,
      };

    case 'auto_clear':
      return {
        ...cloneOmpTodoState(state),
        phases: [],
        subagents: state.subagents.map(cloneOmpSubagentSnapshot),
        reminder: undefined,
        revision: state.revision + 1,
        updatedAt,
      };

    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
