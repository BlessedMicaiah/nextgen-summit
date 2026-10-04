<?php
/* Next Gen Summit admin: see, search, export and tidy up everyone who registered,
   the questions sent from the FAQ, and scholarship applications.
   Tabs: Registrations, Questions, Scholarships. */
declare(strict_types=1);

require dirname(__DIR__) . '/api/_lib.php';

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
$authed = !empty($_SESSION['ok']) && (int) ($_SESSION['at'] ?? 0) > time() - 8 * 3600;

function h($v): string
{
    return htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
}

function token_ok(): bool
{
    return isset($_POST['csrf']) && is_string($_POST['csrf']) && hash_equals((string) $_SESSION['csrf'], $_POST['csrf']);
}

function et(string $iso): string
{
    try {
        return (new DateTime($iso))->setTimezone(new DateTimeZone('America/New_York'))->format('M j, g:i A');
    } catch (Throwable $e) {
        return $iso;
    }
}

$notice = '';
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $action = is_string($_POST['action'] ?? null) ? $_POST['action'] : '';
    if (!token_ok()) {
        http_response_code(400);
        $notice = 'Your session expired. Please try again.';
    } elseif ($action === 'login') {
        $pw = is_string($_POST['password'] ?? null) ? $_POST['password'] : '';
        if (hash_equals(NGS_ADMIN_HASH, hash_hmac('sha256', $pw, NGS_ADMIN_SALT))) {
            session_regenerate_id(true);
            $_SESSION['ok'] = true;
            $_SESSION['at'] = time();
            header('Location: /admin/', true, 303);
            exit;
        }
        sleep(2);
        $notice = 'That password did not match.';
    } elseif ($action === 'logout') {
        $_SESSION = [];
        session_destroy();
        header('Location: /admin/', true, 303);
        exit;
    } elseif ($action === 'delete' && $authed) {
        $id = is_string($_POST['id'] ?? null) ? $_POST['id'] : '';
        if (preg_match('/^[a-f0-9]{16}$/', $id)) {
            ngs_delete($id);
        }
        $back = in_array($_POST['tab'] ?? '', ['questions', 'scholarships'], true) ? $_POST['tab'] : 'registrations';
        header('Location: /admin/?tab=' . $back . '&deleted=1', true, 303);
        exit;
    } elseif ($action === 'status' && $authed) {
        // New / Reviewed on a question or an application; nothing else about the entry changes
        $id = is_string($_POST['id'] ?? null) ? $_POST['id'] : '';
        $to = ($_POST['status'] ?? '') === 'reviewed' ? 'reviewed' : 'new';
        $kindOf = ($_POST['tab'] ?? '') === 'scholarships' ? 'scholarship' : 'question';
        if (preg_match('/^[a-f0-9]{16}$/', $id) && in_array($id, array_column(ngs_all($kindOf), 'id'), true)) {
            ngs_update_data($id, ['status' => $to]);
        }
        header('Location: /admin/?tab=' . ($kindOf === 'scholarship' ? 'scholarships' : 'questions') . '#q-' . $id, true, 303);
        exit;
    }
}

$error = '';
$registrations = $notes = $questions = $scholarships = [];
if ($authed) {
    try {
        // waitlist sign-ups and any earlier registrations share one list, newest first
        $registrations = array_merge(ngs_all('waitlist'), ngs_all('registration'));
        usort($registrations, function ($a, $b) {
            return strcmp($b['created_at'], $a['created_at']);
        });
        $notes = array_merge(ngs_all('volunteer'), ngs_all('partner'));
        usort($notes, function ($a, $b) {
            return strcmp($b['created_at'], $a['created_at']);
        });
        $questions = ngs_all('question');
        $scholarships = ngs_all('scholarship');
    } catch (Throwable $e) {
        error_log('Next Gen Summit admin error: ' . $e->getMessage());
        $error = 'The registration data could not be read. Check the PHP error log on the host.';
    }
}

