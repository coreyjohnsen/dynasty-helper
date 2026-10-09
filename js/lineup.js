"use strict";
/* ================= 10. START / SIT ================= */

/* ================= Start / Sit: several projection sources, one confidence =================
   Four independent readings of the same week, each in this league's own scoring:
     Sleeper   the Rotowire weekly lines the rest of the app already uses
     ESPN      ESPN's fantasy projections (fetched live; scaled to this league's scoring)
     Last 3    the average of his last three games with a recorded score (injured, bye
               and inactive weeks are skipped)
     Market    the model built from the market price / positional rank
   A slot's confidence is how often each candidate comes out ahead across those sources,
   weighting each source's vote by how decisive its gap is. */
const PSRC_LIST = [
  { id: 'sleeper', label: 'Sleeper (Rotowire)', short: 'Sleeper', kind: 'ext' },
  { id: 'espn', label: 'ESPN', short: 'ESPN', kind: 'ext' },
  { id: 'form', label: 'Last 3 healthy games', short: 'Last 3', kind: 'form' },
  { id: 'market', label: 'Market model', short: 'Market', kind: 'model' }
];
const PSRC = { data: {}, status: {}, pending: {}, espnMap: null, espnScale: {} };
PSRC_LIST.forEach(x => { PSRC.status[x.id] = { state: 'idle', msg: '', n: 0 }; });
let _psrcTimer = null;
function psrcChanged() {
  clearTimeout(_psrcTimer);
  _psrcTimer = setTimeout(() => { if (S.view === 'lineup') render(); }, 140);
}
function psrcSet(id, state, msg, n, quiet) {
  PSRC.status[id] = { state, msg: msg || '', n: n || 0 };
  if (!quiet) psrcChanged();
}

/** What one source says for one player in one week, before injuries (null = it has no number for him). */
function psrcRaw(id, p, wk) {
  if (!p) return null;
  if (id === 'sleeper') { const r = p.wk && p.wk[wk]; return r ? r.p : null; }
  if (id === 'market') return POS4.includes(p.pos) && !p.unranked && p.ppgHealthy > 0 ? p.ppgHealthy : null;
  if (id === 'form') return psrcForm(p, wk).mean;
  const m = PSRC.data[id] && PSRC.data[id][wk];
  if (!m) return null;
  const v = m.get(p.id);
  return v === undefined ? null : v;
}
/** The same, as the app plays it: nothing on a bye, and scaled by the chance he is healthy to play. */
/** Not expected to play: the injury report says so, unless the manager has overridden it for that week. */
function ruledOutAuto(p, wk) {
  if (!p) return false;
  // listed questionable/doubtful and a projection source has him at zero: they are saying he is not playing
  if ((p.injury === 'Questionable' || p.injury === 'Doubtful') && wk <= injCurrentWeek()
    && ['sleeper', 'espn'].some(id => { const v = psrcRaw(id, p, wk); return v !== null && v <= 0; })) return true;
  if (p.inj) return availability(p, wk) < 0.1;
  return OUT_TAGS.includes(p.injury) && wk <= injCurrentWeek();
}
function ruledOut(p, wk) {
  const o = (LS.get('ssout', {}) || {})[wk + ':' + p.id];
  return o === 1 ? true : o === 0 ? false : ruledOutAuto(p, wk);
}
function setRuledOut(p, wk, on) {
  const m = LS.get('ssout', {}) || {}, k = wk + ':' + p.id;
  if (on === ruledOutAuto(p, wk)) delete m[k]; else m[k] = on ? 1 : 0;
  LS.set('ssout', m);
}
function psrcPts(id, p, wk) {
  if (!p) return null;
  if (onBye(p, wk) || ruledOut(p, wk)) return 0;
  const v = psrcRaw(id, p, wk);
  if (v === null) return null;
  return v * (p.inj ? availability(p, wk) : 1);
}
/** Every source's number for a player, and their average. */
function psrcAll(p, wk) {
  const per = {};
  PSRC_LIST.forEach(x => { per[x.id] = psrcPts(x.id, p, wk); });
  const vals = Object.values(per).filter(v => v !== null);
  return { per, cons: vals.length ? mean(vals) : null, n: vals.length };
}
/** The consensus the lineup is built from; with no source at all, the app's usual weekly number. */
function consensusPts(p, wk) {
  const a = psrcAll(p, wk);
  return a.cons !== null ? a.cons : pw(p, wk);
}

/* ---- last three healthy games ---- */
function psrcActuals(p, wk) {
  const out = [];
  for (let w = Math.min(S.lastWeek, wk - 1); w >= 1 && out.length < 3; w--) {
    let v = null;
    const m = (S.matchups[w] || []).find(x => x.players_points && x.players_points[p.id] !== undefined);
    if (m) v = m.players_points[p.id];
    else if (WSTATS.pts[w] && WSTATS.pts[w][p.id] !== undefined) v = WSTATS.pts[w][p.id];
    if (v !== null && v !== 0) out.push({ week: w, pts: v });     // a recorded, non-zero score means he played
  }
  return out;
}
function psrcForm(p, wk) {
  const g = psrcActuals(p, wk);
  return { mean: g.length ? mean(g.map(x => x.pts)) : null, games: g };
}
async function psrcLoadForm(wk, players) {
  if (!S.lastWeek) { psrcSet('form', 'off', 'No games have been played yet this season.'); return; }
  const need = [];
  for (let w = 1; w <= Math.min(S.lastWeek, wk - 1); w++) {
    const rows = S.matchups[w] || [];
    if (!WSTATS.state[w] && players.some(p => !rows.some(m => m.players_points && m.players_points[p.id] !== undefined))) need.push(w);
  }
  if (need.length) { psrcSet('form', 'loading', 'Loading past weeks…'); await Promise.all(need.map(loadWeekStats)); }
  const n = players.filter(p => psrcForm(p, wk).games.length).length;
  psrcSet('form', n ? 'ok' : 'off', n ? n + ' of ' + players.length + ' players have a recent scored game' : 'No recent scored games were found.', n);
}

