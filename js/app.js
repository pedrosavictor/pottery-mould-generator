/**
 * app.js -- Main thread orchestrator for the Pottery Mould Generator.
 *
 * This module wires together the complete Phase 1 pipeline:
 *   1. Initialize Three.js scene (preview3d)
 *   2. Initialize geometry worker + WASM (geometryBridge)
 *   3. Auto-revolve test profile on load
 *   4. Wire up test buttons (revolve, memory test, clear)
 *
 * DATA FLOW:
 * ----------
 *   getTestProfile() -> profile.points
 *     -> geometryBridge.revolveProfile(points)
 *       -> Web Worker postMessage
 *         -> replicad draw() -> revolve() -> mesh()
 *         -> Float32Array/Uint32Array via Transferable
 *       -> main thread receives mesh data
 *     -> preview3d.updateMesh(meshData)
 *       -> Three.js BufferGeometry -> render
 *
 * All WASM operations run in the Web Worker. The main thread stays responsive.
 */

import * as geometryBridge from './geometryBridge.js';
import * as preview3d from './preview3d.js';
import { getTestProfile } from './profileData.js';

// ============================================================
// DOM References (populated on DOMContentLoaded)
// ============================================================

let statusEl = null;
let outputEl = null;
let memoryOutputEl = null;
let loadingIndicator = null;
let loadingText = null;
let testControls = null;
let memoryResults = null;

// ============================================================
// Logging
// ============================================================

/**
 * Append a message to the #output panel and console.log.
 *
 * @param {string} msg - Message to display.
 */
function log(msg) {
  console.log(msg);
  if (outputEl) {
    outputEl.textContent += msg + '\n';
    // Auto-scroll to bottom
    outputEl.scrollTop = outputEl.scrollHeight;
  }
}

// ============================================================
// Core Operations
// ============================================================

/**
 * Revolve the test profile and display the result in the 3D preview.
 *
 * Times the operation and logs vertex/triangle counts.
 */
async function doRevolve() {
  const profile = getTestProfile();
  log(`Revolving test profile (${profile.points.length} points)...`);

  const t0 = performance.now();

  try {
    const result = await geometryBridge.revolveProfile(profile.points);
    const elapsed = Math.round(performance.now() - t0);

    const vertexCount = result.vertices.length / 3;
    const triangleCount = result.triangles.length / 3;

    log(`Revolve complete: ${vertexCount} vertices, ${triangleCount} triangles in ${elapsed}ms`);

    preview3d.updateMesh(result);

    if (statusEl) {
      statusEl.textContent = `Ready -- ${vertexCount} verts, ${triangleCount} tris`;
    }
  } catch (err) {
    log(`REVOLVE ERROR: ${err.message}`);
    if (statusEl) statusEl.textContent = 'Error during revolve';
  }
}

/**
 * Run the memory leak test: 20 consecutive revolves with heap monitoring.
 *
 * Displays heap size after each iteration and determines pass/fail.
 * PASS: heap after iteration 20 is approximately equal to heap after iteration 2.
 * FAIL: continuous linear growth indicating a memory leak.
 */
