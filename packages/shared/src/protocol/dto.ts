/**
 * Server DTO types — data shapes used by RPC handlers and SessionManager.
 *
 * These were previously in apps/electron/src/shared/types.ts.
 * Extracted here so handler code in @craft-agent/server-core can import
 * from @craft-agent/shared/protocol without reaching into the app.
 */

import type {
  Message,
  TypedError,
  ContentBadge,
  OmpCommandResultMeta,
  ToolDisplayMeta,
  AnnotationV1,
  PermissionRequest as BasePermissionRequest,
  ExtensionUiRequest,
  ExtensionUiResponse,
} from '@craft-agent/core/types'
import type { PermissionMode } from '../agent/mode-types'
import type { ThinkingLevel } from '../agent/thinking-levels'
import type { CustomEndpointConfig } from '../config/llm-connections'
import type { OmpSessionLink } from '../sessions/types'
import type {
  OmpAgentCreateSpec,
  OmpAgentDefinitionState,
  OmpAgentPatch,
  OmpTangentialAgentOptions,
  OmpCollabState,
  OmpCollabParticipant,
  OmpSessionTreeState,
  OmpSessionTreeNode,
  OmpModelState,
  OmpDebugToolDefinition,
  OmpDebugResult,
} from '../agent/backend/omp/omp-rpc-protocol.ts'
import type {
  AuthRequest as SharedAuthRequest,
  CredentialInputMode as SharedCredentialInputMode,
  CredentialAuthRequest as SharedCredentialAuthRequest,
} from '../agent/index'

// Re-export generateMessageId for handler convenience
export { generateMessageId } from '@craft-agent/core/types'

// ---------------------------------------------------------------------------
// Session types
// ---------------------------------------------------------------------------

/**
 * Dynamic status ID referencing workspace status config.
 * Validated at runtime via validateSessionStatus().
 * Falls back to 'todo' if status doesn't exist.
 */
export type SessionStatus = string

export type BuiltInStatusId = 'todo' | 'in-progress' | 'needs-review' | 'done' | 'cancelled'

// ---------------------------------------------------------------------------
// OMP runtime control DTOs (main → renderer, renderer → main)
// ---------------------------------------------------------------------------

export type OmpQueueMode = 'all' | 'one-at-a-time'
export type OmpInterruptMode = 'immediate' | 'wait'
export type OmpDeliveryMode = 'steer' | 'followUp' | 'abortAndPrompt'

export type OmpAvailableCommandSource =
  | 'builtin'
  | 'skill'
  | 'extension'
  | 'custom'
  | 'mcp_prompt'
  | 'file'

export interface OmpAvailableSubcommandDto {
  name: string
  description?: string
  usage?: string
}

export interface OmpAvailableCommandDto {
  name: string
  aliases?: string[]
  description?: string
  input?: { hint?: string }
  subcommands?: OmpAvailableSubcommandDto[]
  source: OmpAvailableCommandSource
}

export interface OmpQueueControlStateDto {
  isStreaming: boolean
  isCompacting: boolean
  steeringMode: OmpQueueMode
  followUpMode: OmpQueueMode
  interruptMode: OmpInterruptMode
  queuedMessageCount: number
}

export interface OmpContextUsageDto {
  tokens: number
  contextWindow: number
  percent: number
}

export interface OmpSessionStatsDto {
  sessionFile?: string
  sessionId: string
  userMessages: number
  assistantMessages: number
  toolCalls: number
  toolResults: number
  totalMessages: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
  premiumRequests: number
  cost: number
}

export interface OmpCompactionResultDto {
  summary: string
  shortSummary?: string
  firstKeptEntryId: string
  tokensBefore: number
}

export interface OmpRuntimeStateDto {
  contextUsage?: OmpContextUsageDto
  stats?: OmpSessionStatsDto
  autoCompactionEnabled?: boolean
  autoRetryEnabled?: boolean
  compaction: {
    phase: 'idle' | 'running' | 'succeeded' | 'failed' | 'aborted' | 'skipped'
    manual?: boolean
    reason?: 'threshold' | 'overflow' | 'idle' | 'incomplete'
    action?: 'context-full' | 'handoff' | 'shake' | 'snapcompact'
    result?: OmpCompactionResultDto
    willRetry?: boolean
    error?: string
  }
  retry: {
    phase: 'idle' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'
    attempt?: number
    maxAttempts?: number
    delayMs?: number
    error?: string
  }
  fallback?: {
    phase: 'applied' | 'succeeded'
    from?: string
    to: string
    role: string
  }
  pendingAction?: 'refresh' | 'compact' | 'set-auto-compaction' | 'set-auto-retry' | 'abort-retry'
  error?: string
  available: boolean
  updatedAt: number
}

export interface OmpControlStateDto {
  availableCommands: OmpAvailableCommandDto[]
  queue: OmpQueueControlStateDto
  runtime: OmpRuntimeStateDto
  plan: OmpPlanControlStateDto
  goal: OmpGoalControlStateDto
  loop: OmpLoopControlStateDto
  updatedAt: number
}

export type OmpPlanModePhaseDto = 'inactive' | 'planning' | 'awaiting_review' | 'executing' | 'paused'

export interface OmpPlanControlStateDto {
  supported: boolean
  state: {
    enabled: boolean
    phase: OmpPlanModePhaseDto
    planFilePath?: string
    planModel?: string
  }
  updatedAt: number
  error?: string
}

export type OmpGoalStatusDto = 'active' | 'paused' | 'budget-limited' | 'complete' | 'dropped'

export interface OmpGoalControlStateDto {
  supported: boolean
  state: {
    enabled: boolean
    paused: boolean
    goal?: {
      id: string
      objective: string
      status: OmpGoalStatusDto
      tokenBudget?: number
      tokensUsed: number
      timeUsedSeconds: number
      createdAt: number
      updatedAt: number
    }
  }
  updatedAt: number
  error?: string
}

export interface OmpLoopControlStateDto {
  supported: boolean
  state: {
    enabled: boolean
    prompt?: string
    limit?: string
    remaining?: number
    status: 'disabled' | 'waiting_for_prompt' | 'running'
  }
  updatedAt: number
  error?: string
}

export type OmpTodoStatusDto = 'pending' | 'in_progress' | 'completed' | 'abandoned'

export interface OmpTodoItemDto {
  content: string
  status: OmpTodoStatusDto
  details?: string
  notes?: string[]
}

