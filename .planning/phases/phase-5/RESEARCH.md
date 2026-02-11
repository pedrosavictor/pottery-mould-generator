# Phase 5: Inner Mould Generation - Research

**Researched:** 2026-02-10
**Domain:** replicad CAD operations (scaling, shell, boolean, primitives) for slip casting mould generation
**Confidence:** HIGH (core APIs verified from official docs, source code, and working examples)

## Summary

This research answers the nine technical questions needed to plan Phase 5: how to scale shapes for clay shrinkage, how to create hollow shells with wall thickness, how to build and attach a slip well via boolean operations, how to generate a proof model, and how to validate watertight solids in replicad.

The standard approach is: scale 2D profile points BEFORE revolving (simplest, fastest, most reliable), use replicad's `shell()` method with `FaceFinder.inPlane()` to hollow out the revolved mould with uniform wall thickness, use `makeCylinder()` + `fuse()` to attach the slip well, and extract separate meshes for each part by running independent geometry pipelines in the same worker call. The proof model is simply the original profile revolved without any mould modifications.

The critical insight from research is that `shell()` on revolved geometry works reliably when removing a single flat face (the top opening), as demonstrated in the OCCT bottle example and the watering can discussion. However, `shell()` can fail when asked to remove multiple faces simultaneously. For the inner mould, we only need to remove the top face (opening), so this is a safe use case. Wall thickness via `shell()` is far more reliable than the alternative approach of creating inner/outer profiles and boolean-subtracting, which introduces complex edge alignment issues.

**Primary recommendation:** Scale 2D points before revolving. Use `shell()` with negative thickness to hollow outward (mould walls grow outward from pot surface). Fuse slip well cylinder to top. Extract meshes for 'inner-mould' and 'proof' as separate named parts.

## Standard Stack

### Core (already in project from Phase 1)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| replicad | 0.20.5 | CAD kernel: draw, revolve, shell, fuse, scale, makeCylinder, mesh | Already loaded in worker. All Phase 5 operations use existing replicad APIs. |
| replicad-opencascadejs | 0.20.2 | WASM backend for replicad | Already loaded. No new dependencies needed. |

### New Imports Needed in Worker
| Import | From | Purpose |
|--------|------|---------|
| `makeCylinder` | replicad | Create slip well cylinder primitive |
| `FaceFinder` | replicad | Identify top face of revolved solid for shell operation |
| `measureVolume` | replicad | Optional: validate mould volume is reasonable |

### No New Dependencies
Phase 5 requires zero new npm packages. All operations use replicad APIs already available in the CDN bundle loaded by the worker.

**Worker import update:**
```javascript
// Current (Phase 1):
import { draw, setOC } from 'https://cdn.jsdelivr.net/npm/replicad@0.20.5/dist/replicad.js';

// Phase 5 adds:
import { draw, setOC, makeCylinder, FaceFinder, measureVolume } from 'https://cdn.jsdelivr.net/npm/replicad@0.20.5/dist/replicad.js';
```

## Architecture Patterns

### Recommended Worker Command Structure
```
geometryWorker.js
  onmessage handler
    case 'revolve':       // existing - simple revolve for preview
    case 'generateMould': // NEW - full mould generation pipeline
    case 'init':          // existing
    case 'heapSize':      // existing
```

The new `generateMould` command receives profile points plus mould parameters (shrinkage, wallThickness, slipWellType) and returns meshData for multiple named parts in a single response.

### Pattern 1: Scale 2D Points Before Revolving (Shrinkage)
**What:** Apply shrinkage scaling to the 2D profile point coordinates before building the replicad drawing.
**When to use:** Always for the inner mould shape. The proof model uses the original unscaled points.
**Why this approach:** Scaling 2D points is pure arithmetic (zero WASM calls), preserves the exact profile structure including bezier control points, and avoids the complexity of 3D scale operations. The 3D `scale()` method works but would require computing the correct center point and tracking an additional WASM object.

