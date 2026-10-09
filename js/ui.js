"use strict";
/* ================= tooltip ================= */
const TT = () => $('#tt');
function ttShow(evt, html) {
  const t = TT(); t.innerHTML = html; t.classList.add('on');
  const r = t.getBoundingClientRect();
  let x = evt.clientX + 14, y = evt.clientY + 14;
  if (x + r.width > innerWidth - 8) x = evt.clientX - r.width - 12;
  if (y + r.height > innerHeight - 8) y = evt.clientY - r.height - 12;
  t.style.left = Math.max(6, x) + 'px'; t.style.top = Math.max(6, y) + 'px';
}
function ttHide() { TT().classList.remove('on'); }
function bindTT(el, htmlFn) {
  el.addEventListener('mousemove', e => ttShow(e, typeof htmlFn === 'function' ? htmlFn(e) : htmlFn));
  el.addEventListener('mouseleave', ttHide);
  // a finger never hovers, so without these every tooltip in the app is
  // unreachable on a phone
  el.addEventListener('touchstart', e => {
    const t = e.touches[0]; if (!t) return;
    ttShow({ clientX: t.clientX, clientY: t.clientY }, typeof htmlFn === 'function' ? htmlFn(e) : htmlFn);
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    const t = e.touches[0]; if (!t) return;
    ttShow({ clientX: t.clientX, clientY: t.clientY }, typeof htmlFn === 'function' ? htmlFn(e) : htmlFn);
  }, { passive: true });
  el.addEventListener('touchend', ttHide);
  el.addEventListener('touchcancel', ttHide);
  el.addEventListener('focus', e => { const r = el.getBoundingClientRect(); ttShow({ clientX: r.left + r.width / 2, clientY: r.top }, typeof htmlFn === 'function' ? htmlFn(e) : htmlFn); });
  el.addEventListener('blur', ttHide);
  return el;
}

/* ================= shared bits ================= */
function posPill(pos) { return h('span.pill.pos-' + (pos || 'NA'), pos || '—'); }
/* Sleeper hosts a headshot for every rostered player and a logo for every NFL
   team. Both are decoration: if one fails to load it hides itself and the layout
   carries on with the initials or the abbreviation it already had. */
function playerFace(p, opts) {
  opts = opts || {};
  const cls = '.face' + (opts.lg ? '.lg' : opts.xs ? '.xs' : opts.sm ? '.sm' : '');
  const initials = (() => {
    if (!p) return '—';
    if (p.pos === 'DEF' || p.pos === 'K') return p.pos;
    const w = String(p.name || '').replace(/[^A-Za-z ]/g, '').trim().split(/\s+/).filter(Boolean);
    return w.length > 1 ? (w[0][0] + w[w.length - 1][0]).toUpperCase() : (w[0] || '?').slice(0, 2).toUpperCase();
  })();
  const stub = () => h('div' + cls, {
    style: { display: 'grid', placeItems: 'center', fontSize: opts.lg ? '14px' : opts.xs ? '7.5px' : opts.sm ? '8.5px' : '10.5px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.02em' }
  }, initials);
  // a medal draws a ring around the face; the ring is the wrapper, so the
  // headshot and its fallback keep the layout they always had
  const ring = el => {
    const m = medalOf(p);
    return m ? h('span.mring' + (opts.lg ? '.lg' : opts.xs ? '.xs' : opts.sm ? '.sm' : '') + medalCls(p).replace(' medal', '.medal').replace(/ /g, '.'), { title: medalTitle(p) }, el) : el;
  };
  if (!/^\d+$/.test(String(p && p.id))) return ring(stub());
  // a headshot that fails to load is swapped for the initials, so the row keeps
  // its shape whether or not the image arrives
  return ring(h('img' + cls, {
    src: 'https://sleepercdn.com/content/nfl/players/thumb/' + p.id + '.jpg',
    alt: '', loading: 'lazy',
    onerror: e => { try { e.target.replaceWith(stub()); } catch (err) { e.target.style.visibility = 'hidden'; } }
  }));
}
function medalTitle(p) {
  const m = MEDALS.find(x => x.k === p.medal);
  return m ? m.label + ' tier — overall #' + (MEDALS.indexOf(m) ? MEDALS[MEDALS.indexOf(m) - 1].upTo + 1 : 1) + '–' + m.upTo + ' by value' : '';
}
function teamLogo(abbr) {
  if (!abbr || typeof abbr !== 'string') return null;
  return h('img.tlogo', {
    src: 'https://sleepercdn.com/images/team_logos/nfl/' + abbr.toLowerCase() + '.png',
    alt: abbr, title: abbr, loading: 'lazy', onerror: e => { e.target.style.display = 'none'; }
  });
}
/** A player line with a face, for simple mode. */
function playerCard(p, opts) {
  opts = opts || {};
  return h('div.pcard' + medalCls(p).replace(/ /g, '.'), { style: opts.style || null },
    playerFace(p),
    h('div.meta',
      h('div.nm', pname(p, { face: false })),
      h('div.sub', posPill(p.pos), p.team ? teamLogo(p.team) : null,
        opts.sub ? h('span', opts.sub) : null, injuryTag(p.injury, p))),
    opts.value !== undefined ? h('div.val', opts.value) : null);
}
/* Injury designations, abbreviated on a phone — "Questionable" is 85px of a
   348px card, and the full word is still on the tag's title. */
