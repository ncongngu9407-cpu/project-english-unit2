/**
 * Content extracted from `Green_Living_at_School_Unit_2_English_10 (1).docx`
 * Hotfix V5 applied:
 * - Slide 9: Removed redundant "THANK YOU FOR LISTENING!" line
 * - Slides 2, 4, 8, 9: 3 Diagonal Large Hanging Cards (`top: 6vh, right: 24vw, rotateZ(-4deg)`,
 *   `top: 34vh, right: 14vw, rotateZ(2deg)`, `top: 62vh, right: 4vw, rotateZ(-3deg)`)
 * - Slide 10: Direct Blender Speed-Ramp Photorealistic Leaf & "Thanks for Watching!"
 */

export const ALL_PROJECT_IMAGES = {
  slide1: {
    greenSproutMacro: '/green-living.jpg',
    studentsPottedPlants:
      '/aplsrlucjvruighpkelk3ch7ktll5zeejaayewzvwfqtfakhj5v02kv5eisgl57vtqpsqbuj5kl-33cdhewuaxnwuonntbbzy0_bkuba3zlmi5dxsup-2fn4dpgba3fc4dhum9hdv_o-vprwx8yhote-1.jpg'
  },
  assistantModelUrl: '/genshin_impact_-_nahida.glb'
};

export const INTERSTITIAL_QA_BY_SLIDE_ID = {
  // Opening Interstitial Curtain (Between Slide 01 -> Slide 02, 1 Question, Voiceover: /1.mp3)
  2: {
    steps: [
      {
        tag: 'INTERACTIVE Q&A // BEFORE SLIDE 02: WHY MAKE OUR SCHOOL GREENER?',
        comment: 'Comment: School is our second home!',
        question:
          'Question for Class 10A3: How many hours do you spend at school every day, and is our campus green enough?',
        hint: '• Click right side to reveal Slide 02 →',
        audio: '/1.mp3'
      }
    ]
  },
  // Final Dual-Question Interstitial Curtain (Between Slide 09 -> Slide 10, 2 Questions, Voiceovers: /2.mp3 & /3.mp3)
  10: {
    steps: [
      {
        tag: 'FINAL INTERACTIVE Q&A (PART 1/2) // BEFORE SLIDE 10: CREATIVE GREEN ACTION',
        comment: 'Comment: Teamwork makes the green dream work!',
        question:
          'Question 1 for Class 10A3: If Class 10A3 could build a "Green Corner" or join a recycling contest at school, what creative idea would we bring to win 1st prize?',
        hint: '• Click right side for Final Question 02 →',
        audio: '/2.mp3'
      },
      {
        tag: 'FINAL INTERACTIVE Q&A (PART 2/2) // BEFORE SLIDE 10: OUR GREEN PROMISE',
        comment: 'Comment: Change starts with us, right here, right now!',
        question:
          'Question 2 for Class 10A3: Before we reach our final conclusion, what is ONE green habit you promise to start doing at school from today?',
        hint: '• Click right side to reveal Slide 10 →',
        audio: '/3.mp3'
      }
    ]
  }
};

