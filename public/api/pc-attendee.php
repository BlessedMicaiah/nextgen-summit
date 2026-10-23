<?php
/* People's Choice — the verified-attendee bonus.

   WHAT HAS TO BE TRUE BEFORE TWO POINTS ARE AWARDED

     1. The voter is phone-verified. The bonus is only reachable from a session that already
        proved a phone number, so every request here has a voting identity behind it.
     2. An eligible Eventbrite registration exists for the email given. Eligible means
        status=attending and neither cancelled nor refunded -- the same test attendee-count.php
        already applies, reused rather than reinvented.
     3. The voter proved they own that email, by a code we sent to it. Knowing a registered
        person's address is not enough and must never be: the whole point of the code is that
        the claimant has to be able to read mail sent to it.
     4. That registration has never been linked to a different voting identity.
     5. The voter then explicitly asks for the points. Verification alone awards nothing.

   WHY A REGISTRATION BINDS TO EXACTLY ONE VOTER

   A group order holds several attendees and each is a separate entitlement, so three people on
   one order can each claim for themselves. What must not happen is one registration being
   walked around several voting identities, so the binding is stored per ATTENDEE record and a
   UNIQUE index refuses the second claim. The transaction does the refusing, not a check
   followed by a write, because two simultaneous requests would both pass a check.

   WHAT IS STORED

   Hashes. The attendee id and the email are kept only as HMACs under NGS_SECRET, the same way
   a phone number is. The index that makes the lookup fast holds hashed emails against attendee
   ids and no names, no addresses and no ticket details. Nothing here writes to Eventbrite. */
declare(strict_types=1);

require_once __DIR__ . '/pc-rules.php';
require_once __DIR__ . '/pc-mailer.php';   // the relay and the branded template

const PC_EB_INDEX_TTL = 900;          // rebuild the lookup index at most every 15 minutes
const PC_EB_CODE_TTL = 900;           // an email code is good for fifteen minutes
const PC_EB_MAX_TRIES = 5;
const PC_EB_MAX_PER_VOTER_PER_DAY = 5;

function pc_attendee_tables(): void
{
    $db = pc_db();
    if (!$db) {
        return;
    }
    /* One row per Eventbrite attendee that has been claimed. attendee_key is UNIQUE: that is
       the anti-reuse rule, enforced by the database rather than by application logic. */
    $db->exec('CREATE TABLE IF NOT EXISTS pc_attendee (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attendee_key TEXT NOT NULL UNIQUE,
        voter_key    TEXT NOT NULL,
        email_key    TEXT NOT NULL,
        created_at   TEXT NOT NULL
    )');
    $db->exec('CREATE INDEX IF NOT EXISTS pc_attendee_voter ON pc_attendee (voter_key)');
    $db->exec('CREATE TABLE IF NOT EXISTS pc_email_otp (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        voter_key  TEXT NOT NULL,
        email_key  TEXT NOT NULL,
        code_hash  TEXT NOT NULL,
        attendee_key TEXT NOT NULL,
        tries      INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        ts         INTEGER NOT NULL
    )');
    $db->exec('CREATE INDEX IF NOT EXISTS pc_email_otp_v ON pc_email_otp (voter_key, ts)');
}

function pc_email_key(string $email): string
{
    return 'eml:' . substr(hash_hmac('sha256', strtolower(trim($email)), NGS_SECRET), 0, 32);
}

function pc_attendee_key(string $eventbriteAttendeeId): string
{
    return 'att:' . substr(hash_hmac('sha256', $eventbriteAttendeeId, NGS_SECRET), 0, 32);
}

/* ---------- the Eventbrite side ----------

   attendee-count.php already knows how to walk this event's attendee list and which records to
   discard. This builds the one thing it does not keep: a map from a hashed email to the
   attendee id behind it, so a lookup does not re-walk 179 records every time somebody presses
   a button. No plaintext address is written to it. */

