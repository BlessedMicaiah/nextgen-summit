<?php
/* NextGen Games — the only endpoint the game page talks to.
 *
 * It will tell a player about their own wallet and nothing else. Not what the room is
 * backing, not how many people are playing, not which founder is ahead. Those numbers exist
 * -- ngg_totals() computes them -- but they are reachable from exactly two places: the
 * protected admin page, and this endpoint AFTER an administrator has published them. An
 * endpoint that will not say a number cannot leak one, and hiding a figure in the browser
 * is not hiding it.
 *
 * Everything that decides whether a portfolio is legal is decided here: who the player is,
 * whether the amounts are whole and within NG$10,000, whether they name real founders, and
 * whether submissions are still open. The browser is not consulted and is not believed.
 *
 * NG$ is fictional. Nothing in this file moves money, casts a vote, or touches the People's
 * Choice tables.
 */
declare(strict_types=1);

require_once __DIR__ . '/ng-games-lib.php';
require_once __DIR__ . '/ng-games-otp.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex');

function ngg_out(int $code, array $body): void
{
    http_response_code($code);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

/* Whatever goes wrong in here, the page gets JSON back.
 *
 * Without this, an unexpected type in a request body surfaced as PHP's own HTML error page
 * with a stack trace in it, and the game's fetch() fell over parsing it -- so a malformed
 * request became a broken screen rather than a polite refusal. The detail goes to the error
 * log, where it belongs; the caller is told only that something failed. */
set_exception_handler(function (Throwable $e): void {
    error_log('NextGen Games: ' . get_class($e) . ': ' . $e->getMessage()
            . ' @ ' . $e->getFile() . ':' . $e->getLine());
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode(['ok' => false, 'reason' => 'server']);
});

/* ---------- the session ----------
   A plain PHP session under its own name, so it cannot be confused with, or confuse, the
   voter session or either admin session. The cookie is scoped to the whole site because the
   game lives at /games/ and this endpoint lives at /api/. */
$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
session_name('ngs_game');
session_set_cookie_params([
    'lifetime' => 60 * 60 * 24 * 7, 'path' => '/',
    'secure' => $https, 'httponly' => true, 'samesite' => 'Lax',
]);
session_start();

function ngg_ident(): string
{
    return (string) ($_SESSION['ngg_ident'] ?? '');
}

/* ---------- what the page is allowed to know ---------- */

function ngg_state(): array
{
    /* Every table the game will need exists by the time the first screen loads -- not at
       the first submission from a crowd, when a CREATE TABLE under a hundred phones is the
       last thing anybody wants to be doing. */
    ngg_tables();
    ngg_otp_tables();

    $ident = ngg_ident();
    $state = [
        'ok' => true,
        'game' => NGG_GAME,
        'budget' => NGG_BUDGET,
        'open' => ngg_open(),
        'revealed' => ngg_revealed(),
        'signed_in' => $ident !== '',
        'mail_ready' => pc_smtp_configured(),
        /* Only ever true on the review store, and that is decided by pc_store_is_review(),
           which wants the directory name AND a host that is not the live one AND a database
           already sitting there. */
        'demo_allowed' => pc_store_is_review(),
    ];
    if ($ident === '') {
        return $state;
    }
    $state['email_mask'] = (string) ($_SESSION['ngg_mask'] ?? '');
    $state['demo'] = !empty($_SESSION['ngg_demo']);
    $p = ngg_portfolio($ident);
    if ($p) {
        $state['submitted'] = true;
        $state['portfolio'] = $p;
        return $state;
    }
    $draft = ngg_draft($ident);
    $invested = array_sum($draft);
    $state['submitted'] = false;
    $state['draft'] = (object) $draft;          // an empty draft must serialise as {} not []
    $state['invested'] = $invested;
    $state['available'] = NGG_BUDGET - $invested;
    return $state;
}

/* ---------- requests ---------- */

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    ngg_out(200, ngg_state());
}
if ($method !== 'POST') {
    ngg_out(405, ['ok' => false, 'reason' => 'method']);
}

/* Same origin only. The page that plays this game is ours. */
$origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
if ($origin !== '') {
    $host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
    if (($p = strrpos($host, ':')) !== false && strpos($host, ']') === false) {
        $host = substr($host, 0, $p);
    }
    $from = strtolower((string) parse_url($origin, PHP_URL_HOST));
    if ($from === '' || $from !== $host) {
        ngg_out(403, ['ok' => false, 'reason' => 'origin']);
    }
}

$in = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($in)) {
    $in = $_POST;
}
$action = is_string($in['action'] ?? null) ? $in['action'] : '';

/* An allocation has to BE an allocation.
 *
 * `"alloc": null` used to coalesce to [] and lock in a portfolio with nothing in it. For a
 * draft that would be forgettable; for a submission it is irreversible, and an irreversible
 * action should never be the thing a malformed body falls through to. The field must be
 * present and must be a map. */
