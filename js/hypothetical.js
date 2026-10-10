"use strict";
/* ================= hypothetical roster sandbox =================
   Release, sign and swap players and picks, then look at any page as if those
   moves had happened. Nothing here touches Sleeper — it is a local rebuild of
   the same model from the same baseline, so exiting always restores the truth. */
var HYP = {
  on: false,
  moves: {},          // playerId -> rosterId, or null to release to free agency
  picks: {},          // pickKey  -> rosterId, or null
  team: null,         // whose roster you are editing
  open: true,         // editor expanded
  q: '',              // (older) player search
  st: { q: '', pos: 'all', limit: 12 },   // the acquire browser's query, filter and length
  seed: null,         // shared seed, so before/after odds are a paired comparison
  strict: true,       // every acquisition must be matched by something sent back
  base: null,         // metrics for the real league
  after: null,        // metrics for the current what-if
  sig: null
};
const HYP_SIMS = 1200;

function hypTeamId() {
  if (HYP.team && S.teamById[HYP.team]) return HYP.team;
  return S.myRosterId || (S.teams[0] && S.teams[0].rosterId);
}
function hypCount() { return Object.keys(HYP.moves).length + Object.keys(HYP.picks).length; }
function hypSig() {
  return JSON.stringify([HYP.moves, HYP.picks, hypTeamId()]);
}
/** Snapshot the metrics every view compares against. */
function hypMetrics(sim) {
  const out = {};
  S.teams.forEach(t => {
    const s = sim ? sim.by[t.rosterId] : null;
    out[t.rosterId] = {
      now: t.now, future: t.future, power: t.power, futurePower: t.futurePower, powerRank: t.powerRank,
      futureRank: t.futureRank, totalValue: t.totalValue, valueRank: t.valueRank,
      pickCapital: t.pickCapital, window: t.window, age: t.age,
      posNow: Object.assign({}, t.posNow),
      playoff: s ? s.playoff : null, title: s ? s.title : null, wins: s ? s.wins : null
    };
  });
  return out;
}
function hypEnter() {
  if (HYP.on) return;
  HYP.seed = (Math.random() * 4294967296) >>> 0;
  HYP.moves = {}; HYP.picks = {}; HYP.sig = null; HYP.after = null;
  HYP.team = hypTeamId();
  HYP.base = hypMetrics(simulate(HYP_SIMS, { seed: HYP.seed }));
  HYP.on = true;
  document.documentElement.setAttribute('data-hyp', '1');
}
function hypExit() {
  HYP.on = false; HYP.moves = {}; HYP.picks = {}; HYP.after = null; HYP.sig = null;
  document.documentElement.removeAttribute('data-hyp');
  applyOwnership({}, {});
}
function hypReset() {
  HYP.moves = {}; HYP.picks = {}; HYP.after = null; HYP.sig = null;
  applyOwnership({}, {});
}
/** Recompute the league under the current moves, and refresh the after-metrics. */
function hypSync() {
  if (!HYP.on) return;
  const sig = hypSig();
  if (sig === HYP.sig && HYP.after) return;
  applyOwnership(HYP.moves, HYP.picks);
  HYP.after = hypMetrics(simulate(HYP_SIMS, { seed: HYP.seed }));
  HYP.sig = sig;
}
function hypMove(playerId, toRosterId) {
  const baseOwner = S.base.own[playerId];
  if (toRosterId === baseOwner) delete HYP.moves[playerId];
  else HYP.moves[playerId] = toRosterId;
  HYP.after = null; hypSync();
}
function hypMovePick(key, toRosterId) {
  const baseOwner = S.base.pickOwn[key];
  if (toRosterId === baseOwner) delete HYP.picks[key];
  else HYP.picks[key] = toRosterId;
  HYP.after = null; hypSync();
}
/* which views actually change when a roster changes */
const HYP_VIEWS = { roster: 1, lineup: 1, power: 1, sim: 1, finder: 1, trade: 1, scout: 1, stock: 1, player: 1 };
const HYP_UNAFFECTED = {
  week: 'This Week is scored from games that are already happening. A hypothetical roster does not change points that have been banked, so the live totals and matchups here stay real.',
  standings: 'Active Rankings is pure results — wins, losses and points actually scored. A hypothetical roster cannot change games that have already been played.',
  draft: 'The draft board is a historical record of picks that were actually made, so a hypothetical roster does not change it.',
  trades: 'Trade History is a record of deals that actually happened, so a hypothetical roster does not change it. The grades already use live market values.'
};

