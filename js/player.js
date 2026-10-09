"use strict";
/* ================= clickable player name ================= */
function openPlayer(id, back) {
  PlayerUI.id = String(id);
  PlayerUI.back = back || S.view;
  S.view = 'player';
  render(); window.scrollTo(0, 0);
}
/** A player's name, rendered as a link into the player page. In the default
 *  view it carries the player's headshot, so a face turns up wherever a name
 *  does — trades, the draft board, head to head, everywhere. Pass
 *  `face: false` where the surrounding row already shows one. */
function pname(p, opts) {
  opts = opts || {};
  if (!p || p.pos === 'PICK' || !p.id) return h('span', (p && (p.name || p.label)) || '—');
  const el = h('span.plink', {
    tabindex: 0, role: 'link',
    style: opts.style || null,
    onclick: (e) => { e.stopPropagation(); openPlayer(p.id); },
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openPlayer(p.id); } }
  }, p.name);
  attachCardPop(el, p);
  if (!isSimple() || opts.face === false) return opts.mirror ? h('span.pnf.mir', el) : el;
  // mirrored puts the headshot on the outside, so two of these facing each other
  // read as a pair rather than as two left-aligned lists
  return h('span.pnf' + (opts.mirror ? '.mir' : ''), playerFace(p, { sm: true }), el);
}

