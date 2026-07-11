import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createSmokeContext,
  parseHeadlessInfo,
  waitForHeadlessInfo,
  waitForSessionEvents,
  type RunnerOptions,
  type SmokeContext,
} from '../helpers.ts'
import { CliRpcClient } from '../../../apps/cli/src/client.ts'

describe('parseHeadlessInfo', () => {
  it('extracts url and token from a key=value file', () => {
    const raw = 'CRAFT_SERVER_URL=ws://localhost:1234\nCRAFT_SERVER_TOKEN=secret-token\n'
    const info = parseHeadlessInfo(raw)
    expect(info.url).toBe('ws://localhost:1234')
    expect(info.token).toBe('secret-token')
  })

  it('handles CRLF line endings', () => {
    const raw = 'CRAFT_SERVER_URL=ws://localhost:1234\r\nCRAFT_SERVER_TOKEN=secret-token\r\n'
    const info = parseHeadlessInfo(raw)
    expect(info.url).toBe('ws://localhost:1234')
    expect(info.token).toBe('secret-token')
  })

  it('throws when url is missing', () => {
    expect(() => parseHeadlessInfo('CRAFT_SERVER_TOKEN=secret\n')).toThrow()
  })

  it('throws when token is missing', () => {
    expect(() => parseHeadlessInfo('CRAFT_SERVER_URL=ws://localhost:1234\n')).toThrow()
  })
})

describe('waitForHeadlessInfo', () => {
  it('waits for a file to appear and parses it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'smoke-test-'))
    const file = join(dir, 'headless.env')
    writeFileSync(file, 'CRAFT_SERVER_URL=ws://localhost:9999\nCRAFT_SERVER_TOKEN=tok\n')

    const info = await waitForHeadlessInfo(file, 2_000)
    expect(info.url).toBe('ws://localhost:9999')
    expect(info.token).toBe('tok')

    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects when the file never appears', async () => {
    const file = join(tmpdir(), `smoke-test-missing-${Date.now()}.env`)
    await expect(waitForHeadlessInfo(file, 500)).rejects.toThrow('Timed out waiting')
  })
})

describe('createSmokeContext', () => {
  it('creates isolated temp directories', async () => {
    const ctx = await createSmokeContext('/dummy/exe.exe')
    expect(ctx.runRoot).toContain('.tmp')
    expect(ctx.runRoot).toContain('smoke-')
    expect(ctx.configDir.startsWith(ctx.runRoot)).toBe(true)
    expect(ctx.workspaceDir.startsWith(ctx.runRoot)).toBe(true)
    expect(ctx.logsDir.startsWith(ctx.runRoot)).toBe(true)
    expect(ctx.screenshotsDir.startsWith(ctx.runRoot)).toBe(true)
    rmSync(ctx.runRoot, { recursive: true, force: true })
  })
})

describe('waitForSessionEvents', () => {
  function makeMockClient(events: Array<{ type: string; sessionId: string }>): CliRpcClient {
    return {
      on: (channel: string, cb: (...args: unknown[]) => void) => {
        let index = 0
        const dispatch = () => {
          if (index < events.length) {
            const ev = events[index++]
            cb(ev as unknown)
            setTimeout(dispatch, 5)
          }
        }
        setTimeout(dispatch, 5)
        return () => {}
      },
    } as unknown as CliRpcClient
  }

  it('resolves when predicate matches', async () => {
    const client = makeMockClient([
      { type: 'text_delta', sessionId: 's1' },
      { type: 'complete', sessionId: 's1' },
    ])

    const result = await waitForSessionEvents(
      client,
      's1',
      ev => String(ev.type) === 'complete',
      1_000,
    )
    expect(result.matchedEvent?.type).toBe('complete')
    expect(result.seenTypes).toContain('text_delta')
  })

  it('resolves with null when timeout expires without match', async () => {
    const client = makeMockClient([
      { type: 'text_delta', sessionId: 's1' },
    ])

    const result = await waitForSessionEvents(
      client,
      's1',
      ev => String(ev.type) === 'complete',
      100,
    )
    expect(result.matchedEvent).toBeNull()
    expect(result.seenTypes).toContain('text_delta')
  })

  it('ignores events for other sessions', async () => {
    const client = makeMockClient([
      { type: 'complete', sessionId: 'other' },
      { type: 'complete', sessionId: 's1' },
    ])

    const result = await waitForSessionEvents(
      client,
      's1',
      ev => String(ev.type) === 'complete',
      1_000,
    )
    expect(result.seenTypes).toContain('complete')
  })
})
