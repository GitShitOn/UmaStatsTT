#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
UmaStatsTT - Team Trials results analyzer (Uma Musume Pretty Derby).

Reads the JSON files saved from Team Trials sessions (TT-YYYYMMDD_hhmmss_xxx.json),
also decodes each race's binary replay (`race_scenario`), and prints statistics meant
to show WHERE you lose points and WHAT is worth improving.

Usage:
    python3 tt_stats.py                     # looks for TT-*.json in ./data and the current folder
    python3 tt_stats.py folder/ file.json ...
    python3 tt_stats.py data/ --details     # adds a race-by-race breakdown
    python3 tt_stats.py data/ --skills      # full skill table for every uma
    python3 tt_stats.py data/ --md report.md --csv export/

Standard library only, Python >= 3.8.
"""

from __future__ import annotations

import argparse
import base64
import csv
import glob
import gzip
import json
import math
import os
import re
import struct
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from statistics import mean
from typing import Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Lookup tables
# ---------------------------------------------------------------------------

DIST_NAMES = {1: "Sprint", 2: "Mile", 3: "Medium", 4: "Long", 5: "Dirt"}
STYLE_NAMES = {1: "Front", 2: "Pace", 3: "Late", 4: "End"}
MOOD_NAMES = {1: "Awful", 2: "Bad", 3: "Normal", 4: "Good", 5: "Great"}
WEATHER_NAMES = {1: "Sunny", 2: "Cloudy", 3: "Rainy", 4: "Snowy"}
GROUND_NAMES = {1: "Firm", 2: "Good", 3: "Soft", 4: "Heavy"}
APT_LETTERS = {1: "G", 2: "F", 3: "E", 4: "D", 5: "C", 6: "B", 7: "A", 8: "S"}

# chara_id -> name (Global version). Unknown ids are shown as "Chara <id>".
CHARA_NAMES = {
    1001: "Special Week", 1002: "Silence Suzuka", 1003: "Tokai Teio", 1004: "Maruzensky",
    1005: "Fuji Kiseki", 1006: "Oguri Cap", 1007: "Gold Ship", 1008: "Vodka",
    1009: "Daiwa Scarlet", 1010: "Taiki Shuttle", 1011: "Grass Wonder", 1012: "Hishi Amazon",
    1013: "Mejiro McQueen", 1014: "El Condor Pasa", 1015: "T.M. Opera O", 1016: "Narita Brian",
    1017: "Symboli Rudolf", 1018: "Air Groove", 1019: "Agnes Digital", 1020: "Seiun Sky",
    1021: "Tamamo Cross", 1022: "Fine Motion", 1023: "Biwa Hayahide", 1024: "Mayano Top Gun",
    1025: "Manhattan Cafe", 1026: "Mihono Bourbon", 1027: "Mejiro Ryan", 1028: "Hishi Akebono",
    1029: "Yukino Bijin", 1030: "Rice Shower", 1031: "Ines Fujin", 1032: "Agnes Tachyon",
    1033: "Admire Vega", 1034: "Inari One", 1035: "Winning Ticket", 1036: "Air Shakur",
    1037: "Eishin Flash", 1038: "Curren Chan", 1039: "Kawakami Princess", 1040: "Gold City",
    1041: "Sakura Bakushin O", 1042: "Seeking the Pearl", 1043: "Shinko Windy",
    1044: "Sweep Tosho", 1045: "Super Creek", 1046: "Smart Falcon", 1047: "Zenno Rob Roy",
    1048: "Tosen Jordan", 1049: "Nakayama Festa", 1050: "Narita Taishin", 1051: "Nishino Flower",
    1052: "Haru Urara", 1053: "Bamboo Memory", 1054: "Biko Pegasus", 1055: "Marvelous Sunday",
    1056: "Matikanefukukitaru", 1057: "Mr. C.B.", 1058: "Meisho Doto", 1059: "Mejiro Dober",
    1060: "Nice Nature", 1061: "King Halo", 1062: "Matikanetannhauser", 1063: "Ikuno Dictus",
    1064: "Mejiro Palmer", 1065: "Daitaku Helios", 1066: "Twin Turbo", 1067: "Satono Diamond",
    1068: "Kitasan Black", 1069: "Sakura Chiyono O", 1070: "Sirius Symboli",
    1071: "Mejiro Ardan", 1072: "Yaeno Muteki",
}

# Base-point categories (raw_score_id). Derived from the data: every score event in the
# replay was matched against the race state (positions, HP, skills, times) over 385 races.
CATEGORY_LABELS = {
    "place": "Finishing position",
    "margin": "Winning margin",
    "upset": "Outsider in the top 3",
    "unique": "Unique skill",
    "gold": "Gold skills",
    "white": "White / inherited unique skills",
    "start": "Perfect start (<0.02 s)",
    "lead16": "Leads own strategy at 1/6",
    "lead23": "Leads own strategy at 2/3",
    "time": "Time bonus (under reference time)",
    "rushed": "Rushed (penalty)",
    "team": "Team bonus",
    "other": "Other",
}
CATEGORY_ORDER = ["place", "margin", "upset", "unique", "gold", "white", "start",
                  "lead16", "lead23", "time", "rushed", "team", "other"]
SKILL_CATS = ("unique", "gold", "white")


def ordinal(n: int) -> str:
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


# Winning margin categories (raw_score_id 1-21). 1 length = 1/6 s of finish time.
MARGIN_LABELS = {1: "more than 10 lengths", 2: "10 lengths", 3: "9 lengths", 4: "8 lengths", 5: "7 lengths",
                 6: "6 lengths", 7: "5 lengths", 8: "4 lengths", 9: "3 1/2 lengths", 10: "3 lengths",
                 11: "2 1/2 lengths", 12: "2 lengths", 13: "1 3/4 lengths", 14: "1 1/2 lengths", 15: "1 1/4 lengths",
                 16: "1 length", 17: "3/4 length", 18: "1/2 length", 19: "nose", 20: "head", 21: "neck"}

# Opponent bonus = a + b * opponent rating + c * own rating (fit on 77 sessions, error < 0.06 points).
OPP_BONUS_FIT = (-0.04099, 1.29733e-5, -0.78386e-5)


def opp_bonus_model(opp_eval: int, self_eval: int) -> float:
    a, b, c = OPP_BONUS_FIT
    return a + b * opp_eval + c * self_eval


def score_category(rid: int) -> Tuple[str, str]:
    """raw_score_id -> (category, description)."""
    if 1 <= rid <= 21:
        return "margin", f"Winning margin: {MARGIN_LABELS[rid]}"
    if rid == 22:
        return "upset", "Outsider (popularity 8 or lower) in the top 3"
    if rid == 23:
        return "rushed", "Rushed: start (-500)"
    if rid == 24:
        return "rushed", "Rushed: each second (-100)"
    if rid == 25:
        return "start", "Perfect start (delay < 0.02 s)"
    if 40 <= rid <= 55:
        return "unique", f"Unique skill (#{rid})"
    if rid == 56:
        return "gold", "Gold skill"
    if rid == 57:
        return "white", "White skill / inherited unique"
    if rid == 58:
        return "lead16", "Leads the umas of its strategy at the end of the opening phase (1/6)"
    if rid == 59:
        return "lead23", "Leads the umas of its strategy at the start of the final phase (2/3)"
    if 60 <= rid <= 71:
        return "place", f"Finished {ordinal(rid - 59)}"
    if 72 <= rid <= 92:
        return "time", f"Time bonus: {(92 - rid) / 10:.1f} s under the reference time"
    if rid == 94:
        return "team", "Team: all 3 in the top 3"
    if rid == 95:
        return "team", "Team: all 3 in the top 5"
    if 93 <= rid <= 99:
        return "team", f"Team bonus #{rid}"
    return "other", f"Unknown category #{rid}"


def bonus_kind(b: dict) -> str:
    """Kind of multiplicative bonus (bonus_array), based on condition_type."""
    ct = b.get("condition_type")
    return {1: "ace", 3: "opponent", 4: "streak", 5: "support"}.get(ct, f"bonus#{b.get('score_bonus_id')}")


BONUS_LABELS = {
    "ace": "First uma of the distance / slot 1 (+10%)",
    "opponent": "Opponent (grows with their rating)",
    "streak": "Win streak",
    "support": "Support cards",
}

LEGEND = [
    "Finishing position: 1st 10,000, 2nd 8,000, 3rd 7,000, 4th 6,000, 5th 5,000, 6th-7th 4,000, 8th-9th 3,000, "
    "10th-12th 2,000.",
    "Winning margin (1st place only): nose 5,000, head 3,000, neck 2,000; then 1,000 for 1/2 length, +100 per "
    "step up to 2,600 for 10 lengths, and 3,000 for more than 10. Photo-finish wins are worth the most.",
    "Outsider: +4,000 if an uma with popularity 8 or lower finishes in the top 3.",
    "Skills: white or inherited unique 500, gold 1,200, unique 2,300-2,500 (grows with level). Passive skills count.",
    "Perfect start: +1,000 when the start delay is under 0.02 s.",
    "Leads own strategy: +1,000 if at 1/6 of the race (end of the opening phase) you are ahead of every uma "
    "with your same strategy; another +1,000 at 2/3 (start of the final phase).",
    "Time bonus: +100 per 0.1 s under a course reference time (up to 2,000 seen), mostly on Sprint and Mile.",
    "Rushed: -500 when it starts and -100 for every second it lasts.",
    "Team: +4,000 if all 3 finish in the top 5, +5,000 if all 3 finish in the top 3.",
    "Percentage bonuses on every item: opponent (+1.3 points per 1,000 opponent rating, -0.8 per 1,000 of your "
    "own), support cards (~+10%), first uma of the distance / slot 1 (+10%), win streak (+2% on the 2nd win in a "
    "row up to +5% on the 5th).",
]


# ---------------------------------------------------------------------------
# Number formatting
# ---------------------------------------------------------------------------


def fi(x) -> str:
    if x is None:
        return "-"
    return f"{int(round(x)):,}"


def ff(x, d: int = 1) -> str:
    if x is None:
        return "-"
    return f"{x:,.{d}f}"


def pct(x, d: int = 0) -> str:
    if x is None:
        return "-"
    return ff(100 * x, d) + "%"


def frac(k: int, n: int) -> str:
    return f"{k}/{n}"


def plural(n: int, one: str, many: str) -> str:
    return one if n == 1 else many


def safe_mean(xs, default=None):
    xs = [x for x in xs if x is not None]
    return mean(xs) if xs else default


# ---------------------------------------------------------------------------
# Replay decoding (race_scenario: base64 + gzip + little-endian binary)
# ---------------------------------------------------------------------------

EV_SCORE, EV_SKILL = 0, 3


@dataclass
class Scenario:
    frames: list            # [(t, [(dist, lane, speed, hp, temptation, block_front), ...])]
    results: list           # per horse index (= frame_order - 1)
    events: list            # [(t, type, params)]
    distance: Optional[int] = None


def parse_scenario(blob: Optional[str]) -> Optional[Scenario]:
    if not blob:
        return None
    try:
        b = gzip.decompress(base64.b64decode(blob))
        header_len, _version = struct.unpack_from("<ii", b, 0)
        off = 4 + header_len
        _ddm, hn, hfs, hrs, pad = struct.unpack_from("<fiiii", b, off)
        off += 20 + pad
        fc, fs = struct.unpack_from("<ii", b, off)
        off += 8
        frames = []
        for _ in range(fc):
            (t,) = struct.unpack_from("<f", b, off)
            hs = []
            for h in range(hn):
                o = off + 4 + h * hfs
                if hfs >= 12:
                    hs.append(struct.unpack_from("<fHHHbb", b, o))
                else:
                    hs.append((struct.unpack_from("<f", b, o)[0], 0, 0, 0, 0, -1))
            frames.append((t, hs))
            off += fs
        (pad,) = struct.unpack_from("<i", b, off)
        off += 4 + pad
        results = []
        for _ in range(hn):
            if hrs >= 31:
                r = struct.unpack_from("<ifffBBfBif", b, off)
                results.append(dict(order=r[0], time=r[1], diff=r[2], delay=r[3],
                                    spurt=r[6], style=r[7], time_raw=r[9]))
            else:
                r = struct.unpack_from("<ifff", b, off)
                results.append(dict(order=r[0], time=r[1], diff=r[2], delay=r[3],
                                    spurt=None, style=None, time_raw=None))
            off += hrs
        (pad,) = struct.unpack_from("<i", b, off)
        off += 4 + pad
        (ec,) = struct.unpack_from("<i", b, off)
        off += 4
        events = []
        for _ in range(ec):
            (es,) = struct.unpack_from("<h", b, off)
            off += 2
            t, typ, pc = struct.unpack_from("<fbb", b, off)
            params = struct.unpack_from("<%di" % pc, b, off + 6) if pc > 0 else ()
            events.append((t, typ, params))
            off += es
        sc = Scenario(frames, results, events)
        sc.distance = _estimate_distance(sc)
        return sc
    except Exception:  # unexpected format: carry on without the replay
        return None


def _estimate_distance(sc: Scenario) -> Optional[int]:
    """Course length: the winner's position at its finish time, rounded to 100 m."""
    if not sc.frames or not sc.results:
        return None
    win = min(range(len(sc.results)), key=lambda i: sc.results[i]["order"])
    t_end = sc.results[win]["time_raw"]
    if t_end is not None:
        for (t0, h0), (t1, h1) in zip(sc.frames, sc.frames[1:]):
            if t0 <= t_end <= t1 and t1 > t0:
                d = h0[win][0] + (h1[win][0] - h0[win][0]) * (t_end - t0) / (t1 - t0)
                return int(round(d / 100.0) * 100)
    return None


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass
class UmaRace:
    session: str
    rnd: int
    race_id: int
    dist_type: int
    distance: Optional[int]
    tcid: int
    chara_id: int
    card_id: int
    name: str
    slot: int
    style: int
    stats: Dict[str, int]
    apt_dist: Optional[int]
    apt_ground: Optional[int]
    apt_style: Optional[int]
    mood: int
    popularity: int
    finish: int
    finish_time: Optional[float]
    win: bool
    raw: int = 0
    final: int = 0
    cat_raw: Counter = field(default_factory=Counter)
    cat_final: Counter = field(default_factory=Counter)
    cat_count: Counter = field(default_factory=Counter)
    entries: list = field(default_factory=list)          # (rid, num, raw, final)
    skills_owned: Dict[int, int] = field(default_factory=dict)
    skill_acts: Counter = field(default_factory=Counter)
    skill_type: Dict[int, str] = field(default_factory=dict)
    skill_points: Counter = field(default_factory=Counter)  # base points per skill
    unique_value: Optional[int] = None
    start_delay: Optional[float] = None
    rushed_secs: int = 0
    rushed_loss: int = 0
    spurt_late: Optional[float] = None   # metres the final spurt started after the 2/3 mark
    hp_start: Optional[int] = None
    hp_end_pct: Optional[float] = None
    hp_zero_left: Optional[float] = None  # metres to the finish when HP ran out
    blocked_late: Optional[float] = None
    multipliers: list = field(default_factory=list)

    @property
    def key(self):
        """Identity of the trained uma: trained_chara_id, or character + stats if missing."""
        if self.tcid:
            return self.tcid
        return (self.chara_id, self.card_id, tuple(self.stats[k] for k, _ in STAT_KEYS))

    @property
    def is_ace(self) -> bool:
        return self.slot == 1

    @property
    def rushed(self) -> bool:
        return self.cat_count["rushed"] > 0

    @property
    def stamina_short(self) -> bool:
        return (self.hp_zero_left is not None and self.hp_zero_left > 10) or \
               (self.spurt_late is not None and self.spurt_late > 10)

    @property
    def unique_level(self) -> Optional[int]:
        for sid, lv in self.skills_owned.items():
            if 100000 <= sid < 200000:
                return lv
        return None

    @property
    def has_unique(self) -> bool:
        return any(100000 <= sid < 200000 for sid in self.skills_owned)


