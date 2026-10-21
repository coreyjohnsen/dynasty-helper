"use strict";
/* ================= value outlook: what the market pays at each age =================
   Every priced player today, grouped by age (or years in the league) and position.
   That cross-section is the market's own aging curve: what a player of that age at
   that position is worth right now. Applied to one player's current price it gives
   a rough path for his value; summed over a roster, where that roster is heading.

   It is a snapshot, not a record of careers. Players who washed out are no longer
   priced, so the older end of each curve is the survivors, and the decline it
   shows is gentler than most careers have. */
const OutlookUI = { by: 'age', metric: 'top', pos: { QB: true, RB: true, WR: true, TE: true } };
const OUTLOOK_COLOR = { QB: 'var(--s8)', RB: 'var(--s3)', WR: 'var(--s1)', TE: 'var(--s2)' };
const OUTLOOK_TOP = 8;      // how many of the best players at each age the "top" curve averages
const OUTLOOK_MIN = 3;      // fewer players than this in a group says nothing
const OUTLOOK_YEARS = 5;

/** The market's value curve for one position: x (age or years in) -> value, smoothed. */
function outlookCurve(pos, by, metric) {
  // prices change only when the player index is rebuilt, so the curves live as long as it does
  if (S._ocurveIdx !== S.index) { S._ocurve = {}; S._ocurveIdx = S.index; }
  const key = pos + '|' + by + '|' + metric;
  if (S._ocurve[key]) return S._ocurve[key];
  const groups = {};
  for (const id in S.index) {
    const p = S.index[id];
    if (p.pos !== pos || !((p.dvDyn || 0) > 0)) continue;
    const x = by === 'age' ? (p.age ? Math.floor(p.age) : null) : (p.exp !== null && p.exp !== undefined ? p.exp : null);
    if (x === null || x < (by === 'age' ? 20 : 0) || x > (by === 'age' ? 38 : 17)) continue;
    (groups[x] = groups[x] || []).push(p.dvDyn);
  }
  const raw = {};
  Object.keys(groups).forEach(k => {
    const vs = groups[k].sort((a, b) => b - a);
    if (vs.length < OUTLOOK_MIN) return;
    raw[k] = { v: metric === 'top' ? mean(vs.slice(0, OUTLOOK_TOP)) : vs[vs.length >> 1], n: vs.length };
  });
  // a light 1-2-1 smoothing: one age group is a handful of players, and one star moves it
  const xs = Object.keys(raw).map(Number).sort((a, b) => a - b);
  const pts = xs.map(x => {
    let w = 2, v = raw[x].v * 2;
    [x - 1, x + 1].forEach(n => { if (raw[n]) { v += raw[n].v; w++; } });
    return { x, v: v / w, n: raw[x].n };
  });
  S._ocurve[key] = pts;
  return pts;
}
/** The curve's value at a fractional x, straight-line between groups; null outside what it covers. */
function curveAt(pts, x) {
  if (!pts.length || x < pts[0].x || x > pts[pts.length - 1].x) return null;
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i].x) { const a = pts[i - 1], b = pts[i]; return a.v + (b.v - a.v) * (x - a.x) / (b.x - a.x); }
  }
  return pts[pts.length - 1].v;
}
/** A player's value a year at a time, from the market curve for his position.
 *  Stars follow the curve of the best players at each age; everyone else the median. */
function projectValue(p, years) {
  if (!POS4.includes(p.pos) || !p.age || !((p.dvDyn || 0) > 0)) return null;
  const top = (p.dvRank || 999) <= (p.pos === 'TE' || (p.pos === 'QB' && !S.cfg.superflex) ? 12 : 24);
  const pts = outlookCurve(p.pos, 'age', top ? 'top' : 'median');
  // ages are grouped by whole year, so step along the groups from his own
  const a0 = Math.floor(p.age), here = curveAt(pts, a0);
  if (!here) return null;
  const out = [{ yr: 0, age: p.age, v: p.dvDyn }];
  for (let k = 1; k <= (years || OUTLOOK_YEARS); k++) {
    const there = curveAt(pts, a0 + k);
    if (there === null) break;                 // past the oldest priced players: the curve has nothing to say
    out.push({ yr: k, age: p.age + k, v: Math.round(p.dvDyn * clamp(there / here, 0.05, 2)) });
  }
  return out;
}