function pc_eb_token(): string
{
    if (defined('NGS_EVENTBRITE_TOKEN')) {
        return trim((string) constant('NGS_EVENTBRITE_TOKEN'));
    }
    return trim((string) getenv('EVENTBRITE_TOKEN'));
}

function pc_eb_index_file(): string
{
    return ngs_data_dir() . '/eventbrite-emails.json';
}

/**
 * Hashed-email -> attendee id, refreshed at most every PC_EB_INDEX_TTL seconds.
 *
 * @return array{ok:bool,map:array<string,string>,stale:bool}
 */
function pc_eb_email_index(bool $force = false): array
{
    $file = pc_eb_index_file();
    $have = [];
    $age = PHP_INT_MAX;
    if (is_file($file)) {
        $raw = json_decode((string) @file_get_contents($file), true);
        if (is_array($raw) && isset($raw['map']) && is_array($raw['map'])) {
            $have = $raw['map'];
            $age = time() - (int) ($raw['ts'] ?? 0);
        }
    }
    if (!$force && $age < PC_EB_INDEX_TTL) {
        return ['ok' => true, 'map' => $have, 'stale' => false];
    }

    $token = pc_eb_token();
    if ($token === '' || !function_exists('curl_init')) {
        // keep serving whatever we had rather than telling a real attendee they are not one
        return ['ok' => $have !== [], 'map' => $have, 'stale' => true];
    }

    $map = [];
    $url = 'https://www.eventbriteapi.com/v3/events/' . NGS_EB_EVENT_ID . '/attendees/?status=attending';
    $guard = 0;
    while ($url !== '' && $guard++ < 40) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token],
        ]);
        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($status < 200 || $status >= 300 || !is_string($body)) {
            return ['ok' => $have !== [], 'map' => $have, 'stale' => true];
        }
        $j = json_decode($body, true);
        if (!is_array($j)) {
            return ['ok' => $have !== [], 'map' => $have, 'stale' => true];
        }
        foreach (($j['attendees'] ?? []) as $a) {
            // the same eligibility test attendee-count.php uses, not a second opinion
            if (!is_array($a) || !empty($a['cancelled']) || !empty($a['refunded'])) {
                continue;
            }
            $email = (string) ($a['profile']['email'] ?? '');
            $id = (string) ($a['id'] ?? '');
            if ($email === '' || $id === '') {
                continue;
            }
            $map[pc_email_key($email)] = $id;    // hashed in, never stored in the clear
        }
        $more = !empty($j['pagination']['has_more_items']);
        $cont = (string) ($j['pagination']['continuation'] ?? '');
        $url = ($more && $cont !== '')
            ? 'https://www.eventbriteapi.com/v3/events/' . NGS_EB_EVENT_ID
              . '/attendees/?status=attending&continuation=' . rawurlencode($cont)
            : '';
    }

    $tmp = $file . '.new';
    if (@file_put_contents($tmp, json_encode(['ts' => time(), 'map' => $map]), LOCK_EX) !== false) {
        @chmod($tmp, 0600);
        @rename($tmp, $file);
    }
    return ['ok' => true, 'map' => $map, 'stale' => false];
}

/**
 * Is there an eligible registration for this email?
 *
 * @return array{found:bool,attendee_key:?string,unavailable:bool}
 */
function pc_eb_lookup(string $email): array
{
    $idx = pc_eb_email_index();
    if (!$idx['ok'] && $idx['stale']) {
        return ['found' => false, 'attendee_key' => null, 'unavailable' => true];
    }
    $k = pc_email_key($email);
    if (!isset($idx['map'][$k])) {
        /* One forced refresh before saying no: somebody who registered ten minutes ago is the
           likeliest person to be standing in front of this screen. */
        if (!$idx['stale']) {
            $idx = pc_eb_email_index(true);
        }
        if (!isset($idx['map'][$k])) {
            return ['found' => false, 'attendee_key' => null, 'unavailable' => false];
        }
    }
    return ['found' => true, 'attendee_key' => pc_attendee_key((string) $idx['map'][$k]),
            'unavailable' => false];
}


