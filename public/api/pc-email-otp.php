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

/* The branded message now lives in pc-mailer.php, so the Eventbrite bonus sends the same
   thing through the same relay rather than its own copy. */

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
    $body = pc_email_code_body($code, 'vote', (int) (PC_EMAIL_CODE_TTL / 60));
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
