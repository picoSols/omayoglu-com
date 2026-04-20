/*
 * Matrix-style rain backdrop + rub-al-hizb-style sacred-geometry overlay.
 *
 * The geometry is two overlapping squares — one axis-aligned, one rotated
 * 45° — enclosed by a single large circle. Centre is positioned off the
 * top-right of the viewport so only one corner of the composition is
 * visible. The geometry renders invisible by default; only where a
 * matrix character has recently passed over a line does that tiny stretch
 * (or arc slice) light up. Heat decays over ~2s so the streak lingers
 * before fading back to nothing. The characters feel like they are
 * painting the pattern in as they cross it.
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

  var cellSize = 29;
  var spacing = 33;
  var introMs = 2000;
  var decayMs = 1000;
  var ambientMs = 25000;
  var fadeMs = 4000;
  var totalMs = introMs + decayMs + ambientMs + fadeMs;

  // Heat accumulates per sub ~5px along a segment. Decay half-life ~2s.
  // Tight spread + small hit radius + low bump intensity so the painted
  // highlight stays roughly 1.5× the glyph size, not much larger.
  var SUB_PX = 5;
  var HEAT_DECAY = 0.99;
  var HIT_RADIUS = 15;
  var HEAT_SPREAD = 1;
  var HEAT_INTENSITY = 0.35;

  // Circle slot count is computed at setupGeometry so each slot covers
  // roughly SUB_PX of arc length. That keeps the painted arc section
  // about the same size as a lit line sub-segment.
  var CIRCLE_SPREAD = 1;

  var drops = [];
  var geometry = {
    cx: 0, cy: 0, r: 0, circleR: 0,
    segments: [],
    circle: null,
  };

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
    setupGeometry();
    seedDrops();
  }

  function setupGeometry() {
    // Centre offscreen top-right so only one corner of the
    // rub-al-hizb-style composition sits inside the viewport.
    geometry.cx = dims.w * 1.04;
    geometry.cy = -dims.h * 0.10;
    geometry.r = Math.max(dims.w, dims.h) * 0.70;
    geometry.circleR = geometry.r * 1.08;

    // 8 vertices around the centre at 45° intervals.
    var verts = new Array(8);
    for (var i = 0; i < 8; i++) {
      var theta = (i * Math.PI) / 4;
      verts[i] = {
        x: geometry.cx + Math.cos(theta) * geometry.r,
        y: geometry.cy + Math.sin(theta) * geometry.r,
      };
    }

    // Two overlapping squares:
    //   Square A (axis-aligned): verts at 0°, 90°, 180°, 270° → indices 0,2,4,6
    //   Square B (rotated 45°): verts at 45°, 135°, 225°, 315° → indices 1,3,5,7
    // 4 sides each → 8 straight segments.
    var pairs = [
      [0, 2], [2, 4], [4, 6], [6, 0],
      [1, 3], [3, 5], [5, 7], [7, 1],
    ];
    geometry.segments = new Array(pairs.length);
    for (var k = 0; k < pairs.length; k++) {
      var a = verts[pairs[k][0]];
      var b = verts[pairs[k][1]];
      var len = Math.hypot(b.x - a.x, b.y - a.y);
      var N = Math.max(8, Math.ceil(len / SUB_PX));
      geometry.segments[k] = {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        length: len, N: N,
        heats: new Float32Array(N),
      };
    }

    // Enclosing circle — heat stored in angle-indexed slots. Slot count
    // scales with circumference so each slot is ~SUB_PX of arc, giving
    // the same fragmentation as the straight segments.
    var circleN = Math.max(180, Math.ceil((2 * Math.PI * geometry.circleR) / SUB_PX));
    geometry.circle = {
      cx: geometry.cx,
      cy: geometry.cy,
      r: geometry.circleR,
      N: circleN,
      heats: new Float32Array(circleN),
    };
  }

  function seedDrops() {
    var cols = Math.max(1, Math.floor(dims.w / spacing));
    var count = Math.max(12, Math.floor(cols * 0.77));
    drops = new Array(count);
    for (var i = 0; i < count; i++) {
      drops[i] = {
        x: Math.random() * dims.w,
        y: Math.random() * dims.h - dims.h,
        speed: 1.08 + Math.random() * 2.25,
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

  function bumpSegmentHeat(seg, t, intensity) {
    var center = Math.floor(t * seg.N);
    if (center < 0) center = 0;
    if (center >= seg.N) center = seg.N - 1;
    for (var k = center - HEAT_SPREAD; k <= center + HEAT_SPREAD; k++) {
      if (k < 0 || k >= seg.N) continue;
      var d = Math.abs(k - center);
      var falloff = 1 - d / (HEAT_SPREAD + 1);
      var add = intensity * falloff;
      if (add <= 0) continue;
      var next = seg.heats[k] + add;
      seg.heats[k] = next > 1 ? 1 : next;
    }
  }

  function bumpCircleHeat(circle, angle01, intensity) {
    var center = Math.floor(angle01 * circle.N);
    // Angle is modular — wrap around the array.
    var N = circle.N;
    for (var k = -CIRCLE_SPREAD; k <= CIRCLE_SPREAD; k++) {
      var idx = ((center + k) % N + N) % N;
      var d = Math.abs(k);
      var falloff = 1 - d / (CIRCLE_SPREAD + 1);
      var add = intensity * falloff;
      if (add <= 0) continue;
      var next = circle.heats[idx] + add;
      circle.heats[idx] = next > 1 ? 1 : next;
    }
  }

  function drawGeometry(layerAlpha) {
    ctx.lineCap = 'round';
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(' + palette.line + ',1)';

    // Straight segments — only draw lit sub-segments. No persistent line.
    for (var si = 0; si < geometry.segments.length; si++) {
      var seg = geometry.segments[si];
      var invN = 1 / seg.N;
      var dx = seg.x2 - seg.x1;
      var dy = seg.y2 - seg.y1;
      for (var i = 0; i < seg.N; i++) {
        var h = seg.heats[i];
        if (h > 0.004) {
          var a = i * invN;
          var b = (i + 1) * invN;
          ctx.globalAlpha = h * 0.75 * layerAlpha;
          ctx.beginPath();
          ctx.moveTo(seg.x1 + dx * a, seg.y1 + dy * a);
          ctx.lineTo(seg.x1 + dx * b, seg.y1 + dy * b);
          ctx.stroke();
        }
        seg.heats[i] *= HEAT_DECAY;
      }
    }

    // Circle — only draw lit arc slots.
    var c = geometry.circle;
    var step = (Math.PI * 2) / c.N;
    var base = -Math.PI; // atan2 range starts at -π
    for (var j = 0; j < c.N; j++) {
      var hc = c.heats[j];
      if (hc > 0.004) {
        var a0 = base + j * step;
        var a1 = base + (j + 1) * step;
        ctx.globalAlpha = hc * 0.75 * layerAlpha;
        ctx.beginPath();
        ctx.arc(c.cx, c.cy, c.r, a0, a1);
        ctx.stroke();
      }
      c.heats[j] *= HEAT_DECAY;
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

    drawGeometry(layerAlpha);

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

      // Straight-segment crossings.
      for (var si = 0; si < geometry.segments.length; si++) {
        var seg = geometry.segments[si];
        var r = distToSeg(gx, gy, seg);
        if (r.dist < HIT_RADIUS) bumpSegmentHeat(seg, r.t, HEAT_INTENSITY);
      }

      // Circle crossings: distance to ring = |dist-from-centre − radius|.
      var c = geometry.circle;
      var dxc = gx - c.cx;
      var dyc = gy - c.cy;
      var radial = Math.hypot(dxc, dyc);
      if (Math.abs(radial - c.r) < HIT_RADIUS) {
        var angle = Math.atan2(dyc, dxc);       // (-π, π]
        var angle01 = (angle + Math.PI) / (Math.PI * 2);
        bumpCircleHeat(c, angle01, HEAT_INTENSITY);
      }

      d.y += d.speed;
      if (d.y > dims.h + cellSize) {
        d.y = -cellSize - Math.random() * 80;
        d.x = Math.random() * dims.w;
        d.speed = 1.08 + Math.random() * 2.25;
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
