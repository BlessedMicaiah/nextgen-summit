<?php
/* ============================================================================
   Does reporting ever make a voter wait?

       php tools/test-ngd-concurrency.php

   The voting database is in SQLite's default rollback-journal mode, so a reader holds a
   SHARED lock and a writer cannot take the EXCLUSIVE lock it needs until every reader has
   let go. The writer waits five seconds (_lib.php:84) and then throws. pc_cast() catches
   that per slot as "that slot is taken" (pc-lib.php:258) and, out of slots, returns
   reason 'allowance' (pc-lib.php:265) -- so a lock timeout reaches the voter as "you have
   used your allowance for today", with nothing logged anywhere.

   That is the failure this whole design exists to avoid, so it is measured rather than
   asserted. Three runs, identical except for what the reader is doing:

     1. nothing at all          -- the baseline a voter gets with no dashboard open
     2. ngd_take_snapshot()     -- what NextGen Data actually does, in a tight loop
     3. a full table scan       -- what counting against the live file would have done

   Run 3 is included because without it the other two are just numbers. It is the shape of
   the code that was almost shipped, and it is the one that should hurt.

   Everything happens in a throwaway sandbox. No real database is touched.
   ========================================================================= */

declare(strict_types=1);

$root = dirname(__DIR__);
$mode = $argv[1] ?? '';

/* ---------------------------------------------------------------------------
   The writer child: cast votes as fast as it can and record what each one cost.
   ------------------------------------------------------------------------ */
if ($mode === 'writer') {
    $sand = (string) $argv[2];
    $n    = (int) $argv[3];
    require_once $sand . '/public/api/pc-rules.php';

    $lat = [];
    $refused = [];
    for ($i = 0; $i < $n; $i++) {
        $t = microtime(true);
        $r = pc_cast('load-' . $i . '-' . bin2hex(random_bytes(3)),
                     'entrant-' . str_pad((string) (($i % 20) + 1), 2, '0', STR_PAD_LEFT),
                     false, false);
        $lat[] = (microtime(true) - $t) * 1000;
        if (empty($r['ok'])) {
            $refused[] = (string) ($r['reason'] ?? '?');
        }
        usleep(2000);
    }
    file_put_contents($sand . '/writer.json', json_encode(['lat' => $lat, 'refused' => $refused]));
    exit(0);
}

/* ---------------------------------------------------------------------------
   The reader child: hammer the live file until the writer has finished.

   It runs in its own process for a mundane reason -- each run needs its own sandbox, and
   three sandboxes mean three copies of ngd-lib.php, which one process cannot load twice.
   It is also closer to the truth: a dashboard request is its own process too.
   ------------------------------------------------------------------------ */
