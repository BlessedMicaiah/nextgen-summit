<?php
/* The Top 10 Pitch Finalists.

   A page of its own, deliberately. People's Choice is a voting system over twenty
   semifinalists and remains the Pitch Competition's main destination while voting runs; this
   introduces the ten who pitch live and lets people watch them. Nothing here casts a vote,
   counts one, or reads a leaderboard -- including for the tenth slot, which the People's
   Choice winner takes only once the result is certified by a person.

   PRIVATE UNTIL SAID OTHERWISE. The page sits behind a preview gate (api/finalists-gate.php),
   not merely off the navigation, because what is on it is the identity of founders who have
   not been announced. In front of the gate the cards are anonymous placeholders and the
   details are not in the markup at all.

   Everything is drawn from ngs_finalists(), so confirming a finalist is one edit in
   api/finalists.php and nothing here changes. The cards reuse the speaker deck's visual
   language (.card) and the collectible dialog's (.sp); what is new is the back of the card. */
declare(strict_types=1);

require dirname(__DIR__, 2) . '/api/finalists.php';
require dirname(__DIR__, 2) . '/api/finalists-gate.php';

$gateNotice = ngs_fin_gate_post();
$allowed = ngs_fin_allowed();
$all = ngs_finalists();
$finalists = ngs_fin_visible($all, $allowed);
$confirmed = ngs_finalists_confirmed();
$stamp = '20261022-01';

function fe($v): string
{
    return htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
}

header('Content-Type: text/html; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow, noarchive');
header('Cache-Control: no-store');
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>The Final 10 &middot; NextGen Summit</title>
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#06161A">
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
<?php if ($allowed || NGS_FINALISTS_PUBLIC): ?>
<script src="/assets/js/finalists.js?v=<?= $stamp ?>" defer></script>
<?php endif; ?>
</head>
<body>

<?php if (!$allowed && !NGS_FINALISTS_PUBLIC): ?>
  <?php /* The gate. No finalist data has been loaded into this page at all -- there is nothing
           in the markup to read, so this is a closed door rather than a blurred window. */ ?>
  <main class="fgate">
    <div class="fgate__in">
      <p class="fgate__eyebrow">NextGen Summit</p>
      <h1 class="fgate__title wm">the final 10.</h1>
      <p class="fgate__p">This page is in preview. The finalists are not announced yet, so it is
        behind the same password as the staging dashboard.</p>
      <?php if ($gateNotice): ?><p class="fgate__notice"><?= fe($gateNotice) ?></p><?php endif; ?>
      <form method="post" class="fgate__form">
        <input type="hidden" name="csrf" value="<?= fe(ngs_fin_csrf()) ?>">
        <input type="hidden" name="action" value="preview">
        <label class="fgate__label" for="pw">Preview password</label>
        <input class="fgate__input" id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
        <button class="fgate__btn" type="submit">View the preview</button>
      </form>
    </div>
  </main>
<?php else: ?>

<a class="skip" href="#fin-title">Skip to content</a>
<div class="grain" aria-hidden="true"></div>

<?php if (!NGS_FINALISTS_PUBLIC): ?>
  <div class="pcbar" role="status">
    <span class="pcbar__in"><span class="pcbar__dot" aria-hidden="true"></span>
    Private preview &middot; finalists are not announced &middot; do not share this page or screenshots of it</span>
  </div>
<?php endif; ?>

<header class="nav at-hero on-photo">
  <a class="nav__mark" href="/" aria-label="NextGen Summit, home">
    <span class="wm" aria-hidden="true">nextgen</span><span class="nav__summit" aria-hidden="true">Summit</span>
  </a>
  <nav class="nav__links" aria-label="Utilities">
    <a class="nav__link" href="/">The Summit</a>
    <a class="nav__link" href="/pitch/">Pitch Competition</a>
    <a class="btn btn--sm" href="/tickets/">Get tickets</a>
  </nav>
</header>

