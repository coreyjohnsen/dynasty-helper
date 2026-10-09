"use strict";
/* ================= 6. SIMULATOR ================= */
const SimUI = { mode: 'season', week: null, n: 2000, res: null, team: null, replay: null, openWeek: null, sort: 'title' };
/* ================= simulator pieces =================
   Shared by all three modes: a badge for every team (its Sleeper avatar, or a
   coloured initial when it has none), a strip to pick a team, and a meter. */
function teamFace(T, size) {
  size = size || 32;
  const hue = ((T.rosterId || 1) * 47) % 360;
  const e = h('span.tface', {
    style: { width: size + 'px', height: size + 'px', fontSize: Math.max(9, Math.round(size * 0.36)) + 'px', background: `linear-gradient(135deg,hsl(${hue},55%,52%),hsl(${(hue + 40) % 360},55%,38%))` }
  }, String(T.short || '?').slice(0, 2));
  if (T.avatar) e.appendChild(h('img', { src: T.avatar, alt: '', loading: 'lazy', onerror: ev => ev.target.remove() }));
  return e;
}
/** A team as a badge and a name, for the places a table cell has no room for more. */
function teamLine(T, size) {
  return h('div.row', { style: { gap: '8px', minWidth: 0, flexWrap: 'nowrap' } }, teamFace(T, size || 26),
    h('span', { style: { fontWeight: 580, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: T.name + ' — ' + T.owner }, T.name));
}
/** Pick one team from a scrolling row of badges. */
function teamStrip(teams, selected, onPick) {
  return h('div.tstrip', { role: 'radiogroup', 'aria-label': 'Team' }, teams.map(T =>
    h('button.tpill' + (T.rosterId === selected ? '.on' : ''), { role: 'radio', 'aria-checked': T.rosterId === selected ? 'true' : 'false', title: T.name, onclick: () => onPick(T.rosterId) },
      teamFace(T, 26), h('span', T.short))));
}
/** A labelled bar with its number on the right. */
function simMeter(label, v, colour, text) {
  return h('div.smeter', h('span.tiny.muted', label),
    h('div.bar-track', h('div.bar-fill', { style: { width: (clamp(v, 0, 1) * 100) + '%', background: colour } })),
    h('b.mono', text));
}
const SIM_MODES = [
  { k: 'season', ic: 'standings', t: 'Season odds', d: 'Playoff, bye and title odds for every team, plus the games that swing them.' },
  { k: 'week', ic: 'week', t: 'Single week', d: 'Win chances and score ranges for every matchup in one week.' },
  { k: 'replay', ic: 'power', t: 'Play a season', d: 'One actual season, game by game, through the bracket to a champion.' }
];
function simDesk(weeks, isReplay) {
  const mode = SIM_MODES.find(m => m.k === SimUI.mode) || SIM_MODES[0];
  const run = () => {
    const t0 = performance.now();
    if (isReplay) { SimUI.replay = simulateOneSeason(); SimUI.openWeek = null; SimUI.replay.ms = Math.round(performance.now() - t0); }
    else {
      SimUI.res = SimUI.mode === 'week' ? simulate(SimUI.n, { onlyWeek: SimUI.week }) : simulate(SimUI.n);
      SimUI.res.ms = Math.round(performance.now() - t0);
      if (SimUI.mode === 'season') S.sim = SimUI.res;
    }
    render();
  };
  const status = !isReplay && SimUI.res ? `${kfmt(SimUI.res.n)} runs in ${SimUI.res.ms} ms`
    : isReplay && SimUI.replay ? 'season #' + SimUI.replay.seed.toString(36) + (SimUI.replay.ms ? ' · ' + SimUI.replay.ms + ' ms' : '') : null;
  return h('div.card.simdesk', h('div.bd',
    h('div.smodes', { role: 'tablist' }, SIM_MODES.map(m =>
      h('button.smode' + (m.k === SimUI.mode ? '.on' : ''), { role: 'tab', 'aria-selected': m.k === SimUI.mode ? 'true' : 'false', onclick: () => { SimUI.mode = m.k; SimUI.res = null; render(); } },
        h('span.smode-ic', ico(m.ic)), h('span.smode-t', m.t)))),
    h('div.tiny.muted', { style: { lineHeight: 1.5 } }, mode.d + ' Every run is freshly random — the same settings will not give you the same season twice.'),
    h('div.simctl',
      SimUI.mode === 'week' ? h('label.fld', 'Week', h('select', { onchange: e => { SimUI.week = +e.target.value; SimUI.res = null; render(); } },
        weeks.map(w => h('option', { value: w, selected: w === SimUI.week }, 'Week ' + w + (w <= S.lastWeek ? ' (played)' : ''))))) : null,
      isReplay ? null : h('label.fld', 'Simulations', h('select', { onchange: e => { SimUI.n = +e.target.value; SimUI.res = null; render(); } },
        [1000, 2000, 5000, 10000].map(n => h('option', { value: n, selected: n === SimUI.n }, kfmt(n))))),
      h('button.btn.pri.simrun', { onclick: run }, isReplay ? '▶ Play the season' : 'Run simulation')),
    status ? h('div.tiny.muted', status) : null));
}
function simEmpty(title, text) {
  return h('div.card', h('div.bd', h('div.empty',
    h('div', { style: { fontSize: '15px', fontWeight: 600, color: 'var(--text-secondary)' } }, title),
    h('div.tiny', { style: { marginTop: '6px', maxWidth: '540px', margin: '6px auto 0' } }, text))));
}

function viewSim() {
  const wrap = h('div.grid');
  const firstOpen = Math.min(S.lastWeek + 1, S.regEnd);
  if (SimUI.week === null) SimUI.week = firstOpen;
  const weeks = []; for (let w = 1; w <= S.regEnd; w++) weeks.push(w);
  const isReplay = SimUI.mode === 'replay';
  wrap.appendChild(simDesk(weeks, isReplay));

  if (isReplay) {
    if (!SimUI.replay) {
      wrap.appendChild(simEmpty('Play one season all the way through',
        'Not odds — one actual season. Every remaining week gets played out game by game, the table sorts itself out, the bracket runs, and somebody lifts the trophy. '
        + (S.lastWeek ? `Weeks 1–${S.lastWeek} are your real results; week ${S.lastWeek + 1} onward is where it goes off-script.` : 'Nothing has happened yet, so the whole thing is up for grabs.')));
      return wrap;
    }
    wrap.appendChild(simReplayView(SimUI.replay));
    return wrap;
  }
  if (!SimUI.res) {
    wrap.appendChild(simEmpty('Pick a mode and press Run',
      'Every player gets a projected mean and a weekly standard deviation. Each simulated week draws a score for each starter, adds a team-level swing, resolves your real schedule, then seeds and plays the bracket. Weeks already played are locked to their actual results.'));
    return wrap;
  }
  return SimUI.mode === 'week' ? (wrap.appendChild(simWeekView(SimUI.res)), wrap) : (wrap.appendChild(simSeasonView(SimUI.res)), wrap);
}
/** One matchup of the single-week view: both teams, their chances, and where the score should land. */
function simGameCard(res, a, b) {
  const A = S.teamById[a], B = S.teamById[b];
  const ra = res.by[a], rb = res.by[b];
  if (!A || !B || !ra || !rb) return null;
  const wk = res.onlyWeek, played = wk <= S.lastWeek, isLive = wk === S.liveWeek;
  const actual = (played || isLive) ? (S.matchups[wk] || []) : [];
  const ga = isLive ? { points: liveRoster(A, wk).total } : actual.find(m => m.roster_id === a);
  const gb = isLive ? { points: liveRoster(B, wk).total } : actual.find(m => m.roster_id === b);
  const CA = 'var(--s1)', CB = 'var(--s2)';
  const dist = (r) => {
    const s = r.weekScores.slice().sort((x, y) => x - y);
    const q = p => s[clamp(Math.floor(p * s.length), 0, s.length - 1)];
    return `<b>${fmt(q(.5), 1)}</b> median · ${fmt(q(.1), 0)}–${fmt(q(.9), 0)} typical range`;
  };
  const side = (T, r, act, col, right) => h('div.sg-side' + (right ? '.r' : ''),
    teamFace(T, 44),
    h('div.sg-nm', { title: T.name }, matchupName(T)),
    h('div.sg-pct', { style: { color: col } }, pct(r.weekWin, 0)),
    h('div.tiny.muted', 'proj ' + fmt(r.weekPts, 1)),
    act ? h('div.tiny', { style: { fontWeight: 650 } }, (isLive ? 'live ' : 'actual ') + fmt(act.points || 0, 1)) : h('div.tiny.muted', 'top scorer ' + pct(r.weekTop, 1)));
  return h('div.card.sgame', h('div.bd',
    h('div.row', { style: { justifyContent: 'space-between' } },
      h('b.tiny', 'Week ' + wk + (played ? ' — final' : '')), isLive ? h('span.tag', { style: { borderColor: CA, color: CA } }, '● live') : null),
    h('div.sg-main', side(A, ra, ga, ra.weekWin >= rb.weekWin ? CA : 'var(--text-muted)', false), h('div.sg-vs', 'vs'), side(B, rb, gb, rb.weekWin > ra.weekWin ? CB : 'var(--text-muted)', true)),
    h('div.sg-bar', h('i', { style: { width: (ra.weekWin * 100) + '%', background: CA } }), h('i', { style: { width: (rb.weekWin * 100) + '%', background: CB } })),
    h('div.tiny.muted', { style: { borderTop: '1px solid var(--border)', paddingTop: '8px', lineHeight: 1.6 }, html: A.short + ': ' + dist(ra) + '<br>' + B.short + ': ' + dist(rb) })));
}
function simWeekView(res) {
  const wrap = h('div.grid');
  const games = (schedule()[res.onlyWeek - 1] || []);
  const played = res.onlyWeek <= S.lastWeek;
  if (!games.length) return card('Week ' + res.onlyWeek, null, h('div.empty', 'No matchups found for this week.'));
  wrap.appendChild(h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(min(320px,100%),1fr))' } },
    games.map(([a, b]) => simGameCard(res, a, b)).filter(Boolean)));

  const teams = S.teams.slice().sort((a, b) => b.now - a.now);
  if (SimUI.team === null) SimUI.team = teams[0].rosterId;
  const T = S.teamById[SimUI.team], r = res.by[SimUI.team];
  const scores = r.weekScores.slice().sort((a, b) => a - b);
  const lo = scores[Math.floor(scores.length * 0.01)], hi = scores[Math.floor(scores.length * 0.99)];
  const NB = 22, bw = (hi - lo) / NB;
  const bins = Array.from({ length: NB }, (_, i) => ({ x: Math.round(lo + i * bw), v: 0, label: `${fmt(lo + i * bw, 0)}–${fmt(lo + (i + 1) * bw, 0)} pts` }));
  scores.forEach(s => { const i = clamp(Math.floor((s - lo) / bw), 0, NB - 1); bins[i].v++; });
  bins.forEach(b => b.v /= scores.length);
  wrap.appendChild(card('Score distribution — week ' + res.onlyWeek, 'what this team could plausibly put up',
    h('div', { style: { display: 'grid', gap: '12px', gridTemplateColumns: 'minmax(0,1fr)' } },
      teamStrip(teams, SimUI.team, id => { SimUI.team = id; render(); }),
      h('div', histogram(bins, { h: 175, w: chartW(900, 360), stretch: true, aria: 'score distribution' }),
        h('div.tiny.muted', { style: { marginTop: '8px' } }, `${T.name}: median ${fmt(scores[Math.floor(scores.length / 2)], 1)} · 10th–90th percentile ${fmt(scores[Math.floor(scores.length * .1)], 1)}–${fmt(scores[Math.floor(scores.length * .9)], 1)} · top-scorer odds ${pct(r.weekTop, 1)}`)))));

  const rank = simWeekRankCard(res);
  if (rank) wrap.appendChild(rank);

  wrap.appendChild(card('Every team this week', null, table([
    { k: 'name', h: 'Team', sort: r2 => r2.T.name, f: r2 => isNarrow() ? teamLine(r2.T, 24) : teamCell(r2.T) },
    { k: 'pts', h: 'Proj pts', num: true, sort: r2 => r2.r.weekPts, f: r2 => h('b.mono', fmt(r2.r.weekPts, 1)) },
    { k: 'win', h: 'Win prob', num: true, sort: r2 => r2.r.weekWin, f: r2 => pct(r2.r.weekWin, 0) },
    { k: 'top', prio: 2, h: 'Top scorer', num: true, sort: r2 => r2.r.weekTop, f: r2 => pct(r2.r.weekTop, 1) },
    { k: 'act', h: res.onlyWeek === S.liveWeek ? 'Live total' : 'Actual', num: true, sort: r2 => r2.act, f: r2 => r2.act ? fmt(r2.act, 1) : '—' }
  ], S.teams.map(t => ({
    T: t, r: res.by[t.rosterId],
    act: res.onlyWeek === S.liveWeek ? liveRoster(t, res.onlyWeek).total
      : played ? ((S.matchups[res.onlyWeek] || []).find(m => m.roster_id === t.rosterId) || {}).points : null
  })), { sortKey: 'pts', sortDir: -1 })));
  return wrap;
}
/** The three likeliest champions, as cards. */
function simPodium(rows) {
  const top = rows.slice(0, 3), lead = Math.max(top[0] ? top[0].s.title : 0, 0.0001);
  // the likeliest champion stands in the middle and a little higher, like a podium
  return h('div.tpodium', top.map((r, i) => h('div.tpod.t' + (i + 1) + (r.t.rosterId === S.myRosterId ? '.mine' : ''),
    h('div.tpod-rank', i === 0 ? '👑 Favourite' : i === 1 ? '2nd' : '3rd'),
    h('div.tpod-av', teamFace(r.t, i === 0 ? 76 : 62)),
    h('div.tpod-nm', { title: r.t.name }, r.t.name),
    h('div.tpod-pct', pct(r.s.title, 1)),
    h('div.tpod-lbl', 'to win it all'),
    h('div.tpod-bar', { 'aria-hidden': 'true' }, h('i', { style: { width: Math.max(4, r.s.title / lead * 100) + '%' } })),
    h('div.tpod-stats',
      h('div', h('b', pct(r.s.playoff, 0)), h('span', 'make playoffs')),
      h('div', h('b', fmt(r.s.wins, 1)), h('span', 'projected wins'))))));
}
/** Every team as a ranked card — the phone's answer to a nine-column table. */
function simOutcomeList(rows, res) {
  const key = SimUI.sort;
  const val = r => key === 'playoff' ? r.s.playoff : key === 'wins' ? r.s.wins : r.s.title;
  const sorted = rows.slice().sort((a, b) => val(b) - val(a));
  const top = Math.max(...rows.map(r => r.s.title), 0.01);
  return h('div', { style: { display: 'grid', gap: '10px' } },
    h('div.row', { style: { gap: '10px' } }, h('span.tiny.muted', 'Rank by'),
      segmented([{ k: 'title', label: 'Title' }, { k: 'playoff', label: 'Playoffs' }, { k: 'wins', label: 'Wins' }], key, k => { SimUI.sort = k; render(); })),
    h('div.olist', sorted.map((r, i) => h('div.orow',
      h('span.orank.mono', i + 1),
      teamFace(r.t, 38),
      h('div.omain',
        h('div.row', { style: { justifyContent: 'space-between', gap: '8px', flexWrap: 'nowrap' } },
          h('b.onm', { title: r.t.name }, r.t.name),
          h('span.tag', { style: { flex: 'none' }, title: 'record now' }, `${r.t.wins}-${r.t.losses}${r.t.ties ? '-' + r.t.ties : ''}`)),
        simMeter('Playoffs', r.s.playoff, r.s.playoff > .6 ? 'var(--good)' : r.s.playoff > .25 ? 'var(--s4)' : 'var(--s8)', pct(r.s.playoff, 0)),
        simMeter('Title', r.s.title / top, 'var(--s1)', pct(r.s.title, 1)),
        h('div.tiny.muted.odet', `${fmt(r.s.wins, 1)} proj W · ${fmt(r.s.pts, 0)} PF · seed ${fmt(r.s.seed, 1)} (${r.s.best}–${r.s.worst}) · bye ${pct(r.s.bye, 0)} · final ${pct(r.s.final, 0)}`))))));
}
function simSeasonView(res) {
  const wrap = h('div.grid');
  const rows = S.teams.map(t => ({ t, s: res.by[t.rosterId] })).sort((a, b) => b.s.title - a.s.title);
  const champ = rows[0];
  const lucky = rows.filter(r => r.s.luck !== null).slice().sort((a, b) => b.s.luck - a.s.luck)[0];
  const biggest = (res.leverage || [])[0];
  wrap.appendChild(simPodium(rows));
  wrap.appendChild(h('div.kstrip',
    kpi('Most likely champion', champ.t.name, pct(champ.s.title, 1) + ' of simulations'),
    kpi('Weeks simulated', `${Math.min(S.lastWeek + 1, S.regEnd)}–${S.regEnd}`, S.lastWeek ? `weeks 1–${S.lastWeek} are actual results` : 'full season'),
    kpi('Playoff field', String(res.playoffTeams), 'teams make the bracket'),
    kpi('Tightest race', rows.slice().sort((a, b) => Math.abs(a.s.playoff - .5) - Math.abs(b.s.playoff - .5))[0].t.name, 'closest to a coin flip'),
    biggest ? kpi('Biggest game left', biggest.a.team.short + ' v ' + biggest.b.team.short,
      pct(biggest.swing, 0) + ' playoff swing · week ' + biggest.week) : null,
    lucky && Math.abs(lucky.s.luck) > 0.05 ? kpi('Kindest schedule', lucky.t.name, sgn(lucky.s.luck, 2) + ' wins vs. all-play')
      : kpi('Runs', kfmt(res.n), res.ms + ' ms')
  ));

  // the table is what the run was for, so it comes first — the leverage card and
  // everything under it are reading from the same numbers
  const outcomes = isNarrow() ? simOutcomeList(rows, res) : table([
    { k: 'name', h: 'Team', sort: r => r.t.name, f: r => teamCell(r.t) },
    { k: 'rec', h: 'Now', sort: r => r.t.wins, f: r => `${r.t.wins}-${r.t.losses}` },
    { k: 'wins', h: 'Proj W', num: true, sort: r => r.s.wins, f: r => h('b.mono', fmt(r.s.wins, 1)) },
    { k: 'pts', prio: 2, h: 'Proj PF', num: true, sort: r => r.s.pts, f: r => fmt(r.s.pts, 0) },
    { k: 'seed', prio: 2, h: 'Avg seed', num: true, sort: r => r.s.seed, f: r => fmt(r.s.seed, 1) },
    { k: 'range', prio: 2, h: 'Seed range', num: true, sortable: false, f: r => h('span.tiny.mono.muted', `${r.s.best}–${r.s.worst}`) },
    { k: 'playoff', h: 'Playoffs', num: true, sort: r => r.s.playoff, f: r => h('div.meter', { style: { justifyContent: 'flex-end' } }, h('div.bar-track', { style: { width: '50px' } }, h('div.bar-fill', { style: { width: (r.s.playoff * 100) + '%', background: r.s.playoff > .6 ? 'var(--good)' : r.s.playoff > .25 ? 'var(--s4)' : 'var(--s8)' } })), h('span.mono', pct(r.s.playoff, 0))) },
    { k: 'bye', prio: 2, h: 'Bye', num: true, sort: r => r.s.bye, f: r => pct(r.s.bye, 0) },
    { k: 'final', prio: 2, h: 'Final', num: true, sort: r => r.s.final, f: r => pct(r.s.final, 0) },
    { k: 'title', h: 'Title', num: true, sort: r => r.s.title, f: r => h('b.mono', pct(r.s.title, 1)) }
  ], rows, { sortKey: 'title', sortDir: -1 });
  wrap.appendChild(card('Simulated season outcomes', 'each row is ' + kfmt(res.n) + ' full seasons', outcomes));

  const lever = simLeverageCard(res);
  if (lever) wrap.appendChild(lever);

  const teams = S.teams.slice().sort((a, b) => a.powerRank - b.powerRank);
  if (SimUI.team === null) SimUI.team = teams[0].rosterId;
  const sel = res.by[SimUI.team];
  const bins = sel.winDist.map((v, i) => ({ x: i, v, label: i + ' win' + (i === 1 ? '' : 's') })).filter((b, i) => i <= S.regEnd);
  wrap.appendChild(card('Final win total', S.teamById[SimUI.team].name,
    h('div', { style: { display: 'grid', gap: '12px', gridTemplateColumns: 'minmax(0,1fr)' } },
      teamStrip(teams, SimUI.team, id => { SimUI.team = id; render(); }),
      h('div', histogram(bins, { h: 175, w: chartW(900, 360), stretch: true, aria: 'win distribution' }),
        h('div.tiny.muted', { style: { marginTop: '8px' } },
          `Most likely: ${bins.reduce((a, b) => b.v > a.v ? b : a).x} wins · average ${fmt(sel.wins, 1)} · playoffs ${pct(sel.playoff, 0)} · title ${pct(sel.title, 1)}`)))));

  const draft = simDraftCard(res);
  if (draft) wrap.appendChild(draft);

  // the deep-dive half of the simulator; simple mode stops after the outcomes
  const traj = proOnly(simTrajectoryCard(res));
  if (traj) wrap.appendChild(traj);
  const seed = proOnly(simSeedCard(res));
  if (seed) wrap.appendChild(seed);
  const luck = proOnly(simLuckCard(res));
  if (luck) wrap.appendChild(luck);
  const alive = proOnly(simAliveCard(res));
  if (alive) wrap.appendChild(alive);
  return wrap;
}

