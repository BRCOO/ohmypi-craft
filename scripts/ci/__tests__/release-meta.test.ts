import { describe, expect, it } from 'bun:test'
import {
  computeReleaseMeta,
  normalizeReleaseTag,
  versionFromTag,
} from '../release-meta'

describe('release-meta', () => {
  it('normalizes tags with and without v prefix', () => {
    expect(normalizeReleaseTag('0.10.5')).toBe('v0.10.5')
    expect(normalizeReleaseTag('v0.10.5')).toBe('v0.10.5')
  })

  it('extracts version from tag', () => {
    expect(versionFromTag('v0.10.5')).toBe('0.10.5')
  })

  it('marks tag pushes as releases when version matches package', () => {
    const version = computeReleaseMeta({
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: 'abcdef0123456789',
      GITHUB_EVENT_NAME: 'push',
    }).version
    const meta = computeReleaseMeta({
      GITHUB_REF: `refs/tags/v${version}`,
      GITHUB_SHA: 'abcdef0123456789',
      GITHUB_EVENT_NAME: 'push',
    })
    expect(meta.short_sha).toBe('abcdef012345')
    expect(meta.commit).toBe('abcdef0123456789')
    expect(meta.is_release).toBe(true)
    expect(meta.tag_name).toBe(`v${version}`)
  })

  it('rejects tag that does not match package version', () => {
    expect(() =>
      computeReleaseMeta({
        GITHUB_REF: 'refs/tags/v0.0.0-not-a-real-version',
        GITHUB_SHA: 'abcdef0123456789',
        GITHUB_EVENT_NAME: 'push',
      }),
    ).toThrow(/does not match/)
  })

  it('treats main branch push as artifact-only', () => {
    const meta = computeReleaseMeta({
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: '1234567890ab',
      GITHUB_EVENT_NAME: 'push',
    })
    expect(meta.is_release).toBe(false)
    expect(meta.tag_name).toBe('')
    expect(meta.trigger).toBe('push')
  })

  it('allows workflow_dispatch release when tag matches version', () => {
    const version = computeReleaseMeta({
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: '1234567890ab',
      GITHUB_EVENT_NAME: 'push',
    }).version

    const meta = computeReleaseMeta({
      GITHUB_REF: 'refs/heads/codex/omp-rpc-backend',
      GITHUB_SHA: '1234567890ab',
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      INPUT_RELEASE_TAG: `v${version}`,
    })
    expect(meta.is_release).toBe(true)
    expect(meta.tag_name).toBe(`v${version}`)
  })
})
