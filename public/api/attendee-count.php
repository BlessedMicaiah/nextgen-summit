<?php
/* Next Gen Summit: how many people hold a ticket, straight from Eventbrite.
   Answers {"count": N}, plus totals per state and opted-in first names (below). No emails,
   addresses, orders, full names or credentials ever leave this file.

   Source of truth: Eventbrite's attendee list for the event, filtered to status=attending.
   Eventbrite keeps one attendee record per ticket (each with quantity 1), whatever the ticket
   type: a group order of three is three records, a claimed scholarship ticket is one. So the
   count is records, never orders, and nothing is multiplied. Eventbrite's three filters split
   every record: attending (counted), not_attending (cancelled, refunded, deleted or
   transferred away) and unpaid (awaiting offline payment); only the first is counted.
   Its pagination reports object_count (the total across all pages), so one small request
   gives the whole count. If that field is ever missing, every page is walked instead.

   The result is cached for a few seconds in the private data folder, so visitors polling
   the homepage never hit Eventbrite more than about four times a minute in total. If
   Eventbrite is unreachable the last good count is served; with none, {"count": null}.

   Where people are coming from: once a snapshot exists the reply also carries
   "states": [["MD", 84], ["VA", 12], ...] (most first) and "unknown": n. Those are totals per
   state and nothing else; no attendee's answer, name or address ever leaves this file.
   A state is read from the attendee's answer to a "State" question on the Eventbrite order form
   (NGS_EB_STATE_QUESTION in config.php pins its id; otherwise any question with "state" in it),
   then from Eventbrite's built-in home address. Anything outside the US counts as "INTL", and
   anything missing or unrecognised as unknown. Building it means walking every attendee page,
   so it has its own cache, refreshed at most every five minutes, after the reply has been
   sent whenever the server allows it.

   Who's coming: the same walk collects "names": ["Maya R.", ...], each name once, newest
   registration first, at most NGS_EB_NAMES_MAX. A name is listed ONLY when that attendee
   answered yes to the opt-in question on the Eventbrite order form ("Show my first name on
   the NextGen website?"; NGS_EB_NAMES_QUESTION in config.php pins its id, otherwise a
   question asking to show or display a name on a website). Only the first name and the first
   letter of the last name are kept, cleaned to letters, hyphens, apostrophes and spaces;
   anything else is left out, and anything uncertain is left out too -- see
   ngs_eb_attendee_opted_in().

   That check was commented out on 2026-10-09 and marked TEMPORARY, and for the sixteen days
   that followed this endpoint published the name of every attending person regardless. It was
   restored on 2026-10-25. If the order form carries no such question then nobody opts in, no
   "names" key is sent at all, and the count and per-state totals carry on unaffected -- they
   are totals over people and name nobody.

   Setting NGS_EB_PUBLIC_NAMES to false in config.php turns the list off outright. */
declare(strict_types=1);

require __DIR__ . '/_lib.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Robots-Tag: noindex');
header('Cache-Control: no-store');

/* NGS_EB_EVENT_ID now comes from _lib.php, required above, so the bonus path sees it too. */
const NGS_EB_TTL = 15;              // seconds a count is considered fresh
const NGS_EB_KEEP = 86400;          // how long a last good count may stand in during an outage
const NGS_EB_STATES_TTL = 300;      // seconds a per-state snapshot is considered fresh
const NGS_EB_MAX_PAGES = 60;        // a walk reads at most this many pages of 50 (3,000 attendees)
const NGS_EB_NAMES_MAX = 600;       // distinct names sent, newest first (everyone, at this event's size)

/** The JSON reply: the count, and the per-state totals and opted-in names when there is a snapshot. Does not exit. */
function ngs_eb_send(?int $count, ?array $states = null, int $status = 200): void
{
    $out = ['count' => $count];
    if ($count !== null && $states !== null && isset($states['states'], $states['unknown'])) {
        $out['states'] = $states['states'];
        $out['unknown'] = $states['unknown'];
        /* Empty means nobody agreed, and the right way to say that is to say nothing:
           an empty "names" key reads to a client like a list that failed to load. */
        if (!empty($states['names']) && is_array($states['names'])) {
            $out['names'] = $states['names'];
        }
    }
    http_response_code($status);
    echo json_encode($out);
}

function ngs_eb_reply(?int $count, int $status = 200): void
{
    ngs_eb_send($count, null, $status);
    exit;
}

function ngs_eb_token(): string
{
    if (defined('NGS_EVENTBRITE_TOKEN')) {
        return trim((string) constant('NGS_EVENTBRITE_TOKEN'));
    }
    return trim((string) getenv('EVENTBRITE_TOKEN'));
}

