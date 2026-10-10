"use strict";
/* ================= 13. THIS WEEK ================= */
const WeekUI = { week: null, open: null, prob: null };

function currentWeek() {
  if (S.liveWeek) return S.liveWeek;
  return clamp(S.lastWeek + 1, 1, S.regEnd);
}

/** A franchise's name, shortened to its abbreviation when the card is too
 *  narrow to carry the whole thing without cutting it in half anyway. */
function matchupName(T) {
  const n = T.name || '';
  const wide = !isNarrow();
  return (n.length <= (wide ? 16 : 11)) ? n : T.short;
}
/** One half of a matchup card: badge, name, live total, and what is behind it. */
function matchupSide(l, T, colour) {
  return h('div.tmside',
    T.avatar
      ? h('img.mlogo', { src: T.avatar, alt: '', loading: 'lazy', onerror: e => e.target.style.visibility = 'hidden' })
      : h('div.mlogo'),
    h('div.nm', { title: T.name + ' — ' + T.owner }, matchupName(T)),
    h('div.sc', { style: { color: colour } }, fmt(l.total, 1)),
    h('div.dt', l.banked > 0.05 ? h('span', h('b.sec', fmt(l.banked, 1)), ' scored') : h('span', 'nothing yet'),
      l.projected > 0.05 ? h('div', '+ ' + fmt(l.projected, 1) + ' proj') : null),
    h('div.dt.cnt', l.doneN + ' done'
      + (l.liveN ? ' · ' + l.liveN + ' live' : '')
      + (l.leftN ? ' · ' + l.leftN + ' left' : '')));
}

