# Phase 7: File Export and Plaster Calculator - Research

**Researched:** 2026-02-10
**Domain:** Binary STL generation, ZIP bundling, STEP export, volume calculation, plaster mixing math
**Confidence:** HIGH

## Summary

Phase 7 transforms the mould geometry into downloadable files and provides potters with the plaster mixing calculations they need at the workbench. The technical domain covers six areas: (1) binary STL file generation from mesh data, (2) ZIP file creation in the browser, (3) STEP file export via replicad, (4) volume calculation for plaster cavity and pot interior, (5) plaster/water weight calculation from volume, and (6) browser file download triggering.

The standard approach is: use replicad's built-in `blobSTL({ binary: true })` and `blobSTEP()` methods on the WASM shapes (before they are meshed and transferred), use JSZip 3.10.1 via CDN to bundle the files, and use replicad's `measureVolume()` function to calculate cavity and pot volumes from the B-rep solids. The plaster math uses the standard Keith Simpson formula (volume_cc * 0.011 = grams of water, then water * 100/70 = grams of plaster). The download is triggered via the standard Blob + createObjectURL + anchor click pattern.

**Primary recommendation:** Generate STL and STEP blobs inside the Web Worker using replicad's native export methods (`shape.blobSTL()` and `shape.blobSTEP()`), measure volumes with `measureVolume()`, then transfer the blobs and volume data to the main thread where JSZip bundles them into a ZIP with a text readme.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| JSZip | 3.10.1 | ZIP file creation in browser | Most widely used browser ZIP library, CDN available, simple API, handles binary data |
| replicad blobSTL | 0.20.5 | Binary STL generation | Built into replicad, operates on B-rep shapes directly, no separate STL encoder needed |
| replicad blobSTEP | 0.20.5 | STEP file generation | Built into replicad, uses OpenCASCADE's native STEP writer |
| replicad measureVolume | 0.20.5 | Volume calculation | Uses OpenCASCADE GProp, exact B-rep volume (not mesh approximation) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| FileSaver.js | N/A | File download trigger | NOT NEEDED -- use native Blob + createObjectURL + anchor click |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JSZip (95KB) | fflate (8KB) | fflate is smaller and faster but has no UMD/global build for CDN script tag. JSZip works as a script tag with `window.JSZip` |
| replicad blobSTL | Custom binary STL encoder from mesh arrays | Unnecessary -- replicad already has the capability. Custom encoder would duplicate work |
| replicad blobSTL | Three.js STLExporter | Would require constructing BufferGeometry just to export; adds complexity. replicad exports directly from B-rep |
| replicad measureVolume | Signed tetrahedra on mesh triangles | Mesh-based volume is approximate; replicad's B-rep volume is exact |

**Installation:**
```html
<!-- Add to index.html head, alongside existing CDN scripts -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
```

No npm install needed. JSZip via CDN script tag exposes `window.JSZip` globally.

## Architecture Patterns

### Recommended Project Structure
```
js/
  workers/
    geometryWorker.js   # MODIFIED: new 'exportParts' and 'calculateVolumes' commands
  geometryBridge.js     # MODIFIED: new exportParts() and calculateVolumes() methods
  exportManager.js      # NEW: orchestrates export flow (ZIP bundling, readme generation, download)
  plasterCalculator.js  # NEW: pure math module for plaster/water calculations
  app.js                # MODIFIED: wire export button and plaster display
```

### Pattern 1: Worker-Side Export Generation
**What:** STL/STEP blobs and volume measurements are computed inside the Web Worker, where the replicad shapes exist. The blobs are transferred to the main thread as Transferable objects.
**When to use:** Always. The shapes only exist in the worker's WASM memory.
**Why:** replicad's `blobSTL()` and `blobSTEP()` operate on B-rep Shape objects, not mesh arrays. The shapes are created and live in the worker. After `shape.mesh()` extracts triangles, the shape is `.delete()`'d by withCleanup(). Export must happen BEFORE mesh extraction (while the shape still exists) or during a separate export command that re-generates the shapes.

