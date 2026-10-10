"use strict";
/* ================= app shell ================= */
/* Line icons, one 24×24 grid, drawn as strokes so they take the colour of
   whatever they sit in. Inline rather than fetched: the app is one file. */
const ICON = {
  home: '<path d="M3.5 11.2 12 4l8.5 7.2"/><path d="M5.5 9.8V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.8"/><path d="M10 20v-5.5h4V20"/>',
  week: '<path d="M3 12h4l2.6-7 4.8 14 2.6-7H21"/>',
  roster: '<circle cx="9" cy="8" r="3.4"/><path d="M2.8 19.5c.4-3.3 2.9-5.2 6.2-5.2s5.8 1.9 6.2 5.2"/><circle cx="17.3" cy="9" r="2.5"/><path d="M17.6 14.3c2.2.2 3.8 1.7 4.1 4.2"/>',
  players: '<path d="m12 3.4 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17.1l-5.4 3 1.1-6.1L3.2 9.8l6.1-.8z"/>',
  lineup: '<path d="M8 4.5v15M8 4.5 4.7 7.8M8 4.5l3.3 3.3"/><path d="M16 19.5v-15M16 19.5l-3.3-3.3M16 19.5l3.3-3.3"/>',
  trade: '<path d="M12 4v16M7 20h10M5.5 7.5h13"/><path d="m5.5 7.5-2.8 6.2a3.2 3.2 0 0 0 5.6 0z"/><path d="m18.5 7.5-2.8 6.2a3.2 3.2 0 0 0 5.6 0z"/>',
  finder: '<circle cx="11" cy="11" r="6.6"/><path d="m20.3 20.3-4.6-4.6"/><path d="M8.6 11h4.8M11 8.6v4.8"/>',
  trades: '<path d="M4 12a8 8 0 1 0 2.6-5.9L4 8.6"/><path d="M4 4v4.6h4.6"/><path d="M12 8v4.4l3 1.8"/>',
  h2h: '<rect x="3.2" y="4.5" width="7.6" height="15" rx="2.2"/><rect x="13.2" y="4.5" width="7.6" height="15" rx="2.2"/><path d="M6 9h2M16 9h2M6 13h2M16 13h2"/>',
  power: '<path d="M7.5 4h9v5.2a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6H4.4a3 3 0 0 0 3.3 4.4M16.5 6h3.1a3 3 0 0 1-3.3 4.4"/><path d="M12 13.8V18M8.5 20.2h7"/>',
  standings: '<path d="M5.5 20V11M12 20V4.5M18.5 20v-6.5"/>',
  scout: '<circle cx="12" cy="12" r="7.6"/><circle cx="12" cy="12" r="2.6"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  sim: '<rect x="3.8" y="3.8" width="16.4" height="16.4" rx="4.4"/><circle cx="8.8" cy="8.8" r="1.1" fill="currentColor"/><circle cx="15.2" cy="8.8" r="1.1" fill="currentColor"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/><circle cx="8.8" cy="15.2" r="1.1" fill="currentColor"/><circle cx="15.2" cy="15.2" r="1.1" fill="currentColor"/>',
  draft: '<rect x="3.6" y="3.6" width="7.2" height="7.2" rx="1.8"/><rect x="13.2" y="3.6" width="7.2" height="7.2" rx="1.8"/><rect x="3.6" y="13.2" width="7.2" height="7.2" rx="1.8"/><rect x="13.2" y="13.2" width="7.2" height="7.2" rx="1.8"/>',
  stock: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  chevup: '<path d="m6 15 6-6 6 6"/>',
  flask: '<path d="M9.2 3.5h5.6M10 3.5v5.7L4.7 18.3A1.6 1.6 0 0 0 6.1 20.7h11.8a1.6 1.6 0 0 0 1.4-2.4L14 9.2V3.5"/><path d="M7.6 14.5h8.8"/>',
  sliders: '<path d="M4 7h8.5M17 7h3M4 17h3M11.5 17H20"/><circle cx="14.8" cy="7" r="2.2"/><circle cx="9.2" cy="17" r="2.2"/>',
  refresh: '<path d="M20 11.5A8 8 0 0 0 5.6 7.2L4 9"/><path d="M4 4.5V9h4.5"/><path d="M4 12.5a8 8 0 0 0 14.4 4.3L20 15"/><path d="M20 19.5V15h-4.5"/>',
  swap: '<path d="M4 8h14l-3.4-3.4M20 16H6l3.4 3.4"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  share: '<path d="M12 15V4M8 7.5 12 3.5l4 4"/><path d="M5 12v6.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V12"/>'
};
function ico(name) {
  return h('span.ic', { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON[name] || '') + '</svg>' });
}
/* the football from the favicon, for the brand mark */
const MARK_SVG = '<svg viewBox="0 0 64 64" aria-hidden="true"><g transform="rotate(-32 32 32)"><ellipse cx="32" cy="32" rx="19" ry="12" fill="#fff"/><path d="M14 32h36" style="stroke:var(--brand)" stroke-width="1.6" opacity=".5"/><path d="M24 32h16" style="stroke:var(--brand)" stroke-width="2.6" stroke-linecap="round"/><path d="M27 28.4v7.2M31 28.4v7.2M35 28.4v7.2" style="stroke:var(--brand)" stroke-width="2.3" stroke-linecap="round"/></g></svg>';