function viewWeek() {
  const wrap = h('div.grid');
  const weeks = []; for (let w = 1; w <= S.regEnd; w++) weeks.push(w);
  if (WeekUI.week === null || !weeks.includes(WeekUI.week)) WeekUI.week = currentWeek();
  const wk = WeekUI.week;
  const live = wk === S.liveWeek;
  const done = weekFinished(wk) && wk <= S.lastWeek;
  const games = liveMatchups(wk);

  // the scores feed carries kickoff times and live quarters; fetch it once per
  // week the user actually looks at, then redraw
  S.weekScores = S.weekScores || {};
  S._wsAsked = S._wsAsked || {};
  if (!S.weekScores[wk] && !S._wsAsked[wk] && wk <= S.regEnd) {
    S._wsAsked[wk] = true;
    ensureWeekScores(wk).then(got => { if (got) render(); });
  }

  wrap.appendChild(card('Week ' + wk + (live ? ' — in progress' : done ? ' — final' : ' — not started'),
    S.nflSched
      ? 'points from finished games are counted as scored; everyone whose game has not ended is counted at their projection'
      : 'the NFL game schedule could not be loaded, so every played week is treated as final',
    h('div.row', { style: { gap: '14px' } },
      h('label.fld', 'Week', h('select', { onchange: e => { WeekUI.week = +e.target.value; WeekUI.open = null; render(); } },
        weeks.map(w => h('option', { value: w, selected: w === wk },
          'Week ' + w + (w === S.liveWeek ? ' (live)' : w <= S.lastWeek ? ' (final)' : ''))))),
      h('span', { style: { flex: 1 } }),
      live ? h('span.tag', { style: { borderColor: 'var(--s1)', color: 'var(--s1)' } }, '● live') : null,
      h('button.btn.sm', {
        onclick: async (e) => {
          const b = e.target; b.disabled = true; b.textContent = 'Checking…';
          await refreshLiveWeek();
          render();
        }
      }, '↻ Recheck'))));

  if (!games.length) {
    wrap.appendChild(card(null, null, h('div.empty', 'No matchups scheduled for week ' + wk + '.')));
    return wrap;
  }

  const openGame = games.find(g => g.A.rosterId === WeekUI.open);
  if (openGame) { weekDetail(wrap, openGame, wk, live); return wrap; }

  /* ---- the biggest game of the week ---- */
  const sim = S.sim && S.sim.leverage && S.sim.leverage.some(x => x.week === wk) ? S.sim : null;
  if (sim) {
    /* The biggest game has to be a game that is still in the balance. A blowout
       already in progress has one empty branch, no measurable swing, and would
       otherwise sit at the top of the list saying nothing. */
    const weekLev = sim.leverage.filter(x => x.week === wk);
    const g = weekLev.find(x => !x.thin) || weekLev[0];
    const pair = games.find(x => (x.A.rosterId === g.a.team.rosterId && x.B.rosterId === g.b.team.rosterId)
      || (x.A.rosterId === g.b.team.rosterId && x.B.rosterId === g.a.team.rosterId));
    wrap.appendChild(card('The biggest game this week',
      'measured by how far the season moves depending on who wins — the same yardstick the Simulator uses',
      h('div', { style: { display: 'grid', gap: '11px' } },
        h('div.row', { style: { gap: '10px' } },
          h('b', { style: { fontSize: '16px' } }, g.a.team.name + '  v  ' + g.b.team.name),
          g.thin
            ? h('span.tag', { title: 'one side of this game barely happens in the simulation, so there is no measurable difference between the two outcomes' }, 'too lopsided to weigh')
            : h('span.tag', { style: { borderColor: 'var(--critical)', color: 'var(--critical)' } }, pct(g.swing, 0) + ' of playoff odds on the line'),
          h('span', { style: { flex: 1 } }),
          pair ? h('span.tiny.muted', 'live ' + fmt(pair.a.total, 1) + ' – ' + fmt(pair.b.total, 1)) : null),
        h('div.grid.split2',
          leverageWorld(g, 0), h('div.tiny.muted', { style: { textAlign: 'center', alignSelf: 'center' } }, 'or'), leverageWorld(g, 1)),
        h('div.row', h('button.btn.sm', {
          onclick: () => { SimUI.mode = 'season'; LevUI.week = wk; S.view = 'sim'; render(); window.scrollTo(0, 0); }
        }, 'See every game this week ranked →')))));
  } else {
    wrap.appendChild(card('The biggest game this week',
      'which game moves the season most depends on the rest of the season, so this needs a full simulation',
      h('div.row', { style: { gap: '12px' } },
        h('button.btn.pri', {
          onclick: () => { S.sim = simulate(2000); SimUI.res = S.sim; SimUI.mode = 'season'; render(); }
        }, 'Run 2,000 seasons'),
        h('span.tiny.muted', 'about a quarter of a second'))));
  }

  /* ---- the matchups ---- */
  wrap.appendChild(h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(min(330px,100%),1fr))' } },
    games.map(g => {
      const favA = g.pA >= g.pB;
      const body = h('div', { style: { display: 'grid', gap: '10px' } },
        // one team on each side with the odds between them: the bar reads left
        // to right as "how much of this game belongs to the team on the left"
        h('div.mvs',
          matchupSide(g.a, g.A, 'var(--s1)'),
          h('div.mid',
            h('div.pcts',
              h('span', { style: { color: favA ? 'var(--s1)' : 'var(--text-muted)' } }, pct(g.pA, 0)),
              h('span', { style: { color: !favA ? 'var(--s2)' : 'var(--text-muted)' } }, pct(g.pB, 0))),
            // the whole track is the two teams' colours meeting at the odds
            h('div.bar', { style: { background: 'var(--s2)' } },
              h('i', { style: { width: (g.pA * 100) + '%', background: 'var(--s1)' } })),
            h('div.cap', g.settled ? 'final' : 'win prob')),
          matchupSide(g.b, g.B, 'var(--s2)')),
        h('div.tiny.muted', { style: { borderTop: '1px solid var(--border)', paddingTop: '7px', textAlign: 'center' } },
          g.settled ? 'Everyone has played.'
            : `Typical result: ${(g.med >= 0 ? g.A.short : g.B.short)} by ${fmt(Math.abs(g.med), 1)} · middle 80% from `
            + `${(g.lo >= 0 ? g.A.short : g.B.short)} by ${fmt(Math.abs(g.lo), 0)} to ${(g.hi >= 0 ? g.A.short : g.B.short)} by ${fmt(Math.abs(g.hi), 0)}`),
        h('div.row', { style: { justifyContent: 'center' } }, h('button.btn.sm', {
          onclick: () => { WeekUI.open = g.A.rosterId; render(); window.scrollTo(0, 0); }
        }, 'Win probability & players →')));
      const c = card(null, null, body);
      c.style.cursor = 'pointer';
      c.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('.plink')) return;
        WeekUI.open = g.A.rosterId; render(); window.scrollTo(0, 0);
      });
      return c;
    })));

  /* ---- everyone, ranked ---- */
  const rows = S.teams.map(t => {
    const l = liveRoster(t, wk);
    const g = games.find(x => x.A.rosterId === t.rosterId || x.B.rosterId === t.rosterId);
    const opp = !g ? null : (g.A.rosterId === t.rosterId ? g.B : g.A);
    const p = !g ? null : (g.A.rosterId === t.rosterId ? g.pA : g.pB);
    return { t, l, opp, p };
  });
  wrap.appendChild(card('Everyone this week',
    'scored the same way — banked where the games are over, projected where they are not',
    table([
      { k: 'name', h: 'Team', sort: r => r.t.name, f: r => teamCell(r.t) },
      { k: 'opp', prio: 2, h: 'Opponent', sortable: false, f: r => r.opp ? h('span.tiny', r.opp.short) : h('span.muted.tiny', 'bye') },
      { k: 'total', h: 'Live total', num: true, sort: r => r.l.total, f: r => h('b.mono', fmt(r.l.total, 1)) },
      { k: 'banked', h: 'Scored', num: true, sort: r => r.l.banked, f: r => r.l.banked > 0.05 ? fmt(r.l.banked, 1) : h('span.muted', '—') },
      { k: 'left', prio: 2, h: 'Still to play', num: true, sort: r => r.l.leftN + r.l.liveN, f: r => h('span.mono', (r.l.leftN + r.l.liveN) + ' of ' + r.l.rows.length) },
      { k: 'p', h: 'Win prob', num: true, sort: r => r.p === null ? -1 : r.p, f: r => r.p === null ? '—' : h('span.mono', { class: r.p > 0.5 ? 'up' : 'muted' }, pct(r.p, 0)) }
    ], rows, { sortKey: 'total', sortDir: -1 })));
  return wrap;
}

