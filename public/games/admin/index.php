<?php
/* NextGen Games — the control room.
 *
 * Four controls, which are the four the brief asks for: open or close new submissions, see
 * how many people are playing and how many have locked a portfolio in, see the aggregate
 * NG$ behind each founder, and decide whether anybody else may see that last one.
 *
 * Behind the same PIN as the other dashboards -- pc_admin_check(), the same constant-time
 * comparison, the same CSRF token, the same eight-hour session bound to the PIN's epoch, so
 * rotating the PIN signs every other session out on its next request. Its own session name
 * and its own cookie path, so a session here is not a session over the vote dashboard and
 * cannot become one.
 *
 * It is a separate page rather than a tab added to the People's Choice dashboard on purpose:
 * that dashboard is the instrument somebody is using TODAY to certify a competition result,
 * and a game shipped the same morning has no business sharing a file with it.
 *
 * The aggregate totals are the thing to be careful with. They are computed here, server
 * side, and the public endpoint refuses to say them until `reveal` is on. Nothing on this
 * page is merely hidden with CSS.
 */
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/api/ng-games-lib.php';
require_once dirname(__DIR__, 2) . '/api/pc-admin-pin.php';

header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store');
header('X-Frame-Options: DENY');
header('Referrer-Policy: same-origin');

$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
session_name('ngs_games_admin');
session_set_cookie_params([
    'lifetime' => 0, 'path' => '/games/admin/',
    'secure' => $https, 'httponly' => true, 'samesite' => 'Strict',
]);
session_start();

if (empty($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(16));
}
$csrf = $_SESSION['csrf'];
$authed = !empty($_SESSION['ok'])
    && (int) ($_SESSION['at'] ?? 0) > time() - 8 * 3600
    && (int) ($_SESSION['epoch'] ?? 0) === pc_admin_epoch();

function h($v): string
{
    return htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
}
function token_ok(): bool
{
    return isset($_POST['csrf']) && is_string($_POST['csrf'])
        && hash_equals((string) ($_SESSION['csrf'] ?? ''), $_POST['csrf']);
}
function money(int $n): string
{
    return 'NG$' . number_format($n);
}

$notice = '';
$preview = false;

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    if (!$authed) {
        /* signing in */
        $pw = (string) ($_POST['pw'] ?? '');
        /* A wrong PIN should cost a moment, so guessing is slow and a person notices nothing. */
        usleep(random_int(120000, 260000));
        if (token_ok() && $pw !== '' && pc_admin_check($pw)) {
            session_regenerate_id(true);
            $_SESSION['ok'] = true;
            $_SESSION['at'] = time();
            $_SESSION['epoch'] = pc_admin_epoch();
            $_SESSION['csrf'] = bin2hex(random_bytes(16));
            header('Location: ' . $_SERVER['REQUEST_URI']);
            exit;
        }
        $notice = 'That PIN was not accepted.';
    } elseif (token_ok()) {
        $do = (string) ($_POST['do'] ?? '');
        if ($do === 'open') {
            ngg_set('open', '1');
            $notice = 'Submissions are open. Players can lock in a portfolio.';
        } elseif ($do === 'close') {
            ngg_set('open', '0');
            $notice = 'Submissions are closed. Anyone who already submitted can still see their own portfolio.';
        } elseif ($do === 'reveal') {
            ngg_set('reveal', '1');
            $notice = 'Totals are now public. Every player can see what the room backed.';
        } elseif ($do === 'hide') {
            ngg_set('reveal', '0');
            $notice = 'Totals are hidden again.';
        } elseif ($do === 'purge-demo') {
            /* Two clicks, not one: the first POST shows exactly what would go, the second
               carries the confirm field and does it. The rows are written to a file before
               the DELETE and nothing is removed if that file cannot be written and read back. */
            if (($_POST['confirm'] ?? '') === 'yes') {
                $r = ngg_purge_demo();
                if ($r['ok']) {
                    $rm = $r['removed'];
                    $notice = sprintf('Demo records removed: %d portfolio(s), %d draft(s), %d player(s).%s',
                        $rm['portfolios'], $rm['drafts'], $rm['players'],
                        $r['backup'] !== '' ? ' Backed up first to ' . $r['backup'] . ' in the data directory.' : '');
                } else {
                    $notice = 'Nothing was removed: ' . ($r['reason'] === 'backup_write'
                        ? 'the backup file could not be written.'
                        : ($r['reason'] === 'backup_verify' ? 'the backup did not read back correctly.'
                        : 'the delete failed and was rolled back.'));
                }
            } else {
                $preview = true;
            }
        } elseif ($do === 'signout') {
            $_SESSION = [];
            session_destroy();
            header('Location: ' . strtok((string) $_SERVER['REQUEST_URI'], '?'));
            exit;
        }
    } else {
        $notice = 'That form had gone stale. Nothing was changed; try again.';
    }
}

