"use strict";
/* ================= 4. ACTIVE RANKINGS (pure results) ================= */
function viewStandings() {
  const teams = S.teams.slice();
  const wrap = h('div.grid');
  if (!S.gamesPlayed) {
    wrap.appendChild(card('Active rankings', null, h('div.empty',
      h('div', { style: { fontSize: '15px', fontWeight: 600, color: 'var(--text-secondary)' } }, 'No games played yet'),
      h('div.tiny', { style: { marginTop: '6px' } }, 'This view is pure results — wins, losses and points actually scored. It fills in from week 1 onward. Until then, Power Rankings has the projections.'))));
    return wrap;
  }
  teams.sort((a, b) => (b.wins - a.wins) || (b.fpts - a.fpts));
  const lucky = teams.slice().sort((a, b) => (b.luck || 0) - (a.luck || 0));

  wrap.appendChild(h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(min(160px,100%),1fr))' } },
    kpi('Best record', teams[0].name, `${teams[0].wins}-${teams[0].losses}${teams[0].ties ? '-' + teams[0].ties : ''}`),
    kpi('Most points', teams.slice().sort((a, b) => b.fpts - a.fpts)[0].name, fmt(Math.max(...teams.map(t => t.fpts)), 1) + ' PF'),
    kpi('Luckiest', lucky[0].name, sgn(lucky[0].luck, 1) + ' wins vs. expected', '<div class="k">Luck</div>Actual wins minus wins expected from an all-play record — how the schedule treated them.'),
    kpi('Unluckiest', lucky[lucky.length - 1].name, sgn(lucky[lucky.length - 1].luck, 1) + ' wins vs. expected'),
    kpi('Weeks played', String(S.lastWeek), `of ${S.regEnd} regular season`)
  ));

  const cols = [
    { k: 'rk', h: '#', num: true, sortable: false, f: (r, i) => h('b.mono', i + 1) },
    { k: 'name', h: 'Team', sort: r => r.name, f: r => teamCell(r) },
    { k: 'wins', h: 'W', num: true, f: r => h('b.mono', r.wins) },
    { k: 'losses', h: 'L', num: true },
    { k: 'winPct', prio: 2, h: 'Pct', num: true, f: r => r.winPct === null ? '—' : r.winPct.toFixed(3).replace(/^0/, '') },
    { k: 'fpts', h: 'PF', num: true, f: r => fmt(r.fpts, 1) },
    { k: 'fptsAgainst', prio: 2, keepSimple: true, h: 'PA', num: true, f: r => fmt(r.fptsAgainst, 1) },
    { k: 'diff', prio: 2, h: 'Diff', num: true, sort: r => r.fpts - r.fptsAgainst, f: r => h('span', { class: r.fpts - r.fptsAgainst >= 0 ? 'up mono' : 'down mono' }, sgn(r.fpts - r.fptsAgainst, 1)) },
    { k: 'avgPts', h: 'PPG', num: true, f: r => fmt(r.avgPts, 1) },
    { k: 'ptsSd', prio: 2, h: 'Volatility', num: true, tip: 'Standard deviation of weekly scores — high means boom/bust', f: r => fmt(r.ptsSd, 1) },
    { k: 'allPlay', prio: 2, h: 'All-play', num: true, tip: 'Record if every team played every other team each week', f: r => r.allPlay === null ? '—' : h('span', h('b.mono', pct(r.allPlay, 1)), h('span.tiny.muted', ` ${r.apW}-${r.apL}`)) },
    { k: 'luck', prio: 2, keepSimple: true, h: 'Luck', num: true, tip: 'Wins above or below what the all-play record predicts', f: r => r.luck === null ? '—' : deltaTag(r.luck, 1, ' W') },
    { k: 'maxPts', prio: 2, keepSimple: true, h: 'Efficiency', num: true, tip: 'Points scored as a share of the best possible lineup each week', sort: r => r.maxPts ? r.fpts / r.maxPts : 0, f: r => r.maxPts ? pct(r.fpts / r.maxPts, 1) : '—' },
    { k: 'spark', prio: 2, h: 'Form', sortable: false, f: r => sparkline(r.weekly.filter(v => v !== null && v > 0).map(v => ({ v })), { w: 74, h: 22 }) }
  ];
  wrap.appendChild(card('Active rankings',
    'pure results — every number here comes from weeks that are over'
    + (S.liveWeek ? '. Week ' + S.liveWeek + ' is still being played and is not in these totals; the live column below tracks it separately.' : ''),
    table(cols, teams, { sortKey: 'wins', sortDir: -1 })));

  /* The week in progress does not belong in a results table, but it is the thing
     everyone actually wants to look at, so it gets its own. */
  if (S.liveWeek) {
    const live = S.teams.map(t => {
      const l = liveRoster(t, S.liveWeek);
      const g = (schedule()[S.liveWeek - 1] || []).find(x => x.includes(t.rosterId));
      const oppId = g ? (g[0] === t.rosterId ? g[1] : g[0]) : null;
      return { t, l, opp: oppId ? S.teamById[oppId] : null, oppL: oppId ? liveRoster(S.teamById[oppId], S.liveWeek) : null };
    });
    wrap.appendChild(card('Week ' + S.liveWeek + ' as it stands',
      'points already scored, with everyone who has not finished counted at their projection',
      table([
        { k: 'name', h: 'Team', sort: r => r.t.name, f: r => teamCell(r.t) },
        { k: 'opp', prio: 2, h: 'Opponent', sortable: false, f: r => r.opp ? h('span.tiny', r.opp.short) : h('span.muted.tiny', 'bye') },
        { k: 'scored', h: 'Scored', num: true, sort: r => r.l.banked, f: r => h('b.mono', fmt(r.l.banked, 1)) },
        { k: 'proj', h: 'Still to come', num: true, sort: r => r.l.projected, f: r => h('span.mono.muted', '+' + fmt(r.l.projected, 1)) },
        { k: 'total', h: 'Live total', num: true, sort: r => r.l.total, f: r => h('b.mono', fmt(r.l.total, 1)) },
        { k: 'left', prio: 2, h: 'Yet to play', num: true, sort: r => r.l.leftN + r.l.liveN, f: r => h('span.mono', (r.l.leftN + r.l.liveN) + ' of ' + r.l.rows.length) },
        {
          k: 'lead', h: 'Margin', num: true, sort: r => r.oppL ? r.l.total - r.oppL.total : -999,
          f: r => r.oppL ? deltaTag(r.l.total - r.oppL.total, 1) : h('span.muted', '—')
        }
      ], live, { sortKey: 'total', sortDir: -1 }),
      h('button.btn.sm', { onclick: () => { S.view = 'week'; render(); window.scrollTo(0, 0); } }, 'Open This Week →')));
  }

  wrap.appendChild(h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(min(330px,100%),1fr))' } },
    card('Schedule luck', 'actual wins minus all-play expected wins',
      divBar(lucky.map(t => ({ label: t.name, v: t.luck, vl: sgn(t.luck, 1) + ' W', tip: `<div class="k">${t.name}</div>Actual <b>${t.wins + 0.5 * t.ties}</b> wins<br>Expected <b>${fmt(t.expWins, 1)}</b> from all-play<br>All-play record <b>${t.apW}-${t.apL}</b>` })), { dec: 1 })),
    card('Points for', 'total scored this season',
      barList(teams.slice().sort((a, b) => b.fpts - a.fpts).map(t => ({
        label: t.name, v: t.fpts, vl: fmt(t.fpts, 0),
        tip: `<div class="k">${t.name}</div>PF <b>${fmt(t.fpts, 1)}</b> · PA <b>${fmt(t.fptsAgainst, 1)}</b><br>PPG <b>${fmt(t.avgPts, 1)}</b> ± ${fmt(t.ptsSd, 1)}`
      })), { labelW: '150px', dec: 0 }))
  ));
  return wrap;
}


