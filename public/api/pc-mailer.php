<?php
/* Sending mail that actually arrives.

   WHY NOT mail()

   The site already has mail(), and it is used for notices to our own inbox. It is the wrong
   tool for a verification code going to a stranger's Gmail. The domain's MX is Google
   Workspace, so a message that claims to come from nextgensummit.us but was handed to a shared
   host's local MTA is unsigned, unaligned and competing with the receiving domain's own
   expectations. It will not bounce. It will quietly land in spam, and a voter who never sees a
   code simply leaves.

   So this speaks SMTP to an authenticated relay -- Google Workspace, which the domain already
   pays for, is already named in SPF, and already signs with DKIM. Mail sent this way is
   aligned by construction rather than by hope.

   WHERE THE PASSWORD LIVES

   Not here, and not in the web root. config.smtp.php sits in the data directory beside the
   Twilio credentials: outside the web root, never served, not in the release archive, and
   untouched by deploys. It is written from the admin dashboard and read as text, never
   require()d -- the same rules the Twilio and admin credentials already follow.

   An app password is NOT an account password. It is scoped to one application, revocable on
   its own, and worth saying out loud because the temptation is to paste the real one. */
declare(strict_types=1);

require_once __DIR__ . '/_lib.php';

function pc_smtp_file(): string
{
    return ngs_data_dir() . '/config.smtp.php';
}

/**
 * The relay settings, or empty strings when nothing is configured.
 *
 * Read as text rather than executed. A credential is a handful of strings and has no reason to
 * be code; `const` inside a file included from within a function is also the trap that cost us
 * an afternoon on the admin PIN.
 *
 * @return array{host:string,port:int,user:string,pass:string,from:string,name:string,secure:string}
 */
function pc_smtp_conf(): array
{
    static $c = null;
    if ($c !== null) {
        return $c;
    }
    $c = ['host' => '', 'port' => 587, 'user' => '', 'pass' => '',
          'from' => '', 'name' => 'NextGen Summit', 'secure' => 'tls'];
    $f = pc_smtp_file();
    if (!is_file($f) || !is_readable($f)) {
        return $c;
    }
    $raw = @file_get_contents($f);
    if (!is_string($raw) || $raw === '') {
        return $c;
    }
    $get = function (string $k, string $raw): string {
        return preg_match("/" . $k . "\s*=\s*'((?:[^'\\\\]|\\\\.)*)'/", $raw, $m)
            ? str_replace(["\\'", '\\\\'], ["'", '\\'], $m[1]) : '';
    };
    $c['host'] = $get('NGS_SMTP_HOST', $raw);
    $c['user'] = $get('NGS_SMTP_USER', $raw);
    $c['pass'] = $get('NGS_SMTP_PASS', $raw);
    $c['from'] = $get('NGS_SMTP_FROM', $raw);
    $n = $get('NGS_SMTP_NAME', $raw);
    if ($n !== '') {
        $c['name'] = $n;
    }
    $s = $get('NGS_SMTP_SECURE', $raw);
    if ($s !== '') {
        $c['secure'] = strtolower($s);
    }
    if (preg_match('/NGS_SMTP_PORT\s*=\s*(\d+)/', $raw, $m)) {
        $c['port'] = (int) $m[1];
    }
    unset($raw);
    return $c;
}

function pc_smtp_configured(): bool
{
    $c = pc_smtp_conf();
    return $c['host'] !== '' && $c['user'] !== '' && $c['pass'] !== '' && $c['from'] !== '';
}

/** A health line for the dashboard. Says what is present, never what it is. */
function pc_smtp_status(): array
{
    $c = pc_smtp_conf();
    return [
        'configured' => pc_smtp_configured(),
        'host' => $c['host'] !== '' ? $c['host'] : 'not set',
        'port' => $c['port'],
        'encryption' => $c['secure'],
        /* The username and sender are shown in full. They are not secrets -- the From
           address is printed on every message we send -- and hiding them behind "present"
           made an empty field indistinguishable from a filled one, which is exactly the
           state somebody then spends an evening trying to diagnose. Only the password is
           withheld. */
        'username' => $c['user'] !== '' ? $c['user'] : 'NOT SET',
        'password' => $c['pass'] !== '' ? 'present (' . strlen($c['pass']) . ' chars)' : 'NOT SET',
        'from' => $c['from'] !== '' ? $c['from'] : 'NOT SET',
        'ready_to_send' => pc_smtp_configured() ? 'yes' : 'NO - a required field is empty',
        'from_name' => $c['name'],
        'sockets' => function_exists('stream_socket_client') ? 'available' : 'UNAVAILABLE',
        'openssl' => extension_loaded('openssl') ? 'available' : 'UNAVAILABLE',
    ];
}