/* A branch nobody's simulation visited has no odds to report. Drawing it as 0%
   says the season ends in nothing, which is not what the run found — it found
   that this does not happen. The box says that instead. */
function levUnmeasured(name, runs, total) {
  return h('div.tiny.muted', { style: { padding: '2px 0 1px' } },
    runs > 0
      ? `Only ${runs} of ${total.toLocaleString()} simulated seasons went this way — too few to read odds from.`
      : `Not one of the ${total.toLocaleString()} simulated seasons had ${name} winning this.`,
    h('div', { style: { marginTop: '4px' } }, 'Nothing to compare the other side against, so the game carries no measurable swing.'));
}

/** One of the two worlds a leverage game leaves behind. */
function leverageWorld(g, which) {
  const A = g.a.team, B = g.b.team;
  const wd = which === 0
    ? { win: A, rows: [{ t: A, po: g.a.poWin, ti: g.a.tiWin, won: true }, { t: B, po: g.b.poLose, ti: g.b.tiLose, won: false }] }
    : { win: B, rows: [{ t: A, po: g.a.poLose, ti: g.a.tiLose, won: false }, { t: B, po: g.b.poWin, ti: g.b.tiWin, won: true }] };
  const runs = which === 0 ? (g.nA || 0) : (g.nB || 0);
  const total = (g.nA || 0) + (g.nB || 0);
  const blank = wd.rows.some(r => r.po === null || r.po === undefined);
  return h('div', {
    style: { minWidth: 0, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '9px 11px', background: 'var(--surface-1)', opacity: blank ? .72 : 1 }
  },
    h('div.tiny', { style: { fontWeight: 700, marginBottom: '7px' } }, 'If ', h('span', { style: { color: 'var(--s1)' } }, wd.win.name), ' wins'),
    blank ? levUnmeasured(wd.win.name, runs, total) : null,
    blank ? null : h('div', { style: { display: 'grid', gap: '6px' } }, wd.rows.map(r => h('div', {
      style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto', gap: '8px', alignItems: 'center' }
    },
      h('span.tiny', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: r.won ? 640 : 500 } }, r.t.short),
      h('div.bar-track', { style: { width: isNarrow() ? '52px' : '74px', height: '8px' } },
        h('div.bar-fill', { style: { width: (clamp(r.po, 0, 1) * 100) + '%', background: r.won ? 'var(--s1)' : 'var(--text-muted)' } })),
      h('span.mono.tiny', { style: { minWidth: '92px', textAlign: 'right' } },
        h('b', pct(r.po, 0)), h('span.muted', ' playoffs · '), h('b', pct(r.ti, 1)), h('span.muted', ' title'))))));
}