@dataclass
class Opponent:
    name: str
    chara_id: int
    slot: int
    style: int
    stats: Dict[str, int]
    finish: int


@dataclass
class Race:
    session: str
    rnd: int
    race_id: int
    dist_type: int
    distance: Optional[int]
    season: int
    weather: int
    ground: int
    win: bool
    streak_after: int
    total: int
    team_raw: int
    team_final: int
    team_ids: List[int]
    ours: List[UmaRace]
    opponents: List[Opponent]
    winner_side: str             # "us" / "opponents" / "others"
    check_ok: bool


@dataclass
class Session:
    label: str
    path: str
    self_eval: Optional[int]
    opp_eval: Optional[int]
    support_bonus: Optional[int]
    races: List[Race]
    bonus_rates: Dict[str, List[float]]

    @property
    def total(self) -> int:
        return sum(r.total for r in self.races)

    @property
    def wins(self) -> int:
        return sum(1 for r in self.races if r.win)


STAT_KEYS = [("speed", "SPD"), ("stamina", "STA"), ("pow", "POW"), ("guts", "GUT"), ("wiz", "WIT")]


def dist_category(meters: Optional[int], dist_type: int) -> str:
    if meters:
        if meters <= 1400:
            return "short"
        if meters <= 1800:
            return "mile"
        if meters <= 2400:
            return "middle"
        return "long"
    return {1: "short", 2: "mile", 3: "middle", 4: "long"}.get(dist_type, "mile")


def chara_name(chara_id: int, card_id: int) -> str:
    base = CHARA_NAMES.get(chara_id, f"Chara {chara_id}")
    if card_id and card_id % 100 != 1:
        base += " (alt)"
    return base


def session_label(path: str) -> str:
    m = re.search(r"(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})", os.path.basename(path))
    if m:
        y, mo, d, h, mi, s = m.groups()
        return f"{y}-{mo}-{d} {h}:{mi}:{s}"
    return os.path.splitext(os.path.basename(path))[0]


