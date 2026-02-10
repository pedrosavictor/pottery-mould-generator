# Phase 1: WASM Foundation - Research

**Researched:** 2026-02-10
**Domain:** replicad/OpenCASCADE.js WASM in Web Worker, revolution geometry, mesh extraction, Three.js visualization
**Confidence:** MEDIUM (core APIs verified from official docs and source code; CDN loading without bundler is LOW confidence and needs spike validation)

## Summary

This research addresses the seven technical questions needed to plan Phase 1: loading replicad in a Web Worker from CDN, the revolution API, mesh extraction for Three.js, WASM memory management, worker communication patterns, Three.js rendering of extracted mesh data, and gotchas with CDN/WASM/CORS.

The standard approach is: load `replicad-opencascadejs` WASM in a Web Worker, initialize with `setOC()`, use replicad's `draw()` -> `sketchOnPlane()` -> `revolve()` pipeline to create 3D solids, extract mesh data via `shape.mesh()` and `shape.meshEdges()`, transfer typed arrays to main thread via postMessage Transferable, and render with Three.js BufferGeometry. Memory management requires explicit tracking since WASM heap does not garbage collect -- use a `withCleanup()` pattern wrapping every generation cycle.

The critical risk is that replicad is designed for bundled environments (Vite/Webpack). Loading from CDN without a bundler has never been documented by the replicad project. The WASM loading pattern uses `locateFile` to resolve the `.wasm` URL, which should work with direct CDN URLs, but import maps do NOT apply inside Web Workers. This means the worker must use direct URL imports, not bare specifiers. Plan 01-01 (the spike) must validate this before any further work.

**Primary recommendation:** Self-host the WASM binary (`replicad_single.wasm`, 10.3 MB) alongside the app. Use direct CDN URLs for the JS modules inside the worker. If direct ESM imports fail in the worker, fall back to `importScripts()` with UMD-compatible builds or use esm.sh as a CDN that resolves module dependencies.

## Standard Stack

The established libraries/tools for this phase:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| replicad | 0.20.5 | CAD kernel abstraction (draw, sketch, revolve, boolean, mesh, export) | Wraps raw OpenCASCADE.js with chainable JS API. `draw().lineTo().close().sketchOnPlane().revolve()` vs raw numbered overloads. Active maintenance (published ~1 month ago). |
| replicad-opencascadejs | 0.20.2 | Custom WASM build of OpenCASCADE for replicad | Pre-built WASM with only needed OCCT modules. `replicad_single.wasm` is 10.3 MB (vs full OCCT ~45 MB). Matched to replicad version. |
| Three.js | 0.172.0 | 3D mesh visualization, orbit controls | Industry standard. Already in Pottery Academy suite. Renders BufferGeometry from vertex/normal arrays. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| replicad-threejs-helper | 0.15.x | Sync replicad mesh data to Three.js BufferGeometry | Optional -- provides `syncFaces()` and `syncLines()` helpers. Could use directly if CDN loading works, otherwise replicate the ~50 lines of logic manually. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| replicad 0.20.5 | raw opencascade.js 2.0-beta | 5-10x more code, numbered method overloads (`BRepBuilderAPI_MakeEdge_8`), no mesh helpers, no STL/STEP helpers. Only use if replicad CDN loading completely fails. |
| replicad-opencascadejs (custom build) | Full opencascade.js WASM | 45 MB vs 10.3 MB. Slower load, unnecessary modules. Only use if custom build has missing features. |
| Self-hosted WASM | CDN-only WASM | CDN serving of .wasm requires correct MIME type (application/wasm). jsDelivr serves it correctly, but self-hosting on Vercel guarantees control. Recommend self-hosting. |

