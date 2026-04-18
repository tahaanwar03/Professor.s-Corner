const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8021;
const DATA_FILE = path.join(__dirname, 'data.json');
const MEDIA_DIR = path.join(__dirname, 'media');
const JOURNAL_DIR = path.join(__dirname, 'journal');

if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR);
if (!fs.existsSync(JOURNAL_DIR)) fs.mkdirSync(JOURNAL_DIR);

function loadDb() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
      console.error("Error parsing data.json", e);
    }
  }
  return { trades: [], weeks: [], models: [], settings: {} };
}

function saveDb(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function extractImages(trades) {
  trades.forEach(t => {
    if (t.imgs && Array.isArray(t.imgs)) {
      t.imgs = t.imgs.map((img, i) => {
        if (img.startsWith('data:image/')) {
          const extMatch = img.match(/^data:image\/(\w+);base64,/);
          const ext = extMatch ? extMatch[1] : 'png';
          const base64Data = img.replace(/^data:image\/\w+;base64,/, "");
          const filename = `${t.date.replace(/-/g, '')}_${t.pair.replace(/[^A-Za-z0-9]/g, '')}_${t.id}_${i}.${ext}`;
          const filepath = path.join(MEDIA_DIR, filename);
          fs.writeFileSync(filepath, Buffer.from(base64Data, 'base64'));
          return `http://127.0.0.1:${PORT}/media/${filename}`; // Return direct URL
        }
        return img;
      });
    }
  });
}

function generateMarkdownCards(trades) {
  trades.forEach(t => {
    const filename = `${t.date.replace(/-/g, '')}_${t.pair.replace(/[^A-Za-z0-9]/g, '')}_${t.id}.md`;
    const filepath = path.join(JOURNAL_DIR, filename);

    // Format the text output
    const rv = t.rr * (t.outcome === 'Win' ? 1 : t.outcome === 'Loss' ? -1 : 0);
    const rvTxt = (rv >= 0 ? '+' : '') + rv.toFixed(2) + 'R';

    let imgsMd = '';
    if (t.imgs && Array.isArray(t.imgs)) {
      imgsMd = t.imgs.map((img, i) => `![Chart ${i+1}](${img})`).join('\n\n');
    }

    const md = `# Trade: ${t.pair}
**Date:** ${t.date}  
**Outcome:** ${t.outcome} (${rvTxt})  
**Model:** ${t.model || 'N/A'}  
**Session:** ${t.sess || 'N/A'}  
**Direction:** ${t.dir}  
**HTF Bias:** ${t.bias || 'N/A'}

## Execution Notes
${t.exec || 'None'}

## Emotions
${t.emo || 'None'}

## Charts
${imgsMd}

---
*Created by Prof's Corner Sync Server*
`;
    fs.writeFileSync(filepath, md, 'utf8');
  });
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Pre-flight check logic
  if (req.method === 'GET' && req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('pong');
  }

  // Serve the client script specifically for injection
  if (req.method === 'GET' && req.url === '/sync-client.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    const clientScript = `
window.journalDB = {
  host: 'http://127.0.0.1:${PORT}',
  async req(method, path, body) {
    try {
      const res = await fetch(this.host + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
      if (res.ok) {
         if (res.status === 204) return null;
         return await res.json();
      }
      return null;
    } catch {
      return null;
    }
  },
  async getTrades() { const db = await this.req('GET', '/api/data'); return db ? db.trades : []; },
  async getWeeks() { const db = await this.req('GET', '/api/data'); return db ? db.weeks : []; },
  async getModels() { const db = await this.req('GET', '/api/data'); return db ? db.models : null; },
  async getSetting(key, def) { const db = await this.req('GET', '/api/data'); return db && db.settings && db.settings[key] !== undefined ? db.settings[key] : def; },
  async setSetting(key, val) { await this.req('POST', '/api/settings', { key, val }); },
  async checkMigrationNeeded() { const db = await this.req('GET', '/api/data'); return db && db.trades.length === 0 && db.weeks.length === 0; },
  async migrateFromLocalStorage(data) { await this.req('POST', '/api/migrate', data); },
  async saveTrade(trade) { await this.req('POST', '/api/trade', trade); },
  async saveWeek(week) { await this.req('POST', '/api/week', week); },
  async saveModels(modelsArr) { await this.req('POST', '/api/models', { models: modelsArr }); }
};
console.log('Prof Corner Local Sync initialized!');
`;
    return res.end(clientScript);
  }

  // Serve media files locally to the client browser
  if (req.url.startsWith('/media/') && req.method === 'GET') {
    const filename = req.url.split('/').pop();
    const filepath = path.join(MEDIA_DIR, filename);
    if (fs.existsSync(filepath)) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(fs.readFileSync(filepath));
    } else {
      res.writeHead(404);
      return res.end();
    }
  }

  // API Data serving
  if (req.url === '/api/data' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(loadDb()));
  }

  // API Persistence routing
  let body = '';
  req.on('data', chunk => body += chunk.toString());
  req.on('end', () => {
    let parsed = {};
    if (body) {
      try { parsed = JSON.parse(body); } catch(e) { console.error("Body parse error", e); }
    }

    let db = loadDb();

    if (req.method === 'POST') {
      if (req.url === '/api/settings') {
        db.settings[parsed.key] = parsed.val;
      } else if (req.url === '/api/migrate') {
        db.trades = parsed.trades || [];
        db.weeks = parsed.weeks || [];
        db.models = parsed.models || [];
        if (parsed.settings) db.settings = { ...db.settings, ...parsed.settings };
        extractImages(db.trades);
        generateMarkdownCards(db.trades);
      } else if (req.url === '/api/trade') {
        const existingIdx = db.trades.findIndex(t => t.id === parsed.id);
        if (existingIdx !== -1) {
          db.trades[existingIdx] = parsed;
        } else {
          db.trades.push(parsed);
        }
        extractImages(db.trades);
        generateMarkdownCards([parsed]);
      } else if (req.url === '/api/week') {
        const existingIdx = db.weeks.findIndex(w => w.id === parsed.id);
        if (existingIdx !== -1) {
          db.weeks[existingIdx] = parsed;
        } else {
          db.weeks.push(parsed);
        }
      } else if (req.url === '/api/models') {
        db.models = parsed.models || [];
      }
      
      saveDb(db);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true }));
    }

    res.writeHead(404);
    res.end();
  });
});

server.listen(PORT, () => {
  console.log(`[Sync Server] Running on http://127.0.0.1:${PORT}`);
});
