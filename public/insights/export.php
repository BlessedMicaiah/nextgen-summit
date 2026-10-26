<?php
/* ============================================================================
   NEXTGEN DATA — exports.

   CSV, Excel and PDF, all behind the same session as the dashboard, all built from the
   same snapshot the screen is showing, and all carrying their own provenance: when the
   data was read, which source it came from, what period it covers, and what each column
   means. A spreadsheet that says "1,646" with no date range and no definition of a point
   is how a number ends up in a board pack meaning something it never meant.

   WHAT IS DELIBERATELY NOT IN THESE FILES

   No email addresses. No phone numbers. No voter keys. No IP hashes. No verification
   codes. The existing admin export does include verified email addresses, because its job
   is case-by-case administration; this one's job is reporting, and the brief is explicit
   that standard exports carry no individual voter identity. A voter key identifies a row
   to the system and nothing at all to a reader, so a spreadsheet of them is a liability
   with no matching use.

   NO LIBRARIES

   Shared hosting, so nothing is installed. The Excel file is built as what .xlsx actually
   is -- a zip of XML parts -- and the PDF is written byte by byte with the standard
   Helvetica faces every reader already has. If ZipArchive is missing the Excel request
   falls back to CSV and says so in the filename rather than failing.

   FORMULA INJECTION

   Any cell whose value opens with = + - @ or a tab gets a leading apostrophe, which makes
   the cell literal text in Excel and Google Sheets alike. Same guard, same reason, as
   csv_cell() in the People's Choice admin (peoples-choice/admin/index.php:74).
   ========================================================================= */

declare(strict_types=1);

require_once dirname(__DIR__) . '/api/ngd-auth.php';

ngd_headers(false);
ngd_require_same_origin();
$me = ngd_user();
if ($me === null) {
    http_response_code(401);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Sign in at /insights/ first.\n";
    exit;
}

$report = is_string($_GET['report'] ?? null) ? $_GET['report'] : 'executive';
$format = is_string($_GET['format'] ?? null) ? strtolower($_GET['format']) : 'csv';
$source = ($_GET['source'] ?? '') === 'review' ? 'review' : ngd_default_source();
$from   = is_string($_GET['from'] ?? null) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['from']) ? $_GET['from'] : '';
$to     = is_string($_GET['to'] ?? null) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['to']) ? $_GET['to'] : '';
$only   = is_string($_GET['entrant'] ?? null) && preg_match('/^entrant-\d{2}$/', $_GET['entrant']) ? $_GET['entrant'] : '';

if (!in_array($format, ['csv', 'xlsx', 'pdf'], true)) {
    $format = 'csv';
}

$snap   = ngd_snapshot($source, false);
$events = ngd_event_report($from !== '' ? $from : null, $to !== '' ? $to : null);
$range  = ($from !== '' && $to !== '') ? ngd_range($source, $from, $to, false) : null;

$meta = $snap['meta'] ?? [];
$tot  = $snap['totals'] ?? [];
$period = ($from !== '' && $to !== '')
    ? $from . ' to ' . $to . ' (Eastern)'
    : 'All time, since voting opened' . (!empty($tot['launch_day']) ? ' on ' . $tot['launch_day'] : '');

/* ---------------------------------------------------------------------------
   Provenance. Every file begins with these lines, in every format.
   ------------------------------------------------------------------------ */
function ngd_provenance(array $meta, array $tot, string $period, string $source, array $events): array
{
    return [
        ['NextGen Summit 2026 — People\'s Choice Award'],
        ['Report generated',    (string) (ngd_et_label(time()) ?? '')],
        ['Data source',         (string) ($meta['source_label'] ?? $source)
                                 . ($source === 'live' ? ' — the authoritative competition records' : '')],
        ['Data read at',        (string) ($meta['built_at_et'] ?? '')],
        ['Freshness',           ((($meta['stale'] ?? false) === true)
                                  ? 'STALE — the source could not be re-read; figures are as at the time above'
                                  : 'Current — read within the last minute')],
        ['Reporting period',    $period],
        ['Reporting timezone',  'America/New_York'],
        ['Competition',         (string) ($meta['competition'] ?? '')],
        ['Rows read',           (string) ($meta['rows_read'] ?? '')],
        ['Access',              'Read-only. This report cannot and did not alter any vote.'],
        ['Website events',      !empty($events['collecting'])
                                  ? 'Collected since ' . (string) ($events['since'] ?? 'unknown')
                                  : 'Not collected — no page-view or ticket-journey data exists for this period'],
        ['Privacy',             'Contains no email addresses, phone numbers, voter keys or IP data.'],
        [''],
            ];

            /* Only meaningful for the whole competition. In a past one-day window a row
               called "Points today" is not merely useless, it invites the reader to treat
               a number from outside the period as part of it. */
            if ($wholeCompetition) {
                $rows = array_merge($rows, [
                    ['Points today',           (string) ($tot['today'] ?? 0)],
                    ['Voters today',           (string) ($tot['today_voters'] ?? 0)],
                    ['Points yesterday',       (string) ($tot['yesterday'] ?? 0)],
                    ['Day-on-day change',      isset($tot['day_growth_pct']) && $tot['day_growth_pct'] !== null
                                                 ? $tot['day_growth_pct'] . '%' : 'no comparison available'],
                    ['Last 24 hours',          (string) ($tot['last24'] ?? 0)],
                    ['Previous 24 hours',      (string) ($tot['prev24'] ?? 0)],
                    ['Points per voter',       (string) ($tot['points_per_voter'] ?? 0)],
                ]);
            }
}

