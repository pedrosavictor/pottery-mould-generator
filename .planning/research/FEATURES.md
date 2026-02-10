# Feature Research: Slip Casting Mould Generator

**Domain:** Browser-based slip casting mould generation tool
**Researched:** 2026-02-10
**Confidence:** MEDIUM (ShapeCast features verified via multiple sources; some details like exact pricing could not be confirmed without direct site access)

## Competitor Analysis: ShapeCast (Primary Reference)

ShapeCast (shapecastmolds.com) is the only dedicated slip casting mould generator tool. Published at CHI 2024 and CHI 2025. Approximately 500 registered users, 3,700 SVG uploads, and 600 finalized designs in its first year (as of March 2024 survey data from CHI paper).

### ShapeCast Feature Set (Verified)

**Profile Input:**
- SVG file upload only (single-path SVG, center of foot to rim)
- No built-in profile editor -- users must use Inkscape or another vector tool externally
- Provides example SVG files as starting points
- Designs stored on server, removed after 28 days

**Mould Types:**
- One-part vessel moulds (revolved forms) -- cups, bowls
- Handle moulds (two-part, one for each half)
- No multi-part moulds for undercut forms

**Mould Components Generated:**
- Inner mould: offset inward by 2.4mm wall thickness, scaled for shrinkage, slip well attached
- Outer mould: offset 25mm outward to create plaster cavity, split into parts
- Bottom ring: anchored by key points on inner and outer mould for registration
- Pour hole: created in bottom of outer mould for plaster introduction
- Flanges: ridges and grooves for alignment, with M3 bolt holes and threaded insert provisions
- Binder clip assembly mechanism

**Configuration Options:**
- Clay shrinkage: 13% default, custom % in Pro mode
- Wall thickness: 2.4mm default, custom in Pro mode
- Slip well: None / Regular / Tall options
- Outer mould: option to use their container instead of generated outer
- File format: STL (default), STL High (higher resolution), STEP (CAD-compatible), Both

**Output:**
- ZIP download containing all mould part files
- SVG profile file included
- Design proof model (printable preview of final fired pot)
- Volume estimation for the pot
- Plaster and water calculations included

**Visualization:**
- 3D preview with drag-to-rotate
- No live preview during editing (SVG must be uploaded, then processed server-side)

**Pricing Model:**
- Free tier: design with default settings (13% shrinkage, default wall thickness, standard STL)
- Pro mode: per-design purchase (exact pricing not confirmed -- requires direct site visit)
- Pro unlocks: custom shrinkage, custom wall thickness, STEP format, slip well options

**ShapeCast Limitations (Our Opportunities):**
- No built-in profile editor (requires external SVG tool like Inkscape)
- No live 3D preview during profile editing
- Server-dependent generation (not instant)
- 28-day design expiration
- No parametric presets for common forms
- Basic web UX (research-project origin, not product-focused)
- No undo/redo in profile editing (because there is no profile editing)
- No reference image overlay capability
- No measurement annotations on preview
- No print-bed-aware splitting (user must handle in slicer)

### Other Tools in the Ecosystem

**PotterDraw** (Desktop app, free)
- Spline-based profile drawing with automatic inner wall
- 3D revolution preview with mesh control (sides, rings)
- Export: PLY (color), STL (monochrome), OBJ
- Effects: bend, ripple, helix, scallop, twist
- Texture mapping with color palettes
- NOT a mould generator -- generates the pot model, not mould parts
- Windows desktop only, not web-based

**Fusion 360 / SolidWorks / Blender** (General CAD)
- Full CAD capability but requires significant skill
- Some potters use these to design moulds manually
- DigitalFire documents workflows using Fusion 360 for slip casting moulds
- High barrier to entry for ceramic artists

**Etsy / Thingiverse** (Pre-made files)
- Fixed-size STL files for specific mug/cup/bowl designs
- No customization
- Typically $5-$15 per design on Etsy
- Growing marketplace (10,000+ "pottery slip casting mold" models on aggregators)

**Glazy Plaster Calculator** (Web app, free, open source)
- Volume calculator for common shapes (cylinder, cone, etc.)
- Plaster-to-water ratio calculation
- Multiple plaster types supported
- Does NOT generate mould geometry -- calculation only
- Open source on GitHub (Vue.js)

**PhotoPottery** (Web calculator)
- Plaster mould volume calculator
- Water-to-plaster ratio calculator
- Simple form-based input, no 3D

