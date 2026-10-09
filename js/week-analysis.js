"use strict";
/* ==================================================================
   Expanded simulation surfaces + head-to-head
   ================================================================== */

/* ---------- leverage: which games actually decide the season ---------- */
const LevUI = { week: 'all', n: 6, open: null };
/** One game that moves the season: who plays, and where both teams stand in each of the two worlds it leaves behind. */
function levGameCard(g, i, res, embedded) {
  const A = g.a.team, B = g.b.team;
  const total = (g.nA || 0) + (g.nB || 0);
  const ok = v => v !== null && v !== undefined;
  const tag = g.thin ? ['too lopsided to weigh', 'var(--text-muted)']
    : g.swing > 0.22 ? ['season-defining', 'var(--critical)'] : g.swing > 0.12 ? ['big one', 'var(--s4)'] : g.swing < 0.04 ? ['low stakes', 'var(--text-muted)'] : null;
  const lead = Math.abs(g.a.swing) >= Math.abs(g.b.swing) ? g.a : g.b;
  const heavy = (g.nA || 0) >= (g.nB || 0) ? A : B;
  const sentence = g.thin
    ? `${heavy.name} win this in ${pct(Math.max(g.nA || 0, g.nB || 0) / Math.max(1, total), 0)} of simulated seasons, so there is no second world to compare the first one against.`
    : `${lead.team.name} ${lead.swing >= 0.005 ? 'go from ' + pct(lead.poLose, 0) + ' to ' + pct(lead.poWin, 0) + ' to make the playoffs' : 'barely move either way'}`
    + (Math.abs(lead.titleSwing) > 0.004 ? `, and from ${pct(lead.tiLose, 1)} to ${pct(lead.tiWin, 1)} to win it` : '')
    + '.';
  const cell = (po, ti, win) => !ok(po) ? h('div.lev-c.na', '—')
    : h('div.lev-c' + (win ? '.win' : ''),
      h('div.lev-top', h('b.mono', pct(po, 0)), h('span.tiny.muted', ' playoffs')),
      h('div.bar-track', h('div.bar-fill', { style: { width: (clamp(po, 0, 1) * 100) + '%', background: win ? 'var(--s1)' : 'var(--text-muted)' } })),
      h('div.tiny.muted', pct(ti, 1) + ' title'));
  const head = (T) => h('div.lev-h', h('span.tiny.muted', 'If'), teamFace(T, 20), h('b.tiny', T.short), h('span.tiny.muted', 'wins'));
  const row = (T, w0, w1) => [h('div.lev-t', teamFace(T, 30), h('b.tiny', T.short)), w0, w1];
  const gridEl = h('div.levgrid', h('span'), head(A), head(B),
    row(A, cell(g.a.poWin, g.a.tiWin, true), cell(g.a.poLose, g.a.tiLose, false)),
    row(B, cell(g.b.poLose, g.b.tiLose, false), cell(g.b.poWin, g.b.tiWin, true)));
  const miss0 = !ok(g.a.poWin) || !ok(g.b.poLose), miss1 = !ok(g.a.poLose) || !ok(g.b.poWin);
  const next = g.week === res.fromWeek;
  if (embedded) return h('div.levdetail', gridEl,
    miss0 ? levUnmeasured(A.name, g.nA || 0, total) : null,
    miss1 ? levUnmeasured(B.name, g.nB || 0, total) : null,
    h('div.tiny.sec', { style: { paddingTop: '4px' } }, sentence));
  return h('div.levcard',
    h('div.row', { style: { gap: '7px', flexWrap: 'wrap' } },
      h('b.mono.tiny', '#' + (i + 1)),
      h('span.tag', { style: { borderColor: next ? 'var(--s1)' : null, color: next ? 'var(--s1)' : null } }, 'Week ' + g.week + (next ? ' · next up' : '')),
      tag ? h('span.tag', { style: { borderColor: tag[1], color: tag[1] } }, tag[0]) : null,
      h('span', { style: { flex: 1 } }),
      h('span.tiny.muted', 'up to ' + pct(g.swing, 0) + ' of playoff odds on the line')),
    h('div.levvs', teamFace(A, 34), h('b.levnm', A.name), h('span.tiny.muted', 'v'), h('b.levnm', B.name), teamFace(B, 34)),
    gridEl,
    miss0 ? levUnmeasured(A.name, g.nA || 0, total) : null,
    miss1 ? levUnmeasured(B.name, g.nB || 0, total) : null,
    h('div.tiny.sec', { style: { borderTop: '1px solid var(--border)', paddingTop: '8px' } }, sentence));
}
/** One game as a single line; click it and the two worlds it leaves behind open underneath. Only one is open at a time. */
function levRow(g, i, res) {
  const A = g.a.team, B = g.b.team;
  const key = g.week + '|' + A.rosterId + '|' + B.rosterId;
  const open = LevUI.open === key;
  const next = g.week === res.fromWeek;
  const tag = g.thin ? ['unweighable', 'var(--text-muted)']
    : g.swing > 0.22 ? ['season-defining', 'var(--critical)'] : g.swing > 0.12 ? ['big one', 'var(--s4)'] : g.swing < 0.04 ? ['low stakes', 'var(--text-muted)'] : null;
  const meter = g.thin ? h('span.muted.tiny', 'not weighable')
    : h('div.levmeter', h('div.bar-track', h('div.bar-fill', { style: { width: (clamp(g.swing / 0.35, 0, 1) * 100) + '%', background: g.swing > 0.22 ? 'var(--critical)' : g.swing > 0.12 ? 'var(--s4)' : 'var(--s1)' } })),
      h('b.mono', pct(g.swing, 0)));
  const head = h('button.levrow' + (open ? '.open' : ''), {
    'aria-expanded': open ? 'true' : 'false', title: open ? 'Hide the detail' : 'Show where both teams stand if it goes either way',
    onclick: () => { LevUI.open = open ? null : key; render(); }
  },
    h('b.mono.tiny.levn', '#' + (i + 1)),
    h('span.levteams', teamFace(A, 26), h('b', A.short), h('span.tiny.muted', 'v'), h('b', B.short), teamFace(B, 26)),
    h('span.levmeta',
      h('span.tag', { style: { borderColor: next ? 'var(--s1)' : null, color: next ? 'var(--s1)' : null } }, 'Wk ' + g.week + (next ? ' · next' : '')),
      tag ? h('span.tag', { style: { borderColor: tag[1], color: tag[1] } }, tag[0]) : null),
    meter,
    h('span.chev', ico('chev')));
  return h('div.levitem' + (open ? '.open' : ''), head, open ? levGameCard(g, i, res, true) : null);
}
function simLeverageCard(res) {
  if (!res.leverage || !res.leverage.length) return null;
  const weeks = []; for (let w = res.fromWeek; w <= S.regEnd; w++) if (res.leverage.some(g => g.week === w)) weeks.push(w);
  if (LevUI.week !== 'all' && !weeks.includes(LevUI.week)) LevUI.week = 'all';
  const picked = LevUI.week === 'all' ? res.leverage : res.leverage.filter(g => g.week === LevUI.week);
  const shown = picked.slice(0, LevUI.n);

  const opts = [{ k: 'all', label: 'Rest of season' }].concat(weeks.map(w => ({ k: w, label: 'Wk ' + w })));
  const controls = h('div.row', { style: { gap: '12px', marginBottom: '12px' } },
    h('div.segscroll', segmented(opts, LevUI.week, k => { LevUI.week = k; LevUI.n = 6; render(); })),
    h('span', { style: { flex: 1 } }),
    h('span.tiny.muted', picked.length + ' game' + (picked.length === 1 ? '' : 's') + ' weighed'));

  const body = h('div', { style: { display: 'grid', gap: '8px' } }, shown.map((g, i) => levRow(g, i, res)));

  const more = picked.length > shown.length
    ? h('div.row', { style: { marginTop: '11px', justifyContent: 'center' } },
      h('button.btn.sm', { onclick: () => { LevUI.n += 6; render(); } }, 'Show ' + Math.min(6, picked.length - shown.length) + ' more'))
    : null;

  // the whole remaining season at a glance, so nothing is hidden behind the top six
  const allTbl = table([
    { k: 'week', h: 'Week', num: true, sort: g => g.week, f: g => h('b.mono', g.week) },
    { k: 'game', h: 'Matchup', sortable: false, f: g => h('div.row', { style: { gap: '5px', minWidth: 0 } }, h('span.tiny', g.a.team.short), h('span.tiny.muted', 'v'), h('span.tiny', g.b.team.short)) },
    { k: 'swing', h: 'Playoff swing', num: true, sort: g => g.swing, f: g => g.thin
      ? h('span.muted.tiny', { title: 'one outcome barely happens in the simulation, so the two cannot be compared' }, 'not weighable')
      : h('div.meter', { style: { justifyContent: 'flex-end' } },
        isNarrow() ? null : h('div.bar-track', { style: { width: '64px' } }, h('div.bar-fill', { style: { width: (clamp(g.swing / 0.35, 0, 1) * 100) + '%', background: g.swing > 0.22 ? 'var(--critical)' : g.swing > 0.12 ? 'var(--s4)' : 'var(--seq-300)' } })),
        h('b.mono', pct(g.swing, 0))) },
    { k: 'title', prio: 2, h: 'Title swing', num: true, sort: g => Math.max(Math.abs(g.a.titleSwing), Math.abs(g.b.titleSwing)), f: g => g.thin ? h('span.muted', '—') : pct(Math.max(Math.abs(g.a.titleSwing), Math.abs(g.b.titleSwing)), 1) },
    { k: 'fav', prio: 2, h: 'Most at stake', sortable: false, f: g => h('span.tiny', (Math.abs(g.a.swing) >= Math.abs(g.b.swing) ? g.a : g.b).team.name) }
  ], picked, { sortKey: 'swing', sortDir: -1 });
  const wt = withTable(h('div', controls, body, more), allTbl);

  return card(LevUI.week === 'all' ? 'Games that matter most — rest of season' : 'Games that matter most — week ' + LevUI.week,
    'ranked by how much of the playoff picture each game moves — open one to see where both teams stand if it goes either way',
    wt.body, wt.btn);
}

