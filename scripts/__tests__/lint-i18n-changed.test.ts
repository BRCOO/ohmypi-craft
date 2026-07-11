import { describe, expect, it } from 'bun:test'
import {
  changedTypescriptFiles,
  resolveI18nChangeBase,
} from '../lint-i18n-changed'

describe('resolveI18nChangeBase', () => {
  it('uses working-tree-vs-HEAD in developer mode', () => {
    const result = resolveI18nChangeBase({ CI: undefined, I18N_BASE_REF: undefined })
    expect(result.mode).toBe('developer')
    expect(result.diffRange).toBe('HEAD')
  })

  it('prefers I18N_BASE_REF with triple-dot range in CI', () => {
    const result = resolveI18nChangeBase({
      CI: 'true',
      I18N_BASE_REF: 'origin/main',
    })
    expect(result.mode).toBe('ci')
    expect(result.diffRange).toBe('origin/main...HEAD')
    expect(result.description).toContain('I18N_BASE_REF')
  })

  it('computes merge-base from GITHUB_BASE_REF when I18N_BASE_REF is unset', () => {
    const result = resolveI18nChangeBase(
      {
        CI: '1',
        GITHUB_BASE_REF: 'main',
      },
      {
        mergeBase: (ref) => {
          expect(ref).toBe('origin/main')
          return 'abc123mergebase'
        },
      },
    )
    expect(result.mode).toBe('ci')
    expect(result.diffRange).toBe('abc123mergebase...HEAD')
    expect(result.description).toContain('merge-base')
  })

  it('accepts GitLab target branch env for merge-base', () => {
    const result = resolveI18nChangeBase(
      {
        CI: 'true',
        CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'develop',
      },
      {
        mergeBase: (ref) => {
          expect(ref).toBe('origin/develop')
          return 'deadbeef'
        },
      },
    )
    expect(result.diffRange).toBe('deadbeef...HEAD')
  })

  it('fails in CI when no baseline can be resolved', () => {
    expect(() =>
      resolveI18nChangeBase({
        CI: 'true',
      }),
    ).toThrow(/explicit merge baseline/)
    expect(() =>
      resolveI18nChangeBase({
        CI: 'true',
      }),
    ).toThrow(/HEAD~1/)
  })

  it('does not silently fall back to HEAD~1 in CI', () => {
    try {
      resolveI18nChangeBase({ CI: 'true' })
      throw new Error('expected resolveI18nChangeBase to throw')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message).not.toContain('diffRange')
      expect(message).toMatch(/Refusing to fall back to HEAD~1/)
    }
  })
})

describe('changedTypescriptFiles', () => {
  it('filters to TS/TSX and covers multi-file ranges', () => {
    const files = changedTypescriptFiles('base...HEAD', {
      gitDiff: () =>
        [
          'packages/shared/src/foo.ts',
          'apps/electron/src/bar.tsx',
          'README.md',
          'scripts/lint-i18n-changed.ts',
          '',
        ].join('\n'),
    })
    expect(files).toEqual([
      'packages/shared/src/foo.ts',
      'apps/electron/src/bar.tsx',
      'scripts/lint-i18n-changed.ts',
    ])
  })

  it('returns empty list when the merge-base range has no TS changes', () => {
    const files = changedTypescriptFiles('abc...HEAD', {
      gitDiff: () => 'docs/readme.md\n',
    })
    expect(files).toEqual([])
  })
})
