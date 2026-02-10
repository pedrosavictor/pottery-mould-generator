---
phase: 01-wasm-foundation
plan: 02
subsystem: geometry-engine
tags: [worker-bridge, memory-management, profile-data, promise-api, cancellation]
dependency-graph:
  requires: [01-01]
  provides: [geometry-bridge-api, profile-data-model, wasm-memory-safety, cancellation-pattern]
  affects: [01-03, 02-01, 02-02, all-geometry-consumers]
tech-stack:
  added: []
  patterns: [promise-over-postmessage, generation-counter-cancellation, withCleanup-wasm-tracking]
key-files:
  created:
    - js/profileData.js
    - js/geometryBridge.js
    - js/workers/memoryTracker.js
  modified:
    - js/workers/geometryWorker.js
decisions:
  - id: CANCELLATION-PATTERN
    choice: "Generation counter (latest-wins) instead of AbortController"
    reason: "WASM operations cannot be interrupted mid-execution; cancellation means discarding stale results on main thread"
  - id: MEMORY-TRACKING
    choice: "withCleanup((track) => { ... }) pattern wrapping all geometry operations"
    reason: "Guarantees shape.delete() in finally block even if operation throws; prevents WASM heap leaks"
  - id: PROFILE-AXIS-CROSSING
    choice: "Validation rejects points with x === 0 except first and last"
    reason: "Mid-profile axis crossing creates self-intersecting solids that fail to revolve"
metrics:
  duration: ~3 minutes
  completed: 2026-02-10
---

# Phase 1 Plan 02: Geometry Bridge and Memory Management Summary

**One-liner:** Promise-based geometry bridge with latest-wins cancellation, withCleanup WASM memory safety, and canonical profile data model with v2 seamLines extension point.

## What Was Done

### Task 1: Profile Data Model (commit f7b7ac6)

Created `js/profileData.js` (184 lines) as a pure ES module defining the canonical profile data structure:

- **`createProfile(points)`** -- Factory returning `{ points, seamLines: [], units: 'mm', version: 1 }`. The seamLines array is the v2 extension point (INFRA-05) for multi-part mould split definitions.

- **`getTestProfile()`** -- Returns a 6-point cup shape profile for Phase 1 testing: 30mm foot, curved belly via bezier segments, 42mm rim at 85mm height. Exercises both `line` and `bezier` segment types.

- **`validateProfile(profile)`** -- Structural validation returning `{ valid, errors }`. Checks: min 2 points, numeric x/y >= 0, valid type ('line'|'bezier'), bezier control points present, no mid-profile axis crossing (x === 0), version === 1.

- Full JSDoc documenting coordinate system (x = radius, y = height), that the profile represents the outer pot surface, and that closing path is added by the geometry worker.

### Task 2: Memory Tracker, Geometry Bridge, Worker Updates (commit f4dc179)

Created three interconnected modules:

**`js/workers/memoryTracker.js`** (76 lines):
- `withCleanup(fn)` -- Tracks WASM objects via `track()` callback, calls `.delete()` on all tracked objects in `finally` block. Guarantees cleanup even on error.
- `getHeapSize()` -- Reads Emscripten `Module.HEAP8.buffer.byteLength` for memory monitoring.

**`js/geometryBridge.js`** (281 lines):
- `init(onProgress)` -- Creates worker, sets up message routing, returns Promise resolving when WASM is ready. Progress callback receives `(stage, percent)` during init.
- `revolveProfile(profilePoints)` -- Sends revolve command, returns Promise with `{ vertices, normals, triangles }`.
- `generateWithCancellation(profilePoints)` -- Latest-wins pattern: increments generation counter, awaits revolve, returns null if superseded by newer request.
- `runMemoryTest(profilePoints, iterations)` -- Runs N revolves in worker, returns heap size after each for leak testing.
- `getHeapSize()` -- Queries worker for current WASM heap size.
- `destroy()` -- Terminates worker, rejects all pending promises, resets state.
- `isReady()` -- Boolean check for initialization status.

