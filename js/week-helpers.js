"use strict";
/* ==================================================================
   Live week — actual points where the games are finished, projections
   where they are not.
   ================================================================== */

/* Sleeper publishes the NFL schedule with a status per game. Without it there is
   no honest way to tell "scored zero" from "has not kicked off yet". */
async function loadNflSchedule(season) {
  const key = 'nflsched:' + season;
  const rec = await idbGet(key);
  const FRESH = 8 * 60 * 1000;          // statuses move during a game day
  if (rec && Date.now() - rec.t < FRESH && rec.d) return rec.d;
  try {
    const j = await getJSON('https://api.sleeper.app/schedule/nfl/regular/' + season, 2);
    if (!Array.isArray(j) || !j.length) return (rec && rec.d) || null;
    const out = {};
    j.forEach(g => {
      const w = +g.week; if (!w) return;
      out[w] = out[w] || {};
      if (g.home) out[w][g.home] = { status: g.status, date: g.date, opp: g.away, home: true };
      if (g.away) out[w][g.away] = { status: g.status, date: g.date, opp: g.home, home: false };
    });
    await idbSet(key, { t: Date.now(), d: out });
    return out;
  } catch (e) { return (rec && rec.d) || null; }
}
/* The per-week scores feed carries what the season schedule does not: a real
   kickoff time and a live quarter. That is what makes slates and in-game
   proration possible. */
async function loadWeekScores(season, week) {
  const key = 'nflscores:' + season + ':' + week;
  const rec = await idbGet(key);
  const FRESH = 3 * 60 * 1000;
  if (rec && Date.now() - rec.t < FRESH && rec.d) return rec.d;
  try {
    const j = await getJSON(`https://api.sleeper.app/scores/nfl/regular/${season}/${week}`, 2);
    if (!Array.isArray(j) || !j.length) return (rec && rec.d) || null;
    const games = j.map(g => {
      const m = g.metadata || {};
      const q = m.quarter_num !== undefined && m.quarter_num !== null ? +m.quarter_num : null;
      return {
        id: g.game_id, start: g.start_time || (m.date_time ? Date.parse(m.date_time) : null),
        status: g.status, home: m.home_team, away: m.away_team,
        over: !!m.is_over || GAME_OVER[g.status] === 1,
        inProgress: !!m.is_in_progress, started: !!m.has_started,
        quarter: m.quarter || null, quarterNum: q
      };
    }).filter(g => g.home && g.away);
    const out = { games: games, byTeam: {} };
    games.forEach(g => { out.byTeam[g.home] = g; out.byTeam[g.away] = g; });
    await idbSet(key, { t: Date.now(), d: out });
    return out;
  } catch (e) { return (rec && rec.d) || null; }
}
/** Pull the scores feed for a week if it is not already in hand. */
async function ensureWeekScores(wk) {
  S.weekScores = S.weekScores || {};
  const got = await loadWeekScores(S.season, wk);
  // kickoff times are what the trace is cut on, so a path built before the feed
  // arrived is built from the wrong clock — throw it away with the rest
  if (got) { S.weekScores[wk] = got; S._live = null; S._wpPath = null; }
  return got;
}
function weekScoreGame(team, wk) {
  const ws = S.weekScores && S.weekScores[wk];
  return (ws && team && ws.byTeam[team]) || null;
}
const GAME_OVER = { complete: 1, canceled: 1, postponed: 1 };
function nflGame(team, wk) {
  const s = S.nflSched && S.nflSched[wk];
  return (s && team && s[team]) || null;
}
/** Has any game in this NFL week finished or kicked off? */
function weekStarted(wk) {
  const s = S.nflSched && S.nflSched[wk];
  if (s) return Object.keys(s).some(t => s[t].status !== 'pre_game');
  return !!(S.matchups[wk] || []).some(m => (m.points || 0) > 0);
}
/** Are all of this NFL week's games done? */
function weekFinished(wk) {
  const s = S.nflSched && S.nflSched[wk];
  if (s) { const ks = Object.keys(s); return ks.length > 0 && ks.every(t => GAME_OVER[s[t].status]); }
  return !!(S.matchups[wk] || []).some(m => (m.points || 0) > 0);
}
/** done · live · upcoming · bye · unknown */
function livePlayerState(p, wk) {
  const sg = weekScoreGame(p && p.team, wk);
  if (sg) return sg.over ? 'done' : (sg.started || sg.inProgress) ? 'live' : 'upcoming';
  if (!S.nflSched) return wk <= S.lastWeek ? 'done' : 'upcoming';
  const g = nflGame(p && p.team, wk);
  if (!g) return 'bye';
  if (GAME_OVER[g.status]) return 'done';
  return g.status === 'pre_game' ? 'upcoming' : 'live';
}
/** How much of a player's game is still to be played, 0 to 1. */
function liveRemaining(p, wk, state) {
  if (state === 'done' || state === 'bye') return 0;
  if (state !== 'live') return 1;
  const sg = weekScoreGame(p && p.team, wk);
  const q = sg && sg.quarterNum;
  // halfway through the quarter on average; overtime is the tail end of nothing
  if (!q || q < 1) return 1;
  if (q >= 5) return 0.04;
  return clamp((4 - q + 0.5) / 4, 0.04, 1);
}