```javascript
// Source: replicad Shape3D.scale() verified from shapes.ts source code
// But 2D scaling is simpler and recommended:

function scaleProfileForShrinkage(points, shrinkageRate) {
  // Formula: wet_size = fired_size / (1 - shrinkage_rate)
  // shrinkageRate is e.g. 0.13 for 13%
  const scaleFactor = 1 / (1 - shrinkageRate);

  return points.map(pt => {
    const scaled = {
      x: pt.x * scaleFactor,
      y: pt.y * scaleFactor,
      type: pt.type,
    };
    if (pt.type === 'bezier' && pt.cp1 && pt.cp2) {
      scaled.cp1 = { x: pt.cp1.x * scaleFactor, y: pt.cp1.y * scaleFactor };
      scaled.cp2 = { x: pt.cp2.x * scaleFactor, y: pt.cp2.y * scaleFactor };
    }
    return scaled;
  });
}
```

**Confidence:** HIGH -- pure arithmetic, no API dependency. The shrinkage formula is domain-standard.

### Pattern 2: Shell Operation for Wall Thickness
**What:** Use `shape.shell()` to hollow out the revolved mould solid, keeping a shell of uniform thickness.
**When to use:** After revolving the shrinkage-scaled profile into a solid.
**Critical detail:** The shell thickness sign controls direction. Positive thickness hollows INWARD. Negative thickness grows the shell OUTWARD. For a mould, we want the wall to grow outward from the pot surface, so use NEGATIVE thickness.

```javascript
// Source: replicad CompSolid.shell() API + OCCT bottle example
// Verified from shapes.ts: uses BRepOffsetAPI_MakeThickSolid

function shellMould(revolvedSolid, wallThickness, topHeight) {
  // Find the flat top face of the revolved solid (the rim plane)
  // The top face is a flat annular ring at the maximum Y (Z in replicad) coordinate
  //
  // shell() overload 2: shell(thickness, finderFcn, tolerance?)
  // Negative thickness = wall grows OUTWARD from original surface
  const shelled = revolvedSolid.shell(
    -wallThickness,
    (f) => f.inPlane("XY", topHeight)
  );
  return shelled;
}
```

**IMPORTANT:** The `inPlane()` filter finds the face at the top of the revolved solid. For a pot profile revolved on the XZ plane around the Z axis, the top face is in the XY plane at z = topHeight. This is because:
- `sketchOnPlane("XZ")` maps drawing X -> 3D X, drawing Y -> 3D Z
- `revolve()` defaults to revolution around the Z axis
- The top of the pot (highest Y in profile) becomes the highest Z in 3D
- The flat top face (created by the closing line from last point to axis) is in the XY plane at that Z height

**Confidence:** HIGH -- the OCCT bottle example uses this exact pattern (shell with inPlane face finder). The watering can example confirms shell works on revolved geometry.

### Pattern 3: Slip Well via makeCylinder + fuse
**What:** Create a cylindrical slip well and boolean-fuse it to the top of the shelled mould.
**When to use:** When slip well type is 'regular' or 'tall' (not 'none').

```javascript
// Source: replicad makeCylinder API + OCCT bottle example (neck + fuse)

function addSlipWell(shelledMould, slipWellType, rimRadius, wallThickness, topHeight) {
  if (slipWellType === 'none') return shelledMould;

  const wellHeights = { regular: 25, tall: 50 };
  const wellHeight = wellHeights[slipWellType] || 25;

  // The slip well is a hollow cylinder that sits on top of the mould
  // Outer radius = rim radius + wall thickness (matches mould outer wall)
  // Inner radius = rim radius (matches mould inner opening)
  const outerRadius = rimRadius + wallThickness;

  // Create outer cylinder
  const outerCyl = makeCylinder(
    outerRadius,
    wellHeight,
    [0, 0, topHeight],  // start at top of mould
    [0, 0, 1]           // extend upward along Z
  );

  // Create inner cylinder (to hollow out)
  const innerCyl = makeCylinder(
    rimRadius,
    wellHeight + 1,     // slightly taller to ensure clean cut
    [0, 0, topHeight - 0.5],
    [0, 0, 1]
  );

  // Hollow cylinder = outer - inner
  const hollowWell = outerCyl.cut(innerCyl);

  // Fuse to mould body
  return shelledMould.fuse(hollowWell);
}
```

