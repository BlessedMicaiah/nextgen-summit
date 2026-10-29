<?php
/* Next Gen Summit: the questions for the speakers, sent from the speaker Q&A drawer in the FAQ.
   They are stored with the FAQ's questions (kind "question", marked for=speakers) in the site
   database, and listed here on their own: by speaker, searchable, marked new or reviewed,
   exported as CSV, and printable for whoever reads them out on stage.

   Two ways in. The program team's private link, /admin/speakers/?key=..., needs no password:
   the key is NGS_SPEAKERS_KEY in api/config.speakers.php (gitignored, and refused over the
   web by api/.htaccess like config.php), it lets that browser in for eight hours, and the
   address loses the key straight away. Change the key and every old link stops working; with
   no key file the link does nothing and only the password works. Or the admin's own sign-in
   (the session cookie covers /admin/): signing in here posts to /admin/, which sends you back. */
declare(strict_types=1);

require dirname(__DIR__, 2) . '/api/_lib.php';
if (is_file(dirname(__DIR__, 2) . '/api/config.speakers.php')) {
    require dirname(__DIR__, 2) . '/api/config.speakers.php';
}

header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store');
header('X-Frame-Options: DENY');
header('Referrer-Policy: same-origin');

$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
session_name('ngs_admin');
session_set_cookie_params(['lifetime' => 0, 'path' => '/admin/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Strict']);
session_start();

if (empty($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(16));
}
$csrf = $_SESSION['csrf'];
$admin = !empty($_SESSION['ok']) && (int) ($_SESSION['at'] ?? 0) > time() - 8 * 3600;

// the private link: a matching key lets this browser in, then the key leaves the address
$key = is_string($_GET['key'] ?? null) ? $_GET['key'] : '';
if ($key !== '') {
    if (defined('NGS_SPEAKERS_KEY') && strlen((string) NGS_SPEAKERS_KEY) >= 32 && hash_equals((string) NGS_SPEAKERS_KEY, $key)) {
        session_regenerate_id(true);
        $_SESSION['spk'] = hash('sha256', (string) NGS_SPEAKERS_KEY);
        $_SESSION['spk_at'] = time();
        header('Location: /admin/speakers/', true, 303);
        exit;
    }
    sleep(1);
}
// a link-only visit lasts eight hours, and ends at once if the key is changed
$viaLink = defined('NGS_SPEAKERS_KEY') && is_string($_SESSION['spk'] ?? null)
    && hash_equals(hash('sha256', (string) NGS_SPEAKERS_KEY), $_SESSION['spk'])
    && (int) ($_SESSION['spk_at'] ?? 0) > time() - 8 * 3600;
$authed = $admin || $viaLink;

// the lineup, as the drawer offers it, with the photo each one has on the site
const SPQ_SPEAKERS = [
    'Any speaker' => '',
    'Tisha Edwards' => 'tisha-edwards',
    'Tunde Onakoya' => 'tunde-onakoya',
    'Kennedy Ekezie' => 'kennedy-ekezie',
    'Gianna Romero' => 'gianna-romero',
    'Michael Ley' => 'michael-ley',
    'Jack Scalise' => 'jack-scalise',
    'Jamar Simms' => 'jamar-simms',
];

function h($v): string
{
    return htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
}

function et(string $iso): string
{
    try {
        return (new DateTime($iso))->setTimezone(new DateTimeZone('America/New_York'))->format('M j, g:i A');
    } catch (Throwable $e) {
        return $iso;
    }
}

function spq_status(array $d): string
{
    return ($d['status'] ?? '') === 'reviewed' ? 'reviewed' : 'new';
}

function spq_speaker(array $d): string
{
    $s = (string) ($d['speaker'] ?? '');
    return array_key_exists($s, SPQ_SPEAKERS) ? $s : 'Any speaker';
}

/** Only the questions for the speakers, newest first. */
function spq_all(): array
{
    return array_values(array_filter(ngs_all('question'), function ($r) {
        return ($r['data']['for'] ?? '') === 'speakers';
    }));
}

