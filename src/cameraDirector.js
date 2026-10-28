import * as THREE from 'three';
import gsap from 'gsap';

/**
 * Blender-Style Camera Choreography, Volumetric Fog Curtain / Fly-Through,
 * Image-First Camera Tracking (Slides 4-7) & Canva Elastic Burst (`cameraDirector.js`)
 *
 * Hotfix V4 Implemented:
 * 1. Slides 4 to 7 — Reversed Camera Script (Image-First Camera Tracking):
 *    - Step 1: Camera immediately zooms/pans to the Right/Canopy Image region first.
 *    - Step 2: Camera glides along the emerging images as they drop/tilt into view.
 *    - Step 3: Camera pans left to the Text block while dollying out as the words burst out.
 * 2. Slide 7 -> Slide 8 — Fog Curtain Immersion:
 *    - Slide 7 scales down ONLY to `scale: 0.75` (never tiny).
 *    - At `scale: 0.75`, Camera sinks into a thick 100% emerald fog curtain (`opacity: 1`),
 *      blurring (`blur(20px)`) and veiling Slide 7 completely.
 *    - Fog parts to reveal Slide 8 emerging from `scale: 0.85 -> 1.0`.
 * 3. Slide 8 -> 9 AND Slide 9 -> 10 — True Fly-Through Center of Old Slide:
 *    - Never hides or deletes the old slide at `t = 0`.
 *    - Entire old slide (text + images intact) hurtles toward the lens (`scale: 1 -> 4.5`,
 *      `z: 0 -> 900px`), splitting past both ears of the Camera (`blur(12px)` + fade in 2nd half).
 *    - Simultaneously, the new slide (Slide 9, or Slide 10 + 3D Leaf) emerges from deep behind
 *      the center of the old slide (`scale: 0.2 -> 1.0`, `z: -600px -> 0`).
 */

