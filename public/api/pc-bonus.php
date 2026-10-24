<?php
/* People's Choice — the attendee bonus endpoint.

   Four actions, and every one of them requires a phone-verified voting session:

     status  what this voter is entitled to today
     lookup  is there an eligible registration for this email, and send a code to it
     check   verify that code and bind the registration to this voter
     claim   award the two extra points, which the voter asks for explicitly

   WHY THE LOOKUP IS NOT PUBLIC

   "Is this address registered?" is a question about somebody else's life, and an endpoint that
   answers it for anyone who asks is a way to test a list of addresses against an attendee
   list. So it is only reachable from a session that has already verified a phone number and
   cast a vote. A verified voter asking about their own address is a different question from
   the open one, and only the first is answered here.

   WHY VERIFICATION DOES NOT AWARD ANYTHING

   check binds the registration and stops. The points come from claim, which the voter presses.
   Confirming a registration is not the same as asking for points, and the difference matters
   on a screen where someone may be deciding whether to use them today at all. */
declare(strict_types=1);

require_once __DIR__ . '/pc-attendee.php';
/* pc_canonical() lives in pc-identity.php, and this file called it without loading it.

   The call sits immediately below the 401 gate, so an unauthenticated request returned before
   reaching it and every probe looked healthy -- while every real verified voter got an
   undefined function, a fatal, a 500 with an HTML body, and a screen that said we could not
   reach Eventbrite. pc-otp.php and pc-vote.php both reach the same function, which is why
   verifying and voting worked throughout; they get it by way of pc-email-otp.php, and both of
   them guard the call with function_exists() anyway. This one did neither. */
require_once __DIR__ . '/pc-identity.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

/** Staging and local only. Production says nothing about its internals. */
function pcb_preview_host(): bool
{
    $h = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
    return strpos($h, 'staging.') === 0 || strpos($h, 'localhost') === 0
        || strpos($h, '127.0.0.1') === 0;
}

function pcb_out(int $code, array $body): void
{
    http_response_code($code);
    echo json_encode($body);
    exit;
}

pc_session_begin();      // same parameters as every other endpoint, by construction

$raw = file_get_contents('php://input');
$in = is_string($raw) && $raw !== '' ? json_decode($raw, true) : null;
if (!is_array($in)) {
    $in = $_POST;
}
$action = is_string($in['action'] ?? null) ? $in['action'] : '';

/* Same-origin, same as the OTP endpoint. */
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '') {
    $host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
    if (($p = strpos($host, ':')) !== false) {
        $host = substr($host, 0, $p);
    }
    if (strtolower((string) parse_url($origin, PHP_URL_HOST)) !== $host) {
        pcb_out(403, ['ok' => false, 'reason' => 'origin']);
    }
}

/* The gate: a phone-verified voter, or nothing. */
$fresh = !empty($_SESSION['phone_key']) && !empty($_SESSION['verified_at'])
    && time() - (int) $_SESSION['verified_at'] <= 2592000;
if (!$fresh) {
    pcb_out(401, ['ok' => false, 'reason' => 'verify_required']);
}
$voter = pc_canonical((string) $_SESSION['phone_key']);   // resolved now, as the vote path does

if ($action !== 'status') {
    $tok = (string) ($in['csrf'] ?? '');
    if ($tok === '' || !hash_equals((string) ($_SESSION['csrf'] ?? ''), $tok)) {
        pcb_out(403, ['ok' => false, 'reason' => 'csrf']);
    }
}

/**
 * Record, for the dashboard, that this identity holds a proven registration.
 *
 * Called only after pc_attendee_bind() has succeeded. That ordering is the whole point: a
 * name is written because a registration was bound to this voter, never because an address
 * happened to appear in the attendee list.
 *
 * A missing name is left missing. Eventbrite does not always have one, and older cached
 * indexes have none at all; "registered, name unknown" is a true statement and an invented
 * name is not.
 *
 * @param array{first:string,last:string}|null $name
 */
function pcb_note_registration(string $voter, ?array $name): void
{
    $f = ['eb_status' => 'registered'];
    if (is_array($name)) {
        $f['eb_first'] = (string) ($name['first'] ?? '');
        $f['eb_last'] = (string) ($name['last'] ?? '');
    }
    pc_voter_note($voter, $f);
}

