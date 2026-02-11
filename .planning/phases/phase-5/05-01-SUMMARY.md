---
phase: 05-inner-mould-generation
plan: 01
subsystem: geometry-pipeline
tags: [mould-generation, shrinkage, shell, replicad, worker, three.js]
dependency_graph:
  requires: [01-01, 01-02, 01-03, 04-01]
  provides: [generateMould-pipeline, proof-model, inner-mould, mould-materials, visibility-toggles]
  affects: [05-02, 06-01, 06-02]
tech_stack:
  added: []
  patterns: [shrinkage-scaling, shell-with-face-finder, multi-part-worker-result, part-material-selection]
key_files:
  created: []
  modified:
    - js/workers/geometryWorker.js
    - js/geometryBridge.js
    - js/preview3d.js
    - js/app.js
    - index.html
decisions:
  - id: 05-01-A
    description: "Option A: single generateMouldWithCancellation call replaces both generateWithCancellation + separate mould call. Proof mesh doubles as 'pot' part."
    rationale: "Avoids shared cancellation counter conflict where second call would invalidate first. Single worker call is also more efficient."
  - id: 05-01-B
    description: "Shell thickness is NEGATIVE (-wallThickness) so wall grows outward from pot surface"
    rationale: "Inner mould must be larger than the pot. Negative shell direction in replicad grows outward."
  - id: 05-01-C
    description: "buildAndRevolve() shared helper used by both revolveProfile() and generateMouldParts()"
    rationale: "Eliminates code duplication. Existing revolve command behavior preserved."
metrics:
  duration: ~4m
  completed: 2026-02-11
---

# Phase 5 Plan 01: Mould Generation Pipeline Summary

**One-liner:** generateMould worker command with shrinkage scaling and shell pipeline, proof + inner-mould parts in 3D preview with distinct materials and visibility toggles.

## What Was Built

The core mould generation pipeline from worker through bridge to 3D preview. Every profile change now generates:
1. A **proof model** (original fired-pot dimensions, revolved from unscaled profile)
2. An **inner mould** (scaled up by shrinkage factor, revolved, then shelled with negative wall thickness)

Both parts appear in the Three.js preview with distinct materials (terra cotta pot, blue-grey mould, semi-transparent proof ghost).

## Task Outcomes

### Task 1: Worker + Bridge (b64758d)
- Added `FaceFinder` import from replicad module
- Created `scaleProfileForShrinkage()` -- scales all coordinates by `1/(1-shrinkageRate)` (1.1494x for 13%)
- Created `buildAndRevolve()` -- shared helper that draws, closes to axis, revolves on XZ plane
- Created `toTransferableMesh()` -- converts shape.mesh() to independent typed arrays
- Created `generateMouldParts()` -- orchestrates proof + inner-mould generation with withCleanup()
- Added `'generateMould'` case to onmessage switch with Transferable ArrayBuffer collection
- Refactored existing `revolveProfile()` to use shared helpers (zero behavior change)
- Added `generateMould()` and `generateMouldWithCancellation()` to geometryBridge.js

### Task 2: Preview + App Wiring (4e64771)
- Added `MOULD_MATERIAL_PARAMS` (blue-grey, 85% opacity) and `PROOF_MATERIAL_PARAMS` (warm tone, 50% opacity)
- Added `createMaterialForPart()` helper -- selects material based on part name
- Updated `updatePartMesh()` to use part-specific materials instead of always terra cotta
- Added `mouldParams` object with defaults (13% shrinkage, 2.4mm wall, no slip well)
- Replaced `generateWithCancellation` with `generateMouldWithCancellation` in `onProfileChange`
- Proof mesh used as both 'pot' part (solid) and 'proof' part (ghost)
- Updated initial WASM upgrade to generate mould parts on load
- Wired `chk-show-inner` and `chk-show-proof` event listeners in `initViewControls()`
- Removed `disabled` from inner-mould and proof checkboxes in HTML

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

1. **Option A for cancellation** (05-01-A): Single `generateMouldWithCancellation` call replaces the old `generateWithCancellation` + separate mould call. The proof mesh doubles as the 'pot' display part. This avoids the shared cancellation counter conflict documented in the plan.

2. **Negative shell thickness** (05-01-B): `shell(-wallThickness, ...)` with negative value grows the wall outward from the pot surface, which is correct for inner mould geometry.

3. **Shared buildAndRevolve helper** (05-01-C): Existing `revolveProfile()` refactored to use `buildAndRevolve()` and `toTransferableMesh()`, eliminating code duplication while preserving the 'revolve' command backward compatibility.

## Key Technical Details

- Shell face selection: `mouldSolid.shell(-wallThickness, (f) => f.inPlane('XY', topZ))` -- finds flat top face at rim height
- Shrinkage formula: `wet_size = fired_size / (1 - shrinkage_rate)` -- for 13%: scaleFactor = 1.1494
- Memory safety: All shapes tracked via `withCleanup((track) => { ... })` pattern
- Transfer efficiency: Each part gets independent Float32Array/Uint32Array for zero-copy postMessage

## Next Phase Readiness

Phase 5 Plan 02 can proceed. It adds:
- Slip well geometry modification to the scaled profile before revolving
- Mould settings UI (shrinkage rate slider, wall thickness slider, slip well type selector)
- The `mouldParams` object and `generateMouldParts` function are ready to accept `slipWellType` values
