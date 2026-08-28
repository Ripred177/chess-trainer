/**
 * Rasterises the app icon SVG to PNG using Electron's own renderer.
 *
 * There is no image library in this toolchain, but Chromium is already a
 * dependency, so it does the rasterising: load the SVG into an offscreen window
 * sized to the target and capture it. That also means the PNG is rendered by
 * exactly the engine that will draw the app.
 *
 * Usage: electron scripts/icon/render-icon.mjs <svgPath> <outPath> <size>
 */

import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const [, , svgArg, outArg, sizeArg] = process.argv
const svgPath = resolve(svgArg)
const outPath = resolve(outArg)
const size = Number(sizeArg) || 1024

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const svg = readFileSync(svgPath, 'utf8')

  const win = new BrowserWindow({
    width: size,
    height: size,
    useContentSize: true,
    show: false,
    // A transparent frame keeps whatever alpha the SVG defines.
    transparent: true,
    frame: false,
    webPreferences: { offscreen: false }
  })

  const html = `<!doctype html><meta charset="utf-8">
    <style>
      html,body{margin:0;padding:0;width:${size}px;height:${size}px;background:transparent;overflow:hidden}
      svg{display:block;width:${size}px;height:${size}px}
    </style>${svg}`

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  // One frame is not always enough for gradients and filters to settle.
  await new Promise((r) => setTimeout(r, 400))

  const image = await win.webContents.capturePage()
  const png = image.toPNG()
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, png)

  const { width, height } = image.getSize()
  console.log(`wrote ${outPath} (${width}x${height}, ${(png.length / 1024).toFixed(1)} KB)`)

  win.destroy()
  app.quit()
})
