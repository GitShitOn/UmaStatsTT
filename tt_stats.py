#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
UmaStatsTT - analisi dei risultati di Team Trials (Uma Musume Pretty Derby).

Legge i file JSON salvati dalle sessioni di Team Trials (TT-AAAAMMGG_hhmmss_xxx.json),
decodifica anche il replay binario di ogni gara (`race_scenario`) e stampa statistiche
pensate per capire DOVE si perdono punti e COSA conviene migliorare.

Uso:
    python3 tt_stats.py                   # cerca i TT-*.json in ./data e nella cartella corrente
    python3 tt_stats.py cartella/ file.json ...
    python3 tt_stats.py data/ --dettaglio # aggiunge il resoconto gara per gara
    python3 tt_stats.py data/ --skill     # tabella completa delle skill per ogni uma
    python3 tt_stats.py data/ --md report.md --csv export/

Solo libreria standard, Python >= 3.8.
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
# Tabelle di decodifica
# ---------------------------------------------------------------------------

DIST_NAMES = {1: "Sprint", 2: "Mile", 3: "Medium", 4: "Long", 5: "Dirt"}
STYLE_NAMES = {1: "Front", 2: "Pace", 3: "Late", 4: "End"}
MOOD_NAMES = {1: "Pessimo", 2: "Scarso", 3: "Normale", 4: "Buono", 5: "Ottimo"}
WEATHER_NAMES = {1: "Sole", 2: "Nuvoloso", 3: "Pioggia", 4: "Neve"}
GROUND_NAMES = {1: "Firm", 2: "Good", 3: "Soft", 4: "Heavy"}
APT_LETTERS = {1: "G", 2: "F", 3: "E", 4: "D", 5: "C", 6: "B", 7: "A", 8: "S"}

# chara_id -> nome (versione Global). Gli id non presenti vengono mostrati come "Chara <id>".
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

# Categorie dei punti base (raw_score_id). Ricavate dai dati: ogni evento di punteggio
# nel replay e' stato confrontato con lo stato della gara (posizioni, HP, skill, tempi).
# "(dedotto)" = interpretazione coerente con i dati ma basata su pochi casi.
CATEGORY_LABELS = {
    "place": "Piazzamento",
    "margin": "Margine di vittoria",
    "upset": "Sorpresa vs popolarita' (dedotto)",
    "unique": "Skill unica",
    "gold": "Skill oro",
    "white": "Skill bianche / unica ereditata",
    "start": "Partenza perfetta (<0,02 s)",
    "lead16": "1a del proprio stile a 1/6 gara",
    "lead23": "1a del proprio stile a 2/3 gara",
    "time": "Bonus tempo (sotto il riferimento)",
    "rushed": "Rushed / kakari (penalita')",
    "team": "Bonus squadra",
    "other": "Altro",
}
CATEGORY_ORDER = ["place", "margin", "upset", "unique", "gold", "white", "start",
                  "lead16", "lead23", "time", "rushed", "team", "other"]
SKILL_CATS = ("unique", "gold", "white")


def score_category(rid: int) -> Tuple[str, str]:
    """raw_score_id -> (categoria, descrizione)."""
    if 1 <= rid <= 19:
        return "margin", f"Margine di vittoria (#{rid}, id basso = distacco maggiore)"
    if 20 <= rid <= 22:
        return "upset", f"Sorpresa: piazzamento molto migliore della popolarita' (#{rid})"
    if rid == 23:
        return "rushed", "Rushed: inizio (-500)"
    if rid == 24:
        return "rushed", "Rushed: ogni secondo (-100)"
    if rid == 25:
        return "start", "Partenza perfetta (ritardo < 0,02 s)"
    if 40 <= rid <= 55:
        return "unique", f"Skill unica (#{rid})"
    if rid == 56:
        return "gold", "Skill oro"
    if rid == 57:
        return "white", "Skill bianca / unica ereditata"
    if rid == 58:
        return "lead16", "1a tra le uma del suo stile a fine fase iniziale (1/6)"
    if rid == 59:
        return "lead23", "1a tra le uma del suo stile a inizio fase finale (2/3)"
    if 60 <= rid <= 71:
        return "place", f"Arrivo {rid - 59}a"
    if 80 <= rid <= 92:
        return "time", "Bonus tempo: +100 ogni 0,1 s sotto il tempo di riferimento"
    if rid == 94:
        return "team", "Squadra: tutte e 3 nelle prime 3"
    if rid == 95:
        return "team", "Squadra: tutte e 3 nelle prime 5"
    if 93 <= rid <= 99:
        return "team", f"Bonus squadra #{rid}"
    return "other", f"Categoria sconosciuta #{rid}"


def bonus_kind(b: dict) -> str:
    """Tipo di bonus moltiplicativo (bonus_array) in base a condition_type."""
    ct = b.get("condition_type")
    return {1: "ace", 3: "avversario", 4: "serie", 5: "supporto"}.get(ct, f"bonus#{b.get('score_bonus_id')}")


BONUS_LABELS = {
    "ace": "Slot 1 / Ace (+10%)",
    "avversario": "Avversario (cresce con la sua valutazione)",
    "serie": "Serie di vittorie",
    "supporto": "Carte supporto",
}

LEGEND = [
    "Piazzamento: 1a 10.000, 2a 8.000, 3a 7.000, 4a 6.000, 5a 5.000, 6a-7a 4.000, 8a 3.000, 10a-12a 2.000.",
    "Margine di vittoria (solo alla 1a): piu' distacco = piu' punti (osservati 1.000-2.200).",
    "Sorpresa (dedotto): 3.000-4.000 se arrivi 1a/2a partendo poco favorita (popolarita' bassa).",
    "Skill: bianca o unica ereditata 500, oro 1.200, unica 2.300-2.500 (sale col livello). Le passive contano.",
    "Partenza perfetta: +1.000 se il ritardo al via e' sotto 0,02 s.",
    "1a del proprio stile: +1.000 se a 1/6 di gara (fine fase iniziale) sei davanti a tutte le uma con la "
    "tua stessa strategia; altri +1.000 a 2/3 (inizio fase finale).",
    "Bonus tempo: +100 ogni 0,1 s sotto un tempo di riferimento del percorso (visto solo su Sprint/Mile).",
    "Rushed (kakari): -500 all'inizio e -100 per ogni secondo in cui dura.",
    "Squadra: +4.000 se tutte e 3 arrivano nelle prime 5, +5.000 se tutte nelle prime 3.",
    "Bonus percentuali su ogni voce: avversario (~+155%, cresce con la sua valutazione), carte supporto "
    "(~+10%), prima uma della distanza / slot 1 (+10%), serie di vittorie (+2%, +3%, ...).",
]