export interface OmpTodoPhaseDto {
  name: string
  tasks: OmpTodoItemDto[]
}

export type OmpSubagentSourceDto = 'bundled' | 'user' | 'project'
export type OmpSubagentStatusDto = 'pending' | 'running' | 'completed' | 'failed' | 'aborted'

export interface OmpSubagentRecentToolDto {
  tool: string
  args: string
  endMs: number
}

export interface OmpSubagentProgressDto {
  id: string
  index?: number
  agent?: string
  agentSource?: OmpSubagentSourceDto
  status: OmpSubagentStatusDto
  task?: string
  assignment?: string
  description?: string
  lastIntent?: string
  currentTool?: string
  currentToolArgs?: string
  currentToolStartMs?: number
  recentTools?: OmpSubagentRecentToolDto[]
  recentOutput?: string[]
  toolCount?: number
  requests?: number
  tokens?: number
  contextTokens?: number
  contextWindow?: number
  cost?: number
  durationMs?: number
  modelOverride?: string | string[]
  resolvedModel?: string
  retryState?: {
    attempt: number
    maxAttempts: number
    delayMs: number
    errorMessage: string
    startedAtMs: number
  }
  retryFailure?: {
    attempt: number
    errorMessage: string
  }
}

export interface OmpSubagentSnapshotDto {
  id: string
  index: number
  agent: string
  agentSource: OmpSubagentSourceDto
  description?: string
  status: OmpSubagentStatusDto
  task?: string
  assignment?: string
  sessionFile?: string
  lastUpdate: number
  progress?: OmpSubagentProgressDto
  parentToolCallId?: string
  todoPhases?: OmpTodoPhaseDto[]
}

export interface OmpTodoReminderDto {
  todos: OmpTodoItemDto[]
  attempt: number
  maxAttempts: number
}

export interface OmpTodoStateDto {
  available: boolean
  sessionId?: string
  phases: OmpTodoPhaseDto[]
  subagents: OmpSubagentSnapshotDto[]
  revision: number
  pendingAction?: 'refresh' | 'write'
  error?: string
  reminder?: OmpTodoReminderDto
  updatedAt: number
}

export interface OmpSubagentTranscriptCursorDto {
  fromByte: number
  nextByte?: number
  hasMore: boolean
}

export interface OmpSubagentStateItemDto extends OmpSubagentSnapshotDto {
  transcriptEntries: unknown[]
  transcriptMessages: unknown[]
  cursor?: OmpSubagentTranscriptCursorDto
  transcriptError?: string
  transcriptLoading: boolean
}

export interface OmpSubagentStateDto {
  available: boolean
  sessionId?: string
  subagents: OmpSubagentStateItemDto[]
  revision: number
  pendingAction?: 'refresh' | 'load-transcript'
  error?: string
  updatedAt: number
}

export type OmpTodoMutationDto =
  | { type: 'replace'; phases: OmpTodoPhaseDto[] }
  | { type: 'addPhase'; name?: string; index?: number }
  | { type: 'renamePhase'; phaseIndex: number; name: string }
  | { type: 'removePhase'; phaseIndex: number }
  | { type: 'addTask'; phaseIndex: number; content: string; index?: number }
  | { type: 'editTask'; phaseIndex: number; taskIndex: number; content: string }
  | { type: 'startTask'; phaseIndex: number; taskIndex: number }
  | { type: 'completeTask'; phaseIndex: number; taskIndex: number }
  | { type: 'abandonTask'; phaseIndex: number; taskIndex: number }
  | { type: 'reopenTask'; phaseIndex: number; taskIndex: number }
  | { type: 'removeTask'; phaseIndex: number; taskIndex: number }

/**
 * Electron-specific Session type (includes runtime state).
 * Extends core Session with messages array and processing state.
 */
export interface Session {
  id: string
  workspaceId: string
  workspaceName: string
  name?: string
  /** Preview of first user message (from JSONL header, for lazy-loaded sessions) */
  preview?: string
  lastMessageAt: number
  messages: Message[]
  isProcessing: boolean
  isFlagged?: boolean
  /** Permission mode for this session ('safe', 'ask', 'allow-all') */
  permissionMode?: PermissionMode
  sessionStatus?: SessionStatus
  /** Labels (additive tags, many-per-session — bare IDs or "id::value" entries) */
  labels?: string[]
  lastReadMessageId?: string
  /**
   * Explicit unread flag - single source of truth for NEW badge.
   * Set to true when assistant message completes while user is NOT viewing.
   * Set to false when user views the session (and not processing).
   */
  hasUnread?: boolean
  enabledSourceSlugs?: string[]
  workingDirectory?: string
  sessionFolderPath?: string
  sharedUrl?: string
  sharedId?: string
  model?: string
  llmConnection?: string
  thinkingLevel?: ThinkingLevel
  lastMessageRole?: 'user' | 'assistant' | 'plan' | 'tool' | 'error'
  lastFinalMessageId?: string
  isAsyncOperationOngoing?: boolean
  /** @deprecated Use isAsyncOperationOngoing instead */
  isRegeneratingTitle?: boolean
  currentStatus?: {
    message: string
    statusType?: string
  }
  createdAt?: number
  messageCount?: number
  tokenUsage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    contextTokens: number
    costUsd: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
    /** Model's context window size in tokens (from SDK modelUsage) */
    contextWindow?: number
  }
  /** When true, session is hidden from session list (e.g., mini edit sessions) */
  hidden?: boolean
  isArchived?: boolean
  archivedAt?: number
  supportsBranching?: boolean
  /** Runtime-only OMP command/queue state. Not persisted in session JSONL. */
  ompControlState?: OmpControlStateDto
  /** Runtime-only OMP phased Todo state. Not persisted in Craft JSONL. */
  ompTodoState?: OmpTodoStateDto
  /** Runtime-only OMP subagent state. Not persisted in Craft JSONL. */
  ompSubagentState?: OmpSubagentStateDto
  /** Runtime-only OMP model state (temporary model override). Not persisted in Craft JSONL. */
  ompModelState?: OmpModelState
  /** Persisted OMP-native session identity for provider transcript continuity. */
  ompSessionLink?: OmpSessionLink
}