**OpenSCAD Parametric Mould Generator** (Script-based)
- Two-part mould generator for OpenSCAD
- Parametric but requires coding knowledge
- Community-contributed, not maintained as a product

## Feature Landscape

### Table Stakes (Users Expect These)

Features users will assume exist. Missing these means the product feels broken or incomplete compared to ShapeCast.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **2D profile to 3D revolution** | Core product concept. ShapeCast does this. | MEDIUM | Revolve half-profile around center axis to generate full form |
| **Inner mould generation** | The primary deliverable. Cavity that forms the pot interior. | HIGH | Must offset for wall thickness, scale for shrinkage, attach slip well |
| **Outer mould generation** | Contains the plaster during pour. Replaces cottle boards. | HIGH | Must offset outward (25mm typical), split into printable parts |
| **Bottom ring generation** | Completes the mould assembly at base. | MEDIUM | Registration features to align with inner and outer |
| **Clay shrinkage compensation** | Without this, fired pots are wrong size. 13% default is standard. | LOW | Simple scale factor applied to inner mould dimensions |
| **STL file export** | Universal 3D printing format. Every slicer reads STL. | MEDIUM | Needs OpenCASCADE.js mesh tessellation |
| **Slip well on inner mould** | Where you pour the liquid clay. Essential for slip casting workflow. | MEDIUM | Attached to top of inner mould. None/Regular/Tall options |
| **Assembly features (ridges/grooves)** | Parts must align precisely or plaster leaks. ShapeCast uses flanges with ridges. | HIGH | Ridge/groove interlocking on mating surfaces |
| **3D preview** | Users need to see what they are generating before downloading. | MEDIUM | Three.js visualization, drag to rotate |
| **SVG file upload** | Existing ShapeCast users have SVG profiles. Must support import. | LOW | Parse single-path SVG, extract profile coordinates |
| **Configurable wall thickness** | Different printers and use cases need different thicknesses. 2.4mm default. | LOW | Parameter applied during inner mould offset |
| **Proof model / fired pot preview** | Users want to see the final pot, not just mould parts. | LOW | Simple revolved solid at fired dimensions |
| **Download as ZIP** | Multiple files per design (inner, outer, ring, proof). Must be bundled. | LOW | JSZip or similar client-side ZIP generation |
| **Pour hole in outer mould** | Plaster needs to get into the cavity. | LOW | Boolean subtraction from outer mould bottom |

### Differentiators (Competitive Advantage Over ShapeCast)

Features ShapeCast lacks that would make our tool clearly better.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Built-in profile editor** | ShapeCast requires external SVG tool (Inkscape). An in-browser editor removes this friction entirely. This is THE key differentiator. | HIGH | Bezier curve editor with control points, drag handles. Both freehand and parametric modes. |
| **Live 3D preview during editing** | ShapeCast has no live preview -- you upload SVG, then see result. Real-time preview as you drag profile points is transformative for design iteration. | HIGH | Requires efficient geometry pipeline: profile change -> revolution -> preview update in <100ms |
| **Parametric presets** | Start from a cup, bowl, vase, or tumbler shape and modify. Dramatically lowers barrier to entry for users who cannot draw profiles from scratch. | MEDIUM | Library of common pot profiles with named parameters (rim diameter, belly width, foot width, height) |
| **STEP file export** | CAD-editable format for advanced users. ShapeCast has this as Pro feature. | MEDIUM | OpenCASCADE.js native STEP export capability |
| **Reference image overlay** | Load a photo of an existing pot, trace the profile over it. Potters often want to reproduce a form they have seen or made. | MEDIUM | Image upload, opacity slider, scale/position controls in editor |
| **Measurement overlay on preview** | Show dimensions directly on the 3D model (height, rim diameter, belly diameter, foot diameter). ShapeCast shows no measurements on preview. | MEDIUM | Three.js annotation lines and labels |
| **Print-bed-aware part splitting** | Automatically split outer mould into halves or quarters based on user's print bed size. ShapeCast tells users to cut in slicer. | HIGH | Must calculate if parts exceed bed dimensions, generate clean split with registration |
| **Plaster calculation with detail** | Volume of plaster cavity, weight of dry plaster, weight of water, specific to USG No.1 Pottery Plaster ratio (100:70 plaster:water). ShapeCast includes basic calculations; we can do better with step-by-step mixing instructions. | LOW | Geometry volume calculation from mould cavity, apply plaster ratio formulas |
| **Undo/redo in profile editor** | Essential for any drawing tool. ShapeCast has no editor at all. | LOW | Command pattern on profile edit operations |
| **Snap-to-grid / dimension constraints** | Precise control: "I want this pot to be exactly 10cm tall, 8cm at rim." | LOW | Grid overlay, snap behavior, direct dimension input alongside visual editing |
| **URL-based design sharing** | Share a design via link (encode profile + settings in URL). Matches existing Pottery Academy pattern. | LOW | Already proven pattern in pottery-template-pot app |
| **No design expiration** | ShapeCast deletes designs after 28 days. Permanent saves (for authenticated users) or URL-based persistence are better. | LOW | Supabase storage for authenticated users, URL params for anonymous |
| **Instant client-side generation** | No server round-trip. OpenCASCADE.js generates in-browser. Faster iteration, works offline, no server costs. | HIGH | Depends on OpenCASCADE.js WASM performance for boolean operations |
| **Section view of assembled mould** | Show cross-section of assembled mould so users understand how inner/outer/ring fit together and where plaster goes. | MEDIUM | Three.js clipping plane or pre-computed section geometry |
| **Multiple slip well sizes with preview** | None / Regular / Tall with visual indication of each. ShapeCast offers this but without preview comparison. | LOW | Parametric slip well height, shown in live preview |
| **Mobile-friendly responsive design** | Potters often browse on phones. Full responsive layout for design exploration (download still on desktop for 3D printing). | MEDIUM | Touch-friendly profile editor is hard; preview and config are straightforward |

