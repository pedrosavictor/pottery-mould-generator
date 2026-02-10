# Stack Research: Pottery Mould Generator

**Domain:** Browser-based 3D CAD application (slip casting mould generation from 2D profiles)
**Researched:** 2026-02-10
**Confidence:** MEDIUM (core stack is well-established; OpenCASCADE.js versioning situation is messy but workable)

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **replicad** | 0.20.5 | CAD kernel abstraction (revolve, boolean, fillet, export) | Higher-level API over raw opencascade.js. Provides `sketch().revolve()`, `.cut()`, `.fillet()`, STL/STEP export out of the box. Dramatically simpler than raw OCCT API where you must guess numbered overloads like `BRepBuilderAPI_MakeEdge_8`. Active development (published 1 month ago). |
| **replicad-opencascadejs** | 0.20.2 | Custom WASM build of OpenCASCADE for replicad | Pre-built custom WASM that includes only the OCCT modules replicad needs, rather than the full ~13MB gzipped OCCT library. Published by same author (sgenoud). |
| **Three.js** | 0.172.0 | 3D visualization, orbit controls, mesh rendering | Industry standard for browser 3D. Already used across Pottery Academy suite (pot template uses 0.158.0). Version 0.172.0 recommended -- stable, import-map friendly, WebGPU-capable with WebGL2 fallback. |
| **Paper.js** | 0.12.18 | 2D profile editor (SVG path drawing, bezier curves) | Uses cubic bezier curves (vs Fabric.js quadratic). Native path segment/handle editing with draggable control points. Purpose-built for vector graphics manipulation. Available via CDN. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **Bezier.js** | 6.1.4 | Bezier curve math utilities | If Paper.js bezier handling proves insufficient for profile analysis (arc length, splitting, intersections). Lightweight, no DOM dependency. |
| **FileSaver.js** | 2.0.5 | Trigger browser file downloads | For STL/STEP download. Handles blob-to-download across browsers. Tiny (~3KB). Alternative: use native `URL.createObjectURL` + `<a>` click if you want zero dependencies. |
| **Supabase JS** | 2.x | Auth, user data, analytics | Already used across Pottery Academy suite. Email gating, download tracking, subscription management. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **VS Code + Live Server** | Local development | No build tools needed. Serves static files with hot reload. |
| **Browser DevTools** | Debugging WASM, Three.js, worker communication | Chrome recommended for WASM debugging and memory profiling. |

---

## CDN Loading Strategy (Critical -- No Bundler)

The project uses vanilla JS with no build tools. This is the established Pottery Academy pattern and must not change. Here is how each library loads via CDN.

### Import Map Configuration

```html
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/",
    "replicad": "https://cdn.jsdelivr.net/npm/replicad@0.20.5/dist/replicad.js",
    "replicad-opencascadejs": "https://cdn.jsdelivr.net/npm/replicad-opencascadejs@0.20.2/dist/replicad-opencascadejs.js"
  }
}
</script>
```

### CDN URLs for Script Tags

```html
<!-- Paper.js (non-module, global script) -->
<script src="https://cdn.jsdelivr.net/npm/paper@0.12.18/dist/paper-full.min.js"></script>

<!-- Supabase (already in use across suite) -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

### WASM Loading (the hard part)

**Confidence: LOW -- needs prototype validation.**

The replicad + replicad-opencascadejs combo is designed for bundled environments (Vite/Webpack). Loading WASM files via CDN without a bundler requires care:

1. **WASM file must be served with correct MIME type** (`application/wasm`)
2. **The WASM binary is fetched by the JS wrapper** -- you may need to override the WASM URL path
3. **replicad-opencascadejs ships a `.wasm` file** alongside the JS -- jsdelivr should serve it but needs testing

**Fallback strategy if CDN WASM loading fails:**
- Self-host the WASM file alongside the app (e.g., `/wasm/replicad-opencascadejs.wasm`)
- The JS modules can still come from CDN; only the WASM binary needs local hosting
- This is a common pattern for WASM-heavy apps on static hosts like Vercel

**Alternative: Use raw opencascade.js v1.1.1 from UNPKG**
- Available at `https://unpkg.com/opencascade.js@1.1.1/dist/`
- This is the old stable version, proven to work from CDN
- But the API is significantly harder to use than replicad
- Consider this as Plan B if replicad CDN loading proves unworkable

