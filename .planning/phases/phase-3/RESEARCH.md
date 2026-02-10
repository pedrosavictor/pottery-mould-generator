# Phase 3: Profile Editor Extended - Research

**Researched:** 2026-02-10
**Domain:** Parametric pot shape generation, SVG import/parsing, reference image overlay, mode switching
**Confidence:** HIGH

## Summary

Phase 3 extends the existing Paper.js bezier profile editor (Phase 2) with three new entry points for creating pot profiles: parametric presets with slider-driven generation, SVG file import, and reference photo tracing. The existing codebase has a clean architecture -- `profileData.js` defines the canonical data model, `profileEditor.js` exposes `getProfileData()` and `setProfileData()`, and the `onChange` callback drives the 3D preview pipeline. All three new features ultimately produce the same output: an array of `ProfilePoint` objects fed to `setProfileData()`.

The parametric preset system is the core feature -- it generates pot shapes mathematically from named parameters (height, rim diameter, belly width, foot diameter) and maps them to bezier control points. The key insight is that common pottery forms (cup, bowl, vase, tumbler) differ primarily in their proportional relationships between these four measurements, and each can be expressed as 5-7 profile points with 2-3 bezier curves. SVG import leverages Paper.js's built-in `importSVG()` and `new Path(pathData)` capabilities to parse SVG path data into segments that can be converted to the profile data model. Reference image overlay uses Paper.js `Raster` on a dedicated layer behind the profile, with opacity control.

**Primary recommendation:** Build parametric presets as a pure function `generatePresetProfile(presetName, params) -> ProfilePoint[]` that is completely decoupled from the UI. The slider UI calls this function on every `input` event and passes the result to `setProfileData()`. This keeps the parametric engine testable and the integration clean.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Paper.js | 0.12.18 | SVG import, Raster image overlay, path manipulation | Already loaded via CDN in index.html; has built-in `importSVG()` and `Raster` class |
| Vanilla JS | ES2020+ | Parametric math, slider wiring, FileReader API | CDN-only constraint; no build tools |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None needed | -- | -- | All features are achievable with Paper.js + vanilla JS |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Paper.js `importSVG()` | Manual DOMParser + path data parsing | More control but reimplements what Paper.js already does well |
| Paper.js `Raster` | CSS `background-image` on canvas container | CSS approach is simpler but cannot be panned/zoomed with the canvas coordinate system |
| Custom slider library | Vanilla `<input type="range">` | Custom adds dependency; native range sliders with `input` event work perfectly for this use case |

**Installation:**
```bash
# No new dependencies needed -- Paper.js 0.12.18 is already loaded via CDN
```

## Architecture Patterns

### Recommended Project Structure
```
js/
├── profileData.js           # Existing: canonical data model (unchanged)
├── profileEditor.js         # Existing: extend with mode switching + setProfileData() usage
├── presets/
│   └── parametricPresets.js  # NEW: pure functions generating ProfilePoint[] from parameters
├── svgImport.js              # NEW: SVG file parsing -> ProfilePoint[]
├── referenceImage.js         # NEW: Raster overlay management
└── profileEditor/
    ├── canvasSetup.js        # Existing: add 'reference' layer (layer 0, below grid)
    ├── pathRenderer.js       # Existing: unchanged
    ├── editTool.js           # Existing: unchanged
    ├── drawTool.js           # Existing: unchanged
    ├── constraints.js        # Existing: unchanged
    ├── undoManager.js        # Existing: unchanged
    ├── gridOverlay.js        # Existing: unchanged
    └── dimensionOverlay.js   # Existing: unchanged
```

