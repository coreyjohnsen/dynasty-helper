"use strict";
/* ==================================================================
   Analysis layer — free agents, roster scouting, trade history
   ================================================================== */

/* ---------- free agents ---------- */
/** Everyone with a projection who is not on a roster in this league. */
function freeAgents() {
  if (S._fa) return S._fa;
  const owned = new Set();
  S.teams.forEach(t => t.players.forEach(p => owned.add(p.id)));
  S._fa = Object.values(S.index)
    .filter(p => !owned.has(p.id) && POS_ALL.indexOf(p.pos) >= 0)
    .sort((a, b) => (b.ppg || 0) - (a.ppg || 0));
  return S._fa;
}
const POS_ALL = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
/** What adding this player would add to a team's optimal lineup. */
function marginalAdd(players, taxi, ir, player, key) {
  const act = players.filter(p => !taxi.has(p.id) && !ir.has(p.id));
  return lineupPoints(act.concat([player]), key) - lineupPoints(act, key);
}

/* ---------- roster scouting ---------- */
/** How many lineup slots a position can occupy: dedicated slots plus a share of
 *  every flex that accepts it. */
function slotDemand() {
  if (S._slotDemand) return S._slotDemand;
  const rp = (S.cfg.rosterPositions || []).filter(p => !['BN', 'IR', 'TAXI'].includes(p));
  const d = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
  rp.forEach(slot => {
    const elig = SLOT_ELIG[slot] || [slot];
    if (elig.length === 1) { if (d[elig[0]] !== undefined) d[elig[0]] += 1; return; }
    elig.forEach(pos => { if (d[pos] !== undefined) d[pos] += 1 / elig.length; });
  });
  S._slotDemand = d;
  return d;
}
/** A player good enough to be worth starting over a waiver-wire replacement. */
function startable(p) { return (p.ppg || 0) > (STREAM[p.pos] !== undefined ? STREAM[p.pos] : 5) * 1.05; }

function scoutTeam(t) {
  const demand = slotDemand();
  const act = activePlayers(t);
  const zNow = {}, zVal = {};
  POS4.forEach(pos => {
    const arr = S.teams.map(x => x.posNow[pos]);
    const m = mean(arr), sd = sd_(arr) || 1;
    zNow[pos] = (t.posNow[pos] - m) / sd;
    const av = S.teams.map(x => x.posValue[pos]);
    const mv = mean(av), sv = sd_(av) || 1;
    zVal[pos] = (t.posValue[pos] - mv) / sv;
  });
  // kickers and defences are streamed, not built — nobody scouts a roster for
  // them and nobody trades for them, so they are left out of the scouting view
  const pos = POS4.filter(p => (demand[p] || 0) > 0).map(p => {
    const group = act.filter(x => x.pos === p).sort((a, b) => (b.ppg || 0) - (a.ppg || 0));
    const good = group.filter(startable);
    const need = demand[p] || 0;
    const depth = good.length - need;              // spare startable bodies
    return {
      pos: p, need: Math.round(need * 10) / 10, count: group.length, startable: good.length, depth,
      output: t.posNow[p] || 0, rank: (t.posNow[p + 'Rank'] || null),
      valueRank: (t.posValue[p + 'Rank'] || null),
      z: zNow[p] !== undefined ? zNow[p] : 0,
      best: group[0] || null,
      // a hole is thin bodies OR clearly below the league at that spot
      hole: depth < 0 || (zNow[p] !== undefined && zNow[p] < -0.85),
      surplus: depth >= 1 && (zNow[p] === undefined || zNow[p] > 0.25)
    };
  });
  const holes = pos.filter(p => p.hole).sort((a, b) => a.z - b.z);
  const surplus = pos.filter(p => p.surplus).sort((a, b) => b.z - a.z);
  const strengths = pos.slice().sort((a, b) => b.z - a.z).filter(p => p.z > 0.6).slice(0, 3);
  const weaknesses = pos.slice().sort((a, b) => a.z - b.z).filter(p => p.z < -0.6).slice(0, 3);
  const young = act.filter(p => p.age && p.age <= 25 && (p.dv || 0) > 1500).length;
  const old = act.filter(p => p.age && p.age >= 29 && (p.dv || 0) > 1500).length;
  return { team: t, pos, holes, surplus, strengths, weaknesses, young, old, demand };
}