export interface CreateSessionOptions {
  name?: string
  permissionMode?: PermissionMode
  /**
   * Reasoning/thinking level override. When set, takes precedence over workspace
   * and global defaults. Silently ignored by the underlying SDK on non-reasoning
   * models (e.g. gpt-4o) — provider drivers don't attach the reasoning param to
   * the API request for models with `reasoning: false` in the Pi SDK catalog.
   */
  thinkingLevel?: ThinkingLevel
  /**
   * Working directory for the session:
   * - 'user_default' or undefined: Use workspace's configured default working directory
   * - 'none': No working directory (session folder only)
   * - Absolute path string: Use this specific path
   */
  workingDirectory?: string | 'user_default' | 'none'
  model?: string
  llmConnection?: string
  systemPromptPreset?: 'default' | 'mini' | string
  hidden?: boolean
  sessionStatus?: SessionStatus
  labels?: string[]
  isFlagged?: boolean
  enabledSourceSlugs?: string[]
  /**
   * Message ID to branch from. This is a hard context cutoff:
   * the new session must not include model context from later parent messages.
   */
  branchFromMessageId?: string
  /** Parent session ID used together with branchFromMessageId. */
  branchFromSessionId?: string
}

export interface RemoteSessionTransferPayload {
  sourceSessionId: string
  name?: string
  sessionStatus?: SessionStatus
  labels?: string[]
  permissionMode?: PermissionMode
  summary: string
}

export interface ImportRemoteSessionTransferResult {
  sessionId: string
}

export interface PermissionModeState {
  permissionMode: PermissionMode
  previousPermissionMode?: PermissionMode
  transitionDisplay?: string
  modeVersion: number
  changedAt: string
  changedBy: 'user' | 'system' | 'restore' | 'automation' | 'unknown'
}

// ---------------------------------------------------------------------------
// Session events (main → renderer)
// ---------------------------------------------------------------------------

// turnId: Correlation ID from the API's message.id, groups all events in an assistant turn
export type SessionEvent =
  | { type: 'text_delta'; sessionId: string; delta: string; isThinking?: boolean; turnId?: string }
  | { type: 'text_complete'; sessionId: string; text: string; isIntermediate?: boolean; isThinking?: boolean; turnId?: string; parentToolUseId?: string; timestamp?: number; messageId?: string }
  | { type: 'tool_start'; sessionId: string; toolName: string; toolUseId: string; toolInput: Record<string, unknown>; toolIntent?: string; toolDisplayName?: string; toolDisplayMeta?: ToolDisplayMeta; turnId?: string; parentToolUseId?: string; timestamp?: number }
  | { type: 'tool_update'; sessionId: string; toolUseId: string; content: string; isError?: boolean; turnId?: string; parentToolUseId?: string; timestamp?: number }
  | { type: 'tool_result'; sessionId: string; toolUseId: string; toolName: string; result: string; turnId?: string; parentToolUseId?: string; isError?: boolean; timestamp?: number }
  | { type: 'error'; sessionId: string; error: string; timestamp?: number }
  | { type: 'typed_error'; sessionId: string; error: TypedError; timestamp?: number }
  | { type: 'complete'; sessionId: string; tokenUsage?: Session['tokenUsage']; hasUnread?: boolean }
  | { type: 'interrupted'; sessionId: string; message?: Message; queuedMessages?: string[] }
  | { type: 'status'; sessionId: string; message: string; statusType?: 'compacting' }
  | { type: 'info'; sessionId: string; message: string; statusType?: 'compaction_complete'; level?: 'info' | 'warning' | 'error' | 'success'; ompCommand?: OmpCommandResultMeta; timestamp?: number }
  | { type: 'title_generated'; sessionId: string; title: string }
  | { type: 'title_regenerating'; sessionId: string; isRegenerating: boolean }
  | { type: 'async_operation'; sessionId: string; isOngoing: boolean }
  | { type: 'working_directory_changed'; sessionId: string; workingDirectory: string }
  | { type: 'omp_control_state_changed'; sessionId: string; state: OmpControlStateDto }
  | { type: 'omp_todo_state_changed'; sessionId: string; state: OmpTodoStateDto }
  | { type: 'omp_subagent_state_changed'; sessionId: string; state: OmpSubagentStateDto }
  | { type: 'permission_request'; sessionId: string; request: PermissionRequest }
  | { type: 'credential_request'; sessionId: string; request: CredentialRequest }
  | { type: 'extension_ui_request'; sessionId: string; request: ExtensionUiRequest }
  | { type: 'extension_ui_cancel'; sessionId: string; requestId: string; targetId: string }
  | { type: 'permission_mode_changed'; sessionId: string; permissionMode: PermissionMode; previousPermissionMode?: PermissionMode; transitionDisplay?: string; modeVersion?: number; changedAt?: string; changedBy?: PermissionModeState['changedBy'] }
  | { type: 'plan_submitted'; sessionId: string; message: Message }
  | { type: 'sources_changed'; sessionId: string; enabledSourceSlugs: string[] }
  | { type: 'labels_changed'; sessionId: string; labels: string[] }
  | { type: 'connection_changed'; sessionId: string; connectionSlug: string; supportsBranching?: boolean }
  | { type: 'task_backgrounded'; sessionId: string; toolUseId: string; taskId: string; intent?: string; turnId?: string }
  | { type: 'shell_backgrounded'; sessionId: string; toolUseId: string; shellId: string; intent?: string; command?: string; turnId?: string }
  | { type: 'task_progress'; sessionId: string; toolUseId: string; elapsedSeconds: number; turnId?: string }
  | { type: 'task_completed'; sessionId: string; taskId: string; status: 'completed' | 'failed' | 'stopped'; outputFile?: string; summary?: string; turnId?: string }
  | { type: 'shell_killed'; sessionId: string; shellId: string }
  | { type: 'user_message'; sessionId: string; message: Message; status: 'accepted' | 'queued' | 'processing'; optimisticMessageId?: string }
  | { type: 'session_flagged'; sessionId: string }
  | { type: 'session_unflagged'; sessionId: string }
  | { type: 'session_archived'; sessionId: string }
  | { type: 'session_unarchived'; sessionId: string }
  | { type: 'name_changed'; sessionId: string; name?: string }
  | { type: 'session_model_changed'; sessionId: string; model: string | null }
  | { type: 'session_thinking_level_changed'; sessionId: string; thinkingLevel: ThinkingLevel }
  | { type: 'session_status_changed'; sessionId: string; sessionStatus: SessionStatus }
  | { type: 'session_deleted'; sessionId: string }
  | { type: 'session_created'; sessionId: string }
  | { type: 'session_shared'; sessionId: string; sharedUrl: string }
  | { type: 'session_unshared'; sessionId: string }
  | { type: 'auth_request'; sessionId: string; message: Message; request: SharedAuthRequest }
  | { type: 'auth_completed'; sessionId: string; requestId: string; success: boolean; cancelled?: boolean; error?: string }
  | { type: 'source_activated'; sessionId: string; sourceSlug: string; originalMessage: string }
  // P1: Collab events
  | { type: 'collab_state_update'; sessionId: string; state: OmpCollabState }
  | { type: 'collab_participant_joined'; sessionId: string; participant: OmpCollabParticipant }
  | { type: 'collab_participant_left'; sessionId: string; participantId: string }
  | { type: 'collab_connection_update'; sessionId: string; connection: string; error?: string }
  | { type: 'usage_update'; sessionId: string; tokenUsage: { inputTokens: number; contextWindow?: number } }
  | { type: 'message_annotations_updated'; sessionId: string; messageId: string; annotations: AnnotationV1[] }
  | { type: 'working_directory_error'; sessionId: string; error: string }