### Anti-Features (Deliberately NOT Build)

Features that seem appealing but create problems, scope creep, or user confusion.

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| **Full 3D sculpting / freeform modelling** | "Let me shape the pot in 3D directly" | Enormously complex, competes with Blender/Fusion360 poorly, ceramic artists think in 2D profiles not 3D meshes | Offer excellent 2D profile editor with live 3D preview. The 2D-to-3D workflow IS the value proposition. |
| **Multi-part moulds in v1** | "I need a 2-part mould for my tumbler" | Complex seam line logic, registration key generation, dramatically more geometry computation. Must be v2. | Ship one-part moulds first, validate product-market fit, then add multi-part. Architecture must not prevent it. |
| **3D printing service integration** | "Let me order a print directly" | Logistics nightmare, liability for print quality, fulfillment complexity, margin erosion | Provide optimized files with recommended print settings. Link to trusted print services if desired. |
| **Clay body database / material science** | "Include shrinkage data for every clay body" | Data maintenance burden, accuracy liability, different batches of same clay shrink differently | Let users input their own shrinkage %. Link to external resources (Glazy, DigitalFire). Provide common ranges as guidance. |
| **Handle mould generation in v1** | "I need handle moulds too" | Two-part mould for handles requires different geometry pipeline than revolved vessels. Separate feature track. | Defer to v2. ShapeCast has handles, but vessel moulds are the primary use case. |
| **Non-revolved forms in v1** | "I want to make a square planter" | Requires fundamentally different geometry pipeline. Revolved forms cover 90% of slip casting use cases. | v2+ consideration. Square/rectangular forms are rare in slip casting. |
| **Built-in slicer / G-code generation** | "Generate print-ready G-code" | Slicer choice is personal, depends on printer. Reimplementing a slicer is absurd. | Export clean STL/STEP files. Provide recommended slicer settings in documentation. |
| **Real-time collaboration** | "Design with my studio partner" | Massive engineering complexity for minimal value in a solo-potter workflow | URL sharing for async collaboration is sufficient |
| **AI-generated pot profiles** | "Generate a pot shape for me" | Gimmicky, unpredictable results, moves away from craftsperson's intentional design. Training data concerns. | Good parametric presets cover the "I don't know what to draw" case |
| **Animation / turntable video export** | "Export a spinning video of my pot" | Scope creep, tangential to core mould generation value | Interactive 3D preview in browser is sufficient. Users can screen-record if needed. |

## Feature Dependencies

