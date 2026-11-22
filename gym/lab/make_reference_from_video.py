"""
Turn a video of good reps into the app's perfect-form 3D reference.

    python make_reference_from_video.py push_up good_pushups.mp4 [--model heavy] [--rep best|N]

1. MediaPipe Pose (heavy model by default: the most accurate) gives 3D world
   landmarks per frame, plus the body's movement through the picture (root motion).
2. The app's own engine (segment_reps.mjs, via Node) finds and scores every rep.
3. The best-scoring rep (or the one you pick) is lightly smoothed and written to
   gym/reference/<exercise>.json, replacing the generated placeholder.

Film tips: side view (front for pull-ups), whole body in the picture, 3-8 slow,
textbook reps, good light, camera still and level.
Needs: pip install mediapipe opencv-python numpy; Node 18+.
"""
import argparse, json, os, subprocess, sys
import numpy as np
from capture_io import encode
from import_videos import ensure_model, extract

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "reference")


def root_motion(img, world, size):
    """Hip-centre travel in metres, from the image, scaled by the torso length (as the app does)."""
    W, H = size
    px = img * np.array([W, H])
    hip = (px[:, 23] + px[:, 24]) / 2
    sh = (px[:, 11] + px[:, 12]) / 2
    torso_px = np.linalg.norm(sh - hip, axis=1)
    torso_m = np.linalg.norm(((world[:, 11] + world[:, 12]) / 2 - (world[:, 23] + world[:, 24]) / 2)[:, :2], axis=1)
    scale = np.nanmedian(torso_m / np.where(torso_px > 20, torso_px, np.nan))
    root = np.zeros((len(world), 3))
    root[:, :2] = (hip - hip[0]) * scale
    return root


def smooth(x, k=5):
    """Centred moving average along time (keeps the shape, removes jitter)."""
    if len(x) < k:
        return x
    pad = k // 2
    xp = np.concatenate([np.repeat(x[:1], pad, 0), x, np.repeat(x[-1:], pad, 0)])
    c = np.cumsum(xp, axis=0)
    out = (c[k:] - c[:-k]) / k
    return np.concatenate([xp[pad:pad + 1], out])[: len(x)] if len(out) < len(x) else out[: len(x)]


def segment(exercise, t, world):
    payload = json.dumps({"exercise": exercise, "t": t.tolist(), "world": [None if np.isnan(w).any() else w.tolist() for w in world]})
    r = subprocess.run(["node", os.path.join(HERE, "segment_reps.mjs")], input=payload.encode(), capture_output=True, check=True)
    return json.loads(r.stdout)


def build(exercise, world, vis, fps, img=None, size=None, pick="best", source="video", note=""):
    ok = ~np.isnan(world).reshape(len(world), -1).any(1)
    idx = np.nonzero(ok)[0]
    world, vis = world[ok], vis[ok]
    t = idx / fps
    root = root_motion(img[ok], world, size) if img is not None else np.zeros((len(world), 3))
    seg = segment(exercise, t, world)
    reps = seg["reps"]
    if exercise == "plank":
        a, b = 0, len(world) - 1
        chosen = None
    else:
        if not reps:
            sys.exit("No reps found: check the exercise name, the camera view and that the whole body is visible.")
        for r in reps:
            print(f"  rep {r['n']}: score {r['score']:3d}  bottom {r['bottom']}°  top {r['top']}°  {r['duration']}s  faults: {', '.join(f['key'] for f in r['faults']) or '-'}")
        chosen = max(reps, key=lambda r: (r["score"], -abs(r["duration"] - 2.5))) if pick == "best" else reps[int(pick) - 1]
        a = int(np.searchsorted(t, chosen["t0"] - 0.2))
        b = int(min(len(t) - 1, np.searchsorted(t, chosen["t1"] + 0.2)))
        print(f"-> using rep {chosen['n']} (score {chosen['score']})")
    w = smooth(world[a:b + 1].astype(float), 5)
    return encode(w, t[a:b + 1], root_m=smooth(root[a:b + 1], 5), vis=vis[a:b + 1], exercise=exercise, source=source,
                  note=note or (f"From video, rep {chosen['n']} (score {chosen['score']})" if chosen else "From video"))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("exercise")
    ap.add_argument("video", nargs="?")
    ap.add_argument("--model", default="heavy", choices=["lite", "full", "heavy"])
    ap.add_argument("--rep", default="best", help="'best' or a rep number")
    ap.add_argument("--from-npz", help="use landmarks already extracted by import_videos.py instead of a video")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    if args.from_npz:
        d = np.load(args.from_npz, allow_pickle=True)
        world, vis, fps = d["world"], d["vis"], float(d["fps"])
        img = d["image"] if "image" in d else None
        size = tuple(d["size"]) if "size" in d else None
    else:
        world, vis, fps, img, size = extract(args.video, ensure_model(args.model, os.path.join(HERE, "models")), return_image=True)
    cap = build(args.exercise, world, vis, fps, img, size, pick=args.rep)
    out = args.out or os.path.join(OUT, f"{args.exercise}.json")
    json.dump(cap, open(out, "w"), separators=(",", ":"))
    print(f"wrote {out} ({cap['frames']} frames)")


if __name__ == "__main__":
    main()
