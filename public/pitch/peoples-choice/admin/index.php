<?php
/* People's Choice Award — the results dashboard.

   Behind the same PIN as /admin/: the same NGS_ADMIN_HASH and NGS_ADMIN_SALT, compared the
   same way, with the same CSRF token and the same constant-time check. No new password and no
   second secret -- this page just has its own session cookie, scoped to its own path, so a
   session here is not a session over the registrations tool.

   The live feed is this same file with ?data=1. Keeping it here rather than in /api/ is what
   lets the session cookie reach it: the cookie's path is this directory, so an unauthenticated
   request cannot carry one, and the feed answers 401. The totals are never served from
   anywhere else, and the public vote endpoint will not say a number at all.

   Every figure on this page is COUNT(*) over the vote rows, read when asked. Nothing is cached
   and nothing is incremented. */
declare(strict_types=1);

require dirname(__DIR__, 3) . '/api/pc-lib.php';

header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store');
header('X-Frame-Options: DENY');
header('Referrer-Policy: same-origin');

$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
session_name('ngs_pc_admin');
session_set_cookie_params([
    'lifetime' => 0, 'path' => '/pitch/peoples-choice/admin/',
    'secure' => $https, 'httponly' => true, 'samesite' => 'Strict',
]);
session_start();

if (empty($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(16));
}
$csrf = $_SESSION['csrf'];
$authed = !empty($_SESSION['ok']) && (int) ($_SESSION['at'] ?? 0) > time() - 8 * 3600;

function h($v): string
{
    return htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
}
function token_ok(): bool
{
    return isset($_POST['csrf']) && is_string($_POST['csrf'])
        && hash_equals((string) ($_SESSION['csrf'] ?? ''), $_POST['csrf']);
}

/* ---------- the live feed ----------
   Answered before anything is drawn, and refused outright without a session. */
if (isset($_GET['data'])) {
    header('Content-Type: application/json; charset=utf-8');
    if (!$authed) {
        http_response_code(401);
        echo json_encode(['ok' => false, 'reason' => 'auth']);
        exit;
    }
    $standings = pc_standings(pc_entrants());
    $leaders = pc_leaders($standings);
    $total = 0;
    foreach ($standings as $r) {
        $total += $r['votes'];
    }
    echo json_encode([
        'ok' => true,
        'state' => pc_state(),
        'deadline' => pc_deadline(),
        'open' => pc_voting_open(),
        'leaders' => $leaders,
        'tie' => count($leaders) > 1,
        'standings' => $standings,
        'total_valid' => $total,
        'invalidated' => pc_invalidated_count(),
        'simulated' => true,
        'updated_at' => gmdate('c'),
    ]);
    exit;
}

/* ---------- actions ---------- */
$notice = '';
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $action = is_string($_POST['action'] ?? null) ? $_POST['action'] : '';
    if (!token_ok()) {
        http_response_code(400);
        $notice = 'Your session expired. Please try again.';
    } elseif ($action === 'login') {
        /* Five wrong tries and this session stops being offered the question for fifteen
           minutes, on top of the two second pause the main tool already takes. */
        $tries = (int) ($_SESSION['tries'] ?? 0);
        $until = (int) ($_SESSION['locked'] ?? 0);
        if ($until > time()) {
            $notice = 'Too many attempts. Try again in ' . ceil(($until - time()) / 60) . ' minutes.';
        } else {
            $pw = is_string($_POST['password'] ?? null) ? $_POST['password'] : '';
            if (hash_equals(NGS_ADMIN_HASH, hash_hmac('sha256', $pw, NGS_ADMIN_SALT))) {
                session_regenerate_id(true);
                $_SESSION['ok'] = true;
                $_SESSION['at'] = time();
                $_SESSION['tries'] = 0;
                header('Location: ./', true, 303);
                exit;
            }
            $tries++;
            $_SESSION['tries'] = $tries;
            if ($tries >= 5) {
                $_SESSION['locked'] = time() + 900;
                $_SESSION['tries'] = 0;
            }
            sleep(2);
            $notice = 'That password did not match.';
        }
    } elseif ($action === 'logout') {
        $_SESSION = [];
        session_destroy();
        header('Location: ./', true, 303);
        exit;
    } elseif ($authed && $action === 'state') {
        $s = is_string($_POST['state'] ?? null) ? $_POST['state'] : '';
        if (in_array($s, PC_STATES, true)) {
            pc_set_meta('state', $s);
            $notice = 'Voting state is now "' . $s . '".';
        }
    } elseif ($authed && $action === 'deadline') {
        $d = trim((string) ($_POST['deadline'] ?? ''));
        pc_set_meta('deadline', $d);
        $notice = $d === '' ? 'Deadline cleared.' : 'Deadline set to ' . $d . '.';
    } elseif ($authed && $action === 'invalidate') {
        $k = is_string($_POST['voter'] ?? null) ? $_POST['voter'] : '';
        $on = ($_POST['to'] ?? '') === 'invalid';
        $notice = pc_invalidate($k, $on)
            ? ($on ? 'Vote invalidated. It has left the totals.' : 'Vote restored.')
            : 'No vote matched.';
    } elseif ($authed && $action === 'seed') {
        /* Test rows, so the dashboard can be shown doing its job before any real ballot
           exists. They are votes like any other -- same table, same counting -- and they go
           in the staging data directory, never beside live results. */
        $ids = array_column(pc_entrants(), 'id');
        $was = pc_state();
        pc_set_meta('state', 'open');
        $n = 0;
        $plan = [0 => 7, 1 => 5, 2 => 4, 3 => 2, 4 => 2, 5 => 1];
        foreach ($plan as $i => $count) {
            for ($j = 0; $j < $count; $j++) {
                if (pc_cast('seed:' . $i . ':' . $j . ':' . bin2hex(random_bytes(4)), $ids[$i], true)['ok']) {
                    $n++;
                }
            }
        }
        pc_set_meta('state', $was);
        $notice = $n . ' test votes added.';
    } elseif ($authed && $action === 'reset') {
        pc_reset();
        $notice = 'All People\'s Choice votes cleared from the staging store.';
    }
}

