# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

占星骰子 (astro-dice) — a single-page, zero-dependency static web app for a "five astrology dice" divination method, with dual-tradition (Western vs. Vedic) interpretation. Chinese (zh-Hant) UI and code comments throughout. Deployed via GitHub Pages at `dices.3minstest.com` (see `CNAME`); mirrored at `http://rightone.3minstest.com/astro-dice/`.

## Running locally

No build step, no package manager, no dependencies. Just open the HTML file:

```bash
python -m http.server 5180   # then visit http://localhost:5180/app.html
```

(`.claude/launch.json` defines this same launch config.) Or simply double-click `index.html` to open it directly in a browser.

There is no test suite, linter, or CI build/test pipeline in this repo. The only automated GitHub Action (`.github/workflows/update-ephemeris.yml`) regenerates `ephemeris.json` daily and commits it directly to `main`.

## Repo layout

- **`index.html` / `app.html`** — the app itself. **These two files are kept byte-identical** (verify with `diff index.html app.html` before committing) — `index.html` is the GitHub Pages entry point, `app.html` is a duplicate used elsewhere in links; when editing one, copy the change to the other.
- **`guide.html`** — standalone user-facing usage guide/onboarding page, self-contained styles, no shared JS with the app.
- **`ephemeris.json`** — generated data file (~5 MB), not hand-edited. Covers 2018-01-01 to 2051-01-01 at 6-hour resolution: tropical (`T`) and sidereal Lahiri (`S`) sign indices plus retrograde flags (`R`) per planet, used to auto-fill "current transit" positions in the app.
- **`tools/update_ephemeris.py`** — regenerates `ephemeris.json` using `pyswisseph`. Run via `python tools/update_ephemeris.py` (deps in `tools/requirements.txt`). `tools/update_ephemeris_parallel.py` is a multiprocessing variant (8 workers, chunked by year range, merged/sorted by timestamp) for faster local regeneration — same output format as the serial version.
- **`worker/`** — an optional, separately-deployed Cloudflare Worker (`dices-log-worker.js` + `wrangler.toml`) that receives dice-roll records POSTed from the front end and writes them into a Notion database (bypasses browser CORS restrictions on the Notion API). Deployed independently via `npx wrangler deploy` from inside `worker/`; see `worker/README.md` for full setup (Notion integration token, DB connection, secrets). Not part of the main app's build/deploy — it's wired in at runtime via a `?worker=<url>` query param that gets cached to `localStorage`.
- **`example-reading.pdf`** — sample output artifact, not code.

## Architecture of `index.html`/`app.html`

This is a large (~4400 line) single-file app: HTML + inline CSS + two `<script>` blocks, no modules/bundler/framework. When making changes, find the right section by grepping for the relevant function or data table name rather than reading top-to-bottom.

### Data model (top of first `<script>`, ~line 1025+)

Static reference tables that drive nearly all interpretation logic:
- `PLANETS`, `SIGNS` — the 12 dice planets (10 classical/modern + Rahu/Ketu) and 12 zodiac signs.
- `TRADITIONAL_RULER` / `MODERN_RULER` — classical rulership (shared by both traditions) vs. modern rulership (Western-only: Pluto/Uranus/Neptune).
- `EXALTATION`, `FALL`, `DETRIMENT` — planetary dignity tables. `dignity(planetId, signId, system)` is the shared lookup function; `system` is `'western'` or `'vedic'` and changes which ruler/detriment set applies.
- `WESTERN_HOUSE` / `WESTERN_HOUSE_TITLES` / `WESTERN_HOUSE_DESC` vs. `VEDIC_HOUSE` — **the two house-meaning systems are intentionally separate and not interchangeable**; results pages label output `【西洋觀點】` vs `【印度觀點 Vedic】` and never merge them.
- `HOUSE_TYPE` (Kendra/Trikona/Dusthana/Upachaya — Vedic-only house classifications), `MALEFICS_TRADITIONAL`/`MALEFICS_MODERN`, `DUAL_RULERSHIP`, `RULE3_WEAK` — Vedic-specific rule tables consumed by the `rule1_*`/`rule2_*`/`rule3_*` functions (~line 2482+) that implement specific horary/dasha-adjacent checks (malefics in 8th house, dual rulership, weak-malefic detriment, etc.).

