<?php
/* TEMPORARY. Staging only. Deleted after this audit.
 *
 * Is the voter who was told to buy a ticket genuinely unregistered, or is the match broken?
 *
 * The email voting identity is 'eml:' + HMAC(normalised address) and the index is keyed by
 * 'eml:' + HMAC(address), the same value for a normalised address. So each voting identity
 * can be tested against the attendee list without knowing or revealing any address.
 *
 * Output is one row per distinct voter, labelled V1, V2... in first-vote order, with
 * booleans. No address, no key, no attendee id, no token.
 */
declare(strict_types=1);

require_once __DIR__ . '/pc-attendee.php';
require_once __DIR__ . '/pc-identity.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');

$h = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
if (strpos($h, 'staging.') !== 0 && strpos($h, 'localhost') !== 0) {
    http_response_code(404);
    echo json_encode(['ok' => false]);
    exit;
}

$idx = pc_eb_email_index();
$map = $idx['map'];
$db = pc_db();

$bindings = [];
foreach ($db->query('SELECT voter_key, attendee_key FROM pc_attendee') as $b) {
    $bindings[(string) $b['voter_key']] = (string) $b['attendee_key'];
}

$out = [];
$n = 0;
$seen = [];
foreach ($db->query('SELECT voter_key, MIN(created_at) first_seen, COUNT(*) rows_total,
                            SUM(valid) valid_rows
                     FROM pc_votes GROUP BY voter_key ORDER BY MIN(id)') as $r) {
    $vk = (string) $r['voter_key'];
    if (isset($seen[$vk])) {
        continue;
    }
    $seen[$vk] = true;
    $n++;
    $channel = explode(':', $vk)[0] . ':';

    /* Only an email identity can be tested this way; a phone identity is not an address. */
    $testable = $channel === 'eml:';
    $inIndex = $testable && isset($map[$vk]);

    $today = $db->prepare('SELECT COUNT(*) FROM pc_votes WHERE voter_key = ? AND valid = 1
                           AND vote_day = ?');
    $today->execute([$vk, pc_day()]);

    /* What the auto action would answer for this voter right now. */
    $hit = $testable ? pc_eb_lookup_keys([$vk])
                     : ['found' => false, 'unavailable' => false];

    $out[] = [
        'voter' => 'V' . $n,
        'channel' => $channel,
        'first_seen' => $r['first_seen'],
        'valid_votes_total' => (int) $r['valid_rows'],
        'valid_votes_today' => (int) $today->fetchColumn(),
        'identity_testable_against_index' => $testable,
        'identity_is_a_registered_attendee' => $inIndex,
        'auto_check_would_find_registration' => (bool) $hit['found'],
        'auto_check_unavailable' => (bool) $hit['unavailable'],
        'has_attendee_binding' => isset($bindings[$vk]),
    ];
}

echo json_encode([
    'voting_day_now' => pc_day(),
    'index_entries' => count($map),
    'index_stale' => (bool) $idx['stale'],
    'eb_note' => pc_eb_note(),
    'distinct_voters' => $n,
    'bindings' => count($bindings),
    'voters' => $out,
], JSON_PRETTY_PRINT);
