# Chess Trainer

A desktop chess app: play Stockfish at any strength from beginner to grandmaster,
solve six million puzzles, and work through a curriculum that runs from "this is
how a knight moves" to expert endgame technique.

Everything runs locally. No account, no server, no network access at runtime.

## What's in it

**Play** — thirteen opponents from 300 to 3190 Elo, at any pace: untimed, or
sixteen standard time controls across bullet, blitz, rapid, and classical, plus
a custom builder. In a timed game the engine is handed both clocks and budgets
its own thinking time, so it speeds up when it is short — and ratings are
tracked per pace, since bullet strength and classical strength are not the same
skill. Stockfish's own strength
limiter only reaches down to 1320, so everything below that is emulated: the
engine searches a couple of ply and then picks from its ranked move list with a
softmax whose temperature widens as the rating drops. The result is a bot that
hangs pieces and misses forks like a real beginner, instead of playing perfectly
and then throwing in a random blunder.

**Puzzles** — the full Lichess puzzle database, 6,100,960 positions rated 399 to
3322, filterable by 73 tactical themes and any rating band. Your puzzle rating
uses Glicko, and each theme is rated separately so the app can tell you that your
forks are fine but your back-rank vision is not.

Every puzzle states what it is asking for, the way a puzzle book prints "mate
in two" above the diagram: *"Black to move. Find the checkmate in two."* or
*"White to move. There is a winning continuation — expect to come out at least
a piece ahead. You need to find two moves."* These are derived from the
puzzle's own Lichess theme tags, so they describe that position rather than
offering generic encouragement. The move count is suppressed when the goal
already implies it.

Hints then escalate in three steps, and only the last two touch the board:

1. The tactical motif — *"Skewer — a valuable piece is attacked and must move,
   exposing the one behind it."* Where a puzzle carries no motif tag, which is
   common for forced mates, it gives method instead: start with checks, count
   escape squares.
2. The piece to move is highlighted.
3. Its destination is highlighted.

Knowing *what* you are looking for is part of the exercise; knowing *where* is
the answer, which is why squares come last.

A wrong move does not end a puzzle. The move is played so you can see what it
actually does, then taken back, and the position stays yours to finish —
**Rewind** steps back a further move pair, **Restart** returns to the opening
position. The attempt is still scored on the first mistake, so the rating keeps
its meaning, but the solution is only revealed if you ask for it. This applies
everywhere puzzles appear: the Puzzles screen, the daily puzzle, and lesson
practice sets.

**Daily puzzle** — one puzzle per day, chosen from the date alone. The same
puzzle appears on every install and can't be rerolled. Streaks are tracked.

**Learn** — 40 lessons across 10 modules. Three lesson types: annotated concept
walkthroughs, drills you play out against the engine (mate with king and rook,
convert the Lucena, win a pawn ending), and practice sets that pull fresh
positions from the puzzle database. Practice sets are defined as *queries*, so
they never run out of material.

**Friends** — play another person on the same network. A host announces itself
over UDP multicast, so the joining player just sees the game in a list and
clicks it; typing an address by hand still works for networks that block
multicast between wireless clients. Announcements stop the moment an opponent
connects, and resume if they disconnect. There is no server, no account, and
no matchmaking: the game runs directly between the two machines and nothing
leaves them. The host is authoritative for colour, time control, and the clock,
so the two sides can never disagree. Draw offers, resignation, and rematches all
work; these games are recorded but left **unrated**, since a human peer has no
Elo here.

The transport is a WebSocket rather than a raw socket on purpose — a hosted
relay speaks the same frames, so pointing at one later is a change of address
rather than a rewrite.

**Games** — every finished game is saved and replayable. Step through it with
the arrow keys, flip the board, copy the PGN or the FEN of the position you are
looking at, or hand the whole game to the Analysis board.

