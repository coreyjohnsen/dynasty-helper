"use strict";
/* ================= 12. HEAD TO HEAD ================= */
const H2HUI = { a: null, b: null, week: null, sims: 4000, res: null };

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
  const isLive = wk === S.liveWeek;

  wrap.appendChild(matchupBar({
    key: 'h2h', aId: A.rosterId, bId: B.rosterId,
    onPick: (w, id) => { H2HUI[w] = id; H2HUI.res = null; render(); },
    onSwap: () => { const t = H2HUI.a; H2HUI.a = H2HUI.b; H2HUI.b = t; H2HUI.res = null; render(); }
  }));
  wrap.appendChild(h('div.h2hweek',
    h('label.fld', { style: { minWidth: '210px' } }, meet.length ? (meet.length === 1 ? 'They meet once' : 'They meet ' + meet.length + ' times') : 'Neutral week',
      h('select', { onchange: e => { H2HUI.week = +e.target.value; H2HUI.res = null; render(); } },
        weeks.map(w => h('option', { value: w, selected: w === wk },
          'Week ' + w + (w <= S.lastWeek ? ' (played)' : w === next ? ' (next meeting)' : ''))))),
    meet.length
      ? h('span.tiny.muted', { style: { maxWidth: '420px' } },
        meet.length === 1
          ? 'Week ' + meet[0] + ' is the only week these two play each other.'
          : 'Weeks ' + meet.slice(0, -1).join(', ') + ' and ' + meet[meet.length - 1] + ' are the only weeks these two play each other.')
      : h('span.tiny.muted', { style: { maxWidth: '440px', color: 'var(--text-secondary)' } },
        A.short + ' and ' + B.short + ' never meet this season, so this is a neutral matchup — pick any week and both lineups are set for it.')));
  if (A.rosterId === B.rosterId) return wrap.appendChild(card(null, null, h('div.empty', 'Pick two different teams.'))), wrap;

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
  wrap.appendChild(card('Margin, week ' + wk, A.name + ' to the right, ' + B.name + ' to the left — '
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
  wrap.appendChild(card('Slot by slot — week ' + wk,
    `${A.short} wins ${aWon} of ${slotRows.length} slots ${isLive ? 'so far' : 'on projection'} · totals ${fmt(sum(slotRows.map(x => x.va)), 1)} to ${fmt(sum(slotRows.map(x => x.vb)), 1)}`
    + (isLive ? ' · points already scored are shown as scored' : ''),
    slotLadder(slotRows, A, B, CA, CB, { wk, live: isLive })));

  /* ---- the franchises, not just this week ---- */
  const metrics = [
    { k: 'Starting lineup now', a: A.now, b: B.now, d: 1, tip: 'Projected points per week from the optimal lineup' },
    isDynasty() ? { k: 'Future lineup', a: A.future, b: B.future, d: 1, tip: 'Age-adjusted projection two to three seasons out' } : null,
    { k: capitalLabel(), a: A.totalValue, b: B.totalValue, d: 0, tip: isDynasty() ? 'Players plus draft picks at today’s market' : 'Every rostered player at today’s redraft market' },
    isDynasty() ? { k: 'Roster value', a: A.rosterValue, b: B.rosterValue, d: 0 } : null,
    isDynasty() ? { k: 'Pick capital', a: A.pickCapital, b: B.pickCapital, d: 0 } : null,
    { k: 'Points for', a: A.fpts, b: B.fpts, d: 1 },
    { k: 'Points against', a: A.fptsAgainst, b: B.fptsAgainst, d: 1, invert: true, tip: 'What their opponents have scored on them — lower is a kinder draw' },
    isDynasty() ? { k: 'Average age', a: A.age || 0, b: B.age || 0, d: 1, invert: true, tip: 'Value-weighted — younger is usually the more valuable asset base' } : null
  ].filter(Boolean);
  const scaleOf = (m) => { const mx = Math.max(Math.abs(m.a), Math.abs(m.b), 0.0001); return (m.a - m.b) / mx; };
  const cw = isNarrow() ? '62px 1fr 62px' : '92px 1fr 92px';
  const aWins = metrics.filter(m => m.invert ? m.a < m.b : m.a > m.b).length;
  wrap.appendChild(card('The two franchises', `${A.short} leads ${aWins} of these ${metrics.length}`,
    h('div', { style: { display: 'grid', gap: '7px' } }, [
      h('div', { style: { display: 'grid', gridTemplateColumns: cw, gap: '10px', alignItems: 'center', paddingBottom: '2px' } },
        h('b.tiny', { style: { textAlign: 'right', color: CA } }, A.short),
        h('div'),
        h('b.tiny', { style: { color: CB } }, B.short))
    ].concat(metrics.map(m => {
      const lead = m.invert ? (m.a < m.b) : (m.a > m.b);
      const row = h('div', { style: { display: 'grid', gridTemplateColumns: cw, gap: '10px', alignItems: 'center' } },
        h('span.mono.tiny', { style: { textAlign: 'right', fontWeight: lead ? 700 : 500, color: lead ? CA : 'var(--text-muted)' } }, m.d ? fmt(m.a, m.d) : kfmt(Math.round(m.a))),
        h('div',
          h('div.tiny.muted', { style: { textAlign: 'center', marginBottom: '2px' } }, m.k),
          h('div', { style: { position: 'relative', height: '9px', background: 'var(--div-neutral)', borderRadius: '3px' } },
            h('div', {
              style: {
                position: 'absolute', top: 0, bottom: 0, borderRadius: '3px',
                left: scaleOf(m) >= 0 ? '50%' : (50 + scaleOf(m) * 50) + '%',
                width: Math.abs(scaleOf(m)) * 50 + '%',
                background: scaleOf(m) >= 0 ? CA : CB
              }
            }),
            h('div', { style: { position: 'absolute', left: '50%', top: '-2px', bottom: '-2px', width: '1px', background: 'var(--axis)' } }))),
        h('span.mono.tiny', { style: { fontWeight: !lead ? 700 : 500, color: !lead ? CB : 'var(--text-muted)' } }, m.d ? fmt(m.b, m.d) : kfmt(Math.round(m.b))));
      if (m.tip) bindTT(row, `<div class="k">${m.k}</div>${m.tip}`);
      return row;
    })))));

  /* ---- positional edge ---- */
  const posRows = POS4.map(p => ({
    pos: p, aNow: A.posNow[p] || 0, bNow: B.posNow[p] || 0,
    aVal: A.posValue[p] || 0, bVal: B.posValue[p] || 0
  }));
  wrap.appendChild(h('div.grid.split',
    card('Positional edge — this season', 'starting output per week · right is ' + A.short + ', left is ' + B.short,
      divBar(posRows.map(x => ({ label: x.pos, v: x.aNow - x.bNow, tip: `<div class="k">${x.pos}</div>${A.short} ${fmt(x.aNow, 1)} · ${B.short} ${fmt(x.bNow, 1)}` })), { labelW: '48px', dec: 1, posColor: CA, negColor: CB })),
    card('Positional edge — ' + valueWord() + ' value', 'market value at each position',
      divBar(posRows.map(x => ({ label: x.pos, v: x.aVal - x.bVal, vl: sgn((x.aVal - x.bVal) / 1000, 1) + 'k', tip: `<div class="k">${x.pos}</div>${A.short} ${kfmt(Math.round(x.aVal))} · ${B.short} ${kfmt(Math.round(x.bVal))}` })), { labelW: '48px', dec: 0, posColor: CA, negColor: CB }))));

  /* ---- season outlook, if a sim exists ---- */
  if (S.sim && S.sim.by[A.rosterId] && S.sim.by[B.rosterId]) {
    const sa = S.sim.by[A.rosterId], sb = S.sim.by[B.rosterId];
    const row = (label, va, vb, f) => h('div', { style: { display: 'grid', gridTemplateColumns: isNarrow() ? '58px 1fr 58px' : '74px 1fr 74px', gap: '10px', alignItems: 'center' } },
      h('span.mono.tiny', { style: { textAlign: 'right', fontWeight: va >= vb ? 700 : 500 } }, f(va)),
      h('div', h('div.tiny.muted', { style: { textAlign: 'center', marginBottom: '2px' } }, label),
        oddsBar([{ v: va, color: CA }, { v: Math.max(0.0001, vb), color: CB }], { h: 8 })),
      h('span.mono.tiny', { style: { fontWeight: vb > va ? 700 : 500 } }, f(vb)));
    wrap.appendChild(card('Season outlook', 'from the last full-season simulation you ran',
      h('div', { style: { display: 'grid', gap: '8px' } },
        row('Projected wins', sa.wins, sb.wins, v => fmt(v, 1)),
        row('Playoff odds', sa.playoff, sb.playoff, v => pct(v, 0)),
        row('Title odds', sa.title, sb.title, v => pct(v, 1)),
        row('Average seed', S.teams.length + 1 - sa.seed, S.teams.length + 1 - sb.seed, v => ord(Math.round(S.teams.length + 1 - v))))));
  }

  else {
    wrap.appendChild(card('Season outlook', 'needs a full-season simulation to compare playoff and title odds',
      h('div.row', { style: { gap: '12px' } },
        h('button.btn.pri', {
          onclick: () => { S.sim = simulate(2000); SimUI.res = S.sim; SimUI.mode = 'season'; render(); }
        }, 'Run 2,000 seasons'),
        h('span.tiny.muted', 'the Simulator tab keeps the full result'))));
  }

  /* ---- what they have actually done to each other ---- */
  const hist = h2hHistory(A, B);
  if (hist.length) {
    let aw = 0, bw = 0;
    hist.forEach(g => { if (g.a > g.b) aw++; else if (g.b > g.a) bw++; });
    wrap.appendChild(card('When they have actually met', `${aw}–${bw} to ${aw >= bw ? A.name : B.name} this season`,
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
      : h('div.empty', 'Neither team is deep where the other is thin — a trade here would have to be about value, not need.')));
  return wrap;
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
        + `Originally <b>${r.t.name}</b>’s<br>Now held by <b>${x.holder.name}</b>`)));
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

  return card('Next year’s draft order' + (season !== null ? ' — ' + season : ''),
    'from the same ' + kfmt(res.n) + ' seasons: everyone who misses the playoffs picks first, fewest points first, then the playoff teams in the order they went out',
    h('div', { style: { display: 'grid', gap: '11px' } },
      tbl,
      h('div.tiny.muted',
        anyTraded
          ? h('span', h('b', 'Some of these picks have already moved.'), ' A tag like ', h('span.tag.traded', '1st → ABC'),
            ' means that team’s own first-rounder belongs to somebody else now — the slot on the left is where the pick lands, not who gets to use it.')
          : (isDynasty()
            ? 'Every team still holds its own picks in this draft, so the slot and the owner are the same thing.'
            : 'A redraft league does not carry picks between seasons, so this is the order the next draft would run in, not a set of assets anyone holds.')),
      h('div.tiny.muted',
        'Ties are broken on points, the way the standings break them. Leagues that use a lottery, or order the back half by regular-season finish rather than playoff exit, will differ — this is the common default, not a reading of your league’s bylaws.')));
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
