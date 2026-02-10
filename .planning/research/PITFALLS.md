# Pitfalls Research

**Domain:** Browser-based 3D slip casting mould generator (OpenCASCADE.js + Three.js)
**Researched:** 2026-02-10
**Confidence:** MEDIUM (verified via GitHub issues, official OCCT docs, community reports; some areas LOW confidence due to niche domain)

---

## Critical Pitfalls

Mistakes that cause rewrites, broken products, or moulds that physically do not work.

### Pitfall 1: OpenCASCADE.js Memory Leaks Crash the Browser

**Severity:** CRITICAL

**What goes wrong:**
Every C++ object created through opencascade.js (via Emscripten bindings) lives in the WASM linear memory heap. JavaScript's garbage collector does NOT trigger C++ destructors. Without explicit `.delete()` calls on every OCCT object, memory accumulates with each profile edit, geometry rebuild, or boolean operation. After 5-10 regeneration cycles, the browser tab runs out of memory and crashes. Users lose their work.

**Why it happens:**
JavaScript lacks a reliable finalizer mechanism for C++ objects. The opencascade.js examples intentionally omit `.delete()` calls for readability, so developers copy leaky patterns. In a mould generator with frequent regeneration (user tweaks a slider, geometry rebuilds), leaks compound rapidly.

**How to avoid:**
- Call `.delete()` on EVERY opencascade.js object after use -- shapes, builders, wires, edges, faces, meshes, all of them.
- Implement a `withOC()` helper that tracks all allocations and deletes them in a `finally` block:
  ```javascript
  function withOC(fn) {
    const allocated = [];
    const track = (obj) => { allocated.push(obj); return obj; };
    try {
      return fn(track);
    } finally {
      allocated.forEach(obj => { try { obj.delete(); } catch(e) {} });
    }
  }
  ```
- Before each regeneration cycle, delete ALL shapes from the previous cycle.
- Monitor WASM heap usage with `oc.HEAP8.buffer.byteLength` and warn users if approaching limits.
- Consider using `FinalizationRegistry` as a safety net (not primary strategy -- unreliable timing).

**Warning signs:**
- Browser DevTools shows WASM memory growing linearly after each slider adjustment
- Tab crash after 5+ profile edits without page reload
- `performance.memory` (Chrome) shows growing `usedJSHeapSize`

**Phase to address:** Phase 1 (Core Geometry Engine) -- must be built into the architecture from day one. Retrofitting `.delete()` calls is extremely tedious and error-prone.

