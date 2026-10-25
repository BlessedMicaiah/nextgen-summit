<?php
/* People's Choice — the phone verification endpoint and the voter session.

   Three things happen here and nowhere else:
     start   a number is normalised, rate-limited and sent a code
     check   a code is confirmed, and a voting session begins
     status  what the server believes about the caller right now

   The session is the point of the whole exercise. Once a number is verified the voter gets a
   signed, httpOnly cookie, and the server recognises them on the way back without sending
   another message. A returning voter costs nothing. That is the difference between a bill of
   one message per voter and one per vote.

   WHAT THE BROWSER IS NEVER TRUSTED WITH: whether it is verified, whose number it holds, how
   many votes it has left. All of that is read from the session on the server, every time. The
   cookie carries an opaque session id and nothing else. */
declare(strict_types=1);

require __DIR__ . '/pc-twilio.php';
require_once __DIR__ . '/pc-attendee.php';   // the verified-attendee entitlement
require_once __DIR__ . '/pc-email-otp.php';  // the email channel

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function pc_json(int $code, array $body): void
{
    http_response_code($code);
    echo json_encode($body);
    exit;
}

/* The voter's session. Its own name and its own path, so it is nothing to do with the admin
   session and cannot be used in its place. SameSite=Lax rather than Strict on purpose: a
   voter following a contestant's shared link from WhatsApp arrives as a cross-site navigation,
   and Strict would drop the cookie and ask them to verify again. Lax keeps top-level
   navigations working while still refusing cross-site POSTs, and the CSRF token covers the
   rest. */
/* Opened in pc-lib.php, where the lifetime and the collector's idea of it are set together
   and cannot disagree with the other two endpoints that share this session. */
pc_session_begin();

if (empty($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(16));
}

/* A verified session is good until voting closes, or thirty days, whichever comes first. The
   voter should not be asked again tomorrow; they should be asked again if the session is old
   enough to have been left on a shared machine. */
/* PC_SESSION_MAX_AGE now lives in pc-lib.php, beside the cookie and collector settings
   that have to honour it. */

function pc_session_verified(): bool
{
    if (empty($_SESSION['phone_key']) || empty($_SESSION['verified_at'])) {
        return false;
    }
    if (time() - (int) $_SESSION['verified_at'] > PC_SESSION_MAX_AGE) {
        return false;
    }
    $cut = pc_deadline_ts();
    if ($cut !== null && time() >= $cut) {
        return true;        // still recognised; voting being shut is a separate matter
    }
    return true;
}

/* Resolved on every read, not frozen at verification.

   Linking two identities MOVES the losing side's votes onto the survivor. A session opened
   before that merge still holds the old key, so counting its allowance under that key found
   nothing and would have handed the same person a second vote for the day -- the link
   intended to close the duplicate-vote hole would have opened a narrower one. Asking who this
   key belongs to NOW costs one indexed lookup and removes the whole class of problem. */
function pc_session_key(): ?string
{
    if (!pc_session_verified()) {
        return null;
    }
    return function_exists('pc_canonical')
        ? pc_canonical((string) $_SESSION['phone_key'])
        : (string) $_SESSION['phone_key'];
}

function pc_csrf_ok(array $in): bool
{
    $t = (string) ($in['csrf'] ?? ($_POST['csrf'] ?? ''));
    return $t !== '' && hash_equals((string) ($_SESSION['csrf'] ?? ''), $t);
}

/* ---------- what the caller is allowed to know about themselves ---------- */
/* Everything the interface needs to decide what this voter can do next, in one answer.

   It used to report only whether a phone was verified, and the page filled in the rest from a
   sessionStorage note it had written itself. That is how a returning voter ended up staring at
   a dead end: the browser remembered casting a vote, routed to "you have already voted", and
   never asked the server whether anything else was still available to them. The server knew
   they had two bonus points waiting. Nobody asked it.

   So the state is computed here now, and the page renders whatever this says. */
