"use strict";
/* ================= league loading ================= */
const SLOT_ELIG = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'], DST: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], REC_FLEX: ['WR', 'TE'],
  WRRB_WRT: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  DL: ['DL', 'DE', 'DT'], LB: ['LB'], DB: ['DB', 'CB', 'S', 'SS', 'FS'],
  IDP_FLEX: ['DL', 'LB', 'DB', 'DE', 'DT', 'CB', 'S', 'SS', 'FS']
};
const SLOT_LABEL = { SUPER_FLEX: 'SFLX', WRRB_FLEX: 'W/R', REC_FLEX: 'W/T', WRRB_WRT: 'FLEX', IDP_FLEX: 'IDP', DST: 'DEF' };

function teamShort(rid) { const t = S.teams.find(t => t.rosterId === rid); return t ? t.short : null; }

async function loadLeague(leagueId, onStep) {
  const step = onStep || (() => { });
  step('Reading league settings…', 0.05);
  const league = await sl('/league/' + leagueId);
  if (!league) throw new Error('No league found with ID ' + leagueId + '. Check the 18-digit ID in your Sleeper league URL.');
  S.league = league; S.leagueId = leagueId;
  S.cfg = detectFormat(league);
  // settled before anything is priced, because it decides what "value" means
  S.detected = detectLeagueType(league);
  S.dynasty = (leagueTypeChoice() === 'auto' ? S.detected : leagueTypeChoice()) === 'dynasty';

  step('Loading NFL week…', 0.1);
  S.state = await sl('/state/nfl');
  const season = +(league.season || S.state.season);
  S.season = season;
  const isCurrent = String(season) === String(S.state.season);
  S.week = isCurrent ? (S.state.week || 1) : 18;
  S.regEnd = (league.settings && league.settings.playoff_week_start ? league.settings.playoff_week_start - 1 : 14);

  step('Loading rosters & managers…', 0.18);
  const [users, rosters, drafts, tradedPicks] = await Promise.all([
    sl(`/league/${leagueId}/users`), sl(`/league/${leagueId}/rosters`),
    sl(`/league/${leagueId}/drafts`), sl(`/league/${leagueId}/traded_picks`)
  ]);
  S.users = users || []; S.rosters = rosters || []; S.drafts = drafts || []; S.tradedPicks = tradedPicks || [];

  step('Loading player database…', 0.3);
  S.players = await loadSleeperPlayers();
  // ESPN's injury report loads alongside everything else and is allowed to fail
  const espnLoad = loadEspnInjuries().catch(e => ({ d: null, at: null, state: 'down', error: String(e && e.message || e) }));

  step('Loading ' + valueWord() + ' trade values…', 0.52);
  S.values = await loadValues(S.cfg);
  S.redraftApi = await loadRedraftValues(S.cfg);
  S.index = buildIndex(); S._sig = null; S._tl = null;
  if (isDynasty()) buildPickCurves();

  step('Loading weekly matchups…', 0.66);
  const weeks = [];
  for (let w = 1; w <= S.regEnd + 4; w++) weeks.push(w);
  const results = await Promise.all(weeks.map(w => sl(`/league/${leagueId}/matchups/${w}`).catch(() => null)));
  S.matchups = {}; weeks.forEach((w, i) => { if (results[i] && results[i].length) S.matchups[w] = results[i]; });
  // the NFL's own game statuses, so a week that is underway is not mistaken for
  // a finished one the moment the Thursday game ends
  S.nflSched = await loadNflSchedule(S.season);
  S.lastWeek = 0;
  for (let w = 1; w <= S.regEnd; w++) {
    const m = S.matchups[w];
    if (m && m.some(x => (x.points || 0) > 0) && weekFinished(w)) S.lastWeek = w;
  }
  // the week in progress: started, not finished, and the first such week left
  S.liveWeek = null;
  for (let w = S.lastWeek + 1; w <= S.regEnd; w++) {
    if (weekStarted(w) && !weekFinished(w)) { S.liveWeek = w; break; }
    if (weekStarted(w)) continue;
    break;
  }
  // kickoff times and live quarters for the week being played
  S.weekScores = {};
  if (S.liveWeek) await ensureWeekScores(S.liveWeek);

  step('Loading drafts…', 0.82);
  S.draftPicks = {}; S.draftMeta = {};
  for (const d of S.drafts) {
    try {
      const [meta, picks] = await Promise.all([sl('/draft/' + d.draft_id), sl(`/draft/${d.draft_id}/picks`)]);
      S.draftMeta[d.draft_id] = meta || d; S.draftPicks[d.draft_id] = picks || [];
    } catch (e) { S.draftPicks[d.draft_id] = []; }
  }

  step('Loading transactions…', 0.86);
  // all 18 legs, not just the played ones — trades land in the offseason too
  const txWeeks = [];
  for (let w = 1; w <= 18; w++) txWeeks.push(w);
  const txs = await Promise.all(txWeeks.map(w => sl(`/league/${leagueId}/transactions/${w}`).catch(() => [])));
  S.transactions = [].concat(...txs.map((x, i) => (x || []).map(t => Object.assign({ _week: txWeeks[i] }, t))));

  buildTeams();
  step('Loading weekly projections…', 0.88);
  const rosteredIds = Array.from(new Set([].concat.apply([], S.teams.map(t => t.players.map(p => p.id)))));
  try {
    S.wproj = await loadWeeklyProjections(rosteredIds, S.season,
      (d, n) => step(`Loading weekly projections… ${d}/${n}`, 0.88 + 0.1 * (d / n)));
  } catch (e) { S.wproj = {}; }
  applyProjections();
  S.espnInj = await espnLoad;
  applyAvailability();

  step('Building models…', 0.99);
  computeStrength();
  recordSnapshot();
  step('Ready', 1);
}