def load_session(path: str) -> Session:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if "race_result_array" not in data and isinstance(data.get("data"), dict):
        data = data["data"]
    if "race_result_array" not in data or "race_start_params_array" not in data:
        raise ValueError("does not look like a Team Trials results file")

    label = session_label(path)
    starts = {sp.get("round"): sp for sp in data["race_start_params_array"]}
    bonus_rates: Dict[str, List[float]] = defaultdict(list)
    races: List[Race] = []
    self_eval = opp_eval = None

    for rr in data["race_result_array"]:
        rnd = rr.get("round")
        sp = starts.get(rnd, {})
        self_eval = sp.get("self_evaluate", self_eval)
        opp_eval = sp.get("opponent_evaluate", opp_eval)
        horses = {h["frame_order"]: h for h in sp.get("race_horse_data_array", [])}
        results = {c["frame_order"]: c for c in rr.get("chara_result_array", [])}

        # our team = the one that has scores (fallback: team_id 1)
        our_team = next((c["team_id"] for c in results.values() if c.get("score_array")), 1)
        sc = parse_scenario(rr.get("race_scenario"))
        distance = sc.distance if sc else None
        win = rr.get("win_type") == 1

        ours: List[UmaRace] = []
        opponents: List[Opponent] = []
        for fo, c in sorted(results.items()):
            h = horses.get(fo, {})
            tid = c.get("team_id", 0)
            stats = {k: h.get(k, 0) for k, _ in STAT_KEYS}
            if tid != our_team:
                if tid:
                    opponents.append(Opponent(
                        name=chara_name(h.get("chara_id", 0), h.get("card_id", 0)),
                        chara_id=h.get("chara_id", 0), slot=h.get("team_member_id", 0),
                        style=h.get("running_style", 0), stats=stats,
                        finish=c.get("finish_order", 0)))
                continue
            cat = dist_category(distance, rr.get("distance_type", 0))
            apt_dist = h.get(f"proper_distance_{cat}")
            apt_ground = h.get("proper_ground_dirt" if rr.get("distance_type") == 5 else "proper_ground_turf")
            style = h.get("running_style", 0)
            apt_style = h.get({1: "proper_running_style_nige", 2: "proper_running_style_senko",
                               3: "proper_running_style_sashi", 4: "proper_running_style_oikomi"}.get(style, ""), None)
            u = UmaRace(
                session=label, rnd=rnd, race_id=sp.get("race_instance_id", 0),
                dist_type=rr.get("distance_type", 0), distance=distance,
                tcid=c.get("trained_chara_id", h.get("trained_chara_id", 0)),
                chara_id=h.get("chara_id", 0), card_id=h.get("card_id", 0),
                name=chara_name(h.get("chara_id", 0), h.get("card_id", 0)),
                slot=h.get("team_member_id", 0), style=style, stats=stats,
                apt_dist=apt_dist, apt_ground=apt_ground, apt_style=apt_style,
                mood=h.get("motivation", 0), popularity=h.get("popularity", 0),
                finish=c.get("finish_order", 0), finish_time=c.get("finish_time", 0) / 10000.0 or None,
                win=win,
                skills_owned={s["skill_id"]: s.get("level", 1) for s in h.get("skill_array", [])},
            )
            for s in c.get("score_array", []):
                bsum = sum(b.get("bonus_score", 0) for b in s.get("bonus_array", []))
                raw = s["score"] - bsum
                cat_key, _ = score_category(s["raw_score_id"])
                u.raw += raw
                u.final += s["score"]
                u.cat_raw[cat_key] += raw
                u.cat_final[cat_key] += s["score"]
                if s["raw_score_id"] != 24:  # rushed seconds are not separate events
                    u.cat_count[cat_key] += s.get("num", 1)
                u.entries.append((s["raw_score_id"], s.get("num", 1), raw, s["score"]))
                if cat_key == "rushed":
                    u.rushed_loss += -raw
                    if s["raw_score_id"] == 24:
                        u.rushed_secs += s.get("num", 1)
                if cat_key == "unique" and s.get("num", 1):
                    u.unique_value = raw // max(1, s.get("num", 1))
                if raw > 0:
                    u.multipliers.append(s["score"] / raw)
                    for b in s.get("bonus_array", []):
                        bonus_rates[bonus_kind(b)].append(b.get("bonus_score", 0) / raw)
            if sc is not None:
                _scenario_diagnostics(u, sc, fo - 1)
            ours.append(u)

        team_raw = team_final = 0
        team_ids = []
        for ts in rr.get("team_score_array", []):
            bsum = sum(b.get("bonus_score", 0) for b in ts.get("bonus_array", []))
            team_raw += ts["score"] - bsum
            team_final += ts["score"]
            team_ids.append(ts["raw_score_id"])
            raw = ts["score"] - bsum
            if raw > 0:
                for b in ts.get("bonus_array", []):
                    bonus_rates[bonus_kind(b)].append(b.get("bonus_score", 0) / raw)

        first = next((c for c in results.values() if c.get("finish_order") == 1), None)
        if first is None:
            winner_side = "?"
        elif first.get("team_id") == our_team:
            winner_side = "us"
        elif first.get("team_id"):
            winner_side = "opponents"
        else:
            winner_side = "others"

        total = rr.get("team_total_score", 0)
        check_ok = (sum(u.final for u in ours) + team_final) == total
        races.append(Race(
            session=label, rnd=rnd, race_id=sp.get("race_instance_id", 0),
            dist_type=rr.get("distance_type", 0), distance=distance,
            season=sp.get("season", 0), weather=sp.get("weather", 0), ground=sp.get("ground_condition", 0),
            win=win, streak_after=rr.get("current_consecutive_win_count", 0), total=total,
            team_raw=team_raw, team_final=team_final, team_ids=team_ids,
            ours=ours, opponents=opponents, winner_side=winner_side, check_ok=check_ok))

    races.sort(key=lambda r: r.rnd)
    return Session(label=label, path=path, self_eval=self_eval, opp_eval=opp_eval,
                   support_bonus=data.get("support_card_bonus"), races=races,
                   bonus_rates=dict(bonus_rates))


def _scenario_diagnostics(u: UmaRace, sc: Scenario, idx: int) -> None:
    """Metrics taken from the replay for the uma at index `idx`."""
    if idx >= len(sc.results):
        return
    res = sc.results[idx]
    u.start_delay = res["delay"]

    # activated skills and the points each one produced (the score event follows the skill event)
    pending = None
    for t, typ, p in sc.events:
        if not p or p[0] != idx:
            continue
        if typ == EV_SKILL and len(p) >= 2:
            u.skill_acts[p[1]] += 1
            pending = (t, p[1])
        elif typ == EV_SCORE and len(p) >= 3 and pending and abs(pending[0] - t) < 1e-4:
            cat_key, _ = score_category(p[1])
            if cat_key in SKILL_CATS:
                u.skill_type[pending[1]] = cat_key
                u.skill_points[pending[1]] += p[2]
                pending = None

    D = sc.distance
    if not D or not sc.frames:
        return
    if res.get("spurt") and res["spurt"] > 0:
        u.spurt_late = res["spurt"] - D * 2.0 / 3.0
    u.hp_start = sc.frames[0][1][idx][3] or None
    hp_end = None
    late_frames = blocked = 0
    for _t, hs in sc.frames:
        d, _lane, _spd, hp, _temp, block = hs[idx]
        if d >= D:
            hp_end = hp
            break
        if hp == 0 and u.hp_zero_left is None:
            u.hp_zero_left = D - d
        if d >= D * 2.0 / 3.0:
            late_frames += 1
            if block != -1:
                blocked += 1
    if hp_end is not None and u.hp_start:
        u.hp_end_pct = hp_end / u.hp_start
    if late_frames:
        u.blocked_late = blocked / late_frames


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------


@dataclass
class UmaAgg:
    key: object
    name: str
    races: List[UmaRace]
    current: bool = True    # present in the latest session (current team)

    @property
    def tcid(self) -> int:
        return self.races[0].tcid

    @property
    def label(self) -> str:
        return self.name if self.current else f"{self.name} (former)"

    @property
    def n(self) -> int:
        return len(self.races)

    @property
    def last(self) -> UmaRace:
        return self.races[-1]

    @property
    def dist_label(self) -> str:
        c = Counter(r.dist_type for r in self.races)
        return "/".join(DIST_NAMES.get(d, str(d)) for d, _ in c.most_common())

    @property
    def main_dist(self) -> int:
        return Counter(r.dist_type for r in self.races).most_common(1)[0][0]

    def avg(self, attr: str):
        return safe_mean([getattr(r, attr) for r in self.races])

    def count(self, pred) -> int:
        return sum(1 for r in self.races if pred(r))

    @property
    def multiplier(self) -> float:
        return safe_mean([m for r in self.races for m in r.multipliers], 1.0)


def aggregate_umas(sessions: List[Session]) -> List[UmaAgg]:
    """One entry per trained uma. The current team is the one in the latest session (by date)."""
    sessions = sorted(sessions, key=lambda s: s.label)
    by: Dict[object, List[UmaRace]] = {}
    for s in sessions:
        for r in s.races:
            for u in r.ours:
                by.setdefault(u.key, []).append(u)
    latest = sessions[-1].label if sessions else None
    aggs = [UmaAgg(key, rs[0].name, rs, current=any(r.session == latest for r in rs)) for key, rs in by.items()]
    # same character trained more than once: v1, v2, ... in order of first appearance
    groups: Dict[str, List[UmaAgg]] = defaultdict(list)
    for a in aggs:
        groups[a.name].append(a)
    for name, group in groups.items():
        if len(group) > 1:
            for i, a in enumerate(group, 1):
                a.name = f"{name} v{i}"
    aggs.sort(key=lambda a: (a.main_dist, not a.current, a.last.slot, a.name))
    return aggs