### Pattern 1: Parametric Preset as Pure Function
**What:** Each preset is a pure function that takes parameter values and returns a `ProfilePoint[]` array. No DOM, no Paper.js, no side effects.
**When to use:** Always for parametric generation. This is the core pattern.
**Example:**
```javascript
// Source: Domain knowledge + existing profileData.js format
/**
 * Generate a cup profile from parameters.
 * Returns ProfilePoint[] compatible with createProfile().
 *
 * @param {Object} params
 * @param {number} params.height - Total height in mm (default: 90)
 * @param {number} params.rimDiameter - Rim diameter in mm (default: 80)
 * @param {number} params.bellyWidth - Max belly diameter in mm (default: 85)
 * @param {number} params.footDiameter - Foot diameter in mm (default: 55)
 * @returns {ProfilePoint[]}
 */
export function generateCup({ height = 90, rimDiameter = 80, bellyWidth = 85, footDiameter = 55 }) {
  const rimR = rimDiameter / 2;
  const bellyR = bellyWidth / 2;
  const footR = footDiameter / 2;
  const h = height;

  // Foot zone: 3mm tall flat base, then transition
  const footTopY = 3;
  const transY = h * 0.06;  // foot-to-body transition at ~6% height

  // Belly is at ~55% height for a cup
  const bellyY = h * 0.55;

  // Body-to-rim transition at ~90% height
  const bodyTopY = h * 0.9;

  return [
    { x: footR, y: 0, type: 'line' },          // foot bottom
    { x: footR, y: footTopY, type: 'line' },    // foot top
    { x: footR * 0.85, y: transY, type: 'line' }, // tuck-in transition
    { x: bellyR, y: bellyY, type: 'bezier',     // belly curve
      cp1: { x: footR * 0.75, y: h * 0.2 },
      cp2: { x: bellyR * 0.9, y: bellyY * 0.8 } },
    { x: rimR * 0.98, y: bodyTopY, type: 'bezier', // body to rim
      cp1: { x: bellyR, y: bellyY + (bodyTopY - bellyY) * 0.3 },
      cp2: { x: rimR * 0.98, y: bodyTopY * 0.9 } },
    { x: rimR, y: h, type: 'line' },            // rim
  ];
}
```

### Pattern 2: Mode Switching via State Machine
**What:** The editor operates in one of three modes: `parametric`, `freehand`, or `tracing`. Mode determines which UI panel is active and how profile data flows.
**When to use:** For managing the interaction between parametric sliders, freehand bezier editing, and reference image tracing.
**Example:**
```javascript
// Editor mode state
let currentMode = 'freehand'; // 'parametric' | 'freehand' | 'tracing'

function switchMode(newMode) {
  const currentPoints = editor.getProfileData();

  if (currentMode === 'parametric' && newMode === 'freehand') {
    // Parametric -> Freehand: current shape becomes editable bezier points
    // Points already in profile format -- just switch UI panels
    // Sliders become disabled; bezier editing tools become active
  }

  if (newMode === 'parametric') {
    // Entering parametric mode: sliders take control
    // Regenerate profile from current slider values
    // Disable direct path editing (editTool/drawTool)
  }

  currentMode = newMode;
  updateUIForMode(newMode);
}
```

### Pattern 3: SVG Import Pipeline
**What:** Parse SVG file -> extract path(s) -> convert to profile coordinate system -> produce ProfilePoint[].
**When to use:** When user uploads an SVG file.
**Example:**
```javascript
// SVG Import pipeline
async function importSVG(svgString) {
  // 1. Parse SVG using Paper.js
  const imported = paper.project.importSVG(svgString, {
    expandShapes: true,
    insert: false, // Don't add to canvas yet
  });

  // 2. Find the first Path in the imported item tree
  const path = findFirstPath(imported);
  if (!path) throw new Error('No path found in SVG');

  // 3. Normalize: ensure path goes bottom-to-top (foot to rim)
  // 4. Scale to fit editor coordinate space
  // 5. Convert Paper.js segments to ProfilePoint[]
  const profilePoints = convertPathToProfile(path, transform);

  return profilePoints;
}
```

### Pattern 4: Reference Image as Paper.js Raster Layer
**What:** Load user image into a Paper.js Raster on a dedicated layer below the profile, with opacity slider control.
**When to use:** When user uploads a reference photo for tracing.
**Example:**
```javascript
// Reference image overlay
function loadReferenceImage(dataUrl, layers, transform) {
  const raster = new paper.Raster(dataUrl);
  raster.onLoad = function() {
    // Position and scale to fit editor space
    raster.position = new paper.Point(
      transform.offsetX + raster.width / 2,
      transform.offsetY - raster.height / 2
    );
    // Scale to fit the editor canvas
    const targetHeight = transform.scale * 120; // 120mm max height
    const scaleFactor = targetHeight / raster.height;
    raster.scale(scaleFactor);

    raster.opacity = 0.3; // Default semi-transparent
    layers.reference.addChild(raster);
  };
}
```

