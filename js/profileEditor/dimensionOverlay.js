/**
 * dimensionOverlay.js -- Measurement dimension lines and input for the profile editor.
 *
 * This module provides:
 *   1. getDimensions() -- pure function that calculates key dimensions from profile points
 *   2. renderDimensions() -- draws dimension lines with labels on the overlay layer
 *   3. applyDimensionInput() -- scales profile points to match a target dimension value
 *
 * DIMENSION LINES:
 * ----------------
 * The overlay shows four key pottery measurements as architectural-style dimension lines:
 *   - Height: vertical line on the right side (total pot height)
 *   - Rim diameter: horizontal line at the top (2x rim radius)
 *   - Belly diameter: horizontal at the widest point (only if > rim + 2mm)
 *   - Foot diameter: horizontal at the bottom (2x foot radius)
 *
 * These use dashed lines with mm labels -- the standard visual convention for
 * engineering drawings. All drawing happens in a named group within the overlay
 * layer so that constraint violation markers are not affected.
 *
 * DIMENSION INPUT:
 * ----------------
 * applyDimensionInput() takes the current points, a dimension name, and a new
 * target value. It scales all coordinates proportionally to achieve the target.
 * This lets users type exact mm values instead of dragging points.
 */

// ============================================================
// Constants
// ============================================================

const COLOR_DIM_LINE = '#8a8580';
const COLOR_DIM_LABEL = '#5a5550';
const DIM_LINE_DASH = [4, 3];
const DIM_OFFSET_PX = 30;  // Offset from profile for dimension lines (pixels)
const DIM_FONT_SIZE = 11;

// ============================================================
// Pure calculations
// ============================================================

/**
 * Calculate key dimensions from profile points.
 *
 * All values are in mm. Diameters are 2x the profile radius (since the
 * profile is a half cross-section around the revolution axis).
 *
 * @param {Array<ProfilePoint>} profilePoints - Profile points from foot to rim.
 * @returns {{ height: number, rimDiameter: number, maxDiameter: number, footDiameter: number }}
 */
export function getDimensions(profilePoints) {
  if (!profilePoints || profilePoints.length < 2) {
    return { height: 0, rimDiameter: 0, maxDiameter: 0, footDiameter: 0 };
  }

  let minY = Infinity;
  let maxY = -Infinity;
  let maxX = -Infinity;

  for (const pt of profilePoints) {
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
  }

  // Foot is the first point (bottom of profile)
  const footX = profilePoints[0].x;

  // Rim is the last point (top of profile)
  const rimX = profilePoints[profilePoints.length - 1].x;

  const height = round1(maxY - minY);
  const rimDiameter = round1(rimX * 2);
  const maxDiameter = round1(maxX * 2);
  const footDiameter = round1(footX * 2);

  return { height, rimDiameter, maxDiameter, footDiameter };
}

// ============================================================
// Dimension overlay rendering
// ============================================================

/**
 * Render dimension lines and labels on the overlay layer.
 *
 * Uses a named group 'dimensions' so that constraint violation markers
 * (which also live on the overlay layer) are not affected.
 *
 * @param {Array<ProfilePoint>} profilePoints - Current profile points.
 * @param {paper.Layer} overlayLayer - The overlay layer to draw on.
 * @param {{ toCanvas: function, scale: number, offsetX: number, offsetY: number }} transform - Coordinate transform.
 */
export function renderDimensions(profilePoints, overlayLayer, transform) {
  if (!overlayLayer) return;

  // Remove existing dimension group (if any) without affecting other items
  const existing = overlayLayer.children['dimensions'];
  if (existing) existing.remove();

  if (!profilePoints || profilePoints.length < 2) return;

  overlayLayer.activate();
  const group = new paper.Group();
  group.name = 'dimensions';
  overlayLayer.addChild(group);

  const dims = getDimensions(profilePoints);
  const { scale, offsetX, offsetY } = transform;

  // Gather key canvas positions
  const footPt = profilePoints[0];
  const rimPt = profilePoints[profilePoints.length - 1];

  // Find widest point
  let widestPt = profilePoints[0];
  for (const pt of profilePoints) {
    if (pt.x > widestPt.x) widestPt = pt;
  }

  const footCanvas = transform.toCanvas(footPt.x, footPt.y);
  const rimCanvas = transform.toCanvas(rimPt.x, rimPt.y);
  const widestCanvas = transform.toCanvas(widestPt.x, widestPt.y);
  const axisCanvas = transform.toCanvas(0, 0);

  // --- Height dimension (vertical line on the right) ---
  const heightX = Math.max(
    rimCanvas.x,
    widestCanvas.x,
    footCanvas.x
  ) + DIM_OFFSET_PX;

  drawDimensionLine(
    group,
    new paper.Point(heightX, rimCanvas.y),
    new paper.Point(heightX, footCanvas.y),
    `${dims.height} mm`,
    'vertical'
  );

  // --- Rim diameter (horizontal at top) ---
  const rimY = rimCanvas.y - DIM_OFFSET_PX * 0.7;
  drawDimensionLine(
    group,
    new paper.Point(offsetX, rimY),
    new paper.Point(rimCanvas.x, rimY),
    `${dims.rimDiameter} mm`,
    'horizontal'
  );

  // --- Belly diameter (horizontal at widest, only if different from rim by >2mm) ---
  if (Math.abs(dims.maxDiameter - dims.rimDiameter) > 2) {
    const bellyY = widestCanvas.y;
    const bellyRight = widestCanvas.x + DIM_OFFSET_PX * 1.5;
    drawDimensionLine(
      group,
      new paper.Point(offsetX, bellyY),
      new paper.Point(widestCanvas.x, bellyY),
      `${dims.maxDiameter} mm`,
      'horizontal',
      bellyRight
    );
  }

  // --- Foot diameter (horizontal at bottom) ---
  const footY = footCanvas.y + DIM_OFFSET_PX * 0.7;
  drawDimensionLine(
    group,
    new paper.Point(offsetX, footY),
    new paper.Point(footCanvas.x, footY),
    `${dims.footDiameter} mm`,
    'horizontal'
  );
}

