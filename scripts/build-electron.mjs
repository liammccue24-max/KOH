// Prepares dist/ for Electron packaging after `ELECTRON_BUILD=1 vite build`.
// With base:'./' (see vite.config.ts), Vite already emits correct relative
// paths everywhere, including recomputing the CSS's public/ dir font
// references (e.g. /fonts/X.ttf -> ../fonts/X.ttf, accounting for the CSS
// file's own location under dist/assets/) -- no extra rewriting needed
// there. Two things still don't work under file://, confirmed by actually
// loading the built dist/index.html via file:// in a browser (not just
// inspecting the HTML):
//  - Vite marks its <script type="module"> and <link rel="stylesheet">
//    tags `crossorigin`, which forces a CORS-mode fetch even for same-app
//    local files; file:// pages have a "null" origin, so Chromium (and
//    Electron's, since it's the same engine) refuses the request outright
//    ("Cross origin requests are only supported for protocol schemes:
//    chrome, ... http, https") and the whole app fails to load. Stripped
//    here rather than working around it with webSecurity:false, which
//    would disable real cross-origin protections app-wide for no reason.
//  - The sample-file loader's fetch() fallback isn't reliable for local
//    file:// pages either, so the sample GDS is embedded as base64 here
//    instead, the same way scripts/pack-artifact.mjs already does for the
//    Claude Artifact build, using App.tsx's existing
//    window.__EMBEDDED_SAMPLE_GDS_BASE64__ check.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const distDir = resolve(root, 'dist')

const gdsB64 = readFileSync(resolve(root, 'public/sample-koh-mask.gds')).toString('base64')
const indexPath = resolve(distDir, 'index.html')
let html = readFileSync(indexPath, 'utf-8')
html = html.split(' crossorigin').join('')
html = html.replace(
  '<div id="root"></div>',
  `<div id="root"></div>\n    <script>window.__EMBEDDED_SAMPLE_GDS_BASE64__ = ${JSON.stringify(gdsB64)};</script>`,
)
writeFileSync(indexPath, html)

console.log(`Electron dist prepared at ${distDir}`)
