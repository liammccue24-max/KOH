// Packs the Vite production build (dist/) into a single self-contained HTML
// file for publishing as a Claude Artifact: fonts are inlined into the CSS
// as base64 data URIs, CSS and JS are inlined directly, and the sample GDS
// file is embedded as a base64 global (window.__EMBEDDED_SAMPLE_GDS_BASE64__)
// that App.tsx reads directly via atob() instead of fetch() -- artifact
// hosting sandboxes can apply a CSP that blocks fetch() entirely, even for
// same-document data: URIs, so avoid the network stack altogether here.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const distDir = resolve(root, 'dist')
const assetsDir = resolve(distDir, 'assets')

const assetFiles = readdirSync(assetsDir)
const cssFile = assetFiles.find((f) => f.endsWith('.css'))
const jsFile = assetFiles.find((f) => f.endsWith('.js'))
if (!cssFile || !jsFile) throw new Error('Could not find built CSS/JS in dist/assets -- run `npm run build` first.')

let css = readFileSync(resolve(assetsDir, cssFile), 'utf-8')
let js = readFileSync(resolve(assetsDir, jsFile), 'utf-8')

const fontDir = resolve(root, 'public/fonts')
for (const fontFile of readdirSync(fontDir)) {
  const b64 = readFileSync(resolve(fontDir, fontFile)).toString('base64')
  const dataUri = `data:font/ttf;base64,${b64}`
  css = css.split(`/fonts/${fontFile}`).join(dataUri)
}

const gdsB64 = readFileSync(resolve(root, 'public/sample-koh-mask.gds')).toString('base64')

const html = `<title>KOH Etch Simulator</title>
<style>
${css}
</style>
<div id="root"></div>
<script>window.__EMBEDDED_SAMPLE_GDS_BASE64__ = ${JSON.stringify(gdsB64)};</script>
<script type="module">
${js}
</script>
`

const outPath = resolve(root, 'artifact-build/koh-etch-simulator.html')
writeFileSync(outPath, html)
console.log(`wrote ${outPath} (${(html.length / 1024 / 1024).toFixed(2)} MB)`)