/** One authenticated GET against the Eventbrite API; returns the decoded JSON or throws. */
function ngs_eb_get(string $url, string $token): array
{
    $headers = ['Authorization: Bearer ' . $token, 'Accept: application/json'];
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_TIMEOUT => 8,
        ]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($body === false) {
            throw new RuntimeException('Eventbrite request failed: ' . $err);
        }
    } else {
        $ctx = stream_context_create(['http' => ['header' => implode("\r\n", $headers), 'timeout' => 8, 'ignore_errors' => true]]);
        $body = @file_get_contents($url, false, $ctx);
        $code = 0;
        foreach ($http_response_header ?? [] as $h) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) {
                $code = (int) $m[1];
            }
        }
        if ($body === false) {
            throw new RuntimeException('Eventbrite request failed.');
        }
    }
    if ($code !== 200) {
        throw new RuntimeException('Eventbrite answered HTTP ' . $code . '.');
    }
    $data = json_decode((string) $body, true);
    if (!is_array($data)) {
        throw new RuntimeException('Eventbrite sent something that is not JSON.');
    }
    return $data;
}

/** Tickets currently held for the event. $get fetches a URL and returns decoded JSON. */
function ngs_eb_count(callable $get): int
{
    $base = 'https://www.eventbriteapi.com/v3/events/' . NGS_EB_EVENT_ID . '/attendees/?status=attending';
    $page = $get($base);
    $p = is_array($page['pagination'] ?? null) ? $page['pagination'] : [];
    if (isset($p['object_count']) && is_int($p['object_count']) && $p['object_count'] >= 0) {
        return $p['object_count'];
    }
    // no total reported: walk every page and count the records themselves, one person each
    $count = 0;
    for ($i = 0; $i < 400; $i++) {
        foreach (($page['attendees'] ?? []) as $a) {
            if (!is_array($a) || !empty($a['cancelled']) || !empty($a['refunded'])) {
                continue;
            }
            $count++;
        }
        $p = is_array($page['pagination'] ?? null) ? $page['pagination'] : [];
        if (empty($p['has_more_items']) || empty($p['continuation'])) {
            return $count;
        }
        $page = $get($base . '&continuation=' . rawurlencode((string) $p['continuation']));
    }
    throw new RuntimeException('Eventbrite attendee list did not end.');
}

/** USPS code for a US state, DC or territory, from a code or a name in any case; null if it is not one. */
function ngs_us_state(string $raw): ?string
{
    static $names = [
    'alabama' => 'AL',
    'alaska' => 'AK',
    'arizona' => 'AZ',
    'arkansas' => 'AR',
    'california' => 'CA',
    'colorado' => 'CO',
    'connecticut' => 'CT',
    'delaware' => 'DE',
    'florida' => 'FL',
    'georgia' => 'GA',
    'hawaii' => 'HI',
    'idaho' => 'ID',
    'illinois' => 'IL',
    'indiana' => 'IN',
    'iowa' => 'IA',
    'kansas' => 'KS',
    'kentucky' => 'KY',
    'louisiana' => 'LA',
    'maine' => 'ME',
    'maryland' => 'MD',
    'massachusetts' => 'MA',
    'michigan' => 'MI',
    'minnesota' => 'MN',
    'mississippi' => 'MS',
    'missouri' => 'MO',
    'montana' => 'MT',
    'nebraska' => 'NE',
    'nevada' => 'NV',
    'new hampshire' => 'NH',
    'new jersey' => 'NJ',
    'new mexico' => 'NM',
    'new york' => 'NY',
    'north carolina' => 'NC',
    'north dakota' => 'ND',
    'ohio' => 'OH',
    'oklahoma' => 'OK',
    'oregon' => 'OR',
    'pennsylvania' => 'PA',
    'rhode island' => 'RI',
    'south carolina' => 'SC',
    'south dakota' => 'SD',
    'tennessee' => 'TN',
    'texas' => 'TX',
    'utah' => 'UT',
    'vermont' => 'VT',
    'virginia' => 'VA',
    'washington' => 'WA',
    'west virginia' => 'WV',
    'wisconsin' => 'WI',
    'wyoming' => 'WY',
    'district of columbia' => 'DC',
    'washington dc' => 'DC',
    'washington d c' => 'DC',
    'd c' => 'DC',
    'puerto rico' => 'PR',
    'guam' => 'GU',
    'us virgin islands' => 'VI',
    'u s virgin islands' => 'VI',
    'virgin islands' => 'VI',
    'american samoa' => 'AS',
    'northern mariana islands' => 'MP',
    ];
    $k = strtolower(trim((string) preg_replace('/[^A-Za-z]+/', ' ', $raw)));
    if ($k === '') {
        return null;
    }
    if (isset($names[$k])) {
        return $names[$k];
    }
    if (strlen($k) === 2 && in_array(strtoupper($k), $names, true)) {
        return strtoupper($k);
    }
    return null;
}