/* ---------- trade bookkeeping ----------
   A player can only arrive from somewhere. In strict mode every partner you take
   from must also receive something, otherwise the "after" league is not one that
   could actually exist and the comparison is worthless. */
function assetLabel(id, isPick) {
  if (isPick) {
    const parts = id.split('|');
    return parts[0] + ' round ' + parts[1] + (S.teamById[+parts[2]] ? ' (' + S.teamById[+parts[2]].short + ')' : '');
  }
  const p = S.index[id] || ensurePlayer(id);
  return p.name;
}
function assetValue(id, isPick) {
  if (!isPick) { const p = S.index[id]; return p ? (p.dv || 0) : 0; }
  for (const t of S.teams) { const a = (t.pickAssets || []).find(x => pickKeyOf(x) === id); if (a) return a.dv || 0; }
  const parts = id.split('|');
  return pickValue(+parts[0], +parts[1], 'Mid');
}
function hypLedgers() {
  const me = hypTeamId();
  const partners = {}, fa = { added: [], dropped: [] }, thirdParty = [];
  const consider = (id, isPick, from, to) => {
    if (from === me && to !== me) {
      if (to === null || to === undefined) { fa.dropped.push({ id, isPick }); return; }
      (partners[to] = partners[to] || { out: [], in: [] }).out.push({ id, isPick });
    } else if (to === me && from !== me) {
      if (from === null || from === undefined) { fa.added.push({ id, isPick }); return; }
      (partners[from] = partners[from] || { out: [], in: [] }).in.push({ id, isPick });
    } else if (from !== me && to !== me) {
      thirdParty.push({ id, isPick, from, to });
    }
  };
  for (const id in HYP.moves) consider(id, false, S.base.own[id], HYP.moves[id]);
  for (const k in HYP.picks) consider(k, true, S.base.pickOwn[k], HYP.picks[k]);
  const list = Object.keys(partners).map(rid => {
    const L = partners[rid];
    const outVal = sum(L.out.map(x => assetValue(x.id, x.isPick)));
    const inVal = sum(L.in.map(x => assetValue(x.id, x.isPick)));
    const hi = Math.max(outVal, inVal), lo = Math.min(outVal, inVal);
    return {
      rosterId: +rid, team: S.teamById[+rid], out: L.out, in: L.in, outVal, inVal,
      twoSided: L.out.length > 0 && L.in.length > 0,
      fair: hi > 0 ? lo / hi : 1
    };
  });
  return { list, fa, thirdParty, me };
}
function hypValidity() {
  const L = hypLedgers();
  const oneSided = L.list.filter(x => !x.twoSided);
  const T = S.teamById[L.me];
  const spots = S.cfg.activeSpots || 0;
  // Neither an IR nor a taxi player occupies an active spot.
  const size = T ? T.players.length - T.taxi.size - T.ir.size : 0;
  return {
    ledgers: L, oneSided, thirdParty: L.thirdParty,
    ok: oneSided.length === 0 && L.thirdParty.length === 0,
    size, spots, ir: T ? T.ir.size : 0, taxi: T ? T.taxi.size : 0,
    overLimit: spots > 0 && size > spots
  };
}
/** Nearest-value asset from the side that owes something, to even a trade up. */
function hypBalanceSuggestion(led) {
  const me = hypTeamId();
  const needFrom = led.in.length && !led.out.length ? me : led.rosterId;
  const targetVal = needFrom === me ? led.inVal : led.outVal;
  const T = S.teamById[needFrom];
  if (!T) return null;
  const already = new Set(led.out.concat(led.in).map(x => x.id));
  // Only offer assets this side actually owns in the real league. Passing on a
  // player you just acquired elsewhere is a three-team deal, not a trade.
  const pool = assetsOf(T).filter(a => {
    const key = a.kind === 'pick' ? pickKeyOf(a) : a.id;
    if (already.has(key)) return false;
    // and not something already promised elsewhere in this sandbox: re-routing
    // a player who is part of another leg repairs this trade by breaking that one
    if (a.kind === 'pick' ? HYP.picks[key] !== undefined : HYP.moves[key] !== undefined) return false;
    const baseOwner = a.kind === 'pick' ? S.base.pickOwn[key] : S.base.own[key];
    return baseOwner === needFrom;
  });
  if (!pool.length) return null;
  pool.sort((x, y) => Math.abs(x.dv - targetVal) - Math.abs(y.dv - targetVal));
  return { asset: pool[0], from: needFrom, to: needFrom === me ? led.rosterId : me };
}