/** What this voter has and has used today. */
function pcb_state(string $voter): array
{
    $verified = pc_attendee_verified($voter);
    $allow = pc_allowance($verified);
    $used = pc_used($voter);
    return [
        'attendee_verified' => $verified,
        'allowance' => $allow,
        'used' => $used,
        'remaining' => max(0, $allow - $used),
        'mode' => pc_mode(),
        'next_window' => pc_next_window(),
        'open' => pc_voting_open(),
    ];
}

/** The founder this voter backed today; the bonus follows the vote rather than the request. */
function pcb_today_entrant(string $voter): ?string
{
    $db = pc_db();
    if (!$db) {
        return null;
    }
    $day = pc_mode() === 'daily' ? pc_day() : 'all';
    $s = $db->prepare('SELECT entrant_id FROM pc_votes
                       WHERE competition = ? AND voter_key = ? AND vote_day = ? AND valid = 1
                       ORDER BY slot ASC LIMIT 1');
    $s->execute([PC_COMPETITION, $voter, $day]);
    $r = $s->fetch();
    return $r ? (string) $r['entrant_id'] : null;
}

if ($action === 'status') {
    pcb_out(200, ['ok' => true] + pcb_state($voter));
}

/* The automatic check.

   Someone who verified their email to vote has already proven they own that inbox. Asking
   them to prove the same inbox again before handing over a bonus is a step that establishes
   nothing and loses people. So this matches the address they ALREADY proved against the
   Eventbrite attendee list and, if it is there, binds the entitlement without a second code.

   A code is still required in exactly one case: when the registration is under a different
   address, because then ownership of THAT address has not been proven. That distinction is
   the whole security argument and is worth keeping clear.

   It never awards anything. It reports what is possible; the points come from claim. */
if ($action === 'auto') {
    $st = pcb_state($voter);
    if ($st['attendee_verified']) {
        pcb_out(200, ['ok' => true, 'status' => 'verified'] + $st);
    }
    $keys = isset($_SESSION['email_keys']) && is_array($_SESSION['email_keys'])
        ? $_SESSION['email_keys'] : [];
    if ($keys === []) {
        // a phone-verified voter has proven no address, so there is nothing to match on
        pcb_out(200, ['ok' => true, 'status' => 'no_email'] + $st);
    }
    $hit = pc_eb_lookup_keys($keys);
    if ($hit['unavailable']) {
        /* Not the same thing as "not registered", and must never be reported as such: a
           registered attendee told they are not registered will not come back.

           On a preview host say WHY. This screen reported an outage for weeks while the real
           fault was an undefined constant fataling the request, and there was no log on this
           host to say otherwise. The code names the failure and nothing else -- no token, no
           address, no attendee. */
        $out = ['ok' => true, 'status' => 'unavailable'] + $st;
        if (pcb_preview_host()) {
            $out['eb'] = pc_eb_note();
        }
        pcb_out(200, $out);
    }
    if (!$hit['found']) {
        $out = ['ok' => true, 'status' => 'not_registered'] + $st;
        if (pcb_preview_host()) {
            $out['eb'] = pc_eb_note();     // e.g. "ok:185" -- the list was read, the address is not in it
        }
        pcb_out(200, $out);
    }
    $owner = pc_attendee_owner((string) $hit['attendee_key']);
    if ($owner !== null && $owner !== $voter) {
        pcb_out(200, ['ok' => true, 'status' => 'claimed_elsewhere'] + $st);
    }
    $bind = pc_attendee_bind((string) $hit['attendee_key'], $voter, $keys[0]);
    if (!$bind['ok']) {
        pcb_out(200, ['ok' => true, 'status' => 'claimed_elsewhere'] + $st);
    }
    pc_flag($voter, 'attendee_auto_matched');
    /* The registration is now bound to this identity, so the registered name is this voter's
       and the dashboard may show it. Before the binding it was only a matching address in a
       list, which is not the same claim. */
    pcb_note_registration($voter, $hit['name'] ?? null);
    pcb_out(200, ['ok' => true, 'status' => 'verified'] + pcb_state($voter));
}

if ($action === 'lookup') {
    if (pc_attendee_verified($voter)) {
        pcb_out(200, ['ok' => true, 'already' => true] + pcb_state($voter));
    }
    $email = trim((string) ($in['email'] ?? ''));
    if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        pcb_out(400, ['ok' => false, 'reason' => 'email']);
    }
    $hit = pc_eb_lookup($email);
    if ($hit['unavailable']) {
        pcb_out(503, ['ok' => false, 'reason' => 'unavailable']);
    }
    if (!$hit['found']) {
        pcb_out(404, ['ok' => false, 'reason' => 'not_found']);
    }
    /* Taken by somebody else: say so plainly rather than sending a code that can never be
       used. It reveals nothing about who -- only that this registration is already spoken for. */
    $owner = pc_attendee_owner((string) $hit['attendee_key']);
    if ($owner !== null && $owner !== $voter) {
        pcb_out(409, ['ok' => false, 'reason' => 'claimed']);
    }
    $send = pc_email_code_send($voter, $email, (string) $hit['attendee_key']);
    if (!$send['ok']) {
        $out = ['ok' => false, 'reason' => $send['reason']];
        /* This host keeps no error log, so a delivery failure here was a dead end: the modal
           said "could not send" and the detail went nowhere. On a preview host the SMTP step
           and code come back, naming the fault without naming the credentials. */
        $h = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
        if (strpos($h, 'staging.') === 0 || strpos($h, 'localhost') === 0) {
            if (isset($send['mail_step'])) { $out['mail_step'] = $send['mail_step']; }
            if (!empty($send['mail_code'])) { $out['mail_code'] = $send['mail_code']; }
        }
        pcb_out($send['reason'] === 'too_many' ? 429 : 502, $out);
    }
    pcb_out(200, ['ok' => true, 'sent' => true]);
}

