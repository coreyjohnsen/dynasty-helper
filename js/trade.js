"use strict";
/* ================= trade evaluation engine ================= */
function assetsOf(t) {
  return t.players.map(p => ({ id: p.id, name: p.name, pos: p.pos, dv: p.dv || 0, ref: p, kind: 'player' }))
    .concat(t.pickAssets.map(p => ({ id: p.id, name: p.label, pos: 'PICK', dv: p.value, ref: p, kind: 'pick' })));
}
function afterRoster(t, out, incoming) {
  const rm = new Set(out.filter(a => a.kind === 'player').map(a => a.id));
  const keep = t.players.filter(p => !rm.has(p.id));
  return keep.concat(incoming.filter(a => a.kind === 'player').map(a => a.ref));
}
function afterPicks(t, out, incoming) {
  const rm = new Set(out.filter(a => a.kind === 'pick').map(a => a.id));
  return t.pickAssets.filter(p => !rm.has(p.id)).concat(incoming.filter(a => a.kind === 'pick').map(a => a.ref));
}
/** Full before/after picture for a two-team trade.
 *  Picks are priced twice: once on today's standings, and once on the standings
 *  the trade itself produces. Landing a starter pushes you up the table, which
 *  pushes the pick you sent down the draft order — so the deal is often better
 *  for the seller than the sticker price suggests, and worse for the buyer. */
function tradeEval(A, B, aOut, bOut, simN) {
  // phase 1: rosters and strength, with pick capital deliberately excluded
  const shell = (t, out, inc) => {
    const players = afterRoster(t, out, inc);
    const picks = afterPicks(t, out, inc);
    const act = players.filter(p => !t.taxi.has(p.id) && !t.ir.has(p.id));
    const starters = optimalLineup(act, 'ppg');
    const posNow = {}, posValue = {};
    POS4.forEach(pos => {
      posNow[pos] = sum(starters.filter(s => s.player && s.player.pos === pos).map(s => s.player.ppg));
      posValue[pos] = sum(players.filter(p => p.pos === pos).map(p => p.dv || 0));
    });
    const ages = players.filter(p => POS4.includes(p.pos) && p.age && (p.dv || 0) > 300);
    return {
      team: t, players, picks, act, starters, posNow, posValue,
      now: sum(starters.map(s => s.player ? s.player.ppg : 0)),
      futureRoster: isDynasty() ? lineupPoints(players, 'fppg') : lineupPoints(act, 'ppg'),
      age: ages.length ? sum(ages.map(p => p.age * p.dv)) / sum(ages.map(p => p.dv)) : null
    };
  };
  // phase 2: price the picks against a given league state, then fold them in
  const finish = (sh, price) => {
    const priced = sh.picks.map(pk => {
      const q = price(pk);
      return Object.assign({}, pk, {
        value: q.value, dv: q.value, slot: q.slot, tier: q.tier, ownerRank: q.rank,
        slotLabel: pk.round + '.' + String(q.slot).padStart(2, '0')
      });
    });
    const pickCapital = sum(priced.map(p => p.value));
    return Object.assign({}, sh, {
      picks: priced, pickCapital,
      future: sh.futureRoster + pickCapital / 620,
      value: sum(sh.players.map(p => p.dv || 0)) + pickCapital
    });
  };

  const dyn = isDynasty();
  const aSh = shell(A, aOut, bOut), bSh = shell(B, bOut, aOut);
  const aShB = shell(A, [], []), bShB = shell(B, [], []);
  const ov = {};
  ov[A.rosterId] = { now: aSh.now, futureRoster: aSh.futureRoster };
  ov[B.rosterId] = { now: bSh.now, futureRoster: bSh.futureRoster };
  const zero = () => ({ value: 0, slot: 0, tier: '', rank: 0 });
  const priceBefore = dyn ? pickPricer(null) : zero, priceAfter = dyn ? pickPricer(ov) : zero;
  const aAfter = finish(aSh, priceAfter), bAfter = finish(bSh, priceAfter);
  const aBefore = finish(aShB, priceBefore), bBefore = finish(bShB, priceBefore);

  // every pick either side touches, priced both ways
  const shifts = [];
  const seen = new Set();
  [[aBefore, A], [bBefore, B]].forEach(([sh, t]) => sh.picks.forEach(pk => {
    if (seen.has(pk.id)) return; seen.add(pk.id);
    const bq = priceBefore(pk), aq = priceAfter(pk);
    const heldAfter = aAfter.picks.some(x => x.id === pk.id) ? A
      : bAfter.picks.some(x => x.id === pk.id) ? B : null;
    shifts.push({
      pk, label: pk.label, season: pk.season, round: pk.round,
      origTeam: S.teamById[pk.origRosterId], heldBefore: t, heldAfter,
      before: bq, after: aq, delta: aq.value - bq.value, moved: aq.slot !== bq.slot
    });
  }));
  [[aAfter, A], [bAfter, B]].forEach(([sh, t]) => sh.picks.forEach(pk => {
    if (seen.has(pk.id)) return; seen.add(pk.id);
    const bq = priceBefore(pk), aq = priceAfter(pk);
    shifts.push({
      pk, label: pk.label, season: pk.season, round: pk.round,
      origTeam: S.teamById[pk.origRosterId], heldBefore: null, heldAfter: t,
      before: bq, after: aq, delta: aq.value - bq.value, moved: aq.slot !== bq.slot
    });
  }));
  shifts.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  // league-wide ranks after the trade (only two teams move)
  const rankAfter = (metric, getAfter) => {
    const vals = S.teams.map(t => t.rosterId === A.rosterId ? getAfter(aAfter) : t.rosterId === B.rosterId ? getAfter(bAfter) : metric(t));
    const r = rankOf(vals);
    const idx = {}; S.teams.forEach((t, i) => idx[t.rosterId] = r[i]);
    return idx;
  };
  const nowRankAfter = rankAfter(t => t.now, x => x.now);
  const futRankAfter = rankAfter(t => t.future, x => x.future);
  const valRankAfter = rankAfter(t => t.totalValue, x => x.value);
  const posRankAfter = {};
  POS4.forEach(pos => { posRankAfter[pos] = rankAfter(t => t.posNow[pos], x => x.posNow[pos]); });

  let simBefore = null, simAfter = null;
  if (simN) {
    // Common random numbers: identical seed on both runs, so the difference
    // reflects the trade rather than simulation noise.
    const so = {}; so[A.rosterId] = aAfter.act; so[B.rosterId] = bAfter.act;
    const pairSeed = (Math.random() * 4294967296) >>> 0;
    simBefore = simulate(simN, { seed: pairSeed });
    simAfter = simulate(simN, { overrides: so, seed: pairSeed });
  }
  // headline balance stays at today's market prices — that is what you negotiate at
  const aVal = sum(aOut.map(a => a.dv)), bVal = sum(bOut.map(a => a.dv));
  return {
    A, B, aOut, bOut, aAfter, bAfter, aBefore, bBefore, shifts,
    aGives: aVal, bGives: bVal, delta: bVal - aVal,
    nowRankAfter, futRankAfter, valRankAfter, posRankAfter, simBefore, simAfter
  };
}
function fairness(aVal, bVal) {
  const hi = Math.max(aVal, bVal), lo = Math.min(aVal, bVal);
  if (hi <= 0) return 1;
  return lo / hi;
}

