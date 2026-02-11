# Phase 6: Outer Mould, Ring, and Assembly - Research

**Researched:** 2026-02-10
**Domain:** 3D CAD boolean operations (replicad/OpenCASCADE.js), slip casting mould assembly geometry
**Confidence:** MEDIUM-HIGH

## Summary

Phase 6 extends the geometry worker to generate the complete mould assembly: outer containment wall, bottom ring, assembly features (ridge/groove), and pour hole. All geometry is generated through replicad boolean operations (cut, fuse) using primitive shapes (makeBox, makeCylinder) as cutting tools.

The primary approach is **2D profile-based**: create the outer mould's 2D cross-section by offsetting the inner mould profile outward, revolve it, shell it, then split with boolean cuts against large box primitives. This avoids expensive 3D boolean subtractions of one revolved solid from another.

Splitting is accomplished by creating a large box that covers one half (or quadrant) of the shape and using `shape.cut(box)` to remove it. Ridge/groove features are created with small cylinders fused onto or cut from mating surfaces. Assembly clearance is applied by making grooves slightly wider than ridges (ridge width + 2 * clearance per side).

**Primary recommendation:** Extend `generateMouldParts()` in the geometry worker with three new helper functions: `generateOuterMould()`, `generateRing()`, and `addAssemblyFeatures()`. Each uses the same `withCleanup(track)` pattern. Split the outer mould by cutting with boxes positioned at Y=0 (halves) or both Y=0 and X=0 (quarters). Generate ridge/groove features as cylinders on mating faces.

## Standard Stack

### Core (already established -- no new libraries)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| replicad | 0.20.5 | All CAD operations: revolve, cut, fuse, shell, mesh | Already loaded in worker. Provides `makeBox`, `makeCylinder`, `Solid.cut()`, `Solid.fuse()` |
| replicad-opencascadejs | 0.20.2 | WASM backend for OpenCASCADE | Already loaded. No additional WASM needed |

### Key replicad Functions for Phase 6

| Function | Signature | Purpose |
|----------|-----------|---------|
| `makeBox(corner1, corner2)` | `makeBox([x1,y1,z1], [x2,y2,z2]) => Solid` | Create cutting tools for splitting solids in half/quarter |
| `makeCylinder(radius, height, location?, direction?)` | `makeCylinder(r, h, [x,y,z], [dx,dy,dz]) => Solid` | Create ridge cylinders, pour hole tool, ring base |
| `makeBaseBox(xLen, yLen, zLen)` | `makeBaseBox(x, y, z) => Shape3D` | Alternative box creation centered at origin |
| `shape.cut(tool)` | `Solid.cut(Solid) => Solid` | Split solids, create grooves, create pour hole |
| `shape.fuse(other)` | `Solid.fuse(Solid) => Solid` | Add ridges to mating faces |
| `shape.translate(x, y, z)` | `Solid.translate(x, y, z) => Solid` | Position cutting tools and features |
| `shape.rotate(angle, position, direction)` | `Solid.rotate(deg, [x,y,z], [dx,dy,dz]) => Solid` | Rotate cutting planes for quarter splits |
| `shape.clone()` | `Solid.clone() => Solid` | Duplicate shapes for ridge/groove pairs |
| `draw().sketchOnPlane().revolve()` | Chainable API | Create outer mould from 2D profile |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `makeBox` for splitting | Half-space via `BRepPrimAPI_MakeHalfSpace` (raw OCCT) | Raw OCCT API is complex and undocumented in JS; `makeBox` + `cut` is simpler and well-tested |
| 2D profile approach for outer | 3D boolean subtraction (revolve large cylinder, subtract inner) | 3D subtract is slower and more fragile; 2D approach matches inner mould pattern |
| Cylindrical ridges | Rectangular ridges via extruded rectangles | Cylindrical ridges are simpler (single `makeCylinder` call) and print better on FDM (no sharp corners to warp) |

## Architecture Patterns

### Recommended Approach: Extending generateMouldParts()

The existing `generateMouldParts()` function in `geometryWorker.js` returns a results object with named mesh parts. Phase 6 extends this by adding new parts to the same results object.