/** Every starter on both sides of one matchup. */
function weekPlayerTable(g) {
  const rows = [];
  g.a.rows.forEach(r => rows.push(Object.assign({ side: g.A }, r)));
  g.b.rows.forEach(r => rows.push(Object.assign({ side: g.B }, r)));
  const badge = (st) => st === 'done' ? h('span.tag', { style: { borderColor: 'var(--good)', color: 'var(--good-text)' } }, 'final')
    : st === 'live' ? h('span.tag', { style: { borderColor: 'var(--s1)', color: 'var(--s1)' } }, 'playing')
      : st === 'bye' ? h('span.tag', 'BYE') : h('span.tag', 'to play');
  return table([
    { k: 'side', h: 'Team', sort: r => r.side.name, f: r => h('span.tiny', r.side.short) },
    { k: 'pos', prio: 2, h: 'Pos', sortable: false, f: r => posPill(r.p.pos) },
    { k: 'name', h: 'Player', sort: r => r.p.name, f: r => isSimple()
      ? h('div.row', { style: { gap: '7px', minWidth: 0 } }, playerFace(r.p), pname(r.p, { face: false }), r.p.team ? teamLogo(r.p.team) : null)
      : pname(r.p) },
    { k: 'st', h: 'Status', sortable: false, f: r => badge(r.state) },
    { k: 'used', h: 'Counted', num: true, sort: r => r.used, f: r => h('b.mono', fmt(r.used, 1)) },
    { k: 'actual', prio: 2, h: 'Actual', num: true, sort: r => r.actual || 0, f: r => r.actual === null ? '—' : h('span.mono', fmt(r.actual, 1)) },
    { k: 'proj', prio: 2, h: 'Projected', num: true, sort: r => r.proj, f: r => h('span.mono.muted', fmt(r.proj, 1)) }
  ], rows, { sortKey: 'used', sortDir: -1 });
}

/** One matchup's detail: how the odds moved, and every starter on both sides. */
function weekDetail(wrap, g, wk, live) {
  const CA = 'var(--s1)', CB = 'var(--s2)';
  wrap.appendChild(h('div.row', { style: { gap: '10px' } },
    h('button.btn', { onclick: () => { WeekUI.open = null; render(); window.scrollTo(0, 0); } }, '← All matchups'),
    h('span', { style: { flex: 1 } }),
    live ? h('span.tag', { style: { borderColor: CA, color: CA } }, '● live') : null));

  const favA = g.pA >= g.pB;
  wrap.appendChild(card(null, null, h('div', { style: { display: 'grid', gap: '11px' } },
    h('div.mvs',
      matchupSide(g.a, g.A, CA),
      h('div.mid',
        h('div.pcts',
          h('span', { style: { color: favA ? CA : 'var(--text-muted)' } }, pct(g.pA, 0)),
          h('span', { style: { color: !favA ? CB : 'var(--text-muted)' } }, pct(g.pB, 0))),
        h('div.bar', { style: { background: CB } }, h('i', { style: { width: (g.pA * 100) + '%', background: CA } })),
        h('div.cap', g.settled ? 'final' : 'win prob')),
      matchupSide(g.b, g.B, CB)),
    h('div.tiny.muted', { style: { borderTop: '1px solid var(--border)', paddingTop: '7px', textAlign: 'center' } },
      g.settled ? 'Everyone has played.'
        : `Typical result: ${(g.med >= 0 ? g.A.short : g.B.short)} by ${fmt(Math.abs(g.med), 1)} · middle 80% from `
        + `${(g.lo >= 0 ? g.A.short : g.B.short)} by ${fmt(Math.abs(g.lo), 0)} to ${(g.hi >= 0 ? g.A.short : g.B.short)} by ${fmt(Math.abs(g.hi), 0)}`))));

  const chart = matchupProbChart(wk, g);
  if (chart) wrap.appendChild(chart);

  wrap.appendChild(card('Every starter, slot by slot',
    'each number is what counts toward the total — the real score once a game is over, the projection until then, and both while it is being played',
    matchupLadder(g, wk)));
}

