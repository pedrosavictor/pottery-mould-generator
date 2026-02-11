/**
 * referenceImage.js -- Reference photo overlay for the profile editor.
 *
 * Manages a Paper.js Raster on a dedicated reference layer (below the grid).
 * Users upload a photo of an existing pot to trace its profile shape.
 *
 * The reference image:
 *   - Sits on the reference layer (layer 0, below grid and profile)
 *   - Has adjustable opacity (default 0.3 for comfortable tracing)
 *   - Persists across mode switches (parametric <-> freehand)
 *   - Can be removed to return to a clean canvas
 *
 * Uses the global `paper` object from CDN (same pattern as all editor modules).
 */

// ============================================================
// Public API
// ============================================================

/**
 * Load a reference image onto the reference layer.
 *
 * Creates a Paper.js Raster from a data URL, scales it to fit the editor
 * area, positions it aligned with the profile origin, and sets initial
 * opacity for tracing.
 *
 * Clears any previously loaded reference image before adding the new one.
 *
 * @param {string} dataUrl - Base64 data URL of the image (from FileReader.readAsDataURL).
 * @param {paper.Layer} referenceLayer - The reference layer from canvasSetup.js.
 * @param {{ scale: number, offsetX: number, offsetY: number }} transform - Coordinate transform.
 */
export function loadReferenceImage(dataUrl, referenceLayer, transform) {
  if (!dataUrl || !referenceLayer || !transform) {
    console.warn('[referenceImage] Missing required parameters');
    return;
  }

  // Clear any existing reference image.
  referenceLayer.removeChildren();

  // Create the raster. Paper.js loads it asynchronously.
  const raster = new paper.Raster(dataUrl);

  raster.onLoad = function () {
    // Calculate scale to fit the editor area.
    // Use ~80% of the profile height area (120mm * scale = full editor height).
    const editorHeight = transform.scale * 120;
    const scaleFactor = (editorHeight * 0.8) / raster.height;
    raster.scale(scaleFactor);

    // Position with bottom aligned to profile origin.
    // The profile origin (0,0) is at (offsetX, offsetY) in canvas coords.
    // Place image bottom at offsetY, centered horizontally on the profile area.
    raster.position = new paper.Point(
      transform.offsetX + raster.bounds.width / 2,
      transform.offsetY - raster.bounds.height / 2
    );

    // Set initial opacity for comfortable tracing.
    raster.opacity = 0.3;

    // Add to the reference layer.
    referenceLayer.addChild(raster);
  };

  raster.onError = function () {
    console.warn('[referenceImage] Failed to load image');
  };
}

/**
 * Remove all reference images from the reference layer.
 *
 * @param {paper.Layer} referenceLayer - The reference layer from canvasSetup.js.
 */
export function clearReferenceImage(referenceLayer) {
  if (!referenceLayer) return;
  referenceLayer.removeChildren();
}

/**
 * Set the opacity of all items on the reference layer.
 *
 * @param {paper.Layer} referenceLayer - The reference layer from canvasSetup.js.
 * @param {number} opacity - Opacity value between 0 (invisible) and 1 (fully opaque).
 */
export function setReferenceOpacity(referenceLayer, opacity) {
  if (!referenceLayer) return;
  const clamped = Math.max(0, Math.min(1, opacity));
  for (const child of referenceLayer.children) {
    child.opacity = clamped;
  }
}
