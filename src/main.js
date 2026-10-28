import * as THREE from 'three';
import gsap from 'gsap';
import { SLIDES_DATA, INTERSTITIAL_QA_BY_SLIDE_ID } from './slidesData.js';
import { createSceneSystem } from './scene.js';
import { createParticleSilhouetteSystem } from './particles.js';
import { createCameraDirector } from './cameraDirector.js';
import { createAssistant3DSystem } from './assistant3D.js';

// ============================================================================
// SECTION 2: SMART BACKGROUND KEYING & CONNECTED-COMPONENT SPRITE CUTTER
// (`processFramelessIconCanvas` & `cropIndividualPlasticItemsFromDataset`)
// - Flood-Fill / Border-Connected White Keying (`R > 242 && G > 242 && B > 242`)
//   with smooth alpha feathering so 100% of external white rectangular backgrounds
//   are removed while preserving internal white features (recycling symbols, milk cartons).
// - Morphological Dilated Connected-Component Labeling / Bounding Box Merging on
//   `/slide3icon-plastic_waste.png?v=2` (`alpha > 25`, 10px gap merge, `boxWidth >= 28px`,
//   `boxHeight >= 28px`, `boxWidth < W * 0.45`) to crop each individual plastic waste item
//   into `croppedPlasticItems[]` (NEVER inserting the full sprite sheet image!).
// ============================================================================
const processedFramelessIconCache = new Map();
let plasticSpritesExtractPromise = null;
let cachedCroppedPlasticItems = [];

function loadHTMLImage(srcUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = encodeURI(srcUrl);
  });
}

function isNearWhitePixel(r, g, b, threshold = 242) {
  if (r > threshold && g > threshold && b > threshold) return true;
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  return minC > 236 && maxC - minC <= 12;
}

/**
 * Flood-Fill / Border-Connected White Keying + Alpha Feathering + Tight Transparent Crop
 * Returns `{ dataUrl, width, height, aspect }`.
 */
export async function processFramelessIconCanvas(imgUrl) {
  if (processedFramelessIconCache.has(imgUrl)) {
    return processedFramelessIconCache.get(imgUrl);
  }

  const promise = (async () => {
    try {
      const img = await loadHTMLImage(imgUrl);
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) {
        return { dataUrl: encodeURI(imgUrl), width: 120, height: 120, aspect: 1 };
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);

      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;
      const totalPixels = w * h;
      const visited = new Uint8Array(totalPixels);
      const isBg = new Uint8Array(totalPixels);
      const queue = new Int32Array(totalPixels);
      let qHead = 0;
      let qTail = 0;

      const trySeedBorder = (x, y) => {
        const idx = y * w + x;
        if (visited[idx]) return;
        const p = idx * 4;
        const a = data[p + 3];
        if (a < 20 || isNearWhitePixel(data[p], data[p + 1], data[p + 2], 240)) {
          visited[idx] = 1;
          isBg[idx] = 1;
          queue[qTail++] = idx;
        }
      };

      for (let x = 0; x < w; x++) {
        trySeedBorder(x, 0);
        trySeedBorder(x, h - 1);
      }
      for (let y = 0; y < h; y++) {
        trySeedBorder(0, y);
        trySeedBorder(w - 1, y);
      }

      // 8-connected flood fill from the 4 outer borders inward
      while (qHead < qTail) {
        const curr = queue[qHead++];
        const cx = curr % w;
        const cy = (curr / w) | 0;

        for (let dy = -1; dy <= 1; dy++) {
          const ny = cy + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            if (nx < 0 || nx >= w) continue;
            const nIdx = ny * w + nx;
            if (visited[nIdx]) continue;

            const np = nIdx * 4;
            const na = data[np + 3];
            if (na < 20 || isNearWhitePixel(data[np], data[np + 1], data[np + 2], 242)) {
              visited[nIdx] = 1;
              isBg[nIdx] = 1;
              queue[qTail++] = nIdx;
            }
          }
        }
      }

      for (let idx = 0; idx < totalPixels; idx++) {
        if (isBg[idx]) {
          data[idx * 4 + 3] = 0;
        }
      }

      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const idx = y * w + x;
          if (isBg[idx]) continue;
          const p = idx * 4;
          if (data[p + 3] === 0) continue;

          let bgNeighbors = 0;
          if (isBg[idx - 1]) bgNeighbors++;
          if (isBg[idx + 1]) bgNeighbors++;
          if (isBg[idx - w]) bgNeighbors++;
          if (isBg[idx + w]) bgNeighbors++;
          if (isBg[idx - w - 1]) bgNeighbors++;
          if (isBg[idx - w + 1]) bgNeighbors++;
          if (isBg[idx + w - 1]) bgNeighbors++;
          if (isBg[idx + w + 1]) bgNeighbors++;

          if (bgNeighbors > 0) {
            const r = data[p];
            const g = data[p + 1];
            const b = data[p + 2];
            const lum = (r + g + b) / 3;
            if (lum > 225) {
              const fade = Math.max(0.08, Math.min(1, (252 - lum) / 28));
              data[p + 3] = Math.round(data[p + 3] * fade * (1 - bgNeighbors * 0.07));
            } else {
              data[p + 3] = Math.round(data[p + 3] * (1 - bgNeighbors * 0.04));
            }
          }
        }
      }

      // Compute tight non-transparent bounding box
      let minX = w;
      let minY = h;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const a = data[(y * w + x) * 4 + 3];
          if (a > 25) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);

      if (maxX >= minX && maxY >= minY) {
        const pad = 4;
        const sx = Math.max(0, minX - pad);
        const sy = Math.max(0, minY - pad);
        const sw = Math.min(w - sx, maxX - minX + 1 + pad * 2);
        const sh = Math.min(h - sy, maxY - minY + 1 + pad * 2);

        const outCanvas = document.createElement('canvas');
        outCanvas.width = sw;
        outCanvas.height = sh;
        const outCtx = outCanvas.getContext('2d');
        outCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
        return {
          dataUrl: outCanvas.toDataURL('image/png'),
          width: sw,
          height: sh,
          aspect: sw / Math.max(1, sh)
        };
      }

      return {
        dataUrl: canvas.toDataURL('image/png'),
        width: w,
        height: h,
        aspect: w / Math.max(1, h)
      };
    } catch (_) {
      return {
        dataUrl: encodeURI(imgUrl),
        width: 120,
        height: 120,
        aspect: 1
      };
    }
  })();

  processedFramelessIconCache.set(imgUrl, promise);
  return promise;
}

/**
 * SECTION 2: `cropIndividualPlasticItemsFromDataset(imageUrl)`
 * Morphological Dilated Connected-Component Labeling / Bounding Box Merging on
 * `/slide3icon-plastic_waste.png?v=2`:
 * 1. Marks foreground pixels where `alpha > 25` (and not outer border white).
 * 2. Finds all connected components via BFS.
 * 3. Merges bounding boxes within `10px` (e.g. bottle cap + bottle body, straw + cup).
 * 4. Filters valid single items (`boxWidth >= 28px && boxHeight >= 28px && boxWidth < W * 0.45 && boxHeight < H * 0.48`).
 * 5. Crops each item into its own `<canvas>` of size `(boxWidth + 8) x (boxHeight + 8)`
 *    and exports `subCanvas.toDataURL('image/png')`.
 * NEVER returns or inserts the full uncropped dataset sheet!
 */
export async function cropIndividualPlasticItemsFromDataset(
  imageUrl = '/slide3icon-plastic_waste.png?v=2'
) {
  if (cachedCroppedPlasticItems.length > 0) {
    return cachedCroppedPlasticItems;
  }
  if (plasticSpritesExtractPromise) {
    return plasticSpritesExtractPromise;
  }

  plasticSpritesExtractPromise = (async () => {
    const img = await loadHTMLImage(imageUrl);
    const W = img.naturalWidth || img.width;
    const H = img.naturalHeight || img.height;

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);

    const imgData = ctx.getImageData(0, 0, W, H);
    const data = imgData.data;
    const totalPixels = W * H;

    // Step 1: Flood-fill border-connected white background if any remains,
    // then mark foreground mask where `alpha > 25`
    const isBg = new Uint8Array(totalPixels);
    const visitedBg = new Uint8Array(totalPixels);
    const qBg = new Int32Array(totalPixels);
    let head = 0;
    let tail = 0;

    const pushBg = (idx) => {
      if (visitedBg[idx]) return;
      const p = idx * 4;
      if (data[p + 3] <= 25 || isNearWhitePixel(data[p], data[p + 1], data[p + 2], 242)) {
        visitedBg[idx] = 1;
        isBg[idx] = 1;
        qBg[tail++] = idx;
      }
    };

    for (let x = 0; x < W; x++) {
      pushBg(x);
      pushBg((H - 1) * W + x);
    }
    for (let y = 0; y < H; y++) {
      pushBg(y * W);
      pushBg(y * W + (W - 1));
    }

    while (head < tail) {
      const curr = qBg[head++];
      const cx = curr % W;
      const cy = (curr / W) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = cy + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          if (nx < 0 || nx >= W) continue;
          pushBg(ny * W + nx);
        }
      }
    }

    const fgMask = new Uint8Array(totalPixels);
    for (let idx = 0; idx < totalPixels; idx++) {
      const p = idx * 4;
      if (isBg[idx] || data[p + 3] <= 25) {
        data[p + 3] = 0;
        continue;
      }
      fgMask[idx] = 1;
    }

    ctx.putImageData(imgData, 0, 0);

    // Step 2: Connected-Component Labeling via BFS
    const visitedFg = new Uint8Array(totalPixels);
    const qFg = new Int32Array(totalPixels);
    const rawBoxes = [];

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const startIdx = y * W + x;
        if (!fgMask[startIdx] || visitedFg[startIdx]) continue;

        let fHead = 0;
        let fTail = 0;
        visitedFg[startIdx] = 1;
        qFg[fTail++] = startIdx;

        let minX = x;
        let maxX = x;
        let minY = y;
        let maxY = y;
        let pixelCount = 0;

        while (fHead < fTail) {
          const curr = qFg[fHead++];
          pixelCount++;
          const cx = curr % W;
          const cy = (curr / W) | 0;
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          for (let dy = -2; dy <= 2; dy++) {
            const ny = cy + dy;
            if (ny < 0 || ny >= H) continue;
            for (let dx = -2; dx <= 2; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = cx + dx;
              if (nx < 0 || nx >= W) continue;
              const nIdx = ny * W + nx;
              if (fgMask[nIdx] && !visitedFg[nIdx]) {
                visitedFg[nIdx] = 1;
                qFg[fTail++] = nIdx;
              }
            }
          }
        }

        if (pixelCount >= 16) {
          rawBoxes.push({ minX, minY, maxX, maxY, pixelCount });
        }
      }
    }

    // Step 3: Merge bounding boxes within `4px` proximity only if one of the boxes is a tiny
    // detached cap/tip (`area < 1400px`) so separate neighboring plastic items NEVER merge into a cluster!
    const mergeGap = 4;
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < rawBoxes.length; i++) {
        for (let j = i + 1; j < rawBoxes.length; j++) {
          const a = rawBoxes[i];
          const b = rawBoxes[j];
          const areaA = (a.maxX - a.minX + 1) * (a.maxY - a.minY + 1);
          const areaB = (b.maxX - b.minX + 1) * (b.maxY - b.minY + 1);
          if (areaA >= 1400 && areaB >= 1400) continue;

          const overlapX = a.minX - mergeGap <= b.maxX && a.maxX + mergeGap >= b.minX;
          const overlapY = a.minY - mergeGap <= b.maxY && a.maxY + mergeGap >= b.minY;

          if (overlapX && overlapY) {
            const nextMinX = Math.min(a.minX, b.minX);
            const nextMinY = Math.min(a.minY, b.minY);
            const nextMaxX = Math.max(a.maxX, b.maxX);
            const nextMaxY = Math.max(a.maxY, b.maxY);
            const nextW = nextMaxX - nextMinX + 1;
            const nextH = nextMaxY - nextMinY + 1;

            if (nextW < W * 0.25 && nextH < H * 0.28) {
              a.minX = nextMinX;
              a.minY = nextMinY;
              a.maxX = nextMaxX;
              a.maxY = nextMaxY;
              a.pixelCount += b.pixelCount;
              rawBoxes.splice(j, 1);
              merged = true;
              break;
            }
          }
        }
        if (merged) break;
      }
    }

    // Filter valid single plastic items (`boxWidth >= 28px && boxHeight >= 28px && boxWidth < W * 0.26`)
    const validBoxes = rawBoxes
      .filter((b) => {
        const bw = b.maxX - b.minX + 1;
        const bh = b.maxY - b.minY + 1;
        const boxArea = bw * bh;
        const fillRatio = b.pixelCount / Math.max(1, boxArea);
        return (
          bw >= 28 &&
          bh >= 28 &&
          bw < W * 0.26 &&
          bh < H * 0.30 &&
          b.pixelCount >= 180 &&
          fillRatio >= 0.18
        );
      })
      .sort((a, b) => {
        const rowA = Math.round(a.minY / (H * 0.16));
        const rowB = Math.round(b.minY / (H * 0.16));
        if (rowA !== rowB) return rowA - rowB;
        return a.minX - b.minX;
      });

    // Step 4: Crop each individual plastic waste item into `(boxWidth + 8) x (boxHeight + 8)` canvas
    const croppedPlasticItems = [];
    for (const box of validBoxes) {
      const boxWidth = box.maxX - box.minX + 1;
      const boxHeight = box.maxY - box.minY + 1;
      const subCanvas = document.createElement('canvas');
      subCanvas.width = boxWidth + 8;
      subCanvas.height = boxHeight + 8;
      const subCtx = subCanvas.getContext('2d');
      subCtx.drawImage(
        canvas,
        box.minX,
        box.minY,
        boxWidth,
        boxHeight,
        4,
        4,
        boxWidth,
        boxHeight
      );
      croppedPlasticItems.push({
        dataUrl: subCanvas.toDataURL('image/png'),
        width: subCanvas.width,
        height: subCanvas.height,
        aspect: subCanvas.width / Math.max(1, subCanvas.height),
        area: boxWidth * boxHeight
      });
    }

    cachedCroppedPlasticItems = croppedPlasticItems;
    return cachedCroppedPlasticItems;
  })();

  return plasticSpritesExtractPromise;
}

