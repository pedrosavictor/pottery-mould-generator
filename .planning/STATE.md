# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-10)

**Core value:** Instant mould generation from a 2D profile -- a potter draws their pot shape, and the app generates all 3D-printable mould parts with zero CAD knowledge required.
**Current focus:** Phase 3 in progress -- Profile Editor Extended (1/2 plans done)

## Current Position

Phase: 3 of 9 (Profile Editor Extended)
Plan: 1 of 2 in current phase
Status: In progress
Last activity: 2026-02-10 -- Completed 03-01-PLAN.md (Parametric presets + mode switching)

Progress: [███████░░░░░░░░░░░░░░░░░░] 29% (7/24 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 7
- Average duration: ~4 minutes
- Total execution time: ~29 minutes

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. WASM Foundation | 3/3 | ~12m | ~4m |
| 2. Profile Editor Core | 3/3 | ~13m | ~4m |
| 3. Profile Editor Extended | 1/2 | ~4m | ~4m |

**Recent Trend:**
- Last 5 plans: 02-01 (~5m), 02-02 (~3m), 02-03 (~5m), 03-01 (~4m)
- Trend: Stable at ~4m/plan

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

### Pending Todos

- Browser validation of WASM CDN loading still pending (deferred from headless CI). First browser test should confirm: replicad ESM loads, WASM binary loads, mesh renders, memory test passes.
- Browser validation of profile editor -- coordinate transforms and handle mapping need visual confirmation.
- Browser validation of constraint overlay rendering and status indicator appearance.
- Browser validation of undo/redo keyboard shortcuts (Cmd vs Ctrl detection).
- Browser validation of dimension overlay positioning and grid adaptive spacing.
- Browser validation of parametric preset slider interaction and mode switching.

### Blockers/Concerns

- [Phase 1 -> Phase 2]: WASM CDN loading is coded but NOT YET VALIDATED in a browser. Spike should be run before deep Phase 2 work to catch any CDN loading issues early.
- [Phase 1]: If replicad.js has internal bare specifier imports, CDN loading will fail. Fallback: esm.sh, self-hosted bundle, or Vite worker build.
- [Phase 2]: Handle mapping (profile cp1/cp2 <-> Paper.js handleIn/handleOut) is complex and most likely source of visual bugs -- needs browser validation.
- [Phase 6]: Ridge/groove dimensions and clearance values need physical test prints to validate -- cannot be determined from research alone

## Session Continuity

Last session: 2026-02-10
Stopped at: Completed 03-01-PLAN.md (Parametric presets + mode switching)
Resume file: None