/* ================= 2. TRADE CALCULATOR ================= */
/* Five thousand seasons is enough that a one-point swing in title odds is real
   rather than noise, and it runs in about a second — so there is nothing left
   for the user to choose, only a button to press. */
const TRADE_SIMS = 5000;
const TradeUI = { a: null, b: null, aOut: [], bOut: [], result: null, sig: null, running: false, tab: 'a', st: { q: '', pos: 'all', limit: 30 } };
/** What the current proposal is, so a repeat render does not re-run the sim. */
function tradeSig() {
  return [TradeUI.a, TradeUI.b, TradeUI.aOut.map(a => a.id).join(','), TradeUI.bOut.map(a => a.id).join(',')].join('|');
}
/** Run the evaluation now, synchronously. */
function tradeRunNow() {
  const A = S.teamById[TradeUI.a], B = S.teamById[TradeUI.b];
  if (!A || !B || !(TradeUI.aOut.length || TradeUI.bOut.length)) { TradeUI.result = null; TradeUI.sig = null; return null; }
  TradeUI.result = tradeEval(A, B, TradeUI.aOut, TradeUI.bOut, TRADE_SIMS);
  TradeUI.sig = tradeSig();
  return TradeUI.result;
}
/* ================= desk components =================
   The pieces the trade calculator is made of, kept apart so any page that pairs
   two teams, shows what each side holds, or lets you pick things from a roster
   can use the same ones and look like the same app. */

