/**
 * pathRenderer.js -- Renders profile data as Paper.js paths and handle overlays.
 *
 * This module is the bridge between the profile data model (profileData.js)
 * and the Paper.js visual representation. It handles:
 *
 *   1. Converting profile points to Paper.js Segments (with handle mapping)
 *   2. Drawing the main profile path as a bezier curve
 *   3. Drawing anchor points and control handle decorations
 *   4. Syncing Paper.js path state back to the profile data model
 *
 * CRITICAL: HANDLE MAPPING
 * ========================
 *
 * Profile data model (profileData.js):
 *   A bezier segment from point[i] to point[i+1] has:
 *     point[i+1].cp1 = first control point (near point[i], the START of the curve)
 *     point[i+1].cp2 = second control point (near point[i+1], the END of the curve)
 *
 * Paper.js segments:
 *   segment[i].handleOut = outgoing control handle (relative to segment[i].point)
 *   segment[i+1].handleIn = incoming control handle (relative to segment[i+1].point)
 *
 * Mapping (profile -> Paper.js):
 *   If point[i+1].type === 'bezier':
 *     segment[i].handleOut = toCanvas(cp1) - toCanvas(point[i])   (RELATIVE offset)
 *     segment[i+1].handleIn = toCanvas(cp2) - toCanvas(point[i+1]) (RELATIVE offset)
 *
 * Mapping (Paper.js -> profile):
 *   If segment has non-zero handleIn OR previous segment has non-zero handleOut:
 *     type = 'bezier'
 *     cp1 = toProfile(prev.point + prev.handleOut)   (absolute in mm)
 *     cp2 = toProfile(this.point + this.handleIn)     (absolute in mm)
 *
 * Handle coordinates in Paper.js are ALWAYS relative to their segment point.
 * Profile control points are ALWAYS absolute positions in mm.
 */

// ============================================================
// Constants
// ============================================================

/** Radius of anchor point circles in canvas pixels. */
const ANCHOR_RADIUS = 5;

/** Radius of control handle tip circles in canvas pixels. */
const HANDLE_RADIUS = 3.5;

/** Colors */
const COLOR_PATH = '#2d2d2d';
const COLOR_ANCHOR = '#2d2d2d';
const COLOR_HANDLE_TIP = '#c2956b';  // terra cotta
const COLOR_HANDLE_LINE = '#999999';
const COLOR_ANCHOR_SELECTED = '#c2956b';

// ============================================================
// Profile -> Paper.js rendering
// ============================================================

/**
 * Render profile data as a Paper.js path on the given layer.
 *
 * Converts each profile point to a Paper.js Segment with properly mapped
 * bezier handles. Clears the layer before drawing.
 *
 * @param {Array<ProfilePoint>} profilePoints - Profile points from foot to rim.
 * @param {{ toCanvas: function }} transform - Coordinate transform (canvasSetup.js).
 * @param {paper.Layer} profileLayer - The Paper.js layer to draw on.
 * @returns {paper.Path} The created path (also added to the layer).
 */
export function renderProfile(profilePoints, transform, profileLayer) {
  profileLayer.activate();
  profileLayer.removeChildren();

  const segments = buildSegments(profilePoints, transform);

  const path = new paper.Path({
    segments,
    strokeColor: COLOR_PATH,
    strokeWidth: 2.5,
    strokeCap: 'round',
    strokeJoin: 'round',
    fillColor: null,
    selected: false,
  });

  return path;
}

/**
 * Build Paper.js Segment array from profile points with handle mapping.
 *
 * This is the critical function that maps between the two coordinate systems
 * and handle representations. See module header for mapping details.
 *
 * @param {Array<ProfilePoint>} profilePoints - Profile points from foot to rim.
 * @param {{ toCanvas: function }} transform - Coordinate transform.
 * @returns {Array<paper.Segment>} Segments ready for Paper.js Path constructor.
 */
function buildSegments(profilePoints, transform) {
  const segments = [];

  for (let i = 0; i < profilePoints.length; i++) {
    const pt = profilePoints[i];
    const anchorCanvas = transform.toCanvas(pt.x, pt.y);

    // handleIn: incoming handle for THIS segment
    // Set if THIS point is a bezier (has cp2 = control point near this anchor)
    let handleIn = null;
    if (pt.type === 'bezier' && pt.cp2) {
      const cp2Canvas = transform.toCanvas(pt.cp2.x, pt.cp2.y);
      handleIn = cp2Canvas.subtract(anchorCanvas); // RELATIVE to anchor
    }

    // handleOut: outgoing handle for THIS segment
    // Set if the NEXT point is a bezier (has cp1 = control point near this anchor)
    let handleOut = null;
    const nextPt = profilePoints[i + 1];
    if (nextPt && nextPt.type === 'bezier' && nextPt.cp1) {
      const cp1Canvas = transform.toCanvas(nextPt.cp1.x, nextPt.cp1.y);
      handleOut = cp1Canvas.subtract(anchorCanvas); // RELATIVE to anchor
    }

    segments.push(new paper.Segment(
      anchorCanvas,
      handleIn,   // null for line segments (Paper.js treats null as zero-length)
      handleOut
    ));
  }

  return segments;
}

/**
 * Render anchor points and control handles as visual decorations.
 *
 * Draws:
 *   - Filled circles at each anchor point (dark, larger)
 *   - Filled circles at each control handle tip (terra cotta, smaller)
 *   - Thin lines from anchor to handle tip
 *
 * These are separate from the path itself -- they're interactive hit targets
 * for the edit tool. Clears the handle layer before drawing.
 *
 * @param {paper.Path} path - The profile path with segments.
 * @param {paper.Layer} handleLayer - The Paper.js layer for handle decorations.
 * @param {number} [selectedIndex=-1] - Index of selected segment (highlight differently).
 */
