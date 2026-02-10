---
phase: 01-wasm-foundation
plan: 01
subsystem: geometry-engine
tags: [wasm, replicad, opencascade, web-worker, spike]
dependency-graph:
  requires: []
  provides: [wasm-loading-pattern, mesh-data-types, geometry-worker-skeleton]
  affects: [01-02, 01-03, all-geometry-operations]
tech-stack:
  added: [replicad@0.20.5, replicad-opencascadejs@0.20.2]
  patterns: [module-worker-esm-import, cdn-direct-url, transferable-arraybuffer]
key-files:
  created:
    - spike/spike-worker.js
    - spike/wasm-spike.html
    - wasm/.gitkeep
    - js/workers/geometryWorker.js
  modified: []
decisions:
  - id: CDN-LOADING
    choice: "Direct CDN URL imports via dynamic import() in module worker"
    reason: "No import maps in workers; direct URLs are simplest and most reliable"
  - id: MESH-TYPE-ASSUMPTION
    choice: "Assume shape.mesh() returns plain number[] (JS arrays), convert to Float32Array"
    reason: "Research indicates replicad wraps OCCT mesh data as JS arrays; spike will validate"
  - id: WASM-URL-STRATEGY
    choice: "CDN URLs for all assets (JS + WASM), with self-hosted fallback documented"
    reason: "jsdelivr serves .wasm with correct MIME type; self-hosting available if needed"
  - id: PROFILE-CLOSURE
    choice: "Auto-close profiles back to axis: lastPoint -> [0, lastY] -> [0, firstY] -> close()"
    reason: "Pottery profiles are half cross-sections; closing to axis creates watertight solid for revolve"
metrics:
  duration: ~5 minutes
  completed: 2026-02-10
---

# Phase 1 Plan 01: WASM Spike Summary

**One-liner:** replicad CDN loading spike with module worker + production geometryWorker.js skeleton using direct URL imports, revolve pipeline, and Transferable mesh transfer.

## What Was Done

### Task 1: WASM Spike Files (commit b5df031)

Created a self-contained spike to validate all 5 open questions from Phase 1 RESEARCH.md:

- **spike/spike-worker.js** (365 lines): Module worker that tests the full loading chain -- imports replicad ESM from CDN, imports opencascade init, loads WASM binary, initializes with setOC(), revolves a rectangle profile, revolves a cup profile, inspects mesh data types, tests shape.delete(), and runs 5 consecutive revolve/delete cycles.

- **spike/wasm-spike.html** (279 lines): Test harness page with live status display, individual answer boxes for each open question, timing readouts, a scrolling log, and CDN fallback instructions if loading fails.

- **wasm/.gitkeep**: Placeholder directory for future self-hosted WASM files.

### Task 2: Production geometryWorker.js (commit 891f5cb)

Created the production worker that will be used throughout the project:

- **js/workers/geometryWorker.js** (238 lines): Module worker with:
  - Direct CDN URL constants for replicad, opencascade JS, and WASM
  - `initialize()` with 3-stage progress reporting (downloading, compiling, ready)
  - `self.onmessage` handler routing `init` and `revolve` commands
  - `revolveProfile(points)` handling both `line` and `bezier` point types
  - Auto-closure of profiles back to the revolution axis
  - Typed array conversion (Float32Array/Uint32Array) for Transferable transfer
  - `shape.delete()` after mesh extraction
  - Eager initialization on worker load

## Answers to 5 Open Questions

**IMPORTANT: These are expected answers based on research. They MUST be validated by running the spike in a browser. The spike is designed to confirm or invalidate each one.**

### Q1: Does replicad ESM load in a module worker from CDN?

**Expected:** YES. The replicad `dist/replicad.js` is a valid ESM module with `export` statements. Dynamic `import()` of full CDN URLs works in module workers (`{ type: 'module' }`). The spike uses `import(REPLICAD_URL)` to load it.

**Risk:** If replicad.js has internal bare specifier imports (e.g., `import { something } from 'replicad-opencascadejs'`), loading will fail. The spike detects this and logs the exact error. Fallback options: esm.sh CDN, self-hosted bundle, or Vite worker build.