export const extractIndividualPlasticIcons = cropIndividualPlasticItemsFromDataset;
export const extractPlasticWasteSprites = cropIndividualPlasticItemsFromDataset;

/**
 * ============================================================================
 * SECTION 3: SEQUENTIAL LARGEST-EMPTY-SPACE OCCUPANCY GRID SOLVER
 * (`computeOptimalEmptySpacePlacements(slideElement, iconList)`)
 *
 * Strictly guarantees:
 * 1. Scans all DOM text elements (`h1`, `h2`, `.slide-header`, `.slide-sublabel`,
 *    `.slide-titles-wrap`, `.horizontal-glass-strip`, `.numbered-pill-item`,
 *    `.bento-card-item`, `.campaign-day-col`, `.campaign-footer`, `.conclusion-card-item`,
 *    `.bullet-item`) with `padding = 36px` safety buffer.
 * 2. Scans all Hanging / Showcase Photo Frames (`.diagonal-chain-card`, `.pendulum-photo-frame`,
 *    `.hologram-popup-card`, `.tilted-3d-showcase`) with `padding = 24px` safety buffer.
 * 3. Reserves System UI edges (`top: 0..60px`, `left: 0..70px`, `right: VW-70..VW`, `bottom: VH-85..VH`).
 * 4. Builds a `cellSize = 16px` 2D Occupancy Grid (`grid[y][x] = 0 | 1`) and iteratively places
 *    each icon (sorted from largest to smallest) at the center `(x*, y*)` with the largest
 *    available empty clearance area `A(x,y) = W_free(x,y) * H_free(x,y)`, immediately marking
 *    that icon's footprint + `margin = 35px` as occupied (`grid = 1`) before solving for the next icon!
 * ============================================================================
 */
const SLIDE_ICON_SPECIFICATIONS = {
  // Slide 2: `slide2icon-school.png?v=2`
  2: {
    staticIcons: [
      {
        src: '/slide2icon-school.png?v=2',
        alt: 'Green School Cutout Icon',
        targetSize: 155,
        minSize: 95,
        rotZ: -4,
        dur: 5.2,
        delay: 0.0,
        depth: 1.25
      }
    ],
    plasticCount: 0
  },

  // Slide 3: `slide3icon-nuclear_power_plant1.png?v=2` + 7 diverse cropped plastic items
  3: {
    staticIcons: [
      {
        src: '/slide3icon-nuclear_power_plant1.png?v=2',
        alt: 'Nuclear Power Plant Cutout Icon',
        targetSize: 148,
        minSize: 92,
        rotZ: -5,
        dur: 5.5,
        delay: 0.0,
        depth: 1.3
      }
    ],
    plasticCount: 7,
    plasticTargetSize: 78,
    plasticMinSize: 52
  },

  // Slide 4: `slide4-bin1.png?v=2` & `slide4icon-bin.png?v=2`
  4: {
    staticIcons: [
      {
        src: '/slide4-bin1.png?v=2',
        alt: 'Recycling Bins Set Cutout Icon',
        targetSize: 145,
        minSize: 90,
        rotZ: -4,
        dur: 5.1,
        delay: 0.1,
        depth: 1.25
      },
      {
        src: '/slide4icon-bin.png?v=2',
        alt: 'Single Recycling Bin Cutout Icon',
        targetSize: 138,
        minSize: 86,
        rotZ: 5,
        dur: 5.6,
        delay: 0.7,
        depth: 1.35
      }
    ],
    plasticCount: 0
  },

  // Slide 5: `slide5icon-plane.png?v=2`
  5: {
    staticIcons: [
      {
        src: '/slide5icon-plane.png?v=2',
        alt: 'Eco Plane Cutout Icon',
        targetSize: 145,
        minSize: 92,
        rotZ: -6,
        dur: 4.9,
        delay: 0.1,
        depth: 1.35
      }
    ],
    plasticCount: 0
  },

  // Slide 6: `slide6icon-tree.png?v=2` & `slide6icon-tree1.png?v=2`
  6: {
    staticIcons: [
      {
        src: '/slide6icon-tree.png?v=2',
        alt: 'Green Tree Cutout Icon 1',
        targetSize: 148,
        minSize: 92,
        rotZ: -3,
        dur: 5.3,
        delay: 0.1,
        depth: 1.3
      },
      {
        src: '/slide6icon-tree1.png?v=2',
        alt: 'Green Tree Cutout Icon 2',
        targetSize: 142,
        minSize: 88,
        rotZ: 4,
        dur: 5.7,
        delay: 0.8,
        depth: 1.2
      }
    ],
    plasticCount: 0
  },

  // Slide 7: 6 diverse cropped plastic items alongside the 7 hanging student activity photos
  7: {
    staticIcons: [],
    plasticCount: 6,
    plasticTargetSize: 72,
    plasticMinSize: 48
  },

  // Slide 8: `slide8icon.png?v=2`
  8: {
    staticIcons: [
      {
        src: '/slide8icon.png?v=2',
        alt: 'Expected Eco Results Cutout Icon',
        targetSize: 150,
        minSize: 94,
        rotZ: -4,
        dur: 5.2,
        delay: 0.15,
        depth: 1.3
      }
    ],
    plasticCount: 0
  },

  // Slide 9: `slide9-icon.png?v=2`
  9: {
    staticIcons: [
      {
        src: '/slide9-icon.png?v=2',
        alt: 'Green Conclusion Cutout Icon',
        targetSize: 154,
        minSize: 96,
        rotZ: 4,
        dur: 5.4,
        delay: 0.15,
        depth: 1.35
      }
    ],
    plasticCount: 0
  }
};

/**
 * Converts a live `getBoundingClientRect()` (which may be affected by temporary GSAP entrance transforms)
 * into clean slide-local `[0..VW, 0..VH]` coordinates using the slide wrapper's rect as reference.
 */
function getSlideRelativeObstacleBox(el, slideRect, VW, VH, padPx) {
  const r = el.getBoundingClientRect();
  if (!r || r.width < 4 || r.height < 4) return null;

  let left = r.left;
  let top = r.top;
  let width = r.width;
  let height = r.height;

  if (slideRect && slideRect.width > 100 && slideRect.height > 100) {
    const scaleX = VW / slideRect.width;
    const scaleY = VH / slideRect.height;
    left = (r.left - slideRect.left) * scaleX;
    top = (r.top - slideRect.top) * scaleY;
    width = r.width * scaleX;
    height = r.height * scaleY;
  }

  // If a hanging card or pendulum unit is currently shifted above screen (`y: -350`) during its entrance tween,
  // compute its exact resting vertical position so the occupancy solver NEVER places an icon where the card lands!
  const diagItem = el.closest('.diagonal-chain-item');
  if (diagItem && diagItem.style.top) {
    const vhMatch = String(diagItem.style.top).match(/([\d.]+)vh/);
    if (vhMatch) {
      top = (parseFloat(vhMatch[1]) / 100) * VH;
    }
  } else if (el.closest('.pendulum-drop-unit')) {
    if (el.closest('.visual-region-campaign-pendulum')) {
      top = 0.195 * VH;
    } else if (el.closest('.pendulum-rack-slide6')) {
      top = 0.06 * VH;
    }
  } else if (top < 0 && el.closest('.hologram-popup-card, .tilted-3d-showcase')) {
    top = Math.max(0.06 * VH, top + 70);
  }

  return {
    left: Math.max(0, left - padPx),
    top: Math.max(0, top - padPx),
    right: Math.min(VW, left + width + padPx),
    bottom: Math.min(VH, top + height + padPx)
  };
}

/**
 * Step 1 + Step 2 + Step 3:
 * Sequential Largest-Empty-Space Occupancy Grid Solver (`computeOptimalEmptySpacePlacements`)
 */
