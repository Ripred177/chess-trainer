import { EventEmitter } from 'node:events'
import { networkInterfaces } from 'node:os'
import { WebSocketServer, WebSocket } from 'ws'
import { Advertiser } from './discovery.js'
import type { NetMessage, NetRole, NetStatus, TimeControl } from '../shared/types.js'

/**
 * Peer-to-peer play over a local network.
 *
 * One player hosts and the other connects to their address. There is no
 * matchmaking service and nothing leaves the two machines involved.
 *
 * The transport is WebSocket rather than a raw socket purely so the same
 * protocol can later point at a hosted relay instead of a peer: swapping the
 * address is then the whole change, because a relay speaks the same frames.
 */

export const DEFAULT_PORT = 27520

/** Heartbeat interval; a peer that misses two is considered gone. */
const PING_MS = 5000
const PING_TIMEOUT_MS = 12_000

/** Protocol version. Peers refuse to play across a mismatch. */
export const PROTOCOL_VERSION = 1

export interface HostOptions {
  port: number
  displayName: string
  /** Colour the host takes; the guest gets the other. */
  hostColor: 'w' | 'b' | 'random'
  timeControl: TimeControl
}

export interface JoinOptions {
  /** Host address: `1.2.3.4`, `1.2.3.4:27520`, or a full ws:// URL. */
  address: string
  displayName: string
}

/**
 * Turn whatever the player typed into a WebSocket URL.
 *
 * Accepting a bare IP is the point — nobody wants to type a scheme — but a
 * full URL has to keep working so a relay can be pointed at later.
 */
export function toWebSocketUrl(address: string, defaultPort = DEFAULT_PORT): string {
  const trimmed = address.trim()
  if (!trimmed) throw new Error('No address given')
  if (/^wss?:\/\//i.test(trimmed)) return trimmed

  // Bracketed IPv6, with or without a port.
  if (trimmed.startsWith('[')) return `ws://${trimmed.includes(']:') ? trimmed : `${trimmed}:${defaultPort}`}`

  // A bare IPv6 address has several colons, so it must be bracketed before a
  // port can be appended unambiguously.
  const colons = (trimmed.match(/:/g) ?? []).length
  if (colons > 1) return `ws://[${trimmed}]:${defaultPort}`

  return `ws://${trimmed.includes(':') ? trimmed : `${trimmed}:${defaultPort}`}`
}

/** LAN addresses this machine can be reached on, for the host to read out. */
export function localAddresses(): string[] {
  const out: string[] = []
  for (const [, addrs] of Object.entries(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.internal) continue
      if (addr.family !== 'IPv4') continue
      out.push(addr.address)
    }
  }
  // Prefer private ranges; a VPN or virtual adapter often lists first otherwise.
  return out.sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)))
}

function isPrivate(ip: string): boolean {
  return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
}

/**
 * One peer connection, whether we opened it or accepted it.
 *
 * Emits `status`, `message`, and `error`. Exactly one peer is supported at a
 * time; a second inbound connection is refused rather than queued, so a
 * stranger on the network cannot interrupt a game in progress.
 */
export class NetPlay extends EventEmitter {
  private server: WebSocketServer | null = null
  private socket: WebSocket | null = null
  private role: NetRole = 'idle'
  private status: NetStatus = { role: 'idle', state: 'offline' }
  private pingTimer: NodeJS.Timeout | null = null
  private lastPong = 0
  /** Announces the game on the LAN while it is waiting for an opponent. */
  private advertiser = new Advertiser()
  /** Retained so advertising can resume if a peer disconnects. */
  private hostOptions: { name: string; port: number; timeControl: TimeControl } | null = null

  getStatus(): NetStatus {
    return this.status
  }

  private setStatus(patch: Partial<NetStatus>): void {
    this.status = { ...this.status, ...patch, role: patch.role ?? this.role }
    this.emit('status', this.status)
  }

  /** Start listening for a peer. Resolves once the socket is bound. */
  async host(options: HostOptions): Promise<{ port: number; addresses: string[] }> {
    await this.stop()
    this.role = 'host'
    this.hostOptions = {
      name: options.displayName,
      port: options.port,
      timeControl: options.timeControl
    }

    const server = new WebSocketServer({ port: options.port })
    this.server = server

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => {
        server.off('listening', onListening)
        // The usual failure is the port already being in use; say so plainly.
        reject(
          (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
            ? new Error(`Port ${options.port} is already in use. Pick another port.`)
            : err
        )
      }
      const onListening = (): void => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
    })

    server.on('connection', (socket) => {
      // Stop advertising the moment someone arrives, so the game disappears
      // from other players' lists instead of looking joinable.
      void this.advertiser.stop()

      if (this.socket) {
        // Already playing someone; turn the newcomer away cleanly.
        socket.close(4001, 'Host is already in a game')
        return
      }
      this.attach(socket)
      this.setStatus({ state: 'connected' })

      const color =
        options.hostColor === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : options.hostColor

      // The host decides the terms; the guest is told what they are.
      this.send({
        t: 'welcome',
        version: PROTOCOL_VERSION,
        name: options.displayName,
        // The colour named here is the guest's.
        yourColor: color === 'w' ? 'b' : 'w',
        timeControl: options.timeControl
      })
    })

