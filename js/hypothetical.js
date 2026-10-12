"use strict";
/* ================= hypothetical — what if =================
   Try a trade, a waiver pickup or any roster move and look at every page as if it
   had happened. Nothing here touches Sleeper: it is a local rebuild of the same
   model from the same baseline, so undoing everything restores the truth.

   The changes are kept as a log — one entry per trade, pickup or move — and the
   ownership the rest of the app reads (HYP.moves / HYP.picks) is replayed from it.
   That is what lets a whole trade be undone in one step, and what the banner on
   the other pages lists. */
var HYP = {
  on: false,          // there is at least one change in effect
  log: [],            // [{ id, kind, short, label, steps: [{ id, isPick, name, pos, from, to }] }]
  moves: {},          // playerId -> rosterId (null = free agency), against the real league
  picks: {},          // pickKey  -> rosterId
  seed: null,         // shared by the before and after runs, so the odds are a paired comparison
  base: null,         // metrics for the real league, captured just before the first change
  after: null,        // metrics with every change in effect
  ver: 0,             // bumps whenever the rebuilt league changes, for caches keyed on it
  tok: 0, nextId: 1,
  busy: { base: false, after: false },
  // the page
  mode: 'trade', focus: null, flash: null,
  tr: { a: null, b: null, aOut: [], bOut: [], tab: 'a', st: { q: '', pos: 'all', limit: 12 } },
  fa: { team: null, add: null, drop: null, st: { q: '', pos: 'all', limit: 12 }, dst: { q: '', pos: 'all', limit: 12 } },
  sb: { team: null, st: { q: '', pos: 'all', limit: 12 } }
};
const HYP_SIMS = 1200;

function hypTeamId() { return S.myRosterId || (S.teams[0] && S.teams[0].rosterId); }
function hypCount() { return HYP.log.length; }
function pickKeyOf(a) {
  if (a.kind !== 'pick') return null;
  const r = a.ref;
  return r.season + '|' + r.round + '|' + r.origRosterId;
}
const teamNameOf = (rid) => rid === null || rid === undefined ? 'free agency' : ((S.teamById[rid] || {}).name || '?');
const teamShortOf = (rid) => rid === null || rid === undefined ? 'FA' : ((S.teamById[rid] || {}).short || '?');

/** Snapshot the numbers every page compares against. Odds arrive later, from the simulation. */
function hypMetrics() {
  const out = {};
  S.teams.forEach(t => {
    out[t.rosterId] = {
      now: t.now, future: t.future, power: t.power, futurePower: t.futurePower, powerRank: t.powerRank,
      futureRank: t.futureRank, totalValue: t.totalValue, valueRank: t.valueRank,
      pickCapital: t.pickCapital, window: t.window, age: t.age,
      posNow: Object.assign({}, t.posNow),
      playoff: null, title: null, wins: null, bye: null
    };
  });
  return out;
}
/** Run the season simulation in the background and fold its odds into a metrics snapshot.
 *  The job is read from the league the moment this is called, so a later change cannot leak in. */
function hypRunSim(which) {
  const target = which === 'base' ? HYP.base : HYP.after, tok = which === 'after' ? ++HYP.tok : null;
  HYP.busy[which] = true;
  const settle = () => { HYP.busy[which] = false; };
  simulateAsync(HYP_SIMS, { seed: HYP.seed, keepStale: true }).then(r => {
    if (which === 'after' && tok !== HYP.tok) return;          // a newer change superseded this run
    settle();
    if (!r || (which === 'base' ? HYP.base : HYP.after) !== target) return;
    S.teams.forEach(t => {
      const m = target[t.rosterId], s = r.by[t.rosterId];
      if (m && s) { m.playoff = s.playoff; m.title = s.title; m.wins = s.wins; m.bye = s.bye; }
    });
    if (S.view === 'hypo') render();
  }, e => { if (which === 'base' || tok === HYP.tok) settle(); console.error(e); });
}

