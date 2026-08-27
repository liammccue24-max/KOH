# KOH Anisotropic Etch Simulator

A browser-based tool that loads a GDSII mask layout and previews how it
etches into a (100)-oriented silicon wafer in KOH (potassium hydroxide),
the standard anisotropic wet etch used in MEMS/microfabrication.

Upload a `.gds` file, pick which drawn layer is the etch mask, and scrub
through etch time to see the resulting 3D topography and a 2D cross-section.
A sample file with four illustrative mask shapes is included at
`public/sample-koh-mask.gds` (also offered for download from the app once a
GDS is loaded — see "Loading your own design" below for how it was made).

## Running it

```sh
npm install
npm run dev      # dev server
npm run build    # production build to dist/
npm test         # vitest unit tests
```

## Deployment

`.github/workflows/deploy-pages.yml` builds and publishes this app to GitHub
Pages on every push to `main`. It builds with `GH_PAGES_BASE=/KOH/` so asset
URLs resolve correctly under GitHub Pages' project-site subpath
(`vite.config.ts` falls back to `base: '/'` otherwise, so local dev, `vite
preview`, and the self-contained artifact build in
`scripts/pack-artifact.mjs` are unaffected). One-time setup: in the repo's
Settings → Pages, set Source to "GitHub Actions" — after that the workflow
runs automatically on every push to `main`, and the site is served at
`https://liammccue24-max.github.io/KOH/`.

## Windows executable

```sh
npm run electron:build:win   # builds release/KOH-Etch-Simulator-<version>.exe
npm run electron:dev         # runs the Electron shell locally against a fresh build
```

`electron/main.cjs` is a minimal Electron main process: one `BrowserWindow`,
no Node integration or IPC, since the app has no need for either. It's built
from the same `dist/` as every other target, with two adjustments specific
to loading from disk rather than a server:

- **`vite.config.ts`'s `base` is `'./'`** (via `ELECTRON_BUILD=1`) instead of
  `/` or `/KOH/`, so asset URLs are relative to `index.html` rather than
  resolving against a server root that doesn't exist for a local file.