const INJ_SHORT = { Questionable: 'Q', Doubtful: 'D', Out: 'OUT', IR: 'IR', PUP: 'PUP', Sus: 'SUSP', COV: 'COV', DNR: 'DNR', NA: 'NA' };
/* Everywhere except the pages that are about injuries, the tag is a single letter: O, IR, D, Q. */
const INJ_TINY = Object.assign({}, INJ_SHORT, { Out: 'O' });
/** The pages that spell a status out: a player's own page, Start / Sit and Players (and the injury report on Rosters, which asks). */
const INJ_FULL_VIEWS = ['player', 'lineup', 'players'];
function injuryTag(inj, p, opts) {
  if (!inj) return null;
  const j = p && p.inj;
  const full = opts && opts.full !== undefined ? !!opts.full : INJ_FULL_VIEWS.includes(S.view);
  let label;
  if (!full) label = INJ_TINY[inj] || String(inj).slice(0, 3).toUpperCase();
  else {
    label = isNarrow() ? (INJ_SHORT[inj] || String(inj).slice(0, 3).toUpperCase()) : inj;
    // for anyone out for a stretch, say when he is due back
    if (j && j.kind === 'long' && j.label) label += isNarrow() ? ' ' + (j.season ? 'Szn' : j.R) : ' · ' + j.label;
  }
  return h('span.tag', { title: injuryTitle(p) || inj, style: { color: 'var(--critical)', borderColor: 'var(--critical)' } }, label);
}
/** The hover text for an injury tag: what, where, back when, and how we know. */
function injuryTitle(p) {
  const j = p && p.inj; if (!j) return '';
  const bits = [p.injury + (j.body ? ' — ' + j.body : '')];
  if (j.kind === 'long' && j.label) bits.push(j.season ? 'out for the season' : 'expected back ' + (j.retDate ? fmtDay(j.retDate) + ' (' + j.label + ')' : j.label));
  else if (j.text) bits.push(j.text);
  if (j.kind === 'long') bits.push(j.text);
  return bits.filter(Boolean).join(' · ');
}
/** Turn return-date estimates on or off, and re-run everything that reads them. */
function setInjuryEstimates(on) {
  LS.set('injEst', !!on);
  if (!S.teams || !S.teams.length) return;
  applyAvailability();
  S._fa = null; S._slotDemand = null; S._depth = null; S._live = null; S._wpPath = null; S.sim = null; S._short = {}; S._sig = null; S._tl = null;
  computeStrength();
}
/** One line for Settings: is the ESPN feed reachable, and how much did it tell us. */
function injFeedLine() {
  const f = S.injFeedInfo;
  const lead = INJ.enabled()
    ? 'Players who are out are projected at zero only until their estimated return, and IR-slot players due back count toward the lineup and the simulator. '
    : 'Off: anyone tagged Out or on IR is projected at zero for the rest of the season, as Sleeper’s tag alone implies. ';
  if (!f) return lead;
  const ago = f.at ? Math.max(1, Math.round((Date.now() - f.at) / 60000)) : null;
  const when = ago === null ? '' : ago < 90 ? ago + ' min ago' : Math.round(ago / 60) + ' h ago';
  const feed = f.state === 'ok' ? `ESPN feed: ${f.listed} players listed, ${f.matched} of your ${f.flagged} flagged players matched · updated ${when}.`
    : f.state === 'stale' ? `ESPN feed unreachable, using a saved copy from ${when}.`
      : 'ESPN feed unavailable (blocked or offline) — using the injury notes and typical recovery times instead.';
  return lead + feed;
}
/** A few words for why a week's projection is reduced. */
function injuryWhy(p, wk) {
  const j = p && p.inj; if (!j) return '';
  if (j.kind === 'day') return 'listed ' + p.injury.toLowerCase();
  if (j.season) return 'out for the season';
  return wk < j.R ? 'out until ' + j.label.toLowerCase().replace('wk', 'week') : 'returning from ' + (j.body ? j.body.toLowerCase() + ' ' : '') + 'injury';
}
/** The player page's injury report: what, when he is due back, how sure we are, and the
 *  chance he plays in each of the next several weeks. */
