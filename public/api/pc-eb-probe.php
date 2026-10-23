<?php
/* TEMPORARY. Staging only. Delete after verifying the attendee index builds.
 *
 * Answers one question: does pc_eb_email_index() produce a usable map on this host? It was
 * fataling on an undefined NGS_EB_EVENT_ID, which the browser could only ever see as "we
 * could not reach the registration system", and the bonus path needs a verified session so
 * there was no way to exercise it without one.
 *
 * It returns a count and a short status code. No token, no email address, no attendee id, no
 * part of the map -- nothing that is not already public via attendee-count.php.
 */
declare(strict_types=1);

require_once __DIR__ . '/pc-attendee.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');

$h = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
if (strpos($h, 'staging.') !== 0 && strpos($h, 'localhost') !== 0) {
    http_response_code(404);
    echo json_encode(['ok' => false]);
    exit;
}

$file = pc_eb_index_file();
$before = is_file($file) ? (int) filesize($file) : 0;

$idx = pc_eb_email_index(true);          // force, so we are testing the build and not a cache

echo json_encode([
    'ok' => (bool) $idx['ok'],
    'stale' => (bool) $idx['stale'],
    'indexed' => count($idx['map']),     // a count, the same figure attendee-count.php gives
    'note' => pc_eb_note(),
    'cache_bytes_before' => $before,
    'cache_bytes_after' => is_file($file) ? (int) filesize($file) : 0,
    'event' => defined('NGS_EB_EVENT_ID') ? NGS_EB_EVENT_ID : '(UNDEFINED)',
    'data_dir_writable' => is_writable(dirname($file)),
], JSON_PRETTY_PRINT);
