<?php
/* Hands a stored resume back to a signed-in admin, and to nobody else. The files live in the
   data folder, which is outside the web root where the host allows it and denied by .htaccess
   where it is not, so this script is the only way to read one. */
declare(strict_types=1);

require __DIR__ . '/_lib.php';

session_name('ngs_admin');
session_start();

header('X-Robots-Tag: noindex');
header('Cache-Control: no-store');

// same session and the same eight-hour window the admin page itself enforces
if (empty($_SESSION['ok']) || (int) ($_SESSION['at'] ?? 0) <= time() - 8 * 3600) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Sign in to the admin page first.";
    exit;
}

$stored = isset($_GET['f']) && is_string($_GET['f']) ? $_GET['f'] : '';
$path = ngs_resume_path($stored);
if ($path === null) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo "No such file.";
    exit;
}

$ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
$types = ['pdf' => 'application/pdf', 'doc' => 'application/msword',
          'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

// always as an attachment, never rendered in the page, and never sniffed into something else
header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
header('X-Content-Type-Options: nosniff');
header('Content-Disposition: attachment; filename="' . $stored . '"');
header('Content-Length: ' . (string) filesize($path));
readfile($path);
