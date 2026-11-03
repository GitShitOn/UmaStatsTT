/*
 * UmaStatsTT - Team Trials analysis engine.
 * Same logic as tt_stats.py, in JavaScript: runs in the browser (web app) and in Node (tests).
 * No dependencies: DataView reads the binary replay and DecompressionStream handles gzip.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- tables

  const DIST_NAMES = { 1: 'Sprint', 2: 'Mile', 3: 'Medium', 4: 'Long', 5: 'Dirt' };
  const STYLE_NAMES = { 1: 'Front', 2: 'Pace', 3: 'Late', 4: 'End' };
  const MOOD_NAMES = { 1: 'Awful', 2: 'Bad', 3: 'Normal', 4: 'Good', 5: 'Great' };
  const WEATHER_NAMES = { 1: 'Sunny', 2: 'Cloudy', 3: 'Rainy', 4: 'Snowy' };
  const GROUND_NAMES = { 1: 'Firm', 2: 'Good', 3: 'Soft', 4: 'Heavy' };
  const APT = { 1: 'G', 2: 'F', 3: 'E', 4: 'D', 5: 'C', 6: 'B', 7: 'A', 8: 'S' };
  const STAT_KEYS = [['speed', 'SPD'], ['stamina', 'STA'], ['pow', 'POW'], ['guts', 'GUT'], ['wiz', 'WIT']];
  const START_SKILLS = [200431, 200432]; // Concentration (gold), Focus (white)

  const CHARA_NAMES = {
    1001: 'Special Week', 1002: 'Silence Suzuka', 1003: 'Tokai Teio', 1004: 'Maruzensky',
    1005: 'Fuji Kiseki', 1006: 'Oguri Cap', 1007: 'Gold Ship', 1008: 'Vodka',
    1009: 'Daiwa Scarlet', 1010: 'Taiki Shuttle', 1011: 'Grass Wonder', 1012: 'Hishi Amazon',
    1013: 'Mejiro McQueen', 1014: 'El Condor Pasa', 1015: 'T.M. Opera O', 1016: 'Narita Brian',
    1017: 'Symboli Rudolf', 1018: 'Air Groove', 1019: 'Agnes Digital', 1020: 'Seiun Sky',
    1021: 'Tamamo Cross', 1022: 'Fine Motion', 1023: 'Biwa Hayahide', 1024: 'Mayano Top Gun',
    1025: 'Manhattan Cafe', 1026: 'Mihono Bourbon', 1027: 'Mejiro Ryan', 1028: 'Hishi Akebono',
    1029: 'Yukino Bijin', 1030: 'Rice Shower', 1031: 'Ines Fujin', 1032: 'Agnes Tachyon',
    1033: 'Admire Vega', 1034: 'Inari One', 1035: 'Winning Ticket', 1036: 'Air Shakur',
    1037: 'Eishin Flash', 1038: 'Curren Chan', 1039: 'Kawakami Princess', 1040: 'Gold City',
    1041: 'Sakura Bakushin O', 1042: 'Seeking the Pearl', 1043: 'Shinko Windy',
    1044: 'Sweep Tosho', 1045: 'Super Creek', 1046: 'Smart Falcon', 1047: 'Zenno Rob Roy',
    1048: 'Tosen Jordan', 1049: 'Nakayama Festa', 1050: 'Narita Taishin', 1051: 'Nishino Flower',
    1052: 'Haru Urara', 1053: 'Bamboo Memory', 1054: 'Biko Pegasus', 1055: 'Marvelous Sunday',
    1056: 'Matikanefukukitaru', 1057: 'Mr. C.B.', 1058: 'Meisho Doto', 1059: 'Mejiro Dober',
    1060: 'Nice Nature', 1061: 'King Halo', 1062: 'Matikanetannhauser', 1063: 'Ikuno Dictus',
    1064: 'Mejiro Palmer', 1065: 'Daitaku Helios', 1066: 'Twin Turbo', 1067: 'Satono Diamond',
    1068: 'Kitasan Black', 1069: 'Sakura Chiyono O', 1070: 'Sirius Symboli',
    1071: 'Mejiro Ardan', 1072: 'Yaeno Muteki',
  };

  const CATEGORY_LABELS = {
    place: 'Finishing position',
    margin: 'Winning margin',
    upset: 'Outsider in the top 3',
    unique: 'Unique skill',
    gold: 'Gold skills',
    white: 'White and inherited skills',
    start: 'Perfect start',
    lead16: 'Leads own strategy at 1/6',
    lead23: 'Leads own strategy at 2/3',
    time: 'Time bonus (under reference time)',
    rushed: 'Rushed (penalty)',
    team: 'Team bonus',
    other: 'Other',
  };
  const CATEGORY_ORDER = ['place', 'margin', 'upset', 'unique', 'gold', 'white', 'start',
    'lead16', 'lead23', 'time', 'rushed', 'team', 'other'];
  const SKILL_CATS = ['unique', 'gold', 'white'];

  const LEGEND = [
    ['Finishing position', '1st 10,000, 2nd 8,000, 3rd 7,000, 4th 6,000, 5th 5,000, 6th-7th 4,000, 8th-9th 3,000, 10th-12th 2,000.'],
    ['Winning margin', '1st place only: nose 5,000, head 3,000, neck 2,000; then 1,000 for ½ length, +100 per step up to 2,600 for 10 lengths, and 3,000 for more than 10. Photo-finish wins are worth the most.'],
    ['Outsider', '+4,000 if an uma with popularity 8 or lower finishes in the top 3.'],
    ['Skills', 'White or inherited unique 500, gold 1,200, unique 2,300-2,500 (grows with level). Passive skills count too.'],
    ['Perfect start', '+1,000 when the start delay is under 0.02 s.'],
    ['Leads own strategy', '+1,000 if at 1/6 of the race you are ahead of every uma with your same strategy, opponents included; another +1,000 at 2/3.'],
    ['Time bonus', '+100 per 0.1 s under a course reference time (up to 2,000 seen), mostly on Sprint and Mile.'],
    ['Rushed', '−500 when it starts and −100 for every second it lasts.'],
    ['Team bonus', '+4,000 if all 3 finish in the top 5, +5,000 if all 3 finish in the top 3.'],
    ['Percentage bonuses', 'On every item: opponent (+1.3 points per 1,000 opponent rating, −0.8 per 1,000 of your own), support cards (about +10%), first uma of the distance (+10%), win streak (+2% on the 2nd win in a row up to +5% on the 5th).'],
  ];

  function ordinal(n) {
    const suffix = n % 100 >= 10 && n % 100 <= 20 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
    return `${n}${suffix}`;
  }

  // Winning margin categories (raw_score_id 1-21). 1 length = 1/6 s of finish time.
  const MARGIN_LABELS = { 1: 'more than 10 lengths', 2: '10 lengths', 3: '9 lengths', 4: '8 lengths', 5: '7 lengths',
    6: '6 lengths', 7: '5 lengths', 8: '4 lengths', 9: '3½ lengths', 10: '3 lengths', 11: '2½ lengths', 12: '2 lengths',
    13: '1¾ lengths', 14: '1½ lengths', 15: '1¼ lengths', 16: '1 length', 17: '¾ length', 18: '½ length',
    19: 'nose', 20: 'head', 21: 'neck' };

  // Opponent bonus = a + b * opponent rating + c * own rating (fit on 77 sessions, error < 0.06 points).
  const OPP_BONUS_FIT = [-0.04099, 1.29733e-5, -0.78386e-5];
  const oppBonusModel = (opp, self) => OPP_BONUS_FIT[0] + OPP_BONUS_FIT[1] * opp + OPP_BONUS_FIT[2] * self;

  function scoreCategory(rid) {
    if (rid >= 1 && rid <= 21) return ['margin', `Winning margin: ${MARGIN_LABELS[rid]}`];
    if (rid === 22) return ['upset', 'Outsider (popularity 8 or lower) in the top 3'];
    if (rid === 23) return ['rushed', 'Rushed: start'];
    if (rid === 24) return ['rushed', 'Rushed: each second'];
    if (rid === 25) return ['start', 'Perfect start'];
    if (rid >= 40 && rid <= 55) return ['unique', `Unique skill (#${rid})`];
    if (rid === 56) return ['gold', 'Gold skill'];
    if (rid === 57) return ['white', 'White skill or inherited unique'];
    if (rid === 58) return ['lead16', 'Leads own strategy at 1/6'];
    if (rid === 59) return ['lead23', 'Leads own strategy at 2/3'];
    if (rid >= 60 && rid <= 71) return ['place', `Finished ${ordinal(rid - 59)}`];
    if (rid >= 72 && rid <= 92) return ['time', `Time bonus: ${((92 - rid) / 10).toFixed(1)} s under the reference time`];
    if (rid === 94) return ['team', 'Team: all in the top 3'];
    if (rid === 95) return ['team', 'Team: all in the top 5'];
    if (rid >= 93 && rid <= 99) return ['team', `Team bonus #${rid}`];
    return ['other', `Category #${rid}`];
  }

  function bonusKind(b) {
    return { 1: 'ace', 3: 'opponent', 4: 'streak', 5: 'support' }[b.condition_type] || `bonus#${b.score_bonus_id}`;
  }
  const BONUS_LABELS = {
    opponent: 'Opponent',
    support: 'Support cards',
    ace: 'First uma of the distance',
    streak: 'Win streak',
  };

  // ---------------------------------------------------------------- helpers

  // English number format: 1,234 and 2.65
  const group = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const ff = (x, d = 1) => {
    if (x == null || Number.isNaN(x)) return '–';
    const [i, f] = Math.abs(x).toFixed(d).split('.');
    const neg = x < 0 && Number(Math.abs(x).toFixed(d)) !== 0;
    return (neg ? '−' : '') + group(i) + (f ? `.${f}` : '');
  };
  const fi = (x) => ff(x, 0);
  const pct = (x, d = 0) => (x == null || Number.isNaN(x) ? '–' : `${ff(100 * x, d)}%`);
  const plural = (n, one, many) => (n === 1 ? one : many);
  const mean = (xs) => { const v = xs.filter((x) => x != null && !Number.isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const sum = (xs) => xs.reduce((a, b) => a + (b || 0), 0);
  const inc = (obj, k, v = 1) => { obj[k] = (obj[k] || 0) + v; };
  const get = (obj, k) => obj[k] || 0;

  function charaName(charaId, cardId) {
    let base = CHARA_NAMES[charaId] || `Chara ${charaId}`;
    if (cardId && cardId % 100 !== 1) base += ' (alt)';
    return base;
  }

  function sessionLabel(filename) {
    const m = /(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(filename || '');
    if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
    return (filename || 'session').replace(/\.json$/i, '');
  }

  function distCategory(meters, distType) {
    if (meters) {
      if (meters <= 1400) return 'short';
      if (meters <= 1800) return 'mile';
      if (meters <= 2400) return 'middle';
      return 'long';
    }
    return { 1: 'short', 2: 'mile', 3: 'middle', 4: 'long' }[distType] || 'mile';
  }

  function rushedChance(wiz) {
    if (wiz <= 0) return 1;
    return Math.min(1, (6.5 / Math.log10(0.1 * wiz + 1)) ** 2 / 100);
  }
  function skillChance(wiz) {
    if (wiz <= 0) return 0.2;
    return Math.max(0.2, 1 - 90 / wiz);
  }

  // ---------------------------------------------------------------- skills

  class SkillDB {
    constructor(raw) {
      this.names = {};
      this.rarity = {};
      if (raw) this.merge(raw);
    }
    merge(raw) {
      const nameKeys = ['name_en', 'enname', 'name', 'name_jp', 'jpname'];
      const add = (sid, val) => {
        let name = null; let rar = null;
        if (Array.isArray(val)) { name = val[0]; rar = val[1]; }
        else if (val && typeof val === 'object') {
          name = nameKeys.map((k) => val[k]).find(Boolean); rar = val.rarity;
        } else name = val;
        if (name) this.names[+sid] = String(name);
        if (Number.isInteger(rar)) this.rarity[+sid] = rar;
      };
      let n = 0;
      if (Array.isArray(raw)) {
        raw.forEach((it) => { const id = it && (it.id ?? it.skill_id); if (id != null) { add(id, it); n++; } });
      } else if (raw && typeof raw === 'object') {
        Object.keys(raw).forEach((k) => { if (/^\d+$/.test(k)) { add(k, raw[k]); n++; } });
      }
      return n;
    }
    name(sid) {
      let n = this.names[sid];
      if (n && sid >= 900000 && sid < 1000000 && !/inherit/i.test(n)) n += ' (inherited)';
      return n || null;
    }
    label(sid) { const n = this.name(sid); return n ? `${n} [${sid}]` : String(sid); }
    kind(sid, observed) {
      if (sid >= 900000 && sid < 1000000) return 'inherited';
      const r = this.rarity[sid];
      if (r) return r === 1 ? 'white' : r === 2 ? 'gold' : 'unique';
      if (SKILL_CATS.includes(observed)) return observed;
      return sid >= 100000 && sid < 200000 ? 'unique' : '?';
    }
  }

  // ---------------------------------------------------------------- replay

  function b64ToBytes(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function gunzip(bytes) {
    if (typeof DecompressionStream === 'undefined') return null;
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function parseScenario(blob) {
    if (!blob) return null;
    try {
      const b = await gunzip(b64ToBytes(blob));
      if (!b) return null;
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const i32 = (o) => dv.getInt32(o, true);
      const f32 = (o) => dv.getFloat32(o, true);
      let off = 4 + i32(0);
      const hn = i32(off + 4); const hfs = i32(off + 8); const hrs = i32(off + 12); const pad1 = i32(off + 16);
      off += 20 + pad1;
      const fc = i32(off); const fs = i32(off + 4);
      off += 8;
      const frames = [];
      for (let i = 0; i < fc; i++) {
        const t = f32(off);
        const hs = [];
        for (let h = 0; h < hn; h++) {
          const o = off + 4 + h * hfs;
          if (hfs >= 12) {
            hs.push([f32(o), dv.getUint16(o + 4, true), dv.getUint16(o + 6, true), dv.getUint16(o + 8, true),
              dv.getInt8(o + 10), dv.getInt8(o + 11)]);
          } else hs.push([f32(o), 0, 0, 0, 0, -1]);
        }
        frames.push([t, hs]);
        off += fs;
      }
      off += 4 + i32(off);
      const results = [];
      for (let h = 0; h < hn; h++) {
        if (hrs >= 31) {
          results.push({ order: i32(off), time: f32(off + 4), diff: f32(off + 8), delay: f32(off + 12),
            spurt: f32(off + 18), style: dv.getUint8(off + 22), timeRaw: f32(off + 27) });
        } else {
          results.push({ order: i32(off), time: f32(off + 4), diff: f32(off + 8), delay: f32(off + 12),
            spurt: null, style: null, timeRaw: null });
        }
        off += hrs;
      }
      off += 4 + i32(off);
      const ec = i32(off);
      off += 4;
      const events = [];
      for (let i = 0; i < ec; i++) {
        const es = dv.getInt16(off, true);
        off += 2;
        const t = f32(off); const typ = dv.getInt8(off + 4); const pc = dv.getInt8(off + 5);
        const params = [];
        for (let k = 0; k < pc; k++) params.push(i32(off + 6 + 4 * k));
        events.push([t, typ, params]);
        off += es;
      }
      const sc = { frames, results, events, distance: null };
      sc.distance = estimateDistance(sc);
      return sc;
    } catch (e) {
      return null;
    }
  }

  function estimateDistance(sc) {
    if (!sc.frames.length || !sc.results.length) return null;
    let win = 0;
    sc.results.forEach((r, i) => { if (r.order < sc.results[win].order) win = i; });
    const tEnd = sc.results[win].timeRaw;
    if (tEnd == null) return null;
    for (let i = 0; i + 1 < sc.frames.length; i++) {
      const [t0, h0] = sc.frames[i]; const [t1, h1] = sc.frames[i + 1];
      if (t0 <= tEnd && tEnd <= t1 && t1 > t0) {
        const d = h0[win][0] + (h1[win][0] - h0[win][0]) * (tEnd - t0) / (t1 - t0);
        return Math.round(d / 100) * 100;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- loading

  function isTeamTrialsFile(data) {
    return data && Array.isArray(data.race_result_array) && Array.isArray(data.race_start_params_array);
  }

  /** Reduced copy of a file: only the fields the analysis uses, without trainer names. */
  function slimFile(data) {
    const keepHorse = (h, full) => {
      const o = { frame_order: h.frame_order, team_id: h.team_id, team_member_id: h.team_member_id,
        chara_id: h.chara_id, card_id: h.card_id, trained_chara_id: h.trained_chara_id };
      if (full) {
        ['speed', 'stamina', 'pow', 'guts', 'wiz', 'running_style', 'motivation', 'popularity',
          'proper_distance_short', 'proper_distance_mile', 'proper_distance_middle', 'proper_distance_long',
          'proper_ground_turf', 'proper_ground_dirt', 'proper_running_style_nige', 'proper_running_style_senko',
          'proper_running_style_sashi', 'proper_running_style_oikomi'].forEach((k) => { o[k] = h[k]; });
      }
      return o;
    };
    return {
      support_card_bonus: data.support_card_bonus,
      race_start_params_array: data.race_start_params_array.map((sp) => ({
        round: sp.round, race_instance_id: sp.race_instance_id, season: sp.season, weather: sp.weather,
        ground_condition: sp.ground_condition, self_evaluate: sp.self_evaluate, opponent_evaluate: sp.opponent_evaluate,
        race_horse_data_array: (sp.race_horse_data_array || []).map((h) => {
          const o = keepHorse(h, h.team_id !== 0);
          if (h.team_id !== 0) o.skill_array = (h.skill_array || []).map((s) => ({ skill_id: s.skill_id, level: s.level }));
          return o;
        }),
      })),
      race_result_array: data.race_result_array.map((rr) => ({
        round: rr.round, distance_type: rr.distance_type, win_type: rr.win_type,
        current_consecutive_win_count: rr.current_consecutive_win_count, team_total_score: rr.team_total_score,
        team_score_array: rr.team_score_array, race_scenario: rr.race_scenario,
        chara_result_array: rr.chara_result_array,
      })),
    };
  }

  async function loadSession(data, filename) {
    if (!isTeamTrialsFile(data) && data && isTeamTrialsFile(data.data)) data = data.data;
    if (!isTeamTrialsFile(data)) throw new Error('not a Team Trials results file');
    const label = sessionLabel(filename);
    const starts = {};
    data.race_start_params_array.forEach((sp) => { starts[sp.round] = sp; });
    const bonusRates = {};
    const races = [];
    let selfEval = null; let oppEval = null;

    for (const rr of data.race_result_array) {
      const rnd = rr.round;
      const sp = starts[rnd] || {};
      if (sp.self_evaluate != null) selfEval = sp.self_evaluate;
      if (sp.opponent_evaluate != null) oppEval = sp.opponent_evaluate;
      const horses = {};
      (sp.race_horse_data_array || []).forEach((h) => { horses[h.frame_order] = h; });
      const results = (rr.chara_result_array || []).slice().sort((a, b) => a.frame_order - b.frame_order);
      const scored = results.find((c) => (c.score_array || []).length);
      const ourTeam = scored ? scored.team_id : 1;
      const sc = await parseScenario(rr.race_scenario);
      const distance = sc ? sc.distance : null;
      const win = rr.win_type === 1;
      const ours = []; const opponents = [];

      for (const c of results) {
        const h = horses[c.frame_order] || {};
        const tid = c.team_id || 0;
        const stats = {};
        STAT_KEYS.forEach(([k]) => { stats[k] = h[k] || 0; });
        if (tid !== ourTeam) {
          if (tid) {
            opponents.push({ name: charaName(h.chara_id, h.card_id), charaId: h.chara_id, slot: h.team_member_id || 0,
              style: h.running_style || 0, stats, finish: c.finish_order || 0 });
          }
          continue;
        }
        const cat = distCategory(distance, rr.distance_type);
        const style = h.running_style || 0;
        const styleKey = { 1: 'nige', 2: 'senko', 3: 'sashi', 4: 'oikomi' }[style];
        const u = {
          session: label, rnd, raceId: sp.race_instance_id || 0, distType: rr.distance_type || 0, distance,
          tcid: c.trained_chara_id || h.trained_chara_id || 0, charaId: h.chara_id || 0, cardId: h.card_id || 0,
          name: charaName(h.chara_id, h.card_id), slot: h.team_member_id || 0, style, stats,
          aptDist: h[`proper_distance_${cat}`] ?? null,
          aptGround: h[rr.distance_type === 5 ? 'proper_ground_dirt' : 'proper_ground_turf'] ?? null,
          aptStyle: styleKey ? h[`proper_running_style_${styleKey}`] ?? null : null,
          mood: h.motivation || 0, popularity: h.popularity || 0, finish: c.finish_order || 0,
          finishTime: c.finish_time ? c.finish_time / 10000 : null, win,
          raw: 0, final: 0, catRaw: {}, catFinal: {}, catCount: {}, entries: [],
          skillsOwned: {}, skillActs: {}, skillType: {}, skillPoints: {}, uniqueValue: null,
          startDelay: null, rushedSecs: 0, rushedLoss: 0, spurtLate: null, hpStart: null, hpEndPct: null,
          hpZeroLeft: null, blockedLate: null, multipliers: [],
        };
        u.key = u.tcid ? String(u.tcid) : `${u.charaId}-${u.cardId}-${STAT_KEYS.map(([k]) => stats[k]).join('-')}`;
        (h.skill_array || []).forEach((s) => { u.skillsOwned[s.skill_id] = s.level || 1; });
        for (const s of c.score_array || []) {
          const bsum = sum((s.bonus_array || []).map((b) => b.bonus_score || 0));
          const raw = s.score - bsum;
          const num = s.num ?? 1;
          const [ck] = scoreCategory(s.raw_score_id);
          u.raw += raw; u.final += s.score;
          inc(u.catRaw, ck, raw); inc(u.catFinal, ck, s.score);
          if (s.raw_score_id !== 24) inc(u.catCount, ck, num);
          u.entries.push([s.raw_score_id, num, raw, s.score]);
          if (ck === 'rushed') {
            u.rushedLoss += -raw;
            if (s.raw_score_id === 24) u.rushedSecs += num;
          }
          if (ck === 'unique' && num) u.uniqueValue = Math.floor(raw / Math.max(1, num));
          if (raw > 0) {
            u.multipliers.push(s.score / raw);
            (s.bonus_array || []).forEach((b) => { (bonusRates[bonusKind(b)] ||= []).push((b.bonus_score || 0) / raw); });
          }
        }
        if (sc) scenarioDiagnostics(u, sc, c.frame_order - 1);
        ours.push(u);
      }

      let teamRaw = 0; let teamFinal = 0; const teamIds = [];
      for (const ts of rr.team_score_array || []) {
        const bsum = sum((ts.bonus_array || []).map((b) => b.bonus_score || 0));
        const raw = ts.score - bsum;
        teamRaw += raw; teamFinal += ts.score; teamIds.push(ts.raw_score_id);
        if (raw > 0) (ts.bonus_array || []).forEach((b) => { (bonusRates[bonusKind(b)] ||= []).push((b.bonus_score || 0) / raw); });
      }
      const first = results.find((c) => c.finish_order === 1);
      let winnerSide = '?';
      if (first) winnerSide = first.team_id === ourTeam ? 'us' : first.team_id ? 'opponents' : 'others';
      const total = rr.team_total_score || 0;
      races.push({
        session: label, rnd, raceId: sp.race_instance_id || 0, distType: rr.distance_type || 0, distance,
        season: sp.season || 0, weather: sp.weather || 0, ground: sp.ground_condition || 0, win,
        streakAfter: rr.current_consecutive_win_count || 0, total, teamRaw, teamFinal, teamIds, ours, opponents,
        winnerSide, checkOk: sum(ours.map((u) => u.final)) + teamFinal === total,
      });
    }
    races.sort((a, b) => a.rnd - b.rnd);
    return { label, filename, selfEval, oppEval, supportBonus: data.support_card_bonus ?? null, races, bonusRates,
      total: sum(races.map((r) => r.total)), wins: races.filter((r) => r.win).length };
  }

  function scenarioDiagnostics(u, sc, idx) {
    if (idx < 0 || idx >= sc.results.length) return;
    const res = sc.results[idx];
    u.startDelay = res.delay;
    let pending = null;
    for (const [t, typ, p] of sc.events) {
      if (!p.length || p[0] !== idx) continue;
      if (typ === 3 && p.length >= 2) {
        inc(u.skillActs, p[1]);
        pending = [t, p[1]];
      } else if (typ === 0 && p.length >= 3 && pending && Math.abs(pending[0] - t) < 1e-4) {
        const [ck] = scoreCategory(p[1]);
        if (SKILL_CATS.includes(ck)) {
          u.skillType[pending[1]] = ck;
          inc(u.skillPoints, pending[1], p[2]);
          pending = null;
        }
      }
    }
    const D = sc.distance;
    if (!D || !sc.frames.length) return;
    if (res.spurt && res.spurt > 0) u.spurtLate = res.spurt - D * 2 / 3;
    u.hpStart = sc.frames[0][1][idx][3] || null;
    let hpEnd = null; let late = 0; let blocked = 0;
    for (const [, hs] of sc.frames) {
      const [d, , , hp, , block] = hs[idx];
      if (d >= D) { hpEnd = hp; break; }
      if (hp === 0 && u.hpZeroLeft == null) u.hpZeroLeft = D - d;
      if (d >= D * 2 / 3) { late++; if (block !== -1) blocked++; }
    }
    if (hpEnd != null && u.hpStart) u.hpEndPct = hpEnd / u.hpStart;
    if (late) u.blockedLate = blocked / late;
  }

  // ---------------------------------------------------------------- aggregation

  const isRushed = (u) => get(u.catCount, 'rushed') > 0;
  const hpOut = (u) => u.hpZeroLeft != null && u.hpZeroLeft > 10;
  const spurtLate = (u) => u.spurtLate != null && u.spurtLate > 10;
  const staminaShort = (u) => hpOut(u) || spurtLate(u);
  const uniqueId = (u) => Object.keys(u.skillsOwned).map(Number).find((s) => s >= 100000 && s < 200000) ?? null;

  /** One entry per trained uma. The current team is the one in the latest session (by date). */
  function aggregateUmas(sessions) {
    sessions = sessions.slice().sort((a, b) => a.label.localeCompare(b.label));
    const by = new Map();
    sessions.forEach((s) => s.races.forEach((r) => r.ours.forEach((u) => {
      if (!by.has(u.key)) by.set(u.key, []);
      by.get(u.key).push(u);
    })));
    const latest = sessions.length ? sessions[sessions.length - 1].label : null;
    const aggs = [...by.entries()].map(([key, races]) => makeAgg(key, races, races.some((r) => r.session === latest)));
    // same character trained more than once: v1, v2, ... in order of first appearance
    const groups = {};
    aggs.forEach((a) => { (groups[a.name] ||= []).push(a); });
    Object.entries(groups).forEach(([name, g]) => { if (g.length > 1) g.forEach((a, i) => { a.name = `${name} v${i + 1}`; }); });
    aggs.forEach((a) => { a.label = a.current ? a.name : `${a.name} (former)`; });
    aggs.sort((a, b) => a.mainDist - b.mainDist || (a.current === b.current ? 0 : a.current ? -1 : 1)
      || a.last.slot - b.last.slot || a.name.localeCompare(b.name));
    return aggs;
  }

  /** Team differences between each session and the previous one: umas in, out and moved. */
  function teamChanges(sessions, umas) {
    const names = {};
    umas.forEach((a) => { names[a.key] = a.name; });
    const where = (v) => `${DIST_NAMES[v[0]] || v[0]}, slot ${v[1]}`;
    const out = [];
    let prev = null;
    sessions.slice().sort((a, b) => a.label.localeCompare(b.label)).forEach((s) => {
      const cur = {};
      s.races.forEach((r) => r.ours.forEach((u) => { cur[u.key] = [u.distType, u.slot]; }));
      if (prev) {
        const entered = Object.keys(cur).filter((k) => !(k in prev)).map((k) => `${names[k] || k} (${where(cur[k])})`);
        const left = Object.keys(prev).filter((k) => !(k in cur)).map((k) => names[k] || k);
        const moved = Object.keys(cur).filter((k) => k in prev && (prev[k][0] !== cur[k][0] || prev[k][1] !== cur[k][1]))
          .map((k) => `${names[k] || k}: ${where(prev[k])} → ${where(cur[k])}`);
        if (entered.length || left.length || moved.length) out.push({ session: s.label, entered, left, moved });
      }
      prev = cur;
    });
    return out;
  }

  function makeAgg(key, races, current) {
    const distCount = {};
    races.forEach((r) => inc(distCount, r.distType));
    const dists = Object.keys(distCount).map(Number).sort((a, b) => distCount[b] - distCount[a] || a - b);
    const a = {
      key, tcid: races[0].tcid, current, name: races[0].name, races, n: races.length, last: races[races.length - 1],
      mainDist: dists[0], distLabel: dists.map((d) => DIST_NAMES[d] || d).join('/'),
      avg: (fn) => mean(races.map(fn)),
      count: (pred) => races.filter(pred).length,
    };
    a.multiplier = mean(races.flatMap((r) => r.multipliers)) ?? 1;
    return a;
  }

  function umaSkills(a) {
    const owned = {}; const acts = {}; const types = {}; const pts = {};
    a.races.forEach((r) => {
      Object.assign(owned, r.skillsOwned);
      Object.entries(r.skillActs).forEach(([k, v]) => inc(acts, k, v));
      Object.assign(types, r.skillType);
      Object.entries(r.skillPoints).forEach(([k, v]) => inc(pts, k, v));
    });
    return { owned, acts, types, pts };
  }

  // ---------------------------------------------------------------- recommendations

  function makeRecommendations(umas, races, allUr, mult, skills) {
    const est = []; const notes = [];
    const nSessions = Math.max(1, new Set(races.map((r) => r.session)).size);
    const labels = {};
    umas.forEach((a) => { labels[a.key] = a.label; });
    // advice covers only the current team (latest session); history stays in the statistics
    const cur = umas.filter((a) => a.current).length ? umas.filter((a) => a.current) : umas;

    for (const a of cur) {
      // every uma on the team runs one race per session
      const n = a.n; const m = a.multiplier; const st = a.last.stats; const perSession = 1; const u = a.last;
      const bad = [];
      if (u.aptDist != null && u.aptDist < 7) bad.push(`distance aptitude ${APT[u.aptDist] || '?'} (lower speed)`);
      if (u.aptGround != null && u.aptGround < 7) bad.push(`track aptitude ${APT[u.aptGround] || '?'}`);
      if (u.aptStyle != null && u.aptStyle < 7) bad.push(`strategy aptitude ${APT[u.aptStyle] || '?'}`);
      if (bad.length) {
        notes.push({ prio: 1, uma: a.name, text: `${a.name} (${a.distLabel}): ${bad.join(', ')}. Below A there is a race penalty: better an uma with A or S for this category, or raise it through inheritance.` });
      }

      const short = a.races.filter(staminaShort);
      if (short.length) {
        const where = [...new Set(short.filter((r) => r.distance).map((r) => `${r.distance} m`))].sort().join(', ');
        const causes = [];
        const outs = short.filter(hpOut);
        if (outs.length) causes.push(`ran out of HP before the finish (on average ${fi(mean(outs.map((r) => r.hpZeroLeft)))} m out)`);
        if (short.some(spurtLate)) causes.push('started the final spurt late');
        const rushedToo = short.filter(isRushed).length;
        const gain = short.length / n * 1000 * m * perSession;
        est.push({ gain, uma: a.name, kind: 'stamina', text: `${a.name}: not enough stamina in ${short.length}/${n} races (${where}${rushedToo ? `, ${rushedToo} with rushed` : ''}): ${causes.join(' and ')}. With STA ${st.stamina} it needs more Stamina or recovery skills. Estimate: about 1 place, i.e. 1,000 base.` });
      } else {
        const hpEnd = mean(a.races.map((r) => r.hpEndPct));
        if (hpEnd != null && hpEnd >= 0.15 && n >= 2) {
          notes.push({ prio: 3, uma: a.name, text: `${a.name}: finishes with ${pct(hpEnd)} HP on average and never runs dry. STA ${st.stamina} is probably more than needed: in future training you can move points to SPD or POW.` });
        }
      }

      if (n >= 2 && a.races.some((r) => uniqueId(r) != null)) {
        const k = a.count((r) => get(r.catCount, 'unique') > 0);
        if (k / n < 0.6) {
          const val = mean(a.races.map((r) => r.uniqueValue).filter(Boolean)) || 2400;
          const uid = uniqueId(a.last);
          const uname = uid != null && skills.name(uid) ? ` “${skills.name(uid)}”` : '';
          est.push({ gain: (1 - k / n) * val * m * perSession, uma: a.name, kind: 'unique', text: `${a.name}: unique skill${uname} fired only ${k}/${n} times (${fi(val)} base each). Its position or race-phase conditions rarely happen with the current strategy and distance.` });
        }
      }

      const k = a.count(isRushed);
      if (k >= 2 || (n >= 2 && k / n >= 0.4)) {
        const loss = sum(a.races.map((r) => r.rushedLoss)) / n;
        const hint = st.wiz < 1200 ? 'raising Wit lowers the risk' : 'Wit is already high, it is mostly bad luck';
        est.push({ gain: loss * m * perSession, uma: a.name, kind: 'rushed', text: `${a.name}: rushed in ${k}/${n} races (−${fi(loss)} base per race in penalties, plus wasted HP). WIT ${st.wiz}, theoretical risk about ${pct(rushedChance(st.wiz))}: ${hint}.` });
      }
    }

    const rushedUr = allUr.filter(isRushed);
    if (rushedUr.length) {
      const loss = sum(rushedUr.map((u) => u.rushedLoss * (mean(u.multipliers) ?? mult))) / nSessions;
      const risky = cur.slice().sort((x, y) => x.last.stats.wiz - y.last.stats.wiz).slice(0, 4);
      est.push({ gain: loss, kind: 'rushed', text: `Rushed in ${rushedUr.length}/${allUr.length} runs: about ${fi(loss)} final points lost per session in penalties alone, and the wasted HP also costs places. Highest theoretical risk: ${risky.map((x) => `${x.name} (WIT ${x.last.stats.wiz}, ${pct(rushedChance(x.last.stats.wiz))})`).join(', ')}.` });
    }

    const target = 1000; const witItems = [];
    for (const a of cur) {
      const wiz = a.last.stats.wiz;
      if (wiz >= target) continue;
      const acts = mean(a.races.map((r) => get(r.catCount, 'white') + get(r.catCount, 'gold'))) || 0;
      const pts = mean(a.races.map((r) => get(r.catRaw, 'white') + get(r.catRaw, 'gold'))) || 0;
      if (!acts) continue;
      const pNow = skillChance(wiz); const pTgt = skillChance(target);
      const extraRaw = acts / pNow * (pTgt - pNow) * (pts / acts);
      witItems.push({ gain: extraRaw * a.multiplier, a, p: pNow });
    }
    if (witItems.length) {
      const gain = sum(witItems.map((x) => x.gain));
      witItems.sort((x, y) => y.gain - x.gain);
      est.push({ gain, kind: 'wit', text: `Low Wit means fewer skills firing (Wit check, theoretical chance): ${witItems.slice(0, 5).map((x) => `${x.a.name} WIT ${x.a.last.stats.wiz} ${pct(x.p)}`).join(', ')}. Raising it to ${fi(target)} (${pct(skillChance(target))}) is worth about ${fi(gain)} per session.` });
    }

    const byDist = {};
    cur.forEach((a) => { (byDist[a.last.distType] ||= []).push(a); });
    Object.keys(byDist).map(Number).sort((x, y) => x - y).forEach((dt) => {
      const groupDt = byDist[dt];
      const ace = groupDt.find((a) => a.last.slot === 1);
      const best = groupDt.reduce((x, y) => (y.avg((r) => r.raw) > x.avg((r) => r.raw) ? y : x));
      if (ace && best !== ace && best.n >= 2 && ace.n >= 2) {
        const diff = best.avg((r) => r.raw) - ace.avg((r) => r.raw);
        est.push({ gain: 0.1 * diff, kind: 'ace', text: `${DIST_NAMES[dt]}: put ${best.name} first (slot 1) instead of ${ace.name} (${fi(best.avg((r) => r.raw))} vs ${fi(ace.avg((r) => r.raw))} average base). The +10% pays more on the uma that scores more.` });
      }
    });

    const missed = races.filter((r) => !r.teamIds.length);
    if (missed.length) {
      const culprits = {};
      missed.forEach((r) => { const out = r.ours.filter((u) => u.finish > 5); if (out.length === 1) inc(culprits, labels[out[0].key] || out[0].name); });
      const teamMult = mean(races.filter((r) => r.teamRaw).map((r) => r.teamFinal / r.teamRaw)) ?? mult;
      const gain = missed.length / nSessions * 4000 * teamMult;
      const who = Object.entries(culprits).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([nm, c]) => `${nm} (${c})`).join(', ');
      est.push({ gain, kind: 'team', text: `Team bonus (all 3 in the top 5, 4,000 base) missed in ${missed.length}/${races.length} races: worth up to about ${fi(gain)} per session.${who ? ` Races missed because of a single uma outside the top 5: ${who}.` : ''}` });
    }

    const startsUr = allUr.filter((u) => u.startDelay != null);
    if (startsUr.length) {
      const rate = startsUr.filter((u) => get(u.catCount, 'start')).length / startsUr.length;
      const gain = Math.max(0, 0.5 - rate) * 1000 * mult * allUr.length / nSessions;
      const done = new Set(); const parts = [];
      START_SKILLS.forEach((sid) => {
        const g = startsUr.filter((u) => u.skillsOwned[sid] != null && !done.has(u));
        g.forEach((u) => done.add(u));
        if (g.length) parts.push(`${skills.name(sid) || sid} ${g.filter((u) => get(u.catCount, 'start')).length}/${g.length} (${[...new Set(g.map((u) => labels[u.key] || u.name))].sort().join(', ')})`);
      });
      const rest = startsUr.filter((u) => !done.has(u));
      if (rest.length) parts.push(`neither ${rest.filter((u) => get(u.catCount, 'start')).length}/${rest.length}`);
      if (gain > 0) {
        est.push({ gain, kind: 'start', text: `Perfect start in ${pct(rate)} of runs (+1,000 base each). It is random (about 20% without help), but skills that shorten the start delay make it much more frequent: reaching 50% would be worth about ${fi(gain)} per session. Perfect starts by skill: ${parts.join('; ')}.` });
      }
    }

    const basePerSession = (sum(allUr.map((u) => u.raw)) + sum(races.map((r) => r.teamRaw))) / nSessions;
    const perK = OPP_BONUS_FIT[1] * 1000 * basePerSession;
    notes.push({ prio: 2, text: `Opponent choice: every +1,000 opponent rating adds ${ff(OPP_BONUS_FIT[1] * 1e5, 2)} points to the opponent bonus, about ${fi(perK)} final points per session at your scores. Pick the strongest opponent you can still finish ahead of: stronger rivals also push your umas down the order.` });

    const l16 = allUr.filter((u) => get(u.catCount, 'lead16')).length / allUr.length;
    const l23 = allUr.filter((u) => get(u.catCount, 'lead23')).length / allUr.length;
    const neverLead = cur.filter((a) => a.n >= 2 && a.count((r) => get(r.catCount, 'lead16') || get(r.catCount, 'lead23')) === 0).map((a) => a.name);
    notes.push({ prio: 4, text: `“Leads own strategy” (1,000 base at 1/6 and 1,000 at 2/3 of the race) earned in ${pct(l16)} and ${pct(l23)} of runs${neverLead.length ? `; never by ${neverLead.join(', ')}` : ''}. What counts is being ahead of every other uma with the same strategy, opponents included.` });

    const few = cur.filter((a) => a.n < 3);
    if (few.length && few.length < cur.length) {
      notes.push({ prio: 2, text: `Too few races to judge reliably: ${few.map((a) => `${a.name} (${a.n} ${plural(a.n, 'race', 'races')})`).join(', ')}. Their statistics become reliable after a few sessions.` });
    }

    const worst = cur.slice().sort((x, y) => y.avg((r) => r.finish) - x.avg((r) => r.finish)).slice(0, 3);
    notes.push({ prio: 2, text: `Finishing position is the biggest item: about 1,000 base (${fi(1000 * mult)} final) per place, and 1st vs 2nd is 2,000 base plus the margin. Worst average place: ${worst.map((a) => `${a.name} ${ff(a.avg((r) => r.finish), 1)}`).join(', ')}.` });

    const neverCounts = [];
    cur.forEach((a) => {
      const { owned, acts } = umaSkills(a);
      const nv = Object.keys(owned).filter((s) => !acts[s]).length;
      if (nv && a.n >= 3) neverCounts.push([nv, a.name]);
    });
    if (neverCounts.length) {
      neverCounts.sort((x, y) => y[0] - x[0]);
      notes.push({ prio: 5, text: `Skills that never fired: ${neverCounts.map(([nv, nm]) => `${nm} ${nv}`).join(', ')}. In future training prefer skills whose conditions your uma actually meets: each activation is worth 500-1,200 base.` });
    }

    est.sort((x, y) => y.gain - x.gain);
    notes.sort((x, y) => x.prio - y.prio);
    return { est, notes };
  }

  // ---------------------------------------------------------------- full analysis

  function analyze(sessions, skills) {
    skills = skills || new SkillDB();
    sessions = sessions.slice().sort((a, b) => a.label.localeCompare(b.label));
    const races = sessions.flatMap((s) => s.races);
    const allUr = races.flatMap((r) => r.ours);
    const umas = aggregateUmas(sessions);
    const labels = {};
    umas.forEach((a) => { labels[a.key] = a.label; });
    const changes = teamChanges(sessions, umas);
    const nRaces = races.length;
    const nSessions = sessions.length;

    const allRates = {};
    sessions.forEach((s) => Object.entries(s.bonusRates).forEach(([k, v]) => { (allRates[k] ||= []).push(...v); }));
    const mult = 1 + (mean(allRates.opponent || []) || 0) + (mean(allRates.support || []) || 0);
    const supportCfg = [...new Set(sessions.map((s) => s.supportBonus).filter(Boolean))].sort();
    const oppErrs = sessions.filter((s) => s.oppEval && s.selfEval && (s.bonusRates.opponent || []).length)
      .map((s) => Math.abs(mean(s.bonusRates.opponent) - oppBonusModel(s.oppEval, s.selfEval)));
    const oppFormula = { a: OPP_BONUS_FIT[0], perK: OPP_BONUS_FIT[1] * 1000, selfPerK: OPP_BONUS_FIT[2] * 1000,
      maxErr: oppErrs.length ? Math.max(...oppErrs) : null };
    const bonuses = ['opponent', 'support', 'ace', 'streak'].filter((k) => allRates[k] && allRates[k].length).map((k) => {
      const v = allRates[k];
      return { key: k, label: BONUS_LABELS[k], min: Math.min(...v), max: Math.max(...v), mean: mean(v),
        cfg: k === 'support' && supportCfg.length ? supportCfg.map((x) => x / 10000) : null };
    });

    // sessions
    const sessionRows = sessions.map((s) => ({
      label: s.label, filename: s.filename, total: s.total, wins: s.wins, n: s.races.length,
      perRace: s.total / Math.max(1, s.races.length), oppEval: s.oppEval,
      oppRate: mean(s.bonusRates.opponent || []), supRate: s.supportBonus ? s.supportBonus / 10000 : mean(s.bonusRates.support || []),
      results: s.races.map((r) => r.win),
    }));

    // categories
    const catRaw = {}; const catFinal = {}; const catCnt = {}; const catHits = {}; const unit = {};
    allUr.forEach((u) => {
      Object.entries(u.catRaw).forEach(([k, v]) => { inc(catRaw, k, v); inc(catHits, k); });
      Object.entries(u.catFinal).forEach(([k, v]) => inc(catFinal, k, v));
      Object.entries(u.catCount).forEach(([k, v]) => inc(catCnt, k, v));
      u.entries.forEach(([rid, num, raw]) => { if (num) (unit[scoreCategory(rid)[0]] ||= new Set()).add(Math.floor(raw / num)); });
    });
    inc(catRaw, 'team', sum(races.map((r) => r.teamRaw)));
    inc(catFinal, 'team', sum(races.map((r) => r.teamFinal)));
    inc(catCnt, 'team', races.filter((r) => r.teamIds.length).length);
    inc(catHits, 'team', races.filter((r) => r.teamIds.length).length);
    unit.team = new Set(races.filter((r) => r.teamRaw).map((r) => r.teamRaw));
    const grand = sum(Object.values(catFinal));
    const categories = CATEGORY_ORDER.filter((k) => catRaw[k] || catCnt[k]).map((k) => {
      const vals = [...(unit[k] || [])].sort((x, y) => x - y);
      return { key: k, label: CATEGORY_LABELS[k], count: get(catCnt, k), hits: get(catHits, k),
        denom: k === 'team' ? nRaces : allUr.length, raw: get(catRaw, k), final: get(catFinal, k),
        share: grand ? get(catFinal, k) / grand : 0, perRace: get(catFinal, k) / Math.max(1, nRaces),
        unitMin: vals[0], unitMax: vals[vals.length - 1] };
    });

    // distances
    const distances = [...new Set(races.map((r) => r.distType))].sort((x, y) => x - y).map((dt) => {
      const rs = races.filter((r) => r.distType === dt);
      const urs = rs.flatMap((r) => r.ours);
      const opps = rs.flatMap((r) => r.opponents);
      const statDiff = STAT_KEYS.map(([k, lbl]) => {
        const o = mean(urs.map((u) => u.stats[k])); const p = mean(opps.map((x) => x.stats[k]));
        return { key: k, label: lbl, ours: o, opp: p, diff: o != null && p != null ? o - p : null };
      });
      return {
        dt, name: DIST_NAMES[dt] || String(dt),
        courses: [...new Set(rs.map((r) => r.distance).filter(Boolean))].sort((x, y) => x - y),
        races: rs.length, wins: rs.filter((r) => r.win).length, avgTotal: mean(rs.map((r) => r.total)),
        avgFinish: mean(urs.map((u) => u.finish)), oppFinish: mean(opps.map((o) => o.finish)),
        teamBonus: rs.filter((r) => r.teamIds.length).length, ourFirst: rs.filter((r) => r.winnerSide === 'us').length,
        statDiff,
      };
    });
    const consistent = races.filter((r) => r.win === (r.winnerSide === 'us')).length;

    // umas
    const umaRows = umas.map((a) => {
      const sk = umaSkills(a);
      const skillList = Object.keys(sk.owned).map(Number).map((sid) => ({
        id: sid, name: skills.name(sid), kind: skills.kind(sid, sk.types[sid]), level: sk.owned[sid],
        acts: get(sk.acts, sid), points: get(sk.pts, sid),
      })).sort((x, y) => y.acts - x.acts || x.id - y.id);
      const hasUnique = a.races.some((r) => uniqueId(r) != null);
      const uid = uniqueId(a.last);
      return {
        key: a.key, tcid: a.tcid, name: a.name, label: a.label, current: a.current,
        distLabel: a.distLabel, mainDist: a.mainDist, style: a.last.style,
        slot: a.last.slot, n: a.n, multiplier: a.multiplier,
        finishes: a.races.map((r) => r.finish),
        avgFinish: a.avg((r) => r.finish), avgRaw: a.avg((r) => r.raw), avgFinal: a.avg((r) => r.final),
        src: {
          place: a.avg((r) => get(r.catRaw, 'place')),
          skill: a.avg((r) => SKILL_CATS.reduce((t, k) => t + get(r.catRaw, k), 0)),
          pos: a.avg((r) => get(r.catRaw, 'start') + get(r.catRaw, 'lead16') + get(r.catRaw, 'lead23')),
          other: a.avg((r) => get(r.catRaw, 'margin') + get(r.catRaw, 'upset') + get(r.catRaw, 'time') + get(r.catRaw, 'other')),
          rushed: a.avg((r) => get(r.catRaw, 'rushed')),
        },
        diag: {
          white: a.avg((r) => get(r.catCount, 'white')), gold: a.avg((r) => get(r.catCount, 'gold')),
          hasUnique, uniqueK: a.count((r) => get(r.catCount, 'unique') > 0),
          uniqueLevel: uid != null ? a.last.skillsOwned[uid] : null, uniqueName: uid != null ? skills.name(uid) : null,
          start: a.count((r) => get(r.catCount, 'start') > 0), lead16: a.count((r) => get(r.catCount, 'lead16') > 0),
          lead23: a.count((r) => get(r.catCount, 'lead23') > 0), rushed: a.count(isRushed),
          hpOut: a.count(hpOut), spurtLate: a.count(spurtLate),
          hpEnd: a.avg((r) => r.hpEndPct), blocked: a.avg((r) => r.blockedLate),
        },
        stats: a.last.stats,
        apt: { dist: a.last.aptDist, ground: a.last.aptGround, style: a.last.aptStyle },
        skillChance: skillChance(a.last.stats.wiz), rushedChance: rushedChance(a.last.stats.wiz),
        moods: a.races.map((r) => r.mood),
        races: a.races.map((r) => raceNoteRow(r)),
        skills: skillList,
        never: skillList.filter((s) => !s.acts),
      };
    });

    // mood and starts
    const moods = [...new Set(allUr.map((u) => u.mood))].sort().map((m) => {
      const us = allUr.filter((u) => u.mood === m);
      return { mood: m, label: MOOD_NAMES[m] || String(m), n: us.length, avgFinish: mean(us.map((u) => u.finish)), avgRaw: mean(us.map((u) => u.raw)) };
    });
    const delays = allUr.map((u) => u.startDelay).filter((d) => d != null);
    const starts = { total: delays.length, perfect: delays.filter((d) => d < 0.02).length, mean: mean(delays) };

    // lost races
    const lost = races.filter((r) => !r.win).map((r) => {
      const w = r.opponents.find((o) => o.finish === 1);
      const best = r.ours.slice().sort((x, y) => x.finish - y.finish)[0];
      return { session: r.session, rnd: r.rnd, dist: DIST_NAMES[r.distType], distance: r.distance,
        winner: w ? { name: w.name, style: STYLE_NAMES[w.style] || '?', stats: w.stats } : null,
        best: best ? { name: labels[best.key] || best.name, finish: best.finish } : null };
    });

    const raceRows = sessions.map((s) => ({
      label: s.label,
      races: s.races.map((r) => ({
        rnd: r.rnd, dist: DIST_NAMES[r.distType] || String(r.distType), distType: r.distType, distance: r.distance,
        weather: WEATHER_NAMES[r.weather] || '?', ground: GROUND_NAMES[r.ground] || '?', win: r.win,
        total: r.total, teamFinal: r.teamFinal, checkOk: r.checkOk,
        ours: r.ours.slice().sort((x, y) => x.finish - y.finish).map((u) => ({ ...raceNoteRow(u), name: labels[u.key] || u.name })),
        opponents: r.opponents.slice().sort((x, y) => x.finish - y.finish).map((o) => ({ name: o.name, slot: o.slot, finish: o.finish, style: STYLE_NAMES[o.style] || '' })),
      })),
    }));

    const recs = makeRecommendations(umas, races, allUr, mult, skills);
    const unnamed = [...new Set(allUr.flatMap((u) => Object.keys(u.skillsOwned).map(Number)))].filter((s) => !skills.name(s));

    return {
      nSessions, nRaces, nUmas: umas.length, nCurrent: umas.filter((a) => a.current).length,
      latest: sessions.length ? sessions[sessions.length - 1].label : null, changes, mult, bonuses, oppFormula, sessions: sessionRows,
      totalAvg: sum(sessions.map((s) => s.total)) / Math.max(1, nSessions),
      raceAvg: sum(sessions.map((s) => s.total)) / Math.max(1, nRaces),
      wins: races.filter((r) => r.win).length,
      categories, grand, distances, consistent, umas: umaRows, moods, starts, lost, races: raceRows, recs,
      badChecks: races.filter((r) => !r.checkOk).length,
      missingReplay: allUr.filter((u) => u.startDelay == null).length,
      unnamed,
    };
  }

  function raceNoteRow(u) {
    const notes = [];
    if (isRushed(u)) notes.push({ t: `rushed ${u.rushedSecs} s`, s: 'bad' });
    if (hpOut(u)) notes.push({ t: `out of HP ${fi(u.hpZeroLeft)} m out`, s: 'bad' });
    if (spurtLate(u)) notes.push({ t: `spurt +${fi(u.spurtLate)} m`, s: 'warn' });
    if (get(u.catCount, 'start')) notes.push({ t: 'perfect start', s: 'good' });
    if (get(u.catCount, 'margin')) notes.push({ t: 'margin', s: 'good' });
    if (get(u.catCount, 'upset')) notes.push({ t: 'upset', s: 'good' });
    if (get(u.catCount, 'time')) notes.push({ t: 'time bonus', s: 'good' });
    return {
      session: u.session, rnd: u.rnd, dist: DIST_NAMES[u.distType] || String(u.distType), distance: u.distance,
      slot: u.slot, finish: u.finish, popularity: u.popularity, mood: MOOD_NAMES[u.mood] || '?', raw: u.raw, final: u.final,
      white: get(u.catCount, 'white'), gold: get(u.catCount, 'gold'), unique: get(u.catCount, 'unique'), notes,
    };
  }

  // ---------------------------------------------------------------- CSV

  function csvLine(cells) {
    return cells.map((c) => {
      const s = c == null ? '' : String(c);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',');
  }

  function umaRacesCSV(sessions) {
    const cats = CATEGORY_ORDER.filter((k) => k !== 'team');
    const agg = {};
    aggregateUmas(sessions).forEach((a) => { agg[a.key] = a; });
    const lines = [csvLine(['session', 'race', 'distance_type', 'meters', 'won', 'uma', 'on_team', 'tcid', 'slot', 'strategy',
      'SPD', 'STA', 'POW', 'GUT', 'WIT', 'mood', 'popularity', 'finish', 'base_points', 'final_points',
      ...cats.map((k) => `base_${k}`), 'white_skills', 'gold_skills', 'unique_skill', 'start_delay',
      'rushed_seconds', 'hp_left_pct', 'hp_out_m_to_finish', 'spurt_late_m', 'blocked_pct'])];
    const r1 = (x, d = 1) => (x == null ? '' : Math.round(x * 10 ** d) / 10 ** d);
    sessions.forEach((s) => s.races.forEach((r) => r.ours.forEach((u) => {
      lines.push(csvLine([s.label, r.rnd, DIST_NAMES[r.distType] || r.distType, r.distance || '', r.win ? 1 : 0,
        agg[u.key].name, agg[u.key].current ? 1 : 0, u.tcid, u.slot, STYLE_NAMES[u.style] || u.style, ...STAT_KEYS.map(([k]) => u.stats[k]),
        u.mood, u.popularity, u.finish, u.raw, u.final, ...cats.map((k) => get(u.catRaw, k)),
        get(u.catCount, 'white'), get(u.catCount, 'gold'), get(u.catCount, 'unique'), r1(u.startDelay, 4),
        u.rushedSecs, u.hpEndPct == null ? '' : r1(100 * u.hpEndPct), r1(u.hpZeroLeft), r1(u.spurtLate),
        u.blockedLate == null ? '' : r1(100 * u.blockedLate)]));
    })));
    return lines.join('\n') + '\n';
  }

  function skillsCSV(sessions, skills) {
    const lines = [csvLine(['uma', 'on_team', 'tcid', 'skill_id', 'name', 'level', 'kind', 'races', 'activations', 'base_points'])];
    aggregateUmas(sessions).forEach((a) => {
      const { owned, acts, types, pts } = umaSkills(a);
      Object.keys(owned).map(Number).sort((x, y) => x - y).forEach((sid) => {
        lines.push(csvLine([a.name, a.current ? 1 : 0, a.tcid, sid, skills.name(sid) || '', owned[sid], skills.kind(sid, types[sid]),
          a.n, get(acts, sid), get(pts, sid)]));
      });
    });
    return lines.join('\n') + '\n';
  }

  const api = {
    DIST_NAMES, STYLE_NAMES, MOOD_NAMES, WEATHER_NAMES, GROUND_NAMES, APT, STAT_KEYS, CATEGORY_LABELS,
    CATEGORY_ORDER, LEGEND, SkillDB, parseScenario, loadSession, slimFile, isTeamTrialsFile, analyze,
    umaRacesCSV, skillsCSV, rushedChance, skillChance, ordinal, plural, fi, ff, pct,
  };
  root.UmaEngine = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
