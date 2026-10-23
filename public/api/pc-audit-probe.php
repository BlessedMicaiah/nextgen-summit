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

    $findings[] = [
        'binding_id' => (int) $r['id'],
        'bound_email_is_a_registered_attendee' => $inIndex,
        'bound_attendee_is_the_one_that_email_owns' => $matches,
        'bound_attendee_exists_in_eligible_index' => $anyAttendee,
        'voter_channel' => explode(':', $voterKey)[0] . ':',
        'voter_has_valid_votes' => (int) $db->query(
            'SELECT COUNT(*) FROM pc_votes WHERE voter_key = ' . $db->quote($voterKey)
            . ' AND valid = 1')->fetchColumn(),
        'created_at' => $r['created_at'] ?? null,
    ];
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
], JSON_PRETTY_PRINT);
