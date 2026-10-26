<?php
/* ============================================================================
   Registered, not registered, and honestly unknown.

       php tools/test-ngd-segments.php

   The list leadership wants most is "people who voted and have not bought a ticket", and
   it is the one with the most expensive failure mode: put a paying attendee on it and
   they get told to buy a ticket they already own.

   There are THREE answers, not two. The trap is that the production column cannot tell
   two of them apart on its own: pc_voter.eb_status is written by an admin-triggered
   reconciliation job, so it is empty both for somebody genuinely not registered AND for
   somebody nobody has looked at yet. Classifying on that column alone would quietly put
   every unreconciled voter on the outreach list.

   These cases cover each shape, and -- most importantly -- assert that when the Eventbrite
   attendee index is missing or stale, NOBODY is called unregistered.
   ========================================================================= */

declare(strict_types=1);

$root = dirname(__DIR__);
$sand = rtrim(sys_get_temp_dir(), '/\\') . '/ngd-seg-' . bin2hex(random_bytes(4));

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
@mkdir($sand . '/nextgen-data', 0777, true);
@mkdir($sand . '/nextgen-data-staging', 0777, true);
foreach (glob($root . '/public/api/*.php') ?: [] as $f) {
    if (preg_match('/^config(\..+)?\.php$/', basename($f))) { continue; }
    copy($f, $sand . '/public/api/' . basename($f));
}
copy($root . '/public/assets/js/pc-founders.js', $sand . '/public/assets/js/pc-founders.js');
file_put_contents($sand . '/public/api/config.php', "<?php\ndeclare(strict_types=1);\n"
    . "const NGS_ADMIN_SALT = '" . str_repeat('ab', 12) . "';\n"
    . "const NGS_ADMIN_HASH = '" . str_repeat('cd', 32) . "';\n"
    . "const NGS_SECRET = 'test-secret-not-a-real-one';\nconst NGS_DATA_KEY = 'seg';\n"
    . "const NGS_EVENTBRITE_TOKEN = '';\n"
    . "define('NGS_DATA_DIR', '" . str_replace('\\', '/', $sand) . "/nextgen-data-staging');\n");

require_once $sand . '/public/api/pc-attendee.php';     // brings pc-rules + pc-lib
require_once $sand . '/public/api/ngd-lib.php';

echo "registration segments\n\nsandbox  $sand\n\n";

/* ---------------------------------------------------------------------------
   0. The two hashes must agree, or every classification is wrong.
   ------------------------------------------------------------------------ */
echo "=== the hash this layer uses is the project's own ===\n";
foreach (['Someone@Example.com', 'plain@test.org', '  SPACED@x.io  '] as $e) {
    same('pc_ngd_email_key matches pc_email_key for ' . trim($e),
         pc_email_key($e), pc_ngd_email_key($e));
}

/* ---------------------------------------------------------------------------
   1. The classifier, case by case.
   ------------------------------------------------------------------------ */
echo "\n=== one voter at a time ===\n";

$fresh = ['ok' => true, 'fresh' => true, 'count' => 2, 'age_s' => 60,
          'map' => [pc_email_key('onlist@example.com') => 'a1',
                    pc_email_key('bound@example.com') => 'a2'], 'why' => ''];
$stale = ['ok' => true, 'fresh' => false, 'count' => 2, 'age_s' => 99999,
          'map' => $fresh['map'], 'why' => ''];
$none  = ['ok' => false, 'fresh' => false, 'count' => 0, 'age_s' => null, 'map' => [], 'why' => ''];

same('a bound registration is registered, whatever else is true',
     'registered', ngd_registration_of('bound@example.com', null, true, $fresh));
same('and still registered when the index is unusable',
     'registered', ngd_registration_of('bound@example.com', null, true, $none));
same('eb_status registered is registered',
     'registered', ngd_registration_of('x@example.com', 'registered', false, $none));
same('eb_status on_list is on the list',
     'on_list', ngd_registration_of('x@example.com', 'on_list', false, $none));
same('found in a fresh index is on the list',
     'on_list', ngd_registration_of('onlist@example.com', null, false, $fresh));
same('ABSENT from a fresh index is a real "no registration found"',
     'none', ngd_registration_of('nobody@example.com', null, false, $fresh));

echo "\n=== and the rule that protects paying attendees ===\n";
same('absent from a STALE index is UNKNOWN, not unregistered',
     'unknown', ngd_registration_of('nobody@example.com', null, false, $stale));
same('absent with NO index at all is UNKNOWN, not unregistered',
     'unknown', ngd_registration_of('nobody@example.com', null, false, $none));
ok('so a missing reconciliation can never put a registrant on the outreach list',
   ngd_registration_of('onlist@example.com', null, false, $none) === 'unknown');

/* ---------------------------------------------------------------------------
   2. End to end, against a fixture.
   ------------------------------------------------------------------------ */
echo "\n=== end to end ===\n";

pc_set_meta('mode', 'daily');
pc_set_meta('state', 'open');
pc_set_meta('deadline', '2030-01-01T23:59:59-05:00');
$db = pc_db();
pc_voter_table();
pc_attendee_tables();

$tz = new DateTimeZone('America/New_York');
$today = (new DateTime('now', $tz))->format('Y-m-d');
$yday  = (new DateTime('now', $tz))->modify('-1 day')->format('Y-m-d');
$ins = $db->prepare('INSERT INTO pc_votes
    (competition, voter_key, vote_day, slot, entrant_id, created_at, valid, simulated, ip_hash)
    VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)');
