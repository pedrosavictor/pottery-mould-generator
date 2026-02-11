---
phase: 10-console-bug-fixes
plan: 01
subsystem: geometry-worker, app-init
tags: [bugfix, annular-revolution, error-handling, init-ordering]
dependency-graph:
  requires: [phase-5, phase-6]
  provides: [working-outer-mould, working-ring, clean-console]
  affects: [phase-7-export]
tech-stack:
  added: []
  patterns: [revolveClosedProfile for annular shapes, safeErrorMessage for WASM errors]
key-files:
  created: []
  modified:
    - js/workers/geometryWorker.js
    - js/app.js
decisions:
  - revolveClosedProfile closes profile directly (pen.close) without axis detour for annular shapes
  - safeErrorMessage helper centralizes WASM error extraction across all catch blocks
  - Scene init moved before parametric controls to prevent premature onProfileChange
metrics:
  duration: ~2m
  completed: 2026-02-11
---

# Phase 10 Plan 01: Console Bug Fixes Summary

**Fixed 3 bugs: annular revolution for outer mould/ring, scene init ordering, and safe WASM error messages.**

## What Was Done

### Task 1: Fix geometryWorker.js (Bug 1 + Bug 3)

**Bug 1 (CRITICAL) -- Annular revolution fix:**
- Added `revolveClosedProfile(points)` function after `buildAndRevolve()` -- closes the profile directly with `pen.close()` instead of going through the revolution axis (x=0)
- Changed `generateOuterMould()` to use `revolveClosedProfile(outerProfile)` instead of `buildAndRevolve(outerProfile)`
- Changed `generateRing()` to use `revolveClosedProfile(ringProfile)` instead of `buildAndRevolve(ringProfile)`
- `buildAndRevolve()` itself was NOT changed -- it remains correct for pot profiles that start near the axis

**Bug 3 (COSMETIC) -- Safe error messages:**
- Added `safeErrorMessage(err)` helper near top of file: returns `err?.message || String(err)`
- Replaced all 11 bare `.message` accesses in catch blocks with `safeErrorMessage()`
- No `.message` property access remains in any catch block outside the helper

**Commit:** 719bf73

### Task 2: Fix app.js (Bug 2)

**Bug 2 (MINOR) -- Scene initialization ordering:**
- Moved `preview3d.initScene(container)` and `preview3d.updateLatheFallback(initialPoints)` to BEFORE `initParametricControls()` in the DOMContentLoaded handler
- New ordering: profile editor init -> scene init -> lathe preview -> parametric controls
- Removed both blocks from their old location (after initReferenceImage) -- no duplication
- Eliminates "Scene not initialized" warning on page load

**Commit:** bf25a3f

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | `revolveClosedProfile` uses `pen.close()` without axis lines | Annular profiles (outer mould, ring) are rectangles far from axis -- going through x=0 creates degenerate disc geometry |
| 2 | `safeErrorMessage` helper centralizes error extraction | WASM/OpenCASCADE may throw non-Error values (strings, numbers, WASM pointers) that lack .message |
| 3 | Scene init before parametric controls | `initParametricControls()` calls `applyPreset('cup')` which triggers `onProfileChange()` via `setProfileData()` -- scene must exist first |

## Verification Results

1. `revolveClosedProfile` appears 3 times: definition + 2 call sites (generateOuterMould, generateRing)
2. `buildAndRevolve` appears only in pot/inner-mould paths (revolveProfile, generateMouldParts, computeVolumes, exportMouldPartsForDownload) -- NOT in generateOuterMould or generateRing
3. `safeErrorMessage` appears 12 times: 1 definition + 11 usages
4. Zero bare `.message` accesses in catch blocks (only in safeErrorMessage helper itself)
5. `preview3d.initScene(container)` appears exactly once, BEFORE `initParametricControls()`
6. `updateLatheFallback(initialPoints)` appears exactly once, right after `initScene`
7. No duplicate init calls

## Next Phase Readiness

All three bugs are fixed. The outer mould and ring generation paths now use the correct revolution strategy. The console should be clean on initial load. No blockers for future phases.