/* ================= 9. PLAYER PAGE ================= */
const PlayerUI = { id: null, back: 'roster', range: 90 };
/* ================= trading card (player page, Default view) ================= */
/** NFL draft line for the card: "2023 · Rd 1 · #5", a rookie with no record yet, or undrafted. */
function draftLine(p) {
  if (p.draft && p.draft.round) return { top: 'Rd ' + p.draft.round + ' · #' + p.draft.pick, sub: String(p.draft.year || '') };
  return { top: p.exp === 0 ? 'Rookie' : 'Undrafted', sub: p.exp === 0 ? 'class of ' + (S.season || '') : '' };
}
function tradingCard(p, opts) {
  opts = opts || {};
  const tier = medalOf(p) || 'none';
  const dl = draftLine(p);
  const cell = (k, v, sub) => h('div.pcxs', h('div.pcxk', k), h('div.pcxv', v), sub ? h('div.pcxsub', sub) : null);
  const isDef = p.pos === 'DEF';
  const full = !isDef && /^\d+$/.test(String(p.id)) ? 'https://sleepercdn.com/content/nfl/players/' + p.id + '.jpg' : null;
  const defTeam = String(p.team || p.id || '').toLowerCase();
  const art = h('div.pcxart' + (isDef ? '.pcxdef' : ''),
    h('div.pcxpos', p.pos),
    isDef && defTeam ? h('img.pcxdeflogo', {
      src: 'https://sleepercdn.com/images/team_logos/nfl/' + defTeam + '.png', alt: '',
      onerror: e => { e.target.style.visibility = 'hidden'; }
    }) : null,
    full ? h('img', {
      src: full, alt: '',
      onerror: e => {
        const im = e.target;
        if (!im.dataset.fb) { im.dataset.fb = '1'; im.src = 'https://sleepercdn.com/content/nfl/players/thumb/' + p.id + '.jpg'; }
        else im.style.visibility = 'hidden';
      }
    }) : null,
    h('div.pcxholo'),
    !isDef && p.team ? h('div.pcxteam', teamLogo(p.team)) : null);
  const face = h('div.pcxface',
    h('div.pcxtop', h('div.pcxname', p.name),
      p.rank ? h('div.pcxrank', '#' + p.rank) : null),
    art,
    h('div.pcxmeta', p.pos + (p.posRank ? p.posRank : '') + ' · ' + (p.team || 'Free agent') + (p.age ? ' · ' + fmt(p.age, 0) + ' yrs' : '')),
    h('div.pcxstats',
      cell('Value', kfmt(Math.round(p.dv || 0)), isDynasty() ? 'dynasty' : 'redraft'),
      cell('Pts / wk', fmt(p.ppg || 0, 1), 'projected'),
      h('div.pcxs.pcxdraft', h('div.pcxk', 'Draft'), h('div.pcxv', dl.top), dl.sub ? h('div.pcxsub', dl.sub) : null)),
    h('div.pcxglare'));
  const card = h('div.pcxcard.' + tier + (medalMode() === 'animated' ? '.anim' : '') + (opts.w && opts.w < 220 ? '.sm' : ''), { title: p.medal ? medalTitle(p) : null }, face);
  // the card leans toward the pointer; the glare and foil follow the same point
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = !!opts.w;   // small cards live in scrolling rows, where a finger means scroll, not tilt
  if (!still) {
    const move = e => {
      if (small && e.pointerType === 'touch') return;
      const r = card.getBoundingClientRect();
      const x = clamp((e.clientX - r.left) / r.width, 0, 1), y = clamp((e.clientY - r.top) / r.height, 0, 1);
      card.style.setProperty('--mx', (x * 100).toFixed(1) + '%'); card.style.setProperty('--my', (y * 100).toFixed(1) + '%');
      card.style.setProperty('--rx', ((0.5 - y) * 18).toFixed(2) + 'deg'); card.style.setProperty('--ry', ((x - 0.5) * 18).toFixed(2) + 'deg');
      card.style.setProperty('--hx', ((x - 0.5) * 100).toFixed(1) + '%'); card.style.setProperty('--hy', ((y - 0.5) * 100).toFixed(1) + '%');
    };
    card.addEventListener('pointerenter', e => { if (small && e.pointerType === 'touch') return; card.classList.add('pcxon'); });
    card.addEventListener('pointermove', move);
    card.addEventListener('pointerleave', () => {
      card.classList.remove('pcxon');
      ['--mx', '--my', '--rx', '--ry', '--hx', '--hy'].forEach(k => card.style.removeProperty(k));
    });
  }
  if (!opts.w) return card;
  // a smaller card is the full card scaled down, so its layout never has to be redesigned
  const k = opts.w / 300;
  const fit = h('div.pcxfit' + (opts.back ? '.pcxlink' : ''), { style: { width: opts.w + 'px', height: Math.round(420 * k) + 'px' } }, h('div.pcxscale', card));
  fit.style.setProperty('--k', k.toFixed(4));
  if (opts.back) {
    fit.tabIndex = 0; fit.setAttribute('role', 'button'); fit.setAttribute('aria-label', p.name);
    fit.addEventListener('click', () => openPlayer(p.id, opts.back));
    fit.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlayer(p.id, opts.back); } });
  }
  return fit;
}
/* ---- hover preview: rest on any player's name and his card floats up beside it ---- */
const PCXPOP = { el: null, timer: null };
function hoverCardsOn() {
  return isSimple() && LS.get('hovercards', true) !== false && typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches;
}
function hideCardPop() {
  clearTimeout(PCXPOP.timer);
  if (PCXPOP.el) { PCXPOP.el.remove(); PCXPOP.el = null; }
}
function attachCardPop(el, p) {
  if (!el || !p || !p.id || p.pos === 'PICK') return el;
  const show = () => {
    const full = (S.index && S.index[p.id]) || p;
    if (!full || !full.pos || full.pos === 'PICK' || !el.isConnected) return;
    hideCardPop();
    const pop = h('div.pcxpop', tradingCard(full, { w: 210 }));
    document.body.appendChild(pop); PCXPOP.el = pop;
    const r = el.getBoundingClientRect(), w = pop.offsetWidth, ph = pop.offsetHeight;
    let x = r.right + 14; if (x + w > innerWidth - 8) x = Math.max(8, r.left - w - 14);
    const y = clamp(r.top + r.height / 2 - ph / 2, 8, Math.max(8, innerHeight - ph - 8));
    pop.style.left = x + 'px'; pop.style.top = y + 'px';
    requestAnimationFrame(() => pop.classList.add('in'));
  };
  const arm = () => { if (!hoverCardsOn()) return; clearTimeout(PCXPOP.timer); PCXPOP.timer = setTimeout(show, 260); };
  el.addEventListener('mouseenter', arm);
  el.addEventListener('focus', arm);
  el.addEventListener('mouseleave', hideCardPop);
  el.addEventListener('blur', hideCardPop);
  el.addEventListener('mousedown', hideCardPop);
  return el;
}
if (typeof window !== 'undefined') {
  window.addEventListener('scroll', hideCardPop, true);
  window.addEventListener('keydown', e => { if (e.key === 'Escape') hideCardPop(); });
}

