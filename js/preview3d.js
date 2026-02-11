/**
 * preview3d.js -- Three.js 3D preview renderer for the mould generator.
 *
 * This module manages the Three.js scene that displays revolved mesh data
 * from the geometry worker. It handles scene setup, lighting, orbit controls,
 * mesh updates, and resource disposal.
 *
 * ARCHITECTURE:
 * -------------
 * Two mesh sources feed into the scene:
 *   1. LatheGeometry fallback -- instant preview from profile points (~1ms).
 *      Created by revolving a polyline (with bezier curves sampled to line
 *      segments) around the Y axis using THREE.LatheGeometry.
 *   2. WASM mesh -- high-fidelity CAD geometry from the replicad worker.
 *      Arrives asynchronously via updatePartMesh() with Float32Array data.
 *
 * The part manager tracks named 3D objects (e.g., 'pot', future 'mould-top',
 * 'mould-bottom') with independent visibility. Each part is a THREE.Group
 * containing one or more meshes.
 *
 * IMPORT MAP DEPENDENCY:
 * ----------------------
 * This module imports Three.js via import map specifiers (defined in index.html):
 *   "three" -> https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.module.js
 *   "three/addons/" -> https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/
 *
 * The import map MUST be defined in the HTML before this module loads.
 *
 * COORDINATE SYSTEM:
 * ------------------
 * LatheGeometry revolves around the Y axis. Profile points use x=radius (mm),
 * y=height (mm). This matches the existing scene orientation (camera looking
 * at Y=42, grid on XZ plane).
 *
 * The WASM geometry worker revolves profiles on the XZ plane around the Z axis.
 * Three.js uses Y-up by default. The mesh data comes from replicad with:
 *   X = radial distance, Y = across (other radial), Z = height
 * So the pot stands upright along the Z axis in the scene.
 *
 * NO DOM CREATION. The container element must exist before initScene() is called.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ============================================================
// Module state (initialized by initScene)
// ============================================================

/** @type {THREE.Scene|null} */
let scene = null;

/** @type {THREE.PerspectiveCamera|null} */
let camera = null;

/** @type {THREE.WebGLRenderer|null} */
let renderer = null;

/** @type {OrbitControls|null} */
let controls = null;

/** @type {number|null} requestAnimationFrame ID for cleanup. */
let animFrameId = null;

// ============================================================
// Part Manager
// ============================================================

/**
 * Named parts in the scene. Each part is a group containing meshes.
 * @type {Map<string, { group: THREE.Group, meshes: THREE.Mesh[] }>}
 */
const parts = new Map();

/**
 * Shared terra cotta material settings. Each mesh gets its own instance
 * (required for independent disposal), but all share these parameters.
 */
const TERRA_COTTA_PARAMS = {
  color: 0xc2956b,
  roughness: 0.7,
  metalness: 0.1,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: 2.0,
  polygonOffsetUnits: 1.0,
};

/**
 * Blue-grey material for mould parts (inner-mould, outer-mould).
 * Semi-transparent so the pot shape is visible through the mould.
 */
const MOULD_MATERIAL_PARAMS = {
  color: 0x8899aa,
  roughness: 0.5,
  metalness: 0.2,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: 2.0,
  polygonOffsetUnits: 1.0,
  transparent: true,
  opacity: 0.85,
};

/**
 * Lighter warm tone for the proof model (ghost of the pot).
 * 50% opacity to distinguish it from the solid pot rendering.
 */
const PROOF_MATERIAL_PARAMS = {
  color: 0xb8a088,
  roughness: 0.8,
  metalness: 0.05,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: 2.0,
  polygonOffsetUnits: 1.0,
  transparent: true,
  opacity: 0.5,
};

/**
 * Create a fresh terra cotta material instance.
 * @returns {THREE.MeshStandardMaterial}
 */
function createTerraCottaMaterial() {
  return new THREE.MeshStandardMaterial(TERRA_COTTA_PARAMS);
}

/**
 * Create the appropriate material for a named part.
 *
 * @param {string} partName - Part name (e.g., 'pot', 'inner-mould', 'proof').
 * @returns {THREE.MeshStandardMaterial}
 */
function createMaterialForPart(partName) {
  if (partName.startsWith('inner-mould') || partName.startsWith('outer-') || partName.startsWith('ring-')) {
    return new THREE.MeshStandardMaterial(MOULD_MATERIAL_PARAMS);
  }
  if (partName === 'proof') {
    return new THREE.MeshStandardMaterial(PROOF_MATERIAL_PARAMS);
  }
  return createTerraCottaMaterial();
}