/** Replay the log over the real league, rebuild every roster, and start the odds running. */
function hypRebuild() {
  const own = {}, pk = {};
  HYP.log.forEach(e => e.steps.forEach(s => { (s.isPick ? pk : own)[s.id] = s.to; }));
  const norm = (v) => v === undefined ? null : v;
  const moves = {}, picks = {};
  for (const id in own) if (norm(own[id]) !== norm(S.base.own[id])) moves[id] = own[id];
  for (const k in pk) if (norm(pk[k]) !== norm(S.base.pickOwn[k])) picks[k] = pk[k];
  HYP.moves = moves; HYP.picks = picks; HYP.ver++;
  HYP.on = HYP.log.length > 0;
  applyOwnership(moves, picks);
  if (HYP.on) {
    HYP.after = hypMetrics();
    hypRunSim('after');
    document.documentElement.setAttribute('data-hyp', '1');
  } else {
    HYP.after = null; HYP.base = null; HYP.tok++;
    HYP.busy = { base: false, after: false };
    document.documentElement.removeAttribute('data-hyp');
  }
}
/** Put one change into effect. `steps` say where each asset goes; where it was is noted for display. */
function hypCommit(kind, short, label, steps) {
  if (!HYP.base) {
    // the first change: the league is still the real one, so this is the baseline
    HYP.seed = (Math.random() * 4294967296) >>> 0;
    HYP.base = hypMetrics();
    hypRunSim('base');
  }
  HYP.flash = null;
  HYP.log.push({ id: HYP.nextId++, kind, short, label, steps });
  track('hypothetical-' + kind, 'Hypothetical ' + kind, true);
  hypRebuild();
}
/** Take a change back out, and anything later that moved the same players or picks —
 *  those would be moving assets that, without this change, were never there. */
function hypUndo(id) {
  const i = HYP.log.findIndex(e => e.id === id);
  if (i < 0) return;
  const keyOf = (s) => (s.isPick ? 'k:' : 'p:') + s.id;
  const keys = new Set(HYP.log[i].steps.map(keyOf)), keep = HYP.log.slice(0, i);
  let dropped = 0;
  for (let j = i + 1; j < HYP.log.length; j++) {
    const e = HYP.log[j];
    if (e.steps.some(s => keys.has(keyOf(s)))) { e.steps.forEach(s => keys.add(keyOf(s))); dropped++; }
    else keep.push(e);
  }
  HYP.log = keep;
  HYP.flash = dropped ? 'Also removed ' + dropped + ' later change' + (dropped === 1 ? '' : 's') + ' that moved the same players.' : null;
  hypRebuild();
}
/** Undo whichever change last touched this player or pick. */
function hypUndoAsset(id) {
  for (let i = HYP.log.length - 1; i >= 0; i--) if (HYP.log[i].steps.some(s => s.id === id)) return hypUndo(HYP.log[i].id);
}
function hypReset() {
  HYP.log = []; HYP.flash = null;
  if (S.base) hypRebuild();
}
/** Forget everything without rebuilding — for when the league itself is being replaced. */
function hypClear() {
  HYP.log = []; HYP.moves = {}; HYP.picks = {}; HYP.on = false; HYP.base = null; HYP.after = null; HYP.tok++; HYP.flash = null;
  HYP.busy = { base: false, after: false };
  HYP.tr.a = HYP.tr.b = null; HYP.tr.aOut = []; HYP.tr.bOut = [];
  HYP.fa.team = null; HYP.fa.add = null; HYP.fa.drop = null; HYP.sb.team = null; HYP.focus = null;
  if (typeof document !== 'undefined') document.documentElement.removeAttribute('data-hyp');
}
function hypExit() {
  const had = HYP.log.length > 0;
  hypClear();
  if (had && S.base && S.teams && S.teams.length) applyOwnership({}, {});
}

const HYP_UNAFFECTED = {
  week: 'This Week is scored from games that are already happening. A hypothetical roster does not change points that have been banked, so the live totals and matchups here stay real.',
  standings: 'Active Rankings is pure results — wins, losses and points actually scored. A hypothetical roster cannot change games that have already been played.',
  draft: 'The draft board is a historical record of picks that were actually made, so a hypothetical roster does not change it.',
  trades: 'Trade History is a record of deals that actually happened, so a hypothetical roster does not change it. The grades already use live market values.'
};

/* ================= the banner on every other page ================= */
function hypBanner(view) {
  if (!HYP.on || view === 'hypo') return null;
  const quiet = !!HYP_UNAFFECTED[view], n = HYP.log.length;
  return h('div.hypbar.slim' + (quiet ? '.quiet' : ''),
    h('span.hyp-badge', 'HYPOTHETICAL'),
    quiet
      ? h('span.tiny.sec', { title: HYP_UNAFFECTED[view] }, 'Real results — hypothetical changes do not affect this page')
      : [h('span.tiny.muted.hypn', n + (n === 1 ? ' change' : ' changes') + ' in effect'),
        h('span.hypchips', HYP.log.slice(0, 3).map(e => h('span.hypchip', { title: e.label }, e.short)),
          n > 3 ? h('span.tiny.muted', '+' + (n - 3) + ' more') : null)],
    h('span', { style: { flex: 1 } }),
    h('button.btn.sm', { onclick: () => { S.view = 'hypo'; render(); window.scrollTo(0, 0); } }, 'Manage'),
    h('button.btn.sm', { onclick: () => { hypReset(); render(); } }, 'Reset'));
}

