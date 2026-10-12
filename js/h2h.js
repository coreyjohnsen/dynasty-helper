"use strict";
/* ================= 12. HEAD TO HEAD ================= */
const H2HUI = { a: null, b: null, week: null, sims: 4000, res: null, mode: 'overall', sum: null };

/** One week, both teams, many times: the distribution of the margin between them. */
function h2hSim(A, B, wk, n) {
  /* A week already under way is part settled: the finished games are banked and
     only the open slots are drawn, which is what makes the odds move as Sunday runs. */
  const live = wk === S.liveWeek;
  const lineup = (T) => {
    if (live) {
      const lr = liveRoster(T, wk);
      return { banked: lr.banked, arr: lr.open.map(r => ({ m: r.used, sd: volFromMean(r.p.pos, r.used) })) };
    }
    return {
      banked: 0,
      arr: optimalLineup(withReturners(activePlayers(T), T, wk), p => pw(p, wk))
        .map(s => {
          const pos = s.player ? s.player.pos : (SLOT_ELIG[s.slot] || [s.slot])[0];
          let m = s.player ? pw(s.player, wk) : 0;
          if (m <= 0.05) m = STREAM[pos] !== undefined ? STREAM[pos] : 0;
          return { m, sd: volFromMean(pos, m) };
        }).filter(x => x.m > 0.05)
    };
  };
  const la = lineup(A), lb = lineup(B);
  const draw = (l) => {
    let s = 0;
    for (let k = 0; k < l.arr.length; k++) { if (rnd() < BUST_RATE) continue; s += drawScore(l.arr[k].m, l.arr[k].sd); }
    return l.banked + Math.max(0, s * Math.max(0.55, 1 + 0.05 * gauss()));
  };
  seedRng(hashStr(A.rosterId + '|' + B.rosterId + '|' + wk) >>> 0);
  const margins = new Float64Array(n), sa = new Float64Array(n), sb = new Float64Array(n);
  let wins = 0, ties = 0;
  for (let i = 0; i < n; i++) {
    const x = draw(la), y = draw(lb);
    sa[i] = x; sb[i] = y; margins[i] = x - y;
    if (x > y) wins++; else if (x === y) ties++;
  }
  const q = (arr, p) => { const a = Array.from(arr).sort((x, y) => x - y); return a[clamp(Math.floor(p * (a.length - 1)), 0, a.length - 1)]; };
  const marr = Array.from(margins);
  return {
    n, pA: wins / n, pB: (n - wins - ties) / n, tie: ties / n,
    meanA: mean(Array.from(sa)), meanB: mean(Array.from(sb)),
    medMargin: q(margins, .5), loMargin: q(margins, .1), hiMargin: q(margins, .9),
    blowoutA: marr.filter(m => m > 30).length / n, blowoutB: marr.filter(m => m < -30).length / n,
    closeGame: marr.filter(m => Math.abs(m) <= 10).length / n,
    margins: marr, aScores: Array.from(sa), bScores: Array.from(sb)
  };
}

/** The weeks these two are scheduled against each other. */
function weeksBetween(A, B) {
  const sched = schedule(), out = [];
  for (let w = 1; w <= S.regEnd; w++) {
    const games = sched[w - 1] || [];
    if (games.some(g => (g[0] === A.rosterId && g[1] === B.rosterId) || (g[1] === A.rosterId && g[0] === B.rosterId))) out.push(w);
  }
  return out;
}

/** Every time these two have actually played. */
function h2hHistory(A, B) {
  const out = [];
  for (let w = 1; w <= S.lastWeek; w++) {
    const ms = S.matchups[w] || [];
    const ma = ms.find(m => m.roster_id === A.rosterId), mb = ms.find(m => m.roster_id === B.rosterId);
    if (!ma || !mb) continue;
    if (ma.matchup_id === null || ma.matchup_id === undefined || ma.matchup_id !== mb.matchup_id) continue;
    out.push({ week: w, a: ma.points || 0, b: mb.points || 0 });
  }
  return out;
}

/* ================= comparison helpers =================
   The overall comparison asks "who has the better team", not "who wins Sunday", so it
   sets both rosters at full strength: nobody injured, nobody on bye. */

/** A player's points per game when he is on the field. An injured player's own `ppg` is
 *  discounted for the games he will miss, so his healthy line is read back from the weekly
 *  projections (all of them), or from the market curve when Sleeper has none. */
function healthyPpg(p) {
  if (!p) return 0;
  if (!p.injury || p.injury === 'NA') return p.ppg || 0;
  if (p.projGames && p.projSeason / p.projGames > 0.5) return p.projSeason / p.projGames;
  return p.ppgHealthy !== undefined ? p.ppgHealthy : (p.ppgLegacy !== undefined ? p.ppgLegacy : (p.ppg || 0));
}
/** The best lineup a team could field with everyone healthy (taxi players cannot start). */
function h2hHealthy(T) {
  const pool = T.players.filter(p => !T.taxi.has(p.id));
  const slots = optimalLineup(pool, healthyPpg);
  const pos = {};
  POS4.forEach(x => { pos[x] = 0; });
  slots.forEach(s => { if (s.player && pos[s.player.pos] !== undefined) pos[s.player.pos] += healthyPpg(s.player); });
  const starters = slots.filter(s => s.player).map(s => s.player);
  const ageOf = (list) => { const a = list.filter(p => p.age).map(p => p.age); return a.length ? mean(a) : null; };
  // value-weighted age by position, the way the franchise age is measured
  const posAge = {};
  POS4.forEach(x => {
    const ps = T.players.filter(p => p.pos === x && p.age && (p.dv || 0) > 300);
    posAge[x] = ps.length ? sum(ps.map(p => p.age * p.dv)) / sum(ps.map(p => p.dv)) : null;
  });
  return { slots, total: sum(slots.map(s => s.player ? healthyPpg(s.player) : 0)), pos, startAge: ageOf(starters), posAge };
}

