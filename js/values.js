"use strict";
/* ================= player values ================= */
const POS4 = ['QB', 'RB', 'WR', 'TE'];

function detectFormat(league) {
  const rp = league.roster_positions || [];
  const cnt = (x) => rp.filter(p => p === x).length;
  const sf = cnt('SUPER_FLEX') > 0 || cnt('QB') >= 2;
  const teams = league.total_rosters || 12;
  const snapTeams = [8, 10, 12, 14, 16].reduce((a, b) => Math.abs(b - teams) < Math.abs(a - teams) ? b : a, 12);
  const ss = league.scoring_settings || {};
  let ppr = ss.rec === undefined ? 1 : Number(ss.rec);
  ppr = [0, 0.5, 1].reduce((a, b) => Math.abs(b - ppr) < Math.abs(a - ppr) ? b : a, 1);
  return {
    numQbs: sf ? 2 : 1, numTeams: snapTeams, actualTeams: teams, ppr,
    superflex: sf, tePrem: Number(ss.bonus_rec_te || 0), passTd: Number(ss.pass_td === undefined ? 4 : ss.pass_td),
    passYd: Number(ss.pass_yd === undefined ? 0.04 : ss.pass_yd),
    rosterPositions: rp,
    startCount: rp.filter(p => !['BN', 'IR', 'TAXI'].includes(p)).length,
    // Active roster spots are the starting slots plus the bench. IR and taxi sit
    // OUTSIDE roster_positions — Sleeper carries their sizes in league.settings —
    // so a player on either does not consume an active spot.
    activeSpots: rp.filter(p => p !== 'IR' && p !== 'TAXI').length,
    irSlots: Number((league.settings || {}).reserve_slots || 0) + rp.filter(p => p === 'IR').length,
    taxiSlots: Number((league.settings || {}).taxi_slots || 0) + rp.filter(p => p === 'TAXI').length,
    hasK: rp.includes('K'), hasDef: rp.includes('DEF') || rp.includes('DST'),
    idp: rp.some(p => ['DL', 'LB', 'DB', 'IDP_FLEX', 'DE', 'DT', 'CB', 'SS', 'FS', 'S'].includes(p))
  };
}

async function loadValues(cfg) {
  const key = `fc:${cfg.numQbs}:${cfg.numTeams}:${cfg.ppr}`;
  const cached = LS.get(key);
  const FRESH = 4 * 3600 * 1000;
  if (cached && Date.now() - cached.t < FRESH) return cached.d;
  const url = `${FCALC}/values/current?isDynasty=true&numQbs=${cfg.numQbs}&numTeams=${cfg.numTeams}&ppr=${cfg.ppr}&includeAdp=false`;
  try {
    const d = await getJSON(url, 3);
    LS.set(key, { t: Date.now(), d });
    return d;
  } catch (e) {
    if (cached) return cached.d;
    throw e;
  }
}

/* FantasyCalc's own redraft prices for this league's format. The dynasty request also
   carries a `redraftValue` on every row, but this is the endpoint that prices redraft
   directly, so it is the number to trust; a player it does not list falls back to that
   row's `redraftValue`, and a player neither lists is priced at zero rather than guessed. */
async function loadRedraftValues(cfg) {
  const key = `fc:r:${cfg.numQbs}:${cfg.numTeams}:${cfg.ppr}`;
  const cached = LS.get(key);
  if (cached && Date.now() - cached.t < 4 * 3600 * 1000) return cached.d;
  try {
    const d = await getJSON(`${FCALC}/values/current?isDynasty=false&numQbs=${cfg.numQbs}&numTeams=${cfg.numTeams}&ppr=${cfg.ppr}&includeAdp=false`, 2);
    const pairs = Array.isArray(d) ? d.filter(r => r && r.player && r.player.sleeperId).map(r => [String(r.player.sleeperId), r.value || 0]) : [];
    if (pairs.length) { LS.set(key, { t: Date.now(), d: pairs }); return pairs; }
  } catch (e) { /* the dynasty response's own redraft column still stands in */ }
  return cached ? cached.d : null;
}

async function loadSleeperPlayers() {
  const rec = await idbGet('players');
  const FRESH = 12 * 3600 * 1000;
  if (rec && Date.now() - rec.t < FRESH && rec.d && rec.v === 3) return rec.d;
  try {
    const raw = await getJSON(SLEEPER + '/players/nfl', 1);
    const slim = {};
    for (const id in raw) {
      const p = raw[id];
      if (!p) continue;
      const pos = p.position || (p.fantasy_positions && p.fantasy_positions[0]);
      if (!pos) continue;
      slim[id] = {
        n: p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || id,
        p: pos === 'DST' ? 'DEF' : pos, t: p.team || null, a: p.age || null,
        y: p.years_exp === undefined ? null : p.years_exp,
        i: p.injury_status || null, r: p.search_rank || 9999,
        d: p.depth_chart_order || null, st: p.status || null,
        e: p.espn_id ? String(p.espn_id) : null          // ESPN's id for him, so ESPN's projections can be matched
      };
      if (p.injury_status) {
        // what the tag does not say: where, how long ago, in whose words, and the
        // id ESPN knows him by (so the return-date feed matches exactly)
        slim[id].ib = p.injury_body_part || null; slim[id].in = p.injury_notes || null;
        slim[id].is = p.injury_start_date || null; slim[id].e = p.espn_id || null;
      }
    }
    await idbSet('players', { t: Date.now(), d: slim, v: 3 });
    return slim;
  } catch (e) {
    if (rec && rec.d) return rec.d;
    throw e;
  }
}

