# Dynasty Command Center

Live analysis for Sleeper dynasty leagues, served as a static site at
**[fantasy.johnsencorey.com](https://fantasy.johnsencorey.com)**.

Rosters and values, a trade calculator, power rankings, active standings, a trade
finder, a season simulator with a playable single-season replay, the draft board,
stock-mode value charts, per-player pages, and a hypothetical roster sandbox that
recomputes every page as if your moves had happened.

It works for **any** Sleeper league — enter a username or a league ID on the first
screen.

---

## How it works

Everything runs in the visitor's browser. There is no server, no build step and no
API key. `index.html` is a single self-contained file; the other files are icons
and site metadata.

| Source | What it provides |
|---|---|
| `api.sleeper.app/v1/…` | league settings, managers, rosters, weekly matchups, drafts, traded picks, transactions |
| `api.sleeper.app/projections/…` | Rotowire weekly projections, with opponent, byes omitted |
| `api.fantasycalc.com/values/current` | dynasty and redraft trade values, 30-day trends, draft-pick values |

All three send permissive CORS headers, which is why a plain static host works.
League format (superflex vs 1QB, team count, PPR) is detected from the league
itself, and weekly projections are re-scored through that league's own
`scoring_settings` rather than Sleeper's generic presets.

Responses are cached in the visitor's own browser — the player database for 12
hours (IndexedDB), weekly projections for 6 hours (IndexedDB), trade values for 4
hours (localStorage). Stock mode also records one value snapshot per visit, so the
value charts accumulate real observed history over time.

**Nothing is uploaded anywhere and there are no secrets in this repo.** Sleeper's
API is public and read-only; the app only ever reads.

---

## Deploying

Already configured for GitHub Pages on a custom subdomain. From scratch:

1. Push this repo to GitHub (public — Pages on a private repo needs a paid plan).
2. **Settings → Pages → Source:** *Deploy from a branch*, `main`, `/ (root)`.
3. **Settings → Pages → Custom domain:** `fantasy.johnsencorey.com`
   (the `CNAME` file in this repo already declares it).
4. Add one DNS record where `johnsencorey.com` is managed:

   | Type | Name | Value | TTL |
   |---|---|---|---|
   | CNAME | `fantasy` | `coreyjohnsen.github.io.` | 300 |

5. Once the certificate provisions — usually minutes — tick **Enforce HTTPS**.

Two things that catch people out:

- The DNS target is **`coreyjohnsen.github.io`**, the *user* Pages host, not the
  repo name. GitHub routes to the right repo by matching the `CNAME` file.
- A repo can only carry **one** custom domain, which is why this lives in its own
  repo rather than a folder inside the personal site.

### Updating

Replace `index.html`, commit, push. GitHub Pages serves with a ten-minute cache,
so allow a few minutes before a hard refresh shows the change.

---

## Files

| File | Why it's here |
|---|---|
| `index.html` | The whole application. Self-contained: all CSS and JS inline, no dependencies. |
| `CNAME` | Tells GitHub Pages which custom domain serves this repo. |
| `.nojekyll` | Skips Jekyll processing — nothing here needs it, and it makes deploys quicker. |
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
actions, focus), and the `--s1…--s8` / `--seq-*` data palette that charts and position
pills read from, so a chart never changes meaning with the theme. Light, dark and
*Auto* all resolve through the same tokens.

- **Default** and **Minimal** views are one switch (`data-ui` on the root). Default is
  roomier with photos; Minimal tightens table density and drops imagery.
- Under 900px the sidebar becomes a bottom tab bar (Home · Week · Rosters · Players ·
  More), with every page one tap behind **More**.
- **Accent colour** is one hue (`--hue`, set by `data-accent` on the root) from which every
  brand token — buttons, links, focus, sidebar tint, home banner, landing page — is derived
  with `oklch()`. Seven themes ship (Indigo, Ocean, Lagoon, Emerald, Sunset, Rose,
  Graphite); the choice is stored in the visitor's browser. Adding one is a single CSS line
  plus an entry in `ACCENTS`.
- Navigation icons are inline SVG (`ICON` in the script); there are no icon fonts, web
  fonts or other dependencies.

---

## Trade finder

For every partner it builds candidate trades from two sources: an enumeration of
common shapes (1-for-1, 2-for-1, 1-for-2, and 3-for-1 / 1-for-3 in the shape modes),
and an assembly step that starts from each side's actual needs (the holes and
surpluses from GM Scout) and builds 2-for-2 / 3-for-2 packages around them. Each
candidate must clear four checks, then is ranked:

- **Value balance** — within the chosen tolerance after a stud premium: a package's
  best player counts in full, each further player for less (picks count in full).
- **Roster fit** — a side that lands more players than it sends must cut down to its
  active limit. The cheapest bench players are cut, the cost is priced in, and the
  card says who goes. A trade with nobody left to cut is dropped.
- **Both sides gain** on their own objective (contend / rebuild / balanced).
- **Market angle** — trades that sell a flagged player or buy one rank higher.

**Buy low / sell high.** A player is flagged when his scoring and his price disagree
by more than week-to-week noise allows (variance for his position, shrinking with
games played, calibrated against this league's own median), or from an age cliff. A 30-day
value move only reinforces another signal; it never flags anyone alone. Players who
are out, doubtful, suspended or on injured reserve are never flagged: their price is
explained by the injury, and they cannot help this season. Each suggestion also lists, in words, why it works.

**On the Players page** the same flags appear as tags beside each name, with Market
(Buy low / Sell high) and Timeline (Win now / Rebuild) filters, two sortable columns,
and a *Win now vs rebuild* section. A player is **win now** when his redraft rank is
at least 40% and six places better than his dynasty rank — worth more this season than
over the long run — and **rebuild** when it is the other way round. Compared by rank so
the two prices' scales don't matter. Dynasty leagues only; a redraft league has no long
run to compare against. The player page explains any flag in words.

---

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
