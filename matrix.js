/*
 * Matrix-style rain backdrop + sacred-geometry overlay.
 *
 * An octagram ({8/3} — 8 vertices connected skip-3) sits behind the rain
 * with its centre positioned off the top-right of the viewport, so only
 * one corner of the star peeks into the frame. The octagram renders at a
 * very faint persistent tint; when a falling matrix character passes
 * near one of its segments, that segment's "heat" bumps to full and
 * decays slowly over several seconds, leaving a temporary bright streak
 * where the rain touched the geometry. Each crossing also spawns a
 * short-lived radial glow centred on the contact point — an AOE bloom.
 *
 * Timeline: 2s intro → 1s decay → 25s ambient → 4s fade to zero → stop.
 *
 * Palette swaps live on theme change (data-theme attribute on <html>
 * and prefers-color-scheme media query). pointer-events: none on the
 * host, aria-hidden, prefers-reduced-motion disables the whole effect.
 */
(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var canvas = document.getElementById('matrix-bg');
  if (!canvas) return;
  var ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  var PALETTES = {
    dark:  { bg: '11,13,18',    drop: '242,152,72', hot: '255,200,140', line: '242,152,72' },
    light: { bg: '250,247,242', drop: '197,90,19',  hot: '232,140,60',  line: '197,90,19'  }
  };
  var palette = PALETTES.dark;

  function resolveTheme() {
    var explicit = document.documentElement.getAttribute('data-theme');
    if (explicit === 'light' || explicit === 'dark') return explicit;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function updatePalette() { palette = PALETTES[resolveTheme()]; }
  updatePalette();
  try {
    new MutationObserver(updatePalette).observe(document.documentElement, {
      attributes: true, attributeFilter: ['data-theme']
    });
  } catch (e) {}
  var mqTheme = window.matchMedia('(prefers-color-scheme: dark)');
  if (mqTheme.addEventListener) mqTheme.addEventListener('change', updatePalette);

  var glyphs =
    'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ' +
    '0123456789ABCDEF' +
    '⊕⊗⊙◉◎⬡⬢△▽◇◈✦✧✺⎔';

  var cellSize = 26;
  var spacing = 30;
  var introMs = 2000;
  var decayMs = 1000;
  var ambientMs = 25000;
  var fadeMs = 4000;
  var totalMs = introMs + decayMs + ambientMs + fadeMs;

  // Per-frame decay multiplier for octagram segment heat. 0.985^60 ≈ 0.4,
  // so heat halves roughly every second — a crossing leaves a trail that
  // stays perceptible for several seconds before fading.
  var HEAT_DECAY = 0.985;
  // Pixel radius around each segment where a matrix character counts as
  // "crossing". Slightly larger than cellSize/2 so glyphs that graze the
  // segment still register.
  var HIT_RADIUS = 22;

  var drops = [];
  var glows = [];
  var octagram = { cx: 0, cy: 0, r: 0, segments: [] };

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
    setupOctagram();
    seedDrops();
  }

  function setupOctagram() {
    // Centre positioned above+right of the viewport so a single point of
    // the star reaches down into the top-right region. Radius tuned so
    // one tip occupies roughly a quarter of the viewport's short edge.
    octagram.cx = dims.w * 1.02;
    octagram.cy = -dims.h * 0.08;
    octagram.r = Math.max(dims.w, dims.h) * 0.68;

    // {8/3}: 8 vertices, connect vertex i to vertex (i+3) mod 8.
    var verts = new Array(8);
    for (var i = 0; i < 8; i++) {
      var theta = (i * Math.PI) / 4;
      verts[i] = {
        x: octagram.cx + Math.cos(theta) * octagram.r,
        y: octagram.cy + Math.sin(theta) * octagram.r,
      };
    }
    octagram.segments = new Array(8);
    for (var k = 0; k < 8; k++) {
      var a = verts[k];
      var b = verts[(k + 3) % 8];
      octagram.segments[k] = { x1: a.x, y1: a.y, x2: b.x, y2: b.y, heat: 0 };
    }
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

  // Returns distance from (px, py) to segment s and the closest point.
  function distToSeg(px, py, s) {
    var dx = s.x2 - s.x1;
    var dy = s.y2 - s.y1;
    var len2 = dx * dx + dy * dy;
    if (len2 < 0.0001) {
      return { dist: Math.hypot(px - s.x1, py - s.y1), cx: s.x1, cy: s.y1 };
    }
    var t = Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / len2));
    var cx = s.x1 + t * dx;
    var cy = s.y1 + t * dy;
    return { dist: Math.hypot(px - cx, py - cy), cx: cx, cy: cy };
  }

  function drawOctagram(layerAlpha) {
    ctx.lineWidth = 1;
    for (var i = 0; i < octagram.segments.length; i++) {
      var s = octagram.segments[i];
      var alpha = (0.06 + s.heat * 0.55) * layerAlpha;
      if (alpha < 0.002) continue;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = 'rgba(' + palette.line + ',1)';
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
      // Heat decay — slow enough to leave a visible streak for several
      // seconds after a crossing.
      s.heat *= HEAT_DECAY;
    }
  }

  function drawGlows(delta, layerAlpha) {
    for (var i = glows.length - 1; i >= 0; i--) {
      var g = glows[i];
      g.life += delta;
      var p = g.life / g.maxLife;
      if (p >= 1) { glows.splice(i, 1); continue; }
      var alpha = Math.sin(p * Math.PI) * g.maxAlpha * layerAlpha;
      if (alpha < 0.003) continue;
      var radius = 36 + g.life * 0.02;
      var grad = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, radius);
      grad.addColorStop(0, 'rgba(' + palette.hot + ',' + alpha + ')');
      grad.addColorStop(1, 'rgba(' + palette.hot + ',0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(g.x, g.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function tick() {
    if (!running) return;
    var now = performance.now();
    var elapsed = now - t0;
    var delta = lastFrame ? now - lastFrame : 16;
    lastFrame = now;

    if (elapsed > totalMs) {
      ctx.clearRect(0, 0, dims.w, dims.h);
      finished = true;
      running = false;
      return;
    }

    var dropAlpha, trailAlpha, densityScale, layerAlpha;
    if (elapsed < introMs) {
      dropAlpha = 0.9; trailAlpha = 0.08; densityScale = 1; layerAlpha = 1;
    } else if (elapsed < introMs + decayMs) {
      var p = (elapsed - introMs) / decayMs;
      var ease = 1 - (1 - p) * (1 - p);
      dropAlpha = 0.9 - ease * 0.75;
      trailAlpha = 0.08 + ease * 0.06;
      densityScale = 1 - ease * 0.85;
      layerAlpha = 1;
    } else if (elapsed < introMs + decayMs + ambientMs) {
      dropAlpha = 0.15; trailAlpha = 0.14; densityScale = 0.15; layerAlpha = 1;
    } else {
      var fp = (elapsed - introMs - decayMs - ambientMs) / fadeMs;
      var fEase = fp * fp;
      dropAlpha = 0.15 * (1 - fEase);
      trailAlpha = 0.14;
      densityScale = 0.15 * (1 - fEase);
      layerAlpha = 1 - fEase;
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(' + palette.bg + ',' + trailAlpha + ')';
    ctx.fillRect(0, 0, dims.w, dims.h);

    // Glows behind the octagram (soft bloom around where chars hit).
    drawGlows(delta, layerAlpha);

    // Octagram under the rain.
    drawOctagram(layerAlpha);

    // Matrix drops + heat/glow injection on crossings.
    ctx.globalAlpha = dropAlpha;
    var active = Math.max(1, Math.floor(drops.length * densityScale));
    for (var di = 0; di < active; di++) {
      var d = drops[di];
      var g = glyphs.charAt((Math.random() * glyphs.length) | 0);
      ctx.fillStyle = d.hot
        ? 'rgba(' + palette.hot + ',0.95)'
        : 'rgba(' + palette.drop + ',0.65)';
      ctx.fillText(g, d.x, d.y);

      // Glyph centre in canvas space.
      var gx = d.x + cellSize / 2;
      var gy = d.y + cellSize / 2;

      for (var si = 0; si < octagram.segments.length; si++) {
        var seg = octagram.segments[si];
        var r = distToSeg(gx, gy, seg);
        if (r.dist < HIT_RADIUS) {
          seg.heat = Math.min(1, seg.heat + 0.3);
          // Spawn an occasional bloom at the contact point — throttled so
          // we don't queue hundreds of overlapping radial gradients.
          if (Math.random() < 0.3) {
            glows.push({
              x: r.cx + (Math.random() - 0.5) * 10,
              y: r.cy + (Math.random() - 0.5) * 10,
              life: 0,
              maxLife: 1200 + Math.random() * 600,
              maxAlpha: 0.18 + Math.random() * 0.08,
            });
          }
        }
      }

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
