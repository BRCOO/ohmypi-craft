import { beforeEach, describe, expect, it } from 'bun:test'
import type { OmpFeatureCenterStateDto } from '../../../shared/types'
import {
  clearOmpFeatureCenterStateCacheForTests,
  getCachedOmpFeatureCenterState,
  invalidateOmpFeatureCenterState,
  loadCachedOmpFeatureCenterState,
  publishOmpFeatureCenterState,
} from '../omp-feature-center-state'

function stateFor(label: string): OmpFeatureCenterStateDto {
  return { lastRefreshedAt: label.length } as OmpFeatureCenterStateDto
}

beforeEach(() => {
  clearOmpFeatureCenterStateCacheForTests()
})

describe('OMP Feature Center state cache', () => {
  it('isolates cached state by workspace', () => {
    const first = stateFor('first')
    const second = stateFor('second')
    publishOmpFeatureCenterState('workspace-a', first)
    publishOmpFeatureCenterState('workspace-b', second)

    expect(getCachedOmpFeatureCenterState('workspace-a')).toBe(first)
    expect(getCachedOmpFeatureCenterState('workspace-b')).toBe(second)
  })

  it('deduplicates concurrent loads for the same workspace', async () => {
    const state = stateFor('loaded')
    let calls = 0
    const loader = async () => {
      calls += 1
      await Promise.resolve()
      return state
    }

    const [first, second] = await Promise.all([
      loadCachedOmpFeatureCenterState('workspace-a', loader),
      loadCachedOmpFeatureCenterState('workspace-a', loader),
    ])

    expect(calls).toBe(1)
    expect(first).toBe(state)
    expect(second).toBe(state)
  })

  it('invalidates only the requested workspace', () => {
    publishOmpFeatureCenterState('workspace-a', stateFor('first'))
    publishOmpFeatureCenterState('workspace-b', stateFor('second'))

    invalidateOmpFeatureCenterState('workspace-a')

    expect(getCachedOmpFeatureCenterState('workspace-a')).toBeNull()
    expect(getCachedOmpFeatureCenterState('workspace-b')).not.toBeNull()
  })

  it('does not let a stale pending load overwrite explicitly published state', async () => {
    let resolveLoad: ((state: OmpFeatureCenterStateDto) => void) | undefined
    const pending = loadCachedOmpFeatureCenterState('workspace-a', () => new Promise((resolve) => {
      resolveLoad = resolve
    }))
    const fresh = stateFor('fresh-state')
    const stale = stateFor('old')

    publishOmpFeatureCenterState('workspace-a', fresh)
    resolveLoad?.(stale)
    await pending

    expect(getCachedOmpFeatureCenterState('workspace-a')).toBe(fresh)
  })
})
