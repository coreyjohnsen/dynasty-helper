"use strict";
/* ================= Start / Sit odds, from the simulation engine =================
   Two questions, both answered by playing the week thousands of times with the same
   scoring model the season simulator uses (gamma-distributed scores, a small bust
   chance, a team-wide swing):

     1. Slot odds.   How often does each candidate for a slot score the most?
     2. Win odds.    How often does your team win the week against its real
                     opponent with each choice, everything else held the same?

   Every candidate for a slot is drawn in the same run, and a swap is scored against
   the recommended lineup using the same draws, so the difference between two choices
   is measured cleanly instead of drowning in sampling noise. The generator is seeded
   from the inputs, so the same screen always shows the same numbers. */
const SS_SLOT_RUNS = 4000;
const SS_WEEK_RUNS = 6000;
const _ssMemo = new Map();

function ssHash(str) {
  let x = 2166136261;
  for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); }
  return x >>> 0;
}
function ssMemo(key, fn) {
  if (_ssMemo.has(key)) return _ssMemo.get(key);
  const v = fn();
  if (_ssMemo.size > 400) _ssMemo.clear();
  _ssMemo.set(key, v);
  return v;
}

/** One player's score distribution for a week, from the blend of sources: a mean, a spread,
 *  and the chance he plays at all. A source that has no number for him is simply left out.
 *  The spread is the position's usual one, widened when the sources disagree with each
 *  other, because that disagreement is real uncertainty about where his mean is. */
function ssDist(p, wk, all) {
  all = all || psrcAll(p, wk);
  const zero = { zero: true, m: 0, sd: 0, a: 0, spread: 0 };
  if (!p || onBye(p, wk) || ruledOut(p, wk)) return zero;
  const a = p.inj ? availability(p, wk) : 1;
  if (!(a > 0)) return zero;
  const vals = [];
  PSRC_LIST.forEach(x => { const v = all.per[x.id]; if (v !== null && v !== undefined) vals.push({ v: v / a, w: x.w }); });
  let m, between = 0;
  if (vals.length) {
    const W = sum(vals.map(x => x.w));
    m = sum(vals.map(x => x.v * x.w)) / W;
    between = sum(vals.map(x => x.w * (m - x.v) * (m - x.v))) / W;
  } else m = pw(p, wk) / a;
  if (!(m > 0.05)) return zero;
  const base = volFromMean(p.pos, m);
  // disagreement can at most double the variance, so one odd source cannot blow the range open
  const sd = Math.sqrt(base * base + Math.min(between, base * base));
  return { zero: false, m, sd, a, spread: Math.sqrt(between), base };
}
function ssDraw(d) {
  if (d.zero) return 0;
  if (d.a < 1 && rnd() >= d.a) return 0;
  if (rnd() < BUST_RATE) return 0;
  return drawScore(d.m, d.sd);
}
const ssKeyOf = d => d.zero ? 'z' : d.m.toFixed(2) + '/' + d.sd.toFixed(2) + '/' + d.a.toFixed(3);

/** Slot odds for a list of candidates. Returns, per candidate, the chance he scores the most of the
 *  group and his 10th, 50th and 90th percentile scores. */
function ssSlotOdds(cands, dists, salt) {
  const key = 'slot|' + salt + '|' + dists.map(ssKeyOf).join(',');
  return ssMemo(key, () => {
    const n = SS_SLOT_RUNS, k = dists.length;
    seedRng(ssHash(key));
    const wins = new Float64Array(k), mean_ = new Float64Array(k), samples = dists.map(() => new Float32Array(n));
    for (let r = 0; r < n; r++) {
      let top = -1, tied = 0;
      const sc = new Array(k);
      for (let j = 0; j < k; j++) {
        const s = ssDraw(dists[j]); sc[j] = s; samples[j][r] = s; mean_[j] += s;
        if (s > top) { top = s; tied = 1; } else if (s === top) tied++;
      }
      for (let j = 0; j < k; j++) if (sc[j] === top) wins[j] += 1 / tied;
    }
    return {
      p: Array.from(wins, w => w / n),
      mean: Array.from(mean_, v => v / n),
      q: samples.map(arr => {
        const s = Array.from(arr).sort((a, b) => a - b), at = f => s[clamp(Math.floor(f * (n - 1)), 0, n - 1)];
        return { lo: at(0.1), mid: at(0.5), hi: at(0.9) };
      })
    };
  });
}

