/**
 * constraints.js -- Constraint enforcement and validation for the profile editor.
 *
 * This module provides two categories of constraint logic:
 *
 * 1. ENFORCEMENT (during drag):
 *    enforceAxisBound() -- called every mouse drag to clamp points/handles
 *    so they never cross the revolution axis (x < 0 in profile space).
 *
 * 2. VALIDATION (after drag / on change):
 *    validateConstraints() -- analyzes the full path for violations:
 *      - axisCrossing: any geometry crossing x = 0
 *      - undercut: radius decreasing above the foot zone (unmoldable)
 *      - selfIntersection: path crossing itself
 *
 * 3. VISUALIZATION:
 *    renderViolations() -- draws visual feedback on the overlay layer
 *    clearViolations() -- removes all violation visuals
 *
 * WHY THESE CONSTRAINTS:
 * ----------------------
 * The profile is revolved around the Y axis (x = 0) to create a solid of
 * revolution. If any geometry crosses x = 0, the solid self-intersects.
 * If the radius decreases going upward (above the foot), the mould cannot
 * be pulled off the pot (undercut). Self-intersections create invalid solids.
 */

// ============================================================
// Constants
// ============================================================

/** Colors for violation rendering */
const COLOR_VIOLATION = 'rgba(220, 53, 69, 0.6)';  // red, semi-transparent
const COLOR_VIOLATION_BAND = 'rgba(220, 53, 69, 0.12)';
const COLOR_VIOLATION_DOT = 'rgba(220, 53, 69, 0.9)';

/** Size of violation marker dots in pixels */
const VIOLATION_DOT_RADIUS = 5;

/** Width of the axis-crossing warning band in canvas pixels */
const AXIS_BAND_WIDTH = 8;

// ============================================================
// 1. Enforcement (during drag)
// ============================================================

/**
 * Enforce the axis boundary constraint on a segment during a drag operation.
 *
 * Clamps the segment point and its handle tips so that no part of the
 * controlled geometry crosses x = 0 in profile space.
 *
 * Called on every mouse drag event while moving an anchor or handle.
 *
 * @param {paper.Segment} segment - The segment being dragged.
 * @param {{ toProfile: function, toCanvas: function }} transform - Coordinate transform.
 * @returns {{ clamped: boolean }} Whether any clamping was applied.
 */
export function enforceAxisBound(segment, transform) {
  let clamped = false;

  // --- Clamp anchor point ---
  const profile = transform.toProfile(segment.point);
  if (profile.x < 0) {
    segment.point = transform.toCanvas(0, profile.y);
    clamped = true;
  }

  // --- Clamp handleIn tip ---
  if (segment.handleIn && segment.handleIn.length > 0.5) {
    const tipCanvas = segment.point.add(segment.handleIn);
    const tipProfile = transform.toProfile(tipCanvas);
    if (tipProfile.x < 0) {
      // Move handle tip to x = 0, keeping the same profile Y
      const clampedTipCanvas = transform.toCanvas(0, tipProfile.y);
      segment.handleIn = clampedTipCanvas.subtract(segment.point);
      clamped = true;
    }
  }

  // --- Clamp handleOut tip ---
  if (segment.handleOut && segment.handleOut.length > 0.5) {
    const tipCanvas = segment.point.add(segment.handleOut);
    const tipProfile = transform.toProfile(tipCanvas);
    if (tipProfile.x < 0) {
      const clampedTipCanvas = transform.toCanvas(0, tipProfile.y);
      segment.handleOut = clampedTipCanvas.subtract(segment.point);
      clamped = true;
    }
  }

  return { clamped };
}

// ============================================================
// 2. Validation (after drag / on change)
// ============================================================

/**
 * Validate the entire profile path against all constraints.
 *
 * Checks for:
 *   1. axisCrossing -- any segment point or curve bounding box crosses x = 0
 *   2. undercut -- radius decreasing as height increases (above foot zone)
 *   3. selfIntersection -- path crossing itself
 *
 * @param {paper.Path} path - The Paper.js profile path.
 * @param {{ toProfile: function, toCanvas: function, offsetX: number }} transform - Coordinate transform.
 * @param {Object} [options]
 * @param {number} [options.footZoneHeight=5] - Height in mm below which undercut checking is skipped.
 * @returns {{ valid: boolean, violations: Array<{ type: string, data: Object }> }}
 */
