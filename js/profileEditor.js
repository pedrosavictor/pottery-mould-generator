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
import { createUndoManager } from './profileEditor/undoManager.js';
import { renderGrid } from './profileEditor/gridOverlay.js';
import { renderDimensions, getDimensions, applyDimensionInput } from './profileEditor/dimensionOverlay.js';
import { createProfile } from './profileData.js';

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

  // --- 3. Draw adaptive grid ---
  renderGrid(layers.grid, transform, view.size.width, view.size.height);

  // --- 4. Undo/redo manager ---
  const undoMgr = createUndoManager(100);

  /**
   * Internal flag: when true, setProfileData will NOT push to undo stack.
   * Used during undo/redo restore to avoid double-recording the state.
   */
  let suppressUndoPush = false;

  /** Whether snap-to-grid is enabled. */
  let snapEnabled = false;

  // --- 5. Render initial profile (if provided) ---
  let currentProfilePoints = initialProfile ? [...initialProfile.points] : [];
  let path = null;

  if (currentProfilePoints.length >= 2) {
    path = renderProfile(currentProfilePoints, transform, layers.profile);
    renderHandles(path, layers.handles);
  }

  // Push initial state to undo stack
  if (currentProfilePoints.length >= 2) {
    undoMgr.push(currentProfilePoints);
  }

  // --- 6. Editor state (shared across tools) ---
  const editorState = {
    get path() { return path; },
    set path(p) { path = p; },
    transform,
    layers,
    project,
    view,
    selectedSegmentIndex: -1,

    /** Whether snap-to-grid is active. Read by tools. */
    get snapEnabled() { return snapEnabled; },

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
     * Also runs constraint validation, pushes to undo stack, and
     * updates the status indicator.
     */
    notifyChange() {
      if (!path) return;
      currentProfilePoints = syncPathToProfile(path, transform);

      // Push to undo stack (unless restoring from undo/redo)
      if (!suppressUndoPush) {
        undoMgr.push(currentProfilePoints);
      }
      updateUndoRedoButtons();

      // Run constraint validation and update visual feedback
      clearViolations(layers.overlay);
      const result = validateConstraints(path, transform);
      if (!result.valid) {
        renderViolations(result.violations, layers.overlay, transform);
      }
      updateConstraintStatus(result);

      // Update dimension overlays and input fields
      renderDimensions(currentProfilePoints, layers.overlay, transform);
      updateDimensionInputs(currentProfilePoints);

      if (onChange) {
        onChange(currentProfilePoints);
      }
    },
  };

  // --- 7. Create tools ---
  const editTool = createEditTool(editorState);
  const drawTool = createDrawTool(editorState);

  // Default to edit tool
  editTool.activate();

  // --- 8. Wire toolbar buttons ---
  const btnEdit = document.getElementById('btn-edit-tool');
  const btnDraw = document.getElementById('btn-draw-tool');
  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');
  const chkSnap = document.getElementById('chk-snap');

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

  // --- Undo/Redo button handlers ---
  if (btnUndo) {
    btnUndo.addEventListener('click', () => performUndo());
  }

  if (btnRedo) {
    btnRedo.addEventListener('click', () => performRedo());
  }

  // --- Snap checkbox ---
  if (chkSnap) {
    chkSnap.addEventListener('change', () => {
      snapEnabled = chkSnap.checked;
    });
  }

  // --- Dimension input fields ---
  const inputHeight = document.getElementById('input-height');
  const inputRimDiam = document.getElementById('input-rim-diameter');
  const readoutBelly = document.getElementById('readout-belly');
  const readoutFoot = document.getElementById('readout-foot');

  if (inputHeight) {
    inputHeight.addEventListener('change', () => {
      const val = parseFloat(inputHeight.value);
      if (!val || val <= 0) return;
      const newPoints = applyDimensionInput(currentProfilePoints, 'height', val);
      const profile = createProfile(newPoints);
      editorState.path = null; // force re-render
      setProfileDataInternal(profile);
    });
  }

  if (inputRimDiam) {
    inputRimDiam.addEventListener('change', () => {
      const val = parseFloat(inputRimDiam.value);
      if (!val || val <= 0) return;
      const newPoints = applyDimensionInput(currentProfilePoints, 'rimDiameter', val);
      const profile = createProfile(newPoints);
      editorState.path = null; // force re-render
      setProfileDataInternal(profile);
    });
  }

  /**
   * Internal setProfileData that always pushes to undo stack.
   * Used by dimension inputs.
   */
  function setProfileDataInternal(profile) {
    if (!profile || !Array.isArray(profile.points) || profile.points.length < 2) return;

    currentProfilePoints = [...profile.points];
    path = renderProfile(currentProfilePoints, transform, layers.profile);
    editorState.selectedSegmentIndex = -1;
    renderHandles(path, layers.handles);

    undoMgr.push(currentProfilePoints);
    updateUndoRedoButtons();

    clearViolations(layers.overlay);
    const result = validateConstraints(path, transform);
    if (!result.valid) {
      renderViolations(result.violations, layers.overlay, transform);
    }
    updateConstraintStatus(result);

    renderDimensions(currentProfilePoints, layers.overlay, transform);
    updateDimensionInputs(currentProfilePoints);

    if (onChange) {
      onChange(currentProfilePoints);
    }
  }

  // Render initial dimensions and populate inputs
  if (currentProfilePoints.length >= 2) {
    renderDimensions(currentProfilePoints, layers.overlay, transform);
    updateDimensionInputs(currentProfilePoints);
  }

  // --- Keyboard shortcuts for undo/redo ---
  document.addEventListener('keydown', (e) => {
    const isMeta = e.metaKey || e.ctrlKey;
    if (!isMeta) return;

    // Cmd+Z / Ctrl+Z = undo
    if (e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      performUndo();
      return;
    }

    // Cmd+Shift+Z = redo (Mac style)
    if (e.key === 'z' && e.shiftKey) {
      e.preventDefault();
      performRedo();
      return;
    }

    // Ctrl+Y = redo (Windows style)
    if (e.key === 'y') {
      e.preventDefault();
      performRedo();
      return;
    }
  });

  /**
   * Perform an undo operation.
   * Restores the previous profile state from the undo stack.
   */
  function performUndo() {
    const prevPoints = undoMgr.undo();
    if (!prevPoints) return;

    suppressUndoPush = true;
    restoreProfile(prevPoints);
    suppressUndoPush = false;
    updateUndoRedoButtons();
  }

  /**
   * Perform a redo operation.
   * Restores the next profile state from the redo stack.
   */
  function performRedo() {
    const nextPoints = undoMgr.redo();
    if (!nextPoints) return;

    suppressUndoPush = true;
    restoreProfile(nextPoints);
    suppressUndoPush = false;
    updateUndoRedoButtons();
  }

  /**
   * Restore a profile from a points array.
   * Re-renders everything and fires onChange.
   */
  function restoreProfile(points) {
    currentProfilePoints = [...points];
    path = renderProfile(currentProfilePoints, transform, layers.profile);
    editorState.selectedSegmentIndex = -1;
    renderHandles(path, layers.handles);

    // Validate
    clearViolations(layers.overlay);
    const result = validateConstraints(path, transform);
    if (!result.valid) {
      renderViolations(result.violations, layers.overlay, transform);
    }
    updateConstraintStatus(result);

    // Update dimension overlays and inputs
    renderDimensions(currentProfilePoints, layers.overlay, transform);
    updateDimensionInputs(currentProfilePoints);

    if (onChange) {
      onChange(currentProfilePoints);
    }
  }

  /**
   * Update the disabled state of undo/redo buttons.
   */
  function updateUndoRedoButtons() {
    if (btnUndo) btnUndo.disabled = !undoMgr.canUndo();
    if (btnRedo) btnRedo.disabled = !undoMgr.canRedo();
  }

  // Initialize undo/redo button states
  updateUndoRedoButtons();

  // --- 9. Handle canvas resize ---
  view.onResize = function () {
    transform = createTransform(view.size.width, view.size.height);
    editorState.transform = transform;

    // Re-render everything with new transform
    renderGrid(layers.grid, transform, view.size.width, view.size.height);

    if (currentProfilePoints.length >= 2) {
      path = renderProfile(currentProfilePoints, transform, layers.profile);
      renderHandles(path, layers.handles, editorState.selectedSegmentIndex);
    }
  };

  // --- 10. Public API ---
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
     * Re-renders the path and handles. Pushes to undo stack unless
     * suppressUndoPush is true (internal undo/redo restore).
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

      // Push to undo stack (unless restoring from undo/redo)
      if (!suppressUndoPush) {
        undoMgr.push(currentProfilePoints);
        updateUndoRedoButtons();
      }

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
 * Update the dimension input fields and read-only readouts with current values.
 * Skips updating an input if it currently has focus (user is typing).
 *
 * @param {Array<ProfilePoint>} profilePoints - Current profile points.
 */
function updateDimensionInputs(profilePoints) {
  const dims = getDimensions(profilePoints);

  const inputHeight = document.getElementById('input-height');
  const inputRimDiam = document.getElementById('input-rim-diameter');
  const readoutBelly = document.getElementById('readout-belly');
  const readoutFoot = document.getElementById('readout-foot');

  if (inputHeight && document.activeElement !== inputHeight) {
    inputHeight.value = dims.height;
  }

  if (inputRimDiam && document.activeElement !== inputRimDiam) {
    inputRimDiam.value = dims.rimDiameter;
  }

  if (readoutBelly) {
    readoutBelly.textContent = dims.maxDiameter || '--';
  }

  if (readoutFoot) {
    readoutFoot.textContent = dims.footDiameter || '--';
  }
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