```
[2D Profile Editor]
    |
    |---> [SVG Import] (alternative input path, no dependency)
    |
    v
[Profile to 3D Revolution]
    |
    |---> [Live 3D Preview] (requires revolution geometry)
    |---> [Fired Pot Proof Model] (simple revolution at fired size)
    |
    v
[Mould Generation Engine]
    |
    |---> [Inner Mould] (requires revolution + shrinkage + wall thickness + slip well)
    |---> [Outer Mould] (requires inner mould boundary + offset + pour hole)
    |---> [Bottom Ring] (requires inner + outer boundaries)
    |---> [Assembly Features] (ridges/grooves on all mating surfaces)
    |
    v
[File Export]
    |
    |---> [STL Export] (mesh tessellation from CAD geometry)
    |---> [STEP Export] (native CAD format, Pro feature)
    |---> [ZIP Bundle] (packages all files + metadata)
    |
    v
[Plaster Calculator]
    (requires mould cavity volume from generation engine)

[Measurement Overlay] --enhances--> [Live 3D Preview]
[Section View] --enhances--> [Live 3D Preview]
[Reference Image] --enhances--> [2D Profile Editor]
[Snap-to-Grid] --enhances--> [2D Profile Editor]
[Undo/Redo] --enhances--> [2D Profile Editor]
[Parametric Presets] --enhances--> [2D Profile Editor]
[Print Bed Splitting] --enhances--> [Outer Mould Generation]
[URL Sharing] --independent-- (encodes profile + settings, no dependency)
```

### Dependency Notes

- **Inner Mould requires Profile Revolution:** Cannot generate mould without the revolved form
- **Outer Mould requires Inner Mould:** The outer is defined relative to the inner's boundary
- **Ring requires both Inner and Outer:** Connects the two at the base
- **Assembly Features are integral:** Ridges/grooves must be added during mould generation, not as a post-step
- **STEP export requires OpenCASCADE.js:** STL can theoretically be generated from mesh data, but STEP needs the CAD kernel
- **Print Bed Splitting enhances Outer Mould:** Only the outer mould (and potentially ring) needs splitting; inner mould is always one piece
- **Plaster Calculator depends on Mould Volume:** Must calculate the cavity volume between inner, outer, and ring to estimate plaster needed
- **Live Preview conflicts with nothing:** Can work in parallel with any other feature

## MVP Definition

### Launch With (v1.0)

Minimum viable product -- what's needed to validate the concept and be useful.

- [ ] **2D Profile Editor (basic)** -- Bezier curve editor with at least 8 control points, drag to adjust, reasonable defaults
- [ ] **SVG file upload** -- Import existing ShapeCast SVG profiles (critical for user migration)
- [ ] **Profile to 3D revolution** -- Half-profile revolved to full form
- [ ] **Live 3D preview** -- Updates as user edits profile, drag to rotate/zoom
- [ ] **Inner mould generation** -- Offset, shrinkage scaling, slip well (Regular default)
- [ ] **Outer mould generation** -- Offset, split into halves, pour hole
- [ ] **Bottom ring generation** -- With registration to inner/outer
- [ ] **Assembly features (ridges/grooves)** -- On all mating surfaces
- [ ] **STL export** -- Standard quality, all parts
- [ ] **ZIP download** -- Bundle all files
- [ ] **Clay shrinkage setting** -- Numeric input, 13% default
- [ ] **Wall thickness setting** -- Numeric input, 2.4mm default
- [ ] **Fired pot proof model** -- Preview of final pot at fired size
- [ ] **Plaster calculation** -- Volume, dry plaster weight, water weight for USG No.1 Pottery Plaster
- [ ] **2-3 parametric presets** -- Cup, bowl, small vase as starting points
- [ ] **Email gate for download** -- Matches Pottery Academy pattern
- [ ] **Responsive layout** -- At least viewable on mobile (editor may be desktop-optimized)

### Add After Validation (v1.x)

Features to add once core is working and users are engaged.

