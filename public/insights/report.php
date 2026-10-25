<?php
/* ============================================================================
   NEXTGEN DATA — the reporting feed.

   One authenticated GET returns everything the dashboard draws. It lives here, under
   /insights/, rather than in /api/, for the same reason the People's Choice feed lives
   beside its own dashboard (peoples-choice/admin/index.php:9): the session cookie's
   path is /insights/, so a request to anywhere else on the site cannot carry one, and an
   unauthenticated request to this file gets 401 and nothing else.

   Why one call and not seven: every figure comes out of a single snapshot built in one
   read, so the headline, the chart and the table cannot disagree with each other. Seven
   endpoints would each read at a slightly different instant and eventually show three
   different totals on one screen.

   Nothing here can write to the voting database. See the top of api/ngd-lib.php.
   ========================================================================= */

declare(strict_types=1);

require_once dirname(__DIR__) . '/api/ngd-auth.php';

$me = ngd_require_json();        // 401s and exits unless signed in

$source  = ($_GET['source'] ?? '') === 'review' ? 'review' : ngd_default_source();
$refresh = ($_GET['refresh'] ?? '') === '1';
$from    = is_string($_GET['from'] ?? null) ? $_GET['from'] : '';
$to      = is_string($_GET['to'] ?? null) ? $_GET['to'] : '';

/* A refresh is the one thing on this page that costs a database read, so it is the one
   thing that is rate limited. Everything else is served from the snapshot. */
if ($refresh) {
    $file = ngd_snap_file($source);
    if (is_file($file) && (time() - (int) @filemtime($file)) < 10) {
        $refresh = false;            // asked twice inside ten seconds: serve the cache
    }
}

$snap = ngd_snapshot($source, $refresh);

$payload = $snap;
$payload['ok'] = true;
$payload['viewer'] = ['name' => $me['name'], 'role' => $me['role']];

/* PEOPLE. Counts only -- the addresses behind them never enter this payload; see
   ngd_voters(), which is asked for them only by export.php after a permission check. */
$payload['voters'] = ngd_voters_summary($source, $refresh);
$payload['can_export_emails'] = ngd_can('emails', $me);

/* The website-event store: a different file, read separately, and allowed to be empty. */
$payload['events'] = ngd_event_report($from !== '' ? $from : null, $to !== '' ? $to : null);

/* Insights last, because they read the two blocks above. */
$payload['insights'] = ngd_insights($snap, $payload['events']);

/* A custom range, when one is asked for. The named windows are already in totals. */
if ($from !== '' || $to !== '') {
    $payload['range'] = ngd_range($source, $from, $to, $refresh);
}

/* What the source-health strip shows. Deliberately includes no absolute path: the
   dashboard says WHICH store it read and HOW, never where it sits on disk. */
$payload['health'] = [
    'source'        => $source,
    'source_label'  => $snap['meta']['source_label'] ?? $source,
    'environment'   => $snap['meta']['environment'] ?? null,
    'reading'       => $source === 'live' ? 'the live competition database' : 'the review database',
    'served'        => $snap['meta']['served'] ?? null,
    'age_s'         => $snap['meta']['age_s'] ?? null,
    'stale'         => $snap['meta']['stale'] ?? false,
    'stale_reason'  => $snap['meta']['stale_reason'] ?? null,
    'rows_read'     => $snap['meta']['rows_read'] ?? 0,
    'build_ms'      => $snap['meta']['build_ms'] ?? null,
    'open_method'   => ngd_ro_method(),
    'read_only'     => true,
    'ttl_s'         => NGD_SNAP_TTL,
    'names_from'    => $snap['meta']['names_from'] ?? null,
    'error'         => $snap['meta']['error'] ?? null,
    'sources_present' => array_map(
        static fn($k) => ['key' => $k, 'label' => ngd_sources()[$k]['label'],
                          'present' => ngd_db_path($k) !== null],
        array_keys(ngd_sources())
    ),
];

/* Definitions travel with the numbers. A leadership export that says "1,646 points"
   without saying what a point is invites the wrong decision. */
