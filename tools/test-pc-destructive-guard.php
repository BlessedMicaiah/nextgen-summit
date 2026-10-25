<?php
/* ============================================================================
   Can the dashboard still delete a live competition?

       php tools/test-pc-destructive-guard.php

   The People's Choice dashboard carries "Add test votes" and "Clear all votes" under a
   heading saying "Staging only". Nothing checked. pc_reset() ran DELETE FROM pc_votes
   against whatever pc_db() resolved to, which on production is the live ballot, and the
   confirmation message then said the votes had been cleared "from the staging store".

   This test runs the guard against two stores that differ in one thing: the name of the
   directory. One is nextgen-data-staging, where the controls are meant to work. The other
   is nextgen-data, which is what production is called. The second one must refuse, and
   must still hold every row afterwards.

   It runs each case in its OWN PROCESS, deliberately. ngs_data_dir() caches its answer
   for the life of a request, so a single process cannot honestly pretend to be two
   different deployments, and a test that faked it would be testing the fake.

   Nothing here touches a real database. Each case builds a throwaway sandbox under the
   system temp directory with an obviously fake config.
   ========================================================================= */

declare(strict_types=1);

$root = dirname(__DIR__);
$mode = $argv[1] ?? '';

/* ---------------------------------------------------------------------------
   The parent: run both cases, then report.
   ------------------------------------------------------------------------ */
if ($mode === '') {
    echo "People's Choice — the destructive-control guard\n\n";
    $fail = 0;
    foreach (['review' => ['nextgen-data-staging', 8], 'live' => ['nextgen-data', 11]] as $case => $spec) {
        [$dir, $minimum] = $spec;
        echo "=== the store is called $dir ===\n";
        $cmd = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' ' . escapeshellarg($case);
        $out = (string) shell_exec($cmd . ' 2>&1');
        echo $out;

        /* A child that dies early -- a parse error, a fatal, a missing sandbox -- prints
           neither "FAIL" nor "CASE FAILED", and the first version of this parent read that
           silence as success: it announced ALL GOOD having proved nothing, which is the
           worst thing a test about losing votes can do. Demonstrated by making the child
           exit(0) before its first assertion; the old parent still said ALL GOOD.

           So the child now reports how many assertions it ran, and the parent requires that
           number to have arrived and to be at least what this case covers. Absence of
           failure is not evidence. Presence of the expected work is. */
        if (!preg_match('/RAN (\d+) ASSERTIONS/', $out, $m)) {
            echo "  CASE FAILED: no assertion count came back -- the child died early.
";
            $fail++;
        } elseif ((int) $m[1] < $minimum) {
            echo '  CASE FAILED: only ' . $m[1] . " assertions ran, expected at least $minimum.
";
            $fail++;
        } elseif (strpos($out, 'CASE FAILED') !== false || strpos($out, 'FAIL ') !== false) {
            $fail++;
        }
        echo "\n";
    }
    echo str_repeat('-', 60) . "\n";
    echo ($fail === 0 ? "ALL GOOD" : "FAILURES") . ": $fail case(s) failed\n";
    exit($fail === 0 ? 0 : 1);
}

/* ---------------------------------------------------------------------------
   A child: one deployment, one data directory name.
   ------------------------------------------------------------------------ */

$dirName = $mode === 'review' ? 'nextgen-data-staging' : 'nextgen-data';
$sand = rtrim(sys_get_temp_dir(), '/\\') . '/ngd-guard-' . $mode . '-' . bin2hex(random_bytes(4));

$pass = 0;
$fail = 0;
function ok(string $label, bool $cond, string $detail = ''): void
{
    global $pass, $fail;
    if ($cond) { $pass++; echo "  PASS  $label\n"; }
    else { $fail++; echo "  FAIL  $label" . ($detail !== '' ? "\n        $detail" : '') . "\n"; }
}
function rmtree(string $d): void
{
    if (!is_dir($d)) { return; }
    foreach (scandir($d) ?: [] as $f) {
        if ($f === '.' || $f === '..') { continue; }
        $p = $d . '/' . $f;
        is_dir($p) ? rmtree($p) : @unlink($p);
    }
    @rmdir($d);
}

@mkdir($sand . '/public/api', 0777, true);
@mkdir($sand . '/public/assets/js', 0777, true);
@mkdir($sand . '/' . $dirName, 0777, true);

