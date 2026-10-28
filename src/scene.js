import * as THREE from 'three';
import gsap from 'gsap';

/**
 * Creates the 3D scene, perspective camera, WebGLRenderer,
 * and 3-layer volumetric Bioluminescent Emerald & Deep Forest Nebula fog.
 */

function createSoftCloudTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(128, 128, 8, 128, 128, 124);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  gradient.addColorStop(0.32, 'rgba(255, 255, 255, 0.55)');
  gradient.addColorStop(0.68, 'rgba(255, 255, 255, 0.16)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0.0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export function createSceneSystem(container) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x031810, 0.012);

  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    450
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

  container.appendChild(renderer.domElement);

  const cloudTexture = createSoftCloudTexture();
  const nebulaGroup = new THREE.Group();
  scene.add(nebulaGroup);

  const layerConfigs = [
    {
      name: 'deepForest',
      color: 0x0a3d28,
      opacity: 0.32,
      count: 65,
      scaleMin: 12,
      scaleMax: 28,
      rotSpeed: 0.0005,
      driftSpeed: 0.15
    },
    {
      name: 'bioluminescentEmerald',
      color: 0x10b981,
      opacity: 0.14,
      count: 50,
      scaleMin: 9,
      scaleMax: 22,
      rotSpeed: -0.0007,
      driftSpeed: 0.24
    },
    {
      name: 'forestJade',
      color: 0x047857,
      opacity: 0.22,
      count: 55,
      scaleMin: 11,
      scaleMax: 24,
      rotSpeed: 0.0006,
      driftSpeed: 0.19
    }
  ];

  const cloudMeshes = [];
  const layerMaterials = [];
  const planeGeo = new THREE.PlaneGeometry(1, 1);

  layerConfigs.forEach((layer, layerIndex) => {
    const material = new THREE.MeshBasicMaterial({
      map: cloudTexture,
      color: layer.color,
      transparent: true,
      opacity: layer.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    material.userData = { baseOpacity: layer.opacity };
    layerMaterials.push(material);

    for (let i = 0; i < layer.count; i++) {
      const mesh = new THREE.Mesh(planeGeo, material);
      const scale =
        layer.scaleMin + Math.random() * (layer.scaleMax - layer.scaleMin);
      mesh.scale.set(scale, scale, 1);

      const zPos = 18 - Math.random() * 210;
      const xPos = (Math.random() - 0.42) * 54;
      const yPos = (Math.random() - 0.5) * 34;

      mesh.position.set(xPos, yPos, zPos);
      mesh.rotation.z = Math.random() * Math.PI * 2;

      mesh.userData = {
        baseX: xPos,
        baseY: yPos,
        baseZ: zPos,
        rotSpeed: layer.rotSpeed * (0.7 + Math.random() * 0.6),
        driftSpeed: layer.driftSpeed,
        phaseOffset: Math.random() * Math.PI * 2 + layerIndex
      };

      nebulaGroup.add(mesh);
      cloudMeshes.push(mesh);
    }
  });

  // Hotfix 1.2: Ambient dust reduced by 70% (950 -> 280), size reduced 30%, opacity 0.24
  const dustCount = 280;
  const dustGeo = new THREE.BufferGeometry();
  const dustPositions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPositions[i * 3] = (Math.random() - 0.5) * 78;
    dustPositions[i * 3 + 1] = (Math.random() - 0.5) * 46;
    dustPositions[i * 3 + 2] = 20 - Math.random() * 215;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dustMat = new THREE.PointsMaterial({
    map: cloudTexture,
    color: 0x6ee7b7,
    size: 0.15,
    transparent: true,
    opacity: 0.24,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const ambientDust = new THREE.Points(dustGeo, dustMat);
  scene.add(ambientDust);

  function pulseVolumetricFog(peakDensity = 0.085, surgeIn = 0.5, partOut = 0.95) {
    gsap.killTweensOf(scene.fog);
    const fogTl = gsap.timeline();
    fogTl.to(scene.fog, {
      density: peakDensity,
      duration: surgeIn,
      ease: 'power2.in'
    });
    fogTl.to(scene.fog, {
      density: 0.012,
      duration: partOut,
      ease: 'power3.out'
    });

    layerMaterials.forEach((mat) => {
      gsap.killTweensOf(mat);
      gsap.to(mat, {
        opacity: Math.min(0.82, mat.userData.baseOpacity * 2.5),
        duration: surgeIn,
        ease: 'power2.in',
        onComplete: () => {
          gsap.to(mat, {
            opacity: mat.userData.baseOpacity,
            duration: partOut,
            ease: 'power3.out'
          });
        }
      });
    });
  }

  function updateNebula(elapsedTime) {
    for (let i = 0; i < cloudMeshes.length; i++) {
      const m = cloudMeshes[i];
      const u = m.userData;
      m.rotation.z += u.rotSpeed;
      m.position.x =
        u.baseX + Math.sin(elapsedTime * u.driftSpeed + u.phaseOffset) * 0.9;
      m.position.y =
        u.baseY + Math.cos(elapsedTime * u.driftSpeed * 0.8 + u.phaseOffset) * 0.65;
    }
    ambientDust.rotation.y = Math.sin(elapsedTime * 0.04) * 0.03;
  }

  function handleResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  window.addEventListener('resize', handleResize);

  return {
    scene,
    camera,
    renderer,
    updateNebula,
    pulseVolumetricFog
  };
}
