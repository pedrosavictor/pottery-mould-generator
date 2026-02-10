/**
 * canvasSetup.js -- Paper.js canvas initialization and coordinate transforms.
 *
 * This module sets up the Paper.js canvas with layers for the profile editor
 * and provides coordinate transforms between profile space (mm) and canvas
 * pixels.
 *
 * COORDINATE SYSTEMS:
 * -------------------
 * Profile space:
 *   x = distance from revolution axis (radius) in mm, always >= 0
 *   y = height from bottom of pot in mm, always >= 0
 *   Origin at bottom-left of profile (axis, foot).
 *
 * Canvas space (Paper.js):
 *   x = pixels from left edge
 *   y = pixels from top edge (Y increases downward!)
 *   Origin at top-left corner.
 *
 * The transform flips Y and scales/offsets to center the profile in the canvas
 * with comfortable margins.
 *
 * LAYERS:
 * -------
 * 0: grid     -- mm grid lines and axis reference
 * 1: profile  -- the main bezier path (the pot shape)
 * 2: handles  -- anchor points, control handles, connecting lines
 * 3: overlay  -- temporary feedback (hover highlights, selection rect)
 */

/**
 * Initialize Paper.js on the given canvas element.
 *
 * Creates the paper project, sets up 4 named layers, and returns references
 * to the project, view, and layers for use by other editor modules.
 *
 * @param {string} canvasId - The DOM id of the <canvas> element.
 * @returns {{ project: paper.Project, view: paper.View, layers: { grid: paper.Layer, profile: paper.Layer, handles: paper.Layer, overlay: paper.Layer } }}
 */
export function initCanvas(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) {
    throw new Error(`Canvas element #${canvasId} not found`);
  }

  // Initialize Paper.js on this canvas.
  // paper.setup() creates a Project and View bound to this canvas.
  paper.setup(canvas);

  // Paper.js creates one default layer (index 0). We rename it and create 3 more.
  // Layer order matters: higher index = drawn on top.
  const gridLayer = paper.project.activeLayer;
  gridLayer.name = 'grid';

  const profileLayer = new paper.Layer();
  profileLayer.name = 'profile';

  const handleLayer = new paper.Layer();
  handleLayer.name = 'handles';

  const overlayLayer = new paper.Layer();
  overlayLayer.name = 'overlay';

  // Activate the profile layer as the default drawing target.
  profileLayer.activate();

  const layers = {
    grid: gridLayer,
    profile: profileLayer,
    handles: handleLayer,
    overlay: overlayLayer,
  };

  return {
    project: paper.project,
    view: paper.view,
    layers,
  };
}

/**
 * Create a coordinate transform between profile space (mm) and canvas pixels.
 *
 * The transform places the profile origin (0, 0) at the bottom-left of the
 * drawing area, with Y going up (opposite to canvas Y direction). Scale is
 * chosen to fit the expected maximum dimensions with comfortable margins.
 *
 * @param {number} canvasWidth  - Current canvas width in pixels.
 * @param {number} canvasHeight - Current canvas height in pixels.
 * @param {Object} [options]
 * @param {number} [options.maxRadiusMm=60] - Maximum expected radius in mm.
 * @param {number} [options.maxHeightMm=120] - Maximum expected height in mm.
 * @returns {{ scale: number, offsetX: number, offsetY: number, toCanvas: function, toProfile: function }}
 */
export function createTransform(canvasWidth, canvasHeight, options = {}) {
  const maxRadiusMm = options.maxRadiusMm || 60;
  const maxHeightMm = options.maxHeightMm || 120;

  // Scale to fit with margins:
  //   - Horizontal: use 70% of canvas width for the profile radius
  //   - Vertical: use 80% of canvas height for the profile height
  // Take the minimum to ensure both dimensions fit.
  const scale = Math.min(
    (canvasWidth * 0.7) / maxRadiusMm,
    (canvasHeight * 0.8) / maxHeightMm
  );

  // Offset positions the origin (0mm, 0mm) at bottom-left of drawing area.
  // offsetX: 15% from left edge (leaves room for axis labels)
  // offsetY: 90% from top edge (profile grows upward from here)
  const offsetX = canvasWidth * 0.15;
  const offsetY = canvasHeight * 0.9;

  /**
   * Convert a profile coordinate (mm) to a canvas point (pixels).
   * Y is FLIPPED: profile Y increases upward, canvas Y increases downward.
   *
   * @param {number} profileX - X in mm (radius from axis).
   * @param {number} profileY - Y in mm (height from bottom).
   * @returns {paper.Point} Canvas point in pixels.
   */
  function toCanvas(profileX, profileY) {
    return new paper.Point(
      offsetX + profileX * scale,
      offsetY - profileY * scale  // Y-FLIP: profile up = canvas down
    );
  }

  /**
   * Convert a canvas point (pixels) back to profile coordinates (mm).
   * Rounds to 2 decimal places for clean profile data.
   *
   * @param {paper.Point} canvasPoint - Point in canvas pixel coordinates.
   * @returns {{ x: number, y: number }} Profile coordinates in mm.
   */
  function toProfile(canvasPoint) {
    return {
      x: round2((canvasPoint.x - offsetX) / scale),
      y: round2((offsetY - canvasPoint.y) / scale),  // Y-FLIP inverse
    };
  }

  return { scale, offsetX, offsetY, toCanvas, toProfile };
}

/**
 * Round a number to 2 decimal places.
 * Used for profile coordinates to avoid floating-point noise.
 *
 * @param {number} n
 * @returns {number}
 */
function round2(n) {
  return Math.round(n * 100) / 100;
}
