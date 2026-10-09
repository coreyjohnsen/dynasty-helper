"use strict";
/* ================= monte carlo =================
   Lineups are rebuilt for every week, because a player on bye projects nothing and
   the optimiser has to start somebody else. Scores are gamma-distributed, matching
   the right-skewed, never-negative shape of real weekly fantasy scoring. */
function buildWeeklyStarters(teams, weeks, rosterFor, live) {
  const out = {};
  weeks.forEach(wk => {
    out[wk] = teams.map(t => {
      /* A week already under way is part simulated, part settled: the games that
         have finished are facts, not draws. Only the open slots get sampled, and
         what is banked rides along as a fixed offset. */
      /* A week under way is treated as locked: the lineups are what the managers
         already set, and the finished games are facts. That holds whoever is
         asking — a hypothetical trade cannot un-play Sunday — which also keeps
         every paired before/after comparison honest. */
      if (live && wk === S.liveWeek) {
        const lr = liveRoster(t, wk);
        return {
          banked: lr.banked,
          arr: lr.open.map(r => ({ m: r.used, sd: volFromMean(r.p.pos, r.used), pos: r.p.pos }))
        };
      }
      return {
        banked: 0,
        arr: optimalLineup(withReturners(rosterFor(t), t, wk), (p) => pw(p, wk))
          .map(s => {
            // No manager leaves a slot empty or starts a bye player — they stream it.
            const pos = s.player ? s.player.pos : (SLOT_ELIG[s.slot] || [s.slot])[0];
            let m = s.player ? pw(s.player, wk) : 0;
            if (m <= 0.05) m = STREAM[pos] !== undefined ? STREAM[pos] : 0;
            return { m, sd: volFromMean(pos, m), pos };
          })
          .filter(x => x.m > 0.05)
      };
    });
  });
  return out;
}
function simulate(nSims, opts) {
  opts = opts || {};
  const teams = S.teams, n = teams.length, idOf = {}; teams.forEach((t, i) => idOf[t.rosterId] = i);
  const sched = schedule();
  const overrides = opts.overrides || null; // rosterId -> array of player objects
  const rosterFor = (t) => (overrides && overrides[t.rosterId]) ? overrides[t.rosterId] : activePlayers(t);
  const fromWeek = opts.fromWeek || (S.lastWeek + 1);
  const onlyWeek = opts.onlyWeek || null;
  const settings = S.league.settings || {};
  const playoffTeams = Math.min(settings.playoff_teams || 6, n);
  const divOf = teams.map(t => t.division || null);
  const nDiv = settings.divisions && divOf.some(d => d) ? settings.divisions : 0;
  const baseW = teams.map(t => t.wins + 0.5 * t.ties);
  const baseP = teams.map(t => t.fpts);

  const weekList = [];
  if (onlyWeek) weekList.push(onlyWeek);
  else { for (let w = fromWeek; w <= S.regEnd + 4; w++) weekList.push(w); }
  const starters = buildWeeklyStarters(teams, weekList, rosterFor, true);
  const fallbackWk = weekList[0];

  /* Leverage covers every game left in the season, not just this week's. Each run
     records who won each remaining game alongside that run's final outcome, so the
     finished simulations can be split by any single result. Weekly scores are drawn
     independently, so conditioning on one game carries no hidden selection effect —
     the difference it makes is the difference the game makes. */
  const levGames = [];
  if (!onlyWeek) {
    for (let w = fromWeek; w <= S.regEnd; w++) {
      (sched[w - 1] || []).forEach(g => {
        if (idOf[g[0]] === undefined || idOf[g[1]] === undefined) return;
        levGames.push({ week: w, a: g[0], b: g[1] });
      });
    }
  }
  const levWeek = levGames.length ? levGames[0].week : null;
  const nG = levGames.length;

  const acc = {
    wins: new Float64Array(n), pts: new Float64Array(n), playoff: new Float64Array(n),
    bye: new Float64Array(n), semi: new Float64Array(n), final: new Float64Array(n),
    title: new Float64Array(n), seed: new Float64Array(n), best: new Float64Array(n).fill(99), worst: new Float64Array(n),
    winDist: Array.from({ length: n }, () => new Float64Array(S.regEnd + 1)),
    weekWin: new Float64Array(n), weekPts: new Float64Array(n), weekTop: new Float64Array(n),
    weekScores: Array.from({ length: n }, () => []),
    // --- expanded instrumentation ---
    seedDist: Array.from({ length: n }, () => new Float64Array(n + 1)),
    allPlay: new Float64Array(n),          // all-play wins over the simulated weeks
    allPlayGames: 0,                       // (n-1) x weeks simulated, same for everyone
    simWins: new Float64Array(n),          // wins earned in the simulated weeks only
    oppPts: new Float64Array(n), oppGames: new Float64Array(n),   // rest-of-season SOS
    ptsRuns: Array.from({ length: n }, () => []),                 // season PF per run
    fieldAt: Array.from({ length: n }, () => new Float64Array(S.regEnd + 2)),  // in the field after week w
    aliveAt: Array.from({ length: n }, () => new Float64Array(S.regEnd + 2)),  // can still reach the cut
    knockedBy: new Float64Array(n * n),    // [loser*n + winner] in the bracket
    draftSum: new Float64Array(n),         // next draft: summed slot across runs
    draftDist: Array.from({ length: n }, () => new Float64Array(n + 1)),
    finalVs: new Float64Array(n * n),      // met in the title game
    poWins: new Float64Array(n),           // playoff games won
    // leverage: for each game in the next week, each side's odds when they win vs lose
    lev: levGames.map(() => ({ nA: 0, nB: 0, poAw: 0, poAl: 0, poBw: 0, poBl: 0, tiAw: 0, tiAl: 0, tiBw: 0, tiBl: 0 }))
  };
  seedRng(opts.seed !== undefined ? opts.seed : ((Math.random() * 4294967296) >>> 0));

  const score = (i, wk) => {
    const byWeek = starters[wk] || starters[fallbackWk];
    if (!byWeek) return 0;
    const cell = byWeek[i]; const st = cell.arr; let s = 0;
    for (let k = 0; k < st.length; k++) {
      if (rnd() < BUST_RATE) continue;         // starter inactive or knocked out early
      s += drawScore(st[k].m, st[k].sd);
    }
    return cell.banked + Math.max(0, s * Math.max(0.55, 1 + 0.05 * gauss()));
  };

  /* Seeding order for a given win/points state. Division winners take the top
     seeds where the league uses divisions, which is Sleeper's default. */
  const standingsOrder = (w, p) => {
    let order = Array.from({ length: n }, (_, i) => i).sort((a, b) => (w[b] - w[a]) || (p[b] - p[a]));
    if (nDiv > 1) {
      const seen = new Set(), winners = [];
      for (const i of order) { const d = divOf[i]; if (d && !seen.has(d)) { seen.add(d); winners.push(i); } }
      const wset = new Set(winners);
      order = winners.concat(order.filter(i => !wset.has(i)));
    }
    return order;
  };
  const simWeeks = Math.max(0, S.regEnd - fromWeek + 1);
  acc.allPlayGames = simWeeks * Math.max(1, n - 1);
  const levIdx = {};   // week|a|b -> index into acc.lev
  levGames.forEach((g, gi) => { levIdx[g.week + '|' + g.a + '|' + g.b] = gi; });

  for (let sim = 0; sim < nSims; sim++) {
    const w = baseW.slice(), p = baseP.slice();
    const levWon = new Int8Array(nG).fill(-1);
    if (onlyWeek) {
      const games = sched[onlyWeek - 1] || [];
      const sc = new Float64Array(n);
      for (let i = 0; i < n; i++) { sc[i] = score(i, onlyWeek); acc.weekPts[i] += sc[i]; acc.weekScores[i].push(sc[i]); }
      let top = 0; for (let i = 1; i < n; i++) if (sc[i] > sc[top]) top = i;
      acc.weekTop[top]++;
      games.forEach(([a, b]) => {
        const ia = idOf[a], ib = idOf[b]; if (ia === undefined || ib === undefined) return;
        if (sc[ia] > sc[ib]) acc.weekWin[ia]++; else if (sc[ib] > sc[ia]) acc.weekWin[ib]++; else { acc.weekWin[ia] += .5; acc.weekWin[ib] += .5; }
      });
      continue;
    }
    for (let wk = fromWeek; wk <= S.regEnd; wk++) {
      const games = sched[wk - 1] || [];
      const sc = new Float64Array(n);
      for (let i = 0; i < n; i++) sc[i] = score(i, wk);
      for (let i = 0; i < n; i++) p[i] += sc[i];
      // all-play: how many teams you would have beaten this week. Comparing this
      // with the games you actually won is what separates a good team from a
      // lucky one, and it costs one sort a week.
      const byScore = Array.from({ length: n }, (_, i) => i).sort((a, b) => sc[b] - sc[a]);
      for (let r = 0; r < n; r++) acc.allPlay[byScore[r]] += (n - 1 - r);
      games.forEach(([a, b]) => {
        const ia = idOf[a], ib = idOf[b]; if (ia === undefined || ib === undefined) return;
        acc.oppPts[ia] += sc[ib]; acc.oppPts[ib] += sc[ia]; acc.oppGames[ia]++; acc.oppGames[ib]++;
        let res;
        if (sc[ia] > sc[ib]) { w[ia]++; res = 0; }
        else if (sc[ib] > sc[ia]) { w[ib]++; res = 1; }
        else { w[ia] += .5; w[ib] += .5; res = -1; }
        if (nG) { const gi = levIdx[wk + '|' + a + '|' + b]; if (gi !== undefined) levWon[gi] = res; }
      });
      // where everyone stands with the season paused here
      const ord = standingsOrder(w, p);
      for (let s = 0; s < playoffTeams && s < n; s++) acc.fieldAt[ord[s]][wk]++;
      // still able to reach the cut line on wins alone — an approximation, since
      // it ignores who plays whom from here, but it is the shape of a magic number
      const cut = w[ord[Math.min(playoffTeams, n) - 1]];
      const left = S.regEnd - wk;
      for (let i = 0; i < n; i++) if (w[i] + left >= cut) acc.aliveAt[i][wk]++;
    }
    for (let i = 0; i < n; i++) { acc.simWins[i] += w[i] - baseW[i]; acc.ptsRuns[i].push(p[i]); }
    const order = standingsOrder(w, p);
    for (let s = 0; s < n; s++) {
      const i = order[s];
      acc.wins[i] += w[i]; acc.pts[i] += p[i]; acc.seed[i] += s + 1;
      if (s + 1 < acc.best[i]) acc.best[i] = s + 1;
      if (s + 1 > acc.worst[i]) acc.worst[i] = s + 1;
      const wi = clamp(Math.round(w[i]), 0, S.regEnd); acc.winDist[i][wi] += 1;
      acc.seedDist[i][s + 1]++;
    }
    const field = order.slice(0, playoffTeams);
    field.forEach(i => acc.playoff[i]++);
    // how far each playoff team got, which is what orders the back half of the
    // draft: -1 never made it, then 1 for a first-round exit upward
    const exit = new Int16Array(n).fill(-1);
    let roundNo = 0;
    let round = field.slice();
    const byes = (1 << Math.ceil(Math.log2(Math.max(2, playoffTeams)))) - playoffTeams;
    if (byes > 0) round.slice(0, byes).forEach(i => acc.bye[i]++);
    let pwk = S.regEnd + 1;
    const play = (list, wk) => {
      const nx = [];
      const arr = list.slice();
      roundNo++;
      if (arr.length % 2 === 1) nx.push(arr.shift());
      for (let i = 0; i < arr.length / 2; i++) {
        const a = arr[i], b = arr[arr.length - 1 - i];
        const aWins = score(a, wk) >= score(b, wk);
        const win = aWins ? a : b, lose = aWins ? b : a;
        acc.knockedBy[lose * n + win]++; acc.poWins[win]++;
        exit[lose] = roundNo;
        nx.push(win);
      }
      return nx.sort((x, y) => field.indexOf(x) - field.indexOf(y));
    };
    if (byes > 0 && round.length > 2) {
      const seeded = round.slice(0, byes), rest = round.slice(byes);
      round = seeded.concat(play(rest, pwk)).sort((x, y) => field.indexOf(x) - field.indexOf(y));
      pwk++;
    }
    while (round.length > 4) { round = play(round, pwk); pwk++; }
    round.forEach(i => acc.semi[i]++);
    while (round.length > 2) { round = play(round, pwk); pwk++; }
    round.forEach(i => acc.final[i]++);
    if (round.length === 2) { acc.finalVs[round[0] * n + round[1]]++; acc.finalVs[round[1] * n + round[0]]++; }
    while (round.length > 1) { round = play(round, pwk); pwk++; }
    const champ = round[0];
    if (champ !== undefined) { acc.title[champ]++; exit[champ] = roundNo + 1; }

    /* Next year's draft order, the way most leagues run it: everyone who missed
       the playoffs picks first, worst scoring first, and the playoff teams follow
       in the order they went out — champion last. Points break every tie, which
       is what the standings already do. */
    {
      const miss = [], made = [];
      for (let i = 0; i < n; i++) (exit[i] >= 0 ? made : miss).push(i);
      miss.sort((a, b) => p[a] - p[b]);
      made.sort((a, b) => (exit[a] - exit[b]) || (p[a] - p[b]));
      const dOrder = miss.concat(made);
      for (let sl = 0; sl < n; sl++) { acc.draftSum[dOrder[sl]] += sl + 1; acc.draftDist[dOrder[sl]][sl + 1]++; }
    }

    /* Leverage. One pass of the same simulation answers "what does this week's
       game actually do to my season": condition the final outcome on who won
       each of this week's games. No extra runs — the sims are already there. */
    if (nG) {
      const made = new Uint8Array(n); field.forEach(i => made[i] = 1);
      for (let gi = 0; gi < nG; gi++) {
        const r = levWon[gi]; if (r < 0) continue;      // a tie tells us nothing either way
        const ia = idOf[levGames[gi].a], ib = idOf[levGames[gi].b];
        const L = acc.lev[gi];
        if (r === 0) { L.nA++; L.poAw += made[ia]; L.poBl += made[ib]; L.tiAw += (champ === ia ? 1 : 0); L.tiBl += (champ === ib ? 1 : 0); }
        else { L.nB++; L.poBw += made[ib]; L.poAl += made[ia]; L.tiBw += (champ === ib ? 1 : 0); L.tiAl += (champ === ia ? 1 : 0); }
      }
    }
  }

  const qOf = (arr, q) => { const a = arr.slice().sort((x, y) => x - y); return a.length ? a[clamp(Math.floor(q * (a.length - 1)), 0, a.length - 1)] : 0; };
  const res = teams.map((t, i) => {
    const allPlayPct = acc.allPlayGames ? acc.allPlay[i] / nSims / acc.allPlayGames : null;
    const simW = acc.simWins[i] / nSims;
    return {
      rosterId: t.rosterId,
      wins: acc.wins[i] / nSims, pts: acc.pts[i] / nSims,
      playoff: acc.playoff[i] / nSims, bye: acc.bye[i] / nSims, semi: acc.semi[i] / nSims,
      final: acc.final[i] / nSims, title: acc.title[i] / nSims,
      seed: acc.seed[i] / nSims, best: acc.best[i], worst: acc.worst[i],
      winDist: Array.from(acc.winDist[i]).map(v => v / nSims),
      weekWin: acc.weekWin[i] / nSims, weekPts: acc.weekPts[i] / nSims, weekTop: acc.weekTop[i] / nSims,
      weekScores: acc.weekScores[i],
      // --- expanded ---
      seedDist: Array.from(acc.seedDist[i]).map(v => v / nSims),
      allPlayPct: allPlayPct,
      simWins: simW,
      // wins the schedule hands you (or takes) beyond what your scoring earns
      luck: allPlayPct === null ? null : simW - allPlayPct * simWeeks,
      sos: acc.oppGames[i] ? acc.oppPts[i] / acc.oppGames[i] : null,
      ptsP10: qOf(acc.ptsRuns[i], 0.10), ptsP50: qOf(acc.ptsRuns[i], 0.50), ptsP90: qOf(acc.ptsRuns[i], 0.90),
      fieldAt: Array.from(acc.fieldAt[i]).map(v => v / nSims),
      aliveAt: Array.from(acc.aliveAt[i]).map(v => v / nSims),
      poWins: acc.poWins[i] / nSims,
      draftSlot: acc.draftSum[i] / nSims,
      draftDist: Array.from(acc.draftDist[i]).map(v => v / nSims),
      knockedBy: teams.map((o, j) => ({ rosterId: o.rosterId, p: acc.knockedBy[i * n + j] / nSims })).filter(x => x.p > 0).sort((a, b) => b.p - a.p),
      finalVs: teams.map((o, j) => ({ rosterId: o.rosterId, p: acc.finalVs[i * n + j] / nSims })).filter(x => x.p > 0).sort((a, b) => b.p - a.p)
    };
  });
  const byRoster = {}; res.forEach(r => byRoster[r.rosterId] = r);
  /* A branch of a leverage split is only worth reading if enough seasons went
     that way. A game that is already lost — or a mismatch a fair sampler almost
     never flips — leaves one branch with a handful of runs or none at all, and
     a rate off three runs is not a number, it is an accident. Those branches are
     reported as unmeasured rather than as 0%, and the game carries no swing, so
     it cannot be ranked above a game that is genuinely in the balance. */
  const LEV_MIN = Math.max(30, Math.round(nSims * 0.01));
  const leverage = levGames.map((g, gi) => {
    const L = acc.lev[gi], A = S.teamById[g.a], B = S.teamById[g.b];
    const rate = (num, den) => den >= LEV_MIN ? num / den : null;
    const mk = (T, poW, poL, tiW, tiL, nw, nl) => ({
      team: T,
      poWin: rate(poW, nw), poLose: rate(poL, nl), tiWin: rate(tiW, nw), tiLose: rate(tiL, nl),
      swing: rate(poW, nw) === null || rate(poL, nl) === null ? 0 : rate(poW, nw) - rate(poL, nl),
      titleSwing: rate(tiW, nw) === null || rate(tiL, nl) === null ? 0 : rate(tiW, nw) - rate(tiL, nl)
    });
    const a = mk(A, L.poAw, L.poAl, L.tiAw, L.tiAl, L.nA, L.nB);
    const b = mk(B, L.poBw, L.poBl, L.tiBw, L.tiBl, L.nB, L.nA);
    return {
      week: g.week, a, b, runs: L.nA + L.nB, nA: L.nA, nB: L.nB,
      // one side of the split is too rare to read, so neither side has a swing
      thin: L.nA < LEV_MIN || L.nB < LEV_MIN, minRuns: LEV_MIN,
      swing: Math.max(Math.abs(a.swing), Math.abs(b.swing))
    };
  }).sort((x, y) => y.swing - x.swing || x.week - y.week);
  return {
    n: nSims, list: res, by: byRoster, onlyWeek, playoffTeams,
    fromWeek, simWeeks, leverage, levWeek
  };
}

