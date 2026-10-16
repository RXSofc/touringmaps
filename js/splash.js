/* Launch splash driver. A classic script (not a module) so it starts before anything else loads.
   window.__splash.done() is called by app.js once the first screen is on the page. */
(function () {
  'use strict';
  var root = document.getElementById('splash');
  if (!root) return;

  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var svg = root.querySelector('.sp-art');
  var trails = [].slice.call(root.querySelectorAll('.sp-trail'));
  var heads = [].slice.call(root.querySelectorAll('.sp-head'));
  var tag = root.querySelector('.sp-tag');
  var TAGLINE = 'WITH EVILVOID⛧TEAM';

  var START = [200, 500, 800];     // when each rider sets off (ms)
  var DUR = 1500;                  // time to reach the meeting point
  var MERGE = START[2] + DUR;      // all three arrive
  var TYPE_STEP = 40;              // ms per tagline character
  var MIN_SHOW = MERGE + TAGLINE.length * TYPE_STEP + 900;   // leave only after the tagline is typed AND has been readable for 0.9 s
  var MAX_SHOW = 25000;            // safety: never trap the user behind the splash

  /* split the wordmark into letters so they can be staggered */
  var n = 0;
  [].forEach.call(root.querySelectorAll('.sp-line'), function (line) {
    var text = line.textContent; line.textContent = '';
    for (var i = 0; i < text.length; i++) {
      var s = document.createElement('span');
      s.className = 'sp-ch'; s.style.setProperty('--i', n++); s.textContent = text.charAt(i);
      line.appendChild(s);
    }
  });
  var label = root.getAttribute('aria-label');
  if (label) [].forEach.call(root.querySelectorAll('.sp-stage'), function (el) { el.setAttribute('aria-hidden', 'true'); });

  /* keep the CSS road exactly on the point where the SVG routes meet, on any screen shape */
  function place() {
    try {
      var m = root.querySelector('.sp-meet');
      var pt = svg.createSVGPoint(); pt.x = +m.getAttribute('cx'); pt.y = +m.getAttribute('cy');
      var p = pt.matrixTransform(svg.getScreenCTM());
      root.style.setProperty('--sp-y', Math.round(p.y) + 'px');
    } catch (e) { /* keep the CSS default */ }
  }
  place();
  window.addEventListener('resize', place);

  var lens = trails.map(function (p) { return p.getTotalLength(); });
  trails.forEach(function (p, i) { p.style.strokeDasharray = lens[i]; p.style.strokeDashoffset = lens[i]; p.style.visibility = 'hidden'; });
  var ease = function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  var clamp = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };

  var t0 = performance.now();
  var merged = false, titled = false, typed = 0, exiting = false, ready = false, raf = 0;

  function drawHead(i, p) {
    var L = lens[i], d = ease(p) * L;
    var a = trails[i].getPointAtLength(d), b = trails[i].getPointAtLength(Math.min(L, d + 2));
    var ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    heads[i].setAttribute('transform', 'translate(' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) + ') rotate(' + ang.toFixed(1) + ')');
    trails[i].style.strokeDashoffset = String(L * (1 - ease(p)));
  }

  function frame(now) {
    var t = now - t0;
    for (var i = 0; i < trails.length; i++) {
      var p = clamp((t - START[i]) / DUR);
      if (p > 0) { heads[i].classList.add('is-on'); trails[i].style.visibility = 'visible'; }
      drawHead(i, p);
      if (t >= MERGE) heads[i].classList.remove('is-on');
    }
    if (t >= MERGE - 500) {   /* the routes are absorbed into the road, tail first */
      var q = ease(clamp((t - (MERGE - 500)) / 1000));
      for (var k = 0; k < trails.length; k++) trails[k].style.strokeDasharray = '0 ' + (q * lens[k]).toFixed(1) + ' ' + lens[k];
    }
    if (!titled && t >= MERGE - 900) { titled = true; root.classList.add('is-title'); }
    if (!merged && t >= MERGE) { merged = true; root.classList.add('is-merged'); }
    if (merged && typed < TAGLINE.length && t >= MERGE + typed * TYPE_STEP) { typed++; tag.textContent = TAGLINE.slice(0, typed); }
    if (!exiting) raf = requestAnimationFrame(frame);
    if (t >= MAX_SHOW) leave();
  }

  function leave() {
    if (exiting) return;
    exiting = true; cancelAnimationFrame(raf);
    root.classList.add('is-leaving');
    setTimeout(function () { root.classList.add('is-gone'); }, 820);
    setTimeout(function () { if (root.parentNode) root.parentNode.removeChild(root); window.removeEventListener('resize', place); }, 1100);
  }

  function tryLeave() {
    if (!ready || exiting) return;
    var wait = MIN_SHOW - (performance.now() - t0);
    if (wait > 0) setTimeout(leave, wait); else leave();
  }

  if (reduce) {
    /* no motion: show the finished picture (no routes, wordmark and road in place) right away */
    trails.forEach(function (p) { p.style.display = 'none'; });
    root.classList.add('is-title', 'is-merged');
    tag.textContent = TAGLINE; MIN_SHOW = 500;
  } else {
    raf = requestAnimationFrame(frame);
  }

  window.__splash = { done: function () { ready = true; tryLeave(); } };
  setTimeout(leave, MAX_SHOW);
})();
