
// ─── CONSTANTS ───────────────────────────────
const TK = 'profsCorner_v1_trades';
const WK = 'profsCorner_v1_weeks';
const MK = 'profsCorner_v1_models';
const PNL_BG_KEY = 'profsCorner_sharePnlBg';
const PNL_BG_LEGACY_KEY = 'profsCorner_statPnlBg';

const IS_ELECTRON = typeof window.journalDB !== 'undefined';

function getPnlBgStoredEncoded() {
  if (IS_ELECTRON) {
    return window.journalDBPnlBg || '';
  }
  try {
    return localStorage.getItem(PNL_BG_KEY) || localStorage.getItem(PNL_BG_LEGACY_KEY) || '';
  } catch (e) { return ''; }
}

function pnlBackdropUrlFromRelPath(relPath) {
  if (!relPath) return '';
  const encPath = relPath.split('/').map(seg => encodeURIComponent(seg)).join('/');
  return new URL(encPath, window.location.href).href;
}

/** Release decode resources (blob: URL for Image fallback, ImageBitmap.close when available). */
function disposeBackdropExportSource(src) {
  if (!src) return;
  try {
    if (typeof src.close === 'function') src.close();
  } catch (e) {}
  try {
    if (src.__pnlBlobUrl) {
      URL.revokeObjectURL(src.__pnlBlobUrl);
      delete src.__pnlBlobUrl;
    }
  } catch (e) {}
}

/**
 * Load backdrop pixels for canvas export (must not taint canvas for toBlob).
 * Prefer createImageBitmap(fetch); if that throws, same-origin blob: + Image() is still clean.
 */
async function loadBackdropForExport(relPath) {
  if (!relPath) return null;
  const url = pnlBackdropUrlFromRelPath(relPath);
  try {
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-cache' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob || !blob.size) return null;

    try {
      const bmp = await createImageBitmap(blob);
      if (bmp && bmp.width > 0 && bmp.height > 0) return bmp;
    } catch (e) {
      try { pcDbg('loadBackdropForExport createImageBitmap', e); } catch (e2) {}
    }

    const objectUrl = URL.createObjectURL(blob);
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('JPEG decode failed'));
      im.src = objectUrl;
    });
    if (!(img.naturalWidth > 0)) {
      URL.revokeObjectURL(objectUrl);
      return null;
    }
    img.__pnlBlobUrl = objectUrl;
    return img;
  } catch (e) {
    try { pcDbg('loadBackdropForExport', e); } catch (e2) {}
    return null;
  }
}
const SEED_KEY = 'profsCorner_v1_seeded';
const DEFAULT_MODELS = ['AMT','OB','FVG','CISD','CVA Reentry','Liquidity Sweep','BOS','MS Break','Reentry','Orderflow','Price Action'];

/** Debug: ?debug=1 or localStorage profsCorner_debug = "1" */
/** Perf: ?perf=1 or localStorage profsCorner_perf = "1" — skips stat-card hover FX, lowers canvas DPR, disables ambient parallax. */
(function () {
  var q = typeof location !== 'undefined' && /[?&]debug=1(?:&|$)/.test(location.search);
  var ls = false;
  try { ls = localStorage.getItem('profsCorner_debug') === '1'; } catch (e) {}
  window.__PC_DEBUG = q || ls;
  var pq = typeof location !== 'undefined' && /[?&]perf=1(?:&|$)/.test(location.search);
  var pls = false;
  try { pls = localStorage.getItem('profsCorner_perf') === '1'; } catch (e) {}
  window.__PC_PERF = pq || pls;
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('perf-mode', !!(window.__PC_PERF));
  }
})();
function pcDbg() {
  if (window.__PC_DEBUG && typeof console !== 'undefined' && console.log) {
    console.log.apply(console, ['[ProfCorner]'].concat([].slice.call(arguments)));
  }
}

// ─── STATE ────────────────────────────────────
let trades  = [];
let weeks   = [];
let models  = [];
let chartRendered = new Set(); // lazy chart rendering
let period  = 'month';
let activeCT = 'equity';
let calY, calM;
let chartInst = {};
/** Dedupe equity chart hover redraws (Chart.update on every pointer move is expensive). */
let __equityCrosshairIdx = -2;
let __execHighlightLast = null;
let editWeekId = undefined;
let weekImgs   = [];
let tradeImgs  = [];
let editImgs   = [];
let cardPeriod = 'monthly';
let cardAccent = '#99f7ff';
let cardGlow   = 'rgba(153,247,255,.07)';
let currentViewId = null;
let sidebarCollapsed = false;
let inlineEditId = null;
let originalTrades = null;

/** Batch Chart.js resize (sidebar / bento / layout) to one reflow */
function scheduleChartResize() {
  if (window.__pcResizeT) clearTimeout(window.__pcResizeT);
  window.__pcResizeT = setTimeout(() => {
    window.__pcResizeT = null;
    window.dispatchEvent(new Event('resize'));
  }, 160);
}

function scheduleRenderTradesTable() {
  const ms = document.getElementById('model-search');
  if (ms) try { sessionStorage.setItem('pc_search', ms.value); } catch {}
  if (window.__rtDebounce) clearTimeout(window.__rtDebounce);
  window.__rtDebounce = setTimeout(() => {
    window.__rtDebounce = null;
    renderTradesTable();
  }, 130);
}

const segState = {
  bias:'Aligned', dir:'Long', out:'Win', sess:'London',
  ebias:'Aligned', edir:'Long', eout:'Win', esess:'London'
};
const filterState = { outcome: 'all', sess: 'all' };
let sortState = { col: 'date', dir: 'desc' };

// ─── STORAGE ─────────────────────────────────
async function loadData() {
  if (IS_ELECTRON) {
    try {
      trades = await window.journalDB.getTrades() || [];
      weeks = await window.journalDB.getWeeks() || [];
      models = await window.journalDB.getModels() || [...DEFAULT_MODELS];
      if (!models.length) models = [...DEFAULT_MODELS];
      
      const needsMigration = await window.journalDB.checkMigrationNeeded();
      if (needsMigration) {
        const localTrades = JSON.parse(localStorage.getItem(TK) || '[]');
        const localWeeks = JSON.parse(localStorage.getItem(WK) || '[]');
        const localModels = JSON.parse(localStorage.getItem(MK) || '[]');
        
        if (localTrades.length > 0 || localWeeks.length > 0) {
          await window.journalDB.migrateFromLocalStorage({
            trades: localTrades,
            weeks: localWeeks,
            models: localModels.length > 0 ? localModels : [...DEFAULT_MODELS],
            settings: {
              focus: localStorage.getItem('profsCorner_focus'),
              calOpen: localStorage.getItem('profsCorner_calOpen'),
              pnlBg: localStorage.getItem(PNL_BG_KEY) || localStorage.getItem(PNL_BG_LEGACY_KEY)
            }
          });
          trades = await window.journalDB.getTrades() || [];
          weeks = await window.journalDB.getWeeks() || [];
          models = await window.journalDB.getModels() || [...DEFAULT_MODELS];
        }
      }
      
      window.journalDBPnlBg = await window.journalDB.getSetting(PNL_BG_KEY, '') || '';
    } catch (e) {
      console.error('Error loading from DB:', e);
      trades = [];
      weeks = [];
      models = [...DEFAULT_MODELS];
    }
  } else {
    try { trades = JSON.parse(localStorage.getItem(TK)) || []; } catch { trades = []; }
    try { weeks  = JSON.parse(localStorage.getItem(WK))  || []; } catch { weeks  = []; }
    try { models = JSON.parse(localStorage.getItem(MK))  || [...DEFAULT_MODELS]; } catch { models = [...DEFAULT_MODELS]; }
    if (!models.length) models = [...DEFAULT_MODELS];
  }
}

async function saveTrades() {
  if (IS_ELECTRON) {
    try {
      for (const trade of trades) {
        await window.journalDB.saveTrade(trade);
      }
    } catch (e) { console.error('Error saving trades:', e); }
  } else {
    try { localStorage.setItem(TK, JSON.stringify(trades)); }
    catch { alert('Storage error — consider removing chart images from old trades.'); }
  }
}

async function saveWeeks() {
  if (IS_ELECTRON) {
    try {
      for (const week of weeks) {
        await window.journalDB.saveWeek(week);
      }
    } catch (e) { console.error('Error saving weeks:', e); }
  } else {
    try { localStorage.setItem(WK, JSON.stringify(weeks)); }
    catch { alert('Storage error.'); }
  }
}

async function saveModels() {
  if (IS_ELECTRON) {
    try { await window.journalDB.saveModels(models); }
    catch (e) { console.error('Error saving models:', e); }
  } else {
    try { localStorage.setItem(MK, JSON.stringify(models)); }
    catch { /* non-critical */ }
  }
}

// ─── UTILITY ─────────────────────────────────
const fmt  = v => (v >= 0 ? '+' : '') + v.toFixed(2) + 'R';
const fmtR = v => v.toFixed(2) + 'R';
const clr  = v => v > 0 ? 'w' : v < 0 ? 'l' : 'r';
function set(id, v) { const e = document.getElementById(id); if (e) e.textContent = v; }
let __toastHideTimer = null;
function toast(msg = 'Saved ✓') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  if (__toastHideTimer) clearTimeout(__toastHideTimer);
  __toastHideTimer = setTimeout(() => {
    el.classList.remove('show');
    __toastHideTimer = null;
  }, 2600);
}

// ─── SIDEBAR TOGGLE ───────────────────────────
function toggleSidebar() {
  sidebarCollapsed = !sidebarCollapsed;
  const sb  = document.getElementById('sidebar');
  const mw  = document.getElementById('main-wrap');
  const ic  = document.getElementById('sidebar-toggle-icon');
  const fab = document.getElementById('mgr-fab');
  const mbg = document.getElementById('mgr-modal-bg');
  sb.classList.toggle('collapsed', sidebarCollapsed);
  mw.classList.toggle('expanded', sidebarCollapsed);
  if (ic)  ic.textContent = sidebarCollapsed ? 'chevron_right' : 'chevron_left';
  // Move FAB and modal padding to match sidebar width
  const left = (sidebarCollapsed ? 'calc(var(--sidebar-collapsed) + 20px)' : 'calc(var(--sidebar-w) + 20px)');
  if (fab) fab.style.left = left;
  if (mbg) mbg.style.paddingLeft = left;
  scheduleChartResize();
}

// ─── MODEL MANAGER MODAL ─────────────────────
function openModelMgr() {
  renderModelManager();
  const mbg = document.getElementById('mgr-modal-bg');
  if (mbg) mbg.classList.add('open');
  const inp = document.getElementById('model-new-input');
  if (inp) setTimeout(() => inp.focus(), 80);
}
function closeModelMgr() {
  const mbg = document.getElementById('mgr-modal-bg');
  if (mbg) mbg.classList.remove('open');
}

// ─── NAVIGATION ───────────────────────────────
function showPage(id) {
  closeCalPop();
  if (id !== 'add') {
    closeModelMgr();
    const pb = document.getElementById('log-preview-bar');
    if (pb) pb.classList.remove('visible');
  }
  if (id !== 'trades') {
    const strip = document.getElementById('fstat-strip');
    if (strip) strip.classList.remove('visible');
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  // Sidebar items
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === id));
  document.querySelectorAll('.mn-item').forEach(n => n.classList.toggle('active', n.dataset.page === id));
  // Re-trigger animations
  if (id === 'dashboard') {
    document.querySelectorAll('#dashboard .anim').forEach(el => {
      el.style.animation = 'none';
      el.offsetHeight;
      el.style.animation = '';
    });
    renderDashboard();
    applyFocusModeFromStorage();
  } else {
    const dash = document.getElementById('dashboard');
    if (dash) dash.classList.remove('focus-mode');
  }
  if (id === 'trades')    { restoreFilters(); renderTradesTable(); }
  if (id === 'weekly')    renderWeeklyPlan();
  if (id === 'sharecard') renderShareCard();
}

// ─── PERIOD ───────────────────────────────────
function setPeriod(p) {
  period = p;
  document.querySelectorAll('.pbtn').forEach(b => b.classList.remove('on'));
  document.querySelector(`.pbtn[data-p="${p}"]`).classList.add('on');
  renderDashboard();
}

function getFiltered(p) {
  if (p === 'all') return [...trades];
  const now = new Date(), today = now.toISOString().slice(0, 10);
  if (p === 'month') return trades.filter(t => t.date.startsWith(today.slice(0, 7)));
  if (p === 'week') {
    const dow = now.getDay(), diff = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(now); mon.setDate(now.getDate() + diff);
    return trades.filter(t => t.date >= mon.toISOString().slice(0, 10) && t.date <= today);
  }
  if (p === '90d') {
    const d = new Date(now); d.setDate(now.getDate() - 90);
    return trades.filter(t => t.date >= d.toISOString().slice(0, 10));
  }
  return [...trades];
}

// ─── STATS ENGINE ─────────────────────────────
function calcStats(arr) {
  const wins = [], losses = [], bes = [];
  const dayMap = {};
  const modelMap = {};
  let net = 0, grossW = 0, grossL = 0, sumW = 0, sumL = 0;
  let bestTrade = null, bestVal = -Infinity;
  for (let i = 0, L = arr.length; i < L; i++) {
    const t = arr[i];
    const isW = t.outcome === 'Win', isL = t.outcome === 'Loss';
    const rv = t.rr * (isW ? 1 : isL ? -1 : 0);
    net += rv;
    if (isW) {
      wins.push(t);
      sumW += t.rr;
      grossW += t.rr;
      if (t.rr > bestVal) { bestVal = t.rr; bestTrade = t; }
      if (t.model) modelMap[t.model] = (modelMap[t.model] || 0) + 1;
    } else if (isL) {
      losses.push(t);
      sumL += t.rr;
      grossL += t.rr;
    } else bes.push(t);
    const ds = t.date;
    dayMap[ds] = (dayMap[ds] || 0) + rv;
  }
  net = Math.round(net * 100) / 100;
  const n = arr.length;
  const wr = n ? wins.length / n * 100 : 0;
  const avgW = wins.length ? sumW / wins.length : 0;
  const avgL = losses.length ? sumL / losses.length : 0;
  const pf = grossL > 0 ? grossW / grossL : null;
  const days = Object.keys(dayMap);
  const apd = days.length ? net / days.length : 0;
  const sorted = n <= 1 ? arr.slice() : [...arr].sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
  const streak = sorted.slice(-7).map(t => t.outcome === 'Win' ? 'W' : t.outcome === 'Loss' ? 'L' : 'B');
  let peak = 0, cur = 0, dd = 0;
  for (let i = 0, L = sorted.length; i < L; i++) {
    const t = sorted[i];
    cur += t.rr * (t.outcome === 'Win' ? 1 : t.outcome === 'Loss' ? -1 : 0);
    if (cur > peak) peak = cur;
    if (peak - cur > dd) dd = peak - cur;
  }
  let running = 0;
  const curve = [0];
  for (let i = 0, L = sorted.length; i < L; i++) {
    const t = sorted[i];
    running += t.rr * (t.outcome === 'Win' ? 1 : t.outcome === 'Loss' ? -1 : 0);
    curve.push(+running.toFixed(2));
  }
  const topModel = Object.entries(modelMap).sort((a, b) => b[1] - a[1])[0];
  return { wins, losses, bes, net, wr, avgW, avgL, grossW, grossL, pf, apd, days, bestTrade, streak, dd, curve, topModel };
}

function getMonthFiltered() {
  return trades.filter(t => t.date.startsWith(new Date().toISOString().slice(0, 7)));
}

// ─── ANIMATED COUNTERS ──────────────────────────
function animateNumber(id, endVal, formatFn) {
  const el = document.getElementById(id);
  if (!el) return;
  // If value is not numeric (like PF '—'), just set text
  if (isNaN(endVal) || endVal === null) { el.textContent = formatFn(endVal); return; }
  
  const valStr = formatFn(endVal);
  // Odometer effect for dashboard cards
  if (id.startsWith('sv-')) {
    renderOdometer(el, valStr);
    el.dataset.val = endVal;
    if (id === 'sv-net') {
      el.classList.remove('stat-shimmer');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.classList.add('stat-shimmer');
          const clear = () => el.classList.remove('stat-shimmer');
          el.addEventListener('animationend', clear, { once: true });
          setTimeout(clear, 1000);
        });
      });
    }
    return;
  }

  const current = parseFloat(el.dataset.val || '0');
  if (current === endVal && el.textContent.trim() !== '') return;
  const start = current;
  const dur = 380;
  const t0 = performance.now();
  function step(t) {
    const u = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - u, 3);
    const v = start + (endVal - start) * eased;
    el.textContent = formatFn(v);
    if (u < 1) requestAnimationFrame(step);
    else { el.textContent = formatFn(endVal); el.dataset.val = endVal; }
  }
  requestAnimationFrame(step);
}

function renderOdometer(el, valStr) {
  const digits = valStr.split('');
  el.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'odo-wrap';
  digits.forEach(d => {
    if (isNaN(parseInt(d))) {
      const s = document.createElement('span'); s.textContent = d; s.style.fontFamily='var(--ff-mono)';
      wrap.appendChild(s);
    } else {
      const col = document.createElement('div');
      col.className = 'odo-col';
      for(let i=0; i<=9; i++) {
        const n = document.createElement('span'); n.className = 'odo-num'; n.textContent = i;
        col.appendChild(n);
      }
      const targetY = -(parseInt(d) * 1.3); // 1.3em height
      wrap.appendChild(col);
      setTimeout(() => col.style.transform = `translateY(${targetY}em)`, 10);
    }
  });
  el.appendChild(wrap);
}

