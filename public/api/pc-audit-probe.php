<?php
/* TEMPORARY. Staging only. Deleted after the audit.
 *
 * One question: is the attendee binding that granted the +2 backed by a real, eligible
 * Eventbrite record, or merely by somebody having typed a correct email code?
 *
 * The index maps hashed-email -> attendee id for attendees who are attending and neither
 * cancelled nor refunded. So for a binding to be honest, BOTH must hold:
 *
 *   - its email_key is a key in that map  (the proven address belongs to a registration)
 *   - its attendee_key equals pc_attendee_key(id) for the id that key maps to
 *     (the registration bound is the one that address actually belongs to)
 *
 * The comparison runs here because pc_attendee_key() is an HMAC under the site secret, and
 * the secret must not leave the server to do it. Output is booleans and counts: no token, no
 * address, no attendee id, no key.
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
$rows = $db ? $db->query('SELECT * FROM pc_attendee ORDER BY id')->fetchAll() : [];

$findings = [];
foreach ($rows as $r) {
    $emailKey = (string) ($r['email_key'] ?? '');
    $attKey = (string) ($r['attendee_key'] ?? '');
    $voterKey = (string) ($r['voter_key'] ?? '');

    $inIndex = isset($map[$emailKey]);
    $expected = $inIndex ? pc_attendee_key((string) $map[$emailKey]) : '';
    $matches = $inIndex && hash_equals($expected, $attKey);

    /* Does the bound attendee_key correspond to ANY attendee in the eligible index? Answers
       "is this a real registration" even if the address were later changed at Eventbrite. */
    $anyAttendee = false;
    foreach ($map as $id) {
        if (hash_equals(pc_attendee_key((string) $id), $attKey)) {
            $anyAttendee = true;
            break;
        }
    }

    /* Was a second code actually NECESSARY?

       The email voting identity is 'eml:' + HMAC(normalised address), and the index is keyed
       by 'eml:' + HMAC(address) -- the same value for a normalised address. So the voting
       identity can be tested against the index directly, without knowing the address.

       If the voting identity IS in the index, the registration is under the address already
       proven to vote, the automatic check should have matched it, and the code added nothing.
       If it is NOT, the registration is under a different address and the code was the only
       way to establish ownership of it. */
    $votingIdInIndex = isset($map[$voterKey]);
    $sameAttendee = $votingIdInIndex
        && hash_equals(pc_attendee_key((string) $map[$voterKey]), $attKey);

    $findings[] = [
        'binding_id' => (int) $r['id'],
        'bound_email_is_a_registered_attendee' => $inIndex,
        'bound_attendee_is_the_one_that_email_owns' => $matches,
        'bound_attendee_exists_in_eligible_index' => $anyAttendee,
        'voting_identity_is_itself_a_registered_attendee' => $votingIdInIndex,
        'second_code_was_necessary' => !$votingIdInIndex,
        'voting_identity_maps_to_the_same_attendee' => $sameAttendee,
        'voter_channel' => explode(':', $voterKey)[0] . ':',
        'voter_has_valid_votes' => (int) $db->query(
            'SELECT COUNT(*) FROM pc_votes WHERE voter_key = ' . $db->quote($voterKey)
            . ' AND valid = 1')->fetchColumn(),
        'created_at' => $r['created_at'] ?? null,
    ];
}

/* Would the AUTOMATIC path match this voter now, with no code at all? This calls the real
   function the auto action calls, with the voter's own identity key. */
$autoNow = [];
foreach ($rows as $r) {
    $hit = pc_eb_lookup_keys([(string) $r['voter_key']]);
    $autoNow[] = [
        'binding_id' => (int) $r['id'],
        'auto_would_find_a_registration' => (bool) $hit['found'],
        'auto_reports_unavailable' => (bool) $hit['unavailable'],
        'auto_finds_the_same_attendee' => $hit['found']
            && hash_equals((string) $hit['attendee_key'], (string) $r['attendee_key']),
    ];
}

/* Are cancelled and refunded registrations actually excluded? Walk the event once and count
   what the index builder would keep and drop. Counts only; no attendee is identified. */
$elig = ['attending_total' => 0, 'cancelled' => 0, 'refunded' => 0, 'no_email' => 0,
         'kept' => 0, 'distinct_emails' => 0, 'pages' => 0, 'reached_api' => false];
$token = pc_eb_token();
if ($token !== '' && function_exists('curl_init')) {
    $url = 'https://www.eventbriteapi.com/v3/events/' . NGS_EB_EVENT_ID
         . '/attendees/?status=attending';
    $seen = [];
    $guard = 0;
    while ($url !== '' && $guard++ < 40) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20,
                                CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token]]);
        $body = curl_exec($ch);
        $st = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($st < 200 || $st >= 300 || !is_string($body)) { break; }
        $j = json_decode($body, true);
        if (!is_array($j)) { break; }
        $elig['reached_api'] = true;
        $elig['pages']++;
        foreach (($j['attendees'] ?? []) as $a) {
            if (!is_array($a)) { continue; }
            $elig['attending_total']++;
            if (!empty($a['cancelled'])) { $elig['cancelled']++; continue; }
            if (!empty($a['refunded'])) { $elig['refunded']++; continue; }
            $em = (string) ($a['profile']['email'] ?? '');
            if ($em === '' || (string) ($a['id'] ?? '') === '') { $elig['no_email']++; continue; }
            $elig['kept']++;
            $seen[pc_email_key($em)] = true;
        }
        $more = !empty($j['pagination']['has_more_items']);
        $cont = (string) ($j['pagination']['continuation'] ?? '');
        $url = ($more && $cont !== '')
            ? 'https://www.eventbriteapi.com/v3/events/' . NGS_EB_EVENT_ID
              . '/attendees/?status=attending&continuation=' . rawurlencode($cont)
            : '';
    }
    $elig['distinct_emails'] = count($seen);
}

/* Could a code alone have done it? pc_email_code_send is reached only after pc_eb_lookup
   reports found, so a pending code cannot exist for an unregistered address. Report the
   shape of that table rather than asserting it. */
$pending = $db ? (int) $db->query('SELECT COUNT(*) FROM pc_email_otp')->fetchColumn() : -1;

echo json_encode([
    'index_entries' => count($map),
    'index_stale' => (bool) $idx['stale'],
    'eb_note' => pc_eb_note(),
    'bindings' => count($rows),
    'findings' => $findings,
    'pending_code_rows' => $pending,
    'automatic_path_now' => $autoNow,
    'eligibility_filter' => $elig,
], JSON_PRETTY_PRINT);