/* ---------------------------------------------------------------------------
   The reports. Each returns [filename stem, sheets], where a sheet is
   [title, header row, data rows, optional notes].
   ------------------------------------------------------------------------ */

$founders = $snap['founders'] ?? [];
if ($range !== null && !empty($range['ok'])) {
    $founders = $range['founders'];        // the range view, when one was asked for
}

$defs = [
    [''],
    ['How to read these numbers'],
    ['Point',      'One row in the voting table. A verified attendee spending three points creates three rows, which is why points and voters differ.'],
    ['Valid',      'Invalidated rows are excluded from every figure here, exactly as the admin dashboard excludes them.'],
    ['Voter',      'One distinct voter key, derived from a verified email or phone. One person using two addresses counts as two voters.'],
    ['Standard',   'A point in slot 1 — the one point any verified voter gets each day.'],
    ['Bonus',      'A point in slot 2 or 3 — the two extra daily points a verified Eventbrite registration unlocks.'],
    ['Verified',   'Cast after an email or phone was verified. Unverified points are still counted in the official total.'],
    ['Test',       'Written by the admin panel\'s seed button. Counted in the official total because the admin dashboard counts it, and shown separately.'],
    ['Rank',       'Equal totals share a rank. Ties are broken for display only, by contestant id ascending.'],
];

/* Insights are computed BEFORE the report builder is defined, not after.

   The builder is a closure that captures $snap by value at the moment it is defined, so a
   line that added to $snap afterwards reached the outer variable and not the copy inside
   the closure -- and the executive workbook quietly shipped with its Insights sheet
   missing. A closure capturing by value is easy to read as if it were a reference. */
$snap['_insights'] = ngd_insights($snap, $events);

