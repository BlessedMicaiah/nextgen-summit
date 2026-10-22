<?php
/* Who a voter is, when the proof is an inbox rather than a handset.

   SAY THE LIMIT OUT LOUD

   A verified email proves control of an inbox. It does not prove a person. Inboxes are free
   and unlimited, and anyone determined to vote twenty times can. Everything in this file
   raises the cost of doing that; none of it makes the claim that one email is one human, and
   nothing built on top of it should pretend otherwise.

   A phone number has an acquisition cost, which is why SMS stays the stronger channel and why
   email-verified votes are flagged in the record so they can be reviewed separately before a
   result is certified.

   WHAT THIS DOES ACHIEVE

   Aliases that reach one inbox resolve to one voter. Throwaway domains are refused. And when
   somebody proves both a phone and an email in one session, the two identities are linked so
   that switching channels does not hand them a second vote -- which was the obvious hole the
   moment a second channel existed. */
declare(strict_types=1);

require_once __DIR__ . '/pc-lib.php';

/* Domains whose mail reaches one inbox however the local part is decorated. Gmail ignores dots
   entirely and everything after a plus; the Microsoft and Yahoo families honour the plus
   convention but not dots. Applied so that one person cannot become five voters with five
   spellings of the same address. */
const PC_DOT_BLIND = ['gmail.com', 'googlemail.com'];
const PC_PLUS_BLIND = ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
                       'msn.com', 'yahoo.com', 'ymail.com', 'proton.me', 'protonmail.com',
                       'icloud.com', 'me.com', 'fastmail.com'];

/* A short list rather than a service subscription. It catches the throwaway domains somebody
   reaches for in the moment; it will not catch a determined person, and is not meant to. */
const PC_DISPOSABLE = [
    'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', '10minutemail.com',
    'tempmail.com', 'temp-mail.org', 'throwawaymail.com', 'yopmail.com', 'sharklasers.com',
    'trashmail.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'fakeinbox.com',
    'mailnesia.com', 'mintemail.com', 'spamgourmet.com', 'tempinbox.com', 'mytemp.email',
    'moakt.com', 'emailondeck.com', 'burnermail.io', 'mohmal.com', 'tempr.email',
];

/**
 * The canonical spelling of an address, for identity purposes.
 *
 * Lower-cased, and for providers where decoration does not change the destination, stripped of
 * it. Deliberately conservative: a dot is only removed where the provider is known to ignore
 * it, because for most domains a.b@ and ab@ really are different people.
 */
function pc_email_normalise(string $email): string
{
    $email = strtolower(trim($email));
    $at = strrpos($email, '@');
    if ($at === false) {
        return $email;
    }
    $local = substr($email, 0, $at);
    $domain = substr($email, $at + 1);
    if (in_array($domain, PC_PLUS_BLIND, true)) {
        $plus = strpos($local, '+');
        if ($plus !== false) {
            $local = substr($local, 0, $plus);
        }
    }
    if (in_array($domain, PC_DOT_BLIND, true)) {
        $local = str_replace('.', '', $local);
    }
    if ($domain === 'googlemail.com') {
        $domain = 'gmail.com';
    }
    return $local . '@' . $domain;
}

function pc_email_disposable(string $email): bool
{
    $at = strrpos($email, '@');
    if ($at === false) {
        return false;
    }
    return in_array(strtolower(substr($email, $at + 1)), PC_DISPOSABLE, true);
}

/** The voting identity an address maps to. Normalised first, so aliases converge. */
function pc_email_identity(string $email): string
{
    return 'eml:' . substr(hash_hmac('sha256', pc_email_normalise($email), NGS_SECRET), 0, 32);
}

/** What a voter is shown of their own address. Never the whole thing. */
function pc_email_mask(string $email): string
{
    $at = strrpos($email, '@');
    if ($at === false || $at < 1) {
        return '***';
    }
    $local = substr($email, 0, $at);
    $domain = substr($email, $at + 1);
    $head = substr($local, 0, 1);
    $tail = strlen($local) > 2 ? substr($local, -1) : '';
    return $head . str_repeat('*', max(1, strlen($local) - 2)) . $tail . '@' . $domain;
}

/* ---------- linking identities that belong to one person ---------- */

function pc_identity_table(): void
{
    $db = pc_db();
    if (!$db) {
        return;
    }
    /* key -> canonical. A key maps to itself until it is merged with another, so every vote
       already in the table keeps the identity it was cast under. */
    $db->exec('CREATE TABLE IF NOT EXISTS pc_identity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ident     TEXT NOT NULL UNIQUE,
        canonical TEXT NOT NULL,
        created_at TEXT NOT NULL
    )');
    $db->exec('CREATE INDEX IF NOT EXISTS pc_identity_canon ON pc_identity (canonical)');
}

