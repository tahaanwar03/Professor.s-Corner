# 📈 Prof's Corner — Local Trading Journal

A fully local, privacy-first trading journal with an advanced dashboard, AI coaching, equity charts, pair heatmaps, weekly planning, and a shareable PnL card. Your data never leaves your machine.

---

## ✅ Prerequisites

- **[Node.js](https://nodejs.org/)** (v18+ recommended) — required to run the local sync server.
- A modern browser (Chrome, Edge, or Firefox).

---

## 🚀 Quick Start

1. **Clone or download** this repository to your computer.
2. Open a terminal inside the project folder (e.g. `h:\Professor's corner`).
3. Run the launcher:

```cmd
start-journal.cmd
```

This starts two things at once:
- **Sync Server** on `http://127.0.0.1:8021` — handles data persistence to disk.
- **Web Server** on `http://127.0.0.1:8020` — serves the dashboard.

4. Open your browser and go to:

```
http://127.0.0.1:8020
```

You will see the **Prof's Corner P5** dashboard. Any trades you log are automatically saved to `data.json` and chart images are extracted to the `media/` folder.

> **First launch:** The journal will auto-seed with a set of example trades so the dashboard isn't empty.

---

## 💾 How Data is Stored

| Mode | When | Where |
|---|---|---|
| **Local Server (recommended)** | Sync Server is running | `data.json`, `media/`, `journal/` |
| **Browser Fallback** | Server not running | Browser `localStorage` only |

The app automatically detects which mode to use. If the server is offline, it silently falls back to browser storage — no data is lost.

---

## ✏️ Customisation

### Change the Journal Name

Open `Prof_s_Corner_P5.html` and find **line ~1614**:

```html
<div class="sidebar-logo-name">Prof's Corner</div>
<div class="sidebar-logo-sub">Trading Journal</div>
```

Replace the text with your own name and subtitle:

```html
<div class="sidebar-logo-name">Taha's Edge</div>
<div class="sidebar-logo-sub">Futures Journal</div>
```

Also update the browser tab title near the top of the file:

```html
<title>Prof's Corner — Trading Journal</title>
```

---

### Change the Logo Icon (Emoji)

Find **line ~1612** in `Prof_s_Corner_P5.html`:

```html
<div class="sidebar-logo-mark" ...>⚕︎</div>
```

Replace `⚕︎` with any emoji you like:

```html
<!-- Chart bar -->
<div class="sidebar-logo-mark" ...>📊</div>

<!-- Lightning bolt for a fast trader -->
<div class="sidebar-logo-mark" ...>⚡</div>

<!-- Fire for aggressive style -->
<div class="sidebar-logo-mark" ...>🔥</div>

<!-- Telescope for a macro trader -->
<div class="sidebar-logo-mark" ...>🔭</div>
```

---

### Use a Custom Image as the Logo

Replace the emoji `<div>` with an `<img>` tag pointing to your image:

```html
<div class="sidebar-logo-mark" ...>
  <img src="assets/my-logo.png" style="width:28px;height:28px;border-radius:6px;object-fit:cover;" alt="Logo">
</div>
```

Then place your image (PNG, WebP, or SVG) in the `assets/` folder.

---

### Change the Server Port or Title (sync-server.js)

Open `sync-server.js` and find the top of the file:

```js
const PORT = 8021;
```

Change to any free port, then update the matching line in `Prof_s_Corner_P5.html`:

```js
_sxhr.open('GET', 'http://127.0.0.1:8021/sync-client.js', false);
```

---

## 📂 Folder Structure

```
Professor's corner/
├── Prof_s_Corner_P5.html   ← Main dashboard (open this)
├── sync-server.js          ← Local REST API + markdown generator
├── server.ps1              ← PowerShell web server (serves files)
├── start-journal.cmd       ← One-click launcher
├── extract.js              ← Image extraction helper
├── assets/                 ← CSS, JS, PnL card manifest
├── data.json               ← Your trade data (auto-created, gitignored)
├── media/                  ← Extracted chart images (gitignored)
└── journal/                ← Auto-generated trade markdown notes (gitignored)
```

---

## 🔒 Privacy

Your personal trading data is protected by `.gitignore`. The following are **never pushed to GitHub**:

- `data.json`
- `media/`
- `journal/`
- `PnL Card/`

If you fork or share this repo, only the app code is shared — never your trades.

---

## 📤 Sharing Your Journal With Someone

To let someone else use the app from scratch:

1. They fork or download this repo.
2. They install Node.js and run `start-journal.cmd`.
3. The app auto-seeds example trades on first launch.

To share **your own trade history** with someone:

1. Copy your `data.json` and `media/` folder into their project directory.
2. They start the server — your full history loads instantly.

Alternatively, in the app UI: **Settings → Export JSON** to get a portable backup file that can be imported on any machine.

---

## 🛠 Stack

- Vanilla HTML / CSS / JS — zero frontend framework, zero build step.
- [Chart.js](https://www.chartjs.org/) — equity, drawdown, scatter, and calendar charts.
- Node.js (`sync-server.js`) — local REST API for data persistence and markdown journaling.
- PowerShell (`server.ps1`) — lightweight static file server.