### Core flow

1. **Dice roll / manual entry** — `rollAstroDice()`, `_snapshotDice()`, `reRollDice()`, `compareWithLastRoll()`. Five dice: planet A, sign A, house (sets ascendant), planet B, sign B (sub-die house is derived, whole-sign: `houseOfSign()` = `(signB − ascSign) mod 12 + 1`).
2. **Alternate input methods** — `setupImageInput()`/`applyRecognition()` (photo/screenshot recognition via a user-supplied Anthropic API key stored in `localStorage` as `gemini_api_key`, sent client-side, never uploaded elsewhere) and `setupVoice()`/`parseVoice()` (Web Speech API + regex parsing of Chinese planet/sign vernacular names).
3. **Chart computation** — `ascSignId()`, `houseOfSign()`, `houseTypeTags()`, `renderRashiChart()` (whole-sign chart rendering), `aspectsHTML()`/`countAspect()` (aspect detection), `detectReception()`/`renderReception()` (mutual reception between traditions).
4. **Transit overlay** — `loadCurrentTransits()`, `findClosestPoint()`, `getSelectedTransitTimestamp()` read `ephemeris.json` to overlay current planetary transits (six "major transit stars") onto the reading, with malefic-house warnings.
5. **Interpretation rendering** — `renderAIQuickRead()`, `renderVedicRules()`, `houseChartHTML()`, `flyingHousesHTML()`, `renderThreeEngines()` (三大引擎), `renderReception()` build the on-page interpretation panels, always split into parallel Western/Vedic sides.
6. **Deep-dive prompt export** — `buildPromptWestern()` / `buildPromptVedic()` construct structured prompts (five fixed diagnostic questions, dignity/reception/transit context baked in) that the user copies into pre-configured NotebookLM notebooks (separate notebooks per tradition) for deeper AI-assisted reading. `renderAIDeepRead()` handles the parsed-response UI once the user pastes results back in.
7. **Export/persistence** — `exportPlainText()`/`exportMarkdown()`/`exportDownload()`/`mxExportPDF()` etc. for saving a reading; `getUser()`/`getRecords()` + Google Identity Services sign-in persist roll history to `localStorage` (`dices_user`, `dices_records_v1`), optionally also POSTed to the Cloudflare Worker (`worker/`) for Notion logging when `?worker=<url>` has been set once.
8. **`run()`** (~line 3248) is the main "compute and render everything" entry point invoked after a roll or on config changes. `init()` (~line 1952) wires up the page on load; `switchTab()` handles the tabbed UI.

### Conventions

- Everything is vanilla JS/DOM (`document.getElementById`/`$()` helper), no reactive framework — UI updates are done by directly setting `innerHTML`/text on rendered sections, then re-invoking the relevant `render*()` function.
- User-facing strings, comments, and data (house meanings, planet names, etc.) are Traditional Chinese; keep new code consistent with this.
- Any new Western-vs-Vedic distinction must be added to **both** trees of tables/logic and rendered on **both** the western and vedic sides — never merge the two systems' meanings into one shared table.
- Config/URL-param one-time setup pattern used throughout: read a `?param=` query string once, persist to `localStorage`, then strip it from the URL — see the `?worker=`, `?gid=`, `?k=`, `?tg_bot=`/`?nas=`/`?drive=`/`?sheet=`/`?report=` handlers for the pattern to follow when adding a new integration.
- `index.html` and `app.html` must stay identical — any edit to one must be mirrored to the other.