/* ---------- starters and depth ----------
   A position is not one number. Two teams can produce the same points from
   their receivers and want opposite trades. One has two stars and nothing
   behind them: an injury or a bye turns a strength into a hole, so depth is
   cheap for them to buy and worth more than it looks. The other has four of the
   same receiver and nobody to build a week around: they have bodies to spare
   and would happily send two for one better one. On output alone both read as
   "covered", which is exactly the read that loses you the trade.

   What separates them is the shape of the group: how much of it is in the
   starters, what stands behind them, and whether anyone is a difference-maker.
   All three come out of the same numbers the rest of the app already has. */
const DEPTH_SHAPES = {
  thin: { tag: 'THIN', label: 'Thin', want: 'a starter', colour: 'var(--s8)' },
  topHeavy: { tag: 'TOP', label: 'Top-heavy', want: 'depth', colour: 'var(--s4)' },
  committee: { tag: 'FLAT', label: 'Committee', want: 'a difference-maker', colour: 'var(--s7)' },
  deep: { tag: 'DEEP', label: 'Strong and deep', want: null, colour: 'var(--s1)' },
  covered: { tag: 'OK', label: 'Covered', want: null, colour: 'var(--text-muted)' }
};

/** One team's group at one position, as a shape rather than a total. */
function posShape(t, pos, need) {
  const base = STREAM[pos] !== undefined ? STREAM[pos] : 5;
  const group = activePlayers(t).filter(x => x.pos === pos).sort((a, b) => (b.ppg || 0) - (a.ppg || 0));
  /* What a slot is worth, not what the player in it projects. An empty slot is
     not zero points — it is whatever the wire gives you — and neither is a slot
     held by somebody projecting nothing, because nobody starts him either. This
     is the same assumption the lineup solver already makes, and without it a
     roster with a zero on it reads as worse than a roster with a gap. */
  const at = i => Math.max(group[i] ? (group[i].ppg || 0) : 0, base);
  const n = Math.max(1, Math.round(need || 1));
  let sum = 0; for (let i = 0; i < n; i++) sum += at(i);
  const bodies = group.filter(startable).length;
  return {
    pos: pos, need: need || 0, n: n, group: group, team: t,
    top: at(0), last: at(n - 1), startAvg: sum / n,
    nextUp: at(n), next2: at(n + 1), depthAvg: (at(n) + at(n + 1)) / 2,
    cliff: at(n - 1) - at(n), spread: at(0) - at(n - 1),
    bodies: bodies, spare: bodies - Math.ceil(need || 1),
    spareBest: group[n] || null, best: group[0] || null, base: base
  };
}

