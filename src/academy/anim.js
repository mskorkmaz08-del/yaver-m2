// Small tween engine for the course: smooth moves of any numeric property
// (positions, rotations, scales, opacities, camera poses). Every tween runs
// off one clock that the academy advances each frame.

export const ease = {
  linear: (t) => t,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
  back: (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
};

let tweens = [];

// Moves `target`'s numeric properties to `to` over `ms`. Starting a tween on
// a property that is already moving takes over from where it is now.
export function tween(target, to, { ms = 700, delay = 0, curve = ease.inOut, onUpdate } = {}) {
  tweens = tweens.filter((t) => {
    const clash = t.target === target && Object.keys(to).some((k) => k in t.to);
    if (clash) t.resolve();
    return !clash;
  });
  return new Promise((resolve) => {
    tweens.push({ target, to, from: null, ms: Math.max(ms, 1), delay, t: 0, curve, onUpdate, resolve });
  });
}

export function stopTweens(target) {
  tweens = tweens.filter((t) => {
    const hit = !target || t.target === target;
    if (hit) t.resolve();
    return !hit;
  });
}

export function stepTweens(dtMs) {
  const done = [];
  for (const tw of tweens) {
    if (tw.delay > 0) { tw.delay -= dtMs; continue; }
    if (!tw.from) tw.from = Object.fromEntries(Object.keys(tw.to).map((k) => [k, tw.target[k]]));
    tw.t = Math.min(tw.t + dtMs / tw.ms, 1);
    const k = tw.curve(tw.t);
    for (const key in tw.to) tw.target[key] = tw.from[key] + (tw.to[key] - tw.from[key]) * k;
    tw.onUpdate?.(k);
    if (tw.t >= 1) done.push(tw);
  }
  if (done.length) {
    tweens = tweens.filter((t) => !done.includes(t));
    for (const t of done) t.resolve();
  }
}

export const wait = (ms) => tween({ v: 0 }, { v: 1 }, { ms, curve: ease.linear });
