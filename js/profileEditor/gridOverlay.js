/**
 * gridOverlay.js -- Adaptive grid rendering and snap-to-grid for the profile editor.
 *
 * This module replaces the basic grid drawing in profileEditor.js with a
 * scale-aware grid that adapts its spacing based on the current transform
 * scale, and provides snap-to-grid functionality for interactive editing.
 *
 * GRID SPACING:
 * -------------
 * The grid spacing adapts to the current scale (pixels per mm) to keep
 * the grid visually comfortable regardless of zoom level:
 *   scale < 2  -> 10mm spacing
 *   scale < 5  -> 5mm spacing
 *   scale < 15 -> 2mm spacing
 *   else       -> 1mm spacing
 *
 * Major gridlines are drawn every 10mm regardless of minor spacing.
 *
 * COLORS:
 * -------
 *   Minor grid:  #e8e5e0 (warm light gray)
 *   Major grid:  #d5d0ca (warm medium gray, every 10mm)
 *   Axis:        #c2956b (terra cotta, revolution axis at x=0)
 */

// ============================================================
// Constants
// ============================================================

const COLOR_GRID = '#e8e5e0';
const COLOR_MAJOR = '#d5d0ca';
const COLOR_AXIS = '#c2956b';

// ============================================================
// Grid rendering
// ============================================================

/**
 * Render an adaptive grid on the grid layer.
 *
 * Clears the layer and draws vertical + horizontal grid lines with
 * spacing based on the current scale. The revolution axis (x = 0)
 * is drawn as a thick terra cotta line with an "axis" label.
 *
 * @param {paper.Layer} gridLayer - The grid layer to draw on.
 * @param {{ scale: number, offsetX: number, offsetY: number }} transform - Coordinate transform.
 * @param {number} canvasWidth - Current canvas width in pixels.
 * @param {number} canvasHeight - Current canvas height in pixels.
 */
export function renderGrid(gridLayer, transform, canvasWidth, canvasHeight) {
  gridLayer.activate();
  gridLayer.removeChildren();

  const { scale, offsetX, offsetY } = transform;

  // Determine grid spacing based on scale
  const spacing = getGridSpacing(scale);

  // Visible range in mm (with margin beyond canvas edges)
  const maxXmm = Math.ceil((canvasWidth - offsetX) / scale / spacing) * spacing + spacing;
  const maxYmm = Math.ceil(offsetY / scale / spacing) * spacing + spacing;

  // --- Vertical grid lines ---
  for (let mm = 0; mm <= maxXmm; mm += spacing) {
    const x = offsetX + mm * scale;
    if (x > canvasWidth) break;

    const isMajor = (mm % 10 === 0);
    new paper.Path.Line({
      from: new paper.Point(x, 0),
      to: new paper.Point(x, canvasHeight),
      strokeColor: isMajor ? COLOR_MAJOR : COLOR_GRID,
      strokeWidth: isMajor ? 0.8 : 0.4,
      parent: gridLayer,
    });
  }

  // --- Horizontal grid lines ---
  for (let mm = 0; mm <= maxYmm; mm += spacing) {
    const y = offsetY - mm * scale;
    if (y < 0) break;

    const isMajor = (mm % 10 === 0);
    new paper.Path.Line({
      from: new paper.Point(0, y),
      to: new paper.Point(canvasWidth, y),
      strokeColor: isMajor ? COLOR_MAJOR : COLOR_GRID,
      strokeWidth: isMajor ? 0.8 : 0.4,
      parent: gridLayer,
    });
  }

  // --- Revolution axis (x = 0) ---
  new paper.Path.Line({
    from: new paper.Point(offsetX, 0),
    to: new paper.Point(offsetX, canvasHeight),
    strokeColor: COLOR_AXIS,
    strokeWidth: 2,
    parent: gridLayer,
  });

  // Axis label
  new paper.PointText({
    point: new paper.Point(offsetX + 4, 14),
    content: 'axis',
    fontSize: 10,
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    fillColor: COLOR_AXIS,
    parent: gridLayer,
  });
}

/**
 * Determine grid spacing in mm based on current scale.
 *
 * @param {number} scale - Pixels per mm.
 * @returns {number} Grid spacing in mm.
 */
function getGridSpacing(scale) {
  if (scale < 2) return 10;
  if (scale < 5) return 5;
  if (scale < 15) return 2;
  return 1;
}

// ============================================================
// Snap-to-grid
// ============================================================

/**
 * Snap a single value to the nearest grid point.
 *
 * @param {number} value - Value in mm.
 * @param {number} gridSpacing - Grid spacing in mm.
 * @returns {number} Snapped value.
 */
export function snapToGrid(value, gridSpacing) {
  return Math.round(value / gridSpacing) * gridSpacing;
}

/**
 * Snap a profile point (and its control points) to the nearest grid points.
 *
 * Returns a new point object (no mutation). If snapEnabled is false,
 * returns a shallow copy unchanged.
 *
 * @param {Object} profilePoint - A profile point { x, y, type, cp1?, cp2? }.
 * @param {number} gridSpacing - Grid spacing in mm.
 * @param {boolean} snapEnabled - Whether snapping is active.
 * @returns {Object} New profile point with snapped coordinates.
 */
export function snapProfilePoint(profilePoint, gridSpacing, snapEnabled) {
  if (!snapEnabled) {
    return { ...profilePoint };
  }

  const snapped = {
    ...profilePoint,
    x: Math.max(0, snapToGrid(profilePoint.x, gridSpacing)),
    y: Math.max(0, snapToGrid(profilePoint.y, gridSpacing)),
  };

  if (profilePoint.cp1) {
    snapped.cp1 = {
      x: snapToGrid(profilePoint.cp1.x, gridSpacing),
      y: snapToGrid(profilePoint.cp1.y, gridSpacing),
    };
  }

  if (profilePoint.cp2) {
    snapped.cp2 = {
      x: snapToGrid(profilePoint.cp2.x, gridSpacing),
      y: snapToGrid(profilePoint.cp2.y, gridSpacing),
    };
  }

  return snapped;
}
