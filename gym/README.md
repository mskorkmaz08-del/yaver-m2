# CaliCoach: calisthenics form coach for your phone

Point your phone's camera at yourself and CaliCoach:

1. **recognises the exercise** (push-up, pike push-up, plank, pull-up, inverted row,
   dip, squat, lunge, hanging leg raise, or "not exercising");
2. **counts reps** and splits your workout into sets automatically;
3. **checks every rep's form** against published coaching standards (depth, lockout,
   hip sag, flared elbows, chin over bar, kipping, knees caving in, lean, tempo…), with
   a score, on-screen and spoken cues, and the faulty joints highlighted in red;
4. **saves everything** on the phone (every rep: angles, tempo, faults) and turns it
   into progress charts and **"what to do next"** recommendations: fix this fault with
   these drills, beat your best set by 1–2 reps, or move to a harder or easier variation.

It also **records every set as a 3D skeleton** (33 body points, about 20 frames/s, no
video: ~100 KB per set) that you can replay as a **3D model next to a perfect-form
"ghost"**, and **uploads the captures to your Supabase server** for analysis and training.

Live at **https://mskorkmaz08-del.github.io/yaver-m2/gym/** (part of Yaver Mark II;
Yaver Mark One reads the results, see below).

```
gym/            the app (static files)
gym/lab/        training data generator, model training, tests, video importers (Python + Node)
gym/supabase/   database + storage set-up for the server (schema.sql, README.md)
```

## 3D captures and perfect form

* Every set is saved as a 3D capture: joint positions in millimetres, how your body
  moved through the room (from the camera image), and joint visibility. Format details:
  `gym/capture.js`; read them in Python with `lab/capture_io.py`.
* After a workout (or from History) tap a rep, the chart or *Replay worst rep*: a 3D
  mannequin plays the rep. Drag to rotate, pinch to zoom, use Side / Front / 3/4 / Top.
  You get the key angle on the body, the movement path, faulty body parts in red, angle
  graphs that follow the playback, and a **you vs perfect form** table at the deepest
  point.
* The blue **ghost** is the perfect-form rep, rebuilt with *your* bone lengths, turned
  to face the same way, anchored at the same support point (feet or hands) and time-aligned
  to your rep. The comparison shows technique, not body size.
* References: `gym/reference/<exercise>.json`. Right now they're **generated textbook
  reps**. Replace them with your videos of good reps:
  `python lab/make_reference_from_video.py push_up good_pushups.mp4`. You can also
  tap *Use this rep as my perfect-form reference* on any rep in the app.

## Server (Supabase)

Follow [supabase/README.md](supabase/README.md) (about 10 minutes, free tier). Then in
Settings → Server, enter the project URL, the anon key and your email, and type the
6-digit code you receive. Saved workouts and their 3D captures upload automatically
(private to your account by row-level security). `lab/download_captures.py` pulls them
back for analysis.

## Put it on your phone

Open **https://mskorkmaz08-del.github.io/yaver-m2/gym/** in Safari, then **Share → Add
to Home Screen**. Open it, tap **Start**, allow the camera. The first start downloads the
MediaPipe pose model (~10 MB) from Google's CDN.

On a laptop, the CaliCoach button on Yaver Mark II's home screen (or saying "open the
gym") opens it.

## Yaver Mark One sees your training

Yaver (Mark One) reads CaliCoach's workouts: Body → *calisthenics · CaliCoach* card
(progress per exercise, form score trend, the next step), the weekly muscle map counts
CaliCoach sets, Insights flags recurring faults and when to progress, and the assistant
has a `get_calisthenics` tool for analysis and plans ("plan my next two weeks").

* **Every device:** connect both apps to the same Supabase project (supabase/README.md):
  CaliCoach → Settings → Server, and Yaver → Settings → CaliCoach, signed in with the same
  email.
