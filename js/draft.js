"use strict";
/* ================= 7. DRAFT VIEW ================= */
const DraftUI = { id: null };
function viewDraft() {
  const wrap = h('div.grid');
  const drafts = S.drafts.slice().sort((a, b) => (b.season - a.season) || (b.start_time || 0) - (a.start_time || 0));
  if (!drafts.length) return wrap.appendChild(card('Drafts', null, h('div.empty', 'Sleeper reports no drafts for this league.'))), wrap;
  if (DraftUI.id === null || !drafts.find(d => d.draft_id === DraftUI.id)) DraftUI.id = drafts[0].draft_id;
  const d = S.draftMeta[DraftUI.id] || drafts.find(x => x.draft_id === DraftUI.id);
  const picks = (S.draftPicks[DraftUI.id] || []).slice().sort((a, b) => a.pick_no - b.pick_no);
  const isStartup = (d.settings && d.settings.rounds > 8) || d.type === 'snake_startup' || picks.length > S.teams.length * 8;
  const label = (x) => `${x.season} ${((x.settings && x.settings.rounds > 8) || x.type === 'snake_startup' || (S.draftPicks[x.draft_id] || []).length > S.teams.length * 8) ? 'Startup' : 'Rookie'} draft · ${x.status}`;

  wrap.appendChild(h('div.row', { style: { justifyContent: 'space-between' } },
    h('label.fld', { style: { minWidth: '280px' } }, 'Draft',
      h('select', { onchange: e => { DraftUI.id = e.target.value; render(); } }, drafts.map(x => h('option', { value: x.draft_id, selected: x.draft_id === DraftUI.id }, label(x))))),
    h('span.tiny.muted', picks.length + ' picks · ' + ((d.settings && d.settings.rounds) || '?') + ' rounds · ' + (d.type || 'snake'))));

  if (!picks.length) return wrap.appendChild(card('Draft board', null, h('div.empty', 'This draft has not started — no picks to show yet.'))), wrap;

  // surplus: player value vs. expected value at that pick slot
  const vals = picks.map(p => { const pl = S.index[String(p.player_id)]; return pl ? (pl.dv || 0) : 0; });
  const sorted = vals.slice().sort((a, b) => b - a);
  const enriched = picks.map((p, i) => {
    const pl = S.index[String(p.player_id)] || ensurePlayer(String(p.player_id));
    const expected = sorted[Math.min(i, sorted.length - 1)] || 0;
    const t = S.teams.find(x => x.rosterId === +p.roster_id) || S.teams.find(x => x.ownerId === p.picked_by);
    return { p, pl, expected, surplus: (pl.dv || 0) - expected, team: t, meta: p.metadata || {} };
  });
  const maxAbs = Math.max(...enriched.map(e => Math.abs(e.surplus)), 1);
  const surColor = (s) => {
    const t = clamp(Math.abs(s) / maxAbs, 0, 1);
    const a = 0.10 + t * 0.55;
    return s >= 0 ? `color-mix(in srgb, var(--s1) ${Math.round(a * 100)}%, var(--surface-1))` : `color-mix(in srgb, var(--s8) ${Math.round(a * 100)}%, var(--surface-1))`;
  };
  const rounds = Math.max(...picks.map(p => p.round));
  const perRound = Math.max(...picks.map(p => p.draft_slot || 1), S.teams.length);
  const board = h('div.board', { style: { gridTemplateColumns: `36px repeat(${perRound}, minmax(${isSimple() ? 132 : 96}px,1fr))` } });
  board.appendChild(h('div'));
  for (let s = 1; s <= perRound; s++) {
    const rid = d.slot_to_roster_id ? d.slot_to_roster_id[s] : null;
    const t = rid ? S.teamById[rid] : null;
    board.appendChild(h('div.tiny.muted', { style: { textAlign: 'center', fontWeight: 660, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: t ? t.name : '' }, t ? t.short : s));
  }
  for (let r = 1; r <= rounds; r++) {
    board.appendChild(h('div.tiny.muted', { style: { alignSelf: 'center', textAlign: 'center', fontWeight: 660 } }, r));
    for (let s = 1; s <= perRound; s++) {
      const e = enriched.find(x => x.p.round === r && x.p.draft_slot === s);
      if (!e) { board.appendChild(h('div.cell', { style: { opacity: .3 } })); continue; }
      const cell = h('div.cell', {
        style: { background: surColor(e.surplus), cursor: /^\d+$/.test(e.pl.id) ? 'pointer' : 'default' }, tabindex: 0,
        onclick: () => { if (/^\d+$/.test(e.pl.id)) openPlayer(e.pl.id); },
        onkeydown: (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && /^\d+$/.test(e.pl.id)) { ev.preventDefault(); openPlayer(e.pl.id); } }
      },
        isSimple()
          ? h('div.pnrow', playerFace(e.pl, { xs: true }), h('div.pn', e.pl.name))
          : h('div.pn', e.pl.name),
        h('div.mt', h('span', { style: { fontWeight: 700 } }, e.pl.pos || '—'),
          h('span', e.pl.team || ''), h('span', { style: { marginLeft: 'auto', opacity: .8 } }, r + '.' + String(s).padStart(2, '0'))));
      bindTT(cell, `<div class="k">Pick ${e.p.pick_no} (${r}.${String(s).padStart(2, '0')}) — ${e.team ? e.team.name : '?'}</div>` +
        `<b>${e.pl.name}</b> ${e.pl.pos || ''} ${e.pl.team || ''}<br>` +
        `Value today <b>${kfmt(Math.round(e.pl.dv || 0))}</b><br>Par for this slot <b>${kfmt(Math.round(e.expected))}</b><br>` +
        `<span style="color:${e.surplus >= 0 ? 'var(--good-text)' : 'var(--bad-text)'};font-weight:640">${sgn(Math.round(e.surplus), 0)} surplus</span>`);
      board.appendChild(cell);
    }
  }
  wrap.appendChild(card((isStartup ? 'Startup' : 'Rookie') + ' draft board — ' + d.season,
    'shaded by value today against what that slot normally returns',
    h('div', scrollBox(board),
      h('div.legend', { style: { marginTop: '11px' } },
        h('span', h('i', { style: { background: 'var(--s8)' } }), 'Below par for the slot'),
        h('span', h('i', { style: { background: 'var(--div-neutral)' } }), 'Par'),
        h('span', h('i', { style: { background: 'var(--s1)' } }), 'Above par'),
        h('span.tiny.muted', 'Hover any pick for the numbers.')))));

  const best = enriched.slice().sort((a, b) => b.surplus - a.surplus);
  const cols = [
    { k: 'pick', h: 'Pick', num: true, sort: r => r.p.pick_no, f: r => h('span.mono', r.p.round + '.' + String(r.p.draft_slot).padStart(2, '0')) },
    { k: 'player', h: 'Player', sort: r => r.pl.name, f: r => h('div.row', { style: { gap: '6px' } }, posPill(r.pl.pos), pname(r.pl)) },
    { k: 'team', prio: 2, h: 'Drafted by', sort: r => r.team ? r.team.name : '', f: r => r.team ? r.team.name : '—' },
    { k: 'dv', h: 'Value now', num: true, sort: r => r.pl.dv || 0, f: r => kfmt(Math.round(r.pl.dv || 0)) },
    { k: 'exp', prio: 2, h: 'Par', num: true, sort: r => r.expected, f: r => kfmt(Math.round(r.expected)) },
    { k: 'surplus', h: 'Surplus', num: true, sort: r => r.surplus, f: r => deltaTag(r.surplus, 0) }
  ];
  wrap.appendChild(h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(min(340px,100%),1fr))' } },
    card('Best value picks', 'biggest gain over slot par', table(cols, best.slice(0, 12), { sortKey: 'surplus', sortDir: -1 })),
    card('Picks that did not work out', 'biggest shortfall', table(cols, best.slice(-12).reverse(), { sortKey: 'surplus', sortDir: 1 }))));

  const byTeam = {};
  enriched.forEach(e => { if (!e.team) return; (byTeam[e.team.rosterId] = byTeam[e.team.rosterId] || []).push(e); });
  wrap.appendChild(card('Draft haul by team', 'total value of everything each team took in this draft, still on any roster or not',
    barList(Object.keys(byTeam).map(k => {
      const list = byTeam[k], t = S.teamById[k];
      return {
        label: t.name, v: sum(list.map(e => e.pl.dv || 0)), vl: kfmt(Math.round(sum(list.map(e => e.pl.dv || 0)))),
        tip: `<div class="k">${t.name} — ${list.length} picks</div>` + list.slice(0, 10).map(e => `${e.p.round}.${String(e.p.draft_slot).padStart(2, '0')} ${e.pl.name} — <b>${kfmt(Math.round(e.pl.dv || 0))}</b>`).join('<br>')
      };
    }).sort((a, b) => b.v - a.v), { labelW: '160px', dec: 0 })));
  return wrap;
}


