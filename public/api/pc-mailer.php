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

    /* An empty box keeps what is stored. That is right while you are correcting one field of
       a working relay, and wrong the moment you point the form at a DIFFERENT relay: the new
       host and login get silently married to the OLD provider's password, and the result is
       a 535 that looks like a bad key and is actually a mismatched pair.

       That is exactly what happened switching from Gmail to Brevo. The stored password stayed
       19 characters -- which is a Gmail app password, sixteen characters shown as four groups
       of four -- while the host said Brevo.
    
       So: changing the host is treated as changing provider, and the credentials that belong
       to a provider must be given again rather than inherited. */
    $hostIn = $take('host');
    $switching = $hostIn !== '' && $cur['host'] !== '' && strcasecmp($hostIn, $cur['host']) !== 0;

    $host = $hostIn !== '' ? $hostIn : $cur['host'];
    $user = $take('user') !== '' ? $take('user') : ($switching ? '' : $cur['user']);
    /* Whitespace is never part of an SMTP key. Google prints its app passwords in four
       groups for legibility and accepts them with or without the spaces; every other
       provider would simply reject them. Stripping all of it removes a whole category of
       "I definitely pasted it correctly". */
    $passIn = preg_replace('/\s+/', '', $take('pass'));
    $pass = $passIn !== '' ? $passIn : ($switching ? '' : $cur['pass']);
    $from = $take('from') !== '' ? $take('from') : ($switching ? '' : $cur['from']);
    $name = $take('name') !== '' ? $take('name') : $cur['name'];
    $secure = $take('secure') !== '' ? strtolower($take('secure')) : $cur['secure'];
    $port = $take('port') !== '' ? (int) $take('port') : $cur['port'];

    if ($switching && ($pass === '' || $user === '' || $from === '')) {
        return ['ok' => false, 'error' => 'You are pointing this at a different relay ('
            . $cur['host'] . ' to ' . $host . '), so the username, password and From address '
            . 'must all be entered again. Credentials from the previous relay are not carried '
            . 'across -- they would not work, and pairing them with the new host is what '
            . 'produces an authentication failure that looks like a bad key. Nothing was saved.'];
    }

    if ($host !== '' && !preg_match('/^[a-z0-9.-]+$/i', $host)) {
        return ['ok' => false, 'error' => 'That host name does not look right. Nothing was saved.'];
    }
    if ($from !== '' && filter_var($from, FILTER_VALIDATE_EMAIL) === false) {
        return ['ok' => false, 'error' => 'The From address is not a valid email. Nothing was saved.'];
    }
    /* Not every relay's login is an email address. Gmail's and Brevo's are; SendGrid's is
       the literal word "apikey", and Mailgun hands out a domain-scoped login. Requiring an
       address here would have rejected those outright, so the check is only that something
       was given and that it has no whitespace in it. */
    if ($user !== '' && preg_match('/\s/', $user)) {
        return ['ok' => false, 'error' => 'The SMTP username should not contain spaces. Nothing was saved.'];
    }
    if ($port < 1 || $port > 65535) {
        return ['ok' => false, 'error' => 'That port is out of range. Nothing was saved.'];
    }
    if (!in_array($secure, ['tls', 'ssl', 'none'], true)) {
        $secure = 'tls';
    }

    return pc_smtp_write([
        'host' => $host, 'port' => (int) $port, 'secure' => $secure,
        'user' => $user, 'pass' => $pass, 'from' => $from, 'name' => $name,
    ]);
}

/* ---------- saved relays ----------

   One stored set of credentials per provider, so switching between them is a button rather
   than seven fields retyped under pressure.

   This exists because of how the Gmail-to-Brevo switch actually went: the form keeps a blank
   box meaning "leave as it was", which silently married a new host to an old password and
   produced an authentication failure that looked like a bad key. Retyping everything
   correctly, at speed, while voting is down, is the moment that mistake gets made. A saved
   relay is a complete set that was tested as a set, and applying it replaces every field at
   once -- there is no half-switched state to be in.

   Stored beside the live config, outside the web root, 0600, as JSON. Read with
   json_decode: it is data and nothing about it is executed. Keys are never rendered back to
   the page -- the listing shows host, login and sender, and says only whether a key is held.
*/
function pc_smtp_profiles_file(): string
{
    return ngs_data_dir() . '/config.smtp-profiles.json';
}

/** @return array<string, array<string,mixed>> label => settings */
function pc_smtp_profiles(): array
{
    $f = pc_smtp_profiles_file();
    if (!is_file($f) || !is_readable($f)) {
        return [];
    }
    $j = json_decode((string) @file_get_contents($f), true);
    return is_array($j) ? $j : [];
}

