import type {
  LlmConnection,
  ModelFetcher,
  ModelFetcherCredentials,
  ModelFetchResult,
} from '@craft-agent/shared/config';
import { fetchBackendModels } from '@craft-agent/shared/agent/backend';
import { getHostRuntime, handlerLog } from './runtime';

const OMP_DISCOVERY_TIMEOUT_MS = 15_000;

export class OmpModelFetcher implements ModelFetcher {
  readonly refreshIntervalMs = 0;

  async fetchModels(
    connection: LlmConnection,
    credentials: ModelFetcherCredentials,
  ): Promise<ModelFetchResult> {
    const result = await fetchBackendModels({
      connection,
      credentials,
      timeoutMs: OMP_DISCOVERY_TIMEOUT_MS,
      hostRuntime: getHostRuntime(),
    });

    handlerLog.info(`Fetched ${result.models.length} OMP models`);
    return result;
  }
}
