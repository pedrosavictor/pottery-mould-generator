# Phase 14 Plan 1: Preset Defaults & Geometry Fixes Summary

**One-liner:** Fixed cup/bowl preset undercuts, ring Z-alignment, clearance parameter, cavity volume accuracy, and README instructions.

## Completed Tasks

| # | Item | Description | Commit |
|---|------|-------------|--------|
| 1 | GEO-01 | Cup bellyWidth 85 -> 78 (no undercut) | b6b6cb2 |
| 2 | GEO-02 | Bowl bellyWidth 155 -> 148, curve multiplier 1.02 -> 1.00 | b6b6cb2 |
| 3 | GEO-03 | Vase undercut documented as intentional | b6b6cb2 |
| 4 | GEO-04 | Slider belly max clamped to rim max for cup/bowl/tumbler | b6b6cb2 |
| 5 | GEO-05 | Added warnIfUndercut() validation at generation time | b6b6cb2 |
| 6 | GEO-06 | Ring top aligns with shelled inner mould bottom (bottomZ - wallThickness) | 1e08e7d |
| 7 | GEO-07 | Ring clearance uses params.clearance instead of hardcoded 0.5mm | 1e08e7d |
| 8 | GEO-08 | README: removed incorrect "pour hole in ring" reference | ba2a21b |
| 9 | GEO-09 | Cavity volume now uses shelled inner mould volume | 6a3dcf4 |
| 10 | GEO-10 | Documented bezier offset limitation in fallback path | c10759e |

## Files Modified

| File | Changes |
|------|---------|
| `js/presets/parametricPresets.js` | Cup/bowl defaults, slider ranges, vase comment, undercut validation |
| `js/workers/geometryWorker.js` | Ring alignment, clearance param, cavity volume, bezier comment |
| `js/exportManager.js` | Corrected assembly instruction text |

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Ring top at `bottomZ - wallThickness` | Shell grows outward including downward; ring must meet actual shelled bottom |
| Outer mould bottom also lowered by wallThickness | Must align with ring and inner mould at same base plane |
| warnIfUndercut() in generatePresetProfile (not each generator) | Single check point, DRY, covers all presets including future ones |
| Foot zone exclusion at 5mm | Foot naturally tapers inward; undercut check only above this height |
| Shell fallback for volume: solid - scaledProof | When shell() fails, subtracting inner cavity approximates hollow volume |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Outer mould bottom alignment**

- **Found during:** GEO-06 (ring alignment fix)
- **Issue:** Outer mould bottom was at `mouldProfile[0].y` but should match the shelled inner mould bottom at `bottomZ - wallThickness`
- **Fix:** Updated `generateOuterMould()` to use `bottomZ = mouldProfile[0].y - wallThickness`
- **Files modified:** `js/workers/geometryWorker.js`
- **Commit:** 1e08e7d

**2. [Rule 2 - Missing Critical] Export function cavity volume also used solid volume**

- **Found during:** GEO-09 (cavity volume fix)
- **Issue:** `exportMouldPartsForDownload()` had the same solid-volume bug as `computeVolumes()`
- **Fix:** Updated export function to use shelled volume with same fallback pattern
- **Files modified:** `js/workers/geometryWorker.js`
- **Commit:** 6a3dcf4

## Metrics

- **Duration:** ~4.75 minutes (285 seconds)
- **Completed:** 2026-02-11
- **Items:** 10/10
- **Commits:** 5 (grouped by logical change)
