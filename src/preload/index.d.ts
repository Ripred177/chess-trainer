import type { ChessApi } from './index.js'

/**
 * Bulk offline caching of the puzzle data. Present only in the web build —
 * the desktop app ships the whole database on disk, so there is nothing to
 * download. Callers must treat it as optional.
 */
export interface OfflineApi {
  /** Fetch every rating band so the app works with no network. */
  downloadAll: (onProgress?: (done: number, total: number, label: string) => void) => Promise<void>
  /** How much is already cached. `bytes` is 0 when the size is unknown. */
  status: () => Promise<{ ready: number; total: number; bytes: number }>
}

declare global {
  interface Window {
    chess: ChessApi
    chessOffline?: OfflineApi
  }
}

export {}