/* ---- ESPN ---- */
function espnParse(j, wk) {
  if (!PSRC.espnMap) {
    PSRC.espnMap = new Map();
    for (const id in S.players) { const e = S.players[id] && S.players[id].e; if (e) PSRC.espnMap.set(String(e), id); }
  }
  const list = Array.isArray(j) ? j : (j && (j.players || (j.data && j.data.players))) || [];
  const raw = new Map(), noLine = [];
  for (const e of list) {
    const pl = (e && e.player) || e || {};
    const eid = String(e && e.id !== undefined ? e.id : pl.id);
    const sid = PSRC.espnMap.get(eid);
    if (!sid) continue;
    const stats = pl.stats || [];
    const s1 = stats.find(x => x.statSourceId === 1 && x.scoringPeriodId === wk && (x.statSplitTypeId === undefined || x.statSplitTypeId === 1))
      || stats.find(x => x.statSourceId === 1 && x.scoringPeriodId === wk);
    if (!s1) { noLine.push(sid); continue; }
    const v = typeof s1.appliedTotal === 'number' ? s1.appliedTotal : null;
    if (v !== null && isFinite(v)) raw.set(sid, v);
  }
  // ESPN scores with its own default league rules, not this one's. Line it up with this league's scale by
  // position (the median ratio against Sleeper's lines), so a running back and a receiver are comparable.
  const byPos = {};
  raw.forEach((v, id) => {
    const p = S.index[id], sv = p && p.wk && p.wk[wk] ? p.wk[wk].p : 0;
    if (p && v > 3 && sv > 3) (byPos[p.pos] = byPos[p.pos] || []).push(v / sv);
  });
  const scale = {};
  for (const pos in byPos) {
    const a = byPos[pos].sort((x, y) => x - y);
    if (a.length >= 8) { const m = a[a.length >> 1]; if (m < 0.93 || m > 1.07) scale[pos] = clamp(m, 0.5, 2); }
  }
  PSRC.espnScale = scale;
  (PSRC.espnNoLine = PSRC.espnNoLine || {})[wk] = new Set(noLine);
  const out = new Map();
  raw.forEach((v, id) => { const p = S.index[id]; out.set(id, v / ((p && scale[p.pos]) || 1)); });
  return out;
}
/** Why ESPN has no number for him, in words. */
function espnWhy(p, wk) {
  const sp = S.players[p.id]; if (!(sp && sp.e)) return 'Sleeper has no ESPN id for him, so ESPN’s numbers cannot be matched to him';
  if (!PSRC.data.espn || !PSRC.data.espn[wk]) return 'ESPN has not loaded';
  if (PSRC.espnNoLine && PSRC.espnNoLine[wk] && PSRC.espnNoLine[wk].has(p.id)) return 'ESPN lists him but has no projection for week ' + wk;
  return 'ESPN did not return him at all this week (inactive, unprojected, or outside its most-owned list)';
}
async function psrcLoadEspn(wk) {
  psrcSet('espn', 'loading', 'Asking ESPN…', 0, true);
  try {
    const season = S.season, ck = 'psrc:espn:' + season + ':' + wk;
    let map = null;
    const rec = await idbGet(ck);
    if (rec && rec.d && Date.now() - rec.t < 6 * 3600 * 1000) { map = new Map(rec.d); (PSRC.espnNoLine = PSRC.espnNoLine || {})[wk] = new Set(rec.nl || []); }
    if (!map) {
      const filter = JSON.stringify({ players: { filterSlotIds: { value: [0, 2, 4, 6, 16, 17, 23] }, limit: 1500, offset: 0, filterStatsForSourceIds: { value: [1] }, filterStatsForSplitTypeIds: { value: [1] }, sortPercOwned: { sortPriority: 1, sortAsc: false } } });
      let j = null, err = null;
      for (const host of ['https://lm-api-reads.fantasy.espn.com', 'https://fantasy.espn.com']) {
        try {
          const r = await fetch(`${host}/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/3?scoringPeriodId=${wk}&view=kona_player_info`, { headers: { 'x-fantasy-filter': filter }, cache: 'no-store' });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          j = await r.json(); break;
        } catch (e) { err = e; }
      }
      if (!j) throw err || new Error('no response');
      map = espnParse(j, wk);
      if (!map.size) throw new Error('the response had no projections for week ' + wk);
      idbSet(ck, { t: Date.now(), d: Array.from(map), nl: Array.from(PSRC.espnNoLine[wk] || []) });
    }
    (PSRC.data.espn = PSRC.data.espn || {})[wk] = map;
    const sc = Object.keys(PSRC.espnScale).map(k => k + ' ×' + fmt(1 / PSRC.espnScale[k], 2)).join(', ');
    psrcSet('espn', 'ok', map.size + ' players' + (sc ? ' · scaled to this league’s scoring (' + sc + ')' : ''), map.size);
  } catch (e) {
    const blocked = e && /Failed to fetch|NetworkError|Load failed|TypeError/i.test(String(e.message || e) + String(e));
    psrcSet('espn', 'fail', blocked ? 'ESPN did not answer — the browser blocked the request or ESPN is unreachable.' : 'ESPN: ' + (e && e.message || e));
  }
}

/** Start whatever each source still needs for this week; each runs once and redraws the page as it lands. */
function psrcKick(wk, players) {
  const once = (k, fn) => { if (PSRC.pending[k]) return; PSRC.pending[k] = true; fn(); };
  once('espn:' + wk, () => psrcLoadEspn(wk));
  once('form:' + wk + ':' + players.length, () => psrcLoadForm(wk, players));
  PSRC.status.sleeper = { state: S.wproj && Object.keys(S.wproj).length ? 'ok' : 'off', msg: S.wproj ? 'Rotowire weekly lines via Sleeper' : 'no weekly lines loaded', n: 0 };
  PSRC.status.market = { state: 'ok', msg: 'built from each player’s market rank and this league’s scoring', n: 0 };
}