/** The whole league's shapes, with the baselines each is judged against. */
function depthLeague() {
  if (S._depth) return S._depth;
  const demand = slotDemand();
  const positions = POS4.filter(p => (demand[p] || 0) > 0);
  const byTeam = {};
  S.teams.forEach(t => {
    byTeam[t.rosterId] = {};
    positions.forEach(p => { byTeam[t.rosterId][p] = posShape(t, p, demand[p]); });
  });
  const base = {};
  positions.forEach(p => {
    const st = S.teams.map(t => byTeam[t.rosterId][p].startAvg);
    const dp = S.teams.map(t => byTeam[t.rosterId][p].nextUp);
    /* A difference-maker is not "good", it is scarce. Judging him against the
       league's *best players* at that position rather than against its starters
       is what keeps the bar in the right place whatever the position's shape: a
       superflex QB1 and a WR1 are both roughly a top-quarter best player. */
    const tops = S.teams.map(t => byTeam[t.rosterId][p].top);
    base[p] = {
      start: mean(st), startSd: sd_(st) || 1, depth: mean(dp), depthSd: sd_(dp) || 1,
      elite: mean(tops) + 0.85 * (sd_(tops) || 0), need: demand[p] || 0
    };
  });
  S.teams.forEach(t => positions.forEach(p => shapeVerdict(byTeam[t.rosterId][p], base[p])));
  S._depth = { positions: positions, base: base, byTeam: byTeam };
  return S._depth;
}
/** Which of the five shapes a group is, and what that means for a trade. */
function shapeVerdict(e, b) {
  e.lgStart = b.start; e.lgDepth = b.depth; e.elite = b.elite;
  e.zStart = (e.startAvg - b.start) / b.startSd;
  e.zDepth = (e.nextUp - b.depth) / b.depthSd;
  e.hasStar = e.top >= b.elite && b.elite > 0;
  const nm = (p) => p ? p.name : 'nobody';
  if (e.bodies < Math.ceil(e.need) - 0.001 || e.zStart <= -0.85) {
    e.shape = 'thin';
    // not enough bodies and enough bodies who are not good enough are both thin,
    // and a manager hears them as different problems
    e.note = e.bodies < Math.ceil(e.need) - 0.001
      ? `${e.bodies} startable for ${fmt(e.need, 1)} slot${e.need === 1 ? '' : 's'} — they have to buy one.`
      : `${e.bodies} bodies but only ${fmt(e.startAvg, 1)} a slot against a league ${fmt(b.start, 1)} — the quantity is there, the quality is not.`;
  } else if (e.zStart >= 0.2 && (e.zDepth <= -0.45 || e.cliff >= Math.max(3, 0.45 * e.last))) {
    e.shape = 'topHeavy';
    e.note = `${nm(e.best)} carries it and the next man up is ${fmt(e.nextUp, 1)} a week — a bye or a knock costs them ${fmt(Math.max(0, e.cliff), 1)}.`;
  } else if (!e.hasStar && e.bodies >= e.n + 1 && e.spread <= 0.22 * e.startAvg) {
    e.shape = 'committee';
    e.note = `${e.bodies} of much the same player and nobody above ${fmt(e.elite, 1)} — they would send two for one better one.`;
  } else if (e.zStart >= 0.4 && e.zDepth >= 0.35) {
    e.shape = 'deep';
    e.note = `${fmt(e.startAvg, 1)} from the starters and ${fmt(e.nextUp, 1)} still on the bench — they can sell from it.`;
  } else {
    e.shape = 'covered';
    e.note = `${fmt(e.startAvg, 1)} a week from the starters against a league ${fmt(e.lgStart, 1)}, with ${fmt(e.nextUp, 1)} behind them.`;
  }
  e.verdict = DEPTH_SHAPES[e.shape];
  return e;
}
/** One team's shapes, in league order. */
function depthProfile(t) {
  const L = depthLeague();
  return L.positions.map(p => L.byTeam[t.rosterId][p]);
}

/* Where one roster's shape fits another's. A group that wants depth and a group
   with a spare startable body are a trade; so are a committee and somebody
   else's second star. This is the half of scouting the value-based finder
   cannot see, because both sides of these deals look even on price. */