// mark new / reviewed, and delete: only ever on a question for the speakers
if ($authed && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $ok = isset($_POST['csrf']) && is_string($_POST['csrf']) && hash_equals((string) $_SESSION['csrf'], $_POST['csrf']);
    $id = is_string($_POST['id'] ?? null) ? $_POST['id'] : '';
    $back = '/admin/speakers/';
    $keep = array_filter(['speaker' => $_POST['speaker_filter'] ?? '', 'q' => $_POST['q'] ?? '', 'show' => $_POST['show'] ?? ''],
        function ($v) { return is_string($v) && $v !== ''; });
    if ($keep) {
        $back .= '?' . http_build_query($keep);
    }
    if ($ok && preg_match('/^[a-f0-9]{16}$/', $id) && in_array($id, array_column(spq_all(), 'id'), true)) {
        $action = $_POST['action'] ?? '';
        if ($action === 'status') {
            ngs_update_data($id, ['status' => ($_POST['status'] ?? '') === 'reviewed' ? 'reviewed' : 'new']);
            header('Location: ' . $back . '#q-' . $id, true, 303);
            exit;
        }
        if ($action === 'delete') {
            ngs_delete($id);
            header('Location: ' . $back . ($keep ? '&' : '?') . 'deleted=1', true, 303);
            exit;
        }
    }
    header('Location: ' . $back, true, 303);
    exit;
}

$error = '';
$rows = [];
if ($authed) {
    try {
        $rows = spq_all();
    } catch (Throwable $e) {
        error_log('Next Gen Summit speaker questions error: ' . $e->getMessage());
        $error = 'The questions could not be read. Check the PHP error log on the host.';
    }
}

$filter = is_string($_GET['speaker'] ?? null) && array_key_exists($_GET['speaker'], SPQ_SPEAKERS) ? $_GET['speaker'] : '';
$q = is_string($_GET['q'] ?? null) ? trim($_GET['q']) : '';
$show = ($_GET['show'] ?? '') === 'new' ? 'new' : '';

$shown = array_values(array_filter($rows, function ($r) use ($filter, $q, $show) {
    $d = $r['data'];
    if ($filter !== '' && spq_speaker($d) !== $filter) {
        return false;
    }
    if ($show === 'new' && spq_status($d) !== 'new') {
        return false;
    }
    if ($q !== '') {
        $hay = strtolower(implode(' ', array_map('strval', $d)));
        if (strpos($hay, strtolower($q)) === false) {
            return false;
        }
    }
    return true;
}));

// CSV of what is on screen. A leading = + - @ is neutralized so spreadsheets never run a formula.
if ($authed && isset($_GET['export']) && $error === '') {
    $tag = $filter === '' ? 'all' : strtolower(preg_replace('/[^a-z]+/i', '-', $filter));
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="nextgen-speaker-questions-' . $tag . '-' . gmdate('Y-m-d') . '.csv"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF");
    $safe = function ($v) {
        $v = (string) $v;
        return preg_match('/^[=+\-@\t\r]/', $v) ? "'" . $v : $v;
    };
    fputcsv($out, ['Received (ET)', 'Status', 'For', 'Full name', 'Email', 'Question']);
    foreach ($shown as $r) {
        $d = $r['data'];
        fputcsv($out, array_map($safe, [et($r['created_at']), spq_status($d) === 'reviewed' ? 'Reviewed' : 'New', spq_speaker($d), $d['name'] ?? '', $d['email'] ?? '', $d['question'] ?? '']));
    }
    exit;
}

$counts = array_fill_keys(array_keys(SPQ_SPEAKERS), 0);
$new = 0;
foreach ($rows as $r) {
    $counts[spq_speaker($r['data'])]++;
    if (spq_status($r['data']) === 'new') {
        $new++;
    }
}