/** A selectable team as a card in its side's colour ('a' blue, 'b' orange). */
function teamCard(which, T, o) {
  o = o || {};
  const teams = o.teams || S.teams, id = o.id || ('tsel-' + which + '-' + (o.key || 'x'));
  return h('div.tpick.' + which,
    T.avatar ? h('img.tav', { src: T.avatar, alt: '', onerror: e => e.target.style.visibility = 'hidden' }) : h('div.tav'),
    h('div.tpick-main',
      h('label.tpick-lbl', { for: id }, o.label || (T.rosterId === S.myRosterId ? 'Your team' : which === 'a' ? 'Team A' : 'Team B')),
      o.onPick ? h('select', { id, onchange: e => o.onPick(+e.target.value) },
        teams.map(t => h('option', { value: t.rosterId, selected: T.rosterId === t.rosterId, disabled: t.rosterId === o.disabledId }, t.name)))
        : h('div.tpick-name', T.name),
      h('div.tpick-meta', h('span', `${T.wins}-${T.losses} · ${ord(T.powerRank)} power`),
        isDynasty() ? h('span.tpx', `· ${ord(T.futureRank)} future`) : null,
        T.window ? h('span.tag.tpx', T.window) : null)));
}
/** Two teams side by side with a swap button between them. */
function matchupBar(o) {
  const A = S.teamById[o.aId], B = S.teamById[o.bId];
  return h('div.tdesk-head',
    teamCard('a', A, { key: o.key, teams: o.teams, disabledId: o.bId, label: o.labelA, onPick: id => o.onPick('a', id) }),
    o.onSwap ? h('button.btn.tswap', { title: 'Swap the two teams', 'aria-label': 'Swap the two teams', onclick: o.onSwap }, ico('swap')) : h('span'),
    teamCard('b', B, { key: o.key, teams: o.teams, disabledId: o.aId, label: o.labelB, onPick: id => o.onPick('b', id) }));
}

/** The same shape the app uses for tradeable things, for a bare player. */
function assetOfPlayer(p) { return { id: p.id, name: p.name, pos: p.pos, dv: p.dv || 0, ref: p, kind: 'player' }; }
function assetMeta(a) {
  if (a.kind === 'faab') return 'Waiver budget';
  const sl = a.ref ? a.ref.slotLabel : a.slotLabel, tier = a.ref ? a.ref.tier : null;
  return a.kind === 'pick'
    ? (sl ? `Draft pick · projects ${sl}` + (tier ? ' (' + tier + ')' : '') : 'Draft pick')
    : [a.ref.team || 'FA', a.ref.age ? fmt(a.ref.age, 0) + ' yrs' : null, a.ref.ppg ? fmt(a.ref.ppg, 1) + ' pts/wk' : null].filter(Boolean).join(' · ');
}
function assetFace(a) {
  return a.kind === 'pick' || a.kind === 'faab' ? h('div.pickface', ico('draft')) : (isSimple() && a.ref ? playerFace(a.ref, { lg: true }) : null);
}
/** A chosen asset, large enough to read: face, name, position, where he plays, value. */
function assetCard(a, o) {
  o = o || {};
  return h('div.dealitem' + (o.compact ? '.compact' : ''), { class: a.kind === 'player' ? rowMedal(a.ref) : null },
    assetFace(a),
    h('div.dealmain',
      h('div.row', { style: { gap: '6px', flexWrap: 'nowrap' } }, a.kind === 'faab' ? h('span.pill.pos-NA', 'FAAB') : posPill(a.pos), h('span.dealnm', a.name), a.kind === 'player' && a.ref ? injuryTag(a.ref.injury, a.ref) : null, o.extra || null),
      h('div.tiny.muted.dealmeta', o.meta || assetMeta(a))),
    h('span.dealval.mono', o.value !== undefined ? o.value : kfmt(Math.round(a.dv))),
    o.action ? o.action : (o.onRemove ? h('button.dealx', { title: 'Remove', 'aria-label': 'Remove ' + a.name, onclick: o.onRemove }, ico('close')) : null));
}
/** One side's tray: a coloured header with a total, its items, and a dashed target when empty. */
function deskTray(o) {
  return h('div.tray.' + (o.which || 'a'),
    h('div.tray-hd',
      h('div.tray-t', h('span.tray-dot'), h('b', o.title)),
      o.total !== undefined && o.total !== null ? h('span.tray-sum.mono', o.total) : null),
    o.items && o.items.length
      ? h('div.tray-items' + (o.cards ? '.cards' : ''), o.items,
        h('div.tray-foot', h('span.tiny.muted', o.count || (o.items.length + (o.items.length === 1 ? ' item' : ' items'))),
          o.onClear ? h('button.btn.sm', { onclick: o.onClear }, 'Clear') : null))
      : h('button.tray-empty', { onclick: o.onEmpty || null },
        h('span.tray-plus', ico('plus')), h('b', o.emptyTitle || 'Add something'), h('span.tiny.muted', o.emptySub || '')));
}
/**
 * A roster to choose from: tabs, search, position filters, and a grid of cards that
 * toggle in and out of the deal. The page owns the state (`o.st` holds the query, the
 * position and how many are shown); typing filters the grid in place without a re-render.
 */