// ─── SPARKLINE ────────────────────────────────
function renderSparkline(canvasId, data, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0,0, rect.width, rect.height);
  if (data.length < 2) return;
  const min = Math.min(...data), max = Math.max(...data), range = (max - min) || 1;
  const step = rect.width / (data.length - 1);
  // Resolve CSS variable colors to actual hex for canvas
  const tmp = document.createElement('span');
  tmp.style.color = color;
  document.body.appendChild(tmp);
  const resolved = getComputedStyle(tmp).color;
  document.body.removeChild(tmp);
  ctx.beginPath();
  ctx.strokeStyle = resolved; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
  data.forEach((v, i) => {
    const x = i * step;
    const y = rect.height - ((v - min) / range * (rect.height - 4)) - 2;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.lineTo(rect.width, rect.height); ctx.lineTo(0, rect.height); ctx.closePath();
  // Parse resolved rgb to add alpha for gradient
  const rgbMatch = resolved.match(/\d+/g);
  const gradColor = rgbMatch ? `rgba(${rgbMatch[0]},${rgbMatch[1]},${rgbMatch[2]},0.2)` : 'rgba(153,247,255,0.2)';
  const grad = ctx.createLinearGradient(0, 0, 0, rect.height);
  grad.addColorStop(0, gradColor); grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad; ctx.fill();
}

// ─── EFFECTS ──────────────────────────────────
function initEffects() {
  document.querySelectorAll('.stat-card').forEach(card => {
    let raf = null, ex = 0, ey = 0, lx = -1, ly = -1;
    card.addEventListener('mousemove', e => {
      const rect = card.getBoundingClientRect();
      ex = e.clientX - rect.left;
      ey = e.clientY - rect.top;
      if (lx >= 0 && Math.abs(ex - lx) < 3 && Math.abs(ey - ly) < 3) return;
      lx = ex; ly = ey;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        card.style.setProperty('--mouse-x', `${ex}px`);
        card.style.setProperty('--mouse-y', `${ey}px`);
      });
    }, { passive: true });
  });
}

function isDashboardActive() {
  const el = document.getElementById('dashboard');
  return !!(el && el.classList.contains('active'));
}

// ─── FEATURE 5: Period-over-period delta badges ───────────────────────────
function getPrevPeriodArr(p) {
  const now = new Date();
  if (p === 'month') {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const mo = d.toISOString().slice(0, 7);
    return trades.filter(t => t.date.startsWith(mo));
  }
  if (p === 'week') {
    const dow = now.getDay(), diff = dow === 0 ? -6 : 1 - dow;
    const thisMon = new Date(now); thisMon.setDate(now.getDate() + diff);
    const prevSun = new Date(thisMon); prevSun.setDate(thisMon.getDate() - 1);
    const prevMon = new Date(prevSun); prevMon.setDate(prevSun.getDate() - 6);
    return trades.filter(t => t.date >= prevMon.toISOString().slice(0,10) && t.date <= prevSun.toISOString().slice(0,10));
  }
  if (p === '90d') {
    const from = new Date(now); from.setDate(from.getDate() - 180);
    const to   = new Date(now); to.setDate(to.getDate() - 90);
    return trades.filter(t => t.date >= from.toISOString().slice(0,10) && t.date <= to.toISOString().slice(0,10));
  }
  return []; // 'all' — no meaningful prior period
}

function setDeltaBadge(id, cur, prev, fmt) {
  const el = document.getElementById(id); if (!el) return;
  if (prev === null || prev === undefined) { el.className = 'stat-delta flat'; el.textContent = ''; return; }
  const diff = cur - prev;
  if (Math.abs(diff) < 0.005) { el.className = 'stat-delta flat'; el.textContent = '—'; return; }
  const up = diff > 0;
  el.className = 'stat-delta ' + (up ? 'up' : 'down');
  el.textContent = (up ? '+' : '') + fmt(diff);
}

function renderStatDeltas(s, p) {
  if (p === 'all') {
    ['delta-wr','delta-pf','delta-net','delta-rr'].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = '';
    });
    return;
  }
  const prevArr = getPrevPeriodArr(p);
  if (!prevArr.length) {
    ['delta-wr','delta-pf','delta-net','delta-rr'].forEach(id => {
      const el = document.getElementById(id); if (el) { el.className='stat-delta flat'; el.textContent='no prior data'; }
    });
    return;
  }
  const ps = calcStats(prevArr);
  setDeltaBadge('delta-wr',  s.wr,   ps.wr,   v => v.toFixed(0) + 'pp');
  setDeltaBadge('delta-pf',  s.pf !== null ? s.pf : 0, ps.pf !== null ? ps.pf : 0, v => v.toFixed(2));
  setDeltaBadge('delta-net', s.net,  ps.net,  v => (v >= 0 ? '+' : '') + v.toFixed(2) + 'R');
  setDeltaBadge('delta-rr',  s.avgW, ps.avgW, v => (v >= 0 ? '+' : '') + v.toFixed(2) + 'R');
}

// ─── FEATURE 2: Live log preview ─────────────────────────────────────────────
let __logPreviewRaf = null;
function scheduleLogPreview() {
  if (__logPreviewRaf) cancelAnimationFrame(__logPreviewRaf);
  __logPreviewRaf = requestAnimationFrame(() => {
    __logPreviewRaf = null;
    logPreviewUpdate();
  });
}

function logPreviewUpdate() {
  const bar = document.getElementById('log-preview-bar'); if (!bar) return;
  const date  = document.getElementById('f-date')?.value;
  const pair  = document.getElementById('f-pair')?.value.trim();
  const rrRaw = parseFloat(document.getElementById('f-rr')?.value);
  const out   = segState.out;

  // Only show preview when date + pair + valid rr all filled
  if (!date || !pair || isNaN(rrRaw)) { bar.classList.remove('visible'); return; }

  const rr = Math.abs(rrRaw);
  // Build hypothetical trades array including this pending trade
  const todayIso = new Date().toISOString().slice(0,7);
  const monthTrades = trades.filter(t => t.date.startsWith(todayIso));
  const hypothetical = [...monthTrades, { id: '__preview__', date, pair, rr, outcome: out, sess: segState.sess, model: '' }];
  const cur = calcStats(monthTrades);
  const hyp = calcStats(hypothetical);

  const wrEl  = document.getElementById('lp-wr');
  const netEl = document.getElementById('lp-net');
  const ctEl  = document.getElementById('lp-ct');
  const pfEl  = document.getElementById('lp-pf');

  if (wrEl) {
    wrEl.textContent = hyp.wr.toFixed(0) + '%';
    wrEl.className = 'log-preview-val ' + (hyp.wr >= 50 ? 'val-tertiary' : 'val-error');
  }
  if (netEl) {
    netEl.textContent = fmt(hyp.net);
    netEl.className = 'log-preview-val ' + (hyp.net > 0 ? 'val-tertiary' : hyp.net < 0 ? 'val-error' : 'val-default');
  }
  if (ctEl) ctEl.textContent = hypothetical.length + ' trades';
  if (pfEl) pfEl.textContent = hyp.pf !== null ? hyp.pf.toFixed(2) : '∞';

  bar.classList.add('visible');
}

// ─── RENDER DASHBOARD ─────────────────────────
function renderDashboard() {
  if (!isDashboardActive()) return;

  const arr = getFiltered(period);
  const s   = calcStats(arr);
  const ms  = calcStats(getMonthFiltered());

  // Stat cards
  animateNumber('sv-wr', s.wr, v => v.toFixed(0) + '%');
  document.getElementById('sv-wr').className = 'stat-card-val ' + (s.wr >= 50 ? 'val-tertiary' : 'val-error');
  set('sv-wr-s', `${s.wins.length}W / ${s.losses.length}L / ${s.bes.length}BE`);

  const pfEl = document.getElementById('sv-pf');
  if (s.pf !== null) {
    animateNumber('sv-pf', s.pf, v => v.toFixed(2));
    if (pfEl) pfEl.className = 'stat-card-val ' + (s.pf >= 1 ? 'val-primary' : 'val-error');
  } else {
    set('sv-pf', '—');
    if (pfEl) pfEl.className = 'stat-card-val val-default';
  }

  const netEl = document.getElementById('sv-net');
  if (netEl) netEl.className = 'stat-card-val ' + (s.net > 0 ? 'val-tertiary' : s.net < 0 ? 'val-error' : 'val-default');
  animateNumber('sv-net', s.net, v => fmt(v));
  set('sv-net-s', `${arr.length} trades`);

  animateNumber('sv-rr', s.avgW, v => fmtR(v));
  set('sv-ct-s', `${s.days.length} trading days`);

  // Feature 5: period-over-period delta badges
  renderStatDeltas(s, period);

  // Phase 6: Dynamic Background & Sparklines
  const cardNet = document.getElementById('card-net');
  if (cardNet) {
    const bgClr = s.net > 0 ? 'rgba(175,255,209,0.08)' : s.net < 0 ? 'rgba(255,113,108,0.08)' : 'var(--surface-container)';
    cardNet.style.setProperty('--card-bg', bgClr);
    if (s.curve && s.curve.length > 1) {
      renderSparkline('spark-net', s.curve.slice(-12), s.net >= 0 ? 'var(--tertiary)' : 'var(--error)');
    }
  }

  // Eval panel (month)
  animateNumber('ev-total', ms.wins.length + ms.losses.length + ms.bes.length, v => Math.round(v));
  animateNumber('ev-apd', ms.apd, v => fmt(v));
  const apdEl = document.getElementById('ev-apd');
  if (apdEl) apdEl.className = 'eval-val ' + clr(ms.apd);
  set('ev-best', ms.bestTrade ? `${ms.bestTrade.pair} +${ms.bestTrade.rr}R` : '—');
  animateNumber('ev-rr', ms.avgW, v => fmtR(v));
  animateNumber('ev-dd', ms.dd, v => '-' + fmtR(v));
  set('ev-model', ms.topModel ? `${ms.topModel[0]} (${ms.topModel[1]}W)` : '—');

  const sd = document.getElementById('ev-streak');
  if (sd) sd.innerHTML = ms.streak.map(x => `<div class="sdot ${x}">${x}</div>`).join('');

  // Recent execution log (cross-highlight ↔ equity / drawdown)
  renderExecLog(arr);
  initExecLogHighlight();

  if (window.__pcChartsRaf2) cancelAnimationFrame(window.__pcChartsRaf2);
  if (window.__pcChartsRaf1) cancelAnimationFrame(window.__pcChartsRaf1);
  window.__pcChartsRaf1 = requestAnimationFrame(() => {
    window.__pcChartsRaf1 = null;
    window.__pcChartsRaf2 = requestAnimationFrame(() => {
      window.__pcChartsRaf2 = null;
      try {
        renderCharts(arr, s);
      } catch (e) {
        console.error('[ProfCorner] renderCharts', e);
      }
      try {
        renderCalendar();
      } catch (e2) {
        console.error('[ProfCorner] renderCalendar', e2);
      }
      scheduleChartResize();
    });
  });
}

function setExecHighlightIndex(dataIndex) {
  if (__execHighlightLast === dataIndex) return;
  __execHighlightLast = dataIndex;
  window.__execChartHighlight = dataIndex;
  ['equity', 'drawdown'].forEach(k => {
    const c = chartInst[k];
    if (!c || !c.options.plugins?.annotation?.annotations?.highlightExec) return;
    const h = c.options.plugins.annotation.annotations.highlightExec;
    const show = dataIndex != null && dataIndex >= 0;
    h.display = show;
    h.value = show ? dataIndex : -1;
    c.update('none');
  });
}

function initExecLogHighlight() {
  const el = document.getElementById('exec-log-list');
  if (!el || el.dataset.execHlBound) return;
  el.dataset.execHlBound = '1';
  let lastRow = null;
  el.addEventListener('mouseover', e => {
    const row = e.target.closest('.exec-entry');
    if (!row || !row.dataset.curveIdx) return;
    const idx = parseInt(row.dataset.curveIdx, 10);
    if (Number.isNaN(idx)) return;
    if (lastRow) lastRow.classList.remove('exec-linked-hover');
    lastRow = row;
    row.classList.add('exec-linked-hover');
    setExecHighlightIndex(idx);
  });
  el.addEventListener('mouseout', e => {
    const row = e.target.closest('.exec-entry');
    const to = e.relatedTarget;
    if (row) row.classList.remove('exec-linked-hover');
    if (!el.contains(to)) {
      lastRow = null;
      setExecHighlightIndex(null);
    }
  });
}

function renderExecLog(periodArr) {
  const el = document.getElementById('exec-log-list');
  if (!el) return;
  const sortedChrono = [...(periodArr || trades)].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const idToCurveIdx = new Map();
  sortedChrono.forEach((t, i) => idToCurveIdx.set(t.id, i + 1));
  const n = sortedChrono.length;
  const recent = n <= 8 ? sortedChrono.slice().reverse() : sortedChrono.slice(-8).reverse();
  if (!recent.length) {
    el.innerHTML = '<div class="empty" style="padding:20px 0"><span style="font-size:20px;display:block;margin-bottom:8px;opacity:.15">📋</span>No trades yet</div>';
    return;
  }
  el.innerHTML = recent.map(t => {
    const rv = t.rr * (t.outcome === 'Win' ? 1 : t.outcome === 'Loss' ? -1 : 0);
    const rvTxt = (rv >= 0 ? '+' : '') + rv.toFixed(2) + 'R';
    const barCls = t.outcome === 'Win' ? 'w' : t.outcome === 'Loss' ? 'l' : 'b';
    const rvCls  = t.outcome === 'Win' ? 'style="color:var(--tertiary)"' : t.outcome === 'Loss' ? 'style="color:var(--error)"' : 'style="color:var(--primary)"';
    const cidx = idToCurveIdx.get(t.id);
    return `<div class="exec-entry" data-curve-idx="${cidx != null ? cidx : ''}">
      <div class="exec-bar ${barCls}"></div>
      <div style="flex:1">
        <div class="exec-pair">${t.dir} ${t.pair}</div>
        <div class="exec-meta">${t.date} · ${t.sess}${t.model ? ' · ' + t.model : ''}</div>
      </div>
      <div class="exec-r" ${rvCls}>${rvTxt}</div>
    </div>`;
  }).join('');
}

function toggleFocusMode() {
  const dash = document.getElementById('dashboard');
  if (!dash) return;
  if (!dash.classList.contains('active')) showPage('dashboard');
  dash.classList.toggle('focus-mode');
  try { localStorage.setItem('profsCorner_focus', dash.classList.contains('focus-mode') ? '1' : '0'); } catch {}
}

function streakTradeBuckets(arr) {
  const sorted = [...arr].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const out = { w1: [], w2: [], w3: [], w4p: [], l1: [], l2: [], l3: [], l4p: [] };
  let curW = [], curL = [];
  function flushWin() {
    if (!curW.length) return;
    const n = curW.length;
    const copy = curW.slice();
    if (n === 1) out.w1.push(...copy);
    else if (n === 2) out.w2.push(...copy);
    else if (n === 3) out.w3.push(...copy);
    else out.w4p.push(...copy);
    curW = [];
  }
  function flushLoss() {
    if (!curL.length) return;
    const n = curL.length;
    const copy = curL.slice();
    if (n === 1) out.l1.push(...copy);
    else if (n === 2) out.l2.push(...copy);
    else if (n === 3) out.l3.push(...copy);
    else out.l4p.push(...copy);
    curL = [];
  }
  sorted.forEach(t => {
    if (t.outcome === 'Win') {
      flushLoss();
      curW.push(t);
    } else if (t.outcome === 'Loss') {
      flushWin();
      curL.push(t);
    } else {
      flushWin();
      flushLoss();
    }
  });
  flushWin();
  flushLoss();
  return out;
}

function showStreakDrill(isWin, barIdx, buckets) {
  const panel = document.getElementById('streak-drill-panel');
  if (!panel) return;
  const keys = isWin ? ['w1', 'w2', 'w3', 'w4p'] : ['l1', 'l2', 'l3', 'l4p'];
  const key = keys[barIdx];
  const list = (buckets && buckets[key]) ? buckets[key] : [];
  const label = isWin ? 'Win streak' : 'Loss streak';
  const sizes = ['1×', '2×', '3×', '4×+'];
  if (!list.length) {
    panel.hidden = true;
    panel.innerHTML = '';
    return;
  }
  panel.hidden = false;
  const uniq = [];
  const seen = new Set();
  list.forEach(t => { if (!seen.has(t.id)) { seen.add(t.id); uniq.push(t); } });
  panel.innerHTML = `<div class="streak-drill-title">${label} ${sizes[barIdx]} — ${uniq.length} trade(s)</div>` +
    uniq.slice(0, 24).map(t => {
      const rv = t.rr * (t.outcome === 'Win' ? 1 : t.outcome === 'Loss' ? -1 : 0);
      const rvTxt = (rv >= 0 ? '+' : '') + rv.toFixed(2) + 'R';
      return `<div class="streak-drill-row"><span>${t.date} · ${t.pair}</span><span>${rvTxt}</span></div>`;
    }).join('') + (uniq.length > 24 ? `<div style="opacity:.6;margin-top:6px">+ ${uniq.length - 24} more…</div>` : '');
}

function heatmapCellStyle(net, maxAbs) {
  if (maxAbs < 1e-6) return 'background:rgba(29,39,48,.55);color:var(--outline)';
  const t = Math.min(1, Math.abs(net) / maxAbs);
  if (net >= 0) {
    const r = Math.round(90 + (175 - 90) * t), g = Math.round(200 + (255 - 200) * t), b = Math.round(180 + (209 - 180) * t);
    const a = 0.14 + t * 0.38;
    return `background:rgba(${r},${g},${b},${a});color:#e8fff4`;
  }
  const r = 255, g = Math.round(180 - 70 * t), b = Math.round(140 - 35 * t);
  const a = 0.14 + t * 0.4;
  return `background:rgba(${r},${g},${b},${a});color:#ffecec`;
}

// ─── CHARTS ───────────────────────────────────
const CD = {
  layout: {
    padding: { top: 6, right: 10, bottom: 20, left: 8 }
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#172129', borderColor: 'rgba(66,73,80,.3)', borderWidth: 1,
      titleColor: '#a5acb4', bodyColor: '#eef4fd',
      bodyFont: { family: 'JetBrains Mono', size: 11 },
      titleFont: { family: 'JetBrains Mono', size: 9 }
    }
  },
  scales: {
    x: { grid: { color: 'rgba(255,255,255,.03)', drawBorder: false }, ticks: { color: '#424950', font: { family: 'JetBrains Mono', size: 9 } }, border: { display: false } },
    y: { grid: { color: 'rgba(255,255,255,.03)', drawBorder: false }, ticks: { color: '#424950', font: { family: 'JetBrains Mono', size: 9 } }, border: { display: false } }
  },
  animation: { duration: 0, easing: 'easeOutQuart' },
  responsive: true, maintainAspectRatio: false
};