// ============================================================
// Bezier Curve Sampling
// ============================================================

/**
 * Sample a cubic bezier curve at evenly-spaced parameter values.
 *
 * Uses the standard cubic bezier formula:
 *   B(t) = (1-t)^3*P0 + 3*(1-t)^2*t*CP1 + 3*(1-t)*t^2*CP2 + t^3*P1
 *
 * Returns intermediate points only (excludes p0, includes p1 at t=1).
 *
 * @param {{ x: number, y: number }} p0 - Start point.
 * @param {{ x: number, y: number }} p1 - End point.
 * @param {{ x: number, y: number }} cp1 - First control point.
 * @param {{ x: number, y: number }} cp2 - Second control point.
 * @param {number} [numSamples=10] - Number of intermediate samples.
 * @returns {THREE.Vector2[]} Array of sampled points (excludes p0).
 */
function sampleBezierCurve(p0, p1, cp1, cp2, numSamples = 10) {
  const points = [];
  for (let i = 1; i <= numSamples; i++) {
    const t = i / numSamples;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;
    const t2 = t * t;
    const t3 = t2 * t;

    const x = mt3 * p0.x + 3 * mt2 * t * cp1.x + 3 * mt * t2 * cp2.x + t3 * p1.x;
    const y = mt3 * p0.y + 3 * mt2 * t * cp1.y + 3 * mt * t2 * cp2.y + t3 * p1.y;

    points.push(new THREE.Vector2(x, y));
  }
  return points;
}

// ============================================================
// Profile to Vector2 Conversion
// ============================================================

/**
 * Convert profile points to a THREE.Vector2 array suitable for LatheGeometry.
 *
 * For line segments: adds the endpoint directly.
 * For bezier segments: samples the cubic bezier at 10 intermediate points
 * to approximate the curve with line segments.
 *
 * @param {Array<{ x: number, y: number, type: string, cp1?: { x: number, y: number }, cp2?: { x: number, y: number } }>} profilePoints
 * @returns {THREE.Vector2[]}
 */
function profileToVector2Array(profilePoints) {
  if (!profilePoints || profilePoints.length === 0) return [];

  const vector2s = [];

  // Add the first point
  vector2s.push(new THREE.Vector2(profilePoints[0].x, profilePoints[0].y));

  // Process each subsequent segment
  for (let i = 1; i < profilePoints.length; i++) {
    const prev = profilePoints[i - 1];
    const curr = profilePoints[i];

    if (curr.type === 'bezier' && curr.cp1 && curr.cp2) {
      // Sample the bezier curve (excludes prev, includes curr)
      const sampled = sampleBezierCurve(prev, curr, curr.cp1, curr.cp2, 10);
      vector2s.push(...sampled);
    } else {
      // Line segment -- just add the endpoint
      vector2s.push(new THREE.Vector2(curr.x, curr.y));
    }
  }

  return vector2s;
}

// ============================================================
// Internal Part Management
// ============================================================

/**
 * Dispose all meshes in a part entry and remove its group from the scene.
 * @param {{ group: THREE.Group, meshes: THREE.Mesh[] }} partEntry
 */
function disposePart(partEntry) {
  for (const mesh of partEntry.meshes) {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  if (scene) {
    scene.remove(partEntry.group);
  }
  partEntry.meshes.length = 0;
}

// ============================================================
// Public API
// ============================================================

/**
 * Initialize the Three.js scene inside the given DOM container.
 *
 * Sets up the scene, camera, renderer, orbit controls, lighting, and grid.
 * Starts the animation loop. Adds a window resize handler.
 *
 * Safe to call only once. Subsequent calls are no-ops (returns existing renderer).
 *
 * @param {HTMLElement} container - DOM element to render into.
 * @returns {THREE.WebGLRenderer} The renderer instance.
 */
export function initScene(container) {
  if (renderer) return renderer;

  // --- Scene ---
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f0eb); // cream

  // --- Camera ---
  const width = container.clientWidth || 800;
  const height = container.clientHeight || 600;
  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
  camera.position.set(0, 80, 250);

  // --- Renderer ---
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(width, height);
  container.appendChild(renderer.domElement);

  // --- Orbit Controls ---
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.target.set(0, 42, 0); // center of cup profile height
  controls.update();

  // --- Lighting ---
  // Ambient fill
  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambient);

  // Key light (upper right front)
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
  keyLight.position.set(150, 200, 100);
  scene.add(keyLight);

  // Fill light (upper left back)
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
  fillLight.position.set(-100, 100, -50);
  scene.add(fillLight);

  // --- Grid Helper ---
  // Subtle grid on XZ plane for spatial reference
  const grid = new THREE.GridHelper(200, 20, 0xcccccc, 0xdddddd);
  scene.add(grid);

  // --- Animation Loop ---
  function animate() {
    animFrameId = requestAnimationFrame(animate);
    controls.update(); // required for damping
    renderer.render(scene, camera);
  }
  animate();

  // --- Resize Handler ---
  function onResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);

  return renderer;
}

