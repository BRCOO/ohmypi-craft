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

import type { ThinkingLevel } from '../../thinking-levels.ts';

export type OmpThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type OmpQueueMode = 'all' | 'one-at-a-time';
export type OmpInterruptMode = 'immediate' | 'wait';
export type OmpRpcAvailableSlashCommandSource =
  | 'builtin'
  | 'skill'
  | 'extension'
  | 'custom'
  | 'mcp_prompt'
  | 'file';

export interface OmpRpcImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export interface OmpRpcAvailableSlashSubcommand {
  name: string;
  description?: string;
  usage?: string;
}

export interface OmpRpcAvailableSlashCommand {
  name: string;
  aliases?: string[];
  description?: string;
  input?: { hint?: string };
  subcommands?: OmpRpcAvailableSlashSubcommand[];
  source: OmpRpcAvailableSlashCommandSource;
}

export interface OmpRpcAvailableCommandsResponseData {
  commands: OmpRpcAvailableSlashCommand[];
}

export interface OmpRpcHostToolDefinition {
  name: string;
  label?: string;
  description: string;
  parameters: Record<string, unknown>;
  hidden?: boolean;
}

export interface OmpRpcAgentToolTextContent {
  type: 'text';
  text: string;
}

export interface OmpRpcAgentToolImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export type OmpRpcAgentToolContent =
  | OmpRpcAgentToolTextContent
  | OmpRpcAgentToolImageContent;

export interface OmpRpcAgentToolResult {
  content: OmpRpcAgentToolContent[];
  details?: unknown;
  isError?: boolean;
}

export interface OmpRpcHostToolCallFrame {
  type: 'host_tool_call';
  id: string;
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface OmpRpcHostToolCancelFrame {
  type: 'host_tool_cancel';
  id: string;
  targetId: string;
}

export interface OmpRpcHostToolUpdateFrame {
  type: 'host_tool_update';
  id: string;
  partialResult: OmpRpcAgentToolResult;
}

export interface OmpRpcHostToolResultFrame {
  type: 'host_tool_result';
  id: string;
  result: OmpRpcAgentToolResult;
  isError?: boolean;
}

export interface OmpRpcSetHostToolsResponseData {
  toolNames: string[];
}

export interface OmpRpcHostUriSchemeDefinition {
  scheme: string;
  description?: string;
  writable?: boolean;
  immutable?: boolean;
}

export type OmpRpcHostUriOperation = 'read' | 'write';

export interface OmpRpcHostUriRequestFrame {
  type: 'host_uri_request';
  id: string;
  operation: OmpRpcHostUriOperation;
  url: string;
  content?: string;
}

export interface OmpRpcHostUriCancelFrame {
  type: 'host_uri_cancel';
  id: string;
  targetId: string;
}

export interface OmpRpcHostUriResultFrame {
  type: 'host_uri_result';
  id: string;
  content?: string;
  contentType?: 'text/markdown' | 'application/json' | 'text/plain';
  notes?: string[];
  immutable?: boolean;
  isError?: boolean;
  error?: string;
}

export interface OmpRpcSetHostUriSchemesResponseData {
  schemes: string[];
}

export interface OmpRpcCancellationResult {
  cancelled: boolean;
}

export interface OmpRpcBranchMessage {
  entryId: string;
  text: string;
}

export interface OmpRpcBranchMessagesResponseData {
  messages: OmpRpcBranchMessage[];
}

export interface OmpRpcBranchResult {
  text: string;
  cancelled: boolean;
}

export interface OmpRpcExportHtmlResponseData {
  path: string;
}

export interface OmpRpcHandoffResult {
  savedPath?: string;
}

export interface OmpRpcLastAssistantTextResponseData {
  text: string | null;
}

export interface OmpRpcSessionInfoUpdateFrame {
  type: 'session_info_update';
  sessionId?: string;
  title?: string;
}

export interface OmpRpcReadyFrame {
  type: 'ready';
  protocolVersion?: string;
  ompVersion?: string;
  sessionId?: string;
}

export interface OmpRpcMessageStartFrame {
  type: 'message_start';
  messageId?: string;
  role?: string;
  parentMessageId?: string;
  turnId?: string;
  index?: number;
}

export interface OmpRpcMessageUpdateFrame {
  type: 'message_update';
  messageId?: string;
  delta?: unknown;
  content?: unknown;
  assistantMessageEvent?: Record<string, unknown>;
  assistant_message_event?: Record<string, unknown>;
}

export interface OmpRpcMessageEndFrame {
  type: 'message_end';
  messageId?: string;
  message?: Record<string, unknown>;
  sdkMessageId?: string;
  sdk_message_id?: string;
}

export interface OmpRpcToolExecutionUpdateFrame {
  type: 'tool_execution_update';
  toolCallId?: string;
  tool_call_id?: string;
  partialResult?: unknown;
  partial_result?: unknown;
  stdout?: string;
  stderr?: string;
  progress?: unknown;
  artifact?: unknown;
  image?: unknown;
}

export interface OmpRpcConfigUpdateFrame {
  type: 'config_update';
  config?: Record<string, unknown>;
}

export type OmpStderrLevel = 'debug' | 'noise' | 'warn' | 'fatal';

export interface OmpRpcStderrFrame {
  type: 'stderr';
  text?: string;
  level?: OmpStderrLevel;
}

export type OmpSessionShutdownReason = 'normal' | 'switch' | 'crash' | 'external' | 'error';

export interface OmpRpcSessionShutdownFrame {
  type: 'session_shutdown';
  reason?: OmpSessionShutdownReason;
  errorMessage?: string;
}

export interface OmpRpcExtensionErrorFrame {
  type: 'extension_error';
  extensionId?: string;
  source?: string;
  message?: string;
  stackSummary?: string;
  recoverable?: boolean;
}

export interface OmpRpcMessagesResponseData {
  messages: unknown[];
}

export interface OmpContextUsage {
  tokens: number;
  contextWindow: number;
  percent: number;
}

export interface OmpSessionTokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface OmpSessionStats {
  sessionFile?: string;
  sessionId: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: OmpSessionTokenUsage;
  premiumRequests: number;
  cost: number;
}

export interface OmpCompactionResult {
  summary: string;
  shortSummary?: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: unknown;
  preserveData?: Record<string, unknown>;
}

export type OmpCompactionReason = 'threshold' | 'overflow' | 'idle' | 'incomplete';
export type OmpCompactionAction = 'context-full' | 'handoff' | 'shake' | 'snapcompact';

export type OmpRuntimeEvent =
  | {
      type: 'auto_compaction_start';
      reason: OmpCompactionReason;
      action: OmpCompactionAction;
    }
  | {
      type: 'auto_compaction_end';
      action: OmpCompactionAction;
      result?: OmpCompactionResult;
      aborted: boolean;
      willRetry: boolean;
      errorMessage?: string;
      skipped?: boolean;
    }
  | {
      type: 'auto_retry_start';
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
      errorId?: number;
    }
  | {
      type: 'auto_retry_end';
      success: boolean;
      attempt: number;
      finalError?: string;
    }
  | { type: 'retry_fallback_applied'; from: string; to: string; role: string }
  | { type: 'retry_fallback_succeeded'; model: string; role: string }

  // P1: MCP OAuth / Smithery / notifications
  | { type: 'mcp_server_state_update'; state: OmpMcpState }
  | { type: 'mcp_oauth_start'; start: OmpMcpOAuthStart }
  | { type: 'mcp_oauth_complete'; serverName: string; success: boolean; error?: string }
  | { type: 'mcp_notification'; notification: OmpMcpNotification }
  | { type: 'mcp_reconnect_progress'; serverName: string; phase: string; message?: string }
  | { type: 'smithery_state_update'; state: OmpSmitheryState }

  // P1: Collab
  | { type: 'collab_state_update'; state: OmpCollabState }
  | { type: 'collab_participant_joined'; participant: OmpCollabParticipant }
  | { type: 'collab_participant_left'; participantId: string }
  | { type: 'collab_message'; message: OmpCollabMessage }
  | { type: 'collab_connection_update'; connection: OmpCollabConnection; error?: string }

  // P2: Session tree / extensions / marketplace / agents
  | { type: 'session_tree_update'; tree: OmpSessionTreeState }
  | { type: 'extensions_update'; extensions: OmpExtensionState[] }
  | { type: 'extension_state_update'; extension: OmpExtensionState }
  | { type: 'marketplace_task_update'; taskId: string; phase: 'started' | 'progress' | 'completed' | 'failed' | 'cancelled'; message?: string; progress?: number; error?: string }
  | { type: 'agent_definitions_update'; agents: OmpAgentDefinitionState[] }
  | { type: 'agent_state_update'; agent: OmpAgentDefinitionState }

  // P3: BTW / TAN / OMFG / Debug / STT
  | { type: 'side_question_result'; result: OmpSideQuestionResult }
  | { type: 'tangential_agent_update'; agent: OmpTangentialAgent }
  | { type: 'ttsr_rules_update'; rules: OmpTtsrRule[] }
  | { type: 'debug_result'; result: OmpDebugResult }
  | { type: 'transcription_result'; result: OmpTranscriptionResult; error?: string }