const VIEWS = [
  { k: 'home', ic: 'home', label: 'Home', grp: 'Overview' },
  { k: 'week', ic: 'week', label: 'This Week', grp: 'Overview' },
  { k: 'roster', ic: 'roster', label: 'Rosters', grp: 'Teams' },
  { k: 'players', ic: 'players', label: 'Players', grp: 'Teams' },
  { k: 'lineup', ic: 'lineup', label: 'Start / Sit', grp: 'Teams' },
  { k: 'trade', ic: 'trade', label: 'Trade Calculator', grp: 'Trading' },
  { k: 'finder', ic: 'finder', label: 'Trade Finder', grp: 'Trading' },
  { k: 'trades', ic: 'trades', label: 'Trade History', grp: 'Trading' },
  { k: 'h2h', ic: 'h2h', label: 'Head to Head', grp: 'League' },
  { k: 'power', ic: 'power', label: 'Power Rankings', grp: 'League' },
  { k: 'standings', ic: 'standings', label: 'Active Rankings', grp: 'League' },
  { k: 'scout', ic: 'scout', label: 'GM Scout', grp: 'League' },
  { k: 'sim', ic: 'sim', label: 'Simulator', grp: 'Tools' },
  { k: 'draft', ic: 'draft', label: 'Draft Board', grp: 'Tools' },
  { k: 'stock', ic: 'stock', label: 'Stock Mode', grp: 'Tools' }
];
/* The tabs simple mode leads with. The rest are still there, one tap behind
   "More" — hiding them outright would be a different app, not a calmer one. */
const CORE_VIEWS = ['home', 'week', 'roster', 'players', 'lineup', 'trade', 'finder', 'power', 'sim'];
let navExpanded = false;
function setTheme(t) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  LS.set('theme', t);
  updateThemeColor();
}
/** oklch → #rrggbb, for the browser's own chrome, which cannot be handed an oklch() colour. */
function oklchToHex(L, C, hDeg) {
  const h = hDeg * Math.PI / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b, m_ = L - 0.1055613458 * a - 0.0638541728 * b, s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  return '#' + lin.map(v => { v = Math.min(1, Math.max(0, v)); v = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; return Math.round(v * 255).toString(16).padStart(2, '0'); }).join('');
}
/** Keep the browser's address-bar / status-bar colour the same as the page behind it. */
function updateThemeColor() {
  if (typeof document === 'undefined') return;
  try {
    const t = LS.get('theme', 'system');
    const dark = t === 'dark' || (t !== 'light' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
    let color = '#f2f3f8';                                    // the light page background never changes
    if (dark) {
      const cs = getComputedStyle(document.documentElement);
      const hue = parseFloat(cs.getPropertyValue('--hue')), sat = parseFloat(cs.getPropertyValue('--cs'));
      color = isFinite(hue) && isFinite(sat) && typeof CSS !== 'undefined' && CSS.supports && CSS.supports('color', 'oklch(50% .1 200)')
        ? oklchToHex(0.145, 0.014 * sat, hue) : '#0a0d17';   // same numbers as --plane in the stylesheet
    }
    let m = document.querySelector('meta[name="theme-color"]:not([media])');
    if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.insertBefore(m, document.head.firstChild); }
    m.content = color;
  } catch (e) { /* the media-matched fallbacks stay */ }
}
if (typeof matchMedia === 'function') { try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => updateThemeColor()); } catch (e) { } }
function currentTheme() { return LS.get('theme', 'system'); }
/* Accent colour: one hue drives every brand token (see "accent themes" in the
   stylesheet). The hexes are only the swatches' faces. */
