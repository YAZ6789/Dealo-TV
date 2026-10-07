# Dealo TV

A futuristic personal TV tracker. Everything you've watched, what you're in the middle of, what you want to watch, what you never want recommended — plus a recommendation engine that actually learns your taste.

It's a static site: build it once and host the `dist/` folder anywhere.

## Highlights

- **Four ways to browse** (Home screen "designs"), each usable with any skin:
  - **Holo Ring** — a 3D rotating carousel on a holographic platform, with data panels for the show in front. Drag, scroll, ← → or click to spin; Enter opens.
  - **Constellation** — your taste as a star map. You're the core; your library orbits close (loved = closer), recommendations float in the discovery field (better match = closer) with beams back to the show that inspired them. Pan, zoom, hover.
  - **Warp Tunnel** — fly down a neon corridor through your history (with glowing year gates) or into your recommendations. Scroll / ↑ ↓.
  - **Stream** — classic streaming rows with a hero billboard and "Because you watched …" shelves.
- **Four skins** — Cyan HUD, Neon, Aurora, Phosphor (terminal). Each has its own switch-over effect (scan sweep, glitch cut, light bloom, CRT power cycle).
- **Lists** — Watching, Watchlist, Watched, On hold, Dropped, and *Not interested* (never recommended again).
- **Episode tracking** — tick episodes, "watched up to here", whole seasons, "next up S2·E7", upcoming air dates.
- **Ratings & stats** — 10-segment ratings, hours watched, activity heatmap, streaks, taste by genre, completion rate, hall of fame.
- **Smart recommendations** — explained ("Because you loved Dark · From Vince Gilligan · Dystopia"), tunable (adventurousness, hidden gems vs mainstream, moods, languages, era, max seasons), with 👍 / ⊘ feedback.
- **Google Sheets / Excel / CSV import** — paste a sheet link; columns, statuses, ratings (any scale) and "S2E5"-style progress are auto-detected; every match is reviewable; re-sync any time.
- **Search & commands** — `Ctrl/⌘ K` or `/`.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build → dist/
npm test           # unit tests (recommender, importer, stats, layout, catalog)
```

## Host it anywhere

`npm run build` produces a self-contained `dist/` folder. Upload it to any static host — it uses hash-based URLs (`/#/library`) and relative asset paths, so **no rewrite rules or server config are needed**, and it works from a sub-folder.

- **Netlify / Cloudflare Pages / Vercel** — build command `npm run build`, output directory `dist`.
- **GitHub Pages** — push `dist/` to a `gh-pages` branch (or use the Pages "GitHub Actions → Static HTML" workflow pointing at `dist`).
- **Any web server / S3 / NAS** — copy `dist/` into a public folder.

## Connect your Google Sheet

1. In Google Sheets: **Share → General access → Anyone with the link → Viewer**.
2. In Dealo: **Settings → Import → Google Sheets**, paste the link, optionally list tab names (e.g. `Watched`, `Want to watch` — a tab name like that becomes the default status for its rows).
3. Check the detected columns, review the matches, import.

**It stays in sync.** The sheet is remembered and re-read automatically when Dealo opens, whenever you come back to the tab, and every 15 minutes while it's open (or hit **Sync now**). Only what you *changed in the sheet* since the last sync is applied — new rows are added, edited cells update the show, progress never moves backwards, and edits you made in the app to rows you didn't touch in the sheet are kept. Rows it can't match confidently are held back with a **Review** prompt. Deleting a row from the sheet doesn't remove the show from your library. Auto-sync can be switched off per sheet in **Settings → Import**.

Recognised columns (any order, any reasonable header): title, status, season, episode, progress (`S2E5`, `2x05`, `Season 2 Episode 5`), rating (out of 5, 10 or 100, stars, `8/10`, `85%`), notes, year, genre, platform, started / finished dates, favourite, watched? (yes/no checkbox), TMDB / IMDb ids. Status words like *finished, done, ✓, watching, want to watch, on hold, dropped, not interested* are understood. Your browser reads the sheet directly; nothing is uploaded anywhere.

Excel (`.xlsx`) and CSV files work the same way (every sheet in a workbook is offered).

## Show data: built-in catalog, TVmaze, TMDB