/** Canvas gradient fills for bar / doughnut / bubble (pairs with premiumShapeGlow in premium.js). */
function pcParseRgba(s) {
  if (!s) return null;
  const m = String(s).match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
  if (String(s).startsWith('#') && String(s).length === 7) {
    const h = s.slice(1);
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  return null;
}
function pcFmtRgba(o) {
  return `rgba(${Math.round(o.r)},${Math.round(o.g)},${Math.round(o.b)},${Math.min(1, o.a).toFixed(3)})`;
}
/** Vertical bar fill: gradient uses chart area (always valid) — avoids empty bars before element layout / hover. */
function pcBarGradientV(chart, baseStr) {
  const ctx = chart.ctx;
  const ca = chart.chartArea;
  const base = pcParseRgba(baseStr) || { r: 153, g: 247, b: 255, a: 0.72 };
  if (!ca || ![ca.top, ca.bottom].every(n => typeof n === 'number' && Number.isFinite(n))) return pcFmtRgba(base);
  const g = ctx.createLinearGradient(0, ca.top, 0, ca.bottom);
  g.addColorStop(0, pcFmtRgba({ r: Math.min(255, base.r * 1.22), g: Math.min(255, base.g * 1.14), b: Math.min(255, base.b * 1.1), a: Math.min(1, base.a * 1.06) }));
  g.addColorStop(1, pcFmtRgba({ r: base.r * 0.52, g: base.g * 0.56, b: base.b * 0.6, a: base.a * 0.9 }));
  return g;
}
/** Horizontal bar chart (indexAxis: 'y'): left→right gradient from chart area. */
function pcBarGradientH(chart, baseStr) {
  const ctx = chart.ctx;
  const ca = chart.chartArea;
  const base = pcParseRgba(baseStr) || { r: 175, g: 255, b: 209, a: 0.72 };
  if (!ca || ![ca.left, ca.right].every(n => typeof n === 'number' && Number.isFinite(n))) return pcFmtRgba(base);
  const g = ctx.createLinearGradient(ca.left, 0, ca.right, 0);
  g.addColorStop(0, pcFmtRgba({ r: Math.min(255, base.r * 1.2), g: Math.min(255, base.g * 1.12), b: Math.min(255, base.b * 1.08), a: Math.min(1, base.a * 1.04) }));
  g.addColorStop(1, pcFmtRgba({ r: base.r * 0.5, g: base.g * 0.54, b: base.b * 0.58, a: base.a * 0.88 }));
  return g;
}
function pcDoughnutRadial(ctx, chart, datasetIndex, dataIndex, baseStr) {
  const base = pcParseRgba(baseStr) || { r: 153, g: 247, b: 255, a: 0.65 };
  const meta = chart.getDatasetMeta(datasetIndex);
  const arc = meta.data[dataIndex];
  if (!arc || typeof arc.getProps !== 'function') return baseStr;
  const { x, y, innerRadius, outerRadius } = arc.getProps(['x', 'y', 'innerRadius', 'outerRadius'], true);
  if (![x, y, innerRadius, outerRadius].every(n => typeof n === 'number' && Number.isFinite(n))) return baseStr;
  const g = ctx.createRadialGradient(x, y, innerRadius, x, y, outerRadius);
  g.addColorStop(0, pcFmtRgba({ r: Math.min(255, base.r * 1.28), g: Math.min(255, base.g * 1.2), b: Math.min(255, base.b * 1.16), a: Math.min(1, base.a * 1.12) }));
  g.addColorStop(0.55, pcFmtRgba({ r: base.r * 0.92, g: base.g * 0.94, b: base.b * 0.96, a: base.a }));
  g.addColorStop(1, pcFmtRgba({ r: base.r * 0.42, g: base.g * 0.48, b: base.b * 0.52, a: base.a * 0.86 }));
  return g;
}
function pcBubbleRadial(ctx, chart, datasetIndex, dataIndex, baseStr) {
  const base = pcParseRgba(baseStr) || { r: 153, g: 247, b: 255, a: 0.52 };
  const meta = chart.getDatasetMeta(datasetIndex);
  const pt = meta.data[dataIndex];
  if (!pt || typeof pt.getProps !== 'function') return baseStr;
  const props = pt.getProps(['x', 'y', 'width', 'height'], true);
  const { x, y, width, height } = props;
  if (![x, y].every(n => typeof n === 'number' && Number.isFinite(n))) return baseStr;
  const w = typeof width === 'number' && Number.isFinite(width) ? width : (typeof height === 'number' ? height : 18);
  const r = Math.max(5, w / 2);
  const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
  g.addColorStop(0, pcFmtRgba({ r: Math.min(255, base.r * 1.32), g: Math.min(255, base.g * 1.24), b: Math.min(255, base.b * 1.18), a: Math.min(1, base.a * 1.18) }));
  g.addColorStop(0.62, pcFmtRgba(base));
  g.addColorStop(1, pcFmtRgba({ r: base.r * 0.48, g: base.g * 0.52, b: base.b * 0.58, a: base.a * 0.82 }));
  return g;
}

let __pnlBackdropReq = 0;
function applyPnlBackdrop(relPath) {
  const sc = document.getElementById('sc-el');
  if (!sc) return;
  const my = ++__pnlBackdropReq;
  if (!relPath) {
    sc.classList.remove('has-sc-pnl-bg');
    sc.style.removeProperty('--sc-pnl-bg-img');
    return;
  }
  const url = pnlBackdropUrlFromRelPath(relPath);
  const img = new Image();
  img.onload = () => {
    if (my !== __pnlBackdropReq) return;
    sc.classList.add('has-sc-pnl-bg');
    sc.style.setProperty('--sc-pnl-bg-img', `url("${url}")`);
  };
  img.onerror = () => {
    if (my !== __pnlBackdropReq) return;
    sc.classList.remove('has-sc-pnl-bg');
    sc.style.removeProperty('--sc-pnl-bg-img');
    toast('PnL backdrop failed to load. Run server.ps1 and open http://127.0.0.1:8020/ — or update assets/pnl-card-manifest.json paths. ✗');
  };
  img.src = url;
}

/** In-memory base64 for the selected PnL backdrop — avoids canvas taint on export */
let __pnlBackdropBase64 = null;

async function preloadBackdropBase64(relPath) {
  if (!relPath) { __pnlBackdropBase64 = null; return; }
  const url = pnlBackdropUrlFromRelPath(relPath);
  if (!url) { __pnlBackdropBase64 = null; return; }
  try {
    const res = await fetch(url, { credentials: 'same-origin', cache: 'force-cache' });
    if (!res.ok) throw new Error('not ok');
    const blob = await res.blob();
    if (!blob || !blob.size) throw new Error('empty');
    const b64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject();
      reader.readAsDataURL(blob);
    });
    __pnlBackdropBase64 = b64;
    pcDbg('Backdrop preloaded as base64', relPath, b64.length, 'chars');
  } catch (e) {
    __pnlBackdropBase64 = null;
    pcDbg('Backdrop preload failed (fetch unavailable? path?)', relPath, e.message || e);
  }
}

async function initPnlCardBackgrounds() {
  const sel = document.getElementById('pnl-bg-select-sc');
  if (!sel) return;
  const PNL_IMG_FALLBACK = [
    'PnL Card/Ascenssion.jpeg',
    'PnL Card/Black hole.jpeg',
    'PnL Card/Chess Knight.jpeg',
    'PnL Card/Donald duck.jpeg',
    'PnL Card/Red eyed.jpeg',
    'PnL Card/White knight.jpeg'
  ];
  let list = [];
  try {
    const r = await fetch('assets/pnl-card-manifest.json', { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      if (Array.isArray(j) && j.length) list = j;
    }
  } catch (e) {}
  if (!Array.isArray(list) || !list.length) list = PNL_IMG_FALLBACK.slice();
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const optionsHtml = '<option value="">None</option>' + list.map(p => {
    const label = esc(p.replace(/^PnL Card\//i, '').replace(/\.(jpe?g|png|webp)$/i, ''));
    return `<option value="${encodeURIComponent(p)}">${label}</option>`;
  }).join('');
  sel.innerHTML = optionsHtml;
  let saved = getPnlBgStoredEncoded();
  try {
    if (saved && !localStorage.getItem(PNL_BG_KEY) && localStorage.getItem(PNL_BG_LEGACY_KEY)) {
      localStorage.setItem(PNL_BG_KEY, saved);
    }
  } catch (e) {}
  if (saved && [...sel.options].some(o => o.value === saved)) sel.value = saved;
  else { sel.value = ''; saved = ''; }
  sel.addEventListener('change', () => {
    const v = sel.value;
    try { localStorage.setItem(PNL_BG_KEY, v); } catch (e) {}
    const relPath = v ? decodeURIComponent(v) : '';
    applyPnlBackdrop(relPath);
    preloadBackdropBase64(relPath); // preload for canvas export
  });
  const initRelPath = saved ? decodeURIComponent(saved) : '';
  applyPnlBackdrop(initRelPath);
  if (initRelPath) preloadBackdropBase64(initRelPath); // preload saved selection on startup
}

function destroyChart(key) { if (chartInst[key]) { chartInst[key].destroy(); delete chartInst[key]; } }

let bentoState = { r3_left: 'monthly', r3_right: 'models', r4_left: 'streak', r4_right: 'alpha' };

function renderCharts(arr, s) {
  renderEquity(arr, s);
  renderDrawdown(arr, s);
  renderRolling(arr);

  if (bentoState.r3_left === 'monthly') {
    destroyChart('weekday');
    renderMonthly(arr);
  } else {
    destroyChart('monthly');
    renderWeekday(arr);
  }
  if (bentoState.r3_right === 'models') {
    destroyChart('sessions');
    renderModels(arr);
  } else {
    destroyChart('models');
    renderSessions(arr);
  }
  if (bentoState.r4_left === 'streak') {
    destroyChart('dist');
    renderStreak(arr);
  } else {
    destroyChart('streak');
    renderDist(arr, s);
  }
  if (bentoState.r4_right === 'alpha') {
    destroyChart('sweet');
    renderAlpha(arr);
  } else {
    destroyChart('alpha');
    renderSweetSpot(arr);
  }

  renderHeatMap(arr);
}

function refreshBentoChartsForRow(rowKey) {
  const arr = getFiltered(period);
  const s = calcStats(arr);
  if (rowKey === 'r3_left') {
    if (bentoState.r3_left === 'monthly') {
      destroyChart('weekday');
      renderMonthly(arr);
    } else {
      destroyChart('monthly');
      renderWeekday(arr);
    }
  } else if (rowKey === 'r3_right') {
    if (bentoState.r3_right === 'models') {
      destroyChart('sessions');
      renderModels(arr);
    } else {
      destroyChart('models');
      renderSessions(arr);
    }
  } else if (rowKey === 'r4_left') {
    if (bentoState.r4_left === 'streak') {
      destroyChart('dist');
      renderStreak(arr);
    } else {
      destroyChart('streak');
      renderDist(arr, s);
    }
  } else if (rowKey === 'r4_right') {
    if (bentoState.r4_right === 'alpha') {
      destroyChart('sweet');
      renderAlpha(arr);
    } else {
      destroyChart('alpha');
      renderSweetSpot(arr);
    }
  }
  scheduleChartResize();
}

function switchBento(rowKey, chartKey, evt) {
  bentoState[rowKey] = chartKey;
  const targetChart = document.querySelector(`.bento-chart[data-bento="${rowKey}_${chartKey}"]`);
  if (!targetChart) return;
  const parentCard = targetChart.closest('.bento-card');
  
  parentCard.querySelectorAll('.win-btn').forEach(b => b.classList.remove('on'));
  const btn = evt && evt.currentTarget ? evt.currentTarget : null;
  if (btn) btn.classList.add('on');
  
  parentCard.querySelectorAll('.bento-chart').forEach(c => c.classList.remove('on'));
  targetChart.classList.add('on');
  refreshBentoChartsForRow(rowKey);
}

function renderSweetSpot(arr) {
  destroyChart('sweet');
  const canvas = document.getElementById('c-sweet'); if (!canvas) return;
  const modData = {};
  arr.forEach(t => {
    if(!t.model) return;
    if(!modData[t.model]) modData[t.model] = { rSum:0, cnt:0, w:0 };
    modData[t.model].cnt++;
    if(t.outcome==='Win') { modData[t.model].w++; modData[t.model].rSum += t.rr; }
    else if(t.outcome==='Loss') { modData[t.model].rSum -= t.rr; }
  });
  const bubbleData = Object.entries(modData).map(([name, d]) => ({
    x: +(d.rSum / d.cnt).toFixed(2), // Avg R
    y: +(d.w / d.cnt * 100).toFixed(0), // Win Rate
    r: Math.min(25, 4 + d.cnt), // Size
    label: name
  }));
  const bubBase = 'rgba(153,247,255,0.52)';
  chartInst.sweet = new Chart(canvas, {
    type: 'bubble',
    data: { datasets: [{ label: 'Models', data: bubbleData, backgroundColor: (c) => pcBubbleRadial(c.chart.ctx, c.chart, c.datasetIndex, c.dataIndex, bubBase), borderColor: 'rgba(153,247,255,.55)', borderWidth: 1.5 }] },
    options: {
      ...CD,
      scales: {
        x: { ...CD.scales.x, display: true, title: { display: true, text: 'Avg R-Multiple', color: 'var(--outline)', font: { size: 9 } } },
        y: { ...CD.scales.y, display: true, title: { display: true, text: 'Win Rate %', color: 'var(--outline)', font: { size: 9 } }, min: 0, max: 100 }
      },
      plugins: { ...CD.plugins, tooltip: { ...CD.plugins.tooltip, callbacks: { label: ctx => `${ctx.raw.label}: ${ctx.raw.y}% WR / ${ctx.raw.x}R Avg` } } }
    }
  });
}

function renderHeatMap(arr) {
  const el = document.getElementById('hmap-container');
  if (!el) return;
  if (!arr.length) { el.innerHTML = '<div class="empty">No data for heatmap</div>'; return; }

  const pairsAll = [...new Set(arr.map(t => t.pair))].sort();
  const HMAP_MAX_ROWS = 55;
  const pairSlice = pairsAll.length > HMAP_MAX_ROWS ? pairsAll.slice(0, HMAP_MAX_ROWS) : pairsAll;
  const weeks = [];
  const now = new Date();
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - (i * 7));
    weeks.push(d.toISOString().slice(0, 10));
  }
  const weekEnds = weeks.map(w => {
    const end = new Date(w); end.setDate(end.getDate() + 7);
    return end.toISOString().slice(0, 10);
  });

  function weekIndexFor(dateStr) {
    for (let i = 0; i < weeks.length; i++) {
      if (dateStr >= weeks[i] && dateStr < weekEnds[i]) return i;
    }
    return -1;
  }

  const cellNet = new Map();
  arr.forEach(t => {
    const wi = weekIndexFor(t.date);
    if (wi < 0) return;
    const rv = t.rr * (t.outcome === 'Win' ? 1 : t.outcome === 'Loss' ? -1 : 0);
    const k = t.pair + '\x00' + wi;
    cellNet.set(k, (cellNet.get(k) || 0) + rv);
  });

  let maxAbs = 1e-6;
  pairSlice.forEach(p => {
    for (let wi = 0; wi < weeks.length; wi++) {
      const net = cellNet.get(p + '\x00' + wi) || 0;
      const a = Math.abs(net);
      if (a > maxAbs) maxAbs = a;
    }
  });

  let html = `<table class="hmap"><thead><tr><th class="hmap-row-lbl">Asset / Week</th>`;
  weeks.forEach(w => { html += `<th>W-${w.slice(5, 10)}</th>`; });
  html += `</tr></thead><tbody>`;

  pairSlice.forEach(p => {
    html += `<tr><td class="hmap-row-lbl">${p}</td>`;
    weeks.forEach((w, wi) => {
      const net = cellNet.get(p + '\x00' + wi) || 0;
      const st = heatmapCellStyle(net, maxAbs);
      html += `<td class="hm-cell" style="${st}" title="${p} (${w}): ${net.toFixed(1)}R">${net ? net.toFixed(1) : '·'}</td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table>`;
  if (pairsAll.length > HMAP_MAX_ROWS) {
    html += `<div class="hmap-cap-note" style="font-size:9px;color:var(--outline);font-family:var(--ff-mono);margin-top:8px;opacity:.85">Showing first ${HMAP_MAX_ROWS} pairs (alphabetically). ${pairsAll.length - HMAP_MAX_ROWS} more in range — narrow period filter to focus.</div>`;
  }
  el.innerHTML = html;
}

function renderEquity(arr, s) {
  destroyChart('equity');
  __equityCrosshairIdx = -2;
  const canvas = document.getElementById('c-equity'); if (!canvas || s.curve.length <= 1) return;
  const isPos = s.net >= 0, color = isPos ? '#99f7ff' : '#ff716c';
  const ptBase = s.curve.length <= 20 ? 3 : 0;
  chartInst.equity = new Chart(canvas, {
    type: 'line',
    data: {
      labels: s.curve.map((_, i) => i === 0 ? 'Start' : 'T' + i),
      datasets: [{
        data: s.curve, borderColor: color, borderWidth: 2, fill: true, tension: 0.4,
        pointRadius: ctx => {
          const h = window.__execChartHighlight;
          if (h != null && h >= 0 && ctx.dataIndex === h) return 10;
          return ptBase;
        },
        pointHoverRadius: ctx => {
          const h = window.__execChartHighlight;
          if (h != null && h >= 0 && ctx.dataIndex === h) return 12;
          return 5;
        },
        pointBackgroundColor: ctx => {
          const h = window.__execChartHighlight;
          if (h != null && h >= 0 && ctx.dataIndex === h) return 'rgba(153,247,255,.95)';
          return color;
        },
        pointBorderColor: ctx => {
          const h = window.__execChartHighlight;
          if (h != null && h >= 0 && ctx.dataIndex === h) return '#e8ffff';
          return color;
        },
        backgroundColor: ctx => {
          const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 220);
          if (isPos) {
            g.addColorStop(0, 'rgba(153,247,255,.22)');
            g.addColorStop(0.45, 'rgba(99,255,236,.12)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
          } else {
            g.addColorStop(0, 'rgba(255,113,108,.2)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
          }
          return g;
        }
      }]
    },
    options: {
      ...CD,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        ...CD.plugins,
        tooltip: {
          ...CD.plugins.tooltip,
          callbacks: {
            title: items => items[0].label === 'Start' ? 'Initial Balance' : `Trade #${items[0].label.slice(1)}`,
            label: ctx => `Cumulative: ${ctx.raw.toFixed(2)}R`
          }
        },
        annotation: {
          annotations: {
            crosshair: {
              type: 'line', scaleID: 'x', value: -1,
              borderColor: 'rgba(153,247,255,.3)', borderWidth: 1, borderDash: [4, 4],
              display: (ctx) => ctx.chart.getActiveElements().length > 0
            },
            highlightExec: {
              type: 'line', scaleID: 'x', value: -1,
              borderColor: 'rgba(153,247,255,.9)', borderWidth: 2, borderDash: [5, 3],
              display: false
            }
          }
        }
      },
      onHover: (e, items) => {
        if (!chartInst.equity) return;
        const ann = chartInst.equity.options.plugins.annotation.annotations.crosshair;
        const idx = items.length > 0 ? items[0].index : -1;
        if (idx === __equityCrosshairIdx) return;
        __equityCrosshairIdx = idx;
        if (items.length > 0) {
          ann.value = idx;
          chartInst.equity.update('none');
        } else if (ann.value !== -1) {
          ann.value = -1;
          chartInst.equity.update('none');
        }
      },
      scales: {
        x: { ...CD.scales.x, display: false },
        y: { ...CD.scales.y, ticks: { ...CD.scales.y.ticks, callback: v => v.toFixed(1) + 'R' } }
      }
    }
  });
}

function renderDrawdown(arr, s) {
  destroyChart('drawdown');
  const canvas = document.getElementById('c-drawdown'); if (!canvas || s.curve.length <= 1) return;

  // Calculate drawdown curve from equity
  const ddCurve = [];
  let peak = -Infinity;
  s.curve.forEach(v => {
    if (v > peak) peak = v;
    ddCurve.push(+(v - peak).toFixed(2)); // always 0 or negative
  });

  // Color zones: find max drawdown depth
  const maxDD = Math.min(...ddCurve);

  chartInst.drawdown = new Chart(canvas, {
    type: 'line',
    data: {
      labels: ddCurve.map((_, i) => i === 0 ? 'Start' : 'T' + i),
      datasets: [{
        data: ddCurve, borderColor: '#ff716c', borderWidth: 1.5, fill: true, tension: 0.3,
        pointRadius: ctx => {
          const h = window.__execChartHighlight;
          if (h != null && h >= 0 && ctx.dataIndex === h) return 8;
          return 0;
        },
        pointHoverRadius: ctx => {
          const h = window.__execChartHighlight;
          if (h != null && h >= 0 && ctx.dataIndex === h) return 10;
          return 4;
        },
        pointBackgroundColor: ctx => {
          const h = window.__execChartHighlight;
          if (h != null && h >= 0 && ctx.dataIndex === h) return 'rgba(153,247,255,.9)';
          return '#ff716c';
        },
        pointBorderColor: ctx => {
          const h = window.__execChartHighlight;
          if (h != null && h >= 0 && ctx.dataIndex === h) return '#e8ffff';
          return '#ff716c';
        },
        backgroundColor: ctx => {
          const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 220);
          g.addColorStop(0, 'rgba(255,113,108,.05)');
          g.addColorStop(1, 'rgba(255,113,108,.25)');
          return g;
        }
      }]
    },
    options: {
      ...CD,
      layout: { padding: { ...CD.layout.padding, bottom: 32 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        ...CD.plugins,
        tooltip: {
          ...CD.plugins.tooltip,
          callbacks: {
            title: items => items[0].label === 'Start' ? 'Initial' : `Trade #${items[0].label.slice(1)}`,
            label: ctx => `Drawdown: ${ctx.raw.toFixed(2)}R`
          }
        },
        annotation: {
          annotations: {
            maxLine: {
              type: 'line', yMin: maxDD, yMax: maxDD,
              borderColor: 'rgba(255,113,108,.4)', borderWidth: 1, borderDash: [6, 3],
              label: {
                display: true, content: `Max DD: ${maxDD.toFixed(2)}R`,
                position: 'start', backgroundColor: 'rgba(255,113,108,.15)',
                color: '#ff716c', font: { family: 'JetBrains Mono', size: 9, weight: 700 },
                padding: { top: 2, bottom: 2, left: 6, right: 6 }
              }
            },
            highlightExec: {
              type: 'line', scaleID: 'x', value: -1,
              borderColor: 'rgba(153,247,255,.85)', borderWidth: 2, borderDash: [5, 3],
              display: false
            }
          }
        }
      },
      scales: {
        x: { ...CD.scales.x, display: false },
        y: {
          ...CD.scales.y,
          max: 0,
          ticks: { ...CD.scales.y.ticks, callback: v => v.toFixed(1) + 'R' }
        }
      }
    }
  });

  // Sparkline for DD tab
  renderSparkline('tab-spark-dd', ddCurve, '#ff716c');
}

function renderMonthly(arr) {
  destroyChart('monthly');
  const canvas = document.getElementById('c-monthly'); if (!canvas) return;
  const mMap = {};
  arr.forEach(t => { const mo = t.date.slice(0, 7); const rv = t.rr * (t.outcome === 'Win' ? 1 : t.outcome === 'Loss' ? -1 : 0); mMap[mo] = (mMap[mo] || 0) + rv; });
  const labels = Object.keys(mMap).sort(), data = labels.map(k => +mMap[k].toFixed(2));
  const colors = data.map(v => v >= 0 ? 'rgba(175,255,209,.68)' : 'rgba(255,113,108,.72)');
  const barFill = (c) => pcBarGradientV(c.chart, colors[c.dataIndex]);
  chartInst.monthly = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: barFill,
        hoverBackgroundColor: barFill,
        borderColor: 'rgba(255,255,255,.16)',
        hoverBorderColor: 'rgba(255,255,255,.2)',
        borderWidth: 1,
        hoverBorderWidth: 1,
        borderRadius: 4,
        borderSkipped: false
      }]
    },
    options: {
      ...CD,
      elements: { bar: { borderWidth: 1, hoverBorderWidth: 1 } },
      plugins: { ...CD.plugins, tooltip: { ...CD.plugins.tooltip, callbacks: { label: ctx => ctx.raw.toFixed(2) + 'R' } } },
      scales: { x: { ...CD.scales.x }, y: { ...CD.scales.y, ticks: { ...CD.scales.y.ticks, callback: v => v.toFixed(1) + 'R' } } }
    }
  });
}