### Anti-Patterns to Avoid
- **Coupling parametric math to Paper.js:** The preset generation functions must NOT import or reference Paper.js. They produce plain ProfilePoint[] arrays. The editor's `setProfileData()` handles the Paper.js conversion.
- **Storing parametric state in the path:** Don't try to make the Paper.js path "remember" which preset generated it. Store the current preset name and slider values in a separate state object.
- **Blocking on image load:** Reference image loading is asynchronous (FileReader + Image load). Never block the UI. Use the `onLoad` callback pattern.
- **Modifying the profile data model:** The existing `ProfilePoint` format (x, y, type, cp1, cp2) is sufficient for everything in Phase 3. Do NOT add new fields.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SVG path parsing | Custom SVG `d` attribute parser | `paper.project.importSVG(svgString, { expandShapes: true })` or `new paper.Path(pathData)` | SVG path data has dozens of commands (M, L, C, S, Q, T, A, Z) with relative/absolute variants. Paper.js handles all of them. |
| Image file reading | Manual ArrayBuffer manipulation | `FileReader.readAsDataURL()` -> `new paper.Raster(dataUrl)` | Standard browser API, handles all image formats the browser supports |
| SVG file reading | Custom XML parser | `FileReader.readAsText()` -> pass string to `importSVG()` | SVG is XML but can have entities, namespaces, CDATA sections -- DOMParser handles these edge cases |
| Slider debouncing for real-time updates | Custom debounce function | Use `input` event directly (no debounce needed) | The `input` event fires on every drag step. The editor's `setProfileData()` re-renders the Paper.js path, which is effectively instant (<5ms). Debouncing would add unnecessary latency to slider interaction. The expensive operation (3D preview via WASM) is already debounced by the existing `generateWithCancellation()` pipeline. |
| Bezier curve fitting for SVG import | Custom least-squares curve fitting | Paper.js segment-based conversion (SVG paths are already bezier curves) | SVG `<path>` `d` attribute already uses cubic bezier commands (C/c). Paper.js converts these directly to segments with handleIn/handleOut. No curve fitting needed. |

**Key insight:** Paper.js was designed for exactly these use cases. Its SVG import is mature (since 2012), its Raster class handles image overlay natively, and its Path constructor accepts SVG path-data strings directly. The only custom code needed is the parametric math and the glue between components.

## Common Pitfalls

### Pitfall 1: SVG Import Returns a Group, Not a Path
**What goes wrong:** `importSVG()` returns an `Item` that is typically a `Group` containing multiple children (layers, groups, paths). Code that assumes it returns a single `Path` will fail silently or throw.
**Why it happens:** SVG files have nested structure (`<svg>` -> `<g>` -> `<path>`). Paper.js preserves this hierarchy.
**How to avoid:** Recursively walk the imported item tree to find the first `Path` (or `CompoundPath`). Use `item.getItems({ class: paper.Path })` or manual recursion.
**Warning signs:** `imported.segments` is undefined; `imported.children` contains groups.
```javascript
function findFirstPath(item) {
  if (item instanceof paper.Path && item.segments.length > 0) return item;
  if (item.children) {
    for (const child of item.children) {
      const found = findFirstPath(child);
      if (found) return found;
    }
  }
  return null;
}
```

### Pitfall 2: SVG Coordinate System Mismatch
**What goes wrong:** SVG files use a coordinate system where Y increases downward (like screen pixels). The profile editor uses Y-up (height from bottom). Importing an SVG without flipping Y produces an upside-down profile.
**Why it happens:** SVG follows the screen convention; pottery profiles follow the engineering convention.
**How to avoid:** After extracting the path from the imported SVG, flip the Y coordinates: `y = maxY - y` for each point. Also need to normalize X so that the leftmost point is at x=0 (the revolution axis) or handle the case where the profile includes the axis.
**Warning signs:** Profile renders upside down; foot is at top, rim is at bottom.

### Pitfall 3: Parametric Preset Produces Invalid Geometry
**What goes wrong:** Certain slider combinations (e.g., belly width = 0, or foot wider than rim by a lot with certain curves) can produce control points that cause self-intersections or undercuts.
**Why it happens:** Bezier control point positions derived from parameters can create problematic curves at extreme values.
**How to avoid:** Clamp slider min/max values to safe ranges per preset. Add parameter validation in the generator function that adjusts control points to avoid known problem zones. Run the existing `validateConstraints()` after generation and show a warning if violations are found.
**Warning signs:** Red constraint violations appearing when sliders are at extreme positions.

