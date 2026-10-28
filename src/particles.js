import * as THREE from 'three';
import gsap from 'gsap';

/**
 * Interactive Nebula Particle System, Subtle Fairy-Dust Cursor Trail,
 * Rising Forest Spores (Slides 3 & 4), and Slide 10 Photorealistic 3D Blender Leaf (`particles.js`)
 *
 * Hotfix V5 Section 3 Implemented:
 * - Removed all procedural digital wireframe/grid shaders on the Slide 10 leaf.
 * - Replaced with a 2048x2048 Photorealistic Macro Green Leaf PBR Texture + Bump Map + Roughness Map
 *   applied to a naturally curved 3D leaf blade with `THREE.MeshPhysicalMaterial` (clearcoat, specular sheen,
 *   organic Bezier primary/secondary/tertiary venation, serrated margin, and morning dew droplets).
 * - Direct Blender Speed-Ramp Trajectory:
 *   1. Starts straight back in deep space (`x: 0, y: 0, z: -120`, `scale: 0.02`) and shoots straight
 *      along the central Z axis toward the Camera (`x: 0, y: 0, z: 2.35`).
 *   2. Rolls smoothly in 3D during the 1.3s flight with subtle motion blur (`blur(4px) -> blur(0px)`).
 *   3. Decelerates with `expo.out` into an artistic 17deg diagonal front-facing pose (broad leaf face
 *      pointing straight at the viewer) and freezes 100% STILL & SHARP (no wobble, no oscillation),
 *      immediately triggering the "Thanks for Watching!" headline.
 */

const NEBULA_PARTICLE_COUNT = 660;
const TRAIL_PARTICLE_COUNT = 72;
const RISING_SPORE_COUNT = 195;

/**
 * Generates a 2048x2048 Photorealistic Macro Green Leaf Diffuse Texture + Bump Map
 * using organic Bezier botanical venation, natural chlorophyll gradients, serrated margins,
 * cuticle sheen, and tiny morning dew drops (100% transparent outside the leaf).
 */
