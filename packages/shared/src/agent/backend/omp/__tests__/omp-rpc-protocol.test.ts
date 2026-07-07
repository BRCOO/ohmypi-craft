import { describe, expect, it } from 'bun:test';

import {
  craftThinkingLevelToOmp,
  ompThinkingLevelToCraft,
  parseOmpAvailableCommandsResponseData,
  parseOmpAvailableCommandsUpdate,
  parseOmpAvailableSlashCommand,
  parseOmpPromptResponseData,
  parseOmpPromptResult,
  parseOmpQueueControlState,
  parseOmpRpcResponse,
  parseOmpSessionState,
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
    expect(parseOmpSessionState({ ...validState, futureField: 'kept' })).toEqual({
      ...validState,
      futureField: 'kept',
      sessionFile: undefined,
      sessionName: undefined,
    });
  });

  it('rejects session state with a missing or empty session id', () => {
    const { sessionId: _sessionId, ...withoutSessionId } = validState;
    expect(parseOmpSessionState(withoutSessionId)).toBeNull();
    expect(parseOmpSessionState({ ...validState, sessionId: '   ' })).toBeNull();
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
});