**`js/workers/geometryWorker.js`** (updated, 267 lines):
- Added `import { withCleanup, getHeapSize } from './memoryTracker.js'`
- Wrapped `revolveProfile()` body in `withCleanup((track) => { ... })`, tracking the revolved shape with `track()`
- Added `heapSize` command returning `getHeapSize()`
- Added `memoryTest` command running N iterations with heap reporting
- Updated header comments to reflect withCleanup integration

## API Surface: geometryBridge.js

```javascript
// Initialize WASM engine (call once on app start)
const { ready } = await init((stage, percent) => console.log(stage, percent));

// Revolve a profile into mesh data
const { vertices, normals, triangles } = await revolveProfile(points);

// Revolve with latest-wins cancellation (for real-time editing)
const result = await generateWithCancellation(points); // null if stale

// Memory leak test (Phase 1 success criteria #3)
const { results } = await runMemoryTest(points, 20);
// results: [{ iteration: 1, heapSize: 12345678 }, ...]

// Cleanup
const heapInfo = await getHeapSize();
const isUp = isReady();
destroy(); // Terminates worker, rejects pending
```

## Profile Data Model Structure

```javascript
{
  points: [
    { x: 30, y: 0, type: 'line' },           // foot bottom
    { x: 30, y: 3, type: 'line' },           // foot top
    { x: 25, y: 5, type: 'line' },           // transition
    { x: 35, y: 50, type: 'bezier',          // belly curve
      cp1: { x: 22, y: 20 },
      cp2: { x: 30, y: 40 } },
    { x: 40, y: 80, type: 'bezier',          // body to rim
      cp1: { x: 38, y: 55 },
      cp2: { x: 40, y: 70 } },
    { x: 42, y: 85, type: 'line' },          // rim
  ],
  seamLines: [],  // v2: multi-part mould split definitions
  units: 'mm',
  version: 1,
}
```

## Changes to geometryWorker.js (from Plan 01-01)

| Change | Before (01-01) | After (01-02) |
|--------|----------------|---------------|
| Memory management | Direct `shape.delete()` after mesh extraction | `withCleanup((track) => { track(shape); ... })` with auto-cleanup |
| Import | None | `import { withCleanup, getHeapSize } from './memoryTracker.js'` |
| Commands | `init`, `revolve` | `init`, `revolve`, `heapSize`, `memoryTest` |
| Header comment | "withCleanup NOT implemented here" | Documents withCleanup integration |
| Error safety | shape.delete() skipped on error | Guaranteed cleanup via finally block |

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Cancellation pattern | Generation counter (latest-wins) | WASM ops can't be interrupted; discard stale results instead |
| Memory tracking | withCleanup + track() callback | Guarantees shape.delete() in finally block even on error |
| Profile axis crossing | Reject x === 0 mid-profile | Creates self-intersecting solids that fail to revolve |
| Bridge error handling | Reject all pending on worker error | Worker may be in bad state; callers shouldn't hang |
| Progress routing | Broadcast (no ID) vs response (has ID) | Init progress has no specific caller; responses need ID matching |

## Deviations from Plan

None -- plan executed exactly as written.

## Files Created/Modified

| File | Lines | Purpose |
|------|-------|---------|
| `js/profileData.js` | 184 | Profile data model: createProfile, getTestProfile, validateProfile |
| `js/geometryBridge.js` | 281 | Promise-based worker communication bridge with cancellation |
| `js/workers/memoryTracker.js` | 76 | withCleanup WASM memory safety + getHeapSize monitoring |
| `js/workers/geometryWorker.js` | 267 | Updated: withCleanup integration + heapSize/memoryTest commands |

## Next Phase Readiness

**For Plan 01-03 (Three.js preview, end-to-end pipeline):**
- The geometry bridge provides the clean `await revolveProfile(points)` API
- The test profile provides a ready-made cup shape to visualize
- Mesh data format (`{ vertices, normals, triangles }`) maps directly to THREE.BufferGeometry
- Memory test command is ready for the 20-iteration leak validation
- `generateWithCancellation()` is ready for real-time profile editing in Phase 2

## Commits

| Hash | Message |
|------|---------|
| f7b7ac6 | feat(01-02): create profile data model with test profile and v2 extension |
| f4dc179 | feat(01-02): add memory tracker, geometry bridge, and worker integration |