### Bundle Size Estimates

| Asset | Size (gzipped) | Loading Strategy |
|-------|----------------|------------------|
| replicad-opencascadejs WASM | ~5-8 MB (estimate) | Load in Web Worker, show progress indicator. Custom build is smaller than full OCCT (~13MB). |
| replicad JS | ~100-200 KB | Import via import map |
| Three.js | ~170 KB | Import via import map (tree-shaken by browser -- only imported modules load) |
| Paper.js | ~220 KB | Script tag, loads fast |
| App JS | ~50-100 KB | Your code, module scripts |
| **Total initial** | **~6-9 MB** | Dominated by WASM. Show loading state. Cache aggressively. |

**Loading UX pattern:**
1. Load HTML + CSS + Paper.js immediately (profile editor is usable)
2. Start WASM download in Web Worker (show progress bar)
3. Three.js loads in parallel (lightweight)
4. Once WASM ready, enable 3D preview and export buttons
5. User can draw profile while WASM loads

---

## OpenCASCADE.js / replicad: Capabilities Deep Dive

### Version Situation (Confidence: MEDIUM)

The opencascade.js ecosystem has a confusing version landscape:

| Package | Latest Stable | Status | Notes |
|---------|---------------|--------|-------|
| `opencascade.js` | 1.1.1 (5+ years old) | Stable but ancient | Works from UNPKG CDN. API is raw C++ bindings with numbered overloads. |
| `opencascade.js@beta` | 2.0.0-beta.* | Long-running beta | New modular architecture, custom builds via YAML, supports OCCT 7.5.2. Never reached stable. |
| `replicad` | 0.20.5 (1 month ago) | Active, maintained | Built on opencascade.js beta. Higher-level API. Published by sgenoud. |
| `replicad-opencascadejs` | 0.20.2 (4 months ago) | Active | Custom WASM build with only the OCCT modules replicad needs. |

**Recommendation:** Use **replicad** as the primary API. It wraps the messy opencascade.js internals and provides a clean JavaScript-native API. The replicad author actively maintains it and the custom WASM build.

### CAD Operations We Need (Verified Capabilities)

| Operation | OCCT Class | replicad API | Confidence |
|-----------|-----------|--------------|------------|
| **Revolution** (2D profile to 3D solid) | `BRepPrimAPI_MakeRevol` | `sketch.revolve(axis, angle)` -- revolves a drawing on an axis, defaults to 2*PI for full revolution | HIGH |
| **Boolean Cut** (subtract shapes) | `BRepAlgoAPI_Cut_3` | `.cut(otherShape)` | HIGH |
| **Boolean Fuse** (combine shapes) | `BRepAlgoAPI_Fuse` | `.fuse(otherShape)` | HIGH |
| **Fillet** (round edges) | `BRepFilletAPI_MakeFillet` | `.fillet(radius, edgeFinder)` -- uses "finder" system to select edges | MEDIUM (fillets can fail on complex geometry -- known OCCT issue) |
| **Extrude** (2D to 3D linear) | `BRepPrimAPI_MakePrism` | `sketch.extrude(height)` | HIGH |
| **Shell/Offset** | `BRepOffsetAPI_MakeThickSolid` | Available but less documented | MEDIUM |
| **Sketch/Wire building** | `BRepBuilderAPI_MakeWire` etc. | `draw().line().bezierCurveTo().close()` -- chainable API | HIGH |
| **STL Export** | `StlAPI_Writer` | `exportSTL(shape, options)` -- returns blob/buffer | HIGH |
| **STEP Export** | `STEPControl_Writer` | `exportSTEP(shape)` -- returns blob/buffer | HIGH |
| **Tessellation** (for Three.js) | `BRepMesh_IncrementalMesh` | `.mesh()` or helper functions return vertices/faces/normals | HIGH |

### STL/STEP Export Details

**STL Export:**
- Binary STL format (smaller than ASCII)
- Resolution controlled by mesh deflection parameter (lower = finer mesh, larger file)
- Recommended: deflection 0.1mm for 3D printing quality
- File writes to virtual filesystem (Emscripten FS), then read back as Uint8Array
- Typical mould STL: 2-10 MB depending on complexity

**STEP Export:**
- AP214 format (industry standard for CAD exchange)
- Preserves exact B-rep geometry (no tessellation loss)
- File size typically smaller than STL for same geometry
- Pro-tier feature in freemium model