/**
 * Update the LatheGeometry fallback preview from profile points.
 *
 * This is the instant preview path (~1ms). It converts profile points to a
 * polyline (sampling bezier curves), creates a LatheGeometry by revolving
 * around the Y axis, and stores the result as the 'pot' part.
 *
 * If a WASM-generated 'pot' part already exists, this replaces it with the
 * lighter LatheGeometry version. The caller is responsible for upgrading
 * back to WASM quality when the worker result arrives.
 *
 * @param {Array<{ x: number, y: number, type: string, cp1?: object, cp2?: object }>} profilePoints
 *   Profile points from profileData.js (x=radius mm, y=height mm).
 */
export function updateLatheFallback(profilePoints) {
  if (!scene) {
    console.warn('[preview3d] Scene not initialized. Call initScene() first.');
    return;
  }

  if (!profilePoints || profilePoints.length < 2) {
    console.warn('[preview3d] Need at least 2 profile points for LatheGeometry.');
    return;
  }

  // Convert profile to Vector2 array
  const vector2s = profileToVector2Array(profilePoints);
  if (vector2s.length < 2) return;

  // Dispose existing 'pot' part if present
  if (parts.has('pot')) {
    disposePart(parts.get('pot'));
    parts.delete('pot');
  }

  // Create LatheGeometry (64 radial segments for smooth surface)
  const geometry = new THREE.LatheGeometry(vector2s, 64);
  const material = createTerraCottaMaterial();
  const mesh = new THREE.Mesh(geometry, material);

  // Wrap in a group for consistent part manager structure
  const group = new THREE.Group();
  group.add(mesh);
  scene.add(group);

  parts.set('pot', { group, meshes: [mesh] });
}

/**
 * Update a named part's mesh with BufferGeometry data from the worker.
 *
 * Disposes any previous mesh for this part, then creates a new BufferGeometry
 * from the provided vertex/normal/triangle arrays (Float32Array/Uint32Array
 * from Transferable or regular number[]).
 *
 * @param {string} partName - Name of the part (e.g., 'pot', 'mould-top').
 * @param {{ vertices: Float32Array|number[], normals: Float32Array|number[], triangles: Uint32Array|number[] }} meshData
 *   Mesh data from geometryBridge.revolveProfile().
 */
export function updatePartMesh(partName, meshData) {
  if (!scene) {
    console.warn('[preview3d] Scene not initialized. Call initScene() first.');
    return;
  }

  // Dispose existing part if present
  if (parts.has(partName)) {
    disposePart(parts.get(partName));
    parts.delete(partName);
  }

  // Convert to typed arrays if needed (defensive)
  const vertices = meshData.vertices instanceof Float32Array
    ? meshData.vertices
    : new Float32Array(meshData.vertices);
  const normals = meshData.normals instanceof Float32Array
    ? meshData.normals
    : new Float32Array(meshData.normals);
  const triangles = meshData.triangles instanceof Uint32Array
    ? meshData.triangles
    : new Uint32Array(meshData.triangles);

  // Build BufferGeometry
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(triangles, 1));

  const material = createMaterialForPart(partName);
  const mesh = new THREE.Mesh(geometry, material);

  // Wrap in a group
  const group = new THREE.Group();
  group.add(mesh);
  scene.add(group);

  parts.set(partName, { group, meshes: [mesh] });
}

/**
 * Set visibility of a named part.
 *
 * @param {string} partName - Name of the part.
 * @param {boolean} visible - Whether the part should be visible.
 */
export function setPartVisibility(partName, visible) {
  const entry = parts.get(partName);
  if (entry) {
    entry.group.visible = visible;
  }
}

/**
 * Set visibility for all parts matching a name prefix.
 *
 * @param {string} prefix - Part name prefix (e.g., 'outer-' matches 'outer-front', 'outer-back').
 * @param {boolean} visible - Whether matching parts should be visible.
 */