# ---------------------------------------------------------------------------
# Formattazione numeri (stile italiano)
# ---------------------------------------------------------------------------


def fi(x) -> str:
    if x is None:
        return "-"
    return f"{int(round(x)):,}".replace(",", ".")


def ff(x, d: int = 1) -> str:
    if x is None:
        return "-"
    return f"{x:.{d}f}".replace(".", ",")


def pct(x, d: int = 0) -> str:
    if x is None:
        return "-"
    return ff(100 * x, d) + "%"


def frac(k: int, n: int) -> str:
    return f"{k}/{n}"


def safe_mean(xs, default=None):
    xs = [x for x in xs if x is not None]
    return mean(xs) if xs else default


# ---------------------------------------------------------------------------
# Decodifica del replay (race_scenario: base64 + gzip + binario little-endian)
# ---------------------------------------------------------------------------

EV_SCORE, EV_SKILL = 0, 3


@dataclass
class Scenario:
    frames: list            # [(t, [(dist, lane, speed, hp, temptation, block_front), ...])]
    results: list           # per indice cavallo (= frame_order - 1)
    events: list            # [(t, tipo, params)]
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
    except Exception:  # formato inatteso: si prosegue senza replay
        return None


def _estimate_distance(sc: Scenario) -> Optional[int]:
    """Lunghezza del percorso: posizione del vincitore all'istante d'arrivo, arrotondata a 100 m."""
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
# Modello dati
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
    skill_points: Counter = field(default_factory=Counter)  # punti base per skill
    unique_value: Optional[int] = None
    start_delay: Optional[float] = None
    rushed_secs: int = 0
    rushed_loss: int = 0
    spurt_late: Optional[float] = None   # metri di ritardo dello sprint finale rispetto a 2/3
    hp_start: Optional[int] = None
    hp_end_pct: Optional[float] = None
    hp_zero_left: Optional[float] = None  # metri al traguardo quando l'HP e' finita
    blocked_late: Optional[float] = None
    multipliers: list = field(default_factory=list)

    @property
    def key(self):
        """Identita' dell'uma allenata: trained_chara_id, oppure personaggio + statistiche se manca."""
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
    trainer: str


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
    winner_side: str             # "noi" / "avversari" / "altri"
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
        raise ValueError("non sembra un file di risultati Team Trials")

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

        # la nostra squadra = quella con i punteggi (fallback: team_id 1)
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
                        finish=c.get("finish_order", 0), trainer=h.get("owner_trainer_name") or ""))
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
                if s["raw_score_id"] != 24:  # i secondi di rushed non sono eventi distinti
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
            winner_side = "noi"
        elif first.get("team_id"):
            winner_side = "avversari"
        else:
            winner_side = "altri"

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
    """Metriche ricavate dal replay per l'uma con indice `idx`."""
    if idx >= len(sc.results):
        return
    res = sc.results[idx]
    u.start_delay = res["delay"]

    # skill attivate e punti generati da ciascuna (l'evento punteggio segue quello della skill)
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
# Aggregazioni
# ---------------------------------------------------------------------------


@dataclass
class UmaAgg:
    key: object
    name: str
    races: List[UmaRace]
    current: bool = True    # presente nell'ultima sessione (squadra attuale)

    @property
    def tcid(self) -> int:
        return self.races[0].tcid

    @property
    def label(self) -> str:
        return self.name if self.current else f"{self.name} (ex)"

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

    def rate(self, pred) -> float:
        return sum(1 for r in self.races if pred(r)) / self.n if self.n else 0.0

    def count(self, pred) -> int:
        return sum(1 for r in self.races if pred(r))

    @property
    def multiplier(self) -> float:
        return safe_mean([m for r in self.races for m in r.multipliers], 1.0)

    @property
    def base_multiplier(self) -> float:
        """Moltiplicatore medio escluso il bonus slot 1 (per stimare l'effetto di un cambio di ace)."""
        ms = [m for r in self.races if not r.is_ace for m in r.multipliers]
        if ms:
            return mean(ms)
        return self.multiplier - 0.10


def aggregate_umas(sessions: List[Session]) -> List[UmaAgg]:
    """Una voce per uma allenata. La squadra attuale e' quella dell'ultima sessione (in ordine di data)."""
    sessions = sorted(sessions, key=lambda s: s.label)
    by: Dict[object, List[UmaRace]] = {}
    for s in sessions:
        for r in s.races:
            for u in r.ours:
                by.setdefault(u.key, []).append(u)
    latest = sessions[-1].label if sessions else None
    aggs = [UmaAgg(key, rs[0].name, rs, current=any(r.session == latest for r in rs)) for key, rs in by.items()]
    # stesso personaggio allenato piu' volte: v1, v2, ... in ordine di prima apparizione
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
    """Differenze di squadra tra una sessione e la precedente: uma entrate, uscite, spostate."""
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
    """Probabilita' teorica di rushed (kakari) in funzione della Saggezza: ((6,5/log10(0,1*WIT+1))^2)%."""
    if wiz <= 0:
        return 1.0
    return min(1.0, (6.5 / math.log10(0.1 * wiz + 1)) ** 2 / 100.0)


