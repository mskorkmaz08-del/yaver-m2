// Coaching knowledge: form standards, camera placement, fixes and
// progressions for each exercise. Standards summarise published coaching
// guidance (sources at the bottom of the Guide tab).

export const ORDER = ["push_up", "pike_push_up", "plank", "pull_up", "inverted_row", "dip", "squat", "lunge", "hanging_leg_raise"];

export const INFO = {
  push_up: {
    camera: "Side view, phone at floor or knee height, 2–3 m away.",
    standards: [
      "Straight line from head to heels: hips neither sag nor pike.",
      "Lower until the elbows reach about 90° (upper arms level with the body); the app treats a bottom angle above ~100° as a partial rep.",
      "Elbows about 45° from the body, not flared out to 90°.",
      "Lock the arms out at the top of every rep.",
      "Control the way down: about 1–2 s.",
    ],
    target: 20, unit: "clean reps",
    easier: "Incline push-ups (hands on a bench), then lower the incline over time",
    harder: "Diamond, decline or archer push-ups",
  },
  pike_push_up: {
    camera: "Side view.",
    standards: [
      "Hips high, body in an upside-down V.",
      "Lower the head toward the floor until the elbows reach about 90°.",
      "Press back up to straight arms.",
    ],
    target: 12, unit: "clean reps",
    easier: "Pike hold, or regular push-ups to build pressing strength",
    harder: "Feet-elevated pike push-ups, then wall handstand push-ups",
  },
  plank: {
    camera: "Side view.",
    standards: [
      "Straight line from shoulders to ankles.",
      "Glutes and abs tight, no sagging or raised hips.",
      "Elbows (or hands) under the shoulders.",
    ],
    target: 60, unit: "seconds",
    easier: "Knee plank",
    harder: "RKC plank (max tension), long-lever plank, body saw",
  },
  pull_up: {
    camera: "Front or side view, with the bar and your whole body in the picture.",
    standards: [
      "Start every rep from a dead hang with straight arms.",
      "Pull until the chin clears the bar.",
      "No kipping or leg drive: the body stays still.",
      "Lower under control back to straight arms.",
    ],
    target: 10, unit: "clean reps",
    easier: "Negatives (slow lowering), band-assisted pull-ups, inverted rows",
    harder: "L-sit pull-ups, archer pull-ups, weighted pull-ups",
  },
  inverted_row: {
    camera: "Side view.",
    standards: [
      "Body straight from shoulders to heels.",
      "Pull the chest to the bar; elbows end around 70–90°.",
      "Start each rep from straight arms.",
    ],
    target: 15, unit: "clean reps",
    easier: "Higher bar or bent knees",
    harder: "Lower bar, feet elevated, archer rows",
  },
  dip: {
    camera: "Side view.",
    standards: [
      "Lower until the elbows reach about 90° (upper arms roughly parallel to the floor).",
      "Lock the arms out at the top.",
      "Torso slightly forward is fine; avoid an extreme lean.",
      "No swinging. Go only as deep as your shoulders tolerate.",
    ],
    target: 15, unit: "clean reps",
    easier: "Bench dips, dip negatives",
    harder: "Ring dips, weighted dips",
  },
  squat: {
    camera: "Side view for depth and lean; front view to check that the knees track over the toes.",
    standards: [
      "Thighs at least parallel to the floor (knees about 90°).",
      "Knees track over the toes; they do not cave inward.",
      "Chest up: limited forward lean.",
      "Stand all the way up at the top.",
    ],
    target: 30, unit: "clean reps",
    easier: "Box squat to a bench at parallel height",
    harder: "Bulgarian split squat, then pistol squat progressions",
  },
  lunge: {
    camera: "Side view.",
    standards: [
      "Front knee about 90° at the bottom.",
      "Back knee drops toward the floor.",
      "Torso upright.",
    ],
    target: 20, unit: "clean reps (both legs)",
    easier: "Supported split squat (hold onto something)",
    harder: "Bulgarian split squat, jumping lunges",
  },
  hanging_leg_raise: {
    camera: "Side view, with the bar in the picture.",
    standards: [
      "Raise straight legs to at least horizontal.",
      "No swinging: pause at the bottom.",
      "Lower slowly.",
    ],
    target: 12, unit: "clean reps",
    easier: "Hanging knee raises",
    harder: "Toes-to-bar",
  },
};

// How to fix each fault (drills / cues)
export const DRILLS = {
  hip_sag: "Hollow-body holds and planks with a hard glute squeeze; think \"ribs down, tuck the tailbone\".",
  hip_pike: "Practise planks side-on to a mirror; push-ups with a broomstick along the back.",
  partial_depth: "Slow 3-second lowering to a target (fist or block) and a 1 s pause at the bottom; use an easier variation if needed to reach full range.",
  no_lockout: "Pause for 1 s at the start position of every rep.",
  elbow_flare: "Hands just outside the shoulders, \"screw\" them into the floor, elbows pointing back at ~45°.",
  rushed: "Count a 2–3 s lowering on every rep.",
  hips_low: "Walk your feet closer to your hands until the hips stack high over the shoulders.",
  chin_below_bar: "Negatives from the top, flexed-arm hangs, band-assisted full-range reps.",
  kipping: "Hollow-body hang, slow strict reps, band assistance instead of swinging.",
  excess_lean: "Keep the chest up; for squats try heels slightly raised and ankle mobility work.",
  swinging: "Start from a still hang/support and pause 1 s at the bottom of each rep.",
  knee_valgus: "Push the knees out over the toes; glute bridges and band walks strengthen the hips.",
  bent_knees: "Bent knees are fine as a progression (knee raise); straighten them as you get stronger.",
  very_deep: "Deep dips are fine only if your shoulders feel good; 90° is enough.",
};

export const SOURCES = [
  ["NASM — Proper push-up form and technique", "https://www.nasm.org/resource-center/blog/training/proper-push-up-form-and-technique-a-complete-guide"],
  ["CrossFit — The lowly push-up revisited", "https://crossfit.com/pro-coach/the-lowly-push-up-revisited"],
  ["MasterClass — Push-up form guide", "https://www.masterclass.com/articles/proper-push-up-form-guide"],
  ["US Marine Corps — Pull-up training guide (PDF)", "https://www.marines.mil/Portals/1/Docs/PullupTrainingGuide.pdf"],
  ["StrongLifts — Pull-ups with proper form", "https://stronglifts.com/pullup/"],
  ["StrongLifts — Dips with proper form", "https://stronglifts.com/dip"],
  ["Garage Gym Reviews — Dips exercise", "https://www.garagegymreviews.com/dips-exercise"],
  ["NASM — Biomechanics of the squat", "https://www.nasm.org/resource-center/blog/training/biomechanics-of-the-squat"],
  ["Les Mills — Squat basics", "https://www.lesmills.com/uk/fit-planet/fitness/squat-basics/"],
  ["Precision Nutrition — How to squat", "https://precisionnutrition.com/?p=20200"],
];
