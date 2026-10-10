"use strict";
/* ==================================================================
   Dynasty Command Center — core
   Live data: Sleeper API (league/rosters/matchups/drafts/players)
              FantasyCalc API (dynasty + redraft trade values, picks)
   ================================================================== */

/* ---------- tiny dom ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
function h(tag, props, ...kids) {
  const parts = tag.split(/([.#])/); let name = parts[0] || 'div';
  const e = document.createElement(name);
  for (let i = 1; i < parts.length; i += 2) {
    if (parts[i] === '.') e.classList.add(parts[i + 1]); else e.id = parts[i + 1];
  }
  // only a plain object is a props bag; numbers, strings, arrays and nodes are children
  if (props !== null && props !== undefined &&
      (typeof props !== 'object' || props.nodeType || Array.isArray(props))) { kids.unshift(props); props = null; }
  if (props) for (const k in props) {
    const v = props[k];
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className += (e.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'data') for (const d in v) e.dataset[d] = v[d];
    else e.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) return c.forEach(add);
    e.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return e;
}
/* ---------- viewport ----------
   Charts are drawn into a fixed viewBox and stretched to fit their container.
   On a phone that means a 760-wide drawing squeezed into ~380 CSS pixels, which
   halves the width of every axis label and tick. Drawing narrow in the first
   place keeps the type honest. */
const NARROW_AT = 760;
/* Simple mode: the same data with the secondary half left out. It rides the same
   `prio` marks the phone layout uses, so nothing needed a parallel set of views. */
function isSimple() { return S.ui === 'simple'; }
function setUiMode(m) {
  S.ui = m === 'simple' ? 'simple' : 'full';
  if (S.ui === 'simple') document.documentElement.setAttribute('data-ui', 'simple');
  else document.documentElement.removeAttribute('data-ui');
  LS.set('ui', S.ui);
}
/* ---- player tiers ----
   Diamond, gold, silver and bronze are cut by overall rank on the value this
   league actually trades in, so they follow the dynasty/redraft switch, the
   superflex adjustment and the hypothetical sandbox. Everyone below the last
   cut carries no medal at all: a tier only means something if most players
   do not have one. */
const MEDALS = [
  { k: 'diamond', label: 'Diamond', upTo: 12 },
  { k: 'gold', label: 'Gold', upTo: 48 },
  { k: 'silver', label: 'Silver', upTo: 120 },
  { k: 'bronze', label: 'Bronze', upTo: 250 }
];
/** 'off' | 'static' | 'animated' — the look is part of the Default view only. */
function medalMode() { const m = LS.get('medals', 'animated'); return m === 'off' || m === 'static' ? m : 'animated'; }
function setMedalMode(m) { LS.set('medals', m); }
function assignMedals(all) {
  const ranked = Object.values(all).filter(p => p && p.pos !== 'PICK' && (p.dv || 0) > 0).sort((a, b) => b.dv - a.dv);
  for (const id in all) if (all[id]) all[id].medal = null;
  ranked.forEach((p, i) => { const m = MEDALS.find(x => i < x.upTo); p.medal = m ? m.k : null; });
}
/** The medal to draw for a player right now, or null (off, minimal view, pick, unranked). */
function medalOf(p) {
  if (!p || !p.medal || !isSimple() || medalMode() === 'off') return null;
  return p.medal;
}
/** Class names that give a row its tier accent (empty when there is none to show). */
function rowMedal(p) {
  const m = medalOf(p);
  return m ? 'trm medal ' + m : null;
}
function medalCls(p) {
  const m = medalOf(p);
  return m ? ' medal ' + m + (medalMode() === 'animated' ? ' anim' : '') : '';
}
/** Cards that only earn their space in the dense view. */
function proOnly(node) { return isSimple() ? null : node; }

/* ---- dynasty or redraft ----
   A dynasty or keeper league carries value into next year, so half of what this
   app measures — the ageing curve, the two-to-three-year projection, draft-pick
   capital, contend-versus-rebuild — is about that carry. A redraft league has no
   carry: every roster is dissolved in the spring. Rather than show those numbers
   with a shrug, a redraft league switches them off and prices everything at the
   market's redraft value instead. */