### Pitfall 4: Reference Image CORS/Security Issues
**What goes wrong:** Loading images from URLs (not file upload) triggers CORS restrictions. Even with file upload, some browsers restrict canvas operations after a cross-origin image is drawn.
**Why it happens:** Browser security model prevents reading pixel data from cross-origin images.
**How to avoid:** Only support file upload (not URL input) for reference images. Use `FileReader.readAsDataURL()` which creates a data URL that is same-origin by definition. Never use `img.src = externalUrl` for the tracing feature.
**Warning signs:** "Tainted canvas" errors in console; image fails to load.

### Pitfall 5: Mode Switch Loses Undo History
**What goes wrong:** Switching from parametric to freehand mode, or vice versa, can corrupt or lose the undo history if the undo manager doesn't know about the mode switch.
**Why it happens:** The undo manager stores snapshots of profile points. A mode switch generates an entirely new profile that has no undo relationship to the previous state.
**How to avoid:** When switching modes, push the current state as a new undo entry. Clear the redo stack (since you can't redo a mode switch meaningfully). Consider treating mode switches as "commit points" in the undo timeline.
**Warning signs:** Undo after mode switch produces unexpected profile or crashes.

### Pitfall 6: Slider `input` Event Floods the 3D Pipeline
**What goes wrong:** Moving a slider rapidly fires dozens of `input` events per second, each triggering `setProfileData()` -> `onChange()` -> WASM revolve. Without cancellation, this queues up stale geometry operations.
**Why it happens:** The `input` event fires on every pixel of slider drag.
**How to avoid:** The existing `generateWithCancellation()` in `geometryBridge.js` already implements latest-wins cancellation. This handles it perfectly -- stale revolve requests are discarded. The 2D Paper.js render (via `setProfileData()`) is fast enough to not need throttling. Just wire sliders directly through the existing pipeline.
**Warning signs:** None if the existing cancellation pipeline is used correctly.

## Code Examples

Verified patterns from official sources and codebase analysis:

### Parametric Pot Shape: Default Parameters for Four Presets
```javascript
// Source: Domain research (pottery dimension references) + codebase analysis
// All dimensions in mm. These are fired/final sizes.
// The mould generator will scale up for shrinkage in Phase 5.

export const PRESET_DEFAULTS = {
  cup: {
    height: 90,        // 3.5" = ~90mm (standard coffee cup)
    rimDiameter: 80,   // 3.25" = ~82mm
    bellyWidth: 85,    // Slightly wider than rim
    footDiameter: 55,  // ~60% of rim
  },
  bowl: {
    height: 65,        // 2.5" = ~65mm (cereal/soup bowl)
    rimDiameter: 150,  // 6" = ~150mm
    bellyWidth: 155,   // Very slightly wider
    footDiameter: 70,  // ~47% of rim
  },
  vase: {
    height: 200,       // 8" = ~200mm
    rimDiameter: 60,   // Narrow neck: 2.5" = ~60mm
    bellyWidth: 130,   // Wide belly: 5" = ~130mm
    footDiameter: 70,  // Moderate foot
  },
  tumbler: {
    height: 110,       // 4.5" = ~110mm
    rimDiameter: 80,   // 3.25" = ~80mm
    bellyWidth: 78,    // Slightly narrower than rim (straight-sided)
    footDiameter: 65,  // ~80% of rim (narrow taper)
  },
};
```

### SVG Import: File Upload to Profile Points
```javascript
// Source: Paper.js importSVG docs + FileReader MDN docs
function handleSVGUpload(file, editor, transform) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const svgString = e.target.result;

    // Import SVG using Paper.js (don't insert into canvas)
    const imported = paper.project.importSVG(svgString, {
      expandShapes: true,
      insert: false,
    });

    // Find the first path in the imported tree
    const svgPath = findFirstPath(imported);
    if (!svgPath) {
      alert('No path found in SVG file. The file must contain at least one <path> element.');
      return;
    }

    // Convert SVG path segments to profile points
    // 1. Get bounding box for normalization
    const bounds = svgPath.bounds;

    // 2. Normalize: flip Y, scale to reasonable size, position at origin
    const targetHeight = 100; // mm, default height
    const scaleFactor = targetHeight / bounds.height;

    const profilePoints = [];
    for (let i = 0; i < svgPath.segments.length; i++) {
      const seg = svgPath.segments[i];
      const prevSeg = i > 0 ? svgPath.segments[i - 1] : null;

      // Convert to profile space (mm, Y-up)
      const x = (seg.point.x - bounds.left) * scaleFactor;
      const y = (bounds.bottom - seg.point.y) * scaleFactor; // Y-flip

      const hasHandleIn = seg.handleIn && seg.handleIn.length > 0.5;
      const prevHasHandleOut = prevSeg && prevSeg.handleOut && prevSeg.handleOut.length > 0.5;
      const isBezier = (hasHandleIn || prevHasHandleOut) && i > 0;

      if (!isBezier) {
        profilePoints.push({ x: Math.max(0, x), y: Math.max(0, y), type: 'line' });
      } else {
        // Extract control points in profile space
        const cp1Canvas = prevSeg.point.add(prevSeg.handleOut || new paper.Point(0, 0));
        const cp2Canvas = seg.point.add(seg.handleIn || new paper.Point(0, 0));

        const cp1x = (cp1Canvas.x - bounds.left) * scaleFactor;
        const cp1y = (bounds.bottom - cp1Canvas.y) * scaleFactor;
        const cp2x = (cp2Canvas.x - bounds.left) * scaleFactor;
        const cp2y = (bounds.bottom - cp2Canvas.y) * scaleFactor;

        profilePoints.push({
          x: Math.max(0, x),
          y: Math.max(0, y),
          type: 'bezier',
          cp1: { x: cp1x, y: cp1y },
          cp2: { x: cp2x, y: cp2y },
        });
      }
    }

    // Set in editor
    const profile = createProfile(profilePoints);
    editor.setProfileData(profile);
  };

  reader.readAsText(file);
}
```

### Reference Image Overlay with Opacity Slider
```javascript
// Source: Paper.js Raster docs + FileReader MDN docs
function handleImageUpload(file, layers, transform) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const dataUrl = e.target.result;
    const raster = new paper.Raster(dataUrl);

    raster.onLoad = function() {
      // Clear previous reference image
      layers.reference.removeChildren();

      // Scale to fit editor coordinate space
      const editorHeight = transform.scale * 120; // 120mm visible area
      const scaleFactor = editorHeight / raster.height;
      raster.scale(scaleFactor);

      // Position: center horizontally, bottom-aligned with profile origin
      raster.position = new paper.Point(
        transform.offsetX + (raster.width * scaleFactor) / 2,
        transform.offsetY - (raster.height * scaleFactor) / 2
      );

      raster.opacity = 0.3;
      layers.reference.addChild(raster);
    };
  };

  reader.readAsDataURL(file);
}

// Opacity slider wiring
function wireOpacitySlider(sliderId, layers) {
  const slider = document.getElementById(sliderId);
  if (!slider) return;

  slider.addEventListener('input', (e) => {
    const opacity = parseFloat(e.target.value);
    const children = layers.reference.children;
    for (const child of children) {
      child.opacity = opacity;
    }
  });
}
```

### Slider-Driven Parametric Update
```javascript
// Source: MDN input event docs + existing codebase architecture
function wireParametricSliders(presetName, editor) {
  const sliderIds = ['height', 'rim-diameter', 'belly-width', 'foot-diameter'];
  const paramMap = {
    'height': 'height',
    'rim-diameter': 'rimDiameter',
    'belly-width': 'bellyWidth',
    'foot-diameter': 'footDiameter',
  };

  function regenerate() {
    const params = {};
    for (const id of sliderIds) {
      const slider = document.getElementById(`slider-${id}`);
      if (slider) {
        params[paramMap[id]] = parseFloat(slider.value);
      }
    }

    // Generate profile from parametric function
    const points = generatePresetProfile(presetName, params);
    const profile = createProfile(points);
    editor.setProfileData(profile);
    // onChange callback in editor fires automatically -> 3D preview updates
  }

  // Wire each slider's 'input' event for real-time updates
  for (const id of sliderIds) {
    const slider = document.getElementById(`slider-${id}`);
    if (slider) {
      slider.addEventListener('input', regenerate);
    }
  }
}
```

### Layer Setup for Reference Image (canvasSetup.js modification)
```javascript
// Source: Existing canvasSetup.js architecture
// New layer order: reference(0) -> grid(1) -> profile(2) -> handles(3) -> overlay(4)

export function initCanvas(canvasId) {
  const canvas = document.getElementById(canvasId);
  paper.setup(canvas);

  // Layer 0: reference image (bottom-most, below grid)
  const referenceLayer = paper.project.activeLayer;
  referenceLayer.name = 'reference';

  // Layer 1: grid
  const gridLayer = new paper.Layer();
  gridLayer.name = 'grid';

  // Layer 2: profile path
  const profileLayer = new paper.Layer();
  profileLayer.name = 'profile';

  // Layer 3: handles
  const handleLayer = new paper.Layer();
  handleLayer.name = 'handles';

  // Layer 4: overlay (constraints, dimensions)
  const overlayLayer = new paper.Layer();
  overlayLayer.name = 'overlay';

  profileLayer.activate();

  return {
    project: paper.project,
    view: paper.view,
    layers: {
      reference: referenceLayer,
      grid: gridLayer,
      profile: profileLayer,
      handles: handleLayer,
      overlay: overlayLayer,
    },
  };
}
```

## Parametric Shape Mathematics

### How Pottery Shapes Map to Bezier Profiles

Each pottery form is a half cross-section (right side only) from foot to rim, represented as 5-7 points with a mix of line and bezier segments. The key measurements that define a pot shape are:

1. **Height (h)** - Total vertical distance from foot bottom to rim top
2. **Rim radius (rimR)** - Half the rim diameter (topmost point x-coordinate)
3. **Belly radius (bellyR)** - Half the maximum width (widest point x-coordinate)
4. **Foot radius (footR)** - Half the foot diameter (bottommost point x-coordinate)

The four presets differ in the PROPORTIONAL RELATIONSHIPS between these measurements and WHERE the belly point sits vertically:

| Preset | Belly Position (% of height) | Rim vs Belly | Foot vs Rim | Character |
|--------|------------------------------|--------------|-------------|-----------|
| Cup | 55% | rim ~ belly | foot ~ 65% rim | Gently flared, wide body |
| Bowl | 45% | rim > belly slightly | foot ~ 45% rim | Wide, shallow, open |
| Vase | 40% | rim << belly (narrow neck) | foot ~ 50% belly | Dramatic belly, narrow top |
| Tumbler | 60% | rim ~ belly | foot ~ 80% rim | Nearly straight-sided |

### Control Point Placement Strategy

For each bezier segment, control points should be placed to create smooth, natural pottery curves:

1. **cp1** (near the start of curve): Position 1/3 of the way along the curve, horizontally biased toward the start point's x-coordinate
2. **cp2** (near the end of curve): Position 2/3 of the way along the curve, horizontally biased toward the end point's x-coordinate
3. **Vertical spread**: Control points should have y-values between the two endpoint y-values, creating a smooth vertical transition

The foot zone (bottom 3-5mm) should always use line segments for a flat base. The transition from foot to body should be a tight curve (short bezier) that creates the characteristic "tuck" inward.

### Slider Ranges Per Preset

| Parameter | Cup Range (mm) | Bowl Range (mm) | Vase Range (mm) | Tumbler Range (mm) |
|-----------|---------------|-----------------|-----------------|-------------------|
| Height | 60-130 | 30-100 | 100-350 | 70-160 |
| Rim Diameter | 60-120 | 100-250 | 30-100 | 55-110 |
| Belly Width | 60-130 | 100-260 | 60-200 | 55-115 |
| Foot Diameter | 30-80 | 40-120 | 30-100 | 40-90 |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| External SVG tool (Inkscape) for profile | In-browser parametric presets | ShapeCast showed this gap 2024-2025 | Huge UX improvement -- no external tool needed |
| Server-side profile parsing | Client-side Paper.js importSVG | Paper.js 0.12+ (stable since 2018) | No server dependency for SVG processing |
| Canvas `drawImage()` for reference | Paper.js Raster with layer system | Paper.js native feature | Integrates with coordinate transforms and zooming |

**Deprecated/outdated:**
- `paper.project.importSVG()` with callback-only signature: The options-object signature is preferred (added in Paper.js ~0.10)
- Setting `paper.Raster` source via DOM element ID: Use data URL from FileReader instead (works offline, no DOM pollution)

## Open Questions

Things that could not be fully resolved:

1. **Optimal bezier control point formulas for each preset**
   - What we know: The general strategy (proportional placement relative to endpoints) works. The test profile in `getTestProfile()` demonstrates working cup-like control points.
   - What is unclear: The exact multipliers for each preset's control points to produce the most "natural" looking pottery shapes will need visual tuning.
   - Recommendation: Start with the proportional formulas documented above, then visually tune by rendering the four presets and comparing to real pottery photos. This is a design/aesthetics task, not a technical one.

2. **SVG import: handling of non-path SVG elements**
   - What we know: `importSVG({ expandShapes: true })` converts basic shapes (rect, circle, ellipse) to paths. The `findFirstPath()` recursive walker handles nested groups.
   - What is unclear: How well Paper.js handles extremely complex SVGs with transforms, clip paths, or embedded images.
   - Recommendation: Document that SVG import works best with simple SVGs containing a single `<path>` element. Show an error message for SVGs where no usable path is found. Do NOT try to handle every possible SVG variant -- ShapeCast also requires a specific SVG format.

3. **Reference image scaling/positioning UX**
   - What we know: Paper.js Raster supports position, scale, and opacity. The image can be placed on a dedicated layer below the grid.
   - What is unclear: Whether users need drag-to-reposition and pinch-to-resize on the reference image, or if auto-fit-to-canvas is sufficient for v1.
   - Recommendation: Start with auto-fit (scale to fill editor height) + opacity slider. Defer manual repositioning to a future iteration if users request it. This keeps the scope manageable for Plan 03-02.

## Sources

### Primary (HIGH confidence)
- Paper.js Project `importSVG()` -- [Paper.js Project Reference](http://paperjs.org/reference/project/) and [gaiatrend docs mirror](https://www.gaiatrend.fr/wp-content/themes/gaiatrend/js/paperjs/docs/classes/Project.html)
- Paper.js `Raster` class -- [Paper.js Raster Reference](http://paperjs.org/reference/raster/) and [typogram docs mirror](https://paperjs.typogram.co/project-and-items/raster)
- Paper.js `Path` constructor with SVG path-data -- [Paper.js Path Reference](http://paperjs.org/reference/path/)
- `FileReader.readAsDataURL()` -- [MDN FileReader](https://developer.mozilla.org/en-US/docs/Web/API/FileReader/readAsDataURL)
- `<input type="range">` `input` event -- [MDN input range](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/range)
- Existing codebase: `profileData.js`, `profileEditor.js`, `canvasSetup.js`, `pathRenderer.js` (directly analyzed)

### Secondary (MEDIUM confidence)
- Pottery dimension data -- [Clay Calculators Reference Guide](https://www.claycalculators.com/projectReferenceGuide) and [The Little Pot Company](https://thelittlepotcompany.co.uk/blogs/pottery/clay-weights-sizes-for-handmade-tableware-repeat-throwing-pottery)
- ShapeCast molds approach -- [ShapeCast CHI 2025 paper](https://dl.acm.org/doi/10.1145/3706598.3713866) and [shapecastmolds.com](https://shapecastmolds.com/)
- Bezier curve vase generation -- [MDPI Mathematics article](https://www.mdpi.com/2227-7390/12/13/1932)

### Tertiary (LOW confidence)
- Exact bezier control point formulas for pottery shapes -- derived from analysis of `getTestProfile()` in the codebase and general bezier curve mathematics. Will need visual tuning.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Paper.js 0.12.18 is already in the project, all needed features are documented and stable
- Architecture: HIGH - The pattern of pure-function generation -> `setProfileData()` -> onChange pipeline is proven by the existing codebase
- Parametric math: MEDIUM - The proportional approach is sound but exact control point values need visual tuning
- SVG import: HIGH - Paper.js `importSVG()` is a mature, well-documented feature; the coordinate transform logic follows the existing `syncPathToProfile()` pattern
- Reference image: HIGH - Paper.js `Raster` is documented and supports all needed features (opacity, positioning, layering)
- Pitfalls: HIGH - Based on direct codebase analysis and known Paper.js behaviors

**Research date:** 2026-02-10
**Valid until:** 2026-04-10 (90 days -- Paper.js 0.12.x is stable and unlikely to change)