- **The window loads a custom `app://` scheme, not `file://`.** Chromium
  refuses to load `<script type="module">` from `file://` at all — this is
  hardcoded per the HTML spec (module scripts always fetch in CORS mode,
  and a `file://` page's origin is `null`, which can never satisfy that),
  independent of the `crossorigin` attribute Vite also adds (also stripped
  in `scripts/build-electron.mjs`, though that alone isn't sufficient).
  `main.cjs` registers `app` as a privileged, standard, CORS-enabled scheme
  and serves `dist/` through it via `protocol.handle`, giving the page a
  real origin the same way an http(s) server would, without disabling
  `webSecurity` (which would remove real cross-origin protections app-wide
  to work around a problem that's specific to `file://`). Confirmed working
  end-to-end (module script loads, WebGL scene renders, sample design
  simulates) by actually running the packaged Electron app headlessly, not
  just inspecting the built output.
- The sample-file loader's `fetch()` fallback isn't reliable under a local
  scheme either, so `scripts/build-electron.mjs` embeds the sample GDS as
  base64 into `dist/index.html`, the same mechanism `scripts/pack-artifact.mjs`
  already uses for the Claude Artifact build (`App.tsx`'s existing
  `window.__EMBEDDED_SAMPLE_GDS_BASE64__` check).

The build is unsigned (no code-signing certificate configured), so Windows
SmartScreen will show an "Unknown publisher" warning on first run — click
"More info" → "Run anyway". This is expected for any indie app distributed
without a paid certificate, not a sign of a broken build.

## What it models

KOH etches single-crystal (100) silicon anisotropically: the {111}
crystal planes etch far slower than {100}, so mask openings with edges
aligned to the wafer's <110> flats (i.e. Manhattan/rectilinear mask
geometry, the overwhelmingly common case) etch into pits bounded by {111}
sidewalls at a fixed **54.74°** from the wafer surface.

This tool implements the standard geometric model for that regime:

- **Concave corners of an opening are self-limiting.** For a point a
  perpendicular distance `s` inside an opening from the nearest mask edge,
  the etch front reaches it at depth `d = s·√2` (since `tan(54.74°) = √2`),
  capped by `rate₍₁₀₀₎ × time`. This is exactly a Euclidean distance
  transform of the mask scaled by `√2`, and it naturally reproduces
  self-terminating inverted pyramids (square openings) and flat-bottomed
  V-grooves (elongated openings) without any special-casing.
- **Convex corners of the protected silicon are not stable.** Real KOH
  etching exposes faster planes there and undercuts the mask. This is
  approximated by seeding a growing "undercut disk" at each convex mask
  corner (detected once from the drawn geometry) and eroding the mask
  faster than the vertical etch front, at a separately adjustable rate.

The core algorithm lives in `src/sim/etchSim.ts`; `src/sim/edt.ts` is an
exact O(n) squared Euclidean distance transform (Felzenszwalt & Huttenlocher),
and `src/sim/corners.ts` detects convex mask corners on the raster grid.

**Resolution is always local, never wafer-scale.** The {111} slope's lateral
extent is only `depth/√2` — a few tens of microns even for a fairly deep
etch — so sizing the simulation grid to a wafer/die outline would spread
that slope across a fraction of a single cell. Instead, `simulateEtch` always
sizes its grid tightly around just the mask geometry it's given, and
`src/lib/clusterPolygons.ts` first splits the mask layer's polygons into
spatially-separate groups (union-find over gap-expanded bounding boxes), so
several widely-scattered features (e.g. four windows in the corners of a
150mm wafer) each get their own full-resolution grid instead of sharing one
grid stretched across the whole span. A wafer/die outline layer, if set, is
rendered as a separate flat mesh built directly from its polygon (no etch
physics, since it's context, not a feature to etch) -- with each patch's
own bounding box cut out of it entirely (not just offset slightly below
it) so the two meshes never overlap.

**With domain margin off, an outline layer's real geometry can also drive
the simulation itself**, not just the flat context mesh. `computeDomainBox`
in `etchSim.ts` looks for outline polygons that overlap a given mask
cluster's bbox and, if found, uses their bounding box as the domain --
letting a genuinely-designed die outline or compensation boundary define
how far the simulated silicon extends, instead of a guessed percentage.
This still respects the wafer-scale lesson above: the outline's
contribution is clamped to `MAX_BOUNDARY_MARGIN_MULTIPLE` (4x) the mask
cluster's own span on each side, so a single wafer-scale outline shared by
several scattered windows still gives each one a small, locally-relevant
domain rather than ballooning back out to wafer scale. An earlier version used a small
constant Y offset instead; that only worked by coincidence at the scale it
was tested at; z-buffer precision at a given camera distance doesn't scale
down the same way a small design's overall span does, so the same offset
that was invisible on a large wafer was enough to z-fight and hide a small
patch entirely on a design a few hundred microns across. See
`WaferScene.tsx`'s `buildContextGeometry`.

**Normals are computed analytically, not via `computeVertexNormals()`.**
Each etch patch is a regular height-field grid, so its per-vertex normals
are derived directly from finite differences against neighboring grid
positions (`computeHeightFieldNormals` in `WaferScene.tsx`) rather than
Three.js's generic per-face implementation. Profiled back to back on
identical geometry, the generic version was 3-10x slower and highly
variable — it accumulates through per-triangle temporary vectors, so it
creates a lot of short-lived garbage that shows up as GC pauses on every
parameter change. Geometries built by hand (rather than declared as JSX
children) also aren't disposed automatically by react-three-fiber, so
`WaferScene` explicitly disposes the previous patch/context geometries
whenever a new one replaces them — otherwise every parameter change leaks
their GPU-side buffers.

**The camera re-frames when the scene's depth grows past what it was set
up for.** A patch's lateral span isn't a safe bound on how tall the scene
actually gets: self-limiting geometry normally keeps depth well under the
lateral span, but a fully-undercut patch (nothing left protected, so
there's no longer any protected-mask distance to measure against) is
capped only by `rate × time`, which can grow far past the lateral domain —
e.g. a small mesa fully consumed by undercut, still etching a flat,
arbitrarily deep floor as etch time increases. `SceneContent` folds the
worst-case depth (`maxPossibleDepthUm`) into the framing span and re-runs
camera positioning (in a `useEffect`, so `OrbitControls`' own
`minDistance`/`maxDistance` props are current by the time its `update()`
call clamps against them — doing this inline mid-render clamped against
the *previous* render's still-small values) whenever the required span
grows past what the camera was last framed for, so an interactively
deepening etch can't silently push the geometry outside the view frustum.
It only re-triggers on significant growth, not every render, so ordinary
small parameter tweaks don't fight the user's manual orbit/zoom.

**The context mesh only rebuilds when a patch's bounding box actually
changes.** Its own `useMemo` depends on `patchBoxes`, computed from the
etch results — but etch time/rate/undercut all produce a new `results`
array (new objects) on every debounced parameter change, even though only
mask geometry, margin, and resolution can move a patch's bounding box.
Keying the memo directly off `patchBoxes`'s array reference meant the full
context mesh (a 260x260 grid, hole-cut against every patch) was rebuilt on
every etch-time/rate/undercut tweak, not just the ones that could plausibly
have moved a box — a real, measured cause of UI lag once a wafer/die
outline is loaded (confirmed via instrumentation: 8 genuine etch-time
changes triggered 0 context rebuilds after the fix, versus one rebuild per
change before it, while a genuine margin change — which does move the
box — still correctly triggers a rebuild). The fix serializes the boxes'
actual numeric values into a string and uses that as the dependency
instead, so unrelated parameter changes skip the rebuild entirely. See
`patchBoxesKey` in `WaferScene.tsx`.

**The mask/silicon boundary renders as a hard edge, not a smooth blend.**
Each patch is one continuous height-field mesh, with the mask (protected)
and etched (open) regions sharing vertices right at their boundary. Baking
the mask color and the depth-ramp color directly into per-vertex `color`
attributes, as an earlier version did, meant the GPU's default behavior --
linearly interpolating vertex colors across the shared boundary triangle --
smeared the mask color into the cavity wall over about one grid cell's
width, visible as a soft fade right where the mask should end sharply.
`createMaskAwareMaterial` in `WaferScene.tsx` fixes this with a small
`onBeforeCompile` patch to `MeshStandardMaterial`: a `protect` attribute
(0/1 per vertex) is interpolated as `vProtect` like any other varying, but
the fragment shader applies `step(0.5, vProtect)` instead of using it
directly -- collapsing the interpolated value to a hard binary choice
before it picks between the mask color and the depth-ramp color, so the
transition snaps to a crisp line through the boundary triangle instead of
blending across its full width.

**The hard mask's color and pattern are live GPU uniforms, not baked
per-vertex data.** The same `onBeforeCompile` patch adds `uMaskColor`,
`uMaskTexture`, and `uUseMaskTexture` uniforms, shared (and mutated in
place, never replaced) between the patch and context materials via a ref
so both stay in sync and neither needs a shader recompile or geometry
rebuild when the mask's appearance changes -- picking a color or the
"gnomes" pattern in the sidebar just updates the uniform values directly.
One pattern option is included alongside plain colors: a small tiled
illustration of cartoon gnomes, procedurally drawn onto a canvas once and
cached (`src/lib/gnomeTexture.ts`) rather than shipped as an image asset.
Tiling is based on each mesh's own grid-index fraction (not physical
microns), so the pattern repeats a consistent number of times across a
patch regardless of whether that patch is 50µm or 5cm across.

**Light/dark theme is a user-facing toggle, not just automatic.** The CSS
custom-property palette already supported both (`:root` for light,
`[data-theme='dark']` to force dark, `@media (prefers-color-scheme: dark)`
as the pre-choice default) -- see `src/lib/theme.ts` for the toggle that
sets `data-theme` explicitly and persists the choice to `localStorage`, and
the header's ☀️/🌙 button in `App.tsx`. The 3D viewport and the 2D
cross-section canvas both read the current theme too (via `--canvas-bg-1`/
`--canvas-bg-2` and an explicit `theme` prop, respectively) rather than
staying a fixed dark instrument-panel color regardless of the rest of the
UI, which was the previous, more limited behavior.

## Loading your own design

1. Export the layer(s) you want as a GDSII stream file (`.gds`).
2. Drop it into the app. The parser (`src/gds/`) reads the raw GDSII stream
   format directly in the browser — no server, no external CAD tool — and
   flattens `SREF`/`AREF` cell references (including arrays, rotation,
   mirroring, and magnification) into absolute polygons.
3. Pick the etch mask layer/datatype from the dropdown.
4. If your file also has a wafer or die **outline** layer (a common
   two-layer pattern: one layer is the full wafer/die shape, e.g. a 150mm
   circle; the other is the etch-window pattern), set **Wafer/die outline**
   to that layer. This sizes the simulation to the real wafer/die shape and
   clips the render to it, instead of just a rectangle around the mask
   geometry — so the etch windows show up in their true position on the
   wafer. When a file has exactly two layers and one's geometry clearly
   contains and dwarfs the other, this is guessed automatically; check the
   dropdown if it guessed wrong (or if you have more than two layers).
5. Set **Layer meaning**: whether the drawn shapes are the etch *openings*
   (most common — you drew the cavity/groove you want) or the *protective
   mask* (you drew the silicon you want to keep, e.g. an isolated island or
   a corner-compensation structure).
6. Adjust the (100) etch rate, undercut rate, and etch time. Etch time and
   rate are independent; only their product (max possible depth) matters
   for self-limiting geometry, but the undercut rate is set separately.
7. **Domain margin** is optional, via its checkbox. Checked, it pads extra
   protected silicon around the mask geometry before simulating, sized as a
   percentage of the mask's own span — useful if the file you loaded draws
   only the etch opening itself, with no surrounding context. Unchecked, no
   synthetic percentage is applied; instead, if a **Wafer/die outline**
   layer is set, *that* layer's own drawn geometry becomes the margin —
   using the real designed boundary (e.g. a per-die outline, or corner-
   compensation geometry) instead of a guessed percentage. With no outline
   layer set, or none of it near this particular mask feature, the domain
   falls back to exactly the mask's own bounding box.

To regenerate the bundled sample file: `node scripts/generate-sample-gds.mjs`.
It draws four layers: a square opening (pyramid), an elongated opening
(V-groove), an isolated square (load it with polarity set to "protective
mask" to see corner undercut), and a square opening with a protected mesa
island in the middle (a released membrane/support-post pattern).

## Limitations — read before trusting this for real process design

This is a **geometric approximation for design intuition and teaching**,
not a crystallographically exact process simulator (cf. research tools
like ACES or full level-set simulators):

- Only Manhattan (axis-aligned) mask geometry aligned to the wafer's <110>
  flats is modeled correctly. Non-rectilinear or misaligned polygons will
  rasterize and etch, but the 54.74° sidewall assumption no longer applies
  along non-<110> edges.
- Only (100) wafers are supported (not (110), which etches with vertical
  {111} sidewalls and very different behavior).
- The undercut model is a simplified growing-disk approximation with a
  single user-set rate, not a derived function of etchant concentration,
  temperature, or the specific fast-etching planes involved. Treat the
  undercut visualization as qualitative.
- Convex mask corners are detected once from the as-drawn geometry. If an
  undercut fully consumes a thin mask feature (e.g. a corner-compensation
  tab, by design, right at the end of the etch), corners newly exposed by
  that event are not re-detected — the tool will still show the feature
  eroding away, but very fine "is it exactly severed at this timestep"
  detail near such features shouldn't be trusted.
- A single mask layer and a single etch step. Multi-step/multi-mask KOH
  processes aren't composed automatically — simulate one layer at a time.
- The raster grid resolution (adjustable, up to 768 cells along the longer
  bounding-box axis of each spatially-separate feature) trades fidelity for
  speed. Resolution tracks the mask geometry itself, not the overall wafer,
  so this mainly matters for a single feature that's large in one direction
  (e.g. a very long, thin V-groove).
- The sidewall slope is only ever `depth/√2` wide, so it can still be
  visually imperceptible at true scale when a shallow etch is shown against
  a *large* window — e.g. a 30µm-deep etch (the default) into a 20mm window
  has a slope only ~21µm wide, under 0.2% of the window's own size. That's
  not under-resolution, just physically accurate: increase etch time (deeper
  etch → proportionally wider slope) or uncheck "true aspect ratio" on the
  cross-section to exaggerate the depth axis for inspection.