if ($mode === 'reader') {
    $sand = (string) $argv[2];
    $kind = (string) $argv[3];
    require_once $sand . '/public/api/ngd-lib.php';
    $live = $sand . '/nextgen-data-staging/nextgen-conc.sqlite';

    $ms = [];
    $deadline = microtime(true) + 120;
    while (!is_file($sand . '/writer.json') && microtime(true) < $deadline) {
        $t = microtime(true);
        if ($kind === 'snapshot') {
            ngd_take_snapshot($live);
        } else {
            /* The naive shape, faithfully: open the live file, select every row, and do
               the whole aggregation WITH THE HANDLE STILL OPEN. That last part is the
               point -- it is what a dashboard written the obvious way does, and it is why
               the lock is held for the length of a page render rather than a file copy.
               No artificial delay is added; this is just the real work in the real place. */
            $db = ngd_ro($live);
            if ($db) {
                $s = $db->prepare('SELECT vote_day, entrant_id, voter_key, slot, simulated,
                                          valid, created_at FROM pc_votes WHERE competition = ?');
                $s->execute(['peoples-choice-2026']);
                $rows = $s->fetchAll();
                $f = ngd_founders('review');
                unset($f['_from']);
                $agg = ngd_aggregate($rows, $f, []);
                $json = json_encode($agg);
                unset($rows, $agg, $json);
                $db = null;
            }
        }
        $ms[] = (microtime(true) - $t) * 1000;
        if (count($ms) > 5000) { break; }
    }
    file_put_contents($sand . '/reader.json', json_encode($ms));
    exit(0);
}

/* ---------------------------------------------------------------------------
   The parent.
   ------------------------------------------------------------------------ */

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

function build(string $root, int $rows): string
{
    $sand = rtrim(sys_get_temp_dir(), '/\\') . '/ngd-conc-' . bin2hex(random_bytes(4));
    @mkdir($sand . '/public/api', 0777, true);
    @mkdir($sand . '/public/assets/js', 0777, true);
    @mkdir($sand . '/nextgen-data-staging', 0777, true);
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
        . "const NGS_SECRET = 'test-secret-not-a-real-one';\nconst NGS_DATA_KEY = 'conc';\n"
        . "const NGS_EVENTBRITE_TOKEN = '';\n"
        . "define('NGS_DATA_DIR', '" . str_replace('\\', '/', $sand) . "/nextgen-data-staging');\n");

    /* seed it to roughly the live competition's size in a separate process, so the parent
       never holds a handle on the file it is about to measure */
    $seed = tempnam(sys_get_temp_dir(), 'seed') . '.php';
    file_put_contents($seed, "<?php\nrequire '" . str_replace('\\', '/', $sand)
        . "/public/api/pc-rules.php';\n"
        . "pc_set_meta('mode','daily'); pc_set_meta('state','open');\n"
        . "pc_set_meta('deadline','2030-01-01T23:59:59-05:00');\n"
        . "\$db = pc_db();\n\$s = \$db->prepare('INSERT INTO pc_votes (competition, voter_key, vote_day,"
        . " slot, entrant_id, created_at, valid, simulated, ip_hash) VALUES (?,?,?,?,?,?,1,0,?)');\n"
        . "\$db->beginTransaction();\n"
        . "for (\$i = 0; \$i < $rows; \$i++) { \$s->execute(['peoples-choice-2026', 'seedv'.\$i,"
        . " '2026-10-24', 1, 'entrant-'.str_pad((string)((\$i%20)+1),2,'0',STR_PAD_LEFT),"
        . " '2026-10-24T12:00:00Z', 'x']); }\n\$db->commit();\n");
    shell_exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($seed) . ' 2>&1');
    @unlink($seed);
    return $sand;
}

function stats(array $v): array
{
    if (!$v) { return ['n' => 0, 'median' => 0.0, 'p95' => 0.0, 'max' => 0.0]; }
    sort($v);
    $n = count($v);
    return [
        'n'      => $n,
        'median' => $v[(int) floor($n * 0.5)],
        'p95'    => $v[min($n - 1, (int) floor($n * 0.95))],
        'max'    => $v[$n - 1],
    ];
}

$VOTES = 200;
$ROWS  = 2000;

echo "NextGen Data — does reporting delay a vote?\n\n";
echo "Each run: {$VOTES} votes cast into a {$ROWS}-row competition while a reader does\n";
echo "something different alongside. Latency is per vote, in milliseconds.\n\n";