/** Where one attendee record says they are from: a USPS code, 'INTL' outside the US, or '' if not given. */
function ngs_eb_attendee_state(array $a, string $questionId = ''): string
{
    // 1. their answer to a State question on the order form
    foreach (($a['answers'] ?? []) as $ans) {
        if (!is_array($ans)) {
            continue;
        }
        $mine = $questionId !== ''
            ? (string) ($ans['question_id'] ?? '') === $questionId
            : (bool) preg_match('/\bstate\b/i', (string) ($ans['question'] ?? ''));
        if (!$mine) {
            continue;
        }
        $text = trim((string) ($ans['answer'] ?? ''));
        if (preg_match('/^(outside|not in) (of )?(the )?(us|u\.s\.?|usa|united states)\b|^international$/i', $text)) {
            return 'INTL';
        }
        $code = ngs_us_state($text);
        if ($code !== null) {
            return $code;
        }
        break;                                                 // blank or unrecognised: try the address
    }
    // 2. Eventbrite's built-in home address, if the order form collects it
    $home = $a['profile']['addresses']['home'] ?? null;
    if (is_array($home)) {
        $country = strtoupper(trim((string) ($home['country'] ?? '')));
        if ($country !== '' && $country !== 'US') {
            return 'INTL';
        }
        $code = ngs_us_state((string) ($home['region'] ?? ''));
        if ($code !== null) {
            return $code;
        }
    }
    return '';
}

/* Is a name allowed to appear on the public website?

   RESTORED 2026-10-25, after sixteen days switched off.

   On 2026-10-09 this check was commented out and marked TEMPORARY, and from that moment the
   endpoint published the first name and last initial of every attending person -- 228 of them
   on the live site -- whether or not they had agreed to it. The comment left behind said
   exactly how to put it back, which is what this is.

   IT FAILS CLOSED, IN EVERY DIRECTION

   A name is published only when this function can point at a specific answer, from a specific
   question, that positively says yes. Every other outcome is a no:

     - the attendee has no answers at all              -> no
     - the question is not among their answers         -> no
     - the answer is blank, "No", or anything unclear  -> no
     - the question id is not configured AND no question text looks like the right one -> no
     - the Eventbrite payload is shaped unexpectedly   -> no

   That last group matters most. The previous failure was not that somebody chose to publish
   names; it was that the absence of a check read as permission. Absence now reads as refusal,
   so if the opt-in question is ever removed from the order form, or renamed, or the id in
   config.php stops matching, the list goes quiet by itself rather than opening up by itself.

   WHAT THE OWNER WILL SEE

   If no attendee opts in -- which is what happens when the order form has no such question --
   the public reply carries no "names" key at all, and the count and the per-state totals are
   unaffected. Those are aggregates over people and carry nobody's identity. The snapshot
   written to the private data folder records how many were considered and how many agreed, so
   the gap between the two is visible to whoever is allowed to look, without being published.
*/
function ngs_eb_attendee_opted_in(array $a, string $questionId = ''): bool
{
    $answers = $a['answers'] ?? null;
    if (!is_array($answers) || !$answers) {
        return false;                       // nothing to consent with
    }
    foreach ($answers as $ans) {
        if (!is_array($ans)) {
            continue;
        }
        if ($questionId !== '') {
            /* An id was pinned in config.php: only that question counts. Nothing is inferred
               from question text, because a second question that merely mentions a name and a
               website would otherwise be able to stand in for consent. */
            if ((string) ($ans['question_id'] ?? '') !== $questionId) {
                continue;
            }
        } else {
            /* No id pinned, so fall back to recognising the question by its wording -- and
               require all three ideas to be present, not any of them. */
            $q = (string) ($ans['question'] ?? '');
            if ($q === '' || !preg_match('/\b(show|display|list|include)\b/i', $q)
                || !preg_match('/\bname\b/i', $q)
                || !preg_match('/\b(web ?site|online|public(ly)?|page)\b/i', $q)) {
                continue;
            }
        }
        /* Found the question. Whatever it says now decides, and only an explicit yes passes.
           Eventbrite returns checkbox answers variously as "Yes", "true", "on" or "1". */
        $v = trim((string) ($ans['answer'] ?? ''));
        return (bool) preg_match('/^(y|yes|true|1|on|checked|i agree|agree|i consent|consent)\b/i', $v);
    }
    return false;                           // the question was never asked of this attendee
}

