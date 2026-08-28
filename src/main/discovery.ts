import { EventEmitter } from 'node:events'
import { createSocket, type Socket } from 'node:dgram'
import { networkInterfaces } from 'node:os'
import type { DiscoveredHost, TimeControl } from '../shared/types.js'

/**
 * Finding games on the local network, so joining is a click rather than a
 * dictated IP address.
 *
 * Hosts announce themselves over UDP multicast; guests listen and also send a
 * probe on startup so a game already in progress is found immediately rather
 * than after the next announcement.
 *
 * Multicast is used in preference to a broadcast to 255.255.255.255 because
 * loopback delivery is explicitly supported, which means two copies of the app
 * on one machine can find each other — useful for testing, and for anyone with
 * a second account on the same PC. Announcements are *also* broadcast, since a
 * few home routers drop multicast between wireless clients.
 */

const DISCOVERY_PORT = 27521
const MULTICAST_ADDR = '239.255.42.99'

/** How often a waiting host repeats its announcement. */
const ANNOUNCE_INTERVAL_MS = 2000

/** A host not heard from for this long is dropped from the list. */
const HOST_TTL_MS = 7000

/** How often the scanner re-probes and expires stale entries. */
const SCAN_TICK_MS = 2000

/** Bumped if the announcement payload ever changes shape. */
const DISCOVERY_VERSION = 1

interface Announcement {
  kind: 'chess-trainer-host'
  v: number
  id: string
  name: string
  port: number
  timeControl: TimeControl
}

interface Probe {
  kind: 'chess-trainer-probe'
  v: number
}

/** Subnet broadcast addresses, so announcements reach non-multicast networks. */
function broadcastAddresses(): string[] {
  const out: string[] = []
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.internal || addr.family !== 'IPv4' || !addr.netmask) continue
      const ip = addr.address.split('.').map(Number)
      const mask = addr.netmask.split('.').map(Number)
      if (ip.length !== 4 || mask.length !== 4) continue
      out.push(ip.map((octet, i) => octet | (~mask[i] & 255)).join('.'))
    }
  }
  return [...new Set(out)]
}

function bindSocket(onMessage: Socket['emit'] extends never ? never : (msg: Buffer, from: { address: string }) => void): Promise<Socket> {
  return new Promise((resolve, reject) => {
    // reuseAddr lets a host and a scanner coexist on one machine.
    const socket = createSocket({ type: 'udp4', reuseAddr: true })
    socket.once('error', reject)
    socket.on('message', (msg, rinfo) => onMessage(msg, rinfo))
    socket.bind(DISCOVERY_PORT, () => {
      try {
        socket.addMembership(MULTICAST_ADDR)
        socket.setMulticastLoopback(true)
        socket.setBroadcast(true)
      } catch {
        // A machine with no multicast-capable interface still works over
        // broadcast, so this is not fatal.
      }
      socket.off('error', reject)
      resolve(socket)
    })
  })
}

/** Announces a waiting game until the host stops or a peer connects. */
export class Advertiser {
  private socket: Socket | null = null
  private timer: NodeJS.Timeout | null = null
  private announcement: Announcement | null = null

  async start(info: { name: string; port: number; timeControl: TimeControl }): Promise<void> {
    await this.stop()

    this.announcement = {
      kind: 'chess-trainer-host',
      v: DISCOVERY_VERSION,
      // Identifies the game across announcements even if the address changes.
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: info.name,
      port: info.port,
      timeControl: info.timeControl
    }

    this.socket = await bindSocket((msg, rinfo) => {
      try {
        const parsed = JSON.parse(msg.toString()) as Probe
        // Answer a scanner directly so it does not wait for the next tick.
        if (parsed.kind === 'chess-trainer-probe') this.sendTo(rinfo.address)
      } catch {
        /* not ours */
      }
    })

    this.announce()
    this.timer = setInterval(() => this.announce(), ANNOUNCE_INTERVAL_MS)
    this.timer.unref?.()
  }

  private payload(): Buffer {
    return Buffer.from(JSON.stringify(this.announcement))
  }

  private sendTo(address: string): void {
    this.socket?.send(this.payload(), DISCOVERY_PORT, address, () => {})
  }

  private announce(): void {
    if (!this.socket || !this.announcement) return
    this.sendTo(MULTICAST_ADDR)
    for (const address of broadcastAddresses()) this.sendTo(address)
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    const socket = this.socket
    this.socket = null
    this.announcement = null
    if (socket) await new Promise<void>((resolve) => socket.close(() => resolve()))
  }

  get active(): boolean {
    return this.socket != null
  }
}

/**
 * Watches for announcements and keeps a live list of games on the network.
 *
 * Emits `hosts` with the full current list whenever it changes, so the renderer
 * can render it directly without tracking additions and removals itself.
 */
export class Scanner extends EventEmitter {
  private socket: Socket | null = null
  private timer: NodeJS.Timeout | null = null
  private hosts = new Map<string, DiscoveredHost & { seenAt: number }>()

  async start(): Promise<void> {
    await this.stop()

    this.socket = await bindSocket((msg, rinfo) => {
      let parsed: Announcement
      try {
        parsed = JSON.parse(msg.toString()) as Announcement
      } catch {
        return
      }
      if (parsed.kind !== 'chess-trainer-host') return
      if (parsed.v !== DISCOVERY_VERSION) return

      // Key on address and port: one machine could host two games on
      // different ports, and they are genuinely different games.
      const key = `${rinfo.address}:${parsed.port}`
      const existing = this.hosts.get(key)
      const host = {
        id: parsed.id,
        name: parsed.name || 'Player',
        address: rinfo.address,
        port: parsed.port,
        timeControl: parsed.timeControl,
        seenAt: Date.now()
      }
      this.hosts.set(key, host)

      // Only tell the renderer when something actually changed, not on every
      // keep-alive two seconds apart.
      if (!existing || existing.name !== host.name || existing.id !== host.id) this.emitHosts()
    })

    this.probe()
    this.timer = setInterval(() => {
      this.probe()
      this.expire()
    }, SCAN_TICK_MS)
    this.timer.unref?.()
  }

  private probe(): void {
    if (!this.socket) return
    const payload = Buffer.from(JSON.stringify({ kind: 'chess-trainer-probe', v: DISCOVERY_VERSION }))
    this.socket.send(payload, DISCOVERY_PORT, MULTICAST_ADDR, () => {})
    for (const address of broadcastAddresses()) {
      this.socket.send(payload, DISCOVERY_PORT, address, () => {})
    }
  }

  private expire(): void {
    const now = Date.now()
    let changed = false
    for (const [key, host] of this.hosts) {
      if (now - host.seenAt > HOST_TTL_MS) {
        this.hosts.delete(key)
        changed = true
      }
    }
    if (changed) this.emitHosts()
  }

  private emitHosts(): void {
    this.emit('hosts', this.list())
  }

  list(): DiscoveredHost[] {
    return [...this.hosts.values()]
      .map(({ seenAt: _seenAt, ...host }) => host)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.hosts.clear()
    const socket = this.socket
    this.socket = null
    if (socket) await new Promise<void>((resolve) => socket.close(() => resolve()))
  }
}

export { DISCOVERY_PORT, MULTICAST_ADDR }