function buildTeams() {
  const cfg = S.cfg;
  const userById = {}; S.users.forEach(u => userById[u.user_id] = u);
  const rounds = draftRounds();
  const curRookieSeason = rookieSeasonForNow();

  // pick ownership: default self, then apply trades
  const seasons = [];
  for (let y = curRookieSeason; y < curRookieSeason + 4; y++) seasons.push(y);
  const ownerOf = {}; // key season|round|origRosterId -> current rosterId
  S.rosters.forEach(r => seasons.forEach(y => { for (let rd = 1; rd <= rounds; rd++) ownerOf[`${y}|${rd}|${r.roster_id}`] = r.roster_id; }));
  (S.tradedPicks || []).forEach(tp => {
    const k = `${tp.season}|${tp.round}|${tp.roster_id}`;
    if (ownerOf[k] !== undefined) ownerOf[k] = tp.owner_id;
  });
  // has the current-season rookie draft already happened?
  const rookieDone = S.drafts.some(d => String(d.season) === String(curRookieSeason) && d.status === 'complete');

  // A player belongs to exactly one roster. Enforcing that here keeps the
  // ownership map a faithful description of the league, which is what the
  // hypothetical sandbox rebuilds from.
  const claimed = new Set();
  S.teams = S.rosters.map(r => {
    const u = userById[r.owner_id] || {};
    const meta = u.metadata || {};
    const st = r.settings || {};
    const teamName = meta.team_name || u.display_name || ('Team ' + r.roster_id);
    const userName = u.display_name || meta.team_name || ('Team ' + r.roster_id);
    const ids = [];
    (r.players || []).forEach(x => { const id = String(x); if (claimed.has(id)) return; claimed.add(id); ids.push(id); });
    const players = ids.map(id => ensurePlayer(id));
    const taxi = new Set((r.taxi || []).map(String));
    const ir = new Set((r.reserve || []).map(String));
    const team = {
      rosterId: r.roster_id, ownerId: r.owner_id, teamName, userName,
      avatar: meta.avatar || (u.avatar ? 'https://sleepercdn.com/avatars/thumbs/' + u.avatar : null),
      players, taxi, ir, division: st.division || null,
      wins: st.wins || 0, losses: st.losses || 0, ties: st.ties || 0,
      fpts: (st.fpts || 0) + (st.fpts_decimal || 0) / 100,
      fptsAgainst: (st.fpts_against || 0) + (st.fpts_against_decimal || 0) / 100,
      maxPts: (st.ppts || 0) + (st.ppts_decimal || 0) / 100,
      waiver: st.waiver_budget_used || 0,
      picks: []
    };
    // `name` is read in a few hundred places; making it an accessor is what lets
    // the username toggle flip every one of them without a reload. `owner` is
    // the subtitle, so it always carries whichever name is not the headline.
    Object.defineProperty(team, 'name', { enumerable: true, get: () => useUsernames() ? team.userName : team.teamName });
    Object.defineProperty(team, 'owner', { enumerable: true, get: () => useUsernames() ? team.teamName : team.userName });
    Object.defineProperty(team, 'short', {
      enumerable: true, get: () => {
        const n = team.name;
        S._short = S._short || {};
        if (S._short[n] === undefined) S._short[n] = abbrev(n, 'T' + team.rosterId);
        return S._short[n];
      }
    });
    return team;
  });
  const byId = {}; S.teams.forEach(t => byId[t.rosterId] = t);
  S.teamById = byId;

  // A redraft league's rosters do not carry future picks: next spring every team
  // starts from nothing and drafts again, so there is no asset here to hold.
  if (isDynasty()) {
    for (const k in ownerOf) {
      const [season, round, orig] = k.split('|');
      if (rookieDone && +season === curRookieSeason) continue;
      const t = byId[ownerOf[k]]; if (!t) continue;
      t.picks.push({ season: +season, round: +round, origRosterId: +orig, rosterId: ownerOf[k] });
    }
  }
  S.teams.forEach(t => t.picks.sort((a, b) => a.season - b.season || a.round - b.round || a.origRosterId - b.origRosterId));
  captureBaseline();
}
/* The league exactly as Sleeper reports it. The hypothetical sandbox rebuilds
   every roster from this plus a set of ownership overrides, so it can always
   return to the truth without refetching. */
