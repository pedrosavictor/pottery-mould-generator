---
phase: 12
plan: 1
subsystem: core-stability
tags: [bugfix, url-sharing, svg-import, worker, validation, shrinkage]
dependency-graph:
  requires: [phase-1, phase-2, phase-3, phase-5, phase-7, phase-8]
  provides: [robust-url-sharing, safe-svg-import, worker-init-guard, input-validation]
  affects: [future-testing, production-deployment]
tech-stack:
  added: []
  patterns: [loadedFromURL-flag, clamp-validation, init-promise-guard]
key-files:
  modified:
    - js/geometryBridge.js
    - js/workers/geometryWorker.js
    - js/svgImport.js
    - js/urlSharing.js
    - js/app.js
decisions:
  - "FIX-14: initPromise pattern guards against orphaned workers (not mutex)"
  - "FIX-11: Clamp shrinkageRate to [0, 0.99] in worker; UI slider max stays 20%"
  - "FIX-12: Require 3+ points, 5mm min height/width, finite coordinates for SVG"
  - "FIX-13: Profile points clamped to [0, 500]mm; mould settings clamped to slider ranges"
  - "FIX-09/10: loadedFromURL flag reverses DOM sync direction for mould settings"
  - "FIX-09: URL-loaded profiles switch to freehand mode (no parametric overwrite)"
metrics:
  duration: ~4m
  completed: 2026-02-11
---

# Phase 12: Critical Bug Fixes Summary

**One-liner:** Fix 6 critical bugs: worker init guard, shrinkage div-by-zero, SVG validation, URL param validation, and share link profile/settings restore.

## What Was Done

### FIX-14: Worker init guard (js/geometryBridge.js)
Added `initPromise` tracking so calling `init()` while already initializing returns the existing promise instead of creating a new orphaned Worker. The promise is cleared on success or error, and reset in `destroy()`.

### FIX-11: Shrinkage rate clamp (js/workers/geometryWorker.js, js/app.js)
Clamped `shrinkageRate` to `[0, 0.99]` in `scaleProfileForShrinkage()` to prevent `1 / (1 - 1.0) = Infinity`. Also clamped the UI slider handler to max 99% as defense-in-depth (HTML slider max is already 20%).

### FIX-12: SVG import validation (js/svgImport.js)
Added `validateParsedProfile()` called after SVG path conversion. Rejects profiles with: fewer than 3 points, NaN/Infinity coordinates, invalid bezier control points, height < 5mm, or width < 5mm. Descriptive errors shown via `alert()`.

### FIX-13: URL parameter validation (js/urlSharing.js)
Added `validateProfilePoints()` and `validateMouldSettings()` to `decodeDesignFromURL()`. Profile coordinates clamped to [0, 500]. Mould settings clamped to slider ranges. Enum values (slipWellType, splitCount) whitelisted. NaN/Infinity replaced with defaults.

### FIX-09 + FIX-10: Share link restore (js/app.js)
The root cause was that `initParametricControls()` called `applyPreset('cup')` and `initMouldSettings()` read DOM defaults into `mouldParams` -- both overwriting URL-decoded values.

Fix: Added `loadedFromURL` flag set when URL contains profile or settings. When true:
- `initParametricControls()` skips `applyPreset('cup')`
- `initMouldSettings()` writes mouldParams TO DOM controls (reversed flow)
- All 7 mould setting controls (shrinkage, wallThickness, slipWell, cavityGap, splitCount, clearance, outerWallThickness) respect the flag
- App switches to freehand mode for URL-loaded profiles

## Deviations from Plan

None -- plan executed exactly as written.

## Commits

| Commit | Fix | Description |
|--------|-----|-------------|
| a9195aa | FIX-14 | Guard against orphaned workers on duplicate init() calls |
| a95ab21 | FIX-11 | Clamp shrinkage rate to prevent division by zero |
| e5a211a | FIX-12 | Validate SVG imports reject degenerate profiles |
| 14dbce0 | FIX-13 | Validate and clamp all URL-decoded parameters |
| 7db84a7 | FIX-09/10 | Share links correctly restore profile and mould settings |

## Verification

All fixes are defensive (input validation, range clamping, guard conditions). The code paths they protect are:
- Worker initialization: tested by calling `init()` multiple times
- Shrinkage calculation: tested with extreme rates near 1.0
- SVG import: tested with degenerate 2-point SVGs
- URL decoding: tested with NaN, Infinity, out-of-range values
- Share link restore: tested by URL with both profile and settings params
