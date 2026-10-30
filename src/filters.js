// One Euro filter (Casiez et al.): smooths a jittery signal heavily while it
// is nearly still, and lightly while it moves fast, so a resting hand stops
// shaking without making quick moves feel laggy.
export class OneEuro {
  // minCutoff: smoothing at rest (lower = steadier). beta: how quickly the
  // smoothing lets go as speed rises (higher = less lag on fast moves).
  constructor(minCutoff = 1, beta = 0, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = null;
    this.dx = 0;
    this.t = 0;
  }

  // `t` is in milliseconds.
  filter(value, t) {
    if (this.x === null) {
      this.x = value;
      this.t = t;
      return value;
    }
    const dt = Math.max((t - this.t) / 1000, 1e-3);
    this.t = t;
    const alpha = (cutoff) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    const dx = (value - this.x) / dt;
    this.dx += alpha(this.dCutoff) * (dx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff) * (value - this.x);
    return this.x;
  }
}

// Glides a value toward a target every screen frame (a critically damped
// spring, like Unity's SmoothDamp). The camera reports hands only 12 to 30
// times a second, and less evenly on a poor camera; gliding between those
// reports keeps the pointer moving smoothly at the screen's own rate.
export class Glide {
  // smoothMs: roughly how long it takes to catch up with the target.
  constructor(smoothMs = 55) {
    this.smooth = smoothMs / 1000;
    this.x = null;
    this.v = 0;
  }

  // Jumps straight to `value` and stops there.
  snap(value) {
    this.x = value;
    this.v = 0;
    return value;
  }

  // `dt` is in milliseconds since the last step.
  step(target, dt) {
    if (this.x === null || !Number.isFinite(this.x)) {
      this.x = target;
      this.v = 0;
      return target;
    }
    const t = Math.min(Math.max(dt, 0), 100) / 1000;
    const omega = 2 / this.smooth;
    const k = omega * t;
    const decay = 1 / (1 + k + 0.48 * k * k + 0.235 * k * k * k);
    const change = this.x - target;
    const temp = (this.v + omega * change) * t;
    this.v = (this.v - omega * temp) * decay;
    this.x = target + (change + temp) * decay;
    return this.x;
  }
}
