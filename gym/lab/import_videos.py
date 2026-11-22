"""
Turn labelled exercise videos into pose recordings for training.

    python import_videos.py VIDEO_ROOT data/poses [--others-as-idle] [--model full]

VIDEO_ROOT has one folder per exercise (any of the names below), e.g. the
Kaggle "Workout/Exercises Video" dataset:
    workout-videos/push-up/*.mp4, pull Up/*.mp4, squat/*.mp4, tricep dips/*.mp4, plank/*.mp4 ...
Folders that are not calisthenics (bench press, curls...) are skipped, or used
as "idle" negatives with --others-as-idle (helps against false detections).

Each video becomes data/poses/<label>/<name>.npz with MediaPipe world
landmarks per frame (NaN where nobody was found).  Then:
    python train.py --real data/poses

Needs: pip install mediapipe opencv-python numpy (the pose model downloads once).
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import urllib.request

import numpy as np

ALIASES = {
    "push_up": ["push up", "push-up", "pushup", "push ups", "pushups", "push_up"],
    "pike_push_up": ["pike push up", "pike push-up", "pike pushup", "pike_push_up"],
    "plank": ["plank", "planks", "forearm plank", "high plank"],
    "pull_up": ["pull up", "pull-up", "pullup", "pull ups", "pullups", "chin up", "chin-up", "chinup", "pull_up"],
    "inverted_row": ["inverted row", "australian pull up", "australian row", "body row", "inverted_row"],
    "dip": ["dip", "dips", "tricep dips", "triceps dips", "parallel bar dips", "bar dips"],
    "squat": ["squat", "squats", "air squat", "bodyweight squat"],
    "lunge": ["lunge", "lunges", "split squat", "split squats"],
    "hanging_leg_raise": ["hanging leg raise", "hanging leg raises", "hanging_leg_raise"],
    "idle": ["idle", "rest", "not exercising", "walking", "standing"],
}
MODEL_URLS = {
    "lite": "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
    "full": "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
    "heavy": "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task",
}
VIDEO_EXT = (".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v")


def label_for(folder: str):
    f = re.sub(r"[_\-]+", " ", folder.lower()).strip()
    for label, names in ALIASES.items():
        if f in [re.sub(r"[_\-]+", " ", n) for n in names]:
            return label
    return None


def ensure_model(kind: str, folder: str) -> str:
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"pose_landmarker_{kind}.task")
    if not os.path.exists(path):
        print("downloading", MODEL_URLS[kind])
        urllib.request.urlretrieve(MODEL_URLS[kind], path)
    return path


def extract(video_path: str, model_path: str, max_side=960, return_image=False):
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python as mpt
    from mediapipe.tasks.python import vision

    opts = vision.PoseLandmarkerOptions(
        base_options=mpt.BaseOptions(model_asset_path=model_path),
        running_mode=vision.RunningMode.VIDEO, num_poses=1,
        min_pose_detection_confidence=0.5, min_pose_presence_confidence=0.5, min_tracking_confidence=0.5,
    )
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if fps < 5 or fps > 240:
        fps = 30.0
    world, vis, img = [], [], []
    size = None
    with vision.PoseLandmarker.create_from_options(opts) as lm:
        i = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            h, w = frame.shape[:2]
            s = max_side / max(h, w)
            if s < 1:
                frame = cv2.resize(frame, (int(w * s), int(h * s)))
            size = (frame.shape[1], frame.shape[0])
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            res = lm.detect_for_video(img, int(i * 1000 / fps))
            if res.pose_world_landmarks:
                world.append([[p.x, p.y, p.z] for p in res.pose_world_landmarks[0]])
                vis.append([p.visibility if p.visibility is not None else 1.0 for p in res.pose_landmarks[0]])
                img.append([[p.x, p.y] for p in res.pose_landmarks[0]])
            else:
                world.append([[np.nan] * 3] * 33)
                vis.append([0.0] * 33)
                img.append([[np.nan] * 2] * 33)
            i += 1
    cap.release()
    if return_image:
        return np.array(world, dtype=np.float32), np.array(vis, dtype=np.float32), float(fps), np.array(img, dtype=np.float32), size
    return np.array(world, dtype=np.float32), np.array(vis, dtype=np.float32), float(fps)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video_root")
    ap.add_argument("out_dir")
    ap.add_argument("--others-as-idle", action="store_true", help="use non-calisthenics folders as 'idle' negatives")
    ap.add_argument("--model", default="full", choices=list(MODEL_URLS))
    ap.add_argument("--max-per-class", type=int, default=0, help="limit videos per class (0 = all)")
    args = ap.parse_args()

    model_path = ensure_model(args.model, os.path.join(os.path.dirname(os.path.abspath(__file__)), "models"))
    counts = {}
    for folder in sorted(os.listdir(args.video_root)):
        full = os.path.join(args.video_root, folder)
        if not os.path.isdir(full):
            continue
        label = label_for(folder) or ("idle" if args.others_as_idle else None)
        if not label:
            print(f"skip folder '{folder}' (not a supported exercise)")
            continue
        for name in sorted(os.listdir(full)):
            if not name.lower().endswith(VIDEO_EXT):
                continue
            if args.max_per_class and counts.get(label, 0) >= args.max_per_class:
                break
            out = os.path.join(args.out_dir, label, os.path.splitext(f"{folder}__{name}")[0] + ".npz")
            if os.path.exists(out):
                counts[label] = counts.get(label, 0) + 1
                continue
            try:
                world, vis, fps = extract(os.path.join(full, name), model_path)
            except Exception as e:  # unreadable video
                print("  failed", name, e, file=sys.stderr)
                continue
            found = float((~np.isnan(world[:, 0, 0])).mean()) if len(world) else 0
            if found < 0.5:
                print(f"  {name}: person found in only {found:.0%} of frames, skipped")
                continue
            os.makedirs(os.path.dirname(out), exist_ok=True)
            np.savez_compressed(out, world=world, vis=vis, fps=fps, label=label, source=os.path.join(folder, name))
            counts[label] = counts.get(label, 0) + 1
            print(f"  {label:18s} {name} ({len(world)} frames, pose in {found:.0%})")
    print("done:", counts)


if __name__ == "__main__":
    main()