export function setPartGroupVisibility(prefix, visible) {
  for (const [name, entry] of parts) {
    if (name.startsWith(prefix)) {
      entry.group.visible = visible;
    }
  }
}

/**
 * Remove and dispose all parts matching a name prefix.
 * Used when split count changes (halves -> quarters or vice versa).
 *
 * @param {string} prefix - Part name prefix to match.
 */
export function removePartsByPrefix(prefix) {
  for (const [name, entry] of parts) {
    if (name.startsWith(prefix)) {
      disposePart(entry);
      parts.delete(name);
    }
  }
}

/**
 * Dispose and remove all parts from the scene.
 */
export function clearAllParts() {
  for (const [name, entry] of parts) {
    disposePart(entry);
  }
  parts.clear();
}

/**
 * Update the displayed mesh with new geometry data from the worker.
 *
 * BACKWARD COMPATIBILITY wrapper. Calls updatePartMesh('pot', meshData).
 *
 * @param {{ vertices: Float32Array|number[], normals: Float32Array|number[], triangles: Uint32Array|number[] }} meshData
 *   Mesh data from geometryBridge.revolveProfile().
 */
export function updateMesh(meshData) {
  updatePartMesh('pot', meshData);
}

/**
 * Remove the current pot mesh from the scene and dispose its resources.
 *
 * BACKWARD COMPATIBILITY wrapper. Clears the 'pot' part.
 */
export function clearMesh() {
  if (parts.has('pot')) {
    disposePart(parts.get('pot'));
    parts.delete('pot');
  }
}

// ============================================================
// Exploded View
// ============================================================

/** Whether exploded view is active. */
let explodedView = false;

/**
 * Vertical offsets for parts in exploded view (mm).
 * When more parts are added (Phases 5-6), their offsets go here.
 */
const EXPLODED_OFFSETS = {
  'pot':          0,
  'inner-mould':  100,
  'outer-front':  200,
  'outer-back':   200,
  'outer-q1':     200,
  'outer-q2':     200,
  'outer-q3':     200,
  'outer-q4':     200,
  'ring-front':   -50,
  'ring-back':    -50,
  'ring-q1':      -50,
  'ring-q2':      -50,
  'ring-q3':      -50,
  'ring-q4':      -50,
  'proof':        300,
};

/**
 * Set exploded/assembled view mode.
 *
 * When exploded=true, each named part is offset vertically so all parts
 * are visible without overlap. When false, all parts return to y=0.
 *
 * Currently only the 'pot' part exists (y=0 in both modes). Future parts
 * added in Phases 5-6 will use the EXPLODED_OFFSETS table.
 *
 * @param {boolean} exploded - true for exploded, false for assembled.
 */
export function setExplodedView(exploded) {
  explodedView = exploded;

  for (const [name, entry] of parts) {
    const offset = exploded ? (EXPLODED_OFFSETS[name] || 0) : 0;
    entry.group.position.y = offset;
  }

  console.log(`[preview3d] View mode: ${exploded ? 'exploded' : 'assembled'}`);
}

// ============================================================
// 3D Measurement Annotations
// ============================================================

/** @type {THREE.Group|null} */
let measurementGroup = null;

/**
 * Create a text sprite from a string.
 *
 * Renders text onto a canvas, creates a texture, and returns a THREE.Sprite
 * positioned at the given 3D coordinates. This avoids extra dependencies
 * like CSS2DRenderer.
 *
 * @param {string} text - Label text.
 * @param {{ x: number, y: number, z: number }} position - World position.
 * @returns {THREE.Sprite}
 */
function createTextSprite(text, position) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // Size canvas to fit text
  const fontSize = 28;
  ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
  const metrics = ctx.measureText(text);
  const textWidth = metrics.width + 16;
  const textHeight = fontSize + 12;

  canvas.width = Math.ceil(textWidth);
  canvas.height = Math.ceil(textHeight);

  // Draw background
  ctx.fillStyle = 'rgba(45, 45, 45, 0.8)';
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 4);
  ctx.fill();

  // Draw text
  ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.fillStyle = '#f5f0eb';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;

  const material = new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    sizeAttenuation: false,
  });

  const sprite = new THREE.Sprite(material);
  sprite.position.set(position.x, position.y, position.z);

  // Scale to reasonable screen size (sizeAttenuation=false uses NDC units)
  const aspect = canvas.width / canvas.height;
  sprite.scale.set(0.08 * aspect, 0.08, 1);

  return sprite;
}

/**
 * Create a dashed line between two 3D points.
 *
 * @param {THREE.Vector3} start
 * @param {THREE.Vector3} end
 * @returns {THREE.Line}
 */
