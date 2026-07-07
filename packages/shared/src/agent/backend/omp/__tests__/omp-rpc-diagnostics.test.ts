import { describe, expect, it } from 'bun:test';

import { OmpRpcDiagnostics } from '../omp-rpc-diagnostics.ts';

describe('OmpRpcDiagnostics', () => {
  it('counts lifecycle traffic and returns detached snapshots', () => {
    const diagnostics = new OmpRpcDiagnostics();
    diagnostics.startProcess(3, { executable: 'omp', source: 'config' });
    diagnostics.recordFrame('ready');
    diagnostics.markReady();
    const startedAt = diagnostics.recordRequest('get_state');
    diagnostics.recordResponse('omp-1', 'get_state', startedAt);
    diagnostics.setSessionState({
      sessionId: 'session-1',
      sessionFile: 'session.jsonl',
      thinkingLevel: 'medium',
      isStreaming: false,
      isCompacting: false,
      steeringMode: 'all',
      followUpMode: 'all',
      interruptMode: 'immediate',
      autoCompactionEnabled: true,
      messageCount: 0,
      queuedMessageCount: 0,
      todoPhases: [],
      secretPayload: 'must not escape',
    });

    const first = diagnostics.snapshot('stderr text token=super-secret-value Bearer abc.def.ghi');
    expect(first).toMatchObject({
      processGeneration: 3,
      ready: true,
      stateSynchronized: true,
      framesReceived: 1,
      framesByType: { ready: 1 },
      requestsByCommand: { get_state: 1 },
      session: { sessionId: 'session-1', sessionFile: 'session.jsonl' },
      recentStderr: 'stderr text token=[REDACTED] Bearer [REDACTED]',
    });
    expect(JSON.stringify(first)).not.toContain('must not escape');
    first.framesByType.ready = 99;
    expect(diagnostics.snapshot().framesByType.ready).toBe(1);
  });

  it('distinguishes unknown, orphan, duplicate, timeout, write, and exit counters', () => {
    const diagnostics = new OmpRpcDiagnostics();
    expect(diagnostics.recordUnknownFrame('future', { type: 'future', payload: 'secret' })).toBe(true);
    expect(diagnostics.recordUnknownFrame('future', { type: 'future', other: 1 })).toBe(true);
    expect(diagnostics.recordUnknownFrame('future', { type: 'future' })).toBe(false);
    diagnostics.recordMalformedLine();
    diagnostics.recordUnmatchedResponse('never-seen');
    const startedAt = diagnostics.recordRequest('prompt');
    diagnostics.recordResponse('done', 'prompt', startedAt);
    diagnostics.recordUnmatchedResponse('done');
    diagnostics.recordTimeout();
    diagnostics.recordWriteFailure();
    diagnostics.recordExit(9, null);

    const snapshot = diagnostics.snapshot();
    expect(snapshot).toMatchObject({
      malformedLines: 1,
      unknownFrames: 3,
      unknownFramesByType: { future: 3 },
      orphanResponses: 1,
      duplicateResponses: 1,
      requestTimeouts: 1,
      writeFailures: 1,
      lastExit: { code: 9, signal: null },
    });
    expect(snapshot.unknownFrameSamples[0]).toEqual({
      type: 'future',
      keys: ['payload', 'type'],
    });
    expect(JSON.stringify(snapshot)).not.toContain('secret');
  });
});
