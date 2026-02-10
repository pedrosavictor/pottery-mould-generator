# Phase 2: Profile Editor Core - Research

**Researched:** 2026-02-10
**Domain:** Paper.js 2D bezier editor, constraint enforcement for pottery profiles, undo/redo, coordinate mapping
**Confidence:** HIGH (Paper.js API verified from official docs and typogram reference site; constraint algorithms verified from geometry literature)

## Summary

This research covers all technical domains needed to plan Phase 2: loading and configuring Paper.js from CDN without build tools, creating and manipulating bezier paths with interactive control point dragging, hit-testing for selecting points and handles, converting between Paper.js canvas coordinates and the profile data model (mm units), detecting invalid pottery geometry (undercuts, self-intersections, axis crossings), implementing undo/redo, and adding grid/snap/dimension overlays.

Paper.js 0.12.18 is the standard library. It is loaded via a `<script>` tag (not ESM -- Paper.js has no ESM build) using `paper-core.js` (the build without PaperScript support, saving ~50KB). Setup uses `paper.setup(canvasId)` followed by creating `paper.Tool` instances with `onMouseDown`/`onMouseDrag`/`onMouseUp` handlers. Paper.js segments have `point`, `handleIn`, and `handleOut` properties where handles are stored as RELATIVE offsets from the anchor point -- this is the critical coordinate detail that differs from the profile data model where `cp1`/`cp2` are absolute positions.

For constraint enforcement: undercuts in a pottery mould context mean the profile radius (x) decreases as you move upward (y increases) -- this prevents the pot from releasing from the mould. Detection is checking that the profile is monotonically non-decreasing in x when traversed from bottom to top, accounting for bezier curve segments by sampling or subdividing. Self-intersection detection requires splitting the path into individual curves and testing pairs with `getIntersections()`, since Paper.js has no built-in single-path self-intersection method. Axis crossing (x < 0) is a simple bounds check.

**Primary recommendation:** Use Paper.js 0.12.18 via CDN `<script>` tag with `paper-core.min.js`. Do NOT use `paper.install(window)` to avoid global namespace pollution. Access all Paper.js classes via the `paper` object (e.g., `new paper.Path()`, `new paper.Point()`). Use state-snapshot undo/redo (not command pattern) because the profile data model is small and easy to clone.

## Standard Stack

### Core
| Library | Version | CDN URL | Purpose | Why Standard |
|---------|---------|---------|---------|--------------|
| Paper.js | 0.12.18 | `https://cdnjs.cloudflare.com/ajax/libs/paper.js/0.12.18/paper-core.min.js` (204 KB) | 2D vector canvas: paths, bezier curves, hit testing, mouse interaction | Industry standard for interactive 2D vector editing on HTML5 Canvas. Built-in segment/handle/curve model matches bezier editing needs perfectly. |
| Three.js | 0.172.0 | Already loaded via import map (Phase 1) | 3D preview (unchanged) | Already integrated in Phase 1. |

### Supporting
| Library | Purpose | When to Use |
|---------|---------|-------------|
| bezier-js 6.1.4 | Self-intersection detection on individual cubic bezier curves | Only if Paper.js `getIntersections()` between curve pairs proves insufficient for self-intersection detection. CDN: `https://cdn.jsdelivr.net/npm/bezier-js@6.1.4/src/bezier.js` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Paper.js | Konva.js | Konva has better layer/drag abstractions but lacks built-in bezier curve model, handle manipulation, and path intersection algorithms. Paper.js is purpose-built for vector path editing. |
| Paper.js | Raw Canvas 2D API | Would require hand-rolling all hit testing, curve math, handle rendering. Enormous effort for no benefit. |
| Paper.js paper-core.js | Paper.js paper-full.js | paper-full.js adds PaperScript support (+50KB) which we do not need since we use vanilla JS directly. |

### CDN Loading
```html
<!-- Paper.js: loaded as global script (no ESM build available) -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/paper.js/0.12.18/paper-core.min.js"></script>

<!-- Then in ES module scripts, access via global `paper` object -->
<script type="module" src="./js/profileEditor.js"></script>
```

**Critical:** Paper.js 0.12.18 does NOT have an ESM module build. The package.json has no `"module"` or `"exports"` field. The dist only contains `paper-core.js` and `paper-full.js` as IIFE/UMD globals. Load via `<script>` tag before ES module scripts. The global `paper` variable is then available in all subsequent scripts.

## Architecture Patterns

### Recommended Project Structure (Phase 2 additions)
```
js/
  profileEditor.js          # Main editor module: canvas setup, tool switching
  profileEditor/
    canvasSetup.js           # Paper.js initialization, view configuration, coordinate transform
    pathRenderer.js          # Renders profile data model as Paper.js path with handle visualization
    editTool.js              # Tool for selecting/dragging points and handles
    drawTool.js              # Tool for adding new points to the profile
    constraints.js           # Undercut, self-intersection, axis-crossing validation
    undoManager.js           # State-snapshot undo/redo
    gridOverlay.js           # Grid lines, snap-to-grid logic
    dimensionOverlay.js      # Measurement labels, dimension input fields
  profileData.js             # (existing) Profile data model
  geometryBridge.js          # (existing) Worker communication
  preview3d.js               # (existing) Three.js preview
  app.js                     # (existing) Orchestrator -- add profile editor wiring
```