$build = static function (string $report) use ($founders, $snap, $tot, $meta, $events, $range, $defs, $only): array {
    $daily = $snap['daily'] ?? [];
    switch ($report) {
        case 'leaderboard':
            $rows = [];
            foreach ($founders as $f) {
                $rows[] = [$f['rank'] ?? '', $f['name'], $f['company'], $f['points'],
                           $f['voters'], $f['standard'] ?? '', $f['bonus'] ?? '',
                           $f['verified'] ?? '', $f['unverified'] ?? '', $f['test'] ?? '',
                           $f['today'] ?? '', $f['yesterday'] ?? '',
                           $f['share_pct'] . '%', $f['rank_move'] ?? '', $f['id']];
            }
            return ['founder-leaderboard', [[
                'Founder leaderboard',
                ['Rank', 'Founder', 'Company', 'Total points', 'Unique voters', 'Standard',
                 'Bonus', 'Verified', 'Unverified', 'Test', 'Today', 'Yesterday',
                 'Share of all points', 'Places moved since yesterday', 'Contestant id'],
                $rows, $defs,
            ]]];

        case 'founder':
            $one = null;
            foreach ($founders as $f) {
                if ($f['id'] === $only) {
                    $one = $f;
                }
            }
            if ($one === null) {
                return ['founder', [['Founder', ['Note'], [['No contestant was selected.']], []]]];
            }
            $head = [
                ['Founder',            $one['name']],
                ['Company',            $one['company']],
                ['Contestant id',      $one['id']],
                ['Current rank',       (string) ($one['rank'] ?? '')],
                ['Total points',       (string) $one['points']],
                ['Unique supporters',  (string) $one['voters']],
                ['Standard points',    (string) ($one['standard'] ?? '')],
                ['Bonus points',       (string) ($one['bonus'] ?? '')],
                ['Points today',       (string) ($one['today'] ?? '')],
                ['Points yesterday',   (string) ($one['yesterday'] ?? '')],
                ['Share of all points', $one['share_pct'] . '%'],
                ['First point',        (string) ($one['first_point_et'] ?? '')],
                ['Most recent point',  (string) ($one['last_point_et'] ?? '')],
                [''],
            ];
            $rows = [];
            $trend = $one['trend'] ?? [];
            foreach ($daily as $i => $d) {
                $rows[] = [$d['day'], $d['weekday'], $trend[$i] ?? 0, $d['points'],
                           $d['points'] > 0 ? round(($trend[$i] ?? 0) / $d['points'] * 100, 1) . '%' : '0%'];
            }
            return ['founder-' . $one['id'], [[
                'Founder performance',
                ['Day', 'Weekday', 'Their points', 'All points that day', 'Their share of the day'],
                $rows, array_merge($head, $defs),
            ]]];

        case 'daily':
            $rows = [];
            foreach ($daily as $d) {
                $rows[] = [$d['day'], $d['weekday'], $d['points'], $d['voters'], $d['standard'],
                           $d['bonus'], $d['verified'], $d['unverified'], $d['test'],
                           $d['cumulative'], $d['top']['name'] ?? '', $d['top']['points'] ?? '',
                           $d['is_today'] ? 'still open' : 'complete'];
            }
            $hrows = [];
            foreach (($snap['hourly'] ?? []) as $h) {
                $hrows[] = [ngd_hour_label((int) $h['hour']), $h['points'], $h['share_pct'] . '%'];
            }
            return ['voting-activity', [
                ['Daily activity',
                 ['Day', 'Weekday', 'Points', 'Unique voters', 'Standard', 'Bonus', 'Verified',
                  'Unverified', 'Test', 'Cumulative', 'Day leader', 'Leader points', 'Status'],
                 $rows, $defs],
                ['Hourly pattern', ['Hour (Eastern)', 'Points', 'Share'], $hrows,
                 [[''], ['Note', 'Every point across the whole competition, bucketed by the Eastern hour it was cast in.']]],
            ]];

        case 'hourly':
            $rows = [];
            $head = ['Day'];
            for ($h = 0; $h < 24; $h++) {
                $head[] = ngd_hour_label($h);
            }
            foreach (($snap['heatmap'] ?? []) as $r) {
                $rows[] = array_merge([$r['day']], $r['hours']);
            }
            return ['hourly-heatmap', [['Points by day and Eastern hour', $head, $rows, $defs]]];

        case 'ranks':
            $ids = array_column($founders, 'id');
            $names = [];
            foreach ($founders as $f) {
                $names[$f['id']] = $f['name'];
            }
            $head = ['Day'];
            foreach ($ids as $id) {
                $head[] = $names[$id];
            }
            $rows = [];
            foreach (($snap['rank_history'] ?? []) as $h) {
                $row = [$h['day']];
                foreach ($ids as $id) {
                    $row[] = $h['rank'][$id] ?? '';
                }
                $rows[] = $row;
            }
            return ['rank-movement', [['Day-end rank by founder', $head, $rows, [
                [''],
                ['Note', 'Rebuilt from each vote row\'s own timestamp using today\'s validity flags. '
                       . 'No ranking was recorded at the time, so this is a reconstruction, not an archive.'],
            ]]]];

        case 'bonus':
            $rows = [];
            foreach ($daily as $d) {
                $rows[] = [$d['day'], $d['standard'], $d['bonus'], $d['points'],
                           $d['points'] > 0 ? round($d['bonus'] / $d['points'] * 100, 1) . '%' : '0%'];
            }
            $per = [];
            foreach ($founders as $f) {
                $per[] = [$f['name'], $f['company'], $f['standard'] ?? '', $f['bonus'] ?? '',
                          $f['points'], ($f['points'] > 0 && isset($f['bonus']))
                              ? round($f['bonus'] / $f['points'] * 100, 1) . '%' : ''];
            }
            return ['registration-bonus', [
                ['Bonus points by day', ['Day', 'Standard', 'Bonus', 'Total', 'Bonus share'], $rows, $defs],
                ['Bonus points by founder',
                 ['Founder', 'Company', 'Standard', 'Bonus', 'Total', 'Bonus share'], $per, []],
            ]];

        case 'traffic':
            $t = $snap['traffic'] ?? [];
            $byE = [];
            $names = [];
            foreach ($founders as $f) {
                $names[$f['id']] = $f;
            }
            foreach (($t['by_entrant'] ?? []) as $id => $v) {
                $f = $names[$id] ?? null;
                $byE[] = [$f['name'] ?? $id, $f['company'] ?? '', $v['visits'], $v['uniques'],
                          $f['points'] ?? '', ($v['uniques'] > 0 && isset($f['voters']))
                              ? round($f['voters'] / $v['uniques'] * 100, 1) . '%' : ''];
            }
            $bySrc = [];
            foreach (($t['by_source'] ?? []) as $r) {
                $bySrc[] = [$r['source'], $r['visits'], $r['uniques']];
            }
            $evRows = [];
            foreach (($events['by_page'] ?? []) as $r) {
                $evRows[] = [$r['page'], $r['views'], $r['visitors']];
            }
            $sheets = [
                ['Contestant page visits',
                 ['Founder', 'Company', 'Visits', 'Approx. unique visitors', 'Their points', 'Visitor-to-voter'],
                 $byE,
                 [[''], ['Coverage', (string) ($t['coverage'] ?? '')]]],
                ['Visits by source', ['Source', 'Visits', 'Approx. unique visitors'], $bySrc, []],
            ];
            if ($evRows) {
                $sheets[] = ['Page views (collector)', ['Page', 'Views', 'Unique visitors'], $evRows,
                             [[''], ['Note', (string) ($events['note'] ?? '')]]];
            }
            return ['traffic-sources', $sheets];

        case 'conversions':
            $k = $events['kinds'] ?? [];
            $steps = [
                ['Page view',              'page_view'],
                ['Founder opened',         'founder_open'],
                ['Vote started',           'vote_start'],
                ['Verification opened',    'verify_open'],
                ['Code verified',          'otp_verified'],
                ['Vote confirmed',         'vote_confirmed'],
                ['Ticket link clicked',    'ticket_cta'],
                ['Ticket page viewed',     'tickets_view'],
                ['Checkout opened',        'checkout_open'],
            ];
            $rows = [];
            $firstVisitors = null;
            foreach ($steps as [$label, $kind]) {
                $ev = (int) ($k[$kind]['events'] ?? 0);
                $vi = (int) ($k[$kind]['visitors'] ?? 0);
                $firstVisitors ??= ($vi > 0 ? $vi : null);
                $rows[] = [$label, $ev, $vi,
                           ($firstVisitors && $firstVisitors > 0) ? round($vi / $firstVisitors * 100, 1) . '%' : ''];
            }
            $rows[] = ['Confirmed ticket order', 'not available', 'not available', ''];
            return ['conversion-funnel', [[
                'Conversion funnel',
                ['Step', 'Events', 'Unique visitors', 'Share of first step'],
                $rows,
                [
                    [''],
                    ['Collection', !empty($events['collecting'])
                        ? 'Collected since ' . (string) ($events['since'] ?? '')
                        : 'NOT COLLECTED. No funnel events exist for this period, so every figure above is zero '
                          . 'because nothing was measured, not because nothing happened.'],
                    ['Confirmed orders', 'Deliberately blank. A click is not a purchase. Confirmed orders require '
                        . 'Eventbrite order data, which this dashboard does not yet read, and will never infer.'],
                    ['Attribution', 'A step is counted against a visitor token that lasts one Eastern day. A journey '
                        . 'spanning midnight appears as two visitors, which understates conversion rather than '
                        . 'overstating it.'],
                ],
            ]]];

        case 'executive':
        default:
            /* The figures for the period the file claims to cover. ngd_range() returns the
               same shape for a custom window; the all-time totals are used when none was
               asked for. Everything printed below comes from this one object. */
            $m = ($range !== null && !empty($range['ok'])) ? $range : $tot;
            $wholeCompetition = ($range === null || empty($range['ok']));
            $rows = [
                /* These come from $m, which is the range when one was asked for and the whole
                   competition otherwise -- the SAME object the provenance block above names as the
                   reporting period.
                
                   They used to come from $tot unconditionally while the header printed the range, so
                   a one-day export carried the entire competition's totals under a one-day heading,
                   next to a Top-ten sheet that HAD been range-scoped. One spreadsheet asserting two
                   different totals is worse than one that is simply wrong, because the share column
                   is then a percentage of a denominator that is not on the page. */
                ['Valid voting points (admin definition)', (string) ($m['points'] ?? 0)],
                ['Public standings total (simulated = 0)',  (string) ($m['verified'] ?? $m['points_public'] ?? 0)],
                ['Verified voting identities', (string) ($m['voters'] ?? 0)],
                ['Standard points',            (string) ($m['standard'] ?? 0)],
                ['Registration points (slot 2-3)', (string) ($m['bonus'] ?? 0)],
                ['Unverified points',          (string) ($m['unverified'] ?? 0)],
                ['Test points included',       (string) ($m['test'] ?? 0)],
                ['Invalidated points excluded', (string) ($m['invalid'] ?? 0)],
                ['Days with voting in this period', (string) ($m['days'] ?? $tot['days_active'] ?? 0)],
                ['Voting opened',              (string) ($tot['launch_et'] ?? '')],
                ['Most recent point',          (string) ($tot['last_point_et'] ?? '')],
                ['Busiest hour (Eastern)',     isset($tot['peak_hour']) && $tot['peak_hour'] !== null
                                                 ? ngd_hour_label((int) $tot['peak_hour']) : ''],
                ['Voting closes',              (string) ($snap['rules']['deadline'] ?? '')],
                ['Rule in force',              'mode ' . (string) ($snap['rules']['mode'] ?? '')
                                                 . ', ' . (string) ($snap['rules']['daily_public'] ?? '')
                                                 . ' point a day for the public, '
                                                 . (string) ($snap['rules']['daily_ticket'] ?? '')
                                                 . ' for a verified attendee'],
            ];
            $lead = [];
            foreach (array_slice($founders, 0, 10) as $f) {
                $lead[] = [$f['rank'] ?? '', $f['name'], $f['company'], $f['points'], $f['voters'],
                           $f['share_pct'] . '%', $f['today'] ?? ''];
            }
            $ins = [];
            foreach (($snap['_insights'] ?? []) as $i) {
                $ins[] = [$i['headline'], $i['evidence'], $i['action']];
            }
            $sheets = [
                ['Executive summary', ['Measure', 'Value'], $rows, $defs],
                ['Top ten', ['Rank', 'Founder', 'Company', 'Points', 'Voters', 'Share', 'Today'], $lead, []],
            ];
            if ($ins) {
                $sheets[] = ['Insights', ['Finding', 'Evidence', 'Recommendation'], $ins, []];
            }
            return ['executive-summary', $sheets];
    }
};

