# Phase 4 Plan 03: View Controls, Exploded View, and 3D Measurements Summary

**One-liner:** Part visibility toggles, assembled/exploded view mode, and canvas-sprite 3D measurement annotations with dashed lines

## Plan Details

- **Phase:** 4 (Live 3D Preview)
- **Plan:** 04-03
- **Subsystem:** 3D Preview / View Controls
- **Tags:** three.js, sprites, measurements, exploded-view, ui-controls
- **Duration:** ~2.5 minutes
- **Completed:** 2026-02-11

## Dependency Graph

- **Requires:** 04-01 (part manager, LatheGeometry), 04-02 (live preview wiring)
- **Provides:** Part visibility toggles, exploded view mode, 3D measurement annotations
- **Affects:** Phase 5 (mould parts will use visibility toggles and exploded offsets), Phase 6 (ring/proof parts)

## What Was Built

### View Controls UI (index.html + style.css)
- **Toggle group** with checkboxes for pot, inner mould, outer mould, ring, and proof model
- Pot checkbox is active; mould/ring/proof checkboxes are disabled (enabled in Phases 5-6)
- **Assembled/Exploded** toggle buttons styled like mode toggle (pill-shaped pair)
- **Show Measurements** checkbox for 3D annotation overlay

### Exploded View (preview3d.js)
- `setExplodedView(boolean)` export offsets parts vertically using EXPLODED_OFFSETS table
- Predefined offsets: pot=0, inner-mould=100, outer-mould=200, ring=300, proof=400
- Currently only pot exists at y=0 in both modes; future parts plug into the offset table

### 3D Measurement Annotations (preview3d.js)
- `updateMeasurements(profilePoints, visible)` export creates/removes measurement overlays
- **Canvas-sprite text labels**: Renders text onto a canvas element, creates THREE.CanvasTexture, wraps in THREE.Sprite with sizeAttenuation=false for screen-space sizing
- **Dashed measurement lines**: THREE.LineDashedMaterial with depthTest=false (always visible)
- **Height line**: Vertical dashed line with tick marks at min/max Y, offset 15mm past max radius
- **Rim diameter line**: Horizontal line at top of profile spanning full rim diameter
- **Belly diameter line**: Horizontal line at widest point (only shown if >4mm wider than rim)
- All objects collected in a THREE.Group for atomic add/remove
- Proper disposal of geometries, materials, and textures on update/hide

### App Wiring (app.js)
- `initViewControls()` called during DOMContentLoaded
- Pot visibility checkbox wired to `setPartVisibility('pot', checked)`
- Assembled/Exploded buttons toggle `setExplodedView()` and active class
- Measurement checkbox toggles `showMeasurements` state
- `lastProfilePoints` tracked across all profile update paths (onLivePreview, onProfileChange, initial setup)
- Measurements auto-update during live preview drag when checkbox is checked

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Canvas-sprite text labels (not CSS2DRenderer) | Zero additional dependencies; works with existing Three.js setup |
| sizeAttenuation=false for sprites | Labels maintain readable screen size regardless of zoom |
| depthTest=false on lines and sprites | Measurements always visible even behind mesh |
| EXPLODED_OFFSETS lookup table | Clean extension point for Phases 5-6 mould parts |
| Mould/ring/proof checkboxes disabled | Clear UX signal that parts exist but aren't generated yet |
| Measurements in XY plane at z=0 | Matches LatheGeometry revolution plane for clean alignment |
| roundRect for sprite backgrounds | Polished label appearance matching UI design language |

## Tech Stack

- **Patterns established:** Canvas-to-sprite text rendering pattern for 3D labels, dashed line measurement pattern
- **No new libraries added** -- pure Three.js primitives

## Key Files

### Created
- `.planning/phases/phase-4/04-03-SUMMARY.md`

### Modified
- `index.html` -- Added view-controls section with toggles and buttons
- `css/style.css` -- Added toggle-group, toggle-item, view-mode-toggle, view-btn styles
- `js/preview3d.js` -- Added setExplodedView(), updateMeasurements(), createTextSprite(), createDashedLine()
- `js/app.js` -- Added initViewControls(), showMeasurements state, lastProfilePoints tracking

## Deviations from Plan

None -- plan executed exactly as written. Tasks 1 and 2 were committed together as they share tightly coupled code (the measurement checkbox UI requires the measurement rendering code and vice versa).

## Commits

| Hash | Message |
|------|---------|
| d4c4fb8 | feat(04-03): add view controls, exploded view, and measurement annotations |

## Verification

- [x] View controls section renders in sidebar with all toggles
- [x] Pot visibility checkbox wired to setPartVisibility
- [x] Assembled/Exploded buttons toggle setExplodedView with active class
- [x] Measurement checkbox toggles updateMeasurements
- [x] Measurements update during live preview drag
- [x] Measurement group properly disposed on hide/update
- [x] Text sprites use canvas rendering (no extra dependencies)
- [x] Dashed lines with depthTest=false for always-visible annotations
- [x] Exploded offsets table ready for future mould parts

## Next Phase Readiness

Phase 4 (Live 3D Preview) is now COMPLETE (3/3 plans). All three core capabilities are in place:
1. **04-01**: Part manager + LatheGeometry fallback
2. **04-02**: Real-time drag preview with dual-tier pipeline
3. **04-03**: View controls, exploded view, and measurement annotations

Ready to proceed to Phase 5 (Mould Shell Generation).

### Browser Validation Needed
- View controls toggle interaction and visual appearance
- 3D measurement label readability at various zoom levels
- Exploded view vertical spacing (will be more visible with multiple parts in Phase 5+)
