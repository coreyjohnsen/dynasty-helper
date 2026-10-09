"use strict";
/* ================= 12. TRADE HISTORY ================= */
const TradesUI = { team: null };
function viewTrades() {
  const wrap = h('div.grid');
  const { list, trades } = traderStats();
  if (!trades.length) {
    wrap.appendChild(card('Trade history', null, h('div.empty',
      h('div', { style: { fontWeight: 600, color: 'var(--text-secondary)' } }, 'No completed trades yet'),
      h('div.tiny', { style: { marginTop: '6px', maxWidth: '520px', margin: '6px auto 0' } },
        'Sleeper reports no completed trades in this league’s current season. If the league has run before, earlier trades live under the previous season’s league and are not loaded here.'))));
    return wrap;
  }
  const graded = list.filter(x => x.n > 0);
  const best = graded.slice().sort((a, b) => b.avgScore - a.avgScore)[0];
  const busiest = graded.slice().sort((a, b) => b.n - a.n)[0];
  const richest = graded.slice().sort((a, b) => b.net - a.net)[0];

  wrap.appendChild(h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(min(160px,100%),1fr))' } },
    kpi('Completed trades', String(trades.length), graded.length + ' of ' + S.teams.length + ' managers involved'),
    kpi('Most active', busiest ? busiest.team.name : '—', busiest ? busiest.n + ' trade' + (busiest.n === 1 ? '' : 's') : ''),
    kpi('Best trader', best ? best.team.name : '—', best ? 'average grade ' + best.grade : '',
      '<div class="k">How this is scored</div>Average of their per-trade grades, which combine the value swing at today’s prices with how well the pieces fit the roster.'),
    kpi('Biggest value gain', richest ? richest.team.name : '—', richest ? sgn(Math.round(richest.net), 0) + ' at today’s prices' : ''),
    kpi('Assets moved', String(sum(trades.map(t => sum(t.sides.map(s => s.got.length))))), 'players, picks and FAAB')
  ));

  wrap.appendChild(card('A note on grades', null, h('div.tiny.sec',
    'Every asset is priced at ', h('b', 'today’s'), ' market, so these grades are hindsight — they say how a trade looks now, not whether it was a good decision when it was made. '
    + 'A manager who sold a player before he got hurt will grade badly here and was still right. Need fit is judged against each roster as it stands now, for the same reason.')));

  // ---- every trade ----
  const assetChip = (a, dim) => h('div.asset', { style: { cursor: 'default', opacity: dim ? .75 : 1 } },
    a.kind === 'faab' ? h('span.pill.pos-NA', 'FAAB') : posPill(a.pos),
    a.kind === 'player' && a.ref ? pname(a.ref, { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } })
      : h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, a.name),
    a.kind === 'pick' && a.slotLabel ? h('span.tiny.muted', { style: { flex: 'none' } }, 'proj ' + a.slotLabel) : null,
    a.value ? h('span.v', kfmt(Math.round(a.value))) : null);

  const gradeChip = (g) => {
    const good = /^A/.test(g), bad = /^[DF]/.test(g);
    return h('span.tag', {
      style: {
        fontWeight: 700, fontSize: '12px', padding: '2px 8px',
        borderColor: good ? 'var(--good)' : bad ? 'var(--critical)' : 'var(--border-strong)',
        color: good ? 'var(--good-text)' : bad ? 'var(--bad-text)' : 'var(--text-secondary)'
      }
    }, g);
  };

  // a trade asset is priced at `value`; the shared card reads `dv`
  const asAsset = (a) => Object.assign({}, a, { dv: a.value || 0 });
  const sideTray = (tr, s, ix) => {
    const which = ix % 2 ? 'b' : 'a', T = s.team;
    return h('div.tmini.' + which + (tr.winner === s ? '.won' : ''),
      h('div.tmini-hd',
        T && T.avatar ? h('img.tav-s.sm', { src: T.avatar, alt: '', onerror: e => e.target.style.visibility = 'hidden' }) : h('span.tray-dot'),
        h('b.tmini-nm', T ? T.name : 'roster ' + s.rosterId),
        tr.winner === s ? h('span.tag', { style: { borderColor: 'var(--good)', color: 'var(--good-text)' } }, 'won') : null,
        h('span', { style: { marginLeft: 'auto' } }, gradeChip(s.grade))),
      h('div.tmini-lbl', 'Received · ' + kfmt(Math.round(s.gotValue))),
      // the Default view shows each asset as a card; the Minimal view keeps the compact rows and chips
      h('div.tmini-items' + (isSimple() ? '.cards' : ''), s.got.length ? s.got.map(a => dealItem(asAsset(a), { compact: true, back: 'trades', value: a.value ? kfmt(Math.round(a.value)) : '—' })) : h('span.tiny.muted', 'nothing')),
      h('div.tmini-lbl', { style: { marginTop: '10px' } }, 'Gave up · ' + kfmt(Math.round(s.sentValue))),
      isSimple()
        ? h('div.tmini-items.cards.gave', s.sent.length ? s.sent.map(a => dealItem(asAsset(a), { compact: true, back: 'trades', value: a.value ? kfmt(Math.round(a.value)) : '—' })) : h('span.tiny.muted', 'nothing'))
        : h('div', { style: { display: 'grid', gap: '4px' } }, s.sent.length ? s.sent.map(a => assetChip(a, true)) : h('span.tiny.muted', 'nothing')),
      h('div.row', { style: { gap: '12px', borderTop: '1px solid var(--border)', paddingTop: '8px', marginTop: '10px' } },
        h('span.tiny.sec', 'Value ', deltaTag(s.net, 0)),
        h('span.tiny.sec', 'Need fit ', h('b', { class: s.needFit > 0.1 ? 'up' : s.needFit < -0.1 ? 'down' : 'flat' },
          s.needFit > 0.35 ? 'strong' : s.needFit > 0.1 ? 'good' : s.needFit < -0.35 ? 'poor' : s.needFit < -0.1 ? 'weak' : 'neutral'))));
  };
  const cards = trades.map(tr => h('div.tcard',
    h('div.tc-hd',
      h('div.row', { style: { gap: '8px' } },
        h('b', tr.when ? tr.when.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'date unknown'),
        tr.week ? h('span.tag', 'week ' + tr.week) : null),
      tr.winner
        ? h('span.tiny', h('b', tr.winner.team ? tr.winner.team.name : '?'), ' comes out ahead')
        : h('span.tiny.muted', 'too close to call')),
    h('div.thist', tr.sides.map((s, ix) => sideTray(tr, s, ix)))));
  wrap.appendChild(card('Every completed trade', trades.length + ' in this league, newest first', h('div', { style: { display: 'grid', gap: '10px' } }, cards)));

  // ---- manager table ----
  wrap.appendChild(card('Managers', 'value figures are at today’s prices', table([
    { k: 'name', h: 'Manager', sort: r => r.team.name, f: r => teamCell(r.team) },
    { k: 'n', h: 'Trades', num: true, f: r => h('b.mono', r.n) },
    { k: 'grade', h: 'Avg grade', sort: r => r.avgScore === null ? -99 : r.avgScore, f: r => r.grade ? gradeChip(r.grade) : h('span.muted.tiny', '—') },
    { k: 'net', h: 'Net value', num: true, f: r => r.n ? deltaTag(r.net, 0) : h('span.muted.tiny', '—') },
    { k: 'record', prio: 2, h: 'Won / lost', sortable: false, f: r => r.n ? h('span.mono', r.wins + ' – ' + r.losses) : '—' },
    { k: 'flow', prio: 2, h: 'Picks in/out', sortable: false, f: r => r.n ? h('span.mono.tiny', r.picksIn + ' / ' + r.picksOut) : '—' },
    { k: 'ageIn', prio: 2, h: 'Age acquired', num: true, sort: r => r.ageFlow || 0, f: r => r.ageFlow ? fmt(r.ageFlow, 1) : '—' },
    { k: 'ageOut', prio: 2, h: 'Age sent', num: true, sort: r => r.ageSent || 0, f: r => r.ageSent ? fmt(r.ageSent, 1) : '—' },
    { k: 'partner', prio: 2, h: 'Trades most with', sortable: false, f: r => r.topPartner && r.topPartner.team ? h('span.tiny', r.topPartner.team.name + ' (' + r.topPartner.n + ')') : h('span.muted.tiny', '—') }
  ], list, { sortKey: 'n', sortDir: -1 })));
  return wrap;
}