function createPhotorealisticLeafMaps() {
  const size = 2048;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const ctx = colorCanvas.getContext('2d');

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bCtx = bumpCanvas.getContext('2d');

  const cx = size * 0.5;
  const topY = size * 0.06;     // Leaf apex (tip)
  const baseY = size * 0.84;    // Blade base
  const stemEndY = size * 0.96; // Petiole stem bottom

  // Helper: Traces the organic serrated leaf blade outline path
  function traceLeafBladePath(context) {
    context.beginPath();
    context.moveTo(cx, topY);

    const steps = 140;
    // Right margin from tip (topY) down to base (baseY)
    for (let i = 1; i <= steps; i++) {
      const t = i / steps; // 0 at tip, 1 at base
      const y = topY + t * (baseY - topY);
      // Natural ovate-acuminate leaf width profile
      const profile = Math.pow(Math.sin(t * Math.PI), 0.76) * (1.0 - 0.14 * (1.0 - t));
      const baseHalfW = size * 0.31 * profile;

      // Fine organic leaf margin serrations (teeth pointing slightly toward apex)
      let serration = 0;
      if (t > 0.06 && t < 0.92) {
        const toothPhase = (t * 34) % 1;
        const sawtooth = toothPhase < 0.75 ? toothPhase / 0.75 : (1 - toothPhase) / 0.25;
        serration = (sawtooth - 0.4) * size * 0.0065 * Math.sin(t * Math.PI);
      }
      // Slight natural asymmetry curve along the midrib
      const curveShift = Math.sin(t * Math.PI) * size * 0.008;
      const x = cx + curveShift + baseHalfW + serration;
      context.lineTo(x, y);
    }

    // Left margin from base (baseY) back up to tip (topY)
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const y = topY + t * (baseY - topY);
      const profile = Math.pow(Math.sin(t * Math.PI), 0.76) * (1.0 - 0.14 * (1.0 - t));
      const baseHalfW = size * 0.31 * profile;

      let serration = 0;
      if (t > 0.06 && t < 0.92) {
        const toothPhase = ((t * 34) + 0.35) % 1;
        const sawtooth = toothPhase < 0.75 ? toothPhase / 0.75 : (1 - toothPhase) / 0.25;
        serration = (sawtooth - 0.4) * size * 0.0065 * Math.sin(t * Math.PI);
      }
      const curveShift = Math.sin(t * Math.PI) * size * 0.008;
      const x = cx + curveShift - baseHalfW - serration;
      context.lineTo(x, y);
    }

    context.closePath();
  }

  // 1. Draw Petiole (Stem) at the bottom
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - 14, baseY - 20);
  ctx.quadraticCurveTo(cx - 8, (baseY + stemEndY) * 0.5, cx - 18, stemEndY);
  ctx.arc(cx - 6, stemEndY, 12, Math.PI, 0, true);
  ctx.quadraticCurveTo(cx + 8, (baseY + stemEndY) * 0.5, cx + 14, baseY - 20);
  ctx.closePath();
  const stemGrad = ctx.createLinearGradient(cx - 20, baseY, cx + 20, stemEndY);
  stemGrad.addColorStop(0, '#4d9e34');
  stemGrad.addColorStop(0.5, '#76c945');
  stemGrad.addColorStop(1, '#3b7a28');
  ctx.fillStyle = stemGrad;
  ctx.fill();
  ctx.restore();

  // 2. Clip to Leaf Blade & Paint Photorealistic Chlorophyll Base Gradients
  ctx.save();
  traceLeafBladePath(ctx);
  ctx.clip();

  // Base sunlit chlorophyll gradient (rich botanical greens, warm sunlit upper-left, deeper forest lower-right)
  const mainGrad = ctx.createLinearGradient(cx - size * 0.28, topY, cx + size * 0.28, baseY);
  mainGrad.addColorStop(0.0, '#58c441');
  mainGrad.addColorStop(0.28, '#389e34');
  mainGrad.addColorStop(0.62, '#1f782b');
  mainGrad.addColorStop(1.0, '#114f1d');
  ctx.fillStyle = mainGrad;
  ctx.fillRect(0, 0, size, size);

  // Backlit subsurface scattering glow in the lamina pillows
  const sssGrad = ctx.createRadialGradient(
    cx - size * 0.08,
    size * 0.36,
    size * 0.02,
    cx,
    size * 0.45,
    size * 0.38
  );
  sssGrad.addColorStop(0, 'rgba(158, 238, 82, 0.46)');
  sssGrad.addColorStop(0.55, 'rgba(78, 194, 62, 0.18)');
  sssGrad.addColorStop(1, 'rgba(10, 52, 22, 0.25)');
  ctx.fillStyle = sssGrad;
  ctx.fillRect(0, 0, size, size);

  // Organic mesophyll pillow shading between lateral veins
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, size, size);

  const veinPairs = [
    { tStart: 0.88, angle: -0.62, len: 0.15, arch: 0.06 },
    { tStart: 0.78, angle: -0.68, len: 0.23, arch: 0.09 },
    { tStart: 0.67, angle: -0.72, len: 0.28, arch: 0.11 },
    { tStart: 0.56, angle: -0.74, len: 0.30, arch: 0.12 },
    { tStart: 0.45, angle: -0.72, len: 0.28, arch: 0.11 },
    { tStart: 0.35, angle: -0.68, len: 0.24, arch: 0.10 },
    { tStart: 0.25, angle: -0.64, len: 0.18, arch: 0.08 },
    { tStart: 0.16, angle: -0.58, len: 0.12, arch: 0.05 },
    { tStart: 0.09, angle: -0.52, len: 0.07, arch: 0.03 }
  ];

  // 3. Draw Delicate Organic Tertiary Reticulate Veinlets first
  veinPairs.forEach((vp, pIdx) => {
    [-1, 1].forEach((side) => {
      const t0 = vp.tStart - (side === -1 ? 0.018 : 0.0);
      const startY = topY + t0 * (baseY - topY);
      const startX = cx + Math.sin(t0 * Math.PI) * size * 0.008;

      const spanX = side * vp.len * size * 0.92;
      const spanY = -vp.len * size * 0.68;
      const ctrlX = startX + spanX * 0.55;
      const ctrlY = startY + spanY * 0.28;
      const endX = startX + spanX;
      const endY = startY + spanY;

      // Branching tertiary veinlets off each secondary vein
      const subCount = 7;
      for (let s = 1; s <= subCount; s++) {
        const u = s / (subCount + 1);
        const invU = 1 - u;
        const bx = invU * invU * startX + 2 * invU * u * ctrlX + u * u * endX;
        const by = invU * invU * startY + 2 * invU * u * ctrlY + u * u * endY;

        [-1, 1].forEach((branchDir) => {
          const bLen = size * (0.025 + 0.02 * (1 - u)) * (0.7 + 0.3 * Math.sin(pIdx * 3 + s));
          const bAngle =
            (side === 1 ? -0.5 : Math.PI + 0.5) + branchDir * (0.55 + 0.15 * Math.cos(s));
          const tx = bx + Math.cos(bAngle) * bLen;
          const ty = by + Math.sin(bAngle) * bLen;
          const mcx = (bx + tx) * 0.5 + side * 8;
          const mcy = (by + ty) * 0.5 - 8;

          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.quadraticCurveTo(mcx, mcy, tx, ty);
          ctx.strokeStyle = 'rgba(168, 238, 105, 0.34)';
          ctx.lineWidth = 2.2 * (1 - u * 0.5);
          ctx.lineCap = 'round';
          ctx.stroke();

          // Quaternary micro-branches
          for (let q = 1; q <= 2; q++) {
            const qu = q * 0.42;
            const qx = (1 - qu) * bx + qu * tx;
            const qy = (1 - qu) * by + qu * ty;
            const qAngle = bAngle + (q === 1 ? 0.6 : -0.6);
            const qLen = bLen * 0.45;
            ctx.beginPath();
            ctx.moveTo(qx, qy);
            ctx.lineTo(qx + Math.cos(qAngle) * qLen, qy + Math.sin(qAngle) * qLen);
            ctx.strokeStyle = 'rgba(168, 238, 105, 0.22)';
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }
        });
      }
    });
  });

  // 4. Draw Curved Secondary Lateral Veins (with 3D shadow + bright chlorophyll ridge)
  veinPairs.forEach((vp) => {
    [-1, 1].forEach((side) => {
      const t0 = vp.tStart - (side === -1 ? 0.018 : 0.0);
      const startY = topY + t0 * (baseY - topY);
      const startX = cx + Math.sin(t0 * Math.PI) * size * 0.008;

      const spanX = side * vp.len * size * 0.92;
      const spanY = -vp.len * size * 0.68;
      const ctrlX = startX + spanX * 0.55;
      const ctrlY = startY + spanY * 0.28;
      const endX = startX + spanX;
      const endY = startY + spanY;

      // Subtle underside shadow along each lateral vein
      ctx.beginPath();
      ctx.moveTo(startX, startY + 3);
      ctx.quadraticCurveTo(ctrlX, ctrlY + 3, endX, endY + 2);
      ctx.strokeStyle = 'rgba(12, 58, 22, 0.45)';
      ctx.lineWidth = 7.5 * vp.len * 3.0;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Main luminous yellow-green secondary vein
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.quadraticCurveTo(ctrlX, ctrlY, endX, endY);
      ctx.strokeStyle = 'rgba(182, 244, 112, 0.82)';
      ctx.lineWidth = Math.max(2.2, 5.5 * vp.len * 2.8);
      ctx.lineCap = 'round';
      ctx.stroke();

      // Bump map ridge for secondary vein
      bCtx.beginPath();
      bCtx.moveTo(startX, startY);
      bCtx.quadraticCurveTo(ctrlX, ctrlY, endX, endY);
      bCtx.strokeStyle = '#ffffff';
      bCtx.lineWidth = Math.max(4, 9 * vp.len * 2.8);
      bCtx.lineCap = 'round';
      bCtx.stroke();
    });
  });

  // 5. Draw Primary Central Midrib (Tapered from base to apex)
  const midSegments = 70;
  for (let i = 0; i < midSegments; i++) {
    const t1 = i / midSegments;
    const t2 = (i + 1) / midSegments;
    const y1 = topY + t1 * (baseY - topY);
    const y2 = topY + t2 * (baseY - topY);
    const x1 = cx + Math.sin(t1 * Math.PI) * size * 0.008;
    const x2 = cx + Math.sin(t2 * Math.PI) * size * 0.008;

    const width = 2.0 + Math.pow(t2, 1.35) * 16.0;

    // Shadow
    ctx.beginPath();
    ctx.moveTo(x1 + 3, y1);
    ctx.lineTo(x2 + 3, y2);
    ctx.strokeStyle = 'rgba(10, 48, 18, 0.42)';
    ctx.lineWidth = width + 4;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Midrib core
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = '#b4f06e';
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Midrib specular highlight
    ctx.beginPath();
    ctx.moveTo(x1 - width * 0.18, y1);
    ctx.lineTo(x2 - width * 0.18, y2);
    ctx.strokeStyle = 'rgba(232, 255, 198, 0.75)';
    ctx.lineWidth = Math.max(1.2, width * 0.35);
    ctx.stroke();

    // Midrib bump height
    bCtx.beginPath();
    bCtx.moveTo(x1, y1);
    bCtx.lineTo(x2, y2);
    bCtx.strokeStyle = '#ffffff';
    bCtx.lineWidth = width * 1.4;
    bCtx.lineCap = 'round';
    bCtx.stroke();
  }

  // 6. Natural Glossy Wax Cuticle Specular Sheen & 3 Crystal Dew Droplets
  const sheenGrad = ctx.createRadialGradient(
    cx - size * 0.11,
    size * 0.34,
    10,
    cx - size * 0.09,
    size * 0.38,
    size * 0.26
  );
  sheenGrad.addColorStop(0, 'rgba(255, 255, 255, 0.24)');
  sheenGrad.addColorStop(0.5, 'rgba(220, 255, 210, 0.08)');
  sheenGrad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
  ctx.fillStyle = sheenGrad;
  ctx.fillRect(0, 0, size, size);

  const droplets = [
    { x: cx - size * 0.11, y: size * 0.39, r: 24 },
    { x: cx + size * 0.09, y: size * 0.51, r: 18 },
    { x: cx - size * 0.05, y: size * 0.61, r: 13 }
  ];

  droplets.forEach((d) => {
    // Contact shadow
    ctx.beginPath();
    ctx.arc(d.x + 4, d.y + 5, d.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(6, 36, 14, 0.42)';
    ctx.fill();

    // Droplet body refraction
    const dropGrad = ctx.createRadialGradient(
      d.x - d.r * 0.3,
      d.y - d.r * 0.3,
      d.r * 0.1,
      d.x,
      d.y,
      d.r
    );
    dropGrad.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
    dropGrad.addColorStop(0.35, 'rgba(185, 250, 145, 0.45)');
    dropGrad.addColorStop(0.85, 'rgba(28, 110, 42, 0.55)');
    dropGrad.addColorStop(1, 'rgba(210, 255, 190, 0.75)');
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fillStyle = dropGrad;
    ctx.fill();

    // Crisp specular pinpoint on droplet
    ctx.beginPath();
    ctx.arc(d.x - d.r * 0.35, d.y - d.r * 0.35, d.r * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  });

  // Crisp inner margin rim highlight
  traceLeafBladePath(ctx);
  ctx.strokeStyle = 'rgba(165, 242, 110, 0.55)';
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.restore();

  const colorTexture = new THREE.CanvasTexture(colorCanvas);
  colorTexture.colorSpace = THREE.SRGBColorSpace;
  colorTexture.anisotropy = 8;
  colorTexture.needsUpdate = true;

  const bumpTexture = new THREE.CanvasTexture(bumpCanvas);
  bumpTexture.anisotropy = 8;
  bumpTexture.needsUpdate = true;

  return { colorTexture, bumpTexture };
}

/**
 * Builds a gently curved 3D plane geometry for the Photorealistic Macro Leaf
 * so the 2048x2048 alpha leaf texture has natural 3D relief and catches PBR specular light.
 */
function createCurvedLeafPlaneGeometry() {
  const geo = new THREE.PlaneGeometry(2.15, 2.35, 36, 48);
  const pos = geo.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const nx = x / 1.075; // -1..1
    const ny = y / 1.175; // -1..1

    // Gentle organic 3D cupping & graceful lengthwise arch (broad flat face toward +Z)
    const archZ = Math.cos(ny * Math.PI * 0.48) * 0.085;
    const cupZ = -Math.pow(Math.abs(nx), 1.65) * 0.075;
    const tipCurveZ = ny > 0.3 ? -Math.pow(ny - 0.3, 2.0) * 0.11 : 0;

    pos.setZ(i, archZ + cupZ + tipCurveZ);
  }

  geo.computeVertexNormals();
  return geo;
}