/** Mirrored bars: both teams' bars grow outward from a centre line, so you read each
 *  team's size and the gap between them at once. The side that is ahead is full colour,
 *  the other is dimmed. rows: [{ k, a, b, f, invert, tip, node, fd }] */
function h2hTape(rows, A, B) {
  return h('div.tape', rows.map(r => {
    const hi = Math.max(Math.abs(r.a), Math.abs(r.b), 1e-9);
    const f = r.f || (v => fmt(v, 1));
    const tied = Math.abs(r.a - r.b) < 1e-9;
    const aLead = !tied && (r.invert ? r.a < r.b : r.a > r.b);
    const lead = tied ? null : aLead ? A : B;
    const gap = Math.abs(r.a - r.b);
    const row = h('div.tp',
      h('div.tp-lbl', r.node || h('span.k', r.k),
        lead ? h('span.d', { style: { color: aLead ? 'var(--s1)' : 'var(--s2)' } }, lead.short + ' +' + (r.fd || f)(gap)) : h('span.d.muted', 'even')),
      h('span.tp-v.l' + (aLead ? '.lead' : ''), f(r.a)),
      h('div.tp-track.l', h('i' + (aLead || tied ? '' : '.trail'), { style: { width: Math.max(2, Math.abs(r.a) / hi * 100) + '%' } })),
      h('div.tp-track.r', h('i' + (!aLead || tied ? '' : '.trail'), { style: { width: Math.max(2, Math.abs(r.b) / hi * 100) + '%' } })),
      h('span.tp-v.r' + (!aLead && !tied ? '.lead' : ''), f(r.b)));
    row.tabIndex = 0;
    bindTT(row, `<div class="k">${r.k}</div>${esc(A.short)} ${f(r.a)} · ${esc(B.short)} ${f(r.b)}` + (r.tip ? `<div>${r.tip}</div>` : ''));
    return row;
  }));
}

/** Where each team sits among the whole league on a handful of spokes. The outer ring is
 *  the best team in the league; the shape says what a team is built from. */
function h2hRadar(axes, A, B) {
  const n = axes.length, W = 360, HT = 300, cx = W / 2, cy = 150, R = 98;
  const ang = i => -Math.PI / 2 + i * 2 * Math.PI / n;
  const pt = (i, f) => [cx + Math.cos(ang(i)) * R * f, cy + Math.sin(ang(i)) * R * f];
  const poly = (f) => axes.map((_, i) => pt(i, typeof f === 'function' ? f(i) : f).map(v => v.toFixed(1)).join(',')).join(' ');
  const g = svg('svg', { viewBox: `0 0 ${W} ${HT}`, width: '100%', role: 'img', 'aria-label': 'Shape of each team against the league', style: 'display:block;max-width:500px;margin:0 auto;overflow:visible' });
  [0.25, 0.5, 0.75, 1].forEach(f => g.appendChild(svg('polygon', { points: poly(f), fill: f === 1 ? 'var(--surface-2)' : 'none', stroke: f === 1 ? 'var(--axis)' : 'var(--grid)', 'stroke-width': 1 })));
  axes.forEach((_, i) => { const [x, y] = pt(i, 1); g.appendChild(svg('line', { x1: cx, y1: cy, x2: x, y2: y, stroke: 'var(--grid)', 'stroke-width': 1 })); });
  const shape = (T, key, col) => {
    const wrap = svg('g', { class: 'rd-shape' });
    wrap.appendChild(svg('polygon', { points: poly(i => axes[i][key].p), fill: col, 'fill-opacity': 0.16, stroke: col, 'stroke-width': 2.2, 'stroke-linejoin': 'round' }));
    axes.forEach((ax, i) => {
      const [x, y] = pt(i, ax[key].p);
      const dot = svg('circle', { cx: x, cy: y, r: 3.6, fill: col, stroke: 'var(--surface-1)', 'stroke-width': 1.5 });
      bindTT(dot, `<div class="k">${esc(T.name)} · ${ax.k}</div>${ord(ax[key].rank)} of ${S.teams.length} teams · ${ax.f(ax[key].v)}`);
      wrap.appendChild(dot);
    });
    return wrap;
  };
  g.appendChild(shape(B, 'b', 'var(--s2)'));
  g.appendChild(shape(A, 'a', 'var(--s1)'));
  axes.forEach((ax, i) => {
    const [x, y] = pt(i, 1.2), c = Math.cos(ang(i));
    const t = svg('text', { x, y: y + 4, 'text-anchor': Math.abs(c) < 0.25 ? 'middle' : c > 0 ? 'start' : 'end', 'font-size': 11.5, 'font-weight': 640, fill: 'var(--text-secondary)' });
    t.textContent = ax.k; g.appendChild(t);
  });
  return g;
}

/** A scoreboard side for the two heroes. */
function h2hSide(T, w, big, sub, fav) {
  return h('div.h2hside.' + w + (fav ? '.fav' : ''),
    T.avatar ? h('img.h2hav', { src: T.avatar, alt: '', onerror: e => e.target.style.visibility = 'hidden' }) : h('div.h2hav'),
    h('div.h2hnm', T.name),
    h('div.h2hpct.mono', big),
    h('div.tiny.muted', sub));
}