/* ================= the page ================= */
const HYP_MODES = [
  { k: 'trade', ic: 'trade', t: 'Hypothetical trade', d: 'Set up a deal between any two teams and process it.' },
  { k: 'fa', ic: 'plus', t: 'Waiver / free agent', d: 'Sign someone from the wire and choose who goes.' },
  { k: 'sandbox', ic: 'sliders', t: 'Sandbox', d: 'Any roster move, on any team, one at a time.' }
];
function viewHypo() {
  const wrap = h('div.grid');
  if (!S.teams.length) return wrap;
  if (HYP.on) wrap.appendChild(hypImpact());
  if (HYP.flash) wrap.appendChild(h('div.hypflash', HYP.flash));
  if (HYP.on) wrap.appendChild(hypChangesCard());
  else wrap.appendChild(h('div.hypintro',
    h('div.pic', ico('flask')),
    h('div', h('b', 'Try a move before you make it'),
      h('div.tiny.sec', 'Process a trade, a pickup or any roster move below and every page recomputes as if it had happened — lineups, power rankings, odds, the simulator. Nothing is sent to Sleeper, and one button puts everything back.'))));

  wrap.appendChild(h('div.smodes', { role: 'tablist' }, HYP_MODES.map(m =>
    h('button.smode' + (HYP.mode === m.k ? '.on' : ''), { role: 'tab', 'aria-selected': HYP.mode === m.k ? 'true' : 'false', title: m.d, onclick: () => { HYP.mode = m.k; render(); } },
      h('span.smode-ic', ico(m.ic)), h('span.smode-t', m.t)))));
  wrap.appendChild(h('div.tiny.muted', { style: { marginTop: '-6px' } }, (HYP_MODES.find(m => m.k === HYP.mode) || HYP_MODES[0]).d));

  wrap.appendChild(HYP.mode === 'fa' ? hypFaPanel() : HYP.mode === 'sandbox' ? hypSandboxPanel() : hypTradePanel());
  return wrap;
}
function hypSetTeamDefaults() {
  const ok = (id) => id !== null && !!S.teamById[id];
  if (!ok(HYP.tr.a)) HYP.tr.a = hypTeamId();
  if (!ok(HYP.tr.b) || HYP.tr.b === HYP.tr.a) HYP.tr.b = (S.teams.find(t => t.rosterId !== HYP.tr.a) || S.teams[0]).rosterId;
  if (!ok(HYP.fa.team)) HYP.fa.team = hypTeamId();
  if (!ok(HYP.sb.team)) HYP.sb.team = hypTeamId();
}

