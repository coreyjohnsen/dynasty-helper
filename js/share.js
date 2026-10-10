"use strict";
/* ================= sharing =================
   There is no server, so a shared page is a link that carries its own recipe:
   the league ID, the page, and whatever that page needs to look the same —
   the two sides of a trade, the matchup, the simulator settings. Whoever opens
   it loads the league live and lands on the same page; the numbers are
   recomputed from current data rather than frozen. "Copy summary" is the
   frozen version: plain text of what was on screen, for pasting into a chat.
   Link format:  #/<page>?l=<leagueId>&…                                      */

/** Per-page codecs. encode() → flat object of strings; apply(p) restores that state. */
const SHARE = {
  pending: null,   // a link opened before the league had loaded
  pages: {
    roster: {
      label: 'roster',
      encode: () => ({ t: RosterUI.team }),
      apply: p => { if (S.teamById[+p.t]) RosterUI.team = +p.t; }
    },
    player: {
      label: 'player',
      encode: () => ({ id: PlayerUI.id, bk: PlayerUI.back }),
      apply: p => { if (S.index && S.index[p.id]) { PlayerUI.id = p.id; PlayerUI.back = p.bk || 'roster'; } else S.view = 'players'; }
    },
    trade: {
      label: 'trade',
      encode: () => ({
        a: TradeUI.a, b: TradeUI.b,
        ao: TradeUI.aOut.map(x => encodeURIComponent(x.id)).join(','),
        bo: TradeUI.bOut.map(x => encodeURIComponent(x.id)).join(',')
      }),
      apply: p => {
        if (!S.teamById[+p.a] || !S.teamById[+p.b] || +p.a === +p.b) return;
        const pick = (T, csv) => {
          const have = assetsOf(T);
          return (csv ? csv.split(',') : []).map(s => decodeURIComponent(s)).map(id => have.find(a => a.id === id)).filter(Boolean);
        };
        TradeUI.a = +p.a; TradeUI.b = +p.b;
        TradeUI.aOut = pick(S.teamById[TradeUI.a], p.ao);
        TradeUI.bOut = pick(S.teamById[TradeUI.b], p.bo);
        TradeUI.result = null; TradeUI.sig = null;
        if (TradeUI.aOut.length || TradeUI.bOut.length) tradeRunNow();
      },
      text: () => {
        const r = TradeUI.result; if (!r) return null;
        const side = (T, out) => T.name + ' sends: ' + (out.length ? out.map(a => a.name + ' (' + kfmt(Math.round(a.dv)) + ')').join(', ') : 'nothing');
        const edge = Math.abs(r.delta) < 1 ? 'dead even on value' : (r.delta > 0 ? r.A.name : r.B.name) + ' wins on value by ' + kfmt(Math.round(Math.abs(r.delta)));
        return ['Trade proposal', side(r.A, r.aOut), side(r.B, r.bOut), edge].join('\n');
      }
    },
    h2h: {
      label: 'matchup',
      encode: () => ({ a: H2HUI.a, b: H2HUI.b, w: H2HUI.week }),
      apply: p => {
        if (!S.teamById[+p.a] || !S.teamById[+p.b] || +p.a === +p.b) return;
        H2HUI.a = +p.a; H2HUI.b = +p.b; if (+p.w) H2HUI.week = +p.w; H2HUI.res = null;
      },
      text: () => {
        const r = H2HUI.res; if (!r) return null;
        const A = S.teamById[H2HUI.a], B = S.teamById[H2HUI.b];
        return `Week ${H2HUI.week}: ${A.name} vs ${B.name}\n${A.name} ${pct(r.pA, 0)} · ${B.name} ${pct(r.pB, 0)}\nProjected ${fmt(r.meanA, 1)} – ${fmt(r.meanB, 1)}`;
      }
    },
    week: {
      label: 'week',
      encode: () => ({ w: WeekUI.week, o: WeekUI.open }),
      apply: p => { if (+p.w) WeekUI.week = +p.w; WeekUI.open = S.teamById[+p.o] ? +p.o : null; },
      text: () => {
        const wk = WeekUI.week; if (!wk) return null;
        const g = liveMatchups(wk).filter(m => !WeekUI.open || m.A.rosterId === WeekUI.open || m.B.rosterId === WeekUI.open);
        if (!g.length) return null;
        return [(S.league ? S.league.name + ' — ' : '') + 'Week ' + wk + ' matchups'].concat(g.map(m =>
          `${m.A.name} ${fmt(m.a.banked + m.a.open.reduce((s, r) => s + r.used, 0), 1)} (${pct(m.pA, 0)}) vs ${m.B.name} ${fmt(m.b.banked + m.b.open.reduce((s, r) => s + r.used, 0), 1)} (${pct(m.pB, 0)})`)).join('\n');
      }
    },
    sim: {
      label: 'simulation',
      encode: () => ({ m: SimUI.mode, w: SimUI.week, n: SimUI.n, t: SimUI.team, run: SimUI.res ? 1 : 0 }),
      apply: p => {
        if (['season', 'week', 'replay'].includes(p.m)) SimUI.mode = p.m;
        if (+p.w) SimUI.week = +p.w;
        if ([1000, 2000, 5000, 10000].includes(+p.n)) SimUI.n = +p.n;
        if (S.teamById[+p.t]) SimUI.team = +p.t;
        if (p.run === '1' && SimUI.mode !== 'replay') {
          const t0 = performance.now();
          SimUI.res = SimUI.mode === 'week' ? simulate(SimUI.n, { onlyWeek: SimUI.week }) : simulate(SimUI.n);
          SimUI.res.ms = Math.round(performance.now() - t0);
          if (SimUI.mode === 'season') S.sim = SimUI.res;
        }
      },
      text: () => {
        const r = SimUI.res; if (!r || SimUI.mode !== 'season') return null;
        const rows = S.teams.map(t => ({ t, x: r.by[t.rosterId] })).filter(o => o.x).sort((a, b) => b.x.title - a.x.title || b.x.playoff - a.x.playoff);
        return [(S.league ? S.league.name + ' — ' : '') + 'Season simulation (' + kfmt(r.n) + ' runs)', 'Team · playoffs · title']
          .concat(rows.map(o => `${o.t.name} · ${pct(o.x.playoff, 0)} · ${pct(o.x.title, 0)}`)).join('\n');
      }
    }
  }
};