/* ---------- the page: Stock Mode → Age curves ---------- */
function viewOutlook() {
  const wrap = h('div.grid');
  const O = OutlookUI, byAge = O.by === 'age';
  const shown = POS4.filter(pos => O.pos[pos]);
  const curves = {}; POS4.forEach(pos => curves[pos] = outlookCurve(pos, O.by, O.metric));

  const controls = h('div.row', { style: { gap: '14px', alignItems: 'flex-end', flexWrap: 'wrap' } },
    h('label.fld', 'Group by', segmented([{ k: 'age', label: 'Age' }, { k: 'exp', label: 'Years in league' }], O.by, k => { O.by = k; render(); })),
    h('label.fld', 'Measure', segmented([{ k: 'top', label: 'Top ' + OUTLOOK_TOP + ' average' }, { k: 'median', label: 'Median' }], O.metric, k => { O.metric = k; render(); })),
    h('label.fld', 'Positions', h('div.chipwrap', POS4.map(pos => h('button.chip' + (O.pos[pos] ? '.on' : ''), {
      onclick: () => { O.pos[pos] = !O.pos[pos]; if (!POS4.some(x => O.pos[x])) O.pos[pos] = true; render(); }
    }, pos)))));

  const xLbl = (x) => byAge ? 'age ' + x : x === 0 ? 'rookies' : x + (x === 1 ? ' year' : ' years') + ' in';
  const chart = lineChart(shown.map(pos => ({
    name: pos, color: OUTLOOK_COLOR[pos], width: 2.2,
    points: curves[pos].map(c => ({ x: c.x, y: c.v, label: xLbl(c.x) }))
  })), { h: 280, yFmt: v => kfmt(Math.round(v)), xFmt: x => byAge ? fmt(x, 0) : fmt(x, 0) + 'y', floorAtZero: true, aria: 'dynasty value by ' + (byAge ? 'age' : 'years in the league') });
  const legend = h('div.legend', { style: { marginTop: '8px' } }, shown.map(pos => h('span', h('i', { style: { background: OUTLOOK_COLOR[pos] } }), pos)));
  const xsAll = Array.from(new Set([].concat(...shown.map(pos => curves[pos].map(c => c.x))))).sort((a, b) => a - b);
  const tbl = table([{ k: 'x', h: byAge ? 'Age' : 'Years in', num: true, f: r => byAge ? r.x : xLbl(r.x) }].concat(shown.map(pos => ({
    k: pos, h: pos, num: true, sort: r => r[pos] ? r[pos].v : -1,
    f: r => r[pos] ? h('span.mono', kfmt(Math.round(r[pos].v)), h('span.tiny.muted', ' · ' + r[pos].n)) : h('span.muted.tiny', '—')
  }))), xsAll.map(x => { const r = { x }; shown.forEach(pos => r[pos] = curves[pos].find(c => c.x === x)); return r; }), { sortKey: 'x', sortDir: 1 });
  const wt = withTable(h('div', chart, legend), tbl);
  wrap.appendChild(card('Dynasty value by ' + (byAge ? 'age' : 'years in the league'),
    (O.metric === 'top' ? `average of the ${OUTLOOK_TOP} most valuable players in each group` : 'the middle player in each group')
    + ` · every priced player today, groups of fewer than ${OUTLOOK_MIN} left out, lightly smoothed · table shows how many players are in each group`,
    h('div', controls, h('div', { style: { marginTop: '14px' } }, wt.body)), wt.btn));

  // where each position peaks, and how fast it falls after that
  if (byAge) {
    const rows = POS4.map(pos => {
      const c = outlookCurve(pos, 'age', O.metric);
      if (!c.length) return null;
      const peak = c.reduce((a, b) => b.v > a.v ? b : a);
      const later = c.find(x => x.x === peak.x + 4);
      const half = c.find(x => x.x > peak.x && x.v < peak.v / 2);
      return { pos, peak, perYr: later ? Math.pow(later.v / peak.v, 1 / 4) - 1 : null, half: half ? half.x : null };
    }).filter(Boolean);
    wrap.appendChild(card('Where each position peaks', 'read from the curve above · the drop is the market\'s, at today\'s prices',
      table([
        { k: 'pos', h: 'Pos', f: r => posPill(r.pos) },
        { k: 'age', h: 'Peak age', num: true, sort: r => r.peak.x, f: r => h('b.mono', r.peak.x) },
        { k: 'v', h: 'Value at peak', num: true, sort: r => r.peak.v, f: r => kfmt(Math.round(r.peak.v)) },
        { k: 'yr', h: 'Yearly change after', num: true, sort: r => r.perYr === null ? 0 : r.perYr, f: r => r.perYr === null ? h('span.muted.tiny', '—') : h('span.mono', { class: r.perYr < 0 ? 'down' : 'up' }, sgn(r.perYr * 100, 0) + '%') },
        { k: 'half', h: 'Half of peak by', num: true, sort: r => r.half || 99, f: r => r.half ? 'age ' + r.half : h('span.muted.tiny', 'not within the data') }
      ], rows, { sortKey: 'age', sortDir: 1 })));
  }

  // every roster, carried forward on the same curves
  const tRows = S.teams.map(t => {
    const paths = t.players.filter(p => POS4.includes(p.pos) && (p.dvDyn || 0) > 0).map(p => ({ p, path: projectValue(p, 3) }));
    const now = sum(paths.map(x => x.p.dvDyn));
    const at = (k) => sum(paths.map(x => x.path && x.path[k] ? x.path[k].v : 0));
    const share = (lo, hi) => now ? sum(paths.filter(x => x.p.age >= lo && x.p.age < hi).map(x => x.p.dvDyn)) / now : 0;
    return { t, now, y1: at(1), y2: at(2), y3: at(3), young: share(0, 25), prime: share(25, 29), old: share(29, 99) };
  });
  wrap.appendChild(card('Where each roster is heading', 'players only, picks left out · each player carried forward on his position\'s curve · a player older than anyone priced at his position counts as nothing',
    table([
      { k: 'name', h: 'Team', sort: r => r.t.name, f: r => teamCell(r.t) },
      { k: 'now', h: 'Players now', num: true, f: r => kfmt(Math.round(r.now)) },
      { k: 'y1', prio: 2, h: 'In 1 year', num: true, f: r => kfmt(Math.round(r.y1)) },
      { k: 'y3', h: 'In 3 years', num: true, f: r => h('b.mono', kfmt(Math.round(r.y3))) },
      { k: 'chg', h: 'Change', num: true, sort: r => r.now ? r.y3 / r.now : 0, f: r => h('span.mono', { class: r.y3 >= r.now ? 'up' : 'down' }, sgn(r.now ? (r.y3 / r.now - 1) * 100 : 0, 0) + '%') },
      { k: 'young', prio: 2, h: 'Under 25', num: true, f: r => pct(r.young, 0) },
      { k: 'prime', prio: 2, h: '25–28', num: true, f: r => pct(r.prime, 0) },
      { k: 'old', prio: 2, h: '29+', num: true, f: r => pct(r.old, 0) }
    ], tRows, { sortKey: 'chg', sortDir: -1 })));

  wrap.appendChild(h('div.tiny.muted', 'These are today\'s prices for players of each age, not a record of how careers went. Players who washed out are no longer priced, so the older end of every curve is the survivors and the real decline is usually steeper. Treat a projection as the market\'s current view of a typical path, not a forecast for one player.'));
  return wrap;
}

