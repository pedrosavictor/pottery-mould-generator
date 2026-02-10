/**
 * profileData.js -- Canonical profile data model for the mould generator.
 *
 * This module defines the data structure that flows through the entire system:
 *   Profile Editor (Phase 2) -> Geometry Bridge -> Geometry Worker -> Three.js Preview
 *
 * NO DOM DEPENDENCIES. Works in both main thread and worker contexts.
 *
 * COORDINATE SYSTEM:
 * ------------------
 *   x = distance from the revolution axis (radius) in mm
 *   y = height from the bottom of the pot in mm
 *
 * The profile represents the OUTER surface of the pot as a half cross-section.
 * Points go from the foot (bottom) to the rim (top). The closing path -- from
 * the last point back to the revolution axis and down to the starting height --
 * is added by the geometry worker (revolveProfile), NOT stored in the profile.
 *
 * VERSIONING:
 * -----------
 * version: 1 = current format (points + seamLines placeholder)
 * Future versions may add new fields; consumers should check version before
 * accessing version-specific data.
 *
 * EXTENSION POINTS (v2, INFRA-05):
 * ---------------------------------
 * seamLines: Currently empty []. In v2, will hold vertical split definitions
 * for multi-part moulds: Array<{ y: number, angle: number }>.
 * These define where the mould is cut into separate pieces for demolding.
 */

/**
 * Factory function to create a valid profile data object.
 *
 * @param {Array<ProfilePoint>} points - Profile points from foot to rim.
 *   Each point has:
 *     - x {number} Distance from revolution axis (radius) in mm. Must be >= 0.
 *     - y {number} Height from bottom in mm. Must be >= 0.
 *     - type {'line'|'bezier'} Segment type from the PREVIOUS point to this one.
 *     - cp1 {{x: number, y: number}} [bezier only] First control point.
 *     - cp2 {{x: number, y: number}} [bezier only] Second control point.
 *
 * @returns {Profile} A frozen profile object with points, seamLines, units, and version.
 *
 * @typedef {Object} ProfilePoint
 * @property {number} x - Distance from revolution axis (radius) in mm.
 * @property {number} y - Height from bottom in mm.
 * @property {'line'|'bezier'} type - Segment type.
 * @property {{x: number, y: number}} [cp1] - First bezier control point.
 * @property {{x: number, y: number}} [cp2] - Second bezier control point.
 *
 * @typedef {Object} Profile
 * @property {ProfilePoint[]} points - Array of profile points from foot to rim.
 * @property {Array} seamLines - v2 extension: vertical split definitions (empty in v1).
 * @property {string} units - Always 'mm' internally.
 * @property {number} version - Data format version (currently 1).
 */
export function createProfile(points = []) {
  return {
    points,
    seamLines: [],  // v2 extension point (INFRA-05)
    units: 'mm',
    version: 1,
  };
}

/**
 * Returns a hardcoded cup shape profile for Phase 1 testing.
 *
 * The profile describes a small cup/mug: ~85mm tall, ~30mm foot radius,
 * ~42mm rim radius, with a curved belly. This is representative of
 * real pottery forms and exercises both line and bezier segment types.
 *
 * Profile visualization (half cross-section, not to scale):
 *
 *     rim (42, 85) ___
 *                     |
 *    body curve      /
 *   (40, 80)       /
 *                 /   <- bezier curves
 *    belly      |
 *   (35, 50)   |
 *               \
 *    transition  \
 *   (25, 5)      |
 *    foot top    |
 *   (30, 3) ____|
 *   foot bottom
 *   (30, 0)
 *
 * @returns {Profile} A test profile with 6 points.
 */
export function getTestProfile() {
  return createProfile([
    { x: 30, y: 0, type: 'line' },        // foot bottom-right (30mm radius)
    { x: 30, y: 3, type: 'line' },         // foot top
    { x: 25, y: 5, type: 'line' },         // foot-to-body transition (tucks in)
    { x: 35, y: 50, type: 'bezier',        // body curve (belly)
      cp1: { x: 22, y: 20 },
      cp2: { x: 30, y: 40 } },
    { x: 40, y: 80, type: 'bezier',        // body to rim
      cp1: { x: 38, y: 55 },
      cp2: { x: 40, y: 70 } },
    { x: 42, y: 85, type: 'line' },        // rim
  ]);
}

/**
 * Validate a profile object for structural correctness.
 *
 * This performs basic validation only -- it does NOT check geometric validity
 * (e.g., self-intersecting curves, profiles that would fail to revolve).
 * Geometric validation happens at revolve time in the geometry worker.
 *
 * @param {Profile} profile - The profile to validate.
 * @returns {{ valid: boolean, errors: string[] }} Validation result.
 */
export function validateProfile(profile) {
  const errors = [];

  if (!profile || typeof profile !== 'object') {
    return { valid: false, errors: ['Profile must be a non-null object'] };
  }

  // Version check
  if (profile.version !== 1) {
    errors.push(`Unsupported profile version: ${profile.version} (expected 1)`);
  }

  // Points array check
  if (!Array.isArray(profile.points)) {
    errors.push('Profile must have a points array');
    return { valid: false, errors };
  }

  if (profile.points.length < 2) {
    errors.push(`Profile must have at least 2 points (got ${profile.points.length})`);
  }

  // Validate each point
  const validTypes = ['line', 'bezier'];

  for (let i = 0; i < profile.points.length; i++) {
    const pt = profile.points[i];
    const prefix = `Point ${i}`;

    // x and y must be numeric and >= 0
    if (typeof pt.x !== 'number' || isNaN(pt.x) || pt.x < 0) {
      errors.push(`${prefix}: x must be a number >= 0 (got ${pt.x})`);
    }
    if (typeof pt.y !== 'number' || isNaN(pt.y) || pt.y < 0) {
      errors.push(`${prefix}: y must be a number >= 0 (got ${pt.y})`);
    }

    // Type must be 'line' or 'bezier'
    if (!validTypes.includes(pt.type)) {
      errors.push(`${prefix}: type must be 'line' or 'bezier' (got '${pt.type}')`);
    }

    // Bezier points must have valid control points
    if (pt.type === 'bezier') {
      if (!pt.cp1 || typeof pt.cp1.x !== 'number' || typeof pt.cp1.y !== 'number') {
        errors.push(`${prefix}: bezier point must have cp1 with numeric x, y`);
      }
      if (!pt.cp2 || typeof pt.cp2.x !== 'number' || typeof pt.cp2.y !== 'number') {
        errors.push(`${prefix}: bezier point must have cp2 with numeric x, y`);
      }
    }

    // No point should have x === 0 except first and last
    // (profile must not cross the revolution axis mid-way, which would
    // create invalid geometry or self-intersecting solids)
    if (i > 0 && i < profile.points.length - 1) {
      if (typeof pt.x === 'number' && pt.x === 0) {
        errors.push(`${prefix}: only the first and last points may have x === 0 (axis crossing)`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
