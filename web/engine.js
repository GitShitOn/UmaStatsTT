/*
 * UmaStatsTT - motore di analisi dei risultati di Team Trials.
 * Stessa logica di tt_stats.py, in JavaScript: gira nel browser (webapp) e in Node (test).
 * Nessuna dipendenza: usa DataView per il replay binario e DecompressionStream per il gzip.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- tabelle

  const DIST_NAMES = { 1: 'Sprint', 2: 'Mile', 3: 'Medium', 4: 'Long', 5: 'Dirt' };
  const STYLE_NAMES = { 1: 'Front', 2: 'Pace', 3: 'Late', 4: 'End' };
  const MOOD_NAMES = { 1: 'Pessimo', 2: 'Scarso', 3: 'Normale', 4: 'Buono', 5: 'Ottimo' };
  const WEATHER_NAMES = { 1: 'Sole', 2: 'Nuvoloso', 3: 'Pioggia', 4: 'Neve' };
  const GROUND_NAMES = { 1: 'Firm', 2: 'Good', 3: 'Soft', 4: 'Heavy' };
  const APT = { 1: 'G', 2: 'F', 3: 'E', 4: 'D', 5: 'C', 6: 'B', 7: 'A', 8: 'S' };
  const STAT_KEYS = [['speed', 'SPD'], ['stamina', 'STA'], ['pow', 'POW'], ['guts', 'GUT'], ['wiz', 'WIT']];
  const START_SKILLS = [200431, 200432]; // Concentration (oro), Focus (bianca)

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
    place: 'Piazzamento',
    margin: 'Margine di vittoria',
    upset: 'Sorpresa vs popolarità',
    unique: 'Skill unica',
    gold: 'Skill oro',
    white: 'Skill bianche ed ereditate',
    start: 'Partenza perfetta',
    lead16: '1ª del suo stile a 1/6',
    lead23: '1ª del suo stile a 2/3',
    time: 'Bonus tempo',
    rushed: 'Rushed (penalità)',
    team: 'Bonus squadra',
    other: 'Altro',
  };
  const CATEGORY_ORDER = ['place', 'margin', 'upset', 'unique', 'gold', 'white', 'start',
    'lead16', 'lead23', 'time', 'rushed', 'team', 'other'];
  const SKILL_CATS = ['unique', 'gold', 'white'];

  const LEGEND = [
    ['Piazzamento', '1ª 10.000, 2ª 8.000, 3ª 7.000, 4ª 6.000, 5ª 5.000, 6ª-7ª 4.000, 8ª 3.000, 10ª-12ª 2.000.'],
    ['Margine di vittoria', 'Solo per la 1ª: più distacco, più punti (visti da 1.000 a 2.200).'],
    ['Sorpresa (dedotto)', '3.000-4.000 per un 1° o 2° posto partendo poco favorita.'],
    ['Skill', 'Bianca o unica ereditata 500, oro 1.200, unica 2.300-2.500 (sale col livello). Contano anche le passive.'],
    ['Partenza perfetta', '+1.000 se il ritardo al via è sotto 0,02 s.'],
    ['1ª del suo stile', '+1.000 se a 1/6 di gara sei davanti a tutte le uma con la tua stessa strategia, avversarie comprese; altri +1.000 a 2/3.'],
    ['Bonus tempo', '+100 ogni 0,1 s sotto un tempo di riferimento del percorso (visto solo su Sprint e Mile).'],
    ['Rushed', '−500 quando parte e −100 per ogni secondo in cui dura.'],
    ['Bonus squadra', '+4.000 se tutte e 3 arrivano nelle prime 5, +5.000 se tutte nelle prime 3.'],
    ['Bonus percentuali', 'Su ogni voce: avversario (circa +155%, cresce con la sua valutazione), carte supporto (circa +10%), prima uma della distanza (+10%), serie di vittorie (+2%, +3%, ...).'],
  ];

  function scoreCategory(rid) {
    if (rid >= 1 && rid <= 19) return ['margin', `Margine di vittoria (#${rid})`];
    if (rid >= 20 && rid <= 22) return ['upset', `Sorpresa vs popolarità (#${rid})`];
    if (rid === 23) return ['rushed', 'Rushed: inizio'];
    if (rid === 24) return ['rushed', 'Rushed: ogni secondo'];
    if (rid === 25) return ['start', 'Partenza perfetta'];
    if (rid >= 40 && rid <= 55) return ['unique', `Skill unica (#${rid})`];
    if (rid === 56) return ['gold', 'Skill oro'];
    if (rid === 57) return ['white', 'Skill bianca o unica ereditata'];
    if (rid === 58) return ['lead16', '1ª del suo stile a 1/6'];
    if (rid === 59) return ['lead23', '1ª del suo stile a 2/3'];
    if (rid >= 60 && rid <= 71) return ['place', `Arrivo ${rid - 59}ª`];
    if (rid >= 80 && rid <= 92) return ['time', 'Bonus tempo'];
    if (rid === 94) return ['team', 'Squadra: tutte nelle prime 3'];
    if (rid === 95) return ['team', 'Squadra: tutte nelle prime 5'];
    if (rid >= 93 && rid <= 99) return ['team', `Bonus squadra #${rid}`];
    return ['other', `Categoria #${rid}`];
  }

  function bonusKind(b) {
    return { 1: 'ace', 3: 'avversario', 4: 'serie', 5: 'supporto' }[b.condition_type] || `bonus#${b.score_bonus_id}`;
  }
  const BONUS_LABELS = {
    avversario: 'Avversario',
    supporto: 'Carte supporto',
    ace: 'Prima uma della distanza',
    serie: 'Serie di vittorie',
  };

  // ---------------------------------------------------------------- utilità

  // formato italiano con separatore delle migliaia sempre presente (1.234) e virgola decimale
  const group = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const ff = (x, d = 1) => {
    if (x == null || Number.isNaN(x)) return '–';
    const [i, f] = Math.abs(x).toFixed(d).split('.');
    const neg = x < 0 && Number(Math.abs(x).toFixed(d)) !== 0;
    return (neg ? '−' : '') + group(i) + (f ? `,${f}` : '');
  };
  const fi = (x) => ff(x, 0);
  const pct = (x, d = 0) => (x == null || Number.isNaN(x) ? '–' : `${ff(100 * x, d)}%`);
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
    return (filename || 'sessione').replace(/\.json$/i, '');
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

  // ---------------------------------------------------------------- skill

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
      if (sid >= 900000 && sid < 1000000) return 'unica ered.';
      const r = this.rarity[sid];
      if (r) return r === 1 ? 'bianca' : r === 2 ? 'oro' : 'unica';
      if (observed === 'unique') return 'unica';
      if (observed === 'gold') return 'oro';
      if (observed === 'white') return 'bianca';
      return sid >= 100000 && sid < 200000 ? 'unica' : '?';
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

  // ---------------------------------------------------------------- caricamento

  function isTeamTrialsFile(data) {
    return data && Array.isArray(data.race_result_array) && Array.isArray(data.race_start_params_array);
  }

  /** Copia ridotta di un file: solo i campi usati dall'analisi, senza nomi di allenatori. */
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
    if (!isTeamTrialsFile(data)) throw new Error('non è un file di risultati Team Trials');
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
      if (first) winnerSide = first.team_id === ourTeam ? 'noi' : first.team_id ? 'avversari' : 'altri';
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

  // ---------------------------------------------------------------- aggregazione

  const isAce = (u) => u.slot === 1;
  const isRushed = (u) => get(u.catCount, 'rushed') > 0;
  const hpOut = (u) => u.hpZeroLeft != null && u.hpZeroLeft > 10;
  const spurtLate = (u) => u.spurtLate != null && u.spurtLate > 10;
  const staminaShort = (u) => hpOut(u) || spurtLate(u);
  const uniqueId = (u) => Object.keys(u.skillsOwned).map(Number).find((s) => s >= 100000 && s < 200000) ?? null;

  function aggregateUmas(sessions) {
    const by = new Map();
    sessions.forEach((s) => s.races.forEach((r) => r.ours.forEach((u) => {
      if (!by.has(u.tcid)) by.set(u.tcid, []);
      by.get(u.tcid).push(u);
    })));
    const aggs = [...by.entries()].map(([tcid, races]) => makeAgg(tcid, races));
    const cnt = {};
    aggs.forEach((a) => inc(cnt, a.name));
    aggs.forEach((a) => { if (cnt[a.name] > 1) a.name = `${a.name} #${a.tcid}`; });
    aggs.sort((a, b) => a.mainDist - b.mainDist || a.last.slot - b.last.slot || a.name.localeCompare(b.name));
    return aggs;
  }

  function makeAgg(tcid, races) {
    const distCount = {};
    races.forEach((r) => inc(distCount, r.distType));
    const dists = Object.keys(distCount).map(Number).sort((a, b) => distCount[b] - distCount[a] || a - b);
    const a = {
      tcid, name: races[0].name, races, n: races.length, last: races[races.length - 1],
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

  // ---------------------------------------------------------------- raccomandazioni

  function makeRecommendations(umas, races, allUr, mult, skills) {
    const est = []; const notes = [];
    const nSessions = Math.max(1, new Set(races.map((r) => r.session)).size);

    for (const a of umas) {
      const n = a.n; const m = a.multiplier; const st = a.last.stats; const perSession = n / nSessions; const u = a.last;
      const bad = [];
      if (u.aptDist != null && u.aptDist < 7) bad.push(`distanza ${APT[u.aptDist] || '?'} (velocità ridotta)`);
      if (u.aptGround != null && u.aptGround < 7) bad.push(`terreno ${APT[u.aptGround] || '?'}`);
      if (u.aptStyle != null && u.aptStyle < 7) bad.push(`stile ${APT[u.aptStyle] || '?'}`);
      if (bad.length) {
        notes.push({ prio: 1, uma: a.name, text: `${a.name} (${a.distLabel}): attitudine ${bad.join(', ')}. Sotto A c'è una penalità in gara: meglio un'uma con A o S in questa categoria, oppure alzarla con l'ereditarietà.` });
      }

      const short = a.races.filter(staminaShort);
      if (short.length) {
        const where = [...new Set(short.filter((r) => r.distance).map((r) => `${r.distance} m`))].sort().join(', ');
        const causes = [];
        const outs = short.filter(hpOut);
        if (outs.length) causes.push(`HP finita prima del traguardo (in media a ${fi(mean(outs.map((r) => r.hpZeroLeft)))} m dall'arrivo)`);
        if (short.some(spurtLate)) causes.push('sprint finale partito in ritardo');
        const rushedToo = short.filter(isRushed).length;
        const gain = short.length / n * 1000 * m * perSession;
        est.push({ gain, uma: a.name, kind: 'stamina', text: `${a.name}: stamina insufficiente in ${short.length}/${n} gare (${where}${rushedToo ? `, ${rushedToo} con rushed` : ''}): ${causes.join(' e ')}. Con STA ${st.stamina} servono più Resistenza o skill di recupero. Stima: circa 1 posizione, cioè 1.000 base.` });
      } else {
        const hpEnd = mean(a.races.map((r) => r.hpEndPct));
        if (hpEnd != null && hpEnd >= 0.15 && n >= 2) {
          notes.push({ prio: 3, uma: a.name, text: `${a.name}: arriva in media con il ${pct(hpEnd)} di HP e non resta mai a secco. STA ${st.stamina} forse in eccesso: nei prossimi allenamenti puoi spostare punti su SPD o POW.` });
        }
      }

      if (a.races.some((r) => uniqueId(r) != null)) {
        const k = a.count((r) => get(r.catCount, 'unique') > 0);
        if (k / n < 0.6) {
          const val = mean(a.races.map((r) => r.uniqueValue).filter(Boolean)) || 2400;
          const uid = uniqueId(a.last);
          const uname = uid != null && skills.name(uid) ? ` «${skills.name(uid)}»` : '';
          est.push({ gain: (1 - k / n) * val * m * perSession, uma: a.name, kind: 'unique', text: `${a.name}: skill unica${uname} attivata solo ${k}/${n} volte (${fi(val)} base ciascuna). Le sue condizioni di posizione o fase di gara si verificano di rado con lo stile e la distanza attuali.` });
        }
      }

      const k = a.count(isRushed);
      if (k >= 2 || (n >= 2 && k / n >= 0.4)) {
        const loss = sum(a.races.map((r) => r.rushedLoss)) / n;
        const hint = st.wiz < 1200 ? 'alzare la Saggezza riduce il rischio' : 'la Saggezza è già alta, è soprattutto sfortuna';
        est.push({ gain: loss * m * perSession, uma: a.name, kind: 'rushed', text: `${a.name}: rushed in ${k}/${n} gare (−${fi(loss)} base a gara di penalità, più HP sprecata). WIT ${st.wiz}, rischio teorico circa ${pct(rushedChance(st.wiz))}: ${hint}.` });
      }
    }

    const rushedUr = allUr.filter(isRushed);
    if (rushedUr.length) {
      const loss = sum(rushedUr.map((u) => u.rushedLoss * (mean(u.multipliers) ?? mult))) / nSessions;
      const risky = umas.slice().sort((x, y) => x.last.stats.wiz - y.last.stats.wiz).slice(0, 4);
      est.push({ gain: loss, kind: 'rushed', text: `Rushed in ${rushedUr.length}/${allUr.length} uma-gare: circa ${fi(loss)} finali persi a sessione solo di penalità, e l'HP sprecata costa anche posizioni. Rischio teorico più alto: ${risky.map((x) => `${x.name} (WIT ${x.last.stats.wiz}, ${pct(rushedChance(x.last.stats.wiz))})`).join(', ')}.` });
    }

    const target = 1000; const witItems = [];
    for (const a of umas) {
      const wiz = a.last.stats.wiz;
      if (wiz >= target) continue;
      const acts = mean(a.races.map((r) => get(r.catCount, 'white') + get(r.catCount, 'gold'))) || 0;
      const pts = mean(a.races.map((r) => get(r.catRaw, 'white') + get(r.catRaw, 'gold'))) || 0;
      if (!acts) continue;
      const pNow = skillChance(wiz); const pTgt = skillChance(target);
      const extraRaw = acts / pNow * (pTgt - pNow) * (pts / acts);
      witItems.push({ gain: extraRaw * a.multiplier * a.n / nSessions, a, p: pNow });
    }
    if (witItems.length) {
      const gain = sum(witItems.map((x) => x.gain));
      witItems.sort((x, y) => y.gain - x.gain);
      est.push({ gain, kind: 'wit', text: `Saggezza bassa vuol dire meno skill attivate (controllo WIT, probabilità teorica): ${witItems.slice(0, 5).map((x) => `${x.a.name} WIT ${x.a.last.stats.wiz} ${pct(x.p)}`).join(', ')}. Portandola a ${fi(target)} (${pct(skillChance(target))}) la stima è circa ${fi(gain)} a sessione.` });
    }

    const byDist = {};
    umas.forEach((a) => { (byDist[a.mainDist] ||= []).push(a); });
    Object.keys(byDist).map(Number).sort((x, y) => x - y).forEach((dt) => {
      const group = byDist[dt];
      const ace = group.find((a) => a.last.slot === 1);
      const best = group.reduce((x, y) => (y.avg((r) => r.raw) > x.avg((r) => r.raw) ? y : x));
      if (ace && best !== ace && best.n >= 2) {
        const diff = best.avg((r) => r.raw) - ace.avg((r) => r.raw);
        est.push({ gain: 0.1 * diff * best.n / nSessions, kind: 'ace', text: `${DIST_NAMES[dt]}: metti ${best.name} come prima uma (slot 1) al posto di ${ace.name} (${fi(best.avg((r) => r.raw))} contro ${fi(ace.avg((r) => r.raw))} base medi). Il +10% rende di più sull'uma che fa più punti.` });
      }
    });

    const missed = races.filter((r) => !r.teamIds.length);
    if (missed.length) {
      const culprits = {};
      missed.forEach((r) => { const out = r.ours.filter((u) => u.finish > 5); if (out.length === 1) inc(culprits, out[0].name); });
      const teamMult = mean(races.filter((r) => r.teamRaw).map((r) => r.teamFinal / r.teamRaw)) ?? mult;
      const gain = missed.length / nSessions * 4000 * teamMult;
      const who = Object.entries(culprits).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([nm, c]) => `${nm} (${c})`).join(', ');
      est.push({ gain, kind: 'team', text: `Bonus squadra (tutte e 3 nelle prime 5, 4.000 base) mancato in ${missed.length}/${races.length} gare: vale fino a circa ${fi(gain)} a sessione.${who ? ` Gare perse per una sola uma fuori dalle prime 5: ${who}.` : ''}` });
    }

    const startsUr = allUr.filter((u) => u.startDelay != null);
    if (startsUr.length) {
      const rate = startsUr.filter((u) => get(u.catCount, 'start')).length / startsUr.length;
      const gain = Math.max(0, 0.5 - rate) * 1000 * mult * allUr.length / nSessions;
      const done = new Set(); const parts = [];
      START_SKILLS.forEach((sid) => {
        const g = startsUr.filter((u) => u.skillsOwned[sid] != null && !done.has(u));
        g.forEach((u) => done.add(u));
        if (g.length) parts.push(`${skills.name(sid) || sid} ${g.filter((u) => get(u.catCount, 'start')).length}/${g.length} (${[...new Set(g.map((u) => u.name))].sort().join(', ')})`);
      });
      const rest = startsUr.filter((u) => !done.has(u));
      if (rest.length) parts.push(`nessuna delle due ${rest.filter((u) => get(u.catCount, 'start')).length}/${rest.length}`);
      if (gain > 0) {
        est.push({ gain, kind: 'start', text: `Partenza perfetta nel ${pct(rate)} dei casi (+1.000 base ognuna). È casuale (circa 20% senza aiuti), ma le skill che riducono il ritardo al via la rendono molto più frequente: arrivare al 50% varrebbe circa ${fi(gain)} a sessione. Partenze perfette per skill: ${parts.join('; ')}.` });
      }
    }

    const l16 = allUr.filter((u) => get(u.catCount, 'lead16')).length / allUr.length;
    const l23 = allUr.filter((u) => get(u.catCount, 'lead23')).length / allUr.length;
    const neverLead = umas.filter((a) => a.n >= 2 && a.count((r) => get(r.catCount, 'lead16') || get(r.catCount, 'lead23')) === 0).map((a) => a.name);
    notes.push({ prio: 4, text: `«1ª del suo stile» (1.000 base a 1/6 e 1.000 a 2/3 di gara) ottenuto nel ${pct(l16)} e nel ${pct(l23)} dei casi${neverLead.length ? `; mai da ${neverLead.join(', ')}` : ''}. Conta essere davanti alle altre uma con la stessa strategia, avversarie comprese.` });

    const worst = umas.slice().sort((x, y) => y.avg((r) => r.finish) - x.avg((r) => r.finish)).slice(0, 3);
    notes.push({ prio: 2, text: `Il piazzamento è la voce principale: circa 1.000 base (${fi(1000 * mult)} finali) a posizione, e tra 1ª e 2ª ci sono 2.000 base più il margine. Piazzamento medio peggiore: ${worst.map((a) => `${a.name} ${ff(a.avg((r) => r.finish), 1)}`).join(', ')}.` });

    const neverCounts = [];
    umas.forEach((a) => {
      const { owned, acts } = umaSkills(a);
      const nv = Object.keys(owned).filter((s) => !acts[s]).length;
      if (nv && a.n >= 3) neverCounts.push([nv, a.name]);
    });
    if (neverCounts.length) {
      neverCounts.sort((x, y) => y[0] - x[0]);
      notes.push({ prio: 5, text: `Skill mai attivate: ${neverCounts.map(([nv, nm]) => `${nm} ${nv}`).join(', ')}. Nei prossimi allenamenti preferisci skill con condizioni che la tua uma soddisfa: ogni attivazione vale 500-1.200 base.` });
    }

    est.sort((x, y) => y.gain - x.gain);
    notes.sort((x, y) => x.prio - y.prio);
    return { est, notes };
  }

  // ---------------------------------------------------------------- analisi completa

  function analyze(sessions, skills) {
    skills = skills || new SkillDB();
    sessions = sessions.slice().sort((a, b) => a.label.localeCompare(b.label));
    const races = sessions.flatMap((s) => s.races);
    const allUr = races.flatMap((r) => r.ours);
    const umas = aggregateUmas(sessions);
    const nRaces = races.length;
    const nSessions = sessions.length;

    const allRates = {};
    sessions.forEach((s) => Object.entries(s.bonusRates).forEach(([k, v]) => { (allRates[k] ||= []).push(...v); }));
    const mult = 1 + (mean(allRates.avversario || []) || 0) + (mean(allRates.supporto || []) || 0);
    const supportCfg = [...new Set(sessions.map((s) => s.supportBonus).filter(Boolean))].sort();
    const bonuses = ['avversario', 'supporto', 'ace', 'serie'].filter((k) => allRates[k] && allRates[k].length).map((k) => {
      const v = allRates[k];
      return { key: k, label: BONUS_LABELS[k], min: Math.min(...v), max: Math.max(...v), mean: mean(v),
        cfg: k === 'supporto' && supportCfg.length ? supportCfg.map((x) => x / 10000) : null };
    });

    // sessioni
    const sessionRows = sessions.map((s) => ({
      label: s.label, filename: s.filename, total: s.total, wins: s.wins, n: s.races.length,
      perRace: s.total / Math.max(1, s.races.length), oppEval: s.oppEval,
      oppRate: mean(s.bonusRates.avversario || []), supRate: s.supportBonus ? s.supportBonus / 10000 : mean(s.bonusRates.supporto || []),
      results: s.races.map((r) => r.win),
    }));

    // categorie
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

    // distanze
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
        teamBonus: rs.filter((r) => r.teamIds.length).length, ourFirst: rs.filter((r) => r.winnerSide === 'noi').length,
        statDiff,
      };
    });
    const consistent = races.filter((r) => r.win === (r.winnerSide === 'noi')).length;

    // uma
    const umaRows = umas.map((a) => {
      const sk = umaSkills(a);
      const skillList = Object.keys(sk.owned).map(Number).map((sid) => ({
        id: sid, name: skills.name(sid), kind: skills.kind(sid, sk.types[sid]), level: sk.owned[sid],
        acts: get(sk.acts, sid), points: get(sk.pts, sid),
      })).sort((x, y) => y.acts - x.acts || x.id - y.id);
      const hasUnique = a.races.some((r) => uniqueId(r) != null);
      const uid = uniqueId(a.last);
      return {
        tcid: a.tcid, name: a.name, distLabel: a.distLabel, mainDist: a.mainDist, style: a.last.style,
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

    // umore e partenze
    const moods = [...new Set(allUr.map((u) => u.mood))].sort().map((m) => {
      const us = allUr.filter((u) => u.mood === m);
      return { mood: m, label: MOOD_NAMES[m] || String(m), n: us.length, avgFinish: mean(us.map((u) => u.finish)), avgRaw: mean(us.map((u) => u.raw)) };
    });
    const delays = allUr.map((u) => u.startDelay).filter((d) => d != null);
    const starts = { total: delays.length, perfect: delays.filter((d) => d < 0.02).length, mean: mean(delays) };

    // gare perse
    const lost = races.filter((r) => !r.win).map((r) => {
      const w = r.opponents.find((o) => o.finish === 1);
      const best = r.ours.slice().sort((x, y) => x.finish - y.finish)[0];
      return { session: r.session, rnd: r.rnd, dist: DIST_NAMES[r.distType], distance: r.distance,
        winner: w ? { name: w.name, style: STYLE_NAMES[w.style] || '?', stats: w.stats } : null,
        best: best ? { name: best.name, finish: best.finish } : null };
    });

    const raceRows = sessions.map((s) => ({
      label: s.label,
      races: s.races.map((r) => ({
        rnd: r.rnd, dist: DIST_NAMES[r.distType] || String(r.distType), distType: r.distType, distance: r.distance,
        weather: WEATHER_NAMES[r.weather] || '?', ground: GROUND_NAMES[r.ground] || '?', win: r.win,
        total: r.total, teamFinal: r.teamFinal, checkOk: r.checkOk,
        ours: r.ours.slice().sort((x, y) => x.finish - y.finish).map((u) => ({ ...raceNoteRow(u), name: u.name })),
        opponents: r.opponents.slice().sort((x, y) => x.finish - y.finish).map((o) => ({ name: o.name, slot: o.slot, finish: o.finish, style: STYLE_NAMES[o.style] || '' })),
      })),
    }));

    const recs = makeRecommendations(umas, races, allUr, mult, skills);
    const unnamed = [...new Set(allUr.flatMap((u) => Object.keys(u.skillsOwned).map(Number)))].filter((s) => !skills.name(s));

    return {
      nSessions, nRaces, nUmas: umas.length, mult, bonuses, sessions: sessionRows,
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
    if (hpOut(u)) notes.push({ t: `HP finita a ${fi(u.hpZeroLeft)} m`, s: 'bad' });
    if (spurtLate(u)) notes.push({ t: `sprint +${fi(u.spurtLate)} m`, s: 'warn' });
    if (get(u.catCount, 'start')) notes.push({ t: 'partenza perfetta', s: 'good' });
    if (get(u.catCount, 'margin')) notes.push({ t: 'margine', s: 'good' });
    if (get(u.catCount, 'upset')) notes.push({ t: 'sorpresa', s: 'good' });
    if (get(u.catCount, 'time')) notes.push({ t: 'bonus tempo', s: 'good' });
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
    const lines = [csvLine(['sessione', 'gara', 'distanza_tipo', 'metri', 'vinta', 'uma', 'tcid', 'slot', 'stile',
      'SPD', 'STA', 'POW', 'GUT', 'WIT', 'umore', 'popolarita', 'arrivo', 'punti_base', 'punti_finali',
      ...cats.map((k) => `base_${k}`), 'skill_bianche', 'skill_oro', 'skill_unica', 'ritardo_partenza',
      'rushed_secondi', 'hp_finale_pct', 'hp_finita_m_al_traguardo', 'sprint_ritardo_m', 'bloccata_pct'])];
    const r1 = (x, d = 1) => (x == null ? '' : Math.round(x * 10 ** d) / 10 ** d);
    sessions.forEach((s) => s.races.forEach((r) => r.ours.forEach((u) => {
      lines.push(csvLine([s.label, r.rnd, DIST_NAMES[r.distType] || r.distType, r.distance || '', r.win ? 1 : 0,
        u.name, u.tcid, u.slot, STYLE_NAMES[u.style] || u.style, ...STAT_KEYS.map(([k]) => u.stats[k]),
        u.mood, u.popularity, u.finish, u.raw, u.final, ...cats.map((k) => get(u.catRaw, k)),
        get(u.catCount, 'white'), get(u.catCount, 'gold'), get(u.catCount, 'unique'), r1(u.startDelay, 4),
        u.rushedSecs, u.hpEndPct == null ? '' : r1(100 * u.hpEndPct), r1(u.hpZeroLeft), r1(u.spurtLate),
        u.blockedLate == null ? '' : r1(100 * u.blockedLate)]));
    })));
    return lines.join('\n') + '\n';
  }

  function skillsCSV(sessions, skills) {
    const lines = [csvLine(['uma', 'tcid', 'skill_id', 'nome', 'livello', 'tipo', 'gare', 'attivazioni', 'punti_base'])];
    aggregateUmas(sessions).forEach((a) => {
      const { owned, acts, types, pts } = umaSkills(a);
      Object.keys(owned).map(Number).sort((x, y) => x - y).forEach((sid) => {
        lines.push(csvLine([a.name, a.tcid, sid, skills.name(sid) || '', owned[sid], skills.kind(sid, types[sid]),
          a.n, get(acts, sid), get(pts, sid)]));
      });
    });
    return lines.join('\n') + '\n';
  }

  const api = {
    DIST_NAMES, STYLE_NAMES, MOOD_NAMES, WEATHER_NAMES, GROUND_NAMES, APT, STAT_KEYS, CATEGORY_LABELS,
    CATEGORY_ORDER, LEGEND, SkillDB, parseScenario, loadSession, slimFile, isTeamTrialsFile, analyze,
    umaRacesCSV, skillsCSV, rushedChance, skillChance, fi, ff, pct,
  };
  root.UmaEngine = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
