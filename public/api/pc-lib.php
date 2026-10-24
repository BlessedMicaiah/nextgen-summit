<?php
/* People's Choice Award — the vote store.

   Votes are rows, not counters. Nothing anywhere increments a number: every total on the
   dashboard is a COUNT over the rows that are still valid, worked out at the moment it is
   asked for. That is the only way an invalidated vote can disappear from a total correctly.

   One vote per voter is the database's job, not the browser's: voter_key is the primary key,
   so a second insert for the same voter fails at the storage layer whatever the client does.

   HONEST LIMIT: the rows are real and the counting is real, but who cast them is not. Until
   Google OAuth and email OTP are wired up, voter_key comes from a simulated verification, and
   every row is written with simulated = 1. Real ballots must never share a table with these;
   on staging they cannot, because release.py points the data directory at nextgen-data-staging. */
declare(strict_types=1);

require_once __DIR__ . '/_lib.php';

const PC_COMPETITION = 'peoples-choice-2026';
const PC_STATES = ['coming-soon', 'open', 'closed', 'results'];

/* ---------- storage ---------- */

function pc_db(): ?PDO
{
    static $pdo = false;
    if ($pdo !== false) {
        return $pdo;
    }
    $pdo = ngs_db();
    if ($pdo instanceof PDO) {
        /* One schema serves both voting rules, and the database enforces whichever is on.
           Under the approved single-vote rule every row is written with vote_day 'all' and
           slot 1, so the unique index below means one row per voter, full stop. Under the
           proposed daily rule vote_day is the Eastern date and slot runs 1..allowance, so the
           same index means no more than the allowance per voter per day. The limit is never a
           SELECT-then-INSERT that two requests can both pass: it is the index refusing. */
        $pdo->exec("CREATE TABLE IF NOT EXISTS pc_votes (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            competition TEXT NOT NULL,
            voter_key   TEXT NOT NULL,
            vote_day    TEXT NOT NULL DEFAULT 'all',
            slot        INTEGER NOT NULL DEFAULT 1,
            entrant_id  TEXT NOT NULL,
            created_at  TEXT NOT NULL,
            valid       INTEGER NOT NULL DEFAULT 1,
            simulated   INTEGER NOT NULL DEFAULT 1,
            ip_hash     TEXT,
            note        TEXT
        )");
        /* The first cut of this table had voter_key as the primary key, which cannot express an
           allowance greater than one. Staging may still hold it; move those rows across. */
        try {
            $cols = $pdo->query('PRAGMA table_info(pc_votes)')->fetchAll();
            $names = array_column($cols, 'name');
            if (!in_array('slot', $names, true)) {
                $pdo->exec('ALTER TABLE pc_votes RENAME TO pc_votes_v1');
                $pdo->exec("CREATE TABLE pc_votes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, competition TEXT NOT NULL,
                    voter_key TEXT NOT NULL, vote_day TEXT NOT NULL DEFAULT 'all',
                    slot INTEGER NOT NULL DEFAULT 1, entrant_id TEXT NOT NULL,
                    created_at TEXT NOT NULL, valid INTEGER NOT NULL DEFAULT 1,
                    simulated INTEGER NOT NULL DEFAULT 1, ip_hash TEXT, note TEXT)");
                $pdo->exec("INSERT INTO pc_votes (competition, voter_key, vote_day, slot,
                        entrant_id, created_at, valid, simulated, ip_hash)
                    SELECT competition, voter_key, 'all', 1, entrant_id, created_at,
                        valid, simulated, ip_hash FROM pc_votes_v1");
                $pdo->exec('DROP TABLE pc_votes_v1');
                $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS pc_votes_one
                            ON pc_votes (competition, voter_key, vote_day, slot)');
                $pdo->exec('CREATE INDEX IF NOT EXISTS pc_votes_tally
                            ON pc_votes (competition, valid, entrant_id)');
            }
        } catch (Throwable $e) {
            error_log("People's Choice: vote table migration skipped. " . $e->getMessage());
        }

        /* Indexes last: on a database still holding the first cut of this table, the unique
           index names a column that does not exist there yet, and creating it before the
           migration had run was a fatal error on every request. */
        $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS pc_votes_one
                    ON pc_votes (competition, voter_key, vote_day, slot)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS pc_votes_tally ON pc_votes (competition, valid, entrant_id)');
        $pdo->exec('CREATE TABLE IF NOT EXISTS pc_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    }
    return $pdo;
}

/* Where SQLite is unavailable the rows live in a JSON file instead, taken and written under an
   exclusive lock. Same shape, same rules, so the rest of this file does not care which is in
   use -- but SQLite is what the server runs, and it is the one enforcing the primary key. */
function pc_file(): string
{
    return ngs_data_dir() . '/nextgen-' . NGS_DATA_KEY . '-peoples-choice.json';
}

function pc_file_read(): array
{
    $p = pc_file();
    if (!is_file($p)) {
        return ['votes' => [], 'meta' => []];
    }
    $raw = (string) file_get_contents($p);
    $d = json_decode($raw, true);
    return is_array($d) ? $d + ['votes' => [], 'meta' => []] : ['votes' => [], 'meta' => []];
}

function pc_file_write(array $d): void
{
    ngs_protect_dir(ngs_data_dir());
    file_put_contents(pc_file(), json_encode($d, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), LOCK_EX);
}

/* ---------- the competition's state, held by the server ----------
   A deadline the browser can argue with is not a deadline, so the state and the closing time
   live here and every vote is checked against them server-side. */

function pc_meta(string $k, ?string $fallback = null): ?string
{
    $db = pc_db();
    if ($db) {
        $s = $db->prepare('SELECT v FROM pc_meta WHERE k = ?');
        $s->execute([$k]);
        $r = $s->fetch();
        return $r ? (string) $r['v'] : $fallback;
    }
    $d = pc_file_read();
    return isset($d['meta'][$k]) ? (string) $d['meta'][$k] : $fallback;
}

function pc_set_meta(string $k, string $v): void
{
    $db = pc_db();
    if ($db) {
        $s = $db->prepare('INSERT INTO pc_meta (k, v) VALUES (?, ?)
                           ON CONFLICT(k) DO UPDATE SET v = excluded.v');
        $s->execute([$k, $v]);
        return;
    }
    $d = pc_file_read();
    $d['meta'][$k] = $v;
    pc_file_write($d);
}

function pc_state(): string
{
    $s = (string) pc_meta('state', 'coming-soon');
    return in_array($s, PC_STATES, true) ? $s : 'coming-soon';
}

function pc_deadline(): ?string
{
    $d = pc_meta('deadline');
    return $d !== null && $d !== '' ? $d : null;
}

const PC_TZ = 'America/New_York';

/* The competition runs on Eastern time, not on whatever the visitor's laptop believes. A
   deadline stored without an offset -- "2026-10-29 00:00:00" -- is read as Eastern here, so
   the server resolves daylight saving itself rather than anyone hardcoding an offset and
   being an hour wrong after the clocks change. */
function pc_deadline_ts(): ?int
{
    $d = pc_deadline();
    if ($d === null) {
        return null;
    }
    try {
        return (new DateTime($d, new DateTimeZone(PC_TZ)))->getTimestamp();
    } catch (Throwable $e) {
        $t = strtotime($d);
        return $t === false ? null : $t;
    }
}

/** The cutoff as an absolute instant, which is what the browser counts down to. */
function pc_deadline_iso(): ?string
{
    $t = pc_deadline_ts();
    if ($t === null) {
        return null;
    }
    $dt = new DateTime('@' . $t);
    $dt->setTimezone(new DateTimeZone(PC_TZ));
    return $dt->format('c');
}

/* Voting is open only if the state says so AND the deadline has not passed. Both are read
   here, on the server, on every single vote. */
function pc_voting_open(): bool
{
    if (pc_state() !== 'open') {
        return false;
    }
    $t = pc_deadline_ts();
    if ($t === null) {
        return true;
    }
    return time() < $t;        // exclusive: at the cutoff instant, voting is shut
}

/* ---------- casting ---------- */

/* Casting a vote claims a slot. The allowance is not checked and then written -- two requests
   arriving together would both pass that check -- it is claimed by inserting, and the unique
   index decides. A clash means the slot went to someone else's request, so the next slot is
   tried, up to the allowance, and then it is a refusal.
   @return array{ok:bool,reason?:string,remaining?:int} */
function pc_cast(string $voterKey, string $entrantId, bool $simulated = true, bool $ticketHolder = false): array
{
    if (!pc_voting_open()) {
        return ['ok' => false, 'reason' => 'closed'];
    }
    $daily = function_exists('pc_mode') && pc_mode() === 'daily';
    $day = $daily ? pc_day() : 'all';
    $allow = function_exists('pc_allowance') ? pc_allowance($ticketHolder) : 1;
    $now = ngs_now();
    $ip = ngs_ip_hash();

    $db = pc_db();
    if ($db) {
        for ($slot = 1; $slot <= $allow; $slot++) {
            try {
                $db->beginTransaction();
                $s = $db->prepare('INSERT INTO pc_votes
                    (competition, voter_key, vote_day, slot, entrant_id, created_at, valid, simulated, ip_hash)
                    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)');
                $s->execute([PC_COMPETITION, $voterKey, $day, $slot, $entrantId, $now, $simulated ? 1 : 0, $ip]);
                $db->commit();
                return ['ok' => true, 'remaining' => max(0, $allow - $slot)];
            } catch (Throwable $e) {
                if ($db->inTransaction()) {
                    $db->rollBack();
                }
                // that slot is taken; try the next one, and run out if the allowance is spent
            }
        }
        return ['ok' => false, 'reason' => 'allowance', 'remaining' => 0];
    }

    $d = pc_file_read();
    $used = 0;
    foreach ($d['votes'] as $v) {
        if (($v['voter_key'] ?? '') === $voterKey && ($v['vote_day'] ?? 'all') === $day
            && (int) ($v['valid'] ?? 1) === 1) {
            $used++;
        }
    }
    if ($used >= $allow) {
        return ['ok' => false, 'reason' => 'allowance', 'remaining' => 0];
    }
    $d['votes'][] = [
        'voter_key' => $voterKey, 'competition' => PC_COMPETITION, 'vote_day' => $day,
        'slot' => $used + 1, 'entrant_id' => $entrantId, 'created_at' => $now,
        'valid' => 1, 'simulated' => $simulated ? 1 : 0, 'ip_hash' => $ip,
    ];
    pc_file_write($d);
    return ['ok' => true, 'remaining' => max(0, $allow - ($used + 1))];
}

/** Under the approved rule this is "has voted"; under the proposed one, "allowance spent". */
function pc_has_voted(string $voterKey, bool $ticketHolder = false): bool
{
    if (function_exists('pc_remaining')) {
        return pc_remaining($voterKey, $ticketHolder) <= 0;
    }
    $db = pc_db();
    if ($db) {
        $s = $db->prepare('SELECT 1 FROM pc_votes WHERE competition = ? AND voter_key = ? AND valid = 1');
        $s->execute([PC_COMPETITION, $voterKey]);
        return (bool) $s->fetch();
    }
    foreach (pc_file_read()['votes'] as $v) {
        if (($v['voter_key'] ?? '') === $voterKey && (int) ($v['valid'] ?? 1) === 1) {
            return true;
        }
    }
    return false;
}

/* ---------- counting ----------
   Counted from the rows every time. Invalidate a vote and the next tally simply does not see
   it, which is what "removed from the displayed valid totals" has to mean. */

/** @return array<string,int> entrant id => valid votes */
function pc_tally(): array
{
    $out = [];
    $db = pc_db();
    if ($db) {
        $s = $db->prepare('SELECT entrant_id, COUNT(*) AS n FROM pc_votes
                           WHERE competition = ? AND valid = 1 GROUP BY entrant_id');
        $s->execute([PC_COMPETITION]);
        foreach ($s->fetchAll() as $r) {
            $out[(string) $r['entrant_id']] = (int) $r['n'];
        }
        return $out;
    }
    foreach (pc_file_read()['votes'] as $v) {
        if ((int) ($v['valid'] ?? 1) !== 1) {
            continue;
        }
        $id = (string) ($v['entrant_id'] ?? '');
        $out[$id] = ($out[$id] ?? 0) + 1;
    }
    return $out;
}

function pc_invalidated_count(): int
{
    $db = pc_db();
    if ($db) {
        $s = $db->prepare('SELECT COUNT(*) AS n FROM pc_votes WHERE competition = ? AND valid = 0');
        $s->execute([PC_COMPETITION]);
        $r = $s->fetch();
        return (int) ($r['n'] ?? 0);
    }
    $n = 0;
    foreach (pc_file_read()['votes'] as $v) {
        if ((int) ($v['valid'] ?? 1) !== 1) {
            $n++;
        }
    }
    return $n;
}

/* ---------- the competition day by day ----------

   The running total answers "who is winning". It cannot answer "is today going well", "did
   the Monday push work" or "why did yesterday jump", and in a competition whose whole shape
   is a daily allowance those are the questions an administrator actually has.

   Every row already carries vote_day -- the Eastern date the allowance was spent against --
   so this is a grouping, not new bookkeeping. Nothing is written and no vote is touched.

   Counted the way the dashboard counts elsewhere: valid = 1, simulated included, with the
   simulated share broken out so test data can never be mistaken for turnout.

   @return list<array{day:string,points:int,voters:int,bonus:int,simulated:int,
                      top:?array{id:string,name:string,company:string,points:int}}>
*/
function pc_daily(int $limit = 21): array
{
    $limit = max(1, min(400, $limit));
    $names = [];
    foreach (pc_entrants() as $e) {
        $names[$e['id']] = $e;
    }

    /* day => [points, voters set, bonus, simulated, per-entrant counts] */
    $acc = [];
    $add = function (string $day, string $entrant, string $voter, int $slot, int $sim) use (&$acc): void {
        if (!isset($acc[$day])) {
            $acc[$day] = ['points' => 0, 'voters' => [], 'bonus' => 0, 'simulated' => 0, 'by' => []];
        }
        $acc[$day]['points']++;
        $acc[$day]['voters'][$voter] = true;
        if ($slot > 1) {
            $acc[$day]['bonus']++;           // slot 1 is the base point; 2 and 3 are the attendee bonus
        }
        if ($sim === 1) {
            $acc[$day]['simulated']++;
        }
        $acc[$day]['by'][$entrant] = ($acc[$day]['by'][$entrant] ?? 0) + 1;
    };

    $db = pc_db();
    if ($db) {
        $s = $db->prepare('SELECT vote_day, entrant_id, voter_key, slot, simulated
                           FROM pc_votes WHERE competition = ? AND valid = 1');
        $s->execute([PC_COMPETITION]);
        foreach ($s->fetchAll() as $r) {
            $add((string) $r['vote_day'], (string) $r['entrant_id'], (string) $r['voter_key'],
                 (int) $r['slot'], (int) $r['simulated']);
        }
    } else {
        foreach (pc_file_read()['votes'] as $v) {
            if ((int) ($v['valid'] ?? 1) !== 1) {
                continue;
            }
            $add((string) ($v['vote_day'] ?? 'all'), (string) ($v['entrant_id'] ?? ''),
                 (string) ($v['voter_key'] ?? ''), (int) ($v['slot'] ?? 1),
                 (int) ($v['simulated'] ?? 1));
        }
    }

    krsort($acc);                            // newest day first
    $out = [];
    foreach (array_slice($acc, 0, $limit, true) as $day => $a) {
        $top = null;
        arsort($a['by']);
        foreach ($a['by'] as $id => $n) {
            $e = $names[$id] ?? null;
            $top = [
                'id' => $id,
                'name' => $e['name'] ?? $id,
                'company' => $e['company'] ?? '',
                'points' => $n,
            ];
            break;                           // arsort put the leader first
        }
        $out[] = [
            'day' => $day,
            'points' => $a['points'],
            'voters' => count($a['voters']),
            'bonus' => $a['bonus'],
            'simulated' => $a['simulated'],
            'top' => $top,
        ];
    }
    return $out;
}

/** Rank the whole field. Equal counts share a rank, so a tie reads as a tie. */
function pc_standings(array $entrants): array
{
    $tally = pc_tally();
    $rows = [];
    foreach ($entrants as $e) {
        $rows[] = [
            'id' => $e['id'],
            'name' => $e['name'],
            'company' => $e['company'],
            'shot' => $e['shot'] ?? null,
            'votes' => (int) ($tally[$e['id']] ?? 0),
        ];
    }
    usort($rows, function ($a, $b) {
        if ($a['votes'] !== $b['votes']) {
            return $b['votes'] <=> $a['votes'];
        }
        return strcmp($a['id'], $b['id']);        // stable, and not a hidden ranking
    });
    $rank = 0;
    $seen = 0;
    $last = null;
    foreach ($rows as $i => $r) {
        $seen++;
        if ($last === null || $r['votes'] !== $last) {
            $rank = $seen;
            $last = $r['votes'];
        }
        $rows[$i]['rank'] = $rank;
    }
    return $rows;
}

/* The leader, or the leaders. Nobody is picked out of a tie: if three people share the top
   count, all three are returned and the dashboard says so. A field with no votes at all has
   no leader, which is different from a tie. */
function pc_leaders(array $standings): array
{
    if (!$standings || $standings[0]['votes'] === 0) {
        return [];
    }
    $top = $standings[0]['votes'];
    return array_values(array_filter($standings, function ($r) use ($top) {
        return $r['votes'] === $top;
    }));
}

function pc_invalidate(string $voterKey, bool $invalid = true): bool
{
    $db = pc_db();
    if ($db) {
        $s = $db->prepare('UPDATE pc_votes SET valid = ? WHERE competition = ? AND voter_key = ?');
        $s->execute([$invalid ? 0 : 1, PC_COMPETITION, $voterKey]);
        return $s->rowCount() > 0;
    }
    $d = pc_file_read();
    $hit = false;
    foreach ($d['votes'] as $i => $v) {
        if (($v['voter_key'] ?? '') === $voterKey) {
            $d['votes'][$i]['valid'] = $invalid ? 0 : 1;
            $hit = true;
        }
    }
    if ($hit) {
        pc_file_write($d);
    }
    return $hit;
}

/** Every vote row, newest first, for the review table. Never public. */
function pc_rows(int $limit = 500): array
{
    $db = pc_db();
    if ($db) {
        $s = $db->prepare('SELECT voter_key, entrant_id, created_at, valid, simulated, ip_hash, vote_day, slot
                           FROM pc_votes WHERE competition = ? ORDER BY created_at DESC, id DESC LIMIT ?');
        $s->execute([PC_COMPETITION, $limit]);
        return $s->fetchAll();
    }
    $v = pc_file_read()['votes'];
    usort($v, function ($a, $b) { return strcmp((string) $b['created_at'], (string) $a['created_at']); });
    return array_slice($v, 0, $limit);
}

/** Only ever used on test data. */
function pc_reset(): void
{
    $db = pc_db();
    if ($db) {
        $db->prepare('DELETE FROM pc_votes WHERE competition = ?')->execute([PC_COMPETITION]);
        return;
    }
    $d = pc_file_read();
    $d['votes'] = [];
    pc_file_write($d);
}

/* ---------- who the voter is ----------

   Until now nothing here knew. A voter is a one-way HMAC of their email or phone number
   (pc-identity.php, pc-twilio.php), which is what let the dashboard honestly say no address
   was stored -- and also what made "who voted for whom" unanswerable.

   Leadership needs that answer for reporting, so verified addresses are now recorded. Three
   things follow from that, and they are the whole design:

   1. ONLY WHAT THE VOTER PROVED. An email appears here because the person held a code sent
      to it. A phone voter who never gave an address has no address, and the dashboard says
      "Not provided" rather than guessing one.
   2. NOTHING IS BACKFILLED. The hash is one way, so votes cast before this will never have
      a name or an address against them. That is a fact about the hash, not a bug to fix,
      and inventing a plausible address would be worse than the gap.
   3. AN EVENTBRITE NAME MEANS A PROVEN REGISTRATION. It is written only by the bonus flow,
      after the registration has been bound to this identity. A matching address in the
      attendee list is not, on its own, evidence that this voter is that attendee.

   The table lives in the same database, outside the web root, and is never served publicly:
   pc-rank.php and every other public endpoint read votes, never this.
*/
function pc_voter_table(): void
{
    $db = pc_db();
    if (!$db) {
        return;
    }
    $db->exec('CREATE TABLE IF NOT EXISTS pc_voter (
        ident      TEXT PRIMARY KEY,
        email      TEXT,
        channel    TEXT,
        eb_status  TEXT,
        eb_first   TEXT,
        eb_last    TEXT,
        first_seen TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )');
}

/**
 * Record what a verification just proved about this identity.
 *
 * Only non-empty fields are written, so a later phone verification cannot blank an email
 * proved earlier, and a plain email verification cannot erase an Eventbrite name.
 *
 * @param array{email?:string,channel?:string,eb_status?:string,eb_first?:string,eb_last?:string} $f
 */
function pc_voter_note(string $ident, array $f): void
{
    if ($ident === '') {
        return;
    }
    pc_voter_table();
    $db = pc_db();
    if (!$db) {
        return;
    }
    $cols = ['email', 'channel', 'eb_status', 'eb_first', 'eb_last'];
    $set = [];
    $args = [];
    foreach ($cols as $c) {
        $v = isset($f[$c]) ? trim((string) $f[$c]) : '';
        if ($v !== '') {
            $set[] = $c;
            $args[$c] = $v;
        }
    }
    $now = ngs_now();
    try {
        $db->prepare('INSERT OR IGNORE INTO pc_voter (ident, first_seen, updated_at) VALUES (?, ?, ?)')
           ->execute([$ident, $now, $now]);
        if ($set === []) {
            return;
        }
        $sql = 'UPDATE pc_voter SET updated_at = ?, '
             . implode(', ', array_map(static function (string $c): string { return $c . ' = ?'; }, $set))
             . ' WHERE ident = ?';
        $db->prepare($sql)->execute(array_merge([$now], array_values($args), [$ident]));
    } catch (Throwable $e) {
        /* Reporting detail must never cost a vote. A verification that cannot be recorded
           here still verified. */
        error_log("People's Choice: could not record voter detail.");
    }
}

/**
 * Everything known about a set of voter keys, keyed by key.
 *
 * Votes carry the identity they were cast under; pc_identity may since have merged that with
 * another. Both are looked up, the vote's own key first, so a merge adds information and
 * never silently reattributes a vote to a different person's details.
 *
 * @param list<string> $keys
 * @return array<string, array{email:?string,channel:?string,eb_status:?string,eb_first:?string,eb_last:?string}>
 */
function pc_voter_map(array $keys): array
{
    $out = [];
    $keys = array_values(array_unique(array_filter($keys, static function ($k): bool {
        return is_string($k) && $k !== '';
    })));
    if ($keys === []) {
        return $out;
    }
    pc_voter_table();
    $db = pc_db();
    if (!$db) {
        return $out;
    }
    /* The vote's own key, plus whatever it has been merged into. */
    $want = $keys;
    $canon = [];
    foreach ($keys as $k) {
        $c = function_exists('pc_canonical') ? pc_canonical($k) : $k;
        $canon[$k] = $c;
        if ($c !== '' && $c !== $k) {
            $want[] = $c;
        }
    }
    $want = array_values(array_unique($want));
    $rows = [];
    try {
        $in = implode(',', array_fill(0, count($want), '?'));
        $s = $db->prepare('SELECT ident, email, channel, eb_status, eb_first, eb_last
                           FROM pc_voter WHERE ident IN (' . $in . ')');
        $s->execute($want);
        foreach ($s->fetchAll() as $r) {
            $rows[(string) $r['ident']] = [
                'email' => ($r['email'] ?? '') !== '' ? (string) $r['email'] : null,
                'channel' => ($r['channel'] ?? '') !== '' ? (string) $r['channel'] : null,
                'eb_status' => ($r['eb_status'] ?? '') !== '' ? (string) $r['eb_status'] : null,
                'eb_first' => ($r['eb_first'] ?? '') !== '' ? (string) $r['eb_first'] : null,
                'eb_last' => ($r['eb_last'] ?? '') !== '' ? (string) $r['eb_last'] : null,
            ];
        }
    } catch (Throwable $e) {
        return $out;
    }
    $blank = ['email' => null, 'channel' => null, 'eb_status' => null, 'eb_first' => null, 'eb_last' => null];
    foreach ($keys as $k) {
        $a = $rows[$k] ?? $blank;
        $b = $rows[$canon[$k]] ?? $blank;
        $merged = $blank;
        foreach ($blank as $field => $_) {
            $merged[$field] = $a[$field] ?? $b[$field];   // the vote's own identity wins
        }
        $out[$k] = $merged;
    }
    return $out;
}

/* ---------- the entrants ----------
   The twenty ids are generated here and never read from anywhere else. pc-vote.php and
   pc-rank.php validate against this list, so an id that went missing would silently make a
   founder unvotable -- which is why the loop below is the source of the ids and the manifest
   is only ever allowed to decorate them.

   The names used to be placeholders here ("Semifinalist 07", "Company to be confirmed") while
   the real roster lived only in the JavaScript the public page loads. The public page was
   therefore right and the admin dashboard was wrong, which made the standings table unusable
   for the one job it has: telling an administrator who is actually winning.

   So the manifest is read and overlaid by id. If it is missing, unreadable or malformed, every
   founder keeps its placeholder and nothing breaks. */
function pc_entrants(): array
{
    $real = pc_founder_manifest();
    $out = [];
    for ($i = 1; $i <= 20; $i++) {
        $n = str_pad((string) $i, 2, '0', STR_PAD_LEFT);
        $id = 'entrant-' . $n;
        $m = $real[$id] ?? null;
        $out[] = [
            'id' => $id,
            'n' => $n,
            'draft' => $m === null,
            'name' => $m['name'] ?? ('Semifinalist ' . $n),
            'company' => $m['company'] ?? 'Company to be confirmed',
            'shot' => $m['shot'] ?? null,
        ];
    }
    return $out;
}

/**
 * The public founder manifest, keyed by entrant id.
 *
 * tools/build-founders.py writes public/assets/js/pc-founders.js as a JavaScript assignment
 * wrapping a JSON array. Read as TEXT and json_decode'd -- it is data, and nothing about it
 * needs to be executed or evaluated here.
 *
 * Public fields only, and only the three the dashboard displays. Anything that fails -- no
 * file, no array, a name that is not a string -- returns what it has so far, and the caller
 * falls back to the placeholder for whatever is missing.
 *
 * @return array<string, array{name:string,company:string,shot:?string}>
 */
function pc_founder_manifest(): array
{
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }
    $cache = [];
    $f = dirname(__DIR__) . '/assets/js/pc-founders.js';
    if (!is_file($f) || !is_readable($f)) {
        return $cache;
    }
    $raw = @file_get_contents($f);
    if (!is_string($raw) || $raw === '') {
        return $cache;
    }
    /* From the first [ after the assignment to the last ] before the trailing semicolon. */
    $start = strpos($raw, '[');
    $end = strrpos($raw, ']');
    if ($start === false || $end === false || $end <= $start) {
        return $cache;
    }
    $rows = json_decode(substr($raw, $start, $end - $start + 1), true);
    if (!is_array($rows)) {
        return $cache;
    }
    foreach ($rows as $r) {
        if (!is_array($r) || !isset($r['entrant']) || !is_string($r['entrant'])) {
            continue;
        }
        $name = isset($r['name']) && is_string($r['name']) ? trim($r['name']) : '';
        $company = isset($r['company']) && is_string($r['company']) ? trim($r['company']) : '';
        if ($name === '') {
            continue;                       // nothing worth overlaying
        }
        $cache[$r['entrant']] = [
            'name' => $name,
            'company' => $company !== '' ? $company : 'Company to be confirmed',
            'shot' => isset($r['shot']) && is_string($r['shot']) ? $r['shot'] : null,
        ];
    }
    return $cache;
}
