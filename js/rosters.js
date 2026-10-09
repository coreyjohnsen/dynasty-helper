"use strict";
/* ================= 1. ROSTERS ================= */
const RosterUI = { team: null, sort: 'dv', group: true };
/** The roster's best players as an overlapping deck. It holds as many cards as fit across
 *  the width it has — no sideways scrolling on a big screen — but never fewer than ten, so a
 *  small screen gets a deck to swipe along. It re-counts whenever the width changes. */
function rosterDeck(t) {
  const all = t.players.filter(p => p && p.pos && p.pos !== 'PICK').sort((a, b) => (b.dv || 0) - (a.dv || 0));
  if (!all.length) return null;
  const CARD = 168, MIN = 10;
  const deck = h('div.pcxdeck', { 'aria-label': t.name + ' — best players first' });
  let shown = -1;
  const draw = n => {
    n = Math.min(n, all.length);
    if (n === shown) return;
    shown = n; clear(deck);
    all.slice(0, n).forEach(p => deck.appendChild(tradingCard(p, { w: CARD, back: 'roster' })));
  };
  // how many cards fit: the first takes a whole card, every one after it only its visible stride
  const fit = () => {
    const cs = getComputedStyle(deck), a = deck.children[0], b = deck.children[1];
    const usable = deck.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const stride = a && b ? b.offsetLeft - a.offsetLeft : CARD - 88;
    if (!(usable > 0) || !(stride > 0)) return MIN;
    return Math.max(MIN, Math.floor((usable - CARD) / stride) + 1);
  };
  const settle = () => draw(fit());
  draw(MIN);
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(settle);
  if (typeof ResizeObserver === 'function') new ResizeObserver(settle).observe(deck);
  return deck;
}
function viewRoster() {
  const teams = S.teams;
  if (RosterUI.team === null || !teams.find(t => t.rosterId === RosterUI.team)) RosterUI.team = teams[0].rosterId;
  const t = S.teamById[RosterUI.team];
  const wrap = h('div.grid');

  const picker = h('select', { onchange: e => { RosterUI.team = +e.target.value; if (HYP.on) { HYP.team = RosterUI.team; HYP.after = null; } render(); } },
    teams.slice().sort((a, b) => a.powerRank - b.powerRank).map(x => h('option', { value: x.rosterId, selected: x.rosterId === t.rosterId }, `${x.name} — ${x.owner}`)));

  const leagueAvgValue = mean(teams.map(x => x.totalValue));
  wrap.appendChild(h('div.row', { style: { justifyContent: 'space-between' } },
    h('div.row', h('label.fld', { style: { minWidth: '260px' } }, 'Team', picker)),
    t.window ? h('span.tag', t.window) : null));

  // Default view: the best players as a deck, as many as fit across the screen; hover one to pull it up
  if (isSimple()) {
    const deck = rosterDeck(t);
    if (deck) {
      wrap.appendChild(deck);
      wrap.appendChild(h('div.pcxhint.tiny.muted', 'Swipe along the deck · tap a card to open it'));
    }
  }

  wrap.appendChild(h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(min(148px,100%),1fr))' } },
    kpi(capitalLabel(), kfmt(Math.round(t.totalValue)), `${ord(t.valueRank)} of ${teams.length} · ${sgn(Math.round((t.totalValue / leagueAvgValue - 1) * 100), 0)}% vs avg`,
      `<div class="k">Total ${valueWord()} trade value</div>` + (isDynasty()
        ? `Players <b>${kfmt(Math.round(t.rosterValue))}</b><br>Draft picks <b>${kfmt(Math.round(t.pickCapital))}</b>`
        : 'Every rostered player at this season’s market price. A redraft league holds no picks, so this is the whole roster.')),
    kpi('Power rank', '#' + t.powerRank, `${fmt(t.power, 1)} rating`,
      `<div class="k">Blend of results so far and projection</div>Projection weight <b>${pct(1 - S.blendW, 0)}</b><br>Results weight <b>${pct(S.blendW, 0)}</b>`),
    dynOnly(kpi('Future rank', '#' + t.futureRank, `${fmt(t.futurePower, 1)} rating`, `<div class="k">2–3 years out</div>Age-adjusted lineup plus pick capital.`)),
    kpi('Record', `${t.wins}-${t.losses}${t.ties ? '-' + t.ties : ''}`, t.gp ? `${fmt(t.avgPts, 1)} PPG · ${fmt(t.fpts, 0)} PF` : 'No games played'),
    kpi('Proj. lineup', fmt(t.now, 1), 'pts / week', `<div class="k">Optimal starting lineup</div>Sum of projected points for the best legal lineup from this roster.`),
    dynOnly(kpi('Avg age', t.age ? fmt(t.age, 1) : '—', 'value-weighted', `<div class="k">Weighted by dynasty value</div>Older stars pull this up more than deep-bench veterans.`))
  ));

  // positional profile
  const posRows = POS4.map(pos => ({ pos, val: t.posValue[pos], rank: t.posValue[pos + 'Rank'], now: t.posNow[pos], nowRank: t.posNow[pos + 'Rank'] }));
  wrap.appendChild(h('div.grid.split', {},
    card('Positional value', 'rank in league', barList(posRows.map(r => ({
      label: r.pos + '  ·  ' + ord(r.rank),
      v: r.val, vl: kfmt(Math.round(r.val)),
      color: r.rank <= 3 ? 'var(--s1)' : r.rank >= teams.length - 2 ? 'var(--s8)' : 'var(--seq-300)',
      tip: `<div class="k">${r.pos}</div>${isDynasty() ? 'Dynasty' : 'Redraft'} value <b>${kfmt(Math.round(r.val))}</b> — ${ord(r.rank)} of ${teams.length}<br>Starting output <b>${fmt(r.now, 1)}</b> pts/wk — ${ord(r.nowRank)}`
    })), { labelW: '86px', max: Math.max(...posRows.map(r => r.val)) })),
    card('Projected starting lineup', fmt(t.now, 1) + ' pts/week', lineupTable(t))
  ));

  // what the sandbox has changed on this roster, spelled out
  const changes = hypRosterChanges(t);
  if (changes) wrap.appendChild(changes);

  const injRep = injuryReportCard(t);
  if (injRep) wrap.appendChild(injRep);

  // full roster
  wrap.appendChild(card('Full roster', `${t.players.length} players` + (isDynasty() ? ` · ${t.pickAssets.length} picks` : ''), rosterTable(t),
    isSimple() ? null : segmented([{ k: true, label: 'By position' }, { k: false, label: 'Flat' }], RosterUI.group, v => { RosterUI.group = v; render(); })));
  return wrap;
}
/** Projected points a player is expected to miss, ROS regular season, because of injury. */
function pointsLost(p) {
  const cw = injCurrentWeek(); let lost = 0;
  for (let k = cw; k <= S.regEnd; k++) {
    const base = p.wk ? (p.wk[k] ? p.wk[k].p : 0) : (p.flat !== undefined ? p.flat : (p.ppgHealthy !== undefined ? p.ppgHealthy : p.ppg || 0));
    lost += base * (1 - availability(p, k));
  }
  return lost;
}
/** Who on this roster is hurt, when each is due back, and what it costs the lineup. */
function injuryReportCard(t) {
  const hurt = t.players.filter(p => p.inj).map(p => ({
    p, slot: t.taxi.has(p.id) ? 'TAXI' : t.ir.has(p.id) ? 'IR' : t.starterIds.has(p.id) ? 'START' : 'BN',
    missed: gamesMissed(p), lost: pointsLost(p)
  }));
  if (!hurt.length) return null;
  const tbl = table([
    { k: 'name', h: 'Player', sort: r => r.p.name, f: r => h('div.row', { style: { gap: '7px', flexWrap: 'nowrap' } },
      isSimple() ? playerFace(r.p) : posPill(r.p.pos), pname(r.p, { face: false, style: { fontWeight: 560 } }), injuryTag(r.p.injury, r.p, { full: true })) },
    { k: 'slot', prio: 2, h: 'Role', sort: r => r.slot, f: r => h('span.tag', r.slot) },
    { k: 'body', prio: 2, keepSimple: true, h: 'Injury', sort: r => r.p.inj.body || '', f: r => h('span.tiny', r.p.inj.body || '—') },
    { k: 'back', h: 'Back', sort: r => r.p.inj.kind === 'day' ? injCurrentWeek() : r.p.inj.R, f: r => r.p.inj.kind === 'day' ? h('span.tiny.muted', r.p.inj.pNow >= 0.8 ? 'Likely plays' : 'Likely sits')
      : h('div', h('b', r.p.inj.label), r.p.inj.retDate ? h('div.tiny.muted', fmtDay(r.p.inj.retDate)) : null) },
    { k: 'missed', h: 'Games out', num: true, sort: r => r.missed, f: r => r.p.inj.season ? 'Rest of year' : fmt(r.missed, 1) },
    { k: 'lost', prio: 2, keepSimple: true, h: 'Pts lost', num: true, sort: r => r.lost, f: r => fmt(r.lost, 0) },
    { k: 'src', prio: 2, h: 'Source', sort: r => r.p.inj.src, f: r => h('span.tiny.muted', r.p.inj.espn && r.p.inj.retDate ? 'ESPN' : r.p.inj.src === 'note' ? 'Notes' : r.p.inj.src === 'tag' ? 'Tag' : 'Estimate') }
  ], hurt, { sortKey: 'lost', sortDir: -1 });
  const out = hurt.filter(r => r.p.inj.kind === 'long' && !r.p.inj.season && r.slot !== 'TAXI').length;
  return card('Injury report', `${hurt.length} on the report` + (out ? ` · ${out} due back` : '') + ' · estimated return weeks and what the lineup loses until then', tbl);
}
function lineupTable(t) {
  return h('div', { style: { display: 'grid', gap: '3px' } }, t.starters.map(s => {
    const p = s.player;
    return h('div.lnrow', { class: p ? rowMedal(p) : null },
      h('span.tag', { style: { textAlign: 'center' } }, SLOT_LABEL[s.slot] || s.slot),
      p ? h('div.row', { style: { gap: '7px', minWidth: 0 } },
        isSimple() ? playerFace(p) : posPill(p.pos),
        pname(p, { face: false, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: '540' } }),
        injuryTag(p.injury, p),
        p.team ? (isSimple() ? teamLogo(p.team) : h('span.tiny.muted', p.team)) : null) : h('span.muted.tiny', 'empty'),
      h('span.mono.tiny.sec', p ? fmt(p.ppg, 1) : '—'));
  }));
}
function rosterTable(t) {
  const assets = t.players.map(p => Object.assign({}, p, {
    _slot: t.taxi.has(p.id) ? 'TAXI' : t.ir.has(p.id) ? 'IR' : t.starterIds.has(p.id) ? 'START' : 'BN',
    _hyp: HYP.on && S.base && S.base.own[p.id] !== t.rosterId ? 'in' : null
  })).concat(t.pickAssets.map(p => Object.assign({}, p, {
    _slot: 'PICK', ppg: null, age: null, trend30: 0,
    _hyp: HYP.on && S.base && S.base.pickOwn[pickKey(p)] !== t.rosterId ? 'in' : null
  })));
  // Players this team has moved on in the what-if are NOT listed here. They used
  // to be, tagged OUT and sitting in their position group, which counted them in
  // that group's size and value and made a roster that had changed look as if it
  // had not. hypRosterChanges() shows what went and what came, above the roster.
  const cols = [
    { k: 'pos', h: 'Pos', f: r => posPill(r.pos), sort: r => ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'PICK'].indexOf(r.pos) },
    {
      k: 'name', h: 'Player', sort: r => r.name, f: r => h('div.row', { style: { gap: '6px' } },
        pname(r, { style: { fontWeight: r._slot === 'START' ? '640' : '500' } }),
        r._hyp === 'in' ? h('span.tag', { style: { borderColor: 'var(--good)', color: 'var(--good-text)' } }, 'IN')
          : r._hyp === 'out' ? h('span.tag', { style: { borderColor: 'var(--critical)', color: 'var(--bad-text)' } }, 'OUT') : null,
        r._slot === 'START' ? h('span.tag', { style: { borderColor: 'var(--s1)', color: 'var(--s1)' } }, 'ST') : r._slot === 'TAXI' ? h('span.tag', 'TX') : r._slot === 'IR' ? h('span.tag', 'IR') : null,
        injuryTag(r.injury, r))
    },
    { k: 'team', prio: 2, h: 'NFL', f: r => r.team || '—' },
    { k: 'age', prio: 2, h: 'Age', num: true, f: r => r.age ? fmt(r.age, 1) : '—' },
    { k: 'dv', h: 'Value', num: true, tip: 'FantasyCalc ' + valueWord() + ' trade value for this league format', f: r => h('b.mono', kfmt(Math.round(r.dv || 0))) },
    { k: 'posRank', prio: 2, h: 'Pos rk', num: true, f: r => r.posRank ? r.pos + fmt(r.posRank, 0) : '—' },
    { k: 'ppg', h: 'Proj', num: true, tip: 'Projected points per week in this league’s scoring', f: r => r.ppg === null || r.ppg === undefined ? '—' : fmt(r.ppg, 1) },
    isDynasty() ? { k: 'fppg', prio: 2, h: 'Proj ’28', num: true, tip: 'Age-adjusted projection 2–3 seasons out', f: r => r.fppg ? fmt(r.fppg, 1) : '—' } : null,
    { k: 'trend30', prio: 2, h: '30d', num: true, tip: 'Value change over the last 30 days', f: r => r.trend30 ? deltaTag(r.trend30, 0) : h('span.flat.tiny', '–') },
    { k: 'share', prio: 2, h: '% of team', num: true, sort: r => (r.dv || 0) / (t.totalValue || 1), f: r => h('div.meter', { style: { justifyContent: 'flex-end' } }, h('div.bar-track', { style: { width: '44px', height: '7px' } }, h('div.bar-fill', { style: { width: clamp((r.dv || 0) / (t.totalValue || 1) * 100 * 3.2, 0, 100) + '%' } })), h('span.tiny.mono.muted', pct((r.dv || 0) / (t.totalValue || 1), 1))) }
  ];
  const order = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'PICK', 'NA'];
  const groups = {}; assets.forEach(a => (groups[a.pos] = groups[a.pos] || []).push(a));

  /* Simple mode swaps the ten-column table for a face and three numbers. Same
     roster, read at a glance instead of scanned. */
  if (isSimple()) {
    const badge = (r) => r._hyp === 'in' ? h('span.tag', { style: { borderColor: 'var(--good)', color: 'var(--good-text)' } }, 'IN')
      : r._hyp === 'out' ? h('span.tag', { style: { borderColor: 'var(--critical)', color: 'var(--bad-text)' } }, 'OUT')
        : r._slot === 'START' ? h('span.tag', { style: { borderColor: 'var(--s1)', color: 'var(--s1)' } }, 'Starting')
          : r._slot === 'TAXI' ? h('span.tag', 'Taxi') : r._slot === 'IR' ? h('span.tag', 'IR') : null;
    const tile = (r) => r.pos === 'PICK'
      ? h('div.pcard', h('div.face', { style: { display: 'grid', placeItems: 'center' } }, posPill('PICK')),
        h('div.meta', h('div.nm', r.name || r.label), h('div.sub', badge(r) || h('span', 'draft pick'))),
        h('div.val', h('b.mono', kfmt(Math.round(r.dv || 0)))))
      : h('div.pcard' + (r._hyp === 'in' ? '.hypin' : ''), playerFace(r),
        h('div.meta', h('div.nm', pname(r, { face: false, style: { fontWeight: r._slot === 'START' ? 650 : 560 } })),
          h('div.sub', posPill(r.pos), r.team ? teamLogo(r.team) : null,
            r.age ? h('span', fmt(r.age, 0) + 'y') : null, badge(r), injuryTag(r.injury, r))),
        h('div.val',
          h('b.mono', kfmt(Math.round(r.dv || 0))),
          h('div.tiny.muted', r.ppg === null || r.ppg === undefined ? '—' : fmt(r.ppg, 1) + ' pts/wk')));
    return h('div.grid', { style: { gap: '18px' } }, order.filter(p => groups[p]).map(pos => {
      const list = groups[pos].sort((a, b) => (b.dv || 0) - (a.dv || 0));
      return h('div', { style: { minWidth: 0 } },
        h('div.row', { style: { marginBottom: '8px', gap: '8px' } }, posPill(pos),
          h('b.tiny', list.length + (pos === 'PICK' ? ' picks' : ' players')),
          h('span.tiny.muted', kfmt(Math.round(sum(list.map(x => x.dv || 0)))) + ' value'
            + (t.posValue[pos + 'Rank'] ? ' · ' + ord(t.posValue[pos + 'Rank']) + ' in league' : ''))),
        h('div.grid', { style: { gap: '7px', gridTemplateColumns: 'repeat(auto-fill,minmax(min(280px,100%),1fr))' } }, list.map(tile)));
    }));
  }

  if (!RosterUI.group) return table(cols, assets, { sortKey: 'dv', sortDir: -1 });
  return h('div.grid', { style: { gap: '14px' } }, order.filter(p => groups[p]).map(pos => {
    const list = groups[pos].sort((a, b) => (b.dv || 0) - (a.dv || 0));
    return h('div', { style: { minWidth: 0 } },
      h('div.row', { style: { marginBottom: '4px' } }, posPill(pos),
        h('span.tiny.muted', `${list.length} · ${kfmt(Math.round(sum(list.map(x => x.dv || 0))))} value` + (t.posValue[pos + 'Rank'] ? ` · ${ord(t.posValue[pos + 'Rank'])} in league` : ''))),
      table(cols, list, { sortKey: 'dv', sortDir: -1 }));
  }));
}

