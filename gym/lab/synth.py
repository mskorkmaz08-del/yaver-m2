"""
Synthetic calisthenics pose generator.

Builds 3D skeletons (the 33 MediaPipe Pose landmarks) for each exercise from a
simple biomechanical model: random body proportions, fixed contact points
(hands on the floor or a bar, feet on the floor), inverse kinematics for the
limbs, and a rep "phase" p in [0, 1] (0 = start position, 1 = end of the
working range).  Each sequence also draws a *form profile* - either good form
or one or more of the classic faults coaches look for (sagging hips, half
reps, flared elbows, kipping, knees caving in, ...) - so the same generator
feeds both the exercise classifier and the tests of the form analyser.

The thresholds come from published coaching standards (NASM, StrongLifts,
the US Marine Corps pull-up guide and others - see FORM_STANDARDS.md).

Coordinates while building: x = the person's left (when they face +z),
y = up, z = forward, floor at y = 0, metres.  Output is converted to the
MediaPipe world-landmark convention (x right, y DOWN, z away from camera,
origin at the hip centre) after a random camera yaw/pitch/roll.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

EXERCISES = [
    "push_up", "pike_push_up", "plank", "pull_up", "inverted_row",
    "dip", "squat", "lunge", "hanging_leg_raise", "idle",
]

# ---------------------------------------------------------------- helpers

def unit(v):
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else v


def ik(a, c, l1, l2, pole):
    """Two-bone IK: joint between root a and end c, bending toward `pole`."""
    d_vec = c - a
    d = np.linalg.norm(d_vec)
    u = d_vec / max(d, 1e-9)
    if d >= l1 + l2 - 1e-6:  # fully extended (clamp)
        return a + u * l1
    d = max(d, abs(l1 - l2) + 1e-4)
    along = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    h = math.sqrt(max(l1 * l1 - along * along, 0.0))
    p = pole - np.dot(pole, u) * u
    p = unit(p) if np.linalg.norm(p) > 1e-6 else unit(np.cross(u, [1.0, 0, 0]))
    return a + u * along + p * h


def dir_zy(theta_deg):
    """Unit vector in the sagittal plane: angle from +z toward +y."""
    t = math.radians(theta_deg)
    return np.array([0.0, math.sin(t), math.cos(t)])


def smoothstep(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def lerp(a, b, t):
    return a + (b - a) * t


@dataclass
class Body:
    H: float
    sw: float      # shoulder width (landmark to landmark)
    hw: float      # hip width
    torso: float   # hip centre -> shoulder centre
    ua: float      # upper arm
    fa: float      # forearm (elbow -> wrist)
    thigh: float
    shin: float
    ankle_h: float
    neck: float    # shoulder centre -> head centre

    @staticmethod
    def random(rng):
        H = rng.uniform(1.50, 1.98)
        j = lambda: rng.uniform(0.93, 1.07)
        return Body(
            H=H, sw=0.215 * H * j(), hw=0.15 * H * j(), torso=0.29 * H * j(),
            ua=0.172 * H * j(), fa=0.152 * H * j(), thigh=0.245 * H * j(),
            shin=0.245 * H * j(), ankle_h=0.045 * H, neck=0.115 * H * j(),
        )

    @property
    def arm(self):
        return self.ua + self.fa

    @property
    def leg(self):
        return self.thigh + self.shin


def arm_span(b: Body, elbow_deg):
    """Shoulder-to-wrist distance for a given elbow angle."""
    e = math.radians(elbow_deg)
    return math.sqrt(b.ua ** 2 + b.fa ** 2 - 2 * b.ua * b.fa * math.cos(e))


def bisect(f, lo, hi, it=40):
    flo = f(lo)
    for _ in range(it):
        mid = (lo + hi) / 2
        fm = f(mid)
        if (fm > 0) == (flo > 0):
            lo, flo = mid, fm
        else:
            hi = mid
    return (lo + hi) / 2


# ------------------------------------------------------- skeleton assembly

class Pose(dict):
    """Named 3D joints in the build frame."""


def torso_frame(hc, sc, chest_hint):
    up_t = unit(sc - hc)
    chest = chest_hint - np.dot(chest_hint, up_t) * up_t
    chest = unit(chest)
    lat = unit(np.cross(up_t, chest))  # person's left
    return up_t, chest, lat


def place_trunk(b: Body, hc, sc, chest_hint, head_nod=0.0):
    up_t, chest, lat = torso_frame(hc, sc, chest_hint)
    P = Pose()
    P["hc"], P["sc"] = hc, sc
    P["up_t"], P["chest"], P["lat"] = up_t, chest, lat
    P["ls"], P["rs"] = sc + lat * b.sw / 2, sc - lat * b.sw / 2
    P["lh"], P["rh"] = hc + lat * b.hw / 2, hc - lat * b.hw / 2
    # head: neck continues the torso, optionally nodded toward the chest
    hdir = unit(up_t * math.cos(head_nod) + chest * math.sin(head_nod))
    P["head"] = sc + hdir * b.neck
    return P


def finish_landmarks(P: Pose, b: Body, foot_fwd_l, foot_fwd_r, hand_dir_l, hand_dir_r):
    """Fill the 33 MediaPipe landmarks from the main joints."""
    up_t, chest, lat = P["up_t"], P["chest"], P["lat"]
    head = P["head"]
    hdir = unit(head - P["sc"])
    face = unit(chest - np.dot(chest, hdir) * hdir)
    s = b.H / 1.75
    nose = head + face * 0.095 * s
    out = np.zeros((33, 3))
    out[0] = nose
    eye_c = nose + hdir * 0.035 * s - face * 0.012 * s
    out[1] = eye_c + lat * 0.018 * s
    out[2] = eye_c + lat * 0.032 * s
    out[3] = eye_c + lat * 0.045 * s
    out[4] = eye_c - lat * 0.018 * s
    out[5] = eye_c - lat * 0.032 * s
    out[6] = eye_c - lat * 0.045 * s
    out[7] = head + lat * 0.075 * s - face * 0.01 * s
    out[8] = head - lat * 0.075 * s - face * 0.01 * s
    mouth = nose - hdir * 0.035 * s - face * 0.01 * s
    out[9] = mouth + lat * 0.025 * s
    out[10] = mouth - lat * 0.025 * s
    out[11], out[12] = P["ls"], P["rs"]
    out[13], out[14] = P["le"], P["re"]
    out[15], out[16] = P["lw"], P["rw"]
    for side, (w, hd, idx) in enumerate([(P["lw"], hand_dir_l, (17, 19, 21)), (P["rw"], hand_dir_r, (18, 20, 22))]):
        sgn = 1 if side == 0 else -1
        hd = unit(hd)
        side_v = unit(np.cross(hd, up_t)) if np.linalg.norm(np.cross(hd, up_t)) > 1e-3 else lat
        out[idx[0]] = w + hd * 0.075 * s + side_v * 0.025 * s * sgn  # pinky
        out[idx[1]] = w + hd * 0.09 * s - side_v * 0.01 * s * sgn    # index
        out[idx[2]] = w + hd * 0.045 * s - side_v * 0.03 * s * sgn   # thumb
    out[23], out[24] = P["lh"], P["rh"]
    out[25], out[26] = P["lk"], P["rk"]
    out[27], out[28] = P["la"], P["ra"]
    for a_idx, heel_idx, toe_idx, fwd, knee in [(27, 29, 31, foot_fwd_l, P["lk"]), (28, 30, 32, foot_fwd_r, P["rk"])]:
        a = out[a_idx]
        fwd = unit(fwd)
        shin_up = unit(knee - a)
        out[heel_idx] = a - fwd * 0.05 * s - shin_up * 0.045 * s
        out[toe_idx] = a + fwd * 0.15 * s - shin_up * 0.04 * s
    return out


# ------------------------------------------------------- exercise models
# Each model: (b, p, F, rep_idx, t) -> 33x3 joints in the build frame.

DOWN = np.array([0.0, -1.0, 0.0])
UPV = np.array([0.0, 1.0, 0.0])
FWD = np.array([0.0, 0.0, 1.0])


def m_push_up(b, p, F, rep, t, plank_hold=False):
    ankle_y = b.ankle_h * 1.6
    L = b.leg + b.torso
    hand_y = 0.025 * b.H
    if F.get("knees"):  # knee push-ups: pivot at the knees
        pass
    h_top = hand_y + b.arm * 0.985
    alpha_top = math.asin(min((h_top - ankle_y) / L, 0.99))
    z_hand = L * math.cos(alpha_top) + F["hand_fwd"]
    hx = b.sw / 2 + F["hand_wide"]

    def elbow_at(h):
        a = math.asin(min(max((h - ankle_y) / L, -0.99), 0.99))
        sc_ = np.array([0.0, ankle_y, 0.0]) + L * np.array([0.0, math.sin(a), math.cos(a)])
        d = math.sqrt((sc_[1] - hand_y) ** 2 + (sc_[2] - z_hand) ** 2 + (hx - b.sw / 2) ** 2)
        d = min(d, b.arm - 1e-4)
        c = (b.ua ** 2 + b.fa ** 2 - d * d) / (2 * b.ua * b.fa)
        return math.degrees(math.acos(min(max(c, -1), 1)))
    lo_h = 0.06 * b.H

    def h_for(e_target):
        if elbow_at(h_top) <= e_target:
            return h_top
        return bisect(lambda h: elbow_at(h) - e_target, lo_h, h_top)
    h_top_eff = h_for(F["e_top"])
    h_bot = h_for(F["e_bottom"])
    if plank_hold:
        h = h_top_eff + 0.004 * math.sin(t * 2.1)
    else:
        h = lerp(h_top_eff, h_bot, p)
    alpha = math.asin(min(max((h - ankle_y) / L, -0.99), 0.99))
    u = np.array([0.0, math.sin(alpha), math.cos(alpha)])
    nrm = np.array([0.0, math.cos(alpha), -math.sin(alpha)])
    ankle_c = np.array([0.0, ankle_y, 0.0])
    sc = ankle_c + u * L
    hip_line = ankle_c + u * b.leg
    sag = F["hip_offset"] * (0.6 + 0.4 * p)
    hc = hip_line + nrm * sag
    P = place_trunk(b, hc, sc, DOWN.copy(), head_nod=F["head_nod"])
    lat = P["lat"]
    P["lw"] = np.array([hx, hand_y, z_hand])
    P["rw"] = np.array([-hx, hand_y, z_hand])
    fl = math.radians(F["flare"])
    for s, sgn in (("l", 1), ("r", -1)):
        pole = -u * math.cos(fl) + lat * sgn * math.sin(fl) + UPV * 0.25
        P[s + "e"] = ik(P[s + "s"], P[s + "w"], b.ua, b.fa, pole)
    # legs straight-ish, knees on the hip-ankle line
    for s, sgn in (("l", 1), ("r", -1)):
        a = np.array([sgn * b.hw * 0.35, ankle_y, 0.0])
        P[s + "a"] = a
        hip = P[s + "h"]
        P[s + "k"] = ik(hip, a, b.thigh, b.shin, nrm + 0.0) if np.linalg.norm(hip - a) < b.leg * 0.995 else hip + unit(a - hip) * b.thigh
    return finish_landmarks(P, b, DOWN + -u * 0.6, DOWN + -u * 0.6, u, u)


def m_plank(b, p, F, rep, t):
    if F["variant"] == "high":
        return m_push_up(b, 0.0, F, rep, t, plank_hold=True)
    # forearm plank
    ankle_y = b.ankle_h * 1.6
    L = b.leg + b.torso
    elbow_y = 0.03 * b.H
    h = elbow_y + b.ua * 0.98 + 0.003 * math.sin(t * 1.7)
    alpha = math.asin((h - ankle_y) / L)
    u = np.array([0.0, math.sin(alpha), math.cos(alpha)])
    nrm = np.array([0.0, math.cos(alpha), -math.sin(alpha)])
    ankle_c = np.array([0.0, ankle_y, 0.0])
    sc = ankle_c + u * L
    hc = ankle_c + u * b.leg + nrm * F["hip_offset"]
    P = place_trunk(b, hc, sc, DOWN.copy(), head_nod=F["head_nod"])
    for s, sgn in (("l", 1), ("r", -1)):
        e = np.array([sgn * (b.sw / 2 - 0.01), elbow_y, sc[2] + 0.02])
        P[s + "e"] = e
        P[s + "w"] = e + np.array([-sgn * 0.05, 0.0, b.fa * 0.97])
        a = np.array([sgn * b.hw * 0.35, ankle_y, 0.0])
        P[s + "a"] = a
        P[s + "k"] = P[s + "h"] + unit(a - P[s + "h"]) * b.thigh
    return finish_landmarks(P, b, DOWN - u * 0.6, DOWN - u * 0.6, FWD, FWD)


def m_pike_push_up(b, p, F, rep, t):
    ankle = np.array([0.0, b.ankle_h * 1.6, 0.0])
    hand_y = 0.025 * b.H
    D = F["pike_dist"] * b.H  # feet-to-hands distance
    W = np.array([0.0, hand_y, D])
    e_top = F["e_top"]
    e_bot = F["e_bottom"]
    e = lerp(e_top, e_bot, p)
    span = arm_span(b, e)
    hip_ang = math.radians(F["hip_angle"])  # angle between legs and torso at the hip

    def place(phi_deg):
        hd = dir_zy(phi_deg)  # leg direction ankle->hip
        hc = ankle + hd * b.leg
        # torso direction: rotate the hip->ankle direction by hip_ang toward the hands
        back = -hd
        # rotate 'back' within the sagittal plane by +hip_ang (toward +z)
        ang = math.atan2(back[1], back[2]) + hip_ang
        tdir = np.array([0.0, math.sin(ang), math.cos(ang)])
        sc = hc + tdir * b.torso
        return hc, sc

    def f(phi):
        hc, sc = place(phi)
        return np.linalg.norm(sc - W) - span
    grid = np.linspace(89.5, 5.0, 90)  # from steep legs to flat legs: find the first root
    vals = [f(g) for g in grid]
    phi = grid[int(np.argmin(np.abs(vals)))]
    for i in range(len(grid) - 1):
        if (vals[i] > 0) != (vals[i + 1] > 0):
            phi = bisect(f, grid[i + 1], grid[i])
            break
    hc, sc = place(phi)
    up_t = unit(sc - hc)
    P = place_trunk(b, hc, sc, unit(np.array([0.0, -0.3, -1.0])), head_nod=0.3)
    hx = b.sw / 2 + 0.04
    P["lw"] = np.array([hx, hand_y, D])
    P["rw"] = np.array([-hx, hand_y, D])
    lat = P["lat"]
    fl = math.radians(F["flare"])
    for s, sgn in (("l", 1), ("r", -1)):
        pole = -up_t * math.cos(fl) * -1 + lat * sgn * math.sin(fl) + FWD * 0.3
        P[s + "e"] = ik(P[s + "s"], P[s + "w"], b.ua, b.fa, pole)
        a = ankle + np.array([sgn * b.hw * 0.4, 0, 0])
        P[s + "a"] = a
        P[s + "k"] = P[s + "h"] + unit(a - P[s + "h"]) * b.thigh
    return finish_landmarks(P, b, FWD + DOWN, FWD + DOWN, FWD, FWD)


def m_squat(b, p, F, rep, t):
    k = lerp(F["k_top"], F["k_bottom"], p)
    beta = min(38.0, 0.42 * (180 - k)) * F["shin_mult"]
    stance = F["stance"] * b.hw
    P_side = {}
    knee_c = None
    for s, sgn in (("l", 1), ("r", -1)):
        a = np.array([sgn * stance / 2, b.ankle_h, 0.0])
        theta_ka = math.degrees(math.atan2(-math.cos(math.radians(beta)), -math.sin(math.radians(beta))))
        kn = a + b.shin * np.array([0.0, math.cos(math.radians(beta)), math.sin(math.radians(beta))])
        valg = F["valgus"] * p * stance * 0.5
        kn[0] = sgn * (stance / 2 * F["knee_out"] - valg)
        hip_dir = dir_zy(theta_ka - k)
        P_side[s] = (a, kn, hip_dir)
        knee_c = kn if knee_c is None else (knee_c + kn) / 2
    a_l, k_l, hd = P_side["l"]
    hc = np.array([0.0, k_l[1], k_l[2]]) + hd * b.thigh
    lean = lerp(F["lean_top"], F["lean_bottom"], p)
    sc = hc + b.torso * np.array([0.0, math.cos(math.radians(lean)), math.sin(math.radians(lean))])
    P = place_trunk(b, hc, sc, FWD.copy(), head_nod=-math.radians(lean) * 0.5)
    for s in ("l", "r"):
        P[s + "a"], P[s + "k"] = P_side[s][0], P_side[s][1]
    _arms_free(P, b, F, p, t, style=F["arms"])
    out_l = unit(np.array([0.25, 0, 1.0]))
    out_r = unit(np.array([-0.25, 0, 1.0]))
    return finish_landmarks(P, b, out_l, out_r, P["lw"] - P["le"], P["rw"] - P["re"])


def _arms_free(P, b, F, p, t, style="forward"):
    lat, up_t, chest = P["lat"], P["up_t"], P["chest"]
    horiz_fwd = unit(np.array([0.0, 0.0, 1.0]))
    for s, sgn in (("l", 1), ("r", -1)):
        sh = P[s + "s"]
        if style == "forward":  # arms reaching forward for balance
            ang = math.radians(lerp(30, 85, p))
            d = unit(horiz_fwd * math.sin(ang) + DOWN * math.cos(ang) + lat * sgn * 0.05)
            w = sh + d * b.arm * 0.97
            pole = DOWN + lat * sgn * 0.5
        elif style == "chest":  # hands together in front of the chest
            w = P["sc"] + chest * 0.25 * b.H / 1.75 - up_t * 0.12 + lat * sgn * 0.03
            pole = DOWN + lat * sgn
        elif style == "hips":  # hands on hips
            w = P[s + "h"] + lat * sgn * 0.06 + up_t * 0.08
            pole = lat * sgn - chest * 0.5
        elif style == "overhead":
            w = sh + up_t * b.arm * 0.95 + chest * 0.05
            pole = lat * sgn
        else:  # hanging at the sides, small swing
            sw = math.sin(t * 2 + (0 if sgn > 0 else math.pi)) * F.get("arm_swing", 0.0)
            w = sh - up_t * b.arm * 0.96 + chest * (0.05 + sw) + lat * sgn * 0.06
            pole = -chest + DOWN * 0.2
        P[s + "w"] = w
        P[s + "e"] = ik(sh, w, b.ua, b.fa, pole)


def m_lunge(b, p, F, rep, t):
    front = "l" if (rep + F["first_side"]) % 2 == 0 else "r"
    back = "r" if front == "l" else "l"
    stride = F["stride"] * b.H
    sg = {"l": 1, "r": -1}
    af = np.array([sg[front] * b.hw * 0.5, b.ankle_h, stride * 0.5])
    ab = np.array([sg[back] * b.hw * 0.5, b.ankle_h * 1.8, -stride * 0.5])
    hz = 0.0

    def hip_at(h):
        return np.array([0.0, h, hz])

    def front_knee_angle(h):
        hp = hip_at(h) + np.array([sg[front] * b.hw / 2, 0, 0])
        kn = ik(hp, af, b.thigh, b.shin, FWD + UPV * 0.2)
        v1, v2 = hp - kn, af - kn
        return math.degrees(math.acos(np.clip(np.dot(v1, v2) / np.linalg.norm(v1) / np.linalg.norm(v2), -1, 1)))
    h_top = math.sqrt(max((b.leg * 0.99) ** 2 - (stride * 0.5) ** 2, 0.1)) + b.ankle_h
    k_target = F["k_bottom"]
    lo_h = b.ankle_h + 0.2 * b.leg
    h_bot = bisect(lambda h: front_knee_angle(h) - k_target, lo_h, h_top) if front_knee_angle(lo_h) < k_target else lo_h
    h = lerp(h_top, h_bot, p)
    hc = hip_at(h)
    lean = lerp(F["lean_top"], F["lean_bottom"], p)
    sc = hc + b.torso * np.array([0.0, math.cos(math.radians(lean)), math.sin(math.radians(lean))])
    P = place_trunk(b, hc, sc, FWD.copy())
    P[front + "a"] = af
    P[front + "k"] = ik(P[front + "h"], af, b.thigh, b.shin, FWD + UPV * 0.2)
    P[back + "a"] = ab
    P[back + "k"] = ik(P[back + "h"], ab, b.thigh, b.shin, DOWN + FWD * 0.6)
    _arms_free(P, b, F, p, t, style=F["arms"])
    return finish_landmarks(P, b, FWD, FWD, P["lw"] - P["le"], P["rw"] - P["re"])


def _hang_arms(P, b, bar_y, grip, sgn_pole_out=1.0, fwd=0.15):
    lat = P["lat"]
    for s, sgn in (("l", 1), ("r", -1)):
        w = np.array([sgn * grip / 2, bar_y - 0.02, 0.0])
        P[s + "w"] = w
        pole = lat * sgn * sgn_pole_out + DOWN * 0.7 + FWD * fwd
        P[s + "e"] = ik(P[s + "s"], w, b.ua, b.fa, pole)


def m_pull_up(b, p, F, rep, t):
    bar_y = 2.3
    grip = b.sw * F["grip"]
    dx = max(grip / 2 - b.sw / 2, 0.0)
    straight = math.sqrt(max(b.arm ** 2 - dx ** 2, 0.01))
    lock = F["lockout"]
    y_bottom = bar_y - 0.02 - straight * (0.985 if lock > 0.5 else 0.86)
    nose_up = b.neck + 0.03 * b.H
    y_top_full = bar_y + F["top_clear"] - nose_up
    y_top = lerp(y_bottom, y_top_full, F["depth"])
    ys = lerp(y_bottom, y_top, p)
    kip = F["kip"]
    swing = kip * math.sin(2 * math.pi * p - 0.6)
    tau = math.radians(F["lean"] * p + 38 * swing)  # torso tilt: feet forward
    sc = np.array([0.0, ys, -0.04 * p])
    hc = sc + b.torso * np.array([0.0, -math.cos(tau), math.sin(tau)])
    P = place_trunk(b, hc, sc, FWD.copy(), head_nod=-0.15 * p)
    _hang_arms(P, b, bar_y, grip)
    _hang_legs(P, b, F, hip_flex=F["leg_flex"] + 70 * max(swing, 0) * kip, knee=F["knee"] - 60 * kip * abs(swing), tau=tau)
    return finish_landmarks(P, b, DOWN + FWD * 0.6, DOWN + FWD * 0.6, UPV, UPV)


def _hang_legs(P, b, F, hip_flex, knee, tau):
    # hip flexion measured from the torso line hanging straight down
    base = -90 + math.degrees(tau)  # direction (deg in zy plane) of the torso continued downward
    for s, sgn in (("l", 1), ("r", -1)):
        hip = P[s + "h"]
        th = dir_zy(base + hip_flex)
        kn = hip + th * b.thigh
        sh = dir_zy(base + hip_flex - (180 - knee))
        P[s + "k"] = kn
        P[s + "a"] = kn + sh * b.shin


def m_hanging_leg_raise(b, p, F, rep, t):
    bar_y = 2.3
    grip = b.sw * F["grip"]
    dx = max(grip / 2 - b.sw / 2, 0.0)
    straight = math.sqrt(max(b.arm ** 2 - dx ** 2, 0.01))
    ys = bar_y - 0.02 - straight * 0.985
    swing = F["kip"] * math.sin(t * 2.6)
    tau = math.radians(-8 * p + 20 * swing)
    sc = np.array([0.0, ys, 0.0])
    hc = sc + b.torso * np.array([0.0, -math.cos(tau), math.sin(tau)])
    P = place_trunk(b, hc, sc, FWD.copy())
    _hang_arms(P, b, bar_y, grip, fwd=0.0)
    flex = lerp(5, F["flex_top"], p)
    knee = lerp(178, F["knee_top"], p)
    _hang_legs(P, b, F, hip_flex=flex, knee=knee, tau=tau)
    return finish_landmarks(P, b, FWD + DOWN * 0.3, FWD + DOWN * 0.3, UPV, UPV)


def m_dip(b, p, F, rep, t):
    bar_y = 1.3
    e = lerp(F["e_top"], F["e_bottom"], p)
    gamma = math.radians(4 + 10 * p)
    joints = {}
    for s, sgn in (("l", 1), ("r", -1)):
        w = np.array([sgn * (b.sw / 2 + 0.04), bar_y, 0.0])
        el = w + b.fa * np.array([0.0, math.cos(gamma), -math.sin(gamma)]) + np.array([sgn * 0.03, 0, 0])
        theta_ew = math.degrees(math.atan2(-math.cos(gamma), math.sin(gamma)))
        sh = el + b.ua * dir_zy(theta_ew + e)
        joints[s] = (w, el, sh)
    sc = (joints["l"][2] + joints["r"][2]) / 2
    sc[0] = 0.0
    lean = lerp(F["lean_top"], F["lean_bottom"], p)
    hc = sc + b.torso * np.array([0.0, -math.cos(math.radians(lean)), -math.sin(math.radians(lean))])
    P = place_trunk(b, hc, sc, FWD.copy())
    for s in ("l", "r"):
        P[s + "w"], P[s + "e"] = joints[s][0], joints[s][1]
        P[s + "e"] = ik(P[s + "s"], P[s + "w"], b.ua, b.fa, -FWD + DOWN * 0.3)
    swing = F["kip"] * math.sin(t * 3.0)
    _hang_legs(P, b, F, hip_flex=F["leg_flex"] + 20 * swing, knee=F["knee"], tau=math.radians(-lean))
    return finish_landmarks(P, b, DOWN - FWD, DOWN - FWD, FWD, FWD)


def m_inverted_row(b, p, F, rep, t):
    bar_y = F["bar_h"] * b.H
    ankle = np.array([0.0, b.ankle_h * 1.2, 0.0])
    L = b.leg + b.torso
    grip = b.sw * 1.25
    W_c = np.array([0.0, bar_y - 0.02, 0.0])
    e_bot = F["e_start"]
    e = lerp(e_bot, F["e_top"], p)
    span = arm_span(b, e)
    # bar is at z = 0; heels placed so that at the bottom (arms straight) the
    # shoulders hang right under the bar
    span_b = arm_span(b, e_bot)
    y_s_b = bar_y - 0.02 - span_b
    alpha_b = math.degrees(math.asin(min(max((y_s_b - ankle[1]) / L, 0.02), 0.9)))
    dist = L * math.cos(math.radians(alpha_b)) + F["dist"] - 1.0
    ankle = ankle + np.array([0.0, 0.0, -dist])

    def shoulder(alpha):
        return ankle + L * np.array([0.0, math.sin(math.radians(alpha)), math.cos(math.radians(alpha))])

    dxw = max(grip / 2 - b.sw / 2, 0)

    def f(alpha):
        sc = shoulder(alpha)
        return math.sqrt(np.sum((sc - W_c) ** 2) + dxw ** 2) - span
    grid = np.linspace(max(alpha_b - 8, 1), 85, 200)
    vals = [f(a) for a in grid]
    a_min = grid[int(np.argmin(vals))]
    lo = max(alpha_b - 8, 1)
    alpha = bisect(f, lo, a_min) if f(lo) > 0 and f(a_min) < 0 else (a_min if f(a_min) >= 0 else lo)
    sc = shoulder(alpha)
    u = unit(sc - ankle)
    nrm = np.array([0.0, u[2], -u[1]])  # perpendicular, pointing up
    hc = ankle + u * b.leg + nrm * F["hip_offset"]
    P = place_trunk(b, hc, sc, UPV.copy())
    lat = P["lat"]
    xs = 1.0 if lat[0] >= 0 else -1.0  # face-up: the person's left is at -x
    for s, sgn in (("l", xs), ("r", -xs)):
        w = np.array([sgn * grip / 2, bar_y - 0.02, 0.0])
        P[s + "w"] = w
        P[s + "e"] = ik(P[s + "s"], w, b.ua, b.fa, DOWN + np.array([sgn, 0, 0]) * math.sin(math.radians(F["flare"])) - u * 0.5)
        a = ankle + np.array([sgn * b.hw * 0.4, 0, 0])
        P[s + "a"] = a
        P[s + "k"] = P[s + "h"] + unit(a - P[s + "h"]) * b.thigh
    return finish_landmarks(P, b, UPV + u * 0.3, UPV + u * 0.3, UPV, UPV)


def m_idle(b, p, F, rep, t):
    kind = F["idle_kind"]
    if kind in ("stand", "walk", "stretch", "shake"):
        hc = np.array([0.0, b.leg + b.ankle_h - 0.01, 0.0])
        lean = 4 + 3 * math.sin(t * 0.7)
        sc = hc + b.torso * np.array([0.0, math.cos(math.radians(lean)), math.sin(math.radians(lean))])
        P = place_trunk(b, hc, sc, FWD.copy(), head_nod=0.2 * math.sin(t * 0.5))
        for s, sgn in (("l", 1), ("r", -1)):
            step = 0.0
            if kind == "walk":
                step = max(0.0, math.sin(t * 5.5 + (0 if sgn > 0 else math.pi)))
            a = np.array([sgn * b.hw * 0.55, b.ankle_h + 0.18 * step, 0.12 * step])
            P[s + "a"] = a
            P[s + "k"] = ik(P[s + "h"], a, b.thigh, b.shin, FWD)
        style = F["arms"]
        if kind == "stretch":
            style = "overhead" if math.sin(t * 0.8) > 0 else "side"
        if kind == "shake":
            F = dict(F, arm_swing=0.15)
        _arms_free(P, b, F, 0.5 + 0.5 * math.sin(t * 0.9), t, style=style)
        return finish_landmarks(P, b, FWD, FWD, P["lw"] - P["le"], P["rw"] - P["re"])
    if kind == "sit":  # sitting on a bench / box
        hc = np.array([0.0, 0.48 * b.H / 1.75, -0.05])
        sc = hc + b.torso * np.array([0.0, math.cos(0.2), math.sin(0.2)])
        P = place_trunk(b, hc, sc, FWD.copy())
        for s, sgn in (("l", 1), ("r", -1)):
            kn = P[s + "h"] + np.array([0.0, 0.0, b.thigh])
            P[s + "k"] = kn
            P[s + "a"] = np.array([kn[0], b.ankle_h, kn[2] + 0.05])
        _arms_free(P, b, F, 0.3, t, style="side")
        for s, sgn in (("l", 1), ("r", -1)):  # hands on the thighs
            P[s + "w"] = P[s + "k"] - np.array([0, -0.03, 0.12])
            P[s + "e"] = ik(P[s + "s"], P[s + "w"], b.ua, b.fa, DOWN + np.array([sgn, 0, 0]))
        return finish_landmarks(P, b, FWD, FWD, FWD, FWD)
    if kind == "lie":  # lying on the back, resting
        hc = np.array([0.0, 0.1, 0.0])
        sc = hc + np.array([0.0, 0.03, b.torso])
        P = place_trunk(b, hc, sc, UPV.copy())
        for s, sgn in (("l", 1), ("r", -1)):
            kn = P[s + "h"] + np.array([0.0, 0.25 * F["knees_up"], -b.thigh * 0.9])
            P[s + "k"] = kn
            P[s + "a"] = ik(P[s + "h"], np.array([sgn * 0.12, 0.08, -b.leg * (0.95 - 0.35 * F["knees_up"])]), b.thigh, b.shin, UPV)
            P[s + "k"] = ik(P[s + "h"], P[s + "a"], b.thigh, b.shin, UPV)
            P[s + "w"] = P[s + "s"] + np.array([sgn * 0.2, -0.05, -0.35])
            P[s + "e"] = ik(P[s + "s"], P[s + "w"], b.ua, b.fa, np.array([sgn, 0, 0]))
        return finish_landmarks(P, b, UPV, UPV, -FWD, -FWD)
    # "bend": bending down to pick something up / adjust equipment
    hc = np.array([0.0, b.leg * 0.92, -0.08])
    bend = 25 + 50 * (0.5 + 0.5 * math.sin(t * 0.9))
    sc = hc + b.torso * np.array([0.0, math.cos(math.radians(bend)), math.sin(math.radians(bend))])
    P = place_trunk(b, hc, sc, FWD.copy())
    for s, sgn in (("l", 1), ("r", -1)):
        a = np.array([sgn * b.hw * 0.6, b.ankle_h, 0.0])
        P[s + "a"] = a
        P[s + "k"] = ik(P[s + "h"], a, b.thigh, b.shin, FWD)
    _arms_free(P, b, F, 0.5, t, style="side")
    return finish_landmarks(P, b, FWD, FWD, DOWN, DOWN)


MODELS = {
    "push_up": m_push_up, "pike_push_up": m_pike_push_up, "plank": m_plank,
    "pull_up": m_pull_up, "inverted_row": m_inverted_row, "dip": m_dip,
    "squat": m_squat, "lunge": m_lunge, "hanging_leg_raise": m_hanging_leg_raise,
    "idle": m_idle,
}

# ------------------------------------------------------- form profiles
# Each profile returns (F, faults) where faults is the set of injected faults
# (ground truth for testing the form analyser).

def U(rng, a, b):
    return float(rng.uniform(a, b))


def form_profile(ex, rng, p_fault=0.45):
    faulty = rng.random() < p_fault
    faults = set()

    def maybe(name, prob=0.5):
        if faulty and rng.random() < prob:
            faults.add(name)
            return True
        return False

    if ex == "push_up" or ex == "plank":
        F = dict(e_bottom=U(rng, 70, 92), e_top=U(rng, 168, 180), hand_fwd=U(rng, -0.03, 0.06),
                 hand_wide=U(rng, 0.0, 0.1), flare=U(rng, 25, 50), hip_offset=U(rng, -0.025, 0.02),
                 head_nod=U(rng, -0.1, 0.25), variant=rng.choice(["high", "forearm"]))
        if ex == "push_up":
            if maybe("partial_depth", 0.5): F["e_bottom"] = U(rng, 112, 132)
            if maybe("no_lockout", 0.3): F["e_top"] = U(rng, 138, 150)
            if maybe("elbow_flare", 0.35): F["flare"] = U(rng, 78, 90); F["hand_wide"] = U(rng, 0.1, 0.18)
        if maybe("hip_sag", 0.45): F["hip_offset"] = -U(rng, 0.09, 0.16)
        elif maybe("hip_pike", 0.4): F["hip_offset"] = U(rng, 0.1, 0.2)
    elif ex == "pike_push_up":
        F = dict(pike_dist=U(rng, 0.5, 0.62), e_bottom=U(rng, 78, 95), e_top=U(rng, 168, 178),
                 hip_angle=U(rng, 70, 95), flare=U(rng, 25, 50))
        if maybe("partial_depth", 0.6): F["e_bottom"] = U(rng, 115, 132)
        if maybe("no_lockout", 0.3): F["e_top"] = U(rng, 138, 150)
        if maybe("hips_low", 0.4): F["hip_angle"] = U(rng, 118, 135)
    elif ex == "pull_up":
        F = dict(grip=U(rng, 1.15, 1.7), lockout=1.0, top_clear=U(rng, 0.03, 0.09), depth=1.0,
                 kip=0.0, lean=U(rng, 5, 15), leg_flex=U(rng, 0, 20), knee=U(rng, 160, 178))
        if rng.random() < 0.3: F["knee"] = U(rng, 95, 125)  # knees bent, ankles crossed
        if maybe("chin_below_bar", 0.5): F["depth"] = U(rng, 0.45, 0.72)
        if maybe("no_lockout", 0.4): F["lockout"] = 0.0
        if maybe("kipping", 0.35): F["kip"] = U(rng, 0.6, 1.0)
    elif ex == "inverted_row":
        F = dict(bar_h=U(rng, 0.5, 0.62), dist=U(rng, 0.97, 1.05), e_top=U(rng, 60, 82), e_start=U(rng, 168, 178),
                 hip_offset=U(rng, -0.025, 0.02), flare=U(rng, 20, 45))
        if maybe("partial_depth", 0.55): F["e_top"] = U(rng, 112, 128)
        if maybe("hip_sag", 0.5): F["hip_offset"] = -U(rng, 0.1, 0.18)
        if maybe("no_lockout", 0.3): F["e_start"] = U(rng, 135, 145)
    elif ex == "dip":
        F = dict(e_bottom=U(rng, 78, 95), e_top=U(rng, 168, 178), lean_top=U(rng, 3, 12),
                 lean_bottom=U(rng, 15, 32), kip=0.0, leg_flex=U(rng, -15, 10), knee=U(rng, 85, 175))
        if maybe("partial_depth", 0.55): F["e_bottom"] = U(rng, 115, 132)
        if maybe("no_lockout", 0.35): F["e_top"] = U(rng, 135, 147)
        if maybe("excess_lean", 0.3): F["lean_bottom"] = U(rng, 50, 65)
        if maybe("swinging", 0.25): F["kip"] = U(rng, 0.8, 1.2)
    elif ex == "squat":
        F = dict(k_bottom=U(rng, 60, 92), k_top=U(rng, 170, 179), shin_mult=U(rng, 0.85, 1.1),
                 stance=U(rng, 1.1, 1.9), knee_out=U(rng, 1.0, 1.12), valgus=0.0,
                 lean_top=U(rng, 0, 6), lean_bottom=U(rng, 22, 42), arms=rng.choice(["forward", "chest", "hips"]))
        if maybe("partial_depth", 0.55): F["k_bottom"] = U(rng, 115, 135)
        if maybe("no_lockout", 0.2): F["k_top"] = U(rng, 140, 150)
        if maybe("knee_valgus", 0.4): F["valgus"] = U(rng, 0.45, 0.7); F["knee_out"] = 1.0
        if maybe("excess_lean", 0.35): F["lean_bottom"] = U(rng, 55, 70)
    elif ex == "lunge":
        F = dict(stride=U(rng, 0.38, 0.5), k_bottom=U(rng, 82, 98), shin_fwd=U(rng, 0, 18),
                 lean_top=U(rng, 0, 5), lean_bottom=U(rng, 2, 14), arms=rng.choice(["side", "hips", "chest"]),
                 first_side=int(rng.integers(0, 2)))
        if maybe("partial_depth", 0.6): F["k_bottom"] = U(rng, 118, 135)
        if maybe("excess_lean", 0.45): F["lean_bottom"] = U(rng, 30, 45)
    elif ex == "hanging_leg_raise":
        F = dict(grip=U(rng, 1.1, 1.5), flex_top=U(rng, 92, 120), knee_top=U(rng, 165, 178), kip=0.0)
        if maybe("partial_depth", 0.5): F["flex_top"] = U(rng, 40, 58)
        if maybe("bent_knees", 0.4): F["knee_top"] = U(rng, 70, 110)
        if maybe("swinging", 0.4): F["kip"] = U(rng, 0.6, 1.0)
    else:  # idle
        F = dict(idle_kind=rng.choice(["stand", "stand", "walk", "stretch", "shake", "sit", "lie", "bend"]),
                 arms=rng.choice(["side", "hips", "chest"]), knees_up=float(rng.random() < 0.5))
    return F, faults


# ------------------------------------------------------- sequences

@dataclass
class Sequence:
    exercise: str
    world: np.ndarray          # (T, 33, 3) MediaPipe world convention (hip-centred, metres)
    image: np.ndarray          # (T, 33, 2) normalised image coordinates (for drawing)
    fps: float
    rep_bounds: list = field(default_factory=list)   # (start_frame, end_frame) per rep
    faults: set = field(default_factory=set)
    profile: dict = field(default_factory=dict)


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def phase_track(rng, n_reps, fps, rushed=False, hold_secs=None):
    """Rep phase p(t) plus the frame ranges of each rep."""
    ps, bounds = [], []
    lead = int(fps * U(rng, 0.4, 1.2))
    ps += [0.0] * lead
    for r in range(n_reps):
        ecc = U(rng, 0.25, 0.4) if rushed else U(rng, 0.7, 1.8)
        con = U(rng, 0.3, 0.5) if rushed else U(rng, 0.5, 1.4)
        pause_b = U(rng, 0.0, 0.4)
        pause_t = U(rng, 0.15, 0.9)
        start = len(ps)
        n = max(2, int(ecc * fps))
        ps += [smoothstep(i / n) for i in range(1, n + 1)]
        ps += [1.0] * int(pause_b * fps)
        n = max(2, int(con * fps))
        ps += [1 - smoothstep(i / n) for i in range(1, n + 1)]
        end = len(ps)
        bounds.append((start, end))
        ps += [0.0] * int(pause_t * fps)
    return np.array(ps), bounds


def generate(ex, rng, n_reps=None, fps=30.0, p_fault=0.45, noise=1.0, duration=None, profile=None, yaw=None):
    b = Body.random(rng)
    F, faults = profile if profile is not None else form_profile(ex, rng, p_fault)
    model = MODELS[ex]
    if ex in ("plank", "idle"):
        dur = duration or U(rng, 6, 14)
        T = int(dur * fps)
        ps, bounds = np.zeros(T), []
    else:
        n_reps = n_reps or int(rng.integers(3, 9))
        rushed = faulty_rushed = (rng.random() < 0.12 * p_fault / 0.45)
        if rushed:
            faults.add("rushed")
        ps, bounds = phase_track(rng, n_reps, fps, rushed=rushed)
    T = len(ps)
    pts = np.zeros((T, 33, 3))
    rep_idx = 0
    bi = 0
    for i in range(T):
        while bi < len(bounds) and i >= bounds[bi][1]:
            bi += 1
        rep_idx = bi
        pts[i] = model(b, float(ps[i]), F, rep_idx, i / fps)
    # ---- camera: random viewpoint around the person
    yaw_fixed = yaw
    yaw = U(rng, -math.pi, math.pi)
    if ex in ("push_up", "plank", "pike_push_up", "inverted_row", "lunge", "squat", "dip") and rng.random() < 0.6:
        yaw = rng.choice([math.pi / 2, -math.pi / 2]) + U(rng, -0.6, 0.6)  # side-ish views are typical
    if yaw_fixed is not None:
        yaw = yaw_fixed
    # phones are often propped on the floor and tilted: allow up to ~25 deg pitch
    R = rot_z(U(rng, -0.12, 0.12) * noise) @ rot_x(U(rng, -0.42, 0.3) * min(noise, 1.2)) @ rot_y(yaw)
    pts = pts @ R.T
    # MediaPipe's depth (camera z) is its weakest axis: squash it around the body centre
    if noise > 0:
        zc = pts[..., 2].mean()
        pts[..., 2] = zc + (pts[..., 2] - zc) * U(rng, 0.75, 1.05)
    # ---- MediaPipe-like noise: per-joint jitter + slow drift, more in depth
    sig = np.array([0.012, 0.012, 0.03]) * noise
    jitter = rng.normal(0, 1, pts.shape) * sig
    drift = np.cumsum(rng.normal(0, 1, pts.shape) * sig * 0.15, axis=0)
    drift -= np.linspace(0, 1, T)[:, None, None] * drift[-1:]  # keep it bounded
    pts = pts + jitter + drift * 0.5
    # the side facing away from the camera is partly guessed by the model: noisier
    far = [11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31] if rng.random() < 0.5 else [12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32]
    if rng.random() < 0.6:
        pts[:, far] += rng.normal(0, 0.025 * noise, (T, len(far), 3)) + rng.normal(0, 0.03 * noise, (1, len(far), 3))
    # occasional glitch frames
    for _ in range(int(T * 0.01 * noise)):
        i = int(rng.integers(0, T))
        j = int(rng.integers(11, 33))
        pts[i, j] += rng.normal(0, 0.08, 3)
    # ---- to MediaPipe convention: x right, y down, z away from the camera
    mp_abs = pts * np.array([1.0, -1.0, -1.0])
    hip_c = (mp_abs[:, 23] + mp_abs[:, 24]) / 2
    world = mp_abs - hip_c[:, None, :]
    # ---- image projection for drawing (camera ~3.2 m away, looking at the body)
    centre = mp_abs.reshape(-1, 3).mean(0)
    cam_d = 3.2 + 0.4 * (b.H - 1.75)
    rel = mp_abs - centre
    z = rel[..., 2] + cam_d
    f = 1.1
    img = np.stack([0.5 + f * rel[..., 0] / z * 0.75, 0.52 + f * rel[..., 1] / z], -1)
    seq = Sequence(ex, world.astype(np.float32), img.astype(np.float32), fps, bounds, faults, F)
    seq.abs = mp_abs
    return seq


if __name__ == "__main__":
    rng = np.random.default_rng(0)
    for ex in EXERCISES:
        s = generate(ex, rng)
        print(ex, s.world.shape, len(s.rep_bounds), sorted(s.faults))
