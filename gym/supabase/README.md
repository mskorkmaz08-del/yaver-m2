# Supabase set-up for CaliCoach (about 10 minutes, free tier)

The app uploads **3D skeleton captures** (33 body points per frame, about 100 KB per set,
never video) and workout summaries to your own Supabase project.

1. **Create a project** at [supabase.com](https://supabase.com) → New project (free plan
   is fine). Pick a region near you and save the database password somewhere.
2. **Create the tables and storage:** dashboard → *SQL Editor* → *New query* → paste
   [`schema.sql`](schema.sql) → *Run*.
3. **Allow email codes:** *Authentication → Sign In / Providers → Email*: enabled (default).
   Then *Authentication → Emails → Magic Link* template: add a line with the code, e.g.
   `<p>Your CaliCoach code: <b>{{ .Token }}</b></p>`.
   The code matters on iPhone: an app installed on the Home Screen can't receive magic
   links (they open in Safari), but you can type the code.
4. **Allow the app's address:** *Authentication → URL Configuration*: set *Site URL* to the
   app's address (e.g. `https://mskorkmaz08-del.github.io/yaver-m2/gym/`) and add it to
   *Redirect URLs*.
5. **Connect the app:** dashboard → *Project Settings → API*: copy the *Project URL* and
   the *anon public* key into CaliCoach → Settings → Server. Enter your email, tap
   *Email me a sign-in code*, type the code.

From then on every saved workout uploads automatically (toggle in Settings), and
*Upload now* sends anything that was recorded offline.

The anon key is designed to be public: with row-level security on (step 2) it only
lets a signed-in user touch their own rows and files. **Never** put the `service_role`
key in the app; use it only on your laptop for analysis (below).

## Getting the data back for analysis

```
pip install requests numpy
export SUPABASE_URL=https://xxxx.supabase.co
export SUPABASE_SERVICE_KEY=...    # Project Settings -> API -> service_role (keep secret)
python ../lab/download_captures.py data/server   # every capture as .json.gz + an index.csv
```

`lab/capture_io.py` loads a capture into numpy: `world (T, 33, 3)` metres,
`root (T, 3)`, `vis (T, 33)`, `t (T,)`, plus the reps with their scores and faults.
