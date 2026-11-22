"""
Pose features shared by training (Python) and the phone app (JavaScript,
app/engine.js).  Both implementations must stay identical: test_parity.py
checks them against each other.

All features use MediaPipe *world* landmarks (metres, hip-centred, y down),
so they do not depend on where the person stands in the picture.  Angles are
joint angles (viewpoint-independent) or angles to gravity (camera assumed
roughly upright), which makes the features work from the side or the front.
"""
from __future__ import annotations

import numpy as np

UP = np.array([0.0, -1.0, 0.0])
FRAME_FEATURES = [
    "elbow", "shoulder", "hip", "knee", "knee_min", "knee_max", "torso_incl",
    "chest_up", "wrist_sh", "wrist_hip", "ankle_hip", "body_line", "nose_wrist",
    "wrist_ankle", "legs_incl", "stride", "wrist_sep", "knee_diff",
]
WINDOW_SEC = 2.0
WINDOW_N = 24
VEL_FEATURES = ["elbow", "knee", "hip", "torso_incl", "body_line"]


def _ang(a, b, c):
    ba, bc = a - b, c - b
    cos = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-9)
    return float(np.degrees(np.arccos(np.clip(cos, -1.0, 1.0))))


def _ang_vec(u, v):
    cos = np.dot(u, v) / (np.linalg.norm(u) * np.linalg.norm(v) + 1e-9)
    return float(np.degrees(np.arccos(np.clip(cos, -1.0, 1.0))))


def frame_metrics(w, vis=None):
    """Per-frame metrics dict (used by the classifier and the form checks)."""
    if vis is None:
        vis = np.ones(33)
    ls, rs, le, re, lw, rw = w[11], w[12], w[13], w[14], w[15], w[16]
    lh, rh, lk, rk, la, ra = w[23], w[24], w[25], w[26], w[27], w[28]
    nose = w[0]
    vl = float(vis[[11, 13, 15, 23, 25, 27]].mean()) + 0.05
    vr = float(vis[[12, 14, 16, 24, 26, 28]].mean()) + 0.05
    mix = lambda a, b: (a * vl + b * vr) / (vl + vr)
    sc, hc = (ls + rs) / 2, (lh + rh) / 2
    wc, ac = (lw + rw) / 2, (la + ra) / 2
    torso = sc - hc
    tl = float(np.linalg.norm(torso)) + 1e-6
    m = {}
    m["elbow_l"], m["elbow_r"] = _ang(ls, le, lw), _ang(rs, re, rw)
    m["shoulder_l"], m["shoulder_r"] = _ang(lh, ls, le), _ang(rh, rs, re)
    m["hip_l"], m["hip_r"] = _ang(ls, lh, lk), _ang(rs, rh, rk)
    m["knee_l"], m["knee_r"] = _ang(lh, lk, la), _ang(rh, rk, ra)
    m["elbow"] = mix(m["elbow_l"], m["elbow_r"])
    m["shoulder"] = mix(m["shoulder_l"], m["shoulder_r"])
    m["hip"] = mix(m["hip_l"], m["hip_r"])
    m["knee"] = mix(m["knee_l"], m["knee_r"])
    m["knee_min"] = min(m["knee_l"], m["knee_r"])
    m["knee_max"] = max(m["knee_l"], m["knee_r"])
    m["knee_diff"] = abs(m["knee_l"] - m["knee_r"])
    m["torso_incl"] = _ang_vec(torso, UP)
    chest = np.cross(ls - rs, torso)
    m["chest_up"] = float(np.dot(chest, UP) / (np.linalg.norm(chest) + 1e-9))
    m["wrist_sh"] = float(np.dot(wc - sc, UP)) / tl
    m["wrist_hip"] = float(np.dot(wc - hc, UP)) / tl
    m["ankle_hip"] = float(np.dot(ac - hc, UP)) / tl
    m["body_line"] = _ang(sc, hc, ac)
    m["nose_wrist"] = float(np.dot(nose - wc, UP)) / tl
    m["wrist_ankle"] = float(np.dot(wc - ac, UP)) / tl
    m["legs_incl"] = _ang_vec(ac - hc, -UP)
    d = la - ra
    d = d - np.dot(d, UP) * UP
    m["stride"] = float(np.linalg.norm(d)) / tl
    m["wrist_sep"] = float(np.linalg.norm(lw - rw)) / tl
    # --- extra metrics for form checks (not classifier inputs)
    m["torso_len"] = tl
    # signed hip offset from the shoulder-ankle line, + = hips above the line (pike)
    line = ac - sc
    t = np.dot(hc - sc, line) / (np.dot(line, line) + 1e-9)
    closest = sc + t * line
    off = hc - closest
    m["hip_dev"] = float(np.dot(off, UP)) / tl
    m["hip_dev_abs"] = float(np.linalg.norm(off)) / tl
    m["nose_up"] = float(np.dot(nose - sc, UP)) / tl
    m["shoulder_vs_elbow"] = float(np.dot(sc - (le + re) / 2, UP)) / tl  # < 0: shoulders below elbows
    m["hip_vs_knee"] = float(np.dot(hc - (lk + rk) / 2, UP)) / tl       # < 0: hips below knees
    hw = float(np.linalg.norm(lh - rh)) + 1e-6
    m["knee_sep"] = float(np.linalg.norm((lk - rk) - np.dot(lk - rk, UP) * UP)) / hw
    m["ankle_sep"] = float(np.linalg.norm((la - ra) - np.dot(la - ra, UP) * UP)) / hw
    # how front-on the camera is: shoulder line across the image (x) vs depth (z)
    sv = ls - rs
    m["frontal"] = float(abs(sv[0]) / (np.linalg.norm(sv[[0, 2]]) + 1e-9))
    # elbow flare: upper arm vs torso midline, in the torso plane
    up_t = torso / tl
    lat = (ls - rs) / (np.linalg.norm(ls - rs) + 1e-9)
    fl = []
    for s_, e_ in ((ls, le), (rs, re)):
        u = e_ - s_
        a = float(np.dot(u, -up_t))
        b = abs(float(np.dot(u, lat)))
        fl.append(float(np.degrees(np.arctan2(b, max(a, 1e-6)))))
    m["flare"] = mix(fl[0], fl[1])
    # front leg in a lunge: the knee that is higher (the back knee drops toward the floor)
    m["knee_front"] = m["knee_l"] if np.dot(lk, UP) >= np.dot(rk, UP) else m["knee_r"]
    return m