$payload['definitions'] = [
    'unique voter' => 'One distinct verified email address with at least one qualifying vote. '
             . 'Voting five times makes one unique voter, not five. Supporting three founders '
             . 'makes one unique voter in the competition total and one in each of those three '
             . "founders' own figures — so the twenty founder columns MUST NOT be added up.",

    'qualifying vote' => 'valid = 1, simulated = 0, and not a seeded test row. This is stricter '
             . 'than the rule for POINTS, which counts unverified rows because a point is a '
             . 'point. A person is not: a row with no proven identity behind it cannot '
             . 'contribute a person.',

    'daily unique voters' => 'Distinct people who voted on that day, returning voters included.',

    'new unique voters' => 'People whose FIRST qualifying vote was that day. Always smaller than '
             . 'or equal to the daily figure.',

    'no address on record' => 'Identities that voted with a verified phone and never completed '
             . 'the email step. They are real people and they are not in the email figure, so '
             . 'they are reported separately rather than dropped or merged.',

    'point' => 'One row in the voting table. A registered attendee spending three points creates '
             . 'three rows, which is why points and voters are different numbers.',

    'valid points' => 'valid = 1, counted exactly as pc_tally() counts them. This is the admin '
             . 'dashboard\'s definition and it is the headline here.',

    'public standings total' => 'valid = 1 AND simulated = 0, which is what /api/pc-rank.php shows '
             . 'the public (pc-rank.php:66-68). It is a smaller number than the headline whenever '
             . 'any point was cast without a verified identity. Both are correct; they answer '
             . 'different questions, and this dashboard shows both so they cannot silently diverge.',

    'verified voting identity' => 'One distinct voter key. A key is derived from a verified email '
             . 'or phone, so this counts IDENTITIES, not people: one person using two addresses is '
             . 'two identities with two daily allowances, and nothing links them. Read it as a '
             . 'ceiling on headcount, never as headcount. No key or address appears in this feed.',

    'standard point' => 'A point in slot 1 — the one point any verified voter gets each day.',

    'registration point' => 'A point in slot 2 or 3. Only a voter whose daily allowance is above '
             . 'one can create them, which today means a verified Eventbrite registration. The '
             . 'column records the SLOT, not the route: an attendee spending a second point through '
             . 'the ordinary vote button lands in slot 2 just the same. pc_daily() calls these the '
             . 'attendee bonus (pc-lib.php:378).',

    'verified / unverified' => 'simulated = 0 means the point was cast after an email or phone was '
             . 'verified; simulated = 1 means it was not. Both are inside the official total. Note '
             . 'the column means "unverified", not "fake" — and nothing in the table '
             . 'distinguishes a seeded row from a genuine unverified one except the voter key.',

    'test points' => 'Rows whose voter key begins "seed:", written by the admin panel\'s seed '
             . 'button (peoples-choice/admin/index.php:474). That prefix is the only discriminator '
             . 'that exists, so treat it as a reliable marker for seeded rows and not as proof that '
             . 'nothing else is synthetic. They are inside the official total because the admin '
             . 'dashboard counts them, and are broken out everywhere.',

    'day' => 'The Eastern calendar day the vote was recorded against (America/New_York), taken '
             . 'from the row\'s own vote_day column.',

    'rank' => 'Equal totals share a rank, and the next rank skips, exactly as pc_standings() ranks '
             . '(pc-lib.php:442). Ties are broken for display only, by contestant id ascending, '
             . 'never to pick a winner out of a tie.',

    'rank history' => 'Day-end standings rebuilt from each row\'s own timestamp, using today\'s '
             . 'validity flags — so a point invalidated this morning is absent from every '
             . 'earlier day too. No ranking was recorded at the time, so this is a reconstruction, '
             . 'not an archive.',

    'contestant page visits' => 'Link opens on individual contestant pages, the only traffic the '
             . 'voting system has ever recorded (pc_log_visit, entrant.php:41). It counts social '
             . 'link-preview fetches as well as people, and that inflation cannot be separated out '
             . 'retrospectively. The landing page, the homepage section and the ticket pages were '
             . 'never instrumented at all.',

    'unique visitors' => 'A visitor token is salted with the Eastern day, so it stops being '
             . 'linkable the next day. Unique counts are therefore meaningful WITHIN a day only; '
             . 'any multi-day figure is a sum of daily uniques and overstates distinct people.',
];

echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