def team_changes(sessions: List[Session], umas: List[UmaAgg]) -> List[dict]:
    """Team differences between each session and the previous one: umas in, out and moved."""
    labels = {a.key: a.name for a in umas}
    out = []
    prev = None
    for s in sorted(sessions, key=lambda s: s.label):
        cur = {u.key: (u.dist_type, u.slot) for r in s.races for u in r.ours}
        if prev is not None and cur != prev:
            def where(v):
                return f"{DIST_NAMES.get(v[0], v[0])}, slot {v[1]}"
            out.append(dict(
                session=s.label,
                entered=[f"{labels.get(k, k)} ({where(v)})" for k, v in cur.items() if k not in prev],
                left=[labels.get(k, str(k)) for k in prev if k not in cur],
                moved=[f"{labels.get(k, k)}: {where(prev[k])} -> {where(v)}"
                       for k, v in cur.items() if k in prev and prev[k] != v],
            ))
        prev = cur
    return out


def rushed_chance(wiz: int) -> float:
    """Theoretical chance of getting rushed given Wit: ((6.5 / log10(0.1*WIT + 1))^2)%."""
    if wiz <= 0:
        return 1.0
    return min(1.0, (6.5 / math.log10(0.1 * wiz + 1)) ** 2 / 100.0)


def skill_chance(wiz: int) -> float:
    """Theoretical chance that a skill passes the Wit check: max(100 - 9000/WIT, 20)%."""
    if wiz <= 0:
        return 0.2
    return max(0.2, 1.0 - 90.0 / wiz)


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------


class Report:
    def __init__(self, markdown: bool = False):
        self.md = markdown
        self.lines: List[str] = []

    def h1(self, s: str):
        if self.md:
            self.lines += [f"# {s}", ""]
        else:
            self.lines += ["=" * len(s), s, "=" * len(s), ""]

    def h2(self, s: str):
        if self.md:
            self.lines += [f"## {s}", ""]
        else:
            self.lines += ["", s.upper(), "-" * len(s), ""]

    def p(self, s: str = ""):
        self.lines.append(s)
        if self.md and s:
            self.lines.append("")

    def bullet(self, s: str):
        self.lines.append(f"- {s}" if self.md else f"  * {s}")

    def table(self, headers: List[str], rows: List[List], align: str = ""):
        srows = [[("-" if c is None else str(c)) for c in r] for r in rows]
        ncol = len(headers)
        if not align:
            align = "l" + "r" * (ncol - 1)
        if self.md:
            self.lines.append("| " + " | ".join(headers) + " |")
            self.lines.append("|" + "|".join(":--" if a == "l" else "--:" for a in align) + "|")
            for r in srows:
                self.lines.append("| " + " | ".join(c.replace("|", "/") for c in r) + " |")
            self.lines.append("")
            return
        widths = [max([len(headers[i])] + [len(r[i]) for r in srows]) for i in range(ncol)]

        def fmt(cells):
            out = []
            for i, c in enumerate(cells):
                out.append(c.ljust(widths[i]) if align[i] == "l" else c.rjust(widths[i]))
            return "  " + "  ".join(out).rstrip()

        self.lines.append(fmt(headers))
        self.lines.append("  " + "  ".join("-" * w for w in widths))
        for r in srows:
            self.lines.append(fmt(r))
        self.lines.append("")

    def render(self) -> str:
        return "\n".join(self.lines).rstrip() + "\n"


@dataclass
class SkillDB:
    names: Dict[int, str] = field(default_factory=dict)
    rarity: Dict[int, int] = field(default_factory=dict)

    def name(self, sid: int) -> Optional[str]:
        n = self.names.get(sid)
        if n and 900000 <= sid < 1000000 and "inherit" not in n.lower():
            n += " (inherited)"
        return n

    def label(self, sid: int) -> str:
        n = self.name(sid)
        return f"{n} [{sid}]" if n else str(sid)

    def kind(self, sid: int, observed: Optional[str] = None) -> str:
        """Skill kind: from the database, else from the observed score, else from the ID."""
        if 900000 <= sid < 1000000:
            return "inherited"
        r = self.rarity.get(sid)
        if r:
            return "white" if r == 1 else "gold" if r == 2 else "unique"
        if observed in SKILL_CATS:
            return observed
        return "unique" if 100000 <= sid < 200000 else "?"


START_SKILLS = {200431, 200432}  # Concentration (gold) and Focus (white): shorten the start delay