### Fillet Warning (Critical Pitfall)

**Confidence: HIGH** (documented by replicad author and community)

Fillets are the most fragile operation in OpenCASCADE. The replicad documentation explicitly warns:

> "Users of OpenCascade, the 3D kernel used by Replicad, have noticed that fillets may often cause the program to fail, which may result in broken geometry or program crashes."

**Mitigation strategies:**
1. Add fillets as the LAST operation, never in the middle of a chain
2. Prefer adding arcs/curves in the 2D sketch stage rather than 3D fillets
3. Use try/catch around fillet operations with graceful fallback (show sharp edge + warning)
4. Start with conservative fillet radii (1-2mm) and let users adjust
5. Test extensively with various profile shapes

---

## Three.js Integration Details

### Version Decision

| Version | Pros | Cons | Recommendation |
|---------|------|------|----------------|
| 0.158.0 | Already used in pottery-template-pot | 18 versions behind, missing WebGPU support | NO -- upgrade |
| 0.172.0 | Stable, well-tested, import-map friendly, WebGPU ready since r171 | Slightly older than latest r182 | YES -- recommended |
| 0.182.0 | Latest, newest features | More breaking changes to handle, less community coverage | NO -- too bleeding edge |

**Rationale for 0.172.0:** This is the version after which WebGPU works without configuration. It auto-falls back to WebGL2 on older browsers. It is recent enough to have all modern features but old enough to have community coverage and known-good CDN support. The pottery-template-pot uses 0.158.0 and can be upgraded separately.

### Three.js + replicad Mesh Pipeline

```
replicad shape
    |
    v
shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 })
    |
    v
{ vertices: Float32Array, faces: Uint32Array, normals: Float32Array }
    |
    v
THREE.BufferGeometry
    .setAttribute('position', new THREE.BufferAttribute(vertices, 3))
    .setIndex(new THREE.BufferAttribute(faces, 1))
    .setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    |
    v
THREE.Mesh(geometry, material)
    |
    v
scene.add(mesh)  // With OrbitControls for rotation
```

replicad provides helper functions for Three.js integration. The tessellation returns vertices, faces, and normals that map directly to `THREE.BufferGeometry` attributes.

### Three.js Features Used

| Feature | Import | Purpose |
|---------|--------|---------|
| `Scene, PerspectiveCamera, WebGLRenderer` | `three` | Core rendering |
| `BufferGeometry, BufferAttribute` | `three` | Mesh from OCCT data |
| `MeshStandardMaterial` | `three` | Realistic material for mould parts |
| `OrbitControls` | `three/addons/controls/OrbitControls.js` | Mouse rotation/zoom/pan |
| `AmbientLight, DirectionalLight` | `three` | Lighting |
| `Group` | `three` | Grouping mould parts for show/hide |

**NOT using Three.js LatheGeometry.** While the pottery-template-pot uses `THREE.LatheGeometry` to revolve 2D profiles, we cannot use it here because:
1. LatheGeometry creates visualization-only meshes, not CAD B-rep solids
2. We need boolean operations (cut, fuse) which require true solid geometry
3. We need STEP export which requires B-rep, not mesh
4. LatheGeometry cannot do wall thickness, slip wells, or ridge/groove features

Three.js is visualization only. All geometry computation happens in replicad/OCCT.

---

## Paper.js for Profile Editing

### Why Paper.js Over Alternatives

| Library | Bezier Type | Path Editing | SVG Import/Export | CDN Size | Recommendation |
|---------|-------------|-------------|-------------------|----------|----------------|
| **Paper.js** 0.12.18 | Cubic (better for curves) | Native segment+handle editing | Full SVG support | ~220KB | YES -- best for this use case |
| Fabric.js 7.1.0 | Quadratic (simpler) | Object manipulation, not path editing | SVG import/export | ~300KB | NO -- designed for canvas objects, not path editing |
| SVG.js 3.x | N/A (SVG manipulation) | No interactive editing | SVG DOM manipulation | ~60KB | NO -- too low-level, no interactive editing |
| Custom Canvas | Any | Must build from scratch | Must build from scratch | 0KB | NO -- massive engineering effort |