$vote = static function (string $k, string $e, string $day, int $slot = 1) use ($ins, $tz): void {
    $w = (new DateTime($day . ' 12:00:00', $tz))->setTimezone(new DateTimeZone('UTC'));
    $ins->execute(['peoples-choice-2026', $k, $day, $slot, $e, $w->format('Y-m-d\TH:i:s\Z'), 'x']);
};

/* a bound attendee: three points today, and votes on two days */
pc_voter_note('k-att', ['email' => 'bound@example.com']);
$db->prepare('INSERT INTO pc_attendee (attendee_key, voter_key, email_key, created_at) VALUES (?,?,?,?)')
   ->execute(['att-1', 'k-att', pc_email_key('bound@example.com'), ngs_now()]);
$vote('k-att', 'entrant-01', $yday);
$vote('k-att', 'entrant-01', $today, 1);
$vote('k-att', 'entrant-01', $today, 2);
$vote('k-att', 'entrant-01', $today, 3);

/* on the list, never claimed a bonus */
pc_voter_note('k-list', ['email' => 'onlist@example.com', 'eb_status' => 'on_list']);
$vote('k-list', 'entrant-02', $today);

/* genuinely not registered -- known address, absent from the index */
pc_voter_note('k-no', ['email' => 'nobody@example.com']);
$vote('k-no', 'entrant-03', $yday);
$vote('k-no', 'entrant-03', $today);

/* never reconciled, and not in the index either -- but we will test both index states */
pc_voter_note('k-dunno', ['email' => 'mystery@example.com']);
$vote('k-dunno', 'entrant-04', $today);

/* phone only, no address at all */
$vote('k-phone', 'entrant-05', $today);

/* a FRESH index naming the two registrations */
file_put_contents($sand . '/nextgen-data-staging/eventbrite-emails.json', json_encode([
    'ts' => time(),
    'map' => [pc_email_key('bound@example.com') => 'a1', pc_email_key('onlist@example.com') => 'a2'],
]));

$v = ngd_voters('review', true);
ok('the report built', $v['ok'] === true, (string) ($v['error'] ?? ''));
$seg = $v['segments'];
echo '  segments: ' . json_encode($seg) . "\n";
echo '  index   : ' . ($v['index']['why'] ?? '') . "\n";

same('one bound registrant', 1, $seg['registered']);
same('one on the list', 1, $seg['on_list']);
same('two with no registration found', 2, $seg['none']);   // nobody@ and mystery@
same('nobody unknown, because the index is fresh', 0, $seg['unknown']);
same('one three-point eligible', 1, $seg['three_point']);
same('four people with addresses', 4, $v['totals']['unique_voters']);
same('and one who voted with no address', 1, $v['no_email']['identities']);

echo "\n=== three-point eligibility is the BINDING, not the slots ===\n";
ok('the bound attendee is eligible', $v['people']['bound@example.com']['three_point'] === true);
ok('nobody else is, even though slots 2 and 3 exist only for them',
   $v['people']['onlist@example.com']['three_point'] === false
   && $v['people']['nobody@example.com']['three_point'] === false);

echo "\n=== distinct days, not vote count ===\n";
same('the attendee voted on two distinct days', 2, $v['people']['bound@example.com']['day_count']);
same('despite casting four points', 4, $v['people']['bound@example.com']['points']);
same('and the two-day voter shows two days', 2, $v['people']['nobody@example.com']['day_count']);

echo "\n=== now make the index stale, and watch nobody get accused ===\n";
file_put_contents($sand . '/nextgen-data-staging/eventbrite-emails.json', json_encode([
    'ts' => time() - 48 * 3600,
    'map' => [pc_email_key('bound@example.com') => 'a1', pc_email_key('onlist@example.com') => 'a2'],
]));
/* the index is cached per process, so this must be a fresh one */
/* A child process, because ngd_registration_index() caches per request -- one process
   cannot honestly re-judge an index it has already judged. The code goes in a FILE rather
   than php -r, because a shell argument containing a pipe is a quoting problem waiting to
   happen, and it duly happened the first time. */
$kid = $sand . '/reread.php';
file_put_contents($kid,
    '<?php require ' . var_export($sand . '/public/api/ngd-lib.php', true) . ';'
    . '$v = ngd_voters("review", false);'
    . 'echo json_encode(["seg" => $v["segments"], "fresh" => (bool) $v["index"]["fresh"]]);');
$out = (string) shell_exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($kid) . ' 2>&1');
echo "  with a 48-hour-old index: $out\n";
$kidOut = json_decode($out, true) ?: [];
$seg2 = $kidOut['seg'] ?? [];
same('the index is judged stale', false, (bool) ($kidOut['fresh'] ?? true));
same('NOBODY is listed as unregistered now', 0, (int) ($seg2['none'] ?? -1));
same('they became unknown instead', 2, (int) ($seg2['unknown'] ?? -1));
ok('and the bound registrant is still registered, because a binding needs no index',
   (int) ($seg2['registered'] ?? 0) === 1);
ok('as is the one whose eb_status already said so',
   (int) ($seg2['on_list'] ?? 0) === 1);

rmtree($sand);
echo "\n" . str_repeat('-', 60) . "\n";
echo ($fail === 0 ? 'ALL GOOD' : 'FAILURES') . ": $pass passed, $fail failed\n";
exit($fail === 0 ? 0 : 1);