### Pattern 1: Paper.js Setup Without PaperScript (Vanilla JS)
**What:** Initialize Paper.js on a canvas element using direct JavaScript, not PaperScript.
**When to use:** Always. This project uses vanilla JS + ES modules.

```javascript
// canvasSetup.js
// Paper.js is loaded as global `paper` via <script> tag

/**
 * Initialize Paper.js on the profile editor canvas.
 * Returns the paper scope for this canvas.
 */
export function initCanvas(canvasId) {
  // Setup creates Project + View for the canvas
  paper.setup(canvasId);

  // Configure view
  const view = paper.view;

  // Disable auto-update -- we control when to redraw
  // (better performance when doing multiple operations)
  view.autoUpdate = false;

  return {
    project: paper.project,
    view: paper.view,
    requestUpdate: () => view.requestUpdate(),
  };
}
```

**Key insight:** When using vanilla JS (not PaperScript), you must:
1. Call `paper.setup(canvasId)` after DOM is ready
2. Access all classes via `paper.*` (e.g., `new paper.Path()`, `new paper.Point()`)
3. Call `paper.view.update()` or `paper.view.requestUpdate()` after changes if autoUpdate is off
4. Create `paper.Tool` instances manually and assign event handlers

### Pattern 2: Coordinate System Mapping (mm to canvas)
**What:** Bidirectional transform between profile data coordinates (mm) and Paper.js canvas coordinates.
**When to use:** Every render and every edit operation.

The profile data model uses:
- x = radius from axis (mm), positive rightward
- y = height from bottom (mm), positive upward

Paper.js canvas uses:
- x = pixels, positive rightward
- y = pixels, positive DOWNWARD

```javascript
// canvasSetup.js

/**
 * Create a coordinate transformer for the profile editor.
 *
 * Profile coords: x = radius (mm), y = height (mm), y-up
 * Canvas coords: x = pixels, y = pixels, y-DOWN
 *
 * The transform includes:
 *   - Scale: mm -> pixels (configurable zoom)
 *   - Y-flip: profile y-up -> canvas y-down
 *   - Offset: center the profile in the canvas
 */
export function createTransform(canvasWidth, canvasHeight, profileBounds) {
  // Pixels per mm (zoom level)
  const scale = Math.min(
    (canvasWidth * 0.8) / profileBounds.width,
    (canvasHeight * 0.8) / profileBounds.height
  );

  // Offset to center profile in canvas
  const offsetX = canvasWidth * 0.1;  // left margin
  const offsetY = canvasHeight * 0.9; // bottom margin (y is flipped)

  return {
    scale,

    /** Profile mm coords -> Paper.js canvas Point */
    toCanvas(profileX, profileY) {
      return new paper.Point(
        offsetX + profileX * scale,
        offsetY - profileY * scale  // Y-flip
      );
    },

    /** Paper.js canvas Point -> profile mm coords */
    toProfile(canvasPoint) {
      return {
        x: (canvasPoint.x - offsetX) / scale,
        y: (offsetY - canvasPoint.y) / scale  // Y-flip
      };
    },

    /** Scale a distance from mm to pixels */
    mmToPixels(mm) { return mm * scale; },

    /** Scale a distance from pixels to mm */
    pixelsToMm(px) { return px / scale; },
  };
}
```

**Critical detail:** Paper.js `Segment.handleIn` and `Segment.handleOut` are stored as RELATIVE offsets from the segment point. The profile data model stores `cp1` and `cp2` as ABSOLUTE positions. The conversion must account for this:

```javascript
// Converting profile bezier point to Paper.js segment
function profilePointToSegment(prevPoint, currentPoint, transform) {
  const point = transform.toCanvas(currentPoint.x, currentPoint.y);

  if (currentPoint.type === 'bezier') {
    // cp1 is the handle-out of the PREVIOUS segment
    // cp2 is the handle-in of THIS segment
    const cp2Canvas = transform.toCanvas(currentPoint.cp2.x, currentPoint.cp2.y);
    const handleIn = cp2Canvas.subtract(point); // relative to this segment's point

    return new paper.Segment(point, handleIn, null);
    // NOTE: cp1 must be set as handleOut on the PREVIOUS segment
  }

  return new paper.Segment(point);
}
```

**Mapping between profile cp1/cp2 and Paper.js handleIn/handleOut:**
- Profile `points[i].cp1` = first control point of curve from `points[i-1]` to `points[i]`
  - Maps to: `segments[i-1].handleOut` (RELATIVE to `segments[i-1].point`)
- Profile `points[i].cp2` = second control point of curve from `points[i-1]` to `points[i]`
  - Maps to: `segments[i].handleIn` (RELATIVE to `segments[i].point`)

### Pattern 3: Hit Testing for Interactive Editing
**What:** Detect which path element (point, handle, curve) the user clicked on.
**When to use:** Every mouseDown in the edit tool.

