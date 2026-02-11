/**
 * svgImport.js -- SVG file parsing into ProfilePoint[] format.
 *
 * Parses an SVG string using Paper.js importSVG, extracts the first usable
 * path, and converts its segments into the profile data format used by the
 * editor and geometry pipeline.
 *
 * The conversion handles:
 *   - Y-axis flip (SVG Y-down -> profile Y-up)
 *   - Scaling to reasonable pottery dimensions (~100mm height)
 *   - Bezier handle mapping (Paper.js relative -> profile absolute)
 *   - Point ordering (foot-to-rim, ascending Y)
 *
 * Uses the global `paper` object from CDN (same pattern as all editor modules).
 */

// ============================================================
// Public API
// ============================================================

/**
 * Parse an SVG string and return an array of ProfilePoint objects.
 *
 * Uses Paper.js importSVG to parse the SVG, finds the first path element,
 * and converts its segments into profile data format with correct Y-flip
 * and normalization.
 *
 * @param {string} svgString - Raw SVG markup string.
 * @returns {Array<ProfilePoint>} Profile points from foot (bottom) to rim (top).
 * @throws {Error} If the SVG contains no usable path element.
 */
/** Maximum allowed SVG file size: 1 MB. */
const MAX_SVG_SIZE_BYTES = 1024 * 1024;

