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

require __DIR__ . '/pc-lib.php';

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
        'deadline' => pc_deadline(),
        'open' => pc_voting_open(),
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

$voter = pc_voter_key($in);
if ($voter === '') {
    pc_out(400, ['ok' => false, 'reason' => 'voter']);
}

if (!pc_voting_open()) {
    pc_out(409, ['ok' => false, 'reason' => 'closed', 'state' => pc_state()]);
}

if (pc_has_voted($voter)) {
    pc_out(409, ['ok' => false, 'reason' => 'duplicate']);
}

$res = pc_cast($voter, $entrant, true);
if (!$res['ok']) {
    pc_out(409, $res + ['ok' => false]);
}

/* Accepted. Note what is NOT in this reply: any number at all. */
pc_out(200, ['ok' => true, 'entrant' => $entrant, 'simulated' => true]);
