# Phase 15: URL Sharing & State Fixes Summary

**One-liner:** Fixed stale address bar URL on mould setting changes, non-ASCII btoa/atob safety, and URL length warnings for complex profiles.

## Changes Made

### URL-01: Stale Address Bar URL
The `regenerateMould()` function (called when mould settings like shrinkage, wall thickness change) saved settings to localStorage but did not update the browser address bar. Added `updateURL(lastProfilePoints, mouldParams)` call so the visible URL always reflects current state.

### URL-02: Non-ASCII Base64 Safety
Replaced raw `btoa()`/`atob()` with `safeBase64Encode()`/`safeBase64Decode()` wrappers that handle non-ASCII characters via `encodeURIComponent`/`decodeURIComponent`. While profile data is typically numeric JSON, this guards against edge cases (e.g., future metadata, locale-specific content).

### URL-03: URL Length Warning
Added a 4000-character threshold check. When exceeded:
- Console warning logged in `updateURL()` and `getShareableURL()`
- User-visible toast notification shown via `showNotification()` when the share button is clicked with a long URL

## Files Modified

| File | Changes |
|------|---------|
| `js/urlSharing.js` | Added `safeBase64Encode`/`safeBase64Decode`, `URL_LENGTH_WARN_THRESHOLD`, length checks in `updateURL()` and `getShareableURL()` |
| `js/app.js` | Added `updateURL()` call in `regenerateMould()`, length warning in share button handler |

## Commits

| Hash | Description |
|------|-------------|
| `27050ab` | fix(15): URL sharing stale state, non-ASCII encoding, and length warning |

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

- **URL_LENGTH_WARN_THRESHOLD = 4000:** Chosen as middle ground between conservative (2000 for IE/old Edge) and permissive (8000+ for modern browsers). Most pottery profiles with 6-12 points produce URLs well under 2000 chars; only complex imported SVGs with many bezier points would approach the limit.
- **User-facing warning only on share button click:** The background `updateURL()` only logs to console (no notification spam during slider drags). The share button shows a visible toast since the user is actively trying to share a link.

## Duration

~3 minutes
