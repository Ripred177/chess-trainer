import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import {
  Flag,
  Handshake,
  Wifi,
  WifiOff,
  Copy,
  RefreshCw,
  ChevronLeft,
  Radio,
  PlugZap,
  Search,
  Users
} from 'lucide-react'
import type { Color, DiscoveredHost, NetMessage, NetStatus, TimeControl } from '@shared/types'
import Board from '../components/Board'
import MoveList from '../components/MoveList'
import Clock from '../components/Clock'
import { PageHeader, Section } from '../components/ui'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  getTimeControl,
  inCategory
} from '../data/timeControls'
import { useBoardColors, useBoardSize, usePieceColors, useSettings, useStore } from '../state/useStore'
import { usePieceResolver } from '../lib/pieceSprites'
import { configureSound, play, playMoveSound } from '../lib/sound'
import { hasMatingMaterial, useClock } from '../lib/useClock'
import {
  START_FEN,
  materialBalance,
  outcomeOf,
  parseUci,
  type PieceType,
  type Square
} from '../lib/chess'

type Phase = 'lobby' | 'waiting' | 'playing' | 'over'

interface GameEnd {
  result: '1-0' | '0-1' | '1/2-1/2'
  termination: string
  youWon: boolean | null
}

/**
 * Play against a person on the same network.
 *
 * One side hosts and the other connects to their address; there is no server
 * and no account, and nothing leaves the two machines. The host is
 * authoritative for colour, time control, and the clock, so the two sides can
 * never disagree about the state of the game.
 */
