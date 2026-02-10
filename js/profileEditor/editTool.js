/**
 * editTool.js -- Paper.js tool for editing profile points and bezier handles.
 *
 * This tool handles:
 *   - Click to select anchor points
 *   - Drag to move anchor points (moves the segment)
 *   - Drag to move bezier handle tips (reshapes curves)
 *   - Click on stroke to select nearest segment
 *   - Backspace/Delete to remove selected segment (minimum 2 segments enforced)
 *
 * HIT TESTING PRIORITY:
 * ---------------------
 * 1. Handle tips (control points) -- highest priority, smallest targets
 * 2. Anchor points (segment endpoints)
 * 3. Path stroke (select nearest segment)
 *
 * This priority ensures you can grab a handle even if it overlaps an anchor,
 * and grab an anchor even if it's on the path stroke.
 *
 * DRAG BEHAVIOR:
 * --------------
 * Anchor drag: Moves segment.point by delta. Handles stay relative to anchor.
 * Handle drag: Moves the handle tip, which changes segment.handleIn/handleOut.
 *   Paper.js stores handles as vectors relative to the anchor, so we add the
 *   mouse delta directly to the handle vector.
 *
 * After each mouseUp, notifyChange() syncs the path back to profile data and
 * triggers the 3D preview update.
 */

import { enforceAxisBound, validateConstraints, clearViolations, renderViolations } from './constraints.js';

/** Hit test tolerance in pixels. */
const HIT_TOLERANCE = 10;

/** Run visual validation feedback every N drag events (throttle). */
const VALIDATION_THROTTLE = 3;

/**
 * Create the edit tool for the profile editor.
 *
 * @param {Object} editorState - Shared editor state object (see profileEditor.js).
 * @returns {paper.Tool} The Paper.js Tool instance.
 */
