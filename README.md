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
- The raster grid resolution (adjustable, up to 512 cells along the longer
  bounding-box axis) trades fidelity for speed; very fine features relative
  to the overall design span will be under-resolved.
