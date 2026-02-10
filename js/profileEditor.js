/**
 * profileEditor.js -- Main entry point for the 2D profile editor.
 *
 * This module initializes the Paper.js canvas, renders the profile path with
 * handles, and provides the public API for the app to interact with the editor.
 *
 * ARCHITECTURE:
 * -------------
 * profileEditor.js (this file) -- orchestrator, public API
 *   canvasSetup.js   -- Paper.js init, coordinate transforms
 *   pathRenderer.js  -- profile <-> Paper.js segment conversion
 *   editTool.js      -- drag anchors/handles, delete points
 *   drawTool.js      -- add points to the profile path
 *
 * DATA FLOW:
 * ----------
 * profileData.points -> renderProfile() -> Paper.js Path
 *                                            |
 *                       user drags/edits ----+
 *                                            |
 *                       syncPathToProfile() <- Paper.js Path
 *                                            |
 *                       onChange(newPoints) -> app.js -> geometryBridge -> 3D
 *
 * EDITOR STATE:
 * -------------
 * The editorState object is shared across tool modules. It contains:
 *   - path: the current Paper.js Path object
 *   - transform: coordinate transform (canvasSetup.js)
 *   - layers: named layer references
 *   - selectedSegmentIndex: currently selected segment (-1 = none)
 *   - requestRender(): redraw handles overlay
 *   - notifyChange(): sync path -> profile data -> call onChange callback
 */

import { initCanvas, createTransform } from './profileEditor/canvasSetup.js';
import { renderProfile, renderHandles, syncPathToProfile } from './profileEditor/pathRenderer.js';
import { createEditTool } from './profileEditor/editTool.js';
import { createDrawTool } from './profileEditor/drawTool.js';
import { validateConstraints, clearViolations, renderViolations } from './profileEditor/constraints.js';

/**
 * Initialize the profile editor on the given canvas element.
 *
 * Sets up Paper.js, renders the initial profile, creates edit/draw tools,
 * and returns a public API for reading/writing profile data.
 *
 * @param {string} canvasId - DOM id of the <canvas> element.
 * @param {Object} [options]
 * @param {Object} [options.initialProfile] - Initial profile data (from profileData.js).
 *   If provided, its .points array is rendered immediately.
 * @param {function(Array<ProfilePoint>): void} [options.onChange] - Callback fired
 *   after every edit. Receives the updated profile points array.
 * @returns {{ getProfileData: function, setProfileData: function }}
 */
