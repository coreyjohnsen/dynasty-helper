"use strict";
/* ================= 5. TRADE FINDER ================= */
const FinderUI = { team: null, mode: 'auto', results: null, tol: 0.14, positions: [], shape: 'any', partners: [], focus: null, signal: 'prefer', autorun: false, boardOpen: false, pickOpen: false, pickTab: 'mine', pst: { q: '', pos: 'all', limit: 30 } };
const SHAPES = [
  { k: 'any', label: 'Any shape', blurb: 'No constraint on how many pieces move each way.' },
  { k: 'consolidate', label: 'Uptier', blurb: 'Package two or three of your pieces for one better player — fewer, stronger starters.' },
  { k: 'spread', label: 'Downtier', blurb: 'Break one of your studs into several useful pieces — more depth, less top end.' },
  { k: 'even', label: 'One-for-one', blurb: 'Straight swaps only.' },
  { k: 'roster', label: 'Roster crunch', blurb: 'Two of your players for one better one — then use the roster spot you just freed on the best free agent available.' }
];
function viewFinder() {
  const teams = S.teams;
  if (FinderUI.team === null) FinderUI.team = (S.myRosterId || teams[0].rosterId);
  const T = S.teamById[FinderUI.team];
  const others = teams.filter(t => t.rosterId !== T.rosterId);
  const wrap = h('div.grid');
  // In a redraft league every team is contending by definition — there is no
  // future to rebuild toward — so the objective is fixed and the picker goes.
  const mode = !isDynasty() ? 'contend' : (FinderUI.mode === 'auto' ? windowToMode(T.window) : FinderUI.mode);
  const modeOpts = [{ k: 'auto', label: 'Auto (' + T.window + ')' }, { k: 'contend', label: 'Contend' }, { k: 'rebuild', label: 'Rebuild' }, { k: 'balanced', label: 'Balanced' }];
  const dirty = () => { FinderUI.results = null; };

  const toggle = (arr, v) => arr.includes(v) ? arr.filter(x => x !== v) : arr.concat([v]);
  const posChips = h('div.chipwrap', (isDynasty() ? ['QB', 'RB', 'WR', 'TE', 'PICK'] : ['QB', 'RB', 'WR', 'TE']).map(p =>
    h('button.chip' + (FinderUI.positions.includes(p) ? '.on' : ''), {
      onclick: () => { FinderUI.positions = toggle(FinderUI.positions, p); dirty(); render(); }
    }, p)));
  const partnerChips = () => h('div.chipwrap',
    [h('button.chip' + (FinderUI.partners.length === 0 ? '.on' : ''), {
      disabled: !!(focus && focus.side === 'get'),
      onclick: () => { FinderUI.partners = []; dirty(); render(); }
    }, 'Everyone')].concat(others.map(t =>
      h('button.chip' + ((focus && focus.side === 'get' ? focus.owner.rosterId === t.rosterId : FinderUI.partners.includes(t.rosterId)) ? '.on' : ''), {
        title: t.name + (t.window ? ' — ' + t.window : ''),
        disabled: !!(focus && focus.side === 'get'),
        onclick: () => { FinderUI.partners = toggle(FinderUI.partners, t.rosterId); dirty(); render(); }
      }, t.name))));

  /* ---- build around one player ---- */
  const ownerOf = {}; S.teams.forEach(t => t.players.forEach(p => ownerOf[p.id] = t));
  const focusP = FinderUI.focus ? S.index[FinderUI.focus] : null;
  const focusOwner = focusP ? ownerOf[focusP.id] : null;
  const focus = focusP && focusOwner ? {
    id: focusP.id, player: focusP, owner: focusOwner,
    side: focusOwner.rosterId === T.rosterId ? 'give' : 'get'
  } : null;
  const focusSel = (() => {
    const box = h('div', { style: { display: 'grid', gap: '10px' } });
    if (focus) box.appendChild(assetCard(assetOfPlayer(focusP), {
      compact: true, onRemove: () => { FinderUI.focus = null; dirty(); render(); },
      meta: focus.side === 'give' ? 'yours — shopping him' : 'on ' + focusOwner.name + ' — going to get him'
    }));
    box.appendChild(h('div.row', h('button.btn', { onclick: () => { FinderUI.pickOpen = !FinderUI.pickOpen; render(); } },
      ico(FinderUI.pickOpen ? 'chevup' : 'finder'), FinderUI.pickOpen ? 'Close the list' : focus ? 'Choose a different player' : 'Choose a player')));
    if (FinderUI.pickOpen) {
      const tab = FinderUI.pickTab === 'others' ? 'others' : 'mine';
      const pool = tab === 'mine' ? T.players : S.teams.filter(t => t.rosterId !== T.rosterId).reduce((x, t) => x.concat(t.players), []);
      box.appendChild(assetBrowser({
        id: 'fbrowse', color: tab === 'mine' ? 'a' : 'b', st: FinderUI.pst, picks: false, posOpts: ['all', 'QB', 'RB', 'WR', 'TE'],
        title: tab === 'mine' ? 'Shop one of yours' : 'Go and get someone', note: 'tap a player to build every suggestion around him',
        tabs: [{ k: 'mine', color: 'a', label: 'Your roster · sell' }, { k: 'others', color: 'b', label: 'Rest of the league · buy' }], tab,
        onTab: k => { FinderUI.pickTab = k; FinderUI.pst.pos = 'all'; FinderUI.pst.limit = 30; render(); },
        assets: pool.filter(p => (p.dv || 0) > 0).map(assetOfPlayer).sort((x, y) => y.dv - x.dv), chosen: new Set(focus ? [focus.id] : []),
        meta: a => (tab === 'others' && ownerOf[a.id] ? ownerOf[a.id].short + ' · ' : '') + assetMeta(a), placeholder: 'Search players…',
        onToggle: (a, inDeal) => { FinderUI.focus = inDeal ? null : a.id; FinderUI.pickOpen = false; dirty(); render(); }, onChange: () => render()
      }));
    }
    return box;
  })();
  const focusBlurb = !focus
    ? 'Pick anyone in the league and every suggestion will be built around them — one of yours to shop, or someone else’s to go and get.'
    : focus.side === 'give'
      ? `Shopping ${focusP.name}. Every package below sends them out, and the return has to move you forward on your own objective.`
      : `Going after ${focusP.name} from ${focusOwner.name}. Every package below brings them back, and ${focusOwner.short} has to want it too.`;

  const run = () => {
    FinderUI.results = findTrades(T, mode, FinderUI.tol, {
      positions: FinderUI.positions, shape: FinderUI.shape, partners: FinderUI.partners, focus: focus, signal: FinderUI.signal
    });
  };
  if (FinderUI.autorun) { FinderUI.autorun = false; run(); }

  wrap.appendChild(card('What are you trying to do?', 'the filters below are all optional', h('div', { style: { display: 'grid', gap: '14px' } },
    h('div.row', { style: { gap: '14px' } },
      h('div', { style: { flex: '1 1 300px', maxWidth: '440px', display: 'flex' } },
        teamCard('a', T, { key: 'finder', label: 'Your team', onPick: id => { FinderUI.team = id; FinderUI.partners = []; dirty(); render(); } })),
      dynOnly(h('label.fld', 'Strategy', segmented(modeOpts, FinderUI.mode, m => { FinderUI.mode = m; dirty(); render(); }))),
      h('label.fld', 'Value tolerance',
        h('select', { onchange: e => { FinderUI.tol = +e.target.value; dirty(); } },
          [[0.08, 'Tight (±8%)'], [0.14, 'Normal (±14%)'], [0.22, 'Loose (±22%)']].map(([v, l]) => h('option', { value: v, selected: FinderUI.tol === v }, l))))),
    h('div.tiny.muted', modeBlurb(mode)),
    h('div', { style: { borderTop: '1px solid var(--border)', paddingTop: '12px', display: 'grid', gap: '12px' } },
      h('div',
        h('div.row', { style: { justifyContent: 'space-between', marginBottom: '5px' } },
          h('label.fld', { style: { gap: 0 } }, 'Target positions'),
          FinderUI.positions.length ? h('button.btn.sm', { onclick: () => { FinderUI.positions = []; dirty(); render(); } }, 'Clear') : h('span.tiny.muted', 'off — any position')),
        posChips,
        FinderUI.positions.length ? h('div.tiny.muted', { style: { marginTop: '5px' } },
          'Every suggestion will bring back at least one ' + FinderUI.positions.join(' or ') + '.') : null),
      h('div',
        h('label.fld', { style: { gap: '4px' } }, 'Trade shape', segmented(SHAPES.map(s => ({ k: s.k, label: s.label })), FinderUI.shape, k => { FinderUI.shape = k; dirty(); render(); })),
        h('div.tiny.muted', { style: { marginTop: '5px' } }, (SHAPES.find(s => s.k === FinderUI.shape) || SHAPES[0]).blurb)),
      h('div',
        h('div.row', { style: { justifyContent: 'space-between', marginBottom: '5px' } },
          h('label.fld', { style: { gap: 0 } }, 'Trade partners'),
          h('span.tiny.muted', focus && focus.side === 'get' ? 'fixed — ' + focus.owner.name + ' owns him'
            : FinderUI.partners.length ? FinderUI.partners.length + ' selected' : 'off — every team')),
        partnerChips()),
      h('div',
        h('div.row', { style: { justifyContent: 'space-between', marginBottom: '5px' } },
          h('label.fld', { style: { gap: 0 } }, 'Build around one player'),
          focus ? h('button.btn.sm', { onclick: () => { FinderUI.focus = null; dirty(); render(); } }, 'Clear')
            : h('span.tiny.muted', 'off — any player')),
        focusSel,
        h('div.tiny.muted', { style: { marginTop: '5px' } }, focusBlurb))),
    h('div',
      h('label.fld', { style: { gap: '4px' } }, 'Market angle', segmented([
        { k: 'off', label: 'Ignore' }, { k: 'prefer', label: 'Prefer buy-low / sell-high' }, { k: 'only', label: 'Only those' }
      ], FinderUI.signal, k => { FinderUI.signal = k; dirty(); render(); })),
      h('div.tiny.muted', { style: { marginTop: '5px' } }, {
        off: 'Rank on lineup and future value alone.',
        prefer: 'Trades that sell a player the market is overpaying for, or buy one it is underpricing, rank higher.',
        only: 'Show only trades with a buy-low or sell-high player in them.'
      }[FinderUI.signal])),
    h('button.btn.pri', { onclick: () => { run(); render(); } }, 'Find trades')
  )));

  wrap.appendChild(signalBoard(T, (id) => { FinderUI.focus = id; FinderUI.partners = []; FinderUI.autorun = true; FinderUI.boardOpen = false; render(); window.scrollTo(0, 0); }));

  if (FinderUI.results) {
    const res = FinderUI.results;
    if (!res.list.length) wrap.appendChild(card('No matches', null, h('div.empty',
      h('div', { style: { fontWeight: 600, color: 'var(--text-secondary)' } }, 'Nothing cleared the bar'),
      h('div.tiny', { style: { marginTop: '6px', maxWidth: '460px', margin: '6px auto 0' } },
        'Every suggestion has to help both sides on their own objective and stay inside your value tolerance. '
        + (res.focus
          ? (res.focus.side === 'give'
            ? `Nothing on the board makes ${res.focus.player.name} worth moving at your current strategy — that is itself an answer. Try a looser tolerance, or a different objective.`
            : `${res.focus.owner.name} has no reason to part with ${res.focus.player.name} for anything you can put together right now. A looser tolerance or a different objective may open something up.`)
          : res.filtered ? `${kfmt(res.filtered)} combinations were thrown out by your filters alone — try loosening those first, then the tolerance.` : 'Try a looser tolerance, or a different strategy.')))));
    else {
      const activeFilters = [
        res.focus ? (res.focus.side === 'give' ? 'shopping ' + res.focus.player.name : 'buying ' + res.focus.player.name) : null,
        FinderUI.positions.length && !(res.focus && res.focus.side === 'get') ? 'targeting ' + FinderUI.positions.join('/') : null,
        FinderUI.shape !== 'any' ? (SHAPES.find(s => s.k === FinderUI.shape) || {}).label.toLowerCase() : null,
        !res.focus && FinderUI.partners.length ? FinderUI.partners.length + ' partner' + (FinderUI.partners.length > 1 ? 's' : '') : null
      ].filter(Boolean);
      const title = res.focus
        ? (res.focus.side === 'give'
          ? `${res.list.length} ways to move ${res.focus.player.name}`
          : `${res.list.length} ways to get ${res.focus.player.name}`)
        : `${res.list.length} trades worth proposing`;
      wrap.appendChild(card(title,
        `scanned ${kfmt(res.scanned)} combinations${activeFilters.length ? ' · ' + activeFilters.join(' · ') : ''} · both sides must gain on their own objective`,
        h('div', { style: { display: 'grid', gap: '9px' } }, res.list.map((r, i) => tradeCardRow(r, T, i)))));
    }
  }
  return wrap;
}
function windowToMode(w) { return ['Contend', 'Win-now'].includes(w) ? 'contend' : ['Rebuild', 'Retool'].includes(w) ? 'rebuild' : 'balanced'; }
function modeBlurb(m) {
  if (!isDynasty()) return 'Looking for deals that raise your starting lineup this season — the only season there is.';
  return {
    contend: 'Looking for deals that raise your starting lineup now — you give up youth and picks, you get proven production.',
    rebuild: 'Looking for deals that raise your future value — you sell aging producers for young players and draft capital.',
    balanced: 'Looking for deals that add value on both timelines without punting either one.'
  }[m];
}
function objectiveFor(mode) {
  // with one timeline, the objective is simply this week's lineup
  if (!isDynasty()) return (b, a) => a.now - b.now;
  if (mode === 'contend') return (b, a) => (a.now - b.now) * 1.0 + (a.future - b.future) * 0.18;
  if (mode === 'rebuild') return (b, a) => (a.future - b.future) * 1.0 + (a.now - b.now) * 0.12 + (a.pickCapital - b.pickCapital) / 900;
  return (b, a) => (a.now - b.now) * 0.55 + (a.future - b.future) * 0.55;
}
/** The free agents worth evaluating: the best weekly producers plus the most
 *  valuable stashes. Cached on the free-agent list itself, so it clears whenever
 *  the sandbox rebuilds ownership. */
