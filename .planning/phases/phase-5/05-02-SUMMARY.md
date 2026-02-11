---
phase: 05-inner-mould-generation
plan: 02
subsystem: geometry-pipeline
tags: [slip-well, mould-settings, shrinkage-ui, wall-thickness, error-handling, replicad]
dependency_graph:
  requires: [05-01]
  provides: [slip-well-geometry, mould-settings-ui, shell-error-handling, complete-phase-5]
  affects: [06-01, 06-02]
tech_stack:
  added: []
  patterns: [profile-extension-before-revolve, graceful-shell-failure, settings-driven-regeneration]
key_files:
  created: []
  modified:
    - js/workers/geometryWorker.js
    - js/app.js
    - index.html
    - css/style.css
decisions:
  - id: 05-02-A
    description: "Slip well is a 2D profile extension (3 line points) rather than a boolean fuse of two solids"
    rationale: "Seamless single surface after revolve. No boolean operations needed. Matches plan approach."
  - id: 05-02-B
    description: "Default slip well is 'regular' (25mm) matching HTML select default"
    rationale: "Most potters need a slip well. The HTML default overrides the initial mouldParams value from Plan 05-01."
  - id: 05-02-C
    description: "Shell failures return error indicator alongside proof model rather than throwing"
    rationale: "The proof model is still useful even when shell() fails on complex profiles. App stays usable."
metrics:
  duration: ~2.5m
  completed: 2026-02-11
---

# Phase 5 Plan 02: Slip Well + Mould Settings Summary

**One-liner:** Slip well profile extension with 3 size options, mould settings UI panel (shrinkage/wall-thickness/slip-well), and graceful shell error handling.

## What Was Built

The remaining Phase 5 features: slip well geometry, mould parameter controls, and error resilience. Users now have full control over inner mould generation through a settings panel, and the app handles shell failures gracefully instead of crashing.

## Task Outcomes

### Task 1: Worker Slip Well + Error Handling (9343d58)
- Added `extendProfileForSlipWell(points, wallThickness, wellHeight)` -- appends 3 line points (outward, up, inward) to create a rectangular cross-section that revolves into a cylindrical well
- Integrated slip well into `generateMouldParts()` with wellHeights map: none=0, regular=25mm, tall=50mm
- CRITICAL fix: `topZ` now uses `mouldProfile[mouldProfile.length - 1].y` (well top when present) so shell() opens the correct face
- Wrapped `shell()` in try/catch -- on failure, sets `results['inner-mould-error']` and returns proof model
- Fixed transferList builder to skip non-mesh entries (checks `part.vertices` before accessing `.buffer`)

### Task 2: Mould Settings UI + App Wiring (d60cf09)
- Added `#mould-settings` panel to index.html after parametric controls: shrinkage slider (5-20%, step 0.5), wall thickness slider (1-5mm, step 0.1), slip well select (None/Regular/Tall)
- Added CSS for `#mould-settings` matching existing panel style
- Added `regenerateMould()` async function -- re-generates mould parts without regenerating the profile
- Added `initMouldSettings()` -- syncs initial DOM values to mouldParams, wires input/change events
- Added inner-mould-error handling to both `onProfileChange` and `regenerateMould`
- Updated mouldParams default `slipWellType` from 'none' to 'regular' matching HTML default
- Called `initMouldSettings()` in DOMContentLoaded between `initParametricControls()` and `initViewControls()`

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

1. **Profile extension approach** (05-02-A): Slip well geometry is added as 3 line points to the 2D profile before revolving, creating a seamless single surface. No boolean fuse operations needed.

2. **Default slip well 'regular'** (05-02-B): Updated default from 'none' to 'regular' to match the HTML `<option selected>`. Most potters need a slip well for pouring.

3. **Graceful shell failure** (05-02-C): Shell errors return an `inner-mould-error` indicator alongside the successful proof model. The app shows a warning message and hides stale inner-mould geometry.

## Key Technical Details

- Slip well cross-section: `[rim] -> [rim+wallThickness, rimY] -> [rim+wallThickness, rimY+wellHeight] -> [rim, rimY+wellHeight]`
- When revolved, this creates a cylindrical tube at the top of the mould
- After shell(), the top face (at wellTop height) is removed, creating the pouring opening
- Settings changes trigger `regenerateMould()` which reuses `lastProfilePoints` -- no profile regeneration needed
- Error handling pattern: worker returns `{ proof: {...}, 'inner-mould-error': { message: '...' } }` -- app checks for error key

## Phase 5 Completion

Phase 5 (Inner Mould Generation) is now complete with all features:
- Shrinkage-compensated mould generation pipeline
- Shell operation for hollow inner mould
- Slip well geometry (3 sizes)
- User-adjustable mould parameters
- Graceful error handling
- Distinct materials and visibility controls for all parts