/* The three reports that carry an address take a different road: a second permission
   check, a different builder, and no PDF. Everything else is a count and goes to anyone
   who can open the dashboard. */
const NGD_EMAIL_REPORTS = ['voters', 'founder-voters', 'voter-pairs',
                           'voters-registered', 'voters-unregistered',
                           'voters-unknown', 'voters-threepoint'];
$rowsOut = 0;
$carriesEmails = in_array($report, NGD_EMAIL_REPORTS, true);

if ($carriesEmails) {
    if (!ngd_can('emails', $me)) {
        http_response_code(403);
        header('Content-Type: text/plain; charset=utf-8');
        echo "Refused.

This export contains real voter email addresses, which is a separate
"
           . "permission from reading the dashboard. Ask the owner to grant it to your
"
           . "account in Settings. Every count and chart stays available to you either way.
";
        error_log('NextGen Data: ' . (string) ($me['user'] ?? '?')
                . ' was refused the ' . $report . ' email export.');
        exit;
    }
    if ($format === 'pdf') {
        http_response_code(400);
        header('Content-Type: text/plain; charset=utf-8');
        echo "Not available as a PDF.

A PDF of a few thousand addresses is a bad spreadsheet
"
           . "and a worse privacy decision. Use CSV or Excel.
";
        exit;
    }
    $built = ngd_voter_export($report, $source, $only, $from, $to);
    $stem = $built['stem'];
    $sheets = $built['sheets'];
    $rowsOut = (int) $built['rows'];
} else {
    [$stem, $sheets] = $build($report);
    foreach ($sheets as $sh) {
        $rowsOut += count($sh[2] ?? []);
    }
}