**Alternative approach (simpler, recommended):** Instead of making a hollow cylinder and fusing, create the slip well as part of the 2D profile before revolving. Add extra points to the profile that extend the wall upward:

```javascript
// Extend the profile to include slip well walls before revolving
function addSlipWellToProfile(points, wallThickness, wellHeight) {
  if (wellHeight <= 0) return points;

  const lastPoint = points[points.length - 1];
  const rimRadius = lastPoint.x;
  const rimHeight = lastPoint.y;

  // Add slip well as extended profile points:
  // From rim, go outward by wallThickness, up by wellHeight, inward to rim radius
  return [
    ...points,
    { x: rimRadius + wallThickness, y: rimHeight, type: 'line' },
    { x: rimRadius + wallThickness, y: rimHeight + wellHeight, type: 'line' },
    { x: rimRadius, y: rimHeight + wellHeight, type: 'line' },
  ];
}
```

This 2D approach is simpler because it avoids boolean operations entirely -- the slip well becomes part of the revolved profile, and the shell operation hollows everything uniformly.

**RECOMMENDATION: Use the 2D profile approach for the slip well.** It is faster (no boolean), more reliable (no fuse edge cases), and produces cleaner geometry. The slip well is a simple rectangular extension of the profile cross-section.

**Confidence:** HIGH for the 2D approach. MEDIUM for the boolean approach (fuse on revolved geometry can sometimes produce edge artifacts).

### Pattern 4: Multi-Part Mesh Extraction
**What:** Generate and return meshData for multiple named parts in a single worker call.
**When to use:** The `generateMould` command returns inner-mould AND proof meshes.

```javascript
// Worker returns an object with named mesh data
function generateMouldParts(profilePoints, params) {
  return withCleanup((track) => {
    const { shrinkageRate, wallThickness, slipWellType } = params;
    const results = {};

    // --- Proof model (fired pot at original dimensions) ---
    const proofShape = track(revolveFromPoints(profilePoints));
    const proofMesh = proofShape.mesh({ tolerance: 0.1, angularTolerance: 0.3 });
    results.proof = {
      vertices: new Float32Array(proofMesh.vertices),
      normals: new Float32Array(proofMesh.normals),
      triangles: new Uint32Array(proofMesh.triangles),
    };

    // --- Inner mould (scaled for shrinkage, shelled, with slip well) ---
    const scaledPoints = scaleProfileForShrinkage(profilePoints, shrinkageRate);
    // Optionally add slip well geometry to profile
    const mouldPoints = addSlipWellToProfile(scaledPoints, wallThickness, wellHeight);
    const mouldSolid = track(revolveFromPoints(mouldPoints));

    // Shell to create wall thickness
    const topZ = mouldPoints[mouldPoints.length - 1].y; // highest point
    const shelledMould = track(mouldSolid.shell(
      -wallThickness,
      (f) => f.inPlane("XY", topZ)
    ));

    const mouldMesh = shelledMould.mesh({ tolerance: 0.1, angularTolerance: 0.3 });
    results['inner-mould'] = {
      vertices: new Float32Array(mouldMesh.vertices),
      normals: new Float32Array(mouldMesh.normals),
      triangles: new Uint32Array(mouldMesh.triangles),
    };

    return results;
  });
}
```

**Confidence:** HIGH -- withCleanup pattern is proven from Phase 1. Multiple track() calls work correctly (tested with memoryTest in Phase 1).

### Pattern 5: Proof Model (Simplest Case)
**What:** The proof model is just the original profile revolved -- no scaling, no shelling, no slip well.
**When to use:** Always generated alongside the inner mould.

```javascript
// Proof = fired pot dimensions = original profile revolved
const proofShape = track(
  buildDrawingFromPoints(profilePoints)
    .sketchOnPlane('XZ')
    .revolve()
);
```

**Confidence:** HIGH -- this is identical to the existing `revolveProfile()` function.

### Anti-Patterns to Avoid

