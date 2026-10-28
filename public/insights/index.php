<?php
/* ============================================================================
   NEXTGEN DATA — the leadership dashboard.

   This file does three things and no more: it authenticates, it handles the handful of
   POSTs that change settings, and it draws an empty shell. Every number on the screen
   arrives from report.php, which is in this same folder so the session cookie -- whose
   path is /insights/ -- can reach it. Nothing outside /insights/ can carry that cookie.

   It reads the live voting database and cannot write to it. See api/ngd-lib.php.
   ========================================================================= */

declare(strict_types=1);

require_once dirname(__DIR__) . '/api/ngd-auth.php';

ngd_headers(false);
ngd_session_begin();

$notice = '';
$problem = '';

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $action = is_string($_POST['action'] ?? null) ? $_POST['action'] : '';
    if (!ngd_csrf_ok(is_string($_POST['csrf'] ?? null) ? $_POST['csrf'] : null)) {
        http_response_code(400);
        $problem = 'That form had gone stale. Please try again.';
    } elseif ($action === 'login') {
        $r = ngd_login(
            is_string($_POST['username'] ?? null) ? $_POST['username'] : '',
            is_string($_POST['password'] ?? null) ? $_POST['password'] : ''
        );
        if ($r['ok']) {
            header('Location: /insights/', true, 303);
            exit;
        }
        $problem = (string) $r['why'];
    } elseif ($action === 'logout') {
        ngd_logout();
        header('Location: /insights/', true, 303);
        exit;
    } else {
        /* Everything below changes settings, so it needs a signed-in owner. */
        $who = ngd_user();
        if ($who === null) {
            http_response_code(401);
            $problem = 'Sign in first.';
        } elseif ($who['role'] !== 'owner') {
            http_response_code(403);
            $problem = 'Only the owner can change settings.';
        } elseif ($action === 'account_add') {
            $r = ngd_user_save(
                is_string($_POST['u'] ?? null) ? $_POST['u'] : '',
                is_string($_POST['p'] ?? null) ? $_POST['p'] : '',
                is_string($_POST['n'] ?? null) ? $_POST['n'] : ''
            );
            $r['ok'] ? $notice = 'That leadership account is ready. Only its password hash was stored.'
                     : $problem = (string) $r['why'];
        } elseif ($action === 'account_suspend' || $action === 'account_restore') {
            $u = is_string($_POST['u'] ?? null) ? $_POST['u'] : '';
            ngd_user_set_active($u, $action === 'account_restore')
                ? $notice = 'Account updated. Any open session on it stops working on its next request.'
                : $problem = 'That account could not be updated.';
        } elseif ($action === 'account_remove') {
            $u = is_string($_POST['u'] ?? null) ? $_POST['u'] : '';
            ngd_user_remove($u) ? $notice = 'Account removed.' : $problem = 'That account could not be removed.';
        } elseif ($action === 'flag') {
            $name = is_string($_POST['name'] ?? null) ? $_POST['name'] : '';
            $on = ($_POST['on'] ?? '') === '1';
            if (ngd_flag_set($name, $on)) {
                $notice = $name === 'collect'
                    ? ($on ? 'Website event collection is ON for this site from now. Nothing before this moment was recorded.'
                           : 'Website event collection is OFF. Events already gathered are kept.')
                    : ($on ? 'The dashboard is on.' : 'The dashboard is off for everyone, including you, until you turn it back on here.');
            } else {
                $problem = 'That setting could not be saved.';
            }
        }
    }
}

$me = ngd_user();
$csrf = ngd_csrf();

function hh($v): string
{
    return htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
}

$stamp = '20261028-s05';
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<title>NextGen Data<?= $me ? ' — Leadership analytics' : '' ?></title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@144,900,100,0&amp;family=Montserrat:wght@500;600;700;800&amp;display=swap">
<link rel="stylesheet" href="/assets/css/ngd.css?v=<?= hh($stamp) ?>">
</head>
<body class="ngd<?= $me ? '' : ' ngd--gate' ?>">

