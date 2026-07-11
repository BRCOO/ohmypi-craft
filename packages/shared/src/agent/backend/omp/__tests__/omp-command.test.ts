import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveBundledOmpCommand, resolveOmpCommand, resolveOmpRuntimeCommand } from '../omp-command.ts';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

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
      bundledCommand: 'C:\\Oh My Pi\\omp.exe',
    })).toEqual({
      command: 'C:\\Oh My Pi\\omp.exe',
      args: [],
      rawCommand: 'C:\\Oh My Pi\\omp.exe',
      source: 'bundled',
    });

    expect(resolveOmpRuntimeCommand({
      configuredCommand: '',
      envCommand: '',
      bundledCommand: '',
    }).source).toBe('default');
  });

  it('resolves the packaged platform runtime when it is present', async () => {
    const resourcesPath = await mkdtemp(join(tmpdir(), 'omp-runtime-'));
    temporaryRoots.push(resourcesPath);
    const executable = process.platform === 'win32' ? 'omp.exe' : 'omp';
    const bundled = join(resourcesPath, 'omp', `${process.platform}-${process.arch}`, executable);
    await mkdir(join(resourcesPath, 'omp', `${process.platform}-${process.arch}`), { recursive: true });
    await writeFile(bundled, 'omp');

    expect(resolveBundledOmpCommand({
      appRootPath: resourcesPath,
      resourcesPath,
      isPackaged: true,
    })).toBe(bundled);
  });
});
