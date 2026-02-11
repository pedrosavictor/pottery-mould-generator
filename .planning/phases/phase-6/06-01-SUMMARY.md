---
phase: 06-outer-mould-ring-assembly
plan: 01
subsystem: geometry-pipeline
tags: [outer-mould, split-solid, box-cutting, cavity-gap, cylindrical-shell, replicad, boolean-operations]
dependency_graph:
  requires: [05-01, 05-02]
  provides: [outer-mould-generation, split-solid-helper, cavity-gap-ui, split-count-ui, outer-mould-visibility]
  affects: [06-02, 06-03]
tech_stack:
  added: []
  patterns: [box-cutting-boolean-split, prefix-based-part-management, group-visibility-toggle]
key_files:
  created: []
  modified:
    - js/workers/geometryWorker.js
    - js/preview3d.js
    - js/app.js
    - index.html
decisions:
  - id: 06-01-A
    description: "Outer mould is a uniform-radius cylindrical shell (not profile-following)"
    rationale: "Flat outer wall matches ShapeCast approach for easy clamping and standard mould-making practice."
  - id: 06-01-B
    description: "splitSolid() uses makeBox boolean cuts at Y=0 and X=0 planes"
    rationale: "Reusable for both outer mould and ring splitting (Plan 06-02). Oversized B=500 boxes ensure complete cuts."
  - id: 06-01-C
    description: "Prefix-based part management (startsWith) for outer-* and ring-* parts"
    rationale: "Split count can change (2 to 4 pieces), so exact names vary. Prefix matching handles both halves and quarters uniformly."
  - id: 06-01-D
    description: "removePartsByPrefix cleans up old pieces before adding new ones on split count change"
    rationale: "Prevents stale geometry (e.g., outer-front/back remaining when switching to outer-q1..q4)."
metrics:
  duration: ~3m
  completed: 2026-02-11
---

# Phase 6 Plan 01: Outer Mould Generation and Splitting Summary

**One-liner:** Cylindrical outer mould shell with makeBox boolean splitting into halves/quarters, cavity gap slider (10-50mm), split count selector, and group visibility toggle.

## What Was Built

The outer mould -- a cylindrical containment wall that surrounds the inner mould with a configurable plaster cavity gap. The solid is split into halves or quarters using boolean box-cutting operations, and each piece renders as an independent 3D scene object with exploded view support and visibility toggle.

## Task Outcomes

### Task 1: Worker Changes -- splitSolid, generateOuterMould, Pipeline Integration (b4c3d21)
- Added `makeBox` and `makeCylinder` imports from replicad module
- Added `splitSolid(shape, splitCount, track)` helper: uses oversized makeBox (B=500) to cut at Y=0 (halves) and additionally X=0 (quarters). Returns `[{ key, solid }]` array
- Added `generateOuterMould(scaledPoints, mouldProfile, mouldParams, track)`: calculates outerInner = maxProfileRadius + wallThickness + cavityGap, outerOuter = outerInner + outerWallThickness. Builds rectangular cross-section profile, revolves with buildAndRevolve(), splits with splitSolid()
- Integrated into `generateMouldParts()`: added cavityGap, splitCount, outerWallThickness to mouldParams destructuring. After inner-mould section, generates outer mould pieces as `outer-front`/`outer-back` or `outer-q1`..`outer-q4`
- Error handling: try/catch around outer mould generation returns `outer-mould-error` alongside other successful parts

### Task 2: Preview + App + HTML Wiring (f08d525)
- Updated `EXPLODED_OFFSETS` with entries for outer-front, outer-back, outer-q1..q4 (all at 200), ring-front/back/q1..q4 (all at -50), proof at 300
- Updated `createMaterialForPart()` to use `.startsWith('outer-')` and `.startsWith('ring-')` prefix matching for blue-grey mould material
- Added `setPartGroupVisibility(prefix, visible)` export to preview3d -- sets visibility for all parts matching a prefix
- Added `removePartsByPrefix(prefix)` export to preview3d -- disposes and removes all parts matching a prefix (for split count changes)
- Added cavity gap slider (10-50mm, default 25, step 1) and split count selector (Halves/Quarters) to #mould-settings in HTML
- Enabled outer mould checkbox (removed `disabled` attribute)
- Added `cavityGap: 25, splitCount: 2, outerWallThickness: 2.4` to mouldParams in app.js
- Wired cavity gap slider and split count selector in `initMouldSettings()` to trigger `regenerateMould()`
- Updated `onProfileChange()` and `regenerateMould()` to: clear old outer-* parts with removePartsByPrefix, then add new outer-* pieces from worker result
- Wired outer mould checkbox to `setPartGroupVisibility('outer-', ...)` in `initViewControls()`
- Updated initial WASM upgrade to render outer mould pieces on first load

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

1. **Uniform-radius cylindrical shell** (06-01-A): The outer mould is a simple cylinder based on the widest profile point, not following the pot's shape. This matches real mould-making practice where flat outer walls allow easy clamping.

2. **makeBox boolean cutting** (06-01-B): splitSolid() uses oversized boxes (B=500) at Y=0 and X=0 planes. This reusable helper will be used by Plan 06-02 for ring splitting.

3. **Prefix-based part management** (06-01-C): Material assignment and visibility use `.startsWith()` matching rather than exact string comparisons, handling the variable number of split pieces uniformly.

4. **Remove-before-add cleanup** (06-01-D): When split count changes, all existing `outer-*` parts are removed before adding the new pieces, preventing stale geometry from persisting.

## Key Technical Details

- Radius calculation chain: `maxProfileRadius -> +wallThickness -> +cavityGap -> outerInnerRadius -> +outerWallThickness -> outerOuterRadius`
- Outer mould height matches full mould profile (including slip well when present)
- buildAndRevolve() closes the rectangular profile to the axis, creating a bottom plate for the outer mould
- All WASM objects tracked via `track()` for guaranteed cleanup
- transferList builder already handles error entries (checks `part.vertices` before accessing `.buffer`)

## Next Phase Readiness

Plan 06-02 (Ring) will reuse `splitSolid()` for ring splitting. The prefix-based part management pattern (`ring-front`, `ring-back`, etc.) is already prepared in EXPLODED_OFFSETS and createMaterialForPart.