<?php if ($me === null): ?>
<!-- ---------------------------------------------------------------------------
     The gate. Nothing about the competition is on this page: no totals, no founder
     names, no hint of what is behind it. The route being obscure is not the security;
     this form is.
     ------------------------------------------------------------------------ -->
<main class="gate">
  <div class="gate__card">
    <p class="gate__eyebrow">NextGen Summit 2026</p>
    <h1 class="gate__title">NextGen<span>Data</span></h1>
    <p class="gate__sub">Private leadership analytics. Authorised access only.</p>

    <?php if ($problem !== ''): ?>
      <p class="gate__err" role="alert"><?= hh($problem) ?></p>
    <?php endif; ?>

    <form method="post" class="gate__form" autocomplete="on">
      <input type="hidden" name="csrf" value="<?= hh($csrf) ?>">
      <input type="hidden" name="action" value="login">
      <label class="fld">
        <span>Username</span>
        <input name="username" type="text" autocomplete="username" autocapitalize="off"
               spellcheck="false" placeholder="leave blank for the owner PIN">
      </label>
      <label class="fld">
        <span>Password</span>
        <input name="password" type="password" autocomplete="current-password" required autofocus>
      </label>
      <button class="btn btn--go" type="submit">Sign in</button>
    </form>

    <p class="gate__note">
      <?php if (ngd_owner_pin_available()): ?>
        The owner signs in with the existing admin PIN and no username. Leadership accounts
        are created from inside the dashboard.
      <?php else: ?>
        No credential is configured on this server, so nothing can sign in. That is deliberate:
        there is no default password.
      <?php endif; ?>
    </p>
  </div>
</main>

<?php else:
$flags = ngd_flags(true);
$users = ngd_users(true);
$isOwner = $me['role'] === 'owner';
$dashOn = ngd_flag('dashboard');
?>
<!-- ---------------------------------------------------------------------------
     The dashboard. Markup only; every figure is filled by ngd.js from report.php.
     ------------------------------------------------------------------------ -->
<a class="skip" href="#main">Skip to the report</a>

<header class="top">
  <div class="top__in">
    <div class="top__brand">
      <span class="top__mark">NextGen<b>Data</b></span>
      <span class="top__tag">People&rsquo;s Choice Award 2026</span>
    </div>

    <div class="top__right">
      <div class="src" data-ngd-health>
        <span class="src__dot" data-ngd-dot></span>
        <span class="src__text">
          <b data-ngd-src>Reading the live competition</b>
          <i data-ngd-fresh>checking&hellip;</i>
        </span>
      </div>
      <button class="btn btn--ghost" type="button" data-ngd-refresh>Refresh</button>
      <form method="post" class="top__out">
        <input type="hidden" name="csrf" value="<?= hh($csrf) ?>">
        <input type="hidden" name="action" value="logout">
        <span class="top__who"><?= hh($me['name']) ?></span>
        <button class="btn btn--ghost" type="submit">Sign out</button>
      </form>
    </div>
  </div>

  <nav class="tabs" aria-label="Sections">
    <button class="tab" type="button" data-ngd-tab="overview" aria-current="true">Overview</button>
    <button class="tab" type="button" data-ngd-tab="voting">Voting</button>
    <button class="tab" type="button" data-ngd-tab="founders">Founders</button>
    <button class="tab" type="button" data-ngd-tab="traffic">Traffic</button>
    <button class="tab" type="button" data-ngd-tab="conversions">Conversions</button>
    <button class="tab" type="button" data-ngd-tab="insights">Insights</button>
    <button class="tab" type="button" data-ngd-tab="exports">Exports</button>
    <?php if ($isOwner): ?>
      <button class="tab" type="button" data-ngd-tab="settings">Settings</button>
    <?php endif; ?>
  </nav>