**Paper.js wins because:**
1. **Cubic bezier curves** -- pottery profiles need smooth compound curves, not quadratic approximations
2. **Interactive path editing** -- built-in segment point + handle manipulation with mouse interaction
3. **SVG round-trip** -- import SVG profiles, edit, export clean SVG, extract path data for OCCT
4. **Canvas rendering** -- renders to HTML5 Canvas (not SVG DOM), better performance for interactive editing
5. **Mature and stable** -- v0.12.18, though not actively developed, is feature-complete for this use case

### Paper.js Profile Editor Pattern

```javascript
// Create editable path
const profile = new paper.Path();
profile.strokeColor = 'black';
profile.fullySelected = true; // Shows all control points

// Add segments with bezier handles
profile.add(new paper.Segment(
    new paper.Point(0, 0),           // Anchor point
    null,                             // Handle in
    new paper.Point(0, -20)          // Handle out (bezier control)
));

// User drags points/handles interactively
// Paper.js handles hit-testing and dragging natively

// Extract path data for OCCT
const pathData = profile.exportSVG().getAttribute('d');
// Parse SVG path data into replicad sketch commands
```

### SVG Upload Flow

```
User uploads .svg file
    |
    v
paper.project.importSVG(svgString)
    |
    v
Extract Path items, identify the profile path
    |
    v
Display in editor for optional tweaking
    |
    v
Convert Paper.js path segments to replicad sketch commands
    (moveTo, lineTo, bezierCurveTo, etc.)
```

---

## Web Worker Architecture

### Why Workers Are Essential

The WASM-based OCCT kernel performs heavy computation:
- Revolution of a profile: 50-500ms
- Boolean operations: 100-2000ms
- Fillet operations: 200-5000ms
- Full mould generation (multiple booleans): 1-10 seconds
- STL tessellation: 100-1000ms

Running this on the main thread would freeze the UI completely.

### Worker Pattern

```
Main Thread                          Worker Thread
-----------                          -------------
[Paper.js Editor]                    [replicad + WASM]
[Three.js Viewer]
[UI Controls]

    profile data  ------>  postMessage({type: 'generate', profile: [...]})
                                        |
                                        v
                              Load WASM (once, on init)
                              Build sketch from profile
                              Revolve, boolean, fillet
                              Tessellate for preview
                              Export STL/STEP if requested
                                        |
    <------  postMessage({type: 'result', meshes: {...}, stl: Uint8Array})
        |
        v
  Update Three.js scene
  Enable download buttons
```

### Worker Loading Strategy

```javascript
// cad-worker.js (Web Worker)
importScripts('https://cdn.jsdelivr.net/npm/replicad-opencascadejs@0.20.2/dist/replicad-opencascadejs.js');
// OR use ESM worker:
// import opencascade from 'replicad-opencascadejs';
// import { ... } from 'replicad';

self.onmessage = async function(e) {
    if (e.data.type === 'init') {
        // Initialize WASM -- heavy, do once
        await initOpenCascade();
        self.postMessage({ type: 'ready' });
    }
    if (e.data.type === 'generate') {
        // Build geometry from profile
        const result = generateMould(e.data.profile, e.data.params);
        // Transfer mesh data (zero-copy via transferable)
        self.postMessage(
            { type: 'result', meshData: result.meshData },
            [result.meshData.vertices.buffer, result.meshData.normals.buffer]
        );
    }
};
```

**Key detail:** Use **Transferable objects** (`ArrayBuffer` transfer) when sending mesh data back to main thread. This avoids copying potentially megabytes of vertex data.

