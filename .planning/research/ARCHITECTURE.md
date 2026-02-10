# Architecture Research: Pottery Mould Generator

**Domain:** Browser-based 3D slip casting mould generation
**Researched:** 2026-02-10
**Confidence:** MEDIUM (OpenCASCADE.js API details rely on training data + limited WebSearch verification; mould geometry pipeline well-understood from ShapeCast paper; existing codebase patterns directly observed)

## System Overview

```
+------------------------------------------------------------------+
|                        MAIN THREAD                                |
|                                                                   |
|  +-------------+    +--------------+    +---------------------+   |
|  |  Profile     |    |   App        |    |   3D Preview        |   |
|  |  Editor      |--->|   State      |--->|   (Three.js)        |   |
|  |  (SVG Canvas)|    |   Manager    |    |                     |   |
|  +------+------+    +------+-------+    +---------------------+   |
|         |                  |                       ^              |
|         v                  v                       |              |
|  +-------------+    +-------------+    +-----------+----------+   |
|  |  SVG Import  |    |  Plaster    |    |  Mesh Transfer       |   |
|  |  / Export    |    |  Calculator |    |  (BufferGeometry)    |   |
|  +-------------+    +-------------+    +-----------+----------+   |
|                            |                       ^              |
+----------------------------|                       |--------------+
                             |                       |
                    postMessage (params)     postMessage (buffers)
                             |                       |
                             v                       |
+------------------------------------------------------------------+
|                       WEB WORKER                                  |
|                                                                   |
|  +-------------------------------------------------------------+ |
|  |              OpenCASCADE.js (WASM)                           | |
|  |                                                              | |
|  |  +-----------+  +----------+  +----------+  +-----------+   | |
|  |  | Profile   |  | Geometry |  | Mould    |  | File      |   | |
|  |  | Converter |  | Engine   |  | Builder  |  | Exporter  |   | |
|  |  | (SVG->    |  | (revolve |  | (inner,  |  | (STL/STEP |   | |
|  |  |  Wire)    |  |  offset  |  |  outer,  |  |  writer)  |   | |
|  |  |           |  |  boolean)|  |  ring)   |  |           |   | |
|  |  +-----------+  +----------+  +----------+  +-----------+   | |
|  |                                                              | |
|  |  +-------------------------------------------------------+  | |
|  |  |         Tessellator (Shape -> vertex/face buffers)     |  | |
|  |  +-------------------------------------------------------+  | |
|  +-------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Profile Editor | SVG-based 2D profile drawing/editing with parametric controls and freehand Bezier editing | `js/profileEditor.js` - SVG manipulation, drag handles, snap-to-grid, constraint enforcement |
| App State Manager | Central state object, event coordination, UI sync | `js/app.js` - single state object pattern (matching existing template generators) |
| 3D Preview | Real-time Three.js visualization of revolved form and mould parts | `js/preview3d.js` - scene, camera, materials, orbit controls, mesh updates |
| SVG Import/Export | Parse uploaded SVG to internal profile format; export profile as SVG | `js/svgIO.js` - SVG path parser, profile normalization, validation |
| Plaster Calculator | Plaster volume/weight/water ratios from mould cavity geometry | `js/plasterCalculator.js` - pure functions, no WASM dependency |
| Geometry Worker | OpenCASCADE.js WASM host, all CAD operations | `js/workers/geometryWorker.js` - loads WASM, processes commands, returns mesh buffers |
| Profile Converter | SVG path data to OpenCASCADE Wire/Edge geometry | Inside worker - converts point arrays to BSplineCurves, Edges, Wires |
| Geometry Engine | Revolution, offset, boolean operations on OCCT shapes | Inside worker - BRepPrimAPI_MakeRevol, BRepOffsetAPI, BRepAlgoAPI_Cut |
| Mould Builder | Orchestrates mould part generation from base profile | Inside worker - coordinates profile converter + geometry engine to produce all parts |
| File Exporter | STL and STEP file generation from OCCT shapes | Inside worker - StlAPI_Writer, STEPControl_Writer |
| Tessellator | Convert OCCT BRep shapes to vertex/normal/face buffers for Three.js | Inside worker - BRepMesh_IncrementalMesh + face triangulation extraction |
| Mesh Transfer | Transferable ArrayBuffer passing between worker and main thread | postMessage with transfer list for zero-copy buffer handoff |

## Recommended Project Structure

```
pottery-mould-generator/
+-- index.html                  # Main HTML entry point
+-- favicon.svg                 # Pottery Academy icon
+-- css/
|   +-- style.css               # All styling (CSS variables, responsive)
+-- js/
|   +-- app.js                  # Main orchestrator, state management, event handling
|   +-- profileEditor.js        # SVG-based 2D profile editor
|   +-- profileData.js          # Profile data model, validation, presets
|   +-- svgIO.js                # SVG file import/export, path parsing
|   +-- preview3d.js            # Three.js 3D visualization
|   +-- plasterCalculator.js    # Plaster volume/weight/water calculations
|   +-- geometryBridge.js       # Main-thread bridge to geometry worker
|   +-- fileDownload.js         # Download trigger, blob handling, freemium gating
|   +-- emailGate.js            # Email collection modal (shared pattern)
|   +-- supabaseClient.js       # Backend integration (shared pattern)
|   +-- urlSharing.js           # URL state encoding/decoding (shared pattern)
|   +-- workers/
|       +-- geometryWorker.js   # Web Worker entry point, message router
|       +-- profileConverter.js # SVG points -> OCCT Wire geometry
|       +-- mouldBuilder.js     # Mould part generation orchestrator
|       +-- tessellator.js      # OCCT Shape -> vertex/normal/face buffers
|       +-- fileExporter.js     # STL/STEP file generation
+-- assets/
|   +-- branding/               # Logo, icons, QR codes
|   +-- presets/                # Preset profile SVGs
+-- lib/
|   +-- opencascade/            # OCCT WASM files (loaded by worker)
|       +-- opencascade.full.js
|       +-- opencascade.full.wasm
+-- docs/
|   +-- assembly-guide.md       # User instructions
+-- .planning/                  # Planning and research files
```

### Structure Rationale

- **`js/workers/`**: Isolates all OpenCASCADE.js code in the Web Worker context. Worker modules are never imported by main-thread code, enforcing a clean message-passing boundary. This prevents the 20-40MB WASM module from blocking the UI.
- **`js/geometryBridge.js`**: Single point of contact between main thread and worker. Wraps postMessage/onmessage in a Promise-based API so the rest of the app can `await geometryBridge.generateMould(params)` without knowing about workers.
- **`js/profileData.js`**: Pure data model for profiles, separate from the SVG editor UI. Enables testing profile operations without DOM. Contains presets, validation rules, and serialization.
- **`lib/opencascade/`**: Local copy of WASM files rather than CDN. WASM files are large (20-40MB) and must be loaded by the worker with a known URL. CDN loading of WASM in workers can have CORS issues.
- **`js/svgIO.js`**: Separate from profileEditor because SVG import/export is a distinct concern from interactive editing. Import produces a profileData object; export reads from profileData.

## Data Flow

### Primary Data Flow: Profile Edit to 3D Preview

```
[User drags handle in Profile Editor]
    |
    v