def build_report(sessions: List[Session], args, skills: SkillDB) -> str:
    R = Report(markdown=bool(args.md_mode))
    races = [r for s in sessions for r in s.races]
    umas = aggregate_umas(sessions)
    labels = {a.key: a.label for a in umas}
    changes = team_changes(sessions, umas)
    all_ur = [u for r in races for u in r.ours]
    n_races = len(races)
    if not n_races:
        return "No races found.\n"
    n_current = sum(1 for a in umas if a.current)

    R.h1("UmaStatsTT - Team Trials analysis")
    R.p(f"Files analyzed: {len(sessions)}  |  Races: {n_races}  |  Umas on the team: {n_current}"
        + (f" (+{len(umas) - n_current} no longer on the team)" if len(umas) > n_current else ""))
    bad = [r for r in races if not r.check_ok]
    if bad:
        R.p(f"WARNING: in {len(bad)} races the points do not add up to the total (incomplete data?).")
    if any(u.start_delay is None for u in all_ur):
        R.p("Note: some races have no replay (race_scenario): HP/skill diagnostics are partial.")

    allrates = defaultdict(list)
    for s in sessions:
        for k, v in s.bonus_rates.items():
            allrates[k] += v
    mult_std = 1 + sum(safe_mean(allrates.get(k, []), 0) for k in ("opponent", "support"))
    est, notes = make_recommendations(umas, races, all_ur, mult_std, skills)

    R.h2("Summary")
    R.p(f"Average {fi(sum(s.total for s in sessions) / len(sessions))} points per session, "
        f"{fi(sum(s.total for s in sessions) / n_races)} per race. The 5 things worth the most "
        f"(estimated final points per session):")
    for gain, text in est[:5]:
        R.bullet(f"[~{fi(gain)}] {text}")
    for _prio, text in [x for x in notes if x[0] == 1]:
        R.bullet(f"[!] {text}")
    R.p()
    if changes:
        R.p(f"The team changed in {len(changes)} {plural(len(changes), 'session', 'sessions')}: the advice covers "
            f"the current team, i.e. the one in the latest session ({sessions[-1].label}). Umas that left stay in "
            f"the statistics marked '(former)'.")
        R.p()

    # ---------------- Sessions
    R.h2("Sessions")
    rows = []
    for s in sessions:
        opp = safe_mean(s.bonus_rates.get("opponent", []))
        sup = safe_mean(s.bonus_rates.get("support", []))
        rows.append([s.label, fi(s.total), f"{s.wins}-{len(s.races) - s.wins}", fi(s.total / max(1, len(s.races))),
                     fi(s.opp_eval), pct(opp, 1), pct(sup, 2)])
    tot = sum(s.total for s in sessions)
    rows.append(["AVERAGE", fi(tot / len(sessions)), ff(sum(s.wins for s in sessions) / len(sessions), 1) + " W",
                 fi(tot / n_races), "", "", ""])
    R.table(["Session", "Score", "W-L", "Per race", "Opp. rating", "Opp. bonus", "Support"], rows)
    if changes:
        R.p("Team changes:")
        for c in changes:
            parts = []
            if c["entered"]:
                parts.append("in: " + ", ".join(c["entered"]))
            if c["left"]:
                parts.append("out: " + ", ".join(c["left"]))
            if c["moved"]:
                parts.append("moved: " + ", ".join(c["moved"]))
            R.bullet(f"{c['session']}: " + "; ".join(parts))
        R.p()

    # ---------------- How the score works
    R.h2("How the score is built (derived from your data)")
    R.p("Race score = sum of each event's base points x (1 + bonuses) + team bonus.")
    sup_cfg = sorted({s.support_bonus for s in sessions if s.support_bonus})
    for k in ("opponent", "support", "ace", "streak"):
        if k == "support" and sup_cfg:
            R.bullet(f"{BONUS_LABELS[k]}: " + ", ".join(pct(v / 10000, 2) for v in sup_cfg) +
                     " (support_card_bonus value in the file)")
            continue
        if allrates.get(k):
            vals = allrates[k]
            rng = f"{pct(min(vals), 1)} - {pct(max(vals), 1)}" if max(vals) - min(vals) > 0.002 else pct(mean(vals), 1)
            R.bullet(f"{BONUS_LABELS.get(k, k)}: {rng}")
    R.p()
    R.p(f"=> 1 base point is worth about {ff(mult_std, 2)} final points ({ff(mult_std + 0.10, 2)} for the uma in slot 1).")
    R.p("   Every bonus is a percentage: to go up, raise your BASE POINTS.")
    if allrates.get("opponent"):
        a, b, c = OPP_BONUS_FIT
        R.p(f"   Opponent bonus = {pct(a, 2)} + {ff(b * 1e5, 2)}% per 1,000 opponent rating "
            f"- {ff(-c * 1e5, 2)}% per 1,000 of your own rating.")
        errs = [abs(safe_mean(s.bonus_rates.get("opponent", []), 0) - opp_bonus_model(s.opp_eval, s.self_eval))
                for s in sessions if s.opp_eval and s.self_eval and s.bonus_rates.get("opponent")]
        if errs:
            R.p(f"   On your sessions the formula is off by at most {ff(100 * max(errs), 2)} points.")
    R.p()

    # value per event, by category
    unit_vals = defaultdict(set)
    for u in all_ur:
        for rid, num, raw, _f in u.entries:
            if num:
                unit_vals[score_category(rid)[0]].add(raw // num)
    R.p("Base points per event (observed):")
    rows = []
    for ck in CATEGORY_ORDER:
        if ck not in unit_vals and ck != "team":
            continue
        if ck == "team":
            tv = sorted({r.team_raw for r in races if r.team_raw})
            if not tv:
                continue
            vals = ", ".join(fi(v) for v in tv)
        else:
            vs = sorted(unit_vals[ck])
            vals = fi(vs[0]) if len(vs) == 1 else f"{fi(vs[0])} .. {fi(vs[-1])}"
        rows.append([CATEGORY_LABELS[ck], vals])
    R.table(["Event", "Base points"], rows, "lr")
    R.p("Finishing position: 1st 10,000, 2nd 8,000, 3rd 7,000, 4th 6,000, 5th 5,000, 6th-7th 4,000 ... "
        "(about -1,000 per place).")
    R.p("Team: all 3 in the top 5 = 4,000, all 3 in the top 3 = 5,000.")

    # ---------------- Where the points come from
    R.h2("Where the points come from")
    cat_raw = Counter()
    cat_final = Counter()
    cat_cnt = Counter()
    cat_hits = Counter()   # runs in which the category shows up
    for u in all_ur:
        cat_raw.update(u.cat_raw)
        cat_final.update(u.cat_final)
        cat_cnt.update(u.cat_count)
        for k in u.cat_raw:
            cat_hits[k] += 1
    cat_raw["team"] += sum(r.team_raw for r in races)
    cat_final["team"] += sum(r.team_final for r in races)
    cat_cnt["team"] += sum(1 for r in races if r.team_ids)
    cat_hits["team"] += sum(1 for r in races if r.team_ids)
    grand = sum(cat_final.values())
    rows = []
    for ck in CATEGORY_ORDER:
        if not cat_raw.get(ck) and not cat_cnt.get(ck):
            continue
        denom = n_races if ck == "team" else len(all_ur)
        rows.append([CATEGORY_LABELS[ck], fi(cat_cnt[ck]), f"{cat_hits[ck]}/{denom}",
                     fi(cat_raw[ck]), fi(cat_final[ck]), pct(cat_final[ck] / grand, 1),
                     fi(cat_final[ck] / n_races)])
    rows.append(["TOTAL", "", "", fi(sum(cat_raw.values())), fi(grand), "100%", fi(grand / n_races)])
    R.table(["Category", "Events", "Present", "Base total", "Final total", "% total", "Final/race"], rows)
    R.p("'Present' = in how many runs (one uma in one race; for the team bonus: races) the category shows up.")

    # ---------------- By distance
    R.h2("By distance")
    rows = []
    for dt in sorted({r.dist_type for r in races}):
        rs = [r for r in races if r.dist_type == dt]
        urs = [u for r in rs for u in r.ours]
        dists = sorted({r.distance for r in rs if r.distance})
        rows.append([DIST_NAMES.get(dt, dt), ", ".join(f"{d}m" for d in dists) or "-", len(rs),
                     f"{sum(r.win for r in rs)}-{sum(not r.win for r in rs)}",
                     fi(mean(r.total for r in rs)), ff(mean(u.finish for u in urs), 1),
                     f"{sum(1 for r in rs if r.team_ids)}/{len(rs)}",
                     f"{sum(1 for r in rs if r.winner_side == 'us')}/{len(rs)}"])
    R.table(["Distance", "Courses", "Races", "W-L", "Points/race", "Avg place", "Team bonus", "Our 1st"], rows)
    consistent = sum(1 for r in races if r.win == (r.winner_side == "us"))
    if consistent == n_races:
        R.p(f"Observation: in all {n_races} races, the team with the 1st-place uma won the race.")
    else:
        R.p(f"Observation: the race went to the team with the 1st-place uma in {consistent}/{n_races} races.")

    # ---------------- Per uma: performance
    R.h2("Performance by uma")
    rows = []
    for a in umas:
        rows.append([a.label, a.dist_label, STYLE_NAMES.get(a.last.style, "?"),
                     ("former" if not a.current else "ACE" if a.last.slot == 1 else str(a.last.slot)), a.n,
                     ff(a.avg("finish"), 1),
                     ("+" + str(a.n - 12) + " " if a.n > 12 else "") + " ".join(str(r.finish) for r in a.races[-12:]),
                     fi(a.avg("raw")), fi(a.avg("final")),
                     fi(safe_mean([r.cat_raw["place"] for r in a.races])),
                     fi(safe_mean([sum(r.cat_raw[k] for k in SKILL_CATS) for r in a.races])),
                     fi(safe_mean([r.cat_raw["start"] + r.cat_raw["lead16"] + r.cat_raw["lead23"] for r in a.races])),
                     fi(safe_mean([r.cat_raw["rushed"] for r in a.races]))])
    R.table(["Uma", "Dist.", "Style", "Slot", "Races", "Place", "Last finishes", "Base/r", "Final/r",
             "Placing", "Skills", "Pos/start", "Rushed"], rows, "lllrrrlrrrrrr")
    R.p("Placing/Skills/Pos-start/Rushed columns = average base points per race from: finishing position,")
    R.p("skills, perfect start + leading own strategy (1/6 and 2/3), rushed penalty.")

    # ---------------- Per uma: diagnostics
    R.h2("Diagnostics by uma")
    rows = []
    for a in umas:
        n = a.n
        has_uni = any(r.has_unique for r in a.races)
        uni_k = a.count(lambda r: r.cat_count["unique"] > 0)
        hp_end = safe_mean([r.hp_end_pct for r in a.races])
        rows.append([
            a.label,
            ff(safe_mean([r.cat_count["white"] for r in a.races]), 1),
            ff(safe_mean([r.cat_count["gold"] for r in a.races]), 1),
            (frac(uni_k, n) + (f" L{a.last.unique_level}" if a.last.unique_level else "")) if has_uni else "-",
            frac(a.count(lambda r: r.cat_count["start"] > 0), n),
            frac(a.count(lambda r: r.cat_count["lead16"] > 0), n),
            frac(a.count(lambda r: r.cat_count["lead23"] > 0), n),
            frac(a.count(lambda r: r.rushed), n),
            frac(a.count(lambda r: r.hp_zero_left is not None and r.hp_zero_left > 10), n),
            frac(a.count(lambda r: r.spurt_late is not None and r.spurt_late > 10), n),
            pct(hp_end),
            pct(safe_mean([r.blocked_late for r in a.races])),
        ])
    R.table(["Uma", "White/r", "Gold/r", "Unique", "Perf.start", "Lead 1/6", "Lead 2/3",
             "Rushed", "Out of HP", "Late spurt", "HP left", "Blocked"], rows)
    R.p("Unique = races in which the unique skill fired (Lx = level).")
    R.p("Out of HP = HP hit zero before the finish. Late spurt = final spurt started >10 m after the 2/3 mark")
    R.p("(a sign of too little stamina). HP left = average HP remaining at the finish. Blocked = % of time")
    R.p("with an uma ahead blocking the way, in the last third of the race.")

    # ---------------- Stats and aptitudes
    R.h2("Stats and aptitudes")
    rows = []
    for a in umas:
        u = a.last
        rows.append([a.label, *[fi(u.stats[k]) for k, _ in STAT_KEYS],
                     APT_LETTERS.get(u.apt_dist, "?"), APT_LETTERS.get(u.apt_ground, "?"),
                     APT_LETTERS.get(u.apt_style, "?"),
                     pct(skill_chance(u.stats["wiz"])), pct(rushed_chance(u.stats["wiz"])),
                     " ".join(MOOD_NAMES.get(r.mood, "?")[:3] for r in a.races)])
    R.table(["Uma"] + [lbl for _, lbl in STAT_KEYS] +
            ["Apt.dist", "Apt.track", "Apt.style", "Skill ok", "Rushed", "Mood per race"], rows,
            "lrrrrrrrrrrl")
    R.p("Skill ok / Rushed = theoretical chances from WIT: a skill firing")
    R.p("(max(100 - 9000/WIT, 20)%) and getting rushed ((6.5 / log10(WIT/10 + 1))^2 %). Aptitude below A = penalty.")

    # ---------------- Us vs opponents
    R.h2("Us vs opponents (average stats by distance)")
    rows = []
    for dt in sorted({r.dist_type for r in races}):
        rs = [r for r in races if r.dist_type == dt]
        ours = [u.stats for r in rs for u in r.ours]
        opps = [o.stats for r in rs for o in r.opponents]
        if not opps:
            continue
        cells = [DIST_NAMES.get(dt, dt)]
        for k, _ in STAT_KEYS:
            mo, mp = mean(s[k] for s in ours), mean(s[k] for s in opps)
            cells.append(f"{fi(mo)} / {fi(mp)} ({'+' if mo - mp >= 0 else ''}{fi(mo - mp)})")
        cells.append(ff(mean(u.finish for r in rs for u in r.ours), 1) + " / " +
                     ff(mean(o.finish for r in rs for o in r.opponents), 1))
        rows.append(cells)
    R.table(["Distance"] + [f"{lbl} us/opp" for _, lbl in STAT_KEYS] + ["Place us/opp"], rows)
    lost = [r for r in races if not r.win]
    if lost:
        R.p("Who won the races you lost:")
        for r in lost:
            w = next((o for o in r.opponents if o.finish == 1), None)
            if w:
                st = " ".join(f"{lbl} {w.stats[k]}" for k, lbl in STAT_KEYS)
                best = min(r.ours, key=lambda u: u.finish)
                R.bullet(f"{r.session} R{r.rnd} {DIST_NAMES.get(r.dist_type)} {r.distance or ''}m: "
                         f"{w.name} ({STYLE_NAMES.get(w.style, '?')}) {st}  | your best: "
                         f"{labels.get(best.key, best.name)} {ordinal(best.finish)}")
            else:
                R.bullet(f"{r.session} R{r.rnd} {DIST_NAMES.get(r.dist_type)}: won by an uma outside both teams")
        R.p()

    # ---------------- Mood
    R.h2("Random factors")
    rows = []
    for m in sorted({u.mood for u in all_ur}):
        us = [u for u in all_ur if u.mood == m]
        rows.append([MOOD_NAMES.get(m, m), len(us), ff(mean(u.finish for u in us), 1), fi(mean(u.raw for u in us))])
    R.table(["Mood", "Runs", "Avg place", "Avg base"], rows)
    starts = [u.start_delay for u in all_ur if u.start_delay is not None]
    if starts:
        perf = sum(1 for d in starts if d < 0.02)
        R.p(f"Perfect starts (<0.02 s): {perf}/{len(starts)} ({pct(perf / len(starts))}); average delay "
            f"{ff(mean(starts), 3)} s. Without start skills you can expect about 20%.")

    # ---------------- Skills
    R.h2("Skills")
    R.p("Every activation is worth base points: white/inherited 500, gold 1,200, unique 2,300-2,500 (grows with level).")
    R.p("Passive (green) skills that fire at the start count as activations too.")
    R.p()
    for a in umas:
        owned = {}
        for r in a.races:
            owned.update(r.skills_owned)
        acts = Counter()
        types = {}
        pts = Counter()
        for r in a.races:
            acts.update(r.skill_acts)
            types.update(r.skill_type)
            pts.update(r.skill_points)
        never = [sid for sid in owned if acts[sid] == 0]
        line = (f"{a.label}: {len(owned)} skills, {ff(sum(acts[s] for s in owned) / a.n, 1)} activations per race, "
                f"{fi(sum(pts.values()) / a.n)} base points from skills per race.")
        R.p(line)
        if never:
            R.p(f"    Never fired in {a.n} {plural(a.n, 'race', 'races')}: " +
                ", ".join(f"{skills.label(s)} ({skills.kind(s, types.get(s))})" for s in sorted(never)))
        if args.skills:
            rows = []
            for sid in sorted(owned, key=lambda s: (-acts[s], s)):
                rows.append([skills.name(sid) or "?", sid, skills.kind(sid, types.get(sid)), f"L{owned[sid]}",
                             f"{acts[sid]}/{a.n}", fi(pts[sid])])
            R.table(["Skill", "ID", "Kind", "Lvl", "Activations", "Base points"], rows, "lrllrr")
    all_ids = {sid for u in all_ur for sid in u.skills_owned}
    unnamed = sorted(sid for sid in all_ids if not skills.name(sid))
    if unnamed:
        R.p()
        R.p(f"({len(unnamed)} skills have no name in the database: refresh it with --update-names.)")

    # ---------------- Priorities
    R.h2("What to improve (estimated priorities)")
    R.p(f"Estimates in FINAL points per session (5 races); 1 base point ~ {ff(mult_std, 2)} final. Sorted by gain.")
    R.p()
    for gain, text in est:
        R.bullet(f"[~{fi(gain)}] {text}")
    R.p()
    R.p("Other notes (not quantifiable):")
    for _prio, text in notes:
        R.bullet(text)
    R.p()

    # ---------------- Race details
    if args.details:
        R.h2("Race details")
        for s in sessions:
            for r in s.races:
                res = "WON" if r.win else "lost"
                R.p(f"{s.label} - R{r.rnd} {DIST_NAMES.get(r.dist_type)} {r.distance or '?'}m "
                    f"({WEATHER_NAMES.get(r.weather, '?')}, {GROUND_NAMES.get(r.ground, '?')}) - {res} - "
                    f"{fi(r.total)} points" + (f" (team bonus {fi(r.team_final)})" if r.team_final else ""))
                rows = []
                for u in sorted(r.ours, key=lambda x: x.finish):
                    tags = []
                    if u.rushed:
                        tags.append(f"rushed {u.rushed_secs}s")
                    if u.hp_zero_left:
                        tags.append(f"out of HP {fi(u.hp_zero_left)}m out")
                    if u.spurt_late and u.spurt_late > 10:
                        tags.append(f"spurt +{fi(u.spurt_late)}m")
                    if u.cat_count["start"]:
                        tags.append("perfect start")
                    if u.cat_count["margin"]:
                        tags.append("margin")
                    if u.cat_count["upset"]:
                        tags.append("upset")
                    if u.cat_count["time"]:
                        tags.append("time bonus")
                    rows.append([labels.get(u.key, u.name), ("ACE" if u.is_ace else u.slot), u.finish, u.popularity,
                                 MOOD_NAMES.get(u.mood, "?"), fi(u.raw), fi(u.final),
                                 f"{u.cat_count['white']}/{u.cat_count['gold']}/{u.cat_count['unique']}",
                                 ", ".join(tags)])
                for o in sorted(r.opponents, key=lambda x: x.finish):
                    rows.append([f"  opp. {o.name}", o.slot, o.finish, "", "", "", "", "", STYLE_NAMES.get(o.style, "")])
                R.table(["Uma", "Slot", "Fin.", "Pop.", "Mood", "Base", "Final", "Sk w/g/u", "Notes"], rows,
                        "lrrrlrrrl")

    R.h2("Legend: events that give base points")
    for line in LEGEND:
        R.bullet(line)
    R.p()
    R.p("Rules derived by matching every score event against the race replays (385 races).")
    return R.render()


def make_recommendations(umas: List[UmaAgg], races: List[Race], all_ur: List[UmaRace], mult: float,
                         skills: Optional[SkillDB] = None) -> Tuple[List[Tuple[float, str]], List[Tuple[int, str]]]:
    """Returns (estimates, notes).

    estimates = [(estimated gain in FINAL points per session, text)]
    notes     = [(priority, text)] for advice that cannot be quantified.
    """
    skills = skills or SkillDB()
    est: List[Tuple[float, str]] = []
    notes: List[Tuple[int, str]] = []
    n_sessions = max(1, len({r.session for r in races}))
    labels = {a.key: a.label for a in umas}
    # advice covers only the current team (latest session); history stays in the statistics
    cur = [a for a in umas if a.current] or umas

    for a in cur:
        n = a.n
        m = a.multiplier
        st = a.last.stats
        per_session = 1  # every uma on the team runs one race per session

        # Aptitudes below A
        u = a.last
        bad = []
        if u.apt_dist is not None and u.apt_dist < 7:
            bad.append(f"distance aptitude {APT_LETTERS.get(u.apt_dist, '?')} (lower speed)")
        if u.apt_ground is not None and u.apt_ground < 7:
            bad.append(f"track aptitude {APT_LETTERS.get(u.apt_ground, '?')}")
        if u.apt_style is not None and u.apt_style < 7:
            bad.append(f"strategy aptitude {APT_LETTERS.get(u.apt_style, '?')}")
        if bad:
            notes.append((1, f"{a.name} ({a.dist_label}): {', '.join(bad)}. Below A there is a race "
                             f"penalty: better an uma with A/S for this category, or raise it through inheritance."))

        # Not enough stamina
        short = [r for r in a.races if r.stamina_short]
        if short:
            where = ", ".join(sorted({f"{r.distance}m" for r in short if r.distance}))
            causes = []
            if any(r.hp_zero_left and r.hp_zero_left > 10 for r in short):
                left = safe_mean([r.hp_zero_left for r in short if r.hp_zero_left and r.hp_zero_left > 10])
                causes.append(f"ran out of HP before the finish (on average {fi(left)} m out)")
            if any(r.spurt_late and r.spurt_late > 10 for r in short):
                causes.append("started the final spurt late")
            rushed_too = sum(1 for r in short if r.rushed)
            extra = f", {rushed_too} with rushed" if rushed_too else ""
            gain = len(short) / n * 1000 * m * per_session
            est.append((gain, f"{a.name}: not enough stamina in {len(short)}/{n} races ({where}{extra}): "
                              f"{' and '.join(causes)}. STA {st['stamina']}: more Stamina or recovery skills "
                              f"(estimate: ~1 place = 1,000 base)."))
        else:
            hp_end = safe_mean([r.hp_end_pct for r in a.races])
            if hp_end is not None and hp_end >= 0.15 and n >= 2:
                notes.append((3, f"{a.name}: finishes with {pct(hp_end)} HP on average and never runs dry: "
                                 f"STA {st['stamina']} is probably more than needed; in future training you can "
                                 f"move points to SPD/POW."))

        # Unique skill rarely fires (needs at least 2 races to say)
        if n >= 2 and any(r.has_unique for r in a.races):
            k = a.count(lambda r: r.cat_count["unique"] > 0)
            if k / n < 0.6:
                val = safe_mean([r.unique_value for r in a.races if r.unique_value]) or 2400
                uid = next((sid for sid in a.last.skills_owned if 100000 <= sid < 200000), None)
                uname = f" \"{skills.name(uid)}\"" if uid and skills.name(uid) else ""
                est.append(((1 - k / n) * val * m * per_session,
                            f"{a.name}: unique skill{uname} fired only {k}/{n} times ({fi(val)} base each): its "
                            f"conditions (position/race phase) rarely happen with the current strategy and distance."))

        # Frequent rushed for this uma
        k = a.count(lambda r: r.rushed)
        if k >= 2 or (n >= 2 and k / n >= 0.4):
            loss = sum(r.rushed_loss for r in a.races) / n
            wiz = st["wiz"]
            hint = "raising Wit lowers the risk" if wiz < 1200 else "Wit is already high: it is mostly bad luck"
            est.append((loss * m * per_session,
                        f"{a.name}: rushed in {k}/{n} races (-{fi(loss)} base per race in penalties, plus wasted HP). "
                        f"WIT {wiz}, theoretical risk ~{pct(rushed_chance(wiz))}: {hint}."))

    # Rushed overall
    rushed_ur = [u for u in all_ur if u.rushed]
    if rushed_ur:
        loss = sum(u.rushed_loss * safe_mean(u.multipliers, mult) for u in rushed_ur) / n_sessions
        risky = sorted(cur, key=lambda a: a.last.stats["wiz"])[:4]
        est.append((loss, f"Rushed in {len(rushed_ur)}/{len(all_ur)} runs: ~{fi(loss)} final points lost per "
                          f"session in penalties alone (the wasted HP also costs places). Highest theoretical risk: "
                          + ", ".join(f"{a.name} (WIT {a.last.stats['wiz']}, ~{pct(rushed_chance(a.last.stats['wiz']))})"
                                      for a in risky) + "."))

    # Low Wit -> skills that fail the activation check
    target = 1000
    wit_items = []
    for a in cur:
        wiz = a.last.stats["wiz"]
        if wiz >= target:
            continue
        acts = safe_mean([r.cat_count["white"] + r.cat_count["gold"] for r in a.races], 0)
        pts = safe_mean([r.cat_raw["white"] + r.cat_raw["gold"] for r in a.races], 0)
        if not acts:
            continue
        p_now, p_tgt = skill_chance(wiz), skill_chance(target)
        extra_raw = acts / p_now * (p_tgt - p_now) * (pts / acts)
        wit_items.append((extra_raw * a.multiplier, a, p_now))
    if wit_items:
        gain = sum(g for g, _a, _p in wit_items)
        wit_items.sort(key=lambda x: -x[0])
        est.append((gain, f"Low Wit = fewer skills firing (Wit check, theoretical chance): "
                          + ", ".join(f"{a.name} WIT {a.last.stats['wiz']} ~{pct(p)}" for _g, a, p in wit_items[:5])
                          + f". Raising it to {fi(target)} (~{pct(skill_chance(target))}) is worth ~{fi(gain)} "
                            f"per session."))

    # Slot 1 (+10%): give it to the uma scoring the most base points in its distance
    by_dist: Dict[int, List[UmaAgg]] = defaultdict(list)
    for a in cur:
        by_dist[a.last.dist_type].append(a)
    for dt, group in sorted(by_dist.items()):
        ace = next((a for a in group if a.last.slot == 1), None)
        best = max(group, key=lambda a: a.avg("raw"))
        if ace and best is not ace and best.n >= 2 and ace.n >= 2:
            diff = best.avg("raw") - ace.avg("raw")
            est.append((0.10 * diff,
                        f"{DIST_NAMES.get(dt)}: put {best.name} first (slot 1) instead of {ace.name} "
                        f"({fi(best.avg('raw'))} vs {fi(ace.avg('raw'))} average base): the +10% pays more on "
                        f"the uma that scores more."))

    # Missed team bonus: who stays out of the top 5?
    missed = [r for r in races if not r.team_ids]
    if missed:
        culprits = Counter()
        for r in missed:
            out = [u for u in r.ours if u.finish > 5]
            if len(out) == 1:
                culprits[labels.get(out[0].key, out[0].name)] += 1
        team_mult = safe_mean([r.team_final / r.team_raw for r in races if r.team_raw], mult)
        gain = len(missed) / n_sessions * 4000 * team_mult
        who = ", ".join(f"{nm} ({c})" for nm, c in culprits.most_common(4))
        est.append((gain, f"Team bonus (all 3 in the top 5 = 4,000 base) missed in {len(missed)}/{len(races)} "
                          f"races: worth up to ~{fi(gain)} per session."
                          + (f" Races missed because of a single uma outside the top 5: {who}." if who else "")))

    # Perfect starts
    starts = [u for u in all_ur if u.start_delay is not None]
    if starts:
        rate = sum(1 for u in starts if u.cat_count["start"]) / len(starts)
        per_session = len(all_ur) / n_sessions
        gain = max(0.0, 0.5 - rate) * 1000 * mult * per_session
        # who has a start skill (Concentration / Focus) and how it went
        groups = []
        for sid in sorted(START_SKILLS):  # the first (gold) wins if an uma has both
            done = {id(u) for _s, g in groups for u in g}
            groups.append((skills.name(sid) or str(sid),
                           [u for u in starts if sid in u.skills_owned and id(u) not in done]))
        done = {id(u) for _s, g in groups for u in g}
        groups.append(("neither", [u for u in starts if id(u) not in done]))
        parts = [f"{nm} {sum(1 for u in g if u.cat_count['start'])}/{len(g)} ({', '.join(sorted({labels.get(u.key, u.name) for u in g}))})"
                 if nm != "neither" else f"{nm} {sum(1 for u in g if u.cat_count['start'])}/{len(g)}"
                 for nm, g in groups if g]
        detail = " Perfect starts by skill: " + "; ".join(parts) + "."
        if gain > 0:
            est.append((gain, f"Perfect start in {pct(rate)} of runs (+1,000 base each). It is random (~20% "
                              f"without help), but skills that shorten the start delay make it much more "
                              f"frequent: reaching 50% would be worth ~{fi(gain)} per session.{detail}"))

    # Opponent choice: the opponent bonus grows with the opponent's rating
    base_per_session = sum(u.raw for u in all_ur) / n_sessions + sum(r.team_raw for r in races) / n_sessions
    per_k = OPP_BONUS_FIT[1] * 1000 * base_per_session
    notes.append((2, f"Opponent choice: every +1,000 opponent rating adds {ff(OPP_BONUS_FIT[1] * 1e5, 2)} points to the "
                     f"opponent bonus, about {fi(per_k)} final points per session at your scores. Pick the strongest "
                     f"opponent you can still finish ahead of: stronger rivals also push your umas down the order."))

    # Leads own strategy
    l16 = sum(1 for u in all_ur if u.cat_count["lead16"]) / len(all_ur)
    l23 = sum(1 for u in all_ur if u.cat_count["lead23"]) / len(all_ur)
    never_lead = [a.name for a in cur if a.n >= 2 and
                  a.count(lambda r: r.cat_count["lead16"] or r.cat_count["lead23"]) == 0]
    notes.append((4, f"'Leads own strategy' (1,000 base at 1/6 and 1,000 at 2/3 of the race) earned in {pct(l16)} "
                     f"and {pct(l23)} of runs" + (f"; never by: {', '.join(never_lead)}" if never_lead else "") +
                     ". What counts is being ahead of every other uma with the SAME strategy, opponents included."))

    # Umas with little data
    few = [a for a in cur if a.n < 3]
    if few and len(few) < len(cur):
        notes.append((2, "Too few races to judge reliably: " +
                      ", ".join(f"{a.name} ({a.n} {plural(a.n, 'race', 'races')})" for a in few) +
                      ". Their statistics become reliable after a few sessions."))

    # Finishing position
    worst = sorted(cur, key=lambda a: -(a.avg("finish") or 0))[:3]
    notes.append((2, f"Finishing position is the biggest item (~1,000 base, ~{fi(1000 * mult)} final per place; "
                     f"1st vs 2nd = 2,000 base + margin). Worst average place: "
                     + ", ".join(f"{a.name} {ff(a.avg('finish'), 1)}" for a in worst) + "."))

    # Skills that never fired (summary; details are in the Skills section)
    never_counts = []
    for a in cur:
        owned, acts = {}, Counter()
        for r in a.races:
            owned.update(r.skills_owned)
            acts.update(r.skill_acts)
        nv = sum(1 for s in owned if acts[s] == 0)
        if nv and a.n >= 3:
            never_counts.append((nv, a.name))
    if never_counts:
        never_counts.sort(reverse=True)
        notes.append((5, "Skills that never fired (see the Skills section): " +
                         ", ".join(f"{nm} {nv}" for nv, nm in never_counts) +
                         ". In future training prefer skills whose conditions your uma actually meets "
                         "(each activation is worth 500-1,200 base)."))

    est.sort(key=lambda x: -x[0])
    notes.sort(key=lambda x: x[0])
    return est, notes


# ---------------------------------------------------------------------------
# CSV export
# ---------------------------------------------------------------------------


def export_csv(sessions: List[Session], outdir: str, skills: Optional[SkillDB] = None) -> List[str]:
    skills = skills or SkillDB()
    os.makedirs(outdir, exist_ok=True)
    written = []
    aggs = aggregate_umas(sessions)
    agg_of = {a.key: a for a in aggs}
    p1 = os.path.join(outdir, "uma_races.csv")
    with open(p1, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["session", "race", "distance_type", "meters", "won", "uma", "on_team", "tcid", "slot", "strategy",
                    "SPD", "STA", "POW", "GUT", "WIT", "mood", "popularity", "finish", "base_points", "final_points",
                    *[f"base_{k}" for k in CATEGORY_ORDER if k != "team"],
                    "white_skills", "gold_skills", "unique_skill", "start_delay", "rushed_seconds",
                    "hp_left_pct", "hp_out_m_to_finish", "spurt_late_m", "blocked_pct"])
        for s in sessions:
            for r in s.races:
                for u in r.ours:
                    w.writerow([s.label, r.rnd, DIST_NAMES.get(r.dist_type, r.dist_type), r.distance or "", int(r.win),
                                agg_of[u.key].name, int(agg_of[u.key].current), u.tcid, u.slot,
                                STYLE_NAMES.get(u.style, u.style),
                                *[u.stats[k] for k, _ in STAT_KEYS], u.mood, u.popularity, u.finish, u.raw, u.final,
                                *[u.cat_raw.get(k, 0) for k in CATEGORY_ORDER if k != "team"],
                                u.cat_count["white"], u.cat_count["gold"], u.cat_count["unique"],
                                "" if u.start_delay is None else round(u.start_delay, 4), u.rushed_secs,
                                "" if u.hp_end_pct is None else round(100 * u.hp_end_pct, 1),
                                "" if u.hp_zero_left is None else round(u.hp_zero_left, 1),
                                "" if u.spurt_late is None else round(u.spurt_late, 1),
                                "" if u.blocked_late is None else round(100 * u.blocked_late, 1)])
    written.append(p1)

    p2 = os.path.join(outdir, "score_events.csv")
    with open(p2, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["session", "race", "uma", "raw_score_id", "category", "description", "times", "base_points",
                    "final_points"])
        for s in sessions:
            for r in s.races:
                for u in r.ours:
                    for rid, num, raw, fin in u.entries:
                        ck, desc = score_category(rid)
                        w.writerow([s.label, r.rnd, agg_of[u.key].name, rid, ck, desc, num, raw, fin])
    written.append(p2)

    p3 = os.path.join(outdir, "skills.csv")
    with open(p3, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["uma", "on_team", "tcid", "skill_id", "name", "level", "kind", "races", "activations",
                    "base_points"])
        for a in aggs:
            owned, acts, types, pts = {}, Counter(), {}, Counter()
            for r in a.races:
                owned.update(r.skills_owned)
                acts.update(r.skill_acts)
                types.update(r.skill_type)
                pts.update(r.skill_points)
            for sid in sorted(owned):
                w.writerow([a.name, int(a.current), a.tcid, sid, skills.name(sid) or "", owned[sid],
                            skills.kind(sid, types.get(sid)), a.n, acts[sid], pts[sid]])
    written.append(p3)
    return written


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


SKILL_DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "skill_names.json")
SKILL_SRC_BASE = "https://raw.githubusercontent.com/alpha123/uma-tools/master/umalator-global/"