```javascript
// editTool.js

const HIT_OPTIONS = {
  segments: true,     // hit segment anchor points
  handles: true,      // hit bezier handles (handleIn/handleOut)
  stroke: true,       // hit the path stroke (for add-point-on-curve)
  curves: true,       // hit curves (needed for divideAt)
  fill: false,        // don't hit fill area
  tolerance: 8,       // pixels of tolerance for click detection
};

function onMouseDown(event) {
  const hitResult = paper.project.hitTest(event.point, HIT_OPTIONS);

  if (!hitResult) return; // clicked on empty space

  switch (hitResult.type) {
    case 'segment':
      // User clicked on an anchor point -- start dragging it
      selectedSegment = hitResult.segment;
      break;

    case 'handle-in':
      // User clicked on an incoming bezier handle
      selectedHandle = { segment: hitResult.segment, type: 'handleIn' };
      break;

    case 'handle-out':
      // User clicked on an outgoing bezier handle
      selectedHandle = { segment: hitResult.segment, type: 'handleOut' };
      break;

    case 'stroke':
    case 'curve':
      // User clicked on the curve itself -- could add a point here
      // Use divideAt() to insert a new segment
      const location = hitResult.location;
      profilePath.divideAt(location);
      break;
  }
}

function onMouseDrag(event) {
  if (selectedSegment) {
    // Move the anchor point
    selectedSegment.point = selectedSegment.point.add(event.delta);
  } else if (selectedHandle) {
    // Move the handle (adjusts curve shape)
    selectedHandle.segment[selectedHandle.type] =
      selectedHandle.segment[selectedHandle.type].add(event.delta);
  }
  paper.view.requestUpdate();
}
```

**HitResult types returned by Paper.js:**
- `'segment'` -- anchor point of a segment
- `'handle-in'` -- incoming bezier handle
- `'handle-out'` -- outgoing bezier handle
- `'stroke'` -- the rendered stroke of the path
- `'curve'` -- the curve (without considering stroke)
- `'fill'` -- the filled area
- `'bounds'` -- bounding rectangle corners/sides
- `'center'` -- bounding rectangle center

### Pattern 4: State-Snapshot Undo/Redo
**What:** Save the entire profile state on each edit; undo restores previous state.
**When to use:** For this project, because profile data is small (typically 5-20 points, ~1KB per snapshot).

```javascript
// undoManager.js

/**
 * Simple state-snapshot undo/redo manager.
 *
 * Why snapshots over command pattern:
 * - Profile data is small (5-20 points, <1KB per snapshot)
 * - 100 undo levels = ~100KB total -- negligible
 * - Command pattern requires inverse for every operation -- complex for bezier edits
 * - Snapshots are trivially correct (no inverse bugs)
 */
export function createUndoManager(maxHistory = 100) {
  let history = [];     // Array of profile data snapshots (deep clones)
  let currentIndex = -1;

  return {
    /** Save current state. Call after each user edit. */
    push(profileData) {
      // Discard any redo states ahead of current position
      history = history.slice(0, currentIndex + 1);

      // Deep clone the profile data
      history.push(JSON.parse(JSON.stringify(profileData)));
      currentIndex++;

      // Trim history if over limit
      if (history.length > maxHistory) {
        history.shift();
        currentIndex--;
      }
    },

    /** Undo: return previous state, or null if at start. */
    undo() {
      if (currentIndex <= 0) return null;
      currentIndex--;
      return JSON.parse(JSON.stringify(history[currentIndex]));
    },

    /** Redo: return next state, or null if at end. */
    redo() {
      if (currentIndex >= history.length - 1) return null;
      currentIndex++;
      return JSON.parse(JSON.stringify(history[currentIndex]));
    },

    canUndo() { return currentIndex > 0; },
    canRedo() { return currentIndex < history.length - 1; },
  };
}
```

**Keyboard shortcuts** should be bound via `document.addEventListener('keydown', ...)`, NOT via Paper.js Tool `onKeyDown`, because the shortcuts should work regardless of which tool is active:

```javascript
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
    e.preventDefault();
    if (e.shiftKey) {
      // Cmd+Shift+Z = Redo
      const state = undoManager.redo();
      if (state) applyProfileState(state);
    } else {
      // Cmd+Z = Undo
      const state = undoManager.undo();
      if (state) applyProfileState(state);
    }
  }
});
```

### Pattern 5: Profile Rendering (Data Model to Paper.js Path)
**What:** Create a Paper.js Path from the profile data model.
**When to use:** On initial load, on undo/redo, and after constraint corrections.

