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

require dirname(__DIR__, 3) . '/api/pc-twilio-write.php';
require_once dirname(__DIR__, 3) . '/api/pc-mailer.php';
require_once dirname(__DIR__, 3) . '/api/pc-admin-pin.php';

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
/* A session is good for eight hours AND only for the epoch it was opened under. Rotating the
   PIN moves the epoch, so every session but the one that did the rotating stops being
   authenticated on its very next request. That is the revocation. */
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
/* A message that survives the redirect after a POST. Without this a successful save looked
   exactly like nothing happening -- the fields render blank by design, so there was no other
   signal that anything had been written. That is what "it is not updating" turned out to be. */
$notice = '';
if (!empty($_SESSION['flash'])) {
    $notice = (string) $_SESSION['flash'];
    unset($_SESSION['flash']);
}
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
            if (pc_admin_check($pw)) {
                session_regenerate_id(true);
                $_SESSION['ok'] = true;
                $_SESSION['at'] = time();
                $_SESSION['epoch'] = pc_admin_epoch();
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
    } elseif ($authed && $action === 'mode') {
        /* Changing the rule of a running competition is deliberate and logged in the notice,
           never a side effect of a deploy. */
        $m = is_string($_POST['mode'] ?? null) ? $_POST['mode'] : '';
        if (in_array($m, PC_MODES, true)) {
            pc_set_meta('mode', $m);
            $notice = $m === 'single'
                ? 'Voting rule set to the APPROVED one: one vote per voter, whole competition.'
                : 'Voting rule set to the PROPOSED daily model. This is not approved; set it back to single before anything real.';
        }
    } elseif ($authed && $action === 'allowance') {
        pc_set_meta('daily_public', (string) max(0, min(10, (int) ($_POST['daily_public'] ?? 1))));
        pc_set_meta('daily_ticket', (string) max(0, min(10, (int) ($_POST['daily_ticket'] ?? 2))));
        $notice = 'Daily allowances saved (they only apply while the daily rule is selected).';
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
    } elseif ($authed && $action === 'twilio') {
        /* The posted values go straight to the writer and are not kept, not echoed and not
           logged. $_POST is left behind when this request ends. */
        $r = pc_twilio_save([
            'account_sid' => $_POST['account_sid'] ?? '',
            'api_key' => $_POST['api_key'] ?? '',
            'api_secret' => $_POST['api_secret'] ?? '',
            'verify_sid' => $_POST['verify_sid'] ?? '',
            'allowlist' => $_POST['allowlist'] ?? null,
            'budget' => $_POST['budget'] ?? '',
        ]);
        if ($r['ok']) {
            $st = pc_twilio_status();
            $_SESSION['flash'] = 'Saved. Account SID ' . $st['account_sid']
                . ', API key ' . $st['api_key']
                . ', secret ' . $st['api_secret']
                . ', Verify SID ' . $st['verify_sid']
                . ' - ' . $st['allowlist_state'] . '.';
            header('Location: ./', true, 303);
            exit;
        }
        $notice = $r['error'];
    } elseif ($authed && $action === 'twilio_live') {
        $want = ($_POST['to'] ?? '') === '1';
        $r = pc_twilio_save(['enabled' => $want]);
        if ($r['ok']) {
            $_SESSION['flash'] = $want
                ? 'LIVE SMS IS ON. Only allowlisted numbers can receive a message, and the budget still applies.'
                : 'Live SMS is off again. Nothing can be sent.';
            header('Location: ./', true, 303);
            exit;
        }
        $notice = $r['error'];
    } elseif ($authed && $action === 'twilio_auth') {
        /* Read-only. It asks Twilio to describe the Verify Service and reports the verdict.
           Nothing is sent, no verification is started, and the live budget is not touched --
           the probe writes no row to pc_otp_log. The status and Twilio's numeric code are the
           only things that reach this screen. */
        $p = pc_twilio_auth_probe();
        $_SESSION['flash'] = 'Authentication test: HTTP ' . (int) $p['status']
            . ($p['code'] !== null ? ' (Twilio code ' . (int) $p['code'] . ')' : '')
            . ' - ' . $p['detail']
            . ' No SMS was sent and the budget is unchanged.';
        header('Location: ./', true, 303);
        exit;
    } elseif ($authed && $action === 'smtptest') {
        /* Connects, authenticates and hangs up. No message is queued and nobody receives
           anything -- the first real email should not also be the first test of the login. */
        $pr = pc_smtp_probe();
        $_SESSION['flash'] = 'SMTP check: ' . ($pr['ok'] ? 'OK' : 'FAILED at ' . $pr['step'])
            . ($pr['code'] ? ' (code ' . (int) $pr['code'] . ')' : '') . ' - ' . $pr['detail'];
        header('Location: ./', true, 303);
        exit;
    } elseif ($authed && $action === 'smtp') {
        /* The relay settings. The app password goes straight to the writer and is not kept,
           echoed or logged; a blank field keeps what is stored, so the sender address can be
           corrected without retyping it. */
        $r = pc_smtp_save([
            'host' => $_POST['smtp_host'] ?? '',
            'port' => $_POST['smtp_port'] ?? '',
            'secure' => $_POST['smtp_secure'] ?? '',
            'user' => $_POST['smtp_user'] ?? '',
            'pass' => $_POST['smtp_pass'] ?? '',
            'from' => $_POST['smtp_from'] ?? '',
            'name' => $_POST['smtp_name'] ?? '',
        ]);
        if ($r['ok']) {
            $st = pc_smtp_status();
            $_SESSION['flash'] = 'Email settings saved. Host ' . $st['host'] . ', username '
                . $st['username'] . ', password ' . $st['password'] . ', from ' . $st['from'] . '.';
            header('Location: ./', true, 303);
            exit;
        }
        $notice = $r['error'];
    } elseif ($authed && $action === 'adminpin') {
        /* The current PIN is demanded again even though this session is already authenticated:
           an unlocked phone left on a table should not be enough to change the lock.

           Neither PIN is kept, echoed or logged. They live in $_POST for the length of this
           request and are unset before it ends. */
        $cur = is_string($_POST['current_pin'] ?? null) ? $_POST['current_pin'] : '';
        $new = is_string($_POST['new_pin'] ?? null) ? $_POST['new_pin'] : '';
        $again = is_string($_POST['new_pin2'] ?? null) ? $_POST['new_pin2'] : '';
        if (!pc_admin_check($cur)) {
            sleep(2);
            $notice = 'The current PIN did not match. Nothing was changed.';
        } elseif ($new !== $again) {
            $notice = 'The two copies of the new PIN did not match. Nothing was changed.';
        } else {
            $r = pc_admin_rotate($new);
            if ($r['ok']) {
                /* Carry THIS session across its own rotation and no other: every other
                   session is still on the previous epoch and is signed out from here on. The
                   new PIN was verified against the written file before we got this far, so
                   the lock is known to open before the old key is discarded. */
                session_regenerate_id(true);
                $_SESSION['ok'] = true;
                $_SESSION['at'] = time();
                $_SESSION['epoch'] = (int) $r['epoch'];
                $_SESSION['tries'] = 0;
                $_SESSION['flash'] = 'The admin PIN has been changed, and verified before the '
                    . 'old one was retired. This session stays signed in; every other admin '
                    . 'session has been signed out. Twilio, the voting rules and the vote '
                    . 'database were not touched.';
                header('Location: ./', true, 303);
                exit;
            }
            $notice = $r['error'];
        }
        unset($cur, $new, $again);
    } elseif ($authed && $action === 'phonereq') {
        pc_set_meta('phone_required', ($_POST['to'] ?? '0') === '1' ? '1' : '0');
        $notice = (string) pc_meta('phone_required', '1') === '1'
            ? 'Phone verification is now required to vote. The simulated sign-in is closed.'
            : 'The simulated sign-in is available again.';
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
<link rel="stylesheet" href="/assets/css/site.css?v=20261022-19">
<link rel="stylesheet" href="/assets/css/pc-admin.css?v=20261022-19">
</head>
<body class="admbody has-pcbar">
<div class="pcbar" role="status">
<?php /* This banner used to assert that voter identity was simulated. It stopped being true
         the moment phone verification became the default, and a warning that states the
         opposite of what the system does is worse than no warning. It now reads the actual
         setting rather than repeating what was true when it was written. */ ?>
  <span class="pcbar__in"><span class="pcbar__dot" aria-hidden="true"></span>
  Staging &middot; vote rows are real and counted live &middot;
  <?= (string) pc_meta('phone_required', '1') === '1'
      ? 'voters must verify a phone number'
      : 'VOTER IDENTITY IS SIMULATED - the vote limit can be walked around' ?></span>
</div>

<?php if (!$authed): ?>
<main class="adm">
  <div class="adm__in adm__gate">
    <p class="adm__h">People&rsquo;s Choice</p>
    <h1 class="adm__title wm">results.</h1>
    <p class="adm__p">This dashboard uses the same admin password as the registrations tool.</p>
    <?php /* Which credential is live, and nothing about what it is. Without this a rotated
             PIN that failed to load is indistinguishable from a mistyped one, which is a
             an expensive thing not to know when the lockout is five tries. */ ?>
    <p class="adm__p" style="opacity:.75">Credential in use: <strong><?= pc_admin_rotated() ? 'rotated file (outside the web root)' : 'config.php (never rotated)' ?></strong></p>
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
      <p class="adm__h">Contestant traffic</p>
      <p class="adm__p">Visits that arrived through a contestant&rsquo;s own share link. No IP address is stored and no cookie is set: &ldquo;people&rdquo; is a same-day hash of address and browser, so it separates one person reloading from many people arriving, and stops being linkable tomorrow.</p>
      <div class="adm__tablewrap">
        <table class="adm__table">
          <thead><tr><th>Contestant</th><th class="num">Visits</th><th class="num">People (approx)</th><th class="num">Valid votes</th></tr></thead>
          <tbody>
            <?php
            $traffic = pc_traffic();
            $votesBy = [];
            foreach ($standings as $r) { $votesBy[$r['id']] = $r['votes']; }
            $any = false;
            foreach ($standings as $r):
                $t = $traffic['by_entrant'][$r['id']] ?? null;
                if (!$t) { continue; }
                $any = true; ?>
              <tr><td><?= h($r['name']) ?></td><td class="num"><?= (int) $t['visits'] ?></td>
                  <td class="num"><?= (int) $t['uniques'] ?></td>
                  <td class="num"><?= (int) ($votesBy[$r['id']] ?? 0) ?></td></tr>
            <?php endforeach; ?>
            <?php if (!$any): ?><tr><td colspan="4">No share-link visits recorded yet.</td></tr><?php endif; ?>
          </tbody>
        </table>
      </div>
      <?php if (!empty($traffic['by_source'])): ?>
      <p class="adm__p" style="margin-top:14px">Where they came from:
        <?php foreach ($traffic['by_source'] as $sRow): ?>
          <span class="adm__pill adm__pill--hidden"><?= h($sRow['source']) ?> <?= (int) $sRow['n'] ?></span>
        <?php endforeach; ?>
      </p>
      <?php endif; ?>
    </section>

    <section class="adm__sec">
      <p class="adm__h">Voting rule</p>
      <p class="adm__p"><strong>Approved:</strong> one vote per voter for the whole competition. <strong>Proposed, not approved:</strong> a daily allowance, larger for a verified ticket holder. The proposed rule is selectable here so it can be seen working; it is not the default and a deploy cannot make it one.</p>
      <div class="adm__bar">
        <?php foreach (PC_MODES as $m): ?>
        <form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>">
          <input type="hidden" name="action" value="mode"><input type="hidden" name="mode" value="<?= h($m) ?>">
          <button class="adm__btn<?= $m === pc_mode() ? ' adm__btn--go' : '' ?>" type="submit"><?= $m === 'single' ? 'Single (approved)' : 'Daily (proposed)' ?></button>
        </form>
        <?php endforeach; ?>
      </div>
      <form method="post" class="adm__inline">
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
        <input type="hidden" name="action" value="allowance">
        <label class="adm__label" for="dp">Daily votes &mdash; general public</label>
        <input class="adm__input" id="dp" name="daily_public" type="number" min="0" max="10" value="<?= h(pc_meta('daily_public', '1')) ?>">
        <label class="adm__label" for="dt">Daily votes &mdash; verified ticket holder</label>
        <input class="adm__input" id="dt" name="daily_ticket" type="number" min="0" max="10" value="<?= h(pc_meta('daily_ticket', '2')) ?>">
        <button class="adm__btn" type="submit">Save allowances</button>
      </form>
      <p class="adm__p" style="margin-top:12px">Current rule: <strong><?= h(pc_mode()) ?></strong> &middot; public <?= pc_allowance(false) ?> &middot; ticket holder <?= pc_allowance(true) ?><?= pc_next_window() ? ' &middot; refills ' . h(pc_next_window()) : '' ?></p>
    </section>

    <section class="adm__sec">
      <p class="adm__h">Email delivery (verification codes)</p>
      <p class="adm__p"><strong>All four of host, username, app password and From address must be filled.</strong> If any one is blank, email verification stays switched off. The relay that sends voting codes. Use a <strong>Google Workspace app password</strong>, not an account password &mdash; it is scoped to this site and can be revoked on its own. Written to <code>config.smtp.php</code> in the data directory, outside the web root, and never shown back.</p>
      <?php $sm = pc_smtp_status(); ?>
      <div class="adm__table-wrap">
        <table class="adm__table"><tbody>
          <?php foreach ($sm as $k => $v): ?>
            <tr><th><?= h(str_replace('_', ' ', $k)) ?></th><td><?= h(is_bool($v) ? ($v ? 'yes' : 'no') : (string) $v) ?></td></tr>
          <?php endforeach; ?>
        </tbody></table>
      </div>
      <form method="post" class="adm__inline" autocomplete="off">
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
        <input type="hidden" name="action" value="smtp">
        <label class="adm__label" for="sh">SMTP host</label>
        <input class="adm__input" id="sh" name="smtp_host" type="text" placeholder="smtp.gmail.com" value="<?= h($sm['host'] === 'not set' ? '' : $sm['host']) ?>">
        <label class="adm__label" for="sp">Port</label>
        <input class="adm__input" id="sp" name="smtp_port" type="number" min="1" max="65535" value="<?= (int) $sm['port'] ?>">
        <label class="adm__label" for="se">Encryption</label>
        <input class="adm__input" id="se" name="smtp_secure" type="text" placeholder="tls" value="<?= h($sm['encryption']) ?>">
        <label class="adm__label" for="su">SMTP username (full mailbox address)</label>
        <input class="adm__input" id="su" name="smtp_user" type="text" autocomplete="off" placeholder="you@nextgensummit.us" value="<?= h($sm['username'] === 'NOT SET' ? '' : $sm['username']) ?>">
        <label class="adm__label" for="sw">App password</label>
        <input class="adm__input" id="sw" name="smtp_pass" type="password" autocomplete="new-password" placeholder="<?= $sm['password'] === 'NOT SET' ? '16 characters from Google' : 'saved — leave blank to keep' ?>">
        <label class="adm__label" for="sf">From address</label>
        <input class="adm__input" id="sf" name="smtp_from" type="text" placeholder="vote@nextgensummit.us" value="<?= h($sm['from'] === 'NOT SET' ? '' : $sm['from']) ?>">
        <label class="adm__label" for="sn">From name</label>
        <input class="adm__input" id="sn" name="smtp_name" type="text" value="<?= h($sm['from_name']) ?>">
        <button class="adm__btn adm__btn--go" type="submit">Save email settings</button>
      </form>
      <div class="adm__bar">
        <form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>">
          <input type="hidden" name="action" value="smtptest">
          <button class="adm__btn" type="submit">Test the connection (sends nothing)</button>
        </form>
      </div>
    </section>

    <section class="adm__sec">
      <p class="adm__h">Change the admin PIN</p>
      <p class="adm__p">Over HTTPS, straight to the server. The PIN is never shown back, never written to a file in readable form and never logged &mdash; only a salted HMAC of it is stored, in the data directory <strong>outside the web root</strong>, so a deploy cannot undo the change. <code>config.php</code> is not opened for writing, so <code>NGS_SECRET</code>, the voter identities derived from it, the database key and the Twilio credentials are not merely preserved &mdash; they are never touched.</p>
      <p class="adm__p">The new PIN is verified against what was actually written <em>before</em> the old one stops working. You stay signed in here; every other admin session is signed out.</p>
      <p class="adm__p"><strong>Status:</strong> <?= h(pc_admin_rotation_note()) ?></p>
      <form method="post" class="adm__inline" autocomplete="off">
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
        <input type="hidden" name="action" value="adminpin">
        <label class="adm__label" for="p0">Current PIN</label>
        <input class="adm__input" id="p0" name="current_pin" type="password" autocomplete="current-password" required>
        <label class="adm__label" for="p1">New PIN (at least 8 characters)</label>
        <input class="adm__input" id="p1" name="new_pin" type="password" autocomplete="new-password" minlength="8" required>
        <label class="adm__label" for="p2">New PIN again</label>
        <input class="adm__input" id="p2" name="new_pin2" type="password" autocomplete="new-password" minlength="8" required>
        <button class="adm__btn adm__btn--go" type="submit">Change the PIN</button>
      </form>
    </section>

    <section class="adm__sec">
      <p class="adm__h">Twilio configuration</p>
      <p class="adm__p">A health check, not a viewer. It reports whether each credential is present and whether it starts with the prefix Twilio uses for that kind of identifier. <strong>No value is read, printed or logged anywhere</strong> &mdash; not here, not in the error log.</p>
      <div class="adm__tablewrap">
        <table class="adm__table">
          <thead><tr><th>Check</th><th>Result</th></tr></thead>
          <tbody>
            <?php foreach (pc_twilio_status() as $k => $v):
              $txt = is_bool($v) ? ($v ? 'yes' : 'no') : (string) $v;
              $good = $txt === 'yes' || $txt === 'ok' || $txt === 'present'
                   || strpos($txt, 'MOCK') === 0 || $txt === 'false'; ?>
            <tr><td><?= h(str_replace('_', ' ', (string) $k)) ?></td>
                <td><span class="adm__pill <?= $good ? 'adm__pill--ok' : 'adm__pill--draft' ?>"><?= h($txt) ?></span></td></tr>
            <?php endforeach; ?>
          </tbody>
        </table>
      </div>
      <?php $tw = pc_twilio_status(); ?>
      <div class="adm__sec" style="margin-top:22px">
        <p class="adm__h">Test authentication</p>
        <p class="adm__p">The table above checks the <em>shape</em> of each credential, which a convincing fake also passes. This asks Twilio instead, with a <strong>read-only</strong> request for the Verify Service. It sends no message, starts no verification, bills nothing and <strong>does not touch the budget</strong> &mdash; worth doing first, because a live send spends a budget slot even when the credentials are wrong.</p>
        <p class="adm__p"><strong>401</strong> means the credentials are wrong. <strong>403</strong> means they are <em>valid</em> but this restricted key may not read Verify Services &mdash; a permission limit, not a bad credential. <strong>404</strong> means they are valid but the Verify SID is not on this account.</p>
        <div class="adm__bar">
          <form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>">
            <input type="hidden" name="action" value="twilio_auth">
            <button class="adm__btn" type="submit">Test Twilio authentication</button>
          </form>
        </div>
      </div>
      <div class="adm__sec" style="margin-top:22px">
        <p class="adm__h">Enter or update the credentials</p>
        <p class="adm__p">These are written to <code>nextgen-data-staging/config.twilio.php</code>, outside the web root, where a deploy cannot reach them. <strong>Leave a box empty to keep what is already saved.</strong> Nothing is ever shown back to this screen, so the boxes always start blank &mdash; that is deliberate, not a bug.</p>
        <form method="post" class="adm__inline" autocomplete="off">
          <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
          <input type="hidden" name="action" value="twilio">
          <label class="adm__label" for="t1">Account SID (begins AC)</label>
          <input class="adm__input" id="t1" name="account_sid" type="password" autocomplete="new-password" placeholder="<?= $tw['account_sid'] === 'ok' ? 'saved — leave blank to keep' : 'AC...' ?>">
          <label class="adm__label" for="t2">API Key SID (begins SK)</label>
          <input class="adm__input" id="t2" name="api_key" type="password" autocomplete="new-password" placeholder="<?= $tw['api_key'] === 'ok' ? 'saved — leave blank to keep' : 'SK...' ?>">
          <label class="adm__label" for="t3">API Key Secret</label>
          <input class="adm__input" id="t3" name="api_secret" type="password" autocomplete="new-password" placeholder="<?= $tw['api_secret'] === 'present' ? 'saved — leave blank to keep' : 'the secret shown once at key creation' ?>">
          <label class="adm__label" for="t4">Verify Service SID (begins VA)</label>
          <input class="adm__input" id="t4" name="verify_sid" type="password" autocomplete="new-password" placeholder="<?= $tw['verify_sid'] === 'ok' ? 'saved — leave blank to keep' : 'VA...' ?>">
          <label class="adm__label" for="t5">Test numbers allowed to receive a real SMS (one per line)</label>
          <textarea class="adm__input" id="t5" name="allowlist" rows="3" placeholder="+14105550143"><?= h(implode("
", pc_sms_allowlist())) ?></textarea>
          <label class="adm__label" for="t6">Hard ceiling on real sends, ever</label>
          <input class="adm__input" id="t6" name="budget" type="number" min="0" max="50" value="<?= (int) $tw['live_budget'] ?>">
          <button class="adm__btn adm__btn--go" type="submit">Save settings</button>
        </form>
      </div>

      <div class="adm__sec" style="margin-top:22px">
        <p class="adm__h">Live SMS</p>
        <?php if (pc_twilio_live()): ?>
          <p class="adm__warn"><b>Live</b> Real messages can be sent, to allowlisted numbers only, up to the remaining budget of <?= (int) $tw['live_budget_left'] ?>.</p>
        <?php else: ?>
          <p class="adm__p">Currently off. Nothing can be sent.</p>
        <?php endif; ?>
        <div class="adm__bar">
          <form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>">
            <input type="hidden" name="action" value="twilio_live">
            <input type="hidden" name="to" value="<?= pc_twilio_live() ? '0' : '1' ?>">
            <button class="adm__btn <?= pc_twilio_live() ? 'adm__btn--warn' : 'adm__btn--go' ?>" type="submit">
              <?= pc_twilio_live() ? 'Turn live SMS off' : 'Turn live SMS on' ?></button>
          </form>
        </div>
      </div>

      <p class="adm__p" style="margin-top:12px">While the mode reads <strong>MOCK</strong> no SMS is sent and nothing is billed. Switching to live is a one-word edit to <code>config.twilio.php</code> on the server, deliberately not something this page can do.</p>
      <p class="adm__p">Phone verification required to vote: <strong><?= (string) pc_meta('phone_required', '1') === '1' ? 'yes' : 'no (the preview&rsquo;s simulated sign-in still works)' ?></strong></p>
      <div class="adm__bar">
        <form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>">
          <input type="hidden" name="action" value="phonereq"><input type="hidden" name="to" value="<?= (string) pc_meta('phone_required', '1') === '1' ? '0' : '1' ?>">
          <button class="adm__btn" type="submit"><?= (string) pc_meta('phone_required', '1') === '1' ? 'Allow the simulated sign-in again' : 'Require phone verification' ?></button>
        </form>
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
<script src="/assets/js/pc-admin.js?v=20261022-19" defer></script>
<?php endif; ?>
</body>
</html>
