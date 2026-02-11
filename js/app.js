/**
 * app.js -- Main thread orchestrator for the Pottery Mould Generator.
 *
 * This module wires together the complete pipeline:
 *   1. Initialize Paper.js profile editor (synchronous -- CDN loaded before module)
 *   2. Initialize Three.js scene (preview3d)
 *   3. Initialize geometry worker + WASM (geometryBridge)
 *   4. Auto-revolve test profile on load
 *   5. Wire editor onChange -> geometry bridge -> 3D preview
 *
 * DATA FLOW (dual-path):
 * ----------------------
 *   Profile Editor (Paper.js)
 *     -> onChange(profilePoints)
 *       -> preview3d.updateLatheFallback(points)                      [INSTANT ~1ms]
 *       -> geometryBridge.generateMouldWithCancellation(points, mouldParams) [ASYNC]
 *         -> Web Worker postMessage
 *           -> proof: revolve(original profile) -> mesh()
 *           -> inner-mould: revolve(scaled profile) -> shell() -> mesh()
 *           -> Float32Array/Uint32Array via Transferable
 *         -> main thread receives named mesh parts (or null if stale)
 *       -> preview3d.updatePartMesh('pot', proof)         [replaces lathe]
 *       -> preview3d.updatePartMesh('inner-mould', mould) [blue-grey shell]
 *       -> preview3d.updatePartMesh('proof', proof)       [semi-transparent ghost]
 *
 * The LatheGeometry path provides instant visual feedback before WASM loads
 * and during WASM computation. The WASM path replaces it with higher quality.
 * All WASM operations run in the Web Worker. The main thread stays responsive.
 * The profile editor uses latest-wins cancellation so rapid edits don't queue.
 */

import * as geometryBridge from './geometryBridge.js';
import * as preview3d from './preview3d.js';
import { getTestProfile, createProfile } from './profileData.js';
import { initProfileEditor } from './profileEditor.js';
import { generatePresetProfile, PRESET_DEFAULTS, PRESET_SLIDER_RANGES } from './presets/parametricPresets.js';
import { importSVGFile } from './svgImport.js';
import { loadReferenceImage, clearReferenceImage, setReferenceOpacity } from './referenceImage.js';
import { downloadMouldZip } from './exportManager.js';
import { calculatePlaster, formatPlasterResults, formatVolume } from './plasterCalculator.js';

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
let previewStatusEl = null;

/** @type {{ getProfileData: function, setProfileData: function, setToolsEnabled: function }|null} */
let profileEditor = null;

// ============================================================
// Mode & Preset State
// ============================================================

/** Current design mode: 'parametric' (sliders) or 'freehand' (bezier editing). */
let currentMode = 'parametric';

/** Currently selected preset name. */
let currentPreset = 'cup';

// ============================================================
// Mould Parameters (defaults)
// ============================================================

/** Current mould generation parameters. Updated by mould settings UI (Plan 05-02). */
const mouldParams = {
  shrinkageRate: 0.13,    // 13% default
  wallThickness: 2.4,     // mm default
  slipWellType: 'regular', // 'none' | 'regular' | 'tall' (matches HTML default)
  cavityGap: 25,           // mm default plaster cavity gap
  splitCount: 2,           // 2 for halves, 4 for quarters
  outerWallThickness: 2.4, // mm default outer mould wall thickness
  clearance: 0.3,          // mm assembly clearance for ridge/groove fit
  ringHeight: 8,           // mm height of bottom ring
  pourHoleRadius: 15,      // mm radius of pour hole (30mm diameter)
};

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
// Profile Editor -> 3D Preview pipeline
// ============================================================

/**
 * Handle lightweight live preview during drag operations.
 *
 * Only updates the LatheGeometry fallback (synchronous, ~1ms).
 * Does NOT trigger WASM generation -- that happens on mouseUp
 * via onProfileChange/notifyChange.
 *
 * This is intentionally minimal: no WASM check, no status update,
 * no logging. It fires on every mouseDrag event and must stay fast.
 *
 * @param {Array<ProfilePoint>} profilePoints - Current profile points.
 */