  // P4: Retry / queue / temporary model / settings
  | { type: 'retry_state_update'; state: OmpRetryState }
  | { type: 'queue_state_update'; state: OmpQueueState }
  | { type: 'model_state_update'; state: OmpModelState }
  | { type: 'settings_schema_update'; schema: OmpSettingsSchema }
  | { type: 'settings_update'; state: OmpSettingsState };

export type OmpCompactionPhase = 'idle' | 'running' | 'succeeded' | 'failed' | 'aborted' | 'skipped';
export type OmpRetryPhase = 'idle' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';
export type OmpRuntimePendingAction =
  | 'refresh'
  | 'compact'
  | 'set-auto-compaction'
  | 'set-auto-retry'
  | 'abort-retry';

export interface OmpRuntimeConfig {
  model?: string;
  thinkingLevel?: OmpThinkingLevel;
  autoCompactionEnabled?: boolean;
  autoRetryEnabled?: boolean;
  steeringMode?: OmpQueueMode;
  followUpMode?: OmpQueueMode;
  interruptMode?: OmpInterruptMode;
}

export interface OmpRuntimeStderrEntry {
  level: OmpStderrLevel;
  text: string;
  at: number;
}

export interface OmpRuntimeExtensionErrorEntry {
  extensionId?: string;
  source?: string;
  message: string;
  at: number;
}

export interface OmpRuntimeState {
  contextUsage?: OmpContextUsage;
  stats?: OmpSessionStats;
  autoCompactionEnabled?: boolean;
  autoRetryEnabled?: boolean;
  compaction: {
    phase: OmpCompactionPhase;
    manual?: boolean;
    reason?: OmpCompactionReason;
    action?: OmpCompactionAction;
    result?: OmpCompactionResult;
    willRetry?: boolean;
    error?: string;
  };
  retry: {
    phase: OmpRetryPhase;
    attempt?: number;
    maxAttempts?: number;
    delayMs?: number;
    error?: string;
  };
  fallback?: {
    phase: 'applied' | 'succeeded';
    from?: string;
    to: string;
    role: string;
  };
  pendingAction?: OmpRuntimePendingAction;
  error?: string;
  available: boolean;
  updatedAt: number;
  ompVersion?: string;
  protocolVersion?: string;
  versionWarning?: string;
  config?: OmpRuntimeConfig;
  sessionShutdown?: {
    reason: OmpSessionShutdownReason;
    errorMessage?: string;
    at: number;
  };
  recentStderr?: OmpRuntimeStderrEntry[];
  recentExtensionErrors?: OmpRuntimeExtensionErrorEntry[];
}

export interface OmpRpcAvailableCommandsUpdateFrame {
  type: 'available_commands_update';
  commands: OmpRpcAvailableSlashCommand[];
}

export interface OmpQueueControlState {
  isStreaming: boolean;
  isCompacting: boolean;
  steeringMode: OmpQueueMode;
  followUpMode: OmpQueueMode;
  interruptMode: OmpInterruptMode;
  queuedMessageCount: number;
}

export interface OmpControlState {
  availableCommands: OmpRpcAvailableSlashCommand[];
  queue: OmpQueueControlState;
  runtime: OmpRuntimeState;
  plan: OmpPlanControlState;
  goal: OmpGoalControlState;
  loop: OmpLoopControlState;
  updatedAt: number;
}

export type OmpPlanModePhase = 'inactive' | 'planning' | 'awaiting_review' | 'executing' | 'paused';
export type OmpPlanReviewAction = 'approve' | 'refine' | 'cancel';

export interface OmpRpcCapabilities {
  planMode?: true;
  goalMode?: true;
  loopMode?: true;
  runtimeResources?: true;
}

export interface OmpRpcRuntimeResourceItem {
  name: string;
  description?: string;
  path?: string;
  source?: 'bundled' | 'user' | 'project' | 'native' | 'runtime';
  provider?: string;
  status?: 'connected' | 'connecting' | 'disconnected';
  toolCount?: number;
}

export interface OmpRpcRuntimeResources {
  skills: OmpRpcRuntimeResourceItem[];
  mcp: OmpRpcRuntimeResourceItem[];
  agents: OmpRpcRuntimeResourceItem[];
}

export type OmpGoalStatus = 'active' | 'paused' | 'budget-limited' | 'complete' | 'dropped';

export interface OmpRpcGoal {
  id: string;
  objective: string;
  status: OmpGoalStatus;
  tokenBudget?: number;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
}

export interface OmpRpcGoalModeState {
  enabled: boolean;
  paused: boolean;
  goal?: OmpRpcGoal;
}

export interface OmpRpcGoalModeStateUpdateFrame {
  type: 'goal_mode_state_update';
  state: OmpRpcGoalModeState;
}

export interface OmpRpcLoopModeState {
  enabled: boolean;
  prompt?: string;
  limit?: string;
  remaining?: number;
  status: 'disabled' | 'waiting_for_prompt' | 'running';
}

export interface OmpRpcLoopModeStateUpdateFrame {
  type: 'loop_mode_state_update';
  state: OmpRpcLoopModeState;
}

export interface OmpRpcPlanModeState {
  enabled: boolean;
  phase: OmpPlanModePhase;
  planFilePath?: string;
  planModel?: string;
}

export interface OmpRpcPlanModeStateUpdateFrame {
  type: 'plan_mode_state_update';
  state: OmpRpcPlanModeState;
}

export interface OmpRpcPlanReviewRequestFrame {
  type: 'plan_review_request';
  requestId: string;
  title: string;
  planFilePath: string;
  planMarkdown: string;
  options: OmpPlanReviewAction[];
}

export interface OmpPlanControlState {
  supported: boolean;
  state: OmpRpcPlanModeState;
  updatedAt: number;
  error?: string;
}

export interface OmpGoalControlState {
  supported: boolean;
  state: OmpRpcGoalModeState;
  updatedAt: number;
  error?: string;
}

export interface OmpLoopControlState {
  supported: boolean;
  state: OmpRpcLoopModeState;
  updatedAt: number;
  error?: string;
}

export type OmpTodoStatus = 'pending' | 'in_progress' | 'completed' | 'abandoned';

export interface OmpTodoItem {
  content: string;
  status: OmpTodoStatus;
  details?: string;
  notes?: string[];
}

export interface OmpTodoPhase {
  name: string;
  tasks: OmpTodoItem[];
}

export type OmpSubagentSource = 'bundled' | 'user' | 'project';
export type OmpSubagentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'aborted';
export type OmpSubagentLifecycleStatus = 'started' | 'completed' | 'failed' | 'aborted';
export type OmpSubagentSubscriptionLevel = 'off' | 'progress' | 'events';

export interface OmpSubagentRecentTool {
  tool: string;
  args: string;
  endMs: number;
}

export interface OmpSubagentRetryState {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  errorMessage: string;
  startedAtMs: number;
}

export interface OmpSubagentRetryFailure {
  attempt: number;
  errorMessage: string;
}

export interface OmpSubagentProgress {
  id: string;
  index?: number;
  agent?: string;
  agentSource?: OmpSubagentSource;
  status: OmpSubagentStatus;
  task?: string;
  assignment?: string;
  description?: string;
  lastIntent?: string;
  currentTool?: string;
  currentToolArgs?: string;
  currentToolStartMs?: number;
  recentTools?: OmpSubagentRecentTool[];
  recentOutput?: string[];
  toolCount?: number;
  requests?: number;
  tokens?: number;
  contextTokens?: number;
  contextWindow?: number;
  cost?: number;
  durationMs?: number;
  modelOverride?: string | string[];
  resolvedModel?: string;
  retryState?: OmpSubagentRetryState;
  retryFailure?: OmpSubagentRetryFailure;
}

export interface OmpSubagentSnapshot {
  id: string;
  index: number;
  agent: string;
  agentSource: OmpSubagentSource;
  description?: string;
  status: OmpSubagentStatus;
  task?: string;
  assignment?: string;
  sessionFile?: string;
  lastUpdate: number;
  progress?: OmpSubagentProgress;
  parentToolCallId?: string;
  todoPhases?: OmpTodoPhase[];
}

export interface OmpRpcSubagentsResponseData {
  subagents: OmpSubagentSnapshot[];
}

export interface OmpRpcSubagentMessagesResponseData {
  sessionFile: string;
  fromByte: number;
  nextByte: number;
  reset: boolean;
  entries: unknown[];
  messages: unknown[];
}

export interface OmpSubagentLifecyclePayload {
  id: string;
  agent: string;
  agentSource: OmpSubagentSource;
  description?: string;
  status: OmpSubagentLifecycleStatus;
  sessionFile?: string;
  parentToolCallId?: string;
  index: number;
  detached?: boolean;
}

export interface OmpSubagentProgressPayload {
  index: number;
  agent: string;
  agentSource: OmpSubagentSource;
  task: string;
  parentToolCallId?: string;
  assignment?: string;
  progress: OmpSubagentProgress;
  sessionFile?: string;
  detached?: boolean;
}

export interface OmpSubagentLifecycleFrame {
  type: 'subagent_lifecycle';
  payload: OmpSubagentLifecyclePayload;
}

export interface OmpSubagentProgressFrame {
  type: 'subagent_progress';
  payload: OmpSubagentProgressPayload;
}

export interface OmpSubagentEventFrame {
  type: 'subagent_event';
  payload: {
    id: string;
    event: Record<string, unknown>;
  };
}

export type OmpSubagentFrame = OmpSubagentLifecycleFrame | OmpSubagentProgressFrame | OmpSubagentEventFrame;

export interface OmpRpcSetTodosResponseData {
  todoPhases: OmpTodoPhase[];
}

export interface OmpRpcLoginProvider {
  id: string;
  name: string;
  available: boolean;
  authenticated: boolean;
}

export interface OmpRpcLoginProvidersResponseData {
  providers: OmpRpcLoginProvider[];
}

export interface OmpRpcLoginResult {
  providerId: string;
}

export type OmpTodoEvent =
  | {
      type: 'todo_reminder';
      todos: OmpTodoItem[];
      attempt: number;
      maxAttempts: number;
    }
  | { type: 'todo_auto_clear' };


// =============================================================================
// P0: Capability manifest and unified error envelope
// =============================================================================

export type OmpFeatureId =
  | 'mcp.oauth'
  | 'mcp.notifications'
  | 'smithery.auth'
  | 'auth.provider.logout'
  | 'collab.live'
  | 'session.tree'
  | 'extensions.control'
  | 'marketplace.browse'
  | 'agents.control'
  | 'tools.btw'
  | 'tools.tan'
  | 'tools.omfg'
  | 'tools.debug'
  | 'audio.stt'
  | 'goal.guided'
  | 'model.temporary'
  | 'retry.exact'
  | 'queue.dequeue'
  | 'prompt.history'
  | 'editor.external'
  | 'copy.picker'
  | 'settings.schema';

export interface OmpCapabilityFeatureInfo {
  supported: boolean;
  reason?: string;
  minProtocolVersion?: string;
}

export interface OmpCapabilityManifest {
  protocolVersion: string;
  runtimeVersion?: string;
  commands: string[];
  events: string[];
  features: Partial<Record<OmpFeatureId, OmpCapabilityFeatureInfo>>;
}

export interface OmpRpcError {
  code: string;
  message: string;
  retryable?: boolean;
  capability?: OmpFeatureId;
  details?: Record<string, unknown>;
}

// =============================================================================
// P1: MCP OAuth / Smithery / provider auth
// =============================================================================

export type OmpMcpServerAuthStatus = 'none' | 'authenticated' | 'expired' | 'error';

export interface OmpMcpServerState {
  name: string;
  enabled: boolean;
  connected: boolean;
  authStatus: OmpMcpServerAuthStatus;
  toolCount?: number;
  error?: string;
}

export interface OmpMcpState {
  servers: OmpMcpServerState[];
  notificationsEnabled: boolean;
  updatedAt: number;
}

export interface OmpMcpOAuthStart {
  serverName: string;
  oauthUrl: string;
  stateId: string;
  expiresAt: number;
}

export interface OmpMcpNotification {
  id: string;
  serverName: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  timestamp: number;
}

export type OmpSmitheryAuthStatus = 'none' | 'authenticating' | 'authenticated' | 'expired' | 'error';

export interface OmpSmitheryState {
  status: OmpSmitheryAuthStatus;
  username?: string;
  error?: string;
}

export interface OmpOAuthProviderState {
  id: string;
  name: string;
  authenticated: boolean;
}

// =============================================================================
// P1: Collab
// =============================================================================

export type OmpCollabRole = 'host' | 'guest' | 'readonly';
export type OmpCollabConnection = 'off' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface OmpCollabParticipant {
  id: string;
  displayName?: string;
  role: OmpCollabRole;
  status?: string;
  joinedAt?: number;
}

export interface OmpCollabState {
  connection: OmpCollabConnection;
  role?: OmpCollabRole;
  roomId?: string;
  inviteUrl?: string;
  webUrl?: string;
  participants: OmpCollabParticipant[];
  error?: string;
  updatedAt: number;
}

export interface OmpCollabMessage {
  id: string;
  participantId: string;
  content: string;
  timestamp: number;
}

// =============================================================================
// P2: Session tree / extensions / marketplace / agents
// =============================================================================

export interface OmpSessionLineage {
  ompSessionPath: string;
  parentOmpSessionPath?: string;
  branchEntryId?: string;
  rootOmpSessionPath?: string;
  depth: number;
}

export interface OmpSessionTreeNode {
  ompSessionPath: string;
  sessionName?: string;
  parentOmpSessionPath?: string;
  branchEntryId?: string;
  depth: number;
  isCurrent: boolean;
  children: OmpSessionTreeNode[];
}

export interface OmpSessionTreeState {
  root: OmpSessionTreeNode;
  currentOmpSessionPath: string;
}

export interface OmpExtensionCapability {
  commands?: string[];
  skills?: string[];
  mcps?: string[];
  agents?: string[];
}

export type OmpExtensionSource = 'builtin' | 'user' | 'project' | 'marketplace';
export type OmpExtensionStatus = 'enabled' | 'disabled' | 'error' | 'reload_required';

export interface OmpExtensionState {
  id: string;
  name: string;
  version: string;
  source: OmpExtensionSource;
  status: OmpExtensionStatus;
  error?: string;
  provides: OmpExtensionCapability;
  restartRequired: boolean;
}

export interface OmpMarketplaceItem {
  id: string;
  name: string;
  description?: string;
  version: string;
  author?: string;
  installed: boolean;
  updateAvailable: boolean;
  permissions: string[];
}

export interface OmpMarketplaceSearchResult {
  items: OmpMarketplaceItem[];
  total: number;
  page: number;
}

export type OmpAgentSource = 'bundled' | 'user' | 'project';

export interface OmpAgentDefinitionState {
  id: string;
  identifier: string;
  name: string;
  source: OmpAgentSource;
  enabled: boolean;
  whenToUse?: string;
  systemPrompt?: string;
  modelOverride?: string | string[];
  error?: string;
}

export interface OmpAgentCreateSpec {
  identifier: string;
  name?: string;
  whenToUse?: string;
  systemPrompt?: string;
  modelOverride?: string | string[];
  source: OmpAgentSource;
}

export type OmpAgentPatch = Partial<Omit<OmpAgentCreateSpec, 'identifier' | 'source'>>;

// =============================================================================
// P3: BTW / TAN / OMFG / Debug / STT
// =============================================================================

export interface OmpSideQuestionResult {
  answer: string;
  suggestions?: string[];
  canPromote?: boolean;
}

export interface OmpTangentialAgentOptions {
  notifyOnly?: boolean;
  insertContext?: boolean;
  tokenBudget?: number;
  timeBudgetSeconds?: number;
}

export type OmpTangentialAgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface OmpTangentialAgent {
  id: string;
  task: string;
  status: OmpTangentialAgentStatus;
  summary?: string;
  createdAt: number;
  updatedAt: number;
}

export interface OmpTtsrRulePreview {
  ruleId: string;
  matchCondition: string;
  injectedText: string;
  scope: string;
  priority: number;
}

export interface OmpTtsrRule extends OmpTtsrRulePreview {
  confirmedAt: number;
}

export interface OmpDebugToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'enum';
  description?: string;
  required?: boolean;
  options?: string[];
}

export interface OmpDebugToolDefinition {
  id: string;
  name: string;
  description: string;
  parameters: OmpDebugToolParameter[];
  dangerous?: boolean;
}

export interface OmpDebugResult {
  toolId: string;
  success: boolean;
  output: Record<string, unknown>;
  error?: string;
  sanitized: boolean;
}

export interface OmpTranscriptionResult {
  text: string;
  confidence?: number;
  language?: string;
}

// =============================================================================
// P4: Retry / queue / temporary model / settings
// =============================================================================

export type OmpModelSelectionSource = 'default' | 'session' | 'temporary';

export interface OmpModelState {
  model: string;
  source: OmpModelSelectionSource;
  expiresAtSessionEnd?: boolean;
}

export interface OmpQueueItem {
  messageId: string;
  mode: 'steer' | 'followUp' | 'abortAndPrompt' | 'prompt';
  preview: string;
  createdAt: number;
}

export interface OmpQueueState {
  messages: OmpQueueItem[];
  revision: number;
  updatedAt: number;
}

export interface OmpRetryState {
  phase: 'idle' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';
  lastFailedTurnId?: string;
  attempt?: number;
  maxAttempts?: number;
  error?: string;
}

export type OmpSettingsValueType = 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'object';
export type OmpSettingsScope = 'global' | 'project' | 'effective';
export type OmpSettingsAppliesTo = 'runtime' | 'desktop-equivalent' | 'tui-only' | 'advanced-raw';

export interface OmpSettingsSchemaEntry {
  path: string;
  type: OmpSettingsValueType;
  label: string;
  description?: string;
  tab?: string;
  group?: string;
  options?: Array<{ value: unknown; label: string }>;
  default?: unknown;
  effectiveValue?: unknown;
  sensitive: boolean;
  restartRequired: boolean;
  appliesTo: OmpSettingsAppliesTo;
}