```javascript
// pathRenderer.js

/**
 * Build a Paper.js Path from profile data model points.
 * This is a one-way render: data model -> visual path.
 * Edits to the path are synced back to the data model in the edit tool.
 */
export function renderProfile(profilePoints, transform) {
  const segments = [];

  for (let i = 0; i < profilePoints.length; i++) {
    const pt = profilePoints[i];
    const canvasPoint = transform.toCanvas(pt.x, pt.y);

    let handleIn = null;
    let handleOut = null;

    // handleIn for this segment comes from this point's cp2 (if bezier)
    if (pt.type === 'bezier' && pt.cp2) {
      const cp2Canvas = transform.toCanvas(pt.cp2.x, pt.cp2.y);
      handleIn = cp2Canvas.subtract(canvasPoint); // relative
    }

    // handleOut for this segment comes from NEXT point's cp1 (if next is bezier)
    const nextPt = profilePoints[i + 1];
    if (nextPt && nextPt.type === 'bezier' && nextPt.cp1) {
      const cp1Canvas = transform.toCanvas(nextPt.cp1.x, nextPt.cp1.y);
      handleOut = cp1Canvas.subtract(canvasPoint); // relative
    }

    segments.push(new paper.Segment(canvasPoint, handleIn, handleOut));
  }

  const path = new paper.Path({
    segments: segments,
    strokeColor: '#2d2d2d',
    strokeWidth: 2,
    selected: false,      // do NOT auto-select (we draw custom handles)
  });

  return path;
}
```

### Anti-Patterns to Avoid
- **`paper.install(window)`:** Pollutes global namespace, overrides native `Path` constructor, causes conflicts with other libraries. Always use `paper.Path`, `paper.Point`, etc.
- **Using PaperScript:** Adds parser overhead, different scoping rules, not debuggable in standard JS debuggers. Use vanilla JS directly.
- **Storing Paper.js objects as the source of truth:** Paper.js `Segment`/`Path` objects are canvas-coordinate visual representations. The profile data model (mm coordinates) is the source of truth. Always sync Paper.js -> data model after edits, and data model -> Paper.js for rendering.
- **Using `view.onFrame` for a static editor:** The profile editor is not an animation. Do not run a continuous animation loop. Use `view.requestUpdate()` or `view.update()` after changes only.
- **Trusting Paper.js `getIntersections()` for self-intersection:** Paper.js `getIntersections(otherPath)` requires TWO different paths. For self-intersection, you must split into individual curves and test pairs.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bezier curve rendering | Manual Canvas 2D bezierCurveTo() calls | Paper.js Path with Segments | Paper.js handles anti-aliasing, hit testing, handle rendering, curve subdivision automatically |
| Hit testing on curves | Distance-to-bezier math | `paper.project.hitTest(point, options)` | Handles all geometry types (segments, handles, strokes, curves) with configurable tolerance |
| Point-on-curve insertion | Manual curve splitting math | `path.divideAt(location)` | Paper.js divides the curve at the exact location, creating a new segment with correct handles |
| Segment removal | Manual handle recalculation | `segment.remove()` or `path.removeSegment(index)` | Paper.js automatically adjusts neighboring curves |
| Path intersection detection | Bezier clipping algorithm from scratch | `path.getIntersections(otherPath)` | Paper.js implements bezier clipping internally |
| Coordinate transforms | Manual matrix math | Paper.js `view.projectToView()` / `view.viewToProject()` + custom mm<->project transform | Paper.js handles DPI, zoom, and pan transforms |

**Key insight:** Paper.js is a complete 2D vector graphics framework. The only custom code needed is: (a) coordinate mapping between mm and canvas, (b) pottery-specific constraint validation, (c) syncing between the profile data model and Paper.js paths.

## Common Pitfalls

### Pitfall 1: Handles Are Relative, Not Absolute
**What goes wrong:** Developer sets `segment.handleIn = new paper.Point(25, 40)` thinking it positions the handle at canvas coordinate (25, 40). Actually, it positions the handle at 25px right and 40px down FROM the segment's anchor point.
**Why it happens:** Paper.js stores handles as offsets relative to their segment point. The profile data model stores cp1/cp2 as absolute coordinates. This mismatch is the #1 source of bugs.
**How to avoid:** Always convert: `handleIn = absoluteControlPoint.subtract(segmentPoint)`. Document the conversion in a single function used everywhere.
**Warning signs:** Bezier curves that shoot off in wrong directions, handles that appear in the wrong place.
**Confidence:** HIGH -- verified from Paper.js Segment documentation.

### Pitfall 2: Paper.js Y-Axis Points Down
**What goes wrong:** Profile rendered upside down, or mouse drags move points in wrong direction.
**Why it happens:** Canvas/Paper.js has Y increasing downward. Profile data model has Y increasing upward (height from bottom).
**How to avoid:** All coordinate conversions must negate Y: `canvasY = offsetY - profileY * scale`. Put this in a single transform module used everywhere.
**Warning signs:** Profile appears flipped, drag feels inverted.
**Confidence:** HIGH -- standard Canvas 2D coordinate system.