/* ---- projection curves: positional rank -> full-PPR points/game ---- */
const PPG_ANCHORS = {
  QB: [[1, 23.6], [4, 21.6], [8, 19.6], [12, 17.9], [16, 16.3], [20, 14.6], [24, 13.0], [32, 10.4], [48, 7.2]],
  RB: [[1, 19.8], [3, 17.6], [6, 15.9], [12, 13.4], [18, 11.6], [24, 10.0], [36, 7.6], [48, 5.9], [72, 3.6]],
  WR: [[1, 19.4], [3, 17.4], [6, 16.0], [12, 14.0], [18, 12.5], [24, 11.3], [36, 9.4], [48, 7.9], [72, 5.6], [100, 3.6]],
  TE: [[1, 15.2], [2, 13.4], [4, 11.4], [6, 10.1], [12, 7.9], [18, 6.2], [24, 5.0], [36, 3.4]],
  K: [[1, 9.3], [12, 8.2], [24, 7.2], [36, 6.4]],
  DEF: [[1, 9.6], [6, 8.2], [12, 7.1], [24, 5.6], [32, 4.6]]
};
const REC_PG = { QB: 0, RB: 3.0, WR: 5.1, TE: 4.3, K: 0, DEF: 0 };
const REPL = { QB: 8.5, RB: 4.2, WR: 4.2, TE: 2.8, K: 7.4, DEF: 6.2 };

function curveLookup(pos, rank) {
  const a = PPG_ANCHORS[pos]; if (!a) return REPL[pos] || 3;
  if (rank <= a[0][0]) return a[0][1];
  for (let i = 1; i < a.length; i++) {
    if (rank <= a[i][0]) {
      const [r0, v0] = a[i - 1], [r1, v1] = a[i];
      const t = (Math.log(rank) - Math.log(r0)) / (Math.log(r1) - Math.log(r0));
      return v0 + t * (v1 - v0);
    }
  }
  const last = a[a.length - 1];
  return Math.max(REPL[pos] * 0.55, last[1] - (Math.log(rank / last[0])) * 2.4);
}
function scoringAdjust(pos, ppg, rank, cfg) {
  let v = ppg;
  const rec = REC_PG[pos] || 0;
  v -= (1 - cfg.ppr) * rec * (pos === 'TE' ? 0.9 : 1) * clamp(1 - (rank - 1) / 90, 0.45, 1);
  if (pos === 'TE') v += cfg.tePrem * rec * clamp(1 - (rank - 1) / 30, 0.4, 1);
  if (pos === 'QB') {
    v += (cfg.passTd - 4) * 1.55 * clamp(1 - (rank - 1) / 40, 0.4, 1);
    v += (cfg.passYd - 0.04) * 245 * clamp(1 - (rank - 1) / 40, 0.4, 1);
  }
  return Math.max(0.4, v);
}
function volFor(pos, ppg) {
  if (pos === 'QB') return 0.33 * ppg + 2.6;
  if (pos === 'K') return 3.6;
  if (pos === 'DEF') return 4.4;
  if (pos === 'TE') return 0.52 * ppg + 2.1;
  return 0.47 * ppg + 2.3;
}
/* age curve: multiplier on 2-3yr-out expectation */
function futureFactor(pos, age, exp) {
  const a = age || (exp !== null && exp !== undefined ? 22 + exp : 26);
  const peak = { QB: 29, RB: 25, WR: 26.5, TE: 27, K: 30, DEF: 28 }[pos] || 27;
  const decl = { QB: 0.055, RB: 0.155, WR: 0.085, TE: 0.075, K: 0.02, DEF: 0.02 }[pos] || 0.08;
  const rise = { QB: 0.055, RB: 0.05, WR: 0.06, TE: 0.075, K: 0, DEF: 0 }[pos] || 0.05;
  const t = a + 2.2;
  let f = t <= peak ? 1 + rise * Math.min(peak - a, 3.2) : 1 - decl * (t - peak);
  return clamp(f, 0.18, 1.45);
}

/* ---------- build the master player index ---------- */
const PICK_RE = /^(\d{4})\s+(?:Pick\s+(\d+)\.(\d+)|(1st|2nd|3rd|4th|5th)(?:\s*\((Early|Mid|Late)\))?)$/i;
const ROUND_WORD = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th' };

