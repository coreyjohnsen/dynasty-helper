"use strict";
/* ================= 6b. SEASON REPLAY ================= */
function simReplayView(sim) {
  const wrap = h('div.grid');
  const ch = sim.champion;
  const A = sim.awards;
  const nameOf = (rid) => (S.teamById[rid] || {}).name || '?';
  const shortOf = (rid) => (S.teamById[rid] || {}).short || '?';

  // champion reveal
  wrap.appendChild(h('div.card.champ',
    h('div.bd',
      h('div.champ-top', h('span.champ-cup', '🏆'),
        h('div.tiny', { style: { textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, opacity: .85 } }, 'Your simulated ' + S.season + ' champion')),
      h('div.champ-main', ch ? teamFace(ch.team, 64) : null,
        h('div', { style: { minWidth: 0 } },
          h('div.hero', { style: { overflowWrap: 'anywhere' } }, ch ? ch.team.name : '—'),
          ch ? h('div.sec', { style: { marginTop: '3px', lineHeight: 1.45 } },
            `${ch.w}-${ch.l}${ch.tie ? '-' + ch.tie : ''} · ${ord(ch.seed)} seed · ${fmt(ch.pf, 1)} points for`
            + (sim.runnerUp ? ` — beat ${sim.runnerUp.team.name} in the final` : '')) : null)),
      h('button.btn.pri.champ-again', { onclick: () => { SimUI.replay = simulateOneSeason(); SimUI.openWeek = null; render(); window.scrollTo(0, 0); } }, '⟳ Run it again'))));

  wrap.appendChild(card('Playoff bracket', `weeks ${S.regEnd + 1}–${S.regEnd + sim.bracket.length} · top ${sim.playoffTeams} teams`, bracketView(sim)));

  // ---- storylines ----
  const story = (label, headline, detail) => h('div.kpi', h('div.lbl', label), h('div', { style: { fontWeight: 660, fontSize: '14.5px', marginTop: '1px' } }, headline), h('div.sub', detail));
  wrap.appendChild(h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(min(215px,100%),1fr))' } },
    A.highScore ? story('Highest score of the year', nameOf(A.highScore.rid),
      `${fmt(A.highScore.pts, 1)} in week ${A.highScore.week}` + (A.highScore.top ? ` — ${A.highScore.top.name} put up ${fmt(A.highScore.top.pts, 1)}` : '')) : null,
    A.blowout ? story('Biggest beatdown', `${nameOf(A.blowout.win)} over ${nameOf(A.blowout.win === A.blowout.a ? A.blowout.b : A.blowout.a)}`,
      `${fmt(Math.max(A.blowout.aPts, A.blowout.bPts), 1)}–${fmt(Math.min(A.blowout.aPts, A.blowout.bPts), 1)} in week ${A.blowout.week}, a ${fmt(A.blowout.margin, 1)}-point margin`) : null,
    A.nailBiter ? story('Closest game', `${nameOf(A.nailBiter.win)} by ${fmt(A.nailBiter.margin, 2)}`,
      `week ${A.nailBiter.week} — ${fmt(A.nailBiter.aPts, 1)} to ${fmt(A.nailBiter.bPts, 1)}`) : null,
    A.mostPF ? story('Most points scored', A.mostPF.team.name, `${fmt(A.mostPF.pf, 1)} for the season, ${fmt(A.mostPF.pf / S.regEnd, 1)} per week`) : null,
    A.longestStreak && A.longestStreak.streak > 1 ? story('Longest win streak', A.longestStreak.team.name, A.longestStreak.streak + ' straight wins') : null,
    A.unluckiest ? story('Best team to be let down', A.unluckiest.team.name, `${ord(A.unluckiest.pfRank)} in scoring but finished ${ord(A.unluckiest.seed)}`) : null
  ));

  // ---- final table ----
  wrap.appendChild(card('Final standings', 'division winners take the top seeds' + (sim.nDiv > 1 ? '' : ' — this league has no divisions'),
    table([
      { k: 'seed', h: 'Seed', num: true, f: r => h('b.mono', r.seed) },
      {
        k: 'name', h: 'Team', sort: r => r.team.name, f: r => h('div.row', { style: { gap: '6px' } }, isNarrow() ? teamLine(r.team, 24) : teamCell(r.team),
          r.divWinner && !isNarrow() ? h('span.tag', 'div') : null,
          sim.field.includes(r) ? h('span.tag', { title: 'made the playoffs', style: { borderColor: 'var(--s1)', color: 'var(--s1)' } }, isNarrow() ? 'PO' : 'playoffs') : null)
      },
      { k: 'w', h: 'W', num: true, f: r => h('b.mono', r.w) },
      { k: 'l', h: 'L', num: true },
      { k: 'pf', h: 'PF', num: true, f: r => fmt(r.pf, 1) },
      { k: 'pa', prio: 2, h: 'PA', num: true, f: r => fmt(r.pa, 1) },
      { k: 'diff', prio: 2, h: 'Diff', num: true, sort: r => r.pf - r.pa, f: r => h('span', { class: r.pf - r.pa >= 0 ? 'up mono' : 'down mono' }, sgn(r.pf - r.pa, 1)) },
      { k: 'best', prio: 2, h: 'Best week', num: true, f: r => r.best ? h('span', fmt(r.best, 1), h('span.tiny.muted', ' wk' + r.bestWeek)) : '—' },
      { k: 'form', prio: 2, h: 'Form', sortable: false, f: r => h('span', { style: { display: 'flex', gap: '2px' } }, r.form.slice(-8).map(f => h('span', { style: { width: '13px', height: '13px', borderRadius: '3px', fontSize: '9px', fontWeight: 700, display: 'grid', placeItems: 'center', color: '#fff', background: f === 'W' ? 'var(--good)' : f === 'T' ? 'var(--axis)' : 'var(--critical)' } }, f))) }
    ], sim.standings, { sortKey: 'seed', sortDir: 1 })));

  // ---- week by week ----
  const weekBtns = h('div.wkstrip', sim.weeks.map(w =>
    h('button.btn.sm', {
      class: SimUI.openWeek === w.week ? 'pri' : '',
      onclick: () => { SimUI.openWeek = SimUI.openWeek === w.week ? null : w.week; render(); }
    }, (w.actual ? '✓' : '') + w.week)));
  const shown = SimUI.openWeek ? sim.weeks.filter(w => w.week === SimUI.openWeek) : sim.weeks;
  const weekBlocks = shown.map(w => h('div', { style: { marginBottom: '14px' } },
    h('div.row', { style: { marginBottom: '5px', gap: '8px' } },
      h('b', 'Week ' + w.week),
      w.actual ? h('span.tag', { style: { borderColor: 'var(--s1)', color: 'var(--s1)' } }, 'actual result') : h('span.tag', 'simulated'),
      h('span.tiny.muted', w.games.length + ' games')),
    h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(min(268px,100%),1fr))', gap: '7px' } },
      w.games.map(g => {
        const rowFor = (rid, pts, top, won) => h('div.row', { style: { justifyContent: 'space-between', gap: '8px', opacity: won ? 1 : .6 } },
          h('div.row', { style: { gap: '7px', minWidth: 0, flexWrap: 'nowrap' } },
            S.teamById[rid] ? teamFace(S.teamById[rid], 22) : null,
            h('span', { style: { fontWeight: won ? 660 : 500, fontSize: '12.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, nameOf(rid))),
          h('b.mono', { style: { fontSize: '12.5px' } }, fmt(pts, 1)));
        const el = h('div', { style: { border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '7px 9px', background: 'var(--surface-1)' }, tabindex: 0 },
          rowFor(g.a, g.aPts, g.aTop, g.win === g.a),
          rowFor(g.b, g.bPts, g.bTop, g.win === g.b));
        bindTT(el, `<div class="k">Week ${w.week}${w.actual ? ' · actual' : ''}</div>` +
          (g.win ? `<b>${nameOf(g.win)}</b> by ${fmt(g.margin, 1)}` : '<b>Tie</b>') +
          (g.aTop ? `<br>${shortOf(g.a)} best: ${g.aTop.name} ${fmt(g.aTop.pts, 1)}` : '') +
          (g.bTop ? `<br>${shortOf(g.b)} best: ${g.bTop.name} ${fmt(g.bTop.pts, 1)}` : ''));
        return el;
      }))));
  wrap.appendChild(card('Week by week', SimUI.openWeek ? 'showing week ' + SimUI.openWeek + ' — click it again for the full season' : 'every matchup; ✓ marks weeks that actually happened',
    h('div', weekBtns, h('div', { style: { marginTop: '12px' } }, weekBlocks))));
  return wrap;
}
