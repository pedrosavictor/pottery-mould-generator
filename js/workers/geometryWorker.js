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
let makeBox = null;
let makeCylinder = null;
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
    makeBox = replicadModule.makeBox;
    makeCylinder = replicadModule.makeCylinder;
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
          // Only add ArrayBuffers for actual mesh data (skip error entries)
          if (part.vertices) {
            transferList.push(part.vertices.buffer, part.normals.buffer, part.triangles.buffer);
          }
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
 * Extend the 2D profile with slip well geometry before revolving.
 *
 * The slip well is a rectangular extension at the top of the profile.
 * When revolved, it creates a cylindrical reservoir for pouring liquid clay.
 * When shelled, it becomes a hollow tube with uniform wall thickness.
 *
 * Profile extension (cross-section):
 *   From the rim point, adds three points:
 *     1. Outward by wallThickness (the well's outer wall base)
 *     2. Up by wellHeight (the well's outer wall top)
 *     3. Inward to rimRadius (the well's inner wall top -- becomes the opening)
 *
 *   Before:                    After:
 *     rim (42, 97.7)            wellTop (42, 122.7)
 *         |                          |
 *      body curve               wellOuter (44.4, 122.7)
 *         |                          |
 *     foot                      wellBase (44.4, 97.7)
 *                                    |
 *                                rim (42, 97.7)
 *                                    |
 *                                 body curve
 *                                    |
 *                                foot
 *
 * The closing path (buildAndRevolve) goes from wellTop to axis at the same height,
 * then down the axis. After shell(), the top face at wellTop height is removed,
 * creating the slip well opening.
 *
 * @param {Array<ProfilePoint>} points - Shrinkage-scaled profile points.
 * @param {number} wallThickness - Wall thickness in mm (same as shell thickness).
 * @param {number} wellHeight - Height of the slip well in mm.
 * @returns {Array<ProfilePoint>} Extended profile with slip well points appended.
 */
function extendProfileForSlipWell(points, wallThickness, wellHeight) {
  if (wellHeight <= 0) return points;

  const lastPt = points[points.length - 1];
  const rimRadius = lastPt.x;
  const rimY = lastPt.y;

  return [
    ...points,
    { x: rimRadius + wallThickness, y: rimY, type: 'line' },
    { x: rimRadius + wallThickness, y: rimY + wellHeight, type: 'line' },
    { x: rimRadius, y: rimY + wellHeight, type: 'line' },
  ];
}

/**
 * Split a revolved solid into halves or quarters using box-cutting.
 *
 * The solid is centered on the Z axis (revolved around Z).
 * Halves: split at Y=0 plane -> front (Y>0) and back (Y<0).
 * Quarters: split at both Y=0 and X=0 -> four quadrants.
 *
 * @param {Object} shape - The revolved replicad Solid.
 * @param {number} splitCount - 2 for halves, 4 for quarters.
 * @param {Function} track - The withCleanup track function.
 * @returns {Array<{ key: string, solid: Object }>} Named pieces.
 */
function splitSolid(shape, splitCount, track) {
  const B = 500; // Oversized cutting box dimension (much larger than any mould)

  if (splitCount === 4) {
    // Step 1: split into front/back halves at Y=0
    const cutFrontTool = track(makeBox([-B, -B, -B], [B, 0, B]));
    const frontHalf = track(shape.cut(cutFrontTool));
    const cutBackTool = track(makeBox([-B, 0, -B], [B, B, B]));
    const backHalf = track(shape.cut(cutBackTool));

    // Step 2: split each half into left/right at X=0
    const cutLeftTool = track(makeBox([-B, -B, -B], [0, B, B]));
    const cutRightTool = track(makeBox([0, -B, -B], [B, B, B]));

    const q1 = track(frontHalf.cut(cutLeftTool));  // X>0, Y>0
    const q2 = track(frontHalf.cut(cutRightTool)); // X<0, Y>0
    const q3 = track(backHalf.cut(cutLeftTool));   // X>0, Y<0
    const q4 = track(backHalf.cut(cutRightTool));  // X<0, Y<0

    return [
      { key: 'q1', solid: q1 },
      { key: 'q2', solid: q2 },
      { key: 'q3', solid: q3 },
      { key: 'q4', solid: q4 },
    ];
  }

  // Default: halves at Y=0
  const cutFrontTool = track(makeBox([-B, -B, -B], [B, 0, B]));
  const frontHalf = track(shape.cut(cutFrontTool));
  const cutBackTool = track(makeBox([-B, 0, -B], [B, B, B]));
  const backHalf = track(shape.cut(cutBackTool));

  return [
    { key: 'front', solid: frontHalf },
    { key: 'back', solid: backHalf },
  ];
}

/**
 * Generate the outer mould: a cylindrical shell offset from the inner mould,
 * split into halves or quarters.
 *
 * The outer mould is a simple cylinder-like shape (uniform radius based on
 * the widest point of the pot profile + cavity gap + wall thickness).
 * This matches the ShapeCast approach: flat outer wall for easy clamping.
 *
 * IMPORTANT radius calculation:
 *   innerMouldOuterRadius = maxProfileRadius + wallThickness  (shell grows outward)
 *   outerMouldInnerRadius = innerMouldOuterRadius + cavityGap
 *   outerMouldOuterRadius = outerMouldInnerRadius + outerWallThickness
 *
 * @param {Array} scaledPoints - Shrinkage-scaled profile points (same as inner mould input).
 * @param {Array} mouldProfile - The full mould profile (with slip well if present).
 * @param {Object} mouldParams - Mould generation parameters.
 * @param {Function} track - The withCleanup track function.
 * @returns {Array<{ key: string, solid: Object }>} Named split pieces.
 */
function generateOuterMould(scaledPoints, mouldProfile, mouldParams, track) {
  const {
    wallThickness = 2.4,
    cavityGap = 25,
    splitCount = 2,
    outerWallThickness = 2.4,
  } = mouldParams;

  // Calculate outer mould dimensions
  // maxProfileRadius is the widest point of the shrinkage-scaled profile
  const maxProfileRadius = Math.max(...scaledPoints.map(p => p.x));

  // Inner mould shell grows OUTWARD by wallThickness, so its outer surface is:
  const innerMouldOuterRadius = maxProfileRadius + wallThickness;

  // Outer mould starts beyond the cavity gap
  const outerMouldInnerRadius = innerMouldOuterRadius + cavityGap;
  const outerMouldOuterRadius = outerMouldInnerRadius + outerWallThickness;

  // Height matches the full mould profile (including slip well)
  const bottomZ = mouldProfile[0].y;
  const topZ = mouldProfile[mouldProfile.length - 1].y;

  // Build outer mould as a revolved rectangular cross-section.
  // This creates a cylindrical shell (uniform radius, open top, closed bottom).
  // The profile is: inner-bottom -> inner-top -> outer-top -> outer-bottom
  // When closed back to axis by buildAndRevolve, the bottom becomes solid.
  const outerProfile = [
    { x: outerMouldInnerRadius, y: bottomZ, type: 'line' },
    { x: outerMouldInnerRadius, y: topZ, type: 'line' },
    { x: outerMouldOuterRadius, y: topZ, type: 'line' },
    { x: outerMouldOuterRadius, y: bottomZ, type: 'line' },
  ];

  const outerSolid = track(buildAndRevolve(outerProfile));

  // Split into halves or quarters
  return splitSolid(outerSolid, splitCount, track);
}

/**
 * Generate the bottom ring: a washer-shaped disc connecting inner to outer mould.
 *
 * Ring sits below the mould, spanning from the inner mould's outer radius
 * to the outer mould's inner radius. Split to match outer mould configuration.
 *
 * The ring is positioned so its TOP surface aligns with the bottom of both
 * the inner and outer mould (at bottomZ), and extends downward by ringHeight.
 *
 * @param {Array} scaledPoints - Shrinkage-scaled profile points.
 * @param {Array} mouldProfile - Full mould profile (with slip well if present).
 * @param {Object} mouldParams - Mould generation parameters.
 * @param {Function} track - The withCleanup track function.
 * @returns {Array<{ key: string, solid: Object }>} Named split pieces.
 */
function generateRing(scaledPoints, mouldProfile, mouldParams, track) {
  const {
    wallThickness = 2.4,
    cavityGap = 25,
    splitCount = 2,
    ringHeight = 8,
  } = mouldParams;

  const maxProfileRadius = Math.max(...scaledPoints.map(p => p.x));
  const bottomZ = mouldProfile[0].y;

  // Ring spans from inner mould outer surface to outer mould inner surface.
  // Small clearance (0.5mm) on inner edge so the inner mould sits inside freely.
  const ringInnerRadius = maxProfileRadius + wallThickness + 0.5;
  const ringOuterRadius = maxProfileRadius + wallThickness + cavityGap;

  // Ring cross-section: rectangle from ringInner to ringOuter, below bottomZ
  const ringProfile = [
    { x: ringInnerRadius, y: bottomZ - ringHeight, type: 'line' },
    { x: ringInnerRadius, y: bottomZ, type: 'line' },
    { x: ringOuterRadius, y: bottomZ, type: 'line' },
    { x: ringOuterRadius, y: bottomZ - ringHeight, type: 'line' },
  ];

  const ringSolid = track(buildAndRevolve(ringProfile));

  // Split to match outer mould configuration
  return splitSolid(ringSolid, splitCount, track);
}

/**
 * Add ridge/groove assembly features to split pieces.
 *
 * Ridges: 2mm radius cylinders fused onto one piece's split face.
 * Grooves: (2mm + clearance) radius cylinders cut from the mating piece.
 * Positioned at 1/3 and 2/3 of the piece height along the split face.
 *
 * For halves: ridges on front (Y>0 face at Y=0), grooves on back (Y<0 face at Y=0).
 * The cylinders run along the X axis (horizontal) on the Y=0 split face.
 *
 * @param {Array<{ key: string, solid: Object }>} pieces - Split pieces from splitSolid().
 * @param {string} partPrefix - 'outer' or 'ring' for naming.
 * @param {number} bottomZ - Bottom Z coordinate of the part.
 * @param {number} topZ - Top Z coordinate of the part.
 * @param {number} innerRadius - Inner radius of the part (for positioning ridges).
 * @param {number} outerRadius - Outer radius of the part (for positioning ridges).
 * @param {Object} mouldParams - Contains clearance, splitCount.
 * @param {Function} track - The withCleanup track function.
 * @returns {Array<{ key: string, solid: Object }>} Pieces with assembly features.
 */
function addAssemblyFeatures(pieces, partPrefix, bottomZ, topZ, innerRadius, outerRadius, mouldParams, track) {
  const {
    clearance = 0.3,
    splitCount = 2,
  } = mouldParams;

  const ridgeRadius = 2.0;  // mm
  const grooveRadius = ridgeRadius + clearance;
  const height = topZ - bottomZ;
  const midRadius = (innerRadius + outerRadius) / 2;

  // Ridge positions: at 1/3 and 2/3 height
  const ridgeZ1 = bottomZ + height / 3;
  const ridgeZ2 = bottomZ + (2 * height) / 3;
  const ridgeLength = (outerRadius - innerRadius) * 0.8; // 80% of radial width
  const ridgeStartX = midRadius - ridgeLength / 2;

  // For halves: front gets ridges on its Y=0 face, back gets grooves
  // Ridge cylinders run along X axis, centered on the Y=0 plane
  // They extend from ridgeStartX to ridgeStartX + ridgeLength along X
  // positioned at Y=0, at heights ridgeZ1 and ridgeZ2

  const result = [];

  for (const piece of pieces) {
    let solid = piece.solid;
    const isRidgePiece = (piece.key === 'front' || piece.key === 'q1' || piece.key === 'q3');
    const isGroovePiece = (piece.key === 'back' || piece.key === 'q2' || piece.key === 'q4');

    if (isRidgePiece) {
      // Add ridges at two heights on the Y=0 face
      // Cylinders along X axis: makeCylinder(radius, length, [startX, y, z], [1, 0, 0])
      const ridge1 = track(makeCylinder(ridgeRadius, ridgeLength, [ridgeStartX, 0, ridgeZ1], [1, 0, 0]));
      solid = track(solid.fuse(ridge1));
      const ridge2 = track(makeCylinder(ridgeRadius, ridgeLength, [ridgeStartX, 0, ridgeZ2], [1, 0, 0]));
      solid = track(solid.fuse(ridge2));
    }

    if (isGroovePiece) {
      // Cut grooves at matching positions (slightly larger radius for clearance)
      const groove1 = track(makeCylinder(grooveRadius, ridgeLength + 2, [ridgeStartX - 1, 0, ridgeZ1], [1, 0, 0]));
      solid = track(solid.cut(groove1));
      const groove2 = track(makeCylinder(grooveRadius, ridgeLength + 2, [ridgeStartX - 1, 0, ridgeZ2], [1, 0, 0]));
      solid = track(solid.cut(groove2));
    }

    result.push({ key: piece.key, solid });
  }

  return result;
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
    cavityGap = 25,
    splitCount = 2,
    outerWallThickness = 2.4,
    clearance = 0.3,
    ringHeight = 8,
  } = mouldParams || {};

  const meshOpts = { tolerance: 0.1, angularTolerance: 0.3 };
  const results = {};

  return withCleanup((track) => {
    // Proof model: original profile at fired dimensions
    const proofShape = track(buildAndRevolve(profilePoints));
    results.proof = toTransferableMesh(proofShape.mesh(meshOpts));

    // Inner mould: shrinkage-scaled profile, with optional slip well, revolved, then shelled
    const scaledPoints = scaleProfileForShrinkage(profilePoints, shrinkageRate);

    // Add slip well geometry to profile (if requested)
    const wellHeights = { none: 0, regular: 25, tall: 50 };
    const wellHeight = wellHeights[slipWellType] || 0;
    const mouldProfile = wellHeight > 0
      ? extendProfileForSlipWell(scaledPoints, wallThickness, wellHeight)
      : scaledPoints;

    // Revolve the (possibly extended) profile
    const mouldSolid = track(buildAndRevolve(mouldProfile));

    // Top Z coordinate = last point's Y of the mould profile.
    // When slip well is present, this is the well top; otherwise it's the rim.
    // Since the worker revolves on the XZ plane around the Z axis,
    // the profile's Y coordinate maps to the 3D Z axis.
    const topZ = mouldProfile[mouldProfile.length - 1].y;

    // Shell with NEGATIVE thickness: wall grows OUTWARD from pot surface.
    // FaceFinder.inPlane("XY", topZ) selects the flat top face (rim/well top plane)
    // to leave open, creating the mould opening.
    let shelledMould;
    try {
      shelledMould = track(
        mouldSolid.shell(-wallThickness, (f) => f.inPlane('XY', topZ))
      );
    } catch (shellErr) {
      // Shell failed -- return an error indicator alongside the proof model
      // so the app can show a meaningful error instead of crashing
      console.warn('[worker] Shell operation failed:', shellErr.message);
      results['inner-mould-error'] = {
        message: `Shell operation failed: ${shellErr.message}. Try reducing wall thickness or simplifying the profile.`,
      };
      return results; // Returns proof but no inner-mould mesh
    }
    results['inner-mould'] = toTransferableMesh(shelledMould.mesh(meshOpts));

    // Outer mould: cylindrical shell split into halves or quarters
    try {
      const outerPieces = generateOuterMould(scaledPoints, mouldProfile, mouldParams, track);

      // Add assembly features (ridges/grooves) to outer mould split faces
      const outerBottomZ = mouldProfile[0].y;
      const outerTopZ = mouldProfile[mouldProfile.length - 1].y;
      const maxProfileRadius = Math.max(...scaledPoints.map(p => p.x));
      const outerInnerR = maxProfileRadius + wallThickness + cavityGap;
      const outerOuterR = outerInnerR + (outerWallThickness);
      const ridgedOuterPieces = addAssemblyFeatures(
        outerPieces, 'outer', outerBottomZ, outerTopZ, outerInnerR, outerOuterR, mouldParams, track
      );

      for (const piece of ridgedOuterPieces) {
        results[`outer-${piece.key}`] = toTransferableMesh(piece.solid.mesh(meshOpts));
      }
    } catch (outerErr) {
      console.warn('[worker] Outer mould generation failed:', outerErr.message);
      results['outer-mould-error'] = {
        message: `Outer mould failed: ${outerErr.message}`,
      };
    }

    // Ring: washer connecting inner to outer mould base
    try {
      const ringPieces = generateRing(scaledPoints, mouldProfile, mouldParams, track);

      // Add assembly features to ring pieces
      const ringBottomZ = mouldProfile[0].y - (ringHeight);
      const ringTopZ = mouldProfile[0].y;
      const ringMaxR = Math.max(...scaledPoints.map(p => p.x));
      const ringInnerR = ringMaxR + wallThickness + 0.5;
      const ringOuterR = ringMaxR + wallThickness + cavityGap;
      const ridgedRingPieces = addAssemblyFeatures(
        ringPieces, 'ring', ringBottomZ, ringTopZ, ringInnerR, ringOuterR, mouldParams, track
      );

      for (const piece of ridgedRingPieces) {
        results[`ring-${piece.key}`] = toTransferableMesh(piece.solid.mesh(meshOpts));
      }
    } catch (ringErr) {
      console.warn('[worker] Ring generation failed:', ringErr.message);
      results['ring-error'] = {
        message: `Ring generation failed: ${ringErr.message}`,
      };
    }

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
