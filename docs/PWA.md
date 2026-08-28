# The web build (PWA)

The same app, running in a browser, installable to an iPhone or Android home
screen and playable with the network switched off.

It compiles the *same* renderer as the desktop app. Only the layer underneath
`window.chess` differs, and that lives entirely in `src/web/platform/`:

| | Desktop | Web |
|---|---|---|
| Engine | Stockfish 18 native, UCI over stdio | Stockfish (2019 build) WASM in a Web Worker |
| Puzzles | 6.1M rows in a 3.1GB SQLite file | 1,008,000 rows in 48 sharded JSON bands |
| Profile | JSON file in Electron's userData | IndexedDB |
| Play a friend | TCP + UDP multicast discovery | **not available** — the section is removed |

Everything else — puzzles, daily puzzle and streak, the 40 lessons, analysis,
game history with engine review, board themes, piece sets and recolouring,
sounds, clocks and all the time controls — is the desktop feature set,
unchanged.

## Build it

```bash
npm run web:puzzles
```

```bash
npm run web:assets
```

```bash
npm run web:build
```

- `web:puzzles` samples the SQLite database into `src/web/public/puzzles/`.
  It needs `resources/puzzles.db`, so run `npm run puzzles:build` first if you
  have not. You only need this once; the output is deterministic.
- `web:assets` mirrors the piece art, copies the WASM engine, and rasterises
  the PWA icons.
- `web:build` typechecks and writes `dist-web/`.

To work on it locally:

```bash
npm run web:dev
```

To check a production build before deploying:

```bash
npm run web:preview
```

## What it weighs

| | Size |
|---|---|
| App shell (JS + CSS, gzipped) | 141 KB |
| Stockfish WASM | 2.2 MB |
| Piece art (17 sets) | 2.5 MB |
| Icons | 0.25 MB |
| **Precached on install** | **~4.5 MB** |
| Puzzle shards (48 × ~3 MB) | 141 MB raw, 48 MB over the wire |

Puzzle shards are **not** precached. Each covers 50 rating points, and a
request loads only the shard nearest the rating asked for — one file, about
1 MB gzipped, then cached forever. So a normal install downloads about 4.5 MB
and grows by roughly 1 MB per rating neighbourhood actually played.

Narrow shards are what make filtering by an uncommon motif work. At 1400-1600
the set holds 84,000 puzzles rather than 9,000, and the number of themes with
fewer than ten positions at that level falls from 13 to 1.

## Deploy it

`dist-web/` is plain static files. Any static host works, and the app makes no
network calls of its own, so no backend and no CORS configuration is involved.

**A service worker requires HTTPS.** All three hosts below provide it. Opening
`dist-web/index.html` from the filesystem (`file://`) will *not* work — the
service worker will not register and the app cannot be installed.

### Cloudflare Pages

```bash
npx wrangler pages deploy dist-web --project-name chess-trainer
```

The first run creates the project and prompts you to log in. It returns a
`https://chess-trainer.pages.dev` URL.

### Netlify

```bash
npx netlify-cli deploy --dir dist-web --prod
```

### GitHub Pages

`.github/workflows/pages.yml` builds and publishes on every push to `main`.
Enable it once, under **Settings → Pages → Source: GitHub Actions** — not
"Deploy from a branch", or the workflow never runs.

A project site is served from `https://<user>.github.io/<repo>/`, so the build
needs a base path or every asset resolves to the wrong place. The workflow
takes it from `actions/configure-pages`, and the Vite config normalises it, so
a user site at the root needs no special handling either.

To reproduce the CI build locally:

```bash
BASE_PATH=/chess-trainer npm run web:build
```

On Git Bash for Windows, prefix that with `MSYS_NO_PATHCONV=1` — otherwise the
shell rewrites `/chess-trainer` into a Windows path and the build silently
comes out pointing at `C:/Program Files/...`.

Two assets are committed rather than generated in CI:

- **`src/web/public/puzzles/`** — its source is a 3GB database that cannot live
  in a repository. The workflow fails with an explicit message if it is
  missing rather than publishing a site with no puzzles.
- **`src/web/public/icons/`** — rasterising them needs Electron, and therefore a
  display, which a runner does not have. Regenerate with `npm run web:icons`
  whenever `build/icon.svg` changes.