/* ---------- the bar that appears on every affected page ---------- */
function hypBar() {
  if (!HYP.on) return null;
  hypSync();
  const T = S.teamById[hypTeamId()];
  if (!T) return null;
  const b = HYP.base[T.rosterId], a = HYP.after[T.rosterId];
  const n = hypCount();

  const stat = (label, before, after, dec, isPct, invertRank) => {
    const d = after - before;
    const f = (v) => isPct ? pct(v, dec) : fmt(v, dec);
    return h('div', { style: { display: 'grid', gap: '1px', minWidth: 0 } },
      h('div.lbl', { style: { fontSize: '10px' } }, label),
      h('div.row', { style: { gap: '6px', alignItems: 'baseline' } },
        h('span.tiny.muted.mono', f(before)),
        h('span.tiny.muted', '→'),
        h('b.mono', { style: { fontSize: '15px' } }, f(after))),
      Math.abs(d) < (isPct ? 0.0005 : 0.05)
        ? h('span.tiny.flat', 'no change')
        : deltaTag(invertRank ? -d : d, dec, isPct ? 'pp' : ''));
  };
  const rankStat = (label, before, after) => h('div', { style: { display: 'grid', gap: '1px' } },
    h('div.lbl', { style: { fontSize: '10px' } }, label),
    h('div.row', { style: { gap: '6px', alignItems: 'baseline' } },
      h('span.tiny.muted.mono', '#' + before), h('span.tiny.muted', '→'),
      h('b.mono', { style: { fontSize: '15px' } }, '#' + after)),
    before === after ? h('span.tiny.flat', 'no change')
      : h('span', { class: after < before ? 'up' : 'down', style: { fontSize: '11.5px', fontWeight: 620 } },
        (after < before ? '▲ up ' : '▼ down ') + Math.abs(after - before)));

  const summary = h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(118px,1fr))', gap: '12px' } },
    stat('Lineup pts/wk', b.now, a.now, 1),
    rankStat('Power rank', b.powerRank, a.powerRank),
    dynOnly(rankStat('Future rank', b.futureRank, a.futureRank)),
    stat(capitalLabel(), b.totalValue, a.totalValue, 0),
    b.playoff !== null ? stat('Playoff odds', b.playoff, a.playoff, 0, true) : null,
    b.title !== null ? stat('Title odds', b.title, a.title, 1, true) : null
  );

  const V = hypValidity();
  const blocked = HYP.strict && !V.ok && n > 0;

  const head = h('div.row', { style: { justifyContent: 'space-between', gap: '10px' } },
    h('div.row', { style: { gap: '9px' } },
      h('span.hyp-badge', 'HYPOTHETICAL'),
      h('select', {
        style: { fontSize: '12.5px', padding: '4px 8px' },
        onchange: e => { HYP.team = +e.target.value; HYP.after = null; render(); }
      }, S.teams.map(t => h('option', { value: t.rosterId, selected: t.rosterId === T.rosterId }, t.name))),
      h('span.tiny.muted', n ? n + (n === 1 ? ' move' : ' moves') + ' applied' : 'no moves yet — the numbers below are the real league')),
    h('div.row', { style: { gap: '6px' } },
      segmented([{ k: true, label: 'Balanced trades' }, { k: false, label: 'Free edits' }], HYP.strict,
        v => { HYP.strict = v; render(); }),
      h('button.btn.sm', { onclick: () => { HYP.open = !HYP.open; render(); } }, HYP.open ? 'Hide editor' : 'Edit roster'),
      n ? h('button.btn.sm', { onclick: () => { hypReset(); render(); } }, 'Reset moves') : null,
      h('button.btn.sm', { onclick: () => { hypExit(); render(); } }, 'Exit')));

  return h('div.hypbar',
    h('div', { style: { display: 'grid', gap: '12px' } },
      head,
      n ? (V.ledgers.list.length || V.thirdParty.length ? hypLedgerView(V) : null) : null,
      V.overLimit ? h('div.tiny', { style: { color: 'var(--bad-text)', fontWeight: 560 } },
        `${T.name} would carry ${V.size} active players for ${V.spots} active spots`
        + (V.ir || V.taxi ? ` (${V.taxi} on taxi and ${V.ir} on IR do not count)` : '')
        + ` — you would need to release ${V.size - V.spots} more.`) : null,
      blocked ? hypBlockedNotice(V)
        : (n ? summary : h('div.tiny.muted', 'Release, sign or swap players below and every page will recompute as if it had happened. Nothing is sent to Sleeper.')),
      HYP.open ? hypEditor(T) : null,
      n ? hypMoveList() : null));
}