profileEditor.js: Update SVG path + emit profile-changed event
    |
    v
app.js: Receive event, extract profile points from editor
    |
    v
profileData.js: Validate profile (no self-intersections, within bounds)
    |
    v
app.js: Update state.profile, trigger geometry regeneration
    |
    v
geometryBridge.js: postMessage({type: 'generatePreview', profile: points, params: {...}})
    |
    v
    ====== WORKER BOUNDARY (postMessage) ======
    |
    v
geometryWorker.js: Route to mouldBuilder
    |
    v
profileConverter.js: Convert point array to OCCT Wire
    |
    v
mouldBuilder.js: Revolve wire -> create inner/outer/ring shapes
    |
    v
tessellator.js: BRepMesh_IncrementalMesh -> extract vertex/normal/face buffers
    |
    v
geometryWorker.js: postMessage({type: 'previewReady', meshes: {...}}, [transferables])
    |
    v
    ====== WORKER BOUNDARY (postMessage + Transferable) ======
    |
    v
geometryBridge.js: Resolve promise, pass mesh data to callback
    |
    v
preview3d.js: Create THREE.BufferGeometry from vertex/normal/face arrays
    |
    v
[3D scene updates with new mould parts]
```

### File Export Flow

```
[User clicks "Download STL"]
    |
    v
app.js: Check freemium gate (email, subscription tier)
    |
    v
geometryBridge.js: postMessage({type: 'exportSTL', partName: 'inner'})
    |
    v
    ====== WORKER BOUNDARY ======
    |
    v
fileExporter.js: BRepMesh_IncrementalMesh -> StlAPI_Writer -> binary data
    |
    v
geometryWorker.js: postMessage({type: 'fileReady', blob: arrayBuffer}, [arrayBuffer])
    |
    v
    ====== WORKER BOUNDARY ======
    |
    v