/**
 * Draw a single dimension line with end ticks and a centered label.
 *
 * @param {paper.Group} group - Parent group for dimension items.
 * @param {paper.Point} from - Start point of the dimension line.
 * @param {paper.Point} to - End point of the dimension line.
 * @param {string} label - Text label (e.g. "85 mm").
 * @param {'horizontal'|'vertical'} orientation - Line orientation.
 * @param {number} [labelOffset] - Optional x or y offset for label placement.
 */
function drawDimensionLine(group, from, to, label, orientation, labelOffset) {
  // Main dashed line
  const line = new paper.Path.Line({
    from,
    to,
    strokeColor: COLOR_DIM_LINE,
    strokeWidth: 0.8,
    dashArray: DIM_LINE_DASH,
  });
  group.addChild(line);

  // End ticks (small perpendicular lines at each endpoint)
  const tickSize = 4;
  if (orientation === 'vertical') {
    group.addChild(createTick(from, tickSize, 'horizontal'));
    group.addChild(createTick(to, tickSize, 'horizontal'));
  } else {
    group.addChild(createTick(from, tickSize, 'vertical'));
    group.addChild(createTick(to, tickSize, 'vertical'));
  }

  // Label
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;

  let labelPoint;
  if (orientation === 'vertical') {
    labelPoint = new paper.Point(from.x + 6, midY + 3);
  } else {
    const lx = labelOffset != null ? labelOffset : midX;
    labelPoint = new paper.Point(lx, from.y - 4);
  }

  const text = new paper.PointText({
    point: labelPoint,
    content: label,
    fontSize: DIM_FONT_SIZE,
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    fillColor: COLOR_DIM_LABEL,
    fontWeight: '500',
  });
  group.addChild(text);
}

/**
 * Create a small tick mark (perpendicular line) at a point.
 *
 * @param {paper.Point} center - Center of the tick.
 * @param {number} size - Half-length of the tick in pixels.
 * @param {'horizontal'|'vertical'} direction - Direction of the tick line.
 * @returns {paper.Path.Line}
 */
function createTick(center, size, direction) {
  let from, to;
  if (direction === 'horizontal') {
    from = new paper.Point(center.x - size, center.y);
    to = new paper.Point(center.x + size, center.y);
  } else {
    from = new paper.Point(center.x, center.y - size);
    to = new paper.Point(center.x, center.y + size);
  }

  return new paper.Path.Line({
    from,
    to,
    strokeColor: COLOR_DIM_LINE,
    strokeWidth: 0.8,
  });
}

// ============================================================
// Dimension input application
// ============================================================

/**
 * Apply a dimension input by scaling the profile proportionally.
 *
 * Returns a NEW array of profile points (no mutation). Scales either
 * all X coordinates (for diameter changes) or all Y coordinates (for
 * height changes) by the ratio newValue / currentValue.
 *
 * @param {Array<ProfilePoint>} profilePoints - Current profile points.
 * @param {'height'|'rimDiameter'} dimension - Which dimension to change.
 * @param {number} newValue - Target value in mm.
 * @returns {Array<ProfilePoint>} New profile points with the dimension applied.
 */
export function applyDimensionInput(profilePoints, dimension, newValue) {
  if (!profilePoints || profilePoints.length < 2 || !newValue || newValue <= 0) {
    return profilePoints;
  }

  const dims = getDimensions(profilePoints);

  if (dimension === 'height') {
    const currentHeight = dims.height;
    if (currentHeight <= 0) return profilePoints;
    const ratio = newValue / currentHeight;

    return profilePoints.map(pt => {
      const scaled = { ...pt, y: round2(pt.y * ratio) };
      if (pt.cp1) scaled.cp1 = { x: pt.cp1.x, y: round2(pt.cp1.y * ratio) };
      if (pt.cp2) scaled.cp2 = { x: pt.cp2.x, y: round2(pt.cp2.y * ratio) };
      return scaled;
    });
  }

  if (dimension === 'rimDiameter') {
    const currentRimDiam = dims.rimDiameter;
    if (currentRimDiam <= 0) return profilePoints;
    const ratio = newValue / currentRimDiam;

    return profilePoints.map(pt => {
      const scaled = { ...pt, x: round2(pt.x * ratio) };
      if (pt.cp1) scaled.cp1 = { x: round2(pt.cp1.x * ratio), y: pt.cp1.y };
      if (pt.cp2) scaled.cp2 = { x: round2(pt.cp2.x * ratio), y: pt.cp2.y };
      return scaled;
    });
  }

  // Unknown dimension -- return unchanged
  return profilePoints;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Round to 1 decimal place (for display values).
 * @param {number} n
 * @returns {number}
 */
function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Round to 2 decimal places (for coordinate values).
 * @param {number} n
 * @returns {number}
 */
function round2(n) {
  return Math.round(n * 100) / 100;
}