**Review** grades each move against Stockfish and names the move you should have
played. Classification uses the *drop in win probability* a move causes, not raw
centipawns: giving up 300 centipawns while already completely winning barely
changes the outcome, whereas the same loss in a level position is decisive, and
counting centipawns alone marks the first as a blunder and misleads. Reviews are
stored with the game, so a forty-move game is only ever analysed once.

The review costs one search per position rather than two. The evaluation *after*
a move is the evaluation of the next position with its sign flipped, so a game
of N moves needs N+1 searches, not 2N.

**Analysis** — full-strength Stockfish with three principal variations, live
streaming evaluation, and FEN/PGN import.

**Customisation** — 18 board themes with every colour individually editable, 41
piece sets, adjustable board size, animation speed, move input mode, and
synthesised sound.

Forty of the sets come from Lichess. The forty-first, **Bunny**, is original to
this project and generated by `scripts/make-bunny-pieces.mjs` — one description
per piece, rendered twice so the white and black variants can never drift apart.
Rank is carried by ears and headgear rather than by size alone, which is what
keeps it playable at board scale: short ears for the pawn, a swept ear and a
carrot for the knight, tall ears and a mitre slit for the bishop, square
battlement ears for the rook, lop ears and a tiara for the queen, and upright
ears under a crown and cross for the king. Regenerate it with
`npm run assets:bunny`.

For horses, Lichess's **horsey** set is bundled already — every piece is a horse,
not just the knight.

### Recolouring pieces

Any set can be recoloured, with two endpoints per side: the piece body and its
outline. Eight presets ship, and every colour is editable.

The naive approach — swapping white for one colour and black for another — only
works on flat art. Fifteen of the forty-one sets use three or more tones to
model shading, and flattening those would destroy them. So each colour in the
SVG is instead mapped by **luminance** onto a ramp between the two chosen
endpoints: a flat set lands exactly on the endpoints, while a shaded set keeps
its midtones in the new palette.

Saturated colours are treated as accents and preserved by default, so a bunny
keeps its pink ears and Firi keeps its red crest while the bodies change. A
toggle recolours those too.

Two implementation notes worth keeping:

- Rewriting is anchored to paint properties (`fill`, `stroke`, `stop-color`, …)
  rather than searching for hex literals, because a blanket search also matches
  fragment references like `url(#abc)` — several sets use those for gradients
  and filters, and rewriting one silently corrupts the artwork.
- Recoloured pieces are served as `data:` URIs inside `<img>` rather than inlined
  as `<svg>`. A dozen sets declare gradients and filters with ids as short as
  `#a`; inlining thirty-two copies into one document would collide on those ids.

## Requirements

Node 22+ (for `node:sqlite` and the built-in zstd decoder). Nothing else — no
Python, no Rust, no C++ toolchain, no native module compilation.

## Setup

```bash
npm install
```

npm 11 blocks package install scripts by default, which stops Electron and
esbuild from downloading their binaries. If `node_modules/electron/dist` is
empty, run them explicitly:

```bash
node node_modules/electron/install.js
cd node_modules/esbuild && node install.js
```

### Fetch the assets

The engine, the puzzle database, and the piece art are all downloaded rather
than committed — together they are about 3.4GB.

```bash
mkdir -p assets/raw resources/engine

# Stockfish 18 (GPLv3). Pick sse41-popcnt instead of avx2 for pre-2013 CPUs.
curl -L -o assets/raw/stockfish-win.zip \
  https://github.com/official-stockfish/Stockfish/releases/download/sf_18/stockfish-windows-x86-64-avx2.zip
unzip -j assets/raw/stockfish-win.zip '*/stockfish*.exe' -d resources/engine
mv resources/engine/stockfish-windows-x86-64-avx2.exe resources/engine/stockfish.exe

# Puzzle database (CC0), ~290MB compressed.
curl -L -o assets/raw/lichess_db_puzzle.csv.zst \
  https://database.lichess.org/lichess_db_puzzle.csv.zst

# Piece sets. Licences vary per set — see src/renderer/public/pieces/COPYING.md.
npm run assets:pieces
```

