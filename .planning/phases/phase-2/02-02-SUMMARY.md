---
phase: 2
plan: 2
subsystem: profile-editor
tags: [constraints, validation, undercut, axis-bound, paper-js]
dependency-graph:
  requires: [02-01]
  provides: [constraint-engine, axis-enforcement, undercut-detection, self-intersection-check, violation-rendering]
  affects: [02-03, 03-01, 04-01]
tech-stack:
  added: []
  patterns: [enforcement-during-drag, validation-after-drag, throttled-feedback, status-indicator]
key-files:
  created:
    - js/profileEditor/constraints.js
  modified:
    - js/profileEditor/editTool.js
    - js/profileEditor.js
    - index.html
    - css/style.css
decisions:
  - id: 02-02-01
    description: "Throttle validation to every 3rd drag event during drag for performance"
  - id: 02-02-02
    description: "Undercut tolerance of -0.5mm to avoid false positives from floating point"
  - id: 02-02-03
    description: "Foot zone height default 5mm -- undercut checking skipped below this height"
  - id: 02-02-04
    description: "Constraint status uses sage green for valid, red for invalid"
metrics:
  duration: ~3m
  completed: 2026-02-10
---

# Phase 2 Plan 2: Constraint Enforcement and Validation Summary

**One-liner:** Real-time axis-bound enforcement during drag plus full validation (axis crossing, undercut, self-intersection) with visual feedback on the overlay layer and a status indicator badge.

## What Was Built

### Task 1: Constraint validation engine (`constraints.js`)

Created a comprehensive constraint system with three tiers:

1. **Enforcement (during drag):** `enforceAxisBound()` clamps segment anchor points and handle tips so nothing crosses x = 0 in profile space. Called on every drag event for immediate feedback.

2. **Validation (after drag):** `validateConstraints()` runs three checks:
   - **axisCrossing:** Tests segment points and curve bounding boxes for x < 0 (with -0.1mm floating point tolerance)
   - **undercut:** Samples each curve at 20 points, checks monotonically non-decreasing radius as height increases (above configurable foot zone, default 5mm). Uses -0.5mm tolerance to avoid false positives.
   - **selfIntersection:** Tests non-adjacent curve pairs (j >= i+2) using Paper.js `getIntersections()`

3. **Visualization:** `renderViolations()` draws:
   - Red semi-transparent vertical band at axis for crossing violations
   - Red highlight lines + warning dots for undercut violations
   - Red X markers at self-intersection points

### Task 2: Integration into editor pipeline

- **editTool.js:** `enforceAxisBound()` called after every drag movement. Throttled `validateConstraints()` runs every 3rd drag event. Full validation on mouseUp.
- **profileEditor.js:** `notifyChange()` runs validation and updates DOM status indicator. `setProfileData()` validates on profile load.
- **index.html:** Added `<div id="constraint-status">` inside editor-container.
- **style.css:** Positioned absolute bottom-left, sage green background for valid, red for invalid.

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| 02-02-01 | Throttle drag validation to every 3rd event | Balance between responsive feedback and performance on complex paths |
| 02-02-02 | Undercut tolerance of -0.5mm | Avoids false positives from floating point noise and physically insignificant concavities |
| 02-02-03 | Foot zone default 5mm | The foot/base of a pot typically narrows; undercut checking only applies above this height |
| 02-02-04 | Sage green for valid, red for invalid | Matches brand palette (--sage variable) and provides clear visual contrast |

## Deviations from Plan

None -- plan executed exactly as written.

## Commits

| Hash | Message |
|------|---------|
| efe0cd0 | feat(02-02): add constraint validation engine for profile editor |
| 9b3a69c | feat(02-02): wire constraint validation into edit tool, editor, and UI |

## Verification

- `constraints.js` exports all 4 public functions: `enforceAxisBound`, `validateConstraints`, `clearViolations`, `renderViolations`
- `editTool.js` imports and calls `enforceAxisBound` in onMouseDrag, runs validation throttled and on mouseUp
- `profileEditor.js` imports constraints, runs validation in `notifyChange()` and `setProfileData()`
- `index.html` has constraint-status div inside editor-container
- `css/style.css` has `.constraint-status`, `.valid`, and `.invalid` styles

## Next Phase Readiness

Ready for 02-03 (profile data persistence and presets). The constraint system is fully self-contained and will automatically validate any profile loaded via `setProfileData()` or modified via the edit/draw tools.

**Note:** Constraint validation rendering needs browser verification -- the overlay layer rendering and status indicator appearance should be confirmed visually.