export interface SendMessageOptions {
  skillSlugs?: string[]
  badges?: ContentBadge[]
  optimisticMessageId?: string
  /** OMP-only mid-stream delivery preference. Other backends ignore it. */
  ompDeliveryMode?: OmpDeliveryMode
}

// ---------------------------------------------------------------------------
// Session commands (consolidated operations)
// ---------------------------------------------------------------------------

export type SessionCommand =
  | { type: 'flag' }
  | { type: 'unflag' }
  | { type: 'archive' }
  | { type: 'unarchive' }
  | { type: 'rename'; name: string }
  | { type: 'setSessionStatus'; state: SessionStatus }
  | { type: 'markRead' }
  | { type: 'markUnread' }
  | { type: 'setActiveViewing'; workspaceId: string }
  | { type: 'setPermissionMode'; mode: PermissionMode }
  | { type: 'setThinkingLevel'; level: ThinkingLevel }
  | { type: 'setOmpSteeringMode'; mode: OmpQueueMode }
  | { type: 'setOmpFollowUpMode'; mode: OmpQueueMode }
  | { type: 'setOmpInterruptMode'; mode: OmpInterruptMode }
  | { type: 'setOmpPlanMode'; enabled: boolean }
  | { type: 'setOmpGoal'; objective: string; tokenBudget?: number; replace?: boolean }
  | { type: 'setOmpGoalBudget'; tokenBudget?: number }
  | { type: 'pauseOmpGoal' }
  | { type: 'resumeOmpGoal' }
  | { type: 'dropOmpGoal' }
  | { type: 'guidedGoalTurn'; messages: Array<{ role: 'user' | 'assistant'; content: string }> }
  | { type: 'setOmpLoop'; enabled: boolean; prompt?: string; limit?: string }
  | { type: 'refreshOmpRuntime' }
  | { type: 'compactOmpRuntime' }
  | { type: 'setOmpAutoCompaction'; enabled: boolean }
  | { type: 'setOmpAutoRetry'; enabled: boolean }
  | { type: 'abortOmpRetry' }
  | { type: 'refreshOmpTodos' }
  | { type: 'mutateOmpTodos'; expectedRevision: number; mutation: OmpTodoMutationDto }
  | { type: 'importOmpTodosMarkdown'; expectedRevision: number; markdown: string }
  | { type: 'exportOmpTodosMarkdown' }
  | { type: 'refreshOmpSubagents' }
  | { type: 'loadOmpSubagentMessages'; subagentId: string; fromByte?: number }
  | { type: 'updateWorkingDirectory'; dir: string }
  | { type: 'setSources'; sourceSlugs: string[] }
  | { type: 'setLabels'; labels: string[] }
  | { type: 'showInFinder' }
  | { type: 'copyPath' }
  | { type: 'shareToViewer' }
  | { type: 'updateShare' }
  | { type: 'revokeShare' }
  | { type: 'refreshTitle' }
  | { type: 'getOmpBranchOptions' }
  | { type: 'branchOmpSession'; entryId: string; craftMessageId: string }
  | { type: 'handoffOmpSession'; customInstructions?: string }
  | { type: 'exportOmpSessionHtml'; outputPath?: string }
  | { type: 'getOmpLoginProviders' }
  | { type: 'loginOmpProvider'; providerId: string }
  | { type: 'logoutOmpProvider'; providerId: string }
  | { type: 'getOmpCapabilities' }
  // P1: MCP OAuth / Smithery
  | { type: 'getMcpState' }
  | { type: 'mcpReauth'; serverName: string }
  | { type: 'mcpUnauth'; serverName: string }
  | { type: 'mcpReconnect'; serverName: string }
  | { type: 'getMcpNotifications' }
  | { type: 'setMcpNotifications'; enabled: boolean }
  | { type: 'smitheryLogin' }
  | { type: 'smitheryLogout' }
  // P1: Collab
  | { type: 'getCollabState' }
  | { type: 'startCollab'; readOnly?: boolean }
  | { type: 'joinCollab'; invite: string; readOnly?: boolean }
  | { type: 'leaveCollab' }
  | { type: 'stopCollab' }
  | { type: 'setCollabPresence'; displayName?: string; status?: string }
  // P2: Session tree / extensions / marketplace / agents
  | { type: 'getSessionTree' }
  | { type: 'forkSession'; entryId: string; name?: string }
  | { type: 'switchSession'; ompSessionPath: string }
  | { type: 'getExtensions' }
  | { type: 'setExtensionEnabled'; id: string; enabled: boolean }
  | { type: 'reloadExtensions' }
  | { type: 'uninstallExtension'; id: string }
  | { type: 'searchMarketplace'; query: string; page?: number }
  | { type: 'getMarketplaceItem'; id: string }
  | { type: 'installMarketplaceItem'; id: string; version?: string }
  | { type: 'updateMarketplaceItem'; id: string; version?: string }
  | { type: 'uninstallMarketplaceItem'; id: string }
  | { type: 'getAgentDefinitions' }
  | { type: 'setAgentEnabled'; id: string; enabled: boolean }
  | { type: 'setAgentModelOverride'; id: string; model?: string }
  | { type: 'createAgent'; spec: OmpAgentCreateSpec }
  | { type: 'updateAgent'; id: string; patch: OmpAgentPatch }
  | { type: 'reloadAgents' }
  // P3: BTW / TAN / OMFG / Debug / STT
  | { type: 'askSideQuestion'; message: string }
  | { type: 'startTangentialAgent'; task: string; options?: OmpTangentialAgentOptions }
  | { type: 'getTangentialAgents' }
  | { type: 'cancelTangentialAgent'; id: string }
  | { type: 'proposeTtsrRule'; description: string }
  | { type: 'confirmTtsrRule'; ruleId: string }
  | { type: 'listTtsrRules' }
  | { type: 'deleteTtsrRule'; ruleId: string }
  | { type: 'getDebugTools' }
  | { type: 'runDebugTool'; toolId: string; args?: Record<string, unknown> }
  | { type: 'transcribeAudio'; audioData: string; mimeType: string; maxDurationSeconds?: number }
  // P4: Retry / queue / temporary model / settings
  | { type: 'retryLastTurn' }
  | { type: 'getRetryState' }
  | { type: 'getQueueState' }
  | { type: 'dequeueMessage'; messageId: string }
  | { type: 'reorderQueue'; messageIds: string[] }
  | { type: 'setTemporaryModel'; provider: string; modelId: string }
  | { type: 'clearTemporaryModel' }
  | { type: 'getSettingsSchema' }
  // P4: Prompt history
  | { type: 'getPromptHistory' }
  | { type: 'setPromptHistory'; prompts: string[]; enabled: boolean }
  | { type: 'getSettings'; scope?: 'global' | 'project' | 'effective' }
  | { type: 'setSettings'; scope: 'global' | 'project'; patch: Record<string, unknown>; expectedRevision?: number }
  | { type: 'openExternalEditor'; draft: string }
  | { type: 'setConnection'; connectionSlug: string }
  | { type: 'setPendingPlanExecution'; planPath: string; draftInputSnapshot?: string }
  | { type: 'markCompactionComplete' }
  | { type: 'markPendingPlanExecutionDispatched' }
  | { type: 'clearPendingPlanExecution' }
  | { type: 'addAnnotation'; messageId: string; annotation: AnnotationV1 }
  | { type: 'removeAnnotation'; messageId: string; annotationId: string }
  | { type: 'updateAnnotation'; messageId: string; annotationId: string; patch: Partial<AnnotationV1> }

