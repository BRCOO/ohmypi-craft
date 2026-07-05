import { describe, expect, it } from 'bun:test'

import { MODEL_FETCHERS } from './registry'
import { OmpModelFetcher } from './omp'

describe('OMP model fetcher registration', () => {
  it('registers a non-periodic OMP model fetcher', () => {
    expect(MODEL_FETCHERS.omp).toBeInstanceOf(OmpModelFetcher)
    expect(MODEL_FETCHERS.omp.refreshIntervalMs).toBe(0)
  })
})
