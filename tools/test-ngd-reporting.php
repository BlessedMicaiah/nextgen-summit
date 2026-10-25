<?php
/* ============================================================================
   Does NEXTGEN DATA agree with the voting system about the numbers?

       php tools/test-ngd-reporting.php

   ngd-lib.php deliberately does not call pc_tally(), pc_daily() or any of the other
   counting functions, because every one of them goes through pc_db(), and pc_db()
   writes (CREATE TABLE / CREATE INDEX on every call). A reporting layer that writes to
   the live ballot is not a reporting layer. So the counting rules are restated there --
   and a restatement is a copy, and copies drift.

   This is the test that catches the drift. It does not check ngd-lib.php against a
   human reading of the rules. It builds a database using the REAL pc_cast(), then asks
   the real pc_tally(), pc_daily(), pc_standings() and pc_invalidated_count() what the
   answers are, asks ngd-lib.php the same questions, and fails if the two disagree by
   so much as one point.

   Nothing here touches a real database. Everything happens in a throwaway sandbox under
   the system temp directory, with its own generated config.php holding obviously fake
   constants. No server is contacted.
   ========================================================================= */

declare(strict_types=1);

$root = dirname(__DIR__);
$sand = rtrim(sys_get_temp_dir(), '/\\') . '/ngd-test-' . bin2hex(random_bytes(4));

$pass = 0;
$fail = 0;
$notes = [];

function ok(string $label, bool $cond, string $detail = ''): void
{
    global $pass, $fail;
    if ($cond) {
        $pass++;
        echo "  PASS  $label\n";
    } else {
        $fail++;
        echo "  FAIL  $label" . ($detail !== '' ? "\n        $detail" : '') . "\n";
    }
}

function same(string $label, $expected, $actual): void
{
    $eq = $expected === $actual;
    ok($label, $eq, $eq ? '' : 'expected ' . json_encode($expected) . ', got ' . json_encode($actual));
}

function rmtree(string $d): void
{
    if (!is_dir($d)) {
        return;
    }
    foreach (scandir($d) ?: [] as $f) {
        if ($f === '.' || $f === '..') {
            continue;
        }
        $p = $d . '/' . $f;
        is_dir($p) ? rmtree($p) : @unlink($p);
    }
    @rmdir($d);
}

/* ---------------------------------------------------------------------------
   1. Build the sandbox: a miniature copy of the site's own directory shape, because
      both libraries navigate by __DIR__ and DOCUMENT_ROOT and would otherwise find
      the developer's real data folder.

        <sand>/public/api/*.php                 the real endpoint code, copied
        <sand>/public/assets/js/pc-founders.js  the real public manifest, copied
        <sand>/nextgen-data/                    the "live" source
        <sand>/nextgen-data-staging/            the "review" source, and what pc_* uses
   ------------------------------------------------------------------------ */

echo "NEXTGEN DATA reconciliation\n";
echo "sandbox  $sand\n\n";

@mkdir($sand . '/public/api', 0777, true);
@mkdir($sand . '/public/assets/js', 0777, true);
@mkdir($sand . '/nextgen-data', 0777, true);
@mkdir($sand . '/nextgen-data-staging', 0777, true);

foreach (glob($root . '/public/api/*.php') ?: [] as $f) {
    /* No real private config of any kind reaches a sandbox: config.php holds the
       live secrets and config.ngd.php holds real account hashes. */
    if (preg_match('/^config(\..+)?\.php$/', basename($f))) {
        continue;
    }
    copy($f, $sand . '/public/api/' . basename($f));
}
copy($root . '/public/assets/js/pc-founders.js', $sand . '/public/assets/js/pc-founders.js');

/* A config of obviously fake constants. NGS_DATA_DIR points at the review folder, which is
   exactly the shape release.py injects for the staging build -- so this also exercises the
   path arithmetic ngd_base_dir() depends on. */
file_put_contents($sand . '/public/api/config.php', "<?php\ndeclare(strict_types=1);\n"
    . "const NGS_ADMIN_SALT = 'abababababababababababab';\n"
    . "const NGS_ADMIN_HASH = 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd';\n"
    . "const NGS_SECRET = 'test-secret-not-a-real-one';\n"
    . "const NGS_DATA_KEY = 'testkey';\n"
    . "const NGS_EVENTBRITE_TOKEN = '';\n"
    . "define('NGS_DATA_DIR', '" . str_replace('\\', '/', $sand) . "/nextgen-data-staging');\n");

$api = $sand . '/public/api';

require_once $api . '/pc-rules.php';     // pulls in pc-lib.php, which pulls in _lib.php
require_once $api . '/ngd-lib.php';