/* ================= value history (stock mode) ================= */
function recordSnapshot() {
  if (typeof HYP !== 'undefined' && HYP.on) return;   // never record a what-if as history
  // dynasty and redraft prices are different currencies; mixing them into one
  // series would draw a cliff on the day someone flipped the setting
  const key = 'snap:' + S.leagueId + (isDynasty() ? '' : ':rd');
  let snaps = LS.get(key, []);
  const today = new Date().toISOString().slice(0, 10);
  const rec = { d: today, t: Date.now(), p: {}, tm: {} };
  for (const id in S.index) { const p = S.index[id]; if (p.dv > 250) rec.p[id] = p.dv; }
  S.teams.forEach(t => rec.tm[t.rosterId] = Math.round(t.totalValue));
  snaps = snaps.filter(s => s.d !== today);
  snaps.push(rec);
  snaps.sort((a, b) => a.d < b.d ? -1 : 1);
  if (snaps.length > 120) snaps = snaps.slice(-120);
  // localStorage is a hard ~5MB; if the write is refused, halve the history and retry.
  for (let attempt = 0; attempt < 4; attempt++) {
    try { localStorage.setItem('dcc:' + key, JSON.stringify(snaps)); break; }
    catch (e) { snaps = snaps.filter((_, i) => i % 2 === 1 || i === snaps.length - 1); if (!snaps.length) break; }
  }
  S.snapshots = snaps;
}
/* Seeds a 30-day path from FantasyCalc's published 30-day trend so charts have
   context on day one; observed snapshots override the seeded points. */