function viewH2H() {
  const wrap = h('div.grid');
  const teams = S.teams;
  if (teams.length < 2) return wrap.appendChild(card('Head to head', null, h('div.empty', 'Need at least two teams.'))), wrap;
  if (H2HUI.a === null || !S.teamById[H2HUI.a]) H2HUI.a = S.myRosterId || teams[0].rosterId;
  if (H2HUI.b === null || !S.teamById[H2HUI.b] || H2HUI.b === H2HUI.a) H2HUI.b = (teams.find(t => t.rosterId !== H2HUI.a) || teams[0]).rosterId;
  const A = S.teamById[H2HUI.a], B = S.teamById[H2HUI.b];
  // one colour per team, held across every card on the page, so "blue" always
  // means the same franchise rather than "good"
  const CA = 'var(--s1)', CB = 'var(--s2)';
  /* Only offer the weeks these two actually play. Simulating week 4 between two
     teams who meet in weeks 2 and 11 is an answer to a question nobody asked. */
  const meet = A.rosterId === B.rosterId ? [] : weeksBetween(A, B);
  const allWeeks = []; for (let w = 1; w <= S.regEnd; w++) allWeeks.push(w);
  const weeks = meet.length ? meet : allWeeks;
  const next = meet.find(w => w > S.lastWeek);
  if (H2HUI.week === null || !weeks.includes(H2HUI.week)) {
    H2HUI.week = next || weeks[weeks.length - 1] || clamp(S.lastWeek + 1, 1, S.regEnd);
    H2HUI.res = null;
  }
  const wk = H2HUI.week;
  const mode = H2HUI.mode === 'week' ? 'week' : 'overall';

  wrap.appendChild(matchupBar({
    key: 'h2h', aId: A.rosterId, bId: B.rosterId,
    onPick: (w, id) => { H2HUI[w] = id; H2HUI.res = null; render(); },
    onSwap: () => { const t = H2HUI.a; H2HUI.a = H2HUI.b; H2HUI.b = t; H2HUI.res = null; render(); }
  }));
  const modes = [['overall', 'Overall comparison'], ['week', 'Week matchup']];
  wrap.appendChild(h('div.h2hweek',
    h('div.h2hmode', h('span.tiny.muted', 'Compare'),
      h('div.seg', { role: 'tablist' }, modes.map(([k, l]) => h('button' + (mode === k ? '.on' : ''),
        { role: 'tab', 'aria-selected': mode === k ? 'true' : 'false', onclick: () => { H2HUI.mode = k; render(); } }, l)))),
    mode === 'week'
      ? h('label.fld', { style: { minWidth: '210px' } }, meet.length ? (meet.length === 1 ? 'They meet once' : 'They meet ' + meet.length + ' times') : 'Neutral week',
        h('select', { onchange: e => { H2HUI.week = +e.target.value; H2HUI.res = null; render(); } },
          weeks.map(w => h('option', { value: w, selected: w === wk },
            'Week ' + w + (w <= S.lastWeek ? ' (played)' : w === next ? ' (next meeting)' : '')))))
      : null,
    mode === 'week'
      ? (meet.length
        ? h('span.tiny.muted', { style: { maxWidth: '420px' } },
          meet.length === 1
            ? 'Week ' + meet[0] + ' is the only week these two play each other.'
            : 'Weeks ' + meet.slice(0, -1).join(', ') + ' and ' + meet[meet.length - 1] + ' are the only weeks these two play each other.')
        : h('span.tiny.muted', { style: { maxWidth: '440px', color: 'var(--text-secondary)' } },
          A.short + ' and ' + B.short + ' never meet this season, so this is a neutral matchup. Pick any week and both lineups are set for it.'))
      : h('span.tiny.muted', { style: { maxWidth: '520px' } }, 'Both rosters at full strength: everyone healthy, nobody on bye. Switch to Week matchup for one specific game.')));
  if (A.rosterId === B.rosterId) return wrap.appendChild(card(null, null, h('div.empty', 'Pick two different teams.'))), wrap;

  if (mode === 'week') h2hWeek(wrap, A, B, CA, CB, wk);
  else h2hOverall(wrap, A, B, CA, CB);
  return wrap;
}