/* Who took what, and how much of it. Never which addresses. */
ngd_log_export($report, $format, $rowsOut, $carriesEmails);
$prov = ngd_provenance($meta, $tot, $period, $source, $events);
$stamp = (new DateTime('now', ngd_tz()))->format('Y-m-d-Hi');
$base  = 'nextgen-' . $stem . '-' . $stamp;

/* ---------------------------------------------------------------------------
   CSV
   ------------------------------------------------------------------------ */

function ngd_cell($v): string
{
    $s = (string) $v;
    if ($s !== '' && strpos("=+-@\t\r", $s[0]) !== false) {
        $s = "'" . $s;                 // inert in Excel and Google Sheets alike
    }
    return '"' . str_replace('"', '""', $s) . '"';
}

if ($format === 'csv' || ($format === 'xlsx' && !class_exists('ZipArchive'))) {
    $name = $base . ($format === 'xlsx' ? '-csv-fallback' : '') . '.csv';
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $name . '"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF");      // BOM, so Excel reads UTF-8 names correctly
    $line = static function (array $r) use ($out): void {
        fwrite($out, implode(',', array_map('ngd_cell', $r)) . "\r\n");
    };
    foreach ($prov as $r) {
        $line($r);
    }
    foreach ($sheets as [$title, $head, $rows, $notes]) {
        $line([$title]);
        $line($head);
        foreach ($rows as $r) {
            $line($r);
        }
        foreach ($notes as $r) {
            $line($r);
        }
        $line(['']);
    }
    fclose($out);
    exit;
}

/* ---------------------------------------------------------------------------
   XLSX — what the format actually is: a zip of XML parts. One sheet per block,
   inline strings so no shared-string table is needed, and a two-style stylesheet
   so the header row is bold.
   ------------------------------------------------------------------------ */