```
generateMouldParts(profilePoints, mouldParams)
  |
  +-- proof: revolve(original profile)          [existing]
  +-- inner-mould: revolve(scaled) -> shell()   [existing]
  +-- outer-mould-half-1: new in Phase 6
  +-- outer-mould-half-2: new in Phase 6
  +-- (outer-mould-quarter-3, quarter-4: if quarters mode)
  +-- ring-half-1: new in Phase 6
  +-- ring-half-2: new in Phase 6
  +-- (ring-quarter-3, quarter-4: if quarters mode)
```

### Pattern 1: Outer Mould via 2D Profile Offset

**What:** Instead of 3D boolean-subtracting the inner mould from a larger cylinder, create the outer mould from a 2D profile that is offset outward from the inner mould profile.

**When to use:** Always. This is the recommended approach.

**How it works:**
1. Start with the shrinkage-scaled profile (same one used for inner mould)
2. Offset every X coordinate outward by `cavityGap + outerWallThickness` (e.g., 25mm + 2.4mm = 27.4mm)
3. Extend the profile height to cover the full inner mould height (including slip well)
4. The outer mould profile is a simple shape: vertical wall at offset radius, flat bottom, flat top
5. Revolve this profile, shell it, then split

**Why not 3D subtraction:**
- 3D boolean subtraction of complex curved surfaces is the most failure-prone OCCT operation
- The 2D approach creates a simpler, more predictable geometry
- Matches the existing pattern used for inner mould generation
- Much faster computation

```javascript
// Outer mould profile is simpler than inner -- it's just a cylinder-like shape
// whose inner radius follows the pot profile + cavity gap
function buildOuterMouldProfile(scaledPoints, cavityGap, outerWallThickness) {
  const outerRadius = getMaxRadius(scaledPoints) + cavityGap + outerWallThickness;
  const bottomZ = scaledPoints[0].y;  // foot level
  const topZ = scaledPoints[scaledPoints.length - 1].y; // rim/well top

  // Simple rectangular profile for outer mould cross-section
  return [
    { x: outerRadius - outerWallThickness, y: bottomZ, type: 'line' },
    { x: outerRadius - outerWallThickness, y: topZ, type: 'line' },
    { x: outerRadius, y: topZ, type: 'line' },
    { x: outerRadius, y: bottomZ, type: 'line' },
  ];
}
```

**IMPORTANT DESIGN DECISION -- Outer mould shape:**

The outer mould can be either:
- **(a) Simple cylinder**: Uniform radius based on the widest point of the pot profile + cavity gap. Simpler geometry, more plaster used. This is the ShapeCast approach.
- **(b) Profile-following**: Outer wall follows the pot's contour at a fixed offset. Uses less plaster but more complex geometry.

**Recommendation: (a) Simple cylinder approach.** Reasons:
1. Simpler geometry = fewer boolean operation failures
2. Uniform cavity gap ensures consistent plaster thickness for even drying
3. Matches ShapeCast's proven approach
4. Flat outer wall is easy to clamp with binder clips
5. The profile-following approach can be a v2 enhancement

### Pattern 2: Splitting with Box Cutting Tools

**What:** Split a solid in half or quarter by creating a large box that covers exactly one half/quadrant and using `shape.cut(box)` to remove it.

**When to use:** For splitting outer mould and ring into halves or quarters.

**How it works for halves (split along XZ plane, Y=0):**
```javascript
// The shape is centered on the Z axis (revolved around Z).
// To get the "front half" (Y > 0), cut away the back half (Y < 0).
// To get the "back half" (Y < 0), cut away the front half (Y > 0).

const bigSize = 500; // Much larger than any mould dimension

// Cutting tool: box that covers Y < 0 (removes back half, keeps front)
const cutBoxFront = track(
  makeBox([-bigSize, -bigSize, -bigSize], [bigSize, 0, bigSize])
);
const frontHalf = track(shape.cut(cutBoxFront));

// Cutting tool: box that covers Y > 0 (removes front half, keeps back)
const cutBoxBack = track(
  makeBox([-bigSize, 0, -bigSize], [bigSize, bigSize, bigSize])
);
const backHalf = track(shape.cut(cutBoxBack));
```