/* ---------------------------------------------------------------------------
   2. Open the competition and generate rows through the real voting code.
   ------------------------------------------------------------------------ */

pc_set_meta('mode', 'daily');
pc_set_meta('state', 'open');
pc_set_meta('deadline', '2030-01-01T23:59:59-05:00');
pc_set_meta('daily_public', '1');
pc_set_meta('daily_ticket', '3');

ok('the competition is open', pc_voting_open());
same('mode is daily', 'daily', pc_mode());
same('a member of the public gets 1 point a day', 1, pc_allowance(false));
same('a verified attendee gets 3 points a day', 3, pc_allowance(true));

$db = pc_db();
ok('the sandbox database opened', $db instanceof PDO);

$today = pc_day();

/* (a) eleven ordinary members of the public, verified, one point each, spread over the field */
$spread = ['entrant-01', 'entrant-01', 'entrant-03', 'entrant-05', 'entrant-05', 'entrant-05',
           'entrant-08', 'entrant-13', 'entrant-13', 'entrant-13', 'entrant-20'];
foreach ($spread as $i => $who) {
    $r = pc_cast('pub-' . $i, $who, false, false);          // simulated = false -> verified
    ok('public vote ' . ($i + 1) . ' accepted', $r['ok'] === true, json_encode($r));
}

/* (b) three people who never verified: simulated = 1, still counted by pc_tally() */
foreach (['entrant-13', 'entrant-15', 'entrant-02'] as $i => $who) {
    $r = pc_cast('unv-' . $i, $who, true, false);
    ok('unverified vote ' . ($i + 1) . ' accepted', $r['ok'] === true, json_encode($r));
}

/* (c) two verified attendees, each spending all three points on one founder, exactly as
       pc-bonus.php does it: the base point, then two more into slots 2 and 3 */
foreach (['entrant-13', 'entrant-20'] as $k => $who) {
    $v = 'att-' . $k;
    $first = pc_cast($v, $who, false, true);
    ok('attendee ' . ($k + 1) . ' base point', $first['ok'] === true, json_encode($first));
    $awarded = 0;
    for ($i = 0; $i < 2; $i++) {
        if (pc_cast($v, $who, false, true)['ok']) {
            $awarded++;
        }
    }
    same('attendee ' . ($k + 1) . ' unlocked two more points', 2, $awarded);
    same('attendee ' . ($k + 1) . ' has nothing left', 0, pc_remaining($v, true));
}

/* (d) the allowance really is a ceiling */
$over = pc_cast('att-0', 'entrant-07', false, true);
ok('a fourth point for the same attendee is refused', $over['ok'] === false
    && ($over['reason'] ?? '') === 'allowance', json_encode($over));

/* (e) four seeded test rows, the way the admin panel's seed button writes them */
foreach (['entrant-04', 'entrant-04', 'entrant-06', 'entrant-11'] as $i => $who) {
    ok('seed row ' . ($i + 1), pc_cast('seed:x:' . $i . ':' . bin2hex(random_bytes(2)), $who, true)['ok'] === true);
}

/* (f) one vote that then gets invalidated, so valid = 0 has something to count */
ok('the row that will be invalidated was cast', pc_cast('bad-1', 'entrant-09', false, false)['ok'] === true);
ok('and pc_invalidate flagged it', pc_invalidate('bad-1', true));
same('pc_invalidate flags rather than deletes', 1, pc_invalidated_count());

/* (g) two earlier days, written straight in. pc_cast() can only ever write today, and the
       whole point of the dashboard is the history, so the prior days are inserted with the
       same columns real rows carry. Timestamps are mid-afternoon Eastern so the hourly
       buckets have something to show. */
