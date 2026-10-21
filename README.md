# Fantasy Lab

Live analysis for Sleeper dynasty leagues, served as a static site at
**[fantasylab.tools](https://fantasylab.tools)**.

Rosters and values, a trade calculator, power rankings, active standings, a trade
finder, a season simulator with a playable single-season replay, the draft board,
stock-mode value charts, per-player pages, and a hypothetical roster sandbox that
recomputes every page as if your moves had happened.

It works for **any** Sleeper league. Enter a username or a league ID on the first
screen.

---

## How it works

Everything runs in the visitor's browser. There is no server, no build step and no
API key. `index.html` is a thin shell that loads plain stylesheets from `css/` and plain
scripts from `js/` (see **Files**); the other files are icons and site metadata.

| Source | What it provides |
|---|---|
| `api.sleeper.app/v1/...` | league settings, managers, rosters, weekly matchups, drafts, traded picks, transactions |
| `api.sleeper.app/projections/...` | Rotowire weekly projections, with opponent, byes omitted |
| `api.fantasycalc.com/values/current` | dynasty and redraft trade values, 30-day trends, draft-pick values |

All three send permissive CORS headers, which is why a plain static host works.
League format (superflex vs 1QB, team count, PPR) is detected from the league
itself, and weekly projections are re-scored through that league's own
`scoring_settings` rather than Sleeper's generic presets.

Responses are cached in the visitor's own browser: the player database for 12
hours (IndexedDB), weekly projections for 6 hours (IndexedDB), trade values for 4
hours (localStorage). Stock mode also records one value snapshot per visit, so the
value charts accumulate real observed history over time. The charts draw only what is
known: those snapshots, today's price, and (dynasty only) FantasyCalc's published price
30 days ago, shown dashed because only its two ends are known. Nothing is filled in
between, and longer windows appear once this browser holds history that old.

**Your league data is never uploaded and there are no secrets in this repo.** Sleeper's
API is public and read-only; the app only ever reads. The one thing that leaves the page is an
anonymous visit count to [GoatCounter](https://www.goatcounter.com) (no cookies, no personal
data): `track()` in `js/core.js` sends the name of the page being viewed and a few events (league
loaded, trade evaluated, simulation run, hypothetical change, share link copied or opened),
never a league ID, a team, a player, or the URL hash. To turn it off, delete the `<script>` tag
with `data-goatcounter` in `index.html`; `track()` then does nothing.

**Security.** Team, user and league names are typed by the people in a league, so they are treated as
untrusted. Anything built as an HTML string (tooltips) goes through `esc()` (`js/core.js`) at the
point a name is interpolated, and `ttShow()` runs the result through `safeHtml()` (`js/ui.js`), which
keeps only formatting tags and drops everything else. Elsewhere names are set as text. Underneath
both, `index.html` carries a Content Security Policy (a meta tag, since Pages cannot send headers):
scripts only from this site and GoatCounter, data only from Sleeper, FantasyCalc, ESPN and the
counter. If the app ever needs another host, add it to `connect-src` there or the browser will refuse
the request.

---

## Deploying

Already configured for GitHub Pages on a custom domain. From scratch:

1. Push this repo to GitHub (public, since Pages on a private repo needs a paid plan).
2. **Settings → Pages → Source:** *Deploy from a branch*, `main`, `/ (root)`.
3. **Settings → Pages → Custom domain:** `fantasylab.tools`
   (GitHub writes it to the `CNAME` file in this repo, which must hold exactly that, one line).
4. Add these records where `fantasylab.tools` is managed:

   | Type | Name | Value |
   |---|---|---|
   | A | `@` | `185.199.108.153` |
   | A | `@` | `185.199.109.153` |
   | A | `@` | `185.199.110.153` |
   | A | `@` | `185.199.111.153` |
   | CNAME | `www` | `coreyjohnsen.github.io` |

5. When GitHub's DNS check passes and the certificate provisions (minutes, sometimes hours),
   tick **Enforce HTTPS**.

Things that catch people out:

- The `www` target is **`coreyjohnsen.github.io`**, the *user* Pages host, not the repo name.
  GitHub routes to the right repo by matching the `CNAME` file.
- A repo can only carry **one** custom domain (the bare domain and its `www` count as one).
  To make other domains reach the site, forward them at the registrar.
- If the registrar adds default records pointing at its own servers (Squarespace does, and offers to
  "update" them), leave them out: they would replace the GitHub records above.
- If the social-preview image or install icon ever changes, the cached copies on other sites can take
  a while to refresh.

### Updating

Commit and push; the whole folder is the site. GitHub Pages serves with a ten-minute cache,
so allow a few minutes before a hard refresh shows the change.

---

## Files

| File | Why it's here |
|---|---|
| `index.html` | Page shell: metadata, then `css/*.css` and `js/*.js` in load order. |
| `css/` | `tokens` (colours, themes) → `layout` (shell, cards) → `components` (page-specific parts) → `simple` (Default view, menus, share) → `responsive` (narrow screens). |
| `js/` | Classic scripts sharing one global scope, loaded in the order `index.html` lists them: `core` (dom helpers, storage, state) → `values`/`league`/`simulation` (data and models) → `ui`/`shell` (shared widgets, app frame) → one file per page → `share` → `boot`. No build step; order matters because later files use earlier ones. `sim-kernel.js` loads first: it is the random-number generator and the season loop, with no page state or DOM, so the same file also runs inside `sim-worker.js`, which plays simulations off the page's thread (opened from disk, where workers are blocked, the same kernel runs in short slices on the page instead). |
| `CNAME` | Tells GitHub Pages which custom domain serves this repo. |
| `.nojekyll` | Skips Jekyll processing. Nothing here needs it, and it makes deploys quicker. |
| `favicon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | Tab icon and home-screen icons. |
| `site.webmanifest` | Lets the site install to a phone home screen as a standalone app. |
| `og-image.png` | Link preview when the URL is shared. |
| `robots.txt` | Allows indexing. Contains a commented two-line change to opt out. |

`index.html` also references `/apple-touch-icon.png` and `/site.webmanifest`.
Those resolve once hosted; if you open the file straight off disk they 404
harmlessly and nothing else changes.

---

## Running it locally

Open `index.html` in a browser and it works. Two caveats when loading from disk
rather than a server:

- Chrome disables IndexedDB on `file://`, so the player database and weekly
  projections are re-fetched on every load instead of cached. Expect a slower
  start, roughly ten seconds.
- Per-visitor storage is less reliable, so stock-mode history may not accumulate.

For a local server that behaves like production: `python3 -m http.server 8000`
then visit `http://localhost:8000`.

---

## Design

One stylesheet at the top of `index.html`, built on tokens (`:root`): a cool neutral
surface scale, an indigo→violet brand used only for chrome (navigation, primary
actions, focus), and the `--s1...--s8` / `--seq-*` data palette that charts and position
pills read from, so a chart never changes meaning with the theme. Light, dark and
*Auto* all resolve through the same tokens.

- **Default** and **Minimal** views are one switch (`data-ui` on the root). Default is
  roomier with photos; Minimal tightens table density and drops imagery.
- Under 900px the sidebar becomes a bottom tab bar (Home · Week · Rosters · Players ·
  More), with every page one tap behind **More**.
- **Accent colour** is one hue (`--hue`, set by `data-accent` on the root) from which every
  brand token (buttons, links, focus, sidebar tint, home banner, landing page) is derived
  with `oklch()`. Seven themes ship (Indigo, Ocean, Lagoon, Emerald, Sunset, Rose,
  Graphite); the choice is stored in the visitor's browser. Adding one is a single CSS line
  plus an entry in `ACCENTS`.
- **Trade calculator** is laid out as a desk: a matchup bar, two trays showing what each side
  sends with the balance and the Evaluate button between them, and one shared roster browser
  (tabs per team, search, position filters, tap to add or remove) below. Results sit directly
  under the deal. On a phone the balance and button ride above the tab bar.
- The calculator's parts are shared components (`teamCard`, `matchupBar`, `assetCard`,
  `deskTray`, `assetBrowser`, `dealBar`) and the same look runs through **Head to Head** (matchup
  bar and headline hero), **Start / Sit** (compare tray plus a collapsible browser),
  **Trade Finder** (team card, player picker, two-tray result cards with a balance chip),
  **Trade History** (a tray per side), the **Hypothetical** page (its trade mode is the same desk;
  the waiver and sandbox modes use the same browser) and **Stock Mode** (searchable player picker
  instead of a long dropdown).
