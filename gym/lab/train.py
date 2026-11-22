"""
Train the exercise classifier and export it for the phone app.

    python train.py                       # synthetic data only
    python train.py --real data/poses     # + real pose recordings (see import_videos.py)
    python train.py --real data/poses --export-js ../model.json

Real recordings are .npz files (world, vis, fps, label) made by
import_videos.py from labelled video folders, or .json exports from the
app's "Teach" screen.  They are weighted higher than synthetic windows.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import time
from concurrent.futures import ProcessPoolExecutor

import numpy as np
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler

import features as FE
import synth

HERE = os.path.dirname(os.path.abspath(__file__))


def _gen_one(args):
    ex, seed, noise = args
    rng = np.random.default_rng(seed)
    seq = synth.generate(ex, rng, noise=noise)
    X = FE.sequence_frame_matrix(seq.world)
    W = FE.sequence_windows(X, seq.fps, stride_sec=0.3, rng=rng)
    return ex, seed, W


def synthetic_windows(n_seq, seed=0, workers=None):
    jobs = []
    for ci, ex in enumerate(synth.EXERCISES):
        n = n_seq * (2 if ex == "idle" else 1)
        for k in range(n):
            noise = [0.6, 1.0, 1.0, 1.6][k % 4]
            jobs.append((ex, seed * 1_000_000 + ci * 10_000 + k, noise))
    out = []
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for ex, s, W in pool.map(_gen_one, jobs, chunksize=8):
            if len(W):
                out.append((ex, s, W))
    return out


def load_real(path):
    """Yield (label, group_id, windows) from .npz / .json pose recordings."""
    files = sorted(glob.glob(os.path.join(path, "**", "*.npz"), recursive=True))
    files += sorted(glob.glob(os.path.join(path, "**", "*.json"), recursive=True))
    for f in files:
        if f.endswith(".npz"):
            d = np.load(f, allow_pickle=True)
            label = str(d["label"])
            world, fps = d["world"], float(d["fps"])
            vis = d["vis"] if "vis" in d else None
            # real videos have gaps where no pose was found (NaN): keep real timestamps
            ok = ~np.isnan(world).reshape(len(world), -1).any(1)
            if ok.sum() < fps * FE.WINDOW_SEC:
                continue
            X = FE.sequence_frame_matrix(world[ok], None if vis is None else vis[ok])
            t = np.nonzero(ok)[0] / fps
            yield label, f, windows_with_gaps(t, X)
        else:
            d = json.load(open(f))
            for i, clip in enumerate(d.get("clips", [])):
                label = clip["label"]
                if label not in synth.EXERCISES:
                    continue
                t = np.array(clip["t"], dtype=float)
                X = np.array(clip["frames"], dtype=float)  # per-frame feature vectors from the app
                if len(X) < 10 or t[-1] - t[0] < FE.WINDOW_SEC:
                    continue
                yield label, f"{f}#{i}", windows_with_gaps(t, X)


def windows_with_gaps(t, X, stride=0.25, max_gap=0.5):
    """Windows over frames with timestamps t, skipping windows that span a tracking gap."""
    out = []
    tt = t[0] + FE.WINDOW_SEC
    gaps = np.diff(t)
    while tt <= t[-1] + 1e-9:
        sel = (t >= tt - FE.WINDOW_SEC) & (t <= tt)
        idx = np.nonzero(sel)[0]
        if len(idx) >= 8 and (len(idx) < 2 or gaps[idx[0]:idx[-1]].max(initial=0) <= max_gap):
            out.append(FE.window_features(FE.resample(t, X, tt)))
        tt += stride
    return np.array(out)


def export_js(clf, scaler, classes, path, meta):
    model = {
        "type": "mlp",
        "classes": classes,
        "frame_features": FE.FRAME_FEATURES,
        "vel_features": FE.VEL_FEATURES,
        "window_sec": FE.WINDOW_SEC,
        "window_n": FE.WINDOW_N,
        "feature_names": FE.window_feature_names(),
        "mean": np.round(scaler.mean_, 6).tolist(),
        "scale": np.round(scaler.scale_, 6).tolist(),
        "layers": [
            {"W": np.round(W, 5).tolist(), "b": np.round(b, 5).tolist()}
            for W, b in zip(clf.coefs_, clf.intercepts_)
        ],
        "activation": clf.activation,
        "meta": meta,
    }
    with open(path, "w") as f:
        json.dump(model, f, separators=(",", ":"))
    print(f"exported {path} ({os.path.getsize(path) / 1024:.0f} KB)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n-seq", type=int, default=160, help="synthetic sequences per exercise")
    ap.add_argument("--real", default=None, help="folder with real pose recordings (.npz/.json)")
    ap.add_argument("--real-weight", type=float, default=4.0)
    ap.add_argument("--export-js", default=os.path.join(HERE, "..", "model.json"))
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    t0 = time.time()
    syn = synthetic_windows(args.n_seq, seed=args.seed)
    print(f"synthetic: {sum(len(w) for _, _, w in syn)} windows from {len(syn)} sequences in {time.time() - t0:.0f}s")
    classes = list(synth.EXERCISES)
    rng = np.random.default_rng(args.seed)

    groups = []
    for ex, gid, W in syn:
        groups.append((ex, f"syn{gid}", W, 1.0, "syn"))
    if args.real:
        n_real = 0
        for label, gid, W in load_real(args.real):
            if label in classes and len(W):
                groups.append((label, gid, W, args.real_weight, "real"))
                n_real += len(W)
        print(f"real: {n_real} windows")

    # split by sequence so near-identical windows never land on both sides
    test_mask = rng.random(len(groups)) < 0.2
    def stack(sel):
        Xs, ys, ws, src = [], [], [], []
        for (ex, gid, W, wt, s), m in zip(groups, sel):
            if m:
                Xs.append(W); ys += [classes.index(ex)] * len(W); ws += [wt] * len(W); src += [s] * len(W)
        return np.vstack(Xs), np.array(ys), np.array(ws), np.array(src)
    Xtr, ytr, wtr, _ = stack(~test_mask)
    Xte, yte, _, ste = stack(test_mask)

    scaler = StandardScaler().fit(Xtr)
    # MLPClassifier has no sample_weight: repeat weighted (real) rows instead
    rep = np.maximum(1, np.round(wtr)).astype(int)
    Xtr_r, ytr_r = np.repeat(Xtr, rep, 0), np.repeat(ytr, rep)
    clf = MLPClassifier(hidden_layer_sizes=(64, 32), alpha=1e-3, max_iter=300, early_stopping=True,
                        n_iter_no_change=12, random_state=args.seed)
    t0 = time.time()
    clf.fit(scaler.transform(Xtr_r), ytr_r)
    print(f"trained in {time.time() - t0:.0f}s, {clf.n_iter_} epochs")

    pred = clf.predict(scaler.transform(Xte))
    print(classification_report(yte, pred, target_names=classes, digits=3))
    cm = confusion_matrix(yte, pred, labels=range(len(classes)))
    print("confusion (rows = truth):")
    print("      " + " ".join(f"{c[:5]:>6}" for c in classes))
    for i, c in enumerate(classes):
        print(f"{c[:6]:>6} " + " ".join(f"{v:6d}" for v in cm[i]))
    acc = float((pred == yte).mean())
    meta = {"trained": time.strftime("%Y-%m-%d"), "test_accuracy": round(acc, 4),
            "synthetic_sequences_per_class": args.n_seq, "real_data": bool(args.real)}
    if args.real and (ste == "real").any():
        r = ste == "real"
        meta["real_test_accuracy"] = round(float((pred[r] == yte[r]).mean()), 4)
        print("accuracy on held-out REAL recordings:", meta["real_test_accuracy"])
    if args.export_js:
        export_js(clf, scaler, classes, args.export_js, meta)


if __name__ == "__main__":
    main()