/** Has the owner switched public names off entirely, regardless of opt-ins? */
function ngs_eb_names_allowed(): bool
{
    return !defined('NGS_EB_PUBLIC_NAMES') || (bool) constant('NGS_EB_PUBLIC_NAMES');
}

/** "Maya R." from an attendee's profile, or '' if the first name is missing or not plainly a name. */
function ngs_eb_public_name(array $a): string
{
    $profile = is_array($a['profile'] ?? null) ? $a['profile'] : [];
    $first = trim((string) preg_replace('/\s+/u', ' ', (string) ($profile['first_name'] ?? '')));
    if ($first === '' || mb_strlen($first) > 18 || !preg_match("/^\p{L}[\p{L}\p{M}'’ -]*$/u", $first)) {
        return '';
    }
    // a name typed all in one case gets capitals; one typed with its own (McKenzie, DeShawn) is kept
    if ($first === mb_strtolower($first) || $first === mb_strtoupper($first)) {
        $first = mb_convert_case(mb_strtolower($first), MB_CASE_TITLE);
    }
    $last = trim((string) ($profile['last_name'] ?? ''));
    $initial = $last !== '' && preg_match('/^\p{L}/u', $last, $m) ? ' ' . mb_strtoupper($m[0]) . '.' : '';
    return $first . $initial;
}

/** Totals per state across every attending record, and the opted-in names:
    ['states' => [[code, n], ...], 'unknown' => n, 'names' => ['Maya R.', ...]]. */
function ngs_eb_states(callable $get, string $questionId = '', string $namesQuestion = ''): array
{
    $base = 'https://www.eventbriteapi.com/v3/events/' . NGS_EB_EVENT_ID . '/attendees/?status=attending';
    $tally = [];
    $unknown = 0;
    $named = [];
    $considered = 0;
    $agreed = 0;
    $page = $get($base);
    for ($i = 0; $i < NGS_EB_MAX_PAGES; $i++) {
        foreach (($page['attendees'] ?? []) as $a) {
            if (!is_array($a) || !empty($a['cancelled']) || !empty($a['refunded'])) {
                continue;
            }
            $code = ngs_eb_attendee_state($a, $questionId);
            if ($code === '') {
                $unknown++;
            } else {
                $tally[$code] = ($tally[$code] ?? 0) + 1;
            }
            /* A name is published only with this person's explicit permission. The two
               counters around the check are what tells the owner whether the opt-in
               question is reaching anybody at all; they stay in the private snapshot and
               are never sent to a browser. */
            $considered++;
            if (ngs_eb_names_allowed() && ngs_eb_attendee_opted_in($a, $namesQuestion)) {
                $agreed++;
                $name = ngs_eb_public_name($a);
                if ($name !== '') {
                    $named[] = [(string) ($a['created'] ?? ''), $name];
                }
            }
        }
        $p = is_array($page['pagination'] ?? null) ? $page['pagination'] : [];
        if (empty($p['has_more_items']) || empty($p['continuation'])) {
            // most first; ties alphabetical, so the order never flickers between snapshots
            $states = [];
            foreach ($tally as $code => $n) {
                $states[] = [(string) $code, $n];
            }
            usort($states, function ($x, $y) {
                return [$y[1], $x[0]] <=> [$x[1], $y[0]];
            });
            // newest registration first (Eventbrite's ISO times sort as text)
            usort($named, function ($x, $y) {
                return strcmp($y[0], $x[0]);
            });
            // each name once: a group order carries the buyer's name on every ticket, and the same
            // person may have bought twice; the newest stays
            $names = [];
            $seen = [];
            foreach ($named as $n) {
                $key = mb_strtolower($n[1]);
                if (isset($seen[$key])) {
                    continue;
                }
                $seen[$key] = true;
                $names[] = $n[1];
                if (count($names) >= NGS_EB_NAMES_MAX) {
                    break;
                }
            }
            return ['states' => $states, 'unknown' => $unknown, 'names' => $names,
                    'names_considered' => $considered, 'names_agreed' => $agreed];
        }
        $page = $get($base . '&continuation=' . rawurlencode((string) $p['continuation']));
    }
    throw new RuntimeException('Eventbrite attendee list is longer than ' . NGS_EB_MAX_PAGES . ' pages.');
}