export const SLIDES_DATA = [
  // ==========================================================================
  // PAIR 1: SLIDE 1 & SLIDE 2
  // ==========================================================================
  {
    id: 1,
    numberString: '1',
    header: '>_ Unit 2: Humans & Environment',
    subLabel: 'SLIDE 01 // TITLE & PROJECT OVERVIEW',
    titleLine1: 'GREEN LIVING',
    titleLine2: 'At School.',
    trackingMode: false,
    layoutPair: 'pair1-classic',
    bulletStyle: 'classic-hero',
    particleMode: 'interactive-nebula',
    imageEntrance: 'hologram-popup',
    type: 'bullets',
    items: [
      'Small Actions, Big Changes',
      'Project: Making Our School Greener',
      'English 10 – Global Success | Group: Group 1 | Class: 10A3'
    ],
    images: [
      {
        src: ALL_PROJECT_IMAGES.slide1.greenSproutMacro,
        caption: 'Small Actions • Big Changes',
        tag: 'UNIT 02 // ECO VISION'
      },
      {
        src: ALL_PROJECT_IMAGES.slide1.studentsPottedPlants,
        caption: 'Our Green School Community',
        tag: 'GROUP 1 // CLASS 10A3'
      }
    ],
    nodePosition: { x: 0, y: 0, z: 0 },
    nodeRotation: { x: 0, y: 0, z: 0 }
  },
  {
    id: 2,
    numberString: '2',
    header: '>_ Unit 2: Humans & Environment',
    subLabel: 'SLIDE 02 // INTRODUCTION',
    titleLine1: 'Why Make Our',
    titleLine2: 'School Greener?',
    trackingMode: true,
    layoutPair: 'pair1-classic',
    bulletStyle: 'horizontal-glass-strip',
    particleMode: 'interactive-nebula',
    imageEntrance: 'diagonal-hanging-chain',
    type: 'bullets',
    items: [
      'School is where we study and spend a lot of time.',
      'A clean and green school helps students stay healthy.',
      'However, littering, plastic waste and wasting electricity are still common problems.',
      'We should work together to protect our school environment.'
    ],
    images: [
      {
        src: '/slide2-1.jpg',
        caption: 'Students & Teachers Gardening on Campus',
        tag: '01 // GREEN CAMPUS',
        rotZ: -4,
        rotY: 4
      },
      {
        src: '/slide2-2.jpg',
        caption: 'Studying Happily on Fresh Green Grass',
        tag: '02 // HEALTHY STUDY',
        rotZ: 2,
        rotY: -4
      },
      {
        src: '/slide2-3.webp',
        caption: 'Harvesting Vegetables in the School Garden',
        tag: '03 // TEAMWORK',
        rotZ: -3,
        rotY: 4
      }
    ],
    nodePosition: { x: 18, y: 6, z: -18 },
    nodeRotation: { x: 0.03, y: -0.14, z: 0.01 }
  },

  // ==========================================================================
  // PAIR 2: SLIDE 3 & SLIDE 4
  // ==========================================================================
  {
    id: 3,
    numberString: '3',
    header: '>_ Unit 2: Humans & Environment',
    subLabel: 'SLIDE 03 // CURRENT SITUATION',
    titleLine1: 'Environmental',
    titleLine2: 'Problems.',
    trackingMode: true,
    layoutPair: 'pair2-center-right',
    bulletStyle: 'numbered-pills',
    particleMode: 'rising-spores',
    imageEntrance: 'hologram-full-aspect',
    hasFloorReflection: true,
    type: 'bullets',
    items: [
      'Students sometimes throw rubbish on the ground.',
      'Many plastic bottles and bags are used every day.',
      'Lights and fans are sometimes left on in empty classrooms.',
      'Some students waste water.',
      'There are not enough green spaces in some school areas.'
    ],
    images: [
      {
        src: '/slide3-1.jpg',
        caption: 'Overflowing Bins & Plastic Litter on Campus',
        tag: 'PROBLEM // 01'
      },
      {
        src: '/slide3-2.jpg',
        caption: 'Single-Use Plastic Bottles & Wasting Clean Water',
        tag: 'PROBLEM // 02'
      }
    ],
    nodePosition: { x: -20, y: -8, z: -36 },
    nodeRotation: { x: -0.04, y: 0.16, z: -0.01 }
  },
  {
    id: 4,
    numberString: '4',
    header: '>_ Unit 2: Humans & Environment',
    subLabel: 'SLIDE 04 // SOLUTION 01',
    titleLine1: 'Reduce',
    titleLine2: 'Plastic Waste.',
    trackingMode: false,
    layoutPair: 'pair2-center-right',
    bulletStyle: 'numbered-pills',
    particleMode: 'rising-spores',
    imageEntrance: 'diagonal-hanging-chain',
    hasFloorReflection: false,
    type: 'bullets',
    items: [
      'Bring reusable water bottles to school.',
      'Avoid plastic bags and plastic straws.',
      'Use lunch boxes instead of disposable containers.',
      'Put plastic waste in recycling bins.',
      'Our message: Less plastic, more green!'
    ],
    images: [
      {
        src: '/slide4-1.jpg',
        caption: 'Putting Plastic Bottles into Recycling Boxes',
        tag: '01 // RECYCLE',
        rotZ: -4,
        rotY: 4
      },
      {
        src: '/slide4-2.jpg',
        caption: 'Collecting Plastic Waste in Clean-Up Drives',
        tag: '02 // CLEAN UP',
        rotZ: 2,
        rotY: -4
      },
      {
        src: '/slide4-3.webp',
        caption: 'Using Eco Bags, Tumblers & Glass Bottles',
        tag: '03 // REUSABLE',
        rotZ: -3,
        rotY: 4
      }
    ],
    nodePosition: { x: -20, y: -8, z: -60 },
    nodeRotation: { x: 0.04, y: -0.14, z: 0.01 }
  },

  // ==========================================================================
  // PAIR 3: SLIDE 5 & SLIDE 6
  // ==========================================================================
  {
    id: 5,
    numberString: '5',
    header: '>_ Unit 2: Humans & Environment',
    subLabel: 'SLIDE 05 // SOLUTION 02',
    titleLine1: 'Save Energy',
    titleLine2: 'And Water.',
    trackingMode: false,
    layoutPair: 'pair3-tilted-showcase',
    bulletStyle: 'bento-2col',
    particleMode: 'interactive-nebula',
    imageEntrance: 'diagonal-focus-sweep',
    tiltVariant: 'slide5',
    type: 'bullets',
    items: [
      'Turn off lights and fans when leaving classrooms.',
      'Use natural light whenever possible.',
      'Turn off taps after using them.',
      'Report leaking taps to teachers.',
      'Encourage classmates to save electricity and water.'
    ],
    images: [
      {
        src: '/slide5-1.webp',
        caption: 'Saving Electricity & Using Clean Green Energy',
        tag: '01 // SAVE ENERGY'
      },
      {
        src: '/slide5-2.jpg',
        caption: 'Conserving Every Precious Drop of Clean Water',
        tag: '02 // SAVE WATER'
      }
    ],
    nodePosition: { x: -16, y: 12, z: -80 },
    nodeRotation: { x: -0.03, y: 0.14, z: -0.01 }
  },
  {
    id: 6,
    numberString: '6',
    header: '>_ Unit 2: Humans & Environment',
    subLabel: 'SLIDE 06 // SOLUTION 03',
    titleLine1: 'Keep Our School',
    titleLine2: 'Clean & Green.',
    trackingMode: false,
    layoutPair: 'pair3-tilted-showcase',
    bulletStyle: 'bento-2col',
    particleMode: 'interactive-nebula',
    imageEntrance: 'diagonal-and-pendulum',
    tiltVariant: 'slide6',
    type: 'bullets',
    items: [
      'Put rubbish in the correct bins.',
      'Clean classrooms and schoolyards regularly.',
      'Plant more trees and flowers.',
      'Take care of plants in the school garden.',
      'Organize school clean-up activities.'
    ],
    images: [
      {
        src: '/slide6-4.jpg',
        fallbackSrc: '/slide6-3.jpg',
        caption: 'Watering & Caring for Young Green Saplings',
        tag: 'CLEAN & GREEN // 03'
      }
    ],
    pendulumPhotos: [
      {
        src: '/slide6-1.jpg',
        label: 'Putting Plastic Bottles in Recycling Bins',
        ropeLength: 52,
        rotZ: -3.2,
        rotY: 5,
        topOffset: 2,
        phase: 0.3
      },
      {
        src: '/slide6-2.webp',
        label: 'Putting Rubbish in the Correct Bin',
        ropeLength: 58,
        rotZ: 3.0,
        rotY: -5,
        topOffset: 8,
        phase: 1.8
      }
    ],
    nodePosition: { x: 15, y: 8, z: -100 },
    nodeRotation: { x: 0.03, y: -0.14, z: 0.01 }
  },

  // ==========================================================================
  // PAIR 4: SLIDE 7, SLIDE 8 & SLIDE 9
  // ==========================================================================
  {
    id: 7,
    numberString: '7',
    header: '>_ Unit 2: Humans & Environment',
    subLabel: 'SLIDE 07 // OUR GREEN SCHOOL CAMPAIGN',
    titleLine1: 'Green School',
    titleLine2: 'Week.',
    trackingMode: false,
    layoutPair: 'pair4-campaign',
    particleMode: 'interactive-nebula',
    imageEntrance: 'hanging-pendulum-7',
    type: 'campaign-5cols',
    subtitle: 'Our Project: Green School Week — Class 10A3 Action Plan',
    tableHeaders: ['Day', 'Activity'],
    tableRows: [
      { day: 'Monday', icon: '🧹', activity: 'Clean classrooms and the schoolyard' },
      { day: 'Tuesday', icon: '💧', activity: 'Bring reusable water bottles' },
      { day: 'Wednesday', icon: '⚡', activity: 'Save electricity and water' },
      { day: 'Thursday', icon: '🌱', activity: 'Plant and take care of trees' },
      { day: 'Friday', icon: '♻️', activity: 'Collect and recycle plastic waste' }
    ],
    footerNote: 'We hope all students will join these activities.',
    pendulumPhotos: [
      {
        src: '/slide7-1.jpg',
        label: 'Planting Young Saplings',
        ropeLength: 145,
        rotZ: -3.2,
        rotY: 5,
        topOffset: 0,
        phase: 0.0
      },
      {
        src: '/slide7-2.jpg',
        label: 'Digging Holes for Trees',
        ropeLength: 160,
        rotZ: 2.8,
        rotY: -5,
        topOffset: 14,
        phase: 0.9
      },
      {
        src: '/slide7-3.jpg',
        label: 'Preparing Soil with a Hoe',
        ropeLength: 145,
        rotZ: -2.5,
        rotY: 4,
        topOffset: 2,
        phase: 1.8
      },
      {
        src: '/slide7-4.jpg',
        label: 'Adding Soil Around Roots',
        ropeLength: 162,
        rotZ: 3.0,
        rotY: -5,
        topOffset: 16,
        phase: 2.7
      },
      {
        src: '/slide7-5.jpg',
        label: 'Teamwork Planting Trees',
        ropeLength: 145,
        rotZ: -2.8,
        rotY: 4,
        topOffset: 0,
        phase: 3.6
      },
      {
        src: '/slide7-6.jpg',
        label: 'Caring for New Saplings',
        ropeLength: 158,
        rotZ: 2.6,
        rotY: -4,
        topOffset: 14,
        phase: 4.5
      },
      {
        src: '/slide7-7.jpg',
        label: 'Clearing Ground for Planting',
        ropeLength: 146,
        rotZ: -3.0,
        rotY: 5,
        topOffset: 4,
        phase: 5.4
      }
    ],
    nodePosition: { x: -18, y: -6, z: -122 },
    nodeRotation: { x: -0.03, y: 0.14, z: -0.01 }
  },
  {
    id: 8,
    numberString: '8',
    header: '>_ Unit 2: Humans & Environment',
    subLabel: 'SLIDE 08 // IMPACT & OUTCOMES',
    titleLine1: 'Expected',
    titleLine2: 'Results.',
    trackingMode: false,
    layoutPair: 'pair4-synthesis',
    bulletStyle: 'synthesis-bento',
    particleMode: 'rising-spores',
    imageEntrance: 'diagonal-hanging-chain',
    type: 'bullets',
    items: [
      'A cleaner and greener school.',
      'Less plastic waste and pollution.',
      'Lower electricity and water consumption.',
      'More environmentally friendly habits.',
      'Greater responsibility among students.',
      'Together, we can make a difference!'
    ],
    images: [
      {
        src: '/slide8-1.jpg',
        caption: 'Turning Off Switches to Save Electricity',
        tag: '01 // ENERGY SAVING',
        rotZ: -4,
        rotY: 4
      },
      {
        src: '/slide8-2.jpg',
        caption: 'Building Eco-Friendly Habits at School',
        tag: '02 // ECO HABITS',
        rotZ: 2,
        rotY: -4
      },
      {
        src: '/slide8-3.jpg',
        caption: 'Sorting Paper, Plastic & Glass Waste',
        tag: '03 // WASTE SORTING',
        rotZ: -3,
        rotY: 4
      }
    ],
    nodePosition: { x: -18, y: -6, z: -92 },
    nodeRotation: { x: 0.04, y: -0.14, z: 0.01 }
  },
  {
    id: 9,
    numberString: '9',
    header: '>_ Unit 2: Humans & Environment',
    subLabel: 'SLIDE 09 // CONCLUSION',
    titleLine1: 'A Green School',
    titleLine2: 'Starts With You!',
    trackingMode: false,
    layoutPair: 'pair4-conclusion',
    bulletStyle: 'conclusion-grand',
    particleMode: 'rising-spores',
    imageEntrance: 'diagonal-hanging-chain',
    type: 'bullets',
    // Hotfix V5 2.1: Removed "THANK YOU FOR LISTENING!" completely
    items: [
      'Protecting the environment does not require big actions. Small changes in our daily school life can make a big difference.',
      'Let’s work together to make our school cleaner, greener and more beautiful!',
      'Go Green Today, Save Tomorrow!'
    ],
    images: [
      {
        src: '/slide9-1.jpg',
        caption: 'Nurturing Our Green World with Water & Care',
        tag: '01 // NURTURE EARTH',
        rotZ: -4,
        rotY: 4
      },
      {
        src: '/slide9-2.jpg',
        caption: 'Protecting Every Green Sprout in Our Hands',
        tag: '02 // SMALL ACTIONS',
        rotZ: 2,
        rotY: -4
      },
      {
        src: '/slide9-3.jpg',
        caption: 'Building a Clean & Sustainable Green Future',
        tag: '03 // GREEN FUTURE',
        rotZ: -3,
        rotY: 4
      }
    ],
    nodePosition: { x: 0, y: 4, z: -142 },
    nodeRotation: { x: 0, y: 0, z: 0 }
  },

  // ==========================================================================
  // SLIDE 10 (SPECIAL OUTRO): PHOTOREALISTIC LEAF & BLENDER SPEED-RAMP
  // ==========================================================================
  {
    id: 10,
    numberString: '10',
    header: '>_ Unit 2: Humans & Environment',
    subLabel: 'SLIDE 10 // FINAL OUTRO',
    titleLine1: 'Thanks',
    titleLine2: 'for Watching!',
    subtitle: 'Group 1 - Class 10A3 | Go Green Today, Save Tomorrow!',
    trackingMode: false,
    layoutPair: 'slide10-outro',
    particleMode: 'rising-spores',
    type: 'outro-leaf',
    items: [],
    nodePosition: { x: 0, y: 0, z: -168 },
    nodeRotation: { x: 0, y: 0, z: 0 }
  }
];