fileDownload.js: Create Blob from ArrayBuffer, trigger download
```

### Profile Data Model

The profile is the central data structure that flows through the entire system.

```javascript
// Internal profile representation
const profile = {
    // Array of profile points (half cross-section, foot to rim)
    // x = distance from axis of revolution (radius), y = height
    points: [
        { x: 3.5, y: 0, type: 'line' },        // foot bottom-right
        { x: 3.5, y: 0.3, type: 'line' },       // foot top
        { x: 3.0, y: 0.5, type: 'bezier',       // body start
          cp1: { x: 3.2, y: 0.4 },              // control point 1
          cp2: { x: 3.0, y: 0.5 } },            // control point 2
        { x: 4.5, y: 8.0, type: 'bezier',       // body curve
          cp1: { x: 2.8, y: 4.0 },
          cp2: { x: 4.0, y: 6.0 } },
        { x: 4.5, y: 9.0, type: 'line' },       // rim
        { x: 4.2, y: 9.0, type: 'line' },       // rim inner edge (lip thickness)
    ],
    // Metadata
    closed: false,     // Profile is open (axis to rim, not a closed loop)
    units: 'mm',       // Internal always mm for OCCT precision
    origin: 'bottom-center',  // Axis of revolution is at x=0
};
```

**Why this format:**
- Points with explicit type (`line`, `bezier`) map naturally to both SVG path commands AND OpenCASCADE edge types
- Bezier control points stored inline with each point, not separately
- Half-profile only (revolution handles the other half)
- Pure data -- no DOM, no SVG, no OCCT dependencies. Can be serialized to JSON, encoded in URL, stored in database.

### State Management

Following the existing Pottery Academy pattern (single state object in app.js):

```javascript
const state = {
    // Profile
    profile: null,          // profileData object (points array + metadata)
    profileSource: 'preset', // 'preset' | 'freehand' | 'imported'

    // Mould parameters
    shrinkage: 12,          // Clay shrinkage percentage
    wallThickness: 2.4,     // Inner mould wall thickness (mm)
    plasterThickness: 25,   // Outer mould plaster space (mm)
    slipWellMode: 'regular', // 'none' | 'regular' | 'tall'
    outerSplit: 'half',     // 'half' (2 parts) | 'quad' (4 parts)

    // Display
    activePart: 'all',      // 'all' | 'inner' | 'outer' | 'ring' | 'proof'
    showExploded: false,    // Exploded view toggle
    units: 'metric',        // 'metric' | 'imperial'

    // Generation state
    generating: false,      // Whether worker is processing
    meshes: null,           // Current tessellated meshes from worker
    lastError: null,        // Error from worker if generation failed

    // UI
    editorMode: 'parametric', // 'parametric' | 'freehand'
};
```

## Architectural Patterns

### Pattern 1: Promise-Based Worker Bridge

**What:** Wrap Web Worker postMessage/onmessage in a Promise-based API with request IDs, so the rest of the app can use async/await instead of raw message handling.

**When to use:** Every interaction between main thread and geometry worker.

**Trade-offs:** Adds a small abstraction layer but dramatically simplifies calling code. Prevents callback hell with multiple concurrent worker operations.

```javascript
// geometryBridge.js
const pending = new Map();
let nextId = 0;
let worker = null;

export function init() {
    worker = new Worker('./js/workers/geometryWorker.js', { type: 'module' });
    worker.onmessage = (e) => {
        const { id, type, data, error } = e.data;
        const resolver = pending.get(id);
        if (resolver) {
            pending.delete(id);
            if (error) resolver.reject(new Error(error));
            else resolver.resolve(data);
        }
    };
    // Wait for WASM initialization
    return sendCommand('init');
}

function sendCommand(type, params = {}) {
    return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, type, ...params });
    });
}

export function generatePreview(profile, mouldParams) {
    return sendCommand('generatePreview', { profile, mouldParams });
}

export function exportSTL(partName) {
    return sendCommand('exportSTL', { partName });
}

export function exportSTEP(partName) {
    return sendCommand('exportSTEP', { partName });
}
```

### Pattern 2: Transferable Buffer Handoff

**What:** When the worker sends mesh data (vertices, normals, faces) back to the main thread, use Transferable ArrayBuffers for zero-copy transfer. The buffers are detached from the worker and attached to the main thread instantly.

**When to use:** Every mesh transfer from worker to main thread (preview updates and file exports).

**Trade-offs:** Buffers become unusable in the worker after transfer. Worker must re-generate buffers for subsequent transfers. This is fine because each generation creates new buffers anyway.

```javascript
// Inside geometryWorker.js
function sendMeshResult(id, meshData) {
    // Collect all ArrayBuffers for transfer list
    const transferList = [];
    for (const part of Object.values(meshData)) {
        if (part.vertices) transferList.push(part.vertices.buffer);
        if (part.normals) transferList.push(part.normals.buffer);
        if (part.indices) transferList.push(part.indices.buffer);
    }
    self.postMessage({ id, type: 'result', data: meshData }, transferList);
}
```

### Pattern 3: Debounced Generation with Abort

**What:** Profile edits can happen at 60fps (dragging a handle). Debounce geometry generation to avoid flooding the worker. If a new request arrives before the previous completes, abort the previous.

**When to use:** Every profile-changed event.

**Trade-offs:** Adds slight latency between edit and preview update. 100-200ms debounce is imperceptible to users.

```javascript
// In app.js
let generationTimer = null;
let generationId = 0;