function pc_me(): array
{
    $verified = pc_session_verified();
    $key = pc_session_key();
    /* The attendee entitlement is a row in pc_attendee, written only after an emailed code
       proved the registration belongs to this voter. It used to be read from a session flag
       that nothing ever set, so a verified attendee was reported as having an allowance of
       one and the extra two were invisible to the interface. */
    $ticket = $verified && $key !== null
        && function_exists('pc_attendee_verified') && pc_attendee_verified($key);
    $out = [
        'ok' => true,
        'verified' => $verified,
        'csrf' => (string) $_SESSION['csrf'],
        'mode' => pc_mode(),
        'state' => pc_state(),
        'open' => pc_voting_open(),
        'deadline' => pc_deadline_iso(),
        'sms' => pc_twilio_live() ? 'live' : 'mock',
        'email_ready' => pc_smtp_configured(),
        'channel' => (string) ($_SESSION['channel'] ?? ''),
        /* Which rule is in force. The interface must not infer this: under the original rule
           a voter who has voted today can do nothing more, and under the flexible one they
           may still have two votes to place anywhere. Those are opposite instructions for
           the same button, so the server says which. */
        'spread' => pc_spread_votes(),
    ];
    if ($verified && $key !== null) {
        $out['phone'] = isset($_SESSION['phone_mask']) ? (string) $_SESSION['phone_mask'] : '****';
        $out['allowance'] = pc_allowance($ticket);
        $out['used'] = pc_used($key);
        $out['remaining'] = pc_remaining($key, $ticket);
        $out['next_window'] = pc_next_window();
        $out['ticket_verified'] = $ticket;

        /* Which founder today's vote went to. The bonus follows that choice and cannot be
           pointed somewhere else, so the page needs to know it to tell a voter who wanders to
           a different contestant what has already happened. */
        $out['today_entrant'] = pc_today_entrant($key);

        /* The two questions the interface actually asks, answered here rather than inferred
           from arithmetic that is easy to get wrong.

           bonus_eligible is NOT "remaining > 0". A voter who has cast their one phone point
           has nothing remaining at their current tier, and is exactly the person with two
           points waiting behind a registration check. Reading remaining alone is what made
           the old screen say "that is your lot" to someone who still had two to give. */
        $out['bonus_eligible'] = pc_mode() === 'daily' && !$ticket && pc_voting_open();
        $out['bonus_claimable'] = $ticket && pc_voting_open()
            && $out['remaining'] > 0 && $out['today_entrant'] !== null;
    }
    return $out;
}

/** The founder this voter backed today, or null. */
function pc_today_entrant(?string $voterKey): ?string
{
    if ($voterKey === null) {
        return null;
    }
    $db = pc_db();
    if (!$db) {
        return null;
    }
    $day = pc_mode() === 'daily' ? pc_day() : 'all';
    $s = $db->prepare('SELECT entrant_id FROM pc_votes
                       WHERE competition = ? AND voter_key = ? AND vote_day = ? AND valid = 1
                       ORDER BY slot ASC LIMIT 1');
    $s->execute([PC_COMPETITION, $voterKey, $day]);
    $r = $s->fetch();
    return $r ? (string) $r['entrant_id'] : null;
}

$raw = (string) file_get_contents('php://input');
$in = json_decode($raw, true);
if (!is_array($in)) {
    $in = $_POST;
}
$action = (string) ($in['action'] ?? ($_GET['action'] ?? 'status'));

/* status is a read and needs no token; everything that changes something does. */
if ($action === 'status') {
    pc_json(200, pc_me());
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    pc_json(405, ['ok' => false, 'reason' => 'method']);
}

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '') {
    $host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
    if (($p = strrpos($host, ':')) !== false && strpos($host, ']') === false) {
        $host = substr($host, 0, $p);
    }
    if (strtolower((string) parse_url($origin, PHP_URL_HOST)) !== $host) {
        pc_json(403, ['ok' => false, 'reason' => 'origin']);
    }
}

