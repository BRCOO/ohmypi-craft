import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { CLIENT_OPEN_EXTERNAL, type HandlerFn, type RequestContext, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { registerSessionsHandlers } from './sessions'

function createHarness() {
  const handlers = new Map<string, HandlerFn>()
  const invokeClientCalls: Array<{ clientId: string; channel: string; args: unknown[] }> = []
  const openExternalCalls: string[] = []
  const loginCalls: Array<{ sessionId: string; providerId: string }> = []

  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push() {},
    async invokeClient(clientId, channel, ...args) {
      invokeClientCalls.push({ clientId, channel, args })
      return undefined
    },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }

  const deps: HandlerDeps = {
    sessionManager: {
      async loginOmpProvider(
        sessionId: string,
        providerId: string,
        onOpenUrl?: (payload: { url?: string; launchUrl?: string; instructions?: string }) => void,
      ) {
        loginCalls.push({ sessionId, providerId })
        onOpenUrl?.({ url: 'https://omp.example/login' })
        return { success: true, providerId, openUrl: 'https://omp.example/login' }
      },
    } as unknown as HandlerDeps['sessionManager'],
    oauthFlowStore: {} as HandlerDeps['oauthFlowStore'],
    platform: {
      appRootPath: '/',
      resourcesPath: '/',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
      imageProcessor: {
        getMetadata: async () => null,
        process: async () => Buffer.from(''),
      },
      openExternal: async (url: string) => {
        openExternalCalls.push(url)
      },
    },
  }

  registerSessionsHandlers(server, deps)

  const command = handlers.get(RPC_CHANNELS.sessions.COMMAND)
  if (!command) throw new Error('sessions.COMMAND handler not registered')

  const ctx: RequestContext = {
    clientId: 'client-1',
    workspaceId: 'workspace-1',
    webContentsId: 101,
  }

  return {
    command,
    ctx,
    invokeClientCalls,
    openExternalCalls,
    loginCalls,
  }
}

describe('registerSessionsHandlers OMP login command', () => {
  it('opens OMP login URLs through the calling client', async () => {
    const { command, ctx, invokeClientCalls, openExternalCalls, loginCalls } = createHarness()

    const result = await command(ctx, 'session-1', {
      type: 'loginOmpProvider',
      providerId: 'deepseek',
    })

    expect(result).toEqual({
      success: true,
      providerId: 'deepseek',
      openUrl: 'https://omp.example/login',
    })
    expect(loginCalls).toEqual([{ sessionId: 'session-1', providerId: 'deepseek' }])
    expect(invokeClientCalls).toEqual([{
      clientId: 'client-1',
      channel: CLIENT_OPEN_EXTERNAL,
      args: ['https://omp.example/login'],
    }])
    expect(openExternalCalls).toEqual([])
  })
})