* **Laptop, no server needed:** in the same browser (e.g. Chrome) Yaver reads CaliCoach's
  data directly, because both live on mskorkmaz08-del.github.io. iPhone Home Screen
  apps keep separate storage, so the iPhone needs the server.

## Using it

* **Phone placement:** 2–3 m away, whole body in the picture through the whole
  movement. **Side view** for push-ups, squats, dips, rows, lunges and leg raises;
  **front view** works for pull-ups and is needed to see knees caving in on squats.
  Keep the phone upright: body lines are judged against gravity.
* **Home:** pick *Auto-detect* or an exercise, front or back camera, voice on/off, then
  tap the big **Start** orb. *Analyse a video* runs a recording through the same
  pipeline; *Demo* plays generated workouts so you can see everything without a camera.
* **Set the phone down and train (hands-free):** after Start, Yaver checks the framing
  from the skeleton ("I can't see your feet", "Come a little closer"), waits until you
  stand still in view, counts down "3, 2, 1, go" and starts by itself. *Start now* skips
  the check. The camera picture stays hidden: the screen shows only your glowing
  skeleton, a huge rep number with a ring that follows each rep, the exercise and
  the time. Reps are counted out loud and form faults are spoken.
* **Rest is automatic:** a few seconds after your last rep the screen turns into a
  green rest timer (with a reminder at 1 and 2 minutes). Start the next set whenever
  you like: sets are split on their own. Walk out of view for 30 s and the workout
  finishes and saves itself (or tap ■). Tap the exercise name to lock or change it.
* **Report after the workout:** total reps, sets, exercises and time; a timeline of the
  whole workout (sets coloured by movement, every rep marked, rest gaps labelled);
  working vs resting time, rest between sets and **time between reps**; per exercise:
  reps, clean %, form, time per rep, time between reps, best set; per set: rest before,
  a rhythm strip (each rep as a block, seconds between them), the rep table and a 3D
  replay of any rep. If a set got the wrong exercise, fix it there: the app learns from
  the correction. The workout is already saved; *Discard* removes it.
* **Analytics:** all-time totals, reps per week, a card per exercise (records, form,
  time between reps, what to do next, progress charts, common faults) and every
  workout's report.
* **Settings → Teach it your form:** record 20 s of an exercise, or of you just moving
  around. Recognition adapts to your body and camera right away. Do this once per
  exercise you use: it's the single best way to make detection reliable for you.
* **Backups:** *Export backup* (JSON) and *Export reps (CSV)* for your own analysis in
  pandas or Excel.

## How good is it?

Tested on generated workouts it had never seen (see `lab/README.md`):

* Exercise recognition: 99% of 2-second windows; nearly every set recognised.
* Rep counting: about 94% of reps. Reps that move less than ~20° aren't counted on
  purpose, so fidgeting isn't counted either.
* Form faults: depth, lockout, hip sag/pike, chin-over-bar, kipping and lean are
  detected reliably. Elbow flare and knee valgus are harder, because they depend on
  depth, which a single camera estimates poorly. Knee valgus is only judged from the
  front.

**Be honest with yourself about the limits:** the base model learned from *generated*
motion, because calisthenics pose datasets can't be downloaded and redistributed
freely. Real video is messier, so expect some mistakes at first. Teach mode, set
corrections and `lab/import_videos.py` (real labelled videos, e.g. the Kaggle
Workout/Exercises Video dataset) are there to close that gap. CaliCoach is a training
aid, not medical advice.

## How it works (short)

MediaPipe Pose (33 3D landmarks) → joint angles and body orientation per frame →
2-second windows → a small neural network (trained in `lab/`, exported to
`gym/model.json`, run in plain JavaScript) plus your personal examples → a rep tracker
per exercise (key angle with hysteresis and a posture gate) → per-rep form checks →
IndexedDB → charts and recommendations. Details and thresholds:
`lab/README.md` and `lab/FORM_STANDARDS.md`.