function assetBrowser(o) {
  const st = o.st, step = o.step || 30, color = o.color || 'a';
  const chosen = o.chosen || new Set();
  const matches = (q) => o.assets.filter(a => (st.pos === 'all' || a.pos === st.pos)
    && (!q || (a.name + ' ' + (a.ref && a.ref.team || '')).toLowerCase().includes(q.toLowerCase())));
  // `o.cols` caps how many cards sit on a row, so names are not squeezed on a wide screen
  const list = h('div.bgrid' + (o.cols ? '.fixed' : '')), more = h('div.row', { style: { justifyContent: 'center', marginTop: '10px' } });
  const item = (a) => {
    const inDeal = chosen.has(a.id), face = assetFace(a);
    return h('button.bitem' + (inDeal ? '.in' : ''), { 'aria-pressed': inDeal ? 'true' : 'false', class: a.kind === 'player' ? rowMedal(a.ref) : null, onclick: () => o.onToggle(a, inDeal) },
      face ? h('span.bface', face) : null,
      h('span.bmain',
        h('span.row', { style: { gap: '6px', flexWrap: 'nowrap' } }, posPill(a.pos), h('span.bnm', a.name), a.kind === 'player' ? injuryTag(a.ref.injury, a.ref) : null),
        h('span.tiny.muted.bmeta', o.meta ? o.meta(a) : assetMeta(a))),
      h('span.bval.mono', o.val ? o.val(a) : kfmt(Math.round(a.dv))),
      h('span.badd', ico(inDeal ? 'check' : 'plus')));
  };
  const fill = (q) => {
    const ms = matches(q), shown = ms.slice(0, st.limit);
    clear(list); clear(more);
    if (!ms.length) list.appendChild(h('div.empty', { style: { gridColumn: '1/-1', padding: '28px' } }, 'Nothing matches.'));
    shown.forEach(a => list.appendChild(item(a)));
    if (ms.length > shown.length) more.appendChild(h('button.btn', { onclick: () => { st.limit += step; fill(st.q); } },
      'Show ' + Math.min(step, ms.length - shown.length) + ' more · ' + (ms.length - shown.length) + ' left'));
  };
  fill(st.q);
  const posOpts = o.posOpts || ['all', 'QB', 'RB', 'WR', 'TE'].concat(isDynasty() && o.picks !== false ? ['PICK'] : []);
  const tabs = o.tabs && o.tabs.length > 1 ? h('div.btabs', o.tabs.map(t =>
    h('button.btab.' + t.color + (o.tab === t.k ? '.on' : ''), { onclick: () => o.onTab(t.k) },
      h('span.btab-dot'), h('span.btab-nm', t.label), t.n ? h('span.btab-n', t.n + (o.tabNote || ' in deal')) : null))) : null;
  const shell = h('div.card.tbrowse.t' + color, { id: o.id },
    h('div.bhd', h('h3', o.title || 'Add to the deal'), o.note ? h('span.note', o.note) : null),
    h('div.bd', tabs,
      h('div.bbar',
        h('div.bsearch', ico('finder'), h('input', {
          type: 'search', placeholder: o.placeholder || 'Search…', value: st.q, 'aria-label': 'Search',
          oninput: e => { st.q = e.target.value; st.limit = step; fill(e.target.value); }
        })),
        h('div.chipwrap', posOpts.map(p => h('button.chip' + (st.pos === p ? '.on' : ''), {
          onclick: () => { st.pos = p; st.limit = step; o.onChange(); }
        }, p === 'all' ? 'All' : p === 'PICK' ? 'Picks' : p)))),
      list, more));
  if (o.cols) shell.style.setProperty('--bcols', String(o.cols));
  return shell;
}
/** The bar that rides above the tab bar on a phone: a headline, a sub line, and the action. */
function dealBar(head, sub, action) {
  return h('div.dealbar', h('div.dealbar-l', head, sub || null), action);
}

/** The words and colour for a value balance. */
function tradeVerdict(f) {
  return f >= 0.93 ? ['Even trade', 'var(--good)'] : f >= 0.82 ? ['Slightly lopsided', 'var(--warning)'] : f >= 0.68 ? ['Lopsided', 'var(--serious)'] : ['Very lopsided', 'var(--critical)'];
}

/* ================= TRADE CALCULATOR =================
   Built like a desk, in the order you think: who is trading, what each side
   sends, is it fair, and only then the long list of things you could add. The
   two trays sit side by side with the balance between them, so every tap on the
   roster below shows its effect on the deal at once. */