function renderModels(arr) {
  destroyChart('models');
  const canvas = document.getElementById('c-models'); if (!canvas) return;
  const mMap = {};
  arr.forEach(t => { if (t.model) { if (!mMap[t.model]) mMap[t.model] = { w: 0, l: 0 }; if (t.outcome === 'Win') mMap[t.model].w++; else if (t.outcome === 'Loss') mMap[t.model].l++; } });
  const entries = Object.entries(mMap).sort((a, b) => (b[1].w + b[1].l) - (a[1].w + a[1].l)).slice(0, 8);
  if (!entries.length) return;
  const winC = 'rgba(175,255,209,.72)', lossC = 'rgba(255,113,108,.75)';
  const winFill = (c) => pcBarGradientH(c.chart, winC);
  const lossFill = (c) => pcBarGradientH(c.chart, lossC);
  chartInst.models = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: entries.map(e => e[0]),
      datasets: [
        {
          label: 'Wins',
          data: entries.map(e => e[1].w),
          backgroundColor: winFill,
          hoverBackgroundColor: winFill,
          borderColor: 'rgba(255,255,255,.14)',
          hoverBorderColor: 'rgba(255,255,255,.18)',
          borderWidth: 1,
          hoverBorderWidth: 1,
          borderRadius: 3,
          borderSkipped: false
        },
        {
          label: 'Losses',
          data: entries.map(e => e[1].l),
          backgroundColor: lossFill,
          hoverBackgroundColor: lossFill,
          borderColor: 'rgba(255,255,255,.12)',
          hoverBorderColor: 'rgba(255,255,255,.16)',
          borderWidth: 1,
          hoverBorderWidth: 1,
          borderRadius: 3,
          borderSkipped: false
        }
      ]
    },
    options: {
      ...CD,
      indexAxis: 'y',
      elements: { bar: { borderWidth: 1, hoverBorderWidth: 1 } },
      plugins: { ...CD.plugins, legend: { display: true, labels: { color: '#a5acb4', font: { family: 'JetBrains Mono', size: 9 }, boxWidth: 8, boxHeight: 8 } } },
      scales: { x: { ...CD.scales.x }, y: { ...CD.scales.y } }
    }
  });
}

function renderSessions(arr) {
  destroyChart('sessions');
  const canvas = document.getElementById('c-sessions'); if (!canvas) return;
  const sMap = { Asia: 0, London: 0, NY: 0, Other: 0 };
  arr.forEach(t => { if (sMap[t.sess] !== undefined) sMap[t.sess]++; else sMap.Other++; });
  const labels = Object.keys(sMap).filter(k => sMap[k] > 0), data = labels.map(k => sMap[k]);
  const COLORS = { Asia: 'rgba(153,247,255,.68)', London: 'rgba(175,255,209,.68)', NY: 'rgba(240,180,41,.62)', Other: 'rgba(192,132,252,.65)' };
  chartInst.sessions = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: (c) => pcDoughnutRadial(c.chart.ctx, c.chart, c.datasetIndex, c.dataIndex, COLORS[labels[c.dataIndex]] || COLORS.Other),
        borderColor: 'rgba(255,255,255,.12)',
        borderWidth: 1,
        hoverOffset: 6
      }]
    },
    options: { ...CD, cutout: '58%', plugins: { ...CD.plugins, legend: { display: true, position: 'bottom', align: 'center', labels: { color: '#a5acb4', font: { family: 'JetBrains Mono', size: 8 }, boxWidth: 6, boxHeight: 6, padding: 6 } } }, scales: {} }
  });
}

function renderDist(arr, s) {
  destroyChart('dist');
  const canvas = document.getElementById('c-dist'); if (!canvas) return;
  const raw = [s.wins.length, s.losses.length, s.bes.length];
  const data = raw.filter(v => v > 0);
  const labels = ['Wins', 'Losses', 'BE'].filter((_, i) => raw[i] > 0);
  const colors = ['rgba(175,255,209,.7)', 'rgba(255,113,108,.72)', 'rgba(153,247,255,.58)'].filter((_, i) => raw[i] > 0);
  chartInst.dist = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: (c) => pcDoughnutRadial(c.chart.ctx, c.chart, c.datasetIndex, c.dataIndex, colors[c.dataIndex]),
        borderColor: 'rgba(255,255,255,.12)',
        borderWidth: 1,
        hoverOffset: 6
      }]
    },
    options: { ...CD, cutout: '58%', plugins: { ...CD.plugins, legend: { display: true, position: 'bottom', align: 'center', labels: { color: '#a5acb4', font: { family: 'JetBrains Mono', size: 8 }, boxWidth: 6, boxHeight: 6, padding: 6 } } }, scales: {} }
  });
}

function renderRolling(arr) {
  destroyChart('rolling');
  const canvas = document.getElementById('c-rolling'); if (!canvas || arr.length < 5) return;
  const dData = [], labels = [];
  const n = arr.length;
  for (let i = 0; i < n; i++) {
    const from = Math.max(0, i - 19);
    let wins = 0;
    for (let j = from; j <= i; j++) {
      if (arr[j].outcome === 'Win') wins++;
    }
    const wr = (wins / (i - from + 1)) * 100;
    dData.push(+wr.toFixed(1));
    labels.push('T' + (i + 1));
  }
  chartInst.rolling = new Chart(canvas, {
    type: 'line', data: { labels, datasets: [{ data: dData, borderColor: '#f0b429', borderWidth: 2, pointRadius: 0, tension: 0.3 }] },
    options: { ...CD, scales: { x: { display: false }, y: { ...CD.scales.y, min: 0, max: 100, ticks: { ...CD.scales.y.ticks, callback: v => v+'%' } } } }
  });
}

function renderWeekday(arr) {
  destroyChart('weekday');
  const canvas = document.getElementById('c-weekday'); if (!canvas) return;
  const dayR = [0,0,0,0,0,0,0];
  arr.forEach(t => { const d = new Date(t.date).getDay(); dayR[d] += t.rr * (t.outcome === 'Win' ? 1 : t.outcome === 'Loss' ? -1 : 0); });
  const labels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const data = [dayR[1], dayR[2], dayR[3], dayR[4], dayR[5], dayR[6], dayR[0]];
  const colors = data.map(v => v >= 0 ? 'rgba(175,255,209,.68)' : 'rgba(255,113,108,.72)');
  const dayFill = (c) => pcBarGradientV(c.chart, colors[c.dataIndex]);
  chartInst.weekday = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: dayFill,
        hoverBackgroundColor: dayFill,
        borderColor: 'rgba(255,255,255,.14)',
        hoverBorderColor: 'rgba(255,255,255,.18)',
        borderWidth: 1,
        hoverBorderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      ...CD,
      elements: { bar: { borderWidth: 1, hoverBorderWidth: 1 } },
      scales: { x: { ...CD.scales.x }, y: { ...CD.scales.y, ticks: { ...CD.scales.y.ticks, callback: v => v.toFixed(1)+'R' } } }
    }
  });
}

function renderStreak(arr) {
  destroyChart('streak');
  const canvas = document.getElementById('c-streak'); if (!canvas) return;
  let streaks = { w1:0, w2:0, w3:0, w4p:0, l1:0, l2:0, l3:0, l4p:0 }, curW = 0, curL = 0;
  arr.forEach(t => {
    if(t.outcome === 'Win') {
      if(curL > 0) { if(curL==1) streaks.l1++; else if(curL==2) streaks.l2++; else if(curL==3) streaks.l3++; else streaks.l4p++; curL = 0; }
      curW++;
    } else if (t.outcome === 'Loss') {
      if(curW > 0) { if(curW==1) streaks.w1++; else if(curW==2) streaks.w2++; else if(curW==3) streaks.w3++; else streaks.w4p++; curW = 0; }
      curL++;
    }
  }); 
  if(curW > 0) { if(curW==1) streaks.w1++; else if(curW==2) streaks.w2++; else if(curW==3) streaks.w3++; else streaks.w4p++; }
  if(curL > 0) { if(curL==1) streaks.l1++; else if(curL==2) streaks.l2++; else if(curL==3) streaks.l3++; else streaks.l4p++; }

  window.__streakTradeBuckets = streakTradeBuckets(arr);

  const sw = 'rgba(175,255,209,.72)', sl = 'rgba(255,113,108,.75)';
  const winStreakFill = (c) => pcBarGradientV(c.chart, sw);
  const lossStreakFill = (c) => pcBarGradientV(c.chart, sl);
  chartInst.streak = new Chart(canvas, {
    type: 'bar', data: { labels: ['1x','2x','3x','4x+'], datasets: [
      { label: 'Win Streaks', data: [streaks.w1, streaks.w2, streaks.w3, streaks.w4p], backgroundColor: winStreakFill, hoverBackgroundColor: winStreakFill, borderColor: 'rgba(255,255,255,.12)', hoverBorderColor: 'rgba(255,255,255,.16)', borderWidth: 1, hoverBorderWidth: 1, borderRadius: 3 },
      { label: 'Loss Streaks', data: [streaks.l1, streaks.l2, streaks.l3, streaks.l4p], backgroundColor: lossStreakFill, hoverBackgroundColor: lossStreakFill, borderColor: 'rgba(255,255,255,.1)', hoverBorderColor: 'rgba(255,255,255,.14)', borderWidth: 1, hoverBorderWidth: 1, borderRadius: 3 }
    ]},
    options: {
      ...CD,
      elements: { bar: { borderWidth: 1, hoverBorderWidth: 1 } },
      onClick: (e, elements) => {
        if (!elements.length) return;
        const el = elements[0];
        const isWin = el.datasetIndex === 0;
        const barIdx = el.index;
        showStreakDrill(isWin, barIdx, window.__streakTradeBuckets);
      },
      plugins: { ...CD.plugins, legend: { display: true, labels: { color: '#a5acb4', font: { family: 'JetBrains Mono', size: 9 }, boxWidth: 8, boxHeight: 8 } } },
      scales: { x: { ...CD.scales.x }, y: { ...CD.scales.y } }
    }
  });
}

function renderAlpha(arr) {
  destroyChart('alpha');
  const canvas = document.getElementById('c-alpha'); if (!canvas) return;
  let curves = { NY:[0], London:[0], Asia:[0], Other:[0] }, labels = ['Start'];
  arr.forEach((t, i) => {
    let rv = t.rr * (t.outcome === 'Win' ? 1 : t.outcome === 'Loss' ? -1 : 0);
    ['NY', 'London', 'Asia', 'Other'].forEach(s => {
      let lastVal = curves[s][curves[s].length - 1];
      curves[s].push(t.sess === s ? lastVal + rv : lastVal);
    });
    labels.push('T'+(i+1));
  });
  chartInst.alpha = new Chart(canvas, {
    type: 'line', data: { labels, datasets: [
      { label: 'NY', data: curves.NY, borderColor: 'rgba(240,180,41,.8)', borderWidth: 1.5, pointRadius: 0, tension:0.2 },
      { label: 'London', data: curves.London, borderColor: 'rgba(175,255,209,.8)', borderWidth: 1.5, pointRadius: 0, tension:0.2 },
      { label: 'Asia', data: curves.Asia, borderColor: 'rgba(153,247,255,.8)', borderWidth: 1.5, pointRadius: 0, tension:0.2 }
    ]},
    options: { ...CD, interaction: { mode: 'index', intersect: false }, plugins: { ...CD.plugins, legend: { display:true, labels: { color: '#a5acb4', font: { family: 'JetBrains Mono', size: 9 }, boxWidth: 8, boxHeight: 8 } } }, scales: { x: { display: false }, y: { ...CD.scales.y, ticks: { ...CD.scales.y.ticks, callback: v=>v.toFixed(1)+'R' } } } }
  });
}