/* ---------- the editor: your roster on the left, everyone else on the right ---------- */
function hypEditor(T) {
  const others = S.teams.filter(t => t.rosterId !== T.rosterId);
  const dest = (cur) => [{ v: T.rosterId, l: 'Keep' }, { v: '', l: 'Release' }]
    .concat(others.map(o => ({ v: o.rosterId, l: '→ ' + o.name })));

  const mine = assetsOf(T).sort((x, y) => y.dv - x.dv);
  const rows = mine.map(a => {
    const isNew = a.kind === 'player'
      ? (S.base.own[a.id] !== T.rosterId)
      : (S.base.pickOwn[pickKeyOf(a)] !== T.rosterId);
    return assetCard(a, {
      compact: true,
      extra: isNew ? h('span.tag', { style: { borderColor: 'var(--good)', color: 'var(--good-text)', flex: 'none' } }, 'IN') : null,
      action: h('select.hypdest', {
        'aria-label': 'What to do with ' + a.name,
        onchange: e => {
          const v = e.target.value === '' ? null : +e.target.value;
          if (a.kind === 'player') hypMove(a.id, v); else hypMovePick(pickKeyOf(a), v);
          render();
        }
      }, dest().map(o => h('option', { value: o.v, selected: o.v === T.rosterId }, o.l)))
    });
  });

  // everyone not on this roster, free agents included
  const pool = [], fromOf = {};
  S.teams.forEach(t => { if (t.rosterId === T.rosterId) return; assetsOf(t).forEach(a => { pool.push(a); fromOf[a.id] = t; }); });
  Object.values(S.index).forEach(p => {
    if (S.base.own[p.id] === undefined && HYP.moves[p.id] === undefined && (p.dv || 0) > 150 && !ownerOfPlayer(p.id))
      pool.push(assetOfPlayer(p));
  });
  pool.sort((x, y) => y.dv - x.dv);

  return h('div.grid.hypgrid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(min(300px,100%),1fr))', gap: '14px', borderTop: '1px solid var(--border)', paddingTop: '12px' } },
    h('div', { style: { minWidth: 0 } },
      h('div.row', { style: { justifyContent: 'space-between', marginBottom: '6px' } },
        h('label.fld', { style: { gap: 0 } }, T.name + ' — ' + mine.length + ' assets'),
        h('span.tiny.muted', 'send anywhere, or release')),
      h('div.picker.hypmine', rows)),
    h('div', { style: { minWidth: 0 } },
      assetBrowser({
        id: 'hbrowse', color: 'b', st: HYP.st, step: 12, title: 'Acquire', note: 'other rosters and free agents · tap to add to ' + T.short,
        assets: pool, chosen: new Set(),
        meta: a => (fromOf[a.id] ? fromOf[a.id].short : 'FA') + ' · ' + assetMeta(a), placeholder: 'Search anyone…',
        onToggle: (a) => { if (a.kind === 'player') hypMove(a.id, T.rosterId); else hypMovePick(pickKeyOf(a), T.rosterId); render(); },
        onChange: () => render()
      })));
}
function pickKeyOf(a) {
  if (a.kind !== 'pick') return null;
  const r = a.ref;
  return r.season + '|' + r.round + '|' + r.origRosterId;
}

