/*
 * Matrix-style rain backdrop for omayoglu.com.
 *
 * Timeline: 2s intro at full density → 1s decay to ambient → 25s ambient
 * → 4s fade to zero → stop. ~32 seconds end-to-end, after which the canvas
 * is cleared and the rAF loop exits. The effect is an *opening moment*,
 * not a permanent texture.
 *
 * Glyph palette combines half-width Katakana (classic Matrix register),
 * hex digits (dev-tool flavour) and a small set of sacred-geometry
 * symbols (⊕ ⊗ ⊙ ⬡ △ ▽ ✦) that occasionally drop through the rain.
 *
 * Faint amber "leylines" spawn every ~3s during active phases: straight
 * segments that sine-fade in and out over 3–5s, at very low alpha. They
 * give the composition a map-of-nodes feel without becoming noisy.
 *
 * Accessibility: prefers-reduced-motion disables the effect entirely.
 * Canvas is aria-hidden. pointer-events: none so it never intercepts
 * input. Pauses on visibilitychange when the tab is hidden.
 */
(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var canvas = document.getElementById('matrix-bg');
  if (!canvas) return;
  var ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  var glyphs =
    'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ' +
    '0123456789ABCDEF' +
    '⊕⊗⊙◉◎⬡⬢△▽◇◈✦✧✺⎔';

  var cellSize = 22;
  var spacing = 26;
  var introMs = 2000;
  var decayMs = 1000;
  var ambientMs = 25000;
  var fadeMs = 4000;
  var totalMs = introMs + decayMs + ambientMs + fadeMs;

  var drops = [];
  var leylines = [];
  var lastLeylineAt = -Infinity;
  var leylineIntervalMs = 2800;

  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var dims = { w: 0, h: 0 };
  var running = true;
  var finished = false;
  var rafId = 0;
  var t0 = 0;
  var lastFrame = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    dims.w = window.innerWidth;
    dims.h = window.innerHeight;
    canvas.width = Math.floor(dims.w * dpr);
    canvas.height = Math.floor(dims.h * dpr);
    canvas.style.width = dims.w + 'px';
    canvas.style.height = dims.h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '500 ' + (cellSize - 4) + 'px "JetBrains Mono", ui-monospace, monospace';
    ctx.textBaseline = 'top';
    seedDrops();
  }

  function seedDrops() {
    var cols = Math.max(1, Math.floor(dims.w / spacing));
    var count = Math.max(12, Math.floor(cols * 0.7));
    drops = new Array(count);
    for (var i = 0; i < count; i++) {
      drops[i] = {
        x: Math.random() * dims.w,
        y: Math.random() * dims.h - dims.h,
        speed: 1.2 + Math.random() * 2.5,
        hot: Math.random() < 0.15,
      };
    }
  }

  function spawnLeyline() {
    var x1 = Math.random() * dims.w;
    var y1 = Math.random() * dims.h;
    var angle = Math.random() * Math.PI * 2;
    var length = (0.3 + Math.random() * 0.5) * Math.max(dims.w, dims.h);
    leylines.push({
      x1: x1,
      y1: y1,
      x2: x1 + Math.cos(angle) * length,
      y2: y1 + Math.sin(angle) * length,
      life: 0,
      maxLife: 3000 + Math.random() * 2000,
    });
  }

  function tick() {
    if (!running) return;
    var now = performance.now();
    var elapsed = now - t0;
    var delta = lastFrame ? now - lastFrame : 16;
    lastFrame = now;

    // After total runtime the effect clears away and the loop exits.
    if (elapsed > totalMs) {
      ctx.clearRect(0, 0, dims.w, dims.h);
      finished = true;
      running = false;
      return;
    }

    var dropAlpha, trailAlpha, densityScale, layerAlpha;

    if (elapsed < introMs) {
      dropAlpha = 0.9;
      trailAlpha = 0.08;
      densityScale = 1;
      layerAlpha = 1;
    } else if (elapsed < introMs + decayMs) {
      var p = (elapsed - introMs) / decayMs;
      var ease = 1 - (1 - p) * (1 - p); // easeOutQuad
      dropAlpha = 0.9 - ease * 0.75; // → 0.15
      trailAlpha = 0.08 + ease * 0.06; // → 0.14
      densityScale = 1 - ease * 0.85; // → 0.15
      layerAlpha = 1;
    } else if (elapsed < introMs + decayMs + ambientMs) {
      dropAlpha = 0.15;
      trailAlpha = 0.14;
      densityScale = 0.15;
      layerAlpha = 1;
    } else {
      // Fade-out phase: everything eases toward zero over fadeMs.
      var fp = (elapsed - introMs - decayMs - ambientMs) / fadeMs;
      var fEase = fp * fp; // easeInQuad
      dropAlpha = 0.15 * (1 - fEase);
      trailAlpha = 0.14;
      densityScale = 0.15 * (1 - fEase);
      layerAlpha = 1 - fEase;
    }

    // Paint a translucent bg rect to fade the previous frame toward the
    // page colour. Near-black works well on both themes at low alpha.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(11,13,18,' + trailAlpha + ')';
    ctx.fillRect(0, 0, dims.w, dims.h);

    // Leylines — spawn only during intro/decay/ambient.
    if (
      elapsed < introMs + decayMs + ambientMs &&
      now - lastLeylineAt > leylineIntervalMs
    ) {
      spawnLeyline();
      lastLeylineAt = now;
    }

    for (var li = leylines.length - 1; li >= 0; li--) {
      var ll = leylines[li];
      ll.life += delta;
      var lp = ll.life / ll.maxLife;
      if (lp >= 1) {
        leylines.splice(li, 1);
        continue;
      }
      // sine lobe: rises, peaks mid-life, falls.
      var llAlpha = Math.sin(lp * Math.PI) * 0.14 * layerAlpha;
      ctx.globalAlpha = llAlpha;
      ctx.strokeStyle = 'rgba(242,152,72,1)';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(ll.x1, ll.y1);
      ctx.lineTo(ll.x2, ll.y2);
      ctx.stroke();
    }

    // Matrix drops.
    ctx.globalAlpha = dropAlpha;
    var active = Math.max(1, Math.floor(drops.length * densityScale));
    for (var di = 0; di < active; di++) {
      var d = drops[di];
      var g = glyphs.charAt((Math.random() * glyphs.length) | 0);
      ctx.fillStyle = d.hot ? 'rgba(255,200,140,0.95)' : 'rgba(242,152,72,0.65)';
      ctx.fillText(g, d.x, d.y);
      d.y += d.speed;
      if (d.y > dims.h + cellSize) {
        d.y = -cellSize - Math.random() * 80;
        d.x = Math.random() * dims.w;
        d.speed = 1.2 + Math.random() * 2.5;
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
    } else if (!running && !finished) {
      running = true;
      tick();
    }
  });

  t0 = performance.now();
  tick();
})();