/* ---------- headline stats ---------- */
function hypAffected() {
  const set = new Set();
  HYP.log.forEach(e => e.steps.forEach(s => { if (s.from !== null && s.from !== undefined) set.add(s.from); if (s.to !== null && s.to !== undefined) set.add(s.to); }));
  return S.teams.filter(t => set.has(t.rosterId));
}
function hypKpi(label, before, after, o) {
  const dec = o.dec === undefined ? 1 : o.dec, f = o.f || (v => fmt(v, dec));
  const pending = after === null || before === null;
  let delta;
  if (pending) delta = h('span.tiny.muted', h('span.spin'), ' simulating…');
  else if (o.rank) delta = before === after ? h('span.tiny.flat', 'no change')
    : h('span', { class: after < before ? 'up' : 'down', style: { fontSize: '11.5px', fontWeight: 650 } }, (after < before ? '▲ up ' : '▼ down ') + Math.abs(after - before));
  else {
    const d = o.pp ? (after - before) * 100 : after - before;
    delta = Math.abs(d) < (o.pp ? 0.05 : Math.pow(10, -dec) / 2) ? h('span.tiny.flat', 'no change') : deltaTag(o.invert ? -d : d, o.pp ? 1 : dec, o.pp ? ' pp' : '');
  }
  const e = h('div.kpi.hypkpi' + (o.big ? '.big' : ''), h('div.lbl', label),
    h('div.val', pending ? '—' : f(after)),
    h('div.sub', h('span.muted', pending ? ' ' : 'was ' + f(before))),
    h('div.sub', delta));
  if (o.tip) { e.tabIndex = 0; bindTT(e, o.tip); }
  return e;
}
function hypImpact() {
  const aff = hypAffected();
  if (!aff.length || !HYP.base || !HYP.after) return h('span');
  if (!HYP.focus || !aff.some(t => t.rosterId === HYP.focus)) HYP.focus = (aff.find(t => t.rosterId === hypTeamId()) || aff[0]).rosterId;
  const T = S.teamById[HYP.focus], b = HYP.base[T.rosterId], a = HYP.after[T.rosterId];
  const busy = HYP.busy.base || HYP.busy.after;
  const chips = h('div.chipwrap', aff.map(t => h('button.chip' + (t.rosterId === T.rosterId ? '.on' : ''),
    { onclick: () => { HYP.focus = t.rosterId; render(); } }, t.rosterId === hypTeamId() ? 'You · ' + t.short : t.name)));
  const odds = (k) => (b[k] === null || a[k] === null) ? [null, null] : [b[k], a[k]];
  // the three numbers people quote, large; the supporting picture beneath
  const kpis = h('div', { style: { display: 'grid', gap: '10px' } },
    h('div.hypkpis.main',
      hypKpi('Playoff odds', ...odds('playoff'), { big: true, f: v => pct(v, 0), pp: true, tip: 'Chance of making the playoffs across ' + kfmt(HYP_SIMS) + ' simulated seasons, same random draws before and after' }),
      hypKpi('Title odds', ...odds('title'), { big: true, f: v => pct(v, 1), pp: true }),
      hypKpi('Projected wins', ...odds('wins'), { big: true, dec: 1 })),
    h('div.hypkpis.sub',
      hypKpi('Lineup pts/wk', b.now, a.now, { dec: 1 }),
      hypKpi('Power rank', b.powerRank, a.powerRank, { rank: true, f: v => '#' + v }),
      isDynasty() ? hypKpi('Future rank', b.futureRank, a.futureRank, { rank: true, f: v => '#' + v }) : null,
      hypKpi(capitalLabel(), b.totalValue, a.totalValue, { dec: 0, f: v => kfmt(Math.round(v)) })));

  // who else the changes moved: the biggest swings in playoff odds anywhere in the league
  let ripple = null;
  if (!busy) {
    const rows = S.teams.filter(t => HYP.base[t.rosterId].playoff !== null && HYP.after[t.rosterId].playoff !== null && t.rosterId !== T.rosterId)
      .map(t => ({ t, d: (HYP.after[t.rosterId].playoff - HYP.base[t.rosterId].playoff) * 100, dt: (HYP.after[t.rosterId].title - HYP.base[t.rosterId].title) * 100 }))
      .filter(r => Math.abs(r.d) >= 0.5).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 4);
    if (rows.length) ripple = h('div.hypripple',
      h('div.lbl', { style: { fontSize: '10px' } }, 'Ripple through the league · playoff odds'),
      h('div.hyprip', rows.map(r => h('span.hyprip-i', h('b.tiny', r.t.name), deltaTag(r.d, 1, ' pp')))));
  }
  return card('What your changes do', HYP.log.length + (HYP.log.length === 1 ? ' change' : ' changes') + ' in effect · ' + (aff.length > 1 ? 'pick a team to see its numbers' : T.name),
    h('div', { style: { display: 'grid', gap: '14px' } }, aff.length > 1 ? chips : null, kpis, ripple),
    h('button.btn.sm', { onclick: () => { hypReset(); render(); } }, 'Reset everything'));
}

/* ---------- the changes so far ---------- */
function hypChangesCard() {
  const kindIc = { trade: 'trade', fa: 'plus', move: 'sliders' };
  return card('Changes in effect', 'each one can be taken back on its own',
    h('div.hypchanges', HYP.log.map(e => h('div.hypchg',
      h('div.hypchg-h', h('span.hypchg-ic', ico(kindIc[e.kind] || 'swap')), h('b', e.short),
        h('span', { style: { flex: 1 } }),
        h('button.btn.sm', { onclick: () => { hypUndo(e.id); render(); } }, 'Undo')),
      h('div.hypchg-b', e.steps.map(s => {
        const p = s.isPick ? null : (S.index[s.id] || null);
        return h('div.hypline.' + (s.to === null ? 'out' : 'in'),
          h('span.hypdir', s.to === null ? 'DROP' : s.from === null ? 'ADD' : 'MOVE'),
          posPill(s.pos),
          h('span.hypnm', p ? pname(p, { face: false }) : s.name),
          h('span.tiny.muted', teamShortOf(s.from) + ' → ' + (s.to === null ? 'free agency' : teamShortOf(s.to))));
      }))))));
}

