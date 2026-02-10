/**
 * parametricPresets.js -- Pure parametric pottery shape generator.
 *
 * NO DOM DEPENDENCIES. NO Paper.js DEPENDENCIES.
 * This module is pure math: takes named parameters, returns ProfilePoint[] arrays.
 *
 * ARCHITECTURE:
 * -------------
 * Each preset defines a pottery form (cup, bowl, vase, tumbler) as a set of
 * proportional relationships between four measurements: height, rim diameter,
 * belly width, and foot diameter. The generate function maps these measurements
 * to 6 profile points with bezier control points for smooth curves.
 *
 * PROFILE FORMAT (from profileData.js):
 * --------------------------------------
 * ProfilePoint = { x, y, type: 'line'|'bezier', cp1?: {x,y}, cp2?: {x,y} }
 *   x = distance from revolution axis (radius) in mm
 *   y = height from bottom in mm
 *   Points go from foot (bottom) to rim (top).
 *
 * COORDINATE NOTES:
 * -----------------
 * All x values are RADII (half of diameters). The params use diameters because
 * that is the natural measurement a potter uses (calipers measure diameter).
 * All coordinates are clamped to Math.max(0.1, x) to prevent axis-crossing errors.
 * All values are rounded to 2 decimal places.
 */

// ============================================================
// Default parameters for each preset (fired/final dimensions in mm)
// ============================================================

/**
 * Default parameter values for each preset.
 * All dimensions in mm. Heights and diameters are standard pottery sizes.
 *
 * @type {Object.<string, {height: number, rimDiameter: number, bellyWidth: number, footDiameter: number}>}
 */
export const PRESET_DEFAULTS = {
  cup: {
    height: 90,          // ~3.5" standard coffee cup
    rimDiameter: 80,     // ~3.25"
    bellyWidth: 85,      // slightly wider than rim
    footDiameter: 55,    // ~65% of rim
  },
  bowl: {
    height: 65,          // ~2.5" cereal/soup bowl
    rimDiameter: 150,    // ~6"
    bellyWidth: 155,     // very slightly wider
    footDiameter: 70,    // ~47% of rim
  },
  vase: {
    height: 200,         // ~8"
    rimDiameter: 60,     // narrow neck ~2.5"
    bellyWidth: 130,     // wide belly ~5"
    footDiameter: 70,    // moderate foot
  },
  tumbler: {
    height: 110,         // ~4.5"
    rimDiameter: 80,     // ~3.25"
    bellyWidth: 78,      // slightly narrower than rim (straight-sided)
    footDiameter: 65,    // ~80% of rim (narrow taper)
  },
};

// ============================================================
// Slider ranges for each preset (min/max in mm)
// ============================================================

/**
 * Slider min/max/step ranges for each preset.
 * These constrain sliders to produce geometrically valid profiles.
 *
 * @type {Object.<string, Object.<string, {min: number, max: number, step: number}>>}
 */
export const PRESET_SLIDER_RANGES = {
  cup: {
    height:       { min: 60,  max: 130, step: 1 },
    rimDiameter:  { min: 60,  max: 120, step: 1 },
    bellyWidth:   { min: 60,  max: 130, step: 1 },
    footDiameter: { min: 30,  max: 80,  step: 1 },
  },
  bowl: {
    height:       { min: 30,  max: 100, step: 1 },
    rimDiameter:  { min: 100, max: 250, step: 1 },
    bellyWidth:   { min: 100, max: 260, step: 1 },
    footDiameter: { min: 40,  max: 120, step: 1 },
  },
  vase: {
    height:       { min: 100, max: 350, step: 1 },
    rimDiameter:  { min: 30,  max: 100, step: 1 },
    bellyWidth:   { min: 60,  max: 200, step: 1 },
    footDiameter: { min: 30,  max: 100, step: 1 },
  },
  tumbler: {
    height:       { min: 70,  max: 160, step: 1 },
    rimDiameter:  { min: 55,  max: 110, step: 1 },
    bellyWidth:   { min: 55,  max: 115, step: 1 },
    footDiameter: { min: 40,  max: 90,  step: 1 },
  },
};

// ============================================================
// Internal helpers
// ============================================================

/**
 * Round a number to 2 decimal places.
 * @param {number} n
 * @returns {number}
 */
