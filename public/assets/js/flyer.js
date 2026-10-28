/* NextGen Summit — the "I'm attending" flyer generator.

   A visitor types their name, picks a photograph, nudges it into place and downloads a
   1080x1350 PNG. Everything happens in the browser: the photograph is read with FileReader
   and drawn to a canvas, and nothing is ever uploaded anywhere. There is no endpoint behind
   this file, which is the point -- people are handing over their face and their name.

   THE ARTWORK IS A CONFIG, NOT CODE

   The final flyer design is still being drawn. Everything about the layout lives in TEMPLATE
   below: the canvas size, where the photograph sits, where the name sits, and the fixed
   lines. Swapping in the finished artwork is one edit --

       TEMPLATE.bg = '/assets/img/flyer/flyer-1080x1350.png';

   -- and the generator stops painting the placeholder, draws that image instead, and keeps
   putting the photograph and the name in the boxes the config describes. Move a box by
   changing four numbers. Nothing in the drawing, cropping, fitting, download or error
   handling has to be touched again.

   WHAT IS NEVER DONE TO THE PHOTOGRAPH

   It is cropped to the frame, scaled and moved, and that is all. No filter, no beautifying,
   no generation, nothing that changes a face. The pixels drawn are the pixels supplied. */
(function () {
  'use strict';

  var root = document.querySelector('[data-flyer]');
  if (!root) return;

  /* ========================================================================
     THE TEMPLATE
     ===================================================================== */
  var TEMPLATE = {
    w: 1080,
    h: 1350,

    /* null = draw the placeholder below. Set to a URL and that image is drawn instead,
       full-bleed, with the photo and name placed on top at the coordinates here. */
    bg: null,

    ink: '#0B0B0F',
    paper: '#FAFAF8',
    accent: '#1FC7BE',

    /* Where the visitor's photograph goes. 'circle' clips to a circle inside the box;
       'rect' fills the box. Coordinates are in canvas pixels. */
    photo: { x: 340, y: 336, w: 400, h: 400, shape: 'circle', ring: 8 },

    /* Where their name goes. The size shrinks, then the line wraps, until it fits. */
    name: { x: 540, y: 854, maxW: 860, size: 104, min: 52, lh: 1.02, align: 'center' },

    /* Fixed text. Only drawn while bg is null -- once the real artwork arrives it carries
       its own lettering and these would print on top of it. */
    fixed: [
      { t: 'nextgen',                        x: 540, y: 150, size: 92,  font: 'display', colour: 'paper', align: 'center', track: -0.04 },
      { t: 'SUMMIT',                         x: 540, y: 196, size: 25,  font: 'sans',    colour: 'dim',   align: 'center', track: 0.46 },
      { t: "I'M ATTENDING",                  x: 540, y: 283, size: 30,  font: 'sans',    colour: 'accent',align: 'center', track: 0.30 },
      { t: 'NEXTGEN SUMMIT',                 x: 540, y: 950, size: 38,  font: 'sans',    colour: 'paper', align: 'center', track: 0.22 },
      { t: 'OCTOBER 30, 2026',               x: 540, y: 1128, size: 27, font: 'sans',    colour: 'accent',align: 'center', track: 0.22 },
      { t: 'GORDON CENTER  ·  OWINGS MILLS, MD', x: 540, y: 1178, size: 22, font: 'sans', colour: 'dim',  align: 'center', track: 0.18 },
      { t: 'nextgensummit.us',               x: 540, y: 1256, size: 25, font: 'sans',    colour: 'paper', align: 'center', track: 0.16 }
    ],

    rules: [ { x: 440, y: 1000, w: 200, h: 3, colour: 'accent' } ]
  };

  var FONTS = {
    display: '900 %spx Fraunces, Georgia, serif',
    sans:    '800 %spx Montserrat, Helvetica Neue, Arial, sans-serif'
  };
  var COLOURS = function (k) {
    return k === 'accent' ? TEMPLATE.accent
         : k === 'ink'    ? TEMPLATE.ink
         : k === 'dim'    ? 'rgba(250,250,248,.62)'
         : TEMPLATE.paper;
  };

  /* ========================================================================
     State
     ===================================================================== */
  var canvas  = root.querySelector('[data-flyer-canvas]');
  var ctx     = canvas.getContext('2d');
  var nameIn  = root.querySelector('[data-flyer-name]');
  var fileIn  = root.querySelector('[data-flyer-file]');
  var drop    = root.querySelector('[data-flyer-drop]');
  var zoomIn  = root.querySelector('[data-flyer-zoom]');
  var dlBtn   = root.querySelector('[data-flyer-download]');
  var resetBt = root.querySelector('[data-flyer-reset]');
  var errEl   = root.querySelector('[data-flyer-error]');
  var openBtn = document.querySelector('[data-flyer-open]');
  var studio  = root.querySelector('[data-flyer-studio]');
  var hint    = root.querySelector('[data-flyer-hint]');

  canvas.width = TEMPLATE.w;
  canvas.height = TEMPLATE.h;

  var photo = null;        // the HTMLImageElement, once one is chosen
  var zoom = 1;            // 1 = the photo exactly covers the frame
  var offX = 0, offY = 0;  // nudge, in canvas pixels
  var bgImg = null;        // the final artwork, once TEMPLATE.bg is set
  var fontsReady = false;

  function say(msg) {
    if (!errEl) return;
    errEl.textContent = msg || '';
    errEl.hidden = !msg;
  }

  /* ========================================================================
     Drawing
     ===================================================================== */
  function setFont(spec, size) { ctx.font = FONTS[spec].replace('%s', size); }

  /* Canvas has no letter-spacing in every browser we support, so tracked text is drawn a
     glyph at a time. Only used on short lines, where the cost is nothing. */
  function tracked(text, x, y, size, track, align) {
    var sp = size * track, total = 0, i;
    for (i = 0; i < text.length; i++) total += ctx.measureText(text[i]).width + sp;
    total -= sp;
    var cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    for (i = 0; i < text.length; i++) {
      ctx.fillText(text[i], cx, y);
      cx += ctx.measureText(text[i]).width + sp;
    }
  }

  function drawPlaceholder() {
    var W = TEMPLATE.w, H = TEMPLATE.h;
    ctx.fillStyle = TEMPLATE.ink;
    ctx.fillRect(0, 0, W, H);

    /* One soft pool of the brand colour behind the portrait, and a hairline frame. No
       gradient wash over the whole sheet: the brief asks for the opposite of that. */
    var p = TEMPLATE.photo;
    var g = ctx.createRadialGradient(p.x + p.w / 2, p.y + p.h / 2, 40, p.x + p.w / 2, p.y + p.h / 2, 620);
    g.addColorStop(0, 'rgba(31,199,190,.20)');
    g.addColorStop(1, 'rgba(31,199,190,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(250,250,248,.22)';
    ctx.lineWidth = 2;
    ctx.strokeRect(40.5, 40.5, W - 81, H - 81);

    TEMPLATE.rules.forEach(function (r) {
      ctx.fillStyle = COLOURS(r.colour);
      ctx.fillRect(r.x, r.y, r.w, r.h);
    });

    ctx.textBaseline = 'alphabetic';
    TEMPLATE.fixed.forEach(function (f) {
      setFont(f.font, f.size);
      ctx.fillStyle = COLOURS(f.colour);
      ctx.textAlign = f.track ? 'left' : f.align;
      if (f.track) tracked(f.t, f.x, f.y, f.size, f.track, f.align);
      else ctx.fillText(f.t, f.x, f.y);
    });
  }

  function drawPhotoFrame() {
    var p = TEMPLATE.photo;
    ctx.save();
    if (p.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(p.x + p.w / 2, p.y + p.h / 2, Math.min(p.w, p.h) / 2, 0, Math.PI * 2);
      ctx.clip();
    } else {
      ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip();
    }

    if (photo) {
      /* cover-fit, then the visitor's zoom and nudge on top */
      var s = Math.max(p.w / photo.naturalWidth, p.h / photo.naturalHeight) * zoom;
      var dw = photo.naturalWidth * s, dh = photo.naturalHeight * s;
      ctx.drawImage(photo, p.x + (p.w - dw) / 2 + offX, p.y + (p.h - dh) / 2 + offY, dw, dh);
    } else {
      ctx.fillStyle = 'rgba(250,250,248,.07)';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      setFont('sans', 24);
      ctx.fillStyle = 'rgba(250,250,248,.5)';
      ctx.textAlign = 'center';
      ctx.fillText('YOUR PHOTO', p.x + p.w / 2, p.y + p.h / 2 + 8);
    }
    ctx.restore();

    if (p.ring) {
      ctx.strokeStyle = TEMPLATE.accent;
      ctx.lineWidth = p.ring;
      ctx.beginPath();
      if (p.shape === 'circle') {
        ctx.arc(p.x + p.w / 2, p.y + p.h / 2, Math.min(p.w, p.h) / 2 - p.ring / 2, 0, Math.PI * 2);
      } else {
        ctx.rect(p.x + p.ring / 2, p.y + p.ring / 2, p.w - p.ring, p.h - p.ring);
      }
      ctx.stroke();
    }
  }

  /* The name shrinks to fit, and only wraps once shrinking has run out. A long name
     therefore stays on one line for as long as it can read, which is what a flyer wants. */
  function drawName() {
    var n = TEMPLATE.name;
    var text = (nameIn.value || '').trim().toUpperCase() || 'YOUR NAME';
    var size = n.size;
    setFont('display', size);
    while (size > n.min && ctx.measureText(text).width > n.maxW) {
      size -= 2; setFont('display', size);
    }

    var lines = [text];
    if (ctx.measureText(text).width > n.maxW) {
      var words = text.split(/\s+/), a = '', out = [];
      for (var i = 0; i < words.length; i++) {
        var t = a ? a + ' ' + words[i] : words[i];
        if (ctx.measureText(t).width > n.maxW && a) { out.push(a); a = words[i]; }
        else a = t;
      }
      if (a) out.push(a);
      lines = out.slice(0, 2);
      /* still too wide after wrapping -- a single very long word -- so shrink again */
      while (size > 28 && lines.some(function (l) { return ctx.measureText(l).width > n.maxW; })) {
        size -= 2; setFont('display', size);
      }
    }

    ctx.fillStyle = COLOURS('paper');
    ctx.textAlign = n.align;
    ctx.textBaseline = 'alphabetic';
    var start = n.y - (lines.length - 1) * size * n.lh;
    lines.forEach(function (l, i) { ctx.fillText(l, n.x, start + i * size * n.lh); });
  }

  function render() {
    ctx.clearRect(0, 0, TEMPLATE.w, TEMPLATE.h);
    if (bgImg) ctx.drawImage(bgImg, 0, 0, TEMPLATE.w, TEMPLATE.h);
    else drawPlaceholder();
    drawPhotoFrame();
    drawName();
    if (dlBtn) dlBtn.disabled = false;
  }

  /* ========================================================================
     Photograph in
     ===================================================================== */
  var MAX_BYTES = 12 * 1024 * 1024;

  function takeFile(file) {
    say('');
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      say('That file is not an image. Try a JPG, PNG, HEIC or WebP.'); return;
    }
    if (file.size > MAX_BYTES) {
      say('That photo is larger than 12 MB. Try a smaller one, or a screenshot of it.'); return;
    }
    var reader = new FileReader();
    reader.onerror = function () { say('That photo could not be read. Try another one.'); };
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        if (!img.naturalWidth) { say('That photo could not be opened. Try another one.'); return; }
        photo = img; zoom = 1; offX = offY = 0;
        if (zoomIn) zoomIn.value = '1';
        root.classList.add('is-loaded');
        if (hint) hint.hidden = false;
        render();
      };
      img.onerror = function () {
        say('That photo could not be opened. If it came from an iPhone, try saving it as a JPG first.');
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  if (fileIn) fileIn.addEventListener('change', function () { takeFile(fileIn.files && fileIn.files[0]); });

  if (drop) {
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
    });
    drop.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      takeFile(f);
    });
  }

  /* ========================================================================
     Nudging the photograph
     ===================================================================== */
  if (zoomIn) zoomIn.addEventListener('input', function () { zoom = parseFloat(zoomIn.value) || 1; render(); });
  if (nameIn) nameIn.addEventListener('input', render);

  (function dragging() {
    var on = false, lx = 0, ly = 0;
    function scale() { return TEMPLATE.w / canvas.getBoundingClientRect().width; }
    function start(x, y) { if (!photo) return; on = true; lx = x; ly = y; canvas.classList.add('is-dragging'); }
    function move(x, y) {
      if (!on) return;
      var k = scale();
      offX += (x - lx) * k; offY += (y - ly) * k;
      lx = x; ly = y;
      render();
    }
    function end() { on = false; canvas.classList.remove('is-dragging'); }

    canvas.addEventListener('mousedown', function (e) { e.preventDefault(); start(e.clientX, e.clientY); });
    window.addEventListener('mousemove', function (e) { move(e.clientX, e.clientY); });
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1 || !photo) return;
      start(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    canvas.addEventListener('touchmove', function (e) {
      if (!on || e.touches.length !== 1) return;
      e.preventDefault();                       // only once a drag is actually running
      move(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    canvas.addEventListener('touchend', end);
  }());

  if (resetBt) resetBt.addEventListener('click', function () {
    zoom = 1; offX = offY = 0;
    if (zoomIn) zoomIn.value = '1';
    render();
  });

  /* ========================================================================
     Download
     ===================================================================== */
  function fileName() {
    var n = (nameIn.value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return 'nextgen-summit-' + (n || 'im-attending') + '.png';
  }

  if (dlBtn) dlBtn.addEventListener('click', function () {
    say('');
    render();
    var done = function (url, revoke) {
      var a = document.createElement('a');
      a.href = url; a.download = fileName();
      document.body.appendChild(a); a.click(); a.remove();
      if (revoke) setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      try {
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ event: 'ngs_flyer_download', named: !!(nameIn.value || '').trim(), photo: !!photo });
      } catch (e) {}
    };
    try {
      if (canvas.toBlob) canvas.toBlob(function (b) {
        if (!b) { say('The flyer could not be saved. Try again, or use a different browser.'); return; }
        done(URL.createObjectURL(b), true);
      }, 'image/png');
      else done(canvas.toDataURL('image/png'), false);
    } catch (e) {
      say('The flyer could not be saved. Try again, or use a different browser.');
    }
  });

  /* ========================================================================
     Open the studio, and go
     ===================================================================== */
  if (openBtn && studio) {
    openBtn.addEventListener('click', function () {
      studio.hidden = false;
      root.classList.add('is-open');
      openBtn.hidden = true;
      studio.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'center'
      });
      if (nameIn) setTimeout(function () { nameIn.focus({ preventScroll: true }); }, 400);
    });
  }

  /* Canvas draws with whatever font is loaded at the moment it draws, so a first paint
     before Fraunces arrives would be Georgia and would silently stay that way. Draw once
     immediately so the preview is never blank, then again when the real faces land. */
  function withFonts() {
    render();
    if (!document.fonts || fontsReady) return;
    Promise.all([
      document.fonts.load('900 104px Fraunces'),
      document.fonts.load('800 38px Montserrat')
    ]).then(function () { fontsReady = true; render(); }).catch(function () {});
  }

  if (TEMPLATE.bg) {
    var b = new Image();
    b.onload = function () { bgImg = b; withFonts(); };
    b.onerror = function () { say(''); withFonts(); };   // fall back to the placeholder
    b.src = TEMPLATE.bg;
  } else {
    withFonts();
  }
}());
