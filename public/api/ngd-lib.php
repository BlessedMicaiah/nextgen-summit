<?php
/* ============================================================================
   NEXTGEN DATA — the reporting core.

   WHAT THIS IS
   A read-only reader over the live People's Choice voting database, plus its own
   separate store for the website events that voting never collected.

   WHAT IT IS NOT
   It is not part of the voting system and nothing in the voting system includes it.
   It opens its own handle, with SQLITE_OPEN_READONLY, on a path it works out itself.
   If that handle cannot be opened read-only it is NOT opened at all -- there is no
   writable fallback anywhere in this file for the voting database. A dashboard that
   cannot read is a dashboard that says so; it is never a dashboard that writes.

   WHY IT DOES NOT REUSE pc-lib.php
   pc_db() runs CREATE TABLE and CREATE INDEX on every single call (pc-lib.php:38-86),
   ngs_db() does the same for the submissions table (_lib.php:81-93), and
   pc_visits_table() does it again (pc-rules.php:113). Every one of those is a write.
   Including any of them here would mean the reporting layer writing to the live
   voting database on each page load, which is the one thing it must never do. So the
   counting rules are restated below instead, deliberately duplicated, with the line
   each one mirrors named beside it. If the voting rules ever change, these change too
   -- and tools/test-ngd-reporting.php exists to catch it when they drift.

   THE COUNTING RULES, MIRRORED
     a point              one pc_votes row                    pc-lib.php:313 pc_tally()
     valid points         valid = 1                           pc-lib.php:320
     invalidated          valid = 0                           pc-lib.php:336
     competition          'peoples-choice-2026'               pc-lib.php:19
     a standard point     slot = 1                            pc-lib.php:378 "slot 1 is the base point"
     a bonus point        slot > 1                            pc-lib.php:378 "2 and 3 are the attendee bonus"
     a verified point     simulated = 0                       pc-vote.php:201  !$identity['verified']
     an unverified point  simulated = 1                       same line
     a seeded test point  voter_key LIKE 'seed:%'             pc-admin index.php:474
     the reporting day    vote_day, already Eastern           pc-rules.php:51 pc_day()
     the row's instant    created_at, UTC with a Z            _lib.php:115 ngs_now()

   Two of those deserve a plain warning, because a leadership dashboard that gets them
   wrong is worse than no dashboard:

   1. simulated does NOT mean "fake". It means "the voter had not verified an email or
      phone". pc_tally() counts those rows, so they are in the official total, and this
      file keeps them in the official total too. They are reported separately as
      "unverified", never subtracted.

   2. seeded rows ARE counted by pc_tally(), so they are counted here as well, and
      reported separately on top. Subtracting them would mean this dashboard disagreeing
      with the admin panel, and the admin panel is the authority.
   ========================================================================= */

declare(strict_types=1);

if (realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === realpath(__FILE__)) {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/config.php';

const NGD_COMPETITION = 'peoples-choice-2026';
const NGD_TZ          = 'America/New_York';
const NGD_SNAP_TTL    = 60;        // seconds a built snapshot is served before rebuilding
const NGD_SNAP_MAX    = 1800;      // seconds after which a snapshot is called stale, not current
const NGD_ROW_CAP     = 500000;    // refuse to pull more rows than this into memory
const NGD_BUSY_MS     = 2500;

/* ---------------------------------------------------------------------------
   1. WHERE THE DATA IS

   Worked out from the two facts the host guarantees, never guessed:

     production  DOCUMENT_ROOT = /home/uNNN/domains/nextgensummit.us/public_html
                 data          = dirname(DOCUMENT_ROOT) . '/nextgen-data'        _lib.php:57
     staging     DOCUMENT_ROOT = /home/uNNN/domains/nextgensummit.us/public_html/staging
                 data          = NGS_DATA_DIR, injected by tools/release.py as
                                 dirname(__DIR__, 3) . '/nextgen-data-staging'
                               = /home/uNNN/domains/nextgensummit.us/nextgen-data-staging

   The two data folders are therefore SIBLINGS under one parent, on one filesystem,
   owned by one Unix user. That is what makes a live read possible from the review
   site -- and it is also why this file is so careful about the word read.
   ------------------------------------------------------------------------ */

/** The folder that holds nextgen-data and nextgen-data-staging side by side. */
function ngd_base_dir(): string
{
    if (defined('NGS_DATA_DIR')) {
        return dirname((string) NGS_DATA_DIR);              // staging: .../nextgensummit.us
    }
    $root = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''), '/\\');
    if ($root !== '') {
        return dirname($root);                               // production: .../nextgensummit.us
    }
    return dirname(dirname(__DIR__));                        // last resort: a local checkout
}

/**
 * Refuse a base directory that lies inside the web root.
 *
 * This guard exists because of a real trap the voting system already had to work around.
 * On the review build DOCUMENT_ROOT is .../public_html/staging, so dirname() of it is
 * .../public_html -- the LIVE web root. Any naive "sibling of the document root" sum
 * therefore puts the analytics store inside a directory that a deploy replaces wholesale,
 * and that the public can request. release.py injects NGS_DATA_DIR precisely so the vote
 * store never lands there; this is the same guard for the analytics store.
 *
 * If it ever trips, it is better to have no analytics folder than a web-readable one.
 */
function ngd_base_is_safe(string $base): bool
{
    $root = rtrim(str_replace('\\', '/', (string) ($_SERVER['DOCUMENT_ROOT'] ?? '')), '/');
    if ($root === '') {
        return true;                                         // CLI: nothing is being served
    }
    $b = rtrim(str_replace('\\', '/', $base), '/');
    return $b !== $root && strpos($b . '/', $root . '/') !== 0;
}

/** True when this copy of the site is the review build rather than the live one. */
function ngd_is_staging(): bool
{
    return defined('NGS_DATA_DIR');
}

/** Which environment's data a source name points at. 'live' | 'review'. */
function ngd_sources(): array
{
    $base = ngd_base_dir();
    return [
        'live'   => ['label' => 'Live production', 'dir' => $base . '/nextgen-data'],
        'review' => ['label' => 'Review (staging)', 'dir' => $base . '/nextgen-data-staging'],
    ];
}

/** The source this dashboard reports on by default: always the live competition. */
function ngd_default_source(): string
{
    return 'live';
}

/** The voting database file for a source, or null when it is not there. */
function ngd_db_path(string $source): ?string
{
    $s = ngd_sources()[$source] ?? null;
    if ($s === null) {
        return null;
    }
    $exact = $s['dir'] . '/nextgen-' . NGS_DATA_KEY . '.sqlite';
    if (is_file($exact)) {
        return $exact;
    }
    /* The key is the same in both builds because both are built from one config.php, so the
       line above is the answer in practice. The glob is here for the day somebody rotates the
       key on one site and not the other: better to find the database than to report zero. */
    $hits = @glob($s['dir'] . '/nextgen-*.sqlite') ?: [];
    $hits = array_values(array_filter($hits, static fn($p) => is_file($p) && !str_contains($p, '-peoples-choice')));
    return $hits ? $hits[0] : null;
}

/* ---------------------------------------------------------------------------
   2. THE READ-ONLY HANDLE

   Three ways to ask PDO for a read-only SQLite connection, tried in order, and
   nothing after them. Note what is absent: there is no `new PDO('sqlite:' . $p)`
   at the end of this chain. A plain DSN opens read-write, and a read-write handle
   on the live voting database is exactly the thing this whole design exists to
   make impossible. If all three fail, the caller gets null and the dashboard
   reports its source as unreachable.

     1. SQLITE_ATTR_OPEN_FLAGS => SQLITE_OPEN_READONLY   PHP >= 7.3, the clean way
     2. sqlite:file:/path?mode=ro                        URI form, needs URI support
     3. the same URI with immutable=0 spelled out        some builds want it explicit

   The database is in the default rollback-journal mode -- nothing in the voting code
   sets journal_mode (the only PRAGMA it issues is busy_timeout, _lib.php:84). That
   matters here: a read-only handle on a rollback-journal database needs to create no
   files at all. Had it been in WAL, a reader would need to create a -shm, and a
   read-only open can fail outright when it cannot. The one case that still fails is a
   hot journal left by a crashed writer, which SQLite refuses to let a read-only
   connection roll back. That is transient, and ngd_snapshot() answers it by serving
   the last good snapshot with the stale flag set.
   ------------------------------------------------------------------------ */

/** How the last successful read-only open was achieved. For the source-health panel. */
function ngd_ro_method(?string $set = null): ?string
{
    static $m = null;
    if ($set !== null) {
        $m = $set;
    }
    return $m;
}

/**
 * @param bool $forSnapshot when true, query_only is NOT set, because it would block the one
 *                          statement this handle exists to run. See ngd_take_snapshot().
 */
function ngd_ro(string $path, bool $forSnapshot = false): ?PDO
{
    $opts = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_TIMEOUT            => 3,
    ];

    $attempts = [];
    if (defined('PDO::SQLITE_ATTR_OPEN_FLAGS') && defined('PDO::SQLITE_OPEN_READONLY')) {
        $attempts['SQLITE_OPEN_READONLY open flag'] =
            ['sqlite:' . $path, $opts + [PDO::SQLITE_ATTR_OPEN_FLAGS => PDO::SQLITE_OPEN_READONLY]];
    }
    $attempts['file: URI with mode=ro'] = ['sqlite:file:' . $path . '?mode=ro', $opts];

    foreach ($attempts as $how => [$dsn, $o]) {
        try {
            $pdo = new PDO($dsn, null, null, $o);

            /* Two independent locks, and the handle is only returned when the second one is
               confirmed by reading it back.

               There is deliberately NO write probe here. The obvious test -- try an INSERT or a
               CREATE TABLE and expect it to fail -- is unacceptable on a live voting database,
               because the one case it is meant to catch is the case where the write SUCCEEDS.
               A test that damages the thing it is testing when it fails is not a test. Nor is
               BEGIN IMMEDIATE acceptable: on a writable handle it takes a RESERVED lock, and a
               reporting page must never be able to make a voter wait.

               So the check is a read. query_only is a connection-level switch inside SQLite: with
               it set, the statement compiler refuses every INSERT, UPDATE, DELETE, CREATE and DROP
               before any file is touched. Setting it is free and reading it back proves it took. */
            $queryOnly = false;
            if (!$forSnapshot) {
                try {
                    $pdo->exec('PRAGMA query_only = 1');
                    $r = $pdo->query('PRAGMA query_only')->fetch(PDO::FETCH_NUM);
                    $queryOnly = isset($r[0]) && (int) $r[0] === 1;
                } catch (Throwable $e) {
                    $queryOnly = false;           // an old SQLite that does not know the pragma
                }
            }

            if (!$forSnapshot && !$queryOnly && $how !== 'SQLITE_OPEN_READONLY open flag') {
                /* Neither guard could be confirmed. Rather than hand back a handle whose
                   read-only-ness is merely assumed, refuse it and let the caller report the
                   source as unreadable. A stale dashboard is recoverable; a writable handle on
                   the live ballot is not. */
                $pdo = null;
                continue;
            }

            try {
                $pdo->exec('PRAGMA busy_timeout = ' . NGD_BUSY_MS);
            } catch (Throwable $e) {
                // not fatal: PDO::ATTR_TIMEOUT above already bounds the wait
            }

            ngd_ro_method($how . ($queryOnly ? ' + query_only=1 (confirmed)' : ''));
            return $pdo;
        } catch (Throwable $e) {
            continue;
        }
    }
    ngd_ro_method(null);
    return null;
}

