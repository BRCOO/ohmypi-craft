/**
 * Minimal repository-local snapshot of the OMP RPC protocol used by Craft.
 *
 * Upstream source:
 *   oh-my-pi-upstream/packages/coding-agent/src/modes/rpc/rpc-types.ts
 * Snapshot date: 2026-07-06
 *
 * Keep this intentionally narrow. It is a compatibility boundary, not a copy of
 * the full OMP protocol. Add shapes only when the Craft backend consumes them.
 */

export type OmpRpcCommand =
  | { type: 'prompt'; message: string }
  | { type: 'steer'; message: string }
  | { type: 'abort' }
  | { type: 'get_state' }
  | { type: 'set_model'; provider: string; modelId: string }
  | { type: 'permission_response'; requestId: string; decision: 'approved' | 'denied' };

export type OmpRpcExtensionUiResponse =
  | { type: 'extension_ui_response'; id: string; value: string }
  | { type: 'extension_ui_response'; id: string; confirmed: boolean }
  | { type: 'extension_ui_response'; id: string; cancelled: true; timedOut?: boolean };

export interface OmpRpcResponseFrame<T = unknown> {
  type: 'response';
  id?: string;
  command: string;
  success: boolean;
  error?: string;
  data?: T;
}

export interface OmpRpcPromptResultFrame {
  type: 'prompt_result';
  id?: string;
  agentInvoked: boolean;
}

export interface OmpRpcPromptResponseData {
  agentInvoked: boolean;
}

export interface OmpRpcSessionState {
  sessionId: string;
  sessionFile?: string;
  sessionName?: string;
  thinkingLevel?: unknown;
  isStreaming: boolean;
  isCompacting: boolean;
  steeringMode: 'all' | 'one-at-a-time';
  followUpMode: 'all' | 'one-at-a-time';
  interruptMode: 'immediate' | 'wait';
  autoCompactionEnabled: boolean;
  messageCount: number;
  queuedMessageCount: number;
  todoPhases: unknown[];
  [key: string]: unknown;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function parseOmpRpcResponse(value: unknown): OmpRpcResponseFrame | null {
  const raw = asObject(value);
  if (
    raw?.type !== 'response'
    || !isString(raw.command)
    || typeof raw.success !== 'boolean'
    || (raw.id !== undefined && !isString(raw.id))
    || (raw.error !== undefined && !isString(raw.error))
  ) {
    return null;
  }

  return {
    type: 'response',
    id: raw.id as string | undefined,
    command: raw.command,
    success: raw.success,
    error: raw.error as string | undefined,
    data: raw.data,
  };
}

export function parseOmpPromptResult(value: unknown): OmpRpcPromptResultFrame | null {
  const raw = asObject(value);
  if (
    raw?.type !== 'prompt_result'
    || typeof raw.agentInvoked !== 'boolean'
    || (raw.id !== undefined && !isString(raw.id))
  ) {
    return null;
  }

  return {
    type: 'prompt_result',
    id: raw.id as string | undefined,
    agentInvoked: raw.agentInvoked,
  };
}

export function parseOmpPromptResponseData(value: unknown): OmpRpcPromptResponseData | null {
  const raw = asObject(value);
  if (!raw || typeof raw.agentInvoked !== 'boolean') return null;
  return { agentInvoked: raw.agentInvoked };
}

export function parseOmpSessionState(value: unknown): OmpRpcSessionState | null {
  const raw = asObject(value);
  if (
    !raw
    || !isString(raw.sessionId)
    || raw.sessionId.trim().length === 0
    || typeof raw.isStreaming !== 'boolean'
    || typeof raw.isCompacting !== 'boolean'
    || (raw.steeringMode !== 'all' && raw.steeringMode !== 'one-at-a-time')
    || (raw.followUpMode !== 'all' && raw.followUpMode !== 'one-at-a-time')
    || (raw.interruptMode !== 'immediate' && raw.interruptMode !== 'wait')
    || typeof raw.autoCompactionEnabled !== 'boolean'
    || !isFiniteNumber(raw.messageCount)
    || !isFiniteNumber(raw.queuedMessageCount)
    || !Array.isArray(raw.todoPhases)
    || (raw.sessionFile !== undefined && !isString(raw.sessionFile))
    || (raw.sessionName !== undefined && !isString(raw.sessionName))
  ) {
    return null;
  }

  return {
    ...raw,
    sessionId: raw.sessionId,
    sessionFile: raw.sessionFile as string | undefined,
    sessionName: raw.sessionName as string | undefined,
    isStreaming: raw.isStreaming,
    isCompacting: raw.isCompacting,
    steeringMode: raw.steeringMode,
    followUpMode: raw.followUpMode,
    interruptMode: raw.interruptMode,
    autoCompactionEnabled: raw.autoCompactionEnabled,
    messageCount: raw.messageCount,
    queuedMessageCount: raw.queuedMessageCount,
    todoPhases: raw.todoPhases,
  };
}
