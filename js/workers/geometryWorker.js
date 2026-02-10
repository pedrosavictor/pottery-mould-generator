/**
 * geometryWorker.js -- Production Web Worker for replicad/OpenCASCADE geometry operations.
 *
 * This worker loads the replicad CAD kernel (backed by OpenCASCADE WASM) and
 * processes geometry commands sent from the main thread via postMessage.
 *
 * LOADING PATTERN:
 * ----------------
 * Import maps do NOT work in Web Workers (known web platform limitation).
 * All imports use direct CDN URLs. The worker MUST be created with:
 *   new Worker('./js/workers/geometryWorker.js', { type: 'module' })
 *
 * If CDN loading fails (CORS, MIME, or bare-specifier issues), the URLs below
 * can be changed to self-hosted paths (e.g., '../wasm/replicad_single.js').
 *
 * WASM URL:
 * ---------
 * The replicad-opencascadejs WASM binary (~10.3 MB) is fetched via the
 * locateFile callback during initialization. Currently points to CDN.
 * For production on Vercel, consider self-hosting in /wasm/ for reliability.
 *
 * MEMORY MANAGEMENT:
 * ------------------
 * WASM heap memory is NOT garbage collected. Every replicad shape created via
 * revolve(), extrude(), cut(), fuse() etc. must be explicitly .delete()'d
 * after use to prevent memory leaks. Intermediate objects (sketches, drawings)
 * are consumed by operations and do not need manual deletion.
 *
 * The withCleanup() wrapper (from memoryTracker.js) guarantees that all
 * WASM objects are .delete()'d after each operation, even if an error occurs.
 * See memoryTracker.js for the pattern documentation.
 *
 * Cancellation is handled by the geometry bridge (main thread) using a
 * generation counter pattern -- stale results are discarded on receipt.
 * The worker itself always completes its current operation.
 */

import { withCleanup, getHeapSize } from './memoryTracker.js';

// ============================================================
// CDN URLs -- change to self-hosted paths if CDN fails
// ============================================================
const REPLICAD_CDN = 'https://cdn.jsdelivr.net/npm/replicad@0.20.5/dist/replicad.js';
const OPENCASCADE_CDN = 'https://cdn.jsdelivr.net/npm/replicad-opencascadejs@0.20.2/src/replicad_single.js';
const WASM_CDN = 'https://cdn.jsdelivr.net/npm/replicad-opencascadejs@0.20.2/src/replicad_single.wasm';

// ============================================================
// Dynamic imports (resolved at init time)
// ============================================================
let draw = null;
let setOC = null;
let opencascade = null;

// ============================================================
// Initialization state
// ============================================================
let loaded = false;
let initPromise = null;

/**
 * Initialize the WASM geometry engine.
 * Safe to call multiple times -- subsequent calls return the same promise.
 *
 * Posts progress messages to the main thread:
 *   { type: 'progress', stage: 'downloading', percent: 0 }
 *   { type: 'progress', stage: 'compiling', percent: 50 }
 *   { type: 'progress', stage: 'ready', percent: 100 }
 */
async function initialize() {
  if (loaded) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // Phase 1: Import JS modules from CDN
    self.postMessage({ type: 'progress', stage: 'downloading', percent: 0 });

    const [replicadModule, ocModule] = await Promise.all([
      import(REPLICAD_CDN),
      import(OPENCASCADE_CDN),
    ]);

    draw = replicadModule.draw;
    setOC = replicadModule.setOC;
    opencascade = ocModule.default || ocModule;

    // Phase 2: Initialize WASM (downloads and compiles ~10.3 MB binary)
    self.postMessage({ type: 'progress', stage: 'compiling', percent: 50 });

    const OC = await opencascade({
      locateFile: () => WASM_CDN,
    });

    // Phase 3: Inject OCCT into replicad
    setOC(OC);
    loaded = true;

    self.postMessage({ type: 'progress', stage: 'ready', percent: 100 });
  })();

  return initPromise;
}

