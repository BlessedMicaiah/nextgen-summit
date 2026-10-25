<?php
/* ============================================================================
   People, not points.

       php tools/test-ngd-voters.php

   Counting votes is arithmetic. Counting PEOPLE is a set problem, and the ways to get it
   wrong all produce a plausible-looking number:

     - counting rows instead of identities, so one keen voter looks like five people
     - adding up the twenty founder columns, which triple-counts anybody who split
       their votes and is the single easiest mistake to make on this dashboard
     - letting an unverified or a seeded row contribute a person
     - treating Ada@Example.COM and ada@example.com as two people

   The fixture below contains one of each of those traps on purpose, with hand-worked
   expected answers written next to them, so a wrong answer is obvious rather than
   merely different.

   Nothing real is touched: a throwaway sandbox under the system temp directory, built
   with the real voting code and an obviously fake config.
   ========================================================================= */

declare(strict_types=1);

$root = dirname(__DIR__);
$sand = rtrim(sys_get_temp_dir(), '/\\') . '/ngd-voters-' . bin2hex(random_bytes(4));

$pass = 0;
$fail = 0;
function ok(string $l, bool $c, string $d = ''): void
{
    global $pass, $fail;
    if ($c) { $pass++; echo "  PASS  $l\n"; }
    else { $fail++; echo "  FAIL  $l" . ($d !== '' ? "\n        $d" : '') . "\n"; }
}
function same(string $l, $e, $a): void
{
    ok($l, $e === $a, $e === $a ? '' : 'expected ' . json_encode($e) . ', got ' . json_encode($a));
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
@mkdir($sand . '/nextgen-data-staging', 0777, true);
foreach (glob($root . '/public/api/*.php') ?: [] as $f) {
    if (preg_match('/^config(\..+)?\.php$/', basename($f))) { continue; }
    copy($f, $sand . '/public/api/' . basename($f));
}
copy($root . '/public/assets/js/pc-founders.js', $sand . '/public/assets/js/pc-founders.js');
file_put_contents($sand . '/public/api/config.php', "<?php\ndeclare(strict_types=1);\n"
    . "const NGS_ADMIN_SALT = '" . str_repeat('ab', 12) . "';\n"
    . "const NGS_ADMIN_HASH = '" . str_repeat('cd', 32) . "';\n"
    . "const NGS_SECRET = 'test-secret-not-a-real-one';\nconst NGS_DATA_KEY = 'voters';\n"
    . "const NGS_EVENTBRITE_TOKEN = '';\n"
    . "define('NGS_DATA_DIR', '" . str_replace('\\', '/', $sand) . "/nextgen-data-staging');\n");

require_once $sand . '/public/api/pc-rules.php';
require_once $sand . '/public/api/ngd-lib.php';

pc_set_meta('mode', 'daily');
pc_set_meta('state', 'open');
pc_set_meta('deadline', '2030-01-01T23:59:59-05:00');

$db = pc_db();
pc_voter_table();
$tz = new DateTimeZone('America/New_York');
$today = (new DateTime('now', $tz))->format('Y-m-d');
$yday  = (new DateTime('now', $tz))->modify('-1 day')->format('Y-m-d');
$day0  = (new DateTime('now', $tz))->modify('-2 day')->format('Y-m-d');

$ins = $db->prepare('INSERT INTO pc_votes
    (competition, voter_key, vote_day, slot, entrant_id, created_at, valid, simulated, ip_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
$vote = static function (string $key, string $entrant, string $day, int $slot = 1,
                         int $valid = 1, int $sim = 0) use ($ins, $tz): void {
    $when = (new DateTime($day . ' 14:00:00', $tz))->setTimezone(new DateTimeZone('UTC'));
    $ins->execute(['peoples-choice-2026', $key, $day, $slot, $entrant,
                   $when->format('Y-m-d\TH:i:s\Z'), $valid, $sim, 'x']);
};
$knows = static function (string $ident, string $email): void {
    pc_voter_note($ident, ['email' => $email, 'channel' => 'email']);
};

/* ---------------------------------------------------------------------------
   The fixture, with the answer worked out by hand beside each trap.
   ------------------------------------------------------------------------ */

// 1. ONE KEEN VOTER, FIVE ROWS, ONE FOUNDER.  -> 1 person, 1 for entrant-01
$knows('k-ada', 'Ada@Example.COM');                       // note the capitals
$vote('k-ada', 'entrant-01', $day0);
$vote('k-ada', 'entrant-01', $yday);
$vote('k-ada', 'entrant-01', $today, 1);
$vote('k-ada', 'entrant-01', $today, 2);
$vote('k-ada', 'entrant-01', $today, 3);

// 2. ONE PERSON, THREE FOUNDERS.  -> 1 person overall, but 1 in each of three columns
$knows('k-bo', 'bo@example.com');
/* Two founders on the same day means two slots: the unique index is
   (competition, voter_key, vote_day, slot), which is exactly how an attendee with an
   allowance of three spends it across different founders. */
$vote('k-bo', 'entrant-01', $yday, 1);
$vote('k-bo', 'entrant-02', $yday, 2);
$vote('k-bo', 'entrant-03', $today, 1);

// 3. TWO IDENTITIES, ONE PERSON, merged by the system's own pc_identity record
$knows('k-cy-phone', 'cy@example.com');
$knows('k-cy-email', 'cy@example.com');                    // same address, two idents
$vote('k-cy-phone', 'entrant-02', $day0);
$vote('k-cy-email', 'entrant-02', $today);

// 4. A SEEDED TEST ROW. -> contributes no person
$vote('seed:9:9:abcd', 'entrant-04', $today);

// 5. AN UNVERIFIED ROW (simulated = 1). -> contributes no person
$knows('k-sim', 'sim@example.com');
$vote('k-sim', 'entrant-05', $today, 1, 1, 1);

// 6. AN INVALIDATED ROW. -> contributes no person
$knows('k-void', 'void@example.com');
$vote('k-void', 'entrant-06', $today, 1, 0, 0);

// 7. A VERIFIED VOTER WITH NO EMAIL ON RECORD. -> counted separately, never in the email total
$vote('k-phoneonly', 'entrant-07', $today);

// 8. A BRAND NEW PERSON TODAY. -> new_today = this one (plus anyone else first-voting today)
$knows('k-dee', 'dee@example.com');
$vote('k-dee', 'entrant-08', $today);

/* the identity merge for case 3 */
$db->exec('CREATE TABLE IF NOT EXISTS pc_identity (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ident TEXT NOT NULL UNIQUE,
    canonical TEXT NOT NULL, created_at TEXT NOT NULL)');
$db->prepare('INSERT OR REPLACE INTO pc_identity (ident, canonical, created_at) VALUES (?,?,?)')
   ->execute(['k-cy-email', 'k-cy-phone', ngs_now()]);

echo "fixture built in $sand\n\n";

/* ---------------------------------------------------------------------------
   The answers.
   ------------------------------------------------------------------------ */

$v = ngd_voters('review', true);
ok('the voter report built', $v['ok'] === true, (string) ($v['error'] ?? ''));

$t = $v['totals'];
echo "  unique voters        " . $t['unique_voters'] . "\n";
echo "  unique today         " . $t['unique_today'] . "\n";
echo "  new today            " . $t['new_today'] . "\n";
echo "  sum of 20 columns    " . $t['sum_of_founder_columns'] . "\n";
echo "  no email on record   " . $v['no_email']['identities'] . " identities, "
   . $v['no_email']['points'] . " points\n\n";

echo "=== one person is one person, however many times they vote ===\n";
/* ada, bo, cy, dee = 4 distinct addresses. sim/void/seed contribute none.
   k-phoneonly has no address. */
same('five rows from one address is one unique voter', 4, $t['unique_voters']);
same('and that address appears once in the people set', 1,
     count(array_filter(array_keys($v['people']), static fn($e) => $e === 'ada@example.com')));
same('ada is stored lowercased, despite being entered with capitals', 5,
     $v['people']['ada@example.com']['points']);
ok('Ada@Example.COM did not become a second person', !isset($v['people']['Ada@Example.COM']));

echo "\n=== supporting several founders is still one person overall ===\n";
same('bo supported three founders', 3, count($v['people']['bo@example.com']['founders']));
same('and is still one row in the people set', 1,
     count(array_filter(array_keys($v['people']), static fn($e) => $e === 'bo@example.com')));
$byId = [];
foreach ($v['founders'] as $f) { $byId[$f['id']] = $f; }
ok('bo counts once for entrant-01', $byId['entrant-01']['unique_voters'] === 2,
   'entrant-01 unique = ' . $byId['entrant-01']['unique_voters'] . ' (ada + bo expected)');
ok('and once for entrant-02', $byId['entrant-02']['unique_voters'] === 2,
   'entrant-02 unique = ' . $byId['entrant-02']['unique_voters'] . ' (bo + cy expected)');
ok('and once for entrant-03', $byId['entrant-03']['unique_voters'] === 1);

echo "\n=== the columns must NOT be added up ===\n";
ok('the sum of the founder columns exceeds the competition total',
   $t['sum_of_founder_columns'] > $t['unique_voters'],
   $t['sum_of_founder_columns'] . ' vs ' . $t['unique_voters']);
same('because somebody supported more than one founder', 1, $t['multi_founder_people']);
echo "       (sum " . $t['sum_of_founder_columns'] . " vs real " . $t['unique_voters']
   . " -- adding the columns would overstate by "
   . ($t['sum_of_founder_columns'] - $t['unique_voters']) . ")\n";

echo "\n=== two identities proved to be one person count once ===\n";
same('cy voted twice under two idents and is one person', 2,
     $v['people']['cy@example.com']['points']);
same('and counts once for the founder they both backed', 2, $byId['entrant-02']['unique_voters']);

echo "\n=== what must not become a person ===\n";
ok('a seeded test row contributes nobody', ($byId['entrant-04']['unique_voters'] ?? 0) === 0);
same('and the seeded rows are counted as skipped', 1, $t['seed_rows_skipped']);
ok('an unverified row contributes nobody', ($byId['entrant-05']['unique_voters'] ?? 0) === 0);
ok('an invalidated row contributes nobody', ($byId['entrant-06']['unique_voters'] ?? 0) === 0);
ok('none of those addresses reached the people set',
   !isset($v['people']['sim@example.com']) && !isset($v['people']['void@example.com']));

echo "\n=== a verified voter with no address is reported, not hidden ===\n";
same('one identity has no email on record', 1, $v['no_email']['identities']);
same('and its point is counted as such', 1, $v['no_email']['points']);
ok('entrant-07 therefore shows no unique voters even though it has a point',
   ($byId['entrant-07']['unique_voters'] ?? 0) === 0 && ($byId['entrant-07']['points'] ?? 0) === 0);

echo "\n=== daily, new, and cumulative ===\n";
$d = $v['daily'];
ok('three days of activity', count($d) === 3, (string) count($d));
same('the first day saw two new people', 2, $d[0]['new']);        // ada, cy
same('cumulative after day one is two', 2, $d[0]['cumulative']);
same('the last day is today', true, $d[2]['is_today']);
same('cumulative reaches the all-time total', $t['unique_voters'], $d[2]['cumulative']);
ok('every day cumulative never decreases',
   $d[0]['cumulative'] <= $d[1]['cumulative'] && $d[1]['cumulative'] <= $d[2]['cumulative']);
same('new today is the people whose FIRST vote was today', 1, $t['new_today']);  // dee
ok('unique today counts returning voters too, so it exceeds new today',
   $t['unique_today'] > $t['new_today'],
   $t['unique_today'] . ' vs ' . $t['new_today']);

echo "\n=== addresses never leak into the dashboard payload ===\n";
$safe = ngd_voters('review', false);
ok('without permission the people set is empty', $safe['people'] === []);
ok('and the counts are identical either way',
   $safe['totals']['unique_voters'] === $t['unique_voters']);
$summary = ngd_voters_summary('review', true);
$blob = json_encode($summary);
foreach (['ada@example.com', 'bo@example.com', 'cy@example.com', 'dee@example.com', '@'] as $needle) {
    ok('no "' . $needle . '" anywhere in the browser summary', !str_contains((string) $blob, $needle));
}

echo "\n=== and the ballot is untouched by any of it ===\n";
$before = (int) $db->query('SELECT COUNT(*) n FROM pc_votes')->fetch()['n'];
ngd_voters('review', true);
ngd_voters_summary('review', true);
same('not one row added or removed', $before,
     (int) $db->query('SELECT COUNT(*) n FROM pc_votes')->fetch()['n']);
ok('and no analytics table appeared in the ballot',
   (int) $db->query("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'ngd_%'")->fetch()['n'] === 0);

rmtree($sand);
echo "\n" . str_repeat('-', 60) . "\n";
echo ($fail === 0 ? 'ALL GOOD' : 'FAILURES') . ": $pass passed, $fail failed\n";
exit($fail === 0 ? 0 : 1);