/* What one player is worth to a live week: the points they have banked, plus the
   share of their projection still to come. A finished game is all points and no
   projection; a game that has not kicked off is all projection. */
/* A bye is his NFL team having no game that week. The absence of a projection
   looks exactly the same and is not the same thing — a player nobody expects to
   suit up has no line either, and calling that a bye tells the reader his team
   is off when it is the player who is out. The schedule is authoritative, so it
   decides; without it we fall back to the weaker signal we used to use alone. */
function onBye(p, wk) {
  if (!p) return false;
  if (S.nflSched && p.team) return !nflGame(p.team, wk);
  return !!(p.wk && !p.wk[wk]);
}

function liveValue(p, wk) {
  const state = livePlayerState(p, wk);
  const m = (S.matchups[wk] || []).find(x => x.players_points && x.players_points[p.id] !== undefined);
  const actual = m ? m.players_points[p.id] : null;
  const proj = pw(p, wk);
  const rem = liveRemaining(p, wk, state);
  const banked = state === 'done' ? (actual || 0) : (state === 'live' ? (actual || 0) : 0);
  const open = state === 'bye' ? 0 : proj * rem;
  const sg = weekScoreGame(p && p.team, wk);
  return {
    state: state, actual: actual, proj: proj, remaining: rem,
    banked: banked, open: open, used: banked + open,
    settled: state === 'done' || state === 'bye',
    quarter: sg ? sg.quarter : null,
    opp: (nflGame(p && p.team, wk) || {}).opp || pwOpp(p, wk) || null
  };
}
/** The number to show for a player in a given week — live where the week is live. */
function pwShown(p, wk) { return wk === S.liveWeek ? liveValue(p, wk).used : pw(p, wk); }

/* Which starters a team fields in a given week. Sleeper reports the lineup the
   manager actually set for the current and past weeks; for weeks that have not
   arrived the stored lineup is stale, so the optimiser stands in. */
function startersFor(t, wk) {
  const m = (S.matchups[wk] || []).find(x => x.roster_id === t.rosterId);
  if (m && Array.isArray(m.starters) && wk <= Math.max(S.lastWeek, S.liveWeek || 0)) {
    const ids = m.starters.filter(id => id && id !== '0');
    if (ids.length) return ids.map(id => S.index[id] || ensurePlayer(id));
  }
  return optimalLineup(activePlayers(t), p => pw(p, wk)).map(s => s.player).filter(Boolean);
}

/* The heart of it: banked points for finished games, projections for everyone
   else. A player whose game is under way has not finished playing, so their
   projection still stands — mixing a half-played line into a final score would
   silently understate every team on a Sunday afternoon. */