if ($format === 'xlsx') {
    $x = static fn($s) => htmlspecialchars((string) $s, ENT_QUOTES | ENT_XML1, 'UTF-8');
    $col = static function (int $i): string {
        $s = '';
        $i++;
        while ($i > 0) {
            $m = ($i - 1) % 26;
            $s = chr(65 + $m) . $s;
            $i = (int) (($i - $m - 1) / 26);
        }
        return $s;
    };

    $sheetXml = static function (array $head, array $rows, array $lead, array $notes) use ($x, $col): string {
        $r = 0;
        $body = '';
        $emit = static function (array $cells, bool $bold) use (&$r, &$body, $x, $col): void {
            $r++;
            $body .= '<row r="' . $r . '">';
            foreach (array_values($cells) as $i => $v) {
                if ($v === null || $v === '') {
                    continue;
                }
                $ref = $col($i) . $r;
                if (is_int($v) || is_float($v)) {
                    $body .= '<c r="' . $ref . '"' . ($bold ? ' s="1"' : '') . '><v>' . $v . '</v></c>';
                } else {
                    $s = (string) $v;
                    if ($s !== '' && strpos("=+-@\t\r", $s[0]) !== false) {
                        $s = "'" . $s;
                    }
                    $body .= '<c r="' . $ref . '" t="inlineStr"' . ($bold ? ' s="1"' : '')
                           . '><is><t xml:space="preserve">' . $x($s) . '</t></is></c>';
                }
            }
            $body .= '</row>';
        };
        foreach ($lead as $row) {
            $emit($row, false);
        }
        $emit($head, true);
        foreach ($rows as $row) {
            $emit($row, false);
        }
        foreach ($notes as $row) {
            $emit($row, false);
        }
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
             . '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
             . '<sheetData>' . $body . '</sheetData></worksheet>';
    };

    $tmp = tempnam(sys_get_temp_dir(), 'ngd');
    $zip = new ZipArchive();
    if ($tmp === false || $zip->open($tmp, ZipArchive::OVERWRITE) !== true) {
        http_response_code(500);
        header('Content-Type: text/plain; charset=utf-8');
        echo "The spreadsheet could not be assembled on this server. Try the CSV export.\n";
        exit;
    }

    $names = [];
    $i = 0;
    foreach ($sheets as [$title]) {
        $i++;
        /* Excel sheet names: 31 characters, and none of : \ / ? * [ ] */
        $t = preg_replace('#[:\\\\/?*\[\]]#', ' ', (string) $title) ?? ('Sheet' . $i);
        $names[] = substr(trim($t) === '' ? 'Sheet' . $i : trim($t), 0, 31);
    }

    $ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        . '<Default Extension="xml" ContentType="application/xml"/>'
        . '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        . '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
    for ($s = 1; $s <= count($sheets); $s++) {
        $ct .= '<Override PartName="/xl/worksheets/sheet' . $s . '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    }
    $ct .= '</Types>';
    $zip->addFromString('[Content_Types].xml', $ct);

    $zip->addFromString('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        . '</Relationships>');

    $wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
        . ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>';
    $rel = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    foreach ($names as $n => $nm) {
        $id = $n + 1;
        $wb  .= '<sheet name="' . $x($nm) . '" sheetId="' . $id . '" r:id="rId' . $id . '"/>';
        $rel .= '<Relationship Id="rId' . $id . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' . $id . '.xml"/>';
    }
    $styleId = count($names) + 1;
    $wb  .= '</sheets></workbook>';
    $rel .= '<Relationship Id="rId' . $styleId . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    $zip->addFromString('xl/workbook.xml', $wb);
    $zip->addFromString('xl/_rels/workbook.xml.rels', $rel);

    $zip->addFromString('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        . '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
        . '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
        . '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
        . '<borders count="1"><border/></borders>'
        . '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        . '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        . '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
        . '</styleSheet>');

    foreach ($sheets as $n => [$title, $head, $rows, $notes]) {
        $lead = $n === 0 ? $prov : [[$title], ['']];
        $zip->addFromString('xl/worksheets/sheet' . ($n + 1) . '.xml',
                            $sheetXml($head, $rows, $lead, $notes));
    }
    $zip->close();

    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Disposition: attachment; filename="' . $base . '.xlsx"');
    header('Content-Length: ' . (string) filesize($tmp));
    readfile($tmp);
    @unlink($tmp);
    exit;
}

/* ---------------------------------------------------------------------------
   PDF — a leadership one-pager, written by hand.

   No library on shared hosting, so this writes the file itself: a catalog, a page
   tree, two of the fourteen standard faces every reader has built in, and an
   uncompressed content stream per page. Text only, with rules and bars drawn as
   filled rectangles, which is all a summary needs and keeps the writer small enough
   to read in one sitting.

   Two details that bite anyone writing a PDF by hand: the xref table holds absolute
   byte offsets, so the objects have to be serialised before the table can be built;
   and ( ) and backslash are structural inside a text string and must be escaped.
   ------------------------------------------------------------------------ */

final class NgdPdf
{
    private const W = 595.28;        // A4 portrait, points
    private const H = 841.89;
    private const M = 44.0;

    private array $pages = [];
    private string $buf = '';
    private float $y = 0.0;

    public function __construct()
    {
        $this->newPage();
    }

    private function newPage(): void
    {
        if ($this->buf !== '') {
            $this->pages[] = $this->buf;
        }
        $this->buf = '';
        $this->y = self::H - self::M;
    }

    private function room(float $need): void
    {
        if ($this->y - $need < self::M + 22) {
            $this->newPage();
        }
    }

    /** WinAnsi-safe, and a name is never silently mangled.
     *
     * The standard PDF faces have no glyph for a curly quote or an em dash, so those fold to
     * their ASCII cousins. Accented LETTERS are a different matter: the first version deleted
     * every non-ASCII byte, which turned a real semifinalist's name into a misspelling inside
     * a leadership report. Dropping a letter from somebody's name is not a rendering
     * compromise, it is getting their name wrong.
     *
     * The explicit table goes first and iconv is only a fallback, which is the opposite of
     * the obvious order and was decided by measurement: iconv's //TRANSLIT is
     * implementation-dependent, and the libiconv build on this platform renders e-acute as
     * "'e" and n-tilde as "~n". "Jos'e Mu~noz" in a board pack is worse than "Jose Munoz",
     * and both are worse than being right. So the table wins, iconv sees only what the table
     * did not know, and its answer is rejected if it put punctuation where a letter was.
     */
    private static function flat(string $s): string
    {
        $s = strtr($s, [
            "\u{2014}" => '-', "\u{2013}" => '-', "\u{2019}" => "'", "\u{2018}" => "'",
            "\u{201C}" => '"', "\u{201D}" => '"', "\u{2026}" => '...', "\u{00A0}" => ' ',
        ]);

        if (preg_match('/[^\x20-\x7E]/', $s)) {
            $s = strtr($s, [
                "\u{00E1}" => 'a', "\u{00E0}" => 'a', "\u{00E2}" => 'a', "\u{00E4}" => 'a',
                "\u{00E3}" => 'a', "\u{00E5}" => 'a', "\u{0101}" => 'a',
                "\u{00E9}" => 'e', "\u{00E8}" => 'e', "\u{00EA}" => 'e', "\u{00EB}" => 'e',
                "\u{0113}" => 'e', "\u{0119}" => 'e',
                "\u{00ED}" => 'i', "\u{00EC}" => 'i', "\u{00EE}" => 'i', "\u{00EF}" => 'i',
                "\u{012B}" => 'i', "\u{0131}" => 'i',
                "\u{00F3}" => 'o', "\u{00F2}" => 'o', "\u{00F4}" => 'o', "\u{00F6}" => 'o',
                "\u{00F5}" => 'o', "\u{00F8}" => 'o', "\u{014D}" => 'o',
                "\u{00FA}" => 'u', "\u{00F9}" => 'u', "\u{00FB}" => 'u', "\u{00FC}" => 'u',
                "\u{016B}" => 'u',
                "\u{00F1}" => 'n', "\u{0144}" => 'n', "\u{00E7}" => 'c', "\u{0107}" => 'c',
                "\u{0161}" => 's', "\u{015B}" => 's', "\u{015F}" => 's',
                "\u{017E}" => 'z', "\u{017C}" => 'z', "\u{017A}" => 'z',
                "\u{00FD}" => 'y', "\u{00FF}" => 'y', "\u{0142}" => 'l', "\u{0111}" => 'd',
                "\u{011F}" => 'g',
                "\u{00C1}" => 'A', "\u{00C0}" => 'A', "\u{00C2}" => 'A', "\u{00C4}" => 'A',
                "\u{00C3}" => 'A', "\u{00C5}" => 'A',
                "\u{00C9}" => 'E', "\u{00C8}" => 'E', "\u{00CA}" => 'E', "\u{00CB}" => 'E',
                "\u{00CD}" => 'I', "\u{00CC}" => 'I', "\u{00CE}" => 'I', "\u{00CF}" => 'I',
                "\u{00D3}" => 'O', "\u{00D2}" => 'O', "\u{00D4}" => 'O', "\u{00D6}" => 'O',
                "\u{00D5}" => 'O', "\u{00D8}" => 'O',
                "\u{00DA}" => 'U', "\u{00D9}" => 'U', "\u{00DB}" => 'U', "\u{00DC}" => 'U',
                "\u{00D1}" => 'N', "\u{00C7}" => 'C', "\u{0160}" => 'S', "\u{017D}" => 'Z',
                "\u{00DD}" => 'Y', "\u{0141}" => 'L',
                "\u{00E6}" => 'ae', "\u{00C6}" => 'AE', "\u{0153}" => 'oe',
                "\u{0152}" => 'OE', "\u{00DF}" => 'ss',
            ]);

            if (preg_match('/[^\x20-\x7E]/', $s)) {
                $try = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s);
                if (is_string($try) && $try !== '' && !preg_match('/[\'"~^`]/', $try)) {
                    $s = $try;
                }
            }
            $s = (string) preg_replace('/[^\x20-\x7E]/', '', $s);
        }
        return strtr($s, ['\\' => '\\\\', '(' => '\\(', ')' => '\\)']);
    }

    /** Helvetica is close enough to 0.5em average that this wraps reliably. */
    private static function fits(string $s, float $size, float $width): array
    {
        $per = $size * 0.5;
        $max = max(8, (int) floor($width / $per));
        $out = [];
        foreach (explode("\n", $s) as $para) {
            $line = '';
            foreach (preg_split('/\s+/', trim($para)) ?: [] as $w) {
                if ($line === '') {
                    $line = $w;
                } elseif (strlen($line) + 1 + strlen($w) <= $max) {
                    $line .= ' ' . $w;
                } else {
                    $out[] = $line;
                    $line = $w;
                }
            }
            $out[] = $line;
        }
        return $out;
    }

    public function text(string $s, float $size = 10.0, bool $bold = false,
                        float $indent = 0.0, array $rgb = [0.09, 0.11, 0.14]): void
    {
        $width = self::W - 2 * self::M - $indent;
        foreach (self::fits($s, $size, $width) as $line) {
            $this->room($size * 1.5);
            $this->buf .= sprintf("BT /F%d %.1f Tf %.3f %.3f %.3f rg %.2f %.2f Td (%s) Tj ET\n",
                $bold ? 2 : 1, $size, $rgb[0], $rgb[1], $rgb[2],
                self::M + $indent, $this->y, self::flat($line));
            $this->y -= $size * 1.45;
        }
    }

    public function gap(float $h = 8.0): void
    {
        $this->y -= $h;
    }

    public function rule(array $rgb = [0.84, 0.86, 0.88]): void
    {
        $this->room(10);
        $this->buf .= sprintf("%.3f %.3f %.3f RG 0.6 w %.2f %.2f m %.2f %.2f l S\n",
            $rgb[0], $rgb[1], $rgb[2], self::M, $this->y, self::W - self::M, $this->y);
        $this->y -= 12;
    }

    /** A label on the left, a value on the right, which is what a KPI sheet is. */
    public function pair(string $k, string $v, bool $strong = false): void
    {
        $this->room(16);
        $this->buf .= sprintf("BT /F1 9.5 Tf 0.35 0.38 0.42 rg %.2f %.2f Td (%s) Tj ET\n",
            self::M, $this->y, self::flat($k));
        $vv = self::flat($v);
        $w = strlen($vv) * ($strong ? 6.1 : 4.9);
        $this->buf .= sprintf("BT /F%d %.1f Tf 0.04 0.09 0.13 rg %.2f %.2f Td (%s) Tj ET\n",
            $strong ? 2 : 1, $strong ? 11.0 : 9.5, self::W - self::M - $w, $this->y, $vv);
        $this->y -= 15;
    }

    /** A labelled bar, for a leaderboard that has to be readable at a glance. */
    public function bar(string $label, int $value, int $max, string $right): void
    {
        $this->room(20);
        $this->buf .= sprintf("BT /F1 9 Tf 0.09 0.11 0.14 rg %.2f %.2f Td (%s) Tj ET\n",
            self::M, $this->y, self::flat($label));
        $rr = self::flat($right);
        $this->buf .= sprintf("BT /F2 9 Tf 0.04 0.35 0.34 rg %.2f %.2f Td (%s) Tj ET\n",
            self::W - self::M - strlen($rr) * 5.0, $this->y, $rr);
        $this->y -= 5;
        $full = self::W - 2 * self::M;
        $w = $max > 0 ? max(1.0, $full * ($value / $max)) : 0.0;
        $this->buf .= sprintf("0.92 0.93 0.94 rg %.2f %.2f %.2f 4 re f\n", self::M, $this->y - 3, $full);
        $this->buf .= sprintf("0.12 0.78 0.75 rg %.2f %.2f %.2f 4 re f\n", self::M, $this->y - 3, $w);
        $this->y -= 14;
    }

    public function out(string $title): string
    {
        $this->pages[] = $this->buf;
        $n = count($this->pages);

        $obj = [];
        $obj[1] = "<< /Type /Catalog /Pages 2 0 R >>";
        $kids = [];
        for ($i = 0; $i < $n; $i++) {
            $kids[] = (5 + $i * 2) . ' 0 R';
        }
        $obj[2] = "<< /Type /Pages /Count $n /Kids [" . implode(' ', $kids) . "] >>";
        $obj[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
        $obj[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
        for ($i = 0; $i < $n; $i++) {
            $pid = 5 + $i * 2;
            $cid = $pid + 1;
            $obj[$pid] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 "
                . sprintf('%.2f %.2f', self::W, self::H) . "] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >>"
                . " /Contents $cid 0 R >>";
            $stream = $this->pages[$i];
            $obj[$cid] = "<< /Length " . strlen($stream) . " >>\nstream\n" . $stream . "endstream";
        }
        $info = count($obj) + 1;
        $obj[$info] = "<< /Title (" . self::flat($title) . ") /Producer (NextGen Data) >>";

        $pdf = "%PDF-1.4\n";
        $offsets = [];
        ksort($obj);
        foreach ($obj as $id => $body) {
            $offsets[$id] = strlen($pdf);
            $pdf .= "$id 0 obj\n$body\nendobj\n";
        }
        $xref = strlen($pdf);
        $count = max(array_keys($obj)) + 1;
        $pdf .= "xref\n0 $count\n0000000000 65535 f \n";
        for ($i = 1; $i < $count; $i++) {
            $pdf .= isset($offsets[$i])
                ? sprintf("%010d 00000 n \n", $offsets[$i])
                : "0000000000 65535 f \n";
        }
        $pdf .= "trailer\n<< /Size $count /Root 1 0 R /Info $info 0 R >>\nstartxref\n$xref\n%%EOF";
        return $pdf;
    }
}

$pdf = new NgdPdf();
$pdf->text('NextGen Summit 2026', 11, true, 0, [0.04, 0.48, 0.46]);
$pdf->text("People's Choice Award - " . ucfirst(str_replace('-', ' ', $stem)), 21, true);
$pdf->gap(4);
$pdf->text($period, 10, false, 0, [0.35, 0.38, 0.42]);
$pdf->rule();

foreach ($prov as $r) {
    if (count($r) === 2) {
        $pdf->pair((string) $r[0], (string) $r[1]);
    }
}
$pdf->rule();

if (($meta['stale'] ?? false) === true) {
    $pdf->text('STALE DATA. The live source could not be re-read when this report was generated. '
        . 'Every figure below is as at the "data read at" time above.', 10, true, 0, [0.70, 0.15, 0.15]);
    $pdf->gap(6);
}

foreach ($sheets as [$title, $head, $rows, $notes]) {
    $pdf->gap(8);
    $pdf->text(strtoupper($title), 9, true, 0, [0.04, 0.48, 0.46]);
    $pdf->gap(4);

    $isPairs = count($head) === 2 && ($head[0] === 'Measure' || $head[0] === 'Finding');
    if ($isPairs && $head[0] === 'Measure') {
        foreach ($rows as $r) {
            $pdf->pair((string) ($r[0] ?? ''), (string) ($r[1] ?? ''), true);
        }
    } elseif ($head[0] === 'Finding') {
        foreach ($rows as $r) {
            $pdf->text((string) ($r[0] ?? ''), 11, true);
            $pdf->text((string) ($r[1] ?? ''), 9.5, false, 10, [0.30, 0.33, 0.37]);
            $pdf->text('-> ' . (string) ($r[2] ?? ''), 9.5, false, 10, [0.04, 0.42, 0.40]);
            $pdf->gap(6);
        }
    } elseif (in_array('Points', $head, true) || in_array('Total points', $head, true)) {
        $vi = array_search('Total points', $head, true);
        $vi = $vi === false ? array_search('Points', $head, true) : $vi;
        $ni = array_search('Founder', $head, true);
        $ni = $ni === false ? 1 : $ni;
        $max = 0;
        foreach ($rows as $r) {
            $max = max($max, (int) ($r[$vi] ?? 0));
        }
        foreach (array_slice($rows, 0, 24) as $r) {
            $pdf->bar(trim(($r[0] ?? '') . '  ' . ($r[$ni] ?? '')), (int) ($r[$vi] ?? 0), $max,
                      (string) ($r[$vi] ?? 0) . ' pts');
        }
        if (count($rows) > 24) {
            $pdf->text('(' . (count($rows) - 24) . ' more rows in the CSV and Excel versions)',
                       8.5, false, 0, [0.5, 0.52, 0.55]);
        }
    } else {
        $pdf->text(implode('   |   ', array_map('strval', $head)), 8.5, true, 0, [0.35, 0.38, 0.42]);
        foreach (array_slice($rows, 0, 30) as $r) {
            $pdf->text(implode('   |   ', array_map('strval', $r)), 8.5);
        }
        if (count($rows) > 30) {
            $pdf->text('(' . (count($rows) - 30) . ' more rows in the CSV and Excel versions)',
                       8.5, false, 0, [0.5, 0.52, 0.55]);
        }
    }

    foreach ($notes as $r) {
        if (count($r) === 2) {
            $pdf->gap(3);
            $pdf->text((string) $r[0] . ': ' . (string) $r[1], 8.5, false, 0, [0.40, 0.43, 0.47]);
        }
    }
}

$pdf->gap(10);
$pdf->rule();
$pdf->text('Generated by NextGen Data from read-only production records. Contains no voter email '
    . 'addresses, phone numbers or identifiers. A click is never reported as a purchase.',
    8.5, false, 0, [0.45, 0.48, 0.52]);

$body = $pdf->out('NextGen Data - ' . $stem);
header('Content-Type: application/pdf');
header('Content-Disposition: attachment; filename="' . $base . '.pdf"');
header('Content-Length: ' . (string) strlen($body));
echo $body;
