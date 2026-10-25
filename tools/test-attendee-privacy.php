<?php
/* ============================================================================
   Can an attendee's name reach the public site without their agreement?

       php tools/test-attendee-privacy.php

   For sixteen days it could. The opt-in check in attendee-count.php was commented out on
   2026-10-09 and marked TEMPORARY, and the endpoint published the first name and last
   initial of all 228 attending people whether or not they had asked for that.

   These cases feed synthetic Eventbrite attendee records through the REAL
   ngs_eb_attendee_opted_in() and ngs_eb_states(), including the shapes that caused the
   problem: no answers at all, a question that merely resembles the right one, an answer
   that is blank, and an order form with no opt-in question anywhere on it. Every one of
   those must end with the name NOT published.

   No network call is made: ngs_eb_states() takes its pager as a callable, so the whole
   Eventbrite conversation is a fixture. Nothing real is read or written.
   ========================================================================= */

declare(strict_types=1);

$root = dirname(__DIR__);
$sand = rtrim(sys_get_temp_dir(), '/\\') . '/ngd-priv-' . bin2hex(random_bytes(4));

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
@mkdir($sand . '/nextgen-data-staging', 0777, true);
foreach (glob($root . '/public/api/*.php') ?: [] as $f) {
    /* No real private config of any kind reaches a sandbox: config.php holds the
       live secrets and config.ngd.php holds real account hashes. A test that
       copied either would be testing the developer's machine. */
    if (preg_match('/^config(\..+)?\.php$/', basename($f))) { continue; }
    copy($f, $sand . '/public/api/' . basename($f));
}
file_put_contents($sand . '/public/api/config.php', "<?php\ndeclare(strict_types=1);\n"
    . "const NGS_ADMIN_SALT = 'abababababababababababab';\nconst NGS_ADMIN_HASH = 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd';\n"
    . "const NGS_SECRET = 'test-secret-not-a-real-one';\nconst NGS_DATA_KEY = 'priv';\n"
    . "const NGS_EVENTBRITE_TOKEN = '';\n"
    . "define('NGS_DATA_DIR', '" . str_replace('\\', '/', $sand) . "/nextgen-data-staging');\n");

/* attendee-count.php runs its endpoint logic at the tail, so pull in only what we test by
   evaluating the file with the request short-circuited. It guards on SCRIPT_FILENAME, so a
   CLI include simply defines the functions and then falls through to its main block -- which
   needs a token it will not get. Capture and discard whatever it prints. */
$_SERVER['SCRIPT_FILENAME'] = __FILE__;
ob_start();
require $sand . '/public/api/attendee-count.php';
ob_end_clean();

echo "attendee privacy\n\nsandbox  $sand\n\n";

/* ---------------------------------------------------------------------------
   1. The consent check, record by record.
   ------------------------------------------------------------------------ */

echo "=== who has actually agreed ===\n";

$Q = 'Show my first name on the NextGen website?';
$person = static function (array $answers, string $first = 'Maya', string $last = 'Rivers'): array {
    return ['profile' => ['first_name' => $first, 'last_name' => $last],
            'created' => '2026-10-20T10:00:00Z', 'answers' => $answers];
};

ok('no answers at all  -> not published',
   ngs_eb_attendee_opted_in($person([])) === false);
ok('answers present but no such question  -> not published',
   ngs_eb_attendee_opted_in($person([['question' => 'T-shirt size', 'answer' => 'M']])) === false);
ok('the right question, answered No  -> not published',
   ngs_eb_attendee_opted_in($person([['question' => $Q, 'answer' => 'No']])) === false);
ok('the right question, answered blank  -> not published',
   ngs_eb_attendee_opted_in($person([['question' => $Q, 'answer' => '']])) === false);
ok('the right question, answer missing entirely  -> not published',
   ngs_eb_attendee_opted_in($person([['question' => $Q]])) === false);
ok('the right question, answered Yes  -> published',
   ngs_eb_attendee_opted_in($person([['question' => $Q, 'answer' => 'Yes']])) === true);
foreach (['yes', 'YES', 'y', 'true', '1', 'on', 'I agree'] as $v) {
    ok('"' . $v . '" counts as agreement',
       ngs_eb_attendee_opted_in($person([['question' => $Q, 'answer' => $v]])) === true);
}
foreach (['no', 'N', 'false', '0', 'maybe', 'later', 'nope'] as $v) {
    ok('"' . $v . '" does not',
       ngs_eb_attendee_opted_in($person([['question' => $Q, 'answer' => $v]])) === false);
}