/** Does this database have the voting table yet? A brand new review store may not. */
function ngd_has_table(PDO $db, string $name): bool
{
    /* The allow-list is enforced here as well as observed by hand, because this is the one
       function every table access in this file goes through first. See NGD_READABLE. */
    if (!ngd_may_read($name)) {
        return false;
    }
    try {
        $s = $db->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?");
        $s->execute([$name]);
        return (bool) $s->fetch();
    } catch (Throwable $e) {
        return false;
    }
}

/* ---------------------------------------------------------------------------
   3. THE ANALYTICS STORE

   Its own folder, its own SQLite file, beside the voting data and never inside it.
   Two consequences worth stating:

     - the collector's handle is opened on a different FILE, so "the collector may
       not modify voting records" is not a policy, a role or a grant that somebody
       could get wrong. There is no code path from the collector to pc_votes.
     - it lives outside the web root, so a deploy -- which replaces the web root --
       cannot delete the events already gathered.
   ------------------------------------------------------------------------ */

function ngd_var_dir(): string
{
    static $dir = null;
    if ($dir !== null) {
        return $dir;
    }
    $base = ngd_base_dir();
    if (!ngd_base_is_safe($base)) {
        /* Rather than silently create a web-readable analytics folder, fall back to the
           system temp directory: the cache still works, it is simply not durable, and the
           health panel reports the degraded state. */
        $base = rtrim(sys_get_temp_dir(), '/\\');
        error_log('NextGen Data: the analytics base resolved inside the web root; using the temp directory instead.');
    }
    $dir = $base . '/nextgen-analytics' . (ngd_is_staging() ? '-staging' : '');
    if (!is_dir($dir)) {
        @mkdir($dir, 0750, true);
    }
    /* Belt: if this folder ever did end up somewhere served, nothing in it is servable. */
    if (is_dir($dir) && !is_file($dir . '/.htaccess')) {
        @file_put_contents($dir . '/.htaccess',
            "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n"
            . "<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\n");
    }
    return $dir;
}

/** Read-write, but only ever on the analytics file. Returns null if it cannot be opened. */
function ngd_events_db(): ?PDO
{
    static $pdo = false;
    if ($pdo !== false) {
        return $pdo;
    }
    $pdo = null;
    try {
        $db = new PDO('sqlite:' . ngd_var_dir() . '/ngd-events.sqlite', null, null, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        /* WAL, and a timeout a web request can actually afford.

           None of the reasoning that keeps the VOTING database in rollback-journal mode
           applies here: this is a private analytics file that nothing else reads. In WAL a
           reader and a writer stop excluding each other, which matters because the
           dashboard reads this file while the public collector writes to it.

           The timeout is short on purpose. This store is best-effort by design, so waiting
           four seconds for a lock is the wrong trade: the right answer under contention is
           to drop the event, not to hold a PHP worker. Twenty events at four seconds each
           was eighty seconds of worker time per request, which is a denial of service with
           a 4 KB body. */
        try {
            $db->exec('PRAGMA journal_mode = WAL');
        } catch (Throwable $e) {
            // an old SQLite, or a filesystem that cannot do WAL; the timeout below still helps
        }
        $db->exec('PRAGMA busy_timeout = 400');
        $db->exec('CREATE TABLE IF NOT EXISTS ngd_event (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            kind       TEXT NOT NULL,
            page       TEXT,
            entrant_id TEXT,
            source     TEXT,
            visitor    TEXT NOT NULL,
            source_ip  TEXT,
            session    TEXT,
            day        TEXT NOT NULL,
            created_at TEXT NOT NULL,
            ts         INTEGER NOT NULL,
            meta       TEXT
        )');
        $db->exec('CREATE INDEX IF NOT EXISTS ngd_event_k ON ngd_event (kind, ts)');
        $db->exec('CREATE INDEX IF NOT EXISTS ngd_event_d ON ngd_event (day, kind)');
        $db->exec('CREATE INDEX IF NOT EXISTS ngd_event_e ON ngd_event (entrant_id, day)');
        $db->exec('CREATE INDEX IF NOT EXISTS ngd_event_v ON ngd_event (visitor, day)');
        $db->exec('CREATE INDEX IF NOT EXISTS ngd_event_ip ON ngd_event (source_ip, ts)');
        /* A store created before source_ip existed is migrated in place; the column is
           nullable, so old rows simply do not participate in rate limiting. */
        try {
            $cols = array_column($db->query('PRAGMA table_info(ngd_event)')->fetchAll(), 'name');
            if (!in_array('source_ip', $cols, true)) {
                $db->exec('ALTER TABLE ngd_event ADD COLUMN source_ip TEXT');
            }
        } catch (Throwable $e) {
            // the index above will simply not be usable; the ceilings still apply
        }
        $db->exec('CREATE TABLE IF NOT EXISTS ngd_throttle (
            k          TEXT NOT NULL,
            ts         INTEGER NOT NULL,
            ok         INTEGER NOT NULL DEFAULT 0
        )');
        $db->exec('CREATE INDEX IF NOT EXISTS ngd_throttle_k ON ngd_throttle (k, ts)');
        $pdo = $db;
    } catch (Throwable $e) {
        error_log('NextGen Data: analytics store unavailable. ' . $e->getMessage());
        $pdo = null;
    }
    return $pdo;
}

/* ---------------------------------------------------------------------------
   4. SMALL SHARED HELPERS
   ------------------------------------------------------------------------ */

function ngd_now(): string
{
    return gmdate('Y-m-d\TH:i:s\Z');
}

function ngd_tz(): DateTimeZone
{
    static $tz = null;
    return $tz ??= new DateTimeZone(NGD_TZ);
}

/** The Eastern calendar day of a UTC instant. Mirrors pc_day(), pc-rules.php:51. */
function ngd_day(int $ts): string
{
    return (new DateTime('@' . $ts))->setTimezone(ngd_tz())->format('Y-m-d');
}

/** A 'Y-m-d\TH:i:s\Z' stamp as a Unix timestamp, tolerant of anything else parseable. */
function ngd_ts(string $iso): ?int
{
    if ($iso === '') {
        return null;
    }
    try {
        return (new DateTime($iso, new DateTimeZone('UTC')))->getTimestamp();
    } catch (Throwable $e) {
        $t = strtotime($iso);
        return $t === false ? null : $t;
    }
}

/** Eastern wall-clock pieces of a UTC instant: [Y-m-d, hour 0..23, weekday 0=Mon]. */
function ngd_et_parts(int $ts): array
{
    $d = (new DateTime('@' . $ts))->setTimezone(ngd_tz());
    return [$d->format('Y-m-d'), (int) $d->format('G'), ((int) $d->format('N')) - 1];
}

function ngd_et_label(?int $ts): ?string
{
    if ($ts === null) {
        return null;
    }
    return (new DateTime('@' . $ts))->setTimezone(ngd_tz())->format('c');
}

function ngd_pct(float $part, float $whole): float
{
    return $whole > 0 ? round($part / $whole * 100, 2) : 0.0;
}

/** A visitor token with the same privacy properties as pc_visitor_token(), pc-rules.php:130.
    Address and user agent, salted with the server secret AND the Eastern day, so it stops
    being linkable to anything tomorrow. No cookie is set and no address is stored. */
function ngd_visitor_token(): string
{
    $seed = ($_SERVER['REMOTE_ADDR'] ?? '') . '|' . ($_SERVER['HTTP_USER_AGENT'] ?? '') . '|'
          . ngd_day(time()) . '|ngd';
    return substr(hash_hmac('sha256', $seed, NGS_SECRET), 0, 20);
}

function ngd_ip_key(): string
{
    return substr(hash_hmac('sha256', (string) ($_SERVER['REMOTE_ADDR'] ?? ''), NGS_SECRET), 0, 16);
}

/* ---------------------------------------------------------------------------
   5. THE FOUNDER MANIFEST

   Public fields only: name, company, portrait. Read as text out of
   assets/js/pc-founders.js exactly as pc_founder_manifest() does (pc-lib.php:809),
   and read from the SOURCE environment's own copy first -- reporting on live data
   should carry live names, not the review site's.
   ------------------------------------------------------------------------ */

function ngd_founders(string $source = 'live'): array
{
    static $cache = [];
    if (isset($cache[$source])) {
        return $cache[$source];
    }

    $here = dirname(__DIR__) . '/assets/js/pc-founders.js';
    $candidates = [];
    if ($source === 'live' && ngd_is_staging()) {
        /* staging's DOCUMENT_ROOT is .../public_html/staging, so the live site's assets
           are one level up. Prefer them when the numbers being shown are the live ones. */
        $root = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''), '/\\');
        if ($root !== '') {
            $candidates[] = dirname($root) . '/assets/js/pc-founders.js';
        }
    }
    $candidates[] = $here;

    $map = [];
    $from = null;
    foreach ($candidates as $f) {
        if (!is_file($f) || !is_readable($f)) {
            continue;
        }
        $raw = @file_get_contents($f);
        if (!is_string($raw) || $raw === '') {
            continue;
        }
        $start = strpos($raw, '[');
        $end = strrpos($raw, ']');
        if ($start === false || $end === false || $end <= $start) {
            continue;
        }
        $rows = json_decode(substr($raw, $start, $end - $start + 1), true);
        if (!is_array($rows)) {
            continue;
        }
        foreach ($rows as $r) {
            if (!is_array($r) || !isset($r['entrant']) || !is_string($r['entrant'])) {
                continue;
            }
            $name = isset($r['name']) && is_string($r['name']) ? trim($r['name']) : '';
            if ($name === '') {
                continue;
            }
            $map[$r['entrant']] = [
                'name'    => $name,
                'company' => (isset($r['company']) && is_string($r['company']) && trim($r['company']) !== '')
                               ? trim($r['company']) : 'Company to be confirmed',
                'shot'    => isset($r['shot']) && is_string($r['shot']) ? $r['shot'] : null,
                'slug'    => isset($r['slug']) && is_string($r['slug']) ? $r['slug'] : null,
            ];
        }
        if ($map) {
            $from = $f === $here ? 'this build' : 'the live site';
            break;
        }
    }

    /* All twenty always appear, named or not, so a founder with no votes is still a row.
       Mirrors pc_entrants(), pc-lib.php:776. */
    $out = [];
    for ($i = 1; $i <= 20; $i++) {
        $n  = str_pad((string) $i, 2, '0', STR_PAD_LEFT);
        $id = 'entrant-' . $n;
        $m  = $map[$id] ?? null;
        $out[$id] = [
            'id'      => $id,
            'n'       => $n,
            'name'    => $m['name'] ?? ('Semifinalist ' . $n),
            'company' => $m['company'] ?? 'Company to be confirmed',
            'shot'    => $m['shot'] ?? null,
            'slug'    => $m['slug'] ?? null,
            'named'   => $m !== null,
        ];
    }
    $out['_from'] = $from;
    return $cache[$source] = $out;
}