/** ESPN-style win-probability trace for one matchup, cut into the week's slates.
 *  The path is rebuilt from the week itself — see probPath() — so it is there
 *  for any week, watched or not, and reads the same on every device. */
function matchupProbChart(wk, g) {
  // nothing has moved until somebody has played
  if (!weekStarted(wk)) return null;
  const CA = 'var(--s1)', CB = 'var(--s2)';
  const path = probPath(g.A, g.B, wk);
  const slates = weekSlates(wk);
  if (!path || !path.length || !slates.length) return null;

  /* Wall-clock time wastes most of its width on an empty Friday and crushes the
     three Sunday windows into a smudge. The axis is the week's slates instead:
     pregame, one equal column per kickoff window, and a post column for after
     the last whistle. Every window the week has is on the axis from the start,
     whatever day it is — the shape of the week is part of what the chart says,
     and an axis that grew as Sunday went on would make two readings of the same
     game impossible to compare. The line simply stops where the week has got to. */
  const bounds = [slates[0].start - 3 * 3600 * 1000].concat(slates.map(sl => sl.start));
  bounds.push(slates[slates.length - 1].start + 4 * 3600 * 1000);
  const nWin = bounds.length - 1;
  const slateX = (t) => {
    if (t <= bounds[0]) return 0;
    for (let i = 0; i < nWin; i++) {
      if (t < bounds[i + 1]) return i + (t - bounds[i]) / Math.max(1, bounds[i + 1] - bounds[i]);
    }
    return nWin;
  };
  const labels = ['Pre'].concat(slates.map(sl => sl.label)).concat(['Post']);

  const score = (p) => fmt(p.a, 1) + '–' + fmt(p.b, 1);
  const marks = path.map(p => ({
    // the pregame point belongs at the left edge, not a second before kickoff
    x: p.pre ? 0 : slateX(p.t), y: p.p * 100,
    label: p.pre ? 'Before kickoff · projected ' + fmt(p.ta, 1) + '–' + fmt(p.tb, 1) : p.label + ' · ' + score(p)
  }));
  const lastX = marks[marks.length - 1].x;
  const nowX = slateX(Date.now());
  // a finished week ends at its last whistle; only a live week has a "now"
  if (!weekFinished(wk) && nowX > lastX + 0.02) {
    marks.push({ x: nowX, y: g.pA * 100, label: 'now · ' + fmt(g.a.banked, 1) + '–' + fmt(g.b.banked, 1) + ' scored' });
  }
  if (marks.length < 2) return null;
  marks.sort((a, b) => a.x - b.x);
  /* Between one whistle and the next nothing is known, so nothing is claimed:
     the line holds its value across the empty stretch and moves at the moment
     the games actually ended. Sloping from one point to the next would invent a
     Friday afternoon drift that nobody observed. */
  const pts = [];
  marks.forEach((m, i) => {
    if (i) pts.push({ x: m.x, y: marks[i - 1].y, label: marks[i - 1].label });
    pts.push(m);
  });
  // the two sides are the same story told twice; drawing both says so, and the
  // crossing point is the moment the game turned
  const ptsB = pts.map(p => ({ x: p.x, y: 100 - p.y, label: p.label }));

  /* Drawn at a width it can live at rather than stretched across the monitor:
     the label text is part of the drawing, so a 760-wide chart pulled over
     2000px pulls its letters with it. */
  const W = isNarrow() ? 380 : clamp(Math.round((typeof window !== 'undefined' ? window.innerWidth : 1400) - 470), 700, 1060);
  const chart = lineChart([
    { name: g.A.short, color: CA, width: 2.4, points: pts },
    { name: g.B.short, color: CB, width: 2.4, points: ptsB }
  ], {
    w: W, maxW: W, h: isNarrow() ? 220 : 300, dots: false,
    y0: 0, y1: 100, yRule: 50, yTicks: 4, x0: 0, x1: nWin,
    yFmt: v => Math.round(v) + '%',
    xTickValues: labels.map((lb, i) => ({ x: i, label: lb, rule: i > 0 && i < labels.length - 1 })),
    aria: 'win probability through the week'
  });
  const moved = Math.max.apply(null, pts.map(p => Math.abs(p.y - pts[0].y)));
  const swung = pts.some(p => (p.y - 50) * (pts[0].y - 50) < 0);
  const windows = path.filter(p => !p.pre).length;
  const swatch = (c, nm) => h('div.row', { style: { gap: '7px' } },
    h('span', { style: { width: '16px', height: '9px', borderRadius: '2px', background: c, display: 'inline-block' } }),
    h('b.tiny', nm));
  return card('Win probability',
    `the two lines are the same game from each side · rebuilt from when each game was played`
    + (moved > 1 ? ` · biggest move ${moved.toFixed(0)} points` : '')
    + (swung ? ' · the lead has changed hands' : ''),
    h('div',
      h('div.row', { style: { gap: '18px', marginBottom: '6px', flexWrap: 'wrap' } },
        swatch(CA, g.A.name), swatch(CB, g.B.name)),
      chart,
      h('div.tiny.muted', { style: { marginTop: '8px' } },
        'One column per kickoff window' + (slates.length ? ' (' + slates.map(sl => sl.label + ' ×' + Math.round(sl.n)).join(', ') + ')' : '')
        + ', the whole week whether it has been played yet or not. Each point is the week paused at that whistle: everyone whose game had ended '
        + 'counted at what they really scored, everyone still to play counted at their projection'
        + (weekFinished(wk) ? ' — the whole week is in the books'
          : windows ? ' — ' + windows + (windows === 1 ? ' window of the week has' : ' windows of the week have') + ' finished so far' : '')
        + '. Nothing upstream keeps a record of what happened inside a game, so the line only moves when games end.')));
}


