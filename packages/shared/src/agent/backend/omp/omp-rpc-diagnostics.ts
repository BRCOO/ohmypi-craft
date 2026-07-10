import {
  OMP_RPC_COMMAND_DEFINITIONS,
  type OmpRpcCommandDefinition,
  type OmpRpcCommandType,
  type OmpRpcSessionState,
} from './omp-rpc-protocol.ts';

export interface OmpUnknownFrameSample {
  type: string;
  keys: string[];
}

export interface OmpRequestLatency {
  lastMs: number;
  maxMs: number;
}

export interface OmpRpcDiagnosticsSnapshot {
  protocolVersion: 'unversioned';
  command?: { executable: string; source: string };
  processGeneration: number;
  ready: boolean;
  stateSynchronized: boolean;
  ompVersion?: string;
  protocolVersionReported?: string;
  versionWarning?: string;
  session?: {
    sessionId: string;
    sessionFile?: string;
    sessionName?: string;
    thinkingLevel?: unknown;
  };
  framesReceived: number;
  framesByType: Record<string, number>;
  malformedLines: number;
  unknownFrames: number;
  unknownFramesByType: Record<string, number>;
  unknownFrameSamples: OmpUnknownFrameSample[];
  requestsSent: number;
  requestsByCommand: Record<string, number>;
  requestLatencyByCommand: Record<string, OmpRequestLatency>;
  requestTimeouts: number;
  requestTimeoutsByCommand: Record<string, number>;
  commandDefinitions: Record<OmpRpcCommandType, OmpRpcCommandDefinition>;
  orphanResponses: number;
  duplicateResponses: number;
  writeFailures: number;
  lastCommand?: string;
  lastFrameType?: string;
  lastExit?: { code: number | null; signal: NodeJS.Signals | null };
  recentStderr: string;
}

const MAX_UNKNOWN_SAMPLES = 8;
const MAX_COMPLETED_IDS = 512;

function increment(record: Record<string, number>, key: string): number {
  const next = (record[key] ?? 0) + 1;
  record[key] = next;
  return next;
}

export function redactOmpDiagnosticText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(api[_-]?key|token|secret|password)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\b[A-Za-z0-9+/=_-]{64,}\b/g, '[REDACTED_BLOB]');
}

export class OmpRpcDiagnostics {
  private command: OmpRpcDiagnosticsSnapshot['command'];
  private processGeneration = 0;
  private ready = false;
  private state: OmpRpcSessionState | null = null;
  private ompVersion: string | undefined;
  private protocolVersionReported: string | undefined;
  private versionWarning: string | undefined;
  private framesReceived = 0;
  private framesByType: Record<string, number> = {};
  private malformedLines = 0;
  private unknownFrames = 0;
  private unknownFramesByType: Record<string, number> = {};
  private unknownFrameSamples: OmpUnknownFrameSample[] = [];
  private requestsSent = 0;
  private requestsByCommand: Record<string, number> = {};
  private requestLatencyByCommand: Record<string, OmpRequestLatency> = {};
  private requestTimeouts = 0;
  private requestTimeoutsByCommand: Record<string, number> = {};
  private orphanResponses = 0;
  private duplicateResponses = 0;
  private writeFailures = 0;
  private lastCommand: string | undefined;
  private lastFrameType: string | undefined;
  private lastExit: OmpRpcDiagnosticsSnapshot['lastExit'];
  private completedResponseIds = new Set<string>();

  startProcess(
    generation: number,
    command: { executable: string; source: string },
  ): void {
    this.processGeneration = generation;
    this.command = { ...command };
    this.ready = false;
    this.state = null;
    this.lastExit = undefined;
  }

  markReady(): void {
    this.ready = true;
  }

  setVersionInfo(ompVersion?: string, protocolVersion?: string, versionWarning?: string): void {
    this.ompVersion = ompVersion;
    this.protocolVersionReported = protocolVersion;
    this.versionWarning = versionWarning;
  }

  setSessionState(state: OmpRpcSessionState): void {
    this.state = state;
  }

  clearProcessState(generation: number): void {
    this.processGeneration = generation;
    this.ready = false;
    this.state = null;
  }