**Confidence: MEDIUM** -- The worker pattern is well-established for WASM, but replicad's ESM module loading inside a Web Worker needs prototype testing. Module workers (`new Worker('worker.js', { type: 'module' })`) are supported in all modern browsers but CDN import maps do not apply inside workers -- you may need to use direct URLs or `importScripts()` with the UMD build.

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| **replicad** | Raw opencascade.js | Raw API uses numbered method overloads (`BRepBuilderAPI_MakeEdge_8`), no documentation for JS usage, extremely verbose. replicad provides chainable fluent API that is 5-10x less code. |
| **replicad** | CascadeStudio | CascadeStudio is a full IDE, not a library. You would be embedding their entire app. replicad is a library designed for integration. |
| **replicad** | bitbybit-dev/occt | Bitbybit wraps OCCT but is designed for their visual programming platform. Less documented for standalone use. Also MIT licensed but more complex dependency tree. |
| **Paper.js** | Fabric.js | Fabric.js excels at object manipulation (move, rotate, scale rectangles/images) but its path editing is limited. Paper.js has native bezier curve editing with segment handles. |
| **Paper.js** | Custom SVG editor | Engineering a bezier path editor from scratch is 2-4 weeks of work. Paper.js gives it for free. |
| **Three.js** | Babylon.js | Three.js is already used across the Pottery Academy suite. Switching engines adds no value and creates inconsistency. |
| **Three.js 0.172.0** | Three.js 0.158.0 | Current suite version is old. 0.172.0 has WebGPU support and is the recommended stable target. Not worth pinning to old version for new app. |
| **Web Worker** | Main thread OCCT | WASM computation can take 1-10 seconds. Freezing UI is unacceptable. Worker is mandatory, not optional. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Three.js LatheGeometry** for CAD | Creates visualization mesh only. Cannot do booleans, cannot export STEP, no wall thickness. | replicad `sketch.revolve()` for geometry, Three.js only for display. |
| **opencascade.js v1.1.1 directly** | 5+ years old, raw C++ API bindings, no documentation, numbered method overloads. | replicad (wraps the beta builds with clean API). |
| **Any build tool (Webpack, Vite, Rollup)** | Breaks Pottery Academy convention. All apps are vanilla JS + CDN. | Import maps + jsdelivr CDN. Self-host WASM if needed. |
| **npm install for runtime deps** | Package.json is metadata only in this project family. No node_modules in production. | CDN imports via import map. |
| **Fabric.js for profile editing** | Quadratic beziers, object-oriented (not path-oriented), path editing is afterthought. | Paper.js with cubic beziers and native path editing. |
| **jscad / OpenJSCAD** | CSG-based (mesh operations), not B-rep. Cannot export STEP. Lower quality fillets. | replicad (B-rep based via OCCT). |
| **Manifold** | Fast boolean operations but mesh-only, no B-rep, no STEP export. | replicad for B-rep geometry pipeline. |
| **Server-side generation** (for v1) | Adds server costs, deployment complexity, latency. Client-side WASM works for this use case. | Client-side replicad. Keep architecture open for server fallback (v2 if needed for multi-part moulds). |

---

## Stack Patterns by Variant

**If replicad CDN loading works (expected path):**
- Use import maps for replicad + Three.js
- Self-host WASM binary on Vercel if CDN MIME type issues arise
- Clean, minimal setup

**If replicad CDN loading fails (fallback):**
- Use raw `opencascade.js@beta` via UNPKG/jsdelivr
- Write a thin wrapper module that provides replicad-like API
- More work but still viable
- Or: use `opencascade.js@1.1.1` stable (oldest but proven CDN-friendly)

**If WASM size is unacceptable for users:**
- Pre-generate a custom WASM build via Docker (opencascade.js custom build system)
- Include only: BRepPrimAPI, BRepAlgoAPI, BRepFilletAPI, BRepMesh, StlAPI, STEPControl
- Could reduce to ~3-5MB gzipped (unverified estimate)
- This is an optimization, not a launch blocker

---

## Version Compatibility Matrix

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| replicad@0.20.5 | replicad-opencascadejs@0.20.x | Must use matched versions from same author |
| Three.js@0.172.0 | Any replicad version | No direct dependency; connected via mesh data (vertices/normals arrays) |
| Paper.js@0.12.18 | Any other library | Independent; connects via path data extraction |
| Supabase JS@2.x | Any | Independent backend service |

---

## Installation (CDN-only, no npm)

No installation needed. All dependencies load via CDN in the browser.

**For local development:**
```bash
# No npm install needed. Just serve the files:
npx live-server
# Or use VS Code Live Server extension
```

**Package.json is metadata-only** (following Pottery Academy pattern):
```json
{
  "name": "pottery-mould-generator",
  "version": "0.1.0",
  "description": "Browser-based slip casting mould generator",
  "cdnDependencies": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.module.js",
    "replicad": "https://cdn.jsdelivr.net/npm/replicad@0.20.5/dist/replicad.js",
    "replicad-opencascadejs": "https://cdn.jsdelivr.net/npm/replicad-opencascadejs@0.20.2/",
    "paper": "https://cdn.jsdelivr.net/npm/paper@0.12.18/dist/paper-full.min.js",
    "supabase": "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"
  }
}
```