/** A small card for a deal: a player's headshot in his tier frame, or a plain card for a pick or waiver budget. */
function assetMiniCard(a, o) {
  o = o || {};
  const p = a.kind === 'player' ? a.ref : null;
  const tier = p ? (medalOf(p) || 'none') : 'none';
  const short = (nm) => { const w = String(nm || '').trim().split(/\s+/); return w.length > 1 ? w[0][0] + '. ' + w.slice(1).join(' ') : nm; };
  const art = h('div.pxmart');
  if (p && p.pos === 'DEF') art.appendChild(h('img.pxmdef', {
    src: 'https://sleepercdn.com/images/team_logos/nfl/' + String(p.team || p.id).toLowerCase() + '.png', alt: '', loading: 'lazy',
    onerror: e => { e.target.style.visibility = 'hidden'; }
  }));
  else if (p && /^\d+$/.test(String(p.id))) art.appendChild(h('img', {
    src: 'https://sleepercdn.com/content/nfl/players/thumb/' + p.id + '.jpg', alt: '', loading: 'lazy',
    onerror: e => { e.target.style.visibility = 'hidden'; }
  }));
  else art.appendChild(h('div.pxmpick', ico('draft')));
  art.appendChild(h('span.pxmpos', a.kind === 'faab' ? 'FAAB' : (a.pos === 'PICK' ? 'PICK' : a.pos)));
  art.appendChild(h('span.pxmval', o.value !== undefined ? o.value : kfmt(Math.round(a.dv || 0))));
  const el = h('div.pxm.' + tier + (medalMode() === 'animated' ? '.anim' : '') + (o.back && p ? '.pcxlink' : ''),
    { title: a.name },
    h('div.pxmface', art, h('div.pxmname', p ? short(a.name) : a.name),
      h('div.pxmsub', p ? [p.team || 'FA', p.age ? fmt(p.age, 0) + ' yrs' : null].filter(Boolean).join(' · ') : (a.kind === 'faab' ? 'Waiver budget' : 'Draft pick'))),
    o.onRemove ? h('button.pxmx', { title: 'Remove', 'aria-label': 'Remove ' + a.name, onclick: e => { e.stopPropagation(); hideCardPop(); o.onRemove(); } }, ico('close')) : null);
  if (p) {
    attachCardPop(el, p);
    if (o.back) {
      el.tabIndex = 0; el.setAttribute('role', 'button');
      el.addEventListener('click', () => openPlayer(p.id, o.back));
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlayer(p.id, o.back); } });
    }
  }
  return o.extra ? h('div.pxmwrap', el, o.extra) : el;
}
/** One side of a deal: cards in the Default view, the compact rows otherwise. */
function dealItem(a, o) { return isSimple() ? assetMiniCard(a, o) : assetCard(a, Object.assign({ compact: !!o.compact }, o)); }
function tradingCardStage(p, owner) {
  const bits = [p.college || null, p.exp !== null && p.exp !== undefined ? (p.exp === 0 ? 'rookie' : p.exp + ' yrs exp') : null].filter(Boolean).join(' · ');
  return h('div.pcxstage',
    tradingCard(p),
    h('div.pcxcap',
      h('div.row', { style: { gap: '8px', justifyContent: 'center', flexWrap: 'wrap' } }, p.injury ? injuryTag(p.injury, p) : null, bits ? h('span.tiny.sec', bits) : null),
      h('div.tiny.muted', { style: { marginTop: '3px' } },
        owner ? `Rostered by ${owner.name}` + (owner.taxi.has(p.id) ? ' — taxi squad' : owner.ir.has(p.id) ? ' — injured reserve' : owner.starterIds.has(p.id) ? ' — projected starter' : ' — bench') : 'Not on any roster in this league')));
}
function viewPlayer() {
  const wrap = h('div.grid');
  const p = S.index[PlayerUI.id];
  if (!p) return wrap.appendChild(card('Player', null, h('div.empty', 'That player is no longer in the index.'))), wrap;
  const owner = ownerOfPlayer(p.id);
  const log = playerGameLog(p.id, { stats: true });
  // weeks he sat on no roster have no matchup score; fetch his raw stats for them and redraw when they arrive
  const blank = log.filter(g => !g.rostered && !g.fromStats && g.state === 'final').map(g => g.week).filter(w => !WSTATS.state[w]);
  if (blank.length && S.lastWeek) {
    const pid = p.id;
    Promise.all(blank.map(loadWeekStats)).then(() => { if (S.view === 'player' && PlayerUI.id === pid) render(); });
  }
  // a game still being played is real but not a result, so it stays out of the
  // season averages until it is over
  const played = log.filter(g => g.pts !== null && (g.rostered || g.fromStats) && g.state === 'final');
  const startedGames = played.filter(g => g.started);
  const posPeers = Object.values(S.index).filter(x => x.pos === p.pos && (x.dv || 0) > 0).sort((a, b) => b.dv - a.dv);
  const myIdx = posPeers.findIndex(x => x.id === p.id);
  const backLabel = (VIEWS.find(v => v.k === PlayerUI.back) || {}).label || 'Back';

  wrap.appendChild(h('div.row', { style: { justifyContent: 'space-between' } },
    h('button.btn', { onclick: () => { S.view = PlayerUI.back || 'roster'; render(); } }, '← ' + backLabel),
    h('div.row', { style: { gap: '7px' } },
      owner ? h('button.btn.sm', { onclick: () => { RosterUI.team = owner.rosterId; S.view = 'roster'; render(); } }, 'View ' + owner.name) : null,
      h('button.btn.sm', { onclick: () => { StockUI.kind = 'player'; StockUI.id = p.id; S.view = 'stock'; render(); } }, 'Open in Stock Mode'))));

  // ---- header ----
  const headshot = /^\d+$/.test(p.id) ? 'https://sleepercdn.com/content/nfl/players/thumb/' + p.id + '.jpg' : null;
  const hdr = card(null, null, h('div.row', { style: { gap: '15px', alignItems: 'center' } },
    headshot ? h('img', {
      src: headshot, alt: '', loading: 'lazy',
      style: { width: '66px', height: '66px', borderRadius: '12px', objectFit: 'cover', background: 'var(--surface-3)', flex: 'none' },
      onerror: e => e.target.style.visibility = 'hidden'
    }) : h('div', { style: { width: '66px', height: '66px', borderRadius: '12px', background: 'var(--surface-3)', flex: 'none' } }),
    h('div', { style: { minWidth: 0 } },
      h('div.row', { style: { gap: '8px' } }, posPill(p.pos),
        h('h2', { style: { fontSize: '22px', letterSpacing: '-.02em' } }, p.name),
        injuryTag(p.injury, p)),
      h('div.tiny.sec', { style: { marginTop: '2px' } },
        [p.team || 'Free agent', p.age ? fmt(p.age, 1) + ' years old' : null,
        p.exp !== null && p.exp !== undefined ? (p.exp === 0 ? 'rookie' : p.exp + ' yrs exp') : null,
        p.college || null,
        p.draft ? `${p.draft.year} round ${p.draft.round}, pick ${p.draft.pick}` : null].filter(Boolean).join(' · ')),
      h('div.tiny.muted', { style: { marginTop: '3px' } },
        owner ? `Rostered by ${owner.name}` + (owner.taxi.has(p.id) ? ' — taxi squad' : owner.ir.has(p.id) ? ' — injured reserve' : owner.starterIds.has(p.id) ? ' — projected starter' : ' — bench') : 'Not on any roster in this league'))));
  const heroSlot = isSimple() ? h('div.pcxhero', tradingCardStage(p, owner)) : null;
  wrap.appendChild(heroSlot || hdr);

  // ---- what the market is saying about him ----
  const sgp = signalMap()[p.id], tlp = timelineMap()[p.id];
  if (sgp || tlp) {
    const line = (tag, text) => h('div.row', { style: { gap: '10px', alignItems: 'flex-start', flexWrap: 'nowrap' } },
      h('span.sigtag.' + tag.k, { style: { marginTop: '2px' } }, tag.label), h('div.sec', { style: { fontSize: '13px', lineHeight: '1.45' } }, text));
    wrap.appendChild(card('Market read', 'where his price and his production disagree, and which way his value leans',
      h('div', { style: { display: 'grid', gap: '9px' } },
        sgp ? line({ k: sgp.kind, label: sgp.kind === 'buy' ? 'Buy low' : 'Sell high' },
          sgp.reasons.join('. ') + '.' + (sgp.games ? ` (${sgp.games} game${sgp.games > 1 ? 's' : ''} played)` : '')) : null,
        tlp ? line({ k: tlp.kind, label: TL_LABEL[tlp.kind] }, timelineWhy(tlp)) : null)));
  }

  // ---- headline numbers ----
  const trendPct = p.trend30 && (p.dv - p.trend30) > 0 ? p.trend30 / (p.dv - p.trend30) : 0;
  const kpis = h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(min(146px,100%),1fr))' } },
    kpi(isDynasty() ? 'Dynasty value' : 'Redraft value', kfmt(Math.round(p.dv || 0)), p.rank ? 'overall #' + p.rank : 'unranked',
      `<div class="k">FantasyCalc ${valueWord()} value</div>Priced for this league's exact format — ${S.cfg.superflex ? 'superflex' : '1QB'}, ${S.cfg.numTeams}-team, ${S.cfg.ppr === 1 ? 'PPR' : S.cfg.ppr === 0.5 ? 'half-PPR' : 'standard'}.`),
    kpi('Position rank', (p.pos || '') + (p.posRank || (myIdx >= 0 ? myIdx + 1 : '—')), p.tier ? 'tier ' + p.tier : 'of ' + posPeers.length + ' ranked'),
    kpi('30-day trend', p.trend30 ? sgn(p.trend30, 0) : 'flat', p.trend30 ? sgn(trendPct * 100, 1) + '%' : 'no movement'),
    kpi('Projected', fmt(p.ppg || 0, 1), p.wk ? 'pts / week remaining' : 'pts / week now',
      p.wk
        ? `<div class="k">Sleeper weekly projections</div>Average over the weeks still to play, byes excluded. Each week's projected stat line is scored with this league's own settings, so custom scoring is respected.` + (p.inj && INJ.enabled() ? '<br>Weeks he is expected to miss count as zero, so this is lower than his healthy rate.' : '')
        : `<div class="k">Estimated</div>Sleeper publishes no weekly projection for this player, so this comes from the redraft value's positional rank adjusted for league scoring.` + (p.injury ? '<br>Discounted for the <b>' + p.injury + '</b> tag' + (p.inj && INJ.enabled() && p.inj.kind === 'long' ? ' — zero until ' + (p.inj.season ? 'next season' : p.inj.label.toLowerCase()) + '.' : '.') : '')),
    dynOnly(kpi('Projected 2–3 yrs', fmt(p.fppg || 0, 1), 'pts / week',
      `<div class="k">Future outlook</div>Dynasty-value rank run through the same curve, then aged with a ${p.pos}-specific decline profile.`)),
    // in a redraft league the dynasty price is the interesting comparison, not
    // the other way round: it says how much of his market is the years ahead
    isDynasty()
      ? kpi('Redraft value', kfmt(Math.round(p.rv || 0)), p.rv && p.dvDyn ? (p.rv > p.dvDyn ? 'win-now premium' : 'dynasty premium') : '—',
        '<div class="k">Redraft vs dynasty</div>A player worth more in redraft than dynasty is being paid for production now; the reverse means the market is paying for the years ahead.')
      : kpi('Dynasty market', kfmt(Math.round(p.dvDyn || 0)), p.rv && p.dvDyn ? (p.dvDyn > p.rv ? 'priced for the future' : 'priced for now') : '—',
        '<div class="k">What he is worth elsewhere</div>This league does not pay for it, but the dynasty market does. A player worth far more in dynasty than redraft is young, and in this league that premium buys you nothing.')
  );
  // Default view: the headline numbers sit beside the card instead of under it
  (heroSlot || wrap).appendChild(kpis);

  const injCard = injuryCard(p);
  if (injCard) wrap.appendChild(injCard);

  // ---- weekly production ----
  const bars = [];
  log.forEach(g => {
    const vsProj = g.proj !== undefined && g.pts !== null ? ` · projected ${fmt(g.proj, 1)}` : '';
    bars.push({
      x: g.week, v: g.rostered || g.fromStats ? g.pts : null, kind: g.state === 'live' ? 'live' : 'actual',
      note: g.fromStats ? 'On no roster in this league — scored from his raw stats with this league’s settings'
        : !g.rostered ? (WSTATS.state[g.week] === 'fail' ? 'Not rostered in this league, and his stats could not be loaded' : blank.includes(g.week) ? 'Not rostered in this league — loading his stats…' : 'Not rostered in this league — no stats listed for him this week')
        : g.state === 'live' ? `In progress${g.quarter ? ' (' + g.quarter + ')' : ''} — ${fmt(g.pts || 0, 1)} so far${vsProj}`
          : (g.started ? 'Started' : 'On the bench') + (g.week === S.liveWeek ? ' · final' + vsProj : '')
    });
  });
  const logged = new Set(log.map(g => g.week));
  for (let w = S.lastWeek + 1; w <= S.regEnd; w++) {
    if (logged.has(w)) continue;
    if (p.wk) {
      const r = p.wk[w];
      // No line for a week is two different things. If his team is off, it is a
      // bye. If his team is playing, nobody expects him on the field — which is
      // nothing projected, not a bye, and the chart has to say so.
      if (r) {
        const a = availability(p, w);
        if (p.inj && a < 0.05) bars.push({ x: w, v: 0, kind: 'proj', mark: 'OUT', note: 'Projected ' + (r.h ? 'vs ' : 'at ') + (r.o || '—') + ' if healthy — ' + injuryWhy(p, w) });
        else bars.push({ x: w, v: Math.round(r.p * a * 10) / 10, kind: 'proj', note: 'Projected ' + (r.h ? 'vs ' : 'at ') + (r.o || '—') + (a < 0.995 ? ' · ' + Math.round(a * 100) + '% likely to play (' + injuryWhy(p, w) + ')' : '') });
      }
      else if (onBye(p, w)) bars.push({ x: w, v: null, kind: 'proj', bye: true, note: 'Bye week' });
      else bars.push({
        x: w, v: 0, kind: 'proj', mark: 'OUT',
        note: 'Nothing projected — not expected to play' + (p.injury ? ' (' + p.injury + ')' : '')
      });
    } else {
      const a = availability(p, w);
      bars.push({
        x: w, v: Math.round(pw(p, w) * 10) / 10, kind: 'proj', mark: p.inj && a < 0.05 ? 'OUT' : undefined,
        note: 'Projection, not a result' + (p.inj && a < 0.995 ? ' · ' + (a < 0.05 ? 'not expected to play' : Math.round(a * 100) + '% likely to play') + ' (' + injuryWhy(p, w) + ')' : '')
      });
    }
  }
  const logTable = table([
    { k: 'week', h: 'Week', num: true, f: r => r.x },
    {
      k: 'kind', h: 'Type', f: r => r.kind === 'proj' ? h('span.tag', 'projected')
        : r.kind === 'live' ? h('span.tag', { style: { borderColor: 'var(--s4)', color: 'var(--s4)' } }, 'in progress')
          : h('span.tag', { style: { borderColor: 'var(--s1)', color: 'var(--s1)' } }, 'actual')
    },
    { k: 'v', h: 'Points', num: true, f: r => r.v === null ? '—' : h('b.mono', fmt(r.v, 1)) },
    { k: 'note', h: 'Note', f: r => h('span.tiny.muted', r.note || '') }
  ], bars, {});
  const byeList = (p.byeWeeks || []).filter(w => w <= S.regEnd);
  const wt = withTable(h('div', weeklyBars(bars, { aria: 'weekly points, actual then projected' }),
    h('div.legend', { style: { marginTop: '9px' } },
      h('span', h('i', { style: { background: 'var(--s1)' } }), 'Actual'),
      bars.some(b => b.kind === 'live') ? h('span', h('i', { style: { background: 'var(--s4)' } }), 'In progress') : null,
      h('span', h('i', { style: { background: 'var(--seq-200)' } }), 'Projected'),
      played.length ? h('span.tiny.muted', `${fmt(mean(played.map(g => g.pts)), 1)} avg · ${fmt(Math.max(...played.map(g => g.pts)), 1)} best`
        + (startedGames.length ? ` · started ${startedGames.length} of ${played.length}` : '')) : h('span.tiny.muted', 'No games played yet this season'))), logTable);
  wrap.appendChild(card('Weekly scoring',
    (S.lastWeek ? `weeks 1–${S.lastWeek} actual, the rest projected` : 'all projected — the season has not started')
    + (p.wk ? ' · Sleeper weekly projections, scored with this league’s settings' : ' · no weekly projection published, so this is a flat estimate')
    + (byeList.length ? ' · bye week ' + byeList.join(', ') : ''),
    wt.body, wt.btn));

  // ---- value history ----
  const series = playerSeries(p.id, PlayerUI.range);
  if (series.length > 1) {
    const first = series[0].v, last = series[series.length - 1].v;
    wrap.appendChild(card('Value over time', `${series.filter(s => s.real).length} observed snapshot${series.filter(s => s.real).length === 1 ? '' : 's'} · earlier points modelled from the published 30-day trend`,
      h('div', lineChart([{
        name: p.name, color: last >= first ? 'var(--s1)' : 'var(--s8)', area: true,
        points: series.map((s, i) => ({ x: i, y: s.v, label: new Date(s.d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }))
      }], {
        h: 220, dots: false, yFmt: v => kfmt(Math.round(v)),
        xFmt: i => { const s = series[clamp(Math.round(i), 0, series.length - 1)]; return s ? new Date(s.d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''; },
        aria: 'value over time'
      })),
      segmented([{ k: 30, label: '30d' }, { k: 90, label: '90d' }, { k: 180, label: '6m' }], PlayerUI.range, r => { PlayerUI.range = r; render(); })));
  }

  // ---- comparables ----
  const lo = Math.max(0, myIdx - 4), peers = posPeers.slice(lo, lo + 9);
  wrap.appendChild(card('Around him at ' + p.pos, 'nearest players by ' + valueWord() + ' value — click any name',
    table([
      { k: 'rk', h: '#', num: true, sortable: false, f: (r) => posPeers.indexOf(r) + 1 },
      { k: 'name', h: 'Player', sort: r => r.name, f: r => h('div.row', { style: { gap: '6px' } }, pname(r, { style: r.id === p.id ? { fontWeight: '700' } : null }), r.id === p.id ? h('span.tag', 'this player') : null) },
      { k: 'team', prio: 2, h: 'NFL', f: r => r.team || '—' },
      { k: 'age', h: 'Age', num: true, f: r => r.age ? fmt(r.age, 1) : '—' },
      { k: 'dv', h: 'Value', num: true, f: r => h('b.mono', kfmt(Math.round(r.dv || 0))) },
      { k: 'ppg', h: 'Proj', num: true, f: r => fmt(r.ppg || 0, 1) },
      isDynasty() ? { k: 'fppg', prio: 2, h: 'Proj ’28', num: true, f: r => fmt(r.fppg || 0, 1) } : null,
      { k: 'trend30', prio: 2, h: '30d', num: true, f: r => r.trend30 ? deltaTag(r.trend30, 0) : h('span.flat.tiny', '–') },
      { k: 'own', prio: 2, h: 'Roster', sortable: false, f: r => { const o = ownerOfPlayer(r.id); return o ? h('span.tiny', o.short) : h('span.tiny.muted', 'FA'); } }
    ], peers, { onRow: r => openPlayer(r.id) })));
  return wrap;
}

