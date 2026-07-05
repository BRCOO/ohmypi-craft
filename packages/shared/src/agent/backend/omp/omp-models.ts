import type { ModelDefinition } from '../../../config/models.ts';

export const DEFAULT_OMP_CONTEXT_WINDOW = 128_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function contextWindow(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_OMP_CONTEXT_WINDOW;
}

export function normalizeOmpModels(rawModels: unknown): ModelDefinition[] {
  if (!Array.isArray(rawModels)) return [];

  const seen = new Set<string>();
  const models: ModelDefinition[] = [];

  for (const rawModel of rawModels) {
    if (!isRecord(rawModel)) continue;

    const provider = nonEmptyString(rawModel.provider);
    const rawId = nonEmptyString(rawModel.id);
    if (!provider || !rawId) continue;

    const id = `${provider}/${rawId}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const baseName = nonEmptyString(rawModel.name) ?? rawId;
    const input = Array.isArray(rawModel.input) ? rawModel.input : [];

    models.push({
      id,
      name: `${baseName} · ${provider}`,
      shortName: baseName,
      description: `OMP model via ${provider}`,
      provider: 'omp',
      contextWindow: contextWindow(rawModel.contextWindow),
      supportsThinking: rawModel.reasoning === true || rawModel.thinking != null,
      supportsImages: input.includes('image'),
    });
  }

  return models;
}

export function resolveOmpServerDefault(
  models: readonly ModelDefinition[],
  rawState: unknown,
): string | undefined {
  if (isRecord(rawState) && isRecord(rawState.model)) {
    const provider = nonEmptyString(rawState.model.provider);
    const rawId = nonEmptyString(rawState.model.id);
    if (provider && rawId) {
      const candidate = `${provider}/${rawId}`;
      if (models.some((model) => model.id === candidate)) return candidate;
    }
  }

  return models[0]?.id;
}