/**
 * Is there an eligible registration for an address we have ALREADY proven, given as hashes?
 *
 * Used for the automatic check after someone verifies their email to vote. No address is
 * passed in and none is stored -- only the one-way keys the session kept.
 *
 * @param string[] $keys
 * @return array{found:bool,attendee_key:?string,unavailable:bool}
 */
function pc_eb_lookup_keys(array $keys): array
{
    $idx = pc_eb_email_index();
    if (!$idx['ok'] && $idx['stale']) {
        return ['found' => false, 'attendee_key' => null, 'unavailable' => true];
    }
    foreach ($keys as $k) {
        if (isset($idx['map'][$k])) {
            return ['found' => true, 'attendee_key' => pc_attendee_key((string) $idx['map'][$k]),
                    'unavailable' => false];
        }
    }
    /* Somebody who bought a ticket ten minutes ago is exactly the person standing in front of
       this screen, so a miss on a cached index is rechecked once against Eventbrite itself. */
    if (!$idx['stale']) {
        $idx = pc_eb_email_index(true);
        foreach ($keys as $k) {
            if (isset($idx['map'][$k])) {
                return ['found' => true, 'attendee_key' => pc_attendee_key((string) $idx['map'][$k]),
                        'unavailable' => false];
            }
        }
    }
    return ['found' => false, 'attendee_key' => null, 'unavailable' => false];
}

/* ---------- the binding ---------- */

/** Which voting identity owns this registration, if any. */
function pc_attendee_owner(string $attendeeKey): ?string
{
    pc_attendee_tables();
    $db = pc_db();
    if (!$db) {
        return null;
    }
    $s = $db->prepare('SELECT voter_key FROM pc_attendee WHERE attendee_key = ? LIMIT 1');
    $s->execute([$attendeeKey]);
    $r = $s->fetch();
    return $r ? (string) $r['voter_key'] : null;
}

/** Does this voter already hold a verified registration? */
function pc_attendee_verified(string $voterKey): bool
{
    pc_attendee_tables();
    $db = pc_db();
    if (!$db) {
        return false;
    }
    $s = $db->prepare('SELECT 1 FROM pc_attendee WHERE voter_key = ? LIMIT 1');
    $s->execute([$voterKey]);
    return (bool) $s->fetch();
}

/**
 * Bind a registration to a voting identity, once and for all.
 *
 * The UNIQUE index refuses a second claim; this inserts and lets it, rather than checking
 * first, because two requests arriving together would both pass a check and only one can
 * actually win the row.
 *
 * @return array{ok:bool,reason?:string}
 */
