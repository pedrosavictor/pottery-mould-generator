/**
 * geometryBridge.js -- Promise-based communication bridge to the geometry worker.
 *
 * This module wraps the postMessage/onmessage Web Worker protocol in clean
 * async/await Promises. The rest of the app can call:
 *
 *   await geometryBridge.init();
 *   const mesh = await geometryBridge.revolveProfile(points);
 *
 * without knowing about workers, message IDs, or Transferable buffers.
 *
 * DESIGN DECISIONS:
 * -----------------
 * 1. Request IDs: Each command gets a unique numeric ID. This allows multiple
 *    concurrent commands (e.g., revolve while checking heap size). The worker
 *    echoes the ID in its response so we can match it to the right Promise.
 *
 * 2. Generation counter cancellation (not AbortController): WASM operations
 *    cannot be interrupted mid-execution. Once the worker starts a revolve,
 *    it MUST complete. So "cancellation" means discarding stale results on
 *    the main thread, not aborting the worker. A simple generation counter
 *    is the lightest-weight way to implement this pattern.
 *
 * 3. Progress broadcast: The worker sends progress messages (no ID) during
 *    WASM initialization. These are broadcast to the onProgress callback,
 *    not matched to any specific pending Promise.
 *
 * NO DOM DEPENDENCIES. This module works in any main-thread context.
 */

// ============================================================
// Module state
// ============================================================

/** @type {Worker|null} The geometry Web Worker instance. */
let worker = null;

/**
 * Map of pending request ID -> { resolve, reject } Promise callbacks.
 * @type {Map<number, { resolve: function, reject: function }>}
 */
const pending = new Map();

/** Monotonically increasing request ID counter. */
let nextId = 0;

/**
 * Generation counter for latest-wins cancellation.
 * Incremented each time generateWithCancellation() is called.
 * If the counter has moved on by the time a result arrives,
 * the result is stale and discarded.
 */
let currentGenerationId = 0;

/** Whether the worker has successfully completed initialization. */
let ready = false;

/** Stored progress callback for broadcasting init progress. */
let progressCallback = null;

// ============================================================
// Internal helpers
// ============================================================

/**
 * Send a command to the worker and return a Promise for the response.
 *
 * @param {string} type - Command type (e.g., 'init', 'revolve', 'heapSize').
 * @param {Object} params - Additional parameters for the command.
 * @returns {Promise<*>} Resolves with the response data, rejects on error.
 */
function sendCommand(type, params = {}) {
  if (!worker) {
    return Promise.reject(new Error('Worker not initialized. Call init() first.'));
  }

  const id = nextId++;

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, ...params });
  });
}

/**
 * Handle messages from the worker.
 * Routes progress broadcasts and ID-matched responses.
 *
 * @param {MessageEvent} e - The worker message event.
 */
function handleMessage(e) {
  const msg = e.data;

  // Handle progress messages (no ID, broadcast to callback).
  // These are sent during WASM initialization: downloading, compiling, ready.
  if (msg.type === 'progress') {
    if (progressCallback) {
      progressCallback(msg.stage, msg.percent);
    }
    return;
  }

  // Handle response messages (have ID, matched to pending Promise).
  const { id, error, data } = msg;
  const resolver = pending.get(id);
  if (!resolver) return; // Orphaned response (e.g., after destroy)

  pending.delete(id);

  if (error) {
    resolver.reject(new Error(error));
  } else {
    resolver.resolve(data);
  }
}

/**
 * Handle worker errors (uncaught exceptions, failed imports, etc.).
 *
 * @param {ErrorEvent} e - The error event.
 */
function handleError(e) {
  const errorMsg = e.message || 'Unknown worker error';
  console.error('[geometryBridge] Worker error:', errorMsg);

  // Reject all pending promises -- the worker may be in a bad state.
  for (const [id, resolver] of pending) {
    resolver.reject(new Error(`Worker error: ${errorMsg}`));
  }
  pending.clear();
}

// ============================================================
// Public API
// ============================================================

/**
 * Initialize the geometry worker and WASM engine.
 *
 * Creates the Web Worker, sets up message handling, and sends the 'init'
 * command to trigger WASM download and compilation. The returned Promise
 * resolves when the WASM engine is fully ready for geometry operations.
 *
 * Safe to call multiple times -- subsequent calls are no-ops if already ready.
 *
 * @param {function(stage: string, percent: number): void} [onProgress]
 *   Optional callback for initialization progress. Called with:
 *   - ('downloading', 0)  -- JS modules being fetched from CDN
 *   - ('compiling', 50)   -- WASM binary being compiled
 *   - ('ready', 100)      -- Engine ready for commands
 *
 * @returns {Promise<{ ready: boolean }>} Resolves when WASM is initialized.
 * @throws {Error} If worker creation fails or WASM initialization fails.
 */
export function init(onProgress) {
  if (ready && worker) {
    return Promise.resolve({ ready: true });
  }

  progressCallback = onProgress || null;

  worker = new Worker('./js/workers/geometryWorker.js', { type: 'module' });
  worker.onmessage = handleMessage;
  worker.onerror = handleError;

  return sendCommand('init').then((data) => {
    ready = true;
    return data;
  });
}