/** In the what-if, the roster page shows the roster as it would be — and this
 *  says, in one place, what is different from the real one: who arrived, who
 *  left and where they went, each with an undo. */
function hypRosterChanges(t) {
  if (!HYP.on || !S.base) return null;
  // the sandbox bar at the top of the page already lists your own moves, with
  // undo, whether or not the editor is open — repeating them underneath adds
  // nothing. Where this earns its place is on the OTHER side of a deal: open
  // their roster and it says what they gave up and what they got.
  if (t.rosterId === hypTeamId()) return null;
  const into = [], outOf = [];
  Object.keys(HYP.moves).forEach(id => {
    const from = S.base.own[id], to = HYP.moves[id];
    if (to === t.rosterId && from !== t.rosterId) into.push({ id, from, kind: 'player' });
    if (from === t.rosterId && to !== t.rosterId) outOf.push({ id, to, kind: 'player' });
  });
  Object.keys(HYP.picks || {}).forEach(k => {
    const from = S.base.pickOwn[k], to = HYP.picks[k];
    if (to === t.rosterId && from !== t.rosterId) into.push({ id: k, from, kind: 'pick' });
    if (from === t.rosterId && to !== t.rosterId) outOf.push({ id: k, to, kind: 'pick' });
  });
  if (!into.length && !outOf.length) return null;

  const who = (rid) => rid === null || rid === undefined ? 'free agency' : ((S.teamById[rid] || {}).name || '?');
  const label = (x) => {
    if (x.kind === 'pick') { const [yr, rd, orig] = x.id.split('|'); return yr + ' ' + (ROUND_WORD[+rd] || rd + 'th') + ' (' + ((S.teamById[+orig] || {}).short || '?') + ')'; }
    const p = S.index[x.id] || ensurePlayer(x.id);
    return p.name;
  };
  const undo = (x) => h('button.btn.sm', {
    title: 'Put it back where it was',
    onclick: () => {
      if (x.kind === 'pick') delete HYP.picks[x.id]; else delete HYP.moves[x.id];
      HYP.after = null; hypSync(); render();
    }
  }, 'Undo');
  const line = (x, dir) => {
    const p = x.kind === 'player' ? (S.index[x.id] || ensurePlayer(x.id)) : null;
    return h('div.hypline.' + dir,
      h('span.hypdir', dir === 'in' ? 'IN' : 'OUT'),
      p ? (isSimple() ? playerFace(p, { sm: true }) : posPill(p.pos)) : posPill('PICK'),
      h('span.hypnm', p ? pname(p, { face: false }) : label(x)),
      h('span.tiny.muted', dir === 'in' ? 'from ' + who(x.from) : 'to ' + who(x.to)),
      p ? h('span.mono.tiny', { style: { marginLeft: 'auto' } }, kfmt(Math.round(p.dv || 0))) : h('span', { style: { marginLeft: 'auto' } }),
      undo(x));
  };
  return card('What-if changes to this roster', into.length + ' in · ' + outOf.length + ' out — the roster below is shown as it would be',
    h('div', { style: { display: 'grid', gap: '6px' } },
      into.map(x => line(x, 'in')), outOf.map(x => line(x, 'out'))));
}