function buildIndex() {
  const cfg = S.cfg, sp = S.players, vals = S.values || [];
  const idx = {};        // sleeperId -> player object
  const picks = {};      // "2027|1|Mid" -> value ;  "2026|1|3" (exact slot) -> value
  const byPos = { QB: [], RB: [], WR: [], TE: [] };
  // FantasyCalc's redraft endpoint, when it answered: the actual redraft price for each player
  const rvApi = S.redraftApi ? new Map(S.redraftApi) : null;

  for (const row of vals) {
    const p = row.player || {};
    if (p.position === 'PICK' || !p.sleeperId) {
      const m = PICK_RE.exec(p.name || '');
      if (m) {
        const yr = m[1];
        if (m[2]) picks[`${yr}|${+m[2]}|slot${+m[3]}`] = row.value;
        else {
          const rd = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5 }[m[4].toLowerCase()];
          picks[`${yr}|${rd}|${(m[5] || 'Any')}`] = row.value;
        }
      }
      continue;
    }
    const id = String(p.sleeperId);
    const meta = sp[id] || {};
    const pos = (p.position || meta.p || 'NA').toUpperCase();
    const o = {
      id, name: p.name || meta.n || id, pos,
      team: meta.t || p.maybeTeam || null,
      age: p.maybeAge !== null && p.maybeAge !== undefined ? Math.round(p.maybeAge * 10) / 10 : (meta.a || null),
      exp: p.maybeYoe !== null && p.maybeYoe !== undefined ? p.maybeYoe : meta.y,
      dv: row.value || 0, dvDyn: row.value || 0, rv: rvApi && rvApi.has(id) ? rvApi.get(id) : (row.redraftValue || 0),
      rank: row.overallRank, posRank: row.positionRank, tier: row.maybeTier || null,
      trend30: row.trend30Day || 0, rosterPct: row.maybeRosterPercent,
      tradeFreq: row.maybeTradeFrequency, injury: meta.i || null,
      draft: p.maybeDraftInfo || null, college: p.maybeCollege || null,
      sd_pct: row.maybeMovingStandardDeviationPerc || 0
    };
    idx[id] = o;
    if (byPos[pos]) byPos[pos].push(o);
  }

  // positional ranks from redraft value (now) and dynasty value (future)
  for (const pos of POS4) {
    const list = byPos[pos];
    list.slice().sort((a, b) => (b.rv || 0) - (a.rv || 0)).forEach((p, i) => p.rvRank = i + 1);
    list.slice().sort((a, b) => (b.dv || 0) - (a.dv || 0)).forEach((p, i) => p.dvRank = i + 1);
  }
  // projections
  for (const id in idx) {
    const p = idx[id];
    if (!POS4.includes(p.pos)) { p.ppg = REPL[p.pos] || 3; p.fppg = p.ppg; p.vol = volFor(p.pos, p.ppg); continue; }
    const nowRank = p.rv > 0 ? p.rvRank : (p.dvRank + 24);
    p.ppg = scoringAdjust(p.pos, curveLookup(p.pos, nowRank), nowRank, cfg);
    // A player the NFL has ruled out is not "a twentieth of himself" — he is not
    // playing, and five per cent of a baseline is just a number small enough to
    // look like a rounding error while still being wrong. This only reaches
    // players with no Sleeper weekly line of their own; anyone with one is
    // projected from that.
    p.ppgHealthy = p.ppg;                        // before any injury discount
    if (OUT_TAGS.includes(p.injury)) p.ppg = 0;
    else if (p.injury === 'Doubtful') p.ppg *= 0.35;
    else if (p.injury === 'Questionable') p.ppg *= 0.9;
    p.vol = volFor(p.pos, p.ppg);
    const dynBase = scoringAdjust(p.pos, curveLookup(p.pos, p.dvRank), p.dvRank, cfg);
    p.fppgDyn = Math.max(0.3, dynBase * futureFactor(p.pos, p.age, p.exp));
    p.fppg = p.fppgDyn;
  }
  // FantasyCalc carries a redraft price on the same rows, but if a future
  // response ever stopped doing so, switching currency would zero every roster
  // in the league. Sooner an honest fallback than a silently empty app.
  if (!isDynasty()) {
    const valued = Object.values(idx).filter(p => (p.dvDyn || 0) > 0);
    const priced = valued.filter(p => (p.rv || 0) > 0);
    if (valued.length > 20 && priced.length < valued.length * 0.25) {
      S.redraftPricesMissing = true;
      console.warn('No redraft prices in the FantasyCalc response; falling back to dynasty values.');
    } else S.redraftPricesMissing = false;
  }
  applyValueMode(idx);
  // fill in unvalued rostered players from the Sleeper db
  S.pickVals = picks;
  return idx;
}
function ensurePlayer(id) {
  if (S.index[id]) return S.index[id];
  const m = S.players[id];
  const pos = m ? m.p : (/^[A-Z]{2,3}$/.test(id) ? 'DEF' : 'NA');
  const o = {
    id, name: m ? m.n : id, pos, team: m ? m.t : (pos === 'DEF' ? id : null),
    age: m ? m.a : null, exp: m ? m.y : null, dv: 0, dvDyn: 0, rv: 0, rank: null, posRank: null,
    trend30: 0, injury: m ? m.i : null, unranked: true
  };
  o.ppg = REPL[pos] !== undefined ? REPL[pos] * (pos === 'DEF' || pos === 'K' ? 1 : 0.8) : 1.5;
  o.ppgHealthy = o.ppg;
  if (OUT_TAGS.includes(o.injury)) o.ppg = 0;
  o.fppgDyn = o.ppg * 0.85;
  o.fppg = isDynasty() ? o.fppgDyn : o.ppg;
  o.vol = volFor(pos, o.ppg);
  S.index[id] = o;
  availOne(o);
  return o;
}

/* ---------- pick valuation ---------- */
function pickValue(season, round, tierWord, slot) {
  const V = S.pickVals || {};
  if (slot) { const k = `${season}|${round}|slot${slot}`; if (V[k] !== undefined) return V[k]; }
  const tries = [tierWord, 'Mid', 'Any', 'Early', 'Late'];
  for (const t of tries) { const k = `${season}|${round}|${t}`; if (V[k] !== undefined) return V[k]; }
  // extrapolate beyond the horizon FantasyCalc publishes: discount ~18%/yr from the last known year
  const years = Object.keys(V).map(k => +k.split('|')[0]).filter(y => y);
  if (!years.length) return 0;
  const maxY = Math.max(...years);
  const base = V[`${maxY}|${round}|${tierWord}`] ?? V[`${maxY}|${round}|Mid`] ?? V[`${maxY}|${round}|Any`] ?? 0;
  const gap = Math.max(0, season - maxY);
  return Math.round(base * Math.pow(0.82, gap));
}
function pickLabel(pk) {
  const rw = ROUND_WORD[pk.round] || (pk.round + 'th');
  const who = pk.origRosterId !== pk.rosterId ? ' (' + (teamShort(pk.origRosterId) || '?') + ')' : '';
  return `${pk.season} ${rw}${who}`;
}

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
/* per-position weekly coefficient of variation, calibrated so that a full
   starting lineup lands near the 0.22 team-level CV measured from real leagues */