// ─── CALENDAR ─────────────────────────────────
function renderCalendar() {
  const now = new Date();
  if (calY === undefined) { calY = now.getFullYear(); calM = now.getMonth(); }
  set('cal-lbl', new Date(calY, calM, 1).toLocaleString('default', { month: 'long', year: 'numeric' }));
  document.getElementById('cal-dows').innerHTML =
    ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => `<div class="caldow">${d}</div>`).join('');
  const first = new Date(calY, calM, 1).getDay(), offset = (first + 6) % 7;
  const lastDay = new Date(calY, calM + 1, 0).getDate();
  const dayR = {}, dayN = {};
  const ym = `${calY}-${String(calM + 1).padStart(2, '0')}`;
  trades.forEach(t => {
    if (!t.date || t.date.length < 10) return;
    if (t.date.slice(0, 7) !== ym) return;
    const day = +t.date.slice(8, 10);
    if (day < 1 || day > 31) return;
    const rv = t.rr * (t.outcome === 'Win' ? 1 : t.outcome === 'Loss' ? -1 : 0);
    dayR[day] = (dayR[day] || 0) + rv; dayN[day] = (dayN[day] || 0) + 1;
  });
  let html = '';
  for (let i = 0; i < offset; i++) html += '<div class="calday empty"></div>';
  for (let d = 1; d <= lastDay; d++) {
    const isToday = d === now.getDate() && calM === now.getMonth() && calY === now.getFullYear();
    const rv = dayR[d], cn = dayN[d];
    const extraCls = rv !== undefined ? (rv > 0 ? ' win' : rv < 0 ? ' loss' : ' be') : '';
    const clickCls = cn ? ' click' : '';
    const todayCls = isToday ? ' today' : '';
    const pnlCls = rv > 0 ? 'w' : rv < 0 ? 'l' : 'r';
    const dateStr = `${calY}-${String(calM + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const clickEvt = ` onclick="openDayPanel('${dateStr}')"`;
    const pnlTxt = rv !== undefined ? `<div class="calpnl ${pnlCls}">${fmt(rv)}</div><div class="calct">${cn}t</div>` : '';
    html += `<div class="calday${extraCls}${todayCls} click"${clickEvt}><div class="calnum">${d}</div>${pnlTxt}</div>`;
  }
  document.getElementById('cal-days').innerHTML = html;
}
function calPrev() { calM--; if (calM < 0) { calM = 11; calY--; } renderCalendar(); }
function calNext() { calM++; if (calM > 11) { calM = 0; calY++; } renderCalendar(); }
function closeCalPop() { /* legacy stub — replaced by day panel */ }

function closeJournalCalSidebar() {
  const el = document.getElementById('cal-sidebar');
  if (!el || el.classList.contains('collapsed')) return;
  el.classList.add('collapsed');
  try { localStorage.setItem('profsCorner_calOpen', '0'); } catch {}
  const btn = document.getElementById('cal-sidebar-toggle-btn');
  const ch = el.querySelector('.cal-sidebar-chevron');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  if (ch) ch.textContent = 'expand_more';
  scheduleChartResize();
}
window.closeJournalCalOverlay = closeJournalCalSidebar;

function toggleCalendarSidebar() {
  const el = document.getElementById('cal-sidebar');
  if (!el) return;
  el.classList.toggle('collapsed');
  const open = !el.classList.contains('collapsed');
  try { localStorage.setItem('profsCorner_calOpen', open ? '1' : '0'); } catch {}
  const btn = document.getElementById('cal-sidebar-toggle-btn');
  const ch = el.querySelector('.cal-sidebar-chevron');
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (ch) ch.textContent = open ? 'expand_less' : 'expand_more';
  scheduleChartResize();
}

// ─── SEG CONTROLS ─────────────────────────────
function setSeg(btn, group) {
  const val = btn.dataset.v;
  segState[group] = val;
  const colorMap = {
    bias:  { Aligned: 'c', Partial: 'r', 'Not Aligned': 'l' },
    dir:   { Long: 'w', Short: 'l' },
    out:   { Win: 'w', Loss: 'l', Breakeven: 'r' },
    sess:  { Asia: 'c', London: 'c', NY: 'w', Other: 'p' },
    ebias: { Aligned: 'c', Partial: 'r', 'Not Aligned': 'l' },
    edir:  { Long: 'w', Short: 'l' },
    eout:  { Win: 'w', Loss: 'l', Breakeven: 'r' },
    esess: { Asia: 'c', London: 'c', NY: 'w', Other: 'p' }
  };
  const cc = (colorMap[group] || {})[val] || 'c';
  document.querySelectorAll(`.segbtn[data-sg="${group}"]`).forEach(b => {
    b.className = 'segbtn' + (b === btn ? ` on ${cc}` : '');
  });
  // Feature 2: refresh log preview when outcome/direction changes on add page
  if (['out','dir','sess','bias'].includes(group)) scheduleLogPreview();
}

// ─── IMAGE HANDLING ───────────────────────────
function handleImgInput(ctx, event) {
  Array.from(event.target.files).forEach(f => readImg(f, ctx));
  event.target.value = '';
}

function readImg(file, ctx) {
  if (!file.type.startsWith('image/')) return;
  const arr = ctx === 'trade' ? tradeImgs : ctx === 'edit' ? editImgs : weekImgs;
  if (arr.length >= 5) { toast('Max 5 images per entry'); return; }
  const reader = new FileReader();
  reader.onload = e => { arr.push(e.target.result); renderImgPrevs(ctx); };
  reader.readAsDataURL(file);
}

function renderImgPrevs(ctx) {
  const arr    = ctx === 'trade' ? tradeImgs : ctx === 'edit' ? editImgs : weekImgs;
  const prevId = ctx === 'trade' ? 'f-prevs'  : ctx === 'edit' ? 'edit-prevs' : 'we-prevs';
  const el = document.getElementById(prevId); if (!el) return;
  el.innerHTML = arr.map((src, i) =>
    `<div class="imgwrap">
      <img class="imgth" src="${src}" onclick="openLB('${src}')" title="Click to enlarge">
      <button class="imgdel" onclick="removeImg('${ctx}',${i})">✕</button>
    </div>`).join('');
}

function removeImg(ctx, idx) {
  if (ctx === 'trade') tradeImgs.splice(idx, 1);
  else if (ctx === 'edit') editImgs.splice(idx, 1);
  else weekImgs.splice(idx, 1);
  renderImgPrevs(ctx);
}

function setupDropZone(zoneId, ctx) {
  const zone = document.getElementById(zoneId); if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag'); Array.from(e.dataTransfer.files).forEach(f => readImg(f, ctx)); });
}

document.addEventListener('paste', e => {
  const tradePage = document.getElementById('add').classList.contains('active');
  const weekPage  = document.getElementById('weekly').classList.contains('active');
  const editOpen  = !!inlineEditId; // FIX: edit-modal removed; inline edit tracked by inlineEditId
  if (!tradePage && !weekPage && !editOpen) return;
  const ctx = editOpen ? 'edit' : tradePage ? 'trade' : 'we';
  Array.from(e.clipboardData.items).forEach(item => {
    if (item.type.startsWith('image/')) { readImg(item.getAsFile(), ctx); toast('Chart pasted ✓'); }
  });
});

// ─── ADD TRADE ────────────────────────────────
function addTrade() {
  const date  = document.getElementById('f-date').value;
  const pair  = document.getElementById('f-pair').value.trim().toUpperCase();
  const model = document.getElementById('f-model').value.trim();
  const rr    = parseFloat(document.getElementById('f-rr').value);
  const exec  = document.getElementById('f-exec').value.trim();
  const emo   = document.getElementById('f-emo').value.trim();
  if (!date)        { toast('Set a trade date ✗'); return; }
  if (!pair)        { toast('Enter the pair / symbol ✗'); return; }
  if (isNaN(rr))    { toast('Enter the R:R value ✗'); return; }
  trades.push({ id: Date.now().toString(), date, pair, model, bias: segState.bias, dir: segState.dir, outcome: segState.out, sess: segState.sess, rr: Math.abs(rr), exec, emo, imgs: [...tradeImgs] });
  trades.sort((a, b) => a.date.localeCompare(b.date));
  saveTrades();
  // reset
  document.getElementById('f-pair').value  = '';
  const fModel = document.getElementById('f-model');
  if (fModel) fModel.value = '';
  document.getElementById('f-rr').value    = '';
  document.getElementById('f-exec').value = '';
  document.getElementById('f-emo').value = '';
  tradeImgs = [];
  renderImgPrevs('trade');
  // reset segs
  const defaults = [['dir','Long','w'],['out','Win','w'],['bias','Aligned','c'],['sess','London','c']];
  defaults.forEach(([sg, v, cc]) => {
    document.querySelectorAll(`.segbtn[data-sg="${sg}"]`).forEach(b => {
      b.className = 'segbtn' + (b.dataset.v === v ? ` on ${cc}` : '');
    });
  });
  segState.bias = 'Aligned'; segState.dir = 'Long'; segState.out = 'Win'; segState.sess = 'London';
  toast('Trade logged ✓');
  showPage('dashboard');
}

// ─── ALL TRADES TABLE ─────────────────────────
function setFilter(type, val, el) {
  filterState[type] = val;
  document.querySelectorAll(`.ftag[data-f="${type}"]`).forEach(b => b.className = 'ftag' + (b === el ? ' on' : ''));
  // Feature 3: persist filter state across page switches
  try { sessionStorage.setItem('pc_filter', JSON.stringify(filterState)); } catch {}
  renderTradesTable();
}

function restoreFilters() {
  try {
    const saved = JSON.parse(sessionStorage.getItem('pc_filter') || '{}');
    if (saved.outcome) filterState.outcome = saved.outcome;
    if (saved.sess)    filterState.sess    = saved.sess;
    // Restore active tags
    ['outcome', 'sess'].forEach(type => {
      document.querySelectorAll(`.ftag[data-f="${type}"]`).forEach(b => {
        b.className = 'ftag' + (b.dataset.v === filterState[type] ? ' on' : '');
      });
    });
    // Restore search text
    const q = sessionStorage.getItem('pc_search') || '';
    const ms = document.getElementById('model-search');
    if (ms && q) ms.value = q;
  } catch {}
}

function getFilteredTrades() {
  const q = (document.getElementById('model-search')?.value || '').toLowerCase();
  return [...trades].filter(t => {
    if (filterState.outcome !== 'all' && t.outcome !== filterState.outcome) return false;
    if (filterState.sess !== 'all' && t.sess !== filterState.sess) return false;
    if (q && !t.pair.toLowerCase().includes(q) && !(t.model || '').toLowerCase().includes(q)) return false;
    return true;
  });
}

function sortBy(col) {
  if (sortState.col === col) sortState.dir = sortState.dir === 'desc' ? 'asc' : 'desc';
  else { sortState.col = col; sortState.dir = 'desc'; }
  renderTradesTable();
}

function applySortToTable(arr) {
  const { col, dir } = sortState;
  return arr.sort((a, b) => {
    let av, bv;
    if (col === 'date') { av = a.date; bv = b.date; }
    else if (col === 'rr') { av = a.rr * (a.outcome === 'Win' ? 1 : a.outcome === 'Loss' ? -1 : 0); bv = b.rr * (b.outcome === 'Win' ? 1 : b.outcome === 'Loss' ? -1 : 0); }
    else { av = a[col] || ''; bv = b[col] || ''; }
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function renderTradesTable() {
  const el = document.getElementById('trades-body'); if (!el) return;
  set('tbl-count', trades.length + ' trade' + (trades.length !== 1 ? 's' : '') + ' logged');
  const visible = applySortToTable(getFilteredTrades());
  const cnt = document.getElementById('fbar-count');
  if (cnt) cnt.textContent = visible.length !== trades.length ? `${visible.length} shown` : '';

  // Feature 4: filtered stats strip
  const isFiltered = filterState.outcome !== 'all' || filterState.sess !== 'all' ||
    !!document.getElementById('model-search')?.value.trim();
  const strip = document.getElementById('fstat-strip');
  if (strip) {
    if (isFiltered && visible.length > 0) {
      const fs = calcStats(visible);
      const wrCls = fs.wr >= 50 ? 'val-tertiary' : 'val-error';
      const netCls = fs.net > 0 ? 'val-tertiary' : fs.net < 0 ? 'val-error' : 'val-default';
      const el_wr = document.getElementById('fs-wr');
      const el_net = document.getElementById('fs-net');
      const el_pf = document.getElementById('fs-pf');
      const el_ct = document.getElementById('fs-ct');
      const el_avgw = document.getElementById('fs-avgw');
      if (el_wr) { el_wr.textContent = fs.wr.toFixed(0) + '%'; el_wr.className = 'fstat-val ' + wrCls; }
      if (el_net) { el_net.textContent = fmt(fs.net); el_net.className = 'fstat-val ' + netCls; }
      if (el_pf) { el_pf.textContent = fs.pf !== null ? fs.pf.toFixed(2) : '∞'; }
      if (el_ct) { el_ct.textContent = visible.length + (visible.length === 1 ? ' trade' : ' trades'); }
      if (el_avgw) { el_avgw.textContent = fmtR(fs.avgW); }
      strip.classList.add('visible');
    } else {
      strip.classList.remove('visible');
    }
  }

  if (!trades.length) { el.innerHTML = '<div class="empty"><span class="empty-ico">📋</span>No trades logged yet.</div>'; return; }
  if (!visible.length) { el.innerHTML = '<div class="empty"><span class="empty-ico">🔍</span>No trades match the current filters.</div>'; return; }
  const sortIcon = col => sortState.col === col ? (sortState.dir === 'desc' ? ' sorted-desc' : ' sorted-asc') : '';
  const rows = visible.map(t => {
    if (inlineEditId === t.id) {
      const modelOpts = models.map(m => `<option value="${m}" ${t.model===m?'selected':''}>${m}</option>`).join('');
      return `
      <tr class="mrow">
        <td colspan="10" style="padding:14px 18px; background:var(--surface-highest); border:1px solid rgba(153,247,255,.25); border-radius:8px;">
          <div style="font-weight:700; color:var(--primary); margin-bottom:14px; font-size:12px; display:flex; align-items:center; gap:6px;">
            <span class="icon sm" style="line-height:1">edit_note</span> <span style="line-height:1">Inline Edit</span>
          </div>
          <div class="fg2" style="gap:14px; margin-bottom:14px;">
            <div class="fgrp"><label class="flbl">Date</label><input type="date" id="ie-date" value="${t.date}"></div>
            <div class="fgrp"><label class="flbl">Pair</label><input type="text" id="ie-pair" value="${t.pair}"></div>
            <div class="fgrp"><label class="flbl">HTF Bias</label>
              <select id="ie-bias" class="ieli">
                <option value="Aligned" ${t.bias==='Aligned'?'selected':''}>Confluent</option>
                <option value="Partial" ${t.bias==='Partial'?'selected':''}>Neutral</option>
                <option value="Not Aligned" ${t.bias==='Not Aligned'?'selected':''}>Counter</option>
              </select>
            </div>
            <div class="fgrp"><label class="flbl">Direction</label>
              <select id="ie-dir" class="ieli">
                <option value="Long" ${t.dir==='Long'?'selected':''}>Long</option>
                <option value="Short" ${t.dir==='Short'?'selected':''}>Short</option>
              </select>
            </div>
            <div class="fgrp"><label class="flbl">Outcome</label>
              <select id="ie-out" class="ieli" onchange="previewDashboard()">
                <option value="Win" ${t.outcome==='Win'?'selected':''}>Win</option>
                <option value="Loss" ${t.outcome==='Loss'?'selected':''}>Loss</option>
                <option value="Breakeven" ${t.outcome==='Breakeven'?'selected':''}>Breakeven</option>
              </select>
            </div>
            <div class="fgrp"><label class="flbl">Model</label>
              <select id="ie-model" class="ieli"><option value="">— Select model —</option>${modelOpts}</select>
            </div>
            <div class="fgrp"><label class="flbl">R:R</label><input type="number" step="0.1" id="ie-rr" value="${t.rr}" oninput="previewDashboard()"></div>
            <div class="fgrp"><label class="flbl">Session</label>
              <select id="ie-sess" class="ieli">
                <option value="Asia" ${t.sess==='Asia'?'selected':''}>Asia</option>
                <option value="London" ${t.sess==='London'?'selected':''}>London</option>
                <option value="NY" ${t.sess==='NY'?'selected':''}>NY</option>
                <option value="Other" ${t.sess==='Other'?'selected':''}>Other</option>
              </select>
            </div>
          </div>
          <div class="fgrp full" style="margin-bottom:12px"><label class="flbl">Execution Notes</label><textarea id="ie-exec" rows="2">${t.exec||''}</textarea></div>
          <div class="fgrp full" style="margin-bottom:12px"><label class="flbl">Emotions Notes</label><textarea id="ie-emo" rows="2">${t.emo||''}</textarea></div>
          <div class="fgrp full" style="margin-bottom:16px">
            <label class="flbl">Charts</label>
            <div class="imgzone" id="edit-drop" onclick="document.getElementById('edit-imgs').click()" style="aspect-ratio:unset;padding:12px">
              <span class="icon sm" style="opacity:.6">add_photo_alternate</span> <span style="font-size:10px; opacity:.6; font-family:var(--ff-mono)">Click or drop to add chart</span>
              <input type="file" id="edit-imgs" accept="image/*" multiple onchange="handleImgInput('edit',event)">
            </div>
            <div class="imgprevs" id="edit-prevs"></div>
          </div>
          <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid rgba(66,73,80,.2); padding-top:14px;">
            <button class="btn btn-ghost" onclick="cancelInlineEdit()">Cancel</button>
            <button class="btn btn-primary" onclick="saveInlineEdit('${t.id}')">Save Changes</button>
          </div>
        </td>
      </tr>`;
    }

    const rv = t.rr * (t.outcome === 'Win' ? 1 : t.outcome === 'Loss' ? -1 : 0);
    const rvTxt = (rv >= 0 ? '+' : '') + rv.toFixed(2) + 'R';
    const rvClr = rv > 0 ? 'var(--tertiary)' : rv < 0 ? 'var(--error)' : 'var(--primary)';
    const thumbs = (t.imgs || []).slice(0, 2).map(s => `<img style="width:30px;height:22px;object-fit:cover;border-radius:3px;cursor:pointer;opacity:.8" src="${s}" onclick="event.stopPropagation();openLB('${s}')">`).join('');
    const leftBar = t.outcome === 'Win' ? 'var(--tertiary)' : t.outcome === 'Loss' ? 'var(--error)' : 'var(--primary)';
    return `
    <tr class="mrow" onclick="toggleRow('${t.id}')">
      <td style="padding-left:8px;width:4px"><div style="width:3px;height:28px;border-radius:2px;background:${leftBar}"></div></td>
      <td style="color:var(--on-surface-var);font-family:var(--ff-mono);font-size:10px">${t.date}</td>
      <td style="font-weight:700;font-family:var(--ff-head);font-size:12px">${t.pair}</td>
      <td><span class="chip ${t.dir.toLowerCase()}">${t.dir}</span></td>
      <td><span class="chip ${t.outcome.toLowerCase()}">${t.outcome}</span></td>
      <td style="color:${rvClr};font-weight:700;font-family:var(--ff-mono)">${rvTxt}</td>
      <td style="color:#c084fc;font-family:var(--ff-mono);font-size:10px">${t.model || '—'}</td>
      <td style="color:var(--on-surface-var);font-family:var(--ff-mono);font-size:10px">${t.sess || '—'}</td>
      <td>${thumbs}</td>
      <td style="white-space:nowrap">
        <button class="btn-xs" style="margin-right:4px" onclick="event.stopPropagation();editTrade('${t.id}')">✏️</button>
        <button class="btn-danger btn" style="padding:4px 8px;font-size:9px" onclick="event.stopPropagation();deleteTrade('${t.id}')">✕</button>
      </td>
    </tr>
    <tr class="erow hidden" id="erow-${t.id}">
      <td colspan="10">
        <div class="exp-inner">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:${(t.imgs && t.imgs.length) ? '12px' : '0'}">
            <div>
              <div style="font-size:8px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--outline);font-family:var(--ff-mono);margin-bottom:6px">Execution Notes</div>
              <div style="font-size:11px;color:var(--on-surface-var);font-family:var(--ff-body);line-height:1.65">${t.exec || '—'}</div>
            </div>
            <div>
              <div style="font-size:8px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--outline);font-family:var(--ff-mono);margin-bottom:6px">Emotions Notes</div>
              <div style="font-size:11px;color:var(--on-surface-var);font-family:var(--ff-body);line-height:1.65">${t.emo || '—'}</div>
            </div>
          </div>
          ${t.imgs && t.imgs.length ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${t.imgs.map(src => `<img style="height:72px;width:auto;max-width:130px;border-radius:6px;cursor:pointer;object-fit:cover;opacity:.9" src="${src}" onclick="openLB('${src}')">`).join('')}</div>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
  const thCls = col => `sortable${sortIcon(col)}`;
  el.innerHTML = `<div style="overflow-x:auto"><table class="ttbl">
    <thead><tr>
      <th style="width:6px;padding:8px 4px"></th>
      <th class="${thCls('date')}" onclick="sortBy('date')">Date</th>
      <th class="${thCls('pair')}" onclick="sortBy('pair')">Pair</th>
      <th>Dir</th>
      <th class="${thCls('outcome')}" onclick="sortBy('outcome')">Outcome</th>
      <th class="${thCls('rr')}" onclick="sortBy('rr')">R</th>
      <th>Model</th><th>Session</th><th>Charts</th><th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function toggleRow(id) { const row = document.getElementById(`erow-${id}`); if (row) row.classList.toggle('hidden'); }

function deleteTrade(id) {
  customConfirm(
    `Delete trade <strong>${(trades.find(t=>t.id===id)||{}).pair||'this trade'}</strong>? This cannot be undone.`,
    () => {
      trades = trades.filter(t => t.id !== id);
      saveTrades(); renderTradesTable(); renderDashboard();
      toast('Trade deleted');
    },
    'Delete', 'var(--error)'
  );
}

// ─── INLINE EDIT TRADE ───────────────────────────────
function editTrade(id) {
  if (window.__pvDashT) { clearTimeout(window.__pvDashT); window.__pvDashT = null; }
  if (!originalTrades) originalTrades = JSON.stringify(trades);
  else trades = JSON.parse(originalTrades); // Reset if another row was open
  inlineEditId = id;
  const t = trades.find(x => x.id === id);
  if (t) editImgs = [...(t.imgs || [])];
  renderTradesTable();
  setTimeout(() => {
    // scroll so the first select is in view maybe
    const row = document.getElementById('ie-date');
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    renderImgPrevs('edit');
    setupDropZone('edit-drop', 'edit');
  }, 50);
}

function previewDashboard() {
  if (!inlineEditId) return;
  if (window.__pvDashT) clearTimeout(window.__pvDashT);
  window.__pvDashT = setTimeout(() => {
    window.__pvDashT = null;
    if (!inlineEditId) return;
    const idx = trades.findIndex(t => t.id === inlineEditId);
    if (idx < 0) return;
    const rr = parseFloat(document.getElementById('ie-rr').value) || 0;
    const out = document.getElementById('ie-out').value;
    trades[idx].rr = Math.abs(rr);
    trades[idx].outcome = out;
    renderDashboard();
  }, 240);
}

function cancelInlineEdit() {
  if (window.__pvDashT) { clearTimeout(window.__pvDashT); window.__pvDashT = null; }
  if (originalTrades) trades = JSON.parse(originalTrades);
  inlineEditId = null;
  originalTrades = null;
  renderTradesTable();
  renderDashboard();
}

function saveInlineEdit(id) {
  if (window.__pvDashT) { clearTimeout(window.__pvDashT); window.__pvDashT = null; }
  const idx = trades.findIndex(t => t.id === id); if (idx < 0) return;
  const rr = parseFloat(document.getElementById('ie-rr').value);
  if (isNaN(rr)) { toast('Enter a valid R:R value ✗'); return; }
  trades[idx] = { ...trades[idx],
    date: document.getElementById('ie-date').value,
    pair: document.getElementById('ie-pair').value.trim().toUpperCase(),
    model: document.getElementById('ie-model').value.trim(),
    rr: Math.abs(rr),
    exec: document.getElementById('ie-exec').value.trim(),
    emo: document.getElementById('ie-emo').value.trim(),
    bias: document.getElementById('ie-bias').value,
    dir:  document.getElementById('ie-dir').value,
    outcome: document.getElementById('ie-out').value,
    sess: document.getElementById('ie-sess').value,
    imgs: [...editImgs]
  };
  trades.sort((a, b) => a.date.localeCompare(b.date));
  saveTrades();
  inlineEditId = null;
  originalTrades = null;
  renderTradesTable();
  renderDashboard();
  toast('Trade updated ✓');
}


// ─── WEEKLY PLAN ──────────────────────────────
function renderWeeklyPlan() {
  const el = document.getElementById('week-chips'); if (!el) return;
  if (!weeks.length) { el.innerHTML = '<div class="empty"><span class="empty-ico">📋</span>No weekly plans yet. Click "New Week" to start.</div>'; return; }
  const sorted = [...weeks].sort((a, b) => b.start.localeCompare(a.start));
  el.innerHTML = sorted.map(w => {
    const wTrades = trades.filter(t => t.date >= w.start && t.date <= w.end);
    const wWins = wTrades.filter(t => t.outcome === 'Win').length;
    const wLoss = wTrades.filter(t => t.outcome === 'Loss').length;
    const wNet  = wTrades.reduce((s, t) => s + t.rr * (t.outcome === 'Win' ? 1 : t.outcome === 'Loss' ? -1 : 0), 0);
    const statsHtml = wTrades.length ? `<div class="wchip-stats">
      <span class="wchip-stat" style="background:rgba(175,255,209,.1);color:var(--tertiary)">${wWins}W</span>
      <span class="wchip-stat" style="background:rgba(255,113,108,.1);color:var(--error)">${wLoss}L</span>
      <span class="wchip-stat" style="background:${wNet >= 0 ? 'rgba(175,255,209,.1)' : 'rgba(255,113,108,.1)'};color:${wNet >= 0 ? 'var(--tertiary)' : 'var(--error)'}">${wNet >= 0 ? '+' : ''}${wNet.toFixed(1)}R</span>
      <span class="wchip-stat" style="background:rgba(153,247,255,.08);color:var(--primary)">${wTrades.length}T</span>
    </div>` : '<div style="font-size:9px;color:var(--outline);font-family:var(--ff-mono);margin-top:6px">No trades this week</div>';
    const thumbs = (w.imgs || []).slice(0, 3).map(s => `<img class="wchip-thumb" src="${s}">`).join('');
    return `<div class="wchip" draggable="true" ondragstart="handleDragStart(event, '${w.id}')" ondragover="handleDragOver(event)" ondragend="handleDragEnd(event)" ondrop="handleDrop(event, '${w.id}')" onclick="if(!_justDragged)openWeekView('${w.id}')">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px">
        <div class="wchip-date">📅 ${w.start} — ${w.end}</div>
        ${(w.imgs || []).length ? `<span style="font-size:8px;font-family:var(--ff-mono);color:var(--outline)">📸 ${(w.imgs || []).length}</span>` : ''}
      </div>
      ${w.outlook ? `<div class="wchip-preview">${w.outlook}</div>` : ''}
      ${statsHtml}
      ${thumbs ? `<div class="wchip-thumbs">${thumbs}</div>` : ''}
    </div>`;
  }).join('');
}

function openNewWeek() {
  editWeekId = null; weekImgs = [];
  const now = new Date(), dow = now.getDay();
  const toMon = dow === 0 ? 1 : dow === 1 ? 0 : 8 - dow;
  const mon = new Date(now); mon.setDate(now.getDate() + toMon);
  const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
  document.getElementById('we-start').value = mon.toISOString().slice(0, 10);
  document.getElementById('we-end').value   = fri.toISOString().slice(0, 10);
  ['we-outlook','we-keylevels','we-mon','we-tue','we-wed','we-thu','we-fri','we-prev'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  renderImgPrevs('we');
  document.getElementById('we-del-btn').style.display = 'none';
  const ed = document.getElementById('weditor'); ed.classList.add('open');
  ed.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openEditWeek(id) {
  const w = weeks.find(x => x.id === id); if (!w) return;
  editWeekId = id; weekImgs = [...(w.imgs || [])];
  document.getElementById('we-start').value     = w.start || '';
  document.getElementById('we-end').value       = w.end || '';
  document.getElementById('we-outlook').value   = w.outlook || '';
  document.getElementById('we-keylevels').value = w.keylevels || '';
  document.getElementById('we-mon').value       = w.mon || '';
  document.getElementById('we-tue').value       = w.tue || '';
  document.getElementById('we-wed').value       = w.wed || '';
  document.getElementById('we-thu').value       = w.thu || '';
  document.getElementById('we-fri').value       = w.fri || '';
  document.getElementById('we-prev').value      = w.prevPerf || '';
  renderImgPrevs('we');
  document.getElementById('we-del-btn').style.display = 'inline-flex';
  const ed = document.getElementById('weditor'); ed.classList.add('open');
  ed.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function saveWeek() {
  const start = document.getElementById('we-start').value, end = document.getElementById('we-end').value;
  if (!start || !end) { toast('Set week dates first ✗'); return; }
  const data = { id: editWeekId || Date.now().toString(), start, end, outlook: document.getElementById('we-outlook').value.trim(), keylevels: document.getElementById('we-keylevels').value.trim(), mon: document.getElementById('we-mon').value.trim(), tue: document.getElementById('we-tue').value.trim(), wed: document.getElementById('we-wed').value.trim(), thu: document.getElementById('we-thu').value.trim(), fri: document.getElementById('we-fri').value.trim(), prevPerf: document.getElementById('we-prev').value.trim(), imgs: [...weekImgs] };
  if (editWeekId === null) weeks.push(data);
  else { const idx = weeks.findIndex(w => w.id === editWeekId); if (idx >= 0) weeks[idx] = data; }
  saveWeeks(); closeWeekEditor(); renderWeeklyPlan(); toast('Week saved ✓');
}

function deleteWeek() {
  if (!editWeekId) return;
  customConfirm(
    'Delete this <strong>weekly plan</strong>? Your trades for this period will not be affected.',
    () => {
      weeks = weeks.filter(w => w.id !== editWeekId);
      saveWeeks(); closeWeekEditor(); renderWeeklyPlan(); toast('Week deleted');
    },
    'Delete', 'var(--error)'
  );
}

function closeWeekEditor() {
  editWeekId = undefined;
  document.getElementById('weditor').classList.remove('open');
  document.querySelectorAll('.wchip').forEach(c => c.classList.remove('sel'));
}

// ─── WEEK VIEW ────────────────────────────────
function openWeekView(id) {
  const w = weeks.find(x => x.id === id); if (!w) return;
  currentViewId = id;
  set('wv-title', `📅 ${w.start} – ${w.end}`);
  const wTrades = trades.filter(t => t.date >= w.start && t.date <= w.end);
  const wWins   = wTrades.filter(t => t.outcome === 'Win');
  const wLoss   = wTrades.filter(t => t.outcome === 'Loss');
  const wNet    = wTrades.reduce((s, t) => s + t.rr * (t.outcome === 'Win' ? 1 : t.outcome === 'Loss' ? -1 : 0), 0);
  const wWR     = wTrades.length ? (wWins.length / wTrades.length * 100).toFixed(0) : 0;
  const wBest   = wWins.length ? Math.max(...wWins.map(t => t.rr)) : 0;
  document.getElementById('wv-stats').innerHTML = [
    ['Trades', wTrades.length, ''],
    ['Net R', (wNet >= 0 ? '+' : '') + wNet.toFixed(2) + 'R', wNet >= 0 ? 'var(--tertiary)' : 'var(--error)'],
    ['Win Rate', wWR + '%', wWR >= 50 ? 'var(--tertiary)' : 'var(--error)'],
    ['Best Trade', wBest > 0 ? '+' + wBest.toFixed(1) + 'R' : '—', 'var(--tertiary)']
  ].map(([l, v, c]) => `<div class="wview-stat"><div class="wview-stat-lbl">${l}</div><div class="wview-stat-val" style="color:${c || 'var(--on-surface)'}">${v}</div></div>`).join('');
  document.getElementById('wv-outlook').textContent = w.outlook || '—';
  document.getElementById('wv-kl').textContent = w.keylevels || '—';
  document.getElementById('wv-days').innerHTML = [['Mon', w.mon], ['Tue', w.tue], ['Wed', w.wed], ['Thu', w.thu], ['Fri', w.fri]].map(([d, v]) => `<div class="wview-day"><div class="wview-day-lbl">${d}</div><div class="wview-day-val">${v || '—'}</div></div>`).join('');
  document.getElementById('wv-prev').textContent = w.prevPerf || '—';
  const chartsEl = document.getElementById('wv-charts'), chartsSec = document.getElementById('wv-charts-sec');
  if (w.imgs && w.imgs.length) { chartsEl.innerHTML = w.imgs.map(src => `<img class="wview-img" src="${src}" onclick="openLB('${src}')">`).join(''); chartsSec.style.display = ''; }
  else { chartsSec.style.display = 'none'; }
  document.getElementById('wview-bg').classList.add('open');
}

function closeWeekView(e) {
  if (e && e.target !== document.getElementById('wview-bg')) return;
  document.getElementById('wview-bg').classList.remove('open');
  currentViewId = null;
}

function wviewToEdit() { const id = currentViewId; closeWeekView(null); if (id) openEditWeek(id); }

// ─── WEEK REORDER (DRAG & DROP) ───────────────
let draggedWeekId = null;
let _justDragged = false;
function handleDragStart(e, id) {
  draggedWeekId = id;
  _justDragged = false;
  e.dataTransfer.effectAllowed = 'move';
  e.target.style.opacity = '0.4';
}
function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  return false;
}
function handleDragEnd(e) {
  e.target.style.opacity = '1';
  if (draggedWeekId) {
    _justDragged = true;
    setTimeout(() => _justDragged = false, 100);
  }
  draggedWeekId = null;
}
function handleDrop(e, targetId) {
  e.stopPropagation();
  e.preventDefault();
  document.querySelectorAll('.wchip').forEach(c => c.style.opacity = '1');
  if (draggedWeekId && draggedWeekId !== targetId) {
    _justDragged = true;
    setTimeout(() => _justDragged = false, 100);
    const fromIdx = weeks.findIndex(w => w.id === draggedWeekId);
    const toIdx = weeks.findIndex(w => w.id === targetId);
    const item = weeks.splice(fromIdx, 1)[0];
    weeks.splice(toIdx, 0, item);
    saveWeeks();
    renderWeeklyPlan();
    toast('Order updated');
  }
  draggedWeekId = null;
  return false;
}

// ─── SHARE CARD ───────────────────────────────
function setCardPeriod(p) {
  cardPeriod = p;
  document.querySelectorAll('.sc-pbtn').forEach(b => b.classList.remove('active'));
  const pMap = { daily: 0, weekly: 1, monthly: 2 };
  document.querySelectorAll('.sc-pbtn')[pMap[p]].classList.add('active');
  renderShareCard();
}

function setAccent(color, glow, el) {
  cardAccent = color; cardGlow = glow;
  document.querySelectorAll('.ac-chip').forEach(c => c.classList.remove('sel'));
  el.classList.add('sel');
  renderShareCard();
}

function getCardTrades() {
  const now = new Date(), today = now.toISOString().slice(0, 10);
  if (cardPeriod === 'daily') return { arr: trades.filter(t => t.date === today), label: 'TODAY', range: today };
  if (cardPeriod === 'weekly') {
    const dow = now.getDay(), diff = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(now); mon.setDate(now.getDate() + diff);
    const monStr = mon.toISOString().slice(0, 10);
    return { arr: trades.filter(t => t.date >= monStr && t.date <= today), label: 'THIS WEEK', range: `${monStr} – ${today}` };
  }
  const mo = today.slice(0, 7);
  return { arr: trades.filter(t => t.date.startsWith(mo)), label: 'THIS MONTH', range: new Date().toLocaleString('default', { month: 'long', year: 'numeric' }) };
}

function renderShareCard() {
  const card = document.getElementById('sc-el'), content = document.getElementById('sc-content'), empty = document.getElementById('sc-empty');
  card.style.setProperty('--sc-ac', cardAccent); card.style.setProperty('--sc-glow', cardGlow);
  const { arr, label, range } = getCardTrades();
  if (!arr.length) { empty.style.display = 'block'; content.style.display = 'none'; return; }
  empty.style.display = 'none'; content.style.display = 'block';
  const s = calcStats(arr), net = s.net;
  const pnlClr = net > 0 ? cardAccent : net < 0 ? '#ff716c' : '#6f767e';
  const pnlStr = (net >= 0 ? '+' : '') + net.toFixed(2) + 'R';
  const streakH = arr.slice(-6).map(t => `<div class="sc-dot ${t.outcome === 'Win' ? 'W' : t.outcome === 'Loss' ? 'L' : 'B'}">${t.outcome === 'Win' ? 'W' : t.outcome === 'Loss' ? 'L' : 'B'}</div>`).join('');
  const pairMap = {}; arr.forEach(t => { const rv = t.rr * (t.outcome === 'Win' ? 1 : t.outcome === 'Loss' ? -1 : 0); pairMap[t.pair] = (pairMap[t.pair] || 0) + rv; });
  const topP = Object.entries(pairMap).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p, r]) =>
    `<span style="font-size:9px;font-family:var(--ff-mono);color:${r >= 0 ? cardAccent : '#ff716c'};background:rgba(${r >= 0 ? '153,247,255' : '255,113,108'},.08);padding:3px 9px;border-radius:5px;font-weight:700">${p} ${(r >= 0 ? '+' : '') + r.toFixed(1)}R</span>`).join('');
  content.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px;position:relative;z-index:1">
      <div style="font-family:var(--ff-head);font-size:11px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:var(--on-surface-var)">PROF'S <span style="color:${cardAccent}">CORNER</span></div>
      <div style="background:var(--surface-high);border-radius:20px;padding:4px 12px;display:flex;align-items:center;gap:6px">
        <span style="width:5px;height:5px;border-radius:50%;background:${cardAccent};display:inline-block;box-shadow:0 0 6px ${cardAccent}"></span>
        <span style="font-family:var(--ff-mono);font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--on-surface-var)">${label}</span>
      </div>
    </div>
    <div style="position:relative;z-index:1">
      <div style="font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--outline);font-family:var(--ff-mono);margin-bottom:6px">TOTAL PERIOD YIELD</div>
      <div style="font-size:72px;font-weight:900;line-height:1;letter-spacing:-.04em;color:${pnlClr};font-family:var(--ff-head);filter:drop-shadow(0 0 20px ${pnlClr}44)">${pnlStr}</div>
      <div style="font-size:10px;color:var(--outline);font-family:var(--ff-mono);margin-top:8px;margin-bottom:20px">${range}</div>
      <div style="height:1px;background:linear-gradient(90deg,transparent,rgba(66,73,80,.3),transparent);margin-bottom:18px"></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:rgba(66,73,80,.1);border-radius:8px;overflow:hidden;margin-bottom:18px">
        ${[['WIN RATE', s.wr.toFixed(0)+'%', s.wr>=50?'var(--tertiary)':'var(--error)'],['TRADES',arr.length,'var(--on-surface)'],['PROFIT FACTOR',s.pf!==null?s.pf.toFixed(2):'∞','#f0b429'],['BEST TRADE','+'+(s.wins.length?Math.max(...s.wins.map(t=>t.rr)):0).toFixed(2)+'R','var(--tertiary)'],['WORST TRADE',(s.losses.length?Math.min(...s.losses.map(t=>t.rr)):0).toFixed(2)+'R','var(--error)'],['W / L',s.wins.length+'W '+s.losses.length+'L','var(--on-surface)']]
          .map(([l,v,c])=>`<div style="padding:14px;background:var(--surface-container)"><div style="font-size:8px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--outline);font-family:var(--ff-mono);margin-bottom:6px">${l}</div><div style="font-size:18px;font-weight:800;color:${c};font-family:var(--ff-head);letter-spacing:-.02em">${v}</div></div>`).join('')}
      </div>
      <div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;font-size:8px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;font-family:var(--ff-mono);color:var(--outline);margin-bottom:6px">
          <span>WIN RATIO</span><span>${s.wr.toFixed(0)}% wins</span>
        </div>
        <div style="height:4px;background:var(--surface-container);border-radius:2px;overflow:hidden">
          <div style="height:100%;width:${Math.min(100,s.wr).toFixed(0)}%;background:${cardAccent};border-radius:2px;transition:width .5s ease"></div>
        </div>
      </div>
      ${streakH ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px"><span style="font-size:8px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--outline);font-family:var(--ff-mono)">STREAK</span>${streakH}</div>` : ''}
      ${topP ? `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:14px">${topP}</div>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;padding-top:12px;border-top:1px solid rgba(66,73,80,.1)">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:16px;height:16px;border-radius:4px;background:${cardAccent};display:flex;align-items:center;justify-content:center;font-family:var(--ff-mono);font-size:8px;font-weight:800;color:#000">P</div>
          <span style="font-family:var(--ff-head);font-size:10px;font-weight:800;letter-spacing:.06em">THE TERMINAL</span>
        </div>
        <div style="font-family:var(--ff-mono);font-size:8px;color:var(--outline);opacity:.5">profs.corner.journal</div>
      </div>
    </div>`;
}

async function downloadCard() {
  let backdropSource = null;
  try {
  const { arr, label, range } = getCardTrades();
  if (!arr.length) { toast('No trades for this period ✗'); return; }
  const W = 1040, H = 620, ac = cardAccent;
  const s = calcStats(arr), net = s.net;
  const pnlStr = (net >= 0 ? '+' : '') + net.toFixed(2) + 'R';
  const pnlClr = net > 0 ? ac : net < 0 ? '#ff716c' : '#6f767e';
  const wr = s.wr, pf = s.pf !== null ? s.pf.toFixed(2) : '∞';
  const best  = s.wins.length ? Math.max(...s.wins.map(t => t.rr)) : 0;
  const worst = s.losses.length ? Math.min(...s.losses.map(t => t.rr)) : 0;
  // Use preloaded base64 if available (canvas-safe, no taint risk)
  // Fall back to fetch approach only if base64 wasn't preloaded
  const pnlSel = document.getElementById('pnl-bg-select-sc');
  const encPathStored = pnlSel ? pnlSel.value : getPnlBgStoredEncoded();
  const relBackdrop = encPathStored ? decodeURIComponent(encPathStored) : '';

  if (relBackdrop) {
    if (__pnlBackdropBase64) {
      // Best path: already in memory as base64, zero latency, no canvas taint
      backdropSource = await new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth > 0 ? img : null);
        img.onerror = () => resolve(null);
        img.src = __pnlBackdropBase64;
      });
    } else {
      // Not yet preloaded — try fetching now (server must be running)
      backdropSource = await loadBackdropForExport(relBackdrop);
    }
    if (!backdropSource) {
      toast('Backdrop image not available for export. Select the image again or run server.ps1. Saving without backdrop…');
    }
  }

  const paintExport = (canvasEl, includeBackdropLayer) => {
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    const rr = (cx,cy,cw,ch,cr) => { ctx.beginPath(); ctx.moveTo(cx+cr,cy); ctx.lineTo(cx+cw-cr,cy); ctx.quadraticCurveTo(cx+cw,cy,cx+cw,cy+cr); ctx.lineTo(cx+cw,cy+ch-cr); ctx.quadraticCurveTo(cx+cw,cy+ch,cx+cw-cr,cy+ch); ctx.lineTo(cx+cr,cy+ch); ctx.quadraticCurveTo(cx,cy+ch,cx,cy+ch-cr); ctx.lineTo(cx,cy+cr); ctx.quadraticCurveTo(cx,cy,cx+cr,cy); ctx.closePath(); };
    ctx.clearRect(0, 0, W, H);
    const bd = includeBackdropLayer && backdropSource ? backdropSource : null;
    // BG
    const bg = ctx.createLinearGradient(0,0,W,H);
    bg.addColorStop(0,'#0c141b'); bg.addColorStop(.5,'#121a22'); bg.addColorStop(1,'#080f15');
    ctx.fillStyle = bg; rr(0,0,W,H,20); ctx.fill();
    ctx.strokeStyle='rgba(66,73,80,.25)'; ctx.lineWidth=1.5; rr(0,0,W,H,20); ctx.stroke();
    if (bd) {
      ctx.save();
      rr(0,0,W,H,20);
      ctx.clip();
      const iw = bd.naturalWidth || bd.width, ih = bd.naturalHeight || bd.height;
      if (iw > 0 && ih > 0) {
        const scale = Math.max(W / iw, H / ih);
        const dw = iw * scale, dh = ih * scale;
        const ox = (W - dw) / 2, oy = (H - dh) / 2;
        ctx.globalAlpha = 0.12;
        ctx.drawImage(bd, ox, oy, dw, dh);
      }
      ctx.restore();
    }
    // Milled texture
  const tex = ctx.createLinearGradient(0,0,W,H);
  tex.addColorStop(0,'rgba(153,247,255,.04)'); tex.addColorStop(1,'transparent');
  ctx.fillStyle=tex; ctx.fillRect(0,0,W,H);
  // Top line
  const acLine = ctx.createLinearGradient(0,0,W,0);
  acLine.addColorStop(0,'transparent'); acLine.addColorStop(.5,ac); acLine.addColorStop(1,'transparent');
  ctx.fillStyle=acLine; ctx.fillRect(0,0,W,2);
  // Glow
  const glow = ctx.createRadialGradient(W-80,-40,0,W-80,-40,260);
  glow.addColorStop(0,ac+'14'); glow.addColorStop(1,'transparent');
  ctx.fillStyle=glow; ctx.fillRect(0,0,W,H);
  // Brand
  ctx.font='900 11px "Space Grotesk",sans-serif'; ctx.letterSpacing='0.12em';
  ctx.fillStyle='#424950'; ctx.fillText("PROF'S",40,52);
  ctx.fillStyle=ac; ctx.fillText(' CORNER',40+ctx.measureText("PROF'S").width,52);
  // Period badge
  ctx.font='700 9px monospace'; const bw=ctx.measureText(label).width+24;
  ctx.fillStyle='rgba(23,33,41,.8)'; rr(W-40-bw,36,bw,24,12); ctx.fill();
  ctx.fillStyle=ac+'60'; rr(W-40-bw,36,bw,24,12); ctx.stroke();
  ctx.fillStyle='#a5acb4'; ctx.fillText(label,W-40-bw+12,52);
  // Label
  ctx.font='700 9px monospace'; ctx.fillStyle='#424950'; ctx.letterSpacing='0.16em';
  ctx.fillText('TOTAL PERIOD YIELD',40,95);
  // Big number
  ctx.font='900 76px "Space Grotesk",sans-serif'; ctx.fillStyle=pnlClr; ctx.letterSpacing='-0.04em';
  ctx.shadowColor=pnlClr+'44'; ctx.shadowBlur=30;
  ctx.fillText(pnlStr,40,185); ctx.shadowBlur=0;
  ctx.font='400 10px monospace'; ctx.fillStyle='#424950'; ctx.letterSpacing='0';
  ctx.fillText(range,40,208);
  // Divider
  const div=ctx.createLinearGradient(40,0,W-40,0);
  div.addColorStop(0,'transparent');div.addColorStop(.5,'rgba(66,73,80,.3)');div.addColorStop(1,'transparent');
  ctx.fillStyle=div; ctx.fillRect(40,228,W-80,1);
  // Stats 2x3
  const stats=[['WIN RATE',wr.toFixed(0)+'%',wr>=50?'#afffd1':'#ff716c'],['TRADES',arr.length,'#eef4fd'],['PROFIT FACTOR',pf,'#f0b429'],['BEST TRADE','+'+best.toFixed(2)+'R','#afffd1'],['WORST',worst.toFixed(2)+'R','#ff716c'],['W/L',s.wins.length+'W '+s.losses.length+'L','#eef4fd']];
  const colW=(W-80)/3;
  stats.forEach(([l,v,c],i)=>{
    const col=i%3,row=Math.floor(i/3),x=40+col*colW,y=258+row*88;
    ctx.fillStyle='rgba(18,26,34,.7)'; rr(x,y-18,colW-8,76,6); ctx.fill();
    ctx.font='700 8px monospace'; ctx.fillStyle='#424950'; ctx.letterSpacing='0.12em';
    ctx.fillText(l,x+10,y);
    ctx.font='800 24px "Space Grotesk",sans-serif'; ctx.fillStyle=c; ctx.letterSpacing='-0.02em';
    ctx.fillText(v,x+10,y+30);
  });
  // Win bar
  const barY=456,barX=40,barW=W-80,barH=4;
  ctx.fillStyle='rgba(18,26,34,.9)'; rr(barX,barY,barW,barH,2); ctx.fill();
  ctx.fillStyle=ac; rr(barX,barY,barW*(wr/100),barH,2); ctx.fill();
  ctx.font='700 8px monospace'; ctx.letterSpacing='0.1em';
  ctx.fillStyle='#424950'; ctx.fillText('WIN RATIO',barX,barY-7);
  ctx.textAlign='right'; ctx.fillStyle='#6f767e'; ctx.fillText(wr.toFixed(0)+'% wins',barX+barW,barY-7);
  ctx.textAlign='left';
  // Streak dots
  const recent=arr.slice(-8), ds=26,dg=5,dy=474;
  ctx.font='700 9px monospace';
  recent.forEach((t,i)=>{
    const dx=40+i*(ds+dg),isW=t.outcome==='Win',isL=t.outcome==='Loss';
    ctx.fillStyle=isW?'rgba(175,255,209,.15)':isL?'rgba(255,113,108,.12)':'rgba(153,247,255,.08)';
    rr(dx,dy,ds,ds,5); ctx.fill();
    ctx.fillStyle=isW?'#afffd1':isL?'#ff716c':'#99f7ff'; ctx.letterSpacing='0';
    ctx.fillText(isW?'W':isL?'L':'B',dx+8,dy+17);
  });
  // Pairs
  const pmap={};
  arr.forEach(t=>{const rv=t.rr*(t.outcome==='Win'?1:t.outcome==='Loss'?-1:0);pmap[t.pair]=(pmap[t.pair]||0)+rv;});
  let cx2=40;
  Object.entries(pmap).sort((a,b)=>b[1]-a[1]).slice(0,4).forEach(([p,r])=>{
    const pos=r>=0,txt=p+' '+(pos?'+':'')+r.toFixed(1)+'R';
    ctx.font='700 9px monospace'; const tw=ctx.measureText(txt).width+18;
    ctx.fillStyle=pos?'rgba(153,247,255,.08)':'rgba(255,113,108,.08)';
    rr(cx2,512,tw,20,4); ctx.fill();
    ctx.fillStyle=pos?ac:'#ff716c'; ctx.fillText(txt,cx2+9,526); cx2+=tw+6;
  });
  // Footer
  ctx.fillStyle='rgba(66,73,80,.15)'; ctx.fillRect(40,H-40,W-80,1);
  // Logo
  ctx.fillStyle=ac; rr(40,H-28,16,16,4); ctx.fill();
  ctx.font='800 9px monospace'; ctx.fillStyle='#000'; ctx.letterSpacing='0'; ctx.fillText('P',46,H-17);
  ctx.font='800 10px "Space Grotesk",sans-serif'; ctx.fillStyle='#eef4fd'; ctx.letterSpacing='0.06em';
  ctx.fillText('THE TERMINAL',62,H-17);
  ctx.font='400 9px monospace'; ctx.fillStyle='#424950'; ctx.letterSpacing='0.04em';
  ctx.textAlign='right'; ctx.fillText('profs.corner.journal',W-40,H-17); ctx.textAlign='left';
  };

  let exportCanvas = document.createElement('canvas');
  exportCanvas.width = W;
  exportCanvas.height = H;
  paintExport(exportCanvas, true);

  let strippedBackdrop = false;
  const savePng = () => {
    exportCanvas.toBlob(blob => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `profs-corner-${cardPeriod}.png`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
        toast(strippedBackdrop ? 'Card saved as PNG (without photo layer) ✓' : 'Card saved as PNG ✓');
        disposeBackdropExportSource(backdropSource);
        return;
      }
      if (backdropSource && !strippedBackdrop) {
        disposeBackdropExportSource(backdropSource);
        strippedBackdrop = true;
        toast('Photo layer blocked PNG export. Retrying on a clean canvas without backdrop…');
        exportCanvas = document.createElement('canvas');
        exportCanvas.width = W;
        exportCanvas.height = H;
        paintExport(exportCanvas, false);
        savePng();
        return;
      }
      try {
        const dataUrl = exportCanvas.toDataURL('image/png');
        if (dataUrl && dataUrl.length > 32) {
          const a = document.createElement('a');
          a.href = dataUrl;
          a.download = `profs-corner-${cardPeriod}.png`;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => document.body.removeChild(a), 1000);
          toast('Card saved as PNG ✓');
          disposeBackdropExportSource(backdropSource);
          return;
        }
      } catch (e) { try { pcDbg('toDataURL', e); } catch (e2) {} }
      disposeBackdropExportSource(backdropSource);
      toast('Could not save PNG ✗');
    }, 'image/png');
  };
  savePng();
  } catch (e) {
    try { pcDbg('downloadCard', e); } catch (e2) {}
    try { disposeBackdropExportSource(backdropSource); } catch (e3) {}
    toast('Save failed: ' + (e && e.message ? e.message : String(e)) + ' ✗');
  }
}

