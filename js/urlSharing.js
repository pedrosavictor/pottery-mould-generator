/**
 * urlSharing.js -- Encode/decode design state in URL parameters.
 *
 * Profile points are base64-encoded JSON. Mould settings use short keys.
 * URL is updated via history.replaceState (no page reload).
 */

let updateTimer = null;

/** URL length threshold -- URLs above this may not work in all browsers. */
const URL_LENGTH_WARN_THRESHOLD = 4000;

/**
 * Safely encode a string to base64, handling non-ASCII characters.
 * Standard btoa() throws on characters outside Latin1 range.
 * @param {string} str
 * @returns {string} base64-encoded string
 */
function safeBase64Encode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

/**
 * Safely decode a base64 string, handling non-ASCII characters.
 * Reverses safeBase64Encode.
 * @param {string} b64
 * @returns {string} decoded string
 */
function safeBase64Decode(b64) {
  return decodeURIComponent(escape(atob(b64)));
}

/**
 * Encode profile points and mould params into URL search params.
 * @param {Array} profilePoints
 * @param {Object} mouldParams
 * @returns {string} URL search string
 */
function encodeParams(profilePoints, mouldParams) {
  const params = new URLSearchParams();

  // Encode profile as base64 JSON (safe for non-ASCII)
  try {
    const json = JSON.stringify(profilePoints);
    params.set('p', safeBase64Encode(json));
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
 * Clamp a number to a range. Returns defaultVal if value is NaN.
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @param {number} defaultVal
 * @returns {number}
 */
function clamp(val, min, max, defaultVal) {
  if (!isFinite(val)) return defaultVal;
  return Math.max(min, Math.min(max, val));
}

/**
 * Validate and sanitize profile points decoded from URL.
 * Clamps all coordinates to [0, 500] range. Removes invalid points.
 * Returns null if fewer than 3 valid points remain.
 *
 * @param {Array} points - Raw decoded profile points.
 * @returns {Array|null} Sanitized points, or null if invalid.
 */
function validateProfilePoints(points) {
  if (!Array.isArray(points) || points.length < 3) return null;

  const valid = [];
  for (const pt of points) {
    // Must have numeric x and y
    if (typeof pt.x !== 'number' || typeof pt.y !== 'number') continue;
    if (!isFinite(pt.x) || !isFinite(pt.y)) continue;

    const sanitized = {
      x: clamp(pt.x, 0, 500, 0),
      y: clamp(pt.y, 0, 500, 0),
      type: pt.type === 'bezier' ? 'bezier' : 'line',
    };

    // Validate control points for bezier segments
    if (sanitized.type === 'bezier' && pt.cp1 && pt.cp2) {
      if (isFinite(pt.cp1.x) && isFinite(pt.cp1.y) && isFinite(pt.cp2.x) && isFinite(pt.cp2.y)) {
        sanitized.cp1 = {
          x: clamp(pt.cp1.x, 0, 500, sanitized.x),
          y: clamp(pt.cp1.y, 0, 500, sanitized.y),
        };
        sanitized.cp2 = {
          x: clamp(pt.cp2.x, 0, 500, sanitized.x),
          y: clamp(pt.cp2.y, 0, 500, sanitized.y),
        };
      } else {
        // Invalid control points -- demote to line
        sanitized.type = 'line';
      }
    }

    valid.push(sanitized);
  }

  return valid.length >= 3 ? valid : null;
}

/**
 * Validate and clamp mould settings decoded from URL.
 * Ranges match the HTML slider min/max values.
 *
 * @param {Object} settings - Raw decoded settings.
 * @returns {Object} Sanitized settings (same shape, clamped values).
 */
function validateMouldSettings(settings) {
  const sanitized = {};

  if (settings.shrinkageRate !== undefined) {
    sanitized.shrinkageRate = clamp(settings.shrinkageRate, 0.01, 0.99, 0.13);
  }
  if (settings.wallThickness !== undefined) {
    sanitized.wallThickness = clamp(settings.wallThickness, 1, 10, 2.4);
  }
  if (settings.slipWellType !== undefined) {
    // Whitelist valid values
    const validWells = ['none', 'regular', 'tall'];
    sanitized.slipWellType = validWells.includes(settings.slipWellType)
      ? settings.slipWellType
      : 'regular';
  }
  if (settings.cavityGap !== undefined) {
    sanitized.cavityGap = clamp(settings.cavityGap, 5, 100, 25);
  }
  if (settings.splitCount !== undefined) {
    // Only 2 (halves) or 4 (quarters) are valid
    sanitized.splitCount = settings.splitCount === 4 ? 4 : 2;
  }
  if (settings.clearance !== undefined) {
    sanitized.clearance = clamp(settings.clearance, 0.1, 2, 0.3);
  }
  if (settings.outerWallThickness !== undefined) {
    sanitized.outerWallThickness = clamp(settings.outerWallThickness, 1, 10, 2.4);
  }

  return sanitized;
}

/**
 * Decode URL search params into profile points and mould params.
 * All values are validated and clamped to safe ranges.
 * @returns {{ profilePoints: Array|null, mouldSettings: Object|null }}
 */
export function decodeDesignFromURL() {
  const params = new URLSearchParams(window.location.search);

  let profilePoints = null;
  let mouldSettings = null;

  // Decode profile (safe for non-ASCII via safeBase64Decode)
  const profileB64 = params.get('p');
  if (profileB64) {
    try {
      const json = safeBase64Decode(profileB64);
      const points = JSON.parse(json);
      profilePoints = validateProfilePoints(points);
      if (!profilePoints) {
        console.warn('[urlSharing] URL profile failed validation (too few points or invalid coordinates)');
      }
    } catch (err) {
      console.warn('[urlSharing] Failed to decode profile from URL:', err);
    }
  }

  // Decode settings
  if (params.has('s') || params.has('wt') || params.has('sw') || params.has('cg') || params.has('sc')) {
    const raw = {};
    if (params.has('s')) raw.shrinkageRate = parseFloat(params.get('s')) / 100;
    if (params.has('wt')) raw.wallThickness = parseFloat(params.get('wt'));
    if (params.has('sw')) raw.slipWellType = params.get('sw');
    if (params.has('cg')) raw.cavityGap = parseFloat(params.get('cg'));
    if (params.has('sc')) raw.splitCount = parseInt(params.get('sc'), 10);
    if (params.has('cl')) raw.clearance = parseFloat(params.get('cl'));
    if (params.has('ow')) raw.outerWallThickness = parseFloat(params.get('ow'));
    mouldSettings = validateMouldSettings(raw);
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

      // Warn if URL exceeds safe length for some browsers
      const fullURL = `${window.location.origin}${newURL}`;
      if (fullURL.length > URL_LENGTH_WARN_THRESHOLD) {
        console.warn(`[urlSharing] URL length (${fullURL.length} chars) exceeds ${URL_LENGTH_WARN_THRESHOLD}. Share links may not work in all browsers.`);
      }

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
  const url = `${window.location.origin}${window.location.pathname}?${search}`;

  if (url.length > URL_LENGTH_WARN_THRESHOLD) {
    console.warn(`[urlSharing] Share URL length (${url.length} chars) exceeds ${URL_LENGTH_WARN_THRESHOLD}. Link may not work in all browsers.`);
  }

  return url;
}