/* ---------------------------------------------------------------------------
   6. THE SNAPSHOT

   One build, one cache file, everything the dashboard draws. Built from a single
   pass over pc_votes rather than a query per panel: at this competition's scale a
   few thousand rows is nothing, and one pass means every number on the screen came
   from the same instant, so the headline and the chart can never disagree.

   Caching is why a sixty-second refresh is safe. The snapshot is written to the
   analytics folder, not to the voting folder, and it is served for NGD_SNAP_TTL
   seconds before anyone touches the database again.
   ------------------------------------------------------------------------ */

function ngd_snap_file(string $source): string
{
    return ngd_var_dir() . '/ngd-snapshot-' . preg_replace('/[^a-z]/', '', $source) . '.json';
}

/**
 * @param bool $force  rebuild even if a fresh snapshot exists
 * @return array the snapshot, always with a 'meta' key describing its own freshness
 */
function ngd_snapshot(string $source = 'live', bool $force = false): array
{
    $file = ngd_snap_file($source);
    $cached = null;
    if (is_file($file)) {
        $raw = @file_get_contents($file);
        if (is_string($raw) && $raw !== '') {
            $try = json_decode($raw, true);
            if (is_array($try) && isset($try['meta'])) {
                $cached = $try;
            }
        }
    }

    $age = $cached !== null ? max(0, time() - (int) ($cached['meta']['built_ts'] ?? 0)) : null;
    if (!$force && $cached !== null && $age !== null && $age < NGD_SNAP_TTL) {
        $cached['meta']['served'] = 'cache';
        $cached['meta']['age_s']  = $age;
        $cached['meta']['stale']  = false;
        return $cached;
    }

    $built = ngd_build($source);

    if ($built['meta']['ok']) {
        @file_put_contents($file, json_encode($built), LOCK_EX);
        @chmod($file, 0640);
        $built['meta']['served'] = 'fresh';
        $built['meta']['age_s']  = 0;
        $built['meta']['stale']  = false;
        return $built;
    }

    /* The source could not be read. Serve the last good snapshot and say so plainly --
       the brief's instruction, and the only honest thing to show. */
    if ($cached !== null) {
        $cached['meta']['served']      = 'stale';
        $cached['meta']['age_s']       = $age;
        $cached['meta']['stale']       = true;
        $cached['meta']['stale_reason'] = $built['meta']['error'] ?? 'the voting database could not be read';
        return $cached;
    }
    $built['meta']['served'] = 'none';
    $built['meta']['stale']  = true;
    return $built;
}

