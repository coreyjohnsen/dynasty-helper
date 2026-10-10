"use strict";
/* ================= 15. PLAYERS =================
   Everyone the market prices, ranked, and the best of what nobody in the league
   has picked up. Two lists on one page because they answer the two questions
   people actually bring to a rankings page: where does this player sit, and who
   could I go and get for nothing. */
const PlayersUI = { moreOpen: false, pos: [], picks: true, limit: 50, owner: 'all', faPos: [], faLimit: 15, market: 'any', window: 'any' };
const RANK_POS = ['QB', 'RB', 'WR', 'TE'];

function viewPlayers() {
  const wrap = h('div.grid');
  const ownerOf = {};
  S.teams.forEach(t => t.players.forEach(p => { ownerOf[p.id] = t; }));
  const me = S.teamById[S.myRosterId];

  /* ---- the rankings ----
     Kickers and defences are left out: the market does not price them, so a
     value ranking has nothing to say about them — they are in the waiver list,
     ranked on projection, where they belong. */
  const priced = Object.values(S.index).filter(p => RANK_POS.includes(p.pos) && ((p.dv || 0) > 0 || ownerOf[p.id]));
  priced.sort((a, b) => ((b.dv || 0) - (a.dv || 0)) || ((b.ppg || 0) - (a.ppg || 0)));
  // the rank is the player's place in the whole market, fixed, so filtering to
  // one position still says where he sits overall
  const overall = {}, posRank = {}, posCount = {};
  priced.forEach((p, i) => {
    overall[p.id] = i + 1;
    posCount[p.pos] = (posCount[p.pos] || 0) + 1;
    posRank[p.id] = posCount[p.pos];
  });

  const posOn = PlayersUI.pos.length ? PlayersUI.pos : RANK_POS;
  let players = priced.filter(p => posOn.includes(p.pos));
  if (PlayersUI.owner === 'mine') players = players.filter(p => ownerOf[p.id] && ownerOf[p.id].rosterId === S.myRosterId);
  else if (PlayersUI.owner === 'rostered') players = players.filter(p => ownerOf[p.id]);
  else if (PlayersUI.owner === 'fa') players = players.filter(p => !ownerOf[p.id]);
  // the market filters: who the price and the production disagree about, and which
  // way each player's value leans in time
  const sigs = signalMap(), tls = timelineMap();
  if (PlayersUI.market !== 'any') players = players.filter(p => sigs[p.id] && sigs[p.id].kind === PlayersUI.market);
  if (PlayersUI.window !== 'any' && isDynasty()) players = players.filter(p => tls[p.id] && tls[p.id].kind === PlayersUI.window);
  const filtered = PlayersUI.market !== 'any' || (PlayersUI.window !== 'any' && isDynasty());

  // where the league's own draft picks fall among them — the real picks, held by
  // whoever holds them, priced where they are projected to land
  const showPicks = isDynasty() && PlayersUI.picks && PlayersUI.owner !== 'fa' && !filtered;
  let picks = [];
  if (showPicks) {
    S.teams.forEach(t => (t.pickAssets || []).forEach(pk => {
      if (PlayersUI.owner === 'mine' && t.rosterId !== S.myRosterId) return;
      picks.push({ _pick: true, pk, holder: t, orig: S.teamById[pk.origRosterId], dv: pk.value || 0 });
    }));
  }

  // merge by value, players first on a tie so a pick never pushes a player down
  const merged = players.map(p => ({ _pick: false, p, dv: p.dv || 0 })).concat(picks)
    .sort((a, b) => (b.dv - a.dv) || (a._pick - b._pick));
  // the limit counts players; picks that fall inside the shown range come along
  let shownPlayers = 0; const shown = [];
  for (const r of merged) {
    if (!r._pick) { if (shownPlayers >= PlayersUI.limit) break; shownPlayers++; }
    shown.push(r);
  }

  const chips = (list, on, set) => h('div.chipwrap', [
    h('button.chip' + (!on.length ? '.on' : ''), { onclick: () => { set([]); render(); } }, 'All')
  ].concat(list.map(p => h('button.chip' + (on.includes(p) ? '.on' : ''), {
    onclick: () => { set(on.includes(p) ? on.filter(x => x !== p) : on.concat([p])); render(); }
  }, p))));

  const ownerTag = (t) => !t ? h('span.tag.fa', 'FA')
    : h('span.tiny', { class: t.rosterId === S.myRosterId ? 'mine-own' : '' }, t.rosterId === S.myRosterId ? 'You' : t.short);

  const cols = [
    { k: 'rk', h: '#', num: true, sort: r => r._pick ? 9999 : overall[r.p.id], f: r => r._pick ? h('span.tiny.muted', '—') : h('b.mono', overall[r.p.id]) },
    {
      k: 'name', h: 'Player', sort: r => r._pick ? r.pk.label : r.p.name,
      f: r => r._pick
        ? h('div.row.pickrow', { style: { gap: '7px', minWidth: 0 } },
          h('b', r.pk.season + ' ' + (r.pk.slotLabel || ((ROUND_WORD[r.pk.round] || r.pk.round + 'th')))),
          r.orig && r.orig.rosterId !== r.holder.rosterId ? h('span.tiny.muted', 'via ' + r.orig.short) : null,
          h('span.tiny.muted', r.pk.tier ? '· ' + r.pk.tier : ''))
        : isNarrow()
          // on a phone the position rides under the name instead of taking a column
          ? h('div', { style: { minWidth: 0 } },
            h('div.row', { style: { gap: '6px', minWidth: 0, flexWrap: 'nowrap' } }, pname(r.p, { style: { fontWeight: 580 } }), injuryTag(r.p.injury, r.p)),
            h('div.row', { style: { gap: '6px', marginTop: '1px', flexWrap: 'nowrap' } }, h('span.tiny.muted', r.p.pos + posRank[r.p.id] + (r.p.team ? ' · ' + r.p.team : '')), marketTags(r.p)))
          : h('div.row', { style: { gap: '7px', minWidth: 0, flexWrap: 'nowrap' } },
            pname(r.p, { style: { fontWeight: 580 } }), injuryTag(r.p.injury, r.p), marketTags(r.p))
    },
    {
      k: 'pos', h: 'Pos', prio: isNarrow() ? 2 : 0, sort: r => r._pick ? 'ZZ' : r.p.pos + String(posRank[r.p.id]).padStart(4, '0'),
      f: r => r._pick ? posPill('PICK') : h('div.row', { style: { gap: '5px', flexWrap: 'nowrap' } }, posPill(r.p.pos), h('span.tiny.mono.muted', r.p.pos + posRank[r.p.id]))
    },
    { k: 'team', prio: 2, h: 'NFL', sort: r => r._pick ? '' : (r.p.team || ''), f: r => r._pick ? '' : (isSimple() && r.p.team ? h('span.row', { style: { gap: '5px' } }, teamLogo(r.p.team), h('span.tiny', r.p.team)) : h('span.tiny', r.p.team || 'FA')) },
    { k: 'age', prio: 2, h: 'Age', num: true, sort: r => r._pick ? 0 : (r.p.age || 0), f: r => r._pick ? '' : (r.p.age ? fmt(r.p.age, 1) : '—') },
    { k: 'dv', h: 'Value', num: true, sort: r => r.dv, f: r => h('b.mono', kfmt(Math.round(r.dv))) },
    { k: 'ppg', h: 'Proj/wk', num: true, prio: isNarrow() ? 2 : 0, sort: r => r._pick ? 0 : (r.p.ppg || 0), f: r => r._pick ? '' : fmt(r.p.ppg || 0, 1) },
    { k: 'trend', prio: 2, h: '30d', num: true, sort: r => r._pick ? 0 : (r.p.trend30 || 0), f: r => r._pick ? '' : (r.p.trend30 ? deltaTag(r.p.trend30, 0) : h('span.flat.tiny', '–')) },
    { k: 'sig', h: 'Market', num: true, prio: 2, keepSimple: true,
      tip: 'Where price and production disagree. Three dots is a strong signal, one is mild. Sorts by strength.',
      sort: r => r._pick ? -1 : (sigs[r.p.id] ? sigs[r.p.id].strength : 0),
      f: r => { const s = !r._pick && sigs[r.p.id]; return s ? h('span.row', { style: { gap: '6px', justifyContent: 'flex-end', flexWrap: 'nowrap' } },
        h('span.tiny', { class: s.kind === 'buy' ? 'up' : 'sec' }, s.kind === 'buy' ? 'Buy' : 'Sell'), pipsOf(s.strength)) : h('span.flat.tiny', '–'); } },
    isDynasty() ? { k: 'tl', h: 'Redraft · Dynasty', num: true, prio: 2, keepSimple: true,
      tip: 'Where the player ranks by redraft value and by dynasty value. A better redraft rank means the market pays for this season (win now); a better dynasty rank means it pays for the future (rebuild).',
      sort: r => { const t = !r._pick && tls[r.p.id]; return t ? t.ratio : 1; },
      f: r => { const t = !r._pick && tls[r.p.id]; return t ? h('span.tiny.mono', { class: t.kind === 'now' ? 'tlnow' : 'tllater' }, `#${t.redRank} · #${t.dynRank}`) : h('span.flat.tiny', '–'); } } : null,
    { k: 'own', h: 'Roster', sort: r => r._pick ? r.holder.name : (ownerOf[r.p.id] || { name: 'zz' }).name, f: r => r._pick ? ownerTag(r.holder) : ownerTag(ownerOf[r.p.id]) }
  ];

  const total = players.length;
  // On a phone six filter groups would sit above the first player, so only the position chips stay in view and the
  // rest open from one button that says how many of them are doing something.
  const posFld = h('label.fld', 'Position', chips(RANK_POS, PlayersUI.pos, v => { PlayersUI.pos = v; PlayersUI.limit = 50; }));
  const activeFilters = (PlayersUI.owner !== 'all' ? 1 : 0) + (isDynasty() && !PlayersUI.picks ? 1 : 0) + (PlayersUI.market !== 'any' ? 1 : 0) + (isDynasty() && PlayersUI.window !== 'any' ? 1 : 0);
  const fold = isNarrow();
  const controls = h('div', { style: { display: 'grid', gap: '10px' } },
    fold ? posFld : null,
    fold ? h('button.btn.sm', { style: { justifySelf: 'start' }, 'aria-expanded': PlayersUI.moreOpen ? 'true' : 'false',
      onclick: () => { PlayersUI.moreOpen = !PlayersUI.moreOpen; render(); } },
      ico('sliders'), PlayersUI.moreOpen ? 'Hide filters' : 'More filters' + (activeFilters ? ' · ' + activeFilters + ' on' : '')) : null,
    fold && !PlayersUI.moreOpen ? null : h('div.row', { style: { gap: '14px', alignItems: 'flex-end' } },
      fold ? null : posFld,
      h('label.fld', 'Rostered',
        segmented(isNarrow()
          ? [{ k: 'all', label: 'All' }, { k: 'mine', label: 'Mine' }, { k: 'rostered', label: 'Taken' }, { k: 'fa', label: 'FA' }]
          : [{ k: 'all', label: 'Everyone' }, { k: 'mine', label: 'Mine' }, { k: 'rostered', label: 'Rostered' }, { k: 'fa', label: 'Free agents' }],
          PlayersUI.owner, v => { PlayersUI.owner = v; PlayersUI.limit = 50; render(); })),
      isDynasty() ? h('label.fld', 'Draft picks',
        segmented([{ k: true, label: 'Show' }, { k: false, label: 'Hide' }], PlayersUI.picks, v => { PlayersUI.picks = v; render(); })) : null),
    fold && !PlayersUI.moreOpen ? null : h('div.row', { style: { gap: '14px', alignItems: 'flex-end' } },
      h('label.fld', 'Market', segmented([{ k: 'any', label: 'Any' }, { k: 'buy', label: 'Buy low' }, { k: 'sell', label: 'Sell high' }],
        PlayersUI.market, v => { PlayersUI.market = v; PlayersUI.limit = 50; render(); })),
      isDynasty() ? h('label.fld', 'Timeline', segmented([{ k: 'any', label: 'Any' }, { k: 'now', label: 'Win now' }, { k: 'later', label: 'Rebuild' }],
        PlayersUI.window, v => { PlayersUI.window = v; PlayersUI.limit = 50; render(); })) : null,
      filtered ? h('span.tiny.muted', 'Picks are hidden while a market filter is on — they have no signal.') : null));

  const more = shownPlayers < total
    ? h('div.row', { style: { justifyContent: 'center', gap: '10px', marginTop: '6px' } },
      h('button.btn', { onclick: () => { PlayersUI.limit += 50; render(); } }, 'Show ' + Math.min(50, total - shownPlayers) + ' more'),
      total - shownPlayers > 50 ? h('button.btn', { onclick: () => { PlayersUI.limit = total; render(); } }, 'Show all ' + total) : null)
    : null;

  wrap.appendChild(card('Player rankings',
    (isDynasty() ? 'dynasty' : 'redraft') + ' market value for this league’s format'
    + (showPicks ? ' · this league’s own draft picks sit where their value puts them' : '')
    + ' · showing ' + shownPlayers + ' of ' + total,
    h('div', { style: { display: 'grid', gap: '12px' } },
      controls,
      table(cols, shown, { sortKey: PlayersUI.window !== 'any' && isDynasty() ? 'tl' : PlayersUI.market !== 'any' ? 'sig' : 'dv', sortDir: PlayersUI.window === 'later' && isDynasty() ? 1 : -1, rowClass: r => r._pick ? 'pickline' : (ownerOf[r.p.id] && ownerOf[r.p.id].rosterId === S.myRosterId ? 'mineline' : '') }),
      more)));

  if (isDynasty()) wrap.appendChild(timelineCard(ownerOf));
  wrap.appendChild(waiverCard(ownerOf, me));
  return wrap;
}