/** Round shares to whole percents that add up to exactly 100 (largest remainder). */
function ssWholePercents(shares) {
  const raw = shares.map(p => p * 100), floor = raw.map(Math.floor);
  let left = 100 - sum(floor);
  raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { floor[i]++; left--; } });
  return floor;
}

/** Win odds for the week against the real opponent, for the lineup as recommended and for every
 *  single swap of one slot's player for one of its alternatives. `plan` is the list of slots from
 *  startSitPlan, each with its candidates (the recommended player first) and their distributions.
 *  Returns null when there is nothing to play for: a finished week, or no opponent on the schedule. */
function ssWeekOdds(T, wk, plan) {
  const live = wk === S.liveWeek;
  if (!live && wk <= S.lastWeek) return null;
  const game = (schedule()[wk - 1] || []).find(g => g.indexOf(T.rosterId) >= 0);
  if (!game) return null;
  const opp = S.teamById[game[0] === T.rosterId ? game[1] : game[0]];
  if (!opp) return null;
  const lo = liveRoster(opp, wk);

  // my side: one distribution per player, a fixed score for what is already banked
  const dist = new Map();       // player id -> distribution (drawn once a run, shared by every scenario)
  let banked = 0;
  const base = [];              // ids that make up the recommended lineup's open draws
  const extra = [];             // in-progress players: only the rest of their game is still open
  plan.forEach(sl => {
    if (!sl.rec) return;
    if (sl.locked) {
      const v = liveValue(sl.rec, wk);
      banked += v.banked;
      if (v.open > 0.05) extra.push({ m: v.open, sd: volFromMean(sl.rec.pos, v.open), a: 1, zero: false });
      return;
    }
    base.push(sl.rec.id);
    sl.cands.forEach((p, j) => { if (!dist.has(p.id)) dist.set(p.id, sl.conf ? sl.conf.dists[j] : ssDist(p, wk)); });
  });
  // every single swap: slot index, candidate index, and the two ids involved
  const swaps = [];
  plan.forEach((sl, i) => {
    if (sl.locked || !sl.rec) return;
    for (let j = 1; j < sl.cands.length; j++) swaps.push({ i, j, out: sl.rec.id, inn: sl.cands[j].id });
  });
  const opps = lo.open.map(r => ({ m: r.used, sd: volFromMean(r.p.pos, r.used), a: 1, zero: false }));

  const key = ['week', T.rosterId, opp.rosterId, wk, banked.toFixed(1), lo.banked.toFixed(1),
    base.map(id => id + ':' + ssKeyOf(dist.get(id))).join(','),
    swaps.map(s => s.inn + ':' + ssKeyOf(dist.get(s.inn))).join(','),
    extra.map(ssKeyOf).join(','), opps.map(ssKeyOf).join(',')].join('|');
  return ssMemo(key, () => {
    const n = SS_WEEK_RUNS, ids = Array.from(dist.keys());
    seedRng(ssHash(key));
    const drawn = new Map();
    let winBase = 0; const winSwap = new Float64Array(swaps.length);
    let marginSum = 0;
    for (let r = 0; r < n; r++) {
      for (let u = 0; u < ids.length; u++) drawn.set(ids[u], ssDraw(dist.get(ids[u])));
      let open = 0;
      for (let u = 0; u < base.length; u++) open += drawn.get(base[u]);
      for (let u = 0; u < extra.length; u++) open += ssDraw(extra[u]);
      const swingMe = Math.max(0.55, 1 + 0.05 * gauss());
      let oppOpen = 0;
      for (let u = 0; u < opps.length; u++) oppOpen += ssDraw(opps[u]);
      const swingOpp = Math.max(0.55, 1 + 0.05 * gauss());
      const them = lo.banked + Math.max(0, oppOpen * swingOpp);
      const me = banked + Math.max(0, open * swingMe);
      winBase += me > them ? 1 : me === them ? 0.5 : 0;
      marginSum += me - them;
      for (let s = 0; s < swaps.length; s++) {
        const sw = swaps[s];
        const mine = banked + Math.max(0, (open - drawn.get(sw.out) + drawn.get(sw.inn)) * swingMe);
        winSwap[s] += mine > them ? 1 : mine === them ? 0.5 : 0;
      }
    }
    const bySlot = {};
    swaps.forEach((sw, s) => { (bySlot[sw.i] = bySlot[sw.i] || {})[sw.j] = winSwap[s] / n; });
    return { opp, pWin: winBase / n, margin: marginSum / n, bySlot, runs: n, live };
  });
}