### Pitfall 3: Paper.js Has No Self-Intersection Method for Single Paths
**What goes wrong:** Developer calls `path.getIntersections(path)` passing the same path twice, expecting to find self-intersections. Returns incorrect or empty results.
**Why it happens:** `getIntersections()` is designed for two different paths. Testing a path against itself has edge cases with shared segments.
**How to avoid:** Split the path into individual curve objects, then test each pair:
```javascript
function findSelfIntersections(path) {
  const curves = path.curves;
  const intersections = [];
  for (let i = 0; i < curves.length; i++) {
    for (let j = i + 2; j < curves.length; j++) { // skip adjacent curves
      const curvePathA = new paper.Path([curves[i].segment1, curves[i].segment2]);
      const curvePathB = new paper.Path([curves[j].segment1, curves[j].segment2]);
      const hits = curvePathA.getIntersections(curvePathB);
      intersections.push(...hits);
      curvePathA.remove();
      curvePathB.remove();
    }
  }
  return intersections;
}
```
**Warning signs:** Self-intersecting profiles pass validation.
**Confidence:** MEDIUM -- workaround from community discussion, not official API.

### Pitfall 4: Forgetting to Call view.update() in Vanilla JS
**What goes wrong:** Code modifies path segments but nothing changes visually on screen.
**Why it happens:** In PaperScript, the view auto-updates after event handlers. In vanilla JS mode, if `autoUpdate` is false or no `onFrame` handler is set, the view does NOT auto-redraw. You must call `view.requestUpdate()` or `view.update()`.
**How to avoid:** After any modification to Paper.js items, call `paper.view.requestUpdate()`. Or keep `autoUpdate` set to `true` (the default) and it will update on the next animation frame after any change.
**Warning signs:** Console shows data changed but canvas is stale.
**Confidence:** HIGH -- documented in Paper.js issue #921 and official view reference.

### Pitfall 5: cp1/cp2 Mapping Between Profile Model and Paper.js
**What goes wrong:** Control points appear on wrong curves, or curves have wrong shape after editing.
**Why it happens:** The profile data model defines `cp1` and `cp2` on the END point of a bezier segment (the point with `type: 'bezier'`). `cp1` is the control point near the START of the curve (previous point's outgoing handle), `cp2` is the control point near the END (this point's incoming handle). In Paper.js, `handleOut` belongs to the start segment and `handleIn` belongs to the end segment.
**How to avoid:** Document the mapping clearly and use a single conversion function:
```
Profile point[i] with type:'bezier':
  cp1 -> Paper.js segments[i-1].handleOut (relative to segments[i-1].point)
  cp2 -> Paper.js segments[i].handleIn (relative to segments[i].point)
```
**Warning signs:** Curves look different in editor vs. 3D preview. Editing a handle affects the wrong curve.
**Confidence:** HIGH -- verified by tracing through replicad's `cubicBezierCurveTo(end, startCP, endCP)` API.

### Pitfall 6: Paper.js Global State and Multiple Canvases
**What goes wrong:** If the app later has multiple canvases (profile editor + another), Paper.js operations affect the wrong canvas.
**Why it happens:** `paper.setup()` sets the active project/view globally. Operations like `new paper.Path()` create items in the currently active project.
**How to avoid:** After setup, store the project reference. Before making changes, call `paper.projects[index].activate()` or use `paper.project = myProject`. For Phase 2 with a single editor canvas, this is not yet a problem, but the architecture should be aware.
**Warning signs:** Items appear on wrong canvas, or disappear unexpectedly.
**Confidence:** HIGH -- documented in Paper.js PaperScope reference.

## Code Examples

### Complete Paper.js Initialization (Vanilla JS)
```javascript
// profileEditor.js
// Assumes <script src="paper-core.min.js"> loaded before this module

export function initProfileEditor(canvasId) {
  // Initialize Paper.js on our canvas element
  paper.setup(canvasId);

  // Access view and project
  const view = paper.view;
  const project = paper.project;

  // Create layers for organization
  const gridLayer = new paper.Layer({ name: 'grid' });
  const profileLayer = new paper.Layer({ name: 'profile' });
  const handleLayer = new paper.Layer({ name: 'handles' });
  const overlayLayer = new paper.Layer({ name: 'overlays' });

  // Activate profile layer for drawing
  profileLayer.activate();

  // Create the edit tool
  const editTool = new paper.Tool();
  editTool.onMouseDown = function(event) { /* ... */ };
  editTool.onMouseDrag = function(event) { /* ... */ };
  editTool.onMouseUp = function(event) { /* ... */ };

  // Handle canvas resize
  view.onResize = function(event) {
    // Recalculate transforms and redraw
  };

  return { view, project, editTool };
}
```

### Rendering Handle Decorators
```javascript
// pathRenderer.js
// Paper.js selected paths show handles automatically, but the default
// rendering is not ideal for a profile editor. Custom handle rendering
// gives better UX.

/**
 * Draw custom handle decorators for a profile path.
 * Small circles at anchor points, lines + small circles at handle positions.
 */
export function renderHandles(path, handleLayer) {
  handleLayer.removeChildren(); // clear previous handles
  handleLayer.activate();

  const anchorRadius = 5;
  const handleRadius = 3;

  for (const segment of path.segments) {
    // Anchor point: filled circle
    new paper.Path.Circle({
      center: segment.point,
      radius: anchorRadius,
      fillColor: '#2d2d2d',
      strokeColor: null,
    });

    // Handle-in line and circle
    if (!segment.handleIn.isZero()) {
      const handlePos = segment.point.add(segment.handleIn);
      new paper.Path.Line({
        from: segment.point,
        to: handlePos,
        strokeColor: '#999',
        strokeWidth: 1,
      });
      new paper.Path.Circle({
        center: handlePos,
        radius: handleRadius,
        fillColor: '#999',
        strokeColor: null,
      });
    }

    // Handle-out line and circle
    if (!segment.handleOut.isZero()) {
      const handlePos = segment.point.add(segment.handleOut);
      new paper.Path.Line({
        from: segment.point,
        to: handlePos,
        strokeColor: '#999',
        strokeWidth: 1,
      });
      new paper.Path.Circle({
        center: handlePos,
        radius: handleRadius,
        fillColor: '#999',
        strokeColor: null,
      });
    }
  }

  paper.view.requestUpdate();
}
```