def load_skill_db(*paths: Optional[str]) -> SkillDB:
    """Loads skill names (and rarity). Later files override earlier ones.

    Accepted formats: {"200012": "Name"}, {"200012": ["Name", rarity]},
    {"200012": {"name_en": "Name", "rarity": 1}} or [{"id": 200012, "name_en": "Name"}, ...].
    """
    db = SkillDB()
    name_keys = ("name_en", "enname", "name", "name_jp", "jpname")

    def add(sid, val):
        name = rar = None
        if isinstance(val, list):
            name = val[0] if val else None
            rar = val[1] if len(val) > 1 else None
        elif isinstance(val, dict):
            name = next((val[k] for k in name_keys if val.get(k)), None)
            rar = val.get("rarity")
        else:
            name = val
        if name:
            db.names[int(sid)] = str(name)
        if isinstance(rar, int):
            db.rarity[int(sid)] = rar

    for path in paths:
        if not path or not os.path.isfile(path):
            continue
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            print(f"Skill names: cannot read {path}: {e}", file=sys.stderr)
            continue
        if isinstance(data, dict):
            for k, v in data.items():
                if str(k).isdigit():
                    add(k, v)
        elif isinstance(data, list):
            for item in data:
                if isinstance(item, dict) and item.get("id", item.get("skill_id")) is not None:
                    add(item.get("id", item.get("skill_id")), item)
    return db


