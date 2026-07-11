import type { ProviderDriver } from '../driver-types.ts';
import { discoverOmpModels } from '../../omp/omp-model-discovery.ts';
import { probeOmpAuth, type OmpAuthProbeResult } from '../../omp/omp-auth-probe.ts';
import { resolveBundledOmpCommand, resolveOmpRuntimeCommand } from '../../omp/omp-command.ts';
import { getOmpCommandPath } from '../../../../config/storage.ts';

function resolveOmpCommandForHost(hostRuntime: Parameters<ProviderDriver['buildRuntime']>[0]['hostRuntime']): string {
  return resolveOmpRuntimeCommand({
    configuredCommand: getOmpCommandPath(),
    envCommand: process.env.OMP_COMMAND,
    bundledCommand: resolveBundledOmpCommand(hostRuntime),
  }).rawCommand;
}

function probeResultToValidation(
  result: OmpAuthProbeResult,
): { success: boolean; error?: string; shouldRefreshModels?: boolean } {
  if (!result.success) {
    return {
      success: false,
      error: result.message,
      shouldRefreshModels: result.errorCode === 'no_providers',
    };
  }

  const authenticatedCount = result.providers?.filter(p => p.authenticated).length ?? 0;
  const availableCount = result.providers?.filter(p => p.available).length ?? 0;

  if (availableCount === 0) {
    return {
      success: false,
      error: result.providers && result.providers.length > 0
        ? 'No OMP providers are currently available. Check your OMP configuration.'
        : 'OMP returned no providers. Configure a provider in OMP first.',
    };
  }

  if (authenticatedCount === 0) {
    return {
      success: false,
      error: 'No OMP provider is authenticated. Log in through onboarding or settings.',
    };
  }

  return { success: true, shouldRefreshModels: true };
}

export const ompDriver: ProviderDriver = {
  provider: 'omp',
  fetchModels: async ({ hostRuntime, timeoutMs }) => discoverOmpModels({
    rawCommand: resolveOmpCommandForHost(hostRuntime),
    cwd: hostRuntime.appRootPath || process.cwd(),
    timeoutMs,
  }),
  buildRuntime: ({ hostRuntime }) => ({
    ompCommand: resolveOmpCommandForHost(hostRuntime),
  }),
  validateStoredConnection: async ({ hostRuntime }) => {
    const result = await probeOmpAuth({
      rawCommand: resolveOmpCommandForHost(hostRuntime),
      cwd: hostRuntime.appRootPath || process.cwd(),
      timeoutMs: 15_000,
    });
    return probeResultToValidation(result);
  },
  testConnection: async ({ hostRuntime, timeoutMs }) => {
    const result = await probeOmpAuth({
      rawCommand: resolveOmpCommandForHost(hostRuntime),
      cwd: hostRuntime.appRootPath || process.cwd(),
      timeoutMs: timeoutMs ?? 15_000,
    });
    const validation = probeResultToValidation(result);
    if (validation.success) return null;
    return { success: false, error: validation.error };
  },
};