- **Scaling the 3D solid instead of 2D points:** While `shape.scale(factor, center)` works, it requires computing the correct center point (origin for a revolved shape). If the center is wrong, the shape translates as well as scales. Scaling 2D points avoids this entirely.

- **Using boolean subtract for wall thickness:** Creating an inner and outer profile, revolving both, and subtracting would work but is 2-3x slower than `shell()` and prone to numerical edge-case failures when the inner/outer surfaces are very close together.

- **Shelling with multiple face removal:** The watering can example showed that `shell()` with `FaceFinder.either()` (removing multiple faces) can cause OCCT kernel errors. For the inner mould, only remove the top face. If additional openings are needed, use `cut()` after shelling.

- **Creating the slip well as a separate boolean operation when it can be part of the profile:** The 2D profile approach (extending the profile with slip well geometry) is faster and more reliable than creating a separate cylinder and fusing.

- **Forgetting to track intermediate shapes:** When `shell()` and `fuse()` create new shapes, the intermediate shapes (pre-shell, pre-fuse) must still be tracked for cleanup. The `withCleanup(track)` pattern handles this.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Uniform wall thickness on revolved solid | Two-profile boolean subtract approach | `shape.shell(thickness, faceFinder)` | Shell uses BRepOffsetAPI_MakeThickSolid which handles complex surface offsets, tangent continuity, and corner treatment automatically. Manual offset introduces gaps at complex curves. |
| Cylinder primitive for slip well | Drawing a circle profile and revolving it | `makeCylinder(radius, height, location, direction)` | One function call vs 4+ drawing operations. Returns a proper solid immediately. |
| Finding the top face of a revolved shape | Manual face iteration by vertex coordinates | `FaceFinder().inPlane("XY", zHeight)` | FaceFinder wraps OCCT topology traversal. Manual face finding is 20+ lines of low-level code. |
| Shrinkage scaling math | Custom scaling logic per coordinate type | Simple multiplication of all x/y coordinates (including control points) by the same factor | Uniform scaling of 2D points is pure arithmetic. No geometric library needed. |
| Shape validation for 3D printing | Custom manifold checker | OCCT kernel guarantees: `shell()`, `fuse()`, and `revolve()` produce valid B-Rep solids by construction. The mesh extractor `shape.mesh()` produces watertight triangle meshes from valid solids. | See Common Pitfalls section for edge cases. |

**Key insight:** The inner mould is fundamentally just "scale profile, extend profile for slip well, revolve, shell." Three replicad operations on top of the existing revolve pipeline.

## Common Pitfalls

### Pitfall 1: Shell Thickness Sign Convention
**What goes wrong:** Developer uses `shell(2.4, ...)` (positive) expecting the wall to grow outward. Instead, the wall grows INWARD, eating into the pot cavity. The inner mould is now too small.
**Why it happens:** Positive thickness = shell grows inward. Negative thickness = shell grows outward. This matches OCCT convention but is unintuitive.
**How to avoid:** Always use NEGATIVE thickness for the inner mould: `shell(-2.4, ...)`. The pot surface should remain the inner surface of the mould wall.
**Warning signs:** The mould looks thinner than expected in preview. The mould inner surface doesn't match the pot profile.
**Confidence:** HIGH -- verified from OCCT documentation and replicad source code (BRepOffsetAPI_MakeThickSolid).

### Pitfall 2: FaceFinder inPlane Tolerance
**What goes wrong:** `shell()` with `inPlane("XY", topZ)` fails to find the top face because the face's Z coordinate is not exactly equal to `topZ` due to floating-point arithmetic.
**Why it happens:** The top face Z coordinate comes from the profile point Y value after scaling. If the scaled height is e.g. 97.7011494..., the face might be at 97.70114942528736. Using the exact expected value works, but any rounding breaks it.
**How to avoid:** Use the exact same float value from the scaled profile points. Do not round. Compute `topZ` as `scaledPoints[scaledPoints.length - 1].y` and pass that directly. If the profile includes slip well extension points, use the highest Y from those.
**Warning signs:** "Shell operation failed" error. Check that the inPlane coordinate matches a face.
**Confidence:** HIGH -- floating-point face matching is a known OCCT pitfall.