function onProfileChanged(profile) {
    // Update state immediately
    state.profile = profile;

    // Update 2D SVG preview immediately (cheap)
    profileEditor.render(profile);

    // Debounce 3D generation (expensive)
    clearTimeout(generationTimer);
    generationTimer = setTimeout(async () => {
        const myId = ++generationId;
        state.generating = true;
        updateUI();

        try {
            const meshes = await geometryBridge.generatePreview(
                profile, getMouldParams()
            );
            // Only apply if still the latest request
            if (myId === generationId) {
                state.meshes = meshes;
                state.generating = false;
                preview3d.updateMeshes(meshes);
                updateUI();
            }
        } catch (err) {
            if (myId === generationId) {
                state.lastError = err.message;
                state.generating = false;
                updateUI();
            }
        }
    }, 150);
}
```

### Pattern 4: Staged Generation Pipeline

**What:** Generate mould parts in stages, sending intermediate results for progressive preview updates. First the revolved proof model (fast, gives immediate visual feedback), then the full mould parts (slower, involves boolean operations).

**When to use:** When profile changes trigger full mould regeneration.

**Trade-offs:** More complex worker logic but dramatically better perceived performance. User sees proof model in ~200ms, full mould parts in ~1-2s.

```javascript
// Inside mouldBuilder.js (worker side)
async function generateAll(profile, params) {
    // Stage 1: Proof model (just revolution, fast)
    const proofShape = revolveProfile(profile);
    sendIntermediateResult('proof', tessellate(proofShape));

    // Stage 2: Inner mould (revolution + shrinkage scale + wall offset + slip well)
    const innerShape = buildInnerMould(profile, params);
    sendIntermediateResult('inner', tessellate(innerShape));

    // Stage 3: Outer mould halves (revolution + offset + split + ridges)
    const outerShapes = buildOuterMould(innerShape, params);
    sendIntermediateResult('outer', outerShapes.map(s => tessellate(s)));

    // Stage 4: Ring
    const ringShape = buildRing(innerShape, outerShapes, params);
    sendIntermediateResult('ring', tessellate(ringShape));
}
```

## Mould Generation Geometry Pipeline

This is the core computational pipeline. Each step maps to specific OpenCASCADE operations.

### Step 1: Profile to Wire

Convert the internal profile point array to an OpenCASCADE Wire.

```
Profile Points (JS array)
    -> For each segment:
       - 'line': GC_MakeSegment -> BRepBuilderAPI_MakeEdge
       - 'bezier': Geom_BezierCurve (from control points) -> BRepBuilderAPI_MakeEdge
    -> BRepBuilderAPI_MakeWire (combine all edges)
    -> Result: TopoDS_Wire (the half-profile)
```

**Key OCCT classes:** `gp_Pnt`, `GC_MakeSegment`, `Geom_BezierCurve`, `BRepBuilderAPI_MakeEdge`, `BRepBuilderAPI_MakeWire`

### Step 2: Revolution

Revolve the wire around the Y-axis to create the 3D form.

```
Wire (half-profile)
    -> Close the wire: add bottom edge (on axis), close with axis line
    -> BRepBuilderAPI_MakeFace (wire -> face)
    -> BRepPrimAPI_MakeRevol (face, gp_Ax1(origin, Y-direction), 2*PI)
    -> Result: TopoDS_Shape (solid of revolution)
```

**Key OCCT classes:** `BRepBuilderAPI_MakeFace`, `BRepPrimAPI_MakeRevol`, `gp_Ax1`, `gp_Dir`

**For partial revolution (outer mould halves):** Use angle = PI for halves, PI/2 for quarters.

### Step 3: Proof Model

The proof model is just the revolved form at fired size. No offsetting needed.

```
Revolved shape at 1:1 (fired dimensions)
    -> Tessellate for preview
    -> Export as STL for user
```

### Step 4: Inner Mould

The inner mould cavity matches the pot's outer form, but scaled for shrinkage and with a wall offset for 3D printing.

```
Profile points
    -> Scale profile by (1 / (1 - shrinkage/100)) to get mould-cavity size
    -> Revolve scaled profile -> solid (this IS the pot cavity inside the mould)
    -> Offset the surface outward by wallThickness (2.4mm)
       using BRepOffsetAPI_MakeOffsetShape
    -> Boolean subtract original from offset: the shell IS the inner mould wall
    -> Add slip well geometry on top:
       - Predetermined profile extending above rim
       - Create slip well solid by revolution
       - Boolean union with inner mould shell
    -> Add registration features (bolt holes, alignment marks)
    -> Result: TopoDS_Shape (inner mould, printable)