function pickKey(pk) { return pk.season + '|' + pk.round + '|' + pk.origRosterId; }
function captureBaseline() {
  const own = {}, pickOwn = {}, allPicks = [], order = [];
  S.teams.forEach(t => {
    t.players.forEach(p => { own[p.id] = t.rosterId; order.push(p.id); });
    t.picks.forEach(pk => { pickOwn[pickKey(pk)] = t.rosterId; allPicks.push(pk); });
    t.baseTaxi = new Set(t.taxi); t.baseIr = new Set(t.ir);
  });
  // `order` matters: object keys iterate numeric-first, which would silently
  // reshuffle rosters and flip lineup tie-breaks on every rebuild.
  S.base = { own, pickOwn, picks: allPicks, order };
}
/** Rebuild every roster from the baseline plus `moves` / `pickMoves`
 *  (playerId -> rosterId, or null to drop), then recompute the whole model. */
function applyOwnership(moves, pickMoves) {
  if (!S.base) return;
  const own = Object.assign({}, S.base.own);
  for (const id in (moves || {})) {
    if (moves[id] === null || moves[id] === undefined) delete own[id]; else own[id] = moves[id];
  }
  const pickOwn = Object.assign({}, S.base.pickOwn);
  for (const k in (pickMoves || {})) {
    if (pickMoves[k] === null || pickMoves[k] === undefined) delete pickOwn[k]; else pickOwn[k] = pickMoves[k];
  }
  const byTeam = {}; S.teams.forEach(t => byTeam[t.rosterId] = []);
  const place = (id) => { const arr = byTeam[own[id]]; if (arr) arr.push(ensurePlayer(id)); };
  const seen = new Set();
  (S.base.order || []).forEach(id => { if (own[id] !== undefined) { seen.add(id); place(id); } });
  Object.keys(own).forEach(id => { if (!seen.has(id)) place(id); });
  S.teams.forEach(t => {
    t.players = byTeam[t.rosterId] || [];
    // a designation belongs to the roster spot, not the player — it does not travel
    t.taxi = new Set(Array.from(t.baseTaxi).filter(id => own[id] === t.rosterId));
    t.ir = new Set(Array.from(t.baseIr).filter(id => own[id] === t.rosterId));
    t.picks = S.base.picks.filter(pk => pickOwn[pickKey(pk)] === t.rosterId)
      .map(pk => Object.assign({}, pk, { rosterId: t.rosterId }));
  });
  computeStrength();
  S._fa = null; S._depth = null; S._sig = null;
  S.sim = null; SimUI.res = null; SimUI.replay = null; FinderUI.results = null; TradeUI.result = null;
}
function draftRounds() {
  const rookie = S.drafts.filter(d => d.type !== 'snake_startup' && (d.settings || {}).rounds && d.settings.rounds <= 8);
  if (rookie.length) return Math.max(...rookie.map(d => d.settings.rounds));
  const s = (S.league.settings || {});
  return s.draft_rounds && s.draft_rounds <= 8 ? s.draft_rounds : 4;
}
function rookieSeasonForNow() {
  const y = +(S.state && S.state.season ? S.state.season : new Date().getFullYear());
  return y;
}