/**
 * The identity a key votes as.
 *
 * Unlinked keys resolve to themselves, which is why introducing this changes nothing about
 * votes already recorded.
 */
function pc_canonical(string $ident): string
{
    pc_identity_table();
    $db = pc_db();
    if (!$db) {
        return $ident;
    }
    $s = $db->prepare('SELECT canonical FROM pc_identity WHERE ident = ? LIMIT 1');
    $s->execute([$ident]);
    $r = $s->fetch();
    return $r ? (string) $r['canonical'] : $ident;
}

/**
 * Record that two identities belong to the same person, proven by that person verifying both.
 *
 * The phone side wins as canonical where there is one, because it is the stronger proof. Any
 * key already pointing at either side is repointed, so a third channel later does not split
 * the person in two.
 */
function pc_identity_link(string $a, string $b): void
{
    if ($a === '' || $b === '' || $a === $b) {
        return;
    }
    pc_identity_table();
    $db = pc_db();
    if (!$db) {
        return;
    }
    $ca = pc_canonical($a);
    $cb = pc_canonical($b);
    if ($ca === $cb) {
        return;
    }
    // prefer a phone identity as the canonical one; otherwise keep the older side
    $keep = strpos($ca, 'tel:') === 0 ? $ca : (strpos($cb, 'tel:') === 0 ? $cb : $ca);
    $drop = $keep === $ca ? $cb : $ca;
    try {
        $db->beginTransaction();
        $up = $db->prepare('UPDATE pc_identity SET canonical = ? WHERE canonical = ?');
        $up->execute([$keep, $drop]);
        foreach ([$a, $b, $ca, $cb] as $k) {
            $ins = $db->prepare('INSERT OR REPLACE INTO pc_identity (ident, canonical, created_at)
                                 VALUES (?, ?, ?)');
            $ins->execute([$k, $keep, ngs_now()]);
        }
        /* Votes already cast under the dropped identity move with it, so the day's allowance
           is counted once for the person rather than once per channel they proved. */
        $mv = $db->prepare('UPDATE pc_votes SET voter_key = ? WHERE voter_key = ?');
        $mv->execute([$keep, $drop]);
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        error_log("People's Choice: identity link failed.");
    }
}

/* ---------- a record worth reviewing before a result is certified ---------- */

function pc_flag_table(): void
{
    $db = pc_db();
    if (!$db) {
        return;
    }
    $db->exec('CREATE TABLE IF NOT EXISTS pc_flag (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ident      TEXT NOT NULL,
        kind       TEXT NOT NULL,
        detail     TEXT,
        ip_hash    TEXT,
        created_at TEXT NOT NULL,
        ts         INTEGER NOT NULL
    )');
    $db->exec('CREATE INDEX IF NOT EXISTS pc_flag_kind ON pc_flag (kind, ts)');
}

/** Note something worth a human look later. Holds no address and no code. */
function pc_flag(string $ident, string $kind, string $detail = ''): void
{
    pc_flag_table();
    $db = pc_db();
    if (!$db) {
        return;
    }
    try {
        $s = $db->prepare('INSERT INTO pc_flag (ident, kind, detail, ip_hash, created_at, ts)
                           VALUES (?, ?, ?, ?, ?, ?)');
        $s->execute([$ident, $kind, $detail, ngs_ip_hash(), ngs_now(), time()]);
    } catch (Throwable $e) {
        // a missing flag must never break a vote
    }
}

/**
 * How many distinct email identities have verified from this address today.
 *
 * One household on one connection is ordinary. Fifteen is worth a look, which is what this is
 * for -- it records, it does not refuse, because refusing on shared IPs punishes offices,
 * schools and anyone behind carrier-grade NAT.
 */
function pc_ip_identity_count(int $seconds = 86400): int
{
    pc_flag_table();
    $db = pc_db();
    if (!$db) {
        return 0;
    }
    try {
        $s = $db->prepare("SELECT COUNT(DISTINCT ident) n FROM pc_flag
                           WHERE kind = 'email_verified' AND ip_hash = ? AND ts > ?");
        $s->execute([ngs_ip_hash(), time() - $seconds]);
        $r = $s->fetch();
        return (int) ($r['n'] ?? 0);
    } catch (Throwable $e) {
        return 0;
    }
}