/* ---------- playoff odds through the season ---------- */
function simTrajectoryCard(res) {
  const start = res.fromWeek, end = S.regEnd;
  if (end - start < 1) return null;
  const teams = S.teams.slice().sort((a, b) => res.by[b.rosterId].playoff - res.by[a.rosterId].playoff);
  const colors = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s7)'];
  const featured = teams.slice(0, 5).concat(teams.slice(-1));
  const colorOf = {}; featured.forEach((t, i) => colorOf[t.rosterId] = colors[i % colors.length]);
  // anchor the line on where the table actually stands right now, so the chart
  // reads as a race in progress rather than starting from nowhere
  const nowField = new Set(S.teams.slice()
    .sort((a, b) => (b.wins + 0.5 * b.ties) - (a.wins + 0.5 * a.ties) || b.fpts - a.fpts)
    .slice(0, res.playoffTeams).map(t => t.rosterId));
  const anchor = S.lastWeek >= 1 ? S.lastWeek : null;
  const pts = (t) => {
    const a = [];
    if (anchor) a.push({ x: anchor, y: nowField.has(t.rosterId) ? 100 : 0, label: 'Week ' + anchor + ' (actual)' });
    for (let w = start; w <= end; w++) a.push({ x: w, y: res.by[t.rosterId].fieldAt[w] * 100, label: 'Week ' + w });
    return a;
  };
  const bg = teams.filter(t => !colorOf[t.rosterId]).map(t => ({ name: t.name, color: 'var(--text-muted)', width: 1, opacity: .28, points: pts(t) }));
  const fg = featured.map(t => ({ name: t.name, color: colorOf[t.rosterId], width: 2, points: pts(t) }));
  const chart = lineChart(bg.concat(fg), {
    h: 250, dots: false, maxTip: 12, y0: 0, y1: 100, floorAtZero: true,
    yFmt: v => Math.round(v) + '%', xFmt: v => 'Wk ' + Math.round(v), xTicks: Math.min(6, end - start + (anchor ? 1 : 0)),
    aria: 'odds of sitting in the playoff field after each week'
  });
  const legend = h('div.legend', { style: { marginTop: '8px' } },
    featured.map(t => h('span', h('i', { style: { background: colorOf[t.rosterId] } }), t.name))
      .concat(bg.length ? [h('span', h('i', { style: { background: 'var(--text-muted)', opacity: .3 } }), bg.length + ' more')] : []));
  const tbl = table([
    { k: 'name', h: 'Team', sort: r => r.t.name, f: r => teamCell(r.t) }
  ].concat(Array.from({ length: end - start + 1 }, (_, i) => ({
    k: 'w' + (start + i), h: 'W' + (start + i), num: true,
    sort: r => res.by[r.t.rosterId].fieldAt[start + i],
    f: r => pct(res.by[r.t.rosterId].fieldAt[start + i], 0)
  }))), teams.map(t => ({ t })), {});
  const wt = withTable(h('div', chart, legend), tbl);
  return card('Playoff position, week by week',
    'the share of simulated seasons in which each team is inside the cut with the season paused at that week'
    + (anchor ? ' — week ' + anchor + ' is where the real table stands today' : ''),
    wt.body, wt.btn);
}