**How it works for quarters (split along both XZ and YZ planes):**
```javascript
// Quarter 1: X > 0, Y > 0 -- cut away everything else
const cutQ1 = track(
  makeBox([0, 0, -bigSize], [bigSize, bigSize, bigSize])
);
// But we need to KEEP Q1, so we INTERSECT instead of cut
// OR: cut three quadrants away
// Easier approach: intersect with a quadrant box

// Alternative using cut: create three boxes and cut sequentially
// Simplest: use the half-cutting approach twice
const rightHalf = track(shape.cut(makeBox([-bigSize, -bigSize, -bigSize], [0, bigSize, bigSize])));
const quarter1 = track(rightHalf.cut(makeBox([-bigSize, -bigSize, -bigSize], [bigSize, 0, bigSize])));
```

**Coordinate system reminder:** The replicad worker revolves profiles on the XZ plane around the Z axis. So:
- Z axis = vertical (pot height)
- X, Y axes = horizontal (radial)
- Splitting at Y=0 creates front/back halves
- Splitting at X=0 creates left/right halves
- Combining both gives quarters

### Pattern 3: Ridge/Groove Assembly Features

**What:** Interlocking alignment features on mating surfaces. One face has a raised ridge; the matching face has a corresponding groove.

**Geometry specification:**
- Ridge: half-cylinder (semicircular cross-section), 2mm radius, running vertically along the mating surface
- Groove: matching half-cylinder cut into the opposing face, 2mm + clearance radius
- Clearance: configurable, default 0.3mm for FDM (groove is 2.3mm radius)
- Number of ridges per mating face: 2 (evenly spaced vertically)

**How to create:**
```javascript
// Ridge: a full cylinder that extends through the mating face
// When the face is at Y=0, the ridge runs along the Z axis
const ridgeRadius = 2.0; // mm
const ridgeLength = shapeHeight * 0.6; // 60% of the shape height
const ridgeZ = bottomZ + (topZ - bottomZ) * 0.3; // centered at 30% height

const ridgeCylinder = track(
  makeCylinder(ridgeRadius, ridgeLength, [outerRadius, 0, ridgeZ], [0, 0, 1])
);

// Add ridge to the "front half" (fuse)
const frontWithRidge = track(frontHalf.fuse(ridgeCylinder));

// Cut groove from the "back half"
const grooveRadius = ridgeRadius + clearance;
const grooveCylinder = track(
  makeCylinder(grooveRadius, ridgeLength + 2, [outerRadius, 0, ridgeZ - 1], [0, 0, 1])
);
const backWithGroove = track(backHalf.cut(grooveCylinder));
```

**Where mating surfaces exist:**
1. **Outer mould halves** meet at the split plane(s) -- ridges on flat faces
2. **Ring halves** meet at split plane(s) -- ridges on flat faces
3. **Ring top** meets outer mould bottom -- ridges on annular face
4. **Inner mould** sits inside the ring -- no ridge needed (gravity-seated)

**Design principle:** Ridge on the LEFT piece, groove on the RIGHT piece (consistent convention). For quarters, ridge on clockwise face, groove on counterclockwise face.

### Pattern 4: Pour Hole

**What:** A cylindrical hole through the bottom of the outer mould for introducing plaster.

**How to create:**
```javascript
const pourHoleRadius = 15; // mm (30mm diameter hole)
const pourHoleHeight = outerWallThickness + 2; // penetrate full wall + margin
const pourHoleTool = track(
  makeCylinder(pourHoleRadius, pourHoleHeight, [outerRadius * 0.5, 0, bottomZ - 1], [0, 0, 1])
);
// Cut from the ring (not the outer mould wall)
const ringWithPourHole = track(ring.cut(pourHoleTool));
```

**Position:** Centered on one of the split faces so it's accessible from the side. If halves: at Y=0 on the front half's ring segment. The pour hole goes through the ring at the bottom.