**Implemented in worker:** Dynamic `import()` with full CDN URLs.

### Q2: What is the exact runtime type of shape.mesh()?

**Expected:** Returns `{ vertices: number[], normals: number[], triangles: number[], faceGroups: object[] }` where vertices/normals/triangles are plain JavaScript arrays (not Float32Array). The spike logs `typeof`, `Array.isArray()`, `constructor.name`, and sample values to confirm.

**Implemented in worker:** Converts to `new Float32Array(meshData.vertices)` etc. for Transferable transfer. This works whether the source is number[] or Float32Array.

### Q3: Does shape.delete() properly free memory?

**Expected:** YES. `shape.delete()` calls the OCCT destructor via Emscripten bindings, freeing the BRep shape from the WASM heap. Intermediate objects created during `draw().close().sketchOnPlane()` are consumed by downstream operations. The spike runs 5 consecutive revolve+mesh+delete cycles to verify no crash.

**Note:** WASM heap size may grow after the first operation and then plateau (WASM memory is never returned to the OS, only reused). Continuous growth across cycles indicates a real leak.

### Q4: Does XZ-plane + default revolve work for pottery profiles?

**Expected:** YES. `sketchOnPlane("XZ")` places the drawing in 3D with drawing-X -> 3D-X and drawing-Y -> 3D-Z. `revolve()` defaults to 360-degree revolution around the Z axis. For a pottery profile where X=radius and Y=height, this produces the correct solid of revolution. The spike tests both a simple rectangle and a cup-shaped profile.

### Q5: Is replicad_single.js ESM or CommonJS?

**Expected:** ESM (has `export default` statement). It is an Emscripten-generated module wrapper. The spike fetches the file, inspects the first 500 characters, and checks for `export default`, `module.exports`, and `define(`. The result determines whether `import()` or `importScripts()` is needed.

**Implemented in worker:** Uses `import()` with fallback logic if the module format is not ESM.

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| CDN loading pattern | Direct URL via dynamic `import()` | Import maps don't work in workers; direct URLs are simplest |
| Mesh data conversion | Assume JS arrays, convert to Float32Array | Safe regardless of actual type; enables Transferable |
| WASM URL strategy | CDN for all (JS + WASM) | jsdelivr serves .wasm correctly; self-hosting documented as fallback |
| Profile closure | Auto-close to axis: lastPt -> [0, lastY] -> [0, firstY] -> close | Half-profile must form closed loop for revolve solid |
| Progress reporting | 3-stage (downloading, compiling, ready) | Main thread can show meaningful loading indicator |
| Initialization | Eager (start on worker load) | WASM starts downloading before first command arrives |

## Deviations from Plan

None -- plan executed exactly as written.

## Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `spike/spike-worker.js` | 365 | Module worker testing all 5 open questions |
| `spike/wasm-spike.html` | 279 | Self-contained test harness with live display |
| `wasm/.gitkeep` | 0 | Placeholder for self-hosted WASM files |
| `js/workers/geometryWorker.js` | 238 | Production worker: WASM init + revolve pipeline |

## Next Phase Readiness

**For Plan 01-02 (Profile data model, geometry bridge, memory management):**
- The geometry worker is ready to receive commands via the bridge
- The `revolveProfile()` function accepts the profile data model format
- The `withCleanup()` wrapper needs to be added around revolveProfile
- Cancellation logic needs to be added to the message handler
- The worker supports Transferable ArrayBuffer transfer

**For Plan 01-03 (Three.js preview, end-to-end pipeline):**
- Mesh data format is documented: `{ vertices: Float32Array, normals: Float32Array, triangles: Uint32Array }`
- This maps directly to `THREE.BufferGeometry` attributes

**CRITICAL: Before proceeding to 01-02, the spike MUST be run in a browser to validate answers to all 5 open questions.** If CDN loading fails, the worker URLs must be updated before the bridge is built.

## Commits

| Hash | Message |
|------|---------|
| b5df031 | feat(01-01): create WASM spike to validate replicad CDN loading |
| 891f5cb | feat(01-01): create production geometryWorker.js with replicad integration |