### Build the puzzle database

```bash
npm run puzzles:build
```

Takes about four minutes and produces a 3.2GB `resources/puzzles.db`.

## Running

```bash
npm run dev
```

## Packaging

```bash
npm run dist:win     # NSIS installer  -> release/*.exe
npm run dist:linux   # AppImage        -> release/*.AppImage   (Linux host only)
npm run dist:all     # both            (Linux host only)
```

Each platform ships only its own Stockfish binary (`resources/engine/win` or
`resources/engine/linux`), plus the puzzle database. The database is the bulk of
the download.

### AppImage cannot be built on Windows

Two separate blockers, and the second is fatal:

1. AppImage's internal layout uses Unix symlinks, which Windows refuses to
   create for an unprivileged process (`EPERM ... symlink`). Running the build
   elevated clears this one.
2. An AppImage *is* a squashfs image, and electron-builder's AppImage toolchain
   ships `mksquashfs` for `darwin`, `linux-arm32`, `linux-arm64`, `linux-ia32`
   and `linux-x64` — and nothing for Windows. On Windows it falls back to the
   macOS binary and fails with `ENOENT`.

Elevation is therefore necessary but not sufficient. Dropping a Windows-native
`mksquashfs` into the expected path is possible but a bad idea: NTFS carries no
executable bit, so the resulting image would ship a non-executable `AppRun` and
app binary, and the failure would only show up on Linux.

`scripts/build-appimage.ps1` is kept for building from an elevated shell *on a
machine that can*, and it checks elevation before starting rather than failing
at the last step.

To actually produce one, use a Linux environment:

```bash
npm run dist:linux                       # on any Linux machine
```

```bash
docker run --rm -v ${PWD}:/project -w /project electronuserland/builder:latest   sh -c "npm ci && node node_modules/electron/install.js && npm run dist:linux"
```

Or run `.github/workflows/build.yml`, which builds both targets on real runners.

### The Linux tarball

Buildable from Windows, and the artifact shipped from here:

```bash
npm run dist:linux -- tar.gz            # -> release/*.tar.gz
```

It contains the same application: Linux Stockfish, the puzzle database, and the
asar. Because it is packed on Windows, the executable bit may not survive, so
after unpacking:

```bash
chmod +x chess-trainer chrome-sandbox resources/engine/stockfish
./chess-trainer
```

`engine.ts` already restores the engine's executable bit at runtime, so in
practice only the launcher itself needs the `chmod`.

## The web build

There is a second target: the same app as an installable web page, for playing
on a phone. It shares the entire renderer and swaps only the layer under
`window.chess` — WASM Stockfish instead of the native binary, sharded JSON
instead of SQLite, IndexedDB instead of a file.

```bash
npm run web:puzzles   # once: sample the database into JSON bands
npm run web:assets    # pieces, WASM engine, PWA icons
npm run web:build     # -> dist-web/
```

`dist-web/` is static files for any HTTPS host. Playing a friend is the one
feature it drops, because a browser cannot open a listening socket. Full
details, sizes, and deployment steps are in [docs/PWA.md](docs/PWA.md).

## How the puzzle queries stay fast

The obvious query — filter on a rating *range* and `ORDER BY random_key LIMIT n`
— can't use the `(rating, rnd)` index for ordering, because the random key is
only sorted within a single rating value. SQLite sorts every candidate row in a
temp B-tree instead. Over six million puzzles that costs about 62ms, and the
daily puzzle's extra popularity filters pushed it to **14.8 seconds**.

Pinning rating to a single *value* turns the same query into a pure index seek.
So `build-indexes.mjs` precomputes cumulative puzzle counts per rating (and per
theme/rating pair), and the app picks one rating from inside the requested band —
weighted by those counts, so the draw is still uniform across puzzles — before
seeking into the index at a random offset.

