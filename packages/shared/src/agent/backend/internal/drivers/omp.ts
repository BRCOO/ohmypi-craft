import type { ProviderDriver } from '../driver-types.ts';

export const ompDriver: ProviderDriver = {
  provider: 'omp',
  buildRuntime: () => ({
    ompCommand: process.env.OMP_COMMAND || 'omp',
  }),
  validateStoredConnection: async () => ({ success: true }),
  testConnection: async () => null,
};