function injuryCard(p) {
  const j = p.inj; if (!j) return null;
  const cw = injCurrentWeek(), on = INJ.enabled();
  const weeks = []; for (let k = cw; k <= Math.min(S.regEnd + 3, cw + 7); k++) weeks.push(k);
  const fact = (k, v, sub) => h('div.ifact', h('div.k', k), h('div.v', v), sub ? h('div.tiny.muted', sub) : null);
  const back = j.kind === 'day' ? (j.pNow >= 0.8 ? 'Likely plays' : 'Likely sits') : j.season ? 'Out for the season' : j.label + (j.retDate ? ' · ' + fmtDay(j.retDate) : '');
  const missed = gamesMissed(p);
  const feed = j.feed;
  const words = [feed && (feed.long || feed.short), j.note].filter((x, i, a) => x && a.indexOf(x) === i);
  const strip = h('div.availstrip', { role: 'img', 'aria-label': 'Chance of playing each week' }, weeks.map(k => {
    const a = availability(p, k), bye = onBye(p, k);
    return h('div.availcell' + (bye ? '.bye' : ''), { title: 'Week ' + k + (bye ? ' — bye' : ' — ' + Math.round(a * 100) + '% likely to play') },
      h('span.tiny.mono.muted', 'Wk ' + k),
      h('span.availbar', h('i', { style: { height: bye ? '0%' : Math.round(a * 100) + '%' } })),
      h('span.tiny.mono', bye ? 'bye' : Math.round(a * 100) + '%'));
  }));
  return card('Injury report',
    on ? 'return estimates feed his projection, lineups and the simulator' : 'estimates are switched off in Settings — projections use the status tag only',
    h('div', { style: { display: 'grid', gap: '14px', gridTemplateColumns: 'minmax(0,1fr)' } },
      h('div.ifacts',
        fact('Status', injuryTag(p.injury, p) || p.injury, j.body ? j.body + (feed && feed.side ? ' (' + feed.side.toLowerCase() + ')' : '') : 'body part not listed'),
        fact('Expected back', back, j.text),
        j.kind === 'long' && !j.season ? fact('Games missed', fmt(missed, 1), 'regular season, expected') : j.kind === 'long' ? fact('Games missed', 'Rest of season', null) : null,
        fact('Source', j.espn && j.retDate ? 'ESPN' : j.src === 'note' ? 'Injury notes' : j.src === 'tag' ? 'Sleeper tag' : 'Estimate',
          j.espn ? 'ESPN lists him' : 'ESPN has no return date for him')),
      h('div', h('div.tiny.muted', { style: { marginBottom: '6px' } }, 'Chance he plays'), strip),
      words.length ? h('div.inotes', words.map(w => h('div.tiny', '“' + String(w).slice(0, 360) + '”'))) : null));
}
function fmtDay(iso) { const d = new Date(String(iso).slice(0, 10) + 'T12:00:00'); return isFinite(d) ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : iso; }
function teamCell(t, opts) {
  opts = opts || {};
  // on a phone the avatar and the owner line cost about 40px of a 348px card and
  // say nothing the team name doesn't; the name itself ellipsises
  const narrow = isNarrow();
  const sub = opts.sub === false ? null : (opts.sub || (narrow ? null : t.owner));
  if (isSimple() && !narrow && t.avatar) {
    // in simple mode the badge carries the identity, so it gets a little more room
    return h('div.tm',
      h('img.avatar', { src: t.avatar, alt: '', loading: 'lazy', onerror: e => e.target.style.visibility = 'hidden' }),
      h('div', { style: { minWidth: 0 } }, h('div.nm', { title: t.name + ' — ' + t.owner }, t.name),
        sub ? h('div.tiny.muted', { style: { lineHeight: '1.2' } }, sub) : null));
  }
  return h('div.tm',
    narrow ? null : (t.avatar ? h('img.avatar', { src: t.avatar, alt: '', loading: 'lazy', onerror: e => e.target.style.visibility = 'hidden' }) : h('div.avatar')),
    h('div', { style: { minWidth: 0 } },
      h('div.nm', { title: t.name + ' — ' + t.owner }, t.name),
      sub ? h('div.tiny.muted', { style: { lineHeight: '1.2' } }, sub) : null)
  );
}
function deltaTag(v, d, unit) {
  // a difference that rounds away at the precision being shown is not a
  // difference: "▼ 0.00" reads as a fall and is really a tie
  const dec = d === undefined ? 1 : d;
  const eps = Math.max(0.0001, 0.5 * Math.pow(10, -dec));
  const cls = v >= eps ? 'up' : v <= -eps ? 'down' : 'flat';
  const ic = v >= eps ? '▲' : v <= -eps ? '▼' : '–';
  return h('span.' + cls + '.mono', { style: { fontSize: '11.5px' } }, ic + ' ' + fmt(Math.abs(v), d === undefined ? 1 : d) + (unit || ''));
}
function kpi(label, value, sub, tip) {
  const e = h('div.kpi', h('div.lbl', label), h('div.val', value), sub ? h('div.sub', sub) : null);
  if (tip) { e.tabIndex = 0; bindTT(e, tip); }
  return e;
}
function card(title, note, body, actions) {
  return h('div.card',
    (title || actions) ? h('div.hd', h('h3', title), note ? h('span.note', note) : null,
      h('span', { style: { flex: '1' } }), actions || null) : null,
    h('div.bd', body));
}
function segmented(options, current, onPick) {
  return h('div.seg', options.map(o =>
    h('button', { class: (o.k === current ? 'on' : ''), onclick: () => onPick(o.k) }, o.label)));
}
/* Wraps anything that scrolls sideways so the overflow is visible rather than
   looking like a truncated column. The class is toggled from a measurement, so
   nothing shows when the content already fits. */
function scrollBox(inner, opts) {
  opts = opts || {};
  const box = h('div.scroll-x', inner);
  const wrap = h('div.sx' + (opts.hint === false ? '' : '.hintable'), box);
  if (opts.hint !== false) wrap.appendChild(h('div.sx-hint', opts.hint || 'scroll →'));
  const sync = () => {
    const room = box.scrollWidth - box.clientWidth;
    wrap.classList.toggle('canscroll', room > 6);
    wrap.classList.toggle('more', room - box.scrollLeft > 6);
  };
  box.addEventListener('scroll', sync, { passive: true });
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(sync); else setTimeout(sync, 0);
  setTimeout(sync, 120);
  wrap._syncScroll = sync;
  return wrap;
}

/* sortable table */
function table(allCols, rows, opts) {
  opts = opts || {};
  // a column marked prio 2 or higher is secondary: worth having on a desktop,
  // not worth pushing the first three columns off a phone screen for
  // a null in the list is a column a view decided not to draw at all — a live-only
  // status, a dynasty-only projection — so it is dropped before anything else
  const kept = allCols.filter(Boolean);
  /* `prio: 2` marks a secondary column: worth having on a desktop, not worth
     pushing the first three off a phone. The calmer Default view reuses those
     marks — but a handful of those columns are the whole reason someone opens
     the page, so `keepSimple` holds them there while a phone still drops them. */
  const cols = isNarrow() ? kept.filter(c => !(c.prio >= 2))
    : isSimple() ? kept.filter(c => !(c.prio >= 2) || c.keepSimple)
      : kept;
  const st = { key: opts.sortKey || null, dir: opts.sortDir || -1 };
  if (st.key && !cols.some(c => c.k === st.key)) {
    const kept = cols.find(c => c.num) || cols[cols.length - 1];
    if (kept) st.key = kept.k;
  }
  const wrap = h('div.scroll-x');
  const render = () => {
    clear(wrap);
    let data = rows.slice();
    if (st.key) {
      const c = cols.find(c => c.k === st.key);
      data.sort((a, b) => {
        const va = c.sort ? c.sort(a) : a[st.key], vb = c.sort ? c.sort(b) : b[st.key];
        if (va === null || va === undefined) return 1; if (vb === null || vb === undefined) return -1;
        return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * st.dir;
      });
    }
    const tb = h('table.tbl',
      h('thead', h('tr', cols.map(c => h('th', {
        class: (c.num ? 'num ' : '') + (c.sortable === false ? '' : 'sortable'),
        title: c.tip || '',
        onclick: c.sortable === false ? null : () => { st.dir = st.key === c.k ? -st.dir : (c.num === true ? -1 : 1); st.key = c.k; render(); }
      }, c.h, st.key === c.k ? (st.dir < 0 ? ' ↓' : ' ↑') : '')))),
      h('tbody', data.map((r, i) => h('tr', {
        onclick: opts.onRow ? () => opts.onRow(r) : null, style: opts.onRow ? { cursor: 'pointer' } : null,
        class: [opts.rowClass ? opts.rowClass(r) : null, rowMedal(r && r.p && r.p.id ? r.p : r)].filter(Boolean).join(' ') || null
      },
        cols.map(c => h('td', { class: c.num ? 'num' : '' }, c.f ? c.f(r, i) : r[c.k]))))));
    wrap.appendChild(tb);
    if (outer._syncScroll) outer._syncScroll();
  };
  const outer = h('div.sx.hintable', wrap, h('div.sx-hint', 'scroll →'));
  const sync = () => {
    const room = wrap.scrollWidth - wrap.clientWidth;
    outer.classList.toggle('canscroll', room > 6);
    outer.classList.toggle('more', room - wrap.scrollLeft > 6);
  };
  wrap.addEventListener('scroll', sync, { passive: true });
  outer._syncScroll = sync;
  render();
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(sync); else setTimeout(sync, 0);
  setTimeout(sync, 120);
  return outer;
}