export interface OmpSettingsSchema {
  entries: OmpSettingsSchemaEntry[];
  revision: number;
}

export interface OmpSettingsState {
  scope: OmpSettingsScope;
  values: Record<string, unknown>;
  revision: number;
}

export interface OmpSettingsSetResult {
  success: boolean;
  revision: number;
  restartRequired: boolean;
  conflict?: boolean;
  error?: string;
}

export type OmpRpcCommand =
  | {
      type: 'prompt';
      message: string;
      images?: OmpRpcImageContent[];
      streamingBehavior?: 'steer' | 'followUp';
    }
  | { type: 'steer'; message: string; images?: OmpRpcImageContent[] }
  | { type: 'follow_up'; message: string; images?: OmpRpcImageContent[] }
  | { type: 'abort_and_prompt'; message: string; images?: OmpRpcImageContent[] }
  | { type: 'abort' }
  | { type: 'new_session'; parentSession?: string }
  | { type: 'get_state' }
  | { type: 'get_plan_mode_state' }
  | { type: 'set_plan_mode'; enabled: boolean; initialPrompt?: string }
  | { type: 'reopen_plan_review' }
  | { type: 'plan_review_result'; requestId: string; action: OmpPlanReviewAction; feedback?: string }
  | { type: 'get_goal_state' }
  | { type: 'set_goal'; objective: string; tokenBudget?: number }
  | { type: 'replace_goal'; objective: string; tokenBudget?: number }
  | { type: 'pause_goal' }
  | { type: 'resume_goal' }
  | { type: 'drop_goal' }
  | { type: 'set_goal_budget'; tokenBudget?: number }
  | { type: 'guided_goal_turn'; messages: Array<{ role: 'user' | 'assistant'; content: string }> }
  | { type: 'get_loop_state' }
  | { type: 'set_loop'; enabled: boolean; prompt?: string; limit?: string }
  | { type: 'set_todos'; phases: OmpTodoPhase[] }
  | { type: 'set_host_tools'; tools: OmpRpcHostToolDefinition[] }
  | { type: 'set_host_uri_schemes'; schemes: OmpRpcHostUriSchemeDefinition[] }
  | { type: 'set_subagent_subscription'; level: OmpSubagentSubscriptionLevel }
  | { type: 'get_subagents' }
  | { type: 'get_subagent_messages'; subagentId?: string; sessionFile?: string; fromByte?: number }
  | { type: 'get_available_commands' }
  | { type: 'get_capabilities' }
  | { type: 'get_runtime_resources' }
  | { type: 'cycle_model' }
  | { type: 'get_available_models' }
  | { type: 'cycle_thinking_level' }
  | { type: 'bash'; command: string }
  | { type: 'abort_bash' }
  | { type: 'get_messages' }
  | { type: 'get_branch_messages' }
  | { type: 'get_last_assistant_text' }
  | { type: 'switch_session'; sessionPath: string }
  | { type: 'branch'; entryId: string }
  | { type: 'set_session_name'; name: string }
  | { type: 'handoff'; customInstructions?: string }
  | { type: 'export_html'; outputPath?: string }
  | { type: 'get_session_stats' }
  | { type: 'compact'; customInstructions?: string }
  | { type: 'set_auto_compaction'; enabled: boolean }
  | { type: 'set_auto_retry'; enabled: boolean }
  | { type: 'abort_retry' }
  | { type: 'set_model'; provider: string; modelId: string }
  | { type: 'set_thinking_level'; level: OmpThinkingLevel }
  | { type: 'set_steering_mode'; mode: OmpQueueMode }
  | { type: 'set_follow_up_mode'; mode: OmpQueueMode }
  | { type: 'set_interrupt_mode'; mode: OmpInterruptMode }
  | { type: 'get_login_providers' }
  | { type: 'login'; providerId: string }
  | { type: 'logout'; providerId: string }

  // P1: MCP OAuth / Smithery / notifications
  | { type: 'get_mcp_state' }
  | { type: 'mcp_reauth'; serverName: string }
  | { type: 'mcp_unauth'; serverName: string }
  | { type: 'mcp_reconnect'; serverName: string }
  | { type: 'get_mcp_notifications' }
  | { type: 'set_mcp_notifications'; enabled: boolean }
  | { type: 'smithery_login' }
  | { type: 'smithery_logout' }

  // P1: Collab
  | { type: 'get_collab_state' }
  | { type: 'start_collab'; readOnly?: boolean }
  | { type: 'join_collab'; invite: string; readOnly?: boolean }
  | { type: 'leave_collab' }
  | { type: 'stop_collab' }
  | { type: 'set_collab_presence'; displayName?: string; status?: string }

  // P2: Session tree / extensions / marketplace / agents
  | { type: 'get_session_tree' }
  | { type: 'fork_session'; entryId: string; name?: string }
  | { type: 'get_extensions' }
  | { type: 'set_extension_enabled'; id: string; enabled: boolean }
  | { type: 'reload_extensions' }
  | { type: 'uninstall_extension'; id: string }
  | { type: 'search_marketplace'; query: string; page?: number }
  | { type: 'get_marketplace_item'; id: string }
  | { type: 'install_marketplace_item'; id: string; version?: string }
  | { type: 'update_marketplace_item'; id: string; version?: string }
  | { type: 'uninstall_marketplace_item'; id: string }
  | { type: 'get_agent_definitions' }
  | { type: 'set_agent_enabled'; id: string; enabled: boolean }
  | { type: 'set_agent_model_override'; id: string; model?: string }
  | { type: 'create_agent'; spec: OmpAgentCreateSpec }
  | { type: 'update_agent'; id: string; patch: OmpAgentPatch }
  | { type: 'reload_agents' }

  // P3: BTW / TAN / OMFG / Debug / STT
  | { type: 'ask_side_question'; message: string }
  | { type: 'start_tangential_agent'; task: string; options?: OmpTangentialAgentOptions }
  | { type: 'get_tangential_agents' }
  | { type: 'cancel_tangential_agent'; id: string }
  | { type: 'propose_ttsr_rule'; description: string }
  | { type: 'confirm_ttsr_rule'; ruleId: string }
  | { type: 'list_ttsr_rules' }
  | { type: 'delete_ttsr_rule'; ruleId: string }
  | { type: 'get_debug_tools' }
  | { type: 'run_debug_tool'; toolId: string; args?: Record<string, unknown> }
  | { type: 'transcribe_audio'; audioData: string; mimeType: string; maxDurationSeconds?: number }

  // P4: Retry / queue / temporary model / settings
  | { type: 'retry_last_turn' }
  | { type: 'get_retry_state' }
  | { type: 'get_queue_state' }
  | { type: 'dequeue_message'; messageId: string }
  | { type: 'reorder_queue'; messageIds: string[] }
  | { type: 'set_temporary_model'; provider: string; modelId: string }
  | { type: 'clear_temporary_model' }
  | { type: 'get_settings_schema' }
  | { type: 'get_settings'; scope?: 'global' | 'project' | 'effective' }
  | { type: 'set_settings'; scope: 'global' | 'project'; patch: Record<string, unknown>; expectedRevision?: number }
  | { type: 'open_external_editor'; draft: string }

  | { type: 'permission_response'; requestId: string; decision: 'approved' | 'denied' };

export type OmpRpcStandardCommand = Exclude<OmpRpcCommand, { type: 'permission_response' }>;
export type OmpRpcCommandType = OmpRpcStandardCommand['type'];

export type OmpRpcCommandCategory =
  | 'prompting'
  | 'state'
  | 'model'
  | 'thinking'
  | 'queue'
  | 'compaction'
  | 'retry'
  | 'bash'
  | 'session'
  | 'messages'
  | 'login'
  | 'auth'
  | 'mcp'
  | 'collab'
  | 'extensions'
  | 'marketplace'
  | 'agents'
  | 'tree'
  | 'debug'
  | 'audio'
  | 'settings';

export interface OmpRpcCommandDefinition {
  category: OmpRpcCommandCategory;
  responseKind: string;
  timeoutMs: number;
  longRunning: boolean;
  sideEffect: boolean;
}

export const DEFAULT_OMP_RPC_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_OMP_RPC_LONG_REQUEST_TIMEOUT_MS = 300_000;

const ACK_RESPONSE = 'ack';
const READ_TIMEOUT = DEFAULT_OMP_RPC_REQUEST_TIMEOUT_MS;
const LONG_TIMEOUT = DEFAULT_OMP_RPC_LONG_REQUEST_TIMEOUT_MS;

function commandDefinition(
  category: OmpRpcCommandCategory,
  responseKind: string,
  options: {
    longRunning?: boolean;
    sideEffect?: boolean;
    timeoutMs?: number;
  } = {},
): OmpRpcCommandDefinition {
  const longRunning = options.longRunning ?? false;
  return {
    category,
    responseKind,
    timeoutMs: options.timeoutMs ?? (longRunning ? LONG_TIMEOUT : READ_TIMEOUT),
    longRunning,
    sideEffect: options.sideEffect ?? true,
  };
}

