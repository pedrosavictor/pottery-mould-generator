/**
 * drawTool.js -- Paper.js tool for adding new points to the profile path.
 *
 * This tool allows the user to add new anchor points to the profile curve
 * by clicking near the path. The new point is inserted at the nearest location
 * on the curve, splitting the curve segment into two parts while preserving
 * the overall shape.
 *
 * HOW IT WORKS:
 * -------------
 * 1. User clicks near the profile path
 * 2. Find the nearest point on the path (getNearestLocation)
 * 3. Insert a new segment at that location (path.divideAt)
 * 4. The curve is split but the shape is preserved (Paper.js handles this)
 * 5. The new point can then be dragged with the edit tool to reshape the profile
 *
 * If the click is NOT near the path, nothing happens (prevents accidental points).
 */

/** Maximum distance from path to accept a click (pixels). */
const SNAP_TOLERANCE = 20;

/**
 * Create the draw tool for the profile editor.
 *
 * @param {Object} editorState - Shared editor state object (see profileEditor.js).
 * @returns {paper.Tool} The Paper.js Tool instance.
 */
export function createDrawTool(editorState) {
  const tool = new paper.Tool();
  tool.name = 'draw';

  tool.onMouseDown = function (event) {
    const path = editorState.path;
    if (!path) return;

    // Find the nearest location on the path to the click point
    const nearestLoc = path.getNearestLocation(event.point);
    if (!nearestLoc) return;

    // Only insert if the click is reasonably close to the path
    const distance = event.point.getDistance(nearestLoc.point);
    if (distance > SNAP_TOLERANCE) return;

    // Divide the path at this location.
    // path.divideAt() inserts a new segment at the given curve-time offset,
    // splitting the existing curve into two curves that together trace the
    // same shape. The new segment has handles calculated by Paper.js to
    // maintain the curve shape (de Casteljau subdivision).
    const newSegment = path.divideAt(nearestLoc);

    if (newSegment) {
      // Select the newly inserted segment so the user can see it
      editorState.selectedSegmentIndex = newSegment.index;
      editorState.requestRender();
      editorState.notifyChange();
    }
  };

  // No drag behavior for draw tool (drag is for edit tool)
  tool.onMouseDrag = function () {};
  tool.onMouseUp = function () {};

  return tool;
}
