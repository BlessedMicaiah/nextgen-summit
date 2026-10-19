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

/* ---------- the entrants ----------
   One list, read by the public page and the dashboard alike, so a rename cannot leave the two
   disagreeing. Still placeholders: no name here belongs to a real person. */
function pc_entrants(): array
{
    $out = [];
    for ($i = 1; $i <= 20; $i++) {
        $n = str_pad((string) $i, 2, '0', STR_PAD_LEFT);
        $out[] = [
            'id' => 'entrant-' . $n,
            'n' => $n,
            'draft' => true,
            'name' => 'Semifinalist ' . $n,
            'company' => 'Company to be confirmed',
            'shot' => null,
        ];
    }
    return $out;
}
