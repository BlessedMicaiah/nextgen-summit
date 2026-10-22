<?php
/* The staging gate.

   WHY THIS EXISTS BEFORE THE ALLOWLIST CAN GO

   The per-number allowlist was never really about numbers. It was the only thing standing
   between an anonymous request to /api/pc-otp.php and a real text message, because the staging
   site is served to anyone who knows the address and the endpoint answers anyone who asks.
   Measured rather than assumed: before this file existed, an unauthenticated caller could
   fetch a CSRF token and post a start request, and the only thing that refused it was the
   allowlist.

   So dropping the allowlist needs something else in that position first. This is it: the
   staging site asks who you are, and the voting endpoints refuse anyone who has not answered.

   WHAT IT CHECKS

   The same rotated admin credential the dashboard uses. No second password to distribute, to
   rotate, or to paste into a group chat -- there is one staging credential and the people who
   should be testing already have it. The session is its own, at path / so it covers both the
   page and /api/, and it carries the admin epoch, so rotating the PIN closes this too.

   WHERE IT APPLIES

   Staging and localhost only. On production this file is inert: ngs_staging_gate_active()
   returns false, nothing is gated, and nothing about the live site changes. The waiver that
   replaces the allowlist is tied to the same test, so production can never waive it. */
declare(strict_types=1);

require_once __DIR__ . '/pc-admin-pin.php';

/** Is this one of the hosts the gate governs? */
function ngs_staging_gate_active(): bool
{
    $host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
    return strpos($host, 'staging.') === 0
        || strpos($host, 'localhost') === 0
        || strpos($host, '127.0.0.1') === 0;
}

function ngs_staging_gate_start(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    session_name('ngs_stg');
    session_set_cookie_params([
        'lifetime' => 0, 'path' => '/',       // the page AND the endpoints under /api/
        'secure' => $https, 'httponly' => true, 'samesite' => 'Lax',
    ]);
    session_start();
}

/* Has this visitor answered the gate? True everywhere the gate does not apply.

   READ, THEN GET OUT OF THE WAY. PHP holds one session per request, and the endpoints behind
   this gate open their own -- ngs_pc_voter, at the same path. If this one stayed open, the
   voter session would never start and verification would break for everyone, gate or no gate.
   So the answer is read once, cached for the rest of the request, and the session closed
   again before anything else needs one. */
function ngs_staging_gate_ok(): bool
{
    static $ok = null;
    if ($ok !== null) {
        return $ok;
    }
    if (!ngs_staging_gate_active()) {
        return $ok = true;
    }
    $had = session_status() === PHP_SESSION_ACTIVE;
    $prev = $had ? session_name() : '';
    if ($had) {
        session_write_close();
    }
    ngs_staging_gate_start();
    $ok = !empty($_SESSION['stg_ok'])
        && (int) ($_SESSION['stg_at'] ?? 0) > time() - 12 * 3600
        && (int) ($_SESSION['stg_epoch'] ?? 0) === pc_admin_epoch();
    session_write_close();
    if ($had && $prev !== '') {
        session_name($prev);          // leave the caller's session name as we found it
    }
    return $ok;
}

/**
 * For the endpoints. Refuses with JSON rather than a login page, because a fetch() has no use
 * for HTML, and says plainly what is wrong so an admin whose session lapsed is not left
 * guessing at a generic failure.
 */
function ngs_staging_gate_require(): void
{
    if (ngs_staging_gate_ok()) {
        return;
    }
    http_response_code(401);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'ok' => false,
        'reason' => 'staging_locked',
        'message' => 'This staging preview is for NextGen administrators. Open the voting page and sign in first.',
    ]);
    exit;
}

/**
 * Is the per-number allowlist waived for this request?
 *
 * Only on a gated host, and only for somebody who has actually passed the gate. The allowlist
 * still fails closed everywhere else, so production is unaffected and a staging visitor who
 * has not signed in gets exactly the refusal they got before.
 */