/* ================= charts ================= */
/* horizontal bar list — one series, slot-1 blue, direct value labels */
function barList(items, opts) {
  opts = opts || {};
  const max = opts.max || Math.max(...items.map(i => Math.abs(i.v)), 1);
  return h('div', { style: { display: 'grid', gap: '5px' } }, items.map((it, i) => {
    const w = clamp(Math.abs(it.v) / max, 0, 1) * 100;
    const row = h('div', { style: { display: 'grid', gridTemplateColumns: (opts.labelW || '150px') + ' 1fr auto', gap: '9px', alignItems: 'center' } },
      h('div.tiny', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: it.hl ? '660' : '520' } }, it.label),
      h('div.bar-track', { style: { height: (opts.h || 9) + 'px' } },
        h('div.bar-fill', { style: { width: w + '%', background: it.color || (it.hl ? 'var(--s2)' : 'var(--s1)'), transition: 'width .35s' } })),
      h('div.tiny.mono.sec', { style: { minWidth: '46px', textAlign: 'right' } }, it.vl !== undefined ? it.vl : fmt(it.v, opts.dec === undefined ? 1 : opts.dec)));
    row.tabIndex = 0;
    if (it.tip) bindTT(row, it.tip);
    return row;
  }));
}

/* segmented probability bar (playoff / bye / title) */
function oddsBar(segs, opts) {
  const tot = Math.max(0.0001, sum(segs.map(s => s.v)));
  const el = h('div', { style: { display: 'flex', gap: '2px', height: (opts && opts.h || 9) + 'px', width: '100%' } },
    segs.map(s => {
      const b = h('div', { style: { width: (s.v / tot * 100) + '%', background: s.color, borderRadius: '2px', minWidth: s.v > 0 ? '2px' : '0' } });
      b.tabIndex = 0; if (s.tip) bindTT(b, s.tip); return b;
    }));
  return el;
}