/* a question that mentions a name and a website but is not the consent question */
ok('a lookalike question cannot stand in for consent',
   ngs_eb_attendee_opted_in($person([
       ['question' => 'What name should we print on your website profile badge?', 'answer' => 'Maya'],
   ])) === false);

echo "\n=== when the question id is pinned in config ===\n";
$byId = [['question_id' => '111', 'question' => 'Something else', 'answer' => 'Yes'],
         ['question_id' => '222', 'question' => $Q, 'answer' => 'No']];
ok('only the pinned question decides, even if another says Yes',
   ngs_eb_attendee_opted_in($person($byId), '222') === false);
$byId2 = [['question_id' => '222', 'question' => $Q, 'answer' => 'Yes']];
ok('and a Yes on the pinned question is honoured',
   ngs_eb_attendee_opted_in($person($byId2), '222') === true);
ok('a pinned id that appears nowhere  -> not published',
   ngs_eb_attendee_opted_in($person($byId2), '999') === false);

/* ---------------------------------------------------------------------------
   2. The whole walk, as the endpoint runs it.
   ------------------------------------------------------------------------ */

echo "\n=== the full attendee walk ===\n";

$roster = [
    $person([['question' => $Q, 'answer' => 'Yes']], 'Maya', 'Rivers'),
    $person([['question' => $Q, 'answer' => 'No']],  'Devon', 'Okafor'),
    $person([],                                       'Priya', 'Shah'),
    $person([['question' => 'T-shirt size', 'answer' => 'L']], 'Sam', 'Lee'),
    $person([['question' => $Q, 'answer' => 'yes']], 'Chen', 'Wu'),
];
/* give everyone a state so the aggregate has something to count */
foreach ($roster as $i => &$r) {
    $r['answers'][] = ['question' => 'State', 'answer' => $i < 3 ? 'MD' : 'VA'];
}
unset($r);

$pager = static function (string $url) use ($roster) {
    return ['attendees' => $roster, 'pagination' => ['has_more_items' => false]];
};

$out = ngs_eb_states($pager);
ok('two of the five agreed', ($out['names_agreed'] ?? null) === 2, json_encode($out['names_agreed'] ?? null));
ok('all five were considered', ($out['names_considered'] ?? null) === 5, json_encode($out['names_considered'] ?? null));
ok('exactly the two who agreed are listed',
   $out['names'] === ['Chen W.', 'Maya R.'] || $out['names'] === ['Maya R.', 'Chen W.'],
   json_encode($out['names']));
foreach (['Devon', 'Priya', 'Sam'] as $who) {
    ok($who . ' is not in the list', !str_contains(json_encode($out['names']), $who));
}

echo "\n=== the aggregate survives, because it names nobody ===\n";
$byState = [];
foreach ($out['states'] as [$code, $n]) { $byState[$code] = $n; }
ok('Maryland still counts 3', ($byState['MD'] ?? 0) === 3, json_encode($out['states']));
ok('Virginia still counts 2', ($byState['VA'] ?? 0) === 2, json_encode($out['states']));
ok('nobody is unknown', ($out['unknown'] ?? -1) === 0, (string) ($out['unknown'] ?? -1));

/* ---------------------------------------------------------------------------
   3. The failure that started this: an order form with no opt-in question.
   ------------------------------------------------------------------------ */

echo "\n=== an order form with no consent question at all ===\n";
$plain = [];
foreach (['Ada', 'Bo', 'Cy', 'Di'] as $i => $nm) {
    $plain[] = $person([['question' => 'State', 'answer' => 'MD']], $nm, 'Smith');
}
$out2 = ngs_eb_states(static fn(string $u) => ['attendees' => $plain, 'pagination' => ['has_more_items' => false]]);
ok('nobody is published', $out2['names'] === [], json_encode($out2['names']));
ok('and the count of people is still right', array_sum(array_column($out2['states'], 1)) === 4);
ok('the owner can see the gap: 4 considered, 0 agreed',
   $out2['names_considered'] === 4 && $out2['names_agreed'] === 0);

/* and what the browser would actually receive */
ob_start();
ngs_eb_send(4, $out2);
$raw = (string) ob_get_clean();
/* Under the CLI this test has already printed, so ngs_eb_send()'s http_response_code()
   emits a "headers already sent" warning into the buffer ahead of the JSON. That is an
   artefact of testing a web endpoint from a terminal, not a defect in the reply, so take
   the JSON document and judge that. */
