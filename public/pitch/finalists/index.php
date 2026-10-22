<?php
/* The Top 10 Pitch Finalists.

   A page of its own, deliberately. People's Choice is a voting system over twenty
   semifinalists; this introduces the ten who pitch live and lets people watch them. The two
   are related by rule, not by identity, so nothing here casts a vote, counts one, or links a
   card to one. If that relationship is ever confirmed, it belongs in a decision, not in an
   assumption made by this file.

   Everything on the page is drawn from ngs_finalists(), so confirming a finalist is one edit
   in api/finalists.php and nothing here changes. All ten slots render from the first day, so
   the layout never reflows as names arrive, and an unconfirmed slot says plainly that it is a
   placeholder rather than borrowing a stock face and a made-up company.

   The cards reuse the speaker deck's visual language (.card) and the collectible dialog's
   (.sp) rather than inventing a second one. What is new here is the back of the card: a pitch
   video instead of a list of achievements. */
declare(strict_types=1);

require dirname(__DIR__, 2) . '/api/finalists.php';

$finalists = ngs_finalists();
$confirmed = ngs_finalists_confirmed();
$stamp = '20261022-01';

function fe($v): string
{
    return htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
}

header('Content-Type: text/html; charset=utf-8');
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Top 10 Pitch Finalists &middot; NextGen Summit</title>
<meta name="description" content="The ten founders pitching live at NextGen Summit on October 30. Meet the finalists and watch their pitches.">
<meta name="theme-color" content="#06161A">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<script>(function(d){d.classList.add('js');setTimeout(function(){if(!d.classList.contains('js-ready'))d.classList.remove('js')},4000)})(document.documentElement)</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@144,900,100,0&amp;family=Montserrat:wght@500;600;700;800&amp;display=swap">
<link rel="stylesheet" href="/assets/css/site.css?v=<?= $stamp ?>">
<link rel="stylesheet" href="/assets/css/finalists.css?v=<?= $stamp ?>">
<script src="/assets/js/site.js?v=<?= $stamp ?>" defer></script>
<script src="/assets/js/finalists.js?v=<?= $stamp ?>" defer></script>
</head>
<body>

<a class="skip" href="#fin-title">Skip to content</a>
<div class="grain" aria-hidden="true"></div>

<header class="nav at-hero on-photo">
  <a class="nav__mark" href="/" aria-label="NextGen Summit, home">
    <span class="wm" aria-hidden="true">nextgen</span><span class="nav__summit" aria-hidden="true">Summit</span>
  </a>
  <div class="count" data-until="2026-10-30T00:00:00-04:00">
    <p class="sr" data-count-sr>NextGen Summit is on October 30.</p>
    <p class="count__row" aria-hidden="true">
      <span class="count__u"><span class="count__n" data-count="days">--</span><span class="count__l">d<span class="count__word">ays</span></span></span>
      <span class="count__u count__u--hms"><span class="count__n" data-count="hours">--</span><span class="count__l">h</span></span>
      <span class="count__u count__u--hms"><span class="count__n" data-count="minutes">--</span><span class="count__l">m</span></span>
      <span class="count__u count__u--hms"><span class="count__n" data-count="seconds">--</span><span class="count__l">s</span></span>
      <span class="count__to">to NextGen</span>
    </p>
  </div>
  <nav class="nav__links" aria-label="Utilities">
    <a class="nav__link" href="/about/">About</a>
    <a class="nav__link" href="/">The Summit</a>
    <a class="nav__link" href="/pitch/">Pitch Competition</a>
    <span class="nav__link is-here" aria-current="page">Finalists</span>
    <a class="btn btn--sm" href="/tickets/">Get tickets</a>
  </nav>
</header>