function liveRoster(t, wk) {
  const key = t.rosterId + '|' + wk;
  S._live = S._live || {};
  if (S._live[key]) return S._live[key];
  const m = (S.matchups[wk] || []).find(x => x.roster_id === t.rosterId);
  const pts = (m && m.players_points) || {};
  const rows = startersFor(t, wk).map(p => {
    const v = liveValue(p, wk);
    // the roster's own matchup row is the authority on what this player scored
    if (typeof pts[p.id] === 'number') {
      v.actual = pts[p.id];
      v.banked = v.state === 'done' || v.state === 'live' ? pts[p.id] : 0;
      v.used = v.banked + v.open;
    } else if (v.state === 'done' || v.state === 'live') {
      v.actual = v.actual === null ? 0 : v.actual;
      v.banked = v.actual; v.used = v.banked + v.open;
    }
    return Object.assign({ p: p }, v);
  });
  const banked = sum(rows.map(r => r.banked));
  const openRows = rows.filter(r => r.open > 0.05);
  const out = {
    rows: rows, banked: banked,
    projected: sum(openRows.map(r => r.open)),
    total: banked + sum(openRows.map(r => r.open)),
    doneN: rows.filter(r => r.state === 'done').length,
    liveN: rows.filter(r => r.state === 'live').length,
    leftN: rows.filter(r => r.state === 'upcoming').length,
    byeN: rows.filter(r => r.state === 'bye').length,
    open: openRows.map(r => ({ p: r.p, used: r.open })),
    reported: m ? (m.points || 0) : 0
  };
  S._live[key] = out;
  return out;
}

/** Pull the week's scores and game statuses again, without reloading the league. */
async function refreshLiveWeek() {
  const wk = S.liveWeek || clamp(S.lastWeek + 1, 1, S.regEnd);
  try {
    const [ms, sched] = await Promise.all([
      sl(`/league/${S.leagueId}/matchups/${wk}`).catch(() => null),
      (async () => { await idbSet('nflsched:' + S.season, null); return loadNflSchedule(S.season); })()
    ]);
    if (ms && ms.length) S.matchups[wk] = ms;
    if (sched) S.nflSched = sched;
  } catch (e) { }
  S._live = null; S._wpPath = null;
  // a week that has just finished stops being the live one
  if (S.liveWeek && weekFinished(S.liveWeek)) { S.lastWeek = S.liveWeek; S.liveWeek = null; S._sched = null; }
}

/** The lineup a manager actually has set, paired with the league's starting slots. */
function liveLineupSlots(t, wk) {
  const slots = (S.cfg.rosterPositions || []).filter(x => !['BN', 'IR', 'TAXI'].includes(x));
  const players = startersFor(t, wk);
  const fits = slots.every((sl, i) => !players[i] || (SLOT_ELIG[sl] || [sl]).indexOf(players[i].pos) >= 0);
  // Sleeper's starters array is positional, but if a league's data does not line
  // up, showing a kicker in the QB slot helps nobody — reseat them by eligibility
  if (fits) return slots.map((slot, i) => ({ slot: slot, player: players[i] || null }));
  return optimalLineup(players, p => pwShown(p, wk));
}
/** A short badge saying where a player's game is up to. */
function liveBadge(p, wk) {
  const v = liveValue(p, wk);
  if (v.state === 'bye') return h('span.tag', 'BYE');
  if (v.state === 'done') return h('span.tag', { style: { borderColor: 'var(--good)', color: 'var(--good-text)' } }, 'final');
  if (v.state === 'live') return h('span.tag', { title: 'game in progress — points so far are banked, the rest of the projection still counts', style: { borderColor: 'var(--s1)', color: 'var(--s1)' } }, v.quarter ? String(v.quarter) : 'playing');
  return h('span.tag', 'to play');
}

/* Both sides of a matchup already split into points that are banked and slots
   still to be drawn. Which games count as banked is the caller's business — the
   live view banks whatever has finished by now, and the trace below banks
   whatever had finished at some earlier moment in the week. The sampler is the
   same either way, so the two can never drift apart. */