export function computeOptimalEmptySpacePlacements(slideElement, iconList = []) {
  if (!slideElement || !iconList || iconList.length === 0) return [];

  const VW = window.innerWidth || 1920;
  const VH = window.innerHeight || 1080;
  const slideId = parseInt(slideElement.dataset.slideId || '0', 10);
  const slideRect = slideElement.getBoundingClientRect();

  // --------------------------------------------------------------------------
  // STEP 1: Scan ALL Existing Slide Elements to Build Forbidden Obstacle Boxes
  // --------------------------------------------------------------------------
  const obstacles = [];

  // 1A. Text Elements + 36px safety padding
  const textSelectors = [
    '.slide-header',
    '.slide-sublabel',
    '.slide-titles-wrap',
    '.slide-title-line1',
    '.slide-title-line2',
    '.horizontal-glass-strip',
    '.numbered-pill-item',
    '.bento-card-item',
    '.campaign-day-col',
    '.campaign-footer',
    '.conclusion-card-item',
    '.bullet-item'
  ];
  const textEls = slideElement.querySelectorAll(textSelectors.join(', '));
  textEls.forEach((el) => {
    const box = getSlideRelativeObstacleBox(el, slideRect, VW, VH, 36);
    if (box) obstacles.push(box);
  });

  // Also protect the left text column bounding envelope on slides 2..6, 8, 9
  if (slideId !== 7) {
    const leftTextRegion = slideElement.querySelector('.slide-text-region');
    if (leftTextRegion) {
      const box = getSlideRelativeObstacleBox(leftTextRegion, slideRect, VW, VH, 32);
      if (box) obstacles.push(box);
    }
  }

  // 1B. Hanging Photo Frames & 3D Showcase Cards + 24px safety padding (40px on Slide 3)
  const photoSelectors = [
    '.diagonal-chain-card',
    '.diagonal-chain-item',
    '.pendulum-photo-frame',
    '.hologram-popup-card',
    '.full-aspect-card',
    '.tilted-3d-showcase'
  ];
  const photoPad = slideId === 3 ? 40 : 24;
  const photoEls = slideElement.querySelectorAll(photoSelectors.join(', '));
  photoEls.forEach((el) => {
    const box = getSlideRelativeObstacleBox(el, slideRect, VW, VH, photoPad);
    if (box) obstacles.push(box);
  });

  // Strict Forbidden Obstacle Box for Slide 3's dual image showcase (`PROBLEM // 01` & `PROBLEM // 02`)
  // Because `rotationX: -85` during initial entrance collapses `getBoundingClientRect().height`,
  // explicitly lock out the entire Slide 3 photo card column (`57.5vw..85.5vw`, `5.5vh..92.5vh` + 40px padding)
  // so ZERO icons can ever land inside or on top of the two photos!
  if (slideId === 3) {
    obstacles.push({
      left: Math.max(0, Math.round(0.575 * VW) - 40),
      top: Math.max(0, Math.round(0.055 * VH) - 40),
      right: Math.min(VW, Math.round(0.855 * VW) + 40),
      bottom: Math.min(VH, Math.round(0.925 * VH) + 40)
    });
  }

  // --------------------------------------------------------------------------
  // STEP 2: Build 2D Occupancy Grid (`cellSize = 16px`)
  // --------------------------------------------------------------------------
  const cellSize = 16;
  const Nx = Math.max(20, Math.floor(VW / cellSize));
  const Ny = Math.max(15, Math.floor(VH / cellSize));
  const grid = Array.from({ length: Ny }, () => new Uint8Array(Nx));

  const markRectOccupied = (leftPx, topPx, rightPx, bottomPx) => {
    const gx0 = Math.max(0, Math.floor(leftPx / cellSize));
    const gy0 = Math.max(0, Math.floor(topPx / cellSize));
    const gx1 = Math.min(Nx - 1, Math.ceil(rightPx / cellSize));
    const gy1 = Math.min(Ny - 1, Math.ceil(bottomPx / cellSize));
    for (let gy = gy0; gy <= gy1; gy++) {
      const row = grid[gy];
      for (let gx = gx0; gx <= gx1; gx++) {
        row[gx] = 1;
      }
    }
  };

  // Reserve System UI Edges:
  // - Top progress bar (`top: 0..60px`)
  // - Left & Right navigation zones (`left: 0..70px`, `right: VW-70..VW`)
  // - Bottom dots & project badge (`bottom: VH-85..VH`)
  markRectOccupied(0, 0, VW, 60);
  markRectOccupied(0, 0, 70, VH);
  markRectOccupied(VW - 70, 0, VW, VH);
  markRectOccupied(0, VH - 85, VW, VH);

  // Mark all scanned text & photo obstacles
  obstacles.forEach((ob) => {
    markRectOccupied(ob.left, ob.top, ob.right, ob.bottom);
  });

  // --------------------------------------------------------------------------
  // STEP 3: Iterative Greedy Largest-Void Placement
  // Sort icons from largest to smallest so major icons claim primary voids first
  // --------------------------------------------------------------------------
  const sortedIcons = [...iconList].sort(
    (a, b) => (b.targetSize || 100) - (a.targetSize || 100)
  );

  // Helper: For a cell `(cx, cy)`, computes maximal symmetric free half-extents `(radX, radY)`
  // in grid cells where every cell inside `[cx - radX .. cx + radX] x [cy - radY .. cy + radY]` has `grid == 0`.
  const computeMaxClearanceAtCell = (cx, cy, targetAspect = 1.0) => {
    if (grid[cy][cx] !== 0) return { radX: 0, radY: 0, freeW: 0, freeH: 0, area: 0 };

    let rx = 0;
    let ry = 0;
    const maxPossibleRx = Math.min(cx, Nx - 1 - cx, 26);
    const maxPossibleRy = Math.min(cy, Ny - 1 - cy, 26);

    const isBoxFree = (x0, y0, x1, y1) => {
      if (x0 < 0 || y0 < 0 || x1 >= Nx || y1 >= Ny) return false;
      for (let y = y0; y <= y1; y++) {
        const row = grid[y];
        for (let x = x0; x <= x1; x++) {
          if (row[x] !== 0) return false;
        }
      }
      return true;
    };

    let canGrow = true;
    while (canGrow) {
      canGrow = false;
      const preferX = (rx + 1) / Math.max(1, ry + 1) <= targetAspect;
      if (preferX && rx < maxPossibleRx && isBoxFree(cx - rx - 1, cy - ry, cx + rx + 1, cy + ry)) {
        rx++;
        canGrow = true;
      } else if (ry < maxPossibleRy && isBoxFree(cx - rx, cy - ry - 1, cx + rx, cy + ry + 1)) {
        ry++;
        canGrow = true;
      } else if (rx < maxPossibleRx && isBoxFree(cx - rx - 1, cy - ry, cx + rx + 1, cy + ry)) {
        rx++;
        canGrow = true;
      }
    }

    const freeW = (rx * 2 + 1) * cellSize;
    const freeH = (ry * 2 + 1) * cellSize;
    return {
      radX: rx,
      radY: ry,
      freeW,
      freeH,
      area: freeW * freeH
    };
  };

  const placements = [];
  const floatAmplitudePx = 14; // ±14px oscillation allowance
  const interIconMarginPx = 35; // Minimum 35px margin between placed icons

  sortedIcons.forEach((icon, idx) => {
    const aspect = icon.aspect || 1.0;
    const baseSize = icon.targetSize || 120;
    const minSize = icon.minSize || 56;

    const desiredW = aspect >= 1 ? baseSize : Math.round(baseSize * aspect);
    const desiredH = aspect >= 1 ? Math.round(baseSize / aspect) : baseSize;

    let bestCell = null;
    let bestScore = -1;

    for (let cy = 2; cy < Ny - 2; cy++) {
      for (let cx = 2; cx < Nx - 2; cx++) {
        if (grid[cy][cx] !== 0) continue;

        const clearance = computeMaxClearanceAtCell(cx, cy, aspect);
        if (clearance.freeW < 40 || clearance.freeH < 40) continue;

        const centerX = (cx + 0.5) * cellSize;
        const centerY = (cy + 0.5) * cellSize;

        // Aesthetic composition bias: favor right half & central open corridor between text and hanging frames
        const normX = centerX / VW;
        const normY = centerY / VH;
        let compositionWeight = 1.0;
        if (slideId !== 7) {
          if (normX >= 0.44) {
            compositionWeight = 1.35;
          } else {
            compositionWeight = 0.55;
          }
        } else {
          // On Slide 7 (full-width 7 hanging photos + 5 columns), favor open spaces around the canopy & margins
          compositionWeight = normY < 0.54 ? 1.25 : 0.95;
        }

        const fitsDesired =
          clearance.freeW >= desiredW + floatAmplitudePx * 2 &&
          clearance.freeH >= desiredH + floatAmplitudePx * 2
            ? 1.45
            : 1.0;

        const score = clearance.area * compositionWeight * fitsDesired;
        if (score > bestScore) {
          bestScore = score;
          bestCell = { cx, cy, centerX, centerY, clearance };
        }
      }
    }

    if (!bestCell) {
      for (let cy = 1; cy < Ny - 1; cy++) {
        for (let cx = 1; cx < Nx - 1; cx++) {
          if (grid[cy][cx] !== 0) continue;
          const clearance = computeMaxClearanceAtCell(cx, cy, aspect);
          if (clearance.area > bestScore) {
            bestScore = clearance.area;
            bestCell = {
              cx,
              cy,
              centerX: (cx + 0.5) * cellSize,
              centerY: (cy + 0.5) * cellSize,
              clearance
            };
          }
        }
      }
    }

    if (!bestCell) return;

    // Fit icon dimensions cleanly inside the available void with >= 25px clearance from obstacles
    const maxAvailW = Math.max(minSize, bestCell.clearance.freeW - floatAmplitudePx * 2 - 16);
    const maxAvailH = Math.max(minSize, bestCell.clearance.freeH - floatAmplitudePx * 2 - 16);

    let finalW = desiredW;
    let finalH = desiredH;

    if (finalW > maxAvailW) {
      finalW = maxAvailW;
      finalH = Math.round(finalW / aspect);
    }
    if (finalH > maxAvailH) {
      finalH = maxAvailH;
      finalW = Math.round(finalH * aspect);
    }

    finalW = Math.max(Math.min(minSize, desiredW), Math.min(desiredW, finalW));
    finalH = Math.max(Math.min(minSize, desiredH), Math.min(desiredH, finalH));

    const leftPx = Math.round(bestCell.centerX - finalW * 0.5);
    const topPx = Math.round(bestCell.centerY - finalH * 0.5);

    // Immediately mark this icon's bounding box + float amplitude + `margin = 35px` as OCCUPIED (`grid = 1`)
    // so the next icon `(i + 1)` automatically selects the next largest non-overlapping empty region!
    const occupyMargin = interIconMarginPx + floatAmplitudePx;
    markRectOccupied(
      leftPx - occupyMargin,
      topPx - occupyMargin,
      leftPx + finalW + occupyMargin,
      topPx + finalH + occupyMargin
    );

    placements.push({
      ...icon,
      leftPx,
      topPx,
      widthPx: finalW,
      heightPx: finalH,
      rotZ: icon.rotZ !== undefined ? icon.rotZ : (idx % 2 === 0 ? -7 : 8),
      dur: icon.dur || 4.8 + (idx % 4) * 0.35,
      delay: icon.delay !== undefined ? icon.delay : idx * 0.28,
      depth: icon.depth || 1.15 + (idx % 3) * 0.1
    });
  });

  return placements;
}

/**
 * Builds the empty `.floating-frameless-icons-layer` container for Slides 2 -> 9.
 * Actual icon DOM elements are populated and positioned by `hydrateFramelessFloatingIcons()`
 * using `computeOptimalEmptySpacePlacements()`.
 */
function buildFramelessFloatingIconsLayerMarkup(slide) {
  if (!SLIDE_ICON_SPECIFICATIONS[slide.id]) return '';
  return `<div class="floating-frameless-icons-layer" data-slide-icons="${slide.id}" aria-hidden="true"></div>`;
}

/**
 * Selects `count` diverse, visually distinct cropped plastic items (bottles, bags, cups, cartons, etc.)
 * from the extracted `croppedPlasticItems[]` array.
 */
function pickDiversePlasticItems(allItems = [], count = 6, seedOffset = 0) {
  if (!allItems || allItems.length === 0 || count <= 0) return [];
  const sortedByQuality = [...allItems].sort((a, b) => (b.area || 0) - (a.area || 0));
  const pool = sortedByQuality.slice(0, Math.min(sortedByQuality.length, Math.max(count * 2, 16)));
  const selected = [];
  const step = Math.max(1, Math.floor(pool.length / count));
  for (let i = 0; i < count; i++) {
    const idx = (i * step + seedOffset) % pool.length;
    selected.push(pool[idx]);
  }
  return selected;
}

/**
 * Loads all cutout icons & cropped plastic items for a slide, waits for hanging photo cards
 * to settle their aspect-ratio dimensions, and runs `computeOptimalEmptySpacePlacements()`
 * to place every icon into the largest empty spaces with zero overlap!
 */
async function hydrateFramelessFloatingIcons(slideDomElement) {
  if (!slideDomElement) return;
  const slideId = parseInt(slideDomElement.dataset.slideId || '0', 10);
  const spec = SLIDE_ICON_SPECIFICATIONS[slideId];
  const layerEl = slideDomElement.querySelector('.floating-frameless-icons-layer');
  if (!spec || !layerEl) return;

  try {
    // 1. Load & key out static icons for this slide
    const staticLoaded = await Promise.all(
      (spec.staticIcons || []).map(async (item) => {
        const processed = await processFramelessIconCanvas(item.src);
        return {
          ...item,
          dataUrl: processed.dataUrl,
          aspect: processed.aspect || 1.0
        };
      })
    );

    // 2. If this slide uses individual cropped plastic waste items (Slide 3 & Slide 7),
    //    crop them from `/slide3icon-plastic_waste.png?v=2`
    let plasticLoaded = [];
    if (spec.plasticCount && spec.plasticCount > 0) {
      const allCroppedPlastic = await cropIndividualPlasticItemsFromDataset(
        '/slide3icon-plastic_waste.png?v=2'
      );
      const chosen = pickDiversePlasticItems(
        allCroppedPlastic,
        spec.plasticCount,
        slideId === 7 ? 3 : 0
      );
      plasticLoaded = chosen.map((cItem, idx) => ({
        dataUrl: cItem.dataUrl,
        alt: `Cropped Plastic Waste Item ${idx + 1}`,
        aspect: cItem.aspect || 1.0,
        targetSize: spec.plasticTargetSize || 76,
        minSize: spec.plasticMinSize || 50,
        rotZ: idx % 2 === 0 ? -11 + idx * 2 : 12 - idx * 2,
        dur: 4.5 + (idx % 4) * 0.35,
        delay: idx * 0.25,
        depth: 1.1 + (idx % 3) * 0.12
      }));
    }

    const combinedIconList = [...staticLoaded, ...plasticLoaded];
    if (combinedIconList.length === 0) return;

    // Wait for all slide showcase photos (`img`) inside `slideDomElement` to finish loading
    // so `applySmartAspectRatioDetection` has applied exact frame dimensions before scanning obstacles
    const slidePhotos = Array.from(
      slideDomElement.querySelectorAll(
        '.diagonal-chain-img, .pendulum-smart-img, .full-thematic-photo, .showcase-natural-img'
      )
    );
    await Promise.all(
      slidePhotos.map((img) => {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        return new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
          setTimeout(resolve, 350);
        });
      })
    );
    applySmartAspectRatioDetection(slideDomElement);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (!slideDomElement.isConnected) return;

    const placedIcons = computeOptimalEmptySpacePlacements(slideDomElement, combinedIconList);

    layerEl.innerHTML = placedIcons
      .map(
        (p) => `
        <div
          class="frameless-floating-icon-unit"
          data-parallax-depth="${p.depth.toFixed(2)}"
          style="left: ${p.leftPx}px; top: ${p.topPx}px; width: ${p.widthPx}px; height: ${
          p.heightPx
        }px; --float-dur: ${p.dur.toFixed(2)}s; --float-delay: ${p.delay.toFixed(
          2
        )}s; --base-rot: ${p.rotZ}deg;"
        >
          <div class="frameless-floating-oscillator">
            <img
              src="${p.dataUrl}"
              alt="${p.alt || 'Floating Cutout Icon'}"
              class="frameless-cutout-img is-cutout-ready"
              loading="eager"
            />
          </div>
        </div>
      `
      )
      .join('');

    const newUnits = layerEl.querySelectorAll('.frameless-floating-icon-unit');
    if (newUnits.length > 0) {
      gsap.fromTo(
        newUnits,
        { opacity: 0, scale: 0.35 },
        {
          opacity: 1,
          scale: 1,
          duration: 0.78,
          stagger: 0.055,
          ease: 'back.out(1.5)'
        }
      );
    }
  } catch (_) {
    // Safe fallback if canvas image loading is interrupted
  }
}

// Pre-warm all 10 new cutout icons and crop `/slide3icon-plastic_waste.png?v=2` on startup
setTimeout(() => {
  Object.values(SLIDE_ICON_SPECIFICATIONS).forEach((spec) => {
    (spec.staticIcons || []).forEach((item) => {
      processFramelessIconCanvas(item.src);
    });
  });
  cropIndividualPlasticItemsFromDataset('/slide3icon-plastic_waste.png?v=2');
}, 40);


/**
 * Helper: Splits a text string into `<span class="word-pop">` word tokens
 * so each word pops with the Canva Elastic Burst animation in 3D space.
 */
function wrapWordsForPop(text) {
  return String(text)
    .trim()
    .split(/\s+/)
    .map((word) => `<span class="word-pop">${word}</span>`)
    .join(' ');
}

/**
 * Builds the 4-corner particle spark elements for Hologram Glass Pop-up cards
 */
function buildCornerSparksMarkup() {
  return `
    <span class="corner-spark spark-tl" data-dx="-28" data-dy="-28"></span>
    <span class="corner-spark spark-tr" data-dx="28" data-dy="-28"></span>
    <span class="corner-spark spark-bl" data-dx="-28" data-dy="28"></span>
    <span class="corner-spark spark-br" data-dx="28" data-dy="28"></span>
  `;
}

/**
 * Builds the Horizontal Hanging Pendulum Gallery HTML
 * - Slide 6 top rack: 2 balanced hanging cards (`slide6-1.jpg`, `slide6-2.webp`)
 * - Slide 7 canopy below title: 7 hanging cards (`slide7-1.jpg` -> `slide7-7.jpg`)
 */