if (!pc_csrf_ok($in)) {
    pc_json(403, ['ok' => false, 'reason' => 'csrf']);
}

/* ---------- start ---------- */
if ($action === 'start') {
    $e164 = pc_phone_e164((string) ($in['phone'] ?? ''));
    if ($e164 === null) {
        pc_json(400, ['ok' => false, 'reason' => 'phone']);
    }

    $res = pc_otp_start($e164);
    if (!$res['ok']) {
        $fail = [
            'ok' => false,
            'reason' => $res['reason'] ?? 'blocked',
            'wait' => $res['wait'] ?? null,
        ];
        /* On a preview host only, say what the provider actually said. A failed send still
           spends one of three messages, so "could not send" with no detail is the most
           expensive error message on the site. Fenced the same way the mock code is. */
        if (($res['reason'] ?? '') === 'provider') {
            $host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
            if (strpos($host, 'staging.') === 0 || strpos($host, 'localhost') === 0
                || strpos($host, '127.0.0.1') === 0) {
                $fail['provider_status'] = $res['status'] ?? 0;
                $fail['provider_code'] = $res['code'] ?? null;
            }
        }
        pc_json(429, $fail);
    }

    /* The pending attempt lives in the session, not in the reply. In MOCK the code is kept
       here so it can be checked without Twilio; in LIVE there is nothing to keep. */
    $_SESSION['pending_phone'] = $e164;
    $_SESSION['pending_at'] = time();
    $_SESSION['pending_tries'] = 0;
    $_SESSION['pending_code'] = $res['mock'] ?? false ? (string) $res['code'] : null;

    $out = ['ok' => true, 'sent' => true, 'phone' => pc_phone_mask($e164), 'mock' => (bool) ($res['mock'] ?? false)];
    /* The staging affordance: with no SMS being sent, the tester needs the code from
       somewhere. Never on a live host, and never when Twilio is actually enabled. */
    if (($res['mock'] ?? false) && !pc_twilio_live()) {
        $host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
        $isPreview = strpos($host, 'staging.') === 0 || strpos($host, 'localhost') === 0
            || strpos($host, '127.0.0.1') === 0;
        if ($isPreview) {
            $out['test_code'] = (string) $res['code'];
            $out['test_note'] = 'Simulated: no SMS was sent. This code is shown because Twilio is disabled on this preview.';
        }
    }
    pc_json(200, $out);
}

/* ---------- check ---------- */
if ($action === 'check') {
    $e164 = (string) ($_SESSION['pending_phone'] ?? '');
    if ($e164 === '') {
        pc_json(409, ['ok' => false, 'reason' => 'no_pending']);
    }
    /* A code is good for ten minutes and five attempts. Both are counted here rather than
       trusted to the provider, so the mock path is held to the same rules as the live one. */
    if (time() - (int) ($_SESSION['pending_at'] ?? 0) > 600) {
        unset($_SESSION['pending_phone'], $_SESSION['pending_code']);
        pc_json(409, ['ok' => false, 'reason' => 'expired']);
    }
    $_SESSION['pending_tries'] = (int) ($_SESSION['pending_tries'] ?? 0) + 1;
    if ($_SESSION['pending_tries'] > 5) {
        unset($_SESSION['pending_phone'], $_SESSION['pending_code']);
        pc_json(429, ['ok' => false, 'reason' => 'too_many']);
    }

    $res = pc_otp_check($e164, (string) ($in['code'] ?? ''), $_SESSION['pending_code'] ?? null);
    if (!$res['ok']) {
        pc_json(400, ['ok' => false, 'reason' => $res['reason'] ?? 'code',
                      'tries_left' => max(0, 5 - (int) $_SESSION['pending_tries'])]);
    }

    /* Verified. The session is rebuilt around the new identity, and the number itself is not
       kept -- only its one-way key and the last four digits to show the voter. */
    session_regenerate_id(true);
    $wasEmail = !empty($_SESSION['phone_key']) && strpos((string) $_SESSION['phone_key'], 'eml:') === 0
        ? (string) $_SESSION['phone_key'] : '';
    $telKey = pc_phone_key($e164);
    /* This person has now proved both channels in one session, so the two identities are the
       same voter and are merged. Without this, verifying by email and then by phone would
       hand one person a second daily vote -- the obvious hole the moment a second channel
       existed. The phone side becomes canonical because it is the stronger proof. */
    if ($wasEmail !== '') {
        pc_identity_link($telKey, $wasEmail);
    }
    $_SESSION['phone_key'] = pc_canonical($telKey);
    $_SESSION['phone_mask'] = pc_phone_mask($e164);
    $_SESSION['channel'] = 'sms';
    $_SESSION['verified_at'] = time();
    $_SESSION['ticket_verified'] = false;
    unset($_SESSION['pending_phone'], $_SESSION['pending_code'], $_SESSION['pending_tries']);

    pc_json(200, pc_me() + ['just_verified' => true]);
}