/* ---------- seed distribution ---------- */
function simSeedCard(res) {
  const n = S.teams.length;
  const teams = S.teams.slice().sort((a, b) => res.by[a.rosterId].seed - res.by[b.rosterId].seed);
  const cols = Array.from({ length: n }, (_, i) => String(i + 1));
  const grid = heat(teams, cols, (t, c) => res.by[t.rosterId].seedDist[+c] * 100, {
    rowLabel: t => t.name,
    fmt: v => v < 0.5 ? '·' : Math.round(v) + '',
    tip: (t, c, v) => `<div class="k">${t.name} · ${ord(+c)} seed</div><b>${fmt(v, 1)}%</b> of simulated seasons`
      + (+c <= res.playoffTeams ? '<br>inside the playoff cut' : '<br>missed the playoffs')
  });
  return card('Where everyone finishes', 'percentage of simulated seasons ending at each seed — ' + res.playoffTeams + ' make the bracket',
    h('div', grid, h('div', { style: { marginTop: '10px' } }, seqLegend('never', 'often', 'Share of seasons'))));
}

/* ---------- schedule luck and strength ---------- */
function simLuckCard(res) {
  if (!res.simWeeks) return null;
  const rows = S.teams.map(t => ({ t, s: res.by[t.rosterId] })).filter(r => r.s.allPlayPct !== null);
  if (!rows.length) return null;
  const sos = rows.map(r => r.s.sos).filter(v => v !== null);
  const sosMean = sos.length ? mean(sos) : 0;
  const bars = rows.slice().sort((a, b) => b.s.luck - a.s.luck).map(r => ({
    label: r.t.name, v: r.s.luck,
    tip: `<div class="k">${r.t.name}</div>Projected to win <b>${fmt(r.s.simWins, 1)}</b> of the remaining ${res.simWeeks}<br>`
      + `Beats <b>${pct(r.s.allPlayPct, 0)}</b> of the league in a typical week, which is worth ${fmt(r.s.allPlayPct * res.simWeeks, 1)} wins<br>`
      + `Schedule is worth <b>${sgn(r.s.luck, 2)}</b> wins`
  }));
  return card('What the schedule is worth',
    'simulated wins minus the wins that scoring alone earns — blue means the remaining fixtures are doing a team a favour',
    h('div',
      divBar(bars, { labelW: isNarrow() ? '110px' : '170px', dec: 2 }),
      h('div.tiny.muted', { style: { marginTop: '10px' } },
        'A team that beats 60% of the league each week "deserves" 0.6 wins a week. The gap between that and the games it is actually projected to win is the schedule.'),
      table([
        { k: 'name', h: 'Team', sort: r => r.t.name, f: r => teamCell(r.t) },
        { k: 'allplay', h: 'Beats', num: true, tip: 'Share of the league this team outscores in a typical remaining week', sort: r => r.s.allPlayPct, f: r => pct(r.s.allPlayPct, 0) },
        { k: 'w', h: 'Proj W', num: true, sort: r => r.s.simWins, f: r => h('b.mono', fmt(r.s.simWins, 1)) },
        { k: 'luck', h: 'Schedule', num: true, sort: r => r.s.luck, f: r => deltaTag(r.s.luck, 2, ' W') },
        { k: 'sos', prio: 2, h: 'Opponent PPG', num: true, tip: 'Average score the remaining opponents are projected to post', sort: r => r.s.sos || 0, f: r => r.s.sos === null ? '—' : h('span', { class: r.s.sos > sosMean ? 'down mono' : 'up mono' }, fmt(r.s.sos, 1)) },
        { k: 'pf', prio: 2, h: 'Season PF range', num: true, sortable: false, f: r => h('span.tiny.mono.muted', fmt(r.s.ptsP10, 0) + '–' + fmt(r.s.ptsP90, 0)) }
      ], rows, { sortKey: 'luck', sortDir: -1 })));
}