export interface NewChatActionParams {
  input?: string
  name?: string
}

// ---------------------------------------------------------------------------
// Permission / credential types
// ---------------------------------------------------------------------------

export type { BasePermissionRequest }

/**
 * Permission request with session context (for multi-session Electron app)
 */
export interface PermissionRequest extends BasePermissionRequest {
  sessionId: string
}

export interface PermissionResponseOptions {
  rememberForMinutes?: number
}

// Re-export for handler convenience
export type { SharedCredentialInputMode as CredentialInputMode }
export type CredentialRequest = SharedCredentialAuthRequest
export type { SharedAuthRequest as AuthRequest }

export interface CredentialResponse {
  type: 'credential'
  value?: string
  username?: string
  password?: string
  headers?: Record<string, string>
  cancelled: boolean
}

export type {
  ExtensionUiMethod,
  ExtensionUiRequest,
  ExtensionUiResponse,
} from '@craft-agent/core/types'

// ---------------------------------------------------------------------------
// Directory browsing types (remote mode)
// ---------------------------------------------------------------------------

/** Server-side directory listing result (for remote directory browsing). */
export interface DirectoryListingResult {
  /** Normalized absolute path of the listed directory (after resolve(), not symlink-resolved). */
  currentPath: string
  /** Parent directory path, or null if at root. */
  parentPath: string | null
  /** Pre-split breadcrumb segments for display (computed server-side). */
  breadcrumbs: Array<{ name: string; path: string }>
  /** Server platform info. */
  platform: 'win32' | 'darwin' | 'linux'
  /** Whether the server truncated the directory list for safety/performance. */
  truncated: boolean
  /** Total number of matching child directories before truncation. */
  totalEntries: number
  /** Child directory entries. */
  entries: Array<{ name: string; path: string; isSymlink: boolean }>
}

// ---------------------------------------------------------------------------
// File types
// ---------------------------------------------------------------------------

export interface FileAttachment {
  type: 'image' | 'text' | 'pdf' | 'office' | 'audio' | 'unknown'
  path: string
  name: string
  mimeType: string
  base64?: string
  text?: string
  size: number
  thumbnailBase64?: string
}

export interface SessionFile {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  children?: SessionFile[]
}

export interface FileSearchResult {
  name: string
  path: string
  type: 'file' | 'directory'
  relativePath: string
}

// ---------------------------------------------------------------------------
// LLM connection types
// ---------------------------------------------------------------------------

/**
 * Resolved Anthropic OAuth identity (issue #838), captured from the
 * token-exchange response. Shape mirrors `ClaudeOAuthIdentity` in
 * `auth/claude-oauth.ts`; kept in the protocol layer so DTOs stay decoupled
 * from the auth module. All fields optional and fail-soft.
 */
export interface ClaudeOAuthIdentityDto {
  account?: { uuid?: string; emailAddress?: string }
  organization?: { uuid?: string; name?: string }
}

export interface LlmConnectionSetup {
  slug: string
  credential?: string
  baseUrl?: string | null
  defaultModel?: string | null
  models?: string[] | null
  piAuthProvider?: string
  modelSelectionMode?: 'automaticallySyncedFromProvider' | 'userDefined3Tier'
  /** When true, reject setup if the connection doesn't already exist (reauth guard). */
  updateOnly?: boolean
  /** Custom endpoint protocol for arbitrary OpenAI/Anthropic-compatible APIs */
  customEndpoint?: CustomEndpointConfig
  /** IAM credentials for Pi+Bedrock (piAuthProvider='amazon-bedrock') connections */
  iamCredentials?: {
    accessKeyId: string
    secretAccessKey: string
    sessionToken?: string
  }
  /** AWS region for Pi+Bedrock connections */
  awsRegion?: string
  /** Bedrock authentication method — determines auth type for Pi+Bedrock connections */
  bedrockAuthMethod?: 'iam_credentials' | 'environment'
  /**
   * Resolved Anthropic OAuth identity (issue #838), threaded through setup so it
   * persists for both new and re-auth connections. Optional and fail-soft.
   */
  oauthIdentity?: ClaudeOAuthIdentityDto
}

export interface TestLlmConnectionParams {
  provider: 'anthropic' | 'pi'
  apiKey: string
  baseUrl?: string
  model?: string
  piAuthProvider?: string
  /** Optional custom endpoint protocol hint so setup tests mirror runtime routing */
  customEndpoint?: CustomEndpointConfig
}