/* line chart with crosshair — series: [{name,color,points:[{x,y,label}]}] */
function lineChart(series, opts) {
  opts = opts || {};
  const narrow = isNarrow();
  const W = opts.w || chartW(760, 400), H = opts.h || 230;
  const m = Object.assign(narrow ? { t: 10, r: 9, b: 24, l: 36 } : { t: 12, r: 14, b: 26, l: 46 }, opts.margin || {});
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const all = [].concat(...series.map(s => s.points));
  if (!all.length) return h('div.empty', 'No data yet');
  const xs = all.map(p => p.x), ys = all.map(p => p.y);
  let y0 = opts.y0 !== undefined ? opts.y0 : Math.min(...ys), y1 = opts.y1 !== undefined ? opts.y1 : Math.max(...ys);
  if (y1 === y0) { y1 = y0 + 1; }
  if (opts.y0 === undefined || opts.y1 === undefined) { const padY = (y1 - y0) * 0.10; y0 -= padY; y1 += padY; }
  if (opts.zero) y0 = Math.min(0, y0);
  // padding a series that bottoms out near zero pushes the axis negative, which
  // is nonsense for a quantity that cannot go below zero
  if (opts.floorAtZero && y0 < 0 && Math.min(...ys) >= 0) y0 = 0;
  const x0 = opts.x0 !== undefined ? opts.x0 : Math.min(...xs);
  const x1 = opts.x1 !== undefined ? opts.x1 : Math.max(...xs);
  const X = v => m.l + (x1 === x0 ? iw / 2 : (v - x0) / (x1 - x0) * iw);
  const Y = v => m.t + ih - (v - y0) / (y1 - y0) * ih;
  const g = svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': opts.aria || 'line chart' });
  g.style.height = H + 'px';
  /* The drawing stretches to fill its container, which is right when the
     container is narrower than the layout and wrong when it is wider: a 760-wide
     chart pulled across a 2000px monitor stretches every tick label with it. A
     chart may name the widest it is willing to be drawn. */
  if (opts.maxW) { g.style.maxWidth = opts.maxW + 'px'; g.style.display = 'block'; g.style.marginInline = 'auto'; }
  const ticks = opts.yTicks || (narrow ? 3 : 4);
  for (let i = 0; i <= ticks; i++) {
    const v = y0 + (y1 - y0) * i / ticks, y = Y(v);
    g.appendChild(svg('line', { class: 'gl', x1: m.l, x2: W - m.r, y1: y, y2: y }));
    const tx = svg('text', { class: 'ax', x: m.l - 7, y: y + 3.5, 'text-anchor': 'end' });
    tx.textContent = opts.yFmt ? opts.yFmt(v) : fmt(v, 0); g.appendChild(tx);
  }
  g.appendChild(svg('line', { class: 'axline', x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih }));
  // a reference line at a meaningful y — the coin-flip mark on a win-probability chart
  if (opts.yRule !== undefined && opts.yRule >= y0 && opts.yRule <= y1) {
    g.appendChild(svg('line', { class: 'axline', x1: m.l, x2: W - m.r, y1: Y(opts.yRule), y2: Y(opts.yRule), opacity: .75 }));
  }
  if (opts.xTickValues && opts.xTickValues.length) {
    // ticks at meaningful moments rather than evenly spaced ones
    let lastPx = -1e9;
    opts.xTickValues.forEach((t, i) => {
      if (t.x < x0 - 1e-9 || t.x > x1 + 1e-9) return;
      const px = X(t.x);
      // two labels on top of each other are worse than one label
      if (px - lastPx < (narrow ? 52 : 46)) return;
      lastPx = px;
      if (t.rule !== false) g.appendChild(svg('line', { class: 'gl', x1: px, x2: px, y1: m.t, y2: m.t + ih, 'stroke-dasharray': '2 4' }));
      const tx = svg('text', {
        class: 'ax', x: px, y: H - 8,
        'text-anchor': i === 0 ? 'start' : (i === opts.xTickValues.length - 1 && px > W - m.r - 30) ? 'end' : 'middle'
      });
      tx.textContent = t.label; g.appendChild(tx);
    });
  } else {
    const xt = opts.xTicks || (narrow ? 3 : 6);
    for (let i = 0; i <= xt; i++) {
      const v = x0 + (x1 - x0) * i / xt;
      const tx = svg('text', { class: 'ax', x: X(v), y: H - 8, 'text-anchor': i === 0 ? 'start' : i === xt ? 'end' : 'middle' });
      tx.textContent = opts.xFmt ? opts.xFmt(v) : fmt(v, 0); g.appendChild(tx);
    }
  }
  series.forEach(s => {
    const pts = s.points.slice().sort((a, b) => a.x - b.x);
    if (s.area) {
      const d = 'M' + X(pts[0].x) + ',' + (m.t + ih) + pts.map(p => 'L' + X(p.x) + ',' + Y(p.y)).join('') + 'L' + X(pts[pts.length - 1].x) + ',' + (m.t + ih) + 'Z';
      g.appendChild(svg('path', { d, fill: s.color, opacity: .10, stroke: 'none' }));
    }
    const d = pts.map((p, i) => (i ? 'L' : 'M') + X(p.x) + ',' + Y(p.y)).join('');
    g.appendChild(svg('path', {
      d, fill: 'none', stroke: s.color, 'stroke-width': s.width || 2,
      opacity: s.opacity === undefined ? 1 : s.opacity,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke'
    }));
    if (opts.dots !== false && pts.length <= 30) pts.forEach(p => g.appendChild(svg('circle', { cx: X(p.x), cy: Y(p.y), r: 3.2, fill: s.color, stroke: 'var(--surface-1)', 'stroke-width': 2 })));
    if (s.endLabel === true && pts.length) {
      const last = pts[pts.length - 1];
      const t = svg('text', { class: 'ax', x: X(last.x) + 6, y: Y(last.y) + 3.5, fill: 'var(--text-secondary)', 'font-weight': 600 });
      t.textContent = s.name; if (opts.endLabels) g.appendChild(t);
    }
  });
  const cross = svg('line', { class: 'axline', x1: 0, x2: 0, y1: m.t, y2: m.t + ih, opacity: 0, stroke: 'var(--axis)' });
  g.appendChild(cross);
  const hit = svg('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent' });
  g.appendChild(hit);
  const probe = (clientX, e) => {
    const bb = g.getBoundingClientRect();
    const px = (clientX - bb.left) / bb.width * W;
    const xv = x0 + (px - m.l) / iw * (x1 - x0);
    let near = null;
    series.forEach(s => s.points.forEach(p => { if (!near || Math.abs(p.x - xv) < Math.abs(near.x - xv)) near = p; }));
    if (!near) return;
    cross.setAttribute('x1', X(near.x)); cross.setAttribute('x2', X(near.x)); cross.setAttribute('opacity', .55);
    const cap = opts.maxTip || 12;
    const hits = series.map(s => ({ s, p: s.points.find(p => p.x === near.x) })).filter(x => x.p);
    hits.sort((a, b) => b.p.y - a.p.y);
    const rows = hits.slice(0, cap).map(({ s, p }) =>
      `<div><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${s.color};margin-right:6px"></i>${s.name}: <b>${opts.yFmt ? opts.yFmt(p.y) : fmt(p.y, 1)}</b></div>`
    ).join('') + (hits.length > cap ? `<div class="k">+${hits.length - cap} more</div>` : '');
    ttShow(e, `<div class="k">${near.label || (opts.xFmt ? opts.xFmt(near.x) : near.x)}</div>${rows}`);
  };
  hit.addEventListener('mousemove', e => probe(e.clientX, e));
  hit.addEventListener('mouseleave', () => { cross.setAttribute('opacity', 0); ttHide(); });
  // dragging a finger along the plot moves the crosshair, the way it would a cursor
  const touch = e => { const t = e.touches[0]; if (t) probe(t.clientX, { clientX: t.clientX, clientY: t.clientY }); };
  hit.addEventListener('touchstart', touch, { passive: true });
  hit.addEventListener('touchmove', touch, { passive: true });
  const endTouch = () => { cross.setAttribute('opacity', 0); ttHide(); };
  hit.addEventListener('touchend', endTouch);
  hit.addEventListener('touchcancel', endTouch);
  return g;
}