### CDN URLs (verified available on jsDelivr)
```
replicad JS:                https://cdn.jsdelivr.net/npm/replicad@0.20.5/dist/replicad.js              (ESM, ~100-200KB)
replicad-opencascadejs JS:  https://cdn.jsdelivr.net/npm/replicad-opencascadejs@0.20.2/src/replicad_single.js   (132 KB)
replicad-opencascadejs WASM: https://cdn.jsdelivr.net/npm/replicad-opencascadejs@0.20.2/src/replicad_single.wasm (10.3 MB)
Three.js:                   https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.module.js            (~170KB)
Three.js OrbitControls:     https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/controls/OrbitControls.js
replicad-threejs-helper:    https://cdn.jsdelivr.net/npm/replicad-threejs-helper@0.15.2/dist/replicad-threejs-helper.js
```

**There is also a "with exceptions" build:**
```
replicad_with_exceptions.js:   256 KB
replicad_with_exceptions.wasm: 18.29 MB
```
Use `replicad_single` for production (smaller). Use `replicad_with_exceptions` during development if you need better error messages from OCCT operations.

## Architecture Patterns

### Recommended Project Structure (Phase 1 only)
```
pottery-mould-generator/
  index.html                    # Test harness for Phase 1
  css/
    style.css
  js/
    app.js                      # Main thread: orchestrator, UI wiring
    geometryBridge.js           # Promise-based wrapper for worker communication
    preview3d.js                # Three.js scene, camera, lighting, orbit controls
    profileData.js              # Profile data model (points array with seamLines extension)
    workers/
      geometryWorker.js         # Web Worker: loads WASM, routes commands
  wasm/
    replicad_single.js          # Self-hosted copy from replicad-opencascadejs
    replicad_single.wasm        # Self-hosted WASM binary (10.3 MB)
```

### Pattern 1: Worker WASM Initialization (from replicad sample app)
**What:** Load replicad-opencascadejs WASM inside a Web Worker, call `setOC()` to inject it into replicad.
**When to use:** Worker startup (once per page load).
**Source:** Verified from replicad-app-example/src/worker.js on GitHub.

```javascript
// geometryWorker.js (inside Web Worker)
// CRITICAL: import maps do NOT work in Web Workers.
// Must use direct URLs or self-hosted paths.
import opencascade from '../wasm/replicad_single.js';
import { setOC, draw } from 'https://cdn.jsdelivr.net/npm/replicad@0.20.5/dist/replicad.js';

const WASM_URL = new URL('../wasm/replicad_single.wasm', import.meta.url).href;

let loaded = false;
const init = async () => {
  if (loaded) return true;
  const OC = await opencascade({
    locateFile: () => WASM_URL,
  });
  loaded = true;
  setOC(OC);
  return true;
};

const started = init();

self.onmessage = async (e) => {
  await started; // Ensure WASM is loaded before processing
  const { id, type, ...params } = e.data;
  // ... route commands
};
```

**Key insight:** The `locateFile` callback tells Emscripten where to fetch the `.wasm` binary. By passing the direct URL (self-hosted or CDN), you bypass the bundler's file resolution. The worker MUST be created with `{ type: 'module' }` for ESM imports to work.

### Pattern 2: Promise-Based Worker Bridge
**What:** Wrap postMessage/onmessage in Promises with request IDs.
**When to use:** Every main-thread call to geometry worker.

```javascript
// geometryBridge.js (main thread)
let worker = null;
const pending = new Map();
let nextId = 0;

export function init() {
  worker = new Worker('./js/workers/geometryWorker.js', { type: 'module' });
  worker.onmessage = (e) => {
    const { id, error, data } = e.data;
    const resolver = pending.get(id);
    if (!resolver) return;
    pending.delete(id);
    if (error) resolver.reject(new Error(error));
    else resolver.resolve(data);
  };
  return sendCommand('init');
}

function sendCommand(type, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, ...params });
  });
}

export function revolveProfile(profilePoints) {
  return sendCommand('revolve', { profilePoints });
}
```

### Pattern 3: Transferable Buffer Handoff
**What:** Zero-copy transfer of mesh ArrayBuffers from worker to main thread.
**When to use:** Every mesh result sent from worker.

