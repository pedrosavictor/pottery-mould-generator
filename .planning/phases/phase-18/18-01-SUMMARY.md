---
phase: 18
plan: 1
subsystem: backend
tags: [validation, workers, memory, error-handling, keyboard, svg]
dependency-graph:
  requires: [17]
  provides: [backend-bug-fixes, input-validation, memory-tracking, error-recovery]
  affects: []
tech-stack:
  added: []
  patterns: [input-range-validation, cached-tool-pattern, multi-source-heap-tracking]
key-files:
  created: []
  modified:
    - js/profileEditor.js
    - js/svgImport.js
    - js/workers/geometryWorker.js
    - js/workers/memoryTracker.js
    - js/geometryBridge.js
    - js/profileEditor/constraints.js
decisions:
  - "DIM_MIN=5mm, DIM_MAX=500mm for dimension input validation"
  - "MAX_SVG_SIZE=1MB to prevent browser hangs during Paper.js parsing"
  - "Self-intersection O(n^2) threshold set to 30 curves"
  - "wallThickness min clamp 0.5mm -- thinner walls are unprintable"
  - "Dynamic cutter: Math.max(2, wallThickness + 1) for subtraction fallback"
  - "performance.memory as secondary heap tracking source (Chrome-only)"
metrics:
  duration: ~3m
  completed: 2026-02-11
---

# Phase 18 Plan 1: Backend & Worker Fixes Summary

**One-liner:** 11 backend fixes -- keyboard conflicts, input validation, memory tracker, tool leak, worker error recovery, and geometry edge cases.

## Changes Made

### Input Validation & Guards
- **BE-01:** Global Ctrl+Z/Y now skips when focus is in INPUT, TEXTAREA, or contentEditable elements, letting the browser handle native undo in text fields.
- **BE-04:** SVG import rejects files >1MB with a clear error message before attempting Paper.js parse.
- **BE-06:** Self-intersection check skips when profile has >30 curves (O(n^2) would cause lag on complex SVG imports). Logs a console.warn.
- **BE-09:** Dimension inputs validate 5-500mm range. Invalid values revert to the current dimension and log a warning.

### Geometry Worker Fixes
- **BE-07:** wallThickness clamped to minimum 0.5mm in generateMouldParts to prevent zero-thickness shell operations.
- **BE-08:** Top cap cutter in buildMouldBySubtraction uses `Math.max(2, wallThickness + 1)` thickness, ensuring complete cap removal for walls >5mm.
- **BE-05:** Documented that single-control-point bezier segments degrade to straight lines (intentional behavior).

### Memory & Error Handling
- **BE-10:** getHeapSize() now tries performance.memory.usedJSHeapSize as fallback when Emscripten Module is unavailable (Chrome workers).
- **BE-11:** Bridge handleError() now resets `ready` and `initPromise` flags so subsequent calls fail fast instead of hanging.

### Tool & Documentation
- **BE-02:** Cached the no-op Paper.js Tool used by setToolsEnabled(false) to prevent leaking Tool instances on repeated calls.
- **BE-03:** Documented known limitation in reverseProfile: complex multi-bezier SVGs may have slight distortion from simplified cp1/cp2 swap.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] BE-02 upgraded from documentation to code fix**
- **Found during:** Task 9 (BE-02 documentation pass)
- **Issue:** Plan listed BE-02 as "documentation/comments" but reading the code showed `new paper.Tool()` created on every disable call -- a genuine resource leak.
- **Fix:** Cached the tool instance in a module-level variable and reused it.
- **Files modified:** js/profileEditor.js
- **Commit:** 7cc95ec

## Commits

| Hash | Description |
|------|-------------|
| 24f15cc | fix(18-01): input validation and guard fixes (BE-01, BE-04, BE-06, BE-07, BE-08) |
| b27c7e9 | fix(18-01): dimension validation, memory tracker, bridge error state (BE-09, BE-10, BE-11) |
| 7cc95ec | fix(18-01): tool leak fix and documentation (BE-02, BE-03, BE-05) |

## Next Phase Readiness

All 11 backend bugs resolved. No blockers introduced. The codebase is now more robust against:
- User input edge cases (zero/negative dimensions, large SVGs, text field keyboard conflicts)
- Worker failures (bridge resets state, wall thickness clamped)
- Memory tracking gaps (Chrome fallback for heap size)
- Resource leaks (cached Tool instance)