- [ ] **STEP export (Pro)** -- Gated behind subscription/purchase
- [ ] **Custom shrinkage (Pro)** -- Free tier locked to 13%
- [ ] **Slip well options** -- None / Regular / Tall selector
- [ ] **Print bed size configuration** -- Auto-split outer mould for user's printer
- [ ] **Reference image overlay** -- Upload photo, trace profile over it
- [ ] **Measurement overlay** -- Dimensions shown on 3D preview
- [ ] **More presets** -- Tumbler, mug, planter, teacup profiles
- [ ] **URL sharing** -- Encode design in URL for sharing
- [ ] **Undo/redo** -- In profile editor
- [ ] **Snap-to-grid** -- In profile editor
- [ ] **Section view** -- Cross-section of assembled mould
- [ ] **User design library** -- Save designs to account (Supabase)
- [ ] **Watermark removal (Pro)** -- Free files have subtle branding, Pro files are clean

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] **Multi-part moulds** -- 2-3 part moulds for undercut forms (tumblers, bulbous vases). Requires seam line logic, registration keys, complex geometry. THE major v2 feature.
- [ ] **Handle moulds** -- Two-part mould for handles. Separate geometry pipeline from vessels.
- [ ] **Non-revolved forms** -- Square planters, faceted forms. Fundamentally different approach.
- [ ] **Exploded view / assembly animation** -- Show how mould parts fit together with animated assembly
- [ ] **Community gallery** -- Browse and remix other users' designs
- [ ] **Print settings recommendations** -- Layer height, infill, material suggestions per part type
- [ ] **Direct integration with Glazy/DigitalFire** -- Pull shrinkage data by clay body name
- [ ] **Multiple plaster type support** -- Different ratios for different plaster brands

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| 2D Profile Editor (basic) | HIGH | HIGH | P1 |
| Profile to 3D Revolution | HIGH | MEDIUM | P1 |
| Live 3D Preview | HIGH | MEDIUM | P1 |
| Inner Mould Generation | HIGH | HIGH | P1 |
| Outer Mould Generation | HIGH | HIGH | P1 |
| Bottom Ring Generation | HIGH | MEDIUM | P1 |
| Assembly Features (ridges/grooves) | HIGH | HIGH | P1 |
| STL Export | HIGH | MEDIUM | P1 |
| ZIP Download | MEDIUM | LOW | P1 |
| Clay Shrinkage Setting | HIGH | LOW | P1 |
| Wall Thickness Setting | MEDIUM | LOW | P1 |
| SVG Upload | HIGH | LOW | P1 |
| Fired Pot Proof Model | MEDIUM | LOW | P1 |
| Plaster Calculation | MEDIUM | LOW | P1 |
| Parametric Presets | HIGH | MEDIUM | P1 |
| Email Gate | MEDIUM | LOW | P1 |
| STEP Export (Pro) | MEDIUM | MEDIUM | P2 |
| Slip Well Options | MEDIUM | LOW | P2 |
| Print Bed Splitting | MEDIUM | HIGH | P2 |
| Reference Image Overlay | MEDIUM | MEDIUM | P2 |
| Measurement Overlay | MEDIUM | MEDIUM | P2 |
| Undo/Redo | MEDIUM | LOW | P2 |
| Snap-to-Grid | LOW | LOW | P2 |
| URL Sharing | MEDIUM | LOW | P2 |
| Section View | LOW | MEDIUM | P2 |
| User Design Library | MEDIUM | MEDIUM | P2 |
| Watermark (Pro gating) | LOW | LOW | P2 |
| Multi-Part Moulds | HIGH | HIGH | P3 |
| Handle Moulds | MEDIUM | HIGH | P3 |
| Non-Revolved Forms | LOW | HIGH | P3 |
| Exploded View Animation | LOW | MEDIUM | P3 |
| Community Gallery | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for launch (v1.0)
- P2: Should have, add after validation (v1.x)
- P3: Future consideration (v2+)

## Competitor Feature Comparison

| Feature | ShapeCast | PotterDraw | Fusion 360 | Our Tool (Planned) |
|---------|-----------|------------|------------|---------------------|
| Built-in profile editor | NO (external SVG) | YES (spline) | YES (sketch) | YES (bezier + parametric) |
| Live 3D preview | Partial (after upload) | YES | YES | YES (real-time) |
| Mould generation | YES (automated) | NO | Manual only | YES (automated) |
| Inner mould | YES | N/A | Manual | YES |
| Outer mould | YES | N/A | Manual | YES |
| Ring/base | YES | N/A | Manual | YES |
| Assembly features | YES (ridges, M3 bolts) | N/A | Manual | YES (ridges/grooves) |
| Shrinkage compensation | YES (13% default, custom Pro) | NO | Manual | YES (configurable) |
| STL export | YES | YES | YES | YES |
| STEP export | YES (Pro) | NO | YES | YES (Pro) |
| Plaster calculation | YES (basic) | NO | NO | YES (detailed) |
| Slip well options | YES (None/Regular/Tall) | N/A | Manual | YES |
| Print bed splitting | NO | N/A | Manual | YES (planned) |
| Parametric presets | NO | NO | NO | YES |
| Reference image trace | NO | NO | YES | YES (planned) |
| Measurement overlay | NO | NO | YES | YES (planned) |
| Handle moulds | YES | NO | Manual | v2 |
| Multi-part moulds | NO | NO | Manual | v2 |
| Browser-based | YES | NO (Windows) | NO (desktop) | YES |
| Pricing | Per-design purchase | Free | Subscription ($$$) | Freemium |
| Design persistence | 28 days | Local files | Cloud/local | Permanent (URL + account) |