```javascript
// In geometryWorker.js -- new 'exportParts' command handler
case 'exportParts': {
  await initialize();
  const { profilePoints, mouldParams, resolution } = params;
  const exportData = exportMouldParts(profilePoints, mouldParams, resolution);

  // Transfer blob ArrayBuffers for zero-copy
  const transferList = [];
  for (const [name, blob] of Object.entries(exportData.stlBlobs)) {
    transferList.push(blob);  // Blob is not Transferable, but ArrayBuffer is
  }

  self.postMessage({ id, data: exportData }, transferList);
  break;
}
```

**Critical insight:** Blobs are NOT Transferable. Convert to ArrayBuffer first via `blob.arrayBuffer()`, or read the Blob in the worker and send the ArrayBuffer. On the main thread, reconstruct as Blob for JSZip.

### Pattern 2: Two-Tier Resolution for STL Export
**What:** Use different `tolerance` and `angularTolerance` values for standard vs high resolution STL.
**When to use:** User selects resolution before downloading.

```javascript
// Resolution presets for shape.blobSTL()
const STL_RESOLUTION = {
  standard: { tolerance: 0.1, angularTolerance: 0.3 },  // Same as current preview mesh
  high:     { tolerance: 0.01, angularTolerance: 0.1 },  // ~10x finer tessellation
};

// In worker: generate binary STL blob
const stlBlob = shape.blobSTL({
  binary: true,
  tolerance: STL_RESOLUTION[resolution].tolerance,
  angularTolerance: STL_RESOLUTION[resolution].angularTolerance,
});
```

### Pattern 3: Volume Calculation in Worker
**What:** Use replicad's `measureVolume()` on the B-rep shapes before cleanup.
**When to use:** During mould generation (add volumes to the result), and/or during export.

```javascript
// In geometryWorker.js, import measureVolume
// measureVolume is exported from replicad's measureShape module
import(REPLICAD_CDN).then(mod => {
  measureVolume = mod.measureVolume;
});

// During generation, measure volumes before shapes are deleted
const proofVolume = measureVolume(proofShape);    // cc (mm^3 / 1000)
const innerMouldVolume = measureVolume(mouldSolid); // full solid before shell
```

### Pattern 4: Main-Thread ZIP Assembly
**What:** The main thread receives STL ArrayBuffers from the worker, then uses JSZip to bundle them with a text readme.
**When to use:** Always. JSZip runs on the main thread (loaded via CDN script tag, not available in worker).

```javascript
// In exportManager.js
async function createExportZip(stlBuffers, volumes, mouldParams, profileName) {
  const zip = new JSZip();
  const folder = zip.folder(profileName || 'mould-parts');

  // Add binary STL files
  for (const [name, buffer] of Object.entries(stlBuffers)) {
    folder.file(`${name}.stl`, buffer);
  }

  // Add readme with assembly instructions and plaster calculations
  const readme = generateReadme(volumes, mouldParams);
  folder.file('README.txt', readme);

  // Generate ZIP as Blob
  const blob = await zip.generateAsync({ type: 'blob' });
  return blob;
}
```

### Pattern 5: Browser Download Trigger
**What:** Standard Blob + anchor click pattern for downloading files.
**When to use:** For both ZIP download and individual file downloads.

