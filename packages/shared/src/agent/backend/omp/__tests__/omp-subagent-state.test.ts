import { describe, expect, it } from 'bun:test';
import {
  createOmpSubagentState,
  cloneOmpSubagentState,
  reduceOmpSubagentState,
} from '../omp-subagent-state.ts';
import type { OmpSubagentSnapshot } from '../omp-rpc-protocol.ts';

function makeSnapshot(id: string, overrides: Partial<OmpSubagentSnapshot> = {}): OmpSubagentSnapshot {
  return {
    id,
    index: 1,
    agent: 'explore',
    agentSource: 'bundled',
    status: 'running',
    lastUpdate: Date.now(),
    ...overrides,
  };
}

describe('omp-subagent-state', () => {
  it('creates an unavailable initial state', () => {
    const state = createOmpSubagentState();
    expect(state.available).toBe(false);
    expect(state.subagents).toEqual([]);
    expect(state.revision).toBe(0);
  });

  it('clones state preserving transcript arrays', () => {
    let state = reduceOmpSubagentState(createOmpSubagentState(), { type: 'session_state', sessionId: 's1' });
    state = reduceOmpSubagentState(state, { type: 'snapshot', subagents: [makeSnapshot('sa-1')] });
    state = reduceOmpSubagentState(state, {
      type: 'transcript_loaded',
      id: 'sa-1',
      entries: [{ type: 'text' }],
      messages: [{ role: 'assistant' }],
      cursor: { fromByte: 0, nextByte: 100, hasMore: true },
    });
    const cloned = cloneOmpSubagentState(state);
    expect(cloned.subagents[0]!.transcriptEntries).toEqual(state.subagents[0]!.transcriptEntries);
    expect(cloned.subagents[0]!.transcriptEntries).not.toBe(state.subagents[0]!.transcriptEntries);
    expect(cloned.subagents[0]!.cursor).toEqual(state.subagents[0]!.cursor);
    expect(cloned.subagents[0]!.cursor).not.toBe(state.subagents[0]!.cursor);
  });

  it('marks unavailable and clears subagents', () => {
    let state = reduceOmpSubagentState(createOmpSubagentState(), { type: 'session_state', sessionId: 's1' });
    state = reduceOmpSubagentState(state, { type: 'snapshot', subagents: [makeSnapshot('sa-1')] });
    state = reduceOmpSubagentState(state, { type: 'unavailable', error: 'disconnected' });
    expect(state.available).toBe(false);
    expect(state.subagents).toEqual([]);
    expect(state.error).toBe('disconnected');
  });

  it('session_state resets subagents when session changes', () => {
    let state = reduceOmpSubagentState(createOmpSubagentState(), { type: 'session_state', sessionId: 's1' });
    state = reduceOmpSubagentState(state, { type: 'snapshot', subagents: [makeSnapshot('sa-1')] });
    state = reduceOmpSubagentState(state, { type: 'session_state', sessionId: 's2' });
    expect(state.sessionId).toBe('s2');
    expect(state.subagents).toEqual([]);
    expect(state.revision).toBe(1);
  });

  it('session_state preserves subagents when session is same', () => {
    let state = reduceOmpSubagentState(createOmpSubagentState(), { type: 'session_state', sessionId: 's1' });
    state = reduceOmpSubagentState(state, { type: 'snapshot', subagents: [makeSnapshot('sa-1')] });
    state = reduceOmpSubagentState(state, { type: 'session_state', sessionId: 's1' });
    expect(state.subagents).toHaveLength(1);
    expect(state.revision).toBe(3);
  });

  it('snapshot replaces subagents and preserves transcripts', () => {
    let state = reduceOmpSubagentState(createOmpSubagentState(), { type: 'session_state', sessionId: 's1' });
    state = reduceOmpSubagentState(state, { type: 'snapshot', subagents: [makeSnapshot('sa-1')] });
    state = reduceOmpSubagentState(state, {
      type: 'transcript_loaded',
      id: 'sa-1',
      entries: [{ type: 'text' }],
      messages: [{ role: 'assistant' }],
      cursor: { fromByte: 0, nextByte: 100, hasMore: true },
    });
    state = reduceOmpSubagentState(state, { type: 'snapshot', subagents: [makeSnapshot('sa-1', { status: 'completed' })] });
    expect(state.subagents[0]!.status).toBe('completed');
    expect(state.subagents[0]!.transcriptEntries).toHaveLength(1);
    expect(state.subagents[0]!.cursor?.nextByte).toBe(100);
  });

  it('upsert adds or updates subagent', () => {
    let state = reduceOmpSubagentState(createOmpSubagentState(), { type: 'session_state', sessionId: 's1' });
    state = reduceOmpSubagentState(state, { type: 'upsert', subagent: makeSnapshot('sa-1') });
    expect(state.subagents).toHaveLength(1);
    state = reduceOmpSubagentState(state, { type: 'upsert', subagent: makeSnapshot('sa-1', { status: 'completed' }) });
    expect(state.subagents[0]!.status).toBe('completed');
  });

  it('remove deletes subagent by id', () => {
    let state = reduceOmpSubagentState(createOmpSubagentState(), { type: 'session_state', sessionId: 's1' });
    state = reduceOmpSubagentState(state, { type: 'snapshot', subagents: [makeSnapshot('sa-1'), makeSnapshot('sa-2')] });
    state = reduceOmpSubagentState(state, { type: 'remove', id: 'sa-1' });
    expect(state.subagents).toHaveLength(1);
    expect(state.subagents[0]!.id).toBe('sa-2');
  });

  it('transcript_pending and transcript_loaded update loading and entries', () => {
    let state = reduceOmpSubagentState(createOmpSubagentState(), { type: 'session_state', sessionId: 's1' });
    state = reduceOmpSubagentState(state, { type: 'snapshot', subagents: [makeSnapshot('sa-1')] });
    state = reduceOmpSubagentState(state, { type: 'transcript_pending', id: 'sa-1' });
    expect(state.subagents[0]!.transcriptLoading).toBe(true);
    expect(state.subagents[0]!.transcriptError).toBeUndefined();
    state = reduceOmpSubagentState(state, {
      type: 'transcript_loaded',
      id: 'sa-1',
      entries: [{ type: 'text' }],
      messages: [{ role: 'assistant' }],
    });
    expect(state.subagents[0]!.transcriptLoading).toBe(false);
    expect(state.subagents[0]!.transcriptEntries).toHaveLength(1);
  });

  it('transcript_failed records error', () => {
    let state = reduceOmpSubagentState(createOmpSubagentState(), { type: 'session_state', sessionId: 's1' });
    state = reduceOmpSubagentState(state, { type: 'snapshot', subagents: [makeSnapshot('sa-1')] });
    state = reduceOmpSubagentState(state, { type: 'transcript_failed', id: 'sa-1', error: 'boom' });
    expect(state.subagents[0]!.transcriptLoading).toBe(false);
    expect(state.subagents[0]!.transcriptError).toBe('boom');
  });

  it('transcript_loaded appends entries and respects reset from fromByte=0', () => {
    let state = reduceOmpSubagentState(createOmpSubagentState(), { type: 'session_state', sessionId: 's1' });
    state = reduceOmpSubagentState(state, { type: 'snapshot', subagents: [makeSnapshot('sa-1')] });
    state = reduceOmpSubagentState(state, {
      type: 'transcript_loaded',
      id: 'sa-1',
      entries: [{ type: 'first' }],
      messages: [{ role: 'assistant' }],
      cursor: { fromByte: 100, nextByte: 200, hasMore: true },
    });
    state = reduceOmpSubagentState(state, {
      type: 'transcript_loaded',
      id: 'sa-1',
      entries: [{ type: 'second' }],
      messages: [{ role: 'user' }],
      cursor: { fromByte: 0, nextByte: 50, hasMore: false },
    });
    expect(state.subagents[0]!.transcriptEntries).toEqual([{ type: 'second' }]);
    expect(state.subagents[0]!.transcriptMessages).toEqual([{ role: 'user' }]);
  });
});
