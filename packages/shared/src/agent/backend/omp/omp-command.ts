export interface ResolvedOmpCommand {
  command: string;
  args: string[];
}

export type OmpCommandSource = 'config' | 'env' | 'bundled' | 'default';

export interface ResolvedOmpRuntimeCommand extends ResolvedOmpCommand {
  rawCommand: string;
  source: OmpCommandSource;
}

export interface ResolveOmpRuntimeCommandOptions {
  configuredCommand?: unknown;
  envCommand?: unknown;
  bundledCommand?: unknown;
  defaultCommand?: string;
}

function cleanCommand(rawCommand: unknown): string | null {
  if (typeof rawCommand !== 'string') return null;
  const trimmed = rawCommand.trim();
  return trimmed ? trimmed : null;
}

function splitArgs(rawArgs: string | undefined): string[] {
  return rawArgs?.split(/\s+/).filter(Boolean) ?? [];
}

function parseOmpCommand(rawCommand: string): ResolvedOmpCommand {
  const command = rawCommand.trim();

  const quoted = command.match(/^"([^"]+)"(?:\s+(.*))?$/);
  if (quoted?.[1]) {
    return {
      command: quoted[1],
      args: splitArgs(quoted[2]),
    };
  }

  // File-dialog selections on Windows normally persist an unquoted path such as:
  // C:\Program Files\Oh My Pi\omp.exe. Treat executable-looking absolute paths
  // as a single command before falling back to shell-like whitespace splitting.
  const windowsExecutable = command.match(/^([a-zA-Z]:\\.+?\.(?:exe|cmd|bat|ps1))(?:\s+(.*))?$/i);
  if (windowsExecutable?.[1]) {
    return {
      command: windowsExecutable[1],
      args: splitArgs(windowsExecutable[2]),
    };
  }

  const parts = command.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { command, args: [] };
  return { command: parts[0]!, args: parts.slice(1) };
}

export function resolveOmpCommand(rawCommand: unknown): ResolvedOmpCommand {
  return parseOmpCommand(cleanCommand(rawCommand) ?? 'omp');
}

/**
 * Locate the single-file OMP executable shipped next to the Electron app.
 * Explicit user configuration and OMP_COMMAND remain higher-priority overrides.
 */
export function resolveBundledOmpCommand(hostRuntime: BackendHostRuntimeContext): string | undefined {
  if (!hostRuntime.isPackaged) return undefined;

  const platformKey = `${process.platform}-${process.arch}`;
  const executable = process.platform === 'win32' ? 'omp.exe' : 'omp';
  const candidates = [
    hostRuntime.resourcesPath ? join(hostRuntime.resourcesPath, 'omp', platformKey, executable) : undefined,
    join(hostRuntime.appRootPath, 'resources', 'omp', platformKey, executable),
    join(hostRuntime.appRootPath, 'dist', 'resources', 'omp', platformKey, executable),
  ].filter((candidate): candidate is string => !!candidate);

  return candidates.find(candidate => existsSync(candidate));
}

export function resolveOmpRuntimeCommand(
  options: ResolveOmpRuntimeCommandOptions = {},
): ResolvedOmpRuntimeCommand {
  const configured = cleanCommand(options.configuredCommand);
  const env = cleanCommand(options.envCommand);
  const bundled = cleanCommand(options.bundledCommand);
  const rawCommand = configured ?? env ?? bundled ?? options.defaultCommand ?? 'omp';
  const source: OmpCommandSource = configured ? 'config' : env ? 'env' : bundled ? 'bundled' : 'default';

  return {
    ...parseOmpCommand(rawCommand),
    rawCommand,
    source,
  };
}
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { BackendHostRuntimeContext } from '../types.ts';