| Query | Before | After |
| --- | --- | --- |
| Random puzzle in a rating band | 62 ms | 0.38 ms |
| Themed puzzle | 64 ms | 1.2 ms |
| Daily puzzle | 14,797 ms | 0.10 ms |
| Theme statistics | 2,621 ms | 0.21 ms |

The daily puzzle also gets its own pre-filtered, contiguously numbered pool, so
selecting one is a primary-key lookup.

## A note on the dump format

`lichess_db_puzzle.csv.zst` is not a plain zstd stream. It's a chain of
independently compressed ~32MiB frames, each preceded by a 12-byte zstd
*skippable* frame whose payload holds the next frame's compressed length — a
layout that lets a client seek into the middle of the file. libzstd walks past
skippable frames transparently, but Node's `ZstdDecompress` stops at the first
frame boundary and then rejects the skippable header with "Unknown frame
descriptor". `scripts/lib/zstd-frames.mjs` walks the chain itself.

## Project layout

```
src/main/         Electron main process
  engine.ts       Stockfish UCI driver, including sub-1320 Elo emulation
  db.ts           Puzzle queries against the SQLite database
  profile.ts      Glicko ratings, game history, spaced-repetition lessons
  ipc.ts          The complete privileged surface exposed to the renderer
src/preload/      Context-bridge API
src/renderer/     React UI, shared by both builds
  components/     Board, PuzzleSolver, EvalBar, MoveList
  views/          Home, Play, Puzzles, Daily, Learn, Games, Analysis, Settings
  data/           Opponents, puzzle-theme metadata, the curriculum
  themes/         Board themes and piece-set registry
src/web/          Browser build
  platform/       WASM engine, JSON puzzles, IndexedDB profile
  public/         Puzzle bands, piece art, engine, PWA icons
scripts/          Asset fetching, database construction, and piece generation
```

## Licensing

The app bundles third-party assets under their own terms:

- **Stockfish** — GPLv3. Bundled unmodified as a separate executable.
- **Lichess puzzle database** — CC0.
- **Piece sets** — terms vary per set. Fifteen of the forty Lichess sets are
  CC BY-NC-SA, which permits personal use but **not** commercial distribution.
  The Settings screen flags these individually. Drop them if this is ever sold.
  The forty-first set, `bunny`, is generated by this project.
- **Application icon** — the white knight from the **Chessnut** set by
  Alexis Luengas, Apache 2.0, used unmodified apart from scaling. The source is
  `build/icon.svg`; regenerate the PNG with `npm run assets:icon`. Attribution
  is recorded in `NOTICE`.

  The icon deliberately comes from a set already bundled here rather than from a
  web search: image results are overwhelmingly copyrighted, and an application
  icon is the last place to inherit an unknown licence. Chessnut was chosen for
  holding the clearest silhouette at taskbar size and for adding no copyleft
  obligation of its own. Other permissive options already on disk are `celtic`,
  `fantasy`, and `spatial` (MIT), `rhosgfx` (CC0), and `cburnett` (GPLv2+).

Because Stockfish is GPLv3 and is shipped alongside the app, distributing the
packaged build means complying with the GPL.

## Clock behaviour

A few rules that are easy to get wrong, and that this implements deliberately:

- Time is derived from `performance.now()` deltas rather than counted ticks, so
  the clock cannot drift, and a throttled background window still applies the
  correct elapsed time on its next update.
- The increment is credited *after* the mover is charged for the time they
  used, so a move made with 0.2s left still flags.
- Flagging is only a loss if the opponent has mating material. Against a lone
  king, or a king and one minor piece, it is a draw.
- A game where nobody moved is aborted rather than rated — walking away from a
  1+0 board costs nothing.
- Takebacks are disabled in timed games.

## Peer play, and two bugs worth remembering

Both were found by driving two real app instances against each other rather than
by reading the code, and both were invisible until the clocks were compared
side by side:

- The socket listeners were registered once with an empty dependency array, so
  they captured the **first render's** state — taken before the two peers had
  agreed a time control, when it was still "Untimed". Every clock call from a
  received message was therefore a no-op, and a finished game's clock kept
  running for minutes. Handlers are now rebound each render and invoked through
  a ref.