### Pattern 5: Bottom Ring Geometry

**What:** A flat annular ring (washer shape) that sits at the bottom, connecting the inner mould to the outer mould.

**How to create:**
```javascript
// Ring inner radius = inner mould's outer radius at the bottom
// Ring outer radius = outer mould's inner radius at the bottom
// Ring height = fixed thickness (e.g., 5-8mm)

const ringInnerRadius = getInnerMouldBottomRadius(scaledPoints, wallThickness);
const ringOuterRadius = maxRadius + cavityGap;
const ringHeight = 6; // mm

// Create ring as difference of two cylinders
const outerCylinder = track(
  makeCylinder(ringOuterRadius, ringHeight, [0, 0, bottomZ - ringHeight], [0, 0, 1])
);
const innerCylinder = track(
  makeCylinder(ringInnerRadius, ringHeight + 2, [0, 0, bottomZ - ringHeight - 1], [0, 0, 1])
);
const ring = track(outerCylinder.cut(innerCylinder));
```

**Alternative approach:** Draw the ring cross-section as a 2D profile and revolve it. This is more consistent with the existing codebase pattern.

```javascript
// Ring cross-section: a rectangle from innerR to outerR, at the bottom
const ringProfile = [
  { x: ringInnerRadius, y: bottomZ - ringHeight, type: 'line' },
  { x: ringInnerRadius, y: bottomZ, type: 'line' },
  { x: ringOuterRadius, y: bottomZ, type: 'line' },
  { x: ringOuterRadius, y: bottomZ - ringHeight, type: 'line' },
];
const ringShape = track(buildAndRevolve(ringProfile));
```

**Recommendation:** Use the revolve approach for the ring body (consistent with existing patterns), then split with the same box-cutting method used for the outer mould.

### Anti-Patterns to Avoid

- **3D boolean subtraction of inner from outer:** Subtracting a complex curved revolved solid from a cylindrical solid is the most fragile OCCT operation. Use 2D profile offset approach instead.
- **Creating splitting planes as infinitely thin faces:** OCCT cannot cut with zero-thickness shapes. Always use thick boxes (500mm+) as cutting tools.
- **Adding assembly features before splitting:** Add ridges/grooves AFTER splitting, not before. If you add them before, the split may cut through a ridge and create invalid geometry.
- **Forgetting to track() intermediate shapes:** Every replicad shape created during the operation MUST be passed to `track()` for WASM cleanup. Missing even one creates a permanent memory leak.
- **Using exact dimensions for cutting boxes:** Always make cutting boxes significantly larger (500mm+) than the shape being cut. If the box edge coincides with a shape edge, the boolean operation may fail.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Splitting a solid in half | Custom half-space geometry | `makeBox()` + `shape.cut()` | Boxes are the simplest, most reliable cutting tools in OCCT |
| Creating cylinders for ridges | Manual wire/edge/face construction | `makeCylinder()` | Built-in primitive, tested, correct normals guaranteed |
| Outer mould shape | 3D boolean subtract inner from outer cylinder | 2D profile revolve + shell | 3D subtraction of complex surfaces fails frequently in OCCT |
| Ring shape | Complex wire construction | `buildAndRevolve()` with rectangular profile | Consistent with existing codebase pattern |
| Assembly clearance gaps | Manual face offset | Make groove radius = ridge radius + clearance | Simpler, more predictable, easier to configure |
| Positioning split planes | Calculating tangent planes | Fixed axis-aligned planes (Y=0, X=0) | Revolved solids are symmetric around Z axis; axis-aligned splits always work |

## Common Pitfalls

### Pitfall 1: Boolean Cut Fails When Shapes Touch Tangentially

**What goes wrong:** If the cutting box's face is tangent to the shape's surface (e.g., the box face at Y=0 passes exactly through the center of a cylinder revolved around Z), OCCT may produce a degenerate result or throw an exception.