/** The two lineups of one matchup set against each other slot by slot, the way
 *  Head to Head draws them. Under each number is where that player's game is:
 *  final with how he did against his projection, the quarter and his points so
 *  far, still to play, or on bye. The number itself takes the team's colour when
 *  it wins its slot, so the colours never have to mean two things at once. */
function matchupLadder(g, wk) {
  const CA = 'var(--s1)', CB = 'var(--s2)';
  const la = liveLineupSlots(g.A, wk), lb = liveLineupSlots(g.B, wk);
  const counted = (p) => p ? liveValue(p, wk).used : 0;
  const rows = la.map((sa, i) => {
    const sb = lb[i] || {};
    return { slot: sa.slot, a: sa.player, b: sb.player || null, va: counted(sa.player), vb: counted(sb.player) };
  });
  const cell = (p, v, won, col) => {
    if (!p) return h('span.muted.tiny', '—');
    const lv = liveValue(p, wk);
    const ps = playedScore(p, wk);
    const status = lv.state === 'bye' ? h('span', 'bye week')
      : lv.state === 'upcoming' ? h('span', 'projected')
        : ps && ps.final
          ? h('span', { class: ps.actual >= ps.proj ? 'up' : 'down' },
            (ps.actual >= ps.proj ? '▲ ' : '▼ ') + fmt(Math.abs(ps.actual - ps.proj), 1) + ' vs proj')
          : h('span', (lv.quarter ? String(lv.quarter) + ' · ' : '') + 'live');
    const tip = lv.state === 'bye' ? `<div class="k">${p.name}</div>On bye this week`
      : lv.state === 'upcoming' ? `<div class="k">${p.name}</div>Has not played yet — counted at his projection, <b>${fmt(lv.proj, 1)}</b>`
        : ps && ps.final ? `<div class="k">${p.name} · final</div>Scored <b>${fmt(ps.actual, 1)}</b> against <b>${fmt(ps.proj, 1)}</b> projected`
          : `<div class="k">${p.name} · playing${lv.quarter ? ', ' + lv.quarter : ''}</div><b>${fmt(lv.banked, 1)}</b> so far, plus <b>${fmt(lv.open, 1)}</b> expected from the rest of the game`;
    return bindTT(h('div.lcell', { tabindex: 0 },
      h('b.mono', { style: { color: won ? col : 'var(--text-primary)', fontWeight: won ? 720 : 560 } }, fmt(v, 1)),
      h('div.lstat', status)), tip);
  };
  const aWon = rows.filter(r => r.va > r.vb).length;
  return h('div', { style: { display: 'grid', gap: '10px' } },
    slotLadder(rows, g.A, g.B, CA, CB, { wk, live: true, cell, head: 'Pts' }),
    h('div.tiny.muted', `${g.A.short} is ahead in ${aWon} of ${rows.length} slots.`));
}
