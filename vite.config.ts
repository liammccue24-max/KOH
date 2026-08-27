import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves this as a project site under /KOH/, not the
  // domain root, so asset URLs need that prefix -- but only for that build.
  // Local dev, `vite preview`, and the self-contained artifact build (which
  // inlines everything and has no server-relative paths to get right) all
  // want the default '/'. Set via GH_PAGES_BASE in the Pages deploy workflow.
  // The Electron build (scripts/build-electron.mjs) needs relative './'
  // instead: it loads dist/index.html via file://, where an absolute '/'
  // path resolves against the filesystem root, not the app folder.
  base: process.env.GH_PAGES_BASE || (process.env.ELECTRON_BUILD ? './' : '/'),
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