/* ---- confidence ---- */
const PSRC_TAU = 0.45;      // how many weekly standard deviations of gap make a source's vote lopsided
/**
 * For a slot's candidates: each source casts a soft vote — a wide gap is a firm vote, a near tie is a coin
 * flip — and the votes are averaged, so the percentages always add to 100. Only sources that have a number
 * for every candidate vote.
 */
function psrcConfidence(cands, wk) {
  const rows = cands.map(p => psrcAll(p, wk));
  // a player ESPN has no line for votes with his Sleeper number there, so one gap does not take ESPN out of the vote for everyone
  rows.forEach(r => { r.vote = Object.assign({}, r.per); if (r.vote.espn === null && r.vote.sleeper !== null) r.vote.espn = r.vote.sleeper; });
  const voters = PSRC_LIST.filter(x => rows.every(r => r.vote[x.id] !== null));
  let probs;
  if (voters.length) {
    probs = cands.map(() => 0);
    voters.forEach(x => {
      const vals = rows.map(r => r.vote[x.id]);
      const sd = mean(cands.map((p, i) => volFromMean(p.pos, Math.max(vals[i], 1))));
      const tau = Math.max(0.5, PSRC_TAU * sd), top = Math.max(...vals);
      const e = vals.map(v => Math.exp((v - top) / tau)), tot = sum(e);
      e.forEach((v, i) => { probs[i] += v / tot / voters.length; });
    });
  } else {
    // no source covers all of them: fall back to whatever average each has
    const c = rows.map(r => r.cons === null ? 0 : r.cons), sd = mean(cands.map((p, i) => volFromMean(p.pos, Math.max(c[i], 1))));
    const tau = Math.max(0.5, PSRC_TAU * sd), top = Math.max(...c), e = c.map(v => Math.exp((v - top) / tau)), tot = sum(e);
    probs = e.map(v => v / tot);
  }
  // round to whole percents that add to exactly 100 (largest remainder)
  const raw = probs.map(p => p * 100), floor = raw.map(Math.floor);
  let left = 100 - sum(floor);
  raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { floor[i]++; left--; } });
  // how many sources put each candidate on top (ties split)
  const wins = cands.map(() => 0);
  voters.forEach(x => {
    const vals = rows.map(r => r.vote[x.id]), top = Math.max(...vals), tied = vals.filter(v => Math.abs(v - top) < 0.05).length;
    vals.forEach((v, i) => { if (Math.abs(v - top) < 0.05) wins[i] += 1 / tied; });
  });
  return { rows, voters, pct: floor, wins, n: voters.length };
}

/* ---- the slots ---- */
function slotNames(slots) {
  const base = s => SLOT_LABEL[s] || s;
  const total = {}; slots.forEach(s => { total[base(s.slot)] = (total[base(s.slot)] || 0) + 1; });
  const seen = {};
  return slots.map(s => {
    const b = base(s.slot); seen[b] = (seen[b] || 0) + 1;
    return total[b] > 1 || ['QB', 'RB', 'WR', 'TE'].includes(b) ? b + seen[b] : b;
  });
}
/** The lineup the consensus recommends, and for each slot the two or three players who could fill it. */
function startSitPlan(T, wk) {
  const act = activePlayers(T);
  const live = wk === S.liveWeek;
  const val = p => consensusPts(p, wk);
  // in the week being played the lineup is whatever was set, and a game that has started can no longer be changed
  const lineup = live ? liveLineupSlots(T, wk) : optimalLineup(act, val);
  const names = slotNames(lineup);
  const chosen = new Set(lineup.filter(s => s.player).map(s => s.player.id));
  const open = p => !live || livePlayerState(p, wk) === 'upcoming';
  return lineup.map((s, i) => {
    const rec = s.player;
    const elig = SLOT_ELIG[s.slot] || [s.slot];
    if (live && rec && !open(rec)) return { slot: s.slot, name: names[i], rec, cands: [rec], conf: null, locked: true };
    // someone already starting in a different slot is not a free choice here
    const pool = act.filter(p => elig.includes(p.pos) && open(p) && (!chosen.has(p.id) || (rec && p.id === rec.id)));
    const outs = pool.filter(p => ruledOut(p, wk) && !(rec && p.id === rec.id));
    const cands = pool.filter(p => !outs.includes(p)).sort((a, b) => val(b) - val(a)).filter((p, k) => (rec && p.id === rec.id) || val(p) > 0.05).slice(0, 3);
    if (rec && cands.length && cands[0].id !== rec.id) { cands.splice(cands.indexOf(rec), 1); cands.unshift(rec); }
    return { slot: s.slot, name: names[i], rec, cands, outs, conf: cands.length >= 2 ? psrcConfidence(cands, wk) : null, locked: false };
  });
}