function runDownloadCard() {
  downloadCard().catch(e => {
    try { console.error(e); } catch (e2) {}
    toast('Save failed: ' + (e && e.message ? e.message : String(e)) + ' ✗');
  });
}

// ─── CALENDAR DAY PANEL ─────────────────────────
function openDayPanel(dateStr) {
  const pop = document.getElementById('day-panel-bg'), body = document.getElementById('day-panel-body'), label = document.getElementById('day-panel-date');
  if (!pop || !body || !label) return;
  const dayTrades = trades.filter(t => t.date === dateStr);
  label.innerHTML = `<span style="font-size:16px;">📅</span> ${new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`;
  body.innerHTML = dayTrades.length ? dayTrades.map(t => {
    const rv = t.rr * (t.outcome === 'Win' ? 1 : t.outcome === 'Loss' ? -1 : 0);
    const rvTxt = (rv >= 0 ? '+' : '') + rv.toFixed(2) + 'R';
    const rvClr = rv > 0 ? 'var(--tertiary)' : rv < 0 ? 'var(--error)' : 'var(--primary)';
    // Thumbnail section for day panel
    const thumbs = t.imgs && t.imgs.length ? `<div style="display:flex;gap:6px;margin-top:10px">${t.imgs.map(s => `<img style="width:40px;height:28px;object-fit:cover;border-radius:4px;cursor:pointer;" src="${s}" onclick="event.stopPropagation();openLB('${s}')">`).join('')}</div>` : '';
    // Execution notes
    const notes = t.exec ? `<div style="font-size:10px;color:var(--on-surface-var);margin-top:8px;line-height:1.5">${t.exec}</div>` : '';
    
    return `<div style="padding:14px;background:var(--surface-high);border-radius:8px;margin-bottom:12px;border:1px solid rgba(66,73,80,.2)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-weight:800;font-family:var(--ff-head);font-size:14px;color:var(--on-surface)">${t.pair}</div>
          <div style="font-size:10px;color:var(--outline);font-family:var(--ff-mono);margin-top:4px">${t.model || '—'} · ${t.sess} · <span class="chip ${t.dir.toLowerCase()}" style="font-size:8px;padding:2px 4px">${t.dir}</span></div>
        </div>
        <div style="text-align:right">
          <div style="font-family:var(--ff-mono);font-weight:700;font-size:14px;color:${rvClr}">${rvTxt}</div>
          <span class="chip ${t.outcome.toLowerCase()}" style="font-size:8px;margin-top:4px;display:inline-block">${t.outcome}</span>
        </div>
      </div>
      ${notes}
      ${thumbs}
    </div>`;
  }).join('') : '<div class="empty">No trades logged on this day.</div>';
  pop.classList.add('open');
}

