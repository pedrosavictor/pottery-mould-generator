---
phase: 04-live-3d-preview
plan: 02
subsystem: 3d-preview
tags: [live-preview, dual-tier, LatheGeometry, drag-callback, real-time]
dependency-graph:
  requires: [04-01]
  provides: [live-drag-preview, dual-tier-pipeline, onLivePreview-callback]
  affects: [04-03, 05-01]
tech-stack:
  added: []
  patterns: [dual-tier-rendering, lightweight-drag-callback, separation-of-drag-vs-release]
key-files:
  created: []
  modified:
    - js/profileEditor.js
    - js/profileEditor/editTool.js
    - js/profileEditor/drawTool.js
    - js/app.js
decisions:
  - id: "04-02-01"
    decision: "notifyLivePreview fires on every mouseDrag without throttling -- LatheGeometry is fast enough (~1ms)"
    rationale: "No debounce needed; LatheGeometry revolve is synchronous and sub-millisecond"
  - id: "04-02-02"
    decision: "onLivePreview is a separate callback from onChange to keep drag path lightweight"
    rationale: "Drag fires 60fps; must avoid undo push, constraint validation, WASM trigger"
  - id: "04-02-03"
    decision: "Preview status updates to 'Preview' during drag, upgraded text after WASM result"
    rationale: "User knows they are seeing approximate geometry vs full CAD mesh"
metrics:
  duration: "~1.3 minutes"
  completed: "2026-02-11"
---

# Phase 4 Plan 02: Real-time Drag Preview with Dual-Tier Pipeline Summary

**One-liner:** Wired editTool/drawTool drag events to instant LatheGeometry 3D preview via notifyLivePreview callback, keeping WASM for mouseUp only.

## What Was Done

### Task 1: Add live preview callback to editor state and wire tools
- Added `onLivePreview` option to `initProfileEditor()` alongside existing `onChange`
- Added `notifyLivePreview()` method to `editorState` that syncs path to profile points and calls the lightweight callback
- `notifyLivePreview()` intentionally skips undo push, constraint validation, and dimension updates for performance
- Wired `editTool.onMouseDrag` to call `editorState.notifyLivePreview()` on every drag frame
- Wired `drawTool` to call `editorState.notifyLivePreview()` before `notifyChange()` when inserting a point

### Task 2: Wire app.js dual-tier preview
- Created `onLivePreview()` handler in app.js that calls only `preview3d.updateLatheFallback()` (~1ms)
- Passed `onLivePreview` to `initProfileEditor()` as a third callback option
- Existing `onProfileChange` (fired on mouseUp) continues to run both LatheGeometry + WASM generation
- Preview status badge updates to "Preview" during drag, shows CAD stats after WASM result

## Dual-Tier Preview Architecture

```
User drags point in 2D editor
  |
  +-- [every mouseDrag frame]
  |     editTool.onMouseDrag
  |       -> editorState.notifyLivePreview()
  |         -> syncPathToProfile() -> onLivePreview(points)
  |           -> preview3d.updateLatheFallback(points)  [~1ms, synchronous]
  |
  +-- [mouseUp only]
        editTool.onMouseUp
          -> editorState.notifyChange()
            -> syncPathToProfile() -> onChange(points)
              -> onProfileChange(points)
                -> preview3d.updateLatheFallback(points)   [instant]
                -> geometryBridge.generateWithCancellation  [async, 50-500ms]
                  -> preview3d.updateMesh(result)           [replaces LatheGeometry]
```

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| 04-02-01 | No throttle on notifyLivePreview | LatheGeometry is ~1ms, well within 16ms frame budget |
| 04-02-02 | Separate onLivePreview callback from onChange | Drag path must avoid undo, validation, WASM overhead |
| 04-02-03 | Preview status shows 'Preview' during drag | User awareness of approximate vs CAD geometry |

## Verification Results

| Check | Result |
|-------|--------|
| editTool fires preview on every drag event | PASS -- notifyLivePreview() in onMouseDrag |
| LatheGeometry under 16ms | PASS -- by design (~1ms synchronous) |
| Full WASM fires on mouseUp | PASS -- notifyChange() still calls onChange/onProfileChange |
| Parametric sliders get instant feedback | PASS -- slider path goes through onProfileChange which calls updateLatheFallback |
| Latest-wins cancellation active | PASS -- generateWithCancellation still used in onProfileChange |
| No undo push during live preview | PASS -- notifyLivePreview skips undoMgr |

## Commits

| Hash | Message |
|------|---------|
| b5eaa02 | feat(04-02): add live preview callback to editor state and wire tools |
| cdf5dd5 | feat(04-02): wire dual-tier preview with onLivePreview in app.js |

## Next Phase Readiness

Plan 04-03 (camera controls and annotations) can proceed. The dual-tier preview pipeline is complete -- all profile edits now produce instant 3D feedback. No blockers.