**Why it happens:** OCCT boolean operations require clean intersection curves. When surfaces are tangent (touch but don't cross), the intersection is a point or a degenerate curve, which confuses the algorithm.

**How to avoid:** Ensure the cutting plane passes cleanly through the solid. For revolved solids centered on Z, splitting at Y=0 or X=0 always produces clean planar intersections (the split face is a flat plane through the solid). This is inherently safe because the revolution creates a solid with non-zero thickness at all angles.

**Warning signs:** `cut()` throws an error or returns a shape with zero faces.

### Pitfall 2: Ridge/Groove Features Too Small for Boolean Operations

**What goes wrong:** Very small features (< 0.5mm) may cause boolean operations to fail due to OCCT's internal tolerance (typically 1e-7, but practical minimum for reliable booleans is ~0.5mm).

**Why it happens:** OCCT's boolean algorithm merges edges and faces that are within tolerance of each other. If a ridge is too thin, it may be entirely within tolerance and get eliminated.

**How to avoid:** Use minimum 2mm radius for ridges (4mm diameter). This is well above OCCT's practical minimum and produces a feature that is easy to print on FDM (2+ perimeters at 0.4mm nozzle).

**Warning signs:** Ridge disappears after fuse operation, or groove has no visible depth after cut.

### Pitfall 3: Memory Exhaustion from Too Many Tracked Shapes

**What goes wrong:** Phase 6 creates many more intermediate shapes than Phase 5 (outer mould + 2-4 split pieces + ring + 2-4 ring pieces + ridges + grooves + pour hole = 15-25+ shapes). If all are tracked simultaneously, WASM heap grows significantly.

**Why it happens:** Each `track()` call adds to the cleanup list but doesn't free memory until `withCleanup()` returns. With 25+ shapes at 10-50MB each, the worker could use 500MB+ of WASM memory.

**How to avoid:**
- Delete intermediate shapes manually when they are no longer needed (before the `withCleanup` returns)
- Or: break the generation into multiple `withCleanup` blocks, one per part
- Or: restructure so shapes are deleted as soon as their mesh is extracted

**Warning signs:** Worker crashes with out-of-memory error, or browser tab becomes unresponsive.

### Pitfall 4: Outer Mould Does Not Actually Contain the Inner Mould

**What goes wrong:** The outer mould's inner radius is based on the pot's maximum radius + cavity gap, but the inner mould's actual outer radius (after shelling outward) may extend further than the pot profile's maximum X coordinate.

**Why it happens:** The inner mould is shelled with NEGATIVE wall thickness (growing outward). So the inner mould's outer surface is wider than the pot profile by `wallThickness` (2.4mm). The cavity gap must be measured from the inner mould's outer surface, not from the pot surface.

**How to avoid:** Calculate outer mould inner radius as: `maxProfileRadius * shrinkageFactor + wallThickness + cavityGap`. This ensures the cavity gap is between the inner mould's outer surface and the outer mould's inner surface.

**Warning signs:** In assembled view, the inner mould visibly clips through the outer mould wall.

### Pitfall 5: Split Pieces Are Not Symmetric

**What goes wrong:** After splitting into halves, the two pieces are not mirror images of each other. One half has more material than the other, or the split faces don't align.

**Why it happens:** If the revolved solid is not perfectly centered on the Z axis, or if the cutting box is not precisely positioned at Y=0.

**How to avoid:** Always revolve profiles that start at the Z axis (X=0 in profile coordinates). The `buildAndRevolve()` function already closes profiles back to the axis. The cutting box boundary at Y=0 (or X=0) always produces symmetric halves because the revolved solid is rotationally symmetric.

**Warning signs:** Halves don't visually match when shown side by side in exploded view.

### Pitfall 6: Performance -- Total Generation Time Exceeds User Tolerance

**What goes wrong:** Generating all Phase 6 parts takes 5-15 seconds, making the "live preview" feel broken.

**Why it happens:** Each boolean operation (cut for splitting, fuse for ridges, cut for grooves, cut for pour hole) takes 100-500ms. With 10-15 boolean operations plus revolves and shells, total time adds up.

**How to avoid:**
1. **Generate in stages:** Return proof + inner mould immediately (existing), then generate outer + ring as a second batch
2. **Use intermediate postMessage:** Send each part's mesh to the main thread as soon as it's ready, don't wait for all parts
3. **Cache the revolved solid:** If only the split count changes, don't re-revolve -- just re-split
4. **Skip assembly features for preview:** Generate ridges/grooves only when exporting for print, not for every preview update. The preview can show the shape without assembly features.

**Warning signs:** Status shows "generating" for more than 3 seconds. User gets frustrated and clicks away.

## Code Examples

### Example 1: Splitting a Revolved Solid into Halves

```javascript
// Source: Verified with replicad API docs (makeBox + Solid.cut)
// The shape is revolved around Z axis, centered at origin.
// Split along Y=0 plane to get front half (Y>0) and back half (Y<0).

function splitIntoHalves(shape, track) {
  const bigSize = 500; // oversized cutting box

  // Remove Y<0 region to get front half
  const cutToolFront = track(makeBox([-bigSize, -bigSize, -bigSize], [bigSize, 0, bigSize]));
  const frontHalf = track(shape.cut(cutToolFront));

  // Remove Y>0 region to get back half
  const cutToolBack = track(makeBox([-bigSize, 0, -bigSize], [bigSize, bigSize, bigSize]));
  const backHalf = track(shape.cut(cutToolBack));

  return [frontHalf, backHalf];
}
```

### Example 2: Splitting into Quarters

```javascript
// Source: Extension of halves pattern using two perpendicular cuts

function splitIntoQuarters(shape, track) {
  const bigSize = 500;

  // First split into halves along Y=0
  const [frontHalf, backHalf] = splitIntoHalves(shape, track);

  // Then split each half along X=0
  const cutToolRight = track(makeBox([-bigSize, -bigSize, -bigSize], [0, bigSize, bigSize]));
  const cutToolLeft = track(makeBox([0, -bigSize, -bigSize], [bigSize, bigSize, bigSize]));

  const q1 = track(frontHalf.cut(cutToolRight)); // X>0, Y>0
  const q2 = track(frontHalf.cut(cutToolLeft));   // X<0, Y>0
  const q3 = track(backHalf.cut(cutToolRight));    // X>0, Y<0
  const q4 = track(backHalf.cut(cutToolLeft));     // X<0, Y<0

  return [q1, q2, q3, q4];
}
```

### Example 3: Creating a Ridge on a Mating Face

```javascript
// Source: replicad makeCylinder + Solid.fuse API
// Ridge runs vertically (along Z) on the flat split face

function addRidgeToFace(halfShape, ridgeConfig, track) {
  const { radius, length, xPos, zStart } = ridgeConfig;

  // Create cylinder for ridge, positioned on the split face (Y=0)
  const ridge = track(
    makeCylinder(radius, length, [xPos, 0, zStart], [0, 0, 1])
  );

  return track(halfShape.fuse(ridge));
}

function cutGrooveFromFace(halfShape, grooveConfig, track) {
  const { radius, clearance, length, xPos, zStart } = grooveConfig;

  // Groove is slightly larger than ridge (ridge radius + clearance)
  const groove = track(
    makeCylinder(radius + clearance, length + 2, [xPos, 0, zStart - 1], [0, 0, 1])
  );

  return track(halfShape.cut(groove));
}
```

### Example 4: Complete Outer Mould Generation

```javascript
// Source: Combined patterns from research

function generateOuterMould(scaledPoints, mouldParams, track) {
  const {
    wallThickness = 2.4,
    cavityGap = 25,
    splitCount = 2,        // 2 = halves, 4 = quarters
    clearance = 0.3,
    pourHoleRadius = 15,
  } = mouldParams;

  // Calculate outer mould dimensions
  const shrinkageFactor = 1 / (1 - mouldParams.shrinkageRate);
  const maxRadius = Math.max(...scaledPoints.map(p => p.x));
  const innerMouldOuterRadius = maxRadius + wallThickness; // after shell
  const outerMouldInnerRadius = innerMouldOuterRadius + cavityGap;
  const outerMouldOuterRadius = outerMouldInnerRadius + wallThickness;

  const bottomZ = scaledPoints[0].y;
  const topZ = scaledPoints[scaledPoints.length - 1].y;

  // Build outer mould as revolved rectangular profile
  const outerProfile = [
    { x: outerMouldInnerRadius, y: bottomZ, type: 'line' },
    { x: outerMouldInnerRadius, y: topZ, type: 'line' },
    { x: outerMouldOuterRadius, y: topZ, type: 'line' },
    { x: outerMouldOuterRadius, y: bottomZ, type: 'line' },
  ];

  const outerSolid = track(buildAndRevolve(outerProfile));

  // Split into halves or quarters
  let pieces;
  if (splitCount === 4) {
    pieces = splitIntoQuarters(outerSolid, track);
  } else {
    pieces = splitIntoHalves(outerSolid, track);
  }

  // Add assembly features to each piece
  // ... (ridge on one face, groove on mating face)

  return pieces;
}
```

### Example 5: Ring with Pour Hole

```javascript
// Source: buildAndRevolve pattern (existing codebase) + cut for pour hole

function generateRing(scaledPoints, mouldParams, track) {
  const { wallThickness, cavityGap, pourHoleRadius = 15 } = mouldParams;

  const maxRadius = Math.max(...scaledPoints.map(p => p.x));
  const ringInnerRadius = maxRadius + wallThickness + 1; // slight clearance from inner mould
  const ringOuterRadius = maxRadius + wallThickness + cavityGap;
  const bottomZ = scaledPoints[0].y;
  const ringHeight = 6; // mm

  // Ring cross-section
  const ringProfile = [
    { x: ringInnerRadius, y: bottomZ - ringHeight, type: 'line' },
    { x: ringInnerRadius, y: bottomZ, type: 'line' },
    { x: ringOuterRadius, y: bottomZ, type: 'line' },
    { x: ringOuterRadius, y: bottomZ - ringHeight, type: 'line' },
  ];

  let ring = track(buildAndRevolve(ringProfile));

  // Add pour hole
  const pourHole = track(
    makeCylinder(
      pourHoleRadius,
      ringHeight + 2,
      [ringInnerRadius + (ringOuterRadius - ringInnerRadius) / 2, 0, bottomZ - ringHeight - 1],
      [0, 0, 1]
    )
  );
  ring = track(ring.cut(pourHole));

  return ring;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Server-side Blender pipeline (ShapeCast) | Client-side WASM (replicad) | This project | All geometry in browser, instant preview |
| Manual cottle board construction | 3D printed outer mould | ShapeCast 2023 | Eliminates cottle boards entirely |
| Single-piece outer mould | Split into halves/quarters | ShapeCast | Enables removal from set plaster |
| Manual registration marks (clay natches) | Precision-printed ridge/groove features | ShapeCast | Sub-mm alignment accuracy |

**Deprecated/outdated:**
- Manual cottle boards: replaced by the 3D-printed outer mould itself
- Clay natches for registration: replaced by printed ridge/groove interlocks

## Open Questions

1. **Optimal ridge/groove dimensions**
   - What we know: 2mm radius ridge with 0.3mm clearance works for most FDM printers (from 3D printing tolerance guides). ShapeCast uses ridges/grooves but exact dimensions are not published.
   - What's unclear: Whether semicircular cross-section or rectangular cross-section works better for FDM printing.
   - Recommendation: Use semicircular (cylinder) for v1. It's simpler to create and has no sharp corners that could warp during printing.

2. **Outer mould height -- should it extend above the inner mould?**
   - What we know: The outer mould contains plaster. Plaster fills the cavity between inner and outer mould.
   - What's unclear: Should the outer mould be taller than the inner mould (to allow plaster overfill), the same height, or shorter?
   - Recommendation: Same height as the inner mould (including slip well). The slip well already extends above the pot rim, providing overflow capacity. If the outer mould were taller, it would cover the slip well opening.

3. **Ring connection to outer mould**
   - What we know: The ring sits at the bottom and connects inner to outer. In the assembled mould, it provides a base.
   - What's unclear: Does the ring overlap with the outer mould bottom (lip joint), or does it butt-join (flat surfaces meeting)?
   - Recommendation: Butt-join (ring top meets outer mould bottom). Ridge/groove features on the ring's top surface provide alignment. This is simpler to generate and doesn't require additional boolean operations.

4. **Performance with all boolean operations**
   - What we know: Each cut/fuse takes 100-500ms. Phase 6 could involve 15+ boolean operations.
   - What's unclear: Exact total time on a typical user's hardware.
   - Recommendation: Implement staged generation (return parts progressively). Skip assembly features during live preview -- add them only for export.

5. **Pour hole position in quarter-split configuration**
   - What we know: Pour hole should be accessible for pouring. In halves, it goes on one split face.
   - What's unclear: In quarters, which piece gets the pour hole?
   - Recommendation: Put the pour hole in the ring (not the outer mould wall). This way it's always at the bottom regardless of split configuration. Place it at the midpoint of the ring's annular width.

## Sources

### Primary (HIGH confidence)
- [replicad API: Solid class methods](https://replicad.xyz/docs/api/classes/Solid/) - cut(), fuse(), translate(), rotate(), clone(), shell(), mesh() methods verified
- [replicad API: makeBox](https://replicad.xyz/docs/api/functions/makeBox) - `makeBox(corner1, corner2) => Solid` verified
- [replicad API: makeCylinder](https://replicad.xyz/docs/api/functions/makeCylinder) - `makeCylinder(radius, height, location?, direction?) => Solid` verified
- [replicad API: makeBaseBox](https://replicad.xyz/docs/api/functions/makeBaseBox) - `makeBaseBox(xLen, yLen, zLen) => Shape3D` verified
- [replicad Tutorial: Combinations](https://replicad.xyz/docs/tutorial-overview/combinations) - Boolean cut/fuse/intersect patterns verified with code examples
- Existing codebase: `geometryWorker.js` lines 238-264 (`buildAndRevolve`), lines 347-401 (`generateMouldParts`) - directly observed

### Secondary (MEDIUM confidence)
- [replicad OCCT Bottle Example](https://replicad.xyz/docs/examples/occt-bottle/) - makeCylinder usage pattern: `makeCylinder(radius, height, [x,y,z], [dx,dy,dz])`
- [ShapeCast CHI 2024 Paper](https://inovo.studio/pubs/shapecast-chi24.pdf) - Mould design approach: 25mm plaster gap, 2.4mm wall, ridge/groove features, halves/quarters split
- [ShapeCast Website](https://shapecastmolds.com/) - Binder clip assembly, ridge/groove mesh, no cottle boards
- [replicad GitHub Manual](https://github.com/raydeleu/ReplicadManual) - Boolean operation patterns with draw/sketch/extrude/cut
- [3D Printing Tolerances](https://formlabs.com/blog/understanding-accuracy-precision-tolerance-in-3d-printing/) - FDM tolerance +/-0.2-0.5mm

### Tertiary (LOW confidence)
- [DigitalFire Coffee Mug Mould Project](https://digitalfire.com/project/60) - 3D printed mould with 0.8mm walls, natch registration system
- [OpenCASCADE Boolean Operations Spec](https://dev.opencascade.org/doc/overview/html/specification__boolean_operations.html) - OCCT boolean internals and failure modes

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - replicad API functions verified through official docs
- Architecture (splitting approach): HIGH - box-cutting is a well-established CAD pattern, verified in replicad examples
- Architecture (outer mould profile): MEDIUM - 2D approach is sound but specific radius calculations need validation during implementation
- Assembly features (ridges/grooves): MEDIUM - dimensions based on 3D printing best practices, not published ShapeCast specs
- Performance: LOW - total computation time with many boolean operations is estimated, not measured
- Ring geometry: MEDIUM - design is reasonable but exact dimensions need physical testing

**Research date:** 2026-02-10
**Valid until:** 2026-03-10 (replicad API is stable at 0.20.5; geometry patterns are timeless)