function pc_attendee_bind(string $attendeeKey, string $voterKey, string $emailKey): array
{
    pc_attendee_tables();
    $db = pc_db();
    if (!$db) {
        return ['ok' => false, 'reason' => 'store'];
    }
    try {
        $db->beginTransaction();
        $s = $db->prepare('INSERT INTO pc_attendee (attendee_key, voter_key, email_key, created_at)
                           VALUES (?, ?, ?, ?)');
        $s->execute([$attendeeKey, $voterKey, $emailKey, ngs_now()]);
        $db->commit();
        return ['ok' => true];
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        $owner = pc_attendee_owner($attendeeKey);
        if ($owner !== null && $owner === $voterKey) {
            return ['ok' => true];              // already theirs; claiming twice is harmless
        }
        return ['ok' => false, 'reason' => 'claimed'];
    }
}

/* ---------- proving the email is theirs ---------- */

/**
 * Send a six-digit code to the address, and remember only its hash.
 *
 * @return array{ok:bool,reason?:string}
 */
function pc_email_code_send(string $voterKey, string $email, string $attendeeKey): array
{
    pc_attendee_tables();
    $db = pc_db();
    if (!$db) {
        return ['ok' => false, 'reason' => 'store'];
    }
    $emailKey = pc_email_key($email);

    $s = $db->prepare('SELECT COUNT(*) n FROM pc_email_otp WHERE voter_key = ? AND ts > ?');
    $s->execute([$voterKey, time() - 86400]);
    if ((int) (($s->fetch()['n']) ?? 0) >= PC_EB_MAX_PER_VOTER_PER_DAY) {
        return ['ok' => false, 'reason' => 'too_many'];
    }

    $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    $hash = hash_hmac('sha256', $code, NGS_SECRET);

    /* THE SAME RELAY THE VOTING CODE USES.

       This was written before the SMTP mailer existed and still handed its message to PHP's
       mail(), which on this host goes out unsigned from a shared MTA and does not arrive.
       Only the voting path was migrated, so the bonus has been silently failing to deliver
       ever since -- the lookup worked, the code was stored, and the email went nowhere.

       Nothing here needed rebuilding: the relay and the branded template already existed and
       the bonus simply was not using them. */
    if (!pc_smtp_configured()) {
        return ['ok' => false, 'reason' => 'mail_not_configured'];
    }
    $body = pc_email_code_body($code, 'bonus');
    $sent = pc_mail_send($email, 'Your NextGen Registration Verification Code',
                         $body['html'], $body['text']);
    if (!$sent['ok']) {
        error_log("People's Choice: attendee verification email not accepted ("
            . ($sent['error'] ?? '?') . ').');
        return ['ok' => false, 'reason' => 'mail',
                'mail_step' => $sent['step'] ?? ($sent['error'] ?? ''),
                'mail_code' => $sent['code'] ?? 0];
    }

    // one live attempt per voter at a time: the newest code is the only valid one
    $d = $db->prepare('DELETE FROM pc_email_otp WHERE voter_key = ?');
    $d->execute([$voterKey]);
    $i = $db->prepare('INSERT INTO pc_email_otp (voter_key, email_key, code_hash, attendee_key, tries, created_at, ts)
                       VALUES (?, ?, ?, ?, 0, ?, ?)');
    $i->execute([$voterKey, $emailKey, $hash, $attendeeKey, ngs_now(), time()]);
    return ['ok' => true];
}

/**
 * Check a submitted code.
 *
 * @return array{ok:bool,reason?:string,attendee_key?:string,email_key?:string}
 */
function pc_email_code_check(string $voterKey, string $code): array
{
    pc_attendee_tables();
    $db = pc_db();
    if (!$db) {
        return ['ok' => false, 'reason' => 'store'];
    }
    $code = preg_replace('/\D+/', '', $code);
    $s = $db->prepare('SELECT * FROM pc_email_otp WHERE voter_key = ? ORDER BY ts DESC LIMIT 1');
    $s->execute([$voterKey]);
    $row = $s->fetch();
    if (!$row) {
        return ['ok' => false, 'reason' => 'none'];
    }
    if (time() - (int) $row['ts'] > PC_EB_CODE_TTL) {
        $db->prepare('DELETE FROM pc_email_otp WHERE id = ?')->execute([$row['id']]);
        return ['ok' => false, 'reason' => 'expired'];
    }
    if ((int) $row['tries'] >= PC_EB_MAX_TRIES) {
        $db->prepare('DELETE FROM pc_email_otp WHERE id = ?')->execute([$row['id']]);
        return ['ok' => false, 'reason' => 'attempts'];
    }
    $db->prepare('UPDATE pc_email_otp SET tries = tries + 1 WHERE id = ?')->execute([$row['id']]);
    if (strlen($code) !== 6 || !hash_equals((string) $row['code_hash'], hash_hmac('sha256', $code, NGS_SECRET))) {
        return ['ok' => false, 'reason' => 'code',
                'tries_left' => max(0, PC_EB_MAX_TRIES - ((int) $row['tries'] + 1))];
    }
    $db->prepare('DELETE FROM pc_email_otp WHERE id = ?')->execute([$row['id']]);
    return ['ok' => true, 'attendee_key' => (string) $row['attendee_key'],
            'email_key' => (string) $row['email_key']];
}