Piece art and the WASM engine are copied by `npm run web:assets` on every run,
so they stay out of version control.

### Serving it yourself

Two requirements beyond static files:

- `sw.js` must be served from the site root with `Content-Type:
  text/javascript` and **without** long-lived caching, or updates will not
  reach people who already installed it.
- Unknown paths should fall back to `index.html`.

### Serving it from your own laptop

No hosting account, nothing leaves the house — the laptop serves the app to
phones on the same Wi-Fi.

```bash
npm run web:cert
```

```bash
npm run web:serve
```

The catch is that a service worker only registers in a *secure context*:
https, or localhost. A phone reaching the laptop at `http://192.168.x.x` is
neither. Clicking past a certificate warning does not help — an untrusted
certificate is not a secure context either. So `web:cert` builds a small
certificate authority, signs one server certificate with it, and `web:serve`
serves over https on 8443. Port 8080 stays on http purely to hand out the CA,
since the phone has no way to fetch it over a connection it does not yet trust.

On the phone, once:

1. Open `http://<laptop-ip>:8080/ca.crt`.
2. **iOS** — Settings shows *Profile Downloaded*; install it. Then
   Settings → General → About → **Certificate Trust Settings** and switch it on
   for "Chess Trainer Local CA". That second step is separate and easy to miss;
   without it the certificate is installed but not trusted.
   **Android** — Settings → Security → Encryption & credentials →
   *Install a certificate* → **CA certificate**.
3. Open `https://<laptop-ip>:8443` and install the app.

What that CA can do is worth being clear about: while trusted, it could vouch
for any site to that phone. The private key is generated on your laptop, stays
in `certs/`, and signs exactly one certificate. Deleting `certs/` and removing
the profile from the phone undoes it completely. If you would rather not, the
next option avoids it.

Once the app is installed the service worker has cached it, so it opens and
plays with the laptop shut. Only puzzle bands you have never visited need the
server again.

**Without the certificate**, run `npm run web:serve:http` and open
`http://<laptop-ip>:8080`. It plays perfectly. iOS will still let you Add to
Home Screen, but nothing is cached, so it needs the laptop running every time.
Android will not offer to install it at all.

## Install it on a phone

1. Open the URL in **Safari** (iOS) or **Chrome** (Android).
2. iOS: Share → *Add to Home Screen*. Android: the ⋮ menu → *Install app*, or
   the install prompt that appears on its own.
3. Launch it from the home screen. It opens without browser chrome and works
   with the network off.

iOS only offers *Add to Home Screen* from Safari — Chrome on iOS cannot install
a PWA. This is an Apple restriction, not something the app can work around.

## Things worth knowing

**The web engine is weaker than the desktop one.** The browser build is
Stockfish 2019 compiled to WASM, single-threaded with a 16MB hash, and it
searches roughly fifteen times slower than the native binary. It also does not
support `UCI_LimitStrength`, so *every* rung of the ladder is emulated by
searching shallowly and sampling among several candidate moves — the same
technique the desktop app uses below 1320, extended across the whole range. The
bots feel the same; the top of the ladder is not genuinely 3190.

**Storage is per-browser and per-origin.** Your profile lives in that browser's
IndexedDB. It does not sync between your phone and your laptop, and clearing
site data erases it. Settings → Profile → Export writes a JSON file you can
import on another device.

**Private browsing may refuse IndexedDB.** The app still runs, but nothing is
saved; Settings → Profile says so rather than failing silently.

**Puzzles are a sample, not the whole database.** 1,008,000 of the 6.1M, evenly
spread across 48 fifty-point shards. The full export is possible but a poor
trade: 840MB raw would put two shards over GitHub's hard 100MB per-file limit,
leave a GitHub Pages site at 84% of its 1GB ceiling, and turn "download all"
into 295MB — to deepen motifs that a million already covers. Adjust either way
with `node scripts/build-web-puzzles.mjs --per-band N`.

**Playing a friend is desktop-only.** It needs a listening socket and UDP
multicast for LAN discovery. A browser has neither, so the section is removed
from the web build rather than shown as a screen that cannot work.