def skill_chance(wiz: int) -> float:
    """Probabilita' teorica che una skill superi il controllo Saggezza: max(100 - 9000/WIT, 20)%."""
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
        """Tipo in italiano: dal database, altrimenti dal punteggio osservato, altrimenti dall'ID."""
        if 900000 <= sid < 1000000:
            return "unica ered."
        r = self.rarity.get(sid)
        if r:
            return "bianca" if r == 1 else "oro" if r == 2 else "unica"
        if observed in SKILL_KIND_IT:
            return SKILL_KIND_IT[observed]
        return "unica" if 100000 <= sid < 200000 else "?"


SKILL_KIND_IT = {"unique": "unica", "gold": "oro", "white": "bianca"}
START_SKILLS = {200431, 200432}  # Concentration (oro) e Focus (bianca): riducono il ritardo in partenza


def build_report(sessions: List[Session], args, skills: SkillDB) -> str:
    R = Report(markdown=bool(args.md_mode))
    races = [r for s in sessions for r in s.races]
    umas = aggregate_umas(sessions)
    labels = {a.key: a.label for a in umas}
    changes = team_changes(sessions, umas)
    all_ur = [u for r in races for u in r.ours]
    n_races = len(races)
    if not n_races:
        return "Nessuna gara trovata.\n"
    n_current = sum(1 for a in umas if a.current)

    R.h1("UmaStatsTT - Analisi Team Trials")
    R.p(f"File analizzati: {len(sessions)}  |  Gare: {n_races}  |  Uma in squadra: {n_current}"
        + (f" (+{len(umas) - n_current} non piu' in squadra)" if len(umas) > n_current else ""))
    bad = [r for r in races if not r.check_ok]
    if bad:
        R.p(f"ATTENZIONE: in {len(bad)} gare la somma dei punti non coincide con il totale (dati incompleti?).")
    if any(u.start_delay is None for u in all_ur):
        R.p("Nota: alcune gare non hanno il replay (race_scenario): diagnostica HP/skill parziale.")

    allrates = defaultdict(list)
    for s in sessions:
        for k, v in s.bonus_rates.items():
            allrates[k] += v
    mult_std = 1 + sum(safe_mean(allrates.get(k, []), 0) for k in ("avversario", "supporto"))
    est, notes = make_recommendations(umas, races, all_ur, mult_std, skills)

    R.h2("In sintesi")
    R.p(f"Media {fi(sum(s.total for s in sessions) / len(sessions))} punti a sessione, "
        f"{fi(sum(s.total for s in sessions) / n_races)} a gara. Le 5 cose che valgono di piu' "
        f"(stima in punti finali per sessione):")
    for gain, text in est[:5]:
        R.bullet(f"[~{fi(gain)}] {text}")
    for _prio, text in [x for x in notes if x[0] == 1]:
        R.bullet(f"[!] {text}")
    R.p()
    if changes:
        R.p(f"La squadra e' cambiata in {len(changes)} {'sessione' if len(changes) == 1 else 'sessioni'}: "
            f"i consigli riguardano la squadra attuale, cioe' "
            f"quella dell'ultima sessione ({sessions[-1].label}). Le uma uscite restano nelle statistiche come '(ex)'.")
        R.p()

    # ---------------- Sessioni
    R.h2("Sessioni")
    rows = []
    for s in sessions:
        opp = safe_mean(s.bonus_rates.get("avversario", []))
        sup = safe_mean(s.bonus_rates.get("supporto", []))
        rows.append([s.label, fi(s.total), f"{s.wins}-{len(s.races) - s.wins}", fi(s.total / max(1, len(s.races))),
                     fi(s.opp_eval), pct(opp, 1), pct(sup, 2)])
    tot = sum(s.total for s in sessions)
    rows.append(["MEDIA", fi(tot / len(sessions)), ff(sum(s.wins for s in sessions) / len(sessions), 1) + " V",
                 fi(tot / n_races), "", "", ""])
    R.table(["Sessione", "Punteggio", "V-S", "Media/gara", "Valut. avv.", "Bonus avv.", "Bonus supp."], rows)
    if changes:
        R.p("Cambi di squadra:")
        for c in changes:
            parts = []
            if c["entered"]:
                parts.append("entrano " + ", ".join(c["entered"]))
            if c["left"]:
                parts.append("escono " + ", ".join(c["left"]))
            if c["moved"]:
                parts.append("spostate " + ", ".join(c["moved"]))
            R.bullet(f"{c['session']}: " + "; ".join(parts))
        R.p()

    # ---------------- Come si calcola il punteggio
    R.h2("Come si forma il punteggio (ricavato dai tuoi dati)")
    R.p("Punteggio gara = somma dei punti base di ogni evento x (1 + bonus) + bonus squadra.")
    sup_cfg = sorted({s.support_bonus for s in sessions if s.support_bonus})
    for k in ("avversario", "supporto", "ace", "serie"):
        if k == "supporto" and sup_cfg:
            R.bullet(f"{BONUS_LABELS[k]}: " + ", ".join(pct(v / 10000, 2) for v in sup_cfg) +
                     " (valore support_card_bonus del file)")
            continue
        if allrates.get(k):
            vals = allrates[k]
            rng = f"{pct(min(vals), 1)} - {pct(max(vals), 1)}" if max(vals) - min(vals) > 0.002 else pct(mean(vals), 1)
            R.bullet(f"{BONUS_LABELS.get(k, k)}: {rng}")
    R.p()
    R.p(f"=> 1 punto base vale circa {ff(mult_std, 2)} punti finali ({ff(mult_std + 0.10, 2)} per l'uma nello slot 1).")
    R.p("   Tutti i bonus sono percentuali: per salire conta aumentare i PUNTI BASE.")
    if allrates.get("avversario") and len(sessions) > 1:
        pairs = sorted((s.opp_eval or 0, safe_mean(s.bonus_rates.get("avversario", []), 0)) for s in sessions)
        R.p("   Bonus avversario per valutazione avversario: " +
            ", ".join(f"{fi(e)} -> {pct(r, 1)}" for e, r in pairs) +
            "  (avversari piu' forti = moltiplicatore piu' alto).")
    R.p()

    # tabella valori per categoria
    unit_vals = defaultdict(set)
    for u in all_ur:
        for rid, num, raw, _f in u.entries:
            if num:
                unit_vals[score_category(rid)[0]].add(raw // num)
    R.p("Valore in punti base di ogni evento (osservato):")
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
    R.table(["Evento", "Punti base"], rows, "lr")
    R.p("Piazzamento: 1a 10.000, 2a 8.000, 3a 7.000, 4a 6.000, 5a 5.000, 6a-7a 4.000 ... (circa -1.000 a posizione).")
    R.p("Squadra: tutte e 3 nelle prime 5 = 4.000, tutte e 3 nelle prime 3 = 5.000.")

    # ---------------- Da dove arrivano i punti
    R.h2("Da dove arrivano i punti")
    cat_raw = Counter()
    cat_final = Counter()
    cat_cnt = Counter()
    cat_hits = Counter()   # uma-gara in cui la categoria e' presente
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
    rows.append(["TOTALE", "", "", fi(sum(cat_raw.values())), fi(grand), "100%", fi(grand / n_races)])
    R.table(["Categoria", "Eventi", "Presente", "Base tot.", "Finali tot.", "% tot.", "Finali/gara"], rows)
    R.p("'Presente' = in quante uma-gare (o gare, per la squadra) la categoria compare almeno una volta.")

    # ---------------- Per distanza
    R.h2("Per distanza")
    rows = []
    for dt in sorted({r.dist_type for r in races}):
        rs = [r for r in races if r.dist_type == dt]
        urs = [u for r in rs for u in r.ours]
        dists = sorted({r.distance for r in rs if r.distance})
        rows.append([DIST_NAMES.get(dt, dt), ", ".join(f"{d}m" for d in dists) or "-", len(rs),
                     f"{sum(r.win for r in rs)}-{sum(not r.win for r in rs)}",
                     fi(mean(r.total for r in rs)), ff(mean(u.finish for u in urs), 1),
                     f"{sum(1 for r in rs if r.team_ids)}/{len(rs)}",
                     f"{sum(1 for r in rs if r.winner_side == 'noi')}/{len(rs)}"])
    R.table(["Distanza", "Percorsi", "Gare", "V-S", "Punti/gara", "Piazz. medio", "Bonus squadra", "1a nostra"], rows)
    consistent = sum(1 for r in races if r.win == (r.winner_side == "noi"))
    if consistent == n_races:
        R.p(f"Osservazione: in tutte le {n_races} gare ha vinto la squadra che ha piazzato l'uma al 1o posto.")
    else:
        R.p(f"Osservazione: vittoria = squadra con la 1a classificata in {consistent}/{n_races} gare.")

    # ---------------- Per uma: rendimento
    R.h2("Rendimento per uma")
    rows = []
    for a in umas:
        rows.append([a.label, a.dist_label, STYLE_NAMES.get(a.last.style, "?"),
                     ("ex" if not a.current else "ACE" if a.last.slot == 1 else str(a.last.slot)), a.n,
                     ff(a.avg("finish"), 1), " ".join(str(r.finish) for r in a.races),
                     fi(a.avg("raw")), fi(a.avg("final")),
                     fi(safe_mean([r.cat_raw["place"] for r in a.races])),
                     fi(safe_mean([sum(r.cat_raw[k] for k in SKILL_CATS) for r in a.races])),
                     fi(safe_mean([r.cat_raw["start"] + r.cat_raw["lead16"] + r.cat_raw["lead23"] for r in a.races])),
                     fi(safe_mean([r.cat_raw["rushed"] for r in a.races]))])
    R.table(["Uma", "Dist.", "Stile", "Slot", "Gare", "Piaz.", "Arrivi", "Base/g", "Finali/g",
             "Piazz.", "Skill", "Pos/part.", "Rushed"], rows, "lllrrrlrrrrrr")
    R.p("Colonne Piazz./Skill/Pos-part./Rushed = punti base medi per gara da: piazzamento, skill,")
    R.p("partenza perfetta + 1a del proprio stile (1/6 e 2/3), penalita' rushed.")

    # ---------------- Per uma: diagnostica
    R.h2("Diagnostica per uma")
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
    R.table(["Uma", "Bianche/g", "Oro/g", "Unica", "Part.perf", "1a stile 1/6", "1a stile 2/3",
             "Rushed", "HP finita", "Sprint tardo", "HP fine", "Bloccata"], rows)
    R.p("Unica = gare con skill unica attivata (Lx = livello).")
    R.p("HP finita = HP a zero prima del traguardo. Sprint tardo = sprint finale partito >10 m dopo i 2/3")
    R.p("(segno di stamina insufficiente). HP fine = HP residua media all'arrivo. Bloccata = % di tempo")
    R.p("con un'uma davanti che blocca, nell'ultimo terzo di gara.")

    # ---------------- Statistiche e attitudini
    R.h2("Statistiche e attitudini")
    rows = []
    for a in umas:
        u = a.last
        rows.append([a.label, *[fi(u.stats[k]) for k, _ in STAT_KEYS],
                     APT_LETTERS.get(u.apt_dist, "?"), APT_LETTERS.get(u.apt_ground, "?"),
                     APT_LETTERS.get(u.apt_style, "?"),
                     pct(skill_chance(u.stats["wiz"])), pct(rushed_chance(u.stats["wiz"])),
                     " ".join(MOOD_NAMES.get(r.mood, "?")[:3] for r in a.races)])
    R.table(["Uma"] + [lbl for _, lbl in STAT_KEYS] +
            ["Apt.dist", "Apt.terr", "Apt.stile", "Skill ok", "Rushed", "Umore per gara"], rows,
            "lrrrrrrrrrrl")
    R.p("Skill ok / Rushed = probabilita' teoriche date dalla WIT: attivazione di una skill")
    R.p("(max(100 - 9000/WIT, 20)%) e rushed ((6,5 / log10(WIT/10 + 1))^2 %). Attitudine sotto A = penalita'.")

    # ---------------- Noi vs avversari
    R.h2("Noi contro gli avversari (statistiche medie per distanza)")
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
    R.table(["Distanza"] + [f"{lbl} noi/avv" for _, lbl in STAT_KEYS] + ["Piazz. noi/avv"], rows)
    lost = [r for r in races if not r.win]
    if lost:
        R.p("Chi ha vinto le gare perse:")
        for r in lost:
            w = next((o for o in r.opponents if o.finish == 1), None)
            if w:
                st = " ".join(f"{lbl} {w.stats[k]}" for k, lbl in STAT_KEYS)
                best = min(r.ours, key=lambda u: u.finish)
                R.bullet(f"{r.session} G{r.rnd} {DIST_NAMES.get(r.dist_type)} {r.distance or ''}m: "
                         f"{w.name} ({STYLE_NAMES.get(w.style, '?')}) {st}  | nostra migliore: "
                         f"{best.name} {best.finish}a")
            else:
                R.bullet(f"{r.session} G{r.rnd} {DIST_NAMES.get(r.dist_type)}: vinta da un'uma fuori squadra")
        R.p()

    # ---------------- Umore
    R.h2("Fattori casuali")
    rows = []
    for m in sorted({u.mood for u in all_ur}):
        us = [u for u in all_ur if u.mood == m]
        rows.append([MOOD_NAMES.get(m, m), len(us), ff(mean(u.finish for u in us), 1), fi(mean(u.raw for u in us))])
    R.table(["Umore", "Uma-gare", "Piazz. medio", "Base medi"], rows)
    starts = [u.start_delay for u in all_ur if u.start_delay is not None]
    if starts:
        perf = sum(1 for d in starts if d < 0.02)
        R.p(f"Partenze perfette (<0,02 s): {perf}/{len(starts)} ({pct(perf / len(starts))}); ritardo medio "
            f"{ff(mean(starts), 3)} s. Senza skill di partenza ci si aspetta circa il 20%.")

    # ---------------- Skill
    R.h2("Skill")
    R.p("Ogni attivazione vale punti base: bianca/ereditata 500, oro 1.200, unica 2.300-2.500 (sale col livello).")
    R.p("Anche le skill passive (verdi) che si attivano al via contano come attivazioni.")
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
        line = (f"{a.label}: {len(owned)} skill, attivazioni medie {ff(sum(acts[s] for s in owned) / a.n, 1)}/gara, "
                f"punti base da skill {fi(sum(pts.values()) / a.n)}/gara.")
        R.p(line)
        if never:
            R.p(f"    Mai attivate in {a.n} gare: " +
                ", ".join(f"{skills.label(s)} ({skills.kind(s, types.get(s))})" for s in sorted(never)))
        if args.skill:
            rows = []
            for sid in sorted(owned, key=lambda s: (-acts[s], s)):
                rows.append([skills.name(sid) or "?", sid, skills.kind(sid, types.get(sid)), f"L{owned[sid]}",
                             f"{acts[sid]}/{a.n}", fi(pts[sid])])
            R.table(["Skill", "ID", "Tipo", "Liv.", "Attivazioni", "Punti base"], rows, "lrllrr")
    all_ids = {sid for u in all_ur for sid in u.skills_owned}
    unnamed = sorted(sid for sid in all_ids if not skills.name(sid))
    if unnamed:
        R.p()
        R.p(f"({len(unnamed)} skill senza nome nel database: aggiornalo con --aggiorna-nomi.)")

    # ---------------- Priorita'
    R.h2("Cosa migliorare (priorita' stimate)")
    R.p(f"Stime in punti FINALI per sessione (5 gare); 1 punto base ~ {ff(mult_std, 2)} finali. Ordinate per guadagno.")
    R.p()
    for gain, text in est:
        R.bullet(f"[~{fi(gain)}] {text}")
    R.p()
    R.p("Altre indicazioni (non quantificabili):")
    for _prio, text in notes:
        R.bullet(text)
    R.p()

    # ---------------- Dettaglio gare
    if args.dettaglio:
        R.h2("Dettaglio gare")
        for s in sessions:
            for r in s.races:
                res = "VINTA" if r.win else "persa"
                R.p(f"{s.label} - G{r.rnd} {DIST_NAMES.get(r.dist_type)} {r.distance or '?'}m "
                    f"({WEATHER_NAMES.get(r.weather, '?')}, {GROUND_NAMES.get(r.ground, '?')}) - {res} - "
                    f"{fi(r.total)} punti" + (f" (bonus squadra {fi(r.team_final)})" if r.team_final else ""))
                rows = []
                for u in sorted(r.ours, key=lambda x: x.finish):
                    notes = []
                    if u.rushed:
                        notes.append(f"rushed {u.rushed_secs}s")
                    if u.hp_zero_left:
                        notes.append(f"HP finita a {fi(u.hp_zero_left)}m")
                    if u.spurt_late and u.spurt_late > 10:
                        notes.append(f"sprint +{fi(u.spurt_late)}m")
                    if u.cat_count["start"]:
                        notes.append("partenza perfetta")
                    if u.cat_count["margin"]:
                        notes.append("margine")
                    if u.cat_count["upset"]:
                        notes.append("sorpresa")
                    if u.cat_count["time"]:
                        notes.append("bonus tempo")
                    rows.append([labels.get(u.key, u.name), ("ACE" if u.is_ace else u.slot), u.finish, u.popularity,
                                 MOOD_NAMES.get(u.mood, "?"), fi(u.raw), fi(u.final),
                                 f"{u.cat_count['white']}/{u.cat_count['gold']}/{u.cat_count['unique']}",
                                 ", ".join(notes)])
                for o in sorted(r.opponents, key=lambda x: x.finish):
                    rows.append([f"  avv. {o.name}", o.slot, o.finish, "", "", "", "", "", STYLE_NAMES.get(o.style, "")])
                R.table(["Uma", "Slot", "Arr.", "Pop.", "Umore", "Base", "Finali", "Sk b/o/u", "Note"], rows,
                        "lrrrlrrrl")

    R.h2("Legenda: eventi che danno punti base")
    for line in LEGEND:
        R.bullet(line)
    R.p()
    R.p("Regole ricavate confrontando ogni evento di punteggio con il replay della gara;")
    R.p("quelle marcate '(dedotto)' si basano su pochi casi.")
    return R.render()


def make_recommendations(umas: List[UmaAgg], races: List[Race], all_ur: List[UmaRace], mult: float,
                         skills: Optional[SkillDB] = None) -> Tuple[List[Tuple[float, str]], List[Tuple[int, str]]]:
    """Restituisce (stime, note).

    stime = [(guadagno stimato in punti FINALI per sessione, testo)]
    note  = [(priorita', testo)] per le indicazioni non quantificabili.
    """
    skills = skills or SkillDB()
    est: List[Tuple[float, str]] = []
    notes: List[Tuple[int, str]] = []
    n_sessions = max(1, len({r.session for r in races}))
    labels = {a.key: a.label for a in umas}
    # i consigli riguardano solo la squadra attuale (ultima sessione); lo storico resta nelle statistiche
    cur = [a for a in umas if a.current] or umas

    for a in cur:
        n = a.n
        m = a.multiplier
        st = a.last.stats
        per_session = 1  # ogni uma della squadra corre una gara a sessione

        # Attitudini sotto A
        u = a.last
        bad = []
        if u.apt_dist is not None and u.apt_dist < 7:
            bad.append(f"distanza {APT_LETTERS.get(u.apt_dist, '?')} (velocita' ridotta)")
        if u.apt_ground is not None and u.apt_ground < 7:
            bad.append(f"terreno {APT_LETTERS.get(u.apt_ground, '?')}")
        if u.apt_style is not None and u.apt_style < 7:
            bad.append(f"stile {APT_LETTERS.get(u.apt_style, '?')}")
        if bad:
            notes.append((1, f"{a.name} ({a.dist_label}): attitudine {', '.join(bad)}. Sotto A c'e' una penalita' "
                             f"in gara: meglio un'uma con A/S in questa categoria, o alzarla con l'ereditarieta'."))

        # Stamina insufficiente
        short = [r for r in a.races if r.stamina_short]
        if short:
            where = ", ".join(sorted({f"{r.distance}m" for r in short if r.distance}))
            causes = []
            if any(r.hp_zero_left and r.hp_zero_left > 10 for r in short):
                left = safe_mean([r.hp_zero_left for r in short if r.hp_zero_left and r.hp_zero_left > 10])
                causes.append(f"HP finita prima del traguardo (in media a {fi(left)} m dall'arrivo)")
            if any(r.spurt_late and r.spurt_late > 10 for r in short):
                causes.append("sprint finale partito in ritardo")
            rushed_too = sum(1 for r in short if r.rushed)
            extra = f", {rushed_too} con rushed" if rushed_too else ""
            gain = len(short) / n * 1000 * m * per_session
            est.append((gain, f"{a.name}: stamina insufficiente in {len(short)}/{n} gare ({where}{extra}): "
                              f"{' e '.join(causes)}. STA {st['stamina']}: piu' Resistenza o skill di recupero "
                              f"(stima: ~1 posizione = 1.000 base)."))
        else:
            hp_end = safe_mean([r.hp_end_pct for r in a.races])
            if hp_end is not None and hp_end >= 0.15 and n >= 2:
                notes.append((3, f"{a.name}: arriva in media con il {pct(hp_end)} di HP e non resta mai a secco: "
                                 f"STA {st['stamina']} forse in eccesso, nei prossimi allenamenti punti spostabili "
                                 f"su SPD/POW."))

        # Skill unica poco attivata (servono almeno 2 gare per parlarne)
        if n >= 2 and any(r.has_unique for r in a.races):
            k = a.count(lambda r: r.cat_count["unique"] > 0)
            if k / n < 0.6:
                val = safe_mean([r.unique_value for r in a.races if r.unique_value]) or 2400
                uid = next((sid for sid in a.last.skills_owned if 100000 <= sid < 200000), None)
                uname = f" \"{skills.name(uid)}\"" if uid and skills.name(uid) else ""
                est.append(((1 - k / n) * val * m * per_session,
                            f"{a.name}: skill unica{uname} attivata solo {k}/{n} volte ({fi(val)} base ciascuna): le sue "
                            f"condizioni (posizione/fase di gara) si verificano di rado con stile e distanza attuali."))

        # Rushed frequente per la singola uma
        k = a.count(lambda r: r.rushed)
        if k >= 2 or (n >= 2 and k / n >= 0.4):
            loss = sum(r.rushed_loss for r in a.races) / n
            wiz = st["wiz"]
            hint = ("alzare la Saggezza riduce il rischio" if wiz < 1200
                    else "la Saggezza e' gia' alta: e' soprattutto sfortuna")
            est.append((loss * m * per_session,
                        f"{a.name}: rushed in {k}/{n} gare (-{fi(loss)} base a gara di penalita', piu' HP sprecata). "
                        f"WIT {wiz}, rischio teorico ~{pct(rushed_chance(wiz))}: {hint}."))

    # Rushed complessivo
    rushed_ur = [u for u in all_ur if u.rushed]
    if rushed_ur:
        loss = sum(u.rushed_loss * safe_mean(u.multipliers, mult) for u in rushed_ur) / n_sessions
        risky = sorted(cur, key=lambda a: a.last.stats["wiz"])[:4]
        est.append((loss, f"Rushed in {len(rushed_ur)}/{len(all_ur)} uma-gare: ~{fi(loss)} finali persi a sessione "
                          f"solo di penalita' (l'HP sprecata costa anche posizioni). Rischio teorico piu' alto: "
                          + ", ".join(f"{a.name} (WIT {a.last.stats['wiz']}, ~{pct(rushed_chance(a.last.stats['wiz']))})"
                                      for a in risky) + "."))

    # Saggezza bassa -> skill che non superano il controllo di attivazione
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
        est.append((gain, f"Saggezza bassa = meno skill attivate (controllo WIT, prob. teorica): "
                          + ", ".join(f"{a.name} WIT {a.last.stats['wiz']} ~{pct(p)}" for _g, a, p in wit_items[:5])
                          + f". Portandola a {fi(target)} (~{pct(skill_chance(target))}) stima ~{fi(gain)} a sessione."))

    # Slot 1 (+10%): va all'uma che fa piu' punti base nella sua distanza
    by_dist: Dict[int, List[UmaAgg]] = defaultdict(list)
    for a in cur:
        by_dist[a.last.dist_type].append(a)
    for dt, group in sorted(by_dist.items()):
        ace = next((a for a in group if a.last.slot == 1), None)
        best = max(group, key=lambda a: a.avg("raw"))
        if ace and best is not ace and best.n >= 2 and ace.n >= 2:
            diff = best.avg("raw") - ace.avg("raw")
            est.append((0.10 * diff,
                        f"{DIST_NAMES.get(dt)}: metti {best.name} come prima uma (slot 1) al posto di {ace.name} "
                        f"({fi(best.avg('raw'))} vs {fi(ace.avg('raw'))} base medi): il +10% rende di piu' "
                        f"sull'uma che fa piu' punti."))

    # Bonus squadra mancato: chi resta fuori dalle prime 5?
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
        est.append((gain, f"Bonus squadra (tutte e 3 nelle prime 5 = 4.000 base) mancato in {len(missed)}/{len(races)} "
                          f"gare: vale fino a ~{fi(gain)} a sessione."
                          + (f" Gare perse per una sola uma fuori dalle prime 5: {who}." if who else "")))

    # Partenze perfette
    starts = [u for u in all_ur if u.start_delay is not None]
    if starts:
        rate = sum(1 for u in starts if u.cat_count["start"]) / len(starts)
        per_session = len(all_ur) / n_sessions
        gain = max(0.0, 0.5 - rate) * 1000 * mult * per_session
        # chi ha una skill di partenza (Concentration / Focus) e con che risultati
        groups = []
        for sid in sorted(START_SKILLS):  # la prima (oro) ha la precedenza se un'uma le ha entrambe
            done = {id(u) for _s, g in groups for u in g}
            groups.append((skills.name(sid) or str(sid),
                           [u for u in starts if sid in u.skills_owned and id(u) not in done]))
        done = {id(u) for _s, g in groups for u in g}
        groups.append(("nessuna delle due", [u for u in starts if id(u) not in done]))
        parts = [f"{nm} {sum(1 for u in g if u.cat_count['start'])}/{len(g)} ({', '.join(sorted({labels.get(u.key, u.name) for u in g}))})"
                 if nm != "nessuna delle due" else f"{nm} {sum(1 for u in g if u.cat_count['start'])}/{len(g)}"
                 for nm, g in groups if g]
        detail = " Partenze perfette per skill: " + "; ".join(parts) + "."
        if gain > 0:
            est.append((gain, f"Partenza perfetta nel {pct(rate)} dei casi (+1.000 base ognuna). E' casuale (~20% "
                              f"senza aiuti), ma le skill che riducono il ritardo in partenza la rendono molto piu' "
                              f"frequente: arrivare al 50% varrebbe ~{fi(gain)} a sessione.{detail}"))

    # 1a del proprio stile
    l16 = sum(1 for u in all_ur if u.cat_count["lead16"]) / len(all_ur)
    l23 = sum(1 for u in all_ur if u.cat_count["lead23"]) / len(all_ur)
    never_lead = [a.name for a in cur if a.n >= 2 and
                  a.count(lambda r: r.cat_count["lead16"] or r.cat_count["lead23"]) == 0]
    notes.append((4, f"'1a del proprio stile' (1.000 base a 1/6 e 1.000 a 2/3 di gara) ottenuto nel {pct(l16)} e "
                     f"{pct(l23)} dei casi" + (f"; mai da: {', '.join(never_lead)}" if never_lead else "") +
                     ". Conta essere davanti alle altre uma con la STESSA strategia, avversarie comprese."))

    # Uma con pochi dati
    few = [a for a in cur if a.n < 3]
    if few and len(few) < len(cur):
        notes.append((2, "Poche gare per giudicare con sicurezza: " +
                      ", ".join(f"{a.name} ({a.n} {'gara' if a.n == 1 else 'gare'})" for a in few) +
                      ". Le loro statistiche diventano affidabili dopo qualche sessione."))

    # Piazzamento
    worst = sorted(cur, key=lambda a: -(a.avg("finish") or 0))[:3]
    notes.append((2, f"Il piazzamento e' la voce principale (~1.000 base, ~{fi(1000 * mult)} finali a posizione; "
                     f"1a vs 2a = 2.000 base + margine). Piazzamento medio peggiore: "
                     + ", ".join(f"{a.name} {ff(a.avg('finish'), 1)}" for a in worst) + "."))

    # Skill mai attivate (riassunto; il dettaglio e' nella sezione Skill)
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
        notes.append((5, "Skill mai attivate (vedi sezione Skill): " +
                         ", ".join(f"{nm} {nv}" for nv, nm in never_counts) +
                         ". Nei prossimi allenamenti preferisci skill con condizioni che la tua uma soddisfa "
                         "(ogni attivazione vale 500-1.200 base)."))

    est.sort(key=lambda x: -x[0])
    notes.sort(key=lambda x: x[0])
    return est, notes


# ---------------------------------------------------------------------------
# Esportazione CSV
# ---------------------------------------------------------------------------


def export_csv(sessions: List[Session], outdir: str, skills: Optional[SkillDB] = None) -> List[str]:
    skills = skills or SkillDB()
    os.makedirs(outdir, exist_ok=True)
    written = []
    aggs = aggregate_umas(sessions)
    agg_of = {a.key: a for a in aggs}
    p1 = os.path.join(outdir, "uma_gare.csv")
    with open(p1, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["sessione", "gara", "distanza_tipo", "metri", "vinta", "uma", "in_squadra", "tcid", "slot", "stile",
                    "SPD", "STA", "POW", "GUT", "WIT", "umore", "popolarita", "arrivo", "punti_base", "punti_finali",
                    *[f"base_{k}" for k in CATEGORY_ORDER if k != "team"],
                    "skill_bianche", "skill_oro", "skill_unica", "ritardo_partenza", "rushed_secondi",
                    "hp_finale_pct", "hp_finita_m_al_traguardo", "sprint_ritardo_m", "bloccata_pct"])
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

    p2 = os.path.join(outdir, "eventi_punteggio.csv")
    with open(p2, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["sessione", "gara", "uma", "raw_score_id", "categoria", "descrizione", "volte", "punti_base", "punti_finali"])
        for s in sessions:
            for r in s.races:
                for u in r.ours:
                    for rid, num, raw, fin in u.entries:
                        ck, desc = score_category(rid)
                        w.writerow([s.label, r.rnd, agg_of[u.key].name, rid, ck, desc, num, raw, fin])
    written.append(p2)

    p3 = os.path.join(outdir, "skill.csv")
    with open(p3, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["uma", "in_squadra", "tcid", "skill_id", "nome", "livello", "tipo", "gare", "attivazioni",
                    "punti_base"])
        for a in aggs:
            owned, acts, types, pts = {}, Counter(), {}, Counter()
            for r in a.races:
                owned.update(r.skills_owned)
                acts.update(r.skill_acts)
                types.update(r.skill_type)
                pts.update(r.skill_points)
            for sid in sorted(owned):
                w.writerow([a.name, int(a.current), a.tcid, sid, skills.name(sid) or "", owned[sid], skills.kind(sid, types.get(sid)),
                            a.n, acts[sid], pts[sid]])
    written.append(p3)
    return written


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


SKILL_DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "skill_names.json")
SKILL_SRC_BASE = "https://raw.githubusercontent.com/alpha123/uma-tools/master/umalator-global/"