$tz = new DateTimeZone('America/New_York');
$back = static function (int $daysAgo, int $hourEt) use ($tz): array {
    $d = (new DateTime('now', $tz))->modify('-' . $daysAgo . ' day');
    $d->setTime($hourEt, 17, 0);
    return [$d->format('Y-m-d'), (clone $d)->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z')];
};
$ins = $db->prepare('INSERT INTO pc_votes
    (competition, voter_key, vote_day, slot, entrant_id, created_at, valid, simulated, ip_hash)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)');
$history = [
    [2, 14, 'hist-a', 'entrant-13', 1, 0], [2, 14, 'hist-b', 'entrant-13', 1, 0],
    [2, 15, 'hist-c', 'entrant-05', 1, 0], [2, 21, 'hist-d', 'entrant-03', 1, 1],
    [1,  9, 'hist-e', 'entrant-13', 1, 0], [1, 13, 'hist-f', 'entrant-15', 1, 0],
    [1, 13, 'hist-f', 'entrant-15', 2, 0], [1, 13, 'hist-f', 'entrant-15', 3, 0],
    [1, 20, 'hist-g', 'entrant-08', 1, 1],
];
foreach ($history as [$ago, $hr, $voter, $who, $slot, $sim]) {
    [$day, $iso] = $back($ago, $hr);
    $ins->execute(['peoples-choice-2026', $voter, $day, $slot, $who, $iso, $sim, 'testip']);
}
echo "\n  " . count($history) . " historical rows inserted across two earlier days\n\n";

/* ---------------------------------------------------------------------------
   3. Ask both libraries the same questions.
   ------------------------------------------------------------------------ */

echo "=== the authority, via pc-lib ===\n";
$tally      = pc_tally();
$standings  = pc_standings(pc_entrants());
$pcDaily    = pc_daily(400);
$pcInvalid  = pc_invalidated_count();
$pcTotal    = array_sum($tally);
echo "  pc_tally total points      $pcTotal\n";
echo "  pc_invalidated_count       $pcInvalid\n";
echo "  pc_daily days              " . count($pcDaily) . "\n";

echo "\n=== the dashboard, via ngd-lib ===\n";
$snap = ngd_build('review');
ok('the snapshot built', ($snap['meta']['ok'] ?? false) === true, json_encode($snap['meta']['error'] ?? null));
ok('it reports itself read-only', ($snap['meta']['read_only'] ?? false) === true);
echo "  rows read                  " . ($snap['meta']['rows_read'] ?? 0) . "\n";
echo "  open method                " . (ngd_ro_method() ?? 'none') . "\n";
echo "  totals.points              " . ($snap['totals']['points'] ?? 'n/a') . "\n";
echo "  build                      " . ($snap['meta']['build_ms'] ?? '?') . " ms\n\n";

echo "=== do they agree? ===\n";
same('total valid points', $pcTotal, $snap['totals']['points']);
same('invalidated points', $pcInvalid, $snap['totals']['invalid']);

$ngdPoints = [];
foreach ($snap['founders'] as $f) {
    if ($f['points'] > 0) {
        $ngdPoints[$f['id']] = $f['points'];
    }
}
ksort($tally);
ksort($ngdPoints);
same('points for every founder', $tally, $ngdPoints);

/* ranks, founder by founder, against pc_standings */
$rankMismatch = [];
$pcRank = [];
foreach ($standings as $r) {
    $pcRank[$r['id']] = $r['rank'];
}
foreach ($snap['founders'] as $f) {
    if (($pcRank[$f['id']] ?? null) !== $f['rank']) {
        $rankMismatch[] = $f['id'] . ': pc=' . ($pcRank[$f['id']] ?? 'null') . ' ngd=' . ($f['rank'] ?? 'null');
    }
}
ok('every rank matches pc_standings, ties included', $rankMismatch === [], implode('; ', $rankMismatch));

/* the daily series, field by field. pc_daily returns newest first; ngd returns oldest first
   and fills any gap day, so compare by day key rather than by position. */
$pcByDay = [];
foreach ($pcDaily as $d) {
    $pcByDay[$d['day']] = $d;
}
$dayMismatch = [];
$ngdNonEmpty = 0;
foreach ($snap['daily'] as $d) {
    if ($d['points'] === 0 && !isset($pcByDay[$d['day']])) {
        continue;                               // a filled gap day; pc_daily has no row for it
    }
    $ngdNonEmpty++;
    $p = $pcByDay[$d['day']] ?? null;
    if ($p === null) {
        $dayMismatch[] = $d['day'] . ': ngd has it, pc_daily does not';
        continue;
    }
    foreach ([['points', 'points'], ['voters', 'voters'], ['bonus', 'bonus'], ['simulated', 'unverified']] as [$a, $b]) {
        if ((int) $p[$a] !== (int) $d[$b]) {
            $dayMismatch[] = $d['day'] . '.' . $a . ': pc=' . $p[$a] . ' ngd=' . $d[$b];
        }
    }
    if (($p['top']['id'] ?? null) !== ($d['top']['id'] ?? null)) {
        $dayMismatch[] = $d['day'] . '.top: pc=' . ($p['top']['id'] ?? 'null') . ' ngd=' . ($d['top']['id'] ?? 'null');
    }
}
ok('every day agrees on points, voters, bonus, unverified and the day\'s leader',
   $dayMismatch === [], implode('; ', $dayMismatch));
same('the same number of days with activity', count($pcDaily), $ngdNonEmpty);

/* the breakdowns pc-lib does not expose, checked against the database directly */
$q = static function (PDO $db, string $sql): int {
    return (int) $db->query($sql)->fetch()['n'];
};
$W = "WHERE competition = 'peoples-choice-2026' AND valid = 1";
same('standard points are the slot-1 rows',
     $q($db, "SELECT COUNT(*) n FROM pc_votes $W AND slot = 1"), $snap['totals']['standard']);
same('bonus points are the slot>1 rows',
     $q($db, "SELECT COUNT(*) n FROM pc_votes $W AND slot > 1"), $snap['totals']['bonus']);
same('verified points are simulated = 0',
     $q($db, "SELECT COUNT(*) n FROM pc_votes $W AND simulated = 0"), $snap['totals']['verified']);
same('unverified points are simulated = 1',
     $q($db, "SELECT COUNT(*) n FROM pc_votes $W AND simulated = 1"), $snap['totals']['unverified']);
same('test points are the seed: rows',
     $q($db, "SELECT COUNT(*) n FROM pc_votes $W AND voter_key LIKE 'seed:%'"), $snap['totals']['test']);
same('unique voters are the distinct voter keys',
     $q($db, "SELECT COUNT(DISTINCT voter_key) n FROM pc_votes $W"), $snap['totals']['voters']);
same('standard plus bonus is the whole total',
     $snap['totals']['points'], $snap['totals']['standard'] + $snap['totals']['bonus']);
same('verified plus unverified is the whole total',
     $snap['totals']['points'], $snap['totals']['verified'] + $snap['totals']['unverified']);

/* the four seed rows must be inside the official total, not subtracted from it */
same('four seeded rows were written', 4, $snap['totals']['test']);
ok('and they are counted in the headline, as pc_tally counts them',
   $snap['totals']['points'] === $pcTotal);
ok('the dashboard warns that they are in there',
   (bool) array_filter($snap['integrity'], static fn($i) => str_contains($i['what'], 'test votes')));

/* the shape of the rest */
same('all twenty founders appear', 20, count($snap['founders']));
same('twenty-four hourly buckets', 24, count($snap['hourly']));
same('the hourly buckets add up to the points that carried a timestamp',
     array_sum(array_column($snap['hourly'], 'points')), $snap['totals']['points']);
ok('the heatmap has a row per day', count($snap['heatmap']) === count($snap['daily']));
ok('the cumulative curve ends at the total',
   ($snap['cumulative'] ? end($snap['cumulative'])['cumulative'] : 0) === $snap['totals']['points'],
   'curve ends at ' . ($snap['cumulative'] ? end($snap['cumulative'])['cumulative'] : 0));
ok('day-end standings were reconstructed for every day',
   count($snap['rank_history']) === count($snap['daily']));

$lastHist = $snap['rank_history'] ? end($snap['rank_history']) : null;
ok('the last reconstructed day matches the live ranking',
   $lastHist !== null && $lastHist['rank'] == $pcRank,
   $lastHist === null ? 'no history' : 'reconstructed leader '
     . array_search(1, $lastHist['rank'], true) . ' vs live ' . array_search(1, $pcRank, true));

/* the rules, read back out of pc_meta */
same('the dashboard reports the mode in force', 'daily', $snap['rules']['mode']);
same('and the public allowance', 1, $snap['rules']['daily_public']);
same('and the attendee allowance', 3, $snap['rules']['daily_ticket']);
same('and that the flexible rule is absent, as on production', null, $snap['rules']['spread_votes']);

/* ---------------------------------------------------------------------------
   4. The read-only guarantee, proved rather than asserted.
   ------------------------------------------------------------------------ */

echo "\n=== the handle really cannot write ===\n";
$path = ngd_db_path('review');
ok('the review database was located', $path !== null && is_file($path));
$ro = ngd_ro((string) $path);
ok('and opened read-only', $ro instanceof PDO);

$before = $q($db, "SELECT COUNT(*) n FROM pc_votes");
foreach ([
    'INSERT'      => "INSERT INTO pc_votes (competition, voter_key, vote_day, slot, entrant_id, created_at) VALUES ('peoples-choice-2026','hack','x',9,'entrant-01','now')",
    'UPDATE'      => "UPDATE pc_votes SET entrant_id = 'entrant-02'",
    'DELETE'      => "DELETE FROM pc_votes",
    'CREATE'      => "CREATE TABLE ngd_should_not_exist (x INTEGER)",
    'DROP'        => "DROP TABLE pc_meta",
    'PRAGMA off'  => "PRAGMA query_only = 0",
] as $label => $sql) {
    $threw = false;
    try {
        $ro->exec($sql);
    } catch (Throwable $e) {
        $threw = true;
    }
    if ($label === 'PRAGMA off') {
        /* SQLite accepts the pragma silently on some builds; what matters is that a write
           still fails afterwards, which is what the next assertion checks. */
        $still = false;
        try {
            $ro->exec("INSERT INTO pc_votes (competition, voter_key, vote_day, slot, entrant_id, created_at) VALUES ('x','y','z',9,'w','v')");
        } catch (Throwable $e) {
            $still = true;
        }
        ok('turning query_only off does not buy a write', $still);
        continue;
    }
    ok($label . ' is refused', $threw);
}
same('not one row changed', $before, $q($db, "SELECT COUNT(*) n FROM pc_votes"));
ok('and no stray table was created',
   $db->query("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'ngd_%'")->fetch()['n'] === 0);

/* ---------------------------------------------------------------------------
   5. The analytics store is a different file, and the live source is reachable.
   ------------------------------------------------------------------------ */

echo "\n=== the analytics store stands apart ===\n";
$ev = ngd_events_db();
ok('the event store opened', $ev instanceof PDO);
ok('it is a separate file in a separate folder',
   is_file(ngd_var_dir() . '/ngd-events.sqlite')
   && !str_contains(ngd_var_dir(), 'nextgen-data'),
   ngd_var_dir());
ok('the voting database has no event table',
   $db->query("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'ngd_event'")->fetch()['n'] === 0);
$report = ngd_event_report();
ok('and it reports honestly that nothing has been collected yet',
   $report['ok'] === true && $report['collecting'] === false
   && str_contains($report['note'], 'No website events'));

echo "\n=== the live source resolves separately from the review one ===\n";
copy((string) $path, $sand . '/nextgen-data/nextgen-testkey.sqlite');
$live = ngd_build('live');
ok('the live source was found and read', ($live['meta']['ok'] ?? false) === true,
   json_encode($live['meta']['error'] ?? null));
same('the live path is the sibling folder, not the review one',
     str_replace('\\', '/', $sand) . '/nextgen-data/nextgen-testkey.sqlite',
     str_replace('\\', '/', (string) ngd_db_path('live')));
same('and it is the default source the dashboard reports on', 'live', ngd_default_source());

@unlink($sand . '/nextgen-data/nextgen-testkey.sqlite');
$gone = ngd_build('live');
ok('once the file is gone the build reports an error, not a total of nought',
   ($gone['meta']['ok'] ?? true) === false && str_contains((string) $gone['meta']['error'], 'no voting database'),
   json_encode($gone['meta']['error'] ?? null));

/* ---------------------------------------------------------------------------
   7. The snapshot copy — the guard that keeps a report from costing a vote.
   ------------------------------------------------------------------------ */

echo "\n=== the live file is copied, not scanned ===\n";
$live = (string) ngd_db_path('review');
$snapFile = ngd_snapshot_path($live);
@unlink($snapFile);

$took = ngd_take_snapshot($live);
ok('a snapshot was taken', str_contains($took['how'], 'VACUUM INTO'), $took['how']);
ok('it is a real file, beside the analytics store, not beside the votes',
   is_file($took['path']) && $took['path'] !== $live && str_contains($took['path'], 'nextgen-analytics'),
   $took['path']);
ok('the live file was held for well under a second', $took['ms'] < 1000, $took['ms'] . 'ms');

$liveRows = (int) $db->query('SELECT COUNT(*) n FROM pc_votes')->fetch()['n'];
$copy = new PDO('sqlite:' . $took['path'], null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
same('the copy holds every row the original does', $liveRows,
     (int) $copy->query('SELECT COUNT(*) n FROM pc_votes')->fetch()['n']);
$copy = null;

$before = filemtime($live) . ':' . filesize($live);
ngd_take_snapshot($live);
same('taking it again does not touch the original', $before, filemtime($live) . ':' . filesize($live));

$fresh = ngd_build('review');
ok('and the build reports which route it took',
   str_contains((string) ($fresh['meta']['snapshot'] ?? ''), 'VACUUM INTO'),
   (string) ($fresh['meta']['snapshot'] ?? 'missing'));
same('the snapshot build agrees with the direct one', $pcTotal, $fresh['totals']['points']);

/* The asymmetry is deliberate and worth pinning down: the snapshot handle must NOT carry
   query_only, because query_only blocks VACUUM INTO; every other handle must. */
$forCopy = ngd_ro($live, true);
ok('the copying handle leaves query_only off', $forCopy instanceof PDO
   && (int) $forCopy->query('PRAGMA query_only')->fetch(PDO::FETCH_NUM)[0] === 0);
$wrote = false;
try { $forCopy->exec('CREATE TABLE ngd_nope (x INT)'); $wrote = true; } catch (Throwable $e) {}
ok('but it still cannot write, because the file itself is open read-only', !$wrote);
$forCopy = null;

$forRead = ngd_ro($live, false);
ok('the counting handle does carry query_only', $forRead instanceof PDO
   && (int) $forRead->query('PRAGMA query_only')->fetch(PDO::FETCH_NUM)[0] === 1);
$forRead = null;

/* ---------------------------------------------------------------------------
   8. The table allow-list.
   ------------------------------------------------------------------------ */

echo "\n=== only three tables are readable ===\n";
same('the allow-list is exactly the three reporting tables',
     ['pc_votes', 'pc_meta', 'pc_visits'], NGD_READABLE);
foreach (['submissions', 'pc_email_otp', 'pc_vote_email_otp', 'pc_voter', 'pc_identity',
          'pc_otp_log', 'pc_attendee', 'pc_flag'] as $forbidden) {
    ok('refuses to look at ' . $forbidden, ngd_may_read($forbidden) === false);
}
/* and prove the refusal is real, not just a boolean: create the table and check the
   reader still will not see it */
/* ngs_db() already created this table with the real site's schema (_lib.php:85), which is
   the point: the personal data and the ballot share one file. Put a plausible row in it. */
$db->exec("INSERT OR REPLACE INTO submissions (id, kind, created_at, data, ip_hash, user_agent)
           VALUES ('x', 'registration', '2026-10-24T10:00:00Z',
                   '{\"email\":\"a.person@example.com\",\"phone\":\"+15555550123\"}', 'h', 'ua')");
$ro2 = ngd_ro((string) ngd_db_path('review'));
ok('the personal-data table exists in the file', (bool) $db->query(
   "SELECT 1 FROM sqlite_master WHERE name = 'submissions'")->fetch());
ok('and ngd_has_table still answers no for it', ngd_has_table($ro2, 'submissions') === false);
$ro2 = null;

$again = ngd_build('review');
$blob = json_encode($again);
ok('no email address reaches the snapshot payload', !str_contains((string) $blob, '@example.com'));
ok('no voter key reaches the snapshot payload', !str_contains((string) $blob, 'pub-0'));
ok('no ip hash reaches the snapshot payload', !str_contains((string) $blob, 'testip'));

/* ---------------------------------------------------------------------------
   9. Two totals, both correct.
   ------------------------------------------------------------------------ */

echo "\n=== the admin total and the public total are both reported ===\n";
$W2 = "WHERE competition = 'peoples-choice-2026' AND valid = 1";
$publicCount = $q($db, "SELECT COUNT(*) n FROM pc_votes $W2 AND simulated = 0");
same('the public standings figure is the simulated = 0 count',
     $publicCount, $again['totals']['points_public']);
ok('which is smaller than the admin figure whenever anything was unverified',
   $again['totals']['points_public'] < $again['totals']['points'],
   $again['totals']['points_public'] . ' vs ' . $again['totals']['points']);
ok('and the difference is explained on the page, not buried',
   (bool) array_filter($again['integrity'],
     static fn($i) => str_contains($i['what'], 'Two different totals')));

/* ---------------------------------------------------------------------------
   10. The collector.
   ------------------------------------------------------------------------ */

echo "\n=== the event collector ===\n";
/* The invariant that matters is not a number, it is a difference: whatever the collector
   does, the ballot must hold exactly the rows it held before. */
$ballotBefore = (int) $db->query('SELECT COUNT(*) n FROM pc_votes')->fetch()['n'];
ok('collection defaults ON for a review build', ngd_flag('collect'));

same('a good event is accepted', true,
     ngd_event_record(['kind' => 'page_view', 'page' => '/pitch/peoples-choice/'])['ok']);
same('an unknown kind is refused', 'kind',
     ngd_event_record(['kind' => 'steal_everything'])['reason']);
same('a missing kind is refused', 'kind', ngd_event_record([])['reason']);

ngd_event_record(['kind' => 'founder_open', 'entrant' => 'entrant-13', 'page' => '/x']);
ngd_event_record(['kind' => 'vote_start',  'entrant' => 'entrant-13']);
ngd_event_record(['kind' => 'ticket_cta',  'source' => 'instagram']);
ngd_event_record(['kind' => 'checkout_open']);

/* the cleaning rules, checked against what actually landed */
ngd_event_record([
    'kind'    => 'page_view',
    'page'    => 'https://nextgensummit.us/tickets/?email=someone@example.com&utm=x#frag',
    'entrant' => 'entrant-99; DROP TABLE pc_votes',
    'source'  => 'in<script>stagram',
    'session' => 'not-hex-at-all',
    'meta'    => ['reason' => 'ok', 'secret' => 'should not survive'],
]);

$ev = ngd_events_db();
$row = $ev->query("SELECT page, entrant_id, source, session, meta FROM ngd_event
                   WHERE page LIKE '/tickets%' ORDER BY id DESC LIMIT 1")->fetch();
ok('a full URL is stored as a bare path', ($row['page'] ?? '') === '/tickets/', (string) ($row['page'] ?? ''));
ok('no query string survives', !str_contains((string) ($row['page'] ?? ''), '?')
   && !str_contains((string) ($row['page'] ?? ''), '@'));
ok('a contestant id that is not entrant-NN is dropped', $row['entrant_id'] === null);
ok('a source is stripped to safe characters', ($row['source'] ?? '') === 'inscriptstagram',
   (string) ($row['source'] ?? ''));
ok('a session id that is not hex is dropped', $row['session'] === null);
ok('only allow-listed meta keys survive',
   str_contains((string) $row['meta'], 'reason') && !str_contains((string) $row['meta'], 'secret'),
   (string) $row['meta']);

$anyIp = $ev->query("SELECT COUNT(*) n FROM ngd_event WHERE visitor LIKE '%.%'")->fetch();
ok('no address is stored as a visitor token', (int) $anyIp['n'] === 0);

$report2 = ngd_event_report();
ok('the report now sees the events', $report2['collecting'] === true
   && ($report2['kinds']['page_view']['events'] ?? 0) >= 2, json_encode($report2['kinds'] ?? []));

/* the flag really is a switch */
ngd_flag_set('collect', false);
same('with collection off, nothing is recorded', 'off',
     ngd_event_record(['kind' => 'page_view', 'page' => '/off'])['reason']);
$n0 = (int) $ev->query("SELECT COUNT(*) n FROM ngd_event WHERE page = '/off'")->fetch()['n'];
same('and no row appeared', 0, $n0);
ngd_flag_set('collect', true);

/* and the thing it must never be able to do */
ok('the event store is a different file from the ballot',
   ngd_var_dir() . '/ngd-events.sqlite' !== (string) ngd_db_path('review'));
same('the ballot gained no rows from any of this', $ballotBefore,
     (int) $db->query("SELECT COUNT(*) n FROM pc_votes")->fetch()['n']);
ok('and no analytics table appeared in the ballot',
   (int) $db->query("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'ngd_%'")->fetch()['n'] === 0);

/* ---------------------------------------------------------------------------
   12. WHO GETS IN

   The dashboard reads a live competition, so the lock on it matters as much as the
   numbers behind it. These cases run against the real ngd-auth.php: the credential
   check, the throttle that makes guessing expensive, and the rule that a credential
   provisioned with the deploy cannot be silently duplicated into the writable store.
   ------------------------------------------------------------------------ */

echo "\n=== the credential check ===\n";
require_once $api . '/ngd-auth.php';

/* The sandbox config sets NGS_ADMIN_SALT/HASH to obviously fake values, so build a
   credential that matches them the way admin/index.php:53 does. */
$pin = 'a-test-pin-that-is-not-real';
$fakeHash = hash_hmac('sha256', $pin, NGS_ADMIN_SALT);
ok('the sandbox PIN hash is the wrong one on purpose', $fakeHash !== NGS_ADMIN_HASH);

same('an empty password never passes', false, ngd_auth_check('', '')['ok']);
same('nor an empty password with a username', false, ngd_auth_check('someone', '')['ok']);
same('an unknown username is refused', false, ngd_auth_check('nobody', 'whatever-long-string')['ok']);
same('a wrong owner PIN is refused', false, ngd_auth_check('', 'definitely-not-the-pin')['ok']);
same('and so is a wrong PIN under the name "owner"', false, ngd_auth_check('owner', 'nope')['ok']);

echo "\n=== no default, and no way in without a credential ===\n";
ok('with no accounts provisioned, nothing but the PIN can open it', ngd_users() === []);
ok('and the PIN route only exists because config defines a hash', ngd_owner_pin_available());

echo "\n=== accounts provisioned with the deploy ===\n";
/* Write a config.ngd.php into the sandbox the way tools/make-ngd-user.php does. */
$pass1 = 'river-cobalt-lantern-summit-ivory-41';
$h1 = password_hash($pass1, PASSWORD_DEFAULT);
file_put_contents($api . '/config.ngd.php',
    "<?php\ndeclare(strict_types=1);\n\nNGD_ACCOUNT = 'chair|Board Chair|" . $h1 . "';\n"
  . "NGD_ACCOUNT = 'broken|Bad Line|not-a-hash';\n");
ngd_seed_accounts(true);
$users = ngd_users(true);
ok('the good account is picked up', isset($users['chair']), implode(',', array_keys($users)));
ok('a line whose hash is not a hash is ignored, not trusted', !isset($users['broken']));
same('it is marked as coming from the deploy', true, $users['chair']['seeded']);

$r = ngd_auth_check('chair', $pass1);
same('the right passphrase signs in', true, $r['ok']);
same('with its display name', 'Board Chair', $r['name']);
same('and the leadership role, not owner', 'leadership', $r['role']);
same('a wrong passphrase does not', false, ngd_auth_check('chair', $pass1 . 'x')['ok']);
same('and the username is case-insensitive', true, ngd_auth_check('CHAIR', $pass1)['ok']);

echo "\n=== suspending, and what cannot be undone by a deploy ===\n";
ok('a seeded account can be suspended', ngd_user_set_active('chair', false));
ngd_users(true);
same('and then it cannot sign in', false, ngd_auth_check('chair', $pass1)['ok']);
$json = json_decode((string) file_get_contents(ngd_users_file()), true);
ok('the writable store holds no copy of its hash',
   !str_contains((string) json_encode($json), substr($h1, 0, 20)), 'a hash was copied out');
ok('a seeded account cannot be deleted, only suspended', ngd_user_remove('chair') === false);
ok('restoring it works', ngd_user_set_active('chair', true));
ngd_users(true);
same('and it signs in again', true, ngd_auth_check('chair', $pass1)['ok']);

echo "\n=== an ordinary account, added from the dashboard ===\n";
$pass2 = 'meadow-quartz-pennant-thistle-zenith-07';
$add = ngd_user_save('director', $pass2, 'Programme Director');
same('it is created', true, $add['ok']);
same('and signs in', true, ngd_auth_check('director', $pass2)['ok']);
same('a short password is refused outright', false, ngd_user_save('shorty', 'tooshort', 'X')['ok']);
same('and so is a malformed username', false, ngd_user_save('no spaces!', $pass2, 'X')['ok']);
ok('this one CAN be removed, because no deploy would bring it back',
   ngd_user_remove('director') === true);
same('and then it cannot sign in', false, ngd_auth_check('director', $pass2)['ok']);

echo "\n=== the throttle ===\n";
/* The counter lives in the analytics store, never in the voting database. */
$ballotBefore2 = (int) $db->query('SELECT COUNT(*) n FROM pc_votes')->fetch()['n'];
$t0 = ngd_try_check();
same('a fresh connection is allowed', true, $t0['ok']);
for ($i = 0; $i < NGD_TRY_MAX; $i++) {
    ngd_try_note(false);
}
$t1 = ngd_try_check();
same('after ' . NGD_TRY_MAX . ' failures it is locked out', false, $t1['ok']);
ok('and is told roughly how long to wait', $t1['retry_after'] > 0 && $t1['retry_after'] <= NGD_TRY_WINDOW,
   (string) $t1['retry_after']);
ngd_try_note(true);
same('a successful sign-in clears the record', true, ngd_try_check()['ok']);
same('and none of that touched the ballot', $ballotBefore2,
     (int) $db->query('SELECT COUNT(*) n FROM pc_votes')->fetch()['n']);
$ev2 = ngd_events_db();
ok('the failures were counted in the analytics store instead',
   (int) $ev2->query('SELECT COUNT(*) n FROM sqlite_master WHERE name = ' . "'ngd_throttle'")->fetch()['n'] === 1);

echo "\n=== the session is scoped to the dashboard and nowhere else ===\n";
same('its cookie path is /insights/', '/insights/', NGD_SESSION_PATH);
same('its cookie name is its own', 'ngd_sess', NGD_SESSION_NAME);
ok('it is not the registrations admin cookie', NGD_SESSION_NAME !== 'ngs_admin');
ok('nor the People\'s Choice admin cookie', NGD_SESSION_NAME !== 'ngs_pc_admin');
ok('a session expires within the day', NGD_SESSION_MAX <= 12 * 3600);
ok('and sooner if left alone', NGD_SESSION_IDLE < NGD_SESSION_MAX);

echo "\n=== turning the shared PIN off once named accounts exist ===\n";
ok('today the PIN is accepted because config defines one', ngd_owner_pin_available());
ok('NGD_DISABLE_OWNER_PIN is the switch that ends that',
   !defined('NGD_DISABLE_OWNER_PIN'),
   'already defined in this sandbox');

/* ---------------------------------------------------------------------------
   11. Done.
   ------------------------------------------------------------------------ */

rmtree($sand);
echo "\n" . str_repeat('-', 60) . "\n";
echo ($fail === 0 ? "ALL GOOD" : "FAILURES") . ": $pass passed, $fail failed\n";
exit($fail === 0 ? 0 : 1);