const LineupUI = { team: null, week: null, compare: [], openKey: null, browseOpen: undefined, st: { q: '', pos: 'all', limit: 30 } };
/* ---- the slot cards ---- */
function confChip(conf, i) {
  if (!conf) return h('span.ssc-conf.solo', 'only option');
  const pct = conf.pct[i];
  const cls = pct >= 70 ? '.hi' : pct >= 55 ? '.mid' : '.lo';
  return h('span.ssc-conf' + cls, { title: conf.n ? wins1(conf.wins[i]) + ' of ' + conf.n + ' sources put him on top' : 'no source covers every candidate, so this rests on the average alone' }, pct + '%');
}
/** 4 not 4.0, but 1.5 when two sources tie. */
function wins1(w) { return String(+w.toFixed(1)); }
function srcValue(v) { return v === null || v === undefined ? '—' : fmt(v, 1); }
function slotCard(sl, wk, open, onToggle) {
  const p = sl.rec;
  const cons = p ? (sl.locked ? pwShown(p, wk) : consensusPts(p, wk)) : 0;
  const opp = p ? (onBye(p, wk) ? 'BYE' : pwOpp(p, wk)) : null;
  return h('button.ssc' + (open ? '.open' : '') + (p ? medalCls(p).replace(' medal', '.medal').replace(/ /g, '.') : ''), { onclick: onToggle, 'aria-expanded': open ? 'true' : 'false', 'aria-label': sl.name + (p ? ': ' + p.name : ': nobody') },
    h('div.ssc-top', h('span.ssc-slot', sl.name), p ? (sl.locked ? h('span.ssc-conf.solo', { title: 'his game has started, so this slot can no longer be changed' }, '🔒 locked') : confChip(sl.conf, 0)) : null),
    p ? h('div.ssc-who', playerFace(p),
      h('div.ssc-id', h('div.ssc-nm', p.name),
        h('div.tiny.muted', [p.pos, p.team || 'FA', opp ? (opp === 'BYE' ? 'BYE' : (/^@|vs/.test(opp) ? opp : 'vs ' + opp)) : null].filter(Boolean).join(' · '))))
      : h('div.ssc-who', h('span.muted.tiny', 'nobody eligible')),
    p ? h('div.ssc-bot', h('span.ssc-pts', h('b', fmt(cons, 1)), h('span', sl.locked ? ' pts' : ' proj')), sl.locked ? liveBadge(p, wk) : injuryTag(p.injury, p), h('span.chev', ico('chev'))) : null);
}
function outToggle(p, wk) {
  const out = ruledOut(p, wk), man = (LS.get('ssout', {}) || {})[wk + ':' + p.id] !== undefined;
  return h('button.btn.sm.sspc-out', { type: 'button', title: out ? 'Count him as playing again' : 'Treat him as not expected to play: every source counts him as 0',
    onclick: e => { e.stopPropagation(); setRuledOut(p, wk, !out); render(); } },
    out ? (man ? 'Mark as playing' : 'Expected out — mark as playing') : 'Mark as out');
}
function slotPanel(sl, wk) {
  if (sl.locked) return h('div.ssp', { role: 'region', 'aria-label': sl.name + ' locked' },
    h('div.ssp-hd', h('b', sl.name + ' — locked in'), h('span.tiny.muted', sl.rec.name + '’s game has started, so nothing here can change any more.')));
  const conf = sl.conf;
  const srcs = PSRC_LIST;
  const rowFor = (p, i) => {
    const all = conf ? conf.rows[i] : psrcAll(p, wk);
    const opp = onBye(p, wk) ? 'BYE' : pwOpp(p, wk);
    const lead = conf && conf.pct[i] === Math.max(...conf.pct);
    return h('div.sspc' + (i === 0 ? '.rec' : ''),
      h('div.sspc-head',
        playerFace(p, { sm: true }),
        h('div.sspc-id', h('div.row', { style: { gap: '6px', flexWrap: 'wrap' } }, pname(p, { face: false, style: { fontWeight: 650 } }), injuryTag(p.injury, p), i === 0 ? h('span.tag.sspc-rec', 'recommended') : null),
          h('div.tiny.muted', [p.pos + (p.posRank || ''), p.team || 'FA', opp ? (opp === 'BYE' ? 'BYE' : (/^@|vs/.test(opp) ? opp : 'vs ' + opp)) : null].filter(Boolean).join(' · '))),
        conf && !ruledOut(p, wk) ? h('div.sspc-pct', { class: lead ? 'lead' : '' }, h('b', conf.pct[i] + '%'), h('span', conf.n ? wins1(conf.wins[i]) + ' of ' + conf.n + ' sources' : 'by average')) : ruledOut(p, wk) ? h('div.sspc-pct', h('b', 'Out'), h('span', 'not expected to play')) : h('div.sspc-pct', h('b', fmt(all.cons || 0, 1)), h('span', 'proj'))),
      outToggle(p, wk),
      conf ? h('div.sspc-bar', { 'aria-hidden': 'true' }, h('i', { style: { width: Math.max(2, conf.pct[i]) + '%' } })) : null,
      h('div.sspc-src', srcs.map(x => {
        const v = all.per[x.id];
        const others = conf ? conf.rows.filter((_, k) => k !== i).map(r => r.per[x.id]).filter(z => z !== null) : [];
        const wins = v !== null && others.length && v >= Math.max(...others) - 0.05 && conf && conf.rows.every(r => r.per[x.id] !== null);
        return h('div.ssrc' + (v === null ? '.na' : '') + (wins ? '.win' : ''), { title: x.label + (v === null ? ' has no number for him' + (x.id === 'espn' ? ': ' + espnWhy(p, wk) : '') : '') }, h('span', x.short), h('b', srcValue(v)), v === null && x.id === 'espn' ? h('em.ssrc-why', conf && conf.rows[i].vote && conf.rows[i].vote.espn !== null ? 'votes as Sleeper' : espnWhy(p, wk).startsWith('Sleeper has no') ? 'no ESPN id' : 'no line') : null);
      }).concat([h('div.ssrc.avg', { title: 'average of the sources that have a number' }, h('span', 'Avg'), h('b', srcValue(all.cons)))])));
  };
  const note = !conf ? h('div.tiny.muted', 'Nobody else on your roster can play this slot, so there is nothing to compare.')
    : conf.n === 0 ? h('div.tiny.sec', 'No source has a number for every one of these players, so the percentages rest on the average of what is available — treat them as rough.')
      : conf.n === 1 ? h('div.tiny.sec', 'Only one source covers all of them, so this is one opinion, not a consensus.') : null;
  return h('div.ssp', { role: 'region', 'aria-label': sl.name + ' candidates' },
    h('div.ssp-hd', h('b', sl.name + ' — who to start'), h('span.tiny.muted', conf ? 'confidence = how often each one comes out ahead across ' + conf.n + ' source' + (conf.n === 1 ? '' : 's') + ', weighting each by how big its gap is' : '')),
    sl.cands.map(rowFor), (sl.outs || []).length ? h('div.sspc-outs', h('span.tiny.muted', 'Not expected to play:'), sl.outs.map(p => h('span.sspc-o', pname(p, { face: false }), injuryTag(p.injury, p), outToggle(p, wk)))) : null, note);
}
function srcStrip(wk) {
  const chip = x => {
    const st = PSRC.status[x.id] || { state: 'idle', msg: '' };
    const icon = st.state === 'ok' ? '●' : st.state === 'loading' ? '…' : st.state === 'fail' ? '✕' : '○';
    return h('span.sstat.' + st.state, { title: x.label + ' — ' + (st.msg || st.state) }, h('i', icon), x.short);
  };
  const failed = PSRC_LIST.filter(x => PSRC.status[x.id].state === 'fail');
  return h('div.sstrip',
    h('div.row', { style: { gap: '6px', flexWrap: 'wrap' } }, h('span.tiny.muted', 'Sources'), PSRC_LIST.map(chip)),
    failed.length ? h('div.tiny.sec', failed.map(x => x.short + ': ' + PSRC.status[x.id].msg).join(' · ')) : null);
}
function startSitSlots(T, wk, act) {
  psrcKick(wk, act);
  const plan = startSitPlan(T, wk);
  const live = wk === S.liveWeek;
  const total = sum(plan.map(x => x.rec ? (x.locked ? pwShown(x.rec, wk) : consensusPts(x.rec, wk)) : 0));
  const nLocked = plan.filter(x => x.locked).length;
  const grid = h('div.ssgrid');
  plan.forEach((sl, i) => {
    const key = T.rosterId + ':' + wk + ':' + i, open = LineupUI.openKey === key;
    grid.appendChild(slotCard(sl, wk, open, () => { LineupUI.openKey = open ? null : key; render(); }));
    if (open) grid.appendChild(slotPanel(sl, wk));
  });
  const byes = act.filter(p => onBye(p, wk));
  return card(live ? 'Your lineup — week ' + wk + ' (live)' : 'Recommended lineup — week ' + wk,
    fmt(total, 1) + (live ? ' points so far plus what is still projected' : ' projected points')
    + (live ? ' · ' + nLocked + ' of ' + plan.length + ' slots locked' : '') + ' · tap ' + (live ? 'an open' : 'a') + ' slot to see the alternatives and how sure each call is'
    + (byes.length ? ' · ' + byes.length + ' player' + (byes.length === 1 ? '' : 's') + ' on bye' : ''),
    h('div', { style: { display: 'grid', gap: '14px' } }, grid, srcStrip(wk)));
}
function viewLineup() {
  const wrap = h('div.grid');
  const teams = S.teams;
  if (LineupUI.team === null || !S.teamById[LineupUI.team]) LineupUI.team = S.myRosterId || teams[0].rosterId;
  if (LineupUI.week === null) LineupUI.week = clamp(S.lastWeek + 1, 1, S.regEnd);
  const T = S.teamById[LineupUI.team];
  const wk = LineupUI.week;
  const act = activePlayers(T);
  const isLive = wk === S.liveWeek;
  // a week still to come is planned from several sources at once; a week under way or finished keeps its real scores
  const upcoming = !isLive && wk > S.lastWeek;
  const val = upcoming ? (p => consensusPts(p, wk)) : (p => pwShown(p, wk));
  /* In the week being played the lineup is not a suggestion — it is whatever the
     manager actually set, with some of it already locked in. Re-optimising it
     would be advice about a decision that is no longer available. */
  const lineup = isLive ? liveLineupSlots(T, wk) : optimalLineup(act, upcoming ? val : (p => pw(p, wk)));
  const startIds = new Set(lineup.filter(s => s.player).map(s => s.player.id));
  const bench = act.filter(p => !startIds.has(p.id)).sort((a, b) => val(b) - val(a));
  const total = sum(lineup.map(s => s.player ? val(s.player) : 0));
  const played = wk <= S.lastWeek;
  const lr = isLive ? liveRoster(T, wk) : null;

  const weeks = []; for (let w = 1; w <= S.regEnd; w++) weeks.push(w);
  wrap.appendChild(h('div.slhead',
    teamCard('a', T, {
      key: 'lineup', label: T.rosterId === S.myRosterId ? 'Your team' : 'Team',
      onPick: id => { LineupUI.team = id; LineupUI.compare = []; LineupUI.openKey = null; render(); }
    }),
    h('div.h2hweek', { style: { alignSelf: 'stretch', alignItems: 'center' } },
      h('label.fld', { style: { minWidth: '170px' } }, 'Week', h('select', { onchange: e => { LineupUI.week = +e.target.value; LineupUI.compare = []; LineupUI.openKey = null; render(); } },
        weeks.map(w => h('option', { value: w, selected: w === wk },
          'Week ' + w + (w === S.liveWeek ? ' (live)' : w <= S.lastWeek ? ' (played)' : w === S.lastWeek + 1 ? ' (next)' : ''))))),
      isLive ? h('span.live', h('i'), 'Live — ' + fmt(lr.banked, 1) + ' scored, ' + (lr.leftN + lr.liveN) + ' of ' + lr.rows.length + ' still to finish')
        : played ? h('span.tag', 'Already played — real scores, green where they beat the projection') : null)));

  // ---- the optimal lineup ----
  const byes = act.filter(p => onBye(p, wk));
  const rows = lineup.map(s => {
    const p = s.player;
    const o = p ? weekOutlook(p, wk) : null;
    // the alternative has to come off the bench — someone already starting
    // elsewhere is not a choice you get to make
    // a swap is only a real choice while both players still have a game to play
    const swappable = (x) => !isLive || livePlayerState(x, wk) === 'upcoming';
    const alts = p ? bench.filter(x => (SLOT_ELIG[s.slot] || [s.slot]).includes(x.pos) && swappable(x))
      .sort((a, b) => val(b) - val(a)).slice(0, 3) : [];
    const locked = p ? !swappable(p) : false;
    const gap = alts.length && p && !locked ? val(p) - val(alts[0]) : null;
    return { s, p, o, alts, gap, locked, close: gap !== null && gap < 2.5 };
  });
  const cols = [
    { k: 'slot', h: 'Slot', sortable: false, f: r => h('span.tag', { style: { minWidth: isNarrow() ? '34px' : '44px', textAlign: 'center' } }, SLOT_LABEL[r.s.slot] || r.s.slot) },
    {
      k: 'player', h: 'Player', sortable: false, f: r => r.p
        ? h('div', { style: { minWidth: 0 } }, h('div.row', { style: { gap: '7px', minWidth: 0 } },
          // on a phone the face and the slot already say who and where, so the position pill gives up its room
          isSimple() ? playerFace(r.p) : null, isNarrow() && isSimple() ? null : posPill(r.p.pos), pname(r.p, { face: false }),
          injuryTag(r.p.injury, r.p),
          // on a phone the tag costs more width than it earns — the card directly
          // below this table is the real place these calls get made
          r.close && !isNarrow() ? h('span.tag', { style: { borderColor: 'var(--s4)', color: 'var(--s4)' } }, 'close call') : null),
          // on a phone the status rides under the name instead of taking a column
          isLive && isNarrow() ? h('div', { style: { marginTop: '2px' } }, liveBadge(r.p, wk)) : null)
        : h('span.muted.tiny', 'nobody eligible')
    },
    {
      k: 'opp', prio: 2, h: 'Opponent', sortable: false, f: r => !r.o ? h('span.muted.tiny', '—')
        : r.o.bye ? h('span.tag', 'BYE')
          : r.o.zero ? h('span.tag', { style: { borderColor: 'var(--critical)', color: 'var(--bad-text)' } }, r.p && r.p.injury ? String(r.p.injury).toUpperCase() : 'OUT')
            : r.o.opp ? h('span.tiny', r.o.opp) : h('span.muted.tiny', '—')
    },
    isLive && !isNarrow() ? { k: 'st', h: 'Status', sortable: false, f: r => r.p ? liveBadge(r.p, wk) : null } : null,
    // on a phone the range rides under the projection instead of taking a column
    {
      // a player who has played shows what he scored, green if it beat his
      // projection and red if it did not; everyone else shows the projection
      k: 'proj', h: isLive ? 'Points' : played ? 'Scored' : 'Projected', num: true, sortable: false, f: r => {
        if (!r.o) return '—';
        const ps = playedScore(r.p, wk);
        if (ps) return scoreVsProj(ps);
        return h('div',
          h('b.mono', fmt(r.o.mean, 1)),
          isNarrow() && !r.o.bye && !r.o.final ? h('div.tiny.mono.muted', { style: { lineHeight: '1.15' } }, fmt(r.o.floor, 0) + '–' + fmt(r.o.ceil, 0)) : null);
      }
    },
    { k: 'range', prio: 2, h: 'Floor–ceiling', num: true, sortable: false, f: r => r.o && !r.o.bye && !r.o.final ? h('span.tiny.mono.muted', fmt(r.o.floor, 0) + '–' + fmt(r.o.ceil, 0)) : h('span.muted', '—') },
    {
      // once a starter's game has begun there is no next-best decision to make
      k: 'alt', prio: 2, h: 'Next best', sortable: false, f: r => r.locked
        ? h('span.muted.tiny', 'locked')
        : r.alts.length && r.gap !== null
          ? h('div.row', { style: { gap: '5px' } }, h('span.tiny.muted', r.alts[0].name.split(' ').slice(-1)[0] || r.alts[0].name),
            h('span.tiny.mono', { class: r.close ? 'down' : 'muted' }, '−' + fmt(r.gap, 1)))
          : h('span.muted.tiny', '—')
    },
    {
      // on a phone the compare picker further down the page does this job, and the button's column was what pushed the projection off the edge
      k: 'cmp', prio: 2, keepSimple: true, h: '', sortable: false, f: r => r.p ? h('button.btn.sm.cmpbtn', {
        title: 'Compare', 'aria-label': 'Compare ' + r.p.name, onclick: () => { toggleCompare(r.p.id); render(); }
      }, ico(LineupUI.compare.includes(r.p.id) ? 'check' : 'plus')) : null
    }
  ];
  if (wk > S.lastWeek) wrap.appendChild(startSitSlots(T, wk, act));
  else {
  wrap.appendChild(card(isLive ? 'Your lineup — week ' + wk : 'Optimal lineup — week ' + wk,
    (isLive
      ? fmt(total, 1) + ' live — ' + fmt(lr.banked, 1) + ' banked plus ' + fmt(lr.projected, 1) + ' still projected'
      : fmt(total, 1) + ' projected points')
    + (byes.length ? ' · ' + byes.length + ' player' + (byes.length === 1 ? '' : 's') + ' on bye' : ''),
    table(cols.filter(Boolean), rows, {})));

  // ---- the decisions that actually matter ----
  const closeOnes = rows.filter(r => r.close && r.p);
  wrap.appendChild(card('Calls worth thinking about', closeOnes.length
    ? 'these slots are within 2.5 projected points of the next option — close enough that the projection is not the whole answer'
      + (isLive ? '. Only players who have not kicked off are listed: the rest can no longer be changed.' : '')
    : (isLive ? 'Nothing left to decide — every slot with a game still to come has a clear best option.'
      : 'no slot is within 2.5 points of its alternative this week, so the optimal lineup is comfortable'),
    closeOnes.length
      ? h('div', { style: { display: 'grid', gap: '9px' } }, closeOnes.map(r => {
        const alt = r.alts[0];
        const pw1 = pBeats(r.p, alt, wk);
        return h('div', { style: { border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '9px 11px', background: 'var(--surface-2)' } },
          h('div.row', { style: { justifyContent: 'space-between', marginBottom: '6px' } },
            h('div.row', { style: { gap: '6px' } }, h('span.tag', SLOT_LABEL[r.s.slot] || r.s.slot),
              h('b.tiny', 'start ' + r.p.name + '?')),
            h('button.btn.sm', { onclick: () => { LineupUI.compare = [r.p.id, alt.id]; render(); } }, 'Compare these two')),
          h('div.row', { style: { gap: '14px' } },
            h('span.tiny.sec', h('b', r.p.name), ' ', fmt(pw(r.p, wk), 1), ' pts'),
            h('span.tiny.muted', 'vs'),
            h('span.tiny.sec', h('b', alt.name), ' ', fmt(pw(alt, wk), 1), ' pts'),
            h('span', { style: { flex: 1 } }),
            h('span.tiny', { style: { fontWeight: 620 } }, pct(pw1, 0) + ' chance ' + r.p.name.split(' ').slice(-1)[0] + ' outscores ' + alt.name.split(' ').slice(-1)[0])));
      }))
      : h('div.empty', 'Every slot has a clear best option this week.')));
  }

  // ---- head-to-head comparison tray ----
  const chosen = LineupUI.compare.map(id => S.index[id]).filter(Boolean);
  const browseOpen = LineupUI.browseOpen === undefined ? chosen.length < 2 : LineupUI.browseOpen;
  const rosterAssets = act.map(assetOfPlayer).sort((x, y) => val(y.ref) - val(x.ref));
  const outlookLine = (a) => { const o = weekOutlook(a.ref, wk); return (startIds.has(a.id) ? 'Starting' : 'Bench') + ' · ' + (o.bye ? 'on bye' : o.zero ? 'not expected to play' : (o.opp ? 'vs ' + o.opp : 'no opponent')); };
  wrap.appendChild(card('Compare players', chosen.length
    ? 'floor is the 10th percentile of the weekly distribution, ceiling the 90th'
    : 'line up to four players side by side',
    h('div', { style: { display: 'grid', gap: '14px' } },
      chosen.length
        ? compareGrid(chosen, wk)
        : h('button.tray-empty.a', { style: { margin: 0 }, onclick: () => { LineupUI.browseOpen = true; render(); } },
          h('span.tray-plus', ico('plus')), h('b', 'Who are you deciding between?'), h('span.tiny.muted', 'Pick two or more of your players below to see them side by side')),
      chosen.length ? h('div.row', h('button.btn.sm', { onclick: () => { LineupUI.compare = []; render(); } }, 'Clear comparison')) : null,
      h('div.card.collapsible' + (browseOpen ? '.open' : ''), { style: { boxShadow: 'none', background: 'var(--surface-2)' } },
        h('button.chd', { 'aria-expanded': browseOpen ? 'true' : 'false', onclick: () => { LineupUI.browseOpen = !browseOpen; render(); } },
          h('div.chd-t', h('h3', 'Add players to compare'), h('span.note', chosen.length + ' of 4 chosen')),
          h('span.chd-hint', browseOpen ? 'Hide' : 'Show'), h('span.chev', ico('chev'))),
        browseOpen ? assetBrowser({
          id: 'lbrowse', color: 'a', st: LineupUI.st, title: T.rosterId === S.myRosterId ? 'Your roster' : T.name, note: 'tap to add or remove · four at most',
          assets: rosterAssets, chosen: new Set(LineupUI.compare), picks: false,
          val: a => fmt(val(a.ref), 1), meta: outlookLine, placeholder: 'Search ' + T.short + ' players…',
          onToggle: (a) => { toggleCompare(a.id); render(); }, onChange: () => render()
        }) : null))));

  // ---- the bench ----
  const benchRows = bench.map(p => {
    const o = weekOutlook(p, wk);
    const bestSlot = (S.cfg.rosterPositions || []).filter(x => !['BN', 'IR', 'TAXI'].includes(x))
      .find(sl => (SLOT_ELIG[sl] || [sl]).includes(p.pos));
    const starterHere = bestSlot ? lineup.find(s => s.slot === bestSlot) : null;
    const behind = starterHere && starterHere.player ? val(starterHere.player) - val(p) : null;
    return { p, o, behind };
  });
  wrap.appendChild(card('Bench', bench.length + (isLive ? ' players not in the lineup' : ' players not in the optimal lineup'), table([
    { k: 'pos', h: 'Pos', f: r => posPill(r.p.pos), sort: r => r.p.pos },
    { k: 'name', h: 'Player', sort: r => r.p.name, f: r => h('div', h('div.row', { style: { gap: '7px' } }, isSimple() ? playerFace(r.p) : null, pname(r.p, { face: false }), injuryTag(r.p.injury, r.p)),
      isLive && isNarrow() ? h('div', { style: { marginTop: '2px' } }, liveBadge(r.p, wk)) : null) },
    {
      k: 'opp', prio: 2, h: 'Opponent', sortable: false, f: r => r.o.bye ? h('span.tag', 'BYE')
        : r.o.zero ? h('span.tag', { style: { borderColor: 'var(--critical)', color: 'var(--bad-text)' } }, r.p.injury ? String(r.p.injury).toUpperCase() : 'OUT')
          : h('span.tiny', r.o.opp || '—')
    },
    isLive && !isNarrow() ? { k: 'st', h: 'Status', sortable: false, f: r => liveBadge(r.p, wk) } : null,
    {
      k: 'proj', h: isLive ? 'Points' : played ? 'Scored' : 'Projected', num: true, sort: r => r.o.mean, f: r => {
        const ps = playedScore(r.p, wk);
        if (ps) return scoreVsProj(ps);
        return h('div',
          h('b.mono', fmt(r.o.mean, 1)),
          isNarrow() && !r.o.bye && !r.o.final ? h('div.tiny.mono.muted', { style: { lineHeight: '1.15' } }, fmt(r.o.floor, 0) + '–' + fmt(r.o.ceil, 0)) : null);
      }
    },
    { k: 'range', prio: 2, h: 'Floor–ceiling', num: true, sort: r => r.o.ceil, f: r => r.o.bye || r.o.final ? h('span.muted', '—') : h('span.tiny.mono.muted', fmt(r.o.floor, 0) + '–' + fmt(r.o.ceil, 0)) },
    { k: 'behind', prio: 2, h: 'Behind starter', num: true, sort: r => r.behind === null ? 999 : r.behind, f: r => r.behind === null ? '—' : h('span.mono', { class: r.behind < 2.5 ? 'down' : 'muted' }, '−' + fmt(r.behind, 1)) },
    { k: 'cmp', h: '', sortable: false, f: r => h('button.btn.sm.cmpbtn', { title: 'Compare', 'aria-label': 'Compare ' + r.p.name, onclick: () => { toggleCompare(r.p.id); render(); } }, ico(LineupUI.compare.includes(r.p.id) ? 'check' : 'plus')) }
  ].filter(Boolean), benchRows, { sortKey: 'proj', sortDir: -1 })));
  return wrap;
}
function toggleCompare(id) {
  const i = LineupUI.compare.indexOf(id);
  if (i >= 0) LineupUI.compare.splice(i, 1);
  else { LineupUI.compare.push(id); if (LineupUI.compare.length > 4) LineupUI.compare.shift(); }
}
function compareGrid(players, wk) {
  const outs = players.map(p => ({ p, o: weekOutlook(p, wk) }));
  const max = Math.max(...outs.map(x => x.o.ceil), 1);
  const best = outs.slice().sort((a, b) => b.o.mean - a.o.mean)[0];
  const isLive = wk === S.liveWeek;

  const card1 = ({ p, o }) => {
    const ps = playedScore(p, wk);
    const log = playerGameLog(p.id).filter(g => g.pts !== null && g.rostered && g.state === 'final');
    const avg = log.length ? mean(log.map(g => g.pts)) : null;
    const top = log.length ? Math.max(...log.map(g => g.pts)) : null;
    const lead = best && p.id === best.p.id && outs.length > 1 && !o.bye;
    const pctOf = (v) => clamp(v / max, 0, 1) * 100;
    const stat = (label, value, tip) => bindTT(h('div.cstat', { tabindex: 0 },
      h('b', value), h('span.tiny.muted', label)), tip);

    return h('div.ccard' + (lead ? '.lead' : ''),
      h('button.btn.sm.cx', { title: 'Remove from the comparison', onclick: () => { toggleCompare(p.id); render(); } }, '×'),
      h('div.chead',
        playerFace(p, { lg: true }),
        h('div', { style: { minWidth: 0 } },
          h('div.cnm', pname(p, { face: false, style: { fontWeight: 660 } })),
          h('div.row', { style: { gap: '6px', flexWrap: 'wrap', marginTop: '2px' } },
            posPill(p.pos), p.team ? teamLogo(p.team) : null,
            // the live badge already says BYE, so the meta line does not repeat it
            h('span.tiny.muted', o.bye ? (isLive ? '' : 'on bye this week')
              : o.zero ? 'not expected to play'
                : o.opp ? (isLive ? '' : 'vs ') + o.opp : 'no opponent listed'),
            injuryTag(p.injury, p), isLive ? liveBadge(p, wk) : null))),
      // the headline number: what he actually scored once he has played, else the projection
      h('div.row', { style: { alignItems: 'baseline', gap: '8px' } },
        ps && ps.final
          ? h('b.score.' + (ps.actual >= ps.proj ? 'up' : 'down'), { style: { fontSize: '27px' } }, fmt(ps.actual, 1))
          : h('b', { style: { fontSize: '27px' } }, fmt(o.mean, 1)),
        h('span.tiny.muted', ps && ps.final ? 'scored · ' + fmt(ps.proj, 1) + ' projected'
          : ps ? 'so far · ' + fmt(ps.proj, 1) + ' projected'
            : o.bye ? 'on bye' : o.zero ? 'projected nothing' : 'projected'),
        lead ? h('span.tag.leadtag', { style: { marginLeft: 'auto' } }, 'highest') : null),
      // floor → ceiling on a scale shared by every card, so they compare by eye
      o.bye || o.zero ? null : h('div',
        h('div.crange',
          h('i', { style: { left: pctOf(o.floor) + '%', width: Math.max(2, pctOf(o.ceil) - pctOf(o.floor)) + '%' } }),
          h('u', { style: { left: pctOf(o.mean) + '%' } })),
        h('div.row', { style: { justifyContent: 'space-between', marginTop: '3px' } },
          h('span.tiny.muted.mono', fmt(o.floor, 0)),
          h('span.tiny.muted', 'floor → ceiling'),
          h('span.tiny.muted.mono', fmt(o.ceil, 0)))),
      o.bye || o.zero ? null : h('div.cstats',
        stat('big week', pct(o.boom, 0), '<div class="k">Chance of a big week</div>Half again his projection or better, from the same distribution the simulator draws from.'),
        stat('dud', pct(o.bust, 0), '<div class="k">Chance of a dud</div>Half his projection or less.'),
        stat('avg so far', avg === null ? '—' : fmt(avg, 1), '<div class="k">This season</div>' + (log.length ? `Average of his <b>${log.length}</b> finished games.` : 'No finished games yet.')),
        stat('best', top === null ? '—' : fmt(top, 1), '<div class="k">Best week</div>His highest finished score this season.')));
  };

  // every pairing, as a single bar each: who wins the week between these two
  const pairs = [];
  for (let i = 0; i < players.length; i++) for (let j = i + 1; j < players.length; j++) {
    const a = players[i], b = players[j];
    const pr = pBeats(a, b, wk);
    pairs.push(h('div.cpair',
      h('span.cpn', { style: { textAlign: 'right', fontWeight: pr >= 0.5 ? 660 : 500 } }, a.name),
      h('div.cbar',
        h('i', { style: { width: (pr * 100) + '%' } }),
        h('span.cpct.l', pct(pr, 0)), h('span.cpct.r', pct(1 - pr, 0))),
      h('span.cpn', { style: { fontWeight: pr < 0.5 ? 660 : 500 } }, b.name)));
  }

  return h('div', { style: { display: 'grid', gap: '14px' } },
    h('div.cgrid', outs.map(card1)),
    pairs.length ? h('div',
      h('div.lbl', { style: { fontSize: '10px', marginBottom: '6px' } }, 'Who outscores whom'),
      h('div', { style: { display: 'grid', gap: '5px' } }, pairs),
      h('div.tiny.muted', { style: { marginTop: '7px' } },
        'From 12,000 paired draws of the same week. A tie counts as half to each side.')) : null);
}