/* ---------- the email channel ----------

   Same shape as the phone path and the same session afterwards, because everything downstream
   -- the allowance, the vote, the bonus -- cares about a voting identity and not about how it
   was proved. */
if ($action === 'email_start') {
    $res = pc_email_otp_start((string) ($in['email'] ?? ''));
    if (!$res['ok']) {
        pc_json($res['reason'] === 'cooldown' ? 429 : 400,
            ['ok' => false, 'reason' => $res['reason'] ?? 'email', 'wait' => $res['wait'] ?? null]);
    }
    $_SESSION['pending_email'] = trim((string) ($in['email'] ?? ''));
    pc_json(200, ['ok' => true, 'sent' => true, 'mask' => $res['mask'] ?? '']);
}

if ($action === 'email_check') {
    $email = (string) ($_SESSION['pending_email'] ?? '');
    if ($email === '') {
        pc_json(400, ['ok' => false, 'reason' => 'no_pending']);
    }
    $res = pc_email_otp_check($email, (string) ($in['code'] ?? ''));
    if (!$res['ok']) {
        pc_json(400, ['ok' => false, 'reason' => $res['reason'] ?? 'code',
                      'tries_left' => $res['tries_left'] ?? null]);
    }
    session_regenerate_id(true);
    $emlKey = (string) $res['ident'];
    $wasPhone = !empty($_SESSION['phone_key']) && strpos((string) $_SESSION['phone_key'], 'tel:') === 0
        ? (string) $_SESSION['phone_key'] : '';
    if ($wasPhone !== '') {
        pc_identity_link($wasPhone, $emlKey);
    }
    $_SESSION['phone_key'] = pc_canonical($emlKey);   // the identity slot, whatever proved it
    $_SESSION['phone_mask'] = (string) ($res['mask'] ?? '');
    /* The address this person just proved, kept as hashes rather than text.
       Owning an inbox is proven once; asking them to prove the same inbox again to collect a
       bonus is a step that teaches us nothing. Both spellings are stored -- the address as
       typed and its normalised form -- because an Eventbrite record may be registered under
       either, and matching on only one would turn a registered attendee into a stranger. */
    $_SESSION['email_keys'] = array_values(array_unique([
        pc_email_key($email),
        pc_email_key(pc_email_normalise($email)),
    ]));
    $_SESSION['channel'] = 'email';
    $_SESSION['verified_at'] = time();
    $_SESSION['ticket_verified'] = false;
    unset($_SESSION['pending_email']);

    pc_json(200, pc_me() + ['just_verified' => true]);
}

if ($action === 'signout') {
    $_SESSION = [];
    session_destroy();
    pc_json(200, ['ok' => true, 'verified' => false]);
}

pc_json(400, ['ok' => false, 'reason' => 'action']);