function onLivePreview(profilePoints) {
  if (!profilePoints || profilePoints.length < 2) return;
  preview3d.updateLatheFallback(profilePoints);
  lastProfilePoints = profilePoints;
  if (showMeasurements) {
    preview3d.updateMeasurements(profilePoints, true);
  }
  updatePreviewStatus('Preview');
}

/**
 * Handle profile changes from the 2D editor.
 *
 * Dual-path update:
 *   1. Instant: update LatheGeometry preview (~1ms, synchronous)
 *   2. Async: trigger WASM generation (50-500ms, cancellable)
 *
 * If WASM is not ready (still loading), only the LatheGeometry path runs.
 * When WASM result arrives, it replaces the LatheGeometry mesh.
 *
 * @param {Array<ProfilePoint>} profilePoints - Updated profile points from editor.
 */
async function onProfileChange(profilePoints) {
  if (!profilePoints || profilePoints.length < 2) return;

  // Instant LatheGeometry update (always available, no WASM dependency)
  preview3d.updateLatheFallback(profilePoints);
  lastProfilePoints = profilePoints;
  if (showMeasurements) {
    preview3d.updateMeasurements(profilePoints, true);
  }
  updatePreviewStatus('Preview');

  // If WASM not ready, LatheGeometry is all we show
  if (!geometryBridge.isReady()) return;

  try {
    // Generate all mould parts (proof + inner mould) via single worker call
    const mouldResult = await geometryBridge.generateMouldWithCancellation(profilePoints, mouldParams);
    if (mouldResult === null) return; // Stale -- newer edit already in flight

    // Use the proof mesh as the 'pot' display (replaces LatheGeometry with CAD quality)
    if (mouldResult.proof) {
      preview3d.updatePartMesh('pot', mouldResult.proof);
      const verts = mouldResult.proof.vertices.length / 3;
      const tris = mouldResult.proof.triangles.length / 3;
      updatePreviewStatus(`CAD -- ${verts} verts, ${tris} tris`);
      if (statusEl) statusEl.textContent = `Ready -- ${verts} verts, ${tris} tris`;
    }

    // Update inner-mould part
    if (mouldResult['inner-mould']) {
      preview3d.updatePartMesh('inner-mould', mouldResult['inner-mould']);
    }

    // Render proof as a separate semi-transparent ghost part
    if (mouldResult.proof) {
      preview3d.updatePartMesh('proof', mouldResult.proof);
    }

    // Clear previous outer mould pieces (split count may have changed)
    preview3d.removePartsByPrefix('outer-');

    // Update outer mould pieces (outer-front, outer-back, or outer-q1..q4)
    for (const [partName, meshData] of Object.entries(mouldResult)) {
      if (partName.startsWith('outer-') && !partName.endsWith('-error') && meshData.vertices) {
        preview3d.updatePartMesh(partName, meshData);
      }
    }

    // Clear and update ring pieces
    preview3d.removePartsByPrefix('ring-');
    for (const [partName, meshData] of Object.entries(mouldResult)) {
      if (partName.startsWith('ring-') && !partName.endsWith('-error') && meshData.vertices) {
        preview3d.updatePartMesh(partName, meshData);
      }
    }

    // Handle outer mould error
    if (mouldResult['outer-mould-error']) {
      console.warn('[app] Outer mould error:', mouldResult['outer-mould-error'].message);
    }

    // Handle ring error
    if (mouldResult['ring-error']) {
      console.warn('[app] Ring error:', mouldResult['ring-error'].message);
    }

    // Handle shell failure gracefully
    if (mouldResult['inner-mould-error']) {
      console.warn('[app] Inner mould error:', mouldResult['inner-mould-error'].message);
      if (statusEl) {
        statusEl.textContent = 'Mould warning -- ' + mouldResult['inner-mould-error'].message;
      }
    }

    log('Mould generated: inner-mould + outer-mould + ring + proof');
    updatePlasterCalculator();
  } catch (err) {
    console.warn('[app] Mould generation error:', err.message);
  }
}

/**
 * Update the preview status indicator text.
 * @param {string} text - Status text to display.
 */