def frame_vector(m):
    return np.array([m[k] for k in FRAME_FEATURES], dtype=np.float64)


def resample(times, X, t_end, sec=WINDOW_SEC, n=WINDOW_N):
    """Linear resampling of the rows of X (taken at `times`) onto n points over the last `sec` seconds."""
    grid = np.linspace(t_end - sec, t_end, n)
    out = np.empty((n, X.shape[1]))
    for j in range(X.shape[1]):
        out[:, j] = np.interp(grid, times, X[:, j])
    return out


def window_features(R, sec=WINDOW_SEC):
    """R: (n, n_frame_features) resampled window -> 1D feature vector."""
    feats = [R.mean(0), R.std(0), R.min(0), R.max(0)]
    dt = sec / (R.shape[0] - 1)
    vel = []
    for k in VEL_FEATURES:
        j = FRAME_FEATURES.index(k)
        vel.append(np.abs(np.diff(R[:, j])).mean() / dt / 100.0)
    return np.concatenate(feats + [np.array(vel)])


def window_feature_names():
    names = []
    for stat in ("mean", "std", "min", "max"):
        names += [f"{k}_{stat}" for k in FRAME_FEATURES]
    names += [f"{k}_vel" for k in VEL_FEATURES]
    return names


def sequence_frame_matrix(world, vis=None):
    return np.stack([frame_vector(frame_metrics(world[i], None if vis is None else vis[i])) for i in range(len(world))])


def sequence_windows(X, fps, stride_sec=0.25, sec=WINDOW_SEC, rng=None):
    """Windows over a whole sequence (X = per-frame feature matrix)."""
    T = len(X)
    times = np.arange(T) / fps
    out = []
    t = sec
    while t <= times[-1] + 1e-9:
        s = sec if rng is None else float(rng.uniform(0.85, 1.15)) * sec
        if t - s >= -1e-9:
            R = resample(times, X, t, sec=s)
            out.append(window_features(R, sec=s))
        t += stride_sec
    return np.array(out)