- Navigation icons are inline SVG (`ICON` in the script); there are no icon fonts, web
  fonts or other dependencies.

---

## Trade finder

For every partner it builds candidate trades from two sources: an enumeration of
common shapes (1-for-1, 2-for-1, 1-for-2, and 3-for-1 / 1-for-3 in the shape modes),
and an assembly step that starts from each side's actual needs (the holes and
surpluses from GM Scout) and builds 2-for-2 / 3-for-2 packages around them. Each
candidate must clear four checks, then is ranked:

- **Value balance**: within the chosen tolerance after a stud premium: a package's
  best player counts in full, each further player for less (picks count in full).
- **Roster fit**: a side that lands more players than it sends must cut down to its
  active limit. The cheapest bench players are cut, the cost is priced in, and the
  card says who goes. A trade with nobody left to cut is dropped.
- **Both sides gain** on their own objective (contend / rebuild / balanced).
- **Market angle**: trades that sell a flagged player or buy one rank higher.

**Buy low / sell high.** A player is flagged when his scoring and his price disagree
by more than week-to-week noise allows (variance for his position, shrinking with
games played, calibrated against this league's own median), or from an age cliff. A 30-day
value move only reinforces another signal; it never flags anyone alone. Players who
are out, doubtful, suspended or on injured reserve are never flagged: their price is
explained by the injury, and they cannot help this season. Each suggestion also lists, in words, why it works.

**On the Players page** the same flags appear as tags beside each name, with Market
(Buy low / Sell high) and Timeline (Win now / Rebuild) filters, two sortable columns,
and a *Win now vs rebuild* section. A player is **win now** when his redraft rank is
at least 40% and six places better than his dynasty rank (worth more this season than
over the long run) and **rebuild** when it is the other way round. Compared by rank so
the two prices' scales don't matter. Dynasty leagues only; a redraft league has no long
run to compare against. The player page explains any flag in words.

---

### Simulator

Three modes behind one picker (Season odds, Single week, Play a season). Every team is drawn with its
Sleeper avatar (a coloured initial when it has none). On a phone the season table becomes ranked cards
with playoff and title meters, each "game that matters" shows both teams in both worlds side by side,
and the replay bracket reads top to bottom instead of scrolling sideways. Wide screens keep the tables.

## Age curves

**Stock Mode → Age curves** (`js/outlook.js`) groups every player FantasyCalc prices today by age, or by
years in the league, per position, and charts what the market pays for each group: the average of the
top eight, or the median. Groups of fewer than three are left out and the curve is lightly smoothed.
From the curve it reads where each position peaks and how fast it falls, and carries every roster
three years forward. The player page shows the same thing for one player: today's dynasty value moved
along his position's curve (the top-player curve for the top 24 at a position, 12 for TE and 1QB QBs;
the median curve otherwise), stopping where no older players at his position are priced.