function ngg_alloc_in(array $in): array
{
    if (!array_key_exists('alloc', $in) || !is_array($in['alloc'])) {
        ngg_out(400, ['ok' => false, 'reason' => 'shape']);
    }
    return $in['alloc'];
}

/* No per-IP brake on this endpoint, and that is deliberate. The one it borrowed from the
   vote endpoint counts rows in the registrations table from this address -- waitlist,
   volunteer, Speaker Q&A questions -- and the venue is one address. Sixty questions sent
   from the room in five minutes would have switched the game off for everybody in it.
   Sign-in has its own limits in ng-games-otp.php; everything else here needs a session. */

switch ($action) {

    /* ---- sign in ---- */

    case 'otp-start': {
        $email = is_string($in['email'] ?? null) ? $in['email'] : '';
        $r = ngg_otp_start($email);
        ngg_out($r['ok'] ? 200 : 400, $r);
    }

    case 'otp-check': {
        $email = is_string($in['email'] ?? null) ? $in['email'] : '';
        $code = is_string($in['code'] ?? null) ? $in['code'] : (string) ($in['code'] ?? '');
        $r = ngg_otp_check($email, $code);
        if (!$r['ok']) {
            ngg_out(400, $r);
        }
        /* A new identity in an old session must not inherit the old one's anything. */
        session_regenerate_id(true);
        $_SESSION['ngg_ident'] = $r['ident'];
        $_SESSION['ngg_mask'] = $r['mask'];
        $_SESSION['ngg_demo'] = false;
        ngg_player_seen($r['ident'], $email, false);
        ngg_out(200, ngg_state());
    }

    /* ---- a way in while the review site is being reviewed ----
       Never reachable on the live site: pc_store_is_review() wants the review data
       directory AND a host that is not nextgensummit.us AND a database already in place.
       The identity is random, so it cannot be used to reach anybody else's wallet. */
    case 'demo-signin': {
        if (!pc_store_is_review()) {
            ngg_out(403, ['ok' => false, 'reason' => 'not_available']);
        }
        session_regenerate_id(true);
        $_SESSION['ngg_ident'] = 'demo:' . bin2hex(random_bytes(12));
        $_SESSION['ngg_mask'] = 'staging demo player';
        $_SESSION['ngg_demo'] = true;
        ngg_player_seen($_SESSION['ngg_ident'], null, true);
        ngg_out(200, ngg_state());
    }

    case 'sign-out': {
        $_SESSION = [];
        session_destroy();
        ngg_out(200, ['ok' => true, 'signed_out' => true]);
    }

    case 'state': {
        ngg_out(200, ngg_state());
    }

    /* ---- the wallet ---- */

    case 'save-draft': {
        $ident = ngg_ident();
        if ($ident === '') {
            ngg_out(401, ['ok' => false, 'reason' => 'signed_out']);
        }
        if (ngg_portfolio($ident)) {
            ngg_out(409, ['ok' => false, 'reason' => 'already_submitted']);
        }
        $v = ngg_validate(ngg_alloc_in($in));
        if (!$v['ok']) {
            ngg_out(400, ['ok' => false, 'reason' => $v['reason']]);
        }
        ngg_draft_save($ident, $v['alloc']);
        ngg_out(200, ['ok' => true, 'alloc' => (object) $v['alloc'],
                      'invested' => $v['invested'], 'available' => $v['unspent']]);
    }

    case 'submit': {
        $ident = ngg_ident();
        if ($ident === '') {
            ngg_out(401, ['ok' => false, 'reason' => 'signed_out']);
        }
        /* Closed means no NEW portfolio. Somebody who already submitted still gets theirs
           back from `state`, which is why this check sits after the already-submitted
           branch inside ngg_submit() rather than in front of everything. */
        $existing = ngg_portfolio($ident);
        if (!$existing && !ngg_open()) {
            ngg_out(403, ['ok' => false, 'reason' => 'closed']);
        }
        $r = ngg_submit($ident, ngg_alloc_in($in), !empty($_SESSION['ngg_demo']));
        if (!$r['ok']) {
            ngg_out(400, $r);
        }
        ngg_out(200, ['ok' => true, 'already' => $r['already'],
                      'portfolio' => $r['portfolio'], 'submitted' => true]);
    }

    /* ---- the room's totals, if and only if they have been published ---- */

    case 'standings': {
        if (!ngg_revealed()) {
            ngg_out(403, ['ok' => false, 'reason' => 'not_revealed']);
        }
        $t = ngg_totals();
        ngg_out(200, ['ok' => true, 'revealed' => true, 'standings' => ngg_standings(),
                      'submitted' => $t['submitted'], 'invested' => $t['invested']]);
    }
}

ngg_out(400, ['ok' => false, 'reason' => 'action']);