/**
 * Write the relay settings. Called only from the admin dashboard.
 *
 * A blank field keeps what is stored, so the host or sender can be corrected without retyping
 * the app password. Written to a neighbour and renamed into place.
 *
 * @return array{ok:bool,error?:string}
 */
function pc_smtp_save(array $in): array
{
    $cur = pc_smtp_conf();
    $take = function (string $k) use ($in): string {
        return isset($in[$k]) && is_string($in[$k]) ? trim($in[$k]) : '';
    };
    $host = $take('host') !== '' ? $take('host') : $cur['host'];
    $user = $take('user') !== '' ? $take('user') : $cur['user'];
    $pass = $take('pass') !== '' ? $take('pass') : $cur['pass'];
    $from = $take('from') !== '' ? $take('from') : $cur['from'];
    $name = $take('name') !== '' ? $take('name') : $cur['name'];
    $secure = $take('secure') !== '' ? strtolower($take('secure')) : $cur['secure'];
    $port = $take('port') !== '' ? (int) $take('port') : $cur['port'];

    if ($host !== '' && !preg_match('/^[a-z0-9.-]+$/i', $host)) {
        return ['ok' => false, 'error' => 'That host name does not look right. Nothing was saved.'];
    }
    if ($from !== '' && filter_var($from, FILTER_VALIDATE_EMAIL) === false) {
        return ['ok' => false, 'error' => 'The From address is not a valid email. Nothing was saved.'];
    }
    if ($user !== '' && filter_var($user, FILTER_VALIDATE_EMAIL) === false) {
        return ['ok' => false, 'error' => 'The SMTP username should be the full mailbox address. Nothing was saved.'];
    }
    if ($port < 1 || $port > 65535) {
        return ['ok' => false, 'error' => 'That port is out of range. Nothing was saved.'];
    }
    if (!in_array($secure, ['tls', 'ssl', 'none'], true)) {
        $secure = 'tls';
    }

    $q = function (string $v): string {
        return "'" . str_replace(["\\", "'"], ["\\\\", "\\'"], $v) . "'";
    };
    $lines = [
        '<?php',
        '/* SMTP relay for NextGen verification email. Written by the admin dashboard, outside',
        '   the web root, never in git and never in a release archive. The password here should',
        '   be a Google Workspace APP PASSWORD scoped to this site, not an account password. */',
        'declare(strict_types=1);',
        '',
        'const NGS_SMTP_HOST   = ' . $q($host) . ';',
        'const NGS_SMTP_PORT   = ' . (int) $port . ';',
        'const NGS_SMTP_SECURE = ' . $q($secure) . ';',
        'const NGS_SMTP_USER   = ' . $q($user) . ';',
        'const NGS_SMTP_PASS   = ' . $q($pass) . ';',
        'const NGS_SMTP_FROM   = ' . $q($from) . ';',
        'const NGS_SMTP_NAME   = ' . $q($name) . ';',
        '',
    ];
    $path = pc_smtp_file();
    if (!is_dir(dirname($path)) || !is_writable(dirname($path))) {
        return ['ok' => false, 'error' => 'The data directory is not writable by PHP. Nothing was saved.'];
    }
    $tmp = $path . '.new';
    if (@file_put_contents($tmp, implode("\n", $lines), LOCK_EX) === false) {
        return ['ok' => false, 'error' => 'Could not write the settings. Nothing was saved.'];
    }
    @chmod($tmp, 0600);
    if (!@rename($tmp, $path)) {
        @unlink($tmp);
        return ['ok' => false, 'error' => 'Could not move the settings into place.'];
    }
    @chmod($path, 0600);
    return ['ok' => true];
}


/**
 * Prove the relay accepts our credentials, without sending anything.
 *
 * Connect, greet, negotiate TLS, authenticate, hang up. No MAIL FROM, no RCPT, no DATA, so
 * nothing is queued and nobody receives anything -- the same reasoning as the read-only Twilio
 * probe: the first real message should not also be the first test of the login.
 *
 * Only the step reached and the SMTP code come back. Never the password, never the response
 * text, which can echo the username.
 *
 * @return array{ok:bool,step:string,code:int,detail:string}
 */
