# Prof's Corner

Browser-based trading journal: dashboard, charts, calendar, weekly plan, and a shareable PnL card.

## Run locally

1. Open a terminal in this folder.
2. `powershell -ExecutionPolicy Bypass -File .\server.ps1`
3. Open **http://127.0.0.1:8020/** (serves `Prof's Corner.html` by default).

Data is stored in the browser (`localStorage`). Use export/import in the app if you need a backup.

## Stack

Static HTML/CSS/JS, Chart.js, optional `assets/premium.js` layer, PnL backdrop images under `PnL Card/`.