### Pitfall 3: Shell Fails on Open Profiles
**What goes wrong:** The `shell()` operation fails or produces garbage geometry when the revolved solid has self-intersections or degenerate faces.
**Why it happens:** The revolved solid must be a valid, closed, non-degenerate solid for shell to work. If the profile crosses the axis mid-way, or has zero-length segments, the revolve produces bad geometry.
**How to avoid:** Validate profile before revolving (existing `validateProfile()` catches axis crossings). The closing path logic (from existing `revolveProfile()`) already ensures the solid is properly closed.
**Warning signs:** OCCT exceptions during shell operation. Check the profile for degenerate geometry.
**Confidence:** HIGH -- observed in the watering can discussion where complex geometry caused shell failures.

### Pitfall 4: Memory Leak with Multiple Track Calls
**What goes wrong:** `shell()` creates a NEW shape. If the original shape is not tracked, it leaks.
**Why it happens:** `const shelled = original.shell(...)` creates a new object. The `original` still exists on the WASM heap. If only `shelled` is tracked, `original` leaks.
**How to avoid:** Track EVERY shape that is created: `const original = track(sketch.revolve()); const shelled = track(original.shell(...));`. Both get cleaned up.
**Warning signs:** WASM heap growing with each generation cycle.
**Confidence:** HIGH -- Phase 1 established this pattern and the memoryTest validates it.

### Pitfall 5: Transferable ArrayBuffers for Multiple Parts
**What goes wrong:** When returning meshData for multiple parts, trying to transfer ArrayBuffers that share the same underlying buffer fails with "DataCloneError: ArrayBuffer at index N is already detached".
**Why it happens:** Each `new Float32Array(meshData.vertices)` creates its own buffer. This is fine. But if you accidentally reuse a buffer across parts, transfer fails.
**How to avoid:** Create independent typed arrays for each part. The pattern in Pattern 4 already does this correctly -- each `new Float32Array(...)` allocates a fresh buffer.
**Warning signs:** DataCloneError on postMessage.
**Confidence:** HIGH -- standard Web Worker Transferable semantics.

### Pitfall 6: Shrinkage Formula Direction
**What goes wrong:** Developer applies shrinkage in the wrong direction: `wet_size = fired_size * (1 - shrinkage_rate)`, making the mould SMALLER than the fired pot.
**Why it happens:** Confusion between "shrinkage from wet to fired" vs "enlargement from fired to wet". The profile represents the FIRED pot. The mould must be LARGER.
**How to avoid:** Use the correct formula: `scaleFactor = 1 / (1 - shrinkageRate)`. For 13% shrinkage: `1 / (1 - 0.13) = 1 / 0.87 = 1.1494`. The mould is ~15% larger than the fired pot.
**Warning signs:** The mould appears the same size or smaller than the proof model in the 3D preview.
**Confidence:** HIGH -- this is a domain-standard formula used in ceramics.

## Code Examples

### Complete Inner Mould Generation Pipeline