function depthOpenings(me) {
  const L = depthLeague();
  const mine = L.byTeam[me.rosterId];
  if (!mine) return [];
  const out = [];
  S.teams.forEach(t => {
    if (t.rosterId === me.rosterId) return;
    L.positions.forEach(p => {
      const th = L.byTeam[t.rosterId][p], my = mine[p];
      if (!th || !my) return;
      if ((th.shape === 'topHeavy' || th.shape === 'thin') && my.spare >= 1 && my.spareBest) {
        out.push({
          team: t, pos: p, kind: th.shape === 'thin' ? 'starter' : 'depth', them: th, me: my,
          offer: my.spareBest, ask: th.shape === 'thin' ? 'a real price' : 'a modest price',
          why: th.shape === 'thin'
            ? `They are ${th.bodies} startable for ${fmt(th.need, 1)} slots. You can spare ${my.spareBest.name}.`
            : `${th.best ? th.best.name : 'Their starter'} is carrying it with ${fmt(th.nextUp, 1)} behind him. ${my.spareBest.name} is your ${ord(my.n + 1)} ${p} and would start for them in a pinch.`,
          score: (th.shape === 'thin' ? 0.2 : 1.0) + Math.max(0, -th.zDepth) * 0.6 + Math.max(0, my.spare) * 0.3
        });
      } else if (th.shape === 'committee' && my.hasStar && my.bodies >= my.n + 1 && my.best) {
        out.push({
          team: t, pos: p, kind: 'consolidate', them: th, me: my,
          offer: my.best, ask: 'two of theirs',
          why: `They have ${th.bodies} similar ${p}s and nobody above ${fmt(th.elite, 1)}. ${my.best.name} is the player that breaks the tie, and you have ${my.bodies} bodies to fall back on.`,
          score: 1.2 + (my.bodies - my.n) * 0.25 + Math.max(0, my.zStart) * 0.3
        });
      }
    });
  });
  /* One player can only be sent once and one manager will not take four calls
     about four positions, so the list is the best idea per piece and per team
     rather than every pairing the numbers allow. */
  const usedPlayer = {}, perTeam = {};
  return out.sort((a, b) => b.score - a.score).filter(o => {
    const id = o.offer.id, tid = o.team.rosterId;
    if (usedPlayer[id]) return false;
    if ((perTeam[tid] || 0) >= 2) return false;
    usedPlayer[id] = 1; perTeam[tid] = (perTeam[tid] || 0) + 1;
    return true;
  });
}

/* ---------- trade history ---------- */
/** Turn Sleeper's transaction feed into two-sided trades with assets per team. */
function parseTrades() {
  if (S._trades) return S._trades;
  const out = [];
  (S.transactions || []).forEach(tx => {
    if (tx.type !== 'trade' || tx.status !== 'complete') return;
    const rosters = (tx.roster_ids || []).slice();
    if (rosters.length < 2) return;
    const sides = {};
    rosters.forEach(r => sides[r] = { rosterId: r, team: S.teamById[r] || null, got: [], sent: [] });
    for (const pid in (tx.adds || {})) {
      const to = tx.adds[pid];
      const p = S.index[pid] || ensurePlayer(pid);
      if (sides[to]) sides[to].got.push({ kind: 'player', id: pid, name: p.name, pos: p.pos, ref: p, value: p.dv || 0 });
    }
    for (const pid in (tx.drops || {})) {
      const from = tx.drops[pid];
      const p = S.index[pid] || ensurePlayer(pid);
      if (sides[from]) sides[from].sent.push({ kind: 'player', id: pid, name: p.name, pos: p.pos, ref: p, value: p.dv || 0 });
    }
    (tx.draft_picks || []).forEach(dp => {
      const season = +dp.season, round = +dp.round;
      const key = season + '|' + round + '|' + dp.roster_id;
      // price it the way the app prices any pick: off the original owner's outlook
      // a redraft league's picks buy nothing that carries, so they are recorded
      // as part of the trade but priced at nothing rather than at a rookie-pick rate
      let value = 0, slotLabel = null;
      if (isDynasty()) {
        try {
          const q = pickPricer(null)({ season, round, origRosterId: +dp.roster_id });
          value = q.value; slotLabel = round + '.' + String(q.slot).padStart(2, '0');
        } catch (e) { value = pickValue(season, round, 'Mid'); }
      }
      const orig = S.teamById[+dp.roster_id];
      const label = season + ' ' + (ROUND_WORD[round] || round + 'th') + (orig ? ' (' + orig.short + ')' : '');
      const asset = { kind: 'pick', id: 'PK|' + key, name: label, pos: 'PICK', value, slotLabel, season, round };
      if (sides[dp.owner_id]) sides[dp.owner_id].got.push(asset);
      if (sides[dp.previous_owner_id]) sides[dp.previous_owner_id].sent.push(asset);
    });
    (tx.waiver_budget || []).forEach(wb => {
      const a = { kind: 'faab', id: 'FAAB' + wb.amount + '-' + wb.sender + '-' + wb.receiver, name: '$' + wb.amount + ' FAAB', pos: 'NA', value: 0 };
      if (sides[wb.receiver]) sides[wb.receiver].got.push(a);
      if (sides[wb.sender]) sides[wb.sender].sent.push(a);
    });
    const list = Object.values(sides);
    if (!list.some(s => s.got.length || s.sent.length)) return;
    out.push({
      id: tx.transaction_id, when: tx.created ? new Date(tx.created) : null,
      week: tx._week || tx.leg || null, creator: tx.creator, sides: list
    });
  });
  out.sort((a, b) => (b.when ? b.when.getTime() : 0) - (a.when ? a.when.getTime() : 0));
  out.forEach(tr => gradeTrade(tr));
  S._trades = out;
  return out;
}

