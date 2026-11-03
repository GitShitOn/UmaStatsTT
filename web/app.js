/* UmaStatsTT - web app interface. The analysis lives in engine.js; this file loads files and draws the page. */
(function () {
  'use strict';

  const E = window.UmaEngine;
  const { fi, ff, pct, ordinal, plural } = E;
  const STORE_KEY = 'umastats.files.v1';
  const SRC_KEYS = [
    ['place', 'Finishing position', 'src-place'],
    ['skill', 'Skills', 'src-skill'],
    ['pos', 'Start and leading own strategy', 'src-pos'],
    ['other', 'Margin, upset, time', 'src-other'],
  ];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const skills = new E.SkillDB(window.UMA_SKILLS || {});
  const state = { files: [], sessions: [], analysis: null, source: 'none', demoLabel: '', errors: [], messages: [], busy: false };

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------ local storage
  // IndexedDB holds the files (dozens of sessions are well over localStorage's ~5 MB);
  // localStorage is only read to pick up files saved by older versions of the page.

  const DB_NAME = 'umastats';
  const DB_STORE = 'files';

  function idbOpen() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB not available')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbRun(mode, fn) {
    const db = await idbOpen();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, mode);
        const req = fn(tx.objectStore(DB_STORE));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  async function saveFiles() {
    if (state.source !== 'user' && state.source !== 'saved') return true;
    try {
      await idbRun('readwrite', (st) => st.put(state.files, STORE_KEY));
      try { localStorage.removeItem(STORE_KEY); } catch (e) { /* storage not available */ }
      return true;
    } catch (e) {
      return false;
    }
  }
  async function loadSaved() {
    try {
      const v = await idbRun('readonly', (st) => st.get(STORE_KEY));
      if (Array.isArray(v) && v.length) return v;
    } catch (e) { /* fall back to localStorage */ }
    try {
      const s = localStorage.getItem(STORE_KEY);
      const v = s ? JSON.parse(s) : null;
      return Array.isArray(v) ? v : null;
    } catch (e) {
      return null;
    }
  }
  async function clearSaved() {
    try { await idbRun('readwrite', (st) => st.delete(STORE_KEY)); } catch (e) { /* storage not available */ }
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* storage not available */ }
  }

  // ------------------------------------------------------------ loading

  async function readFiles(list) {
    const incoming = [];
    state.errors = [];
    state.messages = [];
    for (const f of list) {
      let data;
      try {
        data = JSON.parse(await f.text());
      } catch (e) {
        state.errors.push(`${f.name}: not a valid JSON file.`);
        continue;
      }
      const tt = E.isTeamTrialsFile(data) ? data : (data && E.isTeamTrialsFile(data.data) ? data.data : null);
      if (tt) {
        incoming.push({ name: f.name, data: E.slimFile(tt) });
      } else {
        const n = skills.merge(data);
        if (n) state.messages.push(`${f.name}: loaded ${fi(n)} skill names.`);
        else state.errors.push(`${f.name}: contains no Team Trials results.`);
      }
    }
    if (incoming.length) {
      if (state.source === 'demo' || state.source === 'none') state.files = [];
      const byName = new Map(state.files.map((x) => [x.name, x]));
      incoming.forEach((x) => byName.set(x.name, x));
      state.files = [...byName.values()];
      state.source = 'user';
    }
    await rebuild();
    if (incoming.length && !(await saveFiles())) {
      state.messages.push('The files could not be remembered on this device (storage full or blocked). You will need to load them again next time.');
      renderStatus();
    }
  }

  async function rebuild() {
    state.busy = true;
    renderStatus();
    const sessions = [];
    for (const f of state.files) {
      try {
        sessions.push(await E.loadSession(f.data, f.name));
      } catch (e) {
        state.errors.push(`${f.name}: ${e.message}`);
      }
    }
    state.sessions = sessions;
    state.analysis = sessions.length ? E.analyze(sessions, skills) : null;
    state.busy = false;
    render();
  }

  function clearAll() {
    state.files = [];
    state.sessions = [];
    state.analysis = null;
    state.source = 'none';
    state.errors = [];
    state.messages = [];
    clearSaved();
    render();
    window.scrollTo(0, 0);
  }

  function showDemo() {
    if (!window.UMA_DEMO || !window.UMA_DEMO.files) return;
    state.files = window.UMA_DEMO.files;
    state.source = 'demo';
    state.demoLabel = window.UMA_DEMO.label || 'sample data';
    state.errors = [];
    state.messages = [];
    rebuild();
  }

  // ------------------------------------------------------------ drawing helpers

  function niceScale(maxV, ticks = 4) {
    if (!(maxV > 0)) return { max: 1, step: 1 };
    const raw = maxV / ticks;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    return { max: Math.ceil(maxV / step) * step, step };
  }
  function compact(v) {
    if (v >= 1e6) return `${ff(v / 1e6, v % 1e6 ? 1 : 0)}M`;
    if (v >= 1e3) return `${fi(v / 1e3)}k`;
    return fi(v);
  }
  function shortLabel(label) {
    const m = /^\d{4}-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(label);
    return m ? `${MONTHS[Number(m[1]) - 1] || m[1]} ${Number(m[2])}, ${m[3]}:${m[4]}` : label;
  }
  const tipAttr = (v, l, x) => `data-tip-v="${esc(v)}" data-tip-l="${esc(l || '')}" data-tip-x="${esc(x || '')}"`;
  const distChip = (dt, name) => `<span class="chip d${esc(dt)}"><i aria-hidden="true"></i>${esc(name)}</span>`;
  const posBadge = (p) => {
    const cls = p === 1 ? 'p1' : p <= 3 ? 'p2' : p <= 5 ? 'p4' : 'p6';
    return `<span class="pos ${cls}" title="${ordinal(p)}">${p}</span>`;
  };
  // the last `max` finishes; older ones are summarized as "+N" (the full list stays in the aria-label)
  const posRow = (arr, max = 12) => {
    const shown = arr.length > max ? arr.slice(-max) : arr;
    const more = arr.length - shown.length;
    return `<span class="posrow" aria-label="Finishes: ${arr.join(', ')}">${more ? `<span class="pos-more" title="${more} earlier races">+${more}</span>` : ''}${shown.map(posBadge).join('')}</span>`;
  };
  const flagRate = (k, n, warnAt, badAt) => {
    if (!k) return `${k}/${n}`;
    const r = k / n;
    const cls = r >= badAt ? 'bad' : r >= warnAt ? '' : null;
    return cls === null ? `${k}/${n}` : `<span class="flag ${cls}">${k}/${n}</span>`;
  };
  const umaTag = (u) => (!u.current ? ' <span class="tag ex">former</span>' : u.slot === 1 ? ' <span class="tag">1st</span>' : '');
  const tile = (label, value, sub) => `<div class="tile"><span class="tile-label">${esc(label)}</span><span class="tile-value">${esc(value)}</span>${sub ? `<span class="tile-sub">${esc(sub)}</span>` : ''}</div>`;
  const sectionHead = (id, eyebrow, title, intro) => `<div class="section-head"><p class="eyebrow">${esc(eyebrow)}</p><h2 id="h-${id}">${esc(title)}</h2>${intro ? `<p>${intro}</p>` : ''}</div>`;
  const noteFlags = (notes) => (notes.length ? `<span class="noteline">${notes.map((x) => `<span class="flag ${x.s === 'bad' ? 'bad' : x.s === 'good' ? 'good' : ''}">${esc(x.t)}</span>`).join('')}</span>` : '');

  function actionList(items, max) {
    return `<ol class="actions">${items.map((r) => `<li class="action">
      <div class="action-gain"><strong>~${fi(r.gain)}</strong><div class="meter" aria-hidden="true"><i style="width:${Math.max(2, (r.gain / max) * 100).toFixed(1)}%"></i></div><span>final points per session</span></div>
      <p class="action-text">${esc(r.text)}</p></li>`).join('')}</ol>`;
  }
  function noteList(items) {
    return `<ul class="actions">${items.map((n) => `<li class="action note-item"><span class="flag-icon" aria-hidden="true">!</span><p class="action-text">${esc(n.text)}</p></li>`).join('')}</ul>`;
  }

  // ------------------------------------------------------------ sections

  function reliabilityPanel(A) {
    const R = A.reliability;
    const label = { reliable: 'Reliable', preliminary: 'Preliminary', 'very limited': 'Very limited' }[R.level];
    const cls = R.level === 'reliable' ? 'good' : R.level === 'preliminary' ? '' : 'bad';
    let detail;
    if (R.level === 'reliable') {
      detail = `Every uma on the team has at least ${R.minRaces} races; ${R.reliableRaces} are enough for reliable results.`;
    } else {
      const counts = [...new Set(R.few.map((f) => f.n))].sort((x, y) => x - y);
      const shortTxt = R.few.length === R.nCurrent
        ? `Every uma on the team has ${counts.length === 1 ? counts[0] : `${counts[0]}–${counts[counts.length - 1]}`} ${plural(counts[counts.length - 1], 'race', 'races')} so far.`
        : `Still short: ${R.few.slice(0, 6).map((f) => `${f.name} (${f.n})`).join(', ')}${R.few.length > 6 ? ', …' : ''}.`;
      const need = R.reliableRaces - R.minRaces;
      detail = `For reliable results load at least ${R.reliableRaces} sessions with the same team (${R.reliableRaces} races per uma); below ${R.minRacesNeeded} the per-uma numbers are only a first idea. ${shortTxt} About ${need} more ${plural(need, 'session', 'sessions')} needed.`;
    }
    const done = Math.min(1, R.minRaces / R.reliableRaces);
    const meterLabel = R.minRaces >= R.reliableRaces ? `${R.minRaces} races per uma (${R.reliableRaces} needed)` : `${R.minRaces} of ${R.reliableRaces} races per uma`;
    return `<div class="panel reliability">
      <div class="rel-head"><h3>Data reliability</h3><span class="flag ${cls}">${label}</span><span class="small muted">${R.sessions} ${plural(R.sessions, 'session', 'sessions')} · ${R.races} races</span></div>
      <div class="rel-meter"><div class="meter" role="img" aria-label="${esc(meterLabel)}"><i style="width:${(done * 100).toFixed(0)}%"></i></div><span class="small">${esc(meterLabel)}</span></div>
      <p class="note">${esc(detail)} With ${R.reliableRaces} races an uma’s average points land within ±1,500 of its long-run value 9 times out of 10; with 5 races, 2 times out of 3.</p>
    </div>`;
  }

  function retrainPanel(A) {
    const rows = A.retrain;
    if (!rows || !rows.length) return '';
    const t = rows[0];
    const next = rows.slice(1, 3).map((r) => `<li><a href="#uma-${esc(r.key)}">${esc(r.name)}</a> <span class="muted">${esc(r.dist)} · ~${fi(r.loss)}</span></li>`).join('');
    return `<div class="panel retrain">
      <p class="eyebrow">Retrain first</p>
      <div class="retrain-head">
        <h3><a href="#uma-${esc(t.key)}">${esc(t.name)}</a></h3>
        ${distChip(t.mainDist, t.dist)}
        <span class="small muted">${t.n} races${t.preliminary ? ' · preliminary' : ''}</span>
      </div>
      <p class="retrain-loss"><strong>~${fi(t.loss)}</strong> final points per session behind your 3 best builds <span class="muted">(${fi(t.own)} from its own placings and skills, ${fi(t.team)} from team bonuses it cost)</span></p>
      <div class="grid-2">
        <div><h4>Why</h4><ul class="plain">${t.why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>
        ${t.needs.length ? `<div><h4>The new one needs</h4><ul class="plain">${t.needs.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
      </div>
      ${next ? `<div class="retrain-next"><span class="small muted">Next in line</span><ul class="plain inline">${next}</ul></div>` : ''}
      <p class="note">A trained uma’s stats cannot change: the fix is a new training. Ranking by final points lost per session against the average of your 3 best umas, plus the team bonuses lost when it was the only one outside the top 5.</p>
    </div>`;
  }

  function secSummary(A) {
    const top = A.recs.est.slice(0, 5);
    const max = Math.max(1, ...A.recs.est.map((r) => r.gain));
    const apt = A.recs.notes.filter((n) => n.prio === 1);
    return `<section class="section" id="summary" aria-labelledby="h-summary">
      ${sectionHead('summary', 'Summary', 'The big picture')}
      ${retrainPanel(A)}
      ${reliabilityPanel(A)}
      <div class="tiles">
        ${tile('Average points per session', fi(A.totalAvg), `${A.nSessions} ${plural(A.nSessions, 'session', 'sessions')}`)}
        ${tile('Average points per race', fi(A.raceAvg), `${A.nRaces} races`)}
        ${tile('Races won', `${A.wins} of ${A.nRaces}`, `${pct(A.wins / A.nRaces)} · ${A.victories} of ${A.nSessions} matches won`)}
        ${tile('1 base point is worth', `${ff(A.mult, 2)} final`, `${ff(A.mult + 0.1, 2)} for the first uma of the distance`)}
      </div>
      <div class="panel"><h3>Score by session</h3>${sessionChart(A)}</div>
      <div class="section-head"><h3>The 5 things worth the most</h3><p class="note">Estimated extra final points per session. The full list is under “What to improve”.</p></div>
      ${actionList(top, max)}
      ${apt.length ? `<div class="section-head"><h3>Aptitudes below A</h3></div>${noteList(apt)}` : ''}
      ${A.changes.length ? `<p class="note">The team changed in ${A.changes.length} ${plural(A.changes.length, 'session', 'sessions')}: the advice covers the current team, the one in the latest session (${esc(A.latest)}). Umas that left stay in the statistics marked “former”. <a href="#changes">See the changes</a>.</p>` : ''}
    </section>`;
  }

  function sessionChart(A) {
    const ss = A.sessions;
    const { max, step } = niceScale(Math.max(...ss.map((s) => s.total)));
    const grid = [];
    for (let v = 0; v <= max + 1e-6; v += step) {
      grid.push(`<div class="gridline${v === 0 ? ' base' : ''}" style="bottom:${((v / max) * 100).toFixed(2)}%"><span>${compact(v)}</span></div>`);
    }
    const best = ss.reduce((a, b) => (b.total > a.total ? b : a));
    // with many sessions: date only, and at most 5 labels so they never overlap on a phone
    const many = ss.length > 8;
    const every = many ? Math.ceil(ss.length / 5) : 1;
    const dateOnly = (l) => shortLabel(l).replace(/, \d{2}:\d{2}$/, '');
    const cols = ss.map((s) => `<div class="col" tabindex="0" style="--h:${((s.total / max) * 100).toFixed(2)}%" ${tipAttr(fi(s.total), `${s.label} · ${s.wins} won of ${s.n}`, `${s.victoryBonus ? `includes match victory ${fi(s.victoryBonus)} · ` : ''}opponent bonus ${pct(s.oppRate, 1)}`)}>
        ${ss.length <= 8 || s === best ? `<span class="cap${s === best ? ' keep' : ''}">${fi(s.total)}</span>` : ''}<i class="bar"></i></div>`).join('');
    const labels = ss.map((s, i) => `<div>${i % every === 0 ? `<span>${esc(many ? dateOnly(s.label) : shortLabel(s.label))}</span>` : '<span>&nbsp;</span>'}
        ${ss.length <= 12 ? `<span class="wl" aria-label="${s.wins} won, ${s.n - s.wins} lost">${s.results.map((w) => `<b class="${w ? 'w' : ''}"></b>`).join('')}</span>` : ''}</div>`).join('');
    return `<div class="colchart" role="img" aria-label="Total score by session">
      <div class="colchart-plot">${grid.join('')}<div class="cols">${cols}</div></div>
      <div class="col-labels">${labels}</div></div>
      ${ss.length <= 12 ? '<p class="note">Under each column, the session’s races in order: filled dot = won, empty dot = lost.</p>' : ''}`;
  }

  function secScoring(A) {
    const maxPR = Math.max(1, ...A.categories.map((c) => c.perRace));
    const unit = (c) => (c.unitMin == null ? '–' : c.unitMin === c.unitMax ? fi(c.unitMin) : `${fi(c.unitMin)} … ${fi(c.unitMax)}`);
    const rows = A.categories.map((c) => `<tr>
        <td class="first">${esc(c.label)}</td>
        <td class="n">${unit(c)}</td>
        <td class="n">${c.hits}/${c.denom}</td>
        <td><div class="barcell"><div class="track">${c.perRace > 0 ? `<i style="width:${((c.perRace / maxPR) * 100).toFixed(2)}%" ${tipAttr(fi(c.perRace), c.label, `${pct(c.share, 1)} of the total`)}></i>` : ''}</div><span class="v">${fi(c.perRace)}</span></div></td>
        <td class="n">${pct(c.share, 1)}</td></tr>`).join('');
    const bonus = A.bonuses.map((b) => {
      const v = b.cfg ? b.cfg.map((x) => `+${pct(x, 2)}`).join(', ') : (b.max - b.min > 0.002 ? `+${pct(b.min, 1)} … +${pct(b.max, 1)}` : `+${pct(b.mean, 1)}`);
      return `<span><b>${esc(b.label)}</b> ${esc(v)}</span>`;
    }).join('');
    const moods = A.moods.map((m) => `<tr><td>${esc(m.label)}</td><td class="n">${m.n}</td><td class="n">${ff(m.avgFinish, 1)}</td><td class="n">${fi(m.avgRaw)}</td></tr>`).join('');
    const st = A.starts;
    return `<section class="section" id="scoring" aria-labelledby="h-scoring">
      ${sectionHead('scoring', 'Scoring', 'Where the points come from', 'Every race event is worth <strong>base points</strong>; then every percentage bonus multiplies them. To go up, raise your base points.')}
      <div class="panel"><h3>Percentage bonuses seen</h3><div class="kv">${bonus}</div>
        <p class="note" style="margin-top:8px">Race score = base points × (1 + bonuses) for every event, plus the team bonus. On average 1 base point is worth ${ff(A.mult, 2)} final points.</p>
        <p class="note" style="margin-top:8px">Opponent bonus = ${pct(A.oppFormula.a, 2)} + ${pct(A.oppFormula.perK, 2)} per 1,000 opponent rating − ${pct(-A.oppFormula.selfPerK, 2)} per 1,000 of your own rating${A.oppFormula.maxErr != null ? `; on your sessions it is off by at most ${pct(A.oppFormula.maxErr, 2)}` : ''}. A stronger opponent raises the multiplier.</p></div>
      <div class="table-wrap"><table>
        <thead><tr><th class="first">Item</th><th class="n">Base points per event</th><th class="n">Present</th><th>Final points per race</th><th class="n">Share</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><th class="first">Total</th><th></th><th></th><th><div class="barcell"><span class="track"></span><span class="v">${fi(A.raceAvg)}</span></div></th><th class="n">100%</th></tr></tfoot>
      </table></div>
      <p class="note">“Present” = in how many runs (one uma in one race) the item shows up; for the team bonus, in how many races; for the match victory, in how many sessions. The match victory (3+ race wins) is not in the files: it is computed from the rule.</p>
      <div class="grid-2">
        <div class="panel"><h3>Mood</h3><div class="table-wrap"><table>
          <thead><tr><th>Mood</th><th class="n">Runs</th><th class="n">Avg place</th><th class="n">Avg base</th></tr></thead><tbody>${moods}</tbody></table></div></div>
        <div class="panel"><h3>Starts</h3>${st.total ? `<p class="tile-value">${st.perfect}/${st.total}</p><p class="note">Perfect starts (delay under 0.02 s): ${pct(st.perfect / st.total)}. Average delay ${ff(st.mean, 3)} s. Without start skills you can expect about 20%.</p>` : '<p class="note">The replay cannot be read in this browser.</p>'}</div>
      </div>
    </section>`;
  }

  function secDistances(A) {
    const maxT = Math.max(1, ...A.distances.map((d) => d.avgTotal || 0));
    const rows = A.distances.map((d) => `<tr>
      <td class="first">${distChip(d.dt, d.name)}</td>
      <td>${d.courses.map((c) => `${fi(c)} m`).join(', ') || '–'}</td>
      <td class="n">${d.races}</td>
      <td class="n">${d.wins}-${d.races - d.wins}</td>
      <td><div class="barcell"><div class="track"><i class="d${d.dt}" style="width:${((d.avgTotal / maxT) * 100).toFixed(2)}%;background:var(--c)" ${tipAttr(fi(d.avgTotal), `${d.name} · average points per race`, `${d.wins} won of ${d.races}`)}></i></div><span class="v">${fi(d.avgTotal)}</span></div></td>
      <td class="n">${ff(d.avgFinish, 1)}</td>
      <td class="n">${d.teamBonus}/${d.races}</td>
      <td class="n">${d.ourFirst}/${d.races}</td></tr>`).join('');
    const cons = A.consistent === A.nRaces
      ? `In all ${A.nRaces} races, the team with the 1st-place uma won the race.`
      : `The race went to the team with the 1st-place uma in ${A.consistent} of ${A.nRaces} races.`;
    return `<section class="section" id="distances" aria-labelledby="h-distances">
      ${sectionHead('distances', 'Distances', 'How you do in each category')}
      <div class="table-wrap"><table>
        <thead><tr><th class="first">Distance</th><th>Courses</th><th class="n">Races</th><th class="n">W-L</th><th>Average points per race</th><th class="n">Avg place</th><th class="n">Team bonus</th><th class="n">Our 1st place</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p class="note">${esc(cons)}</p>
    </section>`;
  }

  function umaStack(A) {
    const totals = A.umas.map((u) => SRC_KEYS.reduce((t, [k]) => t + Math.max(0, u.src[k] || 0), 0));
    const { max, step } = niceScale(Math.max(...totals));
    let html = `<div class="legend">${SRC_KEYS.map(([, l, c]) => `<span class="${c}"><i aria-hidden="true"></i>${esc(l)}</span>`).join('')}</div><div class="stack-chart">`;
    let lastDist = null;
    A.umas.forEach((u, i) => {
      if (u.mainDist !== lastDist) {
        html += `<div class="stack-group">${esc(E.DIST_NAMES[u.mainDist] || u.distLabel)}</div>`;
        lastDist = u.mainDist;
      }
      const segs = SRC_KEYS.filter(([k]) => u.src[k] > 0).map(([k, l, c]) => `<i class="${c}" tabindex="0" style="flex:${u.src[k].toFixed(1)} 1 0" ${tipAttr(fi(u.src[k]), `${l} · ${u.label}`, 'average base points per race')}></i>`).join('');
      const rushed = u.src.rushed ? ` · rushed ${fi(u.src.rushed)}` : '';
      html += `<div class="stack-row${u.current ? '' : ' ex'}"><div class="stack-name" title="${esc(u.label)}">${esc(u.name)}${umaTag(u)}</div>
        <div class="stack-area"><div class="stack-track" style="width:${((totals[i] / max) * 100).toFixed(2)}%" role="img" aria-label="${esc(`${u.label}: ${fi(totals[i])} average base points per race${rushed}`)}">${segs}</div></div>
        <span class="stack-total" ${tipAttr(fi(u.avgRaw), `${u.label} · average base points per race`, u.src.rushed ? `including rushed ${fi(u.src.rushed)}` : '')}>${fi(u.avgRaw)}</span></div>`;
    });
    const ticks = [];
    for (let v = 0; v <= max + 1e-6; v += step) ticks.push(`<span style="left:${((v / max) * 100).toFixed(2)}%">${compact(v)}</span>`);
    html += `<div class="axis-row"><div class="axis-spacer"></div><div class="axis">${ticks.join('')}</div><div></div></div></div>
      <p class="note">The number on the right is the net total per race, rushed penalties included.</p>`;
    return html;
  }

  function diagTable(A) {
    const rows = A.umas.map((u) => {
      const d = u.diag; const n = u.n;
      const uniRate = d.uniqueK / n < 0.6 ? `<span class="flag${d.uniqueK === 0 ? ' bad' : ''}">${d.uniqueK}/${n}</span>` : `${d.uniqueK}/${n}`;
      const uni = d.hasUnique ? `${uniRate}${d.uniqueLevel ? ` <span class="muted">L${d.uniqueLevel}</span>` : ''}` : '–';
      return `<tr${u.current ? '' : ' class="ex"'}>
        <td class="first">${esc(u.name)}${umaTag(u)}${u.n < E.RELIABLE_RACES ? '<sup class="muted" title="fewer races than needed for reliable numbers">*</sup>' : ''}</td>
        <td>${posRow(u.finishes)}</td>
        <td class="n">${fi(u.avgRaw)}</td>
        <td class="n">${ff(d.white, 1)}</td>
        <td class="n">${ff(d.gold, 1)}</td>
        <td class="n">${uni}</td>
        <td class="n">${d.start}/${n}</td>
        <td class="n">${d.lead16}/${n}</td>
        <td class="n">${d.lead23}/${n}</td>
        <td class="n">${flagRate(d.rushed, n, 0.01, 0.4)}</td>
        <td class="n">${flagRate(d.hpOut, n, 0.01, 0.4)}</td>
        <td class="n">${flagRate(d.spurtLate, n, 0.01, 0.4)}</td>
        <td class="n">${pct(d.hpEnd)}</td>
        <td class="n">${pct(d.blocked)}</td></tr>`;
    }).join('');
    return `<div class="table-wrap"><table>
      <thead><tr><th class="first">Uma</th><th>Finishes</th><th class="n">Base/race</th><th class="n">White/race</th><th class="n">Gold/race</th><th class="n">Unique</th><th class="n">Perfect start</th><th class="n">Lead 1/6</th><th class="n">Lead 2/3</th><th class="n">Rushed</th><th class="n">Out of HP</th><th class="n">Late spurt</th><th class="n">HP left</th><th class="n">Blocked</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <p class="note">${A.umas.some((u) => u.n < E.RELIABLE_RACES) ? `* fewer than ${E.RELIABLE_RACES} races: preliminary numbers. ` : ''}Unique = races in which the unique skill fired (L = level). Out of HP = HP hit zero more than 10 m before the finish. Late spurt = final spurt started more than 10 m after the 2/3 mark, a sign of too little stamina. Lead = ahead of every uma with the same strategy. Blocked = share of time with an uma ahead closing the way in the last third.</p>`;
  }

  function umaCard(u) {
    const style = E.STYLE_NAMES[u.style] || '?';
    const statCells = E.STAT_KEYS.map(([k, l]) => `<div class="stat"><span>${l}</span><b>${fi(u.stats[k])}</b></div>`).join('');
    const apt = (v) => esc(E.APT[v] || '?');
    const races = u.races.map((r) => `<tr><td>${esc(shortLabel(r.session))} · R${r.rnd}</td><td>${r.distance ? `${fi(r.distance)} m` : '–'}</td><td>${posBadge(r.finish)}</td><td class="n">${r.popularity}</td><td>${esc(r.mood)}</td><td class="n">${fi(r.raw)}</td><td class="n">${fi(r.final)}</td><td class="n">${r.white}/${r.gold}/${r.unique}</td><td class="wrap">${noteFlags(r.notes)}</td></tr>`).join('');
    const sk = u.skills.map((s) => `<tr><td class="wrap">${esc(s.name || '?')}${s.acts ? '' : ' <span class="flag">never</span>'}</td><td class="n muted">${s.id}</td><td>${esc(s.kind)}</td><td class="n">L${s.level}</td><td class="n">${s.acts}/${u.n}</td><td class="n">${fi(s.points)}</td></tr>`).join('');
    const tag = (!u.current ? ' <span class="tag ex">no longer on the team</span>' : u.slot === 1 ? ' <span class="tag">first uma</span>' : '')
      + (u.current && u.n < E.RELIABLE_RACES ? ` <span class="tag ex">${u.n} ${plural(u.n, 'race', 'races')} · preliminary</span>` : '');
    return `<details class="card${u.current ? '' : ' ex'}" id="uma-${esc(u.key)}">
      <summary>
        <span class="card-title"><strong>${esc(u.name)}</strong><span>${distChip(u.mainDist, u.distLabel)} ${esc(style)}${tag}</span></span>
        ${posRow(u.finishes)}
        <span class="card-score"><b>${fi(u.avgRaw)} base</b>${fi(u.avgFinal)} final per race</span>
      </summary>
      <div class="card-body">
        <div class="stats">${statCells}</div>
        <div class="kv">
          <span>Aptitudes: distance <b>${apt(u.apt.dist)}</b> · track <b>${apt(u.apt.ground)}</b> · strategy <b>${apt(u.apt.style)}</b></span>
          <span>Theoretical skill activation <b>${pct(u.skillChance)}</b></span>
          <span>Theoretical rushed risk <b>${pct(u.rushedChance)}</b></span>
          ${u.diag.uniqueName ? `<span>Unique: <b>${esc(u.diag.uniqueName)}</b> ${u.diag.uniqueK}/${u.n}</span>` : ''}
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Race</th><th>Course</th><th>Finish</th><th class="n">Pop.</th><th>Mood</th><th class="n">Base</th><th class="n">Final</th><th class="n">Skills w/g/u</th><th>Notes</th></tr></thead>
          <tbody>${races}</tbody></table></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Skill</th><th class="n">ID</th><th>Kind</th><th class="n">Lvl</th><th class="n">Activations</th><th class="n">Base points</th></tr></thead>
          <tbody>${sk}</tbody></table></div>
      </div></details>`;
  }

  function teamChangesPanel(A) {
    if (!A.changes.length) return '';
    const items = A.changes.map((c) => {
      const parts = [];
      if (c.entered.length) parts.push(`<b>in</b> ${esc(c.entered.join(', '))}`);
      if (c.left.length) parts.push(`<b>out</b> ${esc(c.left.join(', '))}`);
      if (c.moved.length) parts.push(`<b>moved</b> ${esc(c.moved.join(', '))}`);
      return `<li><span class="muted">${esc(shortLabel(c.session))}</span> ${parts.join('; ')}</li>`;
    }).join('');
    return `<div class="panel" id="changes"><h3>Team changes</h3><ul class="changes">${items}</ul>
      <p class="note">Umas that left stay in the statistics, marked “former” and faded; the advice only looks at the current team.</p></div>`;
  }

  function secUmas(A) {
    return `<section class="section" id="umas" aria-labelledby="h-umas">
      ${sectionHead('umas', 'Umas', 'How each uma performs', 'Average base points per race, split by source. Tap a bar for details, open a card for races and skills.')}
      ${teamChangesPanel(A)}
      <div class="panel">${umaStack(A)}</div>
      <div class="section-head"><h3>Diagnostics</h3></div>
      ${diagTable(A)}
      <div class="section-head"><h3>Cards</h3></div>
      <div class="uma-list">${A.umas.map(umaCard).join('')}</div>
    </section>`;
  }

  function secOpponents(A) {
    const maxAbs = {};
    E.STAT_KEYS.forEach(([k]) => { maxAbs[k] = Math.max(1, ...A.distances.flatMap((d) => d.statDiff.filter((s) => s.key === k && s.diff != null).map((s) => Math.abs(s.diff)))); });
    const rows = A.distances.filter((d) => d.statDiff.some((s) => s.opp != null)).map((d) => `<tr>
        <td class="first">${distChip(d.dt, d.name)}</td>
        ${d.statDiff.map((s) => {
          if (s.diff == null) return '<td class="h">–</td>';
          const w = Math.min(1, Math.abs(s.diff) / maxAbs[s.key]) * 62;
          const bg = `color-mix(in oklab, var(${s.diff >= 0 ? '--div-pos' : '--div-neg'}) ${w.toFixed(0)}%, var(--div-mid))`;
          return `<td class="h" style="background:${bg}" ${tipAttr(`${s.diff >= 0 ? '+' : '−'}${fi(Math.abs(s.diff))}`, `${s.label} · ${d.name}`, `you ${fi(s.ours)}, opponents ${fi(s.opp)}`)}><b>${s.diff >= 0 ? '+' : '−'}${fi(Math.abs(s.diff))}</b><small>${fi(s.ours)} / ${fi(s.opp)}</small></td>`;
        }).join('')}
        <td class="n">${ff(d.avgFinish, 1)} / ${ff(d.oppFinish, 1)}</td></tr>`).join('');
    const lost = A.lost.map((l) => `<tr><td>${esc(shortLabel(l.session))} · R${l.rnd}</td><td>${esc(l.dist)}${l.distance ? ` ${fi(l.distance)} m` : ''}</td>
        <td>${l.winner ? `${esc(l.winner.name)} <span class="muted">${esc(l.winner.style)}</span>` : 'uma outside both teams'}</td>
        ${E.STAT_KEYS.map(([k]) => `<td class="n">${l.winner ? fi(l.winner.stats[k]) : '–'}</td>`).join('')}
        <td>${l.best ? `${esc(l.best.name)} ${posBadge(l.best.finish)}` : '–'}</td></tr>`).join('');
    return `<section class="section" id="opponents" aria-labelledby="h-opponents">
      ${sectionHead('opponents', 'Opponents', 'Your stats against your opponents’', 'Average stats of your 3 umas against the 3 opposing umas, by distance. Blue: you are higher. Red: the opponents are higher.')}
      <div class="div-legend"><span>opponents higher</span><span class="ramp" aria-hidden="true"></span><span>you higher</span></div>
      <div class="table-wrap"><table class="heat">
        <thead><tr><th class="first">Distance</th>${E.STAT_KEYS.map(([, l]) => `<th style="text-align:center">${l}<br><span class="muted small">diff · you / opp.</span></th>`).join('')}<th class="n">Avg place<br><span class="muted small">you / opp.</span></th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      ${A.lost.length ? `<div class="section-head"><h3>Who won the races you lost</h3></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Race</th><th>Distance</th><th>Winner</th>${E.STAT_KEYS.map(([, l]) => `<th class="n">${l}</th>`).join('')}<th>Your best</th></tr></thead>
        <tbody>${lost}</tbody></table></div>` : ''}
    </section>`;
  }

  function secSkills(A) {
    const items = A.umas.filter((u) => u.current && u.never.length).map((u) => `<div class="never-item"><strong>${esc(u.name)}</strong>
      <ul>${u.never.map((s) => `<li>${esc(s.name || String(s.id))} <small>${esc(s.kind)}</small></li>`).join('')}</ul></div>`).join('');
    return `<section class="section" id="skills" aria-labelledby="h-skills">
      ${sectionHead('skills', 'Skills', 'Skills that never fired', 'Every activation is worth base points: white or inherited unique 500, gold 1,200, unique 2,300-2,500. Passive skills count too. Below are the current team’s skills that never fired in any race; the full table is in each uma’s card.')}
      ${items ? `<div class="panel never-list">${items}</div>` : '<p class="note">Every skill fired at least once.</p>'}
      ${A.unnamed.length ? `<p class="note">${A.unnamed.length} skills have no name in the database: load a JSON file of names (id → name) to fill them in.</p>` : ''}
    </section>`;
  }

  function secRaces(A) {
    const blocks = A.races.map((s) => {
      const wins = s.races.filter((r) => r.win).length;
      const total = s.races.reduce((t, r) => t + r.total, 0);
      const races = s.races.map((r) => {
        const rows = r.ours.map((u) => `<tr><td class="first">${esc(u.name)}</td><td class="n">${u.slot === 1 ? '<span class="tag">1st</span>' : u.slot}</td><td>${posBadge(u.finish)}</td><td class="n">${u.popularity}</td><td>${esc(u.mood)}</td><td class="n">${fi(u.raw)}</td><td class="n">${fi(u.final)}</td><td class="n">${u.white}/${u.gold}/${u.unique}</td><td class="wrap">${noteFlags(u.notes)}</td></tr>`).join('')
          + r.opponents.map((o) => `<tr class="sub"><td class="first">opp. ${esc(o.name)}</td><td class="n">${o.slot}</td><td>${posBadge(o.finish)}</td><td></td><td></td><td></td><td></td><td></td><td>${esc(o.style)}</td></tr>`).join('');
        return `<details class="card race"><summary>
            <span class="result${r.win ? ' win' : ''}">${r.win ? 'Won' : 'Lost'}</span>
            <span class="card-title"><strong>R${r.rnd} · ${esc(r.dist)} ${r.distance ? `${fi(r.distance)} m` : ''}</strong><span>${esc(r.weather)}, ${esc(r.ground)}${r.teamFinal ? ` · team bonus ${fi(r.teamFinal)}` : ''}</span></span>
            ${posRow(r.ours.map((u) => u.finish))}
            <span class="card-score"><b>${fi(r.total)}</b>points</span>
          </summary><div class="card-body"><div class="table-wrap"><table>
            <thead><tr><th class="first">Uma</th><th class="n">Slot</th><th>Finish</th><th class="n">Pop.</th><th>Mood</th><th class="n">Base</th><th class="n">Final</th><th class="n">Skills w/g/u</th><th>Notes</th></tr></thead>
            <tbody>${rows}</tbody></table></div></div></details>`;
      }).join('');
      return `<div class="session-block"><div class="session-head"><h3>${esc(s.label)}</h3><span class="muted">${fi(total)} points · ${wins} won of ${s.races.length}</span></div>${races}</div>`;
    }).join('');
    return `<section class="section" id="races" aria-labelledby="h-races">
      ${sectionHead('races', 'Races', 'Race by race')}
      ${blocks}
      <div class="panel"><h3>Export to a spreadsheet</h3>
        <p class="note">Copy the data as CSV and paste it into Excel, Numbers or Google Sheets.</p>
        <div class="export" style="margin-top:10px">
          <button class="btn" type="button" data-action="copy-uma">Copy umas per race</button>
          <button class="btn" type="button" data-action="copy-skill">Copy skills</button>
          <span class="small muted" id="copy-status" role="status"></span>
          <textarea id="copy-area" aria-label="CSV data to copy" readonly hidden></textarea>
        </div></div>
    </section>`;
  }

  function secPriorities(A) {
    const max = Math.max(1, ...A.recs.est.map((r) => r.gain));
    return `<section class="section" id="improve" aria-labelledby="h-improve">
      ${sectionHead('improve', 'What to improve', 'Priorities, by points', 'Estimates in final points per session. They are meant to rank priorities, not to predict exact results.')}
      ${actionList(A.recs.est, max)}
      <div class="section-head"><h3>Other notes</h3></div>
      ${noteList(A.recs.notes)}
    </section>`;
  }

  function secLegend() {
    return `<section class="section" id="legend" aria-labelledby="h-legend">
      ${sectionHead('legend', 'Legend', 'How points are calculated', 'Rules derived by matching every score event against the race replays, and checked on 385 races.')}
      <dl class="panel legend-list">${E.LEGEND.map(([t, d]) => `<div><dt>${esc(t)}</dt><dd>${esc(d)}</dd></div>`).join('')}</dl>
      <p class="note">Skill names: <a href="https://github.com/alpha123/uma-tools" target="_blank" rel="noopener">alpha123/uma-tools</a>, Global client text. The Wit-based chances use well-known community formulas and are indicative.</p>
    </section>`;
  }

  // ------------------------------------------------------------ rendering

  function renderStatus() {
    const el = $('#status');
    const A = state.analysis;
    if (state.busy && state.files.length) {
      el.hidden = false;
      el.classList.remove('demo');
      el.innerHTML = '<div class="status-text">Analyzing…</div>';
      return;
    }
    let text = '';
    let actions = '';
    if (A) {
      const what = `${A.nSessions} ${plural(A.nSessions, 'session', 'sessions')} · ${A.nRaces} races · ${A.nCurrent} umas on the team${A.nUmas > A.nCurrent ? ` (+${A.nUmas - A.nCurrent} former)` : ''}`;
      if (state.source === 'demo') text = `<strong>Example:</strong> ${esc(state.demoLabel)} (${what}). Load your own files to replace it.`;
      else if (state.source === 'saved') text = `${what}. Files remembered on this device.`;
      else text = `${what}.`;
      if (A.missingReplay) text += ' <span class="muted">Some races have an unreadable replay: HP, skill and start diagnostics are partial.</span>';
      if (A.badChecks) text += ` <span class="muted">In ${A.badChecks} races the points do not add up to the total.</span>`;
      actions = `<div class="status-actions"><label class="btn" for="file-input">Add files</label>${state.source === 'demo' ? '' : '<button class="btn btn-ghost" type="button" data-action="clear">Clear</button>'}</div>`;
    } else if (window.UMA_DEMO && window.UMA_DEMO.files) {
      text = 'Want to see how it works first?';
      actions = '<div class="status-actions"><button class="btn" type="button" data-action="demo">Show the example</button></div>';
    }
    const msgs = state.messages.map((m) => `<div class="small">${esc(m)}</div>`).join('');
    const errs = state.errors.length ? `<div class="errors">${state.errors.map(esc).join('<br>')}</div>` : '';
    if (!text && !msgs && !errs) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.classList.toggle('demo', state.source === 'demo' && !!A);
    el.innerHTML = `<div class="status-text">${text}${msgs}</div>${actions}${errs}`;
  }

  function render() {
    const A = state.analysis;
    $('#start').hidden = !!A;
    $('#nav').hidden = !A;
    $('#report').hidden = !A;
    renderStatus();
    $('#report').innerHTML = A
      ? [secSummary(A), secScoring(A), secDistances(A), secUmas(A), secOpponents(A), secSkills(A), secRaces(A), secPriorities(A), secLegend(A)].join('')
      : '';
  }

  // ------------------------------------------------------------ interactions

  const tip = $('#tooltip');
  function showTip(el, x, y) {
    tip.replaceChildren();
    const v = document.createElement('strong');
    v.textContent = el.dataset.tipV;
    tip.append(v);
    [el.dataset.tipL, el.dataset.tipX].filter(Boolean).forEach((t) => {
      const s = document.createElement('span');
      s.textContent = t;
      tip.append(s);
    });
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let left = x + 14;
    let top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, top)}px`;
  }
  const tipTarget = (e) => (e.target && e.target.closest ? e.target.closest('[data-tip-v]') : null);
  document.addEventListener('pointermove', (e) => {
    const el = tipTarget(e);
    if (el) showTip(el, e.clientX, e.clientY);
    else tip.hidden = true;
  });
  document.addEventListener('pointerdown', (e) => {
    const el = tipTarget(e);
    if (el && e.pointerType !== 'mouse') showTip(el, e.clientX, e.clientY);
  });
  document.addEventListener('focusin', (e) => {
    const el = tipTarget(e);
    if (el) {
      const r = el.getBoundingClientRect();
      showTip(el, r.left + r.width / 2, r.top);
    }
  });
  document.addEventListener('focusout', () => { tip.hidden = true; });
  window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });

  async function copyCSV(kind) {
    const text = kind === 'skill' ? E.skillsCSV(state.sessions, skills) : E.umaRacesCSV(state.sessions);
    const area = $('#copy-area');
    const status = $('#copy-status');
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = 'Copied to the clipboard.';
      area.hidden = true;
    } catch (e) {
      area.hidden = false;
      area.value = text;
      area.focus();
      area.select();
      status.textContent = 'Copying is not allowed here: the text is selected, copy it by hand.';
    }
  }

  document.addEventListener('click', (e) => {
    // links to an uma's card open it, since the cards start collapsed
    const link = e.target.closest ? e.target.closest('a[href^="#uma-"]') : null;
    if (link) {
      const card = document.getElementById(decodeURIComponent(link.getAttribute('href').slice(1)));
      if (card && card.tagName === 'DETAILS') card.open = true;
    }
    const btn = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!btn) return;
    const a = btn.dataset.action;
    if (a === 'clear') clearAll();
    else if (a === 'demo') showDemo();
    else if (a === 'copy-uma') copyCSV('uma');
    else if (a === 'copy-skill') copyCSV('skill');
  });

  const input = $('#file-input');
  input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    if (files.length) readFiles(files);
  });

  const overlay = $('#drop-overlay');
  let dragDepth = 0;
  const hasFiles = (e) => !!(e.dataTransfer && [...e.dataTransfer.types].includes('Files'));
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    overlay.hidden = false;
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) overlay.hidden = true;
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    overlay.hidden = true;
    readFiles([...e.dataTransfer.files]);
  });

  // ------------------------------------------------------------ start-up

  (async function start() {
    const saved = await loadSaved();
    if (saved && saved.length) {
      state.files = saved;
      state.source = 'saved';
    } else if (window.UMA_DEMO && window.UMA_DEMO.files) {
      state.files = window.UMA_DEMO.files;
      state.source = 'demo';
      state.demoLabel = window.UMA_DEMO.label || 'sample data';
    }
    if (state.files.length) await rebuild();
    else render();
  })();
})();
