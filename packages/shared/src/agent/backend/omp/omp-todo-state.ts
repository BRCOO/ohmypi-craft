import type { OmpTodoItem, OmpTodoPhase } from './omp-rpc-protocol.ts';
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
  revision: number;
  pendingAction?: OmpTodoPendingAction;
  error?: string;
  reminder?: OmpTodoReminderState;
  updatedAt: number;
}

export type OmpTodoStateAction =
  | { type: 'unavailable'; error?: string }
  | { type: 'session_state'; sessionId: string; phases: OmpTodoPhase[] }
  | { type: 'pending'; action: OmpTodoPendingAction }
  | { type: 'failed'; action: OmpTodoPendingAction; error: string }
  | { type: 'reminder'; todos: OmpTodoItem[]; attempt: number; maxAttempts: number }
  | { type: 'auto_clear' };

export function createOmpTodoState(): OmpTodoState {
  return {
    available: false,
    phases: [],
    revision: 0,
    updatedAt: Date.now(),
  };
}

export function cloneOmpTodoState(state: OmpTodoState): OmpTodoState {
  return {
    available: state.available,
    sessionId: state.sessionId,
    phases: cloneOmpTodoPhases(state.phases),
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
        revision: sameSession ? state.revision + 1 : 1,
        reminder: sameSession ? state.reminder : undefined,
        updatedAt,
      };
    }

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