## Domain-Specific Feature Details

### Plaster Calculation Specifics

For USG No. 1 Pottery Plaster (the standard for slip casting):
- **Ratio:** 100 parts plaster to 70 parts water (by weight)
- **Alternative expression:** 1 part water to 1.375 parts plaster
- **Practical rule:** 10 lbs plaster needs 7 lbs water
- **Volume estimation:** 1 quart water (2 lbs) + 2.85 lbs plaster = ~80 cubic inches mixed plaster
- **Effect of ratio:** More water = more porous but more brittle mould; less water = denser, harder mould that absorbs water poorly
- **Our calculation should provide:** Cavity volume (from 3D geometry), dry plaster weight, water weight, with option to adjust for different plaster types

### Mould Assembly Specifics

ShapeCast's approach (verified from CHI paper and website):
- Inner wall thickness: 2.4mm (fast to print, rigid enough, plaster-tight)
- Outer mould offset: 25mm from inner (creates plaster cavity)
- Bottom of inner and outer have M3 bolt holes + threaded insert provisions
- Flanges on outer mould parts have M3 bolt holes for connection
- Ridges and grooves on flanges for alignment
- Binder clips used for assembly
- Pour hole in bottom of outer mould

**Our approach should match or improve:**
- Keep 2.4mm inner wall as sensible default, make configurable
- 25mm outer offset as default (standard plaster mould thickness), make configurable
- Ridge/groove interlocking is simpler than M3 bolt approach (no threaded inserts needed)
- Binder clip compatibility should be maintained
- Consider snap-fit features as alternative to bolts

### Profile Editor Specifics

What controls the editor needs (informed by PotterDraw, general bezier editors, and ShapeCast's SVG requirements):
- Half-profile only (center of foot to rim, right side)
- Center axis is implicit (y-axis)
- Profile must be a single continuous path
- Must not have undercuts (for one-part moulds) -- validate and warn
- Cubic bezier curves for smooth organic forms
- Control points: minimum 6-8 for a simple pot, up to 20+ for complex forms
- Direct dimension input: "rim = 10cm" constrains the top point
- Visual grid with cm/inch markings
- The foot (bottom) is a special point -- typically flat, defines the base

## Sources

### Primary Sources (HIGH confidence)
- [ShapeCast Website](https://shapecastmolds.com/) -- Feature descriptions, workflow, output formats
- [ShapeCast CHI 2024 Paper](https://dl.acm.org/doi/10.1145/3613905.3651020) -- Technical details, user study data (166 users, 1,543 SVGs, 290 designs)
- [ShapeCast CHI 2025 Paper](https://dl.acm.org/doi/10.1145/3706598.3713866) -- "Crafting the Curve" follow-up
- [ShapeCast CHI 2024 PDF](https://inovo.studio/pubs/shapecast-chi24.pdf) -- Full paper with technical parameters (2.4mm wall, 25mm offset, M3 bolts)

### Secondary Sources (MEDIUM confidence)
- [DigitalFire Coffee Mug Project](https://digitalfire.com/project/60) -- Real-world slip casting mould workflow with 3D printing
- [PotterDraw on SourceForge](https://potterdraw.sourceforge.io/) -- Pottery design software features
- [Glazy Plaster Calculator](https://plaster.glazy.org/) -- Open-source plaster calculation tool
- [OpenCASCADE.js](https://ocjs.org/) -- Browser CAD kernel capabilities
- [Ceramic Arts Daily Community](https://community.ceramicartsdaily.org/) -- Plaster ratios, slip casting problems

### Supporting Sources (LOW confidence -- community/single source)
- [PhotoPottery Calculator](https://photopottery.com/plaster_mold_volume_calculator.php) -- Volume calculator reference
- [Etsy slip casting mould listings](https://www.etsy.com/market/3d_print_files_slip_casting) -- Market pricing reference
- [Instructables slip casting guides](https://www.instructables.com/Slip-Casting-3D-Printed-Vessels/) -- Workflow reference

---
*Feature research for: Slip Casting Mould Generator*
*Researched: 2026-02-10*
