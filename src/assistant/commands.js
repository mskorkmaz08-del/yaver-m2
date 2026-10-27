// Voice commands for the 3D studio, handled right away without asking the
// language model: "add two red cubes", "delete it", "make it bigger",
// "paint it green", "zoom in", "clear everything". Returns what Yaver should
// say, or null when the sentence isn't a studio command.

export const COLOR_NAMES = {
  red: "#ff6b6b", blue: "#4cc9ff", "light blue": "#8fe3ff", "dark blue": "#2f6bff", navy: "#1d3b8f",
  yellow: "#ffd166", gold: "#f5c542", orange: "#ff9f43", green: "#06d6a0", lime: "#a3e635",
  purple: "#c77dff", violet: "#9b5de5", pink: "#ff8fab", white: "#f1f1f1", black: "#2b2f36",
  grey: "#9aa5b1", gray: "#9aa5b1", silver: "#c0c7d1", brown: "#a0522d", cyan: "#22d3ee", teal: "#14b8a6",
};

const NUMBERS = { a: 1, an: 1, one: 1, another: 1, two: 2, three: 3, four: 4, five: 5, six: 6, couple: 2, few: 3 };

// Spoken names for each shape, plus plurals and near-misses.
const SHAPE_WORDS = {
  cube: ["cube", "cubes", "box", "boxes", "block", "blocks"],
  sphere: ["sphere", "spheres", "ball", "balls", "orb", "orbs"],
  cylinder: ["cylinder", "cylinders", "tube", "tubes", "can", "cans"],
  cone: ["cone", "cones"],
  torus: ["torus", "tori", "donut", "donuts", "doughnut", "doughnuts", "ring", "rings"],
  pyramid: ["pyramid", "pyramids"],
  capsule: ["capsule", "capsules", "pill", "pills"],
  gem: ["gem", "gems", "crystal", "crystals"],
  diamond: ["diamond", "diamonds"],
  knot: ["knot", "knots"],
};

function findShape(text) {
  for (const [shape, words] of Object.entries(SHAPE_WORDS)) {
    if (words.some((w) => new RegExp(`\\b${w}\\b`).test(text))) return shape;
  }
  return null;
}

function findColor(text) {
  // Longest names first, so "light blue" wins over "blue".
  const names = Object.keys(COLOR_NAMES).sort((a, b) => b.length - a.length);
  const name = names.find((n) => new RegExp(`\\b${n}\\b`).test(text));
  return name ? { name, hex: COLOR_NAMES[name] } : null;
}

function findCount(text) {
  const m = text.match(/\b(\d+|a|an|one|another|two|three|four|five|six|couple|few)\b/);
  if (!m) return 1;
  const n = /\d/.test(m[1]) ? Number(m[1]) : NUMBERS[m[1]];
  return Math.min(Math.max(n || 1, 1), 12);
}

const plural = (n, shape) => (n === 1 ? `a ${shape}` : `${n} ${shape === "torus" ? "tori" : shape + "s"}`);

// `studio` is { editor, addShape(shape, color), setHelpOpen(open) } from main.js.
export function runCommand(raw, studio) {
  const text = raw.toLowerCase().replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim();
  const { editor } = studio;
  const shape = findShape(text);
  const color = findColor(text);
  const target = () => editor.selected || editor.objects[editor.objects.length - 1] || null;

  // Add shapes.
  if (shape && /\b(add|create|make|spawn|put|place|give me|build|drop|i want|i need|new)\b/.test(text) &&
      !/\b(delete|remove|destroy|get rid)\b/.test(text)) {
    const n = findCount(text);
    for (let i = 0; i < n; i++) studio.addShape(shape, color?.hex, i, n);
    return `${n === 1 ? "Here's" : "Here are"} ${plural(n, shape)}${color ? `, in ${color.name}` : ""}.`;
  }

  // Delete.
  if (/\b(delete|remove|destroy|get rid of|trash|bin)\b/.test(text)) {
    if (/\b(everything|all|every|the scene|whole scene)\b/.test(text)) {
      const n = editor.objects.length;
      for (const o of [...editor.objects]) editor.remove(o);
      return n ? "Scene cleared." : "The scene is already empty.";
    }
    let obj = target();
    if (shape) {
      const matches = editor.objects.filter((o) => o.userData.shape === shape);
      obj = matches.includes(editor.selected) ? editor.selected : matches[matches.length - 1];
    }
    if (!obj) return shape ? `There's no ${shape} to delete.` : "There's nothing to delete.";
    const name = obj.userData.shape;
    editor.remove(obj);
    return `${name[0].toUpperCase() + name.slice(1)} deleted.`;
  }
  if (/\b(clear|reset|empty)\b.*\b(scene|everything|all)\b|^(clear|reset) (it|the scene)$/.test(text)) {
    for (const o of [...editor.objects]) editor.remove(o);
    return "Scene cleared.";
  }

  // Colour the selected (or newest) object.
  if (color && /\b(colou?r|paint|make|turn|change|set)\b/.test(text)) {
    const obj = target();
    editor.setColor(color.hex, obj);
    return obj ? `Painted ${color.name}.` : `New shapes will be ${color.name}.`;
  }

  // Size.
  const bigger = /\b(bigger|larger|grow|scale (it )?up|enlarge|increase)\b/.test(text);
  const smaller = /\b(smaller|shrink|scale (it )?down|reduce|tinier|decrease)\b/.test(text);
  if (bigger || smaller) {
    const obj = target();
    if (!obj) return "There's nothing to resize.";
    const much = /\b(much|lot|way|twice|double|half)\b/.test(text) ? 2 : 1.4;
    editor.setScale(obj, obj.scale.x * (bigger ? much : 1 / much));
    return bigger ? "Bigger it is." : "Smaller it is.";
  }

  // View.
  if (/\bzoom (in|closer)\b|\bcloser\b/.test(text)) { editor.zoomBy(0.75); return "Zooming in."; }
  if (/\bzoom out\b|\bfurther\b|\bfarther\b/.test(text)) { editor.zoomBy(1.33); return "Zooming out."; }
  if (/\b(rotate|turn|spin|orbit)\b.*\b(view|camera|scene)\b.*\bleft\b|\blook left\b/.test(text)) { editor.orbitBy(-0.6, 0); return "Turning left."; }
  if (/\b(rotate|turn|spin|orbit)\b.*\b(view|camera|scene)\b.*\bright\b|\blook right\b/.test(text)) { editor.orbitBy(0.6, 0); return "Turning right."; }

  // Help panel.
  if (/\b(show|open)\b.*\b(help|gestures|controls|tutorial)\b/.test(text)) { studio.setHelpOpen(true); return "Here are the hand controls."; }
  if (/\b(hide|close)\b.*\b(help|gestures|controls|tutorial)\b/.test(text)) { studio.setHelpOpen(false); return "Help closed."; }

  return null;
}

// One line describing the scene, so the model can talk about it.
export function describeScene(editor) {
  const counts = {};
  for (const o of editor.objects) counts[o.userData.shape] = (counts[o.userData.shape] || 0) + 1;
  const parts = Object.entries(counts).map(([s, n]) => plural(n, s));
  return parts.length ? `The 3D scene has ${parts.join(", ")}.` : "The 3D scene is empty.";
}
