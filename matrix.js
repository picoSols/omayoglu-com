/*
 * Matrix-style rain backdrop — vanilla JS port of the Angular backdrop
 * used on prompt-shield.omayoglu.com. Plays a ~2s intro at full density
 * then decays over 1s into a sparse ambient state that lives behind the
 * content for the rest of the session.
 *
 * pointer-events: none so it never intercepts input. aria-hidden on the
 * canvas so assistive tech skips it. prefers-reduced-motion disables the
 * effect entirely — the canvas just stays blank.
 */
(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  var canvas = document.getElementById('matrix-bg');
  if (!canvas) return;
  var ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  // Half-width Katakana + hex digits + a handful of symbols. Katakana is
  // the classic Matrix register; hex keeps the dev-tool flavour.
  var glyphs =
    'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789ABCDEF/<>{}[];:=';

  var cellSize = 18;
  var spacing = 22;
  var introMs = 2000;
  var decayMs = 1000;

  var drops = [];
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var dims = { w: 0, h: 0 };
  var running = true;
  var rafId = 0;
  var t0 = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var rect = canvas.getBoundingClientRect();
    dims.w = rect.width;
    dims.h = rect.height;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '500 ' + (cellSize - 4) + 'px "JetBrains Mono", ui-monospace, monospace';
    ctx.textBaseline = 'top';
    seedDrops();
  }

  function seedDrops() {
    var cols = Math.max(1, Math.floor(dims.w / spacing));
    var count = Math.max(6, Math.floor(cols * 0.6));
    drops = new Array(count);
    for (var i = 0; i < count; i++) {
      drops[i] = {
        x: Math.random() * dims.w,
        y: Math.random() * dims.h - dims.h,
        speed: 1.2 + Math.random() * 2.2,
        hot: Math.random() < 0.15,
      };
    }
  }

  function tick() {
    if (!running) return;
    var now = performance.now();
    var elapsed = now - t0;

    var globalAlpha, trailAlpha, densityScale;

    if (elapsed < introMs) {
      globalAlpha = 0.9;
      trailAlpha = 0.08;
      densityScale = 1;
    } else if (elapsed < introMs + decayMs) {
      var p = (elapsed - introMs) / decayMs;
      var ease = 1 - (1 - p) * (1 - p); // easeOutQuad
      globalAlpha = 0.9 - ease * 0.75;  // → 0.15
      trailAlpha = 0.08 + ease * 0.06;   // → 0.14
      densityScale = 1 - ease * 0.85;    // → 0.15
    } else {
      globalAlpha = 0.15;
      trailAlpha = 0.14;
      densityScale = 0.15;
    }

    // Fade previous frame toward the page bg. Near-black RGB works on
    // both light and dark themes because trailAlpha is low.
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(11, 13, 18, ' + trailAlpha + ')';
    ctx.fillRect(0, 0, dims.w, dims.h);

    ctx.globalAlpha = globalAlpha;

    var active = Math.max(1, Math.floor(drops.length * densityScale));
    for (var j = 0; j < active; j++) {
      var d = drops[j];
      var g = glyphs.charAt((Math.random() * glyphs.length) | 0);

      ctx.fillStyle = d.hot
        ? 'rgba(255, 200, 140, 0.95)'
        : 'rgba(242, 152, 72, 0.6)';
      ctx.fillText(g, d.x, d.y);

      d.y += d.speed;

      if (d.y > dims.h + cellSize) {
        d.y = -cellSize - Math.random() * 80;
        d.x = Math.random() * dims.w;
        d.speed = 1.2 + Math.random() * 2.2;
        d.hot = Math.random() < 0.15;
      }
    }

    rafId = requestAnimationFrame(tick);
  }

  resize();
  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      running = false;
      cancelAnimationFrame(rafId);
    } else if (!running) {
      running = true;
      // Resume directly in ambient — don't replay the intro on tab refocus.
      t0 = performance.now() - introMs - decayMs;
      tick();
    }
  });

  t0 = performance.now();
  tick();
})();
