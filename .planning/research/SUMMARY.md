# Project Research Summary

**Project:** Pottery Mould Generator
**Domain:** Browser-based 3D slip casting mould generation tool
**Researched:** 2026-02-10
**Confidence:** MEDIUM (Core technical stack well-researched; OpenCASCADE.js CDN loading needs prototype validation; physical mould fitment needs testing)

## Executive Summary

This project is a browser-based CAD tool that generates 3D-printable slip casting moulds from pottery profiles. Users draw or upload a 2D pot profile (cross-section), and the app generates all necessary mould components: inner mould, outer mould halves, and bottom ring with assembly features. The recommended approach combines **replicad** (high-level OpenCASCADE.js wrapper) for B-rep CAD operations, **Three.js** for 3D visualization, and **Paper.js** for 2D profile editing—all delivered via CDN with no build tools, following the established Pottery Academy pattern.

The key technical risk is OpenCASCADE.js WASM loading without a bundler. The 20-40MB WASM module must load in a Web Worker to avoid blocking the UI, but CDN loading of WASM in workers may have CORS/MIME issues requiring self-hosted WASM files. This needs a spike before Phase 1. The key manufacturing risk is dimensional tolerance: 3D-printed mould parts must fit together within ±0.2-0.5mm precision, requiring configurable clearance parameters and physical validation testing.

ShapeCast is the only direct competitor—a research-project tool with ~500 users that requires external SVG tools (Inkscape). Our differentiators are a **built-in profile editor with live 3D preview** and **instant client-side generation** (no server round-trip). This addresses their two biggest UX gaps.

## Key Findings

### Recommended Stack

The stack leverages proven browser-native technologies with a focus on avoiding build tools to match existing Pottery Academy conventions.

**Core technologies:**
- **replicad 0.20.5**: Higher-level API over raw OpenCASCADE.js — provides `sketch().revolve()`, boolean operations, fillet, and STL/STEP export with dramatically simpler syntax than numbered C++ method overloads
- **replicad-opencascadejs 0.20.2**: Custom WASM build (~5-8MB gzipped) containing only the OCCT modules replicad needs, smaller than the full 13MB library
- **Three.js 0.172.0**: Industry-standard browser 3D for visualization with WebGPU support and WebGL2 fallback — consistent with other Pottery Academy apps (upgrading from 0.158.0)
- **Paper.js 0.12.18**: SVG-based 2D profile editor with cubic bezier curves and native path segment/handle editing — superior to Fabric.js for path manipulation
- **Supabase JS 2.x**: Already used across the suite for auth, analytics, and freemium gating

**Critical constraint:** No bundler. All libraries load via CDN (import maps + script tags). WASM files may need self-hosting if CDN MIME type issues arise during testing.

**Confidence note:** WASM loading via CDN without a bundler is MEDIUM confidence—documented as possible but needs hands-on validation. If CDN loading fails, fallback to raw `opencascade.js@1.1.1` (proven CDN-friendly but harder API) or self-host WASM only.

### Expected Features

ShapeCast defines table stakes. Our differentiators come from removing their friction points.

**Must have (table stakes):**
- 2D profile to 3D revolution (half-profile → full form)
- Inner mould generation (offset for wall thickness, scaled for shrinkage, slip well attached)
- Outer mould generation (offset for plaster cavity, split into halves, pour hole)
- Bottom ring with registration features (ridges/grooves for alignment)
- STL export (binary format, all mould parts bundled in ZIP)
- Clay shrinkage compensation (13% default, configurable)
- 3D preview with orbit controls
- SVG file upload (ShapeCast users have existing profiles)
- Plaster volume/weight calculation

**Should have (competitive advantage):**
- **Built-in profile editor** — THE key differentiator. ShapeCast requires Inkscape externally, creating massive friction.
- **Live 3D preview during editing** — ShapeCast has no live preview; you upload, then see result.
- **Parametric presets** — Start from cup/bowl/vase templates. Lowers barrier for non-designers.
- **STEP export** (Pro feature) — CAD-editable format for advanced users
- **Reference image overlay** — Trace existing pot photos
- **Measurement annotations** — Show dimensions on 3D preview
- **Print-bed-aware splitting** — Auto-split outer mould based on user's printer size
- **URL-based design sharing** — Matches existing Pottery Academy pattern

