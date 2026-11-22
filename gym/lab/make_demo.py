"""Build app/demo.json: a short generated workout played by the app's Demo mode."""
import json, math, os, sys
import numpy as np
import synth

HERE = os.path.dirname(os.path.abspath(__file__))
FW, FH = 720, 1280  # portrait frame the demo is drawn in

def project(abs_pts):
    """Fit the whole sequence into the portrait frame (orthographic-ish)."""
    x, y = abs_pts[..., 0], abs_pts[..., 1]
    cx, cy = (x.max() + x.min()) / 2, (y.max() + y.min()) / 2
    span = max((x.max() - x.min()) * FH / FW, y.max() - y.min())
    scale = 0.72 / span
    u = 0.5 + (x - cx) * scale * FH / FW
    v = 0.5 + (y - cy) * scale
    return np.stack([u, v], -1)

def main(out=os.path.join(HERE, "..", "demo.json")):
    rng = np.random.default_rng(2026)
    plan = [("push_up", 6, set()), ("idle", 0, None), ("squat", 6, {"partial_depth"}), ("idle", 0, None),
            ("pull_up", 5, set()), ("idle", 0, None), ("dip", 5, {"excess_lean"}), ("idle", 0, None),
            ("lunge", 6, set()), ("idle", 0, None), ("plank", 0, {"hip_sag"})]
    seqs = []
    for ex, n, faults in plan:
        for attempt in range(200):
            prof = synth.form_profile(ex, rng, p_fault=0.0 if not faults else 1.0)
            if faults is None or ex == "idle":
                prof[0]["idle_kind"] = "stand" if ex == "idle" else prof[0].get("idle_kind")
                break
            if prof[1] == faults:
                break
        yaw = math.pi / 2 + rng.uniform(-0.35, 0.35) if ex != "pull_up" else rng.uniform(-0.4, 0.4)
        s = synth.generate(ex, rng, n_reps=n or None, noise=0.7, profile=prof, yaw=yaw, fps=20.0,
                           duration=4.5 if ex == "idle" else (16.0 if ex == "plank" else None))
        img = project(s.abs)
        # integers keep the file small: world in cm, image in 1/1000 of the frame
        seqs.append({"exercise": ex, "world": np.round(s.world * 100).astype(int).tolist(), "image": np.round(img * 1000).astype(int).tolist()})
        print(ex, len(s.world), sorted(s.faults))
    json.dump({"fps": 20, "frame": [FW, FH], "units": {"world": 0.01, "image": 0.001}, "sequences": seqs}, open(out, "w"), separators=(",", ":"))
    print("wrote", out, f"{os.path.getsize(out)/1e6:.1f} MB")

if __name__ == "__main__":
    main(*sys.argv[1:])
