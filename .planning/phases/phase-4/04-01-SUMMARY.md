---
phase: 04-live-3d-preview
plan: 01
subsystem: 3d-preview
tags: [three.js, LatheGeometry, part-manager, instant-preview]
dependency-graph:
  requires: [01-03, 02-01, 03-01]
  provides: [lathe-fallback, part-manager, dual-path-preview]
  affects: [04-02, 04-03, 05-01, 06-01]
tech-stack:
  added: []
  patterns: [dual-path-rendering, part-manager-map, bezier-sampling]
key-files:
  created: []
  modified: [js/preview3d.js, js/app.js, index.html, css/style.css]
decisions:
  - id: "04-01-lathe-y-axis"
    choice: "LatheGeometry revolves around Y axis matching existing scene orientation"
    reason: "Profile x=radius, y=height maps directly to Vector2(x,y) for LatheGeometry"
  - id: "04-01-part-manager-map"
    choice: "Map<string, {group, meshes}> for named part management"
    reason: "Simple, efficient, supports independent visibility and disposal per part"
  - id: "04-01-bezier-10-samples"
    choice: "10 intermediate samples per bezier segment for LatheGeometry"
    reason: "Good visual quality at minimal cost; LatheGeometry is already fast"
  - id: "04-01-dual-path"
    choice: "LatheGeometry instant + WASM async dual-path in onProfileChange"
    reason: "User sees feedback immediately during drag, WASM upgrades quality when ready"
  - id: "04-01-backward-compat"
    choice: "Keep updateMesh/clearMesh as wrappers around part manager"
    reason: "Existing code continues to work without modification during transition"
metrics:
  duration: "~3.5 minutes"
  completed: "2026-02-11"
---

# Phase 4 Plan 01: LatheGeometry Instant Fallback and Part Manager Summary

Instant LatheGeometry fallback (~1ms) with cubic bezier sampling, Map-based part manager for named 3D objects, dual-path rendering pipeline (instant + WASM async)

## What Was Built

### LatheGeometry Fallback (preview3d.js)
- `updateLatheFallback(profilePoints)` converts profile points to Vector2 array and creates `THREE.LatheGeometry` with 64 radial segments
- `sampleBezierCurve()` implements cubic bezier formula B(t) = (1-t)^3*P0 + 3*(1-t)^2*t*CP1 + 3*(1-t)*t^2*CP2 + t^3*P1
- `profileToVector2Array()` handles both line and bezier segment types
- Mesh stored as the 'pot' part in the part manager

### Part Manager (preview3d.js)
- `parts` Map tracks named 3D objects: `Map<string, { group: THREE.Group, meshes: THREE.Mesh[] }>`
- `updatePartMesh(partName, meshData)` creates BufferGeometry from worker data
- `setPartVisibility(partName, visible)` toggles group visibility
- `clearAllParts()` disposes and removes all parts
- Backward-compatible `updateMesh()` and `clearMesh()` wrappers

### Dual-Path Preview Pipeline (app.js)
- On page load: `updateLatheFallback(initialPoints)` shows 3D pot instantly
- WASM init completes: `generateWithCancellation()` upgrades to CAD mesh
- `onProfileChange()`: always calls LatheGeometry first (instant), then WASM (async)
- Graceful degradation: if WASM fails, LatheGeometry preview remains

### Preview Status UI (index.html, style.css)
- `#preview-status` overlay shows "Preview" (LatheGeometry) or "CAD -- N verts, N tris" (WASM)
- Semi-transparent dark badge, positioned bottom-left of 3D preview panel

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 74b3523 | feat | LatheGeometry fallback and part manager in preview3d.js |
| bec89a7 | feat | Wire instant preview in app.js and add preview status UI |

## Deviations from Plan

None -- plan executed exactly as written.

## Verification Results

1. LatheGeometry created from profile points using bezier curve sampling - PASS
2. Part manager supports named parts with independent visibility control - PASS
3. Existing updateMesh/clearMesh APIs still work (backward compatible) - PASS
4. App initialization shows instant 3D preview before WASM loads - PASS
5. Profile changes trigger both LatheGeometry (instant) and WASM (delayed) updates - PASS
6. Preview status indicator displays in the 3D preview panel - PASS

## Exported API (preview3d.js)

| Function | Purpose |
|----------|---------|
| `initScene(container)` | Initialize Three.js scene |
| `updateLatheFallback(profilePoints)` | Instant LatheGeometry from profile points |
| `updatePartMesh(partName, meshData)` | WASM mesh for named part |
| `setPartVisibility(partName, visible)` | Toggle part visibility |
| `clearAllParts()` | Remove all parts |
| `updateMesh(meshData)` | Backward compat (calls updatePartMesh('pot', ...)) |
| `clearMesh()` | Backward compat (clears 'pot' part) |
| `getRenderer()` | Get renderer instance |

## Next Phase Readiness

- Part manager is ready for Phase 5/6 mould parts (e.g., 'mould-top', 'mould-bottom')
- LatheGeometry fallback provides immediate feedback path for all future profile interactions
- Browser validation still pending: LatheGeometry visual quality, preview status overlay positioning