function pc_smtp_probe(): array
{
    if (!pc_smtp_configured()) {
        return ['ok' => false, 'step' => 'config', 'code' => 0,
                'detail' => 'Host, username, app password and From must all be filled in first.'];
    }
    if (!function_exists('stream_socket_client')) {
        return ['ok' => false, 'step' => 'sockets', 'code' => 0,
                'detail' => 'This host cannot open outbound sockets.'];
    }
    $c = pc_smtp_conf();
    $target = ($c['secure'] === 'ssl' ? 'ssl://' : '') . $c['host'] . ':' . $c['port'];
    $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
    $fp = @stream_socket_client($target, $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $ctx);
    if (!$fp) {
        return ['ok' => false, 'step' => 'connect', 'code' => (int) $errno,
                'detail' => 'Could not reach ' . $c['host'] . ' on port ' . $c['port']
                    . '. The host may block outbound SMTP.'];
    }
    stream_set_timeout($fp, 15);
    $end = function (array $r) use ($fp) {
        @fwrite($fp, "QUIT
");
        @fclose($fp);
        return $r;
    };

    $r = pc_smtp_cmd($fp, '', 220, 'greeting');
    if (!$r['ok']) {
        return $end(['ok' => false, 'step' => 'greeting', 'code' => $r['code'],
                     'detail' => 'The server did not greet us.']);
    }
    $ehlo = 'EHLO ' . (string) ($_SERVER['HTTP_HOST'] ?? 'nextgensummit.us');
    $r = pc_smtp_cmd($fp, $ehlo, 250, 'ehlo');
    if (!$r['ok']) {
        return $end(['ok' => false, 'step' => 'ehlo', 'code' => $r['code'],
                     'detail' => 'The server refused the greeting.']);
    }
    if ($c['secure'] === 'tls') {
        $r = pc_smtp_cmd($fp, 'STARTTLS', 220, 'starttls');
        if (!$r['ok']) {
            return $end(['ok' => false, 'step' => 'starttls', 'code' => $r['code'],
                         'detail' => 'The server would not start TLS on this port.']);
        }
        if (!@stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
            return $end(['ok' => false, 'step' => 'tls', 'code' => 0,
                         'detail' => 'TLS negotiation failed.']);
        }
        $r = pc_smtp_cmd($fp, $ehlo, 250, 'ehlo2');
        if (!$r['ok']) {
            return $end(['ok' => false, 'step' => 'ehlo2', 'code' => $r['code'],
                         'detail' => 'The server refused the greeting after TLS.']);
        }
    }
    $r = pc_smtp_cmd($fp, 'AUTH LOGIN', 334, 'auth');
    if (!$r['ok']) {
        return $end(['ok' => false, 'step' => 'auth', 'code' => $r['code'],
                     'detail' => 'The server did not offer password login.']);
    }
    $r = pc_smtp_cmd($fp, base64_encode($c['user']), 334, 'auth_user');
    if (!$r['ok']) {
        return $end(['ok' => false, 'step' => 'auth_user', 'code' => $r['code'],
                     'detail' => 'The username was rejected.']);
    }
    $r = pc_smtp_cmd($fp, base64_encode($c['pass']), 235, 'auth_pass');
    if (!$r['ok']) {
        return $end(['ok' => false, 'step' => 'auth_pass', 'code' => $r['code'],
                     'detail' => 'Authentication failed. For Google this almost always means '
                        . 'the app password is wrong, or 2-Step Verification is off on that '
                        . 'account so the password is not an app password at all.']);
    }
    return $end(['ok' => true, 'step' => 'authenticated', 'code' => 235,
                 'detail' => 'Connected, TLS negotiated and signed in. Nothing was sent.']);
}

/* ---------- the conversation ---------- */

/** Read one SMTP reply, folding continuation lines. */
function pc_smtp_read($fp): string
{
    $out = '';
    while (($line = fgets($fp, 1024)) !== false) {
        $out .= $line;
        if (strlen($line) < 4 || $line[3] !== '-') {
            break;
        }
    }
    return $out;
}

/** Send one command and expect a code. Never logs the AUTH payload. */
function pc_smtp_cmd($fp, string $cmd, int $expect, string $label): array
{
    if ($cmd !== '') {
        fwrite($fp, $cmd . "\r\n");
    }
    $r = pc_smtp_read($fp);
    $code = (int) substr(ltrim($r), 0, 3);
    if ($code !== $expect) {
        return ['ok' => false, 'step' => $label, 'code' => $code];
    }
    return ['ok' => true, 'code' => $code];
}

/**
 * Deliver one message over the configured relay.
 *
 * @return array{ok:bool,error?:string,step?:string,code?:int}
 */
function pc_mail_send(string $to, string $subject, string $html, string $text): array
{
    if (!pc_smtp_configured()) {
        return ['ok' => false, 'error' => 'not_configured'];
    }
    if (!function_exists('stream_socket_client')) {
        return ['ok' => false, 'error' => 'no_sockets'];
    }
    $c = pc_smtp_conf();
    $host = ($c['secure'] === 'ssl' ? 'ssl://' : '') . $c['host'];

    $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
    $fp = @stream_socket_client($host . ':' . $c['port'], $errno, $errstr, 20,
        STREAM_CLIENT_CONNECT, $ctx);
    if (!$fp) {
        // the message is not carried back to the visitor; it can name internal hosts
        error_log("People's Choice: SMTP connect failed (" . (int) $errno . ').');
        return ['ok' => false, 'error' => 'connect'];
    }
    stream_set_timeout($fp, 20);

    $fail = function (array $r) use ($fp) {
        @fclose($fp);
        error_log("People's Choice: SMTP " . $r['step'] . ' got ' . $r['code'] . '.');
        return ['ok' => false, 'error' => 'smtp', 'step' => $r['step'], 'code' => $r['code']];
    };

    $r = pc_smtp_cmd($fp, '', 220, 'greeting');
    if (!$r['ok']) { return $fail($r); }
    $ehlo = 'EHLO ' . (string) ($_SERVER['HTTP_HOST'] ?? 'nextgensummit.us');
    $r = pc_smtp_cmd($fp, $ehlo, 250, 'ehlo');
    if (!$r['ok']) { return $fail($r); }

    if ($c['secure'] === 'tls') {
        $r = pc_smtp_cmd($fp, 'STARTTLS', 220, 'starttls');
        if (!$r['ok']) { return $fail($r); }
        if (!@stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
            @fclose($fp);
            error_log("People's Choice: SMTP TLS negotiation failed.");
            return ['ok' => false, 'error' => 'tls'];
        }
        $r = pc_smtp_cmd($fp, $ehlo, 250, 'ehlo2');
        if (!$r['ok']) { return $fail($r); }
    }

    // AUTH LOGIN. The two payloads are deliberately not passed through any logging path.
    $r = pc_smtp_cmd($fp, 'AUTH LOGIN', 334, 'auth');
    if (!$r['ok']) { return $fail($r); }
    $r = pc_smtp_cmd($fp, base64_encode($c['user']), 334, 'auth_user');
    if (!$r['ok']) { return $fail($r); }
    $r = pc_smtp_cmd($fp, base64_encode($c['pass']), 235, 'auth_pass');
    if (!$r['ok']) { return $fail($r); }

    $r = pc_smtp_cmd($fp, 'MAIL FROM:<' . $c['from'] . '>', 250, 'mail_from');
    if (!$r['ok']) { return $fail($r); }
    $r = pc_smtp_cmd($fp, 'RCPT TO:<' . $to . '>', 250, 'rcpt_to');
    if (!$r['ok']) { return $fail($r); }
    $r = pc_smtp_cmd($fp, 'DATA', 354, 'data');
    if (!$r['ok']) { return $fail($r); }

    $boundary = 'ngs' . bin2hex(random_bytes(12));
    $enc = function (string $s): string {
        return '=?UTF-8?B?' . base64_encode($s) . '?=';
    };
    $headers = [
        'From: ' . $enc($c['name']) . ' <' . $c['from'] . '>',
        'To: <' . $to . '>',
        'Subject: ' . $enc($subject),
        'Date: ' . date('r'),
        'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . $c['host'] . '>',
        'MIME-Version: 1.0',
        'Content-Type: multipart/alternative; boundary="' . $boundary . '"',
        'Auto-Submitted: auto-generated',
        'X-Entity-Ref-ID: ngs-verify',
    ];
    $body = implode("\r\n", $headers) . "\r\n\r\n"
        . '--' . $boundary . "\r\n"
        . "Content-Type: text/plain; charset=UTF-8\r\n"
        . "Content-Transfer-Encoding: 8bit\r\n\r\n"
        . $text . "\r\n\r\n"
        . '--' . $boundary . "\r\n"
        . "Content-Type: text/html; charset=UTF-8\r\n"
        . "Content-Transfer-Encoding: 8bit\r\n\r\n"
        . $html . "\r\n\r\n"
        . '--' . $boundary . "--\r\n";

    // a lone dot on its own line ends DATA, so any such line in the body is escaped
    $body = preg_replace('/^\./m', '..', $body);
    fwrite($fp, $body . "\r\n.\r\n");
    $r = pc_smtp_cmd($fp, '', 250, 'send');
    if (!$r['ok']) { return $fail($r); }

    pc_smtp_cmd($fp, 'QUIT', 221, 'quit');
    @fclose($fp);
    return ['ok' => true];
}