export interface TestLlmConnectionResult {
  success: boolean
  error?: string
}

export type OmpCommandSource = 'config' | 'env' | 'bundled' | 'default'

export type OmpRuntimeErrorCode =
  | 'not_found'
  | 'spawn_failed'
  | 'timeout'
  | 'rpc_error'
  | 'no_models'
  | 'unknown'

export interface OmpRuntimeStatus {
  ok: boolean
  command: string
  args: string[]
  rawCommand: string
  source: OmpCommandSource
  cwd?: string
  elapsedMs: number
  modelCount?: number
  defaultModel?: string
  version?: string
  protocolVersion: 'unversioned'
  error?: string
  errorCode?: OmpRuntimeErrorCode
  checkedAt: number
}

export interface SetOmpCommandPathResult {
  success: boolean
  status?: OmpRuntimeStatus
  error?: string
}

export interface OmpRuntimeResourceItemDto {
  name: string
  description?: string
  path?: string
  source?: 'bundled' | 'user' | 'project' | 'native' | 'runtime'
  provider?: string
  status?: 'connected' | 'connecting' | 'disconnected'
  toolCount?: number
}

export interface OmpRuntimeResourcesDto {
  skills: OmpRuntimeResourceItemDto[]
  mcp: OmpRuntimeResourceItemDto[]
  agents: OmpRuntimeResourceItemDto[]
}

export interface OmpDiagnosticsSummary {
  runtime: OmpRuntimeStatus
  providers?: {
    providers: OmpLoginProviderDto[]
    authenticated: number
    available: number
    total: number
  }
  agentDir?: string
  configFileExists?: boolean
  authDirExists?: boolean
  runtimeResources?: OmpRuntimeResourcesDto
  runtimeResourcesError?: string
  versionCompatibility?: {
    ompVersion?: string
    compatible: boolean
    warning?: string
  }
}

// ---------------------------------------------------------------------------
// OMP Feature Center DTOs
// ---------------------------------------------------------------------------

export type OmpFeatureValueSource = 'default' | 'global' | 'project'
export type OmpFeaturePathLevel = 'bundled' | 'user' | 'project'

export interface OmpFeatureConfigPathDto {
  path: string
  exists: boolean
  parseError?: string
}

export interface OmpFeatureCenterRuntimeDto {
  available: boolean
  version?: string
  executablePath?: string
  rawCommand?: string
  commandSource?: OmpCommandSource
  globalConfigPath: string
  projectRootPath?: string
  projectConfigPath?: string
  projectConfigExists?: boolean
  checkedAt: number
  error?: string
}

export interface OmpFeatureModelRoleDto {
  role: string
  label: string
  common: boolean
  source: OmpFeatureValueSource
  effectiveValue?: string
  globalValue?: string
  projectValue?: string
  projectOverridden: boolean
}

export interface OmpFeatureAdvisorSettingDto<T = string | boolean> {
  source: OmpFeatureValueSource
  effectiveValue: T
  globalValue?: T
  projectValue?: T
  projectOverridden: boolean
}

export interface OmpFeatureAdvisorRosterItemDto {
  name: string
  model?: string
  tools?: string[]
  instructions?: string
  level?: OmpFeaturePathLevel
  path?: string
}

export interface OmpFeatureAdvisorRosterEditableDto {
  path: string
  exists: boolean
  parseError?: string
  instructions?: string
  advisors: OmpFeatureAdvisorRosterItemDto[]
}

export interface OmpFeatureAdvisorRosterDto {
  paths: OmpFeatureConfigPathDto[]
  advisors: OmpFeatureAdvisorRosterItemDto[]
  editable: OmpFeatureAdvisorRosterEditableDto
  sharedInstructions: boolean
  parseErrors: string[]
}

export interface OmpFeatureAdvisorDto {
  enabled: OmpFeatureAdvisorSettingDto<boolean>
  subagents: OmpFeatureAdvisorSettingDto<boolean>
  modelRole: OmpFeatureAdvisorSettingDto<string>
  roster: OmpFeatureAdvisorRosterDto
}

export interface OmpFeatureCapabilityItemDto {
  name: string
  path?: string
  level: OmpFeaturePathLevel
  description?: string
  provider?: string
  status?: 'connected' | 'connecting' | 'disconnected'
  toolCount?: number
  runtimeLoaded?: boolean
}

export interface OmpFeatureCapabilityDto {
  count: number
  sourcePaths: OmpFeatureConfigPathDto[]
  items: OmpFeatureCapabilityItemDto[]
  usageHint: string
  error?: string
}

export interface OmpFeatureNativePlanDto {
  modelRole?: string
  supportStatus: 'rpc-unavailable' | 'model-role-only' | 'rpc-command-available'
  toggleAvailable: boolean
  approvalUi: 'not-exposed' | 'extension-ui-if-emitted'
  rpcCommands: string[]
  unavailableReason?: string
  message: string
}

export type OmpFeatureUnavailableCommandStatus = 'hidden' | 'desktop-equivalent' | 'needs-upstream-rpc'

export interface OmpFeatureUnavailableCommandDto {
  command: string
  label: string
  status: OmpFeatureUnavailableCommandStatus
  reason: string
  alternative?: string
}

export interface OmpFeatureCenterStateDto {
  runtime: OmpFeatureCenterRuntimeDto
  config: {
    global: OmpFeatureConfigPathDto
    project?: OmpFeatureConfigPathDto
  }
  modelRoles: {
    common: OmpFeatureModelRoleDto[]
    advanced: OmpFeatureModelRoleDto[]
  }
  advisor: OmpFeatureAdvisorDto
  skills: OmpFeatureCapabilityDto
  mcp: OmpFeatureCapabilityDto
  agents: OmpFeatureCapabilityDto
  nativePlan: OmpFeatureNativePlanDto
  unavailableCommands: OmpFeatureUnavailableCommandDto[]
  lastRefreshedAt: number
}

export type OpenOmpFeatureCenterPathAction = 'open' | 'reveal'

export interface OpenOmpFeatureCenterPathInput {
  workspaceId?: string | null
  path: string
  action: OpenOmpFeatureCenterPathAction
}

export interface SaveOmpFeatureCenterConfigInput {
  workspaceId?: string | null
  modelRoles?: Record<string, string | null | undefined>
  advisor?: {
    enabled?: boolean
    subagents?: boolean
  }
  advisorRoster?: {
    instructions?: string | null
    advisors?: Array<{
      name?: string | null
      model?: string | null
      tools?: string[] | null
      instructions?: string | null
    }>
  }
}

