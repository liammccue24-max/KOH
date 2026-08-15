// Packs the Vite production build (dist/) into a single self-contained HTML
// file for publishing as a Claude Artifact: fonts and the sample GDS file
// are inlined as base64 data URIs, CSS and JS are inlined directly, and the
// "/sample-koh-mask.gds" fetch path used by the real app's sample button is
// rewritten to a data: URI (fetch() can read those directly) since there is
// no server to serve it from inside the artifact sandbox.
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
const gdsDataUri = `data:application/octet-stream;base64,${gdsB64}`
const before = js.length
js = js.split('`/sample-koh-mask.gds`').join(`\`${gdsDataUri}\``)
if (js.length === before) {
  console.warn('Warning: sample GDS fetch path literal not found in bundle -- sample button may not work in the packaged artifact.')
}

const html = `<title>KOH Etch Simulator</title>
<style>
${css}
</style>
<div id="root"></div>
<script type="module">
${js}
</script>
`

const outPath = resolve(root, 'artifact-build/koh-etch-simulator.html')
writeFileSync(outPath, html)
console.log(`wrote ${outPath} (${(html.length / 1024 / 1024).toFixed(2)} MB)`)
