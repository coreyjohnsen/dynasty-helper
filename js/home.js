"use strict";
/* ================= 14. HOME =================
   The landing page: which league you are looking at, where the season stands,
   and a way into every other page. It is the first thing a visit meets, so it
   answers "what is this and where do I go" before it answers anything else. */

/** One line each, so a tile says what the page is for rather than repeating its name. */
/** Two of these read differently once there is no next season to rank. */
function blurbFor(k) {
  if (!isDynasty()) {
    if (k === 'power') return 'The league ranked on this season, by projection and by results';
    if (k === 'scout') return 'Who needs what — every roster’s holes and surpluses right now';
    if (k === 'stock') return 'Redraft value over time, for a player or a whole franchise';
    if (k === 'trade') return 'Price a trade at redraft value and see what it does to the season';
    if (k === 'players') return 'Every player ranked on this season, and the waiver wire';
  }
  return VIEW_BLURB[k] || '';
}
const VIEW_BLURB = {
  week: 'Live scores, win probability and the game that matters most',
  roster: 'Any roster in full — value, projections and the starting lineup',
  players: 'Every player ranked, the waiver wire, and where the picks fall',
  lineup: 'Who to start this week, with the calls actually worth thinking about',
  trade: 'Price a trade and see what it does to the season',
  finder: 'Trades that fit both rosters, scanned across the league',
  trades: 'Every completed trade, graded at today’s market',
  h2h: 'Two teams side by side, this week and as franchises',
  power: 'The league ranked, by projection and by what has happened',
  standings: 'Wins, losses and points actually scored',
  scout: 'Who needs what — every roster’s holes and surpluses',
  sim: 'Playoff odds, seeds, and the games with most riding on them',
  draft: 'The draft board, shaded by value against slot par',
  stock: 'Value over time, for a player or a whole franchise'
};
/* The tiles, in the order someone would actually want them. */
const HOME_TILES = ['week', 'lineup', 'roster', 'players', 'trade', 'finder', 'h2h', 'power', 'standings', 'sim', 'scout', 'trades', 'draft', 'stock'];

function goView(k) { S.view = k; render(); window.scrollTo(0, 0); }