function buildPendulumGalleryMarkup(pendulumPhotos = [], variantClass = '') {
  const cardsHtml = pendulumPhotos
    .map(
      (p, idx) => `
      <div
        class="pendulum-drop-unit"
        style="--top-offset: ${p.topOffset || 0}px; --rope-len: ${p.ropeLength || 90}px;"
      >
        <div
          class="pendulum-card-swinger"
          data-rot-z="${p.rotZ || -3}"
          data-rot-y="${p.rotY || 5}"
          data-phase="${p.phase || idx * 0.9}"
          style="transform: rotateZ(${p.rotZ || -3}deg) rotateY(${p.rotY || 5}deg);"
        >
          <div class="pendulum-glowing-rope"></div>
          <div class="pendulum-pin-knot"></div>
          <div class="pendulum-photo-frame">
            <div class="pendulum-img-crop">
              <img
                src="${p.src}"
                alt="${p.label}"
                class="pendulum-smart-img"
                loading="eager"
              />
            </div>
            <div class="pendulum-photo-caption">${p.label}</div>
          </div>
        </div>
      </div>
    `
    )
    .join('');

  return `<div class="pendulum-gallery-rack ${variantClass}">${cardsHtml}</div>`;
}

/**
 * Update V36:
 * Diagonal Cascade of 3 Hanging Cards with 100% Natural Aspect Ratio & Tightly Hugged Frame
 * (Slides 2, 4, 8, 9):
 * - ZERO cropping: Shows 100% of every image at its natural aspect ratio (`naturalWidth / naturalHeight`).
 * - Glowing emerald border shrinks/expands to tightly hug all 4 edges of each photo with zero black bars.
 * - Bottom caption bar displays the accurate English caption for each photo.
 */