**Defer (v2+):**
- Multi-part moulds for undercut forms (requires seam line logic, registration keys, complex geometry)
- Handle moulds (separate geometry pipeline)
- Non-revolved forms (square planters, faceted forms)
- Community design gallery

### Architecture Approach

The architecture enforces a strict main-thread/worker boundary to keep the UI responsive during heavy CAD operations.

**Major components:**

1. **Profile Editor (main thread)** — Paper.js-based SVG canvas with bezier handles, snap-to-grid, and constraint enforcement. Emits `profile-changed` events to app state.

2. **Geometry Worker (Web Worker)** — Hosts all OpenCASCADE.js WASM and CAD operations. Receives profile points + parameters via postMessage, returns tessellated meshes as Transferable ArrayBuffers.

3. **3D Preview (main thread)** — Three.js scene that receives mesh buffers from worker, constructs BufferGeometry, and renders with orbit controls. Decoupled from OCCT—can show lightweight LatheGeometry preview immediately while WASM loads.

4. **Geometry Bridge** — Promise-based wrapper around worker postMessage/onmessage. Calling code uses `await geometryBridge.generateMould(profile, params)` instead of raw message passing.

5. **Mould Builder (inside worker)** — Orchestrates the CAD pipeline: profile converter (SVG points → OCCT Wire), geometry engine (revolve, offset, boolean), tessellator (Shape → vertex/normal buffers), and file exporter (STL/STEP).

**Critical pattern:** Debounced generation with abort. Profile edits happen at 60fps (dragging handles). Debounce OCCT regeneration to 150-200ms, but update the 2D SVG preview immediately. If a new request arrives before the previous completes, only apply the latest result.

**Extension points for v2:** Profile data model includes `seamLines: []` array (empty in v1). Multi-part mould generation checks `seamLines.length` and branches to different pipeline—no existing code changes needed.

### Critical Pitfalls

Top pitfalls from research with prevention strategies:

1. **OpenCASCADE.js memory leaks crash the browser** — Every OCCT object (`new oc.ClassName()`) lives in WASM linear memory. JavaScript GC does NOT trigger C++ destructors. Without explicit `.delete()` calls, memory accumulates until the tab crashes after 5-10 regeneration cycles. **Prevention:** Implement `withOC()` helper that tracks allocations and deletes in a `finally` block. This MUST be built into Phase 1 architecture—retrofitting is painful. Monitor WASM heap size during testing.

2. **Boolean operations fail on complex/thin geometry** — OCCT booleans (cut, fuse) silently produce garbage geometry or throw exceptions when FuzzyValue tolerance is too large for small features (2mm ridges with 0.1mm tolerance collapse them) or input shapes have self-intersections. **Prevention:** Set `FuzzyValue(0.001)` for 2mm features, validate input with `BRepCheck_Analyzer` BEFORE booleans, check `IsDone()` and `HasErrors()` after every operation. Phase 1 must establish robust error handling.

3. **Mould parts do not fit together** — 3D printers have ±0.2-0.5mm tolerance per axis. CAD geometry assumes perfect surfaces. Parts designed with zero clearance will fuse or not fit. **Prevention:** Build clearance as configurable parameter (default 0.3mm for FDM). Ridge width = groove width MINUS clearance on each side. Round entry edges (0.5mm chamfer). TEST WITH PHYSICAL PRINTS—this cannot be simulated. Phase 2 must include physical validation.

4. **Profile geometry produces invalid moulds** — Users create profiles with undercuts (pot cannot demold), self-intersections, or sections touching the revolution axis, producing impossible geometry. **Prevention:** Real-time validation during drawing. Walk profile bottom-to-top; flag if radius decreases (undercut). Highlight violations in red WHILE editing, not after generation. Phase 1 profile editor must enforce constraints.

