/**
 * urlSharing.js -- Encode/decode design state in URL parameters.
 *
 * Profile points are base64-encoded JSON. Mould settings use short keys.
 * URL is updated via history.replaceState (no page reload).
 */

let updateTimer = null;

/**
 * Encode profile points and mould params into URL search params.
 * @param {Array} profilePoints
 * @param {Object} mouldParams
 * @returns {string} URL search string
 */
function encodeParams(profilePoints, mouldParams) {
  const params = new URLSearchParams();

  // Encode profile as base64 JSON
  try {
    const json = JSON.stringify(profilePoints);
    params.set('p', btoa(json));
  } catch (err) {
    console.warn('[urlSharing] Failed to encode profile:', err);
  }

  // Encode settings with short keys (only non-defaults)
  if (mouldParams.shrinkageRate !== 0.13) params.set('s', (mouldParams.shrinkageRate * 100).toFixed(1));
  if (mouldParams.wallThickness !== 2.4) params.set('wt', mouldParams.wallThickness);
  if (mouldParams.slipWellType !== 'regular') params.set('sw', mouldParams.slipWellType);
  if (mouldParams.cavityGap !== 25) params.set('cg', mouldParams.cavityGap);
  if (mouldParams.splitCount !== 2) params.set('sc', mouldParams.splitCount);
  if (mouldParams.clearance !== 0.3) params.set('cl', mouldParams.clearance);
  if (mouldParams.outerWallThickness !== 2.4) params.set('ow', mouldParams.outerWallThickness);

  return params.toString();
}

/**
 * Decode URL search params into profile points and mould params.
 * @returns {{ profilePoints: Array|null, mouldParams: Object|null }}
 */
export function decodeDesignFromURL() {
  const params = new URLSearchParams(window.location.search);

  let profilePoints = null;
  let mouldSettings = null;

  // Decode profile
  const profileB64 = params.get('p');
  if (profileB64) {
    try {
      const json = atob(profileB64);
      const points = JSON.parse(json);
      if (Array.isArray(points) && points.length >= 2) {
        profilePoints = points;
      }
    } catch (err) {
      console.warn('[urlSharing] Failed to decode profile from URL:', err);
    }
  }

  // Decode settings
  if (params.has('s') || params.has('wt') || params.has('sw') || params.has('cg') || params.has('sc')) {
    mouldSettings = {};
    if (params.has('s')) mouldSettings.shrinkageRate = parseFloat(params.get('s')) / 100;
    if (params.has('wt')) mouldSettings.wallThickness = parseFloat(params.get('wt'));
    if (params.has('sw')) mouldSettings.slipWellType = params.get('sw');
    if (params.has('cg')) mouldSettings.cavityGap = parseFloat(params.get('cg'));
    if (params.has('sc')) mouldSettings.splitCount = parseInt(params.get('sc'), 10);
    if (params.has('cl')) mouldSettings.clearance = parseFloat(params.get('cl'));
    if (params.has('ow')) mouldSettings.outerWallThickness = parseFloat(params.get('ow'));
  }

  return { profilePoints, mouldSettings };
}

/**
 * Update the URL with current design state (debounced, 1s).
 * Uses history.replaceState to avoid polluting browser history.
 * @param {Array} profilePoints
 * @param {Object} mouldParams
 */
export function updateURL(profilePoints, mouldParams) {
  if (updateTimer) clearTimeout(updateTimer);

  updateTimer = setTimeout(() => {
    try {
      const search = encodeParams(profilePoints, mouldParams);
      const newURL = `${window.location.pathname}?${search}`;
      history.replaceState(null, '', newURL);
    } catch (err) {
      console.warn('[urlSharing] Failed to update URL:', err);
    }
  }, 1000);
}

/**
 * Get a full shareable URL for the current design.
 * @param {Array} profilePoints
 * @param {Object} mouldParams
 * @returns {string}
 */
export function getShareableURL(profilePoints, mouldParams) {
  const search = encodeParams(profilePoints, mouldParams);
  return `${window.location.origin}${window.location.pathname}?${search}`;
}