function buildDiagonalHangingChainMarkup(images = []) {
  const diagonalPresets = [
    { top: '4.5vh', right: '23.5vw', rotZ: -4, rotY: 4, zIndex: 21 },
    { top: '34vh', right: '12.5vw', rotZ: 2, rotY: -4, zIndex: 22 },
    { top: '63.5vh', right: '2vw', rotZ: -3, rotY: 4, zIndex: 23 }
  ];

  const cardsHtml = images
    .map((img, idx) => {
      const preset = diagonalPresets[idx % diagonalPresets.length];
      const rz = img.rotZ !== undefined ? img.rotZ : preset.rotZ;
      const ry = img.rotY !== undefined ? img.rotY : preset.rotY;
      const tagText = img.tag || `0${idx + 1} // ECO`;

      return `
        <div
          class="diagonal-chain-item diag-step-${idx}"
          style="top: ${preset.top}; right: ${preset.right}; z-index: ${preset.zIndex};"
        >
          <div
            class="diagonal-chain-swinger"
            data-rot-z="${rz}"
            data-rot-y="${ry}"
            data-phase="${idx * 1.15}"
            style="transform: rotateZ(${rz}deg) rotateY(${ry}deg);"
          >
            <!-- Twin glowing suspension cords extending straight up to the top of the screen -->
            <div class="chain-rope chain-rope-left"></div>
            <div class="chain-rope chain-rope-right"></div>
            <div class="chain-knot chain-knot-left"></div>
            <div class="chain-knot chain-knot-right"></div>

            <div class="diagonal-chain-card">
              <div class="diagonal-chain-img-viewport">
                <img
                  src="${img.src}"
                  alt="${img.caption}"
                  class="diagonal-chain-img"
                  loading="eager"
                />
              </div>
              <div class="diagonal-chain-bottom-bar">
                <span class="diagonal-chain-tag">${tagText}</span>
                <span class="diagonal-chain-sep">—</span>
                <span class="diagonal-chain-caption">${img.caption}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  return `
    <div class="slide-visual-region visual-region-diagonal-chain">
      ${cardsHtml}
    </div>
  `;
}

/**
 * Helper: Computes exact `(imgW, imgH)` that fits within `(maxW, maxH)` while
 * preserving 100% of the image's natural aspect ratio (`nw / nh`) with ZERO cropping.
 */
function computeNaturalFitDimensions(nw, nh, maxW, maxH) {
  const aspect = nw / nh;
  let imgH = maxH;
  let imgW = Math.round(imgH * aspect);
  if (imgW > maxW) {
    imgW = maxW;
    imgH = Math.round(imgW / aspect);
  }
  return {
    imgW: Math.max(80, imgW),
    imgH: Math.max(80, imgH)
  };
}

/**
 * Update V36: 100% Natural Aspect-Ratio Detection & Tightly Hugged Frame Sizing (`img.onload`)
 * Ensures ZERO cropping (`object-fit: contain`, exact `naturalWidth / naturalHeight` viewport)
 * across ALL images in Slides 2 -> 9:
 * 1. Diagonal Hanging Cards (Slides 2, 4, 8, 9)
 * 2. Hanging Pendulum Cards (Slide 6 Top 2 Cards & Slide 7 7 Cards)
 * 3. Slide 3 Full-Aspect Dual Showcase Cards (`slide3-1.jpg`, `slide3-2.jpg`)
 * 4. Slide 5 & Slide 6 3D Tilted Showcase Cards (`slide5-1.webp`, `slide5-2.jpg`, `slide6-4.jpg`)
 */
function applySmartAspectRatioDetection(slideDomElement) {
  if (!slideDomElement) return;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // A. Diagonal Hanging Chain Cards (Slides 2, 4, 8, 9) — 100% Natural Aspect Ratio & Tight Frame Hug
  const diagImgs = slideDomElement.querySelectorAll('.diagonal-chain-img');
  diagImgs.forEach((img) => {
    const handleDiagLoad = () => {
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      if (!nw || !nh) return;

      const itemEl = img.closest('.diagonal-chain-item');
      const swingerEl = img.closest('.diagonal-chain-swinger');
      const cardEl = img.closest('.diagonal-chain-card');
      const viewportEl = img.closest('.diagonal-chain-img-viewport');
      const bottomBarEl = cardEl?.querySelector('.diagonal-chain-bottom-bar');
      if (!itemEl || !swingerEl || !cardEl || !viewportEl) return;

      const maxImgW = Math.max(240, Math.min(410, Math.round(vw * 0.215)));
      const maxImgH = Math.max(150, Math.min(230, Math.round(vh * 0.202)));
      const { imgW, imgH } = computeNaturalFitDimensions(nw, nh, maxImgW, maxImgH);

      const framePaddingAndBorderPx = 12; // 4px padding * 2 + 2px border * 2
      const exactCardWidthPx = imgW + framePaddingAndBorderPx;
      const isCompact = exactCardWidthPx < 290 || nh >= nw;

      itemEl.classList.toggle('is-portrait-hug', isCompact);
      itemEl.classList.toggle('is-landscape-wide', !isCompact);

      itemEl.style.setProperty('width', `${exactCardWidthPx}px`, 'important');
      itemEl.style.setProperty('min-width', `${exactCardWidthPx}px`, 'important');
      itemEl.style.setProperty('max-width', `${exactCardWidthPx}px`, 'important');
      itemEl.style.setProperty('height', 'auto', 'important');
      itemEl.style.setProperty('min-height', '0px', 'important');

      cardEl.style.setProperty('width', `${exactCardWidthPx}px`, 'important');
      cardEl.style.setProperty('min-width', `${exactCardWidthPx}px`, 'important');
      cardEl.style.setProperty('max-width', `${exactCardWidthPx}px`, 'important');
      cardEl.style.setProperty('height', 'auto', 'important');

      viewportEl.style.setProperty('width', `${imgW}px`, 'important');
      viewportEl.style.setProperty('height', `${imgH}px`, 'important');
      viewportEl.style.setProperty('flex', 'none', 'important');

      img.style.setProperty('width', '100%', 'important');
      img.style.setProperty('height', '100%', 'important');
      img.style.setProperty('max-height', 'none', 'important');
      img.style.setProperty('object-fit', 'contain', 'important');
      img.style.setProperty('object-position', 'center center', 'important');

      if (bottomBarEl) {
        bottomBarEl.style.setProperty('width', '100%', 'important');
      }
    };

    if (img.complete && img.naturalWidth > 0) {
      handleDiagLoad();
    } else {
      img.addEventListener('load', handleDiagLoad, { once: true });
    }
  });

  // B. Slide 6 (Top 2 Hanging Photos) & Slide 7 (7 Hanging Photos) — 100% Natural Aspect Ratio
  const pendulumImgs = slideDomElement.querySelectorAll('.pendulum-smart-img');
  pendulumImgs.forEach((img) => {
    const handlePendulumLoad = () => {
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      if (!nw || !nh) return;

      const rackEl = img.closest('.pendulum-gallery-rack');
      const swingerEl = img.closest('.pendulum-card-swinger');
      const frameEl = img.closest('.pendulum-photo-frame');
      const cropEl = img.closest('.pendulum-img-crop');
      if (!swingerEl || !frameEl || !cropEl) return;

      const isSlide7Rack = rackEl && rackEl.classList.contains('pendulum-rack-7cols');

      let maxImgW;
      let maxImgH;
      if (isSlide7Rack) {
        // Slide 7: 7 hanging photos across 94vw
        maxImgW = Math.max(118, Math.min(200, Math.round(vw * 0.122)));
        maxImgH = Math.max(168, Math.min(212, Math.round(vh * 0.198)));
      } else {
        // Slide 6: Only 2 hanging photos on top row across 43vw -> generous balanced sizing
        maxImgW = Math.max(210, Math.min(325, Math.round(vw * 0.185)));
        maxImgH = Math.max(155, Math.min(225, Math.round(vh * 0.21)));
      }

      const { imgW, imgH } = computeNaturalFitDimensions(nw, nh, maxImgW, maxImgH);
      const totalFrameWidthPx = imgW + 10; // 4px padding * 2 + border

      cropEl.style.setProperty('width', `${imgW}px`, 'important');
      cropEl.style.setProperty('height', `${imgH}px`, 'important');

      frameEl.style.setProperty('width', `${totalFrameWidthPx}px`, 'important');
      swingerEl.style.setProperty('width', `${totalFrameWidthPx}px`, 'important');
      swingerEl.style.setProperty('max-width', `${totalFrameWidthPx}px`, 'important');

      img.style.setProperty('width', '100%', 'important');
      img.style.setProperty('height', '100%', 'important');
      img.style.setProperty('object-fit', 'contain', 'important');
      img.style.setProperty('object-position', 'center center', 'important');
    };

    if (img.complete && img.naturalWidth > 0) {
      handlePendulumLoad();
    } else {
      img.addEventListener('load', handlePendulumLoad, { once: true });
    }
  });

  // C. Slide 3 Full-Aspect Dual Showcase (`slide3-1.jpg`, `slide3-2.jpg`) — 100% Natural Aspect Ratio
  const slide3Cards = slideDomElement.querySelectorAll('.full-aspect-card');
  slide3Cards.forEach((cardEl) => {
    const img = cardEl.querySelector('img');
    const wrapEl = cardEl.querySelector('.full-aspect-img-wrap');
    if (!img || !wrapEl) return;

    const handleSlide3Load = () => {
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      if (!nw || !nh) return;

      const maxImgW = Math.max(320, Math.min(620, Math.round(vw * 0.36)));
      const maxImgH = Math.max(185, Math.min(310, Math.round(vh * 0.30)));
      const { imgW, imgH } = computeNaturalFitDimensions(nw, nh, maxImgW, maxImgH);
      const exactCardWidthPx = imgW + 20;

      cardEl.style.setProperty('width', `${exactCardWidthPx}px`, 'important');
      cardEl.style.setProperty('height', 'auto', 'important');

      wrapEl.style.setProperty('width', `${imgW}px`, 'important');
      wrapEl.style.setProperty('height', `${imgH}px`, 'important');
      wrapEl.style.setProperty('flex', 'none', 'important');

      img.style.setProperty('width', '100%', 'important');
      img.style.setProperty('height', '100%', 'important');
      img.style.setProperty('object-fit', 'contain', 'important');
      img.style.setProperty('object-position', 'center center', 'important');
    };

    if (img.complete && img.naturalWidth > 0) {
      handleSlide3Load();
    } else {
      img.addEventListener('load', handleSlide3Load, { once: true });
    }
  });

  // D. Slide 5 (2 Tilted Showcase Cards) & Slide 6 (1 Bottom Tilted Showcase Card) — 100% Natural Aspect Ratio
  const tiltedShowcases = slideDomElement.querySelectorAll('.tilted-3d-showcase');
  tiltedShowcases.forEach((showcaseEl) => {
    const img = showcaseEl.querySelector('.showcase-natural-img');
    const viewportEl = showcaseEl.querySelector('.showcase-img-viewport');
    if (!img || !viewportEl) return;

    const handleShowcaseLoad = () => {
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      if (!nw || !nh) return;

      const isSlide5 = showcaseEl.classList.contains('tilt-slide5');
      const maxImgW = isSlide5
        ? Math.max(310, Math.min(590, Math.round(vw * 0.355)))
        : Math.max(340, Math.min(680, Math.round(vw * 0.405)));
      const maxImgH = isSlide5
        ? Math.max(175, Math.min(290, Math.round(vh * 0.285)))
        : Math.max(185, Math.min(320, Math.round(vh * 0.31)));

      const { imgW, imgH } = computeNaturalFitDimensions(nw, nh, maxImgW, maxImgH);
      const exactCardWidthPx = imgW + 12; // 4px padding * 2 + 2px border * 2

      viewportEl.style.setProperty('width', `${imgW}px`, 'important');
      viewportEl.style.setProperty('height', `${imgH}px`, 'important');
      viewportEl.style.setProperty('flex', 'none', 'important');

      showcaseEl.style.setProperty('width', `${exactCardWidthPx}px`, 'important');
      showcaseEl.style.setProperty('height', 'auto', 'important');

      img.style.setProperty('width', '100%', 'important');
      img.style.setProperty('height', '100%', 'important');
      img.style.setProperty('object-fit', 'contain', 'important');
      img.style.setProperty('object-position', 'center center', 'important');
    };

    if (img.complete && img.naturalWidth > 0) {
      handleShowcaseLoad();
    } else {
      img.addEventListener('load', handleShowcaseLoad, { once: true });
    }
  });
}

/**
 * Builds the Right / Center-Right 3D Visual Showcase region for a slide
 */
function buildVisualRegionMarkup(slide) {
  if (slide.type === 'outro-leaf') {
    return '';
  }

  // Slides 2, 4, 8, 9 -> 3 Diagonal Hanging Cards (100% Natural Aspect Ratio)
  if (
    slide.imageEntrance === 'diagonal-hanging-chain' ||
    slide.imageEntrance === 'vertical-hanging-chain'
  ) {
    return buildDiagonalHangingChainMarkup(slide.images || []);
  }

  // Slide 7 -> 7-Photo Hanging Pendulum Gallery placed cleanly BELOW the title
  if (slide.imageEntrance === 'hanging-pendulum-7') {
    return `
      <div class="slide-visual-region visual-region-campaign-pendulum">
        ${buildPendulumGalleryMarkup(slide.pendulumPhotos, 'pendulum-rack-7cols')}
      </div>
    `;
  }

  // Slide 3 -> Full-Aspect Non-Cropped Dual Showcase (`slide3-1.jpg` & `slide3-2.jpg`)
  if (slide.imageEntrance === 'hologram-full-aspect') {
    const cardsHtml = (slide.images || [])
      .map(
        (img, idx) => `
        <div class="hologram-popup-card full-aspect-card ${
          slide.hasFloorReflection && idx === slide.images.length - 1 ? 'with-floor-reflect' : ''
        }">
          <div class="hologram-scan-beam"></div>
          ${buildCornerSparksMarkup()}
          <div class="full-aspect-img-wrap">
            <img
              src="${img.src}"
              alt="${img.caption}"
              class="full-thematic-photo"
              loading="eager"
            />
          </div>
          <div class="hologram-card-footer">
            <span class="hologram-tag">${img.tag || `0${idx + 1}`}</span>
            <span class="hologram-caption">${img.caption}</span>
          </div>
        </div>
      `
      )
      .join('');

    return `
      <div class="slide-visual-region visual-region-center-right">
        <div class="slide3-full-aspect-grid">
          ${cardsHtml}
        </div>
      </div>
    `;
  }

  // Slide 5 (2 Tilted Cards: `slide5-1.webp`, `slide5-2.jpg`) &
  // Slide 6 (2 Hanging Cards at Top: `slide6-1.jpg`, `slide6-2.webp` + 1 Tilted Card at Bottom: `slide6-4.jpg`)
  if (
    slide.imageEntrance === 'diagonal-focus-sweep' ||
    slide.imageEntrance === 'diagonal-and-pendulum'
  ) {
    const tiltClass = slide.tiltVariant === 'slide5' ? 'tilt-slide5' : 'tilt-slide6';
    const pendulumHtml =
      slide.pendulumPhotos && slide.pendulumPhotos.length > 0
        ? buildPendulumGalleryMarkup(slide.pendulumPhotos, 'pendulum-rack-slide6')
        : '';

    const showcaseCardsHtml = (slide.images || [])
      .map((img, idx) => {
        const fallbackAttr = img.fallbackSrc
          ? `onerror="this.onerror=null;this.src='${img.fallbackSrc}';"`
          : '';
        return `
          <div class="tilted-3d-showcase ${tiltClass} showcase-card-${idx}">
            <div class="showcase-img-viewport">
              <img
                src="${img.src}"
                ${fallbackAttr}
                alt="${img.caption}"
                class="showcase-natural-img"
                loading="eager"
              />
              <div class="diagonal-prism-band"></div>
            </div>
            <div class="showcase-hud-bar">
              <span class="showcase-hud-tag">${img.tag || `0${idx + 1}`}</span>
              <span class="showcase-hud-caption">${img.caption}</span>
            </div>
          </div>
        `;
      })
      .join('');

    return `
      <div class="slide-visual-region visual-region-tilted-showcase ${
        slide.tiltVariant === 'slide5' ? 'region-slide5-stack' : 'region-slide6-combo'
      }">
        ${pendulumHtml}
        ${showcaseCardsHtml}
      </div>
    `;
  }

  // Slide 1 Default Hologram Glass Pop-up
  const holoCardsHtml = (slide.images || [])
    .map(
      (img, idx) => `
      <div class="hologram-popup-card holo-card-${idx}">
        <div class="hologram-scan-beam"></div>
        ${buildCornerSparksMarkup()}
        <div class="hologram-img-wrap">
          <img
            src="${img.src}"
            alt="${img.caption}"
            class="${
              img.isPortraitPersonal ? 'full-personal-photo' : 'full-thematic-photo'
            }"
          />
        </div>
        <div class="hologram-card-footer">
          <span class="hologram-tag">${img.tag || 'ECO HOLOGRAM'}</span>
          <span class="hologram-caption">${img.caption}</span>
        </div>
      </div>
    `
    )
    .join('');

  return `
    <div class="slide-visual-region visual-region-right">
      <div class="hologram-showcase-group">
        ${holoCardsHtml}
      </div>
    </div>
  `;
}

/**
 * Builds the Bullet / Content Block HTML according to the slide's pair layout style
 * Hotfix V5 2.2: Slides with 5-6 items (Slides 3, 4, 5, 6, 8) use a 2-Column Grid so
 * the 2X doubled font size (`clamp(1.75rem, 2.3vw, 2.6rem)`) fits 100% inside the viewport.
 */
function buildBodyContentMarkup(slide) {
  if (slide.type === 'campaign-5cols') {
    const colsHtml = slide.tableRows
      .map(
        (row, idx) => `
        <div class="campaign-day-col anim-body-line" style="--col-idx: ${idx};">
          <div class="day-col-header">
            <span class="day-col-badge word-pop">0${idx + 1}</span>
            <span class="day-col-name">${wrapWordsForPop(row.day)}</span>
          </div>
          <div class="day-col-activity">
            ${wrapWordsForPop(row.activity)}
          </div>
        </div>
      `
      )
      .join('');

    return `
      <div class="campaign-5col-grid">
        ${colsHtml}
      </div>
      <div class="campaign-footer anim-body-line">
        ${wrapWordsForPop(slide.footerNote)}
      </div>
    `;
  }

  if (slide.bulletStyle === 'horizontal-glass-strip') {
    return slide.items
      .map(
        (item, idx) => `
        <div
          class="horizontal-glass-strip anim-body-line"
          style="--step-offset: ${idx * 14}px;"
        >
          <span class="glass-strip-bar"></span>
          <span class="glass-strip-icon word-pop">✦</span>
          <div class="bullet-text">${wrapWordsForPop(item)}</div>
        </div>
      `
      )
      .join('');
  }

  // Pair 2 (Slides 3 & 4 — 5 items): 2-Column Numbered Pill Grid so 2X text fits without overflow
  if (slide.bulletStyle === 'numbered-pills') {
    const pillsHtml = slide.items
      .map(
        (item, idx) => `
        <div class="numbered-pill-item anim-body-line ${
          idx === slide.items.length - 1 && slide.items.length % 2 !== 0
            ? 'pill-item-span2'
            : ''
        }">
          <span class="pill-badge word-pop">${String(idx + 1).padStart(2, '0')}</span>
          <div class="bullet-text">${wrapWordsForPop(item)}</div>
        </div>
      `
      )
      .join('');

    return `<div class="numbered-pills-grid">${pillsHtml}</div>`;
  }

  // Pair 3 (Slides 5 & 6) & Pair 4 (Slide 8): 2-Column Bento Cards
  if (slide.bulletStyle === 'bento-2col' || slide.bulletStyle === 'synthesis-bento') {
    const cardsHtml = slide.items
      .map(
        (item, idx) => `
        <div class="bento-card-item anim-body-line ${
          idx === slide.items.length - 1 && slide.items.length % 2 !== 0
            ? 'bento-card-span2'
            : ''
        }">
          <span class="bento-index word-pop">${String(idx + 1).padStart(2, '0')}</span>
          <div class="bullet-text">${wrapWordsForPop(item)}</div>
        </div>
      `
      )
      .join('');

    return `<div class="bento-2col-grid">${cardsHtml}</div>`;
  }

  if (slide.bulletStyle === 'conclusion-grand') {
    return slide.items
      .map(
        (item, idx) => `
        <div class="conclusion-card-item anim-body-line ${
          idx >= 2 ? 'conclusion-highlight-banner' : ''
        }">
          <span class="bullet-marker word-pop">${idx >= 2 ? '★' : '▹'}</span>
          <div class="bullet-text">${wrapWordsForPop(item)}</div>
        </div>
      `
      )
      .join('');
  }

  return slide.items
    .map(
      (item) => `
      <div class="bullet-item anim-body-line">
        <span class="bullet-marker word-pop">▹</span>
        <div class="bullet-text">${wrapWordsForPop(item)}</div>
      </div>
    `
    )
    .join('');
}

/**
 * Builds the complete HTML structure for any slide (Slides 1 to 10)
 */
function buildSlideMarkup(slide) {
  if (slide.type === 'outro-leaf') {
    return `
      <div class="slide-stage-wrapper layout-slide10-outro" data-slide-id="${slide.id}">
        <div class="outro-emerald-aura"></div>
        <div class="outro-top-meta">
          <div class="slide-header anim-header">
            ${wrapWordsForPop(slide.header)}
          </div>
          <div class="slide-sublabel anim-sublabel">
            ${wrapWordsForPop(slide.subLabel)}
          </div>
        </div>

        <div class="outro-split-headline">
          <h1 class="outro-title-left slide-title-line1 anim-title1">
            ${wrapWordsForPop(slide.titleLine1)}
          </h1>
          <div class="outro-leaf-center-gap" aria-hidden="true"></div>
          <h2 class="outro-title-right slide-title-line2 anim-title2">
            ${wrapWordsForPop(slide.titleLine2)}
          </h2>
        </div>

        <div class="outro-bottom-signature anim-body-line">
          <div class="outro-signature-pill">
            ${wrapWordsForPop(slide.subtitle)}
          </div>
        </div>
      </div>
    `;
  }

  const bodyContentHtml = buildBodyContentMarkup(slide);
  const visualRegionHtml = buildVisualRegionMarkup(slide);
  const framelessFloatingIconsHtml = buildFramelessFloatingIconsLayerMarkup(slide);

  return `
    <div class="slide-stage-wrapper layout-${slide.layoutPair}" data-slide-id="${slide.id}">
      <div class="slide-text-region left-text-container">
        <div class="slide-header anim-header">
          ${wrapWordsForPop(slide.header)}
        </div>
        <div class="slide-sublabel anim-sublabel">
          ${wrapWordsForPop(slide.subLabel)}
        </div>
        <div class="slide-titles-wrap">
          <h1 class="slide-title-line1 anim-title1">
            ${wrapWordsForPop(slide.titleLine1)}
          </h1>
          <h2 class="slide-title-line2 anim-title2">
            ${wrapWordsForPop(slide.titleLine2)}
          </h2>
        </div>
        <div class="slide-content-block">
          ${bodyContentHtml}
        </div>
      </div>
      ${visualRegionHtml}
      ${framelessFloatingIconsHtml}
    </div>
  `;
}

// ============================================================================
// INITIALIZE 3D PRESENTATION + WUTHERING WAVES 3D ASSISTANT (CAMELLYA)
// & PRESENTATION STATE MACHINE (INTERSTITIAL CURTAIN Q&A SLIDES 2 -> 10)
// ============================================================================
const webglContainer = document.getElementById('webgl-container');
const css3dContainer = document.getElementById('css3d-container');
const assistantContainer = document.getElementById('assistant-webgl-container');
const curtainOverlayEl = document.getElementById('interstitial-curtain-overlay');
const curtainBadgeEl = document.getElementById('curtain-slide-badge');
const curtainCommentEl = document.getElementById('curtain-comment-line');
const curtainQuestionEl = document.getElementById('curtain-question-line');
const curtainHintTextEl = document.getElementById('curtain-hint-text');
const topProgressBar = document.getElementById('top-progress-bar');
const slideDotsContainer = document.getElementById('slide-dots');

const css3dStage = document.createElement('div');
css3dStage.className = 'css3d-camera-stage';
css3dContainer.appendChild(css3dStage);

const { scene, camera, renderer, updateNebula, pulseVolumetricFog } =
  createSceneSystem(webglContainer);
const particleSystem = createParticleSilhouetteSystem(scene, camera);
const cameraDirector = createCameraDirector(camera, css3dStage, pulseVolumetricFog);
const assistantSystem = createAssistant3DSystem(assistantContainer);

SLIDES_DATA.forEach((s, index) => {
  const dot = document.createElement('div');
  dot.className = `slide-dot${index === 0 ? ' active' : ''}`;
  slideDotsContainer.appendChild(dot);
});

// ============================================================================
// SECTION 3.1: EXPLICIT PRESENTATION STATE MACHINE (`PresentationStateMachine`)
// & AUTOMATIC VOICEOVER PLAYER (`QuestionVoiceoverPlayer` for `/1.mp3`, `/2.mp3`, `/3.mp3`)
// - Interstitial Curtain ONLY appears between:
//   1. Slide 01 -> Slide 02 (1 Opening Question, `/1.mp3`)
//   2. Slide 09 -> Slide 10 (Dual-Question Finale: Question 1 `/2.mp3` -> Question 2 `/3.mp3`)
// - Slides 02 -> 03 -> 04 -> 05 -> 06 -> 07 -> 08 -> 09 transition directly!
// ============================================================================
let currentSlideIndex = 0;
let isCurtainDown = false;
let pendingSlideIndex = null;
let curtainQuestionStepIndex = 0;
let isTransitioningCurtainStep = false;
let curtainTimeline = null;
let lastNavigationTime = 0;
const NAV_COOLDOWN_MS = 460;

const QuestionVoiceoverPlayer = {
  currentAudio: null,
  stop() {
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
      } catch (_) {
        // Ignore audio reset errors
      }
      this.currentAudio = null;
    }
  },
  play(audioPath) {
    this.stop();
    if (!audioPath || !isCurtainDown) return;
    try {
      const audio = new Audio(audioPath);
      audio.preload = 'auto';
      audio.volume = 1.0;
      audio.addEventListener('error', () => {});
      this.currentAudio = audio;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
    } catch (_) {
      // Safe fallback if audio file is not yet present in public/
    }
  }
};

function getInterstitialStepsForSlideIndex(slideIndex) {
  const slideData = SLIDES_DATA[slideIndex];
  if (!slideData) return null;
  const entry = INTERSTITIAL_QA_BY_SLIDE_ID[slideData.id];
  if (!entry || !Array.isArray(entry.steps) || entry.steps.length === 0) {
    return null;
  }
  return entry.steps;
}

function populateCurtainQuestionDOM(stepData) {
  if (!stepData) return;
  if (curtainBadgeEl) {
    curtainBadgeEl.textContent = stepData.tag || '';
  }
  if (curtainCommentEl) {
    curtainCommentEl.innerHTML = wrapWordsForPop(stepData.comment || '');
  }
  if (curtainQuestionEl) {
    curtainQuestionEl.innerHTML = wrapWordsForPop(stepData.question || '');
  }
  if (curtainHintTextEl) {
    curtainHintTextEl.textContent = stepData.hint || '';
  }
}

/**
 * Runs the Left-to-Right Text Intro for the active Curtain Question (`Tag`, `Comment`, `Question`, `Hint`)
 * and triggers `QuestionVoiceoverPlayer.play(stepData.audio)` ONLY AFTER the text intro completes 100%!
 */
function playCurtainQuestionTextIntro(stepData, includeStageCardPop = false) {
  if (!curtainOverlayEl || !stepData) return;

  if (curtainTimeline) {
    curtainTimeline.kill();
    curtainTimeline = null;
  }
  QuestionVoiceoverPlayer.stop();

  const qaStageEl = curtainOverlayEl.querySelector('.curtain-qa-stage');
  const hintPillEl = curtainOverlayEl.querySelector('.curtain-hint-pill');
  const qaWords = curtainOverlayEl.querySelectorAll('.word-pop');
  const lineBlocks = [
    curtainBadgeEl,
    curtainCommentEl,
    curtainQuestionEl,
    hintPillEl
  ].filter(Boolean);

  gsap.set(lineBlocks, {
    clipPath: 'inset(0% 0% 0% 0%)',
    x: 0,
    opacity: 1,
    filter: 'blur(0px)'
  });

  if (curtainBadgeEl) {
    gsap.set(curtainBadgeEl, {
      opacity: 0,
      x: -22,
      filter: 'blur(6px)',
      clipPath: 'inset(0% 100% 0% 0%)'
    });
  }
  if (hintPillEl) {
    gsap.set(hintPillEl, {
      opacity: 0,
      x: -18,
      filter: 'blur(6px)',
      clipPath: 'inset(0% 100% 0% 0%)'
    });
  }
  gsap.set(qaWords, {
    opacity: 0,
    scale: 0.15,
    x: -14,
    y: 24,
    z: -50,
    filter: 'blur(6px)',
    transformOrigin: '50% 50%'
  });

  const burstTl = gsap.timeline({
    onComplete: () => {
      isTransitioningCurtainStep = false;
      if (isCurtainDown && stepData.audio) {
        QuestionVoiceoverPlayer.play(stepData.audio);
      }
    }
  });
  curtainTimeline = burstTl;

  if (includeStageCardPop && qaStageEl) {
    burstTl.to(
      qaStageEl,
      {
        opacity: 1,
        scale: 1,
        y: 0,
        duration: 0.46,
        ease: 'back.out(1.4)'
      },
      0
    );
  } else if (qaStageEl) {
    gsap.set(qaStageEl, { opacity: 1, scale: 1, y: 0 });
  }

  if (curtainBadgeEl) {
    burstTl.to(
      curtainBadgeEl,
      {
        opacity: 1,
        x: 0,
        filter: 'blur(0px)',
        clipPath: 'inset(0% 0% 0% 0%)',
        duration: 0.42,
        ease: 'power2.out'
      },
      0.02
    );
  }

  burstTl.to(
    qaWords,
    {
      opacity: 1,
      scale: 1,
      x: 0,
      y: 0,
      z: 0,
      filter: 'blur(0px)',
      duration: 0.68,
      stagger: 0.024,
      ease: 'elastic.out(1.12, 0.52)'
    },
    0.06
  );

  if (hintPillEl) {
    burstTl.to(
      hintPillEl,
      {
        opacity: 1,
        x: 0,
        filter: 'blur(0px)',
        clipPath: 'inset(0% 0% 0% 0%)',
        duration: 0.42,
        ease: 'power2.out'
      },
      0.22
    );
  }
}

/**
 * UPDATE V35 SECTION 3: REVERSE WIPE-TO-RIGHT TEXT OUTRO (`0.55s`)
 * Sweeps and dissolves Question 1's text (`Tag`, `Comment`, `Question`, `Hint`) from left to right
 * (`clip-path: inset(0 0 0 0) -> inset(0 0 0 100%)`, `translateX(0 -> +28px)`, `blur(0px -> 8px)`, `opacity: 1 -> 0`)
 * while keeping the curtain down and Nahida swinging on the right, then reveals Question 2 from left to right!
 */
function transitionCurtainToQuestionStep(nextStepIdx) {
  const steps = getInterstitialStepsForSlideIndex(pendingSlideIndex);
  if (!steps || !steps[nextStepIdx] || !curtainOverlayEl) return;

  QuestionVoiceoverPlayer.stop();
  isTransitioningCurtainStep = true;

  if (curtainTimeline) {
    curtainTimeline.kill();
    curtainTimeline = null;
  }

  const hintPillEl = curtainOverlayEl.querySelector('.curtain-hint-pill');
  const qaWords = curtainOverlayEl.querySelectorAll('.word-pop');
  const lineBlocks = [
    curtainBadgeEl,
    curtainCommentEl,
    curtainQuestionEl,
    hintPillEl
  ].filter(Boolean);

  gsap.set(lineBlocks, {
    clipPath: 'inset(0% 0% 0% 0%)',
    x: 0,
    opacity: 1,
    filter: 'blur(0px)'
  });

  const outroTl = gsap.timeline({
    onComplete: () => {
      curtainQuestionStepIndex = nextStepIdx;
      const nextStepData = steps[nextStepIdx];
      populateCurtainQuestionDOM(nextStepData);
      playCurtainQuestionTextIntro(nextStepData, false);
    }
  });
  curtainTimeline = outroTl;

  // Staggered word dissolve sweeping toward the right
  if (qaWords.length > 0) {
    outroTl.to(
      qaWords,
      {
        opacity: 0,
        scale: 0.84,
        x: 28,
        filter: 'blur(8px)',
        duration: 0.36,
        stagger: {
          amount: 0.18,
          from: 'start'
        },
        ease: 'power2.in'
      },
      0
    );
  }

  // Simultaneous Left-to-Right Clip-Path Wipe (`inset(0 0 0 0) -> inset(0 0 0 100%)`) + Rightward Drift in 0.55s
  outroTl.to(
    lineBlocks,
    {
      clipPath: 'inset(0% 0% 0% 100%)',
      x: 28,
      opacity: 0,
      filter: 'blur(8px)',
      duration: 0.55,
      ease: 'power2.inOut'
    },
    0
  );
}

function updateUIProgress(activeIndex, curtainActive = false) {
  const stepValue = activeIndex + 1 - (curtainActive ? 0.5 : 0);
  const pct = (stepValue / SLIDES_DATA.length) * 100;
  if (topProgressBar) {
    topProgressBar.style.width = `${Math.max(5, pct).toFixed(2)}%`;
  }
  const dots = slideDotsContainer.querySelectorAll('.slide-dot');
  dots.forEach((dot, i) => {
    dot.classList.toggle('active', i === activeIndex);
  });
}

/**
 * Renders and animates the Main Slide content (`isCurtainDown === false`)
 * while preserving 100% of existing 3D camera choreography, word bursts,
 * hanging photos, fog curtains, fly-throughs, and Slide 10 Photorealistic Leaf!
 */
function renderAndPlayMainSlide(targetIndex, isInitial = false, prevIndexOverride = null) {
  const prevIdx = prevIndexOverride !== null ? prevIndexOverride : currentSlideIndex;
  const prevSlideId = isInitial ? null : SLIDES_DATA[prevIdx]?.id;

  currentSlideIndex = targetIndex;
  const slideData = SLIDES_DATA[currentSlideIndex];

  const existingSlides = css3dStage.querySelectorAll('.slide-stage-wrapper');
  let outgoingSlideElement = null;
  if (existingSlides.length > 0) {
    outgoingSlideElement = existingSlides[existingSlides.length - 1];
    for (let i = 0; i < existingSlides.length - 1; i++) {
      existingSlides[i].remove();
    }
  }

  const tempWrapper = document.createElement('div');
  tempWrapper.innerHTML = buildSlideMarkup(slideData).trim();
  const incomingSlideElement = tempWrapper.firstElementChild;
  css3dStage.appendChild(incomingSlideElement);

  // Hotfix V7: Auto-detect Portrait vs Landscape (`img.onload`) & hug frames tightly
  applySmartAspectRatioDetection(incomingSlideElement);

  // Hydrate frameless floating cutout icons & individual plastic waste sprites (Slides 2 -> 9)
  hydrateFramelessFloatingIcons(incomingSlideElement);

  particleSystem.transitionToSlide(
    slideData,
    isInitial ? 0.9 : 1.3,
    () => {
      // Trigger "Thanks for Watching!" right when the Photorealistic Leaf freezes in place at center!
      cameraDirector.triggerSlide10OutroTextBurst(incomingSlideElement);
    }
  );

  cameraDirector.playSlideTransition(
    slideData,
    incomingSlideElement,
    isInitial,
    prevSlideId,
    outgoingSlideElement
  );
}

/**
 * SECTION 3.2: `triggerCamellyaPullCurtain(targetSlideIndex)` — UPDATE V35
 * Called ONLY before Slide 02 (`targetSlideIndex === 1`) and Slide 10 (`targetSlideIndex === 9`):
 * 1. Nahida levitates to Center-Top (`x = 0`), turns 180°, and pulls the Projection Curtain down.
 * 2. When the curtain finishes dropping, Nahida runs her Dendro Bloom Frame Outro and spawns
 *    sitting on the glowing Dendro Swing on the right side of the question board.
 * 3. Simultaneously, the Question Text Intro reveals from left to right, and right when the
 *    text intro completes, `QuestionVoiceoverPlayer` plays `/1.mp3` (Slide 2) or `/2.mp3` (Slide 10 Part 1)!
 */
export function triggerCamellyaPullCurtain(targetSlideIndex) {
  const steps = getInterstitialStepsForSlideIndex(targetSlideIndex);
  if (!steps || !curtainOverlayEl) return;

  QuestionVoiceoverPlayer.stop();
  curtainQuestionStepIndex = 0;
  isTransitioningCurtainStep = false;

  if (curtainTimeline) {
    curtainTimeline.kill();
    curtainTimeline = null;
  }

  const firstStepData = steps[0];
  populateCurtainQuestionDOM(firstStepData);

  const qaStageEl = curtainOverlayEl.querySelector('.curtain-qa-stage');
  const hintPillEl = curtainOverlayEl.querySelector('.curtain-hint-pill');
  const qaWords = curtainOverlayEl.querySelectorAll('.word-pop');
  const lineBlocks = [
    curtainBadgeEl,
    curtainCommentEl,
    curtainQuestionEl,
    hintPillEl
  ].filter(Boolean);

  // Pre-position the Curtain's bottom glowing bar at `top: 10vh` (`yPercent: -90`)
  gsap.killTweensOf(curtainOverlayEl);
  gsap.set(curtainOverlayEl, {
    yPercent: -90,
    y: 0,
    autoAlpha: 1
  });
  if (qaStageEl) {
    gsap.set(qaStageEl, { opacity: 0, scale: 0.92, y: 24 });
  }
  gsap.set(lineBlocks, {
    clipPath: 'inset(0% 0% 0% 0%)',
    x: 0,
    opacity: 1,
    filter: 'blur(0px)'
  });
  gsap.set(qaWords, {
    opacity: 0,
    scale: 0.15,
    y: 26,
    z: -50,
    transformOrigin: '50% 50%'
  });

  curtainOverlayEl.setAttribute('aria-hidden', 'false');

  // Run Nahida's Graceful Levitation -> 180° Turn -> Left-Hand 1-Stroke Curtain Pull -> Dendro Swing!
  assistantSystem.triggerCamellyaPullCurtain(targetSlideIndex, {
    fromSlideIndex: currentSlideIndex,
    onCurtainDropStart: () => {
      gsap.fromTo(
        curtainOverlayEl,
        { yPercent: -90, y: 0, autoAlpha: 1 },
        {
          yPercent: 0,
          y: 0,
          autoAlpha: 1,
          duration: 1.4,
          ease: 'power2.inOut'
        }
      );
    },
    onShowQuestion: () => {
      playCurtainQuestionTextIntro(firstStepData, true);
    }
  });
}
window.triggerCamellyaPullCurtain = triggerCamellyaPullCurtain;

/**
 * Retracts / dissolves the Projection Curtain upward in `0.5s` when revealing the target slide
 */
function retractProjectionCurtain(duration = 0.5) {
  QuestionVoiceoverPlayer.stop();
  isTransitioningCurtainStep = false;
  if (!curtainOverlayEl) return;
  if (curtainTimeline) {
    curtainTimeline.kill();
    curtainTimeline = null;
  }
  gsap.killTweensOf(curtainOverlayEl);
  curtainOverlayEl.setAttribute('aria-hidden', 'true');
  gsap.to(curtainOverlayEl, {
    yPercent: -100,
    y: 0,
    autoAlpha: 0,
    duration,
    ease: 'power3.inOut'
  });
}

/**
 * SECTION 3.1: `nextSlide()` — Forward Navigation (Right-Click / ArrowRight / Space / PageDown)
 * UPDATE V35:
 * - Interstitial Curtain ONLY appears between Slide 01 -> 02 (`nextIdx === 1`) and Slide 09 -> 10 (`nextIdx === 9`).
 * - Slides 02 -> 03 -> 04 -> 05 -> 06 -> 07 -> 08 -> 09 transition directly without any curtain!
 * - On the Slide 09 -> 10 Dual-Question Curtain:
 *   + Click 1 transitions from Question 1 (`/2.mp3`) to Question 2 (`/3.mp3`) using the `0.55s`
 *     Reverse Wipe-to-Right Text Outro while Nahida continues swinging on the right!
 *   + Click 2 retracts the curtain and reveals Slide 10!
 */
function nextSlide() {
  const now = performance.now();
  if (now - lastNavigationTime < NAV_COOLDOWN_MS || isTransitioningCurtainStep) {
    return;
  }
  lastNavigationTime = now;

  // Always stop any active voiceover immediately upon user navigation
  QuestionVoiceoverPlayer.stop();

  // BRANCH A: `isCurtainDown === true`
  if (isCurtainDown) {
    const activeSteps = getInterstitialStepsForSlideIndex(pendingSlideIndex);

    // If this curtain has another question step (e.g. Slide 09 -> 10 Question 1 -> Question 2):
    // Run Reverse Wipe-to-Right Text Outro (`0.55s`) -> Reveal Question 2 -> Play `/3.mp3`!
    if (activeSteps && curtainQuestionStepIndex + 1 < activeSteps.length) {
      transitionCurtainToQuestionStep(curtainQuestionStepIndex + 1);
      return;
    }

    // Otherwise, all question steps on this curtain are finished -> Retract curtain & reveal target slide!
    isCurtainDown = false;
    curtainQuestionStepIndex = 0;
    const targetIdx =
      pendingSlideIndex !== null
        ? pendingSlideIndex
        : (currentSlideIndex + 1) % SLIDES_DATA.length;
    const prevIdx = currentSlideIndex;
    pendingSlideIndex = null;

    retractProjectionCurtain(0.5);
    updateUIProgress(targetIdx, false);
    assistantSystem.setAssistantSlideState(targetIdx, false);
    renderAndPlayMainSlide(targetIdx, false, prevIdx);
    return;
  }

  // BRANCH B: `isCurtainDown === false`
  const nextIdx = (currentSlideIndex + 1) % SLIDES_DATA.length;
  const nextSteps = getInterstitialStepsForSlideIndex(nextIdx);

  // ONLY stop for the Interstitial Curtain if `nextIdx` has configured interstitial questions
  // (i.e. Slide 01 -> Slide 02 (`nextIdx === 1`) and Slide 09 -> Slide 10 (`nextIdx === 9`))!
  if (nextSteps && nextSteps.length > 0) {
    isCurtainDown = true;
    pendingSlideIndex = nextIdx;
    curtainQuestionStepIndex = 0;
    updateUIProgress(nextIdx, true);
    triggerCamellyaPullCurtain(pendingSlideIndex);
  } else {
    // Direct, immediate slide transition (Slides 02 -> 03 -> 04 -> 05 -> 06 -> 07 -> 08 -> 09, and 10 -> 01)
    isCurtainDown = false;
    pendingSlideIndex = null;
    curtainQuestionStepIndex = 0;
    retractProjectionCurtain(0.45);
    updateUIProgress(nextIdx, false);
    assistantSystem.setAssistantSlideState(nextIdx, false);
    renderAndPlayMainSlide(nextIdx, false, currentSlideIndex);
  }
}

/**
 * Backward Navigation (Left-Click / ArrowLeft / PageUp)
 */
function prevSlide() {
  const now = performance.now();
  if (now - lastNavigationTime < NAV_COOLDOWN_MS || isTransitioningCurtainStep) {
    return;
  }
  lastNavigationTime = now;

  // Always stop any active voiceover immediately upon user navigation
  QuestionVoiceoverPlayer.stop();

  // If curtain is currently down:
  if (isCurtainDown) {
    // If on Question 2 of the Dual-Question Curtain, step back to Question 1
    const activeSteps = getInterstitialStepsForSlideIndex(pendingSlideIndex);
    if (activeSteps && curtainQuestionStepIndex > 0) {
      transitionCurtainToQuestionStep(curtainQuestionStepIndex - 1);
      return;
    }

    // Otherwise retract curtain and stay on the current Slide N!
    isCurtainDown = false;
    pendingSlideIndex = null;
    curtainQuestionStepIndex = 0;
    retractProjectionCurtain(0.45);
    updateUIProgress(currentSlideIndex, false);
    assistantSystem.setAssistantSlideState(currentSlideIndex, false);
    return;
  }

  const prevIdx = (currentSlideIndex - 1 + SLIDES_DATA.length) % SLIDES_DATA.length;
  isCurtainDown = false;
  pendingSlideIndex = null;
  curtainQuestionStepIndex = 0;
  retractProjectionCurtain(0.4);
  updateUIProgress(prevIdx, false);
  assistantSystem.setAssistantSlideState(prevIdx, false);
  renderAndPlayMainSlide(prevIdx, false, currentSlideIndex);
}

const navLeft = document.getElementById('nav-left');
const navRight = document.getElementById('nav-right');

navLeft.addEventListener('click', () => {
  prevSlide();
});

navRight.addEventListener('click', () => {
  nextSlide();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
    e.preventDefault();
    nextSlide();
  } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
    e.preventDefault();
    prevSlide();
  }
});

let targetMouseX = 0;
let targetMouseY = 0;
let smoothMouseX = 0;
let smoothMouseY = 0;

window.addEventListener('mousemove', (e) => {
  const ndcX = (e.clientX / window.innerWidth - 0.5) * 2;
  const ndcY = (e.clientY / window.innerHeight - 0.5) * 2;
  targetMouseX = ndcX;
  targetMouseY = ndcY;

  particleSystem.onMouseMoveNormalized(ndcX, ndcY);
});

window.addEventListener('resize', () => {
  const activeSlides = css3dStage.querySelectorAll('.slide-stage-wrapper');
  activeSlides.forEach((slideEl) => {
    applySmartAspectRatioDetection(slideEl);
    hydrateFramelessFloatingIcons(slideEl);
  });
});

/**
 * ============================================================================
 * UPDATE V37 SECTION 5: NAHIDA BOTANICAL DENDRO SANCTUARY DECORATION
 * - Strict Safe-Zone Layout:
 *   1. Left Botanical Border (`left: 0`, `width: 11vw` max) — never touches Q&A text
 *   2. Top-Right Corner Arch & Bottom-Right Low Foliage (`max-height: 14vh`, `opacity: 0.72`)
 *      — ZERO foliage at mid-height on the right where Nahida swings!
 * - Mathematical Geometry:
 *   + Cubic Bézier Vines with Logarithmic Spiral Tendrils:
 *     x(theta) = a * exp(b * theta) * cos(theta), y(theta) = a * exp(b * theta) * sin(theta)
 *   + Four-Pointed Dendro Clover Blossoms:
 *     r(phi) = R0 * (0.55 + 0.45 * cos^4(2 * phi))
 *   + Pastel-violet Padisarah buds (`#c4b5fd`), teardrop young leaves & spirit motes
 * ============================================================================
 */