/* ================= the overall comparison ================= */
function h2hOverall(wrap, A, B, CA, CB) {
  const dyn = isDynasty();
  const HA = h2hHealthy(A), HB = h2hHealthy(B);

  /* ---- the franchises, category by category ---- */
  const k1 = (v) => kfmt(Math.round(v));
  const metrics = [
    { k: 'Best lineup', a: HA.total, b: HB.total, f: v => fmt(v, 1), tip: 'Points per game from the strongest lineup each roster could field, everyone healthy' },
    dyn ? { k: 'Future lineup', a: A.future, b: B.future, f: v => fmt(v, 1), tip: 'Age-adjusted projection two to three seasons out' } : null,
    { k: capitalLabel(), a: A.totalValue, b: B.totalValue, f: k1, tip: dyn ? 'Players plus draft picks at today\'s market' : 'Every rostered player at today\'s redraft market' },
    dyn ? { k: 'Roster value', a: A.rosterValue, b: B.rosterValue, f: k1 } : null,
    dyn ? { k: 'Pick capital', a: A.pickCapital, b: B.pickCapital, f: k1 } : null,
    { k: 'Points for', a: A.fpts, b: B.fpts, f: v => fmt(v, 1) },
    { k: 'Points against', a: A.fptsAgainst, b: B.fptsAgainst, f: v => fmt(v, 1), invert: true, tip: 'What their opponents have scored on them. Lower is a kinder draw' },
    dyn ? { k: 'Average age', a: A.age || 0, b: B.age || 0, f: v => fmt(v, 1), invert: true, tip: 'Value-weighted. Younger is usually the more valuable asset base' } : null
  ].filter(Boolean);
  const leads = (m) => m.a === m.b ? 0 : (m.invert ? m.a < m.b : m.a > m.b) ? 1 : -1;
  const aWins = metrics.filter(m => leads(m) > 0).length, bWins = metrics.filter(m => leads(m) < 0).length;
  const edge = (side) => {
    const best = metrics.filter(m => leads(m) === side).map(m => ({ m, rel: Math.abs(m.a - m.b) / Math.max(Math.abs(m.a), Math.abs(m.b), 1e-9) })).sort((x, y) => y.rel - x.rel)[0];
    return best ? best.m.k : null;
  };
  H2HUI.sum = { A, B, aWins, bWins, total: metrics.length };
  const eA = edge(1), eB = edge(-1);
  wrap.appendChild(h('div.h2hhero',
    h2hSide(A, 'a', aWins, 'categories led', aWins >= bWins),
    h('div.h2hmid',
      h('div.h2hbar', { 'aria-hidden': 'true' }, h('i.a', { style: { flex: String(Math.max(aWins, 0.15)) } }), h('i.b', { style: { flex: String(Math.max(bWins, 0.15)) } })),
      h('div.h2hmargin', h('span.tiny.muted', 'The tale of the tape'),
        h('b', aWins === bWins ? 'Dead even' : (aWins > bWins ? A.short : B.short) + ' leads ' + Math.max(aWins, bWins) + ' of ' + metrics.length)),
      h('div.tiny.muted', { style: { lineHeight: 1.5 } },
        eA ? [h('span', { style: { color: CA, fontWeight: 650 } }, A.short), ' strongest in ' + eA] : null,
        eA && eB ? h('br') : null,
        eB ? [h('span', { style: { color: CB, fontWeight: 650 } }, B.short), ' strongest in ' + eB] : null)),
    h2hSide(B, 'b', bWins, 'categories led', bWins > aWins)));

  /* ---- shape against the league, and the tape beside it ---- */
  const all = S.teams.map(T => ({ T, H: T.rosterId === A.rosterId ? HA : T.rosterId === B.rosterId ? HB : h2hHealthy(T) }));
  const N = S.teams.length;
  const axisDefs = [
    { k: 'Lineup', get: x => x.H.total, f: v => fmt(v, 1) + ' pts/g' }
  ].concat(POS4.map(p => ({ k: p, get: x => x.H.pos[p], f: v => fmt(v, 1) + ' pts/g' })));
  if (dyn) axisDefs.push(
    { k: 'Future', get: x => x.T.future, f: v => fmt(v, 1) + ' pts/g' },
    { k: 'Youth', get: x => x.T.age || 0, f: v => fmt(v, 1) + ' yrs avg', asc: true },
    { k: 'Picks', get: x => x.T.pickCapital, f: v => k1(v) });
  const axes = axisDefs.map(d => {
    const vals = all.map(d.get), ranks = rankOf(vals, !d.asc);
    const at = (T) => { const i = all.findIndex(x => x.T.rosterId === T.rosterId); return { v: vals[i], rank: ranks[i], p: N > 1 ? (N - ranks[i]) / (N - 1) : 1 }; };
    return { k: d.k, f: d.f, a: at(A), b: at(B) };
  });
  const legend = h('div.rdlegend',
    h('span', h('i', { style: { background: CA } }), h('b', A.short), h('span.muted', A.name)),
    h('span', h('i', { style: { background: CB } }), h('b', B.short), h('span.muted', B.name)));
  wrap.appendChild(h('div.grid.split',
    card('Shape against the league', 'rank among all ' + N + ' teams, the outer ring is best',
      h('div', h2hRadar(axes, A, B), legend)),
    card('Category by category', A.short + ' leads ' + aWins + ' · ' + B.short + ' leads ' + bWins + '',
      h2hTape(metrics, A, B))));

  /* ---- the best lineups, slot by slot ---- */
  const rows = HA.slots.map((sa, i) => {
    const sb = HB.slots[i] || {};
    return { slot: sa.slot, a: sa.player, b: sb.player, va: sa.player ? healthyPpg(sa.player) : 0, vb: sb.player ? healthyPpg(sb.player) : 0 };
  });
  const lw = rows.filter(r => r.va > r.vb).length;
  wrap.appendChild(card('Best lineup, everyone healthy',
    `${A.short} wins ${lw} of ${rows.length} slots · ${fmt(HA.total, 1)} to ${fmt(HB.total, 1)} points per game`,
    slotLadder(rows, A, B, CA, CB, { head: 'Pts/g' })));

  /* ---- position ratings ---- */
  const posLbl = (p) => h('span.row', { style: { gap: '6px', justifyContent: 'center' } }, posPill(p));
  wrap.appendChild(h('div.grid.split',
    card('Position ratings: output', 'points per game from each position\'s starters in the best lineup',
      h2hTape(POS4.map(p => ({ k: p, node: posLbl(p), a: HA.pos[p], b: HB.pos[p], f: v => fmt(v, 1) })), A, B)),
    card('Position ratings: ' + valueWord() + ' value', 'market value of everyone rostered at each position',
      h2hTape(POS4.map(p => ({ k: p, node: posLbl(p), a: A.posValue[p] || 0, b: B.posValue[p] || 0, f: k1 })), A, B))));

  /* ---- age, and the season outlook ---- */
  const cards = [];
  if (dyn) {
    const ageRows = [{ k: 'Starting lineup', a: HA.startAge, b: HB.startAge, tip: 'Average age of the best lineup' }]
      .concat(POS4.map(p => ({ k: p, node: posLbl(p), a: HA.posAge[p], b: HB.posAge[p], tip: 'Value-weighted age of everyone at the position' })))
      .filter(r => r.a && r.b).map(r => Object.assign(r, { invert: true, f: v => fmt(v, 1), fd: v => fmt(v, 1) + ' yrs' }));
    cards.push(card('Age profile', 'younger is ahead', ageRows.length ? h2hTape(ageRows, A, B) : h('div.empty', 'No age data for these rosters.')));
  }
  if (S.sim && S.sim.by[A.rosterId] && S.sim.by[B.rosterId]) {
    const sa = S.sim.by[A.rosterId], sb = S.sim.by[B.rosterId];
    cards.push(card('Season outlook', 'from the last full-season simulation you ran',
      h2hTape([
        { k: 'Projected wins', a: sa.wins, b: sb.wins, f: v => fmt(v, 1) },
        { k: 'Playoff odds', a: sa.playoff, b: sb.playoff, f: v => pct(v, 0), fd: v => fmt(v * 100, 0) + ' pts' },
        { k: 'Title odds', a: sa.title, b: sb.title, f: v => pct(v, 1), fd: v => fmt(v * 100, 1) + ' pts' },
        { k: 'Average seed', a: sa.seed, b: sb.seed, f: v => ord(Math.round(v)), fd: v => fmt(v, 1) + ' spots', invert: true }
      ], A, B)));
  } else {
    cards.push(card('Season outlook', 'needs a full-season simulation to compare playoff and title odds',
      h('div.row', { style: { gap: '12px' } },
        h('button.btn.pri', { onclick: (e) => { busyBtn(e.currentTarget); runSeasonSim(2000, () => { SimUI.mode = 'season'; }); } }, 'Run 2,000 seasons'),
        )));
  }
  wrap.appendChild(cards.length > 1 ? h('div.grid.split', cards) : cards[0]);

  /* ---- what they have actually done to each other ---- */
  const hist = h2hHistory(A, B);
  if (hist.length) {
    let aw = 0, bw = 0;
    hist.forEach(g => { if (g.a > g.b) aw++; else if (g.b > g.a) bw++; });
    wrap.appendChild(card('When they have met', `${aw}–${bw} to ${aw >= bw ? A.name : B.name} this season`,
      table([
        { k: 'week', h: 'Week', num: true, f: g => h('b.mono', g.week) },
        { k: 'a', h: A.short, num: true, f: g => h('span.mono', { class: g.a > g.b ? 'up' : '' }, fmt(g.a, 1)) },
        { k: 'b', h: B.short, num: true, f: g => h('span.mono', { class: g.b > g.a ? 'up' : '' }, fmt(g.b, 1)) },
        { k: 'd', h: 'Margin', num: true, sort: g => g.a - g.b, f: g => deltaTag(g.a - g.b, 1) }
      ], hist, { sortKey: 'week', sortDir: 1 })));
  }

  /* ---- do they match up as trade partners? ---- */
  const scA = scoutTeam(A), scB = scoutTeam(B);
  const fits = [];
  scA.holes.forEach(hA => { const sB = scB.surplus.find(x => x.pos === hA.pos); if (sB) fits.push({ from: B, to: A, pos: hA.pos, z: sB.z - hA.z }); });
  scB.holes.forEach(hB => { const sA = scA.surplus.find(x => x.pos === hB.pos); if (sA) fits.push({ from: A, to: B, pos: hB.pos, z: sA.z - hB.z }); });
  wrap.appendChild(card('Do they fit as trade partners?',
    fits.length ? 'each of these is a position one of them is deep at and the other is thin at' : null,
    fits.length
      ? h('div', { style: { display: 'grid', gap: '7px' } }, fits.sort((x, y) => y.z - x.z).map(f =>
        h('div.row', { style: { gap: '8px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '8px 10px', background: 'var(--surface-2)' } },
          posPill(f.pos), h('b.tiny', f.from.name), h('span.tiny.muted', '→'), h('b.tiny', f.to.name),
          h('span', { style: { flex: 1 } }),
          h('span.tiny.muted', 'gap ' + fmt(f.z, 1) + ' SD'),
          h('button.btn.sm', {
            onclick: () => {
              FinderUI.team = f.to.rosterId; FinderUI.partners = [f.from.rosterId];
              FinderUI.positions = [f.pos]; FinderUI.shape = 'any'; FinderUI.focus = null; FinderUI.results = null;
              S.view = 'finder'; render(); window.scrollTo(0, 0);
            }
          }, 'Find a deal'))))
      : h('div.empty', 'Neither team is deep where the other is thin, so a trade here would come down to value.')));
}

/* ================= one specific week ================= */
function h2hWeek(wrap, A, B, CA, CB, wk) {
  const isLive = wk === S.liveWeek;
  /* ---- the headline: this week, straight up ---- */
  if (!H2HUI.res || H2HUI.res.key !== A.rosterId + '|' + B.rosterId + '|' + wk) {
    H2HUI.res = Object.assign(h2hSim(A, B, wk, H2HUI.sims), { key: A.rosterId + '|' + B.rosterId + '|' + wk });
  }
  const r = H2HUI.res;
  const favA = r.pA >= r.pB;
  // the answer first: who is favoured, by how much, and what the odds are, as a scoreboard
  const side = (T, w, p, m) => h('div.h2hside.' + w + (p >= 0.5 ? '.fav' : ''),
    T.avatar ? h('img.h2hav', { src: T.avatar, alt: '', onerror: e => e.target.style.visibility = 'hidden' }) : h('div.h2hav'),
    h('div.h2hnm', T.name),
    h('div.h2hpct.mono', pct(p, 0)),
    h('div.tiny.muted', 'to win · ' + (isLive ? 'live ' : 'projected ') + fmt(m, 1) + ' pts'));
  wrap.appendChild(h('div.h2hhero',
    side(A, 'a', r.pA, r.meanA),
    h('div.h2hmid',
      h('div.h2hbar', { 'aria-hidden': 'true' }, h('i.a', { style: { flex: String(Math.max(r.pA, 0.02)) } }), h('i.b', { style: { flex: String(Math.max(r.pB, 0.02)) } })),
      h('div.h2hmargin', h('span.tiny.muted', 'Typical margin'), h('b', (favA ? A.short : B.short) + ' by ' + fmt(Math.abs(r.medMargin), 1))),
      h('div.tiny.muted', 'median across ' + kfmt(r.n) + ' runs')),
    side(B, 'b', r.pB, r.meanB)));
  wrap.appendChild(h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(min(150px,100%),1fr))' } },
    kpi('One-score game', pct(r.closeGame, 0), 'within 10 points'),
    kpi('Blowout', pct(Math.max(r.blowoutA, r.blowoutB), 0), (r.blowoutA > r.blowoutB ? A.short : B.short) + ' by 30+')
  ));

  const NB = 25;
  const sortedM = r.margins.slice().sort((x, y) => x - y);
  const mq = (q) => sortedM[clamp(Math.floor(q * (sortedM.length - 1)), 0, sortedM.length - 1)];
  // run the axis to the half-percentile so the end bars are not a pile of clipped tail
  let lo = mq(0.004), hi = mq(0.996);
  const span = Math.max(1, hi - lo); lo = Math.min(lo, -span * 0.04); hi = Math.max(hi, span * 0.04);
  const bw = (hi - lo) / NB;
  const bins = Array.from({ length: NB }, (_, i) => {
    const x0 = lo + i * bw;
    return { x: Math.round(x0 + bw / 2), v: 0, color: x0 + bw / 2 >= 0 ? CA : CB, label: (x0 >= 0 ? A.short : B.short) + ' by ' + fmt(Math.abs(x0 + bw / 2), 0) };
  });
  r.margins.forEach(m => { const i = clamp(Math.floor((m - lo) / bw), 0, NB - 1); bins[i].v++; });
  bins.forEach(b => b.v /= r.n);
  wrap.appendChild(card('Margin, week ' + wk, A.name + ' to the right, ' + B.name + ' to the left. '
    + (isLive ? 'points already scored are banked; only the open slots are drawn' : 'both lineups set optimally for this week'),
    h('div', histogram(bins, { h: 190, w: chartW(1040, 360), stretch: true, rule: 0, aria: 'margin distribution' }),
      h('div.tiny.muted', { style: { marginTop: '8px' } },
        `Middle 80% of outcomes run from ${(r.loMargin >= 0 ? A.short + ' by ' : B.short + ' by ')}${fmt(Math.abs(r.loMargin), 0)} to `
        + `${(r.hiMargin >= 0 ? A.short + ' by ' : B.short + ' by ')}${fmt(Math.abs(r.hiMargin), 0)}.`))));

  /* ---- slot by slot ---- */
  // laid out as a mirror: each side's player on the outside, their number just
  // inside it, and the slot itself down the middle. Reading across a row you get
  // "this player, this many, at this spot, this many, that player".

  const la = isLive ? liveLineupSlots(A, wk) : optimalLineup(activePlayers(A), p => pw(p, wk));
  const lb = isLive ? liveLineupSlots(B, wk) : optimalLineup(activePlayers(B), p => pw(p, wk));
  const slotRows = la.map((sa, i) => {
    const sb = lb[i] || {};
    const va = sa.player ? pwShown(sa.player, wk) : 0, vb = sb.player ? pwShown(sb.player, wk) : 0;
    return { slot: sa.slot, a: sa.player, b: sb.player, va, vb, d: va - vb };
  });
  const aWon = slotRows.filter(x => x.d > 0).length;
  wrap.appendChild(card('Slot by slot, week ' + wk,
    `${A.short} wins ${aWon} of ${slotRows.length} slots ${isLive ? 'so far' : 'on projection'} · totals ${fmt(sum(slotRows.map(x => x.va)), 1)} to ${fmt(sum(slotRows.map(x => x.vb)), 1)}`
    + (isLive ? ' · points already scored are shown as scored' : ''),
    slotLadder(slotRows, A, B, CA, CB, { wk, live: isLive })));

  /* ---- who is sitting this week out ---- */
  // the same "on bye" the Start / Sit page uses, over the players a team can actually play
  // (not IR or taxi), best first — so a missing star is easy to see before the slots are read
  const byesOf = (T) => activePlayers(T).filter(p => p.team && onBye(p, wk)).sort((x, y) => (y.dv || 0) - (x.dv || 0));
  const byeA = byesOf(A), byeB = byesOf(B);
  const byeCol = (T, list, col) => h('div', { style: { minWidth: 0 } },
    h('div.row', { style: { gap: '7px', marginBottom: '6px' } },
      h('i', { style: { width: '3px', alignSelf: 'stretch', borderRadius: '2px', background: col } }),
      h('b', T.short), h('span.tiny.muted', list.length ? list.length + ' on bye' : 'none')),
    list.length
      ? h('div', { style: { display: 'grid', gap: '2px' } }, list.map(p => h('div.row.lline', { style: { gap: '6px', minWidth: 0, flexWrap: 'nowrap', borderLeftColor: col } },
        posPill(p.pos), pname(p), p.team ? h('span.tiny.muted', p.team) : null,
        h('span', { style: { flex: 1 } }),
        h('span.tiny.muted.mono', { title: 'typical points per game' }, fmt(p.ppg || 0, 1) + ' ppg'))))
      : h('div.tiny.muted', 'Nobody on ' + T.short + ' is on a bye.'));
  wrap.appendChild(card('Players on bye, week ' + wk,
    byeA.length + byeB.length
      ? `${A.short} has ${byeA.length}, ${B.short} has ${byeB.length} · active roster only, best player first`
      : 'neither active roster has anyone on a bye this week',
    h('div', { style: { display: 'grid', gridTemplateColumns: isNarrow() ? '1fr' : '1fr 1fr', gap: isNarrow() ? '14px' : '24px' } },
      byeCol(A, byeA, CA), byeCol(B, byeB, CB))));
}