// CSV export. A leading = + - @ is neutralized so spreadsheets never run a formula from a form.
if ($authed && isset($_GET['export']) && $error === '') {
    $which = in_array($_GET['export'], ['notes', 'questions', 'scholarships'], true) ? $_GET['export'] : 'registrations';
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="nextgen-' . $which . '-' . gmdate('Y-m-d') . '.csv"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF");
    $safe = function ($v) {
        $v = (string) $v;
        return preg_match('/^[=+\-@\t\r]/', $v) ? "'" . $v : $v;
    };
    if ($which === 'registrations') {
        fputcsv($out, ['Signed up (ET)', 'List', 'Name', 'Email', 'Phone', 'Education level', 'School', 'Interested in volunteering']);
        foreach ($registrations as $r) {
            $d = $r['data'];
            fputcsv($out, array_map($safe, [et($r['created_at']), $r['kind'] === 'waitlist' ? 'Waitlist' : 'Registration', person_name($d), $d['email'] ?? '', $d['phone'] ?? '', $d['education_level'] ?? '', $d['school_name'] ?? '', $d['volunteer_interest'] ?? '']));
        }
    } elseif ($which === 'scholarships') {
        fputcsv($out, ['Applied (ET)', 'Status', 'Full name', 'Email', 'Phone', 'School / College / Organization', 'Why attend', 'Scholarship reason', 'Other reason', 'Can commit to Oct 30']);
        foreach ($scholarships as $r) {
            $d = $r['data'];
            fputcsv($out, array_map($safe, [et($r['created_at']), q_status($d) === 'reviewed' ? 'Reviewed' : 'New', $d['name'] ?? '', $d['email'] ?? '', $d['phone'] ?? '', $d['organization'] ?? '', $d['why'] ?? '', $d['reason'] ?? '', $d['reason_other'] ?? '', $d['commit'] ?? '']));
        }
    } elseif ($which === 'questions') {
        fputcsv($out, ['Received (ET)', 'Status', 'Full name', 'Email', 'Question']);
        foreach ($questions as $r) {
            $d = $r['data'];
            fputcsv($out, array_map($safe, [et($r['created_at']), q_status($d) === 'reviewed' ? 'Reviewed' : 'New', $d['name'] ?? '', $d['email'] ?? '', $d['question'] ?? '']));
        }
    } else {
        fputcsv($out, ['Sent (ET)', 'Type', 'Name', 'Email', 'Campus', 'Organization']);
        foreach ($notes as $r) {
            $d = $r['data'];
            fputcsv($out, array_map($safe, [et($r['created_at']), ucfirst($r['kind']), $d['name'] ?? '', $d['email'] ?? '', $d['campus'] ?? '', $d['organization'] ?? '']));
        }
    }
    exit;
}

// ?tab=notes is an old link; those notes now live at the foot of Registrations
$tab = in_array($_GET['tab'] ?? '', ['questions', 'scholarships'], true) ? $_GET['tab'] : 'registrations';
$q = is_string($_GET['q'] ?? null) ? trim($_GET['q']) : '';

$emailCount = [];
foreach ($registrations as $r) {
    $e = strtolower((string) ($r['data']['email'] ?? ''));
    $emailCount[$e] = ($emailCount[$e] ?? 0) + 1;
}
$stats = ['High School' => 0, 'College' => 0, 'Young Professional' => 0, 'Other' => 0, 'volunteers' => 0];
foreach ($registrations as $r) {
    $lvl = $r['data']['education_level'] ?? '';
    if (isset($stats[$lvl])) {
        $stats[$lvl]++;
    }
    if (($r['data']['volunteer_interest'] ?? '') === 'Yes') {
        $stats['volunteers']++;
    }
}

/** Questions and applications start as new; anything unrecognised reads as new too. */
function q_status(array $d): string
{
    return ($d['status'] ?? '') === 'reviewed' ? 'reviewed' : 'new';
}

/** Waitlist sign-ups have one name field; registrations had first and last. */
function person_name(array $d): string
{
    return trim((string) ($d['name'] ?? (($d['first_name'] ?? '') . ' ' . ($d['last_name'] ?? ''))));
}

