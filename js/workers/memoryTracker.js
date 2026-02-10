/**
 * memoryTracker.js -- WASM memory safety wrapper for the geometry worker.
 *
 * Problem: OpenCASCADE objects live on the WASM heap and are NOT garbage collected.
 * Every shape created by revolve(), extrude(), cut(), fuse(), etc. must be
 * explicitly .delete()'d after use, or the WASM heap grows without bound.
 *
 * Solution: The withCleanup() wrapper tracks all WASM objects created during
 * a geometry operation and guarantees cleanup in a finally block, even if
 * the operation throws an error.
 *
 * Usage:
 *   const result = withCleanup((track) => {
 *     const shape = track(sketch.revolve());
 *     const mesh = shape.mesh({ tolerance: 0.1 });
 *     return { vertices: new Float32Array(mesh.vertices) };
 *     // shape.delete() is called automatically in the finally block
 *   });
 *
 * IMPORTANT: Only track objects that have a .delete() method (replicad shapes,
 * OCCT handles). Do NOT track plain JS objects, typed arrays, or mesh data.
 *
 * NO DOM DEPENDENCIES. This module runs exclusively inside a Web Worker.
 */

/**
 * Execute a function with automatic WASM object cleanup.
 *
 * The provided function receives a `track()` callback. Pass any WASM object
 * to track() and it will be .delete()'d when the function completes (or throws).
 *
 * @param {function(track: function): *} fn - Function to execute.
 *   Receives track(obj) which registers obj for cleanup and returns obj.
 * @returns {*} The return value of fn.
 * @throws {*} Re-throws any error from fn after cleanup.
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
        console.warn('[memoryTracker] Failed to delete object:', e);
      }
    }
  }
}

/**
 * Get the current WASM heap size in bytes.
 *
 * This reads the Emscripten Module.HEAP8 buffer length, which reflects
 * the total allocated WASM linear memory. Note:
 * - WASM memory grows but never shrinks (pages are never returned to OS)
 * - After initial operations, the heap should plateau at a stable size
 * - Continuous growth across many operations indicates a memory leak
 *
 * @returns {number|null} Heap size in bytes, or null if not available.
 */
export function getHeapSize() {
  // Emscripten exposes the WASM heap via the Module global.
  // In a worker context, Module is set by the opencascade WASM loader.
  if (typeof Module !== 'undefined' && Module.HEAP8) {
    return Module.HEAP8.buffer.byteLength;
  }
  return null;
}