/* ---- what the odds look like on the page ---- */
const ssLast = p => (p.name || '').split(' ').slice(-1)[0] || p.name;
/** Under a candidate: his typical range, whether the sources disagree, and the win chance if he starts. */
function ssOddsLine(sl, i) {
  const q = sl.conf.sim.q[i], d = sl.conf.dists[i];
  const bits = [h('span', 'Typical range ', h('b.mono', fmt(q.lo, 0) + ' to ' + fmt(q.hi, 0)), ' · median ', h('b.mono', fmt(q.mid, 0)))];
  if (d && !d.zero && d.m > 0 && d.spread / d.m >= 0.2) {
    bits.push(h('span.tag', { title: 'The sources put him ' + fmt(d.spread, 1) + ' points apart, so his range is widened to match.' }, 'sources disagree'));
  }
  const w = sl.winBase === null || sl.winBase === undefined || !sl.odds ? null : (i === 0 ? sl.winBase : sl.odds[i]);
  if (w !== null && w !== undefined) {
    const diff = i === 0 ? null : (w - sl.winBase) * 100;
    bits.push(h('span', 'Win chance ', h('b.mono', pct(w, 1)),
      diff !== null && Math.abs(diff) >= 0.05 ? h('span.mono', { class: diff > 0 ? 'up' : 'down' }, ' (' + (diff > 0 ? '+' : '−') + Math.abs(diff).toFixed(1) + ')') : null));
  }
  return h('div.sspc-odds.tiny.muted', bits);
}
/** One sentence on what this slot's call is worth to your odds, and when the answer is not simply "the higher projection". */
function ssInsight(sl) {
  if (!sl.conf || sl.winBase === null || sl.winBase === undefined || !sl.odds) return null;
  const base = sl.winBase, rec = sl.cands[0];
  const ds = sl.cands.map((p, j) => j === 0 ? 0 : sl.odds[j] - base);
  let best = 0; ds.forEach((d, j) => { if (d > ds[best]) best = j; });
  const pts = x => (x * 100).toFixed(1);
  let text;
  if (best > 0 && ds[best] >= 0.005) {
    const alt = sl.cands[best], q = sl.conf.sim.q, mean_ = sl.conf.sim.mean;
    const lower = mean_[0] - mean_[best] > 0.05;
    let why = '';
    if (lower && base < 0.5 && q[best].hi > q[0].hi) why = ' You are the underdog this week, so his higher ceiling is worth more than the points.';
    else if (lower && base > 0.5 && q[best].lo > q[0].lo) why = ' You are the favorite this week, so his steadier floor is worth more than the points.';
    text = 'Starting ' + alt.name + ' instead adds ' + pts(ds[best]) + ' points of win chance' + (lower ? ', even though he projects ' + fmt(mean_[0] - mean_[best], 1) + ' lower' : '') + '.' + why;
  } else {
    const worst = Math.min(...ds.slice(1)), top = Math.max(...ds.slice(1));
    text = Math.max(Math.abs(worst), Math.abs(top)) < 0.003
      ? 'This call barely moves your odds: under 0.3 points of win chance either way.'
      : 'Starting ' + rec.name + ' is the better call here: the alternatives cost you ' + pts(-top) + (Math.abs(worst - top) >= 0.001 ? ' to ' + pts(-worst) : '') + ' points of win chance.';
  }
  return h('div.sspc-insight.tiny', h('b', 'For your odds. '), text);
}
/** The week's win chance with the recommended lineup, above the slot cards. */
function ssMatchBar(m, wk) {
  if (!m) return null;
  return h('div.ssmatch',
    h('div.ssm-top', h('span.tiny.muted', (m.live ? 'Win chance right now vs ' : 'Win chance vs ') + m.opp.name), h('b.mono', pct(m.pWin, 1))),
    h('div.sspc-bar', { 'aria-hidden': 'true' }, h('i', { style: { width: Math.max(2, m.pWin * 100) + '%' } })),
    h('div.tiny.muted', 'This week played ' + kfmt(m.runs) + ' times with the lineup below against theirs.'));
}