```javascript
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a delay to ensure download starts
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

### Anti-Patterns to Avoid
- **Generating STL from mesh arrays on main thread:** The vertex/normal/triangle arrays already exist from the preview, but building STL from them would require a custom binary STL encoder. Unnecessary since replicad has `blobSTL()`.
- **Loading JSZip in the worker:** JSZip's CDN build uses `window` references internally. It does not work in a Web Worker without modification. Keep it on the main thread.
- **Re-using preview mesh for STL export:** The preview uses `tolerance: 0.1` which is fine for display but may be too coarse for 3D printing. Export should use its own resolution settings.
- **Trying to measure volume from mesh triangles:** The signed tetrahedra method works but gives approximate results. replicad's `measureVolume()` uses exact B-rep calculations via OpenCASCADE.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Binary STL encoding | Custom ArrayBuffer writer for STL header + triangles | `shape.blobSTL({ binary: true })` | replicad already handles the full STL spec correctly including normals |
| STEP file export | Nothing -- STEP is an extremely complex format | `shape.blobSTEP()` | STEP (ISO 10303) is thousands of pages of spec. OpenCASCADE implements it |
| ZIP file creation | Manual ZIP structure with Uint8Arrays | JSZip | ZIP format has CRC32, deflation, central directory. JSZip handles all of it |
| Volume measurement | Signed tetrahedra sum on mesh triangles | `measureVolume(shape)` | B-rep volume is mathematically exact; mesh volume depends on tessellation quality |
| File download | Custom iframe/form-based download | Blob + createObjectURL + anchor click | Standard pattern, works in all modern browsers |

**Key insight:** The replicad/OpenCASCADE WASM kernel already contains industrial-grade implementations of STL export, STEP export, and volume measurement. Using these avoids duplicating complex geometry code and produces more accurate results.

## Common Pitfalls

### Pitfall 1: Shapes Deleted Before Export
**What goes wrong:** The current `generateMouldParts()` function uses `withCleanup()` which `.delete()`s all WASM shapes after mesh extraction. If export runs after generation, the shapes no longer exist.
**Why it happens:** The memory management pattern (which is correct for preview) eagerly frees shapes.
**How to avoid:** Either (a) add export logic INSIDE the `withCleanup()` callback alongside mesh extraction, or (b) create a separate export command that regenerates the shapes specifically for export. Option (b) is cleaner -- export is infrequent and regeneration takes <1 second.
**Warning signs:** "Cannot access deleted shape" errors from WASM.

### Pitfall 2: Blob Transfer Between Worker and Main Thread
**What goes wrong:** Blobs are NOT Transferable objects. Attempting to include a Blob in a postMessage transfer list causes a TypeError.
**Why it happens:** The Transferable interface only supports ArrayBuffer, MessagePort, ImageBitmap, and a few others. Blob is not one of them.
**How to avoid:** In the worker, convert Blob to ArrayBuffer via `await blob.arrayBuffer()`, then transfer the ArrayBuffer. On the main thread, reconstruct as `new Blob([buffer])` or pass the ArrayBuffer directly to JSZip (which accepts Uint8Array/ArrayBuffer).
**Warning signs:** "Failed to execute 'postMessage' on 'Worker': Blob is not Transferable."

### Pitfall 3: JSZip Not Available in Worker
**What goes wrong:** Attempting to use `new JSZip()` inside the Web Worker throws "JSZip is not defined".
**Why it happens:** The CDN script tag (`<script src="jszip.min.js">`) only loads into the main thread's global scope (`window.JSZip`). Workers have their own global scope.
**How to avoid:** Keep ZIP assembly on the main thread. Worker sends STL/STEP ArrayBuffers; main thread bundles into ZIP.
**Warning signs:** ReferenceError in worker.

### Pitfall 4: STEP Export Blocking the Worker for Too Long
**What goes wrong:** `blobSTEP()` on complex shapes can take several seconds, blocking the worker from processing other messages.
**Why it happens:** STEP export serializes the full B-rep topology (faces, edges, vertices, tolerances) into a text format. This is CPU-intensive.
**How to avoid:** Show a progress indicator ("Generating STEP file...") and accept that the worker will be busy. Since STEP is a Pro feature used infrequently, this is acceptable. If needed, a second worker could be spawned for export.
**Warning signs:** UI appears frozen during STEP export (but it won't because we use a worker).

### Pitfall 5: Plaster Calculation Units Confusion
**What goes wrong:** Volume from `measureVolume()` is in cubic millimeters (mm^3) because the model uses mm as the unit. Plaster calculations expect cm^3 (= mL).
**Why it happens:** replicad/OpenCASCADE returns volume in the cube of the model's units. The profile uses mm, so volume is mm^3.
**How to avoid:** Always convert: `volumeCc = volumeMm3 / 1000`. Document the unit chain clearly.
**Warning signs:** Plaster weight is 1000x too large or too small.

### Pitfall 6: Cavity Volume Calculation
**What goes wrong:** Attempting to calculate cavity volume as outerVolume - innerVolume ignores the ring and assembly features, giving an inaccurate result.
**Why it happens:** The plaster cavity is the space between inner mould outer surface and outer mould inner surface, minus the ring solid, minus ridges.
**How to avoid:** The most accurate approach is to fuse the inner mould + ring into one solid, then Boolean-subtract it from the outer mould to get the cavity solid, then measure that volume. However, this is computationally expensive. A practical approximation is: `cavityVolume = (outerCylinderVolume - innerMouldOuterVolume) - ringVolume`. For v1, the cylindrical outer mould makes this easy: it's approximately `pi * (R_outer^2 - R_inner^2) * height` minus the ring volume.
**Warning signs:** Plaster amount is wildly incorrect when tested with a physical pour.

## Code Examples

Verified patterns from official sources:

### Binary STL Export with replicad (HIGH confidence)
```javascript
// Source: replicad shapes.ts blobSTL method
// shape is a replicad Solid (e.g., from buildAndRevolve())
const stlBlob = shape.blobSTL({
  binary: true,
  tolerance: 0.1,        // linear deflection (mm)
  angularTolerance: 0.3,  // angular deflection (radians)
});
// Returns a Blob of type 'model/stl'