const POS_CV = { QB: 0.36, RB: 0.53, WR: 0.58, TE: 0.61, K: 0.39, DEF: 0.53 };
const BUST_RATE = 0.012;               // starter unexpectedly inactive / knocked out early
/* Tags that mean "will not play". Sleeper reports the NFL's own designation. */
const OUT_TAGS = ['IR', 'Out', 'PUP', 'Sus', 'DNR', 'COV'];
function volFromMean(pos, mu) { return (POS_CV[pos] || 0.65) * mu + 1.15; }

/* ================= Sleeper weekly projections =================
   Rotowire lines served through Sleeper: one call per player returns all 18
   weeks, with the opponent attached and a null entry on the bye. Scored through
   this league's own scoring settings rather than Sleeper's generic pts_* fields,
   so custom scoring, TE premium and 6-point passing TDs are all respected. */
function scoreLine(stats) {
  const ss = (S.league && S.league.scoring_settings) || {};
  let p = 0;
  for (const k in ss) {
    if (k === 'pts_ppr' || k === 'pts_std' || k === 'pts_half_ppr') continue;
    const v = stats[k];
    if (typeof v === 'number' && isFinite(v)) p += ss[k] * v;
  }
  return Math.round(p * 100) / 100;
}
/* ================= actual weekly scoring for players nobody rosters =================
   Sleeper's matchup rows only score players on a roster in this league, so a free agent's past weeks are blank
   there. Sleeper also serves every player's raw stat line for a finished week; scored with this league's own
   settings (the same scoreLine() used for projections) it gives the same points a roster would have got.
   Only a player's own page asks for it, and only for the weeks he sat on no roster. */
const WSTATS = { pts: {}, state: {}, inflight: {} };           // week -> { playerId: points }, week -> 'ok' | 'fail'
async function loadWeekStats(week) {
  if (WSTATS.state[week]) return WSTATS.state[week] === 'ok';
  if (WSTATS.inflight[week]) return WSTATS.inflight[week];
  const season = S.season, key = 'wstats:' + S.leagueId + ':' + season + ':' + week;
  WSTATS.inflight[week] = (async () => {
    try {
      // a finished week's stats do not change, so a saved copy is good for days
      const rec = await idbGet(key);
      if (rec && rec.d && Date.now() - rec.t < 3 * 86400 * 1000) { WSTATS.pts[week] = rec.d; WSTATS.state[week] = 'ok'; return true; }
      const j = await getJSON(`https://api.sleeper.app/stats/nfl/regular/${season}/${week}`, 2);
      if (!j || typeof j !== 'object') throw new Error('no stats');
      const out = {};
      // keep the players this app knows, as points, so the saved copy stays small
      for (const id in S.index) {
        const st = j[id]; if (!st || typeof st !== 'object') continue;
        if (!Object.keys(st).some(k => typeof st[k] === 'number')) continue;
        out[id] = scoreLine(st);
      }
      WSTATS.pts[week] = out; WSTATS.state[week] = 'ok';
      idbSet(key, { t: Date.now(), d: out });
      return true;
    } catch (e) { WSTATS.state[week] = 'fail'; return false; }
    finally { delete WSTATS.inflight[week]; }
  })();
  return WSTATS.inflight[week];
}
async function loadWeeklyProjections(ids, season, onProgress) {
  const key = 'wproj:' + season;
  const rec = await idbGet(key);
  const FRESH = 6 * 3600 * 1000;
  const have = (rec && Date.now() - rec.t < FRESH && rec.d) ? rec.d : {};
  const missing = ids.filter(id => !have[id]);
  let done = 0;
  const fetchOne = async (id) => {
    try {
      const j = await getJSON(`https://api.sleeper.app/projections/nfl/player/${encodeURIComponent(id)}?season_type=regular&season=${season}&grouping=week`, 1);
      const out = {};
      if (j) for (const w in j) {
        const row = j[w];
        if (!row || !row.stats) continue;          // null week = bye or no game
        out[w] = { p: scoreLine(row.stats), o: row.opponent || null, h: row.is_away_team ? 0 : 1 };
      }
      have[id] = out;
    } catch (e) { have[id] = {}; }
    done++;
    if (onProgress && done % 12 === 0) onProgress(done, missing.length);
  };
  const CONC = 12;
  for (let i = 0; i < missing.length; i += CONC) {
    await Promise.all(missing.slice(i, i + CONC).map(fetchOne));
  }
  if (missing.length) { try { await idbSet(key, { t: Date.now(), d: have }); } catch (e) { } }
  return have;
}

/* ================= injury availability =================
   Sleeper's status tag says whether a player is hurt, not for how long. This layer
   answers the second question, so a player back in Week 9 is a Week 9 player rather
   than a zero for the whole season. Three sources, best first:
     1. ESPN's public injury feed, which carries an estimated return date for some players;
     2. the wording of the injury notes (Sleeper's and ESPN's): "4-6 weeks", "season-ending";
     3. a table of typical recovery times by body part and designation.
   Whatever the source, the answer is the same shape: the week he is most likely back,
   and how unsure that is. availability(p, wk) turns that into the chance he plays in
   a given week, and pw() multiplies the weekly projection by it, so every lineup,
   simulation and season outlook reads one set of numbers. */
