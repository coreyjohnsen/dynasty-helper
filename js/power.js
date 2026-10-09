"use strict";
/* ================= 3. POWER RANKINGS ================= */
const PowerUI = { mode: 'now' };
function viewPower() {
  if (!isDynasty() && PowerUI.mode === 'future') PowerUI.mode = 'now';
  const teams = S.teams.slice();
  const wrap = h('div.grid');

  wrap.appendChild(h('div.row', { style: { justifyContent: 'space-between' } },
    segmented(isDynasty()
      ? [{ k: 'now', label: 'This season' }, { k: 'future', label: 'Future' }, { k: 'pos', label: 'By position' }]
      : [{ k: 'now', label: 'This season' }, { k: 'pos', label: 'By position' }],
      PowerUI.mode, m => { PowerUI.mode = m; render(); }),
    h('span.tiny.muted', S.gamesPlayed
      ? `Week ${S.lastWeek} complete — rating is ${pct(S.blendW, 0)} results, ${pct(1 - S.blendW, 0)} projection`
      : 'Preseason — rating is 100% projection')));

  if (PowerUI.mode === 'pos') return wrap.appendChild(powerByPosition()), wrap;
  // The first look runs a few thousand simulated seasons, which holds the page for about half a second. Show the
  // page at once with a note, and run the simulation just after it has painted. (The tab above never needs it.)
  if (!S.sim) {
    setTimeout(() => { if (!S.sim) S.sim = simulate(S.simN); if (S.view === 'power') render(); }, 40);
    wrap.appendChild(card('Power rankings', 'blended rating, then simulated playoff and championship odds',
      h('div.empty', { style: { padding: '34px 18px' } }, h('span.spin'), h('div', { style: { marginTop: '10px' } }, 'Simulating ' + kfmt(S.simN) + ' seasons…'))));
    return wrap;
  }
  const sim = S.sim;
  // a redraft league has no second timeline to rank, so that tab does not exist
  const future = PowerUI.mode === 'future' && isDynasty();
  const key = future ? 'futurePower' : 'power';
  teams.sort((a, b) => b[key] - a[key]);

  const rows = teams.map((t, i) => {
    const s = sim.by[t.rosterId] || {};
    return {
      i: i + 1, t, s,
      rating: t[key],
      move: future ? null : (t.projZ !== null && t.actualZ !== null ? null : null)
    };
  });

  if (!future) {
    const top = rows.slice().sort((a, b) => b.s.title - a.s.title)[0];
    wrap.appendChild(h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(min(160px,100%),1fr))' } },
      kpi('Title favorite', top.t.name, pct(top.s.title, 1) + ' championship odds',
        '<div class="k">Highest championship odds</div>Not always the top power rating — power weights results already banked, while title odds come from simulating the games left.'),
      kpi('Playoff spots', String(sim.playoffTeams), `of ${teams.length} teams`),
      kpi('Simulations', kfmt(sim.n), `weeks ${Math.min(S.lastWeek + 1, S.regEnd)}–${S.regEnd} + bracket`),
      kpi('Locks', String(rows.filter(r => r.s.playoff >= 0.9).length), 'teams above 90% playoff odds'),
      kpi('Live races', String(rows.filter(r => r.s.playoff > 0.15 && r.s.playoff < 0.85).length), 'teams between 15% and 85%')
    ));
  }

  const cols = [
    { k: 'i', h: '#', num: true, f: r => h('b.mono', r.i), sortable: false },
    { k: 'name', h: 'Team', sort: r => r.t.name, f: r => teamCell(r.t) },
    isDynasty() ? { k: 'window', prio: 2, h: 'Window', sort: r => r.t.window, f: r => h('span.tag', r.t.window) } : null,
    {
      k: 'rating', h: (future ? 'Future' : 'Power') + (isNarrow() ? '' : ' rating'), num: true,
      // the bar is 70px of a 390px screen; the number carries the same information
      f: r => h('div.meter', { style: { justifyContent: 'flex-end' } },
        isNarrow() ? null : h('div.bar-track', { style: { width: '70px' } }, h('div.bar-fill', { style: { width: clamp((r.rating - 20) / 60 * 100, 3, 100) + '%', background: r.i <= 3 ? 'var(--s1)' : 'var(--seq-300)' } })),
        h('b.mono', fmt(r.rating, 1)))
    },
    { k: 'proj', prio: 2, h: 'Proj lineup', num: true, tip: 'Projected points per week from the optimal lineup', f: r => fmt(future ? r.t.future : r.t.now, 1) },
    { k: 'value', prio: 2, h: isDynasty() ? 'Capital' : 'Value', num: true, tip: isDynasty() ? 'Total dynasty trade value incl. picks' : 'Total redraft trade value of the roster', f: r => kfmt(Math.round(r.t.totalValue)) },
    { k: 'rec', prio: 2, h: 'Record', sort: r => r.t.winPct === null ? -1 : r.t.winPct, f: r => `${r.t.wins}-${r.t.losses}${r.t.ties ? '-' + r.t.ties : ''}` },
    { k: 'pwins', prio: 2, h: 'Proj W', num: true, tip: 'Projected final regular-season wins', f: r => fmt(r.s.wins, 1) },
    {
      k: 'playoff', h: 'Playoffs', num: true, sort: r => r.s.playoff,
      f: r => h('div.meter', { style: { justifyContent: 'flex-end' } },
        isNarrow() ? null : h('div.bar-track', { style: { width: '54px' } }, h('div.bar-fill', { style: { width: (r.s.playoff * 100) + '%', background: r.s.playoff > .6 ? 'var(--good)' : r.s.playoff > .25 ? 'var(--s4)' : 'var(--s8)' } })),
        h('span.mono', { style: isNarrow() ? { color: r.s.playoff > .6 ? 'var(--good-text)' : r.s.playoff < .25 ? 'var(--bad-text)' : null, fontWeight: 620 } : null }, pct(r.s.playoff, 0)))
    },
    { k: 'bye', prio: 2, h: 'Bye', num: true, sort: r => r.s.bye, f: r => pct(r.s.bye, 0) },
    { k: 'title', h: 'Title', num: true, sort: r => r.s.title, f: r => h('b.mono', { style: { color: r.s.title > .18 ? 'var(--good-text)' : null } }, pct(r.s.title, 1)) }
  ];
  if (HYP.on && HYP.base && hypCount()) {
    cols.push({
      k: 'vsreal', h: 'vs actual', num: true, tip: 'Change against the real league, same simulation seed',
      sort: r => r.rating - (future ? HYP.base[r.t.rosterId].futurePower : HYP.base[r.t.rosterId].power),
      f: r => {
        const was = future ? HYP.base[r.t.rosterId].futurePower : HYP.base[r.t.rosterId].power;
        return Math.abs(r.rating - was) < 0.05 ? h('span.flat.tiny', '–') : deltaTag(r.rating - was, 1);
      }
    });
  }
  /* Simple mode reads the table back as a leaderboard: badge, name, one bar and
     the two numbers anyone actually quotes. */
  const rankList = () => h('div', rows.map(r => {
    const t = r.t;
    return h('div.rankrow', { style: { cursor: 'pointer' }, onclick: () => { RosterUI.team = t.rosterId; S.view = 'roster'; render(); window.scrollTo(0, 0); } },
      h('div.pos', r.i),
      h('div.row', { style: { gap: '11px', minWidth: 0 } },
        t.avatar ? h('img.avatar', { src: t.avatar, alt: '', loading: 'lazy', onerror: e => e.target.style.visibility = 'hidden' }) : h('div.avatar'),
        h('div', { style: { minWidth: 0 } },
          h('div', { style: { fontWeight: 620, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t.name),
          h('div.tiny.muted', (t.window ? t.window + ' · ' : '') + t.wins + '-' + t.losses))),
      h('div.hidenarrow',
        h('div.bar-track', { style: { height: '9px' } },
          h('div.bar-fill', { style: { width: clamp((r.rating - 20) / 60 * 100, 4, 100) + '%', background: r.i <= 3 ? 'var(--s1)' : 'var(--seq-300)' } })),
        h('div.tiny.muted', { style: { marginTop: '3px' } }, fmt(r.rating, 1) + ' rating')),
      // the two numbers the dense table shows that this view was dropping
      h('div.rankstats.hidenarrow',
        bindTT(h('div', h('b.mono', fmt(future ? t.future : t.now, 1)), h('div.tiny.muted', 'proj pts/wk')),
          `<div class="k">Projected lineup</div>Points per week from the best legal lineup on this roster.`),
        bindTT(h('div', h('b.mono', kfmt(Math.round(t.totalValue))), h('div.tiny.muted', isDynasty() ? 'capital' : 'value')),
          `<div class="k">${capitalLabel()}</div>` + (isDynasty()
            ? `Players <b>${kfmt(Math.round(t.rosterValue))}</b> plus picks <b>${kfmt(Math.round(t.pickCapital))}</b>`
            : 'Every rostered player at today’s redraft market.'))),
      h('div', { style: { textAlign: 'right' } },
        h('b.mono', { style: { fontSize: '16px' } }, r.s ? pct(r.s.playoff, 0) : fmt(r.rating, 1)),
        h('div.tiny.muted', r.s ? 'playoffs · ' + pct(r.s.title, 1) + ' title' : 'rating')));
  }));
  wrap.appendChild(card(future ? 'Future power rankings' : 'Power rankings',
    future ? '2–3 years out: age-adjusted lineup value plus draft capital' : 'blended rating, then simulated playoff and championship odds',
    isSimple() ? rankList() : table(cols, rows, { sortKey: 'rating', sortDir: -1 })));

  if (!future) {
    // odds composition + weekly trajectory
    const oddsRows = rows.map(r => h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,150px) minmax(0,1fr) auto', gap: '9px', alignItems: 'center', padding: '2px 0' } },
      h('div.tiny', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.t.name),
      oddsBar([
        { v: r.s.title, color: 'var(--seq-650)', tip: `<div class="k">${r.t.name}</div>Wins it all: <b>${pct(r.s.title, 1)}</b>` },
        { v: Math.max(0, r.s.final - r.s.title), color: 'var(--seq-450)', tip: `<div class="k">${r.t.name}</div>Loses the final: <b>${pct(r.s.final - r.s.title, 1)}</b>` },
        { v: Math.max(0, r.s.semi - r.s.final), color: 'var(--seq-300)', tip: `<div class="k">${r.t.name}</div>Out in the semis: <b>${pct(r.s.semi - r.s.final, 1)}</b>` },
        { v: Math.max(0, r.s.playoff - r.s.semi), color: 'var(--seq-150)', tip: `<div class="k">${r.t.name}</div>Out in round 1: <b>${pct(r.s.playoff - r.s.semi, 1)}</b>` },
        { v: Math.max(0, 1 - r.s.playoff), color: 'var(--div-neutral)', tip: `<div class="k">${r.t.name}</div>Misses the playoffs: <b>${pct(1 - r.s.playoff, 1)}</b>` }
      ], { h: 11 }),
      h('span.tiny.mono.sec', { style: { textAlign: 'right' } }, pct(r.s.playoff, 0) + ' / ' + pct(r.s.title, 1))));
    wrap.appendChild(card('How each season ends', sim.n.toLocaleString() + ' simulations',
      h('div', { style: { display: 'grid', gap: '3px' } }, oddsRows,
        h('div.legend', { style: { marginTop: '10px' } },
          [['Champion', 'var(--seq-650)'], ['Lost final', 'var(--seq-450)'], ['Lost semi', 'var(--seq-300)'], ['Lost round 1', 'var(--seq-150)'], ['Missed', 'var(--div-neutral)']]
            .map(([n, c]) => h('span', h('i', { style: { background: c } }), n))),
        h('div.tiny.muted', { style: { marginTop: '6px' } }, 'Right column: playoff odds / title odds.'))));

    if (S.lastWeek >= 2) wrap.appendChild(weeklyTrajectory());
  } else {
    wrap.appendChild(h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(min(320px,100%),1fr))' } },
      proOnly(dynOnly(card('Contend vs. build', 'each team’s two-axis position', contendMatrix()))),
      card('Draft capital', 'total value of picks held', barList(
        S.teams.slice().sort((a, b) => b.pickCapital - a.pickCapital).map(t => ({
          label: t.name, v: t.pickCapital, vl: kfmt(Math.round(t.pickCapital)),
          tip: `<div class="k">${t.name}</div>` + (t.pickAssets.length ? t.pickAssets.slice(0, 12).map(p => `${p.label} — <b>${kfmt(Math.round(p.value))}</b>`).join('<br>') : 'No future picks')
        })), { labelW: '150px', dec: 0 })))
    );
  }
  return wrap;
}
function weeklyTrajectory() {
  const teams = S.teams.slice().sort((a, b) => a.powerRank - b.powerRank);
  const shown = teams.slice(0, 3).concat(teams.slice(-1));
  const colors = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s8)'];
  const series = shown.map((t, i) => ({
    name: t.short, color: colors[i],
    points: t.weekly.map((v, w) => v === null || v <= 0 ? null : ({ x: w + 1, y: v, label: 'Week ' + (w + 1) })).filter(Boolean)
  })).filter(s => s.points.length);
  const rows = teams.map(t => ({ t, ...t }));
  const tbl = table([
    { k: 'name', h: 'Team', sort: r => r.t.name, f: r => r.t.name },
    ...Array.from({ length: S.lastWeek }, (_, i) => ({ k: 'w' + (i + 1), h: 'W' + (i + 1), num: true, sort: r => r.t.weekly[i] || 0, f: r => r.t.weekly[i] ? fmt(r.t.weekly[i], 1) : '—' })),
    { k: 'avg', h: 'Avg', num: true, sort: r => r.t.avgPts, f: r => h('b.mono', fmt(r.t.avgPts, 1)) }
  ], rows, { sortKey: 'avg', sortDir: -1 });
  const wt = withTable(h('div', lineChart(series, { h: 240, yFmt: v => fmt(v, 0), xFmt: v => 'Wk ' + fmt(v, 0), xTicks: Math.min(S.lastWeek - 1, 8), aria: 'weekly scores' }),
    h('div.legend', { style: { marginTop: '8px' } }, shown.map((t, i) => h('span', h('i', { style: { background: colors[i] } }), t.name)))), tbl);
  return card('Weekly scoring', 'top three and the cellar — every team is in the table view', wt.body, wt.btn);
}
function contendMatrix() {
  const teams = S.teams;
  const W = 560, H = 330, m = { t: 14, r: 16, b: 34, l: 44 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const xs = teams.map(t => t.powerZ), ys = teams.map(t => t.futureZ);
  const xr = Math.max(1.6, Math.max(...xs.map(Math.abs)) * 1.15), yr = Math.max(1.6, Math.max(...ys.map(Math.abs)) * 1.15);
  const X = v => m.l + (v + xr) / (2 * xr) * iw, Y = v => m.t + ih - (v + yr) / (2 * yr) * ih;
  const g = svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'contend versus build scatter' });
  g.style.height = H + 'px';
  g.appendChild(svg('rect', { x: X(0), y: m.t, width: iw / 2, height: ih / 2, fill: 'var(--s1)', opacity: .05 }));
  g.appendChild(svg('line', { class: 'gl', x1: X(0), x2: X(0), y1: m.t, y2: m.t + ih }));
  g.appendChild(svg('line', { class: 'gl', x1: m.l, x2: W - m.r, y1: Y(0), y2: Y(0) }));
  [['Contend now', X(0) + 8, m.t + 14, 'start'], ['Rebuild', m.l + 8, m.t + ih - 8, 'start'], ['Win-now, thin future', X(0) + 8, m.t + ih - 8, 'start'], ['Young, not ready', m.l + 8, m.t + 14, 'start']]
    .forEach(([tx, x, y, a]) => { const t = svg('text', { class: 'ax', x, y, 'text-anchor': a, opacity: .8 }); t.textContent = tx; g.appendChild(t); });
  teams.forEach(t => {
    const c = svg('circle', { cx: X(t.powerZ), cy: Y(t.futureZ), r: 6.5, fill: 'var(--s1)', stroke: 'var(--surface-1)', 'stroke-width': 2 });
    const hit = svg('circle', { cx: X(t.powerZ), cy: Y(t.futureZ), r: 14, fill: 'transparent' });
    hit.addEventListener('mousemove', e => ttShow(e, `<div class="k">${t.name}</div>Now <b>${fmt(t.power, 1)}</b> (#${t.powerRank})<br>Future <b>${fmt(t.futurePower, 1)}</b> (#${t.futureRank})<br>Window <b>${t.window}</b>`));
    hit.addEventListener('mouseleave', ttHide);
    const lb = svg('text', { class: 'ax', x: X(t.powerZ), y: Y(t.futureZ) - 10, 'text-anchor': 'middle', fill: 'var(--text-secondary)', 'font-weight': 600 });
    lb.textContent = t.short;
    g.appendChild(c); g.appendChild(lb); g.appendChild(hit);
  });
  const xl = svg('text', { class: 'ax', x: m.l + iw / 2, y: H - 8, 'text-anchor': 'middle' }); xl.textContent = 'Win now  →';
  const yl = svg('text', { class: 'ax', x: 12, y: m.t + ih / 2, 'text-anchor': 'middle', transform: `rotate(-90 12 ${m.t + ih / 2})` }); yl.textContent = 'Future  →';
  g.appendChild(xl); g.appendChild(yl);
  return g;
}
function powerByPosition() {
  const teams = S.teams.slice().sort((a, b) => a.powerRank - b.powerRank);
  const wrap = h('div.grid');
  wrap.appendChild(card('Positional strength — current starters', 'projected points per week from each position group',
    h('div', heat(teams, POS4, (t, p) => t.posNow[p], {
      rowLabel: t => t.name, fmt: v => fmt(v, 1),
      tip: (t, p, v) => `<div class="k">${t.name} · ${p}</div>Starters produce <b>${fmt(v, 1)}</b> pts/wk — ${ord(t.posNow[p + 'Rank'])} of ${teams.length}`
    }), h('div', { style: { marginTop: '10px' } }, seqLegend('weakest', 'strongest', 'Points per week')))));
  wrap.appendChild(card('Positional ' + valueWord() + ' value', 'total trade value at each position, all rostered players',
    h('div', heat(teams, POS4, (t, p) => t.posValue[p], {
      rowLabel: t => t.name, fmt: v => kfmt(Math.round(v)),
      tip: (t, p, v) => `<div class="k">${t.name} · ${p}</div>Value <b>${kfmt(Math.round(v))}</b> — ${ord(t.posValue[p + 'Rank'])} of ${teams.length}`
    }), h('div', { style: { marginTop: '10px' } }, seqLegend('weakest', 'strongest', isDynasty() ? 'Dynasty value' : 'Redraft value')))));
  const cols = [{ k: 'name', h: 'Team', sort: r => r.name, f: r => teamCell(r, { sub: false }) }];
  POS4.forEach(p => {
    cols.push({ k: p + 'n', h: p + ' pts', num: true, sort: r => r.posNow[p], f: r => fmt(r.posNow[p], 1) });
    // on a phone the eight-column cross-tab becomes the four points columns; the
    // value half is what the heat map directly above already shows
    cols.push({ k: p + 'v', prio: 2, h: p + ' val', num: true, sort: r => r.posValue[p], f: r => h('span', kfmt(Math.round(r.posValue[p])), h('span.tiny.muted', ' ' + ord(r.posValue[p + 'Rank']))) });
  });
  const posTbl = proOnly(card('Position table', 'every number above, sortable', table(cols, teams, { sortKey: 'QBv', sortDir: -1 })));
  if (posTbl) wrap.appendChild(posTbl);
  return wrap;
}

