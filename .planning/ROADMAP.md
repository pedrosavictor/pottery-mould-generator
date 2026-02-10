# Roadmap: Pottery Mould Generator

## Overview

This roadmap takes the Pottery Mould Generator from zero to a complete browser-based tool where potters draw a 2D profile and download 3D-printable slip casting mould parts. The build order is driven by technical risk (WASM integration first), then the core value proposition (profile editor + live preview), then domain logic (mould generation), then output systems (export, auth, polish). Nine phases deliver 56 v1 requirements with full coverage.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: WASM Foundation** - OpenCASCADE.js in Web Worker with memory management and basic revolution
- [ ] **Phase 2: Profile Editor Core** - Bezier curve editor with constraints and undo/redo
- [ ] **Phase 3: Profile Editor Extended** - Parametric presets, SVG import, reference image overlay
- [ ] **Phase 4: Live 3D Preview** - Three.js visualization connected to profile editing
- [ ] **Phase 5: Inner Mould Generation** - Shrinkage scaling, wall thickness, slip well, proof model
- [ ] **Phase 6: Outer Mould, Ring, and Assembly** - Outer containment, splitting, ring, ridge/groove features
- [ ] **Phase 7: File Export and Plaster Calculator** - STL/STEP download, ZIP bundling, plaster calculations
- [ ] **Phase 8: Authentication and Freemium** - Supabase auth, subscription gating, design persistence
- [ ] **Phase 9: UI/UX Polish and Deployment** - Branding, responsive design, error handling, deployment

## Phase Details

### Phase 1: WASM Foundation
**Goal**: The geometry engine runs reliably in the browser -- OpenCASCADE.js loads in a Web Worker, can revolve a 2D profile into a 3D solid, return mesh data to the main thread, and clean up WASM memory without leaks.
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-05, MOULD-01
**Success Criteria** (what must be TRUE):
  1. OpenCASCADE.js WASM loads in a Web Worker without blocking the main thread, and the UI remains responsive during loading
  2. A hardcoded test profile can be revolved 360 degrees into a 3D solid, and the resulting mesh renders in a basic Three.js scene
  3. Running 20 consecutive revolve operations does not increase WASM heap size beyond the first operation (memory cleanup works)
  4. The geometry bridge API returns a Promise that resolves with vertex/normal buffers, and cancels stale requests when a new one arrives
  5. The profile data model includes the v2 extension point (seamLines array) even though it is unused
**Plans**: TBD

Plans:
- [ ] 01-01: WASM spike -- validate replicad CDN loading in Web Worker
- [ ] 01-02: Geometry bridge and memory management architecture
- [ ] 01-03: Basic revolution pipeline (profile points to mesh buffers)

### Phase 2: Profile Editor Core
**Goal**: Users can draw and edit a pot cross-section profile using bezier curves with full control over the shape, with real-time constraint enforcement preventing invalid geometry.
**Depends on**: Phase 1 (profile data model)
**Requirements**: PROF-01, PROF-02, PROF-05, PROF-08, PROF-09, PROF-10, PROF-11
**Success Criteria** (what must be TRUE):
  1. User can draw a pot profile by placing bezier curve points on a 2D canvas and adjusting control handles to shape the curves
  2. User can edit an existing profile by dragging points and handles, adding new points on curves, and removing points
  3. Profile editor prevents invalid geometry in real time -- undercuts, self-intersections, and axis crossings are visually flagged and blocked
  4. User can undo and redo profile edits with standard keyboard shortcuts (Cmd+Z / Cmd+Shift+Z)
  5. User can enter precise numeric dimensions (e.g., rim diameter, height) and the profile updates to match
**Plans**: TBD

Plans:
- [ ] 02-01: Paper.js canvas with bezier curve drawing and editing
- [ ] 02-02: Constraint enforcement and validation system
- [ ] 02-03: Undo/redo, snap-to-grid, measurement overlays, and dimension input

