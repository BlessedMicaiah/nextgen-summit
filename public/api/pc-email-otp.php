<?php
/* Verifying a voter by email.

   The same shape as the phone path, deliberately: a six-digit code the server generates, a
   hash of it stored, an expiry, a small number of attempts, cooldowns and per-identity and
   per-IP limits. What differs is the channel it travels over and the honesty about what it
   proves -- see pc-identity.php, which says the quiet part.

   WHAT IS NOT HERE

   No enumeration. Asking for a code tells the caller nothing about whether that address has
   voted, been seen before, or exists at all: the reply is the same either way. The only
   refusals that differ are the ones a legitimate person needs in order to act -- a malformed
   address, a throwaway domain, a cooldown they must wait out.

   Codes are never written to a log, never returned in a response, and never put in an error
   message. The only place the six digits exist outside the message is as an HMAC. */
declare(strict_types=1);

require_once __DIR__ . '/pc-identity.php';
require_once __DIR__ . '/pc-mailer.php';

const PC_EMAIL_CODE_TTL = 600;          // ten minutes, matching the SMS path
const PC_EMAIL_MAX_TRIES = 5;
const PC_EMAIL_COOLDOWN = 60;
const PC_EMAIL_MAX_PER_ADDR_PER_DAY = 5;
const PC_EMAIL_MAX_PER_IP_PER_HOUR = 20;

function pc_email_otp_table(): void
{
    $db = pc_db();
    if (!$db) {
        return;
    }
    $db->exec('CREATE TABLE IF NOT EXISTS pc_vote_email_otp (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ident      TEXT NOT NULL,
        code_hash  TEXT NOT NULL,
        mask       TEXT NOT NULL,
        tries      INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        ts         INTEGER NOT NULL
    )');
    $db->exec('CREATE INDEX IF NOT EXISTS pc_vote_email_otp_i ON pc_vote_email_otp (ident, ts)');
    $db->exec('CREATE TABLE IF NOT EXISTS pc_email_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ident      TEXT NOT NULL,
        ip_hash    TEXT,
        action     TEXT NOT NULL,
        ok         INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        ts         INTEGER NOT NULL
    )');
    $db->exec('CREATE INDEX IF NOT EXISTS pc_email_log_i ON pc_email_log (ident, ts)');
    $db->exec('CREATE INDEX IF NOT EXISTS pc_email_log_ip ON pc_email_log (ip_hash, ts)');
}

