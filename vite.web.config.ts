import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }

/**
 * Vite needs a base with both a leading and a trailing slash. GitHub's
 * configure-pages action emits "/repo-name" without the trailing one, so
 * normalise rather than depending on either end getting it right.
 */
function normaliseBase(value: string | undefined): string {
  // Split on the separator rather than stripping with a regex: the segments
  // are what matter, and this treats "repo", "/repo", "/repo/" and "" alike.
  const segments = (value ?? '').trim().split('/').filter(Boolean)
  return segments.length > 0 ? `/${segments.join('/')}/` : '/'
}

/**
 * The browser build.
 *
 * It compiles the same renderer as the desktop app; only the platform layer
 * underneath `window.chess` differs (src/web/platform). Set BASE_PATH when
 * deploying to a subdirectory — GitHub Pages project sites need
 * `BASE_PATH=/chess-trainer/`.
 */
export default defineConfig({
  root: resolve('src/web'),
  base: normaliseBase(process.env.BASE_PATH),
  publicDir: resolve('src/web/public'),

  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    /** Lets shared components drop desktop-only features from the bundle. */
    __IS_WEB__: 'true'
  },

  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },

  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],

      manifest: {
        name: 'Chess Trainer',
        short_name: 'Chess',
        description:
          'Play Stockfish at any Elo, solve a hundred thousand puzzles, and learn from beginner to expert — entirely offline.',
        // No explicit `id`: it resolves against the ORIGIN, not the manifest,
        // so a literal "/" would be the same app identity for every project
        // site on a github.io account. Omitting it defaults the identity to
        // start_url, which is unique per subdirectory.
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0f1115',
        theme_color: '#0f1115',
        categories: ['games', 'education'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },

      workbox: {
        // The engine alone is 1.6MB and the puzzle bands are ~1.3MB each, so
        // the default 2MB precache ceiling has to come up.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,

        // Precache the shell, the art, and the engine — everything needed to
        // start and play a game with no network at all.
        // The index and the daily pool are precached by name: they are small
        // (~0.29MB together) and they are what makes the app useful the first
        // time it opens with no network. The rating bands are not — they are
        // 15MB, and most players never touch more than two of them.
        globPatterns: [
          '**/*.{js,css,html,wasm,svg,png,woff2}',
          'puzzles/index.json',
          'puzzles/daily.json'
        ],

        // Puzzle bands are large, numerous, and immutable. Caching them on
        // first use keeps the install small while still working offline for
        // any band the player has actually opened.
        runtimeCaching: [
          {
            urlPattern: /\/puzzles\/.*\.json$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'puzzle-bands',
              // 12 bands + the daily pool + the index, with room to spare, so
              // a full offline download is never evicted part-way.
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ],

        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html'
      },

      devOptions: { enabled: false }
    })
  ],

  build: {
    outDir: resolve('dist-web'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      output: {
        // chess.js and the React runtime change far less often than app code;
        // splitting them keeps repeat downloads to the app chunk alone.
        manualChunks: {
          react: ['react', 'react-dom'],
          chess: ['chess.js']
        }
      }
    }
  },

  server: { port: 5174, host: true }
})
