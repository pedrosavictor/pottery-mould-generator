# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-10)

**Core value:** Instant mould generation from a 2D profile -- a potter draws their pot shape, and the app generates all 3D-printable mould parts with zero CAD knowledge required.
**Current focus:** Phase 5 IN PROGRESS -- Inner Mould Generation (1/2 plans done). Next: 05-02 (slip well geometry + mould settings UI).

## Current Position

Phase: 5 of 9 (Inner Mould Generation)
Plan: 1 of 2 in current phase
Status: In progress
Last activity: 2026-02-11 -- Completed 05-01-PLAN.md (mould generation pipeline)

Progress: [████████████░░░░░░░░░░░░░] 50% (12/24 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 12
- Average duration: ~3.6 minutes
- Total execution time: ~43.3 minutes

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. WASM Foundation | 3/3 | ~12m | ~4m |
| 2. Profile Editor Core | 3/3 | ~13m | ~4m |
| 3. Profile Editor Extended | 2/2 | ~7m | ~3.5m |
| 4. Live 3D Preview | 3/3 | ~7.3m | ~2.4m |
| 5. Inner Mould Generation | 1/2 | ~4m | ~4m |

**Recent Trend:**
- Last 5 plans: 04-01 (~3.5m), 04-02 (~1.3m), 04-03 (~2.5m), 05-01 (~4m)
- Trend: Stable at ~3-4m per plan

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: 9 phases at comprehensive depth, WASM spike first to de-risk CDN loading
- [Roadmap]: replicad over raw OpenCASCADE.js per research recommendation
- [Roadmap]: Paper.js for profile editor, Three.js for preview per research recommendation
- [01-01]: Direct CDN URL imports via dynamic import() in module worker (no import maps in workers)
- [01-01]: Assume shape.mesh() returns JS arrays, convert to Float32Array for Transferable
- [01-01]: Auto-close profiles back to revolution axis for watertight solid
- [01-01]: Eager WASM initialization on worker load (don't wait for first message)
- [01-02]: Generation counter cancellation (latest-wins) instead of AbortController for WASM ops
- [01-02]: withCleanup((track) => { ... }) pattern for guaranteed WASM memory cleanup
- [01-02]: Profile validation rejects x === 0 mid-profile to prevent self-intersecting solids
- [01-03]: Import map in HTML for Three.js (not workers); workers use direct CDN URLs
- [01-03]: Camera at (0, 80, 250) targeting (0, 42, 0) for cup-scale viewing
- [01-03]: Terra cotta MeshStandardMaterial with DoubleSide for normal direction safety
- [01-03]: Auto-revolve test profile on WASM init complete (validates pipeline every load)
- [02-01]: Paper.js paper-core.min.js via CDN, loaded synchronously in head before module script
- [02-01]: 4-layer canvas architecture (grid, profile, handles, overlay)
- [02-01]: Y-flip coordinate transform with 15%/90% offsets for bottom-left origin
- [02-01]: Shared editorState object for cross-tool communication
- [02-01]: Handle mapping: profile cp1/cp2 (absolute mm) <-> Paper.js handleIn/handleOut (relative px)
- [02-01]: Editor initialized before WASM for instant visual feedback
- [02-02]: Throttle drag validation to every 3rd event for performance
- [02-02]: Undercut tolerance -0.5mm to avoid false positives from floating point
- [02-02]: Foot zone default 5mm -- undercut checking skipped below this height
- [02-02]: Constraint status uses sage green for valid, red for invalid
- [02-03]: JSON.stringify/parse for undo snapshots (safe for plain profile data)
- [02-03]: Adaptive grid spacing: <2px/mm=10mm, <5=5mm, <15=2mm, else 1mm
- [02-03]: Terra cotta axis line (solid, thick) with "axis" label
- [02-03]: Named 'dimensions' group in overlay layer to coexist with constraint markers
- [02-03]: Proportional scaling for dimension input (preserves shape character)
- [02-03]: Belly diameter read-only (scaling ambiguous -- user drags points directly)
- [03-01]: All presets generate 6 profile points for consistency
- [03-01]: App starts in parametric mode with cup preset (not freehand with test profile)
- [03-01]: parametricPresets.js is pure math -- zero DOM/Paper.js dependencies
- [03-01]: No-op Paper.js tool for clean tool deactivation in parametric mode
- [03-02]: importSVGFile takes SVG string, not File object -- parser is pure function
- [03-02]: Reference layer at index 0 (below grid) -- 5-layer canvas architecture
- [03-02]: SVG import auto-switches to freehand mode for direct editing
- [03-02]: Reference image persists across mode switches
- [03-02]: SVG paths normalized to ~100mm height for pottery dimensions
- [03-02]: getLayers/getTransform added to profileEditor public API
- [04-01]: LatheGeometry revolves around Y axis matching existing scene orientation
- [04-01]: Map<string, {group, meshes}> for named part management
- [04-01]: 10 intermediate samples per bezier segment for LatheGeometry
- [04-01]: Dual-path rendering: LatheGeometry instant + WASM async in onProfileChange
- [04-01]: Backward-compatible updateMesh/clearMesh wrappers around part manager
- [04-02]: notifyLivePreview fires on every mouseDrag without throttling (LatheGeometry is ~1ms)
- [04-02]: Separate onLivePreview callback from onChange for lightweight drag path
- [04-02]: Preview status shows 'Preview' during drag, CAD stats after WASM result
- [04-03]: Canvas-sprite text labels (no CSS2DRenderer) for zero additional dependencies
- [04-03]: sizeAttenuation=false for screen-space label sizing regardless of zoom
- [04-03]: EXPLODED_OFFSETS lookup table for clean extension in Phases 5-6
- [04-03]: Mould/ring/proof checkboxes disabled until parts are generated
- [04-03]: depthTest=false on measurement lines and sprites for always-visible annotations
- [05-01]: Single generateMouldWithCancellation call replaces separate revolve + mould calls (avoids counter conflict)
- [05-01]: Proof mesh doubles as 'pot' part (solid terra cotta) and 'proof' part (semi-transparent ghost)
- [05-01]: Shell thickness NEGATIVE (-wallThickness) so wall grows outward from pot surface
- [05-01]: buildAndRevolve() shared helper eliminates code duplication between revolveProfile and generateMouldParts
- [05-01]: FaceFinder.inPlane("XY", topZ) selects rim face for shell opening

### Pending Todos

- Browser validation of WASM CDN loading still pending (deferred from headless CI). First browser test should confirm: replicad ESM loads, WASM binary loads, mesh renders, memory test passes.
- Browser validation of profile editor -- coordinate transforms and handle mapping need visual confirmation.
- Browser validation of constraint overlay rendering and status indicator appearance.
- Browser validation of undo/redo keyboard shortcuts (Cmd vs Ctrl detection).
- Browser validation of dimension overlay positioning and grid adaptive spacing.
- Browser validation of parametric preset slider interaction and mode switching.
- Browser validation of SVG import parsing and reference image overlay.
- Browser validation of LatheGeometry visual quality and preview status overlay positioning.
- Browser validation of real-time drag preview (3D updates during drag, WASM upgrade on release).
- Browser validation of view controls toggle interaction and measurement label readability.
- Browser validation of mould generation: inner mould should be visibly larger than proof, distinct materials.

### Blockers/Concerns

- [Phase 1 -> Phase 2]: WASM CDN loading is coded but NOT YET VALIDATED in a browser. Spike should be run before deep Phase 2 work to catch any CDN loading issues early.
- [Phase 1]: If replicad.js has internal bare specifier imports, CDN loading will fail. Fallback: esm.sh, self-hosted bundle, or Vite worker build.
- [Phase 2]: Handle mapping (profile cp1/cp2 <-> Paper.js handleIn/handleOut) is complex and most likely source of visual bugs -- needs browser validation.
- [Phase 6]: Ridge/groove dimensions and clearance values need physical test prints to validate -- cannot be determined from research alone

## Session Continuity

Last session: 2026-02-11
Stopped at: Completed 05-01-PLAN.md (mould generation pipeline) -- Phase 5 in progress
Resume file: None
