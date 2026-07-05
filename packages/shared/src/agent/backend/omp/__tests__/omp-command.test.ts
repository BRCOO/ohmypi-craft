import { describe, expect, it } from 'bun:test';

import { resolveOmpCommand } from '../omp-command.ts';

describe('resolveOmpCommand', () => {
  it('uses the default OMP command for empty values', () => {
    expect(resolveOmpCommand(undefined)).toEqual({ command: 'omp', args: [] });
    expect(resolveOmpCommand('  ')).toEqual({ command: 'omp', args: [] });
  });

  it('preserves a quoted Windows executable path and parses trailing arguments', () => {
    expect(resolveOmpCommand('"C:\\Program Files\\OMP\\omp.exe" --profile local')).toEqual({
      command: 'C:\\Program Files\\OMP\\omp.exe',
      args: ['--profile', 'local'],
    });
  });

  it('parses an unquoted command with arguments', () => {
    expect(resolveOmpCommand('omp --profile local')).toEqual({
      command: 'omp',
      args: ['--profile', 'local'],
    });
  });
});