export function createEditTool(editorState) {
  const tool = new paper.Tool();
  tool.name = 'edit';

  /** What we're currently dragging: null, 'anchor', 'handle-in', or 'handle-out'. */
  let dragType = null;

  /** The segment being dragged. @type {paper.Segment|null} */
  let dragSegment = null;

  /** Whether a drag actually happened (vs. just a click). */
  let didDrag = false;

  /** Counter for throttling validation during drag. */
  let dragCount = 0;

  // ------------------------------------------------------------------
  // Mouse events
  // ------------------------------------------------------------------

  tool.onMouseDown = function (event) {
    const path = editorState.path;
    if (!path) return;

    dragType = null;
    dragSegment = null;
    didDrag = false;

    // Priority 1: Hit test on handle layer items (handle tips)
    const handleHit = hitTestHandles(event.point, editorState);
    if (handleHit) {
      dragType = handleHit.type;
      dragSegment = handleHit.segment;
      editorState.selectedSegmentIndex = handleHit.segmentIndex;
      editorState.requestRender();
      return;
    }

    // Priority 2: Hit test segments (anchor points on the path)
    const segHit = path.hitTest(event.point, {
      segments: true,
      tolerance: HIT_TOLERANCE,
    });

    if (segHit && segHit.type === 'segment') {
      dragType = 'anchor';
      dragSegment = segHit.segment;
      editorState.selectedSegmentIndex = segHit.segment.index;
      editorState.requestRender();
      return;
    }

    // Priority 3: Hit test stroke (select nearest segment)
    const strokeHit = path.hitTest(event.point, {
      stroke: true,
      tolerance: HIT_TOLERANCE,
    });

    if (strokeHit && strokeHit.type === 'stroke') {
      // Find the nearest segment to the hit location
      const loc = strokeHit.location;
      if (loc) {
        // The curve index tells us which two segments define this curve.
        // Select the nearest of the two endpoints.
        const seg1 = path.segments[loc.index];
        const seg2 = path.segments[loc.index + 1];
        if (seg1 && seg2) {
          const d1 = event.point.getDistance(seg1.point);
          const d2 = event.point.getDistance(seg2.point);
          const nearest = d1 <= d2 ? seg1 : seg2;
          editorState.selectedSegmentIndex = nearest.index;
          dragType = 'anchor';
          dragSegment = nearest;
          editorState.requestRender();
        }
      }
      return;
    }

    // Clicked on empty space: deselect
    editorState.selectedSegmentIndex = -1;
    editorState.requestRender();
  };

  tool.onMouseDrag = function (event) {
    if (!dragSegment || !dragType) return;
    didDrag = true;
    dragCount++;

    const delta = event.delta;

    if (dragType === 'anchor') {
      // Move the anchor point by the mouse delta.
      // Handles stay relative to the anchor (they move with it automatically).
      dragSegment.point = dragSegment.point.add(delta);
    } else if (dragType === 'handle-in') {
      // Move handleIn by delta (relative vector changes)
      dragSegment.handleIn = dragSegment.handleIn.add(delta);
    } else if (dragType === 'handle-out') {
      // Move handleOut by delta (relative vector changes)
      dragSegment.handleOut = dragSegment.handleOut.add(delta);
    }

    // Enforce axis boundary constraint (clamp to x >= 0)
    enforceAxisBound(dragSegment, editorState.transform);

    // Live update handles overlay
    editorState.requestRender();

    // Throttled visual validation feedback during drag
    if (dragCount % VALIDATION_THROTTLE === 0 && editorState.path) {
      clearViolations(editorState.layers.overlay);
      const result = validateConstraints(editorState.path, editorState.transform);
      if (!result.valid) {
        renderViolations(result.violations, editorState.layers.overlay, editorState.transform);
      }
    }
  };

  tool.onMouseUp = function (event) {
    if (didDrag && dragSegment) {
      // Editing is done -- sync path back to profile data and update 3D preview
      editorState.notifyChange();

      // Full validation on mouse up (not throttled)
      if (editorState.path) {
        clearViolations(editorState.layers.overlay);
        const result = validateConstraints(editorState.path, editorState.transform);
        if (!result.valid) {
          renderViolations(result.violations, editorState.layers.overlay, editorState.transform);
        }
      }
    }

    dragType = null;
    dragSegment = null;
    didDrag = false;
    dragCount = 0;
  };

  // ------------------------------------------------------------------
  // Keyboard events
  // ------------------------------------------------------------------

  tool.onKeyDown = function (event) {
    // Delete/Backspace: remove selected segment
    if (event.key === 'backspace' || event.key === 'delete') {
      const path = editorState.path;
      if (!path) return;

      const idx = editorState.selectedSegmentIndex;
      if (idx < 0 || idx >= path.segments.length) return;

      // Enforce minimum 2 segments (need at least 2 points for a profile)
      if (path.segments.length <= 2) {
        console.warn('[editTool] Cannot delete: minimum 2 segments required');
        return;
      }

      // Remove the segment
      path.segments[idx].remove();

      // Adjust selection: select previous, or first if we deleted index 0
      editorState.selectedSegmentIndex = Math.min(idx, path.segments.length - 1);
      if (editorState.selectedSegmentIndex > 0) {
        editorState.selectedSegmentIndex--;
      }

      editorState.requestRender();
      editorState.notifyChange();

      // Prevent browser back navigation on Backspace
      event.preventDefault();
    }
  };

  return tool;
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Hit test against the handle layer items to detect clicks on handle tips.
 *
 * Paper.js segments store handles as relative vectors. The actual handle tip
 * positions are anchor.point + anchor.handleIn/handleOut. We check if the
 * click point is near any of these tip positions.
 *
 * @param {paper.Point} point - The mouse point to test.
 * @param {Object} editorState - Shared editor state.
 * @returns {{ type: 'handle-in'|'handle-out', segment: paper.Segment, segmentIndex: number }|null}
 */
function hitTestHandles(point, editorState) {
  const path = editorState.path;
  if (!path) return null;

  // Check handle tips first (they're on top visually)
  for (let i = 0; i < path.segments.length; i++) {
    const seg = path.segments[i];

    // Check handleIn tip
    if (seg.handleIn && seg.handleIn.length > 0.5) {
      const tip = seg.point.add(seg.handleIn);
      if (point.getDistance(tip) <= HIT_TOLERANCE) {
        return { type: 'handle-in', segment: seg, segmentIndex: i };
      }
    }

    // Check handleOut tip
    if (seg.handleOut && seg.handleOut.length > 0.5) {
      const tip = seg.point.add(seg.handleOut);
      if (point.getDistance(tip) <= HIT_TOLERANCE) {
        return { type: 'handle-out', segment: seg, segmentIndex: i };
      }
    }
  }

  return null;
}