// ============================================================
// Message handler -- routes commands from main thread
// ============================================================
self.onmessage = async (e) => {
  const { id, type, ...params } = e.data;

  try {
    switch (type) {
      case 'init': {
        await initialize();
        self.postMessage({ id, data: { ready: true } });
        break;
      }

      case 'revolve': {
        await initialize();
        const meshData = revolveProfile(params.profilePoints);
        // Transfer ArrayBuffers for zero-copy handoff to main thread.
        // After transfer, these buffers are detached from the worker.
        // This is fine because each revolve creates new buffers anyway.
        self.postMessage(
          { id, data: meshData },
          [
            meshData.vertices.buffer,
            meshData.normals.buffer,
            meshData.triangles.buffer,
          ]
        );
        break;
      }

      case 'heapSize': {
        // Return current WASM heap size for memory monitoring.
        // Returns null if WASM has not been initialized yet.
        self.postMessage({ id, data: { heapSize: getHeapSize() } });
        break;
      }

      case 'memoryTest': {
        // Run N revolve operations and report heap size after each.
        // This is for Phase 1 success criteria #3: proving no memory leaks.
        // The mesh data is intentionally NOT transferred (not needed for testing).
        await initialize();
        const iterations = params.iterations || 20;
        const results = [];
        for (let i = 0; i < iterations; i++) {
          revolveProfile(params.profilePoints);
          results.push({ iteration: i + 1, heapSize: getHeapSize() });
        }
        self.postMessage({ id, data: { results } });
        break;
      }

      default: {
        self.postMessage({
          id,
          error: `Unknown command: "${type}". Supported commands: init, revolve, heapSize, memoryTest`,
        });
      }
    }
  } catch (err) {
    self.postMessage({
      id,
      error: err.message || String(err),
    });
  }
};

// ============================================================
// revolveProfile -- core geometry operation
// ============================================================

/**
 * Revolve a 2D profile into a 3D solid and extract mesh data.
 *
 * The profile is an array of points representing the outer surface of a pot
 * as a half cross-section. Points go from the foot (bottom) to the rim (top).
 *
 *   x = distance from revolution axis (radius) in mm
 *   y = height from bottom in mm
 *
 * The profile is automatically closed back to the revolution axis:
 *   last point -> [0, lastY] -> [0, firstY] -> close
 *
 * This creates a solid shape when revolved 360 degrees around the Z axis
 * on the XZ plane.
 *
 * @param {Array<{x: number, y: number, type: string, cp1?: {x: number, y: number}, cp2?: {x: number, y: number}}>} points
 * @returns {{ vertices: Float32Array, normals: Float32Array, triangles: Uint32Array }}
 */
function revolveProfile(points) {
  if (!points || points.length < 2) {
    throw new Error('Profile must have at least 2 points');
  }

  return withCleanup((track) => {
    // Step 1: Build 2D drawing from profile points.
    // draw() takes the starting point as [x, y].
    let pen = draw([points[0].x, points[0].y]);

    for (let i = 1; i < points.length; i++) {
      const pt = points[i];
      if (pt.type === 'bezier' && pt.cp1 && pt.cp2) {
        // cubicBezierCurveTo(endPoint, startControlPoint, endControlPoint)
        // Each argument is [x, y].
        pen = pen.cubicBezierCurveTo(
          [pt.x, pt.y],
          [pt.cp1.x, pt.cp1.y],
          [pt.cp2.x, pt.cp2.y]
        );
      } else {
        // Default: straight line segment
        pen = pen.lineTo([pt.x, pt.y]);
      }
    }

    // Step 2: Close the profile back to the revolution axis.
    // Draw from the last profile point to the axis (x=0) at the same height,
    // then down the axis to the starting height, then close.
    const lastPoint = points[points.length - 1];
    const firstPoint = points[0];

    pen = pen.lineTo([0, lastPoint.y]);  // Horizontal line to axis at top
    pen = pen.lineTo([0, firstPoint.y]); // Vertical line down the axis

    const drawing = pen.close();

    // Step 3: Place drawing on XZ plane and revolve around Z axis.
    // sketchOnPlane("XZ") maps drawing X -> 3D X, drawing Y -> 3D Z.
    // revolve() defaults to 360-degree revolution around the Z axis.
    // This produces a solid of revolution symmetric around the Z axis,
    // which is what we want for pottery (axis = center of pot).
    const shape = track(drawing.sketchOnPlane('XZ').revolve());

    // Step 4: Extract mesh data for Three.js rendering.
    // tolerance: linear deflection (mm) -- lower = more triangles, smoother
    // angularTolerance: angular deflection (radians) -- lower = smoother curves
    const meshData = shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 });

    // Step 5: Convert mesh data to typed arrays.
    // Based on research, shape.mesh() returns plain JS arrays (number[]).
    // Float32Array for vertices/normals, Uint32Array for triangle indices.
    // These typed arrays enable Transferable zero-copy postMessage transfer.
    const vertices = new Float32Array(meshData.vertices);
    const normals = new Float32Array(meshData.normals);
    const triangles = new Uint32Array(meshData.triangles);

    // Step 6: WASM memory is freed automatically by withCleanup.
    // The track(shape) call above registered the shape for cleanup.
    // shape.delete() will be called in the finally block of withCleanup,
    // releasing the OCCT BRep shape from the WASM heap.
    // Intermediate objects (pen, drawing, sketch) are consumed by
    // their downstream operations and do not need manual deletion.

    return { vertices, normals, triangles };
  });
}

// ============================================================
// Start initialization immediately on worker load.
// Don't wait for the first message -- begin downloading WASM now.
// By the time the main thread sends 'init', WASM may already be ready.
// ============================================================
initialize();