function buildLogarithmicSpiralPath(cx, cy, a, b, thetaStart, thetaEnd, steps = 42, chirality = 1) {
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const theta = thetaStart + (thetaEnd - thetaStart) * u;
    const radius = a * Math.exp(b * theta);
    const x = cx + radius * Math.cos(chirality * theta);
    const y = cy + radius * Math.sin(chirality * theta);
    d += i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return d;
}

function buildDendroCloverPath(cx, cy, r0, rotationRad = 0, steps = 96) {
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const phi = (i / steps) * Math.PI * 2;
    const cos2Phi = Math.cos(2 * phi);
    const cos4 = cos2Phi * cos2Phi * cos2Phi * cos2Phi;
    const r = r0 * (0.55 + 0.45 * cos4);
    const ang = phi + rotationRad;
    const x = cx + r * Math.cos(ang);
    const y = cy + r * Math.sin(ang);
    d += i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return `${d} Z`;
}

function buildDendroCloverBlossomSVG(cx, cy, r0, rotDeg = 15, delaySec = 0) {
  const rotRad = (rotDeg * Math.PI) / 180;
  const outerPath = buildDendroCloverPath(cx, cy, r0, rotRad, 96);
  const innerPath = buildDendroCloverPath(cx, cy, r0 * 0.56, rotRad + Math.PI / 4, 72);
  let veins = '';
  for (let k = 0; k < 4; k++) {
    const ang = rotRad + (k * Math.PI) / 2;
    const vx = cx + r0 * 0.78 * Math.cos(ang);
    const vy = cy + r0 * 0.78 * Math.sin(ang);
    veins += `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${vx.toFixed(1)}" y2="${vy.toFixed(1)}" stroke="rgba(254, 249, 195, 0.85)" stroke-width="1.1" stroke-linecap="round" />`;
  }
  return `
    <g class="botanical-clover-blossom" style="transform-origin: ${cx}px ${cy}px; animation-delay: ${delaySec}s;">
      <path d="${outerPath}" fill="url(#nahidaCloverGrad)" stroke="rgba(248, 250, 252, 0.92)" stroke-width="1.35" />
      <path d="${innerPath}" fill="rgba(217, 249, 157, 0.78)" stroke="rgba(255, 255, 255, 0.75)" stroke-width="0.8" />
      ${veins}
      <circle cx="${cx}" cy="${cy}" r="${(r0 * 0.22).toFixed(2)}" fill="#fef08a" stroke="#ecfccb" stroke-width="1.1" />
    </g>
  `;
}