function viewHome() {
  const wrap = h('div.grid', { style: { gap: '20px' } });
  const cfg = S.cfg;
  const me = S.teamById[S.myRosterId];
  const wk = S.liveWeek || clamp(S.lastWeek + 1, 1, S.regEnd);
  const fmtStr = `${cfg.superflex ? 'Superflex' : '1QB'} · ${cfg.actualTeams} teams · `
    + `${cfg.ppr === 1 ? 'PPR' : cfg.ppr === 0.5 ? 'Half-PPR' : 'Standard'} · ${isDynasty() ? 'dynasty' : 'redraft'}`;
  const state = S.liveWeek ? 'Week ' + S.liveWeek + ' in progress'
    : S.lastWeek >= S.regEnd ? 'Regular season complete'
      : S.lastWeek ? 'Through week ' + S.lastWeek : 'Preseason';

  /* ---- who and what ----
     The badges of the league's own teams run across the back of the banner,
     masked so they fade out before they reach the name. They are decoration, so
     they only appear in the Default view, and a badge that fails to load simply
     takes itself out — if none of them arrive the gradient is still there. */
  const band = !isSimple() ? null : (() => {
    const badges = S.teams.filter(t => t.avatar).slice(0, 9);
    if (!badges.length) return null;
    return h('div.heroband', { 'aria-hidden': 'true' }, badges.map(t =>
      h('img', { src: t.avatar, alt: '', loading: 'lazy', onerror: e => e.target.remove() })));
  })();
  wrap.appendChild(h('div.banner',
    band,
    S.league.avatar
      ? h('img.heroav', { src: 'https://sleepercdn.com/avatars/' + S.league.avatar, alt: '', loading: 'lazy', onerror: e => e.target.style.visibility = 'hidden' })
      : h('div.heroav'),
    h('div', { style: { minWidth: 0, flex: 1 } },
      h('h1', S.league.name),
      h('div.tiny.sec', { style: { marginTop: '3px' } }, fmtStr + ' · ' + S.season + ' season · ' + S.regEnd + '-week regular season'),
      h('div.row', { style: { gap: '7px', marginTop: '9px' } },
        S.liveWeek ? h('span.live', h('i'), state) : h('span.tag', state),
        me ? h('span.tag', 'You: ' + me.name) : null,
        S.league.status ? h('span.tag', String(S.league.status).replace(/_/g, ' ')) : null))));

  /* ---- where you stand ---- */
  if (me) {
    const rec = `${me.wins}-${me.losses}${me.ties ? '-' + me.ties : ''}`;
    const simBy = S.sim && S.sim.by ? S.sim.by[me.rosterId] : null;
    wrap.appendChild(h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(min(160px,100%),1fr))' } },
      kpi('Your record', rec, S.gamesPlayed ? fmt(me.avgPts, 1) + ' per week' : 'no games yet'),
      kpi('Power rank', '#' + me.powerRank, 'of ' + S.teams.length),
      dynOnly(kpi('Future rank', '#' + me.futureRank, 'two to three years out')),
      kpi(capitalLabel(), kfmt(Math.round(me.totalValue)), ord(me.valueRank) + ' in the league'),
      simBy ? kpi('Playoff odds', pct(simBy.playoff, 0), pct(simBy.title, 1) + ' title')
        : kpi('Playoff odds', '—', 'run the simulator')));
  }

  /* ---- the week, if there is one being played ---- */
  let weekCard = null;
  if (S.liveWeek && me) {
    const g = liveMatchups(S.liveWeek).find(x => x.A.rosterId === me.rosterId || x.B.rosterId === me.rosterId);
    if (g) {
      const mine = g.A.rosterId === me.rosterId;
      const my = mine ? g.a : g.b, th = mine ? g.b : g.a;
      const them = mine ? g.B : g.A, p = mine ? g.pA : g.pB;
      const pMe = p, pThem = 1 - p;
      // the same team · odds · team layout as the This Week page, so a game reads
      // the same wherever it appears
      weekCard = card('Your week ' + S.liveWeek, 'scored live — banked where the games are over, projected where they are not',
        h('div', { style: { display: 'grid', gap: '16px' } },
          h('div.mvs.mvs-lg',
            matchupSide(my, me, 'var(--s1)'),
            h('div.mid',
              h('div.pcts',
                h('span', { style: { color: pMe >= 0.5 ? 'var(--s1)' : 'var(--text-muted)' } }, pct(pMe, 0)),
                h('span', { style: { color: pThem > 0.5 ? 'var(--s2)' : 'var(--text-muted)' } }, pct(pThem, 0))),
              h('div.bar', { style: { background: 'var(--s2)' } },
                h('i', { style: { width: (pMe * 100) + '%', background: 'var(--s1)' } })),
              h('div.cap', pMe >= 0.5 ? 'you’re favoured' : 'you’re the underdog')),
            matchupSide(th, them, 'var(--s2)')),
          h('div.row', { style: { gap: '10px', justifyContent: 'center' } },
            h('button.btn.pri', { onclick: () => goView('week') }, 'This week →'),
            h('button.btn', { onclick: () => goView('lineup') }, 'Check my lineup'))));
    }
  }

  /* ---- the top of the table, then every team on the value plot, then your headliners, then the week ---- */
  const strip = leagueStrip();
  if (strip) wrap.appendChild(strip);
  const plot = valueQuadrants();
  if (plot) wrap.appendChild(plot);
  const faces = myHeadliners(me);
  if (faces) wrap.appendChild(faces);
  if (weekCard) wrap.appendChild(weekCard);

  /* ---- everywhere else ---- */
  wrap.appendChild(card('Everything else', 'fourteen pages, all reading the same league',
    h('div.tilegrid', HOME_TILES.map(k => {
      const v = VIEWS.find(x => x.k === k); if (!v) return null;
      return h('button.tile', { onclick: () => goView(k) },
        ico(v.ic),
        h('span', { style: { minWidth: 0 } },
          h('b', v.label),
          h('span.tiny.muted', { style: { display: 'block', lineHeight: '1.35', marginTop: '2px' } }, blurbFor(k))));
    }))));

  /* ---- where the numbers come from ---- */
  wrap.appendChild(card('Where this comes from', null,
    h('div.tiny.sec', { style: { lineHeight: '1.55' } },
      'Rosters, matchups, drafts and trades are read live from ', h('b', 'Sleeper'),
      '; weekly projections are Sleeper’s own lines re-scored through this league’s settings; ',
      isDynasty() ? 'player and pick values are ' : 'player values are ',
      h('b', 'FantasyCalc'), ' ', valueWord(), ' prices for a ', cfg.superflex ? 'superflex' : '1QB', ' ', String(cfg.numTeams),
      '-team ', cfg.ppr === 1 ? 'PPR' : cfg.ppr === 0.5 ? 'half-PPR' : 'standard', ' league.',
      isDynasty() ? null : h('span', ' Because this is a redraft league, nothing carries to next season: no long-range projections, no ageing curve, and next year’s draft is a fresh start rather than an asset to hold.'),
      ' Everything is computed in this browser — nothing is stored anywhere else.')));
  return wrap;
}


