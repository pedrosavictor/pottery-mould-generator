/**
 * preview3d.js -- Three.js 3D preview renderer for the mould generator.
 *
 * This module manages the Three.js scene that displays revolved mesh data
 * from the geometry worker. It handles scene setup, lighting, orbit controls,
 * mesh updates, and resource disposal.
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
 * The geometry worker revolves profiles on the XZ plane around the Z axis.
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

/** @type {THREE.Mesh|null} Current displayed mesh, tracked for disposal. */
let currentMesh = null;

/** @type {number|null} requestAnimationFrame ID for cleanup. */
let animFrameId = null;

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
 * Update the displayed mesh with new geometry data from the worker.
 *
 * Disposes the previous mesh (geometry + material) to prevent Three.js
 * memory leaks, then creates a new BufferGeometry from the provided data.
 *
 * Handles both typed arrays (Float32Array/Uint32Array from Transferable)
 * and regular number[] arrays (defensive -- convert if needed).
 *
 * @param {{ vertices: Float32Array|number[], normals: Float32Array|number[], triangles: Uint32Array|number[] }} meshData
 *   Mesh data from geometryBridge.revolveProfile().
 */
export function updateMesh(meshData) {
  if (!scene) {
    console.warn('[preview3d] Scene not initialized. Call initScene() first.');
    return;
  }

  // Dispose previous mesh
  if (currentMesh) {
    scene.remove(currentMesh);
    currentMesh.geometry.dispose();
    currentMesh.material.dispose();
    currentMesh = null;
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

  // Terra cotta material
  const material = new THREE.MeshStandardMaterial({
    color: 0xc2956b,
    roughness: 0.7,
    metalness: 0.1,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 2.0,
    polygonOffsetUnits: 1.0,
  });

  currentMesh = new THREE.Mesh(geometry, material);
  scene.add(currentMesh);
}

/**
 * Remove the current mesh from the scene and dispose its resources.
 */
export function clearMesh() {
  if (!scene || !currentMesh) return;

  scene.remove(currentMesh);
  currentMesh.geometry.dispose();
  currentMesh.material.dispose();
  currentMesh = null;
}

/**
 * Returns the WebGL renderer instance for testing/debugging.
 *
 * @returns {THREE.WebGLRenderer|null}
 */
export function getRenderer() {
  return renderer;
}