function buildTeardropLeafSVG(x, y, scale = 1, angleDeg = 30) {
  return `
    <g transform="translate(${x}, ${y}) rotate(${angleDeg}) scale(${scale})">
      <path d="M 0 0 C 7 -5, 16 -4, 22 0 C 16 4, 7 5, 0 0 Z" fill="url(#nahidaLeafGrad)" stroke="rgba(217, 249, 157, 0.82)" stroke-width="0.9" />
      <path d="M 1 0 Q 11 -0.6, 19 0" fill="none" stroke="rgba(236, 252, 203, 0.85)" stroke-width="0.75" />
    </g>
  `;
}

function buildPadisarahBudSVG(x, y, scale = 1, angleDeg = -20) {
  return `
    <g transform="translate(${x}, ${y}) rotate(${angleDeg}) scale(${scale})">
      <path d="M 0 0 C 4 -7, 11 -7, 15 0 C 11 7, 4 7, 0 0 Z" fill="url(#padisarahBudGrad)" stroke="rgba(243, 232, 255, 0.88)" stroke-width="0.95" />
      <path d="M 2 -1 C 6 -4, 10 -4, 13 0" fill="none" stroke="rgba(250, 245, 255, 0.8)" stroke-width="0.7" />
      <circle cx="14.5" cy="0" r="1.6" fill="#fef08a" />
    </g>
  `;
}