### Grid Overlay
```javascript
// gridOverlay.js

/**
 * Draw a measurement grid on the grid layer.
 * Grid spacing adapts to zoom level (always shows reasonable density).
 */
export function renderGrid(gridLayer, transform, canvasWidth, canvasHeight) {
  gridLayer.removeChildren();
  gridLayer.activate();

  // Determine grid spacing in mm (adapt to zoom)
  const pixelsPerMm = transform.scale;
  let gridSpacingMm = 1;
  if (pixelsPerMm < 2) gridSpacingMm = 10;
  else if (pixelsPerMm < 5) gridSpacingMm = 5;
  else if (pixelsPerMm < 20) gridSpacingMm = 2;

  const gridColor = '#e0ddd8';
  const axisColor = '#c2956b'; // terra cotta for revolution axis

  // Vertical lines (x = constant radius values)
  for (let x = 0; x <= 100; x += gridSpacingMm) {
    const canvasX = transform.toCanvas(x, 0).x;
    if (canvasX < 0 || canvasX > canvasWidth) continue;
    new paper.Path.Line({
      from: new paper.Point(canvasX, 0),
      to: new paper.Point(canvasX, canvasHeight),
      strokeColor: x === 0 ? axisColor : gridColor,
      strokeWidth: x === 0 ? 2 : 0.5,
    });
  }

  // Horizontal lines (y = constant height values)
  for (let y = 0; y <= 200; y += gridSpacingMm) {
    const canvasY = transform.toCanvas(0, y).y;
    if (canvasY < 0 || canvasY > canvasHeight) continue;
    new paper.Path.Line({
      from: new paper.Point(0, canvasY),
      to: new paper.Point(canvasWidth, canvasY),
      strokeColor: gridColor,
      strokeWidth: 0.5,
    });
  }

  paper.view.requestUpdate();
}
```

### Snap-to-Grid Function
```javascript
// gridOverlay.js

/**
 * Snap a profile coordinate to the nearest grid point.
 * @param {number} value - coordinate value in mm
 * @param {number} gridSpacing - grid spacing in mm
 * @returns {number} snapped value
 */
export function snapToGrid(value, gridSpacing) {
  return Math.round(value / gridSpacing) * gridSpacing;
}

/**
 * Snap a profile point to grid if snap is enabled.
 */
export function snapProfilePoint(profilePoint, gridSpacing, snapEnabled) {
  if (!snapEnabled) return profilePoint;
  return {
    ...profilePoint,
    x: snapToGrid(profilePoint.x, gridSpacing),
    y: snapToGrid(profilePoint.y, gridSpacing),
  };
}
```

## Constraint Enforcement

### Undercut Detection for Pottery Moulds

**What is an undercut in pottery context:**
An undercut occurs when the profile shape would prevent the pot from being released from a rigid mould. For a revolved shape with a two-part vertical split mould, an undercut means the profile radius (x) DECREASES as you move upward -- creating an inward bulge that the mould wraps around.

**Mathematical definition for this project:**
Given the profile represents the outer surface of the pot (x = radius, y = height), an undercut exists if at any point moving upward along the profile, the radius decreases. In other words, the profile must be monotonically non-decreasing in x as y increases -- EXCEPT at the very bottom (foot), where a small tuck-in is normal and handled by the mould's bottom piece.

**Detection algorithm for line segments:**
For consecutive line-type points, check that `x[i+1] >= x[i]` when `y[i+1] > y[i]` (starting from the foot transition point, typically point 2 or 3).

**Detection algorithm for bezier segments:**
For bezier curves, the x-coordinate can dip even if the endpoints are monotonically increasing. Must sample the curve at intervals or find extrema:

```javascript
// constraints.js

/**
 * Check if a cubic bezier curve has any x-decreasing section
 * (undercut) when traversed in the y-increasing direction.
 *
 * Uses Paper.js curve subdivision to sample.
 */
function curveHasUndercut(curve) {
  const SAMPLES = 20;
  let prevX = curve.getPointAt(0).x; // Note: this is canvas X

  for (let t = 1; t <= SAMPLES; t++) {
    const frac = t / SAMPLES;
    const point = curve.getPointAt(curve.length * frac);
    if (point.x < prevX - 0.01) { // small tolerance for floating point
      return true; // radius decreased = undercut
    }
    prevX = point.x;
  }
  return false;
}
```