/** @return array{ok:bool,error?:string} */
function pc_smtp_profiles_put(array $all): array
{
    $f = pc_smtp_profiles_file();
    if (!is_dir(dirname($f)) || !is_writable(dirname($f))) {
        return ['ok' => false, 'error' => 'The data directory is not writable by PHP.'];
    }
    $tmp = $f . '.new';
    if (@file_put_contents($tmp, json_encode($all, JSON_PRETTY_PRINT), LOCK_EX) === false) {
        return ['ok' => false, 'error' => 'Could not write the saved relays.'];
    }
    @chmod($tmp, 0600);
    if (!@rename($tmp, $f)) {
        @unlink($tmp);
        return ['ok' => false, 'error' => 'Could not move the saved relays into place.'];
    }
    @chmod($f, 0600);
    return ['ok' => true];
}

/**
 * Store whatever is configured right now under a label.
 *
 * Deliberately a snapshot of the LIVE settings rather than of the form: you save a relay
 * after you have tested it, so what gets saved is the thing that was proved to work.
 *
 * @return array{ok:bool,error?:string}
 */
function pc_smtp_profile_save(string $label): array
{
    $label = trim(preg_replace('/[^A-Za-z0-9 ._-]/', '', $label));
    if ($label === '') {
        return ['ok' => false, 'error' => 'Give the relay a name so you can tell them apart.'];
    }
    if (!pc_smtp_configured()) {
        return ['ok' => false, 'error' => 'The current settings are incomplete, so there is nothing worth saving.'];
    }
    $c = pc_smtp_conf();
    $all = pc_smtp_profiles();
    $all[$label] = [
        'host' => $c['host'], 'port' => (int) $c['port'], 'secure' => $c['secure'],
        'user' => $c['user'], 'pass' => $c['pass'], 'from' => $c['from'], 'name' => $c['name'],
        'saved_at' => gmdate('Y-m-d H:i') . 'Z',
    ];
    return pc_smtp_profiles_put($all);
}

/** @return array{ok:bool,error?:string} */
function pc_smtp_profile_apply(string $label): array
{
    $all = pc_smtp_profiles();
    if (!isset($all[$label]) || !is_array($all[$label])) {
        return ['ok' => false, 'error' => 'There is no saved relay by that name.'];
    }
    $c = $all[$label];
    foreach (['host', 'user', 'pass', 'from'] as $k) {
        if (trim((string) ($c[$k] ?? '')) === '') {
            return ['ok' => false, 'error' => 'That saved relay is missing its ' . $k
                . ', so applying it would leave email switched off. Nothing was changed.'];
        }
    }
    /* Straight to the writer: a saved relay is complete by construction, so the
       provider-switch guard has nothing to protect against here. */
    return pc_smtp_write([
        'host' => (string) $c['host'], 'port' => (int) ($c['port'] ?: 587),
        'secure' => (string) ($c['secure'] ?: 'tls'), 'user' => (string) $c['user'],
        'pass' => (string) $c['pass'], 'from' => (string) $c['from'],
        'name' => (string) ($c['name'] ?? ''),
    ]);
}

/** @return array{ok:bool,error?:string} */
function pc_smtp_profile_delete(string $label): array
{
    $all = pc_smtp_profiles();
    if (!isset($all[$label])) {
        return ['ok' => false, 'error' => 'There is no saved relay by that name.'];
    }
    unset($all[$label]);
    return pc_smtp_profiles_put($all);
}

/**
 * Write a complete relay configuration to disk.
 *
 * Split out from pc_smtp_save so that applying a SAVED relay does not have to pass the
 * provider-switch guard. That guard exists to stop a half-filled form pairing a new host
 * with an old password; a saved relay is a complete set that was tested as a set, so the
 * guard would only be in the way.
 *
 * @param array{host:string,port:int,secure:string,user:string,pass:string,from:string,name:string} $c
 * @return array{ok:bool,error?:string}
 */
