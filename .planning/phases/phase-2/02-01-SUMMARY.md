---
phase: 2
plan: 1
subsystem: profile-editor
tags: [paper.js, bezier, canvas, coordinate-transform, 2d-editor]
dependency-graph:
  requires: [phase-1]
  provides: [profile-editor-core, canvas-setup, edit-tool, draw-tool, editor-3d-pipeline]
  affects: [02-02, 02-03, phase-3]
tech-stack:
  added: [paper.js@0.12.18]
  patterns: [shared-editor-state, coordinate-transform, handle-mapping, layer-architecture]
key-files:
  created:
    - js/profileEditor.js
    - js/profileEditor/canvasSetup.js
    - js/profileEditor/pathRenderer.js
    - js/profileEditor/editTool.js
    - js/profileEditor/drawTool.js
  modified:
    - index.html
    - css/style.css
    - js/app.js
decisions:
  - Paper.js CDN (paper-core.min.js) loaded synchronously in head, before module script
  - 4-layer architecture (grid, profile, handles, overlay) for clean separation
  - Y-flip coordinate transform with 15%/90% offset for bottom-left origin
  - Shared editorState object pattern for cross-tool communication
  - Handle mapping -- profile cp1/cp2 (absolute mm) to Paper.js handleIn/handleOut (relative px)
  - 0.5px length threshold for zero-handle detection (avoids floating-point noise)
  - Snap tolerance 20px for draw tool, hit tolerance 10px for edit tool
metrics:
  duration: ~5 minutes
  completed: 2026-02-10
---

# Phase 2 Plan 1: Paper.js Canvas with Bezier Curve Drawing and Editing

Paper.js profile editor with Y-flip coordinate transforms, 4-layer canvas, profile-to-segment handle mapping, edit/draw tools, and live 3D preview pipeline via generateWithCancellation.

## What Was Built

### Canvas Setup (canvasSetup.js)
- `initCanvas()`: Paper.js setup with 4 named layers (grid, profile, handles, overlay)
- `createTransform()`: Bidirectional coordinate transform between profile mm and canvas pixels
  - Y-flip: profile Y-up mapped to canvas Y-down
  - Scale computed from `Math.min(width*0.7/maxRadius, height*0.8/maxHeight)`
  - Origin at 15% from left, 90% from top (bottom-left of drawing area)
  - `toCanvas(x, y)` and `toProfile(canvasPoint)` with 2-decimal rounding

### Path Rendering (pathRenderer.js)
- `renderProfile()`: Converts profile points to Paper.js Segments with handle mapping
  - handleIn for segment[i] from point[i].cp2 (relative to anchor)
  - handleOut for segment[i] from point[i+1].cp1 (relative to anchor)
- `renderHandles()`: Draws anchor circles (5px, dark), handle tips (3.5px, terra cotta), connecting lines
- `syncPathToProfile()`: Inverse mapping -- reads Paper.js segments back to profile data model format
  - Detects bezier vs line from handle length (>0.5px threshold)
  - Computes absolute cp1/cp2 from relative handles
  - Clamps radius/height to >= 0

### Edit Tool (editTool.js)
- Hit test priority: handle tips > anchor points > path stroke
- Anchor drag: moves segment point by delta (handles follow automatically)
- Handle drag: adjusts handleIn/handleOut vector by delta
- Backspace/Delete: removes selected segment (minimum 2 enforced)
- mouseUp triggers notifyChange() -> syncs to data model -> updates 3D

### Draw Tool (drawTool.js)
- Click near path: finds nearest curve location via getNearestLocation()
- Inserts point with path.divideAt() (de Casteljau subdivision preserves shape)
- 20px snap tolerance prevents accidental far-from-path clicks

### App Integration (app.js)
- Profile editor initialized synchronously BEFORE WASM (user sees 2D profile immediately)
- `onProfileChange()` callback wired to `generateWithCancellation()` for latest-wins cancellation
- Editor toolbar buttons wired to tool.activate() with active-state CSS toggling

### HTML/CSS
- Paper.js CDN script in head (before module script)
- Editor panel with toolbar (Edit/Draw buttons) before preview container
- Editor container: flex:2, preview container: flex:1.5
- Toolbar: absolute positioned, glass-morphism background, active state in terra cotta
- Responsive: stacks vertically at 768px

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| paper-core.min.js (not paper-full) | Core is sufficient -- no PaperScript/DOM events needed, tools via JS API |
| 4 separate layers | Avoids z-order issues -- handles always above path, grid always below |
| Shared editorState object | Clean cross-module communication without circular imports |
| Handle length threshold 0.5px | Prevents floating-point noise from creating phantom bezier segments |
| Editor before WASM init | Instant visual feedback while 3-15s WASM download happens in background |
| generateWithCancellation in onChange | Prevents queue buildup during rapid handle dragging |

## Deviations from Plan

None -- plan executed exactly as written.

## Verification

- [x] canvasSetup.js exports initCanvas and createTransform
- [x] pathRenderer.js exports renderProfile, renderHandles, syncPathToProfile
- [x] editTool.js exports createEditTool with mouseDown/Drag/Up/KeyDown handlers
- [x] drawTool.js exports createDrawTool with divideAt insertion
- [x] profileEditor.js orchestrates all modules and exposes getProfileData/setProfileData
- [x] app.js initializes editor before WASM, wires onChange to generateWithCancellation
- [x] HTML has Paper.js CDN, editor panel, and toolbar
- [x] CSS has editor-container, toolbar, and responsive styles

## Next Phase Readiness

- Profile editor is functional but NOT browser-tested (headless environment)
- Coordinate transform correctness should be validated visually in browser
- Handle mapping (profile cp1/cp2 <-> Paper.js handleIn/handleOut) is the most complex logic and most likely source of visual bugs
- Grid rendering uses hardcoded 70mm x 130mm range -- will need dynamic scaling for large pots