### Phase 3: Profile Editor Extended
**Goal**: Users have multiple ways to start a design -- choosing a parametric preset, uploading an existing SVG, or tracing a photo -- making the tool accessible regardless of drawing skill.
**Depends on**: Phase 2 (core editor)
**Requirements**: PROF-03, PROF-04, PROF-06, PROF-07
**Success Criteria** (what must be TRUE):
  1. User can select a parametric preset (cup, bowl, vase, tumbler) and see a profile appear with named sliders (height, rim diameter, belly width, foot diameter) that reshape it in real time
  2. User can switch between parametric mode and freehand bezier mode, with the current profile carrying over
  3. User can upload an SVG file and have it parsed into an editable profile in the editor
  4. User can upload a reference photo, adjust its opacity, and trace the pot outline over it
**Plans**: TBD

Plans:
- [ ] 03-01: Parametric presets with slider-driven profile generation
- [ ] 03-02: SVG import parser and reference image overlay

### Phase 4: Live 3D Preview
**Goal**: Users see their pot and mould take shape in 3D as they edit the profile -- the preview updates within a fraction of a second of any change, providing the instant feedback that is the app's core differentiator over ShapeCast.
**Depends on**: Phase 1 (geometry engine), Phase 2 (profile editor events)
**Requirements**: PREV-01, PREV-02, PREV-03, PREV-04, PREV-05, PREV-06
**Success Criteria** (what must be TRUE):
  1. A lightweight 3D preview (Three.js LatheGeometry) appears immediately on page load while WASM is still loading, then upgrades to the full CAD-generated mesh when ready
  2. User can rotate, zoom, and pan the 3D preview using mouse/touch orbit controls
  3. Editing the profile updates the 3D preview within 200ms (debounced regeneration with latest-wins cancellation)
  4. User can toggle visibility of individual mould components (inner, outer halves, ring, proof model) via checkboxes
  5. User can switch between assembled view (parts together) and exploded view (parts separated) and see measurement annotations (height, rim diameter, belly diameter, foot diameter)
**Plans**: TBD

Plans:
- [ ] 04-01: Three.js scene with orbit controls and lightweight LatheGeometry fallback
- [ ] 04-02: Debounced regeneration pipeline connecting editor to geometry worker
- [ ] 04-03: Part visibility toggles, exploded view, and measurement annotations

### Phase 5: Inner Mould Generation
**Goal**: The app generates a geometrically correct inner mould from the user's profile -- scaled for clay shrinkage, offset for wall thickness, with a slip well attached and a proof model showing the final fired pot.
**Depends on**: Phase 1 (geometry engine), Phase 4 (preview to visualize results)
**Requirements**: MOULD-02, MOULD-03, MOULD-04, MOULD-10, MOULD-11
**Success Criteria** (what must be TRUE):
  1. Inner mould is visibly larger than the proof model by the configured shrinkage percentage, and uses the correct formula (wet_size = fired_size / (1 - shrinkage_rate))
  2. Inner mould has uniform wall thickness (default 2.4mm) that the user can configure via a slider or input
  3. Slip well appears at the top of the inner mould in the selected size (None / Regular / Tall) and is seamlessly joined to the mould body
  4. Proof model accurately represents the final fired pot at correct shrunk dimensions
  5. All generated solids are watertight with correct outward-facing normals (ready for 3D printing slicers)
**Plans**: TBD

Plans:
- [ ] 05-01: Shrinkage scaling and wall thickness offset operations
- [ ] 05-02: Slip well generation, proof model, and manifold validation

### Phase 6: Outer Mould, Ring, and Assembly
**Goal**: The app generates the complete mould assembly -- outer containment wall split into halves or quarters, bottom ring in matching split configuration, and ridge/groove features on all mating surfaces for precise alignment.
**Depends on**: Phase 5 (inner mould geometry)
**Requirements**: MOULD-05, MOULD-06, MOULD-07, MOULD-08, MOULD-09, MOULD-12
**Success Criteria** (what must be TRUE):
  1. Outer mould wraps around the inner with a configurable plaster cavity gap (default 25mm) and splits cleanly into halves or quarters based on user selection
  2. Bottom ring connects inner to outer and splits to match the outer mould configuration (whole, half, or quarter)
  3. All mating surfaces have ridge/groove features that interlock, with configurable assembly clearance (default 0.3mm for FDM printers)
  4. Outer mould includes a pour hole at the bottom for plaster introduction
  5. User can adjust split count and clearance, and see the 3D preview update with the new configuration
