<?php
/* People's Choice Award — casting a vote.

   The only endpoint the public page talks to, and it is deliberately almost mute: it answers
   whether this voter's ballot was accepted and nothing else. No totals, no rankings, no leader,
   not even for the pitch just voted for. While voting is open those numbers belong to the
   dashboard alone, and an endpoint that will not say them cannot leak them.

   Everything that decides whether a vote counts is decided here, on the server: whether voting
   is open, whether the deadline has passed, whether this voter has already voted. The browser
   is not consulted and is not believed.

   HONEST LIMIT: the ballot is real and stored, but the identity behind it is not verified.
   voter_key comes from the simulated sign-in on the page, so one person with two email
   addresses is two voters. Rows are written with simulated = 1 so they can never be mistaken
   for a real count. Google OAuth and email OTP replace pc_voter_key() and nothing else. */
declare(strict_types=1);

require __DIR__ . '/pc-twilio.php';
require_once __DIR__ . '/pc-attendee.php';   // the verified-attendee entitlement lives here

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function pc_out(int $code, array $body): void
{
    http_response_code($code);
    echo json_encode($body);
    exit;
}

/* A GET says only what state the competition is in, so the public page can tell a visitor
   whether voting is open without anybody having to redeploy it. Deliberately no numbers: this
   is the one thing the public endpoint will discuss. */
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    pc_out(200, [
        'ok' => true,
        'state' => pc_state(),
        'deadline' => pc_deadline_iso(),       // absolute instant, Eastern resolved here
        'closes_label' => 'October 28, 11:59 PM ET',
        'open' => pc_voting_open(),
        'mode' => pc_mode(),
        'simulated' => true,
    ]);
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    pc_out(405, ['ok' => false, 'reason' => 'method']);
}

/* Same origin only. The page that casts votes is ours; nothing else has business here. */
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '') {
    /* Compare host to host. HTTP_HOST carries the port and an Origin's host does not, so
       comparing the two raw is a false mismatch on any non-default port -- which rejected
       every vote on the local harness until it was caught. */
    $host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
    if (($p = strrpos($host, ':')) !== false && strpos($host, ']') === false) {
        $host = substr($host, 0, $p);
    }
    $from = strtolower((string) parse_url($origin, PHP_URL_HOST));
    if ($from === '' || $from !== $host) {
        pc_out(403, ['ok' => false, 'reason' => 'origin']);
    }
}

$raw = (string) file_get_contents('php://input');
$in = json_decode($raw, true);
if (!is_array($in)) {
    $in = $_POST;
}

/* A crude brake on hammering: more than twenty attempts from one address in five minutes and
   it stops answering. Real protection is a WAF and a challenge, not this, but it costs nothing
   and it catches the obvious. */
$ipHash = ngs_ip_hash();
if (ngs_recent_from_ip($ipHash, 300) > 20) {
    pc_out(429, ['ok' => false, 'reason' => 'rate']);
}

$entrant = ngs_text($in, 'entrant', 40);
$ids = array_column(pc_entrants(), 'id');
if ($entrant === '' || !in_array($entrant, $ids, true)) {
    pc_out(400, ['ok' => false, 'reason' => 'entrant']);
}

/* The voter's identity, such as it is.

   Today: whatever the simulated sign-in produced, salted with the server secret so the stored
   key is not the person's email address in plain text.
   Tomorrow: the subject claim from Google, or the verified address from the OTP exchange,
   taken from a session this endpoint establishes -- never from the request body, which is the
   client talking about itself. */
function pc_voter_key(array $in): string
{
    $claim = ngs_text($in, 'voter', 160);
    if ($claim === '') {
        return '';
    }
    return 'sim:' . substr(hash_hmac('sha256', strtolower($claim), NGS_SECRET), 0, 32);
}

/* Who is voting, in order of trust.

   1. A verified phone session. The key comes from the session the server established after
      an SMS code was confirmed -- never from the request, which is the client describing
      itself. One number is one identity, and the unique index does the rest.
   2. Failing that, the simulated claim, which is what the staging preview has used all along
      and is marked as such in the database.

   When phone verification is required (phone_required), step 2 is not offered at all. */