/** The last few results, oldest first. Read from the matchup feed rather than
 *  from the running record, so a bye or a missing week cannot slide the run out
 *  of alignment with the weeks it is meant to describe. */
function recentForm(t, n) {
  const out = [];
  for (let w = 1; w <= S.lastWeek; w++) {
    const ms = S.matchups[w]; if (!ms) continue;
    const mine = ms.find(m => m.roster_id === t.rosterId);
    if (!mine || !mine.matchup_id) continue;
    const opp = ms.find(m => m.matchup_id === mine.matchup_id && m.roster_id !== t.rosterId);
    if (!opp) continue;
    const a = mine.points || 0, b = opp.points || 0;
    out.push({ week: w, r: a > b ? 'W' : b > a ? 'L' : 'T', pf: a, pa: b, opp: S.teamById[opp.roster_id] });
  }
  return out.slice(-(n || 5));
}

/** The top of the table, on blocks. Ordered exactly the way Active Rankings
 *  orders it — wins, then points — because that is the table people argue about.
 *  Before a ball is kicked there is nothing to stand on, so it falls back to the
 *  projection and says so rather than inventing a leader. */
function leaguePodium(ranked, live) {
  const top = ranked.slice(0, 3);
  if (top.length < 3) return null;
  const hunt = ranked.slice(3, 5);
  const MEDALS = ['gold', 'silver', 'bronze'];
  // second, first, third — a podium reads from the middle outward
  const orderOnStage = [1, 0, 2];

  const formStrip = (r) => r.form.length
    ? h('div.form', r.form.map(f => bindTT(h('i.' + f.r), `<div class="k">Week ${f.week}</div>`
      + `${f.r === 'W' ? 'Beat' : f.r === 'L' ? 'Lost to' : 'Tied'} <b>${f.opp ? f.opp.short : '?'}</b><br>`
      + `${fmt(f.pf, 1)} – ${fmt(f.pa, 1)}`)))
    : null;

  const step = (idx) => {
    const r = top[idx], t = r.t;
    return h('div.pod.p' + (idx + 1) + (t.rosterId === S.myRosterId ? '.mine' : ''), {
      tabindex: 0, role: 'button', title: t.name + ' — ' + t.owner,
      onclick: () => { RosterUI.team = t.rosterId; goView('roster'); },
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); RosterUI.team = t.rosterId; goView('roster'); } }
    },
      h('div.podtop',
        t.avatar
          ? h('img.podav', { src: t.avatar, alt: '', loading: 'lazy', onerror: e => e.target.style.visibility = 'hidden' })
          : h('div.podav'),
        h('div.nm', t.name),
        h('div.tiny.muted', live ? `${t.wins}-${t.losses}${t.ties ? '-' + t.ties : ''} · ${fmt(t.fpts, 0)} PF` : fmt(t.power, 1) + ' rating'),
        formStrip(r),
        r.s ? h('div.pododds', h('b', pct(r.s.title, 1)), ' to win it') : null),
      h('div.block.' + MEDALS[idx], h('span.place', idx + 1)));
  };

  const huntRow = (r, i) => {
    const t = r.t, gap = top[2].t.wins - t.wins, pts = top[2].t.fpts - t.fpts;
    return h('div.huntrow', {
      tabindex: 0, role: 'button',
      onclick: () => { RosterUI.team = t.rosterId; goView('roster'); },
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); RosterUI.team = t.rosterId; goView('roster'); } }
    },
      h('div.rk', ranked.indexOf(r) + 1),
      t.avatar ? h('img.avatar', { src: t.avatar, alt: '', loading: 'lazy', onerror: e => e.target.style.visibility = 'hidden' }) : h('div.avatar'),
      h('div', { style: { minWidth: 0 } },
        h('div.nm', t.name),
        h('div.tiny.muted', live
          ? (gap > 0 ? gap + (gap === 1 ? ' win' : ' wins') + ' back'
            : pts > 0 ? fmt(pts, 0) + ' points back' : 'level on the cut')
          : fmt(top[2].t.power - t.power, 1) + ' rating back')),
      formStrip(r) || h('span'));
  };

  return h('div.podwrap',
    h('div.podium', orderOnStage.map(step)),
    hunt.length ? h('div.hunt',
      h('div.lbl', 'In the hunt'),
      hunt.map(huntRow)) : null);
}

