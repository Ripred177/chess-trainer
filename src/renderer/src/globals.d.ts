/**
 * Build-time constants substituted by Vite (`define`).
 *
 * `__IS_WEB__` is declared rather than defined so the desktop and web configs
 * can each supply their own value; code guards with `typeof` so neither bundle
 * depends on the other having set it.
 */
declare const __IS_WEB__: boolean
declare const __APP_VERSION__: string
