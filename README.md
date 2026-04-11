# Prof's Corner

Browser-based trading journal: dashboard, charts, calendar, weekly plan, and a shareable PnL card.

## Run locally

1. Open a terminal in this folder.
2. `powershell -ExecutionPolicy Bypass -File .\server.ps1`
3. Open **http://127.0.0.1:8020/** (serves `Prof's Corner.html` by default).

Data is stored in the browser (`localStorage`). Use export/import in the app if you need a backup.

**On the public site:** each person’s trades live only in **their own browser** on **their device**. Nothing is sent to your GitHub repo or a server—you don’t see other users’ journals, and they don’t see yours. Clearing site data or another browser = empty journal until they import a backup.

## GitHub Pages (free hosting)

1. Repo → **Settings** → **Pages** (left sidebar).
2. **Build and deployment** → Source: **Deploy from a branch**.
3. Branch: **`main`**, folder: **`/ (root)`**, Save.
4. After a minute, the site is at **`https://tahaanwar03.github.io/Professor-s-Corner/`** (your URL matches your repo name).

`index.html` at the repo root forwards visitors into `Prof's Corner.html`. Relative paths (`assets/`, `PnL Card/`) work on Pages.

## Stack

Static HTML/CSS/JS, Chart.js, optional `assets/premium.js` layer, PnL backdrop images under `PnL Card/`.
