# Pottery Mould Generator

## What This Is

A browser-based app that generates 3D-printable slip casting mould parts from 2D pot profiles. Users draw or upload a pot cross-section, see a live 3D preview, and download ready-to-print mould files (STL/STEP) with plaster calculations. Part of The Pottery Academy suite, aimed at individual potters and small studios who want to slip cast for production without the time and skill investment of traditional mould-making.

## Core Value

**Instant mould generation from a 2D profile** — a potter draws their pot shape, and the app generates all the 3D-printable parts needed to create a plaster slip casting mould, with zero CAD knowledge required.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] In-browser profile editor with parametric presets AND freehand editing
- [ ] SVG file upload as alternative to in-browser drawing
- [ ] 360-degree revolution of 2D profile into 3D form
- [ ] Inner mould generation (scaled for shrinkage, slip well attached)
- [ ] Outer mould generation with smart print-bed splitting (half/quad)
- [ ] Ring generation (whole/half/quad options)
- [ ] Proof model generation (preview of final fired pot)
- [ ] STL and STEP file export
- [ ] Live 3D preview that updates as user edits the profile
- [ ] Configurable clay shrinkage percentage
- [ ] Configurable wall thickness
- [ ] Configurable slip well size
- [ ] Ridge/groove assembly features on mould parts
- [ ] Plaster volume, weight, and water calculations
- [ ] Freemium gating (watermarked basic / clean pro files)
- [ ] Email capture for downloads
- [ ] Responsive design (mobile-friendly)
- [ ] Pottery Academy branding and design system

### Out of Scope

- Multi-part moulds (2-3 parts for undercuts) — v2, requires complex seam line logic and registration keys
- 3D printing service — not offering printing, only file generation
- Handle mould generation — v2+, separate two-part mould type
- Non-revolved forms — v2+, would require fundamentally different geometry pipeline
- Native mobile app — web PWA first

## Context

### Inspiration: ShapeCast Molds
ShapeCast (shapecastmolds.com) is the primary reference product. Published at CHI 2024/2025. ~500 users, ~3,700 SVGs uploaded, ~600 finalized designs in first year. Uses Inkscape + Python plugin + Blender for generation pipeline. Key limitations: requires external SVG tool, no live preview, basic UX, server-dependent generation.

### How Slip Casting Moulds Work
1. A 2D pot profile (half cross-section from foot to rim) is revolved 360 degrees
2. The **inner mould** forms the pot cavity — scaled up for clay shrinkage, with a slip well on top for pouring liquid clay
3. The **outer mould** (cottle board replacement) forms the outer containment — split into halves or quarters for removal from set plaster
4. The **ring** connects inner to outer at the bottom
5. Parts have ridges/grooves for precise assembly, secured with binder clips
6. Plaster is poured into the assembled 3D-printed mould
7. 3D prints are removed, leaving a plaster slip casting mould
8. Same 3D prints can make dozens of plaster moulds

### Multi-Part Mould Context (v2)
Forms where the rim is narrower than the body (e.g. tumbler, bulbous vase) cannot use a one-part mould — the cast piece can't be pulled out. These need the plaster mould split vertically (typically 2-3 parts) with registration keys for alignment. Each plaster half is poured separately. The 3D printed parts become significantly more complex. Architecture should not prevent this extension.

### Technical Context
- OpenCASCADE.js provides full CAD kernel in browser via WebAssembly (revolve, boolean, sweep, fillet, STEP/STL export)
- Three.js for interactive 3D visualization (already used across template generator suite)
- Architecture should allow fallback to server-side generation (Python/Blender) if OpenCASCADE.js proves insufficient for complex geometry
- ShapeCast's inner wall thickness: 2.4mm (thin enough to print fast, thick enough to be rigid)

### Existing Pottery Academy Suite
13+ apps already built with vanilla HTML/CSS/JS, Supabase, Vercel. Template generators (pot, bonsai, hexagon, multi-section, polygon box) use Three.js + jsPDF. Shared branding, design system, and legal templates. This app fits naturally alongside the template generators but generates 3D-printable moulds instead of 2D PDF templates.

## Constraints

- **Tech Stack**: Vanilla HTML/CSS/JS, CDN dependencies only (no build tools) — matching Pottery Academy suite
- **3D Engine**: OpenCASCADE.js (WASM) for CAD operations, Three.js for visualization — with architecture allowing server fallback
- **File Formats**: Must output both STL (for 3D printing) and STEP (for CAD editing) — STEP is a pro feature
- **Branding**: The Pottery Academy brand, neo-brutalist design system, deployed at moulds.thepotteryacademy.com
- **Backend**: Supabase (auth, user data, analytics) with STUB_MODE for local dev
- **Hosting**: Vercel (static files + optional serverless for future backend)
- **Geometry Accuracy**: Mould parts must fit together precisely — tolerances, ridges, grooves are critical
- **Future-Proof**: Architecture must not prevent multi-part mould support in v2

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| OpenCASCADE.js over server-side Blender | Zero server costs, instant feedback, works offline, matches static hosting model. Leave door open for server fallback. | — Pending |
| Parametric + freehand editor (both modes) | Parametric lowers barrier to entry, freehand gives full control. ShapeCast only supports external SVG. | — Pending |
| Freemium model | Matches ShapeCast's proven approach. Basic (watermarked STL, default shrinkage), Pro (STEP, custom shrinkage, clean files). | — Pending |
| One-part moulds for v1 | Proves the concept, matches ShapeCast's scope, multi-part is significantly more complex | — Pending |
| Pottery Academy branding | Natural fit with existing suite, cross-promotion with template generators | — Pending |

---
*Last updated: 2026-02-10 after initialization*