export function initProfileEditor(canvasId, options = {}) {
  const { initialProfile, onChange } = options;

  // --- 1. Initialize Paper.js canvas and layers ---
  const { project, view, layers } = initCanvas(canvasId);

  // --- 2. Create coordinate transform ---
  let transform = createTransform(view.size.width, view.size.height);

  // --- 3. Draw mm grid ---
  drawGrid(transform, layers.grid);

  // --- 4. Render initial profile (if provided) ---
  let currentProfilePoints = initialProfile ? [...initialProfile.points] : [];
  let path = null;

  if (currentProfilePoints.length >= 2) {
    path = renderProfile(currentProfilePoints, transform, layers.profile);
    renderHandles(path, layers.handles);
  }

  // --- 5. Editor state (shared across tools) ---
  const editorState = {
    get path() { return path; },
    set path(p) { path = p; },
    transform,
    layers,
    project,
    view,
    selectedSegmentIndex: -1,

    /**
     * Redraw the handle overlay (anchors, control points, lines).
     * Called after any visual change to the path.
     */
    requestRender() {
      if (path) {
        renderHandles(path, layers.handles, editorState.selectedSegmentIndex);
      }
    },

    /**
     * Sync the Paper.js path back to profile data and fire onChange.
     * Called after any edit that changes the profile shape.
     * Also runs constraint validation and updates the status indicator.
     */
    notifyChange() {
      if (!path) return;
      currentProfilePoints = syncPathToProfile(path, transform);

      // Run constraint validation and update visual feedback
      clearViolations(layers.overlay);
      const result = validateConstraints(path, transform);
      if (!result.valid) {
        renderViolations(result.violations, layers.overlay, transform);
      }
      updateConstraintStatus(result);

      if (onChange) {
        onChange(currentProfilePoints);
      }
    },
  };

  // --- 6. Create tools ---
  const editTool = createEditTool(editorState);
  const drawTool = createDrawTool(editorState);

  // Default to edit tool
  editTool.activate();

  // --- 7. Wire toolbar buttons ---
  const btnEdit = document.getElementById('btn-edit-tool');
  const btnDraw = document.getElementById('btn-draw-tool');

  if (btnEdit) {
    btnEdit.addEventListener('click', () => {
      editTool.activate();
      setActiveButton(btnEdit);
    });
  }

  if (btnDraw) {
    btnDraw.addEventListener('click', () => {
      drawTool.activate();
      setActiveButton(btnDraw);
    });
  }

  // --- 8. Handle canvas resize ---
  view.onResize = function () {
    transform = createTransform(view.size.width, view.size.height);
    editorState.transform = transform;

    // Re-render everything with new transform
    drawGrid(transform, layers.grid);

    if (currentProfilePoints.length >= 2) {
      path = renderProfile(currentProfilePoints, transform, layers.profile);
      renderHandles(path, layers.handles, editorState.selectedSegmentIndex);
    }
  };

  // --- 9. Public API ---
  return {
    /**
     * Get the current profile points array.
     * @returns {Array<ProfilePoint>} Current profile points.
     */
    getProfileData() {
      if (path) {
        return syncPathToProfile(path, transform);
      }
      return [...currentProfilePoints];
    },

    /**
     * Replace the current profile with new data.
     * Re-renders the path and handles.
     *
     * @param {Object} profile - Profile object with .points array.
     */
    setProfileData(profile) {
      if (!profile || !Array.isArray(profile.points) || profile.points.length < 2) {
        console.warn('[profileEditor] Invalid profile data');
        return;
      }

      currentProfilePoints = [...profile.points];
      path = renderProfile(currentProfilePoints, transform, layers.profile);
      editorState.selectedSegmentIndex = -1;
      renderHandles(path, layers.handles);

      // Validate the new profile
      clearViolations(layers.overlay);
      const result = validateConstraints(path, transform);
      if (!result.valid) {
        renderViolations(result.violations, layers.overlay, transform);
      }
      updateConstraintStatus(result);
    },
  };
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Draw a millimeter grid on the grid layer.
 * Shows major gridlines every 10mm and minor every 5mm.
 * Also draws the revolution axis (x=0 line).
 *
 * @param {{ toCanvas: function, scale: number, offsetX: number, offsetY: number }} transform
 * @param {paper.Layer} gridLayer
 */
function drawGrid(transform, gridLayer) {
  gridLayer.activate();
  gridLayer.removeChildren();

  const { scale, offsetX, offsetY } = transform;

  // Determine visible range in mm
  const maxX = 70;   // mm - enough for large pots
  const maxY = 130;  // mm

  // Minor grid lines (every 10mm)
  for (let mm = 0; mm <= maxX; mm += 10) {
    const x = offsetX + mm * scale;
    new paper.Path.Line({
      from: new paper.Point(x, offsetY),
      to: new paper.Point(x, offsetY - maxY * scale),
      strokeColor: '#e0dbd5',
      strokeWidth: (mm % 50 === 0) ? 1 : 0.5,
      parent: gridLayer,
    });
  }

  for (let mm = 0; mm <= maxY; mm += 10) {
    const y = offsetY - mm * scale;
    new paper.Path.Line({
      from: new paper.Point(offsetX, y),
      to: new paper.Point(offsetX + maxX * scale, y),
      strokeColor: '#e0dbd5',
      strokeWidth: (mm % 50 === 0) ? 1 : 0.5,
      parent: gridLayer,
    });
  }

  // Revolution axis (x = 0 line) -- dashed, darker
  new paper.Path.Line({
    from: new paper.Point(offsetX, offsetY + 10),
    to: new paper.Point(offsetX, offsetY - maxY * scale - 10),
    strokeColor: '#aaa',
    strokeWidth: 1,
    dashArray: [6, 4],
    parent: gridLayer,
  });
}

/**
 * Set the active state on a toolbar button, removing it from siblings.
 *
 * @param {HTMLElement} activeBtn - The button to mark as active.
 */
function setActiveButton(activeBtn) {
  const toolbar = activeBtn.parentElement;
  if (!toolbar) return;
  const buttons = toolbar.querySelectorAll('.tool-btn');
  buttons.forEach(btn => btn.classList.remove('active'));
  activeBtn.classList.add('active');
}

/**
 * Update the constraint status indicator in the DOM.
 *
 * Shows a green "Profile OK" when valid, or a red summary of violation
 * types when the profile has constraint violations.
 *
 * @param {{ valid: boolean, violations: Array<{ type: string }> }} result
 */
function updateConstraintStatus(result) {
  const el = document.getElementById('constraint-status');
  if (!el) return;

  if (result.valid) {
    el.className = 'constraint-status valid';
    el.textContent = 'Profile OK';
  } else {
    el.className = 'constraint-status invalid';

    // Summarize violation types
    const types = new Set(result.violations.map(v => v.type));
    const labels = [];
    if (types.has('axisCrossing')) labels.push('Axis crossing');
    if (types.has('undercut')) labels.push('Undercut');
    if (types.has('selfIntersection')) labels.push('Self-intersection');

    el.textContent = labels.join(' | ');
  }
}