function closeDayPanel(e) { 
  if (e && e.target !== document.getElementById('day-panel-bg')) return;
  const p = document.getElementById('day-panel-bg'); 
  if (p) p.classList.remove('open'); 
}
// Support escape key added elsewhere

// ─── EXPORT / IMPORT ──────────────────────────
function exportData() {
  const blob = new Blob([JSON.stringify({ trades, weeks, models, exportedAt: new Date().toISOString(), version: 2 }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `profs-corner-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  toast('Data exported ✓');
}

function importData(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.trades || !Array.isArray(data.trades)) throw new Error('Invalid format');
      const msg = `Import <strong>${data.trades.length} trades</strong> and <strong>${(data.weeks||[]).length} weeks</strong>?<br><br>This will <strong>replace</strong> your current data. Export first if you want a backup.`;
      customConfirm(msg, () => {
        trades = data.trades;
        weeks  = data.weeks  || [];
        models = data.models || [...DEFAULT_MODELS];
        saveTrades(); saveWeeks(); saveModels();
        chartRendered.clear();
        renderDashboard();
        renderModelManager();
        toast(`Imported ${trades.length} trades ✓`);
      }, 'Import & Replace', 'var(--primary)');
    } catch { toast('Import failed — invalid file ✗'); }
  };
  reader.readAsText(file); event.target.value = '';
}

// ─── CUSTOM CONFIRM DIALOG ────────────────────
let _confirmCallback = null;
function customConfirm(msg, onAccept, okLabel = 'Confirm', okColor = 'var(--primary)') {
  _confirmCallback = onAccept;
  const bg  = document.getElementById('confirm-bg');
  const msgEl = document.getElementById('confirm-msg');
  const okBtn = document.getElementById('confirm-ok-btn');
  msgEl.innerHTML = msg;
  okBtn.textContent = okLabel;
  okBtn.style.background = '';
  okBtn.style.background = `linear-gradient(135deg, ${okColor}, ${okColor})`;
  if (okColor === 'var(--error)') okBtn.style.background = 'var(--error)';
  bg.classList.add('open');
}
function confirmAccept() {
  document.getElementById('confirm-bg').classList.remove('open');
  if (_confirmCallback) { _confirmCallback(); _confirmCallback = null; }
}
function confirmReject() {
  document.getElementById('confirm-bg').classList.remove('open');
  _confirmCallback = null;
}

// ─── MODEL MANAGER ────────────────────────────
function renderModelManager() {
  // Populate all select dropdowns with current model list
  ['f-model', 'edit-model'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value; // preserve current selection
    sel.innerHTML = '<option value="">— Select model —</option>' +
      models.map(m => `<option value="${m}">${m}</option>`).join('');
    if (current && models.includes(current)) sel.value = current;
  });

  // Render tag list in Add Trade page (add/remove UI)
  const list = document.getElementById('model-tag-list');
  if (!list) return;
  list.innerHTML = models.map(m =>
    `<span class="model-tag">
      ${m}
      <button class="model-tag-x" onclick="removeModel(${JSON.stringify(m).replace(/"/g,'&quot;')})" title="Remove">✕</button>
    </span>`
  ).join('');
}

function addNewModel() {
  const inp = document.getElementById('model-new-input');
  if (!inp) return;
  const name = inp.value.trim();
  if (!name) return;
  if (models.map(m => m.toLowerCase()).includes(name.toLowerCase())) {
    toast(`"${name}" already exists`); return;
  }
  models.push(name);
  saveModels();
  renderModelManager();
  inp.value = '';
  toast(`Model "${name}" added ✓`);
}

function removeModel(name) {
  customConfirm(
    `Remove model <strong>${name}</strong> from the list?<br><br>Trades that used this model are unaffected — they keep their model name.`,
    () => {
      models = models.filter(m => m !== name);
      saveModels();
      renderModelManager();
      toast(`Model "${name}" removed`);
    },
    'Remove', 'var(--error)'
  );
}

// ─── SEED DATA (run once on first launch) ─────
function seedTradeData() {
  if (localStorage.getItem(SEED_KEY)) return; // already seeded
  if (trades.length > 0) return; // user already has data

  const seedTrades = [{"id":"1772524800000","date":"2026-03-03","pair":"PHAUSDT","dir":"Long","bias":"Aligned","model":"Orderflow","outcome":"Win","sess":"Other","rr":5,"exec":"Good setup aligned with 1h one time-framing move. Executed on 5m. Continuation setup played upon breakout from first leg up, entry supported by A.VWAP, POC, fib 0.236-0.382. Second entry taken upon order flow depiction, high aggression of sellers at top with price not accepting below showing absorption. CVD without divs, consistently increasing open interest.","emo":"Entered with low size first with big stops. Interpreted data as bearish and closed setup on BE, entered again immediately. Followed my plan - let fear took over - came to senses and entered again - made profit - greed took over effectively roundtripping most of the gains.","imgs":[]},{"id":"1772524860000","date":"2026-03-05","pair":"ROBOUSDT","dir":"Long","bias":"Partial","model":"AMT","outcome":"Loss","sess":"Other","rr":1,"exec":"Range mean reversion back into the Value area with CVD absorption confirmation. SL placement got me stopped.","emo":"Fearful, entered first then exited then entered again. Went out letting the setup play out.","imgs":[]},{"id":"1772524920000","date":"2026-03-09","pair":"KERNELUSDT","dir":"Long","bias":"Aligned","model":"Price Action","outcome":"Win","sess":"Other","rr":3.5,"exec":"A breakout move of 5.5R but had to close later due to trail stops. Fib levels working good for HTF trend while I entered in continuation of LTF.","emo":"Fearful with the entry, went in only 0.5% risk. Khair, up 1% today.","imgs":[]},{"id":"1772524980000","date":"2026-03-13","pair":"BTCUSDT","dir":"Long","bias":"Aligned","model":"AMT","outcome":"Win","sess":"Other","rr":2.5,"exec":"Executed acceptance above VAH of HTF range for continuation setup from .382 fib. Trade did 5R but trail stopped at 2.5R","emo":"Vague SL placement had me risk half","imgs":[]},{"id":"1772525040000","date":"2026-03-13","pair":"TRUMPUSDT","dir":"Long","bias":"Aligned","model":"Price Action","outcome":"Win","sess":"Other","rr":7,"exec":"Executed continuation from .382 fib after grinding PA got overcome by aggressive buyers pushing price up. VWAP tap conf. Fib extensions as target for 7R","emo":"Cool head, risked properly, quick move into profits and that is what I like.","imgs":[]},{"id":"1772525100000","date":"2026-03-14","pair":"HUMAUSDT","dir":"Long","bias":"Aligned","model":"Price Action","outcome":"Loss","sess":"Other","rr":1,"exec":"Tried to enter continuation long mid leg up. Premature entry without confirmation.","emo":"—","imgs":[]},{"id":"1772525160000","date":"2026-03-20","pair":"UNKNOWN","dir":"Long","bias":"Aligned","model":"AMT","outcome":"Loss","sess":"Other","rr":0.5,"exec":"Executed a range breakout for continuation setup even though price action was exhaustive. Entered without solid confirmation as that would have ruined the RR","emo":"Closed early as soon as accepted back in value at half a R","imgs":[]},{"id":"1772525220000","date":"2026-03-23","pair":"CETUSUSDT","dir":"Long","bias":"Aligned","model":"Price Action","outcome":"Breakeven","sess":"Other","rr":0,"exec":"Executed at range POC and VWAP val, closed breakeven due to low volatility, not the type of reaction I like.","emo":"Not much, went all in with 0.5% for stops so it was just waiting for an hour before closing BE.","imgs":[]},{"id":"1772525280000","date":"2026-03-25","pair":"TAOUSDT","dir":"Long","bias":"Aligned","model":"Price Action","outcome":"Breakeven","sess":"Other","rr":0,"exec":"Executed continuation setup after the breakout of range. Closed BE after price did not give an immediate aggressive move.","emo":"Setup TP triggered after. Broke my rule of waiting for setup invalidation to hit to close the trade, let fear override.","imgs":[]},{"id":"1772525340000","date":"2026-03-26","pair":"OGNUSDT","dir":"Long","bias":"Aligned","model":"Price Action","outcome":"Loss","sess":"Other","rr":2,"exec":"Golden fib and VWAP scalp","emo":"All-inned with soft SL, took hit of -3%. ROUNDTRIPPED whole months gain.","imgs":[]},{"id":"1772525400000","date":"2026-03-26","pair":"STOUSDT","dir":"Long","bias":"Aligned","model":"AMT","outcome":"Win","sess":"Other","rr":4,"exec":"HTF continuation, LTF range break","emo":"Got in, got out BE, got in again higher with half the risk. Definitely got affected by the prev loss","imgs":[]},{"id":"1772525460000","date":"2026-03-27","pair":"CFGUSDT","dir":"Long","bias":"Aligned","model":"AMT","outcome":"Loss","sess":"Other","rr":1,"exec":"PrPOC, VWAP val and golden fib key level entry.","emo":"Nothing crazy, went in with 2 entries. Stopped after consolidation, BTC dumped wild tho","imgs":[]},{"id":"1772525520000","date":"2026-03-29","pair":"SOLUSDT","dir":"Long","bias":"Aligned","model":"AMT","outcome":"Loss","sess":"Other","rr":1,"exec":"Executed a swing reversal from VAL+OB and fib .5 extension. No vwap key levels present, rated the setup B+. Got wicked out due to news.","emo":"Nothing special, standard risk taken. Executed with confidence.","imgs":[]},{"id":"1772525580000","date":"2026-03-30","pair":"CHZUSDT","dir":"Long","bias":"Aligned","model":"Price Action","outcome":"Win","sess":"Other","rr":5,"exec":"Executed continuation trade from range breakout of .382 retrace bounce. Had to close at first TP","emo":"Went with half the risk because of Solana stoploss yesterday. A bit fearful.","imgs":[]},{"id":"1772525640000","date":"2026-03-31","pair":"KERNELUSDT","dir":"Long","bias":"Aligned","model":"","outcome":"Win","sess":"Other","rr":3,"exec":"","emo":"","imgs":[]},{"id":"1772525700000","date":"2026-03-31","pair":"KERNELUSDT","dir":"Long","bias":"Aligned","model":"","outcome":"Win","sess":"Other","rr":3,"exec":"","emo":"","imgs":[]},{"id":"1772525760000","date":"2026-03-31","pair":"ZBTUSDT","dir":"Long","bias":"Aligned","model":"","outcome":"Breakeven","sess":"Other","rr":1.5,"exec":"","emo":"","imgs":[]},{"id":"1772525820000","date":"2026-04-01","pair":"STOUSDT","dir":"Long","bias":"Aligned","model":"","outcome":"Win","sess":"Other","rr":4.5,"exec":"","emo":"","imgs":[]},{"id":"1772525880000","date":"2026-04-01","pair":"STOUSDT","dir":"Long","bias":"Aligned","model":"","outcome":"Win","sess":"Other","rr":10,"exec":"","emo":"","imgs":[]},{"id":"1772525940000","date":"2026-04-01","pair":"KERNELUSDT","dir":"Long","bias":"Aligned","model":"","outcome":"Win","sess":"Other","rr":7,"exec":"","emo":"","imgs":[]}];

  trades = seedTrades;
  saveTrades();
  localStorage.setItem(SEED_KEY, '1');
  console.log('Seed data loaded:', trades.length, 'trades');
}

// ─── LIGHTBOX ─────────────────────────────────
function openLB(src) {
  const lb = document.getElementById('lb'), img = document.getElementById('lb-img');
  if (!lb || !img) return;
  img.src = src;
  lb.classList.add('open');
  requestAnimationFrame(() => {
    const x = lb.querySelector('.lb-x');
    if (x && typeof x.focus === 'function') try { x.focus({ preventScroll: true }); } catch (e) { x.focus(); }
  });
}
function closeLB() {
  const lb = document.getElementById('lb');
  if (lb) lb.classList.remove('open');
}

// ─── KEYBOARD SHORTCUTS ───────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const calSb = document.getElementById('cal-sidebar');
    if (calSb && !calSb.classList.contains('collapsed')) {
      if (typeof window.closeJournalCalOverlay === 'function') window.closeJournalCalOverlay();
      return;
    }
    closeLB(); closeWeekView(null); closeCalPop();
    confirmReject(); closeModelMgr();
    const dp = document.getElementById('day-panel-bg');
    if (dp) dp.classList.remove('open');
    if (inlineEditId) cancelInlineEdit();
    return;
  }
  if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const keyMap = { d: 'dashboard', w: 'weekly', t: 'trades', n: 'add', s: 'sharecard' };
  const target = keyMap[e.key.toLowerCase()];
  if (target) { e.preventDefault(); showPage(target); }
});

function initObserver() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
  
  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
  
  /* Calendar is the collapsible block in .dash-right (see toggleCalendarSidebar). */
}

/** Console helper: prints localStorage keys used by this app (values truncated). */
window.ProfsCornerAudit = function () {
  const keys = [TK, WK, MK, SEED_KEY, 'profsCorner_focus', 'profsCorner_calOpen', 'profsCorner_debug', 'profsCorner_perf', PNL_BG_KEY, PNL_BG_LEGACY_KEY];
  const snap = {};
  keys.forEach(k => {
    try {
      const v = localStorage.getItem(k);
      if (v === null) snap[k] = null;
      else snap[k] = v.length > 200 ? `(${v.length} chars)` : v;
    } catch (e) { snap[k] = '(unreadable)'; }
  });
  if (typeof console !== 'undefined' && console.table) console.table(snap);
  const info = {
    tradesInMemory: trades.length,
    weeksInMemory: weeks.length,
    modelsInMemory: models.length,
    primaryTradeStorageKey: TK,
    perfModeActive: !!window.__PC_PERF,
    note: 'Trades are stored in the browser localStorage for this origin (file:// or http://host). Set localStorage profsCorner_perf to "1" or use ?perf=1 for a lighter UI.'
  };
  pcDbg('ProfsCornerAudit', info);
  return info;
};

// ─── INIT ─────────────────────────────────────
async function init() {
  if (!window.__PC_PERF) initEffects();
  if (typeof window.initJournalPremium === 'function') window.initJournalPremium();
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  set('top-date', dateStr);
  set('top-date-dash', dateStr);
  document.getElementById('f-date').value = now.toISOString().slice(0, 10);
  setupDropZone('f-drop',    'trade');
  setupDropZone('f-drop2',   'trade');
  setupDropZone('we-drop',   'we');
  setupDropZone('edit-drop', 'edit');
  
  await loadData();
  seedTradeData(); // load CSV trades on first run
  pcDbg('Loaded', { trades: trades.length, weeks: weeks.length, models: models.length, tradeStorageKey: TK, source: IS_ELECTRON ? 'electron' : 'localStorage' });
  renderModelManager();
  renderDashboard();
  await applyFocusModeFromStorage();
  
  try {
    const cs = document.getElementById('cal-sidebar');
    if (cs) {
      const calOpen = IS_ELECTRON 
        ? (await window.journalDB.getSetting('profsCorner_calOpen', '1') || '1')
        : localStorage.getItem('profsCorner_calOpen');
      if (calOpen === '0') {
        cs.classList.add('collapsed');
        const btn = document.getElementById('cal-sidebar-toggle-btn');
        const ch = cs.querySelector('.cal-sidebar-chevron');
        if (btn) btn.setAttribute('aria-expanded', 'false');
        if (ch) ch.textContent = 'expand_more';
      }
    }
  } catch {}
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const lb = document.getElementById('lb');
    if (lb && lb.classList.contains('open')) {
      e.preventDefault();
      closeLB();
    }
  });
  setTimeout(initObserver, 100);
  void initPnlCardBackgrounds();
}

async function applyFocusModeFromStorage() {
  const dash = document.getElementById('dashboard');
  if (!dash) return;
  let focusMode = false;
  if (IS_ELECTRON) {
    const val = await window.journalDB.getSetting('profsCorner_focus', '0');
    focusMode = val === '1';
  } else {
    try {
      focusMode = localStorage.getItem('profsCorner_focus') === '1';
    } catch {}
  }
  if (focusMode) dash.classList.add('focus-mode');
  else dash.classList.remove('focus-mode');
}

init();