function probFromSides(la, lb, seed, n) {
  n = n || 4000;
  const mk = (l) => l.open.map(r => ({ m: r.used, sd: volFromMean(r.p.pos, r.used) }));
  const oa = mk(la), ob = mk(lb);
  const draw = (arr, base) => {
    let s = 0;
    for (let k = 0; k < arr.length; k++) { if (rnd() < BUST_RATE) continue; s += drawScore(arr[k].m, arr[k].sd); }
    return base + Math.max(0, s * Math.max(0.55, 1 + 0.05 * gauss()));
  };
  seedRng(seed >>> 0);
  let aw = 0, tie = 0;
  const margins = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = draw(oa, la.banked), y = draw(ob, lb.banked);
    margins[i] = x - y;
    if (x > y) aw++; else if (x === y) tie++;
  }
  const srt = Array.from(margins).sort((x, y) => x - y);
  const q = (p) => srt[clamp(Math.floor(p * (n - 1)), 0, n - 1)];
  return {
    pA: aw / n, pB: (n - aw - tie) / n, tie: tie / n,
    med: q(.5), lo: q(.1), hi: q(.9),
    settled: !oa.length && !ob.length
  };
}

/** Win probability with the banked points held fixed and only the open slots drawn. */
function liveWinProb(A, B, wk, n) {
  const la = liveRoster(A, wk), lb = liveRoster(B, wk);
  const r = probFromSides(la, lb, hashStr(A.rosterId + '~' + B.rosterId + '~' + wk), n || 4000);
  r.a = la; r.b = lb;
  return r;
}

/** This week's matchups, both sides scored live. */
function liveMatchups(wk) {
  return (schedule()[wk - 1] || []).map(([a, b]) => {
    const A = S.teamById[a], B = S.teamById[b];
    if (!A || !B) return null;
    return Object.assign({ A: A, B: B }, liveWinProb(A, B, wk));
  }).filter(Boolean);
}

/* ---------- slates ----------
   A fantasy week is not a smooth line, it is a handful of windows: Thursday
   night, the Sunday slates, Monday night, plus whatever international or
   Saturday game the schedule has that week. Kickoff times come from the scores
   feed, and the labels are worked out in US Eastern because that is what the
   slate names mean. */
function etParts(ms) {
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false });
    const p = {}; f.formatToParts(new Date(ms)).forEach(x => p[x.type] = x.value);
    return { day: p.weekday, hour: +p.hour };
  } catch (e) { const d = new Date(ms); return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()], hour: d.getHours() }; }
}
function slateLabel(ms) {
  const { day, hour } = etParts(ms);
  if (day === 'Thu') return 'TNF';
  if (day === 'Fri') return 'Fri';
  if (day === 'Sat') return 'Sat';
  if (day === 'Mon') return 'MNF';
  if (day === 'Tue' || day === 'Wed') return day;
  if (hour < 12) return 'Sun AM';
  if (hour < 15) return 'Sun early';
  if (hour < 19) return 'Sun late';
  return 'SNF';
}
/** The week's kickoff windows, in order, with how many games each carries. */
function weekSlates(wk) {
  const ws = S.weekScores && S.weekScores[wk];
  if (ws && ws.games.length && ws.games.every(g => g.start)) {
    const by = {};
    ws.games.forEach(g => {
      const k = slateLabel(g.start);
      by[k] = by[k] || { label: k, start: g.start, n: 0, done: 0 };
      by[k].start = Math.min(by[k].start, g.start);
      by[k].n++; if (g.over) by[k].done++;
    });
    return Object.values(by).sort((a, b) => a.start - b.start);
  }
  // no kickoff times: fall back to one window per distinct game date
  const sc = S.nflSched && S.nflSched[wk];
  if (!sc) return [];
  const by = {};
  Object.keys(sc).forEach(t => {
    const d = sc[t].date; if (!d) return;
    const ms = Date.parse(d + 'T17:00:00Z');
    const k = slateLabel(ms);
    by[k] = by[k] || { label: k, start: ms, n: 0, done: 0 };
    by[k].n += 0.5; if (GAME_OVER[sc[t].status]) by[k].done += 0.5;
  });
  return Object.values(by).sort((a, b) => a.start - b.start);
}
/** How many of the week's games are finished. */
function weekGamesDone(wk) {
  const ws = S.weekScores && S.weekScores[wk];
  if (ws) return { done: ws.games.filter(g => g.over).length, total: ws.games.length };
  const sc = S.nflSched && S.nflSched[wk];
  if (!sc) return { done: 0, total: 0 };
  const ks = Object.keys(sc);
  return { done: ks.filter(t => GAME_OVER[sc[t].status]).length / 2, total: ks.length / 2 };
}