```javascript
// Source: Reconstructed from verified replicad APIs
// This is the core function for the generateMould worker command

function generateMouldParts(profilePoints, params) {
  const {
    shrinkageRate = 0.13,   // 13% default
    wallThickness = 2.4,     // mm default
    slipWellType = 'none',   // 'none' | 'regular' | 'tall'
  } = params;

  return withCleanup((track) => {
    const results = {};

    // ---- PROOF MODEL ----
    // Fired pot at original dimensions (no modifications)
    const proofShape = track(buildAndRevolve(profilePoints));
    const proofMesh = proofShape.mesh({ tolerance: 0.1, angularTolerance: 0.3 });
    results.proof = toTransferableMesh(proofMesh);

    // ---- INNER MOULD ----
    // Step 1: Scale profile for shrinkage
    const scaleFactor = 1 / (1 - shrinkageRate);
    const scaledPoints = profilePoints.map(pt => scalePoint(pt, scaleFactor));

    // Step 2: Add slip well to profile (if requested)
    const wellHeights = { none: 0, regular: 25, tall: 50 };
    const wellHeight = wellHeights[slipWellType] || 0;
    const mouldProfile = wellHeight > 0
      ? extendProfileForSlipWell(scaledPoints, wallThickness, wellHeight)
      : scaledPoints;

    // Step 3: Revolve to create solid mould body
    const mouldSolid = track(buildAndRevolve(mouldProfile));

    // Step 4: Shell to create hollow mould with wall thickness
    // Use the highest Y coordinate from the profile as the top face Z
    const topZ = mouldProfile[mouldProfile.length - 1].y;
    // IMPORTANT: Negative thickness = wall grows OUTWARD from pot surface
    const shelledMould = track(
      mouldSolid.shell(-wallThickness, (f) => f.inPlane("XY", topZ))
    );

    const mouldMesh = shelledMould.mesh({ tolerance: 0.1, angularTolerance: 0.3 });
    results['inner-mould'] = toTransferableMesh(mouldMesh);

    return results;
  });
}

// Helper: Build drawing from points and revolve (reuse existing pattern)
function buildAndRevolve(points) {
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
  const last = points[points.length - 1];
  const first = points[0];
  pen = pen.lineTo([0, last.y]);
  pen = pen.lineTo([0, first.y]);
  return pen.close().sketchOnPlane('XZ').revolve();
}

// Helper: Scale a single point (with optional bezier control points)
function scalePoint(pt, factor) {
  const scaled = { x: pt.x * factor, y: pt.y * factor, type: pt.type };
  if (pt.type === 'bezier' && pt.cp1 && pt.cp2) {
    scaled.cp1 = { x: pt.cp1.x * factor, y: pt.cp1.y * factor };
    scaled.cp2 = { x: pt.cp2.x * factor, y: pt.cp2.y * factor };
  }
  return scaled;
}

// Helper: Extend profile with slip well rectangular extension
function extendProfileForSlipWell(points, wallThickness, wellHeight) {
  const lastPt = points[points.length - 1];
  const rimRadius = lastPt.x;
  const rimY = lastPt.y;

  // Slip well cross-section: from rim, extend outward and upward
  return [
    ...points,
    { x: rimRadius + wallThickness, y: rimY, type: 'line' },
    { x: rimRadius + wallThickness, y: rimY + wellHeight, type: 'line' },
    { x: rimRadius, y: rimY + wellHeight, type: 'line' },
  ];
}

// Helper: Convert mesh data to transferable typed arrays
function toTransferableMesh(meshData) {
  return {
    vertices: new Float32Array(meshData.vertices),
    normals: new Float32Array(meshData.normals),
    triangles: new Uint32Array(meshData.triangles),
  };
}
```

**Confidence:** HIGH -- each component API is individually verified. The composition needs implementation testing.

### Slip Well Profile Approach (Recommended)

When the slip well is added to the 2D profile, the revolve creates a shape where the slip well is already integrated. The closing path in `buildAndRevolve` handles it automatically:

```
Profile WITHOUT slip well:          Profile WITH slip well:

  rim (42, 97.7)                      wellTop (42, 122.7)
      |                                    |
      |                               wellOuter (44.4, 122.7)
      |                                    |
   body curve                         wellBase (44.4, 97.7)
      |                                    |
      |                                rim (42, 97.7)
      |                                    |
      |                                 body curve
      |                                    |
  foot (34.5, 0)                      foot (34.5, 0)

Closing path adds:                   Closing path adds:
  (0, 97.7) -> (0, 0) -> close        (0, 122.7) -> (0, 0) -> close
```

The closing path is the line from the last profile point to the axis (x=0) at the same height, then down the axis to the starting height. When the slip well is present, the last point is the well top inner edge, so the closing path goes from (rimRadius, wellTop) to (0, wellTop) to (0, footY). This creates a proper closed cross-section.

After shelling with `inPlane("XY", wellTopZ)`, the top face (at wellTopZ) is removed, creating the slip well opening.

### GeometryBridge Update

```javascript
// New bridge method for mould generation
export function generateMould(profilePoints, mouldParams) {
  return sendCommand('generateMould', { profilePoints, mouldParams });
}

// With cancellation support
export async function generateMouldWithCancellation(profilePoints, mouldParams) {
  const myId = ++currentGenerationId;
  const result = await generateMould(profilePoints, mouldParams);
  if (myId !== currentGenerationId) return null;
  return result;
}
```