/** This page's address with one setting changed, keeping the others. */
function spq_url(array $change): string
{
    global $filter, $q, $show;
    $p = array_merge(['speaker' => $filter, 'q' => $q, 'show' => $show], $change);
    $p = array_filter($p, function ($v) { return $v !== '' && $v !== null; });
    return '/admin/speakers/' . ($p ? '?' . http_build_query($p) : '');
}
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Speaker questions · Next Gen Summit</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@144,900,100,0&amp;family=Montserrat:wght@500;600;700;800&amp;display=swap">
<link rel="stylesheet" href="/assets/css/site.css">
<style>
  body{background:var(--paper)}
  .adm{max-width:1180px;margin:0 auto;padding:28px clamp(18px,4vw,48px) 80px}
  .adm__top{display:flex;flex-wrap:wrap;align-items:center;gap:12px 22px;padding-bottom:22px;border-bottom:1px solid var(--rule)}
  .adm__mark{display:flex;align-items:baseline;gap:.6em;text-decoration:none;margin-right:auto}
  .adm__mark .wm{font-size:30px;line-height:1}
  .adm h1.wm{margin:34px 0 8px;font-size:clamp(44px,6vw,72px);line-height:.95}
  .adm__sub{font:500 15px/1.5 var(--f-sans);color:var(--ink-2)}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin:30px 0 26px;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
  .stat{padding:16px 18px 16px 0}
  .stat b{display:block;font:800 34px/1 var(--f-sans);letter-spacing:-.02em}
  .stat span{display:block;margin-top:6px;font:700 11px/1.3 var(--f-sans);letter-spacing:.16em;text-transform:uppercase;color:var(--ink-2)}
  /* who it is for: one chip per speaker, with how many are waiting */
  .whos{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 22px;padding:0;list-style:none}
  .who{display:inline-flex;align-items:center;gap:10px;min-height:46px;padding:5px 14px 5px 5px;border:1.5px solid var(--rule);border-radius:999px;background:#fff;text-decoration:none;color:var(--ink);font:700 13px/1.2 var(--f-sans);transition:border-color .3s var(--ease)}
  .who:hover{border-color:var(--ink)}
  .who[aria-current="true"]{border-color:var(--accent);box-shadow:inset 0 0 0 1.5px var(--accent)}
  .who__face{position:relative;display:grid;place-items:center;width:34px;height:34px;border-radius:50%;overflow:hidden;background:var(--ink);color:#fff;font:800 10px/1 var(--f-sans);letter-spacing:.06em;text-transform:uppercase;flex:none}
  /* framed on each face, with the same measurements as the FAQ's avatars (speakq.css) */
  .who__face img{position:absolute;left:var(--fx,0%);top:var(--fy,0%);width:calc(var(--fz,1) * 100%);max-width:none;height:auto}
  [src*="speakers/tisha-edwards-"]{--fz:1.12;--fx:-6.1%}
  [src*="speakers/tunde-onakoya-"]{--fz:1.12;--fx:-6.1%}
  [src*="speakers/michael-ley-"]{--fz:1.18;--fx:-5.4%}
  [src*="speakers/jack-scalise-"]{--fz:1.63;--fx:-34.5%;--fy:-14.6%}
  [src*="speakers/jamar-simms-"]{--fz:1.75;--fx:-32.1%;--fy:-21.7%}
  .who__n{min-width:22px;padding:3px 7px;border-radius:999px;background:var(--paper-2);font:800 11px/1 var(--f-sans);text-align:center}
  .who--zero{opacity:.55}
  .bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 18px;margin-bottom:16px}
  .bar__t{font:800 12px/1.3 var(--f-sans);letter-spacing:.14em;text-transform:uppercase}
  .bar__t a{margin-left:10px;color:var(--accent-ink);letter-spacing:.08em}
  .tools{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  .tools input{height:42px;min-width:220px;padding:0 12px;border:1.5px solid var(--rule-strong);border-radius:8px;font:500 15px/1 var(--f-sans);background:#fff}
  .note{margin:18px 0;padding:12px 14px;border-radius:8px;background:#FBE9EE;color:#8A1233;font:600 14px/1.45 var(--f-sans)}
  .note--ok{background:var(--paper-2);color:var(--ink)}
  .empty{padding:40px 20px;text-align:center;color:var(--ink-2);border:1px solid var(--rule);border-radius:10px;background:#fff}
  .qs{list-style:none;margin:0;padding:0;border:1px solid var(--rule);border-radius:10px;background:#fff}
  .q{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px 24px;padding:20px clamp(16px,2vw,24px);border-bottom:1px solid var(--rule);scroll-margin-top:20px}
  .q:last-child{border-bottom:0}
  .q__meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;font:600 13px/1.4 var(--f-sans);color:var(--ink-2)}
  .badge{display:inline-flex;align-items:center;min-height:22px;padding:0 8px;border-radius:4px;font:800 10px/1 var(--f-sans);letter-spacing:.14em;text-transform:uppercase}
  .badge--new{background:var(--accent);color:var(--on-accent)}
  .badge--reviewed{border:1.5px solid var(--rule-strong);color:var(--ink-2)}
  .badge--for{background:var(--ink);color:#fff}
  .q__text{margin-top:10px;max-width:72ch;font:600 17px/1.55 var(--f-sans);color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere}
  .q--reviewed .q__text{color:var(--ink-2);font-weight:500}
  .q__who{margin-top:8px;font:600 14px/1.45 var(--f-sans);color:var(--ink-2);overflow-wrap:anywhere}
  .q__who a{color:var(--accent-ink)}
  .q__acts{display:flex;flex-direction:column;align-items:flex-end;gap:8px}
  .q__acts form{margin:0}
  .mark{min-height:40px;padding:0 14px;border:1.5px solid var(--ink);border-radius:6px;font:700 11px/1 var(--f-sans);letter-spacing:.1em;text-transform:uppercase;color:var(--ink);white-space:nowrap}
  .mark:hover{background:var(--ink);color:#fff}
  .del{min-height:32px;padding:0 10px;border:1.5px solid var(--rule-strong);border-radius:6px;font:700 11px/1 var(--f-sans);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2)}
  .del:hover{border-color:#8A1233;color:#8A1233}
  .login{max-width:420px;margin:12vh auto 0}
  .login form{display:grid;gap:16px;margin-top:26px}
  @media (max-width:640px){
    .q{grid-template-columns:1fr}
    .q__acts{flex-direction:row;flex-wrap:wrap;align-items:center}
    .tools,.tools form{width:100%}
    .tools input{min-width:0;width:100%}
  }
  /* printed for the stage: just who it is for, the question and who asked, large and in order */
  @media print{
    .adm__top,.stats,.whos,.tools,.q__acts,.note,.noprint{display:none!important}
    .adm{padding:0;max-width:none}
    .adm h1.wm{margin-top:0;font-size:40px}
    .qs{border:0}
    .q{display:block;padding:14px 0;border-bottom:1px solid #999;break-inside:avoid}
    .badge--new,.badge--reviewed{display:none}
    .badge--for{background:none;color:#000;padding:0;font-size:12px}
    .q__text{font-size:19px;color:#000!important}
  }
</style>
</head>
<body>
<?php if (!$authed): ?>
  <main class="adm">
    <div class="login">
      <a class="adm__mark" href="/"><span class="wm">nextgen</span><span class="nav__summit">Admin</span></a>
      <h1 class="wm">sign in.</h1>
      <p class="adm__sub">Questions for the NextGen Summit speakers. Open the private link you were sent, or sign in with the admin password.</p>
      <?php if ($key !== ''): ?><p class="note" role="alert">That link is not valid any more. Ask the NextGen team for the current one.</p><?php endif; ?>
      <form method="post" action="/admin/">
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
        <input type="hidden" name="action" value="login">
        <input type="hidden" name="next" value="speakers">
        <div class="field"><label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required autofocus></div>
        <div><button class="btn btn--lg" type="submit">Sign in</button></div>
      </form>
    </div>
  </main>
<?php else: ?>
  <main class="adm">
    <div class="adm__top">
      <a class="adm__mark" href="/" target="_blank" rel="noopener"><span class="wm">nextgen</span><span class="nav__summit">Speaker Q&amp;A</span></a>
      <?php if ($admin): ?><a class="textlink" href="/admin/">&larr; Admin</a><?php endif; ?>
      <form method="post" action="/admin/">
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
        <input type="hidden" name="action" value="logout">
        <button class="textlink" type="submit">Sign out</button>
      </form>
    </div>

    <h1 class="wm">speaker<br> questions.</h1>
    <p class="adm__sub">Sent from the speaker Q&amp;A in the FAQ · Reply by email · Times shown in Eastern Time.</p>
    <?php if ($error !== ''): ?><p class="note" role="alert"><?= h($error) ?></p><?php endif; ?>
    <?php if (isset($_GET['deleted'])): ?><p class="note note--ok" role="status">Question deleted.</p><?php endif; ?>

    <div class="stats">
      <div class="stat"><b><?= count($rows) ?></b><span>Questions</span></div>
      <div class="stat"><b><?= $new ?></b><span>New</span></div>
      <div class="stat"><b><?= count($rows) - $new ?></b><span>Reviewed</span></div>
    </div>

    <nav aria-label="Questions by speaker">
      <ul class="whos">
        <li><a class="who" href="<?= h(spq_url(['speaker' => ''])) ?>" aria-current="<?= $filter === '' ? 'true' : 'false' ?>"><span class="who__face" aria-hidden="true">all</span>Everyone <span class="who__n"><?= count($rows) ?></span></a></li>
        <?php foreach (SPQ_SPEAKERS as $name => $slug): ?>
          <li><a class="who<?= $counts[$name] === 0 ? ' who--zero' : '' ?>" href="<?= h(spq_url(['speaker' => $name])) ?>" aria-current="<?= $filter === $name ? 'true' : 'false' ?>">
            <span class="who__face" aria-hidden="true"><?php if ($slug !== ''): ?><img src="/assets/img/speakers/<?= h($slug) ?>-620.jpg" alt="" width="620" height="868" loading="lazy"><?php else: ?>any<?php endif; ?></span><?= h($name) ?> <span class="who__n"><?= $counts[$name] ?></span></a></li>
        <?php endforeach; ?>
      </ul>
    </nav>

    <div class="bar">
      <p class="bar__t"><?= $filter === '' ? 'Everyone' : 'For ' . h($filter) ?> · <?= count($shown) ?> shown<?php if ($show === 'new'): ?><a href="<?= h(spq_url(['show' => ''])) ?>">Show all</a><?php else: ?><a href="<?= h(spq_url(['show' => 'new'])) ?>">New only</a><?php endif; ?></p>
      <div class="tools">
        <form method="get" action="/admin/speakers/" role="search">
          <?php if ($filter !== ''): ?><input type="hidden" name="speaker" value="<?= h($filter) ?>"><?php endif; ?>
          <?php if ($show !== ''): ?><input type="hidden" name="show" value="<?= h($show) ?>"><?php endif; ?>
          <label class="sr" for="q">Search the questions</label>
          <input id="q" name="q" type="search" value="<?= h($q) ?>" placeholder="Search name, email, question">
        </form>
        <a class="btn btn--sm" href="<?= h(spq_url(['export' => 'csv'])) ?>">Export CSV</a>
        <button class="btn btn--sm btn--ghost" type="button" onclick="window.print()">Print</button>
      </div>
    </div>

    <?php if (!$shown): ?>
      <p class="empty"><?= $rows ? 'Nothing matches that.' : 'No questions for the speakers yet.' ?></p>
    <?php else: ?>
      <ol class="qs">
      <?php foreach ($shown as $r): $d = $r['data']; $st = spq_status($d); ?>
        <li class="q q--<?= $st ?>" id="q-<?= h($r['id']) ?>">
          <div>
            <p class="q__meta"><span class="badge badge--for">For <?= h(spq_speaker($d)) ?></span><span class="badge badge--<?= $st ?>"><?= $st === 'reviewed' ? 'Reviewed' : 'New' ?></span><time datetime="<?= h($r['created_at']) ?>"><?= h(et($r['created_at'])) ?></time></p>
            <p class="q__text"><?= h($d['question'] ?? '') ?></p>
            <p class="q__who"><?= h($d['name'] ?? '') ?><?php if (($d['email'] ?? '') !== ''): ?> <span aria-hidden="true">·</span> <a href="mailto:<?= h($d['email']) ?>?subject=<?= rawurlencode('Your question for the NextGen Summit speakers') ?>"><?= h($d['email']) ?></a><?php endif; ?></p>
          </div>
          <div class="q__acts">
            <form method="post" action="/admin/speakers/">
              <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
              <input type="hidden" name="action" value="status">
              <input type="hidden" name="id" value="<?= h($r['id']) ?>">
              <input type="hidden" name="status" value="<?= $st === 'reviewed' ? 'new' : 'reviewed' ?>">
              <input type="hidden" name="speaker_filter" value="<?= h($filter) ?>"><input type="hidden" name="q" value="<?= h($q) ?>"><input type="hidden" name="show" value="<?= h($show) ?>">
              <button class="mark" type="submit"><?= $st === 'reviewed' ? 'Mark as new' : 'Mark reviewed' ?></button>
            </form>
            <form method="post" action="/admin/speakers/" onsubmit="return confirm('Delete this question? This cannot be undone.')">
              <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
              <input type="hidden" name="action" value="delete">
              <input type="hidden" name="id" value="<?= h($r['id']) ?>">
              <input type="hidden" name="speaker_filter" value="<?= h($filter) ?>"><input type="hidden" name="q" value="<?= h($q) ?>"><input type="hidden" name="show" value="<?= h($show) ?>">
              <button class="del" type="submit">Delete</button>
            </form>
          </div>
        </li>
      <?php endforeach; ?>
      </ol>
    <?php endif; ?>
  </main>
<?php endif; ?>
</body>
</html>