/** Records that a code was asked for. Holds the identity hash, never the address. */
function pc_email_note(string $ident, string $action, bool $ok): void
{
    pc_email_otp_table();
    $db = pc_db();
    if (!$db) {
        return;
    }
    $s = $db->prepare('INSERT INTO pc_email_log (ident, ip_hash, action, ok, created_at, ts)
                       VALUES (?, ?, ?, ?, ?, ?)');
    $s->execute([$ident, ngs_ip_hash(), $action, $ok ? 1 : 0, ngs_now(), time()]);
}

function pc_email_count(string $col, string $val, int $seconds): int
{
    pc_email_otp_table();
    $db = pc_db();
    if (!$db) {
        return 0;
    }
    $s = $db->prepare("SELECT COUNT(*) n FROM pc_email_log
                       WHERE $col = ? AND action = 'start' AND ts > ?");
    $s->execute([$val, time() - $seconds]);
    $r = $s->fetch();
    return (int) ($r['n'] ?? 0);
}

/** @return array{ok:bool,reason?:string,wait?:int} */
function pc_email_gate(string $ident): array
{
    pc_email_otp_table();
    $db = pc_db();
    if (!$db) {
        return ['ok' => false, 'reason' => 'store'];
    }
    $s = $db->prepare("SELECT ts FROM pc_email_log WHERE ident = ? AND action = 'start'
                       ORDER BY ts DESC LIMIT 1");
    $s->execute([$ident]);
    $r = $s->fetch();
    $last = (int) ($r['ts'] ?? 0);
    if ($last > 0 && time() - $last < PC_EMAIL_COOLDOWN) {
        return ['ok' => false, 'reason' => 'cooldown', 'wait' => PC_EMAIL_COOLDOWN - (time() - $last)];
    }
    if (pc_email_count('ident', $ident, 86400) >= PC_EMAIL_MAX_PER_ADDR_PER_DAY) {
        return ['ok' => false, 'reason' => 'addr_daily'];
    }
    if (pc_email_count('ip_hash', ngs_ip_hash(), 3600) >= PC_EMAIL_MAX_PER_IP_PER_HOUR) {
        return ['ok' => false, 'reason' => 'ip_hourly'];
    }
    return ['ok' => true];
}

/* ---------- the message ---------- */

function pc_email_code_body(string $code): array
{
    $pre = 'Your NextGen Summit voting code is ' . $code . '. It expires in 10 minutes.';
    $text = "NEXTGEN SUMMIT\n\n"
        . "Your voting verification code\n\n"
        . '    ' . $code . "\n\n"
        . "Enter this code to verify your email and cast your People's Choice vote.\n\n"
        . "This code expires in 10 minutes.\n"
        . "If you didn't request this code, you can ignore this email - no vote has been cast.\n\n"
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
        . 'Your voting verification code</h1>'
        . '</td></tr>'
        . '<tr><td align="center" style="padding:24px 20px 6px">'
        . '<table role="presentation" cellpadding="0" cellspacing="0"><tr>' . $digits . '</tr></table>'
        . '</td></tr>'
        . '<tr><td style="padding:14px 28px 4px">'
        . '<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:15px;'
        . 'line-height:1.6;color:rgba(255,255,255,.78)">'
        . "Enter this code to verify your email and cast your People&rsquo;s Choice vote.</p>"
        . '<p style="margin:14px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;'
        . 'line-height:1.6;color:rgba(255,255,255,.55)">This code expires in 10 minutes.</p>'
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

/* ---------- start and check ---------- */

/**
 * Send a code to an address.
 *
 * @return array{ok:bool,reason?:string,wait?:int,mask?:string}
 */
function pc_email_otp_start(string $email): array
{
    $email = trim($email);
    if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        return ['ok' => false, 'reason' => 'email'];
    }
    if (pc_email_disposable($email)) {
        return ['ok' => false, 'reason' => 'disposable'];
    }
    $ident = pc_email_identity($email);
    $gate = pc_email_gate($ident);
    if (!$gate['ok']) {
        return $gate;
    }
    if (!pc_smtp_configured()) {
        return ['ok' => false, 'reason' => 'mail_not_configured'];
    }

    $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    $body = pc_email_code_body($code);
    $sent = pc_mail_send($email, 'Your NextGen Voting Verification Code', $body['html'], $body['text']);
    if (!$sent['ok']) {
        pc_email_note($ident, 'failed', false);
        return ['ok' => false, 'reason' => 'mail'];
    }

    pc_email_otp_table();
    $db = pc_db();
    $db->prepare('DELETE FROM pc_vote_email_otp WHERE ident = ?')->execute([$ident]);
    $ins = $db->prepare('INSERT INTO pc_vote_email_otp (ident, code_hash, mask, tries, created_at, ts)
                         VALUES (?, ?, ?, 0, ?, ?)');
    $ins->execute([$ident, hash_hmac('sha256', $code, NGS_SECRET),
                   pc_email_mask($email), ngs_now(), time()]);
    unset($code, $body);
    pc_email_note($ident, 'start', true);
    return ['ok' => true, 'mask' => pc_email_mask($email)];
}

/**
 * Check a submitted code.
 *
 * @return array{ok:bool,reason?:string,tries_left?:int,ident?:string,mask?:string}
 */
function pc_email_otp_check(string $email, string $code): array
{
    $email = trim($email);
    if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        return ['ok' => false, 'reason' => 'email'];
    }
    $ident = pc_email_identity($email);
    $code = preg_replace('/\D+/', '', $code);

    pc_email_otp_table();
    $db = pc_db();
    if (!$db) {
        return ['ok' => false, 'reason' => 'store'];
    }
    $s = $db->prepare('SELECT * FROM pc_vote_email_otp WHERE ident = ? ORDER BY ts DESC LIMIT 1');
    $s->execute([$ident]);
    $row = $s->fetch();
    if (!$row) {
        return ['ok' => false, 'reason' => 'no_pending'];
    }
    if (time() - (int) $row['ts'] > PC_EMAIL_CODE_TTL) {
        $db->prepare('DELETE FROM pc_vote_email_otp WHERE id = ?')->execute([$row['id']]);
        return ['ok' => false, 'reason' => 'expired'];
    }
    if ((int) $row['tries'] >= PC_EMAIL_MAX_TRIES) {
        $db->prepare('DELETE FROM pc_vote_email_otp WHERE id = ?')->execute([$row['id']]);
        pc_flag($ident, 'email_attempts_exhausted');
        return ['ok' => false, 'reason' => 'attempts'];
    }
    $db->prepare('UPDATE pc_vote_email_otp SET tries = tries + 1 WHERE id = ?')->execute([$row['id']]);

    if (strlen($code) !== 6
        || !hash_equals((string) $row['code_hash'], hash_hmac('sha256', $code, NGS_SECRET))) {
        pc_email_note($ident, 'check', false);
        return ['ok' => false, 'reason' => 'code',
                'tries_left' => max(0, PC_EMAIL_MAX_TRIES - ((int) $row['tries'] + 1))];
    }
    $db->prepare('DELETE FROM pc_vote_email_otp WHERE id = ?')->execute([$row['id']]);
    pc_email_note($ident, 'check', true);
    pc_flag($ident, 'email_verified');

    /* Many identities verifying from one address is ordinary for an office and odd for a
       bedroom. Recorded rather than refused: blocking shared connections punishes schools,
       workplaces and anyone behind carrier-grade NAT, and the point is to have something to
       review before a result is certified. */
    $seen = pc_ip_identity_count();
    if ($seen >= 8) {
        pc_flag($ident, 'ip_many_identities', (string) $seen);
    }
    return ['ok' => true, 'ident' => $ident, 'mask' => (string) $row['mask']];
}