const ACCENTS = [
  { k: 'indigo', label: 'Indigo', a: '#4f6bf2', b: '#8a5cf6' },
  { k: 'blue', label: 'Ocean', a: '#2b6ae8', b: '#3d9be9' },
  { k: 'teal', label: 'Lagoon', a: '#0a8fb0', b: '#1fb6a6' },
  { k: 'green', label: 'Emerald', a: '#0f9d63', b: '#37b86a' },
  { k: 'orange', label: 'Sunset', a: '#d9560a', b: '#ef8a1e' },
  { k: 'rose', label: 'Rose', a: '#d81f4d', b: '#e5498f' },
  { k: 'graphite', label: 'Graphite', a: '#3b4254', b: '#6a7186' }
];
function currentAccent() { const a = LS.get('accent', 'indigo'); return ACCENTS.some(x => x.k === a) ? a : 'indigo'; }
function setAccent(k) {
  if (!ACCENTS.some(x => x.k === k)) k = 'indigo';
  if (k === 'indigo') document.documentElement.removeAttribute('data-accent');
  else document.documentElement.setAttribute('data-accent', k);
  LS.set('accent', k);
  updateThemeColor();
}

/* One menu for everything that changes how the app looks rather than what it
   says. It survives a render so a click inside it does not close it, and one
   document-level listener closes it on the next click elsewhere. */
let settingsOpen = false;
let _settingsBound = false;
function settingsMenu() {
  if (!_settingsBound && typeof document !== 'undefined') {
    _settingsBound = true;
    document.addEventListener('click', (e) => {
      if (!settingsOpen) return;
      if (e.target.closest && e.target.closest('.menuwrap')) return;
      settingsOpen = false; render();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (settingsOpen || moreOpen)) { settingsOpen = false; moreOpen = false; render(); } });
  }
  const group = (label, control, note) => h('div',
    h('div.mlbl', label), control, note ? h('div.mnote', note) : null);
  const panel = h('div.menupanel',
    group('View',
      segmented([{ k: 'simple', label: 'Default' }, { k: 'full', label: 'Minimal' }], S.ui,
        m => { setUiMode(m); navExpanded = false; render(); }),
      S.ui === 'simple'
        ? 'Cards, photos and the numbers that matter.'
        : 'Stripped back and dense — every table, column and chart, no imagery.'),
    group('Theme',
      segmented([{ k: 'system', label: 'Auto' }, { k: 'light', label: 'Light' }, { k: 'dark', label: 'Dark' }],
        currentTheme(), t => { setTheme(t); render(); })),
    group('Name teams by',
      segmented([{ k: 'user', label: 'Username' }, { k: 'team', label: 'Team name' }], S.names,
        m => { setNameMode(m); render(); }),
      useUsernames()
        ? 'Sleeper handles, everywhere. Team names show underneath.'
        : 'Team names, everywhere. Usernames show underneath.'),
    group('Accent colour',
      h('div.swatches', { role: 'radiogroup', 'aria-label': 'Accent colour' }, ACCENTS.map(a =>
        h('button.swatch' + (currentAccent() === a.k ? '.on' : ''), {
          title: a.label, 'aria-label': a.label, role: 'radio', 'aria-checked': currentAccent() === a.k ? 'true' : 'false',
          style: { background: `linear-gradient(135deg,${a.a},${a.b})` },
          onclick: () => { setAccent(a.k); render(); }
        }))),
      (ACCENTS.find(a => a.k === currentAccent()) || ACCENTS[0]).label + ' — the colour of buttons, links, the sidebar and the home banner.'),
    S.league ? group('League type',
      segmented([{ k: 'auto', label: 'Auto' }, { k: 'dynasty', label: 'Dynasty' }, { k: 'redraft', label: 'Redraft' }],
        leagueTypeChoice(), m => { setLeagueType(m); render(); }),
      (leagueTypeChoice() === 'auto' ? 'Sleeper says ' + S.detected + '. ' : 'Overriding Sleeper, which says ' + S.detected + '. ')
      + (isDynasty()
        ? 'Players are priced at dynasty value; future projections, ageing and pick capital are all in play.'
        : 'Players are priced at redraft value. No future projections, no ageing, no pick capital — nothing carries to next year.')) : null,
    S.ui === 'simple' ? group('Player tiers',
      segmented([{ k: 'animated', label: 'Animated' }, { k: 'static', label: 'Static' }, { k: 'off', label: 'Off' }], medalMode(),
        m => { setMedalMode(m); render(); }),
      MEDALS.map((m, i) => m.label + ' ' + (i ? MEDALS[i - 1].upTo + 1 : 1) + '–' + m.upTo).join(' · ')
      + ' overall by value. Anyone lower has no tier. Animation stops if your device asks for reduced motion.') : null,
    S.ui === 'simple' ? group('Hover cards',
      segmented([{ k: true, label: 'On' }, { k: false, label: 'Off' }], LS.get('hovercards', true) !== false,
        v => { LS.set('hovercards', v); hideCardPop(); render(); }),
      'Rest on a player’s name and his card floats up beside it. Mouse only.') : null,
    S.league ? group('Injury return dates',
      segmented([{ k: true, label: 'On' }, { k: false, label: 'Off' }], INJ.enabled(), v => { setInjuryEstimates(v); render(); }),
      injFeedLine()) : null,
    h('hr'),
    h('button.btn', { onclick: () => { settingsOpen = false; hardRefresh(); } }, ico('refresh'), 'Refresh data'),
    h('button.btn', {
      onclick: () => { settingsOpen = false; S.league = null; S._sched = null; hypExit(); render(); }
    }, ico('swap'), 'Change league'));
  return h('div.menuwrap',
    h('button.btn' + (settingsOpen ? '.pri' : ''), {
      title: 'Settings', 'aria-label': 'Settings', 'aria-expanded': settingsOpen ? 'true' : 'false',
      onclick: () => { settingsOpen = !settingsOpen; shareOpen = false; render(); }
    }, ico('sliders'), h('span.bl', 'Settings')),
    settingsOpen ? panel : null);
}

