<?php
/* TEMPORARY. Staging only. Deleted after proving the bonus chain resolves.
 *
 * pc-bonus.php called pc_canonical() without loading pc-identity.php. The call sits below the
 * 401 gate, so an unauthenticated request returned before reaching it and every probe looked
 * healthy, while every authenticated voter got an undefined function, a fatal, and a 500 that
 * the browser could only describe as "we could not reach the registration system".
 *
 * This loads ONLY what pc-bonus.php used to load, reports whether the function is there, then
 * loads the missing file and reports again -- the defect and the fix in one request.
 *
 * It takes no session, writes no vote, binds no attendee and awards nothing. pc_canonical()
 * only reads: it ensures its table exists and runs one SELECT. Booleans and counts only, with
 * no token, address or attendee id anywhere in the output.
 */
declare(strict_types=1);

require_once __DIR__ . '/pc-attendee.php';     // exactly pc-bonus.php's old include line

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');

$h = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
if (strpos($h, 'staging.') !== 0 && strpos($h, 'localhost') !== 0) {
    http_response_code(404);
    echo json_encode(['ok' => false]);
    exit;
}

/* Every function pc-bonus.php calls on the auto path. */
$needed = [
    'pc_canonical', 'pc_attendee_verified', 'pc_allowance', 'pc_used', 'pc_mode',
    'pc_next_window', 'pc_voting_open', 'pc_eb_lookup_keys', 'pc_attendee_owner',
    'pc_attendee_bind', 'pc_flag', 'pc_eb_note', 'pc_db', 'pc_cast',
];
$before = array_values(array_filter($needed, static fn($f) => !function_exists($f)));

require_once __DIR__ . '/pc-identity.php';     // the line that was missing
$after = array_values(array_filter($needed, static fn($f) => !function_exists($f)));

/* Run the lookup with a key that cannot match, so the path executes and nothing binds. */
$hit = pc_eb_lookup_keys([str_repeat('0', 64)]);

echo json_encode([
    'missing_with_old_includes' => $before,        // the defect
    'missing_after_fix' => $after,                 // should be empty
    'chain_resolves_now' => $after === [],
    'canonical_callable' => pc_canonical('eml:probe-not-a-real-identity') !== '',
    'lookup_found' => (bool) $hit['found'],        // false: the key is deliberately impossible
    'lookup_unavailable' => (bool) $hit['unavailable'],
    'eb_note' => pc_eb_note(),
], JSON_PRETTY_PRINT);