export const OMP_RPC_COMMAND_DEFINITIONS = {
  prompt: commandDefinition('prompting', 'prompt_result', { longRunning: true }),
  steer: commandDefinition('prompting', ACK_RESPONSE),
  follow_up: commandDefinition('prompting', ACK_RESPONSE),
  abort: commandDefinition('prompting', ACK_RESPONSE),
  abort_and_prompt: commandDefinition('prompting', ACK_RESPONSE, { longRunning: true }),
  new_session: commandDefinition('prompting', 'cancellation_result', { longRunning: true }),

  get_state: commandDefinition('state', 'session_state', { sideEffect: false }),
  get_plan_mode_state: commandDefinition('state', 'plan_mode_state', { sideEffect: false }),
  set_plan_mode: commandDefinition('state', 'plan_mode_state'),
  reopen_plan_review: commandDefinition('state', 'plan_mode_state'),
  plan_review_result: commandDefinition('state', 'plan_review_result'),
  get_goal_state: commandDefinition('state', 'goal_mode_state', { sideEffect: false }),
  set_goal: commandDefinition('state', 'goal_mode_state'),
  replace_goal: commandDefinition('state', 'goal_mode_state'),
  pause_goal: commandDefinition('state', 'goal_mode_state'),
  resume_goal: commandDefinition('state', 'goal_mode_state'),
  drop_goal: commandDefinition('state', 'goal_mode_state'),
  set_goal_budget: commandDefinition('state', 'goal_mode_state'),
  guided_goal_turn: commandDefinition('state', 'guided_goal_turn', { longRunning: true }),
  get_loop_state: commandDefinition('state', 'loop_mode_state', { sideEffect: false }),
  set_loop: commandDefinition('state', 'loop_mode_state'),
  get_available_commands: commandDefinition('state', 'available_commands', { sideEffect: false }),
  get_runtime_resources: commandDefinition('state', 'runtime_resources', { sideEffect: false }),
  set_todos: commandDefinition('state', 'todo_snapshot'),
  set_host_tools: commandDefinition('state', 'host_tool_names'),
  set_host_uri_schemes: commandDefinition('state', 'host_uri_schemes'),
  set_subagent_subscription: commandDefinition('state', 'subagent_subscription'),
  get_subagents: commandDefinition('state', 'subagents', { sideEffect: false }),
  get_subagent_messages: commandDefinition('state', 'subagent_messages', { sideEffect: false }),

  set_model: commandDefinition('model', 'model'),
  cycle_model: commandDefinition('model', 'model_cycle'),
  get_available_models: commandDefinition('model', 'available_models', { sideEffect: false }),

  set_thinking_level: commandDefinition('thinking', ACK_RESPONSE),
  cycle_thinking_level: commandDefinition('thinking', 'thinking_level'),

  set_steering_mode: commandDefinition('queue', ACK_RESPONSE),
  set_follow_up_mode: commandDefinition('queue', ACK_RESPONSE),
  set_interrupt_mode: commandDefinition('queue', ACK_RESPONSE),

  compact: commandDefinition('compaction', 'compaction_result', { longRunning: true }),
  set_auto_compaction: commandDefinition('compaction', ACK_RESPONSE),

  set_auto_retry: commandDefinition('retry', ACK_RESPONSE),
  abort_retry: commandDefinition('retry', ACK_RESPONSE),

  bash: commandDefinition('bash', 'bash_result', { longRunning: true }),
  abort_bash: commandDefinition('bash', ACK_RESPONSE),

  get_session_stats: commandDefinition('session', 'session_stats', {
    longRunning: true,
    sideEffect: false,
  }),
  export_html: commandDefinition('session', 'export_html', { longRunning: true }),
  switch_session: commandDefinition('session', 'cancellation_result', { longRunning: true }),
  branch: commandDefinition('session', 'branch_result', { longRunning: true }),
  get_branch_messages: commandDefinition('session', 'branch_messages', { sideEffect: false }),
  get_last_assistant_text: commandDefinition('session', 'last_assistant_text', { sideEffect: false }),
  set_session_name: commandDefinition('session', ACK_RESPONSE),
  handoff: commandDefinition('session', 'handoff_result', { longRunning: true }),

  get_messages: commandDefinition('messages', 'messages', { sideEffect: false }),

  get_login_providers: commandDefinition('login', 'login_providers', { sideEffect: false }),
  login: commandDefinition('login', 'login_result', { longRunning: true }),
  logout: commandDefinition('auth', 'logout_result'),

  // P0
  get_capabilities: commandDefinition('state', 'capability_manifest', { sideEffect: false }),

  // P1: MCP / Smithery
  get_mcp_state: commandDefinition('mcp', 'mcp_state', { sideEffect: false }),
  mcp_reauth: commandDefinition('mcp', 'mcp_oauth_start', { longRunning: true }),
  mcp_unauth: commandDefinition('mcp', 'mcp_state'),
  mcp_reconnect: commandDefinition('mcp', 'mcp_state', { longRunning: true }),
  get_mcp_notifications: commandDefinition('mcp', 'mcp_notifications', { sideEffect: false }),
  set_mcp_notifications: commandDefinition('mcp', 'mcp_notifications'),
  smithery_login: commandDefinition('auth', 'smithery_state', { longRunning: true }),
  smithery_logout: commandDefinition('auth', 'smithery_state'),

  // P1: Collab
  get_collab_state: commandDefinition('collab', 'collab_state', { sideEffect: false }),
  start_collab: commandDefinition('collab', 'collab_state', { longRunning: true }),
  join_collab: commandDefinition('collab', 'collab_state', { longRunning: true }),
  leave_collab: commandDefinition('collab', 'collab_state'),
  stop_collab: commandDefinition('collab', 'collab_state'),
  set_collab_presence: commandDefinition('collab', 'collab_state'),

  // P2: Session tree / extensions / marketplace / agents
  get_session_tree: commandDefinition('tree', 'session_tree', { sideEffect: false }),
  fork_session: commandDefinition('tree', 'session_tree', { longRunning: true }),
  get_extensions: commandDefinition('extensions', 'extensions', { sideEffect: false }),
  set_extension_enabled: commandDefinition('extensions', 'extension_state'),
  reload_extensions: commandDefinition('extensions', 'extensions', { longRunning: true }),
  uninstall_extension: commandDefinition('extensions', 'extension_state'),
  search_marketplace: commandDefinition('marketplace', 'marketplace_search', { sideEffect: false }),
  get_marketplace_item: commandDefinition('marketplace', 'marketplace_item', { sideEffect: false }),
  install_marketplace_item: commandDefinition('marketplace', 'marketplace_task', { longRunning: true }),
  update_marketplace_item: commandDefinition('marketplace', 'marketplace_task', { longRunning: true }),
  uninstall_marketplace_item: commandDefinition('marketplace', 'marketplace_task'),
  get_agent_definitions: commandDefinition('agents', 'agent_definitions', { sideEffect: false }),
  set_agent_enabled: commandDefinition('agents', 'agent_state'),
  set_agent_model_override: commandDefinition('agents', 'agent_state'),
  create_agent: commandDefinition('agents', 'agent_state'),
  update_agent: commandDefinition('agents', 'agent_state'),
  reload_agents: commandDefinition('agents', 'agent_definitions', { longRunning: true }),

  // P3: BTW / TAN / OMFG / Debug / STT
  ask_side_question: commandDefinition('state', 'side_question_result'),
  start_tangential_agent: commandDefinition('state', 'tangential_agent', { longRunning: true }),
  get_tangential_agents: commandDefinition('state', 'tangential_agents', { sideEffect: false }),
  cancel_tangential_agent: commandDefinition('state', 'tangential_agent'),
  propose_ttsr_rule: commandDefinition('state', 'ttsr_rule_preview'),
  confirm_ttsr_rule: commandDefinition('state', 'ttsr_rule'),
  list_ttsr_rules: commandDefinition('state', 'ttsr_rules', { sideEffect: false }),
  delete_ttsr_rule: commandDefinition('state', 'ttsr_rules'),
  get_debug_tools: commandDefinition('debug', 'debug_tools', { sideEffect: false }),
  run_debug_tool: commandDefinition('debug', 'debug_result', { longRunning: true }),
  transcribe_audio: commandDefinition('audio', 'transcription', { longRunning: true }),

  // P4: Retry / queue / temporary model / settings
  retry_last_turn: commandDefinition('retry', 'retry_state', { longRunning: true }),
  get_retry_state: commandDefinition('retry', 'retry_state', { sideEffect: false }),
  get_queue_state: commandDefinition('queue', 'queue_state', { sideEffect: false }),
  dequeue_message: commandDefinition('queue', 'queue_state'),
  reorder_queue: commandDefinition('queue', 'queue_state'),
  set_temporary_model: commandDefinition('model', 'model_state'),
  clear_temporary_model: commandDefinition('model', 'model_state'),
  get_settings_schema: commandDefinition('settings', 'settings_schema', { sideEffect: false }),
  get_settings: commandDefinition('settings', 'settings', { sideEffect: false }),
  set_settings: commandDefinition('settings', 'settings_set_result'),
  open_external_editor: commandDefinition('settings', 'external_editor_result'),
} satisfies Record<OmpRpcCommandType, OmpRpcCommandDefinition>;

export function getOmpRpcCommandDefinition(command: string): OmpRpcCommandDefinition | undefined {
  return OMP_RPC_COMMAND_DEFINITIONS[command as OmpRpcCommandType];
}

export function getOmpRpcCommandTimeout(
  command: string,
  fallbackMs = DEFAULT_OMP_RPC_REQUEST_TIMEOUT_MS,
  longRunningFallbackMs = DEFAULT_OMP_RPC_LONG_REQUEST_TIMEOUT_MS,
): number {
  const definition = getOmpRpcCommandDefinition(command);
  if (!definition) return fallbackMs;
  if (definition.longRunning) return longRunningFallbackMs;
  return definition.timeoutMs;
}

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
  raw?: Record<string, unknown>;
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
  model?: string;
  thinkingLevel?: unknown;
  isStreaming: boolean;
  isCompacting: boolean;
  steeringMode: OmpQueueMode;
  followUpMode: OmpQueueMode;
  interruptMode: OmpInterruptMode;
  autoCompactionEnabled: boolean;
  autoRetryEnabled?: boolean;
  messageCount: number;
  queuedMessageCount: number;
  todoPhases: OmpTodoPhase[];
  contextUsage?: OmpContextUsage;
  capabilities?: OmpRpcCapabilities;
  [key: string]: unknown;
}

export function craftThinkingLevelToOmp(level: ThinkingLevel): OmpThinkingLevel {
  return level === 'max' ? 'xhigh' : level;
}

export function ompThinkingLevelToCraft(level: unknown): ThinkingLevel | undefined {
  if (
    level === 'off'
    || level === 'minimal'
    || level === 'low'
    || level === 'medium'
    || level === 'high'
    || level === 'xhigh'
  ) {
    return level;
  }
  return undefined;
}

function normalizeOmpModelId(value: unknown): string | undefined {
  if (isString(value)) return value;

  const raw = asObject(value);
  if (!raw || !isString(raw.id) || raw.id.trim().length === 0) return undefined;
  if (isString(raw.provider) && raw.provider.trim().length > 0) {
    return `${raw.provider}/${raw.id}`;
  }
  return raw.id;
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

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isQueueMode(value: unknown): value is OmpQueueMode {
  return value === 'all' || value === 'one-at-a-time';
}

function isInterruptMode(value: unknown): value is OmpInterruptMode {
  return value === 'immediate' || value === 'wait';
}

function isCompactionReason(value: unknown): value is OmpCompactionReason {
  return value === 'threshold' || value === 'overflow' || value === 'idle' || value === 'incomplete';
}

function isCompactionAction(value: unknown): value is OmpCompactionAction {
  return value === 'context-full' || value === 'handoff' || value === 'shake' || value === 'snapcompact';
}

function isAvailableSlashCommandSource(value: unknown): value is OmpRpcAvailableSlashCommandSource {
  return value === 'builtin'
    || value === 'skill'
    || value === 'extension'
    || value === 'custom'
    || value === 'mcp_prompt'
    || value === 'file';
}

function isTodoStatus(value: unknown): value is OmpTodoStatus {
  return value === 'pending'
    || value === 'in_progress'
    || value === 'completed'
    || value === 'abandoned';
}

function isSubagentSource(value: unknown): value is OmpSubagentSource {
  return value === 'bundled' || value === 'user' || value === 'project';
}

function isSubagentStatus(value: unknown): value is OmpSubagentStatus {
  return value === 'pending'
    || value === 'running'
    || value === 'completed'
    || value === 'failed'
    || value === 'aborted';
}

function isSubagentLifecycleStatus(value: unknown): value is OmpSubagentLifecycleStatus {
  return value === 'started'
    || value === 'completed'
    || value === 'failed'
    || value === 'aborted';
}

function isCommandName(value: unknown): value is string {
  return isString(value) && value.trim().length > 0 && !/\s/.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

function optionalString(value: unknown): string | undefined {
  return isString(value) ? value : undefined;
}

function parseRecordPayload(value: unknown): Record<string, unknown> | null {
  if (value === undefined) return {};
  const object = asObject(value);
  if (object) return object;
  if (!isString(value)) return null;
  try {
    return asObject(JSON.parse(value)) ?? null;
  } catch {
    return null;
  }
}

function parseAliases(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const aliases = value.filter(isCommandName);
  return aliases.length > 0 ? aliases : undefined;
}

function parseInputHint(value: unknown): { hint?: string } | undefined {
  const input = asObject(value);
  if (!input) return undefined;
  const hint = optionalString(input.hint);
  return hint !== undefined ? { hint } : {};
}

function parseSubcommands(value: unknown): OmpRpcAvailableSlashSubcommand[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const subcommands = value
    .map((item): OmpRpcAvailableSlashSubcommand | null => {
      const raw = asObject(item);
      if (!raw || !isCommandName(raw.name)) return null;
      return {
        name: raw.name,
        description: optionalString(raw.description),
        usage: optionalString(raw.usage),
      };
    })
    .filter((item): item is OmpRpcAvailableSlashSubcommand => item !== null);
  return subcommands.length > 0 ? subcommands : undefined;
}

function parseTodoNotes(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (isString(value)) return [value];
  if (!Array.isArray(value)) return undefined;
  const notes = value.filter(isString);
  return notes.length === value.length ? notes : undefined;
}

export function parseOmpTodoItem(value: unknown): OmpTodoItem | null {
  const raw = asObject(value);
  const notes = parseTodoNotes(raw?.notes);
  if (
    !raw
    || !isString(raw.content)
    || !isTodoStatus(raw.status)
    || (raw.details !== undefined && !isString(raw.details))
    || (raw.notes !== undefined && notes === undefined)
  ) {
    return null;
  }
  return {
    content: raw.content,
    status: raw.status,
    details: raw.details as string | undefined,
    notes,
  };
}

export function parseOmpTodoPhase(value: unknown): OmpTodoPhase | null {
  const raw = asObject(value);
  if (!raw || !isString(raw.name) || !Array.isArray(raw.tasks)) return null;
  const tasks = raw.tasks.map(parseOmpTodoItem);
  if (tasks.some(task => task === null)) return null;
  return {
    name: raw.name,
    tasks: tasks as OmpTodoItem[],
  };
}

export function parseOmpTodoPhases(value: unknown): OmpTodoPhase[] | null {
  if (!Array.isArray(value)) return null;
  const phases = value.map(parseOmpTodoPhase);
  if (phases.some(phase => phase === null)) return null;
  return phases as OmpTodoPhase[];
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter(isString);
  return strings.length === value.length ? strings : undefined;
}

function parseModelOverride(value: unknown): string | string[] | undefined {
  if (isString(value)) return value;
  return parseStringArray(value);
}

function parseSubagentRecentTools(value: unknown): OmpSubagentRecentTool[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const tools = value.map((item): OmpSubagentRecentTool | null => {
    const raw = asObject(item);
    if (
      !raw
      || !isString(raw.tool)
      || !isString(raw.args)
      || !isFiniteNumber(raw.endMs)
    ) {
      return null;
    }
    return {
      tool: raw.tool,
      args: raw.args,
      endMs: raw.endMs,
    };
  });
  return tools.some(item => item === null) ? undefined : tools as OmpSubagentRecentTool[];
}

function parseSubagentRetryState(value: unknown): OmpSubagentRetryState | undefined {
  if (value === undefined) return undefined;
  const raw = asObject(value);
  if (
    !raw
    || !isNonNegativeNumber(raw.attempt)
    || !isNonNegativeNumber(raw.maxAttempts)
    || !isNonNegativeNumber(raw.delayMs)
    || !isString(raw.errorMessage)
    || !isNonNegativeNumber(raw.startedAtMs)
  ) {
    return undefined;
  }
  return {
    attempt: raw.attempt,
    maxAttempts: raw.maxAttempts,
    delayMs: raw.delayMs,
    errorMessage: raw.errorMessage,
    startedAtMs: raw.startedAtMs,
  };
}

function parseSubagentRetryFailure(value: unknown): OmpSubagentRetryFailure | undefined {
  if (value === undefined) return undefined;
  const raw = asObject(value);
  if (!raw || !isNonNegativeNumber(raw.attempt) || !isString(raw.errorMessage)) return undefined;
  return {
    attempt: raw.attempt,
    errorMessage: raw.errorMessage,
  };
}

export function parseOmpSubagentProgress(value: unknown): OmpSubagentProgress | null {
  const raw = asObject(value);
  if (!raw || !isString(raw.id) || !isSubagentStatus(raw.status)) return null;

  const recentTools = parseSubagentRecentTools(raw.recentTools);
  const recentOutput = parseStringArray(raw.recentOutput);
  const modelOverride = parseModelOverride(raw.modelOverride);
  const retryState = parseSubagentRetryState(raw.retryState);
  const retryFailure = parseSubagentRetryFailure(raw.retryFailure);

  if (
    (raw.index !== undefined && !isFiniteNumber(raw.index))
    || (raw.agent !== undefined && !isString(raw.agent))
    || (raw.agentSource !== undefined && !isSubagentSource(raw.agentSource))
    || (raw.task !== undefined && !isString(raw.task))
    || (raw.assignment !== undefined && !isString(raw.assignment))
    || (raw.description !== undefined && !isString(raw.description))
    || (raw.lastIntent !== undefined && !isString(raw.lastIntent))
    || (raw.currentTool !== undefined && !isString(raw.currentTool))
    || (raw.currentToolArgs !== undefined && !isString(raw.currentToolArgs))
    || (raw.currentToolStartMs !== undefined && !isFiniteNumber(raw.currentToolStartMs))
    || (raw.recentTools !== undefined && !recentTools)
    || (raw.recentOutput !== undefined && !recentOutput)
    || (raw.toolCount !== undefined && !isNonNegativeNumber(raw.toolCount))
    || (raw.requests !== undefined && !isNonNegativeNumber(raw.requests))
    || (raw.tokens !== undefined && !isNonNegativeNumber(raw.tokens))
    || (raw.contextTokens !== undefined && !isNonNegativeNumber(raw.contextTokens))
    || (raw.contextWindow !== undefined && !isNonNegativeNumber(raw.contextWindow))
    || (raw.cost !== undefined && !isNonNegativeNumber(raw.cost))
    || (raw.durationMs !== undefined && !isNonNegativeNumber(raw.durationMs))
    || (raw.modelOverride !== undefined && !modelOverride)
    || (raw.resolvedModel !== undefined && !isString(raw.resolvedModel))
    || (raw.retryState !== undefined && !retryState)
    || (raw.retryFailure !== undefined && !retryFailure)
  ) {
    return null;
  }

  return {
    id: raw.id,
    index: raw.index as number | undefined,
    agent: raw.agent as string | undefined,
    agentSource: raw.agentSource as OmpSubagentSource | undefined,
    status: raw.status,
    task: raw.task as string | undefined,
    assignment: raw.assignment as string | undefined,
    description: raw.description as string | undefined,
    lastIntent: raw.lastIntent as string | undefined,
    currentTool: raw.currentTool as string | undefined,
    currentToolArgs: raw.currentToolArgs as string | undefined,
    currentToolStartMs: raw.currentToolStartMs as number | undefined,
    recentTools,
    recentOutput,
    toolCount: raw.toolCount as number | undefined,
    requests: raw.requests as number | undefined,
    tokens: raw.tokens as number | undefined,
    contextTokens: raw.contextTokens as number | undefined,
    contextWindow: raw.contextWindow as number | undefined,
    cost: raw.cost as number | undefined,
    durationMs: raw.durationMs as number | undefined,
    modelOverride,
    resolvedModel: raw.resolvedModel as string | undefined,
    retryState,
    retryFailure,
  };
}

export function parseOmpSubagentSnapshot(value: unknown): OmpSubagentSnapshot | null {
  const raw = asObject(value);
  const progress = raw?.progress === undefined ? undefined : parseOmpSubagentProgress(raw.progress);
  const todoPhases = raw?.todoPhases === undefined ? undefined : parseOmpTodoPhases(raw.todoPhases);
  if (
    !raw
    || !isString(raw.id)
    || !isFiniteNumber(raw.index)
    || !isString(raw.agent)
    || !isSubagentSource(raw.agentSource)
    || !isSubagentStatus(raw.status)
    || !isFiniteNumber(raw.lastUpdate)
    || (raw.description !== undefined && !isString(raw.description))
    || (raw.task !== undefined && !isString(raw.task))
    || (raw.assignment !== undefined && !isString(raw.assignment))
    || (raw.sessionFile !== undefined && !isString(raw.sessionFile))
    || (raw.parentToolCallId !== undefined && !isString(raw.parentToolCallId))
    || (raw.progress !== undefined && !progress)
    || (raw.todoPhases !== undefined && !todoPhases)
  ) {
    return null;
  }

  return {
    id: raw.id,
    index: raw.index,
    agent: raw.agent,
    agentSource: raw.agentSource,
    description: raw.description as string | undefined,
    status: raw.status,
    task: raw.task as string | undefined,
    assignment: raw.assignment as string | undefined,
    sessionFile: raw.sessionFile as string | undefined,
    lastUpdate: raw.lastUpdate,
    progress: progress ?? undefined,
    parentToolCallId: raw.parentToolCallId as string | undefined,
    todoPhases: todoPhases ?? undefined,
  };
}

export function parseOmpSubagentsResponseData(value: unknown): OmpRpcSubagentsResponseData | null {
  const raw = asObject(value);
  if (!raw || !Array.isArray(raw.subagents)) return null;
  const subagents = raw.subagents.map(parseOmpSubagentSnapshot);
  if (subagents.some(subagent => subagent === null)) return null;
  return { subagents: subagents as OmpSubagentSnapshot[] };
}

export function parseOmpSubagentMessagesResponseData(value: unknown): OmpRpcSubagentMessagesResponseData | null {
  const raw = asObject(value);
  if (
    !raw
    || !isString(raw.sessionFile)
    || !isNonNegativeNumber(raw.fromByte)
    || !isNonNegativeNumber(raw.nextByte)
    || typeof raw.reset !== 'boolean'
    || !Array.isArray(raw.entries)
    || !Array.isArray(raw.messages)
  ) {
    return null;
  }
  return {
    sessionFile: raw.sessionFile,
    fromByte: raw.fromByte,
    nextByte: raw.nextByte,
    reset: raw.reset,
    entries: raw.entries,
    messages: raw.messages,
  };
}

export function extractOmpTodoPhasesFromTranscriptEntries(entries: unknown[]): OmpTodoPhase[] | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = asObject(entries[index]);
    if (!entry) continue;

    if (entry.type === 'custom' && entry.customType === 'user_todo_edit') {
      const data = asObject(entry.data);
      const phases = parseOmpTodoPhases(data?.phases);
      if (phases) return phases;
      continue;
    }

    if (entry.type !== 'message') continue;
    const message = asObject(entry.message);
    if (
      !message
      || message.role !== 'toolResult'
      || message.toolName !== 'todo'
      || message.isError === true
    ) {
      continue;
    }

    const details = asObject(message.details);
    const phases = parseOmpTodoPhases(details?.phases);
    if (phases) return phases;
  }

  return null;
}