async function doMemoryTest() {
  const profile = getTestProfile();
  log('Starting memory test (20 iterations)...');

  if (statusEl) statusEl.textContent = 'Running memory test...';

  try {
    const t0 = performance.now();
    const data = await geometryBridge.runMemoryTest(profile.points, 20);
    const elapsed = Math.round(performance.now() - t0);
    const results = data.results;

    // Display results
    if (memoryResults) {
      memoryResults.classList.remove('hidden');
    }

    let output = 'Memory Test Results (20 revolve iterations)\n';
    output += '─'.repeat(45) + '\n';

    for (const entry of results) {
      const heapMB = entry.heapSize !== null
        ? (entry.heapSize / (1024 * 1024)).toFixed(1) + ' MB'
        : 'N/A';
      output += `  Iteration ${String(entry.iteration).padStart(2)}: heap = ${heapMB}\n`;
    }

    output += '─'.repeat(45) + '\n';

    // Analyze: compare iteration 2 heap to iteration 20 heap
    const heap2 = results.length >= 2 ? results[1].heapSize : null;
    const heap20 = results.length >= 20 ? results[19].heapSize : null;

    if (heap2 !== null && heap20 !== null) {
      const heap2MB = (heap2 / (1024 * 1024)).toFixed(1);
      const heap20MB = (heap20 / (1024 * 1024)).toFixed(1);
      const growthMB = ((heap20 - heap2) / (1024 * 1024)).toFixed(2);
      const growthPct = ((heap20 - heap2) / heap2 * 100).toFixed(1);

      output += `  Heap after #2:  ${heap2MB} MB\n`;
      output += `  Heap after #20: ${heap20MB} MB\n`;
      output += `  Growth: ${growthMB} MB (${growthPct}%)\n`;

      // Allow up to 10% growth as normal variance (WASM page rounding, etc.)
      const passed = Math.abs(heap20 - heap2) / heap2 < 0.10;
      output += `\n  Result: ${passed ? 'PASSED -- no memory leak detected' : 'FAILED -- continuous heap growth detected'}\n`;

      log(`Memory test ${passed ? 'PASSED' : 'FAILED'} in ${elapsed}ms`);
    } else {
      output += '  Could not determine heap sizes (WASM not loaded or < 20 iterations)\n';
      log(`Memory test completed in ${elapsed}ms (heap size unavailable)`);
    }

    if (memoryOutputEl) {
      memoryOutputEl.textContent = output;
    }

    if (statusEl) statusEl.textContent = 'Ready';
  } catch (err) {
    log(`MEMORY TEST ERROR: ${err.message}`);
    if (statusEl) statusEl.textContent = 'Error during memory test';
  }
}

// ============================================================
// Initialization
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Grab DOM references
  statusEl = document.getElementById('status');
  outputEl = document.getElementById('output');
  memoryOutputEl = document.getElementById('memory-output');
  loadingIndicator = document.getElementById('loading-indicator');
  loadingText = document.getElementById('loading-text');
  testControls = document.getElementById('test-controls');
  memoryResults = document.getElementById('memory-results');

  const container = document.getElementById('preview-container');

  // Initialize Three.js scene (immediate -- no async needed)
  preview3d.initScene(container);
  log('Three.js scene initialized');

  // Wire up buttons
  document.getElementById('btn-revolve').addEventListener('click', doRevolve);
  document.getElementById('btn-memory-test').addEventListener('click', doMemoryTest);
  document.getElementById('btn-clear').addEventListener('click', () => {
    preview3d.clearMesh();
    log('Mesh cleared');
    if (statusEl) statusEl.textContent = 'Ready (no mesh)';
  });

  // Initialize geometry worker (WASM loading -- takes 3-15 seconds)
  if (statusEl) statusEl.textContent = 'Loading WASM...';
  const initStart = performance.now();

  try {
    await geometryBridge.init((stage, percent) => {
      if (loadingText) {
        loadingText.textContent = `Loading geometry engine... ${stage} (${percent}%)`;
      }
    });

    const initElapsed = Math.round(performance.now() - initStart);
    log(`WASM initialized in ${initElapsed}ms`);

    if (statusEl) statusEl.textContent = 'Ready';
    if (loadingIndicator) {
      loadingIndicator.classList.add('hidden');
      loadingIndicator.classList.remove('visible');
    }
    if (testControls) {
      testControls.classList.remove('hidden');
    }

    // Auto-revolve the test profile on load
    await doRevolve();
  } catch (err) {
    log(`INIT ERROR: ${err.message}`);
    if (err.stack) log(err.stack);
    if (statusEl) statusEl.textContent = 'ERROR: ' + err.message;
    if (loadingText) loadingText.textContent = 'Failed to load geometry engine';
  }
});