<main>
  <section class="fin" data-nav="photo" aria-labelledby="fin-title">
    <div class="fin__head">
      <p class="fin__eyebrow">Pitch Competition</p>
      <h1 class="fin__title wm" id="fin-title">the top ten.</h1>
      <p class="fin__lede">Ten founders, twenty-nine and under, pitching live on the NextGen stage on
        October&nbsp;30 for a share of a $10,000 prize pool. Open a card to watch the pitch.</p>

      <?php if ($confirmed < 10): ?>
        <p class="fin__status" role="status">
          <span class="fin__dot" aria-hidden="true"></span>
          <strong><?= (int) $confirmed ?> of 10</strong> finalists confirmed.
          The remaining <?= 10 - (int) $confirmed ?> are placeholders and will be filled in as the line-up is announced.
        </p>
      <?php endif; ?>
    </div>

    <ul class="fin__deck" data-fin-deck>
      <?php foreach ($finalists as $f): ?>
        <li class="card fin__slot<?= $f['confirmed'] ? '' : ' is-placeholder' ?>">
          <?php if ($f['confirmed']): ?>
            <button class="card__face" type="button" data-fin="<?= fe($f['id']) ?>" aria-haspopup="dialog">
              <span class="card__stock">
                <span class="card__shot">
                  <img src="<?= fe(NGS_FINALIST_IMG . $f['shot']) ?>-620.jpg?v=<?= $stamp ?>"
                    srcset="<?= fe(NGS_FINALIST_IMG . $f['shot']) ?>-620.jpg?v=<?= $stamp ?> 620w, <?= fe(NGS_FINALIST_IMG . $f['shot']) ?>-900.jpg?v=<?= $stamp ?> 900w"
                    sizes="(max-width:760px) 44vw, (max-width:1100px) 30vw, 306px"
                    width="620" height="868" loading="lazy" decoding="async"
                    alt="<?= fe($f['name']) ?>">
                </span>
                <span class="card__wm wm" aria-hidden="true">nextgen</span>
                <span class="card__id">
                  <span class="card__name"><?= fe($f['first']) ?><b><?= fe($f['last']) ?></b></span>
                  <span class="card__kind"><?= fe($f['venture']) ?></span>
                  <span class="card__line" aria-hidden="true"></span>
                </span>
              </span>
            </button>
          <?php else: ?>
            <div class="card__face fin__ph" aria-label="Finalist <?= fe($f['n']) ?>, to be announced">
              <span class="card__stock">
                <span class="card__shot fin__phshot" aria-hidden="true">
                  <span class="fin__phnum"><?= fe($f['n']) ?></span>
                </span>
                <span class="card__wm wm" aria-hidden="true">nextgen</span>
                <span class="card__id">
                  <span class="card__name">Finalist<b><?= fe($f['n']) ?></b></span>
                  <span class="card__kind">To be announced</span>
                  <span class="card__line" aria-hidden="true"></span>
                </span>
              </span>
              <span class="fin__badge">Placeholder</span>
            </div>
          <?php endif; ?>
        </li>
      <?php endforeach; ?>
    </ul>

    <p class="fin__foot">These ten pitch live at the Summit. The People&rsquo;s Choice Award is a
      separate vote &mdash; see the <a class="linkish" href="/pitch/">Pitch Competition</a> page for how the two fit together.</p>

    <dialog class="sp fin__dlg" id="finalist" aria-label="Finalist">
      <button class="sp__close" type="button" data-fin-close aria-label="Close">
        <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M2 2l14 14M16 2L2 16" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>
      </button>
      <div class="sp__in">
        <div class="sp__flip" data-fin-flip>
          <div class="sp__front" data-fin-front></div>
          <div class="sp__back" data-fin-back aria-hidden="true"></div>
        </div>
      </div>
    </dialog>
  </section>
</main>

<footer class="foot">
  <nav class="foot__nav" aria-label="Footer">
    <ul>
      <li><a href="/">The Summit</a></li>
      <li><a href="/pitch/">Pitch Competition</a></li>
      <li><a class="foot__mail" href="mailto:hello@nextgensummit.us">hello@nextgensummit.us</a></li>
    </ul>
  </nav>
  <p class="foot__note">NextGen Summit 2026</p>
</footer>

<script id="fin-data" type="application/json"><?= json_encode(
    $finalists,
    JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
) ?></script>
</body>
</html>