export function parseOmpSubagentFrame(value: unknown): OmpSubagentFrame | null {
  const raw = asObject(value);
  if (!raw || !isString(raw.type)) return null;

  if (raw.type === 'subagent_lifecycle') {
    const payload = asObject(raw.payload);
    if (
      !payload
      || !isString(payload.id)
      || !isString(payload.agent)
      || !isSubagentSource(payload.agentSource)
      || !isSubagentLifecycleStatus(payload.status)
      || !isFiniteNumber(payload.index)
      || (payload.description !== undefined && !isString(payload.description))
      || (payload.sessionFile !== undefined && !isString(payload.sessionFile))
      || (payload.parentToolCallId !== undefined && !isString(payload.parentToolCallId))
      || (payload.detached !== undefined && typeof payload.detached !== 'boolean')
    ) {
      return null;
    }
    return {
      type: 'subagent_lifecycle',
      payload: {
        id: payload.id,
        agent: payload.agent,
        agentSource: payload.agentSource,
        description: payload.description as string | undefined,
        status: payload.status,
        sessionFile: payload.sessionFile as string | undefined,
        parentToolCallId: payload.parentToolCallId as string | undefined,
        index: payload.index,
        detached: payload.detached as boolean | undefined,
      },
    };
  }

  if (raw.type === 'subagent_progress') {
    const payload = asObject(raw.payload);
    const progress = parseOmpSubagentProgress(payload?.progress);
    if (
      !payload
      || !isFiniteNumber(payload.index)
      || !isString(payload.agent)
      || !isSubagentSource(payload.agentSource)
      || !isString(payload.task)
      || !progress
      || (payload.parentToolCallId !== undefined && !isString(payload.parentToolCallId))
      || (payload.assignment !== undefined && !isString(payload.assignment))
      || (payload.sessionFile !== undefined && !isString(payload.sessionFile))
      || (payload.detached !== undefined && typeof payload.detached !== 'boolean')
    ) {
      return null;
    }
    return {
      type: 'subagent_progress',
      payload: {
        index: payload.index,
        agent: payload.agent,
        agentSource: payload.agentSource,
        task: payload.task,
        parentToolCallId: payload.parentToolCallId as string | undefined,
        assignment: payload.assignment as string | undefined,
        progress,
        sessionFile: payload.sessionFile as string | undefined,
        detached: payload.detached as boolean | undefined,
      },
    };
  }

  if (raw.type === 'subagent_event') {
    const payload = asObject(raw.payload);
    const event = asObject(payload?.event);
    if (!payload || !isString(payload.id) || !event) return null;
    return {
      type: 'subagent_event',
      payload: {
        id: payload.id,
        event: { ...event },
      },
    };
  }

  return null;
}

export function parseOmpAvailableSlashCommand(value: unknown): OmpRpcAvailableSlashCommand | null {
  const raw = asObject(value);
  if (!raw || !isCommandName(raw.name) || !isAvailableSlashCommandSource(raw.source)) return null;

  return {
    name: raw.name,
    aliases: parseAliases(raw.aliases),
    description: optionalString(raw.description),
    input: parseInputHint(raw.input),
    subcommands: parseSubcommands(raw.subcommands),
    source: raw.source,
  };
}

export function parseOmpAvailableCommandsResponseData(value: unknown): OmpRpcAvailableCommandsResponseData | null {
  const raw = asObject(value);
  if (!raw || !Array.isArray(raw.commands)) return null;
  return {
    commands: raw.commands
      .map(parseOmpAvailableSlashCommand)
      .filter((command): command is OmpRpcAvailableSlashCommand => command !== null),
  };
}

export function parseOmpSetHostToolsResponseData(value: unknown): OmpRpcSetHostToolsResponseData | null {
  const raw = asObject(value);
  const toolNames = parseStringArray(raw?.toolNames);
  if (!raw || !toolNames) return null;
  return { toolNames };
}

export function parseOmpSetHostUriSchemesResponseData(value: unknown): OmpRpcSetHostUriSchemesResponseData | null {
  const raw = asObject(value);
  const schemes = parseStringArray(raw?.schemes);
  if (!raw || !schemes) return null;
  return { schemes };
}

export function parseOmpHostToolCall(value: unknown): OmpRpcHostToolCallFrame | null {
  const raw = asObject(value);
  const args = parseRecordPayload(raw?.arguments);
  if (
    raw?.type !== 'host_tool_call'
    || !isNonEmptyString(raw.id)
    || !isNonEmptyString(raw.toolCallId)
    || !isNonEmptyString(raw.toolName)
    || !args
  ) {
    return null;
  }
  return {
    type: 'host_tool_call',
    id: raw.id,
    toolCallId: raw.toolCallId,
    toolName: raw.toolName,
    arguments: args,
  };
}

export function parseOmpHostToolCancel(value: unknown): OmpRpcHostToolCancelFrame | null {
  const raw = asObject(value);
  if (
    raw?.type !== 'host_tool_cancel'
    || !isNonEmptyString(raw.id)
    || !isNonEmptyString(raw.targetId)
  ) {
    return null;
  }
  return {
    type: 'host_tool_cancel',
    id: raw.id,
    targetId: raw.targetId,
  };
}

function isHostUriOperation(value: unknown): value is OmpRpcHostUriOperation {
  return value === 'read' || value === 'write';
}

export function parseOmpHostUriRequest(value: unknown): OmpRpcHostUriRequestFrame | null {
  const raw = asObject(value);
  if (
    raw?.type !== 'host_uri_request'
    || !isNonEmptyString(raw.id)
    || !isHostUriOperation(raw.operation)
    || !isNonEmptyString(raw.url)
    || (raw.content !== undefined && !isString(raw.content))
  ) {
    return null;
  }
  return {
    type: 'host_uri_request',
    id: raw.id,
    operation: raw.operation,
    url: raw.url,
    content: raw.content as string | undefined,
  };
}

export function parseOmpHostUriCancel(value: unknown): OmpRpcHostUriCancelFrame | null {
  const raw = asObject(value);
  if (
    raw?.type !== 'host_uri_cancel'
    || !isNonEmptyString(raw.id)
    || !isNonEmptyString(raw.targetId)
  ) {
    return null;
  }
  return {
    type: 'host_uri_cancel',
    id: raw.id,
    targetId: raw.targetId,
  };
}

export function parseOmpCancellationResult(value: unknown): OmpRpcCancellationResult | null {
  const raw = asObject(value);
  if (!raw || typeof raw.cancelled !== 'boolean') return null;
  return { cancelled: raw.cancelled };
}

export function parseOmpBranchMessagesResponseData(value: unknown): OmpRpcBranchMessagesResponseData | null {
  const raw = asObject(value);
  if (!raw || !Array.isArray(raw.messages)) return null;
  const messages = raw.messages
    .map((item): OmpRpcBranchMessage | null => {
      const message = asObject(item);
      if (!message || !isString(message.entryId) || !isString(message.text)) return null;
      return {
        entryId: message.entryId,
        text: message.text,
      };
    })
    .filter((message): message is OmpRpcBranchMessage => message !== null);
  if (messages.length !== raw.messages.length) return null;
  return { messages };
}