export interface SaveOmpFeatureCenterConfigResult {
  success: boolean
  state?: OmpFeatureCenterStateDto
  error?: string
}

// ---------------------------------------------------------------------------
// Source / skill types
// ---------------------------------------------------------------------------

export interface SkillFile {
  name: string
  type: 'file' | 'directory'
  size?: number
  children?: SkillFile[]
}

export interface OAuthResult {
  success: boolean
  error?: string
}

export interface McpValidationResult {
  success: boolean
  error?: string
  tools?: string[]
}

export interface McpToolWithPermission {
  name: string
  description?: string
  allowed: boolean
}

export interface McpToolsResult {
  success: boolean
  error?: string
  tools?: McpToolWithPermission[]
}

// ---------------------------------------------------------------------------
// Search types
// ---------------------------------------------------------------------------

export interface SessionSearchMatch {
  sessionId: string
  lineNumber: number
  snippet: string
}

export interface SessionSearchResult {
  sessionId: string
  matchCount: number
  matches: SessionSearchMatch[]
}

// ---------------------------------------------------------------------------
// Session result types
// ---------------------------------------------------------------------------

export interface UnreadSummary {
  totalUnreadSessions: number
  byWorkspace: Record<string, number>
  hasUnreadByWorkspace: Record<string, boolean>
}

export interface ShareResult {
  success: boolean
  url?: string
  error?: string
}

export interface RefreshTitleResult {
  success: boolean
  title?: string
  error?: string
}

export interface OmpBranchOption {
  entryId: string
  craftMessageId: string
  ordinal: number
  textPreview: string
}

export interface OmpBranchOptionsResult {
  success: boolean
  options?: OmpBranchOption[]
  error?: string
}

export interface OmpBranchSessionResult {
  success: boolean
  selectedText?: string
  cancelled?: boolean
  sessionLink?: OmpSessionLink
  error?: string
}

export interface OmpHandoffSessionResult {
  success: boolean
  savedPath?: string
  cancelled?: boolean
  sessionLink?: OmpSessionLink
  error?: string
}

export interface OmpExportHtmlResult {
  success: boolean
  outputPath?: string
  error?: string
}

export interface OmpSessionTreeResult {
  success: boolean
  tree?: OmpSessionTreeState
  error?: string
}

export interface OmpSessionForkResult {
  success: boolean
  /** The new OMP session identifier for the forked session. */
  ompSessionId?: string
  /** The Craft session that was created from the fork. */
  craftSessionId?: string
  error?: string
}

export interface OmpSessionSwitchResult {
  success: boolean
  /** The Craft session ID that was navigated to after the switch. */
  craftSessionId?: string
  error?: string
}

export interface OmpTodoMarkdownExportResult {
  success: boolean
  markdown?: string
  error?: string
}

export interface OmpLoginProviderDto {
  id: string
  name: string
  available: boolean
  authenticated: boolean
}

export interface OmpLoginProvidersResult {
  success: boolean
  providers?: OmpLoginProviderDto[]
  error?: string
}

export interface OmpLoginSessionResult {
  success: boolean
  providerId?: string
  openUrl?: string
  launchUrl?: string
  instructions?: string
  error?: string
}

export type SessionCommandResult =
  | void
  | ShareResult
  | RefreshTitleResult
  | { count: number }
  | OmpBranchOptionsResult
  | OmpBranchSessionResult
  | OmpHandoffSessionResult
  | OmpExportHtmlResult
  | OmpSessionTreeResult
  | OmpSessionForkResult
  | OmpTodoMarkdownExportResult
  | OmpLoginProvidersResult
  | OmpLoginSessionResult
  | OmpDebugToolDefinition[]
  | OmpDebugResult


// ---------------------------------------------------------------------------
// Plan types
// ---------------------------------------------------------------------------

export interface PlanStep {
  id: string
  description: string
  tools?: string[]
  status?: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'
}

export interface Plan {
  id: string
  title: string
  summary?: string
  steps: PlanStep[]
  questions?: string[]
  state?: 'creating' | 'refining' | 'ready' | 'executing' | 'completed' | 'cancelled'
  createdAt?: number
  updatedAt?: number
}

// ---------------------------------------------------------------------------
// System types
// ---------------------------------------------------------------------------

export interface GitBashStatus {
  found: boolean
  path: string | null
  platform: 'win32' | 'darwin' | 'linux'
}

export interface UpdateInfo {
  available: boolean
  currentVersion: string
  latestVersion: string | null
  downloadState: 'idle' | 'downloading' | 'ready' | 'installing' | 'error'
  downloadProgress: number
  error?: string
}

// ---------------------------------------------------------------------------
// Workspace types
// ---------------------------------------------------------------------------

export interface WorkspaceSettings {
  name?: string
  model?: string
  permissionMode?: PermissionMode
  cyclablePermissionModes?: PermissionMode[]
  thinkingLevel?: ThinkingLevel
  workingDirectory?: string
  localMcpEnabled?: boolean
  defaultLlmConnection?: string
  enabledSourceSlugs?: string[]
}

// ---------------------------------------------------------------------------
// Auth result types
// ---------------------------------------------------------------------------

export interface ClaudeOAuthResult {
  success: boolean
  token?: string
  error?: string
  /**
   * Resolved Anthropic identity (issue #838), forwarded to the renderer so it
   * can thread it into the SETUP payload (which is what persists it). Present
   * only when the token-exchange response carried identity.
   */
  identity?: ClaudeOAuthIdentityDto
}

// ---------------------------------------------------------------------------
// Automation types
// ---------------------------------------------------------------------------

export type TestAutomationAction =
  | { type: 'prompt'; prompt: string; llmConnection?: string; model?: string; thinkingLevel?: ThinkingLevel }
  | { type: 'webhook'; url: string; method?: string; headers?: Record<string, string>; bodyFormat?: 'json' | 'form' | 'raw'; body?: unknown; captureResponse?: boolean; auth?: { type: 'basic'; username: string; password: string } | { type: 'bearer'; token: string } }

export interface TestAutomationPayload {
  workspaceId: string
  automationId?: string
  automationName?: string
  actions: TestAutomationAction[]
  permissionMode?: PermissionMode
  labels?: string[]
  /** Forwarded from the matcher; routes test-run sessions into a Telegram topic when paired. */
  telegramTopic?: string
}