export default function FriendsView(): React.JSX.Element {
  const settings = useSettings()
  const colors = useBoardColors()
  const boardSize = useBoardSize()
  const pieceColors = usePieceColors()
  const profile = useStore((s) => s.profile)
  const refreshProfile = useStore((s) => s.refreshProfile)
  const resolvePiece = usePieceResolver(settings.pieceSetId, pieceColors)

  const [status, setStatus] = useState<NetStatus>({ role: 'idle', state: 'offline' })
  const [phase, setPhase] = useState<Phase>('lobby')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Lobby configuration.
  const [mode, setMode] = useState<'host' | 'join'>('host')
  const [port, setPort] = useState(27520)
  const [address, setAddress] = useState('')
  const [hostColorChoice, setHostColorChoice] = useState<Color | 'random'>('random')
  const [found, setFound] = useState<DiscoveredHost[]>([])
  const [timeControl, setTimeControl] = useState<TimeControl>(() =>
    getTimeControl(profile?.settings.timeControlId ?? '10+0')
  )

  // Game state.
  const gameRef = useRef(new Chess())
  const [fen, setFen] = useState(START_FEN)
  const [history, setHistory] = useState<string[]>([])
  const [myColor, setMyColor] = useState<Color>('w')
  const [peerName, setPeerName] = useState('Opponent')
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null)
  const [gameEnd, setGameEnd] = useState<GameEnd | null>(null)
  const [drawOffered, setDrawOffered] = useState(false)
  const [drawIncoming, setDrawIncoming] = useState(false)
  const [rematchIncoming, setRematchIncoming] = useState(false)
  const [resignArmed, setResignArmed] = useState(false)
  /** Bumped to hand clock startup to an effect; see beginGame. */
  const [startToken, setStartToken] = useState(0)

  const isHost = status.role === 'host'
  const timed = timeControl.initialMs > 0

  useEffect(() => {
    configureSound(settings.soundEnabled, settings.soundVolume)
  }, [settings.soundEnabled, settings.soundVolume])

  // Latest values for handlers that live outside React's render cycle.
  const myColorRef = useRef<Color>('w')
  myColorRef.current = myColor
  const phaseRef = useRef<Phase>('lobby')
  phaseRef.current = phase
  const onFlagRef = useRef<(color: Color) => void>(() => {})

  const clock = useClock(
    timeControl,
    (color) => onFlagRef.current(color),
    () => play('check'),
    settings.lowTimeWarningSec
  )

  const send = useCallback((msg: NetMessage) => {
    void window.chess.net.send(msg)
  }, [])

  // ------------------------------------------------------------ game end ---

  const finish = useCallback(
    async (end: GameEnd, record = true) => {
      clock.stop()
      setGameEnd(end)
      setPhase('over')
      setDrawOffered(false)
      setDrawIncoming(false)
      play('end')

      if (!record) return
      const moves = gameRef.current.history().length
      if (moves === 0) return

      await window.chess.profile.recordGame({
        playerColor: myColorRef.current,
        // A person has no Elo here, which is what keeps these games unrated.
        opponentElo: 0,
        opponent: peerName,
        result: end.result,
        termination: end.termination,
        pgn: gameRef.current.pgn(),
        moveCount: moves,
        timeControl: {
          name: timeControl.name,
          category: timeControl.category,
          initialMs: timeControl.initialMs,
          incrementMs: timeControl.incrementMs
        }
      })
      await refreshProfile()
    },
    [clock, peerName, timeControl, refreshProfile]
  )

  /** Detect a natural end (mate, stalemate, repetition) after any move. */
  const checkOver = useCallback((): boolean => {
    const outcome = outcomeOf(gameRef.current)
    if (!outcome.over) return false
    void finish({
      result: outcome.result as GameEnd['result'],
      termination: outcome.termination,
      youWon: outcome.winner == null ? null : outcome.winner === myColorRef.current
    })
    return true
  }, [finish])

  /**
   * Only ever claim your *own* flag.
   *
   * Both machines run their own clock, and small skew is unavoidable; a peer
   * announcing that *you* have flagged would be unverifiable. Announcing your
   * own loss is always self-consistent, and an unresponsive peer is caught by
   * the heartbeat instead.
   */
  onFlagRef.current = useCallback(
    (color: Color) => {
      if (phaseRef.current !== 'playing') return
      if (color !== myColorRef.current) return

      const opponent: Color = color === 'w' ? 'b' : 'w'
      const canMate = hasMatingMaterial(gameRef.current.fen(), opponent)
      const end: GameEnd = canMate
        ? {
            result: opponent === 'w' ? '1-0' : '0-1',
            termination: `${color === 'w' ? 'White' : 'Black'} ran out of time`,
            youWon: false
          }
        : { result: '1/2-1/2', termination: 'Timeout vs insufficient material', youWon: null }

      send({ t: 'gameOver', result: end.result, termination: end.termination })
      void finish(end)
    },
    [send, finish]
  )

  // ------------------------------------------------------------- lifecycle --

  const beginGame = useCallback(
    (color: Color, control: TimeControl) => {
      gameRef.current = new Chess()
      setMyColor(color)
      myColorRef.current = color
      setTimeControl(control)
      setFen(gameRef.current.fen())
      setHistory([])
      setLastMove(null)
      setGameEnd(null)
      setDrawOffered(false)
      setDrawIncoming(false)
      setRematchIncoming(false)
      setResignArmed(false)
      setPhase('playing')
      // The clock is started by an effect rather than here. `useClock` resets
      // itself whenever the time control changes, and that effect runs *after*
      // this function returns — so starting the clock now would immediately be
      // undone on the next render.
      setStartToken((n) => n + 1)
    },
    []
  )

  /**
   * Start the clock once the new time control has actually taken effect.
   *
   * Keyed on the control as well as the token, so a game that changes the pace
   * (a guest being told the host's choice) starts from the right numbers.
   */
  useEffect(() => {
    if (startToken === 0) return
    clock.reset()
    clock.start('w')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startToken, timeControl.id])

  // Handlers are rebound every render and invoked through a ref, so the
  // once-registered socket listeners below always run the current logic rather
  // than a snapshot taken before the game's terms were known.
  const handleMessageRef = useRef<(msg: NetMessage) => void>(() => {})
  const handlePeerLeftRef = useRef<(reason?: string) => void>(() => {})

  useEffect(() => {
    const offStatus = window.chess.net.onStatus((s) => {
      setStatus(s)
      if (s.error) setError(s.error)
    })

    const offError = window.chess.net.onError((message) => setError(message))

    const offLeft = window.chess.net.onPeerLeft((reason) => handlePeerLeftRef.current(reason))
    const offMessage = window.chess.net.onMessage((msg) => handleMessageRef.current(msg))

    void window.chess.net.status().then(setStatus)

    return () => {
      offStatus()
      offError()
      offLeft()
      offMessage()
    }
  }, [])

  handlePeerLeftRef.current = useCallback(
    (reason?: string) => {
      if (phaseRef.current === 'playing') {
        void finish(
          {
            result: myColorRef.current === 'w' ? '1-0' : '0-1',
            termination: 'Opponent disconnected',
            youWon: true
          },
          false
        )
      }
      setNotice(reason ? `Opponent left: ${reason}` : 'Opponent disconnected.')
    },
    [finish]
  )

  handleMessageRef.current = useCallback(
    (msg: NetMessage) => {
      switch (msg.t) {
        case 'hello':
          setPeerName(msg.name || 'Opponent')
          break

        case 'welcome': {
          // Guests learn the terms from the host and start immediately.
          setPeerName(msg.name || 'Opponent')
          beginGame(msg.yourColor, msg.timeControl)
          break
        }

        case 'move': {
          const parsed = parseUci(msg.uci)
          if (!parsed) return
          // Ignore anything that does not follow on from the position we hold;
          // a duplicate or out-of-order frame must never corrupt the board.
          if (msg.ply !== gameRef.current.history().length) return

          let applied
          try {
            applied = gameRef.current.move({
              from: parsed.from,
              to: parsed.to,
              promotion: parsed.promotion ?? 'q'
            })
          } catch {
            return
          }
          if (!applied) return

          setFen(gameRef.current.fen())
          setHistory(gameRef.current.history())
          setLastMove({ from: parsed.from, to: parsed.to })
          setDrawIncoming(false)
          playMoveSound({
            captured: Boolean(applied.captured),
            check: gameRef.current.inCheck(),
            castle: applied.san.startsWith('O-O'),
            promotion: Boolean(applied.promotion)
          })

          // Switch the clock to our side first — `press` is what moves the turn
          // over — and only then adopt the host's authoritative values. Doing
          // just the adoption would leave the opponent's clock running while it
          // is our move, quietly charging the wrong player.
          clock.press(myColorRef.current === 'w' ? 'b' : 'w')
          if (msg.clock) clock.setTimes(msg.clock)

          checkOver()
          break
        }

        case 'resign': {
          const youWon = true
          void finish({
            result: myColorRef.current === 'w' ? '1-0' : '0-1',
            termination: 'Opponent resigned',
            youWon
          })
          break
        }

        case 'drawOffer':
          setDrawIncoming(true)
          break

        case 'drawDecline':
          setDrawOffered(false)
          setNotice('Draw declined.')
          break

        case 'drawAccept':
          void finish({ result: '1/2-1/2', termination: 'Draw by agreement', youWon: null })
          break

        case 'gameOver':
          void finish({
            result: msg.result,
            termination: msg.termination,
            youWon:
              msg.result === '1/2-1/2'
                ? null
                : (msg.result === '1-0') === (myColorRef.current === 'w')
          })
          break

        case 'rematch':
          setRematchIncoming(true)
          break

        case 'rematchAccept':
          beginGame(msg.yourColor, timeControl)
          break

        case 'chat':
          setNotice(`${peerName}: ${msg.text}`)
          break
      }
    },
    [beginGame, checkOver, clock, finish, peerName, timeControl]
  )

  // Host starts as soon as a peer attaches; the colour was fixed when hosting.
  const pendingHostColor = useRef<Color>('w')
  useEffect(() => {
    if (status.role !== 'host') return
    if (status.state !== 'connected') return
    if (phaseRef.current === 'playing') return
    beginGame(pendingHostColor.current, timeControl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.state, status.role])

  // Leaving the view should not leave a socket open.
  useEffect(() => {
    return () => {
      void window.chess.net.stop()
    }
  }, [])

  // ---------------------------------------------------------------- moves --

  const onMove = useCallback(
    (from: Square, to: Square, promotion?: PieceType) => {
      if (phase !== 'playing') return
      if (gameRef.current.turn() !== myColor) return

      let applied
      try {
        applied = gameRef.current.move({ from, to, promotion: promotion ?? 'q' })
      } catch {
        return
      }
      if (!applied) return

      const ply = gameRef.current.history().length - 1
      setFen(gameRef.current.fen())
      setHistory(gameRef.current.history())
      setLastMove({ from, to })
      setDrawOffered(false)
      playMoveSound({
        captured: Boolean(applied.captured),
        check: gameRef.current.inCheck(),
        castle: applied.san.startsWith('O-O'),
        promotion: Boolean(applied.promotion)
      })

      clock.press(myColor)

      send({
        t: 'move',
        uci: `${from}${to}${promotion ?? ''}`,
        ply,
        // Only the host publishes clock values, so there is one authority.
        ...(isHost && timed ? { clock: clock.read() } : {})
      })

      checkOver()
    },
    [phase, myColor, clock, send, isHost, timed, checkOver]
  )

  // --------------------------------------------------------------- actions --

  const startHosting = useCallback(async () => {
    setError(null)
    setNotice(null)
    const resolved: Color =
      hostColorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : hostColorChoice
    pendingHostColor.current = resolved
    try {
      await window.chess.net.host({
        port,
        displayName: profile?.displayName ?? 'Player',
        hostColor: resolved,
        timeControl
      })
      setPhase('waiting')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [hostColorChoice, port, profile, timeControl])

  useEffect(() => {
    if (phase !== 'lobby' || mode !== 'join') {
      void window.chess.net.stopScan()
      setFound([])
      return
    }

    const off = window.chess.net.onHosts(setFound)
    void window.chess.net.startScan().then(setFound)
    return () => {
      off()
      void window.chess.net.stopScan()
    }
  }, [phase, mode])

  const joinAddress = useCallback(
    async (target: string) => {
      setError(null)
      setNotice(null)
      try {
        await window.chess.net.join({ address: target, displayName: profile?.displayName ?? 'Player' })
        setPhase('waiting')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [profile]
  )

  const startJoining = useCallback(async () => {
    setError(null)
    setNotice(null)
    await joinAddress(address)
  }, [address, joinAddress])

  const leave = useCallback(async () => {
    await window.chess.net.stop()
    setPhase('lobby')
    setGameEnd(null)
    setNotice(null)
  }, [])

  const resign = useCallback(() => {
    if (settings.confirmResign && !resignArmed) {
      setResignArmed(true)
      setTimeout(() => setResignArmed(false), 4000)
      return
    }
    setResignArmed(false)
    send({ t: 'resign' })
    void finish({
      result: myColor === 'w' ? '0-1' : '1-0',
      termination: 'Resignation',
      youWon: false
    })
  }, [settings.confirmResign, resignArmed, send, finish, myColor])

  const material = useMemo(() => materialBalance(fen), [fen])
  const opponentColor: Color = myColor === 'w' ? 'b' : 'w'
  const myTurn = phase === 'playing' && gameRef.current.turn() === myColor

  // ---------------------------------------------------------------- lobby --

  if (phase === 'lobby' || phase === 'waiting') {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <PageHeader
          title="Play a friend"
          subtitle="Direct connection over your local network. No account, no server — the game never leaves your two machines."
        />

        {error && (
          <div
            className="card p-4 mb-4 text-sm"
            style={{ borderColor: 'var(--color-danger-500)', color: 'var(--color-danger-400)' }}
          >
            {error}
          </div>
        )}
        {notice && (
          <div className="card p-4 mb-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {notice}
          </div>
        )}

        {phase === 'waiting' ? (
          <Section
            title={status.role === 'host' ? 'Waiting for your opponent' : 'Connecting…'}
            description={
              status.role === 'host'
                ? 'Give your friend one of these addresses. They pick "Join a game" and paste it in.'
                : 'Reaching the host.'
            }
          >
            {status.role === 'host' && (
              <>
                {(status.addresses ?? []).length === 0 && (
                  <p className="text-sm" style={{ color: 'var(--color-warn-400)' }}>
                    No network address found. Are you connected to a network?
                  </p>
                )}
                {(status.addresses ?? []).map((ip) => {
                  const full = `${ip}:${status.port}`
                  return (
                    <div key={ip} className="flex items-center gap-2 py-1.5">
                      <code className="input font-mono selectable" style={{ flex: 1 }}>
                        {full}
                      </code>
                      <button
                        className="btn"
                        onClick={() => void navigator.clipboard.writeText(full)}
                        title="Copy address"
                      >
                        <Copy size={15} /> Copy
                      </button>
                    </div>
                  )
                })}
                <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
                  Windows will likely ask you to allow the connection through the firewall the first time.
                  Allow it on private networks.
                </p>
              </>
            )}

            <div className="flex items-center gap-2 mt-4">
              <Radio size={15} className="animate-pulse" style={{ color: 'var(--color-accent-400)' }} />
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {status.state === 'listening'
                  ? `Listening on port ${status.port}`
                  : status.state === 'connecting'
                    ? 'Connecting…'
                    : status.state}
              </span>
            </div>

            <button className="btn w-full mt-4" onClick={leave}>
              <ChevronLeft size={15} /> Cancel
            </button>
          </Section>
        ) : (
          <>
            <div className="flex gap-1 mb-5">
              {(
                [
                  { id: 'host', label: 'Host a game', icon: Radio },
                  { id: 'join', label: 'Join a game', icon: PlugZap }
                ] as const
              ).map((tab) => {
                const Icon = tab.icon
                return (
                  <button
                    key={tab.id}
                    onClick={() => setMode(tab.id)}
                    className="btn flex-1"
                    style={
                      mode === tab.id
                        ? { borderColor: 'var(--color-accent-500)', background: 'var(--surface-3)' }
                        : undefined
                    }
                  >
                    <Icon size={15} /> {tab.label}
                  </button>
                )
              })}
            </div>

            {mode === 'host' ? (
              <>
                <Section title="Time control">
                  {CATEGORY_ORDER.map((category) => (
                    <div key={category} className="mb-3 last:mb-0">
                      <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                        {CATEGORY_LABELS[category]}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {inCategory(category).map((tc) => (
                          <button
                            key={tc.id}
                            onClick={() => setTimeControl(tc)}
                            className="btn tabular"
                            style={
                              timeControl.id === tc.id
                                ? {
                                    borderColor: 'var(--color-accent-500)',
                                    background: 'var(--surface-3)',
                                    fontWeight: 600
                                  }
                                : undefined
                            }
                          >
                            {tc.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </Section>

                <Section title="Your colour">
                  <div className="flex gap-2">
                    {(['w', 'random', 'b'] as const).map((option) => (
                      <button
                        key={option}
                        onClick={() => setHostColorChoice(option)}
                        className="btn flex-1"
                        style={
                          hostColorChoice === option
                            ? { borderColor: 'var(--color-accent-500)', background: 'var(--surface-3)' }
                            : undefined
                        }
                      >
                        {option === 'w' ? 'White' : option === 'b' ? 'Black' : 'Random'}
                      </button>
                    ))}
                  </div>
                </Section>

                <Section title="Port" description="Only change this if the default is taken.">
                  <input
                    className="input tabular"
                    type="number"
                    min={1024}
                    max={65535}
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value) || 27520)}
                  />
                </Section>

                <button className="btn btn-primary w-full py-3 text-base" onClick={startHosting}>
                  <Radio size={16} /> Host on port {port} · {timeControl.name}
                </button>
              </>
            ) : (
              <>
                <Section
                  title="Games on your network"
                  description={
                    found.length > 0
                      ? 'Click one to join. The host sets the colours and the clock.'
                      : 'Scanning… games appear here automatically once someone hosts one.'
                  }
                >
                  {found.length === 0 ? (
                    <div
                      className="flex items-center gap-2 py-3 text-sm"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <Search size={15} className="animate-pulse" />
                      No games found yet.
                    </div>
                  ) : (
                    found.map((host) => (
                      <button
                        key={`${host.address}:${host.port}`}
                        onClick={() => void joinAddress(`${host.address}:${host.port}`)}
                        className="card w-full p-3 mb-2 text-left transition-all flex items-center gap-3"
                        style={{ borderColor: 'var(--border-subtle)' }}
                      >
                        <Users size={17} style={{ color: 'var(--color-accent-400)' }} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">{host.name}</div>
                          <div className="text-xs font-mono truncate" style={{ color: 'var(--text-muted)' }}>
                            {host.address}:{host.port}
                          </div>
                        </div>
                        <span className="chip tabular">{host.timeControl?.name ?? '—'}</span>
                        <span className="btn btn-primary" style={{ pointerEvents: 'none' }}>
                          Join
                        </span>
                      </button>
                    ))
                  )}
                  <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                    Discovery uses UDP multicast. If a game does not appear — some routers block it between
                    wireless clients — enter the address by hand below.
                  </p>
                </Section>

                <Section
                  title="Or enter the address"
                  description="Whatever your friend's app showed them, e.g. 192.168.1.24:27520"
                >
                  <input
                    className="input font-mono"
                    placeholder="192.168.1.24:27520"
                    value={address}
                    spellCheck={false}
                    onChange={(e) => setAddress(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && address.trim()) void startJoining()
                    }}
                  />
                </Section>

                <button
                  className="btn btn-primary w-full py-3 text-base"
                  onClick={startJoining}
                  disabled={!address.trim()}
                >
                  <PlugZap size={16} /> Connect
                </button>
              </>
            )}
          </>
        )}
      </div>
    )
  }

  // ----------------------------------------------------------------- game --

  return (
    <div className="p-3 sm:p-6">
      <div className="flex flex-wrap items-start gap-4 lg:gap-6 justify-center">
        <div>
          <PeerStrip
            name={peerName}
            color={opponentColor}
            captured={myColor === 'w' ? material.blackCaptured : material.whiteCaptured}
            advantage={myColor === 'w' ? -material.advantage : material.advantage}
            resolvePiece={resolvePiece}
            clockMs={timed ? clock.times[opponentColor] : null}
            clockRunning={clock.active === opponentColor}
            clockIdle={phase === 'over'}
            lowTimeSec={settings.lowTimeWarningSec}
          />

          <div className="my-2">
            <Board
              fen={fen}
              orientation={myColor}
              movableFor={myTurn ? myColor : null}
              onMove={onMove}
              lastMove={lastMove}
              colors={colors}
              pieceSet={settings.pieceSetId}
              size={boardSize}
              showCoordinates={settings.showCoordinates}
              showLegalMoves={settings.showLegalMoves}
              highlightLastMove={settings.highlightLastMove}
              animationMs={settings.animationMs}
              autoPromoteToQueen={settings.autoPromoteToQueen}
              moveInput={settings.moveInput}
              disabled={phase !== 'playing'}
            />
          </div>

          <PeerStrip
            name={profile?.displayName ?? 'You'}
            color={myColor}
            captured={myColor === 'w' ? material.whiteCaptured : material.blackCaptured}
            advantage={myColor === 'w' ? material.advantage : -material.advantage}
            resolvePiece={resolvePiece}
            clockMs={timed ? clock.times[myColor] : null}
            clockRunning={clock.active === myColor}
            clockIdle={phase === 'over'}
            lowTimeSec={settings.lowTimeWarningSec}
          />
        </div>

        <div className="w-full max-w-[20rem] lg:w-80 shrink-0">
          <div className="card p-4 mb-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm flex items-center gap-1.5">
                {status.state === 'connected' ? (
                  <Wifi size={15} style={{ color: 'var(--color-accent-400)' }} />
                ) : (
                  <WifiOff size={15} style={{ color: 'var(--color-danger-400)' }} />
                )}
                {peerName}
              </span>
              <div className="flex items-center gap-1.5">
                <span className="chip">{timeControl.name}</span>
                {status.latencyMs != null && <span className="chip tabular">{status.latencyMs}ms</span>}
              </div>
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {isHost ? 'You are hosting' : 'Connected to host'} · playing{' '}
              {myColor === 'w' ? 'White' : 'Black'}
            </div>
          </div>

          {notice && (
            <div className="card p-3 mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
              {notice}
            </div>
          )}

          {drawIncoming && phase === 'playing' && (
            <div className="card p-4 mb-3" style={{ borderColor: 'var(--color-info-500)' }}>
              <div className="text-sm font-semibold">{peerName} offers a draw</div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <button
                  className="btn"
                  onClick={() => {
                    send({ t: 'drawDecline' })
                    setDrawIncoming(false)
                  }}
                >
                  Decline
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    send({ t: 'drawAccept' })
                    void finish({ result: '1/2-1/2', termination: 'Draw by agreement', youWon: null })
                  }}
                >
                  Accept
                </button>
              </div>
            </div>
          )}

          {gameEnd && (
            <div
              className="card p-4 mb-3"
              style={{
                borderColor:
                  gameEnd.youWon === true
                    ? 'var(--color-accent-500)'
                    : gameEnd.youWon === false
                      ? 'var(--color-danger-500)'
                      : 'var(--border-strong)'
              }}
            >
              <div className="font-semibold">
                {gameEnd.youWon === true ? 'You won' : gameEnd.youWon === false ? 'You lost' : 'Draw'}
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                {gameEnd.termination} · {gameEnd.result} · unrated
              </div>

              {rematchIncoming ? (
                <button
                  className="btn btn-primary w-full mt-3"
                  onClick={() => {
                    // Colours swap on a rematch, and the host stays the host.
                    const next: Color = myColor === 'w' ? 'b' : 'w'
                    send({ t: 'rematchAccept', yourColor: next === 'w' ? 'b' : 'w' })
                    beginGame(next, timeControl)
                  }}
                >
                  <Handshake size={15} /> Accept rematch
                </button>
              ) : (
                <button
                  className="btn w-full mt-3"
                  onClick={() => {
                    send({ t: 'rematch' })
                    setNotice('Rematch offered.')
                  }}
                  disabled={status.state !== 'connected'}
                >
                  <RefreshCw size={15} /> Offer rematch
                </button>
              )}

              <button className="btn w-full mt-2" onClick={leave}>
                <ChevronLeft size={15} /> Leave
              </button>
            </div>
          )}

          <div className="card p-2 mb-3" style={{ maxHeight: 280, overflow: 'auto' }}>
            <MoveList moves={history} current={history.length - 1} emptyMessage="The game starts here." />
          </div>

          {phase === 'playing' && (
            <div className="grid grid-cols-2 gap-2">
              <button
                className="btn"
                onClick={() => {
                  send({ t: 'drawOffer' })
                  setDrawOffered(true)
                }}
                disabled={drawOffered}
              >
                <Handshake size={15} /> {drawOffered ? 'Offered' : 'Draw'}
              </button>
              <button
                className="btn btn-danger"
                onClick={resign}
                style={
                  resignArmed
                    ? {
                        background: 'color-mix(in oklch, var(--color-danger-500) 20%, transparent)',
                        borderColor: 'var(--color-danger-500)',
                        fontWeight: 600
                      }
                    : undefined
                }
              >
                <Flag size={15} /> {resignArmed ? 'Confirm' : 'Resign'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PeerStrip({
  name,
  color,
  captured,
  advantage,
  resolvePiece,
  clockMs,
  clockRunning,
  clockIdle,
  lowTimeSec
}: {
  name: string
  color: Color
  captured: PieceType[]
  advantage: number
  resolvePiece: (color: Color, type: string) => string
  clockMs: number | null
  clockRunning: boolean
  clockIdle: boolean
  lowTimeSec: number
}): React.JSX.Element {
  const order: PieceType[] = ['q', 'r', 'b', 'n', 'p']
  const sorted = [...captured].sort((a, b) => order.indexOf(a) - order.indexOf(b))

  return (
    <div className="flex items-center gap-2 py-1.5" style={{ minHeight: 44 }}>
      <span className="font-semibold text-sm">{name}</span>
      <span className="chip">{color === 'w' ? 'White' : 'Black'}</span>
      <div className="flex items-center ml-1">
        {sorted.map((type, i) => (
          <img
            key={i}
            src={resolvePiece(color === 'w' ? 'b' : 'w', type)}
            alt=""
            className="no-drag"
            style={{ width: 18, height: 18, marginLeft: i > 0 ? -6 : 0, opacity: 0.85 }}
          />
        ))}
        {advantage > 0 && (
          <span className="text-xs tabular ml-1.5" style={{ color: 'var(--text-muted)' }}>
            +{advantage}
          </span>
        )}
      </div>
      {clockMs != null && (
        <div className="ml-auto">
          <Clock ms={clockMs} running={clockRunning} idle={clockIdle} color={color} lowTimeSec={lowTimeSec} />
        </div>
      )}
    </div>
  )
}
