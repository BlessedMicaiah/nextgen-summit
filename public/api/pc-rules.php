<?php
/* People's Choice — the voting rule, and contestant attribution.

   TWO VOTING MODELS LIVE HERE. Only one of them is switched on.

     'single'  one voter, one vote, for the whole competition.
     'daily'   an allowance that refills at midnight Eastern, larger for a
               verified ticket holder.                           <- APPROVED, and the default

   The default was 'single' for most of this project's life, deliberately, so that no deploy
   could quietly change the rules of a live competition. Leadership approved the daily rule in
   the production release authorisation of 2026-10-23 and asked specifically that it be
   explicit configuration rather than something an administrator has to remember to set on the
   dashboard after launch -- a fresh production database has no stored mode, so the fallback
   IS the rule there.

   1 point a day for a phone-verified voter, 2 more for a verified NextGen registration,
   3 maximum, reset at midnight America/New_York, closing at 12:00 AM Eastern on 29 October
   2026. The stored setting still wins where one exists, so an administrator can still change
   it; this only decides what a database that has never been configured does.

   Nothing here decides anything from browser storage, a cookie or an IP address. The allowance
   is counted from the vote rows, server-side, every time. */
declare(strict_types=1);

require_once __DIR__ . '/pc-lib.php';

const PC_MODE_DEFAULT = 'daily';
const PC_MODES = ['single', 'daily'];

function pc_mode(): string
{
    $m = (string) pc_meta('mode', PC_MODE_DEFAULT);
    return in_array($m, PC_MODES, true) ? $m : PC_MODE_DEFAULT;
}

/** How many votes this kind of voter gets per window. */
function pc_allowance(bool $ticketHolder = false): int
{
    if (pc_mode() === 'single') {
        return 1;                      // the approved rule: one, for the whole competition
    }
    /* These are TOTALS for the day, not increments. A verified attendee's three is the
       one phone-verified point plus the two the registration unlocks; it is stored as
       one number because the allowance is what the slot loop counts against. */
    $n = (int) pc_meta($ticketHolder ? 'daily_ticket' : 'daily_public', $ticketHolder ? '3' : '1');
    return max(0, min(10, $n));
}

/** The Eastern calendar day a moment belongs to. The allowance refills when this changes. */
function pc_day(?int $ts = null): string
{
    $dt = new DateTime('@' . ($ts ?? time()));
    $dt->setTimezone(new DateTimeZone(PC_TZ));
    return $dt->format('Y-m-d');
}