/** Who the market pays for this season, and who it pays for the long run. */
function timelineCard(ownerOf) {
  const tls = timelineMap();
  const rows = Object.keys(tls).map(id => ({ p: S.index[id], t: tls[id], o: ownerOf[id] || null })).filter(x => x.p);
  const scope = rows.filter(x => PlayersUI.owner === 'mine' ? x.o && x.o.rosterId === S.myRosterId
    : PlayersUI.owner === 'rostered' ? x.o : PlayersUI.owner === 'fa' ? !x.o : true);
  const rank = (a, b) => (b.t.strength - a.t.strength) || ((b.p.dvDyn || 0) - (a.p.dvDyn || 0));
  const now = scope.filter(x => x.t.kind === 'now').sort(rank).slice(0, 8);
  const later = scope.filter(x => x.t.kind === 'later').sort(rank).slice(0, 8);
  const rowEl = (x) => {
    const mineP = x.o && x.o.rosterId === S.myRosterId;
    return h('div.sigrow',
      isSimple() ? playerFace(x.p) : posPill(x.p.pos),
      h('div.sigmain',
        h('div.row', { style: { gap: '6px', flexWrap: 'nowrap' } }, pname(x.p, { face: false, style: { fontWeight: '640' } }), pipsOf(x.t.strength)),
        h('div.tiny.muted', `${x.p.pos}${x.p.posRank || ''} · ${x.p.team || 'FA'}${x.p.age ? ' · ' + fmt(x.p.age, 0) + ' yrs' : ''} · ${x.o ? (mineP ? 'yours' : x.o.name) : 'free agent'}`),
        h('div.tiny.sec.sigwhy', h('span', { class: x.t.kind === 'now' ? 'tlnow' : 'tllater' }, `Redraft #${x.t.redRank}`), ' · ', h('span', { class: x.t.kind === 'now' ? 'tllater' : 'tlnow' }, `Dynasty #${x.t.dynRank}`))),
      x.o ? h('button.btn.sm', { onclick: () => shopInFinder(x.p.id) }, mineP ? 'Shop him' : 'Get him') : null);
  };
  const col = (title, note, list) => h('div.sigcol',
    h('div.sigh', h('b', title), h('span.tiny.muted', note)),
    list.length ? h('div.sigrows', list.map(rowEl)) : h('div.tiny.muted.signone', 'Nobody in this view.'));
  return card('Win now vs rebuild', 'players the market prices differently for this season than for the long run',
    h('div', { style: { display: 'grid', gap: '14px' } },
      (now.length || later.length) ? h('div.sigcols',
        col('Win-now assets', 'worth more in redraft than dynasty — buy if you’re contending, sell if you’re rebuilding', now),
        col('Rebuild assets', 'worth more in dynasty than redraft — buy if you’re rebuilding, sell if you’re contending', later))
        : h('div.empty', { style: { padding: '18px' } }, S.redraftPricesMissing
          ? 'The value feed carried no redraft prices, so there is nothing to compare dynasty against.'
          : 'No player’s redraft and dynasty prices disagree enough to call.'),
      h('div.tiny.muted', 'Compared by rank among the players the market prices, so it works whatever the two values’ scales. A player has to rank at least 40% and six places better in one than the other. Follows the Rostered filter above.')));
}
/* a strength meter: one to three dots */
function pipsOf(s) {
  const n = s >= 0.66 ? 3 : s >= 0.45 ? 2 : 1;
  return h('span.pips', { title: 'signal strength: ' + (n === 3 ? 'strong' : n === 2 ? 'moderate' : 'mild') }, [1, 2, 3].map(i => h('i' + (i <= n ? '.on' : ''))));
}

