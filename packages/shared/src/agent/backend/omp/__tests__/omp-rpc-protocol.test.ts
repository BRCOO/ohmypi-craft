import { describe, expect, it } from 'bun:test';

import {
  craftThinkingLevelToOmp,
  ompThinkingLevelToCraft,
  parseOmpAvailableCommandsResponseData,
  parseOmpAvailableCommandsUpdate,
  parseOmpAvailableSlashCommand,
  parseOmpBranchMessagesResponseData,
  parseOmpBranchResult,
  parseOmpCancellationResult,
  parseOmpCompactionResult,
  parseOmpContextUsage,
  parseOmpExportHtmlResponseData,
  parseOmpHandoffResult,
  parseOmpMessagesResponseData,
  parseOmpPromptResponseData,
  parseOmpPromptResult,
  parseOmpQueueControlState,
  parseOmpRpcResponse,
  parseOmpRuntimeEvent,
  parseOmpSetTodosResponseData,
  parseOmpSessionState,
  parseOmpSessionStats,
  parseOmpTodoEvent,
  parseOmpTodoItem,
  parseOmpTodoPhase,
  parseOmpTodoPhases,
} from '../omp-rpc-protocol.ts';

const validState = {
  sessionId: 'session-1',
  isStreaming: false,
  isCompacting: false,
  steeringMode: 'all' as const,
  followUpMode: 'one-at-a-time' as const,
  interruptMode: 'immediate' as const,
  autoCompactionEnabled: true,
  messageCount: 4,
  queuedMessageCount: 0,
  todoPhases: [],
};

