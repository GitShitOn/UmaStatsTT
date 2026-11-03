/* UmaStatsTT - interfaccia della webapp. L'analisi e' in engine.js; qui solo caricamento file e disegno. */
(function () {
  'use strict';

  const E = window.UmaEngine;
  const { fi, ff, pct } = E;
  const STORE_KEY = 'umastats.files.v1';
  const SRC_KEYS = [
    ['place', 'Piazzamento', 'src-place'],
    ['skill', 'Skill', 'src-skill'],
    ['pos', 'Partenza e 1ª del suo stile', 'src-pos'],
    ['other', 'Margine, sorpresa, tempo', 'src-other'],
  ];

  const skills = new E.SkillDB(window.UMA_SKILLS || {});
  const state = { files: [], sessions: [], analysis: null, source: 'none', demoLabel: '', errors: [], messages: [], busy: false };

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------ archiviazione locale

  function saveFiles() {
    if (state.source !== 'user' && state.source !== 'saved') return true;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state.files));
      return true;
    } catch (e) {
      return false;
    }
  }
  function loadSaved() {
    try {
      const s = localStorage.getItem(STORE_KEY);
      const v = s ? JSON.parse(s) : null;
      return Array.isArray(v) ? v : null;
    } catch (e) {
      return null;
    }
  }
  function clearSaved() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* archiviazione non disponibile */ }
  }

  // ------------------------------------------------------------ caricamento

  async function readFiles(list) {
    const incoming = [];
    state.errors = [];
    state.messages = [];
    for (const f of list) {
      let data;
      try {
        data = JSON.parse(await f.text());
      } catch (e) {
        state.errors.push(`${f.name}: non è un file JSON valido.`);
        continue;
      }
      const tt = E.isTeamTrialsFile(data) ? data : (data && E.isTeamTrialsFile(data.data) ? data.data : null);
      if (tt) {
        incoming.push({ name: f.name, data: E.slimFile(tt) });
      } else {
        const n = skills.merge(data);
        if (n) state.messages.push(`${f.name}: caricati ${fi(n)} nomi di skill.`);
        else state.errors.push(`${f.name}: non contiene risultati di Team Trials.`);
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
    if (incoming.length && !saveFiles()) {
      state.messages.push('I file non sono stati ricordati su questo dispositivo: spazio esaurito o archiviazione bloccata. Al prossimo accesso andranno ricaricati.');
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
    state.demoLabel = window.UMA_DEMO.label || 'dati di esempio';
    state.errors = [];
    state.messages = [];
    rebuild();
  }

  // ------------------------------------------------------------ utilità di disegno

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
    return m ? `${m[2]}/${m[1]} ${m[3]}:${m[4]}` : label;
  }
  const tipAttr = (v, l, x) => `data-tip-v="${esc(v)}" data-tip-l="${esc(l || '')}" data-tip-x="${esc(x || '')}"`;
  const distChip = (dt, name) => `<span class="chip d${esc(dt)}"><i aria-hidden="true"></i>${esc(name)}</span>`;
  const posBadge = (p) => {
    const cls = p === 1 ? 'p1' : p <= 3 ? 'p2' : p <= 5 ? 'p4' : 'p6';
    return `<span class="pos ${cls}" title="${p}ª">${p}</span>`;
  };
  const posRow = (arr) => `<span class="posrow" aria-label="Arrivi: ${arr.join(', ')}">${arr.map(posBadge).join('')}</span>`;
  const flagRate = (k, n, warnAt, badAt) => {
    if (!k) return `${k}/${n}`;
    const r = k / n;
    const cls = r >= badAt ? 'bad' : r >= warnAt ? '' : null;
    return cls === null ? `${k}/${n}` : `<span class="flag ${cls}">${k}/${n}</span>`;
  };
  const tile = (label, value, sub) => `<div class="tile"><span class="tile-label">${esc(label)}</span><span class="tile-value">${esc(value)}</span>${sub ? `<span class="tile-sub">${esc(sub)}</span>` : ''}</div>`;
  const sectionHead = (id, eyebrow, title, intro) => `<div class="section-head"><p class="eyebrow">${esc(eyebrow)}</p><h2 id="h-${id}">${esc(title)}</h2>${intro ? `<p>${intro}</p>` : ''}</div>`;
  const noteFlags = (notes) => (notes.length ? `<span class="noteline">${notes.map((x) => `<span class="flag ${x.s === 'bad' ? 'bad' : x.s === 'good' ? 'good' : ''}">${esc(x.t)}</span>`).join('')}</span>` : '');

  function actionList(items, max) {
    return `<ol class="actions">${items.map((r) => `<li class="action">
      <div class="action-gain"><strong>~${fi(r.gain)}</strong><div class="meter" aria-hidden="true"><i style="width:${Math.max(2, (r.gain / max) * 100).toFixed(1)}%"></i></div><span>punti finali a sessione</span></div>
      <p class="action-text">${esc(r.text)}</p></li>`).join('')}</ol>`;
  }
  function noteList(items) {
    return `<ul class="actions">${items.map((n) => `<li class="action note-item"><span class="flag-icon" aria-hidden="true">!</span><p class="action-text">${esc(n.text)}</p></li>`).join('')}</ul>`;
  }

  // ------------------------------------------------------------ sezioni

  function secSummary(A) {
    const top = A.recs.est.slice(0, 5);
    const max = Math.max(1, ...A.recs.est.map((r) => r.gain));
    const apt = A.recs.notes.filter((n) => n.prio === 1);
    return `<section class="section" id="sintesi" aria-labelledby="h-sintesi">
      ${sectionHead('sintesi', 'Sintesi', 'Il quadro in breve')}
      <div class="tiles">
        ${tile('Punti medi a sessione', fi(A.totalAvg), `${A.nSessions} ${A.nSessions === 1 ? 'sessione' : 'sessioni'}`)}
        ${tile('Punti medi a gara', fi(A.raceAvg), `${A.nRaces} gare`)}
        ${tile('Gare vinte', `${A.wins} su ${A.nRaces}`, pct(A.wins / A.nRaces))}
        ${tile('1 punto base vale', `${ff(A.mult, 2)} finali`, `${ff(A.mult + 0.1, 2)} per la prima uma della distanza`)}
      </div>
      <div class="panel"><h3>Punteggio per sessione</h3>${sessionChart(A)}</div>
      <div class="section-head"><h3>Le 5 cose che valgono di più</h3><p class="note">Stima dei punti finali in più a sessione. L'elenco completo è in «Cosa migliorare».</p></div>
      ${actionList(top, max)}
      ${apt.length ? `<div class="section-head"><h3>Attitudini sotto A</h3></div>${noteList(apt)}` : ''}
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
    const every = Math.ceil(ss.length / 8);
    const cols = ss.map((s) => `<div class="col" tabindex="0" style="--h:${((s.total / max) * 100).toFixed(2)}%" ${tipAttr(fi(s.total), `${s.label} · ${s.wins} vinte su ${s.n}`, `${fi(s.perRace)} a gara · bonus avversario ${pct(s.oppRate, 1)}`)}>
        ${ss.length <= 8 || s === best ? `<span class="cap${s === best ? ' keep' : ''}">${fi(s.total)}</span>` : ''}<i class="bar"></i></div>`).join('');
    const labels = ss.map((s, i) => `<div>${i % every === 0 ? `<span>${esc(shortLabel(s.label))}</span>` : '<span>&nbsp;</span>'}
        ${ss.length <= 12 ? `<span class="wl" aria-label="${s.wins} vinte, ${s.n - s.wins} perse">${s.results.map((w) => `<b class="${w ? 'w' : ''}"></b>`).join('')}</span>` : ''}</div>`).join('');
    return `<div class="colchart" role="img" aria-label="Punteggio totale per sessione">
      <div class="colchart-plot">${grid.join('')}<div class="cols">${cols}</div></div>
      <div class="col-labels">${labels}</div></div>
      ${ss.length <= 12 ? '<p class="note">Sotto ogni colonna le gare della sessione in ordine: pallino pieno = vinta, vuoto = persa.</p>' : ''}`;
  }

  function secScoring(A) {
    const maxPR = Math.max(1, ...A.categories.map((c) => c.perRace));
    const unit = (c) => (c.unitMin == null ? '–' : c.unitMin === c.unitMax ? fi(c.unitMin) : `${fi(c.unitMin)} … ${fi(c.unitMax)}`);
    const rows = A.categories.map((c) => `<tr>
        <td class="first">${esc(c.label)}</td>
        <td class="n">${unit(c)}</td>
        <td class="n">${c.hits}/${c.denom}</td>
        <td><div class="barcell"><div class="track">${c.perRace > 0 ? `<i style="width:${((c.perRace / maxPR) * 100).toFixed(2)}%" ${tipAttr(fi(c.perRace), c.label, `${pct(c.share, 1)} del totale`)}></i>` : ''}</div><span class="v">${fi(c.perRace)}</span></div></td>
        <td class="n">${pct(c.share, 1)}</td></tr>`).join('');
    const bonus = A.bonuses.map((b) => {
      const v = b.cfg ? b.cfg.map((x) => `+${pct(x, 2)}`).join(', ') : (b.max - b.min > 0.002 ? `+${pct(b.min, 1)} … +${pct(b.max, 1)}` : `+${pct(b.mean, 1)}`);
      return `<span><b>${esc(b.label)}</b> ${esc(v)}</span>`;
    }).join('');
    const moods = A.moods.map((m) => `<tr><td>${esc(m.label)}</td><td class="n">${m.n}</td><td class="n">${ff(m.avgFinish, 1)}</td><td class="n">${fi(m.avgRaw)}</td></tr>`).join('');
    const st = A.starts;
    return `<section class="section" id="punteggio" aria-labelledby="h-punteggio">
      ${sectionHead('punteggio', 'Punteggio', 'Da dove arrivano i punti', 'Ogni evento in gara vale dei <strong>punti base</strong>; poi tutti i bonus percentuali li moltiplicano. Per salire conta aumentare i punti base.')}
      <div class="panel"><h3>Bonus percentuali osservati</h3><div class="kv">${bonus}</div>
        <p class="note" style="margin-top:8px">Punteggio di gara = punti base × (1 + bonus) di ogni evento, più il bonus squadra. In media 1 punto base vale ${ff(A.mult, 2)} punti finali.</p></div>
      <div class="table-wrap"><table>
        <thead><tr><th class="first">Voce</th><th class="n">Punti base per evento</th><th class="n">Presente</th><th>Punti finali per gara</th><th class="n">Quota</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><th class="first">Totale</th><th></th><th></th><th><div class="barcell"><span class="track"></span><span class="v">${fi(A.raceAvg)}</span></div></th><th class="n">100%</th></tr></tfoot>
      </table></div>
      <p class="note">«Presente» = in quante uma-gare compare la voce (per il bonus squadra: in quante gare).</p>
      <div class="grid-2">
        <div class="panel"><h3>Umore</h3><div class="table-wrap"><table>
          <thead><tr><th>Umore</th><th class="n">Uma-gare</th><th class="n">Piazz. medio</th><th class="n">Base medi</th></tr></thead><tbody>${moods}</tbody></table></div></div>
        <div class="panel"><h3>Partenze</h3>${st.total ? `<p class="tile-value">${st.perfect}/${st.total}</p><p class="note">Partenze perfette (ritardo sotto 0,02 s): ${pct(st.perfect / st.total)}. Ritardo medio ${ff(st.mean, 3)} s. Senza skill di partenza ci si aspetta circa il 20%.</p>` : '<p class="note">Il replay non è disponibile in questo browser.</p>'}</div>
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
      <td><div class="barcell"><div class="track"><i class="d${d.dt}" style="width:${((d.avgTotal / maxT) * 100).toFixed(2)}%;background:var(--c)" ${tipAttr(fi(d.avgTotal), `${d.name} · punti medi a gara`, `${d.wins} vinte su ${d.races}`)}></i></div><span class="v">${fi(d.avgTotal)}</span></div></td>
      <td class="n">${ff(d.avgFinish, 1)}</td>
      <td class="n">${d.teamBonus}/${d.races}</td>
      <td class="n">${d.ourFirst}/${d.races}</td></tr>`).join('');
    const cons = A.consistent === A.nRaces
      ? `In tutte le ${A.nRaces} gare ha vinto la squadra che ha piazzato un'uma al 1° posto.`
      : `La vittoria è andata alla squadra con la 1ª classificata in ${A.consistent} gare su ${A.nRaces}.`;
    return `<section class="section" id="distanze" aria-labelledby="h-distanze">
      ${sectionHead('distanze', 'Distanze', 'Come vai in ogni categoria')}
      <div class="table-wrap"><table>
        <thead><tr><th class="first">Distanza</th><th>Percorsi</th><th class="n">Gare</th><th class="n">V-S</th><th>Punti medi a gara</th><th class="n">Piazz. medio</th><th class="n">Bonus squadra</th><th class="n">1° posto nostro</th></tr></thead>
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
      const segs = SRC_KEYS.filter(([k]) => u.src[k] > 0).map(([k, l, c]) => `<i class="${c}" tabindex="0" style="flex:${u.src[k].toFixed(1)} 1 0" ${tipAttr(fi(u.src[k]), `${l} · ${u.name}`, 'punti base medi a gara')}></i>`).join('');
      const rushed = u.src.rushed ? ` · rushed ${fi(u.src.rushed)}` : '';
      html += `<div class="stack-row"><div class="stack-name" title="${esc(u.name)}">${esc(u.name)}${u.slot === 1 ? ' <span class="tag">1ª</span>' : ''}</div>
        <div class="stack-area"><div class="stack-track" style="width:${((totals[i] / max) * 100).toFixed(2)}%" role="img" aria-label="${esc(`${u.name}: ${fi(totals[i])} punti base medi a gara${rushed}`)}">${segs}</div></div>
        <span class="stack-total" ${tipAttr(fi(u.avgRaw), `${u.name} · punti base medi a gara`, u.src.rushed ? `di cui rushed ${fi(u.src.rushed)}` : '')}>${fi(u.avgRaw)}</span></div>`;
    });
    const ticks = [];
    for (let v = 0; v <= max + 1e-6; v += step) ticks.push(`<span style="left:${((v / max) * 100).toFixed(2)}%">${compact(v)}</span>`);
    html += `<div class="axis-row"><div class="axis-spacer"></div><div class="axis">${ticks.join('')}</div><div></div></div></div>
      <p class="note">Il numero a destra è il totale netto a gara, penalità per rushed comprese.</p>`;
    return html;
  }

  function diagTable(A) {
    const rows = A.umas.map((u) => {
      const d = u.diag; const n = u.n;
      const uniRate = d.uniqueK / n < 0.6 ? `<span class="flag${d.uniqueK === 0 ? ' bad' : ''}">${d.uniqueK}/${n}</span>` : `${d.uniqueK}/${n}`;
      const uni = d.hasUnique ? `${uniRate}${d.uniqueLevel ? ` <span class="muted">L${d.uniqueLevel}</span>` : ''}` : '–';
      return `<tr>
        <td class="first">${esc(u.name)}</td>
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
      <thead><tr><th class="first">Uma</th><th>Arrivi</th><th class="n">Base/gara</th><th class="n">Bianche/gara</th><th class="n">Oro/gara</th><th class="n">Unica</th><th class="n">Partenza perfetta</th><th class="n">1ª stile 1/6</th><th class="n">1ª stile 2/3</th><th class="n">Rushed</th><th class="n">HP finita</th><th class="n">Sprint in ritardo</th><th class="n">HP all'arrivo</th><th class="n">Bloccata</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <p class="note">Unica = gare in cui la skill unica si è attivata (L = livello). HP finita = HP a zero più di 10 m prima del traguardo. Sprint in ritardo = sprint finale partito più di 10 m dopo i 2/3 di gara, segno di stamina insufficiente. Bloccata = quota di tempo con un'uma davanti che chiude la strada nell'ultimo terzo.</p>`;
  }

  function umaCard(u) {
    const style = E.STYLE_NAMES[u.style] || '?';
    const statCells = E.STAT_KEYS.map(([k, l]) => `<div class="stat"><span>${l}</span><b>${fi(u.stats[k])}</b></div>`).join('');
    const apt = (v) => esc(E.APT[v] || '?');
    const races = u.races.map((r) => `<tr><td>${esc(shortLabel(r.session))} · G${r.rnd}</td><td>${r.distance ? `${fi(r.distance)} m` : '–'}</td><td>${posBadge(r.finish)}</td><td class="n">${r.popularity}</td><td>${esc(r.mood)}</td><td class="n">${fi(r.raw)}</td><td class="n">${fi(r.final)}</td><td class="n">${r.white}/${r.gold}/${r.unique}</td><td class="wrap">${noteFlags(r.notes)}</td></tr>`).join('');
    const sk = u.skills.map((s) => `<tr><td class="wrap">${esc(s.name || '?')}${s.acts ? '' : ' <span class="flag">mai</span>'}</td><td class="n muted">${s.id}</td><td>${esc(s.kind)}</td><td class="n">L${s.level}</td><td class="n">${s.acts}/${u.n}</td><td class="n">${fi(s.points)}</td></tr>`).join('');
    return `<details class="card" id="uma-${u.tcid}">
      <summary>
        <span class="card-title"><strong>${esc(u.name)}</strong><span>${distChip(u.mainDist, u.distLabel)} ${esc(style)}${u.slot === 1 ? ' <span class="tag">prima uma</span>' : ''}</span></span>
        ${posRow(u.finishes)}
        <span class="card-score"><b>${fi(u.avgRaw)} base</b>${fi(u.avgFinal)} finali a gara</span>
      </summary>
      <div class="card-body">
        <div class="stats">${statCells}</div>
        <div class="kv">
          <span>Attitudini: distanza <b>${apt(u.apt.dist)}</b> · terreno <b>${apt(u.apt.ground)}</b> · stile <b>${apt(u.apt.style)}</b></span>
          <span>Attivazione skill teorica <b>${pct(u.skillChance)}</b></span>
          <span>Rushed teorico <b>${pct(u.rushedChance)}</b></span>
          ${u.diag.uniqueName ? `<span>Unica: <b>${esc(u.diag.uniqueName)}</b> ${u.diag.uniqueK}/${u.n}</span>` : ''}
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Gara</th><th>Percorso</th><th>Arrivo</th><th class="n">Pop.</th><th>Umore</th><th class="n">Base</th><th class="n">Finali</th><th class="n">Skill b/o/u</th><th>Note</th></tr></thead>
          <tbody>${races}</tbody></table></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Skill</th><th class="n">ID</th><th>Tipo</th><th class="n">Liv.</th><th class="n">Attivazioni</th><th class="n">Punti base</th></tr></thead>
          <tbody>${sk}</tbody></table></div>
      </div></details>`;
  }

  function secUmas(A) {
    return `<section class="section" id="uma" aria-labelledby="h-uma">
      ${sectionHead('uma', 'Uma', 'Rendimento di ogni uma', 'Punti base medi a gara divisi per fonte. Tocca una barra per il dettaglio, apri una scheda per gare e skill.')}
      <div class="panel">${umaStack(A)}</div>
      <div class="section-head"><h3>Diagnostica</h3></div>
      ${diagTable(A)}
      <div class="section-head"><h3>Schede</h3></div>
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
          return `<td class="h" style="background:${bg}" ${tipAttr(`${s.diff >= 0 ? '+' : '−'}${fi(Math.abs(s.diff))}`, `${s.label} · ${d.name}`, `noi ${fi(s.ours)}, avversari ${fi(s.opp)}`)}><b>${s.diff >= 0 ? '+' : '−'}${fi(Math.abs(s.diff))}</b><small>${fi(s.ours)} / ${fi(s.opp)}</small></td>`;
        }).join('')}
        <td class="n">${ff(d.avgFinish, 1)} / ${ff(d.oppFinish, 1)}</td></tr>`).join('');
    const lost = A.lost.map((l) => `<tr><td>${esc(shortLabel(l.session))} · G${l.rnd}</td><td>${esc(l.dist)}${l.distance ? ` ${fi(l.distance)} m` : ''}</td>
        <td>${l.winner ? `${esc(l.winner.name)} <span class="muted">${esc(l.winner.style)}</span>` : 'uma fuori squadra'}</td>
        ${E.STAT_KEYS.map(([k]) => `<td class="n">${l.winner ? fi(l.winner.stats[k]) : '–'}</td>`).join('')}
        <td>${l.best ? `${esc(l.best.name)} ${posBadge(l.best.finish)}` : '–'}</td></tr>`).join('');
    return `<section class="section" id="avversari" aria-labelledby="h-avversari">
      ${sectionHead('avversari', 'Avversari', 'Le tue statistiche contro quelle avversarie', 'Media delle statistiche delle tue 3 uma contro quelle delle 3 avversarie, per distanza. Blu: sei più alto. Rosso: sono più alti gli avversari.')}
      <div class="div-legend"><span>avversari più alti</span><span class="ramp" aria-hidden="true"></span><span>tu più alto</span></div>
      <div class="table-wrap"><table class="heat">
        <thead><tr><th class="first">Distanza</th>${E.STAT_KEYS.map(([, l]) => `<th style="text-align:center">${l}<br><span class="muted small">diff · tu / avv.</span></th>`).join('')}<th class="n">Piazz. medio<br><span class="muted small">tu / avv.</span></th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      ${A.lost.length ? `<div class="section-head"><h3>Chi ha vinto le gare perse</h3></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Gara</th><th>Distanza</th><th>Vincitrice</th>${E.STAT_KEYS.map(([, l]) => `<th class="n">${l}</th>`).join('')}<th>Tua migliore</th></tr></thead>
        <tbody>${lost}</tbody></table></div>` : ''}
    </section>`;
  }

  function secSkills(A) {
    const items = A.umas.filter((u) => u.never.length).map((u) => `<div class="never-item"><strong>${esc(u.name)}</strong>
      <ul>${u.never.map((s) => `<li>${esc(s.name || String(s.id))} <small>${esc(s.kind)}</small></li>`).join('')}</ul></div>`).join('');
    return `<section class="section" id="skill" aria-labelledby="h-skill">
      ${sectionHead('skill', 'Skill', 'Skill mai attivate', `Ogni attivazione vale punti base: bianca o unica ereditata 500, oro 1.200, unica 2.300-2.500. Anche le passive contano. Qui sotto le skill che non si sono mai attivate in nessuna gara; la tabella completa è nella scheda di ogni uma.`)}
      ${items ? `<div class="panel never-list">${items}</div>` : '<p class="note">Tutte le skill si sono attivate almeno una volta.</p>'}
      ${A.unnamed.length ? `<p class="note">${A.unnamed.length} skill non hanno un nome nel database: carica un file JSON di nomi (id → nome) per completarle.</p>` : ''}
    </section>`;
  }

  function secRaces(A) {
    const blocks = A.races.map((s) => {
      const wins = s.races.filter((r) => r.win).length;
      const total = s.races.reduce((t, r) => t + r.total, 0);
      const races = s.races.map((r) => {
        const rows = r.ours.map((u) => `<tr><td class="first">${esc(u.name)}</td><td class="n">${u.slot === 1 ? '<span class="tag">1ª</span>' : u.slot}</td><td>${posBadge(u.finish)}</td><td class="n">${u.popularity}</td><td>${esc(u.mood)}</td><td class="n">${fi(u.raw)}</td><td class="n">${fi(u.final)}</td><td class="n">${u.white}/${u.gold}/${u.unique}</td><td class="wrap">${noteFlags(u.notes)}</td></tr>`).join('')
          + r.opponents.map((o) => `<tr class="sub"><td class="first">avv. ${esc(o.name)}</td><td class="n">${o.slot}</td><td>${posBadge(o.finish)}</td><td></td><td></td><td></td><td></td><td></td><td>${esc(o.style)}</td></tr>`).join('');
        return `<details class="card race"><summary>
            <span class="result${r.win ? ' win' : ''}">${r.win ? 'Vinta' : 'Persa'}</span>
            <span class="card-title"><strong>G${r.rnd} · ${esc(r.dist)} ${r.distance ? `${fi(r.distance)} m` : ''}</strong><span>${esc(r.weather)}, ${esc(r.ground)}${r.teamFinal ? ` · bonus squadra ${fi(r.teamFinal)}` : ''}</span></span>
            ${posRow(r.ours.map((u) => u.finish))}
            <span class="card-score"><b>${fi(r.total)}</b>punti</span>
          </summary><div class="card-body"><div class="table-wrap"><table>
            <thead><tr><th class="first">Uma</th><th class="n">Slot</th><th>Arrivo</th><th class="n">Pop.</th><th>Umore</th><th class="n">Base</th><th class="n">Finali</th><th class="n">Skill b/o/u</th><th>Note</th></tr></thead>
            <tbody>${rows}</tbody></table></div></div></details>`;
      }).join('');
      return `<div class="session-block"><div class="session-head"><h3>${esc(s.label)}</h3><span class="muted">${fi(total)} punti · ${wins} vinte su ${s.races.length}</span></div>${races}</div>`;
    }).join('');
    return `<section class="section" id="gare" aria-labelledby="h-gare">
      ${sectionHead('gare', 'Gare', 'Gara per gara')}
      ${blocks}
      <div class="panel"><h3>Esporta per un foglio di calcolo</h3>
        <p class="note">Copia i dati in formato CSV e incollali in Excel, Numbers o Google Sheets.</p>
        <div class="export" style="margin-top:10px">
          <button class="btn" type="button" data-action="copy-uma">Copia uma per gara</button>
          <button class="btn" type="button" data-action="copy-skill">Copia skill</button>
          <span class="small muted" id="copy-status" role="status"></span>
          <textarea id="copy-area" aria-label="Dati CSV da copiare" readonly hidden></textarea>
        </div></div>
    </section>`;
  }

  function secPriorities(A) {
    const max = Math.max(1, ...A.recs.est.map((r) => r.gain));
    return `<section class="section" id="priorita" aria-labelledby="h-priorita">
      ${sectionHead('priorita', 'Cosa migliorare', 'Priorità, in ordine di punti', `Stime in punti finali per sessione. Servono a ordinare le priorità, non sono previsioni esatte.`)}
      ${actionList(A.recs.est, max)}
      <div class="section-head"><h3>Altre indicazioni</h3></div>
      ${noteList(A.recs.notes)}
    </section>`;
  }

  function secLegend() {
    return `<section class="section" id="legenda" aria-labelledby="h-legenda">
      ${sectionHead('legenda', 'Legenda', 'Come si calcolano i punti', 'Regole ricavate confrontando ogni evento di punteggio con il replay delle gare. Quelle indicate come «dedotto» si basano su pochi casi.')}
      <dl class="panel legend-list">${E.LEGEND.map(([t, d]) => `<div><dt>${esc(t)}</dt><dd>${esc(d)}</dd></div>`).join('')}</dl>
      <p class="note">Nomi delle skill: <a href="https://github.com/alpha123/uma-tools" target="_blank" rel="noopener">alpha123/uma-tools</a>, testi del client Global. Le probabilità legate alla Saggezza usano formule note della community e sono indicative.</p>
    </section>`;
  }

  // ------------------------------------------------------------ rendering

  function renderStatus() {
    const el = $('#status');
    const A = state.analysis;
    if (state.busy && state.files.length) {
      el.hidden = false;
      el.classList.remove('demo');
      el.innerHTML = '<div class="status-text">Analisi in corso…</div>';
      return;
    }
    let text = '';
    let actions = '';
    if (A) {
      const what = `${A.nSessions} ${A.nSessions === 1 ? 'sessione' : 'sessioni'} · ${A.nRaces} gare · ${A.nUmas} uma`;
      if (state.source === 'demo') text = `<strong>Esempio:</strong> ${esc(state.demoLabel)} (${what}). Carica i tuoi file per sostituirlo.`;
      else if (state.source === 'saved') text = `${what}. File ricordati da questo dispositivo.`;
      else text = `${what}.`;
      if (A.missingReplay) text += ' <span class="muted">Replay non leggibile per alcune gare: diagnostica di HP, skill e partenze parziale.</span>';
      if (A.badChecks) text += ` <span class="muted">In ${A.badChecks} gare la somma dei punti non torna con il totale.</span>`;
      actions = `<div class="status-actions"><label class="btn" for="file-input">Aggiungi file</label>${state.source === 'demo' ? '' : '<button class="btn btn-ghost" type="button" data-action="clear">Svuota</button>'}</div>`;
    } else if (window.UMA_DEMO && window.UMA_DEMO.files) {
      text = 'Vuoi vedere prima come funziona?';
      actions = '<div class="status-actions"><button class="btn" type="button" data-action="demo">Mostra l\'esempio</button></div>';
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

  // ------------------------------------------------------------ interazioni

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
      status.textContent = 'Copiato negli appunti.';
      area.hidden = true;
    } catch (e) {
      area.hidden = false;
      area.value = text;
      area.focus();
      area.select();
      status.textContent = 'Copia non consentita qui: il testo è selezionato, copialo a mano.';
    }
  }

  document.addEventListener('click', (e) => {
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

  // ------------------------------------------------------------ avvio

  (async function start() {
    const saved = loadSaved();
    if (saved && saved.length) {
      state.files = saved;
      state.source = 'saved';
    } else if (window.UMA_DEMO && window.UMA_DEMO.files) {
      state.files = window.UMA_DEMO.files;
      state.source = 'demo';
      state.demoLabel = window.UMA_DEMO.label || 'dati di esempio';
    }
    if (state.files.length) await rebuild();
    else render();
  })();
})();
