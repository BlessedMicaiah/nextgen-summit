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

/* Is the flexible voting rule in force?

   Under it a registration is worth a larger DAILY ALLOWANCE -- three votes instead of one --
   which the voter spends on whoever they like, rather than two extra points pinned to the
   founder they already backed.

   It is being trialled on staging, so the default is derived from the environment rather
   than from anything a request can influence: staging keeps its data in nextgen-data-staging
   and production does not. A pc_meta row still overrides it either way, so it can be turned
   on or off deliberately without a deploy.

   Production therefore cannot end up running this by accident. The only way it could is for
   somebody to write the meta row on production, which is a deliberate act in the dashboard. */
function pc_spread_votes(): bool
{
    $stored = pc_meta('spread_votes', null);
    if ($stored !== null) {
        return (string) $stored === '1';
    }
    try {
        return basename(ngs_data_dir()) === 'nextgen-data-staging';
    } catch (Throwable $e) {
        return false;
    }
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

/* ---------- destructive operations ----------

   WHAT WENT WRONG, SO IT IS NOT REINTRODUCED

   The People's Choice dashboard carries "Add test votes" and "Clear all votes" under a
   heading that reads "Staging only. These write to the staging data directory, which is a
   different file from the live one." That sentence was a description of INTENT, not a
   restriction: nothing checked. The controls rendered on production exactly as they do on
   the review site, pc_reset() ran DELETE FROM pc_votes against whatever pc_db() resolved
   to -- on production, the live ballot -- and the success notice then said the votes had
   been "cleared from the staging store". One click, every vote in the competition gone,
   and a confirmation message saying it had not happened.

   THE RULE NOW

   A destructive operation is permitted only where the store is POSITIVELY identified as
   the review store. Not "is not production" -- that fails open the moment anything about
   the path is unexpected. The check asks for one specific directory name and treats
   everything else, including an exception while working it out, as a refusal.

   WHERE IT IS ENFORCED

   Here, in the library, because that is the only layer a caller cannot skip. The dashboard
   also hides the controls and its POST handler refuses the action, but neither of those is
   the guarantee: a crafted POST straight at the endpoint meets this function, and this
   function says no. Three layers, and the one that matters is the innermost.
*/

/** The live site's own hostname. Everything else is, at most, a review site. */
const PC_LIVE_HOST = 'nextgensummit.us';

/**
 * The review store, positively identified, from TWO INDEPENDENT FACTS.
 *
 * The first version asked one question: is the data directory called
 * nextgen-data-staging? An adversarial review broke it in a way worth writing down,
 * because the lesson is general.
 *
 * release.py builds two archives into one folder, and the only difference between them is
 * a line appended to api/config.php defining NGS_DATA_DIR. deploy.mjs took two bare
 * positional arguments and checked neither against the other. So
 * `node tools/deploy.mjs nextgensummit.us release/staging-<sha>.zip` -- one wrong word --
 * would put the staging config on the live host. ngs_data_dir() then returns a path ending
 * nextgen-data-staging, the guard answers yes ON PRODUCTION, and the destructive controls
 * render on the live dashboard. Every total reads zero at the same moment, because the
 * live ballot is no longer the store being read.
 *
 * The flaw was not the name check. It was that the only fact consulted TRAVELLED INSIDE
 * THE ARCHIVE, so a misdirected archive carried its own permission with it. The fix is a
 * second fact that cannot travel: the hostname the request arrived on.
 *
 *   (a) the store is named as the review store, AND
 *   (b) this request was not served by the live site, AND
 *   (c) the store already exists and has a database in it
 *
 * (c) catches the same misdeploy a second time: the bad path resolves to a directory that
 * does not exist, ngs_data_dir() creates it empty, and an empty directory has never been
 * anybody's review store.
 *
 * Under CLI there is no host, so (b) cannot be evaluated, and the tests rely on that. It
 * is sound because nothing destructive is reachable from a command line: pc_reset() and
 * pc_seed() have one caller each, the dashboard, and the dashboard is a web page.
 */
function pc_store_is_review(): bool
{
    static $is = null;
    if ($is !== null) {
        return $is;
    }
    try {
        $dir = ngs_data_dir();
    } catch (Throwable $e) {
        /* No data directory means no way to tell which database this is. Refuse. */
        error_log("People's Choice: destructive guard could not resolve the data directory; refusing.");
        return $is = false;
    }

    $dir = rtrim(str_replace(DIRECTORY_SEPARATOR, '/', $dir), '/');

    // (a)
    if (basename($dir) !== 'nextgen-data-staging') {
        return $is = false;
    }

    // (b) -- the one fact that does not travel inside an archive
    $host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
    $host = (string) preg_replace('/:\d+$/', '', $host);
    if ($host === PC_LIVE_HOST || $host === 'www.' . PC_LIVE_HOST) {
        error_log("People's Choice: the store is named for review but this request arrived on the "
                . "live host. Refusing every destructive control -- api/config.php is probably "
                . "from the wrong build.");
        return $is = false;
    }

    // (c)
    $has = is_file($dir . '/nextgen-' . NGS_DATA_KEY . '.sqlite') || glob($dir . '/nextgen-*.sqlite');
    if (!$has) {
        error_log("People's Choice: the review store holds no database; refusing destructive controls.");
        return $is = false;
    }

    return $is = true;
}

/** The sentence the dashboard shows where the controls used to be. */
function pc_destructive_note(): string
{
    return pc_store_is_review()
        ? 'This is the review site. These write to ' . basename(ngs_data_dir())
          . ', which is a different file from the live ballot.'
        : 'Disabled on this site. These controls only ever run against the review store, and '
          . 'this is not it. The restriction is enforced in pc-lib.php, not by hiding the '
          . 'buttons: a request sent straight to the endpoint is refused the same way.';
}

/**
 * Clear every vote in the competition. Review store only.
 *
 * @return bool true when rows were actually cleared; false means the request was refused,
 *              and the caller must say so rather than reporting success.
 */
function pc_reset(): bool
{
    if (!pc_store_is_review()) {
        error_log("People's Choice: pc_reset() refused -- this is not the review store.");
        return false;
    }
    $db = pc_db();
    if ($db) {
        $db->prepare('DELETE FROM pc_votes WHERE competition = ?')->execute([PC_COMPETITION]);
        return true;
    }
    $d = pc_file_read();
    $d['votes'] = [];
    pc_file_write($d);
    return true;
}

/**
 * Write the dashboard's demonstration rows. Review store only.
 *
 * It lives here rather than inline in the dashboard so that it sits behind the same guard
 * as pc_reset(): seeding production is less destructive than clearing it, but it still puts
 * rows a nobody cast into a live competition's totals, and it momentarily forces the state
 * to open while it does so.
 *
 * @return int how many rows were written; 0 means refused or nothing took.
 */
function pc_seed(): int
{
    if (!pc_store_is_review()) {
        error_log("People's Choice: pc_seed() refused -- this is not the review store.");
        return 0;
    }
    $ids = array_column(pc_entrants(), 'id');
    $was = pc_state();
    pc_set_meta('state', 'open');
    $n = 0;
    $plan = [0 => 7, 1 => 5, 2 => 4, 3 => 2, 4 => 2, 5 => 1];
    foreach ($plan as $i => $count) {
        for ($j = 0; $j < $count; $j++) {
            if (pc_cast('seed:' . $i . ':' . $j . ':' . bin2hex(random_bytes(4)), $ids[$i], true)['ok']) {
                $n++;
            }
        }
    }
    pc_set_meta('state', $was);
    return $n;
}

/* ---------- the voter's session ----------

   How long a verification lasts, and the two things that have to agree about it.

   The intent was always thirty days -- pc-otp.php has said so in a comment since it was
   written: "the voter should not be asked again tomorrow". Neither half of the machinery
   was set up to deliver it.

   THE COOKIE was created with lifetime 0, which is a session cookie: gone when the browser
   session ends. Leadership noticed the consequence before anyone noticed the cause -- "verify
   once to vote sounds like if I did it yesterday, I won't have to do it today" -- and they
   were right, because that is exactly what happened.

   THE SERVER SIDE was worse and would have defeated a fix to the cookie on its own.
   session.gc_maxlifetime was never set, so PHP's default of about twenty-four minutes
   applied: the session FILE became eligible for collection within the hour, whatever the
   cookie said. A voter could be asked again after a cup of tea.

   Both are set here, in one place, because three endpoints share this session and the
   parameters must match exactly or the session is invisible to the others -- a trap the old
   code handled with a comment repeated at each copy. A function cannot drift from itself.

   One honest limit: on shared hosting the session directory can be common to several sites,
   and PHP's collector uses the lifetime of whichever request happens to trigger it. So the
   files get their own directory beside the database when one can be had -- and if it cannot,
   the default is used rather than failing, because a session that will not start is a voter
   who cannot vote. */
const PC_SESSION_MAX_AGE = 2592000;          // thirty days

function pc_session_begin(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');

    /* Our own directory if we can have one. Checked rather than assumed: a save path that
       does not exist makes session_start() fail, and that is the whole page. */
    try {
        $dir = ngs_data_dir() . '/sessions';
        if ((is_dir($dir) || @mkdir($dir, 0700, true)) && is_writable($dir)) {
            session_save_path($dir);
        }
    } catch (Throwable $e) {
        // the default path is fine; it is only the collector we lose confidence in
    }

    @ini_set('session.gc_maxlifetime', (string) PC_SESSION_MAX_AGE);
    session_name('ngs_pc_voter');
    /* Path '/' on purpose. The page lives under /pitch/peoples-choice/ but its endpoints live
       under /api/, and a cookie scoped to the page is simply never sent to them -- the session
       existed and could not be read, which is how that was found. The cookie's own name keeps
       it distinct from the admin session; httpOnly, Secure and SameSite do the actual work. */
    session_set_cookie_params([
        'lifetime' => PC_SESSION_MAX_AGE, 'path' => '/',
        'secure' => $https, 'httponly' => true, 'samesite' => 'Lax',
    ]);
    session_start();

    /* PHP sends Set-Cookie when it creates a session, not on every request afterwards, so a
       voter already carrying the old session cookie would keep its lifetime of 0 and be asked
       again tomorrow regardless. Re-sending it moves them onto the new expiry without making
       them verify again. */
    if (!empty($_SESSION['verified_at']) && isset($_COOKIE['ngs_pc_voter'])) {
        @setcookie('ngs_pc_voter', session_id(), [
            'expires' => time() + PC_SESSION_MAX_AGE, 'path' => '/',
            'secure' => $https, 'httponly' => true, 'samesite' => 'Lax',
        ]);
    }
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
