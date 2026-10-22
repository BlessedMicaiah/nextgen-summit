<?php
/* The voting page, behind the staging gate.

   The page itself is still index.html -- this wrapper exists only to ask who you are first.
   On staging it shows the sign-in screen until somebody answers, and then serves the gallery
   exactly as it was. On the live site ngs_staging_gate_active() is false, so this hands the
   file straight through and the public page is unchanged.

   entrant.php reads index.html off the disk rather than over HTTP, so the per-contestant
   share links keep working regardless of what Apache will or will not serve. */
declare(strict_types=1);

require dirname(__DIR__, 2) . '/api/pc-staging-gate.php';

if (ngs_staging_gate_active()) {
    $notice = ngs_staging_gate_post();
    if (!ngs_staging_gate_ok()) {
        ngs_staging_gate_page($notice);        // exits
    }
    header('X-Robots-Tag: noindex, nofollow, noarchive');
    header('Cache-Control: no-store');
}

$page = @file_get_contents(__DIR__ . '/index.html');
if (!is_string($page) || $page === '') {
    http_response_code(500);
    exit('The voting page could not be loaded.');
}
header('Content-Type: text/html; charset=utf-8');
echo $page;
