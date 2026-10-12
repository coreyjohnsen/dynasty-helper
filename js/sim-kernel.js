"use strict";
/* ==================================================================
   Simulation kernel — the random numbers and the season loop, and nothing else.
   It reads no page state and touches no DOM, so the same file runs on the page
   (as a fallback) and inside the simulation worker. prepareSim() in
   simulation.js turns the league into a plain-data job; createSimRun() plays it.
   ================================================================== */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const BUST_RATE = 0.012;               // starter unexpectedly inactive / knocked out early
/* fast RNG + gaussian */
let _rs = 88675123 >>> 0;
function rnd() { _rs ^= _rs << 13; _rs >>>= 0; _rs ^= _rs >> 17; _rs ^= _rs << 5; _rs >>>= 0; return _rs / 4294967296; }
let _spare = null;
/* Reseeding must also discard the cached Box-Muller spare, otherwise a run can
   open with a deviate left over from whatever ran before it and two same-seed
   runs diverge — which would quietly break every paired before/after comparison. */
function seedRng(s) { _rs = (s >>> 0) || 88675123; _spare = null; }
function gauss() {
  if (_spare !== null) { const v = _spare; _spare = null; return v; }
  let u, v, s;
  do { u = rnd() * 2 - 1; v = rnd() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
  const m = Math.sqrt(-2 * Math.log(s) / s); _spare = v * m; return u * m;
}

/** The generator's whole state, so a run that is played in slices can put it back each time. */
function rngGet() { return [_rs, _spare]; }
function rngSet(s) { _rs = s[0]; _spare = s[1]; }

/* ================= gamma sampling =================
   Weekly fantasy scores are right-skewed and never negative. A truncated normal
   gets both wrong: it piles mass at exactly zero and makes the low tail far too
   fat, which is where absurd 20-point team weeks came from. Gamma has the right
   shape — bounded below, long upper tail — for the same mean and spread. */
function gammaShape(k) {               // Marsaglia–Tsang, unit scale
  if (k < 1) { const u = Math.max(1e-12, rnd()); return gammaShape(1 + k) * Math.pow(u, 1 / k); }
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (let guard = 0; guard < 200; guard++) {
    let x, v;
    do { x = gauss(); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = rnd();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(Math.max(1e-12, u)) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
  return d;
}
/** Draw one weekly score for a mean and standard deviation. */
function drawScore(mu, sd) {
  if (!(mu > 0.05)) return 0;
  const s = Math.max(0.35, sd);
  const k = (mu / s) * (mu / s);
  return gammaShape(k) * (s * s / mu);
}

/* One simulation, playable in slices. step(k) plays the next k seasons; the generator is put
   back before and saved after every slice, so whatever else draws random numbers between
   slices (a redraw, say) cannot change the result. */
function createSimRun(job) {
  const { nSims, n, idOf, sched, fromWeek, onlyWeek, regEnd, playoffTeams, divOf, nDiv, baseW, baseP, starters, fallbackWk, levGames, nG } = job;
  const acc = {
    wins: new Float64Array(n), pts: new Float64Array(n), playoff: new Float64Array(n),
    bye: new Float64Array(n), semi: new Float64Array(n), final: new Float64Array(n),
    title: new Float64Array(n), seed: new Float64Array(n), best: new Float64Array(n).fill(99), worst: new Float64Array(n),
    winDist: Array.from({ length: n }, () => new Float64Array(regEnd + 1)),
    weekWin: new Float64Array(n), weekPts: new Float64Array(n), weekTop: new Float64Array(n),
    weekScores: Array.from({ length: n }, () => []),
    // --- expanded instrumentation ---
    seedDist: Array.from({ length: n }, () => new Float64Array(n + 1)),
    allPlay: new Float64Array(n),          // all-play wins over the simulated weeks
    allPlayGames: 0,                       // (n-1) x weeks simulated, same for everyone
    simWins: new Float64Array(n),          // wins earned in the simulated weeks only
    oppPts: new Float64Array(n), oppGames: new Float64Array(n),   // rest-of-season SOS
    ptsRuns: Array.from({ length: n }, () => []),                 // season PF per run
    fieldAt: Array.from({ length: n }, () => new Float64Array(regEnd + 2)),  // in the field after week w
    aliveAt: Array.from({ length: n }, () => new Float64Array(regEnd + 2)),  // can still reach the cut
    knockedBy: new Float64Array(n * n),    // [loser*n + winner] in the bracket
    draftSum: new Float64Array(n),         // next draft: summed slot across runs
    draftDist: Array.from({ length: n }, () => new Float64Array(n + 1)),
    finalVs: new Float64Array(n * n),      // met in the title game
    poWins: new Float64Array(n),           // playoff games won
    // leverage: for each game in the next week, each side's odds when they win vs lose
    lev: levGames.map(() => ({ nA: 0, nB: 0, poAw: 0, poAl: 0, poBw: 0, poBl: 0, tiAw: 0, tiAl: 0, tiBw: 0, tiBl: 0 }))
  };
  seedRng(job.seed);
  let rngState = rngGet();

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
  const simWeeks = Math.max(0, regEnd - fromWeek + 1);
  acc.allPlayGames = simWeeks * Math.max(1, n - 1);
  const levIdx = {};   // week|a|b -> index into acc.lev
  levGames.forEach((g, gi) => { levIdx[g.week + '|' + g.a + '|' + g.b] = gi; });

  let done = 0;
  const step = (count) => {
    rngSet(rngState);
    const end = Math.min(nSims, done + count);
    for (let sim = done; sim < end; sim++) {
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
      for (let wk = fromWeek; wk <= regEnd; wk++) {
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
        const left = regEnd - wk;
        for (let i = 0; i < n; i++) if (w[i] + left >= cut) acc.aliveAt[i][wk]++;
      }
      for (let i = 0; i < n; i++) { acc.simWins[i] += w[i] - baseW[i]; acc.ptsRuns[i].push(p[i]); }
      const order = standingsOrder(w, p);
      for (let s = 0; s < n; s++) {
        const i = order[s];
        acc.wins[i] += w[i]; acc.pts[i] += p[i]; acc.seed[i] += s + 1;
        if (s + 1 < acc.best[i]) acc.best[i] = s + 1;
        if (s + 1 > acc.worst[i]) acc.worst[i] = s + 1;
        const wi = clamp(Math.round(w[i]), 0, regEnd); acc.winDist[i][wi] += 1;
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
      let pwk = regEnd + 1;
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
    done = end;
    rngState = rngGet();
  };
  return { acc, step, finished: () => done >= nSims, progress: () => nSims ? done / nSims : 1 };
}