/* ================= next year's draft order ================= */
/** The soonest draft any roster still holds a pick in. */
function nextDraftSeason() {
  let best = null;
  S.teams.forEach(t => (t.pickAssets || []).forEach(pk => { if (best === null || pk.season < best) best = pk.season; }));
  return best;
}
/** Who actually holds the pick a given team originally owned. */
function pickHolder(origRosterId, season, round) {
  for (const t of S.teams) {
    const hit = (t.pickAssets || []).find(pk => pk.origRosterId === origRosterId && pk.season === season && pk.round === round);
    if (hit) return t;
  }
  return null;   // not held by anyone in this league — already used, or outside the window
}

/** Where each team is heading in the next draft, and who will actually be making
 *  the pick. The order comes out of the same simulation as everything else. */
function simDraftCard(res) {
  const rows = S.teams.map(t => ({ t, s: res.by[t.rosterId] }))
    .filter(r => r.s && r.s.draftSlot > 0);
  if (!rows.length) return null;
  rows.sort((a, b) => a.s.draftSlot - b.s.draftSlot);
  const season = nextDraftSeason();
  // the rounds this league actually drafts, as far as anyone still holds picks
  const rounds = [];
  if (season !== null) {
    S.teams.forEach(t => (t.pickAssets || []).forEach(pk => {
      if (pk.season === season && !rounds.includes(pk.round)) rounds.push(pk.round);
    }));
    rounds.sort((a, b) => a - b);
  }
  const slotLabel = (v) => Math.round(v * 10) / 10;
  const modal = (d) => { let b = 1; for (let i = 1; i < d.length; i++) if (d[i] > d[b]) b = i; return b; };
  // the slots holding the middle 80% of the outcomes
  const band = (d) => {
    const cum = []; let run = 0;
    for (let i = 1; i < d.length; i++) { run += d[i]; cum[i] = run; }
    let lo = 1, hi = d.length - 1;
    for (let i = 1; i < d.length; i++) if (cum[i] >= 0.1) { lo = i; break; }
    for (let i = 1; i < d.length; i++) if (cum[i] >= 0.9) { hi = i; break; }
    return { lo, hi };
  };

  const heldCell = (r) => {
    if (!isDynasty() || season === null) return h('span.muted.tiny', '—');
    const away = [];
    rounds.forEach(rd => {
      const holder = pickHolder(r.t.rosterId, season, rd);
      if (holder && holder.rosterId !== r.t.rosterId) away.push({ rd, holder });
    });
    if (!away.length) return h('span.tiny.muted', 'all their own');
    return h('div.row', { style: { gap: '4px' } }, away.map(x =>
      bindTT(h('span.tag.traded', (ROUND_WORD[x.rd] || x.rd + 'th') + ' → ' + x.holder.short),
        `<div class="k">${season} ${ROUND_WORD[x.rd] || x.rd + 'th'} round</div>`
        + `Originally <b>${esc(r.t.name)}</b>'s<br>Now held by <b>${esc(x.holder.name)}</b>`)));
  };

  const anyTraded = isDynasty() && season !== null && S.teams.some(t =>
    (t.pickAssets || []).some(pk => pk.origRosterId !== t.rosterId && pk.season === season));

  const tbl = table([
    { k: 'slot', h: 'Proj. slot', num: true, sort: r => r.s.draftSlot, f: r => h('b.mono', slotLabel(r.s.draftSlot)) },
    { k: 'name', h: 'Original owner', sort: r => r.t.name, f: r => isNarrow() ? teamLine(r.t, 24) : teamCell(r.t) },
    {
      k: 'likely', prio: 2, h: 'Most likely', num: true, sortable: false,
      f: r => { const m = modal(r.s.draftDist); return h('span', h('b.mono', '1.' + String(m).padStart(2, '0')), h('span.tiny.muted', ' ' + pct(r.s.draftDist[m], 0))); }
    },
    { k: 'range', prio: 2, h: 'Middle 80%', sortable: false, f: r => { const b = band(r.s.draftDist); return h('span.tiny.mono.muted', b.lo === b.hi ? String(b.lo) : b.lo + '–' + b.hi); } },
    {
      k: 'first', h: isNarrow() ? '1.01' : 'The 1.01', num: true, sort: r => r.s.draftDist[1],
      f: r => h('div.meter', { style: { justifyContent: 'flex-end' } },
        isNarrow() ? null : h('div.bar-track', { style: { width: '44px' } }, h('div.bar-fill', { style: { width: (r.s.draftDist[1] * 100) + '%', background: 'var(--s4)' } })),
        h('span.mono', pct(r.s.draftDist[1], 0)))
    },
    {
      k: 'top3', prio: 2, h: 'Top 3', num: true,
      sort: r => r.s.draftDist[1] + r.s.draftDist[2] + r.s.draftDist[3],
      f: r => h('span.mono', pct(r.s.draftDist[1] + r.s.draftDist[2] + r.s.draftDist[3], 0))
    },
    { k: 'playoff', prio: 2, h: 'Playoffs', num: true, sort: r => r.s.playoff, f: r => h('span.mono.muted', pct(r.s.playoff, 0)) },
    isDynasty() ? { k: 'held', h: season !== null ? season + ' picks' : 'Picks', sortable: false, f: heldCell } : null
  ], rows, { sortKey: 'slot', sortDir: 1 });

  return card('Next year\'s draft order' + (season !== null ? ', ' + season : ''),
    'from the same ' + kfmt(res.n) + ' seasons: everyone who misses the playoffs picks first, fewest points first, then the playoff teams in the order they went out',
    h('div', { style: { display: 'grid', gap: '11px' } },
      tbl,
      anyTraded ? h('div.tiny.muted',
        h('span', h('b', 'Some of these picks have already moved.'), ' A tag like ', h('span.tag.traded', '1st → ABC'),
          ' means that team\'s own first-rounder belongs to somebody else now. The slot on the left is where the pick lands, not who gets to use it.')) : null,
      h('div.tiny.muted', 'Leagues with a lottery, or a different back-half order, will differ.')));
}