It is a cross-section of today's prices, not a record of careers: players who washed out are no
longer priced, so the old end of each curve is the survivors and real declines are usually steeper.
The page says so.

## Injury return dates

Sleeper's tag says a player is hurt, not for how long. `availability(p, week)` is the chance a
flagged player plays in a given week, and `pw()` multiplies every weekly projection by it, so
lineups, Start/Sit, Head to Head, the simulator and the season outlook all read one number.

Where the return week comes from, best first:

1. **ESPN's public injury feed** (`site.api.espn.com/apis/site/v2/sports/football/nfl/injuries`),
   matched through the `espn_id` Sleeper already carries. It is unofficial and keyless; if the
   browser blocks it or it changes shape, the app says so in Settings and carries on.
2. **The wording of the notes** (ESPN's and Sleeper's): "season-ending", "4-6 weeks", "Week 9".
3. **Typical recovery for the body part and designation** (`BODY_WEEKS`; IR is at least four games).

Each source gives a most-likely week and a spread, so a Week 7 return is 24% likely to play in
Week 6 and 97% in Week 8, not a cliff. IR-slot players due back are added to the simulated
lineups from the week they return. Redraft values lose up to 30% for lost games, dynasty values
are untouched. **Settings → Injury return dates** switches all of it off and shows the feed's status.

## Known limits

- Rotowire's weekly projections barely differ week to week before the season
  starts; bye weeks are exact from day one, and matchup spread grows as the
  season runs.
- Draft-pick slots assume the usual inverse-standings order. Lottery or
  playoff-based draft orders are not modelled.
- IDP leagues load and render, but neither data source publishes IDP values, so
  those players sit at replacement level.
- Playoff seeding follows Sleeper's default (division winners first, then best
  records). Custom tiebreakers are not modelled.

---

## Sharing

The **Share** button in the top bar copies a link to the page you are on. The
link carries its own recipe in the URL hash (`#/trade?l=<leagueId>&a=...&ao=...`),
so there is still no server: whoever opens it loads the league live and lands on
the same page. Pages that carry state: trade calculator (both teams and every
asset), head to head (teams, overall or week view, and the week), this week (week and open matchup),
simulator (mode, week, run size, and whether it had been run, which re-runs on
open), roster and player pages. The address bar is kept in sync, so copying it
works too. Trade, matchup, week and simulator pages also offer **Copy summary**,
a plain-text snapshot of the numbers on screen. Hypothetical sandbox moves are
never included. Codecs live in `js/share.js` (`SHARE.pages`).

---

## Hypothetical

The **Hypothetical** tab (Tools) is where you try changes before making them. Three ways in:
a **hypothetical trade** between any two teams (set it up exactly like the calculator, then
*Process trade*), a **waiver / free-agent** move (pick someone to sign and, if the roster is full,
who to drop), and a **sandbox** that makes any single move on any roster.

Each trade, pickup or move is one entry in a log (`HYP.log` in `js/hypothetical.js`). Ownership
for the rest of the app (`HYP.moves` / `HYP.picks`) is replayed from that log over the real league,
so a whole trade is undone in one click, and undoing a change also removes later ones that moved
the same players. Nothing is sent to Sleeper, and *Reset everything* restores the league exactly.

While any change is in effect a slim banner at the top of the other pages lists what it is, with
*Manage* and *Reset*; pages that are pure results (This Week, Active Rankings, Draft Board) say so
instead. Trade History lists every processed hypothetical trade at the top, graded like a real one and
marked **Hypothetical**, with its own *Undo*; they are kept out of every figure on that page. At the top of the Hypothetical page the headline numbers for any affected
team (playoff and title odds, projected wins, lineup points, power rank, capital) show before and
after, from the same simulated seasons run on the same random draws, plus who else in the league
moved the most. The simulations run in the background, so the page never waits on them.