/* ================= lineup optimizer ================= */
function optimalLineup(players, key) {
  const get = typeof key === 'function' ? key : (p) => (p[key] || 0);
  const rp = (S.cfg.rosterPositions || []).filter(p => !['BN', 'IR', 'TAXI'].includes(p));
  const pool = players.slice().sort((a, b) => get(b) - get(a));
  const used = new Set();
  const slots = rp.map((s, i) => ({ slot: s, i, elig: SLOT_ELIG[s] || [s], n: (SLOT_ELIG[s] || [s]).length }));
  slots.sort((a, b) => a.n - b.n || a.i - b.i);
  const out = [];
  for (const s of slots) {
    let best = null;
    for (const p of pool) { if (used.has(p.id)) continue; if (s.elig.includes(p.pos)) { best = p; break; } }
    if (best) used.add(best.id);
    out.push({ slot: s.slot, i: s.i, player: best });
  }
  out.sort((a, b) => a.i - b.i);
  return out;
}
function lineupPoints(players, key) {
  const get = typeof key === 'function' ? key : (p) => (p[key] || 0);
  return sum(optimalLineup(players, key).map(s => s.player ? get(s.player) : 0));
}

/* ---------- weekly projection accessors ---------- */
/** Projected points for one player in one week. A player with projection data but
 *  no entry for that week is on bye, and scores nothing. */
function pw(p, wk) {
  const a = p && p.inj ? availability(p, wk) : 1;
  if (p && p.wk) { const r = p.wk[wk]; return r ? r.p * a : 0; }
  return p ? (p.flat !== undefined ? p.flat : (p.ppg || 0)) * a : 0;
}
function pwOpp(p, wk) { const r = p && p.wk && p.wk[wk]; return r ? r.o : null; }
/* A manager never actually starts a player on bye — they stream someone. This is
   what an off-the-wire replacement is worth, so bye weeks cost depth, not the world. */
const STREAM = { QB: 12.0, RB: 6.2, WR: 6.4, TE: 4.4, K: 7.4, DEF: 6.0 };
function applyProjections() {
  const wp = S.wproj || {};
  let covered = 0, total = 0;
  for (const id in S.index) {
    const p = S.index[id]; total++;
    const w = wp[id];
    p.wk = null;
    if (!w) continue;
    const all = [];
    for (let k = 1; k <= 18; k++) if (w[k]) all.push(w[k].p);
    if (!all.length) continue;
    p.wk = w; covered++;
    p.projSeason = sum(all);
    p.projGames = all.length;
    const rest = [];
    for (let k = Math.max(1, S.lastWeek + 1); k <= S.regEnd; k++) if (w[k]) rest.push(w[k].p);
    p.ppg = rest.length ? mean(rest) : mean(all);
    // in a redraft league the two timelines are the same one, so the future
    // projection has to follow the real weekly lines rather than the value curve
    if (!isDynasty()) p.fppg = p.ppg;
    p.vol = volFromMean(p.pos, p.ppg);
    p.projSource = 'sleeper';
    // a week with no line is a bye only if his team is genuinely off; a player
    // who is not expected to play has no line either
    p.byeWeeks = [];
    for (let k = 1; k <= 18; k++) if (onBye(p, k)) p.byeWeeks.push(k);
  }
  S.projCoverage = { covered: covered, total: total };
}
function activePlayers(t) { return t.players.filter(p => !t.taxi.has(p.id) && !t.ir.has(p.id)); }
/** Players parked in an IR slot who should be back, and activated, by week `wk`.
 *  A manager moves them as soon as they can play, so a projection that ignores
 *  them undersells every team with a star due back. */
function withReturners(list, t, wk) {
  if (!INJ.enabled() || wk <= injCurrentWeek() || !t || !t.ir) return list;
  const have = new Set(list.map(p => p.id));
  const extra = t.players.filter(p => t.ir.has(p.id) && !have.has(p.id) && p.inj && availability(p, wk) >= 0.5);
  return extra.length ? list.concat(extra) : list;
}