```

**Key OCCT classes:** `BRepOffsetAPI_MakeOffsetShape`, `BRepAlgoAPI_Cut`, `BRepAlgoAPI_Fuse`

**Alternative approach (simpler, matching ShapeCast):** Instead of surface offset, use 2D parallel curves. Offset the 2D profile inward by wallThickness using `BRepOffsetAPI_MakeOffset` on the 2D wire, then revolve both the original and offset wires independently, and boolean-subtract the inner from the outer.

### Step 5: Outer Mould

The outer mould contains the plaster. It wraps around the inner mould with a gap for plaster.

```
Inner mould shape (from Step 4)
    -> Offset outward by plasterThickness (25mm)
    -> Revolve the outer boundary profile
    -> Create bounding box/shell for the outer mould
    -> Split into halves or quarters:
       - Create cutting planes at 0/180 degrees (half) or 0/90/180/270 (quad)
       - BRepAlgoAPI_Cut with each plane
    -> Add ridge/groove features on split faces for alignment:
       - Create ridge profile, sweep along split edge
       - BRepAlgoAPI_Fuse ridges onto one half
       - BRepAlgoAPI_Cut matching grooves into other half
    -> Add bolt flanges at bottom
    -> Result: Array of TopoDS_Shape (outer mould parts)
```

**Key OCCT classes:** `BRepAlgoAPI_Cut`, `BRepAlgoAPI_Fuse`, `BRepPrimAPI_MakeHalfSpace`, `BRepBuilderAPI_MakeFace`

### Step 6: Ring

The ring connects inner and outer moulds at the bottom.

```
Inner mould bottom profile + outer mould bottom profile
    -> Create ring cross-section (predetermined shape)
    -> Revolve or extrude as appropriate
    -> Split if outer mould is split (matching cuts)
    -> Add matching ridge/groove features
    -> Result: TopoDS_Shape (ring, or array of ring parts)
```

### Step 7: Tessellation (for preview)

Convert all OCCT shapes to Three.js-compatible mesh data.

```
TopoDS_Shape (any mould part)
    -> BRepMesh_IncrementalMesh(shape, linearDeflection=0.1, angularDeflection=0.5)
    -> For each face in shape (TopExp_Explorer):
       - Get Poly_Triangulation from face
       - Extract nodes (vertices), triangles (indices), normals
       - Accumulate into Float32Array / Uint32Array
    -> Package as {vertices: Float32Array, normals: Float32Array, indices: Uint32Array}
    -> Transfer to main thread as Transferable
```

**Key OCCT classes:** `BRepMesh_IncrementalMesh`, `TopExp_Explorer`, `BRep_Tool`, `Poly_Triangulation`

### Step 8: File Export

Generate downloadable STL/STEP files from OCCT shapes.

```
STL Export:
    TopoDS_Shape -> BRepMesh_IncrementalMesh (tessellate)
    -> StlAPI_Writer -> Emscripten virtual filesystem -> read as ArrayBuffer

STEP Export:
    TopoDS_Shape -> STEPControl_Writer -> Transfer -> Write
    -> Emscripten virtual filesystem -> read as ArrayBuffer
```

**Key OCCT classes:** `StlAPI_Writer`, `STEPControl_Writer`

## OpenCASCADE.js Integration Pattern

### WASM Loading

OpenCASCADE.js WASM is approximately 20-40MB. It MUST be loaded in a Web Worker, not on the main thread, to avoid blocking the UI.

```javascript
// geometryWorker.js
import initOpenCascade from '../../lib/opencascade/opencascade.full.js';

let oc = null;

