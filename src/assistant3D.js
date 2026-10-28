import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import gsap from 'gsap';
import { ALL_PROJECT_IMAGES } from './slidesData.js';

/**
 * ============================================================================
 * 3D ASSISTANT SYSTEM (`src/assistant3D.js`) — UPDATE V37 (COMPLETE EDITION)
 * Model: `/genshin_impact_-_nahida.glb` (High-Quality 2K Rigged Armature Model + Real-Time 2K Shadows)
 * Motions (Slide 1):
 *   1. `/change-pose-379001.fbx` (Motion 1 — Cute Change Pose)
 *   2. `/Excited.fbx` (Motion 2 — Excited Motion Only, Meshes/Materials Stripped & Disposed)
 *   3. `Zero-Snap 3-Stage Spin` (Anticipation -> 360° Pirouette -> Slerp Follow-Through Recovery)
 *
 * Core Architecture (Update V37):
 * 1. MOTION-ONLY `/Excited.fbx` EXTRACTION & EXPANDED `BONE_MAPPING_DICTIONARY`:
 *    - Completely replaces `f_h_magespellcast_05.fbx` with `/Excited.fbx` (`./Excited.fbx`).
 *    - Strips and disposes all Meshes, SkinnedMeshes, Geometries, and Materials inside `/Excited.fbx`
 *      so zero FBX mesh is ever added to the scene; only `fbx.animations[0]` and bone nodes are used.
 *    - Comprehensive Bone Mapping Dictionary (`mixamorig:`, `Bip01`, `Bip001`, `CC_Base_`, standard
 *      humanoid bone names `Hips`, `Spine`, `LeftArm`, `RightArm`, `LeftUpLeg`, `RightUpLeg`, etc.).
 * 2. 120FPS DLSS-STYLE QUATERNION SQUAD / CATMULL-ROM FRAME GENERATION (`upsampleAnimationClipTo120FPS`):
 *    - Resamples all `AnimationClip` tracks to `120 FPS` (`dt = 1 / 120s`).
 *    - Quaternion tracks use $C^1$-continuous Spherical Cubic / SQUAD SLERP across $(q_{i-1}, q_i, q_{i+1}, q_{i+2})$
 *      with Shortest-Path Hemisphere Lock ($q_i \cdot q_{i+1} \ge 0$) and light Gaussian smoothing ($\sigma = 0.85$).
 *    - Vector tracks (`Hips.position`) use Cubic Catmull-Rom Spline interpolation.
 *    - Real-time `requestAnimationFrame` Exponential Moving Average Quaternion Damping ($\alpha = 1 - e^{-22 \cdot \Delta t}$).
 * 3. SMOOTH NEUTRAL REST-POSE BRIDGE (`Return-to-Neutral 0.45s` + `Smooth Blend-In 0.40s`):
 *    - Quintic Ease-In-Out curve $s(t) = 6t^5 - 15t^4 + 10t^3$ lowers arms and brings legs back to
 *      the Natural Neutral A-Stand Pose (`0.45s`) at the end of each motion before immediately blending (`0.40s`)
 *      into the next action with zero pause.
 * 4. ZERO-SNAP 3-STAGE PROCEDURAL SPIN (`0.0s -> 2.10s`):
 *    - Stage A (`0.0s -> 0.55s`): `0.0s -> 0.25s` smooth `slerp` settle to Neutral Standing Pose, followed by
 *      `0.25s -> 0.55s` Spin Anticipation $w(t) = 0.5(1 - \cos(\pi t))$ (~8° knee dip, ~10°–12° side step,
 *      soft arm lift to hip/chest height, and 10° counter-rotation wind-up).
 *    - Stage B (`0.55s -> 1.55s`): Full $360^\circ$ ($2\pi$) pirouette along $\theta(u) = 2\pi(3u^2 - 2u^3)$ with
 *      centrifugal skirt & arm flare $\sin(\pi u)$ and graceful poised legs.
 *    - Stage C (`1.55s -> 2.10s`): Smooth `slerp` follow-through & recovery returning legs and arms to Neutral.
 * ============================================================================
 */

// Uniform 1.5x Scale Factor applied at `characterPivot` level so Nahida, the Dendro Swing,
// and the Ground Shadow Catcher all scale up 1.5x without altering local bone coordinates or FBX retarget ratios!
export const CHARACTER_UNIFORM_SCALE = 1.5;

export const CAMELLYA_SAFE_ZONES = {
  // Slide 1 (Title): Directly below the word "Success" (`x = -2.35`) and lowered (`y = -3.72`)
  // for 1.5x scale (`worldCharHeight = 3.24`) so the top of Nahida's head (`y ≈ -0.48`) sits cleanly below text.
  1: { x: -2.35, y: -3.72, z: 0.0, lookDir: 1 },
  2: { x: 0.96, y: -1.88, z: 0.0, lookDir: -1 },
  3: { x: 0.58, y: -1.88, z: 0.0, lookDir: -1 },
  4: { x: 0.96, y: -1.88, z: 0.0, lookDir: -1 },
  5: { x: 0.58, y: -1.9, z: 0.0, lookDir: -1 },
  6: { x: 0.58, y: -1.9, z: 0.0, lookDir: 1 },
  7: { x: 2.82, y: -1.78, z: 0.0, lookDir: -1 },
  8: { x: 0.96, y: -1.88, z: 0.0, lookDir: -1 },
  9: { x: 0.96, y: -1.88, z: 0.0, lookDir: -1 },
  10: { x: 2.55, y: -1.78, z: 0.1, lookDir: -1 }
};

export const KLEE_SAFE_ZONES = CAMELLYA_SAFE_ZONES;
export const NAHIDA_SAFE_ZONES = CAMELLYA_SAFE_ZONES;

// Canonical World Axes (Character-aligned World Space: +X = Left, +Y = Up, +Z = Forward)
const WORLD_X = new THREE.Vector3(1, 0, 0);
const WORLD_Y = new THREE.Vector3(0, 1, 0);
const WORLD_Z = new THREE.Vector3(0, 0, 1);

function createEnergySparkTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 60);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.3, 'rgba(167, 243, 208, 0.85)');
  grad.addColorStop(0.65, 'rgba(52, 211, 153, 0.35)');
  grad.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function createRadialContactShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createRadialGradient(128, 128, 6, 128, 128, 124);
  grad.addColorStop(0.0, 'rgba(1, 8, 5, 0.72)');
  grad.addColorStop(0.32, 'rgba(1, 10, 6, 0.48)');
  grad.addColorStop(0.64, 'rgba(2, 14, 9, 0.18)');
  grad.addColorStop(1.0, 'rgba(2, 14, 9, 0.0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export function createAssistant3DSystem(container) {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  camera.position.set(0, 0, 8.5);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance'
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;

  // Real-Time 2K Soft Shadow Map
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  if (container) {
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    container.style.zIndex = '35';
  }

  // ==========================================================================
  // STUDIO LIGHTING + 2K SHADOW-CASTING DIRECTIONAL LIGHT (UPDATE V43 SECTION 3 LAYER B:
  // WARM KEY LIGHT `0xfff7f0` @ 1.35 + WARM PEACH AMBIENT FILL `0xf5d0c0` @ 0.78)
  // ==========================================================================
  const ambientLight = new THREE.AmbientLight(0xf5d0c0, 0.78);
  scene.add(ambientLight);

  const hemiLight = new THREE.HemisphereLight(0xfff7f0, 0xf5d0c0, 0.68);
  hemiLight.position.set(0, 6, 2);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xfff7f0, 1.35);
  dirLight.position.set(
    CAMELLYA_SAFE_ZONES[1].x + 1.65,
    CAMELLYA_SAFE_ZONES[1].y + 4.9,
    CAMELLYA_SAFE_ZONES[1].z + 3.8
  );
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.bias = -0.0004;
  dirLight.shadow.normalBias = 0.018;
  dirLight.shadow.radius = 2.5;

  const shadowCam = dirLight.shadow.camera;
  shadowCam.near = 0.5;
  shadowCam.far = 18.0;
  shadowCam.left = -3.4;
  shadowCam.right = 3.4;
  shadowCam.top = 4.0;
  shadowCam.bottom = -3.4;
  shadowCam.updateProjectionMatrix();

  scene.add(dirLight);
  scene.add(dirLight.target);

  const warmFillLight = new THREE.DirectionalLight(0xffe8da, 0.75);
  warmFillLight.position.set(-3.2, 2.5, 5.5);
  scene.add(warmFillLight);

  const emeraldRimLight = new THREE.DirectionalLight(0x6ee7b7, 0.85);
  emeraldRimLight.position.set(0, 3.0, -4.5);
  scene.add(emeraldRimLight);

  // Back Rim / Fill DirectionalLight (`-Z -> +Z`) so the inner back cape (`DoubleSide` backface)
  // is evenly illuminated from behind and never falls into dark shadow
  const backCapeFillLight = new THREE.DirectionalLight(0xfff7f0, 1.05);
  backCapeFillLight.position.set(0, 2.2, -5.5);
  scene.add(backCapeFillLight);

  // ==========================================================================
  // SINGLE UNIFIED `characterPivot` GROUP (UNIFORM 1.5X SCALE)
  // ==========================================================================
  const characterPivot = new THREE.Group();
  characterPivot.position.set(
    CAMELLYA_SAFE_ZONES[1].x,
    CAMELLYA_SAFE_ZONES[1].y,
    CAMELLYA_SAFE_ZONES[1].z
  );
  characterPivot.rotation.set(0, 0.16, 0);
  characterPivot.scale.setScalar(CHARACTER_UNIFORM_SCALE);
  scene.add(characterPivot);

  // Ground Shadow Catcher + Radial Contact Shadow Disc (Tilted 30° toward Camera: `-Math.PI / 2 + 0.52`)
  const SHADOW_PLANE_TILT_X = -Math.PI * 0.5 + 0.52;
  const groundShadowGroup = new THREE.Group();
  groundShadowGroup.position.set(0, 0, 0);
  characterPivot.add(groundShadowGroup);

  const contactShadowTex = createRadialContactShadowTexture();
  const contactShadowMat = new THREE.MeshBasicMaterial({
    map: contactShadowTex,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const contactShadowMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    contactShadowMat
  );
  contactShadowMesh.rotation.x = SHADOW_PLANE_TILT_X;
  contactShadowMesh.position.set(0, 0.001, 0);
  contactShadowMesh.scale.set(1.15, 0.85, 1);
  groundShadowGroup.add(contactShadowMesh);

  const shadowCatcherMat = new THREE.ShadowMaterial({
    color: 0x010805,
    opacity: 0.42,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const shadowCatcherPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(4.5, 4.5),
    shadowCatcherMat
  );
  shadowCatcherPlane.rotation.x = SHADOW_PLANE_TILT_X;
  shadowCatcherPlane.position.set(0, 0.002, 0);
  shadowCatcherPlane.receiveShadow = true;
  shadowCatcherPlane.castShadow = false;
  groundShadowGroup.add(shadowCatcherPlane);

  const auraGlowTex = createEnergySparkTexture();
  const footAuraMat = new THREE.MeshBasicMaterial({
    map: auraGlowTex,
    color: 0x34d399,
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const footAuraMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 1.2),
    footAuraMat
  );
  footAuraMesh.rotation.x = SHADOW_PLANE_TILT_X;
  footAuraMesh.position.set(0, 0.003, 0);
  groundShadowGroup.add(footAuraMesh);

  // Vertical Curtain Backdrop Shadow Receiver behind Klee
  const curtainShadowGroup = new THREE.Group();
  curtainShadowGroup.visible = false;
  scene.add(curtainShadowGroup);

  const curtainShadowCatcherMat = new THREE.ShadowMaterial({
    color: 0x010805,
    opacity: 0.0,
    transparent: true,
    depthWrite: false
  });
  const curtainShadowCatcherPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(4.4, 4.4),
    curtainShadowCatcherMat
  );
  curtainShadowCatcherPlane.receiveShadow = true;
  curtainShadowCatcherPlane.castShadow = false;
  curtainShadowGroup.add(curtainShadowCatcherPlane);

  const curtainSoftShadowMat = new THREE.MeshBasicMaterial({
    map: contactShadowTex,
    transparent: true,
    opacity: 0.0,
    depthWrite: false
  });
  const curtainSoftShadowMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.35, 2.25),
    curtainSoftShadowMat
  );
  curtainSoftShadowMesh.position.set(-0.14, -0.06, -0.005);
  curtainShadowGroup.add(curtainSoftShadowMesh);

  // HOTFIX V24 SECTION 2: Upward rising particles during curtain pull are 100% removed!
  const dashSparklesGroup = new THREE.Group();
  dashSparklesGroup.visible = false;
  const sparkleSprites = [];

  // ==========================================================================
  // HOTFIX V24 SECTION 3.1: PROCEDURAL 3D DENDRO HOLOGRAPHIC SWING (`createDendroLightSwing`)
  // Modeled 100% after `public/nahida.webp`:
  // - Hollow Glowing Rectangular Box Seat (`width = 0.68`, `height = 0.14`, `depth = 0.28`)
  //   with 12 luminous edges (`#88ff44` / `#eeff88` / `#f5ffdf`), parallel horizontal energy
  //   scan lines inside, and translucent energy planes (`opacity: 0.22`).
  // - Twin Glowing Vertical Ropes (`x = -0.31` & `x = +0.31`, `height = 1.65`) wrapped by
  //   helical glowing vines (`THREE.CatmullRomCurve3` / `TubeGeometry`).
  // - 4-Petal Dendro Clover Ornaments & Glowing Leaves attached along both ropes.
  // ==========================================================================
  function createFourPetalCloverGeometry(outerRadius = 0.12, innerRatio = 0.16) {
    const shape = new THREE.Shape();
    const numPetals = 4;
    const stepsPerPetal = 24;
    const totalSteps = numPetals * stepsPerPetal;

    for (let i = 0; i <= totalSteps; i++) {
      const theta = (i / totalSteps) * Math.PI * 2;
      // 4-Petal Polar Rose with pointed tips matching Nahida's Dendro Clover in `nahida.webp` & `outtromodel.jpg`
      const cos2 = Math.abs(Math.cos(2 * theta));
      const lobe = Math.pow(cos2, 0.58);
      const r = outerRadius * (innerRatio + (1.0 - innerRatio) * lobe);
      const x = Math.cos(theta) * r;
      const y = Math.sin(theta) * r;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }

    const fillGeo = new THREE.ShapeGeometry(shape);
    const pts3D = [];
    for (let i = 0; i <= totalSteps; i++) {
      const theta = (i / totalSteps) * Math.PI * 2;
      const cos2 = Math.abs(Math.cos(2 * theta));
      const lobe = Math.pow(cos2, 0.58);
      const r = outerRadius * (innerRatio + (1.0 - innerRatio) * lobe);
      pts3D.push(new THREE.Vector3(Math.cos(theta) * r, Math.sin(theta) * r, 0));
    }
    const borderCurve = new THREE.CatmullRomCurve3(pts3D, true);
    const borderTubeGeo = new THREE.TubeGeometry(
      borderCurve,
      96,
      outerRadius * 0.075,
      6,
      true
    );

    return { fillGeo, borderTubeGeo };
  }

  function createFourPointStarburstGeometry(radius = 0.12, waist = 0.18) {
    const shape = new THREE.Shape();
    const steps = 64;
    for (let i = 0; i <= steps; i++) {
      const theta = (i / steps) * Math.PI * 2;
      const cos2 = Math.abs(Math.cos(2 * theta));
      const spike = Math.pow(cos2, 2.2);
      const r = radius * (waist + (1.0 - waist) * spike);
      const x = Math.cos(theta) * r;
      const y = Math.sin(theta) * r;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    return new THREE.ShapeGeometry(shape);
  }

  function createDendroLeafGeometry(length = 0.09, width = 0.042) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.quadraticCurveTo(width, length * 0.45, 0, length);
    shape.quadraticCurveTo(-width, length * 0.45, 0, 0);
    return new THREE.ShapeGeometry(shape);
  }

  function createDendroCloverOrnament(size = 0.105, isDoubleRim = false) {
    const group = new THREE.Group();
    const { fillGeo, borderTubeGeo } = createFourPetalCloverGeometry(size, 0.18);

    // 4-Leaf Clover with Fresh Green Center (`#44dd33` / `#88ff55`) & Pearl-White Border (`#ffffff`)
    const fillMat = new THREE.MeshBasicMaterial({
      color: isDoubleRim ? 0x88ff55 : 0x44dd33,
      transparent: true,
      opacity: isDoubleRim ? 0.56 : 0.52,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const borderMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.98,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x88ff55,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    const fillMesh = new THREE.Mesh(fillGeo, fillMat);
    const borderMesh = new THREE.Mesh(borderTubeGeo, borderMat);
    const haloMesh = new THREE.Mesh(fillGeo, haloMat);
    haloMesh.scale.setScalar(1.24);
    haloMesh.position.z = -0.004;

    group.add(haloMesh, fillMesh, borderMesh);

    if (isDoubleRim) {
      const innerClover = createFourPetalCloverGeometry(size * 0.46, 0.22);
      const innerRimMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.90,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const innerMesh = new THREE.Mesh(innerClover.borderTubeGeo, innerRimMat);
      innerMesh.position.z = 0.005;
      group.add(innerMesh);
      group.userData.materials = [fillMat, borderMat, haloMat, innerRimMat];
    } else {
      group.userData.materials = [fillMat, borderMat, haloMat];
    }

    return group;
  }

  /**
   * ==========================================================================
   * HOTFIX V29 SECTION 1: REBUILD DENDRO CLOVER SWING FROM SCRATCH (`rebuildDendroCloverSwing`)
   * Attached directly as a child of `characterPivot` (`characterPivot.add(dendroSwingGroup)`):
   * 1. Twin Vertical White-Core & Green-Aura Light Beams (`x = -0.34` & `x = +0.34`, `height = 1.55`
   *    from `seatBottomY` to `seatBottomY + 1.55`):
   *    - Inner Core: Cylinder (`radius = 0.010`), pure glowing White (`#ffffff`, `opacity: 0.98`).
   *    - Outer Glow Aura: Cylinder (`radius = 0.028`) + helical vine in glowing Lime Green
   *      (`#66ff44` / `#99ff55`, `AdditiveBlending`, `opacity: 0.55`).
   * 2. 8 Symmetrical 4-Leaf Clover Ornaments (`#44dd33` / `#88ff55` fill + `#ffffff` border)
   *    attached along both vertical light beams, pulsing gently over time.
   * 3. Hollow Edge-Only Rectangular Box Seat (`width = 0.68`, `height = 0.12`, `depth = 0.30`):
   *    - STRICTLY NO solid face planes — 12 glowing box edges + 2 thin front/back cross-braces,
   *      each with a pure White core (`#ffffff`) and Green aura (`#77ff44`).
   *    - Positioned at hip/thigh height (`seatY ≈ 0.42 * charHeight`, NEVER at `y = 0` under feet!).
   * ==========================================================================
   */
  function rebuildDendroCloverSwing() {
    const swingRoot = new THREE.Group();
    swingRoot.visible = false;

    const allGlowMaterials = [];
    const registerMat = (mat, baseOpacity) => {
      mat.userData = mat.userData || {};
      mat.userData.baseOpacity = baseOpacity;
      allGlowMaterials.push(mat);
      return mat;
    };

    // Pure White Inner Core (`#ffffff`, `opacity: 0.98`)
    const pureWhiteCoreMat = registerMat(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.98,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      }),
      0.98
    );
    // Outer Glow Aura (`#66ff44`, `AdditiveBlending`, `opacity: 0.55`)
    const greenBeamAuraMat = registerMat(
      new THREE.MeshBasicMaterial({
        color: 0x66ff44,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      }),
      0.55
    );
    // Helical Vine Aura (`#99ff55`, `AdditiveBlending`, `opacity: 0.55`)
    const limeVineAuraMat = registerMat(
      new THREE.MeshBasicMaterial({
        color: 0x99ff55,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      }),
      0.55
    );
    // Hollow Box Seat Edge Halo (`#77ff44`, `AdditiveBlending`, `opacity: 0.58`)
    const boxEdgeGreenHaloMat = registerMat(
      new THREE.MeshBasicMaterial({
        color: 0x77ff44,
        transparent: true,
        opacity: 0.58,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      }),
      0.58
    );

    // ------------------------------------------------------------------------
    // 1. HOLLOW EDGE-ONLY RECTANGULAR BOX SEAT (`width = 0.68`, `height = 0.12`, `depth = 0.30`)
    //    NO solid planes — strictly 12 glowing box edges + 2 thin front/back cross-braces!
    //    Placed at hip/thigh height (`defaultSeatY ≈ 0.42 * 2.16 = 0.91`), NEVER at `y = 0`!
    // ------------------------------------------------------------------------
    const seatW = 0.68;
    const seatH = 0.12;
    const seatD = 0.30;
    const halfW = seatW * 0.5; // 0.34
    const halfH = seatH * 0.5; // 0.06
    const halfD = seatD * 0.5; // 0.15
    const defaultSeatCenterY = 0.78;

    const seatGroup = new THREE.Group();
    seatGroup.position.set(0, defaultSeatCenterY, 0.02);

    const addBoxEdgeBeam = (p1, p2, coreRad = 0.0095, haloRad = 0.022) => {
      const dir = new THREE.Vector3().subVectors(p2, p1);
      const len = dir.length();
      const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
      const quat = new THREE.Quaternion().setFromUnitVectors(
        WORLD_Y,
        dir.clone().normalize()
      );

      const coreGeo = new THREE.CylinderGeometry(coreRad, coreRad, len, 10);
      const coreMesh = new THREE.Mesh(coreGeo, pureWhiteCoreMat);
      coreMesh.position.copy(mid);
      coreMesh.quaternion.copy(quat);
      seatGroup.add(coreMesh);

      const haloGeo = new THREE.CylinderGeometry(haloRad, haloRad, len, 10);
      const haloMesh = new THREE.Mesh(haloGeo, boxEdgeGreenHaloMat);
      haloMesh.position.copy(mid);
      haloMesh.quaternion.copy(quat);
      seatGroup.add(haloMesh);
    };

    // 4 Horizontal X-edges (`width = 0.68`)
    for (const sy of [-halfH, halfH]) {
      for (const sz of [-halfD, halfD]) {
        addBoxEdgeBeam(
          new THREE.Vector3(-halfW, sy, sz),
          new THREE.Vector3(halfW, sy, sz)
        );
      }
    }
    // 4 Vertical Y-edges (`height = 0.12`)
    for (const sx of [-halfW, halfW]) {
      for (const sz of [-halfD, halfD]) {
        addBoxEdgeBeam(
          new THREE.Vector3(sx, -halfH, sz),
          new THREE.Vector3(sx, halfH, sz)
        );
      }
    }
    // 4 Depth Z-edges (`depth = 0.30`)
    for (const sx of [-halfW, halfW]) {
      for (const sy of [-halfH, halfH]) {
        addBoxEdgeBeam(
          new THREE.Vector3(sx, sy, -halfD),
          new THREE.Vector3(sx, sy, halfD)
        );
      }
    }

    // 2 Thin Cross-Braces on Front (`+halfD * 0.55`) and Back (`-halfD * 0.55`)
    addBoxEdgeBeam(
      new THREE.Vector3(-halfW, 0, halfD * 0.55),
      new THREE.Vector3(halfW, 0, halfD * 0.55),
      0.0055,
      0.013
    );
    addBoxEdgeBeam(
      new THREE.Vector3(-halfW, 0, -halfD * 0.55),
      new THREE.Vector3(halfW, 0, -halfD * 0.55),
      0.0055,
      0.013
    );

    swingRoot.add(seatGroup);

    // ------------------------------------------------------------------------
    // 2. TWIN VERTICAL WHITE-CORE & GREEN-AURA LIGHT BEAMS (`x = -0.34` & `x = +0.34`)
    //    Extending from `seatBottomY` (`y = -halfH` relative to `seatCenterY`) up by `1.70` units!
    // ------------------------------------------------------------------------
    const beamHeight = 1.70;
    const pulsingClovers = [];
    const pulsingLeaves = [];
    const leafGeo = createDendroLeafGeometry(0.088, 0.038);

    const buildSingleSideBeamAssembly = (sideSign) => {
      const ropeGroup = new THREE.Group();
      ropeGroup.position.set(sideSign * 0.34, defaultSeatCenterY, 0.02);

      const seatBottomOffset = -halfH; // -0.06 relative to seatCenterY
      const beamCenterY = seatBottomOffset + beamHeight * 0.5;

      // Layer A: Inner Core (`radius = 0.010`, `#ffffff`, `opacity: 0.98`)
      const innerCoreGeo = new THREE.CylinderGeometry(0.010, 0.010, beamHeight, 12);
      const innerCoreMesh = new THREE.Mesh(innerCoreGeo, pureWhiteCoreMat);
      innerCoreMesh.position.set(0, beamCenterY, 0);
      ropeGroup.add(innerCoreMesh);

      // Layer B: Outer Glow Aura (`radius = 0.028`, `#66ff44`, `opacity: 0.55`)
      const outerAuraGeo = new THREE.CylinderGeometry(0.028, 0.028, beamHeight, 12);
      const outerAuraMesh = new THREE.Mesh(outerAuraGeo, greenBeamAuraMat);
      outerAuraMesh.position.set(0, beamCenterY, 0);
      ropeGroup.add(outerAuraMesh);

      // Gently spiraling green vine (`#99ff55` / `#66ff44`, `opacity: 0.55`) around the light beam
      for (let v = 0; v < 2; v++) {
        const vinePts = [];
        const numPts = 28;
        const turns = v === 0 ? 2.4 : -2.0;
        const radius = v === 0 ? 0.030 : 0.022;
        const phase0 = v * Math.PI + (sideSign < 0 ? 0.5 : 0);
        for (let i = 0; i <= numPts; i++) {
          const u = i / numPts;
          const ang = u * Math.PI * 2 * turns + phase0;
          const r = radius * (0.70 + 0.30 * Math.sin(u * Math.PI));
          vinePts.push(
            new THREE.Vector3(
              Math.cos(ang) * r,
              seatBottomOffset + u * beamHeight,
              Math.sin(ang) * r
            )
          );
        }
        const vineCurve = new THREE.CatmullRomCurve3(vinePts);
        const vineTubeGeo = new THREE.TubeGeometry(
          vineCurve,
          60,
          v === 0 ? 0.0058 : 0.0042,
          6,
          false
        );
        const vineMesh = new THREE.Mesh(
          vineTubeGeo,
          v === 0 ? limeVineAuraMat : greenBeamAuraMat
        );
        ropeGroup.add(vineMesh);
      }

      // ----------------------------------------------------------------------
      // 3. SYMMETRICAL 4-LEAF CLOVER ORNAMENTS ALONG BOTH LIGHT BEAMS (4 per side = 8 total)
      //    Green fill (`#44dd33` / `#88ff55`) + Pearl-White border (`#ffffff`)
      // ----------------------------------------------------------------------
      const cloverSpecs = [
        { y: 0.14, xOff: sideSign * 0.065, zOff: 0.075, size: 0.078, rotZ: 0.20 * sideSign, doubleRim: false },
        { y: 0.44, xOff: sideSign * 0.055, zOff: 0.070, size: 0.112, rotZ: -0.16 * sideSign, doubleRim: true },
        { y: 0.78, xOff: sideSign * 0.085, zOff: 0.055, size: 0.084, rotZ: 0.26 * sideSign, doubleRim: false },
        { y: 1.14, xOff: sideSign * 0.050, zOff: 0.045, size: 0.068, rotZ: -0.22 * sideSign, doubleRim: false }
      ];

      cloverSpecs.forEach((spec, idx) => {
        const clover = createDendroCloverOrnament(spec.size, spec.doubleRim);
        clover.position.set(spec.xOff, spec.y, spec.zOff);
        clover.rotation.z = spec.rotZ;
        clover.userData.baseY = spec.y;
        clover.userData.baseX = spec.xOff;
        clover.userData.baseRotZ = spec.rotZ;
        clover.userData.baseScale = 1.0;
        clover.userData.phase = idx * 1.15 + (sideSign > 0 ? 0.6 : 0.0);
        clover.userData.materials.forEach((m) => registerMat(m, m.opacity));
        ropeGroup.add(clover);
        pulsingClovers.push(clover);
      });

      // Small glowing Dendro leaves along the beam
      const leafHeights = [0.28, 0.62, 0.96, 1.28];
      leafHeights.forEach((ly, idx) => {
        const leafMesh = new THREE.Mesh(
          leafGeo,
          idx % 2 === 0 ? limeVineAuraMat : greenBeamAuraMat
        );
        const dirSign = idx % 2 === 0 ? sideSign : -sideSign;
        leafMesh.position.set(dirSign * 0.024, ly, 0.025);
        leafMesh.rotation.z = -dirSign * 0.74;
        leafMesh.rotation.y = dirSign * 0.22;
        ropeGroup.add(leafMesh);
        pulsingLeaves.push(leafMesh);
      });

      return ropeGroup;
    };

    const leftRopeGroup = buildSingleSideBeamAssembly(1);   // +0.34
    const rightRopeGroup = buildSingleSideBeamAssembly(-1); // -0.34
    swingRoot.add(leftRopeGroup, rightRopeGroup);

    // HOTFIX V31 SECTION 3: Enable real-time shadow casting on the Dendro Swing meshes
    swingRoot.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = false;
      }
    });

    swingRoot.userData = {
      seatGroup,
      leftRopeGroup,
      rightRopeGroup,
      clovers: pulsingClovers,
      pulsingClovers,
      leaves: pulsingLeaves,
      materials: allGlowMaterials,
      allGlowMaterials,
      seatW,
      seatH,
      seatD
    };

    return swingRoot;
  }

  const createDendroLightSwing = rebuildDendroCloverSwing;
  const dendroSwingGroup = rebuildDendroCloverSwing();
  characterPivot.add(dendroSwingGroup);

  // ==========================================================================
  // HOTFIX V24 SECTION 4: BLOOMING DOTTED SQUARE FRAME & 4-PETAL DENDRO FLOWERS
  // OUTRO VFX (`createDendroOutroVFXGroup` — Modeled 100% after `public/outtromodel.jpg`)
  // ==========================================================================
  function createDendroOutroVFXGroup() {
    const vfxRoot = new THREE.Group();
    vfxRoot.visible = false;

    const vfxMaterials = [];
    const trackMat = (mat, baseOp) => {
      mat.userData = { baseOpacity: baseOp };
      vfxMaterials.push(mat);
      return mat;
    };

    const lemonGlowMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xe8ff77,
        transparent: true,
        opacity: 0.98,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      }),
      0.98
    );
    const emeraldGlowMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x66ff99,
        transparent: true,
        opacity: 0.62,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      }),
      0.62
    );
    const frameGlassMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x66ff99,
        transparent: true,
        opacity: 0.14,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      }),
      0.14
    );

    // 1. GLOWING DOTTED SQUARE FRAME WITH 4-POINTED STARBURST CORNERS (`outtromodel.jpg`)
    const frameGroup = new THREE.Group();
    const halfS = 0.72; // Square frame half-size (`1.44 x 1.44` units)

    // Subtle inner viewfinder glow plane
    const innerGlassPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(halfS * 1.94, halfS * 1.94),
      frameGlassMat
    );
    innerGlassPlane.position.z = -0.01;
    frameGroup.add(innerGlassPlane);

    // 4 Corner 4-Pointed Starburst Crosses
    const starCoreGeo = createFourPointStarburstGeometry(0.16, 0.15);
    const starHaloGeo = createFourPointStarburstGeometry(0.24, 0.22);
    const corners = [
      [-halfS, halfS],
      [halfS, halfS],
      [-halfS, -halfS],
      [halfS, -halfS]
    ];
    corners.forEach(([cx, cy]) => {
      const coreStar = new THREE.Mesh(starCoreGeo, lemonGlowMat);
      coreStar.position.set(cx, cy, 0.01);
      const haloStar = new THREE.Mesh(starHaloGeo, emeraldGlowMat);
      haloStar.position.set(cx, cy, 0.0);
      frameGroup.add(haloStar, coreStar);
    });

    // Glowing Dots along all 4 edges (decreasing in size toward the center of each edge)
    // + Fine connecting glowing rays (`outtromodel.jpg`)
    const dotOffsetsFromCorner = [
      { dist: 0.18, r: 0.038 },
      { dist: 0.30, r: 0.027 },
      { dist: 0.40, r: 0.017 }
    ];

    const addEdgeDotsAndRay = (startVec, endVec) => {
      const dir = new THREE.Vector3().subVectors(endVec, startVec);
      const len = dir.length();
      const unitDir = dir.clone().normalize();
      const mid = new THREE.Vector3().addVectors(startVec, endVec).multiplyScalar(0.5);

      // Fine glowing ray connecting across the edge
      const rayQuat = new THREE.Quaternion().setFromUnitVectors(WORLD_Y, unitDir);
      const rayCore = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0055, 0.0055, len * 0.92, 8),
        lemonGlowMat
      );
      rayCore.position.copy(mid);
      rayCore.quaternion.copy(rayQuat);
      frameGroup.add(rayCore);

      const rayHalo = new THREE.Mesh(
        new THREE.CylinderGeometry(0.016, 0.016, len * 0.96, 8),
        emeraldGlowMat
      );
      rayHalo.position.copy(mid);
      rayHalo.quaternion.copy(rayQuat);
      frameGroup.add(rayHalo);

      // 3 Glowing Dots inward from `startVec` and 3 inward from `endVec`
      dotOffsetsFromCorner.forEach(({ dist, r }) => {
        const pA = startVec.clone().addScaledVector(unitDir, dist);
        const pB = endVec.clone().addScaledVector(unitDir, -dist);
        const dotGeo = new THREE.CircleGeometry(r, 20);
        const haloDotGeo = new THREE.CircleGeometry(r * 1.65, 20);

        [pA, pB].forEach((pos) => {
          const dCore = new THREE.Mesh(dotGeo, lemonGlowMat);
          dCore.position.set(pos.x, pos.y, 0.012);
          const dHalo = new THREE.Mesh(haloDotGeo, emeraldGlowMat);
          dHalo.position.set(pos.x, pos.y, 0.004);
          frameGroup.add(dHalo, dCore);
        });
      });
    };

    addEdgeDotsAndRay(new THREE.Vector3(-halfS, halfS, 0), new THREE.Vector3(halfS, halfS, 0));
    addEdgeDotsAndRay(new THREE.Vector3(-halfS, -halfS, 0), new THREE.Vector3(halfS, -halfS, 0));
    addEdgeDotsAndRay(new THREE.Vector3(-halfS, -halfS, 0), new THREE.Vector3(-halfS, halfS, 0));
    addEdgeDotsAndRay(new THREE.Vector3(halfS, -halfS, 0), new THREE.Vector3(halfS, halfS, 0));

    vfxRoot.add(frameGroup);

    // 2. BLOOMING 4-PETAL DENDRO FLOWERS (`outtromodel.jpg` exact layout:
    //    Large flower at top-right corner, large flower inside center-right,
    //    plus drifting smaller 4-petal clovers & sparkles)
    const bloomingFlowers = [];
    const flowerConfigs = [
      // Large 4-Petal Flower at Top-Right Corner of the Square Frame (`outtromodel.jpg`)
      { x: halfS * 1.08, y: halfS * 0.92, z: 0.04, size: 0.34, driftX: 0.14, driftY: 0.12, rotBase: 0.02 },
      // Large 4-Petal Flower inside the Square Frame slightly right of center (`outtromodel.jpg`)
      { x: halfS * 0.32, y: -halfS * 0.06, z: 0.06, size: 0.31, driftX: 0.08, driftY: -0.05, rotBase: -0.04 },
      // Smaller 4-Petal / Starburst left of center inside the frame (`outtromodel.jpg`)
      { x: -halfS * 0.22, y: -halfS * 0.12, z: 0.05, size: 0.11, driftX: -0.12, driftY: -0.08, rotBase: 0.35 },
      // Drifting accent 4-Petal Flower near bottom-right & top-left
      { x: -halfS * 0.78, y: halfS * 0.52, z: 0.03, size: 0.14, driftX: -0.16, driftY: 0.14, rotBase: -0.28 }
    ];

    flowerConfigs.forEach((cfg) => {
      const fl = createDendroCloverOrnament(cfg.size, true);
      fl.position.set(cfg.x, cfg.y, cfg.z);
      fl.rotation.z = cfg.rotBase;
      fl.userData.baseX = cfg.x;
      fl.userData.baseY = cfg.y;
      fl.userData.driftX = cfg.driftX;
      fl.userData.driftY = cfg.driftY;
      fl.userData.baseRotZ = cfg.rotBase;
      fl.userData.materials.forEach((m) => trackMat(m, m.opacity));
      vfxRoot.add(fl);
      bloomingFlowers.push(fl);
    });

    vfxRoot.userData = {
      frameGroup,
      bloomingFlowers,
      vfxMaterials,
      opacity: 0.0,
      bloomProgress: 0.0
    };

    return vfxRoot;
  }

  const dendroOutroVFXGroup = createDendroOutroVFXGroup();
  scene.add(dendroOutroVFXGroup);

  // ==========================================================================
  // SECTION 3.2: 4-TIER SPRING-DAMPER MOUSE GAZE CHAIN STATE
  // - Tier 1: `headBone`  (`55%` Yaw/Pitch, `60%` Roll, `stiffness: 18, damping: 6`)
  // - Tier 2: `neckBone`  (`25%` Yaw/Pitch/Roll, `stiffness: 14, damping: 5`)
  // - Tier 3: `chestBone` (`12%` Yaw/Roll, `10%` Pitch, `stiffness: 10, damping: 4`)
  // - Tier 4: `spineBone` (`8%` Yaw/Roll, `6%` Pitch, `stiffness: 8, damping: 4`)
  // ==========================================================================
  const mouseGazeState = {
    rawMouseX: 0,
    rawMouseY: 0,
    headTier: {
      yaw: 0,
      pitch: 0,
      roll: 0,
      vYaw: 0,
      vPitch: 0,
      vRoll: 0,
      stiffness: 18,
      damping: 6
    },
    neckTier: {
      yaw: 0,
      pitch: 0,
      roll: 0,
      vYaw: 0,
      vPitch: 0,
      vRoll: 0,
      stiffness: 14,
      damping: 5
    },
    chestTier: {
      yaw: 0,
      pitch: 0,
      roll: 0,
      vYaw: 0,
      vPitch: 0,
      vRoll: 0,
      stiffness: 10,
      damping: 4
    },
    spineTier: {
      yaw: 0,
      pitch: 0,
      roll: 0,
      vYaw: 0,
      vPitch: 0,
      vRoll: 0,
      stiffness: 8,
      damping: 4
    }
  };

  function stepSpringDamperTier(tier, targetYaw, targetPitch, targetRoll, dt) {
    const stepDt = Math.min(dt, 0.033);
    const k = tier.stiffness;
    const c = tier.damping;

    const aYaw = k * (targetYaw - tier.yaw) - c * tier.vYaw;
    tier.vYaw += aYaw * stepDt;
    tier.yaw += tier.vYaw * stepDt;

    const aPitch = k * (targetPitch - tier.pitch) - c * tier.vPitch;
    tier.vPitch += aPitch * stepDt;
    tier.pitch += tier.vPitch * stepDt;

    const aRoll = k * (targetRoll - tier.roll) - c * tier.vRoll;
    tier.vRoll += aRoll * stepDt;
    tier.roll += tier.vRoll * stepDt;
  }

  window.addEventListener(
    'mousemove',
    (e) => {
      if (window.innerWidth > 0 && window.innerHeight > 0) {
        mouseGazeState.rawMouseX = (e.clientX / window.innerWidth) * 2 - 1;
        mouseGazeState.rawMouseY = -((e.clientY / window.innerHeight) * 2 - 1);
      }
    },
    { passive: true }
  );

  function getSafeZoneForSlide(slideIdOrIndex) {
    const slideId =
      slideIdOrIndex >= 1 && slideIdOrIndex <= 10
        ? slideIdOrIndex
        : Math.max(1, Math.min(10, (Number(slideIdOrIndex) || 0) + 1));

    const preset = CAMELLYA_SAFE_ZONES[slideId] || CAMELLYA_SAFE_ZONES[1];
    return {
      x: preset.x,
      y: preset.y,
      z: preset.z,
      lookDir: preset.lookDir || 1
    };
  }

  // ==========================================================================
  // SECTION 1: WORLD-SPACE BONE AXIS SOLVER (`applyWorldAxisRotation`)
  // Converts a World-Space rotation axis (`WORLD_X`, `WORLD_Y`, `WORLD_Z`) into
  // the parent bone's Local Space (`parentWorldQuat.invert()`) so rotations
  // never depend on how the FBX exporter oriented the bone's local axes!
  // ==========================================================================
  const _parentWorldQuat = new THREE.Quaternion();
  const _localAxis = new THREE.Vector3();
  const _deltaQuat = new THREE.Quaternion();

  /**
   * Core World-Space Bone Axis Rotation Function (Section 1.2):
   * Transfers `worldAxis` (`WORLD_X`, `WORLD_Y`, or `WORLD_Z`, aligned with
   * `characterPivot` so it remains consistent even when Klee turns 180° or spins)
   * into the local space of `bone.parent`, and premultiplies `baseLocalQuat`.
   */
  function applyWorldAxisRotation(bone, baseLocalQuat, worldAxis, angle) {
    if (!bone || !bone.parent) return;
    if (baseLocalQuat && bone.quaternion !== baseLocalQuat) {
      bone.quaternion.copy(baseLocalQuat);
    }
    if (Math.abs(angle) <= 0.000001) return;

    bone.parent.getWorldQuaternion(_parentWorldQuat);
    _localAxis
      .copy(worldAxis)
      .applyQuaternion(characterPivot.quaternion)
      .applyQuaternion(_parentWorldQuat.invert())
      .normalize();
    _deltaQuat.setFromAxisAngle(_localAxis, angle);
    bone.quaternion.premultiply(_deltaQuat);
  }

  /**
   * Applies Yaw (`WORLD_Y`), Pitch (`WORLD_X`), and Roll/Abduction (`WORLD_Z`)
   * in World Space on top of `entry.relaxedQuat` (or `entry.restQuat`), then updates
   * the bone's world matrix so child bones in the chain see the updated parent transform!
   */
  function applyBoneWorldYPZ(entry, yawY = 0, pitchX = 0, rollZ = 0, baseQuatOverride = null) {
    if (!entry || !entry.bone) return;
    const bone = entry.bone;
    const startQuat = baseQuatOverride || entry.relaxedQuat || entry.restQuat;
    bone.quaternion.copy(startQuat);

    if (Math.abs(yawY) > 0.00001) {
      applyWorldAxisRotation(bone, bone.quaternion, WORLD_Y, yawY);
    }
    if (Math.abs(pitchX) > 0.00001) {
      applyWorldAxisRotation(bone, bone.quaternion, WORLD_X, pitchX);
    }
    if (Math.abs(rollZ) > 0.00001) {
      applyWorldAxisRotation(bone, bone.quaternion, WORLD_Z, rollZ);
    }
    bone.updateMatrixWorld();
  }

  // ==========================================================================
  // SKELETON & PHYSICS STATE FOR `/genshin_impact_-_nahida.glb`
  // ==========================================================================
  let loadedModel = null;
  let hasRiggedArmBones = false;
  let charHeight = 2.16;
  let charWidth = 0.88;
  let hipHeight = 0.98;
  let bindLeftFootLocalY = 0.08;
  let bindRightFootLocalY = 0.08;
  let leftHandCurtainOffsetX = 0.16;
  const neckPivotLocalPos = new THREE.Vector3(0, 1.32, 0);
  const baseModelLocalPos = new THREE.Vector3(0, 0, 0);

  const riggedBones = {
    hips: null,
    spine: null,
    upperBody: null,
    chest: null,
    neck: null,
    head: null,
    rightShoulder: null,
    rightArm: null,
    rightUpperArm: null,
    rightElbow: null,
    rightForeArm: null,
    rightWrist: null,
    rightHand: null,
    leftShoulder: null,
    leftArm: null,
    leftUpperArm: null,
    leftElbow: null,
    leftForeArm: null,
    leftWrist: null,
    leftHand: null,
    rightLeg: null,
    rightThigh: null,
    rightKnee: null,
    rightCalf: null,
    rightFoot: null,
    rightToe: null,
    leftLeg: null,
    leftThigh: null,
    leftKnee: null,
    leftCalf: null,
    leftFoot: null,
    leftToe: null,
    fingerBones: [],
    hairChains: [],
    skirtChains: [],
    accessoryChains: []
  };

  // Sign multipliers (`+1` or `-1`) solved in World Space so `+angle` around `WORLD_Z`
  // or `WORLD_X` always moves the limb in the intended anatomical direction!
  const solvedSigns = {
    rightArmAdductZ: 1,   // +1 or -1 around WORLD_Z to adduct RightUpperArm inward toward right hip
    leftArmAdductZ: -1,   // +1 or -1 around WORLD_Z to adduct LeftUpperArm inward toward left hip
    rightThighLiftX: -1,  // +1 or -1 around WORLD_X to lift RightThigh forward (+Z) when sitting on Swing
    leftThighLiftX: -1,   // +1 or -1 around WORLD_X to lift LeftThigh forward (+Z) when sitting on Swing
    rightThighAdductZ: 1, // +1 or -1 around WORLD_Z to adduct RightThigh knee slightly inward
    leftThighAdductZ: -1, // +1 or -1 around WORLD_Z to adduct LeftThigh knee slightly inward
    rightKneeBendX: 1,    // +1 or -1 around WORLD_X to bend RightKnee backward (-Z)
    leftKneeBendX: 1      // +1 or -1 around WORLD_X to bend LeftKnee backward (-Z)
  };

  const headFallbackMeshes = [];
  const legFallbackMeshes = [];
  let legFallbackWasApplied = false;

  const spinPhysics = {
    prevRotationY: 0.16,
    angularVelocity: 0,
    angularAcceleration: 0,
    centrifugalFactor: 0,
    angularDrag: 0,
    anticipationDip: 0,
    trailFootLift: 0,
    spottingProgress: 0,
    postSpinStopTime: -10,
    physicsIntensityScale: 1.0
  };

  /**
   * Section 4: 7-Joint Full-Body Kinematic Curtain Pull State & Dendro Swing Sit State (`poseControl`)
   */
  const poseControl = {
    choreoWeight: 0,
    swingSitWeight: 0, // 0 = Standing, 1 = Sitting on Dendro Holographic Swing holding ropes (`nahida.webp`)
    // Group 1: Spine & Chest
    spineChestArchX: 0,
    spineChestTwistY: 0,
    spineChestTiltZ: 0,
    // Group 2: Neck & Head
    curtainHeadPitchX: 0,
    curtainHeadYawY: 0,
    curtainHeadRollZ: 0,
    // Group 3: Left Clavicle / Shoulder
    leftShoulderShrug: 0,
    // Group 4: Left UpperArm
    leftArmPullRaise: 0,
    leftArmOutwardZ: 0,
    // Group 5: Left ForeArm (Elbow)
    leftElbowFlexArc: 0,
    // Group 6: Left Wrist & Left Fingers
    leftWristExtension: 0,
    leftFingerGrip: 0,
    // Group 7: Right Arm Counter-Balance & Both Legs/Knees/Feet
    rightArmCounterPitchX: 0,
    rightArmCounterFlareZ: 0,
    hoverFootPoint: 0,
    pullKneeBounce: 0
  };

  function captureBoneEntry(boneObj, phaseOffset = 0, chainDepth = 0) {
    if (!boneObj) return null;
    return {
      bone: boneObj,
      restQuat: boneObj.quaternion.clone(),
      relaxedQuat: boneObj.quaternion.clone(),
      phaseOffset,
      chainDepth
    };
  }

  function getPrimaryChildBone(bone) {
    if (!bone || !bone.children || bone.children.length === 0) return null;
    for (let i = 0; i < bone.children.length; i++) {
      const ch = bone.children[i];
      if (
        ch.isBone &&
        ch.name &&
        !/(twist|roll|aux|adj|fix|helper|ik|nub|_end|捩|先)/i.test(ch.name)
      ) {
        return ch;
      }
    }
    for (let i = 0; i < bone.children.length; i++) {
      if (bone.children[i].isBone) return bone.children[i];
    }
    return bone.children[0];
  }

  function getDistalTipNode(bone) {
    let curr = bone;
    let guard = 0;
    while (curr && curr.children && curr.children.length > 0 && guard < 16) {
      const next = getPrimaryChildBone(curr) || curr.children[0];
      if (!next || next === curr) break;
      curr = next;
      guard++;
    }
    return curr;
  }

  function isBoneAncestorOf(ancestorBone, descendantBone) {
    if (!ancestorBone || !descendantBone) return false;
    let curr = descendantBone.parent;
    while (curr) {
      if (curr === ancestorBone) return true;
      curr = curr.parent;
    }
    return false;
  }

  function getLowestCommonAncestorBone(boneA, boneB) {
    if (!boneA || !boneB) return null;
    const ancestorsA = new Set();
    let curr = boneA;
    while (curr) {
      ancestorsA.add(curr);
      curr = curr.parent;
    }
    curr = boneB;
    while (curr) {
      if (ancestorsA.has(curr) && curr.isBone) {
        return curr;
      }
      curr = curr.parent;
    }
    return null;
  }

  /**
   * ==========================================================================
   * SECTION 2.1: SOLVE NATURAL RELAXED STANDING POSE FOR ARMS, CLAVICLES & FOREARMS
   * Uses `applyWorldAxisRotation` around `WORLD_Z = (0, 0, 1)` and `WORLD_X = (1, 0, 0)`
   * while measuring actual 3D positions (`handBone.getWorldPosition()`, `elbowBone.getWorldPosition()`)
   * so Klee's arms hang naturally close to her sides and her forearms extend softly downward
   * by gravity (eliminating 100% of the stiff "O"-shaped crab elbow)!
   * ==========================================================================
   */
  function solveNaturalRelaxedArmAndElbowPose(centerX) {
    if (!loadedModel) return;
    loadedModel.updateMatrixWorld(true);

    const pShoulder = new THREE.Vector3();
    const pElbow = new THREE.Vector3();
    const pWrist = new THREE.Vector3();
    const testPos = new THREE.Vector3();

    const calibrateSingleSideArm = (
      shoulderEntry,
      armEntry,
      elbowEntry,
      wristEntry,
      isRightSide
    ) => {
      if (!armEntry || !armEntry.bone) return;
      const armBone = armEntry.bone;
      const elbowBone = elbowEntry?.bone || getPrimaryChildBone(armBone);
      const wristBone =
        wristEntry?.bone || (elbowBone ? getPrimaryChildBone(elbowBone) : null);

      if (!elbowBone) return;

      // 1. Gently relax Clavicle/Shoulder downward by ~3.5° around WORLD_Z so shoulders aren't stiff
      if (shoulderEntry && shoulderEntry.bone) {
        const shBone = shoulderEntry.bone;
        shBone.quaternion.copy(shoulderEntry.restQuat);
        shBone.updateMatrixWorld(true);
        armBone.getWorldPosition(pShoulder);

        applyWorldAxisRotation(shBone, shoulderEntry.restQuat, WORLD_Z, 0.06);
        shBone.updateMatrixWorld(true);
        armBone.getWorldPosition(testPos);
        const dropSign = testPos.y < pShoulder.y ? 1 : -1;

        applyWorldAxisRotation(
          shBone,
          shoulderEntry.restQuat,
          WORLD_Z,
          dropSign * 0.055
        );
        shBone.updateMatrixWorld(true);
        shoulderEntry.relaxedQuat.copy(shBone.quaternion);
      }

      // 2. Determine which sign around WORLD_Z adducts UpperArm inward toward the hip (`centerX`) & downward
      armBone.quaternion.copy(armEntry.restQuat);
      armBone.updateMatrixWorld(true);
      armBone.getWorldPosition(pShoulder);
      elbowBone.getWorldPosition(pElbow);

      const baseDistX = Math.abs(pElbow.x - centerX);
      applyWorldAxisRotation(armBone, armEntry.restQuat, WORLD_Z, 0.25);
      armBone.updateMatrixWorld(true);
      elbowBone.getWorldPosition(testPos);
      const newDistX = Math.abs(testPos.x - centerX);

      const adductSignZ = newDistX < baseDistX ? 1 : -1;
      if (isRightSide) {
        solvedSigns.rightArmAdductZ = adductSignZ;
      } else {
        solvedSigns.leftArmAdductZ = adductSignZ;
      }

      // Measure bind-pose UpperArm abduction angle from straight-down vertical `(0, -1, 0)`
      armBone.quaternion.copy(armEntry.restQuat);
      armBone.updateMatrixWorld(true);
      armBone.getWorldPosition(pShoulder);
      elbowBone.getWorldPosition(pElbow);

      const upperDx = Math.abs(pElbow.x - pShoulder.x);
      const upperDy = Math.max(0.001, pShoulder.y - pElbow.y);
      const currentAbductionRad = Math.atan2(upperDx, upperDy);

      // Target a slim, natural ~11° (0.19 rad) angle from vertical so UpperArm hangs close to torso
      // without clipping Klee's dress/shorts!
      const targetUpperAbductionRad = 0.19;
      const neededAdductionZ = THREE.MathUtils.clamp(
        currentAbductionRad - targetUpperAbductionRad,
        -0.35,
        1.35
      );

      // Also align UpperArm in the side (YZ) plane so the elbow sits neutrally beside the torso
      const upperLen = Math.max(0.01, pShoulder.distanceTo(pElbow));
      const currentUpperPitchRad = Math.asin(
        THREE.MathUtils.clamp((pElbow.z - pShoulder.z) / upperLen, -0.8, 0.8)
      );
      const neededUpperPitchX = THREE.MathUtils.clamp(
        currentUpperPitchRad + 0.03,
        -0.45,
        0.45
      );

      armBone.quaternion.copy(armEntry.restQuat);
      applyWorldAxisRotation(
        armBone,
        armBone.quaternion,
        WORLD_Z,
        adductSignZ * neededAdductionZ
      );
      applyWorldAxisRotation(
        armBone,
        armBone.quaternion,
        WORLD_X,
        neededUpperPitchX
      );
      armBone.updateMatrixWorld(true);
      armEntry.relaxedQuat.copy(armBone.quaternion);

      // 3. ForeArm (`elbowBone`): Eliminate the stiff "O"-shaped crab elbow!
      //    Extend ForeArm naturally downward by gravity in the front (XY) plane (`~9°` from vertical,
      //    matching the UpperArm line so there is ZERO inward "O" kink!) and pitch it gently
      //    forward around `WORLD_X` by `+0.12 rad` so the hand rests softly toward the front of the thigh!
      if (elbowEntry && elbowEntry.bone && wristBone) {
        elbowBone.quaternion.copy(elbowEntry.restQuat);
        elbowBone.updateMatrixWorld(true);
        elbowBone.getWorldPosition(pElbow);
        wristBone.getWorldPosition(pWrist);

        const foreLen = Math.max(0.01, pElbow.distanceTo(pWrist));
        const sideSign = pElbow.x >= centerX ? 1 : -1;

        // Sweep WORLD_Z and WORLD_X on `elbowBone` to find the exact gravity-draped forearm pose:
        // - In XY: `wristPos.x - elbowPos.x ≈ sideSign * 0.15 * foreLen` (soft straight continuation, NEVER bent inward!)
        // - In YZ: `wristPos.z - elbowPos.z ≈ +0.14 * foreLen` (`+0.12 rad` forward pitch toward front of thigh!)
        const targetWristX = pElbow.x + sideSign * foreLen * 0.15;
        const targetWristY = pElbow.y - foreLen * 0.978;
        const targetWristZ = pElbow.z + foreLen * 0.14;

        let bestZ = 0;
        let bestX = 0;
        let bestErr = Infinity;

        for (let iz = -14; iz <= 14; iz++) {
          const testZ = iz * 0.055;
          for (let ix = -12; ix <= 12; ix++) {
            const testX = ix * 0.055;
            elbowBone.quaternion.copy(elbowEntry.restQuat);
            applyWorldAxisRotation(elbowBone, elbowBone.quaternion, WORLD_Z, testZ);
            applyWorldAxisRotation(elbowBone, elbowBone.quaternion, WORLD_X, testX);
            elbowBone.updateMatrixWorld(true);
            wristBone.getWorldPosition(testPos);

            // Penalize any inward "O"-shape where wrist is closer to centerX than elbow!
            const inwardPenalty =
              Math.abs(testPos.x - centerX) < Math.abs(pElbow.x - centerX)
                ? 2.5
                : 0.0;

            const ex = (testPos.x - targetWristX) / foreLen;
            const ey = (testPos.y - targetWristY) / foreLen;
            const ez = (testPos.z - targetWristZ) / foreLen;
            const err = ex * ex * 3.0 + ey * ey * 2.5 + ez * ez * 2.0 + inwardPenalty;

            if (err < bestErr) {
              bestErr = err;
              bestZ = testZ;
              bestX = testX;
            }
          }
        }

        elbowBone.quaternion.copy(elbowEntry.restQuat);
        applyWorldAxisRotation(elbowBone, elbowBone.quaternion, WORLD_Z, bestZ);
        applyWorldAxisRotation(elbowBone, elbowBone.quaternion, WORLD_X, bestX);
        elbowBone.updateMatrixWorld(true);
        elbowEntry.relaxedQuat.copy(elbowBone.quaternion);
      }

      // 4. Wrist (`wristBone`): Relax wrist slightly inward toward thigh (~6° around WORLD_Z)
      if (wristEntry && wristEntry.bone) {
        const wBone = wristEntry.bone;
        wBone.quaternion.copy(wristEntry.restQuat);
        applyWorldAxisRotation(
          wBone,
          wBone.quaternion,
          WORLD_Z,
          adductSignZ * 0.10
        );
        applyWorldAxisRotation(wBone, wBone.quaternion, WORLD_X, -0.05);
        wBone.updateMatrixWorld(true);
        wristEntry.relaxedQuat.copy(wBone.quaternion);
      }
    };

    calibrateSingleSideArm(
      riggedBones.rightShoulder,
      riggedBones.rightArm,
      riggedBones.rightElbow,
      riggedBones.rightWrist,
      true
    );
    calibrateSingleSideArm(
      riggedBones.leftShoulder,
      riggedBones.leftArm,
      riggedBones.leftElbow,
      riggedBones.leftWrist,
      false
    );

    // Measure raised Left Hand X offset for the 180° Curtain Pull alignment
    if (riggedBones.leftArm && riggedBones.leftArm.bone) {
      const lArmBone = riggedBones.leftArm.bone;
      const lWristBone =
        riggedBones.leftWrist?.bone ||
        riggedBones.leftElbow?.bone ||
        lArmBone;
      lWristBone.getWorldPosition(pWrist);
      leftHandCurtainOffsetX = THREE.MathUtils.clamp(pWrist.x * 0.72, -0.28, 0.28);
    }
  }

  /**
   * Solves Thigh Lift (`WORLD_X`), Thigh Adduction (`WORLD_Z`), and Knee Bend (`WORLD_X`) signs
   * in World Space so Nahida's swing sitting pose (`82°–88°` thigh lift, `80°–85°` knee bend)
   * and curtain knee bounce are 100% anatomically accurate!
   */
  function solveLegWorldSigns() {
    if (!loadedModel) return;
    loadedModel.updateMatrixWorld(true);
    const basePos = new THREE.Vector3();
    const testPos = new THREE.Vector3();

    const solveThighLiftAndAdduct = (legEntry) => {
      if (!legEntry || !legEntry.bone) return { liftX: -1, adductZ: 1 };
      const bone = legEntry.bone;
      const kneeRef = getPrimaryChildBone(bone) || getDistalTipNode(bone);
      if (!kneeRef || kneeRef === bone) return { liftX: -1, adductZ: 1 };

      bone.quaternion.copy(legEntry.restQuat);
      bone.updateMatrixWorld(true);
      kneeRef.getWorldPosition(basePos);
      const baseAbsX = Math.abs(basePos.x);

      // Test +0.35 rad around WORLD_X: lifting thigh forward for sitting moves knee forward (+Z)
      applyWorldAxisRotation(bone, legEntry.restQuat, WORLD_X, 0.35);
      bone.updateMatrixWorld(true);
      kneeRef.getWorldPosition(testPos);
      const liftX = testPos.z > basePos.z ? 1 : -1;

      // Test +0.20 rad around WORLD_Z: adducting thigh moves knee closer to centerline (x = 0)
      applyWorldAxisRotation(bone, legEntry.restQuat, WORLD_Z, 0.20);
      bone.updateMatrixWorld(true);
      kneeRef.getWorldPosition(testPos);
      const adductZ = Math.abs(testPos.x) < baseAbsX ? 1 : -1;

      bone.quaternion.copy(legEntry.restQuat);
      bone.updateMatrixWorld(true);
      return { liftX, adductZ };
    };

    const solveKneeSign = (kneeEntry) => {
      if (!kneeEntry || !kneeEntry.bone) return 1;
      const bone = kneeEntry.bone;
      const footRef = getPrimaryChildBone(bone) || getDistalTipNode(bone);
      if (!footRef || footRef === bone) return 1;

      bone.quaternion.copy(kneeEntry.restQuat);
      bone.updateMatrixWorld(true);
      footRef.getWorldPosition(basePos);

      applyWorldAxisRotation(bone, kneeEntry.restQuat, WORLD_X, 0.25);
      bone.updateMatrixWorld(true);
      footRef.getWorldPosition(testPos);

      bone.quaternion.copy(kneeEntry.restQuat);
      bone.updateMatrixWorld(true);
      // Bending knee moves the ankle/foot backward (-Z)
      return testPos.z < basePos.z ? 1 : -1;
    };

    const rThighSigns = solveThighLiftAndAdduct(riggedBones.rightLeg);
    const lThighSigns = solveThighLiftAndAdduct(riggedBones.leftLeg);
    solvedSigns.rightThighLiftX = rThighSigns.liftX;
    solvedSigns.rightThighAdductZ = rThighSigns.adductZ;
    solvedSigns.leftThighLiftX = lThighSigns.liftX;
    solvedSigns.leftThighAdductZ = lThighSigns.adductZ;

    solvedSigns.rightKneeBendX = solveKneeSign(riggedBones.rightKnee);
    solvedSigns.leftKneeBendX = solveKneeSign(riggedBones.leftKnee);

    // Calibrate natural separated standing leg stance (`relaxedQuat`) & initialize `spinCapturedLegQuats`
    // so Nahida's legs NEVER snap shut like a mannequin during the 360° Showcase Spin!
    const bakeWorldDeltaIntoRelaxed = (entry, pitchX, rollZ) => {
      if (!entry || !entry.bone) return;
      entry.bone.quaternion.copy(entry.restQuat);
      entry.bone.updateMatrixWorld(true);
      applyBoneWorldYPZ(entry, 0, pitchX, rollZ);
      entry.relaxedQuat.copy(entry.bone.quaternion);
      entry.bone.updateMatrixWorld(true);
    };

    // Outward abduction (`±0.08 rad`) + subtle forward thigh (`-0.02 rad`) + soft knee flexion (`0.04 rad`)
    bakeWorldDeltaIntoRelaxed(
      riggedBones.rightLeg,
      -0.02 * solvedSigns.rightKneeBendX,
      -solvedSigns.rightThighAdductZ * 0.08
    );
    bakeWorldDeltaIntoRelaxed(
      riggedBones.leftLeg,
      -0.02 * solvedSigns.leftKneeBendX,
      -solvedSigns.leftThighAdductZ * 0.08
    );
    bakeWorldDeltaIntoRelaxed(
      riggedBones.rightKnee,
      0.04 * solvedSigns.rightKneeBendX,
      0
    );
    bakeWorldDeltaIntoRelaxed(
      riggedBones.leftKnee,
      0.04 * solvedSigns.leftKneeBendX,
      0
    );

    captureCurrentStandingLegPoseForSpin();
  }

  /**
   * HOTFIX V26 SECTION 2: PRESERVE NATURAL RELAXED LEG STANCE DURING 360° SHOWCASE SPIN
   * Stores the live retargeted leg & hip quaternions from Motion 1 / Motion 2 (or the calibrated
   * natural outward-abducted relaxed stance) so when transitioning into `SPIN_360_MODE`,
   * Nahida's legs NEVER reset to the closed mannequin bind pose (`bindLocalQuat` / `restQuat`)!
   */
  const spinCapturedLegQuats = {
    hasCaptured: false,
    hips: new THREE.Quaternion(),
    leftThigh: new THREE.Quaternion(),
    rightThigh: new THREE.Quaternion(),
    leftCalf: new THREE.Quaternion(),
    rightCalf: new THREE.Quaternion(),
    leftFoot: new THREE.Quaternion(),
    rightFoot: new THREE.Quaternion()
  };

  function captureCurrentStandingLegPoseForSpin() {
    if (riggedBones.hips?.bone) {
      spinCapturedLegQuats.hips.copy(riggedBones.hips.bone.quaternion);
    }
    if (riggedBones.leftLeg?.bone) {
      spinCapturedLegQuats.leftThigh.copy(riggedBones.leftLeg.bone.quaternion);
    }
    if (riggedBones.rightLeg?.bone) {
      spinCapturedLegQuats.rightThigh.copy(riggedBones.rightLeg.bone.quaternion);
    }
    if (riggedBones.leftKnee?.bone) {
      spinCapturedLegQuats.leftCalf.copy(riggedBones.leftKnee.bone.quaternion);
    }
    if (riggedBones.rightKnee?.bone) {
      spinCapturedLegQuats.rightCalf.copy(riggedBones.rightKnee.bone.quaternion);
    }
    if (riggedBones.leftFoot?.bone) {
      spinCapturedLegQuats.leftFoot.copy(riggedBones.leftFoot.bone.quaternion);
    }
    if (riggedBones.rightFoot?.bone) {
      spinCapturedLegQuats.rightFoot.copy(riggedBones.rightFoot.bone.quaternion);
    }
    spinCapturedLegQuats.hasCaptured = true;
  }

  /**
   * ==========================================================================
   * SECTION 2.2: ANATOMICAL STAIR-STEP FINGER CURL SOLVER (NO SPLAY!)
   * Collects all finger bones under `LeftHand` & `RightHand` (`handBone.traverse`),
   * finds the exact inward-palm flexion axis (penalizing sideways `Z` splay!),
   * and curls all 5 fingers softly according to Section 2.2:
   * - Thumb:  `10°` (`0.175 rad`)
   * - Index:  `12°/joint` (`0.209 rad`)
   * - Middle: `16°/joint` (`0.279 rad`)
   * - Ring:   `20°/joint` (`0.349 rad`)
   * - Pinky:  `24°/joint` (`0.419 rad`)
   * ==========================================================================
   */
  function detectAndSetupFingerBones(centerX) {
    if (!loadedModel) return;
    loadedModel.updateMatrixWorld(true);

    const candidateBoneSet = new Set();
    const handRoots = [
      riggedBones.rightWrist?.bone,
      riggedBones.leftWrist?.bone
    ].filter(Boolean);

    handRoots.forEach((handBone) => {
      handBone.traverse((child) => {
        if (child === handBone) return;
        if (
          !child.name ||
          /(nub|_end|twist|roll|aux|helper|ik|捩|先|ダミー)/i.test(child.name)
        ) {
          return;
        }
        if (child.isBone) {
          candidateBoneSet.add(child);
        }
      });
    });

    // Fallback search if finger bones aren't direct descendants of `wrist`
    if (candidateBoneSet.size === 0) {
      loadedModel.traverse((node) => {
        if (
          !node.isBone ||
          !node.name ||
          /(nub|_end|twist|roll|aux|helper|toe|foot|捩|先)/i.test(node.name)
        ) {
          return;
        }
        if (/(thumb|index|middle|ring|little|pinky|finger|指|拇|親|食|中|薬|小)/i.test(node.name)) {
          candidateBoneSet.add(node);
        }
      });
    }

    const candidateLocalAxes = [
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, -1, 0)
    ];

    const baseTipPos = new THREE.Vector3();
    const testTipPos = new THREE.Vector3();
    const fWorldPos = new THREE.Vector3();

    const fingerBoneArray = Array.from(candidateBoneSet);
    riggedBones.fingerBones = [];
    const solvedAxisByFingerGroup = new Map();

    fingerBoneArray.forEach((fBone) => {
      fBone.getWorldPosition(fWorldPos);
      const isRightSide = fWorldPos.x < centerX;
      const n = fBone.name.toLowerCase();

      // Section 2.2 Anatomical Stair-Step Curl Angles:
      // Index: 12° (0.209 rad), Middle: 16° (0.279 rad), Ring: 20° (0.349 rad),
      // Pinky: 24° (0.419 rad), Thumb: 10° (0.175 rad)
      let fingerOrder = 2;
      let baseCurlAngle = THREE.MathUtils.degToRad(16);

      if (n.includes('thumb') || n.includes('finger0') || n.includes('拇') || n.includes('親')) {
        fingerOrder = 0;
        baseCurlAngle = THREE.MathUtils.degToRad(10);
      } else if (n.includes('index') || n.includes('finger1') || n.includes('食')) {
        fingerOrder = 1;
        baseCurlAngle = THREE.MathUtils.degToRad(12);
      } else if (n.includes('middle') || n.includes('finger2') || n.includes('中')) {
        fingerOrder = 2;
        baseCurlAngle = THREE.MathUtils.degToRad(16);
      } else if (n.includes('ring') || n.includes('finger3') || n.includes('薬')) {
        fingerOrder = 3;
        baseCurlAngle = THREE.MathUtils.degToRad(20);
      } else if (
        n.includes('little') ||
        n.includes('pinky') ||
        n.includes('finger4') ||
        n.includes('小')
      ) {
        fingerOrder = 4;
        baseCurlAngle = THREE.MathUtils.degToRad(24);
      }

      let jointDepth = 1;
      if (/(02|12|22|32|42|_2|\.2|2$|intermediate|mid)/i.test(n)) jointDepth = 2;
      else if (/(03|13|23|33|43|_3|\.3|3$|distal|tip)/i.test(n)) jointDepth = 3;

      const restQuat = fBone.quaternion.clone();
      const childRef =
        fBone.children && fBone.children.length > 0 ? fBone.children[0] : null;
      const groupKey = `${isRightSide ? 'R' : 'L'}_${fingerOrder}`;

      let bestLocalAxis = new THREE.Vector3(0, 0, isRightSide ? -1 : 1);

      if (childRef) {
        fBone.quaternion.copy(restQuat);
        fBone.updateMatrixWorld(true);
        childRef.getWorldPosition(baseTipPos);
        const baseDistToCenterX = Math.abs(baseTipPos.x - centerX);

        let bestScore = -Infinity;
        for (let c = 0; c < candidateLocalAxes.length; c++) {
          const axis = candidateLocalAxes[c];
          fBone.quaternion.copy(restQuat);
          fBone.rotateOnAxis(axis, 0.35);
          fBone.updateMatrixWorld(true);
          childRef.getWorldPosition(testTipPos);

          const newDistToCenterX = Math.abs(testTipPos.x - centerX);
          // Curling into the palm moves the fingertip INWARD toward the thigh (`inwardDeltaX > 0`)
          // and slightly UPWARD (`upwardDeltaY > 0`), whereas moving along Z is sideways splay!
          const inwardDeltaX = baseDistToCenterX - newDistToCenterX;
          const upwardDeltaY = (testTipPos.y - baseTipPos.y) * 0.35;
          const splayPenaltyZ =
            fingerOrder === 0
              ? 0.0
              : Math.abs(testTipPos.z - baseTipPos.z) * 1.45;

          const score = inwardDeltaX * 2.2 + upwardDeltaY - splayPenaltyZ;
          if (score > bestScore) {
            bestScore = score;
            bestLocalAxis = axis.clone();
          }
        }

        fBone.quaternion.copy(restQuat);
        fBone.updateMatrixWorld(true);
        solvedAxisByFingerGroup.set(groupKey, bestLocalAxis.clone());
      } else if (solvedAxisByFingerGroup.has(groupKey)) {
        // Inherit the exact curl axis from the parent phalanx of the same finger!
        bestLocalAxis = solvedAxisByFingerGroup.get(groupKey).clone();
      }

      riggedBones.fingerBones.push({
        bone: fBone,
        restQuat,
        curlAxisVec: bestLocalAxis,
        baseCurlAngle,
        fingerOrder,
        jointDepth,
        isRightSide,
        phaseOffset:
          fingerOrder * 0.42 + jointDepth * 0.25 + (isRightSide ? 0 : 0.6)
      });
    });

    // Apply initial anatomical stair-step finger curl
    riggedBones.fingerBones.forEach((fb) => {
      fb.bone.quaternion.copy(fb.restQuat);
      fb.bone.rotateOnAxis(fb.curlAxisVec, fb.baseCurlAngle);
    });
    loadedModel.updateMatrixWorld(true);
  }

  /**
   * ==========================================================================
   * SECTION 3.1: 100% ACCURATE `Spine -> Chest -> Neck -> Head` & LIMB DISCOVERY
   * Combines:
   * 1. Unanchored Regex (handles any prefix/suffix like `Bip001_`, `Klee_`, `DEF-`, `mixamorig:`, Chinese/Japanese)
   * 2. Lowest Common Ancestor (`LCA`) of Left & Right Arms -> `chestBone`
   * 3. Centerline World-Y Sorting (`Math.abs(boneWorldPos.x - centerX) < charWidth * 0.12`)
   *    ascending from hips (`0.5 * H`) to top of head (`0.85 * H`)!
   * ==========================================================================
   */
  function discoverAllKleeBonesAndSetupPoses() {
    if (!loadedModel) return;
    loadedModel.updateMatrixWorld(true);

    const modelBox = new THREE.Box3().setFromObject(loadedModel);
    const min = modelBox.min;
    const max = modelBox.max;
    const H = Math.max(0.001, max.y - min.y);
    const W = Math.max(0.001, max.x - min.x);
    const centerX = (min.x + max.x) * 0.5;

    // Collect all bones from both `traverse` and `SkinnedMesh.skeleton.bones`
    const allBoneSet = new Set();
    loadedModel.traverse((node) => {
      if (node.isBone) {
        allBoneSet.add(node);
      }
      if (node.isSkinnedMesh && node.skeleton && Array.isArray(node.skeleton.bones)) {
        node.skeleton.bones.forEach((b) => {
          if (b) allBoneSet.add(b);
        });
      }
    });
    const allBones = Array.from(allBoneSet);

    const isRightBoneName = (n) =>
      /(^r[_\s.-]|_r$|\.r$|-r$|_r_|[_\s.-]r[_\s.-]|\bright|bip001[_\s-]*r[_\s-]|mixamorig:?right|右)/i.test(
        n
      );
    const isLeftBoneName = (n) =>
      /(^l[_\s.-]|_l$|\.l$|-l$|_l_|[_\s.-]l[_\s.-]|\bleft|bip001[_\s-]*l[_\s-]|mixamorig:?left|左)/i.test(
        n
      );

    // Layer 1: Unanchored Regex Bone Discovery (excluding Twist/Roll/Nub helper bones)
    allBones.forEach((node) => {
      if (!node.name || node.name.includes('_end')) return;
      const n = node.name;
      const isHelperOrTwist =
        /(twist|roll|aux|adj|fix|helper|ik|target|pole|nub|_end|捩|先|ダミー)/i.test(n);

      if (!isHelperOrTwist) {
        if (
          !riggedBones.hips &&
          /(hips|pelvis|root[_\s.-]*ground|下半身|センター|盆骨|骨盆)/i.test(n) &&
          !/(skirt|dress|leg|thigh|butt)/i.test(n)
        ) {
          riggedBones.hips = captureBoneEntry(node);
          return;
        }
        if (
          !riggedBones.head &&
          /(head|頭|头)/i.test(n) &&
          !/(nub|end|top|tip|hair|hat|cap|ear|eye|brow|lash|lid|mouth|lip|tooth|teeth|tongue|jaw|cheek|nose|front|back|side)/i.test(
            n
          )
        ) {
          riggedBones.head = captureBoneEntry(node);
          return;
        }
        if (
          !riggedBones.neck &&
          /(neck|首|颈|脖子)/i.test(n) &&
          !/(nub|end|bow|ribbon|scarf|collar|tie|hair)/i.test(n)
        ) {
          riggedBones.neck = captureBoneEntry(node);
          return;
        }
        if (
          !riggedBones.chest &&
          /(upper[_\s.-]*chest|chest|spine[_\s.-]*0?[23]|spine2|spine3|thorax|上半身2|胸)/i.test(
            n
          ) &&
          !/(breast|bust)/i.test(n)
        ) {
          riggedBones.chest = captureBoneEntry(node);
          return;
        }
        if (
          !riggedBones.upperBody &&
          /(upper[_\s.-]*body|spine[_\s.-]*0?1|spine1|上半身1)/i.test(n)
        ) {
          riggedBones.upperBody = captureBoneEntry(node);
          return;
        }
        if (
          !riggedBones.spine &&
          /(spine|waist|abdomen|torso|上半身)/i.test(n) &&
          !/(spine[_\s.-]*0?[123]|spine1|spine2|spine3|上半身[12])/i.test(n)
        ) {
          riggedBones.spine = captureBoneEntry(node);
          return;
        }

        // Right & Left Clavicle / Shoulder
        if (/(shoulder|clavicle|collar|肩)/i.test(n)) {
          if (!riggedBones.rightShoulder && isRightBoneName(n)) {
            riggedBones.rightShoulder = captureBoneEntry(node);
            return;
          }
          if (!riggedBones.leftShoulder && isLeftBoneName(n)) {
            riggedBones.leftShoulder = captureBoneEntry(node);
            return;
          }
        }

        // Right & Left UpperArm
        if (
          /(upper[_\s.-]*arm|up[_\s.-]*arm|\barm\b|leftarm|rightarm|腕|大臂|上臂)/i.test(
            n
          ) &&
          !/(fore|low|lower|hand|wrist|finger|thumb|collar|shoulder|clavicle|小臂|前臂)/i.test(
            n
          )
        ) {
          if (!riggedBones.rightArm && isRightBoneName(n)) {
            riggedBones.rightArm = captureBoneEntry(node);
            return;
          }
          if (!riggedBones.leftArm && isLeftBoneName(n)) {
            riggedBones.leftArm = captureBoneEntry(node);
            return;
          }
        }

        // Right & Left ForeArm / Elbow
        if (
          /(fore[_\s.-]*arm|low[_\s.-]*arm|lower[_\s.-]*arm|elbow|ひじ|肘|小臂|前臂)/i.test(
            n
          )
        ) {
          if (!riggedBones.rightElbow && isRightBoneName(n)) {
            riggedBones.rightElbow = captureBoneEntry(node);
            return;
          }
          if (!riggedBones.leftElbow && isLeftBoneName(n)) {
            riggedBones.leftElbow = captureBoneEntry(node);
            return;
          }
        }

        // Right & Left Hand / Wrist
        if (
          /(hand|wrist|手首|左手$|右手$|手掌)/i.test(n) &&
          !/(finger|thumb|index|middle|ring|pinky|little|palm)/i.test(n)
        ) {
          if (!riggedBones.rightWrist && isRightBoneName(n)) {
            riggedBones.rightWrist = captureBoneEntry(node);
            return;
          }
          if (!riggedBones.leftWrist && isLeftBoneName(n)) {
            riggedBones.leftWrist = captureBoneEntry(node);
            return;
          }
        }

        // Right & Left Thigh / UpperLeg
        if (
          /(upleg|up[_\s.-]*leg|upper[_\s.-]*leg|thigh|femur|hip[_\s.-]*[lr]|leg[_\s.-]*0?1|leg[_\s.-]*[lr]|\bleg\b|leftupleg|rightupleg|左足$|右足$|足$|腿|大腿)/i.test(
            n
          ) &&
          !/(low|lower|calf|shin|knee|foot|ankle|toe|leg[_\s.-]*0?[23]|skirt|dress|小腿|ひざ|足首)/i.test(
            n
          )
        ) {
          if (!riggedBones.rightLeg && isRightBoneName(n)) {
            riggedBones.rightLeg = captureBoneEntry(node);
            return;
          }
          if (!riggedBones.leftLeg && isLeftBoneName(n)) {
            riggedBones.leftLeg = captureBoneEntry(node);
            return;
          }
        }

        // Right & Left Knee / Calf
        if (
          /(calf|shin|low[_\s.-]*leg|lower[_\s.-]*leg|knee|leg[_\s.-]*0?2|leftleg$|rightleg$|ひざ|膝|脛|小腿)/i.test(
            n
          ) &&
          !/(foot|ankle|toe|skirt|dress|足首)/i.test(n)
        ) {
          if (!riggedBones.rightKnee && isRightBoneName(n)) {
            riggedBones.rightKnee = captureBoneEntry(node);
            return;
          }
          if (!riggedBones.leftKnee && isLeftBoneName(n)) {
            riggedBones.leftKnee = captureBoneEntry(node);
            return;
          }
        }

        // Right & Left Foot / Ankle
        if (/(foot|ankle|leg[_\s.-]*0?3|足首|脚踝|脚$)/i.test(n) && !/(toe|つま先)/i.test(n)) {
          if (!riggedBones.rightFoot && isRightBoneName(n)) {
            riggedBones.rightFoot = captureBoneEntry(node);
            return;
          }
          if (!riggedBones.leftFoot && isLeftBoneName(n)) {
            riggedBones.leftFoot = captureBoneEntry(node);
            return;
          }
        }

        // Right & Left Toe
        if (/(toe|つま先|脚趾)/i.test(n)) {
          if (!riggedBones.rightToe && isRightBoneName(n)) {
            riggedBones.rightToe = captureBoneEntry(node);
            return;
          }
          if (!riggedBones.leftToe && isLeftBoneName(n)) {
            riggedBones.leftToe = captureBoneEntry(node);
            return;
          }
        }
      }

      // Secondary Physics Chains (Hair/Ponytail/Sidehair, Dress/Skirt/Cape, Leaf/Ornaments/Accessories)
      if (!/(nub|_end)/i.test(n)) {
        if (
          /(tail_|shair|bhair|fhair|daimao|hair|pigtail|ponytail|sidehair|fronthair|backhair|twintail|braid|bang|ahoge|髪|发)/i.test(
            n
          )
        ) {
          const idxMatch = n.match(/(\d+)/);
          const depth = idxMatch ? Math.min(6, parseInt(idxMatch[1], 10) || 1) : 1;
          riggedBones.hairChains.push(
            captureBoneEntry(node, riggedBones.hairChains.length * 0.37, depth)
          );
        } else if (
          /(dress|skirt|pleat|frill|hem|coat|apron|cape|cloak|veil|shawl|スカート|裾|裙|披风)/i.test(n)
        ) {
          const idxMatch = n.match(/(\d+)/g);
          const row =
            idxMatch && idxMatch.length > 1
              ? parseInt(idxMatch[1], 10)
              : idxMatch
              ? parseInt(idxMatch[0], 10)
              : 1;
          if (row <= 8) {
            riggedBones.skirtChains.push(
              captureBoneEntry(
                node,
                riggedBones.skirtChains.length * 0.65 + row * 0.3,
                Math.max(1, Math.min(6, row))
              )
            );
          }
        } else if (
          /(hat|cap|beret|brim|ear|bag|backpack|pack|dodoco|pom|charm|strap|neckbow|ribbon|bow|flower|scarf|collar|sleeve|clover|leaf|ornament|bell|tassel|pendant|dendro|帽子|耳|鞄|リボン|袖|包|叶|饰)/i.test(
            n
          )
        ) {
          riggedBones.accessoryChains.push(
            captureBoneEntry(node, riggedBones.accessoryChains.length * 0.5, 1)
          );
        }
      }
    });

    // ========================================================================
    // SECTION 2.2: 3D BIND-POSE WORLD-POSITION & HIERARCHY DISCOVERY FOR
    // HIPS, THIGHS (`leftThigh`/`rightThigh`), CALVES (`leftCalf`/`rightCalf`),
    // FEET (`leftFoot`/`rightFoot`) & ARMS (`UpperArm -> ForeArm -> Hand`)
    // ========================================================================
    const wpA = new THREE.Vector3();
    const wpB = new THREE.Vector3();
    const wpC = new THREE.Vector3();

    const isNonLimbBoneName = (name) =>
      !name ||
      /(nub|_end|twist|roll|aux|adj|fix|helper|ik|target|pole|hair|shair|bhair|fhair|tail|skirt|dress|pleat|frill|hem|coat|apron|cape|cloak|veil|shawl|ribbon|bow|flower|clover|leaf|bell|tassel|pendant|butt|スカート|裾|裙|髪|リボン|捩|先|ダミー)/i.test(
        name
      );

    const findDownwardLegChildBone = (parentBone, minDropY) => {
      if (!parentBone || !parentBone.children) return null;
      parentBone.getWorldPosition(wpA);
      let bestChild = null;
      let bestDrop = -Infinity;

      const candidates = [];
      for (let i = 0; i < parentBone.children.length; i++) {
        const ch = parentBone.children[i];
        if (ch && ch.isBone) {
          candidates.push(ch);
          // Also check 1 level deeper in case of intermediate twist/adj node
          if (/(twist|roll|adj|aux)/i.test(ch.name || '') && ch.children) {
            for (let j = 0; j < ch.children.length; j++) {
              if (ch.children[j]?.isBone) candidates.push(ch.children[j]);
            }
          }
        }
      }

      for (let i = 0; i < candidates.length; i++) {
        const ch = candidates[i];
        if (isNonLimbBoneName(ch.name)) continue;
        ch.getWorldPosition(wpB);
        const dropY = wpA.y - wpB.y;
        const lateralDrift = Math.abs(wpB.x - wpA.x);
        if (dropY >= minDropY && lateralDrift < H * 0.14) {
          const score = dropY - lateralDrift * 0.5;
          if (score > bestDrop) {
            bestDrop = score;
            bestChild = ch;
          }
        }
      }
      return bestChild;
    };

    // Verify or discover Left & Right Thigh -> Calf -> Foot chains using 3D Bind-Pose coordinates:
    // - Thighs: `Math.abs(pos.x - centerX)` in `[0.02 * H, 0.22 * H]`, `relY` in `[0.38, 0.58]`,
    //   with direct child `calf` lower by `>= 0.05 * H` (`calfRelY` in `[0.18, 0.38]`),
    //   and `calf`'s child `foot` at `footRelY < 0.18`!
    let bestRightLegChain = null;
    let bestRightScore = -Infinity;
    let bestLeftLegChain = null;
    let bestLeftScore = -Infinity;

    allBones.forEach((b) => {
      if (isNonLimbBoneName(b.name)) return;
      if (
        /(arm|elbow|hand|wrist|finger|thumb|index|middle|ring|pinky|shoulder|clavicle|collar|head|neck|spine|chest|eye|mouth|tooth|tongue)/i.test(
          b.name || ''
        )
      ) {
        return;
      }

      b.getWorldPosition(wpA);
      const relY = (wpA.y - min.y) / H;
      const dx = wpA.x - centerX;
      const absDx = Math.abs(dx);

      if (absDx < 0.018 * H || absDx > 0.24 * H) return;
      if (relY < 0.36 || relY > 0.60) return;

      const calfBone = findDownwardLegChildBone(b, 0.05 * H);
      if (!calfBone) return;
      calfBone.getWorldPosition(wpB);
      const calfRelY = (wpB.y - min.y) / H;
      if (calfRelY < 0.14 || calfRelY > 0.42) return;

      const footBone = findDownwardLegChildBone(calfBone, 0.04 * H);
      let footRelY = calfRelY - 0.12;
      if (footBone) {
        footBone.getWorldPosition(wpC);
        footRelY = (wpC.y - min.y) / H;
      }

      const verticalSpan = relY - footRelY;
      const nameBonus = /(upleg|thigh|femur|leg|足|腿|大腿)/i.test(b.name || '') ? 0.35 : 0.0;
      const chainScore = verticalSpan + (footBone ? 0.25 : 0.0) + nameBonus;

      if (dx < 0) {
        if (chainScore > bestRightScore) {
          bestRightScore = chainScore;
          bestRightLegChain = { thigh: b, calf: calfBone, foot: footBone };
        }
      } else {
        if (chainScore > bestLeftScore) {
          bestLeftScore = chainScore;
          bestLeftLegChain = { thigh: b, calf: calfBone, foot: footBone };
        }
      }
    });

    if (bestRightLegChain) {
      if (
        !riggedBones.rightLeg ||
        !findDownwardLegChildBone(riggedBones.rightLeg.bone, 0.04 * H)
      ) {
        riggedBones.rightLeg = captureBoneEntry(bestRightLegChain.thigh);
      }
      if (!riggedBones.rightKnee && bestRightLegChain.calf) {
        riggedBones.rightKnee = captureBoneEntry(bestRightLegChain.calf);
      }
      if (!riggedBones.rightFoot && bestRightLegChain.foot) {
        riggedBones.rightFoot = captureBoneEntry(bestRightLegChain.foot);
      }
    }

    if (bestLeftLegChain) {
      if (
        !riggedBones.leftLeg ||
        !findDownwardLegChildBone(riggedBones.leftLeg.bone, 0.04 * H)
      ) {
        riggedBones.leftLeg = captureBoneEntry(bestLeftLegChain.thigh);
      }
      if (!riggedBones.leftKnee && bestLeftLegChain.calf) {
        riggedBones.leftKnee = captureBoneEntry(bestLeftLegChain.calf);
      }
      if (!riggedBones.leftFoot && bestLeftLegChain.foot) {
        riggedBones.leftFoot = captureBoneEntry(bestLeftLegChain.foot);
      }
    }

    // Complete any missing links in `Thigh -> Calf -> Foot -> Toe` by direct hierarchy
    if (riggedBones.rightLeg && !riggedBones.rightKnee) {
      const ch =
        findDownwardLegChildBone(riggedBones.rightLeg.bone, 0.04 * H) ||
        getPrimaryChildBone(riggedBones.rightLeg.bone);
      if (ch) riggedBones.rightKnee = captureBoneEntry(ch);
    }
    if (riggedBones.rightKnee && !riggedBones.rightFoot) {
      const ch =
        findDownwardLegChildBone(riggedBones.rightKnee.bone, 0.03 * H) ||
        getPrimaryChildBone(riggedBones.rightKnee.bone);
      if (ch) riggedBones.rightFoot = captureBoneEntry(ch);
    }
    if (riggedBones.rightFoot && !riggedBones.rightToe) {
      const ch = getPrimaryChildBone(riggedBones.rightFoot.bone);
      if (ch) riggedBones.rightToe = captureBoneEntry(ch);
    }

    if (riggedBones.leftLeg && !riggedBones.leftKnee) {
      const ch =
        findDownwardLegChildBone(riggedBones.leftLeg.bone, 0.04 * H) ||
        getPrimaryChildBone(riggedBones.leftLeg.bone);
      if (ch) riggedBones.leftKnee = captureBoneEntry(ch);
    }
    if (riggedBones.leftKnee && !riggedBones.leftFoot) {
      const ch =
        findDownwardLegChildBone(riggedBones.leftKnee.bone, 0.03 * H) ||
        getPrimaryChildBone(riggedBones.leftKnee.bone);
      if (ch) riggedBones.leftFoot = captureBoneEntry(ch);
    }
    if (riggedBones.leftFoot && !riggedBones.leftToe) {
      const ch = getPrimaryChildBone(riggedBones.leftFoot.bone);
      if (ch) riggedBones.leftToe = captureBoneEntry(ch);
    }

    // Discover Hips via LCA of Left & Right Thighs if not found by regex
    if (!riggedBones.hips && riggedBones.leftLeg && riggedBones.rightLeg) {
      const lcaHips = getLowestCommonAncestorBone(
        riggedBones.leftLeg.bone,
        riggedBones.rightLeg.bone
      );
      if (lcaHips) {
        riggedBones.hips = captureBoneEntry(lcaHips);
      }
    }

    // Spatial World-Position Fallback for Arms if non-standard bone names are used
    if (!riggedBones.rightArm || !riggedBones.leftArm) {
      const wp = new THREE.Vector3();
      const childWp = new THREE.Vector3();
      allBones.forEach((b) => {
        if (!b.name || /(nub|_end|twist|roll|aux|helper|hair|skirt|dress|cape|ribbon|leaf)/i.test(b.name)) return;
        const ch = getPrimaryChildBone(b);
        const grandCh = ch ? getPrimaryChildBone(ch) : null;
        if (!ch || !grandCh) return;
        b.getWorldPosition(wp);
        ch.getWorldPosition(childWp);
        const relY = (wp.y - min.y) / H;
        const offsetX = wp.x - centerX;
        const segLen = wp.distanceTo(childWp);
        // Shoulder/UpperArm region: relY in [0.52, 0.78], lateral offset > 0.06 * W
        if (relY >= 0.52 && relY <= 0.78 && Math.abs(offsetX) > W * 0.06 && segLen > H * 0.05) {
          if (offsetX < 0 && !riggedBones.rightArm) {
            riggedBones.rightArm = captureBoneEntry(b);
          } else if (offsetX > 0 && !riggedBones.leftArm) {
            riggedBones.leftArm = captureBoneEntry(b);
          }
        }
      });
    }

    // Layer 2: Verify Parent-Child Chain for Arms (`Shoulder -> UpperArm -> ForeArm -> Wrist`)
    if (riggedBones.rightElbow && riggedBones.rightArm) {
      if (
        !isBoneAncestorOf(riggedBones.rightArm.bone, riggedBones.rightElbow.bone) &&
        riggedBones.rightElbow.bone.parent?.isBone
      ) {
        riggedBones.rightArm = captureBoneEntry(riggedBones.rightElbow.bone.parent);
      }
    }
    if (riggedBones.leftElbow && riggedBones.leftArm) {
      if (
        !isBoneAncestorOf(riggedBones.leftArm.bone, riggedBones.leftElbow.bone) &&
        riggedBones.leftElbow.bone.parent?.isBone
      ) {
        riggedBones.leftArm = captureBoneEntry(riggedBones.leftElbow.bone.parent);
      }
    }
    if (riggedBones.rightArm && !riggedBones.rightElbow) {
      const ch = getPrimaryChildBone(riggedBones.rightArm.bone);
      if (ch) riggedBones.rightElbow = captureBoneEntry(ch);
    }
    if (riggedBones.rightElbow && !riggedBones.rightWrist) {
      const ch = getPrimaryChildBone(riggedBones.rightElbow.bone);
      if (ch) riggedBones.rightWrist = captureBoneEntry(ch);
    }
    if (riggedBones.leftArm && !riggedBones.leftElbow) {
      const ch = getPrimaryChildBone(riggedBones.leftArm.bone);
      if (ch) riggedBones.leftElbow = captureBoneEntry(ch);
    }
    if (riggedBones.leftElbow && !riggedBones.leftWrist) {
      const ch = getPrimaryChildBone(riggedBones.leftElbow.bone);
      if (ch) riggedBones.leftWrist = captureBoneEntry(ch);
    }
    if (
      riggedBones.rightArm &&
      !riggedBones.rightShoulder &&
      riggedBones.rightArm.bone.parent?.isBone
    ) {
      const p = riggedBones.rightArm.bone.parent;
      const pn = p.name || '';
      if (/(shoulder|clavicle|collar|肩)/i.test(pn)) {
        riggedBones.rightShoulder = captureBoneEntry(p);
      }
    }
    if (
      riggedBones.leftArm &&
      !riggedBones.leftShoulder &&
      riggedBones.leftArm.bone.parent?.isBone
    ) {
      const p = riggedBones.leftArm.bone.parent;
      const pn = p.name || '';
      if (/(shoulder|clavicle|collar|肩)/i.test(pn)) {
        riggedBones.leftShoulder = captureBoneEntry(p);
      }
    }

    // Bind convenient aliases (`leftThigh`/`rightThigh`, `leftCalf`/`rightCalf`, `leftUpperArm`, etc.)
    riggedBones.leftThigh = riggedBones.leftLeg;
    riggedBones.rightThigh = riggedBones.rightLeg;
    riggedBones.leftCalf = riggedBones.leftKnee;
    riggedBones.rightCalf = riggedBones.rightKnee;
    riggedBones.leftUpperArm = riggedBones.leftArm;
    riggedBones.rightUpperArm = riggedBones.rightArm;
    riggedBones.leftForeArm = riggedBones.leftElbow;
    riggedBones.rightForeArm = riggedBones.rightElbow;
    riggedBones.leftHand = riggedBones.leftWrist;
    riggedBones.rightHand = riggedBones.rightWrist;

    // Layer 3: Section 3.1 Centerline World-Y Sorting + Lowest Common Ancestor (`LCA`)
    // Ensures `Spine -> Chest -> Neck -> Head` are 100% mapped!
    if (riggedBones.leftArm && riggedBones.rightArm) {
      const lcaChest = getLowestCommonAncestorBone(
        riggedBones.leftArm.bone,
        riggedBones.rightArm.bone
      );
      if (lcaChest && !riggedBones.chest) {
        riggedBones.chest = captureBoneEntry(lcaChest);
      }
      if (
        riggedBones.chest &&
        !riggedBones.spine &&
        riggedBones.chest.bone.parent?.isBone
      ) {
        const p = riggedBones.chest.bone.parent;
        if (p !== riggedBones.hips?.bone) {
          riggedBones.spine = captureBoneEntry(p);
        }
      }
    }

    // Sort all centerline bones (`Math.abs(boneWorldPos.x - centerX) < W * 0.12`) by World Y
    const bWorldPos = new THREE.Vector3();
    const centerlineBones = [];

    allBones.forEach((b) => {
      const n = b.name || '';
      if (
        /(nub|_end|twist|roll|aux|helper|hair|shair|bhair|fhair|tail|daimao|hat|cap|ear|eye|brow|lash|lid|tooth|teeth|tongue|lip|jaw|mouth|nose|cheek|skirt|dress|coat|bag|backpack|dodoco|ribbon|bow|flower|clover|finger|thumb|index|middle|ring|pinky|hand|wrist|forearm|elbow|upperarm|shoulder|clavicle|thigh|calf|knee|shin|foot|ankle|toe)/i.test(
          n
        )
      ) {
        return;
      }
      b.getWorldPosition(bWorldPos);
      const relY = (bWorldPos.y - min.y) / H;
      if (
        Math.abs(bWorldPos.x - centerX) < W * 0.12 &&
        relY >= 0.35 &&
        relY <= 0.88
      ) {
        centerlineBones.push({ bone: b, y: bWorldPos.y, relY });
      }
    });

    centerlineBones.sort((a, b) => a.y - b.y);

    if (centerlineBones.length > 0) {
      if (!riggedBones.head) {
        const topAxial = centerlineBones[centerlineBones.length - 1];
        if (topAxial.relY >= 0.52) {
          riggedBones.head = captureBoneEntry(topAxial.bone);
        }
      }
      if (riggedBones.head && !riggedBones.neck) {
        const p = riggedBones.head.bone.parent;
        if (
          p &&
          p.isBone &&
          p !== riggedBones.chest?.bone &&
          p !== riggedBones.spine?.bone
        ) {
          riggedBones.neck = captureBoneEntry(p);
        } else if (centerlineBones.length >= 2) {
          const secondTop = centerlineBones[centerlineBones.length - 2];
          if (secondTop.bone !== riggedBones.head.bone) {
            riggedBones.neck = captureBoneEntry(secondTop.bone);
          }
        }
      }
      if (!riggedBones.chest && centerlineBones.length >= 3) {
        const chestCand = centerlineBones[Math.max(0, centerlineBones.length - 3)];
        if (
          chestCand.bone !== riggedBones.head?.bone &&
          chestCand.bone !== riggedBones.neck?.bone
        ) {
          riggedBones.chest = captureBoneEntry(chestCand.bone);
        }
      }
      if (!riggedBones.spine && centerlineBones.length >= 4) {
        const spineCand = centerlineBones[Math.max(0, centerlineBones.length - 4)];
        if (
          spineCand.bone !== riggedBones.chest?.bone &&
          spineCand.bone !== riggedBones.hips?.bone
        ) {
          riggedBones.spine = captureBoneEntry(spineCand.bone);
        }
      }
    }

    // Record neck world pivot for any non-skinned head/hat vertex fallback
    const neckRefBone = riggedBones.neck?.bone || riggedBones.head?.bone;
    if (neckRefBone) {
      neckRefBone.getWorldPosition(neckPivotLocalPos);
    } else {
      neckPivotLocalPos.set(centerX, min.y + H * 0.62, 0);
    }

    // Check if any mesh with vertices above `neckY` is NOT skinned to `headBone`/`neckBone`
    headFallbackMeshes.length = 0;
    const headBoneRef = riggedBones.head?.bone;
    const neckBoneRef = riggedBones.neck?.bone;

    loadedModel.traverse((child) => {
      if (!child.isMesh || !child.geometry?.attributes?.position) return;
      const isSkinnedToHead =
        child.isSkinnedMesh &&
        child.skeleton &&
        Array.isArray(child.skeleton.bones) &&
        (child.skeleton.bones.includes(headBoneRef) ||
          child.skeleton.bones.includes(neckBoneRef));

      if (!isSkinnedToHead) {
        const posAttr = child.geometry.attributes.position;
        const count = posAttr.count;
        const restPositions = new Float32Array(count * 3);
        const headWeights = new Float32Array(count);
        const vWorld = new THREE.Vector3();
        let hasHeadVerts = false;

        child.updateMatrixWorld(true);
        for (let i = 0; i < count; i++) {
          const lx = posAttr.getX(i);
          const ly = posAttr.getY(i);
          const lz = posAttr.getZ(i);
          restPositions[i * 3] = lx;
          restPositions[i * 3 + 1] = ly;
          restPositions[i * 3 + 2] = lz;

          vWorld.set(lx, ly, lz).applyMatrix4(child.matrixWorld);
          if (vWorld.y > neckPivotLocalPos.y) {
            const w = Math.min(
              1.0,
              (vWorld.y - neckPivotLocalPos.y) / Math.max(0.05, H * 0.08)
            );
            headWeights[i] = w;
            hasHeadVerts = true;
          }
        }

        if (hasHeadVerts) {
          headFallbackMeshes.push({
            mesh: child,
            posAttr,
            restPositions,
            headWeights
          });
        }
      }
    });

    hasRiggedArmBones = Boolean(riggedBones.rightArm && riggedBones.leftArm);

    if (hasRiggedArmBones) {
      solveNaturalRelaxedArmAndElbowPose(centerX);
      solveLegWorldSigns();
      detectAndSetupFingerBones(centerX);
    }
  }

  /**
   * ==========================================================================
   * UPDATE V43 SECTION 3: CRASH-FREE GENSHIN NAHIDA WARM PEACH SKIN, HAIR SHADOW,
   * KNEE ARTICULATION BLUSH & CHEEK BLUSH
   * (`Canvas2D Skin Texture Grading` + `Vertex-Color Blush/Shadow Baking` + `Warm Key/Fill Lighting`)
   * - Zero `material.onBeforeCompile` custom GLSL strings -> 100% crash-free across all GPUs!
   * - Every function is wrapped in `try { ... } catch (err) { console.warn(err); }`
   *   so any unexpected texture/geometry edge case safely falls back without breaking rendering.
   * ==========================================================================
   */
  const gradedSkinTextureCache = new Map();

  function classifyNahidaMaterialRole(meshNameLower, matNameLower) {
    const combined = `${meshNameLower} ${matNameLower}`;
    const isHairOnly =
      /(hair|bang|ahoge|braid|pigtail|ponytail|sidehair|fronthair|backhair|髪|发)/i.test(combined) &&
      !/(face|body|skin|leg|arm)/i.test(combined);
    const isClothOrOrnamentOnly =
      /(cape|cloak|veil|shawl|ornament|leaf|clover|bell|tassel|pendant|gem|metal|gold)/i.test(
        combined
      ) && !/(body|skin|face|leg|arm|hand|foot)/i.test(combined);
    const isExplicitFace = /(face|head|visage|brow|lash|eye|mouth|cheek|顔|面|头)/i.test(combined);
    const isExplicitSkinOrBody =
      /(skin|body|flesh|leg|thigh|knee|calf|foot|toe|arm|hand|finger|neck|torso|chest|肌|体|身体|腿|手|足)/i.test(
        combined
      );
    return {
      isHairOnly,
      isClothOrOrnamentOnly,
      isExplicitFace,
      isExplicitSkinOrBody
    };
  }

  function gradeNahidaSkinTextureCanvas2D(sourceTex, roleFlags = {}) {
    if (!sourceTex) return sourceTex;
    try {
      if (roleFlags.isHairOnly || roleFlags.isClothOrOrnamentOnly) {
        return sourceTex;
      }
      const cacheKey = `${sourceTex.uuid}_${roleFlags.isExplicitFace ? 1 : 0}_${roleFlags.isExplicitSkinOrBody ? 1 : 0}`;
      if (gradedSkinTextureCache.has(cacheKey)) {
        return gradedSkinTextureCache.get(cacheKey);
      }

      const img = sourceTex.image;
      const w = img ? img.width || img.videoWidth || img.naturalWidth || 0 : 0;
      const h = img ? img.height || img.videoHeight || img.naturalHeight || 0 : 0;
      if (!img || w <= 0 || h <= 0 || typeof document === 'undefined') {
        return sourceTex;
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return sourceTex;

      ctx.drawImage(img, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);
      const data = imgData.data;

      const gridRes = 64;
      const skinMaskGrid = new Uint8Array(gridRes * gridRes);
      const isSkinOrFaceHint = Boolean(roleFlags.isExplicitFace || roleFlags.isExplicitSkinOrBody);
      const minRMinusB = isSkinOrFaceHint ? 6 : 10;
      const minRMinusG = isSkinOrFaceHint ? 2 : 3;

      for (let py = 0; py < h; py++) {
        const gy = Math.min(gridRes - 1, Math.floor((py / h) * gridRes));
        const rowOffset = py * w * 4;
        for (let px = 0; px < w; px++) {
          const idx = rowOffset + px * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const a = data[idx + 3];
          if (a < 16) continue;

          // Layer A1 Skin Pixel Detection:
          // R > 215, G > 185, B > 165, (R - B) >= 10, (R - G) >= 3, and G <= R
          // Strictly excludes white dress/hair (where R ≈ G ≈ B) and green leaves (where G > R)!
          const isSkinTexel =
            r > 215 &&
            g > 185 &&
            b > 165 &&
            r - b >= minRMinusB &&
            r - g >= minRMinusG &&
            g <= r;

          if (isSkinTexel) {
            // Grade to Genshin Warm Creamy Peach (`#FFE8DA` lit / `#E8AD96` shaded depth):
            // Keep R warm (R * 1.01), G <- G * 0.925, B <- B * 0.855
            data[idx] = Math.min(255, Math.round(r * 1.01));
            data[idx + 1] = Math.min(255, Math.round(g * 0.925));
            data[idx + 2] = Math.min(255, Math.round(b * 0.855));

            const gx = Math.min(gridRes - 1, Math.floor((px / w) * gridRes));
            skinMaskGrid[gy * gridRes + gx] = 1;
          }
        }
      }

      ctx.putImageData(imgData, 0, 0);

      const gradedTex = new THREE.CanvasTexture(canvas);
      gradedTex.name = `${sourceTex.name || 'nahida_tex'}_warm_peach_v43`;
      gradedTex.colorSpace = THREE.SRGBColorSpace;
      gradedTex.flipY = sourceTex.flipY;
      gradedTex.wrapS = sourceTex.wrapS;
      gradedTex.wrapT = sourceTex.wrapT;
      gradedTex.magFilter = sourceTex.magFilter;
      gradedTex.minFilter = sourceTex.minFilter;
      gradedTex.anisotropy = 8;
      gradedTex.userData = {
        ...(sourceTex.userData || {}),
        __skinMaskGrid: skinMaskGrid,
        __skinMaskGridRes: gridRes
      };
      gradedTex.needsUpdate = true;

      gradedSkinTextureCache.set(cacheKey, gradedTex);
      return gradedTex;
    } catch (err) {
      console.warn('gradeNahidaSkinTextureCanvas2D fallback:', err);
      return sourceTex;
    }
  }

  function bakeNahidaSkinBlushAndHairShadowVertexColors() {
    try {
      if (!loadedModel) return;
      loadedModel.updateMatrixWorld(true);

      const headWp = new THREE.Vector3(0, charHeight * 0.78, 0);
      const neckWp = new THREE.Vector3(0, charHeight * 0.66, 0);
      const hipsWp = new THREE.Vector3(0, charHeight * 0.45, 0);
      const leftKneeWp = new THREE.Vector3(0.09, charHeight * 0.23, 0.02);
      const rightKneeWp = new THREE.Vector3(-0.09, charHeight * 0.23, 0.02);

      if (riggedBones.head?.bone) riggedBones.head.bone.getWorldPosition(headWp);
      if (riggedBones.neck?.bone) riggedBones.neck.bone.getWorldPosition(neckWp);
      if (riggedBones.hips?.bone) riggedBones.hips.bone.getWorldPosition(hipsWp);

      const lKneeNode = riggedBones.leftKnee?.bone || riggedBones.leftCalf?.bone;
      const rKneeNode = riggedBones.rightKnee?.bone || riggedBones.rightCalf?.bone;
      if (lKneeNode) {
        lKneeNode.getWorldPosition(leftKneeWp);
      } else if (riggedBones.leftLeg?.bone) {
        riggedBones.leftLeg.bone.getWorldPosition(leftKneeWp);
        leftKneeWp.y *= 0.52;
      }
      if (rKneeNode) {
        rKneeNode.getWorldPosition(rightKneeWp);
      } else if (riggedBones.rightLeg?.bone) {
        riggedBones.rightLeg.bone.getWorldPosition(rightKneeWp);
        rightKneeWp.y *= 0.52;
      }

      // Target Vertex Colors (Layer A2):
      // 1. Knee Articulation Blush: `#EFA892` -> RGB(0.94, 0.66, 0.57)
      const kneeR = 0.94,
        kneeG = 0.66,
        kneeB = 0.57;
      // 2. Cheek & Facial Contour Blush: `#F7B0A4` -> RGB(0.97, 0.69, 0.64)
      const cheekR = 0.97,
        cheekG = 0.69,
        cheekB = 0.64;
      // 3. Hair-Fringe & Chin Warm Shadow: `#E6AC96` -> RGB(0.90, 0.67, 0.59)
      const hairShadR = 0.90,
        hairShadG = 0.67,
        hairShadB = 0.59;

      const vPos = new THREE.Vector3();
      const vNorm = new THREE.Vector3();
      const normalMat = new THREE.Matrix3();

      loadedModel.traverse((child) => {
        if (!child.isMesh || !child.geometry || child.userData?.isHiddenOutline) return;

        const geom = child.geometry;
        const posAttr = geom.attributes?.position;
        if (!posAttr || posAttr.count <= 0) return;

        const normAttr = geom.attributes?.normal;
        const uvAttr = geom.attributes?.uv;
        const count = posAttr.count;

        const meshNameLower = (child.name || '').toLowerCase();
        const firstMat = Array.isArray(child.material) ? child.material[0] : child.material;
        const matNameLower = (firstMat?.name || '').toLowerCase();
        const roleFlags = classifyNahidaMaterialRole(meshNameLower, matNameLower);

        const colors = new Float32Array(count * 3);
        for (let i = 0; i < count * 3; i++) {
          colors[i] = 1.0;
        }

        if (roleFlags.isHairOnly || roleFlags.isClothOrOrnamentOnly) {
          geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
          geom.attributes.color.needsUpdate = true;
          return;
        }

        const skinMaskGrid = firstMat?.map?.userData?.__skinMaskGrid || null;
        const gridRes = firstMat?.map?.userData?.__skinMaskGridRes || 64;
        const flipY = firstMat?.map ? Boolean(firstMat.map.flipY) : false;

        child.updateMatrixWorld(true);
        normalMat.getNormalMatrix(child.matrixWorld);

        // Knee blush radius scaled to Nahida's 2.16-unit height (~0.055m equivalent -> 0.135 model units)
        const kneeRadius = 0.135;

        for (let i = 0; i < count; i++) {
          vPos.fromBufferAttribute(posAttr, i).applyMatrix4(child.matrixWorld);
          if (normAttr) {
            vNorm.fromBufferAttribute(normAttr, i).applyMatrix3(normalMat).normalize();
          } else {
            vNorm.set(0, 0, 1);
          }

          // Check UV against graded skin mask grid so white dress & green ornaments stay 100% untouched (1,1,1)
          let isSkinVertex = Boolean(roleFlags.isExplicitFace || roleFlags.isExplicitSkinOrBody);
          if (skinMaskGrid && uvAttr) {
            let u = uvAttr.getX(i);
            let v = uvAttr.getY(i);
            u = ((u % 1) + 1) % 1;
            v = ((v % 1) + 1) % 1;
            const py = flipY ? 1.0 - v : v;
            const gx = Math.min(gridRes - 1, Math.floor(u * gridRes));
            const gy = Math.min(gridRes - 1, Math.floor(py * gridRes));
            let hitSkin = skinMaskGrid[gy * gridRes + gx] === 1;
            if (!hitSkin) {
              // 3x3 neighborhood tolerance for UV seam edges
              for (let dy = -1; dy <= 1 && !hitSkin; dy++) {
                for (let dx = -1; dx <= 1 && !hitSkin; dx++) {
                  const nx = Math.min(gridRes - 1, Math.max(0, gx + dx));
                  const ny = Math.min(gridRes - 1, Math.max(0, gy + dy));
                  if (skinMaskGrid[ny * gridRes + nx] === 1) hitSkin = true;
                }
              }
            }
            isSkinVertex = hitSkin || Boolean(roleFlags.isExplicitFace);
          }

          if (!isSkinVertex) continue;

          let rCol = 1.0;
          let gCol = 1.0;
          let bCol = 1.0;

          // 1. Knee Articulation Warm Blush (`#EFA892` / RGB(0.94, 0.66, 0.57)) around front of LeftLeg & RightLeg
          if (vPos.y < hipsWp.y - 0.04 && vPos.y > 0.08) {
            const dL = vPos.distanceTo(leftKneeWp);
            const dR = vPos.distanceTo(rightKneeWp);
            const minKneeDist = Math.min(dL, dR);
            if (minKneeDist < kneeRadius && vNorm.z > -0.25) {
              const uKnee = 1.0 - minKneeDist / kneeRadius;
              const smoothKnee = uKnee * uKnee * (3.0 - 2.0 * uKnee) * 0.58;
              rCol = THREE.MathUtils.lerp(rCol, kneeR, smoothKnee);
              gCol = THREE.MathUtils.lerp(gCol, kneeG, smoothKnee);
              bCol = THREE.MathUtils.lerp(bCol, kneeB, smoothKnee);
            }
          }

          // 2. Cheek & Facial Contour Blush (`#F7B0A4` / RGB(0.97, 0.69, 0.64))
          // & 3. Hair-Fringe Forehead + Chin Warm Shadow (`#E6AC96` / RGB(0.90, 0.67, 0.59))
          const dxHead = vPos.x - headWp.x;
          const dyHead = vPos.y - headWp.y;
          const dzHead = vPos.z - headWp.z;
          const distHead = Math.hypot(dxHead, dyHead * 0.85, dzHead);

          if (distHead < 0.34 && dzHead > -0.05) {
            // 2A. Twin Gaussian Cheek Blush right below both eyes (`|dx| ≈ 0.075`, `dy ≈ -0.032`)
            const cheekDx = Math.abs(dxHead) - 0.075;
            const cheekDy = dyHead + 0.032;
            const cheekGauss = Math.exp(
              -((cheekDx * cheekDx) / (2.0 * 0.042 * 0.042) + (cheekDy * cheekDy) / (2.0 * 0.030 * 0.030))
            );
            // 2B. Soft Lower Facial Contour Blush along outer cheeks
            const contourRim =
              Math.max(0.0, 1.0 - Math.abs(vNorm.z)) *
              (dyHead < 0.02 && dyHead > -0.14 ? 0.45 : 0.0);
            const cheekWeight = Math.min(0.52, (cheekGauss * 0.85 + contourRim) * 0.48);

            if (cheekWeight > 0.005) {
              rCol = THREE.MathUtils.lerp(rCol, cheekR, cheekWeight);
              gCol = THREE.MathUtils.lerp(gCol, cheekG, cheekWeight);
              bCol = THREE.MathUtils.lerp(bCol, cheekB, cheekWeight);
            }

            // 3A. Forehead Hair-Fringe Warm Shadow (`dyHead > 0.025`)
            if (dyHead > 0.022) {
              const uBangs = Math.min(1.0, (dyHead - 0.022) / 0.085);
              const bangsWeight = uBangs * uBangs * (3.0 - 2.0 * uBangs) * 0.46;
              rCol = THREE.MathUtils.lerp(rCol, hairShadR, bangsWeight);
              gCol = THREE.MathUtils.lerp(gCol, hairShadG, bangsWeight);
              bCol = THREE.MathUtils.lerp(bCol, hairShadB, bangsWeight);
            }

            // 3B. Under-Chin & Upper-Neck Warm Shadow (`dyHead < -0.085` or downward normal on neck)
            if (dyHead < -0.085) {
              const uChin = Math.min(1.0, (-0.085 - dyHead) / 0.075);
              const chinWeight = uChin * uChin * (3.0 - 2.0 * uChin) * 0.42;
              rCol = THREE.MathUtils.lerp(rCol, hairShadR, chinWeight);
              gCol = THREE.MathUtils.lerp(gCol, hairShadG, chinWeight);
              bCol = THREE.MathUtils.lerp(bCol, hairShadB, chinWeight);
            }
          } else if (vPos.distanceTo(neckWp) < 0.16 && vNorm.y < 0.1) {
            const neckWeight = Math.min(0.42, (0.1 - vNorm.y) * 0.45);
            rCol = THREE.MathUtils.lerp(rCol, hairShadR, neckWeight);
            gCol = THREE.MathUtils.lerp(gCol, hairShadG, neckWeight);
            bCol = THREE.MathUtils.lerp(bCol, hairShadB, neckWeight);
          }

          colors[i * 3] = rCol;
          colors[i * 3 + 1] = gCol;
          colors[i * 3 + 2] = bCol;
        }

        geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geom.attributes.color.needsUpdate = true;
      });
    } catch (err) {
      console.warn('bakeNahidaSkinBlushAndHairShadowVertexColors fallback:', err);
    }
  }

  /**
   * ==========================================================================
   * UPDATE V44: REALTIME HYBRID ARM-TO-DRESS CLOTH DEFORMATION ENGINE (80%)
   * + NATURAL SKIRT-SURFACE ARM CONTACT SLIDING & WRIST CONTOUR (20%)
   * - Mechanism 1 (80%): `initNahidaHybridClothDeformationSystem` & `updateRealtimeNahidaClothCompression`
   *   + Backs up `geometry.userData.origPositions` & `origNormals` on Nahida's meshes.
   *   + Computes `clothWeight[i] = smoothstep(0.065, 0.14, r_xz)` in physical meter space around Hips/Spine,
   *     strictly excluding Skin, Face, Head, Hands, Arms, and Calves.
   *   + Projects the 4 live 3D Arm & Hand Collision Capsules (`LeftArm -> LeftForeArm`,
   *     `LeftForeArm -> LeftHand -> FingerTip`, `RightArm -> RightForeArm`,
   *     `RightForeArm -> RightHand -> FingerTip`) into Inverse-Hips Pelvis Meter Space
   *     and indents the skirt fabric inward (`r_skirt,compressed < r_arm,inner - 0.012m`)
   *     using a smooth Hermite bell curve `w_i * (3u^2 - 2u^3) * delta_max`.
   * - Mechanism 2 (20%): `applyNaturalSkirtSurfaceArmContactSliding`
   *   + Evaluates Elbow (`ForeArm`), Wrist (`Hand`), and `FingerTip` against the Compressed Skirt Hull Cone
   *     (including thigh elevation when sitting on the swing) and applies an exponentially smoothed
   *     (`alpha = 1 - exp(-18 * dt)`) micro abduction (`3°..7°`) + wrist contour (`5°..10°`) so the inner
   *     forearm & palm rest 0.0mm flush on the compressed skirt surface without ever flaring wide!
   * ==========================================================================
   */
  const nahidaClothDeformMeshes = [];
  const skirtContactSlidingState = {
    leftArmSlideRad: 0.0,
    rightArmSlideRad: 0.0,
    leftWristContourRad: 0.0,
    rightWristContourRad: 0.0
  };

  function distPointToSegment3D(px, py, pz, ax, ay, az, bx, by, bz) {
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const lenSq = abx * abx + aby * aby + abz * abz;
    let t = 0.0;
    if (lenSq > 1e-8) {
      t = ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / lenSq;
      if (t < 0.0) t = 0.0;
      else if (t > 1.0) t = 1.0;
    }
    const cx = ax + t * abx;
    const cy = ay + t * aby;
    const cz = az + t * abz;
    const dx = px - cx;
    const dy = py - cy;
    const dz = pz - cz;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  function initNahidaHybridClothDeformationSystem() {
    try {
      nahidaClothDeformMeshes.length = 0;
      if (!loadedModel) return;

      // 1. Temporarily place arms in their GLTF T-Pose (`restQuat`) so outstretched arms/hands
      //    are completely separated from the bell-shaped skirt during vertex mask classification!
      const armRestoreList = [
        riggedBones.rightShoulder,
        riggedBones.rightArm,
        riggedBones.rightElbow,
        riggedBones.rightWrist,
        riggedBones.leftShoulder,
        riggedBones.leftArm,
        riggedBones.leftElbow,
        riggedBones.leftWrist
      ];
      const savedArmQuats = [];
      for (let i = 0; i < armRestoreList.length; i++) {
        const entry = armRestoreList[i];
        if (entry && entry.bone) {
          savedArmQuats.push({ bone: entry.bone, q: entry.bone.quaternion.clone() });
          if (entry.restQuat) {
            entry.bone.quaternion.copy(entry.restQuat);
          }
        }
      }
      loadedModel.updateMatrixWorld(true);

      // Conversion from characterPivot local units (`charHeight ≈ 2.16`) to physical meters (`1.35m` Chibi height)
      const toMeterScale = 1.35 / Math.max(1.5, charHeight);
      const fromMeterScale = 1.0 / toMeterScale;

      const hipsWp = new THREE.Vector3(0, charHeight * 0.45, 0);
      const headWp = new THREE.Vector3(0, charHeight * 0.78, 0);
      const lArmWp = new THREE.Vector3(0.18, charHeight * 0.62, 0);
      const lElbowWp = new THREE.Vector3(0.38, charHeight * 0.62, 0);
      const lWristWp = new THREE.Vector3(0.56, charHeight * 0.62, 0);
      const rArmWp = new THREE.Vector3(-0.18, charHeight * 0.62, 0);
      const rElbowWp = new THREE.Vector3(-0.38, charHeight * 0.62, 0);
      const rWristWp = new THREE.Vector3(-0.56, charHeight * 0.62, 0);
      const lKneeWp = new THREE.Vector3(0.09, charHeight * 0.23, 0);
      const rKneeWp = new THREE.Vector3(-0.09, charHeight * 0.23, 0);
      const lFootWp = new THREE.Vector3(0.09, charHeight * 0.05, 0);
      const rFootWp = new THREE.Vector3(-0.09, charHeight * 0.05, 0);

      if (riggedBones.hips?.bone) riggedBones.hips.bone.getWorldPosition(hipsWp);
      if (riggedBones.head?.bone) riggedBones.head.bone.getWorldPosition(headWp);
      if (riggedBones.leftArm?.bone) riggedBones.leftArm.bone.getWorldPosition(lArmWp);
      if (riggedBones.leftElbow?.bone) riggedBones.leftElbow.bone.getWorldPosition(lElbowWp);
      if (riggedBones.leftWrist?.bone) riggedBones.leftWrist.bone.getWorldPosition(lWristWp);
      if (riggedBones.rightArm?.bone) riggedBones.rightArm.bone.getWorldPosition(rArmWp);
      if (riggedBones.rightElbow?.bone) riggedBones.rightElbow.bone.getWorldPosition(rElbowWp);
      if (riggedBones.rightWrist?.bone) riggedBones.rightWrist.bone.getWorldPosition(rWristWp);
      if (riggedBones.leftKnee?.bone) riggedBones.leftKnee.bone.getWorldPosition(lKneeWp);
      if (riggedBones.rightKnee?.bone) riggedBones.rightKnee.bone.getWorldPosition(rKneeWp);
      if (riggedBones.leftFoot?.bone) riggedBones.leftFoot.bone.getWorldPosition(lFootWp);
      if (riggedBones.rightFoot?.bone) riggedBones.rightFoot.bone.getWorldPosition(rFootWp);

      // Collect non-skirt bone subtrees (Arms, Hands, Fingers, Neck, Head, Calves, Feet)
      const nonSkirtBonesSet = new Set();
      const markNonSkirtSubtree = (rootBone) => {
        if (!rootBone) return;
        rootBone.traverse((b) => nonSkirtBonesSet.add(b));
      };
      markNonSkirtSubtree(riggedBones.leftShoulder?.bone);
      markNonSkirtSubtree(riggedBones.rightShoulder?.bone);
      markNonSkirtSubtree(riggedBones.leftArm?.bone);
      markNonSkirtSubtree(riggedBones.rightArm?.bone);
      markNonSkirtSubtree(riggedBones.neck?.bone);
      markNonSkirtSubtree(riggedBones.head?.bone);
      markNonSkirtSubtree(riggedBones.leftKnee?.bone);
      markNonSkirtSubtree(riggedBones.rightKnee?.bone);
      markNonSkirtSubtree(riggedBones.leftFoot?.bone);
      markNonSkirtSubtree(riggedBones.rightFoot?.bone);

      const vWorld = new THREE.Vector3();

      loadedModel.traverse((child) => {
        if (!child.isMesh || !child.geometry || child.userData?.isHiddenOutline) return;
        const geom = child.geometry;
        const posAttr = geom.attributes?.position;
        if (!posAttr || posAttr.count <= 0) return;

        const meshNameLower = (child.name || '').toLowerCase();
        const firstMat = Array.isArray(child.material) ? child.material[0] : child.material;
        const matNameLower = (firstMat?.name || '').toLowerCase();
        const roleFlags = classifyNahidaMaterialRole(meshNameLower, matNameLower);

        if (roleFlags.isHairOnly || roleFlags.isExplicitFace) return;

        const count = posAttr.count;
        const origPositions = new Float32Array(posAttr.array);
        geom.userData.origPositions = origPositions;
        if (geom.attributes?.normal) {
          geom.userData.origNormals = new Float32Array(geom.attributes.normal.array);
        }

        // Identify excluded bone indices in this SkinnedMesh's skeleton
        const excludedBoneIdxSet = new Set();
        if (child.isSkinnedMesh && child.skeleton && Array.isArray(child.skeleton.bones)) {
          const bones = child.skeleton.bones;
          for (let bIdx = 0; bIdx < bones.length; bIdx++) {
            const b = bones[bIdx];
            if (!b) continue;
            if (
              nonSkirtBonesSet.has(b) ||
              /(arm|elbow|forearm|hand|wrist|finger|thumb|index|middle|ring|pinky|head|neck|face|hair|bang|calf|shin|foot|toe)/i.test(
                b.name || ''
              )
            ) {
              excludedBoneIdxSet.add(bIdx);
            }
          }
        }

        const skinIndexAttr = geom.attributes?.skinIndex;
        const skinWeightAttr = geom.attributes?.skinWeight;
        const uvAttr = geom.attributes?.uv;
        const skinMaskGrid = firstMat?.map?.userData?.__skinMaskGrid || null;
        const gridRes = firstMat?.map?.userData?.__skinMaskGridRes || 64;
        const flipY = firstMat?.map ? Boolean(firstMat.map.flipY) : false;

        child.updateMatrixWorld(true);
        // Compute linear transformation from Pelvis Meter displacement to Geometry local space
        const worldToGeomMat4 = child.matrixWorld.clone().invert();
        const worldToGeomMat3 = new THREE.Matrix3().setFromMatrix4(worldToGeomMat4);
        const meterToGeomMat3 = worldToGeomMat3.clone().multiplyScalar(fromMeterScale);

        const clothWeights = new Float32Array(count);
        const tempActiveIndices = [];
        const tempActiveWeights = [];
        const tempActivePelvisPos = [];

        for (let i = 0; i < count; i++) {
          // 1. Exclude vertices weighted to Arms, Hands, Fingers, Head, or Lower Legs
          if (skinIndexAttr && skinWeightAttr && excludedBoneIdxSet.size > 0) {
            let excludedW = 0.0;
            if (excludedBoneIdxSet.has(skinIndexAttr.getX(i))) excludedW += skinWeightAttr.getX(i);
            if (excludedBoneIdxSet.has(skinIndexAttr.getY(i))) excludedW += skinWeightAttr.getY(i);
            if (excludedBoneIdxSet.has(skinIndexAttr.getZ(i))) excludedW += skinWeightAttr.getZ(i);
            if (excludedBoneIdxSet.has(skinIndexAttr.getW(i))) excludedW += skinWeightAttr.getW(i);
            if (excludedW > 0.12) continue;
          }

          // 2. Exclude Skin texel vertices (already detected by V43's skinMaskGrid)
          if (skinMaskGrid && uvAttr) {
            let u = ((uvAttr.getX(i) % 1) + 1) % 1;
            let v = ((uvAttr.getY(i) % 1) + 1) % 1;
            const py = flipY ? 1.0 - v : v;
            const gx = Math.min(gridRes - 1, Math.floor(u * gridRes));
            const gy = Math.min(gridRes - 1, Math.floor(py * gridRes));
            if (skinMaskGrid[gy * gridRes + gx] === 1) continue;
          }

          vWorld.fromBufferAttribute(posAttr, i).applyMatrix4(child.matrixWorld);

          // 3. Exclude vertices near T-Pose outstretched arms/hands or head or lower calves
          const dLeftArm =
            Math.min(
              distPointToSegment3D(
                vWorld.x, vWorld.y, vWorld.z,
                lArmWp.x, lArmWp.y, lArmWp.z,
                lElbowWp.x, lElbowWp.y, lElbowWp.z
              ),
              distPointToSegment3D(
                vWorld.x, vWorld.y, vWorld.z,
                lElbowWp.x, lElbowWp.y, lElbowWp.z,
                lWristWp.x, lWristWp.y, lWristWp.z
              )
            ) * toMeterScale;
          const dRightArm =
            Math.min(
              distPointToSegment3D(
                vWorld.x, vWorld.y, vWorld.z,
                rArmWp.x, rArmWp.y, rArmWp.z,
                rElbowWp.x, rElbowWp.y, rElbowWp.z
              ),
              distPointToSegment3D(
                vWorld.x, vWorld.y, vWorld.z,
                rElbowWp.x, rElbowWp.y, rElbowWp.z,
                rWristWp.x, rWristWp.y, rWristWp.z
              )
            ) * toMeterScale;

          // If a vertex is tightly wrapped around the T-pose forearm/hand (< 0.055m), it's part of the arm/cuff, not the skirt!
          if (Math.min(dLeftArm, dRightArm) < 0.055) continue;
          if (vWorld.distanceTo(headWp) * toMeterScale < 0.16) continue;

          // Pelvis-relative coordinates in physical meters (`1.0m = 1.35m Chibi scale`)
          const xm = (vWorld.x - hipsWp.x) * toMeterScale;
          const ym = (vWorld.y - hipsWp.y) * toMeterScale;
          const zm = (vWorld.z - hipsWp.z) * toMeterScale;

          // 4. Skirt / Bell-Dress vertical zone (`ym` from -0.26m hem up to +0.18m lower chest)
          if (ym < -0.26 || ym > 0.18) continue;

          // Radial distance from the Hips/Spine centerline in meter space
          const rXz = Math.hypot(xm, zm);
          if (rXz <= 0.065) continue;

          // Smooth radial cloth weight: w_radial = smoothstep(0.065, 0.14, r_xz)
          const uRad = THREE.MathUtils.clamp((rXz - 0.065) / (0.14 - 0.065), 0.0, 1.0);
          const wRadial = uRad * uRad * (3.0 - 2.0 * uRad);

          // Smooth vertical taper so upper chest/neckline (`ym -> 0.18m`) stays 100% locked
          const uTop = THREE.MathUtils.clamp((0.18 - ym) / (0.18 - 0.10), 0.0, 1.0);
          const wTop = uTop * uTop * (3.0 - 2.0 * uTop);
          const uBot = THREE.MathUtils.clamp((ym - -0.26) / (-0.20 - -0.26), 0.0, 1.0);
          const wBot = uBot * uBot * (3.0 - 2.0 * uBot);

          const wCloth = wRadial * wTop * wBot;
          if (wCloth <= 0.005) continue;

          clothWeights[i] = wCloth;
          tempActiveIndices.push(i);
          tempActiveWeights.push(wCloth);
          tempActivePelvisPos.push(xm, ym, zm);
        }

        geom.userData.clothWeights = clothWeights;

        if (tempActiveIndices.length > 0) {
          nahidaClothDeformMeshes.push({
            mesh: child,
            posAttr,
            origPositions,
            activeIndices: new Uint32Array(tempActiveIndices),
            activeWeights: new Float32Array(tempActiveWeights),
            activePelvisPos: new Float32Array(tempActivePelvisPos),
            meterToGeomElements: new Float32Array(meterToGeomMat3.elements),
            wasDeformedLastFrame: false
          });
        }
      });

      // Restore relaxed standing arm quaternions
      for (let i = 0; i < savedArmQuats.length; i++) {
        savedArmQuats[i].bone.quaternion.copy(savedArmQuats[i].q);
      }
      loadedModel.updateMatrixWorld(true);
    } catch (e) {
      console.warn('initNahidaHybridClothDeformationSystem fallback:', e);
    }
  }

  // Reusable scratch objects for Mechanism 1 & Mechanism 2
  const _clothPivotQuat = new THREE.Quaternion();
  const _clothPivotQuatInv = new THREE.Quaternion();
  const _clothHipsWp = new THREE.Vector3();
  const _clothLArmWp = new THREE.Vector3();
  const _clothLElbowWp = new THREE.Vector3();
  const _clothLWristWp = new THREE.Vector3();
  const _clothLTipWp = new THREE.Vector3();
  const _clothRArmWp = new THREE.Vector3();
  const _clothRElbowWp = new THREE.Vector3();
  const _clothRWristWp = new THREE.Vector3();
  const _clothRTipWp = new THREE.Vector3();
  const _clothLThighWp = new THREE.Vector3();
  const _clothLKneeWp = new THREE.Vector3();
  const _clothRThighWp = new THREE.Vector3();
  const _clothRKneeWp = new THREE.Vector3();
  const _clothTmpVec = new THREE.Vector3();

  /**
   * UPDATE V44 SECTION 2 (20%): NATURAL SKIRT-SURFACE ARM CONTACT SLIDING & WRIST CONTOUR
   * (`applyNaturalSkirtSurfaceArmContactSliding`)
   * - Evaluates Elbow (`ForeArm`), Wrist (`Hand`), and `FingerTip` against the Compressed Skirt Hull Cone
   *   in Pelvis Meter Space (including thigh elevation when sitting on the swing or stepping).
   * - Applies a smooth, exponentially damped (`alpha = 1 - exp(-18 * dt)`) micro abduction (`3°..7.5°`)
   *   on `LeftArm`/`RightArm` and micro wrist contour (`5°..10°`) on `LeftHand`/`RightHand` so the inner
   *   forearm and palm rest 0.0mm flush on top of the compressed skirt surface without ever flaring wide!
   */
  function applyNaturalSkirtSurfaceArmContactSliding(dt = 0.016) {
    try {
      if (!loadedModel || !riggedBones.hips?.bone) return;

      characterPivot.getWorldQuaternion(_clothPivotQuat);
      _clothPivotQuatInv.copy(_clothPivotQuat).invert();
      riggedBones.hips.bone.getWorldPosition(_clothHipsWp);

      const worldCharHeight = Math.max(1.2, charHeight * (characterPivot.scale.y || CHARACTER_UNIFORM_SCALE));
      const worldToMeter = 1.35 / worldCharHeight;

      const toPelvisMeter = (worldPt, outVec) => {
        outVec.subVectors(worldPt, _clothHipsWp).applyQuaternion(_clothPivotQuatInv).multiplyScalar(worldToMeter);
        return outVec;
      };

      // Check thigh forward lift (e.g., when sitting on the Dendro Swing or lifting legs during flight)
      let leftThighLiftBoost = 0.0;
      let rightThighLiftBoost = 0.0;
      if (riggedBones.leftLeg?.bone && riggedBones.leftKnee?.bone) {
        riggedBones.leftLeg.bone.getWorldPosition(_clothLThighWp);
        riggedBones.leftKnee.bone.getWorldPosition(_clothLKneeWp);
        const dyM = (_clothLKneeWp.y - _clothLThighWp.y) * worldToMeter;
        // In standing pose dyM ≈ -0.18m; when sitting on swing dyM ≈ -0.01m
        leftThighLiftBoost = THREE.MathUtils.clamp((dyM + 0.16) / 0.16, 0.0, 1.0);
      }
      if (riggedBones.rightLeg?.bone && riggedBones.rightKnee?.bone) {
        riggedBones.rightLeg.bone.getWorldPosition(_clothRThighWp);
        riggedBones.rightKnee.bone.getWorldPosition(_clothRKneeWp);
        const dyM = (_clothRKneeWp.y - _clothRThighWp.y) * worldToMeter;
        rightThighLiftBoost = THREE.MathUtils.clamp((dyM + 0.16) / 0.16, 0.0, 1.0);
      }

      // Compressed Skirt Hull Cone Radius R_hull(ym, zm, thighLift) in meters:
      // Represents the skirt surface AFTER 80% cloth compression by the arm!
      const evaluateCompressedSkirtHullRadius = (ym, zm, thighLift) => {
        if (ym > 0.13 || ym < -0.25) return 0.0;
        // Waist (ym = +0.10m) radius = 0.108m -> flares down to 0.158m at hem (ym = -0.20m)
        const flareT = THREE.MathUtils.clamp((0.10 - ym) / 0.30, 0.0, 1.0);
        let baseConeR = THREE.MathUtils.lerp(0.108, 0.158, flareT);
        // When sitting on the swing, the raised thighs lift the front-side skirt fabric slightly
        if (zm > -0.02 && thighLift > 0.01) {
          baseConeR += 0.018 * thighLift * THREE.MathUtils.clamp((zm + 0.04) / 0.14, 0.0, 1.0);
        }
        return baseConeR;
      };

      const computeSideContactTargets = (armEntry, elbowEntry, wristEntry, thighLift) => {
        let targetArmRad = 0.0;
        let targetWristRad = 0.0;
        if (!armEntry?.bone || !elbowEntry?.bone || !wristEntry?.bone) {
          return { targetArmRad, targetWristRad };
        }

        armEntry.bone.getWorldPosition(_clothLArmWp);
        elbowEntry.bone.getWorldPosition(_clothLElbowWp);
        wristEntry.bone.getWorldPosition(_clothLWristWp);

        // Estimate fingertip position 0.075m beyond wrist along forearm->wrist vector
        _clothLTipWp.subVectors(_clothLWristWp, _clothLElbowWp);
        if (_clothLTipWp.lengthSq() > 1e-6) {
          _clothLTipWp.normalize().multiplyScalar(0.075 / worldToMeter).add(_clothLWristWp);
        } else {
          _clothLTipWp.copy(_clothLWristWp);
        }

        const pElbow = toPelvisMeter(_clothLElbowWp, new THREE.Vector3());
        const pWrist = toPelvisMeter(_clothLWristWp, new THREE.Vector3());
        const pTip = toPelvisMeter(_clothLTipWp, new THREE.Vector3());

        // Inner arm/palm thickness offset (0.018m so the inner surface of the arm/palm touches 0.0mm flush)
        const innerPad = 0.018;

        const rElbowHull = evaluateCompressedSkirtHullRadius(pElbow.y, pElbow.z, thighLift);
        const rWristHull = evaluateCompressedSkirtHullRadius(pWrist.y, pWrist.z, thighLift);
        const rTipHull = evaluateCompressedSkirtHullRadius(pTip.y, pTip.z, thighLift);

        const rElbowHoriz = Math.hypot(pElbow.x, pElbow.z * 0.82);
        const rWristHoriz = Math.hypot(pWrist.x, pWrist.z * 0.82);
        const rTipHoriz = Math.hypot(pTip.x, pTip.z * 0.82);

        const penElbow = rElbowHull > 0 ? Math.max(0.0, rElbowHull + innerPad - rElbowHoriz) : 0.0;
        const penWrist = rWristHull > 0 ? Math.max(0.0, rWristHull + innerPad - rWristHoriz) : 0.0;
        const penTip = rTipHull > 0 ? Math.max(0.0, rTipHull + innerPad - rTipHoriz) : 0.0;

        const maxArmPen = Math.max(penElbow, penWrist * 0.92, penTip * 0.65);
        if (maxArmPen > 0.0005) {
          // Convert penetration in meters to a subtle micro abduction angle (strictly capped to 3°..7.5° = 0.13 rad!)
          // so the arm NEVER flares wide into a T-pose, only glides flush on the compressed skirt!
          targetArmRad = THREE.MathUtils.clamp(maxArmPen * 2.15, 0.0, 0.13);
        }

        const maxHandPen = Math.max(penWrist, penTip);
        if (maxHandPen > 0.0005) {
          // Subtle wrist contour (5°..10° = 0.085..0.175 rad) so the palm drapes along the bell skirt slope
          targetWristRad = THREE.MathUtils.clamp(maxHandPen * 2.85, 0.0, 0.175);
        }

        return { targetArmRad, targetWristRad };
      };

      const leftTargets = computeSideContactTargets(
        riggedBones.leftArm,
        riggedBones.leftElbow,
        riggedBones.leftWrist,
        leftThighLiftBoost
      );
      const rightTargets = computeSideContactTargets(
        riggedBones.rightArm,
        riggedBones.rightElbow,
        riggedBones.rightWrist,
        rightThighLiftBoost
      );

      // Exponential Smoothing: alpha = 1 - exp(-18 * dt)
      const smoothAlpha = 1.0 - Math.exp(-18.0 * Math.max(0.001, dt));
      skirtContactSlidingState.leftArmSlideRad = THREE.MathUtils.lerp(
        skirtContactSlidingState.leftArmSlideRad,
        leftTargets.targetArmRad,
        smoothAlpha
      );
      skirtContactSlidingState.rightArmSlideRad = THREE.MathUtils.lerp(
        skirtContactSlidingState.rightArmSlideRad,
        rightTargets.targetArmRad,
        smoothAlpha
      );
      skirtContactSlidingState.leftWristContourRad = THREE.MathUtils.lerp(
        skirtContactSlidingState.leftWristContourRad,
        leftTargets.targetWristRad,
        smoothAlpha
      );
      skirtContactSlidingState.rightWristContourRad = THREE.MathUtils.lerp(
        skirtContactSlidingState.rightWristContourRad,
        rightTargets.targetWristRad,
        smoothAlpha
      );

      const lOutwardSignZ = -solvedSigns.leftArmAdductZ;
      const rOutwardSignZ = -solvedSigns.rightArmAdductZ;

      if (skirtContactSlidingState.leftArmSlideRad > 0.0005 && riggedBones.leftArm?.bone) {
        applyWorldAxisRotation(
          riggedBones.leftArm.bone,
          riggedBones.leftArm.bone.quaternion,
          WORLD_Z,
          lOutwardSignZ * skirtContactSlidingState.leftArmSlideRad
        );
        riggedBones.leftArm.bone.updateMatrixWorld(true);
      }
      if (skirtContactSlidingState.rightArmSlideRad > 0.0005 && riggedBones.rightArm?.bone) {
        applyWorldAxisRotation(
          riggedBones.rightArm.bone,
          riggedBones.rightArm.bone.quaternion,
          WORLD_Z,
          rOutwardSignZ * skirtContactSlidingState.rightArmSlideRad
        );
        riggedBones.rightArm.bone.updateMatrixWorld(true);
      }

      if (skirtContactSlidingState.leftWristContourRad > 0.0005 && riggedBones.leftWrist?.bone) {
        applyWorldAxisRotation(
          riggedBones.leftWrist.bone,
          riggedBones.leftWrist.bone.quaternion,
          WORLD_Z,
          lOutwardSignZ * skirtContactSlidingState.leftWristContourRad
        );
        riggedBones.leftWrist.bone.updateMatrixWorld(true);
      }
      if (skirtContactSlidingState.rightWristContourRad > 0.0005 && riggedBones.rightWrist?.bone) {
        applyWorldAxisRotation(
          riggedBones.rightWrist.bone,
          riggedBones.rightWrist.bone.quaternion,
          WORLD_Z,
          rOutwardSignZ * skirtContactSlidingState.rightWristContourRad
        );
        riggedBones.rightWrist.bone.updateMatrixWorld(true);
      }
    } catch (e) {
      // Safe no-op fallback
    }
  }

  /**
   * UPDATE V44 SECTION 1 (80%): REALTIME CAPSULE-SDF CLOTH INDENTATION / COMPRESSION SOLVER
   * (`updateRealtimeNahidaClothCompression`)
   * - Projects the 4 live 3D Arm & Hand Collision Capsules (`LeftArm -> LeftForeArm`,
   *   `LeftForeArm -> LeftHand -> FingerTip`, `RightArm -> RightForeArm`,
   *   `RightForeArm -> RightHand -> FingerTip`) into Inverse-Hips Pelvis Meter Space.
   * - For every deformable skirt/dress vertex `i` within `R_influence = 0.085m` of an arm/hand capsule,
   *   computes smooth Hermite indentation `indent = clothWeight[i] * (3u^2 - 2u^3) * delta_max`
   *   and pushes the skirt fabric radially inward toward the spine/hips axis (`(0, y_i, 0)`) and slightly
   *   downward so `r_skirt,compressed < r_arm,inner - 0.012m`.
   * - Automatically restores `origPositions` elastically as soon as the arm lifts away!
   */
  function updateRealtimeNahidaClothCompression() {
    try {
      if (!loadedModel || nahidaClothDeformMeshes.length === 0 || !riggedBones.hips?.bone) return;

      loadedModel.updateMatrixWorld(true);
      characterPivot.getWorldQuaternion(_clothPivotQuat);
      _clothPivotQuatInv.copy(_clothPivotQuat).invert();
      riggedBones.hips.bone.getWorldPosition(_clothHipsWp);

      const worldCharHeight = Math.max(1.2, charHeight * (characterPivot.scale.y || CHARACTER_UNIFORM_SCALE));
      const worldToMeter = 1.35 / worldCharHeight;

      const toPelvisMeterXYZ = (worldPt, outArr, offset) => {
        _clothTmpVec
          .subVectors(worldPt, _clothHipsWp)
          .applyQuaternion(_clothPivotQuatInv)
          .multiplyScalar(worldToMeter);
        outArr[offset] = _clothTmpVec.x;
        outArr[offset + 1] = _clothTmpVec.y;
        outArr[offset + 2] = _clothTmpVec.z;
      };

      // Build the 4 Arm & Hand 3D Collision Capsules in Pelvis Meter Space:
      // Each capsule stores [Ax, Ay, Az, Bx, By, Bz, radiusM, influenceM]
      // 0: Left UpperArm (R = 0.048m, R_inf = 0.085m)
      // 1: Left ForeArm + Hand + Fingers (R = 0.052m, R_inf = 0.088m)
      // 2: Right UpperArm (R = 0.048m, R_inf = 0.085m)
      // 3: Right ForeArm + Hand + Fingers (R = 0.052m, R_inf = 0.088m)
      const caps = new Float32Array(4 * 8);
      let hasLeftCaps = false;
      let hasRightCaps = false;

      if (riggedBones.leftArm?.bone && riggedBones.leftElbow?.bone && riggedBones.leftWrist?.bone) {
        riggedBones.leftArm.bone.getWorldPosition(_clothLArmWp);
        riggedBones.leftElbow.bone.getWorldPosition(_clothLElbowWp);
        riggedBones.leftWrist.bone.getWorldPosition(_clothLWristWp);

        _clothLTipWp.subVectors(_clothLWristWp, _clothLElbowWp);
        if (_clothLTipWp.lengthSq() > 1e-6) {
          _clothLTipWp.normalize().multiplyScalar(0.082 / worldToMeter).add(_clothLWristWp);
        } else {
          _clothLTipWp.copy(_clothLWristWp);
        }

        toPelvisMeterXYZ(_clothLArmWp, caps, 0);
        toPelvisMeterXYZ(_clothLElbowWp, caps, 3);
        caps[6] = 0.048;
        caps[7] = 0.085;

        toPelvisMeterXYZ(_clothLElbowWp, caps, 8);
        toPelvisMeterXYZ(_clothLTipWp, caps, 11);
        caps[14] = 0.052;
        caps[15] = 0.088;
        hasLeftCaps = true;
      }

      if (riggedBones.rightArm?.bone && riggedBones.rightElbow?.bone && riggedBones.rightWrist?.bone) {
        riggedBones.rightArm.bone.getWorldPosition(_clothRArmWp);
        riggedBones.rightElbow.bone.getWorldPosition(_clothRElbowWp);
        riggedBones.rightWrist.bone.getWorldPosition(_clothRWristWp);

        _clothRTipWp.subVectors(_clothRWristWp, _clothRElbowWp);
        if (_clothRTipWp.lengthSq() > 1e-6) {
          _clothRTipWp.normalize().multiplyScalar(0.082 / worldToMeter).add(_clothRWristWp);
        } else {
          _clothRTipWp.copy(_clothRWristWp);
        }

        toPelvisMeterXYZ(_clothRArmWp, caps, 16);
        toPelvisMeterXYZ(_clothRElbowWp, caps, 19);
        caps[22] = 0.048;
        caps[23] = 0.085;

        toPelvisMeterXYZ(_clothRElbowWp, caps, 24);
        toPelvisMeterXYZ(_clothRTipWp, caps, 27);
        caps[30] = 0.052;
        caps[31] = 0.088;
        hasRightCaps = true;
      }

      if (!hasLeftCaps && !hasRightCaps) return;

      const deltaMaxM = 0.072; // Maximum inward cloth indentation in meters (~7.2cm)
      const minCoreRadiusM = 0.054; // Inner body core limit so cloth never pinches through the spine

      for (let m = 0; m < nahidaClothDeformMeshes.length; m++) {
        const item = nahidaClothDeformMeshes[m];
        const {
          posAttr,
          origPositions,
          activeIndices,
          activeWeights,
          activePelvisPos,
          meterToGeomElements
        } = item;
        const posArray = posAttr.array;
        const activeCount = activeIndices.length;
        let meshModified = false;

        const m00 = meterToGeomElements[0],
          m01 = meterToGeomElements[3],
          m02 = meterToGeomElements[6];
        const m10 = meterToGeomElements[1],
          m11 = meterToGeomElements[4],
          m12 = meterToGeomElements[7];
        const m20 = meterToGeomElements[2],
          m21 = meterToGeomElements[5],
          m22 = meterToGeomElements[8];

        for (let k = 0; k < activeCount; k++) {
          const vIdx = activeIndices[k];
          const i3 = vIdx * 3;
          const k3 = k * 3;

          const vx = activePelvisPos[k3];
          const vy = activePelvisPos[k3 + 1];
          const vz = activePelvisPos[k3 + 2];
          const rXz = Math.hypot(vx, vz);

          if (rXz <= minCoreRadiusM) continue;

          // Evaluate capsules on the matching lateral side (Left: caps 0..1, Right: caps 2..3)
          const startCap = vx >= -0.02 ? 0 : 2;
          const endCap = vx <= 0.02 ? 4 : 2;

          let maxIndentM = 0.0;

          for (let c = startCap; c < endCap; c++) {
            if (c < 2 && !hasLeftCaps) continue;
            if (c >= 2 && !hasRightCaps) continue;

            const cOff = c * 8;
            const ax = caps[cOff],
              ay = caps[cOff + 1],
              az = caps[cOff + 2];
            const bx = caps[cOff + 3],
              by = caps[cOff + 4],
              bz = caps[cOff + 5];
            const rCap = caps[cOff + 6];
            const rInf = caps[cOff + 7];

            const abx = bx - ax;
            const aby = by - ay;
            const abz = bz - az;
            const lenSq = abx * abx + aby * aby + abz * abz;
            let tProj = 0.0;
            if (lenSq > 1e-8) {
              tProj = ((vx - ax) * abx + (vy - ay) * aby + (vz - az) * abz) / lenSq;
              if (tProj < 0.0) tProj = 0.0;
              else if (tProj > 1.0) tProj = 1.0;
            }

            const cx = ax + tProj * abx;
            const cy = ay + tProj * aby;
            const cz = az + tProj * abz;

            const dx = vx - cx;
            const dy = vy - cy;
            const dz = vz - cz;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (dist < rInf) {
              const u = 1.0 - dist / rInf;
              const hermite = u * u * (3.0 - 2.0 * u);

              // Ensure compressed skirt radius stays inside inner arm surface (`r_arm,inner - 0.012m`)
              const rArmCenterXz = Math.hypot(cx, cz);
              const rArmInnerXz = Math.max(minCoreRadiusM, rArmCenterXz - rCap - 0.012);
              const requiredClearanceM = Math.max(deltaMaxM, rXz - rArmInnerXz + 0.008);

              const candidateIndent = activeWeights[k] * hermite * requiredClearanceM;
              if (candidateIndent > maxIndentM) {
                maxIndentM = candidateIndent;
              }
            }
          }

          if (maxIndentM > 0.0003) {
            const clampedIndentM = Math.min(maxIndentM, rXz - minCoreRadiusM);
            // Push radially inward toward the central Hips/Spine axis `(0, y_i, 0)`
            // and slightly downward (`-0.16 * clampedIndentM`) along the arm's downward pressure
            const invR = 1.0 / rXz;
            const dispXm = -vx * invR * clampedIndentM;
            const dispYm = -0.16 * clampedIndentM;
            const dispZm = -vz * invR * clampedIndentM;

            posArray[i3] = origPositions[i3] + m00 * dispXm + m01 * dispYm + m02 * dispZm;
            posArray[i3 + 1] = origPositions[i3 + 1] + m10 * dispXm + m11 * dispYm + m12 * dispZm;
            posArray[i3 + 2] = origPositions[i3 + 2] + m20 * dispXm + m21 * dispYm + m22 * dispZm;
            meshModified = true;
          } else if (item.wasDeformedLastFrame) {
            posArray[i3] = origPositions[i3];
            posArray[i3 + 1] = origPositions[i3 + 1];
            posArray[i3 + 2] = origPositions[i3 + 2];
          }
        }

        if (meshModified || item.wasDeformedLastFrame) {
          posAttr.needsUpdate = true;
          item.wasDeformedLastFrame = meshModified;
        }
      }
    } catch (e) {
      // Safe no-op fallback
    }
  }

  /**
   * `setupCamellyaPoseAndAnimation(gltf)` — UPDATE V43 (CRASH-FREE GENSHIN NAHIDA WARM PEACH SKIN,
   * VERTEX-COLOR KNEE/CHEEK/HAIR-SHADOW BAKING & REALTIME WARM KEY/SHADOW LIGHTING)
   */
  function setupCamellyaPoseAndAnimation(gltf) {
    loadedModel = gltf.scene;
    characterPivot.add(loadedModel);

    // 1. Traverse all meshes of `genshin_impact_-_nahida.glb` (UPDATE V43 SECTION 3):
    //    - Enable `castShadow = true` and `receiveShadow = true` on Nahida's meshes.
    //    - Apply Crash-Free Canvas2D Warm Peach Skin Texture Grading (`#FFE8DA` / `#E8AD96`)
    //      and `MeshStandardMaterial` (`roughness: 0.68`, `metalness: 0.02`, `vertexColors: true`)
    //      with warm key/fill lighting so skin, knees, cheeks, and hair shadows render naturally
    //      without any `onBeforeCompile` shader crash!
    loadedModel.traverse((child) => {
      if (child.isMesh) {
        const meshNameLower = (child.name || '').toLowerCase();
        const firstMat = Array.isArray(child.material) ? child.material[0] : child.material;
        const firstMatName = (firstMat?.name || '').toLowerCase();
        const isDarkUntexturedOutline =
          (!firstMat?.map &&
            firstMat?.color &&
            firstMat.color.r < 0.15 &&
            firstMat.color.g < 0.15 &&
            firstMat.color.b < 0.15) ||
          /(outline|backface_line|toon_edge|line_mesh)/i.test(`${meshNameLower} ${firstMatName}`);

        if (isDarkUntexturedOutline) {
          child.visible = false;
          child.castShadow = false;
          child.userData.isHiddenOutline = true;
          return;
        }

        // Remove any legacy dark vertex color attribute first; clean vertex colors will be baked below
        if (child.geometry && child.geometry.attributes && child.geometry.attributes.color) {
          child.geometry.deleteAttribute('color');
        }

        child.frustumCulled = false;
        child.castShadow = true;
        child.receiveShadow = true;
        child.userData.baseOpacity = 1.0;

        const convertToBrightAnimeMaterial = (oldMat) => {
          if (!oldMat) return oldMat;

          if (oldMat.map) {
            oldMat.map.colorSpace = THREE.SRGBColorSpace;
            oldMat.map.anisotropy = 8;
          }

          const matName = (oldMat.name || '').toLowerCase();
          const roleFlags = classifyNahidaMaterialRole(meshNameLower, matName);

          if (!oldMat.map) {
            const brightColor =
              oldMat.color && oldMat.color.r + oldMat.color.g + oldMat.color.b >= 0.35
                ? oldMat.color.clone()
                : new THREE.Color(0xffe8da);
            const untexturedMat = new THREE.MeshStandardMaterial({
              name: oldMat.name,
              color: brightColor,
              roughness: 0.68,
              metalness: 0.02,
              emissive: brightColor.clone(),
              emissiveIntensity: 0.32,
              transparent: Boolean(oldMat.transparent || (oldMat.alphaTest && oldMat.alphaTest > 0)),
              opacity: oldMat.opacity !== undefined ? oldMat.opacity : 1.0,
              alphaTest: oldMat.alphaTest || 0.0,
              side: THREE.DoubleSide,
              vertexColors: false
            });
            untexturedMat.shadowSide = THREE.FrontSide;
            untexturedMat.userData = {
              ...oldMat.userData,
              baseOpacity: untexturedMat.opacity,
              __origOpacity: untexturedMat.opacity,
              __origTransparent: Boolean(untexturedMat.transparent)
            };
            return untexturedMat;
          }

          const gradedMap = gradeNahidaSkinTextureCanvas2D(oldMat.map, roleFlags);
          const needsAlphaCutout =
            matName.includes('hair') ||
            matName.includes('bang') ||
            matName.includes('face') ||
            matName.includes('brow') ||
            matName.includes('lash') ||
            Boolean(oldMat.transparent);

          const animeMat = new THREE.MeshStandardMaterial({
            name: oldMat.name,
            map: gradedMap,
            color: new THREE.Color(0xffffff),
            roughness: 0.68,
            metalness: 0.02,
            emissive: new THREE.Color(0xfff5ee),
            emissiveMap: gradedMap,
            emissiveIntensity: 0.36,
            transparent: Boolean(oldMat.transparent || (oldMat.alphaTest && oldMat.alphaTest > 0)),
            opacity: oldMat.opacity !== undefined ? oldMat.opacity : 1.0,
            alphaTest: needsAlphaCutout
              ? Math.max(oldMat.alphaTest || 0, 0.04)
              : oldMat.alphaTest || 0.0,
            alphaMap: oldMat.alphaMap || null,
            side: THREE.DoubleSide,
            vertexColors: true
          });
          animeMat.shadowSide = THREE.FrontSide;
          animeMat.depthWrite = true;
          animeMat.userData = {
            ...oldMat.userData,
            baseOpacity: animeMat.opacity,
            __origOpacity: animeMat.opacity,
            __origTransparent: Boolean(animeMat.transparent)
          };
          animeMat.needsUpdate = true;
          return animeMat;
        };

        if (Array.isArray(child.material)) {
          child.material = child.material.map(convertToBrightAnimeMaterial);
        } else if (child.material) {
          child.material = convertToBrightAnimeMaterial(child.material);
        }
      }
    });

    // 2. Zero-Out Mesh Offset Inside Pivot Group (`characterPivot`) at 1:1 Local Scale
    const savedPivotPos = characterPivot.position.clone();
    const savedPivotRot = characterPivot.rotation.clone();
    const savedPivotScale = characterPivot.scale.clone();
    characterPivot.position.set(0, 0, 0);
    characterPivot.rotation.set(0, 0, 0);
    characterPivot.scale.setScalar(1);
    characterPivot.updateMatrixWorld(true);

    gltf.scene.position.set(0, 0, 0);
    gltf.scene.rotation.set(0, 0, 0);
    gltf.scene.scale.setScalar(1);
    gltf.scene.updateMatrixWorld(true);

    const rawBox = new THREE.Box3().setFromObject(gltf.scene);
    const rawSize = rawBox.getSize(new THREE.Vector3());

    const targetHeightUnits = 2.16;
    const scaleFactor = rawSize.y > 0.001 ? targetHeightUnits / rawSize.y : 1.0;
    gltf.scene.scale.setScalar(scaleFactor);

    gltf.scene.position.set(0, 0, 0);
    gltf.scene.rotation.set(0, 0, 0);
    gltf.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const center = box.getCenter(new THREE.Vector3());

    gltf.scene.position.x = -center.x;
    gltf.scene.position.z = -center.z;
    gltf.scene.position.y = -box.min.y;
    gltf.scene.updateMatrixWorld(true);

    charHeight = Math.max(1.5, box.max.y - box.min.y);
    charWidth = Math.max(0.65, box.max.x - box.min.x);

    // 3. Discover all bones and solve the Natural Relaxed Standing Pose in World Space:
    discoverAllKleeBonesAndSetupPoses();

    // Re-center `gltf.scene` in her final Relaxed Standing Pose so `(0, 0, 0)` of `characterPivot`
    // passes straight from Nahida's head down between her two feet (`y = 0` at shoe soles)!
    loadedModel.updateMatrixWorld(true);
    const posedBox = new THREE.Box3().setFromObject(gltf.scene);
    const posedCenter = posedBox.getCenter(new THREE.Vector3());
    gltf.scene.position.x -= posedCenter.x;
    gltf.scene.position.z -= posedCenter.z;
    gltf.scene.position.y -= posedBox.min.y;
    gltf.scene.updateMatrixWorld(true);
    baseModelLocalPos.copy(gltf.scene.position);

    charHeight = Math.max(1.5, posedBox.max.y - posedBox.min.y);
    charWidth = Math.max(0.65, posedBox.max.x - posedBox.min.x);

    // 3B. Bake Crash-Free Knee Blush (`#EFA892`), Cheek Blush (`#F7B0A4`), and Hair/Chin Shadow (`#E6AC96`)
    //     onto Nahida's vertex colors (`geometry.attributes.color`) in her standing rest pose!
    bakeNahidaSkinBlushAndHairShadowVertexColors();

    // 3C. Initialize Update V44 Realtime Hybrid Arm-to-Dress Cloth Deformation Engine (`origPositions` & `clothWeights` mask)
    initNahidaHybridClothDeformationSystem();

    // Measure Bind-Pose Hip Height (`hipHeight`) & Standing Foot Y in `characterPivot` local space (`y = 0` at soles)
    const tmpMeasureWp = new THREE.Vector3();
    if (riggedBones.hips?.bone) {
      riggedBones.hips.bone.getWorldPosition(tmpMeasureWp);
      hipHeight = THREE.MathUtils.clamp(tmpMeasureWp.y, 0.38 * charHeight, 0.56 * charHeight);
    } else if (riggedBones.leftLeg?.bone) {
      riggedBones.leftLeg.bone.getWorldPosition(tmpMeasureWp);
      hipHeight = THREE.MathUtils.clamp(tmpMeasureWp.y, 0.38 * charHeight, 0.56 * charHeight);
    } else {
      hipHeight = 0.45 * charHeight;
    }

    if (riggedBones.leftFoot?.bone) {
      riggedBones.leftFoot.bone.getWorldPosition(tmpMeasureWp);
      bindLeftFootLocalY = Math.max(0.0, tmpMeasureWp.y);
    } else {
      bindLeftFootLocalY = 0.06 * charHeight;
    }

    if (riggedBones.rightFoot?.bone) {
      riggedBones.rightFoot.bone.getWorldPosition(tmpMeasureWp);
      bindRightFootLocalY = Math.max(0.0, tmpMeasureWp.y);
    } else {
      bindRightFootLocalY = 0.06 * charHeight;
    }

    // Pre-capture Lower-Body Bone Subtree (`legFallbackMeshes` holds lower-body bones under `hipsBone`)
    // for HOTFIX V30/V32: Keep V30's exact lower-body sitting fallback EXCEPT excluding back/cape bones
    // (`tmpMeasureWp.z < -0.02` or matching `back|rear|behind|cape|cloak|wing|tail|butt`) so the back cape
    // never flips forward when sitting on the swing!
    legFallbackMeshes.length = 0;
    const upperBodyExcludeSet = new Set();
    const markExcludedSubtree = (rootBone) => {
      if (!rootBone) return;
      rootBone.traverse((b) => upperBodyExcludeSet.add(b));
    };
    markExcludedSubtree(riggedBones.spine?.bone);
    markExcludedSubtree(riggedBones.upperBody?.bone);
    markExcludedSubtree(riggedBones.chest?.bone);
    markExcludedSubtree(riggedBones.neck?.bone);
    markExcludedSubtree(riggedBones.head?.bone);
    markExcludedSubtree(riggedBones.leftShoulder?.bone);
    markExcludedSubtree(riggedBones.rightShoulder?.bone);
    markExcludedSubtree(riggedBones.leftArm?.bone);
    markExcludedSubtree(riggedBones.rightArm?.bone);

    const primaryLegBonesSet = new Set(
      [
        riggedBones.hips?.bone,
        riggedBones.leftLeg?.bone,
        riggedBones.rightLeg?.bone,
        riggedBones.leftKnee?.bone,
        riggedBones.rightKnee?.bone,
        riggedBones.leftFoot?.bone,
        riggedBones.rightFoot?.bone,
        riggedBones.leftToe?.bone,
        riggedBones.rightToe?.bone
      ].filter(Boolean)
    );

    const searchRoot = riggedBones.hips?.bone || loadedModel;
    searchRoot.traverse((node) => {
      if (!node.isBone || node === riggedBones.hips?.bone) return;
      if (upperBodyExcludeSet.has(node)) return;
      const bName = node.name || '';
      if (
        /(spine|chest|upperbody|neck|head|hair|arm|elbow|hand|wrist|finger|thumb|shoulder|clavicle|hat|ear|eye|mouth|cape|cloak|back|rear|behind|wing|tail|butt)/i.test(
          bName
        )
      ) {
        return;
      }
      node.getWorldPosition(tmpMeasureWp);
      // Do NOT bend bones located on the back side (`z < -0.02`) unless they are primary leg bones
      if (!primaryLegBonesSet.has(node) && tmpMeasureWp.z < -0.02) {
        return;
      }
      if (tmpMeasureWp.y <= hipHeight * 1.04 && tmpMeasureWp.y >= 0.02 * charHeight) {
        const ch = getPrimaryChildBone(node);
        if (!ch) return;
        const isThighLevel = tmpMeasureWp.y >= hipHeight * 0.56;
        const isCalfLevel =
          tmpMeasureWp.y < hipHeight * 0.56 && tmpMeasureWp.y >= hipHeight * 0.18;
        if (!isThighLevel && !isCalfLevel) return;

        legFallbackMeshes.push({
          bone: node,
          childBone: ch,
          restQuat: node.quaternion.clone(),
          isLeftSide: tmpMeasureWp.x >= 0,
          isThighLevel,
          isCalfLevel,
          isPrimaryLegBone: primaryLegBonesSet.has(node)
        });
      }
    });

    // Update RadialGradient Contact Shadow Disc to elliptical 3D proportion (`1.15, 0.85, 1`) directly under feet
    contactShadowMesh.scale.set(
      Math.max(1.15, 1.15 * charWidth),
      Math.max(0.85, 0.85 * charWidth),
      1
    );

    characterPivot.position.copy(savedPivotPos);
    characterPivot.rotation.copy(savedPivotRot);
    characterPivot.scale.copy(savedPivotScale);
    characterPivot.updateMatrixWorld(true);
    spinPhysics.prevRotationY = characterPivot.rotation.y;

    tryBuildFBXToGLBRetargeter();

    if (currentSlideId === 1 || isCurtainMode) {
      playModelCanvaBlurIntro(0.65);
    }
  }

  const gltfLoader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
  gltfLoader.setDRACOLoader(dracoLoader);

  const modelUrl = ALL_PROJECT_IMAGES.assistantModelUrl || '/genshin_impact_-_nahida.glb';

  gltfLoader.load(
    modelUrl,
    (gltf) => {
      setupCamellyaPoseAndAnimation(gltf);
    },
    undefined,
    (err) => {
      console.error('Error loading Nahida GLB model (/genshin_impact_-_nahida.glb):', err);
    }
  );

  // ==========================================================================
  // HOTFIX V22: FBX MOTION LOADER (`/change-pose-379001.fbx`), FRAME-0 T-POSE
  // EXTRACTION & PROPORTIONAL WORLD-SPACE SKELETON RETARGETER (`FBXToGLBRetargeter`)
  // ==========================================================================
  let currentSlideId = 1;
  let isCurtainMode = false;
  let isPerformingCurtainAction = false;
  let isInPlaceSpinning = false;
  let activeChoreoTimeline = null;
  let activeSpinTimeline = null;
  let nextSpinTime = 7.5;

  const idleScheduler = {
    mode: 'FBX_MOTION_MODE', // 'FBX_MOTION_MODE' | 'SPIN_360_MODE' | 'SWING_SIT_MODE'
    modeStartTime: 0,
    completedCycleCount: 0,
    baseStandX: CAMELLYA_SAFE_ZONES[1].x,
    baseStandY: CAMELLYA_SAFE_ZONES[1].y,
    baseStandZ: CAMELLYA_SAFE_ZONES[1].z,
    baseStandYaw: 0.16
  };

  /**
   * Quintic Ease-In-Out ($C^2$ zero velocity & zero acceleration at $t = 0$ and $t = 1$):
   * $$s(t) = 6t^5 - 15t^4 + 10t^3 \quad (t \in [0, 1])$$
   */
  function quinticEaseInOut(t) {
    const u = THREE.MathUtils.clamp(t, 0, 1);
    return u * u * u * (u * (u * 6.0 - 15.0) + 10.0);
  }

  /**
   * ==========================================================================
   * UPDATE V37 SECTION 2: 120FPS DLSS-STYLE QUATERNION CATMULL-ROM / SQUAD
   * FRAME GENERATION (`upsampleAnimationClipTo120FPS`)
   * - Resamples any `AnimationClip` (24fps / 30fps / 60fps) to a uniform `120 FPS`
   *   ($\Delta t = \frac{1}{120}\text{s}$).
   * - `QuaternionKeyframeTrack`: Uses $C^1$-continuous Spherical Cubic SQUAD SLERP
   *   across $(q_{i-1}, q_i, q_{i+1}, q_{i+2})$ with Shortest-Path Hemisphere Lock
   *   ($q_i \cdot q_{i+1} \ge 0$, negating $-q_{i+1}$ if negative to prevent 360° joint flips)
   *   combined with a light Gaussian smoothing kernel ($\sigma = 0.85$).
   * - `VectorKeyframeTrack` (`Hips.position`, etc.): Uses Cubic Catmull-Rom Spline
   *   interpolation at 120 samples/second.
   * ==========================================================================
   */
  function quatLogMap(qx, qy, qz, qw, outVec3) {
    const vLen = Math.hypot(qx, qy, qz);
    if (vLen < 1e-7) {
      outVec3[0] = 0;
      outVec3[1] = 0;
      outVec3[2] = 0;
      return;
    }
    const clampedW = THREE.MathUtils.clamp(qw, -1.0, 1.0);
    const theta = Math.acos(clampedW);
    const scale = theta / vLen;
    outVec3[0] = qx * scale;
    outVec3[1] = qy * scale;
    outVec3[2] = qz * scale;
  }

  function quatExpMap(wx, wy, wz, outQuat) {
    const theta = Math.hypot(wx, wy, wz);
    if (theta < 1e-7) {
      outQuat.set(0, 0, 0, 1);
      return outQuat;
    }
    const sinHalf = Math.sin(theta) / theta;
    outQuat.set(wx * sinHalf, wy * sinHalf, wz * sinHalf, Math.cos(theta)).normalize();
    return outQuat;
  }

  function computeSquadTangentQuat(qPrev, qCurr, qNext, outTangentQuat) {
    const qCurrInv = new THREE.Quaternion(-qCurr.x, -qCurr.y, -qCurr.z, qCurr.w);
    const relPrev = new THREE.Quaternion().multiplyQuaternions(qCurrInv, qPrev);
    if (relPrev.w < 0) {
      relPrev.set(-relPrev.x, -relPrev.y, -relPrev.z, -relPrev.w);
    }
    const relNext = new THREE.Quaternion().multiplyQuaternions(qCurrInv, qNext);
    if (relNext.w < 0) {
      relNext.set(-relNext.x, -relNext.y, -relNext.z, -relNext.w);
    }

    const logPrev = [0, 0, 0];
    const logNext = [0, 0, 0];
    quatLogMap(relPrev.x, relPrev.y, relPrev.z, relPrev.w, logPrev);
    quatLogMap(relNext.x, relNext.y, relNext.z, relNext.w, logNext);

    const expQuat = new THREE.Quaternion();
    quatExpMap(
      -0.25 * (logPrev[0] + logNext[0]),
      -0.25 * (logPrev[1] + logNext[1]),
      -0.25 * (logPrev[2] + logNext[2]),
      expQuat
    );

    outTangentQuat.multiplyQuaternions(qCurr, expQuat).normalize();
    if (qCurr.dot(outTangentQuat) < 0) {
      outTangentQuat.set(
        -outTangentQuat.x,
        -outTangentQuat.y,
        -outTangentQuat.z,
        -outTangentQuat.w
      );
    }
    return outTangentQuat;
  }

  function catmullRomScalar(p0, p1, p2, p3, u) {
    const u2 = u * u;
    const u3 = u2 * u;
    return (
      0.5 *
      (2.0 * p1 +
        (-p0 + p2) * u +
        (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * u2 +
        (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * u3)
    );
  }

  function findKeyframeSegmentIndex(times, t) {
    const n = times.length;
    if (n <= 2 || t <= times[0]) return 0;
    if (t >= times[n - 2]) return n - 2;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  function isFiniteQuaternion(q) {
    return Boolean(
      q &&
        Number.isFinite(q.x) &&
        Number.isFinite(q.y) &&
        Number.isFinite(q.z) &&
        Number.isFinite(q.w) &&
        q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w > 1e-8
    );
  }

  function isFiniteVector3(v) {
    return Boolean(
      v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
    );
  }

  /**
   * ==========================================================================
   * UPDATE V38 SECTION 1: STRIP 100% OF `.scale` AND `.position` TRACKS FROM
   * FBX ANIMATION CLIPS & EXTRACT BOUNDED RELATIVE HIPS BOUNCE CURVE
   * (`sanitizeAndFilterFBXAnimationClip`)
   * - Filters out 100% of `.scale` tracks and 100% of `.position` tracks from
   *   `clip.tracks` so centimeter-unit FBX translations (`100.0+`) or zero scales
   *   from Sketchfab (`Excited.fbx`) can NEVER fling Nahida off-screen or produce NaN!
   * - Extracts the root `Hips.position` curve (if present) into a read-only
   *   relative bounce sampler `clip.__hipsBounceCurve` so vertical/lateral hip
   *   bounce is computed strictly as $\Delta p = (p(t) - p(0)) \times \text{scaleRatio}$
   *   clamped to $\Delta x \in [-0.04, 0.04],\ \Delta y \in [-0.05, 0.06],\ \Delta z \in [-0.03, 0.03]$.
   * ==========================================================================
   */
  function sanitizeAndFilterFBXAnimationClip(rawClip) {
    if (!rawClip || !Array.isArray(rawClip.tracks)) {
      return rawClip;
    }

    let hipsBounceCurve = null;
    const rotationOnlyTracks = [];

    for (let tIdx = 0; tIdx < rawClip.tracks.length; tIdx++) {
      const track = rawClip.tracks[tIdx];
      if (!track || !track.name || !track.times || !track.values) continue;

      const trackName = String(track.name);
      const dotIdx = trackName.lastIndexOf('.');
      const nodeName = dotIdx > 0 ? trackName.slice(0, dotIdx) : trackName;
      const propName = dotIdx > 0 ? trackName.slice(dotIdx + 1).toLowerCase() : '';

      // 1. STRICTLY FORBID & DROP ALL `.scale` TRACKS (100% removed)
      if (propName === 'scale' || /\.scale$/i.test(trackName)) {
        continue;
      }

      // 2. STRICTLY FORBID & DROP ALL `.position` TRACKS FROM MIXER
      //    (Extract relative Hips bounce curve into `hipsBounceCurve` only if it's the Hips/Pelvis root bone)
      if (propName === 'position' || /\.position$/i.test(trackName)) {
        const isHipsNode =
          /(hips|pelvis|root|center|waist|lowerbody|bip00?1$|bip00?1[_\s-]*pelvis|mixamorighips|cc_base_hip|cc_base_pelvis|j_bip_c_hips)/i.test(
            nodeName
          ) &&
          !/(leg|thigh|calf|knee|foot|toe|arm|hand|finger|thumb|head|neck|shoulder|clavicle)/i.test(
            nodeName
          );

        if (isHipsNode && !hipsBounceCurve && track.times.length >= 2) {
          const nKeys = track.times.length;
          const cleanTimes = [];
          const cleanVals = [];
          let lastX = 0;
          let lastY = 0;
          let lastZ = 0;
          let hasFirst = false;

          for (let k = 0; k < nKeys; k++) {
            const tk = track.times[k];
            const vx = track.values[k * 3];
            const vy = track.values[k * 3 + 1];
            const vz = track.values[k * 3 + 2];
            if (!Number.isFinite(tk)) continue;
            if (cleanTimes.length > 0 && tk <= cleanTimes[cleanTimes.length - 1] + 1e-6) {
              continue;
            }
            const sx = Number.isFinite(vx) ? vx : lastX;
            const sy = Number.isFinite(vy) ? vy : lastY;
            const sz = Number.isFinite(vz) ? vz : lastZ;
            lastX = sx;
            lastY = sy;
            lastZ = sz;
            hasFirst = true;
            cleanTimes.push(tk);
            cleanVals.push(sx, sy, sz);
          }

          if (hasFirst && cleanTimes.length >= 2) {
            hipsBounceCurve = {
              times: new Float32Array(cleanTimes),
              values: new Float32Array(cleanVals),
              p0: [cleanVals[0], cleanVals[1], cleanVals[2]]
            };
          }
        }
        // Always drop `.position` track from the AnimationClip so AnimationMixer never moves any bone!
        continue;
      }

      // 3. KEEP ONLY VALID, FINITE `.quaternion` ROTATION TRACKS
      const numKeys = track.times.length;
      if (numKeys < 1) continue;
      const valueSize = Math.round(track.values.length / numKeys);
      const isQuat =
        track instanceof THREE.QuaternionKeyframeTrack ||
        track.ValueTypeName === 'quaternion' ||
        propName === 'quaternion' ||
        valueSize === 4;

      if (!isQuat || valueSize !== 4) {
        continue;
      }

      const validTimes = [];
      const validValues = [];
      let prevQ = [0, 0, 0, 1];

      for (let k = 0; k < numKeys; k++) {
        const tk = track.times[k];
        if (!Number.isFinite(tk)) continue;
        if (validTimes.length > 0 && tk <= validTimes[validTimes.length - 1] + 1e-6) {
          continue;
        }
        const base = k * 4;
        let qx = track.values[base];
        let qy = track.values[base + 1];
        let qz = track.values[base + 2];
        let qw = track.values[base + 3];
        const len = Math.hypot(qx, qy, qz, qw);
        if (
          !Number.isFinite(qx) ||
          !Number.isFinite(qy) ||
          !Number.isFinite(qz) ||
          !Number.isFinite(qw) ||
          len < 1e-6
        ) {
          qx = prevQ[0];
          qy = prevQ[1];
          qz = prevQ[2];
          qw = prevQ[3];
        } else {
          qx /= len;
          qy /= len;
          qz /= len;
          qw /= len;
          prevQ = [qx, qy, qz, qw];
        }
        validTimes.push(tk);
        validValues.push(qx, qy, qz, qw);
      }

      if (validTimes.length >= 1) {
        rotationOnlyTracks.push(
          new THREE.QuaternionKeyframeTrack(
            track.name,
            new Float32Array(validTimes),
            new Float32Array(validValues)
          )
        );
      }
    }

    const sanitizedClip = new THREE.AnimationClip(
      rawClip.name || 'sanitized_fbx_motion',
      rawClip.duration,
      rotationOnlyTracks
    );
    sanitizedClip.__hipsBounceCurve = hipsBounceCurve;
    return sanitizedClip;
  }

  function upsampleAnimationClipTo120FPS(clip) {
    if (!clip || !Array.isArray(clip.tracks) || clip.duration <= 0.001) {
      return clip;
    }

    // First strip 100% of `.scale` and `.position` tracks and sanitize quaternions
    const cleanClip = sanitizeAndFilterFBXAnimationClip(clip);
    const TARGET_FPS = 120;
    const dt = 1.0 / TARGET_FPS;
    const duration = cleanClip.duration;
    const numSamples = Math.max(2, Math.ceil(duration * TARGET_FPS) + 1);
    const uniformTimes = new Float32Array(numSamples);
    for (let s = 0; s < numSamples; s++) {
      uniformTimes[s] = Math.min(duration, s * dt);
    }

    // Precompute normalized Gaussian smoothing weights for sigma = 0.85 (radius = 2: k in [-2..2])
    const sigma = 0.85;
    const gaussRadius = 2;
    const gaussKernel = [];
    let gaussSum = 0;
    for (let k = -gaussRadius; k <= gaussRadius; k++) {
      const w = Math.exp(-(k * k) / (2.0 * sigma * sigma));
      gaussKernel.push(w);
      gaussSum += w;
    }
    for (let i = 0; i < gaussKernel.length; i++) {
      gaussKernel[i] /= gaussSum;
    }

    const sQuatP = new THREE.Quaternion();
    const sQuatQ = new THREE.Quaternion();
    const sQuatOut = new THREE.Quaternion();

    const newTracks = cleanClip.tracks.map((track) => {
      const srcTimes = track.times;
      const srcVals = track.values;
      const numKeys = srcTimes ? srcTimes.length : 0;
      if (numKeys < 2) {
        return track;
      }

      const valueSize = Math.round(srcVals.length / numKeys);
      if (valueSize !== 4) {
        return track;
      }

      // QUATERNION TRACK: C1 Spherical Cubic SQUAD SLERP + Shortest-Path Lock + Gaussian Filter (sigma = 0.85)
      const keyQuats = new Array(numKeys);
      for (let k = 0; k < numKeys; k++) {
        const idx = k * 4;
        const q = new THREE.Quaternion(
          srcVals[idx],
          srcVals[idx + 1],
          srcVals[idx + 2],
          srcVals[idx + 3]
        );
        if (!isFiniteQuaternion(q)) {
          q.set(0, 0, 0, 1);
        } else {
          q.normalize();
        }
        if (k > 0 && keyQuats[k - 1].dot(q) < 0) {
          q.set(-q.x, -q.y, -q.z, -q.w);
        }
        keyQuats[k] = q;
      }

      // Precompute SQUAD C1 tangent control quaternions a_i across (q_{i-1}, q_i, q_{i+1})
      const squadTangents = new Array(numKeys);
      for (let k = 0; k < numKeys; k++) {
        const qPrev = keyQuats[Math.max(0, k - 1)];
        const qCurr = keyQuats[k];
        const qNext = keyQuats[Math.min(numKeys - 1, k + 1)];
        const tang = computeSquadTangentQuat(
          qPrev,
          qCurr,
          qNext,
          new THREE.Quaternion()
        );
        if (!isFiniteQuaternion(tang)) {
          tang.copy(qCurr);
        }
        squadTangents[k] = tang;
      }

      // Evaluate SQUAD at 120 FPS
      const raw120 = new Float32Array(numSamples * 4);
      for (let s = 0; s < numSamples; s++) {
        const t = uniformTimes[s];
        const segIdx = findKeyframeSegmentIndex(srcTimes, t);
        const t0 = srcTimes[segIdx];
        const t1 = srcTimes[segIdx + 1];
        const span = Math.max(1e-6, t1 - t0);
        const u = THREE.MathUtils.clamp((t - t0) / span, 0.0, 1.0);

        const q0 = keyQuats[segIdx];
        const q1 = keyQuats[segIdx + 1];
        const a0 = squadTangents[segIdx];
        const a1 = squadTangents[segIdx + 1];

        sQuatP.copy(q0).slerp(q1, u);
        sQuatQ.copy(a0);
        if (sQuatQ.dot(a1) < 0) {
          sQuatOut.set(-a1.x, -a1.y, -a1.z, -a1.w);
        } else {
          sQuatOut.copy(a1);
        }
        sQuatQ.slerp(sQuatOut, u);

        if (sQuatP.dot(sQuatQ) < 0) {
          sQuatQ.set(-sQuatQ.x, -sQuatQ.y, -sQuatQ.z, -sQuatQ.w);
        }
        const squadBlend = 2.0 * u * (1.0 - u);
        sQuatP.slerp(sQuatQ, squadBlend);
        if (!isFiniteQuaternion(sQuatP)) {
          sQuatP.copy(q0);
        } else {
          sQuatP.normalize();
        }

        const outBase = s * 4;
        if (s > 0) {
          const prevBase = (s - 1) * 4;
          const dotPrev =
            raw120[prevBase] * sQuatP.x +
            raw120[prevBase + 1] * sQuatP.y +
            raw120[prevBase + 2] * sQuatP.z +
            raw120[prevBase + 3] * sQuatP.w;
          if (dotPrev < 0) {
            sQuatP.set(-sQuatP.x, -sQuatP.y, -sQuatP.z, -sQuatP.w);
          }
        }
        raw120[outBase] = sQuatP.x;
        raw120[outBase + 1] = sQuatP.y;
        raw120[outBase + 2] = sQuatP.z;
        raw120[outBase + 3] = sQuatP.w;
      }

      // Apply light Gaussian smoothing filter (sigma = 0.85) with Shortest-Path Hemisphere Lock
      const smoothed120 = new Float32Array(numSamples * 4);
      for (let s = 0; s < numSamples; s++) {
        const cBase = s * 4;
        const cx = raw120[cBase];
        const cy = raw120[cBase + 1];
        const cz = raw120[cBase + 2];
        const cw = raw120[cBase + 3];

        let accX = 0;
        let accY = 0;
        let accZ = 0;
        let accW = 0;

        for (let k = -gaussRadius; k <= gaussRadius; k++) {
          const w = gaussKernel[k + gaussRadius];
          const nIdx = THREE.MathUtils.clamp(s + k, 0, numSamples - 1) * 4;
          let nx = raw120[nIdx];
          let ny = raw120[nIdx + 1];
          let nz = raw120[nIdx + 2];
          let nw = raw120[nIdx + 3];
          if (cx * nx + cy * ny + cz * nz + cw * nw < 0) {
            nx = -nx;
            ny = -ny;
            nz = -nz;
            nw = -nw;
          }
          accX += nx * w;
          accY += ny * w;
          accZ += nz * w;
          accW += nw * w;
        }

        const len = Math.hypot(accX, accY, accZ, accW);
        if (!Number.isFinite(len) || len < 1e-7) {
          accX = cx;
          accY = cy;
          accZ = cz;
          accW = cw;
        } else {
          const invLen = 1.0 / len;
          accX *= invLen;
          accY *= invLen;
          accZ *= invLen;
          accW *= invLen;
        }

        if (s > 0) {
          const pBase = (s - 1) * 4;
          const dotPrev =
            smoothed120[pBase] * accX +
            smoothed120[pBase + 1] * accY +
            smoothed120[pBase + 2] * accZ +
            smoothed120[pBase + 3] * accW;
          if (dotPrev < 0) {
            accX = -accX;
            accY = -accY;
            accZ = -accZ;
            accW = -accW;
          }
        }

        smoothed120[cBase] = accX;
        smoothed120[cBase + 1] = accY;
        smoothed120[cBase + 2] = accZ;
        smoothed120[cBase + 3] = accW;
      }

      return new THREE.QuaternionKeyframeTrack(track.name, uniformTimes, smoothed120);
    });

    // Also upsample the extracted read-only Hips relative bounce curve (if present) using Cubic Catmull-Rom Spline
    let upsampledHipsCurve = null;
    if (cleanClip.__hipsBounceCurve) {
      const hc = cleanClip.__hipsBounceCurve;
      const hTimes = hc.times;
      const hVals = hc.values;
      const hKeys = hTimes.length;
      const outVecVals = new Float32Array(numSamples * 3);
      for (let s = 0; s < numSamples; s++) {
        const t = uniformTimes[s];
        const i1 = findKeyframeSegmentIndex(hTimes, t);
        const i0 = Math.max(0, i1 - 1);
        const i2 = Math.min(hKeys - 1, i1 + 1);
        const i3 = Math.min(hKeys - 1, i1 + 2);

        const t0 = hTimes[i1];
        const t1 = hTimes[i2];
        const span = Math.max(1e-6, t1 - t0);
        const u = THREE.MathUtils.clamp((t - t0) / span, 0.0, 1.0);

        const outBase = s * 3;
        for (let c = 0; c < 3; c++) {
          const p0 = hVals[i0 * 3 + c];
          const p1 = hVals[i1 * 3 + c];
          const p2 = hVals[i2 * 3 + c];
          const p3 = hVals[i3 * 3 + c];
          const val = catmullRomScalar(p0, p1, p2, p3, u);
          outVecVals[outBase + c] = Number.isFinite(val) ? val : hc.p0[c];
        }
      }
      upsampledHipsCurve = {
        dt,
        duration,
        numSamples,
        times: uniformTimes,
        values: outVecVals,
        p0: [outVecVals[0], outVecVals[1], outVecVals[2]]
      };
    }

    const resultClip = new THREE.AnimationClip(
      `${cleanClip.name || 'motion'}_120fps`,
      duration,
      newTracks
    );
    resultClip.__hipsBounceCurve = upsampledHipsCurve;
    return resultClip;
  }
  window.upsampleAnimationClipTo120FPS = upsampleAnimationClipTo120FPS;

  /**
   * ==========================================================================
   * UPDATE V37/V38/V39 SECTION 1: STRIP & DISPOSE ALL MESHES/MATERIALS FROM FBX MOTION
   * (`stripAndDisposeFBXMeshes`)
   * Ensures ZERO mesh/skinnedMesh from `/change-pose-379001.fbx`, `/Yawn.fbx`,
   * or `/Blow A Kiss.fbx` is ever added or kept in memory, and locks all FBX
   * bone scales to (1,1,1)!
   * ==========================================================================
   */
  function stripAndDisposeFBXMeshes(fbxRoot) {
    if (!fbxRoot) return;
    const leafMeshesToRemove = [];
    fbxRoot.traverse((child) => {
      if (child.isBone || child.type === 'Bone' || child !== fbxRoot) {
        child.userData = child.userData || {};
        if (!child.userData.__fbxBindPos) {
          child.userData.__fbxBindPos = child.position.clone();
          child.userData.__fbxBindQuat = child.quaternion.clone();
          child.userData.__fbxBindScale = new THREE.Vector3(1, 1, 1);
        }
        // Prevent any zero or negative scale on FBX bones
        if (
          !isFiniteVector3(child.scale) ||
          Math.abs(child.scale.x) < 1e-4 ||
          Math.abs(child.scale.y) < 1e-4 ||
          Math.abs(child.scale.z) < 1e-4
        ) {
          child.scale.set(1, 1, 1);
        }
      }

      if (child.isMesh || child.isSkinnedMesh || child.isLine || child.isPoints) {
        if (child.geometry && typeof child.geometry.dispose === 'function') {
          child.geometry.dispose();
        }
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m) => {
            if (!m) return;
            [
              'map',
              'normalMap',
              'roughnessMap',
              'metalnessMap',
              'aoMap',
              'emissiveMap',
              'alphaMap',
              'specularMap',
              'envMap'
            ].forEach((texKey) => {
              if (m[texKey] && typeof m[texKey].dispose === 'function') {
                m[texKey].dispose();
              }
            });
            if (typeof m.dispose === 'function') {
              m.dispose();
            }
          });
        }
        child.visible = false;

        let containsBoneDescendant = false;
        child.traverse((sub) => {
          if (sub !== child && (sub.isBone || sub.type === 'Bone')) {
            containsBoneDescendant = true;
          }
        });
        if (!containsBoneDescendant && !child.isBone) {
          leafMeshesToRemove.push(child);
        }
      }
    });

    leafMeshesToRemove.forEach((meshNode) => {
      if (meshNode.parent) {
        meshNode.parent.remove(meshNode);
      }
    });
  }

  /**
   * Creates a per-clip motion state object for 3-Motion Retargeting (UPDATE V39).
   * Used for `motion1` (`/change-pose-379001.fbx`), `motion2` (`/Yawn.fbx`), and `motion3` (`/Blow A Kiss.fbx`).
   */
  function createFBXClipSlot(id, url, isMixamoChibi = false) {
    return {
      id,
      url,
      isMixamoChibi,
      isSpellCast: isMixamoChibi,
      fbxRoot: null,
      sourceMixer: null,
      sourceAction: null,
      clip: null,
      clipStartTime: 0.02, // Skip Frame 0 T-Pose (`t = 0.02s`)
      clipDuration: 1.0,
      currentClipTime: 0.02,
      isReady: false,
      // Canonical Upright Root Orientation (`WORLD_Y = (0, 1, 0)`, facing `+Z`)
      canonicalRootQuat: new THREE.Quaternion(),
      srcBones: null,
      // Update V39 Section 2: MixamoChibiSmartRetargeter Rest-Pose Delta-Quaternion Table
      restPoseDeltaMap: new Map(),
      fingerDeltaList: [],
      // Update V39 Section 2.1: Bounded Relative Hips Bounce (`hipsBounceCurve`)
      hipsBounceCurve: null,
      sourceHipsBone: null,
      sourceHipsRestPos: new THREE.Vector3(),
      hipScaleRatio: 0.0085,
      startFrameBonePositions: new Map(),
      startFrameHipsPos: new THREE.Vector3(),
      // UPDATE V41 SECTION 1: Pre-Computed StartPose (t = 0) & EndPose (t = T_end) for Look-Ahead Direct Pose-to-Pose Bridge
      startPoseBoneQuats: new Map(),
      startPoseHipsPos: new THREE.Vector3(),
      endPoseBoneQuats: new Map(),
      endPoseHipsPos: new THREE.Vector3(),
      hasPrecomputedBoundaryPoses: false
    };
  }

  /**
   * `fbxRetargetState` (UPDATE V41 — Pre-Sampled Look-Ahead Pose-to-Pose Bridge & Horizontal Mouth-to-Forward Kiss Projection):
   * - `motion1` ($A_0$): `/change-pose-379001.fbx` (Opening pose)
   * - `motion2` ($A_1$): `/Yawn.fbx` (Mixamo Without Skin 60FPS — Yawn & Stretch)
   * - `motion3` ($A_2$): `/Blow A Kiss.fbx` (Mixamo Without Skin 60FPS — Blow a Kiss & Wave)
   * - Update V41 Section 1 (`Look-Ahead Direct Pose Interpolation`):
   *   + Completely removes any `Return-to-Origin` / `Return-to-Neutral` intermediate rest pose!
   *   + Pre-computes $\text{StartPose}(A_i)$ at $t = 0$ and $\text{EndPose}(A_i)$ at $t = T_{\text{end}}$
   *     across all bones & `Hips` position for all 3 clips.
   *   + When animation $A_i$ finishes, runs a `0.38s` Look-Ahead Bridge (`STAGE_LOOKAHEAD_BRIDGE`)
   *     that directly interpolates every bone $b$ from $q_b^{\text{end}}(A_i)$ to $q_b^{\text{start}}(A_{i+1})$
   *     using $C^2$ Quintic Ease-In-Out $s(u) = 6u^5 - 15u^4 + 10u^3$ with shortest-path hemisphere lock
   *     ($q_1 \cdot q_2 \ge 0$), and right at $u = 1.0$ (zero error!) starts $A_{i+1}$ from $t = 0$.
   */
  const fbxRetargetState = {
    motion1: createFBXClipSlot('change_pose', '/change-pose-379001.fbx', false),
    motion2: createFBXClipSlot('yawn_motion', '/Yawn.fbx', true),
    motion3: createFBXClipSlot('blow_a_kiss_motion', '/Blow A Kiss.fbx', true),
    activeSlotIndex: 1, // 1 = motion1 (`change-pose-379001.fbx`), 2 = motion2 (`Yawn.fbx`), 3 = motion3 (`Blow A Kiss.fbx`)
    nextSlotIndex: 2,
    sequenceStage: 'STAGE_MOTION_1', // 'STAGE_MOTION_1' | 'STAGE_MOTION_2' | 'STAGE_MOTION_3' | 'STAGE_LOOKAHEAD_BRIDGE'
    bridgeTimer: 0.0,
    lookAheadBridgeDuration: 0.38,
    returnToNeutralDuration: 0.38,
    blendInDuration: 0.38,
    blendInNextDuration: 0.38,
    bridgeMotionFactor: 1.0,
    bridgeFromBoneQuats: new Map(),
    bridgeFromHipsPos: new THREE.Vector3(),
    bridgeToBoneQuats: new Map(),
    bridgeToHipsPos: new THREE.Vector3(),
    bridgeSnapshotQuats: new Map(),
    bridgeSnapshotModelPos: new THREE.Vector3(),
    lastFrameArmQuats: new Map(),
    hasLastFrameArmQuats: false,
    crossFadeDuration: 0.38,
    crossFadeAlpha: 0.0,
    spellCastFingerOpenFactor: 0.0,
    isReady: false,
    motionBlendWeight: 0.0,
    targetBlendWeight: 1.0,
    blendSpeed: 1.0 / 0.38,
    restLeftFootCharY: 0.08,
    restRightFootCharY: 0.08,
    restLeftToeCharY: 0.03,
    restRightToeCharY: 0.03
  };

  /**
   * UPDATE V40 SECTION 1: Captures and applies `lastFrameArmQuats` across all Shoulder, Arm,
   * ForeArm, Hand, and Finger bones so arms NEVER snap or interpolate toward T-Pose (`bindPose`/`restPose`)
   * during transitions between animations!
   */
  function captureLastFrameArmAndFingerQuats(targetMap = fbxRetargetState.lastFrameArmQuats) {
    if (!targetMap) return;
    const armEntries = [
      riggedBones.rightShoulder,
      riggedBones.rightArm,
      riggedBones.rightElbow,
      riggedBones.rightWrist,
      riggedBones.leftShoulder,
      riggedBones.leftArm,
      riggedBones.leftElbow,
      riggedBones.leftWrist
    ];
    for (let i = 0; i < armEntries.length; i++) {
      const e = armEntries[i];
      if (e && e.bone && isFiniteQuaternion(e.bone.quaternion)) {
        let q = targetMap.get(e.bone);
        if (!q) {
          q = new THREE.Quaternion();
          targetMap.set(e.bone, q);
        }
        q.copy(e.bone.quaternion);
      }
    }
    if (Array.isArray(riggedBones.fingerBones)) {
      for (let i = 0; i < riggedBones.fingerBones.length; i++) {
        const fb = riggedBones.fingerBones[i];
        if (fb && fb.bone && isFiniteQuaternion(fb.bone.quaternion)) {
          let q = targetMap.get(fb.bone);
          if (!q) {
            q = new THREE.Quaternion();
            targetMap.set(fb.bone, q);
          }
          q.copy(fb.bone.quaternion);
        }
      }
    }
    fbxRetargetState.hasLastFrameArmQuats = targetMap.size > 0;
  }

  function applyPreservedArmEndPoseOrSlerpToCurrent(slerpToCurrentFactor = 0.0) {
    if (!fbxRetargetState.hasLastFrameArmQuats) return;
    const targetMap = fbxRetargetState.lastFrameArmQuats;
    const alpha = THREE.MathUtils.clamp(slerpToCurrentFactor, 0.0, 1.0);
    const armEntries = [
      riggedBones.rightShoulder,
      riggedBones.rightArm,
      riggedBones.rightElbow,
      riggedBones.rightWrist,
      riggedBones.leftShoulder,
      riggedBones.leftArm,
      riggedBones.leftElbow,
      riggedBones.leftWrist
    ];
    for (let i = 0; i < armEntries.length; i++) {
      const e = armEntries[i];
      if (!e || !e.bone) continue;
      const savedQ = targetMap.get(e.bone);
      if (!savedQ || !isFiniteQuaternion(savedQ)) continue;
      if (alpha <= 0.0001) {
        e.bone.quaternion.copy(savedQ);
      } else {
        _alignTargetBoneQuat.copy(e.bone.quaternion);
        ensureShortestPathQuat(savedQ, _alignTargetBoneQuat);
        e.bone.quaternion.copy(savedQ).slerp(_alignTargetBoneQuat, alpha);
      }
      e.bone.updateMatrixWorld(true);
    }
    if (Array.isArray(riggedBones.fingerBones)) {
      for (let i = 0; i < riggedBones.fingerBones.length; i++) {
        const fb = riggedBones.fingerBones[i];
        if (!fb || !fb.bone) continue;
        const savedQ = targetMap.get(fb.bone);
        if (!savedQ || !isFiniteQuaternion(savedQ)) continue;
        if (alpha <= 0.0001) {
          fb.bone.quaternion.copy(savedQ);
        } else {
          _alignTargetBoneQuat.copy(fb.bone.quaternion);
          ensureShortestPathQuat(savedQ, _alignTargetBoneQuat);
          fb.bone.quaternion.copy(savedQ).slerp(_alignTargetBoneQuat, alpha);
        }
      }
    }
  }

  /**
   * UPDATE V40 SECTION 3: AERIAL FLIGHT PHYSICS & ASYNCHRONOUS LEG PENDULUM STATE
   * Tracks real-time flight velocity $\mathbf{v} = (\dot{x}, \dot{y})$, vertical acceleration $\ddot{y}$,
   * and a 2nd-order Spring-Damper Pendulum for Nahida's legs during `triggerCamellyaPullCurtain`.
   */
  const aerialCurtainFlightState = {
    initialized: false,
    prevX: 0.0,
    prevY: 0.0,
    vx: 0.0,
    vy: 0.0,
    ay: 0.0,
    pendulumAngleX: 0.0,
    pendulumVelX: 0.0,
    pendulumRollZ: 0.0,
    pendulumVelZ: 0.0
  };

  function smoothstep01(edge0, edge1, x) {
    const u = THREE.MathUtils.clamp((x - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
    return u * u * (3 - 2 * u);
  }

  /**
   * Clamps a unit direction vector `dir` so its angle with `axis` never exceeds `maxAngleRad`.
   * Preserves the exact azimuth direction of the swing while preventing unnatural hyper-tilt!
   */
  const _coneClampQuat = new THREE.Quaternion();
  const _coneIdentityQuat = new THREE.Quaternion();
  function clampDirectionToCone(dir, axis, maxAngleRad) {
    if (dir.lengthSq() < 1e-6) {
      dir.copy(axis);
      return dir;
    }
    dir.normalize();
    const dot = THREE.MathUtils.clamp(dir.dot(axis), -1.0, 1.0);
    const angle = Math.acos(dot);
    if (angle > maxAngleRad && angle > 1e-5) {
      const t = maxAngleRad / angle;
      _coneClampQuat.setFromUnitVectors(axis, dir);
      _coneIdentityQuat.set(0, 0, 0, 1).slerp(_coneClampQuat, t);
      dir.copy(axis).applyQuaternion(_coneIdentityQuat).normalize();
    }
    return dir;
  }

  const _alignSrcStart = new THREE.Vector3();
  const _alignSrcEnd = new THREE.Vector3();
  const _alignTgtStart = new THREE.Vector3();
  const _alignTgtEnd = new THREE.Vector3();
  const _alignDesiredDir = new THREE.Vector3();
  const _alignCurrentDir = new THREE.Vector3();
  const _alignWorldSwingQuat = new THREE.Quaternion();
  const _alignParentWorldQuat = new THREE.Quaternion();
  const _alignParentWorldQuatInv = new THREE.Quaternion();
  const _alignCurrentTargetWorldQuat = new THREE.Quaternion();
  const _alignNewTargetWorldQuat = new THREE.Quaternion();
  const _alignSolvedLocalQuat = new THREE.Quaternion();
  const _alignSolvedLocalQuat2 = new THREE.Quaternion();
  const _alignPass1LocalQuat = new THREE.Quaternion();
  const tempHeadWorldPos = new THREE.Vector3();
  const tempFallbackEuler = new THREE.Euler();
  const tempFallbackQuat = new THREE.Quaternion();
  const tempFallbackVec = new THREE.Vector3();
  const tempPivotWorldQuat = new THREE.Quaternion();
  const tempCurrSrcWorldQuat = new THREE.Quaternion();
  const tempWorldDeltaQuat = new THREE.Quaternion();
  const tempFinalCharSpaceQuat = new THREE.Quaternion();
  const tempFinalWorldQuat = new THREE.Quaternion();
  const tempParentWorldQuatInv = new THREE.Quaternion();
  const tempRetargetLocalQuat = new THREE.Quaternion();
  const tempBoneWp = new THREE.Vector3();
  const _alignBoneWorldQuat = new THREE.Quaternion();
  const _alignTargetLocalQuat = new THREE.Quaternion();
  let prevElapsed = 0;

  function solveBoneDirectionSwingLocalQuat(
    sourceBone,
    sourceChild,
    targetBone,
    targetChild,
    targetBindLocalQuat,
    customDesiredWorldDir,
    outLocalQuat
  ) {
    if (!targetBone || !targetChild || !targetBindLocalQuat) return false;
    if (!customDesiredWorldDir && (!sourceBone || !sourceChild)) return false;

    const savedQuatX = targetBone.quaternion.x;
    const savedQuatY = targetBone.quaternion.y;
    const savedQuatZ = targetBone.quaternion.z;
    const savedQuatW = targetBone.quaternion.w;

    // 1. Temporarily restore `targetBindLocalQuat` of `targetBone` to measure its clean Bind/Relaxed direction in World Space:
    targetBone.quaternion.copy(targetBindLocalQuat);
    targetBone.updateMatrixWorld(true);

    if (customDesiredWorldDir) {
      _alignDesiredDir.copy(customDesiredWorldDir);
    } else {
      sourceBone.getWorldPosition(_alignSrcStart);
      sourceChild.getWorldPosition(_alignSrcEnd);
      _alignDesiredDir.subVectors(_alignSrcEnd, _alignSrcStart);
    }

    if (_alignDesiredDir.lengthSq() < 1e-6) {
      targetBone.quaternion.set(savedQuatX, savedQuatY, savedQuatZ, savedQuatW);
      targetBone.updateMatrixWorld(true);
      outLocalQuat.copy(targetBindLocalQuat);
      return false;
    }
    _alignDesiredDir.normalize();

    targetBone.getWorldPosition(_alignTgtStart);
    targetChild.getWorldPosition(_alignTgtEnd);
    _alignCurrentDir.subVectors(_alignTgtEnd, _alignTgtStart);
    if (_alignCurrentDir.lengthSq() < 1e-6) {
      targetBone.quaternion.set(savedQuatX, savedQuatY, savedQuatZ, savedQuatW);
      targetBone.updateMatrixWorld(true);
      outLocalQuat.copy(targetBindLocalQuat);
      return false;
    }
    _alignCurrentDir.normalize();

    // 2. Compute shortest-arc World Swing Quaternion from `currentWorldDir` to `desiredWorldDir`:
    _alignWorldSwingQuat.setFromUnitVectors(_alignCurrentDir, _alignDesiredDir);

    // 3. Convert World Swing to Local Space of `targetBone` (zero twist/roll distortion!):
    if (targetBone.parent) {
      targetBone.parent.getWorldQuaternion(_alignParentWorldQuat);
      _alignParentWorldQuatInv.copy(_alignParentWorldQuat).invert();
    } else {
      _alignParentWorldQuatInv.set(0, 0, 0, 1);
    }

    targetBone.getWorldQuaternion(_alignCurrentTargetWorldQuat);
    _alignNewTargetWorldQuat
      .copy(_alignWorldSwingQuat)
      .multiply(_alignCurrentTargetWorldQuat);
    outLocalQuat
      .copy(_alignParentWorldQuatInv)
      .multiply(_alignNewTargetWorldQuat);

    targetBone.quaternion.set(savedQuatX, savedQuatY, savedQuatZ, savedQuatW);
    targetBone.updateMatrixWorld(true);
    return true;
  }

  // ==========================================================================
  // UPDATE V37 SECTION 2.2: REAL-TIME 120FPS EXPONENTIAL MOVING AVERAGE
  // QUATERNION DAMPING (`alpha = 1 - exp(-22 * dt)`)
  // ==========================================================================
  const temporalBoneQuatMap = new Map();
  const emaFullSkeletonQuatMap = new Map();
  const _alignTargetBoneQuat = new THREE.Quaternion();
  let currentFrameDt = 0.016;

  function ensureShortestPathQuat(refQuat, targetQuat) {
    if (refQuat.dot(targetQuat) < 0) {
      targetQuat.set(
        -targetQuat.x,
        -targetQuat.y,
        -targetQuat.z,
        -targetQuat.w
      );
    }
  }

  function applyHighFpsTemporalBoneSlerp(bone, targetBoneQuat, dt = currentFrameDt) {
    if (!bone || !isFiniteQuaternion(targetBoneQuat)) return;
    let prevBoneQuat = temporalBoneQuatMap.get(bone);
    if (!prevBoneQuat || !isFiniteQuaternion(prevBoneQuat)) {
      prevBoneQuat = isFiniteQuaternion(bone.quaternion)
        ? bone.quaternion.clone()
        : targetBoneQuat.clone();
      temporalBoneQuatMap.set(bone, prevBoneQuat);
    }

    // Tier 1 — Shortest-Path Hemisphere Lock (q_prev . q_target >= 0)
    if (prevBoneQuat.dot(targetBoneQuat) < 0) {
      targetBoneQuat.set(
        -targetBoneQuat.x,
        -targetBoneQuat.y,
        -targetBoneQuat.z,
        -targetBoneQuat.w
      );
    }

    // Tier 2 — Real-Time Exponential Moving Average Quaternion Damping (alpha = 1 - exp(-22 * dt))
    const smoothAlpha = 1.0 - Math.exp(-22.0 * Math.max(0.001, dt));
    bone.quaternion.copy(prevBoneQuat).slerp(targetBoneQuat, smoothAlpha);
    if (!isFiniteQuaternion(bone.quaternion)) {
      bone.quaternion.copy(targetBoneQuat);
    }
    prevBoneQuat.copy(bone.quaternion);
    bone.updateMatrixWorld(true);
  }

  /**
   * Real-time full-skeleton EMA Quaternion Damping pass (`alpha = 1 - exp(-22 * dt)`)
   * applied in `requestAnimationFrame` across all articulated bones of Nahida.
   */
  function applyRealTimeEMAQuaternionDampingPass(dt = currentFrameDt) {
    const alpha = 1.0 - Math.exp(-22.0 * Math.max(0.001, dt));
    const coreEntries = [
      riggedBones.hips,
      riggedBones.spine,
      riggedBones.upperBody,
      riggedBones.chest,
      riggedBones.neck,
      riggedBones.head,
      riggedBones.rightShoulder,
      riggedBones.rightArm,
      riggedBones.rightElbow,
      riggedBones.rightWrist,
      riggedBones.leftShoulder,
      riggedBones.leftArm,
      riggedBones.leftElbow,
      riggedBones.leftWrist,
      riggedBones.rightLeg,
      riggedBones.rightKnee,
      riggedBones.rightFoot,
      riggedBones.rightToe,
      riggedBones.leftLeg,
      riggedBones.leftKnee,
      riggedBones.leftFoot,
      riggedBones.leftToe
    ];

    for (let i = 0; i < coreEntries.length; i++) {
      const entry = coreEntries[i];
      if (!entry || !entry.bone) continue;
      const bone = entry.bone;
      if (!isFiniteQuaternion(bone.quaternion)) {
        bone.quaternion.copy(entry.relaxedQuat || entry.restQuat || new THREE.Quaternion());
      }
      let emaQuat = emaFullSkeletonQuatMap.get(bone);
      if (!emaQuat || !isFiniteQuaternion(emaQuat)) {
        emaQuat = bone.quaternion.clone();
        emaFullSkeletonQuatMap.set(bone, emaQuat);
        continue;
      }
      ensureShortestPathQuat(emaQuat, bone.quaternion);
      emaQuat.slerp(bone.quaternion, alpha);
      if (!isFiniteQuaternion(emaQuat)) {
        emaQuat.copy(entry.relaxedQuat || bone.quaternion);
      }
      bone.quaternion.copy(emaQuat);
    }
    if (loadedModel) {
      loadedModel.updateMatrixWorld(true);
    }
  }

  /**
   * ==========================================================================
   * UPDATE V38 SECTION 4.1: BULLETPROOF NAHIDA STATE GUARD
   * (`enforceBulletproofNahidaStateGuard`)
   * Runs every frame inside `update()`:
   * 1. Ensures `loadedModel.visible = true` whenever `characterPivot.visible` is true,
   *    and sets `frustumCulled = false` on all meshes/SkinnedMeshes.
   * 2. Locks `Hips` and all bone `.position` and `.scale` to their exact initial
   *    rest values (`nahidaRestHipsPosition`, etc.) so no FBX track can ever
   *    translate or scale Nahida's bones.
   * 3. Checks `loadedModel.position` relative to `baseModelLocalPos`: keeps offset
   *    strictly within `<= 0.06` units (`dx in [-0.04, 0.04], dy in [-0.05, 0.06], dz in [-0.03, 0.03]`).
   *    If any bone or model position has `NaN` or drifts `> 0.15` units, immediately
   *    restores `restPose`!
   * ==========================================================================
   */
  function enforceBulletproofNahidaStateGuard() {
    if (!loadedModel) return;

    if (characterPivot.visible) {
      loadedModel.visible = true;
    }

    // 1. Protect `characterPivot` position, rotation, and scale against NaN
    if (!isFiniteVector3(characterPivot.position)) {
      const fallbackZone = getSafeZoneForSlide(currentSlideId || 1);
      characterPivot.position.set(fallbackZone.x, fallbackZone.y, fallbackZone.z);
    }
    if (
      !Number.isFinite(characterPivot.rotation.x) ||
      !Number.isFinite(characterPivot.rotation.y) ||
      !Number.isFinite(characterPivot.rotation.z)
    ) {
      const safeYaw = Number.isFinite(idleScheduler.baseStandYaw)
        ? idleScheduler.baseStandYaw
        : 0.0;
      characterPivot.rotation.set(0, safeYaw, 0);
      spinPhysics.prevRotationY = safeYaw;
    }
    if (
      !isFiniteVector3(characterPivot.scale) ||
      characterPivot.scale.x < 0.3 ||
      characterPivot.scale.x > 3.0
    ) {
      characterPivot.scale.setScalar(CHARACTER_UNIFORM_SCALE);
    }

    // 2. Protect `loadedModel.position` relative to `baseModelLocalPos`
    if (!isFiniteVector3(loadedModel.position)) {
      loadedModel.position.copy(baseModelLocalPos);
    } else {
      const dx = loadedModel.position.x - baseModelLocalPos.x;
      const dy = loadedModel.position.y - baseModelLocalPos.y;
      const dz = loadedModel.position.z - baseModelLocalPos.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 0.15) {
        loadedModel.position.copy(baseModelLocalPos);
      } else {
        loadedModel.position.x =
          baseModelLocalPos.x + THREE.MathUtils.clamp(dx, -0.04, 0.04);
        loadedModel.position.y =
          baseModelLocalPos.y + THREE.MathUtils.clamp(dy, -0.05, 0.06);
        loadedModel.position.z =
          baseModelLocalPos.z + THREE.MathUtils.clamp(dz, -0.03, 0.03);
      }
    }

    // 3. Lock Hips & all articulated bone positions/scales and heal any NaN quaternions
    const coreEntries = [
      riggedBones.hips,
      riggedBones.spine,
      riggedBones.upperBody,
      riggedBones.chest,
      riggedBones.neck,
      riggedBones.head,
      riggedBones.rightShoulder,
      riggedBones.rightArm,
      riggedBones.rightElbow,
      riggedBones.rightWrist,
      riggedBones.leftShoulder,
      riggedBones.leftArm,
      riggedBones.leftElbow,
      riggedBones.leftWrist,
      riggedBones.rightLeg,
      riggedBones.rightKnee,
      riggedBones.rightFoot,
      riggedBones.rightToe,
      riggedBones.leftLeg,
      riggedBones.leftKnee,
      riggedBones.leftFoot,
      riggedBones.leftToe
    ];

    for (let i = 0; i < coreEntries.length; i++) {
      const entry = coreEntries[i];
      if (!entry || !entry.bone) continue;
      const b = entry.bone;
      if (entry.restPos) {
        if (!isFiniteVector3(b.position) || b.position.distanceTo(entry.restPos) > 0.06) {
          b.position.copy(entry.restPos);
        } else {
          b.position.copy(entry.restPos);
        }
      }
      if (!isFiniteVector3(b.scale) || Math.abs(b.scale.x - 1.0) > 0.05) {
        b.scale.set(1, 1, 1);
      }
      if (!isFiniteQuaternion(b.quaternion)) {
        const fallbackQuat = entry.relaxedQuat || entry.restQuat || new THREE.Quaternion();
        b.quaternion.copy(fallbackQuat);
        temporalBoneQuatMap.set(b, fallbackQuat.clone());
        emaFullSkeletonQuatMap.set(b, fallbackQuat.clone());
      }
    }
  }

  function alignBoneToSourceDirection(
    sourceBone,
    sourceChild,
    targetBone,
    targetChild,
    targetBindLocalQuat,
    blendWeight = 1.0,
    customDesiredWorldDir = null
  ) {
    if (!targetBone || !targetChild || !targetBindLocalQuat) return;
    _alignPass1LocalQuat.copy(targetBone.quaternion);
    if (
      solveBoneDirectionSwingLocalQuat(
        sourceBone,
        sourceChild,
        targetBone,
        targetChild,
        targetBindLocalQuat,
        customDesiredWorldDir,
        _alignSolvedLocalQuat
      )
    ) {
      ensureShortestPathQuat(_alignPass1LocalQuat, _alignSolvedLocalQuat);
      _alignTargetBoneQuat
        .copy(_alignPass1LocalQuat)
        .slerp(_alignSolvedLocalQuat, blendWeight);
      applyHighFpsTemporalBoneSlerp(targetBone, _alignTargetBoneQuat, currentFrameDt);
    }
  }

  function alignBoneDualMotionDirection(
    targetBone,
    targetChild,
    targetBindLocalQuat,
    blendWeight,
    crossFadeAlpha,
    dir1,
    dir2
  ) {
    if (!targetBone || !targetChild || !targetBindLocalQuat) return;
    _alignPass1LocalQuat.copy(targetBone.quaternion);

    if (crossFadeAlpha <= 0.0001 || !dir2) {
      if (!dir1) return;
      if (
        solveBoneDirectionSwingLocalQuat(
          null,
          null,
          targetBone,
          targetChild,
          targetBindLocalQuat,
          dir1,
          _alignSolvedLocalQuat
        )
      ) {
        ensureShortestPathQuat(_alignPass1LocalQuat, _alignSolvedLocalQuat);
        _alignTargetBoneQuat
          .copy(_alignPass1LocalQuat)
          .slerp(_alignSolvedLocalQuat, blendWeight);
        applyHighFpsTemporalBoneSlerp(targetBone, _alignTargetBoneQuat, currentFrameDt);
      }
      return;
    }

    if (crossFadeAlpha >= 0.9999 || !dir1) {
      if (!dir2) return;
      if (
        solveBoneDirectionSwingLocalQuat(
          null,
          null,
          targetBone,
          targetChild,
          targetBindLocalQuat,
          dir2,
          _alignSolvedLocalQuat2
        )
      ) {
        ensureShortestPathQuat(_alignPass1LocalQuat, _alignSolvedLocalQuat2);
        _alignTargetBoneQuat
          .copy(_alignPass1LocalQuat)
          .slerp(_alignSolvedLocalQuat2, blendWeight);
        applyHighFpsTemporalBoneSlerp(targetBone, _alignTargetBoneQuat, currentFrameDt);
      }
      return;
    }

    const ok1 = solveBoneDirectionSwingLocalQuat(
      null,
      null,
      targetBone,
      targetChild,
      targetBindLocalQuat,
      dir1,
      _alignSolvedLocalQuat
    );
    const ok2 = solveBoneDirectionSwingLocalQuat(
      null,
      null,
      targetBone,
      targetChild,
      targetBindLocalQuat,
      dir2,
      _alignSolvedLocalQuat2
    );

    if (ok1 && ok2) {
      ensureShortestPathQuat(_alignSolvedLocalQuat, _alignSolvedLocalQuat2);
      _alignSolvedLocalQuat.slerp(_alignSolvedLocalQuat2, crossFadeAlpha);
      ensureShortestPathQuat(_alignPass1LocalQuat, _alignSolvedLocalQuat);
      _alignTargetBoneQuat
        .copy(_alignPass1LocalQuat)
        .slerp(_alignSolvedLocalQuat, blendWeight);
      applyHighFpsTemporalBoneSlerp(targetBone, _alignTargetBoneQuat, currentFrameDt);
    } else if (ok2) {
      ensureShortestPathQuat(_alignPass1LocalQuat, _alignSolvedLocalQuat2);
      _alignTargetBoneQuat
        .copy(_alignPass1LocalQuat)
        .slerp(_alignSolvedLocalQuat2, blendWeight);
      applyHighFpsTemporalBoneSlerp(targetBone, _alignTargetBoneQuat, currentFrameDt);
    } else if (ok1) {
      ensureShortestPathQuat(_alignPass1LocalQuat, _alignSolvedLocalQuat);
      _alignTargetBoneQuat
        .copy(_alignPass1LocalQuat)
        .slerp(_alignSolvedLocalQuat, blendWeight);
      applyHighFpsTemporalBoneSlerp(targetBone, _alignTargetBoneQuat, currentFrameDt);
    }
  }

  // ==========================================================================
  // UPDATE V37/V38 SECTION 4: ZERO-SNAP 3-STAGE PROCEDURAL SPIN STATE
  // Stage A (`0.00s -> 0.55s`): `0.00s -> 0.25s` Slerp Settle to Neutral Standing Pose
  //                            + `0.25s -> 0.55s` Spin Anticipation $w(t) = 0.5(1 - \cos(\pi t))$
  // Stage B (`0.55s -> 1.55s`): Graceful $360^\circ$ Pirouette $\theta(u) = 2\pi(3u^2 - 2u^3)$
  // Stage C (`1.55s -> 2.10s`): Smooth Follow-Through & Slerp Recovery to Neutral Standing Pose
  // ==========================================================================
  const spinStageState = {
    active: false,
    elapsed: 0.0,
    totalDuration: 2.10,
    baseX: CAMELLYA_SAFE_ZONES[1].x,
    baseY: CAMELLYA_SAFE_ZONES[1].y,
    baseZ: CAMELLYA_SAFE_ZONES[1].z,
    baseYaw: 0.16,
    startYaw: 0.16,
    entryYaw: 0.16,
    entryBoneQuats: new Map(),
    entryModelPos: new THREE.Vector3(),
    stageCCaptured: false,
    hasCapturedStageC: false,
    stageCStartQuats: new Map(),
    stageCStartModelPos: new THREE.Vector3()
  };

  function captureCurrentSkeletonSnapshot(targetMap, targetModelPos = null) {
    targetMap.clear();
    const entries = [
      riggedBones.hips,
      riggedBones.spine,
      riggedBones.upperBody,
      riggedBones.chest,
      riggedBones.neck,
      riggedBones.head,
      riggedBones.rightShoulder,
      riggedBones.rightArm,
      riggedBones.rightElbow,
      riggedBones.rightWrist,
      riggedBones.leftShoulder,
      riggedBones.leftArm,
      riggedBones.leftElbow,
      riggedBones.leftWrist,
      riggedBones.rightLeg,
      riggedBones.rightKnee,
      riggedBones.rightFoot,
      riggedBones.rightToe,
      riggedBones.leftLeg,
      riggedBones.leftKnee,
      riggedBones.leftFoot,
      riggedBones.leftToe
    ];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e && e.bone && isFiniteQuaternion(e.bone.quaternion)) {
        targetMap.set(e.bone, e.bone.quaternion.clone());
      } else if (e && e.bone && e.relaxedQuat) {
        targetMap.set(e.bone, e.relaxedQuat.clone());
      }
    }
    if (targetModelPos && loadedModel) {
      targetModelPos.copy(loadedModel.position);
    }
  }

  function slerpSkeletonFromSnapshotToCurrent(snapshotMap, sFactor) {
    const clampedS = THREE.MathUtils.clamp(sFactor, 0, 1);
    snapshotMap.forEach((snapQuat, bone) => {
      if (!bone || !isFiniteQuaternion(snapQuat)) return;
      _alignTargetBoneQuat.copy(bone.quaternion); // Current Neutral Standing Pose from Pass 1
      if (!isFiniteQuaternion(_alignTargetBoneQuat)) return;
      ensureShortestPathQuat(snapQuat, _alignTargetBoneQuat);
      bone.quaternion.copy(snapQuat).slerp(_alignTargetBoneQuat, clampedS);
      bone.updateMatrixWorld(true);
    });
  }

  function interruptIdleDanceAndSpin(fadeDuration = 0.3) {
    if (activeSpinTimeline) {
      activeSpinTimeline.kill();
      activeSpinTimeline = null;
    }
    isInPlaceSpinning = false;
    spinStageState.active = false;
    spinStageState.elapsed = 0.0;
    spinStageState.stageCCaptured = false;
    spinStageState.hasCapturedStageC = false;
    idleScheduler.mode = 'FBX_MOTION_MODE';
    idleScheduler.modeStartTime = prevElapsed;
    fbxRetargetState.targetBlendWeight = 0.0;
    fbxRetargetState.blendSpeed = 1.0 / Math.max(0.05, fadeDuration);
    fbxRetargetState.spellCastFingerOpenFactor = 0.0;
    gsap.killTweensOf(fbxRetargetState);
    gsap.to(fbxRetargetState, {
      motionBlendWeight: 0.0,
      duration: Math.max(0.05, fadeDuration),
      ease: 'power2.out'
    });
    if (loadedModel) {
      loadedModel.position.copy(baseModelLocalPos);
    }
  }

  /**
   * ==========================================================================
   * UPDATE V38 SECTION 2: SMART SKELETON TOPOLOGY MATCHER
   * (`SmartSkeletonTopologyMatcher(sourceFbxRoot, targetNahidaRoot)`)
   * Combines 2 Tiers of Bone Recognition:
   * - Tier 1: Multi-Standard Fuzzy Keyword Matching (strips `mixamorig:`, `DEF-`,
   *   `ORG-`, `Bip01_`, `CC_Base_`, `ValveBiped.`, `J_Bip_C_`, `J_Bip_L_`, `J_Bip_R_`,
   *   etc., and resolves Left/Right polarity across all torso, arm, and leg bones).
   * - Tier 2: Topological Graph Fallback (traverses the `THREE.Bone` tree from the
   *   pelvis hub `Hips`, identifying the ascending `Spine -> Chest -> Neck -> Head`
   *   chain, the two lateral `LeftArm` / `RightArm` chains from `Chest`, and the
   *   two descending `LeftUpLeg` / `RightUpLeg` chains from `Hips`).
   * ==========================================================================
   */
  const BONE_MAPPING_DICTIONARY = {
    hips: [
      'hips', 'hip', 'pelvis', 'root', 'waist', 'center', 'lowerbody', 'cog',
      'mixamorighips', 'bip01pelvis', 'bip001pelvis', 'ccbasehip', 'ccbasepelvis',
      'jbipchips', 'valvebipedbip01pelvis', 'defspine', 'defpelvis'
    ],
    spine: [
      'spine', 'waist', 'abdomen', 'torso', 'spine0', 'spine00', 'mixamorigspine',
      'bip01spine', 'bip001spine', 'ccbasewaist', 'ccbasespine', 'jbipcspine',
      'valvebipedbip01spine', 'defspine001'
    ],
    upperBody: [
      'spine1', 'spine01', 'upperbody', 'chest1', 'mixamorigspine1',
      'bip01spine1', 'bip001spine1', 'ccbasespine01', 'jbipcchest',
      'valvebipedbip01spine1', 'defspine002'
    ],
    chest: [
      'spine2', 'spine02', 'spine3', 'spine03', 'chest', 'upperchest', 'thorax',
      'mixamorigspine2', 'bip01spine2', 'bip001spine2', 'ccbasespine02',
      'jbipcupperchest', 'valvebipedbip01spine2', ' valvebipedbip01spine4', 'defspine003'
    ],
    neck: [
      'neck', 'neck01', 'neck1', 'necktwist01', 'mixamorigneck',
      'bip01neck', 'bip001neck', 'ccbaseneck', 'ccbasenecktwist01', 'jbipcneck',
      'valvebipedbip01neck1', 'defneck', 'defspine004'
    ],
    head: [
      'head', 'head01', 'mixamorighead', 'bip01head', 'bip001head', 'ccbasehead',
      'jbipchead', 'valvebipedbip01head1', 'defhead', 'defspine005', 'defspine006'
    ],
    leftShoulder: [
      'leftshoulder', 'lshoulder', 'shoulderl', 'leftclavicle', 'lclavicle', 'claviclel',
      'leftcollar', 'lcollar', 'mixamorigleftshoulder', 'bip01lclavicle', 'bip001lclavicle',
      'ccbaselclavicle', 'jbiplshoulder', 'valvebipedbip01lclavicle', 'defshoulderl'
    ],
    rightShoulder: [
      'rightshoulder', 'rshoulder', 'shoulderr', 'rightclavicle', 'rclavicle', 'clavicler',
      'rightcollar', 'rcollar', 'mixamorigrightshoulder', 'bip01rclavicle', 'bip001rclavicle',
      'ccbaserclavicle', 'jbiprshoulder', 'valvebipedbip01rclavicle', 'defshoulderr'
    ],
    leftArm: [
      'leftarm', 'larm', 'arml', 'leftupperarm', 'lupperarm', 'upperarml', 'leftuparm', 'luparm',
      'mixamorigleftarm', 'bip01lupperarm', 'bip001lupperarm', 'ccbaselupperarm',
      'jbiplupperarm', 'valvebipedbip01lupperarm', 'defupperarml'
    ],
    rightArm: [
      'rightarm', 'rarm', 'armr', 'rightupperarm', 'rupperarm', 'upperarmr', 'rightuparm', 'ruparm',
      'mixamorigrightarm', 'bip01rupperarm', 'bip001rupperarm', 'ccbaserupperarm',
      'jbiprupperarm', 'valvebipedbip01rupperarm', 'defupperarmr'
    ],
    leftElbow: [
      'leftforearm', 'lforearm', 'forearml', 'leftlowerarm', 'llowerarm', 'lowerarml',
      'leftlowarm', 'llowarm', 'leftelbow', 'lelbow', 'elbowl', 'mixamorigleftforearm',
      'bip01lforearm', 'bip001lforearm', 'ccbaselforearm', 'jbipllowerarm',
      'valvebipedbip01lforearm', 'defforearml'
    ],
    rightElbow: [
      'rightforearm', 'rforearm', 'forearmr', 'rightlowerarm', 'rlowerarm', 'lowerarmr',
      'rightlowarm', 'rlowarm', 'rightelbow', 'relbow', 'elbowr', 'mixamorigrightforearm',
      'bip01rforearm', 'bip001rforearm', 'ccbaserforearm', 'jbiprlowerarm',
      'valvebipedbip01rforearm', 'defforearmr'
    ],
    leftWrist: [
      'lefthand', 'lhand', 'handl', 'leftwrist', 'lwrist', 'wristl',
      'mixamoriglefthand', 'bip01lhand', 'bip001lhand', 'ccbaselhand',
      'jbiplhand', 'valvebipedbip01lhand', 'defhandl'
    ],
    rightWrist: [
      'righthand', 'rhand', 'handr', 'rightwrist', 'rwrist', 'wristr',
      'mixamorigrighthand', 'bip01rhand', 'bip001rhand', 'ccbaserhand',
      'jbiprhand', 'valvebipedbip01rhand', 'defhandr'
    ],
    leftLeg: [
      'leftupleg', 'lupleg', 'uplegl', 'leftupperleg', 'lupperleg', 'upperlegl',
      'leftthigh', 'lthigh', 'thighl', 'lefthip', 'lhip', 'mixamorigleftupleg',
      'bip01lthigh', 'bip001lthigh', 'ccbaselthigh', 'jbiplupperleg',
      'valvebipedbip01lthigh', 'defthighl'
    ],
    rightLeg: [
      'rightupleg', 'rupleg', 'uplegr', 'rightupperleg', 'rupperleg', 'upperlegr',
      'rightthigh', 'rthigh', 'thighr', 'righthip', 'rhip', 'mixamorigrightupleg',
      'bip01rthigh', 'bip001rthigh', 'ccbaserthigh', 'jbiprupperleg',
      'valvebipedbip01rthigh', 'defthighr'
    ],
    leftKnee: [
      'leftleg', 'lleg', 'legl', 'leftlowerleg', 'llowerleg', 'lowerlegl', 'leftlowleg',
      'leftcalf', 'lcalf', 'calfl', 'leftshin', 'lshin', 'shinl', 'leftknee', 'lknee', 'kneel',
      'mixamorigleftleg', 'bip01lcalf', 'bip001lcalf', 'ccbaselcalf', 'jbipllowerleg',
      'valvebipedbip01lcalf', 'defshinl'
    ],
    rightKnee: [
      'rightleg', 'rleg', 'legr', 'rightlowerleg', 'rlowerleg', 'lowerlegr', 'rightlowleg',
      'rightcalf', 'rcalf', 'calfr', 'rightshin', 'rshin', 'shinr', 'rightknee', 'rknee', 'kneer',
      'mixamorigrightleg', 'bip01rcalf', 'bip001rcalf', 'ccbasercalf', 'jbiprlowerleg',
      'valvebipedbip01rcalf', 'defshinr'
    ],
    leftFoot: [
      'leftfoot', 'lfoot', 'footl', 'leftankle', 'lankle', 'anklel',
      'mixamorigleftfoot', 'bip01lfoot', 'bip001lfoot', 'ccbaselfoot', 'jbiplfoot',
      'valvebipedbip01lfoot', 'deffootl'
    ],
    rightFoot: [
      'rightfoot', 'rfoot', 'footr', 'rightankle', 'rankle', 'ankler',
      'mixamorigrightfoot', 'bip01rfoot', 'bip001rfoot', 'ccbaserfoot', 'jbiprfoot',
      'valvebipedbip01rfoot', 'deffootr'
    ],
    leftToe: [
      'lefttoebase', 'ltoebase', 'toebasel', 'lefttoe', 'ltoe', 'toel', 'lefttoe0', 'ltoe0',
      'mixamoriglefttoebase', 'bip01ltoe0', 'bip001ltoe0', 'ccbaseltoebase', 'jbipltoebase',
      'valvebipedbip01ltoe0', 'deftoel'
    ],
    rightToe: [
      'righttoebase', 'rtoebase', 'toebaser', 'righttoe', 'rtoe', 'toer', 'righttoe0', 'rtoe0',
      'mixamorigrighttoebase', 'bip01rtoe0', 'bip001rtoe0', 'ccbasertoebase', 'jbiprtoebase',
      'valvebipedbip01rtoe0', 'deftoer'
    ]
  };

  function canonicalizeBoneToken(rawName) {
    if (!rawName) return { fullToken: '', shortToken: '', strippedToken: '' };
    const basePart = String(rawName).split('|').pop();
    const afterColon = basePart.includes(':') ? basePart.split(':').pop() : basePart;
    const stripped = afterColon
      .replace(
        /^(mixamorig:?|def[-_.]|org[-_.]|mch[-_.]|bip00?1[-_.\s]*|cc_base_[-_.]*|valvebiped\.bip01_|j_bip_[clr]_|character1_)/i,
        ''
      )
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    return {
      fullToken: basePart.toLowerCase().replace(/[^a-z0-9]/g, ''),
      shortToken: afterColon.toLowerCase().replace(/[^a-z0-9]/g, ''),
      strippedToken: stripped
    };
  }

  function SmartSkeletonTopologyMatcher(fbxRoot) {
    const discovered = {
      hips: null,
      spine: null,
      upperBody: null,
      chest: null,
      neck: null,
      head: null,
      rightShoulder: null,
      rightArm: null,
      rightElbow: null,
      rightWrist: null,
      leftShoulder: null,
      leftArm: null,
      leftElbow: null,
      leftWrist: null,
      rightLeg: null,
      rightKnee: null,
      rightFoot: null,
      rightToe: null,
      leftLeg: null,
      leftKnee: null,
      leftFoot: null,
      leftToe: null,
      fingers: [],
      allBones: []
    };

    const boneSet = new Set();
    const animatedNodeSet = new Set();

    if (fbxRoot.animations && fbxRoot.animations[0]) {
      const clip = fbxRoot.animations[0];
      clip.tracks.forEach((track) => {
        const dotIdx = track.name.lastIndexOf('.');
        const nodeName = dotIdx > 0 ? track.name.slice(0, dotIdx) : track.name;
        const found = fbxRoot.getObjectByName(nodeName);
        if (found && found !== fbxRoot) {
          boneSet.add(found);
          animatedNodeSet.add(found);
        }
      });
    }

    fbxRoot.traverse((node) => {
      if (node.isBone || node.type === 'Bone') {
        boneSet.add(node);
      }
      if (node.isSkinnedMesh && node.skeleton && Array.isArray(node.skeleton.bones)) {
        node.skeleton.bones.forEach((b) => {
          if (b) boneSet.add(b);
        });
      }
    });

    // Sort so animated bones are prioritized over static helper duplicates
    const allNodes = Array.from(boneSet).sort((a, b) => {
      const aAnim = animatedNodeSet.has(a) ? 1 : 0;
      const bAnim = animatedNodeSet.has(b) ? 1 : 0;
      return bAnim - aAnim;
    });
    discovered.allBones = allNodes;

    // ------------------------------------------------------------------------
    // TIER 1: MULTI-STANDARD FUZZY KEYWORD MATCHING
    // ------------------------------------------------------------------------
    const dictKeys = Object.keys(BONE_MAPPING_DICTIONARY);
    allNodes.forEach((node) => {
      if (!node || !node.name) return;
      const n = node.name;
      if (
        /(twist|roll|aux|adj|fix|helper|ik|target|pole|nub|_end|sharebone|pelvisoffset|rib|breast|bust)/i.test(
          n
        ) &&
        !/(necktwist0?1)/i.test(n)
      ) {
        return;
      }
      const { fullToken, shortToken, strippedToken } = canonicalizeBoneToken(n);
      for (let k = 0; k < dictKeys.length; k++) {
        const slotKey = dictKeys[k];
        if (discovered[slotKey]) continue;
        const aliases = BONE_MAPPING_DICTIONARY[slotKey];
        if (
          aliases.includes(fullToken) ||
          aliases.includes(shortToken) ||
          aliases.includes(strippedToken)
        ) {
          discovered[slotKey] = node;
          break;
        }
      }
    });

    const isRightSideName = (n) =>
      /(^r[_\s.-]|_r$|\.r$|-r$|_r_|[_\s.-]r[_\s.-]|cc_base_r_|j_bip_r_|bip01[_\s-]*r[_\s-]|bip001[_\s-]*r[_\s-]|\bright|mixamorig:?right|右)/i.test(
        n
      );
    const isLeftSideName = (n) =>
      /(^l[_\s.-]|_l$|\.l$|-l$|_l_|[_\s.-]l[_\s.-]|cc_base_l_|j_bip_l_|bip01[_\s-]*l[_\s-]|bip001[_\s-]*l[_\s-]|\bleft|mixamorig:?left|左)/i.test(
        n
      );

    allNodes.forEach((node) => {
      if (!node || !node.name) return;
      const n = node.name;
      if (
        /(twist|roll|aux|adj|fix|helper|ik|target|pole|nub|_end|sharebone|pelvisoffset|rib|breast|bust)/i.test(
          n
        )
      ) {
        return;
      }

      if (
        !discovered.hips &&
        /(cc_base_hip|cc_base_pelvis|j_bip_c_hips|\bhips?\b|\bpelvis\b|bip00?1[_\s-]*pelvis|mixamorig:?hips)/i.test(
          n
        ) &&
        !/(waist|spine|thigh|leg)/i.test(n)
      ) {
        discovered.hips = node;
        return;
      }

      if (
        !discovered.spine &&
        /(cc_base_waist|j_bip_c_spine|\bwaist\b|\bspine\b|bip00?1[_\s-]*spine$|mixamorig:?spine$)/i.test(
          n
        ) &&
        !/(spine[_\s.-]*0?[123]|spine1|spine2|spine3)/i.test(n)
      ) {
        discovered.spine = node;
        return;
      }
      if (
        !discovered.upperBody &&
        /(cc_base_spine01|j_bip_c_chest|spine[_\s.-]*0?1|spine1|bip00?1[_\s-]*spine1|mixamorig:?spine1)/i.test(
          n
        )
      ) {
        discovered.upperBody = node;
        return;
      }
      if (
        !discovered.chest &&
        /(cc_base_spine02|j_bip_c_upperchest|upper[_\s.-]*chest|\bchest\b|spine[_\s.-]*0?[23]|spine2|spine3|bip00?1[_\s-]*spine2|mixamorig:?spine2)/i.test(
          n
        )
      ) {
        discovered.chest = node;
        return;
      }

      if (
        !discovered.neck &&
        /(cc_base_neck|j_bip_c_neck|\bneck\b|bip00?1[_\s-]*neck|mixamorig:?neck)/i.test(n)
      ) {
        discovered.neck = node;
        return;
      }
      if (
        !discovered.head &&
        /(cc_base_head|j_bip_c_head|\bhead\b|bip00?1[_\s-]*head|mixamorig:?head)/i.test(n) &&
        !/(top|end|nub|jaw|eye|ear|hair|facial)/i.test(n)
      ) {
        discovered.head = node;
        return;
      }

      if (/(clavicle|shoulder|collar)/i.test(n)) {
        if (!discovered.rightShoulder && isRightSideName(n)) {
          discovered.rightShoulder = node;
          return;
        }
        if (!discovered.leftShoulder && isLeftSideName(n)) {
          discovered.leftShoulder = node;
          return;
        }
      }

      if (
        /(upper[_\s.-]*arm|up[_\s.-]*arm|\barm\b|leftarm|rightarm)/i.test(n) &&
        !/(fore|low|lower|hand|wrist|finger|thumb|clavicle|shoulder|collar)/i.test(n)
      ) {
        if (!discovered.rightArm && isRightSideName(n)) {
          discovered.rightArm = node;
          return;
        }
        if (!discovered.leftArm && isLeftSideName(n)) {
          discovered.leftArm = node;
          return;
        }
      }

      if (/(fore[_\s.-]*arm|low[_\s.-]*arm|lower[_\s.-]*arm|elbow)/i.test(n)) {
        if (!discovered.rightElbow && isRightSideName(n)) {
          discovered.rightElbow = node;
          return;
        }
        if (!discovered.leftElbow && isLeftSideName(n)) {
          discovered.leftElbow = node;
          return;
        }
      }

      if (
        /(\bhand\b|\bwrist\b|lefthand$|righthand$|_l_hand$|_r_hand$)/i.test(n) &&
        !/(finger|thumb|index|middle|mid|ring|pinky|little)/i.test(n)
      ) {
        if (!discovered.rightWrist && isRightSideName(n)) {
          discovered.rightWrist = node;
          return;
        }
        if (!discovered.leftWrist && isLeftSideName(n)) {
          discovered.leftWrist = node;
          return;
        }
      }

      if (/(thumb|index|middle|\bmid|ring|pinky|little|finger[0-4])/i.test(n)) {
        const isRight = isRightSideName(n);
        const isLeft = isLeftSideName(n);
        if (!isRight && !isLeft) return;

        let fingerOrder = -1;
        if (/(thumb|finger0)/i.test(n)) fingerOrder = 0;
        else if (/(index|finger1)/i.test(n)) fingerOrder = 1;
        else if (/(middle|\bmid|finger2)/i.test(n)) fingerOrder = 2;
        else if (/(ring|finger3)/i.test(n)) fingerOrder = 3;
        else if (/(pinky|little|finger4)/i.test(n)) fingerOrder = 4;

        let jointDepth = 1;
        if (/(02|12|22|32|42|_2|\.2|2$|intermediate)/i.test(n)) jointDepth = 2;
        else if (/(03|13|23|33|43|_3|\.3|3$|distal)/i.test(n)) jointDepth = 3;
        else if (/(04|14|24|34|44|_4|\.4|4$|end|tip)/i.test(n)) return;

        if (fingerOrder >= 0) {
          discovered.fingers.push({
            bone: node,
            isRightSide: isRight,
            fingerOrder,
            jointDepth
          });
        }
        return;
      }

      if (
        /(thigh|up[_\s.-]*leg|upper[_\s.-]*leg|leftupleg|rightupleg)/i.test(n) &&
        !/(calf|shin|knee|low|foot|ankle|toe)/i.test(n)
      ) {
        if (!discovered.rightLeg && isRightSideName(n)) {
          discovered.rightLeg = node;
          return;
        }
        if (!discovered.leftLeg && isLeftSideName(n)) {
          discovered.leftLeg = node;
          return;
        }
      }

      if (
        /(calf|shin|low[_\s.-]*leg|lower[_\s.-]*leg|knee|leftleg$|rightleg$)/i.test(n) &&
        !/(up|thigh|foot|ankle|toe)/i.test(n)
      ) {
        if (!discovered.rightKnee && isRightSideName(n)) {
          discovered.rightKnee = node;
          return;
        }
        if (!discovered.leftKnee && isLeftSideName(n)) {
          discovered.leftKnee = node;
          return;
        }
      }

      if (
        /(\bfoot\b|\bankle\b|leftfoot$|rightfoot$|_l_foot$|_r_foot$)/i.test(n) &&
        !/(toe)/i.test(n)
      ) {
        if (!discovered.rightFoot && isRightSideName(n)) {
          discovered.rightFoot = node;
          return;
        }
        if (!discovered.leftFoot && isLeftSideName(n)) {
          discovered.leftFoot = node;
          return;
        }
      }

      if (/(toe)/i.test(n) && !/(end|nub|02|2$)/i.test(n)) {
        if (!discovered.rightToe && isRightSideName(n)) {
          discovered.rightToe = node;
          return;
        }
        if (!discovered.leftToe && isLeftSideName(n)) {
          discovered.leftToe = node;
          return;
        }
      }
    });

    // ------------------------------------------------------------------------
    // TIER 2: TOPOLOGICAL GRAPH FALLBACK (Anatomy Hierarchy & Geometry Resolver)
    // ------------------------------------------------------------------------
    fbxRoot.updateMatrixWorld(true);
    const wp = new THREE.Vector3();

    const getBoneChildren = (parentNode) => {
      if (!parentNode || !parentNode.children) return [];
      return parentNode.children.filter(
        (c) =>
          (c.isBone || c.type === 'Bone' || boneSet.has(c)) &&
          !/(twist|roll|aux|adj|fix|helper|ik|target|pole|nub|_end|skirt|dress|hair|cape|ribbon)/i.test(
            c.name || ''
          )
      );
    };

    // 1. If Hips is missing, find the root branching bone with >= 3 major branches (Spine + 2 Legs)
    if (!discovered.hips) {
      let bestHips = null;
      let bestScore = -Infinity;
      for (let i = 0; i < allNodes.length; i++) {
        const b = allNodes[i];
        const ch = getBoneChildren(b);
        if (ch.length >= 3) {
          let descCount = 0;
          b.traverse((sub) => {
            if (boneSet.has(sub)) descCount++;
          });
          if (descCount > bestScore) {
            bestScore = descCount;
            bestHips = b;
          }
        }
      }
      if (bestHips) {
        discovered.hips = bestHips;
      } else if (allNodes.length > 0) {
        discovered.hips = allNodes[0];
      }
    }

    // 2. From Hips, resolve Spine chain (ascending +Y) and Left/Right Leg chains (descending -Y)
    if (discovered.hips) {
      const hipsPos = new THREE.Vector3();
      discovered.hips.getWorldPosition(hipsPos);
      const hipBranches = getBoneChildren(discovered.hips);

      if (hipBranches.length >= 3) {
        const branchInfos = hipBranches.map((br) => {
          const brPos = new THREE.Vector3();
          const tipPos = new THREE.Vector3();
          br.getWorldPosition(brPos);
          let curr = br;
          let depth = 0;
          while (depth < 4) {
            const nextCh = getBoneChildren(curr);
            if (nextCh.length === 0) break;
            curr = nextCh[0];
            depth++;
          }
          curr.getWorldPosition(tipPos);
          return {
            bone: br,
            dy: tipPos.y - hipsPos.y,
            dx: (brPos.x + tipPos.x) * 0.5 - hipsPos.x
          };
        });

        branchInfos.sort((a, b) => b.dy - a.dy);
        if (!discovered.spine && branchInfos[0] && branchInfos[0].dy > 0) {
          discovered.spine = branchInfos[0].bone;
        }
        const legCandidates = branchInfos.slice(1).filter((bi) => bi.dy <= 0.1);
        if (legCandidates.length >= 2) {
          legCandidates.sort((a, b) => a.dx - b.dx); // smaller X = Right, larger X = Left
          if (!discovered.rightLeg) discovered.rightLeg = legCandidates[0].bone;
          if (!discovered.leftLeg) discovered.leftLeg = legCandidates[legCandidates.length - 1].bone;
        }
      }
    }

    // 3. Walk up the Spine chain to find UpperBody, Chest (branching hub with 3 branches: Neck + 2 Arms), Neck, and Head
    if (discovered.spine && (!discovered.chest || !discovered.leftArm || !discovered.rightArm)) {
      let curr = discovered.spine;
      for (let step = 0; step < 5 && curr; step++) {
        const ch = getBoneChildren(curr);
        if (ch.length >= 3) {
          if (!discovered.chest) discovered.chest = curr;
          const chestPos = new THREE.Vector3();
          curr.getWorldPosition(chestPos);
          const armAndNeck = ch.map((br) => {
            const p = new THREE.Vector3();
            br.getWorldPosition(p);
            return { bone: br, dy: p.y - chestPos.y, dx: p.x - chestPos.x };
          });
          armAndNeck.sort((a, b) => b.dy - a.dy);
          if (!discovered.neck && armAndNeck[0]) {
            discovered.neck = armAndNeck[0].bone;
          }
          const sideBranches = armAndNeck.slice(1);
          if (sideBranches.length >= 2) {
            sideBranches.sort((a, b) => a.dx - b.dx);
            const rStart = sideBranches[0].bone;
            const lStart = sideBranches[sideBranches.length - 1].bone;
            const rNext = getBoneChildren(rStart);
            const lNext = getBoneChildren(lStart);
            if (!discovered.rightShoulder && rNext.length > 0 && getBoneChildren(rNext[0]).length > 0) {
              discovered.rightShoulder = rStart;
              if (!discovered.rightArm) discovered.rightArm = rNext[0];
            } else if (!discovered.rightArm) {
              discovered.rightArm = rStart;
            }
            if (!discovered.leftShoulder && lNext.length > 0 && getBoneChildren(lNext[0]).length > 0) {
              discovered.leftShoulder = lStart;
              if (!discovered.leftArm) discovered.leftArm = lNext[0];
            } else if (!discovered.leftArm) {
              discovered.leftArm = lStart;
            }
          }
          break;
        } else if (ch.length === 1) {
          if (curr === discovered.spine && !discovered.upperBody) {
            discovered.upperBody = ch[0];
          } else if (!discovered.chest) {
            discovered.chest = ch[0];
          }
          curr = ch[0];
        } else {
          break;
        }
      }
    }

    // 4. Complete sequential limb chains via parent->child hierarchy links
    if (!discovered.neck) {
      allNodes.forEach((node) => {
        if (!discovered.neck && node?.name && /(necktwist0?1|neck)/i.test(node.name)) {
          discovered.neck = node;
        }
      });
    }
    if (discovered.neck && !discovered.head) {
      discovered.head = getPrimaryChildBone(discovered.neck);
    }
    if (discovered.rightShoulder && !discovered.rightArm) {
      discovered.rightArm = getPrimaryChildBone(discovered.rightShoulder);
    }
    if (discovered.leftShoulder && !discovered.leftArm) {
      discovered.leftArm = getPrimaryChildBone(discovered.leftShoulder);
    }
    if (discovered.rightArm && !discovered.rightElbow) {
      discovered.rightElbow = getPrimaryChildBone(discovered.rightArm);
    }
    if (discovered.rightElbow && !discovered.rightWrist) {
      discovered.rightWrist = getPrimaryChildBone(discovered.rightElbow);
    }
    if (discovered.leftArm && !discovered.leftElbow) {
      discovered.leftElbow = getPrimaryChildBone(discovered.leftArm);
    }
    if (discovered.leftElbow && !discovered.leftWrist) {
      discovered.leftWrist = getPrimaryChildBone(discovered.leftElbow);
    }
    if (discovered.rightLeg && !discovered.rightKnee) {
      discovered.rightKnee = getPrimaryChildBone(discovered.rightLeg);
    }
    if (discovered.rightKnee && !discovered.rightFoot) {
      discovered.rightFoot = getPrimaryChildBone(discovered.rightKnee);
    }
    if (discovered.rightFoot && !discovered.rightToe) {
      discovered.rightToe = getPrimaryChildBone(discovered.rightFoot);
    }
    if (discovered.leftLeg && !discovered.leftKnee) {
      discovered.leftKnee = getPrimaryChildBone(discovered.leftLeg);
    }
    if (discovered.leftKnee && !discovered.leftFoot) {
      discovered.leftFoot = getPrimaryChildBone(discovered.leftKnee);
    }
    if (discovered.leftFoot && !discovered.leftToe) {
      discovered.leftToe = getPrimaryChildBone(discovered.leftFoot);
    }

    return discovered;
  }

  function discoverFBXSourceBones(fbxRoot) {
    return SmartSkeletonTopologyMatcher(fbxRoot);
  }

  /**
   * ==========================================================================
   * UPDATE V39 SECTION 2: MIXAMO-TO-CHIBI PROPORTION-AWARE DELTA RETARGETER
   * (`MixamoChibiSmartRetargeter`: `buildSlotRestPoseDeltaRetargetTable` & `solveRestPoseDeltaBoneQuat`)
   * - Captures Reference Rest Pose ($Q_{\text{src, rest}}^{\text{world}}$, $q_{\text{src, rest}}^{\text{local}}$)
   *   and Nahida's Rest Pose ($Q_{\text{tgt, rest}}^{\text{world}}$, $q_{\text{tgt, rest}}^{\text{local}}$).
   * - At each time $t$, extracts pure relative rotation delta:
   *   $$\Delta q_b(t) = \left(q_{b,\text{src}}^{\text{rest}}\right)^{-1} \cdot q_{b,\text{src}}(t)$$
   * - Transforms rotation axis into Nahida's bone frame via $M_{\text{axis}} = \left(Q_{\text{tgt, rest}}^{\text{world}}\right)^{-1} Q_{\text{src, rest}}^{\text{world}}$,
   *   and applies Chibi Anatomical Scaling (`CHIBI_LIMB_DAMPING_CONFIG`) so `Yawn.fbx` and `Blow A Kiss.fbx`
   *   look naturally proportioned without hands clipping into Nahida's larger chibi head or skirt:
   *   + `LeftShoulder`, `RightShoulder`, `LeftArm`, `RightArm`: `0.88x` (12% adduction reduction)
   *     + `+7°` (`0.122 rad`) forward anti-clipping pitch compensation when raising hands to mouth!
   *   + `ForeArm`, `Hand`: `0.92x`
   *   + `Spine`, `Spine1` (`UpperBody`), `Spine2` (`Chest`), `Neck`, `Head`: `0.75x`
   *   + `UpLeg`, `Leg`, `Foot`, `ToeBase`: `0.80x`
   *   + All 30 Finger phalanges (`Thumb1..3`, `Index1..3`, `Middle1..3`, `Ring1..3`, `Pinky1..3`): `0.92x`
   * ==========================================================================
   */
  const CHIBI_LIMB_DAMPING_CONFIG = {
    hips: { factor: 0.55, maxRad: 0.20 },
    spine: { factor: 0.75, maxRad: 0.34 },
    upperBody: { factor: 0.75, maxRad: 0.32 },
    chest: { factor: 0.75, maxRad: 0.36 },
    neck: { factor: 0.75, maxRad: 0.38 },
    head: { factor: 0.75, maxRad: 0.42 },
    leftShoulder: { factor: 0.88, maxRad: 0.38 },
    rightShoulder: { factor: 0.88, maxRad: 0.38 },
    leftArm: { factor: 0.88, maxRad: 1.35 },
    rightArm: { factor: 0.88, maxRad: 1.35 },
    leftElbow: { factor: 0.92, maxRad: 1.65 },
    rightElbow: { factor: 0.92, maxRad: 1.65 },
    leftWrist: { factor: 0.92, maxRad: 0.85 },
    rightWrist: { factor: 0.92, maxRad: 0.85 },
    leftLeg: { factor: 0.80, maxRad: 0.46 },
    rightLeg: { factor: 0.80, maxRad: 0.46 },
    leftKnee: { factor: 0.80, maxRad: 0.48 },
    rightKnee: { factor: 0.80, maxRad: 0.48 },
    leftFoot: { factor: 0.80, maxRad: 0.38 },
    rightFoot: { factor: 0.80, maxRad: 0.38 },
    leftToe: { factor: 0.80, maxRad: 0.28 },
    rightToe: { factor: 0.80, maxRad: 0.28 }
  };

  function buildSlotRestPoseDeltaRetargetTable(slot) {
    if (!slot || !slot.srcBones || !loadedModel) return;
    slot.restPoseDeltaMap.clear();
    slot.fingerDeltaList = [];

    const src = slot.srcBones;
    const keys = Object.keys(CHIBI_LIMB_DAMPING_CONFIG);

    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const srcBone = src[k];
      const tgtEntry = riggedBones[k];
      if (!srcBone || !tgtEntry || !tgtEntry.bone || !tgtEntry.relaxedQuat) continue;

      const srcRestLocalQuat = srcBone.quaternion.clone();
      const srcRestWorldQuat = new THREE.Quaternion();
      srcBone.getWorldQuaternion(srcRestWorldQuat);

      const tgtBone = tgtEntry.bone;
      const tgtRestLocalQuat = tgtEntry.relaxedQuat.clone();
      const tgtRestWorldQuat = new THREE.Quaternion();
      tgtBone.getWorldQuaternion(tgtRestWorldQuat);

      const srcRestLocalQuatInv = srcRestLocalQuat.clone().invert();
      const axisMapQuat = tgtRestWorldQuat.clone().invert().multiply(srcRestWorldQuat).normalize();
      const axisMapQuatInv = axisMapQuat.clone().invert();

      const cfg = CHIBI_LIMB_DAMPING_CONFIG[k];
      const isBlowAKissLeftArmBone =
        slot.id === 'blow_a_kiss_motion' &&
        (k === 'leftShoulder' || k === 'leftArm' || k === 'leftElbow' || k === 'leftWrist');
      const slotFactor = isBlowAKissLeftArmBone
        ? k === 'leftShoulder' || k === 'leftArm'
          ? 1.28
          : 1.0
        : cfg.factor;
      const slotMaxRad = isBlowAKissLeftArmBone ? Math.max(cfg.maxRad, 2.25) : cfg.maxRad;

      slot.restPoseDeltaMap.set(k, {
        srcBone,
        tgtBone,
        srcRestLocalQuat,
        srcRestLocalQuatInv,
        srcRestWorldQuat,
        tgtRestLocalQuat,
        tgtRestWorldQuat,
        axisMapQuat,
        axisMapQuatInv,
        limbDampingFactor: slotFactor,
        maxAngleRad: slotMaxRad
      });
    }

    // Map all 30 Mixamo Finger Bones (`LeftHandThumb1..3`, `LeftHandIndex1..3`, ..., `RightHandPinky1..3`)
    // 1-to-1 onto Nahida's `riggedBones.fingerBones` so Yawn & Blow A Kiss spread/curl fingers naturally!
    if (Array.isArray(src.fingers) && Array.isArray(riggedBones.fingerBones)) {
      for (let i = 0; i < riggedBones.fingerBones.length; i++) {
        const tgtFb = riggedBones.fingerBones[i];
        if (!tgtFb || !tgtFb.bone || !tgtFb.restQuat) continue;

        const matchSrc = src.fingers.find(
          (sf) =>
            sf &&
            sf.bone &&
            sf.isRightSide === tgtFb.isRightSide &&
            sf.fingerOrder === tgtFb.fingerOrder &&
            sf.jointDepth === tgtFb.jointDepth
        );
        if (!matchSrc || !matchSrc.bone) continue;

        const srcFingerBone = matchSrc.bone;
        const srcRestLocalQuat = srcFingerBone.quaternion.clone();
        const srcRestWorldQuat = new THREE.Quaternion();
        srcFingerBone.getWorldQuaternion(srcRestWorldQuat);

        const tgtFingerBone = tgtFb.bone;
        const tgtRestWorldQuat = new THREE.Quaternion();
        tgtFingerBone.getWorldQuaternion(tgtRestWorldQuat);

        const srcRestLocalQuatInv = srcRestLocalQuat.clone().invert();
        const axisMapQuat = tgtRestWorldQuat
          .clone()
          .invert()
          .multiply(srcRestWorldQuat)
          .normalize();
        const axisMapQuatInv = axisMapQuat.clone().invert();

        slot.fingerDeltaList.push({
          srcBone: srcFingerBone,
          tgtFingerEntry: tgtFb,
          srcRestLocalQuatInv,
          axisMapQuat,
          axisMapQuatInv,
          limbDampingFactor: 0.90,
          maxAngleRad: 1.05
        });
      }
    }
  }

  const _deltaLocalQ = new THREE.Quaternion();
  const _deltaInTgtQ = new THREE.Quaternion();
  const _deltaAdaptedQ = new THREE.Quaternion();
  const _deltaAxisVec = new THREE.Vector3(0, 1, 0);

  function solveRestPoseDeltaBoneQuat(slot, boneKey, outLocalQuat) {
    if (!slot || !slot.restPoseDeltaMap) return false;
    const info = slot.restPoseDeltaMap.get(boneKey);
    if (!info || !info.srcBone || !info.tgtBone) return false;

    const qAnim = info.srcBone.quaternion;
    if (!isFiniteQuaternion(qAnim)) {
      outLocalQuat.copy(info.tgtRestLocalQuat);
      return false;
    }

    // 1. Pure relative rotation delta in Source Bone local space:
    //    delta_q_local(t) = (q_src_rest_local)^(-1) * q_src_anim_local(t)
    _deltaLocalQ.multiplyQuaternions(info.srcRestLocalQuatInv, qAnim).normalize();
    if (_deltaLocalQ.w < 0) {
      _deltaLocalQ.set(-_deltaLocalQ.x, -_deltaLocalQ.y, -_deltaLocalQ.z, -_deltaLocalQ.w);
    }

    // 2. Transform rotation axis into Nahida's Bone local coordinate frame via M_axis:
    //    delta_q_inTgt(t) = M_axis * delta_q_local(t) * (M_axis)^(-1)
    _deltaInTgtQ
      .multiplyQuaternions(info.axisMapQuat, _deltaLocalQ)
      .multiply(info.axisMapQuatInv)
      .normalize();
    if (_deltaInTgtQ.w < 0) {
      _deltaInTgtQ.set(-_deltaInTgtQ.x, -_deltaInTgtQ.y, -_deltaInTgtQ.z, -_deltaInTgtQ.w);
    }

    // 3. Chibi Proportion Damping & Anti-Clipping Clamp (`limbDampingFactor`):
    const clampedW = THREE.MathUtils.clamp(_deltaInTgtQ.w, -1.0, 1.0);
    const rawTheta = 2.0 * Math.acos(clampedW);
    const sinHalf = Math.hypot(_deltaInTgtQ.x, _deltaInTgtQ.y, _deltaInTgtQ.z);

    if (rawTheta < 1e-5 || sinHalf < 1e-6) {
      _deltaAdaptedQ.set(0, 0, 0, 1);
    } else {
      _deltaAxisVec.set(
        _deltaInTgtQ.x / sinHalf,
        _deltaInTgtQ.y / sinHalf,
        _deltaInTgtQ.z / sinHalf
      );
      const adaptedTheta = THREE.MathUtils.clamp(
        rawTheta * info.limbDampingFactor,
        0.0,
        info.maxAngleRad
      );
      _deltaAdaptedQ.setFromAxisAngle(_deltaAxisVec, adaptedTheta);
    }

    // 4. Multiply onto Nahida's standard Rest Pose local quaternion:
    //    q_nahida_local(t) = q_tgt_rest_local * delta_q_adapted(t)
    outLocalQuat.multiplyQuaternions(info.tgtRestLocalQuat, _deltaAdaptedQ).normalize();
    if (!isFiniteQuaternion(outLocalQuat)) {
      outLocalQuat.copy(info.tgtRestLocalQuat);
      return false;
    }
    return true;
  }

  function applyMixamoChibiFingerRetargeting(slot, blendWeight) {
    if (
      !slot ||
      !slot.isMixamoChibi ||
      !Array.isArray(slot.fingerDeltaList) ||
      slot.fingerDeltaList.length === 0 ||
      blendWeight <= 0.0001
    ) {
      return;
    }

    const w = THREE.MathUtils.clamp(blendWeight, 0, 1);
    for (let i = 0; i < slot.fingerDeltaList.length; i++) {
      const item = slot.fingerDeltaList[i];
      const srcBone = item.srcBone;
      const tgtFb = item.tgtFingerEntry;
      if (!srcBone || !tgtFb || !tgtFb.bone || !isFiniteQuaternion(srcBone.quaternion)) {
        continue;
      }

      _deltaLocalQ.multiplyQuaternions(item.srcRestLocalQuatInv, srcBone.quaternion).normalize();
      if (_deltaLocalQ.w < 0) {
        _deltaLocalQ.set(-_deltaLocalQ.x, -_deltaLocalQ.y, -_deltaLocalQ.z, -_deltaLocalQ.w);
      }

      _deltaInTgtQ
        .multiplyQuaternions(item.axisMapQuat, _deltaLocalQ)
        .multiply(item.axisMapQuatInv)
        .normalize();
      if (_deltaInTgtQ.w < 0) {
        _deltaInTgtQ.set(-_deltaInTgtQ.x, -_deltaInTgtQ.y, -_deltaInTgtQ.z, -_deltaInTgtQ.w);
      }

      const clampedW = THREE.MathUtils.clamp(_deltaInTgtQ.w, -1.0, 1.0);
      const rawTheta = 2.0 * Math.acos(clampedW);
      const sinHalf = Math.hypot(_deltaInTgtQ.x, _deltaInTgtQ.y, _deltaInTgtQ.z);

      if (rawTheta < 1e-4 || sinHalf < 1e-6) {
        continue;
      }

      _deltaAxisVec.set(
        _deltaInTgtQ.x / sinHalf,
        _deltaInTgtQ.y / sinHalf,
        _deltaInTgtQ.z / sinHalf
      );
      const adaptedTheta = THREE.MathUtils.clamp(
        rawTheta * item.limbDampingFactor,
        0.0,
        item.maxAngleRad
      );
      _deltaAdaptedQ.setFromAxisAngle(_deltaAxisVec, adaptedTheta);

      // Blend from Pass 1's natural stair-step finger pose into the Mixamo finger pose
      _alignPass1LocalQuat.copy(tgtFb.bone.quaternion);
      _alignSolvedLocalQuat.multiplyQuaternions(tgtFb.restQuat, _deltaAdaptedQ).normalize();
      ensureShortestPathQuat(_alignPass1LocalQuat, _alignSolvedLocalQuat);
      tgtFb.bone.quaternion.copy(_alignPass1LocalQuat).slerp(_alignSolvedLocalQuat, w);
    }
  }

  const MixamoChibiSmartRetargeter = {
    buildSlotRestPoseDeltaRetargetTable,
    solveRestPoseDeltaBoneQuat,
    applyMixamoChibiFingerRetargeting
  };
  window.MixamoChibiSmartRetargeter = MixamoChibiSmartRetargeter;

  /**
   * UPDATE V41 SECTION 1 & 2:
   * Evaluates and applies a single FBX motion slot (`motion1`, `motion2`, or `motion3`)
   * onto Nahida's skeleton at clip time `evalClipTime` (`mwWeight` in `[0, 1]`).
   * - Used both during real-time `update()` playback AND during offline pre-computation
   *   of `StartPose(A_i)` ($t = t_{\text{start}}$) and `EndPose(A_i)` ($t = T_{\text{end}}$)
   *   so the `Look-Ahead Pose-to-Pose Bridge` matches Frame 0 of $A_{i+1}$ with zero error!
   * - Includes Update V41 Section 2 (`Horizontal Mouth-to-Forward Kiss Projection`) for
   *   `Blow A Kiss.fbx` so the left hand rises to the mouth ($p \in [0, 0.36]$), pushes
   *   horizontally straight forward from the mouth without rising to the eyes ($p \in [0.36, 0.72]$),
   *   and lowers gracefully ($p \in [0.72, 1.0]$).
   */
  const _slotEvalDirChar = new THREE.Vector3();
  const _slotEvalDirWorld = new THREE.Vector3();
  const _slotEvalThighChar = new THREE.Vector3();
  const _slotEvalArmChar = new THREE.Vector3();
  const _slotEvalDownAxis = new THREE.Vector3(0, -1, 0);
  const _slotEvalDeltaQuat = new THREE.Quaternion();
  const _slotEvalPivotQuat = new THREE.Quaternion();

  function sampleSlotHipsBounceCurveAtTime(slot, evalTime, outDelta) {
    outDelta.set(0, 0, 0);
    if (!slot) return outDelta;

    const curve = slot.hipsBounceCurve;
    if (curve && curve.times && curve.times.length >= 2) {
      const times = curve.times;
      const vals = curve.values;
      const n = times.length;
      const t = THREE.MathUtils.clamp(evalTime, times[0], times[n - 1]);
      let lo = 0;
      let hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= t) lo = mid;
        else hi = mid;
      }
      const span = Math.max(1e-6, times[hi] - times[lo]);
      const alpha = THREE.MathUtils.clamp((t - times[lo]) / span, 0, 1);
      const i0 = lo * 3;
      const i1 = hi * 3;
      const p0 = curve.p0 || [vals[0], vals[1], vals[2]];
      const rawDx = THREE.MathUtils.lerp(vals[i0], vals[i1], alpha) - p0[0];
      const rawDy = THREE.MathUtils.lerp(vals[i0 + 1], vals[i1 + 1], alpha) - p0[1];
      const rawDz = THREE.MathUtils.lerp(vals[i0 + 2], vals[i1 + 2], alpha) - p0[2];

      const unitScale = slot.isMixamoChibi
        ? 0.0085
        : Math.min(0.45, slot.hipScaleRatio || 0.0085);
      const dx = Number.isFinite(rawDx) ? rawDx * unitScale : 0;
      const dy = Number.isFinite(rawDy) ? rawDy * unitScale : 0;
      const dz = Number.isFinite(rawDz) ? rawDz * unitScale : 0;

      outDelta.x = THREE.MathUtils.clamp(dx, -0.03, 0.03);
      outDelta.y = THREE.MathUtils.clamp(dy, -0.04, 0.04);
      outDelta.z = THREE.MathUtils.clamp(dz, -0.03, 0.03);
    }
    return outDelta;
  }

  function evaluateAndApplySlotPoseToNahida(slot, evalClipTime, mwWeight = 1.0, options = {}) {
    if (!slot || !slot.isReady || !slot.fbxRoot || !slot.sourceMixer || !loadedModel) {
      return;
    }

    const effectiveMw = THREE.MathUtils.clamp(mwWeight, 0.0, 1.0);
    if (effectiveMw <= 0.0001) return;

    const isOfflineBake = Boolean(options.isOfflineBake);
    const drag = options.drag || 0.0;
    const antic = options.antic || 0.0;
    const hipWeightShift = options.hipWeightShift || 0.0;
    const idleWeight = options.idleWeight !== undefined ? options.idleWeight : 1.0;
    const headYaw = options.headYaw || 0.0;
    const headPitch = options.headPitch || 0.0;
    const headRoll = options.headRoll || 0.0;
    const lFlareSignZ = -solvedSigns.leftArmAdductZ;

    // 1. Evaluate FBX AnimationMixer at `evalClipTime` with canonical upright root (`Z-up -> Y-up`)
    const clampedTime = THREE.MathUtils.clamp(
      evalClipTime,
      slot.clipStartTime,
      slot.clipDuration
    );
    const fbxRoot = slot.fbxRoot;
    fbxRoot.position.set(0, 0, 0);
    fbxRoot.scale.set(1, 1, 1);
    fbxRoot.quaternion.copy(slot.canonicalRootQuat);
    slot.sourceMixer.setTime(clampedTime);
    fbxRoot.position.set(0, 0, 0);
    fbxRoot.scale.set(1, 1, 1);
    fbxRoot.quaternion.copy(slot.canonicalRootQuat);
    fbxRoot.traverse((node) => {
      if (node !== fbxRoot && node.userData && node.userData.__fbxBindPos) {
        node.position.copy(node.userData.__fbxBindPos);
        node.scale.set(1, 1, 1);
      }
    });
    fbxRoot.updateMatrixWorld(true);

    const getSlotBoneDir = (boneStart, boneEnd, outDir) => {
      if (!boneStart || !boneEnd) {
        outDir.set(0, 1, 0);
        return false;
      }
      boneStart.getWorldPosition(_alignSrcStart);
      boneEnd.getWorldPosition(_alignSrcEnd);
      outDir.subVectors(_alignSrcEnd, _alignSrcStart);
      if (outDir.lengthSq() < 1e-6) {
        outDir.set(0, 1, 0);
        return false;
      }
      outDir.normalize();
      return true;
    };

    characterPivot.updateMatrixWorld(true);
    characterPivot.getWorldQuaternion(_slotEvalPivotQuat);

    const applyBoneTargetQuat = (bone, targetQuat) => {
      if (!bone || !isFiniteQuaternion(targetQuat)) return;
      if (isOfflineBake) {
        bone.quaternion.copy(targetQuat);
        bone.updateMatrixWorld(true);
      } else {
        applyHighFpsTemporalBoneSlerp(bone, targetQuat, currentFrameDt);
      }
    };

    const alignBoneToWorldDir = (targetBone, targetChild, targetBindLocalQuat, weight, desiredWorldDir) => {
      if (!targetBone || !targetChild || !targetBindLocalQuat || !desiredWorldDir) return;
      _alignPass1LocalQuat.copy(targetBone.quaternion);
      if (
        solveBoneDirectionSwingLocalQuat(
          null,
          null,
          targetBone,
          targetChild,
          targetBindLocalQuat,
          desiredWorldDir,
          _alignSolvedLocalQuat
        )
      ) {
        ensureShortestPathQuat(_alignPass1LocalQuat, _alignSolvedLocalQuat);
        _alignTargetBoneQuat
          .copy(_alignPass1LocalQuat)
          .slerp(_alignSolvedLocalQuat, THREE.MathUtils.clamp(weight, 0, 1));
        applyBoneTargetQuat(targetBone, _alignTargetBoneQuat);
      }
    };

    const blendRestPoseDelta = (boneKey, targetEntry, deltaWeight) => {
      if (!slot.isMixamoChibi || !targetEntry?.bone || deltaWeight <= 0.0001) return;
      if (solveRestPoseDeltaBoneQuat(slot, boneKey, _slotEvalDeltaQuat)) {
        _alignPass1LocalQuat.copy(targetEntry.bone.quaternion);
        ensureShortestPathQuat(_alignPass1LocalQuat, _slotEvalDeltaQuat);
        _alignTargetBoneQuat
          .copy(_alignPass1LocalQuat)
          .slerp(_slotEvalDeltaQuat, THREE.MathUtils.clamp(deltaWeight, 0, 1));
        applyBoneTargetQuat(targetEntry.bone, _alignTargetBoneQuat);
      }
    };

    // ------------------------------------------------------------------------
    // 2. SUBTLE HIP SWAY (`±8°` / `±0.14 rad`)
    // ------------------------------------------------------------------------
    if (riggedBones.hips) {
      let hipYaw = 0;
      let hipRoll = 0;
      if (slot.srcBones?.leftLeg && slot.srcBones?.rightLeg) {
        getSlotBoneDir(slot.srcBones.rightLeg, slot.srcBones.leftLeg, _slotEvalDirChar);
        hipYaw = THREE.MathUtils.clamp(
          Math.atan2(-_slotEvalDirChar.z, Math.max(0.2, _slotEvalDirChar.x)) * 0.45,
          -0.14,
          0.14
        );
        hipRoll = THREE.MathUtils.clamp(_slotEvalDirChar.y * 0.45, -0.08, 0.08);
      }

      applyBoneWorldYPZ(
        riggedBones.hips,
        hipYaw * effectiveMw + drag * 0.14 * (1 - effectiveMw),
        antic * 0.05 * (1 - effectiveMw),
        hipRoll * effectiveMw +
          (hipWeightShift * 0.025 * idleWeight - antic * 0.03) * (1 - effectiveMw)
      );
      blendRestPoseDelta('hips', riggedBones.hips, effectiveMw * 0.35);
      riggedBones.hips.bone.updateMatrixWorld(true);
    }

    // ------------------------------------------------------------------------
    // 3. UPPER BODY CHAIN (`Spine -> UpperBody -> Chest -> Neck -> Head`)
    // ------------------------------------------------------------------------
    const computeClampedTorsoWorldDir = (startKey, altStartKey, endKey, altEndKey, maxTiltRad) => {
      if (!slot.srcBones) return null;
      const bStart = slot.srcBones[startKey] || (altStartKey ? slot.srcBones[altStartKey] : null);
      const bEnd = slot.srcBones[endKey] || (altEndKey ? slot.srcBones[altEndKey] : null);
      if (!bStart || !bEnd) return null;
      if (!getSlotBoneDir(bStart, bEnd, _slotEvalDirWorld)) return null;
      if (_slotEvalDirWorld.y < 0.2) _slotEvalDirWorld.y = 0.85;
      _slotEvalDirWorld.normalize();
      if (slot.isMixamoChibi) {
        _slotEvalDirWorld.lerp(WORLD_Y, 0.25).normalize();
      }
      clampDirectionToCone(_slotEvalDirWorld, WORLD_Y, maxTiltRad);
      _slotEvalDirWorld.applyQuaternion(_slotEvalPivotQuat).normalize();
      return _slotEvalDirWorld;
    };

    const alignTorsoSegment = (startKey, altStartKey, endKey, altEndKey, targetEntry, maxTiltRad, segWeight) => {
      if (!targetEntry?.bone || segWeight <= 0.0001) return;
      const targetChild = getPrimaryChildBone(targetEntry.bone);
      if (!targetChild) return;
      const dActive = computeClampedTorsoWorldDir(startKey, altStartKey, endKey, altEndKey, maxTiltRad);
      if (dActive) {
        alignBoneToWorldDir(targetEntry.bone, targetChild, targetEntry.relaxedQuat, segWeight, dActive);
      }
      blendRestPoseDelta(startKey, targetEntry, segWeight * 0.55);
    };

    alignTorsoSegment('spine', 'hips', 'upperBody', 'chest', riggedBones.spine, 0.24, effectiveMw);
    if (riggedBones.upperBody) {
      alignTorsoSegment('upperBody', null, 'chest', null, riggedBones.upperBody, 0.22, effectiveMw);
    }
    alignTorsoSegment('chest', 'spine', 'neck', 'head', riggedBones.chest, 0.26, effectiveMw);
    alignTorsoSegment('neck', null, 'head', null, riggedBones.neck, 0.32, effectiveMw * 0.50);

    if (riggedBones.head?.bone) {
      let motionHeadPitch = 0;
      let motionHeadRoll = 0;
      if (slot.srcBones?.neck && slot.srcBones?.head) {
        getSlotBoneDir(slot.srcBones.neck, slot.srcBones.head, _slotEvalDirChar);
        if (_slotEvalDirChar.y < 0.2) _slotEvalDirChar.y = 0.85;
        _slotEvalDirChar.normalize();
        clampDirectionToCone(_slotEvalDirChar, WORLD_Y, 0.35);
        const headDamp = slot.isMixamoChibi ? 0.75 : 1.0;
        motionHeadRoll = THREE.MathUtils.clamp(-_slotEvalDirChar.x * 0.55 * headDamp, -0.22, 0.22);
        motionHeadPitch = THREE.MathUtils.clamp(_slotEvalDirChar.z * 0.50 * headDamp, -0.20, 0.20);
      }
      const gazeShare = isOfflineBake ? 0.0 : THREE.MathUtils.lerp(1.0, 0.50, effectiveMw);
      const motionShare = isOfflineBake ? 1.0 : 0.50 * effectiveMw;
      applyBoneWorldYPZ(
        riggedBones.head,
        headYaw * gazeShare,
        headPitch * gazeShare + motionHeadPitch * motionShare,
        headRoll * gazeShare + motionHeadRoll * motionShare
      );
      blendRestPoseDelta('head', riggedBones.head, effectiveMw * 0.45);
      riggedBones.head.bone.updateMatrixWorld(true);
    }

    // ------------------------------------------------------------------------
    // 4. BOTH LEGS (`LeftUpLeg -> LeftLeg -> LeftFoot` & `RightUpLeg -> RightLeg -> RightFoot`)
    // ------------------------------------------------------------------------
    const computeClampedThighDirs = (legKey, kneeKey, outCharDir, outWorldDir) => {
      if (!slot.srcBones) return null;
      const bLeg = slot.srcBones[legKey];
      const bKnee = slot.srcBones[kneeKey];
      if (!bLeg || !bKnee) return null;
      if (!getSlotBoneDir(bLeg, bKnee, outCharDir)) return null;
      if (slot.isMixamoChibi) {
        outCharDir.lerp(_slotEvalDownAxis, 0.20).normalize();
      }
      outCharDir.y = Math.min(outCharDir.y, -0.78);
      outCharDir.z = THREE.MathUtils.clamp(outCharDir.z, -0.22, 0.30);
      outCharDir.x = THREE.MathUtils.clamp(outCharDir.x, -0.26, 0.26);
      outCharDir.normalize();
      clampDirectionToCone(outCharDir, _slotEvalDownAxis, 0.34);
      outCharDir.y = Math.min(outCharDir.y, -0.78);
      outCharDir.normalize();
      outWorldDir.copy(outCharDir).applyQuaternion(_slotEvalPivotQuat).normalize();
      return outWorldDir;
    };

    const computeClampedCalfWorldDir = (kneeKey, footKey, refThighCharDir, outWorldDir) => {
      if (!slot.srcBones) return null;
      const bKnee = slot.srcBones[kneeKey];
      const bFoot = slot.srcBones[footKey];
      if (!bKnee || !bFoot) return null;
      if (!getSlotBoneDir(bKnee, bFoot, outWorldDir)) return null;
      if (slot.isMixamoChibi) {
        outWorldDir.lerp(refThighCharDir, 0.20).normalize();
      }
      outWorldDir.y = Math.min(outWorldDir.y, -0.78);
      outWorldDir.z = Math.min(outWorldDir.z, refThighCharDir.z);
      outWorldDir.x = THREE.MathUtils.clamp(
        outWorldDir.x,
        refThighCharDir.x - 0.14,
        refThighCharDir.x + 0.14
      );
      outWorldDir.normalize();
      clampDirectionToCone(outWorldDir, refThighCharDir, 0.485);
      outWorldDir.y = Math.min(outWorldDir.y, -0.78);
      outWorldDir.normalize();
      outWorldDir.applyQuaternion(_slotEvalPivotQuat).normalize();
      return outWorldDir;
    };

    const solveLegChain = (legKey, kneeKey, footKey, tgtLegEntry, tgtKneeEntry, tgtFootEntry) => {
      if (!tgtLegEntry?.bone || !tgtKneeEntry?.bone) return;
      const dThigh = computeClampedThighDirs(legKey, kneeKey, _slotEvalThighChar, _slotEvalDirWorld);
      if (dThigh) {
        alignBoneToWorldDir(
          tgtLegEntry.bone,
          tgtKneeEntry.bone,
          tgtLegEntry.relaxedQuat,
          effectiveMw,
          dThigh
        );
      }
      if (tgtFootEntry?.bone) {
        const dCalf = dThigh
          ? computeClampedCalfWorldDir(kneeKey, footKey, _slotEvalThighChar, _slotEvalDirWorld)
          : null;
        if (dCalf) {
          alignBoneToWorldDir(
            tgtKneeEntry.bone,
            tgtFootEntry.bone,
            tgtKneeEntry.relaxedQuat,
            effectiveMw,
            dCalf
          );
        }
        if (tgtFootEntry.relaxedQuat) {
          tgtFootEntry.bone.quaternion.slerp(tgtFootEntry.relaxedQuat, effectiveMw);
          blendRestPoseDelta(footKey, tgtFootEntry, effectiveMw * 0.50);
          tgtFootEntry.bone.updateMatrixWorld(true);
        }
      }
    };

    solveLegChain('rightLeg', 'rightKnee', 'rightFoot', riggedBones.rightLeg, riggedBones.rightKnee, riggedBones.rightFoot);
    solveLegChain('leftLeg', 'leftKnee', 'leftFoot', riggedBones.leftLeg, riggedBones.leftKnee, riggedBones.leftFoot);

    // ------------------------------------------------------------------------
    // 5. BOTH ARMS & HANDS (`LeftShoulder -> LeftArm -> LeftForeArm -> LeftHand` & Right)
    //    - UPDATE V42 SECTION 1: UNIFIED CHIBI ARM ADDUCTION & ZERO T-POSE TWITCH
    //      BETWEEN ANIMATION 1 (`change-pose-379001.fbx`) AND ANIMATION 2 (`Yawn.fbx`)!
    //      + Strictly NO `slerp` toward `restPose` / `bindPose` (T-Pose) at any point!
    //      + Both ActorCore (`change-pose-379001.fbx`) and Mixamo (`Yawn.fbx`, `Blow A Kiss.fbx`)
    //        use unified Chibi Arm Adduction & Shoulder Relaxation so there is zero
    //        10°–20° outward arm jump when transitioning `1 -> 2`!
    //    - UPDATE V41 SECTION 2: `Blow A Kiss.fbx` 3-PHASE HORIZONTAL MOUTH-TO-FORWARD
    //      KISS PROJECTION (`Kinematic Elbow-Pitch Compensation for Forward Kiss Push`).
    // ------------------------------------------------------------------------
    const isBlowAKissSlot = slot.id === 'blow_a_kiss_motion';
    const isChangePoseSlot = slot.id === 'change_pose';
    const clipSpan = Math.max(0.05, slot.clipDuration - slot.clipStartTime);
    const p = THREE.MathUtils.clamp((clampedTime - slot.clipStartTime) / clipSpan, 0.0, 1.0);

    // 3-Phase envelopes for `Blow A Kiss.fbx`:
    let kissRaiseToMouthWeight = 0.0;      // Peaks at p = 0.32..0.36 (Hand at lips)
    let kissForwardPushWeight = 0.0;       // Active during p in [0.36, 0.72] (Horizontal push from mouth)
    let kissArmElevationBoostFactor = 0.0; // 1.0 at p = 0.36 -> drops to 0.15 at p = 0.65 -> 0.0 at p = 1.0
    let kissOverallActiveEnvelope = 0.0;   // Active across p in [0.0, 1.0], decays to 0 in Phase 3 [0.72, 1.0]

    if (isBlowAKissSlot) {
      const phase1Rise = smoothstep01(0.03, 0.30, p);
      const phase3Fade = 1.0 - smoothstep01(0.72, 0.98, p);
      kissOverallActiveEnvelope = phase1Rise * phase3Fade;

      // Phase 1 (`p in [0.0, 0.36]`): Hand rises to mouth, then transitions into forward push
      kissRaiseToMouthWeight =
        phase1Rise * (1.0 - smoothstep01(0.36, 0.56, p));

      // Phase 2 (`p in [0.36, 0.72]`): Horizontal forward push from mouth level
      kissForwardPushWeight =
        smoothstep01(0.34, 0.48, p) * (1.0 - smoothstep01(0.68, 0.88, p));

      // Kinematic Height Lock: Drop LeftArm elevation boost from 100% (at p <= 0.36)
      // down to 15% as p goes 0.36 -> 0.65, then fade to 0 in Phase 3 [0.72, 1.0]!
      const pushDropT = smoothstep01(0.36, 0.65, p);
      kissArmElevationBoostFactor =
        phase1Rise * THREE.MathUtils.lerp(1.0, 0.15, pushDropT) * phase3Fade;
    }

    // UPDATE V42 SECTION 1.1 & 1.2: Unified Chibi Clavicle/Shoulder Relaxation across all 3 clips!
    // Never pull shoulders toward T-Pose; only apply positive shoulder lift when the arm actually raises!
    if (slot.isMixamoChibi) {
      const isYawnSlot = slot.id === 'yawn_motion';
      // In `Yawn.fbx`, keep shoulders relaxed at `relaxedQuat` at the start/end of the clip
      // (`yawnShoulderEnvelope = sin(pi * p)`) so `t = 0.12s` has ZERO residual Mixamo T-Pose shoulder lift!
      const shoulderDeltaScale = isYawnSlot
        ? Math.sin(p * Math.PI) * 0.65
        : isBlowAKissSlot
          ? 0.45 + 0.55 * kissArmElevationBoostFactor
          : 0.65;
      blendRestPoseDelta('rightShoulder', riggedBones.rightShoulder, effectiveMw * 0.72 * shoulderDeltaScale);
      blendRestPoseDelta(
        'leftShoulder',
        riggedBones.leftShoulder,
        effectiveMw * (isBlowAKissSlot ? 0.55 + 0.45 * kissArmElevationBoostFactor : 0.72 * shoulderDeltaScale)
      );
      // Only lift LeftShoulder slightly during Phase 1 (`Raise to Mouth`), and lower it during Phase 2 (`Forward Push`)!
      if (isBlowAKissSlot && kissOverallActiveEnvelope > 0.001 && riggedBones.leftShoulder?.bone) {
        const shoulderKinematicDeltaZ =
          (0.10 * kissArmElevationBoostFactor - 0.06 * kissForwardPushWeight) * effectiveMw;
        applyWorldAxisRotation(
          riggedBones.leftShoulder.bone,
          riggedBones.leftShoulder.bone.quaternion,
          WORLD_Z,
          lFlareSignZ * shoulderKinematicDeltaZ
        );
        riggedBones.leftShoulder.bone.updateMatrixWorld(true);
      }
    }

    const computeClampedUpperArmDirs = (isRightSide, armKey, elbowKey, outCharDir, outWorldDir) => {
      if (!slot.srcBones) return null;
      const bArm = slot.srcBones[armKey];
      const bElbow = slot.srcBones[elbowKey];
      if (!bArm || !bElbow) return null;
      if (!getSlotBoneDir(bArm, bElbow, outCharDir)) return null;

      const isBlowAKissLeft = isBlowAKissSlot && !isRightSide;

      if (isBlowAKissLeft) {
        // UPDATE V41 SECTION 2: Kinematic Elbow-Pitch Compensation on `LeftArm` for `Blow A Kiss.fbx`
        const naturalSideY = -0.90;
        const ampScale = THREE.MathUtils.lerp(0.88, 1.18, kissArmElevationBoostFactor);
        const yElevationOffset =
          0.32 * kissArmElevationBoostFactor - 0.26 * kissForwardPushWeight;
        const rawY = naturalSideY + (outCharDir.y - naturalSideY) * ampScale + yElevationOffset;
        const maxAllowedUpperArmY = THREE.MathUtils.lerp(
          0.12,
          -0.24,
          kissForwardPushWeight
        );
        outCharDir.y = THREE.MathUtils.clamp(rawY, -1.0, maxAllowedUpperArmY);

        // Forward (+Z) projection in front of chest/mouth
        const forwardBoostZ =
          0.36 * kissRaiseToMouthWeight + 0.44 * kissForwardPushWeight;
        outCharDir.z = THREE.MathUtils.clamp(outCharDir.z + forwardBoostZ, 0.04, 0.82);

        const targetElbowX = THREE.MathUtils.lerp(
          0.26,
          0.18,
          kissRaiseToMouthWeight + kissForwardPushWeight * 0.6
        );
        outCharDir.x = THREE.MathUtils.lerp(
          Math.max(0.12, outCharDir.x),
          targetElbowX,
          0.65 * kissOverallActiveEnvelope
        );
        outCharDir.normalize();
      } else if (slot.isMixamoChibi) {
        // UPDATE V42 SECTION 1.2: Eliminate Mixamo T-Pose residual abduction on `LeftArm` & `RightArm`!
        // When the arm is near its lowered/starting state (`raiseFactor` low), adduct `outCharDir.x`
        // to Nahida's slim Chibi A-pose (`|x| ≈ 0.24..0.28`) so `Yawn.fbx` at `t = 0.12s` matches
        // the relaxed arm adduction of `change-pose-379001.fbx` with zero 10°–20° outward jump!
        const outwardSign = isRightSide ? -1.0 : 1.0;
        const raiseFactor = smoothstep01(-0.58, 0.22, outCharDir.y);
        const slimChibiSideX = outwardSign * THREE.MathUtils.lerp(0.24, 0.34, raiseFactor);
        const adductionBlend = THREE.MathUtils.lerp(0.55, 0.84, raiseFactor);
        outCharDir.x = THREE.MathUtils.lerp(slimChibiSideX, outCharDir.x, adductionBlend);

        const minOutwardX = THREE.MathUtils.lerp(0.14, 0.22, raiseFactor);
        const maxOutwardX = THREE.MathUtils.lerp(0.32, 0.68, raiseFactor);
        if (isRightSide) {
          outCharDir.x = THREE.MathUtils.clamp(outCharDir.x, -maxOutwardX, -minOutwardX);
        } else {
          outCharDir.x = THREE.MathUtils.clamp(outCharDir.x, minOutwardX, maxOutwardX);
        }
        const forwardFaceOffset = 0.122 + 0.10 * raiseFactor;
        outCharDir.z = Math.max(outCharDir.z + forwardFaceOffset, -0.05);
        outCharDir.y = THREE.MathUtils.clamp(outCharDir.y * 0.90 - 0.06 * (1.0 - raiseFactor), -1.0, 0.58);
        outCharDir.normalize();
      } else {
        // Animation 1 (`change-pose-379001.fbx`): Unified Chibi Arm Adduction & End-of-Clip Anti-T-Pose Guard!
        // In the final 15% of `change-pose-379001.fbx`, prevent any FBX bind-pose return from flaring the arms outward!
        const outwardSign = isRightSide ? -1.0 : 1.0;
        const endCalmFactor = isChangePoseSlot ? smoothstep01(0.78, 1.0, p) : 0.0;
        const maxOutwardSpread = THREE.MathUtils.lerp(0.42, 0.28, endCalmFactor);
        const maxArmY = THREE.MathUtils.lerp(0.35, -0.72, endCalmFactor);
        const minArmZ = -0.08;

        outCharDir.y = THREE.MathUtils.clamp(outCharDir.y, -1.0, maxArmY);
        const zBackBlend = 1.0 - smoothstep01(minArmZ - 0.18, minArmZ + 0.14, outCharDir.z);
        if (zBackBlend > 0.0001) {
          outCharDir.z = THREE.MathUtils.lerp(outCharDir.z, 0.10, zBackBlend);
        }
        outCharDir.z = Math.max(outCharDir.z, minArmZ);
        if (isRightSide) {
          outCharDir.x = THREE.MathUtils.clamp(outCharDir.x, -maxOutwardSpread, -0.14);
        } else {
          outCharDir.x = THREE.MathUtils.clamp(outCharDir.x, 0.14, maxOutwardSpread);
        }
        if (endCalmFactor > 0.001) {
          const calmTargetX = outwardSign * 0.25;
          outCharDir.x = THREE.MathUtils.lerp(outCharDir.x, calmTargetX, 0.55 * endCalmFactor);
        }
        outCharDir.normalize();
      }

      outWorldDir.copy(outCharDir).applyQuaternion(_slotEvalPivotQuat).normalize();
      return outWorldDir;
    };

    const computeClampedForeArmWorldDir = (
      isRightSide,
      elbowKey,
      wristKey,
      refArmCharDir,
      outWorldDir
    ) => {
      if (!slot.srcBones) return null;
      const bElbow = slot.srcBones[elbowKey];
      const bWrist = slot.srcBones[wristKey];
      if (!bElbow || !bWrist) return null;
      if (!getSlotBoneDir(bElbow, bWrist, outWorldDir)) return null;

      const isBlowAKissLeft = isBlowAKissSlot && !isRightSide;

      if (isBlowAKissLeft) {
        // UPDATE V41 SECTION 2:
        // - Phase 1 (`kissRaiseToMouthWeight`): Forearm points inward & upward to place fingertips right at lips.
        // - Phase 2 (`kissForwardPushWeight`): Forearm extends horizontally forward (+Z) at mouth/chin level
        //   (`y ≈ 0.10..0.22`, NEVER pointing steeply upward toward the eyes!).
        const mouthTouchForeArmDir = new THREE.Vector3(-0.32, 0.72, 0.61).normalize();
        const horizontalForwardPushDir = new THREE.Vector3(-0.08, 0.14, 0.985).normalize();

        outWorldDir.lerp(mouthTouchForeArmDir, 0.72 * kissRaiseToMouthWeight).normalize();
        outWorldDir.lerp(horizontalForwardPushDir, 0.82 * kissForwardPushWeight).normalize();

        const maxForeArmY = THREE.MathUtils.lerp(0.76, 0.24, kissForwardPushWeight);
        outWorldDir.y = THREE.MathUtils.clamp(outWorldDir.y, -1.0, maxForeArmY);
        outWorldDir.z = Math.max(outWorldDir.z, 0.22 * kissOverallActiveEnvelope);
        outWorldDir.normalize();
      } else if (slot.isMixamoChibi) {
        outWorldDir.lerp(refArmCharDir, 0.08).normalize();
        const handRaiseFactor = smoothstep01(-0.20, 0.55, outWorldDir.y);
        outWorldDir.x *= 0.88;
        outWorldDir.z = Math.max(outWorldDir.z + 0.12 * handRaiseFactor, 0.08 * handRaiseFactor);
        outWorldDir.y = THREE.MathUtils.clamp(outWorldDir.y * 0.92, -1.0, 0.78);
        outWorldDir.normalize();
      } else {
        const maxForeArmY = 0.65;
        const elbowPoleLimitZ = refArmCharDir.z - 0.06;
        const forwardPoleTargetZ = THREE.MathUtils.clamp(
          Math.max(0.18, refArmCharDir.z + 0.24),
          0.16,
          0.82
        );
        const poleViolationBlend =
          1.0 - smoothstep01(elbowPoleLimitZ - 0.20, elbowPoleLimitZ + 0.22, outWorldDir.z);
        if (poleViolationBlend > 0.0001) {
          outWorldDir.z = THREE.MathUtils.lerp(
            outWorldDir.z,
            forwardPoleTargetZ,
            poleViolationBlend
          );
        }
        outWorldDir.z = THREE.MathUtils.clamp(
          outWorldDir.z,
          Math.max(-0.04, elbowPoleLimitZ),
          0.82
        );
        outWorldDir.y = THREE.MathUtils.clamp(outWorldDir.y, -1.0, maxForeArmY);
        outWorldDir.normalize();
        clampDirectionToCone(outWorldDir, refArmCharDir, 1.75);
      }

      outWorldDir.applyQuaternion(_slotEvalPivotQuat).normalize();
      return outWorldDir;
    };

    const solveArmChain = (
      isRightSide,
      armKey,
      elbowKey,
      wristKey,
      tgtArmEntry,
      tgtElbowEntry,
      tgtWristEntry
    ) => {
      if (!tgtArmEntry?.bone || !tgtElbowEntry?.bone) return;
      const isBlowAKissLeft = isBlowAKissSlot && !isRightSide;

      // 5A. UpperArm (`UpperArm -> ForeArm`)
      const dArm = computeClampedUpperArmDirs(
        isRightSide,
        armKey,
        elbowKey,
        _slotEvalArmChar,
        _slotEvalDirWorld
      );
      if (dArm) {
        alignBoneToWorldDir(
          tgtArmEntry.bone,
          tgtElbowEntry.bone,
          tgtArmEntry.relaxedQuat,
          effectiveMw,
          dArm
        );
      }
      if (slot.isMixamoChibi) {
        const armDeltaW = isBlowAKissLeft
          ? 0.28 * kissArmElevationBoostFactor + 0.12 * (1.0 - kissForwardPushWeight)
          : 0.28;
        blendRestPoseDelta(armKey, tgtArmEntry, effectiveMw * armDeltaW);
      }

      // 5B. ForeArm (`ForeArm -> Hand`) & Wrist
      if (tgtWristEntry?.bone) {
        const dForeArm = dArm
          ? computeClampedForeArmWorldDir(
              isRightSide,
              elbowKey,
              wristKey,
              _slotEvalArmChar,
              _slotEvalDirWorld
            )
          : null;
        if (dForeArm) {
          alignBoneToWorldDir(
            tgtElbowEntry.bone,
            tgtWristEntry.bone,
            tgtElbowEntry.relaxedQuat,
            effectiveMw,
            dForeArm
          );
        }
        if (slot.isMixamoChibi) {
          const elbowDeltaW = isBlowAKissLeft
            ? 0.32 * (1.0 - 0.55 * kissForwardPushWeight)
            : 0.32;
          blendRestPoseDelta(elbowKey, tgtElbowEntry, effectiveMw * elbowDeltaW);
          blendRestPoseDelta(
            wristKey,
            tgtWristEntry,
            effectiveMw * (isBlowAKissLeft ? 0.95 : 0.92)
          );
        }

        // UPDATE V41 SECTION 2: 3-Phase Horizontal Mouth-to-Forward Kiss Trajectory Solver (`LeftHand`)
        // Guarantees:
        // 1. At Phase 1 (`p in [0.0, 0.36]`): Left hand fingertips touch 5cm right in front of Nahida's mouth (`mouthLevelY`).
        // 2. At Phase 2 (`p in [0.36, 0.72]`): Left hand pushes HORIZONTALLY straight forward (+Z) from the mouth
        //    at `mouthLevelY` (strictly locked below nose/eye height!) while the wrist & fingers open forward.
        // 3. At Phase 3 (`p in [0.72, 1.0]`): Smoothly releases back to 0.
        if (isBlowAKissLeft && kissOverallActiveEnvelope > 0.005 && riggedBones.head?.bone) {
          const headWp = new THREE.Vector3();
          const neckWp = new THREE.Vector3();
          const elbowWp = new THREE.Vector3();
          riggedBones.head.bone.getWorldPosition(headWp);
          if (riggedBones.neck?.bone) {
            riggedBones.neck.bone.getWorldPosition(neckWp);
          } else {
            neckWp.copy(headWp).addScaledVector(WORLD_Y, -0.18);
          }

          // Exact Mouth/Lips Y height: 32% up from Neck to Head pivot (strictly mouth/chin level, well below eyes!)
          const mouthBaseWp = new THREE.Vector3().lerpVectors(neckWp, headWp, 0.32);
          const forwardWorldDir = new THREE.Vector3(0, 0, 1)
            .applyQuaternion(_slotEvalPivotQuat)
            .normalize();
          const rightWorldDir = new THREE.Vector3(1, 0, 0)
            .applyQuaternion(_slotEvalPivotQuat)
            .normalize();

          // Phase 2 horizontal push distance: starts at 0.16 (at lips) -> pushes straight forward to 0.48 (+Z)
          // while staying at `mouthBaseWp.y` (slight -0.02 gentle arc, NEVER rising above `mouthBaseWp.y`!)
          const forwardPushProgress = smoothstep01(0.35, 0.66, p);
          const targetForwardDistZ = THREE.MathUtils.lerp(0.16, 0.48, forwardPushProgress);
          const targetLateralOffsetX = THREE.MathUtils.lerp(0.03, 0.15, forwardPushProgress);
          const targetVerticalOffsetY = THREE.MathUtils.lerp(0.0, -0.03, forwardPushProgress);

          const kissHandTargetWp = mouthBaseWp
            .clone()
            .addScaledVector(forwardWorldDir, targetForwardDistZ)
            .addScaledVector(rightWorldDir, targetLateralOffsetX)
            .addScaledVector(WORLD_Y, targetVerticalOffsetY);

          // Hard ceiling lock on target Y: never allow the kiss target to exceed `mouthBaseWp.y + 0.01`!
          kissHandTargetWp.y = Math.min(kissHandTargetWp.y, mouthBaseWp.y + 0.01);

          // Step A: Adjust UpperArm slightly if Elbow is too high during Phase 2 forward push
          tgtElbowEntry.bone.getWorldPosition(elbowWp);
          if (kissForwardPushWeight > 0.01 && elbowWp.y > mouthBaseWp.y - 0.06) {
            const shoulderWp = new THREE.Vector3();
            tgtArmEntry.bone.getWorldPosition(shoulderWp);
            const loweredElbowWp = elbowWp.clone();
            loweredElbowWp.y = THREE.MathUtils.lerp(
              elbowWp.y,
              mouthBaseWp.y - 0.14,
              0.75 * kissForwardPushWeight
            );
            const correctedUpperDir = loweredElbowWp.sub(shoulderWp).normalize();
            alignBoneToWorldDir(
              tgtArmEntry.bone,
              tgtElbowEntry.bone,
              tgtArmEntry.relaxedQuat,
              0.70 * kissForwardPushWeight * effectiveMw,
              correctedUpperDir
            );
            tgtElbowEntry.bone.getWorldPosition(elbowWp);
          }

          // Step B: Aim ForeArm (`LeftForeArm -> LeftHand`) directly from Elbow to `kissHandTargetWp`
          const desiredForeArmDir = new THREE.Vector3()
            .subVectors(kissHandTargetWp, elbowWp);
          // Enforce horizontal height ceiling so ForeArm never points above `kissHandTargetWp.y`
          if (elbowWp.y + desiredForeArmDir.y > mouthBaseWp.y + 0.01) {
            desiredForeArmDir.y = (mouthBaseWp.y + 0.01) - elbowWp.y;
          }
          if (desiredForeArmDir.lengthSq() > 1e-6) {
            desiredForeArmDir.normalize();
            const guideWeight = THREE.MathUtils.clamp(
              (0.84 * kissRaiseToMouthWeight + 0.88 * kissForwardPushWeight) * effectiveMw,
              0.0,
              0.92
            );
            alignBoneToWorldDir(
              tgtElbowEntry.bone,
              tgtWristEntry.bone,
              tgtElbowEntry.relaxedQuat,
              guideWeight,
              desiredForeArmDir
            );
          }

          // Step C: Wrist orientation:
          // - Phase 1 (`kissRaiseToMouthWeight`): fingertips tilt gently inward toward the lips.
          // - Phase 2 (`kissForwardPushWeight`): palm opens & supinates forward as blowing the kiss!
          const wristPitch =
            (-0.18 * kissRaiseToMouthWeight + 0.22 * kissForwardPushWeight) * effectiveMw;
          const wristYaw =
            (0.22 * kissRaiseToMouthWeight - 0.14 * kissForwardPushWeight) * effectiveMw;
          applyWorldAxisRotation(
            tgtWristEntry.bone,
            tgtWristEntry.bone.quaternion,
            WORLD_X,
            wristPitch
          );
          applyWorldAxisRotation(
            tgtWristEntry.bone,
            tgtWristEntry.bone.quaternion,
            WORLD_Y,
            wristYaw
          );
          tgtWristEntry.bone.updateMatrixWorld(true);
        }
      }
    };

    solveArmChain(
      true,
      'rightArm',
      'rightElbow',
      'rightWrist',
      riggedBones.rightArm,
      riggedBones.rightElbow,
      riggedBones.rightWrist
    );
    solveArmChain(
      false,
      'leftArm',
      'leftElbow',
      'leftWrist',
      riggedBones.leftArm,
      riggedBones.leftElbow,
      riggedBones.leftWrist
    );

    // 5C. Apply Mixamo Finger Retargeting (`LeftHandThumb1..3`, `Index1..3`, `Middle1..3`, `Ring1..3`, `Pinky1..3` & Right)
    if (slot.isMixamoChibi) {
      applyMixamoChibiFingerRetargeting(slot, effectiveMw * (isBlowAKissSlot ? 0.96 : 0.92));
      // During Phase 2 of `Blow A Kiss.fbx` (`kissForwardPushWeight`), gently uncurl Left Hand fingers
      // by 35% so the hand opens gracefully as it blows the kiss forward!
      if (isBlowAKissSlot && kissForwardPushWeight > 0.01 && Array.isArray(riggedBones.fingerBones)) {
        const openBlend = 0.38 * kissForwardPushWeight * effectiveMw;
        for (let i = 0; i < riggedBones.fingerBones.length; i++) {
          const fb = riggedBones.fingerBones[i];
          if (!fb || fb.isRightSide || !fb.bone || !fb.restQuat) continue;
          _alignPass1LocalQuat.copy(fb.bone.quaternion);
          ensureShortestPathQuat(_alignPass1LocalQuat, fb.restQuat);
          fb.bone.quaternion.copy(_alignPass1LocalQuat).slerp(fb.restQuat, openBlend);
        }
      }
    }

    // ------------------------------------------------------------------------
    // 6. CLAMPED RELATIVE HIPS OFFSET & DYNAMIC GROUND FOOT-PINNING
    // ------------------------------------------------------------------------
    sampleSlotHipsBounceCurveAtTime(slot, clampedTime, _slotEvalDirChar);
    const deltaHipsX = THREE.MathUtils.clamp(_slotEvalDirChar.x, -0.03, 0.03);
    const deltaHipsY = THREE.MathUtils.clamp(_slotEvalDirChar.y, -0.04, 0.04);
    const deltaHipsZ = THREE.MathUtils.clamp(_slotEvalDirChar.z, -0.03, 0.03);

    loadedModel.position.x = baseModelLocalPos.x + deltaHipsX * effectiveMw;
    loadedModel.position.y = baseModelLocalPos.y + deltaHipsY * effectiveMw;
    loadedModel.position.z = baseModelLocalPos.z + deltaHipsZ * effectiveMw;
    loadedModel.updateMatrixWorld(true);

    const pivotY = characterPivot.position.y;
    const pivotScaleY = Math.max(0.5, characterPivot.scale.y || 1.0);
    let minFootDeltaCharY = Infinity;

    if (riggedBones.leftFoot?.bone) {
      riggedBones.leftFoot.bone.getWorldPosition(tempBoneWp);
      const currCharY = (tempBoneWp.y - pivotY) / pivotScaleY;
      minFootDeltaCharY = Math.min(
        minFootDeltaCharY,
        currCharY - fbxRetargetState.restLeftFootCharY
      );
    }
    if (riggedBones.rightFoot?.bone) {
      riggedBones.rightFoot.bone.getWorldPosition(tempBoneWp);
      const currCharY = (tempBoneWp.y - pivotY) / pivotScaleY;
      minFootDeltaCharY = Math.min(
        minFootDeltaCharY,
        currCharY - fbxRetargetState.restRightFootCharY
      );
    }
    if (riggedBones.leftToe?.bone) {
      riggedBones.leftToe.bone.getWorldPosition(tempBoneWp);
      const currCharY = (tempBoneWp.y - pivotY) / pivotScaleY;
      minFootDeltaCharY = Math.min(
        minFootDeltaCharY,
        currCharY - fbxRetargetState.restLeftToeCharY
      );
    }
    if (riggedBones.rightToe?.bone) {
      riggedBones.rightToe.bone.getWorldPosition(tempBoneWp);
      const currCharY = (tempBoneWp.y - pivotY) / pivotScaleY;
      minFootDeltaCharY = Math.min(
        minFootDeltaCharY,
        currCharY - fbxRetargetState.restRightToeCharY
      );
    }

    if (Number.isFinite(minFootDeltaCharY)) {
      const clampedFootAdjust = THREE.MathUtils.clamp(
        -minFootDeltaCharY * effectiveMw,
        -0.04,
        0.04
      );
      loadedModel.position.y = THREE.MathUtils.clamp(
        loadedModel.position.y + clampedFootAdjust,
        baseModelLocalPos.y - 0.04,
        baseModelLocalPos.y + 0.04
      );
      loadedModel.updateMatrixWorld(true);
    }
  }

  /**
   * UPDATE V41 SECTION 1.2: Captures all articulated bone Quaternions + Finger Quaternions
   * + `loadedModel.position` (`Hips` offset) for `StartPose(A_i)` and `EndPose(A_i)`.
   */
  function captureFullNahidaPoseSnapshot(outQuatMap, outHipsPos = null) {
    if (!outQuatMap) return;
    outQuatMap.clear();
    const coreEntries = [
      riggedBones.hips,
      riggedBones.spine,
      riggedBones.upperBody,
      riggedBones.chest,
      riggedBones.neck,
      riggedBones.head,
      riggedBones.rightShoulder,
      riggedBones.rightArm,
      riggedBones.rightElbow,
      riggedBones.rightWrist,
      riggedBones.leftShoulder,
      riggedBones.leftArm,
      riggedBones.leftElbow,
      riggedBones.leftWrist,
      riggedBones.rightLeg,
      riggedBones.rightKnee,
      riggedBones.rightFoot,
      riggedBones.rightToe,
      riggedBones.leftLeg,
      riggedBones.leftKnee,
      riggedBones.leftFoot,
      riggedBones.leftToe
    ];
    for (let i = 0; i < coreEntries.length; i++) {
      const e = coreEntries[i];
      if (e && e.bone && isFiniteQuaternion(e.bone.quaternion)) {
        outQuatMap.set(e.bone, e.bone.quaternion.clone());
      }
    }
    if (Array.isArray(riggedBones.fingerBones)) {
      for (let i = 0; i < riggedBones.fingerBones.length; i++) {
        const fb = riggedBones.fingerBones[i];
        if (fb && fb.bone && isFiniteQuaternion(fb.bone.quaternion)) {
          outQuatMap.set(fb.bone, fb.bone.quaternion.clone());
        }
      }
    }
    if (outHipsPos && loadedModel) {
      outHipsPos.copy(loadedModel.position);
    }
  }

  function applyLookAheadPoseToPoseBridge(
    fromQuatMap,
    fromHipsPos,
    toQuatMap,
    toHipsPos,
    sFactor,
    mwWeight = 1.0
  ) {
    try {
      if (!fromQuatMap || !toQuatMap || !loadedModel) return;
      const s = THREE.MathUtils.clamp(sFactor, 0.0, 1.0);
      const w = THREE.MathUtils.clamp(mwWeight, 0.0, 1.0);

      // UPDATE V43 SECTION 2: Direct Live Quaternion Capture -> Smooth Slerp (`qStart.dot(qEnd) < 0` check)
      // along Quintic Ease-In-Out s(u) = 6u^5 - 15u^4 + 10u^3 with zero complex vector projection math!
      toQuatMap.forEach((qStartNext, bone) => {
        if (!bone || !isFiniteQuaternion(qStartNext)) return;
        const qEndPrev = fromQuatMap.get(bone) || bone.quaternion;
        if (!isFiniteQuaternion(qEndPrev)) return;

        // Shortest-path hemisphere lock: q_1 . q_2 >= 0 before slerp!
        _alignSolvedLocalQuat.copy(qEndPrev);
        _alignSolvedLocalQuat2.copy(qStartNext);
        ensureShortestPathQuat(_alignSolvedLocalQuat, _alignSolvedLocalQuat2);
        _alignSolvedLocalQuat.slerp(_alignSolvedLocalQuat2, s);

        if (w >= 0.999) {
          bone.quaternion.copy(_alignSolvedLocalQuat);
        } else {
          _alignPass1LocalQuat.copy(bone.quaternion);
          ensureShortestPathQuat(_alignPass1LocalQuat, _alignSolvedLocalQuat);
          bone.quaternion.copy(_alignPass1LocalQuat).slerp(_alignSolvedLocalQuat, w);
        }
        bone.updateMatrixWorld(true);

        // Keep temporal & EMA quaternion dampers synced to the exact bridged quaternion
        const tq = temporalBoneQuatMap.get(bone);
        if (tq) tq.copy(bone.quaternion);
        const eq = emaFullSkeletonQuatMap.get(bone);
        if (eq) eq.copy(bone.quaternion);
      });

      if (fromHipsPos && toHipsPos) {
        const bx = THREE.MathUtils.lerp(fromHipsPos.x, toHipsPos.x, s);
        const by = THREE.MathUtils.lerp(fromHipsPos.y, toHipsPos.y, s);
        const bz = THREE.MathUtils.lerp(fromHipsPos.z, toHipsPos.z, s);
        loadedModel.position.x = THREE.MathUtils.lerp(baseModelLocalPos.x, bx, w);
        loadedModel.position.y = THREE.MathUtils.lerp(baseModelLocalPos.y, by, w);
        loadedModel.position.z = THREE.MathUtils.lerp(baseModelLocalPos.z, bz, w);
        loadedModel.updateMatrixWorld(true);
      }
    } catch (err) {
      console.warn('applyLookAheadPoseToPoseBridge fallback:', err);
    }
  }

  function resetNahidaToNeutralBaseForBake() {
    if (!loadedModel) return;
    loadedModel.position.copy(baseModelLocalPos);
    const entries = [
      riggedBones.hips,
      riggedBones.spine,
      riggedBones.upperBody,
      riggedBones.chest,
      riggedBones.neck,
      riggedBones.head,
      riggedBones.rightShoulder,
      riggedBones.rightArm,
      riggedBones.rightElbow,
      riggedBones.rightWrist,
      riggedBones.leftShoulder,
      riggedBones.leftArm,
      riggedBones.leftElbow,
      riggedBones.leftWrist,
      riggedBones.rightLeg,
      riggedBones.rightKnee,
      riggedBones.rightFoot,
      riggedBones.rightToe,
      riggedBones.leftLeg,
      riggedBones.leftKnee,
      riggedBones.leftFoot,
      riggedBones.leftToe
    ];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e && e.bone && e.relaxedQuat) {
        e.bone.quaternion.copy(e.relaxedQuat);
      }
    }
    if (Array.isArray(riggedBones.fingerBones)) {
      for (let i = 0; i < riggedBones.fingerBones.length; i++) {
        const fb = riggedBones.fingerBones[i];
        if (fb && fb.bone && fb.restQuat) {
          fb.bone.quaternion.copy(fb.restQuat);
          fb.bone.rotateOnAxis(fb.curlAxisVec, fb.baseCurlAngle);
        }
      }
    }
    characterPivot.updateMatrixWorld(true);
  }

  /**
   * Pre-computes `StartPose(A_i)` (at $t = t_{\text{start}}$) and `EndPose(A_i)` (at $t = T_{\text{end}}$)
   * for a normalized FBX clip slot so Look-Ahead Pose-to-Pose transitions have 100% pre-sampled targets!
   */
  function precomputeSlotStartAndEndPoses(slot) {
    if (!slot || !slot.isReady || !loadedModel) return;
    resetNahidaToNeutralBaseForBake();
    evaluateAndApplySlotPoseToNahida(slot, slot.clipStartTime, 1.0, { isOfflineBake: true });
    captureFullNahidaPoseSnapshot(slot.startPoseBoneQuats, slot.startPoseHipsPos);

    resetNahidaToNeutralBaseForBake();
    evaluateAndApplySlotPoseToNahida(slot, slot.clipDuration, 1.0, { isOfflineBake: true });
    captureFullNahidaPoseSnapshot(slot.endPoseBoneQuats, slot.endPoseHipsPos);

    slot.currentClipTime = slot.clipStartTime;
    slot.hasPrecomputedBoundaryPoses = true;
  }

  /**
   * Normalizes a single FBX clip slot (`motion1`, `motion2`, or `motion3`) against Nahida's `targetHipHeight`:
   */
  function normalizeFBXClipSlot(slot, targetHipHeight) {
    if (!slot || !slot.fbxRoot || !slot.clip || !slot.sourceMixer) return false;

    const fbxRoot = slot.fbxRoot;
    const sourceMixer = slot.sourceMixer;
    const clip = slot.clip;
    slot.hipsBounceCurve = clip.__hipsBounceCurve || null;

    const src = SmartSkeletonTopologyMatcher(fbxRoot);
    slot.srcBones = src;

    // UPDATE V43 SECTION 2: Trim Boundary T-Pose Frames for Look-Ahead Pose Bridge:
    // - For Animation 1 (`change-pose-379001.fbx`): Trim the last `0.12s` (`effectiveDuration = clip.duration - 0.12`)
    //   where both arms are in their calmest relaxed pose before the raw FBX eases toward bind-pose!
    // - For Animation 2 (`Yawn.fbx`) & Animation 3 (`Blow A Kiss.fbx`): Start at `t = 0.14s`
    //   (`clipStart = 0.14`), skipping the initial `0.00s -> 0.14s` frames that carry residual Mixamo T-Pose abduction!
    const isChangePoseClip = slot.id === 'change_pose';
    const desiredStartTrim = slot.isMixamoChibi ? 0.14 : 0.02;
    const desiredEndTrim = isChangePoseClip ? 0.12 : 0.0;
    const clipStart = Math.min(desiredStartTrim, clip.duration * 0.15);
    const clipEnd = Math.max(clipStart + 0.15, clip.duration - desiredEndTrim);
    slot.clipStartTime = clipStart;
    slot.clipDuration = clipEnd;
    slot.currentClipTime = clipStart;

    // 1. Lock all FBX bone positions & scales to their initial Bind values before evaluating Frame 0
    fbxRoot.traverse((node) => {
      if (node !== fbxRoot && node.userData && node.userData.__fbxBindPos) {
        node.position.copy(node.userData.__fbxBindPos);
        node.scale.set(1, 1, 1);
      }
    });

    // 2. NORMALIZE ROOT COORDINATE SYSTEM (`Z-up -> Y-up`) AT `clipStart` (`t = 0.12s` for Mixamo, `0.02s` for ActorCore)
    fbxRoot.position.set(0, 0, 0);
    fbxRoot.rotation.set(0, 0, 0);
    fbxRoot.scale.set(1, 1, 1);
    sourceMixer.setTime(clipStart);
    fbxRoot.updateMatrixWorld(true);

    const hipsPos = new THREE.Vector3();
    const headPos = new THREE.Vector3();
    const fbxUpDir = new THREE.Vector3(0, 1, 0);

    const lowerRef = src.hips || src.spine;
    const upperRef = src.head || src.neck || src.chest;
    if (lowerRef && upperRef) {
      lowerRef.getWorldPosition(hipsPos);
      upperRef.getWorldPosition(headPos);
      fbxUpDir.subVectors(headPos, hipsPos);
      if (fbxUpDir.lengthSq() > 1e-6) {
        fbxUpDir.normalize();
        const upAlignQuat = new THREE.Quaternion().setFromUnitVectors(
          fbxUpDir,
          WORLD_Y
        );
        fbxRoot.quaternion.premultiply(upAlignQuat);
        fbxRoot.updateMatrixWorld(true);
      }
    }

    const rightSideRef = src.rightLeg || src.rightArm || src.rightShoulder;
    const leftSideRef = src.leftLeg || src.leftArm || src.leftShoulder;
    if (rightSideRef && leftSideRef) {
      const rPos = new THREE.Vector3();
      const lPos = new THREE.Vector3();
      rightSideRef.getWorldPosition(rPos);
      leftSideRef.getWorldPosition(lPos);
      const fbxLeftDir = new THREE.Vector3().subVectors(lPos, rPos);
      fbxLeftDir.y = 0;
      if (fbxLeftDir.lengthSq() > 1e-6) {
        fbxLeftDir.normalize();
        const yawAlignQuat = new THREE.Quaternion().setFromUnitVectors(
          fbxLeftDir,
          WORLD_X
        );
        fbxRoot.quaternion.premultiply(yawAlignQuat);
        fbxRoot.updateMatrixWorld(true);
      }
    }

    slot.canonicalRootQuat.copy(fbxRoot.quaternion);

    // 3. Measure `sourceHipHeight` in normalized upright World Space and compute `hipScaleRatio`
    const tempWp = new THREE.Vector3();
    let fbxMinY = Infinity;
    let fbxMaxY = -Infinity;
    src.allBones.forEach((b) => {
      b.getWorldPosition(tempWp);
      if (tempWp.y < fbxMinY) fbxMinY = tempWp.y;
      if (tempWp.y > fbxMaxY) fbxMaxY = tempWp.y;
    });
    if (!Number.isFinite(fbxMinY)) fbxMinY = 0;

    if (src.hips) {
      src.hips.getWorldPosition(slot.sourceHipsRestPos);
      slot.sourceHipsBone = src.hips;
    } else {
      slot.sourceHipsRestPos.set(0, (fbxMinY + fbxMaxY) * 0.52, 0);
    }

    const sourceHipHeight = Math.max(
      0.0001,
      slot.sourceHipsRestPos.y - fbxMinY
    );
    slot.hipScaleRatio = slot.isMixamoChibi
      ? 0.0085
      : THREE.MathUtils.clamp(targetHipHeight / sourceHipHeight, 0.0005, 2.0);

    // 4. Build World-Space Rest-Pose Delta-Quaternion Table for Section 2 Retargeting
    buildSlotRestPoseDeltaRetargetTable(slot);

    // 5. Cache `t = 0.02s` 3D joint positions for smooth boundary blending
    slot.startFrameBonePositions.clear();
    src.allBones.forEach((b) => {
      const p = new THREE.Vector3();
      b.getWorldPosition(p);
      slot.startFrameBonePositions.set(b, p);
    });
    if (slot.sourceHipsBone) {
      slot.sourceHipsBone.getWorldPosition(slot.startFrameHipsPos);
    }

    slot.isReady = true;
    return true;
  }

  /**
   * Builds `FBXToGLBRetargeter` (UPDATE V39 — 3-Motion Sequence Retargeter)
   * whenever `loadedModel` (`/genshin_impact_-_nahida.glb`) and at least one FBX motion slot
   * (`motion1` = `/change-pose-379001.fbx`, `motion2` = `/Yawn.fbx`, `motion3` = `/Blow A Kiss.fbx`) are loaded.
   */
  function tryBuildFBXToGLBRetargeter() {
    if (!loadedModel) return;
    const hasM1 = Boolean(fbxRetargetState.motion1.fbxRoot && fbxRetargetState.motion1.clip);
    const hasM2 = Boolean(fbxRetargetState.motion2.fbxRoot && fbxRetargetState.motion2.clip);
    const hasM3 = Boolean(fbxRetargetState.motion3.fbxRoot && fbxRetargetState.motion3.clip);
    if (!hasM1 && !hasM2 && !hasM3) return;

    const savedPivotPos = characterPivot.position.clone();
    const savedPivotRot = characterPivot.rotation.clone();
    const savedPivotScale = characterPivot.scale.clone();

    characterPivot.position.set(0, 0, 0);
    characterPivot.rotation.set(0, 0, 0);
    characterPivot.scale.setScalar(1);
    loadedModel.position.copy(baseModelLocalPos);
    [
      riggedBones.hips,
      riggedBones.spine,
      riggedBones.upperBody,
      riggedBones.chest,
      riggedBones.neck,
      riggedBones.head,
      riggedBones.rightShoulder,
      riggedBones.rightArm,
      riggedBones.rightElbow,
      riggedBones.rightWrist,
      riggedBones.leftShoulder,
      riggedBones.leftArm,
      riggedBones.leftElbow,
      riggedBones.leftWrist,
      riggedBones.rightLeg,
      riggedBones.rightKnee,
      riggedBones.rightFoot,
      riggedBones.rightToe,
      riggedBones.leftLeg,
      riggedBones.leftKnee,
      riggedBones.leftFoot,
      riggedBones.leftToe
    ].forEach((entry) => {
      if (entry && entry.bone && entry.relaxedQuat) {
        entry.bone.quaternion.copy(entry.relaxedQuat);
      }
    });
    characterPivot.updateMatrixWorld(true);

    const tempWp = new THREE.Vector3();
    let targetHipHeight = charHeight * 0.48;
    if (riggedBones.hips && riggedBones.hips.bone) {
      riggedBones.hips.bone.getWorldPosition(tempWp);
      targetHipHeight = Math.max(0.25, tempWp.y);
    }

    if (riggedBones.leftFoot?.bone) {
      riggedBones.leftFoot.bone.getWorldPosition(tempWp);
      fbxRetargetState.restLeftFootCharY = tempWp.y;
    }
    if (riggedBones.rightFoot?.bone) {
      riggedBones.rightFoot.bone.getWorldPosition(tempWp);
      fbxRetargetState.restRightFootCharY = tempWp.y;
    }
    if (riggedBones.leftToe?.bone) {
      riggedBones.leftToe.bone.getWorldPosition(tempWp);
      fbxRetargetState.restLeftToeCharY = tempWp.y;
    }
    if (riggedBones.rightToe?.bone) {
      riggedBones.rightToe.bone.getWorldPosition(tempWp);
      fbxRetargetState.restRightToeCharY = tempWp.y;
    }

    if (hasM1 && !fbxRetargetState.motion1.isReady) {
      normalizeFBXClipSlot(fbxRetargetState.motion1, targetHipHeight);
    }
    if (hasM2 && !fbxRetargetState.motion2.isReady) {
      normalizeFBXClipSlot(fbxRetargetState.motion2, targetHipHeight);
    }
    if (hasM3 && !fbxRetargetState.motion3.isReady) {
      normalizeFBXClipSlot(fbxRetargetState.motion3, targetHipHeight);
    }

    // UPDATE V41 SECTION 1.2: Pre-compute StartPose (t = 0) & EndPose (t = T_end) for all ready slots!
    if (fbxRetargetState.motion1.isReady && !fbxRetargetState.motion1.hasPrecomputedBoundaryPoses) {
      precomputeSlotStartAndEndPoses(fbxRetargetState.motion1);
    }
    if (fbxRetargetState.motion2.isReady && !fbxRetargetState.motion2.hasPrecomputedBoundaryPoses) {
      precomputeSlotStartAndEndPoses(fbxRetargetState.motion2);
    }
    if (fbxRetargetState.motion3.isReady && !fbxRetargetState.motion3.hasPrecomputedBoundaryPoses) {
      precomputeSlotStartAndEndPoses(fbxRetargetState.motion3);
    }
    resetNahidaToNeutralBaseForBake();

    characterPivot.position.copy(savedPivotPos);
    characterPivot.rotation.copy(savedPivotRot);
    characterPivot.scale.copy(savedPivotScale);
    characterPivot.updateMatrixWorld(true);

    if (
      fbxRetargetState.motion1.isReady ||
      fbxRetargetState.motion2.isReady ||
      fbxRetargetState.motion3.isReady
    ) {
      const wasReady = fbxRetargetState.isReady;
      fbxRetargetState.isReady = true;
      if (!wasReady) {
        if (fbxRetargetState.motion1.isReady) {
          fbxRetargetState.activeSlotIndex = 1;
          fbxRetargetState.sequenceStage = 'STAGE_MOTION_1';
        } else if (fbxRetargetState.motion2.isReady) {
          fbxRetargetState.activeSlotIndex = 2;
          fbxRetargetState.sequenceStage = 'STAGE_MOTION_2';
        } else {
          fbxRetargetState.activeSlotIndex = 3;
          fbxRetargetState.sequenceStage = 'STAGE_MOTION_3';
        }
        fbxRetargetState.bridgeTimer = 0.0;
        fbxRetargetState.bridgeMotionFactor = 1.0;
        fbxRetargetState.targetBlendWeight = 1.0;
        fbxRetargetState.blendSpeed = 1.0 / 0.38;
      }
    }
  }

  // UPDATE V39 SECTION 1: Load 3-Motion Sequence at Slide 01:
  // 1. `/change-pose-379001.fbx` (Motion 1)
  // 2. `/Yawn.fbx` (Motion 2 - Mixamo Without Skin 60FPS)
  // 3. `/Blow A Kiss.fbx` (Motion 3 - Mixamo Without Skin 60FPS, with encodeURI fallback)
  const fbxLoader = new FBXLoader();
  function loadFBXSlotWithFallback(slot, primaryUrl, fallbackUrl) {
    const onLoaded = (fbxMotion) => {
      if (!fbxMotion || !fbxMotion.animations || fbxMotion.animations.length === 0) {
        console.warn(`No animation clips found in ${primaryUrl}`);
        return;
      }
      // 1. Strip & dispose all Meshes/SkinnedMeshes/Geometries/Materials inside the FBX
      //    and NEVER add `fbxMotion` to `scene`!
      fbxMotion.visible = false;
      stripAndDisposeFBXMeshes(fbxMotion);

      // 2. Strip 100% of `.scale` and `.position` tracks & upsample `.quaternion` tracks to 120 FPS
      const rawClip = fbxMotion.animations[0];
      const clip120 = upsampleAnimationClipTo120FPS(rawClip);
      fbxMotion.animations[0] = clip120;

      const sourceMixer = new THREE.AnimationMixer(fbxMotion);
      const sourceAction = sourceMixer.clipAction(clip120);
      sourceAction.play();

      slot.fbxRoot = fbxMotion;
      slot.sourceMixer = sourceMixer;
      slot.sourceAction = sourceAction;
      slot.clip = clip120;
      slot.hipsBounceCurve = clip120.__hipsBounceCurve || null;

      tryBuildFBXToGLBRetargeter();
    };

    const encodedPrimary = encodeURI(primaryUrl);
    fbxLoader.load(
      encodedPrimary,
      onLoaded,
      undefined,
      () => {
        fbxLoader.load(
          primaryUrl,
          onLoaded,
          undefined,
          () => {
            fbxLoader.load(
              encodeURI(fallbackUrl),
              onLoaded,
              undefined,
              (err) => {
                console.error(`Error loading ${primaryUrl}:`, err);
              }
            );
          }
        );
      }
    );
  }

  loadFBXSlotWithFallback(
    fbxRetargetState.motion1,
    '/change-pose-379001.fbx',
    './change-pose-379001.fbx'
  );
  loadFBXSlotWithFallback(
    fbxRetargetState.motion2,
    '/Yawn.fbx',
    './Yawn.fbx'
  );
  loadFBXSlotWithFallback(
    fbxRetargetState.motion3,
    '/Blow A Kiss.fbx',
    './Blow A Kiss.fbx'
  );

  // UPDATE V39 SECTION 1: Procedural in-place Spin is completely removed!
  // Kept as a safe no-op stub so any legacy reference transitions directly to Motion 1.
  function triggerInPlaceShowcaseSpin() {
    isInPlaceSpinning = false;
    spinStageState.active = false;
  }

  /**
   * ==========================================================================
   * UNIVERSAL CANVA BLUR-FADE INTRO & DENDRO BLOOM FRAME OUTRO
   * (`playModelCanvaBlurIntro` & `playDendroBloomFrameOutro`)
   * ==========================================================================
   */
  const canvaBlurState = {
    opacity: 0,
    blurPx: 20,
    scale: 0.92,
    vfxOpacity: 0
  };

  let activeOutroTimeline = null;
  let activeSwingRestoreDelayCall = null;

  function setCharacterModelFadeOpacity(alpha) {
    if (!loadedModel) return;
    const clampedAlpha = THREE.MathUtils.clamp(alpha, 0, 1);
    loadedModel.traverse((child) => {
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (let i = 0; i < mats.length; i++) {
          const m = mats[i];
          if (!m) continue;
          m.userData = m.userData || {};
          if (m.userData.__origOpacity === undefined) {
            m.userData.__origOpacity =
              m.userData.baseOpacity !== undefined
                ? m.userData.baseOpacity
                : m.opacity !== undefined && m.opacity > 0.05
                ? m.opacity
                : 1.0;
            m.userData.__origTransparent = Boolean(m.transparent);
          }
          if (clampedAlpha < 0.995) {
            m.transparent = true;
            m.opacity = m.userData.__origOpacity * clampedAlpha;
          } else {
            m.transparent = Boolean(m.userData.__origTransparent);
            m.opacity = m.userData.__origOpacity;
          }
        }
      }
    });
  }

  function restoreAllCharacterAndSwingMaterials() {
    setCharacterModelFadeOpacity(1.0);
    characterPivot.traverse((child) => {
      if (child.isMesh && child.material) {
        if (child.userData && child.userData.isHiddenOutline) {
          child.visible = false;
          return;
        }
        child.visible = true;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (let i = 0; i < mats.length; i++) {
          const m = mats[i];
          if (!m) continue;
          const baseOp =
            m.userData?.baseOpacity ??
            m.userData?.__origOpacity ??
            child.userData?.baseOpacity ??
            1.0;
          m.opacity = baseOp;
          if (m.userData && m.userData.__origTransparent !== undefined) {
            m.transparent = Boolean(m.userData.__origTransparent);
          }
        }
      }
    });
    if (dendroSwingGroup && dendroSwingGroup.userData && dendroSwingGroup.userData.materials) {
      const swMats = dendroSwingGroup.userData.materials;
      for (let i = 0; i < swMats.length; i++) {
        const sm = swMats[i];
        sm.opacity = sm.userData?.baseOpacity !== undefined ? sm.userData.baseOpacity : 0.85;
      }
    }
  }

  function applyCanvaBlurStateToDOMAndPivot() {
    const charOp = THREE.MathUtils.clamp(canvaBlurState.opacity, 0, 1);
    const vfxOp = THREE.MathUtils.clamp(canvaBlurState.vfxOpacity || 0, 0, 1);
    const effectiveContainerOp = Math.max(charOp, vfxOp);

    // Keep 3D Dendro Bloom Frame crisp while it is blooming at peak opacity,
    // while fading Nahida's 3D meshes and applying the blur dissolve smoothly.
    const rawBlur = Math.max(0, canvaBlurState.blurPx);
    const effectiveBlur = rawBlur * (1.0 - vfxOp * 0.82);
    const sc = THREE.MathUtils.clamp(canvaBlurState.scale, 0.5, 1.5);
    const filterStr = effectiveBlur > 0.05 ? `blur(${effectiveBlur.toFixed(2)}px)` : 'none';

    characterPivot.scale.setScalar(sc * CHARACTER_UNIFORM_SCALE);

    if (container) {
      container.style.display = 'block';
      container.style.opacity = String(effectiveContainerOp);
      container.style.visibility =
        effectiveContainerOp <= 0.001 && !characterPivot.visible && !isCurtainMode
          ? 'hidden'
          : 'visible';
      container.style.filter = filterStr;
      container.style.webkitFilter = filterStr;
    }
    if (renderer.domElement) {
      renderer.domElement.style.display = 'block';
      renderer.domElement.style.visibility = 'visible';
      renderer.domElement.style.opacity = String(effectiveContainerOp);
      renderer.domElement.style.filter = filterStr;
      renderer.domElement.style.webkitFilter = filterStr;
    }
  }

  function playModelCanvaBlurIntro(duration = 0.65) {
    if (activeOutroTimeline) {
      activeOutroTimeline.kill();
      activeOutroTimeline = null;
    }
    gsap.killTweensOf(canvaBlurState);
    if (container) {
      gsap.killTweensOf(container);
      container.style.display = 'block';
      container.style.visibility = 'visible';
      if (isCurtainMode) {
        container.style.zIndex = '935';
      }
    }
    if (renderer && renderer.domElement) {
      gsap.killTweensOf(renderer.domElement);
      renderer.domElement.style.display = 'block';
      renderer.domElement.style.visibility = 'visible';
    }

    // 1. Force Visibility Restore on Parent & Child 3D Groups
    dendroOutroVFXGroup.visible = false;
    canvaBlurState.vfxOpacity = 0;
    characterPivot.visible = true;
    if (loadedModel) {
      loadedModel.visible = true;
    }
    if (
      dendroSwingGroup &&
      (poseControl.swingSitWeight > 0.5 || idleScheduler.mode === 'SWING_SIT_MODE')
    ) {
      dendroSwingGroup.visible = true;
    }

    // 2. Restore 100% of `material.opacity` (`baseOpacity ?? 1.0`) across all meshes of Nahida & Swing
    restoreAllCharacterAndSwingMaterials();

    canvaBlurState.opacity = 0;
    canvaBlurState.blurPx = 18;
    canvaBlurState.scale = 0.92;
    applyCanvaBlurStateToDOMAndPivot();

    return gsap.to(canvaBlurState, {
      opacity: 1,
      blurPx: 0,
      scale: 1.0,
      duration,
      ease: 'power2.out',
      onUpdate: applyCanvaBlurStateToDOMAndPivot,
      onComplete: () => {
        restoreAllCharacterAndSwingMaterials();
        applyCanvaBlurStateToDOMAndPivot();
      }
    });
  }

  /**
   * 2-Phase Blooming Square Frame & 4-Petal Dendro Clover Flowers Outro (`0.75s`)
   * Modeled after `public/outtromodel.jpg`:
   * - Phase 1 (`0.0s -> 0.35s`): Nahida (and swing if sitting) blurs/fades (`blur: 0 -> 14px`, `opacity: 1.0 -> 0.3`),
   *   while `dendroOutroVFXGroup` (glowing dotted square frame + 4-pointed corner starbursts + 4-petal Dendro flowers)
   *   bursts outward from center (`scale: 0.05 -> 1.15`, `ease: "back.out(1.7)"`, `opacity: 0 -> 1.0`) and flowers rotate (`+0.45 rad`).
   * - Phase 2 (`0.35s -> 0.75s`): Nahida fades completely (`opacity: 0.3 -> 0.0`, `blur: 14 -> 20px`),
   *   while the square frame and flowers expand (`scale: 1.15 -> 1.35`) and dissolve (`opacity: 1.0 -> 0.0`, `ease: "power2.out"`).
   */
  function playDendroBloomFrameOutro(duration = 0.75, onCompleteCallback = null) {
    if (activeOutroTimeline) {
      activeOutroTimeline.kill();
      activeOutroTimeline = null;
    }
    gsap.killTweensOf(canvaBlurState);
    if (container) {
      gsap.killTweensOf(container);
      container.style.display = 'block';
      container.style.visibility = 'visible';
    }
    if (renderer && renderer.domElement) {
      gsap.killTweensOf(renderer.domElement);
      renderer.domElement.style.display = 'block';
      renderer.domElement.style.visibility = 'visible';
    }

    characterPivot.visible = true;
    if (loadedModel) {
      loadedModel.visible = true;
    }

    // Position the 3D Dendro Outro VFX Group right around Nahida's current 1.5x world position
    const worldCharHeight = charHeight * CHARACTER_UNIFORM_SCALE;
    const centerY = characterPivot.position.y + worldCharHeight * (isCurtainMode ? 0.44 : 0.48);
    dendroOutroVFXGroup.position.set(
      characterPivot.position.x,
      centerY,
      characterPivot.position.z + 0.42
    );
    dendroOutroVFXGroup.scale.setScalar(0.05 * CHARACTER_UNIFORM_SCALE);
    dendroOutroVFXGroup.visible = true;

    const vfxAnim = {
      scale: 0.05,
      opacity: 0.0,
      flowerSpin: 0.0,
      radialSpread: 0.0
    };

    const syncVFXMaterials = () => {
      const op = THREE.MathUtils.clamp(vfxAnim.opacity, 0, 1);
      canvaBlurState.vfxOpacity = op;
      dendroOutroVFXGroup.scale.setScalar(Math.max(0.01, vfxAnim.scale * CHARACTER_UNIFORM_SCALE));

      const uData = dendroOutroVFXGroup.userData;
      const matsList = uData?.vfxMaterials || uData?.materials;
      if (matsList) {
        for (let i = 0; i < matsList.length; i++) {
          const m = matsList[i];
          const baseOp = m.userData?.baseOpacity !== undefined ? m.userData.baseOpacity : 0.9;
          m.opacity = baseOp * op;
        }
      }
      const flList = uData?.bloomingFlowers || uData?.flowers;
      if (flList) {
        for (let i = 0; i < flList.length; i++) {
          const fl = flList[i];
          const targetObj = fl.mesh || fl;
          const spinDir = i % 2 === 0 ? 1 : -1;
          const bRotZ = fl.baseRotZ ?? fl.userData?.baseRotZ ?? 0;
          const bX = fl.baseX ?? fl.userData?.baseX ?? 0;
          const bY = fl.baseY ?? fl.userData?.baseY ?? 0;
          const dX = fl.radialDirX ?? fl.userData?.driftX ?? 0;
          const dY = fl.radialDirY ?? fl.userData?.driftY ?? 0;
          targetObj.rotation.z = bRotZ + vfxAnim.flowerSpin * spinDir;
          targetObj.position.x = bX + dX * vfxAnim.radialSpread;
          targetObj.position.y = bY + dY * vfxAnim.radialSpread;
        }
      }
      setCharacterModelFadeOpacity(canvaBlurState.opacity);
      if (dendroSwingGroup.visible && dendroSwingGroup.userData.materials) {
        const swMats = dendroSwingGroup.userData.materials;
        for (let i = 0; i < swMats.length; i++) {
          const sm = swMats[i];
          const bOp = sm.userData.baseOpacity !== undefined ? sm.userData.baseOpacity : 0.85;
          sm.opacity = bOp * canvaBlurState.opacity;
        }
      }
      applyCanvaBlurStateToDOMAndPivot();
    };

    syncVFXMaterials();

    const phase1Dur = Math.max(0.20, duration * (0.35 / 0.75));
    const phase2Dur = Math.max(0.20, duration - phase1Dur);

    const tl = gsap.timeline({
      onComplete: () => {
        activeOutroTimeline = null;
        gsap.killTweensOf(canvaBlurState);
        gsap.killTweensOf(vfxAnim);
        if (container) gsap.killTweensOf(container);
        if (renderer && renderer.domElement) gsap.killTweensOf(renderer.domElement);

        dendroOutroVFXGroup.visible = false;
        canvaBlurState.vfxOpacity = 0;
        restoreAllCharacterAndSwingMaterials();

        if (!isCurtainMode && currentSlideId >= 2) {
          characterPivot.visible = false;
          dendroSwingGroup.visible = false;
          poseControl.swingSitWeight = 0;
          curtainShadowGroup.visible = false;
          canvaBlurState.opacity = 0;
          applyCanvaBlurStateToDOMAndPivot();
          if (container) {
            container.style.visibility = 'hidden';
            container.style.zIndex = '35';
          }
        }
        if (typeof onCompleteCallback === 'function') {
          onCompleteCallback();
        }
      }
    });
    activeOutroTimeline = tl;

    // PHASE 1 (0.0s -> 0.35s):
    // Nahida blurs (0px -> 14px) & fades (1.0 -> 0.3) while Square Frame & 4-Petal Flowers bloom (scale 0.05 -> 1.15)
    tl.to(
      canvaBlurState,
      {
        opacity: 0.3,
        blurPx: 14,
        scale: 0.95,
        duration: phase1Dur,
        ease: 'power2.out'
      },
      0.0
    );

    tl.to(
      vfxAnim,
      {
        scale: 1.15,
        opacity: 1.0,
        flowerSpin: 0.45,
        radialSpread: 0.35,
        duration: phase1Dur,
        ease: 'back.out(1.7)',
        onUpdate: syncVFXMaterials
      },
      0.0
    );

    // PHASE 2 (0.35s -> 0.75s):
    // Nahida fades to 0 (blur 20px), Square Frame & Flowers expand (1.15 -> 1.35) and dissolve into space (opacity 1.0 -> 0.0)
    tl.to(
      canvaBlurState,
      {
        opacity: 0.0,
        blurPx: 20,
        scale: 0.90,
        duration: phase2Dur,
        ease: 'power2.inOut'
      },
      phase1Dur
    );

    tl.to(
      vfxAnim,
      {
        scale: 1.35,
        opacity: 0.0,
        flowerSpin: 0.78,
        radialSpread: 1.0,
        duration: phase2Dur,
        ease: 'power2.out',
        onUpdate: syncVFXMaterials
      },
      phase1Dur
    );

    return tl;
  }

  function playModelCanvaBlurOutro(duration = 0.75, onCompleteCallback = null) {
    return playDendroBloomFrameOutro(duration, onCompleteCallback);
  }

  window.playModelCanvaBlurIntro = playModelCanvaBlurIntro;
  window.playModelCanvaBlurOutro = playModelCanvaBlurOutro;
  window.playDendroBloomFrameOutro = playDendroBloomFrameOutro;

  /**
   * ==========================================================================
   * SLIDE VISIBILITY & CANVA BLUR INTRO/OUTRO (`setAssistantSlideState`)
   * ==========================================================================
   */
  function setAssistantSlideState(slideIndex, isCurtainDown = false, options = {}) {
    const slideId = Math.max(
      1,
      Math.min(10, (typeof slideIndex === 'number' ? slideIndex : 0) + 1)
    );
    currentSlideId = slideId;
    isCurtainMode = Boolean(isCurtainDown);

    if (activeChoreoTimeline) {
      activeChoreoTimeline.kill();
      activeChoreoTimeline = null;
    }
    if (activeSpinTimeline) {
      activeSpinTimeline.kill();
      activeSpinTimeline = null;
    }
    if (activeSwingRestoreDelayCall) {
      activeSwingRestoreDelayCall.kill();
      activeSwingRestoreDelayCall = null;
    }

    gsap.killTweensOf(characterPivot.position);
    gsap.killTweensOf(characterPivot.rotation);
    gsap.killTweensOf(poseControl);
    gsap.killTweensOf(spinPhysics);

    isInPlaceSpinning = false;
    interruptIdleDanceAndSpin();
    spinPhysics.anticipationDip = 0;
    spinPhysics.trailFootLift = 0;
    spinPhysics.spottingProgress = 0;
    spinPhysics.centrifugalFactor = 0;
    spinPhysics.angularVelocity = 0;
    spinPhysics.physicsIntensityScale = 1.0;

    if (!isCurtainMode) {
      gsap.to(poseControl, {
        choreoWeight: 0,
        spineChestArchX: 0,
        spineChestTwistY: 0,
        spineChestTiltZ: 0,
        curtainHeadPitchX: 0,
        curtainHeadYawY: 0,
        curtainHeadRollZ: 0,
        leftShoulderShrug: 0,
        leftArmPullRaise: 0,
        leftArmOutwardZ: 0,
        leftElbowFlexArc: 0,
        leftWristExtension: 0,
        leftFingerGrip: 0,
        rightArmCounterPitchX: 0,
        rightArmCounterFlareZ: 0,
        hoverFootPoint: 0,
        pullKneeBounce: 0,
        duration: 0.45,
        ease: 'power2.out'
      });

      if (slideId === 1) {
        dendroSwingGroup.visible = false;
        poseControl.swingSitWeight = 0;
        if (container) {
          container.style.zIndex = '35';
        }
        const safeZone = getSafeZoneForSlide(1);
        const baseYaw = safeZone.lookDir < 0 ? -0.14 : 0.16;
        nextSpinTime = prevElapsed + 7.5;

        isPerformingCurtainAction = false;
        curtainShadowGroup.visible = false;
        characterPivot.position.set(safeZone.x, safeZone.y, safeZone.z);
        characterPivot.rotation.set(0, baseYaw, 0);
        spinPhysics.prevRotationY = baseYaw;

        idleScheduler.baseStandX = safeZone.x;
        idleScheduler.baseStandY = safeZone.y;
        idleScheduler.baseStandZ = safeZone.z;
        idleScheduler.baseStandYaw = baseYaw;
        idleScheduler.completedCycleCount = 0;
        idleScheduler.mode = 'FBX_MOTION_MODE';
        idleScheduler.modeStartTime = prevElapsed;

        fbxRetargetState.activeSlotIndex = fbxRetargetState.motion1.isReady
          ? 1
          : fbxRetargetState.motion2.isReady
            ? 2
            : 3;
        fbxRetargetState.nextSlotIndex = fbxRetargetState.motion2.isReady
          ? 2
          : fbxRetargetState.motion3.isReady
            ? 3
            : 1;
        fbxRetargetState.sequenceStage =
          fbxRetargetState.activeSlotIndex === 1
            ? 'STAGE_MOTION_1'
            : fbxRetargetState.activeSlotIndex === 2
              ? 'STAGE_MOTION_2'
              : 'STAGE_MOTION_3';
        fbxRetargetState.bridgeTimer = 0.0;
        fbxRetargetState.bridgeMotionFactor = 1.0;
        fbxRetargetState.lastFrameArmQuats.clear();
        fbxRetargetState.hasLastFrameArmQuats = false;
        fbxRetargetState.motion1.currentClipTime = fbxRetargetState.motion1.clipStartTime;
        fbxRetargetState.motion2.currentClipTime = fbxRetargetState.motion2.clipStartTime;
        fbxRetargetState.motion3.currentClipTime = fbxRetargetState.motion3.clipStartTime;
        fbxRetargetState.targetBlendWeight = 1.0;
        fbxRetargetState.blendSpeed = 1.0 / 0.35;
        gsap.killTweensOf(fbxRetargetState);
        gsap.to(fbxRetargetState, {
          motionBlendWeight: 1.0,
          duration: 0.40,
          ease: 'power2.inOut'
        });

        playModelCanvaBlurIntro(0.65);
      } else {
        isPerformingCurtainAction = false;
        if (characterPivot.visible && canvaBlurState.opacity > 0.02) {
          playDendroBloomFrameOutro(0.75);
        } else {
          characterPivot.visible = false;
          dendroSwingGroup.visible = false;
          poseControl.swingSitWeight = 0;
          dendroOutroVFXGroup.visible = false;
          curtainShadowGroup.visible = false;
          canvaBlurState.opacity = 0;
          canvaBlurState.blurPx = 20;
          canvaBlurState.scale = 0.92;
          canvaBlurState.vfxOpacity = 0;
          applyCanvaBlurStateToDOMAndPivot();
          if (container) {
            container.style.zIndex = '35';
          }
        }
      }
    } else {
      // When `isCurtainMode === true`, strictly keep Nahida and the Dendro Swing visible!
      characterPivot.visible = true;
      if (loadedModel) loadedModel.visible = true;
      if (dendroSwingGroup && !isPerformingCurtainAction) {
        dendroSwingGroup.visible = true;
      }
    }
  }

  /**
   * ==========================================================================
   * SHARED PER-FRAME & SITTING POSE HELPERS (`rotateLimbToWorldDirection` & `applyNahidaSwingSittingPose`)
   * Defined at top-level scope inside `createAssistant3DSystem` so `applyNahidaSwingSittingPose`
   * can be invoked both on Frame 0 inside `playDendroBloomFrameOutro`'s `onComplete` callback
   * AND on every frame inside `update(dt)`!
   * ==========================================================================
   */
  function rotateLimbToWorldDirection(
    bone,
    childBone,
    bindLocalQuat,
    targetWorldDir,
    blendWeight = 1.0
  ) {
    if (!bone || !childBone || !bone.parent || !targetWorldDir) return;
    const prevQuat = bone.quaternion.clone();
    if (bindLocalQuat) {
      bone.quaternion.copy(bindLocalQuat);
    }
    bone.updateMatrixWorld(true);

    bone.getWorldPosition(_alignTgtStart);
    childBone.getWorldPosition(_alignTgtEnd);
    _alignCurrentDir.subVectors(_alignTgtEnd, _alignTgtStart);
    if (_alignCurrentDir.lengthSq() < 1e-6) return;
    _alignCurrentDir.normalize();

    _alignDesiredDir.copy(targetWorldDir).normalize();
    _alignWorldSwingQuat.setFromUnitVectors(_alignCurrentDir, _alignDesiredDir);

    bone.getWorldQuaternion(_alignBoneWorldQuat);
    bone.parent.getWorldQuaternion(_alignParentWorldQuatInv).invert();

    _alignTargetLocalQuat
      .copy(_alignParentWorldQuatInv)
      .multiply(_alignWorldSwingQuat)
      .multiply(_alignBoneWorldQuat);

    ensureShortestPathQuat(prevQuat, _alignTargetLocalQuat);
    if (blendWeight >= 0.999) {
      bone.quaternion.copy(_alignTargetLocalQuat);
    } else {
      bone.quaternion.copy(prevQuat).slerp(_alignTargetLocalQuat, blendWeight);
    }
    bone.updateMatrixWorld(true);
  }

  const alignBoneToWorldDirection = rotateLimbToWorldDirection;

  /**
   * ==========================================================================
   * HOTFIX V29 SECTION 2: NAHIDA SITTING POSE ON HOLLOW DENDRO CLOVER SWING
   * (`applyNahidaSwingSittingPose`)
   * 1. Completely bypasses standing FBX retargeter (`change-pose` / `magespellcast`).
   * 2. Both Arms & Fingers stay in their Natural Relaxed Pose (`relaxedQuat` with gentle
   *    breathing sway at her sides/lap, soft finger curl — NO rope-gripping!).
   * 3. Pelvis, Thighs (`leftThigh -> leftCalf`, `rightThigh -> rightCalf`) & Calves
   *    (`leftCalf -> leftFoot`, `rightCalf -> rightFoot`) are rotated via `alignBoneToWorldDirection`
   *    into a true ~82° sitting pose on the hollow rectangular box seat (`y ≈ 0.42 * charHeight`),
   *    with calves hanging straight down (`-Y`) and swinging gently in alternating phase,
   *    plus a 100% guaranteed Lower-Body Bone Subtree Fallback!
   * ==========================================================================
   */
  function applyNahidaSwingSittingPose(time = prevElapsed, frameDt = 0.016, sitW = 1.0) {
    characterPivot.visible = true;
    dendroSwingGroup.visible = true;
    if (!loadedModel) return;
    loadedModel.visible = true;
    loadedModel.rotation.set(0, 0, 0);

    const effSitW = Number.isFinite(sitW) && sitW > 0.001 ? sitW : 1.0;
    const rFlareSignZ = -solvedSigns.rightArmAdductZ;
    const lFlareSignZ = -solvedSigns.leftArmAdductZ;
    const breathWave = Math.sin(time * 2.1);

    characterPivot.updateMatrixWorld(true);
    characterPivot.getWorldQuaternion(tempPivotWorldQuat);

    // HOTFIX V34: Lift Nahida's sitting local Y so her buttocks & thighs rest cleanly
    // ON TOP OF the top surface of the hollow rectangular swing box!
    loadedModel.position.copy(baseModelLocalPos);
    loadedModel.position.y += 0.065 * effSitW;
    loadedModel.updateMatrixWorld(true);

    // ------------------------------------------------------------------------
    // 1. PELVIS / HIPS: Keep upright (`0` pitch) so Back Cape / Skirt bones attached
    //    to `hips` NEVER tilt backward or flip normals when sitting on the swing!
    // ------------------------------------------------------------------------
    if (riggedBones.hips) {
      applyBoneWorldYPZ(
        riggedBones.hips,
        0,
        0,
        Math.sin(time * 0.85) * 0.012 * effSitW
      );
      riggedBones.hips.bone.updateMatrixWorld(true);
    }

    // ------------------------------------------------------------------------
    // 2. BOTH ARMS & FINGERS: NATURAL RELAXED POSE AT SIDES/LAP (NO ROPE-GRIPPING!)
    //    Shoulders (`Clavicle`), UpperArms, ForeArms, Wrists, and Fingers rest naturally
    //    alongside her body/thighs with soft breathing motion.
    // ------------------------------------------------------------------------
    const armBreathPitch = Math.sin(time * 2.1 - 0.55) * 0.032;
    const armBreathRoll = Math.sin(time * 2.1 - 0.35) * 0.020 + 0.014;
    const foreArmBreathPitch = Math.sin(time * 2.1 - 1.15) * 0.034;
    const wristBreathRoll = Math.sin(time * 2.1 - 1.65) * 0.028;

    if (riggedBones.rightShoulder) {
      applyBoneWorldYPZ(
        riggedBones.rightShoulder,
        0,
        breathWave * 0.014,
        rFlareSignZ * Math.max(0, breathWave) * 0.016
      );
    }
    if (riggedBones.leftShoulder) {
      applyBoneWorldYPZ(
        riggedBones.leftShoulder,
        0,
        breathWave * 0.014,
        lFlareSignZ * Math.max(0, breathWave) * 0.016
      );
    }

    if (riggedBones.rightArm) {
      applyBoneWorldYPZ(
        riggedBones.rightArm,
        0,
        armBreathPitch,
        rFlareSignZ * armBreathRoll
      );
    }
    if (riggedBones.leftArm) {
      applyBoneWorldYPZ(
        riggedBones.leftArm,
        0,
        -armBreathPitch,
        lFlareSignZ * armBreathRoll
      );
    }

    if (riggedBones.rightElbow) {
      applyBoneWorldYPZ(riggedBones.rightElbow, 0, foreArmBreathPitch, 0);
    }
    if (riggedBones.leftElbow) {
      applyBoneWorldYPZ(riggedBones.leftElbow, 0, -foreArmBreathPitch, 0);
    }

    if (riggedBones.rightWrist) {
      applyBoneWorldYPZ(
        riggedBones.rightWrist,
        0,
        Math.sin(time * 2.1 - 1.4) * 0.022,
        rFlareSignZ * wristBreathRoll
      );
    }
    if (riggedBones.leftWrist) {
      applyBoneWorldYPZ(
        riggedBones.leftWrist,
        0,
        Math.sin(time * 2.1 - 1.4) * 0.022,
        lFlareSignZ * wristBreathRoll
      );
    }

    // Soft natural stair-step finger curl (`fb.baseCurlAngle`)
    for (let i = 0; i < riggedBones.fingerBones.length; i++) {
      const fb = riggedBones.fingerBones[i];
      const microFlex = Math.sin(time * 2.1 + fb.phaseOffset) * 0.028;
      fb.bone.quaternion.copy(fb.restQuat);
      fb.bone.rotateOnAxis(fb.curlAxisVec, Math.max(0.04, fb.baseCurlAngle + microFlex));
    }

    // ------------------------------------------------------------------------
    // 3. BOTH THIGHS, CALVES & FEET: TRUE SITTING POSE ON TOP OF HOLLOW BOX SEAT
    //    - Thighs (`leftThigh -> leftCalf`, `rightThigh -> rightCalf`):
    //      Bent forward (`+Z`) horizontally (`y = -0.05`) so the underside of both thighs
    //      rests flat on the top surface of the hollow box seat without dipping inside it!
    //    - Calves (`leftCalf -> leftFoot`, `rightCalf -> rightFoot`):
    //      Hanging straight down (`-Y`) below the front edge of the hollow box seat:
    //      `swingKick = Math.sin(time * 2.5) * 0.18`
    //      `targetLeftCalfDir = (0.02, -0.96, -0.15 + swingKick).normalize()`
    //      `targetRightCalfDir = (-0.02, -0.96, -0.15 - swingKick).normalize()`
    // ------------------------------------------------------------------------
    const targetLeftThighDir = new THREE.Vector3(0.05, -0.05, 0.99)
      .normalize()
      .applyQuaternion(tempPivotWorldQuat)
      .normalize();
    const targetRightThighDir = new THREE.Vector3(-0.05, -0.05, 0.99)
      .normalize()
      .applyQuaternion(tempPivotWorldQuat)
      .normalize();

    const swingKick = Math.sin(time * 2.5) * 0.18;
    const targetLeftCalfDir = new THREE.Vector3(0.02, -0.96, -0.15 + swingKick)
      .normalize()
      .applyQuaternion(tempPivotWorldQuat)
      .normalize();
    const targetRightCalfDir = new THREE.Vector3(-0.02, -0.96, -0.15 - swingKick)
      .normalize()
      .applyQuaternion(tempPivotWorldQuat)
      .normalize();

    const lThighEntry = riggedBones.leftThigh || riggedBones.leftLeg;
    const rThighEntry = riggedBones.rightThigh || riggedBones.rightLeg;
    const lCalfEntry = riggedBones.leftCalf || riggedBones.leftKnee;
    const rCalfEntry = riggedBones.rightCalf || riggedBones.rightKnee;
    const lFootEntry = riggedBones.leftFoot;
    const rFootEntry = riggedBones.rightFoot;

    if (lThighEntry?.bone) {
      const lCalfNode = lCalfEntry?.bone || getPrimaryChildBone(lThighEntry.bone);
      if (lCalfNode) {
        alignBoneToWorldDirection(
          lThighEntry.bone,
          lCalfNode,
          lThighEntry.restQuat,
          targetLeftThighDir,
          effSitW
        );
      }
    }
    if (rThighEntry?.bone) {
      const rCalfNode = rCalfEntry?.bone || getPrimaryChildBone(rThighEntry.bone);
      if (rCalfNode) {
        alignBoneToWorldDirection(
          rThighEntry.bone,
          rCalfNode,
          rThighEntry.restQuat,
          targetRightThighDir,
          effSitW
        );
      }
    }

    if (lCalfEntry?.bone) {
      const lFootNode = lFootEntry?.bone || getPrimaryChildBone(lCalfEntry.bone);
      if (lFootNode) {
        alignBoneToWorldDirection(
          lCalfEntry.bone,
          lFootNode,
          lCalfEntry.restQuat,
          targetLeftCalfDir,
          effSitW
        );
      }
    }
    if (rCalfEntry?.bone) {
      const rFootNode = rFootEntry?.bone || getPrimaryChildBone(rCalfEntry.bone);
      if (rFootNode) {
        alignBoneToWorldDirection(
          rCalfEntry.bone,
          rFootNode,
          rCalfEntry.restQuat,
          targetRightCalfDir,
          effSitW
        );
      }
    }

    // Both Feet (`leftFoot` & `rightFoot`): Softly pointed downward in mid-air
    if (lFootEntry) {
      applyBoneWorldYPZ(
        lFootEntry,
        0,
        (0.32 + swingKick * 0.22) * effSitW * solvedSigns.leftKneeBendX,
        0
      );
    }
    if (rFootEntry) {
      applyBoneWorldYPZ(
        rFootEntry,
        0,
        (0.32 - swingKick * 0.22) * effSitW * solvedSigns.rightKneeBendX,
        0
      );
    }

    loadedModel.updateMatrixWorld(true);

    // ------------------------------------------------------------------------
    // 4. 100% GUARANTEED LOWER-BODY BONE SUBTREE SITTING FALLBACK (V30/V32):
    //    Check `leftFoot.getWorldPosition().y` vs `hipsBone.getWorldPosition().y`.
    //    Rotate lower-body child bones under `hipsBone` (excluding back `z < -0.02` cape bones)
    //    into the sitting pose!
    // ------------------------------------------------------------------------
    let primaryLegsLifted = false;
    const hipsNode = riggedBones.hips?.bone;
    const footCheckNode = lFootEntry?.bone || lCalfEntry?.bone;
    if (hipsNode && footCheckNode) {
      hipsNode.getWorldPosition(_alignSrcStart);
      footCheckNode.getWorldPosition(_alignSrcEnd);
      const pivotScaleY = Math.max(0.5, characterPivot.scale.y || 1.0);
      const verticalDrop = (_alignSrcStart.y - _alignSrcEnd.y) / pivotScaleY;
      if (verticalDrop < hipHeight * 0.72) {
        primaryLegsLifted = true;
      }
    }

    if (legFallbackMeshes.length > 0) {
      for (let i = 0; i < legFallbackMeshes.length; i++) {
        const fbItem = legFallbackMeshes[i];
        if (!fbItem.bone || !fbItem.childBone) continue;
        if (fbItem.isPrimaryLegBone && primaryLegsLifted) continue;

        if (fbItem.isThighLevel) {
          alignBoneToWorldDirection(
            fbItem.bone,
            fbItem.childBone,
            fbItem.restQuat,
            fbItem.isLeftSide ? targetLeftThighDir : targetRightThighDir,
            effSitW
          );
        } else if (fbItem.isCalfLevel) {
          alignBoneToWorldDirection(
            fbItem.bone,
            fbItem.childBone,
            fbItem.restQuat,
            fbItem.isLeftSide ? targetLeftCalfDir : targetRightCalfDir,
            effSitW
          );
        }
      }
      loadedModel.updateMatrixWorld(true);
    }

    // ------------------------------------------------------------------------
    // 5. POSITION HOLLOW EDGE-ONLY RECTANGULAR BOX SEAT DIRECTLY UNDER NAHIDA'S THIGHS
    //    (HOTFIX V34: `seatTopY = thighBottomY ≈ hipsLocalY - 0.135`, `seatCenterY = seatTopY - seatBoxH * 0.5`
    //     so Nahida sits ON TOP OF the top surface of the hollow box seat, NEVER sinking inside it!)
    //    AND KEEP TWIN VERTICAL LIGHT BEAMS SYMMETRICAL AT `x = -0.34` & `x = +0.34`!
    // ------------------------------------------------------------------------
    const swData = dendroSwingGroup.userData;
    if (swData && swData.seatGroup && swData.leftRopeGroup && swData.rightRopeGroup) {
      let hipsLocalY = 0.44 * charHeight;
      let hipsLocalZ = 0.0;
      if (riggedBones.hips?.bone) {
        riggedBones.hips.bone.getWorldPosition(tempBoneWp);
        dendroSwingGroup.worldToLocal(tempBoneWp);
        hipsLocalY = THREE.MathUtils.clamp(
          tempBoneWp.y,
          0.39 * charHeight,
          0.56 * charHeight
        );
        hipsLocalZ = THREE.MathUtils.clamp(tempBoneWp.z, -0.12, 0.15);
      }

      let kneeLocalY = hipsLocalY - 0.085;
      const kneeMeasureNode = lCalfEntry?.bone || rCalfEntry?.bone;
      if (kneeMeasureNode) {
        kneeMeasureNode.getWorldPosition(tempBoneWp);
        dendroSwingGroup.worldToLocal(tempBoneWp);
        kneeLocalY = tempBoneWp.y;
      }

      const seatBoxH = swData.seatH || 0.12;
      // Place top surface of the hollow box right at `thighBottomY` (below buttocks & bent thighs)
      const thighBottomY = Math.min(hipsLocalY - 0.135, kneeLocalY - 0.052);
      const seatTopY = thighBottomY;
      const seatCenterY = seatTopY - seatBoxH * 0.5;
      const seatCenterZ = hipsLocalZ + 0.07;

      swData.seatGroup.position.set(0, seatCenterY, seatCenterZ);
      swData.seatGroup.scale.set(1.0, 1.0, 1.0);

      swData.leftRopeGroup.position.set(0.34, seatCenterY, seatCenterZ);
      swData.rightRopeGroup.position.set(-0.34, seatCenterY, seatCenterZ);

      if (swData.clovers) {
        for (let i = 0; i < swData.clovers.length; i++) {
          const cl = swData.clovers[i];
          const pulse = 1.0 + Math.sin(time * 3.0 + i * 1.1) * 0.14;
          cl.scale.setScalar(pulse);
          cl.rotation.z =
            (cl.userData?.baseRotZ || 0) + Math.sin(time * 1.8 + i) * 0.15;
        }
      }
      if (swData.leaves) {
        for (let i = 0; i < swData.leaves.length; i++) {
          const lf = swData.leaves[i];
          const pulse = 1.0 + Math.sin(time * 2.6 + i * 0.7) * 0.12;
          lf.scale.setScalar(pulse);
        }
      }
    }
  }

  /**
   * ==========================================================================
   * SECTION 4: 7-JOINT FULL-BODY KINEMATIC CURTAIN PULL (`triggerCamellyaPullCurtain`)
   * Followed by Seamless Transition to Sitting on the 3D Dendro Clover Swing!
   * (UPDATE V38 SECTION 4: BULLETPROOF STATE RESET & SMOOTH POSE TRANSITION)
   * ==========================================================================
   */
  const curtainPullEntryState = {
    active: false,
    elapsed: 0.0,
    duration: 0.35,
    entryBoneQuats: new Map()
  };

  function triggerCamellyaPullCurtain(targetSlideIndex, callbacks = {}) {
    const slideId = Math.max(2, Math.min(10, targetSlideIndex + 1));

    // UPDATE V38 SECTION 4: Bulletproof State Reset before Curtain Pull!
    enforceBulletproofNahidaStateGuard();
    captureCurrentSkeletonSnapshot(curtainPullEntryState.entryBoneQuats);
    curtainPullEntryState.active = true;
    curtainPullEntryState.elapsed = 0.0;
    curtainPullEntryState.duration = 0.35;

    aerialCurtainFlightState.initialized = false;
    aerialCurtainFlightState.vx = 0.0;
    aerialCurtainFlightState.vy = 0.0;
    aerialCurtainFlightState.ay = 0.0;
    aerialCurtainFlightState.pendulumAngleX = 0.0;
    aerialCurtainFlightState.pendulumVelX = 0.0;
    aerialCurtainFlightState.pendulumRollZ = 0.0;
    aerialCurtainFlightState.pendulumVelZ = 0.0;

    const isFromSlide1 =
      (callbacks.fromSlideIndex === 0 || targetSlideIndex === 1 || currentSlideId === 1) &&
      characterPivot.visible;

    currentSlideId = slideId;
    isCurtainMode = true;
    isPerformingCurtainAction = true;
    isInPlaceSpinning = false;
    spinStageState.active = false;
    interruptIdleDanceAndSpin(0.15);

    // Immediately stop Slide 01 Sequence Controller (`change-pose-379001` / `Excited.fbx` / `Spin`)
    fbxRetargetState.targetBlendWeight = 0.0;
    fbxRetargetState.motionBlendWeight = 0.0;
    fbxRetargetState.bridgeMotionFactor = 0.0;
    fbxRetargetState.spellCastFingerOpenFactor = 0.0;
    gsap.killTweensOf(fbxRetargetState);

    characterPivot.visible = true;
    characterPivot.scale.setScalar(CHARACTER_UNIFORM_SCALE);
    if (loadedModel) {
      loadedModel.visible = true;
      loadedModel.position.copy(baseModelLocalPos);
      loadedModel.rotation.set(0, 0, 0);
      loadedModel.traverse((child) => {
        if (child.isMesh || child.isSkinnedMesh) {
          if (child.userData && child.userData.isHiddenOutline) {
            child.visible = false;
          } else {
            child.visible = true;
            child.frustumCulled = false;
          }
        }
      });
    }

    if (activeChoreoTimeline) {
      activeChoreoTimeline.kill();
      activeChoreoTimeline = null;
    }
    if (activeSpinTimeline) {
      activeSpinTimeline.kill();
      activeSpinTimeline = null;
    }
    if (activeSwingRestoreDelayCall) {
      activeSwingRestoreDelayCall.kill();
      activeSwingRestoreDelayCall = null;
    }

    gsap.killTweensOf(characterPivot.position);
    gsap.killTweensOf(characterPivot.rotation);
    gsap.killTweensOf(poseControl);
    gsap.killTweensOf(spinPhysics);

    spinPhysics.anticipationDip = 0;
    spinPhysics.trailFootLift = 0;
    spinPhysics.spottingProgress = 0;
    spinPhysics.centrifugalFactor = 0;
    spinPhysics.angularVelocity = 0;
    spinPhysics.physicsIntensityScale = 0.35;

    if (container) {
      container.style.zIndex = '935';
      container.style.display = 'block';
      container.style.visibility = 'visible';
    }

    // No rising particle dots during curtain pull (removed 100% per V24 spec)
    dendroSwingGroup.visible = false;
    curtainShadowGroup.visible = true;

    const targetZ = 0.0;
    const distanceToCam = camera.position.z - targetZ;
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const visibleHeight = 2 * Math.tan(vFov / 2) * distanceToCam;
    const visibleWidth = visibleHeight * (camera.aspect || 1.7778);
    const screenTopY = camera.position.y + visibleHeight / 2;
    const worldCharHeight = charHeight * CHARACTER_UNIFORM_SCALE;

    const pullStartFootY = screenTopY - worldCharHeight - visibleHeight * 0.08;
    const startCenterFootY = pullStartFootY - visibleHeight * 0.12;
    // Calibrated 1.5x right-side coordinates (`safeRightX ≈ 3.50`, `safeRightY = -1.58`)
    // centered in the open column (`68vw..100vw`) to the right of `.curtain-qa-stage`!
    const safeRightX = THREE.MathUtils.clamp(visibleWidth * 0.248, 3.25, 3.85);
    const safeRightY = -1.58;

    const pullCenterPivotX = leftHandCurtainOffsetX * CHARACTER_UNIFORM_SCALE;

    poseControl.choreoWeight = 1;
    poseControl.swingSitWeight = 0;
    poseControl.spineChestArchX = 0;
    poseControl.spineChestTwistY = 0;
    poseControl.spineChestTiltZ = 0;
    poseControl.curtainHeadPitchX = 0;
    poseControl.curtainHeadYawY = 0;
    poseControl.curtainHeadRollZ = 0;
    poseControl.leftShoulderShrug = 0;
    poseControl.leftArmPullRaise = 0;
    poseControl.leftArmOutwardZ = 0;
    poseControl.leftElbowFlexArc = 0;
    poseControl.leftWristExtension = 0;
    poseControl.leftFingerGrip = 0;
    poseControl.rightArmCounterPitchX = 0;
    poseControl.rightArmCounterFlareZ = 0;
    poseControl.hoverFootPoint = 0;
    poseControl.pullKneeBounce = 0;

    const tl = gsap.timeline();
    activeChoreoTimeline = tl;

    const reachStartOffset = isFromSlide1 ? 0.08 : 0.15;
    const reachDuration = isFromSlide1 ? 1.04 : 0.96;

    if (isFromSlide1) {
      // CASE 1 (FROM SLIDE 1 -> SLIDE 2 CURTAIN):
      // Direct diagonal flight from Slide 1 standing position (`x = -2.35, y = -3.28`)
      gsap.killTweensOf(canvaBlurState);
      dendroOutroVFXGroup.visible = false;
      canvaBlurState.vfxOpacity = 0;
      setCharacterModelFadeOpacity(1.0);
      characterPivot.visible = true;
      canvaBlurState.opacity = 1;
      canvaBlurState.blurPx = 0;
      canvaBlurState.scale = 1.0;
      applyCanvaBlurStateToDOMAndPivot();

      const slide1Zone = getSafeZoneForSlide(1);
      const startX = Number.isFinite(characterPivot.position.x)
        ? characterPivot.position.x
        : slide1Zone.x;
      const startY = Number.isFinite(characterPivot.position.y)
        ? characterPivot.position.y
        : slide1Zone.y;
      const startZ = Number.isFinite(characterPivot.position.z)
        ? characterPivot.position.z
        : slide1Zone.z;

      const rawRotY = Number.isFinite(characterPivot.rotation.y)
        ? characterPivot.rotation.y
        : 0.16;
      let startYaw = rawRotY % (Math.PI * 2);
      if (startYaw > Math.PI) startYaw -= Math.PI * 2;
      if (startYaw < -Math.PI) startYaw += Math.PI * 2;
      characterPivot.rotation.set(0.0, startYaw, 0.0);
      spinPhysics.prevRotationY = startYaw;

      const diagFlight = { t: 0 };
      const diagStart = new THREE.Vector3(startX, startY, startZ);
      const diagControl = new THREE.Vector3(
        startX * 0.42 + pullCenterPivotX * 0.58,
        startY * 0.25 + pullStartFootY * 0.75 + 0.18,
        targetZ + 0.14
      );
      const diagEnd = new THREE.Vector3(pullCenterPivotX, pullStartFootY, targetZ);

      tl.to(
        diagFlight,
        {
          t: 1,
          duration: 1.12,
          ease: 'power2.inOut',
          onUpdate: () => {
            const u = diagFlight.t;
            const inv = 1 - u;
            characterPivot.position.x =
              inv * inv * diagStart.x +
              2 * inv * u * diagControl.x +
              u * u * diagEnd.x;
            characterPivot.position.y =
              inv * inv * diagStart.y +
              2 * inv * u * diagControl.y +
              u * u * diagEnd.y;
            characterPivot.position.z =
              inv * inv * diagStart.z +
              2 * inv * u * diagControl.z +
              u * u * diagEnd.z;
          }
        },
        0.0
      );

      tl.to(
        characterPivot.rotation,
        {
          x: 0.0,
          y: Math.PI,
          z: 0.0,
          duration: 1.08,
          ease: 'sine.inOut'
        },
        0.04
      );
    } else {
      // CASE 2 (FROM SLIDES 2..9 -> NEXT CURTAIN):
      // Materialize at Center (`x = 0`) using Canva Blur-Fade Intro, then levitate up while spinning 180°
      characterPivot.position.set(0.0, startCenterFootY, targetZ);
      characterPivot.rotation.set(0.0, 0.0, 0.0);
      spinPhysics.prevRotationY = 0.0;

      playModelCanvaBlurIntro(0.65);

      tl.to(
        characterPivot.position,
        {
          x: pullCenterPivotX,
          y: pullStartFootY,
          z: targetZ,
          duration: 0.96,
          ease: 'sine.inOut'
        },
        0.15
      );

      tl.to(
        characterPivot.rotation,
        {
          x: 0.0,
          y: Math.PI,
          z: 0.0,
          duration: 0.96,
          ease: 'sine.inOut'
        },
        0.15
      );
    }

    // ========================================================================
    // PHASE 1: REACH UP PHASE (7-JOINT FULL-BODY KINEMATIC COORDINATION)
    // ========================================================================
    tl.to(
      poseControl,
      {
        spineChestArchX: -0.14,
        spineChestTwistY: 0.18,
        spineChestTiltZ: -0.10,
        curtainHeadPitchX: -0.25,
        curtainHeadYawY: 0.15,
        curtainHeadRollZ: -0.05,
        leftShoulderShrug: 0.22,
        leftArmPullRaise: 1.0,
        leftArmOutwardZ: 0.26,
        leftElbowFlexArc: 0.49,
        leftWristExtension: -0.18,
        leftFingerGrip: 0.28,
        rightArmCounterPitchX: 0.16,
        rightArmCounterFlareZ: 0.14,
        hoverFootPoint: 0.20,
        pullKneeBounce: 0.08,
        duration: reachDuration,
        ease: 'sine.inOut'
      },
      reachStartOffset
    );

    // ========================================================================
    // PHASE 2 (1.15s -> 2.00s): PULL DOWN STROKE (WITH PHYSICAL WEIGHT & FORCE)
    // ========================================================================
    tl.call(
      () => {
        if (typeof callbacks.onCurtainDropStart === 'function') {
          callbacks.onCurtainDropStart();
        }
      },
      null,
      1.15
    );

    tl.to(
      poseControl,
      {
        spineChestArchX: 0.12,
        spineChestTwistY: 0.04,
        spineChestTiltZ: 0.03,
        curtainHeadPitchX: 0.10,
        curtainHeadYawY: 0.04,
        curtainHeadRollZ: 0.0,
        leftElbowFlexArc: 0.52,
        pullKneeBounce: 0.21,
        duration: 0.40,
        ease: 'power2.out'
      },
      1.15
    );

    tl.to(
      poseControl,
      {
        spineChestArchX: 0.0,
        spineChestTwistY: 0.0,
        spineChestTiltZ: 0.0,
        curtainHeadPitchX: 0.0,
        curtainHeadYawY: 0.0,
        curtainHeadRollZ: 0.0,
        leftElbowFlexArc: 0.0,
        rightArmCounterPitchX: 0.0,
        rightArmCounterFlareZ: 0.0,
        hoverFootPoint: 0.0,
        pullKneeBounce: 0.0,
        duration: 0.45,
        ease: 'sine.inOut'
      },
      1.55
    );

    tl.to(
      poseControl,
      {
        leftArmPullRaise: 0.0,
        leftArmOutwardZ: 0.0,
        leftShoulderShrug: 0.0,
        leftWristExtension: 0.0,
        leftFingerGrip: 0.0,
        duration: 0.85,
        ease: 'power2.inOut'
      },
      1.15
    );

    tl.to(
      characterPivot.position,
      {
        y: pullStartFootY - visibleHeight * 0.055,
        duration: 0.75,
        ease: 'sine.inOut'
      },
      1.15
    );

    // ========================================================================
    // PHASE 3 (HOTFIX V29 SECTION 3 - AT 2.00s):
    // Right when Left Hand finishes pulling the curtain down at `2.00s`:
    // 1. Run `playDendroBloomFrameOutro(0.55, spawnSittingOnSwingAtRightSide)` in place at center (`x = 0`).
    // 2. When the 0.55s Outro finishes (at ~2.55s), execute `spawnSittingOnSwingAtRightSide()`!
    // ========================================================================
    tl.call(
      () => {
        dendroSwingGroup.visible = false;
        poseControl.swingSitWeight = 0;

        if (typeof callbacks.onShowQuestion === 'function') {
          callbacks.onShowQuestion();
        }

        const outroDuration = 0.55;
        let hasSpawnedSwing = false;

        function spawnSittingOnSwingAtRightSide() {
          if (hasSpawnedSwing) return;
          hasSpawnedSwing = true;

          if (activeSwingRestoreDelayCall) {
            activeSwingRestoreDelayCall.kill();
            activeSwingRestoreDelayCall = null;
          }

          if (!isCurtainMode || currentSlideId < 2) return;

          // 1. Kill any lingering Outro tweens so nothing overwrites position/opacity
          gsap.killTweensOf(characterPivot.position);
          gsap.killTweensOf(characterPivot.rotation);
          gsap.killTweensOf(canvaBlurState);

          // 2. Activate Swing Sitting State & Force Visibility on all 3D groups + DOM canvas
          isPerformingCurtainAction = false;
          poseControl.choreoWeight = 0;
          poseControl.swingSitWeight = 1.0;

          characterPivot.visible = true;
          if (loadedModel) {
            loadedModel.visible = true;
            loadedModel.rotation.set(0, 0, 0);
          }
          if (dendroSwingGroup) {
            dendroSwingGroup.visible = true;
          }
          if (container) {
            container.style.display = 'block';
            container.style.visibility = 'visible';
            container.style.zIndex = '935';
          }
          if (renderer && renderer.domElement) {
            renderer.domElement.style.display = 'block';
            renderer.domElement.style.visibility = 'visible';
          }

          // 3. Place at safe right-side coordinates (`safeRightX = 2.55, safeRightY = -0.45`)
          //    facing straight toward the audience (`+Z`)
          characterPivot.position.set(safeRightX, safeRightY, 0);
          characterPivot.rotation.set(0, 0, 0);
          spinPhysics.prevRotationY = 0.0;
          spinPhysics.postSpinStopTime = prevElapsed;

          idleScheduler.baseStandX = safeRightX;
          idleScheduler.baseStandY = safeRightY;
          idleScheduler.baseStandZ = 0;
          idleScheduler.baseStandYaw = 0.0;
          idleScheduler.completedCycleCount = 0;
          idleScheduler.mode = 'SWING_SIT_MODE';
          idleScheduler.modeStartTime = prevElapsed;

          fbxRetargetState.targetBlendWeight = 0.0;
          fbxRetargetState.motionBlendWeight = 0.0;
          gsap.killTweensOf(fbxRetargetState);

          // 4. Restore 100% opacity across all meshes of Nahida & the Dendro Swing
          characterPivot.traverse((child) => {
            if (child.isMesh && child.material) {
              if (child.userData && child.userData.isHiddenOutline) {
                child.visible = false;
                return;
              }
              child.visible = true;
              const mats = Array.isArray(child.material) ? child.material : [child.material];
              mats.forEach((m) => {
                if (!m) return;
                if (m.userData && m.userData.baseOpacity !== undefined) {
                  m.opacity = m.userData.baseOpacity;
                } else {
                  m.opacity = 1.0;
                }
              });
            }
          });
          restoreAllCharacterAndSwingMaterials();

          // 5. Immediately apply the sitting pose on Frame 0 and run the Canva Blur Intro (`0.6s`)
          applyNahidaSwingSittingPose(prevElapsed, 0.016, 1.0);
          applyNaturalSkirtSurfaceArmContactSliding(0.016);
          updateRealtimeNahidaClothCompression();
          playModelCanvaBlurIntro(0.6);
        }

        playDendroBloomFrameOutro(outroDuration, spawnSittingOnSwingAtRightSide);
        activeSwingRestoreDelayCall = gsap.delayedCall(
          outroDuration + 0.05,
          spawnSittingOnSwingAtRightSide
        );
      },
      null,
      2.0
    );

    return tl;
  }

  /**
   * ==========================================================================
   * PER-FRAME UPDATE (`requestAnimationFrame`)
   * ==========================================================================
   */
  function update(elapsedTime, smoothMouseX = 0, smoothMouseY = 0) {
    const dt = Math.min(0.05, Math.max(0.001, elapsedTime - prevElapsed));
    prevElapsed = elapsedTime;
    currentFrameDt = dt;

    // UPDATE V38 SECTION 4: Per-frame Bulletproof State Guard (prevents NaN, position/scale drift, or disappearing mesh)
    enforceBulletproofNahidaStateGuard();

    // HOTFIX V29 SECTION 3.3: Per-frame visibility protection guard while on the Curtain Q&A screen!
    if (
      isCurtainMode &&
      (!isPerformingCurtainAction ||
        poseControl.swingSitWeight > 0.5 ||
        idleScheduler.mode === 'SWING_SIT_MODE')
    ) {
      characterPivot.visible = true;
      if (loadedModel) loadedModel.visible = true;
      if (dendroSwingGroup && !isPerformingCurtainAction) {
        dendroSwingGroup.visible = true;
      }
    }

    if (!characterPivot.visible) {
      renderer.render(scene, camera);
      return;
    }

    const cw = poseControl.choreoWeight;
    const swWeight = THREE.MathUtils.clamp(
      poseControl.swingSitWeight * (1 - cw * 0.85),
      0,
      1
    );

    // ------------------------------------------------------------------------
    // SECTION 1: IDLE STATE MACHINE
    // - Slide 1 (`currentSlideId === 1 && !isCurtainMode`): Dual-FBX Motion Loop + 360° Spin
    // - Curtain Question (`isCurtainMode === true`): Dendro Holographic Swing Sitting Pose
    // ------------------------------------------------------------------------
    const slide1SafeZone = getSafeZoneForSlide(1);
    const isSlide1StandingIdle =
      !isPerformingCurtainAction && currentSlideId === 1 && !isCurtainMode;
    const isCurtainSwingIdle = !isPerformingCurtainAction && isCurtainMode;
    const isIdleStandingState = isSlide1StandingIdle || isCurtainSwingIdle;

    if (!isCurtainMode && currentSlideId === 1) {
      idleScheduler.baseStandX = slide1SafeZone.x;
      idleScheduler.baseStandY = slide1SafeZone.y;
      idleScheduler.baseStandZ = slide1SafeZone.z;
      idleScheduler.baseStandYaw = slide1SafeZone.lookDir < 0 ? -0.14 : 0.16;
    }

    if (isSlide1StandingIdle && loadedModel && !isInPlaceSpinning) {
      if (fbxRetargetState.isReady && fbxRetargetState.motionBlendWeight < 0.999) {
        fbxRetargetState.motionBlendWeight = Math.min(
          1.0,
          fbxRetargetState.motionBlendWeight + dt * fbxRetargetState.blendSpeed
        );
      }
    } else {
      fbxRetargetState.motionBlendWeight = Math.max(
        0.0,
        fbxRetargetState.motionBlendWeight - dt / 0.25
      );
    }

    const mw = fbxRetargetState.isReady
      ? THREE.MathUtils.clamp(
          fbxRetargetState.motionBlendWeight * (1 - cw) * (1 - swWeight),
          0,
          1
        )
      : 0.0;
    const rFlareSignZ = -solvedSigns.rightArmAdductZ;
    const lFlareSignZ = -solvedSigns.leftArmAdductZ;

    // ------------------------------------------------------------------------
    // SLIDE 1 STANDING / CURTAIN DENDRO SWING PENDULUM PIVOT POSITIONING
    // (`Math.sin(elapsedTime * 1.5) * 0.045 rad` gentle rocking)
    // ------------------------------------------------------------------------
    const swingPendulumPitchX = Math.sin(elapsedTime * 1.5) * 0.045 * swWeight;
    const swingPendulumRollZ = Math.cos(elapsedTime * 0.85) * 0.018 * swWeight;
    const swingArcOffsetZ = Math.sin(elapsedTime * 1.5) * 0.045 * swWeight;
    const swingArcOffsetY = (1.0 - Math.cos(swingPendulumPitchX * 2.0)) * 0.06 * swWeight;

    if (isIdleStandingState) {
      const baseX = idleScheduler.baseStandX;
      const baseY = idleScheduler.baseStandY;
      const baseZ = idleScheduler.baseStandZ;
      const baseYaw = idleScheduler.baseStandYaw;

      const idleBreathBobY =
        Math.sin(elapsedTime * 2.1) * 0.012 * (1 - spinPhysics.centrifugalFactor) -
        spinPhysics.anticipationDip * 0.03;

      characterPivot.position.x = baseX + Math.sin(elapsedTime * 0.85) * 0.016 * swWeight;
      characterPivot.position.z = baseZ + swingArcOffsetZ;
      characterPivot.position.y =
        baseY + idleBreathBobY * (1 - mw) * (1 - swWeight * 0.5) + swingArcOffsetY;

      characterPivot.rotation.x = swingPendulumPitchX;
      characterPivot.rotation.z = swingPendulumRollZ;

      if (!isInPlaceSpinning) {
        characterPivot.rotation.y = THREE.MathUtils.lerp(
          characterPivot.rotation.y,
          baseYaw,
          0.18
        );
      }
    } else if (loadedModel) {
      loadedModel.position.copy(baseModelLocalPos);
    }

    // ------------------------------------------------------------------------
    // REAL-TIME ANGULAR VELOCITY (omega), CENTRIFUGAL FORCE (Fc) & SPRING DAMPING
    // ------------------------------------------------------------------------
    let deltaRotY = characterPivot.rotation.y - spinPhysics.prevRotationY;
    if (Math.abs(deltaRotY) > Math.PI * 1.5) {
      deltaRotY = 0;
    }
    const rawOmega = deltaRotY / Math.max(dt, 0.001);
    spinPhysics.prevRotationY = characterPivot.rotation.y;

    const isSpinPhysicsActive = isInPlaceSpinning || isPerformingCurtainAction;
    const scale = spinPhysics.physicsIntensityScale;

    const prevOmega = spinPhysics.angularVelocity;
    spinPhysics.angularVelocity = THREE.MathUtils.lerp(
      spinPhysics.angularVelocity,
      isSpinPhysicsActive ? rawOmega : 0,
      0.18
    );
    spinPhysics.angularAcceleration = THREE.MathUtils.lerp(
      spinPhysics.angularAcceleration,
      (spinPhysics.angularVelocity - prevOmega) / Math.max(dt, 0.001),
      0.15
    );

    const spinSpeed = Math.abs(spinPhysics.angularVelocity);
    const rawCentrifugal =
      THREE.MathUtils.clamp((spinSpeed * spinSpeed) / 14.0, 0, 1) * scale;
    spinPhysics.centrifugalFactor = THREE.MathUtils.lerp(
      spinPhysics.centrifugalFactor,
      isSpinPhysicsActive ? rawCentrifugal : 0,
      0.22
    );

    spinPhysics.angularDrag =
      THREE.MathUtils.clamp(spinPhysics.angularVelocity * -0.15, -0.42, 0.42) *
      scale;

    const timeSinceSpinStop = elapsedTime - spinPhysics.postSpinStopTime;
    const springHarmonicWave =
      timeSinceSpinStop >= 0 && timeSinceSpinStop < 1.5
        ? Math.exp(-4.0 * timeSinceSpinStop) *
          Math.sin(12.0 * timeSinceSpinStop) *
          scale
        : 0;

    // ------------------------------------------------------------------------
    // MANDATORY PER-FRAME HARD CEILING CLAMP (`hardMaxFootY` >= 8vh top margin at 1.5x scale)
    // ------------------------------------------------------------------------
    const worldCharHeight = charHeight * CHARACTER_UNIFORM_SCALE;
    const worldCharWidth = charWidth * CHARACTER_UNIFORM_SCALE;
    const distanceToCam = camera.position.z - characterPivot.position.z;
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const visibleHeight = 2 * Math.tan(vFov / 2) * distanceToCam;
    const screenTopY = camera.position.y + visibleHeight / 2;
    const hardMaxFootY = screenTopY - worldCharHeight - visibleHeight * 0.08;
    if (characterPivot.position.y > hardMaxFootY) {
      characterPivot.position.y = hardMaxFootY;
    }

    // ------------------------------------------------------------------------
    // DYNAMICALLY UPDATE INTERNAL FLOOR & CURTAIN SHADOWS (HOTFIX V33 SECTION 2)
    // - Shadow-casting `dirLight` follows `characterPivot.position` from Front-Top (`+0.35, +2.8, +3.2`)
    // - `shadowCatcherPlane` (4.5x4.5) & `contactShadowMesh` (elliptical `1.15 x 0.85`) are tilted
    //   30° toward the camera (`-Math.PI / 2 + 0.52`) directly beneath Nahida (`x = 0`), eliminating
    //   any edge-on horizontal squashing or leftward shadow drift!
    // ------------------------------------------------------------------------
    if (dirLight && dirLight.target) {
      dirLight.target.position.copy(characterPivot.position);
      dirLight.position.set(
        characterPivot.position.x + 0.35,
        characterPivot.position.y + 2.8,
        characterPivot.position.z + 3.2
      );
      dirLight.target.updateMatrixWorld();
    }

    const flightAltitude = Math.max(0, characterPivot.position.y - slide1SafeZone.y);
    const groundShadowFactor =
      (isCurtainMode || isPerformingCurtainAction) && !isCurtainSwingIdle
        ? THREE.MathUtils.clamp(1.0 - (flightAltitude / 3.0) * 0.58, 0.32, 1.0)
        : 1.0;

    if (groundShadowGroup) {
      groundShadowGroup.visible = true;
      groundShadowGroup.position.set(0, 0, 0);
      const dynamicGroundScale = THREE.MathUtils.lerp(0.68, 1.0, groundShadowFactor);
      groundShadowGroup.scale.setScalar(dynamicGroundScale);
    }
    if (shadowCatcherPlane) {
      shadowCatcherPlane.visible = true;
      shadowCatcherPlane.rotation.x = SHADOW_PLANE_TILT_X;
      shadowCatcherPlane.position.set(0, 0.002, 0);
    }
    if (contactShadowMesh) {
      contactShadowMesh.visible = true;
      contactShadowMesh.rotation.x = SHADOW_PLANE_TILT_X;
      contactShadowMesh.position.set(0, 0.001, 0);
      contactShadowMesh.scale.set(
        Math.max(1.15, 1.15 * charWidth),
        Math.max(0.85, 0.85 * charWidth),
        1
      );
    }
    if (footAuraMesh) {
      footAuraMesh.rotation.x = SHADOW_PLANE_TILT_X;
    }
    if (shadowCatcherMat) {
      shadowCatcherMat.opacity = THREE.MathUtils.lerp(
        0.42 * groundShadowFactor,
        0.35,
        swWeight
      );
    }
    if (contactShadowMat) {
      contactShadowMat.opacity = THREE.MathUtils.lerp(
        0.52 * groundShadowFactor,
        0.35,
        swWeight
      );
    }

    const swingShadowFade = Math.max(0.0, 1.0 - swWeight * 0.95);
    if (
      curtainShadowGroup &&
      (isCurtainMode || isPerformingCurtainAction) &&
      swingShadowFade > 0.08
    ) {
      curtainShadowGroup.visible = true;
      curtainShadowGroup.position.set(
        characterPivot.position.x,
        characterPivot.position.y + worldCharHeight * 0.48,
        characterPivot.position.z - 0.36
      );
      const curtainShadowBlend =
        THREE.MathUtils.clamp(0.35 + (flightAltitude / 2.2) * 0.65, 0.35, 1.0) *
        swingShadowFade;
      if (curtainShadowCatcherMat) {
        curtainShadowCatcherMat.opacity = THREE.MathUtils.lerp(
          curtainShadowCatcherMat.opacity,
          0.34 * curtainShadowBlend,
          0.15
        );
      }
      if (curtainSoftShadowMat) {
        curtainSoftShadowMat.opacity = THREE.MathUtils.lerp(
          curtainSoftShadowMat.opacity,
          0.32 * curtainShadowBlend,
          0.15
        );
      }
      if (curtainSoftShadowMesh) {
        curtainSoftShadowMesh.scale.set(worldCharWidth * 1.45, worldCharHeight * 0.95, 1);
      }
    } else if (curtainShadowGroup) {
      if (curtainShadowCatcherMat) curtainShadowCatcherMat.opacity = 0;
      if (curtainSoftShadowMat) curtainSoftShadowMat.opacity = 0;
      curtainShadowGroup.visible = false;
    }

    // ------------------------------------------------------------------------
    // SECTION 3.2: 4-TIER SPRING-DAMPER MOUSE GAZE CHAIN UPDATE
    // (`targetYaw = mouseX * 0.75 rad`, `targetPitch = -mouseY * 0.42 rad`, `targetRoll = -mouseX * 0.16 rad`)
    // ------------------------------------------------------------------------
    tempHeadWorldPos.set(
      characterPivot.position.x,
      characterPivot.position.y + worldCharHeight * 0.78,
      characterPivot.position.z
    );
    tempHeadWorldPos.project(camera);

    const effMouseX = THREE.MathUtils.clamp(
      (mouseGazeState.rawMouseX - tempHeadWorldPos.x * 0.45) * 1.15,
      -1.0,
      1.0
    );
    const effMouseY = THREE.MathUtils.clamp(
      (mouseGazeState.rawMouseY - tempHeadWorldPos.y * 0.45) * 1.15,
      -1.0,
      1.0
    );

    const targetYaw = effMouseX * 0.75;   // ~43° left/right
    const targetPitch = -effMouseY * 0.42; // ~24° up/down
    const targetRoll = -effMouseX * 0.16;  // cute head tilt

    stepSpringDamperTier(
      mouseGazeState.headTier,
      targetYaw,
      targetPitch,
      targetRoll,
      dt
    );
    stepSpringDamperTier(
      mouseGazeState.neckTier,
      targetYaw,
      targetPitch,
      targetRoll,
      dt
    );
    stepSpringDamperTier(
      mouseGazeState.chestTier,
      targetYaw,
      targetPitch,
      targetRoll,
      dt
    );
    stepSpringDamperTier(
      mouseGazeState.spineTier,
      targetYaw,
      targetPitch,
      targetRoll,
      dt
    );

    footAuraMesh.rotation.z = elapsedTime * 0.65;
    footAuraMat.opacity =
      (0.18 + Math.sin(elapsedTime * 2.4) * 0.06) * groundShadowFactor * (1.0 - swWeight * 0.85);

    // ------------------------------------------------------------------------
    // SKELETAL UPDATE:
    // Pass 1: Procedural Contrapposto / Spin Physics / 4-Tier Mouse Gaze / 7-Joint Curtain Pull
    // Pass 2: `/change-pose-379001.fbx` Proportional World-Space Skeleton Retargeting (`FBXToGLBRetargeter`)
    //         + 35% Additive Mouse Gaze on `Neck` & `Head` + Dynamic Ground Contact Clamp
    // ------------------------------------------------------------------------
    if (loadedModel) {
      const breathWave = Math.sin(elapsedTime * 2.1);
      const hipWeightShift = Math.sin(elapsedTime * 1.1);
      const cf = spinPhysics.centrifugalFactor;
      const drag = spinPhysics.angularDrag;
      const antic = spinPhysics.anticipationDip;
      const idleWeight = Math.max(0, 1 - cw);

      const spotP = spinPhysics.spottingProgress;
      const dancerSpottingYaw = isInPlaceSpinning
        ? -Math.sin(spotP * Math.PI * 2) * 0.38
        : 0;

      // ----------------------------------------------------------------------
      // UPDATE V40 SECTION 3: AERIAL FLIGHT PHYSICS & ASYNCHRONOUS LEG PENDULUM
      // MICRO-OSCILLATION DURING CURTAIN PULL FLIGHT (`isPerformingCurtainAction` / `cw > 0`)
      // ----------------------------------------------------------------------
      let aerialFlightWeight = 0.0;
      let aerialDragPitchX = 0.0;
      let aerialPendulumPitchX = 0.0;
      let aerialLateralRollZ = 0.0;
      let aerialFootPointDrag = 0.0;
      let aerialBodySwayWave = 0.0;

      if (isPerformingCurtainAction || cw > 0.001) {
        aerialFlightWeight = THREE.MathUtils.clamp(
          isPerformingCurtainAction ? Math.max(cw, 0.85) : cw,
          0.0,
          1.0
        );
        if (!aerialCurtainFlightState.initialized) {
          aerialCurtainFlightState.initialized = true;
          aerialCurtainFlightState.prevX = characterPivot.position.x;
          aerialCurtainFlightState.prevY = characterPivot.position.y;
          aerialCurtainFlightState.vx = 0.0;
          aerialCurtainFlightState.vy = 0.0;
          aerialCurtainFlightState.ay = 0.0;
          aerialCurtainFlightState.pendulumAngleX = 0.0;
          aerialCurtainFlightState.pendulumVelX = 0.0;
          aerialCurtainFlightState.pendulumRollZ = 0.0;
          aerialCurtainFlightState.pendulumVelZ = 0.0;
        } else {
          const safeDt = Math.max(0.004, dt);
          const rawVx = (characterPivot.position.x - aerialCurtainFlightState.prevX) / safeDt;
          const rawVy = (characterPivot.position.y - aerialCurtainFlightState.prevY) / safeDt;
          aerialCurtainFlightState.prevX = characterPivot.position.x;
          aerialCurtainFlightState.prevY = characterPivot.position.y;

          const prevVy = aerialCurtainFlightState.vy;
          aerialCurtainFlightState.vx = THREE.MathUtils.lerp(
            aerialCurtainFlightState.vx,
            THREE.MathUtils.clamp(rawVx, -6.0, 6.0),
            0.26
          );
          aerialCurtainFlightState.vy = THREE.MathUtils.lerp(
            aerialCurtainFlightState.vy,
            THREE.MathUtils.clamp(rawVy, -6.0, 6.0),
            0.26
          );
          const rawAy = (aerialCurtainFlightState.vy - prevVy) / safeDt;
          aerialCurtainFlightState.ay = THREE.MathUtils.lerp(
            aerialCurtainFlightState.ay,
            THREE.MathUtils.clamp(rawAy, -22.0, 22.0),
            0.22
          );

          // 2nd-Order Spring-Damper Pendulum for Forward/Backward Leg Inertia:
          // - When ascending (\dot{y} > 0), air drag trails legs gently backward.
          // - When braking at curtain apex or pulling downward (\ddot{y} < 0),
          //   inertial impulse swings legs gently forward like a spring pendulum!
          const kSpring = 36.0;
          const cDamper = 6.2;
          const inertialForwardImpulse = THREE.MathUtils.clamp(
            -aerialCurtainFlightState.ay * 0.24 - aerialCurtainFlightState.vy * 1.35,
            -5.5,
            5.5
          );
          const accelPendX =
            inertialForwardImpulse -
            kSpring * aerialCurtainFlightState.pendulumAngleX -
            cDamper * aerialCurtainFlightState.pendulumVelX;
          aerialCurtainFlightState.pendulumVelX += accelPendX * safeDt;
          aerialCurtainFlightState.pendulumAngleX = THREE.MathUtils.clamp(
            aerialCurtainFlightState.pendulumAngleX +
              aerialCurtainFlightState.pendulumVelX * safeDt,
            -0.32,
            0.32
          );

          // Lateral Flight Inertia Roll: \theta_z = -clamp(\dot{x} * 0.18, -0.16, 0.16) rad
          const targetLateralRollZ = -THREE.MathUtils.clamp(
            aerialCurtainFlightState.vx * 0.18,
            -0.16,
            0.16
          );
          const accelRollZ =
            (targetLateralRollZ - aerialCurtainFlightState.pendulumRollZ) * 42.0 -
            aerialCurtainFlightState.pendulumVelZ * 7.5;
          aerialCurtainFlightState.pendulumVelZ += accelRollZ * safeDt;
          aerialCurtainFlightState.pendulumRollZ = THREE.MathUtils.clamp(
            aerialCurtainFlightState.pendulumRollZ +
              aerialCurtainFlightState.pendulumVelZ * safeDt,
            -0.18,
            0.18
          );
        }

        const upwardFlightSpeed = Math.max(0.0, aerialCurtainFlightState.vy);
        aerialDragPitchX =
          THREE.MathUtils.clamp(upwardFlightSpeed * 0.085, 0.0, 0.22) * aerialFlightWeight;
        aerialPendulumPitchX =
          aerialCurtainFlightState.pendulumAngleX * aerialFlightWeight;
        aerialLateralRollZ =
          aerialCurtainFlightState.pendulumRollZ * aerialFlightWeight;
        // ~15° (0.262 rad) soft toe-point extension while soaring upward
        aerialFootPointDrag =
          THREE.MathUtils.clamp(0.14 + upwardFlightSpeed * 0.065, 0.0, 0.262) *
          aerialFlightWeight;
        // Sin(4.5 * t) gentle aerial wave for Hips, Spine, Head, and Right Arm
        aerialBodySwayWave = Math.sin(elapsedTime * 4.5) * aerialFlightWeight;
      } else {
        aerialCurtainFlightState.initialized = false;
      }

      // ----------------------------------------------------------------------
      // PASS 1: BASE PROCEDURAL / SPIN / 7-JOINT CURTAIN PULL POSE
      // ----------------------------------------------------------------------
      if (riggedBones.hips) {
        const hipsYaw = drag * 0.14 + aerialBodySwayWave * 0.045;
        const hipsPitch =
          antic * 0.05 +
          Math.cos(elapsedTime * 4.5) * 0.032 * aerialFlightWeight -
          aerialPendulumPitchX * 0.18;
        const hipsRoll =
          hipWeightShift * 0.025 * idleWeight -
          antic * 0.03 +
          aerialBodySwayWave * 0.048 +
          aerialLateralRollZ * 0.35;
        applyBoneWorldYPZ(riggedBones.hips, hipsYaw, hipsPitch, hipsRoll);
      }

      const spineYaw =
        (0.08 * mouseGazeState.spineTier.yaw + drag * 0.2) * idleWeight +
        (poseControl.spineChestTwistY * 0.45 + Math.sin(elapsedTime * 4.5 + 0.4) * 0.045) * cw;
      const spinePitch =
        (breathWave * 0.035 + 0.06 * mouseGazeState.spineTier.pitch + antic * 0.05 - cf * 0.03) *
          idleWeight +
        (poseControl.spineChestArchX * 0.5 + Math.cos(elapsedTime * 4.5 + 0.3) * 0.038) * cw;
      const spineRoll =
        (0.08 * mouseGazeState.spineTier.roll -
          hipWeightShift * 0.02 +
          springHarmonicWave * 0.03) *
          idleWeight +
        (poseControl.spineChestTiltZ * 0.45 +
          aerialBodySwayWave * 0.042 +
          aerialLateralRollZ * 0.25) *
          cw;

      applyBoneWorldYPZ(riggedBones.spine, spineYaw, spinePitch, spineRoll);

      if (riggedBones.upperBody) {
        applyBoneWorldYPZ(
          riggedBones.upperBody,
          0.05 * mouseGazeState.chestTier.yaw * idleWeight +
            (poseControl.spineChestTwistY * 0.25 + aerialBodySwayWave * 0.028) * cw,
          breathWave * 0.02 * idleWeight +
            (poseControl.spineChestArchX * 0.25 + Math.cos(elapsedTime * 4.5) * 0.024) * cw,
          0.05 * mouseGazeState.chestTier.roll * idleWeight +
            aerialBodySwayWave * 0.025 * cw
        );
      }

      const chestYaw =
        (0.12 * mouseGazeState.chestTier.yaw + drag * 0.18) * idleWeight +
        (poseControl.spineChestTwistY * 0.55 + Math.sin(elapsedTime * 4.5 + 0.7) * 0.042) * cw;
      const chestPitch =
        (breathWave * 0.035 + 0.10 * mouseGazeState.chestTier.pitch - cf * 0.03) *
          idleWeight +
        (poseControl.spineChestArchX * 0.55 + Math.cos(elapsedTime * 4.5 + 0.6) * 0.036) * cw;
      const chestRoll =
        (0.12 * mouseGazeState.chestTier.roll + springHarmonicWave * 0.025) *
          idleWeight +
        (poseControl.spineChestTiltZ * 0.55 + aerialBodySwayWave * 0.038) * cw;

      applyBoneWorldYPZ(riggedBones.chest, chestYaw, chestPitch, chestRoll);

      const neckYaw =
        (0.25 * mouseGazeState.neckTier.yaw + dancerSpottingYaw * 0.35) * idleWeight +
        (poseControl.curtainHeadYawY * 0.38 + Math.sin(elapsedTime * 4.5 - 0.3) * 0.03) * cw;
      const neckPitch =
        0.25 * mouseGazeState.neckTier.pitch * idleWeight +
        (poseControl.curtainHeadPitchX * 0.38 + Math.cos(elapsedTime * 4.5 - 0.3) * 0.028) * cw;
      const neckRoll =
        (0.25 * mouseGazeState.neckTier.roll + drag * 0.1) * idleWeight +
        (poseControl.curtainHeadRollZ * 0.38 + aerialBodySwayWave * 0.032) * cw;

      applyBoneWorldYPZ(riggedBones.neck, neckYaw, neckPitch, neckRoll);

      const headYaw =
        (0.55 * mouseGazeState.headTier.yaw + dancerSpottingYaw * 0.65) * idleWeight +
        (poseControl.curtainHeadYawY * 0.62 + Math.sin(elapsedTime * 4.5 - 0.6) * 0.045) * cw;
      const headPitch =
        0.55 * mouseGazeState.headTier.pitch * idleWeight +
        (poseControl.curtainHeadPitchX * 0.62 + Math.cos(elapsedTime * 4.5 - 0.5) * 0.038) * cw;
      const headRoll =
        (0.60 * mouseGazeState.headTier.roll + drag * 0.14) * idleWeight +
        (poseControl.curtainHeadRollZ * 0.62 + aerialBodySwayWave * 0.048) * cw;

      applyBoneWorldYPZ(riggedBones.head, headYaw, headPitch, headRoll);

      // Right Arm (with Update V40 Section 3 sin(4.5 * t) aerial counter-sway during curtain pull)
      const armPendulumPitch = Math.sin(elapsedTime * 2.1 - 0.55) * 0.036 * idleWeight;
      const armPendulumRoll =
        (Math.sin(elapsedTime * 2.1 - 0.35) * 0.024 + 0.015) * idleWeight;
      const foreArmPendulumPitch =
        Math.sin(elapsedTime * 2.1 - 1.15) * 0.038 * idleWeight;
      const wristPendulumRoll =
        Math.sin(elapsedTime * 2.1 - 1.65) * 0.035 * idleWeight;

      const aerialRightArmPitchWave = Math.sin(elapsedTime * 4.5 + 0.5) * 0.11 * aerialFlightWeight;
      const aerialRightArmRollWave =
        (0.06 + Math.sin(elapsedTime * 4.5 - 0.4) * 0.055) * aerialFlightWeight;
      const aerialRightForeArmPitchWave =
        (0.12 + Math.sin(elapsedTime * 4.5 - 1.1) * 0.095) * aerialFlightWeight;

      if (riggedBones.rightShoulder) {
        applyBoneWorldYPZ(
          riggedBones.rightShoulder,
          0,
          breathWave * 0.015 * idleWeight + aerialBodySwayWave * 0.025,
          rFlareSignZ *
            (cf * 0.12 +
              Math.max(0, breathWave) * 0.018 * idleWeight +
              aerialRightArmRollWave * 0.35)
        );
      }

      if (riggedBones.rightArm) {
        const rPitchX =
          armPendulumPitch +
          poseControl.rightArmCounterPitchX * cw +
          aerialRightArmPitchWave +
          aerialPendulumPitchX * 0.35 +
          springHarmonicWave * 0.035;
        const rYawY = drag * 0.22 + aerialBodySwayWave * 0.06;
        const rRollZ =
          rFlareSignZ *
          (cf * 0.42 +
            armPendulumRoll +
            poseControl.rightArmCounterFlareZ * cw +
            aerialRightArmRollWave +
            springHarmonicWave * 0.04) +
          aerialLateralRollZ * 0.4;

        applyBoneWorldYPZ(riggedBones.rightArm, rYawY, rPitchX, rRollZ);
      }

      if (riggedBones.rightElbow) {
        applyBoneWorldYPZ(
          riggedBones.rightElbow,
          0,
          foreArmPendulumPitch - cf * 0.08 - aerialRightForeArmPitchWave,
          rFlareSignZ * (cf * 0.16 + drag * 0.12 + aerialRightArmRollWave * 0.45)
        );
      }

      if (riggedBones.rightWrist) {
        applyBoneWorldYPZ(
          riggedBones.rightWrist,
          drag * 0.25 + aerialBodySwayWave * 0.05,
          Math.sin(elapsedTime * 2.1 - 1.4) * 0.025 * idleWeight +
            Math.sin(elapsedTime * 4.5 - 1.6) * 0.07 * aerialFlightWeight,
          rFlareSignZ *
            (cf * 0.14 +
              wristPendulumRoll +
              Math.cos(elapsedTime * 4.5 - 1.2) * 0.05 * aerialFlightWeight +
              springHarmonicWave * 0.04)
        );
      }

      // Left Arm & 7-Joint Curtain Pull (`uPull`)
      const uPull = poseControl.leftArmPullRaise;
      const lShrug = poseControl.leftShoulderShrug;
      const lOutZ = poseControl.leftArmOutwardZ;
      const lElbFlex = poseControl.leftElbowFlexArc;
      const lWristExt = poseControl.leftWristExtension;
      const lFingerGrip = poseControl.leftFingerGrip;

      if (riggedBones.leftShoulder) {
        applyBoneWorldYPZ(
          riggedBones.leftShoulder,
          -lShrug * 0.15,
          breathWave * 0.015 * idleWeight - lShrug * 0.12,
          lFlareSignZ *
            (lShrug +
              cf * 0.12 * (1 - uPull) +
              Math.max(0, breathWave) * 0.018 * idleWeight)
        );
      }

      if (riggedBones.leftArm) {
        const reachOverheadPitchX = -uPull * 2.55;
        const midPullForwardArcZ = Math.sin(uPull * Math.PI) * 0.22;

        const lPitchX =
          reachOverheadPitchX -
          armPendulumPitch * (1 - uPull) +
          springHarmonicWave * 0.035 * (1 - uPull);
        const lYawY = drag * 0.22 * (1 - uPull) + uPull * 0.16;
        const lRollZ =
          lFlareSignZ *
          (cf * 0.42 * (1 - uPull) +
            armPendulumRoll * (1 - uPull) +
            lOutZ +
            midPullForwardArcZ +
            springHarmonicWave * 0.04 * (1 - uPull));

        applyBoneWorldYPZ(riggedBones.leftArm, lYawY, lPitchX, lRollZ);
      }

      if (riggedBones.leftElbow) {
        const dynamicElbowFlex =
          -lElbFlex * Math.sin(Math.min(1, uPull * 1.25) * Math.PI * 0.85) -
          uPull * 0.28;
        applyBoneWorldYPZ(
          riggedBones.leftElbow,
          0,
          dynamicElbowFlex -
            foreArmPendulumPitch * (1 - uPull) -
            cf * 0.08 * (1 - uPull),
          lFlareSignZ * (cf * 0.16 * (1 - uPull) - uPull * 0.12)
        );
      }

      if (riggedBones.leftWrist) {
        applyBoneWorldYPZ(
          riggedBones.leftWrist,
          drag * 0.25 * (1 - uPull),
          lWristExt + Math.sin(elapsedTime * 2.1 - 1.4) * 0.025 * idleWeight,
          lFlareSignZ *
            (cf * 0.14 * (1 - uPull) +
              wristPendulumRoll * (1 - uPull) +
              springHarmonicWave * 0.04)
        );
      }

      // 5 Fingers per hand (Procedural Stair-Step Curl + Curtain Grip + 40% Spell-Cast Finger Open)
      const spellUncurlMultiplier =
        1.0 - 0.40 * THREE.MathUtils.clamp(fbxRetargetState.spellCastFingerOpenFactor * mw, 0, 1);
      const centrifugalUncurlMultiplier = (1.0 - cf * 0.82) * spellUncurlMultiplier;
      for (let i = 0; i < riggedBones.fingerBones.length; i++) {
        const fb = riggedBones.fingerBones[i];
        const microFlex =
          Math.sin(elapsedTime * 2.1 + fb.phaseOffset) * 0.032 * (1 - cf * 0.6);
        const gripOffset = !fb.isRightSide ? lFingerGrip : 0;
        const idleCurlAng = Math.max(
          0.04,
          fb.baseCurlAngle * centrifugalUncurlMultiplier + microFlex + gripOffset
        );

        fb.bone.quaternion.copy(fb.restQuat);
        fb.bone.rotateOnAxis(fb.curlAxisVec, idleCurlAng);
      }

      // Legs, Knees & Feet — Natural Neutral A-Stand Pose + Update V40 Section 3 Aerial Flight Physics & Micro-Oscillation
      {
        const kneeBounce = poseControl.pullKneeBounce;
        const footHover = poseControl.hoverFootPoint;

        const rKneeAngle = antic * 0.06 + kneeBounce;
        const lKneeAngle = antic * 0.06 + kneeBounce;
        const standSpreadFactor = 1.0 - cw;

        // UPDATE V40 SECTION 3.2: Asynchronous Multi-Frequency Leg Pendulum & Micro-Sway during Curtain Pull Flight:
        // - Left & Right Thighs (`LeftUpLeg`, `RightUpLeg`) Pitch/Flexion & Roll/Abduction micro-sway:
        //   \Delta \theta_{pitch, L}(t) = 0.095 \sin(5.2 t) + 0.04 \sin(11.3 t)
        //   \Delta \theta_{pitch, R}(t) = 0.095 \sin(5.2 t + \pi * 0.85) + 0.04 \sin(11.3 t + 1.7)
        //   \Delta \theta_{roll, L}(t)  = +0.065 + 0.035 \sin(3.8 t)
        //   \Delta \theta_{roll, R}(t)  = -0.065 - 0.035 \sin(3.8 t + 0.6)
        const flutterPitchL =
          (0.095 * Math.sin(5.2 * elapsedTime) + 0.04 * Math.sin(11.3 * elapsedTime)) *
          aerialFlightWeight;
        const flutterPitchR =
          (0.095 * Math.sin(5.2 * elapsedTime + Math.PI * 0.85) +
            0.04 * Math.sin(11.3 * elapsedTime + 1.7)) *
          aerialFlightWeight;

        const flutterRollL =
          (0.065 + 0.035 * Math.sin(3.8 * elapsedTime)) * aerialFlightWeight;
        const flutterRollR =
          (0.065 + 0.035 * Math.sin(3.8 * elapsedTime + 0.6)) * aerialFlightWeight;

        // - Left & Right Knees/Calves (`LeftLeg`, `RightLeg`) with -\pi/2 phase lag:
        //   \Delta \theta_{knee, L}(t) = 0.18 + 0.11 \sin(5.2 t - \pi/2)
        //   \Delta \theta_{knee, R}(t) = 0.22 + 0.11 \sin(5.2 t + \pi * 0.85 - \pi/2)
        const flutterKneeL =
          (0.18 + 0.11 * Math.sin(5.2 * elapsedTime - Math.PI * 0.5)) *
          aerialFlightWeight;
        const flutterKneeR =
          (0.22 +
            0.11 * Math.sin(5.2 * elapsedTime + Math.PI * 0.85 - Math.PI * 0.5)) *
          aerialFlightWeight;

        // - Left & Right Ankles/Feet (`LeftFoot`, `RightFoot`) with -\pi phase lag & soft toe-point (~15°):
        //   \Delta \theta_{ankle}(t) = 0.08 \sin(5.2 t - \pi)
        const flutterAnkleL =
          (aerialFootPointDrag + 0.08 * Math.sin(5.2 * elapsedTime - Math.PI)) *
          aerialFlightWeight;
        const flutterAnkleR =
          (aerialFootPointDrag +
            0.08 * Math.sin(5.2 * elapsedTime + Math.PI * 0.85 - Math.PI)) *
          aerialFlightWeight;
        const ankleMicroRollL =
          0.035 * Math.cos(3.8 * elapsedTime - 0.5) * aerialFlightWeight;
        const ankleMicroRollR =
          -0.035 * Math.cos(3.8 * elapsedTime + 0.2) * aerialFlightWeight;

        // Combine base standing leg angles with Velocity-Driven Drag (`aerialDragPitchX`),
        // Spring-Damper Pendulum (`aerialPendulumPitchX`), Lateral Flight Roll (`aerialLateralRollZ`),
        // and Asynchronous Harmonic Flutter!
        const rThighFlightPitch =
          (aerialDragPitchX - aerialPendulumPitchX - flutterPitchR) *
          solvedSigns.rightKneeBendX;
        const lThighFlightPitch =
          (aerialDragPitchX - aerialPendulumPitchX - flutterPitchL) *
          solvedSigns.leftKneeBendX;

        const rThighFlightRoll =
          -solvedSigns.rightThighAdductZ * flutterRollR + aerialLateralRollZ;
        const lThighFlightRoll =
          -solvedSigns.leftThighAdductZ * flutterRollL + aerialLateralRollZ;

        if (riggedBones.rightLeg) {
          applyBoneWorldYPZ(
            riggedBones.rightLeg,
            0.025 * Math.sin(3.8 * elapsedTime + 0.6) * aerialFlightWeight,
            (-0.02 * standSpreadFactor - rKneeAngle * 0.5) * solvedSigns.rightKneeBendX +
              rThighFlightPitch,
            -solvedSigns.rightThighAdductZ * 0.08 * standSpreadFactor -
              hipWeightShift * 0.012 * idleWeight +
              rThighFlightRoll
          );
        }
        if (riggedBones.leftLeg) {
          applyBoneWorldYPZ(
            riggedBones.leftLeg,
            -0.025 * Math.sin(3.8 * elapsedTime) * aerialFlightWeight,
            (-0.02 * standSpreadFactor - lKneeAngle * 0.5) * solvedSigns.leftKneeBendX +
              lThighFlightPitch,
            -solvedSigns.leftThighAdductZ * 0.08 * standSpreadFactor -
              hipWeightShift * 0.012 * idleWeight +
              lThighFlightRoll
          );
        }
        if (riggedBones.rightKnee) {
          const rCalfDynamicBend =
            0.04 * standSpreadFactor +
            rKneeAngle * 0.55 +
            flutterKneeR +
            Math.max(0, aerialDragPitchX * 0.45 - aerialPendulumPitchX * 0.35);
          applyBoneWorldYPZ(
            riggedBones.rightKnee,
            0,
            solvedSigns.rightKneeBendX * rCalfDynamicBend,
            aerialLateralRollZ * 0.35
          );
        }
        if (riggedBones.leftKnee) {
          const lCalfDynamicBend =
            0.04 * standSpreadFactor +
            lKneeAngle * 0.55 +
            flutterKneeL +
            Math.max(0, aerialDragPitchX * 0.45 - aerialPendulumPitchX * 0.35);
          applyBoneWorldYPZ(
            riggedBones.leftKnee,
            0,
            solvedSigns.leftKneeBendX * lCalfDynamicBend,
            aerialLateralRollZ * 0.35
          );
        }
        if (riggedBones.rightFoot) {
          applyBoneWorldYPZ(
            riggedBones.rightFoot,
            0.02 * Math.sin(5.2 * elapsedTime + 0.8) * aerialFlightWeight,
            (footHover * (1 - aerialFlightWeight * 0.5) + flutterAnkleR) *
              solvedSigns.rightKneeBendX,
            ankleMicroRollR
          );
        }
        if (riggedBones.leftFoot) {
          applyBoneWorldYPZ(
            riggedBones.leftFoot,
            -0.02 * Math.sin(5.2 * elapsedTime) * aerialFlightWeight,
            (footHover * (1 - aerialFlightWeight * 0.5) + flutterAnkleL) *
              solvedSigns.leftKneeBendX,
            ankleMicroRollL
          );
        }
      }

      // ----------------------------------------------------------------------
      // PASS 2 (UPDATE V41): PRE-SAMPLED LOOK-AHEAD POSE-TO-POSE BRIDGE
      // & HORIZONTAL MOUTH-TO-FORWARD KISS PROJECTION FOR `Blow A Kiss.fbx`
      // (`change-pose-379001.fbx` -> `0.38s Direct Look-Ahead Pose Bridge` ->
      //  `Yawn.fbx` -> `0.38s Direct Look-Ahead Pose Bridge` ->
      //  `Blow A Kiss.fbx` -> `0.38s Direct Look-Ahead Pose Bridge` -> Loop)
      // ----------------------------------------------------------------------
      const m1 = fbxRetargetState.motion1;
      const m2 = fbxRetargetState.motion2;
      const m3 = fbxRetargetState.motion3;

      const getSlotByIdx = (idx) => {
        if (idx === 1) return m1;
        if (idx === 2) return m2;
        if (idx === 3) return m3;
        return m1;
      };

      const findNextReadySlotIndex = (fromIdx) => {
        const order =
          fromIdx === 1
            ? [2, 3, 1]
            : fromIdx === 2
            ? [3, 1, 2]
            : [1, 2, 3];
        for (let i = 0; i < order.length; i++) {
          const cand = getSlotByIdx(order[i]);
          if (cand && cand.isReady) return order[i];
        }
        return fromIdx;
      };

      if (
        mw > 0.0001 &&
        fbxRetargetState.isReady &&
        (m1.isReady || m2.isReady || m3.isReady)
      ) {
        // Ensure any newly ready slot has its boundary poses pre-sampled
        if (m1.isReady && !m1.hasPrecomputedBoundaryPoses) {
          precomputeSlotStartAndEndPoses(m1);
        }
        if (m2.isReady && !m2.hasPrecomputedBoundaryPoses) {
          precomputeSlotStartAndEndPoses(m2);
        }
        if (m3.isReady && !m3.hasPrecomputedBoundaryPoses) {
          precomputeSlotStartAndEndPoses(m3);
        }

        const evalOptions = {
          drag,
          antic,
          hipWeightShift,
          idleWeight,
          headYaw,
          headPitch,
          headRoll,
          isBakeMode: false
        };

        let activeIdx = fbxRetargetState.activeSlotIndex || 1;
        let curSlot = getSlotByIdx(activeIdx);
        if (!curSlot || !curSlot.isReady) {
          activeIdx = findNextReadySlotIndex(activeIdx);
          fbxRetargetState.activeSlotIndex = activeIdx;
          curSlot = getSlotByIdx(activeIdx);
          fbxRetargetState.sequenceStage = `STAGE_MOTION_${activeIdx}`;
        }

        if (isIdleStandingState) {
          const lookAheadDur = fbxRetargetState.lookAheadBridgeDuration || 0.38;
          const curStage = fbxRetargetState.sequenceStage;

          if (curStage === 'STAGE_LOOKAHEAD_BRIDGE') {
            // ----------------------------------------------------------------
            // UPDATE V41 SECTION 1: PRE-SAMPLED LOOK-AHEAD POSE-TO-POSE BRIDGE
            // Directly interpolates every bone b from EndPose(A_i) to StartPose(A_{i+1}):
            //   q_b(t) = Slerp(q_b^{end}(A_i), q_b^{start}(A_{i+1}), s(u))
            //   s(u) = 6u^5 - 15u^4 + 10u^3,  T_{bridge} = 0.38s
            // No Return-to-Origin or default pose intermediate stop!
            // ----------------------------------------------------------------
            fbxRetargetState.bridgeTimer += dt;
            const uBridge = THREE.MathUtils.clamp(
              fbxRetargetState.bridgeTimer / lookAheadDur,
              0.0,
              1.0
            );
            const sBridge = quinticEaseInOut(uBridge);

            const nextIdx =
              fbxRetargetState.nextSlotIndex || findNextReadySlotIndex(activeIdx);
            const nextSlot = getSlotByIdx(nextIdx);

            // Evaluate `nextSlot` at its trimmed start (`t = clipStartTime`) in Bake Mode (`isOfflineBake: true`)
            // so `bridgeToBoneQuats` captures the exact 100% Chibi-corrected `StartPose(A_{i+1})`
            // without being contaminated by `temporalBoneQuatMap` from the previous frame!
            if (nextSlot && nextSlot.isReady) {
              evaluateAndApplySlotPoseToNahida(
                nextSlot,
                nextSlot.clipStartTime,
                mw,
                {
                  ...evalOptions,
                  isOfflineBake: true
                }
              );
              captureFullNahidaPoseSnapshot(
                fbxRetargetState.bridgeToBoneQuats,
                fbxRetargetState.bridgeToHipsPos
              );
            }

            applyLookAheadPoseToPoseBridge(
              fbxRetargetState.bridgeFromBoneQuats,
              fbxRetargetState.bridgeFromHipsPos,
              fbxRetargetState.bridgeToBoneQuats,
              fbxRetargetState.bridgeToHipsPos,
              sBridge,
              mw
            );

            if (fbxRetargetState.bridgeTimer >= lookAheadDur) {
              // At u = 1.0, all bones already match StartPose(A_{i+1}) at t = 0 with zero error!
              // Immediately advance into STAGE_MOTION_{nextIdx} with zero pause!
              fbxRetargetState.activeSlotIndex = nextIdx;
              if (nextSlot) {
                nextSlot.currentClipTime = nextSlot.clipStartTime;
              }
              fbxRetargetState.sequenceStage = `STAGE_MOTION_${nextIdx}`;
              fbxRetargetState.bridgeTimer = 0.0;
              fbxRetargetState.bridgeMotionFactor = 1.0;
            }
          } else {
            // ----------------------------------------------------------------
            // ACTIVE MOTION PLAYBACK (`STAGE_MOTION_1` | `STAGE_MOTION_2` | `STAGE_MOTION_3`)
            // ----------------------------------------------------------------
            curSlot.currentClipTime += dt;
            fbxRetargetState.bridgeMotionFactor = 1.0;

            const evalTime = THREE.MathUtils.clamp(
              curSlot.currentClipTime,
              curSlot.clipStartTime,
              curSlot.clipDuration
            );
            evaluateAndApplySlotPoseToNahida(curSlot, evalTime, mw, evalOptions);

            if (curSlot.currentClipTime >= curSlot.clipDuration) {
              // Reached EndPose(A_i) at t = T_{end}:
              // Capture exact live EndPose(A_i) into `bridgeFromBoneQuats` & `bridgeFromHipsPos`,
              // look ahead to StartPose(A_{i+1}) at t = 0 of the next clip, and enter `STAGE_LOOKAHEAD_BRIDGE`!
              curSlot.currentClipTime = curSlot.clipDuration;
              captureFullNahidaPoseSnapshot(
                fbxRetargetState.bridgeFromBoneQuats,
                fbxRetargetState.bridgeFromHipsPos
              );

              const nextIdx = findNextReadySlotIndex(activeIdx);
              const nextSlot = getSlotByIdx(nextIdx);
              fbxRetargetState.nextSlotIndex = nextIdx;

              if (nextSlot && nextSlot.isReady) {
                nextSlot.currentClipTime = nextSlot.clipStartTime;
                if (nextSlot.hasPrecomputedBoundaryPoses) {
                  fbxRetargetState.bridgeToBoneQuats.clear();
                  for (const [bUuid, qStart] of nextSlot.startPoseBoneQuats.entries()) {
                    fbxRetargetState.bridgeToBoneQuats.set(bUuid, qStart.clone());
                  }
                  fbxRetargetState.bridgeToHipsPos.copy(nextSlot.startPoseHipsPos);
                } else {
                  precomputeSlotStartAndEndPoses(nextSlot);
                  fbxRetargetState.bridgeToBoneQuats.clear();
                  for (const [bUuid, qStart] of nextSlot.startPoseBoneQuats.entries()) {
                    fbxRetargetState.bridgeToBoneQuats.set(bUuid, qStart.clone());
                  }
                  fbxRetargetState.bridgeToHipsPos.copy(nextSlot.startPoseHipsPos);
                }
              }

              fbxRetargetState.sequenceStage = 'STAGE_LOOKAHEAD_BRIDGE';
              fbxRetargetState.bridgeTimer = 0.0;
            }
          }
        } else {
          // Non-idle blending (e.g. fading out `mw` when leaving Slide 01)
          const evalTime = THREE.MathUtils.clamp(
            curSlot.currentClipTime,
            curSlot.clipStartTime,
            curSlot.clipDuration
          );
          evaluateAndApplySlotPoseToNahida(curSlot, evalTime, mw, evalOptions);
        }
      } else {
        loadedModel.position.copy(baseModelLocalPos);
      }

      // Smooth Slerp Transition (`0.35s`) from Slide 01 Pose into Curtain-Pulling Pose (`triggerCamellyaPullCurtain`)
      if (isPerformingCurtainAction && curtainPullEntryState.active) {
        curtainPullEntryState.elapsed += dt;
        const uCurtainBlend = THREE.MathUtils.clamp(
          curtainPullEntryState.elapsed / Math.max(0.05, curtainPullEntryState.duration),
          0,
          1
        );
        const sCurtainBlend = quinticEaseInOut(uCurtainBlend);
        slerpSkeletonFromSnapshotToCurrent(curtainPullEntryState.entryBoneQuats, sCurtainBlend);
        if (uCurtainBlend >= 1.0) {
          curtainPullEntryState.active = false;
        }
      }

      // ----------------------------------------------------------------------
      // PASS 3 (HOTFIX V29): PROCEDURAL 3D DENDRO CLOVER SWING
      // & NAHIDA SITTING POSE WITH RELAXED ARMS (`applyNahidaSwingSittingPose`)
      // ----------------------------------------------------------------------
      const isSittingOnSwing = swWeight > 0.001;
      if (isSittingOnSwing) {
        // Section 2.1: Completely bypass FBX retargeter & standing leg pose when sitting on the swing!
        legFallbackWasApplied = true;
        applyNahidaSwingSittingPose(elapsedTime, dt, swWeight);
      } else {
        if (!isCurtainMode) {
          dendroSwingGroup.visible = false;
        }
        if (legFallbackWasApplied) {
          legFallbackWasApplied = false;
          for (let i = 0; i < legFallbackMeshes.length; i++) {
            const fbItem = legFallbackMeshes[i];
            if (fbItem.bone && fbItem.restQuat && !fbItem.isPrimaryLegBone) {
              fbItem.bone.quaternion.copy(fbItem.restQuat);
              fbItem.bone.updateMatrixWorld(true);
            }
          }
        }
      }

      // ----------------------------------------------------------------------
      // 6. SECONDARY PHYSICS CHAINS: Hair/Ponytail, Dress/Skirt/Cape, Leaf Ornaments
      // ----------------------------------------------------------------------
      const windBoost = 1.0 + cw * 0.55 + cf * 1.35 + mw * 0.25 + swWeight * 0.22;
      const skirtFlare = cf * 0.22 + mw * 0.04;

      for (let i = 0; i < riggedBones.hairChains.length; i++) {
        const hc = riggedBones.hairChains[i];
        const depthScale = Math.min(hc.chainDepth * 0.022, 0.09);
        const w = Math.max(0.032, depthScale) * windBoost;
        const waveX =
          Math.sin(elapsedTime * 2.8 + i * 0.45) * w +
          cf * depthScale * 1.4 +
          springHarmonicWave * depthScale * 1.2 -
          swingPendulumPitchX * 0.45;
        const waveZ =
          Math.cos(elapsedTime * 2.3 + i * 0.4) * w * 0.8 +
          drag * depthScale * 2.6 -
          swingPendulumRollZ * 0.45;
        applyBoneWorldYPZ(hc, drag * 0.25, waveX, waveZ);
      }

      for (let i = 0; i < riggedBones.skirtChains.length; i++) {
        const sc = riggedBones.skirtChains[i];
        const depthFactor = 0.25 + sc.chainDepth * 0.14;
        const w = (0.018 + sc.chainDepth * 0.01) * windBoost;
        // HOTFIX V31 SECTION 2.2: Never bend/lift back cape or skirt chains by -0.32 rad when sitting on the swing!
        // Keep natural vertical drape with gentle breeze oscillation (`Math.sin(elapsedTime * 2.0 + i) * 0.03`).
        const gentleSwingBreeze = Math.sin(elapsedTime * 2.0 + i) * 0.03 * swWeight;
        const waveX =
          Math.sin(elapsedTime * 2.8 + sc.phaseOffset) * w * (1.0 - swWeight * 0.5) -
          skirtFlare * depthFactor +
          springHarmonicWave * 0.05 * depthFactor +
          gentleSwingBreeze;
        const waveZ =
          Math.cos(elapsedTime * 2.3 + sc.phaseOffset) * w * (1.0 - swWeight * 0.5) +
          drag * 0.45 * depthFactor;
        applyBoneWorldYPZ(sc, drag * 0.22 * depthFactor, waveX, waveZ);
      }

      for (let i = 0; i < riggedBones.accessoryChains.length; i++) {
        const ac = riggedBones.accessoryChains[i];
        const wave =
          Math.sin(elapsedTime * 2.8 + i * 0.5) * 0.04 * windBoost +
          springHarmonicWave * 0.04;
        applyBoneWorldYPZ(ac, drag * 0.2, wave + cf * 0.06, wave * 0.7);
      }

      // ----------------------------------------------------------------------
      // 6.5 (UPDATE V37 SECTION 2.2): 120FPS DLSS-STYLE REAL-TIME EMA QUATERNION DAMPING
      //     alpha = 1 - exp(-22 * dt) applied across Nahida's skeleton
      // ----------------------------------------------------------------------
      applyRealTimeEMAQuaternionDampingPass(dt);

      // ----------------------------------------------------------------------
      // 6.6 (UPDATE V44 SECTION 2 - 20%): NATURAL SKIRT-SURFACE ARM CONTACT SLIDING & WRIST CONTOUR
      //     Exponentially smoothed (`alpha = 1 - exp(-18 * dt)`) micro abduction (`3°..7°`)
      //     & wrist contour (`5°..10°`) so arms & palms rest 0.0mm flush on the compressed skirt!
      // ----------------------------------------------------------------------
      applyNaturalSkirtSurfaceArmContactSliding(dt);

      // Final Bulletproof State Check before rendering (`loadedModel.visible = true`, no NaN, clamped local pos)
      enforceBulletproofNahidaStateGuard();

      // ----------------------------------------------------------------------
      // 7. SYNCHRONIZED QUATERNION HEAD/HAT VERTEX FALLBACK AROUND `neckWorldPos`
      //    (Only for meshes above `neckY` that are NOT already skinned to `headBone`/`neckBone`)
      // ----------------------------------------------------------------------
      if (headFallbackMeshes.length > 0) {
        const totalHeadYaw = headYaw + neckYaw;
        const totalHeadPitch = headPitch + neckPitch;
        const totalHeadRoll = headRoll + neckRoll;
        tempFallbackEuler.set(totalHeadPitch, totalHeadYaw, totalHeadRoll, 'YXZ');

        for (let m = 0; m < headFallbackMeshes.length; m++) {
          const item = headFallbackMeshes[m];
          const { posAttr, restPositions, headWeights } = item;
          const count = posAttr.count;

          for (let i = 0; i < count; i++) {
            const w = headWeights[i];
            if (w <= 0.001) {
              continue;
            }
            const rx = restPositions[i * 3];
            const ry = restPositions[i * 3 + 1];
            const rz = restPositions[i * 3 + 2];

            tempFallbackEuler.set(
              totalHeadPitch * w,
              totalHeadYaw * w,
              totalHeadRoll * w,
              'YXZ'
            );
            tempFallbackQuat.setFromEuler(tempFallbackEuler);

            tempFallbackVec
              .set(
                rx - neckPivotLocalPos.x,
                ry - neckPivotLocalPos.y,
                rz - neckPivotLocalPos.z
              )
              .applyQuaternion(tempFallbackQuat);

            posAttr.setXYZ(
              i,
              neckPivotLocalPos.x + tempFallbackVec.x,
              neckPivotLocalPos.y + tempFallbackVec.y,
              neckPivotLocalPos.z + tempFallbackVec.z
            );
          }
          posAttr.needsUpdate = true;
        }
      }

      // ----------------------------------------------------------------------
      // 8. (UPDATE V44 SECTION 1 - 80%): REALTIME CAPSULE-SDF CLOTH INDENTATION / COMPRESSION
      //    Indents Nahida's bell-shaped skirt/dress vertices inward where the 4 Arm & Hand
      //    3D Collision Capsules press against the fabric, and elastically restores `origPositions`!
      // ----------------------------------------------------------------------
      updateRealtimeNahidaClothCompression();
    }

    camera.position.x = smoothMouseX * 0.14;
    camera.position.y = smoothMouseY * 0.1;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  }

  function handleResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  window.addEventListener('resize', handleResize);

  return {
    characterRoot: characterPivot,
    characterPivot,
    getSafeZoneForSlide,
    setAssistantSlideState,
    triggerCamellyaPullCurtain,
    playModelCanvaBlurIntro,
    playModelCanvaBlurOutro,
    update
  };
}