5. **Clay shrinkage applied backwards** — Formula error: wet size ≠ fired size × 1.13. Correct: `wet_size = fired_size / (1 - shrinkage_rate)`. For 10cm finished with 13% shrinkage: 10 / 0.87 = 11.49cm, NOT 11.3cm. **Prevention:** Use the correct formula (already proven in `pottery-template-pot/js/app.js`). Add unit tests immediately in Phase 1.

## Implications for Roadmap

Based on combined research, the build order is constrained by dependencies and risk mitigation.

### Phase 1: Foundation — Profile Data + WASM Integration
**Rationale:** Must establish the core geometry engine and worker architecture before building features on top. This phase de-risks the highest technical uncertainty (WASM loading without bundler) and establishes memory management patterns.

**Delivers:**
- Profile data model with validation (no undercuts, self-intersections)
- OpenCASCADE.js WASM loading in Web Worker (spike to prove CDN or self-hosted approach)
- Geometry bridge with Promise-based API
- Basic revolution operation (profile → 3D solid)
- Tessellation to Three.js mesh buffers
- Memory cleanup pattern (`withOC()` helper) enforced from day one

**Addresses pitfalls:** #1 (memory leaks), #4 (invalid profiles), #5 (shrinkage formula), #6 (WASM load blocking UI)

**Stack elements:** replicad, replicad-opencascadejs, Web Worker architecture

**Architecture components:** Geometry Worker, Geometry Bridge, Profile Data Model

**Research flag:** NEEDS PROTOTYPE—WASM CDN loading is unverified. Allocate 1-2 days for spike before committing to full phase.

### Phase 2: Profile Editor + Live Preview
**Rationale:** After the geometry engine works, build the primary differentiator. Users can draw profiles and see live 3D previews. This validates the core value proposition before investing in mould-specific features.

**Delivers:**
- Paper.js-based 2D profile editor with bezier curve editing
- Interactive handles (drag points, control points)
- Real-time 3D preview (debounced OCCT generation, instant Three.js fallback)
- Parametric presets (cup, bowl, vase starting points)
- SVG file import with normalization (handle multiple editor formats)
- Basic constraint enforcement (snap-to-grid, minimum wall thickness)

**Addresses pitfalls:** #4 (profile validation), #7 (UI blocking during regen), #8 (SVG format chaos)

**Stack elements:** Paper.js, Three.js preview with OrbitControls

**Architecture components:** Profile Editor, 3D Preview, SVG Import/Export, Debounced Generation

**Research flag:** STANDARD PATTERNS—profile editing is well-documented. No additional research needed.

### Phase 3: Mould Generation — Inner, Outer, Ring
**Rationale:** With a working editor and preview, implement the core domain logic. This is where ShapeCast equivalence is achieved.

**Delivers:**
- Inner mould generation (shrinkage scaling, wall offset, slip well)
- Outer mould generation (plaster offset, split into halves, pour hole)
- Bottom ring with registration features (ridges/grooves for alignment)
- Assembly feature generation (boolean operations for interlocking)
- All mould parts visible in 3D preview (toggle visibility, exploded view)

**Addresses pitfalls:** #2 (boolean failures), #3 (part fitment), #9 (slip well sizing), #13 (outer splitting)

**Stack elements:** replicad boolean operations (cut, fuse), offset APIs

**Architecture components:** Mould Builder, Profile Converter

**Research flag:** NEEDS RESEARCH—Assembly features (ridge/groove dimensions, clearance values) need physical testing during this phase. Plan for test print iterations.

### Phase 4: File Export + Plaster Calculator
**Rationale:** Mould geometry is complete; now make it downloadable and usable.

**Delivers:**
- STL export (binary format, configurable tessellation quality)
- STEP export (Pro feature, gated)
- ZIP bundling (all mould parts + metadata)
- Plaster volume calculation (cavity volume, water/plaster weights)
- Download with email gate (Supabase integration)
- Freemium model enforcement (free tier: standard STL; Pro: STEP, custom shrinkage)

**Addresses pitfalls:** #10 (non-manifold STL), #11 (plaster calculation), #12 (tessellation quality)

**Stack elements:** StlAPI_Writer, STEPControl_Writer, FileSaver.js or native blob download

**Architecture components:** File Exporter, Plaster Calculator, Freemium Gating

