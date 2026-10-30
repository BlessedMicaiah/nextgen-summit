<?php
/* NextGen Games — proving an email address.
 *
 * Same shape, same relay and same identity hash as the People's Choice email code, because
 * that path is proven and this is not the day to invent a second one. What it does NOT do
 * is write anything into the competition's tables.
 *
 * WHY NOT JUST CALL pc_email_otp_start / pc_email_otp_check
 *
 * Because they have side effects that belong to a ballot and not to a game. A successful
 * check there writes a row into pc_voter -- the table of addresses proved by an OTP, which
 * the analytics read when they answer how many PEOPLE voted -- and raises pc_flag entries,
 * including ip_many_identities once eight identities share an address. A room full of
 * attendees on one venue wifi would raise that flag for everybody.
 *
 * Voting closed at 23:59:59 on 28 October and the result is being finalised. Filling the
 * integrity-review table with flags from a game played after the close, on the day somebody
 * has to read those flags and certify a winner, is a bad trade for the hundred lines saved.
 *
 * So: the mailer is shared, the identity hash is shared (one address is the same person to
 * both systems, which is what makes the game's one-wallet rule mean anything), the branded
 * message is shared, the rate-limit shape is copied. The tables are the game's own and
 * nothing in here can touch a vote, a voter, a flag or a total.
 *
 * Codes are never logged, never returned and never put in an error. The only place the six
 * digits exist outside the message is as an HMAC.
 */
declare(strict_types=1);

require_once __DIR__ . '/pc-identity.php';
require_once __DIR__ . '/pc-mailer.php';
require_once __DIR__ . '/pc-attendee.php';   // the Eventbrite registration index, read-only

const NGG_CODE_TTL = 600;           // ten minutes
const NGG_MAX_TRIES = 5;
const NGG_COOLDOWN = 45;            // a live room re-reads its inbox faster than a voter did
const NGG_MAX_PER_ADDR_PER_DAY = 8;

/* THE VENUE IS ONE IP ADDRESS.

   Hundreds of phones on the Gordon Center wifi arrive here as a single address, so a
   per-IP ceiling sized for a bedroom would lock the whole room out of the game at the
   moment it is announced from the stage. The first cut of this file said 60 an hour,
   which is a bedroom number. What actually protects the relay and the inbox is the
   PER-ADDRESS pair above -- the cooldown and the daily cap -- and those are untouched.

   The per-IP limits that remain are there to catch a script, not a crowd: a burst cap a
   person cannot reach by hand, and an hourly cap a venue cannot reach by playing. */
const NGG_MAX_PER_IP_PER_MINUTE = 90;
const NGG_MAX_PER_IP_PER_HOUR = 1500;

function ngg_otp_tables(): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $db = pc_db();
    if (!$db) {
        return;
    }
    $db->exec('CREATE TABLE IF NOT EXISTS ngg_otp (
        ident      TEXT PRIMARY KEY,
        code_hash  TEXT NOT NULL,
        mask       TEXT NOT NULL,
        tries      INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        ts         INTEGER NOT NULL
    )');
    $db->exec('CREATE TABLE IF NOT EXISTS ngg_otp_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ident   TEXT NOT NULL,
        ip_hash TEXT,
        action  TEXT NOT NULL,
        ok      INTEGER NOT NULL DEFAULT 0,
        ts      INTEGER NOT NULL
    )');
    $db->exec('CREATE INDEX IF NOT EXISTS ngg_otp_log_i ON ngg_otp_log (ident, ts)');
    $db->exec('CREATE INDEX IF NOT EXISTS ngg_otp_log_ip ON ngg_otp_log (ip_hash, ts)');
    $done = true;
}

function ngg_otp_note(string $ident, string $action, bool $ok): void
{
    ngg_otp_tables();
    $db = pc_db();
    if (!$db) {
        return;
    }
    $db->prepare('INSERT INTO ngg_otp_log (ident, ip_hash, action, ok, ts) VALUES (?, ?, ?, ?, ?)')
       ->execute([$ident, ngs_ip_hash(), $action, $ok ? 1 : 0, time()]);
}