function updatePreviewStatus(text) {
  if (previewStatusEl) {
    previewStatusEl.textContent = text;
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
// Parametric Controls
// ============================================================

/**
 * Slider element IDs mapped to parameter keys used by generatePresetProfile().
 * The DOM ids use kebab-case; the param keys use camelCase.
 */
const SLIDER_MAP = [
  { id: 'height',        key: 'height' },
  { id: 'rim-diameter',  key: 'rimDiameter' },
  { id: 'belly-width',   key: 'bellyWidth' },
  { id: 'foot-diameter', key: 'footDiameter' },
];

/**
 * Initialize parametric controls: mode toggle, preset selector, and sliders.
 * Called once during DOMContentLoaded.
 */
function initParametricControls() {
  const presetSelect = document.getElementById('preset-selector');
  const btnParametric = document.getElementById('btn-mode-parametric');
  const btnFreehand = document.getElementById('btn-mode-freehand');
  const parametricPanel = document.getElementById('parametric-controls');

  // --- Preset selector ---
  if (presetSelect) {
    presetSelect.addEventListener('change', () => {
      applyPreset(presetSelect.value);
    });
  }

  // --- Mode toggle buttons ---
  if (btnParametric) {
    btnParametric.addEventListener('click', () => switchMode('parametric'));
  }
  if (btnFreehand) {
    btnFreehand.addEventListener('click', () => switchMode('freehand'));
  }

  // --- Wire slider input events ---
  for (const { id } of SLIDER_MAP) {
    const slider = document.getElementById(`slider-${id}`);
    const valSpan = document.getElementById(`val-${id}`);
    if (slider) {
      slider.addEventListener('input', () => {
        if (valSpan) valSpan.textContent = slider.value;
        regenerateFromSliders();
      });
    }
  }

  // --- Apply initial preset (cup) ---
  applyPreset('cup');
}

/**
 * Apply a preset: set slider ranges, values, and regenerate the profile.
 *
 * @param {string} presetName - One of 'cup', 'bowl', 'vase', 'tumbler'.
 */
function applyPreset(presetName) {
  currentPreset = presetName;
  const defaults = PRESET_DEFAULTS[presetName];
  const ranges = PRESET_SLIDER_RANGES[presetName];
  if (!defaults || !ranges) return;

  for (const { id, key } of SLIDER_MAP) {
    const slider = document.getElementById(`slider-${id}`);
    const valSpan = document.getElementById(`val-${id}`);
    const range = ranges[key];
    if (!slider || !range) continue;

    slider.min = range.min;
    slider.max = range.max;
    slider.step = range.step || 1;
    slider.value = defaults[key];
    if (valSpan) valSpan.textContent = defaults[key];
  }

  regenerateFromSliders();
}

/**
 * Read current slider values and regenerate the profile from the current preset.
 * Passes the result to the profile editor via setProfileData(), which triggers
 * the onChange callback and updates the 3D preview.
 */
function regenerateFromSliders() {
  if (!profileEditor) return;

  const params = {};
  for (const { id, key } of SLIDER_MAP) {
    const slider = document.getElementById(`slider-${id}`);
    if (slider) {
      params[key] = parseFloat(slider.value);
    }
  }

  const points = generatePresetProfile(currentPreset, params);
  profileEditor.setProfileData(createProfile(points));
}

/**
 * Switch between parametric and freehand design modes.
 *
 * - Parametric: sliders control the profile shape, editing tools disabled.
 * - Freehand: direct bezier editing with Paper.js tools, sliders hidden.
 *
 * When switching parametric -> freehand: current profile carries over.
 * When switching freehand -> parametric: profile regenerated from slider values.
 *
 * @param {'parametric'|'freehand'} mode - Target mode.
 */
function switchMode(mode) {
  if (mode === currentMode) return;
  currentMode = mode;

  const btnParametric = document.getElementById('btn-mode-parametric');
  const btnFreehand = document.getElementById('btn-mode-freehand');
  const parametricPanel = document.getElementById('parametric-controls');

  // Update mode button active states
  if (btnParametric) {
    btnParametric.classList.toggle('active', mode === 'parametric');
  }
  if (btnFreehand) {
    btnFreehand.classList.toggle('active', mode === 'freehand');
  }

  if (mode === 'parametric') {
    // Show parametric controls, disable direct editing
    if (parametricPanel) parametricPanel.classList.remove('hidden');
    if (profileEditor) profileEditor.setToolsEnabled(false);
    regenerateFromSliders();
  } else {
    // Hide parametric controls, enable direct editing
    // The current profile stays (carried over from parametric)
    if (parametricPanel) parametricPanel.classList.add('hidden');
    if (profileEditor) profileEditor.setToolsEnabled(true);
  }
}

// ============================================================
// Mould Settings
// ============================================================

/**
 * Regenerate mould parts with current mouldParams and the last known profile.
 * Called when mould settings (shrinkage, wall thickness, slip well) change.
 * Does NOT re-generate the profile shape -- only the mould geometry.
 */
async function regenerateMould() {
  if (!lastProfilePoints || lastProfilePoints.length < 2) return;
  if (!geometryBridge.isReady()) return;

  try {
    const mouldResult = await geometryBridge.generateMouldWithCancellation(
      lastProfilePoints, mouldParams
    );
    if (mouldResult === null) return; // Stale

    // Update mould parts in 3D preview
    if (mouldResult.proof) {
      preview3d.updatePartMesh('pot', mouldResult.proof);
      preview3d.updatePartMesh('proof', mouldResult.proof);
    }
    if (mouldResult['inner-mould']) {
      preview3d.updatePartMesh('inner-mould', mouldResult['inner-mould']);
    }

    // Clear previous outer mould pieces (split count may have changed)
    preview3d.removePartsByPrefix('outer-');

    // Update outer mould pieces
    for (const [partName, meshData] of Object.entries(mouldResult)) {
      if (partName.startsWith('outer-') && !partName.endsWith('-error') && meshData.vertices) {
        preview3d.updatePartMesh(partName, meshData);
      }
    }

    // Clear and update ring pieces
    preview3d.removePartsByPrefix('ring-');
    for (const [partName, meshData] of Object.entries(mouldResult)) {
      if (partName.startsWith('ring-') && !partName.endsWith('-error') && meshData.vertices) {
        preview3d.updatePartMesh(partName, meshData);
      }
    }

    // Handle outer mould error
    if (mouldResult['outer-mould-error']) {
      console.warn('[app] Outer mould error:', mouldResult['outer-mould-error'].message);
    }

    // Handle ring error
    if (mouldResult['ring-error']) {
      console.warn('[app] Ring error:', mouldResult['ring-error'].message);
    }

    // Handle shell failure gracefully
    if (mouldResult['inner-mould-error']) {
      const errMsg = mouldResult['inner-mould-error'].message;
      console.warn('[app] Inner mould error:', errMsg);
      if (statusEl) {
        statusEl.textContent = 'Mould error -- ' + errMsg;
      }
      // Clear the inner-mould part so stale geometry doesn't remain
      preview3d.setPartVisibility('inner-mould', false);
    } else if (statusEl) {
      statusEl.textContent = 'Ready';
    }

    log(`Mould regenerated (shrinkage: ${(mouldParams.shrinkageRate * 100).toFixed(1)}%, wall: ${mouldParams.wallThickness}mm, well: ${mouldParams.slipWellType}, cavity: ${mouldParams.cavityGap}mm, split: ${mouldParams.splitCount})`);
    updatePlasterCalculator();
  } catch (err) {
    console.warn('[app] Mould regeneration error:', err.message);
    if (statusEl) {
      statusEl.textContent = 'Mould generation failed';
    }
  }
}

/**
 * Initialize mould settings controls: shrinkage slider, wall thickness slider,
 * slip well selector. Changes trigger mould regeneration.
 */
function initMouldSettings() {
  const sliderShrinkage = document.getElementById('slider-shrinkage');
  const valShrinkage = document.getElementById('val-shrinkage');
  const sliderWallThickness = document.getElementById('slider-wall-thickness');
  const valWallThickness = document.getElementById('val-wall-thickness');
  const selectSlipWell = document.getElementById('select-slip-well');

  // Sync initial UI values to mouldParams
  if (sliderShrinkage) {
    mouldParams.shrinkageRate = parseFloat(sliderShrinkage.value) / 100;
  }
  if (sliderWallThickness) {
    mouldParams.wallThickness = parseFloat(sliderWallThickness.value);
  }
  if (selectSlipWell) {
    mouldParams.slipWellType = selectSlipWell.value;
  }

  // Wire shrinkage slider
  if (sliderShrinkage) {
    sliderShrinkage.addEventListener('input', () => {
      const pct = parseFloat(sliderShrinkage.value);
      if (valShrinkage) valShrinkage.textContent = pct;
      mouldParams.shrinkageRate = pct / 100;
      regenerateMould();
    });
  }

  // Wire wall thickness slider
  if (sliderWallThickness) {
    sliderWallThickness.addEventListener('input', () => {
      const mm = parseFloat(sliderWallThickness.value);
      if (valWallThickness) valWallThickness.textContent = mm;
      mouldParams.wallThickness = mm;
      regenerateMould();
    });
  }

  // Wire slip well selector
  if (selectSlipWell) {
    selectSlipWell.addEventListener('change', () => {
      mouldParams.slipWellType = selectSlipWell.value;
      regenerateMould();
    });
  }

  // Wire cavity gap slider
  const sliderCavityGap = document.getElementById('slider-cavity-gap');
  const valCavityGap = document.getElementById('val-cavity-gap');
  if (sliderCavityGap) {
    mouldParams.cavityGap = parseFloat(sliderCavityGap.value);
    sliderCavityGap.addEventListener('input', () => {
      const mm = parseFloat(sliderCavityGap.value);
      if (valCavityGap) valCavityGap.textContent = mm;
      mouldParams.cavityGap = mm;
      regenerateMould();
    });
  }

  // Wire split count selector
  const selectSplitCount = document.getElementById('select-split-count');
  if (selectSplitCount) {
    mouldParams.splitCount = parseInt(selectSplitCount.value, 10);
    selectSplitCount.addEventListener('change', () => {
      mouldParams.splitCount = parseInt(selectSplitCount.value, 10);
      regenerateMould();
    });
  }

  // Wire clearance slider
  const sliderClearance = document.getElementById('slider-clearance');
  const valClearance = document.getElementById('val-clearance');
  if (sliderClearance) {
    mouldParams.clearance = parseFloat(sliderClearance.value);
    sliderClearance.addEventListener('input', () => {
      const mm = parseFloat(sliderClearance.value);
      if (valClearance) valClearance.textContent = mm;
      mouldParams.clearance = mm;
      regenerateMould();
    });
  }

  // Wire outer wall thickness slider
  const sliderOuterWall = document.getElementById('slider-outer-wall');
  const valOuterWall = document.getElementById('val-outer-wall');
  if (sliderOuterWall) {
    mouldParams.outerWallThickness = parseFloat(sliderOuterWall.value);
    sliderOuterWall.addEventListener('input', () => {
      const mm = parseFloat(sliderOuterWall.value);
      if (valOuterWall) valOuterWall.textContent = mm;
      mouldParams.outerWallThickness = mm;
      regenerateMould();
    });
  }
}

// ============================================================
// SVG Import
// ============================================================

/**
 * Initialize the SVG file upload handler.
 *
 * When a user selects an SVG file via the hidden file input, reads it as text,
 * parses it into ProfilePoint[] using importSVGFile(), switches to freehand
 * mode, and sets the parsed profile on the editor.
 */
function initSVGImport() {
  const svgInput = document.getElementById('input-svg-upload');
  if (!svgInput) return;

  svgInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const svgString = evt.target.result;
        const points = importSVGFile(svgString);

        if (points.length < 2) {
          alert('SVG produced too few points. Please use an SVG with a simple path.');
          return;
        }

        // Switch to freehand mode (imported SVG is for direct editing)
        switchMode('freehand');

        const profile = createProfile(points);
        profileEditor.setProfileData(profile);

        log(`SVG imported: ${points.length} points`);
      } catch (err) {
        alert(err.message);
        console.warn('[app] SVG import error:', err);
      }
    };
    reader.readAsText(file);

    // Reset file input so the same file can be re-uploaded
    svgInput.value = '';
  });
}