if ($action === 'check') {
    $res = pc_email_code_check($voter, (string) ($in['code'] ?? ''));
    if (!$res['ok']) {
        pcb_out(400, ['ok' => false, 'reason' => $res['reason'],
                      'tries_left' => $res['tries_left'] ?? null]);
    }
    $bind = pc_attendee_bind((string) $res['attendee_key'], $voter, (string) $res['email_key']);
    if (!$bind['ok']) {
        pcb_out(409, ['ok' => false, 'reason' => $bind['reason'] ?? 'claimed']);
    }
    /* Same binding, reached by proving the address rather than by an automatic match. The
       name comes from the index under the key that was just proved. */
    pcb_note_registration($voter, pc_eb_name(pc_eb_email_index(), (string) $res['email_key']));
    /* Bound, and deliberately nothing else. The points are a separate, explicit request. */
    pcb_out(200, ['ok' => true, 'verified' => true] + pcb_state($voter));
}

if ($action === 'claim') {
    if (!pc_attendee_verified($voter)) {
        pcb_out(403, ['ok' => false, 'reason' => 'not_verified']);
    }
    if (!pc_voting_open()) {
        pcb_out(409, ['ok' => false, 'reason' => 'closed']);
    }
    $entrant = pcb_today_entrant($voter);
    if ($entrant === null) {
        pcb_out(409, ['ok' => false, 'reason' => 'vote_first']);
    }
    $before = pcb_state($voter);
    if ($before['remaining'] <= 0) {
        pcb_out(409, ['ok' => false, 'reason' => 'spent'] + $before);
    }

    /* Each point is its own row, claimed by INSERT inside a transaction against the unique
       index -- the same mechanism the first vote uses. A double submission loses the race for
       the slot rather than being counted twice, so no separate guard is needed. */
    $awarded = 0;
    for ($i = 0; $i < 2; $i++) {
        $r = pc_cast($voter, $entrant, false, true);
        if (!$r['ok']) {
            break;
        }
        $awarded++;
    }
    $after = pcb_state($voter);
    if ($awarded === 0) {
        pcb_out(409, ['ok' => false, 'reason' => 'spent'] + $after);
    }
    pcb_out(200, ['ok' => true, 'awarded' => $awarded, 'entrant' => $entrant] + $after);
}

pcb_out(400, ['ok' => false, 'reason' => 'action']);