function playerSeries(id, days) {
  days = days || 90;
  const p = S.index[id]; if (!p) return [];
  const obs = S.snapshots.filter(s => s.p[id] !== undefined).map(s => ({ d: s.d, v: s.p[id], real: true }));
  const out = [];
  const today = new Date();
  const trend = p.trend30 || 0;
  const vol = Math.max(0.004, Math.abs(p.sd_pct || 0) / 100 || 0.012);
  seedRng(hashStr(id) >>> 0);
  const start = p.dv - trend;
  for (let i = days; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 864e5).toISOString().slice(0, 10);
    const k = clamp((days - i) / days, 0, 1);
    const ramp = i <= 30 ? (30 - i) / 30 : 0;
    const base = i <= 30 ? start + trend * ramp : start - trend * 0.55 * ((i - 30) / Math.max(1, days - 30));
    const jitter = base * vol * (Math.sin(i * 1.7 + hashStr(id) % 7) * 0.5 + gauss() * 0.35);
    out.push({ d, v: Math.max(1, Math.round(base + jitter)), real: false });
  }
  const byD = {}; out.forEach(o => byD[o.d] = o);
  obs.forEach(o => { byD[o.d] = o; });
  const merged = Object.values(byD).sort((a, b) => a.d < b.d ? -1 : 1);
  if (merged.length) merged[merged.length - 1] = { d: merged[merged.length - 1].d, v: p.dv, real: true };
  return merged;
}
function teamSeries(rosterId, days) {
  const t = S.teamById[rosterId]; if (!t) return [];
  const ids = t.players.map(p => p.id).filter(id => S.index[id] && S.index[id].dv > 250);
  const per = ids.map(id => playerSeries(id, days));
  if (!per.length) return [];
  const len = per[0].length;
  const obs = {}; S.snapshots.forEach(s => { if (s.tm && s.tm[rosterId] !== undefined) obs[s.d] = s.tm[rosterId]; });
  const out = [];
  for (let i = 0; i < len; i++) {
    const d = per[0][i].d;
    let v = 0; per.forEach(s => { if (s[i]) v += s[i].v; });
    v += t.pickCapital;
    out.push({ d, v: obs[d] !== undefined ? obs[d] : Math.round(v), real: obs[d] !== undefined });
  }
  if (out.length) out[out.length - 1] = { d: out[out.length - 1].d, v: Math.round(t.totalValue), real: true };
  return out;
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h); }