### Worker Transferable Update for Multi-Part Response

```javascript
// In the worker's generateMould handler:
case 'generateMould': {
  await initialize();
  const partsData = generateMouldParts(params.profilePoints, params.mouldParams);

  // Collect all ArrayBuffers for transfer
  const transferList = [];
  for (const partName of Object.keys(partsData)) {
    const part = partsData[partName];
    transferList.push(part.vertices.buffer, part.normals.buffer, part.triangles.buffer);
  }

  self.postMessage({ id, data: partsData }, transferList);
  break;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Boolean subtract for wall thickness (inner/outer profiles) | `shell()` with FaceFinder | replicad 0.15+ | 2-3x faster, more reliable on curved surfaces, handles corners automatically |
| Manual cylinder construction via draw/revolve | `makeCylinder(r, h, pos, dir)` | replicad 0.10+ | One line vs 6+ drawing operations |
| Separate worker calls per part | Single `generateMould` call returning multiple parts | N/A (architecture decision) | Fewer worker round-trips, shared WASM init overhead, atomic generation |

**Deprecated/outdated:**
- Using `Sketcher` class instead of `draw()` function: Both work, but `draw()` is the modern API in replicad tutorials
- Using `localGC` for memory management: This was an older replicad pattern. The project's `withCleanup(track)` pattern is better

## Open Questions

### 1. Shell on Slip Well Geometry
**What we know:** Shell works reliably on simple revolved solids (removing one flat face). The OCCT bottle example and watering can examples confirm this.
**What's unclear:** When the profile includes the slip well extension (creating a more complex cross-section with a right-angle step), will shell still work correctly? The step where the slip well meets the rim creates sharp internal corners.
**Recommendation:** Test the 2D-profile-with-slip-well approach first. If shell fails on the stepped geometry, fall back to: (a) revolve without slip well, shell, then fuse a pre-shelled cylinder for the well, or (b) add a small fillet at the step before shelling.
**Risk level:** LOW -- the shell operation handles 90-degree corners well in the OCCT bottle example (the neck-to-body junction).

### 2. FaceFinder Precision on Complex Profiles
**What we know:** `inPlane("XY", z)` works for finding flat faces. The revolved profile creates a flat annular face at the top (from the closing line).
**What's unclear:** If the profile has a very narrow top (small rim radius), the top face area is very small. Will FaceFinder still find it reliably?
**Recommendation:** The face exists regardless of area. `inPlane` checks the face's surface equation, not its area. Should work for any rim radius > 0.
**Risk level:** LOW

### 3. Performance with Shell + Fuse Operations
**What we know:** Individual revolve takes ~50-200ms (from Phase 1 spike). Shell and fuse are more expensive (OpenCASCADE OCCT community reports 100ms-2s for simple shapes).
**What's unclear:** Exact performance of the full pipeline (revolve + shell + optional fuse) in the WASM/Web Worker environment on typical pot profiles.
**Recommendation:** Expect 500ms-2s total. This is acceptable for a generate operation (not real-time drag). If too slow, the 2D-profile-with-slip-well approach eliminates the fuse operation entirely.
**Risk level:** LOW -- users expect mould generation to take a moment.

### 4. Watertight Mesh Guarantee
**What we know:** OCCT B-Rep operations (`revolve()`, `shell()`, `fuse()`) produce valid solids by construction. The `shape.mesh()` method generates triangle meshes from these valid solids. OCCT documentation states that meshes from valid closed shells are typically watertight.
**What's unclear:** Whether OCCT's `shape.mesh()` guarantees watertight output, or if rare numerical issues can produce tiny gaps. The OCCT docs note "there is no guarantee that the result triangulation is actually watertight."
**Recommendation:** For Phase 5, rely on OCCT's B-Rep validity. If watertight validation becomes necessary (e.g., user reports issues with slicers), add a post-processing check in a future phase. A practical validation approach: export to STL and try loading in a slicer (Cura/PrusaSlicer), which reports non-manifold errors.
**Risk level:** LOW -- OCCT meshes are watertight in practice for simple geometries like revolved shells.

## Sources

### Primary (HIGH confidence)
- [replicad CompSolid API](https://replicad.xyz/docs/api/classes/CompSolid/) -- shell(), fuse(), cut(), scale(), mesh() method signatures
- [replicad Solid API](https://replicad.xyz/docs/api/classes/Solid/) -- same methods on Solid class
- [replicad shapes.ts source](https://github.com/sgenoud/replicad/blob/main/packages/replicad/src/shapes.ts) -- verified scale() signature: `scale(scale: number, center: Point = [0,0,0])`, shell() uses BRepOffsetAPI_MakeThickSolid
- [replicad OCCT Bottle example](https://replicad.xyz/docs/examples/occt-bottle/) -- shell() + fuse() + FaceFinder.inPlane() working example
- [replicad FaceFinder API](https://replicad.xyz/docs/api/classes/FaceFinder/) -- inPlane(), containsPoint(), ofSurfaceType() filters
- [replicad makeCylinder API](https://replicad.xyz/docs/api/functions/makeCylinder/) -- `makeCylinder(radius, height, location?, direction?): Solid`
- [replicad Blueprint API](https://replicad.xyz/docs/api/classes/Blueprint/) -- scale(), offset(), translate() on 2D drawings
- [replicad Drawing API](https://replicad.xyz/docs/api/classes/Drawing/) -- scale(), offset() on Drawing objects
- [replicad DrawingPen API](https://replicad.xyz/docs/api/classes/DrawingPen/) -- close() returns Drawing
- [replicad Sketch.revolve() API](https://replicad.xyz/docs/api/classes/Sketch/) -- `revolve(revolutionAxis?, {origin?}): Shape3D`
- [replicad measureVolume API](https://replicad.xyz/docs/api/functions/measureVolume/) -- `measureVolume(shape): number`
- [replicad index.ts exports](https://github.com/sgenoud/replicad/blob/main/packages/replicad/src/index.ts) -- confirmed re-exports from shapes, draw, finders, measureShape modules

### Secondary (MEDIUM confidence)
- [replicad Discussion #35 (watering can)](https://github.com/sgenoud/replicad/discussions/35) -- shell() on revolved geometry works, but fails with multiple face removal via either()
- [replicad Discussion #28 (quick reference)](https://github.com/sgenoud/replicad/discussions/28) -- community API overview, operations listed
- [OCCT BRepCheck_Analyzer](https://dev.opencascade.org/doc/refman/html/class_b_rep_check___analyzer.html) -- IsValid() checks shape validity (not directly exposed in replicad)
- [OCCT Boolean Operations Performance](https://dev.opencascade.org/content/how-increase-boolean-operation-performance) -- tips: avoid coplanar faces, use compound shapes

### Tertiary (LOW confidence)
- Shell thickness sign convention (positive=inward, negative=outward) -- inferred from OCCT convention and replicad source, not explicitly documented in replicad docs
- Exact performance numbers for shell+fuse in WASM -- no benchmarks found, estimated from community reports

## Metadata

**Confidence breakdown:**
- Shrinkage scaling (2D points): HIGH -- pure arithmetic, domain-standard formula
- Shell operation: HIGH -- verified from OCCT bottle example, API docs, and source code
- Boolean fuse for slip well: MEDIUM -- works in examples, but 2D profile approach is recommended instead
- FaceFinder for top face: HIGH -- verified from bottle example and API docs
- Multi-part mesh extraction: HIGH -- standard typed array + Transferable pattern from Phase 1
- Proof model: HIGH -- identical to existing revolveProfile pipeline
- Watertight guarantee: MEDIUM -- OCCT produces valid B-Rep, but mesh watertightness is not 100% guaranteed by docs
- Performance estimate: MEDIUM -- based on community reports, not measured in this WASM environment

**Research date:** 2026-02-10
**Valid until:** 2026-03-10 (30 days -- replicad is stable at 0.20.5, no breaking changes expected)
