"use strict";
/* ================= 8. STOCK MODE ================= */
const StockUI = { kind: 'player', id: null, q: '', range: 90, lines: 'index', pickOpen: false, pst: { q: '', pos: 'all', limit: 24 } };
function viewStock() {
  const wrap = h('div.grid');
  const isTeam = StockUI.kind === 'team';
  const universe = Object.values(S.index).filter(p => p.dv > 200).sort((a, b) => b.dv - a.dv);
  if (StockUI.id === null) StockUI.id = isTeam ? S.teams[0].rosterId : (universe[0] || {}).id;

  const ownerOfP = {}; S.teams.forEach(t => t.players.forEach(p => ownerOfP[p.id] = t));
  const pickedP = isTeam ? null : S.index[StockUI.id];
  const playerPick = isTeam ? null : h('div', { style: { display: 'grid', gap: '10px', flex: '1 1 260px', minWidth: 0, maxWidth: '100%', gridTemplateColumns: 'minmax(0,1fr)' } },
    pickedP ? assetCard(assetOfPlayer(pickedP), {
      compact: true, meta: (ownerOfP[pickedP.id] ? ownerOfP[pickedP.id].short : 'Free agent') + ' · ' + assetMeta(assetOfPlayer(pickedP)),
      action: h('button.btn.sm', { onclick: () => { StockUI.pickOpen = !StockUI.pickOpen; render(); } },
        isNarrow() ? null : ico(StockUI.pickOpen ? 'chevup' : 'finder'), StockUI.pickOpen ? 'Close' : 'Change')
    }) : null);
  wrap.appendChild(card('Pick a ticker', null, h('div', { style: { display: 'grid', gap: '14px', gridTemplateColumns: 'minmax(0,1fr)' } },
    h('div.row', { style: { gap: '14px', alignItems: 'flex-end' } },
      h('label.fld', 'Type', segmented([{ k: 'player', label: 'Players' }, { k: 'team', label: 'Teams' }], StockUI.kind,
        k => { StockUI.kind = k; StockUI.pickOpen = false; StockUI.id = k === 'team' ? S.teams[0].rosterId : universe[0].id; render(); })),
      isTeam
        ? h('label.fld', { style: { minWidth: '260px' } }, 'Team', h('select', { onchange: e => { StockUI.id = +e.target.value; render(); } },
          S.teams.map(t => h('option', { value: t.rosterId, selected: t.rosterId === StockUI.id }, t.name))))
        : playerPick,
      h('label.fld', 'Window', segmented([{ k: 30, label: '30d' }, { k: 90, label: '90d' }, { k: 180, label: '6m' }], StockUI.range, r => { StockUI.range = r; render(); })),
      isTeam ? null : h('label.fld', ' ', h('button.btn.sm', { onclick: () => openPlayer(StockUI.id, 'stock') }, 'Player page →'))),
    !isTeam && StockUI.pickOpen ? assetBrowser({
      id: 'sbrowse', color: 'a', st: StockUI.pst, step: 24, picks: false, posOpts: ['all', 'QB', 'RB', 'WR', 'TE'],
      title: 'Choose a player', note: 'tap anyone to chart their trade value',
      assets: universe.map(assetOfPlayer), chosen: new Set([StockUI.id]),
      meta: a => (ownerOfP[a.id] ? ownerOfP[a.id].short : 'FA') + ' · ' + assetMeta(a), placeholder: 'Search players…',
      onToggle: a => { StockUI.id = a.id; StockUI.pickOpen = false; render(); }, onChange: () => render()
    }) : null)));

  const series = isTeam ? teamSeries(StockUI.id, StockUI.range) : playerSeries(StockUI.id, StockUI.range);
  const subject = isTeam ? S.teamById[StockUI.id] : S.index[StockUI.id];
  if (!subject || !series.length) return wrap.appendChild(card(null, null, h('div.empty', 'No value history for this selection.'))), wrap;
  const first = series[0].v, last = series[series.length - 1].v;
  const chg = last - first, chgPct = first ? chg / first : 0;
  const observed = series.filter(s => s.real).length;
  const hi = Math.max(...series.map(s => s.v)), lo = Math.min(...series.map(s => s.v));

  wrap.appendChild(h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(min(150px,100%),1fr))' } },
    kpi(isTeam ? 'Franchise value' : 'Trade value', kfmt(last), (isTeam ? subject.name : subject.name)),
    kpi(StockUI.range + '-day change', sgn(chg, 0), sgn(chgPct * 100, 1) + '%'),
    kpi('30-day trend', isTeam ? sgn(sum(subject.players.map(p => p.trend30 || 0)), 0) : sgn(subject.trend30 || 0, 0), 'from FantasyCalc'),
    kpi('Range', kfmt(lo) + '–' + kfmt(hi), 'low to high in window'),
    isTeam ? kpi('League rank', '#' + subject.valueRank, 'by ' + (isDynasty() ? 'dynasty capital' : 'roster value'))
      : kpi('Position rank', (subject.pos || '') + (subject.posRank || '—'), 'overall #' + (subject.rank || '—'))
  ));

  const chart = lineChart([{
    name: isTeam ? subject.name : subject.name, color: chg >= 0 ? 'var(--s1)' : 'var(--s8)', area: true,
    points: series.map((s, i) => ({ x: i, y: s.v, label: new Date(s.d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }))
  }], {
    h: 260, dots: false, yFmt: v => kfmt(Math.round(v)),
    xFmt: i => { const s = series[clamp(Math.round(i), 0, series.length - 1)]; return s ? new Date(s.d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''; },
    aria: 'value over time'
  });
  const tbl = table([
    { k: 'd', h: 'Date', f: r => new Date(r.d).toLocaleDateString() },
    { k: 'v', h: 'Value', num: true, f: r => kfmt(r.v) },
    { k: 'src', h: 'Source', sortable: false, f: r => r.real ? h('span.tag', 'observed') : h('span.tag', { style: { opacity: .7 } }, 'modelled') }
  ], series.slice().reverse(), {});
  const wt = withTable(chart, tbl);
  wrap.appendChild(card((isTeam ? 'Franchise' : 'Player') + ' value — ' + subject.name,
    `${observed} observed snapshot${observed === 1 ? '' : 's'} · the rest is modelled from FantasyCalc's published 30-day trend`,
    wt.body, wt.btn));

  if (isTeam) wrap.appendChild(stockTeamLines(subject, series));

  // movers
  const pool = Object.values(S.index).filter(p => p.dv > 500 && p.trend30);
  const risers = pool.slice().sort((a, b) => b.trend30 - a.trend30).slice(0, 12);
  const fallers = pool.slice().sort((a, b) => a.trend30 - b.trend30).slice(0, 12);
  const ownerOf = {}; S.teams.forEach(t => t.players.forEach(p => ownerOf[p.id] = t));
  const moverCols = [
    { k: 'name', h: 'Player', sort: r => r.name, f: r => h('div.row', { style: { gap: '7px' } }, isSimple() ? playerFace(r) : posPill(r.pos), pname(r, { face: false, style: { fontWeight: 540 } })) },
    { k: 'owner', prio: 2, h: 'Roster', sort: r => (ownerOf[r.id] || {}).name || 'zz', f: r => ownerOf[r.id] ? h('span.tiny', ownerOf[r.id].short) : h('span.tiny.muted', 'FA') },
    { k: 'dv', h: 'Value', num: true, f: r => kfmt(Math.round(r.dv)) },
    { k: 'trend30', h: '30 days', num: true, f: r => deltaTag(r.trend30, 0) },
    { k: 'pctc', prio: 2, h: '%', num: true, sort: r => r.trend30 / Math.max(1, r.dv - r.trend30), f: r => h('span', { class: r.trend30 > 0 ? 'up mono' : 'down mono' }, sgn(r.trend30 / Math.max(1, r.dv - r.trend30) * 100, 1) + '%') },
    { k: 'spark', prio: 2, h: '', sortable: false, f: r => sparkline(playerSeries(r.id, 30), { w: 66, h: 20 }) }
  ];
  wrap.appendChild(h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(min(340px,100%),1fr))' } },
    card('Rising', 'biggest 30-day value gains league-wide', table(moverCols, risers, { sortKey: 'trend30', sortDir: -1 })),
    card('Falling', 'biggest 30-day value losses', table(moverCols, fallers, { sortKey: 'trend30', sortDir: 1 }))));

  const tv = S.teams.slice().sort((a, b) => b.totalValue - a.totalValue);
  wrap.appendChild(card('Franchise values', 'every team as a ticker — click a row to chart it',
    table([
      { k: 'name', h: 'Team', sort: r => r.name, f: r => teamCell(r) },
      { k: 'totalValue', h: 'Value', num: true, f: r => h('b.mono', kfmt(Math.round(r.totalValue))) },
      isDynasty() ? { k: 'rosterValue', prio: 2, h: 'Players', num: true, f: r => kfmt(Math.round(r.rosterValue)) } : null,
      isDynasty() ? { k: 'pickCapital', prio: 2, h: 'Picks', num: true, f: r => kfmt(Math.round(r.pickCapital)) } : null,
      { k: 'trend', h: '30 days', num: true, sort: r => sum(r.players.map(p => p.trend30 || 0)), f: r => deltaTag(sum(r.players.map(p => p.trend30 || 0)), 0) },
      isDynasty() ? { k: 'age', prio: 2, h: 'Avg age', num: true, f: r => r.age ? fmt(r.age, 1) : '—' } : null,
      { k: 'spark', prio: 2, h: '', sortable: false, f: r => sparkline(teamSeries(r.rosterId, 30), { w: 70, h: 20 }) }
    ], tv, {
      sortKey: 'totalValue', sortDir: -1,
      onRow: r => { StockUI.kind = 'team'; StockUI.id = r.rosterId; render(); window.scrollTo(0, 0); }
    })));
  return wrap;
}