self.onmessage = async function(e) {
    const { id, type, ...params } = e.data;

    if (type === 'init') {
        try {
            oc = await initOpenCascade({
                // Point to local WASM file
                locateFile: (file) => `../../lib/opencascade/${file}`
            });
            self.postMessage({ id, type: 'result', data: { ready: true } });
        } catch (err) {
            self.postMessage({ id, type: 'result', error: err.message });
        }
        return;
    }

    // Route other commands...
    if (!oc) {
        self.postMessage({ id, type: 'result', error: 'OCCT not initialized' });
        return;
    }

    // Handle generation commands
    switch (type) {
        case 'generatePreview':
            handleGeneratePreview(id, params);
            break;
        case 'exportSTL':
            handleExportSTL(id, params);
            break;
        case 'exportSTEP':
            handleExportSTEP(id, params);
            break;
    }
};
```

**Critical considerations:**
- The `initOpenCascade()` call downloads and compiles ~20-40MB of WASM. Show a loading indicator.
- WASM loading can take 3-10 seconds on first visit. Cache the WASM in browser's Cache API or Service Worker for subsequent visits.
- The `oc` object is the entry point to ALL OpenCASCADE functionality. Every OCCT class is accessed as `new oc.ClassName()`.
- **Memory management is manual.** OCCT objects allocated via `new oc.ClassName()` must be freed with `shape.delete()`. Failing to do this causes WASM memory leaks. Use a cleanup pattern (see Anti-Patterns below).
- The full WASM build includes everything. For production, a custom build including only needed modules (BRepPrimAPI, BRepAlgoAPI, BRepOffsetAPI, BRepMesh, StlAPI, STEPControl, Geom, GC, gp) would reduce size significantly.

**Confidence note:** The exact initialization API (`initOpenCascade` with `locateFile`) and version (2.0-beta vs 1.1.1 stable) needs verification during implementation. The npm package shows 1.1.1 as latest stable, with 2.0.0-beta available. The 2.0 beta has modular WASM loading (choose which modules). Recommendation: start with the full build (simpler), optimize with custom build later.

### No-Bundler Loading Strategy

The project uses vanilla JS with no build tools. OpenCASCADE.js is designed for bundlers (Webpack/Vite) but can work without one.

**Approach:** Download the WASM + JS files from npm and serve them locally in `lib/opencascade/`. The Web Worker loads these files directly. No import map or bundler needed for the worker -- it uses importScripts() or dynamic import().

**Potential issue (MEDIUM confidence):** ES module imports in Web Workers (`type: 'module'`) are well-supported in modern browsers but OpenCASCADE.js's generated Emscripten code may use CommonJS patterns. If so, the worker may need to use `importScripts()` instead of ES module import. This needs testing during implementation.

**Fallback:** If vanilla loading proves problematic, a minimal Vite config for the worker bundle only (not the whole app) is acceptable. The main app stays vanilla.

## Multi-Part Mould Extension Points

The architecture must support v2 multi-part moulds without rewriting. Key extension points:

### Extension Point 1: Profile Annotations

Multi-part moulds require marking "seam lines" on the profile -- points where the plaster mould will be split vertically. The profile data model supports this:

```javascript
// v1 profile (no seam lines)
const profile = {
    points: [...],
    seamLines: [],  // Empty in v1, populated in v2
};

// v2 profile (with seam lines)
const profile = {
    points: [...],
    seamLines: [
        { y: 6.5, angle: 0 },   // Horizontal split at height 6.5cm
        { y: 6.5, angle: 90 },  // Second split perpendicular
    ],
};
```

**Build v1 so that:** `mouldBuilder.js` checks `seamLines.length` and branches between one-part and multi-part generation. The one-part path is v1. The multi-part path is v2. No existing code needs changing.

### Extension Point 2: Mould Part Registry

Instead of hardcoded "inner, outer, ring" parts, use a part registry:

```javascript
// Mould parts are returned as a named collection
const mouldParts = {
    proof: { shape: proofShape, color: 'terracotta', exportable: true },
    inner: { shape: innerShape, color: 'blue', exportable: true },
    outerHalf1: { shape: outerShape1, color: 'green', exportable: true },
    outerHalf2: { shape: outerShape2, color: 'green', exportable: true },
    ring: { shape: ringShape, color: 'yellow', exportable: true },
    // v2 would add:
    // plasterHalf1: { shape: ..., color: 'white', exportable: true },
    // plasterHalf2: { shape: ..., color: 'white', exportable: true },
};
```

**Build v1 so that:** The preview and export systems iterate over `mouldParts` entries rather than referencing parts by hardcoded name. Adding new part types in v2 requires no changes to preview or export code.

### Extension Point 3: Generation Strategy Pattern

```javascript
// mouldBuilder.js
function buildMould(profile, params) {
    if (profile.seamLines.length === 0) {
        return buildOnePartMould(profile, params);   // v1
    } else {
        return buildMultiPartMould(profile, params);  // v2
    }
}
```

## Build Order (Dependency Chain)

Components must be built in this order due to dependencies:

```
Phase 1: Profile Data Model + Basic Preview
    profileData.js (pure data, no dependencies)
    preview3d.js (Three.js, revolved LatheGeometry -- no OCCT yet)
    app.js skeleton (state, event wiring)
    -- Deliverable: User sees a 3D pot from parametric inputs using Three.js only

Phase 2: Profile Editor
    profileEditor.js (SVG canvas, handles, constraints)
    svgIO.js (import SVG files)
    -- Deliverable: User can draw/edit profiles, see them as 2D SVG