/** Votes this voter has already had counted in the current window. */
function pc_used(string $voterKey): int
{
    $single = pc_mode() === 'single';
    $db = pc_db();
    if ($db) {
        $sql = 'SELECT COUNT(*) AS n FROM pc_votes WHERE competition = ? AND voter_key LIKE ? AND valid = 1';
        $args = [PC_COMPETITION, $voterKey . '%'];
        $s = $db->prepare($sql);
        $s->execute($args);
        $r = $s->fetch();
        $n = (int) ($r['n'] ?? 0);
        if ($single) {
            return $n;
        }
        $s = $db->prepare('SELECT COUNT(*) AS n FROM pc_votes
                           WHERE competition = ? AND voter_key LIKE ? AND valid = 1 AND vote_day = ?');
        $s->execute([PC_COMPETITION, $voterKey . '%', pc_day()]);
        $r = $s->fetch();
        return (int) ($r['n'] ?? 0);
    }
    $n = 0;
    $day = pc_day();
    foreach (pc_file_read()['votes'] as $v) {
        if (strpos((string) ($v['voter_key'] ?? ''), $voterKey) !== 0 || (int) ($v['valid'] ?? 1) !== 1) {
            continue;
        }
        if ($single || ($v['vote_day'] ?? '') === $day) {
            $n++;
        }
    }
    return $n;
}

function pc_remaining(string $voterKey, bool $ticketHolder = false): int
{
    return max(0, pc_allowance($ticketHolder) - pc_used($voterKey));
}

/** When the allowance next refills: midnight Eastern, or never under the approved rule. */
function pc_next_window(): ?string
{
    if (pc_mode() === 'single') {
        return null;
    }
    $dt = new DateTime('now', new DateTimeZone(PC_TZ));
    $dt->modify('tomorrow midnight');
    return $dt->format('c');
}

/* ---------- attribution ----------
   How many visits a contestant's own sharing brought in, without following anyone around.
   No IP address is stored and no cookie is set: "visitor" is a hash of address, user agent and
   the Eastern day, salted with the server secret. It tells one person reloading from twenty
   people arriving, and it stops being linkable to anything tomorrow. */
function pc_visits_table(): void
{
    $db = pc_db();
    if (!$db) {
        return;
    }
    $db->exec('CREATE TABLE IF NOT EXISTS pc_visits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entrant_id TEXT NOT NULL,
        source     TEXT,
        day        TEXT NOT NULL,
        visitor    TEXT NOT NULL,
        created_at TEXT NOT NULL
    )');
    $db->exec('CREATE INDEX IF NOT EXISTS pc_visits_e ON pc_visits (entrant_id, day)');
}

function pc_visitor_token(): string
{
    $seed = ($_SERVER['REMOTE_ADDR'] ?? '') . '|' . ($_SERVER['HTTP_USER_AGENT'] ?? '') . '|' . pc_day();
    return substr(hash_hmac('sha256', $seed, NGS_SECRET), 0, 20);
}

function pc_log_visit(string $entrantId, ?string $source): void
{
    pc_visits_table();
    $src = $source !== null && $source !== '' ? substr(preg_replace('/[^a-z0-9_.-]/i', '', $source), 0, 40) : 'direct';
    $db = pc_db();
    if ($db) {
        $s = $db->prepare('INSERT INTO pc_visits (entrant_id, source, day, visitor, created_at)
                           VALUES (?, ?, ?, ?, ?)');
        $s->execute([$entrantId, $src, pc_day(), pc_visitor_token(), ngs_now()]);
        return;
    }
    $d = pc_file_read();
    $d['visits'] = $d['visits'] ?? [];
    $d['visits'][] = [
        'entrant_id' => $entrantId, 'source' => $src, 'day' => pc_day(),
        'visitor' => pc_visitor_token(), 'created_at' => ngs_now(),
    ];
    pc_file_write($d);
}

/** Visits and approximate unique visitors per contestant. Admin only, never public. */
function pc_traffic(): array
{
    pc_visits_table();
    $out = [];
    $db = pc_db();
    if ($db) {
        foreach ($db->query('SELECT entrant_id, COUNT(*) AS visits, COUNT(DISTINCT visitor) AS uniques
                             FROM pc_visits GROUP BY entrant_id')->fetchAll() as $r) {
            $out[(string) $r['entrant_id']] = ['visits' => (int) $r['visits'], 'uniques' => (int) $r['uniques']];
        }
        $src = $db->query('SELECT source, COUNT(*) AS n FROM pc_visits GROUP BY source ORDER BY n DESC')->fetchAll();
        return ['by_entrant' => $out, 'by_source' => $src];
    }
    $seen = [];
    foreach ((pc_file_read()['visits'] ?? []) as $v) {
        $e = (string) $v['entrant_id'];
        $out[$e] = $out[$e] ?? ['visits' => 0, 'uniques' => 0];
        $out[$e]['visits']++;
        $k = $e . '|' . $v['visitor'];
        if (!isset($seen[$k])) {
            $seen[$k] = 1;
            $out[$e]['uniques']++;
        }
    }
    return ['by_entrant' => $out, 'by_source' => []];
}

/** The slug a contestant's own page lives at. */
function pc_slug(array $e): string
{
    return trim(strtolower(preg_replace('/[^a-z0-9]+/i', '-', (string) $e['name'])), '-');
}

function pc_by_slug(string $slug): ?array
{
    foreach (pc_entrants() as $e) {
        if (pc_slug($e) === $slug) {
            return $e;
        }
    }
    return null;
}
