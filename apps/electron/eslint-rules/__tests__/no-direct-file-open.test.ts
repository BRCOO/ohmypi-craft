import { describe, expect, it } from 'bun:test'
import { Linter } from 'eslint'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const rule = require('../no-direct-file-open.cjs')

function runRule(filename: string) {
  const linter = new Linter({ configType: 'eslintrc' })
  linter.defineRule('craft-links/no-direct-file-open', rule)

  return linter.verify(
    'window.electronAPI.openFile(path)',
    {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      rules: {
        'craft-links/no-direct-file-open': 'error',
      },
    },
    { filename },
  )
}

describe('no-direct-file-open', () => {
  it('allows the App composition root with a Windows path', () => {
    expect(runRule('D:\\repo\\apps\\electron\\src\\renderer\\App.tsx')).toHaveLength(0)
  })

  it('allows the App composition root with a POSIX path', () => {
    expect(runRule('/repo/apps/electron/src/renderer/App.tsx')).toHaveLength(0)
  })

  it('still rejects direct file opens in ordinary renderer components', () => {
    const messages = runRule('D:\\repo\\apps\\electron\\src\\renderer\\ChatPage.tsx')
    expect(messages).toHaveLength(1)
    expect(messages[0]?.messageId).toBe('noDirectFileOpen')
  })
})