export function createCameraDirector(camera, css3dStageElement, pulseVolumetricFog) {
  let activeTimeline = null;
  const fogOverlayEl = document.getElementById('fog-transition-overlay');

  const STANDARD_OFFSET = new THREE.Vector3(0, 0, 8.5);

  const rigState = {
    worldX: 0,
    worldY: 0,
    worldZ: 8.5,
    rotX: 0,
    rotY: 0,
    rotZ: 0,
    trackX: 0,
    trackY: 0,
    trackZ: 0,
    tiltX: 0,
    tiltY: 0,
    tiltZ: 0
  };

  function applyRigToScene(mouseX = 0, mouseY = 0, elapsedTime = 0) {
    camera.position.set(
      rigState.worldX + rigState.trackX * 0.28 + mouseX * 0.35,
      rigState.worldY + rigState.trackY * 0.25 + mouseY * 0.25,
      rigState.worldZ - rigState.trackZ * 0.32
    );

    camera.rotation.set(
      rigState.rotX + THREE.MathUtils.degToRad(rigState.tiltX) - mouseY * 0.03,
      rigState.rotY + THREE.MathUtils.degToRad(rigState.tiltY) - mouseX * 0.04,
      rigState.rotZ + THREE.MathUtils.degToRad(rigState.tiltZ)
    );

    if (css3dStageElement) {
      const pxX = -rigState.trackX * 26 - mouseX * 12;
      const pxY = rigState.trackY * 26 + mouseY * 8;
      const pxZ = rigState.trackZ * 55;
      const rx = rigState.tiltX - mouseY * 1.4;
      const ry = rigState.tiltY + mouseX * 1.8;
      const rz = rigState.tiltZ;

      css3dStageElement.style.transform = `translate3d(${pxX.toFixed(2)}px, ${pxY.toFixed(2)}px, ${pxZ.toFixed(2)}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg)`;

      const pendulumCards = css3dStageElement.querySelectorAll(
        '.pendulum-card-swinger, .diagonal-chain-swinger'
      );
      pendulumCards.forEach((swinger) => {
        const baseRotZ = parseFloat(swinger.dataset.rotZ || '0');
        const baseRotY = parseFloat(swinger.dataset.rotY || '0');
        const phase = parseFloat(swinger.dataset.phase || '0');

        const swingZ = baseRotZ + Math.sin(elapsedTime * 1.65 + phase) * 1.5 + mouseX * 1.3;
        const swingY = baseRotY + Math.cos(elapsedTime * 1.25 + phase) * 2.5 + mouseX * 2.0;
        const swingX = Math.sin(elapsedTime * 1.1 + phase) * 1.1 - mouseY * 1.1;

        swinger.style.transform = `rotateZ(${swingZ.toFixed(2)}deg) rotateY(${swingY.toFixed(2)}deg) rotateX(${swingX.toFixed(2)}deg)`;
      });

      const floatingIcons = css3dStageElement.querySelectorAll('.frameless-floating-icon-unit');
      floatingIcons.forEach((unit) => {
        const depth = parseFloat(unit.dataset.parallaxDepth || '1.15');
        const pX = -mouseX * 10.5 * depth;
        const pY = mouseY * 7.5 * depth;
        unit.style.transform = `translate3d(${pX.toFixed(2)}px, ${pY.toFixed(2)}px, 18px)`;
      });
    }
  }

  /**
   * Triggers the visual volumetric fog overlay surge in sync with WebGL fog density
   */
  function playFogOverlaySurge(mode = 'dive') {
    if (!fogOverlayEl) return;
    gsap.killTweensOf(fogOverlayEl);
    fogOverlayEl.className = `fog-transition-overlay active-${mode}`;

    const tl = gsap.timeline();
    if (mode === 'curtain') {
      // Requirement 3: Slide 7 -> 8 Fog Curtain Immersion (rises at 0.32s to 100% opacity, then parts)
      tl.fromTo(
        fogOverlayEl,
        { opacity: 0, scale: 1.15 },
        {
          opacity: 1.0,
          scale: 1.0,
          duration: 0.52,
          delay: 0.28,
          ease: 'power2.inOut'
        }
      ).to(fogOverlayEl, {
        opacity: 0,
        scale: 1.35,
        duration: 0.9,
        ease: 'power3.out'
      });
    } else {
      tl.fromTo(
        fogOverlayEl,
        { opacity: 0, scale: 0.85 },
        {
          opacity: 0.94,
          scale: 1.05,
          duration: 0.5,
          ease: 'power2.in'
        }
      ).to(fogOverlayEl, {
        opacity: 0,
        scale: 1.45,
        duration: 0.95,
        ease: 'power3.out'
      });
    }
  }

  /**
   * Animates the 3D Image Showcases inside the active slide
   */
  function animateSlideImages(slideDomElement, tl, startTime = 0.35, staggerTime = 0.14) {
    // 1. Hanging Pendulum Units & 2X Diagonal Hanging Cards (Slides 2, 4, 6, 7, 8, 9)
    const pendulumUnits = slideDomElement.querySelectorAll(
      '.pendulum-drop-unit, .diagonal-chain-item'
    );
    if (pendulumUnits.length > 0) {
      gsap.set(pendulumUnits, {
        opacity: 0,
        y: -350
      });
      tl.to(
        pendulumUnits,
        {
          opacity: 1,
          y: 0,
          duration: 1.25,
          stagger: staggerTime,
          ease: 'elastic.out(1, 0.5)'
        },
        startTime
      );
    }

    // 2. Hologram Glass Pop-up (Slide 1 & Slide 3)
    const hologramCards = slideDomElement.querySelectorAll('.hologram-popup-card');
    if (hologramCards.length > 0) {
      gsap.set(hologramCards, {
        opacity: 0,
        rotationX: -85,
        y: 70,
        z: -80,
        scale: 0.88,
        transformOrigin: '50% 100%'
      });

      tl.to(
        hologramCards,
        {
          opacity: 1,
          rotationX: 0,
          y: 0,
          z: 0,
          scale: 1,
          duration: 1.15,
          stagger: 0.16,
          ease: 'back.out(1.4)'
        },
        startTime + 0.08
      );

      const scanBeams = slideDomElement.querySelectorAll('.hologram-scan-beam');
      if (scanBeams.length > 0) {
        gsap.set(scanBeams, { top: '105%', opacity: 1 });
        tl.to(
          scanBeams,
          {
            top: '-18%',
            opacity: 0.12,
            duration: 1.1,
            stagger: 0.16,
            ease: 'power2.inOut'
          },
          startTime + 0.2
        );
      }

      const cornerSparks = slideDomElement.querySelectorAll('.corner-spark');
      if (cornerSparks.length > 0) {
        gsap.set(cornerSparks, { scale: 0, opacity: 1 });
        tl.to(
          cornerSparks,
          {
            scale: 1.8,
            opacity: 0,
            x: (i, el) => parseFloat(el.dataset.dx || '24'),
            y: (i, el) => parseFloat(el.dataset.dy || '-24'),
            duration: 0.8,
            stagger: 0.03,
            ease: 'expo.out'
          },
          startTime + 0.32
        );
      }
    }

    // 3. 3D Tilted Showcase (Slide 5 & Slide 6)
    const tiltedShowcases = slideDomElement.querySelectorAll('.tilted-3d-showcase');
    if (tiltedShowcases.length > 0) {
      tiltedShowcases.forEach((showcase) => {
        const isSlide5 = showcase.classList.contains('tilt-slide5');
        const targetRX = 8;
        const targetRY = isSlide5 ? -8 : 6;
        const targetRZ = isSlide5 ? 2 : -1;

        gsap.set(showcase, {
          opacity: 0,
          scale: 0.84,
          y: 55,
          z: -110,
          rotationX: targetRX + 18,
          rotationY: targetRY * 1.6,
          rotationZ: targetRZ
        });

        tl.to(
          showcase,
          {
            opacity: 1,
            scale: 1,
            y: 0,
            z: 0,
            rotationX: targetRX,
            rotationY: targetRY,
            rotationZ: targetRZ,
            duration: 1.15,
            ease: 'expo.out'
          },
          startTime + 0.12
        );
      });
    }

    // 4. Frameless Floating Cutout Icons (Slides 2 -> 9)
    const floatingIconUnits = slideDomElement.querySelectorAll('.frameless-floating-icon-unit');
    if (floatingIconUnits.length > 0) {
      gsap.set(floatingIconUnits, {
        opacity: 0,
        scale: 0.35
      });
      tl.to(
        floatingIconUnits,
        {
          opacity: 1,
          scale: 1,
          duration: 0.95,
          stagger: 0.055,
          ease: 'back.out(1.6)'
        },
        startTime + 0.1
      );
    }
  }

  /**
   * Helper: Smoothly animates an outgoing slide out in 3D space (never abruptly deleting at t = 0)
   */
  function animateDefaultOutgoingSlide(outgoingEl, tl) {
    if (!outgoingEl) return;
    tl.to(
      outgoingEl,
      {
        z: 420,
        scale: 1.28,
        opacity: 0,
        filter: 'blur(8px)',
        duration: 0.48,
        ease: 'power2.in',
        onComplete: () => {
          outgoingEl.remove();
        }
      },
      0
    );
  }

  /**
   * Requirement 2: Reversed Camera Script for Slides 4, 5, 6, and 7 (Image-First Camera Tracking)
   * Step 1: Zoom/Pan to the Right/Canopy Image showcase first (while text stays hidden)
   * Step 2: Glide/track along the emerging images as they drop/tilt into place
   * Step 3: Pan left to the Text block while dollying out as the words burst with Canva Elastic Pop
   */
  function playImageFirstCameraTracking(
    slideData,
    slideDomElement,
    targetWorldPos,
    allWords,
    tl,
    startOffset = 0
  ) {
    const isSlide7 = slideData.id === 7;
    const isSlide6 = slideData.id === 6;
    const isSlide5 = slideData.id === 5;

    // Pre-hide images until Step 1 reaches the image zone
    const pendulumUnits = slideDomElement.querySelectorAll(
      '.pendulum-drop-unit, .diagonal-chain-item'
    );
    const tiltedShowcases = slideDomElement.querySelectorAll('.tilted-3d-showcase');
    const floatingIconUnits = slideDomElement.querySelectorAll('.frameless-floating-icon-unit');
    if (pendulumUnits.length > 0) {
      gsap.set(pendulumUnits, { opacity: 0, y: -350 });
    }
    if (tiltedShowcases.length > 0) {
      gsap.set(tiltedShowcases, { opacity: 0, scale: 0.84, y: 55, z: -110 });
    }
    if (floatingIconUnits.length > 0) {
      gsap.set(floatingIconUnits, { opacity: 0, scale: 0.35 });
    }

    // STEP 1: Camera rushes directly to the Image Showcase zone first
    if (isSlide7) {
      // Slide 7: Focus on the left side of the 7-photo hanging canopy first
      tl.to(
        rigState,
        {
          worldX: targetWorldPos.x,
          worldY: targetWorldPos.y,
          worldZ: targetWorldPos.z,
          rotX: slideData.nodeRotation.x,
          rotY: slideData.nodeRotation.y,
          rotZ: slideData.nodeRotation.z,
          trackX: -3.6,
          trackY: 1.8,
          trackZ: 5.4,
          tiltX: 2.2,
          tiltY: -5.5,
          tiltZ: 0.8,
          duration: 0.88,
          ease: 'power3.inOut'
        },
        startOffset
      );
    } else {
      // Slides 4, 5, 6: Focus on the top-right Image Showcase region first
      tl.to(
        rigState,
        {
          worldX: targetWorldPos.x,
          worldY: targetWorldPos.y,
          worldZ: targetWorldPos.z,
          rotX: slideData.nodeRotation.x,
          rotY: slideData.nodeRotation.y,
          rotZ: slideData.nodeRotation.z,
          trackX: 5.6,
          trackY: 2.6,
          trackZ: 5.5,
          tiltX: 3.0,
          tiltY: 6.8,
          tiltZ: -1.0,
          duration: 0.88,
          ease: 'power3.inOut'
        },
        startOffset
      );
    }

    // STEP 2: Trigger image entrance animations & glide Camera along the emerging images
    const imgStart = startOffset + 0.52;
    animateSlideImages(slideDomElement, tl, imgStart, isSlide7 ? 0.11 : 0.22);

    if (isSlide7) {
      // Slide 7: Camera pans across the 7 hanging photos from left (-3.6) to right (+3.6) as they drop
      tl.to(
        rigState,
        {
          trackX: 3.6,
          trackY: 1.4,
          trackZ: 5.2,
          tiltX: 1.5,
          tiltY: 5.5,
          tiltZ: -0.8,
          duration: 0.95,
          ease: 'sine.inOut'
        },
        imgStart + 0.1
      );
    } else if (isSlide6) {
      // Slide 6: Camera starts on the top 4 hanging photos, then glides down to the 3D Tilted Showcase
      tl.to(
        rigState,
        {
          trackX: 5.8,
          trackY: -1.8,
          trackZ: 5.2,
          tiltX: -2.0,
          tiltY: 6.2,
          tiltZ: 0.6,
          duration: 0.88,
          ease: 'sine.inOut'
        },
        imgStart + 0.28
      );
    } else if (isSlide5) {
      // Slide 5: Camera tracks down across the 2 split panes of the 3D Tilted Showcase
      tl.to(
        rigState,
        {
          trackX: 5.2,
          trackY: -1.6,
          trackZ: 5.0,
          tiltX: -1.8,
          tiltY: 5.5,
          tiltZ: 0.5,
          duration: 0.85,
          ease: 'sine.inOut'
        },
        imgStart + 0.2
      );
    } else {
      // Slide 4: Camera glides downward following Card 1 -> Card 2 -> Card 3 of the Vertical Hanging Chain
      tl.to(
        rigState,
        {
          trackX: 6.0,
          trackY: 0.2,
          trackZ: 5.4,
          tiltX: 0.5,
          tiltY: 6.5,
          tiltZ: 0.6,
          duration: 0.42,
          ease: 'sine.out'
        },
        imgStart + 0.2
      );
      tl.to(
        rigState,
        {
          trackX: 5.2,
          trackY: -2.2,
          trackZ: 5.1,
          tiltX: -2.2,
          tiltY: 5.8,
          tiltZ: -0.6,
          duration: 0.46,
          ease: 'sine.out'
        },
        imgStart + 0.62
      );
    }

    // STEP 3: Pan Left to the Text Block & Dolly Out to Balanced Wide Framing while Text Bursts Out!
    const panToTextTime = imgStart + 1.05;

    tl.to(
      rigState,
      {
        trackX: -2.4,
        trackY: 0.8,
        trackZ: 2.2,
        tiltX: 1.0,
        tiltY: -3.2,
        tiltZ: 0.4,
        duration: 0.62,
        ease: 'power2.inOut'
      },
      panToTextTime
    );

    // Trigger Canva Elastic Burst on all text words as Camera pans left toward them
    tl.to(
      allWords,
      {
        opacity: 1,
        scale: 1,
        y: 0,
        z: 0,
        duration: 0.82,
        stagger: 0.032,
        ease: 'elastic.out(1.1, 0.55)'
      },
      panToTextTime + 0.15
    );

    // Smoothly settle into the balanced full-slide overview (trackX/Y/Z = 0)
    tl.to(
      rigState,
      {
        trackX: 0,
        trackY: 0,
        trackZ: 0,
        tiltX: 0,
        tiltY: 0,
        tiltZ: 0,
        duration: 1.25,
        ease: 'expo.out'
      },
      panToTextTime + 0.62
    );
  }

  function playSlideTransition(
    slideData,
    slideDomElement,
    isInitial = false,
    prevSlideId = null,
    outgoingSlideDomElement = null
  ) {
    if (activeTimeline) {
      activeTimeline.kill();
    }

    const tl = gsap.timeline();
    activeTimeline = tl;

    const targetWorldPos = new THREE.Vector3(
      slideData.nodePosition.x + STANDARD_OFFSET.x,
      slideData.nodePosition.y + STANDARD_OFFSET.y,
      slideData.nodePosition.z + STANDARD_OFFSET.z
    );

    const headerWords = slideDomElement.querySelectorAll('.anim-header .word-pop');
    const subLabelWords = slideDomElement.querySelectorAll('.anim-sublabel .word-pop');
    const title1Words = slideDomElement.querySelectorAll('.anim-title1 .word-pop');
    const title2Words = slideDomElement.querySelectorAll('.anim-title2 .word-pop');
    const bodyLines = slideDomElement.querySelectorAll('.anim-body-line');
    const allWords = slideDomElement.querySelectorAll('.word-pop');

    gsap.set(allWords, {
      opacity: 0,
      scale: 0.15,
      y: 24,
      z: -50,
      transformOrigin: '50% 50%'
    });

    // ==========================================================================
    // REQUIREMENT 4: SLIDE 8 -> 9 AND SLIDE 9 -> 10 — TRUE FLY-THROUGH CENTER OF OLD SLIDE
    // 1. Keep 100% of outgoing slide's text & images visible at t = 0 (NEVER delete at t = 0!)
    // 2. Outgoing slide hurtles toward viewer / Camera punches through center of old slide:
    //    `scale: 1 -> 4.5`, `z: 0 -> 900px`, text & images split past left/right ears of Camera,
    //    blurring (`blur(12px)`) and fading out in the second half of flight.
    // 3. Simultaneously, the new slide (Slide 9, or Slide 10 + 3D Leaf) emerges from far behind
    //    the center of the old slide (`scale: 0.2 -> 1.0`, `z: -600px -> 0`).
    // ==========================================================================
    if (
      !isInitial &&
      ((prevSlideId === 8 && slideData.id === 9) ||
        (prevSlideId === 9 && slideData.id === 10) ||
        slideData.type === 'outro-leaf')
    ) {
      if (outgoingSlideDomElement) {
        const outLeft = outgoingSlideDomElement.querySelector('.slide-text-region');
        const outRight = outgoingSlideDomElement.querySelectorAll(
          '.slide-visual-region, .floating-frameless-icons-layer'
        );

        // Keep outgoing slide 100% visible initially, then punch straight through its center!
        gsap.set(outgoingSlideDomElement, {
          transformOrigin: '50% 50%',
          opacity: 1,
          scale: 1,
          z: 0,
          filter: 'blur(0px)'
        });

        // Outgoing slide expands massively (`scale: 1 -> 4.5`, `z: 0 -> 900`) as camera flies through
        tl.to(
          outgoingSlideDomElement,
          {
            scale: 4.5,
            z: 900,
            duration: 0.96,
            ease: 'power3.in'
          },
          0
        );

        // Split left text and right images outward so they rush past the left and right ears of the lens
        if (outLeft) {
          tl.to(
            outLeft,
            {
              x: -210,
              duration: 0.96,
              ease: 'power2.in'
            },
            0
          );
        }
        if (outRight.length > 0) {
          tl.to(
            outRight,
            {
              x: 210,
              duration: 0.96,
              ease: 'power2.in'
            },
            0
          );
        }

        // Only blur and fade in the SECOND half of the fly-through (`0.42s -> 0.94s`)
        tl.to(
          outgoingSlideDomElement,
          {
            opacity: 0,
            filter: 'blur(12px)',
            duration: 0.52,
            ease: 'power2.in',
            onComplete: () => {
              outgoingSlideDomElement.remove();
            }
          },
          0.44
        );
      }

      // Advance WebGL camera through space to the new node
      tl.to(
        rigState,
        {
          worldX: targetWorldPos.x,
          worldY: targetWorldPos.y,
          worldZ: targetWorldPos.z,
          rotX: slideData.nodeRotation.x,
          rotY: slideData.nodeRotation.y,
          rotZ: slideData.nodeRotation.z,
          trackX: 0,
          trackY: 0,
          trackZ: 0,
          tiltX: 0,
          tiltY: 0,
          tiltZ: 0,
          duration: 1.35,
          ease: 'power3.inOut'
        },
        0
      );

      // New slide starts far behind the center of the old slide (`scale: 0.2`, `z: -600px`)
      // and advances forward into place as the old slide parts around the camera!
      gsap.set(slideDomElement, {
        transformOrigin: '50% 50%',
        opacity: 0,
        scale: 0.2,
        z: -600
      });

      tl.to(
        slideDomElement,
        {
          opacity: 1,
          scale: 1.0,
          z: 0,
          duration: 1.15,
          ease: 'expo.out'
        },
        0.24
      );

      if (slideData.type !== 'outro-leaf') {
        // Slide 9: Burst text words and drop the 3 wide vertical hanging cards as Slide 9 arrives
        tl.to(
          allWords,
          {
            opacity: 1,
            scale: 1,
            y: 0,
            z: 0,
            duration: 0.85,
            stagger: 0.036,
            ease: 'elastic.out(1.1, 0.55)'
          },
          0.52
        );
        animateSlideImages(slideDomElement, tl, 0.56, 0.16);
      }

      return tl;
    }

    // ==========================================================================
    // REQUIREMENT 3: SLIDE 7 -> SLIDE 8 — FOG CURTAIN IMMERSION
    // 1. Camera pulls back slightly so Slide 7 scales down ONLY to `scale: 0.75`
    // 2. Right at `scale: 0.75`, thick emerald fog curtain surges to 100% opacity,
    //    blurring (`blur(20px)`) and veiling Slide 7 (`opacity: 1 -> 0`)
    // 3. On the other side of the fog curtain, fog parts while Slide 8 emerges
    //    smoothly (`opacity: 0 -> 1`, `scale: 0.85 -> 1.0`)
    // ==========================================================================
    if (!isInitial && prevSlideId === 7 && slideData.id === 8) {
      if (typeof pulseVolumetricFog === 'function') {
        pulseVolumetricFog(0.11, 0.65, 1.05);
      }
      playFogOverlaySurge('curtain');

      if (outgoingSlideDomElement) {
        gsap.set(outgoingSlideDomElement, {
          transformOrigin: '50% 50%',
          opacity: 1,
          scale: 1,
          z: 0,
          filter: 'blur(0px)'
        });

        // Step 1: Scale Slide 7 down ONLY to 0.75 (75% of original size)
        tl.to(
          outgoingSlideDomElement,
          {
            scale: 0.75,
            z: -180,
            duration: 0.55,
            ease: 'power2.out'
          },
          0
        );

        // Step 2: At scale 0.75, sink behind the thick emerald fog curtain (`blur(20px)`, `opacity -> 0`)
        tl.to(
          outgoingSlideDomElement,
          {
            opacity: 0,
            filter: 'blur(20px)',
            duration: 0.5,
            ease: 'power2.inOut',
            onComplete: () => {
              outgoingSlideDomElement.remove();
            }
          },
          0.36
        );
      }

      // Prepare Slide 8 behind the fog curtain at `scale: 0.85`, `opacity: 0`
      gsap.set(slideDomElement, {
        transformOrigin: '50% 50%',
        opacity: 0,
        scale: 0.85,
        z: -90,
        filter: 'blur(14px)'
      });

      // Move WebGL camera backward through the nebula
      tl.to(
        rigState,
        {
          worldX: targetWorldPos.x,
          worldY: targetWorldPos.y,
          worldZ: targetWorldPos.z,
          rotX: slideData.nodeRotation.x,
          rotY: slideData.nodeRotation.y,
          rotZ: slideData.nodeRotation.z,
          trackX: 0,
          trackY: 0,
          trackZ: 0,
          tiltX: 0,
          tiltY: 0,
          tiltZ: 0,
          duration: 1.45,
          ease: 'power3.inOut'
        },
        0
      );

      // Step 3: As the fog curtain parts, Slide 8 materializes (`opacity: 0 -> 1`, `scale: 0.85 -> 1.0`)
      tl.to(
        slideDomElement,
        {
          opacity: 1,
          scale: 1.0,
          z: 0,
          filter: 'blur(0px)',
          duration: 0.95,
          ease: 'power3.out'
        },
        0.72
      );

      tl.to(
        allWords,
        {
          opacity: 1,
          scale: 1,
          y: 0,
          z: 0,
          duration: 0.85,
          stagger: 0.035,
          ease: 'elastic.out(1.1, 0.55)'
        },
        0.82
      );

      animateSlideImages(slideDomElement, tl, 0.85, 0.15);
      return tl;
    }

    // ==========================================================================
    // SLIDE 3 -> SLIDE 4 FORWARD FOG DIVE + IMAGE-FIRST CAMERA TRACKING ON SLIDE 4
    // ==========================================================================
    if (!isInitial && prevSlideId === 3 && slideData.id === 4) {
      if (typeof pulseVolumetricFog === 'function') {
        pulseVolumetricFog(0.095, 0.5, 0.95);
      }
      playFogOverlaySurge('dive');

      if (outgoingSlideDomElement) {
        const outLeft = outgoingSlideDomElement.querySelector('.slide-text-region');
        const outRight = outgoingSlideDomElement.querySelectorAll(
          '.slide-visual-region, .floating-frameless-icons-layer'
        );

        if (outLeft) {
          tl.to(
            outLeft,
            {
              x: -260,
              z: 880,
              scale: 1.45,
              opacity: 0,
              duration: 0.58,
              ease: 'power3.in'
            },
            0
          );
        }
        if (outRight.length > 0) {
          tl.to(
            outRight,
            {
              x: 260,
              z: 880,
              scale: 1.45,
              opacity: 0,
              duration: 0.58,
              ease: 'power3.in'
            },
            0
          );
        }
        tl.call(
          () => {
            outgoingSlideDomElement.remove();
          },
          null,
          0.6
        );
      }

      gsap.set(slideDomElement, {
        opacity: 0,
        z: -520,
        scale: 0.65
      });

      tl.to(
        slideDomElement,
        {
          opacity: 1,
          z: 0,
          scale: 1,
          duration: 0.85,
          ease: 'expo.out'
        },
        0.35
      );

      // Run Image-First Camera Tracking on Slide 4 (focus on the 3 hanging images first, then pan left to text!)
      playImageFirstCameraTracking(
        slideData,
        slideDomElement,
        targetWorldPos,
        allWords,
        tl,
        0.2
      );
      return tl;
    }

    // Smoothly transition out the previous slide for all other slide changes
    if (outgoingSlideDomElement) {
      animateDefaultOutgoingSlide(outgoingSlideDomElement, tl);
    }

    if (isInitial) {
      rigState.worldX = targetWorldPos.x;
      rigState.worldY = targetWorldPos.y;
      rigState.worldZ = targetWorldPos.z;
      rigState.rotX = slideData.nodeRotation.x;
      rigState.rotY = slideData.nodeRotation.y;
      rigState.rotZ = slideData.nodeRotation.z;

      tl.to(
        allWords,
        {
          opacity: 1,
          scale: 1,
          y: 0,
          z: 0,
          duration: 0.85,
          stagger: 0.045,
          ease: 'elastic.out(1.1, 0.55)'
        },
        0.15
      );

      animateSlideImages(slideDomElement, tl, 0.25);
      return tl;
    }

    // ==========================================================================
    // REQUIREMENT 2: SLIDES 4, 5, 6, 7 — REVERSED CAMERA SCRIPT (IMAGE-FIRST TRACKING)
    // ==========================================================================
    if (slideData.id >= 4 && slideData.id <= 7) {
      playImageFirstCameraTracking(
        slideData,
        slideDomElement,
        targetWorldPos,
        allWords,
        tl,
        0
      );
      return tl;
    }

    // ==========================================================================
    // SLIDES 2 & 3 — TEXT-FIRST CINEMATIC CLOSE-UP TRACKING
    // ==========================================================================
    if (slideData.trackingMode) {
      tl.to(
        rigState,
        {
          worldX: targetWorldPos.x,
          worldY: targetWorldPos.y,
          worldZ: targetWorldPos.z,
          rotX: slideData.nodeRotation.x,
          rotY: slideData.nodeRotation.y,
          rotZ: slideData.nodeRotation.z,
          trackX: -7.0,
          trackY: 4.8,
          trackZ: 5.8,
          tiltX: 4.0,
          tiltY: -7.5,
          tiltZ: 1.2,
          duration: 1.0,
          ease: 'power3.inOut'
        },
        0
      );

      tl.to(
        [...headerWords, ...subLabelWords],
        {
          opacity: 1,
          scale: 1,
          y: 0,
          z: 0,
          duration: 0.8,
          stagger: 0.04,
          ease: 'elastic.out(1.1, 0.55)'
        },
        0.45
      );

      tl.to(
        rigState,
        {
          trackX: -5.4,
          trackY: 2.5,
          trackZ: 6.0,
          tiltX: 2.4,
          tiltY: -6.0,
          tiltZ: -0.8,
          duration: 0.65,
          ease: 'power2.out'
        },
        0.68
      );

      tl.to(
        [...title1Words, ...title2Words],
        {
          opacity: 1,
          scale: 1,
          y: 0,
          z: 0,
          duration: 0.8,
          stagger: 0.045,
          ease: 'elastic.out(1.1, 0.55)'
        },
        0.7
      );

      const lineStartTime = 1.12;
      const lineInterval = 0.22;

      bodyLines.forEach((lineEl, idx) => {
        const wordsInLine = lineEl.querySelectorAll('.word-pop');
        const atTime = lineStartTime + idx * lineInterval;
        const progressRatio = (idx + 1) / Math.max(bodyLines.length, 1);

        tl.to(
          rigState,
          {
            trackX: -4.8 + (idx % 2 === 0 ? 1.0 : -0.5),
            trackY: 1.6 - progressRatio * 4.2,
            trackZ: 5.6 - progressRatio * 0.7,
            tiltX: 1.6 - progressRatio * 3.0,
            tiltY: -5.0 + progressRatio * 2.0,
            tiltZ: idx % 2 === 0 ? 0.5 : -0.5,
            duration: 0.36,
            ease: 'sine.out'
          },
          atTime
        );

        tl.to(
          wordsInLine,
          {
            opacity: 1,
            scale: 1,
            y: 0,
            z: 0,
            duration: 0.8,
            stagger: 0.04,
            ease: 'elastic.out(1.1, 0.55)'
          },
          atTime
        );
      });

      const dollyOutTime = lineStartTime + bodyLines.length * lineInterval + 0.3;
      tl.to(
        rigState,
        {
          trackX: 0,
          trackY: 0,
          trackZ: 0,
          tiltX: 0,
          tiltY: 0,
          tiltZ: 0,
          duration: 1.35,
          ease: 'expo.out'
        },
        dollyOutTime
      );

      animateSlideImages(slideDomElement, tl, dollyOutTime - 0.25);
    } else {
      tl.to(
        rigState,
        {
          worldX: targetWorldPos.x,
          worldY: targetWorldPos.y,
          worldZ: targetWorldPos.z,
          rotX: slideData.nodeRotation.x,
          rotY: slideData.nodeRotation.y,
          rotZ: slideData.nodeRotation.z,
          trackX: 0,
          trackY: 0,
          trackZ: 0,
          tiltX: 0,
          tiltY: 0,
          tiltZ: 0,
          duration: 1.45,
          ease: 'power3.inOut'
        },
        0
      );

      tl.to(
        allWords,
        {
          opacity: 1,
          scale: 1,
          y: 0,
          z: 0,
          duration: 0.85,
          stagger: 0.038,
          ease: 'elastic.out(1.1, 0.55)'
        },
        0.38
      );

      animateSlideImages(slideDomElement, tl, 0.42);
    }

    return tl;
  }

  function triggerSlide10OutroTextBurst(slideDomElement) {
    if (!slideDomElement) return;
    const allWords = slideDomElement.querySelectorAll('.word-pop');
    const auraRings = slideDomElement.querySelectorAll('.outro-emerald-aura');

    gsap.fromTo(
      auraRings,
      { opacity: 0, scale: 0.35 },
      {
        opacity: 1,
        scale: 1,
        duration: 1.25,
        ease: 'expo.out'
      }
    );

    gsap.to(allWords, {
      opacity: 1,
      scale: 1,
      y: 0,
      z: 0,
      duration: 0.95,
      stagger: 0.055,
      ease: 'elastic.out(1.15, 0.5)'
    });
  }

  return {
    applyRigToScene,
    playSlideTransition,
    triggerSlide10OutroTextBurst
  };
}