/** Every team in the league in one ranked strip: badge, record, scoring, recent
 *  form and how the season is likely to end. */
/* ================= home: where every team sits on dynasty vs redraft value =================
   Each team is one dot: how much its whole roster would fetch in a dynasty trade
   (players plus draft picks) against what it would fetch in a redraft one. The
   league median on each axis splits the plot into four, and the two corners where
   the axes disagree are the interesting ones — old stars who win now, young talent
   who win later. The four groups are read off position, so the dots stay one colour. */
const VALUE_QUADS = {
  tr: { name: 'Powerhouse', sub: 'strong now and later' },
  tl: { name: 'Win-now', sub: 'strong now, thin future' },
  br: { name: 'Future-loaded', sub: 'young talent and picks' },
  bl: { name: 'Rebuilding', sub: 'light on both' }
};
function teamValueAxes(t) {
  return {
    dyn: sum(t.players.map(p => p.dvDyn || 0)) + (isDynasty() ? (t.pickCapital || 0) : 0),
    red: sum(t.players.map(p => p.rv || 0))
  };
}
function valueQuadrants() {
  const teams = S.teams;
  // a redraft league has no future to plot: dynasty value is not what its trades are priced in
  if (!isDynasty() || teams.length < 4) return null;
  const pts = teams.map(t => Object.assign({ t, me: t.rosterId === S.myRosterId }, teamValueAxes(t)));
  const med = (a) => { const v = a.slice().sort((x, y) => x - y), n = v.length; return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2; };
  const mx = med(pts.map(p => p.dyn)), my = med(pts.map(p => p.red));
  const dynRank = pts.slice().sort((a, b) => b.dyn - a.dyn).map(p => p.t.rosterId);
  const redRank = pts.slice().sort((a, b) => b.red - a.red).map(p => p.t.rosterId);
  pts.forEach(p => {
    p.q = (p.red >= my ? 't' : 'b') + (p.dyn >= mx ? 'r' : 'l');
    p.dynRk = dynRank.indexOf(p.t.rosterId) + 1; p.redRk = redRank.indexOf(p.t.rosterId) + 1;
  });

  // on a desktop the chart is drawn at the width it will be shown (the card is the window less the sidebar and
  // padding), so one drawing unit is one pixel and text and logos stay a fixed size on any monitor
  const W = isNarrow() ? 380 : Math.round(clamp(innerWidth - 350, 560, 1500)), H = isNarrow() ? 400 : Math.round(clamp(W * 0.46, 380, 520)), m = isNarrow() ? { t: 14, r: 12, b: 42, l: 44 } : { t: 16, r: 18, b: 46, l: 56 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  // the quadrant captions live in the top and bottom bands, so the redraft axis keeps those
  // bands clear of dots; the dynasty axis only needs a little air
  const span = (a, padPx, len) => { const lo = Math.min(...a), hi = Math.max(...a), pad = Math.max((hi - lo) * padPx / Math.max(len - 2 * padPx, 40), 1); return [lo - pad, hi + pad]; };
  const [x0, x1] = span(pts.map(p => p.dyn), 26, iw), [y0, y1] = span(pts.map(p => p.red), 54, ih);
  const X = v => m.l + (v - x0) / (x1 - x0) * iw, Y = v => m.t + ih - (v - y0) / (y1 - y0) * ih;
  const ticks = (lo, hi, n) => {
    const raw = (hi - lo) / n, pow = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / pow;
    const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow, out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
    return out;
  };
  const g = svg('svg', { class: 'chart vq', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'each team by dynasty value and redraft value' });
  // the quadrant captions live in the corners; the viewBox keeps its own proportions
  g.style.width = '100%'; g.style.height = 'auto';
  // the two corners where the axes disagree get a faint wash
  g.appendChild(svg('rect', { x: m.l, y: m.t, width: X(mx) - m.l, height: Y(my) - m.t, fill: 'var(--surface-2)' }));
  g.appendChild(svg('rect', { x: X(mx), y: Y(my), width: m.l + iw - X(mx), height: m.t + ih - Y(my), fill: 'var(--surface-2)' }));
  ticks(y0, y1, 5).forEach(v => {
    g.appendChild(svg('line', { class: 'gl', x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }));
    const t = svg('text', { class: 'ax', x: m.l - 7, y: Y(v) + 3.5, 'text-anchor': 'end' }); t.textContent = kfmt(Math.round(v)); g.appendChild(t);
  });
  ticks(x0, x1, isNarrow() ? 4 : 6).forEach(v => {
    g.appendChild(svg('line', { x1: X(v), x2: X(v), y1: m.t + ih, y2: m.t + ih + 4, stroke: 'var(--axis)', 'stroke-width': 1 }));
    const t = svg('text', { class: 'ax', x: X(v), y: m.t + ih + 17, 'text-anchor': 'middle' }); t.textContent = kfmt(Math.round(v)); g.appendChild(t);
  });
  // the league median on each axis: the cross that makes the four groups
  g.appendChild(svg('line', { x1: X(mx), x2: X(mx), y1: m.t, y2: m.t + ih, stroke: 'var(--axis)', 'stroke-width': 1.25 }));
  g.appendChild(svg('line', { x1: m.l, x2: W - m.r, y1: Y(my), y2: Y(my), stroke: 'var(--axis)', 'stroke-width': 1.25 }));

  // quadrant names ride the corners, away from the cross where the dots bunch
  const reserved = [];
  const corner = (q, x, y, anchor) => {
    const d = VALUE_QUADS[q], nm = svg('text', { x, y, 'text-anchor': anchor, 'font-size': isNarrow() ? 11.5 : 10.5, 'font-weight': 700, 'letter-spacing': '.05em', fill: 'var(--text-secondary)' });
    nm.textContent = d.name.toUpperCase(); g.appendChild(nm);
    const sb = svg('text', { class: 'ax', x, y: y + 14, 'text-anchor': anchor }); sb.textContent = d.sub; g.appendChild(sb);
    const w = Math.max(d.name.length * (isNarrow() ? 8.2 : 7.6), d.sub.length * (isNarrow() ? 5.8 : 5.4)) + 6;
    reserved.push([anchor === 'start' ? x - 3 : x - w + 3, y - 12, w, 30]);
  };
  corner('tl', m.l + 10, m.t + 20, 'start'); corner('tr', W - m.r - 10, m.t + 20, 'end');
  corner('bl', m.l + 10, m.t + ih - 24, 'start'); corner('br', W - m.r - 10, m.t + ih - 24, 'end');

  // labels: you first, then everyone who still fits; the tooltip and the table carry the rest
  const R = isNarrow() ? 11 : 12;                         // a team's logo is a disc this big
  const rOf = p => p.me ? R + 3 : R;
  const placed = reserved.slice(), dots = pts.map(p => ({ x: X(p.dyn), y: Y(p.red), r: rOf(p) }));
  const hit = (a, b) => a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
  const labels = [];
  pts.slice().sort((a, b) => (b.me ? 1 : 0) - (a.me ? 1 : 0)).forEach(p => {
    const cx = X(p.dyn), cy = Y(p.red), txt = p.t.short || p.t.name, w = txt.length * (isNarrow() ? 6.6 : 6.1) + 4, hh = 13, gap = rOf(p) + 6;
    const cands = [
      { x: cx + gap, y: cy + 4, a: 'start', r: [cx + gap - 2, cy - hh + 4, w, hh] },
      { x: cx - gap, y: cy + 4, a: 'end', r: [cx - gap - w + 2, cy - hh + 4, w, hh] },
      { x: cx, y: cy - gap - 1, a: 'middle', r: [cx - w / 2, cy - gap - 1 - hh + 3, w, hh] },
      { x: cx, y: cy + gap + 10, a: 'middle', r: [cx - w / 2, cy + gap + 10 - hh + 3, w, hh] }];
    for (const c of cands) {
      const [rx, ry, rw, rh] = c.r;
      if (rx < m.l || rx + rw > W - m.r || ry < m.t || ry + rh > m.t + ih) continue;
      if (placed.some(o => hit(c.r, o))) continue;
      if (dots.some(d => d.x > rx - d.r && d.x < rx + rw + d.r && d.y > ry - d.r && d.y < ry + rh + d.r)) continue;
      placed.push(c.r); labels.push({ p, c, txt }); break;
    }
  });

  // each team is its own logo, clipped to a disc; a team with no logo (or one that fails to
  // load) keeps a plain disc with its initial, so it is never missing from the plot
  const defs = svg('defs'); g.appendChild(defs);
  pts.forEach(p => {
    const cx = X(p.dyn), cy = Y(p.red), r = rOf(p), id = 'vq-' + p.t.rosterId;
    const cp = svg('clipPath', { id }); cp.appendChild(svg('circle', { cx, cy, r })); defs.appendChild(cp);
    g.appendChild(svg('circle', { cx, cy, r: r + 2, fill: 'var(--surface-1)' }));
    g.appendChild(svg('circle', { cx, cy, r, fill: 'var(--s1)' }));
    const ini = svg('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', 'font-size': r * 0.95, 'font-weight': 700, fill: '#fff' });
    ini.textContent = String(p.t.short || p.t.name || '?').charAt(0).toUpperCase(); g.appendChild(ini);
    if (p.t.avatar) {
      const im = svg('image', { href: p.t.avatar, x: cx - r, y: cy - r, width: r * 2, height: r * 2, 'clip-path': `url(#${id})`, preserveAspectRatio: 'xMidYMid slice' });
      im.addEventListener('error', () => im.remove());
      g.appendChild(im);
    }
    g.appendChild(svg('circle', { cx, cy, r, fill: 'none', stroke: p.me ? 'var(--text-primary)' : 'var(--border-strong)', 'stroke-width': p.me ? 2.5 : 1 }));
  });
  labels.forEach(({ p, c, txt }) => {
    const t = svg('text', { class: 'ax', x: c.x, y: c.y, 'text-anchor': c.a, fill: 'var(--text-secondary)', 'font-weight': p.me ? 800 : 600, 'paint-order': 'stroke', stroke: 'var(--surface-1)', 'stroke-width': 3, 'stroke-linejoin': 'round' });
    t.textContent = txt; g.appendChild(t);
  });
  pts.forEach(p => {
    const el = svg('circle', { cx: X(p.dyn), cy: Y(p.red), r: rOf(p) + 4, fill: 'transparent', tabindex: 0, role: 'img', 'aria-label': p.t.name + ', ' + VALUE_QUADS[p.q].name, style: 'cursor:default;outline:none' });
    bindTT(el, () => `<div class="k">${p.t.name}${p.me ? ' (you)' : ''}</div><b>${VALUE_QUADS[p.q].name}</b><br>Dynasty <b>${kfmt(Math.round(p.dyn))}</b> (#${p.dynRk})<br>Redraft <b>${kfmt(Math.round(p.red))}</b> (#${p.redRk})`);
    g.appendChild(el);
  });
  const xl = svg('text', { class: 'ax', x: m.l + iw / 2, y: H - 7, 'text-anchor': 'middle' }); xl.textContent = 'Dynasty value  →';
  const yl = svg('text', { class: 'ax', x: 12, y: m.t + ih / 2, 'text-anchor': 'middle', transform: `rotate(-90 12 ${m.t + ih / 2})` }); yl.textContent = 'Redraft value  →';
  g.appendChild(xl); g.appendChild(yl);

  // the same numbers as a table, for anyone who would rather read them
  const tbl = table([
    { k: 'name', h: 'Team', sort: r => r.t.name, f: r => teamCell(r.t, { sub: false }) },
    { k: 'q', h: 'Group', sort: r => VALUE_QUADS[r.q].name, f: r => h('span.tag', VALUE_QUADS[r.q].name) },
    { k: 'dyn', h: 'Dynasty value', num: true, sort: r => r.dyn, f: r => h('span', kfmt(Math.round(r.dyn)), h('span.tiny.muted', ' #' + r.dynRk)) },
    { k: 'red', h: 'Redraft value', num: true, sort: r => r.red, f: r => h('span', kfmt(Math.round(r.red)), h('span.tiny.muted', ' #' + r.redRk)) }
  ], pts, { sortKey: 'dyn', sortDir: -1 });
  const wt = withTable(h('div', g), tbl);
  const note = h('div.tiny.muted', { style: { marginTop: '8px' } },
    'Whole-roster trade value' + (isDynasty() ? ', picks included in dynasty' : '') + '. Lines mark the league median on each axis; the shaded corners are where the two disagree.');
  wt.body.appendChild(note);
  return card('Dynasty vs. redraft', 'every team’s roster priced both ways — where you’d sit if the league ended this year or in three', wt.body, wt.btn);
}
function leagueStrip() {
  const sim = S.sim && S.sim.by ? S.sim : null;
  const live = S.gamesPlayed > 0;
  // the Active Rankings order: wins first, then points. Before week 1 there is
  // nothing to rank on results, so it falls back to the projection.
  const rows = S.teams.slice()
    .sort(live ? ((a, b) => (b.wins - a.wins) || (b.fpts - a.fpts)) : ((a, b) => a.powerRank - b.powerRank))
    .map(t => ({ t, s: sim ? sim.by[t.rosterId] : null, form: recentForm(t, 5) }));

  const podium = leaguePodium(rows, live);
  if (!podium) return null;
  return card('The league',
    (live ? 'the table as it stands — wins, then points' : 'nothing played yet, so this is the projection')
    + (sim ? ' · and what the simulator makes of it' : ''),
    podium,
    sim ? null : h('button.btn.sm', {
      onclick: () => { S.sim = simulate(S.simN); SimUI.res = S.sim; render(); }
    }, 'Run ' + kfmt(S.simN) + ' seasons'));
}