export function validateConstraints(path, transform, options = {}) {
  const footZoneHeight = options.footZoneHeight ?? 5;
  const violations = [];

  if (!path || !path.segments || path.segments.length < 2) {
    return { valid: true, violations };
  }

  // --- Check 1: Axis crossing ---
  checkAxisCrossing(path, transform, violations);

  // --- Check 2: Undercut ---
  checkUndercut(path, transform, footZoneHeight, violations);

  // --- Check 3: Self-intersection ---
  checkSelfIntersection(path, transform, violations);

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Check if any segment point or curve bounds crosses x = 0.
 *
 * @param {paper.Path} path
 * @param {{ toProfile: function, offsetX: number }} transform
 * @param {Array} violations - Violations array to append to.
 */
function checkAxisCrossing(path, transform, violations) {
  // Check segment anchor points
  for (let i = 0; i < path.segments.length; i++) {
    const profile = transform.toProfile(path.segments[i].point);
    if (profile.x < -0.1) { // Small tolerance for floating point
      violations.push({
        type: 'axisCrossing',
        data: {
          segmentIndex: i,
          profilePoint: profile,
          canvasPoint: path.segments[i].point.clone(),
        },
      });
    }
  }

  // Check curve bounding boxes (bezier curves can bulge past their endpoints)
  if (path.curves) {
    for (let i = 0; i < path.curves.length; i++) {
      const curve = path.curves[i];
      const bounds = curve.bounds;
      if (bounds) {
        // Convert left edge of bounding box to profile space
        const leftProfile = transform.toProfile(new paper.Point(bounds.left, bounds.center.y));
        if (leftProfile.x < -0.1) {
          // Only add if we haven't already flagged the endpoints
          const alreadyFlagged = violations.some(
            v => v.type === 'axisCrossing' && (v.data.segmentIndex === i || v.data.segmentIndex === i + 1)
          );
          if (!alreadyFlagged) {
            violations.push({
              type: 'axisCrossing',
              data: {
                curveIndex: i,
                canvasLeft: bounds.left,
                profileX: leftProfile.x,
              },
            });
          }
        }
      }
    }
  }
}

/**
 * Check for undercuts: radius decreasing as height increases, above the foot zone.
 *
 * An undercut means the mould cannot be removed from the pot without breaking it.
 * We sample each curve at 20 evenly-spaced points and check that the profile
 * x-coordinate (radius) is monotonically non-decreasing as y (height) increases.
 *
 * A tolerance of -0.5mm is applied to avoid false positives from floating point
 * or very slight concavities that are physically insignificant.
 *
 * @param {paper.Path} path
 * @param {{ toProfile: function }} transform
 * @param {number} footZoneHeight - Height in mm below which to skip checking.
 * @param {Array} violations - Violations array to append to.
 */
function checkUndercut(path, transform, footZoneHeight, violations) {
  if (!path.curves) return;

  const SAMPLES = 20;
  const TOLERANCE = -0.5; // mm -- allow tiny concavities

  for (let i = 0; i < path.curves.length; i++) {
    const curve = path.curves[i];
    let prevProfile = null;
    let undercutFound = false;
    let worstPoint = null;

    for (let t = 0; t <= SAMPLES; t++) {
      const time = t / SAMPLES;
      const canvasPoint = curve.getPointAtTime(time);
      const profile = transform.toProfile(canvasPoint);

      // Skip points in the foot zone
      if (profile.y < footZoneHeight) {
        prevProfile = profile;
        continue;
      }

      if (prevProfile && prevProfile.y < profile.y) {
        // Height increased -- check that radius didn't decrease
        const radiusDrop = profile.x - prevProfile.x;
        if (radiusDrop < TOLERANCE) {
          undercutFound = true;
          worstPoint = canvasPoint;
        }
      }

      prevProfile = profile;
    }

    if (undercutFound) {
      violations.push({
        type: 'undercut',
        data: {
          curveIndex: i,
          canvasPoint: worstPoint ? worstPoint.clone() : curve.getPointAtTime(0.5),
          startCanvas: curve.point1.clone(),
          endCanvas: curve.point2.clone(),
        },
      });
    }
  }
}

/**
 * Check for self-intersections in the path.
 *
 * Tests non-adjacent curve pairs (j >= i + 2) for intersections using
 * Paper.js curve.getIntersections(). Adjacent curves share an endpoint
 * and always "intersect" there, so they are skipped.
 *
 * @param {paper.Path} path
 * @param {{ toProfile: function }} transform
 * @param {Array} violations - Violations array to append to.
 */
function checkSelfIntersection(path, transform, violations) {
  if (!path.curves || path.curves.length < 3) return;

  for (let i = 0; i < path.curves.length; i++) {
    for (let j = i + 2; j < path.curves.length; j++) {
      const intersections = path.curves[i].getIntersections(path.curves[j]);
      if (intersections && intersections.length > 0) {
        for (const ix of intersections) {
          violations.push({
            type: 'selfIntersection',
            data: {
              canvasPoint: ix.point.clone(),
              profilePoint: transform.toProfile(ix.point),
              curveIndices: [i, j],
            },
          });
        }
      }
    }
  }
}

// ============================================================
// 3. Visualization
// ============================================================

/**
 * Remove all violation visuals from the overlay layer.
 *
 * @param {paper.Layer} overlayLayer - The overlay layer to clear.
 */
export function clearViolations(overlayLayer) {
  if (!overlayLayer) return;
  overlayLayer.removeChildren();
}

/**
 * Render violation markers on the overlay layer.
 *
 * Visual indicators:
 *   - axisCrossing: red semi-transparent vertical band at x = 0
 *   - undercut: red semi-transparent highlight on the offending curve section + warning dot
 *   - selfIntersection: red X markers at intersection points
 *
 * @param {Array<{ type: string, data: Object }>} violations - Violation objects from validateConstraints().
 * @param {paper.Layer} overlayLayer - The overlay layer to draw on.
 * @param {{ offsetX: number, offsetY: number, scale: number }} transform - Coordinate transform.
 */
export function renderViolations(violations, overlayLayer, transform) {
  if (!overlayLayer || !violations || violations.length === 0) return;

  overlayLayer.activate();

  // Track whether we already drew the axis band (only need one)
  let axisBandDrawn = false;

  for (const v of violations) {
    switch (v.type) {
      case 'axisCrossing':
        if (!axisBandDrawn) {
          renderAxisCrossingBand(overlayLayer, transform);
          axisBandDrawn = true;
        }
        break;

      case 'undercut':
        renderUndercutMarker(v.data, overlayLayer);
        break;

      case 'selfIntersection':
        renderSelfIntersectionMarker(v.data, overlayLayer);
        break;
    }
  }
}

/**
 * Draw a red semi-transparent vertical band at x = 0 (the revolution axis).
 * This visually warns the user that geometry has crossed the axis.
 *
 * @param {paper.Layer} layer
 * @param {{ offsetX: number, offsetY: number, scale: number }} transform
 */
function renderAxisCrossingBand(layer, transform) {
  const { offsetX, offsetY, scale } = transform;
  const bandHeight = 130 * scale + 20; // Match grid height + margin

  new paper.Path.Rectangle({
    point: new paper.Point(offsetX - AXIS_BAND_WIDTH, offsetY - bandHeight),
    size: new paper.Size(AXIS_BAND_WIDTH * 2, bandHeight + 10),
    fillColor: COLOR_VIOLATION_BAND,
    strokeColor: COLOR_VIOLATION,
    strokeWidth: 1,
    parent: layer,
    data: { type: 'violation-axis' },
  });
}

/**
 * Draw a warning indicator for an undercut violation.
 * Shows a red highlight line on the offending curve section and a warning dot.
 *
 * @param {{ curveIndex: number, canvasPoint: paper.Point, startCanvas: paper.Point, endCanvas: paper.Point }} data
 * @param {paper.Layer} layer
 */
function renderUndercutMarker(data, layer) {
  // Red line between curve endpoints to highlight the problematic region
  new paper.Path.Line({
    from: data.startCanvas,
    to: data.endCanvas,
    strokeColor: COLOR_VIOLATION,
    strokeWidth: 4,
    parent: layer,
    data: { type: 'violation-undercut' },
  });

  // Warning dot at the worst point
  new paper.Path.Circle({
    center: data.canvasPoint,
    radius: VIOLATION_DOT_RADIUS,
    fillColor: COLOR_VIOLATION_DOT,
    parent: layer,
    data: { type: 'violation-undercut-dot' },
  });
}

/**
 * Draw an X marker at a self-intersection point.
 *
 * @param {{ canvasPoint: paper.Point }} data
 * @param {paper.Layer} layer
 */
function renderSelfIntersectionMarker(data, layer) {
  const size = 7; // Half-size of the X in pixels
  const center = data.canvasPoint;

  // Draw X with two crossed lines
  new paper.Path.Line({
    from: new paper.Point(center.x - size, center.y - size),
    to: new paper.Point(center.x + size, center.y + size),
    strokeColor: COLOR_VIOLATION_DOT,
    strokeWidth: 2.5,
    strokeCap: 'round',
    parent: layer,
    data: { type: 'violation-intersection' },
  });

  new paper.Path.Line({
    from: new paper.Point(center.x + size, center.y - size),
    to: new paper.Point(center.x - size, center.y + size),
    strokeColor: COLOR_VIOLATION_DOT,
    strokeWidth: 2.5,
    strokeCap: 'round',
    parent: layer,
    data: { type: 'violation-intersection' },
  });
}