/* ---------- one player: his value carried forward ---------- */
function playerOutlookCard(p) {
  const path = projectValue(p, OUTLOOK_YEARS);
  if (!path || path.length < 2) return null;
  const yr0 = S.season || new Date().getFullYear();
  const last = path[path.length - 1];
  const chart = lineChart([{
    name: p.name, color: last.v >= path[0].v ? 'var(--s1)' : 'var(--s8)', dash: '5 5',
    points: path.map(s => ({ x: s.yr, y: s.v, label: (yr0 + s.yr) + ' · age ' + fmt(s.age, 0) }))
  }], { h: 200, yFmt: v => kfmt(Math.round(v)), xTicks: path.length - 1, xFmt: x => String(yr0 + Math.round(x)), floorAtZero: true, aria: 'projected value' });
  const tbl = table([
    { k: 'yr', h: 'Season', num: true, f: r => yr0 + r.yr },
    { k: 'age', h: 'Age', num: true, f: r => fmt(r.age, 0) },
    { k: 'v', h: 'Value', num: true, f: r => r.yr ? kfmt(r.v) : h('b.mono', kfmt(r.v)) },
    { k: 'chg', h: 'vs today', num: true, f: r => r.yr ? h('span.mono', { class: r.v >= path[0].v ? 'up' : 'down' }, sgn((r.v / path[0].v - 1) * 100, 0) + '%') : h('span.muted.tiny', 'today') }
  ], path, { sortKey: 'yr', sortDir: 1 });
  const wt = withTable(chart, tbl);
  const top = (p.dvRank || 999) <= (p.pos === 'TE' || (p.pos === 'QB' && !S.cfg.superflex) ? 12 : 24);
  return card('Projected value', `an estimate: his ${valueWord() === 'dynasty' ? '' : 'dynasty '}value today, carried along the market's curve for ${top ? 'the best ' + p.pos + 's' : 'a typical ' + p.pos} at each age`
    + (path.length <= OUTLOOK_YEARS ? ' · stops where no older ' + p.pos + 's are priced' : ''),
    wt.body, h('div.row', { style: { gap: '8px' } }, wt.btn, h('button.btn.sm', { onclick: () => { S.view = 'stock'; StockUI.kind = 'outlook'; render(); window.scrollTo(0, 0); } }, 'Age curves →')));
}
