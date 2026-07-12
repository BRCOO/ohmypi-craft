import { describe, expect, it } from 'bun:test'
import { hasWindowsSigningCredentials } from '../signing'

describe('hasWindowsSigningCredentials', () => {
  it('returns false when no signing env is set', () => {
    expect(hasWindowsSigningCredentials({})).toBe(false)
  })

  it('detects CSC_NAME', () => {
    expect(hasWindowsSigningCredentials({ CSC_NAME: 'Oh My Pi Codesign' })).toBe(true)
  })

  it('detects WIN_CSC_LINK base64-style payload', () => {
    expect(hasWindowsSigningCredentials({
      WIN_CSC_LINK: 'A'.repeat(250),
    })).toBe(true)
  })

  it('detects CSC_LINK file path that exists', () => {
    expect(hasWindowsSigningCredentials({
      CSC_LINK: process.execPath,
    })).toBe(true)
  })

  it('rejects missing file path credentials', () => {
    expect(hasWindowsSigningCredentials({
      CSC_LINK: 'C:\\definitely\\missing\\cert.pfx',
    })).toBe(false)
  })
})
