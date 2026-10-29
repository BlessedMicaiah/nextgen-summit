/* NextGen Summit — the "I'm attending" avatar generator.

   Somebody uploads a photograph, types their name, and gets back the approved NextGen Air
   boarding pass with their face in the frame and their name under PASSENGER. Two sizes:
   Instagram Post (1080x1350) and Instagram Story (1080x1920).

   WHAT THIS IS NOT

   Nothing here is generated. The ticket is the designer's own Canva artwork, exported at
   full size with the example photograph and the example passenger name deleted from the
   source rather than painted over -- so there is no face underneath anyone's. The only
   things this file draws are: the uploaded photograph, cropped and positioned; the
   gradient ring that belongs to the photo frame; and the name. The photograph itself is
   never filtered, retouched or redrawn -- only scaled, moved and clipped to the frame.

   WHERE THE NUMBERS COME FROM

   Every coordinate below was read out of the Canva source (its element geometry is in page
   units, and the export is 1:1 with the page) and then checked against the exported
   pixels. Specifically:

     - the frame rectangles and the 55px corner rounding match the shape element;
     - the ring is 5px drawn INSIDE the path, not centred on it, which is how Canva renders
       it -- hence the half-weight inset when stroking;
     - the ring gradient runs left to right across the frame, #5170ff to #ff66c4. Canva
       calls that "rotation 90"; the pixels say horizontal, and the pixels win;
     - the name sits on a baseline 0.898 of the font size below the top of its text box.
       Canva's box includes leading, so its top is not the cap line.

   The name is Poppins 600. That was not guessed: Canva reports the weight as semibold, and
   at the design size Poppins 600 measures 325.6px of ink for the example name against the
   artwork's 323px, with an identical 31px cap height. Montserrat -- which the site already
   loads -- is 17% too wide, so it would have been visibly wrong next to the N001 seat
   number, which is set in the same face.

   NOTHING LEAVES THE DEVICE

   FileReader to canvas to toBlob. There is no endpoint, no upload and no account. The
   photograph and the name exist in the tab and nowhere else.

   REPLACING THE ARTWORK

   If the design is revised, re-export the two pages with the photo and name elements
   deleted, drop them in at assets/img/avatar/, and correct the numbers in FORMATS. No
   other part of this file needs to change.
   ======================================================================================= */
