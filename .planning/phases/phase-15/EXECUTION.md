# Phase 15: URL Sharing & State Fixes -- Execution Log

## Items Fixed

### URL-01: Address bar URL stale when mould settings change
- **File:** `js/app.js` line 592
- **Root cause:** `regenerateMould()` called `saveSettings()` but not `updateURL()`
- **Fix:** Added `updateURL(lastProfilePoints, mouldParams)` after `saveSettings()` in `regenerateMould()`
- **Note:** `onProfileChange()` already called `updateURL()` -- only the mould-settings-only path was missing it

### URL-02: btoa() fails on non-ASCII characters
- **File:** `js/urlSharing.js`
- **Root cause:** Raw `btoa(json)` and `atob(b64)` throw `InvalidCharacterError` on non-Latin1
- **Fix:** Added `safeBase64Encode(str)` using `btoa(unescape(encodeURIComponent(str)))` and `safeBase64Decode(b64)` using `decodeURIComponent(escape(atob(b64)))`
- **Both encode and decode paths updated**

### URL-03: No URL length check for complex profiles
- **File:** `js/urlSharing.js` and `js/app.js`
- **Root cause:** Complex SVG profiles with many bezier points produce URLs exceeding browser limits
- **Fix:** Added `URL_LENGTH_WARN_THRESHOLD = 4000` constant. Console warnings in `updateURL()` and `getShareableURL()`. User-visible toast notification via `showNotification()` in the share button handler when URL exceeds threshold.

## Commit
- `27050ab`: fix(15): URL sharing stale state, non-ASCII encoding, and length warning