$results = [];
foreach (['idle' => 'nothing (baseline)',
          'snapshot' => 'ngd_take_snapshot() in a loop  <- what NextGen Data does',
          'scan' => 'full table scan in a loop      <- what it deliberately does not'] as $kind => $label) {

    $sand = build($root, $ROWS);
    $cmd = [escapeshellarg(PHP_BINARY), escapeshellarg(__FILE__), 'writer',
            escapeshellarg($sand), (string) $VOTES];
    $proc = proc_open(implode(' ', $cmd), [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);

    $rproc = null;
    $rpipes = [];
    if ($kind !== 'idle') {
        /* No quarter: the reader runs flat out, with no pause between passes, for the whole
           time the writer is working. */
        $rcmd = [escapeshellarg(PHP_BINARY), escapeshellarg(__FILE__), 'reader',
                 escapeshellarg($sand), escapeshellarg($kind)];
        $rproc = proc_open(implode(' ', $rcmd), [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $rpipes);
    }

    if (is_resource($proc)) {
        foreach ($pipes as $pp) { if (is_resource($pp)) { fclose($pp); } }
        proc_close($proc);                       // blocks until the writer is done
    }
    if (is_resource($rproc)) {
        foreach ($rpipes as $pp) { if (is_resource($pp)) { fclose($pp); } }
        proc_close($rproc);                      // the reader stops when writer.json appears
    }

    $rraw = @file_get_contents($sand . '/reader.json');
    $readMs = is_string($rraw) ? (json_decode($rraw, true) ?: []) : [];
    $reads = count($readMs);

    $raw = @file_get_contents($sand . '/writer.json');
    $w = is_string($raw) ? json_decode($raw, true) : null;
    $lat = is_array($w) && isset($w['lat']) ? $w['lat'] : [];
    $refused = is_array($w) && isset($w['refused']) ? $w['refused'] : [];
    $results[$kind] = ['label' => $label, 'lat' => stats($lat), 'refused' => $refused,
                       'reads' => $reads, 'read' => stats($readMs)];
    rmtree($sand);
}

printf("%-22s %9s %9s %9s %9s %10s\n", 'reader is doing', 'median', 'p95', 'max', 'refused', 'reads');
echo str_repeat('-', 74) . "\n";
foreach ($results as $kind => $r) {
    printf("%-22s %8.1f %8.1f %8.1f %9d %10s\n", $kind,
        $r['lat']['median'], $r['lat']['p95'], $r['lat']['max'],
        count($r['refused']), $r['reads'] > 0 ? (string) $r['reads'] : '-');
}
echo "\n";
foreach ($results as $kind => $r) {
    echo "  $kind: " . $r['label'] . "\n";
    if ($r['reads'] > 0) {
        printf("     %d reads, median %.1fms each\n", $r['reads'], $r['read']['median']);
    }
    if ($r['refused']) {
        $by = array_count_values($r['refused']);
        foreach ($by as $why => $n) {
            echo "     $n vote(s) REFUSED with reason '$why'\n";
        }
    }
}

/* ---------------------------------------------------------------------------
   The verdict.
   ------------------------------------------------------------------------ */
echo "\n" . str_repeat('-', 74) . "\n";
$pass = 0;
$fail = 0;
$ok = static function (string $label, bool $cond, string $detail = '') use (&$pass, &$fail): void {
    if ($cond) { $pass++; echo "  PASS  $label\n"; }
    else { $fail++; echo "  FAIL  $label" . ($detail !== '' ? " ($detail)" : '') . "\n"; }
};

$base = $results['idle']['lat'];
$snap = $results['snapshot']['lat'];

$ok('no vote was refused while snapshots were running',
    count($results['snapshot']['refused']) === 0,
    implode(',', $results['snapshot']['refused']));
$ok('every vote was accepted in the baseline too',
    count($results['idle']['refused']) === 0);
$ok('snapshots took at least one pass', $results['snapshot']['reads'] > 0,
    (string) $results['snapshot']['reads']);
$ok('a snapshot costs single-digit to low tens of milliseconds',
    $results['snapshot']['read']['median'] < 250,
    sprintf('%.1fms', $results['snapshot']['read']['median']));
$ok('the slowest vote stayed far below the 5s point where a voter is told "allowance spent"',
    $snap['max'] < 1000, sprintf('%.1fms', $snap['max']));
$ok('median vote latency is not materially worse than the baseline',
    $snap['median'] <= max(5.0, $base['median'] * 3 + 2),
    sprintf('%.1fms vs %.1fms', $snap['median'], $base['median']));

echo "\n";
/* What this run does and does not establish, recorded here so nobody has to remember it.

   It answers the question asked: snapshotting does not delay a vote. Zero refusals, and the
   slowest vote stays roughly two orders of magnitude below the five seconds at which a voter
   would be told their allowance was spent.

   It does NOT show the naive scan failing, and that should not be claimed. At a couple of
   thousand rows on a local SSD there is too much headroom for either approach to hurt. What
   the numbers do show is the structural difference the design rests on: the scan holds the
   live file roughly twice as long per pass, because it keeps the handle open across the
   aggregation. That gap is what widens with row count, with slower shared-hosting disk, and
   with more than one reader -- and it is cheap enough to avoid that there is no reason to
   find out where it stops being safe. */
$snapRead = $results['snapshot']['read']['median'];
$scanRead = $results['scan']['read']['median'];
echo "
  Note: this shows snapshotting is safe, not that scanning is already unsafe.
";
printf("  At this size the scan held the live file %.0f%% longer per pass (%.0fms vs %.0fms)
",
    $snapRead > 0 ? ($scanRead / $snapRead - 1) * 100 : 0, $scanRead, $snapRead);
echo "  and still refused nothing. That margin is what shrinks as the table and disk change.
";

echo ($fail === 0 ? "ALL GOOD" : "FAILURES") . ": $pass passed, $fail failed\n";
exit($fail === 0 ? 0 : 1);