function viewTrade() {
  const teams = S.teams;
  if (TradeUI.a === null) TradeUI.a = (S.myRosterId || teams[0].rosterId);
  if (TradeUI.b === null) TradeUI.b = teams.find(t => t.rosterId !== TradeUI.a).rosterId;
  if (TradeUI.a === TradeUI.b) TradeUI.b = teams.find(t => t.rosterId !== TradeUI.a).rosterId;
  const A = S.teamById[TradeUI.a], B = S.teamById[TradeUI.b];
  const T_OF = { a: A, b: B };
  const wrap = h('div.tdesk');

  const outOf = (w) => TradeUI[w + 'Out'];
  const setOut = (w, arr) => { TradeUI[w + 'Out'] = arr; TradeUI.result = null; render(); };
  const sumA = sum(TradeUI.aOut.map(a => a.dv)), sumB = sum(TradeUI.bOut.map(a => a.dv));
  const canRun = TradeUI.aOut.length || TradeUI.bOut.length;
  const f = canRun ? fairness(sumA, sumB) : 1;
  const verdict = tradeVerdict(f);
  const who = (T) => T.rosterId === S.myRosterId ? 'You' : T.name;

  /* ---- who is trading ---- */
  wrap.appendChild(matchupBar({
    key: 'trade', aId: TradeUI.a, bId: TradeUI.b,
    onPick: (which, id) => { TradeUI[which] = id; TradeUI[which + 'Out'] = []; TradeUI.result = null; TradeUI.st.q = ''; render(); },
    onSwap: () => {
      const t = TradeUI.a; TradeUI.a = TradeUI.b; TradeUI.b = t;
      const o = TradeUI.aOut; TradeUI.aOut = TradeUI.bOut; TradeUI.bOut = o;
      TradeUI.tab = TradeUI.tab === 'a' ? 'b' : 'a'; TradeUI.result = null; render();
    }
  }));

  /* ---- what each side sends ---- */
  const tray = (which) => {
    const T = T_OF[which], out = outOf(which), total = which === 'a' ? sumA : sumB;
    return deskTray({
      which, title: who(T) === 'You' ? 'You send' : T.name + ' sends', total: kfmt(Math.round(total)),
      cards: isSimple(),
      items: out.map(a => dealItem(a, { back: 'trade', onRemove: () => setOut(which, outOf(which).filter(x => x.id !== a.id)) })),
      count: out.length + (out.length === 1 ? ' asset' : ' assets'), onClear: () => setOut(which, []),
      emptyTitle: 'Add what ' + (who(T) === 'You' ? 'you send' : T.short + ' sends'), emptySub: 'Pick players and draft picks from the roster below',
      onEmpty: () => { TradeUI.tab = which; render(); setTimeout(() => { const el = $('#tbrowse'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30); }
    });
  };

  /* ---- is it fair, and what next ---- */
  const run = () => {
    if (!canRun || TradeUI.running) return;
    TradeUI.running = true; render();
    setTimeout(() => {
      try { tradeRunNow(); } catch (e) { console.error(e); }
      TradeUI.running = false; render();
      setTimeout(() => { const el = $('#tresult'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
    }, 16);
  };
  const sig = tradeSig();
  const fresh = TradeUI.result && TradeUI.sig === sig;
  if (!canRun) { TradeUI.result = null; TradeUI.sig = null; }
  const runBtn = () => h('button.btn.pri.trun', { disabled: !canRun || TradeUI.running, onclick: run },
    TradeUI.running ? h('span', h('span.spin'), ' Simulating…') : !canRun ? 'Add an asset to start' : fresh ? 'Re-evaluate' : 'Evaluate trade');
  const gap = Math.abs(sumA - sumB), overpay = sumA > sumB ? A : B;
  const balanceBody = () => !canRun
    ? [h('div.bal-empty', ico('trade'), h('div', h('b', 'Nothing in the deal yet'), h('div.tiny.muted', 'Add assets to either side and the balance appears here.')))]
    : [
      h('div.bal-pct', h('span.hero.mono', pct(f, 0)), h('span.bal-v', h('i', { style: { background: verdict[1] } }), verdict[0])),
      h('div.balbar', { 'aria-hidden': 'true' },
        h('i.a', { style: { flex: String(Math.max(sumA, 1)) } }), h('i.b', { style: { flex: String(Math.max(sumB, 1)) } })),
      h('div.tiny.sec.bal-line', f >= 0.995 ? 'Dead even' : `${who(overpay)} ${overpay.rosterId === S.myRosterId ? 'are' : 'is'} sending ${kfmt(Math.round(gap))} more in trade value`)];
  wrap.appendChild(h('div.deal',
    tray('a'),
    h('div.dealmid', balanceBody(), runBtn(),
      h('div.tiny.muted.trun-note', TradeUI.running ? kfmt(TRADE_SIMS) + ' seasons, with and without the trade'
        : fresh ? kfmt(TRADE_SIMS) + ' seasons simulated both ways, same random draws in each'
          : canRun ? kfmt(TRADE_SIMS) + ' simulated seasons, about a second' : '')),
    tray('b')));

  // how to even it out: the side that is sending less could add the asset closest to the gap
  if (canRun && f < 0.93) {
    const short = sumA < sumB ? A : B, sw = short === A ? 'a' : 'b';
    const taken = new Set(outOf(sw).map(a => a.id));
    const picks = assetsOf(short).filter(a => !taken.has(a.id) && a.dv > 100)
      .sort((x, y) => Math.abs(x.dv - gap) - Math.abs(y.dv - gap)).slice(0, 3);
    if (picks.length) wrap.appendChild(h('div.balhelp',
      h('span.tiny.sec', `To even it out, ${who(short) === 'You' ? 'you' : short.name} could add:`),
      picks.map(a => h('button.chip', { onclick: () => setOut(sw, outOf(sw).concat([a])) }, posPill(a.pos), a.name, h('span.tiny.muted', kfmt(Math.round(a.dv)))))));
  }

  if (fresh) wrap.appendChild(tradeResult(TradeUI.result));

  /* ---- the roster to choose from ---- */
  const bw = TradeUI.tab === 'b' ? 'b' : 'a', BT = T_OF[bw];
  wrap.appendChild(assetBrowser({
    id: 'tbrowse', color: bw, st: TradeUI.st, cols: 4,
    // the short form of the usual line — team, age, points a week — so it fits four to a row
    meta: a => a.kind === 'player' && a.ref ? [a.ref.team || 'FA', a.ref.age ? fmt(a.ref.age, 0) + 'y' : null, a.ref.ppg ? fmt(a.ref.ppg, 1) + ' ppg' : null].filter(Boolean).join(' · ') : assetMeta(a),
    title: 'Add to the deal', note: 'tap an asset to add it to what ' + (who(BT) === 'You' ? 'you send' : BT.short + ' sends') + ' · tap again to take it out',
    tabs: ['a', 'b'].map(w => ({ k: w, color: w, label: who(T_OF[w]) === 'You' ? 'Your roster' : T_OF[w].name, n: outOf(w).length })), tab: bw,
    onTab: k => { TradeUI.tab = k; TradeUI.st.pos = 'all'; TradeUI.st.limit = 30; render(); },
    assets: assetsOf(BT).sort((x, y) => y.dv - x.dv), chosen: new Set(outOf(bw).map(a => a.id)),
    placeholder: 'Search ' + BT.short + ' assets…',
    onToggle: (a, inDeal) => setOut(bw, inDeal ? outOf(bw).filter(x => x.id !== a.id) : outOf(bw).concat([a])),
    onChange: () => render()
  }));

  // on a phone the balance and the button ride above the tab bar, so what each tap did stays in view
  if (canRun) wrap.appendChild(dealBar(
    h('b.mono', pct(f, 0)), h('span.bal-v', h('i', { style: { background: verdict[1] } }), verdict[0]), runBtn()));
  return wrap;
}
function tradeResult(R) {
  const { A, B, aAfter, bAfter, aBefore, bBefore } = R;
  const f = fairness(R.aGives, R.bGives);
  const verdict = tradeVerdict(f);
  const winner = R.delta > 0 ? A : R.delta < 0 ? B : null;
  const wrap = h('div.grid', { id: 'tresult' });
  // who it helps, in the units people care about: championship and playoff odds
  const dOdds = (T, k) => R.simBefore && R.simAfter ? (R.simAfter.by[T.rosterId][k] - R.simBefore.by[T.rosterId][k]) * 100 : null;
  const helpBox = (T, which, before, after) => {
    const dt = dOdds(T, 'title'), dp = dOdds(T, 'playoff');
    return h('div.helpbox.' + which,
      h('div.hb-n', T.rosterId === S.myRosterId ? 'You' : T.name),
      dt !== null ? h('div.hb-v.mono', h('span', { class: Math.abs(dt) < 0.05 ? 'flat' : dt > 0 ? 'up' : 'down' }, sgn(dt, 1) + 'pp'), Math.abs(dt) >= 0.05 ? h('span.hb-tri', { class: dt > 0 ? 'up' : 'down', 'aria-hidden': 'true' }, dt > 0 ? '▲' : '▼') : null, h('span.hb-u', 'title odds'))
        : h('div.hb-v.mono', h('span', { class: after.now - before.now >= 0 ? 'up' : 'down' }, sgn(after.now - before.now, 1)), h('span.hb-u', 'pts/wk')),
      h('div.hb-s', [dp !== null ? 'playoff odds ' + sgn(dp, 1) + 'pp' : null,
        'lineup ' + sgn(after.now - before.now, 1) + ' pts/wk'].filter(Boolean).join(' · ')));
  };

  wrap.appendChild(card('Verdict', null, h('div', { style: { display: 'grid', gap: '16px' } },
    h('div.helps', helpBox(A, 'a', aBefore, aAfter), helpBox(B, 'b', bBefore, bAfter)),
    h('div.row', { style: { justifyContent: 'space-between', alignItems: 'flex-end' } },
      h('div', h('div.hero', pct(f, 0)), h('div.tiny.muted', 'value balance — 100% is a dead-even swap')),
      h('div', { style: { textAlign: 'right' } },
        h('div.row', { style: { justifyContent: 'flex-end', gap: '6px' } },
          h('span', { style: { width: '9px', height: '9px', borderRadius: '50%', background: verdict[1], display: 'inline-block' } }),
          h('b', verdict[0])),
        winner ? h('div.tiny.sec', `${winner.name} gains ${kfmt(Math.abs(Math.round(R.delta)))} in trade value`) : h('div.tiny.sec', 'Perfectly balanced'))),
    (() => {
      const mx = Math.max(R.aGives, R.bGives, 1);
      const row = (T, w, v) => h('div.recv-row',
        h('span.recv-l', T.rosterId === S.myRosterId ? 'You receive' : T.name + ' receives'),
        h('div.recv-track', h('i.' + w, { style: { width: Math.max(2, v / mx * 100) + '%' } })),
        h('b.mono', kfmt(Math.round(v))));
      return h('div.recv', row(A, 'a', R.bGives), row(B, 'b', R.aGives));
    })(),
    h('div.tiny.muted', 'Values are live FantasyCalc ' + valueWord() + ' values for this league’s exact format. Balance alone does not make a trade good — the impact tables below are what matter.')
  )));

  const impact = (T, before, after, sim) => {
    const sb = R.simBefore ? R.simBefore.by[T.rosterId] : null;
    const sa = R.simAfter ? R.simAfter.by[T.rosterId] : null;
    const rows = [
      ['Lineup pts/wk', before.now, after.now, 1, R.nowRankAfter[T.rosterId], T.powerRank && rankOf(S.teams.map(x => x.now))[S.teams.indexOf(T)]],
      isDynasty() ? ['Future rating', before.future, after.future, 1, R.futRankAfter[T.rosterId], T.futureRank] : null,
      [capitalLabel(), before.value, after.value, 0, R.valRankAfter[T.rosterId], T.valueRank]
    ].filter(Boolean);
    return h('div', { style: { display: 'grid', gap: '10px' } },
      h('div.row', teamCell(T), h('span', { style: { flex: 1 } }), T.window ? h('span.tag', T.window) : null),
      h('table.tbl', h('thead', h('tr', h('th', 'Metric'), h('th.num', 'Before'), h('th.num', 'After'), h('th.num', 'Change'), h('th.num', 'Rank'))),
        h('tbody', rows.map(([lbl, b, a, d, rkA, rkB]) => h('tr',
          h('td', lbl), h('td.num.mono', fmt(b, d)), h('td.num.mono', h('b', fmt(a, d))),
          h('td.num', deltaTag(a - b, d)),
          h('td.num.tiny', rkB && rkA && rkB !== rkA ? h('span', h('span.muted', ord(rkB) + ' → '), h('b', ord(rkA))) : ord(rkA)))))),
      sb && sa ? h('div', h('div.tiny.muted', { style: { margin: '4px 0 5px' } }, 'Simulated season impact'),
        h('div', { style: { display: 'grid', gap: '4px' } }, [
          ['Projected wins', sb.wins, sa.wins, 1, false],
          ['Playoff odds', sb.playoff, sa.playoff, 0, true],
          ['Title odds', sb.title, sa.title, 1, true]
        ].map(([lbl, b, a, d, isPct]) => h('div', { style: { display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '8px', alignItems: 'center' } },
          h('span.tiny.sec', lbl),
          h('span.tiny.mono.muted', isPct ? pct(b, d) : fmt(b, d)),
          h('span.tiny.muted', '→'),
          h('span.mono', { style: { fontWeight: 640, minWidth: '86px', textAlign: 'right' } },
            isPct ? pct(a, d) : fmt(a, d), ' ', deltaTag(isPct ? (a - b) * 100 : a - b, isPct ? 1 : 1, isPct ? 'pp' : '')))))) : null
    );
  };
  wrap.appendChild(h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(min(340px,100%),1fr))' } },
    card('Impact on ' + A.name, null, impact(A, aBefore, aAfter)),
    card('Impact on ' + B.name, null, impact(B, bBefore, bAfter))));

  // positional impact
  const posRows = [];
  POS4.forEach(pos => {
    posRows.push({ pos, team: A.name, before: aBefore.posNow[pos], after: aAfter.posNow[pos], rank: R.posRankAfter[pos][A.rosterId], was: A.posNow[pos + 'Rank'] });
    posRows.push({ pos, team: B.name, before: bBefore.posNow[pos], after: bAfter.posNow[pos], rank: R.posRankAfter[pos][B.rosterId], was: B.posNow[pos + 'Rank'] });
  });
  const posCard = proOnly(card('Positional rankings after the trade', 'starting-lineup output per position, and where that ranks in the league',
    table([
      { k: 'pos', h: 'Pos', f: r => posPill(r.pos) },
      { k: 'team', h: 'Team' },
      { k: 'before', h: 'Before', num: true, f: r => fmt(r.before, 1) },
      { k: 'after', h: 'After', num: true, f: r => h('b.mono', fmt(r.after, 1)) },
      { k: 'chg', h: 'Change', num: true, sort: r => r.after - r.before, f: r => deltaTag(r.after - r.before, 1) },
      { k: 'rank', prio: 2, h: 'League rank', num: true, f: r => r.was !== r.rank ? h('span', h('span.muted', ord(r.was) + ' → '), h('b', ord(r.rank))) : ord(r.rank) }
    ], posRows, { sortKey: 'chg', sortDir: -1 })));
  if (posCard) wrap.appendChild(posCard);

  const moved = (R.shifts || []).filter(x => Math.abs(x.delta) >= 25 || x.moved);
  if (moved.length) {
    const who = (t) => t ? t.short : '—';
    const repriceCard = proOnly(card('How this trade moves the draft order',
      'a pick is worth what its slot is worth, and this trade changes where these teams finish',
      h('div',
        table([
          { k: 'label', h: 'Pick', sort: r => r.season * 10 + r.round, f: r => h('div.row', { style: { gap: '6px' } }, posPill('PICK'), h('b', r.label)) },
          { k: 'holder', prio: 2, h: 'Ends up with', sortable: false, f: r => r.heldBefore && r.heldAfter && r.heldBefore !== r.heldAfter ? h('span', h('span.muted', who(r.heldBefore) + ' → '), h('b', who(r.heldAfter))) : h('span', who(r.heldAfter || r.heldBefore)) },
          { k: 'slot', h: 'Projected slot', num: true, sort: r => r.after.slot, f: r => r.before.slot === r.after.slot ? h('span.mono', r.round + '.' + String(r.after.slot).padStart(2, '0')) : h('span.mono', h('span.muted', r.round + '.' + String(r.before.slot).padStart(2, '0') + ' → '), h('b', r.round + '.' + String(r.after.slot).padStart(2, '0'))) },
          { k: 'tier', prio: 2, h: 'Tier', sortable: false, f: r => r.before.tier === r.after.tier ? h('span.tag', r.after.tier) : h('span', h('span.tiny.muted', r.before.tier + ' → '), h('span.tag', { style: { borderColor: 'var(--s1)', color: 'var(--s1)' } }, r.after.tier)) },
          { k: 'val', h: 'Value', num: true, sort: r => r.after.value, f: r => h('span.mono', h('span.muted', kfmt(r.before.value) + ' → '), h('b', kfmt(r.after.value))) },
          { k: 'delta', h: 'Change', num: true, sort: r => r.delta, f: r => Math.abs(r.delta) < 1 ? h('span.flat.tiny', '–') : deltaTag(r.delta, 0) }
        ], moved, { sortKey: 'delta', sortDir: 1 }),
        h('div.tiny.muted', { style: { marginTop: '9px' } },
          'Slots assume the usual inverse-standings order, projected from each team\u2019s roster after the trade — weighted toward where a roster is heading the further out the pick is. '
          + 'The headline balance above still uses today\u2019s market prices, which is what you would actually negotiate at; this table is what the picks are likely to become.'))));
    if (repriceCard) wrap.appendChild(repriceCard);
  }

  if (R.simAfter) {
    const rows = S.teams.map(t => ({ t, b: R.simBefore.by[t.rosterId], a: R.simAfter.by[t.rosterId] }))
      .sort((x, y) => y.a.title - x.a.title);
    wrap.appendChild(card('League-wide contender shake-up', 'how everyone’s championship odds move — third parties shift too',
      divBar(rows.map(r => ({
        label: r.t.name, v: (r.a.title - r.b.title) * 100, vl: sgn((r.a.title - r.b.title) * 100, 1) + 'pp',
        tip: `<div class="k">${r.t.name}</div>Title odds <b>${pct(r.b.title, 1)}</b> → <b>${pct(r.a.title, 1)}</b><br>Playoffs <b>${pct(r.b.playoff, 0)}</b> → <b>${pct(r.a.playoff, 0)}</b>`
      })), { dec: 1, labelW: '170px' })));
  }
  return wrap;
}