function createDashedLine(start, end) {
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
  const material = new THREE.LineDashedMaterial({
    color: 0x555555,
    dashSize: 3,
    gapSize: 2,
    linewidth: 1,
    depthTest: false,
  });
  const line = new THREE.Line(geometry, material);
  line.computeLineDistances();
  return line;
}

/**
 * Update 3D measurement annotations from profile points.
 *
 * Calculates height, rim diameter, max (belly) diameter, and foot diameter
 * from the profile point array. Creates dashed lines and text labels in 3D
 * space, all contained in a `measurementGroup` for easy show/hide.
 *
 * Coordinate note: LatheGeometry uses Y-up (x=radius, y=height).
 * Measurement lines are placed in the XY plane at z=0.
 *
 * @param {Array<{ x: number, y: number }>} profilePoints - Profile points.
 * @param {boolean} visible - Whether measurements should be shown.
 */
export function updateMeasurements(profilePoints, visible) {
  // Remove existing measurements
  if (measurementGroup) {
    measurementGroup.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    });
    if (scene) scene.remove(measurementGroup);
    measurementGroup = null;
  }

  if (!visible || !profilePoints || profilePoints.length < 2 || !scene) {
    return;
  }

  measurementGroup = new THREE.Group();
  measurementGroup.name = 'measurements';

  // Calculate dimensions from profile points
  let minY = Infinity, maxY = -Infinity;
  let maxX = 0;
  let maxXIndex = 0;

  for (let i = 0; i < profilePoints.length; i++) {
    const p = profilePoints[i];
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    if (p.x > maxX) {
      maxX = p.x;
      maxXIndex = i;
    }
  }

  const height = maxY - minY;
  const firstPt = profilePoints[0];
  const lastPt = profilePoints[profilePoints.length - 1];
  const rimRadius = lastPt.x;
  const footRadius = firstPt.x;
  const maxRadius = maxX;
  const bellyY = profilePoints[maxXIndex].y;

  const rimDiameter = rimRadius * 2;
  const footDiameter = footRadius * 2;
  const maxDiameter = maxRadius * 2;

  // Offset for height line (slightly outside the max radius)
  const hLineX = maxRadius + 15;

  // --- Height measurement line ---
  const hStart = new THREE.Vector3(hLineX, minY, 0);
  const hEnd = new THREE.Vector3(hLineX, maxY, 0);
  measurementGroup.add(createDashedLine(hStart, hEnd));

  // Height tick marks
  const tickLen = 5;
  measurementGroup.add(createDashedLine(
    new THREE.Vector3(hLineX - tickLen, minY, 0),
    new THREE.Vector3(hLineX + tickLen, minY, 0)
  ));
  measurementGroup.add(createDashedLine(
    new THREE.Vector3(hLineX - tickLen, maxY, 0),
    new THREE.Vector3(hLineX + tickLen, maxY, 0)
  ));

  // Height label at midpoint
  const hLabel = createTextSprite(
    `${height.toFixed(1)} mm`,
    { x: hLineX + 20, y: (minY + maxY) / 2, z: 0 }
  );
  measurementGroup.add(hLabel);

  // --- Rim diameter line ---
  const rimY = maxY;
  const rimStart = new THREE.Vector3(-rimRadius, rimY, 0);
  const rimEnd = new THREE.Vector3(rimRadius, rimY, 0);
  measurementGroup.add(createDashedLine(rimStart, rimEnd));

  // Rim label
  const rimLabel = createTextSprite(
    `${rimDiameter.toFixed(1)} mm dia`,
    { x: 0, y: rimY + 12, z: 0 }
  );
  measurementGroup.add(rimLabel);

  // --- Max (belly) diameter line (only if significantly wider than rim) ---
  if (maxDiameter > rimDiameter + 4) {
    const bellyStart = new THREE.Vector3(-maxRadius, bellyY, 0);
    const bellyEnd = new THREE.Vector3(maxRadius, bellyY, 0);
    measurementGroup.add(createDashedLine(bellyStart, bellyEnd));

    const bellyLabel = createTextSprite(
      `${maxDiameter.toFixed(1)} mm`,
      { x: 0, y: bellyY - 12, z: 0 }
    );
    measurementGroup.add(bellyLabel);
  }

  scene.add(measurementGroup);
}

/**
 * Returns the WebGL renderer instance for testing/debugging.
 *
 * @returns {THREE.WebGLRenderer|null}
 */
export function getRenderer() {
  return renderer;
}