/**
 * Revolve a 2D profile into a 3D mesh.
 *
 * Sends the profile points to the geometry worker, which builds a 2D drawing,
 * closes it to the revolution axis, revolves 360 degrees, and extracts mesh
 * data. The mesh is transferred back via Transferable ArrayBuffers (zero-copy).
 *
 * @param {Array<{x: number, y: number, type: string, cp1?: Object, cp2?: Object}>} profilePoints
 *   Profile points from foot to rim. See profileData.js for format.
 *
 * @returns {Promise<{ vertices: Float32Array, normals: Float32Array, triangles: Uint32Array }>}
 *   The mesh data ready for Three.js BufferGeometry.
 *
 * @throws {Error} If the worker is not initialized or the revolve fails.
 */
export function revolveProfile(profilePoints) {
  return sendCommand('revolve', { profilePoints });
}

/**
 * Generate mould parts (inner mould + proof model) from a profile.
 *
 * Sends profile points and mould parameters to the worker, which
 * generates both the proof model (fired pot dimensions) and the
 * inner mould (scaled for shrinkage, shelled for wall thickness).
 *
 * @param {Array<ProfilePoint>} profilePoints - Profile points from foot to rim.
 * @param {{ shrinkageRate?: number, wallThickness?: number, slipWellType?: string }} mouldParams
 * @returns {Promise<{ proof: MeshData, 'inner-mould': MeshData }>}
 */
export function generateMould(profilePoints, mouldParams) {
  return sendCommand('generateMould', { profilePoints, mouldParams });
}

/**
 * Generate mould parts with latest-wins cancellation.
 *
 * Same as generateMould but uses the generation counter to discard
 * stale results. Returns null if a newer request has been made.
 *
 * Note: This shares the currentGenerationId counter with
 * generateWithCancellation, which is correct -- if a new profile
 * edit arrives, both old revolve and old mould generation should
 * be discarded.
 *
 * @param {Array<ProfilePoint>} profilePoints
 * @param {{ shrinkageRate?: number, wallThickness?: number, slipWellType?: string }} mouldParams
 * @returns {Promise<{ proof: MeshData, 'inner-mould': MeshData }|null>}
 */
export async function generateMouldWithCancellation(profilePoints, mouldParams) {
  const myId = ++currentGenerationId;
  const result = await generateMould(profilePoints, mouldParams);
  if (myId !== currentGenerationId) return null;
  return result;
}

/**
 * Revolve a profile with latest-wins cancellation.
 *
 * If called again before the previous call completes, the previous result
 * is discarded (returns null). This is essential for the profile editor
 * where the user drags a control point -- each drag event triggers a new
 * revolve, but only the latest result matters.
 *
 * Why not AbortController? WASM operations cannot be interrupted mid-execution.
 * The worker always completes its current revolve. "Cancellation" means the
 * main thread ignores the stale result, not that the worker stops working.
 *
 * @param {Array<{x: number, y: number, type: string, cp1?: Object, cp2?: Object}>} profilePoints
 *   Profile points from foot to rim.
 *
 * @returns {Promise<{ vertices: Float32Array, normals: Float32Array, triangles: Uint32Array }|null>}
 *   The mesh data, or null if this request was superseded by a newer one.
 */
export async function generateWithCancellation(profilePoints) {
  const myId = ++currentGenerationId;
  const result = await revolveProfile(profilePoints);

  if (myId !== currentGenerationId) {
    return null; // Stale result -- a newer request has been made
  }

  return result;
}

/**
 * Run a memory leak test by performing N consecutive revolve operations.
 *
 * This is for Phase 1 success criteria #3: proving that the withCleanup()
 * pattern properly frees WASM memory. The worker reports heap size after
 * each iteration. A healthy result shows heap size plateauing after the
 * first few iterations, NOT continuously growing.
 *
 * @param {Array<{x: number, y: number, type: string, cp1?: Object, cp2?: Object}>} profilePoints
 *   Profile points to revolve in each iteration.
 * @param {number} [iterations=20] - Number of revolve operations to perform.
 *
 * @returns {Promise<{ results: Array<{ iteration: number, heapSize: number|null }> }>}
 *   Array of heap size measurements after each iteration.
 */
export function runMemoryTest(profilePoints, iterations = 20) {
  return sendCommand('memoryTest', { profilePoints, iterations });
}

/**
 * Get the current WASM heap size.
 *
 * @returns {Promise<{ heapSize: number|null }>} Heap size in bytes, or null if WASM not loaded.
 */
export function getHeapSize() {
  return sendCommand('heapSize');
}

/**
 * Destroy the worker and clean up all resources.
 *
 * Terminates the Web Worker, rejects all pending promises, and resets state.
 * After calling destroy(), init() must be called again to use geometry operations.
 *
 * Call this when the app is shutting down or when you need to force-restart
 * the geometry engine (e.g., after an unrecoverable error).
 */
export function destroy() {
  if (worker) {
    // Reject all pending promises so callers don't hang forever.
    for (const [id, resolver] of pending) {
      resolver.reject(new Error('Worker destroyed'));
    }
    pending.clear();

    worker.terminate();
    worker = null;
  }

  ready = false;
  progressCallback = null;
  currentGenerationId = 0;
}

/**
 * Check if the geometry worker is initialized and ready for commands.
 *
 * @returns {boolean} True if init() has completed successfully.
 */
export function isReady() {
  return ready && worker !== null;
}
