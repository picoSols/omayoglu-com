/*
 * Matrix-style rain backdrop + sacred-geometry overlay.
 *
 * An octagram ({8/3} — 8 vertices connected skip-3) sits behind the rain
 * with its centre positioned off the top-right of the viewport, so only
 * one corner of the star peeks into the frame. The star is drawn as a
 * faint persistent outline; crossings by matrix characters heat up a
 * short sub-section of the nearest segment and briefly reveal that part
 * of the pattern more brightly. Heat decays ~halving per 2 seconds, so
 * recently crossed bits linger before returning to the faint base. No
 * wider glow — the effect lives on the line itself.
 *
 * Timeline: 2s intro → 1s decay → 25s ambient → 4s fade to zero → stop.
 * Theme-aware palette. Disabled by prefers-reduced-motion.
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

  // Sub-segment granularity: each segment is split into ~5px steps so
  // heat resolves locally to roughly a character's width on crossing.
  var SUB_PX = 5;
  // Decay multiplier per frame. 0.99 ≈ half-life of 2 seconds at 60fps.
  var HEAT_DECAY = 0.99;
  // How far a character centre can be from a segment and still count.
  var HIT_RADIUS = 20;
  // How many sub-indices on each side of the crossing get heated.
  var HEAT_SPREAD = 2;

  var drops = [];
  var octagram = { cx: 0, cy: 0, r: 0, segments: [] };

  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var dims = { w: 0, h: 0 };
  var running = true;
  var finished = false;
  var rafId = 0;
  var t0 = 0;

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
    octagram.cx = dims.w * 1.02;
    octagram.cy = -dims.h * 0.08;
    octagram.r = Math.max(dims.w, dims.h) * 0.68;

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
      var len = Math.hypot(b.x - a.x, b.y - a.y);
      var N = Math.max(8, Math.ceil(len / SUB_PX));
      octagram.segments[k] = {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        length: len,
        N: N,
        heats: new Float32Array(N),
      };
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

  function distToSeg(px, py, s) {
    var dx = s.x2 - s.x1;
    var dy = s.y2 - s.y1;
    var len2 = dx * dx + dy * dy;
    if (len2 < 0.0001) {
      return { dist: Math.hypot(px - s.x1, py - s.y1), t: 0 };
    }
    var t = Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / len2));
    var cx = s.x1 + t * dx;
    var cy = s.y1 + t * dy;
    return { dist: Math.hypot(px - cx, py - cy), t: t };
  }

  function bumpHeat(seg, t, intensity) {
    var center = Math.floor(t * seg.N);
    if (center < 0) center = 0;
    if (center >= seg.N) center = seg.N - 1;
    for (var k = center - HEAT_SPREAD; k <= center + HEAT_SPREAD; k++) {
      if (k < 0 || k >= seg.N) continue;
      var d = Math.abs(k - center);
      // Triangular falloff: full at centre, 0 at (spread+1).
      var falloff = 1 - d / (HEAT_SPREAD + 1);
      var add = intensity * falloff;
      if (add <= 0) continue;
      var next = seg.heats[k] + add;
      seg.heats[k] = next > 1 ? 1 : next;
    }
  }

  function drawOctagram(layerAlpha) {
    ctx.lineCap = 'round';
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(' + palette.line + ',1)';

    for (var si = 0; si < octagram.segments.length; si++) {
      var seg = octagram.segments[si];

      // Very faint persistent base so the pattern is present but the
      // reveal on crossing does the work visually.
      ctx.globalAlpha = 0.025 * layerAlpha;
      ctx.beginPath();
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
      ctx.stroke();

      // Overlay short sub-segments for heated regions only.
      var invN = 1 / seg.N;
      var dx = seg.x2 - seg.x1;
      var dy = seg.y2 - seg.y1;
      for (var i = 0; i < seg.N; i++) {
        var h = seg.heats[i];
        if (h > 0.004) {
          var t0 = i * invN;
          var t1 = (i + 1) * invN;
          ctx.globalAlpha = h * 0.7 * layerAlpha;
          ctx.beginPath();
          ctx.moveTo(seg.x1 + dx * t0, seg.y1 + dy * t0);
          ctx.lineTo(seg.x1 + dx * t1, seg.y1 + dy * t1);
          ctx.stroke();
        }
        seg.heats[i] *= HEAT_DECAY;
      }
    }
  }

  function tick() {
    if (!running) return;
    var now = performance.now();
    var elapsed = now - t0;

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

    drawOctagram(layerAlpha);

    ctx.globalAlpha = dropAlpha;
    var active = Math.max(1, Math.floor(drops.length * densityScale));
    for (var di = 0; di < active; di++) {
      var d = drops[di];
      var ch = glyphs.charAt((Math.random() * glyphs.length) | 0);
      ctx.fillStyle = d.hot
        ? 'rgba(' + palette.hot + ',0.95)'
        : 'rgba(' + palette.drop + ',0.65)';
      ctx.fillText(ch, d.x, d.y);

      var gx = d.x + cellSize / 2;
      var gy = d.y + cellSize / 2;
      for (var si = 0; si < octagram.segments.length; si++) {
        var seg = octagram.segments[si];
        var r = distToSeg(gx, gy, seg);
        if (r.dist < HIT_RADIUS) {
          bumpHeat(seg, r.t, 0.7);
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