/* vertical histogram */
function histogram(bins, opts) {
  opts = opts || {};
  const W = opts.w || chartW(400, 340), H = opts.h || 150, m = { t: 8, r: 8, b: 24, l: 8 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const max = Math.max(...bins.map(b => b.v), 0.0001);
  const bw = iw / bins.length;
  const g = svg('svg', Object.assign({ class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.aria || 'distribution' },
    opts.stretch ? { preserveAspectRatio: 'none' } : {}));
  g.style.height = H + 'px';
  // `stretch` lets the bars fill a narrower container, which is what it is for.
  // Letting them fill a *wider* one pulls the axis labels and the bar corners
  // out of shape, so the drawing stops at the width it was designed at.
  if (opts.stretch) {
    g.style.maxWidth = (opts.maxW || W) + 'px';
    g.style.display = 'block';
    g.style.marginInline = 'auto';
  }
  // a vertical rule at a meaningful x — zero on a margin chart, say
  if (opts.rule !== undefined) {
    const ri = bins.findIndex(b => b.x >= opts.rule);
    if (ri >= 0) {
      const rx = m.l + ri * bw;
      g.appendChild(svg('line', { class: 'axline', x1: rx, x2: rx, y1: m.t, y2: m.t + ih, 'stroke-dasharray': '3 3', 'vector-effect': 'non-scaling-stroke' }));
    }
  }
  bins.forEach((b, i) => {
    const hgt = b.v / max * ih;
    const x = m.l + i * bw, y = m.t + ih - hgt;
    const r = svg('rect', { x: x + 1, y, width: Math.max(1, bw - 2), height: Math.max(0, hgt), rx: Math.min(4, bw / 2 - 1), fill: b.color || 'var(--s1)' });
    r.style.cursor = 'default';
    const rr = svg('rect', { x, y: m.t, width: bw, height: ih, fill: 'transparent' });
    rr.addEventListener('mousemove', e => ttShow(e, `<div class="k">${b.label}</div><b>${pct(b.v, 1)}</b>`));
    rr.addEventListener('mouseleave', ttHide);
    g.appendChild(r); g.appendChild(rr);
    if (bins.length <= 30 && (i % Math.ceil(bins.length / 9) === 0 || bins.length <= 12)) {
      const t = svg('text', { class: 'ax', x: x + bw / 2, y: H - 8, 'text-anchor': 'middle' }); t.textContent = b.x; g.appendChild(t);
    }
  });
  g.appendChild(svg('line', { class: 'axline', x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih }));
  return g;
}

/* sequential heatmap, teams × positions */
const SEQ = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95'];
function seqColor(t) { return SEQ[clamp(Math.round(t * (SEQ.length - 1)), 0, SEQ.length - 1)]; }
function heat(rows, cols, get, opts) {
  opts = opts || {};
  const vals = [];
  rows.forEach(r => cols.forEach(c => vals.push(get(r, c))));
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const nrm = v => mx === mn ? .5 : (v - mn) / (mx - mn);
  const grid = h('div', { style: { display: 'grid', gridTemplateColumns: `minmax(120px,1.4fr) repeat(${cols.length}, minmax(52px,1fr))`, gap: '2px', minWidth: (140 + cols.length * 58) + 'px' } });
  grid.appendChild(h('div'));
  cols.forEach(c => grid.appendChild(h('div.tiny.muted', { style: { textAlign: 'center', fontWeight: '660', paddingBottom: '2px' } }, c)));
  rows.forEach(r => {
    grid.appendChild(h('div.tiny', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', alignSelf: 'center', fontWeight: '540' } }, opts.rowLabel(r)));
    cols.forEach(c => {
      const v = get(r, c), t = nrm(v);
      const cell = h('div.mono', {
        style: {
          background: seqColor(t), color: t > 0.55 ? '#fff' : '#0b0b0b', textAlign: 'center',
          padding: '7px 4px', borderRadius: '5px', fontSize: '11.5px', fontWeight: '600', cursor: 'default'
        }, tabindex: 0
      }, opts.fmt ? opts.fmt(v, r, c) : fmt(v, 0));
      bindTT(cell, () => opts.tip ? opts.tip(r, c, v) : `<div class="k">${opts.rowLabel(r)} · ${c}</div><b>${fmt(v, 1)}</b>`);
      grid.appendChild(cell);
    });
  });
  return scrollBox(grid);
}
function seqLegend(lo, hi, label) {
  return h('div.legend', h('span.tiny.muted', label), h('span.tiny.mono.muted', lo),
    h('span', { style: { display: 'inline-flex', gap: '2px' } }, SEQ.filter((_, i) => i % 2 === 0).map(c => h('span', { style: { width: '15px', height: '9px', background: c, borderRadius: '2px' } }))),
    h('span.tiny.mono.muted', hi));
}

/* diverging bar (centered at zero), blue = positive, red = negative */
function divBar(items, opts) {
  opts = opts || {};
  const max = Math.max(...items.map(i => Math.abs(i.v)), 0.0001);
  return h('div', { style: { display: 'grid', gap: '5px' } }, items.map(it => {
    const w = Math.abs(it.v) / max * 50;
    const row = h('div', { style: { display: 'grid', gridTemplateColumns: (opts.labelW || '160px') + ' 1fr auto', gap: '9px', alignItems: 'center' } },
      h('div.tiny', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, it.label),
      h('div', { style: { position: 'relative', height: '9px', background: 'var(--div-neutral)', borderRadius: '3px' } },
        h('div', {
          style: {
            position: 'absolute', top: 0, bottom: 0, borderRadius: '3px',
            left: it.v >= 0 ? '50%' : (50 - w) + '%', width: w + '%',
            background: it.v >= 0 ? (opts.posColor || 'var(--s1)') : (opts.negColor || 'var(--s8)')
          }
        }),
        h('div', { style: { position: 'absolute', left: '50%', top: '-2px', bottom: '-2px', width: '1px', background: 'var(--axis)' } })),
      h('div.tiny.mono', {
        class: opts.posColor ? 'sec' : (it.v > 0 ? 'up' : it.v < 0 ? 'down' : 'flat'),
        style: { minWidth: '54px', textAlign: 'right', fontWeight: 620, color: opts.posColor ? (it.v >= 0 ? opts.posColor : opts.negColor) : null }
      }, it.vl !== undefined ? it.vl : sgn(it.v, opts.dec === undefined ? 0 : opts.dec)));
    row.tabIndex = 0; if (it.tip) bindTT(row, it.tip);
    return row;
  }));
}

function sparkline(pts, opts) {
  opts = opts || {};
  const W = opts.w || 90, H = opts.h || 24;
  if (pts.length < 2) return h('span.muted.tiny', '—');
  const ys = pts.map(p => p.v), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const X = i => i / (pts.length - 1) * (W - 2) + 1;
  const Y = v => H - 2 - (y1 === y0 ? .5 : (v - y0) / (y1 - y0)) * (H - 4);
  const up = ys[ys.length - 1] >= ys[0];
  const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, style: 'display:block' });
  g.appendChild(svg('path', { d: pts.map((p, i) => (i ? 'L' : 'M') + X(i) + ',' + Y(p.v)).join(''), fill: 'none', stroke: up ? 'var(--good)' : 'var(--critical)', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }));
  g.appendChild(svg('circle', { cx: X(pts.length - 1), cy: Y(ys[ys.length - 1]), r: 2.2, fill: up ? 'var(--good)' : 'var(--critical)' }));
  return g;
}

/* toggle between a chart and its table twin */
function withTable(chartEl, tableEl, note) {
  let showing = 'chart';
  const body = h('div', chartEl);
  const btn = h('button.btn.sm', { onclick: () => { showing = showing === 'chart' ? 'table' : 'chart'; clear(body).appendChild(showing === 'chart' ? chartEl : tableEl); btn.textContent = showing === 'chart' ? 'Table view' : 'Chart view'; } }, 'Table view');
  return { body, btn, note };
}
/* ================= week-by-week bars (actual vs projected) ================= */
function weeklyBars(items, opts) {
  opts = opts || {};
  const W = opts.w || chartW(720, 400), H = opts.h || 190,
    m = isNarrow() ? { t: 10, r: 8, b: 24, l: 28 } : { t: 10, r: 10, b: 26, l: 36 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const vals = items.filter(i => i.v !== null && i.v !== undefined).map(i => i.v);
  const max = Math.max(...vals, 1) * 1.08;
  const bw = iw / Math.max(1, items.length);
  const g = svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.aria || 'weekly points' });
  g.style.height = H + 'px';
  for (let i = 0; i <= 3; i++) {
    const v = max * i / 3, y = m.t + ih - (v / max) * ih;
    g.appendChild(svg('line', { class: 'gl', x1: m.l, x2: W - m.r, y1: y, y2: y }));
    const t = svg('text', { class: 'ax', x: m.l - 6, y: y + 3.5, 'text-anchor': 'end' }); t.textContent = fmt(v, 0); g.appendChild(t);
  }
  items.forEach((it, i) => {
    const x = m.l + i * bw;
    if (it.v === null || it.v === undefined) {
      const t = svg('text', { class: 'ax', x: x + bw / 2, y: m.t + ih - 4, 'text-anchor': 'middle', opacity: .5 });
      t.textContent = it.bye ? 'BYE' : '–';
      if (it.bye) t.setAttribute('font-size', '8');
      g.appendChild(t);
    } else {
      const hgt = Math.max(1.5, (it.v / max) * ih);
      g.appendChild(svg('rect', {
        x: x + 2, y: m.t + ih - hgt, width: Math.max(1, bw - 4), height: hgt, rx: Math.min(4, (bw - 4) / 2),
        fill: it.kind === 'proj' ? 'var(--seq-200)' : it.kind === 'live' ? 'var(--s4)' : 'var(--s1)'
      }));
      // a genuine zero is a one-pixel sliver, which reads as no data at all —
      // the mark is what tells you it is a zero somebody meant
      if (it.mark) {
        const t = svg('text', { class: 'ax', x: x + bw / 2, y: m.t + ih - 5, 'text-anchor': 'middle', 'font-size': '8', opacity: .75 });
        t.textContent = it.mark;
        g.appendChild(t);
      }
    }
    const hit = svg('rect', { x, y: m.t, width: bw, height: ih, fill: 'transparent' });
    hit.addEventListener('mousemove', e => ttShow(e, `<div class="k">Week ${it.x}${it.kind === 'proj' ? ' · projected' : it.kind === 'live' ? ' · in progress' : ''}</div>` +
      (it.v === null || it.v === undefined
        ? '<b>' + (it.note || 'Did not play') + '</b>'
        : `<b>${fmt(it.v, 1)}</b> pts` + (it.note ? '<br>' + it.note : ''))));
    hit.addEventListener('mouseleave', ttHide);
    g.appendChild(hit);
    if (items.length <= 20 || i % 2 === 0) {
      const t = svg('text', { class: 'ax', x: x + bw / 2, y: H - 8, 'text-anchor': 'middle' }); t.textContent = it.x; g.appendChild(t);
    }
  });
  g.appendChild(svg('line', { class: 'axline', x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih }));
  return g;
}