/* ================= strength & power ================= */
function computeStrength() {
  const teams = S.teams;
  const n = teams.length;
  if (isDynasty() && !S.pickCurves) buildPickCurves();

  // Pass 1 — roster strength only. Pick capital is deliberately left out here:
  // a pick's value depends on the projected finish, which depends on strength,
  // so strength has to be settled before picks can be priced.
  const dyn = isDynasty();
  teams.forEach(t => {
    t.now = lineupPoints(activePlayers(t), 'ppg');
    // with no next season there is no separate future to project: the two
    // timelines are the same one, so every "future" metric collapses onto now
    t.futureRoster = dyn ? lineupPoints(t.players, 'fppg') : t.now;
    t.starters = optimalLineup(activePlayers(t), 'ppg');
    t.starterIds = new Set(t.starters.filter(s => s.player).map(s => s.player.id));
    const ages = t.players.filter(p => POS4.includes(p.pos) && p.age && (p.dv || 0) > 300);
    t.age = ages.length ? sum(ages.map(p => p.age * p.dv)) / sum(ages.map(p => p.dv)) : null;
    t.posValue = {};
    POS4.forEach(pos => { t.posValue[pos] = sum(t.players.filter(p => p.pos === pos).map(p => p.dv || 0)); });
    t.posNow = {};
    POS4.forEach(pos => {
      const st = t.starters.filter(s => s.player && s.player.pos === pos);
      t.posNow[pos] = sum(st.map(s => s.player.ppg));
    });
  });

  // Pass 2 — price every pick off the projected finish of the team that owns its slot.
  const price = dyn ? pickPricer(null) : null;
  teams.forEach(t => {
    t.pickAssets = !dyn ? [] : t.picks.map(pk => {
      const q = price(pk);
      const label = pickLabel(pk);
      return Object.assign({}, pk, {
        tier: q.tier, slot: q.slot, ownerRank: q.rank, value: q.value, label,
        slotLabel: pk.round + '.' + String(q.slot).padStart(2, '0'),
        id: 'PK|' + pk.season + '|' + pk.round + '|' + pk.origRosterId,
        pos: 'PICK', name: label, dv: q.value, rv: 0
      });
    });
    t.pickCapital = sum(t.pickAssets.map(p => p.value));
    t.rosterValue = sum(activePlayers(t).map(p => p.dv || 0)) + sum(t.players.filter(p => t.taxi.has(p.id)).map(p => p.dv || 0));
    t.totalValue = t.rosterValue + t.pickCapital;
    t.future = t.futureRoster + t.pickCapital / 620;
  });
  if (!dyn) teams.forEach(t => { t.future = t.now; });

  // ---- actual performance so far ----
  const wk = S.lastWeek;
  teams.forEach(t => { t.weekly = []; t.oppWeekly = []; });
  for (let w = 1; w <= wk; w++) {
    const ms = S.matchups[w] || [];
    const byRoster = {}; ms.forEach(m => byRoster[m.roster_id] = m);
    teams.forEach(t => { const m = byRoster[t.rosterId]; t.weekly.push(m ? (m.points || 0) : null); });
    const groups = {};
    ms.forEach(m => { if (m.matchup_id) (groups[m.matchup_id] = groups[m.matchup_id] || []).push(m); });
    for (const g in groups) {
      const [a, b] = groups[g]; if (!a || !b) continue;
      const ta = S.teamById[a.roster_id], tb = S.teamById[b.roster_id];
      if (ta) ta.oppWeekly.push(b.points || 0); if (tb) tb.oppWeekly.push(a.points || 0);
    }
  }
  teams.forEach(t => {
    const s = t.weekly.filter(x => x !== null && x > 0);
    t.avgPts = mean(s); t.ptsSd = sd_(s); t.gp = s.length;
    t.recent = s.length >= 3 ? mean(s.slice(-3)) : t.avgPts;
  });
  // all-play record
  teams.forEach(t => { t.apW = 0; t.apL = 0; });
  for (let w = 0; w < wk; w++) {
    const scores = teams.map(t => t.weekly[w]).filter(x => x !== null && x > 0);
    if (scores.length < 2) continue;
    teams.forEach(t => {
      const v = t.weekly[w]; if (v === null || v <= 0) return;
      teams.forEach(o => { if (o === t) return; const ov = o.weekly[w]; if (ov === null || ov <= 0) return; if (v > ov) t.apW++; else if (v < ov) t.apL++; });
    });
  }
  teams.forEach(t => {
    t.allPlay = (t.apW + t.apL) ? t.apW / (t.apW + t.apL) : null;
    t.winPct = (t.wins + t.losses + t.ties) ? (t.wins + 0.5 * t.ties) / (t.wins + t.losses + t.ties) : null;
    t.expWins = t.allPlay !== null ? t.allPlay * (t.wins + t.losses + t.ties) : null;
    t.luck = t.expWins !== null ? (t.wins + 0.5 * t.ties) - t.expWins : null;
  });

  // ---- blended power ----
  const gp = teams.length ? Math.max(...teams.map(t => t.gp || 0)) : 0;
  const wActual = clamp(gp / 9, 0, 0.62);
  S.blendW = wActual; S.gamesPlayed = gp;
  const zProj = zscores(teams.map(t => t.now));
  const zAvg = gp ? zscores(teams.map(t => t.avgPts || 0)) : teams.map(() => 0);
  const zAP = gp ? zscores(teams.map(t => t.allPlay === null ? 0.5 : t.allPlay)) : teams.map(() => 0);
  const zRec = gp >= 3 ? zscores(teams.map(t => t.recent || 0)) : zAvg;
  const zFut = zscores(teams.map(t => t.future));
  teams.forEach((t, i) => {
    const actual = 0.45 * zAvg[i] + 0.32 * zAP[i] + 0.23 * zRec[i];
    t.powerZ = (1 - wActual) * zProj[i] + wActual * actual;
    t.projZ = zProj[i]; t.actualZ = gp ? actual : null; t.futureZ = zFut[i];
    t.power = 50 + 15 * t.powerZ;
    t.futurePower = 50 + 15 * zFut[i];
    t.contendZ = t.powerZ; // alias
  });
  const pr = rankOf(teams.map(t => t.power)); teams.forEach((t, i) => t.powerRank = pr[i]);
  const fr = rankOf(teams.map(t => t.futurePower)); teams.forEach((t, i) => t.futureRank = fr[i]);
  const vr = rankOf(teams.map(t => t.totalValue)); teams.forEach((t, i) => t.valueRank = vr[i]);
  POS4.forEach(pos => {
    const r = rankOf(teams.map(t => t.posValue[pos]));
    const rn = rankOf(teams.map(t => t.posNow[pos]));
    teams.forEach((t, i) => { t.posValue[pos + 'Rank'] = r[i]; t.posNow[pos + 'Rank'] = rn[i]; });
  });
  // window classification — contend-or-rebuild is a question about next year, so
  // a redraft league does not have one and gets no label rather than a wrong one
  teams.forEach(t => {
    if (!dyn) { t.window = null; return; }
    const c = t.powerZ, f = t.futureZ;
    t.window = c > 0.35 && f > -0.3 ? 'Contend'
      : c > 0.35 ? 'Win-now'
        : f > 0.45 ? 'Ascending'
          : c < -0.45 && f < -0.1 ? 'Rebuild'
            : c < -0.35 ? 'Retool' : 'Fringe';
  });
}

/* ================= schedule ================= */
function schedule() {
  if (S._sched) return S._sched;
  const out = [];
  for (let w = 1; w <= S.regEnd; w++) {
    const ms = S.matchups[w];
    const games = [];
    if (ms) {
      const g = {};
      ms.forEach(m => { if (m.matchup_id !== null && m.matchup_id !== undefined) (g[m.matchup_id] = g[m.matchup_id] || []).push(m.roster_id); });
      for (const k in g) if (g[k].length === 2) games.push(g[k]);
    }
    out.push(games);
  }
  // synthetic round-robin fallback for any week Sleeper gave us nothing for
  const ids = S.teams.map(t => t.rosterId);
  if (ids.length % 2 === 0) {
    for (let w = 0; w < out.length; w++) {
      if (out[w].length) continue;
      const rot = ids.slice(1); const k = w % rot.length;
      const arr = [ids[0]].concat(rot.slice(k), rot.slice(0, k));
      const g = [];
      for (let i = 0; i < arr.length / 2; i++) g.push([arr[i], arr[arr.length - 1 - i]]);
      out[w] = g;
    }
  }
  S._sched = out; return out;
}