function faPool() {
  const all = freeAgents();
  if (all._pool) return all._pool;
  const byPpg = all.slice(0, 34);
  const seen = new Set(byPpg.map(p => p.id));
  const byVal = all.slice().sort((a, b) => (b.dv || 0) - (a.dv || 0)).filter(p => !seen.has(p.id)).slice(0, 16);
  all._pool = byPpg.concat(byVal);
  return all._pool;
}
/** With a roster spot just freed, who is the best signing? Scored on what they
 *  would actually add to the optimal lineup now and later, with a nod to raw
 *  dynasty value so a young stash isn't ignored. */
function bestFreeAgentFor(players, taxi, ir, n) {
  const scored = faPool().map(fa => {
    const gain = marginalAdd(players, taxi, ir, fa, 'ppg');
    const future = isDynasty() ? marginalAdd(players, taxi, ir, fa, 'fppg') : 0;
    return { p: fa, gain: gain, future: future, score: gain + 0.35 * future + (fa.dv || 0) / 4000 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, n || 2);
}
/* ---------- what a package is worth ----------
   Adding up trade values treats two 4k players as a 8k asset. They are not: the
   team receiving them has to start one, bench or cut the other, and the team
   sending the single better player has given up the one scarce thing. So the
   best piece of a package counts in full, and each further player counts for
   less. Picks occupy no roster spot, so they count in full. */
const DEPTH_W = [1, 0.88, 0.78, 0.7];
function packageValue(assets) {
  const pl = assets.filter(a => a.kind === 'player').map(a => a.dv).sort((a, b) => b - a);
  const pk = assets.filter(a => a.kind !== 'player').reduce((x, a) => x + a.dv, 0);
  return pl.reduce((x, v, i) => x + v * (DEPTH_W[i] !== undefined ? DEPTH_W[i] : 0.6), 0) + pk;
}

/* ---------- buy low / sell high ----------
   A player's price is the market's opinion; his scoring is the evidence. Where
   they disagree there is a trade: scoring well under what his value implies is a
   buy-low (the price is ahead of the production, and the gap tends to close on a
   rebound); scoring well over it, or sitting at a peak or an age cliff, is a
   sell-high. Production is only believed in proportion to how many games it
   rests on, and a young player is not expected to produce what his future is
   priced at. */
const AGE_CLIFF = { RB: 27, WR: 29, TE: 30, QB: 35 };
function computeSignal(x, cal) {
  const p = x.p, n = x.n, actual = x.actual;
  // what his value rank typically scores, scaled by how this league's players of that
  // position really score against the same curve
  const expected = x.base * cal;
  let buy = 0, sell = 0; const rb = [], rs = [];
  /* A weekly score is noisy — about half the player's average either side — so
     a few games prove little. The gap is judged against the noise it could be
     (variance for his position, shrinking with the square root of games played):
     two games need a huge gap, sixteen need a modest one. */
  if (n >= 2 && expected > 3) {
    const se = (POS_CV[p.pos] || 0.58) * expected / Math.sqrt(n);
    const z = (actual - expected) / se, ratio = actual / expected - 1;
    if (z <= -1.05 && ratio <= -0.2) { buy += clamp((-z - 0.5) / 1.5, 0.2, 1); rb.push(`scoring ${fmt(actual, 1)} pts/wk against ~${fmt(expected, 1)} typical for his value`); }
    else if (z >= 1.05 && ratio >= 0.2) { sell += clamp((z - 0.5) / 1.5, 0.2, 1); rs.push(`scoring ${fmt(actual, 1)} pts/wk, well above the ~${fmt(expected, 1)} his value implies`); }
  }
  const tr = p.trend30 ? p.trend30 / Math.max(1, p.dv) : 0;
  /* a month of price movement is routine, so on its own it never flags anyone —
     it only reinforces a read that production, age or injury has already made */
  if (tr <= -0.08 && (p.age || 99) <= 27) { buy += 0.2; rb.push(`value down ${Math.round(-tr * 100)}% in 30 days`); }
  if (tr >= 0.10) { sell += 0.2; rs.push(`value up ${Math.round(tr * 100)}% in 30 days — close to a peak`); }
  if (p.age && AGE_CLIFF[p.pos] && p.age >= AGE_CLIFF[p.pos] && p.dv >= 1200) { sell += 0.5; rs.push(`age ${fmt(p.age, 0)} ${p.pos} — values fall away from here`); }
  if (x.recovering) {
    /* Back soon: his price is low because he is hurt, but only for a few weeks. That is
       the one injured case worth flagging — and only as a buy, never a sell. */
    sell = 0; rs.length = 0;
    const left = Math.max(0, S.regEnd - p.inj.R + 1);
    if (tr <= -0.05) { buy += 0.45; rb.push(`out until ${p.inj.label.toLowerCase().replace('wk', 'week')}, and his price is down ${Math.round(-tr * 100)}% — he returns with ${left} regular-season game${left === 1 ? '' : 's'} left`); }
    else if (buy > 0) rb.push(`back ${p.inj.label.toLowerCase().replace('wk', 'week')}, so the dip is short-term`);
  }
  if (Math.max(buy, sell) < 0.35) return null;
  const kind = buy > sell ? 'buy' : 'sell';
  return { kind, strength: Math.min(1, Math.max(buy, sell)), reasons: kind === 'buy' ? rb : rs, actual, expected, games: n };
}
/** id -> signal, for every player worth flagging. Rebuilt when the values change. */
function signalMap() {
  if (S._sig) return S._sig;
  const rank = {};
  POS4.forEach(pos => Object.values(S.index).filter(p => p.pos === pos && (p.dv || 0) > 0)
    .sort((a, b) => b.dv - a.dv).forEach((p, i) => { rank[p.id] = i + 1; }));
  /* A player who is out, doubtful or parked in an IR slot is not mispriced: his price is
     low because he is hurt, and a season-ending injury means he cannot help this year
     either. His recent scoring is also unreliable (partial games drag it down). So he is
     left out of the board altogether, in both directions. */
  const hurt = new Set(); S.teams.forEach(t => t.ir.forEach(id => hurt.add(id)));
  // Sleeper often records a long-term injury only in the player's status, leaving the
  // injury tag empty, so the status is read too
  const returnsSoon = (p) => !!(INJ.enabled() && p.inj && p.inj.kind === 'long' && !p.inj.season
    && p.inj.R - injCurrentWeek() <= 3 && S.regEnd - p.inj.R >= 2);
  const unavailable = (p) => !returnsSoon(p) && (hurt.has(p.id) || OUT_TAGS.includes(p.injury) || p.injury === 'Doubtful'
    || /injured|physically|suspended|retired/i.test(((S.players[p.id] || {}).st) || ''));
  const info = {};
  Object.values(S.index).forEach(p => {
    if (!POS4.includes(p.pos) || (p.dv || 0) < 900 || !rank[p.id] || unavailable(p)) return;
    const games = playerGameLog(p.id).filter(g => g.state === 'final' && g.pts !== null && g.pts > 0);
    // a young player is not expected to produce what his future is priced at
    const youth = p.age ? clamp(0.78 + (p.age - 21) * 0.07, 0.78, 1) : 1;
    info[p.id] = { p, recovering: returnsSoon(p), n: games.length, actual: games.length ? mean(games.map(g => g.pts)) : null,
      base: scoringAdjust(p.pos, curveLookup(p.pos, rank[p.id]), rank[p.id], S.cfg) * youth };
  });
  // Scoring format, a tight-end premium or the curve itself shift every player of a
  // position the same way. The league's own median answers to that, so a flag means
  // "scoring less than comparably priced players here", not "off a fixed curve".
  const cal = {};
  POS4.forEach(pos => {
    const rs = Object.values(info).filter(x => x.p.pos === pos && x.n >= 2 && x.base > 3).map(x => x.actual / x.base).sort((a, b) => a - b);
    cal[pos] = rs.length >= 8 ? rs[Math.floor(rs.length / 2)] : 1;
  });
  const out = {};
  Object.values(info).forEach(x => { const s = computeSignal(x, cal[x.p.pos]); if (s) out[x.p.id] = s; });
  return (S._sig = out);
}

/* ---------- win now / rebuild ----------
   The market prices every player twice: for this season (redraft) and for the
   long run (dynasty). Where the two disagree, the player has a timeline. Worth
   more this season than the long run — an older producer, a short window — is a
   win-now asset: the right buy for a contender and the right sale for a
   rebuild. Worth more over the long run — young, stashed, unproven — is the
   opposite. Compared by rank, not raw value, so it does not matter that the two
   prices sit on different scales. Needs both prices, so a redraft league (which
   has no long run) and a response without redraft prices get nothing. */
function timelineMap() {
  if (S._tl) return S._tl;
  const out = {};
  if (!isDynasty() || S.redraftPricesMissing) return (S._tl = out);
  const rows = Object.values(S.index).filter(p => POS4.includes(p.pos));
  const rank = (key) => {
    const r = {}; rows.filter(p => (p[key] || 0) > 0).sort((a, b) => b[key] - a[key]).forEach((p, i) => { r[p.id] = i + 1; });
    return r;
  };
  const red = rank('rv'), dyn = rank('dvDyn');
  rows.forEach(p => {
    const r = red[p.id], d = dyn[p.id];
    if (!r || !d || Math.min(r, d) > 150) return;
    const ratio = d / r, gap = d - r;
    const base = { redRank: r, dynRank: d, ratio, gap };
    if (ratio >= 1.4 && gap >= 6) out[p.id] = Object.assign({ kind: 'now', strength: clamp(Math.log(ratio) / Math.log(3), 0.2, 1) }, base);
    else if (ratio <= 1 / 1.4 && gap <= -6) out[p.id] = Object.assign({ kind: 'later', strength: clamp(Math.log(1 / ratio) / Math.log(3), 0.2, 1) }, base);
  });
  return (S._tl = out);
}
const TL_LABEL = { now: 'Win now', later: 'Rebuild' };
function timelineWhy(t) {
  return t.kind === 'now'
    ? `Redraft #${t.redRank} but dynasty #${t.dynRank}: worth more this season than over the long run. A contender’s buy, a rebuilder’s sale.`
    : `Dynasty #${t.dynRank} but redraft #${t.redRank}: worth more over the long run than this season. A rebuilder’s buy, a contender’s sale.`;
}
/** The small tags that say what the market thinks of a player. */
function marketTags(p) {
  const s = signalMap()[p.id], t = timelineMap()[p.id];
  if (!s && !t) return null;
  return h('span.ptags',
    s ? h('span.sigtag.' + s.kind, { title: s.reasons.join(' · ') }, s.kind === 'buy' ? 'Buy low' : 'Sell high') : null,
    t ? h('span.sigtag.' + t.kind, { title: timelineWhy(t) }, TL_LABEL[t.kind]) : null);
}
/** Jump to the Finder with a search already built around this player. */
function shopInFinder(id) {
  FinderUI.team = S.myRosterId; FinderUI.focus = String(id); FinderUI.partners = []; FinderUI.autorun = true;
  S.view = 'finder'; render(); window.scrollTo(0, 0);
}

/* ---------- why a trade works ----------
   A list of numbers is not a reason. These are the reasons, in plain words:
   what hole it fills for you, why the other side would say yes, what it does to
   your lineup and your age curve, what the market is mispricing, and what it
   costs on the roster. */
function explainTrade(r, T, scT, scP) {
  const out = [];
  const P = r.partner;
  const gp = r.give.filter(a => a.kind === 'player'), tp = r.get.filter(a => a.kind === 'player');
  const names = (arr) => arr.map(a => a.name).join(' + ');
  const gotPos = Array.from(new Set(tp.map(a => a.pos)));
  const myHole = scT.holes.find(x => gotPos.includes(x.pos));
  if (myHole) out.push({ k: 'need', t: `You’re thin at ${myHole.pos} (${myHole.startable} startable for ${myHole.need} lineup spots), and ${names(tp.filter(a => a.pos === myHole.pos))} fills it.` });
  const after = optimalLineup(afterRoster(T, r.give, r.get).filter(p => !T.taxi.has(p.id) && !T.ir.has(p.id)), 'ppg');
  const newSt = after.filter(s => s.player && !T.starterIds.has(s.player.id)).sort((a, b) => b.player.ppg - a.player.ppg);
  const dNow = r.myAfter.now - r.myBase.now;
  if (newSt.length && dNow > 0.05) {
    const s = newSt[0];
    out.push({ k: 'lineup', t: `${s.player.name} starts at ${SLOT_LABEL[s.slot] || s.slot} (${fmt(s.player.ppg, 1)} pts/wk) — your lineup improves by ${fmt(dNow, 1)} pts/wk.` });
  }
  const theirHole = scP.holes.find(x => r.give.some(a => a.pos === x.pos));
  if (theirHole) out.push({ k: 'them', t: `${P.name} is thin at ${theirHole.pos}; ${names(r.give.filter(a => a.pos === theirHole.pos))} solves that, which is why they’d say yes.` });
  else if (r.pGain > 0) out.push({ k: 'them', t: `${P.name}${P.window ? ' (' + P.window.toLowerCase() + ')' : ''} also comes out ahead on their own plan, so there’s something in it for them.` });
  if (isDynasty()) {
    const ag = (arr) => { const x = arr.filter(a => a.kind === 'player' && a.ref.age); return x.length ? sum(x.map(a => a.ref.age * a.dv)) / sum(x.map(a => a.dv)) : null; };
    const a1 = ag(r.give), a2 = ag(r.get);
    if (a1 && a2 && Math.abs(a1 - a2) >= 2) out.push({ k: 'age', t: a2 < a1 ? `You get younger — ${fmt(a2, 1)} against ${fmt(a1, 1)} years on average, value that holds.` : `You get older — ${fmt(a2, 1)} against ${fmt(a1, 1)} years: more now, a shorter shelf life.` });
  }
  (r.signals || []).slice(0, 2).forEach(s => out.push({ k: s.kind, t: `${s.kind === 'buy' ? 'Buy low' : 'Sell high'}: ${s.asset.name} — ${s.reasons[0]}.` }));
  if (r.theirDrops && r.theirDrops.length) out.push({ k: 'cost', t: `${P.short} would have to cut ${names(r.theirDrops.map(p => ({ name: p.name })))} to fit the extra roster spot.` });
  if (r.myDrops && r.myDrops.length) out.push({ k: 'cost', t: `You’d have to cut ${names(r.myDrops.map(p => ({ name: p.name })))} to fit.` });
  return out;
}

function findTrades(T, mode, tol, filters) {
  filters = filters || {};
  const wantPos = filters.positions || [];
  const shape = filters.shape || 'any';
  const focus = filters.focus || null;
  // a named player on someone else's roster fixes who you are dealing with
  const partners = focus && focus.side === 'get' ? [focus.owner.rosterId] : (filters.partners || []);
  const myObj = objectiveFor(mode);
  const spots = S.cfg.activeSpots || 0;
  const sigMap = signalMap();
  /* Roster side of a hypothetical swap, with picks left unpriced for now. A team
     that lands more bodies than it sends has to cut down to its active limit, so
     its cheapest bench players leave — and that is a cost of the trade, not a
     footnote to it. A trade with nobody droppable to cut cannot be made at all. */
  const shellQ = (t, out, inc) => {
    const rm = new Set(out.filter(a => a.kind === 'player').map(a => a.id));
    const incP = inc.filter(a => a.kind === 'player').map(a => a.ref);
    let players = t.players.filter(p => !rm.has(p.id)).concat(incP);
    const rmp = new Set(out.filter(a => a.kind === 'pick').map(a => a.id));
    const picks = t.pickAssets.filter(p => !rmp.has(p.id)).concat(inc.filter(a => a.kind === 'pick').map(a => a.ref));
    let act = players.filter(p => !t.taxi.has(p.id) && !t.ir.has(p.id));
    let drops = [], infeasible = false;
    if (spots > 0) {
      const before = t.players.filter(p => !t.taxi.has(p.id) && !t.ir.has(p.id)).length;
      const over = act.length - Math.max(spots, before);
      if (over > 0) {
        const incIds = new Set(incP.map(p => p.id));
        const lu = new Set(optimalLineup(act, 'ppg').filter(s => s.player).map(s => s.player.id));
        drops = act.filter(p => !incIds.has(p.id) && !lu.has(p.id)).sort((a, b) => (a.dv || 0) - (b.dv || 0)).slice(0, over);
        if (drops.length < over) infeasible = true;
        const dr = new Set(drops.map(p => p.id));
        players = players.filter(p => !dr.has(p.id)); act = act.filter(p => !dr.has(p.id));
      }
    }
    const now = lineupPoints(act, 'ppg');
    return { picks, now, futureRoster: isDynasty() ? lineupPoints(players, 'fppg') : now, drops, infeasible, dropCost: sum(drops.map(p => p.dv || 0)) };
  };
  /* Both sides at once, because the picks have to be priced against the standings
     the swap produces — improving your roster pushes your own picks later. */
  const evalPair = (T1, T2, give, get) => {
    const a = shellQ(T1, give, get), b = shellQ(T2, get, give);
    const ov = {};
    ov[T1.rosterId] = { now: a.now, futureRoster: a.futureRoster };
    ov[T2.rosterId] = { now: b.now, futureRoster: b.futureRoster };
    const price = isDynasty() ? pickPricer(ov) : null;
    const capA = price ? sum(a.picks.map(pk => price(pk).value)) : 0;
    const capB = price ? sum(b.picks.map(pk => price(pk).value)) : 0;
    // a cut is a real loss, but half of it is the replacement-level scrub who can be re-signed
    return [
      { now: a.now, future: a.futureRoster + capA / 620 - a.dropCost * 0.5 / 620, pickCapital: capA, drops: a.drops, infeasible: a.infeasible },
      { now: b.now, future: b.futureRoster + capB / 620 - b.dropCost * 0.5 / 620, pickCapital: capB, drops: b.drops, infeasible: b.infeasible }
    ];
  };
  const quick = (t, out, inc) => {
    const sh = shellQ(t, out, inc);
    const price = isDynasty() ? pickPricer(null) : null;
    const cap = price ? sum(sh.picks.map(pk => price(pk).value)) : 0;
    return { now: sh.now, future: sh.futureRoster + cap / 620, pickCapital: cap };
  };
  const shapeOk = (give, get) => {
    if (shape === 'even') return give.length === 1 && get.length === 1;
    // roster crunch: two bodies out, one body in — picks don't occupy a roster spot,
    // so a package with a pick in it wouldn't actually free anything
    if (shape === 'roster') return give.length === 2 && get.length === 1 &&
      give.every(a => a.kind === 'player') && get[0].kind === 'player' &&
      get[0].dv > Math.max(give[0].dv, give[1].dv);
    if (shape === 'consolidate') return give.length >= 2 && get.length === 1 &&
      Math.max.apply(null, get.map(a => a.dv)) > Math.max.apply(null, give.map(a => a.dv));
    if (shape === 'spread') return give.length === 1 && get.length >= 2 &&
      Math.max.apply(null, give.map(a => a.dv)) > Math.max.apply(null, get.map(a => a.dv));
    return true;
  };
  // when the user has named the player they want, they have already said which
  // position they are shopping for
  const posOk = (get) => !wantPos.length || (focus && focus.side === 'get') || get.some(a => wantPos.includes(a.pos));

  const myBase = quick(T, [], []);
  const scT = scoutTeam(T);
  let mine = assetsOf(T).filter(a => a.dv > 180).sort((a, b) => b.dv - a.dv).slice(0, 20);
  // a focus player has to be in the pool even if the value cut would have dropped them
  let focusAsset = null;
  if (focus && focus.side === 'give') {
    focusAsset = assetsOf(T).find(a => a.id === focus.id) || null;
    if (focusAsset && !mine.some(a => a.id === focusAsset.id)) mine = mine.concat([focusAsset]);
  }
  const out = []; let scanned = 0, filtered = 0;
  const pool = S.teams.filter(P => P.rosterId !== T.rosterId && (!partners.length || partners.includes(P.rosterId)));

  pool.forEach(P => {
    const pMode = windowToMode(P.window);
    const pObj = objectiveFor(pMode);
    const pBase = quick(P, [], []);
    let theirs = assetsOf(P).filter(a => a.dv > 180).sort((a, b) => b.dv - a.dv).slice(0, 22);
    // when the user is hunting a position, make sure enough of it survives the top-N cut
    if (wantPos.length) {
      const wanted = assetsOf(P).filter(a => a.dv > 120 && wantPos.includes(a.pos)).sort((a, b) => b.dv - a.dv).slice(0, 14);
      const seen = new Set(theirs.map(a => a.id));
      theirs = theirs.concat(wanted.filter(a => !seen.has(a.id)));
    }
    if (focus && focus.side === 'get' && P.rosterId === focus.owner.rosterId) {
      const fa = assetsOf(P).find(a => a.id === focus.id);
      if (fa && !theirs.some(a => a.id === fa.id)) theirs = theirs.concat([fa]);
    }
    const combos = [];
    const M = Math.min(mine.length, 14), N = Math.min(theirs.length, 16);

    /* ---- built around one named player ---- */
    if (focus) {
      const F = focus.side === 'give' ? focusAsset : (assetsOf(P).find(a => a.id === focus.id) || null);
      if (!F) return;
      const pair = (giveArr, getArr) => combos.push([giveArr, getArr]);
      if (focus.side === 'give') {
        const mp = mine.filter(a => a.id !== F.id).slice(0, 12);
        const tp = theirs.slice(0, 16), tpS = theirs.slice(0, 10);
        tp.forEach(t2 => pair([F], [t2]));
        for (let i = 0; i < tp.length; i++) for (let j = i + 1; j < tp.length; j++) pair([F], [tp[i], tp[j]]);
        for (let i = 0; i < tpS.length; i++) for (let j = i + 1; j < tpS.length; j++) for (let k = j + 1; k < tpS.length; k++) pair([F], [tpS[i], tpS[j], tpS[k]]);
        mp.forEach(m => {
          tp.forEach(t2 => pair([F, m], [t2]));
          for (let i = 0; i < tpS.length; i++) for (let j = i + 1; j < tpS.length; j++) pair([F, m], [tpS[i], tpS[j]]);
        });
      } else {
        // only one partner to search, so it can afford to be thorough
        const tp = theirs.filter(a => a.id !== F.id).slice(0, 12);
        const mp = mine.slice(0, 18), mpS = mine.slice(0, 12);
        mp.forEach(m => pair([m], [F]));
        for (let i = 0; i < mpS.length; i++) for (let j = i + 1; j < mpS.length; j++) pair([mpS[i], mpS[j]], [F]);
        for (let i = 0; i < Math.min(mpS.length, 10); i++) for (let j = i + 1; j < Math.min(mpS.length, 10); j++) for (let k = j + 1; k < Math.min(mpS.length, 10); k++) pair([mpS[i], mpS[j], mpS[k]], [F]);
        // they may want to send a second piece back to balance a big overpay
        tp.forEach(t2 => {
          mp.forEach(m => pair([m], [F, t2]));
          for (let i = 0; i < Math.min(mpS.length, 10); i++) for (let j = i + 1; j < Math.min(mpS.length, 10); j++) pair([mpS[i], mpS[j]], [F, t2]);
        });
      }
    }

    if (!focus && (shape === 'any' || shape === 'even')) mine.forEach(m => theirs.forEach(t2 => combos.push([[m], [t2]])));
    if (!focus && shape === 'roster') {
      const mp = mine.filter(a => a.kind === 'player').slice(0, 14);
      const tp = theirs.filter(a => a.kind === 'player').slice(0, 16);
      for (let i = 0; i < mp.length; i++) for (let j = i + 1; j < mp.length; j++)
        tp.forEach(t2 => combos.push([[mp[i], mp[j]], [t2]]));
    }
    if (!focus && (shape === 'any' || shape === 'consolidate')) {
      for (let i = 0; i < M; i++) for (let j = i + 1; j < M; j++)
        theirs.slice(0, N).forEach(t2 => combos.push([[mine[i], mine[j]], [t2]]));
      if (shape === 'consolidate') {
        for (let i = 0; i < Math.min(M, 9); i++) for (let j = i + 1; j < Math.min(M, 9); j++) for (let k = j + 1; k < Math.min(M, 9); k++)
          theirs.slice(0, 10).forEach(t2 => combos.push([[mine[i], mine[j], mine[k]], [t2]]));
      }
    }
    if (!focus && (shape === 'any' || shape === 'spread')) {
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++)
        mine.slice(0, M).forEach(m => combos.push([[m], [theirs[i], theirs[j]]]));
      if (shape === 'spread') {
        for (let i = 0; i < Math.min(N, 10); i++) for (let j = i + 1; j < Math.min(N, 10); j++) for (let k = j + 1; k < Math.min(N, 10); k++)
          mine.slice(0, 9).forEach(m => combos.push([[m], [theirs[i], theirs[j], theirs[k]]]));
      }
    }

    /* ---- built from need: what each side is actually missing ----
       The enumeration above only ever produces 1-for-1, 2-for-1 and 1-for-2. Real
       deals are often 2-for-2 or 3-for-2, because two rosters rarely line up
       one piece against one. So start from the hole instead: pick the players
       on their roster that fill yours, then assemble packages from the things I
       can spare (a surplus position, a position they are short at, picks) whose
       worth lands on theirs, and let the value check and both lineups decide. */
    if (!focus) {
      const scP = scoutTeam(P);
      const wanted = wantPos.length ? wantPos.filter(x => POS4.includes(x)) : (scT.holes.length ? scT.holes.map(x => x.pos) : scP.surplus.map(x => x.pos));
      const tgt = assetsOf(P).filter(a => a.kind === 'player' && wanted.includes(a.pos) && a.dv > 400).sort((a, b) => b.dv - a.dv).slice(0, 5);
      const theirHoles = scP.holes.map(x => x.pos), mySurplus = scT.surplus.map(x => x.pos);
      let cur = mine.filter(a => a.kind === 'pick' || mySurplus.includes(a.pos) || theirHoles.includes(a.pos)).slice(0, 12);
      if (cur.length < 8) cur = cur.concat(mine.filter(a => !cur.includes(a)).slice(0, 8 - cur.length));
      const sets = tgt.map(a => [a]);
      for (let i = 0; i < Math.min(tgt.length, 4); i++) for (let j = i + 1; j < Math.min(tgt.length, 4); j++) sets.push([tgt[i], tgt[j]]);
      const loB = 1 - tol - 0.03, hiB = 1 / loB;
      sets.forEach(gs => {
        const target = packageValue(gs);
        const fits = (g) => { const v = packageValue(g); return v >= target * loB && v <= target * hiB; };
        for (let i = 0; i < cur.length; i++) {
          if (fits([cur[i]])) combos.push([[cur[i]], gs]);
          for (let j = i + 1; j < cur.length; j++) {
            if (fits([cur[i], cur[j]])) combos.push([[cur[i], cur[j]], gs]);
            for (let k = j + 1; k < cur.length; k++) if (fits([cur[i], cur[j], cur[k]])) combos.push([[cur[i], cur[j], cur[k]], gs]);
          }
        }
      });
    }

    const seenCombo = new Set();
    combos.forEach(([give, get]) => {
      const ck = give.map(a => a.id).sort().join('+') + '>' + get.map(a => a.id).sort().join('+');
      if (seenCombo.has(ck)) return;
      seenCombo.add(ck);
      scanned++;
      if (!posOk(get) || !shapeOk(give, get)) { filtered++; return; }
      const gv = packageValue(give), gt = packageValue(get);
      if (gv <= 0 || gt <= 0) return;
      const hi = Math.max(gv, gt), lo = Math.min(gv, gt);
      if (lo / hi < 1 - tol) return;
      const pair = evalPair(T, P, give, get);
      const myAfter = pair[0], pAfter = pair[1];
      if (myAfter.infeasible || pAfter.infeasible) return;
      const myGain = myObj(myBase, myAfter);
      if (myGain <= 0.12) return;
      const pGain = pObj(pBase, pAfter);
      if (pGain <= 0.08) return;
      // the market angle: selling what the market overpays for, buying what it underprices
      const signal = sum(give.map(a => sigMap[a.id] && sigMap[a.id].kind === 'sell' ? sigMap[a.id].strength : 0))
        + sum(get.map(a => sigMap[a.id] && sigMap[a.id].kind === 'buy' ? sigMap[a.id].strength : 0));
      if (filters.signal === 'only' && signal < 0.35) return;
      out.push({ partner: P, give, get, myGain, pGain, gv, gt, myAfter, myBase, signal, myDrops: myAfter.drops, theirDrops: pAfter.drops,
        score: myGain + pGain * 0.55 + (filters.signal === 'off' ? 0 : 0.35 * signal)
          - 0.12 * pAfter.drops.length - 0.04 * myAfter.drops.length, fair: lo / hi });
    });
  });
  out.sort((a, b) => b.score - a.score);
  // keep the list varied — unless the user narrowed to a few partners, in which case show them more
  const perPartner = partners.length ? Math.max(4, Math.ceil(20 / partners.length)) : (focus ? 4 : 3);
  // with one player in the frame the user wants several ways to move them, not
  // one idea per partner
  const perPackage = focus ? 4 : 2;
  const seenP = {}, seenA = {}, seenG = {}, list = [];
  for (const r of out) {
    const kp = r.partner.rosterId;
    const ka = r.give.map(a => a.id).sort().join('+');
    const kg = kp + '|' + r.get.map(a => a.id).sort().join('+');
    if ((seenP[kp] || 0) >= perPartner) continue;
    if ((seenA[ka] || 0) >= perPackage) continue;
    // don't show the same target package from the same partner more than once —
    // three ways to buy the same player reads as noise, not as three ideas
    if (seenG[kg]) continue;
    seenP[kp] = (seenP[kp] || 0) + 1; seenA[ka] = (seenA[ka] || 0) + 1; seenG[kg] = 1;
    list.push(r); if (list.length >= 20) break;
  }
  // only the shortlist gets a free-agent backfill — running it inside the scan
  // would cost a lineup solve per combination for no benefit
  list.forEach(r => {
    const freed = r.give.filter(a => a.kind === 'player').length - r.get.filter(a => a.kind === 'player').length;
    if (freed < 1) return;
    r.freed = freed;
    r.fa = bestFreeAgentFor(afterRoster(T, r.give, r.get), T.taxi, T.ir, 2);
  });
  // the shortlist is small, so this is where the reasons get worked out
  list.forEach(r => {
    r.signals = [];
    r.give.forEach(a => { const s = a.kind === 'player' && sigMap[a.id]; if (s && s.kind === 'sell') r.signals.push(Object.assign({ asset: a, side: 'give' }, s)); });
    r.get.forEach(a => { const s = a.kind === 'player' && sigMap[a.id]; if (s && s.kind === 'buy') r.signals.push(Object.assign({ asset: a, side: 'get' }, s)); });
    r.why = explainTrade(r, T, scT, scoutTeam(r.partner));
  });
  return { list, scanned, filtered, focus };
}
/* ---------- the buy-low / sell-high board ---------- */
function signalBoard(T, shop) {
  const sg = signalMap();
  const owner = {}; S.teams.forEach(t => t.players.forEach(p => { owner[p.id] = t; }));
  const rows = Object.keys(sg).map(id => ({ p: S.index[id], s: sg[id], o: owner[id] })).filter(x => x.o && x.p);
  const rank = (a, b) => (b.s.strength - a.s.strength) || (b.p.dv - a.p.dv);
  const mine = rows.filter(x => x.o.rosterId === T.rosterId);
  const sells = mine.filter(x => x.s.kind === 'sell').sort(rank).slice(0, 5);
  const holds = mine.filter(x => x.s.kind === 'buy').sort(rank).slice(0, 3);
  const buys = rows.filter(x => x.o.rosterId !== T.rosterId && x.s.kind === 'buy').sort(rank).slice(0, 6);
  const pips = pipsOf;
  const rowEl = (x, verb, where) => h('div.sigrow', { class: rowMedal(x.p) },
    isSimple() ? playerFace(x.p) : posPill(x.p.pos),
    h('div.sigmain',
      h('div.row', { style: { gap: '6px', flexWrap: 'nowrap' } }, pname(x.p, { face: false, style: { fontWeight: '640' } }), pips(x.s.strength)),
      h('div.tiny.muted', `${x.p.pos}${x.p.posRank || ''} · ${x.p.team || 'FA'} · ${kfmt(Math.round(x.p.dv || 0))}${where ? ' · ' + x.o.name : ''}`),
      h('div.tiny.sec.sigwhy', x.s.reasons.join(' · '))),
    verb ? h('button.btn.sm', { onclick: () => shop(x.p.id) }, verb) : null);
  const col = (title, note, list, verb, where) => h('div.sigcol',
    h('div.sigh', h('b', title), h('span.tiny.muted', note)),
    list.length ? h('div.sigrows', list.map(x => rowEl(x, verb, where))) : h('div.tiny.muted.signone', 'Nothing flagged.'));
  const any = sells.length || buys.length || holds.length;
  // the totals, not just what fits on screen, so the closed bar still says how much is in it
  const nSell = mine.filter(x => x.s.kind === 'sell').length, nHold = mine.filter(x => x.s.kind === 'buy').length;
  const nBuy = rows.filter(x => x.o.rosterId !== T.rosterId && x.s.kind === 'buy').length;
  const summary = any ? [nSell ? nSell + ' to sell' : null, nBuy ? nBuy + ' to buy' : null, nHold ? nHold + ' to hold' : null].filter(Boolean).join(' · ') : 'nothing flagged right now';
  const open = FinderUI.boardOpen;
  return h('div.card.collapsible' + (open ? '.open' : ''),
    h('button.chd', { 'aria-expanded': open ? 'true' : 'false', onclick: () => { FinderUI.boardOpen = !FinderUI.boardOpen; render(); } },
      h('div.chd-t', h('h3', 'Buy low / sell high ideas'), h('span.note', summary)),
      h('span.chd-hint', open ? 'Hide' : 'Show'), h('span.chev', ico('chev'))),
    open ? h('div.bd', { style: { display: 'grid', gap: '14px', paddingTop: '4px' } },
      h('div.tiny.muted', 'Where a player’s price and his production disagree. Pick one to build a trade search around him.'),
      any ? h('div.sigcols',
        col('Sell high', 'yours — the market is paying more than the production earns', sells, 'Shop him', false),
        col('Buy low', 'on other rosters — price is ahead of production, or temporarily down', buys, 'Get him', true),
        holds.length ? col('Don’t sell yet', 'yours — scoring under his price; moving him now sells at the bottom', holds, null, false) : null)
        : h('div.empty', { style: { padding: '18px' } }, 'Nothing stands out — production lines up with price across the league.'),
      h('div.tiny.muted', S.lastWeek
        ? `Production is each player’s average over the games he has played this season (${S.lastWeek} week${S.lastWeek > 1 ? 's' : ''}), set against what his value rank typically scores. A gap only counts when it is bigger than normal week-to-week noise for that many games, so early in the season fewer players qualify. Value trend and age add to the read. Players who are out or on injured reserve are left out, because their price is explained by the injury — unless they are due back within about three weeks with games left to play, when only a buy-low can be flagged.`
        : 'No games have been played yet, so flags come only from age cliffs. Production-based flags appear once the season starts.')) : null);
}

function tradeCardRow(r, T, i) {
  const sigs = signalMap();
  // good when it lines up with what you are doing; a warning when it cuts against you
  const angle = (a, side) => {
    const s = a.kind === 'player' ? sigs[a.id] : null; if (!s) return null;
    const good = (side === 'give' && s.kind === 'sell') || (side === 'get' && s.kind === 'buy');
    const label = side === 'give' ? (s.kind === 'sell' ? 'Sell high' : 'Selling low') : (s.kind === 'buy' ? 'Buy low' : 'Buying high');
    return h('span.sigtag.' + (good ? 'good' : 'warn'), { title: s.reasons.join(' · ') }, label);
  };
  const shapeTag = r.give.length > r.get.length ? 'uptier' : r.get.length > r.give.length ? 'downtier' : null;
  const verdict = tradeVerdict(r.fair);
  const tray = (arr, which, title) => h('div.tmini.' + which,
    h('div.tmini-hd', h('span.tray-dot'), h('b', title), h('span.tmini-sum.mono', kfmt(Math.round(sum(arr.map(a => a.dv)))))),
    h('div.tmini-items' + (isSimple() ? '.cards' : ''), arr.map(a => dealItem(a, { compact: true, back: 'finder', extra: angle(a, which === 'a' ? 'give' : 'get') }))));
  return h('div.tcard',
    h('div.tc-hd',
      h('div.tc-who',
        h('b.mono.tiny.tc-n', '#' + (i + 1)),
        r.partner.avatar ? h('img.tav-s', { src: r.partner.avatar, alt: '', onerror: e => e.target.style.visibility = 'hidden' }) : h('div.tav-s'),
        h('b.tc-nm', 'with ' + r.partner.name),
        r.partner.window ? h('span.tag', r.partner.window) : null,
        shapeTag ? h('span.tag', { style: { borderColor: 'var(--s1)', color: 'var(--s1)' } }, shapeTag) : null),
      h('div.tc-act',
        h('span.balchip', { title: 'Value of each side after counting the best piece in full and each extra player for less' },
          h('i', { style: { background: verdict[1] } }), pct(r.fair, 0) + ' balance'),
        h('button.btn.sm', {
          onclick: () => {
            TradeUI.a = T.rosterId; TradeUI.b = r.partner.rosterId;
            TradeUI.aOut = r.give.slice(); TradeUI.bOut = r.get.slice();
            tradeRunNow();
            S.view = 'trade'; render(); window.scrollTo(0, 0);
          }
        }, 'Open in calculator'))),
    h('div.tcols', tray(r.give, 'a', 'You send'), h('div.swap', '⇄'), tray(r.get, 'b', 'You get')),
    r.why && r.why.length ? h('div.why', h('div.whyh', 'Why this works'),
      h('ul', r.why.slice(0, 5).map(w => h('li.w-' + w.k, w.t)))) : null,
    r.fa && r.fa.length ? h('div', { style: { marginTop: '10px', borderTop: '1px dashed var(--border)', paddingTop: '8px' } },
      h('div.tiny.muted', { style: { marginBottom: '6px' } },
        (r.freed > 1 ? r.freed + ' roster spots open up' : 'A roster spot opens up') + ' — best free agent to sign with it:'),
      h('div.row', { style: { gap: '8px', flexWrap: 'wrap' } }, r.fa.map((f, ix) =>
        h('div.asset', { style: { cursor: 'default', opacity: ix ? 0.62 : 1 } }, posPill(f.p.pos),
          pname(f.p, { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }),
          h('span.v', f.gain > 0.05 ? '+' + f.gain.toFixed(1) + ' pts/wk' : kfmt(Math.round(f.p.dv || 0))))))) : null,
    h('div.row', { style: { marginTop: '10px', gap: '6px 16px', borderTop: '1px solid var(--border)', paddingTop: '9px' } },
      h('span.tiny.sec', 'Your lineup ', deltaTag(r.myAfter.now - r.myBase.now, 1, ' pts/wk')),
      dynOnly(h('span.tiny.sec', 'Your future ', deltaTag(r.myAfter.future - r.myBase.future, 1))),
      dynOnly(h('span.tiny.sec', 'Pick capital ', deltaTag(r.myAfter.pickCapital - r.myBase.pickCapital, 0))),
      h('span', { style: { flex: 1 } }),
      h('span.tiny.muted', 'they gain too — that’s why this is worth sending')));
}