// ============================================================
// Reference Image
// ============================================================

/**
 * Initialize the reference image upload, opacity slider, and remove button.
 *
 * When a user uploads an image, it is loaded as a data URL and placed on the
 * reference layer at 30% opacity. The opacity slider and remove button become
 * visible for control.
 */
function initReferenceImage() {
  const refImageInput = document.getElementById('input-ref-image');
  const refImageControls = document.getElementById('ref-image-controls');
  const sliderRefOpacity = document.getElementById('slider-ref-opacity');
  const valRefOpacity = document.getElementById('val-ref-opacity');
  const btnClearRef = document.getElementById('btn-clear-ref');

  if (refImageInput) {
    refImageInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
        const dataUrl = evt.target.result;
        const layers = profileEditor.getLayers();
        const transform = profileEditor.getTransform();

        loadReferenceImage(dataUrl, layers.reference, transform);

        // Show opacity controls
        if (refImageControls) refImageControls.classList.remove('hidden');
        // Reset opacity slider to default
        if (sliderRefOpacity) sliderRefOpacity.value = 0.3;
        if (valRefOpacity) valRefOpacity.textContent = '30%';

        log('Reference image loaded');
      };
      reader.readAsDataURL(file);

      // Reset file input so the same file can be re-uploaded
      refImageInput.value = '';
    });
  }

  if (sliderRefOpacity) {
    sliderRefOpacity.addEventListener('input', (e) => {
      const opacity = parseFloat(e.target.value);
      const layers = profileEditor.getLayers();
      setReferenceOpacity(layers.reference, opacity);
      if (valRefOpacity) valRefOpacity.textContent = `${Math.round(opacity * 100)}%`;
    });
  }

  if (btnClearRef) {
    btnClearRef.addEventListener('click', () => {
      const layers = profileEditor.getLayers();
      clearReferenceImage(layers.reference);
      if (refImageControls) refImageControls.classList.add('hidden');
      log('Reference image removed');
    });
  }
}