function pc_voter_identity(array $in): array
{
    pc_session_begin();   // same parameters as every other endpoint, by construction
    $fresh = !empty($_SESSION['phone_key']) && !empty($_SESSION['verified_at'])
        && time() - (int) $_SESSION['verified_at'] <= 2592000;
    if ($fresh) {
        return [
            // resolved now, so a session predating an identity merge cannot vote twice
            'key' => function_exists('pc_canonical')
                ? pc_canonical((string) $_SESSION['phone_key'])
                : (string) $_SESSION['phone_key'],
            'verified' => true,
            'ticket' => !empty($_SESSION['ticket_verified']),
            'csrf' => (string) ($_SESSION['csrf'] ?? ''),
        ];
    }
    return ['key' => pc_voter_key($in), 'verified' => false, 'ticket' => false,
            'csrf' => (string) ($_SESSION['csrf'] ?? '')];
}

$identity = pc_voter_identity($in);
$voter = $identity['key'];

/* Once phone verification is switched on, an unverified caller cannot vote at all -- the
   simulated path is closed rather than left as a way round the queue. */
/* The default is now REQUIRED, and that is a security fix rather than a preference.

   An unverified voter's identity is pc_voter_key(), an HMAC of a string the browser supplies.
   Change the string, become a new voter, vote again: the allowance is real but the identity
   behind it is not, so the simulated path had no limit at all. It existed so the flow could be
   demonstrated before Twilio was wired up, and it defaulted to open.

   A phone-verified identity has no such hole -- it is an HMAC of the E.164 number, the same
   for every session and every device, and the unique index does the rest. Requiring
   verification is therefore what closes the bypass.

   An administrator can still turn it off deliberately on the dashboard; what has changed is
   that doing nothing now means closed rather than open. */
$phoneRequired = (string) pc_meta('phone_required', '1') === '1';
if ($phoneRequired && !$identity['verified']) {
    pc_out(401, ['ok' => false, 'reason' => 'verify_required']);
}

/* A verified session proves nothing about THIS request, so it carries a CSRF token too. */
if ($identity['verified']) {
    $tok = (string) ($in['csrf'] ?? '');
    if ($identity['csrf'] === '' || $tok === '' || !hash_equals($identity['csrf'], $tok)) {
        pc_out(403, ['ok' => false, 'reason' => 'csrf']);
    }
}

if ($voter === '') {
    pc_out(400, ['ok' => false, 'reason' => 'voter']);
}

if (!pc_voting_open()) {
    pc_out(409, ['ok' => false, 'reason' => 'closed', 'state' => pc_state()]);
}

/* A ticket holder's larger allowance, under the PROPOSED daily rule only.

   This flag is taken from the request, which means it is a claim, not a fact -- exactly what
   leadership said must not earn an extra vote. It is honoured here solely so the daily model
   can be demonstrated on staging, and only while the proposed rule is selected. Before this
   can be real the server has to establish ticket ownership itself, against Eventbrite or the
   registration table, and tie that ticket to one voting identity. Until then nothing marked
   this way should be read as a verified attendee. */
/* The entitlement is read from the binding table, which only an email-verified Eventbrite
   registration can put there. The browser's claim is no longer consulted at all: it used to
   be honoured for unverified voters so the daily model could be demonstrated, and a flag the
   client controls has no business deciding how many points somebody gets. An unverified
   visitor cannot vote at all now, so nothing is lost by dropping it. */
$claimsTicket = pc_mode() === 'daily'
    && $identity['verified']
    && function_exists('pc_attendee_verified')
    && pc_attendee_verified($voter);

$allow = pc_allowance($claimsTicket);
$used = pc_used($voter);
if ($used >= $allow) {
    pc_out(409, [
        'ok' => false,
        'reason' => pc_mode() === 'daily' ? 'allowance' : 'duplicate',
        'allowance' => $allow,
        'remaining' => 0,
        'next_window' => pc_next_window(),
    ]);
}

$res = pc_cast($voter, $entrant, !$identity['verified'], $claimsTicket);
if (!$res['ok']) {
    pc_out(409, $res + ['ok' => false, 'next_window' => pc_next_window()]);
}

/* Accepted. Note what is NOT in this reply: any total, rank or leader. The remaining
   allowance is about this voter alone and tells nobody how the competition is going. */
pc_out(200, [
    'ok' => true,
    'entrant' => $entrant,
    // what was actually recorded, not a constant: the row stores !verified, so should this
    'simulated' => !$identity['verified'],
    'mode' => pc_mode(),
    'spread' => pc_spread_votes(),
    'allowance' => $allow,
    'remaining' => $res['remaining'] ?? max(0, $allow - $used - 1),
    'next_window' => pc_next_window(),
    'ticket_claimed_unverified' => $claimsTicket && !$identity['verified'],
    'identity' => $identity['verified'] ? 'phone_verified' : 'simulated',
]);
