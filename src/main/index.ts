import { app, BrowserWindow, shell, nativeTheme } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc.js'

let mainWindow: BrowserWindow | null = null
let disposeIpc: (() => Promise<void>) | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#f6f7f9',
    title: 'Chess Trainer',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      // The renderer is plain UI code; everything privileged goes through IPC.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  // Avoid the white flash before React has painted anything.
  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Any attempt to open a new window becomes an external browser navigation
  // instead, so the app itself can never be navigated away from.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl)
  } else {
    mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

// A second instance would fight over the profile file, so hand off to the first.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    disposeIpc = registerIpc(() => mainWindow)
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // Stockfish is a child process; without this it can outlive the app.
  app.on('before-quit', async (event) => {
    if (!disposeIpc) return
    event.preventDefault()
    const dispose = disposeIpc
    disposeIpc = null
    await dispose()
    app.quit()
  })
}
