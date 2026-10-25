<?php
/* ============================================================================
   NEXTGEN DATA — the event collector.

   The one public endpoint in this system, and the only one that writes anything. It
   writes to ngd-events.sqlite, which is a different file in a different folder from
   the voting database, opened by a handle that is never given the voting database's
   path. So "the collector may not modify voting records" is not a permission somebody
   could misconfigure; there is no route.

   IT ANSWERS 204 TO ALMOST EVERYTHING

   On purpose. This endpoint is called from the vote button, the founder reels and the
   ticket page -- paths where nothing may ever be allowed to fail visibly. A rejected
   event, a disabled collector, a missing store and a malformed body all produce the
   same silent 204, because the page that sent it must not change its behaviour based
   on anything that happens here. The browser side matches: a fire-and-forget beacon
   that is never awaited and never sits in a promise chain (see assets/js/ngd-track.js).

   WHAT IT NEVER STORES

   No IP address. No cookie is set. No user agent string, no referrer host, no query
   string, no full URL, no free text from the page. The visitor is the same salted,
   day-scoped token the voting system already uses for contestant-page visits
   (pc_visitor_token, pc-rules.php:130), which stops being linkable to anything the
   following day. See ngd_event_record() in ngd-lib.php for the field-by-field cleaning.

   IT IS OFF ON THE LIVE SITE UNTIL SOMEBODY SAYS OTHERWISE

   The collect flag defaults to false in the live environment. Deploying this file
   starts collecting nothing. The owner turns it on from inside the dashboard once the
   tracking has been approved, which takes a click rather than a release.
   ========================================================================= */

declare(strict_types=1);

require_once __DIR__ . '/ngd-lib.php';

header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');

/* A beacon is same-origin and nothing here is readable, so there is no CORS to grant
   and no credentials to carry. Anything that is not a same-origin POST is simply done. */
$done = static function (): void {
    http_response_code(204);
    exit;
};

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    $done();
}

$origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
if ($origin !== '') {
    $host = (string) ($_SERVER['HTTP_HOST'] ?? '');
    if ($host === '' || parse_url($origin, PHP_URL_HOST) !== $host) {
        $done();
    }
}

/* sendBeacon sends text/plain, fetch sends application/json. Both arrive as a raw body. */
$raw = file_get_contents('php://input');
if (!is_string($raw) || $raw === '' || strlen($raw) > 4096) {
    $done();
}
$in = json_decode($raw, true);
unset($raw);
if (!is_array($in)) {
    $done();
}

/* A page may batch a few events into one beacon on unload. Capped, and each one is
   validated independently inside ngd_event_record(). */
$batch = (isset($in['events']) && is_array($in['events'])) ? $in['events'] : [$in];
$batch = array_slice($batch, 0, 20);

foreach ($batch as $one) {
    if (!is_array($one)) {
        continue;
    }
    try {
        ngd_event_record($one);
    } catch (Throwable $e) {
        /* Swallowed deliberately. A failure here must never reach the page, and must
           never appear in a response a visitor could read. */
        break;
    }
}

$done();