**Research flag:** STANDARD PATTERNS—file export is straightforward. Plaster calculation needs formula validation but no deep research.

### Phase 5: Polish + Differentiation
**Rationale:** Core product is complete. Add the features that make this BETTER than ShapeCast.

**Delivers:**
- Measurement overlay on 3D preview (height, rim diameter, belly diameter)
- Reference image overlay (upload photo, trace profile)
- Print-bed-aware part splitting (based on user's printer dimensions)
- Section view of assembled mould (cross-section showing plaster cavity)
- URL-based design sharing (encode profile + params in URL)
- Undo/redo in profile editor
- More parametric presets (tumbler, mug, planter, teacup)
- Assembly guide (how to assemble, pour plaster, demould)

**Addresses pitfalls:** #14 (confusing UX for potters)

**Stack elements:** Supabase storage (optional, for design library), URL encoding

**Architecture components:** URL Sharing, UI enhancements

**Research flag:** STANDARD PATTERNS—polish features use established techniques.

### Phase Ordering Rationale

- **Phase 1 must come first:** WASM loading and memory management are architectural decisions that cannot be retrofitted. If this fails, the entire approach changes (fallback to server-side generation or different CAD kernel).

- **Phase 2 before Phase 3:** The profile editor validates the value proposition. If users cannot draw or import profiles easily, the rest is moot. Building mould generation first would be premature optimization.

- **Phase 3 is the longest:** Mould generation involves complex geometry (offsets, booleans, splitting) with the highest failure risk. Boolean operations are the most sensitive part of OCCT—allocate time for debugging edge cases.

- **Phase 4 depends on Phase 3:** Cannot export files until mould parts are generated. Plaster calculation needs the mould cavity volume from Phase 3.

- **Phase 5 is modular:** Polish features can be added in any order or deferred without breaking core functionality. Prioritize based on user feedback after Phase 4 launch.

**Grouping logic (from ARCHITECTURE.md):** Each phase corresponds to a major system component. Phase 1 = worker infrastructure, Phase 2 = main-thread UI, Phase 3 = worker geometry pipeline, Phase 4 = output systems, Phase 5 = enhancements.

### Research Flags

**Phases needing deeper research during planning:**

- **Phase 1:** WASM CDN loading needs a 4-8 hour spike to validate. If CDN loading fails, pivot to self-hosted WASM immediately. Memory management patterns need code examples from opencascade.js community.

- **Phase 3:** Assembly feature dimensions (ridge width, groove depth, clearance) need physical testing. Cannot determine optimal values from research alone. Budget for 3-5 test print iterations with different printers (PLA vs ABS, Prusa vs Ender).

**Phases with standard patterns (skip research-phase):**

- **Phase 2:** Profile editing with Paper.js is well-documented. SVG import/export has established libraries (DOMParser, path parsing). No additional research needed.

- **Phase 4:** STL/STEP export via OCCT is straightforward. Plaster calculation is simple geometry (volume computation). No research needed.

- **Phase 5:** All enhancement features use proven patterns from existing Pottery Academy apps or standard web APIs.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Core libraries well-documented (replicad, Three.js, Paper.js). WASM CDN loading is the unknown—needs prototype. If it fails, fallbacks exist (self-hosted WASM or raw opencascade.js@1.1.1). |
| Features | HIGH | ShapeCast defines table stakes clearly via CHI papers and website. Differentiators (built-in editor, live preview) validated by ShapeCast user complaints. Parametric presets are standard CAD UX. |
| Architecture | MEDIUM | Web Worker pattern for WASM is proven. Geometry pipeline (revolve, offset, boolean) maps directly to OCCT operations. Main uncertainty is FuzzyValue tuning and boolean operation reliability—needs hands-on testing. |
| Pitfalls | HIGH | Memory leaks, boolean failures, and tolerance issues are well-documented in opencascade.js GitHub. 3D printing tolerance data verified across multiple sources. Shrinkage formula confirmed in existing codebase. |

**Overall confidence:** MEDIUM

The core approach (replicad in worker, Paper.js editor, Three.js preview) is sound and well-researched. The two major uncertainties are:

1. **WASM loading without bundler** — Documented as possible but not common. Needs a spike in Phase 1. If it fails, self-hosting WASM files is the proven fallback.

2. **Physical mould fitment** — Clearance values (0.3mm default) are based on 3D printing guidelines, but actual fitment depends on printer type, material, and settings. MUST be validated with physical test prints in Phase 3. Cannot be simulated.

### Gaps to Address

**During Phase 1 planning:**
- Exact replicad API for WASM initialization in Web Worker (worker.postMessage vs dynamic import vs importScripts)
- Whether to use full opencascade.js build (~40MB) or create custom build (~7MB) for Phase 1 vs optimize later
- Specific OCCT method signatures for revolution, offset, and boolean operations (numbered overloads like `BRepPrimAPI_MakeRevol_1` need verification)

**During Phase 3 planning:**
- Optimal FuzzyValue for 2mm ridges/grooves (research suggests 0.001mm but needs validation)
- Ridge/groove fillet radii (0.5mm entry chamfer mentioned but needs physical testing)
- Slip well height calculation (ShapeCast uses "predetermined" but doesn't specify the formula—may need to reverse-engineer or create our own based on pot volume)

**During implementation (all phases):**
- Continuous memory profiling to catch leaks early (Chrome DevTools memory snapshots after each regeneration cycle)
- STL manifold validation on every export (automated check with PrusaSlicer CLI if possible)
- Cross-printer testing for clearance calibration (need access to FDM and SLA printers)

## Sources

### Primary (HIGH confidence)
- [OpenCASCADE.js official site](https://ocjs.org/) — WASM loading, custom builds, file size data
- [replicad documentation](https://replicad.xyz/docs/intro/) — API reference, sketch/revolve/fillet usage
- [ShapeCast CHI 2024 Paper](https://inovo.studio/pubs/shapecast-chi24.pdf) — Technical parameters (2.4mm wall, 25mm plaster offset, M3 bolts), user study data (500 users, 3700 SVGs)
- [ShapeCast website](https://shapecastmolds.com/) — Feature descriptions, workflow, pricing model
- [OpenCASCADE Modeling Algorithms](https://dev.opencascade.org/doc/overview/html/occt_user_guides__modeling_algos.html) — Revolution, boolean, fillet APIs
- [Three.js releases](https://github.com/mrdoob/three.js/releases) — Version history, WebGPU support in r171+
- [Paper.js features](http://paperjs.org/features/) — Path editing, bezier curves, SVG import/export
- Existing Pottery Academy codebase (`pottery-template-pot`) — Verified patterns for state management, Supabase integration, URL sharing

### Secondary (MEDIUM confidence)
- [opencascade.js GitHub discussions](https://github.com/donalffons/opencascade.js/discussions/186) — Memory leak warnings from maintainer
- [opencascade.js discussion #143](https://github.com/donalffons/opencascade.js/discussions/143) — FuzzyValue issues in boolean operations
- [Formlabs 3D Printing Tolerances](https://formlabs.com/blog/understanding-accuracy-precision-tolerance-in-3d-printing/) — ±0.2-0.5mm FDM tolerance data
- [Sculpteo 3D Printing Tolerances](https://www.sculpteo.com/en/3d-learning-hub/design-guidelines/3d-printing-tolerances/) — Clearance recommendations
- [DigitalFire Coffee Mug Project](https://digitalfire.com/project/60) — Slip casting workflow with 3D printing
- [Glazy Plaster Calculator](https://plaster.glazy.org/) — Plaster ratio reference (100:70 plaster:water)
- [Ceramic Arts Network slip casting guide](https://ceramicartsnetwork.org/daily/article/10-slip-casting-problems-and-how-to-solve-them) — Undercut physics, demolding constraints

### Tertiary (LOW confidence, needs validation)
- npm package versions for replicad, opencascade.js (verified as published but CDN loading behavior unverified)
- Custom WASM build size estimates (7.1MB combined JS+WASM from official docs, but not tested for this specific module subset)
- Slip well sizing heuristics (ShapeCast uses "predetermined" but exact formula not documented—may need user testing to determine optimal defaults)

---
*Research completed: 2026-02-10*
*Ready for roadmap: Yes*