**Plans**: TBD

Plans:
- [ ] 06-01: Outer mould generation with plaster cavity offset and splitting
- [ ] 06-02: Ring generation and ridge/groove assembly features
- [ ] 06-03: Pour hole, clearance configuration, and assembly validation

### Phase 7: File Export and Plaster Calculator
**Goal**: Users can download ready-to-print mould files and know exactly how much plaster and water to mix -- the complete handoff from digital design to physical mould making.
**Depends on**: Phase 6 (complete mould geometry)
**Requirements**: EXP-01, EXP-02, EXP-03, EXP-04, EXP-05, PLAST-01, PLAST-02, PLAST-03, PLAST-04, PLAST-05
**Success Criteria** (what must be TRUE):
  1. User can download a ZIP file containing all mould parts as binary STL files, with a readme that includes assembly instructions and plaster calculations
  2. User can choose between standard and high resolution for STL tessellation
  3. Plaster calculator displays cavity volume, dry plaster weight (USG No.1 ratio 100:70), water volume, and pot volume estimation in the UI
  4. Plaster calculations are also included in the ZIP readme for reference at the workbench
  5. STEP export option is visible but gated behind Pro subscription (grayed out for free users)
**Plans**: TBD

Plans:
- [ ] 07-01: STL export with configurable resolution and ZIP bundling
- [ ] 07-02: Plaster calculator (volume, weight, water calculations)
- [ ] 07-03: STEP export and readme generation

### Phase 8: Authentication and Freemium
**Goal**: Users can create accounts, access saved designs across devices, and the app enforces a freemium model where free users get watermarked STL while Pro users unlock STEP, custom shrinkage, and clean files.
**Depends on**: Phase 7 (export system to gate)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, UI-06
**Success Criteria** (what must be TRUE):
  1. User can create an account with email/password and sign in across devices
  2. User can sign out from any page
  3. Anonymous users can use the full editor and preview, but downloads produce watermarked STL with default settings only
  4. Pro users get clean (non-watermarked) STL, STEP export, custom shrinkage percentage, and custom wall thickness
  5. Email capture gate appears before first download (even for free tier) and designs persist indefinitely for authenticated users
**Plans**: TBD

Plans:
- [ ] 08-01: Supabase auth integration (sign up, sign in, sign out)
- [ ] 08-02: Freemium gating, email capture, and design persistence

### Phase 9: UI/UX Polish and Deployment
**Goal**: The app looks and feels like a Pottery Academy product -- branded, responsive, with clear feedback during loading and errors -- and is deployed and accessible at moulds.thepotteryacademy.com.
**Depends on**: Phase 8 (all functionality complete)
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, INFRA-04
**Success Criteria** (what must be TRUE):
  1. App uses Pottery Academy neo-brutalist design system (terra cotta, sage green, cream palette) consistently across all screens
  2. App is usable on desktop and tablet with responsive layout (mobile for browsing, desktop for full editing)
  3. Loading states are clear during WASM initialization and mould generation, with a progress indicator and helpful text
  4. Error states display actionable messages for invalid profiles, generation failures, and export issues -- users know what went wrong and what to do
  5. Designs can be shared via URL (profile + settings encoded in URL parameters) and the app is deployed on Vercel at moulds.thepotteryacademy.com
**Plans**: TBD

Plans:
- [ ] 09-01: Pottery Academy branding and responsive layout
- [ ] 09-02: Loading states, error handling, and URL sharing
- [ ] 09-03: Vercel deployment and domain configuration

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. WASM Foundation | 0/3 | Not started | - |
| 2. Profile Editor Core | 0/3 | Not started | - |
| 3. Profile Editor Extended | 0/2 | Not started | - |
| 4. Live 3D Preview | 0/3 | Not started | - |
| 5. Inner Mould Generation | 0/2 | Not started | - |
| 6. Outer Mould, Ring, and Assembly | 0/3 | Not started | - |
| 7. File Export and Plaster Calculator | 0/3 | Not started | - |
| 8. Authentication and Freemium | 0/2 | Not started | - |
| 9. UI/UX Polish and Deployment | 0/3 | Not started | - |

---
*Roadmap created: 2026-02-10*
*Last updated: 2026-02-10*
