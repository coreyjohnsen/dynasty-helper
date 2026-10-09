"use strict";
/* ================= 11. GM SCOUT ================= */
const ScoutUI = { team: null, mode: 'starters' };
function viewScout() {
  const wrap = h('div.grid');
  const stats = traderStats();
  const statBy = {}; stats.list.forEach(s => statBy[s.team.rosterId] = s);
  const scouts = S.teams.map(t => {
    const sc = scoutTeam(t);
    sc.stat = statBy[t.rosterId];
    sc.strategy = projectedStrategy(t, sc.stat);
    return sc;
  });
  if (ScoutUI.team === null || !S.teamById[ScoutUI.team]) ScoutUI.team = S.myRosterId || S.teams[0].rosterId;

  // ---- league-wide needs matrix ----
  // kickers and defences are out of the scouting view entirely — they are
  // streamed week to week, so "who needs a kicker" is not a question anyone
  // trades on. A position with no projected output anywhere is a dead column
  // of zeroes too, so leave that out rather than implying every team is equal.
  const posList = POS4.filter(p => (slotDemand()[p] || 0) > 0)
    .filter(p => scouts.some(sc => { const e = sc.pos.find(x => x.pos === p); return e && e.output > 0.05; }));
  const ordered = scouts.slice().sort((a, b) => a.team.powerRank - b.team.powerRank);
  /* The same grid answers three different questions, and only the first of them
     used to be on the page. Output says who is strong; depth says who is one
     knock away from a hole; shape says which trade they would actually take. */
  const DEPTH = depthLeague();
  const MODES = [
    { k: 'starters', label: 'Starters', blurb: 'what each position produces now — red is a hole worth exploiting, blue is a surplus they can sell from' },
    { k: 'depth', label: 'Depth', blurb: 'what the first man off the bench is worth — red means a bye or a knock turns that position into a hole' },
    { k: 'shape', label: 'Shape', blurb: 'what the group looks like, and so what they would trade for: THIN needs a starter, TOP wants depth, FLAT wants a difference-maker, DEEP can sell' }
  ];
  if (!MODES.some(m => m.k === ScoutUI.mode)) ScoutUI.mode = 'starters';
  const mode = ScoutUI.mode;
  const grid = h('div', { style: { display: 'grid', gridTemplateColumns: `minmax(130px,1.5fr) repeat(${posList.length}, minmax(56px,1fr))`, gap: '2px', minWidth: (150 + posList.length * 62) + 'px' } });
  grid.appendChild(h('div'));
  posList.forEach(p => grid.appendChild(h('div.tiny.muted', { style: { textAlign: 'center', fontWeight: 660, paddingBottom: '2px' } }, p)));
  ordered.forEach(sc => {
    grid.appendChild(h('div.tiny', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', alignSelf: 'center', fontWeight: 540, cursor: 'pointer' }, onclick: () => { ScoutUI.team = sc.team.rosterId; render(); } }, sc.team.name));
    posList.forEach(p => {
      const e = sc.pos.find(x => x.pos === p) || { z: 0, startable: 0, need: 0, output: 0 };
      const d = DEPTH.byTeam[sc.team.rosterId] ? DEPTH.byTeam[sc.team.rosterId][p] : null;
      const z = mode === 'depth' && d ? d.zDepth : e.z;
      const shade = (zz, on) => zz >= 0
        ? `color-mix(in srgb, var(--s1) ${Math.round(clamp(zz / 2, 0, 1) * 62)}%, var(--surface-1))`
        : `color-mix(in srgb, var(--s8) ${Math.round(clamp(-zz / 2, 0, 1) * 62)}%, var(--surface-1))`;
      const bg = mode === 'shape' && d
        ? (d.shape === 'covered' ? 'var(--surface-1)' : `color-mix(in srgb, ${d.verdict.colour} 34%, var(--surface-1))`)
        : shade(z);
      const text = mode === 'shape' ? (d ? d.verdict.tag : '—')
        : mode === 'depth' ? (d ? fmt(d.nextUp, 1) : '—')
          : fmt(e.output, 1);
      const cell = h('div.mono', {
        tabindex: 0,
        style: {
          background: bg, textAlign: 'center', padding: '7px 4px', borderRadius: '5px', fontSize: '11.5px', fontWeight: 600, cursor: 'pointer',
          color: mode !== 'shape' && Math.abs(z) > 1.4 ? '#fff' : 'var(--text-primary)',
          border: mode === 'shape' && d && d.shape !== 'covered' ? '1px solid ' + d.verdict.colour : '1px solid transparent'
        },
        onclick: () => { ScoutUI.team = sc.team.rosterId; render(); }
      }, text);
      bindTT(cell, `<div class="k">${sc.team.name} · ${p}</div>` +
        `Starters produce <b>${fmt(e.output, 1)}</b> pts/wk (${e.rank ? ord(e.rank) : '—'} of ${S.teams.length})<br>` +
        (d ? `Next man up <b>${fmt(d.nextUp, 1)}</b> against a league ${fmt(d.lgDepth, 1)}<br>` : '') +
        `${e.startable} startable for ${e.need} slot${e.need === 1 ? '' : 's'}<br>` +
        (d ? `<b style="color:${d.verdict.colour}">${d.verdict.label}</b>${d.verdict.want ? ' — they want ' + d.verdict.want : ''}<br>${d.note}`
          : (e.hole ? '<b style="color:var(--bad-text)">A hole they should be shopping for</b>' : e.surplus ? '<b style="color:var(--good-text)">Surplus they can afford to sell from</b>' : 'Adequately covered')));
      grid.appendChild(cell);
    });
  });
  const modeRow = h('div.row', { style: { gap: '6px', marginBottom: '10px', flexWrap: 'wrap' } },
    MODES.map(m => h('button.chip' + (m.k === mode ? '.on' : ''), { onclick: () => { ScoutUI.mode = m.k; render(); } }, m.label)));
  wrap.appendChild(card('Who needs what',
    (MODES.find(m => m.k === mode) || MODES[0]).blurb + '. Click a team for the full report.',
    h('div', modeRow, scrollBox(grid),
      h('div.legend', { style: { marginTop: '11px' } },
        mode === 'shape'
          ? Object.keys(DEPTH_SHAPES).filter(k => k !== 'covered').map(k => h('span',
            h('i', { style: { background: DEPTH_SHAPES[k].colour } }),
            DEPTH_SHAPES[k].tag + ' ' + DEPTH_SHAPES[k].label.toLowerCase() + (DEPTH_SHAPES[k].want ? ' — wants ' + DEPTH_SHAPES[k].want : '')))
          : [h('span', h('i', { style: { background: 'var(--s8)' } }), mode === 'depth' ? 'Nothing behind the starters' : 'Weak — they need help here'),
          h('span', h('i', { style: { background: 'var(--surface-3)' } }), 'Covered'),
          h('span', h('i', { style: { background: 'var(--s1)' } }), mode === 'depth' ? 'Real players on the bench' : 'Strong — they can trade from it')]))));

  // ---- summary table ----
  wrap.appendChild(card('Every team at a glance', 'strategy is inferred from the roster and from the trades they have actually made',
    table([
      { k: 'name', h: 'Team', sort: r => r.team.name, f: r => teamCell(r.team) },
      { k: 'power', prio: 2, h: 'Power', num: true, sort: r => r.team.powerRank, f: r => '#' + r.team.powerRank },
      isDynasty() ? { k: 'window', prio: 2, h: 'Window', sort: r => r.team.window, f: r => h('span.tag', r.team.window) } : null,
      { k: 'strategy', h: 'Projected strategy', sort: r => r.strategy.headline, f: r => h('b.tiny', r.strategy.headline) },
      { k: 'dir', prio: 2, h: 'Trading', sort: r => r.strategy.direction.label, f: r => h('span.tiny', r.strategy.direction.label + (r.stat && r.stat.n ? ' (' + r.stat.n + ')' : '')) },
      // three pills per cell is 110px twice over on a phone; the top two carry it
      // on a phone the hole is the actionable half — it is what you can go and buy
      { k: 'strong', prio: 2, h: 'Strength', sortable: false, f: r => r.strengths.length ? h('div.row', { style: { gap: '3px' } }, r.strengths.slice(0, isNarrow() ? 2 : 3).map(x => posPill(x.pos))) : h('span.muted.tiny', '—') },
      { k: 'weak', h: 'Hole', sortable: false, f: r => r.holes.length ? h('div.row', { style: { gap: '3px' } }, r.holes.slice(0, isNarrow() ? 2 : 3).map(x => posPill(x.pos))) : h('span.muted.tiny', 'none') },
      isDynasty() ? { k: 'age', prio: 2, h: 'Age', num: true, sort: r => r.team.age || 0, f: r => r.team.age ? fmt(r.team.age, 1) : '—' } : null,
      isDynasty()
        ? { k: 'picks', prio: 2, h: 'Pick capital', num: true, sort: r => r.team.pickCapital, f: r => kfmt(Math.round(r.team.pickCapital)) }
        : { k: 'value', prio: 2, h: 'Roster value', num: true, sort: r => r.team.totalValue, f: r => kfmt(Math.round(r.team.totalValue)) }
    ], scouts, { sortKey: 'power', sortDir: 1, onRow: r => { ScoutUI.team = r.team.rosterId; render(); } })));

  // ---- selected team dossier ----
  const sc = scouts.find(x => x.team.rosterId === ScoutUI.team) || scouts[0];
  const t = sc.team;
  const dpOf = (pos) => (DEPTH.byTeam[t.rosterId] || {})[pos] || null;
  wrap.appendChild(card('Scouting report — ' + t.name, t.owner,
    h('div', { style: { display: 'grid', gap: '14px' } },
      h('div.row', { style: { gap: '9px' } },
        h('span.tag', { style: { borderColor: 'var(--s1)', color: 'var(--s1)' } }, sc.strategy.headline),
        t.window ? h('span.tag', t.window) : null,
        h('span.tag', sc.strategy.direction.label),
        h('span.tiny.muted', sc.strategy.detail)),
      h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(min(150px,100%),1fr))' } },
        kpi('Power', '#' + t.powerRank, fmt(t.power, 1) + ' rating'),
        dynOnly(kpi('Future', '#' + t.futureRank, fmt(t.futurePower, 1) + ' rating')),
        kpi(capitalLabel(), kfmt(Math.round(t.totalValue)), ord(t.valueRank) + ' of ' + S.teams.length),
        dynOnly(kpi('Pick capital', kfmt(Math.round(t.pickCapital)), (t.pickAssets || []).length + ' picks')),
        dynOnly(kpi('Core age', t.age ? fmt(t.age, 1) : '—', sc.young + ' young / ' + sc.old + ' older starters')),
        isDynasty() ? null : kpi('Starting lineup', fmt(t.now, 1), 'projected pts/week'),
        kpi('Trades made', sc.stat ? String(sc.stat.n) : '0', sc.stat && sc.stat.grade ? 'avg grade ' + sc.stat.grade : 'no trades yet')),
      table([
        { k: 'pos', h: 'Pos', f: r => posPill(r.pos), sort: r => r.pos },
        { k: 'output', h: 'Starters produce', num: true, f: r => h('b.mono', fmt(r.output, 1)) },
        { k: 'rank', prio: 2, h: 'Rank', num: true, f: r => r.rank ? ord(r.rank) : '—' },
        { k: 'depth', h: 'Startable / slots', sortable: false, f: r => h('span.mono', r.startable + ' / ' + r.need) },
        {
          k: 'next', h: 'Next man up', num: true, prio: 2,
          sort: r => (dpOf(r.pos) || {}).nextUp || 0,
          f: r => { const d = dpOf(r.pos); return d ? h('span', h('span.mono', fmt(d.nextUp, 1)), h('span.muted.tiny', ' vs ' + fmt(d.lgDepth, 1))) : h('span.muted.tiny', '—'); }
        },
        { k: 'best', prio: 2, h: 'Best', sortable: false, f: r => r.best ? pname(r.best) : h('span.muted.tiny', 'nobody') },
        {
          k: 'shape', h: 'Shape', keepSimple: true, sort: r => (dpOf(r.pos) || {}).shape || '',
          f: r => { const d = dpOf(r.pos); return d ? h('span.tag', { style: { borderColor: d.verdict.colour, color: d.verdict.colour }, title: d.note }, d.verdict.label) : h('span.muted.tiny', '—'); }
        },
        /* The old hole/surplus verdict used to sit here. Shape says everything it
           said and more, and two columns grading the same group on two slightly
           different thresholds only ever disagree in public. */
      ], sc.pos, { sortKey: 'shape', sortDir: 1 }),
      h('div.tiny.muted',
        sc.holes.length
          ? 'Approach: offer them ' + sc.holes.map(x => x.pos).join(' or ') + ' help, and ask for ' + (sc.surplus.length ? sc.surplus.map(x => x.pos).join(' or ') : 'picks') + ' back.'
          : 'No obvious hole to exploit — they are covered everywhere that matters.'))));

  /* ---- the same roster as shapes rather than totals ---- */
  const prof = depthProfile(t);
  const depthCard = proOnly(card('Starters and depth — ' + t.name,
    'each group tallest first: filled bars start, hollow bars wait. The dashed rule is what the league gets from its starters at that position, the dotted one is what the wire is worth',
    h('div',
      h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(min(236px,100%),1fr))', gap: '12px' } },
        prof.map(e => h('div', { style: { border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '10px 11px', background: 'var(--surface-1)', minWidth: 0 } },
          h('div.row', { style: { gap: '7px', marginBottom: '7px' } },
            posPill(e.pos),
            h('span.tag', { style: { borderColor: e.verdict.colour, color: e.verdict.colour } }, e.verdict.label),
            h('span', { style: { flex: 1 } }),
            e.verdict.want ? h('span.tiny.muted', 'wants ' + e.verdict.want) : null),
          depthBars(e, { colour: e.verdict.colour === 'var(--text-muted)' ? 'var(--s1)' : e.verdict.colour }),
          h('div.tiny', { style: { marginTop: '7px' } },
            h('b.mono', fmt(e.startAvg, 1)), h('span.muted', ' a slot from ' + e.n + ' starter' + (e.n === 1 ? '' : 's') + ' (lg ' + fmt(e.lgStart, 1) + ') · '),
            h('b.mono', fmt(e.nextUp, 1)), h('span.muted', ' next up (lg ' + fmt(e.lgDepth, 1) + ')')),
          h('div.tiny.muted', { style: { marginTop: '4px' } }, e.note)))),
      h('div.tiny.muted', { style: { marginTop: '10px' } },
        'A group is judged on three things rather than its total: what the starters produce against the rest of the league, '
        + 'what stands behind them, and whether anyone in it is a difference-maker — a best player a clear step above the best the rest of the league has, '
        + fmt((depthLeague().base[prof[0] ? prof[0].pos : 'QB'] || {}).elite || 0, 1) + ' a week at ' + (prof[0] ? prof[0].pos : '') + '. '
        + 'Two stars and a cliff and four of the same player both read as "covered" on output alone, and they want opposite trades. '
        + 'A slot is never counted below the dotted line, because nobody starts a player projecting nothing when the wire is there — '
        + 'so a bar under that line is a body, not a starter.'))));
  if (depthCard) wrap.appendChild(depthCard);

  /* ---- what that shape is worth at the table ---- */
  const meTeam = S.teamById[S.myRosterId] || S.teams[0];
  const mine = sc.team.rosterId === meTeam.rosterId;
  const openings = depthOpenings(meTeam);
  const rel = (mine ? openings : openings.filter(o => o.team.rosterId === sc.team.rosterId)).slice(0, mine ? 8 : 6);
  const kindTag = { depth: 'wants depth', starter: 'needs a starter', consolidate: 'wants a difference-maker' };
  wrap.appendChild(card(mine ? 'Where your shape fits the league' : 'How to trade with ' + t.name,
    mine ? 'positions where somebody else\'s shape and yours point at the same deal — priced evenly, these are the trades both sides want'
      : 'read off their shape against your roster, not off the price of the pieces',
    rel.length
      ? h('div', { style: { display: 'grid', gap: '9px' } },
        rel.map(o => h('div', {
          style: {
            display: 'grid', gridTemplateColumns: isNarrow() ? '1fr' : 'minmax(0,1fr) auto', gap: '9px', alignItems: 'center',
            border: '1px solid var(--border)', borderLeft: '3px solid ' + o.them.verdict.colour,
            borderRadius: 'var(--r-sm)', padding: '9px 11px', background: 'var(--surface-1)'
          }
        },
          h('div', { style: { minWidth: 0 } },
            h('div.row', { style: { gap: '7px', flexWrap: 'wrap' } },
              posPill(o.pos),
              mine ? h('b.tiny', o.team.name) : null,
              h('span.tag', { style: { borderColor: o.them.verdict.colour, color: o.them.verdict.colour } }, kindTag[o.kind]),
              h('span.tiny.muted', 'you send'), pname(o.offer)),
            h('div.tiny.muted', { style: { marginTop: '5px' } }, o.why)),
          h('button.btn.sm', {
            onclick: () => {
              FinderUI.team = meTeam.rosterId; FinderUI.partners = [o.team.rosterId];
              FinderUI.focus = o.offer.id; FinderUI.positions = [];
              FinderUI.shape = o.kind === 'consolidate' ? 'consolidate' : 'any';
              FinderUI.results = null; S.view = 'finder'; render(); window.scrollTo(0, 0);
            }
          }, 'Build it'))))
      : h('div.empty', mine
        ? 'Nobody in the league is shaped the opposite way to you right now — no position where their gap is your spare.'
        : 'Their groups are the same shape as yours, so there is no depth-for-star deal here. The value finder is the way in.')));
  return wrap;
}

