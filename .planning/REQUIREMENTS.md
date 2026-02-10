# Requirements: Pottery Mould Generator

**Defined:** 2026-02-10
**Core Value:** Instant mould generation from a 2D profile -- a potter draws their pot shape, and the app generates all 3D-printable mould parts with zero CAD knowledge required.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Profile Editor

- [ ] **PROF-01**: User can draw a pot profile using bezier curves with draggable control points and handles
- [ ] **PROF-02**: User can edit existing profile by dragging points, handles, and adding/removing points
- [ ] **PROF-03**: User can start from parametric presets (cup, bowl, vase, tumbler) with named parameters (height, rim diameter, belly width, foot diameter)
- [ ] **PROF-04**: User can modify parametric presets via sliders/inputs and see profile update
- [ ] **PROF-05**: User can switch between parametric mode and freehand bezier mode
- [ ] **PROF-06**: User can upload an SVG file to import an existing profile
- [ ] **PROF-07**: User can overlay a reference image (photo of existing pot) and trace the profile over it
- [ ] **PROF-08**: User can undo/redo profile edits
- [ ] **PROF-09**: Profile editor enforces constraints: no undercuts (for one-part moulds), no self-intersections, profile must not cross revolution axis
- [ ] **PROF-10**: Profile editor shows snap-to-grid and measurement overlays
- [ ] **PROF-11**: User can set precise dimensions via direct input (e.g., "rim diameter: 8cm")

### Mould Generation

- [ ] **MOULD-01**: App revolves 2D profile 360 degrees around center axis to generate 3D pot form
- [ ] **MOULD-02**: App generates inner mould scaled up for configurable clay shrinkage (default 13%)
- [ ] **MOULD-03**: App applies configurable wall thickness to inner mould (default 2.4mm)
- [ ] **MOULD-04**: App attaches configurable slip well to inner mould top (None / Regular / Tall)
- [ ] **MOULD-05**: App generates outer mould as containment wall, offset outward from inner (default 25mm plaster cavity)
- [ ] **MOULD-06**: App splits outer mould into halves or quarters based on user's print bed size
- [ ] **MOULD-07**: App generates bottom ring connecting inner to outer (whole, half, or quarter options)
- [ ] **MOULD-08**: App adds ridge/groove assembly features on mating surfaces of all parts
- [ ] **MOULD-09**: App generates pour hole in outer mould bottom for plaster introduction
- [ ] **MOULD-10**: App generates proof model (preview of final fired pot at correct shrunk dimensions)
- [ ] **MOULD-11**: All generated parts have correct normals and are watertight for 3D printing
- [ ] **MOULD-12**: Assembly clearance is configurable (default 0.3mm for FDM printers)

### 3D Preview

- [ ] **PREV-01**: User sees live 3D preview that updates as they edit the profile
- [ ] **PREV-02**: User can rotate, zoom, and pan the 3D preview (orbit controls)
- [ ] **PREV-03**: User can toggle visibility of individual mould parts (inner, outer, ring, proof)
- [ ] **PREV-04**: User sees measurement annotations on 3D preview (height, rim diameter, belly diameter, foot diameter)
- [ ] **PREV-05**: Preview shows assembled mould view (all parts together) and exploded view
- [ ] **PREV-06**: App shows lightweight preview immediately while WASM loads, upgrades to full CAD preview when ready

### File Export

- [ ] **EXP-01**: User can download all mould parts as STL files bundled in a ZIP
- [ ] **EXP-02**: STL files use binary format for smaller file sizes
- [ ] **EXP-03**: User can download STEP files (Pro feature, gated behind subscription)
- [ ] **EXP-04**: ZIP includes a readme with assembly instructions and plaster calculations
- [ ] **EXP-05**: User can configure STL resolution (standard / high)

### Plaster Calculator