Phase 3: OpenCASCADE.js Integration
    lib/opencascade/ (WASM files, loading tested)
    geometryWorker.js (worker init, message routing)
    geometryBridge.js (Promise-based bridge)
    profileConverter.js (points -> OCCT Wire)
    tessellator.js (OCCT Shape -> mesh buffers)
    -- Deliverable: Profile is revolved via OCCT, tessellated, shown in Three.js

Phase 4: Mould Generation
    mouldBuilder.js (inner, outer, ring generation)
    -- Depends on: Phase 3 (OCCT integration working)
    -- Deliverable: All mould parts generated and visible in 3D

Phase 5: Export + Calculator
    fileExporter.js (STL/STEP via OCCT)
    plasterCalculator.js (volume/weight calculations)
    fileDownload.js (blob creation, download trigger)
    -- Depends on: Phase 4 (mould shapes exist to export)
    -- Deliverable: User can download mould files

Phase 6: Polish + Gating
    emailGate.js, supabaseClient.js, urlSharing.js
    Freemium logic, branding, responsive design
    -- Depends on: Phase 5 (core functionality complete)
```

**Critical path:** Phase 3 (OpenCASCADE.js integration) is the highest-risk phase. If WASM loading, worker communication, or OCCT operations prove problematic, this blocks everything downstream. Recommend a spike/prototype before committing to the full roadmap.

## Anti-Patterns to Avoid

### Anti-Pattern 1: OCCT on Main Thread

**What people do:** Load OpenCASCADE.js WASM directly on the main thread for simplicity.
**Why it is wrong:** 20-40MB WASM download + compilation blocks the UI for 3-10 seconds. Every geometry operation freezes the UI. Users see a blank/frozen page.
**Do this instead:** Always load OCCT in a Web Worker. Use the geometryBridge pattern for communication. Show a loading indicator during WASM init.

### Anti-Pattern 2: Leaking OCCT Objects

**What people do:** Create OCCT objects (`new oc.BRepPrimAPI_MakeRevol(...)`) without calling `.delete()` when done.
**Why it is wrong:** WASM memory is not garbage collected. Every un-deleted object permanently leaks memory. After generating ~20-50 moulds, the WASM heap runs out and the app crashes.
**Do this instead:** Use a cleanup pattern. Track all created objects and delete them after each operation. Consider a `withOCCT()` helper:

```javascript
// Helper to auto-cleanup OCCT objects
function withOCCT(fn) {
    const toDelete = [];
    const track = (obj) => { toDelete.push(obj); return obj; };
    try {
        return fn(track);
    } finally {
        for (const obj of toDelete) {
            if (obj && typeof obj.delete === 'function') {
                obj.delete();
            }
        }
    }
}