function r(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Clamp a radius value to a safe minimum (prevents axis-crossing geometry errors).
 * @param {number} x - radius value
 * @returns {number} clamped value, minimum 0.1
 */
function clampX(x) {
  return Math.max(0.1, x);
}

// ============================================================
// Preset generators
// ============================================================

/**
 * Generate a CUP profile: gently flared sides, slight belly, defined foot.
 *
 * Proportions: belly at 55% height, gentle curves, rim ~= belly width.
 *
 * @param {Object} params
 * @returns {Array<ProfilePoint>}
 */
function generateCup({ height, rimDiameter, bellyWidth, footDiameter }) {
  const h = height;
  const rimR = rimDiameter / 2;
  const bellyR = bellyWidth / 2;
  const footR = footDiameter / 2;

  const footTopY = 3;                      // 3mm foot height (constant)
  const transY = r(h * 0.06);             // transition at ~6% height
  const bellyY = r(h * 0.55);             // belly at 55% height
  const bodyTopY = r(h * 0.90);           // body-to-rim at 90% height

  return [
    // Point 0: foot bottom
    { x: r(clampX(footR)),       y: 0,              type: 'line' },
    // Point 1: foot top
    { x: r(clampX(footR)),       y: footTopY,       type: 'line' },
    // Point 2: foot-to-body transition (tucks inward)
    { x: r(clampX(footR * 0.85)), y: r(transY),     type: 'line' },
    // Point 3: belly (bezier curve from transition)
    { x: r(clampX(bellyR)),      y: r(bellyY),      type: 'bezier',
      cp1: { x: r(clampX(footR * 0.75)),  y: r(h * 0.20) },
      cp2: { x: r(clampX(bellyR * 0.90)), y: r(bellyY * 0.80) } },
    // Point 4: body-to-rim (bezier curve from belly)
    { x: r(clampX(rimR * 0.98)), y: r(bodyTopY),    type: 'bezier',
      cp1: { x: r(clampX(bellyR)),           y: r(bellyY + (bodyTopY - bellyY) * 0.30) },
      cp2: { x: r(clampX(rimR * 0.98)),      y: r(bodyTopY * 0.90) } },
    // Point 5: rim
    { x: r(clampX(rimR)),        y: r(h),           type: 'line' },
  ];
}

/**
 * Generate a BOWL profile: wide and shallow, curved sides, rim much wider than foot.
 *
 * Proportions: belly at 45% height, wide opening, short.
 *
 * @param {Object} params
 * @returns {Array<ProfilePoint>}
 */
function generateBowl({ height, rimDiameter, bellyWidth, footDiameter }) {
  const h = height;
  const rimR = rimDiameter / 2;
  const bellyR = bellyWidth / 2;
  const footR = footDiameter / 2;

  const footTopY = 3;
  const transY = r(h * 0.08);             // slightly higher transition zone
  const bellyY = r(h * 0.45);             // belly at 45% (lower, wider feel)
  const bodyTopY = r(h * 0.85);           // body-to-rim at 85%

  return [
    { x: r(clampX(footR)),        y: 0,              type: 'line' },
    { x: r(clampX(footR)),        y: footTopY,       type: 'line' },
    { x: r(clampX(footR * 0.90)), y: r(transY),      type: 'line' },
    { x: r(clampX(bellyR)),       y: r(bellyY),      type: 'bezier',
      cp1: { x: r(clampX(footR * 0.80)),  y: r(h * 0.15) },
      cp2: { x: r(clampX(bellyR * 0.85)), y: r(bellyY * 0.70) } },
    { x: r(clampX(rimR * 0.97)),  y: r(bodyTopY),    type: 'bezier',
      cp1: { x: r(clampX(bellyR * 1.02)), y: r(bellyY + (bodyTopY - bellyY) * 0.35) },
      cp2: { x: r(clampX(rimR * 0.95)),   y: r(bodyTopY * 0.88) } },
    { x: r(clampX(rimR)),         y: r(h),           type: 'line' },
  ];
}

/**
 * Generate a VASE profile: tall, narrow rim, wide belly, pronounced curves.
 *
 * Proportions: belly at 40% height, dramatic difference between rim and belly.
 *
 * @param {Object} params
 * @returns {Array<ProfilePoint>}
 */
function generateVase({ height, rimDiameter, bellyWidth, footDiameter }) {
  const h = height;
  const rimR = rimDiameter / 2;
  const bellyR = bellyWidth / 2;
  const footR = footDiameter / 2;

  const footTopY = 3;
  const transY = r(h * 0.05);             // tight transition
  const bellyY = r(h * 0.40);             // belly at 40% (low and wide)
  const bodyTopY = r(h * 0.88);           // body-to-rim at 88%

  return [
    { x: r(clampX(footR)),        y: 0,              type: 'line' },
    { x: r(clampX(footR)),        y: footTopY,       type: 'line' },
    { x: r(clampX(footR * 0.80)), y: r(transY),      type: 'line' },
    { x: r(clampX(bellyR)),       y: r(bellyY),      type: 'bezier',
      cp1: { x: r(clampX(footR * 0.65)),  y: r(h * 0.15) },
      cp2: { x: r(clampX(bellyR * 0.95)), y: r(bellyY * 0.75) } },
    { x: r(clampX(rimR * 0.95)),  y: r(bodyTopY),    type: 'bezier',
      cp1: { x: r(clampX(bellyR * 0.90)), y: r(bellyY + (bodyTopY - bellyY) * 0.25) },
      cp2: { x: r(clampX(rimR * 0.80)),   y: r(bodyTopY * 0.85) } },
    { x: r(clampX(rimR)),         y: r(h),           type: 'line' },
  ];
}

/**
 * Generate a TUMBLER profile: nearly straight-sided, slight taper, no belly bulge.
 *
 * Proportions: belly at 60% height, rim ~= belly width, foot close to rim.
 *
 * @param {Object} params
 * @returns {Array<ProfilePoint>}
 */
function generateTumbler({ height, rimDiameter, bellyWidth, footDiameter }) {
  const h = height;
  const rimR = rimDiameter / 2;
  const bellyR = bellyWidth / 2;
  const footR = footDiameter / 2;

  const footTopY = 3;
  const transY = r(h * 0.05);             // tight transition
  const bellyY = r(h * 0.60);             // belly at 60% (higher, straighter feel)
  const bodyTopY = r(h * 0.92);           // body-to-rim at 92%

  return [
    { x: r(clampX(footR)),        y: 0,              type: 'line' },
    { x: r(clampX(footR)),        y: footTopY,       type: 'line' },
    { x: r(clampX(footR * 0.92)), y: r(transY),      type: 'line' },
    { x: r(clampX(bellyR)),       y: r(bellyY),      type: 'bezier',
      cp1: { x: r(clampX(footR * 0.90)),  y: r(h * 0.18) },
      cp2: { x: r(clampX(bellyR * 0.98)), y: r(bellyY * 0.85) } },
    { x: r(clampX(rimR * 0.99)),  y: r(bodyTopY),    type: 'bezier',
      cp1: { x: r(clampX(bellyR * 1.0)),  y: r(bellyY + (bodyTopY - bellyY) * 0.35) },
      cp2: { x: r(clampX(rimR * 0.99)),   y: r(bodyTopY * 0.92) } },
    { x: r(clampX(rimR)),         y: r(h),           type: 'line' },
  ];
}

// ============================================================
// Generator dispatch table
// ============================================================

const GENERATORS = {
  cup: generateCup,
  bowl: generateBowl,
  vase: generateVase,
  tumbler: generateTumbler,
};

// ============================================================
// Public API
// ============================================================

/**
 * Generate a profile for a named preset with the given parameters.
 *
 * @param {string} presetName - One of 'cup', 'bowl', 'vase', 'tumbler'.
 * @param {Object} params - Parameter values.
 * @param {number} params.height - Total height in mm.
 * @param {number} params.rimDiameter - Rim diameter in mm.
 * @param {number} params.bellyWidth - Maximum belly diameter in mm.
 * @param {number} params.footDiameter - Foot diameter in mm.
 * @returns {Array<ProfilePoint>} Array of 6 profile points from foot to rim.
 */
export function generatePresetProfile(presetName, params) {
  const generator = GENERATORS[presetName] || GENERATORS.cup;
  return generator(params);
}
