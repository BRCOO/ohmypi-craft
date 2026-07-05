import type { ProviderDriver } from '../driver-types.ts';
import { discoverOmpModels } from '../../omp/omp-model-discovery.ts';
import { getOmpCommandPath } from '../../../../config/storage.ts';

function getConfiguredOmpCommand(): string {
  return getOmpCommandPath() || process.env.OMP_COMMAND || 'omp';
}

export const ompDriver: ProviderDriver = {
  provider: 'omp',
  fetchModels: async ({ hostRuntime, timeoutMs }) => discoverOmpModels({
    rawCommand: getConfiguredOmpCommand(),
    cwd: hostRuntime.appRootPath || process.cwd(),
    timeoutMs,
  }),
  buildRuntime: () => ({
    ompCommand: getConfiguredOmpCommand(),
  }),
  validateStoredConnection: async () => ({ success: true }),
  testConnection: async () => null,
};