function initNahidaBotanicalSanctuary() {
  const sanctuaryEl = document.getElementById('nahida-botanical-sanctuary');
  if (!sanctuaryEl) return;

  // 1. Left Botanical Border Spirals (`x(theta) = a e^(b*theta) cos(theta)`)
  const leftSpiral1 = buildLogarithmicSpiralPath(76, 158, 22, -0.15, 0.2, Math.PI * 3.1, 44, 1);
  const leftSpiral2 = buildLogarithmicSpiralPath(94, 342, 24, -0.15, 0.5, Math.PI * 3.2, 44, -1);
  const leftSpiral3 = buildLogarithmicSpiralPath(82, 540, 21, -0.15, 0.1, Math.PI * 3.1, 44, 1);
  const leftSpiral4 = buildLogarithmicSpiralPath(92, 742, 23, -0.15, 0.4, Math.PI * 3.2, 44, -1);
  const leftSpiral5 = buildLogarithmicSpiralPath(68, 912, 19, -0.15, 0.0, Math.PI * 3.0, 40, 1);

  // 2. Top-Right Corner Arch Spirals
  const topRightSpiral1 = buildLogarithmicSpiralPath(292, 92, 20, -0.15, 0.4, Math.PI * 3.1, 42, -1);
  const topRightSpiral2 = buildLogarithmicSpiralPath(168, 74, 18, -0.15, 0.1, Math.PI * 3.0, 40, 1);

  // 3. Bottom-Right Low Foliage Spirals (max-height: 14vh, behind Nahida's swing)
  const botRightSpiral1 = buildLogarithmicSpiralPath(136, 72, 19, -0.15, 0.2, Math.PI * 3.1, 42, 1);
  const botRightSpiral2 = buildLogarithmicSpiralPath(318, 64, 21, -0.15, 0.6, Math.PI * 3.1, 42, -1);
  const botRightSpiral3 = buildLogarithmicSpiralPath(478, 58, 18, -0.15, 0.3, Math.PI * 3.0, 40, 1);

  // Floating Dendro Spirit Motes along Left & Right outer sanctuary edges
  const moteConfigs = [
    { left: '1.8vw', top: '14vh', size: 6, dur: 4.4, delay: 0.0, color: '#86efac' },
    { left: '4.6vw', top: '24vh', size: 5, dur: 5.1, delay: 0.7, color: '#d9f99d' },
    { left: '2.4vw', top: '38vh', size: 7, dur: 4.6, delay: 1.3, color: '#34d399' },
    { left: '6.2vw', top: '49vh', size: 5, dur: 5.3, delay: 0.4, color: '#c4b5fd' },
    { left: '3.1vw', top: '63vh', size: 6, dur: 4.8, delay: 1.8, color: '#86efac' },
    { left: '5.5vw', top: '76vh', size: 5, dur: 4.3, delay: 0.9, color: '#d9f99d' },
    { left: '2.2vw', top: '87vh', size: 6, dur: 5.0, delay: 1.5, color: '#34d399' },
    { right: '4.5vw', top: '8vh', size: 6, dur: 4.7, delay: 0.3, color: '#d9f99d' },
    { right: '11.5vw', top: '12vh', size: 5, dur: 5.2, delay: 1.1, color: '#c4b5fd' },
    { right: '6.0vw', bottom: '9vh', size: 6, dur: 4.5, delay: 0.5, color: '#86efac' },
    { right: '15.0vw', bottom: '6.5vh', size: 5, dur: 4.9, delay: 1.4, color: '#d9f99d' },
    { right: '24.0vw', bottom: '8vh', size: 5, dur: 5.4, delay: 0.8, color: '#c4b5fd' }
  ];

  const motesHtml = moteConfigs
    .map((m) => {
      const posStyle = `${m.left ? `left:${m.left};` : ''}${m.right ? `right:${m.right};` : ''}${
        m.top ? `top:${m.top};` : ''
      }${m.bottom ? `bottom:${m.bottom};` : ''}`;
      return `<span class="dendro-spirit-mote" style="${posStyle}width:${m.size}px;height:${m.size}px;background:${m.color};animation-duration:${m.dur}s;animation-delay:${m.delay}s;"></span>`;
    })
    .join('');

  sanctuaryEl.innerHTML = `
    <!-- Shared SVG Gradients for Nahida Dendro Sanctuary -->
    <svg width="0" height="0" style="position:absolute;visibility:hidden;" aria-hidden="true">
      <defs>
        <linearGradient id="nahidaVineGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#34d399" stop-opacity="0.92" />
          <stop offset="55%" stop-color="#86efac" stop-opacity="0.88" />
          <stop offset="100%" stop-color="#d9f99d" stop-opacity="0.95" />
        </linearGradient>
        <radialGradient id="nahidaCloverGrad" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stop-color="#ecfccb" stop-opacity="0.98" />
          <stop offset="55%" stop-color="#86efac" stop-opacity="0.92" />
          <stop offset="100%" stop-color="#34d399" stop-opacity="0.88" />
        </radialGradient>
        <linearGradient id="nahidaLeafGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#10b981" stop-opacity="0.88" />
          <stop offset="65%" stop-color="#34d399" stop-opacity="0.9" />
          <stop offset="100%" stop-color="#d9f99d" stop-opacity="0.95" />
        </linearGradient>
        <linearGradient id="padisarahBudGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#a78bfa" stop-opacity="0.88" />
          <stop offset="65%" stop-color="#c4b5fd" stop-opacity="0.92" />
          <stop offset="100%" stop-color="#ede9fe" stop-opacity="0.96" />
        </linearGradient>
      </defs>
    </svg>

    <!-- 1. LEFT BOTANICAL BORDER (left: 0, max width: 11vw, outside .curtain-qa-stage safe zone) -->
    <div class="botanical-left-border">
      <svg viewBox="0 0 160 1000" preserveAspectRatio="none" class="botanical-svg-canvas">
        <g class="botanical-sway-branch">
          <!-- Main Cubic Bézier Sanctuary Vines -->
          <path d="M 6 0 C 56 120, 12 245, 58 370 C 96 480, 18 615, 62 745 C 94 845, 22 930, 48 1000"
                fill="none" stroke="url(#nahidaVineGrad)" stroke-width="2.8" stroke-linecap="round" />
          <path d="M 0 65 C 38 155, 76 215, 42 325 C 12 425, 78 525, 38 650 C 8 745, 64 855, 24 980"
                fill="none" stroke="rgba(134, 239, 172, 0.62)" stroke-width="1.75" stroke-linecap="round" />

          <!-- Secondary Cubic Bézier Side Tendrils feeding into Logarithmic Spirals -->
          <path d="M 36 118 C 56 126, 72 138, 76 158" fill="none" stroke="url(#nahidaVineGrad)" stroke-width="1.7" />
          <path d="${leftSpiral1}" fill="none" stroke="url(#nahidaVineGrad)" stroke-width="1.45" stroke-linecap="round" />

          <path d="M 48 305 C 72 312, 88 324, 94 342" fill="none" stroke="url(#nahidaVineGrad)" stroke-width="1.7" />
          <path d="${leftSpiral2}" fill="none" stroke="url(#nahidaVineGrad)" stroke-width="1.45" stroke-linecap="round" />

          <path d="M 44 498 C 66 508, 78 520, 82 540" fill="none" stroke="url(#nahidaVineGrad)" stroke-width="1.7" />
          <path d="${leftSpiral3}" fill="none" stroke="url(#nahidaVineGrad)" stroke-width="1.45" stroke-linecap="round" />

          <path d="M 52 702 C 74 712, 88 724, 92 742" fill="none" stroke="url(#nahidaVineGrad)" stroke-width="1.7" />
          <path d="${leftSpiral4}" fill="none" stroke="url(#nahidaVineGrad)" stroke-width="1.45" stroke-linecap="round" />

          <path d="M 38 878 C 54 888, 64 898, 68 912" fill="none" stroke="url(#nahidaVineGrad)" stroke-width="1.6" />
          <path d="${leftSpiral5}" fill="none" stroke="url(#nahidaVineGrad)" stroke-width="1.4" stroke-linecap="round" />

          <!-- Teardrop Young Dendro Leaves -->
          ${buildTeardropLeafSVG(34, 82, 1.05, 28)}
          ${buildTeardropLeafSVG(26, 195, 0.95, -24)}
          ${buildTeardropLeafSVG(52, 265, 1.1, 32)}
          ${buildTeardropLeafSVG(32, 412, 1.0, 22)}
          ${buildTeardropLeafSVG(58, 468, 0.92, -28)}
          ${buildTeardropLeafSVG(36, 598, 1.08, 30)}
          ${buildTeardropLeafSVG(28, 678, 0.95, -20)}
          ${buildTeardropLeafSVG(54, 805, 1.04, 26)}
          ${buildTeardropLeafSVG(32, 935, 0.92, 18)}

          <!-- Pastel-Violet Padisarah Flower Buds (#c4b5fd) -->
          ${buildPadisarahBudSVG(62, 128, 1.05, -18)}
          ${buildPadisarahBudSVG(46, 286, 0.95, 24)}
          ${buildPadisarahBudSVG(68, 488, 1.08, -22)}
          ${buildPadisarahBudSVG(44, 652, 0.96, 20)}
          ${buildPadisarahBudSVG(64, 838, 1.02, -16)}

          <!-- Four-Pointed Dendro Clover Blossoms: r(phi) = R0 * (0.55 + 0.45 * cos^4(2*phi)) -->
          ${buildDendroCloverBlossomSVG(46, 112, 15.5, 12, 0.0)}
          ${buildDendroCloverBlossomSVG(62, 238, 13.0, 34, 0.6)}
          ${buildDendroCloverBlossomSVG(54, 372, 16.5, -18, 1.2)}
          ${buildDendroCloverBlossomSVG(44, 526, 14.0, 22, 1.8)}
          ${buildDendroCloverBlossomSVG(60, 692, 16.0, -14, 2.4)}
          ${buildDendroCloverBlossomSVG(46, 862, 14.5, 28, 3.0)}
        </g>
      </svg>
    </div>

    <!-- 2. TOP-RIGHT CORNER ARCH (Only at very top-right corner, well above Nahida's swing) -->
    <div class="botanical-topright-arch">
      <svg viewBox="0 0 380 210" preserveAspectRatio="none" class="botanical-svg-canvas">
        <g class="botanical-sway-branch" style="transform-origin: 360px 10px;">
          <path d="M 380 8 C 310 18, 248 48, 188 34 C 132 22, 84 42, 28 16"
                fill="none" stroke="url(#nahidaVineGrad)" stroke-width="2.5" stroke-linecap="round" />
          <path d="M 380 38 C 328 54, 298 68, 292 92"
                fill="none" stroke="url(#nahidaVineGrad)" stroke-width="1.75" stroke-linecap="round" />
          <path d="${topRightSpiral1}" fill="none" stroke="url(#nahidaVineGrad)" stroke-width="1.45" stroke-linecap="round" />
          <path d="M 218 32 C 192 44, 174 56, 168 74"
                fill="none" stroke="url(#nahidaVineGrad)" stroke-width="1.6" stroke-linecap="round" />
          <path d="${topRightSpiral2}" fill="none" stroke="url(#nahidaVineGrad)" stroke-width="1.35" stroke-linecap="round" />

          ${buildTeardropLeafSVG(322, 26, 1.0, 145)}
          ${buildTeardropLeafSVG(246, 38, 0.95, 160)}
          ${buildTeardropLeafSVG(138, 28, 0.9, 152)}
          ${buildPadisarahBudSVG(268, 52, 1.0, 135)}
          ${buildPadisarahBudSVG(152, 42, 0.92, 148)}

          ${buildDendroCloverBlossomSVG(334, 34, 15.0, 18, 0.4)}
          ${buildDendroCloverBlossomSVG(232, 36, 13.5, -22, 1.1)}
          ${buildDendroCloverBlossomSVG(112, 24, 12.0, 14, 1.9)}
        </g>
      </svg>
    </div>

    <!-- 3. BOTTOM-RIGHT LOW FOLIAGE (max-height: 14vh, opacity: 0.72, z-index behind Nahida's 3D canvas) -->
    <div class="botanical-bottomright-foliage">
      <svg viewBox="0 0 600 150" preserveAspectRatio="none" class="botanical-svg-canvas">
        <g class="botanical-sway-branch" style="transform-origin: 540px 145px;">
          <path d="M 600 138 C 485 104, 372 132, 255 108 C 165 92, 85 126, 12 142"
                fill="none" stroke="url(#nahidaVineGrad)" stroke-width="2.6" stroke-linecap="round" />
          <path d="M 580 146 C 460 124, 330 140, 190 122 C 118 112, 58 134, 0 148"
                fill="none" stroke="rgba(134, 239, 172, 0.58)" stroke-width="1.7" stroke-linecap="round" />

          <path d="M 168 114 C 152 98, 142 86, 136 72" fill="none" stroke="url(#nahidaVineGrad)" stroke-width="1.6" />
          <path d="${botRightSpiral1}" fill="none" stroke="url(#nahidaVineGrad)" stroke-width="1.35" stroke-linecap="round" />

          <path d="M 352 118 C 336 98, 324 82, 318 64" fill="none" stroke="url(#nahidaVineGrad)" stroke-width="1.65" />
          <path d="${botRightSpiral2}" fill="none" stroke="url(#nahidaVineGrad)" stroke-width="1.4" stroke-linecap="round" />

          <path d="M 512 116 C 496 94, 484 76, 478 58" fill="none" stroke="url(#nahidaVineGrad)" stroke-width="1.65" />
          <path d="${botRightSpiral3}" fill="none" stroke="url(#nahidaVineGrad)" stroke-width="1.4" stroke-linecap="round" />

          ${buildTeardropLeafSVG(92, 124, 0.95, -32)}
          ${buildTeardropLeafSVG(218, 108, 1.05, -26)}
          ${buildTeardropLeafSVG(288, 114, 0.95, -145)}
          ${buildTeardropLeafSVG(412, 112, 1.08, -28)}
          ${buildTeardropLeafSVG(542, 118, 1.0, -140)}

          ${buildPadisarahBudSVG(186, 98, 0.98, -38)}
          ${buildPadisarahBudSVG(382, 96, 1.05, -32)}
          ${buildPadisarahBudSVG(528, 92, 0.96, -44)}

          ${buildDendroCloverBlossomSVG(118, 114, 13.0, 16, 0.3)}
          ${buildDendroCloverBlossomSVG(248, 104, 15.0, -20, 1.0)}
          ${buildDendroCloverBlossomSVG(428, 102, 15.5, 24, 1.7)}
          ${buildDendroCloverBlossomSVG(554, 108, 14.0, -15, 2.3)}
        </g>
      </svg>
    </div>

    <!-- 4. FLOATING DENDRO SPIRIT MOTES -->
    <div class="botanical-spirit-motes-layer">${motesHtml}</div>
  `;
}

// Initial load: Slide 1 (Title) directly, NO interstitial curtain before Slide 1
initNahidaBotanicalSanctuary();
gsap.set(curtainOverlayEl, { yPercent: -100, y: 0, autoAlpha: 0 });
updateUIProgress(0, false);
renderAndPlayMainSlide(0, true, 0);
assistantSystem.setAssistantSlideState(0, false, { immediate: false });

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const elapsedTime = clock.getElapsedTime();

  smoothMouseX += (targetMouseX - smoothMouseX) * 0.07;
  smoothMouseY += (targetMouseY - smoothMouseY) * 0.07;

  updateNebula(elapsedTime);
  particleSystem.update(elapsedTime, smoothMouseX, smoothMouseY);
  cameraDirector.applyRigToScene(smoothMouseX, smoothMouseY, elapsedTime);
  assistantSystem.update(elapsedTime, smoothMouseX, smoothMouseY);

  renderer.render(scene, camera);
}

animate();