- Adopting the host's clock values did not switch whose clock was running, so
  the guest quietly charged the wrong player. The turn is switched first, then
  the authoritative values are applied.

## Sound

The move sounds are synthesised, not sampled. Chess.com's audio is copyrighted,
and Lichess lists its own sound sets under **"Exceptions (non-free)"**, so
neither can be reused — these are modelled from scratch and belong to the
project.

What makes a knock sound like wood is *modal* content: a struck object rings at
several frequencies at once, each decaying at its own rate, with the higher
modes dying fastest. Each sound is a sum of exponentially-damped sinusoids plus
a very short broadband transient for the initial contact. The earlier version
was a filtered noise burst, which reads as "shh" rather than "tock" because it
has no modal structure at all.

| | Fundamental | Length to -40dB |
| --- | --- | --- |
| Move | 330 Hz, four modes | 130 ms |
| Capture | 260 Hz, five modes, stronger transient | 160 ms |
| Castle | 295 Hz, two hits 85ms apart | 225 ms |

Every hit is played back with slight random pitch and level variation, because
a real board never repeats exactly and the repetition is obvious without it.

`npm run sounds:preview` renders the sounds to WAV files and reports what they
actually contain — dominant partials, decay time, and headroom. It reads the
mode table out of `sound.ts` rather than duplicating it, so the preview cannot
drift from what the app plays. The check that matters is the control frequency:
energy at a frequency with no mode should be hundreds of times quieter than the
modes, which is what distinguishes modal synthesis from filtered noise.

## Memory

Measured on the packaged Windows build, working set across all processes.

Three Stockfish processes used to be created on demand and then kept forever,
each holding a hash table on top of a ~150MB baseline — the NNUE evaluation
networks alone are 125MiB and are resident per process. After playing a game,
analysing, and taking a hint, that reached **1.67GB**.

| | Before | After |
| --- | --- | --- |
| Idle, nothing used | 390 MB | 390 MB |
| After play + analysis + review | 1674 MB | 1056 MB |
| Idle again, 3 minutes later | 1674 MB | ~390 MB |

Three changes, in order of what they bought:

- **Review shares the analysis engine.** They are never used simultaneously —
  review backs the hint button, analysis backs the Analysis screen — so the
  third process was pure cost.
- **Idle engines are shut down** after three minutes, and restart transparently
  on next use. This is what returns a long session to its idle footprint.
- **Smaller hash tables**: analysis 256MB to 128MB, play 64MB to 32MB.

The play hash was sized by measurement rather than taste. On a 2s search, 16MB
cost roughly ten ply of depth against larger tables, while 32MB came within a
couple of ply — so 16MB was rejected and 32MB kept. Every size found the same
move, and nodes per second barely moved.

The remaining ~390MB is Chromium itself (GPU, renderer, network, and main
processes) and is not meaningfully reducible without hurting rendering.

## Known gaps

- **No opening book or repertoire trainer.** The opening module teaches
  principles rather than lines.
- **Game review is manual.** You can analyse a finished game position by
  position, but there's no automated blunder-annotation pass over a whole game.
- **Discovery is local-network only**, by design — it relies on multicast, which
  does not cross subnets or the internet.
- **Peer play is local-network only.** There is no relay, so playing across the
  internet needs port forwarding. The protocol was built to allow a relay to be
  added without changing the client.
- **No Discord integration.** Discord's Social SDK (which does offer lobbies) is
  C++/Unity/Unreal only and explicitly excludes web, so it cannot be reached
  from Electron without a native addon. Rich Presence is feasible from Node and
  would give a working Join button, but Discord relays no game data — the
  connection still has to be ours.
- **Windows only as packaged.** The code is cross-platform; `paths.ts` already
  picks the right binary name, but only the Windows Stockfish build is fetched
  and only an NSIS target is configured.
