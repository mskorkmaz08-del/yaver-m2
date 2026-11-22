# CaliCoach lab: data, training and tests

This folder trains the exercise recogniser that the phone app uses and tests the app's
rep counter and form checks. Everything runs on a laptop with Python 3.10+ and Node 18+.

```
pip install numpy scikit-learn            # training
pip install mediapipe opencv-python       # only for import_videos.py
```

## How the system works

```
camera frame ─► MediaPipe Pose (33 3D "world" landmarks, metres, per frame)
             ─► frame features: joint angles, body angle to gravity, hand/foot heights …
             ─► 2-second window (resampled to 24 steps): mean / std / min / max + speeds
             ─► small neural network (77 → 64 → 32 → 10 classes)  ─► which exercise
             ─► rep tracker for that exercise (key angle, hysteresis, posture gate)
             ─► per-rep form checks against coaching standards ─► score, cues, history
```

The same feature code exists twice: `features.py` (training) and `../engine.js` (the app).
`test_engine.mjs` checks they agree to 1e-12.

## Where the training data comes from

Raw pose datasets for calisthenics can't be downloaded and redistributed freely, so the
base model is trained on **biomechanically generated** motion (`synth.py`):

* random body proportions (1.50–1.98 m), 10 classes: push-up, pike push-up, plank,
  pull-up, inverted row, dip, squat, lunge, hanging leg raise, and "idle" (standing,
  walking, stretching, sitting, lying, bending);
* contact points stay fixed (hands on the floor or bar, feet on the floor) and limbs are
  solved with inverse kinematics, so the joint angles are physically consistent;
* every exercise is parameterised by the angles coaches use (e.g. push-up elbows ~90°
  at the bottom), and each sequence draws either good form or real faults: half reps
  (bottom at 110–130°), no lockout, sagging/piked hips, flared elbows, kipping, knees
  caving in, swinging, too much lean, rushed tempo;
* the camera is random (any side, tilted up to ~25° as when the phone is propped on the
  floor), and MediaPipe-like noise is added: jitter, drift, a noisier far side of the
  body, weak depth, glitch frames.

The faults are the ground truth for testing the form checks. Thresholds and sources are
in [FORM_STANDARDS.md](FORM_STANDARDS.md).

**Real data makes it better.** Two ways in:

1. **Your own recordings**: the app's *Settings → Teach it your form* records labelled
   clips; *Export training clips* saves them as JSON. They also adapt the app at once
   (nearest-neighbour layer on top of the network), even without retraining.
2. **Public video datasets**: `import_videos.py` runs MediaPipe over folders of
   labelled videos, e.g. the Kaggle *Workout/Exercises Video* dataset (22 folders incl.
   push-up, pull Up, squat, tricep dips, plank).

```
python import_videos.py ~/datasets/workout-videos data/poses --others-as-idle
python train.py --real data/poses --real-weight 4
python train.py --real data/poses --real ../my-clips      # (one --real folder per run; merge folders if needed)
```

`train.py` prints accuracy on held-out *real* recordings separately: that number is the
honest one.

## Commands

| | |
|---|---|
| `python synth.py` | generate one sequence per exercise (smoke test) |
| `python train.py --n-seq 160` | train on generated data, write `../model.json` (~2–10 min) |
| `python export_tests.py /tmp/tests.json [noise]` | 30 test workouts per exercise with ground truth |
| `node test_engine.mjs /tmp/tests.json ../model.json [--forced]` | recognition, rep counting, fault detection, false reps |
| `python make_references.py` | rebuild the generated perfect-form references (`../reference/`) |
| `python make_reference_from_video.py <exercise> <video>` | real perfect-form reference from your video (best-scoring rep) |
| `python download_captures.py <out>` | download all 3D captures from Supabase (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`) |
| `python make_demo.py` | rebuild the app's Demo workout (`../demo.json`) |

## Results at the time of writing (generated test data, unseen seeds)

* Recognition: 99.3% of 2-second windows; 29–30 of 30 sets recognised per exercise.
* Rep counting: about 94% of reps (exact count in ~88% of sets). Misses are almost all
  "pulse" reps that move less than ~20° (half range *and* no lockout at once).
* At 1.7× the noise: recognition still 97%, about 92% of reps counted.
* Continuous workouts (3 exercises with rests in between): 10 of 12 split into the
  right sets.

Generated data is cleaner than real video. Expect lower numbers on real footage until
real clips are added, which is why the app has Teach mode and per-set corrections.

## Ideas for next steps

* Validate the form checks on real labelled form: the Mendeley "Multi-View Raw Video
  Dataset of Seven Fitness Exercises with Good/Bad Form Labels" has push-ups and
  bodyweight squats from several views.
* A temporal model (1D-CNN or GRU over the 24-step window) instead of summary stats.
* Larger action datasets for the idle class (QEVD-FIT-300K, InfiniteRep).
* More exercises: burpees, muscle-ups, L-sit holds, glute bridges, pistol squats.
