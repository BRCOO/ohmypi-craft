import type { ProviderDriver } from '../driver-types.ts';
import { discoverOmpModels } from '../../omp/omp-model-discovery.ts';

export const ompDriver: ProviderDriver = {
  provider: 'omp',
  fetchModels: async ({ hostRuntime, timeoutMs }) => discoverOmpModels({
    rawCommand: process.env.OMP_COMMAND || 'omp',
    cwd: hostRuntime.appRootPath || process.cwd(),
    timeoutMs,
  }),
  buildRuntime: () => ({
    ompCommand: process.env.OMP_COMMAND || 'omp',
  }),
  validateStoredConnection: async () => ({ success: true }),
  testConnection: async () => null,
};