foreach (glob($root . '/public/api/*.php') ?: [] as $f) {
    /* No real private config of any kind reaches a sandbox: config.php holds the
       live secrets and config.ngd.php holds real account hashes. A test that
       copied either would be testing the developer's machine. */
    if (preg_match('/^config(\..+)?\.php$/', basename($f))) { continue; }
    copy($f, $sand . '/public/api/' . basename($f));
}
copy($root . '/public/assets/js/pc-founders.js', $sand . '/public/assets/js/pc-founders.js');
file_put_contents($sand . '/public/api/config.php', "<?php\ndeclare(strict_types=1);\n"
    . "const NGS_ADMIN_SALT = 'abababababababababababab';\nconst NGS_ADMIN_HASH = 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd';\n"
    . "const NGS_SECRET = 'test-secret-not-a-real-one';\nconst NGS_DATA_KEY = 'guard';\n"
    . "const NGS_EVENTBRITE_TOKEN = '';\n"
    . "define('NGS_DATA_DIR', '" . str_replace('\\', '/', $sand) . "/" . $dirName . "');\n");

require_once $sand . '/public/api/pc-rules.php';

/* a competition with something in it worth not losing */
pc_set_meta('mode', 'daily');
pc_set_meta('state', 'open');
pc_set_meta('deadline', '2030-01-01T23:59:59-05:00');
for ($i = 0; $i < 25; $i++) {
    pc_cast('voter-' . $i, 'entrant-' . str_pad((string) (($i % 20) + 1), 2, '0', STR_PAD_LEFT), false, false);
}
$db = pc_db();
$count = static fn(): int => (int) $db->query('SELECT COUNT(*) n FROM pc_votes')->fetch()['n'];
$before = $count();
ok('the fixture holds 25 votes', $before === 25, (string) $before);

$isReview = $mode === 'review';
same_store:
ok('pc_store_is_review() says ' . ($isReview ? 'yes' : 'no'), pc_store_is_review() === $isReview,
   'data dir is ' . basename(ngs_data_dir()));

/* ---- clearing ---- */
$cleared = pc_reset();
if ($isReview) {
    ok('pc_reset() is allowed on the review store', $cleared === true);
    ok('and it actually cleared the votes', $count() === 0, (string) $count());
    /* put them back for the seed check */
    for ($i = 0; $i < 25; $i++) {
        pc_cast('voter2-' . $i, 'entrant-01', false, false);
    }
} else {
    ok('pc_reset() REFUSES on a production-named store', $cleared === false);
    ok('and not one vote was deleted', $count() === $before,
       $count() . ' of ' . $before . ' remain');
}

/* ---- seeding ---- */
$seeded = pc_seed();
if ($isReview) {
    ok('pc_seed() is allowed on the review store', $seeded > 0, (string) $seeded);
} else {
    ok('pc_seed() REFUSES on a production-named store', $seeded === 0, (string) $seeded);
    ok('and wrote no rows', $count() === $before, $count() . ' of ' . $before);
    ok('so no seeded voter key exists', (int) $db->query(
       "SELECT COUNT(*) n FROM pc_votes WHERE voter_key LIKE 'seed:%'")->fetch()['n'] === 0);
}

/* ---- the state must not have been disturbed either ---- */
same_state:
ok('the competition state is untouched', pc_state() === 'open', pc_state());

/* ---- the note the dashboard prints ---- */
$note = pc_destructive_note();
if ($isReview) {
    ok('the dashboard note says these run against the review store',
       str_contains($note, 'review site'), $note);
} else {
    ok('the dashboard note says plainly that they are disabled here',
       str_contains($note, 'Disabled on this site'), $note);
    ok('and does not repeat the old claim about writing to staging',
       !str_contains($note, 'different file from the live one'), $note);
}

/* ---- fail closed: an unknown directory name is not a licence ---- */
ok('a store called something else entirely would also refuse',
   basename(ngs_data_dir()) === $dirName);

rmtree($sand);
echo '  -> RAN ' . ($pass + $fail) . " ASSERTIONS: $pass passed, $fail failed
";
if ($fail > 0) {
    echo "  CASE FAILED\n";
}
exit($fail === 0 ? 0 : 1);