function pc_smtp_write(array $c): array
{
    $q = function (string $v): string {
        return "'" . str_replace(["\\", "'"], ["\\\\", "\'"], $v) . "'";
    };
    $lines = [
        '<?php',
        '/* SMTP relay for NextGen verification email. Written by the admin dashboard, outside',
        '   the web root, never in git and never in a release archive.',
        '',
        '   The password is whatever the configured provider issues: an SMTP key from a',
        '   transactional provider, or an app password if the relay is a mailbox. Never an',
        '   account password. */',
        'declare(strict_types=1);',
        '',
        'const NGS_SMTP_HOST   = ' . $q((string) $c['host']) . ';',
        'const NGS_SMTP_PORT   = ' . (int) $c['port'] . ';',
        'const NGS_SMTP_SECURE = ' . $q((string) $c['secure']) . ';',
        'const NGS_SMTP_USER   = ' . $q((string) $c['user']) . ';',
        'const NGS_SMTP_PASS   = ' . $q((string) $c['pass']) . ';',
        'const NGS_SMTP_FROM   = ' . $q((string) $c['from']) . ';',
        'const NGS_SMTP_NAME   = ' . $q((string) $c['name']) . ';',
        '',
    ];
    $path = pc_smtp_file();
    if (!is_dir(dirname($path)) || !is_writable(dirname($path))) {
        return ['ok' => false, 'error' => 'The data directory is not writable by PHP. Nothing was saved.'];
    }
    $tmp = $path . '.new';
    if (@file_put_contents($tmp, implode("
", $lines), LOCK_EX) === false) {
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

/* ---------- the message ----------
   One template, three purposes. The bonus used to build its own plain message and hand it
   to mail(); sharing this means all of them arrive looking like NextGen and travel the same
   authenticated route.

   The plain-text half used to be written out longhand in the voting wording, whatever
   purpose it was called with -- so a registration code arrived as HTML about registration
   and text about casting a vote. It is built from the same two strings as the HTML now, so
   a new purpose cannot say two different things to the same reader. */
function pc_email_code_body(string $code, string $purpose = 'vote', int $minutes = 10): array
{
    if ($purpose === 'bonus') {
        $head = 'Your registration verification code';
        $why = 'Enter this code to confirm your NextGen Summit registration and unlock two extra voting points.';
        $ignore = "If you didn't request this code, you can ignore this email - nothing has been confirmed.";
    } elseif ($purpose === 'game') {
        $head = 'Your NextGen Games code';
        $why = 'Enter this code to start NextGen Venture and pick up your NG$10,000 of virtual NextGen capital.';
        $ignore = "If you didn't request this code, you can ignore this email - no game has been started.";
    } else {
        $head = 'Your voting verification code';
        $why = "Enter this code to verify your email and cast your People's Choice vote.";
        $ignore = "If you didn't request this code, you can ignore this email - no vote has been cast.";
    }
    $mins = max(1, $minutes) . ' minutes';
    $pre = 'Your NextGen Summit code is ' . $code . '. It expires in ' . $mins . '.';
    $text = "NEXTGEN SUMMIT\n\n"
        . $head . "\n\n"
        . '    ' . $code . "\n\n"
        . $why . "\n\n"
        . 'This code expires in ' . $mins . ".\n"
        . $ignore . "\n\n"
        . "NextGen Summit 2026\n";

    $digits = '';
    foreach (str_split($code) as $d) {
        $digits .= '<td style="padding:0 5px"><div style="width:40px;height:52px;line-height:52px;'
            . 'text-align:center;border-radius:9px;background:#131719;color:#ffffff;'
            . 'font-family:Helvetica,Arial,sans-serif;font-size:26px;font-weight:700;'
            . 'letter-spacing:0">' . $d . '</div></td>';
    }

    /* Table layout and inline styles throughout: email clients do not have a modern CSS
       engine, and a flexbox layout here would arrive as a stack of unstyled text. */
    $html = '<!doctype html><html><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<title>Your NextGen voting code</title></head>'
        . '<body style="margin:0;padding:0;background:#06090A;">'
        . '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' . $pre . '</div>'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        . 'style="background:#06090A;padding:28px 14px">'
        . '<tr><td align="center">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        . 'style="max-width:460px;background:#0E1113;border-radius:16px;'
        . 'border:1px solid rgba(255,255,255,.1)">'
        . '<tr><td style="height:5px;background:#1FC7BE;border-radius:16px 16px 0 0"></td></tr>'
        . '<tr><td style="padding:30px 28px 8px">'
        . '<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:11px;'
        . 'letter-spacing:3px;text-transform:uppercase;color:#1FC7BE;font-weight:700">'
        . 'NextGen Summit</p>'
        . '<h1 style="margin:12px 0 0;font-family:Georgia,\'Times New Roman\',serif;'
        . 'font-size:27px;line-height:1.2;color:#ffffff;font-weight:700">'
        . $head . '</h1>'
        . '</td></tr>'
        . '<tr><td align="center" style="padding:24px 20px 6px">'
        . '<table role="presentation" cellpadding="0" cellspacing="0"><tr>' . $digits . '</tr></table>'
        . '</td></tr>'
        . '<tr><td style="padding:14px 28px 4px">'
        . '<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:15px;'
        . 'line-height:1.6;color:rgba(255,255,255,.78)">'
        . htmlspecialchars($why, ENT_QUOTES, 'UTF-8') . '</p>'
        . '<p style="margin:14px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;'
        . 'line-height:1.6;color:rgba(255,255,255,.55)">This code expires in ' . $mins . '.</p>'
        . '<p style="margin:8px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;'
        . 'line-height:1.6;color:rgba(255,255,255,.55)">'
        . "If you didn&rsquo;t request this code you can ignore this email &mdash; no vote has been cast.</p>"
        . '</td></tr>'
        . '<tr><td style="padding:22px 28px 28px">'
        . '<div style="height:1px;background:rgba(255,255,255,.12)"></div>'
        . '<p style="margin:16px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;'
        . 'line-height:1.6;color:rgba(255,255,255,.42)">'
        . 'NextGen Summit 2026 &middot; Friday, October 30 &middot; Gordon Center for Performing Arts'
        . '</p></td></tr>'
        . '</table></td></tr></table></body></html>';

    return ['html' => $html, 'text' => $text];
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
        /* The reply text used to be reduced to three digits and discarded, which is why
           "code=550" was as much as anyone could learn. Three digits cannot tell a daily
           sending limit from a policy block, and those call for opposite responses. */
        return ['ok' => false, 'step' => $label, 'code' => $code, 'reply' => pc_smtp_scrub($r)];
    }
    return ['ok' => true, 'code' => $code];
}

/**
 * A relay's reply, made safe to store and to read.
 *
 * A rejection usually quotes the envelope back, so the sender's address and the voter's can
 * both appear in it -- that is the first thing out. Long opaque runs go too, on the
 * principle that anything token-shaped should never be written down by accident. What
 * survives is the part that matters: the enhanced status code and the sentence after it.
 */
function pc_smtp_scrub(string $raw): string
{
    $t = preg_replace('/\s+/', ' ', trim($raw));
    $t = preg_replace('/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/', '<address>', $t);
    $t = preg_replace('/[A-Za-z0-9+\/=_-]{24,}/', '<redacted>', $t);
    return substr((string) $t, 0, 300);
}

/**
 * Deliver one message, retrying once when a retry is the right answer.
 *
 * A voter who is told "we could not send the email just now" is a voter who does not vote,
 * so a momentary refusal from the relay should not end their attempt. But only SOME
 * refusals are momentary, and retrying the others is worse than useless -- it burns a
 * second unit of a quota that has already run out, and it doubles the wait before the
 * person is told the truth.
 *
 * So: a failure to connect, or any 4xx, is tried once more after a short pause. A 5xx is
 * not. 535 means the app password is wrong and will still be wrong in six hundred
 * milliseconds; Gmail's daily-limit refusal is equally settled for the day.
 *
 * Whatever finally failed is recorded for the dashboard, because the detail currently only
 * reaches the server's error log -- which is exactly where nobody can see it while a
 * competition is running.
 *
 * @return array{ok:bool,error?:string,step?:string,code?:int}
 */
function pc_mail_send(string $to, string $subject, string $html, string $text): array
{
    $r = pc_mail_send_once($to, $subject, $html, $text);
    if (!empty($r['ok'])) {
        return $r;
    }
    $code = (int) ($r['code'] ?? 0);
    $worthRetrying = (($r['error'] ?? '') === 'connect') || ($code >= 400 && $code < 500);
    if ($worthRetrying) {
        usleep(600000);
        $again = pc_mail_send_once($to, $subject, $html, $text);
        if (!empty($again['ok'])) {
            return $again;
        }
        $r = $again;
    }
    pc_mail_note_failure($r, $worthRetrying);
    return $r;
}

/**
 * Leave the reason somewhere an administrator can read it.
 *
 * Nothing identifying: the step, the SMTP code and the time. No address, no subject, no
 * credential. It is stored in pc_meta, which no public endpoint returns.
 */
function pc_mail_note_failure(array $r, bool $retried): void
{
    if (!function_exists('pc_set_meta')) {
        return;                          // loaded without the People's Choice library
    }
    $bits = [];
    $bits[] = 'error=' . (string) ($r['error'] ?? 'unknown');
    if (isset($r['step'])) { $bits[] = 'step=' . (string) $r['step']; }
    if (isset($r['code'])) { $bits[] = 'code=' . (int) $r['code']; }
    $bits[] = $retried ? 'retried=yes' : 'retried=no';
    $bits[] = 'at=' . gmdate('Y-m-d H:i:s') . 'Z';
    if (!empty($r['reply'])) {
        $bits[] = 'reply=' . (string) $r['reply'];
    }
    try {
        pc_set_meta('smtp_last_error', implode(' ', $bits));
        $n = (int) pc_meta('smtp_fail_count', '0');
        pc_set_meta('smtp_fail_count', (string) ($n + 1));
    } catch (Throwable $e) {
        // a diagnostic that cannot be written must not become the failure it describes
    }
}

/** One attempt over the relay. */
function pc_mail_send_once(string $to, string $subject, string $html, string $text): array
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
        error_log("People's Choice: SMTP " . $r['step'] . ' got ' . $r['code'] . '. '
            . (string) ($r['reply'] ?? ''));
        return ['ok' => false, 'error' => 'smtp', 'step' => $r['step'], 'code' => $r['code'],
                'reply' => (string) ($r['reply'] ?? '')];
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