function hypMoveList() {
  const rows = [];
  const nameOfTeam = (rid) => rid === null || rid === undefined ? 'free agency' : (S.teamById[rid] || {}).name || '?';
  for (const id in HYP.moves) {
    const p = S.index[id] || ensurePlayer(id);
    rows.push({ label: p.name, pos: p.pos, from: nameOfTeam(S.base.own[id]), to: nameOfTeam(HYP.moves[id]), undo: () => { delete HYP.moves[id]; HYP.after = null; hypSync(); render(); } });
  }
  for (const k in HYP.picks) {
    const parts = k.split('|');
    rows.push({
      label: parts[0] + ' round ' + parts[1] + ' (' + ((S.teamById[+parts[2]] || {}).short || '?') + ')', pos: 'PICK',
      from: nameOfTeam(S.base.pickOwn[k]), to: nameOfTeam(HYP.picks[k]),
      undo: () => { delete HYP.picks[k]; HYP.after = null; hypSync(); render(); }
    });
  }
  return h('div', { style: { borderTop: '1px solid var(--border)', paddingTop: '10px', display: 'grid', gap: '4px' } },
    h('div.lbl', { style: { fontSize: '10px', marginBottom: '2px' } }, 'Moves applied'),
    rows.map(r => h('div.row', { style: { gap: '8px', fontSize: '12px' } },
      posPill(r.pos),
      h('b', r.label),
      h('span.tiny.muted', r.from + ' → ' + r.to),
      h('span', { style: { flex: 1 } }),
      h('button.btn.sm', { onclick: r.undo }, 'Undo'))));
}

/* ---------- the one-line note for pages a roster change cannot touch ---------- */
function hypNote(view) {
  if (!HYP.on || !HYP_UNAFFECTED[view]) return null;
  return h('div.hypbar.quiet',
    h('div.row', { style: { gap: '9px' } },
      h('span.hyp-badge', 'HYPOTHETICAL'),
      h('span.tiny.sec', HYP_UNAFFECTED[view])));
}

