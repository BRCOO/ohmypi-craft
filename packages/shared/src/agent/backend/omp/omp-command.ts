export interface ResolvedOmpCommand {
  command: string;
  args: string[];
}

export function resolveOmpCommand(rawCommand: unknown): ResolvedOmpCommand {
  const command = typeof rawCommand === 'string' && rawCommand.trim()
    ? rawCommand.trim()
    : 'omp';

  const quoted = command.match(/^"([^"]+)"(?:\s+(.*))?$/);
  if (quoted?.[1]) {
    return {
      command: quoted[1],
      args: quoted[2] ? quoted[2].split(/\s+/).filter(Boolean) : [],
    };
  }

  const parts = command.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { command, args: [] };
  return { command: parts[0]!, args: parts.slice(1) };
}