function ngg_otp_count(string $col, string $val, int $seconds): int
{
    ngg_otp_tables();
    $db = pc_db();
    if (!$db) {
        return 0;
    }
    $s = $db->prepare("SELECT COUNT(*) n FROM ngg_otp_log
                       WHERE $col = ? AND action = 'start' AND ok = 1 AND ts > ?");
    $s->execute([$val, time() - $seconds]);
    return (int) ($s->fetch()['n'] ?? 0);
}

/** @return array{ok:bool,reason?:string,wait?:int} */
function ngg_otp_gate(string $ident): array
{
    ngg_otp_tables();
    $db = pc_db();
    if (!$db) {
        return ['ok' => false, 'reason' => 'store'];
    }
    $s = $db->prepare("SELECT ts FROM ngg_otp_log WHERE ident = ? AND action = 'start' AND ok = 1
                       ORDER BY ts DESC LIMIT 1");
    $s->execute([$ident]);
    $last = (int) ($s->fetch()['ts'] ?? 0);
    if ($last > 0 && time() - $last < NGG_COOLDOWN) {
        return ['ok' => false, 'reason' => 'cooldown', 'wait' => NGG_COOLDOWN - (time() - $last)];
    }
    if (ngg_otp_count('ident', $ident, 86400) >= NGG_MAX_PER_ADDR_PER_DAY) {
        return ['ok' => false, 'reason' => 'addr_daily'];
    }
    if (ngg_otp_count('ip_hash', ngs_ip_hash(), 60) >= NGG_MAX_PER_IP_PER_MINUTE) {
        return ['ok' => false, 'reason' => 'ip_burst', 'wait' => 60];
    }
    if (ngg_otp_count('ip_hash', ngs_ip_hash(), 3600) >= NGG_MAX_PER_IP_PER_HOUR) {
        return ['ok' => false, 'reason' => 'ip_hourly'];
    }
    return ['ok' => true];
}

/**
 * Send a code.
 *
 * Says nothing about whether this address has played, been seen, or exists. The only
 * refusals that differ are the ones a real person needs in order to act.
 *
 * @return array{ok:bool,reason?:string,wait?:int,mask?:string}
 */
function ngg_otp_start(string $email): array
{
    $email = trim($email);
    if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        return ['ok' => false, 'reason' => 'email'];
    }
    if (pc_email_disposable($email)) {
        return ['ok' => false, 'reason' => 'disposable'];
    }
    $ident = pc_email_identity($email);
    $gate = ngg_otp_gate($ident);
    if (!$gate['ok']) {
        return $gate;
    }
    if (!pc_smtp_configured()) {
        return ['ok' => false, 'reason' => 'mail_not_configured'];
    }

    $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    $body = pc_email_code_body($code, 'game', (int) (NGG_CODE_TTL / 60));
    $sent = pc_mail_send($email, 'Your NextGen Games code', $body['html'], $body['text']);
    if (!$sent['ok']) {
        ngg_otp_note($ident, 'start', false);
        return ['ok' => false, 'reason' => 'mail'];
    }

    ngg_otp_tables();
    $db = pc_db();
    $db->prepare('INSERT INTO ngg_otp (ident, code_hash, mask, tries, created_at, ts)
                  VALUES (?, ?, ?, 0, ?, ?)
                  ON CONFLICT(ident) DO UPDATE SET code_hash = excluded.code_hash,
                      mask = excluded.mask, tries = 0, created_at = excluded.created_at,
                      ts = excluded.ts')
       ->execute([$ident, hash_hmac('sha256', $code, NGS_SECRET), pc_email_mask($email),
                  ngs_now(), time()]);
    unset($code, $body);
    ngg_otp_note($ident, 'start', true);
    return ['ok' => true, 'mask' => pc_email_mask($email)];
}

/**
 * Check a code.
 *
 * @return array{ok:bool,reason?:string,tries_left?:int,ident?:string,mask?:string}
 */
function ngg_otp_check(string $email, string $code): array
{
    $email = trim($email);
    if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        return ['ok' => false, 'reason' => 'email'];
    }
    $ident = pc_email_identity($email);
    $code = preg_replace('/\D+/', '', $code) ?? '';

    ngg_otp_tables();
    $db = pc_db();
    if (!$db) {
        return ['ok' => false, 'reason' => 'store'];
    }
    $s = $db->prepare('SELECT * FROM ngg_otp WHERE ident = ?');
    $s->execute([$ident]);
    $row = $s->fetch();
    if (!$row) {
        return ['ok' => false, 'reason' => 'no_pending'];
    }
    if (time() - (int) $row['ts'] > NGG_CODE_TTL) {
        $db->prepare('DELETE FROM ngg_otp WHERE ident = ?')->execute([$ident]);
        return ['ok' => false, 'reason' => 'expired'];
    }
    if ((int) $row['tries'] >= NGG_MAX_TRIES) {
        $db->prepare('DELETE FROM ngg_otp WHERE ident = ?')->execute([$ident]);
        return ['ok' => false, 'reason' => 'attempts'];
    }
    /* Counted before it is compared, so a wrong guess costs a try whatever happens next. */
    $db->prepare('UPDATE ngg_otp SET tries = tries + 1 WHERE ident = ?')->execute([$ident]);

    if (strlen($code) !== 6
        || !hash_equals((string) $row['code_hash'], hash_hmac('sha256', $code, NGS_SECRET))) {
        ngg_otp_note($ident, 'check', false);
        return ['ok' => false, 'reason' => 'code',
                'tries_left' => max(0, NGG_MAX_TRIES - ((int) $row['tries'] + 1))];
    }
    $db->prepare('DELETE FROM ngg_otp WHERE ident = ?')->execute([$ident]);
    ngg_otp_note($ident, 'check', true);
    return ['ok' => true, 'ident' => $ident, 'mask' => (string) $row['mask']];
}


/* ============================================================================
   SIGNING IN WITH AN EMAIL ALONE (30 October)

   Leadership's call on the day: the game is meant to be quick, so the six-digit code is
   gone. A player types the address they registered for NextGen Summit with and is in.

   What still holds:
   - The address has to belong to an eligible Eventbrite registration -- the same index
     and the same "attending, not cancelled, not refunded" test the People's Choice
     attendee bonus reads. Nothing here writes to that index or to any People's Choice
     table, and nothing here sends mail.
   - One address is still one wallet: the identity is the same hash as before.
   - If Eventbrite cannot be read at all (no token, no network, no cache yet), the address
     is let in rather than turning a room of real attendees away at the moment the game
     is announced. That case is logged as 'signin-open'.

   What no longer holds, and leadership was told: anybody who knows a registered
   attendee's address can open that attendee's wallet. NG$ is not money.

   The forced Eventbrite refresh on a miss (somebody who bought a ticket at the door) is
   rate-limited to once a minute for the whole site, so a room full of typos cannot turn
   into a room full of Eventbrite API walks. */

const NGG_EB_FORCE_EVERY = 60;

function ngg_eb_force_due(): bool
{
    ngg_otp_tables();
    $db = pc_db();
    if (!$db) {
        return false;
    }
    $s = $db->prepare("SELECT MAX(ts) t FROM ngg_otp_log WHERE ident = '*' AND action = 'eb-refresh'");
    $s->execute();
    $last = (int) ($s->fetch()['t'] ?? 0);
    return time() - $last >= NGG_EB_FORCE_EVERY;
}

/** @return array{found:bool,unavailable:bool} */
function ngg_registered(string $email): array
{
    $k = pc_email_key($email);
    $idx = pc_eb_email_index(false);
    if (!$idx['ok'] && $idx['stale']) {
        return ['found' => false, 'unavailable' => true];
    }
    if (isset($idx['map'][$k])) {
        return ['found' => true, 'unavailable' => false];
    }
    if (!$idx['stale'] && ngg_eb_force_due()) {
        ngg_otp_note('*', 'eb-refresh', true);
        $idx = pc_eb_email_index(true);
        if (isset($idx['map'][$k])) {
            return ['found' => true, 'unavailable' => false];
        }
    }
    /* A miss against a list we could not refresh is not a "no": during an Eventbrite outage
       anybody who registered after the last good pull would be turned away, and "try again
       in a minute" would not help them. Treat it as unreachable and let them in. */
    if ($idx['stale']) {
        return ['found' => false, 'unavailable' => true];
    }
    return ['found' => false, 'unavailable' => false];
}

/**
 * Sign in with an address alone.
 *
 * @return array{ok:bool,reason?:string,wait?:int,ident?:string,mask?:string}
 */
function ngg_email_signin(string $email): array
{
    $email = trim($email);
    if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        return ['ok' => false, 'reason' => 'email'];
    }
    if (pc_email_disposable($email)) {
        return ['ok' => false, 'reason' => 'disposable'];
    }
    // the per-network brakes from the code path, counted on sign-in attempts instead
    ngg_otp_tables();
    $db = pc_db();
    if (!$db) {
        return ['ok' => false, 'reason' => 'store'];
    }
    $ip = ngs_ip_hash();
    $n = $db->prepare("SELECT COUNT(*) n FROM ngg_otp_log WHERE ip_hash = ? AND action LIKE 'signin%' AND ts > ?");
    $n->execute([$ip, time() - 60]);
    if ((int) ($n->fetch()['n'] ?? 0) >= NGG_MAX_PER_IP_PER_MINUTE) {
        return ['ok' => false, 'reason' => 'ip_burst', 'wait' => 60];
    }
    $n->execute([$ip, time() - 3600]);
    if ((int) ($n->fetch()['n'] ?? 0) >= NGG_MAX_PER_IP_PER_HOUR) {
        return ['ok' => false, 'reason' => 'ip_hourly'];
    }

    $ident = pc_email_identity($email);
    $reg = ngg_registered($email);
    if (!$reg['found'] && !$reg['unavailable']) {
        ngg_otp_note($ident, 'signin', false);
        return ['ok' => false, 'reason' => 'not_registered'];
    }
    ngg_otp_note($ident, $reg['unavailable'] ? 'signin-open' : 'signin', true);
    return ['ok' => true, 'ident' => $ident, 'mask' => pc_email_mask($email)];
}