/* ---------- still alive ---------- */
function simAliveCard(res) {
  const start = res.fromWeek, end = S.regEnd;
  if (end - start < 2) return null;
  const rows = S.teams.map(t => {
    const s = res.by[t.rosterId];
    let outWeek = null;
    for (let w = start; w <= end; w++) if (s.aliveAt[w] < 0.5) { outWeek = w; break; }
    return { t, s, outWeek };
  }).sort((a, b) => (b.outWeek === null ? 99 : b.outWeek) - (a.outWeek === null ? 99 : a.outWeek) || b.s.playoff - a.s.playoff);
  const anyOut = rows.some(r => r.outWeek !== null);
  if (!anyOut) return null;
  return card('When the maths runs out',
    'the first week by which more than half the simulations have a team unable to reach the cut line on wins alone',
    table([
      { k: 'name', h: 'Team', sort: r => r.t.name, f: r => teamCell(r.t) },
      { k: 'out', h: 'Out of it by', sort: r => r.outWeek === null ? 99 : r.outWeek, f: r => r.outWeek === null ? h('span.tag', { style: { borderColor: 'var(--good)', color: 'var(--good-text)' } }, 'alive all season') : h('b', 'week ' + r.outWeek) },
      { k: 'playoff', h: 'Playoffs', num: true, sort: r => r.s.playoff, f: r => pct(r.s.playoff, 0) },
      { k: 'alive', prio: 2, h: 'Alive at the end', num: true, sort: r => r.s.aliveAt[S.regEnd], f: r => pct(r.s.aliveAt[S.regEnd], 0) }
    ], rows, { sortKey: 'out', sortDir: -1 }));
}

