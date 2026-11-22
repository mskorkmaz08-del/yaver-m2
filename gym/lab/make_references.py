"""
Write gym/reference/<exercise>.json: one perfect-form rep per exercise,
shown as the 3D "ghost" in the app.

    python make_references.py              # generated ideal reps (placeholder)

Real references from videos of good reps: see make_reference_from_video.py.
"""
import json, math, os
import numpy as np
import synth
from capture_io import encode

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "reference")


def ideal_profile(ex, rng):
    F, _ = synth.form_profile(ex, rng, p_fault=0.0)
    # textbook values from FORM_STANDARDS.md
    F.update({
        "push_up": dict(e_bottom=85, e_top=178, flare=40, hip_offset=0.0, hand_wide=0.04, head_nod=0.1, hand_fwd=0.02),
        "plank": dict(e_top=178, hip_offset=0.0, variant="forearm", head_nod=0.1),
        "pike_push_up": dict(e_bottom=88, e_top=177, hip_angle=78, pike_dist=0.56),
        "pull_up": dict(grip=1.4, lockout=1.0, top_clear=0.07, depth=1.0, kip=0.0, lean=10, leg_flex=8, knee=176),
        "inverted_row": dict(e_top=70, e_start=176, hip_offset=0.0, bar_h=0.56, dist=1.0),
        "dip": dict(e_bottom=88, e_top=177, lean_top=6, lean_bottom=22, kip=0.0, leg_flex=0, knee=170),
        "squat": dict(k_bottom=80, k_top=177, lean_top=2, lean_bottom=33, valgus=0.0, knee_out=1.06, stance=1.5, shin_mult=1.0, arms="forward"),
        "lunge": dict(k_bottom=90, lean_top=2, lean_bottom=6, stride=0.44, shin_fwd=6, arms="hips", first_side=0),
        "hanging_leg_raise": dict(flex_top=100, knee_top=177, kip=0.0, grip=1.3),
    }.get(ex, {}))
    return F, set()


def main():
    os.makedirs(OUT, exist_ok=True)
    rng = np.random.default_rng(7)
    jobs = [(e, e) for e in synth.EXERCISES if e != "idle"] + [("plank", "plank_high")]
    for ex, name in jobs:
        prof = ideal_profile(ex, rng)
        if name == "plank_high":
            prof[0]["variant"] = "high"
        yaw = rng.uniform(-0.2, 0.2) if ex in ("pull_up", "hanging_leg_raise") else math.pi / 2
        if ex == "plank":
            seq = synth.generate(ex, rng, noise=0.0, profile=prof, yaw=yaw, duration=4.0, fps=30.0)
            a, b = 0, len(seq.world) - 1
        else:
            seq = synth.generate(ex, rng, n_reps=1, noise=0.0, profile=prof, yaw=yaw, fps=30.0)
            s0, s1 = seq.rep_bounds[0]
            a, b = max(0, s0 - 6), min(len(seq.world) - 1, s1 + 6)
        world = seq.world[a:b + 1].astype(float)
        hip = (seq.abs[a:b + 1, 23] + seq.abs[a:b + 1, 24]) / 2
        t = np.arange(len(world)) / seq.fps
        d = encode(world, t, root_m=hip, exercise=ex, source="generated",
                   note="Generated ideal rep (textbook angles). Replace with a real one: lab/make_reference_from_video.py")
        path = os.path.join(OUT, f"{name}.json")
        json.dump(d, open(path, "w"), separators=(",", ":"))
        print(f"{name:18s} {len(world)} frames  {os.path.getsize(path)/1024:.0f} KB")


if __name__ == "__main__":
    main()