/* ---------- 1. a hypothetical trade ---------- */
function hypActiveCount(T, adding, removing) {
  const rm = new Set(removing.map(a => a.id));
  const keep = T.players.filter(p => !rm.has(p.id) && !T.taxi.has(p.id) && !T.ir.has(p.id)).length;
  return keep + adding.filter(a => a.kind === 'player').length;
}
function hypTradePanel() {
  hypSetTeamDefaults();
  const R = HYP.tr, A = S.teamById[R.a], B = S.teamById[R.b];
  // trays hold assets from the roster as it is now; anything that has since moved is dropped
  const still = (T, arr) => { const have = new Set(assetsOf(T).map(a => a.id)); return arr.filter(a => have.has(a.id)); };
  R.aOut = still(A, R.aOut); R.bOut = still(B, R.bOut);
  const T_OF = { a: A, b: B }, outOf = (w) => w === 'a' ? R.aOut : R.bOut;
  const setOut = (w, arr) => { R[w + 'Out'] = arr; render(); };
  const sumA = sum(R.aOut.map(a => a.dv)), sumB = sum(R.bOut.map(a => a.dv));
  const f = fairness(sumA, sumB), verdict = tradeVerdict(f);
  const canRun = R.aOut.length > 0 && R.bOut.length > 0;
  const nameOf = (T) => T.rosterId === S.myRosterId ? 'You' : T.name;

  const out = h('div.grid');
  out.appendChild(matchupBar({
    key: 'hyp', aId: A.rosterId, bId: B.rosterId,
    onPick: (w, id) => { R[w] = id; R[w + 'Out'] = []; R.st.q = ''; render(); },
    onSwap: () => { const t = R.a; R.a = R.b; R.b = t; const o = R.aOut; R.aOut = R.bOut; R.bOut = o; R.tab = R.tab === 'a' ? 'b' : 'a'; render(); }
  }));
  const tray = (w) => {
    const T = T_OF[w], items = outOf(w);
    return deskTray({
      which: w, title: nameOf(T) === 'You' ? 'You send' : T.name + ' sends', total: kfmt(Math.round(w === 'a' ? sumA : sumB)),
      cards: isSimple(),
      items: items.map(a => dealItem(a, { onRemove: () => setOut(w, items.filter(x => x.id !== a.id)) })),
      count: items.length + (items.length === 1 ? ' asset' : ' assets'), onClear: () => setOut(w, []),
      emptyTitle: 'Add what ' + (nameOf(T) === 'You' ? 'you send' : T.short + ' sends'), emptySub: 'Pick players and draft picks from the roster below',
      onEmpty: () => { R.tab = w; render(); setTimeout(() => { const el = $('#hbrowse'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30); }
    });
  };
  const process = () => {
    if (!canRun) return;
    const steps = [];
    R.aOut.forEach(a => steps.push({ id: a.kind === 'pick' ? pickKeyOf(a) : a.id, isPick: a.kind === 'pick', name: a.name, pos: a.pos, from: A.rosterId, to: B.rosterId }));
    R.bOut.forEach(a => steps.push({ id: a.kind === 'pick' ? pickKeyOf(a) : a.id, isPick: a.kind === 'pick', name: a.name, pos: a.pos, from: B.rosterId, to: A.rosterId }));
    const list = (arr) => arr.map(a => a.name).join(', ');
    hypCommit('trade', A.short + ' ⇄ ' + B.short, A.name + ' sends ' + list(R.aOut) + ' · ' + B.name + ' sends ' + list(R.bOut), steps);
    R.aOut = []; R.bOut = []; R.st.q = '';
    render(); window.scrollTo(0, 0);
  };
  const processBtn = () => h('button.btn.pri.trun', { disabled: !canRun, onclick: process }, canRun ? 'Process trade' : 'Add something to both sides');
  const gap = Math.abs(sumA - sumB), overpay = sumA > sumB ? A : B;
  const balanceBody = () => !canRun && !R.aOut.length && !R.bOut.length
    ? [h('div.bal-empty', ico('trade'), h('div', h('b', 'Nothing in the deal yet'), h('div.tiny.muted', 'Add assets to both sides, then process it.')))]
    : [h('div.bal-pct', h('span.hero.mono', pct(f, 0)), h('span.bal-v', h('i', { style: { background: verdict[1] } }), verdict[0])),
      h('div.balbar', { 'aria-hidden': 'true' }, h('i.a', { style: { flex: String(Math.max(sumA, 1)) } }), h('i.b', { style: { flex: String(Math.max(sumB, 1)) } })),
      h('div.tiny.sec.bal-line', f >= 0.995 ? 'Dead even' : `${nameOf(overpay)} ${nameOf(overpay) === 'You' ? 'are' : 'is'} sending ${kfmt(Math.round(gap))} more in trade value`)];
  out.appendChild(h('div.deal', tray('a'),
    h('div.dealmid', balanceBody(), processBtn(),
      h('div.tiny.muted.trun-note', 'Rebuilds the league with this deal in it. Nothing is sent to Sleeper.')),
    tray('b')));
  // roster spots: informational, since a real league would make someone cut down
  const spots = S.cfg.activeSpots || 0;
  if (canRun && spots) {
    const warn = [[A, R.aOut, R.bOut], [B, R.bOut, R.aOut]].map(([T, o, i]) => ({ T, n: hypActiveCount(T, i, o) })).filter(x => x.n > spots);
    if (warn.length) out.appendChild(h('div.tiny', { style: { color: 'var(--bad-text)', fontWeight: 560 } },
      warn.map(x => `${x.T.name} would carry ${x.n} active players for ${spots} spots — they would need to cut ${x.n - spots}. `).join('')));
  }
  const bw = R.tab === 'b' ? 'b' : 'a', BT = T_OF[bw];
  out.appendChild(assetBrowser({
    id: 'hbrowse', color: bw, st: R.st, cols: 4,
    meta: a => a.kind === 'player' && a.ref ? [a.ref.team || 'FA', a.ref.age ? fmt(a.ref.age, 0) + 'y' : null, a.ref.ppg ? fmt(a.ref.ppg, 1) + ' ppg' : null].filter(Boolean).join(' · ') : assetMeta(a),
    title: 'Add to the deal', note: 'tap an asset to add it to what ' + (nameOf(BT) === 'You' ? 'you send' : BT.short + ' sends') + ' · tap again to take it out',
    tabs: ['a', 'b'].map(w => ({ k: w, color: w, label: nameOf(T_OF[w]) === 'You' ? 'Your roster' : T_OF[w].name, n: outOf(w).length })), tab: bw,
    onTab: k => { R.tab = k; R.st.pos = 'all'; R.st.limit = 12; render(); },
    assets: assetsOf(BT).sort((x, y) => y.dv - x.dv), chosen: new Set(outOf(bw).map(a => a.id)),
    placeholder: 'Search ' + BT.short + ' assets…',
    onToggle: (a, inDeal) => setOut(bw, inDeal ? outOf(bw).filter(x => x.id !== a.id) : outOf(bw).concat([a])),
    onChange: () => render()
  }));
  return out;
}

/* ---------- 2. waiver wire / free agency ---------- */
function hypFaPool() {
  return freeAgents().filter(p => (p.dv || 0) > 0 || (p.ppg || 0) > 0)
    .sort((a, b) => ((b.dv || 0) - (a.dv || 0)) || ((b.ppg || 0) - (a.ppg || 0))).slice(0, 600).map(assetOfPlayer);
}
function hypFaPanel() {
  hypSetTeamDefaults();
  const F = HYP.fa, T = S.teamById[F.team];
  const pool = hypFaPool();
  const mine = T.players.map(p => assetOfPlayer(p)).sort((x, y) => x.dv - y.dv);
  // a pick or drop from an earlier look may no longer exist
  if (F.add && !pool.some(a => a.id === F.add)) F.add = null;
  if (F.drop && !mine.some(a => a.id === F.drop)) F.drop = null;
  const addA = pool.find(a => a.id === F.add), dropA = mine.find(a => a.id === F.drop);

  const spots = S.cfg.activeSpots || 0;
  const size = T.players.length - T.taxi.size - T.ir.size;
  const full = spots > 0 && size >= spots;
  const needDrop = full && !dropA;
  // the lineup effect of just this pickup and drop
  let lineupDelta = null;
  if (addA) {
    const act = T.players.filter(p => !T.taxi.has(p.id) && !T.ir.has(p.id));
    const after = act.filter(p => !dropA || p.id !== dropA.id).concat([addA.ref]);
    lineupDelta = lineupPoints(after, 'ppg') - lineupPoints(act, 'ppg');
  }
  const present = POS_ALL.filter(pos => pool.some(a => a.pos === pos));
  const process = () => {
    if (!addA || needDrop) return;
    const steps = [{ id: addA.id, isPick: false, name: addA.name, pos: addA.pos, from: null, to: T.rosterId }];
    if (dropA) steps.push({ id: dropA.id, isPick: false, name: dropA.name, pos: dropA.pos, from: T.rosterId, to: null });
    hypCommit('fa', T.short + ' +' + addA.name + (dropA ? ' −' + dropA.name : ''),
      T.name + ' signs ' + addA.name + (dropA ? ' and drops ' + dropA.name : ''), steps);
    F.add = null; F.drop = null; F.st.q = ''; F.dst.q = '';
    render(); window.scrollTo(0, 0);
  };
  const side = (label, a, col, empty) => h('div.hypsel.' + col,
    h('div.lbl', { style: { fontSize: '10px' } }, label),
    a ? h('div.row', { style: { gap: '7px', flexWrap: 'nowrap' } }, posPill(a.pos), h('b', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, a.name),
      h('button.dealx', { title: 'Clear', 'aria-label': 'Clear', onclick: () => { if (col === 'a') F.add = null; else F.drop = null; render(); } }, ico('close')))
      : h('span.tiny.muted', empty));
  const summary = card(null, null, h('div.hypsum',
    side('Sign', addA, 'a', 'Pick a free agent below'),
    h('span.hypsum-x', '⇄'),
    side('Drop', dropA, 'b', full ? 'Your roster is full — pick someone to drop' : 'Optional — you have an open spot'),
    h('div.hypsum-go',
      lineupDelta !== null ? h('div.tiny', { style: { textAlign: 'right' } }, 'Lineup ', deltaTag(lineupDelta, 1, ' pts/wk')) : null,
      h('button.btn.pri', { disabled: !addA || needDrop, onclick: process }, 'Process move'))));

  const spotsNote = spots ? `${size} of ${spots} active spots used` + (T.taxi.size || T.ir.size ? ` (${T.taxi.size} taxi and ${T.ir.size} IR do not count)` : '') : null;
  return h('div.grid',
    h('div.row', { style: { gap: '14px', flexWrap: 'wrap' } },
      h('label.fld', { style: { minWidth: '240px' } }, 'Roster making the move',
        h('select', { onchange: e => { F.team = +e.target.value; F.drop = null; F.dst.q = ''; render(); } },
          S.teams.map(t => h('option', { value: t.rosterId, selected: t.rosterId === T.rosterId }, (t.rosterId === S.myRosterId ? 'You — ' : '') + t.name)))),
      spotsNote ? h('span.tiny.muted', { style: { alignSelf: 'flex-end', paddingBottom: '9px' } }, spotsNote) : null),
    summary,
    h('div.grid.hypgrid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(min(420px,100%),1fr))' } },
      assetBrowser({
        id: 'hfa-add', color: 'a', st: F.st, picks: false, posOpts: ['all'].concat(present),
        title: 'Sign from the wire', note: 'everyone no roster holds · best first',
        assets: pool, chosen: new Set(F.add ? [F.add] : []),
        meta: a => [a.ref.team || 'FA', a.ref.age ? fmt(a.ref.age, 0) + 'y' : null, a.ref.ppg ? fmt(a.ref.ppg, 1) + ' ppg' : null].filter(Boolean).join(' · '),
        val: a => a.dv > 0 ? kfmt(Math.round(a.dv)) : fmt(a.ref.ppg || 0, 1),
        placeholder: 'Search free agents…',
        onToggle: (a, on) => { F.add = on ? null : a.id; render(); }, onChange: () => render()
      }),
      assetBrowser({
        id: 'hfa-drop', color: 'b', st: F.dst, picks: false, posOpts: ['all', 'QB', 'RB', 'WR', 'TE'],
        title: 'Drop from ' + T.short, note: 'lowest value first',
        assets: mine, chosen: new Set(F.drop ? [F.drop] : []),
        meta: a => [a.ref.team || 'FA', a.ref.age ? fmt(a.ref.age, 0) + 'y' : null, a.ref.ppg ? fmt(a.ref.ppg, 1) + ' ppg' : null].filter(Boolean).join(' · '),
        placeholder: 'Search ' + T.short + ' players…',
        onToggle: (a, on) => { F.drop = on ? null : a.id; render(); }, onChange: () => render()
      })));
}

