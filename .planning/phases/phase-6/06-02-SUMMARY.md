---
phase: 06-outer-mould-ring-assembly
plan: 02
subsystem: geometry-pipeline
tags: [ring, washer, assembly-features, ridge-groove, boolean-fuse, boolean-cut, makeCylinder, replicad]
dependency_graph:
  requires: [06-01]
  provides: [ring-generation, assembly-features, ridge-groove-alignment, ring-visibility-toggle]
  affects: [06-03]
tech_stack:
  added: []
  patterns: [ridge-groove-boolean-assembly, washer-ring-revolve, cylinder-fuse-cut-features]
key_files:
  created: []
  modified:
    - js/workers/geometryWorker.js
    - js/app.js
    - index.html
decisions:
  - id: 06-02-A
    description: "Ring is a flat annular disc (washer) spanning from inner mould outer radius + 0.5mm clearance to outer mould inner radius"
    rationale: "Connects inner to outer mould structurally. 0.5mm clearance allows inner mould to sit freely inside."
  - id: 06-02-B
    description: "Ridge/groove features only on Y=0 split plane for v1 (X=0 plane deferred)"
    rationale: "Keeps boolean operations manageable. Each split pair already gets 4 boolean ops; adding X=0 features doubles that."
  - id: 06-02-C
    description: "Ridges on front/q1/q3, grooves on back/q2/q4 at Y=0 face"
    rationale: "Consistent convention: positive-Y pieces get ridges, negative-Y pieces get matching grooves."
  - id: 06-02-D
    description: "Assembly features add 2mm radius ridges fused onto one face, 2.3mm grooves cut from mating face"
    rationale: "0.3mm clearance per side ensures parts interlock without being too tight for 3D-printed parts."
metrics:
  duration: ~2.5m
  completed: 2026-02-11
---

# Phase 6 Plan 02: Ring Generation and Assembly Features Summary

**One-liner:** Washer-shaped bottom ring connecting inner to outer mould, with 2mm ridge / 2.3mm groove cylinder features on all split faces for precise alignment.

## What Was Built

The bottom ring (a flat washer disc spanning the gap between inner and outer mould) and ridge/groove assembly features that enable precise alignment when assembling the 3D-printed mould pieces. The ring splits to match the outer mould configuration (halves or quarters). Assembly features are applied to both outer mould and ring split faces.

## Task Outcomes

### Task 1: Worker Changes -- generateRing, addAssemblyFeatures, Pipeline Integration (4ba3bd0)
- Added `generateRing(scaledPoints, mouldProfile, mouldParams, track)`: calculates ring inner radius (maxProfileRadius + wallThickness + 0.5mm clearance) and outer radius (maxProfileRadius + wallThickness + cavityGap). Builds rectangular cross-section from bottomZ-ringHeight to bottomZ, revolves with buildAndRevolve(), splits with reused splitSolid()
- Added `addAssemblyFeatures(pieces, partPrefix, bottomZ, topZ, innerRadius, outerRadius, mouldParams, track)`: creates 2mm radius ridge cylinders along X axis at 1/3 and 2/3 height, fuses onto front/q1/q3 pieces. Creates 2.3mm (2mm + 0.3mm clearance) groove cylinders, cuts from back/q2/q4 pieces. Grooves are 2mm longer (1mm each end) for tolerance
- Modified outer mould pipeline: outer pieces now pass through addAssemblyFeatures() between splitting and meshing, adding ridges/grooves to all outer mould split faces
- Added ring generation section after outer mould: generates ring, applies assembly features, meshes each piece as `ring-front`/`ring-back` or `ring-q1`..`ring-q4`
- Added `clearance = 0.3` and `ringHeight = 8` to mouldParams destructuring
- Error handling: try/catch around ring generation returns `ring-error` alongside other successful parts

### Task 2: App.js + HTML Wiring (539d2ad)
- Enabled ring checkbox in index.html (removed `disabled` attribute)
- Wired `chk-show-ring` to `setPartGroupVisibility('ring-', ...)` in initViewControls()
- Added ring piece handling in `onProfileChange()`: removePartsByPrefix('ring-') + loop adding ring-* parts
- Added ring piece handling in `regenerateMould()`: same pattern as onProfileChange
- Added `ring-error` logging in both onProfileChange and regenerateMould
- Updated initial WASM upgrade to render ring pieces alongside outer mould pieces on first load

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

1. **Washer ring dimensions** (06-02-A): Ring inner radius = maxProfileRadius + wallThickness + 0.5mm (small clearance so inner mould sits freely). Ring outer radius = maxProfileRadius + wallThickness + cavityGap (meets outer mould inner surface).

2. **Y=0 plane features only for v1** (06-02-B): Assembly features are only added on the Y=0 split plane. For quarters, the X=0 plane features are deferred. This keeps boolean operations to 4 per piece instead of 8.

3. **Ridge/groove assignment convention** (06-02-C): Front/q1/q3 (positive Y side) get raised ridges. Back/q2/q4 (negative Y side) get recessed grooves. Consistent across both outer mould and ring.

4. **Ridge 2mm / groove 2.3mm sizing** (06-02-D): 0.3mm clearance (configurable via mouldParams.clearance) accommodates 3D printing tolerances.

## Key Technical Details

- Ring height default 8mm, configurable via `mouldParams.ringHeight`
- Ridge positions at 1/3 and 2/3 of part height for balanced registration
- Ridge length = 80% of radial width, centered on mid-radius
- Groove cylinders extend 2mm longer (1mm each end beyond ridge length) for tolerance
- `makeCylinder(radius, length, [startX, 0, z], [1, 0, 0])` creates cylinders along X axis at Y=0 plane
- All intermediate boolean results tracked via `track()` for WASM cleanup
- Performance: assembly features add 4 boolean ops per piece (2 ridges + 2 grooves per split pair)

## Next Phase Readiness

Plan 06-03 (STL Export) has all mould parts available: proof, inner-mould, outer-front/back/q1-q4, ring-front/back/q1-q4. Each part is a separate mesh with typed arrays ready for conversion to STL binary format.