function ngs_sms_allowlist_waived(): bool
{
    return ngs_staging_gate_active() && ngs_staging_gate_ok();
}

function ngs_staging_gate_csrf(): string
{
    ngs_staging_gate_start();
    if (empty($_SESSION['stg_csrf'])) {
        $_SESSION['stg_csrf'] = bin2hex(random_bytes(16));
    }
    return (string) $_SESSION['stg_csrf'];
}

/**
 * Handle a sign-in post. Returns a message to show, or '' when there is nothing to say.
 * Same five tries and same two-second pause as the dashboard, so this is not a softer way at
 * the same credential.
 */
function ngs_staging_gate_post(): string
{
    if (!ngs_staging_gate_active()) {
        return '';
    }
    ngs_staging_gate_start();
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || ($_POST['action'] ?? '') !== 'stgin') {
        return '';
    }
    if (!hash_equals((string) ($_SESSION['stg_csrf'] ?? ''), (string) ($_POST['csrf'] ?? ''))) {
        return 'That form expired. Please try again.';
    }
    $until = (int) ($_SESSION['stg_locked'] ?? 0);
    if ($until > time()) {
        return 'Too many attempts. Try again in ' . ceil(($until - time()) / 60) . ' minutes.';
    }
    if (pc_admin_check(is_string($_POST['password'] ?? null) ? $_POST['password'] : '')) {
        session_regenerate_id(true);
        $_SESSION['stg_ok'] = true;
        $_SESSION['stg_at'] = time();
        $_SESSION['stg_epoch'] = pc_admin_epoch();
        $_SESSION['stg_tries'] = 0;
        header('Location: ./', true, 303);
        exit;
    }
    $tries = (int) ($_SESSION['stg_tries'] ?? 0) + 1;
    $_SESSION['stg_tries'] = $tries;
    if ($tries >= 5) {
        $_SESSION['stg_locked'] = time() + 900;
        $_SESSION['stg_tries'] = 0;
    }
    sleep(2);
    return 'That password did not match.';
}

/** The sign-in page itself, in the NextGen dark. Nothing of the voting page is sent with it. */
function ngs_staging_gate_page(string $notice): void
{
    $csrf = ngs_staging_gate_csrf();
    $h = function ($v) { return htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8'); };
    header('Content-Type: text/html; charset=utf-8');
    header('X-Robots-Tag: noindex, nofollow, noarchive');
    header('Cache-Control: no-store');
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
        . '<title>Staging preview &middot; NextGen Summit</title>'
        . '<meta name="robots" content="noindex, nofollow">'
        . '<link rel="icon" href="/favicon.svg" type="image/svg+xml">'
        . '<link rel="preconnect" href="https://fonts.googleapis.com">'
        . '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
        . '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@144,900,100,0&amp;family=Montserrat:wght@500;600;700;800&amp;display=swap">'
        . '<link rel="stylesheet" href="/assets/css/site.css?v=20261022-08">'
        . '<link rel="stylesheet" href="/assets/css/finalists.css?v=20261022-08">'
        . '</head><body><main class="fgate"><div class="fgate__in">'
        . '<p class="fgate__eyebrow">NextGen Summit</p>'
        . '<h1 class="fgate__title wm">staging.</h1>'
        . '<p class="fgate__p">This preview sends real text messages, so it is limited to the '
        . 'NextGen team. Sign in with the staging password to continue.</p>'
        . ($notice !== '' ? '<p class="fgate__notice">' . $h($notice) . '</p>' : '')
        . '<form method="post" class="fgate__form">'
        . '<input type="hidden" name="csrf" value="' . $h($csrf) . '">'
        . '<input type="hidden" name="action" value="stgin">'
        . '<label class="fgate__label" for="pw">Staging password</label>'
        . '<input class="fgate__input" id="pw" name="password" type="password" '
        . 'autocomplete="current-password" required autofocus>'
        . '<button class="fgate__btn" type="submit">Enter the preview</button>'
        . '</form></div></main></body></html>';
    exit;
}