/* ---------- the week's own probability path ----------
   Nothing upstream keeps an intra-week win-probability trace, so this used to be
   recorded: one reading per visit, kept in this browser. That made the chart a
   record of when somebody was watching rather than of what happened — a week
   nobody had open had no chart at all, the same week looked different on a
   phone and a laptop, and every past week was blank forever.

   None of that is necessary, because the week itself remembers enough. We know
   when every game kicked off, what each player actually scored, and what he was
   projected for before he played. Wind the clock back to any moment and the sum
   is the one the live view already computes: everyone whose game had finished
   counts at his real score, everyone else counts at his projection. So the
   trace is derived rather than recorded — the same on every device, and there
   for every week whether or not anyone watched it.

   What it cannot rebuild is the inside of a game. Nothing upstream keeps a
   history of who had how many points at half time, so between one whistle and
   the next the line is flat by construction, and the path is cut at the moments
   the picture actually changed: the end of each kickoff window. */

const GAME_LEN = 3 * 3600 * 1000 + 15 * 60 * 1000;   // kickoff to final whistle

/** When one player's game is reckoned to have ended, or null if unknown. */
function gameEnd(p, wk) {
  const sg = weekScoreGame(p && p.team, wk);
  if (sg && sg.start) return sg.start + GAME_LEN;
  const g = nflGame(p && p.team, wk);
  if (g && g.date) return Date.parse(g.date + 'T17:00:00Z') + GAME_LEN;
  return null;
}
/** Is his game over in fact — not at some earlier moment, but now? */
function gameOver(p, wk) {
  const sg = weekScoreGame(p && p.team, wk);
  if (sg) return !!sg.over;
  const g = nflGame(p && p.team, wk);
  return !!(g && GAME_OVER[g.status]);
}

/** The moments in the week worth plotting: one per kickoff window, at the last
 *  whistle in it, with whether every game in that window has actually ended. */
function weekCuts(wk) {
  const by = {};
  const add = (start, over) => {
    if (!start) return;
    const k = slateLabel(start);
    by[k] = by[k] || { label: k, start: start, t: 0, n: 0, over: 0 };
    by[k].start = Math.min(by[k].start, start);
    by[k].t = Math.max(by[k].t, start + GAME_LEN);
    by[k].n++; if (over) by[k].over++;
  };
  const ws = S.weekScores && S.weekScores[wk];
  if (ws && ws.games.length && ws.games.every(g => g.start)) {
    ws.games.forEach(g => add(g.start, g.over));
  } else {
    const sc = S.nflSched && S.nflSched[wk];
    if (!sc) return [];
    const seen = {};
    Object.keys(sc).forEach(t => {
      const g = sc[t]; if (!g.date) return;
      const id = [t, g.opp].sort().join('~'); if (seen[id]) return; seen[id] = 1;
      add(Date.parse(g.date + 'T17:00:00Z'), !!GAME_OVER[g.status]);
    });
  }
  const cuts = Object.keys(by).map(k => by[k]).sort((a, b) => a.t - b.t);
  cuts.forEach(c => { c.done = c.n > 0 && c.over === c.n; });
  return cuts;
}

/** A team's week with the clock wound back to `T`: the real scores of everyone
 *  whose game had ended by then, and the projection for everyone who had not
 *  played yet. A player on bye is neither — he is simply not in the sum. */
function rosterAt(t, wk, T) {
  const m = (S.matchups[wk] || []).find(x => x.roster_id === t.rosterId);
  const pts = (m && m.players_points) || {};
  let banked = 0; const open = [];
  startersFor(t, wk).forEach(p => {
    if (!p || onBye(p, wk)) return;
    const end = gameEnd(p, wk);
    if (gameOver(p, wk) && end !== null && end <= T) banked += (typeof pts[p.id] === 'number' ? pts[p.id] : 0);
    else open.push({ p: p, used: pw(p, wk) });
  });
  return { banked: banked, open: open, total: banked + sum(open.map(o => o.used)) };
}