/* ================= playoff bracket ================= */
function bracketView(sim) {
  const cols = sim.bracket.map((round, ri) => {
    const cards = [];
    if (round.byes && round.byes.length) {
      round.byes.forEach(r => cards.push(h('div', {
        style: {
          border: '1px dashed var(--border-strong)', borderRadius: 'var(--r-sm)', padding: '8px 10px',
          background: 'var(--surface-2)', display: 'grid', gap: '2px'
        }
      },
        h('div.row', { style: { gap: '6px', flexWrap: 'nowrap' } }, h('span.tag', ord(r.seed)), teamFace(r.team, 22), h('b.tiny', r.team.name)),
        h('div.tiny.muted', 'First-round bye'))));
    }
    round.games.forEach(g => {
      const side = (r, pts, top, won) => h('div.row', {
        style: { justifyContent: 'space-between', gap: '8px', opacity: won ? 1 : .55, padding: '2px 0' }
      },
        h('div.row', { style: { gap: '6px', minWidth: 0, flexWrap: 'nowrap' } },
          h('span.tag', { style: { minWidth: '22px', textAlign: 'center' } }, ord(r.seed)),
          teamFace(r.team, 22),
          h('span', { style: { fontWeight: won ? 680 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12.5px' } }, r.team.name)),
        h('b.mono', { style: { fontSize: '13px', color: won ? 'var(--text-primary)' : 'var(--text-secondary)' } }, fmt(pts, 1)));
      const cardEl = h('div', {
        style: {
          border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '8px 10px',
          background: 'var(--surface-1)', boxShadow: 'var(--shadow)', display: 'grid', gap: '1px'
        }, tabindex: 0
      },
        side(g.a, g.aPts, g.aTop, g.win === g.a),
        side(g.b, g.bPts, g.bTop, g.win === g.b));
      bindTT(cardEl, `<div class="k">${round.name} · week ${round.week}</div>` +
        `<b>${g.win.team.name}</b> by ${fmt(g.margin, 1)}<br>` +
        (g.aTop ? `${g.a.team.short} best: ${g.aTop.name} ${fmt(g.aTop.pts, 1)}<br>` : '') +
        (g.bTop ? `${g.b.team.short} best: ${g.bTop.name} ${fmt(g.bTop.pts, 1)}` : ''));
      cards.push(cardEl);
    });
    return h('div', { style: { display: 'flex', flexDirection: 'column', justifyContent: 'space-around', gap: '10px', minWidth: '188px' } },
      h('div.tiny.muted', { style: { fontWeight: 660, textTransform: 'uppercase', letterSpacing: '.05em' } }, round.name),
      cards);
  });
  if (sim.champion) {
    cols.push(h('div', { style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: '188px' } },
      h('div.tiny.muted', { style: { fontWeight: 660, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '10px' } }, 'Champion'),
      h('div', {
        style: {
          border: '2px solid var(--s1)', borderRadius: 'var(--r)', padding: '12px',
          background: 'color-mix(in srgb, var(--s1) 9%, var(--surface-1))', textAlign: 'center'
        }
      },
        h('div', { style: { fontSize: '22px', lineHeight: 1 } }, '🏆'),
        h('div', { style: { display: 'grid', placeItems: 'center', marginTop: '6px' } }, teamFace(sim.champion.team, 40)),
        h('div', { style: { fontWeight: 700, marginTop: '5px' } }, sim.champion.team.name),
        h('div.tiny.muted', ord(sim.champion.seed) + ' seed · ' + sim.champion.w + '-' + sim.champion.l))));
  }
  if (isNarrow()) {
    // a phone has no room for rounds side by side: read them top to bottom instead
    return h('div.brkv', cols.map(c => { c.style.minWidth = '0'; c.style.justifyContent = 'stretch'; return c; }));
  }
  return scrollBox(h('div', { style: { display: 'flex', gap: '16px', padding: '4px 2px 8px', minWidth: 'min-content' } }, cols));
}

/* ---------- a position group, drawn as its shape ----------
   One bar per player in the group, tallest first, with the starters filled and
   the bench hollow and a cut between them. Two rules run across it: what the
   league's starters at this position are worth, and what the wire is worth. In
   one glance that says whether a group is two stars and a cliff, four of the
   same player, or genuinely deep — which is the question a total cannot answer. */
function depthBars(e, opts) {
  opts = opts || {};
  const show = clamp(e.n + 2, 4, 6);
  const W = opts.w || 236, H = opts.h || 98, m = { t: 9, r: 6, b: 15, l: 6 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const max = Math.max(e.top, e.lgStart, e.base, 1) * 1.14;
  const bw = iw / show;
  const g = svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': e.pos + ' starters and depth' });
  g.style.height = H + 'px'; g.style.maxWidth = W + 'px'; g.style.display = 'block';
  const Y = v => m.t + ih - clamp(v / max, 0, 1) * ih;
  const rule = (v, cls, dash, op) => g.appendChild(svg('line', { class: cls, x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), 'stroke-dasharray': dash, opacity: op }));
  rule(e.base, 'gl', '2 3', .9);                 // the wire
  rule(e.lgStart, 'axline', '4 3', .85);         // the league's starters here
  for (let i = 0; i < show; i++) {
    const p = e.group[i] || null, v = p ? (p.ppg || 0) : 0;
    const x = m.l + i * bw, starter = i < e.n;
    g.appendChild(svg('rect', {
      x: x + 2.5, y: Y(v), width: Math.max(2, bw - 5), height: Math.max(1, (m.t + ih) - Y(v)), rx: 2,
      fill: starter ? (opts.colour || 'var(--s1)') : 'var(--surface-3)',
      stroke: starter ? 'none' : 'var(--border)', 'shape-rendering': 'crispEdges'
    }));
    const lb = svg('text', { class: 'ax', x: x + bw / 2, y: H - 4, 'text-anchor': 'middle', 'font-size': '8.5' });
    lb.textContent = p ? fmt(v, 1) : '—';
    g.appendChild(lb);
    const hit = svg('rect', { x: x, y: m.t, width: bw, height: ih, fill: 'transparent' });
    bindTT(hit, p
      ? `<div class="k">${starter ? 'Starter' : 'Bench'} ${i + 1}</div><b>${p.name}</b><br>${fmt(v, 1)} pts/wk`
      : `<div class="k">Slot ${i + 1}</div>Nobody — the wire is worth ${fmt(e.base, 1)}`);
    g.appendChild(hit);
  }
  // the line between who starts and who waits
  const cx = m.l + e.n * bw;
  g.appendChild(svg('line', { x1: cx, x2: cx, y1: m.t - 3, y2: m.t + ih + 3, stroke: 'var(--text-muted)', 'stroke-dasharray': '2 2', opacity: .85 }));
  return g;
}