---

## Prototype Validation Checklist

Before committing to this stack, validate these unknowns with a spike:

- [ ] **replicad loads from CDN via import map** (without bundler)
- [ ] **replicad-opencascadejs WASM loads in Web Worker** from CDN or self-hosted
- [ ] **Basic revolve works:** draw profile, revolve 360, get mesh vertices
- [ ] **Boolean cut works:** subtract inner from outer shape
- [ ] **STL export works:** write to virtual FS, read as Uint8Array, trigger download
- [ ] **STEP export works:** same flow as STL
- [ ] **Mesh transfers to Three.js:** vertices/normals render correctly
- [ ] **Paper.js path data converts to replicad sketch commands**
- [ ] **Total load time acceptable:** WASM + JS < 15 seconds on 4G connection

**Recommended spike scope:** A single HTML file that loads replicad in a worker, revolves a hardcoded profile, renders in Three.js, and exports STL. Estimate: 4-8 hours.

---

## Sources

### Official Documentation (HIGH confidence)
- [OpenCASCADE.js official site](https://ocjs.org/) -- documentation, getting started, custom builds
- [OpenCASCADE Technology modeling algorithms](https://dev.opencascade.org/doc/overview/html/occt_user_guides__modeling_algos.html) -- revolution, boolean, fillet APIs
- [replicad official documentation](https://replicad.xyz/docs/intro/) -- API reference, sketch/revolve/fillet
- [replicad Sketch class API](https://replicad.xyz/docs/api/classes/Sketch/) -- sketch and revolve methods
- [Three.js releases](https://github.com/mrdoob/three.js/releases) -- version history, r182 latest
- [Paper.js features](http://paperjs.org/features/) -- path editing, bezier curves

### GitHub Repositories (HIGH confidence)
- [opencascade.js by donalffons](https://github.com/donalffons/opencascade.js/) -- source, releases, discussions
- [replicad by sgenoud](https://github.com/sgenoud/replicad) -- source, examples
- [opencascade.js examples](https://github.com/donalffons/opencascade.js-examples) -- boolean, STL export examples
- [opencascade.js STEP export discussion](https://github.com/donalffons/opencascade.js/issues/106) -- STEPCAFControl_Writer usage

### npm Packages (HIGH confidence for version numbers)
- [replicad@0.20.5 on npm](https://www.npmjs.com/package/replicad) -- published 1 month ago
- [opencascade.js on npm](https://www.npmjs.com/package/opencascade.js/v/2.0.0-beta.4fa3125) -- beta version info
- [paper@0.12.18 on npm](https://www.npmjs.com/package/paper) -- latest version
- [fabric@7.1.0 on npm](https://www.npmjs.com/package/fabric) -- latest version (not recommended)

### CDN Resources (MEDIUM confidence -- URLs valid at time of research)
- [Three.js on jsDelivr](https://www.jsdelivr.com/package/npm/three) -- CDN hosting
- [Paper.js on jsDelivr](https://www.jsdelivr.net/npm/paper) -- CDN hosting
- [Paper.js on cdnjs](https://cdnjs.com/libraries/paper.js/) -- alternative CDN

### Community/Blog Sources (LOW confidence -- for context only)
- [What Changed in Three.js 2026](https://www.utsubo.com/blog/threejs-2026-what-changed) -- WebGPU timeline
- [Paper.js vs Fabric.js comparison (Slant 2025)](https://www.slant.co/versus/141/142/~paper-js_vs_fabric-js) -- community comparison
- [WebAssembly for CAD Applications (Medium)](https://altersquare.medium.com/webassembly-for-cad-applications-when-javascript-isnt-fast-enough-56fcdc892004) -- WASM patterns
- [replicad fillet discussion](https://github.com/sgenoud/replicad/discussions/28) -- fillet fragility warning
- [Evaluating Replicad from OpenSCAD](https://github.com/sgenoud/replicad/discussions/106) -- replicad vs alternatives

### Existing Pottery Academy Pattern (HIGH confidence -- from codebase)
- pottery-template-pot uses Three.js 0.158.0 via import map on jsdelivr
- Import pattern: `"three": "https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js"`
- No build tools, no npm install, CDN-only
- Supabase for backend services

---
*Stack research for: Browser-based slip casting mould generator*
*Researched: 2026-02-10*