/** The win-probability path across one matchup's week. One point before
 *  kickoff, then one at the end of every window whose games have all finished.
 *  Every point is drawn from the same seed, so the wobble of the sampler is
 *  common to all of them and a move in the line is a move in the week. */
function probPath(A, B, wk) {
  S._wpPath = S._wpPath || {};
  const key = A.rosterId + '|' + B.rosterId + '|' + wk + (typeof HYP !== 'undefined' && HYP.on ? '|h' : '');
  if (S._wpPath[key]) return S._wpPath[key];
  const cuts = weekCuts(wk);
  if (!cuts.length) return null;
  const seed = hashStr(A.rosterId + '~' + B.rosterId + '~' + wk + '~path') >>> 0;
  const out = [];
  const at = (T, label, extra) => {
    const la = rosterAt(A, wk, T), lb = rosterAt(B, wk, T);
    const r = probFromSides(la, lb, seed, 2500);
    out.push(Object.assign({
      t: T, p: r.pA, label: label,
      a: la.banked, b: lb.banked, ta: la.total, tb: lb.total,
      left: la.open.length + lb.open.length
    }, extra || {}));
  };
  at(cuts[0].start - 1000, 'Before kickoff', { pre: true });
  cuts.forEach(c => { if (c.done) at(c.t, 'After ' + c.label, { games: c.n }); });
  S._wpPath[key] = out;
  return out;
}

/* ---------- a real score, against the projection ----------
   Once a player has actually played, the number worth showing is what he scored,
   and the thing worth knowing about it is whether it beat what he was expected
   to do. This is the one place that decides both, so Start/Sit, the matchup page
   and anything else that shows a score agree on it. */
/** What `p` actually scored in week `wk`, if he has played, and his projection.
 *  null when there is nothing real yet — he has not kicked off, or is on bye.
 *  `final` is false for a game still in progress: a real number, not a result. */
function playedScore(p, wk) {
  if (!p) return null;
  if (wk === S.liveWeek) {
    const lv = liveValue(p, wk);
    if (lv.actual === null || lv.actual === undefined) return null;
    if (lv.state === 'done') return { final: true, actual: lv.actual, proj: lv.proj };
    if (lv.state === 'live') return { final: false, actual: lv.actual, proj: lv.proj, quarter: lv.quarter };
    return null;
  }
  if (wk <= S.lastWeek) {
    const m = (S.matchups[wk] || []).find(x => x.players_points && x.players_points[p.id] !== undefined);
    if (!m) return null;
    return { final: true, actual: m.players_points[p.id], proj: pw(p, wk) };
  }
  return null;
}
/** The score as a number, green above projection and red below — but only once
 *  the game is over. Half a game against a whole-game projection would read as
 *  a miss every time, so a game in progress stays neutral. */
function scoreVsProj(ps, opts) {
  opts = opts || {};
  const beat = ps.actual >= ps.proj;
  const cls = !ps.final ? '' : beat ? 'up' : 'down';
  const tip = ps.final
    ? `<div class="k">${beat ? 'Beat' : 'Missed'} his projection</div>Scored <b>${fmt(ps.actual, 1)}</b> against <b>${fmt(ps.proj, 1)}</b> projected — ${beat ? '+' : '−'}${fmt(Math.abs(ps.actual - ps.proj), 1)}`
    : `<div class="k">Still playing${ps.quarter ? ' — ' + ps.quarter : ''}</div><b>${fmt(ps.actual, 1)}</b> so far, projected <b>${fmt(ps.proj, 1)}</b> for the game`;
  return bindTT(h('div', { tabindex: 0 },
    h('b.mono.score' + (cls ? '.' + cls : ''), fmt(ps.actual, 1)),
    opts.sub === false ? null : h('div.tiny.mono.muted', { style: { lineHeight: '1.15' } },
      (ps.final ? 'proj ' : 'so far · proj ') + fmt(ps.proj, 1))), tip);
}