/* ---------- 3. sandbox: any move on any roster ---------- */
function hypSandboxPanel() {
  hypSetTeamDefaults();
  const SB = HYP.sb, T = S.teamById[SB.team];
  const others = S.teams.filter(t => t.rosterId !== T.rosterId);
  const dest = [{ v: 'keep', l: 'Keep' }, { v: 'fa', l: 'Release' }].concat(others.map(o => ({ v: String(o.rosterId), l: '→ ' + o.name })));
  const stepOf = (a, from, to) => ({ id: a.kind === 'pick' ? pickKeyOf(a) : a.id, isPick: a.kind === 'pick', name: a.name, pos: a.pos, from, to });
  const act = (a, from, to) => {
    const verb = to === null ? 'released by ' + teamShortOf(from) : from === null ? 'signed by ' + teamShortOf(to) : teamShortOf(from) + ' → ' + teamShortOf(to);
    hypCommit('move', a.name + ': ' + verb, a.name + ' — ' + verb, [stepOf(a, from, to)]);
    render();
  };
  const mine = assetsOf(T).sort((x, y) => y.dv - x.dv);
  const rows = mine.map(a => {
    const isNew = a.kind === 'player' ? S.base.own[a.id] !== T.rosterId : S.base.pickOwn[pickKeyOf(a)] !== T.rosterId;
    return assetCard(a, {
      compact: true,
      extra: isNew ? h('span.tag', { style: { borderColor: 'var(--good)', color: 'var(--good-text)', flex: 'none' } }, 'IN') : null,
      action: h('select.hypdest', {
        'aria-label': 'What to do with ' + a.name,
        onchange: e => { const v = e.target.value; if (v === 'keep') return; act(a, T.rosterId, v === 'fa' ? null : +v); }
      }, dest.map(o => h('option', { value: o.v, selected: o.v === 'keep' }, o.l)))
    });
  });
  // everyone not on this roster: other teams' assets, and the free agents worth naming
  const pool = [], fromOf = {};
  S.teams.forEach(t => { if (t.rosterId === T.rosterId) return; assetsOf(t).forEach(a => { pool.push(a); fromOf[a.id] = t; }); });
  freeAgents().filter(p => (p.dv || 0) > 150).forEach(p => pool.push(assetOfPlayer(p)));
  pool.sort((x, y) => y.dv - x.dv);
  const spots = S.cfg.activeSpots || 0, size = T.players.length - T.taxi.size - T.ir.size;

  return h('div.grid',
    h('div.row', { style: { gap: '14px', flexWrap: 'wrap' } },
      h('label.fld', { style: { minWidth: '240px' } }, 'Roster to edit',
        h('select', { onchange: e => { SB.team = +e.target.value; SB.st.q = ''; render(); } },
          S.teams.map(t => h('option', { value: t.rosterId, selected: t.rosterId === T.rosterId }, (t.rosterId === S.myRosterId ? 'You — ' : '') + t.name)))),
      spots && size > spots ? h('span.tiny', { style: { alignSelf: 'flex-end', paddingBottom: '9px', color: 'var(--bad-text)', fontWeight: 560 } },
        `${T.name} carries ${size} active players for ${spots} spots — release ${size - spots} more to be legal`)
        : h('span.tiny.muted', { style: { alignSelf: 'flex-end', paddingBottom: '9px' } }, 'Every move is applied the moment you make it. Nothing has to balance.')),
    h('div.grid.hypgrid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(min(320px,100%),1fr))' } },
      card(T.name + ' — ' + mine.length + ' assets', 'send anywhere, or release', h('div.picker.hypmine', rows)),
      assetBrowser({
        id: 'hsb', color: 'b', st: SB.st, step: 12, title: 'Acquire', note: 'other rosters and free agents · tap to add to ' + T.short,
        assets: pool, chosen: new Set(),
        meta: a => (fromOf[a.id] ? fromOf[a.id].short : 'FA') + ' · ' + assetMeta(a), placeholder: 'Search anyone…',
        onToggle: (a) => act(a, fromOf[a.id] ? fromOf[a.id].rosterId : null, T.rosterId),
        onChange: () => render()
      })));
}