  recordFrame(type: unknown): string {
    const normalized = typeof type === 'string' && type ? type : 'unknown';
    this.framesReceived += 1;
    increment(this.framesByType, normalized);
    this.lastFrameType = normalized;
    return normalized;
  }

  recordMalformedLine(): void {
    this.malformedLines += 1;
  }

  recordUnknownFrame(type: string, raw: Record<string, unknown>): boolean {
    this.unknownFrames += 1;
    const count = increment(this.unknownFramesByType, type);
    if (this.unknownFrameSamples.length < MAX_UNKNOWN_SAMPLES) {
      this.unknownFrameSamples.push({ type, keys: Object.keys(raw).sort() });
    }
    return (count & (count - 1)) === 0;
  }

  recordRequest(command: string): number {
    this.requestsSent += 1;
    increment(this.requestsByCommand, command);
    this.lastCommand = command;
    return Date.now();
  }

  recordResponse(id: string, command: string, startedAt: number): void {
    const latency = Math.max(0, Date.now() - startedAt);
    const previous = this.requestLatencyByCommand[command];
    this.requestLatencyByCommand[command] = {
      lastMs: latency,
      maxMs: Math.max(previous?.maxMs ?? 0, latency),
    };
    this.completedResponseIds.add(id);
    if (this.completedResponseIds.size > MAX_COMPLETED_IDS) {
      const oldest = this.completedResponseIds.values().next().value;
      if (oldest) this.completedResponseIds.delete(oldest);
    }
  }

  recordUnmatchedResponse(id: string | undefined): void {
    if (id && this.completedResponseIds.has(id)) {
      this.duplicateResponses += 1;
    } else {
      this.orphanResponses += 1;
    }
  }

  recordTimeout(command?: string): void {
    this.requestTimeouts += 1;
    if (command) increment(this.requestTimeoutsByCommand, command);
  }

  recordWriteFailure(): void {
    this.writeFailures += 1;
  }

  recordExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.lastExit = { code, signal };
  }

  snapshot(recentStderr = ''): OmpRpcDiagnosticsSnapshot {
    const state = this.state;
    return {
      protocolVersion: 'unversioned',
      command: this.command ? { ...this.command } : undefined,
      processGeneration: this.processGeneration,
      ready: this.ready,
      stateSynchronized: state !== null,
      ompVersion: this.ompVersion,
      protocolVersionReported: this.protocolVersionReported,
      versionWarning: this.versionWarning,
      session: state
        ? {
            sessionId: state.sessionId,
            sessionFile: state.sessionFile,
            sessionName: state.sessionName,
            thinkingLevel: state.thinkingLevel,
          }
        : undefined,
      framesReceived: this.framesReceived,
      framesByType: { ...this.framesByType },
      malformedLines: this.malformedLines,
      unknownFrames: this.unknownFrames,
      unknownFramesByType: { ...this.unknownFramesByType },
      unknownFrameSamples: this.unknownFrameSamples.map((sample) => ({
        type: sample.type,
        keys: [...sample.keys],
      })),
      requestsSent: this.requestsSent,
      requestsByCommand: { ...this.requestsByCommand },
      requestLatencyByCommand: Object.fromEntries(
        Object.entries(this.requestLatencyByCommand).map(([command, latency]) => [
          command,
          { ...latency },
        ]),
      ),
      requestTimeouts: this.requestTimeouts,
      requestTimeoutsByCommand: { ...this.requestTimeoutsByCommand },
      commandDefinitions: Object.fromEntries(
        Object.entries(OMP_RPC_COMMAND_DEFINITIONS).map(([command, definition]) => [
          command,
          { ...definition },
        ]),
      ) as Record<OmpRpcCommandType, OmpRpcCommandDefinition>,
      orphanResponses: this.orphanResponses,
      duplicateResponses: this.duplicateResponses,
      writeFailures: this.writeFailures,
      lastCommand: this.lastCommand,
      lastFrameType: this.lastFrameType,
      lastExit: this.lastExit ? { ...this.lastExit } : undefined,
      recentStderr: redactOmpDiagnosticText(recentStderr),
    };
  }
}