- [ ] **PLAST-01**: App calculates plaster cavity volume from mould geometry
- [ ] **PLAST-02**: App calculates dry plaster weight needed (USG No.1 Pottery Plaster ratio: 100:70 plaster:water)
- [ ] **PLAST-03**: App calculates water volume needed
- [ ] **PLAST-04**: App displays pot volume estimation (fired size)
- [ ] **PLAST-05**: Plaster calculations shown in UI and included in download readme

### Authentication & Freemium

- [ ] **AUTH-01**: User can create account with email and password (Supabase Auth)
- [ ] **AUTH-02**: User can sign in and access saved designs across devices
- [ ] **AUTH-03**: User can sign out
- [ ] **AUTH-04**: Anonymous users can use the app with watermarked STL output and default settings
- [ ] **AUTH-05**: Pro users get clean (non-watermarked) STL, STEP export, custom shrinkage, custom wall thickness
- [ ] **AUTH-06**: Email capture gate before first download (even for free tier)

### UI/UX

- [ ] **UI-01**: App follows Pottery Academy neo-brutalist brand (terra cotta, sage green, cream)
- [ ] **UI-02**: App is responsive on desktop and tablet (mobile for browsing, desktop for full editing)
- [ ] **UI-03**: Clear loading states during WASM initialization and mould generation
- [ ] **UI-04**: Error states with helpful messages (invalid profile, generation failure, export issues)
- [ ] **UI-05**: URL-based design sharing (encode profile + settings in URL parameters)
- [ ] **UI-06**: Designs persist for authenticated users (no 28-day expiration like ShapeCast)

### Infrastructure

- [ ] **INFRA-01**: OpenCASCADE.js WASM runs in Web Worker to avoid blocking UI
- [ ] **INFRA-02**: WASM memory management with explicit cleanup to prevent leaks
- [ ] **INFRA-03**: Debounced geometry regeneration (150-200ms) with latest-wins cancellation
- [ ] **INFRA-04**: App deploys as static files on Vercel (moulds.thepotteryacademy.com)
- [ ] **INFRA-05**: Profile data model includes extension points for v2 multi-part moulds (seamLines array)

## v2 Requirements

Deferred to future release. Architecture must not prevent these.

### Multi-Part Moulds
- **MULTI-01**: User can define seam lines for 2-3 part moulds
- **MULTI-02**: App generates registration keys for mould alignment
- **MULTI-03**: App generates separate pouring chambers for each mould part

### Logo Stamp
- **LOGO-01**: User can upload SVG logo to emboss into pot bottom
- **LOGO-02**: User can type text with font selection for bottom stamp
- **LOGO-03**: Logo boolean-subtracted from inner mould to create raised stamp on clay

### Handle Moulds
- **HANDLE-01**: User can design two-part handle mould from profile
- **HANDLE-02**: Handle mould parts with registration features

### Advanced Features
- **ADV-01**: Community design gallery (share and browse designs)
- **ADV-02**: Section view of assembled mould (clipping plane)
- **ADV-03**: Assembly animation showing how parts fit together
- **ADV-04**: Multiple plaster types (not just USG No.1)
- **ADV-05**: Stripe subscription billing for Pro tier

## Out of Scope

| Feature | Reason |
|---------|--------|
| Full 3D sculpting / freeform modelling | Enormously complex, competes with Blender poorly, potters think in 2D profiles |
| 3D printing service integration | Logistics nightmare, liability, fulfillment complexity |
| Clay body database / material science | Data maintenance burden, accuracy liability, different batches vary |
| Non-revolved forms (square planters) | Fundamentally different geometry pipeline, covers <10% of slip casting |
| Built-in slicer / G-code generation | Slicer choice is personal, reimplementing a slicer is absurd |
| Real-time collaboration | Massive complexity for minimal value in solo-potter workflow |
| AI-generated pot profiles | Gimmicky, unpredictable, moves away from intentional design |
| Native mobile app | Web-first with responsive design |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| (To be populated during roadmap creation) | | |

**Coverage:**
- v1 requirements: 51 total
- Mapped to phases: 0
- Unmapped: 51

---
*Requirements defined: 2026-02-10*
*Last updated: 2026-02-10 after initial definition*