function isDynasty() { return S.dynasty !== false; }
/** Cards, columns and tips that only mean something when next year exists. */
function dynOnly(node) { return isDynasty() ? node : null; }
function valueWord() { return isDynasty() ? 'dynasty' : 'redraft'; }
function capitalLabel() { return isDynasty() ? 'Dynasty capital' : 'Roster value'; }
/** Sleeper's own answer: 0 redraft, 1 keeper, 2 dynasty. Keepers carry enough
 *  value into next year to be read as dynasty; the setting can say otherwise. */
function detectLeagueType(league) {
  const t = league && league.settings ? league.settings.type : undefined;
  return t === 0 ? 'redraft' : 'dynasty';
}
function leagueTypeKey() { return 'ltype:' + S.leagueId; }
/** 'auto' follows Sleeper; the other two are the user overruling it. */
function leagueTypeChoice() { return LS.get(leagueTypeKey(), 'auto'); }
function setLeagueType(choice) {
  LS.set(leagueTypeKey(), choice === 'dynasty' || choice === 'redraft' ? choice : 'auto');
  applyLeagueType();
}
function applyLeagueType() {
  const choice = leagueTypeChoice();
  const was = S.dynasty;
  S.detected = detectLeagueType(S.league || {});
  S.dynasty = (choice === 'auto' ? S.detected : choice) === 'dynasty';
  if (was === S.dynasty) return false;
  // the currency, the projections and every roster metric all move together
  applyValueMode();
  S._fa = null; S._slotDemand = null; S._depth = null; S._live = null; S._wpPath = null; S.sim = null; S._short = {}; S._sig = null; S._tl = null;
  // rosters are rebuilt because pick ownership changes, then every metric is
  // recomputed because the currency under all of them just changed
  if (S.teams && S.teams.length) { buildTeams(); computeStrength(); recordSnapshot(); }
  return true;
}
/** Point every `dv` at the currency this league actually trades in. `idx` is
 *  passed while the index is still being built, before S.index points at it. */
function applyValueMode(idx) {
  const all = idx || S.index || {};
  const dyn = isDynasty() || S.redraftPricesMissing;
  for (const id in all) {
    const p = all[id];
    if (!p || p.pos === 'PICK') continue;
    p.dv = dyn ? (p.dvDyn || 0) : (p.rv || 0) * (p.injFactor || 1);
    p.fppg = isDynasty() ? (p.fppgDyn !== undefined ? p.fppgDyn : p.ppg) : p.ppg;
  }
  assignMedals(all);
}
/* Whether a franchise is named by its manager or by its team name. Sleeper lets
   people rename a team mid-season and plenty never set one at all, so the
   username is the stable handle — and it is what everyone calls each other in
   the group chat. Every surface reads t.name, so this flips all of them at once. */
function useUsernames() { return S.names !== 'team'; }
function setNameMode(m) {
  S.names = m === 'team' ? 'team' : 'user';
  LS.set('names', S.names);
  S._short = {};
}
/** Initials for a multi-word name, the first few characters for a single word —
 *  "manager10" and "manager4" both reducing to "M" makes comparisons unreadable. */
function abbrev(name, fallback) {
  const clean = String(name || '').replace(/[^A-Za-z0-9 ]/g, '').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  let s;
  if (words.length > 1) s = words.map(w => w[0]).join('').slice(0, 3);
  else {
    // keep any trailing number: "manager10" and "manager4" must not both be "MANA"
    const m = clean.match(/^([A-Za-z]*)(\d*)$/);
    s = m ? (m[1].slice(0, 3) + m[2]).slice(0, 5) : clean.slice(0, 4);
  }
  return s.toUpperCase() || fallback;
}
function isNarrow() {
  return typeof window !== 'undefined' && window.innerWidth > 0 && window.innerWidth < NARROW_AT;
}
function chartW(wide, narrow) { return isNarrow() ? (narrow || 380) : wide; }

