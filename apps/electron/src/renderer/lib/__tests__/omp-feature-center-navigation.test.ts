import { beforeEach, describe, expect, it } from 'bun:test'
import {
  clearPendingOmpFeatureCenterSectionForTests,
  consumePendingOmpFeatureCenterSection,
  requestOmpFeatureCenterSection,
} from '../omp-feature-center-navigation'

beforeEach(() => {
  clearPendingOmpFeatureCenterSectionForTests()
})

describe('OMP Feature Center section navigation', () => {
  it('keeps a requested section until the settings page consumes it', () => {
    requestOmpFeatureCenterSection('mcp')

    expect(consumePendingOmpFeatureCenterSection()).toBe('mcp')
    expect(consumePendingOmpFeatureCenterSection()).toBeNull()
  })

  it('keeps only the latest requested section', () => {
    requestOmpFeatureCenterSection('skills')
    requestOmpFeatureCenterSection('models')

    expect(consumePendingOmpFeatureCenterSection()).toBe('models')
  })
})
