/**
 * Prof's Corner — Premium UI: Chart.js defaults, ambient layer, doughnut/bubble glow.
 */
(function () {
  'use strict';

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function perfMode() {
    return typeof window !== 'undefined' && window.__PC_PERF;
  }

  var _shapeGlowRegistered = false;
  function registerShapeGlowPlugin() {
    if (_shapeGlowRegistered || typeof Chart === 'undefined') return;
    _shapeGlowRegistered = true;
    var shapeGlowPlugin = {
      id: 'premiumShapeGlow',
      beforeDatasetDraw: function (chart, args) {
        if (prefersReducedMotion()) return;
        var meta = chart.getDatasetMeta(args.index);
        var t = meta.type;
        /* Bar fills + ctx.shadowBlur fight each other (bars look hollow / outline-only until hover). Glow doughnut & bubble only. */
        if (t !== 'doughnut' && t !== 'pie' && t !== 'bubble') return;
        var blur = perfMode() ? 3 : 6;
        var ctx = chart.ctx;
        ctx.save();
        ctx.shadowBlur = blur;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.shadowColor = 'rgba(153, 247, 255, 0.32)';
      },
      afterDatasetDraw: function (chart, args) {
        /* MUST mirror beforeDatasetDraw: extra restore() without save() breaks the whole chart (and aborts dashboard render). */
        if (prefersReducedMotion()) return;
        var meta = chart.getDatasetMeta(args.index);
        var t = meta.type;
        if (t !== 'doughnut' && t !== 'pie' && t !== 'bubble') return;
        chart.ctx.restore();
      }
    };
    try {
      Chart.register(shapeGlowPlugin);
    } catch (err) {
      if (err && err.message && err.message.indexOf('already been registered') === -1) throw err;
    }
  }

  function registerChartPremium() {
    if (typeof Chart === 'undefined') return;

    Chart.defaults.animation.duration = 0;
    Chart.defaults.animation.easing = 'easeOutQuart';
    Chart.defaults.font.family = "'JetBrains Mono', monospace";
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.borderColor = 'rgba(66,73,80,.35)';
    Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(23,33,41,.94)';
    Chart.defaults.plugins.tooltip.titleColor = '#a5acb4';
    Chart.defaults.plugins.tooltip.bodyColor = '#eef4fd';
    Chart.defaults.plugins.tooltip.displayColors = true;

    try {
      var dpr = window.devicePixelRatio || 1;
      Chart.defaults.devicePixelRatio = perfMode() ? 1 : Math.min(dpr, 1.35);
    } catch (e) {}
    try {
      var tr = Chart.defaults.transitions;
      if (tr && tr.active && tr.active.animation) tr.active.animation.duration = 0;
    } catch (e) {}

    registerShapeGlowPlugin();
  }

  function initAmbient() {
    if (
      perfMode() ||
      prefersReducedMotion() ||
      (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
    ) {
      document.documentElement.style.setProperty('--ambient-x', '0');
      document.documentElement.style.setProperty('--ambient-y', '0');
      return;
    }
    var lastEmit = 0;
    var minGapMs = 48;
    function onMove(e) {
      var now = performance.now();
      if (now - lastEmit < minGapMs) return;
      lastEmit = now;
      var x = (e.clientX / window.innerWidth - 0.5) * 2;
      var y = (e.clientY / window.innerHeight - 0.5) * 2;
      document.documentElement.style.setProperty('--ambient-x', x.toFixed(3));
      document.documentElement.style.setProperty('--ambient-y', y.toFixed(3));
    }
    window.addEventListener('mousemove', onMove, { passive: true });
  }

  function initChartParallax() {}

  window.initJournalPremium = function () {
    registerChartPremium();
    initAmbient();
    initChartParallax();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      registerChartPremium();
    });
  } else {
    registerChartPremium();
  }
})();