**Confidence:** HIGH -- verified via [opencascade.js discussion #186](https://github.com/donalffons/opencascade.js/discussions/186) and [issue #50](https://github.com/donalffons/opencascade.js/issues/50). The maintainer explicitly states: "the example code is currently leaking memory left and right."

---

### Pitfall 2: Boolean Operations Fail on Complex or Thin Geometry

**Severity:** CRITICAL

**What goes wrong:**
OpenCASCADE boolean operations (cut, fuse, common) silently produce garbage geometry or throw exceptions when:
- The FuzzyValue tolerance is too large relative to feature size (ridges/grooves are ~2mm, a FuzzyValue of 0.1 collapses them)
- Input shapes have self-intersections, gaps, or inconsistent face orientations
- Geometry creates near-zero-thickness walls or knife edges
- Two shapes share a face exactly (co-planar tangency)

The result: mould parts with missing faces, inverted surfaces, or phantom geometry that looks fine in the preview but produces unprintable STLs.

**Why it happens:**
Boolean operations are the most sensitive algorithms in OCCT to input quality. The FuzzyValue parameter (tolerance for geometric coincidence) defaults to values that may be too large for small features like ridges and grooves. Additionally, OCCT's C++ API uses default arguments that are not supported in the JS bindings -- developers must pass ALL parameters explicitly, including progress range objects.

**How to avoid:**
- Set FuzzyValue to a value MUCH smaller than the smallest feature (for 2mm ridges, use `SetFuzzyValue(0.001)` or smaller, not `0.1`)
- Validate all input geometry BEFORE boolean operations using `BRepCheck_Analyzer`
- Use `BRepAlgoAPI_Check` to pre-validate boolean operation arguments
- After each boolean operation, check `IsDone()` and `HasErrors()` -- do not assume success
- Enable the `NonDestructive` option to avoid modifying input shapes
- Keep geometry simple: avoid unnecessary fillets or complex curves near boolean operation boundaries
- If a boolean operation fails, try `BRepAlgoAPI_Defeaturing` to simplify problematic features

**Warning signs:**
- `IsDone()` returns false after a boolean operation
- Mesh has holes, flipped normals, or zero-area triangles after tessellation
- Preview shows visual artifacts (z-fighting, holes, inverted faces)
- STL file fails manifold check in slicing software

**Phase to address:** Phase 1 (Core Geometry Engine) -- boolean operations are the foundation. Must be robust before building features on top.

**Confidence:** HIGH -- verified via [opencascade.js discussion #143](https://github.com/donalffons/opencascade.js/discussions/143) (FuzzyValue confirmed as root cause) and [official OCCT boolean operations docs](https://dev.opencascade.org/doc/overview/html/specification__boolean_operations.html).

---

### Pitfall 3: Mould Parts Do Not Fit Together Due to Tolerance Errors

**Severity:** CRITICAL

**What goes wrong:**
The generated mould parts (inner mould, outer mould halves, ring) do not physically fit together when 3D printed. Ridges do not slot into grooves. The ring has a gap or is too tight. The outer mould halves leave a visible seam that leaks plaster. The inner mould wobbles inside the assembly.

This is a manufacturing-precision tool -- if parts do not fit, the entire product is useless.

**Why it happens:**
Multiple compounding factors:
1. **3D printer dimensional inaccuracy:** FDM printers have +/-0.2-0.5mm tolerance per axis. Parts designed with zero clearance will either fuse together or not fit.
2. **No clearance/gap compensation:** CAD geometry assumes perfect surfaces. Real 3D prints need 0.2-0.6mm clearance between mating parts (depends on printer type).
3. **Ridge/groove dimensions too tight:** If a ridge is exactly the same width as its groove, it will never fit on an FDM print.
4. **Asymmetric shrinkage:** FDM prints shrink more in Z than X/Y due to layer cooling. Vertical features (ridges) may be shorter than designed.
5. **Different printers, different results:** PLA on a Prusa will differ from ABS on an Ender. No single clearance value works for everyone.

**How to avoid:**
- Build clearance as a user-configurable parameter (default 0.3mm for FDM, 0.15mm for SLA)
- Ridge width should be groove width MINUS clearance on each side (e.g., 2mm groove, 1.4mm ridge = 0.3mm gap per side)
- ShapeCast uses 2.4mm wall thickness -- this is proven to be thick enough for rigidity while thin enough to print fast. Use this as the default.
- Provide a "tolerance test print" STL that users print first to calibrate their specific printer's clearance
- Round/chamfer the entry edges of grooves and ridges to ease assembly (0.5mm chamfer)
- Test with multiple printers during development -- not just one

**Warning signs:**
- Parts require excessive force to assemble (too tight)
- Parts have visible gaps when assembled (too loose)
- Plaster leaks through seams during pouring
- Users report "parts don't fit" in feedback

**Phase to address:** Phase 2 (Mould Assembly Features -- ridges, grooves, clearances) with physical validation testing throughout. Revisit in Phase 3 (testing/calibration features).

**Confidence:** HIGH -- 3D printing tolerance data verified across [Formlabs](https://formlabs.com/blog/understanding-accuracy-precision-tolerance-in-3d-printing/), [Sculpteo](https://www.sculpteo.com/en/3d-learning-hub/design-guidelines/3d-printing-tolerances/), and [Protolabs](https://www.protolabs.com/resources/design-tips/7-mistakes-to-avoid-when-designing-3d-printed-parts/) guidelines. ShapeCast wall thickness (2.4mm) from [CHI 2024 paper](https://inovo.studio/pubs/shapecast-chi24.pdf).

---

### Pitfall 4: Profile Geometry That Produces Invalid Moulds

**Severity:** CRITICAL

**What goes wrong:**
Users create or upload profiles that are technically valid as 2D curves but produce physically impossible moulds:
- **Self-intersecting profiles:** The profile crosses itself, creating impossible 3D geometry when revolved
- **Undercuts:** The profile curves inward (narrower section below a wider section), meaning the cast pot cannot be demolded from a one-part mould. The clay locks into the plaster.
- **Zero-width or knife-edge sections:** The profile has a point where the wall thickness approaches zero, creating geometry too thin to print or structurally useless
- **Profile touching or crossing the revolution axis:** Creates degenerate geometry (zero-radius point, self-intersecting solid)
- **Sharp cusps (C0 discontinuities):** Abrupt direction changes that create stress concentration points in the printed mould

**Why it happens:**
Freehand drawing tools and SVG editors make it easy to create shapes that look fine in 2D but fail in 3D. Users are potters, not CAD engineers -- they do not think about revolve axis constraints, undercuts, or wall thickness minimums. ShapeCast's documentation explicitly warns: "draw from center of foot to rim without any undercuts."

**How to avoid:**
- **Undercut detection BEFORE revolve:** Walk the profile from bottom to top. If any point has a smaller radius than a point below it, flag it as an undercut. Highlight the offending section visually.
- **Self-intersection detection:** Use a sweep-line algorithm or check all line segments for pairwise intersection before accepting the profile.
- **Minimum wall thickness enforcement:** After applying shrinkage scaling and wall offset, verify that no section is thinner than a printable minimum (1.2mm for FDM, 0.8mm for SLA).
- **Revolution axis clearance:** Ensure all profile points have x > 0 (positive distance from revolution axis). Points ON the axis should only be at the very bottom (foot center) or top (if the form closes).
- **Real-time visual feedback:** Show the problem WHILE the user is drawing, not after they click "generate." Highlight undercut zones in red, show minimum thickness warnings inline.
- **Cusp smoothing:** Automatically smooth sharp corners (e.g., fillet with 0.5mm radius) or warn the user.

**Warning signs:**
- Revolve operation fails or produces self-intersecting solid
- Preview shows inverted faces or visual glitches
- Boolean operations fail on the revolved shape
- Generated mould has areas thinner than printable minimum

**Phase to address:** Phase 1 (Profile Editor) for real-time validation, Phase 2 (Geometry Engine) for robust handling of edge cases.

**Confidence:** HIGH -- undercut physics verified via [Ceramic Arts Network slip casting guide](https://ceramicartsnetwork.org/daily/article/10-slip-casting-problems-and-how-to-solve-them). OCCT revolve requirements from [BRepPrimAPI_MakeRevol docs](https://dev.opencascade.org/doc/refman/html/class_b_rep_prim_a_p_i___make_revol.html). ShapeCast explicitly constrains profiles to "no undercuts."

---

### Pitfall 5: Clay Shrinkage Applied in Wrong Direction

**Severity:** CRITICAL

**What goes wrong:**
The shrinkage calculation is applied backwards or with the wrong formula. The user wants a pot that is 10cm tall AFTER firing. Clay shrinks 13% during drying and firing. The mould must produce a pot that is larger than the final desired size. If you scale the finished dimension by 1.13, you get 11.3cm. But the correct calculation is: `wet_size = finished_size / (1 - shrinkage_percent / 100)` = `10 / (1 - 0.13)` = `10 / 0.87` = 11.49cm. The naive multiplication approach (10 * 1.13 = 11.3) is wrong and produces pots that are too small.

**Why it happens:**
Shrinkage percentages describe how much the WET piece shrinks. "13% shrinkage" means the wet piece LOSES 13% of its size. So `wet * (1 - 0.13) = fired`. Solving for wet: `wet = fired / (1 - 0.13)`. This is different from `fired * (1 + 0.13)`. The difference is small (~1.7% for 13% shrinkage) but meaningful for a precision tool.

**How to avoid:**
- Use the correct formula: `mould_dimension = desired_fired_dimension / (1 - shrinkage_rate)`
- This is already correctly implemented in the existing pottery-template-pot app (see `calculateWetDimension()` in app.js line 57-60)
- Add unit tests that verify the formula: 100mm with 13% shrinkage should produce a mould of 114.94mm, NOT 113mm
- Display both values to the user: "Your mould will produce a pot that is ~115mm wet, which fires to ~100mm"

**Warning signs:**
- Pots consistently come out slightly too small after firing
- Shrinkage test print does not match expected dimensions

**Phase to address:** Phase 1 (Geometry Engine) -- shrinkage is applied during geometry generation. Verify with unit tests immediately.

**Confidence:** HIGH -- verified against existing codebase (`pottery-template-pot/js/app.js` uses `finishedDimension / (1 - shrinkagePercent / 100)` correctly). The error is well-documented in ceramics communities.

---

## High-Severity Pitfalls

Mistakes that cause major UX problems or significant rework.

### Pitfall 6: WASM Loading Blocks UI for 5-15 Seconds

**Severity:** HIGH

**What goes wrong:**
The opencascade.js WASM binary is ~45MB uncompressed (~9MB with brotli compression). Loading, compiling, and instantiating this WASM module blocks the main thread for 5-15 seconds on average hardware, during which the page appears frozen. On mobile or slow connections, the initial load can take 30+ seconds. Users think the app is broken and leave.

**Why it happens:**
WASM compilation to native code is CPU-intensive. The more WASM code, the longer compilation takes. OpenCASCADE is a massive CAD kernel -- even a custom build with only needed modules is several MB. Additionally, there is an upper limit of ~100,000 exports a WASM file can have in most browsers, and the large number of Emscripten bindings adds instantiation overhead.

**How to avoid:**
- **Custom build:** Create a custom opencascade.js build with ONLY the modules needed for this project (BRepPrimAPI, BRepAlgoAPI, BRepBuilderAPI, BRepMesh, STEPControl, StlAPI, and their dependencies). The official site's custom build is 7.1MB combined JS+WASM (2.4MB compressed).
- **Web Worker initialization:** Load and initialize the WASM module in a Web Worker, NOT the main thread. The UI remains interactive during loading.
- **Progressive loading UX:** Show an animated loading screen with progress indication. Display the profile editor immediately (it does not need OCCT). Only block on WASM when the user first clicks "Generate."
- **Lazy initialization:** Do not load WASM on page load. Start loading when the user begins editing, so by the time they want to generate, it is ready.
- **Cache with Service Worker:** Cache the WASM binary in a Service Worker so subsequent visits load instantly.
- **Enable brotli compression on Vercel:** Ensure the WASM file is served with brotli encoding (Vercel does this by default for static assets).

**Warning signs:**
- Blank white screen for >3 seconds on page load
- Lighthouse performance score below 50
- Mobile users report "page never loads"
- Time to Interactive exceeds 10 seconds

**Phase to address:** Phase 1 (Project Setup / Infrastructure) -- WASM loading strategy must be decided before writing geometry code.

**Confidence:** HIGH -- file size data from [opencascade.js docs](https://ocjs.org/docs/getting-started/file-size) and [discussion #27](https://github.com/donalffons/opencascade.js/discussions/27). Custom build size verified from official examples.

---

### Pitfall 7: CAD Operations Block UI During Regeneration

**Severity:** HIGH

**What goes wrong:**
When the user adjusts a slider (e.g., wall thickness, shrinkage), the app regenerates all mould geometry: revolve profile, offset surfaces, boolean cuts for halves, add ridges/grooves, mesh for preview. If this runs on the main thread, the UI freezes for 1-5 seconds per regeneration. Slider dragging feels broken -- choppy, laggy, unresponsive. The "live preview" promise is destroyed.

**Why it happens:**
OpenCASCADE operations (especially revolve + boolean + mesh) are CPU-intensive and synchronous. JavaScript is single-threaded. WASM operations cannot be interrupted. If the geometry takes 2 seconds to compute, the UI is frozen for 2 seconds.

**How to avoid:**
- **Run ALL OCCT operations in a Web Worker.** The main thread handles only Three.js rendering and UI events. The worker receives profile data, runs OCCT operations, and posts back mesh data (vertex arrays) for Three.js display.
- **Debounce slider inputs.** Do not regenerate on every mousemove event. Wait 150-300ms after the last input change before triggering generation.
- **Show a lightweight preview immediately.** Use Three.js LatheGeometry (fast, no OCCT needed) for an instant shape preview. Run the full OCCT generation in the background. Replace the preview mesh when OCCT finishes.
- **Cancel in-progress operations.** If the user changes a slider while generation is running, cancel the current worker task and start a new one with updated parameters.
- **Compute incrementally if possible.** If only wall thickness changed, do not re-revolve -- just re-offset. This is complex but saves time.

**Warning signs:**
- Slider dragging causes visible frame drops
- Browser shows "page unresponsive" dialog
- DevTools shows long tasks (>50ms) on the main thread during generation
- Users cannot interact with UI while geometry is computing

**Phase to address:** Phase 1 (Architecture Decision) -- Web Worker boundary must be established before writing geometry code. This is an architectural decision, not a feature.

**Confidence:** HIGH -- standard web performance pattern verified via [The New Stack](https://thenewstack.io/for-darryl-webassembly-and-web-workers/) and [web.dev WASM threads article](https://web.dev/articles/webassembly-threads).

---

### Pitfall 8: SVG Upload Accepts Wildly Different Formats

**Severity:** HIGH

**What goes wrong:**
Users upload SVG files from different editors (Inkscape, Illustrator, Figma, Affinity Designer, hand-coded) that represent the same visual shape but have radically different internal representations:
- **Unit confusion:** Inkscape uses mm by default but stores coordinates as "user units" (96 DPI px). Illustrator uses pt. A 100mm profile might appear as 377.95 user units.
- **Transform stacking:** Some editors nest `<g>` elements with `transform` attributes. The path coordinates are in local space, not document space.
- **Path shorthand:** `M10-20A5.5.3-4 110-.1` is valid SVG path syntax. Implicit line segments, relative commands, shorthand curves.
- **Multiple paths:** User submits an SVG with multiple `<path>` elements, guides, artboard boundaries, or text objects -- only ONE path should be the profile.
- **Reversed direction:** The profile might be drawn right-to-left (rim to foot) instead of bottom-to-top (foot to rim).
- **Closed vs open paths:** A profile should be an open path (half cross-section), but users might draw a closed shape.
- **viewBox vs width/height mismatch:** The coordinate space defined by `viewBox` may not match the `width`/`height` attributes, requiring scaling.

**Why it happens:**
The SVG specification is extremely flexible. Every editor has different defaults for units, coordinate systems, and path representation. ShapeCast requires Inkscape specifically and provides templates to avoid this -- but this project aims to accept SVGs from any source.

**How to avoid:**
- **Flatten all transforms:** Before extracting path data, recursively resolve all `transform` attributes on parent elements.
- **Parse units explicitly:** Detect the document unit from `width`/`height` attributes (mm, px, pt, in). Convert to mm using the correct DPI factor (CSS standard: 96 DPI for px, 72 DPI for pt).
- **Handle viewBox scaling:** If `viewBox` is present, compute the scale factor between viewBox coordinates and physical document dimensions.
- **Extract only `<path>` elements:** Ignore `<rect>`, `<circle>`, `<text>`, `<g>` (after flattening transforms). If multiple paths exist, let the user select which one is the profile.
- **Normalize path commands:** Convert all relative commands to absolute. Expand shorthand curves. Convert arcs to cubic beziers for consistent handling.
- **Detect and handle path direction:** Check if the profile goes from bottom-left to top (correct) or reversed. Offer to auto-flip.
- **Provide an SVG template:** Like ShapeCast, offer a downloadable template SVG with the correct units, orientation, and axis markings.
- **Show the parsed profile before generation:** Display the extracted profile with dimensions so the user can verify it was interpreted correctly.

**Warning signs:**
- Profile appears 10x too large or too small after import
- Profile is rotated or mirrored
- Import produces hundreds of tiny line segments instead of smooth curves
- Multiple profiles detected where only one was expected

**Phase to address:** Phase 2 (SVG Import) -- this is an entire feature with its own edge case handling. Do not treat it as "just a file upload."

**Confidence:** MEDIUM -- SVG spec issues verified via [W3C SVG coordinates spec](https://www.w3.org/TR/SVG11/coords.html) and [Inkscape units documentation](https://inkscape.gitlab.io/extensions/documentation/authors/units.html). Editor-specific behavior is based on broad community reports. Specific edge cases need hands-on testing with files from each editor.

---

### Pitfall 9: Slip Well Dimensions Produce Unusable Moulds

**Severity:** HIGH

**What goes wrong:**
The slip well (funnel on top of the inner mould where liquid clay is poured) is:
- **Too small:** Slip runs out before the cast wall reaches desired thickness. User has to keep topping up, risking uneven wall thickness and visible pour lines.
- **Too large:** Wastes material, makes the inner mould top-heavy, may not fit within the outer mould boundary.
- **Wrong shape:** Sharp edges create stress concentrations in the 3D print. Transitions between pot form and well walls are abrupt, causing delamination in plaster.

**Why it happens:**
The slip well size depends on the pot volume (more volume needs more slip to maintain a head of liquid during casting), the desired cast wall thickness, and the casting time. ShapeCast uses a "predetermined" slip well size, but the relationship between pot geometry and optimal well size is not trivial.

**How to avoid:**
- Default slip well height to 25-40mm (matches common mould-making practice for small/medium pots)
- Well diameter should match or exceed the rim opening diameter
- Add a slight taper (2-3 degrees outward) to the well walls so slip does not pool at the top edge
- Provide the well dimensions as a user-adjustable parameter with sensible defaults
- Fillet the transition between the pot profile and the well wall (minimum 2mm radius)
- Calculate and display estimated casting volume (well volume + pot cavity volume) so users know how much slip to prepare

**Warning signs:**
- Users report "slip keeps running out" during casting
- Well too tall relative to pot height (looks awkward, wastes print material)
- Sharp transition between pot rim and well causes cracking during use

**Phase to address:** Phase 2 (Mould Generation) -- slip well is generated as part of the inner mould.

**Confidence:** MEDIUM -- based on ShapeCast's approach (well is "predetermined") and general mould-making practice from [Ceramic Arts community](https://community.ceramicartsdaily.org/topic/24845-slip-casting-plaster-ratios/). Specific optimal ratios need validation with physical testing.

---

### Pitfall 10: Non-Manifold or Inverted STL Output

**Severity:** HIGH

**What goes wrong:**
The exported STL file has:
- **Flipped normals:** Some triangle faces point inward instead of outward. Slicing software (Cura, PrusaSlicer) gets confused about what is inside/outside the model, producing swiss-cheese infill or missing sections.
- **Non-manifold edges:** Edges shared by more than 2 triangles, or edges with only 1 triangle (holes in the mesh). Print fails or has missing walls.
- **Self-intersecting triangles:** Overlapping triangles from boolean operation artifacts. Slicers may crash or produce garbage G-code.
- **Degenerate triangles:** Zero-area triangles (three collinear vertices) that confuse slicers.

**Why it happens:**
OCCT's `BRepMesh_IncrementalMesh` tessellator can produce degenerate triangles near sharp edges, tangent surfaces, or boolean operation boundaries. If the underlying BREP geometry has issues (from pitfall #2), the mesh will inherit those issues. STL export via `StlAPI_Writer` does not automatically repair the mesh.

**How to avoid:**
- Run `BRepCheck_Analyzer` on the final BREP shape BEFORE tessellation
- Use appropriate deflection parameters for `BRepMesh_IncrementalMesh`: linear deflection 0.1mm (good quality, reasonable file size), angular deflection 0.5 radians
- After tessellation, validate the mesh: check for consistent normals, manifold edges, no degenerate triangles
- Implement a post-processing step that flips inverted normals and removes degenerate triangles
- Test every exported STL in at least one slicer (PrusaSlicer) as part of development QA
- Consider offering a "repair mesh" option that runs basic fixing (remove degenerate faces, unify normals)

**Warning signs:**
- Slicer shows "X errors found" when opening the STL
- Preview in slicer shows holes or see-through sections
- Print has missing walls or weird internal structures
- File opens in one slicer but fails in another

**Phase to address:** Phase 2 (File Export) with ongoing validation in all subsequent phases.

**Confidence:** HIGH -- STL issues well-documented across [Sculpteo non-manifold guide](https://www.sculpteo.com/en/3d-learning-hub/create-3d-file/fix-non-manifold-geometry/), [AMFG STL errors](https://amfg.ai/2018/04/19/top-5-stl-file-errors-you-should-know/), and OCCT mesh documentation.

---

## Medium-Severity Pitfalls

Mistakes that cause delays, poor UX, or technical debt.

### Pitfall 11: Plaster Calculation Inaccuracies

**Severity:** MEDIUM

**What goes wrong:**
The calculated plaster and water amounts are significantly wrong. The user mixes the suggested ratio but either:
- Runs out of plaster before the mould is full (cavity volume underestimated)
- Has too much plaster left over (volume overestimated, minor issue but wastes material)
- Uses the wrong water-to-plaster ratio, producing plaster that is too soft (absorbs too fast, wears out quickly) or too hard (does not absorb well enough for casting)

**Why it happens:**
The mould cavity volume must be calculated as: `(outer mould interior volume) - (inner mould exterior volume)`. This is the PLASTER volume, not the pot volume. If the calculation uses the pot volume or the mould exterior volume, it will be wrong. Additionally, standard pottery plaster (No. 1 Pottery Plaster) uses a ratio of 100 parts plaster to 70 parts water by weight -- but the exact ratio varies by plaster brand, desired hardness, and intended use.

**How to avoid:**
- Calculate cavity volume from the actual generated geometry (subtract inner from outer solid, compute volume)
- Use OCCT's `GProp_GProps` to compute exact solid volumes from BREP shapes
- Default to 100:70 plaster-to-water ratio (No. 1 Pottery Plaster) with the option to change
- Add 10% overage to the recommendation ("mix at least X grams, this gives 10% extra for spillage")
- Display the calculation breakdown: cavity volume in mL, plaster weight in grams, water weight in grams
- Warn that plaster density and ratio affect mould quality -- link to educational content

**Warning signs:**
- Users consistently report "not enough plaster" or "way too much plaster"
- Calculated volumes do not match when verified with simple shapes (cylinder mould = easy to calculate by hand)

**Phase to address:** Phase 3 (Plaster Calculator) -- depends on geometry being finalized first.

**Confidence:** MEDIUM -- plaster ratios verified via [Ceramic Arts community](https://community.ceramicartsdaily.org/topic/24845-slip-casting-plaster-ratios/) and [Glazy plaster calculator](https://plaster.glazy.org/). Volume calculation method is standard OCCT usage but needs hands-on validation.

---

### Pitfall 12: Tessellation Quality vs. File Size Tradeoff

**Severity:** MEDIUM

**What goes wrong:**
- **Too fine tessellation:** STL files become 50-200MB for a mould set. Users cannot email them, upload to cloud slicers, or open them on low-RAM computers. Download takes too long in the browser, and blob URL creation may exceed browser memory limits.
- **Too coarse tessellation:** Curved surfaces appear faceted/angular. The mould has visible ridges from tessellation rather than smooth curves. Print quality suffers.

**Why it happens:**
OCCT's `BRepMesh_IncrementalMesh` takes linear deflection and angular deflection parameters. Developers either use very small deflection (high quality, huge files) or very large deflection (fast, ugly results) without understanding the tradeoff.

**How to avoid:**
- Use linear deflection of 0.1mm and angular deflection of 0.5 radians as defaults -- this produces good quality at reasonable file size for typical mould geometry (50-100mm scale)
- Calculate estimated file size BEFORE export and warn if >50MB
- Offer a quality slider: "Draft" (0.5mm deflection, fast), "Standard" (0.1mm, default), "High" (0.05mm, large files)
- For Three.js preview, use coarser tessellation (0.5mm) for real-time responsiveness
- Use binary STL format (not ASCII) -- ~5x smaller
- Consider offering STL compression (gzip) for download

**Warning signs:**
- STL files routinely exceed 50MB for simple pots
- Preview rendering is slow (>1 second per frame) due to too many triangles
- Users cannot open files in their slicer (memory errors)
- Curved surfaces show visible faceting in the print

**Phase to address:** Phase 2 (File Export) -- establish the right defaults early.

**Confidence:** MEDIUM -- general OCCT mesh guidance from [OCCT Mesh docs](https://dev.opencascade.org/doc/occt-7.5.0/overview/html/occt_user_guides__mesh.html). Specific optimal values for this domain need testing with actual mould geometry.

---

### Pitfall 13: Outer Mould Splitting Creates Unprintable Halves

**Severity:** MEDIUM

**What goes wrong:**
When the outer mould is split into halves (or quarters) for demolding:
- The split plane intersects with ridges or grooves, creating malformed features at the seam
- Half/quarter pieces do not sit flat on the print bed (no flat bottom face)
- The split creates thin walls or overhangs that require excessive support material
- Registration features (so halves align with each other) are missing or insufficient

**Why it happens:**
Simply cutting a cylindrical shell in half with a boolean plane seems straightforward, but the cut may intersect with assembly features (ridges, grooves) at unfortunate angles. Additionally, the resulting halves need to be printable -- meaning they need a flat face to sit on the print bed.

**How to avoid:**
- Plan the split plane to avoid intersecting with ridges/grooves -- place assembly features AWAY from the split line
- Ensure each split piece has at least one flat face suitable for print-bed orientation
- Add registration keys or pins along the split line so halves align precisely
- Verify that no wall section in the split pieces is thinner than 1.5mm
- For quarter splits, ensure all four pieces are identical (rotational symmetry) to simplify printing
- Generate print orientation guidance for each piece

**Warning signs:**
- Boolean cut for splitting fails (intersects with existing features)
- Split pieces have no obvious flat face for printing
- Walls near the split line are thinner than elsewhere
- Halves/quarters do not reassemble into a perfect circle

**Phase to address:** Phase 2 (Outer Mould Generation).

**Confidence:** MEDIUM -- based on understanding of ShapeCast's approach (halves/quarters) and general 3D printing design guidelines. Specific split algorithms need prototyping.

---

### Pitfall 14: Confusing UX for Non-Technical Users

**Severity:** MEDIUM

**What goes wrong:**
The app exposes too many technical parameters (FuzzyValue, deflection, clearance, draft angle) to users who are potters, not engineers. Users do not understand:
- What "wall thickness" means in this context (mould wall? pot wall? 3D print wall?)
- The difference between "finished size" and "wet size" and why shrinkage matters
- Why they need to know their printer's tolerance
- What units the measurements are in (mm? cm? inches?)
- What the preview is showing them (the pot? the mould? the mould assembly?)

**Why it happens:**
Developers expose internal parameters because they think "more control is better." But the target user (studio potter) wants to input pot dimensions and get printable files. They do not want to think about CAD tolerances.

**How to avoid:**
- **Minimize exposed parameters.** Core inputs: pot profile (draw or upload), desired finished size, clay shrinkage %. Everything else should have smart defaults.
- **Use pottery language, not CAD language.** "Pot wall thickness" not "offset distance." "How much your clay shrinks" not "shrinkage coefficient."
- **Show the pot, not the mould, as the primary preview.** The user cares about what their finished pot looks like. Show the mould only when they ask for it or switch tabs.
- **Clear unit display.** Always show units next to every number. Support mm/inches toggle. Never show bare numbers.
- **Progressive disclosure.** Basic mode: 3 inputs. Advanced mode: all the knobs. Default to basic.
- **Preview of what they will GET.** Before download, show: "You will receive: 1 inner mould (prints in ~2h), 2 outer mould halves (print in ~1.5h each), 1 ring (prints in ~30min). Total plaster needed: 1.2kg."

**Warning signs:**
- Users ask "what does this parameter mean?" frequently
- High bounce rate on the generation page
- Users generate files but never print them (confused about next steps)
- Support requests about units or terminology

**Phase to address:** Phase 1 (UI/UX Design) -- establish the interaction model before building features. Revisit in every phase.

**Confidence:** HIGH -- validated by ShapeCast's UX observations (users struggled with Inkscape requirement) and general parametric tool UX patterns. The existing pottery-template-pot app handles this well with its simple state model.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip `.delete()` calls during prototyping | Faster initial development | Memory leaks make production unusable, retrofitting is painful | Never in geometry engine; acceptable in throwaway prototypes only |
| Run OCCT on main thread | Simpler architecture, no worker messaging | UI freezes kill the "live preview" promise, requires rewrite to fix | Phase 1 proof-of-concept only, must migrate to worker before any user testing |
| Hardcode clearance/tolerance values | Faster to ship | Does not work on all printers, user complaints, impossible to fix without parameter | Never -- make it configurable from day one, even if hidden in advanced settings |
| Use default OCCT tessellation | No need to tune mesh quality | Giant STL files or ugly faceted surfaces | Acceptable for initial testing, must tune before file export feature ships |
| Support only one SVG editor format | Simplifies parsing | Users with other editors are excluded, support burden | Acceptable for MVP if you document "use Inkscape" like ShapeCast does |
| Skip input validation | Generate faster | Crashes, garbage geometry, silent failures that confuse users | Never for user-facing inputs |

## Integration Gotchas

Common mistakes when connecting to external services and libraries.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| OpenCASCADE.js WASM | Loading synchronously on main thread, blocking page render | Load in Web Worker, show progressive UI, cache with Service Worker |
| OpenCASCADE.js API | Not passing explicit parameters (C++ defaults not available in JS bindings) | Always provide ALL function parameters explicitly, including `Message_ProgressRange` objects |
| Three.js + OCCT mesh | Creating Three.js geometry from OCCT mesh by iterating faces (slow) | Transfer vertex/index arrays as typed arrays from worker, create BufferGeometry directly |
| STL binary export | Writing ASCII STL (huge files, slow parsing) | Always use binary STL writer; ASCII only for debugging |
| STEP export | Not setting application protocol version | Set `Interface_Static.SetCVal("write.step.schema", "AP214")` for maximum slicer compatibility |
| Supabase auth | Gating profile editing behind auth (friction kills conversion) | Auth only for download/save, not for editing or previewing |
| Blob URL downloads | Not revoking blob URLs after download (memory leak) | Call `URL.revokeObjectURL()` after download completes; for large files, consider StreamSaver.js |

## Performance Traps

Patterns that work with simple profiles but fail with complex ones.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Rebuilding ALL geometry on every slider change | UI freeze, choppy interaction | Debounce inputs (200ms), show lightweight Three.js preview instantly, run full OCCT in background | With any profile more complex than a cylinder |
| Tessellating at 0.01mm deflection | 100MB STL files, out of memory | Use 0.1mm for export, 0.5mm for preview | With any mould larger than ~80mm |
| Storing full mesh data in JavaScript arrays (not typed arrays) | GC pauses, high memory usage | Use Float32Array and Uint32Array for vertex/index data | At >100K triangles |
| Running boolean operations sequentially (inner, then outer, then ring) | Long total computation time (3-10 seconds) | Parallelize independent operations in separate workers, or batch sequential operations in one worker without yielding | When total compute exceeds 3 seconds |
| No caching of intermediate results | Full rebuild even when only one parameter changed | Cache revolve solid, only recompute what changed (e.g., wall thickness change does not need re-revolve) | With any interactive editing workflow |

## UX Pitfalls

Common user experience mistakes in this specific domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Showing mould geometry as primary preview | Potter cannot tell what their finished pot will look like | Show the fired pot as default preview, toggle to see mould assembly |
| Exposing shrinkage as a percentage without explanation | Users do not know their clay's shrinkage rate | Provide common clay body defaults (porcelain: 12-14%, stoneware: 10-12%, earthenware: 5-7%) as dropdown |
| Requiring SVG upload as the only input method | Non-technical users cannot create SVGs | Provide in-app profile drawing tool as primary input, SVG upload as secondary |
| Not showing assembly instructions | Users download files but do not know how to use them | Include assembly guide (PDF or in-app) showing how to assemble parts, pour plaster, and demould |
| No print time estimates | Users do not know if generation is worth their time | Estimate print time based on mould volume and layer height, display before download |
| Using generic 3D viewer controls | Potters unfamiliar with orbit/pan/zoom may get "lost" in 3D space | Constrain camera: turntable orbit only, auto-center on model, reset view button prominent |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Profile Editor:** Often missing validation that the profile does not self-intersect or have undercuts -- verify by testing with C-shaped profiles and profiles that cross the axis
- [ ] **Revolve Operation:** Often missing check that the profile does not touch/cross the revolution axis except at designated points (foot center) -- verify with profiles that dip below y=0 or cross x=0
- [ ] **Boolean Operations:** Often missing error handling -- verify that failures do not crash the app but show a user-friendly message with guidance to fix the profile
- [ ] **STL Export:** Often missing manifold validation -- verify every exported STL opens without errors in PrusaSlicer AND Cura
- [ ] **STEP Export:** Often missing application protocol setting -- verify STEP files open in FreeCAD and Fusion 360
- [ ] **Plaster Calculations:** Often missing the "empty volume" calculation (it calculates mould SOLID volume, not the CAVITY for plaster) -- verify calculation matches hand calculation for a simple cylinder mould
- [ ] **Assembly Clearance:** Often missing different clearance for different axes (X/Y vs Z for FDM printers) -- verify ridge fits into groove on an actual 3D print
- [ ] **Unit Consistency:** Often mixing mm and cm in different parts of the codebase -- verify all internal calculations use mm, display adapts to user's chosen unit
- [ ] **Mobile Responsiveness:** Often missing touch-friendly 3D controls and adequately sized input fields -- verify on an actual phone, not just a resized browser window

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Memory leaks in production | MEDIUM | Add `.delete()` calls throughout codebase; implement allocation tracking; add "reset" button that reloads WASM module |
| Boolean operations failing for specific profiles | LOW | Add error handling with user-facing message: "This profile is too complex. Try simplifying curves near [highlighted area]." Fall back to server-side generation if available. |
| Parts do not fit (tolerance wrong) | HIGH | Requires adding clearance parameter, regenerating all geometry, retesting. Cannot fix for already-downloaded files. Add "printer calibration" feature to help users find their optimal clearance. |
| SVG parsing fails for specific editor | MEDIUM | Add specific parser rules for the failing editor format. Provide downloadable template SVG. Document supported editors. |
| STL has manifold errors | LOW | Add post-export mesh repair step. Recommend users run files through Meshmixer auto-repair if issues persist. |
| Plaster calculations wrong | LOW | Fix formula, add verification tests. Issue correction notice to affected users if possible. |
| WASM load too slow | MEDIUM | Create custom build with fewer modules. Add Service Worker caching. Implement lazy loading. |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| #1 Memory leaks | Phase 1 (Architecture) | Monitor WASM heap size during automated testing; memory should not grow after regeneration cycle |
| #2 Boolean operation failures | Phase 1 (Geometry Engine) | Unit tests with known-tricky profiles (sharp corners, thin walls, tangent faces) |
| #3 Parts do not fit | Phase 2 (Assembly Features) | Physical test print of mould set; parts should assemble by hand without tools |
| #4 Invalid profiles | Phase 1 (Profile Editor) | Test with intentionally bad profiles: self-intersecting, undercut, axis-crossing, zero-width |
| #5 Shrinkage direction | Phase 1 (Geometry Engine) | Unit test: 100mm input, 13% shrinkage = 114.94mm mould dimension (not 113mm) |
| #6 WASM loading slow | Phase 1 (Infrastructure) | Lighthouse audit: Time to Interactive < 5 seconds on 4G connection |
| #7 UI blocking | Phase 1 (Architecture) | No main-thread tasks > 50ms during geometry generation (verified via Performance tab) |
| #8 SVG format chaos | Phase 2 (SVG Import) | Test with files from Inkscape, Illustrator, Figma, hand-coded SVG |
| #9 Slip well sizing | Phase 2 (Mould Generation) | Physical test: pour slip into assembled mould, verify well is adequate |
| #10 Bad STL output | Phase 2 (File Export) | Every exported STL passes PrusaSlicer's auto-repair with 0 errors |
| #11 Plaster calculation | Phase 3 (Calculator) | Hand-verify calculation for cylinder mould (easy math) |
| #12 Tessellation tradeoff | Phase 2 (File Export) | STL file size < 20MB for typical mould set; no visible faceting at print scale |
| #13 Outer mould splitting | Phase 2 (Mould Generation) | Boolean split succeeds without intersecting assembly features |
| #14 Confusing UX | All Phases | Usability test with 3 potters who have never used CAD software |

## Sources

### Official Documentation (HIGH confidence)
- [OpenCASCADE Boolean Operations Specification](https://dev.opencascade.org/doc/overview/html/specification__boolean_operations.html)
- [OpenCASCADE Shape Healing Guide](https://dev.opencascade.org/doc/overview/html/occt_user_guides__shape_healing.html)
- [OpenCASCADE Mesh Guide](https://dev.opencascade.org/doc/occt-7.5.0/overview/html/occt_user_guides__mesh.html)
- [OpenCASCADE STEP Translator](https://dev.opencascade.org/doc/overview/html/occt_user_guides__step.html)
- [BRepPrimAPI_MakeRevol Reference](https://dev.opencascade.org/doc/refman/html/class_b_rep_prim_a_p_i___make_revol.html)
- [opencascade.js File Size Docs](https://ocjs.org/docs/getting-started/file-size)
- [W3C SVG Coordinates and Units](https://www.w3.org/TR/SVG11/coords.html)
- [V8 Blog: 4GB WASM Memory](https://v8.dev/blog/4gb-wasm-memory)

### GitHub Issues and Discussions (HIGH confidence)
- [opencascade.js Discussion #186: Memory Leaks / Lifetime Best Practices](https://github.com/donalffons/opencascade.js/discussions/186)
- [opencascade.js Issue #50: Fix Memory Leaks in Examples](https://github.com/donalffons/opencascade.js/issues/50)
- [opencascade.js Discussion #143: Boolean Operations Trouble](https://github.com/donalffons/opencascade.js/discussions/143)
- [opencascade.js Discussion #27: Way Forward (File Size, Custom Builds)](https://github.com/donalffons/opencascade.js/discussions/27)

### Research Papers (HIGH confidence)
- [ShapeCast CHI 2024 Paper](https://inovo.studio/pubs/shapecast-chi24.pdf)
- [ShapeCast CHI 2025 Paper](https://dl.acm.org/doi/10.1145/3706598.3713866)

### 3D Printing Guides (MEDIUM confidence)
- [Formlabs: 3D Printing Tolerances Guide](https://formlabs.com/blog/understanding-accuracy-precision-tolerance-in-3d-printing/)
- [Sculpteo: 3D Printing Tolerances](https://www.sculpteo.com/en/3d-learning-hub/design-guidelines/3d-printing-tolerances/)
- [Protolabs: 7 Mistakes to Avoid in 3D Printed Parts](https://www.protolabs.com/resources/design-tips/7-mistakes-to-avoid-when-designing-3d-printed-parts/)
- [Sculpteo: Fix Non-Manifold Geometry](https://www.sculpteo.com/en/3d-learning-hub/create-3d-file/fix-non-manifold-geometry/)

### Ceramics Community (MEDIUM confidence)
- [Ceramic Arts Network: 10 Slip-Casting Problems](https://ceramicartsnetwork.org/daily/article/10-slip-casting-problems-and-how-to-solve-them)
- [Ceramic Arts Community: Plaster Ratios](https://community.ceramicartsdaily.org/topic/24845-slip-casting-plaster-ratios/)
- [Glazy Plaster Calculator](https://plaster.glazy.org/)
- [DigitalFire: Coffee Mug Slip Casting Mold Project](https://digitalfire.com/project/60)

### Web Performance (MEDIUM confidence)
- [The New Stack: WebAssembly and Web Workers Prevent UI Freezes](https://thenewstack.io/for-darryl-webassembly-and-web-workers/)
- [web.dev: WebAssembly Threads](https://web.dev/articles/webassembly-threads)
- [Inkscape Units Documentation](https://inkscape.gitlab.io/extensions/documentation/authors/units.html)
- [SVG Path Parsing Notes](https://razrfalcon.github.io/notes-on-svg-parsing/path-data.html)

---
*Pitfalls research for: Browser-based 3D slip casting mould generator*
*Researched: 2026-02-10*
