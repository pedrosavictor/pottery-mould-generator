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
let FaceFinder = null;
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
    FaceFinder = replicadModule.FaceFinder;
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

      case 'generateMould': {
        await initialize();
        const partsData = generateMouldParts(params.profilePoints, params.mouldParams);

        // Collect all ArrayBuffers for Transferable zero-copy handoff
        const transferList = [];
        for (const partName of Object.keys(partsData)) {
          const part = partsData[partName];
          transferList.push(part.vertices.buffer, part.normals.buffer, part.triangles.buffer);
        }

        self.postMessage({ id, data: partsData }, transferList);
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
          error: `Unknown command: "${type}". Supported commands: init, revolve, generateMould, heapSize, memoryTest`,
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
// Geometry Helpers
// ============================================================

/**
 * Scale profile points to compensate for clay shrinkage.
 *
 * Pottery clay shrinks during drying and firing. The mould must be larger
 * than the desired finished size so the fired pot matches the design.
 *
 * Formula: wet_size = fired_size / (1 - shrinkage_rate)
 * For 13% shrinkage: 1 / 0.87 = 1.1494 (mould is ~15% larger)
 *
 * @param {Array<{x: number, y: number, type: string, cp1?: {x: number, y: number}, cp2?: {x: number, y: number}}>} points
 * @param {number} shrinkageRate - Shrinkage fraction (e.g., 0.13 for 13%).
 * @returns {Array} New points array with all coordinates scaled.
 */
function scaleProfileForShrinkage(points, shrinkageRate) {
  const scaleFactor = 1 / (1 - shrinkageRate);
  return points.map((pt) => {
    const scaled = {
      x: pt.x * scaleFactor,
      y: pt.y * scaleFactor,
      type: pt.type,
    };
    if (pt.cp1) {
      scaled.cp1 = { x: pt.cp1.x * scaleFactor, y: pt.cp1.y * scaleFactor };
    }
    if (pt.cp2) {
      scaled.cp2 = { x: pt.cp2.x * scaleFactor, y: pt.cp2.y * scaleFactor };
    }
    return scaled;
  });
}

/**
 * Build a 2D drawing from profile points and revolve into a 3D solid.
 *
 * The profile is closed back to the revolution axis (x=0) and revolved
 * 360 degrees on the XZ plane around the Z axis.
 *
 * IMPORTANT: The returned shape is a WASM object that must be .delete()'d.
 * The caller must pass it to track() when using withCleanup().
 *
 * @param {Array<{x: number, y: number, type: string, cp1?: {x: number, y: number}, cp2?: {x: number, y: number}}>} points
 * @returns {Object} The revolved replicad shape (caller must track for cleanup).
 */
function buildAndRevolve(points) {
  // Build 2D drawing from profile points.
  let pen = draw([points[0].x, points[0].y]);

  for (let i = 1; i < points.length; i++) {
    const pt = points[i];
    if (pt.type === 'bezier' && pt.cp1 && pt.cp2) {
      pen = pen.cubicBezierCurveTo(
        [pt.x, pt.y],
        [pt.cp1.x, pt.cp1.y],
        [pt.cp2.x, pt.cp2.y]
      );
    } else {
      pen = pen.lineTo([pt.x, pt.y]);
    }
  }

  // Close profile back to revolution axis.
  const lastPoint = points[points.length - 1];
  const firstPoint = points[0];
  pen = pen.lineTo([0, lastPoint.y]);
  pen = pen.lineTo([0, firstPoint.y]);
  const drawing = pen.close();

  // Place on XZ plane and revolve around Z axis.
  return drawing.sketchOnPlane('XZ').revolve();
}

/**
 * Convert replicad mesh data to Transferable typed arrays.
 *
 * shape.mesh() returns plain JS arrays. This function copies them into
 * independent typed arrays suitable for zero-copy postMessage transfer.
 *
 * @param {{ vertices: number[], normals: number[], triangles: number[] }} meshData
 * @returns {{ vertices: Float32Array, normals: Float32Array, triangles: Uint32Array }}
 */
function toTransferableMesh(meshData) {
  return {
    vertices: new Float32Array(meshData.vertices),
    normals: new Float32Array(meshData.normals),
    triangles: new Uint32Array(meshData.triangles),
  };
}

/**
 * Generate mould parts (proof model + inner mould) from a profile.
 *
 * The proof model is the original profile revolved at fired dimensions.
 * The inner mould is:
 *   1. Profile scaled up by shrinkage factor (wet size > fired size)
 *   2. Revolved into a solid
 *   3. Shelled with NEGATIVE wall thickness (wall grows outward)
 *   4. Top face (rim plane) removed by FaceFinder.inPlane("XY", topZ)
 *
 * @param {Array<{x: number, y: number, type: string, cp1?: {x: number, y: number}, cp2?: {x: number, y: number}}>} profilePoints
 * @param {{ shrinkageRate?: number, wallThickness?: number, slipWellType?: string }} mouldParams
 * @returns {{ proof: { vertices: Float32Array, normals: Float32Array, triangles: Uint32Array }, 'inner-mould': { vertices: Float32Array, normals: Float32Array, triangles: Uint32Array } }}
 */
function generateMouldParts(profilePoints, mouldParams) {
  const {
    shrinkageRate = 0.13,
    wallThickness = 2.4,
    slipWellType = 'none',
  } = mouldParams || {};

  const meshOpts = { tolerance: 0.1, angularTolerance: 0.3 };
  const results = {};

  return withCleanup((track) => {
    // Proof model: original profile at fired dimensions
    const proofShape = track(buildAndRevolve(profilePoints));
    results.proof = toTransferableMesh(proofShape.mesh(meshOpts));

    // Inner mould: shrinkage-scaled profile, revolved, then shelled
    const scaledPoints = scaleProfileForShrinkage(profilePoints, shrinkageRate);
    const mouldSolid = track(buildAndRevolve(scaledPoints));

    // Top Z coordinate = rim height of scaled profile.
    // Since the worker revolves on the XZ plane around the Z axis,
    // the profile's Y coordinate maps to the 3D Z axis.
    // The last point's Y (after scaling) is the rim height.
    const topZ = scaledPoints[scaledPoints.length - 1].y;

    // Shell with NEGATIVE thickness: wall grows OUTWARD from pot surface.
    // FaceFinder.inPlane("XY", topZ) selects the flat top face (rim plane)
    // to leave open, creating the mould opening.
    const shelledMould = track(
      mouldSolid.shell(-wallThickness, (f) => f.inPlane('XY', topZ))
    );
    results['inner-mould'] = toTransferableMesh(shelledMould.mesh(meshOpts));

    return results;
  });
}

// ============================================================
// revolveProfile -- core geometry operation (backward compatible)
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
    const shape = track(buildAndRevolve(points));
    return toTransferableMesh(shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 }));
  });
}

// ============================================================
// Start initialization immediately on worker load.
// Don't wait for the first message -- begin downloading WASM now.
// By the time the main thread sends 'init', WASM may already be ready.
// ============================================================
initialize();