// included (by a test) rather than requested: stop here, the functions above are all it needs
if (realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) !== realpath(__FILE__)) {
    return;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    header('Allow: GET');
    ngs_eb_reply(null, 405);
}

try {
    $file = ngs_data_dir() . '/eventbrite-count.json';
    $read = function () use ($file): array {
        $c = is_file($file) ? json_decode((string) @file_get_contents($file), true) : null;
        return is_array($c) ? $c : [];
    };
    $cache = $read();
    $fresh = isset($cache['checked']) && (time() - (int) $cache['checked']) < NGS_EB_TTL;

    if (!$fresh) {
        // one visitor refreshes; anyone arriving meanwhile is served the previous count
        $lock = fopen($file . '.lock', 'c');
        $mine = $lock && flock($lock, LOCK_EX | (isset($cache['count']) ? LOCK_NB : 0));
        if ($mine) {
            $cache = $read();                                   // someone may have just refreshed
            if (!isset($cache['checked']) || (time() - (int) $cache['checked']) >= NGS_EB_TTL) {
                $token = ngs_eb_token();
                try {
                    if ($token === '') {
                        throw new RuntimeException('NGS_EVENTBRITE_TOKEN is not set in api/config.php.');
                    }
                    $cache = [
                        'count' => ngs_eb_count(function (string $url) use ($token) {
                            return ngs_eb_get($url, $token);
                        }),
                        'at' => time(),
                        'checked' => time()
                    ];
                } catch (Throwable $e) {
                    error_log('Next Gen Summit attendee count: ' . $e->getMessage());
                    $cache['checked'] = time();                 // wait a full interval before asking again
                }
                @file_put_contents($file, json_encode($cache), LOCK_EX);
            }
            flock($lock, LOCK_UN);
        }
        if ($lock) {
            fclose($lock);
        }
    }

    $good = isset($cache['count'], $cache['at']) && is_int($cache['count']) && (time() - (int) $cache['at']) < NGS_EB_KEEP;
    if (!$good) {
        ngs_eb_reply(null, 503);
    }

    // per-state totals: send the snapshot there is, then (if one is due) build the next
    $sfile = ngs_data_dir() . '/eventbrite-states.json';
    $readSnap = function () use ($sfile): array {
        $c = is_file($sfile) ? json_decode((string) @file_get_contents($sfile), true) : null;
        return is_array($c) ? $c : [];
    };
    $snap = $readSnap();
    $usable = isset($snap['at'], $snap['states'], $snap['unknown']) && (time() - (int) $snap['at']) < NGS_EB_KEEP;
    ngs_eb_send($cache['count'], $usable ? $snap : null);

    if (isset($snap['checked']) && (time() - (int) $snap['checked']) < NGS_EB_STATES_TTL) {
        exit;
    }
    // the visitor has their answer: close the response where the server allows it, then walk
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    } elseif (function_exists('litespeed_finish_request')) {
        litespeed_finish_request();
    }
    ignore_user_abort(true);
    @set_time_limit(120);
    $slock = fopen($sfile . '.lock', 'c');
    if ($slock && flock($slock, LOCK_EX | LOCK_NB)) {                // one walk at a time; nobody waits on it
        $snap = $readSnap();
        if (!isset($snap['checked']) || (time() - (int) $snap['checked']) >= NGS_EB_STATES_TTL) {
            $snap['checked'] = time();                               // a failed walk also waits a full interval
            try {
                $token = ngs_eb_token();
                if ($token === '') {
                    throw new RuntimeException('NGS_EVENTBRITE_TOKEN is not set in api/config.php.');
                }
                $qid = defined('NGS_EB_STATE_QUESTION') ? trim((string) constant('NGS_EB_STATE_QUESTION')) : '';
                $nqid = defined('NGS_EB_NAMES_QUESTION') ? trim((string) constant('NGS_EB_NAMES_QUESTION')) : '';
                $snap = ngs_eb_states(function (string $url) use ($token) {
                    return ngs_eb_get($url, $token);
                }, $qid, $nqid)
                    + ['at' => time(), 'checked' => time()];
            } catch (Throwable $e) {
                error_log('Next Gen Summit attendee states: ' . $e->getMessage());
            }
            @file_put_contents($sfile, json_encode($snap), LOCK_EX);
        }
        flock($slock, LOCK_UN);
    }
    if ($slock) {
        fclose($slock);
    }
} catch (Throwable $e) {
    error_log('Next Gen Summit attendee count: ' . $e->getMessage());
    if (!headers_sent()) {
        ngs_eb_reply(null, 503);
    }
}
