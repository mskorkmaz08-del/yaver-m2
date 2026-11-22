"""Export synthetic test workouts (with ground truth) for the JS engine tests."""
import json, sys
import numpy as np
import synth, features as FE

def main(out, n_per=30, seed=777, noise=1.0):
    rng = np.random.default_rng(seed)
    seqs = []
    for ex in synth.EXERCISES:
        for k in range(n_per):
            s = synth.generate(ex, rng, noise=noise, p_fault=0.6)
            s.world = np.round(s.world.astype(np.float64), 4)
            fm = [FE.frame_metrics(s.world[i]) for i in (0, len(s.world) // 2)]
            seqs.append({
                "exercise": ex, "fps": s.fps, "reps": len(s.rep_bounds), "bounds": s.rep_bounds, "faults": sorted(s.faults),
                "world": np.round(s.world, 4).tolist(),
                "parity": [{k: float(v) for k, v in m.items()} for m in fm],
            })
    json.dump({"sequences": seqs}, open(out, "w"))
    print("wrote", out, len(seqs), "sequences")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/tests.json",
         noise=float(sys.argv[2]) if len(sys.argv) > 2 else 1.0)