export function parseOmpBranchResult(value: unknown): OmpRpcBranchResult | null {
  const raw = asObject(value);
  if (!raw || typeof raw.cancelled !== 'boolean' || !isString(raw.text)) return null;
  return {
    text: raw.text,
    cancelled: raw.cancelled,
  };
}

export function parseOmpExportHtmlResponseData(value: unknown): OmpRpcExportHtmlResponseData | null {
  const raw = asObject(value);
  if (!raw || !isString(raw.path) || raw.path.trim().length === 0) return null;
  return { path: raw.path };
}

export function parseOmpHandoffResult(value: unknown): OmpRpcHandoffResult | null {
  if (value === null || value === undefined) return null;
  const raw = asObject(value);
  if (!raw || (raw.savedPath !== undefined && !isString(raw.savedPath))) return null;
  return {
    savedPath: raw.savedPath as string | undefined,
  };
}

export function parseOmpLastAssistantTextResponseData(value: unknown): OmpRpcLastAssistantTextResponseData | null {
  const raw = asObject(value);
  if (!raw || (raw.text !== null && !isString(raw.text))) return null;
  return {
    text: raw.text,
  };
}

export function parseOmpMessagesResponseData(value: unknown): OmpRpcMessagesResponseData | null {
  const raw = asObject(value);
  if (!raw || !Array.isArray(raw.messages)) return null;
  return { messages: raw.messages };
}

export function parseOmpSetTodosResponseData(value: unknown): OmpRpcSetTodosResponseData | null {
  const raw = asObject(value);
  const todoPhases = parseOmpTodoPhases(raw?.todoPhases);
  if (!raw || !todoPhases) return null;
  return { todoPhases };
}

export function parseOmpTodoEvent(value: unknown): OmpTodoEvent | null {
  const raw = asObject(value);
  if (!raw || !isString(raw.type)) return null;

  if (raw.type === 'todo_auto_clear') {
    return { type: 'todo_auto_clear' };
  }

  if (raw.type !== 'todo_reminder') return null;
  if (
    !Array.isArray(raw.todos)
    || !isNonNegativeNumber(raw.attempt)
    || !isNonNegativeNumber(raw.maxAttempts)
  ) {
    return null;
  }
  const todos = raw.todos.map(parseOmpTodoItem);
  if (todos.some(todo => todo === null)) return null;
  return {
    type: 'todo_reminder',
    todos: todos as OmpTodoItem[],
    attempt: raw.attempt,
    maxAttempts: raw.maxAttempts,
  };
}

export function parseOmpContextUsage(value: unknown): OmpContextUsage | null {
  const raw = asObject(value);
  if (
    !raw
    || !isNonNegativeNumber(raw.tokens)
    || !isNonNegativeNumber(raw.contextWindow)
    || !isNonNegativeNumber(raw.percent)
  ) {
    return null;
  }
  return {
    tokens: raw.tokens,
    contextWindow: raw.contextWindow,
    percent: raw.percent,
  };
}

export function parseOmpSessionStats(value: unknown): OmpSessionStats | null {
  const raw = asObject(value);
  const tokens = asObject(raw?.tokens);
  if (
    !raw
    || !tokens
    || !isString(raw.sessionId)
    || raw.sessionId.trim().length === 0
    || (raw.sessionFile !== undefined && !isString(raw.sessionFile))
    || !isNonNegativeNumber(raw.userMessages)
    || !isNonNegativeNumber(raw.assistantMessages)
    || !isNonNegativeNumber(raw.toolCalls)
    || !isNonNegativeNumber(raw.toolResults)
    || !isNonNegativeNumber(raw.totalMessages)
    || !isNonNegativeNumber(tokens.input)
    || !isNonNegativeNumber(tokens.output)
    || !isNonNegativeNumber(tokens.reasoning)
    || !isNonNegativeNumber(tokens.cacheRead)
    || !isNonNegativeNumber(tokens.cacheWrite)
    || !isNonNegativeNumber(tokens.total)
    || !isNonNegativeNumber(raw.premiumRequests)
    || !isNonNegativeNumber(raw.cost)
  ) {
    return null;
  }
  return {
    sessionFile: raw.sessionFile as string | undefined,
    sessionId: raw.sessionId,
    userMessages: raw.userMessages,
    assistantMessages: raw.assistantMessages,
    toolCalls: raw.toolCalls,
    toolResults: raw.toolResults,
    totalMessages: raw.totalMessages,
    tokens: {
      input: tokens.input,
      output: tokens.output,
      reasoning: tokens.reasoning,
      cacheRead: tokens.cacheRead,
      cacheWrite: tokens.cacheWrite,
      total: tokens.total,
    },
    premiumRequests: raw.premiumRequests,
    cost: raw.cost,
  };
}

export function parseOmpCompactionResult(value: unknown): OmpCompactionResult | null {
  const raw = asObject(value);
  if (
    !raw
    || !isString(raw.summary)
    || !isString(raw.firstKeptEntryId)
    || !isNonNegativeNumber(raw.tokensBefore)
    || (raw.shortSummary !== undefined && !isString(raw.shortSummary))
    || (raw.preserveData !== undefined && !asObject(raw.preserveData))
  ) {
    return null;
  }
  return {
    summary: raw.summary,
    shortSummary: raw.shortSummary as string | undefined,
    firstKeptEntryId: raw.firstKeptEntryId,
    tokensBefore: raw.tokensBefore,
    details: raw.details,
    preserveData: raw.preserveData as Record<string, unknown> | undefined,
  };
}

export function parseOmpRuntimeEvent(value: unknown): OmpRuntimeEvent | null {
  const raw = asObject(value);
  if (!raw || !isString(raw.type)) return null;

  switch (raw.type) {
    case 'auto_compaction_start':
      return isCompactionReason(raw.reason) && isCompactionAction(raw.action)
        ? { type: raw.type, reason: raw.reason, action: raw.action }
        : null;

    case 'auto_compaction_end': {
      if (
        !isCompactionAction(raw.action)
        || typeof raw.aborted !== 'boolean'
        || typeof raw.willRetry !== 'boolean'
        || (raw.errorMessage !== undefined && !isString(raw.errorMessage))
        || (raw.skipped !== undefined && typeof raw.skipped !== 'boolean')
      ) {
        return null;
      }
      const result = raw.result === undefined ? undefined : parseOmpCompactionResult(raw.result);
      if (raw.result !== undefined && !result) return null;
      return {
        type: raw.type,
        action: raw.action,
        result: result ?? undefined,
        aborted: raw.aborted,
        willRetry: raw.willRetry,
        errorMessage: raw.errorMessage as string | undefined,
        skipped: raw.skipped as boolean | undefined,
      };
    }

    case 'auto_retry_start':
      return isNonNegativeNumber(raw.attempt)
        && isNonNegativeNumber(raw.maxAttempts)
        && isNonNegativeNumber(raw.delayMs)
        && isString(raw.errorMessage)
        && (raw.errorId === undefined || isFiniteNumber(raw.errorId))
        ? {
            type: raw.type,
            attempt: raw.attempt,
            maxAttempts: raw.maxAttempts,
            delayMs: raw.delayMs,
            errorMessage: raw.errorMessage,
            errorId: raw.errorId as number | undefined,
          }
        : null;

    case 'auto_retry_end':
      return typeof raw.success === 'boolean'
        && isNonNegativeNumber(raw.attempt)
        && (raw.finalError === undefined || isString(raw.finalError))
        ? {
            type: raw.type,
            success: raw.success,
            attempt: raw.attempt,
            finalError: raw.finalError as string | undefined,
          }
        : null;

    case 'retry_fallback_applied':
      return isString(raw.from) && isString(raw.to) && isString(raw.role)
        ? { type: raw.type, from: raw.from, to: raw.to, role: raw.role }
        : null;

    case 'retry_fallback_succeeded':
      return isString(raw.model) && isString(raw.role)
        ? { type: raw.type, model: raw.model, role: raw.role }
        : null;

    default:
      return null;
  }
}

export function parseOmpAvailableCommandsUpdate(value: unknown): OmpRpcAvailableCommandsUpdateFrame | null {
  const raw = asObject(value);
  if (raw?.type !== 'available_commands_update') return null;
  const parsed = parseOmpAvailableCommandsResponseData(raw);
  if (!parsed) return null;
  return {
    type: 'available_commands_update',
    commands: parsed.commands,
  };
}

export function parseOmpSessionInfoUpdate(value: unknown): OmpRpcSessionInfoUpdateFrame | null {
  const raw = asObject(value);
  if (
    raw?.type !== 'session_info_update'
    || (raw.sessionId !== undefined && !isString(raw.sessionId))
    || (raw.session_id !== undefined && !isString(raw.session_id))
    || (raw.title !== undefined && !isString(raw.title))
  ) {
    return null;
  }

  const sessionId = raw.sessionId ?? raw.session_id;
  if (sessionId === undefined && raw.title === undefined) return null;

  return {
    type: 'session_info_update',
    sessionId: sessionId as string | undefined,
    title: raw.title as string | undefined,
  };
}

export function parseOmpQueueControlState(value: unknown): Partial<OmpQueueControlState> | null {
  const raw = asObject(value);
  if (!raw) return null;

  const state: Partial<OmpQueueControlState> = {};
  if (typeof raw.isStreaming === 'boolean') state.isStreaming = raw.isStreaming;
  if (typeof raw.isCompacting === 'boolean') state.isCompacting = raw.isCompacting;
  if (isQueueMode(raw.steeringMode)) state.steeringMode = raw.steeringMode;
  if (isQueueMode(raw.followUpMode)) state.followUpMode = raw.followUpMode;
  if (isInterruptMode(raw.interruptMode)) state.interruptMode = raw.interruptMode;
  if (isFiniteNumber(raw.queuedMessageCount)) state.queuedMessageCount = raw.queuedMessageCount;

  return Object.keys(state).length > 0 ? state : null;
}

export function parseOmpReadyFrame(value: unknown): OmpRpcReadyFrame | null {
  const raw = asObject(value);
  if (raw?.type !== 'ready') return null;
  return {
    type: 'ready',
    protocolVersion: optionalString(raw.protocolVersion) ?? optionalString(raw.protocol_version),
    ompVersion: optionalString(raw.ompVersion) ?? optionalString(raw.omp_version),
    sessionId: optionalString(raw.sessionId) ?? optionalString(raw.session_id),
  };
}

export function parseOmpMessageStartFrame(value: unknown): OmpRpcMessageStartFrame | null {
  const raw = asObject(value);
  if (raw?.type !== 'message_start') return null;
  return {
    type: 'message_start',
    messageId: optionalString(raw.messageId) ?? optionalString(raw.message_id),
    role: optionalString(raw.role),
    parentMessageId: optionalString(raw.parentMessageId) ?? optionalString(raw.parent_message_id),
    turnId: optionalString(raw.turnId) ?? optionalString(raw.turn_id),
    index: isFiniteNumber(raw.index) ? raw.index : undefined,
  };
}

export function parseOmpMessageUpdateFrame(value: unknown): OmpRpcMessageUpdateFrame | null {
  const raw = asObject(value);
  if (raw?.type !== 'message_update') return null;
  return {
    type: 'message_update',
    messageId: optionalString(raw.messageId) ?? optionalString(raw.message_id),
    delta: raw.delta,
    content: raw.content,
    assistantMessageEvent: asObject(raw.assistantMessageEvent) ?? asObject(raw.assistant_message_event) ?? undefined,
  };
}

export function parseOmpMessageEndFrame(value: unknown): OmpRpcMessageEndFrame | null {
  const raw = asObject(value);
  if (raw?.type !== 'message_end') return null;
  return {
    type: 'message_end',
    messageId: optionalString(raw.messageId) ?? optionalString(raw.message_id),
    message: asObject(raw.message) ?? undefined,
    sdkMessageId: optionalString(raw.sdkMessageId) ?? optionalString(raw.sdk_message_id),
  };
}

export function parseOmpToolExecutionUpdateFrame(value: unknown): OmpRpcToolExecutionUpdateFrame | null {
  const raw = asObject(value);
  if (raw?.type !== 'tool_execution_update') return null;
  return {
    type: 'tool_execution_update',
    toolCallId: optionalString(raw.toolCallId) ?? optionalString(raw.tool_call_id),
    partialResult: raw.partialResult ?? raw.partial_result,
    stdout: optionalString(raw.stdout),
    stderr: optionalString(raw.stderr),
    progress: raw.progress,
    artifact: raw.artifact,
    image: raw.image,
  };
}

export function parseOmpConfigUpdateFrame(value: unknown): OmpRpcConfigUpdateFrame | null {
  const raw = asObject(value);
  if (raw?.type !== 'config_update') return null;
  return { type: 'config_update', config: asObject(raw.config) ?? undefined };
}

function isStderrLevel(value: unknown): value is OmpStderrLevel {
  return value === 'debug' || value === 'noise' || value === 'warn' || value === 'fatal';
}

export function parseOmpStderrFrame(value: unknown): OmpRpcStderrFrame | null {
  const raw = asObject(value);
  if (raw?.type !== 'stderr') return null;
  return {
    type: 'stderr',
    text: optionalString(raw.text),
    level: isStderrLevel(raw.level) ? raw.level : undefined,
  };
}

function isSessionShutdownReason(value: unknown): value is OmpSessionShutdownReason {
  return value === 'normal' || value === 'switch' || value === 'crash' || value === 'external' || value === 'error';
}