export type TestAutomationActionResult =
  | { type: 'prompt'; success: boolean; stderr?: string; sessionId?: string; duration: number }
  | { type: 'webhook'; success: boolean; url: string; statusCode: number; error?: string; duration: number }

export interface TestAutomationResult {
  actions: TestAutomationActionResult[]
}

// ---------------------------------------------------------------------------
// Window types
// ---------------------------------------------------------------------------

export type WindowCloseRequestSource = 'keyboard-shortcut' | 'window-button' | 'unknown'

export interface WindowCloseRequest {
  source: WindowCloseRequestSource
}

// ---------------------------------------------------------------------------
// Browser / navigation types (data shapes used by BroadcastEventMap)
// ---------------------------------------------------------------------------

export interface BrowserInstanceInfo {
  id: string
  url: string
  title: string
  favicon: string | null
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  boundSessionId: string | null
  ownerType: 'session' | 'manual'
  ownerSessionId: string | null
  isVisible: boolean
  agentControlActive: boolean
  themeColor: string | null
  /**
   * Workspace that owns this browser instance, or `null` for unbound manual
   * windows. Renderers filter the tab strip / status badge by `activeWorkspaceId`
   * so a session in workspace A doesn't see windows opened by workspace B.
   * Missing/null entries always pass the filter — this keeps older renderers
   * and main processes that pre-date the field working unchanged.
   */
  workspaceId?: string | null
}

export interface DeepLinkNavigation {
  view?: string
  tabType?: string
  tabParams?: Record<string, string>
  action?: string
  actionParams?: Record<string, string>
}

// ---------------------------------------------------------------------------
// OMP resource lifecycle DTOs (MCP, Skills, Agents)
// ---------------------------------------------------------------------------

export type OmpResourceType = 'mcp' | 'skill' | 'agent'
export type OmpResourceScope = 'user' | 'project'
export type OmpResourceSource = 'bundled' | 'user' | 'project'

export interface OmpResourceDiagnostic {
  code: string
  message: string
  path?: string
}

export interface OmpResourceEntry {
  id: string
  type: OmpResourceType
  name: string
  source: OmpResourceSource
  scope: OmpResourceScope
  enabled: boolean
  effectiveEnabled: boolean
  path?: string
  description?: string
  provider?: string
  status?: 'connected' | 'connecting' | 'disconnected'
  toolCount?: number
  /** Runtime-discovered entries may be inspected but are not editable here. */
  readOnly?: boolean
  diagnostics: OmpResourceDiagnostic[]
  revision: string
  lastRefreshedAt: number
}

export interface OmpResourceCategory {
  entries: OmpResourceEntry[]
  sourcePaths: OmpFeatureConfigPathDto[]
  error?: string
}

/** Counts reported by OMP's live discovery providers, including runtime-only resources. */
export interface OmpResourceRuntimeCounts {
  skills: number
  mcp: number
  agents: number
}

export interface OmpResourceSnapshot {
  mcp: OmpResourceCategory
  skills: OmpResourceCategory
  agents: OmpResourceCategory
  /** Present when the OMP RPC runtime exposed its live resource inventory. */
  runtimeCounts?: OmpResourceRuntimeCounts
  runtimeResourcesError?: string
  diagnostics: OmpResourceDiagnostic[]
  refreshedAt: number
}

export interface OmpResourceOperationResult {
  success: boolean
  snapshot?: OmpResourceSnapshot
  error?: string
  code?: string
}

export interface OmpResourceMcpTestResult extends OmpResourceOperationResult {
  connected?: boolean
  tools?: Array<{ name: string; description?: string }>
  testError?: string
}

export interface OmpResourceSnapshotInput {
  workspaceId?: string
  scope?: OmpResourceScope
}

export interface OmpResourceCreateInput {
  workspaceId?: string
  type: OmpResourceType
  scope: OmpResourceScope
  draft: Record<string, unknown>
}

export interface OmpResourceUpdateInput {
  workspaceId?: string
  type: OmpResourceType
  id: string
  scope: OmpResourceScope
  expectedRevision: string
  patch: Record<string, unknown>
}

export interface OmpResourceSetEnabledInput {
  workspaceId?: string
  type: OmpResourceType
  id: string
  scope: OmpResourceScope
  expectedRevision: string
  enabled: boolean
}

export interface OmpResourceRemoveInput {
  workspaceId?: string
  type: OmpResourceType
  id: string
  scope: OmpResourceScope
  expectedRevision: string
}

export interface OmpResourceTestMcpInput {
  workspaceId?: string
  id: string
  scope: OmpResourceScope
}

// Re-export OMP capability types for renderer/server parity
export type {
  OmpModelState,
  OmpModelSelectionSource,
  OmpCapabilityManifest,
  OmpSmitheryState,
  OmpSmitheryAuthStatus,
  OmpFeatureId,
  OmpCapabilityFeatureInfo,
  OmpCollabState,
  OmpCollabParticipant,
  OmpSessionTreeState,
  OmpSessionTreeNode,
  OmpDebugToolDefinition,
  OmpDebugToolParameter,
  OmpDebugResult,
} from '../agent/backend/omp/omp-rpc-protocol.ts'
export { parseOmpCapabilityManifest } from '../agent/backend/omp/omp-rpc-protocol.ts'
// Re-export OMP extension types
export type {
  OmpExtensionState,
  OmpExtensionCapability,
  OmpExtensionSource,
  OmpExtensionStatus,
} from '../agent/backend/omp/omp-rpc-protocol.ts'
// Re-export OMP agent types
export type {
  OmpAgentDefinitionState,
  OmpAgentCreateSpec,
  OmpAgentPatch,
  OmpAgentSource,
} from '../agent/backend/omp/omp-rpc-protocol.ts'
export { parseOmpAgentDefinitionState } from '../agent/backend/omp/omp-rpc-protocol.ts'


// Re-export OMP settings types
export type {
  OmpSettingsSchema,
  OmpSettingsSchemaEntry,
  OmpSettingsState,
  OmpSettingsSetResult,
  OmpSettingsScope,
  OmpSettingsValueType,
  OmpSettingsAppliesTo,
} from '../agent/backend/omp/omp-rpc-protocol.ts'

// Re-export OMP marketplace types
export type {
  OmpMarketplaceItem,
  OmpMarketplaceSearchResult,
} from '../agent/backend/omp/omp-rpc-protocol.ts'
