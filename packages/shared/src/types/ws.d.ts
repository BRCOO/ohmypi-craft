declare module 'ws' {
  import { EventEmitter } from 'node:events'
  import type { IncomingMessage, Server as HttpServer } from 'node:http'
  import type { Server as HttpsServer } from 'node:https'
  import type { AddressInfo } from 'node:net'

  export type RawData = Buffer | ArrayBuffer | Buffer[]

  export interface ClientOptions {
    rejectUnauthorized?: boolean
    headers?: Record<string, string>
  }

  export interface WebSocketServerOptions {
    host?: string
    port?: number
    server?: HttpServer | HttpsServer
    path?: string
  }

  export class WebSocket extends EventEmitter {
    static readonly CONNECTING: 0
    static readonly OPEN: 1
    static readonly CLOSING: 2
    static readonly CLOSED: 3

    readonly CONNECTING: 0
    readonly OPEN: 1
    readonly CLOSING: 2
    readonly CLOSED: 3

    readonly readyState: number

    constructor(address: string | URL, options?: ClientOptions)
    constructor(address: string | URL, protocols?: string | string[], options?: ClientOptions)

    send(data: string | Buffer | ArrayBuffer | Uint8Array): void
    close(code?: number, reason?: string | Buffer): void
    terminate(): void
    ping(data?: string | Buffer): void

    on(event: 'open', listener: () => void): this
    on(event: 'message', listener: (data: RawData, isBinary: boolean) => void): this
    on(event: 'close', listener: (code: number, reason: Buffer) => void): this
    on(event: 'error', listener: (error: Error) => void): this
    on(event: string | symbol, listener: (...args: any[]) => void): this
  }

  export class WebSocketServer extends EventEmitter {
    constructor(options?: WebSocketServerOptions)
    address(): AddressInfo | string | null
    close(callback?: (error?: Error) => void): void

    on(event: 'connection', listener: (socket: WebSocket, request: IncomingMessage) => void): this
    on(event: 'listening', listener: () => void): this
    on(event: 'error', listener: (error: Error) => void): this
    on(event: string | symbol, listener: (...args: any[]) => void): this
  }

  export default WebSocket
}
