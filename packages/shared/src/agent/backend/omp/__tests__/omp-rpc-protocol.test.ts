import { describe, expect, it } from 'bun:test';

import {
  craftThinkingLevelToOmp,
  ompThinkingLevelToCraft,
  parseOmpPromptResponseData,
  parseOmpPromptResult,
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
});
