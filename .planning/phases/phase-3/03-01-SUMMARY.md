---
phase: 03-editor-extended
plan: 01
subsystem: profile-editor
tags: [parametric, presets, sliders, mode-switching, UI]
dependency-graph:
  requires: [01-01, 01-02, 01-03, 02-01, 02-02, 02-03]
  provides: [parametric-preset-generator, mode-switching, slider-driven-profile]
  affects: [03-02, 04-01]
tech-stack:
  added: []
  patterns: [pure-function-generator, mode-state-machine, slider-to-profile-pipeline]
key-files:
  created:
    - js/presets/parametricPresets.js
  modified:
    - index.html
    - css/style.css
    - js/profileEditor.js
    - js/app.js
decisions:
  - id: preset-6-points
    description: All presets generate exactly 6 profile points (foot-to-rim) for consistency
  - id: parametric-default-mode
    description: App starts in parametric mode with cup preset (not freehand with test profile)
  - id: pure-generator
    description: parametricPresets.js has zero DOM/Paper.js dependencies -- pure math module
  - id: noop-tool-disable
    description: setToolsEnabled(false) creates a no-op Paper.js tool to deactivate edit/draw
metrics:
  duration: ~4m
  completed: 2026-02-10
---

# Phase 3 Plan 01: Parametric Presets with Slider-Driven Profile Generation

Parametric preset system with four pottery shapes (cup, bowl, vase, tumbler) driven by named sliders, plus mode switching between parametric and freehand bezier editing.

## One-Liner

Pure-function parametric generator for 4 pottery presets with real-time slider-to-profile-to-3D pipeline and parametric/freehand mode toggle.

## Changes Made

### Task 1: Parametric Preset Generator Module
**Commit:** 6412504

Created `js/presets/parametricPresets.js` as a pure ES module with zero DOM or Paper.js dependencies.

**Exports:**
- `PRESET_DEFAULTS` -- default parameter values for cup, bowl, vase, tumbler
- `PRESET_SLIDER_RANGES` -- min/max/step for each parameter per preset
- `generatePresetProfile(presetName, params)` -- returns ProfilePoint[] array

**Preset characteristics:**
| Preset | Height | Rim D | Belly W | Foot D | Belly Position | Character |
|--------|--------|-------|---------|--------|----------------|-----------|
| Cup | 90mm | 80mm | 85mm | 55mm | 55% height | Gentle flare, slight belly |
| Bowl | 65mm | 150mm | 155mm | 70mm | 45% height | Wide, shallow, open |
| Vase | 200mm | 60mm | 130mm | 70mm | 40% height | Narrow rim, dramatic belly |
| Tumbler | 110mm | 80mm | 78mm | 65mm | 60% height | Nearly straight-sided |

Each preset generates 6 points: foot bottom, foot top, foot-to-body transition, belly (bezier), body-to-rim (bezier), rim. All coordinates clamped to min 0.1 and rounded to 2 decimal places.

### Task 2: UI Controls, Mode Switching, and Slider Wiring
**Commit:** 6606f96

**index.html:** Added mode toggle (Parametric/Freehand buttons), preset selector dropdown, four parameter sliders with live value displays -- all above the existing dimension-inputs panel in the sidebar.

**css/style.css:** Added styles for mode toggle buttons (segmented control pattern), preset field with select dropdown, slider fields with labeled range inputs, all using the existing Pottery Academy brand palette.

**js/profileEditor.js:** Added `setToolsEnabled(enabled)` to the public API. When disabled, creates a no-op Paper.js tool to deactivate edit/draw tools and greys out toolbar buttons. Toolbar button click handlers guard against disabled state. Also added dimension overlay and onChange updates to `setProfileData()` to match the internal version.

**js/app.js:** Imports parametric presets module. Adds mode state (`currentMode`, `currentPreset`). New functions:
- `initParametricControls()` -- wires preset selector, sliders, mode buttons
- `applyPreset(name)` -- sets slider ranges/values from PRESET_DEFAULTS and PRESET_SLIDER_RANGES
- `regenerateFromSliders()` -- reads slider values, generates profile, calls setProfileData
- `switchMode(mode)` -- toggles between parametric and freehand with UI updates

App now starts in parametric mode with cup preset instead of the hardcoded test profile.

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| All presets generate 6 points | Consistent structure simplifies validation and keeps profiles lightweight |
| App starts in parametric mode | Better UX for users who lack drawing skills -- the primary target audience |
| Pure generator module | Testable in Node.js, no browser needed for verification, reusable |
| No-op tool for disabling | Paper.js requires an active tool; creating a no-op tool cleanly deactivates edit/draw |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] setProfileData missing dimension/onChange updates**

- **Found during:** Task 2
- **Issue:** The public `setProfileData()` method did not call `renderDimensions()`, `updateDimensionInputs()`, or `onChange()` after setting profile data. The internal version (`setProfileDataInternal`) did. This meant parametric slider changes would not update dimension readouts or trigger the 3D preview pipeline.
- **Fix:** Added dimension overlay updates and `onChange()` callback to the public `setProfileData()` method.
- **Files modified:** js/profileEditor.js
- **Commit:** 6606f96

## Verification

1. All four presets generate valid profiles (6 points, foot-to-rim, no NaN, no negative x/y) -- verified via Node.js
2. PRESET_DEFAULTS and PRESET_SLIDER_RANGES exported for all four presets -- verified
3. Mode toggle buttons, preset selector, and sliders present in HTML -- verified
4. Slider input events wire to regenerateFromSliders -> setProfileData -> onChange pipeline -- verified
5. switchMode toggles parametric/freehand with UI panel show/hide and tool enable/disable -- verified
6. setToolsEnabled properly guards edit/draw tool activation -- verified
7. Existing Phase 1 test harness and Phase 2 features (undo, constraints, dimensions) remain intact -- verified

## Next Phase Readiness

- Parametric preset system provides the foundation for Plan 03-02 (SVG import + reference image overlay)
- The mode switching architecture supports adding a third "tracing" mode in the future
- The `setProfileData()` -> `onChange` pipeline is now verified as the standard way to inject profiles from any source