// Convert to ArrayBuffer for worker transfer:
const stlBuffer = await stlBlob.arrayBuffer();
```

### STEP Export with replicad (HIGH confidence)
```javascript
// Source: replicad shapes.ts blobSTEP method
// No parameters -- STEP uses exact B-rep, no tessellation needed
const stepBlob = shape.blobSTEP();
// Returns a Blob of type 'application/step'

const stepBuffer = await stepBlob.arrayBuffer();
```

### Volume Measurement with replicad (HIGH confidence)
```javascript
// Source: replicad measureShape.ts
// measureVolume is exported from the replicad module
// import { measureVolume } from 'replicad';
// In our CDN setup: loaded via dynamic import alongside draw, setOC, etc.

const volumeMm3 = measureVolume(shape);  // returns number in model units cubed (mm^3)
const volumeCc = volumeMm3 / 1000;       // convert to cm^3 = mL
```

### JSZip ZIP Creation (HIGH confidence)
```javascript
// Source: https://stuk.github.io/jszip/documentation/examples.html
// JSZip loaded via CDN script tag: window.JSZip available globally

const zip = new JSZip();

// Add binary STL files (from ArrayBuffer or Uint8Array)
zip.file('inner-mould.stl', innerMouldBuffer);
zip.file('outer-front.stl', outerFrontBuffer);
zip.file('outer-back.stl', outerBackBuffer);
zip.file('ring-front.stl', ringFrontBuffer);
zip.file('ring-back.stl', ringBackBuffer);

// Add text readme
zip.file('README.txt', readmeString);

// Generate as Blob for download
const blob = await zip.generateAsync({ type: 'blob' });
```

### Browser File Download (HIGH confidence)
```javascript
// Source: MDN Web APIs - URL.createObjectURL
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Usage:
downloadBlob(zipBlob, 'pottery-mould.zip');
```

### Plaster Calculation (MEDIUM confidence - formula verified from multiple potter sources)
```javascript
// Plaster mixing calculation for USG No.1 Pottery Plaster
// Ratio: 100 parts plaster to 70 parts water by weight
// Source: USG official data sheet + Keith Simpson formula

/**
 * Calculate plaster and water amounts for a given cavity volume.
 *
 * The Keith Simpson formula:
 *   waterGrams = volumeCubicInches * 11
 *   plasterGrams = waterGrams * (100 / 70)
 *
 * Converted to metric (1 cubic inch = 16.387 cm^3):
 *   waterGrams = volumeCc * (11 / 16.387) = volumeCc * 0.6713
 *   plasterGrams = waterGrams * (100 / 70) = waterGrams * 1.4286
 *
 * Alternatively, derived from first principles:
 *   At 70:100 consistency, the wet plaster slurry has a density of ~1.58 g/cm^3
 *   So for a given cavity volume:
 *     totalSlurryWeight = volumeCc * 1.58  (grams)
 *     Since ratio is 70:100 (water:plaster), total parts = 170
 *     waterWeight = totalSlurryWeight * (70/170)
 *     plasterWeight = totalSlurryWeight * (100/170)
 *
 * Both methods give similar results. Using the slurry density method:
 */