/* ---------- the week ranked: close games, mismatches, upsets ---------- */
function simWeekRankCard(res) {
  const games = (schedule()[res.onlyWeek - 1] || []);
  if (games.length < 2) return null;
  const rows = games.map(([a, b]) => {
    const A = S.teamById[a], B = S.teamById[b], ra = res.by[a], rb = res.by[b];
    if (!A || !B || !ra || !rb) return null;
    // the two score arrays are run-for-run aligned, so the margin needs no extra simulation
    const n = Math.min(ra.weekScores.length, rb.weekScores.length);
    const m = new Array(n);
    for (let i = 0; i < n; i++) m[i] = ra.weekScores[i] - rb.weekScores[i];
    m.sort((x, y) => x - y);
    const q = (p) => m[clamp(Math.floor(p * (n - 1)), 0, n - 1)];
    const favA = ra.weekWin >= rb.weekWin;
    return {
      A, B, ra, rb, favA,
      fav: favA ? A : B, dog: favA ? B : A,
      favP: Math.max(ra.weekWin, rb.weekWin),
      margin: Math.abs(q(0.5)),
      close: m.filter(x => Math.abs(x) <= 10).length / n,
      swing: Math.abs(ra.weekWin - rb.weekWin)
    };
  }).filter(Boolean);
  if (!rows.length) return null;
  const tightest = rows.slice().sort((x, y) => x.swing - y.swing)[0];
  const widest = rows.slice().sort((x, y) => y.swing - x.swing)[0];
  return card('The week at a glance',
    `closest game: ${tightest.A.short} v ${tightest.B.short} · biggest mismatch: ${widest.fav.short} over ${widest.dog.short}`,
    table([
      { k: 'game', h: 'Matchup', sortable: false, f: r => h('div.row', { style: { gap: '5px', minWidth: 0 } },
        h('b.tiny', r.fav.short), h('span.tiny.muted', 'v'), h('span.tiny', r.dog.short)) },
      { k: 'fav', h: 'Favourite', sortable: false, prio: 2, f: r => teamCell(r.fav, { sub: false }) },
      { k: 'p', h: 'Win prob', num: true, sort: r => r.favP, f: r => h('b.mono', pct(r.favP, 0)) },
      { k: 'margin', h: 'Median margin', num: true, sort: r => r.margin, f: r => h('span.mono', fmt(r.margin, 1)) },
      { k: 'close', h: 'One-score', num: true, tip: 'Chance the game finishes within ten points', sort: r => r.close, f: r => pct(r.close, 0) },
      { k: 'upset', h: 'Upset', num: true, sort: r => 1 - r.favP, f: r => {
        const u = 1 - r.favP;
        return h('span', { class: u > 0.4 ? 'up mono' : 'mono muted' }, pct(u, 0));
      } }
    ], rows, { sortKey: 'p', sortDir: 1 }));
}