const svg = (tag, props) => {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in (props || {})) { const v = props[k]; if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v); }
  return e;
};
const clear = (e) => { while (e.firstChild) e.removeChild(e.firstChild); return e; };

/* ---------- numbers ---------- */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => a.length ? sum(a) / a.length : 0;
const sd_ = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(sum(a.map(x => (x - m) ** 2)) / (a.length - 1)); };
const fmt = (n, d) => (n === null || n === undefined || !isFinite(n)) ? '—' : Number(n).toLocaleString(undefined, { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
const pct = (n, d) => (n === null || n === undefined || !isFinite(n)) ? '—' : (n * 100).toFixed(d === undefined ? 1 : d) + '%';
const sgn = (n, d) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n), d);
const ord = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const kfmt = (n) => Math.abs(n) >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : fmt(n, 0);
function zscores(arr) { const m = mean(arr), s = sd_(arr) || 1; return arr.map(v => (v - m) / s); }
function rankOf(arr, desc) { // returns rank array 1-based
  const idx = arr.map((v, i) => [v, i]).sort((a, b) => desc === false ? a[0] - b[0] : b[0] - a[0]);
  const out = new Array(arr.length); idx.forEach(([, i], r) => out[i] = r + 1); return out;
}
/* fast RNG + gaussian */
let _rs = 88675123 >>> 0;
function rnd() { _rs ^= _rs << 13; _rs >>>= 0; _rs ^= _rs >> 17; _rs ^= _rs << 5; _rs >>>= 0; return _rs / 4294967296; }
let _spare = null;
/* Reseeding must also discard the cached Box-Muller spare, otherwise a run can
   open with a deviate left over from whatever ran before it and two same-seed
   runs diverge — which would quietly break every paired before/after comparison. */
function seedRng(s) { _rs = (s >>> 0) || 88675123; _spare = null; }
function gauss() {
  if (_spare !== null) { const v = _spare; _spare = null; return v; }
  let u, v, s;
  do { u = rnd() * 2 - 1; v = rnd() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
  const m = Math.sqrt(-2 * Math.log(s) / s); _spare = v * m; return u * m;
}

/* ---------- storage ---------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem('dcc:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('dcc:' + k, JSON.stringify(v)); } catch (e) { } },
  del(k) { try { localStorage.removeItem('dcc:' + k); } catch (e) { } }
};
let _db = null;
function idb() {
  if (_db) return _db;
  _db = new Promise((res) => {
    let rq; try { rq = indexedDB.open('dcc', 1); } catch (e) { return res(null); }
    rq.onupgradeneeded = () => { try { rq.result.createObjectStore('kv'); } catch (e) { } };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => res(null);
  });
  return _db;
}
async function idbGet(k) {
  const db = await idb(); if (!db) return null;
  return new Promise(res => { try { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); } catch (e) { res(null); } });
}
async function idbSet(k, v) {
  const db = await idb(); if (!db) return;
  return new Promise(res => { try { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => res(); } catch (e) { res(); } });
}

/* ---------- fetch ---------- */
const SLEEPER = 'https://api.sleeper.app/v1';
const FCALC = 'https://api.fantasycalc.com';
async function getJSON(url, tries) {
  tries = tries || 2; let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { err = e; if (i < tries - 1) await new Promise(s => setTimeout(s, 350 * (i + 1))); }
  }
  throw new Error(url.replace(/^https:\/\//, '').split('?')[0] + ' — ' + err.message);
}
const sl = (p) => getJSON(SLEEPER + p);

/* ---------- state ---------- */
const S = {
  view: 'home', leagueId: null, league: null, users: [], rosters: [], teams: [],
  players: {}, values: null, valuesRedraft: null, picksVal: {}, state: null,
  matchups: {}, drafts: [], draftPicks: {}, tradedPicks: [], transactions: [],
  ui: 'full', names: 'user', _short: {}, dynasty: true, detected: 'dynasty',
  cfg: {}, week: 1, lastWeek: 0, liveWeek: null, nflSched: null, regEnd: 14,
  me: null, sim: null, simN: 2000,
  history: {}, snapshots: [], busy: false, err: null
};
window.__S = S;

