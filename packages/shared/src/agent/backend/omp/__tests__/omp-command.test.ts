import { describe, expect, it } from 'bun:test';

import { resolveOmpCommand, resolveOmpRuntimeCommand } from '../omp-command.ts';

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

  it('preserves an unquoted Windows executable path with spaces', () => {
    expect(resolveOmpCommand('C:\\Program Files\\OMP\\omp.exe --profile local')).toEqual({
      command: 'C:\\Program Files\\OMP\\omp.exe',
      args: ['--profile', 'local'],
    });
  });

  it('reports command source priority for runtime diagnostics', () => {
    expect(resolveOmpRuntimeCommand({
      configuredCommand: ' C:\\Tools\\omp.exe ',
      envCommand: 'omp-from-env',
    })).toEqual({
      command: 'C:\\Tools\\omp.exe',
      args: [],
      rawCommand: 'C:\\Tools\\omp.exe',
      source: 'config',
    });

    expect(resolveOmpRuntimeCommand({
      configuredCommand: '',
      envCommand: 'omp-from-env',
    }).source).toBe('env');

    expect(resolveOmpRuntimeCommand({
      configuredCommand: '',
      envCommand: '',
    }).source).toBe('default');
  });
});