/* ================= single-season replay =================
   Plays exactly one season through, keeping the whole trace: every matchup,
   who won, who carried each team, the final table, and the bracket. */
function roundName(nTeams) {
  return nTeams <= 2 ? 'Championship' : nTeams <= 4 ? 'Semifinals' : nTeams <= 8 ? 'Quarterfinals' : 'Round of ' + nTeams;
}
function simulateOneSeason(opts) {
  opts = opts || {};
  const teams = S.teams, n = teams.length;
  const idOf = {}; teams.forEach((t, i) => idOf[t.rosterId] = i);
  const sched = schedule();
  const settings = S.league.settings || {};
  const playoffTeams = Math.min(settings.playoff_teams || 6, n);
  const divOf = teams.map(t => t.division || null);
  const nDiv = settings.divisions && divOf.some(d => d) ? settings.divisions : 0;
  const seed = opts.seed !== undefined ? opts.seed : ((Math.random() * 4294967296) >>> 0);
  seedRng(seed);

  const weekList = []; for (let w = 1; w <= S.regEnd + 4; w++) weekList.push(w);
  const startersOf = {};
  weekList.forEach(wk => {
    startersOf[wk] = teams.map(t => optimalLineup(withReturners(activePlayers(t), t, wk), (p) => pw(p, wk))
      .map(s => {
        const pos = s.player ? s.player.pos : (SLOT_ELIG[s.slot] || [s.slot])[0];
        let m = s.player ? pw(s.player, wk) : 0, streamed = !s.player;
        if (m <= 0.05) { m = STREAM[pos] !== undefined ? STREAM[pos] : 0; streamed = true; }
        return {
          m, sd: volFromMean(pos, m), id: s.player ? s.player.id : 'stream-' + pos, pos,
          name: streamed ? 'Streamed ' + pos : s.player.name
        };
      })
      .filter(x => x.m > 0.05));
  });

  const scoreDetail = (i, wk) => {
    /* A week already under way is half fact: the finished games are scored as
       they happened and only the open slots are played out. */
    if (wk === S.liveWeek) {
      const lr = liveRoster(teams[i], wk);
      const lines = lr.rows.filter(r => r.settled).map(r => ({ id: r.p.id, name: r.p.name, pos: r.p.pos, pts: Math.round(r.used * 10) / 10, settled: true }));
      const open = lr.open.map(r => ({ id: r.p.id, name: r.p.name, pos: r.p.pos, m: r.used, sd: volFromMean(r.p.pos, r.used) }));
      const mult = Math.max(0.55, 1 + 0.05 * gauss());
      open.forEach(o => lines.push({ id: o.id, name: o.name, pos: o.pos, pts: Math.round((rnd() < BUST_RATE ? 0 : drawScore(o.m, o.sd)) * mult * 10) / 10 }));
      lines.sort((a, b) => b.pts - a.pts);
      return { total: Math.round(sum(lines.map(l => l.pts)) * 10) / 10, top: lines[0] || null, lines, live: true };
    }
    const byWeek = startersOf[wk] || startersOf[S.regEnd];
    const st = byWeek[i] || [], lines = [];
    for (const p of st) lines.push({ id: p.id, name: p.name, pos: p.pos, pts: rnd() < BUST_RATE ? 0 : drawScore(p.m, p.sd) });
    const mult = Math.max(0.55, 1 + 0.05 * gauss());
    lines.forEach(l => l.pts = Math.round(l.pts * mult * 10) / 10);
    lines.sort((a, b) => b.pts - a.pts);
    return { total: Math.round(sum(lines.map(l => l.pts)) * 10) / 10, top: lines[0] || null, lines };
  };

  // running table, seeded with whatever has actually happened already
  const rec = teams.map(t => ({
    i: idOf[t.rosterId], rosterId: t.rosterId, team: t,
    w: t.wins, l: t.losses, tie: t.ties, pf: t.fpts, pa: t.fptsAgainst,
    form: [], best: 0, bestWeek: null
  }));
  const recOf = {}; rec.forEach(r => recOf[r.rosterId] = r);

  const weeks = [];
  for (let wk = 1; wk <= S.regEnd; wk++) {
    const isActual = wk <= S.lastWeek;
    const rows = {};
    if (isActual) {
      (S.matchups[wk] || []).forEach(m => rows[m.roster_id] = { total: m.points || 0, top: null, lines: [], actual: true });
    } else {
      teams.forEach((t, i) => { rows[t.rosterId] = Object.assign(scoreDetail(i, wk), { actual: false }); });
    }
    const games = (sched[wk - 1] || []).map(([a, b]) => {
      const ra = rows[a] || { total: 0, top: null }, rb = rows[b] || { total: 0, top: null };
      const win = ra.total === rb.total ? null : (ra.total > rb.total ? a : b);
      if (!isActual) {
        const A = recOf[a], B = recOf[b];
        if (A && B) {
          A.pf += ra.total; A.pa += rb.total; B.pf += rb.total; B.pa += ra.total;
          if (win === a) { A.w++; B.l++; } else if (win === b) { B.w++; A.l++; } else { A.tie++; B.tie++; }
          A.form.push(win === a ? 'W' : win === null ? 'T' : 'L');
          B.form.push(win === b ? 'W' : win === null ? 'T' : 'L');
        }
      } else {
        const A = recOf[a], B = recOf[b];
        if (A && B) { A.form.push(win === a ? 'W' : win === null ? 'T' : 'L'); B.form.push(win === b ? 'W' : win === null ? 'T' : 'L'); }
      }
      [[a, ra], [b, rb]].forEach(([rid, r]) => { const R = recOf[rid]; if (R && r.total > R.best) { R.best = r.total; R.bestWeek = wk; } });
      return { a, b, aPts: ra.total, bPts: rb.total, win, aTop: ra.top, bTop: rb.top, margin: Math.abs(ra.total - rb.total) };
    });
    weeks.push({ week: wk, actual: isActual, games });
  }

  // seed the field
  let order = rec.slice().sort((x, y) => ((y.w + 0.5 * y.tie) - (x.w + 0.5 * x.tie)) || (y.pf - x.pf));
  if (nDiv > 1) {
    const seen = new Set(), winners = [];
    for (const r of order) { const d = r.team.division; if (d && !seen.has(d)) { seen.add(d); winners.push(r); } }
    const ws = new Set(winners);
    order = winners.concat(order.filter(r => !ws.has(r)));
  }
  order.forEach((r, i) => { r.seed = i + 1; r.divWinner = nDiv > 1 && i < nDiv; });
  const standings = order;
  const field = order.slice(0, playoffTeams);
  const seedOf = {}; field.forEach((r, i) => seedOf[r.rosterId] = i + 1);

  const playRound = (list, wk) => {
    const games = [], winners = [];
    const arr = list.slice();
    for (let i = 0; i < arr.length / 2; i++) {
      const A = arr[i], B = arr[arr.length - 1 - i];
      const ra = scoreDetail(A.i, wk), rb = scoreDetail(B.i, wk);
      const win = ra.total >= rb.total ? A : B;
      games.push({ a: A, b: B, aPts: ra.total, bPts: rb.total, win, aTop: ra.top, bTop: rb.top, margin: Math.abs(ra.total - rb.total) });
      winners.push(win);
    }
    return { games, winners };
  };
  const bracket = [];
  let alive = field.slice();
  let wk = S.regEnd + 1;
  const byes = (1 << Math.ceil(Math.log2(Math.max(2, playoffTeams)))) - playoffTeams;
  if (byes > 0 && alive.length > 2) {
    const seeded = alive.slice(0, byes), rest = alive.slice(byes);
    const r = playRound(rest, wk);
    bracket.push({ name: roundName(alive.length), week: wk, games: r.games, byes: seeded });
    alive = seeded.concat(r.winners).sort((x, y) => seedOf[x.rosterId] - seedOf[y.rosterId]);
    wk++;
  }
  let guard = 0;
  while (alive.length > 1 && guard++ < 6) {
    const r = playRound(alive, wk);
    bracket.push({ name: roundName(alive.length), week: wk, games: r.games });
    alive = r.winners.sort((x, y) => seedOf[x.rosterId] - seedOf[y.rosterId]);
    wk++;
  }
  const champion = alive[0] || null;
  const lastRound = bracket[bracket.length - 1];
  const runnerUp = lastRound && lastRound.games[0]
    ? (lastRound.games[0].win === champion ? (lastRound.games[0].a === champion ? lastRound.games[0].b : lastRound.games[0].a) : null) : null;

  // storylines
  const allGames = weeks.reduce((acc, w) => acc.concat(w.games.map(g => Object.assign({ week: w.week }, g))), []);
  const simGames = allGames.filter(g => !weeks[g.week - 1].actual);
  const byScore = [];
  weeks.forEach(w => w.games.forEach(g => { byScore.push({ week: w.week, rid: g.a, pts: g.aPts, top: g.aTop }); byScore.push({ week: w.week, rid: g.b, pts: g.bPts, top: g.bTop }); }));
  byScore.sort((a, b) => b.pts - a.pts);
  const blowout = allGames.slice().sort((a, b) => b.margin - a.margin)[0];
  const nailBiter = allGames.filter(g => g.margin > 0).sort((a, b) => a.margin - b.margin)[0];
  const streakOf = (r) => {
    let best = 0, cur = 0;
    r.form.forEach(f => { if (f === 'W') { cur++; best = Math.max(best, cur); } else cur = 0; });
    return best;
  };
  rec.forEach(r => r.streak = streakOf(r));
  const awards = {
    highScore: byScore[0] || null,
    blowout, nailBiter,
    mostPF: standings.slice().sort((a, b) => b.pf - a.pf)[0],
    bestRecord: standings[0],
    longestStreak: rec.slice().sort((a, b) => b.streak - a.streak)[0],
    unluckiest: standings.slice().sort((a, b) => (a.w - a.pfRank) - (b.w - b.pfRank))[0]
  };
  const pfOrder = standings.slice().sort((a, b) => b.pf - a.pf);
  pfOrder.forEach((r, i) => r.pfRank = i + 1);
  awards.unluckiest = standings.slice().sort((a, b) => (a.seed - a.pfRank) - (b.seed - b.pfRank)).reverse()[0];

  return { seed, weeks, standings, field, bracket, champion, runnerUp, awards, playoffTeams, nDiv, simulatedFrom: S.lastWeek + 1 };
}