/** Everything, computed from one read-only pass. */
function ngd_build(string $source): array
{
    $t0 = microtime(true);
    $founders = ngd_founders($source);
    $from = $founders['_from'] ?? null;
    unset($founders['_from']);

    $meta = [
        'ok'            => false,
        'source'        => $source,
        'source_label'  => ngd_sources()[$source]['label'] ?? $source,
        'environment'   => ngd_is_staging() ? 'review' : 'live',
        'competition'   => NGD_COMPETITION,
        'tz'            => NGD_TZ,
        'built_at'      => ngd_now(),
        'built_ts'      => time(),
        'built_at_et'   => ngd_et_label(time()),
        'names_from'    => $from,
        'error'         => null,
        'read_only'     => true,
        'rows_read'     => 0,
        'build_ms'      => 0,
    ];

    $path = ngd_db_path($source);
    if ($path === null) {
        $meta['error'] = 'no voting database found for the ' . $source . ' source';
        return ['meta' => $meta] + ngd_empty($founders);
    }

    /* Take a copy and read the copy. This is the single most important line in the file;
       see ngd_take_snapshot() for why counting against the live file could cost a voter
       their vote. */
    $snap = ngd_take_snapshot($path);
    $meta['snapshot'] = $snap['how'];
    $meta['hold_ms']  = $snap['ms'];

    $db = ngd_ro($snap['path']);
    if ($db === null) {
        $meta['error'] = 'the voting database could not be opened read-only';
        return ['meta' => $meta] + ngd_empty($founders);
    }
    if (!ngd_has_table($db, 'pc_votes')) {
        $meta['error'] = 'this source has no pc_votes table yet';
        return ['meta' => $meta] + ngd_empty($founders);
    }

    /* ---- the rules in force, straight out of pc_meta ---- */
    $rules = ngd_rules($db);

    /* ---- one pass over the rows ---- */
    try {
        $n = (int) $db->query('SELECT COUNT(*) AS n FROM pc_votes')->fetch()['n'];
        if ($n > NGD_ROW_CAP) {
            $meta['error'] = 'pc_votes holds ' . $n . ' rows, above the ' . NGD_ROW_CAP . ' reporting cap';
            return ['meta' => $meta] + ngd_empty($founders);
        }
        $s = $db->prepare('SELECT vote_day, entrant_id, voter_key, slot, simulated, valid, created_at
                           FROM pc_votes WHERE competition = ? ORDER BY id ASC');
        $s->execute([NGD_COMPETITION]);
        $rows = $s->fetchAll();
    } catch (Throwable $e) {
        $meta['error'] = 'the voting table could not be read';
        return ['meta' => $meta] + ngd_empty($founders);
    }

    $traffic = ngd_traffic($db);
    $db = null;

    $agg = ngd_aggregate($rows, $founders, $rules);

    $meta['ok']        = true;
    $meta['rows_read'] = count($rows);
    $meta['build_ms']  = (int) round((microtime(true) - $t0) * 1000);

    return ['meta' => $meta, 'rules' => $rules, 'traffic' => $traffic] + $agg;
}

/** The voting rules currently in force. Read-only out of pc_meta, with the same
    fallbacks the live code uses so the dashboard never reports a rule the site is not
    actually running. */
function ngd_rules(PDO $db): array
{
    $meta = [];
    if (ngd_has_table($db, 'pc_meta')) {
        try {
            foreach ($db->query('SELECT k, v FROM pc_meta')->fetchAll() as $r) {
                $meta[(string) $r['k']] = (string) $r['v'];
            }
        } catch (Throwable $e) {
            // leave it empty; the fallbacks below are the live defaults
        }
    }
    $mode = in_array($meta['mode'] ?? 'daily', ['single', 'daily'], true) ? ($meta['mode'] ?? 'daily') : 'daily';
    $deadline = $meta['deadline'] ?? null;

    return [
        /* pc-rules.php:31 */  'mode'            => $mode,
        /* pc-lib.php:171  */  'state'           => $meta['state'] ?? 'open',
        /* pc-rules.php:46 */  'daily_public'    => $mode === 'single' ? 1 : max(0, min(10, (int) ($meta['daily_public'] ?? 1))),
        /* pc-rules.php:46 */  'daily_ticket'    => $mode === 'single' ? 1 : max(0, min(10, (int) ($meta['daily_ticket'] ?? 3))),
        /* pc-lib.php:158  */  'spread_votes'    => isset($meta['spread_votes']) ? ($meta['spread_votes'] === '1') : null,
        /* pc-lib.php:177  */  'deadline'        => $deadline,
        'deadline_et'     => $deadline,
        'stored_keys'     => array_values(array_diff(array_keys($meta), ['deadline'])),
        'allowance_note'  => 'These are totals per voter per Eastern day, not increments '
                           . '(pc-rules.php:46). A null spread_votes means the key is absent, '
                           . 'which is how production runs: one founder per day per voter.',
    ];
}

/** Contestant-page visits already being collected by the live site (pc-rules.php:136). */
function ngd_traffic(PDO $db): array
{
    $out = ['ok' => false, 'by_entrant' => [], 'by_source' => [], 'by_day' => [],
            'total' => 0, 'uniques' => 0,
            'coverage' => 'Only individual contestant pages call pc_log_visit() '
                        . '(entrant.php:41). The People\'s Choice landing page, the homepage '
                        . 'section and the ticket pages were never instrumented, so this is a '
                        . 'partial view of traffic, not a site total.'];
    if (!ngd_has_table($db, 'pc_visits')) {
        $out['coverage'] = 'No pc_visits table exists on this source yet, so no contestant-page '
                         . 'visits have ever been recorded here.';
        return $out;
    }
    try {
        foreach ($db->query('SELECT entrant_id, COUNT(*) AS visits, COUNT(DISTINCT visitor) AS uniques
                             FROM pc_visits GROUP BY entrant_id')->fetchAll() as $r) {
            $out['by_entrant'][(string) $r['entrant_id']] = [
                'visits' => (int) $r['visits'], 'uniques' => (int) $r['uniques'],
            ];
            $out['total']   += (int) $r['visits'];
            $out['uniques'] += (int) $r['uniques'];
        }
        foreach ($db->query('SELECT source, COUNT(*) AS n, COUNT(DISTINCT visitor) AS u
                             FROM pc_visits GROUP BY source ORDER BY n DESC')->fetchAll() as $r) {
            $out['by_source'][] = ['source' => (string) ($r['source'] ?? 'direct'),
                                   'visits' => (int) $r['n'], 'uniques' => (int) $r['u']];
        }
        foreach ($db->query('SELECT day, COUNT(*) AS n, COUNT(DISTINCT visitor) AS u
                             FROM pc_visits GROUP BY day ORDER BY day ASC')->fetchAll() as $r) {
            $out['by_day'][] = ['day' => (string) $r['day'],
                                'visits' => (int) $r['n'], 'uniques' => (int) $r['u']];
        }
        $out['ok'] = true;
    } catch (Throwable $e) {
        $out['coverage'] = 'The visit table exists but could not be read.';
    }
    return $out;
}

/** The shape the dashboard expects, with nothing in it. */
function ngd_empty(array $founders): array
{
    $f = [];
    foreach ($founders as $id => $e) {
        $f[] = $e + ['points' => 0, 'voters' => 0, 'rank' => null, 'share_pct' => 0.0];
    }
    return [
        'rules' => [], 'traffic' => [], 'totals' => [], 'founders' => $f,
        'daily' => [], 'hourly' => [], 'heatmap' => [], 'cumulative' => [],
        'rank_history' => [], 'integrity' => [],
    ];
}

/* ---------------------------------------------------------------------------
   7. THE AGGREGATION

   Plain PHP over the rows, deliberately, for one reason: correctness about time.
   created_at is UTC (_lib.php:115) and the competition reports in Eastern time, which
   SQLite cannot convert without hard-coding an offset that breaks at the DST boundary
   -- and this competition runs across the first week of November. DateTimeZone gets it
   right; a `datetime(created_at, '-4 hours')` would quietly not.
   ------------------------------------------------------------------------ */

function ngd_aggregate(array $rows, array $founders, array $rules): array
{
    $tz = ngd_tz();
    $nowTs = time();
    $today = ngd_day($nowTs);
    $yesterday = (new DateTime('@' . $nowTs))->setTimezone($tz)->modify('-1 day')->format('Y-m-d');

    $ids = array_keys($founders);

    /* --- accumulators --- */
    $zeroF = ['points' => 0, 'voters' => [], 'bonus' => 0, 'verified' => 0, 'unverified' => 0,
              'test' => 0, 'today' => 0, 'yesterday' => 0, 'first' => null, 'last' => null,
              'by_day' => []];
    $f = [];
    foreach ($ids as $id) {
        $f[$id] = $zeroF;
    }

    $tot = ['points' => 0, 'invalid' => 0, 'bonus' => 0, 'standard' => 0,
            'verified' => 0, 'unverified' => 0, 'test' => 0,
            'today' => 0, 'yesterday' => 0, 'last24' => 0, 'prev24' => 0,
            'first_ts' => null, 'last_ts' => null];
    $voters = [];  $votersToday = [];  $votersYest = [];  $votersTest = [];
    $byDay = [];   $byHour = array_fill(0, 24, 0);
    $heat = [];    $events = [];     // events: [ts, entrant] for rank reconstruction
    $unknown = [];

    foreach ($rows as $r) {
        $valid   = (int) $r['valid'] === 1;
        $entrant = (string) $r['entrant_id'];
        $voter   = (string) $r['voter_key'];
        $slot    = (int) $r['slot'];
        $sim     = (int) $r['simulated'] === 1;
        $isTest  = str_starts_with($voter, 'seed:');
        $day     = (string) $r['vote_day'];
        $ts      = ngd_ts((string) $r['created_at']);

        if (!$valid) {
            $tot['invalid']++;
            continue;                      // pc_tally() does not see it, so neither do we
        }

        if (!isset($f[$entrant])) {
            $unknown[$entrant] = ($unknown[$entrant] ?? 0) + 1;
            continue;
        }

        /* vote_day is 'all' under the single-vote rule (pc-lib.php:243). Fall back to the
           Eastern day of the row's own instant so the daily charts still work either way. */
        if ($day === 'all' || $day === '') {
            $day = $ts !== null ? ngd_day($ts) : $today;
        }

        $tot['points']++;
        $voters[$voter] = true;
        $slot > 1 ? $tot['bonus']++ : $tot['standard']++;
        $sim ? $tot['unverified']++ : $tot['verified']++;
        if ($isTest) {
            $tot['test']++;
            $votersTest[$voter] = true;
        }

        $f[$entrant]['points']++;
        $f[$entrant]['voters'][$voter] = true;
        if ($slot > 1)  { $f[$entrant]['bonus']++; }
        $sim ? $f[$entrant]['unverified']++ : $f[$entrant]['verified']++;
        if ($isTest) { $f[$entrant]['test']++; }
        $f[$entrant]['by_day'][$day] = ($f[$entrant]['by_day'][$day] ?? 0) + 1;

        if (!isset($byDay[$day])) {
            $byDay[$day] = ['points' => 0, 'voters' => [], 'bonus' => 0, 'verified' => 0,
                            'unverified' => 0, 'test' => 0, 'by' => []];
        }
        $byDay[$day]['points']++;
        $byDay[$day]['voters'][$voter] = true;
        if ($slot > 1) { $byDay[$day]['bonus']++; }
        $sim ? $byDay[$day]['unverified']++ : $byDay[$day]['verified']++;
        if ($isTest) { $byDay[$day]['test']++; }
        $byDay[$day]['by'][$entrant] = ($byDay[$day]['by'][$entrant] ?? 0) + 1;

        if ($day === $today)     { $tot['today']++;     $f[$entrant]['today']++;     $votersToday[$voter] = true; }
        if ($day === $yesterday) { $tot['yesterday']++; $f[$entrant]['yesterday']++; $votersYest[$voter] = true; }

        if ($ts !== null) {
            [$etDay, $etHour] = ngd_et_parts($ts);
            $byHour[$etHour]++;
            $heat[$etDay][$etHour] = ($heat[$etDay][$etHour] ?? 0) + 1;
            if ($tot['first_ts'] === null || $ts < $tot['first_ts']) { $tot['first_ts'] = $ts; }
            if ($tot['last_ts']  === null || $ts > $tot['last_ts'])  { $tot['last_ts']  = $ts; }
            if ($f[$entrant]['first'] === null || $ts < $f[$entrant]['first']) { $f[$entrant]['first'] = $ts; }
            if ($f[$entrant]['last']  === null || $ts > $f[$entrant]['last'])  { $f[$entrant]['last']  = $ts; }
            if ($ts >= $nowTs - 86400)                        { $tot['last24']++; }
            elseif ($ts >= $nowTs - 172800)                   { $tot['prev24']++; }
            $events[] = [$ts, $entrant];
        }
    }

    /* --- the daily series, oldest first, with every calendar day in between --- */
    ksort($byDay);
    $daily = [];
    $running = 0;
    $days = array_keys($byDay);
    if ($days) {
        $cursor = new DateTime($days[0], $tz);
        $endDay = new DateTime(max($days[count($days) - 1], $today), $tz);
        while ($cursor <= $endDay) {
            $d = $cursor->format('Y-m-d');
            $a = $byDay[$d] ?? ['points' => 0, 'voters' => [], 'bonus' => 0, 'verified' => 0,
                                'unverified' => 0, 'test' => 0, 'by' => []];
            $running += $a['points'];
            arsort($a['by']);
            $topId = array_key_first($a['by']);
            $daily[] = [
                'day'        => $d,
                'weekday'    => $cursor->format('D'),
                'points'     => $a['points'],
                'voters'     => count($a['voters']),
                'bonus'      => $a['bonus'],
                'standard'   => $a['points'] - $a['bonus'],
                'verified'   => $a['verified'],
                'unverified' => $a['unverified'],
                'test'       => $a['test'],
                'cumulative' => $running,
                'is_today'   => $d === $today,
                'top'        => $topId === null ? null : [
                    'id'     => $topId,
                    'name'   => $founders[$topId]['name'] ?? $topId,
                    'points' => $a['by'][$topId],
                ],
            ];
            $cursor->modify('+1 day');
        }
    }

    /* --- day-end standings, reconstructed from the rows' own timestamps --- */
    usort($events, static fn($a, $b) => $a[0] <=> $b[0]);
    $rankHistory = [];
    if ($events) {
        $run = array_fill_keys($ids, 0);
        $i = 0;
        foreach ($daily as $row) {
            $cut = (new DateTime($row['day'] . ' 23:59:59', $tz))->getTimestamp();
            while ($i < count($events) && $events[$i][0] <= $cut) {
                $run[$events[$i][1]] = ($run[$events[$i][1]] ?? 0) + 1;
                $i++;
            }
            $rankHistory[] = ['day' => $row['day'], 'points' => $run,
                              'rank' => ngd_rank_map($run, $ids)];
        }
    }

    /* --- the founder table --- */
    $pointsNow = [];
    foreach ($ids as $id) {
        $pointsNow[$id] = $f[$id]['points'];
    }
    $rankNow = ngd_rank_map($pointsNow, $ids);
    $rankPrev = null;
    if (count($rankHistory) >= 2) {
        $rankPrev = $rankHistory[count($rankHistory) - 2]['rank'];
    }

    $foundersOut = [];
    foreach ($ids as $id) {
        $a = $f[$id];
        $prevRank = $rankPrev[$id] ?? null;
        $trend = [];
        foreach ($daily as $row) {
            $trend[] = $a['by_day'][$row['day']] ?? 0;
        }
        $foundersOut[] = $founders[$id] + [
            'points'        => $a['points'],
            'voters'        => count($a['voters']),
            'bonus'         => $a['bonus'],
            'standard'      => $a['points'] - $a['bonus'],
            'verified'      => $a['verified'],
            'unverified'    => $a['unverified'],
            'test'          => $a['test'],
            'today'         => $a['today'],
            'yesterday'     => $a['yesterday'],
            'growth_pct'    => $a['yesterday'] > 0
                                 ? round(($a['today'] - $a['yesterday']) / $a['yesterday'] * 100, 1)
                                 : ($a['today'] > 0 ? null : 0.0),
            'share_pct'     => ngd_pct((float) $a['points'], (float) $tot['points']),
            'points_per_voter' => count($a['voters']) > 0
                                 ? round($a['points'] / count($a['voters']), 2) : 0.0,
            'rank'          => $rankNow[$id] ?? null,
            'rank_prev'     => $prevRank,
            'rank_move'     => ($prevRank !== null && isset($rankNow[$id])) ? $prevRank - $rankNow[$id] : null,
            'first_point_et' => ngd_et_label($a['first']),
            'last_point_et'  => ngd_et_label($a['last']),
            'trend'         => $trend,
        ];
    }
    usort($foundersOut, static function ($a, $b) {
        return [$a['rank'] ?? 99, $a['id']] <=> [$b['rank'] ?? 99, $b['id']];
    });

    /* --- hourly, and the day x hour heatmap --- */
    $hourly = [];
    for ($h = 0; $h < 24; $h++) {
        $hourly[] = ['hour' => $h, 'points' => $byHour[$h],
                     'share_pct' => ngd_pct((float) $byHour[$h], (float) max(1, array_sum($byHour)))];
    }
    $peak = $byHour ? array_keys($byHour, max($byHour))[0] : null;

    $heatmap = [];
    foreach ($daily as $row) {
        $cells = [];
        for ($h = 0; $h < 24; $h++) {
            $cells[] = $heat[$row['day']][$h] ?? 0;
        }
        $heatmap[] = ['day' => $row['day'], 'weekday' => $row['weekday'], 'hours' => $cells];
    }

    /* --- the cumulative curve, by the hour, so growth reads as a shape --- */
    $cumulative = [];
    if ($events) {
        $run = 0;
        $bucket = [];
        foreach ($events as [$ts, $_]) {
            $k = (new DateTime('@' . $ts))->setTimezone($tz)->format('Y-m-d H:00');
            $bucket[$k] = ($bucket[$k] ?? 0) + 1;
        }
        ksort($bucket);
        foreach ($bucket as $k => $n) {
            $run += $n;
            $cumulative[] = ['at' => $k, 'points' => $n, 'cumulative' => $run];
        }
    }

    /* --- things leadership needs told, not hidden --- */
    $integrity = [];
    if ($tot['test'] > 0) {
        $integrity[] = ['level' => 'warn', 'what' => 'Seeded test votes are inside the official total',
            'detail' => $tot['test'] . ' of the ' . $tot['points'] . ' valid points were written by the '
                      . 'admin panel\'s seed button (voter_key begins "seed:"). pc_tally() counts them, '
                      . 'so the official total counts them, and so does this dashboard. They are broken '
                      . 'out everywhere as "test".'];
    }
    if ($unknown) {
        $integrity[] = ['level' => 'warn', 'what' => 'Votes for contestant ids outside entrant-01..20',
            'detail' => implode(', ', array_map(static fn($k, $v) => $k . ' (' . $v . ')',
                        array_keys($unknown), $unknown)) . '. These are excluded from the founder table.'];
    }
    if ($tot['invalid'] > 0) {
        $integrity[] = ['level' => 'info', 'what' => $tot['invalid'] . ' invalidated points',
            'detail' => 'Rows with valid = 0. They are excluded from every total on this dashboard, '
                      . 'exactly as pc_tally() excludes them.'];
    }
    /* The two legitimate totals. This is not a bug in either place, and a dashboard that
       showed only one of them would be quietly wrong wherever the other is quoted. */
    if ($tot['unverified'] > 0) {
        $integrity[] = ['level' => 'warn', 'what' => 'Two different totals are both correct',
            'detail' => 'The admin dashboard counts every valid row and gets ' . $tot['points']
                      . '. The public standings at /api/pc-rank.php additionally require '
                      . 'simulated = 0 and get ' . $tot['verified'] . '. The ' . $tot['unverified']
                      . ' row(s) in between were cast without a verified identity. This dashboard '
                      . 'leads with the admin figure, because that is the authority, and shows the '
                      . 'public figure beside it.'];
    }
    $integrity[] = ['level' => 'info', 'what' => 'What "slot 2 and 3" really measures',
        'detail' => 'Points in slot 2 or 3 exist only for a voter whose daily allowance is above '
                  . 'one, which today means a verified Eventbrite registration. They are labelled '
                  . 'registration points here, and pc_daily() calls them the attendee bonus '
                  . '(pc-lib.php:378). Strictly, the column records the slot, not the route the '
                  . 'point came in by: an attendee spending a second point through the ordinary '
                  . 'vote endpoint lands in slot 2 just the same. It is a measurement, not an '
                  . 'inference about intent.'];
    $integrity[] = ['level' => 'info', 'what' => 'How historical standings were rebuilt',
        'detail' => 'Day-end rankings come from each row\'s own created_at timestamp, using today\'s '
                  . 'validity flags. A point invalidated this morning is therefore absent from '
                  . 'Friday\'s reconstructed standing too. No ranking was stored at the time, so this '
                  . 'is the only honest reconstruction available.'];

    $launchTs = $tot['first_ts'];

    return [
        'totals' => [
            /* The admin dashboard's definition: every valid row. This is the headline,
               because the brief asks for reconciliation with the admin dashboard. */
            'points'            => $tot['points'],
            /* The public standings' definition: valid AND simulated = 0 (pc-rank.php:66-68).
               Shown beside the headline rather than instead of it, so the two can never
               silently disagree with each other on a leadership screen. */
            'points_public'     => $tot['verified'],
            'invalid'           => $tot['invalid'],
            'voters'            => count($voters),
            'voters_test'       => count($votersTest),
            'standard'          => $tot['standard'],
            'bonus'             => $tot['bonus'],
            'verified'          => $tot['verified'],
            'unverified'        => $tot['unverified'],
            'test'              => $tot['test'],
            'today'             => $tot['today'],
            'today_voters'      => count($votersToday),
            'yesterday'         => $tot['yesterday'],
            'yesterday_voters'  => count($votersYest),
            'day_growth_pct'    => $tot['yesterday'] > 0
                                     ? round(($tot['today'] - $tot['yesterday']) / $tot['yesterday'] * 100, 1)
                                     : null,
            'last24'            => $tot['last24'],
            'prev24'            => $tot['prev24'],
            'rolling_growth_pct' => $tot['prev24'] > 0
                                     ? round(($tot['last24'] - $tot['prev24']) / $tot['prev24'] * 100, 1)
                                     : null,
            'days_active'       => count($daily),
            'points_per_voter'  => count($voters) > 0 ? round($tot['points'] / count($voters), 2) : 0.0,
            'launch_et'         => ngd_et_label($launchTs),
            'launch_day'        => $launchTs !== null ? ngd_day($launchTs) : null,
            'last_point_et'     => ngd_et_label($tot['last_ts']),
            'peak_hour'         => $peak,
            'bonus_share_pct'   => ngd_pct((float) $tot['bonus'], (float) max(1, $tot['points'])),
            'verified_share_pct' => ngd_pct((float) $tot['verified'], (float) max(1, $tot['points'])),
        ],
        'founders'     => $foundersOut,
        'daily'        => $daily,
        'hourly'       => $hourly,
        'heatmap'      => $heatmap,
        'cumulative'   => $cumulative,
        'rank_history' => $rankHistory,
        'integrity'    => $integrity,
    ];
}

/** Equal totals share a rank, so a tie reads as a tie. Mirrors pc_standings(), pc-lib.php:442. */
function ngd_rank_map(array $points, array $ids): array
{
    $pairs = [];
    foreach ($ids as $id) {
        $pairs[] = [$id, (int) ($points[$id] ?? 0)];
    }
    usort($pairs, static fn($a, $b) => [-$a[1], $a[0]] <=> [-$b[1], $b[0]]);
    $out = [];
    $place = 0;
    $last = null;
    $seen = 0;
    foreach ($pairs as [$id, $n]) {
        $seen++;
        if ($n !== $last) {
            $place = $seen;
            $last = $n;
        }
        $out[$id] = $place;
    }
    return $out;
}

/* ---------------------------------------------------------------------------
   8. WEBSITE EVENTS

   What the voting database never collected: page views, founder engagement, the
   ticket journey. Read out of the analytics store, which is a different file in a
   different folder. Everything here is honest about when collection started --
   there is no backfill, because there is nothing to backfill from.
   ------------------------------------------------------------------------ */

function ngd_event_report(?string $from = null, ?string $to = null): array
{
    $db = ngd_events_db();
    $out = [
        'ok' => false, 'collecting' => false, 'since' => null,
        'kinds' => [], 'by_day' => [], 'by_page' => [], 'by_source' => [],
        'by_entrant' => [], 'funnel' => [], 'note' => '',
    ];
    if ($db === null) {
        $out['note'] = 'The analytics event store could not be opened. Voting is unaffected.';
        return $out;
    }
    try {
        $n = (int) $db->query('SELECT COUNT(*) AS n FROM ngd_event')->fetch()['n'];
        if ($n === 0) {
            $out['ok'] = true;
            $out['note'] = 'No website events have been collected yet. Page views, founder '
                         . 'engagement and the ticket journey start being recorded the moment the '
                         . 'collector is live on the production site. Nothing before that moment '
                         . 'exists, and none of it can be reconstructed.';
            return $out;
        }
        $where = '';
        $args = [];
        if ($from !== null) { $where .= ($where ? ' AND ' : ' WHERE ') . 'day >= ?'; $args[] = $from; }
        if ($to   !== null) { $where .= ($where ? ' AND ' : ' WHERE ') . 'day <= ?'; $args[] = $to; }

        $q = static function (PDO $db, string $sql, array $args): array {
            $s = $db->prepare($sql);
            $s->execute($args);
            return $s->fetchAll();
        };

        foreach ($q($db, 'SELECT kind, COUNT(*) AS n, COUNT(DISTINCT visitor) AS u FROM ngd_event'
                      . $where . ' GROUP BY kind ORDER BY n DESC', $args) as $r) {
            $out['kinds'][(string) $r['kind']] = ['events' => (int) $r['n'], 'visitors' => (int) $r['u']];
        }
        foreach ($q($db, 'SELECT day, kind, COUNT(*) AS n, COUNT(DISTINCT visitor) AS u FROM ngd_event'
                      . $where . ' GROUP BY day, kind ORDER BY day ASC', $args) as $r) {
            $out['by_day'][] = ['day' => (string) $r['day'], 'kind' => (string) $r['kind'],
                                'events' => (int) $r['n'], 'visitors' => (int) $r['u']];
        }
        foreach ($q($db, 'SELECT page, COUNT(*) AS n, COUNT(DISTINCT visitor) AS u FROM ngd_event'
                      . ($where ? $where . ' AND ' : ' WHERE ') . "kind = 'page_view'"
                      . ' GROUP BY page ORDER BY n DESC LIMIT 60', $args) as $r) {
            $out['by_page'][] = ['page' => (string) ($r['page'] ?? '/'),
                                 'views' => (int) $r['n'], 'visitors' => (int) $r['u']];
        }
        foreach ($q($db, 'SELECT source, COUNT(*) AS n, COUNT(DISTINCT visitor) AS u FROM ngd_event'
                      . $where . ' GROUP BY source ORDER BY n DESC LIMIT 40', $args) as $r) {
            $out['by_source'][] = ['source' => (string) ($r['source'] ?? 'direct'),
                                   'events' => (int) $r['n'], 'visitors' => (int) $r['u']];
        }
        foreach ($q($db, 'SELECT entrant_id, kind, COUNT(*) AS n, COUNT(DISTINCT visitor) AS u
                          FROM ngd_event' . ($where ? $where . ' AND ' : ' WHERE ')
                      . 'entrant_id IS NOT NULL GROUP BY entrant_id, kind', $args) as $r) {
            $out['by_entrant'][] = ['entrant_id' => (string) $r['entrant_id'], 'kind' => (string) $r['kind'],
                                    'events' => (int) $r['n'], 'visitors' => (int) $r['u']];
        }
        $first = $db->query('SELECT MIN(created_at) AS a FROM ngd_event')->fetch();
        $out['since'] = $first['a'] ?? null;
        $out['collecting'] = true;
        $out['ok'] = true;
        $out['note'] = 'Collected by this site only, from ' . (string) ($out['since'] ?? 'the start')
                     . ' onward. Events before that were never recorded.';
    } catch (Throwable $e) {
        $out['note'] = 'The analytics event store could not be read. Voting is unaffected.';
    }
    return $out;
}

/* ---------------------------------------------------------------------------
   9. AN ARBITRARY DATE RANGE

   The snapshot answers every named window -- all time, today, yesterday, the rolling
   24 and 48 hours -- without touching the database again. A custom range is the one
   thing it cannot answer from what it holds, for one specific reason: unique voters do
   not add up. Two days of forty unique voters each are not eighty unique voters, and
   the only honest way to know the real figure is to look at the rows again. We do not
   ship voter keys to the browser to work it out there; they are identifiers, and a
   leadership dashboard has no business holding them.

   So a custom range does its own small read, with the day index doing the work, and
   caches the answer under a key made from the range. Picking the same range twice
   costs one file read.
   ------------------------------------------------------------------------ */

function ngd_range(string $source, string $from, string $to, bool $force = false): array
{
    $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) ? $from : '';
    $to   = preg_match('/^\d{4}-\d{2}-\d{2}$/', $to) ? $to : '';
    if ($from === '' || $to === '' || $from > $to) {
        return ['ok' => false, 'error' => 'give a from and a to date as YYYY-MM-DD, from on or before to'];
    }

    $key = ngd_var_dir() . '/ngd-range-' . preg_replace('/[^a-z]/', '', $source)
         . '-' . $from . '_' . $to . '.json';
    if (!$force && is_file($key) && (time() - (int) @filemtime($key)) < NGD_SNAP_TTL) {
        $raw = @file_get_contents($key);
        $try = is_string($raw) ? json_decode($raw, true) : null;
        if (is_array($try)) {
            $try['served'] = 'cache';
            return $try;
        }
    }

    $path = ngd_db_path($source);
    if ($path === null) {
        return ['ok' => false, 'error' => 'no voting database found for the ' . $source . ' source'];
    }
    /* The copy, not the live file -- the same rule as ngd_build(), and for the same
       reason. This function was reading the live ballot directly on every novel date
       range, which is exactly the thing the rest of this file exists to avoid: a range
       nobody had asked for before is a cache miss, and a cache miss was a full scan of
       the live database while somebody was trying to vote. */
    $snapTaken = ngd_take_snapshot($path);
    $db = ngd_ro($snapTaken['path']);
    if ($db === null || !ngd_has_table($db, 'pc_votes')) {
        return ['ok' => false, 'error' => 'the voting database could not be opened read-only'];
    }

    $founders = ngd_founders($source);
    unset($founders['_from']);
    $out = [
        'ok' => true, 'from' => $from, 'to' => $to, 'source' => $source,
        'built_at' => ngd_now(), 'served' => 'fresh',
        'points' => 0, 'voters' => 0, 'standard' => 0, 'bonus' => 0,
        'verified' => 0, 'unverified' => 0, 'test' => 0, 'invalid' => 0,
        'founders' => [], 'days' => 0,
    ];

    try {
        $W = 'competition = ? AND vote_day >= ? AND vote_day <= ?';
        $a = [NGD_COMPETITION, $from, $to];

        $one = static function (PDO $db, string $sql, array $args): int {
            $s = $db->prepare($sql);
            $s->execute($args);
            $r = $s->fetch();
            return $r === false ? 0 : (int) array_values($r)[0];
        };

        $out['points']     = $one($db, "SELECT COUNT(*) FROM pc_votes WHERE $W AND valid = 1", $a);
        $out['invalid']    = $one($db, "SELECT COUNT(*) FROM pc_votes WHERE $W AND valid = 0", $a);
        $out['voters']     = $one($db, "SELECT COUNT(DISTINCT voter_key) FROM pc_votes WHERE $W AND valid = 1", $a);
        $out['bonus']      = $one($db, "SELECT COUNT(*) FROM pc_votes WHERE $W AND valid = 1 AND slot > 1", $a);
        $out['standard']   = $out['points'] - $out['bonus'];
        $out['verified']   = $one($db, "SELECT COUNT(*) FROM pc_votes WHERE $W AND valid = 1 AND simulated = 0", $a);
        $out['unverified'] = $out['points'] - $out['verified'];
        $out['test']       = $one($db, "SELECT COUNT(*) FROM pc_votes WHERE $W AND valid = 1 AND voter_key LIKE 'seed:%'", $a);
        $out['days']       = $one($db, "SELECT COUNT(DISTINCT vote_day) FROM pc_votes WHERE $W AND valid = 1", $a);

        $per = [];
        $s = $db->prepare("SELECT entrant_id, COUNT(*) AS n, COUNT(DISTINCT voter_key) AS u,
                                  SUM(CASE WHEN slot > 1 THEN 1 ELSE 0 END) AS b
                           FROM pc_votes WHERE $W AND valid = 1 GROUP BY entrant_id");
        $s->execute($a);
        foreach ($s->fetchAll() as $r) {
            $per[(string) $r['entrant_id']] = [
                'points' => (int) $r['n'], 'voters' => (int) $r['u'], 'bonus' => (int) $r['b'],
            ];
        }
        $db = null;

        $pointsOnly = [];
        foreach (array_keys($founders) as $id) {
            $pointsOnly[$id] = $per[$id]['points'] ?? 0;
        }
        $ranks = ngd_rank_map($pointsOnly, array_keys($founders));
        foreach ($founders as $id => $e) {
            $p = $per[$id] ?? ['points' => 0, 'voters' => 0, 'bonus' => 0];
            $out['founders'][] = $e + $p + [
                'rank'      => $ranks[$id] ?? null,
                'share_pct' => ngd_pct((float) $p['points'], (float) max(1, $out['points'])),
            ];
        }
        usort($out['founders'], static fn($x, $y) => [$x['rank'], $x['id']] <=> [$y['rank'], $y['id']]);

        /* Bound the cache before adding to it. Every distinct from/to pair used to create a
           file that nothing ever removed, on the same filesystem and the same account quota
           as the live voting database -- and a full disk is how a vote INSERT fails and the
           voter is told they used their allowance. An authenticated user clicking through
           date ranges should not be able to do that by accident. */
        ngd_range_cache_trim();
        @file_put_contents($key, json_encode($out), LOCK_EX);
        @chmod($key, 0640);
    } catch (Throwable $e) {
        return ['ok' => false, 'error' => 'the range could not be counted'];
    }
    return $out;
}

/* ---------------------------------------------------------------------------
   10. INSIGHTS

   Every line here is derived from a number already on this page, and every line says
   which number. Nothing is inferred about cause: "votes rose the day the email went
   out" is a correlation and would be phrased as one. Where the data cannot support a
   claim the claim is not made -- the gap is reported instead, because a leadership
   dashboard that invents a trend is worse than one that admits a blind spot.
   ------------------------------------------------------------------------ */

function ngd_hour_label(int $h): string
{
    $ampm = $h < 12 ? 'am' : 'pm';
    $v = $h % 12;
    return ($v === 0 ? 12 : $v) . $ampm;
}

function ngd_insights(array $snap, array $events): array
{
    $out = [];
    $t = $snap['totals'] ?? [];
    $daily = $snap['daily'] ?? [];
    $founders = $snap['founders'] ?? [];

    if (!$t || (int) ($t['points'] ?? 0) === 0) {
        return [[
            'tone' => 'flat', 'headline' => 'No voting activity to interpret yet',
            'evidence' => 'The voting table holds no valid points for this source.',
            'action' => 'Nothing to do. Insights appear as soon as points are cast.',
        ]];
    }

    /* --- is engagement rising or falling? compare the last two finished days --- */
    $closed = array_values(array_filter($daily, static fn($d) => empty($d['is_today'])));
    $n = count($closed);
    if ($n >= 2) {
        $last = $closed[$n - 1];
        $prev = $closed[$n - 2];
        $delta = $last['points'] - $prev['points'];
        $pct = $prev['points'] > 0 ? (int) round($delta / $prev['points'] * 100) : null;
        $out[] = [
            'tone' => $delta > 0 ? 'good' : ($delta < 0 ? 'warn' : 'flat'),
            'headline' => $delta > 0
                ? 'Voting is growing day on day'
                : ($delta < 0 ? 'Voting slowed on the last full day' : 'Voting held level day on day'),
            'evidence' => $last['day'] . ' took ' . $last['points'] . ' points from '
                        . $last['voters'] . ' voters, against ' . $prev['points'] . ' from '
                        . $prev['voters'] . ' on ' . $prev['day']
                        . ($pct === null ? '' : ' (' . ($pct >= 0 ? '+' : '') . $pct . '%)') . '.',
            'action' => $delta >= 0
                ? 'Whatever went out before ' . $last['day'] . ' is working. Repeat it, earlier in the day.'
                : 'Asking the founders to share their own contestant links is the cheapest lever: '
                  . 'those pages are the only traffic the site attributes today.',
        ];
    }

    /* --- today against yesterday, which is what anyone asks first --- */
    if (isset($t['today'], $t['yesterday'])) {
        $pct = $t['day_growth_pct'] ?? null;
        $out[] = [
            'tone' => $t['today'] >= $t['yesterday'] ? 'good' : 'warn',
            'headline' => 'Today stands at ' . $t['today'] . ' points from ' . $t['today_voters'] . ' voters',
            'evidence' => 'Yesterday finished on ' . $t['yesterday'] . ' points from '
                        . $t['yesterday_voters'] . ' voters'
                        . ($pct === null ? '' : ', so today is ' . ($pct >= 0 ? '+' : '') . $pct . '%')
                        . '. Today is still open, so this compares a part-day with a whole one.',
            'action' => 'Worth reading again after the evening peak rather than at lunchtime.',
        ];
    }

    /* --- who has momentum, measured rather than guessed --- */
    $movers = array_values(array_filter($founders, static fn($f) => (int) ($f['today'] ?? 0) > 0));
    usort($movers, static fn($a, $b) => $b['today'] <=> $a['today']);
    if ($movers) {
        $top = array_slice($movers, 0, 3);
        $bits = [];
        foreach ($top as $f) {
            $bits[] = $f['name'] . ' +' . $f['today'];
        }
        $climb = array_values(array_filter($founders, static fn($f) => (int) ($f['rank_move'] ?? 0) > 0));
        usort($climb, static fn($a, $b) => $b['rank_move'] <=> $a['rank_move']);
        $out[] = [
            'tone' => 'good',
            'headline' => 'Strongest momentum today: ' . $top[0]['name'],
            'evidence' => implode(', ', $bits) . ' points so far today.'
                        . ($climb ? ' Biggest climb since yesterday: ' . $climb[0]['name']
                            . ', up ' . $climb[0]['rank_move'] . ' place'
                            . ($climb[0]['rank_move'] === 1 ? '' : 's')
                            . ' to ' . $climb[0]['rank'] . '.' : ''),
            'action' => 'Momentum here is a sharing effect. Ask the three above what they did, and tell the rest.',
        ];
    }

    /* --- when voting actually happens --- */
    $hourly = $snap['hourly'] ?? [];
    if ($hourly) {
        $byPoints = $hourly;
        usort($byPoints, static fn($a, $b) => $b['points'] <=> $a['points']);
        $top3 = array_slice($byPoints, 0, 3);
        $window = array_map(static fn($r) => ngd_hour_label((int) $r['hour']), $top3);
        $share = array_sum(array_column($top3, 'share_pct'));
        $out[] = [
            'tone' => 'info',
            'headline' => 'Voting peaks around ' . ngd_hour_label((int) $top3[0]['hour']) . ' Eastern',
            'evidence' => 'The three busiest hours across the whole competition are '
                        . implode(', ', $window) . ', carrying ' . round($share) . '% of all points.',
            'action' => 'Send the next push an hour before ' . ngd_hour_label((int) $top3[0]['hour'])
                      . ' Eastern rather than first thing in the morning.',
        ];
    }

    /* --- what share of points the registration bonus carries --- */
    if ((int) ($t['bonus'] ?? 0) > 0) {
        $out[] = [
            'tone' => 'info',
            'headline' => 'Registered attendees supply ' . round($t['bonus_share_pct']) . '% of all points',
            'evidence' => $t['bonus'] . ' of ' . $t['points'] . ' points are second and third points, '
                        . 'which only a verified registration unlocks (slot > 1).',
            'action' => 'A registration is worth three points a day instead of one. That is the strongest '
                      . 'argument the ticket page has, and the People\'s Choice page is where to make it.',
        ];
    } else {
        $out[] = [
            'tone' => 'warn',
            'headline' => 'No registration bonus points have been claimed',
            'evidence' => 'Every one of the ' . $t['points'] . ' points sits in slot 1, so no voter has '
                        . 'yet had a registration verified and spent the two extra points it unlocks.',
            'action' => 'Worth confirming the bonus claim path is reachable before promoting it.',
        ];
    }

    /* --- verification, which is the quality question --- */
    if (isset($t['verified_share_pct'])) {
        $vs = (float) $t['verified_share_pct'];
        $out[] = [
            'tone' => $vs >= 60 ? 'good' : 'warn',
            'headline' => round($vs) . '% of points come from a verified voter',
            'evidence' => $t['verified'] . ' points were cast after an email or phone was verified '
                        . '(simulated = 0); ' . $t['unverified'] . ' were not. Both are counted in the '
                        . 'official total, exactly as the admin dashboard counts them.',
            'action' => $vs >= 60
                ? 'Verification is holding up. No action.'
                : 'A majority of points are unverified. Better decided now than after the close.',
        ];
    }

    /* --- the funnel, only as far as the data honestly reaches --- */
    $traffic = $snap['traffic'] ?? [];
    if (!empty($traffic['ok']) && (int) ($traffic['total'] ?? 0) > 0) {
        $conv = ngd_pct((float) ($t['voters'] ?? 0), (float) $traffic['uniques']);
        $out[] = [
            'tone' => 'info',
            'headline' => 'Contestant pages: ' . $traffic['total'] . ' visits from about '
                        . $traffic['uniques'] . ' people',
            'evidence' => 'Only individual contestant pages are counted (pc_log_visit, entrant.php:41). '
                        . 'Against ' . ($t['voters'] ?? 0) . ' unique voters that is a ' . $conv
                        . '% visit-to-vote rate -- but the denominator is partial, so it is a floor, '
                        . 'not a rate.',
            'action' => 'The site-wide funnel needs the collector live on production. Until then this is '
                      . 'the only traffic figure that exists.',
        ];
    } else {
        $out[] = [
            'tone' => 'warn',
            'headline' => 'Traffic and conversion cannot be reported yet',
            'evidence' => 'No page-view or ticket-journey events have ever been collected on this source. '
                        . 'The voting table records votes, not visits.',
            'action' => 'Approve the collector for production and the funnel fills from that moment. '
                      . 'Nothing before it can be reconstructed.',
        ];
    }

    if (!empty($events['collecting'])) {
        $k = $events['kinds'] ?? [];
        $views    = (int) ($k['page_view']['visitors'] ?? 0);
        $votes    = (int) ($k['vote_confirmed']['events'] ?? 0);
        $clicks   = (int) ($k['ticket_cta']['events'] ?? 0);
        $checkout = (int) ($k['checkout_open']['events'] ?? 0);
        $out[] = [
            'tone' => $checkout > 0 ? 'good' : 'info',
            'headline' => 'The ticket journey, as measured since collection began',
            'evidence' => $views . ' unique visitors, ' . $votes . ' vote confirmations, ' . $clicks
                        . ' ticket-link clicks, ' . $checkout . ' checkouts opened. Confirmed orders are '
                        . 'never inferred from any of these.',
            'action' => ($clicks > 0 && $checkout === 0)
                ? 'People are clicking through to tickets and not opening checkout. That gap is on the '
                  . 'ticket page, and it is the cheapest thing on this list to fix.'
                : 'Keep watching the click-to-checkout step; that is where a funnel usually leaks.',
        ];
    }

    return $out;
}

/* ---------------------------------------------------------------------------
   11. FEATURE FLAGS

   Two things need to be switchable without a deploy, and for different reasons.

   collect -- whether the website-event collector records anything. It defaults OFF on
   the live site and ON on the review site, deliberately. New tracking on a production
   website is a decision for the owner, not a side effect of shipping a dashboard, and
   the brief is explicit that it waits for separate approval. So the code can be
   deployed, reviewed and left inert, and switched on later from inside the dashboard
   with one click rather than another release.

   dashboard -- whether the reporting pages answer at all. If anything about this
   analytics layer ever looked like it was costing the live site performance, somebody
   needs to be able to turn it off in ten seconds from a phone, without a build.

   The flags live in the analytics folder, outside the web root, so a deploy cannot
   silently reset them back to the defaults.

   Nothing in the voting or ticketing path reads these flags, or this file. If this
   whole mechanism failed, voting would not notice.
   ------------------------------------------------------------------------ */

function ngd_flags_file(): string
{
    return ngd_var_dir() . '/ngd-flags.json';
}

function ngd_flags(bool $fresh = false): array
{
    static $cache = null;
    if ($cache !== null && !$fresh) {
        return $cache;
    }
    $defaults = [
        /* OFF everywhere, including the review site.

           It used to default on for staging, on the reasoning that staging is harmless.
           That reasoning was wrong, and an adversarial review found why: the review site's
           analytics folder is a SIBLING of the live voting database, on one filesystem,
           under one Unix account. An unauthenticated flood of the staging collector fills
           the shared quota, and a full disk is how a vote INSERT fails -- which pc_cast()
           reports to the voter as "you have used your allowance" (pc-lib.php:258-265).
           A test environment that can take votes away from real people is not harmless.

           So it is opt-in on every site, and the owner turns it on from Settings. */
        'collect'   => false,
        'dashboard' => true,
    ];
    $cache = $defaults;
    $f = ngd_flags_file();
    if (is_file($f) && is_readable($f)) {
        $raw = @file_get_contents($f);
        $d = is_string($raw) ? json_decode($raw, true) : null;
        if (is_array($d)) {
            foreach ($defaults as $k => $v) {
                if (isset($d[$k])) {
                    $cache[$k] = (bool) $d[$k];
                }
            }
        }
    }
    return $cache;
}

function ngd_flag(string $name): bool
{
    return (bool) (ngd_flags()[$name] ?? false);
}

function ngd_flag_set(string $name, bool $on): bool
{
    $flags = ngd_flags(true);
    if (!array_key_exists($name, $flags)) {
        return false;
    }
    $flags[$name] = $on;
    $body = json_encode($flags + ['updated' => ngd_now()], JSON_PRETTY_PRINT);
    if (!is_string($body)) {
        return false;
    }
    $f = ngd_flags_file();
    $tmp = $f . '.' . bin2hex(random_bytes(4)) . '.tmp';
    if (@file_put_contents($tmp, $body, LOCK_EX) === false) {
        return false;
    }
    @chmod($tmp, 0640);
    if (!@rename($tmp, $f)) {
        @unlink($tmp);
        return false;
    }
    ngd_flags(true);
    return true;
}

/* ---------------------------------------------------------------------------
   12. RECORDING A WEBSITE EVENT

   The only write in this whole system, and it goes to ngd-events.sqlite -- a different
   file, in a different folder, opened by a handle that has never been given the voting
   database's path. "The collector cannot modify voting records" is therefore not a
   permission that somebody could misconfigure; there is no code path.

   Everything that could identify a person is left out by construction:
     - no IP address is stored, only the same salted day-scoped token the voting system
       already uses for contestant-page visits (pc_visitor_token, pc-rules.php:130),
       which stops being linkable to anything tomorrow
     - no cookie is set by the collector, ever
     - no referrer host, no query string, no user agent string is kept
     - the page is stored as a cleaned path, never a full URL
   ------------------------------------------------------------------------ */

const NGD_EVENT_KINDS = [
    'page_view',          // a page was opened
    'founder_view',       // a founder's card, bubble or reel came into view
    'founder_open',       // a founder was actively opened: card click, bubble select, reel
    'video_play',         // a founder's pitch video started
    'nominees_open',      // the "view our nominees" entry into the reels
    'vote_start',         // the vote button was pressed
    'verify_open',        // the verification dialog appeared
    'otp_request',        // a code was asked for
    'otp_verified',       // a code was accepted
    'vote_confirmed',     // a point was successfully cast
    'vote_blocked',       // the attempt was refused, with the reason in meta
    'bonus_claimed',      // the registration bonus was claimed
    'attendee_unlocked',  // a registration was verified and the allowance went up
    'ticket_cta',         // a link towards tickets was clicked
    'tickets_view',       // the ticket page was opened
    'checkout_open',      // the Eventbrite checkout actually opened
    'share_click',        // a share control was used
];

function ngd_event_record(array $in): array
{
    if (!ngd_flag('collect')) {
        return ['ok' => false, 'reason' => 'off'];
    }
    $kind = isset($in['kind']) && is_string($in['kind']) ? $in['kind'] : '';
    if (!in_array($kind, NGD_EVENT_KINDS, true)) {
        return ['ok' => false, 'reason' => 'kind'];
    }

    $db = ngd_events_db();
    if ($db === null) {
        return ['ok' => false, 'reason' => 'store'];
    }

    $visitor = ngd_visitor_token();
    $now = time();

    /* ---- the ceilings ----

       The first version limited 120 events per minute per VISITOR TOKEN, and the token is
       a hash of address, user agent and the day. The user agent is a request header, so the
       attacker chose two thirds of the key: a fresh User-Agent per request produced a fresh
       bucket and the limit never fired once. The rate key is now the address alone
       (ngd_ip_key), which is the part a client cannot pick.

       Above that sit two ceilings that hold no matter what the rate limiter does, because
       the thing being protected is not this store -- it is the SHARED DISK that the live
       voting database sits on. A full disk is how a vote INSERT fails, and pc_cast()
       reports that failure to the voter as "you have used your allowance"
       (pc-lib.php:258-265). So: a hard row cap, and a free-space floor. Both are cached for
       a minute so they cost one query, not one per event. */
    try {
        $s = $db->prepare('SELECT COUNT(*) AS n FROM ngd_event WHERE source_ip = ? AND ts >= ?');
        $s->execute([ngd_ip_key(), $now - 60]);
        if ((int) $s->fetch()['n'] >= NGD_RATE_PER_MIN) {
            return ['ok' => false, 'reason' => 'rate'];
        }
    } catch (Throwable $e) {
        return ['ok' => false, 'reason' => 'store'];
    }

    if (!ngd_store_has_room($db)) {
        return ['ok' => false, 'reason' => 'full'];
    }

    /* A path, not a URL: no host, no query string, no fragment, length capped. */
    $page = isset($in['page']) && is_string($in['page']) ? $in['page'] : '';
    $page = (string) parse_url($page, PHP_URL_PATH);
    $page = substr(preg_replace('#[^a-zA-Z0-9/._-]#', '', $page) ?? '', 0, 120);
    if ($page === '') {
        $page = '/';
    }

    $entrant = isset($in['entrant']) && is_string($in['entrant'])
        && preg_match('/^entrant-\d{2}$/', $in['entrant']) ? $in['entrant'] : null;

    /* The campaign or referrer label, same cleaning the voting system applies to its own
       source parameter (pc-rules.php:138). */
    $src = isset($in['source']) && is_string($in['source']) && $in['source'] !== ''
        ? substr(preg_replace('/[^a-z0-9_.-]/i', '', $in['source']) ?? '', 0, 40) : 'direct';
    if ($src === '') {
        $src = 'direct';
    }

    /* A per-tab random id the page holds in sessionStorage. It is not a cookie, it is not
       persisted beyond the tab, and it exists only so a funnel can tell one visit's steps
       apart from another's. Anything that is not 8 to 32 hex characters is dropped. */
    $sess = isset($in['session']) && is_string($in['session'])
        && preg_match('/^[a-f0-9]{8,32}$/', $in['session']) ? $in['session'] : null;

    /* A small, closed set of extra facts. Never free text from the page. */
    $meta = null;
    if (isset($in['meta']) && is_array($in['meta'])) {
        $keep = [];
        foreach (['reason', 'slot', 'rank', 'position', 'remaining', 'allowance', 'fit', 'ms'] as $k) {
            if (!isset($in['meta'][$k])) {
                continue;
            }
            $v = $in['meta'][$k];
            if (is_bool($v) || is_int($v) || is_float($v)) {
                $keep[$k] = $v;
            } elseif (is_string($v)) {
                $keep[$k] = substr(preg_replace('/[^a-zA-Z0-9_.: -]/', '', $v) ?? '', 0, 40);
            }
        }
        if ($keep) {
            $meta = json_encode($keep);
        }
    }

    try {
        $s = $db->prepare('INSERT INTO ngd_event
            (kind, page, entrant_id, source, visitor, source_ip, session, day, created_at, ts, meta)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $s->execute([$kind, $page, $entrant, $src, $visitor, ngd_ip_key(), $sess,
                     ngd_day($now), ngd_now(), $now, $meta]);
    } catch (Throwable $e) {
        return ['ok' => false, 'reason' => 'store'];
    }
    return ['ok' => true];
}

/* ---------------------------------------------------------------------------
   13. THE SNAPSHOT COPY — why nothing is counted against the live file

   This is the most important function here, and it exists because of a specific chain
   of code in the voting system:

     1. The voting database is in SQLite's default rollback-journal mode. Nothing in the
        voting code sets WAL; the only PRAGMA it issues is busy_timeout (_lib.php:84).
        In that mode a reader holds a SHARED lock, and a writer cannot take the EXCLUSIVE
        lock it needs until every reader has let go.

     2. A vote INSERT therefore has to WAIT behind any report that is mid-scan. It waits
        for five seconds and then throws (_lib.php:84).

     3. pc_cast() wraps each slot's INSERT in catch (Throwable) with the comment
        "that slot is taken; try the next one" (pc-lib.php:258-262). A lock timeout is
        not distinguishable there from a genuine duplicate.

     4. Having exhausted the slots, pc_cast returns ['ok' => false, 'reason' => 'allowance']
        (pc-lib.php:265) and the voter is told they have used their allowance for the day.

   So a dashboard that aggregates a few thousand rows against the live file, while voting
   is open, can take a real vote away from a real person and tell them it was their own
   fault. Nothing is logged. That is not an acceptable cost for a chart.

   The fix is to hold the live file for milliseconds instead of for the length of a page
   render: copy it with VACUUM INTO, close, and do every count on the copy. VACUUM INTO
   is transactionally consistent, so the copy is a real instant rather than a smear.

   Two things were measured rather than assumed, because they decide the design:
     - VACUUM INTO DOES work through a read-only handle (both the SQLITE_OPEN_READONLY
       flag and the file:...?mode=ro URI), and leaves the source byte-identical.
     - PRAGMA query_only = 1 BLOCKS it: "attempt to write a readonly database".

   Hence the one deliberate asymmetry in this file. The handle that takes the copy is
   opened read-only WITHOUT query_only, because query_only would stop the copy; it runs
   exactly one statement and is closed immediately. The handle that does the counting --
   the long-lived one, on the copy -- gets query_only as well. The thing being protected
   is the live ballot, and no handle on it is ever long-lived or ever writable.

   If VACUUM INTO is unavailable (SQLite older than 3.27), the fallback reads the live
   file directly with query_only set and short statements, and says so in the health
   panel. That is the old behaviour, and it is reported rather than hidden.
   ------------------------------------------------------------------------ */

function ngd_snapshot_path(string $liveFile): string
{
    return ngd_var_dir() . '/ngd-src-' . substr(hash('sha256', $liveFile), 0, 12) . '.sqlite';
}

/**
 * @return array{path:string, how:string, ms:int}  path is the file to COUNT against:
 *         the copy when one could be taken, the live file when it could not.
 */
function ngd_take_snapshot(string $liveFile): array
{
    $out = ngd_snapshot_path($liveFile);
    $t0 = microtime(true);

    $db = ngd_ro($liveFile, true);           // no query_only: it would block VACUUM INTO
    if ($db === null) {
        return ['path' => $liveFile, 'how' => 'none (the live file could not be opened read-only)', 'ms' => 0];
    }

    try {
        /* VACUUM INTO refuses to overwrite, so the previous copy goes first. A failure to
           delete is not fatal; it just means this build reads the live file instead. */
        if (is_file($out)) {
            @unlink($out);
        }
        if (is_file($out)) {
            throw new RuntimeException('the previous snapshot could not be replaced');
        }
        $db->exec('VACUUM INTO ' . $db->quote($out));
        $db = null;                           // the live file is released here, and not before
        @chmod($out, 0640);
        $ms = (int) round((microtime(true) - $t0) * 1000);
        if (!is_file($out)) {
            throw new RuntimeException('the snapshot did not appear');
        }
        return ['path' => $out, 'how' => 'VACUUM INTO a private copy, live file held ' . $ms . 'ms', 'ms' => $ms];
    } catch (Throwable $e) {
        $db = null;
        /* Old SQLite, a full disk, or a read-only analytics folder. Counting still works
           against the live file -- with query_only set and the row cap in force -- and the
           health panel says plainly that the safer path was not available. */
        return [
            'path' => $liveFile,
            'how'  => 'none: counted against the live file (' . substr($e->getMessage(), 0, 80) . ')',
            'ms'   => (int) round((microtime(true) - $t0) * 1000),
        ];
    }
}

/* ---------------------------------------------------------------------------
   14. THE TABLES THIS LAYER MAY READ

   An explicit allow-list, because "read-only" is not the same as "may read anything".
   One SQLite file holds the votes AND the `submissions` table, which carries plaintext
   names, phone numbers, email addresses and school names for every form the site has
   ever taken (_lib.php:85-92). It also holds pc_email_otp and pc_vote_email_otp, whose
   code_hash column is a live credential: a six-digit code keyed under NGS_SECRET is
   recoverable by trying all 10^6 candidates while the row is unexpired.

   None of that has any business in a leadership report, so this layer names the three
   tables it reads and nothing else ever appears in a query in this file:

     pc_votes   the ballot
     pc_meta    the rules in force
     pc_visits  contestant-page visits

   There is no SELECT * anywhere in this file either; every query names its columns.
   ------------------------------------------------------------------------ */

const NGD_READABLE = ['pc_votes', 'pc_meta', 'pc_visits'];

function ngd_may_read(string $table): bool
{
    return in_array($table, NGD_READABLE, true);
}

/* ---------------------------------------------------------------------------
   15. THE CEILINGS ON THE EVENT STORE

   The collector is the only unauthenticated write in this system, and the thing it can
   damage is not itself. Its folder is a SIBLING of the live voting database, on one
   filesystem, under one Unix account -- so disk consumed here is disk the ballot cannot
   have. SQLite needs room for a rollback journal to commit a vote; without it the INSERT
   fails, pc_cast() catches the failure per slot as "that slot is taken"
   (pc-lib.php:258), and the voter is told they have used their allowance
   (pc-lib.php:265). A flood of analytics is therefore a way to take votes away from real
   people and blame them for it.

   A per-address rate limit alone is not enough, because an attacker with a handful of
   addresses still gets through. These two ceilings do not care how the rows arrived:

     NGD_EVENT_MAX     a hard row count. Past it, nothing is recorded until somebody
                       prunes. Analytics stopping is a nuisance; a competition losing
                       votes is not.
     NGD_DISK_FLOOR    free space below which the collector stops writing, leaving the
                       margin to the thing that matters.

   Both answers are cached for a minute, so they cost one query a minute rather than one
   per event.
   ------------------------------------------------------------------------ */

const NGD_RATE_PER_MIN = 90;              // events per minute per address
const NGD_EVENT_MAX    = 400000;          // hard ceiling on stored rows
const NGD_DISK_FLOOR   = 300 * 1024 * 1024;   // keep at least this much free for the ballot
const NGD_PRUNE_DAYS   = 120;             // rows older than this are dropped when pruning

function ngd_store_has_room(PDO $db): bool
{
    static $until = 0;
    static $ok = true;
    if (time() < $until) {
        return $ok;
    }
    $until = time() + 60;
    $ok = false;

    try {
        $n = (int) $db->query('SELECT COUNT(*) AS n FROM ngd_event')->fetch()['n'];
        if ($n >= NGD_EVENT_MAX) {
            error_log('NextGen Data: event store at its ceiling (' . $n . ' rows); not recording.');
            return $ok = false;
        }
    } catch (Throwable $e) {
        return $ok = false;
    }

    /* disk_free_space() is disabled on some shared hosts; a false return means we cannot
       tell, and not being able to tell is not permission to keep writing next to a live
       ballot -- but it is also not a reason to refuse forever, so treat an unavailable
       answer as room and rely on the row ceiling. */
    $free = @disk_free_space(ngd_var_dir());
    if (is_float($free) && $free > 0 && $free < NGD_DISK_FLOOR) {
        error_log('NextGen Data: only ' . (int) ($free / 1048576) . 'MB free; not recording events.');
        return $ok = false;
    }
    return $ok = true;
}

/** Drop old events. Nothing calls this automatically; it is for the owner's hand. */
function ngd_store_prune(int $days = NGD_PRUNE_DAYS): int
{
    $db = ngd_events_db();
    if ($db === null) {
        return 0;
    }
    try {
        $s = $db->prepare('DELETE FROM ngd_event WHERE ts < ?');
        $s->execute([time() - $days * 86400]);
        return $s->rowCount();
    } catch (Throwable $e) {
        return 0;
    }
}

/* ---------------------------------------------------------------------------
   16. THE LOGIN THROTTLE'S OWN FILE

   The sign-in lockout used to count failures in ngd-events.sqlite -- the same file the
   public collector writes to. That coupling is a way in: flood the collector, the store
   is busy, the throttle's query throws, it fails open (which is correct for a throttle
   that must not lock the owner out of their own dashboard), and the brute-force limit is
   simply gone while the flood lasts.

   Its own small file breaks the coupling. Nothing public writes here.
   ------------------------------------------------------------------------ */

function ngd_throttle_db(): ?PDO
{
    static $pdo = false;
    if ($pdo !== false) {
        return $pdo;
    }
    $pdo = null;
    try {
        $db = new PDO('sqlite:' . ngd_var_dir() . '/ngd-throttle.sqlite', null, null, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        try {
            $db->exec('PRAGMA journal_mode = WAL');
        } catch (Throwable $e) {
            // not fatal
        }
        $db->exec('PRAGMA busy_timeout = 2000');
        $db->exec('CREATE TABLE IF NOT EXISTS ngd_throttle (
            k  TEXT NOT NULL,
            ts INTEGER NOT NULL,
            ok INTEGER NOT NULL DEFAULT 0
        )');
        $db->exec('CREATE INDEX IF NOT EXISTS ngd_throttle_k ON ngd_throttle (k, ts)');
        $pdo = $db;
    } catch (Throwable $e) {
        error_log('NextGen Data: throttle store unavailable. ' . $e->getMessage());
        $pdo = null;
    }
    return $pdo;
}

/**
 * Keep the range cache small.
 *
 * Range files are cheap individually and unbounded collectively: one per distinct from/to
 * pair, in a folder that sits on the same quota as the live ballot. Oldest go first, and
 * the ceiling is low because these rebuild in milliseconds from the snapshot.
 */
function ngd_range_cache_trim(int $keep = 40): void
{
    $files = @glob(ngd_var_dir() . '/ngd-range-*.json') ?: [];
    if (count($files) <= $keep) {
        return;
    }
    $byAge = [];
    foreach ($files as $f) {
        $byAge[$f] = (int) @filemtime($f);
    }
    asort($byAge);
    foreach (array_slice(array_keys($byAge), 0, count($files) - $keep) as $old) {
        @unlink($old);
    }
}