(function () {
  'use strict';

  var root = document.querySelector('[data-avatar]');
  if (!root) return;

  /* ========================================================================
     The approved artwork, measured
     ===================================================================== */
  var RING = { weight: 5, from: '#5170ff', to: '#ff66c4' };

  var FORMATS = {
    post: {
      id: 'post',
      label: 'Instagram Post',
      note: '1080 × 1350',
      w: 1080, h: 1350,
      plate: '/assets/img/avatar/ticket-post.webp',
      /* the photo frame: a rounded rectangle with a gradient ring drawn inside its edge */
      photo: { x: 254.258, y: 487.665, w: 385.951, h: 364.225, r: 55 },
      /* the passenger name: box origin, the baseline below it, and how wide it may run
         before the SEAT chip at x=660 */
      name: { x: 274.540, top: 898.901, size: 43.549, min: 18, maxW: 368 }
    },
    story: {
      id: 'story',
      label: 'Instagram Story',
      note: '1080 × 1920',
      w: 1080, h: 1920,
      plate: '/assets/img/avatar/ticket-story.webp',
      photo: { x: 180.055, y: 720.813, w: 486.177, h: 458.810, r: 55 },
      name: { x: 205.604, top: 1240.786, size: 54.858, min: 22, maxW: 466 }
    }
  };

  var BASELINE = 0.898;          /* of the font size, below the text box top */
  var TRACK = -0.0200195;        /* em, from the Canva text formatting */
  var NAME_FONT = '600 %spx Poppins, Montserrat, system-ui, sans-serif';
  var POPPINS = 'https://fonts.googleapis.com/css2?family=Poppins:wght@600&display=swap';

  /* ========================================================================
     The furniture
     ===================================================================== */
  var canvas = root.querySelector('[data-avatar-canvas]');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');

  var nameIn = root.querySelector('[data-avatar-name]');
  var fileIn = root.querySelector('[data-avatar-file]');
  var drop = root.querySelector('[data-avatar-drop]');
  var zoomIn = root.querySelector('[data-avatar-zoom]');
  var resetBt = root.querySelector('[data-avatar-reset]');
  var errEl = root.querySelector('[data-avatar-error]');
  var hint = root.querySelector('[data-avatar-hint]');
  var studio = root.querySelector('[data-avatar-studio]');
  var openBtn = root.querySelector('[data-avatar-open]');
  var shareBt = root.querySelector('[data-avatar-share]');
  var tabs = [].slice.call(root.querySelectorAll('[data-avatar-format]'));
  var dlBtns = [].slice.call(root.querySelectorAll('[data-avatar-download]'));

  var fmt = FORMATS.post;
  var plates = {};               /* id -> Image, once loaded */
  var photo = null;
  var zoom = 1;
  var offX = 0, offY = 0;        /* as a fraction of the frame, so a crop set on one
                                    format lands identically on the other */
  var fontsReady = false;

  function say(msg) {
    if (!errEl) return;
    errEl.textContent = msg || '';
    errEl.hidden = !msg;
  }

  /* ========================================================================
     Drawing
     ===================================================================== */

  /* Canvas has no letter-spacing everywhere yet, so the name is set a glyph at a time.
     At -0.02em on capitals the kerning this gives up is not visible. */
  function trackedWidth(text, size) {
    var t = TRACK * size, w = 0, i;
    for (i = 0; i < text.length; i++) w += ctx.measureText(text[i]).width + t;
    return w - (text.length ? t : 0);
  }

  function drawTracked(text, x, y, size) {
    var t = TRACK * size, i;
    for (i = 0; i < text.length; i++) {
      ctx.fillText(text[i], x, y);
      x += ctx.measureText(text[i]).width + t;
    }
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  /* How the photograph is laid into the frame: cover it, then apply the viewer's zoom and
     nudge. Offsets are fractions of the frame, which is why the same crop works in both
     sizes -- the two frames have the same proportions. */
  function photoBox(f) {
    var p = f.photo;
    var cover = Math.max(p.w / photo.naturalWidth, p.h / photo.naturalHeight);
    var dw = photo.naturalWidth * cover * zoom;
    var dh = photo.naturalHeight * cover * zoom;
    var slackX = Math.max(0, (dw - p.w) / 2);
    var slackY = Math.max(0, (dh - p.h) / 2);
    var dx = p.x + (p.w - dw) / 2 + Math.max(-slackX, Math.min(slackX, offX * p.w));
    var dy = p.y + (p.h - dh) / 2 + Math.max(-slackY, Math.min(slackY, offY * p.h));
    return { x: dx, y: dy, w: dw, h: dh };
  }

  function drawPhoto(f) {
    var p = f.photo;
    ctx.save();
    roundRect(p.x, p.y, p.w, p.h, p.r);
    ctx.clip();
    if (photo) {
      var b = photoBox(f);
      ctx.drawImage(photo, b.x, b.y, b.w, b.h);
    } else {
      /* before a photograph is chosen, dim the ticket behind the frame and label it, so it
         reads as a slot rather than as a bit of the design */
      ctx.fillStyle = 'rgba(12,12,16,.62)';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.font = '600 ' + Math.round(p.w * 0.058) + 'px Poppins, Montserrat, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,.78)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('YOUR PHOTO', p.x + p.w / 2, p.y + p.h / 2);
    }
    ctx.restore();

    /* the ring. Canva draws it inside the path, so the stroke is inset by half its weight
       and the radius comes in to match. */
    var t = RING.weight;
    var g = ctx.createLinearGradient(p.x, 0, p.x + p.w, 0);
    g.addColorStop(0, RING.from);
    g.addColorStop(1, RING.to);
    ctx.strokeStyle = g;
    ctx.lineWidth = t;
    roundRect(p.x + t / 2, p.y + t / 2, p.w - t, p.h - t, p.r - t / 2);
    ctx.stroke();
  }

  /* One line, always. The ticket has a dashed rule below the name, so a second line would
     collide with it -- the name shrinks instead, and the baseline never moves. */
  function drawName(f) {
    var n = f.name;
    var text = ((nameIn && nameIn.value) || '').trim().toUpperCase() || 'YOUR NAME';
    var size = n.size;
    ctx.font = NAME_FONT.replace('%s', size);
    while (size > n.min && trackedWidth(text, size) > n.maxW) {
      size -= 0.5;
      ctx.font = NAME_FONT.replace('%s', size);
    }
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    drawTracked(text, n.x, n.top + BASELINE * n.size, size);
  }

  function render() {
    var f = fmt;
    /* Both formats are 1080 wide, so the height has to be part of this test -- checking the
       width alone leaves the canvas at the Post height and silently crops the Story. */
    if (canvas.width !== f.w || canvas.height !== f.h) {
      canvas.width = f.w;
      canvas.height = f.h;
    }
    ctx.clearRect(0, 0, f.w, f.h);
    var plate = plates[f.id];
    if (plate) ctx.drawImage(plate, 0, 0, f.w, f.h);
    else { ctx.fillStyle = '#0B0B0F'; ctx.fillRect(0, 0, f.w, f.h); }
    drawPhoto(f);
    drawName(f);
    root.classList.toggle('is-ready', !!plate);
    dlBtns.forEach(function (b) { b.disabled = !plate; });
    if (shareBt) shareBt.disabled = !plate;
  }

  /* ========================================================================
     Loading what the drawing needs
     ===================================================================== */
  function loadPlate(f) {
    if (plates[f.id]) return Promise.resolve(plates[f.id]);
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { plates[f.id] = img; resolve(img); };
      img.onerror = function () {
        say('The ticket artwork could not be loaded. Check your connection and try again.');
        resolve(null);
      };
      img.src = f.plate;
    });
  }

  /* The name must not be drawn in a fallback face and then silently left that way, so the
     canvas is redrawn once Poppins has actually arrived. */
  function loadFont() {
    if (fontsReady) return Promise.resolve();
    if (!document.querySelector('link[data-avatar-font]')) {
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = POPPINS;
      l.setAttribute('data-avatar-font', '');
      document.head.appendChild(l);
    }
    if (!document.fonts || !document.fonts.load) { fontsReady = true; return Promise.resolve(); }
    return document.fonts.load('600 44px Poppins', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')
      .then(function () { fontsReady = true; })
      .catch(function () { fontsReady = true; });
  }

  function prepare(f) {
    return Promise.all([loadPlate(f), loadFont()]).then(function () { render(); });
  }

  /* ========================================================================
     The photograph
     ===================================================================== */
  var MAX_BYTES = 12 * 1024 * 1024;

  function takeFile(file) {
    say('');
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      say('That file is not an image. Try a JPG, PNG, HEIC or WebP.');
      return;
    }
    if (file.size > MAX_BYTES) {
      say('That photo is larger than 12 MB. Try a smaller one, or a screenshot of it.');
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () { say('That photo could not be read. Try another one.'); };
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        if (!img.naturalWidth) { say('That photo could not be opened. Try another one.'); return; }
        photo = img;
        zoom = 1; offX = offY = 0;
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

  if (fileIn) {
    fileIn.addEventListener('change', function () { takeFile(fileIn.files && fileIn.files[0]); });
  }
  if (drop) {
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
    });
    drop.addEventListener('drop', function (e) {
      takeFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
    });
  }

  /* ========================================================================
     Moving it about
     ===================================================================== */
  if (zoomIn) {
    zoomIn.addEventListener('input', function () {
      zoom = parseFloat(zoomIn.value) || 1;
      render();
    });
  }
  if (nameIn) nameIn.addEventListener('input', render);
  if (resetBt) {
    resetBt.addEventListener('click', function () {
      zoom = 1; offX = offY = 0;
      if (zoomIn) zoomIn.value = '1';
      render();
    });
  }

  (function dragging() {
    var on = false, lx = 0, ly = 0;
    function scale() { return fmt.w / (canvas.getBoundingClientRect().width || fmt.w); }
    canvas.addEventListener('pointerdown', function (e) {
      if (!photo) return;
      on = true; lx = e.clientX; ly = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('is-dragging');
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!on) return;
      var s = scale();
      offX += ((e.clientX - lx) * s) / fmt.photo.w;
      offY += ((e.clientY - ly) * s) / fmt.photo.h;
      lx = e.clientX; ly = e.clientY;
      render();
    });
    ['pointerup', 'pointercancel'].forEach(function (ev) {
      canvas.addEventListener(ev, function () { on = false; canvas.classList.remove('is-dragging'); });
    });
  }());

  /* ========================================================================
     Post or Story
     ===================================================================== */
  function pick(id) {
    if (!FORMATS[id] || fmt.id === id) return;
    fmt = FORMATS[id];
    tabs.forEach(function (t) {
      var mine = t.getAttribute('data-avatar-format') === id;
      t.classList.toggle('is-on', mine);
      t.setAttribute('aria-selected', mine ? 'true' : 'false');
    });
    root.setAttribute('data-shape', id);
    render();                       /* immediately, with whatever is loaded */
    prepare(fmt);                   /* then again once this plate is in */
  }
  tabs.forEach(function (t) {
    t.addEventListener('click', function () { pick(t.getAttribute('data-avatar-format')); });
  });

  /* ========================================================================
     Out
     ===================================================================== */
  function fileName(f) {
    var n = ((nameIn && nameIn.value) || '').trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return 'nextgen-summit-avatar-' + (n || 'im-attending') + '-' + f.id + '.png';
  }

  /* Both sizes are rendered from the same code path as the preview, so what is downloaded
     is what was on screen. The off-screen one is drawn by switching the canvas to it,
     taking the blob, and switching back. */
  function renderTo(f) {
    var was = fmt;
    fmt = f;
    render();
    return new Promise(function (resolve) {
      canvas.toBlob(function (b) {
        fmt = was;
        render();
        resolve(b);
      }, 'image/png');
    });
  }

  function give(f) {
    say('');
    return prepare(f).then(function () {
      if (!plates[f.id]) return null;
      return renderTo(f);
    }).then(function (blob) {
      if (!blob) { say('The avatar could not be saved. Try again, or use a different browser.'); return null; }
      var a = document.createElement('a');
      var url = URL.createObjectURL(blob);
      a.href = url;
      a.download = fileName(f);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      if (window.dataLayer) {
        window.dataLayer.push({
          event: 'ngs_avatar_download', format: f.id,
          named: !!((nameIn && nameIn.value) || '').trim(), photo: !!photo
        });
      }
      return blob;
    }).catch(function () {
      say('The avatar could not be saved. Try again, or use a different browser.');
      return null;
    });
  }

  dlBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      give(FORMATS[b.getAttribute('data-avatar-download')] || fmt);
    });
  });

  /* Sharing straight to an app, where the browser offers it. Phones that cannot do this
     keep the download buttons, which is every case the brief needs. */
  if (shareBt) {
    var canShareFiles = !!(navigator.canShare && navigator.share);
    if (!canShareFiles) shareBt.hidden = true;
    else {
      shareBt.addEventListener('click', function () {
        var f = fmt;
        prepare(f).then(function () { return renderTo(f); }).then(function (blob) {
          if (!blob) return;
          var file = new File([blob], fileName(f), { type: 'image/png' });
          if (!navigator.canShare({ files: [file] })) {
            say('This browser cannot share the image directly. Use Download instead.');
            return;
          }
          return navigator.share({ files: [file], title: 'I’m attending NextGen Summit' });
        }).catch(function () { /* the viewer dismissed the sheet; nothing to report */ });
      });
    }
  }

  /* ========================================================================
     Opening
     ===================================================================== */
  function open() {
    if (studio) studio.hidden = false;
    if (openBtn) openBtn.hidden = true;
    prepare(fmt);
  }

  /* Arriving straight at #avatar scrolls past the headline before site.js's reveal
     observer has seen it, which leaves it sitting at opacity 0 above the studio. Anything
     in this section that has not been revealed yet is simply shown. */
  function reveal() {
    [].forEach.call(root.querySelectorAll('.rv'), function (n) {
      n.classList.add('in', 'settled');
    });
  }
  if (openBtn) openBtn.addEventListener('click', open);

  /* Arriving from the Summit page's promotional section, which links here. */
  if (window.location.hash === '#avatar' || window.location.hash === '#avatar-open') {
    open();
    reveal();
    requestAnimationFrame(function () {
      root.scrollIntoView({ block: 'start', behavior: 'auto' });
    });
  }
}());
