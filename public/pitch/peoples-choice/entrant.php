<?php
/* One contestant's own page: /pitch/peoples-choice/<slug>/

   Why this exists rather than a link to #entrant-07 on the gallery: a founder sharing their
   pitch in a WhatsApp group should produce a preview card with their name on it, and that
   needs Open Graph tags the server wrote for them. A fragment cannot do that -- the server
   never sees it.

   The page itself is the gallery page. It carries this contestant's social metadata, records
   that the visit arrived through their link, and opens their profile on arrival. Everything
   after that is the same code the gallery runs, so there is one implementation of a profile,
   not two.

   The visit log holds no IP address, no cookie and no name. See pc_log_visit(). */
declare(strict_types=1);

require dirname(__DIR__, 2) . '/api/pc-rules.php';
require_once dirname(__DIR__, 2) . '/api/pc-staging-gate.php';

/* A contestant link serves the same gallery, so it answers to the same gate on
   staging; otherwise it would be a way straight past it. No-op on the live site. */
if (ngs_staging_gate_active() && !ngs_staging_gate_ok()) {
    ngs_staging_gate_page(ngs_staging_gate_post());
}

$slug = isset($_GET['slug']) && is_string($_GET['slug']) ? strtolower($_GET['slug']) : '';
$slug = preg_replace('/[^a-z0-9-]/', '', $slug);
$entrant = $slug !== '' ? pc_by_slug($slug) : null;

if (!$entrant) {
    http_response_code(404);
    header('Location: /pitch/peoples-choice/', true, 302);
    exit;
}

/* Which platform sent them, when the link says so. A short allow-list, because this ends up
   in a database column and in an admin table. */
$src = isset($_GET['s']) && is_string($_GET['s']) ? strtolower($_GET['s']) : '';
$known = ['whatsapp', 'instagram', 'linkedin', 'x', 'twitter', 'facebook', 'tiktok', 'email', 'sms', 'qr'];
if ($src !== '' && !in_array($src, $known, true)) {
    $src = 'other';
}
if ($src === '') {
    $ref = (string) ($_SERVER['HTTP_REFERER'] ?? '');
    $host = $ref !== '' ? (string) parse_url($ref, PHP_URL_HOST) : '';
    $src = $host !== '' && stripos($host, $_SERVER['HTTP_HOST'] ?? '') === false
        ? strtolower(preg_replace('/^www\./', '', $host)) : 'direct';
}
pc_log_visit($entrant['id'], $src);

$name = $entrant['name'];
$company = $entrant['company'];
$url = 'https://' . ($_SERVER['HTTP_HOST'] ?? 'nextgensummit.us') . '/pitch/peoples-choice/' . $slug . '/';
$img = 'https://' . ($_SERVER['HTTP_HOST'] ?? 'nextgensummit.us') . '/assets/img/pitch-hero-1200.jpg';
$desc = $name . ' is a semifinalist in the NextGen Summit People\'s Choice Award. Watch the pitch and cast your vote.';

function e($v): string
{
    return htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
}

/* The gallery page, with this contestant's metadata swapped into its head and a note telling
   the script which profile to open. Reusing the page rather than rebuilding it means a change
   to the gallery is a change here too, automatically. */
$page = (string) file_get_contents(__DIR__ . '/index.html');

$head = "\n<meta property=\"og:type\" content=\"profile\">\n"
      . '<meta property="og:title" content="' . e($name . " — NextGen People's Choice") . "\">\n"
      . '<meta property="og:description" content="' . e($desc) . "\">\n"
      . '<meta property="og:url" content="' . e($url) . "\">\n"
      . '<meta property="og:image" content="' . e($img) . "\">\n"
      . "<meta name=\"twitter:card\" content=\"summary_large_image\">\n"
      . '<meta name="twitter:title" content="' . e($name) . "\">\n"
      . '<meta name="twitter:description" content="' . e($desc) . "\">\n"
      . '<meta name="twitter:image" content="' . e($img) . "\">\n"
      . '<link rel="canonical" href="' . e($url) . "\">\n"
      . '<script>window.__pcOpen = ' . json_encode($entrant['id']) . '; window.__pcSource = '
      . json_encode($src) . ";</script>\n";

/* Replace the gallery's own canonical and social tags so there is one of each, not two. */
$page = preg_replace('#<link rel="canonical"[^>]*>#', '', $page, 1);
$page = preg_replace('#<meta property="og:(title|description|url|image)"[^>]*>#', '', $page);
$page = preg_replace('#<meta name="twitter:[^"]*"[^>]*>#', '', $page);
$page = str_replace('<title>', $head . '<title>', $page);
$page = preg_replace('#<title>.*?</title>#s',
    '<title>' . e($name) . ' &middot; NextGen People&rsquo;s Choice</title>', $page, 1);

header('Content-Type: text/html; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow');
echo $page;