- **Without any key** Dealo uses a built-in catalog of 309 shows (hand-tagged with themes so recommendations work offline) plus [TVmaze](https://www.tvmaze.com/api) for search, posters and episode lists.
- **With a free TMDB key** (Settings → Show data) you get every show ever made, backdrops, trailers, where-to-stream, and TMDB's "people also liked" data feeding the recommender. Get one at <https://www.themoviedb.org/settings/api> (the "API Read Access Token" works best). The key is stored only in your browser. "Re-link now" moves catalog/TVmaze/sheet entries onto TMDB ids.
- Deploying your own copy for yourself? You can bake a key in at build time with `VITE_TMDB_KEY=… npm run build` — note it will be visible in the published JavaScript.

## How the recommendations work

`src/recommend/` — a hybrid recommender, all client-side:

1. **Signals** — every library entry becomes a weighted positive or negative signal: your rating dominates; otherwise status, how far into the show you are, binge velocity, favourites and rewatches; older signals decay. 👍 "more like this", ⊘ "not interested" and dropped shows count too.
2. **Taste profile** — shows are embedded as IDF-weighted feature vectors (genres, themes, creators, cast, network, language, era, length), so a shared creator or a rare theme counts for more than "both are dramas". Likes and dislikes form two separate vectors.
3. **Scoring** — similarity to what you like, co-occurrence in "people also liked" lists of your favourites, Bayesian-shrunk quality, a mainstream ↔ hidden-gem dial, your hard preferences, and a penalty for resembling what you disliked.
4. **Re-ranking** — Maximal Marginal Relevance keeps the top picks varied, plus a few "wildcard" slots (scaled by Adventurousness).
5. **Two-stage** with TMDB — candidates come from your top shows' recommendation lists, trending, top-rated and genre-targeted discovery; the best ~60 are then enriched with full metadata and re-ranked.
6. **Explanations** — the strongest influencing show and the shared traits behind every pick. The Taste page shows what it learned and lets you correct it.

## Your data

Everything is stored in your browser (`localStorage`; metadata cache in IndexedDB). Use **Settings → Export backup** to move between browsers or keep a copy.

**Cloud sync later:** all persistence goes through one interface, `StorageAdapter` in `src/store/storage.ts` (`load` / `save` / optional `subscribe`). Adding sync (e.g. Supabase with a `libraries` table keyed by user id and row-level security) means writing one adapter and passing it to `initLibrary()` — the store and UI don't change. The library document is versioned and newer-wins merging already exists (`mergeDoc`).

## Keyboard

| Keys | Action |
| --- | --- |
| `Ctrl/⌘ K`, `/` | Search & commands |
| `Alt D` / `Alt T` | Next design / next skin |
| `← →` | Spin the Holo Ring |
| `↑ ↓` | Fly the Warp Tunnel |
| `Enter` | Open the focused show |
| `Shift Enter` | Add a search result to your watchlist |

## Project layout

```
src/
  designs/      Holo Ring, Constellation, Warp Tunnel (+ shared HUD & collections)
  pages/        Home (Stream), Discover, Library, Show, Stats, Taste, Settings, Import, Welcome
  components/   cards, rows, rating bar, episode tracker, charts, command palette, switcher…
  recommend/    features, profile, engine, shelves, pipeline (+ tests)
  import/       Google Sheets / Excel / CSV parsing, column detection, matching, merge plan (+ tests)
  providers/    TMDB, TVmaze, built-in catalog, artwork lookup, cache
  store/        library (zustand), settings, storage adapter, enrichment, TMDB re-link
  stats/        stats computation (+ tests)
  styles/       base, components, pages, designs, transitions, themes/{hud,neon,aurora,terminal}.css
  data/         built-in catalog
```

Picked a favourite design or skin? Each design is one file in `src/designs/` (+ its section of `styles/designs.css`) and each skin is one file in `src/styles/themes/` (+ its entry in `src/theme/themes.ts`), so trimming the others is straightforward.

## Credits

Show metadata from [TMDB](https://www.themoviedb.org) (this product uses the TMDB API but is not endorsed or certified by TMDB) and [TVmaze](https://www.tvmaze.com) (CC BY-SA). Streaming availability data by JustWatch via TMDB.