let moreOpen = false;
let _lastView = null;
const NAV_ORDER = ['Overview', 'Teams', 'Trading', 'League', 'Tools'];
/* the four places most visits start from, plus "More" — what the phone tab bar shows */
const TAB_VIEWS = ['home', 'week', 'roster', 'players'];
function go(view) { S.view = view; moreOpen = false; render(); window.scrollTo(0, 0); }

function render() {
  hideCardPop();
  // Redrawing the page you are already on (opening a row, a filter, "show more") should leave you where you were: on a phone
  // the browser drops the scroll to the top the moment the page is emptied. A change of page, or a deliberate scrollTo(0, 0) after the
  // render, still goes to the top.
  const keepY = _lastView === S.view ? (window.scrollY || 0) : 0;
  const app = $('#app');
  clear(app);
  if (!S.league) return app.appendChild(splash());
  const simple = isSimple();
  const shown = !simple || navExpanded ? VIEWS : VIEWS.filter(v => CORE_VIEWS.includes(v.k) || v.k === S.view);
  const hiddenCount = VIEWS.length - shown.length;
  let lastGrp = null;
  const navItems = [];
  shown.forEach(v => {
    if (v.grp !== lastGrp) { lastGrp = v.grp; navItems.push(h('div.navgroup', v.grp)); }
    navItems.push(h('button.navbtn' + (S.view === v.k ? '.on' : ''), { onclick: () => go(v.k) }, ico(v.ic), v.label));
  });
  const side = h('div.side',
    h('div.brand', h('div.mark', { html: MARK_SVG }), h('div', h('b', S.league && !isDynasty() ? 'Redraft' : 'Dynasty'), h('small', 'Command Center'))),
    navItems,
    simple && (hiddenCount > 0 || navExpanded)
      ? h('button.navbtn', { style: { marginTop: '6px' }, onclick: () => { navExpanded = !navExpanded; render(); } },
        ico(navExpanded ? 'chevup' : 'chev'), navExpanded ? 'Show fewer' : 'More pages (' + hiddenCount + ')')
      : null,
    h('div.spacer'),
    h('div.foot',
      h('div', 'Values: FantasyCalc'), h('div', 'League: Sleeper'),
      h('div', 'Updated ' + new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })))
  );
  const cfg = S.cfg;
  const fmtStr = `${cfg.superflex ? 'Superflex' : '1QB'} · ${cfg.actualTeams}-team · ${cfg.ppr === 1 ? 'PPR' : cfg.ppr === 0.5 ? 'Half-PPR' : 'Standard'}`;
  const top = h('div.topbar',
    h('div', h('div.lg', S.league.name), h('div.sub', fmtStr + ' · ' + S.season + ' · '
      + (S.liveWeek ? 'week ' + S.liveWeek + ' in progress' : S.lastWeek ? 'through week ' + S.lastWeek : 'preseason'))),
    h('div.grow'),
    S.liveWeek ? h('span.live', h('i'), 'Week ' + S.liveWeek)
      : h('span.live.idle', h('i'), S.lastWeek >= S.regEnd ? 'Playoffs' : 'Week ' + Math.min(S.week, S.regEnd)),
    h('button.btn' + (HYP.on ? '.hypon' : ''), {
      title: 'Try roster changes and see every page recompute', 'aria-label': 'Hypothetical roster sandbox',
      onclick: () => { HYP.on ? hypExit() : hypEnter(); render(); }
    }, ico('flask'), h('span.bl', HYP.on ? 'Hypothetical · ' + hypCount() : 'Hypothetical')),
    shareMenu(),
    settingsMenu()
  );
  const entering = _lastView !== S.view; _lastView = S.view;
  const content = h('div.content' + (entering ? '.enter' : ''));
  const V = {
    home: viewHome, week: viewWeek, players: viewPlayers, roster: viewRoster, lineup: viewLineup, trade: viewTrade, finder: viewFinder, trades: viewTrades,
    h2h: viewH2H, power: viewPower, standings: viewStandings, scout: viewScout, sim: viewSim,
    draft: viewDraft, stock: viewStock, player: viewPlayer
  }[S.view];
  try {
    const pv = VIEWS.find(v => v.k === S.view);
    if (pv && S.view !== 'home') {
      content.appendChild(h('div.pagehead', h('div.pic', ico(pv.ic)),
        h('div', h('h2', pv.label), h('p', blurbFor(pv.k)))));
    }
    if (HYP.on) {
      const bar = HYP_UNAFFECTED[S.view] ? hypNote(S.view) : hypBar();
      if (bar) content.appendChild(bar);
    }
    content.appendChild(V());
  }
  catch (e) { console.error(e); content.appendChild(card('Something broke in this view', null, h('div', h('p.sec', String(e && e.message || e)), h('pre.tiny.muted', { style: { whiteSpace: 'pre-wrap' } }, String(e && e.stack || ''))))); }
  app.appendChild(h('div.shell', side, h('div.main', top, content)));
  // phone navigation: the four places visits start from, then everything else in a sheet
  const inTabs = TAB_VIEWS.includes(S.view);
  app.appendChild(h('nav.tabbar', { 'aria-label': 'Pages' },
    TAB_VIEWS.map(k => { const v = VIEWS.find(x => x.k === k);
      return h('button.tab' + (S.view === k && !moreOpen ? '.on' : ''), { onclick: () => go(k), 'aria-label': v.label }, ico(v.ic), h('span', v.label.replace('This Week', 'Week'))); }),
    h('button.tab' + (moreOpen || !inTabs ? '.on' : ''), { onclick: () => { moreOpen = !moreOpen; render(); }, 'aria-label': 'More pages', 'aria-expanded': moreOpen ? 'true' : 'false' },
      ico('more'), h('span', 'More'))));
  if (moreOpen) {
    app.appendChild(h('div.sheet-back', { onclick: () => { moreOpen = false; render(); } }));
    app.appendChild(h('div.sheet', { role: 'dialog', 'aria-label': 'All pages' },
      h('div.grab'), h('h4', 'All pages'),
      NAV_ORDER.map(g => [h('div.sg', g), h('div.sgrid', VIEWS.filter(v => v.grp === g).map(v =>
        h('button.sitem' + (S.view === v.k ? '.on' : ''), { onclick: () => go(v.k) }, ico(v.ic), v.label)))])));
  }
  shareSyncUrl();
  if (keepY > 0) window.scrollTo(0, keepY);
}
/* Charts are sized for the viewport they were drawn in, so a rotation or a
   resize across the phone/desktop boundary needs a redraw — but only then,
   because re-rendering on every resize tick would fight the user. */