**Important nuance:** In canvas coordinates (y-down), "moving upward" means y is decreasing. But we work in profile coordinates where y-up. The transform handles this. The undercut check should operate on profile-coordinate data, not canvas coordinates.

### Self-Intersection Detection

Paper.js does not have a single method for self-intersection detection. The approach is to compare non-adjacent curve pairs:

```javascript
// constraints.js

/**
 * Detect self-intersections in the profile path.
 * Compares each curve with every non-adjacent curve.
 *
 * Returns array of intersection points (in canvas coords) for visualization.
 */
function detectSelfIntersections(profilePath) {
  const curves = profilePath.curves;
  const intersections = [];

  for (let i = 0; i < curves.length; i++) {
    // Start at i+2 to skip the adjacent curve (they share an endpoint)
    for (let j = i + 2; j < curves.length; j++) {
      // Create temporary paths from individual curves
      const pathA = new paper.Path({
        segments: [curves[i].segment1.clone(), curves[i].segment2.clone()],
        insert: false, // don't add to project
      });
      const pathB = new paper.Path({
        segments: [curves[j].segment1.clone(), curves[j].segment2.clone()],
        insert: false,
      });

      const hits = pathA.getIntersections(pathB);
      for (const hit of hits) {
        intersections.push(hit.point);
      }
    }
  }

  return intersections;
}
```

### Axis Crossing Detection

The profile should never have x < 0 (crossing the revolution axis). For anchor points this is trivial. For bezier curves, check if the curve's bounding box extends past x = 0:

```javascript
// constraints.js

/**
 * Check if any part of the profile crosses the revolution axis (x < 0).
 * Returns array of violation locations.
 */
function detectAxisCrossings(profilePath, transform) {
  const violations = [];

  // Check anchor points
  for (const segment of profilePath.segments) {
    const profileCoord = transform.toProfile(segment.point);
    if (profileCoord.x < 0) {
      violations.push({ type: 'point', point: segment.point });
    }
  }

  // Check bezier curves (they can extend beyond endpoint x values)
  for (const curve of profilePath.curves) {
    const bounds = curve.bounds;
    const leftEdge = transform.toProfile(new paper.Point(bounds.left, bounds.top));
    if (leftEdge.x < 0) {
      violations.push({ type: 'curve', curve: curve });
    }
  }

  return violations;
}
```

### Visual Feedback for Constraint Violations

```javascript
// constraints.js

/**
 * Highlight constraint violations on the overlay layer.
 * Red markers at violation points, red-tinted path segments.
 */
function renderViolations(violations, overlayLayer) {
  overlayLayer.removeChildren();
  overlayLayer.activate();

  for (const v of violations) {
    if (v.type === 'undercut') {
      // Draw red zone over the offending curve section
      // ... red semi-transparent overlay
    } else if (v.type === 'intersection') {
      // Draw red X at intersection point
      const marker = new paper.Path.Circle({
        center: v.point,
        radius: 6,
        fillColor: new paper.Color(1, 0, 0, 0.5),
        strokeColor: 'red',
        strokeWidth: 2,
      });
    } else if (v.type === 'axisCrossing') {
      // Draw red vertical line at x=0
      // ... red dashed line
    }
  }

  paper.view.requestUpdate();
}
```

## Dimension Input UI

### Approach: HTML Overlays on Canvas

Dimension inputs (rim diameter, height, etc.) should be HTML `<input>` elements positioned absolutely over the canvas, NOT drawn on the canvas itself. Reasons:
1. Native text input with keyboard handling, selection, clipboard
2. Accessible (screen readers, tab order)
3. No need to implement text editing on canvas

```html
<!-- In index.html, inside the editor container -->
<div id="editor-container" style="position: relative;">
  <canvas id="profile-canvas"></canvas>

  <!-- Dimension input overlays -->
  <div class="dimension-input" id="dim-height" style="position: absolute;">
    <label>Height</label>
    <input type="number" step="0.5" min="0" /> mm
  </div>
  <div class="dimension-input" id="dim-rim-diameter" style="position: absolute;">
    <label>Rim diameter</label>
    <input type="number" step="0.5" min="0" /> mm
  </div>
</div>
```

Position these inputs using the coordinate transform to place them near the relevant profile dimension. Update positions when the view scrolls/zooms.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SVG-based editors (Snap.svg, Raphael) | Canvas-based (Paper.js, Fabric.js) | ~2015 | Better performance for interactive editing, no DOM bloat |
| PaperScript (Paper.js custom language) | Vanilla JS with `paper.setup()` | Paper.js 0.10+ | Standard debugging, no parser overhead, works with ES modules |
| Command-pattern undo (reverse each op) | State-snapshot undo (for small data) | Modern practice | Simpler, no inverse-operation bugs, trivial for small state |
| Continuous `requestAnimationFrame` loop for static editors | On-demand `view.requestUpdate()` | Paper.js 0.12+ with `autoUpdate` | Better CPU usage for editors that are idle most of the time |

**Deprecated/outdated:**
- PaperScript: Still supported but adds parser overhead and non-standard syntax. Use vanilla JS.
- `paper.install(window)`: Pollutes global scope, conflicts with native `Path`. Use `paper.*` prefix.
- Paper.js 0.11 and earlier: Missing `autoUpdate`, `requestUpdate()`, and several bug fixes.