function shareParams() {
  const spec = SHARE.pages[S.view], q = new URLSearchParams();
  q.set('l', S.leagueId);
  if (spec) { const e = spec.encode(); for (const k in e) if (e[k] !== null && e[k] !== undefined && e[k] !== '') q.set(k, e[k]); }
  return q;
}
function shareHash() { return '#/' + S.view + '?' + shareParams().toString(); }
function shareUrl() { return location.origin + location.pathname + shareHash(); }
/** Keep the address bar a working link to the current page. */
function shareSyncUrl() {
  if (!S.league || !S.leagueId) return;
  try { history.replaceState(null, '', location.pathname + location.search + shareHash()); } catch (e) { }
}
/** Read a link's hash; null when it isn't one of ours. */
function shareParse(hash) {
  const m = /^#\/([a-z0-9]+)\?(.*)$/i.exec(hash || ''); if (!m) return null;
  const q = new URLSearchParams(m[2]), p = {};
  q.forEach((v, k) => p[k] = v);
  return /^\d{6,25}$/.test(p.l || '') ? { view: m[1], league: p.l, p } : null;
}
/** Land on the page a link describes. Called once the league is loaded. */
function shareApplyPending() {
  const s = SHARE.pending; SHARE.pending = null;
  if (!s || !VIEWS.some(v => v.k === s.view) && s.view !== 'player') return;
  try {
    S.view = s.view;
    const spec = SHARE.pages[s.view]; if (spec) spec.apply(s.p);
  } catch (e) { console.error('share link', e); }
}

let shareOpen = false, _shareBound = false, _toastT = null;
function shareToast(msg) {
  let t = $('#sharetoast');
  if (!t) { t = h('div#sharetoast', { role: 'status' }); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('on');
  clearTimeout(_toastT); _toastT = setTimeout(() => t.classList.remove('on'), 2200);
}
async function shareCopy(text, what) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } }); ta.value = text;
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { }
    ta.remove(); if (!ok) { shareToast('Copy failed — select the link and copy it by hand'); return; }
  }
  shareToast(what + ' copied');
}
function shareMenu() {
  if (!_shareBound) {
    _shareBound = true;
    document.addEventListener('click', e => {
      if (!shareOpen || (e.target.closest && e.target.closest('.sharewrap'))) return;
      shareOpen = false; render();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && shareOpen) { shareOpen = false; render(); } });
  }
  const spec = SHARE.pages[S.view];
  const label = spec ? spec.label : (VIEWS.find(v => v.k === S.view) || { label: 'page' }).label.toLowerCase();
  const url = shareUrl();
  let summary = null; try { summary = spec && spec.text ? spec.text() : null; } catch (e) { }
  const note = HYP.on ? 'Hypothetical roster moves are not included — the link opens the real league.'
    : S.view === 'trade' && !(TradeUI.aOut.length || TradeUI.bOut.length) ? 'Add players or picks to a side first and the link will carry the trade.'
    : S.view === 'sim' && !SimUI.res ? 'Run the simulation first and the link will open with it already run.'
    : 'Opens this ' + label + ' on live data, so numbers may shift slightly.';
  const panel = h('div.menupanel.sharepanel',
    h('div.mlbl', 'Share this ' + label),
    h('input.sharelink', { readonly: true, value: url, 'aria-label': 'Link', onfocus: e => e.target.select() }),
    h('div.mnote', note),
    h('button.btn.pri', { onclick: () => shareCopy(url, 'Link') }, ico('check'), 'Copy link'),
    navigator.share ? h('button.btn', {
      onclick: () => { navigator.share({ title: document.title, text: summary || undefined, url }).catch(() => { }); }
    }, ico('swap'), 'Share…') : null,
    summary ? h('button.btn', { onclick: () => shareCopy(summary + '\n' + url, 'Summary') }, ico('plus'), 'Copy summary as text') : null);
  return h('div.menuwrap.sharewrap',
    h('button.btn' + (shareOpen ? '.pri' : ''), {
      title: 'Share this page', 'aria-label': 'Share this page', 'aria-expanded': shareOpen ? 'true' : 'false',
      onclick: () => { shareOpen = !shareOpen; settingsOpen = false; render(); }
    }, ico('share'), h('span.bl', 'Share')),
    shareOpen ? panel : null);
}