function calculatePlaster(cavityVolumeCc) {
  const SLURRY_DENSITY = 1.58;  // g/cm^3 for USG No.1 at 70:100 consistency
  const WATER_RATIO = 70;
  const PLASTER_RATIO = 100;
  const TOTAL_RATIO = WATER_RATIO + PLASTER_RATIO;  // 170

  const totalSlurryGrams = cavityVolumeCc * SLURRY_DENSITY;
  const waterGrams = totalSlurryGrams * (WATER_RATIO / TOTAL_RATIO);
  const plasterGrams = totalSlurryGrams * (PLASTER_RATIO / TOTAL_RATIO);
  const waterMl = waterGrams;  // water density = 1 g/mL

  return {
    cavityVolumeCc,
    totalSlurryGrams,
    waterGrams: Math.round(waterGrams),
    waterMl: Math.round(waterMl),
    plasterGrams: Math.round(plasterGrams),
  };
}
```

### Signed Tetrahedra Volume (BACKUP - if measureVolume unavailable)
```javascript
// Source: Nervous System blog + divergence theorem
// For mesh with vertices (Float32Array) and triangles (Uint32Array)
// Only needed if replicad's measureVolume() is not usable

function meshVolume(vertices, triangles) {
  let volume = 0;
  for (let i = 0; i < triangles.length; i += 3) {
    const i0 = triangles[i] * 3;
    const i1 = triangles[i + 1] * 3;
    const i2 = triangles[i + 2] * 3;

    const ax = vertices[i0], ay = vertices[i0 + 1], az = vertices[i0 + 2];
    const bx = vertices[i1], by = vertices[i1 + 1], bz = vertices[i1 + 2];
    const cx = vertices[i2], cy = vertices[i2 + 1], cz = vertices[i2 + 2];

    // Signed volume of tetrahedron from origin to triangle
    // V = (1/6) * (a . (b x c))
    volume += (
      ax * (by * cz - bz * cy) +
      ay * (bz * cx - bx * cz) +
      az * (bx * cy - by * cx)
    );
  }
  return Math.abs(volume / 6);  // mm^3
}
```

### Worker Export Command Pattern
```javascript
// In geometryWorker.js -- complete export command handler
case 'exportParts': {
  await initialize();
  const { profilePoints, mouldParams, resolution } = params;

  const meshOpts = resolution === 'high'
    ? { tolerance: 0.01, angularTolerance: 0.1 }
    : { tolerance: 0.1, angularTolerance: 0.3 };

  const result = withCleanup(async (track) => {
    const stlBuffers = {};
    const volumes = {};

    // Re-generate shapes (they don't persist from preview)
    const proofShape = track(buildAndRevolve(profilePoints));
    volumes.potVolumeMm3 = measureVolume(proofShape);

    const scaledPoints = scaleProfileForShrinkage(profilePoints, mouldParams.shrinkageRate);
    // ... (same generation logic as generateMouldParts)

    // For each shape, generate STL blob and convert to ArrayBuffer
    const proofBlob = proofShape.blobSTL({
      binary: true,
      ...meshOpts,
    });
    stlBuffers['proof-model'] = await proofBlob.arrayBuffer();

    // ... repeat for inner-mould, outer pieces, ring pieces

    return { stlBuffers, volumes };
  });

  // Transfer all ArrayBuffers
  const transferList = Object.values(result.stlBuffers);
  self.postMessage({ id, data: result }, transferList);
  break;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Three.js STLExporter from BufferGeometry | replicad blobSTL from B-rep | Available since replicad 0.15+ | Direct B-rep export is more accurate, no intermediate mesh needed for STL |
| ASCII STL (text) | Binary STL | Standard since ~2015 | Binary is 5-10x smaller file size, faster to parse in slicers |
| FileSaver.js for downloads | Native Blob + createObjectURL | ~2020+ | No library dependency needed, all modern browsers support it |
| pako for ZIP compression | JSZip 3.x (uses pako internally) or fflate | JSZip 3.0 (2016) | Higher-level API, handles ZIP structure automatically |

**Deprecated/outdated:**
- Three.js `Geometry` class: Removed in r125. Use `BufferGeometry` only. (Not relevant since we use replicad's export, not Three.js export.)
- `saveAs()` from FileSaver.js: Unnecessary polyfill in 2026. All target browsers support Blob + createObjectURL.
- ASCII STL: Avoid for mould files. Binary STL is universally supported and much smaller.

## Open Questions

Things that couldn't be fully resolved:

1. **measureVolume availability in CDN build**
   - What we know: `measureVolume` is exported from replicad's `measureShape.ts` and re-exported from `index.ts`.
   - What's unclear: Whether the CDN bundle at `jsdelivr.net/npm/replicad@0.20.5/dist/replicad.js` includes this function or if it's tree-shaken out.
   - Recommendation: Test during implementation by importing `measureVolume` alongside `draw`, `setOC`, etc. If not available, fall back to the signed tetrahedra mesh-based calculation (code provided above).

2. **blobSTL in Web Worker context**
   - What we know: `blobSTL()` returns a `Blob`. Blobs exist in Workers.
   - What's unclear: Whether `shape.blobSTL()` works correctly inside a Web Worker context (Blob constructor is available in workers but some edge cases exist).
   - Recommendation: Test early. If Blob construction fails in worker, the method may return raw data that can be wrapped differently.

3. **Exact slurry density for USG No.1**
   - What we know: USG data sheet says wet density is 99 lb/ft^3 = ~1.585 g/cm^3. Various potter sources use 1.58-1.67 g/cm^3.
   - What's unclear: The exact value varies by mixing consistency and temperature.
   - Recommendation: Use 1.58 g/cm^3 as the baseline. Add 10% margin in the readme ("mix slightly more than calculated"). The calculations are practical estimates, not precise engineering values.

4. **Cavity volume accuracy**
   - What we know: The cavity is the space between inner mould (shelled) and outer mould, minus ring and assembly features.
   - What's unclear: Whether subtracting individual volumes is accurate enough or whether a Boolean cavity solid is needed.
   - Recommendation: For v1, use analytical approximation: `pi * (R_outer^2 - R_inner^2) * height - ringVolume`. The outer mould is cylindrical so this is straightforward. If `measureVolume()` works, we can also measure each solid and subtract.

## Sources

### Primary (HIGH confidence)
- replicad shapes.ts source code - `blobSTL({ binary, tolerance, angularTolerance })` and `blobSTEP()` method signatures verified
- replicad measureShape.ts source code - `measureVolume(shape)` function verified, wraps OpenCASCADE GProp_GProps
- replicad index.ts - confirms `measureShape` module is re-exported
- JSZip 3.10.1 official docs (https://stuk.github.io/jszip/) - API for file(), generateAsync(), CDN availability
- Binary STL format specification (Wikipedia, LOC) - 80-byte header + 4-byte count + 50 bytes per triangle
- MDN URL.createObjectURL documentation

### Secondary (MEDIUM confidence)
- USG No.1 Pottery Plaster data sheet - 70:100 water:plaster ratio, 99 lb/ft^3 wet density
- Keith Simpson plaster formula (volumeCubicInches * 11 = grams water)
- Glazy plaster calculator (https://plaster.glazy.org/) - cross-reference for calculation approach
- vue-plaster-calculator GitHub - three formula methods documented (USG, Simpson, Martin)

### Tertiary (LOW confidence)
- Exact slurry density value (1.58 vs 1.67 g/cm^3) - varies by source and mixing conditions
- withCleanup async support - current withCleanup is synchronous; may need modification for async blob.arrayBuffer() calls

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - replicad methods verified in source code, JSZip CDN verified
- Architecture: HIGH - worker-side export with main-thread ZIP assembly is the only viable pattern given existing codebase
- STL/STEP export: HIGH - replicad blobSTL/blobSTEP API verified in source
- Volume calculation: HIGH - replicad measureVolume verified in source, though CDN availability needs runtime test
- Plaster math: MEDIUM - formula verified from multiple potter sources, but exact slurry density is approximate
- Pitfalls: HIGH - Blob transfer, shape lifecycle, and JSZip worker limitations are well-documented issues

**Research date:** 2026-02-10
**Valid until:** 2026-04-10 (90 days - stable domain, libraries not changing rapidly)
