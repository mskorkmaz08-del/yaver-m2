"""Read/write CaliCoach 3D captures (the app's skeleton recording format) in Python."""
import base64, gzip, json
import numpy as np

FORMAT = "calicoach-capture-1"


def encode(world_m, t, root_m=None, vis=None, **meta):
    """world_m: (T,33,3) metres, MediaPipe world convention; t: (T,) seconds."""
    T = len(world_m)
    w = np.clip(np.round(np.asarray(world_m) * 1000), -32767, 32767).astype("<i2")
    r = np.zeros((T, 3), "<i2") if root_m is None else np.clip(np.round((np.asarray(root_m) - np.asarray(root_m)[0]) * 1000), -32767, 32767).astype("<i2")
    v = np.full((T, 33), 100, np.uint8) if vis is None else np.clip(np.round(np.asarray(vis) * 100), 0, 100).astype(np.uint8)
    tt = (np.asarray(t, dtype=np.float64) - t[0]).astype("<f4")
    b = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
    return {"format": FORMAT, **meta, "frames": int(T), "fps": round(float((T - 1) / max(1e-6, tt[-1])), 1),
            "t_b64": b(tt), "world_b64": b(w), "root_b64": b(r), "vis_b64": b(v)}


def decode(d):
    """Returns dict with numpy arrays: world (T,33,3) m, root (T,3) m, vis (T,33) 0-1, t (T,)."""
    if isinstance(d, (bytes, bytearray)):
        d = json.loads(gzip.decompress(d) if d[:2] == b"\x1f\x8b" else d)
    T = d["frames"]
    a = lambda k, dt: np.frombuffer(base64.b64decode(d[k]), dtype=dt)
    out = {k: v for k, v in d.items() if not k.endswith("_b64")}
    out["t"] = a("t_b64", "<f4").astype(float)
    out["world"] = a("world_b64", "<i2").reshape(T, 33, 3) / 1000.0
    out["root"] = a("root_b64", "<i2").reshape(T, 3) / 1000.0
    out["vis"] = a("vis_b64", np.uint8).reshape(T, 33) / 100.0
    return out