/* ================= slot by slot, as a mirror =================
   Two lineups side by side, one row per slot: each side's player on the outside,
   their number just inside it, and the slot itself down the middle. Head to Head
   and the This Week matchup page both draw it, so a slot comparison reads the
   same way wherever it turns up.

   rows: [{ slot, a, b, va, vb }] — a/b are players (or null), va/vb the number
   each is counted at. opts.live adds each player's game status; opts.cell, when
   given, draws the number cell instead of the default (it gets the player, the
   value, whether that side wins the slot, and the side's colour). On a phone the
   five columns do not fit, so each slot becomes a header and two stacked lines. */
function slotLadder(rows, A, B, CA, CB, opts) {
  opts = opts || {};
  const wk = opts.wk, live = !!opts.live;
  rows = rows.map(r => Object.assign({ d: (r.va || 0) - (r.vb || 0) }, r));
  const num = opts.cell || ((pl, v, won, col) => h('span.mono', {
    style: { fontWeight: won ? 700 : 500, color: won ? col : 'var(--text-secondary)' }
  }, fmt(v, 1)));
  // a fixed slot already names the position, so the pill only earns its place
  // where the slot accepts more than one — flex and superflex
  const flexy = (slot, pl) => pl && (SLOT_ELIG[slot] || [slot]).length > 1 ? posPill(pl.pos) : null;
  const badge = (pl) => live && pl && !opts.cell ? liveBadge(pl, wk) : null;

  if (isNarrow()) {
    /* Two lines per slot can't say whose is whose by position alone, so each team
       gets a colour, a key at the top, and a bar of that colour down its lines. */
    const chip = (T, col, tot) => h('div.lteam', h('i', { style: { background: col } }), h('b', T.short), h('span.tiny.muted.lfull', T.name),
      h('span', { style: { flex: 1 } }), h('b.mono', { style: { color: col } }, fmt(tot, 1)), h('span.tiny.muted', 'total'));
    const key = h('div.lkey', chip(A, CA, sum(rows.map(r => r.va || 0))), chip(B, CB, sum(rows.map(r => r.vb || 0))));
    return h('div', { style: { display: 'grid', gap: '2px' } }, [key].concat(rows.map(r2 => {
      const line = (pl, v, won, col) => h('div.row.lline', { style: { gap: '6px', minWidth: 0, flexWrap: 'nowrap', borderLeftColor: col } },
        pl ? flexy(r2.slot, pl) : null,
        pl ? pname(pl, { style: { fontWeight: won ? 640 : 500 } }) : h('span.muted.tiny', 'empty'),
        badge(pl),
        h('span', { style: { flex: 1 } }),
        h('div', { style: { textAlign: 'right' } }, num(pl, v, won, col)));
      const lead = r2.d > 0 ? h('span.tiny.mono', { style: { color: CA, fontWeight: 650 } }, A.short + ' +' + fmt(r2.d, 1))
        : r2.d < 0 ? h('span.tiny.mono', { style: { color: CB, fontWeight: 650 } }, B.short + ' +' + fmt(-r2.d, 1))
          : h('span.tiny.mono.muted', 'tied');
      return h('div.ladderstack',
        h('div.row', { style: { gap: '7px', marginBottom: '4px' } },
          h('span.tag', { style: { minWidth: '44px', textAlign: 'center' } }, SLOT_LABEL[r2.slot] || r2.slot),
          h('span', { style: { flex: 1 } }), lead),
        line(r2.a, r2.va, r2.d > 0, CA), line(r2.b, r2.vb, r2.d < 0, CB));
    })));
  }

  const cw = opts.cell ? 'minmax(0,1fr) 96px 74px 96px minmax(0,1fr)' : 'minmax(0,1fr) 64px 74px 64px minmax(0,1fr)';
  const word = opts.head || (live ? 'Pts' : 'Proj');
  const head = h('div.ladderrow.ladderhd', { style: { gridTemplateColumns: cw } },
    h('b.tiny', { style: { textAlign: 'right', color: CA } }, A.short),
    h('span.tiny.muted', { style: { textAlign: 'right' } }, word),
    h('span.tiny.muted', { style: { textAlign: 'center' } }, 'Slot'),
    h('span.tiny.muted', word),
    h('b.tiny', { style: { color: CB } }, B.short));
  return h('div', { style: { display: 'grid' } }, [head].concat(rows.map(r2 => h('div.ladderrow', { style: { gridTemplateColumns: cw } },
    h('div.pl.l', r2.a
      ? [badge(r2.a), flexy(r2.slot, r2.a), pname(r2.a, { mirror: true, style: { fontWeight: r2.d > 0 ? 640 : 500 } })]
      : h('span.muted.tiny', 'empty')),
    h('div', { style: { textAlign: 'right' } }, num(r2.a, r2.va, r2.d > 0, CA)),
    h('div', { style: { textAlign: 'center' } }, h('span.tag', { style: { minWidth: '46px', textAlign: 'center' } }, SLOT_LABEL[r2.slot] || r2.slot)),
    h('div', num(r2.b, r2.vb, r2.d < 0, CB)),
    h('div.pl.r', r2.b
      ? [pname(r2.b, { style: { fontWeight: r2.d < 0 ? 640 : 500 } }), flexy(r2.slot, r2.b), badge(r2.b)]
      : h('span.muted.tiny', 'empty'))))));
}