export function renderHandles(path, handleLayer, selectedIndex = -1) {
  handleLayer.activate();
  handleLayer.removeChildren();

  if (!path || !path.segments) return;

  for (let i = 0; i < path.segments.length; i++) {
    const seg = path.segments[i];
    const anchor = seg.point;
    const isSelected = (i === selectedIndex);

    // Draw handleIn line + tip (if non-zero)
    if (seg.handleIn && seg.handleIn.length > 0.5) {
      const tipPoint = anchor.add(seg.handleIn);
      drawHandleLine(anchor, tipPoint, handleLayer);
      drawHandleTip(tipPoint, handleLayer);
    }

    // Draw handleOut line + tip (if non-zero)
    if (seg.handleOut && seg.handleOut.length > 0.5) {
      const tipPoint = anchor.add(seg.handleOut);
      drawHandleLine(anchor, tipPoint, handleLayer);
      drawHandleTip(tipPoint, handleLayer);
    }

    // Draw anchor point (on top of handle lines)
    drawAnchorPoint(anchor, handleLayer, isSelected);
  }
}

/**
 * Draw a filled circle for an anchor point.
 *
 * @param {paper.Point} point - Center of the anchor.
 * @param {paper.Layer} layer - Layer to draw on.
 * @param {boolean} selected - Whether this anchor is selected.
 */
function drawAnchorPoint(point, layer, selected) {
  new paper.Path.Circle({
    center: point,
    radius: ANCHOR_RADIUS,
    fillColor: selected ? COLOR_ANCHOR_SELECTED : COLOR_ANCHOR,
    strokeColor: selected ? COLOR_ANCHOR : null,
    strokeWidth: selected ? 1.5 : 0,
    parent: layer,
    data: { type: 'anchor' },
  });
}

/**
 * Draw a filled circle for a control handle tip.
 *
 * @param {paper.Point} point - Center of the handle tip.
 * @param {paper.Layer} layer - Layer to draw on.
 */
function drawHandleTip(point, layer) {
  new paper.Path.Circle({
    center: point,
    radius: HANDLE_RADIUS,
    fillColor: COLOR_HANDLE_TIP,
    parent: layer,
    data: { type: 'handle-tip' },
  });
}

/**
 * Draw a thin line from anchor to control handle tip.
 *
 * @param {paper.Point} from - Anchor point.
 * @param {paper.Point} to - Handle tip point.
 * @param {paper.Layer} layer - Layer to draw on.
 */
function drawHandleLine(from, to, layer) {
  new paper.Path.Line({
    from,
    to,
    strokeColor: COLOR_HANDLE_LINE,
    strokeWidth: 1,
    parent: layer,
    data: { type: 'handle-line' },
  });
}

// ============================================================
// Paper.js -> Profile data syncing
// ============================================================

/**
 * Read the current Paper.js path state and convert back to profile data format.
 *
 * This is the inverse of renderProfile(). It reads segment positions and
 * handles from the Paper.js path and produces an array of profile points
 * compatible with profileData.js.
 *
 * Used after interactive editing (drag, insert, delete) to update the
 * data model and trigger 3D preview regeneration.
 *
 * @param {paper.Path} path - The Paper.js path to read from.
 * @param {{ toProfile: function }} transform - Coordinate transform (canvasSetup.js).
 * @returns {Array<ProfilePoint>} Profile points ready for createProfile().
 */
export function syncPathToProfile(path, transform) {
  const points = [];

  for (let i = 0; i < path.segments.length; i++) {
    const seg = path.segments[i];
    const prevSeg = i > 0 ? path.segments[i - 1] : null;

    const anchor = transform.toProfile(seg.point);

    // Determine if this segment is a bezier:
    // It's bezier if this segment has a non-zero handleIn
    // OR the previous segment has a non-zero handleOut
    // (either handle implies a curve between prev and this)
    const hasHandleIn = seg.handleIn && seg.handleIn.length > 0.5;
    const prevHasHandleOut = prevSeg && prevSeg.handleOut && prevSeg.handleOut.length > 0.5;
    const isBezier = hasHandleIn || prevHasHandleOut;

    if (i === 0 || !isBezier) {
      // First point is always 'line' type (no segment before it)
      // Non-bezier segments are 'line'
      points.push({
        x: Math.max(0, anchor.x),  // Clamp radius to >= 0
        y: Math.max(0, anchor.y),  // Clamp height to >= 0
        type: 'line',
      });
    } else {
      // Bezier segment: extract control points as absolute positions in mm
      // cp1 = absolute position of prev segment's handleOut tip
      // cp2 = absolute position of this segment's handleIn tip
      const cp1Abs = prevSeg
        ? transform.toProfile(prevSeg.point.add(prevSeg.handleOut || new paper.Point(0, 0)))
        : anchor;
      const cp2Abs = transform.toProfile(seg.point.add(seg.handleIn || new paper.Point(0, 0)));

      points.push({
        x: Math.max(0, anchor.x),
        y: Math.max(0, anchor.y),
        type: 'bezier',
        cp1: { x: cp1Abs.x, y: cp1Abs.y },
        cp2: { x: cp2Abs.x, y: cp2Abs.y },
      });
    }
  }

  return points;
}