// ============================================================
// View Controls (3D visibility, exploded view, measurements)
// ============================================================

/** STL export resolution: 'standard' or 'high'. */
let exportResolution = 'standard';

/** Latest volume measurements from worker. */
let lastVolumes = null;

/** Whether 3D measurements are currently shown. */
let showMeasurements = false;

/** Latest profile points for measurement updates. */
let lastProfilePoints = null;

/**
 * Initialize 3D view controls: part visibility toggles, assembled/exploded
 * view buttons, and measurement annotation checkbox.
 *
 * Called once during DOMContentLoaded.
 */
function initViewControls() {
  // --- Part visibility toggles ---
  const chkPot = document.getElementById('chk-show-pot');
  if (chkPot) {
    chkPot.addEventListener('change', () => {
      preview3d.setPartVisibility('pot', chkPot.checked);
    });
  }

  const chkInner = document.getElementById('chk-show-inner');
  if (chkInner) {
    chkInner.addEventListener('change', () => {
      preview3d.setPartVisibility('inner-mould', chkInner.checked);
    });
  }

  const chkProof = document.getElementById('chk-show-proof');
  if (chkProof) {
    chkProof.addEventListener('change', () => {
      preview3d.setPartVisibility('proof', chkProof.checked);
    });
  }

  // Outer mould visibility toggle (controls all outer-* parts)
  const chkOuter = document.getElementById('chk-show-outer');
  if (chkOuter) {
    chkOuter.addEventListener('change', () => {
      preview3d.setPartGroupVisibility('outer-', chkOuter.checked);
    });
  }

  // Ring visibility toggle (controls all ring-* parts)
  const chkRing = document.getElementById('chk-show-ring');
  if (chkRing) {
    chkRing.addEventListener('change', () => {
      preview3d.setPartGroupVisibility('ring-', chkRing.checked);
    });
  }

  // --- Assembled / Exploded view buttons ---
  const btnAssembled = document.getElementById('btn-assembled');
  const btnExploded = document.getElementById('btn-exploded');

  if (btnAssembled) {
    btnAssembled.addEventListener('click', () => {
      preview3d.setExplodedView(false);
      btnAssembled.classList.add('active');
      if (btnExploded) btnExploded.classList.remove('active');
    });
  }

  if (btnExploded) {
    btnExploded.addEventListener('click', () => {
      preview3d.setExplodedView(true);
      if (btnAssembled) btnAssembled.classList.remove('active');
      btnExploded.classList.add('active');
    });
  }

  // --- Measurement toggle ---
  const chkMeasurements = document.getElementById('chk-show-measurements');
  if (chkMeasurements) {
    chkMeasurements.addEventListener('change', () => {
      showMeasurements = chkMeasurements.checked;
      preview3d.updateMeasurements(lastProfilePoints, showMeasurements);
    });
  }
}