```javascript
// In worker, after meshing:
const meshData = shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 });
const edgeData = shape.meshEdges({ tolerance: 0.1, angularTolerance: 0.3 });

// meshData has: { vertices: number[], normals: number[], triangles: number[], faceGroups: object[] }
// Convert to typed arrays for transfer
const vertices = new Float32Array(meshData.vertices);
const normals = new Float32Array(meshData.normals);
const triangles = new Uint32Array(meshData.triangles);

self.postMessage(
  { id, type: 'result', data: { vertices, normals, triangles } },
  [vertices.buffer, normals.buffer, triangles.buffer]  // Transfer list
);
```

### Pattern 4: Debounced Generation with Latest-Wins Cancellation
**What:** When profile changes rapidly (dragging), only process the latest request.
**When to use:** Phase 4 (Live Preview), but architecture must support it from Phase 1.

```javascript
// geometryBridge.js addition
let currentGenerationId = 0;

export async function generateWithCancellation(profilePoints) {
  const myId = ++currentGenerationId;
  const result = await revolveProfile(profilePoints);
  if (myId !== currentGenerationId) {
    return null; // Stale result, discard
  }
  return result;
}
```

### Anti-Patterns to Avoid
- **Import maps in workers:** Import maps defined in the HTML `<script type="importmap">` do NOT apply inside Web Workers. Workers must use full URLs for imports.
- **Blocking init on main thread:** Never `await` WASM initialization on the main thread. Always do it in the worker.
- **Comlink dependency:** The replicad sample app uses Comlink for worker communication. Do NOT add this dependency -- the Promise bridge pattern (Pattern 2) achieves the same result with zero dependencies and is simpler to debug.
- **React dependency:** The replicad sample app uses React Three Fiber. Do NOT use React. Use vanilla Three.js directly, matching the Pottery Academy pattern.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WASM initialization + locateFile | Custom Emscripten loader | `replicad-opencascadejs` init pattern with `locateFile` callback | Emscripten module initialization has many edge cases (memory growth, streaming compile). The provided JS wrapper handles them. |
| Shape tessellation | Manual face/triangle extraction from OCCT topology | `shape.mesh({ tolerance, angularTolerance })` | replicad wraps `BRepMesh_IncrementalMesh` + face traversal + normal computation. Doing this manually requires ~200 lines of OCCT topology walking. |
| Three.js BufferGeometry sync | Manual attribute update logic | `syncFaces()` from replicad-threejs-helper OR the ~30 lines of direct BufferGeometry construction | The helper handles face groups, edge highlighting, and proper disposal. If CDN loading of the helper fails, the manual approach is straightforward. |
| Worker message routing | Raw postMessage/onmessage with switch statements | Promise bridge with request IDs (Pattern 2) | Raw messaging leads to callback spaghetti. The bridge pattern gives clean async/await API. |
| OCCT memory cleanup | Ad-hoc `.delete()` calls scattered everywhere | `withCleanup()` wrapper pattern (see Memory Management section) | Missing even one `.delete()` causes permanent memory leak. The wrapper pattern makes forgetting impossible. |

**Key insight:** replicad's entire purpose is to prevent hand-rolling OCCT operations. Use its API for everything geometry-related. Only drop to raw OCCT if replicad lacks a needed operation.

## Common Pitfalls

### Pitfall 1: Import Maps Don't Work in Web Workers
**What goes wrong:** Developer defines import map in HTML, creates worker with `{ type: 'module' }`, uses bare import specifiers (`import { draw } from 'replicad'`). Worker fails to load with "Failed to resolve module specifier" error.
**Why it happens:** Import maps are scoped to the document context. Workers have no document. This is a known web platform limitation with no standard resolution as of 2026.
**How to avoid:** Use full URLs in worker imports: `import { draw } from 'https://cdn.jsdelivr.net/npm/replicad@0.20.5/dist/replicad.js'`. Or self-host and use relative paths: `import { draw } from '../lib/replicad.js'`.
**Warning signs:** Module resolution errors in console only when code runs in worker, works fine in main thread.
**Confidence:** HIGH -- verified via MDN Web Docs and WICG/import-maps#2.