const ESPN_INJ = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries';
const INJ = { enabled: () => LS.get('injEst', true) !== false };
const WEEK_MS = 7 * 24 * 3600 * 1000;
/* typical games missed once a player is ruled out, by what hurt */
const BODY_WEEKS = {
  hamstring: 3, ankle: 3, 'high ankle': 5, knee: 4, shoulder: 4, groin: 3, calf: 3, foot: 5, back: 3, hip: 3, quadricep: 3, quad: 3,
  rib: 3, ribs: 3, wrist: 3, hand: 4, finger: 2, thumb: 3, elbow: 3, neck: 3, toe: 4, concussion: 2, head: 2, illness: 1, abdomen: 4,
  chest: 3, forearm: 4, 'lower leg': 5, leg: 4, shin: 3, thigh: 3, heel: 3, arm: 4, core: 4, oblique: 3, glute: 3, 'hip flexor': 3,
  achilles: 40, pectoral: 10, bicep: 8, biceps: 8, tricep: 8, triceps: 8, acl: 40, 'torn acl': 40, patella: 10, hernia: 5, 'sports hernia': 5
};
const SEASON_WORDS = /season[- ]ending|out for the (?:season|year|rest)|rest of (?:the )?(?:season|year)|for the year|done for the (?:season|year)|remainder of the (?:season|year)|torn (?:acl|achilles)|ruptured (?:acl|achilles)|\bacl (?:tear|injury)|achilles (?:tear|rupture)/i;
function normName(s) { return String(s || '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '').replace(/[^a-z]/g, ''); }
function phi(z) { return normCdf(z); }

/** What a line of injury commentary says about how long he is out, if anything. */
function injuryHints(text) {
  const t = String(text || '');
  if (!t) return null;
  if (SEASON_WORDS.test(t)) return { season: true };
  let m = /(\d+)\s*(?:-|–|to)\s*(\d+)\s*(?:more\s*)?weeks?/i.exec(t);
  if (m && +m[2] >= +m[1] && +m[2] <= 20) return { weeks: (+m[1] + +m[2]) / 2 };
  m = /(?:miss|out|sidelined|sideline|expected to (?:be out|return)|return|back)[^.]{0,40}?\b(\d+)\s*(?:more\s*)?(?:weeks?|games?)/i.exec(t)
    || /\b(\d+)\s*(?:more\s*)?(?:weeks?|games?)\s*(?:of absence|out|sidelined|away)/i.exec(t);
  if (m && +m[1] > 0 && +m[1] <= 20) return { weeks: +m[1] };
  m = /(?:return|back|available|activated|eligible|target(?:ing)?)[^.]{0,40}?\bweek\s*(\d{1,2})\b/i.exec(t);
  if (m && +m[1] >= 1 && +m[1] <= 22) return { week: +m[1] };
  if (/day[- ]to[- ]day/i.test(t)) return { weeks: 0.5 };
  return null;
}

/** The slate week a calendar date falls in (a return date is a game day). */
function weekOfDate(dateStr) {
  const t = Date.parse(String(dateStr).length <= 10 ? dateStr + 'T12:00:00' : dateStr);
  if (!isFinite(t)) return null;
  const sc = S.nflSched;
  if (sc) {
    let best = null;
    for (const w in sc) {
      let start = Infinity;
      for (const tm in sc[w]) { const d = Date.parse(String(sc[w][tm].date).length <= 10 ? sc[w][tm].date + 'T12:00:00' : sc[w][tm].date); if (isFinite(d) && d < start) start = d; }
      if (!isFinite(start)) continue;
      if (start - 24 * 3600 * 1000 <= t) best = { w: +w, start };
    }
    if (best) return t > best.start + 4.5 * 24 * 3600 * 1000 ? best.w + 1 : best.w;
  }
  const cw = injCurrentWeek();
  return cw + Math.max(0, Math.round((t - Date.now()) / WEEK_MS));
}
/** The next week still to be played — the one an injury is measured from. */
function injCurrentWeek() { return S.liveWeek || (S.lastWeek + 1); }

/** ESPN's feed, tolerant of its shape: team groups holding entries, or a flat list. */
function parseEspnInjuries(j) {
  const byId = {}, byName = {}; let n = 0;
  const take = (e) => {
    if (!e || typeof e !== 'object') return;
    const a = e.athlete || {}, d = e.details || {};
    const rec = {
      id: a.id !== undefined ? String(a.id) : null, name: a.displayName || a.fullName || null,
      status: e.status || (e.type && e.type.description) || null,
      body: d.type || null, loc: d.location || null, side: d.side || null,
      ret: d.returnDate || e.returnDate || null, date: e.date || null,
      short: e.shortComment || null, long: e.longComment || null
    };
    if (!rec.id && !rec.name) return;
    n++;
    if (rec.id) byId[rec.id] = rec;
    if (rec.name) byName[normName(rec.name)] = rec;
  };
  const groups = (j && (j.injuries || j.items)) || [];
  (Array.isArray(groups) ? groups : []).forEach(g => {
    if (g && Array.isArray(g.injuries)) g.injuries.forEach(take); else take(g);
  });
  return { byId, byName, n };
}
async function loadEspnInjuries() {
  const key = 'espninj';
  const rec = await idbGet(key);
  const FRESH = 2 * 3600 * 1000;
  if (rec && Date.now() - rec.t < FRESH && rec.d && rec.d.n) return { d: rec.d, at: rec.t, state: 'ok' };
  try {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctl && ctl.abort(), 8000);
    let j;
    try {
      const r = await fetch(ESPN_INJ, { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      j = await r.json();
    } finally { clearTimeout(timer); }
    const d = parseEspnInjuries(j);
    if (!d.n) throw new Error('empty feed');
    try { await idbSet(key, { t: Date.now(), d }); } catch (e) { }
    return { d, at: Date.now(), state: 'ok' };
  } catch (e) {
    if (rec && rec.d) return { d: rec.d, at: rec.t, state: 'stale', error: String(e.message || e) };
    return { d: null, at: null, state: 'down', error: String(e.message || e) };
  }
}

/** Typical games missed for a body part and designation, plus whether it ends the season. */
function modelWeeks(tag, body, note) {
  const b = String(body || '').toLowerCase().trim();
  let w = BODY_WEEKS[b];
  if (w === undefined) { const k = Object.keys(BODY_WEEKS).find(k => b.includes(k)); w = k ? BODY_WEEKS[k] : 3; }
  const n = String(note || '');
  if (/fracture|broken|surgery|operation|torn|rupture/i.test(n) && w < 6) w = Math.max(w, 6);
  if (tag === 'IR') w = Math.max(w, 4);          // the league minimum for an IR stay
  if (tag === 'PUP') w = Math.max(w, 5);
  return w;
}

/** Build one player's injury profile, or null when there is nothing to estimate. */
function injuryProfile(p, espn) {
  const tag = p.injury;
  if (!tag || tag === 'NA') return null;
  const m = S.players[p.id] || {};
  const cw = injCurrentWeek();
  const body = (m.ib || (espn && espn.body) || '') || null;
  const note = [m.in, espn && espn.long, espn && espn.short].filter(Boolean).join(' ');
  const base = { tag, body, note: m.in || (espn && (espn.short || espn.long)) || null, cw };
  if (tag === 'Questionable') return Object.assign(base, { kind: 'day', pNow: 0.85, pNext: 1, src: 'tag', label: null, text: 'Questionable — listed week to week' });
  if (tag === 'Doubtful') return Object.assign(base, { kind: 'day', pNow: 0.2, pNext: 0.85, src: 'tag', label: null, text: 'Doubtful — unlikely to play this week' });
  if (tag === 'COV') return Object.assign(base, { kind: 'long', R: cw + 1, s: 0.7, src: 'model', text: 'Health and safety protocols — typically a week' });

  const startMs = m.is ? Date.parse(m.is + 'T12:00:00') : (espn && espn.date ? Date.parse(espn.date) : NaN);
  const elapsedWk = isFinite(startMs) ? Math.max(0, (Date.now() - startMs) / WEEK_MS) : null;
  let R = null, s = 1.3, src = 'model', retDate = null, season = false, why = '';

  // 1. ESPN's own return date
  if (espn && espn.ret) {
    const w = weekOfDate(espn.ret);
    if (w !== null) {
      retDate = String(espn.ret).slice(0, 10);
      R = w; s = 0.8; src = 'espn';
      if (R <= cw) { R = cw + 1; s = 1.3; why = 'ESPN’s return date has already passed'; }
    }
  }
  // 2. the wording of the notes
  if (R === null) {
    // words from ESPN count from the day ESPN wrote them; Sleeper's from the day he was hurt
    const eh = espn && injuryHints([espn.long, espn.short].filter(Boolean).join(' '));
    const hint = eh || injuryHints(m.in);
    const hintElapsed = eh && espn.date && isFinite(Date.parse(espn.date)) ? Math.max(0, (Date.now() - Date.parse(espn.date)) / WEEK_MS) : elapsedWk;
    if (hint) {
      if (hint.season) { R = 99; season = true; src = 'note'; s = 0.5; }
      else if (hint.week) { R = Math.max(hint.week, cw + 1); s = 0.9; src = 'note'; }
      else if (hint.weeks) {
        const left = Math.max(1, hint.weeks - (hintElapsed || 0));
        R = cw + Math.max(1, Math.round(left)); s = 1 + Math.min(1, left * 0.1); src = 'note';
      }
    }
  }
  // 3. typical recovery for what hurt
  if (R === null) {
    if (tag === 'Sus') {
      const g = /(\d+)[- ]game/i.exec(note);
      R = cw + (g ? +g[1] : 2); s = g ? 0.6 : 1.5; src = g ? 'note' : 'model';
    } else if (tag === 'DNR') { R = cw + 1; s = 1; }
    else {
      const total = modelWeeks(tag, body, note);
      if (total >= 30) { R = 99; season = true; s = 0.5; }
      else {
        let left = total - (elapsedWk !== null ? elapsedWk : (tag === 'IR' || tag === 'PUP' ? 1 : 0.5));
        let spread = 1.1 + Math.min(1.4, 0.18 * Math.max(0, left));
        if (left < 1) { left = 1; spread = 1.5; why = 'past the usual recovery time'; }
        R = cw + Math.max(1, Math.round(left)); s = spread;
      }
    }
  }
  if (!season && R > 40) { season = true; }
  const seasonEnd = season || R > S.regEnd + 4;
  const wkLabel = seasonEnd ? 'Season' : 'Wk ' + R;
  const srcText = src === 'espn' ? 'ESPN’s estimated return' : src === 'note' ? 'From the injury report wording' : 'Typical for ' + (body ? 'a ' + String(body).toLowerCase() + ' injury' : 'this designation');
  return Object.assign(base, {
    kind: 'long', R: seasonEnd ? 99 : R, s, src, season: seasonEnd, retDate, label: wkLabel,
    short: seasonEnd ? 'S' : String(R), text: srcText + (why ? ' (' + why + ')' : '')
  });
}

/** Chance he plays in week `wk`, given what we know. 1 for a healthy player. */
function availability(p, wk) {
  const j = p && p.inj;
  if (!j || !INJ.enabled()) return 1;
  const cw = j.cw;
  if (wk < cw) return 1;
  if (j.kind === 'day') return wk === cw ? j.pNow : wk === cw + 1 ? j.pNext : 1;
  if (j.season) return 0;
  let a = phi((wk - j.R + 0.5) / j.s);
  a *= 1 - 0.1 * clamp(1 - (wk - j.R), 0, 1);       // a first game back is often a limited one
  return a < 0.02 ? 0 : a > 0.995 ? 1 : a;
}
/** Expected share of the regular season still to play that he is available for. */
function availRest(p) {
  const cw = injCurrentWeek(); let n = 0, tot = 0;
  for (let k = cw; k <= S.regEnd; k++) { tot += availability(p, k); n++; }
  return n ? tot / n : 1;
}
/** Expected games he misses between now and the end of the regular season. */
function gamesMissed(p) {
  const cw = injCurrentWeek(); let miss = 0;
  for (let k = cw; k <= S.regEnd; k++) if (!onBye(p, k)) miss += 1 - availability(p, k);
  return miss;
}

/** Fold one player's injury profile into his projection. `ctx` carries the feed, the
 *  on/off choice and the current week so the loop and lazy callers share one path. */
function availOne(p, ctx) {
  ctx = ctx || availCtx();
  if (!p || p.pos === 'PICK') return;
  if (!p.injury || p.injury === 'NA') { p.inj = null; if (p.ppgLegacy !== undefined) p.ppg = p.ppgLegacy; p.flat = undefined; p.injFactor = 1; return; }
  const m = S.players[p.id] || {};
  let e = null;
  if (ctx.feed) { e = (m.e && ctx.feed.byId[String(m.e)]) || ctx.feed.byName[normName(p.name)] || null; }
  p.inj = injuryProfile(p, e);
  if (p.inj) { p.inj.espn = !!e; p.inj.feed = e || null; }
  if (p.ppgLegacy === undefined) p.ppgLegacy = p.ppg;
  if (!ctx.on || !p.inj || ctx.cw > S.regEnd + 4) { p.ppg = p.ppgLegacy; p.flat = undefined; p.injFactor = 1; return e; }
  if (p.wk) {
    const lines = [];
    for (let k = Math.max(1, S.lastWeek + 1); k <= S.regEnd; k++) if (p.wk[k]) lines.push(p.wk[k].p * availability(p, k));
    if (lines.length) p.ppg = mean(lines);
    else { const all = []; for (let k = 1; k <= 18; k++) if (p.wk[k]) all.push(p.wk[k].p); p.ppg = mean(all) * availRest(p); }
    p.flat = undefined;
  } else {
    p.flat = p.ppgHealthy !== undefined ? p.ppgHealthy : p.ppgLegacy;
    p.ppg = p.flat * availRest(p);
  }
  p.vol = volFromMean(p.pos, p.ppg);
  p.injFactor = 1 - 0.3 * (1 - availRest(p));
  return e;
}
function availCtx() { return { feed: S.espnInj && S.espnInj.d, on: INJ.enabled(), cw: injCurrentWeek() }; }
/** Run every flagged player through availOne. Safe to repeat: baselines are stored. */
function applyAvailability() {
  const ctx = availCtx();
  let flagged = 0, matched = 0;
  for (const id in S.index) {
    const p = S.index[id];
    if (!p || p.pos === 'PICK') continue;
    if (p.injury && p.injury !== 'NA') flagged++;
    const e = availOne(p, ctx);
    if (e) matched++;
    else if (p.inj && p.inj.espn) matched++;
  }
  S.injFeedInfo = {
    state: S.espnInj ? S.espnInj.state : 'off', at: S.espnInj ? S.espnInj.at : null, error: S.espnInj ? S.espnInj.error : null,
    listed: ctx.feed ? ctx.feed.n : 0, flagged, matched
  };
  applyValueMode();
}

/* ================= draft pick pricing =================
   A pick's worth is set by where it lands, and where it lands is set by how the
   team that owns the slot finishes. FantasyCalc publishes Early/Mid/Late only for
   the next rookie draft and a single blended value for the years after it, so the
   tier *shape* is lifted from the year that has it and damped for later years,
   where nobody can really call the order. */
function buildPickCurves() {
  const V = S.pickVals || {};
  const seasons = new Set(), rounds = new Set();
  Object.keys(V).forEach(k => {
    const p = k.split('|');
    if (/^slot/.test(p[2])) return;
    seasons.add(+p[0]); rounds.add(+p[1]);
  });
  // per round, the nearest season that publishes a full Early/Mid/Late set
  const ref = {};
  const seasonList = Array.from(seasons).sort((a, b) => a - b);
  Array.from(rounds).forEach(r => {
    const y = seasonList.find(y => V[`${y}|${r}|Early`] !== undefined && V[`${y}|${r}|Mid`] !== undefined && V[`${y}|${r}|Late`] !== undefined);
    if (y === undefined) return;
    const M = V[`${y}|${r}|Mid`], P = V[`${y}|${r}|Any`];
    ref[r] = { season: y, rE: V[`${y}|${r}|Early`] / M, rL: V[`${y}|${r}|Late`] / M, mOverPlain: P ? M / P : 1 };
  });
  const curves = {};
  seasonList.forEach(y => rounds.forEach(r => {
    const key = y + '|' + r;
    const E = V[`${y}|${r}|Early`], M = V[`${y}|${r}|Mid`], L = V[`${y}|${r}|Late`];
    if (E !== undefined && M !== undefined && L !== undefined) { curves[key] = { E, M, L, published: true }; return; }
    const P = V[`${y}|${r}|Any`], R = ref[r];
    if (P === undefined) return;
    if (!R) { curves[key] = { E: P, M: P, L: P, published: false, flat: true }; return; }
    const gap = Math.max(0, y - R.season);
    const shrink = clamp(1 - 0.3 * gap, 0.35, 1);
    const Mest = P * R.mOverPlain;
    curves[key] = {
      E: Mest * (1 + (R.rE - 1) * shrink),
      M: Mest,
      L: Mest * (1 - (1 - R.rL) * shrink),
      published: false
    };
  }));
  S.pickCurves = curves;
  return curves;
}
/** Draft slot a team picks at, given its projected finish (1 = best record).
 *  Accepts a fractional rank, since expected finish is continuous. */
function slotForRank(projRank, nTeams) {
  const N = Math.max(2, nTeams || S.cfg.actualTeams || 12);
  return clamp(N - projRank + 1, 1, N);
}
function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}
/* How strongly roster strength predicts final standing. Nowhere near 1: fantasy
   seasons are noisy, and they get noisier the further out you look. Keeping this
   below 1 is what stops one signing from swinging a pick from 1.09 to 1.02. */
function finishRho(yearsOut) { return clamp(0.62 - 0.13 * Math.max(0, yearsOut - 1), 0.28, 0.62); }
/** Expected finishing position (1 = best) for a team at strength z-score `z`. */
function expectedFinish(z, nTeams, rho) {
  return 1 + normCdf(-rho * z) * (Math.max(2, nTeams) - 1);
}
function tierWordForSlot(slot, nTeams) {
  const N = Math.max(2, nTeams || S.cfg.actualTeams || 12);
  const q = (slot - 0.5) / N;
  return q <= 1 / 3 ? 'Early' : q <= 2 / 3 ? 'Mid' : 'Late';
}
/** Continuous value for a pick landing at `slot` of `nTeams`. */
function pickValueAtSlot(season, round, slot, nTeams) {
  const c = (S.pickCurves || {})[season + '|' + round];
  if (!c) return pickValue(season, round, tierWordForSlot(slot, nTeams));
  const N = Math.max(2, nTeams || S.cfg.actualTeams || 12);
  const q = clamp((slot - 0.5) / N, 0, 1);
  const qE = 1 / 6, qM = 0.5, qL = 5 / 6;
  let v;
  if (q <= qE) {
    // the very top of a draft is worth more than the Early average; bounded so it cannot run away
    const t = (qE - q) / qE;
    v = Math.min(c.E + (c.E - c.M) * t * 0.9, c.E * 1.35);
  } else if (q <= qM) {
    v = c.E + (c.M - c.E) * (q - qE) / (qM - qE);
  } else if (q <= qL) {
    v = c.M + (c.L - c.M) * (q - qM) / (qL - qM);
  } else {
    const t = (q - qL) / (1 - qL);
    v = Math.max(c.L + (c.L - c.M) * t * 0.9, c.L * 0.72);
  }
  return Math.max(1, Math.round(v));
}
/** How much a pick season leans on where a roster is heading rather than where it is. */
function futureWeightFor(season) {
  const yearsOut = Math.max(0, (season || 0) - (S.season || new Date().getFullYear()));
  return clamp(0.25 + 0.25 * yearsOut, 0.25, 1);
}
/** Expected finishing positions for the season a pick lands in — continuous, and
 *  shrunk toward mid-table because strength only partly predicts where you land. */
function finishRanksFor(season, nowArr, futArr) {
  const w = futureWeightFor(season);
  const yearsOut = Math.max(0, (season || 0) - (S.season || new Date().getFullYear()));
  const rho = finishRho(yearsOut);
  const N = S.cfg.actualTeams || nowArr.length;
  const zN = zscores(nowArr), zF = zscores(futArr);
  return nowArr.map((_, i) => expectedFinish((1 - w) * zN[i] + w * zF[i], N, rho));
}
/** A pricer closed over one league state. Pass per-team {now, futureRoster}
 *  overrides to price picks under a hypothetical post-trade league. */
function pickPricer(overrides) {
  const teams = S.teams;
  const idx = {}; teams.forEach((t, i) => idx[t.rosterId] = i);
  const nowArr = teams.map(t => (overrides && overrides[t.rosterId]) ? overrides[t.rosterId].now : t.now);
  const futArr = teams.map(t => (overrides && overrides[t.rosterId]) ? overrides[t.rosterId].futureRoster : t.futureRoster);
  const cache = {};
  const N = S.cfg.actualTeams || teams.length;
  return function price(pk) {
    const y = pk.season;
    if (!cache[y]) cache[y] = finishRanksFor(y, nowArr, futArr);
    const i = idx[pk.origRosterId];
    const rank = i === undefined ? (teams.length + 1) / 2 : cache[y][i];
    const slot = slotForRank(rank, N);
    return {
      value: pickValueAtSlot(y, pk.round, slot, N),
      slot: Math.round(slot), slotExact: slot, rank: rank,
      tier: tierWordForSlot(slot, N)
    };
  };
}
