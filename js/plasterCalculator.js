/**
 * plasterCalculator.js -- Plaster mixing calculations for slip casting moulds.
 *
 * Uses the USG No.1 Pottery Plaster formula:
 *   Water:Plaster ratio = 70:100 by weight
 *   Wet slurry density = 1.58 g/cm^3
 *
 * All volumes in cm^3 (= mL). All weights in grams.
 * NO DOM DEPENDENCIES. Pure math module.
 */

/** USG No.1 Pottery Plaster constants */
const SLURRY_DENSITY = 1.58;  // g/cm^3
const WATER_RATIO = 70;
const PLASTER_RATIO = 100;
const TOTAL_RATIO = WATER_RATIO + PLASTER_RATIO;  // 170

/**
 * Calculate plaster and water quantities for a given cavity volume.
 *
 * @param {number} cavityVolumeCc - Plaster cavity volume in cm^3 (mL).
 * @returns {{
 *   cavityVolumeCc: number,
 *   totalSlurryGrams: number,
 *   plasterGrams: number,
 *   waterGrams: number,
 *   waterMl: number
 * }}
 */
export function calculatePlaster(cavityVolumeCc) {
  const totalSlurryGrams = cavityVolumeCc * SLURRY_DENSITY;
  const plasterGrams = totalSlurryGrams * (PLASTER_RATIO / TOTAL_RATIO);
  const waterGrams = totalSlurryGrams * (WATER_RATIO / TOTAL_RATIO);
  const waterMl = waterGrams; // water density = 1 g/mL

  return {
    cavityVolumeCc: Math.round(cavityVolumeCc),
    totalSlurryGrams: Math.round(totalSlurryGrams),
    plasterGrams: Math.round(plasterGrams),
    waterGrams: Math.round(waterGrams),
    waterMl: Math.round(waterMl),
  };
}

/**
 * Format plaster calculation results for display.
 *
 * @param {{ plasterGrams: number, waterMl: number, cavityVolumeCc: number }} results
 * @returns {{ plaster: string, water: string, cavity: string }}
 */
export function formatPlasterResults(results) {
  return {
    plaster: `${results.plasterGrams} g`,
    water: `${results.waterMl} mL`,
    cavity: `${results.cavityVolumeCc} cm\u00B3`,
  };
}

/**
 * Format a volume in mm^3 to a human-readable string in cm^3.
 *
 * @param {number} volumeMm3 - Volume in cubic millimeters.
 * @returns {string} Formatted string like "245 cm^3".
 */
export function formatVolume(volumeMm3) {
  const cc = volumeMm3 / 1000;
  return `${Math.round(cc)} cm\u00B3`;
}