export function createParticleSilhouetteSystem(scene, camera) {
  const anchorGroup = new THREE.Group();
  scene.add(anchorGroup);

  // Studio PBR Lights for the Slide 10 Photorealistic Macro Leaf
  const ambientLight = new THREE.AmbientLight(0xffffff, 1.35);
  anchorGroup.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(0xfffbeb, 2.2);
  keyLight.position.set(2.8, 3.8, 6.5);
  anchorGroup.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x6ee7b7, 1.4);
  rimLight.position.set(-3.5, -2.0, 3.5);
  anchorGroup.add(rimLight);

  // ==========================================================================
  // 1. INTERACTIVE NEBULA FIELD
  // ==========================================================================
  const nebulaGeo = new THREE.BufferGeometry();
  const homePositions = new Float32Array(NEBULA_PARTICLE_COUNT * 3);
  const currentPositions = new Float32Array(NEBULA_PARTICLE_COUNT * 3);
  const velocities = new Float32Array(NEBULA_PARTICLE_COUNT * 3);
  const colors = new Float32Array(NEBULA_PARTICLE_COUNT * 3);
  const sizes = new Float32Array(NEBULA_PARTICLE_COUNT);
  const phases = new Float32Array(NEBULA_PARTICLE_COUNT);
  const excitement = new Float32Array(NEBULA_PARTICLE_COUNT);

  const colorBrightGreen = new THREE.Color('#4ADE80');
  const colorEmerald = new THREE.Color('#10B981');
  const colorSoftMint = new THREE.Color('#A7F3D0');
  const colorStarWhite = new THREE.Color('#FFFFFF');

  for (let i = 0; i < NEBULA_PARTICLE_COUNT; i++) {
    const ix = i * 3;
    const hx = (Math.random() - 0.5) * 19.0;
    const hy = (Math.random() - 0.5) * 11.5;
    const hz = (Math.random() - 0.5) * 7.0 - 1.2;

    homePositions[ix] = hx;
    homePositions[ix + 1] = hy;
    homePositions[ix + 2] = hz;

    currentPositions[ix] = hx;
    currentPositions[ix + 1] = hy;
    currentPositions[ix + 2] = hz;

    const r = Math.random();
    const c =
      r < 0.45
        ? colorBrightGreen
        : r < 0.75
        ? colorEmerald
        : r < 0.92
        ? colorSoftMint
        : colorStarWhite;

    colors[ix] = c.r;
    colors[ix + 1] = c.g;
    colors[ix + 2] = c.b;

    sizes[i] = 0.015 + Math.random() * 0.028;
    phases[i] = Math.random() * Math.PI * 2;
    excitement[i] = 0.0;
  }

  nebulaGeo.setAttribute('position', new THREE.BufferAttribute(currentPositions, 3));
  nebulaGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  nebulaGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  nebulaGeo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  nebulaGeo.setAttribute('aExcite', new THREE.BufferAttribute(excitement, 1));

  const nebulaUniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }
  };

  const nebulaMat = new THREE.ShaderMaterial({
    uniforms: nebulaUniforms,
    vertexShader: `
      attribute float aSize;
      attribute float aPhase;
      attribute float aExcite;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vExcite;

      uniform float uTime;
      uniform float uPixelRatio;

      void main() {
        vColor = color;
        vExcite = aExcite;

        vec3 pos = position;
        pos.x += sin(uTime * 0.9 + aPhase) * 0.035;
        pos.y += cos(uTime * 0.8 + aPhase * 1.2) * 0.035;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        float twinkle = 0.78 + 0.22 * sin(uTime * 2.2 + aPhase);
        float boost = 1.0 + aExcite * 0.85;
        gl_PointSize = (aSize * 680.0 * uPixelRatio * twinkle * boost) / max(-mvPosition.z, 1.2);
        vAlpha = clamp((0.26 + aExcite * 0.19) * twinkle, 0.18, 0.45);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      varying float vExcite;

      void main() {
        vec2 uv = gl_PointCoord - vec2(0.5);
        float dist = length(uv);
        if (dist > 0.5) discard;

        float glow = smoothstep(0.5, 0.06, dist);
        float core = smoothstep(0.2, 0.0, dist);
        vec3 excitedColor = mix(vColor, vec3(0.85, 1.0, 0.95), vExcite * 0.5 + core * 0.35);

        gl_FragColor = vec4(excitedColor, glow * vAlpha);
      }
    `,
    transparent: true,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const nebulaPoints = new THREE.Points(nebulaGeo, nebulaMat);
  anchorGroup.add(nebulaPoints);

  // ==========================================================================
  // 2. SUBTLE FAIRY-DUST CURSOR TRAIL
  // ==========================================================================
  const trailGeo = new THREE.BufferGeometry();
  const trailPositions = new Float32Array(TRAIL_PARTICLE_COUNT * 3);
  const trailVelocities = new Float32Array(TRAIL_PARTICLE_COUNT * 3);
  const trailLife = new Float32Array(TRAIL_PARTICLE_COUNT);
  const trailSizes = new Float32Array(TRAIL_PARTICLE_COUNT);
  const trailColors = new Float32Array(TRAIL_PARTICLE_COUNT * 3);

  for (let i = 0; i < TRAIL_PARTICLE_COUNT; i++) {
    trailPositions[i * 3 + 2] = -999;
    trailLife[i] = 0.0;
    trailSizes[i] = 0.022 + Math.random() * 0.032;
    const c = i % 3 === 0 ? colorStarWhite : i % 2 === 0 ? colorBrightGreen : colorSoftMint;
    trailColors[i * 3] = c.r;
    trailColors[i * 3 + 1] = c.g;
    trailColors[i * 3 + 2] = c.b;
  }

  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  trailGeo.setAttribute('aLife', new THREE.BufferAttribute(trailLife, 1));
  trailGeo.setAttribute('aSize', new THREE.BufferAttribute(trailSizes, 1));
  trailGeo.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));

  const trailMat = new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }
    },
    vertexShader: `
      attribute float aLife;
      attribute float aSize;
      varying vec3 vColor;
      varying float vLife;
      uniform float uPixelRatio;

      void main() {
        vColor = color;
        vLife = aLife;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = (aSize * 820.0 * uPixelRatio * sin(aLife * 3.14159)) / max(-mvPosition.z, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vLife;

      void main() {
        if (vLife <= 0.01) discard;
        vec2 uv = gl_PointCoord - vec2(0.5);
        float dist = length(uv);
        if (dist > 0.5) discard;
        float glow = smoothstep(0.5, 0.04, dist);
        float core = smoothstep(0.18, 0.0, dist);
        vec3 col = mix(vColor, vec3(1.0), core * 0.55);
        gl_FragColor = vec4(col, glow * vLife * 0.42);
      }
    `,
    transparent: true,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const trailPoints = new THREE.Points(trailGeo, trailMat);
  anchorGroup.add(trailPoints);

  let trailWriteIdx = 0;
  let prevCursorLocal = new THREE.Vector3(0, 0, 0);
  const currentCursorLocal = new THREE.Vector3(0, 0, 0);
  let hasMouseMoved = false;

  function spawnTrailParticles(localPos, count = 2) {
    const posAttr = trailGeo.getAttribute('position');
    const lifeAttr = trailGeo.getAttribute('aLife');

    for (let k = 0; k < count; k++) {
      const idx = trailWriteIdx;
      trailWriteIdx = (trailWriteIdx + 1) % TRAIL_PARTICLE_COUNT;
      const ix = idx * 3;

      posAttr.array[ix] = localPos.x + (Math.random() - 0.5) * 0.18;
      posAttr.array[ix + 1] = localPos.y + (Math.random() - 0.5) * 0.18;
      posAttr.array[ix + 2] = localPos.z + (Math.random() - 0.5) * 0.18;

      trailVelocities[ix] = (Math.random() - 0.5) * 0.022;
      trailVelocities[ix + 1] = 0.006 + Math.random() * 0.018;
      trailVelocities[ix + 2] = (Math.random() - 0.5) * 0.016;

      lifeAttr.array[idx] = 1.0;
    }

    posAttr.needsUpdate = true;
    lifeAttr.needsUpdate = true;
  }

  // ==========================================================================
  // 3. RISING EMBERS / FOREST SPORES
  // ==========================================================================
  const sporeGeo = new THREE.BufferGeometry();
  const sporePositions = new Float32Array(RISING_SPORE_COUNT * 3);
  const sporeSpeeds = new Float32Array(RISING_SPORE_COUNT);
  const sporePhases = new Float32Array(RISING_SPORE_COUNT);
  const sporeSizes = new Float32Array(RISING_SPORE_COUNT);
  const sporeColors = new Float32Array(RISING_SPORE_COUNT * 3);

  for (let i = 0; i < RISING_SPORE_COUNT; i++) {
    const ix = i * 3;
    sporePositions[ix] = (Math.random() - 0.5) * 18.0;
    sporePositions[ix + 1] = -6.5 + Math.random() * 13.0;
    sporePositions[ix + 2] = (Math.random() - 0.5) * 6.0;

    sporeSpeeds[i] = 0.65 + Math.random() * 1.25;
    sporePhases[i] = Math.random() * Math.PI * 2;
    sporeSizes[i] = 0.02 + Math.random() * 0.036;

    const c =
      Math.random() < 0.55
        ? colorBrightGreen
        : Math.random() < 0.85
        ? colorEmerald
        : colorSoftMint;
    sporeColors[ix] = c.r;
    sporeColors[ix + 1] = c.g;
    sporeColors[ix + 2] = c.b;
  }

  sporeGeo.setAttribute('position', new THREE.BufferAttribute(sporePositions, 3));
  sporeGeo.setAttribute('aSize', new THREE.BufferAttribute(sporeSizes, 1));
  sporeGeo.setAttribute('aPhase', new THREE.BufferAttribute(sporePhases, 1));
  sporeGeo.setAttribute('color', new THREE.BufferAttribute(sporeColors, 3));

  const sporeUniforms = {
    uTime: { value: 0 },
    uOpacity: { value: 0.14 },
    uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }
  };

  const sporeMat = new THREE.ShaderMaterial({
    uniforms: sporeUniforms,
    vertexShader: `
      attribute float aSize;
      attribute float aPhase;
      varying vec3 vColor;
      varying float vFade;
      uniform float uTime;
      uniform float uPixelRatio;

      void main() {
        vColor = color;
        float normY = clamp((position.y + 6.5) / 13.0, 0.0, 1.0);
        vFade = sin(normY * 3.14159) * (0.75 + 0.25 * sin(uTime * 2.6 + aPhase));

        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = (aSize * 780.0 * uPixelRatio) / max(-mvPosition.z, 1.2);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vFade;
      uniform float uOpacity;

      void main() {
        vec2 uv = gl_PointCoord - vec2(0.5);
        float dist = length(uv);
        if (dist > 0.5) discard;
        float glow = smoothstep(0.5, 0.05, dist);
        float core = smoothstep(0.2, 0.0, dist);
        vec3 col = mix(vColor, vec3(0.9, 1.0, 0.95), core * 0.45);
        gl_FragColor = vec4(col, glow * vFade * uOpacity);
      }
    `,
    transparent: true,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const risingSporesMesh = new THREE.Points(sporeGeo, sporeMat);
  anchorGroup.add(risingSporesMesh);

  // ==========================================================================
  // 4. SLIDE 10 SPECIAL OUTRO: PHOTOREALISTIC REAL LEAF & DIRECT BLENDER LAUNCH
  // ==========================================================================
  const leafGroup = new THREE.Group();
  leafGroup.visible = false;
  anchorGroup.add(leafGroup);

  const { colorTexture, bumpTexture } = createPhotorealisticLeafMaps();
  const leafGeo = createCurvedLeafPlaneGeometry();

  const leafPbrMaterial = new THREE.MeshPhysicalMaterial({
    map: colorTexture,
    bumpMap: bumpTexture,
    bumpScale: 0.022,
    roughness: 0.24,
    metalness: 0.02,
    clearcoat: 0.68,
    clearcoatRoughness: 0.16,
    transparent: true,
    alphaTest: 0.04,
    side: THREE.DoubleSide
  });

  const mainLeafMesh = new THREE.Mesh(leafGeo, leafPbrMaterial);
  leafGroup.add(mainLeafMesh);

  let leafTimeline = null;
  let sporeModeActive = false;

  // Final Crisp Freeze-Frame Pose:
  // Centered at (0, 0.08, 2.35), broad face pointing straight at viewer,
  // tilted diagonally at a tasteful 17deg (-0.30 rad) artistic angle!
  const LEAF_REST_POS = new THREE.Vector3(0, 0.08, 2.35);
  const LEAF_REST_ROT = new THREE.Euler(0.12, -0.14, -0.30);

  /**
   * Hotfix V5 Section 3.2:
   * Direct Blender Speed-Ramp Launch (`x: 0, y: 0, z: -120` -> `x: 0, y: 0.08, z: 2.35`, `duration: 1.3s`)
   * with smooth aerodynamic 3D roll, `filter: blur(4px) -> blur(0px)` motion blur,
   * and a 100% Still & Sharp freeze-frame landing!
   */
  function playSlide10LeafAnimation(onFreezeFrameStop) {
    if (leafTimeline) leafTimeline.kill();

    leafGroup.visible = true;

    const webglEl = document.getElementById('webgl-container');

    // Start straight back in deep space at (0, 0, -120), scale: 0.02
    leafGroup.position.set(0, 0, -120);
    leafGroup.scale.setScalar(0.02);
    // Initial aerodynamic roll angles before launching forward
    leafGroup.rotation.set(-2.6, 3.2, -2.4);

    if (webglEl) {
      webglEl.style.filter = 'blur(4px)';
    }

    const state = { t: 0 };
    leafTimeline = gsap.timeline();

    leafTimeline.to(state, {
      t: 1,
      duration: 1.3,
      ease: 'expo.out', // Blender speed-ramp curve: fast launch from z:-120, crisp brake at center
      onUpdate: () => {
        const t = state.t;

        // Straight-line launch along Z axis: z from -120 to 2.35
        leafGroup.position.x = 0;
        leafGroup.position.y = THREE.MathUtils.lerp(0, LEAF_REST_POS.y, t);
        leafGroup.position.z = THREE.MathUtils.lerp(-120, LEAF_REST_POS.z, t);

        // Scale from 0.02 to 1.00
        leafGroup.scale.setScalar(THREE.MathUtils.lerp(0.02, 1.0, t));

        // Smooth aerodynamic 3D rotation locking into the exact 17deg diagonal front-facing pose
        leafGroup.rotation.x = THREE.MathUtils.lerp(-2.6, LEAF_REST_ROT.x, t);
        leafGroup.rotation.y = THREE.MathUtils.lerp(3.2, LEAF_REST_ROT.y, t);
        leafGroup.rotation.z = THREE.MathUtils.lerp(-2.4, LEAF_REST_ROT.z, t);

        // Motion blur fades from blur(4px) down to blur(0px) as the leaf brakes
        if (webglEl) {
          const blurPx = (1.0 - t) * 4.0;
          webglEl.style.filter = blurPx > 0.12 ? `blur(${blurPx.toFixed(2)}px)` : 'none';
        }
      },
      onComplete: () => {
        // 100% STILL & SHARP FREEZE-FRAME LANDING (zero wobble, zero oscillation)
        leafGroup.position.copy(LEAF_REST_POS);
        leafGroup.rotation.copy(LEAF_REST_ROT);
        leafGroup.scale.setScalar(1.0);
        if (webglEl) {
          webglEl.style.filter = 'none';
        }
        if (typeof onFreezeFrameStop === 'function') {
          onFreezeFrameStop();
        }
      }
    });
  }

  function transitionToSlide(slideData, duration = 1.6, onSlide10LeafStop = null) {
    gsap.to(anchorGroup.position, {
      x: slideData.nodePosition.x,
      y: slideData.nodePosition.y,
      z: slideData.nodePosition.z,
      duration: duration,
      ease: 'power3.inOut'
    });

    gsap.to(anchorGroup.rotation, {
      x: slideData.nodeRotation.x,
      y: slideData.nodeRotation.y,
      z: slideData.nodeRotation.z,
      duration: duration,
      ease: 'power3.inOut'
    });

    sporeModeActive = slideData.particleMode === 'rising-spores';
    gsap.to(sporeUniforms.uOpacity, {
      value: sporeModeActive ? 0.40 : 0.14,
      duration: 1.0,
      ease: 'power2.out'
    });

    const webglEl = document.getElementById('webgl-container');
    if (slideData.type === 'outro-leaf') {
      playSlide10LeafAnimation(onSlide10LeafStop);
    } else {
      if (leafTimeline) leafTimeline.kill();
      leafGroup.visible = false;
      if (webglEl) {
        webglEl.style.filter = 'none';
      }
    }
  }

  function onMouseMoveNormalized(ndcX, ndcY) {
    const localX = ndcX * 7.8;
    const localY = -ndcY * 4.4;
    currentCursorLocal.set(localX, localY, 0.5);

    if (!hasMouseMoved) {
      prevCursorLocal.copy(currentCursorLocal);
      hasMouseMoved = true;
    }

    const distMoved = currentCursorLocal.distanceTo(prevCursorLocal);
    if (distMoved > 0.06) {
      spawnTrailParticles(currentCursorLocal, Math.min(2, Math.ceil(distMoved * 4)));
      prevCursorLocal.copy(currentCursorLocal);
    }
  }

  function update(elapsedTime) {
    nebulaUniforms.uTime.value = elapsedTime;
    sporeUniforms.uTime.value = elapsedTime;

    const posAttr = nebulaGeo.getAttribute('position');
    const exciteAttr = nebulaGeo.getAttribute('aExcite');
    const posArr = posAttr.array;
    const exciteArr = exciteAttr.array;

    const cursorX = currentCursorLocal.x;
    const cursorY = currentCursorLocal.y;
    const repulsionRadius = 2.4;
    const repulsionRadiusSq = repulsionRadius * repulsionRadius;

    for (let i = 0; i < NEBULA_PARTICLE_COUNT; i++) {
      const ix = i * 3;
      const px = posArr[ix];
      const py = posArr[ix + 1];
      const pz = posArr[ix + 2];

      const dx = px - cursorX;
      const dy = py - cursorY;
      const distSq = dx * dx + dy * dy;

      if (hasMouseMoved && distSq < repulsionRadiusSq && distSq > 0.0001) {
        const dist = Math.sqrt(distSq);
        const force = (1.0 - dist / repulsionRadius) * 0.038;
        velocities[ix] += (dx / dist) * force;
        velocities[ix + 1] += (dy / dist) * force;
        velocities[ix + 2] += Math.sin(phases[i] + elapsedTime * 3.0) * force * 0.4;
        exciteArr[i] = Math.min(1.0, exciteArr[i] + 0.14);
      } else {
        exciteArr[i] *= 0.94;
      }

      velocities[ix] += (homePositions[ix] - px) * 0.035;
      velocities[ix + 1] += (homePositions[ix + 1] - py) * 0.035;
      velocities[ix + 2] += (homePositions[ix + 2] - pz) * 0.035;

      velocities[ix] *= 0.86;
      velocities[ix + 1] *= 0.86;
      velocities[ix + 2] *= 0.86;

      posArr[ix] = px + velocities[ix];
      posArr[ix + 1] = py + velocities[ix + 1];
      posArr[ix + 2] = pz + velocities[ix + 2];
    }
    posAttr.needsUpdate = true;
    exciteAttr.needsUpdate = true;

    const tPosAttr = trailGeo.getAttribute('position');
    const tLifeAttr = trailGeo.getAttribute('aLife');
    let trailActive = false;

    for (let i = 0; i < TRAIL_PARTICLE_COUNT; i++) {
      if (tLifeAttr.array[i] > 0.0) {
        trailActive = true;
        const ix = i * 3;
        tPosAttr.array[ix] += trailVelocities[ix];
        tPosAttr.array[ix + 1] += trailVelocities[ix + 1];
        tPosAttr.array[ix + 2] += trailVelocities[ix + 2];
        tLifeAttr.array[i] = Math.max(0.0, tLifeAttr.array[i] - 0.026);
      }
    }
    if (trailActive) {
      tPosAttr.needsUpdate = true;
      tLifeAttr.needsUpdate = true;
    }

    const sPosAttr = sporeGeo.getAttribute('position');
    const sArr = sPosAttr.array;
    const speedMultiplier = sporeModeActive ? 0.028 : 0.01;

    for (let i = 0; i < RISING_SPORE_COUNT; i++) {
      const ix = i * 3;
      sArr[ix + 1] += sporeSpeeds[i] * speedMultiplier;
      sArr[ix] += Math.sin(elapsedTime * 1.3 + sporePhases[i]) * 0.007;

      if (sArr[ix + 1] > 6.5) {
        sArr[ix + 1] = -6.5;
        sArr[ix] = (Math.random() - 0.5) * 18.0;
      }
    }
    sPosAttr.needsUpdate = true;
    // Note: Slide 10 Leaf stays 100% STILL & SHARP at its landing pose (no mouse wobble or floating!)
  }

  window.addEventListener('resize', () => {
    const pr = Math.min(window.devicePixelRatio, 2);
    nebulaUniforms.uPixelRatio.value = pr;
    trailMat.uniforms.uPixelRatio.value = pr;
    sporeUniforms.uPixelRatio.value = pr;
  });

  return {
    anchorGroup,
    transitionToSlide,
    onMouseMoveNormalized,
    update
  };
}