/** The best of what nobody in the league has rostered. Ranked on market value by
 *  default, because that is what "most valuable" means — but the column worth
 *  sorting on for a waiver claim is the last one: how much a player would add
 *  to your own best lineup this week, which is zero for anyone who would sit. */
function waiverCard(ownerOf, me) {
  const fa = freeAgents().filter(p => (p.dv || 0) > 0 || (p.ppg || 0) > 0);
  const present = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].filter(pos => fa.some(p => p.pos === pos));
  const on = PlayersUI.faPos.length ? PlayersUI.faPos : present;
  const pool = fa.filter(p => on.includes(p.pos))
    .sort((a, b) => ((b.dv || 0) - (a.dv || 0)) || ((b.ppg || 0) - (a.ppg || 0)));
  const shown = pool.slice(0, PlayersUI.faLimit);
  // what each would add to your own optimal lineup, only for the rows on screen
  const adds = {};
  if (me) shown.forEach(p => { adds[p.id] = marginalAdd(me.players, me.taxi, me.ir, p, 'ppg'); });

  const chips = h('div.chipwrap', [
    h('button.chip' + (!PlayersUI.faPos.length ? '.on' : ''), { onclick: () => { PlayersUI.faPos = []; PlayersUI.faLimit = 15; render(); } }, 'All')
  ].concat(present.map(pos => h('button.chip' + (PlayersUI.faPos.includes(pos) ? '.on' : ''), {
    onclick: () => {
      PlayersUI.faPos = PlayersUI.faPos.includes(pos) ? PlayersUI.faPos.filter(x => x !== pos) : PlayersUI.faPos.concat([pos]);
      PlayersUI.faLimit = 15; render();
    }
  }, pos))));

  if (!pool.length) return card('On the waiver wire', null, h('div', { style: { display: 'grid', gap: '10px' } }, chips,
    h('div.empty', 'Nobody the market prices is unrostered in this league at ' + (PlayersUI.faPos.join(', ') || 'any position') + '.')));

  const best = me ? shown.slice().sort((a, b) => (adds[b.id] || 0) - (adds[a.id] || 0))[0] : null;
  const tbl = table([
    {
      k: 'name', h: 'Player', sort: r => r.name, f: r => isNarrow()
        ? h('div', { style: { minWidth: 0 } },
          h('div.row', { style: { gap: '6px', minWidth: 0, flexWrap: 'nowrap' } }, pname(r, { style: { fontWeight: 580 } }), injuryTag(r.injury, r)),
          h('div.tiny.muted', { style: { marginTop: '1px' } }, r.pos + (r.team ? ' · ' + r.team : '') + ' · ' + fmt(r.ppg || 0, 1) + '/wk'))
        : h('div.row', { style: { gap: '7px', minWidth: 0, flexWrap: 'nowrap' } }, pname(r, { style: { fontWeight: 580 } }), injuryTag(r.injury, r))
    },
    { k: 'pos', h: 'Pos', prio: isNarrow() ? 2 : 0, sort: r => r.pos, f: r => posPill(r.pos) },
    { k: 'team', prio: 2, h: 'NFL', sort: r => r.team || '', f: r => isSimple() && r.team ? h('span.row', { style: { gap: '5px' } }, teamLogo(r.team), h('span.tiny', r.team)) : h('span.tiny', r.team || '—') },
    { k: 'age', prio: 2, h: 'Age', num: true, sort: r => r.age || 0, f: r => r.age ? fmt(r.age, 1) : '—' },
    { k: 'dv', h: 'Value', num: true, sort: r => r.dv || 0, f: r => h('b.mono', kfmt(Math.round(r.dv || 0))) },
    { k: 'ppg', h: 'Proj/wk', num: true, prio: isNarrow() ? 2 : 0, sort: r => r.ppg || 0, f: r => h('span.mono', fmt(r.ppg || 0, 1)) },
    {
      k: 'add', h: me ? (isNarrow() ? 'Adds' : 'Adds to you') : 'Adds', num: true, sort: r => adds[r.id] || 0,
      tip: 'Points per week this player would add to your own best starting lineup, right now. Zero means he would sit on your bench.',
      f: r => (adds[r.id] || 0) > 0.05 ? h('b.mono.up', '+' + fmt(adds[r.id], 1)) : h('span.tiny.muted', 'bench')
    },
    { k: 'trend', prio: 2, h: '30d', num: true, sort: r => r.trend30 || 0, f: r => r.trend30 ? deltaTag(r.trend30, 0) : h('span.flat.tiny', '–') }
  ], shown, { sortKey: 'dv', sortDir: -1 });

  // Sleeper's weekly lines are only fetched for rostered players, so a free
  // agent's projection is the league-scoring estimate from his market rank
  return card('On the waiver wire',
    'the most valuable players nobody in this league has rostered · ' + pool.length + ' available · projections are estimated from market rank',
    h('div', { style: { display: 'grid', gap: '12px' } },
      chips,
      best && (adds[best.id] || 0) > 0.05
        ? h('div.wirebest',
          isSimple() ? playerFace(best, { lg: true }) : posPill(best.pos),
          h('div', { style: { minWidth: 0 } },
            h('div.tiny.muted', 'The one that helps you most'),
            h('div', h('b', pname(best, { face: false })), h('span.tiny.muted', ' · ' + best.pos + (best.team ? ' · ' + best.team : ''))),
            h('div.tiny.sec', '+' + fmt(adds[best.id], 1) + ' pts/wk to your best lineup, worth ' + kfmt(Math.round(best.dv || 0)))))
        : null,
      tbl,
      pool.length > shown.length
        ? h('div.row', { style: { justifyContent: 'center' } },
          h('button.btn', { onclick: () => { PlayersUI.faLimit += 15; render(); } }, 'Show ' + Math.min(15, pool.length - shown.length) + ' more'))
        : null));
}