$standings = $authed ? pc_standings(pc_entrants()) : [];
$leaders = $authed ? pc_leaders($standings) : [];
$rows = $authed ? pc_rows(60) : [];
$state = pc_state();
$totalValid = 0;
foreach ($standings as $r) {
    $totalValid += $r['votes'];
}
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>People&rsquo;s Choice results &middot; NextGen Summit admin</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@144,900,100,0&amp;family=Montserrat:wght@500;600;700;800&amp;display=swap">
<link rel="stylesheet" href="/assets/css/site.css?v=20261019-01">
<link rel="stylesheet" href="/assets/css/pc-admin.css?v=20261019-01">
</head>
<body class="admbody has-pcbar">
<div class="pcbar" role="status">
  <span class="pcbar__in"><span class="pcbar__dot" aria-hidden="true"></span>
  Staging &middot; vote rows are real and counted live &middot; voter identity is still simulated</span>
</div>

<?php if (!$authed): ?>
<main class="adm">
  <div class="adm__in adm__gate">
    <p class="adm__h">People&rsquo;s Choice</p>
    <h1 class="adm__title wm">results.</h1>
    <p class="adm__p">This dashboard uses the same admin password as the registrations tool.</p>
    <?php if ($notice): ?><p class="adm__notice"><?= h($notice) ?></p><?php endif; ?>
    <form method="post" class="adm__form">
      <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
      <input type="hidden" name="action" value="login">
      <label class="adm__label" for="pw">Admin password</label>
      <input class="adm__input" id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
      <button class="adm__btn adm__btn--go" type="submit">Sign in</button>
    </form>
  </div>