</header>

<?php if ($notice !== ''): ?><p class="flash flash--ok" role="status"><?= hh($notice) ?></p><?php endif; ?>
<?php if ($problem !== ''): ?><p class="flash flash--bad" role="alert"><?= hh($problem) ?></p><?php endif; ?>

<?php if (!$dashOn): ?>
<main class="wrap">
  <div class="card card--warn">
    <h2>The dashboard is switched off</h2>
    <p>Someone turned the reporting pages off, which is the emergency switch for taking all
       analytics load off the server. Voting and ticketing are unaffected either way &mdash;
       nothing in those paths reads this system.</p>
    <?php if ($isOwner): ?>
      <form method="post" class="row">
        <input type="hidden" name="csrf" value="<?= hh($csrf) ?>">
        <input type="hidden" name="action" value="flag">
        <input type="hidden" name="name" value="dashboard">
        <input type="hidden" name="on" value="1">
        <button class="btn btn--go" type="submit">Turn the dashboard back on</button>
      </form>
    <?php endif; ?>
  </div>
</main>
<?php else: ?>

<main class="wrap" id="main">

  <!-- the period control, shared by every panel -->
  <section class="bar">
    <div class="bar__group" role="group" aria-label="Reporting period">
      <button class="chip" type="button" data-ngd-period="all" aria-pressed="true">All time &mdash; since voting launched</button>
      <button class="chip" type="button" data-ngd-period="today">Today</button>
      <button class="chip" type="button" data-ngd-period="yesterday">Yesterday</button>
      <button class="chip" type="button" data-ngd-period="24h">Last 24h vs previous</button>
      <button class="chip" type="button" data-ngd-period="48h">Last 48h</button>
      <button class="chip" type="button" data-ngd-period="custom">Custom&hellip;</button>
    </div>
    <div class="bar__dates" data-ngd-custom hidden>
      <label class="fld fld--sm"><span>From</span><input type="date" data-ngd-from></label>
      <label class="fld fld--sm"><span>To</span><input type="date" data-ngd-to></label>
      <button class="btn btn--go btn--sm" type="button" data-ngd-apply>Apply</button>
    </div>
    <p class="bar__read" data-ngd-period-label>All time, since voting launched</p>
  </section>

  <div class="alerts" data-ngd-alerts></div>

  <!-- OVERVIEW ------------------------------------------------------------ -->
  <section class="panel" data-ngd-panel="overview">
    <div class="kpis" data-ngd-kpis></div>

    <div class="grid grid--2">
      <div class="card">
        <h2 class="card__h">Unique voters since launch</h2>
        <p class="card__p">Distinct people, cumulatively. The lighter bars are people voting for
           the first time that day; the line is everyone who has ever voted.</p>
        <div class="chart" data-ngd-chart="voters"></div>
      </div>
      <div class="card">
        <h2 class="card__h">Cumulative points since launch</h2>
        <p class="card__p">Every point, in the order it was cast, by the Eastern hour.</p>
        <div class="chart" data-ngd-chart="cumulative"></div>
      </div>
      <div class="card">
        <div class="card__head">
          <div>
            <h2 class="card__h">Current standings</h2>
            <p class="card__p">Ranking stays on points, which is the competition rule.
               This chart can show either.</p>
          </div>
          <div class="bar__group" role="group" aria-label="Show founders by">
            <button class="chip" type="button" data-ngd-metric="people" aria-pressed="true">Unique voters</button>
            <button class="chip" type="button" data-ngd-metric="points" aria-pressed="false">Points</button>
          </div>
        </div>
        <div class="bars" data-ngd-bars="overview"></div>
      </div>
    </div>

    <div class="grid grid--2">
      <div class="card">
        <h2 class="card__h">Points a day</h2>
        <p class="card__p">Standard points and the registration bonus, stacked.</p>
        <div class="chart" data-ngd-chart="daily"></div>
      </div>
      <div class="card">
        <h2 class="card__h">Where the points come from</h2>
        <div class="splits" data-ngd-splits></div>
      </div>
    </div>
  </section>

  <!-- VOTING -------------------------------------------------------------- -->
  <section class="panel" data-ngd-panel="voting" hidden>
    <div class="grid grid--2">
      <div class="card">
        <h2 class="card__h">Daily voting activity</h2>
        <div class="chart" data-ngd-chart="daily2"></div>
      </div>
      <div class="card">
        <h2 class="card__h">Hourly pattern, all days</h2>
        <p class="card__p">Which Eastern hours carry the voting. This is where a send-time decision comes from.</p>
        <div class="chart" data-ngd-chart="hourly"></div>
      </div>
    </div>

    <div class="card">
      <h2 class="card__h">Activity heatmap</h2>
      <p class="card__p">Day down the side, Eastern hour across. Darker is busier.</p>
      <div class="heat" data-ngd-heat></div>
    </div>

    <div class="card">
      <h2 class="card__h">Day by day</h2>
      <div class="tablewrap"><table class="tbl" data-ngd-table="daily"></table></div>
    </div>

    <div class="card">
      <h2 class="card__h">Rank movement</h2>
      <p class="card__p">Day-end standings rebuilt from each vote&rsquo;s own timestamp. No ranking was
         stored at the time, so this is a reconstruction &mdash; and it uses today&rsquo;s validity flags,
         so a point invalidated this morning is absent from every earlier day too.</p>
      <div class="chart chart--tall" data-ngd-chart="ranks"></div>
    </div>
  </section>

  <!-- FOUNDERS ------------------------------------------------------------ -->
  <section class="panel" data-ngd-panel="founders" hidden>
    <div class="card">
      <div class="card__head">
        <div>
          <h2 class="card__h">All twenty founders</h2>
          <p class="card__p">Sort any column. Tick up to five to compare them.</p>
        </div>
        <label class="fld fld--sm fld--search">
          <span class="sr">Search founders</span>
          <input type="search" placeholder="Search a founder or company" data-ngd-search>
        </label>
      </div>
      <div class="tablewrap"><table class="tbl tbl--founders" data-ngd-table="founders"></table></div>
    </div>

    <div class="card" data-ngd-compare-card hidden>
      <h2 class="card__h">Comparison</h2>
      <div class="chart chart--tall" data-ngd-chart="compare"></div>
      <div class="tablewrap"><table class="tbl" data-ngd-table="compare"></table></div>
    </div>
  </section>

  <!-- TRAFFIC ------------------------------------------------------------- -->
  <section class="panel" data-ngd-panel="traffic" hidden>
    <div class="card card--note" data-ngd-traffic-note></div>

    <div class="grid grid--2">
      <div class="card">
        <h2 class="card__h">Contestant page visits</h2>
        <p class="card__p">The one traffic signal the voting system has collected from the start.</p>
        <div class="tablewrap"><table class="tbl" data-ngd-table="traffic"></table></div>
      </div>
      <div class="card">
        <h2 class="card__h">Visits by source</h2>
        <div class="tablewrap"><table class="tbl" data-ngd-table="sources"></table></div>
      </div>
    </div>

    <div class="card">
      <h2 class="card__h">Page views from the NextGen Data collector</h2>
      <div class="tablewrap"><table class="tbl" data-ngd-table="pages"></table></div>
    </div>
  </section>

  <!-- CONVERSIONS --------------------------------------------------------- -->
  <section class="panel" data-ngd-panel="conversions" hidden>
    <div class="card card--note" data-ngd-funnel-note></div>
    <div class="card">
      <h2 class="card__h">Visitor to voter to ticket</h2>
      <div class="funnel" data-ngd-funnel></div>
    </div>
    <div class="card">
      <h2 class="card__h">Confirmed ticket purchases</h2>
      <div data-ngd-orders></div>
    </div>
  </section>

  <!-- INSIGHTS ------------------------------------------------------------ -->
  <section class="panel" data-ngd-panel="insights" hidden>
    <div class="insights" data-ngd-insights></div>
    <div class="card">
      <h2 class="card__h">Data integrity</h2>
      <p class="card__p">Things worth knowing about the numbers above, rather than hidden behind them.</p>
      <div class="integrity" data-ngd-integrity></div>
    </div>
    <div class="card">
      <h2 class="card__h">What a figure means</h2>
      <div class="defs" data-ngd-defs></div>
    </div>
  </section>

  <!-- EXPORTS ------------------------------------------------------------- -->
  <section class="panel" data-ngd-panel="exports" hidden>
    <div class="card">
      <h2 class="card__h">Leadership reports</h2>
      <p class="card__p">Each file carries when the data was read, which source it came from, the period
         it covers and what every column means. No file contains a voter&rsquo;s email address, phone
         number or identifier, and a click is never reported as a purchase.</p>
      <div class="exports" data-ngd-exports></div>
    </div>
    <div class="card" data-ngd-email-card>
      <h2 class="card__h">Voter email addresses</h2>
      <div data-ngd-email-note></div>
      <div class="exports" data-ngd-email-exports></div>
    </div>

    <div class="card">
      <h2 class="card__h">A single founder</h2>
      <p class="card__p">Pick one for their own report.</p>
      <div class="row">
        <label class="fld fld--sm"><span class="sr">Founder</span>
          <select data-ngd-export-founder></select></label>
        <a class="btn btn--ghost btn--sm" data-ngd-export-one="csv" href="#">CSV</a>
        <a class="btn btn--ghost btn--sm" data-ngd-export-one="xlsx" href="#">Excel</a>
        <a class="btn btn--ghost btn--sm" data-ngd-export-one="pdf" href="#">PDF</a>
      </div>
    </div>
  </section>

  <?php if ($isOwner): ?>
  <!-- SETTINGS ------------------------------------------------------------ -->
  <section class="panel" data-ngd-panel="settings" hidden>

    <div class="card">
      <h2 class="card__h">Website event collection</h2>
      <p class="card__p">
        The collector records page views, founder engagement and the ticket journey &mdash; the
        things the voting database never held. It stores no IP address and sets no cookie; a
        visitor is a salted token that stops being linkable the next day.
        <b>It is currently <?= ngd_flag('collect') ? 'ON' : 'OFF' ?> on this site
        (<?= ngd_is_staging() ? 'the review site' : 'the live site' ?>).</b>
        Nothing before the moment it is switched on can ever be recovered, so the sooner it is
        approved the more of the competition it covers.
      </p>
      <form method="post" class="row">
        <input type="hidden" name="csrf" value="<?= hh($csrf) ?>">
        <input type="hidden" name="action" value="flag">
        <input type="hidden" name="name" value="collect">
        <input type="hidden" name="on" value="<?= ngd_flag('collect') ? '0' : '1' ?>">
        <button class="btn <?= ngd_flag('collect') ? 'btn--warn' : 'btn--go' ?>" type="submit">
          <?= ngd_flag('collect') ? 'Stop collecting' : 'Start collecting' ?>
        </button>
      </form>
    </div>

    <div class="card">
      <h2 class="card__h">Leadership accounts</h2>
      <p class="card__p">Each person gets their own username. Only a bcrypt hash is stored &mdash;
         nobody, including whoever set it up, can read a password back out. Suspending an account
         ends its open session on the very next request.</p>

      <?php if ($users): ?>
      <div class="tablewrap"><table class="tbl">
        <thead><tr><th>Username</th><th>Name</th><th>Added</th><th>Last signed in</th><th>State</th><th></th></tr></thead>
        <tbody>
        <?php foreach ($users as $u => $r): ?>
          <tr>
            <td><code><?= hh($u) ?></code></td>
            <td><?= hh($r['name']) ?><?php if (!empty($r['seeded'])): ?>
              <i style="display:block;font-size:11px;color:var(--fg-3)">provisioned with the deploy &mdash; suspend here, or remove its line from config.ngd.php</i>
            <?php endif; ?></td>
            <td class="num"><?= hh(substr((string) $r['added'], 0, 10)) ?></td>
            <td class="num"><?= hh($r['last'] ? substr((string) $r['last'], 0, 16) . 'Z' : 'never') ?></td>
            <td><?= $r['active'] ? '<span class="pill pill--ok">active</span>' : '<span class="pill pill--off">suspended</span>' ?></td>
            <td class="act">
              <form method="post">
                <input type="hidden" name="csrf" value="<?= hh($csrf) ?>">
                <input type="hidden" name="action" value="<?= $r['active'] ? 'account_suspend' : 'account_restore' ?>">
                <input type="hidden" name="u" value="<?= hh($u) ?>">
                <button class="btn btn--ghost btn--sm" type="submit"><?= $r['active'] ? 'Suspend' : 'Restore' ?></button>
              </form>
              <?php if (empty($r['seeded'])): ?>
              <form method="post" onsubmit="return confirm('Remove <?= hh($u) ?> for good?')">
                <input type="hidden" name="csrf" value="<?= hh($csrf) ?>">
                <input type="hidden" name="action" value="account_remove">
                <input type="hidden" name="u" value="<?= hh($u) ?>">
                <button class="btn btn--warn btn--sm" type="submit">Remove</button>
              </form>
              <?php endif; ?>
            </td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table></div>
      <?php else: ?>
        <p class="card__p"><i>No leadership accounts yet. Until one is added, only the owner PIN opens this dashboard.</i></p>
      <?php endif; ?>

      <form method="post" class="addrow">
        <input type="hidden" name="csrf" value="<?= hh($csrf) ?>">
        <input type="hidden" name="action" value="account_add">
        <label class="fld fld--sm"><span>Username</span>
          <input name="u" required pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{1,30}" autocapitalize="off" spellcheck="false"></label>
        <label class="fld fld--sm"><span>Display name</span><input name="n"></label>
        <label class="fld fld--sm"><span>Password (12+ characters)</span>
          <input name="p" type="password" required minlength="12" autocomplete="new-password"></label>
        <button class="btn btn--go btn--sm" type="submit">Add account</button>
      </form>
    </div>

    <div class="card">
      <h2 class="card__h">Where this data comes from</h2>
      <div class="defs" data-ngd-health-detail></div>
    </div>

    <div class="card card--warn">
      <h2 class="card__h">Emergency switch</h2>
      <p class="card__p">Turns every reporting page off at once, for everyone including you. Use it if
         this dashboard ever looks like it is costing the live site performance. Voting and ticket
         registration are unaffected either way &mdash; nothing in those paths reads this system.</p>
      <form method="post" class="row">
        <input type="hidden" name="csrf" value="<?= hh($csrf) ?>">
        <input type="hidden" name="action" value="flag">
        <input type="hidden" name="name" value="dashboard">
        <input type="hidden" name="on" value="0">
        <button class="btn btn--warn" type="submit">Switch the dashboard off</button>
      </form>
    </div>
  </section>
  <?php endif; ?>

  <footer class="foot">
    <p>NextGen Data reads the production voting records read-only. It holds no vote, changes no
       total, and nothing in the voting, verification or ticket paths depends on it.</p>
    <p class="foot__meta" data-ngd-foot></p>
  </footer>
</main>
<?php endif; /* dashboard flag */ ?>

<script src="/assets/js/ngd.js?v=<?= hh($stamp) ?>" defer></script>
<?php endif; /* signed in */ ?>
</body>
</html>