### Pitfall 2: WASM Memory Never Shrinks (Only Reuses)
**What goes wrong:** After 20 revolve operations, developer checks WASM heap size and sees it grew from initial allocation. They think there is a leak. Actually, WASM heap memory, once allocated, is never returned to the OS -- it is only marked available for reuse by future allocations.
**Why it happens:** This is how WASM linear memory works by design. `shape.delete()` frees memory within the WASM heap but does not shrink the heap.
**How to avoid:** Monitor WASM heap for *continuous growth* (new allocations that never get reused), not absolute size. After the first generation cycle, the heap should stabilize. If it keeps growing across cycles, there is a real leak.
**Warning signs:** Heap growing linearly with each operation, never plateauing.
**Verification approach:** Run 20 consecutive revolve operations. Heap after operation 20 should be approximately the same as after operation 2 (operation 1 establishes the baseline allocation).
**Confidence:** HIGH -- verified via opencascade.js discussions and WASM specification.

### Pitfall 3: replicad Operations Delete Input Sketches
**What goes wrong:** Developer creates a sketch, calls `.revolve()`, then tries to use the same sketch again. The sketch is null/deleted.
**Why it happens:** The replicad API docs state "all operations will delete the sketch" after execution. Sketches are consumed by operations like `revolve()`, `extrude()`, `loftWith()`.
**How to avoid:** If you need the same sketch for multiple operations, `clone()` it before the operation. Or recreate the sketch (cheap operation).
**Warning signs:** "Cannot read property of null" errors after calling revolve/extrude on a sketch.
**Confidence:** HIGH -- verified from replicad Sketch class API documentation.

### Pitfall 4: Worker type:module Browser Compatibility
**What goes wrong:** Worker with `{ type: 'module' }` fails in older browsers or Firefox versions.
**Why it happens:** Module workers have been supported in Chrome/Edge since 2019 and Safari since 2023. Firefox added support later.
**How to avoid:** Target modern browsers only (Chrome 80+, Safari 15+, Firefox 114+). Add a capability check at startup and show a "please update your browser" message for unsupported browsers. For Phase 1, this is acceptable -- pottery apps are a niche audience on modern browsers.
**Warning signs:** Worker creation throws "SyntaxError: import declarations may only appear at top level of a module."
**Confidence:** HIGH -- verified via web.dev and Can I Use data.

