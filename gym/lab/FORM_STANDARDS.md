# Form standards used by CaliCoach

Angles are joint angles from MediaPipe world landmarks (180° = straight). Thresholds
leave ~10° of room for pose-estimation error. "Major" faults make a rep not clean.

| Exercise | Rep signal | Check | Threshold | Major |
|---|---|---|---|---|
| Push-up | elbow | depth: lowest elbow angle | > 100° = partial | yes |
| | | lockout at top | < 150° | yes |
| | | hips sag / pike (hip distance from shoulder–ankle line, in torso lengths) | < −0.12 / > +0.14 | no |
| | | elbow flare (upper arm vs torso at the bottom) | > 63° | no |
| | | lowering time | < 0.55 s | no |
| Pike push-up | elbow | depth / lockout | > 105° / < 155° | yes |
| | | hips high (shoulder–hip–knee) | > 112° = hips low | no |
| Plank | hold | body line, hip sag / pike | −0.12 / +0.15 | – |
| Pull-up | elbow | chin over bar (nose above wrists) | nose below wrists | yes |
| | | dead hang at the bottom | < 143° | yes |
| | | kipping (leg / torso swing range) | > 30° | no |
| Inverted row | elbow | chest to bar / start from straight arms | > 105° / < 150° | yes |
| | | hips sag | < −0.11 | no |
| Dip | elbow | depth / lockout | > 105° / < 150° | yes |
| | | forward lean at the bottom | > 45° | no |
| | | swinging (hip angle range) | > 28° | no |
| | | very deep (note only) | < 65° | – |
| Squat | knee | depth: knee > 105° and hips above knees | partial | yes |
| | | stand up fully | < 158° | yes |
| | | forward lean at the bottom | > 50° | no |
| | | knees caving in (front view only): knee gap / ankle gap | < 0.82 | no |
| Lunge | front knee | depth | > 108° | yes |
| | | torso lean | > 26° | no |
| Hanging leg raise | hip | legs to horizontal | > 108° | yes |
| | | bent knees (= knee raise) | < 135° | no |
| | | swinging (torso range) | > 22° | no |

Each rep must also pass a **posture gate** (e.g. push-ups: body roughly horizontal and
facing the floor; pull-ups: hands above the head), so fidgeting isn't counted.

## Sources

* NASM, *Proper push-up form and technique* — straight body line, alignment checkpoints.
* CrossFit, *The lowly push-up revisited* — upper arms ~45° from the body, not flared.
* MasterClass, *Push-up form guide* — lower until the upper arms are level with the
  back, elbows ~45°.
* US Marine Corps, *Pull-up training guide* — chin all the way over the bar, lock out at
  the bottom.
* StrongLifts, *Pull-ups* and *Dips* — full range, shoulders below elbows on dips.
* Garage Gym Reviews and Bodybuilding.com, *Dips* — lower to ~90° elbows, upright torso,
  no swinging; elitefts advises against going far below 90°.
* NASM, *Biomechanics of the squat* — knee valgus and excessive forward lean as the
  main compensations; Gymshark / Les Mills — thighs parallel, knees ~90°, knees in line
  with the toes.