let _wasNarrow = null;
function watchViewport() {
  _wasNarrow = isNarrow();
  let t = null;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const now = isNarrow();
      if (now !== _wasNarrow) { _wasNarrow = now; if (S.league) render(); }
    }, 220);
  });
}
async function hardRefresh() {
  const id = S.leagueId;
  Object.keys(localStorage).filter(k => k.startsWith('dcc:fc:')).forEach(k => localStorage.removeItem(k));
  try { await idbSet('espninj', null); } catch (e) { }
  S.league = null; S._sched = null; S.sim = null;
  await boot(id);
}

/* ================= splash / league picker ================= */
function splash() {
  const box = h('div.box');
  const status = h('div.tiny.muted.sp-status', { style: { minHeight: '18px' } });
  const bar = h('div.loadbar', h('i'));
  const inp = h('input', { placeholder: 'Sleeper username or 18-digit league ID', style: { width: '100%' }, value: LS.get('last', '') });
  const seasonSel = h('select', [String(new Date().getFullYear()), String(new Date().getFullYear() - 1)].map(y => h('option', { value: y }, y)));
  const list = h('div', { style: { display: 'grid', gap: '6px', marginTop: '10px' } });
  const go = h('button.btn.pri', { style: { width: '100%', minHeight: '42px', fontSize: '14px' } }, 'Load league');

  const setStatus = (msg, p) => { status.textContent = msg; $('i', bar).style.width = (p * 100) + '%'; };

  async function submit() {
    const v = inp.value.trim(); if (!v) return;
    go.disabled = true; clear(list); status.innerHTML = '';
    try {
      if (/^\d{6,25}$/.test(v)) { LS.set('last', v); await boot(v, setStatus); return; }
      setStatus('Looking up ' + v + '…', .2);
      const u = await sl('/user/' + encodeURIComponent(v));
      if (!u) throw new Error('No Sleeper user named "' + v + '".');
      const lgs = await sl(`/user/${u.user_id}/leagues/nfl/${seasonSel.value}`);
      if (!lgs || !lgs.length) throw new Error('No ' + seasonSel.value + ' NFL leagues found for ' + v + '.');
      S.me = u.user_id; LS.set('me', u.user_id);
      setStatus('Pick a league', 0);
      clear(list).appendChild(h('div.tiny.muted', { style: { marginTop: '4px' } }, lgs.length + ' league' + (lgs.length > 1 ? 's' : '') + ' for ' + (u.display_name || v)));
      lgs.forEach(l => list.appendChild(h('button.btn.lgpick', {
        onclick: async () => { LS.set('last', l.league_id); go.disabled = true; clear(list); await boot(l.league_id, setStatus); }
      },
        h('div', { style: { fontWeight: '620' } }, l.name),
        h('div.tiny.muted', `${l.total_rosters} teams · ${(l.settings && l.settings.type === 2) ? 'dynasty' : (l.settings && l.settings.type === 1) ? 'keeper' : 'redraft'} · ${l.status}`))));
      go.disabled = false;
    } catch (e) {
      go.disabled = false;
      status.innerHTML = '<span style="color:var(--bad-text);font-weight:600">' + String(e.message || e) + '</span>';
      $('i', bar).style.width = '0';
    }
  }
  go.addEventListener('click', submit);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });

  box.appendChild(card(null, null, h('div', { style: { display: 'grid', gap: '16px' } },
    h('div', h('h2.sp-title', 'Load your league'),
      h('div.tiny.muted', 'Public Sleeper data — no sign-in, no key.')),
    h('div', { style: { display: 'grid', gap: '12px' } },
      h('label.fld', 'Sleeper username or league ID', inp),
      h('label.fld', 'Season (only used for username lookup)', seasonSel)),
    go, bar, status, list,
    h('div.tiny.muted', { style: { borderTop: '1px solid var(--border)', paddingTop: '14px', lineHeight: '1.55' } },
      'The league ID is the long number in your league URL: sleeper.com/leagues/', h('b', '1234567890123456789'), '/team. Everything runs in this browser — nothing is uploaded anywhere.')
  )));
  const feats = ['week', 'roster', 'trade', 'power', 'sim', 'draft', 'stock', 'flask'];
  const featLabel = { week: 'Live scores & win odds', roster: 'Rosters & values', trade: 'Trade calculator', power: 'Power rankings', sim: 'Season simulator', draft: 'Draft board', stock: 'Value charts', flask: 'Hypothetical sandbox' };
  return h('div.splash',
    h('div.sp-art',
      h('div.sp-logo', h('div.mark', { html: MARK_SVG }), h('b', 'Dynasty Command Center')),
      h('h1', 'Every dynasty decision, ', h('span', 'one command center.')),
      h('p', 'Live analysis for any Sleeper league: who’s really winning, what a trade is worth, and what the season looks like when you play it a thousand times.'),
      h('div.sp-feats', feats.map(k => h('span', ico(k), featLabel[k])))),
    h('div.sp-form', box));
}

