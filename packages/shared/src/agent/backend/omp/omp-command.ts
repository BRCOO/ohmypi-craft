export interface ResolvedOmpCommand {
  command: string;
  args: string[];
}

export type OmpCommandSource = 'config' | 'env' | 'default';

export interface ResolvedOmpRuntimeCommand extends ResolvedOmpCommand {
  rawCommand: string;
  source: OmpCommandSource;
}

export interface ResolveOmpRuntimeCommandOptions {
  configuredCommand?: unknown;
  envCommand?: unknown;
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

export function resolveOmpRuntimeCommand(
  options: ResolveOmpRuntimeCommandOptions = {},
): ResolvedOmpRuntimeCommand {
  const configured = cleanCommand(options.configuredCommand);
  const env = cleanCommand(options.envCommand);
  const rawCommand = configured ?? env ?? options.defaultCommand ?? 'omp';
  const source: OmpCommandSource = configured ? 'config' : env ? 'env' : 'default';

  return {
    ...parseOmpCommand(rawCommand),
    rawCommand,
    source,
  };
}