/* actual weekly scoring for one player, straight out of Sleeper's matchup rows */
/** Every week this player has a real number for. That includes the week being
 *  played: once his own NFL game is over his score is a result like any other,
 *  and while it is on the score so far is real too — just not final. Weeks where
 *  his game has not kicked off are left out, so the caller's projections fill them. */
function playerGameLog(id, opts) {
  const out = [];
  const useStats = !!(opts && opts.stats);
  const entry = (w, state) => {
    const ms = S.matchups[w] || [];
    const row = ms.find(m => (m.players || []).map(String).includes(String(id)));
    if (!row) {
      // on nobody's roster that week: the matchups have no number for him, but the raw stats might
      const sp = useStats && state === 'final' && WSTATS.pts[w] ? WSTATS.pts[w][String(id)] : undefined;
      return sp !== undefined ? { week: w, pts: sp, started: false, rostered: false, fromStats: true, state } : { week: w, pts: null, started: false, rostered: false, state };
    }
    const pp = row.players_points || {};
    const pts = pp[id] === undefined ? null : pp[id];
    return { week: w, pts, started: (row.starters || []).map(String).includes(String(id)), rostered: true, rosterId: row.roster_id, state };
  };
  for (let w = 1; w <= S.lastWeek; w++) out.push(entry(w, 'final'));
  if (S.liveWeek) {
    const p = S.index[String(id)];
    const st = p ? livePlayerState(p, S.liveWeek) : 'upcoming';
    if (st === 'done' || st === 'live') {
      const e = entry(S.liveWeek, st === 'done' ? 'final' : 'live');
      if (p) { e.proj = pw(p, S.liveWeek); const sg = weekScoreGame(p.team, S.liveWeek); e.quarter = sg ? sg.quarter : null; }
      out.push(e);
    }
  }
  return out;
}
function ownerOfPlayer(id) {
  return S.teams.find(t => t.players.some(p => p.id === String(id))) || null;
}
