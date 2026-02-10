/**
 * WASM Spike Worker -- validates replicad CDN loading in a module Web Worker.
 *
 * This is a throwaway test harness, not production code.
 * It answers the 5 open questions from Phase 1 RESEARCH.md:
 *
 * 1. Does replicad ESM bundle load via direct CDN URL in a module worker?
 * 2. What is the exact runtime type of shape.mesh() return value?
 * 3. Does shape.delete() properly free memory without error?
 * 4. Does XZ-plane + Z-axis revolve work for pottery profiles?
 * 5. Is replicad_single.js an ESM module or CommonJS?
 *
 * CRITICAL: Import maps do NOT work in Web Workers.
 * All imports must use full CDN URLs.
 *
 * This worker MUST be loaded with: new Worker('spike-worker.js', { type: 'module' })
 */

// ============================================================
// CDN URLs -- direct imports (no import maps in workers)
// ============================================================
const REPLICAD_URL = 'https://cdn.jsdelivr.net/npm/replicad@0.20.5/dist/replicad.js';
const OPENCASCADE_URL = 'https://cdn.jsdelivr.net/npm/replicad-opencascadejs@0.20.2/src/replicad_single.js';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/replicad-opencascadejs@0.20.2/src/replicad_single.wasm';

// ============================================================
// Main spike execution
// ============================================================
async function runSpike() {
  const results = {
    questions: {},
    timings: {},
    errors: [],
  };

  // ----------------------------------------------------------
  // Step 1: Test module format of replicad_single.js (Question 5)
  // ----------------------------------------------------------
  self.postMessage({ type: 'status', message: 'Checking replicad_single.js module format...' });
  try {
    const resp = await fetch(OPENCASCADE_URL);
    const text = await resp.text();
    const first500 = text.substring(0, 500);
    const hasExportDefault = text.includes('export default') || text.includes('export{');
    const hasModuleExports = text.includes('module.exports');
    const hasDefineAmd = text.includes('define(') && text.includes('amd');

    results.questions['Q5_module_format'] = {
      question: 'Is replicad_single.js ESM or CommonJS?',
      isESM: hasExportDefault,
      isCommonJS: hasModuleExports,
      isAMD: hasDefineAmd,
      first500chars: first500,
      conclusion: hasExportDefault ? 'ESM (has export default)' :
                  hasModuleExports ? 'CommonJS (has module.exports)' :
                  'Unknown format -- check first500chars',
    };
    self.postMessage({ type: 'finding', key: 'Q5', data: results.questions['Q5_module_format'] });
  } catch (err) {
    results.errors.push({ step: 'Q5_module_format', error: err.message });
    self.postMessage({ type: 'error', step: 'Q5', error: err.message });
  }

  // ----------------------------------------------------------
  // Step 2: Import replicad ESM from CDN (Question 1)
  // ----------------------------------------------------------
  self.postMessage({ type: 'status', message: 'Importing replicad from CDN...' });
  let draw, setOC;
  try {
    const replicadModule = await import(REPLICAD_URL);
    draw = replicadModule.draw;
    setOC = replicadModule.setOC;

    results.questions['Q1_replicad_esm'] = {
      question: 'Does replicad ESM bundle load in a module worker from CDN?',
      success: true,
      hasDraw: typeof draw === 'function',
      hasSetOC: typeof setOC === 'function',
      exportedKeys: Object.keys(replicadModule).slice(0, 30),
      conclusion: 'replicad ESM loads successfully via dynamic import() in a module worker.',
    };
    self.postMessage({ type: 'finding', key: 'Q1', data: results.questions['Q1_replicad_esm'] });
  } catch (err) {
    results.questions['Q1_replicad_esm'] = {
      question: 'Does replicad ESM bundle load in a module worker from CDN?',
      success: false,
      error: err.message,
      errorType: err.constructor.name,
      conclusion: `FAILED: ${err.message}. May need esm.sh, self-hosted bundle, or importScripts() fallback.`,
    };
    results.errors.push({ step: 'Q1_replicad_esm', error: err.message });
    self.postMessage({ type: 'error', step: 'Q1', error: err.message });
    // Cannot continue without replicad
    self.postMessage({ type: 'complete', results });
    return;
  }

  // ----------------------------------------------------------
  // Step 3: Import opencascade init and load WASM
  // ----------------------------------------------------------
  self.postMessage({ type: 'status', message: 'Loading WASM (this takes 3-15 seconds)...' });
  let opencascade;
  try {
    const ocModule = await import(OPENCASCADE_URL);
    opencascade = ocModule.default || ocModule;
    self.postMessage({ type: 'status', message: 'opencascade module imported, now initializing WASM...' });
  } catch (err) {
    results.errors.push({ step: 'opencascade_import', error: err.message });
    self.postMessage({ type: 'error', step: 'opencascade_import', error: err.message });
    self.postMessage({ type: 'complete', results });
    return;
  }

  const wasmStartTime = performance.now();
  try {
    const OC = await opencascade({
      locateFile: () => WASM_URL,
    });
    const wasmDuration = performance.now() - wasmStartTime;
    results.timings.wasmInit = Math.round(wasmDuration);

    setOC(OC);

    self.postMessage({
      type: 'status',
      message: `WASM initialized in ${Math.round(wasmDuration)}ms`,
    });
    self.postMessage({ type: 'finding', key: 'WASM_INIT', data: { durationMs: Math.round(wasmDuration) } });
  } catch (err) {
    const wasmDuration = performance.now() - wasmStartTime;
    results.timings.wasmInit = Math.round(wasmDuration);
    results.errors.push({ step: 'wasm_init', error: err.message });
    self.postMessage({ type: 'error', step: 'wasm_init', error: err.message });
    self.postMessage({ type: 'complete', results });
    return;
  }

  // ----------------------------------------------------------
  // Step 4: Simple rectangle revolve + mesh inspection (Questions 2, 4)
  // ----------------------------------------------------------
  self.postMessage({ type: 'status', message: 'Testing rectangle revolve...' });
  try {
    const revolveStart = performance.now();

    // Simple rectangle profile: 10mm radius, 50mm tall
    const shape = draw([10, 0])
      .lineTo([10, 50])
      .lineTo([0, 50])
      .lineTo([0, 0])
      .close()
      .sketchOnPlane('XZ')
      .revolve();

    const revolveDuration = performance.now() - revolveStart;

    // Extract mesh
    const meshStart = performance.now();
    const meshData = shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 });
    const meshDuration = performance.now() - meshStart;

    results.timings.rectangleRevolve = Math.round(revolveDuration);
    results.timings.rectangleMesh = Math.round(meshDuration);

    // Answer Question 2: mesh data types
    results.questions['Q2_mesh_types'] = {
      question: 'What is the exact runtime type of shape.mesh() return value?',
      meshKeys: Object.keys(meshData),
      vertices: {
        type: typeof meshData.vertices,
        isArray: Array.isArray(meshData.vertices),
        isFloat32Array: meshData.vertices instanceof Float32Array,
        isFloat64Array: meshData.vertices instanceof Float64Array,
        constructorName: meshData.vertices?.constructor?.name,
        length: meshData.vertices?.length,
        sampleFirst6: meshData.vertices ? Array.from(meshData.vertices).slice(0, 6) : null,
      },
      normals: {
        type: typeof meshData.normals,
        isArray: Array.isArray(meshData.normals),
        constructorName: meshData.normals?.constructor?.name,
        length: meshData.normals?.length,
      },
      triangles: {
        type: typeof meshData.triangles,
        isArray: Array.isArray(meshData.triangles),
        constructorName: meshData.triangles?.constructor?.name,
        length: meshData.triangles?.length,
      },
      faceGroups: {
        exists: !!meshData.faceGroups,
        type: typeof meshData.faceGroups,
        isArray: Array.isArray(meshData.faceGroups),
        length: meshData.faceGroups?.length,
      },
      conclusion: `vertices: ${meshData.vertices?.constructor?.name}[${meshData.vertices?.length}], ` +
                  `normals: ${meshData.normals?.constructor?.name}[${meshData.normals?.length}], ` +
                  `triangles: ${meshData.triangles?.constructor?.name}[${meshData.triangles?.length}]`,
    };
    self.postMessage({ type: 'finding', key: 'Q2', data: results.questions['Q2_mesh_types'] });

    // Answer Question 4: revolve axis for XZ plane
    const vertexCount = meshData.vertices?.length / 3;
    results.questions['Q4_revolve_axis'] = {
      question: 'Does XZ-plane + default revolve work for pottery profiles?',
      rectangleVertexCount: vertexCount,
      rectangleTriangleCount: meshData.triangles?.length / 3,
      producedValidMesh: vertexCount > 0,
      revolveDurationMs: Math.round(revolveDuration),
      meshExtractionMs: Math.round(meshDuration),
      conclusion: vertexCount > 0
        ? `YES -- rectangle revolve produced ${vertexCount} vertices in ${Math.round(revolveDuration)}ms`
        : 'FAILED -- no vertices produced',
    };
    self.postMessage({ type: 'finding', key: 'Q4_rectangle', data: results.questions['Q4_revolve_axis'] });

    // Answer Question 3: shape.delete()
    try {
      shape.delete();
      results.questions['Q3_shape_delete'] = {
        question: 'Does shape.delete() work without error after revolve?',
        success: true,
        conclusion: 'shape.delete() completed without error on revolved shape.',
      };
      self.postMessage({ type: 'finding', key: 'Q3', data: results.questions['Q3_shape_delete'] });
    } catch (deleteErr) {
      results.questions['Q3_shape_delete'] = {
        question: 'Does shape.delete() work without error after revolve?',
        success: false,
        error: deleteErr.message,
        conclusion: `FAILED: ${deleteErr.message}`,
      };
      results.errors.push({ step: 'Q3_shape_delete', error: deleteErr.message });
      self.postMessage({ type: 'finding', key: 'Q3', data: results.questions['Q3_shape_delete'] });
    }
  } catch (err) {
    results.errors.push({ step: 'rectangle_revolve', error: err.message, stack: err.stack });
    self.postMessage({ type: 'error', step: 'rectangle_revolve', error: err.message });
  }

  // ----------------------------------------------------------
  // Step 5: Cup profile revolve (validates axis for complex profile)
  // ----------------------------------------------------------
  self.postMessage({ type: 'status', message: 'Testing cup profile revolve...' });
  try {
    const cupStart = performance.now();

    // Cup-like profile (from plan): foot -> body curve -> rim
    // Profile points: [radius, height] on XZ plane
    const cupShape = draw([30, 0])
      .lineTo([30, 3])
      .lineTo([25, 5])
      .lineTo([35, 50])
      .lineTo([40, 80])
      .lineTo([42, 85])
      .lineTo([0, 85])
      .lineTo([0, 0])
      .close()
      .sketchOnPlane('XZ')
      .revolve();

    const cupDuration = performance.now() - cupStart;
    const cupMesh = cupShape.mesh({ tolerance: 0.1, angularTolerance: 0.3 });
    const cupVertexCount = cupMesh.vertices?.length / 3;

    results.questions['Q4_cup_revolve'] = {
      vertexCount: cupVertexCount,
      triangleCount: cupMesh.triangles?.length / 3,
      producedValidMesh: cupVertexCount > 0,
      durationMs: Math.round(cupDuration),
      conclusion: cupVertexCount > 0
        ? `Cup profile revolve WORKS: ${cupVertexCount} vertices in ${Math.round(cupDuration)}ms`
        : 'FAILED -- no cup vertices produced',
    };
    self.postMessage({ type: 'finding', key: 'Q4_cup', data: results.questions['Q4_cup_revolve'] });

    cupShape.delete();
  } catch (err) {
    results.errors.push({ step: 'cup_revolve', error: err.message, stack: err.stack });
    self.postMessage({ type: 'error', step: 'cup_revolve', error: err.message });
  }

  // ----------------------------------------------------------
  // Step 6: Test meshEdges (for edge rendering in Three.js)
  // ----------------------------------------------------------
  self.postMessage({ type: 'status', message: 'Testing meshEdges...' });
  try {
    const edgeShape = draw([10, 0])
      .lineTo([10, 50])
      .lineTo([0, 50])
      .lineTo([0, 0])
      .close()
      .sketchOnPlane('XZ')
      .revolve();

    const edgeData = edgeShape.meshEdges({ tolerance: 0.1, angularTolerance: 0.3 });
    results.questions['meshEdges'] = {
      edgeKeys: Object.keys(edgeData),
      type: typeof edgeData,
      isArray: Array.isArray(edgeData),
      constructorName: edgeData?.constructor?.name,
      length: edgeData?.length,
      // If it is an array-like, inspect first element
      firstElement: Array.isArray(edgeData) && edgeData.length > 0
        ? {
            keys: typeof edgeData[0] === 'object' ? Object.keys(edgeData[0]) : null,
            type: typeof edgeData[0],
          }
        : null,
      conclusion: `meshEdges returns ${edgeData?.constructor?.name} with ${edgeData?.length ?? 'unknown'} entries`,
    };
    self.postMessage({ type: 'finding', key: 'meshEdges', data: results.questions['meshEdges'] });

    edgeShape.delete();
  } catch (err) {
    results.errors.push({ step: 'meshEdges', error: err.message });
    self.postMessage({ type: 'error', step: 'meshEdges', error: err.message });
  }

  // ----------------------------------------------------------
  // Step 7: Quick memory test (5 consecutive revolves)
  // ----------------------------------------------------------
  self.postMessage({ type: 'status', message: 'Running memory test (5 revolves)...' });
  try {
    const memoryResults = [];
    for (let i = 0; i < 5; i++) {
      const s = draw([10, 0])
        .lineTo([10, 50])
        .lineTo([0, 50])
        .lineTo([0, 0])
        .close()
        .sketchOnPlane('XZ')
        .revolve();

      const m = s.mesh({ tolerance: 0.1, angularTolerance: 0.3 });
      s.delete();

      memoryResults.push({
        iteration: i + 1,
        vertexCount: m.vertices?.length / 3,
      });
    }

    results.questions['memory_test'] = {
      iterations: 5,
      results: memoryResults,
      allProducedVertices: memoryResults.every(r => r.vertexCount > 0),
      conclusion: 'All 5 revolve+mesh+delete cycles completed without error.',
    };
    self.postMessage({ type: 'finding', key: 'memory', data: results.questions['memory_test'] });
  } catch (err) {
    results.errors.push({ step: 'memory_test', error: err.message });
    self.postMessage({ type: 'error', step: 'memory_test', error: err.message });
  }

  // ----------------------------------------------------------
  // Done -- send all results
  // ----------------------------------------------------------
  self.postMessage({ type: 'status', message: 'Spike complete.' });
  self.postMessage({ type: 'complete', results });
}

// Run the spike
runSpike().catch(err => {
  self.postMessage({ type: 'error', step: 'top-level', error: err.message, stack: err.stack });
});
