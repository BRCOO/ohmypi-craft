import { describe, expect, it } from 'bun:test';
import type { Api, Model } from '@earendil-works/pi-ai';

import {
  getPiSupportedThinkingLevels,
  piModelToDefinition,
} from '../models-pi.ts';

function piModel(overrides: Partial<Model<Api>> = {}): Model<Api> {
  return {
    id: 'example-model',
    name: 'Example model',
    api: 'openai-completions',
    provider: 'example',
    baseUrl: 'https://example.invalid/v1',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_000,
    ...overrides,
  };
}

describe('Pi thinking level discovery', () => {
  it("uses Pi's advertised model ceiling and does not invent Craft max", () => {
    const model = piModel({
      thinkingLevelMap: {
        off: null,
        minimal: 'minimal',
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: null,
      },
    });

    expect(getPiSupportedThinkingLevels(model)).toEqual(['minimal', 'low', 'medium', 'high']);
    expect(piModelToDefinition(model).supportedThinkingLevels).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
    ]);
  });

  it('does not advertise thinking for a non-reasoning Pi model', () => {
    const model = piModel({ reasoning: false });

    expect(getPiSupportedThinkingLevels(model)).toBeUndefined();
    const definition = piModelToDefinition(model);
    expect(definition.supportsThinking).toBeFalse();
    expect(definition.supportedThinkingLevels).toBeUndefined();
  });

  it('propagates the SDK image input capability', () => {
    expect(piModelToDefinition(piModel()).supportsImages).toBeFalse();
    expect(piModelToDefinition(piModel({ input: ['text', 'image'] })).supportsImages).toBeTrue();
  });
});