### Pitfall 5: CORS Issues with CDN-served WASM
**What goes wrong:** WASM fetch from CDN fails with CORS error, or WASM streaming compilation fails because response type is not `application/wasm`.
**Why it happens:** `WebAssembly.compileStreaming()` (used by Emscripten) requires the response to have MIME type `application/wasm`. Some CDNs serve `.wasm` as `application/octet-stream`.
**How to avoid:** jsDelivr serves `.wasm` with correct MIME type. But self-hosting on Vercel is safer -- add `wasm` MIME type to `vercel.json`. If CORS is an issue, self-host the WASM file on same origin.
**Warning signs:** Console error: "Incorrect response MIME type. Expected 'application/wasm'." or CORS errors.
**Confidence:** MEDIUM -- jsDelivr WASM serving verified via community reports (jsdelivr#18561), but CDN behavior can change.

## Code Examples

### Complete Revolution Pipeline (Profile Points to Mesh)

This is the core operation for Phase 1 -- verified from replicad docs and sample app.

```javascript
// Inside Web Worker after WASM initialization

import { draw, setOC } from 'replicad'; // or direct URL

/**
 * Revolve a profile (array of 2D points) into a 3D solid.
 * Profile points are [{x, y}] representing the half cross-section.
 * x = distance from revolution axis (radius), y = height.
 * Profile is drawn on XZ plane and revolved around Z axis.
 *
 * @param {Array<{x: number, y: number, type: string, cp1?: {x,y}, cp2?: {x,y}}>} points
 * @returns {{ vertices: Float32Array, normals: Float32Array, triangles: Uint32Array }}
 */
function revolveProfile(points) {
  // Step 1: Build 2D drawing from profile points
  let pen = draw([points[0].x, points[0].y]);

  for (let i = 1; i < points.length; i++) {
    const pt = points[i];
    if (pt.type === 'bezier' && pt.cp1 && pt.cp2) {
      // cubicBezierCurveTo(end, startControlPoint, endControlPoint)
      pen = pen.cubicBezierCurveTo(
        [pt.x, pt.y],
        [pt.cp1.x, pt.cp1.y],
        [pt.cp2.x, pt.cp2.y]
      );
    } else {
      pen = pen.lineTo([pt.x, pt.y]);
    }
  }

  // Close the profile back to the axis (x=0) and down to start
  pen = pen.lineTo([0, points[points.length - 1].y]); // horizontal to axis
  pen = pen.lineTo([0, points[0].y]);                  // down the axis
  const drawing = pen.close();

  // Step 2: Place on XZ plane and revolve around Z axis
  // sketchOnPlane("XZ") places the drawing in 3D space
  // revolve() defaults to full 360-degree revolution around Z axis
  const shape = drawing.sketchOnPlane("XZ").revolve();

  // Step 3: Extract mesh data for Three.js
  const meshData = shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 });
  const edgeData = shape.meshEdges({ tolerance: 0.1, angularTolerance: 0.3 });

  // Step 4: Clean up the OCCT shape to prevent memory leak
  shape.delete();

  return {
    vertices: new Float32Array(meshData.vertices),
    normals: new Float32Array(meshData.normals),
    triangles: new Uint32Array(meshData.triangles),
    faceGroups: meshData.faceGroups,
    edges: edgeData,
  };
}
```

**Source:** Reconstructed from replicad DrawingPen API docs, Sketch.revolve() API docs, and the replicad-app-example worker.js pattern.
**Confidence:** MEDIUM -- the individual API calls are verified, but the exact closing/axis logic for a pottery profile needs spike validation.

### Three.js Rendering of Mesh Data (Main Thread)

```javascript
// preview3d.js (main thread)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let scene, camera, renderer, controls;
let currentMesh = null;

export function initScene(container) {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f0eb); // cream

  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.position.set(0, 100, 200);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(100, 200, 100);
  scene.add(dirLight);

  animate();
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

export function updateMesh(meshData) {
  // Remove old mesh
  if (currentMesh) {
    currentMesh.geometry.dispose();
    scene.remove(currentMesh);
  }

  const { vertices, normals, triangles } = meshData;
  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(triangles, 1));

  const material = new THREE.MeshStandardMaterial({
    color: 0x5a8296,
    polygonOffset: true,
    polygonOffsetFactor: 2.0,
    polygonOffsetUnits: 1.0,
  });

  currentMesh = new THREE.Mesh(geometry, material);
  scene.add(currentMesh);
}
```

**Source:** Standard Three.js BufferGeometry pattern + material settings from replicad-app-example ReplicadMesh.jsx.
**Confidence:** HIGH -- Three.js BufferGeometry is well-documented and the pattern is standard.

### Profile Data Model with v2 Extension Points

```javascript
// profileData.js
/**
 * Profile data model for a pot cross-section.
 * This is the canonical representation that flows through the entire system.
 *
 * x = distance from revolution axis (radius) in mm
 * y = height from bottom in mm
 * Profile represents the OUTER surface of the pot (half cross-section).
 */
export function createProfile(points = []) {
  return {
    points,       // Array<{ x: number, y: number, type: 'line'|'bezier', cp1?: Point, cp2?: Point }>
    seamLines: [], // v2 extension: Array<{ y: number, angle: number }> -- empty in v1
    units: 'mm',
    version: 1,
  };
}

// Hardcoded test profile for Phase 1 validation: a simple cup shape
export function getTestProfile() {
  return createProfile([
    { x: 30, y: 0, type: 'line' },        // foot bottom-right (30mm radius)
    { x: 30, y: 3, type: 'line' },         // foot top
    { x: 25, y: 5, type: 'line' },         // foot-to-body transition
    { x: 35, y: 50, type: 'bezier',        // body curve (belly)
      cp1: { x: 22, y: 20 },
      cp2: { x: 30, y: 40 } },
    { x: 40, y: 80, type: 'bezier',        // body to rim
      cp1: { x: 38, y: 55 },
      cp2: { x: 40, y: 70 } },
    { x: 42, y: 85, type: 'line' },        // rim
  ]);
}
```

### Memory Management Pattern

```javascript
// memoryTracker.js (used inside worker)

/**
 * Track replicad/OCCT objects and ensure cleanup.
 * Use this wrapper around every generation cycle.
 *
 * replicad shapes have a .delete() method that frees WASM memory.
 * JavaScript GC does NOT trigger WASM destructors.
 */
export function withCleanup(fn) {
  const tracked = [];
  const track = (obj) => {
    tracked.push(obj);
    return obj;
  };
  try {
    return fn(track);
  } finally {
    for (const obj of tracked) {
      try {
        if (obj && typeof obj.delete === 'function') {
          obj.delete();
        }
      } catch (e) {
        // Silently ignore -- object may already be deleted
      }
    }
  }
}

// Usage in revolve operation:
function safeRevolve(profilePoints) {
  return withCleanup((track) => {
    // Build drawing (consumed by sketchOnPlane, no tracking needed)
    let pen = draw([profilePoints[0].x, profilePoints[0].y]);
    // ... build pen ...
    const drawing = pen.close();

    // Sketch is consumed by revolve (auto-deleted per replicad docs)
    const sketch = drawing.sketchOnPlane("XZ");

    // Shape must be tracked for cleanup
    const shape = track(sketch.revolve());

    // Extract mesh data BEFORE shape is deleted in finally block
    const meshData = shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 });

    // meshData is plain JS -- survives shape deletion
    return {
      vertices: new Float32Array(meshData.vertices),
      normals: new Float32Array(meshData.normals),
      triangles: new Uint32Array(meshData.triangles),
    };
  });
  // shape.delete() called automatically in finally block
}
```

**Confidence:** HIGH for the pattern. The specific behavior of replicad's `.delete()` on shapes produced by `.revolve()` needs spike validation. The opencascade.js maintainer confirmed `.delete()` is necessary for all OCCT objects. replicad shapes wrap OCCT objects and expose `.delete()`.

### Worker Initialization with Progress Reporting

```javascript
// geometryWorker.js - Complete worker entry point

// Direct URLs (import maps don't work in workers)
import opencascade from '../wasm/replicad_single.js';
import { setOC, draw } from 'https://cdn.jsdelivr.net/npm/replicad@0.20.5/dist/replicad.js';

const WASM_URL = new URL('../wasm/replicad_single.wasm', import.meta.url).href;

let loaded = false;
let initPromise = null;

async function initialize() {
  if (loaded) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    self.postMessage({ type: 'progress', stage: 'downloading', percent: 0 });

    const OC = await opencascade({
      locateFile: () => WASM_URL,
    });

    self.postMessage({ type: 'progress', stage: 'ready', percent: 100 });
    loaded = true;
    setOC(OC);
  })();

  return initPromise;
}

self.onmessage = async (e) => {
  const { id, type, ...params } = e.data;

  try {
    if (type === 'init') {
      await initialize();
      self.postMessage({ id, data: { ready: true } });
      return;
    }

    // Ensure initialized for all other commands
    await initialize();

    switch (type) {
      case 'revolve': {
        const meshData = revolveProfile(params.profilePoints);
        self.postMessage(
          { id, data: meshData },
          [meshData.vertices.buffer, meshData.normals.buffer, meshData.triangles.buffer]
        );
        break;
      }
      default:
        self.postMessage({ id, error: `Unknown command: ${type}` });
    }
  } catch (err) {
    self.postMessage({ id, error: err.message || String(err) });
  }
};

// Start initialization immediately (don't wait for first message)
initialize();
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| opencascade.js v1.1.1 with raw C++ bindings | replicad 0.20.x wrapping opencascade.js 2.0-beta custom build | 2023-2024 | 5-10x less code, chainable API, built-in mesh/export helpers |
| Full OCCT WASM (~45 MB) | Custom builds with only needed modules (10.3 MB) | replicad-opencascadejs 0.20.x | ~4x smaller WASM, faster load |
| importScripts() in workers | ESM module workers `{ type: 'module' }` | Chrome 80 (2020), Firefox 114 (2023), Safari 15 (2022) | Clean import syntax in workers, tree-shaking possible |
| Copying ArrayBuffers between threads | Transferable ArrayBuffers | Supported since 2012 but often overlooked | Zero-copy transfer of mesh data, critical for large meshes |

**Deprecated/outdated:**
- opencascade.js v1.1.1 stable: 5+ years old, proven CDN-friendly but raw API unusable at scale. Do not use.
- `importScripts()` for module loading: Still works but prevents ES module benefits. Use only as fallback.
- Comlink for worker communication: Adds dependency, obscures debugging. Use direct postMessage with Promise bridge.

## Open Questions

Things that could not be fully resolved through documentation alone:

1. **Does replicad's ESM bundle work as a direct import in a module worker without a bundler?**
   - What we know: The replicad dist/replicad.js is a valid ESM module. Module workers support `import` statements.
   - What's unclear: Whether replicad.js has internal imports that assume a bundler (e.g., bare specifiers to opencascade internals). It may import from `replicad-opencascadejs` as a bare specifier internally.
   - Recommendation: The spike (Plan 01-01) must test this. If bare specifiers exist, options are: (a) use esm.sh CDN which resolves dependencies, (b) bundle just the worker with a minimal Vite config, (c) self-host a pre-built worker bundle.

2. **What is the exact structure of `shape.mesh()` return value?**
   - What we know: Returns `ShapeMesh` type with `vertices`, `normals`, `triangles`, and `faceGroups` properties. These are used by replicad-threejs-helper's `syncFaces()`.
   - What's unclear: Whether `vertices` and `normals` are `number[]` (JS arrays) or `Float32Array`. The replicad TypeScript types show the interface but the exact runtime type was not found in documentation.
   - Recommendation: The spike should log `typeof meshData.vertices` and `Array.isArray(meshData.vertices)` to determine. If JS arrays, convert to typed arrays for Transferable.

3. **Does `shape.delete()` on a revolved shape properly free all intermediate OCCT objects?**
   - What we know: replicad wraps OCCT shapes. The `.delete()` method exists on all replicad shape classes. OCCT objects created during revolution (wires, edges, faces) may or may not be freed by deleting the final shape.
   - What's unclear: Whether intermediate OCCT objects (created during `draw().close().sketchOnPlane().revolve()`) are tracked by replicad and freed when the final shape is deleted, or whether they leak.
   - Recommendation: The spike's memory test (20 consecutive revolves, check heap) will answer this empirically. If heap grows, add explicit cleanup of intermediate objects.

4. **Revolve axis specification for pottery profiles**
   - What we know: `sketch.revolve()` defaults to revolving around Z axis. The `revolutionAxis` parameter accepts a Point direction.
   - What's unclear: Whether the default Z-axis revolve works correctly for a profile drawn on the XZ plane (where X=radius, Z=height). The profile's leftmost edge (x=0) should be the revolution axis.
   - Recommendation: The spike must validate axis orientation. If the default revolve axis is wrong, try `sketch.revolve([0, 0, 1])` explicitly, or adjust the sketch plane.

5. **replicad-opencascadejs JS module format**
   - What we know: The `replicad_single.js` file is the Emscripten-generated wrapper. It needs `locateFile` to find the `.wasm` file.
   - What's unclear: Whether this JS file is a true ESM module (with `export default`) or a CommonJS/IIFE that needs `importScripts()`. The file is 132 KB on jsDelivr.
   - Recommendation: Fetch the first few lines in the spike to check module format. If not ESM, use `importScripts()` and access the global.

## Sources

### Primary (HIGH confidence)
- [replicad "use as a library" docs](https://replicad.xyz/docs/use-as-a-library/) -- initialization pattern with `setOC()`
- [replicad DrawingPen API](https://replicad.xyz/docs/api/classes/DrawingPen) -- complete drawing methods (lineTo, cubicBezierCurveTo, close, etc.)
- [replicad Sketch.revolve() API](https://replicad.xyz/docs/api/classes/Sketch) -- revolve method signature and parameters
- [replicad CompSolid API](https://replicad.xyz/docs/api/classes/CompSolid) -- mesh(), meshEdges(), blobSTL(), delete(), cut(), fuse(), fillet()
- [replicad-app-example worker.js](https://github.com/sgenoud/replicad/blob/main/packages/replicad-app-example/src/worker.js) -- verified worker initialization pattern
- [replicad-app-example ReplicadMesh.jsx](https://github.com/sgenoud/replicad/blob/main/packages/replicad-app-example/src/ReplicadMesh.jsx) -- Three.js rendering with syncFaces/syncLines
- [replicad-opencascadejs files on jsDelivr](https://cdn.jsdelivr.net/npm/replicad-opencascadejs@0.20.2/src/) -- verified: replicad_single.wasm (10.3 MB), replicad_single.js (132 KB)
- [opencascade.js Discussion #186](https://github.com/donalffons/opencascade.js/discussions/186) -- memory management: `.delete()` required, examples leak by design
- [replicad Adding Depth tutorial](https://replicad.xyz/docs/tutorial-overview/adding-depth/) -- revolve example code
- [replicad OCCT Bottle example](https://replicad.xyz/docs/examples/occt-bottle/) -- complete draw/extrude/fuse/shell example

### Secondary (MEDIUM confidence)
- [MDN Import Maps](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap) -- import maps don't apply to workers
- [WICG/import-maps#2](https://github.com/WICG/import-maps/issues/2) -- open question about worker import maps
- [Emscripten locateFile docs](https://emscripten.org/docs/api_reference/module.html) -- locateFile callback for WASM URL resolution
- [replicad Discussion #28](https://github.com/sgenoud/replicad/discussions/28) -- community quick reference, mesh/revolve notes
- [replicad Discussion #68](https://github.com/sgenoud/replicad/discussions/68) -- sample app setup, React not mandatory
- [raydeleu/ReplicadManual](https://github.com/raydeleu/ReplicadManual) -- community manual with API organization

### Tertiary (LOW confidence)
- Exact `ShapeMesh` return type structure -- not found in docs, inferred from usage in replicad-threejs-helper
- Whether replicad.js ESM bundle has internal bare specifier imports -- not verified, needs spike testing
- Whether `replicad_single.js` is ESM or CommonJS -- not verified from docs, needs inspection

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- replicad + replicad-opencascadejs versions verified on npm/jsDelivr, Three.js well-known
- Architecture (worker pattern): HIGH -- verified from replicad sample app source code
- CDN loading without bundler: LOW -- no documentation exists for this pattern, needs spike validation
- Revolution API: MEDIUM -- API signatures verified, exact axis behavior for pottery profiles needs spike
- Mesh extraction: MEDIUM -- mesh() method exists and returns data, exact typed array format unclear
- Memory management: HIGH -- .delete() pattern well-documented across opencascade.js ecosystem
- Pitfalls: HIGH -- verified from GitHub issues, official docs, and web platform specs

**Research date:** 2026-02-10
**Valid until:** 2026-03-10 (30 days -- replicad is actively maintained, minor version bumps possible)