describe('OMP RPC protocol parsers', () => {
  it('maps Craft and OMP thinking levels without overstating max support', () => {
    expect(craftThinkingLevelToOmp('off')).toBe('off');
    expect(craftThinkingLevelToOmp('medium')).toBe('medium');
    expect(craftThinkingLevelToOmp('max')).toBe('xhigh');
    expect(ompThinkingLevelToCraft('minimal')).toBe('low');
    expect(ompThinkingLevelToCraft('xhigh')).toBe('xhigh');
    expect(ompThinkingLevelToCraft('unknown')).toBeUndefined();
  });

  it('parses a response envelope without nesting its data payload', () => {
    expect(parseOmpRpcResponse({
      type: 'response',
      id: 'omp-1',
      command: 'get_state',
      success: true,
      data: { alive: true },
      futureField: 'ignored',
    })).toEqual({
      type: 'response',
      id: 'omp-1',
      command: 'get_state',
      success: true,
      error: undefined,
      data: { alive: true },
      raw: {
        type: 'response',
        id: 'omp-1',
        command: 'get_state',
        success: true,
        data: { alive: true },
        futureField: 'ignored',
      },
    });
  });

  it('rejects malformed response and prompt-result frames', () => {
    expect(parseOmpRpcResponse({ type: 'response', command: 'prompt', success: 'yes' })).toBeNull();
    expect(parseOmpPromptResult({ type: 'prompt_result', agentInvoked: 'no' })).toBeNull();
  });

  it('parses correlated prompt outcomes', () => {
    expect(parseOmpPromptResult({
      type: 'prompt_result',
      id: 'omp-2',
      agentInvoked: false,
    })).toEqual({
      type: 'prompt_result',
      id: 'omp-2',
      agentInvoked: false,
    });
    expect(parseOmpPromptResponseData({ agentInvoked: true, extra: 1 })).toEqual({
      agentInvoked: true,
    });
  });

  it('validates session state while preserving future fields', () => {
    expect(parseOmpSessionState({
      ...validState,
      todoPhases: [
        {
          name: 'Build',
          tasks: [
            {
              content: 'Wire Todo bridge',
              status: 'in_progress',
              details: 'hidden detail',
              notes: 'legacy note',
            },
          ],
        },
      ],
      contextUsage: { tokens: 4000, contextWindow: 10000, percent: 40 },
      futureField: 'kept',
    })).toEqual({
      ...validState,
      todoPhases: [
        {
          name: 'Build',
          tasks: [
            {
              content: 'Wire Todo bridge',
              status: 'in_progress',
              details: 'hidden detail',
              notes: ['legacy note'],
            },
          ],
        },
      ],
      contextUsage: { tokens: 4000, contextWindow: 10000, percent: 40 },
      futureField: 'kept',
      sessionFile: undefined,
      sessionName: undefined,
    });
  });

  it('parses context usage, statistics, and compaction results', () => {
    expect(parseOmpContextUsage({ tokens: 4000, contextWindow: 10000, percent: 40 })).toEqual({
      tokens: 4000,
      contextWindow: 10000,
      percent: 40,
    });
    expect(parseOmpContextUsage({ tokens: -1, contextWindow: 10000, percent: 0 })).toBeNull();

    const stats = {
      sessionId: 'session-1',
      sessionFile: 'D:/sessions/one.jsonl',
      userMessages: 2,
      assistantMessages: 2,
      toolCalls: 3,
      toolResults: 3,
      totalMessages: 10,
      tokens: {
        input: 100,
        output: 50,
        reasoning: 25,
        cacheRead: 30,
        cacheWrite: 10,
        total: 215,
      },
      premiumRequests: 1,
      cost: 0.125,
    };
    expect(parseOmpSessionStats(stats)).toEqual(stats);
    expect(parseOmpSessionStats({ ...stats, tokens: { ...stats.tokens, total: '215' } })).toBeNull();

    const compaction = {
      summary: 'summary',
      shortSummary: 'short',
      firstKeptEntryId: 'entry-2',
      tokensBefore: 9000,
      details: { strategy: 'snapcompact' },
      preserveData: { key: true },
    };
    expect(parseOmpCompactionResult(compaction)).toEqual(compaction);
    expect(parseOmpCompactionResult({ ...compaction, tokensBefore: -1 })).toBeNull();
  });

  it('parses compaction, retry, and fallback runtime events', () => {
    expect(parseOmpRuntimeEvent({
      type: 'auto_compaction_start',
      reason: 'threshold',
      action: 'snapcompact',
    })).toEqual({
      type: 'auto_compaction_start',
      reason: 'threshold',
      action: 'snapcompact',
    });
    expect(parseOmpRuntimeEvent({
      type: 'auto_retry_start',
      attempt: 2,
      maxAttempts: 4,
      delayMs: 1500,
      errorMessage: 'rate limited',
      errorId: 429,
    })).toEqual({
      type: 'auto_retry_start',
      attempt: 2,
      maxAttempts: 4,
      delayMs: 1500,
      errorMessage: 'rate limited',
      errorId: 429,
    });
    expect(parseOmpRuntimeEvent({
      type: 'retry_fallback_applied',
      from: 'provider/a',
      to: 'provider/b',
      role: 'default',
    })).toEqual({
      type: 'retry_fallback_applied',
      from: 'provider/a',
      to: 'provider/b',
      role: 'default',
    });
    expect(parseOmpRuntimeEvent({ type: 'auto_retry_start', attempt: '2' })).toBeNull();
  });

  it('rejects session state with a missing or empty session id', () => {
    const { sessionId: _sessionId, ...withoutSessionId } = validState;
    expect(parseOmpSessionState(withoutSessionId)).toBeNull();
    expect(parseOmpSessionState({ ...validState, sessionId: '   ' })).toBeNull();
  });

  it('parses OMP Todo phases, set_todos responses, and Todo events strictly', () => {
    const item = {
      content: 'Ship Todo card',
      status: 'pending' as const,
      details: 'preserve me',
      notes: ['note'],
    };
    const phase = { name: 'Desktop', tasks: [item] };
    expect(parseOmpTodoItem(item)).toEqual(item);
    expect(parseOmpTodoItem({ ...item, status: 'unknown' })).toBeNull();
    expect(parseOmpTodoPhase(phase)).toEqual(phase);
    expect(parseOmpTodoPhases([phase])).toEqual([phase]);
    expect(parseOmpSetTodosResponseData({ todoPhases: [phase] })).toEqual({ todoPhases: [phase] });
    expect(parseOmpSetTodosResponseData({ todoPhases: [{ name: 'bad', tasks: [{ content: 'x', status: 'new' }] }] })).toBeNull();
    expect(parseOmpTodoEvent({
      type: 'todo_reminder',
      todos: [item],
      attempt: 1,
      maxAttempts: 3,
    })).toEqual({
      type: 'todo_reminder',
      todos: [item],
      attempt: 1,
      maxAttempts: 3,
    });
    expect(parseOmpTodoEvent({ type: 'todo_auto_clear' })).toEqual({ type: 'todo_auto_clear' });
    expect(parseOmpTodoEvent({ type: 'todo_reminder', todos: [item], attempt: -1, maxAttempts: 3 })).toBeNull();
  });

  it('parses available slash commands while preserving source metadata', () => {
    expect(parseOmpAvailableSlashCommand({
      name: 'model',
      aliases: ['m', 'bad alias'],
      description: 'Switch model',
      input: { hint: 'provider/model' },
      subcommands: [
        { name: 'list', description: 'List models', usage: '/model list' },
        { name: 'bad subcommand' },
      ],
      source: 'builtin',
    })).toEqual({
      name: 'model',
      aliases: ['m'],
      description: 'Switch model',
      input: { hint: 'provider/model' },
      subcommands: [{ name: 'list', description: 'List models', usage: '/model list' }],
      source: 'builtin',
    });
  });

  it('rejects invalid available slash commands and keeps valid siblings', () => {
    expect(parseOmpAvailableSlashCommand({ name: 'bad command', source: 'builtin' })).toBeNull();
    expect(parseOmpAvailableSlashCommand({ name: 'ok', source: 'unknown' })).toBeNull();
    expect(parseOmpAvailableCommandsResponseData({
      commands: [
        { name: 'stats', source: 'builtin' },
        { name: '', source: 'builtin' },
      ],
    })).toEqual({
      commands: [{ name: 'stats', aliases: undefined, description: undefined, input: undefined, subcommands: undefined, source: 'builtin' }],
    });
  });

  it('parses available commands update frames', () => {
    expect(parseOmpAvailableCommandsUpdate({
      type: 'available_commands_update',
      commands: [{ name: 'custom-task', source: 'custom' }],
    })).toEqual({
      type: 'available_commands_update',
      commands: [{ name: 'custom-task', aliases: undefined, description: undefined, input: undefined, subcommands: undefined, source: 'custom' }],
    });
    expect(parseOmpAvailableCommandsUpdate({ type: 'available_commands_update', commands: 'nope' })).toBeNull();
  });

  it('parses partial queue control state from config updates', () => {
    expect(parseOmpQueueControlState({
      isStreaming: true,
      steeringMode: 'one-at-a-time',
      followUpMode: 'all',
      interruptMode: 'wait',
      queuedMessageCount: 2,
      ignored: 'value',
    })).toEqual({
      isStreaming: true,
      steeringMode: 'one-at-a-time',
      followUpMode: 'all',
      interruptMode: 'wait',
      queuedMessageCount: 2,
    });
    expect(parseOmpQueueControlState({ steeringMode: 'bad' })).toBeNull();
  });

  it('parses session command responses', () => {
    expect(parseOmpCancellationResult({ cancelled: false })).toEqual({ cancelled: false });
    expect(parseOmpCancellationResult({ cancelled: 'no' })).toBeNull();

    expect(parseOmpBranchMessagesResponseData({
      messages: [
        { entryId: 'entry-1', text: 'First prompt' },
      ],
    })).toEqual({
      messages: [{ entryId: 'entry-1', text: 'First prompt' }],
    });
    expect(parseOmpBranchMessagesResponseData({
      messages: [
        { entryId: 'entry-1', text: 'First prompt' },
        { entryId: 2, text: 'bad' },
      ],
    })).toBeNull();

    expect(parseOmpBranchResult({ text: 'Selected prompt', cancelled: false })).toEqual({
      text: 'Selected prompt',
      cancelled: false,
    });
    expect(parseOmpBranchResult({ selectedText: 'wrong shape', cancelled: false })).toBeNull();

    expect(parseOmpExportHtmlResponseData({ path: 'D:/tmp/session.html' })).toEqual({
      path: 'D:/tmp/session.html',
    });
    expect(parseOmpExportHtmlResponseData({ path: '' })).toBeNull();

    expect(parseOmpHandoffResult({ savedPath: 'D:/tmp/handoff.md' })).toEqual({
      savedPath: 'D:/tmp/handoff.md',
    });
    expect(parseOmpHandoffResult(null)).toBeNull();

    const messages = [{ role: 'user', content: 'hello' }];
    expect(parseOmpMessagesResponseData({ messages })).toEqual({ messages });
    expect(parseOmpMessagesResponseData({ messages: 'nope' })).toBeNull();
  });
});
