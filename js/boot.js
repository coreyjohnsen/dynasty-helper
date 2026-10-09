"use strict";
/* ================= boot ================= */
async function boot(leagueId, onStep) {
  try {
    S.busy = true;
    await loadLeague(leagueId, onStep);
    const me = LS.get('me', null);
    if (me) { const t = S.teams.find(t => t.ownerId === me); if (t) S.myRosterId = t.rosterId; }
    if (!S.myRosterId) S.myRosterId = S.teams[0].rosterId;
    RosterUI.team = S.myRosterId; TradeUI.a = S.myRosterId; FinderUI.team = S.myRosterId;
    // a league that has just loaded lands on the front page; the live week is one
    // click from there, and is called out at the top of it when there is one
    if (S.view === 'roster') S.view = 'home';
    S.busy = false;
    S.sim = null;
    render();
  } catch (e) {
    S.busy = false; console.error(e);
    if (onStep) onStep('', 0);
    const app = $('#app');
    if (!S.league) {
      clear(app); app.appendChild(splash());
      const box = $('.splash .box .bd');
      box.appendChild(h('div', { style: { marginTop: '10px', padding: '9px 11px', border: '1px solid var(--critical)', borderRadius: 'var(--r-sm)', background: 'color-mix(in srgb, var(--critical) 8%, transparent)' } },
        h('b', { style: { color: 'var(--bad-text)' } }, 'Could not load'), h('div.tiny.sec', String(e.message || e)),
        h('div.tiny.muted', { style: { marginTop: '5px' } }, 'If this says “Failed to fetch”, the API is unreachable from this page — check your connection, or open this file directly in a browser rather than inside another app’s preview pane.')));
    }
  }
}
setTheme(currentTheme());
setAccent(currentAccent());
setUiMode(LS.get('ui', 'simple'));   // a first visit should meet the calmer view
setNameMode(LS.get('names', 'user')); // people know each other by handle, not by team name
watchViewport();
const _last = LS.get('last', null);
render();
if (_last && /^\d{6,25}$/.test(String(_last))) {
  const st = $('.splash .sp-status');
  const bar = $('.splash .loadbar i');
  boot(_last, (m, p) => { if (st) st.textContent = m; if (bar) bar.style.width = (p * 100) + '%'; });
}