function matches(array $r, string $q): bool
{
    if ($q === '') {
        return true;
    }
    $hay = strtolower(implode(' ', array_map('strval', $r['data'])));
    return strpos($hay, strtolower($q)) !== false;
}
$shownRegs = array_values(array_filter($registrations, function ($r) use ($q) { return matches($r, $q); }));
$shownNotes = array_values(array_filter($notes, function ($r) use ($q) { return matches($r, $q); }));
$shownQuestions = array_values(array_filter($questions, function ($r) use ($q) { return matches($r, $q); }));
$newQuestions = count(array_filter($questions, function ($r) { return q_status($r['data']) === 'new'; }));
$shownScholarships = array_values(array_filter($scholarships, function ($r) use ($q) { return matches($r, $q); }));
$newScholarships = count(array_filter($scholarships, function ($r) { return q_status($r['data']) === 'new'; }));
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Admin · Next Gen Summit</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@144,900,100,0&amp;family=Montserrat:wght@500;600;700;800&amp;display=swap">
<link rel="stylesheet" href="/assets/css/site.css?v=20261001-20">
<style>
  body{background:var(--paper)}
  .adm{max-width:1280px;margin:0 auto;padding:28px clamp(18px,4vw,48px) 80px}
  .adm__top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:22px;border-bottom:1px solid var(--rule)}
  .adm__mark{display:flex;align-items:baseline;gap:.6em;text-decoration:none}
  .adm__mark .wm{font-size:30px;line-height:1}
  .adm h1.wm,.adm h2.wm{margin:34px 0 8px;font-size:clamp(44px,6vw,72px);line-height:.95}
  .adm__sub{font:500 15px/1.5 var(--f-sans);color:var(--ink-2)}
  /* REGISTRATIONS | QUESTIONS */
  .ptabs{display:flex;margin-top:26px;border-bottom:1px solid var(--rule)}
  .ptab{position:relative;display:inline-flex;align-items:center;gap:.6em;min-height:52px;padding:0 clamp(14px,2vw,22px);font:800 13px/1 var(--f-sans);letter-spacing:.14em;text-transform:uppercase;text-decoration:none;color:var(--ink-2);transition:color .3s var(--ease)}
  .ptab:first-child{padding-left:0}
  .ptab:hover,.ptab[aria-selected="true"]{color:var(--ink)}
  .ptab[aria-selected="true"]::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:3px;background:var(--accent)}
  .ptab:not(:first-child)[aria-selected="true"]::after{left:clamp(14px,2vw,22px);right:clamp(14px,2vw,22px)}
  .ptab:first-child[aria-selected="true"]::after{right:clamp(14px,2vw,22px)}
  .ptab:focus-visible{outline:2px solid var(--accent-ink);outline-offset:-2px;border-radius:4px}
  .ptab__n{font-weight:700;letter-spacing:.04em;color:var(--ink-2)}
  .ptab__new{padding:3px 7px;border-radius:4px;background:var(--ink);color:#fff;font:700 10px/1.2 var(--f-sans);letter-spacing:.1em;white-space:nowrap}
  @media (max-width:560px){.ptab{padding:0 10px;letter-spacing:.08em;font-size:11.5px}.ptab__n{display:none}}
  @media (max-width:400px){.ptab__new{padding:3px 5px}}
  .panel[hidden]{display:none}
  .panel:focus-visible{outline:2px solid var(--accent-ink);outline-offset:6px;border-radius:4px}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0;margin:30px 0 26px;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
  .stat{padding:16px 18px 16px 0}
  .stat b{display:block;font:800 34px/1 var(--f-sans);letter-spacing:-.02em}
  .stat span{display:block;margin-top:6px;font:700 11px/1.3 var(--f-sans);letter-spacing:.16em;text-transform:uppercase;color:var(--ink-2)}
  .bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 18px;margin-bottom:16px}
  .bar__t{font:800 12px/1.3 var(--f-sans);letter-spacing:.14em;text-transform:uppercase}
  .tools{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  .tools input{height:42px;min-width:220px;padding:0 12px;border:1.5px solid var(--rule-strong);border-radius:8px;font:500 15px/1 var(--f-sans);background:#fff}
  .tablewrap{overflow-x:auto;border:1px solid var(--rule);border-radius:10px;background:#fff}
  .notes{margin-top:clamp(40px,6vh,64px)}
  table{width:100%;border-collapse:collapse;font:500 14px/1.4 var(--f-sans)}
  th{position:sticky;top:0;background:#fff;text-align:left;padding:12px 14px;font:700 11px/1.3 var(--f-sans);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-2);border-bottom:1px solid var(--rule);white-space:nowrap}
  td{padding:12px 14px;border-bottom:1px solid var(--rule);vertical-align:top}
  tr:last-child td{border-bottom:0}
  td a{color:var(--ink)}
  .dup{display:inline-block;margin-left:6px;padding:2px 6px;border-radius:4px;background:var(--paper-2);font:700 10px/1.3 var(--f-sans);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2)}
  .yes{font-weight:700;color:var(--accent-ink)}
  .del{min-height:32px;padding:0 10px;border:1.5px solid var(--rule-strong);border-radius:6px;font:700 11px/1 var(--f-sans);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2)}
  .del:hover{border-color:#8A1233;color:#8A1233}
  .empty{padding:40px 20px;text-align:center;color:var(--ink-2)}
  .note{margin:0 0 18px;padding:12px 14px;border-radius:8px;background:#FBE9EE;color:#8A1233;font:600 14px/1.45 var(--f-sans)}
  .note--ok{background:var(--paper-2);color:var(--ink)}
  /* questions read as a list, not a spreadsheet: the question itself is the point */
  .qs{list-style:none;margin:0;padding:0;border:1px solid var(--rule);border-radius:10px;background:#fff}
  .q{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px 24px;padding:20px clamp(16px,2vw,24px);border-bottom:1px solid var(--rule);scroll-margin-top:20px}
  .q:last-child{border-bottom:0}
  .q__meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;font:600 13px/1.4 var(--f-sans);color:var(--ink-2)}
  .badge{display:inline-flex;align-items:center;min-height:22px;padding:0 8px;border-radius:4px;font:800 10px/1 var(--f-sans);letter-spacing:.14em;text-transform:uppercase}
  .badge--new{background:var(--accent);color:var(--on-accent)}
  .badge--reviewed{border:1.5px solid var(--rule-strong);color:var(--ink-2)}
  .q__who{margin-top:8px;font:700 15px/1.45 var(--f-sans);overflow-wrap:anywhere}
  .q__who a{font-weight:600;color:var(--accent-ink)}
  .q__text{margin-top:8px;max-width:72ch;font:500 15.5px/1.6 var(--f-sans);color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere}
  .q--reviewed .q__text{color:var(--ink-2)}
  .q__acts{display:flex;flex-direction:column;align-items:flex-end;gap:8px}
  .q__acts form{margin:0}
  .mark{min-height:40px;padding:0 14px;border:1.5px solid var(--ink);border-radius:6px;font:700 11px/1 var(--f-sans);letter-spacing:.1em;text-transform:uppercase;color:var(--ink);white-space:nowrap}
  .mark:hover{background:var(--ink);color:#fff}
  .sfacts{margin:12px 0 0;display:grid;gap:10px;max-width:72ch}
  .sfacts dt{font:700 10.5px/1.3 var(--f-sans);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-2)}
  .sfacts dd{margin:3px 0 0;font:500 15px/1.55 var(--f-sans)}
  @media (max-width:640px){
    .q{grid-template-columns:1fr}
    .q__acts{flex-direction:row;flex-wrap:wrap;align-items:center}
    .tools,.tools form{width:100%}
    .tools input{min-width:0;width:100%}
  }
  .login{max-width:420px;margin:12vh auto 0}
  .login form{display:grid;gap:16px;margin-top:26px}
</style>
</head>
<body>
<?php if (!$authed): ?>
  <main class="adm">
    <div class="login">
      <a class="adm__mark" href="/"><span class="wm">nextgen</span><span class="nav__summit">Admin</span></a>
      <h1 class="wm">sign in.</h1>
      <p class="adm__sub">Sign-ups and questions for Next Gen Summit.</p>
      <?php if ($notice !== ''): ?><p class="note" role="alert"><?= h($notice) ?></p><?php endif; ?>
      <form method="post" action="/admin/">
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
        <input type="hidden" name="action" value="login">
        <div class="field"><label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required autofocus></div>
        <div><button class="btn btn--lg" type="submit">Sign in</button></div>
      </form>
    </div>
  </main>
<?php else: ?>
  <main class="adm">
    <div class="adm__top">
      <a class="adm__mark" href="/" target="_blank" rel="noopener"><span class="wm">nextgen</span><span class="nav__summit">Admin</span></a>
      <form method="post" action="/admin/">
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
        <input type="hidden" name="action" value="logout">
        <button class="textlink" type="submit">Sign out</button>
      </form>
    </div>
    <h1 class="sr">Next Gen Summit admin</h1>

    <?php if ($error !== ''): ?><p class="note" role="alert" style="margin-top:22px"><?= h($error) ?></p><?php endif; ?>

    <!-- real links underneath, so each tab still works with scripting off; the script at the end
         turns them into in-page tabs (arrow keys, Home and End move between them) -->
    <div class="ptabs" role="tablist" aria-label="Admin sections">
      <a class="ptab" role="tab" id="tab-registrations" href="/admin/?tab=registrations" aria-controls="panel-registrations" data-tab="registrations"
        aria-selected="<?= $tab === 'registrations' ? 'true' : 'false' ?>" tabindex="<?= $tab === 'registrations' ? '0' : '-1' ?>">Registrations <span class="ptab__n">(<?= count($registrations) ?>)</span></a>
      <a class="ptab" role="tab" id="tab-questions" href="/admin/?tab=questions" aria-controls="panel-questions" data-tab="questions"
        aria-selected="<?= $tab === 'questions' ? 'true' : 'false' ?>" tabindex="<?= $tab === 'questions' ? '0' : '-1' ?>">Questions <span class="ptab__n">(<?= count($questions) ?>)</span><?php if ($newQuestions > 0): ?> <span class="ptab__new"><?= $newQuestions ?> new</span><?php endif; ?></a>
      <a class="ptab" role="tab" id="tab-scholarships" href="/admin/?tab=scholarships" aria-controls="panel-scholarships" data-tab="scholarships"
        aria-selected="<?= $tab === 'scholarships' ? 'true' : 'false' ?>" tabindex="<?= $tab === 'scholarships' ? '0' : '-1' ?>">Scholarships <span class="ptab__n">(<?= count($scholarships) ?>)</span><?php if ($newScholarships > 0): ?> <span class="ptab__new"><?= $newScholarships ?> new</span><?php endif; ?></a>
    </div>

    <section class="panel" role="tabpanel" id="panel-registrations" aria-labelledby="tab-registrations" tabindex="0"<?= $tab === 'registrations' ? '' : ' hidden' ?>>
      <h2 class="wm">registrations.</h2>
      <p class="adm__sub">Waitlist and registrations · Times shown in Eastern Time.</p>
      <?php if (isset($_GET['deleted']) && $tab === 'registrations'): ?><p class="note note--ok" role="status" style="margin-top:18px">Entry deleted.</p><?php endif; ?>

      <div class="stats">
        <div class="stat"><b><?= count($registrations) ?></b><span>Sign-ups</span></div>
        <div class="stat"><b><?= count($emailCount) ?></b><span>Unique emails</span></div>
        <?php // the waitlist no longer asks these, so they only show when earlier sign-ups answered them
        foreach (['College' => 'College', 'High School' => 'High school', 'Young Professional' => 'Young professional', 'Other' => 'Other', 'volunteers' => 'Want to volunteer'] as $k => $label):
          if ($stats[$k] > 0): ?>
        <div class="stat"><b><?= $stats[$k] ?></b><span><?= h($label) ?></span></div>
        <?php endif; endforeach; ?>
      </div>

      <div class="bar">
        <p class="bar__t">Sign-ups</p>
        <div class="tools">
          <form method="get" action="/admin/" role="search">
            <input type="hidden" name="tab" value="registrations">
            <label class="sr" for="q-reg">Search registrations</label>
            <input id="q-reg" name="q" type="search" value="<?= h($q) ?>" placeholder="Search name, email, phone">
          </form>
          <a class="btn btn--sm" href="/admin/?export=registrations">Export CSV</a>
        </div>
      </div>

      <div class="tablewrap">
        <?php if (!$shownRegs): ?>
          <p class="empty"><?= $q === '' ? 'No registrations yet.' : 'Nothing matches that search.' ?></p>
        <?php else: ?>
          <table>
            <thead><tr><th>Signed up</th><th>List</th><th>Name</th><th>Email</th><th>Phone</th><th>Level</th><th>School</th><th>Volunteer</th><th><span class="sr">Actions</span></th></tr></thead>
            <tbody>
            <?php foreach ($shownRegs as $r): $d = $r['data']; $em = strtolower((string) ($d['email'] ?? '')); ?>
              <tr>
                <td><?= h(et($r['created_at'])) ?></td>
                <td><?= $r['kind'] === 'waitlist' ? 'Waitlist' : 'Registration' ?></td>
                <td><?= h(person_name($d)) ?></td>
                <td><a href="mailto:<?= h($d['email'] ?? '') ?>"><?= h($d['email'] ?? '') ?></a><?php if (($emailCount[$em] ?? 0) > 1): ?><span class="dup" title="This email registered more than once">Repeat</span><?php endif; ?></td>
                <td><?php if (($d['phone'] ?? '') !== ''): ?><a href="tel:<?= h(preg_replace('/[^0-9+]/', '', $d['phone'])) ?>"><?= h($d['phone']) ?></a><?php endif; ?></td>
                <td><?= h($d['education_level'] ?? '') ?></td>
                <td><?= h($d['school_name'] ?? '') ?></td>
                <td><?= ($d['volunteer_interest'] ?? '') === 'Yes' ? '<span class="yes">Yes</span>' : (isset($d['volunteer_interest']) ? 'No' : '–') ?></td>
                <td>
                  <form method="post" action="/admin/" onsubmit="return confirm('Delete this registration? This cannot be undone.')">
                    <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
                    <input type="hidden" name="action" value="delete">
                    <input type="hidden" name="tab" value="registrations">
                    <input type="hidden" name="id" value="<?= h($r['id']) ?>">
                    <button class="del" type="submit">Delete</button>
                  </form>
                </td>
              </tr>
            <?php endforeach; ?>
            </tbody>
          </table>
        <?php endif; ?>
      </div>

      <div class="notes" id="notes">
        <div class="bar">
          <p class="bar__t">Volunteer and partner notes (<?= count($notes) ?>)</p>
          <div class="tools"><a class="btn btn--sm" href="/admin/?export=notes">Export CSV</a></div>
        </div>
        <div class="tablewrap">
          <?php if (!$shownNotes): ?>
            <p class="empty"><?= $q === '' ? 'No volunteer or partner notes yet.' : 'Nothing matches that search.' ?></p>
          <?php else: ?>
            <table>
              <thead><tr><th>Sent</th><th>Type</th><th>Name</th><th>Email</th><th>Campus or organization</th><th><span class="sr">Actions</span></th></tr></thead>
              <tbody>
              <?php foreach ($shownNotes as $r): $d = $r['data']; ?>
                <tr>
                  <td><?= h(et($r['created_at'])) ?></td>
                  <td><?= h(ucfirst($r['kind'])) ?></td>
                  <td><?= h($d['name'] ?? '') ?></td>
                  <td><a href="mailto:<?= h($d['email'] ?? '') ?>"><?= h($d['email'] ?? '') ?></a></td>
                  <td><?= h(($d['organization'] ?? '') !== '' ? $d['organization'] : ($d['campus'] ?? '')) ?></td>
                  <td>
                    <form method="post" action="/admin/" onsubmit="return confirm('Delete this note? This cannot be undone.')">
                      <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
                      <input type="hidden" name="action" value="delete">
                      <input type="hidden" name="tab" value="registrations">
                      <input type="hidden" name="id" value="<?= h($r['id']) ?>">
                      <button class="del" type="submit">Delete</button>
                    </form>
                  </td>
                </tr>
              <?php endforeach; ?>
              </tbody>
            </table>
          <?php endif; ?>
        </div>
      </div>
    </section>

    <section class="panel" role="tabpanel" id="panel-questions" aria-labelledby="tab-questions" tabindex="0"<?= $tab === 'questions' ? '' : ' hidden' ?>>
      <h2 class="wm">questions.</h2>
      <p class="adm__sub">Sent from the FAQ · Reply by email · Times shown in Eastern Time.</p>
      <?php if (isset($_GET['deleted']) && $tab === 'questions'): ?><p class="note note--ok" role="status" style="margin-top:18px">Question deleted.</p><?php endif; ?>

      <div class="stats">
        <div class="stat"><b><?= count($questions) ?></b><span>Questions</span></div>
        <div class="stat"><b><?= $newQuestions ?></b><span>New</span></div>
        <div class="stat"><b><?= count($questions) - $newQuestions ?></b><span>Reviewed</span></div>
      </div>

      <div class="bar">
        <p class="bar__t">Newest first</p>
        <div class="tools">
          <form method="get" action="/admin/" role="search">
            <input type="hidden" name="tab" value="questions">
            <label class="sr" for="q-questions">Search questions</label>
            <input id="q-questions" name="q" type="search" value="<?= h($q) ?>" placeholder="Search name, email, question">
          </form>
          <a class="btn btn--sm" href="/admin/?export=questions">Export CSV</a>
        </div>
      </div>

      <?php if (!$shownQuestions): ?>
        <div class="tablewrap"><p class="empty"><?= $q === '' ? 'No questions yet.' : 'Nothing matches that search.' ?></p></div>
      <?php else: ?>
        <ol class="qs">
        <?php foreach ($shownQuestions as $r): $d = $r['data']; $st = q_status($d); ?>
          <li class="q q--<?= $st ?>" id="q-<?= h($r['id']) ?>">
            <div>
              <p class="q__meta"><span class="badge badge--<?= $st ?>"><?= $st === 'reviewed' ? 'Reviewed' : 'New' ?></span><time datetime="<?= h($r['created_at']) ?>"><?= h(et($r['created_at'])) ?></time></p>
              <p class="q__who"><?= h($d['name'] ?? '') ?> <span aria-hidden="true">·</span> <a href="mailto:<?= h($d['email'] ?? '') ?>?subject=<?= rawurlencode('Your question to NextGen Summit') ?>"><?= h($d['email'] ?? '') ?></a></p>
              <p class="q__text"><?= h($d['question'] ?? '') ?></p>
            </div>
            <div class="q__acts">
              <form method="post" action="/admin/">
                <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
                <input type="hidden" name="action" value="status">
                <input type="hidden" name="tab" value="questions">
                <input type="hidden" name="id" value="<?= h($r['id']) ?>">
                <input type="hidden" name="status" value="<?= $st === 'reviewed' ? 'new' : 'reviewed' ?>">
                <button class="mark" type="submit"><?= $st === 'reviewed' ? 'Mark as new' : 'Mark reviewed' ?></button>
              </form>
              <form method="post" action="/admin/" onsubmit="return confirm('Delete this question? This cannot be undone.')">
                <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
                <input type="hidden" name="action" value="delete">
                <input type="hidden" name="tab" value="questions">
                <input type="hidden" name="id" value="<?= h($r['id']) ?>">
                <button class="del" type="submit">Delete</button>
              </form>
            </div>
          </li>
        <?php endforeach; ?>
        </ol>
      <?php endif; ?>
    </section>

    <section class="panel" role="tabpanel" id="panel-scholarships" aria-labelledby="tab-scholarships" tabindex="0"<?= $tab === 'scholarships' ? '' : ' hidden' ?>>
      <h2 class="wm">scholarships.</h2>
      <p class="adm__sub">Scholarship ticket applications · 40 tickets · Times shown in Eastern Time.</p>
      <?php if (isset($_GET['deleted']) && $tab === 'scholarships'): ?><p class="note note--ok" role="status" style="margin-top:18px">Application deleted.</p><?php endif; ?>

      <div class="stats">
        <div class="stat"><b><?= count($scholarships) ?></b><span>Applications</span></div>
        <div class="stat"><b><?= $newScholarships ?></b><span>New</span></div>
        <div class="stat"><b><?= count($scholarships) - $newScholarships ?></b><span>Reviewed</span></div>
      </div>

      <div class="bar">
        <p class="bar__t">Newest first</p>
        <div class="tools">
          <form method="get" action="/admin/" role="search">
            <input type="hidden" name="tab" value="scholarships">
            <label class="sr" for="q-scholarships">Search applications</label>
            <input id="q-scholarships" name="q" type="search" value="<?= h($q) ?>" placeholder="Search name, email, school">
          </form>
          <a class="btn btn--sm" href="/admin/?export=scholarships">Export CSV</a>
        </div>
      </div>

      <?php if (!$shownScholarships): ?>
        <div class="tablewrap"><p class="empty"><?= $q === '' ? 'No applications yet.' : 'Nothing matches that search.' ?></p></div>
      <?php else: ?>
        <ol class="qs">
        <?php foreach ($shownScholarships as $r): $d = $r['data']; $st = q_status($d); ?>
          <li class="q q--<?= $st ?>" id="q-<?= h($r['id']) ?>">
            <div>
              <p class="q__meta"><span class="badge badge--<?= $st ?>"><?= $st === 'reviewed' ? 'Reviewed' : 'New' ?></span><time datetime="<?= h($r['created_at']) ?>"><?= h(et($r['created_at'])) ?></time></p>
              <p class="q__who"><?= h($d['name'] ?? '') ?> <span aria-hidden="true">·</span> <a href="mailto:<?= h($d['email'] ?? '') ?>?subject=<?= rawurlencode('Your NextGen Summit scholarship application') ?>"><?= h($d['email'] ?? '') ?></a><?php if (($d['phone'] ?? '') !== ''): ?> <span aria-hidden="true">·</span> <a href="tel:<?= h(preg_replace('/[^0-9+]/', '', $d['phone'])) ?>"><?= h($d['phone']) ?></a><?php endif; ?></p>
              <dl class="sfacts">
                <div><dt>School / College / Organization</dt><dd><?= h($d['organization'] ?? '') ?></dd></div>
                <div><dt>Why attend</dt><dd class="q__text"><?= h($d['why'] ?? '') ?></dd></div>
                <div><dt>Scholarship reason</dt><dd><?= h($d['reason'] ?? '') ?><?php if (($d['reason_other'] ?? '') !== ''): ?>: <?= h($d['reason_other']) ?><?php endif; ?></dd></div>
                <div><dt>Can commit to October 30</dt><dd><?= h($d['commit'] ?? '') ?></dd></div>
              </dl>
            </div>
            <div class="q__acts">
              <form method="post" action="/admin/">
                <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
                <input type="hidden" name="action" value="status">
                <input type="hidden" name="tab" value="scholarships">
                <input type="hidden" name="id" value="<?= h($r['id']) ?>">
                <input type="hidden" name="status" value="<?= $st === 'reviewed' ? 'new' : 'reviewed' ?>">
                <button class="mark" type="submit"><?= $st === 'reviewed' ? 'Mark as new' : 'Mark reviewed' ?></button>
              </form>
              <form method="post" action="/admin/" onsubmit="return confirm('Delete this application? This cannot be undone.')">
                <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
                <input type="hidden" name="action" value="delete">
                <input type="hidden" name="tab" value="scholarships">
                <input type="hidden" name="id" value="<?= h($r['id']) ?>">
                <button class="del" type="submit">Delete</button>
              </form>
            </div>
          </li>
        <?php endforeach; ?>
        </ol>
      <?php endif; ?>
    </section>
  </main>
  <script>
  (function () {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.ptab[role="tab"]'));
    function select(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      });
      if (focus) tab.focus();
      var params = new URLSearchParams(location.search);
      params.set('tab', tab.getAttribute('data-tab'));
      params.delete('deleted');
      history.replaceState(null, '', '/admin/?' + params.toString());
    }
    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function (e) { e.preventDefault(); select(tab, false); });
      tab.addEventListener('keydown', function (e) {
        var next = null;
        if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
        else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
        else if (e.key === 'Home') next = tabs[0];
        else if (e.key === 'End') next = tabs[tabs.length - 1];
        else if (e.key === ' ') next = tab;
        if (next) { e.preventDefault(); select(next, true); }
      });
    });
  })();
  </script>
<?php endif; ?>
</body>
</html>