/* ---------- per-partner ledger, so a trade reads as a trade ---------- */
function hypLedgerView(V) {
  const me = hypTeamId();
  const chip = (x) => h('span.tag', { style: { fontWeight: 560 } }, assetLabel(x.id, x.isPick));
  const rows = V.ledgers.list.map(led => {
    const sug = led.twoSided ? null : hypBalanceSuggestion(led);
    return h('div', {
      style: {
        border: '1px solid ' + (led.twoSided ? 'var(--border)' : 'var(--critical)'),
        borderRadius: 'var(--r-sm)', padding: '8px 10px', background: 'var(--surface-1)', display: 'grid', gap: '6px'
      }
    },
      h('div.row', { style: { justifyContent: 'space-between', gap: '8px' } },
        h('div.row', { style: { gap: '7px' } },
          h('b.tiny', 'with ' + (led.team ? led.team.name : '?')),
          led.twoSided
            ? h('span.tag', { style: { borderColor: 'var(--good)', color: 'var(--good-text)' } }, 'balance ' + pct(led.fair, 0))
            : h('span.tag', { style: { borderColor: 'var(--critical)', color: 'var(--bad-text)' } }, led.in.length ? 'nothing sent back' : 'nothing coming back')),
        sug ? h('button.btn.sm', {
          onclick: () => {
            const a = sug.asset;
            if (a.kind === 'pick') hypMovePick(pickKeyOf(a), sug.to); else hypMove(a.id, sug.to);
            render();
          }
        }, 'Even it up with ' + sug.asset.name) : null),
      h('div.row', { style: { gap: '10px', alignItems: 'flex-start' } },
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div.tiny.muted', 'you send · ' + kfmt(Math.round(led.outVal))),
          h('div.row', { style: { gap: '4px' } }, led.out.length ? led.out.map(chip) : h('span.tiny.muted', '—'))),
        h('div.tiny.muted', '⇄'),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div.tiny.muted', 'you get · ' + kfmt(Math.round(led.inVal))),
          h('div.row', { style: { gap: '4px' } }, led.in.length ? led.in.map(chip) : h('span.tiny.muted', '—')))));
  });
  const fa = V.ledgers.fa;
  if (fa.added.length || fa.dropped.length) {
    rows.push(h('div', { style: { border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '8px 10px', background: 'var(--surface-1)' } },
      h('div.row', { style: { gap: '7px' } }, h('b.tiny', 'free agency'),
        h('span.tiny.muted', 'no other roster is touched')),
      h('div.row', { style: { gap: '10px', marginTop: '4px' } },
        h('div', { style: { flex: 1 } }, h('div.tiny.muted', 'released'), h('div.row', { style: { gap: '4px' } }, fa.dropped.length ? fa.dropped.map(chip) : h('span.tiny.muted', '—'))),
        h('div', { style: { flex: 1 } }, h('div.tiny.muted', 'signed'), h('div.row', { style: { gap: '4px' } }, fa.added.length ? fa.added.map(chip) : h('span.tiny.muted', '—'))))));
  }
  if (V.thirdParty.length) {
    rows.push(h('div', { style: { border: '1px solid var(--critical)', borderRadius: 'var(--r-sm)', padding: '8px 10px', background: 'var(--surface-1)' } },
      h('b.tiny', V.thirdParty.length + ' move' + (V.thirdParty.length === 1 ? '' : 's') + ' between two other teams'),
      h('div.tiny.muted', 'These do not involve ' + (S.teamById[me] || {}).name + ', so they cannot be part of your trade.')));
  }
  return h('div', { style: { display: 'grid', gap: '7px' } }, rows);
}

function hypBlockedNotice(V) {
  const bits = [];
  V.oneSided.forEach(led => bits.push((led.team ? led.team.name : 'a team')
    + (led.in.length ? ' has not received anything back' : ' has not sent anything')));
  if (V.thirdParty.length) bits.push(V.thirdParty.length + ' move(s) involve two other teams');
  return h('div', {
    style: {
      border: '1px solid var(--critical)', borderRadius: 'var(--r-sm)', padding: '10px 12px',
      background: 'color-mix(in srgb, var(--critical) 7%, transparent)', display: 'grid', gap: '4px'
    }
  },
    h('div.row', { style: { gap: '7px' } },
      h('span', { style: { color: 'var(--critical)', fontWeight: 700 } }, '!'),
      h('b', 'Impact hidden — this is not a trade anyone could make')),
    h('div.tiny.sec', bits.join(' · ') + '.'),
    h('div.tiny.muted',
      'A one-sided move makes your team better and theirs worse in a way that could never happen, so the simulated odds either side of it would not be comparable. '
      + 'Send something back, or switch to Free edits if you only want to see what a roster looks like without the other team reacting.'));
}