</main>
<?php else: ?>
<main class="adm" data-pc-dash>
  <div class="adm__in">
    <div class="adm__head">
      <div>
        <p class="adm__h">People&rsquo;s Choice</p>
        <h1 class="adm__title wm">results.</h1>
      </div>
      <div class="adm__status">
        <span class="adm__live" data-pc-conn data-conn="live">
          <span class="adm__live-dot" aria-hidden="true"></span><span data-pc-conn-label>Live</span>
        </span>
        <p class="adm__stamp">Updated <span data-pc-updated>just now</span></p>
        <form method="post" style="margin-top:8px">
          <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
          <input type="hidden" name="action" value="logout">
          <button class="adm__btn" type="submit">Sign out</button>
        </form>
      </div>
    </div>

    <?php if ($notice): ?><p class="adm__notice"><?= h($notice) ?></p><?php endif; ?>

    <!-- ===== the leader ===== -->
    <section class="lead" data-pc-leader>
      <p class="lead__k" data-pc-leader-k>Current leader &mdash; #1</p>
      <div class="lead__body" data-pc-leader-body>
        <?php if (!$leaders): ?>
          <p class="lead__none">No valid votes yet.</p>
        <?php else: ?>
          <?php foreach ($leaders as $l): ?>
          <div class="lead__one">
            <span class="lead__shot"><?= h(substr($l['name'], -2)) ?></span>
            <div>
              <p class="lead__name"><?= h($l['name']) ?></p>
              <p class="lead__co"><?= h($l['company']) ?></p>
            </div>
            <p class="lead__votes"><?= (int) $l['votes'] ?><span>votes</span></p>
          </div>
          <?php endforeach; ?>
        <?php endif; ?>
      </div>
    </section>

    <div class="adm__cards">
      <div class="adm__stat"><p class="adm__stat-k">Valid votes</p><p class="adm__stat-v" data-pc-total><?= (int) $totalValid ?></p><p class="adm__stat-n">Counted from the rows, not a counter.</p></div>
      <div class="adm__stat"><p class="adm__stat-k">Invalidated</p><p class="adm__stat-v" data-pc-invalid><?= pc_invalidated_count() ?></p><p class="adm__stat-n">Excluded from every total above.</p></div>
      <div class="adm__stat"><p class="adm__stat-k">Voting state</p><p class="adm__stat-v adm__stat-v--sm" data-pc-state><?= h($state) ?></p><p class="adm__stat-n">Enforced on the server for every vote.</p></div>
      <div class="adm__stat"><p class="adm__stat-k">Deadline</p><p class="adm__stat-v adm__stat-v--sm" data-pc-deadline><?= h(pc_deadline() ?? 'Not set') ?></p><p class="adm__stat-n">Checked again on each submission.</p></div>
    </div>

    <!-- ===== the full field ===== -->
    <section class="adm__sec">
      <p class="adm__h">All twenty</p>
      <p class="adm__p">Ranked by valid votes. Equal counts share a rank.</p>
      <div class="adm__tablewrap">
        <table class="adm__table">
          <thead><tr><th>Rank</th><th>Contestant</th><th>Company</th><th class="num">Votes</th></tr></thead>
          <tbody data-pc-board>
            <?php foreach ($standings as $r): ?>
            <tr><td class="rk">#<?= (int) $r['rank'] ?></td><td><?= h($r['name']) ?></td><td><?= h($r['company']) ?></td><td class="num"><?= (int) $r['votes'] ?></td></tr>
            <?php endforeach; ?>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ===== controls ===== -->
    <section class="adm__sec">
      <p class="adm__h">Voting</p>
      <div class="adm__bar">
        <?php foreach (PC_STATES as $s): ?>
        <form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>">
          <input type="hidden" name="action" value="state"><input type="hidden" name="state" value="<?= h($s) ?>">
          <button class="adm__btn<?= $s === $state ? ' adm__btn--go' : '' ?>" type="submit"><?= h($s) ?></button>
        </form>
        <?php endforeach; ?>
      </div>
      <form method="post" class="adm__inline">
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
        <input type="hidden" name="action" value="deadline">
        <label class="adm__label" for="dl">Deadline (ISO 8601, blank to clear)</label>
        <input class="adm__input" id="dl" name="deadline" type="text" placeholder="2026-10-28T23:59:00-04:00" value="<?= h(pc_deadline() ?? '') ?>">
        <button class="adm__btn" type="submit">Save deadline</button>
      </form>
    </section>

    <section class="adm__sec">
      <p class="adm__h">Vote review</p>
      <p class="adm__p">Invalidating a vote removes it from the totals at the next count, which is within a few seconds. Voter keys are one-way hashes; no email address is stored.</p>
      <div class="adm__tablewrap">
        <table class="adm__table">
          <thead><tr><th>When</th><th>Voter key</th><th>For</th><th>Status</th><th></th></tr></thead>
          <tbody>
            <?php if (!$rows): ?><tr><td colspan="5">No votes recorded.</td></tr><?php endif; ?>
            <?php foreach ($rows as $v): ?>
            <tr>
              <td><?= h($v['created_at']) ?></td>
              <td class="mono"><?= h(substr((string) $v['voter_key'], 0, 22)) ?>&hellip;</td>
              <td><?= h($v['entrant_id']) ?></td>
              <td><?= ((int) $v['valid'] === 1) ? '<span class="adm__pill adm__pill--ok">Valid</span>' : '<span class="adm__pill adm__pill--hidden">Invalid</span>' ?></td>
              <td><form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>">
                <input type="hidden" name="action" value="invalidate">
                <input type="hidden" name="voter" value="<?= h($v['voter_key']) ?>">
                <input type="hidden" name="to" value="<?= ((int) $v['valid'] === 1) ? 'invalid' : 'valid' ?>">
                <button class="adm__btn<?= ((int) $v['valid'] === 1) ? ' adm__btn--warn' : '' ?>" type="submit"><?= ((int) $v['valid'] === 1) ? 'Invalidate' : 'Restore' ?></button>
              </form></td>
            </tr>
            <?php endforeach; ?>
          </tbody>
        </table>
      </div>
    </section>

    <section class="adm__sec">
      <p class="adm__h">Test data</p>
      <p class="adm__p">Staging only. These write to the staging data directory, which is a different file from the live one.</p>
      <div class="adm__bar">
        <form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>">
          <input type="hidden" name="action" value="seed">
          <button class="adm__btn" type="submit">Add test votes</button></form>
        <form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>">
          <input type="hidden" name="action" value="reset">
          <button class="adm__btn adm__btn--warn" type="submit">Clear all votes</button></form>
      </div>
    </section>

    <div class="adm__note"><b>Where this is still short of real:</b>
      <ul>
        <li>Voter identity is simulated. The rows are real and the counting is real, but a voter key comes from the page&rsquo;s mock sign-in, so one person with two addresses is two voters. Google OAuth and email OTP replace one function in <code>pc-vote.php</code>.</li>
        <li>The feed is polled every few seconds, not pushed. It is a real server read each time, never a local guess; a socket or Supabase Realtime would cut the few seconds to none.</li>
        <li>Bot protection is a crude per-address brake. A real contest wants a challenge in front of the vote endpoint.</li>
      </ul>
    </div>

    <p class="adm__p" style="margin-top:22px"><a class="linkish" href="/pitch/peoples-choice/">&larr; The public People&rsquo;s Choice page</a></p>
  </div>
</main>
<script src="/assets/js/pc-admin.js?v=20261019-01" defer></script>
<?php endif; ?>
</body>
</html>