// ============================================================
// Plaster Calculator
// ============================================================

/**
 * Update the plaster calculator display with current volumes.
 * Called after mould generation or volume recalculation.
 */
async function updatePlasterCalculator() {
  if (!lastProfilePoints || lastProfilePoints.length < 2) return;
  if (!geometryBridge.isReady()) return;

  try {
    const volumes = await geometryBridge.calculateVolumes(lastProfilePoints, mouldParams);
    lastVolumes = volumes;

    // Update pot volume display
    const potVolEl = document.getElementById('val-pot-volume');
    if (potVolEl) {
      potVolEl.textContent = formatVolume(volumes.proofVolumeMm3);
    }

    // Update cavity volume display
    const cavityVolEl = document.getElementById('val-cavity-volume');
    if (cavityVolEl) {
      cavityVolEl.textContent = formatVolume(volumes.cavityVolumeMm3);
    }

    // Calculate plaster amounts
    const cavityCc = volumes.cavityVolumeMm3 / 1000;
    const plaster = calculatePlaster(cavityCc);
    const formatted = formatPlasterResults(plaster);

    const plasterEl = document.getElementById('val-plaster-weight');
    if (plasterEl) plasterEl.textContent = formatted.plaster;

    const waterEl = document.getElementById('val-water-volume');
    if (waterEl) waterEl.textContent = formatted.water;
  } catch (err) {
    console.warn('[app] Plaster calculator error:', err.message);
  }
}