    server.on('error', (err) => this.emit('error', err))

    // Advertising is a convenience, not a requirement: a failure here still
    // leaves the game joinable by typing the address.
    try {
      await this.advertiser.start({
        name: options.displayName,
        port: options.port,
        timeControl: options.timeControl
      })
    } catch (err) {
      this.emit('error', new Error(`Could not announce the game on the network: ${
        err instanceof Error ? err.message : String(err)
      }`))
    }

    const addresses = localAddresses()
    this.setStatus({ state: 'listening', port: options.port, addresses })
    return { port: options.port, addresses }
  }

  /** Connect to a host. Resolves once the socket opens. */
  async join(options: JoinOptions): Promise<void> {
    await this.stop()
    this.role = 'guest'

    const url = toWebSocketUrl(options.address)
    this.setStatus({ state: 'connecting', peerAddress: url })

    const socket = new WebSocket(url, { handshakeTimeout: 8000 })

    await new Promise<void>((resolve, reject) => {
      const onOpen = (): void => {
        socket.off('error', onError)
        resolve()
      }
      const onError = (err: Error): void => {
        socket.off('open', onOpen)
        this.setStatus({ state: 'offline', error: describe(err, url) })
        reject(new Error(describe(err, url)))
      }
      socket.once('open', onOpen)
      socket.once('error', onError)
    })

    this.attach(socket)
    this.setStatus({ state: 'connected', peerAddress: url })
    this.send({ t: 'hello', version: PROTOCOL_VERSION, name: options.displayName })
  }

  private attach(socket: WebSocket): void {
    this.socket = socket
    this.lastPong = Date.now()

    socket.on('message', (raw) => {
      let msg: NetMessage
      try {
        msg = JSON.parse(String(raw)) as NetMessage
      } catch {
        // A peer speaking anything other than our protocol is not a peer.
        this.emit('error', new Error('Received malformed data from peer'))
        return
      }

      if (msg.t === 'ping') {
        this.send({ t: 'pong', at: msg.at })
        return
      }
      if (msg.t === 'pong') {
        this.lastPong = Date.now()
        this.setStatus({ latencyMs: Date.now() - msg.at })
        return
      }
      if ((msg.t === 'hello' || msg.t === 'welcome') && msg.version !== PROTOCOL_VERSION) {
        this.emit(
          'error',
          new Error(`Version mismatch: peer speaks protocol ${msg.version}, this app speaks ${PROTOCOL_VERSION}`)
        )
        this.disconnect('version mismatch')
        return
      }

      this.emit('message', msg)
    })

    socket.on('close', (code, reason) => {
      this.clearPing()
      this.socket = null
      const why = reason?.toString() || (code === 4001 ? 'Host is already in a game' : undefined)
      this.setStatus({
        state: this.server ? 'listening' : 'offline',
        error: why,
        latencyMs: undefined
      })
      // Still hosting: announce again so the game reappears for others.
      if (this.server && this.hostOptions) void this.advertiser.start(this.hostOptions)
      this.emit('peer-left', why)
    })

    socket.on('error', (err) => this.emit('error', err))

    this.startPing()
  }

  private startPing(): void {
    this.clearPing()
    this.pingTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
      // A peer that stops answering has gone away even if the socket has not
      // noticed yet — common when a laptop sleeps or drops off wifi.
      if (Date.now() - this.lastPong > PING_TIMEOUT_MS) {
        this.disconnect('peer stopped responding')
        return
      }
      this.send({ t: 'ping', at: Date.now() })
    }, PING_MS)
  }

  private clearPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
  }

  send(msg: NetMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false
    this.socket.send(JSON.stringify(msg))
    return true
  }

  /** Drop the peer but keep listening, if hosting. */
  disconnect(reason = 'closed'): void {
    this.clearPing()
    this.socket?.close(1000, reason)
    this.socket = null
    this.setStatus({ state: this.server ? 'listening' : 'offline', latencyMs: undefined })
  }

  /** Tear everything down. */
  async stop(): Promise<void> {
    this.clearPing()
    this.socket?.close(1000, 'closing')
    this.socket = null

    const server = this.server
    this.server = null
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }

    await this.advertiser.stop()
    this.role = 'idle'
    this.hostOptions = null
    this.setStatus({ role: 'idle', state: 'offline', addresses: undefined, port: undefined })
  }
}

/** Turn a socket error into something a player can act on. */
function describe(err: Error, url: string): string {
  const code = (err as NodeJS.ErrnoException).code
  switch (code) {
    case 'ECONNREFUSED':
      return `Nothing is listening at ${url}. Check the host has started the game and the port matches.`
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return `Cannot reach ${url}. Are both machines on the same network?`
    case 'ETIMEDOUT':
      return `Timed out connecting to ${url}. A firewall is the usual cause.`
    case 'ENOTFOUND':
      return `Could not resolve ${url}.`
    default:
      return err.message || `Could not connect to ${url}`
  }
}