<main>
  <section class="fin" data-nav="photo" aria-labelledby="fin-title">
    <div class="fin__head">
      <p class="fin__eyebrow">Pitch Competition &middot; October 30, 2026 &middot; Maryland</p>
      <h1 class="fin__title wm" id="fin-title">the final 10.</h1>
      <p class="fin__lede">Ten founders. Ten bold ideas. One stage.</p>
      <p class="fin__sub">Nine are selected by the judging panel and one by the public vote. On
        the night they pitch live to an executive panel and the NextGen audience, with final
        scores combining the judges and the room, for a share of a $10,000 prize pool.</p>
      <p class="fin__cta"><a class="btn" href="/tickets/">Get tickets for October 30</a></p>

      <?php if ($confirmed < 10): ?>
        <p class="fin__status" role="status">
          <span class="fin__dot" aria-hidden="true"></span>
          <strong><?= (int) $confirmed ?> of 10</strong> finalists entered.
          The rest are placeholders and will be filled in as the line-up is confirmed.
        </p>
      <?php endif; ?>
    </div>

    <ul class="fin__deck" data-fin-deck>
      <?php foreach ($finalists as $f): ?>
        <li class="card fin__slot<?= $f['confirmed'] ? '' : ' is-placeholder' ?>">
          <?php if ($f['confirmed']): ?>
            <button class="card__face" type="button" data-fin="<?= fe($f['id']) ?>" aria-haspopup="dialog">
              <span class="card__stock">
                <?php if ($f['shot'] !== ''): ?>
                  <span class="card__shot">
                    <img src="<?= fe(NGS_FINALIST_IMG . $f['shot']) ?>-620.jpg?v=<?= $stamp ?>"
                      srcset="<?= fe(NGS_FINALIST_IMG . $f['shot']) ?>-620.jpg?v=<?= $stamp ?> 620w, <?= fe(NGS_FINALIST_IMG . $f['shot']) ?>-900.jpg?v=<?= $stamp ?> 900w"
                      sizes="(max-width:760px) 44vw, (max-width:1100px) 30vw, 306px"
                      width="620" height="868" loading="lazy" decoding="async"
                      alt="<?= fe($f['name']) ?>">
                  </span>
                <?php else: ?>
                  <span class="card__shot fin__phshot" aria-hidden="true">
                    <span class="fin__phnum"><?= fe($f['n']) ?></span>
                  </span>
                <?php endif; ?>
                <span class="card__wm wm" aria-hidden="true">nextgen</span>
                <span class="fin__tag">Top 10 Finalist</span>
                <span class="card__id">
                  <span class="card__name"><?= fe($f['first']) ?><b><?= fe($f['last']) ?></b></span>
                  <span class="card__kind"><?= fe($f['venture']) ?></span>
                  <span class="card__line" aria-hidden="true"></span>
                  <span class="fin__flip">Flip for more</span>
                </span>
              </span>
              <?php if ($f['status'] === 'internal'): ?>
                <span class="fin__badge fin__badge--int">Internal</span>
              <?php endif; ?>
            </button>
          <?php else: ?>
            <div class="card__face fin__ph" aria-label="Finalist <?= fe($f['n']) ?><?= $f['reserved'] !== '' ? ', reserved for the ' . fe($f['reserved']) : '' ?>, to be announced">
              <span class="card__stock">
                <span class="card__shot fin__phshot" aria-hidden="true">
                  <span class="fin__phnum"><?= fe($f['n']) ?></span>
                </span>
                <span class="card__wm wm" aria-hidden="true">nextgen</span>
                <span class="card__id">
                  <span class="card__name">Finalist<b><?= fe($f['n']) ?></b></span>
                  <span class="card__kind"><?= $f['reserved'] !== '' ? fe($f['reserved']) : 'To be announced' ?></span>
                  <span class="card__line" aria-hidden="true"></span>
                </span>
              </span>
              <span class="fin__badge"><?= $f['reserved'] !== '' ? 'Reserved' : 'Placeholder' ?></span>
            </div>
          <?php endif; ?>
        </li>
      <?php endforeach; ?>
    </ul>

    <p class="fin__foot">The People&rsquo;s Choice Award is a separate vote, open until
      <strong>October 28, 11:59 PM ET</strong> &mdash; its winner takes the tenth place here.
      <a class="linkish" href="/pitch/peoples-choice/">Go and vote</a>.</p>

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
      <li><a href="/tickets/">Tickets</a></li>
      <li><a class="foot__mail" href="mailto:hello@nextgensummit.us">hello@nextgensummit.us</a></li>
    </ul>
  </nav>
  <p class="foot__note">NextGen Summit 2026</p>
</footer>

<script id="fin-data" type="application/json"><?= json_encode(
    $finalists,
    JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
) ?></script>
<?php endif; ?>
</body>
</html>