def build_skill_db(names_raw: dict, data_raw: dict) -> dict:
    """Merges uma-tools' skillnames.json and skill_data.json into the {id: [name, rarity]} format."""
    out = {
        "_source": "https://github.com/alpha123/uma-tools (umalator-global: skillnames.json + skill_data.json), "
                   "Global client text",
        "_format": "id -> [name, rarity] with rarity 1 = white, 2 = gold, 3-5 = unique",
    }
    for k in sorted((k for k in names_raw if str(k).isdigit()), key=int):
        v = names_raw[k]
        name = v[0] if isinstance(v, list) and v else v
        rar = (data_raw.get(k) or {}).get("rarity") if isinstance(data_raw, dict) else None
        out[k] = [name, rar]
    return out


def update_skill_db(path: str = SKILL_DB_FILE) -> int:
    """Downloads the latest skill names and saves them to `path` (and to web/skill_names.js)."""
    import urllib.request

    def get(name):
        with urllib.request.urlopen(SKILL_SRC_BASE + name, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))

    db = build_skill_db(get("skillnames.json"), get("skill_data.json"))
    write_skill_db(db, path)
    web_js = os.path.join(os.path.dirname(os.path.abspath(path)), "web", "skill_names.js")
    if os.path.isdir(os.path.dirname(web_js)):
        write_web_skill_db(db, web_js)
    return sum(1 for k in db if k.isdigit())