// Usage:
const resultShape = withOCCT((track) => {
    const ax = track(new oc.gp_Ax1_2(
        track(new oc.gp_Pnt_3(0, 0, 0)),
        track(new oc.gp_Dir_4(0, 1, 0))
    ));
    const revol = track(new oc.BRepPrimAPI_MakeRevol_1(face, ax, 2 * Math.PI, true));
    return revol.Shape(); // This shape is kept; everything else is deleted
});
```

### Anti-Pattern 3: Monolithic Worker Script

**What people do:** Put all OCCT logic in a single giant geometryWorker.js file.
**Why it is wrong:** Becomes unmaintainable. Profile conversion, mould building, tessellation, and file export are distinct concerns with distinct OCCT APIs.
**Do this instead:** Split into focused modules (profileConverter, mouldBuilder, tessellator, fileExporter) that are imported by the worker entry point. Each module owns a specific domain of OCCT operations.

### Anti-Pattern 4: SVG-to-OCCT String Parsing

**What people do:** Try to parse SVG path `d` attributes directly into OCCT geometry, handling all SVG path command variants (M, L, C, S, Q, T, A, Z, relative variants).
**Why it is wrong:** SVG path syntax is complex, with 20+ command types, implicit commands, relative coordinates, and shorthand forms. Building a robust parser is a project in itself.
**Do this instead:** Normalize SVGs at import time. Convert all SVG paths to a simplified internal representation (array of `{x, y, type, cp1, cp2}` points using only absolute coordinates and cubic beziers). The profile editor works with this simplified format. The OCCT profile converter only needs to handle two cases: line segments and cubic beziers.

### Anti-Pattern 5: Tight Coupling Between Preview and OCCT

**What people do:** Make the 3D preview depend directly on OCCT shapes, requiring WASM to be loaded before any preview is possible.
**Why it is wrong:** WASM takes 3-10 seconds to load. User sees nothing during that time. Also makes the preview module untestable without the full WASM stack.
**Do this instead:** Phase 1 preview uses Three.js LatheGeometry (fast, no WASM needed) from the profile points directly. Phase 3 upgrades to OCCT-tessellated meshes. The preview module accepts either format -- it just needs vertex/face buffers.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Supabase Auth | Existing emailGate.js pattern | Same as other Pottery Academy apps |
| Supabase Storage | Store generated files (optional) | Only if offering cloud save feature |
| Vercel Static Hosting | Direct file serving | WASM files served as static assets, correct MIME type needed |
| WASM Cache API | Service Worker caches WASM file | Prevents re-downloading 20-40MB on every visit |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Main thread <-> Worker | postMessage with Transferable ArrayBuffers | geometryBridge.js wraps this. All OCCT code stays in worker. |
| Profile Editor <-> App State | Custom events ('profile-changed') | Editor emits events, app.js listens and updates state |
| App State <-> Preview | Direct function calls (updateMeshes) | Same-thread, synchronous. Preview is passive -- receives data, doesn't fetch it. |
| App State <-> UI Controls | DOM events + updateDisplay() | Following existing Pottery Academy pattern |
| Profile Data <-> SVG IO | Pure function transforms | `svgToProfile(svgString)` and `profileToSvg(profile)` -- stateless |
| Profile Data <-> Worker | Serialized as plain JSON in postMessage | Profile data model is plain JS objects, no classes or methods |

## Performance Considerations

| Concern | Expected Impact | Mitigation |
|---------|----------------|------------|
| WASM initial load | 3-10s on first visit, <1s cached | Cache API / Service Worker; show loading indicator with progress |
| WASM memory | ~50-200MB for complex geometries | Manual cleanup with `delete()`; withOCCT pattern; monitor heap size |
| Tessellation time | 100-500ms per part | Debounce profile edits; staged generation (proof first, then parts) |
| Boolean operations | 200-2000ms for complex cuts | Run in worker (non-blocking); show progress indicator |
| Mesh transfer | <10ms with Transferable | Zero-copy buffer transfer via postMessage transfer list |
| Three.js rendering | 60fps for typical meshes (~50K-200K triangles) | Standard Three.js optimization; dispose old geometries |
| Profile editor | Must be 60fps (user dragging handles) | SVG-only, no OCCT involvement; debounce 3D regeneration |

## Sources

- [OpenCascade.js Official Site](https://ocjs.org/) - MEDIUM confidence (verified documentation structure exists, specific API calls based on training data)
- [OpenCascade.js GitHub Repository](https://github.com/donalffons/opencascade.js/) - MEDIUM confidence (verified repo exists, API patterns from training data + search)
- [OpenCascade.js Examples](https://donalffons.github.io/opencascade.js-examples/) - MEDIUM confidence (verified examples exist, specific code patterns from training data)
- [ShapeCast CHI Paper](https://inovo.studio/pubs/shapecast-chi24.pdf) - HIGH confidence (verified via multiple search results; pipeline details from search)
- [ShapeCast Molds](https://shapecastmolds.com/) - HIGH confidence (verified product, pipeline details from search results)
- [OpenCASCADE Modeling Algorithms Documentation](https://dev.opencascade.org/doc/overview/html/occt_user_guides__modeling_algos.html) - HIGH confidence (official OCCT docs)
- [BRepOffsetAPI_MakeOffset Class Reference](https://dev.opencascade.org/doc/refman/html/class_b_rep_offset_a_p_i___make_offset.html) - HIGH confidence (official OCCT API docs)
- [Replicad Library](https://replicad.xyz/docs/use-as-a-library/) - MEDIUM confidence (verified architecture pattern for OCCT-in-browser)
- [MDN Transferable Objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects) - HIGH confidence (official web platform docs)
- Existing Pottery Academy codebase (`pottery-template-pot/js/app.js`, `preview3d.js`, `calculator.js`) - HIGH confidence (directly observed)

### Confidence Notes

- **OpenCASCADE.js specific API calls** (constructor names like `BRepPrimAPI_MakeRevol_1`, `gp_Ax1_2` with suffix numbers): MEDIUM confidence. The suffix numbering convention (_1, _2, _3 etc.) for overloaded constructors is an Emscripten binding pattern that should hold, but exact constructor indices need verification during implementation.
- **WASM loading without bundler**: LOW-MEDIUM confidence. The documentation emphasizes bundler configuration. Vanilla loading is mentioned as possible but specifics are sparse. Needs a spike during Phase 3.
- **Memory cleanup with `.delete()`**: HIGH confidence. Standard Emscripten C++ binding pattern, consistent across all sources.
- **Custom WASM builds for size reduction**: MEDIUM confidence. Documented in v2.0 beta docs. May not be necessary for v1 if full build performance is acceptable.

---
*Architecture research for: Browser-based slip casting mould generator*
*Researched: 2026-02-10*
