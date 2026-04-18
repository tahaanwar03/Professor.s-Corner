# Prof's Corner — Trading Journal: Complete Feature & Function Reference

> **Version:** Phase 5 (P5) · **File:** `Prof_s_Corner_P5.html` · **Size:** ~7,400 lines, 367 KB  
> **Stack:** Single-file vanilla HTML/CSS/JS · Chart.js · localStorage · Anthropic API

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Data Model & Storage](#2-data-model--storage)
3. [Application Pages](#3-application-pages)
   - 3.1 [Dashboard — TERMINAL](#31-dashboard--terminal)
   - 3.2 [Weekly Plan](#32-weekly-plan)
   - 3.3 [Execution History — All Trades](#33-execution-history--all-trades)
   - 3.4 [Log Trade — New Execution Log](#34-log-trade--new-execution-log)
   - 3.5 [Share Card](#35-share-card)
   - 3.6 [Daily Journal](#36-daily-journal)
   - 3.7 [Mistakes Library](#37-mistakes-library)
   - 3.8 [Monthly Review — Self-Assessment](#38-monthly-review--self-assessment)
   - 3.9 [My Rulebook](#39-my-rulebook)
   - 3.10 [Settings](#310-settings)
4. [Dashboard Stat Cards](#4-dashboard-stat-cards)
5. [Dashboard Bento Grid — All Charts](#5-dashboard-bento-grid--all-charts)
6. [Right Sidebar — Live Evaluation Panel](#6-right-sidebar--live-evaluation-panel)
7. [Modals & Overlays](#7-modals--overlays)
8. [AI Features](#8-ai-features)
9. [Core Engine Functions](#9-core-engine-functions)
10. [Chart Rendering Functions](#10-chart-rendering-functions)
11. [Data Operations](#11-data-operations)
12. [UI & Utility Functions](#12-ui--utility-functions)
13. [Keyboard Shortcuts](#13-keyboard-shortcuts)
14. [Performance & Debug Modes](#14-performance--debug-modes)
15. [Print / PDF Export](#15-print--pdf-export)
16. [Design System & Tokens](#16-design-system--tokens)

---

## 1. Architecture Overview

Prof's Corner is a **completely self-contained, single-file trading journal**. There is no server, no database, no login. Everything lives in one `.html` file and persists through the browser's `localStorage` API.

### Why single-file?

- **Portable** — open from a USB drive, Dropbox, or any local folder. Works offline forever.
- **Private** — your trade data never leaves your machine.
- **Zero install** — no Node, no Python, no Docker. Open in Chrome/Edge/Firefox and it runs.

### Technology stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Structure | HTML5 | Page skeleton, SPA routing |
| Styling | CSS3 custom properties | Design tokens, responsive layout |
| Logic | Vanilla ES6+ JavaScript | All business logic, rendering, state |
| Charts | Chart.js 4 + chartjs-plugin-annotation | All canvas-based analytics |
| Fonts | Google Fonts (Space Grotesk, Geist, JetBrains Mono) | Typography system |
| Icons | Material Symbols Outlined | All iconography |
| AI | Anthropic Claude API (claude-sonnet-4-20250514) | AI Coach + AI Notes |
| Storage | browser `localStorage` | All persistent data |

### Single-Page Application routing

Navigation works by toggling CSS class `.active` on `<div class="page">` elements. Only one page div is visible at any time. `showPage(id)` handles the transition and triggers the correct render function for the destination page.

---

## 2. Data Model & Storage

All data is serialised as JSON and stored under named keys in `localStorage`.

### localStorage Key Map

| Constant | Key String | Data Type | Contents |
|----------|-----------|-----------|----------|
| `TK` | `profsCorner_v1_trades` | `Trade[]` | All trade records |
| `WK` | `profsCorner_v1_weeks` | `Week[]` | Weekly plan records |
| `MK` | `profsCorner_v1_models` | `string[]` | User's model/setup list |
| `SK` | `profsCorner_v1_settings` | `Settings` | Account settings |
| `BK` | `profsCorner_v1_backups` | `Snapshot[]` | Auto-backup ring buffer |
| `RBK` | `profsCorner_v1_rulebook` | `Rule[]` | Personal rulebook entries |
| `SAK` | `profsCorner_v1_assessments` | `Assessment[]` | Monthly self-assessments |
| `JK` | `profsCorner_v1_journal` | `JournalEntry[]` | Daily journal entries |
| `GK` | `profsCorner_v1_goals` | `Goals` | Monthly performance goals |
| `SEED_KEY` | `profsCorner_v1_seeded` | `"1"` | Flag — prevents re-seeding demo data |

### Trade Object Schema

Every logged trade is stored as a JavaScript object with the following fields:

```js
{
  id:           string,      // Unique ID (timestamp string or 'csv_...')
  date:         string,      // ISO date 'YYYY-MM-DD'
  pair:         string,      // Symbol e.g. 'EURUSD', 'NQ1!'
  model:        string,      // Setup/model name e.g. 'OB', 'FVG'
  bias:         string,      // 'Aligned' | 'Not Aligned' | 'Counter'
  dir:          string,      // 'Long' | 'Short'
  outcome:      string,      // 'Win' | 'Loss' | 'Breakeven'
  sess:         string,      // 'Asia' | 'London' | 'NY' | 'Other'
  rr:           number,      // R-multiple (always positive, e.g. 2.5)
  entry:        number|null, // Entry price
  sl:           number|null, // Stop loss price
  tp:           number|null, // Take profit price
  exec:         string,      // Execution / post-trade analysis notes
  emo:          string,      // Emotional state notes
  thesis:       string,      // Pre-trade thesis (Phase 2)
  whatHappened: string,      // Post-trade narrative (Phase 2)
  lesson:       string,      // Key lesson (Phase 2)
  mistakeTags:  string[],    // Tagged mistake types e.g. ['Early Entry']
  slManagement: string,      // 'Initial' | 'Moved to BE' | 'Trailed' | etc.
  newsFlag:     boolean,     // High-impact news present
  tvLink:       string,      // TradingView chart URL
  habitScore:   number|null, // Process checklist score 0-6
  dollarPnl:    number|null, // Actual dollar P&L (optional manual entry)
  imgs:         string[],    // Base64 chart images (max 5)
  quickCapture: boolean,     // True if logged via Quick Capture
  csvImport:    boolean      // True if imported via CSV
}
```

**User benefit:** This rich schema means every dimension of a trade — the setup, the psychology, the process discipline, the actual numbers — is captured. Over time this dataset powers every analytic in the journal.

### Week Object Schema

```js
{
  id:        string,   // Timestamp ID
  start:     string,   // 'YYYY-MM-DD' (Monday)
  end:       string,   // 'YYYY-MM-DD' (Friday)
  outlook:   string,   // Market outlook narrative
  keylevels: string,   // Key price levels text
  mon–fri:   string,   // Per-day bias/notes
  prevPerf:  string,   // Previous week performance notes
  imgs:      string[]  // Chart images
}
```

### Settings Object Schema

```js
{
  accountName:    string,  // Display name e.g. "Prof's Corner"
  balance:        number,  // Account balance in currency units
  currency:       string,  // Currency symbol e.g. '$', '£', '€'
  riskPct:        number,  // Risk per trade as % of balance
  maxDailyTrades: number,  // Circuit breaker: max trades per day
  maxDailyLossR:  number   // Circuit breaker: max loss in R per day
}
```

---

## 3. Application Pages

### 3.1 Dashboard — TERMINAL

**Navigation:** `D` key · Sidebar icon: `dashboard`  
**Render function:** `renderDashboard()`

The dashboard is the journal's command centre. It renders automatically every time a trade is added, edited, deleted, or the period filter changes. It is split into three columns:

- **Left: dash-main** — stat cards + bento chart grid + AI coach
- **Right: dash-right** — live evaluation panel + profit calendar

#### Period Filter

Four buttons at the top right: **Week**, **Month** (default), **90D**, **All**. Selecting a period calls `setPeriod(p)`, which stores the selection in `period` and re-runs `renderDashboard()`. All charts, stat cards, and analytics update to reflect only trades within the selected window.

**User benefit:** Switch between short-term (week) and long-term (all-time) views to understand both your current form and your career-level edge.

---

### 3.2 Weekly Plan

**Navigation:** `W` key · Sidebar icon: `calendar_month`  
**Render function:** `renderWeeklyPlan()`

A structured pre-market planning tool. Each week gets its own card (chip) displaying:

- Date range (Mon–Fri)
- Market outlook summary (truncated)
- W / L / R performance stats for trades that fall in that week
- Thumbnail previews of attached chart images
- **AI-generated review prompts** — up to 3 contextual questions automatically generated from that week's trade data

#### Creating / editing a week plan

Click **New Week** to open the inline editor. Fields:

| Field | Purpose |
|-------|---------|
| Week Start / End | Date range (auto-fills to next working week) |
| Market Outlook | Macro bias, key events, expected behaviour |
| Key Levels | Support/resistance zones to watch |
| Mon / Tue / Wed / Thu / Fri | Per-day directional bias and notes |
| Previous Week Performance | Reflection on last week |
| Chart Images | Upload up to 5 charts (drag-drop or browse) |

Click a chip to open the **Week View modal** — a full read-only view with all fields, embedded stats for that week's trades, and an **Edit Week** button.

#### Drag-to-reorder

Week chips support drag-and-drop reordering. Drag a chip by its header and drop it onto another to swap positions.

#### AI-generated weekly review prompts

`generateWeeklyPrompts(weekData)` analyses each week's trades automatically and surfaces up to 3 pointed questions, for example:

- *"3 of your losses came from the NY session. Is this session aligned with your edge?"*
- *"'Early Entry' appeared 2 times this week. Write one rule that prevents it."*
- *"64% win rate this week — counter-trend trades had a 33% WR. Are these in your playbook?"*

**User benefit:** Instead of staring at a blank "review" box, you get specific, data-driven prompts that force honest self-examination.

---

### 3.3 Execution History — All Trades

**Navigation:** `T` key · Sidebar icon: `list_alt`  
**Render function:** `renderTradesTable()`

A fully sortable, filterable table of every logged trade.

#### Filtering

- **Outcome filter:** All / Win / Loss / Breakeven
- **Session filter:** All / Asia / London / NY / Other
- **Search box:** Real-time search by pair name or model/setup name

All filters combine. When a filter is active, a stats strip appears above the table showing the filtered subset's WR, Net R, P/F, trade count, and avg winner — without affecting the main dashboard numbers.

Filter state is persisted to `sessionStorage` so it survives page switches within the same session.

#### Sorting

Click any column header to sort. Click again to reverse. Sortable columns: Date, Pair, Outcome, R multiple.

#### Inline edit

Click the ✏️ button on any row to expand an inline edit form directly inside the table — no modal. Fields: Date, Pair, Direction, Outcome, Model, R:R, Session, Execution Notes, Emotions Notes, Charts. Changes are saved back into the trade without disrupting any other rows.

While the inline form is open, the dashboard live-previews the stat impact of your changes in real time.

#### Expandable row

Click any row (not the edit button) to expand a detail panel showing Execution Notes, Emotions Notes, entry/SL/TP prices, computed R:R from prices, dollar P&L, habit score dots, and chart images.

#### Delete

The ✕ button triggers a custom confirmation dialog before permanently removing the trade.

---

### 3.4 Log Trade — New Execution Log

**Navigation:** `N` key · Sidebar icon: `edit_note`  
**Render function:** form is static HTML; submission via `addTrade()`

The primary data-entry form, organised into three tabbed phases.

#### Phase Tabs

**Before** | **After** | **Process**

You can switch tabs mid-entry. The form remembers your inputs.

#### Phase 1 — Before (Market Parameters)

| Field | Description |
|-------|-------------|
| Date | Defaults to today |
| Pair | Symbol, auto-uppercased |
| Direction | Long / Short segmented control |
| Bias (HTF) | Aligned / Slightly Aligned / Not Aligned / Counter — your higher timeframe alignment |
| Session | Asia / London / NY / Other |
| Model / Setup | Select from your personal model list |
| Outcome | Win / Loss / Breakeven |
| R Multiple | The R achieved (absolute number) |
| Entry / SL / TP | Optional price levels for auto-R calculation |

**Auto-R preview:** When Entry, SL, and TP are all filled in, a live label appears showing the mathematically computed R:R. This cross-checks your stated R against the actual prices.

#### Phase 2 — After (Narrative Context)

| Field | Description |
|-------|-------------|
| Pre-Trade Thesis | What you expected to happen before entry |
| What Actually Happened | Candid description of the trade's execution and outcome |
| Key Lesson | The one thing to remember from this trade |
| Mistake Tags | Multi-select tags for error types: Early Entry, Late Entry, Oversized, FOMO, Revenge, Moved SL, Poor Target, Broke Rules |

#### Phase 3 — Process (Discipline Checklist)

Six binary habit checkboxes:

1. Waited for session open
2. Checked HTF structure
3. Correct position size
4. No revenge / FOMO
5. Valid model / setup
6. Waited for confirmation
7. Calm & focused state *(spans full width)*

A **habit score pill** updates in real time (e.g. *4/6 — Discipline score*) as you tick items. This score is stored with the trade and powers the Process vs Outcome chart.

#### Execution Notes section

| Field | Description |
|-------|-------------|
| Post-Trade Analysis | Free-text notes about confluences, entry rationale, what you saw |
| AI Draft Notes button | Calls Claude to auto-draft your analysis from the filled fields |
| SL Management | Tag how you managed your stop: Initial / Moved to BE / Trailed / Widened / Early Exit |
| TradingView Chart Link | URL to your chart snapshot |
| High-impact news toggle | Flag if news was present at time of trade |

#### Technical Evidence

Drag-drop or browse to attach up to 5 chart images. Images are stored as base64 strings inside the trade object. They appear as thumbnails in the trade table and open in fullscreen on click.

#### Live preview bar

At the bottom of the form, a bar shows what your Win Rate, Net R, trade count, and Profit Factor will look like *after* saving this trade. Updates live as you change Outcome and R:R.

#### Saving

`addTrade()` validates required fields (Pair, R multiple), constructs the trade object, appends it to the `trades` array sorted by date, saves to localStorage, triggers an auto-backup check, checks the circuit breaker, and navigates to the Dashboard.

#### Model Manager

A floating **Manage Models** button (bottom-left) opens a small popup to add or remove model names from your personal list. Models persist in localStorage under `MK`.

---

### 3.5 Share Card

**Navigation:** `S` key · Sidebar icon: `share`  
**Render function:** `renderShareCard()`

Generates a polished, downloadable performance card.

#### Controls

- **Period:** Daily / Weekly / Monthly — filters which trades appear on the card
- **PnL Backdrop:** Optional background image behind the card
- **Accent colour:** Six swatches — cyan (default), mint, gold, purple, red, white

#### Card contents

- Account name badge + period label
- Giant P&L figure with glow effect matching the period result
- Date range
- 6-stat grid: Win Rate, Trades, Profit Factor, Best Trade, Worst Trade, W/L split
- Win ratio progress bar
- Last 6 trades streak dots (W/L/B)
- Top 3 pairs by net R

#### Download

**Save as Image** calls `runDownloadCard()` which uses `html2canvas` (via premium.js) to rasterise the card and trigger a PNG download named `profs-corner-YYYY-MM-DD.png`.

**User benefit:** Share your weekly or monthly P&L card on social media or trading communities without revealing your raw trade log. One click, professional output.

---

### 3.6 Daily Journal

**Navigation:** `J` key · Sidebar icon: `book_2`  
**Render functions:** `renderJournalPage()` → `renderJournalList()`, `renderJournalCorrelation()`, `renderJournalMoodFreq()`

A pre/post session mental state log, separate from individual trade notes.

#### Logging an entry

Click **Today's Entry** (or any date in the list) to open the entry form:

| Field | Description |
|-------|-------------|
| Sleep Hours | Hours slept the previous night |
| Focus Score (1–10) | Slider — how sharp you feel today |
| Mental State / Mood | Multi-select mood tags: Sharp, Calm, Distracted, Anxious, Confident, Fatigued, Revenge Mode, In Flow |
| Pre-Session Goals | What you want to achieve today |
| Session Notes | Observations, lessons, market context |

#### Recent Entries list

Shows the last 30 entries. Each entry displays: date, today badge if applicable, mood tags, pre-session goals (truncated), that day's trading P&L (pulled from the trades array), and Focus score.

Clicking any entry reopens it for editing.

#### Focus vs P&L correlation panel

`renderJournalCorrelation()` groups journal entries into three focus buckets — Low (1–4), Mid (5–7), High (8–10) — and calculates the average net R for trades on those days. Shown as a simple comparison list.

**User benefit:** Reveals whether your mental state reliably predicts your trading performance. If Low-focus days show −0.8R average and High-focus days show +1.4R average, the data is telling you to sit out on bad days.

#### Mood Frequency panel

`renderJournalMoodFreq()` counts how often each mood tag has been used across all entries and renders a horizontal bar chart of the top 6. Reveals your dominant emotional patterns as a trader.

---

### 3.7 Mistakes Library

**Navigation:** `M` key · Sidebar icon: `error_outline`  
**Render function:** `renderMistakesPage()`

Aggregates every mistake tag across all trades into a searchable library.

#### How it works

Every `mistakeTags` array from every trade is flattened and counted. Each unique tag gets a card showing:

- Tag name (styled as a red badge)
- Total occurrence count
- Total R lost on trades carrying this tag
- Date of most recent occurrence

Cards are sorted by frequency (most common mistake first).

#### Summary bar

Four stat cards at the top: Total Tagged (total mistake instances), R Lost, Types (distinct mistake categories), Most Common.

#### Navigation badge

The sidebar "Mistakes" item shows a red dot badge with the total count. This is intentionally always visible — a reminder that your mistake library is growing.

**User benefit:** This page converts vague self-criticism ("I trade badly") into specific, measurable patterns ("Early Entry has cost me 8.3R across 12 trades"). You can't fix what you haven't quantified.

---

### 3.8 Monthly Review — Self-Assessment

**Navigation:** Sidebar icon: `assignment_turned_in`  
**Render function:** `renderAssessmentPage()`

A structured monthly self-assessment form, auto-populated with that month's live stats, and archived indefinitely.

#### Form fields

| Field | Description |
|-------|-------------|
| Discipline Score (1–10) | How disciplined were you overall this month? |
| Overall Rating (1–5) | Star-style rating |
| Biggest Lesson | The one thing you're taking forward |
| What Worked | Strategies, habits, or conditions that produced good results |
| What to Fix | Specific, actionable improvements |
| Next Month's Focus | Your primary goal or theme |

#### Auto-populated stats header

The form automatically shows that month's live trade stats: trades taken, win rate, net R, profit factor, average habit score, and total mistake count. These ground the self-reflection in real numbers.

#### Archive

Past assessments appear below the form as collapsed cards, keyed by month (e.g. *2025-03*). Up to the last 6 past months are displayed.

**User benefit:** Month-end reviews are the most high-leverage habit in trading. This page forces structured reflection and builds a longitudinal record of your development as a trader.

#### Print / PDF

The **Print / PDF** button calls `printReport()` → `window.print()`. A dedicated `@media print` stylesheet hides all navigation, interactive elements, and dark backgrounds, rendering only the assessment content on a clean white page. Save from the browser print dialog as PDF.

---

### 3.9 My Rulebook

**Navigation:** `R` key · Sidebar icon: `gavel`  
**Render function:** `renderRulebookPage()`

Your personal trading constitution. A permanent, categorised list of rules you commit to following.

#### Adding a rule

Select a category from the dropdown, write the rule in the text area, and click **Add Rule**. Categories:

| Category | Badge colour |
|----------|-------------|
| Entry | Cyan (primary) |
| Exit | Mint (tertiary) |
| Risk | Red (error) |
| Mindset | Purple |
| General | Grey (outline) |

Each rule is stored with its category and creation date. Rules persist in localStorage under `RBK`.

#### Deleting rules

Each rule card has a **Del** button. Deletion is immediate (no confirmation dialog).

**User benefit:** Most traders know their rules but don't write them down. Having them in the journal means you can review them before each session. When you tag a mistake ("Broke Rules"), you can immediately cross-reference your rulebook to identify exactly which rule was violated.

---

### 3.10 Settings

**Navigation:** `,` key · Sidebar icon: `settings`  
**Render function:** `renderSettingsPage()` → `openSettings()`

#### Account Configuration

| Setting | Description |
|---------|-------------|
| Account Name | Display name used on the share card |
| Account Balance | Used to calculate dollar P&L on the dashboard |
| Currency Symbol | Prefixed to all dollar amounts |
| Risk % Per Trade | Used for Kelly calculation and dollar stat card |
| Max Daily Trades | Circuit breaker threshold |
| Max Daily Loss (R) | Circuit breaker threshold |

#### Half-Kelly Position Size Calculator

`renderKellyPanel()` reads all-time trade history and computes:

- **Full Kelly %** — the mathematically optimal fraction of capital to risk per trade
- **Half Kelly %** — Full Kelly ÷ 2 (industry standard — same expected growth, ~50% lower drawdown)
- **Quarter Kelly %** — conservative sizing for traders still building confidence

Each row shows the percentage and the corresponding dollar amount. Full Kelly is flagged with a ⚠ warning if it exceeds 10%.

Requires 10+ trades to compute. Shows: WR, Avg W, Avg L used in the calculation.

**User benefit:** Removes guesswork from position sizing. If your historical edge says you should risk 2.1% per trade (Half Kelly), trading 1% is leaving edge on the table; trading 5% is gambling with your bankroll.

#### Data Management

- **Force Backup Now** — immediately creates a snapshot regardless of the 24-hour timer
- **Restore Backup** — lists the last 7 daily snapshots with timestamps and trade counts. Click restore to roll back to any snapshot after confirmation
- **Export JSON** — downloads a complete JSON backup of all data
- **Import JSON** — restores from a previously exported JSON file

#### CSV Import

Full broker export importer. Three-step flow:

1. **Upload** — select any `.csv` or `.txt` file
2. **Map columns** — each journal field (Date, Symbol, R/P&L, Outcome, Direction, Session, Model, Notes) has a dropdown to select which CSV column maps to it. Auto-detection tries to match by column header name
3. **Preview** — shows a formatted table of the first 8 rows with ✓/✗ validity indicators and a count of how many rows will be imported vs skipped
4. **Confirm** — appends imported trades, sorts by date, saves, and shows a toast with the import count

---

## 4. Dashboard Stat Cards

Five stat cards render at the top of the dashboard. All update on every `renderDashboard()` call.

### Win Rate

**ID:** `sv-wr`  
**Computed:** `wins.length / total * 100`  
Sub-label shows W / L / BE counts. A **delta badge** compares the current period's WR to the previous equivalent period (e.g. this month vs last month) and shows ▲/▼ with the change.

### Profit Factor

**ID:** `sv-pf`  
**Computed:** `sum of winning R / sum of losing R`  
A PF > 1 means the journal is profitable. PF > 2 is considered strong. Shows `∞` when there are no losses.

### Net Return

**ID:** `sv-net`  
**Computed:** algebraic sum of all R values in the period  
Rendered with an odometer animation (digit-by-digit scroll effect). Colour: mint (positive) / red (negative) / default (zero). A sparkline canvas overlays the bottom of the card showing the cumulative equity curve for the period.

### Avg RR — Winners

**ID:** `sv-rr`  
**Computed:** `sum of winning R / win count`  
Sub-label shows total trading day count for the period.

### Dollar P&L (est.)

**ID:** `sv-dollar`  
**Computed:** `net R × (balance × riskPct / 100)`  
Converts R performance into estimated dollar terms using account balance and risk percentage from Settings. Sub-label dynamically shows the actual risk % configured (e.g. *"at 2% risk per trade"*), updated by `updateDollarSubLabel()`.

**User benefit:** Traders who think natively in dollars rather than R can instantly see what their journal performance means in real money terms.

---

## 5. Dashboard Bento Grid — All Charts

The bento grid is a two-column CSS grid of analytics cards. Several cards are switchable (toggle between two views using the buttons in the card header).

### Total Equity Curve

**Canvas:** `c-equity` · **Function:** `renderEquity(arr, s)`  
**Switchable:** Equity | Expectancy | R-Dist

- **Equity** — cumulative R curve from trade 1 to trade N. Each point is the running total after that trade. The zero line is dashed. Hover activates a crosshair with a tooltip showing the trade details, and highlights the corresponding entry in the Live Execution Log panel.
- **Expectancy** — dual-line overlay showing rolling 20-trade expectancy and 50-trade expectancy over time. Reveals whether your edge is stable, improving, or decaying.
- **R-Dist** — R-multiple distribution histogram. Bucketed: <-2R, -2 to -1R, -1R to 0, 0 to 1R, 1R to 2R, 2R to 3R, >3R. Shows count and percentage per bucket. Footer shows avg winner, avg loser, and all-time expectancy.

### Drawdown Waterfall

**Canvas:** `c-drawdown` · **Function:** `renderDrawdown(arr, s)`  
Plots the running drawdown from peak equity at every trade. The deepest valley is the maximum drawdown. Bars are filled red with intensity proportional to depth.

**User benefit:** Visualises risk visually in a way net R cannot. A journal showing +15R net but a -12R max drawdown is very different from one showing +15R with a -3R max drawdown.

### Rolling Win Rate (20T)

**Canvas:** `c-rolling` · **Function:** `renderRolling(arr)`  
A 20-trade rolling window win rate plotted as a line over time. A dashed 50% reference line marks the breakeven win rate (assuming 1:1 RR, which most traders exceed). 

**User benefit:** Reveals hot streaks and cold spells. If rolling WR has been below 40% for the last 30 trades, something has changed — it's time to review.

### Time Performance

**Canvas:** `c-monthly` / `c-weekday` · **Switchable:** Mo | Day  
**Functions:** `renderMonthly(arr)`, `renderWeekday(arr)`

- **Monthly** — grouped bar chart of net R by calendar month. Win months green, loss months red. Immediately shows seasonality.
- **Weekday** — net R grouped by day of week (Mon–Fri). Reveals whether you systematically perform better or worse on certain days.

### Model & Session Distribution

**Canvas:** `c-models` / `c-sessions` · **Switchable:** Models | Sess  
**Functions:** `renderModels(arr)`, `renderSessions(arr)`

- **Models** — doughnut chart of trade count by model/setup. See at a glance which setups you take most.
- **Sessions** — bar or doughnut of trade count by session (Asia / London / NY / Other).

### Expectancy Stats

**Canvas:** `c-streak` / `c-dist` · **Switchable:** Streaks | W/L Split  
**Functions:** `renderStreak(arr)`, `renderDist(arr, s)`

- **Streaks** — win/loss streak frequency distribution. How often do you string together 3W, 4W, 5W? How often do you run 3L, 4L in a row? Click any bar to drill down and see the individual trades in that streak bucket.
- **W/L Split** — side-by-side comparison of average winner size vs average loser size as bars.

Below the streak chart: a **streak dot strip** (last 40 trades) rendered by `renderStreakDots(arr)` — a horizontal timeline of W/L/B dots coloured and sized by result, making patterns visible at a glance.

### Alpha & Strategies

**Canvas:** `c-alpha` / sweet spot · **Switchable:** Alpha | Sweet Spot  
**Functions:** `renderAlpha(arr)`, `renderSweetSpot(arr)`

- **Alpha** — net R breakdown by model. Identifies which setups are genuinely profitable vs those that look good but lose money.
- **Sweet Spot** — 2D scatter/grid of session × model, showing net R in each cell. Identifies the specific combinations where your edge is strongest (e.g. "OB during London = +8.4R") vs where it breaks down.

### HTF Alignment Edge

**Function:** `renderHTFPanel(arr)`  
Three horizontal bar rows — Aligned, Slightly Aligned, Not Aligned / Counter — showing win rate, average R, and trade count for each bias category. Reveals whether your HTF analysis actually adds edge.

**User benefit:** Many traders believe they need HTF alignment but their data shows no difference. This chart tells you the truth.

### Model Performance

**Function:** `renderModelTable(arr)`  
A full table with one row per model showing: trade count, wins, losses, win rate, net R, avg winner, avg loser, and profit factor. Sortable by clicking. Quickly identifies your best and worst performing setups.

### Process vs Outcome

**Function:** `renderHabitScatter(arr)`  
A horizontal bar chart showing average R per habit score bucket (0/6, 1/6, 2/6 ... 6/6). Requires 5+ trades with habit scores.

**User benefit:** If higher habit scores correlate with higher R, you have proof that process discipline improves outcomes. If there's no correlation, your checklist may need revision.

### Emotion → Win Rate

**Function:** `renderEmotionXtab(arr)`  
Scans the `emo` text field of all trades for emotional keywords (confident, calm, FOMO, fear, anxious, revenge, distracted, sharp, tired, focused) and groups trades by detected emotion. Shows win rate and trade count per emotion as a horizontal bar chart.

**User benefit:** Provides evidence for or against the cliché "trade your plan, not your emotions." If trades tagged 'revenge' have a 22% win rate vs 'calm' at 68%, the data speaks for itself.

### Monte Carlo Simulator

**Function:** `renderMonteCarloPanel()` → `runMonteCarlo(arr, 1000)`  
Runs 1,000 Fisher-Yates-shuffled equity simulations using your actual trade outcomes (randomly reordered). Reports:

- Median max drawdown across simulations
- 90th percentile max drawdown
- 95th percentile max drawdown
- Median final equity
- Ruin probability (% of simulations reaching −20R)

Requires 10+ trades. Computation runs asynchronously to avoid blocking the UI.

**User benefit:** Answers "how bad could a bad run of my trades get?" using actual historical data, not theoretical distributions. If the 95th-percentile drawdown is -18R and your account can only withstand -8R, you need to resize.

### Session Heat Map (Session × Day)

**Function:** `renderSessionHeatmap(arr)`  
A grid matrix of Session (Asia/London/NY/Other) × Day (Mon–Fri). Each cell shows net R for that combination, coloured green-to-white-to-red by intensity.

**User benefit:** You might discover that London Tuesdays are your best environment and NY Fridays are reliably your worst. This level of granularity is impossible to see without systematic tracking.

### 12-Month P&L Bar Chart

**Canvas:** `c-monthlypnl` · **Function:** `renderMonthlyBarWithGoal(arr)`  
Full-width bar chart of the last 12 calendar months' net R. Each bar is green (profit) or red (loss). A dotted goal line overlay shows your monthly R target (set in the Goals modal).

**User benefit:** Instant year-in-review. Seasonal patterns, consistency, and goal attainment visible in one glance.

### Asset Heatmap Matrix

**Function:** `renderHeatMap(arr)`  
A calendar-style heatmap with days of the month on one axis and month/year on the other. Each cell is colour-coded by net R for that day. Hover for exact figures.

### Pair Performance

**Function:** `renderPairHeatmap(arr, mode)`  
**Switchable:** Net R | Win%

Ranked horizontal bar chart of all pairs by either net R (default) or win rate. Shows the R value and trade count per pair. Limited to top 12 pairs.

**User benefit:** Immediately shows which instruments you trade well and which you should stop trading. If GBPJPY has cost you 14R across 8 trades, that's a structural problem with your approach to that pair.

---

## 6. Right Sidebar — Live Evaluation Panel

The right column of the dashboard is a permanent evaluation panel with two sections:

### Performance Evaluator

**Function:** Part of `renderDashboard()`  
Six metrics displayed as row cards:

| Metric | What it shows |
|--------|--------------|
| Net R | Period net with colour coding |
| Win Rate | % with W/L/BE breakdown |
| Avg RR | Average R on winning trades |
| Profit Factor | Gross W ÷ Gross L |
| Max DD | Max peak-to-trough drawdown |
| Best Trade | Highest R winner |

A 7-trade streak strip (W/L/B coloured dots) shows your recent sequence at a glance.

### Live Execution Log

**Function:** `renderExecLog(periodArr)`  
The last 10 trades for the selected period, listed as compact entries with:

- Colour bar (green = win, red = loss, cyan = BE)
- Pair name
- Date + session + model
- R result

Hovering a trade in the execution log cross-highlights the corresponding data point on the equity curve chart via `setExecHighlightIndex()` / `initExecLogHighlight()`.

### Profit Calendar

A monthly calendar embedded in the right sidebar. Each day with trades shows the net R in colour (green/red/cyan). Navigate months with `calPrev()` / `calNext()`. Click a day to open the **Day Panel** — a slide-in drawer showing all trades for that day with full details.

---

## 7. Modals & Overlays

### Goals Modal

**Function:** `openGoalsModal()`, `saveGoals()`, `renderGoalsPanel()`  
Set monthly targets for: Net R, Win Rate %, Average Habit Score, Max Mistakes. Goals are displayed in the right sidebar as a progress bar strip. Each goal shows current value / target, a progress bar, and a colour indicating whether you're on track (cyan), meeting the goal (green), or behind (red).

### Circuit Breaker

**Function:** `checkCircuitBreaker()`, `openCircuitBreaker(n)`, `circuitStop()`, `circuitOverride()`  
Monitors two conditions after every trade is saved:
1. Daily loss exceeds `settings.maxDailyLossR`
2. Daily trade count exceeds `settings.maxDailyTrades`

If triggered, a full-screen modal appears with a warning, the last N trade dots, and two buttons: **Stop Trading** (navigates to dashboard, sets a dismissed flag) or **Override** (acknowledges the warning and allows continuation with a toast reminder).

**User benefit:** The journal becomes a trading coach that actively intervenes when you're in danger of a discipline failure. Most large trading losses happen after the first circuit breaker event is ignored.

### Quick Capture FAB

**Function:** `openQuickCapture()`, `saveQuickCapture()`  
Floating button (bottom-right, cyan, `Q` key). Minimal modal: Pair, R multiple, Direction, Outcome. Saves a trade instantly. Remaining fields can be filled in later via inline edit in the All Trades table. Flagged with `quickCapture: true`.

**User benefit:** If you're trading live, you don't have time to fill a full form. Quick Capture logs the essentials in under 10 seconds so you never miss a trade record.

### Week View

**Function:** `openWeekView(id)`, `closeWeekView(e)`  
Full overlay showing a week plan in read-only format. Includes embedded performance stats for that week's trades (WR, Net R, trades, avg R), all narrative fields, chart thumbnails, and an Edit Week button.

### Day Panel

**Function:** `openDayPanel(dateStr)`, `closeDayPanel(e)`  
Slide-in right drawer triggered by clicking a calendar day. Shows all trades for that date with pair, direction, outcome, R result, model, notes, and chart images.

### Lightbox

**Function:** `openLB(src)`, `closeLB()`  
Full-screen image viewer for chart screenshots. Press Escape or click outside to close.

### Shortcut Reference Modal

**Function:** `openShortcutModal()` (`?` key)  
Two-column list of all keyboard shortcuts. Always accessible.

### Custom Confirm Dialog

**Function:** `customConfirm(msg, onAccept, okLabel, okColor)`  
Replaces the browser's `window.confirm()`. Used for destructive actions (delete trade, restore backup, delete week).

---

## 8. AI Features

### AI Trade Coach Panel

**Function:** `runAICoach(force)`  
**Location:** Dashboard, above the bento grid  
**API:** `POST https://api.anthropic.com/v1/messages` (claude-sonnet-4-20250514)

Appears automatically when 5+ trades are logged. On first dashboard load, fires after an 800ms delay (avoiding blocking the initial render).

#### What it sends to Claude

A structured prompt containing:
- Total trade count
- Win rate, Net R, Profit Factor
- Avg winner, Avg loser, Max drawdown
- This month's stats vs all-time
- Per-model breakdown (WR, net R, trade count for top 5 models)
- Top 3 mistake tags with occurrence counts

#### What you get back

3 specific, data-referenced coaching points. For example:

> *"Your 58% win rate is solid but your avg winner (1.4R) is barely outpacing your avg loser (1.2R), giving you a profit factor of only 1.18. Your biggest leverage is holding winners longer — the 95th percentile trade in your history is 3.8R, suggesting the setup supports larger moves than you're capturing."*

#### Caching

Results are cached in memory for 10 minutes. The **Refresh Analysis** button forces a fresh API call. A timestamp shows when the analysis was last updated.

#### Graceful degradation

If the API call fails (no network, no API key), the panel falls back to showing a compact stat summary so the space is never blank.

### AI Post-Trade Notes Expander

**Function:** `aiExpandNotes()`  
**Location:** Log Trade form, below the Post-Trade Analysis textarea  
**Button label:** ✨ AI Draft Notes

When clicked, reads the current state of the trade form (pair, direction, outcome, R, session, HTF bias, model, pre-trade thesis, any existing notes) and calls Claude to draft a 2–3 sentence first-person post-trade analysis.

Example output for a Loss on EURUSD, Short, London, OB model, "Bearish engulfing at 4H OB":

> *"Entered short at the 4H order block on a bearish engulfing — the thesis was sound and the structure was there, but NY open reversed aggressively through the block. The loss was structurally valid; the order block was confluent, but I failed to account for the broader NY bullish expansion that had been building. Lesson: check the 4H opening range direction before taking OB shorts into NY."*

Existing notes are preserved; the AI draft is appended with an `[AI Draft]` label so you can edit or remove it.

---

## 9. Core Engine Functions

### `calcStats(arr)`

The central analytics engine. Takes an array of trade objects and returns a comprehensive statistics object:

```js
{
  wins:      Trade[],  // Win trades
  losses:    Trade[],  // Loss trades
  bes:       Trade[],  // Breakeven trades
  net:       number,   // Total net R (rounded to 2dp)
  wr:        number,   // Win rate 0–100
  avgW:      number,   // Average winner R
  avgL:      number,   // Average loser R
  grossW:    number,   // Sum of winning R
  grossL:    number,   // Sum of losing R
  pf:        number|null, // Profit factor (null if no losses)
  apd:       number,   // Average R per trading day
  days:      string[], // Unique trading dates
  bestTrade: Trade|null, // Highest R winner
  streak:    string[], // Last 7 outcomes as ['W','L','B'...]
  dd:        number,   // Maximum drawdown (peak-to-trough R)
  curve:     number[], // Cumulative equity curve [0, r1, r1+r2, ...]
  topModel:  [string, number]|undefined // Best model by win count
}
```

Called by virtually every render function. Every chart, every stat card, every evaluation metric flows through here.

### `getFiltered(p)`

Returns the trade array filtered to the current period:
- `'week'` — Monday to today
- `'month'` — current calendar month
- `'90d'` — last 90 calendar days
- `'all'` — entire trade history

### `renderDashboard()`

The master render orchestrator. Called on: page load, period change, trade add/edit/delete, setting change. Sequence:

1. `getFiltered(period)` → gets current period trades
2. `calcStats(arr)` → computes all metrics
3. Animate stat card values via `animateNumber()` / `renderOdometer()`
4. Render sparkline on Net R card
5. Update delta badges via `renderStatDeltas()`
6. `renderCharts()` → all bento charts
7. `renderExecLog()` → execution log sidebar
8. `renderCalendar()` → profit calendar
9. `renderGoalsPanel()` → goals progress strip
10. `renderModelTable()` → model performance table
11. `renderHTFPanel()` → HTF alignment panel
12. `renderPhase3Analytics()` → habit scatter, emotion xtab, streak dots, session heatmap, Monte Carlo
13. `renderMonthlyBarWithGoal()` → 12-month P&L chart
14. `updateDollarStatCard()` → dollar P&L card
15. `updateDollarSubLabel()` → risk % label
16. `renderPairHeatmap()` → pair performance panel
17. P5 hook: schedule AI coach on first load

### `runMonteCarlo(arr, iterations)`

Statistical simulation engine. Algorithm:

1. For each of 1,000 iterations:
   - Copy the trade array
   - Fisher-Yates shuffle (true random reordering)
   - Compute cumulative equity and max drawdown for that shuffled sequence
2. Sort all 1,000 max drawdowns and final equities
3. Return median, P90, P95 drawdowns + median final equity + ruin rate

Time complexity: O(n × iterations). Runs in a `setTimeout(fn, 20)` to yield to the UI thread first.

### `calcKelly(wr, avgW, avgL)`

Full Kelly fraction formula:

```
b = avgW / avgL          (payoff ratio)
p = winRate / 100        (win probability)
Kelly = (b×p − (1−p)) / b
```

Returns Kelly as a percentage of capital. Clamped to 0 minimum (never negative). Half Kelly = Kelly/2, Quarter Kelly = Kelly/4.

### `generateWeeklyPrompts(weekData)`

Analyses a single week's trades and generates up to 3 tailored review questions. Checks:
- Session with most losses (if ≥2 losses in one session)
- Counter-trend trade count and win rate (if ≥2 such trades)
- Average habit score (if <3.0/6)
- Weekly win rate (if <45% with 4+ trades)
- Most repeated mistake tag (if appears ≥2 times)

Returns an array of prompt strings, truncated to 3 maximum.

---

## 10. Chart Rendering Functions

All charts use Chart.js with a shared dark-theme configuration object `CD` that sets transparent backgrounds, custom grid colours, JetBrains Mono font, and styled tooltips.

Charts are stored in `chartInst` (a key-value map) and destroyed via `destroyChart(key)` before re-rendering to prevent canvas memory leaks.

### Chart helper: `pcBarGradientV(chart, baseStr)`

Creates a vertical gradient fill for bar charts. Takes the bar's base colour string, parses its RGBA components, and returns a `CanvasGradient` that fades from the base colour at the top to transparent at the bottom.

### Chart helper: `pcBarGradientH(chart, baseStr)`

Same as above but horizontal — used for horizontal bar layouts.

### `renderEquity(arr, s)`

Line chart with fill. Dataset: `s.curve` (cumulative R at each trade). Additional datasets: zero reference line. Hover plugin: custom crosshair that updates the exec log highlight.

### `renderDrawdown(arr, s)`

Bar chart where each bar is `-(peak - currentEquity)` at that trade. All bars are negative or zero. Red gradient fill.

### `renderMonthly(arr)` / `renderMonthlyBarWithGoal(arr)`

`renderMonthly` — bar chart of net R per month for the selected period.  
`renderMonthlyBarWithGoal` — same but over a fixed 12-month window with an annotation plugin goal line overlay.

### `renderSweetSpot(arr)`

2D grid rendered as a styled HTML table (not a canvas chart). Rows = models, columns = sessions. Each cell computed from `calcStats()` on the intersection subset.

### `renderHeatMap(arr)`

Calendar-style HTML table. One row per month label, columns for days 1–31. Each cell filled using `heatmapCellStyle(net, maxAbs)` which returns a CSS class from a 5-tier scale (vhi/hi/neu/lo/vlo).

---

## 11. Data Operations

### `addTrade()`

Validates required fields → constructs trade object → pushes to `trades` array → sorts by date → `saveTrades()` → `runAutoBackup()` → `checkCircuitBreaker()` → resets form → `showPage('dashboard')`.

### `saveInlineEdit(id)`

Reads all inline edit form fields → spreads new values over existing trade object (preserving Phase 2/3 fields not in the inline form) → re-sorts by date → `saveTrades()` → `renderTradesTable()` → `renderDashboard()`.

### `runAutoBackup()`

Checks timestamp of last backup against 24-hour threshold. If overdue: creates a snapshot `{ts, count, trades}`, prepends to backup ring buffer, trims to 7 entries maximum, saves to `BK`, updates `BACKUP_LAST_KEY`.

### `exportData()`

Serialises `{trades, weeks, models, settings, goals, journal, rulebook, assessments}` to a JSON blob and triggers download named `profs-corner-backup-YYYY-MM-DD.json`.

### `importData(event)`

Reads the uploaded JSON file, validates structure, replaces in-memory arrays, saves all keys to localStorage, re-renders dashboard.

### `executeCSVImport()`

After mapping and preview steps:
- Reads column mapping from dropdowns
- Parses each CSV row: normalises date format (handles MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD), normalises outcome string, computes absolute R
- Constructs trade objects with `csvImport: true` flag
- Appends to trades, sorts, saves, runs backup
- Reports import/skip count in toast

### `showCSVPreview()`

Before committing import: builds the column mapping, parses the first 8 rows, renders a preview table with ✓/✗ validity per row, shows total import count. Back button returns to column mapping.

---

## 12. UI & Utility Functions

### `showPage(id)`

SPA router. Removes `.active` from all `.page` divs and `.nav-item` elements, adds to the target. Triggers the appropriate render function for the destination page. Handles cleanup (close model manager, remove filter strip, remove log preview bar) on departure from certain pages.

### `toggleSidebar()`

Toggles `collapsed` class on `#sidebar` and `expanded` on `#main-wrap`. Updates chevron icon. Repositions the model manager FAB and its modal. Schedules a chart resize (charts need to reflow their canvas dimensions when the sidebar width changes).

### `toggleFocusMode()` (`F` key)

Adds/removes `focus-mode` class on `#dashboard`. CSS hides all bento cards except the equity curve and execution log, giving a minimal "just the numbers" view. State persisted to `localStorage`.

### `toggleTheme()`

Toggles `light` class on `<html>`. CSS custom properties for the light theme are defined in a separate block overriding the dark defaults. Theme preference persisted to `localStorage`.

### `animateNumber(id, endVal, formatFn)`

Animates a numeric value from its current displayed value to a new target over ~380ms using a cubic ease-out (`1 - (1-u)^3`). For stat card IDs (prefix `sv-`), delegates to `renderOdometer()` instead.

### `renderOdometer(el, valStr)`

Digit-by-digit slot-machine animation. Each numeric character gets a vertical column of 0–9 spans. The column is CSS-transformed to show the target digit. Non-numeric characters (R, +, -, .) are rendered as plain spans.

### `renderSparkline(canvasId, data, color)`

Draws a minimal line chart on a small canvas (the Net R stat card footer). Handles DPR scaling. Draws a line from min to max value range, then fills the area beneath with a gradient.

### `toast(msg)`

Shows a temporary notification (bottom-right, cyan gradient) for 2.6 seconds. Debounced — rapid successive calls replace the previous message.

### `initEffects()`

Mouse-tracking spotlight effect on stat cards. Listens to `mousemove` on the document and updates `--mouse-x`/`--mouse-y` CSS custom properties on hovered `.stat-card` elements. The card's `::before` pseudo-element uses these to render a radial gradient spotlight. Disabled in perf mode.

### `setPeriod(p)` / `getPrevPeriodArr(p)`

`setPeriod` updates the `period` state variable, highlights the active button, re-runs `renderDashboard`.  
`getPrevPeriodArr` computes the *previous* equivalent period's trades for delta badge comparison (e.g. if period is 'month', returns last month's trades).

### `setDeltaBadge(id, cur, prev, fmt)`

Updates a delta badge element. If `cur > prev`: ▲ green. If `cur < prev`: ▼ red. If equal: flat grey. Used on all five stat cards.

### `setSeg(btn, group)` / `segState`

Segmented control handler. `segState` stores the current value of each segmented group (bias, dir, out, sess, qcdir, qcout). Updates button class states and the `segState` object.

### `switchBento(rowKey, chartKey, evt)`

Toggles visibility of bento chart panels within a switchable card. Hides all `.bento-chart[data-bento^=rowKey]` panels, shows the target, updates button states, and calls `refreshBentoChartsForRow()` to trigger a Chart.js resize on newly visible charts.

### `initHabitScoreCounter()`

Attaches a change listener to all `.habit-check` checkboxes in the Log Trade form. On each change, counts checked boxes and updates the `#habit-score-live` pill text (e.g. *"4/6 — Discipline score"*).

### `updateAutoRPreview()`

Reads Entry, SL, TP fields. If all three are filled: computes `|TP - Entry| / |Entry - SL|` and updates the `#auto-r-display` element beneath the price fields with the computed R:R.

### `setupDropZone(zoneId, ctx)`

Attaches `dragover` and `drop` event listeners to an image upload zone. On drop, calls `handleImgInput()` with the dropped files.

### `handleImgInput(ctx, event)` / `readImg(file, ctx)`

Reads image files using `FileReader`, converts to base64 data URLs, adds to the appropriate image array (`tradeImgs`, `weekImgs`, or `editImgs`), and calls `renderImgPrevs()`. Respects the 5-image maximum.

### `openDayPanel(dateStr)` / `closeDayPanel(e)`

Day panel slide-in. Filters trades for the clicked date, builds an HTML summary (trade chips with pair/outcome/R/session/model/notes/charts), injects into `#day-panel-body`, adds `.open` class to the backdrop.

### `logPreviewUpdate()`

Runs whenever key fields change in the Log Trade form. Adds a hypothetical trade to the current month's array and computes `calcStats()` to preview the impact. Updates `#lp-wr`, `#lp-net`, `#lp-ct`, `#lp-pf` in the live preview bar.

---

## 13. Keyboard Shortcuts

All shortcuts are inactive when focus is inside a text field, textarea, or select element.

| Key | Action |
|-----|--------|
| `D` | Dashboard |
| `W` | Weekly Plan |
| `T` | All Trades |
| `N` | Log Trade |
| `S` | Share Card |
| `J` | Daily Journal |
| `R` | My Rulebook |
| `M` | Mistakes Library |
| `F` | Toggle Focus Mode |
| `Q` | Quick Capture modal |
| `,` | Settings |
| `?` | Keyboard Shortcuts modal |
| `Esc` | Close open modal / lightbox |

---

## 14. Performance & Debug Modes

### Performance Mode

Activated by URL parameter `?perf=1` or `localStorage.profsCorner_perf = "1"`.

Effects:
- Skips mouse-tracking spotlight effect on stat cards (replaces with a static CSS gradient)
- Disables ambient parallax background animations
- Lowers canvas Device Pixel Ratio for chart rendering

Use on slower machines or when running many charts simultaneously.

### Debug Mode

Activated by `?debug=1` or `localStorage.profsCorner_debug = "1"`.

Effects:
- Enables `pcDbg()` calls to `console.log` with `[ProfCorner]` prefix
- Logs trade counts, storage keys, backup events, chart init, DOM events

### Console Audit Tool

```js
ProfsCornerAudit()
```

Call from the browser console to get a `console.table` of all localStorage keys with truncated values, plus an info object showing in-memory trade/week/model counts and the active storage key.

---

## 15. Print / PDF Export

`printReport()` calls `window.print()`. A comprehensive `@media print` stylesheet is included that:

- Hides: sidebar, mobile nav, FABs, modals, buttons, period strip, bento card toggle buttons, the ambient background
- Resets: background to white, text to `#0d1117`
- Adjusts: main-wrap margin to zero (no sidebar offset), stat cards to light grey with borders, bento cards with `break-inside: avoid` for page breaks

To export as PDF: File → Print → select "Save as PDF" from the Destination dropdown. Works in Chrome, Edge, Firefox, and Safari.

---

## 16. Design System & Tokens

All visual decisions flow from CSS custom properties defined on `:root`.

### Colour Tokens

| Token | Value | Role |
|-------|-------|------|
| `--surface` | `#080f15` | Page background |
| `--surface-low` | `#0c141b` | Sidebar, cards |
| `--surface-container` | `#121a22` | Input fields, table cells |
| `--surface-high` | `#172129` | Hover states |
| `--surface-highest` | `#1d2730` | Active elements |
| `--surface-bright` | `#232d37` | Badge backgrounds |
| `--primary` | `#99f7ff` | Cyan accent — wins, links, focus |
| `--primary-dim` | `#00e2ee` | Gradient end |
| `--tertiary` | `#afffd1` | Mint — profit, positive results |
| `--tertiary-dim` | `#00efa0` | Gradient end |
| `--error` | `#ff716c` | Red — losses, errors, alerts |
| `--error-dim` | `#d7383b` | Darker red |
| `--on-surface` | `#eef4fd` | Primary text |
| `--on-surface-var` | `#a5acb4` | Secondary text |
| `--outline` | `#6f767e` | Tertiary text, borders |
| `--outline-var` | `#424950` | Subtle borders |

### Typography Tokens

| Token | Font | Use |
|-------|------|-----|
| `--ff-head` | Space Grotesk | Headings, page titles, card titles |
| `--ff-body` | Geist / Inter | Body copy, form labels, descriptions |
| `--ff-mono` | JetBrains Mono | All numeric data, stat values, code, timestamps |

The three-font system creates clear visual hierarchy: **Space Grotesk** for structure, **Geist** for reading, **JetBrains Mono** for data. Numbers in a trading journal are data, so every R value, date, and metric renders in monospace for alignment and instant readability.

### Layout Tokens

| Token | Value | Use |
|-------|-------|-----|
| `--sidebar-w` | `256px` | Expanded sidebar width |
| `--sidebar-collapsed` | `64px` | Icon-only sidebar width |

---

*End of Overview — Prof's Corner Phase 5*