def write_web_skill_db(db: dict, path: str) -> None:
    """Same content for the web app, as a script (so it also works when index.html is opened from disk)."""
    body = ",\n".join(f"{json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}" for k, v in db.items())
    with open(path, "w", encoding="utf-8") as f:
        f.write("/* Generated by tt_stats.py --update-names: skill names and rarity (Global). */\n"
                "window.UMA_SKILLS = {\n" + body + "\n};\n")


def write_skill_db(db: dict, path: str) -> None:
    """One skill per line, so the file stays readable and easy to edit by hand."""
    with open(path, "w", encoding="utf-8") as f:
        f.write("{\n" + ",\n".join(f"{json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}" for k, v in db.items())
                + "\n}\n")


def find_files(paths: List[str]) -> List[str]:
    if not paths:
        paths = [p for p in ("data", ".") if os.path.isdir(p)]
    files = []
    for p in paths:
        if os.path.isdir(p):
            found = sorted(glob.glob(os.path.join(p, "*TT-*.json")))
            if not found:
                found = sorted(glob.glob(os.path.join(p, "*.json")))
            files += found
        elif os.path.isfile(p):
            files.append(p)
        else:
            print(f"Warning: '{p}' not found", file=sys.stderr)
    seen, out = set(), []
    for f in files:
        k = os.path.abspath(f)
        if os.path.basename(f) == os.path.basename(SKILL_DB_FILE):
            continue
        if k not in seen:
            seen.add(k)
            out.append(f)
    return out


def main(argv=None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows console
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="Statistics from Uma Musume Team Trials result files.")
    ap.add_argument("paths", nargs="*", help="JSON files or folders (default: ./data and the current folder)")
    ap.add_argument("--details", action="store_true", help="show a breakdown of every race")
    ap.add_argument("--skills", action="store_true", help="full skill table for every uma")
    ap.add_argument("--md", metavar="FILE", help="also save the report as Markdown")
    ap.add_argument("--csv", metavar="FOLDER", help="export the data as CSV (for Excel/Sheets)")
    ap.add_argument("--skill-names", metavar="FILE",
                    help="extra JSON with skill names (id -> name), takes precedence over skill_names.json")
    ap.add_argument("--update-names", action="store_true",
                    help="download the latest skill names into skill_names.json (needs internet)")
    args = ap.parse_args(argv)

    if args.update_names:
        try:
            n = update_skill_db()
            print(f"Skill names updated: {n} skills saved to {SKILL_DB_FILE}")
        except Exception as e:  # no network, URL changed, ...
            print(f"Could not update skill names: {e}", file=sys.stderr)
            return 1
        if not args.paths and not os.path.isdir("data"):
            return 0

    files = find_files(args.paths)
    sessions = []
    for f in files:
        try:
            sessions.append(load_session(f))
        except (ValueError, KeyError, json.JSONDecodeError) as e:
            print(f"Skipping {f}: {e}", file=sys.stderr)
    if not sessions:
        print("No valid Team Trials files found. Pass the .json files or a folder.", file=sys.stderr)
        return 1
    sessions.sort(key=lambda s: s.label)
    skills = load_skill_db(SKILL_DB_FILE, args.skill_names)

    args.md_mode = False
    print(build_report(sessions, args, skills), end="")
    if args.md:
        args.md_mode = True
        with open(args.md, "w", encoding="utf-8") as f:
            f.write(build_report(sessions, args, skills))
        print(f"\nMarkdown report saved to {args.md}")
    if args.csv:
        for p in export_csv(sessions, args.csv, skills):
            print(f"CSV: {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