def load_skill_db(*paths: Optional[str]) -> SkillDB:
    """Carica nomi (e rarita') delle skill. I file successivi sovrascrivono i precedenti.

    Formati accettati: {"200012": "Nome"}, {"200012": ["Nome", rarita']},
    {"200012": {"name_en": "Nome", "rarity": 1}} oppure [{"id": 200012, "name_en": "Nome"}, ...].
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
            print(f"Nomi skill: impossibile leggere {path}: {e}", file=sys.stderr)
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
    """Unisce skillnames.json e skill_data.json di uma-tools nel formato {id: [nome, rarita']}."""
    out = {
        "_fonte": "https://github.com/alpha123/uma-tools (umalator-global: skillnames.json + skill_data.json), "
                  "testi del client Global",
        "_formato": "id -> [nome, rarita'] con rarita' 1 = bianca, 2 = oro, 3-5 = unica",
    }
    for k in sorted((k for k in names_raw if str(k).isdigit()), key=int):
        v = names_raw[k]
        name = v[0] if isinstance(v, list) and v else v
        rar = (data_raw.get(k) or {}).get("rarity") if isinstance(data_raw, dict) else None
        out[k] = [name, rar]
    return out


def update_skill_db(path: str = SKILL_DB_FILE) -> int:
    """Scarica la versione aggiornata dei nomi delle skill e la salva in `path`."""
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
    """Stesso contenuto per la webapp, come script (cosi' funziona anche aprendo index.html dal disco)."""
    body = ",\n".join(f"{json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}" for k, v in db.items())
    with open(path, "w", encoding="utf-8") as f:
        f.write("/* Generato da tt_stats.py --aggiorna-nomi: nomi e rarita' delle skill (Global). */\n"
                "window.UMA_SKILLS = {\n" + body + "\n};\n")


def write_skill_db(db: dict, path: str) -> None:
    """Una skill per riga, cosi' il file resta leggibile e modificabile a mano."""
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
            print(f"Attenzione: '{p}' non trovato", file=sys.stderr)
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
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # console Windows
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="Statistiche dei risultati di Team Trials (Uma Musume).")
    ap.add_argument("percorsi", nargs="*", help="file JSON o cartelle (default: ./data e cartella corrente)")
    ap.add_argument("--dettaglio", action="store_true", help="mostra il resoconto di ogni gara")
    ap.add_argument("--skill", action="store_true", help="tabella completa delle skill per ogni uma")
    ap.add_argument("--md", metavar="FILE", help="salva il report in Markdown")
    ap.add_argument("--csv", metavar="CARTELLA", help="esporta i dati in CSV (per Excel/Sheets)")
    ap.add_argument("--nomi-skill", metavar="FILE",
                    help="JSON aggiuntivo con i nomi delle skill (id -> nome), ha la precedenza su skill_names.json")
    ap.add_argument("--aggiorna-nomi", action="store_true",
                    help="scarica i nomi aggiornati delle skill in skill_names.json (serve internet)")
    args = ap.parse_args(argv)

    if args.aggiorna_nomi:
        try:
            n = update_skill_db()
            print(f"Nomi skill aggiornati: {n} skill salvate in {SKILL_DB_FILE}")
        except Exception as e:  # rete assente, URL cambiato, ...
            print(f"Aggiornamento dei nomi non riuscito: {e}", file=sys.stderr)
            return 1
        if not args.percorsi and not os.path.isdir("data"):
            return 0

    files = find_files(args.percorsi)
    sessions = []
    for f in files:
        try:
            sessions.append(load_session(f))
        except (ValueError, KeyError, json.JSONDecodeError) as e:
            print(f"Salto {f}: {e}", file=sys.stderr)
    if not sessions:
        print("Nessun file di Team Trials valido trovato. Passa i file .json o una cartella.", file=sys.stderr)
        return 1
    sessions.sort(key=lambda s: s.label)
    skills = load_skill_db(SKILL_DB_FILE, args.nomi_skill)

    args.md_mode = False
    print(build_report(sessions, args, skills), end="")
    if args.md:
        args.md_mode = True
        with open(args.md, "w", encoding="utf-8") as f:
            f.write(build_report(sessions, args, skills))
        print(f"\nReport Markdown salvato in {args.md}")
    if args.csv:
        for p in export_csv(sessions, args.csv, skills):
            print(f"CSV: {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
