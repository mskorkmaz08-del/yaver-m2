"""
Download every CaliCoach capture from Supabase for analysis / training.

    SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python download_captures.py data/server [--exercise push_up]

Writes <out>/<exercise>/<capture id>.json.gz and <out>/index.csv.
Load one with: capture_io.decode(open(path, "rb").read())
"""
import argparse, csv, os, sys
import requests


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--exercise")
    args = ap.parse_args()
    url, key = os.environ.get("SUPABASE_URL", "").rstrip("/"), os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY")
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    q = f"{url}/rest/v1/captures?select=*&order=recorded_at.asc"
    if args.exercise:
        q += f"&exercise=eq.{args.exercise}"
    rows = requests.get(q, headers=h, timeout=60).json()
    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, "index.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["id", "exercise", "recorded_at", "frames", "fps", "reps", "clean_reps", "score", "file"])
        for r in rows:
            dest = os.path.join(args.out, r["exercise"], f"{r['id']}.json.gz")
            if not os.path.exists(dest):
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                resp = requests.get(f"{url}/storage/v1/object/captures/{r['file_path']}", headers=h, timeout=120)
                resp.raise_for_status()
                open(dest, "wb").write(resp.content)
            w.writerow([r["id"], r["exercise"], r["recorded_at"], r["frames"], r["fps"], r["reps"], r["clean_reps"], r["score"], dest])
    print(f"{len(rows)} captures in {args.out}")


if __name__ == "__main__":
    main()