const GRADES = [
  [0.55, 'A+'], [0.38, 'A'], [0.24, 'A−'], [0.14, 'B+'], [0.05, 'B'], [-0.05, 'B−'],
  [-0.14, 'C+'], [-0.24, 'C'], [-0.38, 'C−'], [-0.55, 'D'], [-Infinity, 'F']
];
function gradeLetter(score) {
  for (const [thr, g] of GRADES) if (score >= thr) return g;
  return 'F';
}
/** Score each side on value swing and on how well the pieces fit the roster.
 *  Values are today's market, so this reads a trade with hindsight — it is not a
 *  verdict on the decision at the time it was made. */
function gradeTrade(tr) {
  const demand = slotDemand();
  tr.sides.forEach(s => {
    s.gotValue = sum(s.got.map(a => a.value));
    s.sentValue = sum(s.sent.map(a => a.value));
    s.net = s.gotValue - s.sentValue;
    const base = Math.max(400, (s.gotValue + s.sentValue) / 2);
    s.valueEdge = clamp(s.net / base, -1.6, 1.6);
    // need fit: did the incoming pieces land where this roster is thin, and did
    // the outgoing pieces come from a spot it could afford to sell from?
    let fit = 0, n = 0;
    if (s.team) {
      const sc = scoutTeam(s.team);
      const zOf = (p) => { const e = sc.pos.find(x => x.pos === p); return e ? e.z : 0; };
      s.got.filter(a => a.kind === 'player').forEach(a => { fit += clamp(-zOf(a.pos), -1, 1); n++; });
      s.sent.filter(a => a.kind === 'player').forEach(a => { fit += clamp(zOf(a.pos), -1, 1) * 0.6; n++; });
    }
    s.needFit = n ? fit / n : 0;
    s.score = s.valueEdge + 0.3 * s.needFit;
    s.grade = gradeLetter(s.score);
  });
  const best = tr.sides.slice().sort((a, b) => b.score - a.score);
  tr.winner = best.length > 1 && Math.abs(best[0].score - best[1].score) > 0.08 ? best[0] : null;
  tr.margin = best.length > 1 ? best[0].score - best[1].score : 0;
  tr.totalValue = sum(tr.sides.map(s => s.gotValue));
  return tr;
}
/** Per-manager trading record. */
function traderStats() {
  const trades = parseTrades();
  const by = {};
  S.teams.forEach(t => by[t.rosterId] = {
    team: t, n: 0, net: 0, scores: [], wins: 0, losses: 0, partners: {},
    playersIn: 0, playersOut: 0, picksIn: 0, picksOut: 0, ageIn: [], ageOut: [], valueIn: 0, valueOut: 0
  });
  trades.forEach(tr => tr.sides.forEach(s => {
    const b = by[s.rosterId]; if (!b) return;
    b.n++; b.net += s.net; b.scores.push(s.score);
    if (tr.winner === s) b.wins++; else if (tr.winner) b.losses++;
    tr.sides.forEach(o => { if (o !== s) b.partners[o.rosterId] = (b.partners[o.rosterId] || 0) + 1; });
    s.got.forEach(a => {
      if (a.kind === 'player') { b.playersIn++; b.valueIn += a.value; if (a.ref && a.ref.age) b.ageIn.push(a.ref.age); }
      if (a.kind === 'pick') { b.picksIn++; b.valueIn += a.value; }
    });
    s.sent.forEach(a => {
      if (a.kind === 'player') { b.playersOut++; b.valueOut += a.value; if (a.ref && a.ref.age) b.ageOut.push(a.ref.age); }
      if (a.kind === 'pick') { b.picksOut++; b.valueOut += a.value; }
    });
  }));
  const list = Object.values(by);
  list.forEach(b => {
    b.avgScore = b.scores.length ? mean(b.scores) : null;
    b.grade = b.scores.length ? gradeLetter(b.avgScore) : null;
    const pk = Object.keys(b.partners).sort((x, y) => b.partners[y] - b.partners[x])[0];
    b.topPartner = pk ? { team: S.teamById[+pk], n: b.partners[pk] } : null;
    b.pickFlow = b.picksIn - b.picksOut;
    b.ageFlow = (b.ageIn.length ? mean(b.ageIn) : null);
    b.ageSent = (b.ageOut.length ? mean(b.ageOut) : null);
  });
  return { list, trades };
}
/** Which way a manager's actual moves point, independent of their roster. */
function tradeDirection(stat) {
  if (!stat || !stat.n) return { label: 'Quiet', detail: 'No completed trades to read.' };
  const bits = [];
  let score = 0;
  if (stat.pickFlow >= 2) { score -= 1; bits.push('collecting picks'); }
  else if (stat.pickFlow <= -2) { score += 1; bits.push('spending picks'); }
  if (stat.ageFlow !== null && stat.ageSent !== null) {
    const d = stat.ageFlow - stat.ageSent;
    if (d >= 1.2) { score += 1; bits.push('taking on older players'); }
    else if (d <= -1.2) { score -= 1; bits.push('getting younger'); }
  }
  const label = score >= 1 ? 'Buying' : score <= -1 ? 'Selling' : 'Balanced';
  return { label, detail: bits.length ? bits.join(', ') : 'no clear directional pattern yet', score };
}
/** Roster window plus actual behaviour, reconciled. */
function projectedStrategy(t, stat) {
  const dir = tradeDirection(stat);
  const win = t.window;
  // A redraft league has no window to be in, so the read is simpler and it is
  // about this season only: are they good, and are they buying or selling it?
  if (!isDynasty()) {
    const strong = t.powerZ > 0.35, weak = t.powerZ < -0.35;
    const inPlay = S.sim && S.sim.by[t.rosterId] ? S.sim.by[t.rosterId].playoff : null;
    let headline, detail;
    if (strong && dir.label === 'Buying') { headline = 'Going for it'; detail = 'A strong roster and they are still adding. Expect them to pay up for a difference-maker.'; }
    else if (strong && dir.label === 'Selling') { headline = 'Selling from strength'; detail = 'Good enough to win and still moving pieces out — usually depth for a starter, so they will want quality back.'; }
    else if (weak && dir.label === 'Selling') { headline = 'Punting the season'; detail = 'Out of it and shipping useful players. The best place in the league to buy production cheaply.'; }
    else if (weak && dir.label === 'Buying') { headline = 'Chasing it'; detail = 'Behind and still buying. Either they like their odds more than the table does, or they are a soft touch.'; }
    else if (strong) { headline = 'Standing pat'; detail = 'Strong roster, no trades yet. Likely to move only for a clear upgrade.'; }
    else if (weak) { headline = 'Stuck'; detail = 'Weak roster, not trading. Worth an offer — they may not have realised the season is gone.'; }
    else headline = 'In the pack', detail = 'Middle of the table and not committed either way — the hardest kind of team to read.';
    if (inPlay !== null && inPlay < 0.12 && !/Punting|Stuck/.test(headline)) detail += ' The simulator gives them ' + pct(inPlay, 0) + ' to make the playoffs.';
    return { headline, detail, direction: dir, window: null };
  }
  const contending = ['Contend', 'Win-now'].includes(win);
  const rebuilding = ['Rebuild', 'Retool'].includes(win);
  let headline, detail;
  if (contending && dir.label === 'Buying') { headline = 'All-in'; detail = 'A contending roster and they are spending future capital to push it further.'; }
  else if (contending && dir.label === 'Selling') { headline = 'Selling high'; detail = 'Good enough to win now, but cashing pieces in — either hedging or they do not rate their own window.'; }
  else if (rebuilding && dir.label === 'Selling') { headline = 'Committed rebuild'; detail = 'Weak roster, moving veterans out for picks and youth. Expect them to keep selling.'; }
  else if (rebuilding && dir.label === 'Buying') { headline = 'Buying against the window'; detail = 'Adding win-now pieces to a roster that is not close. Often a source of value if they overpay.'; }
  else if (contending) { headline = 'Standing pat'; detail = 'Contending roster, no directional trading yet. Likely to buy if the price is right.'; }
  else if (rebuilding) { headline = 'Rebuilding quietly'; detail = 'Bottom of the table and not yet trading. A candidate to start selling veterans.'; }
  else headline = 'Middling', detail = 'Neither clearly contending nor rebuilding — the hardest kind of team to read.';
  return { headline, detail, direction: dir, window: win };
}
/* ================= weekly outlook helpers ================= */
/** Floor / median / ceiling for one player in one week. Seeded per player so the
 *  numbers hold still between renders instead of jittering on every click. */