$open = ngg_open();
$revealed = ngg_revealed();
$demo = $authed ? ngg_demo_rows() : ['players' => [], 'portfolios' => [], 'drafts' => 0];
$demoN = count($demo['players']) + count($demo['portfolios']) + $demo['drafts'];
$totals = $authed ? ngg_totals() : ['players' => 0, 'submitted' => 0, 'invested' => 0];
$rows = $authed ? ngg_standings() : [];
$top = $rows ? max(array_column($rows, 'ngd')) : 0;
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>NextGen Games &middot; Control</title>
<style>
  :root { color-scheme: dark; --bg:#101417; --card:#171C20; --line:rgba(255,255,255,.14);
          --ink:#F2F5F7; --dim:#949EA6; --go:#2DD4A7; --stop:#F0746B; --brand:#C59A66; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); padding:22px 16px 64px;
         font:500 15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width: 760px; margin: 0 auto; }
  h1 { margin:0; font-size:21px; letter-spacing:-.01em; }
  .sub { margin:4px 0 22px; color:var(--dim); font-size:13px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px;
          padding:18px; margin:0 0 14px; }
  .card h2 { margin:0 0 4px; font-size:12px; letter-spacing:.16em; text-transform:uppercase;
             color:var(--brand); font-weight:700; }
  .note { background:rgba(45,212,167,.1); border:1px solid rgba(45,212,167,.35);
          border-radius:11px; padding:11px 13px; margin:0 0 16px; font-size:14px; }
  .pill { display:inline-block; padding:4px 11px; border-radius:999px; font-size:12px;
          font-weight:700; letter-spacing:.06em; text-transform:uppercase; }
  .on  { background:rgba(45,212,167,.16); color:var(--go); }
  .off { background:rgba(240,116,107,.16); color:var(--stop); }
  button { font:inherit; font-weight:700; cursor:pointer; border-radius:10px; padding:11px 17px;
           border:1px solid var(--line); background:#21272C; color:var(--ink); }
  button.go { background:var(--go); color:#06231B; border-color:transparent; }
  button.stop { background:var(--stop); color:#2B0D0A; border-color:transparent; }
  .row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:12px; }
  .nums { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:12px; }
  .num { background:#10151A; border:1px solid var(--line); border-radius:11px; padding:13px; }
  .num b { display:block; font-size:25px; letter-spacing:-.02em; }
  .num span { font-size:11px; color:var(--dim); letter-spacing:.11em; text-transform:uppercase; }
  table { width:100%; border-collapse:collapse; margin-top:10px; font-size:14px; }
  th, td { text-align:left; padding:9px 6px; border-bottom:1px solid rgba(255,255,255,.07); }
  th { font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:var(--dim); }
  td.n { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .bar { height:5px; border-radius:3px; background:var(--brand); min-width:2px; margin-top:5px; }
  input[type=password] { font:inherit; padding:12px 14px; border-radius:10px; width:100%;
          background:#10151A; border:1px solid var(--line); color:var(--ink); }
  .warn { color:var(--dim); font-size:12.5px; margin-top:10px; line-height:1.65; }
  a { color:var(--brand); }
  code { font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: var(--ink-2, #ccc); }
</style>
</head>
<body>
<div class="wrap">

<h1>NextGen Games &middot; Control</h1>
<p class="sub">Back the Next &mdash; The NG$10,000 Founder Challenge. NG$ is fictional: nothing here
   is money, a pledge, or a People&rsquo;s Choice vote.</p>

<?php if ($notice !== ''): ?><p class="note"><?= h($notice) ?></p><?php endif; ?>

<?php if (!$authed): ?>

  <form class="card" method="post" autocomplete="off">
    <h2>Sign in</h2>
    <p class="sub" style="margin:6px 0 12px">The same PIN as the other NextGen dashboards.</p>
    <input type="password" name="pw" autocomplete="current-password" autofocus
           inputmode="numeric" aria-label="Admin PIN">
    <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
    <div class="row"><button class="go" type="submit">Open the controls</button></div>
  </form>

<?php else: ?>

  <p class="note" style="background:rgba(197,154,102,.1);border-color:rgba(197,154,102,.35)">Store ready: every game table exists and the database is answering.</p>

  <div class="card">
    <h2>Submissions</h2>
    <p style="margin:6px 0 0">
      <span class="pill <?= $open ? 'on' : 'off' ?>"><?= $open ? 'Open' : 'Closed' ?></span>
      <?= $open
          ? 'Players can lock in a portfolio.'
          : 'No new portfolios. Anyone who already submitted still sees their own.' ?>
    </p>
    <form method="post" class="row">
      <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
      <?php if ($open): ?>
        <button class="stop" name="do" value="close" type="submit">Close submissions</button>
      <?php else: ?>
        <button class="go" name="do" value="open" type="submit">Open submissions</button>
      <?php endif; ?>
    </form>
  </div>

  <div class="card">
    <h2>Who is playing</h2>
    <div class="nums">
      <div class="num"><b><?= number_format($totals['players']) ?></b><span>Players</span></div>
      <div class="num"><b><?= number_format($totals['submitted']) ?></b><span>Submitted</span></div>
      <div class="num"><b><?= money($totals['invested']) ?></b><span>Backed in total</span></div>
    </div>
    <p class="warn">A player is one verified email address. That is not the same as one
      person &mdash; somebody with two addresses is two players, and this page does not
      pretend otherwise.</p>
  </div>

  <div class="card">
    <h2>Behind each founder</h2>
    <p style="margin:6px 0 0">
      <span class="pill <?= $revealed ? 'on' : 'off' ?>"><?= $revealed ? 'Public' : 'Hidden' ?></span>
      <?= $revealed
          ? 'Every player can see these totals.'
          : 'Only this page can see these totals. The public endpoint refuses to say them.' ?>
    </p>
    <form method="post" class="row">
      <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
      <?php if ($revealed): ?>
        <button class="stop" name="do" value="hide" type="submit">Hide the totals again</button>
      <?php else: ?>
        <button class="go" name="do" value="reveal" type="submit">Reveal to everyone</button>
      <?php endif; ?>
    </form>

    <table>
      <thead><tr><th>Founder</th><th class="n">Backers</th><th class="n">NG$</th></tr></thead>
      <tbody>
      <?php foreach ($rows as $r): ?>
        <tr>
          <td><?= h($r['name']) ?><br>
              <span style="color:var(--dim);font-size:12px"><?= h($r['company']) ?></span>
              <?php if ($top > 0): ?>
                <div class="bar" style="width:<?= (int) round($r['ngd'] / $top * 100) ?>%"></div>
              <?php endif; ?></td>
          <td class="n"><?= number_format($r['backers']) ?></td>
          <td class="n"><?= money($r['ngd']) ?></td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
    <p class="warn">Ordered by NG$ backed. This is a game, not the People&rsquo;s Choice
      result, and it decides nothing about the competition.</p>
  </div>

  <div class="card">
    <h2>Demo records</h2>
    <?php if ($demoN === 0): ?>
      <p style="margin:6px 0 0">None. Every player in the store signed in with an email code.</p>
    <?php else: ?>
      <p style="margin:6px 0 0"><b><?= count($demo['portfolios']) ?></b> demo portfolio(s),
        <b><?= $demo['drafts'] ?></b> draft(s) and <b><?= count($demo['players']) ?></b> demo
        player(s) from testing on the review site. A demo row is one whose identity begins
        <code>demo:</code> <i>and</i> is flagged <code>demo = 1</code>; nothing written through
        an email code can match that.</p>
      <?php if ($preview): ?>
        <table>
          <thead><tr><th>Portfolio</th><th class="n">Backed</th><th class="n">NG$</th><th>When (UTC)</th></tr></thead>
          <tbody>
          <?php foreach ($demo['portfolios'] as $r): ?>
            <tr><td><code><?= h(substr((string) $r['ident'], 0, 14)) ?>&hellip;</code></td>
                <td class="n"><?= (int) $r['backed'] ?></td>
                <td class="n"><?= money((int) $r['invested']) ?></td>
                <td><?= h($r['created_at']) ?></td></tr>
          <?php endforeach; ?>
          </tbody>
        </table>
        <p class="warn">These rows, the <?= $demo['drafts'] ?> draft(s) and the
          <?= count($demo['players']) ?> player row(s) will be written to a backup file beside
          the database first. Nothing else in the store is touched.</p>
        <form method="post" class="row">
          <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
          <input type="hidden" name="confirm" value="yes">
          <button class="stop" name="do" value="purge-demo" type="submit">Yes, remove them</button>
          <a href="<?= h(strtok((string) $_SERVER['REQUEST_URI'], '?')) ?>"><button type="button">Keep them</button></a>
        </form>
      <?php else: ?>
        <form method="post" class="row">
          <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
          <button name="do" value="purge-demo" type="submit">Show what would be removed</button>
        </form>
      <?php endif; ?>
    <?php endif; ?>
  </div>

  <form method="post" class="row">
    <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
    <button name="do" value="signout" type="submit">Sign out</button>
  </form>

<?php endif; ?>

<p class="warn" style="margin-top:26px">
  <?= h(pc_admin_rotation_note()) ?>
</p>

</div>
</body>
</html>