/** A team photo, essentially: the biggest names on your roster, lined up. It is
 *  decoration first — the numbers it shows are on four other pages — so it only
 *  appears in the Default view, and it says nothing a missing headshot would
 *  make a lie of. Every face is a way into that player's page. */
function myHeadliners(me) {
  if (!isSimple() || !me) return null;
  const pool = activePlayers(me).filter(p => p.pos !== 'PICK' && (p.dv || 0) > 0);
  if (pool.length < 3) return null;
  // six either way: on a phone that wraps to two rows of three, which reads as a
  // lineup card. Four would leave a stranded fourth on its own line.
  const best = pool.slice().sort((a, b) => (b.dv || 0) - (a.dv || 0)).slice(0, 6);
  const live = S.liveWeek;

  // "J. Allen" rather than a truncated "Josh Allen ..." — six portraits across
  // do not have room for a full name, and this is how a lineup card reads anyway
  const shortName = (p) => {
    if (p.pos === 'DEF') return p.name;
    const w = String(p.name || '').trim().split(/\s+/);
    return w.length > 1 ? w[0][0] + '. ' + w.slice(1).join(' ') : p.name;
  };

  const one = (p, i) => {
    const l = live ? liveValue(p, S.liveWeek) : null;
    return h('div.lup', {
      style: { '--i': String(i) },
      tabindex: 0, role: 'button', title: p.name + ' — ' + p.pos + (p.team ? ' · ' + p.team : ''),
      onclick: () => openPlayer(p.id, 'home'),
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlayer(p.id, 'home'); } }
    },
      h('div.lupface', playerFace(p, { lg: true }), h('span.luppos.pos-' + p.pos, p.pos)),
      h('div.lupnm', shortName(p)),
      h('div.tiny.muted', { style: { lineHeight: '1.2' } },
        l && l.state === 'bye' ? 'on bye'
          : l ? h('span', h('b.sec', fmt(l.used, 1)), ' pts')
            : h('span', h('b.sec', fmt(p.ppg || 0, 1)), ' proj')));
  };

  if (isSimple()) {
    // Default view: the line-up is a hand of cards
    const hand = p => {
      const l = live ? liveValue(p, S.liveWeek) : null;
      return h('div.pcxhandi', tradingCard(p, { w: 144, back: 'home' }),
        h('div.tiny.muted', { style: { lineHeight: '1.2' } },
          l && l.state === 'bye' ? 'on bye'
            : l ? h('span', h('b.sec', fmt(l.used, 1)), ' pts')
              : h('span', h('b.sec', fmt(p.ppg || 0, 1)), ' proj')));
    };
    return card('The headliners', me.name + '’s most valuable ' + best.length + ' — click any card for the full page',
      h('div.pcxhand', best.map(hand)));
  }
  return card('The headliners', me.name + '’s most valuable ' + best.length + ' — click any face for the full page',
    h('div.lineup', best.map(one)));
}