function weekOutlook(p, wk) {
  /* In the week being played, a finished game is a fact rather than a
     distribution, and a game in progress only has the part that is left to
     play still in doubt. */
  const lv = wk === S.liveWeek ? liveValue(p, wk) : null;
  if (lv && lv.state === 'done') {
    return {
      mean: lv.used, floor: lv.used, median: lv.used, ceil: lv.used, sd: 0,
      bye: false, opp: lv.opp, bust: 0, boom: 0, state: 'done', actual: lv.actual, final: true
    };
  }
  const banked = lv ? lv.banked : 0;
  const m = lv ? lv.open : pw(p, wk);
  if (!(m > 0.05)) {
    // nothing projected. That is a bye only if his team really is off this week;
    // otherwise he is expected not to play, which is a different sentence.
    const bye = lv ? lv.state === 'bye' : onBye(p, wk);
    return {
      mean: banked, floor: banked, median: banked, ceil: banked, bye: bye,
      opp: lv ? lv.opp : pwOpp(p, wk), zero: !bye,
      state: lv ? lv.state : (bye ? 'bye' : 'out'), final: !!lv && lv.state !== 'upcoming'
    };
  }
  const sd = volFromMean(p.pos, m), n = 3000;
  seedRng(hashStr(p.id + '|' + wk));
  const s = new Array(n);
  for (let i = 0; i < n; i++) s[i] = banked + (rnd() < BUST_RATE ? 0 : drawScore(m, sd));
  s.sort((a, b) => a - b);
  const mean = banked + m;
  return {
    mean: mean, sd, bye: false, opp: lv ? lv.opp : pwOpp(p, wk),
    floor: s[Math.floor(n * 0.1)], median: s[n >> 1], ceil: s[Math.floor(n * 0.9)],
    bust: s.filter(x => x < mean * 0.5).length / n, boom: s.filter(x => x > mean * 1.5).length / n,
    state: lv ? lv.state : null, actual: lv ? lv.actual : null, quarter: lv ? lv.quarter : null
  };
}
/** Probability a outscores b in a given week, from independent paired draws. */
function pBeats(a, b, wk) {
  const ma = pwShown(a, wk), mb = pwShown(b, wk);
  if (!(ma > 0.05) && !(mb > 0.05)) return 0.5;
  const sa = volFromMean(a.pos, ma), sb = volFromMean(b.pos, mb);
  const n = 12000; let w = 0;
  seedRng(hashStr(a.id + '|' + b.id + '|' + wk));
  for (let i = 0; i < n; i++) {
    const x = ma > 0.05 ? (rnd() < BUST_RATE ? 0 : drawScore(ma, sa)) : 0;
    const y = mb > 0.05 ? (rnd() < BUST_RATE ? 0 : drawScore(mb, sb)) : 0;
    if (x > y) w++; else if (x === y) w += 0.5;
  }
  return w / n;
}

