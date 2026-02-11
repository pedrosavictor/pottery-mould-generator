---
phase: 06-outer-mould-ring-assembly
plan: 03
subsystem: geometry-pipeline
tags: [pour-hole, clearance-slider, outer-wall-slider, makeCylinder, boolean-cut, UI-controls]
dependency_graph:
  requires: [06-02]
  provides: [pour-hole, clearance-control, outer-wall-control, complete-phase-6-assembly]
  affects: [07-01]
tech_stack:
  added: []
  patterns: [cylindrical-boolean-cut-before-split, slider-to-mouldParams-pipeline]
key_files:
  created: []
  modified:
    - js/workers/geometryWorker.js
    - js/app.js
    - index.html
decisions:
  - id: 06-03-A
    description: "Pour hole is cut from ring solid BEFORE splitting so both halves inherit matching semicircular notches"
    rationale: "Single boolean cut produces symmetric notches on both pieces. Cutting after split would require two separate cuts and alignment."
  - id: 06-03-B
    description: "Pour hole positioned at midpoint of ring radial width on Y=0 plane, 30mm diameter default"
    rationale: "Centered radially for structural integrity. 30mm adequate for plaster flow. Y=0 placement means each half gets a semicircular notch."
  - id: 06-03-C
    description: "ringHeight and pourHoleRadius have defaults but no UI sliders in v1"
    rationale: "Sensible defaults (8mm, 15mm) cover typical use. Can be exposed in a future Advanced panel without cluttering the main UI."
metrics:
  duration: ~1.5m
  completed: 2026-02-11
---

# Phase 6 Plan 03: Pour Hole + Clearance/Wall-Thickness UI Controls Summary

**One-liner:** Pour hole boolean-cut through ring at Y=0 before splitting, plus assembly clearance (0.1-0.8mm) and outer wall thickness (1.5-5mm) sliders wired to mould regeneration.

## What Was Built

The pour hole -- a cylindrical opening through the ring that allows plaster to be poured into the mould cavity during casting. Two new UI sliders for assembly clearance and outer wall thickness. All Phase 6 mould parameters now have either UI controls or sensible defaults.

## Task Outcomes

### Task 1: Pour hole + clearance/wall-thickness UI controls (96d86a5)
- **geometryWorker.js**: Added pour hole cut in `generateRing()` between `buildAndRevolve()` and `splitSolid()`. Uses `makeCylinder(pourHoleRadius, ringHeight+4, [pourHoleMidR, 0, bottomZ-ringHeight-2], [0,0,1])` to create a cylinder that extends beyond ring bounds for clean cut. Guard condition ensures hole diameter < 90% of ring width. Changed `ringSolid` from `const` to `let` for reassignment after cut.
- **index.html**: Added assembly clearance slider (id=slider-clearance, 0.1-0.8mm, step 0.05, default 0.3mm) and outer wall thickness slider (id=slider-outer-wall, 1.5-5mm, step 0.1, default 2.4mm) in `#mould-settings` after split count selector.
- **app.js**: Extended `mouldParams` with `clearance: 0.3`, `ringHeight: 8`, `pourHoleRadius: 15`. Wired both new sliders in `initMouldSettings()` to update mouldParams and call `regenerateMould()`.

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

1. **Pour hole before split** (06-03-A): Cutting the pour hole from the full ring solid before splitting ensures both halves get matching semicircular notches automatically.

2. **Pour hole position and size** (06-03-B): Centered at midpoint of ring radial width on Y=0 plane. 30mm diameter (15mm radius) provides adequate plaster flow.

3. **No UI for ringHeight/pourHoleRadius** (06-03-C): Sensible defaults of 8mm and 15mm cover typical use cases without UI clutter.

## Key Technical Details

- Pour hole cylinder height = ringHeight + 4mm (extends 2mm beyond each face for clean boolean cut)
- Guard condition: `pourHoleRadius * 2 < (ringOuterRadius - ringInnerRadius) * 0.9` prevents hole wider than ring
- Clearance slider controls groove radius via `grooveRadius = ridgeRadius + clearance` in addAssemblyFeatures()
- Outer wall slider controls outer mould wall width via `mouldParams.outerWallThickness`
- All new parameters flow through existing mouldParams -> geometryBridge -> worker pipeline

## Phase 6 Completion

Phase 6 is now complete. All deliverables:
- Outer mould: cylindrical shell, split into halves/quarters (06-01)
- Bottom ring: washer connecting inner to outer mould, matching splits (06-02)
- Assembly features: ridge/groove on split faces for alignment (06-02)
- Pour hole: cylindrical opening through ring for plaster casting (06-03)
- UI controls: cavity gap, split count, clearance, outer wall thickness (06-01 + 06-03)
- Visibility toggles and exploded view for all parts (06-01 + 06-02)

## Next Phase Readiness

Phase 7 (STL Export) has all mould parts available as separate typed-array meshes: proof, inner-mould, outer-front/back/q1-q4, ring-front/back/q1-q4. Each part can be individually exported to STL binary format.