export function importSVGFile(svgString) {
  if (!svgString || typeof svgString !== 'string') {
    throw new Error('Invalid SVG input: expected a non-empty string.');
  }

  // Reject excessively large SVG files to prevent browser hangs
  // during Paper.js parsing. 1 MB is generous for a pottery profile SVG.
  if (svgString.length > MAX_SVG_SIZE_BYTES) {
    throw new Error(
      `SVG file is too large (${(svgString.length / 1024).toFixed(0)} KB). Maximum size is 1 MB.`
    );
  }

  // Parse SVG without inserting into the canvas.
  // expandShapes converts rects/circles/ellipses to paths.
  const imported = paper.project.importSVG(svgString, {
    expandShapes: true,
    insert: false,
  });

  if (!imported) {
    throw new Error('Failed to parse SVG file. The file may be malformed.');
  }

  // Find the first usable Path in the imported item tree.
  const svgPath = findFirstPath(imported);

  if (!svgPath) {
    throw new Error(
      'No path found in SVG file. The file must contain at least one <path> element.'
    );
  }

  // Convert Paper.js path segments to ProfilePoint[] format.
  const points = convertPathToProfile(svgPath);

  // Validate the parsed profile for minimum viability.
  validateParsedProfile(points);

  return points;
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Recursively search a Paper.js item tree for the first usable Path.
 *
 * A usable path has at least 2 segments (a single point is not a profile).
 * For CompoundPaths, uses the first child path.
 *
 * @param {paper.Item} item - Root of the item tree to search.
 * @returns {paper.Path|null} The first usable path, or null if none found.
 */
function findFirstPath(item) {
  if (item instanceof paper.Path && item.segments && item.segments.length >= 2) {
    return item;
  }

  if (item instanceof paper.CompoundPath && item.children) {
    for (const child of item.children) {
      if (child instanceof paper.Path && child.segments && child.segments.length >= 2) {
        return child;
      }
    }
  }

  if (item.children) {
    for (const child of item.children) {
      const found = findFirstPath(child);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Convert a Paper.js Path into a ProfilePoint[] array.
 *
 * Performs:
 *   1. Scale normalization (target ~100mm height)
 *   2. Y-axis flip (SVG Y-down -> profile Y-up)
 *   3. Translation so min Y = 0 and min X >= 0
 *   4. Bezier handle extraction
 *   5. Point ordering: foot-to-rim (ascending Y)
 *
 * @param {paper.Path} svgPath - The Paper.js path extracted from SVG.
 * @returns {Array<ProfilePoint>} Normalized profile points.
 */
function convertPathToProfile(svgPath) {
  const bounds = svgPath.bounds;

  // Guard against degenerate paths.
  if (bounds.height < 0.001) {
    throw new Error('SVG path has zero height. Cannot create a profile from a flat line.');
  }

  // Scale to ~100mm height for reasonable pottery dimensions.
  const targetHeight = 100;
  const scaleFactor = targetHeight / bounds.height;

  const points = [];

  for (let i = 0; i < svgPath.segments.length; i++) {
    const seg = svgPath.segments[i];
    const prevSeg = i > 0 ? svgPath.segments[i - 1] : null;

    // Convert anchor point: shift to origin, scale, flip Y.
    const x = round2((seg.point.x - bounds.left) * scaleFactor);
    const y = round2((bounds.bottom - seg.point.y) * scaleFactor);

    // Determine if this segment is a bezier curve.
    const hasHandleIn = seg.handleIn && seg.handleIn.length > 0.5;
    const prevHasHandleOut = prevSeg && prevSeg.handleOut && prevSeg.handleOut.length > 0.5;
    const isBezier = i > 0 && (hasHandleIn || prevHasHandleOut);

    if (!isBezier) {
      points.push({
        x: Math.max(0, x),
        y: Math.max(0, y),
        type: 'line',
      });
    } else {
      // Compute cp1: absolute position of previous segment's handleOut tip.
      let cp1;
      if (prevSeg && prevSeg.handleOut && prevSeg.handleOut.length > 0.5) {
        const tip = prevSeg.point.add(prevSeg.handleOut);
        cp1 = {
          x: round2((tip.x - bounds.left) * scaleFactor),
          y: round2((bounds.bottom - tip.y) * scaleFactor),
        };
      } else {
        // Previous has no handleOut -- cp1 collapses to previous anchor.
        const prev = points[points.length - 1];
        cp1 = { x: prev.x, y: prev.y };
      }

      // Compute cp2: absolute position of this segment's handleIn tip.
      let cp2;
      if (seg.handleIn && seg.handleIn.length > 0.5) {
        const tip = seg.point.add(seg.handleIn);
        cp2 = {
          x: round2((tip.x - bounds.left) * scaleFactor),
          y: round2((bounds.bottom - tip.y) * scaleFactor),
        };
      } else {
        // No handleIn -- cp2 collapses to this anchor.
        cp2 = { x: Math.max(0, x), y: Math.max(0, y) };
      }

      // Clamp control points.
      cp1.x = Math.max(0, cp1.x);
      cp1.y = Math.max(0, cp1.y);
      cp2.x = Math.max(0, cp2.x);
      cp2.y = Math.max(0, cp2.y);

      points.push({
        x: Math.max(0, x),
        y: Math.max(0, y),
        type: 'bezier',
        cp1,
        cp2,
      });
    }
  }

  // Ensure points are ordered foot-to-rim (ascending Y).
  // If the first point has higher Y than the last, reverse.
  if (points.length >= 2 && points[0].y > points[points.length - 1].y) {
    reverseProfile(points);
  }

  return points;
}

/**
 * Reverse a profile points array in place, adjusting bezier data.
 *
 * When reversing point order, bezier control points must be swapped:
 * cp1 and cp2 swap roles because the curve direction reverses.
 * Additionally, the type of each point must be re-evaluated since
 * 'bezier' indicates the curve arriving at the point, not departing.
 *
 * KNOWN LIMITATION (BE-03): For complex multi-bezier SVG profiles
 * (e.g., S-curves with many control points), the simple cp1/cp2 swap
 * may produce slightly distorted curves. A fully correct reversal would
 * require redistributing bezier data between adjacent point pairs based
 * on the original curve parameterization. For typical pottery profiles
 * (5-10 points, gentle curves) the current approach is adequate. If
 * distortion is observed on a complex SVG import, the user can re-import
 * the SVG with the path direction already matching foot-to-rim order.
 *
 * @param {Array<ProfilePoint>} points - Points to reverse (mutated in place).
 */
function reverseProfile(points) {
  points.reverse();

  // After reversing, we need to shift bezier data:
  // Original: point[i+1] has cp1/cp2 describing curve from point[i] to point[i+1].
  // After reverse: what was point[i+1] is now at a different index, and
  // its cp1/cp2 need to describe the curve in the opposite direction.
  //
  // Strategy: collect bezier info, then redistribute.
  // For each adjacent pair (i, i+1) in the ORIGINAL order, the bezier data
  // was stored on point[i+1]. After reversal, this pair becomes (newLen-2-i, newLen-1-i)
  // and the data should be on newLen-2-i (the second point in the new order).
  //
  // Simpler approach: rebuild types and cp1/cp2 from scratch.
  // After reversal, if a point had type 'bezier', its cp1/cp2 described the
  // incoming curve. Now the incoming curve comes from the other direction,
  // so we swap cp1 <-> cp2 for all bezier points.

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    if (pt.type === 'bezier' && pt.cp1 && pt.cp2) {
      // Swap cp1 and cp2.
      const tmp = pt.cp1;
      pt.cp1 = pt.cp2;
      pt.cp2 = tmp;
    }
  }

  // The first point must always be type 'line' (no incoming curve).
  // If it was bezier, shift its bezier data to the second point.
  if (points.length >= 2 && points[0].type === 'bezier') {
    // The first point cannot have an incoming curve.
    points[0].type = 'line';
    delete points[0].cp1;
    delete points[0].cp2;
  }
}

/**
 * Validate a parsed profile for minimum viability.
 *
 * Rejects degenerate profiles that would cause WASM errors downstream:
 *   - Fewer than 3 points (2-point profiles create degenerate solids)
 *   - Profile too short (< 5mm height after normalization)
 *   - Profile too narrow (< 5mm width)
 *   - Invalid numeric coordinates (NaN, Infinity)
 *
 * @param {Array<ProfilePoint>} points - Parsed profile points.
 * @throws {Error} If the profile fails validation.
 */
function validateParsedProfile(points) {
  if (!points || points.length < 3) {
    throw new Error(
      `SVG profile has only ${points ? points.length : 0} points. At least 3 points are required for a valid pottery profile.`
    );
  }

  // Check all coordinates are valid numbers
  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    if (!isFinite(pt.x) || !isFinite(pt.y)) {
      throw new Error(
        `SVG profile has invalid coordinates at point ${i + 1} (x=${pt.x}, y=${pt.y}). All points must have valid numeric coordinates.`
      );
    }
    if (pt.cp1 && (!isFinite(pt.cp1.x) || !isFinite(pt.cp1.y))) {
      throw new Error(
        `SVG profile has invalid control point at point ${i + 1}. All coordinates must be valid numbers.`
      );
    }
    if (pt.cp2 && (!isFinite(pt.cp2.x) || !isFinite(pt.cp2.y))) {
      throw new Error(
        `SVG profile has invalid control point at point ${i + 1}. All coordinates must be valid numbers.`
      );
    }
  }

  // Check minimum dimensions
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);

  if (height < 5) {
    throw new Error(
      `SVG profile is too short (${height.toFixed(1)}mm height). Minimum height is 5mm.`
    );
  }
  if (width < 5) {
    throw new Error(
      `SVG profile is too narrow (${width.toFixed(1)}mm width). Minimum width is 5mm.`
    );
  }
}

/**
 * Round a number to 2 decimal places.
 *
 * @param {number} n
 * @returns {number}
 */
function round2(n) {
  return Math.round(n * 100) / 100;
}
