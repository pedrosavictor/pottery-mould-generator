# Phase 17: UI Layout & Polish -- Execution Log

## Objective

Fix layout issues on desktop/tablet/mobile, improve visual consistency, and add missing UX affordances. 18 items total (UI-01 through UI-18).

## Tasks Executed

### Commit 1: Layout Fixes (UI-01 through UI-04)
- **UI-01**: Replaced `min-height: calc(100vh - 50px)` on `main` with `flex: 1` plus flex column on `#app`. Footer is now reachable by scrolling.
- **UI-02**: Added tablet breakpoint (768-1024px) with `flex-wrap: wrap`. Editor and preview sit side-by-side at 50% width, controls go full-width below.
- **UI-03**: Changed editor/preview `min-height` from rigid `500px` to `min(500px, 50vh)` so they adapt to smaller viewports.
- **UI-04**: Moved `#notification-bar` from inside `<main>` to be a direct child of `<body>`. It uses `position: fixed` so DOM parent doesn't matter functionally, but the markup now makes semantic sense.

### Commit 2: Visual Polish (UI-05 through UI-14)
- **UI-05**: Resolution toggle now uses wrapper `border: 2px solid` with `overflow: hidden` instead of per-button borders. No more double border.
- **UI-06**: All three toggle groups (mode, view, resolution) now share the same pattern: wrapper border, child `border: none; border-radius: 0`.
- **UI-07**: Scoped aggressive button styles to `#dev-tools button`. Global `button` reset is now font-family and cursor only. This eliminates specificity fights for `.mode-btn`, `.view-btn`, `.res-btn`, `.notification-dismiss`, `.modal-close-btn`, etc.
- **UI-08**: `gateSliderForPro()` now adds `classList.add('pro-gated')` instead of `style.opacity = '0.4'`. CSS class provides `opacity: 0.4; pointer-events: none`.
- **UI-09**: Audited all 8 remaining `!important` usages -- all justified (canvas size override, reduced-motion, `.hidden` utility, modal hidden). No changes needed.
- **UI-10**: Added orbit hint element ("Drag to rotate, Scroll to zoom") positioned bottom-right of 3D preview. Fades via CSS `transition: opacity 2s ease 5s` plus JS adds `.faded` class after 8 seconds.
- **UI-11**: Added `.preview-error` element ("3D preview unavailable") that is hidden by default. Shown when WASM init fails.
- **UI-12**: Added `<p id="download-hint">` text below disabled download button explaining "Waiting for geometry engine...". Hidden when WASM loads successfully.
- **UI-13**: Set cup defaults (90/80/78/55 mm) as initial text content in slider value spans instead of "--".
- **UI-14**: Added `title` tooltips to Shrinkage, Wall thickness, Slip well, Plaster cavity, Assembly clearance, and Outer wall labels explaining each term.

### Commit 3: Mobile Fixes (UI-15 through UI-18)
- **UI-15**: Reduced mobile editor height from `min-height: 280px` to `height: 35vh; max-height: 300px; min-height: 220px`. This ensures the full profile is visible.
- **UI-16**: Reduced mobile 3D preview height similarly to `height: 30vh; max-height: 300px; min-height: 200px`.
- **UI-17**: Both reductions bring controls significantly closer to the top of the page, reducing scroll needed.
- **UI-18**: Added canvas-width clamping in `dimensionOverlay.js` -- the height dimension line X position is now clamped to `canvasWidth - 50px` to prevent the "80 mm" label from clipping on narrow screens.

## Deviations from Plan

None -- plan executed exactly as written.

## Verification

- All 18 UI items addressed
- 3 atomic commits, each independently revertable
- CSS changes are additive (no restructuring of the entire stylesheet)
- JS changes are minimal (4 small additions in app.js, 1 change in dimensionOverlay.js)