// ============================================================
// Export Controls
// ============================================================

/**
 * Initialize export controls: resolution toggle, download button, STEP placeholder.
 * Called once during DOMContentLoaded.
 */
function initExportControls() {
  const btnStandard = document.getElementById('btn-res-standard');
  const btnHigh = document.getElementById('btn-res-high');
  const btnDownload = document.getElementById('btn-download-zip');
  const exportStatus = document.getElementById('export-status');

  // Resolution toggle
  if (btnStandard) {
    btnStandard.addEventListener('click', () => {
      exportResolution = 'standard';
      btnStandard.classList.add('active');
      if (btnHigh) btnHigh.classList.remove('active');
    });
  }
  if (btnHigh) {
    btnHigh.addEventListener('click', () => {
      exportResolution = 'high';
      btnHigh.classList.add('active');
      if (btnStandard) btnStandard.classList.remove('active');
    });
  }

  // Download button
  if (btnDownload) {
    btnDownload.addEventListener('click', async () => {
      if (!lastProfilePoints || lastProfilePoints.length < 2) {
        if (exportStatus) exportStatus.textContent = 'No profile to export';
        return;
      }

      btnDownload.disabled = true;
      btnDownload.textContent = 'Exporting...';

      try {
        await downloadMouldZip(lastProfilePoints, mouldParams, exportResolution, {
          onProgress: (msg) => {
            if (exportStatus) exportStatus.textContent = msg;
          },
        });
        if (exportStatus) exportStatus.textContent = 'Download started!';
        setTimeout(() => {
          if (exportStatus) exportStatus.textContent = '';
        }, 3000);
      } catch (err) {
        console.error('[app] Export error:', err);
        if (exportStatus) exportStatus.textContent = 'Export failed: ' + err.message;
      } finally {
        btnDownload.disabled = false;
        btnDownload.textContent = 'Download STL (ZIP)';
      }
    });
  }

  // STEP button (Pro gating placeholder)
  const btnStep = document.getElementById('btn-download-step');
  if (btnStep) {
    btnStep.addEventListener('click', () => {
      if (exportStatus) {
        exportStatus.textContent = 'STEP export available with Pro subscription';
        setTimeout(() => { exportStatus.textContent = ''; }, 3000);
      }
    });
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
  previewStatusEl = document.getElementById('preview-status');

  const container = document.getElementById('preview-container');

  // Initialize Paper.js profile editor (synchronous -- CDN loaded in <head>)
  // This must happen BEFORE WASM init so the user sees the 2D profile immediately.
  // Start with the cup preset instead of the hardcoded test profile.
  const initialPoints = generatePresetProfile('cup', PRESET_DEFAULTS.cup);
  const initialProfile = createProfile(initialPoints);
  try {
    profileEditor = initProfileEditor('profile-canvas', {
      initialProfile: initialProfile,
      onChange: onProfileChange,
      onLivePreview: onLivePreview,
    });
    log('Profile editor initialized');
  } catch (err) {
    console.error('[app] Profile editor init error:', err);
    log(`EDITOR ERROR: ${err.message}`);
  }

  // Initialize parametric controls (mode toggle, preset selector, sliders)
  initParametricControls();

  // Initialize mould settings (shrinkage, wall thickness, slip well)
  initMouldSettings();

  // Initialize 3D view controls (visibility toggles, exploded view, measurements)
  initViewControls();

  // Initialize export controls (resolution toggle, download button)
  initExportControls();

  // Start in parametric mode: disable direct editing tools
  if (profileEditor) {
    profileEditor.setToolsEnabled(false);
  }

  // --- SVG import wiring ---
  initSVGImport();

  // --- Reference image wiring ---
  initReferenceImage();

  // Initialize Three.js scene (immediate -- no async needed)
  preview3d.initScene(container);
  log('Three.js scene initialized');

  // Instant 3D preview: show LatheGeometry from the initial profile
  // This renders in ~1ms -- user sees a 3D pot before WASM loads
  preview3d.updateLatheFallback(initialPoints);
  lastProfilePoints = initialPoints;
  updatePreviewStatus('Preview');
  log('Instant LatheGeometry preview shown');

  // Wire up buttons
  document.getElementById('btn-revolve').addEventListener('click', doRevolve);
  document.getElementById('btn-memory-test').addEventListener('click', doMemoryTest);
  document.getElementById('btn-clear').addEventListener('click', () => {
    preview3d.clearMesh();
    updatePreviewStatus('No mesh');
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
    const btnDownload = document.getElementById('btn-download-zip');
    if (btnDownload) btnDownload.disabled = false;

    // Upgrade to WASM mesh: generate mould parts from current profile
    // This replaces the LatheGeometry with CAD-quality proof + inner mould.
    try {
      const mouldResult = await geometryBridge.generateMouldWithCancellation(initialPoints, mouldParams);
      if (mouldResult) {
        if (mouldResult.proof) {
          preview3d.updatePartMesh('pot', mouldResult.proof);
          preview3d.updatePartMesh('proof', mouldResult.proof);
          const vertexCount = mouldResult.proof.vertices.length / 3;
          const triangleCount = mouldResult.proof.triangles.length / 3;
          updatePreviewStatus(`CAD -- ${vertexCount} verts, ${triangleCount} tris`);
          log(`WASM mould upgrade: ${vertexCount} verts, ${triangleCount} tris`);
        }
        if (mouldResult['inner-mould']) {
          preview3d.updatePartMesh('inner-mould', mouldResult['inner-mould']);
          log('Inner mould generated');
        }
        // Render outer mould and ring pieces from initial generation
        for (const [partName, meshData] of Object.entries(mouldResult)) {
          if ((partName.startsWith('outer-') || partName.startsWith('ring-')) && !partName.endsWith('-error') && meshData.vertices) {
            preview3d.updatePartMesh(partName, meshData);
          }
        }
        if (mouldResult['outer-front'] || mouldResult['outer-q1']) {
          log('Outer mould generated');
        }
        if (mouldResult['ring-front'] || mouldResult['ring-q1']) {
          log('Ring generated');
        }
      }
      updatePlasterCalculator();
    } catch (upgradeErr) {
      console.warn('[app] WASM mould generation failed (LatheGeometry still showing):', upgradeErr.message);
    }
  } catch (err) {
    log(`INIT ERROR: ${err.message}`);
    if (err.stack) log(err.stack);
    if (statusEl) statusEl.textContent = 'ERROR: ' + err.message;
    if (loadingText) loadingText.textContent = 'Failed to load geometry engine';
    // LatheGeometry preview remains visible -- degraded but usable
    log('Falling back to LatheGeometry preview (WASM unavailable)');
  }
});
