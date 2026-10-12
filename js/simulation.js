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
/** Read the league into a plain-data job (no functions, no page objects) that the kernel can play anywhere. */
function prepareSim(nSims, opts) {
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

  const seed = opts.seed !== undefined ? opts.seed : ((Math.random() * 4294967296) >>> 0);
  const job = {
    nSims, seed, n, idOf, sched, fromWeek, onlyWeek, regEnd: S.regEnd, playoffTeams, divOf, nDiv,
    baseW, baseP, starters, fallbackWk, levGames, nG
  };
  return { job, teams, levWeek };
}
/** Turn the kernel's tallies into the result every page reads. */
function finishSim(prep, acc) {
  const { job, teams, levWeek } = prep;
  const { nSims, n, idOf, onlyWeek, fromWeek, playoffTeams, levGames, nG } = job;
  const simWeeks = Math.max(0, S.regEnd - fromWeek + 1);
  // sorted once per team: the three quantiles below all read the same ordering
  const qOf = (a, q) => a.length ? a[clamp(Math.floor(q * (a.length - 1)), 0, a.length - 1)] : 0;
  const res = teams.map((t, i) => {
    const ptsSorted = acc.ptsRuns[i].slice().sort((x, y) => x - y);
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
      ptsP10: qOf(ptsSorted, 0.10), ptsP50: qOf(ptsSorted, 0.50), ptsP90: qOf(ptsSorted, 0.90),
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

function simulate(nSims, opts) {
  const prep = prepareSim(nSims, opts);
  const run = createSimRun(prep.job);
  run.step(prep.job.nSims);
  return finishSim(prep, run.acc);
}
/* ================= running it off the page's thread =================
   Two thousand seasons hold the page for a quarter of a second on a laptop and several
   times that on a phone. The loop is pure arithmetic on a plain-data job, so it runs in a
   worker; where a worker is not available (a page opened straight from disk, say) the same
   kernel is played in short slices instead, which keeps the page responsive and gives the
   same numbers. */
function simRunSliced(job, onProgress) {
  return new Promise((resolve, reject) => {
    let run;
    try { run = createSimRun(job); } catch (e) { return reject(e); }
    const tick = () => {
      try {
        const t0 = performance.now();
        while (!run.finished() && performance.now() - t0 < 10) run.step(5);
      } catch (e) { return reject(e); }
      if (onProgress) onProgress(run.progress());
      if (run.finished()) resolve(run.acc); else setTimeout(tick, 0);
    };
    tick();
  });
}
const SimPool = {
  workers: [], queue: [], seq: 0, broken: false,
  max: Math.max(1, Math.min(2, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency || 2) - 1)),
  run(job, onProgress) {
    return new Promise((resolve, reject) => { this.queue.push({ job, onProgress, resolve, reject }); this.pump(); });
  },
  pump() {
    while (this.queue.length) {
      if (this.broken) { const t = this.queue.shift(); simRunSliced(t.job, t.onProgress).then(t.resolve, t.reject); continue; }
      let w = this.workers.find(x => !x.task);
      if (!w && this.workers.length < this.max) w = this.spawn();
      if (!w) { if (this.broken) continue; return; }     // every worker is busy; one will call pump() again
      const t = this.queue.shift();
      w.task = t; w.id = ++this.seq;
      w.postMessage({ id: w.id, job: t.job });
    }
  },
  spawn() {
    let w;
    try { w = new Worker('js/sim-worker.js'); } catch (e) { this.broken = true; return null; }
    w.task = null;
    w.onmessage = (ev) => {
      const m = ev.data, t = w.task;
      if (!t || m.id !== w.id) return;
      if (m.p !== undefined) { if (t.onProgress) t.onProgress(m.p); return; }
      w.task = null;
      if (m.error) t.reject(new Error(m.error)); else t.resolve(m.acc);
      this.pump();
    };
    // the worker could not start (blocked, missing, or crashed): finish what it was given on the page instead
    w.onerror = (ev) => {
      if (ev && ev.preventDefault) ev.preventDefault();
      this.broken = true;
      const t = w.task; w.task = null;
      this.workers = this.workers.filter(x => x !== w);
      try { w.terminate(); } catch (e) { }
      if (t) simRunSliced(t.job, t.onProgress).then(t.resolve, t.reject);
      this.pump();
    };
    this.workers.push(w);
    return w;
  }
};
/** Same as simulate(), but the page stays live while it runs. Resolves to null if the league changed meanwhile. */
function simulateAsync(nSims, opts, onProgress) {
  const prep = prepareSim(nSims, opts), teams = S.teams;
  return SimPool.run(prep.job, onProgress).then(acc => S.teams !== teams ? null : finishSim(prep, acc));
}
/** Run the league-wide season simulation in the background and keep it as the season's odds.
 *  Redraws only if you are still on the page that asked, so it never pulls a typing cursor away. */
function runSeasonSim(n, then) {
  if (S._simRun) return S._simRun;
  const view = S.view;
  const done = (r) => {
    S._simRun = null;
    if (r) { S.sim = r; SimUI.res = r; if (then) then(r); }
    if (S.view === view) render();
  };
  // if the background run fails outright, play it on the page once rather than leave the odds empty
  S._simRun = simulateAsync(n).then(done, e => { console.error(e); let r = null; try { r = simulate(n); } catch (e2) { console.error(e2); } done(r); });
  return S._simRun;
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
