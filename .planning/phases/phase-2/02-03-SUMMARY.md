---
phase: 2
plan: 3
subsystem: profile-editor
tags: [undo-redo, grid, snap, dimensions, measurement, overlay]
requires:
  - 02-01 (Paper.js canvas, bezier editing, path rendering)
  - 02-02 (constraint validation, overlay layer usage)
provides:
  - Undo/redo state management for profile editor
  - Adaptive grid overlay with scale-aware spacing
  - Snap-to-grid utilities for point snapping
  - Dimension measurement overlay (height, rim, belly, foot)
  - Dimension input fields for exact mm entry
affects:
  - Phase 3 (preset shapes will use setProfileData which now pushes undo)
  - Phase 4 (seam line editing may need undo integration)
  - Phase 5 (export may reference getDimensions for filename/metadata)
tech-stack:
  added: []
  patterns:
    - Named groups in overlay layer for non-destructive coexistence
    - JSON deep clone for undo snapshots (no structured clone needed)
    - suppressUndoPush flag pattern for undo/redo restore without recursion
key-files:
  created:
    - js/profileEditor/undoManager.js
    - js/profileEditor/gridOverlay.js
    - js/profileEditor/dimensionOverlay.js
  modified:
    - js/profileEditor.js
    - index.html
    - css/style.css
decisions:
  - JSON.stringify/parse for undo snapshots (safe for plain profile data, avoids structuredClone polyfill)
  - Adaptive grid spacing thresholds: <2px/mm=10mm, <5=5mm, <15=2mm, else 1mm
  - Terra cotta axis line (solid, thick) replaces old dashed gray axis
  - Dimension overlay uses named group 'dimensions' to coexist with constraint violation markers
  - applyDimensionInput scales proportionally (not absolute repositioning) to preserve shape character
  - Belly readout is display-only (too ambiguous which point to scale for belly diameter input)
metrics:
  duration: ~5m
  completed: 2026-02-10
---

# Phase 2 Plan 3: Undo/Redo, Grid, Snap, Dimensions Summary

Undo/redo stack with JSON deep clone, adaptive grid with terra cotta axis, snap-to-grid utilities, and dimension measurement overlays with direct mm input for height and rim diameter.

## What Was Built

### Task 1: Undo/Redo Manager and Grid Overlay

**undoManager.js** -- Cursor-based history stack with max 100 entries. push() saves JSON snapshot, undo()/redo() navigate the stack, canUndo()/canRedo() for UI state. Discards redo states on new push, shifts oldest when capped.

**gridOverlay.js** -- Scale-aware grid rendering that adapts spacing from 1mm to 10mm based on pixels-per-mm scale. Major lines every 10mm. Revolution axis rendered as thick terra cotta line with "axis" label. Also exports snapToGrid() and snapProfilePoint() for grid-aligned point placement.

**Integration** -- Keyboard shortcuts (Cmd+Z, Cmd+Shift+Z, Ctrl+Y) wired via document keydown listener. Undo/Redo toolbar buttons with disabled state tracking. suppressUndoPush flag prevents recursive undo recording during restore. Snap checkbox stores state in editorState for tool access.

### Task 2: Dimension Overlays and Input

**dimensionOverlay.js** -- Three exported functions:
- `getDimensions()`: Pure calculator returning height, rimDiameter, maxDiameter, footDiameter from profile points
- `renderDimensions()`: Draws architectural-style dimension lines (dashed, with end ticks and mm labels) for height (right side), rim (top), belly (widest, only if >2mm different from rim), and foot (bottom)
- `applyDimensionInput()`: Returns new points array with all coordinates scaled proportionally to achieve target height or rim diameter

**Integration** -- Height and rim diameter inputs in sidebar fire on 'change' event, call applyDimensionInput() -> createProfile() -> setProfileDataInternal() which pushes to undo. Belly and foot are read-only readouts. Input fields skip update when focused (prevents overwriting user typing). Dimensions render on every notifyChange, undo/redo, and resize.

## Commits

| Hash | Message |
|------|---------|
| 3a02d4e | feat(02-03): add undo/redo manager, adaptive grid overlay, and snap-to-grid |
| a37a857 | feat(02-03): add dimension overlays, measurement readouts, and dimension input |

## Decisions Made

1. **JSON deep clone for undo** -- JSON.stringify/parse is sufficient for profile data (plain objects, no functions/Dates/circular refs). Avoids structuredClone browser compatibility concerns.

2. **Adaptive grid spacing** -- Thresholds chosen so grid lines never get too dense or too sparse visually. At typical editor scale (~3-5 px/mm), grid shows 5mm spacing which is practical for pottery work.

3. **Terra cotta axis** -- Solid thick line with label replaces old dashed gray line. More visible and consistent with brand palette.

4. **Named overlay group** -- Dimension lines use a named group 'dimensions' within the overlay layer, removed/recreated each render. This prevents clearViolations() from also destroying dimension lines.

5. **Proportional scaling for dimension input** -- When user types a new height, ALL y coordinates scale by the same ratio. This preserves the shape character (curves, transitions) rather than just moving the rim point.

6. **Belly as read-only** -- Belly diameter is read-only because "make the belly wider" requires choosing which intermediate points to move, which is ambiguous. User should drag points directly for belly changes.

## Deviations from Plan

None -- plan executed exactly as written.

## Next Phase Readiness

Phase 2 is now complete (3/3 plans). All profile editor core features are implemented:
- Paper.js canvas with bezier editing (02-01)
- Constraint enforcement and validation (02-02)
- Undo/redo, grid, snap, dimensions (02-03)

**Ready for Phase 3** (preset shapes, import/export, or whatever the roadmap specifies).

**Pending browser validation:**
- Undo/redo keyboard shortcuts need browser testing (Cmd vs Ctrl detection)
- Dimension overlay positioning needs visual confirmation
- Grid adaptive spacing transitions should be verified at different canvas sizes