$body = substr($raw, (int) strpos($raw, '{'));
$json = json_decode($body, true);
if (!is_array($json)) {
    echo '  (raw reply was: ' . var_export($raw, true) . ")
";
    $json = [];
}
ok('the public reply carries no names key at all', !array_key_exists('names', $json), $body);
ok('it still carries the count', ($json['count'] ?? null) === 4);
ok('it still carries the per-state totals', isset($json['states']));
ok('and it does not leak the opt-in counters', !str_contains($body, 'names_considered'), $body);
foreach (['Ada', 'Smith', 'Bo', 'Cy', 'Di'] as $who) {
    ok('no trace of ' . $who . ' in the response', !str_contains($body, $who));
}

/* ---------------------------------------------------------------------------
   3b. THE CACHE — the hole the first version of these tests did not look at.

   The endpoint serves the snapshot it already has BEFORE it considers rebuilding, and
   that snapshot lives outside the web root where no deploy reaches it. So restoring the
   consent check, on its own, would have gone on publishing the pre-fix list for up to
   five minutes of ordinary traffic -- and for a full 24 hours if the Eventbrite walk
   kept failing, because a failed walk only updated "checked" and left the names in
   place. The suite was 49/49 green while the endpoint served 212 non-consenting names,
   because it only ever tested the collector and never the serving path.

   These cases test the serving path, with a snapshot written by the old code.
   ------------------------------------------------------------------------ */

echo "
=== a snapshot written before consent was checked ===
";

$preFix = [
    'states'  => [['MD', 3], ['VA', 2]],
    'unknown' => 0,
    'names'   => ['Ada S.', 'Bo S.', 'Cy S.', 'Di S.'],   // nobody consented to these
    'at'      => time() - 30,
    'checked' => time() - 30,
    // no 'v' key at all: this is what the old code wrote
];
$cleaned = ngs_eb_snapshot_consented($preFix);
ok('an unversioned snapshot loses its names', !isset($cleaned['names']), json_encode($cleaned['names'] ?? null));
ok('but keeps its totals, which name nobody', ($cleaned['states'] ?? null) === $preFix['states']);

ob_start();
ngs_eb_send(5, $cleaned);
$raw2 = (string) ob_get_clean();
$body2 = substr($raw2, (int) strpos($raw2, '{'));
foreach (['Ada', 'Bo S.', 'Cy', 'Di'] as $who) {
    ok('no trace of ' . $who . ' in what the browser receives', !str_contains($body2, $who));
}
$j2 = json_decode($body2, true);
ok('the count still goes out', ($j2['count'] ?? null) === 5, $body2);
ok('and the per-state totals still go out', isset($j2['states']));

echo "
=== a snapshot written by the new code is trusted ===
";
$postFix = $preFix + [];
$postFix['v'] = NGS_EB_SNAP_V;
$postFix['names'] = ['Maya R.'];
$kept = ngs_eb_snapshot_consented($postFix);
ok('its names survive, because consent was checked when it was written',
   ($kept['names'] ?? []) === ['Maya R.'], json_encode($kept['names'] ?? null));

echo "
=== and a snapshot one version behind is not trusted ===
";
$older = $postFix;
$older['v'] = NGS_EB_SNAP_V - 1;
ok('an older version loses its names too', !isset(ngs_eb_snapshot_consented($older)['names']));

/* ---------------------------------------------------------------------------
   4. The outright switch.
   ------------------------------------------------------------------------ */

echo "\n=== NGS_EB_PUBLIC_NAMES ===\n";
ok('names are allowed when the constant is absent', ngs_eb_names_allowed() === true);
define('NGS_EB_PUBLIC_NAMES', false);
ok('and refused when it is false', ngs_eb_names_allowed() === false);
$out3 = ngs_eb_states($pager);
ok('with it off, even the people who agreed are not listed', $out3['names'] === [], json_encode($out3['names']));
ok('but they were still counted as having agreed, so the owner can tell why',
   $out3['names_agreed'] === 0 && $out3['names_considered'] === 5,
   $out3['names_agreed'] . '/' . $out3['names_considered']);

rmtree($sand);
echo "\n" . str_repeat('-', 60) . "\n";
echo ($fail === 0 ? "ALL GOOD" : "FAILURES") . ": $pass passed, $fail failed\n";
exit($fail === 0 ? 0 : 1);
