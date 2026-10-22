<?php
/* The preview gate in front of the Top 10 Finalists page.

   WHY A GATE AND NOT A HIDDEN URL

   An unlisted page is not a private one. It is one forwarded link, one shared screenshot, one
   address bar in a meeting room away from being public, and what is behind this one is the
   identity of founders who have not been announced. "Not merely hidden from navigation" is the
   requirement, and an unguessable path does not meet it.

   WHY NO NEW PASSWORD

   It reuses the admin credential the dashboard already uses -- the rotated one in the data
   directory, outside the web root. A second secret would be a second thing to rotate, a second
   thing to lose, and a second thing to paste into a chat window. There is already exactly one
   credential for staging and this is it.

   The session is its own: a separate cookie name, scoped to this page's path, so being let in
   here is not being let into the results dashboard, and vice versa. It carries the same epoch,
   so rotating the PIN signs this preview out too.

   WHEN THE PAGE IS PUBLISHED

   Set NGS_FINALISTS_PUBLIC to true in this file and the gate steps aside, but only for
   finalists whose status is 'published'. Internal ones stay behind it either way. That is the
   switch leadership's approval turns, and it is deliberately not reachable from a browser. */
declare(strict_types=1);

require_once __DIR__ . '/pc-admin-pin.php';

/* Not yet. While this is false the page is private, whatever a finalist's own status says. */
const NGS_FINALISTS_PUBLIC = false;

function ngs_fin_gate_start(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    session_name('ngs_fin_preview');
    session_set_cookie_params([
        'lifetime' => 0, 'path' => '/pitch/finalists/',
        'secure' => $https, 'httponly' => true, 'samesite' => 'Lax',
    ]);
    session_start();
}

/** Is this visitor allowed to see unannounced finalists? */
function ngs_fin_allowed(): bool
{
    ngs_fin_gate_start();
    return !empty($_SESSION['fin_ok'])
        && (int) ($_SESSION['fin_at'] ?? 0) > time() - 8 * 3600
        && (int) ($_SESSION['fin_epoch'] ?? 0) === pc_admin_epoch();
}

/**
 * Handle a sign-in attempt and report what to tell the visitor.
 *
 * The same five-tries-then-wait as the dashboard, and the same two second pause on a wrong
 * answer, so this page is not a softer way at the same credential.
 */
function ngs_fin_gate_post(): string
{
    ngs_fin_gate_start();
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || ($_POST['action'] ?? '') !== 'preview') {
        return '';
    }
    $tok = (string) ($_POST['csrf'] ?? '');
    if ($tok === '' || !hash_equals((string) ($_SESSION['fin_csrf'] ?? ''), $tok)) {
        return 'That form expired. Please try again.';
    }
    $until = (int) ($_SESSION['fin_locked'] ?? 0);
    if ($until > time()) {
        return 'Too many attempts. Try again in ' . ceil(($until - time()) / 60) . ' minutes.';
    }
    $pw = is_string($_POST['password'] ?? null) ? $_POST['password'] : '';
    if (pc_admin_check($pw)) {
        session_regenerate_id(true);
        $_SESSION['fin_ok'] = true;
        $_SESSION['fin_at'] = time();
        $_SESSION['fin_epoch'] = pc_admin_epoch();
        $_SESSION['fin_tries'] = 0;
        header('Location: ./', true, 303);
        exit;
    }
    $tries = (int) ($_SESSION['fin_tries'] ?? 0) + 1;
    $_SESSION['fin_tries'] = $tries;
    if ($tries >= 5) {
        $_SESSION['fin_locked'] = time() + 900;
        $_SESSION['fin_tries'] = 0;
    }
    sleep(2);
    return 'That password did not match.';
}

function ngs_fin_csrf(): string
{
    ngs_fin_gate_start();
    if (empty($_SESSION['fin_csrf'])) {
        $_SESSION['fin_csrf'] = bin2hex(random_bytes(16));
    }
    return (string) $_SESSION['fin_csrf'];
}

/**
 * Which finalists this visitor may actually see.
 *
 * Behind the gate: everything, with the unannounced ones marked as such.
 * In front of it: published ones only, and only once the page itself is public. Everything
 * else is reduced to an anonymous placeholder -- not hidden from the layout, but carrying no
 * name, no venture, no portrait and no video. The data never reaches the page, so there is
 * nothing to find in the markup either.
 */
function ngs_fin_visible(array $finalists, bool $allowed): array
{
    if ($allowed) {
        return $finalists;
    }
    $out = [];
    foreach ($finalists as $f) {
        if (NGS_FINALISTS_PUBLIC && !empty($f['published'])) {
            $out[] = $f;
            continue;
        }
        $out[] = [
            'id' => $f['id'],
            'n' => $f['n'],
            'confirmed' => false,
            'status' => 'placeholder',
            'published' => false,
            'reserved' => $f['reserved'],
            'first' => 'Finalist', 'last' => $f['n'],
            'name' => 'Finalist ' . $f['n'],
            'venture' => 'To be announced',
            'category' => '', 'summary' => '', 'bio' => '', 'shot' => '',
            'video' => null,
        ];
    }
    return $out;
}
