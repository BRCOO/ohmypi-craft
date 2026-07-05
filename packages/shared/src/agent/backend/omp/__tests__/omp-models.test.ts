import { describe, expect, it } from 'bun:test';

import {
  DEFAULT_OMP_CONTEXT_WINDOW,
  normalizeOmpModels,
  resolveOmpServerDefault,
} from '../omp-models.ts';

const rawModels = [
  {
    provider: 'deepseek',
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    contextWindow: 1_000_000,
    reasoning: true,
    input: ['text'],
  },
  {
    provider: 'opencode-go',
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    contextWindow: 0,
    thinking: { mode: 'effort' },
    input: ['text', 'image'],
  },
  {
    provider: 'deepseek',
    id: 'deepseek-v4-flash',
    name: 'Duplicate',
  },
  { provider: '', id: 'invalid' },
  { provider: 'invalid', id: '' },
  null,
];

describe('normalizeOmpModels', () => {
  it('qualifies IDs by OMP provider and keeps cross-provider duplicates distinct', () => {
    const models = normalizeOmpModels(rawModels);

    expect(models.map((model) => model.id)).toEqual([
      'deepseek/deepseek-v4-flash',
      'opencode-go/deepseek-v4-flash',
    ]);
    expect(models[0]?.name).toBe('DeepSeek V4 Flash · deepseek');
    expect(models[0]?.provider).toBe('omp');
  });

  it('maps context, thinking, and image capabilities with safe fallbacks', () => {
    const models = normalizeOmpModels(rawModels);

    expect(models[0]).toMatchObject({
      contextWindow: 1_000_000,
      supportsThinking: true,
      supportsImages: false,
    });
    expect(models[1]).toMatchObject({
      contextWindow: DEFAULT_OMP_CONTEXT_WINDOW,
      supportsThinking: true,
      supportsImages: true,
    });
  });

  it('returns an empty list for non-array RPC data', () => {
    expect(normalizeOmpModels(undefined)).toEqual([]);
    expect(normalizeOmpModels({ models: rawModels })).toEqual([]);
  });
});

describe('resolveOmpServerDefault', () => {
  it('uses the current OMP state model when it exists in the list', () => {
    const models = normalizeOmpModels(rawModels);
    expect(resolveOmpServerDefault(models, {
      model: { provider: 'opencode-go', id: 'deepseek-v4-flash' },
    })).toBe('opencode-go/deepseek-v4-flash');
  });

  it('falls back to the first normalized model', () => {
    const models = normalizeOmpModels(rawModels);
    expect(resolveOmpServerDefault(models, {
      model: { provider: 'missing', id: 'model' },
    })).toBe('deepseek/deepseek-v4-flash');
  });
});