## Open Questions

1. **Paper.js `getIntersections()` reliability for self-intersection via curve pairs**
   - What we know: The workaround of comparing curve pairs should work for non-adjacent curves.
   - What's unclear: Edge cases with curves that are nearly tangent but not quite intersecting. Paper.js has several open issues about intersection accuracy (#1409, #1460).
   - Recommendation: Implement the curve-pair approach. If intersection detection proves unreliable, fall back to bezier-js library which has dedicated `selfintersects()` method for individual cubic curves.

2. **Paper.js performance with frequent handle layer redraws**
   - What we know: Paper.js redraws the entire canvas on each update. With handle decorators (circles + lines for each segment), there may be ~50-100 items.
   - What's unclear: Whether redrawing ~100 simple shapes on every mouse drag is smooth at 60fps.
   - Recommendation: This should be fine for <100 items based on Paper.js issue #693. Profile editors typically have 5-20 segments = ~60-120 decorator items. If it becomes slow, rasterize the grid layer.

3. **Interaction between Paper.js `<script>` tag and ES module system**
   - What we know: Paper.js is loaded as a global via `<script>` tag. The rest of the app uses ES modules.
   - What's unclear: Whether there are timing issues (Paper.js not yet loaded when ES module executes).
   - Recommendation: Put the Paper.js `<script>` tag before the `<script type="module">` tag. The browser guarantees classic scripts execute before module scripts. Access `paper` as a global inside modules.

4. **Exact undercut rules for pottery mould design**
   - What we know: Profile radius must not decrease as height increases (for standard two-part moulds). The foot area is an exception.
   - What's unclear: Whether the undercut rule applies from the very first point or from a "foot top" marker. Real pottery moulds often have a slight tuck at the foot.
   - Recommendation: Define a "foot zone" (first 2-3 points or points below a threshold y-value) where the monotonicity constraint is relaxed. Apply strict no-undercut rule from the foot zone upward.

## Sources

### Primary (HIGH confidence)
- [Paper.js Path API](https://paperjs.typogram.co/paths/path) -- verified: constructors, segments, divideAt, splitAt, hitTest
- [Paper.js PathItem API](https://paperjs.typogram.co/paths/pathitem) -- verified: getIntersections, getCrossings, boolean operations
- [Paper.js Tool API](https://paperjs.typogram.co/user-interaction-and-events/tool) -- verified: onMouseDown/Drag/Up, minDistance, activate()
- [Paper.js Segment docs](http://paperjs.org/reference/segment/) -- verified: handleIn/handleOut are relative to anchor point
- [Paper.js BezierTool example](https://github.com/paperjs/paper.js/blob/master/examples/Tools/BezierTool.html) -- verified: interactive bezier creation pattern
- [Paper.js on cdnjs](https://cdnjs.com/libraries/paper.js/) -- verified: 0.12.18, paper-core.min.js 204KB
- [Paper.js package.json](https://cdn.jsdelivr.net/npm/paper@0.12.18/package.json) -- verified: no ESM "module" field
- [Paper.js issue #921](https://github.com/paperjs/paper.js/issues/921) -- verified: view.autoUpdate, requestUpdate()
- [Paper.js issue #675](https://github.com/paperjs/paper.js/issues/675) -- verified: view.update(true) for force redraw

### Secondary (MEDIUM confidence)
- [Paper.js performance issue #693](https://github.com/paperjs/paper.js/issues/693) -- ~100 elements threshold before lag
- [Paper.js self-intersection community discussion](https://groups.google.com/g/paperjs/c/KzYRnzRVHNs) -- curve-pair workaround
- [bezier-js library](https://pomax.github.io/bezierjs/) -- self-intersection detection as fallback
- [Undercut detection literature](https://www.researchgate.net/publication/223816338) -- mould undercut = non-monotonic profile in withdrawal direction

### Tertiary (LOW confidence)
- Exact behavior of `getIntersections()` when testing cloned curve segments -- needs implementation validation
- Performance of handle layer with ~100 items during continuous drag -- needs empirical testing
- Precise undercut relaxation rules for pottery foot zones -- needs domain expert input

## Metadata

**Confidence breakdown:**
- Standard stack (Paper.js 0.12.18 via CDN): HIGH -- version, CDN URLs, API all verified
- Architecture patterns: HIGH -- Paper.js setup, hit testing, tool events all verified from official sources
- Coordinate mapping: HIGH -- standard y-flip transform, handle relative/absolute conversion verified
- Constraint enforcement: MEDIUM -- undercut monotonicity concept is sound, self-intersection workaround is community-sourced
- Undo/redo: HIGH -- state-snapshot pattern is well-established for small data models
- Pitfalls: HIGH -- all verified from official docs or confirmed GitHub issues
- Performance: MEDIUM -- based on issue reports, not empirical testing

**Research date:** 2026-02-10
**Valid until:** 2026-03-12 (30 days -- Paper.js is stable/mature, unlikely to change)