export function parseOmpSessionShutdownFrame(value: unknown): OmpRpcSessionShutdownFrame | null {
  const raw = asObject(value);
  if (raw?.type !== 'session_shutdown') return null;
  return {
    type: 'session_shutdown',
    reason: isSessionShutdownReason(raw.reason) ? raw.reason : undefined,
    errorMessage: optionalString(raw.errorMessage) ?? optionalString(raw.error_message),
  };
}

export function parseOmpExtensionErrorFrame(value: unknown): OmpRpcExtensionErrorFrame | null {
  const raw = asObject(value);
  if (raw?.type !== 'extension_error') return null;
  return {
    type: 'extension_error',
    extensionId: optionalString(raw.extensionId) ?? optionalString(raw.extension_id),
    source: optionalString(raw.source),
    message: optionalString(raw.message),
    stackSummary: optionalString(raw.stackSummary) ?? optionalString(raw.stack_summary),
    recoverable: typeof raw.recoverable === 'boolean' ? raw.recoverable : undefined,
  };
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

  const data = raw.data !== undefined
    ? raw.data
    : Object.fromEntries(
      Object.entries(raw).filter(([key]) =>
        key !== 'type'
        && key !== 'id'
        && key !== 'command'
        && key !== 'success'
        && key !== 'error',
      ),
    );
  const normalizedData = raw.data !== undefined
    ? data
    : Object.keys(data as Record<string, unknown>).length > 0
      ? data
      : undefined;

  return {
    type: 'response',
    id: raw.id as string | undefined,
    command: raw.command,
    success: raw.success,
    error: raw.error as string | undefined,
    data: normalizedData,
    raw: { ...raw },
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

function parseOmpRpcCapabilities(value: unknown): OmpRpcCapabilities | null {
  const raw = asObject(value);
  if (!raw) return null;
  if (raw.planMode !== undefined && raw.planMode !== true) return null;
  if (raw.goalMode !== undefined && raw.goalMode !== true) return null;
  if (raw.loopMode !== undefined && raw.loopMode !== true) return null;
  if (raw.runtimeResources !== undefined && raw.runtimeResources !== true) return null;
  return {
    ...(raw.planMode === true ? { planMode: true } : {}),
    ...(raw.goalMode === true ? { goalMode: true } : {}),
    ...(raw.loopMode === true ? { loopMode: true } : {}),
    ...(raw.runtimeResources === true ? { runtimeResources: true } : {}),
  };
}

function parseOmpRuntimeResourceItem(value: unknown): OmpRpcRuntimeResourceItem | null {
  const raw = asObject(value);
  if (
    !raw
    || !isNonEmptyString(raw.name)
    || (raw.description !== undefined && !isString(raw.description))
    || (raw.path !== undefined && !isString(raw.path))
    || (raw.provider !== undefined && !isString(raw.provider))
    || (raw.toolCount !== undefined && !isFiniteNumber(raw.toolCount))
    || (raw.source !== undefined
      && raw.source !== 'bundled'
      && raw.source !== 'user'
      && raw.source !== 'project'
      && raw.source !== 'native'
      && raw.source !== 'runtime')
    || (raw.status !== undefined
      && raw.status !== 'connected'
      && raw.status !== 'connecting'
      && raw.status !== 'disconnected')
  ) {
    return null;
  }
  return {
    name: raw.name.trim(),
    description: raw.description as string | undefined,
    path: raw.path as string | undefined,
    source: raw.source as OmpRpcRuntimeResourceItem['source'],
    provider: raw.provider as string | undefined,
    status: raw.status as OmpRpcRuntimeResourceItem['status'],
    toolCount: raw.toolCount as number | undefined,
  };
}

export function parseOmpRuntimeResources(value: unknown): OmpRpcRuntimeResources | null {
  const raw = asObject(value);
  if (!raw || !Array.isArray(raw.skills) || !Array.isArray(raw.mcp) || !Array.isArray(raw.agents)) return null;
  const parseItems = (items: unknown[]) => items.map(parseOmpRuntimeResourceItem);
  const skills = parseItems(raw.skills);
  const mcp = parseItems(raw.mcp);
  const agents = parseItems(raw.agents);
  if (skills.some(item => !item) || mcp.some(item => !item) || agents.some(item => !item)) return null;
  return {
    skills: skills as OmpRpcRuntimeResourceItem[],
    mcp: mcp as OmpRpcRuntimeResourceItem[],
    agents: agents as OmpRpcRuntimeResourceItem[],
  };
}

export function parseOmpPlanModeState(value: unknown): OmpRpcPlanModeState | null {
  const raw = asObject(value);
  if (
    !raw
    || typeof raw.enabled !== 'boolean'
    || (raw.phase !== 'inactive'
      && raw.phase !== 'planning'
      && raw.phase !== 'awaiting_review'
      && raw.phase !== 'executing'
      && raw.phase !== 'paused')
    || (raw.planFilePath !== undefined && !isString(raw.planFilePath))
    || (raw.planModel !== undefined && !isString(raw.planModel))
  ) {
    return null;
  }
  return {
    enabled: raw.enabled,
    phase: raw.phase,
    planFilePath: raw.planFilePath as string | undefined,
    planModel: raw.planModel as string | undefined,
  };
}

export function parseOmpPlanModeStateUpdate(value: unknown): OmpRpcPlanModeStateUpdateFrame | null {
  const raw = asObject(value);
  if (raw?.type !== 'plan_mode_state_update') return null;
  const state = parseOmpPlanModeState(raw.state);
  return state ? { type: 'plan_mode_state_update', state } : null;
}

export function parseOmpPlanReviewRequest(value: unknown): OmpRpcPlanReviewRequestFrame | null {
  const raw = asObject(value);
  const options = parseStringArray(raw?.options);
  if (
    raw?.type !== 'plan_review_request'
    || !isString(raw.requestId)
    || raw.requestId.trim().length === 0
    || !isString(raw.title)
    || !isString(raw.planFilePath)
    || !isString(raw.planMarkdown)
    || !options
    || options.length === 0
    || options.some(option => option !== 'approve' && option !== 'refine' && option !== 'cancel')
  ) {
    return null;
  }
  return {
    type: 'plan_review_request',
    requestId: raw.requestId,
    title: raw.title,
    planFilePath: raw.planFilePath,
    planMarkdown: raw.planMarkdown,
    options: options as OmpPlanReviewAction[],
  };
}

function isOmpGoalStatus(value: unknown): value is OmpGoalStatus {
  return value === 'active'
    || value === 'paused'
    || value === 'budget-limited'
    || value === 'complete'
    || value === 'dropped';
}

export function parseOmpGoalModeState(value: unknown): OmpRpcGoalModeState | null {
  const raw = asObject(value);
  const goalRaw = raw?.goal === undefined ? undefined : asObject(raw.goal);
  const goal = goalRaw && isString(goalRaw.id) && isString(goalRaw.objective)
    && isOmpGoalStatus(goalRaw.status) && isFiniteNumber(goalRaw.tokensUsed)
    && isFiniteNumber(goalRaw.timeUsedSeconds) && isFiniteNumber(goalRaw.createdAt)
    && isFiniteNumber(goalRaw.updatedAt)
    && (goalRaw.tokenBudget === undefined || isFiniteNumber(goalRaw.tokenBudget))
    ? {
        id: goalRaw.id,
        objective: goalRaw.objective,
        status: goalRaw.status,
        tokenBudget: goalRaw.tokenBudget as number | undefined,
        tokensUsed: goalRaw.tokensUsed,
        timeUsedSeconds: goalRaw.timeUsedSeconds,
        createdAt: goalRaw.createdAt,
        updatedAt: goalRaw.updatedAt,
      }
    : undefined;
  if (!raw || typeof raw.enabled !== 'boolean' || typeof raw.paused !== 'boolean') return null;
  if (raw.goal !== undefined && !goal) return null;
  return { enabled: raw.enabled, paused: raw.paused, goal };
}

export function parseOmpGoalModeStateUpdate(value: unknown): OmpRpcGoalModeStateUpdateFrame | null {
  const raw = asObject(value);
  if (raw?.type !== 'goal_mode_state_update') return null;
  const state = parseOmpGoalModeState(raw.state);
  return state ? { type: 'goal_mode_state_update', state } : null;
}

export function parseOmpLoopModeState(value: unknown): OmpRpcLoopModeState | null {
  const raw = asObject(value);
  if (
    !raw
    || typeof raw.enabled !== 'boolean'
    || (raw.status !== 'disabled' && raw.status !== 'waiting_for_prompt' && raw.status !== 'running')
    || (raw.prompt !== undefined && !isString(raw.prompt))
    || (raw.limit !== undefined && !isString(raw.limit))
    || (raw.remaining !== undefined && !isFiniteNumber(raw.remaining))
  ) {
    return null;
  }
  return {
    enabled: raw.enabled,
    status: raw.status,
    prompt: raw.prompt as string | undefined,
    limit: raw.limit as string | undefined,
    remaining: raw.remaining as number | undefined,
  };
}

export function parseOmpLoopModeStateUpdate(value: unknown): OmpRpcLoopModeStateUpdateFrame | null {
  const raw = asObject(value);
  if (raw?.type !== 'loop_mode_state_update') return null;
  const state = parseOmpLoopModeState(raw.state);
  return state ? { type: 'loop_mode_state_update', state } : null;
}

export function parseOmpSessionState(value: unknown): OmpRpcSessionState | null {
  const raw = asObject(value);
  const contextUsage = raw?.contextUsage === undefined
    ? undefined
    : parseOmpContextUsage(raw.contextUsage);
  const todoPhases = parseOmpTodoPhases(raw?.todoPhases);
  const model = raw?.model === undefined
    ? undefined
    : normalizeOmpModelId(raw.model);
  const capabilities = raw?.capabilities === undefined
    ? undefined
    : parseOmpRpcCapabilities(raw.capabilities);
  if (
    !raw
    || !isString(raw.sessionId)
    || raw.sessionId.trim().length === 0
    || typeof raw.isStreaming !== 'boolean'
    || typeof raw.isCompacting !== 'boolean'
    || !isQueueMode(raw.steeringMode)
    || !isQueueMode(raw.followUpMode)
    || !isInterruptMode(raw.interruptMode)
    || typeof raw.autoCompactionEnabled !== 'boolean'
    || (raw.autoRetryEnabled !== undefined && typeof raw.autoRetryEnabled !== 'boolean')
    || !isFiniteNumber(raw.messageCount)
    || !isFiniteNumber(raw.queuedMessageCount)
    || !todoPhases
    || (raw.contextUsage !== undefined && !contextUsage)
    || (raw.capabilities !== undefined && !capabilities)
    || (raw.sessionFile !== undefined && !isString(raw.sessionFile))
    || (raw.sessionName !== undefined && !isString(raw.sessionName))
    || (raw.model !== undefined && !model)
  ) {
    return null;
  }

  return {
    ...raw,
    sessionId: raw.sessionId,
    sessionFile: raw.sessionFile as string | undefined,
    sessionName: raw.sessionName as string | undefined,
    model,
    isStreaming: raw.isStreaming,
    isCompacting: raw.isCompacting,
    steeringMode: raw.steeringMode,
    followUpMode: raw.followUpMode,
    interruptMode: raw.interruptMode,
    autoCompactionEnabled: raw.autoCompactionEnabled,
    autoRetryEnabled: raw.autoRetryEnabled as boolean | undefined,
    messageCount: raw.messageCount,
    queuedMessageCount: raw.queuedMessageCount,
    todoPhases,
    contextUsage: contextUsage ?? undefined,
    capabilities: capabilities ?? undefined,
  };
}

export function parseOmpLoginProvider(value: unknown): OmpRpcLoginProvider | null {
  const raw = asObject(value);
  if (
    !raw
    || !isString(raw.id)
    || raw.id.trim().length === 0
    || !isString(raw.name)
    || raw.name.trim().length === 0
    || typeof raw.available !== 'boolean'
    || typeof raw.authenticated !== 'boolean'
  ) {
    return null;
  }
  return {
    id: raw.id,
    name: raw.name,
    available: raw.available,
    authenticated: raw.authenticated,
  };
}

export function parseOmpLoginProvidersResponseData(value: unknown): OmpRpcLoginProvidersResponseData | null {
  const raw = asObject(value);
  if (!raw || !Array.isArray(raw.providers)) return null;
  const providers = raw.providers.map(parseOmpLoginProvider);
  if (providers.some(provider => provider === null)) return null;
  return { providers: providers as OmpRpcLoginProvider[] };
}

export function parseOmpLoginResult(value: unknown): OmpRpcLoginResult | null {
  const raw = asObject(value);
  if (!raw || !isString(raw.providerId) || raw.providerId.trim().length === 0) return null;
  return { providerId: raw.providerId };
}

// =============================================================================
// P0-P4: Runtime parsers for new types
// =============================================================================

function isOmpFeatureId(value: unknown): value is OmpFeatureId {
  return isString(value) && [
    'mcp.oauth',
    'mcp.notifications',
    'smithery.auth',
    'auth.provider.logout',
    'collab.live',
    'session.tree',
    'extensions.control',
    'marketplace.browse',
    'agents.control',
    'tools.btw',
    'tools.tan',
    'tools.omfg',
    'tools.debug',
    'audio.stt',
    'goal.guided',
    'model.temporary',
    'retry.exact',
    'queue.dequeue',
    'prompt.history',
    'editor.external',
    'copy.picker',
    'settings.schema',
  ].includes(value as OmpFeatureId);
}

function parseOmpCapabilityFeatureInfo(value: unknown): OmpCapabilityFeatureInfo | null {
  const raw = asObject(value);
  if (!raw || typeof raw.supported !== 'boolean') return null;
  return {
    supported: raw.supported,
    reason: optionalString(raw.reason),
    minProtocolVersion: optionalString(raw.minProtocolVersion),
  };
}

export function parseOmpCapabilityManifest(value: unknown): OmpCapabilityManifest | null {
  const raw = asObject(value);
  if (!raw || !isString(raw.protocolVersion)) return null;

  const commands = parseStringArray(raw.commands);
  const events = parseStringArray(raw.events);
  if (!commands || !events) return null;

  const features: Partial<Record<OmpFeatureId, OmpCapabilityFeatureInfo>> = {};
  const rawFeatures = asObject(raw.features);
  if (rawFeatures) {
    for (const [key, val] of Object.entries(rawFeatures)) {
      if (!isOmpFeatureId(key)) continue;
      const parsed = parseOmpCapabilityFeatureInfo(val);
      if (parsed) features[key] = parsed;
    }
  }

  return {
    protocolVersion: raw.protocolVersion,
    runtimeVersion: optionalString(raw.runtimeVersion),
    commands,
    events,
    features,
  };
}

export function parseOmpRpcError(value: unknown): OmpRpcError | null {
  const raw = asObject(value);
  if (!raw || !isString(raw.code) || !isString(raw.message)) return null;
  return {
    code: raw.code,
    message: raw.message,
    retryable: typeof raw.retryable === 'boolean' ? raw.retryable : undefined,
    capability: isOmpFeatureId(raw.capability) ? raw.capability : undefined,
    details: asObject(raw.details) ?? undefined,
  };
}

function isOmpMcpServerAuthStatus(value: unknown): value is OmpMcpServerAuthStatus {
  return value === 'none' || value === 'authenticated' || value === 'expired' || value === 'error';
}

function parseOmpMcpServerState(value: unknown): OmpMcpServerState | null {
  const raw = asObject(value);
  if (!raw || !isString(raw.name) || typeof raw.enabled !== 'boolean' || typeof raw.connected !== 'boolean' || !isOmpMcpServerAuthStatus(raw.authStatus)) {
    return null;
  }
  return {
    name: raw.name,
    enabled: raw.enabled,
    connected: raw.connected,
    authStatus: raw.authStatus,
    toolCount: isFiniteNumber(raw.toolCount) ? raw.toolCount : undefined,
    error: optionalString(raw.error),
  };
}

export function parseOmpMcpState(value: unknown): OmpMcpState | null {
  const raw = asObject(value);
  if (!raw || !Array.isArray(raw.servers) || typeof raw.notificationsEnabled !== 'boolean') return null;
  return {
    servers: raw.servers.map(parseOmpMcpServerState).filter((s): s is OmpMcpServerState => s !== null),
    notificationsEnabled: raw.notificationsEnabled,
    updatedAt: isFiniteNumber(raw.updatedAt) ? raw.updatedAt : Date.now(),
  };
}

function isOmpCollabRole(value: unknown): value is OmpCollabRole {
  return value === 'host' || value === 'guest' || value === 'readonly';
}

function isOmpCollabConnection(value: unknown): value is OmpCollabConnection {
  return value === 'off' || value === 'connecting' || value === 'connected' || value === 'reconnecting' || value === 'error';
}

function parseOmpCollabParticipant(value: unknown): OmpCollabParticipant | null {
  const raw = asObject(value);
  if (!raw || !isString(raw.id) || !isOmpCollabRole(raw.role)) return null;
  return {
    id: raw.id,
    displayName: optionalString(raw.displayName),
    role: raw.role,
    status: optionalString(raw.status),
    joinedAt: isFiniteNumber(raw.joinedAt) ? raw.joinedAt : undefined,
  };
}

export function parseOmpCollabState(value: unknown): OmpCollabState | null {
  const raw = asObject(value);
  if (!raw || !isOmpCollabConnection(raw.connection)) return null;
  const participants = Array.isArray(raw.participants)
    ? raw.participants.map(parseOmpCollabParticipant).filter((p): p is OmpCollabParticipant => p !== null)
    : [];
  return {
    connection: raw.connection,
    role: isOmpCollabRole(raw.role) ? raw.role : undefined,
    roomId: optionalString(raw.roomId),
    inviteUrl: optionalString(raw.inviteUrl),
    webUrl: optionalString(raw.webUrl),
    participants,
    error: optionalString(raw.error),
    updatedAt: isFiniteNumber(raw.updatedAt) ? raw.updatedAt : Date.now(),
  };
}

function parseOmpSessionTreeNode(value: unknown, currentPath?: string): OmpSessionTreeNode | null {
  const raw = asObject(value);
  if (!raw || !isString(raw.ompSessionPath)) return null;
  const children = Array.isArray(raw.children)
    ? raw.children.map((c) => parseOmpSessionTreeNode(c, currentPath)).filter((n): n is OmpSessionTreeNode => n !== null)
    : [];
  return {
    ompSessionPath: raw.ompSessionPath,
    sessionName: optionalString(raw.sessionName),
    parentOmpSessionPath: optionalString(raw.parentOmpSessionPath),
    branchEntryId: optionalString(raw.branchEntryId),
    depth: isFiniteNumber(raw.depth) ? raw.depth : 0,
    isCurrent: typeof raw.isCurrent === 'boolean' ? raw.isCurrent : raw.ompSessionPath === currentPath,
    children,
  };
}

export function parseOmpSessionTreeState(value: unknown): OmpSessionTreeState | null {
  const raw = asObject(value);
  if (!raw) return null;
  const root = parseOmpSessionTreeNode(raw.root, isString(raw.currentOmpSessionPath) ? raw.currentOmpSessionPath : undefined);
  if (!root) return null;
  return {
    root,
    currentOmpSessionPath: isString(raw.currentOmpSessionPath) ? raw.currentOmpSessionPath : root.ompSessionPath,
  };
}

function isOmpExtensionSource(value: unknown): value is OmpExtensionSource {
  return value === 'builtin' || value === 'user' || value === 'project' || value === 'marketplace';
}

function isOmpExtensionStatus(value: unknown): value is OmpExtensionStatus {
  return value === 'enabled' || value === 'disabled' || value === 'error' || value === 'reload_required';
}

function parseOmpExtensionCapability(value: unknown): OmpExtensionCapability {
  const raw = asObject(value);
  if (!raw) return {};
  return {
    commands: parseStringArray(raw.commands),
    skills: parseStringArray(raw.skills),
    mcps: parseStringArray(raw.mcps),
    agents: parseStringArray(raw.agents),
  };
}

export function parseOmpExtensionState(value: unknown): OmpExtensionState | null {
  const raw = asObject(value);
  if (!raw || !isString(raw.id) || !isString(raw.name) || !isString(raw.version) || !isOmpExtensionSource(raw.source) || !isOmpExtensionStatus(raw.status)) {
    return null;
  }
  return {
    id: raw.id,
    name: raw.name,
    version: raw.version,
    source: raw.source,
    status: raw.status,
    error: optionalString(raw.error),
    provides: parseOmpExtensionCapability(raw.provides),
    restartRequired: typeof raw.restartRequired === 'boolean' ? raw.restartRequired : false,
  };
}

export function parseOmpMarketplaceItem(value: unknown): OmpMarketplaceItem | null {
  const raw = asObject(value);
  if (!raw || !isString(raw.id) || !isString(raw.name) || !isString(raw.version)) return null;
  return {
    id: raw.id,
    name: raw.name,
    description: optionalString(raw.description),
    version: raw.version,
    author: optionalString(raw.author),
    installed: typeof raw.installed === 'boolean' ? raw.installed : false,
    updateAvailable: typeof raw.updateAvailable === 'boolean' ? raw.updateAvailable : false,
    permissions: parseStringArray(raw.permissions) ?? [],
  };
}

export function parseOmpMarketplaceSearchResult(value: unknown): OmpMarketplaceSearchResult | null {
  const raw = asObject(value);
  if (!raw || !Array.isArray(raw.items)) return null;
  return {
    items: raw.items.map(parseOmpMarketplaceItem).filter((i): i is OmpMarketplaceItem => i !== null),
    total: isFiniteNumber(raw.total) ? raw.total : 0,
    page: isFiniteNumber(raw.page) ? raw.page : 1,
  };
}

function isOmpAgentSource(value: unknown): value is OmpAgentSource {
  return value === 'bundled' || value === 'user' || value === 'project';
}

export function parseOmpAgentDefinitionState(value: unknown): OmpAgentDefinitionState | null {
  const raw = asObject(value);
  if (!raw || !isString(raw.id) || !isString(raw.identifier) || !isString(raw.name) || !isOmpAgentSource(raw.source) || typeof raw.enabled !== 'boolean') {
    return null;
  }
  return {
    id: raw.id,
    identifier: raw.identifier,
    name: raw.name,
    source: raw.source,
    enabled: raw.enabled,
    whenToUse: optionalString(raw.whenToUse),
    systemPrompt: optionalString(raw.systemPrompt),
    modelOverride: parseModelOverride(raw.modelOverride),
    error: optionalString(raw.error),
  };
}

export function parseOmpQueueState(value: unknown): OmpQueueState | null {
  const raw = asObject(value);
  if (!raw || !Array.isArray(raw.messages) || !isFiniteNumber(raw.revision)) return null;
  const messages: OmpQueueItem[] = [];
  for (const item of raw.messages) {
    const message = asObject(item);
    if (!message || !isString(message.messageId) || !isString(message.preview) || !isFiniteNumber(message.createdAt)) continue;
    const mode = message.mode;
    if (mode !== 'steer' && mode !== 'followUp' && mode !== 'abortAndPrompt' && mode !== 'prompt') continue;
    messages.push({
      messageId: message.messageId,
      mode,
      preview: message.preview,
      createdAt: message.createdAt,
    });
  }
  return {
    messages,
    revision: raw.revision,
    updatedAt: isFiniteNumber(raw.updatedAt) ? raw.updatedAt : Date.now(),
  };
}

export function parseOmpRetryState(value: unknown): OmpRetryState | null {
  const raw = asObject(value);
  if (!raw) return null;
  const phase = raw.phase;
  if (phase !== 'idle' && phase !== 'waiting' && phase !== 'succeeded' && phase !== 'failed' && phase !== 'cancelled') {
    return null;
  }
  return {
    phase,
    lastFailedTurnId: optionalString(raw.lastFailedTurnId),
    attempt: isFiniteNumber(raw.attempt) ? raw.attempt : undefined,
    maxAttempts: isFiniteNumber(raw.maxAttempts) ? raw.maxAttempts : undefined,
    error: optionalString(raw.error),
  };
}

function isOmpSettingsValueType(value: unknown): value is OmpSettingsValueType {
  return value === 'string' || value === 'number' || value === 'boolean' || value === 'enum' || value === 'array' || value === 'object';
}

function isOmpSettingsAppliesTo(value: unknown): value is OmpSettingsAppliesTo {
  return value === 'runtime' || value === 'desktop-equivalent' || value === 'tui-only' || value === 'advanced-raw';
}

function parseOmpSettingsSchemaEntry(value: unknown): OmpSettingsSchemaEntry | null {
  const raw = asObject(value);
  if (!raw || !isString(raw.path) || !isOmpSettingsValueType(raw.type) || !isString(raw.label) || !isOmpSettingsAppliesTo(raw.appliesTo)) {
    return null;
  }
  return {
    path: raw.path,
    type: raw.type,
    label: raw.label,
    description: optionalString(raw.description),
    tab: optionalString(raw.tab),
    group: optionalString(raw.group),
    options: Array.isArray(raw.options) ? raw.options : undefined,
    default: raw.default,
    effectiveValue: raw.effectiveValue,
    sensitive: typeof raw.sensitive === 'boolean' ? raw.sensitive : false,
    restartRequired: typeof raw.restartRequired === 'boolean' ? raw.restartRequired : false,
    appliesTo: raw.appliesTo,
  };
}

export function parseOmpSettingsSchema(value: unknown): OmpSettingsSchema | null {
  const raw = asObject(value);
  if (!raw || !Array.isArray(raw.entries) || !isFiniteNumber(raw.revision)) return null;
  return {
    entries: raw.entries.map(parseOmpSettingsSchemaEntry).filter((e): e is OmpSettingsSchemaEntry => e !== null),
    revision: raw.revision,
  };
}

export function parseOmpSettingsSetResult(value: unknown): OmpSettingsSetResult | null {
  const raw = asObject(value);
  if (!raw || typeof raw.success !== 'boolean' || !isFiniteNumber(raw.revision)) return null;
  return {
    success: raw.success,
    revision: raw.revision,
    restartRequired: typeof raw.restartRequired === 'boolean' ? raw.restartRequired : false,
    conflict: typeof raw.conflict === 'boolean' ? raw.conflict : undefined,
  };
}

export function parseOmpTranscriptionResult(value: unknown): OmpTranscriptionResult | null {
  const raw = asObject(value);
  if (!raw || !isString(raw.text)) return null;
  return {
    text: raw.text,
    confidence: isFiniteNumber(raw.confidence) ? raw.confidence : undefined,
    language: optionalString(raw.language),
  };
}

export function parseOmpDebugResult(value: unknown): OmpDebugResult | null {
  const raw = asObject(value);
  if (!raw || !isString(raw.toolId) || typeof raw.success !== 'boolean') return null;
  return {
    toolId: raw.toolId,
    success: raw.success,
    output: asObject(raw.output) ?? {},
    error: optionalString(raw.error),
    sanitized: typeof raw.sanitized === 'boolean' ? raw.sanitized : true,
  };
}
