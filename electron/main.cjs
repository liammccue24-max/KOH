const { app, BrowserWindow, protocol, net } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

// Chromium refuses to load <script type="module"> from file:// at all --
// this is hardcoded per the HTML spec (module scripts always fetch in CORS
// mode, and file:// pages have a "null" origin that can never satisfy
// that), independent of the crossorigin attribute. The documented Electron
// fix is a custom privileged scheme instead of file://, which gets a real
// origin and can serve the built app exactly like a normal web server
// would. Must be registered before app.whenReady().
const APP_SCHEME = 'app'
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
])

const distDir = path.join(__dirname, '..', 'dist')

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'KOH Etch Simulator',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.loadURL(`${APP_SCHEME}://app/index.html`)
}

app.whenReady().then(() => {
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url)
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
    const filePath = path.normalize(path.join(distDir, pathname))
    if (!filePath.startsWith(distDir)) return new Response('Forbidden', { status: 403 })
    return net.fetch(pathToFileURL(filePath).toString())
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