/** Every player on a franchise as its own line, on the same dates as the
 *  franchise chart. The biggest movers get a colour and an end label; the rest
 *  stay thin and grey so the shape of the roster is still readable. */
const STOCK_LINE_COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s7)'];
function stockTeamLines(t, teamSer) {
  const rows = t.players.map(p => {
    // a player the market does not price (most kickers and defences) has a flat
    // line at nothing, which only distorts the axis
    if (!((p.dv || 0) > 0)) return null;
    const ser = playerSeries(p.id, StockUI.range);
    if (!ser.length) return null;
    const f = ser[0].v, l = ser[ser.length - 1].v;
    return { p: p, ser: ser, first: f, last: l, chg: l - f, pctc: f ? (l - f) / f : 0 };
  }).filter(Boolean);
  if (!rows.length) return card('Players behind the ticker', null, h('div.empty', 'No player history for this roster.'));

  const dates = teamSer.map(s => s.d);
  const byMove = rows.slice().sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg));
  const featured = byMove.slice(0, 5);
  const colorOf = {};
  featured.forEach((r, i) => colorOf[r.p.id] = STOCK_LINE_COLORS[i % STOCK_LINE_COLORS.length]);

  // absolute value puts a 12k stud and a 200-point stash on one axis, which is
  // honest but unreadable; indexing every line to 100 at the start of the window
  // is what actually answers "whose stock moved"
  const indexed = StockUI.lines === 'index';
  const toPoints = (r) => r.ser.map((s, i) => ({
    x: i, y: indexed ? (r.first ? s.v / r.first * 100 : 100) : s.v,
    label: new Date(s.d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }));
  // background lines first so the featured five draw on top of them
  const bg = rows.filter(r => !colorOf[r.p.id]).map(r => ({
    name: r.p.name, color: 'var(--text-muted)', width: 1, opacity: .3, points: toPoints(r)
  }));
  const fg = featured.map(r => ({
    name: r.p.name, color: colorOf[r.p.id], width: 2, points: toPoints(r)
  }));
  const chart = lineChart(bg.concat(fg), {
    h: 300, dots: false, maxTip: 10, floorAtZero: true,
    yFmt: v => indexed ? fmt(v, 0) : kfmt(Math.round(v)),
    xFmt: i => dates[clamp(Math.round(i), 0, dates.length - 1)]
      ? new Date(dates[clamp(Math.round(i), 0, dates.length - 1)]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : '',
    aria: 'every player on this roster, value over time'
  });
  const modeRow = h('div.row', { style: { justifyContent: 'flex-end', marginBottom: '6px' } },
    segmented([{ k: 'index', label: 'Indexed to 100' }, { k: 'value', label: 'Absolute value' }], StockUI.lines,
      k => { StockUI.lines = k; render(); }));
  const legend = h('div.legend', { style: { marginTop: '8px' } }, featured.map(r =>
    h('span', h('i', { style: { background: colorOf[r.p.id] } }), r.p.name))
    .concat(bg.length ? [h('span', h('i', { style: { background: 'var(--text-muted)', opacity: .3 } }), bg.length + ' more')] : []));

  const tbl = table([
    { k: 'name', h: 'Player', sort: r => r.p.name, f: r => h('div.row', { style: { gap: '6px' } }, posPill(r.p.pos), pname(r.p, { style: { fontWeight: 540 } })) },
    { k: 'first', prio: 2, h: 'Start', num: true, f: r => kfmt(r.first) },
    { k: 'last', h: 'Now', num: true, f: r => h('b.mono', kfmt(r.last)) },
    { k: 'chg', h: 'Change', num: true, f: r => deltaTag(r.chg, 0) },
    { k: 'pctc', h: '%', num: true, f: r => h('span', { class: r.pctc > 0 ? 'up mono' : r.pctc < 0 ? 'down mono' : 'mono' }, sgn(r.pctc * 100, 1) + '%') },
    { k: 'share', prio: 2, h: 'Share', num: true, sort: r => r.last, f: r => pct(r.last / Math.max(1, sum(rows.map(x => x.last))), 1) }
  ], rows, { sortKey: 'chg', sortDir: -1 });
  const wt = withTable(h('div', modeRow, chart, legend), tbl);
  const up = rows.filter(r => r.chg > 0).length;
  return card('Players behind the ticker',
    `${rows.length} priced players over the same ${StockUI.range} days · ${up} up, ${rows.length - up} down · `
    + (indexed ? 'every line starts at 100, so the shape is the percentage move' : 'absolute trade value') + ' · picks are not shown here',
    wt.body, wt.btn);
}

