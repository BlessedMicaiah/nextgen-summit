<?php
/* Recover the address behind a voter key — by proof, never by guesswork.

   Votes cast before addresses were recorded carry only a key like eml:79fa8f0db447b1…,
   which is an HMAC of the voter's email under NGS_SECRET. That is one way: the address
   cannot be read out of it, and nothing here tries to.

   What it does instead is go the other way. Both key derivations are deterministic:

       pc_email_identity($e) = 'eml:' . hmac(pc_email_normalise($e), NGS_SECRET)[0..32]
       pc_email_key($e)      = 'eml:' . hmac(strtolower(trim($e)), NGS_SECRET)[0..32]

   So for any address we already legitimately hold, both forms can be computed and compared
   against the key on the vote. A match is not a resemblance or a best guess — it is the
   same HMAC, and the only way to produce it is to have hashed that address. Combined with
   the fact that the voter proved control of that inbox by reading a code sent to it, the
   address on the vote is established, not inferred.

   TWO SOURCES, both already ours:

     Eventbrite  the attendee list for this event, fetched live. Carries the registered
                 first and last name, which is where a name can come from at all.
     The site    the submissions table in this same database — people who registered
                 through nextgensummit.us and gave a name and an address.

   WHAT IT WILL NOT DO:

     - It never writes an address it did not match by hash. A voter whose address is in
       neither list stays "Not provided", permanently, and that is the correct answer.
     - A phone voter (tel:…) is never touched. There is no address to find.
     - It never invents or part-matches. No fuzzy matching, no domain guessing, no
       "probably this person".
     - It never alters a vote, a total, a rank or a rule. It writes to pc_voter only.
     - An address already recorded at verification time is left alone; that one came from
       the voter directly and outranks anything reconstructed here.

   ON THE REGISTRATION STATUS it records: 'registered' means a registration is bound to
   this identity through the bonus flow. 'on_list' means the voter's proven address appears
   in the attendee list but no bonus was ever claimed. Those are different claims and the
   dashboard shows them differently.
*/
declare(strict_types=1);

require_once __DIR__ . '/pc-attendee.php';
require_once __DIR__ . '/pc-identity.php';

/**
 * Candidate addresses from the site's own submissions table.
 *
 * @return list<array{email:string,first:string,last:string}>
 */
function pc_site_registrations(): array
{
    $out = [];
    $db = function_exists('ngs_db') ? ngs_db() : null;
    if (!$db) {
        return $out;
    }
    try {
        $rows = $db->query('SELECT data FROM submissions')->fetchAll();
    } catch (Throwable $e) {
        return $out;
    }
    foreach ($rows as $r) {
        $d = json_decode((string) ($r['data'] ?? ''), true);
        if (!is_array($d)) {
            continue;
        }
        $email = trim((string) ($d['email'] ?? ''));
        if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            continue;
        }
        $first = trim((string) ($d['first_name'] ?? ''));
        $last = trim((string) ($d['last_name'] ?? ''));
        if ($first === '' && $last === '') {
            /* The shorter form stores one "name" field. Split on the last space: good
               enough for a display name, and it is only ever shown as a whole. */
            $whole = trim((string) ($d['name'] ?? ''));
            if ($whole !== '') {
                $sp = strrpos($whole, ' ');
                $first = $sp === false ? $whole : substr($whole, 0, $sp);
                $last = $sp === false ? '' : substr($whole, $sp + 1);
            }
        }
        $out[] = ['email' => $email, 'first' => $first, 'last' => $last];
    }
    return $out;
}

/**
 * Match unresolved voter keys against addresses we hold, and record what matches.
 *
 * @return array{voters:int,unresolved_before:int,resolved:int,from_eventbrite:int,
 *               from_site:int,still_unresolved:int,phone_only:int,eb_available:bool,
 *               eb_rows:int,bindings:int,via_binding:int}
 */
function pc_voter_resolve(): array
{
    $stat = ['voters' => 0, 'unresolved_before' => 0, 'resolved' => 0, 'from_eventbrite' => 0,
             'from_site' => 0, 'still_unresolved' => 0, 'phone_only' => 0, 'eb_available' => false,
             'eb_rows' => 0, 'bindings' => 0, 'via_binding' => 0];
    $db = pc_db();
    if (!$db) {
        return $stat;
    }

    /* ---- what our own database already proves, before any lookup ----

       Every row in pc_attendee is a registration that was bound to a voting identity by the
       bonus flow. That binding IS the verification, and it happened at the time. Voters who
       claimed a bonus before eb_status started being written are therefore registered as a
       matter of record, and saying so needs no Eventbrite call and no matching at all.

       The row also carries email_key -- the hash of the address the registration was found
       under, which is not always the address the person voted with. Kept here as a second
       key to try, because for a bonus claimer that address is in the attendee list by
       definition. */
    $bound = [];
    pc_attendee_tables();
    try {
        foreach ($db->query('SELECT voter_key, email_key FROM pc_attendee')->fetchAll() as $r) {
            $bound[(string) $r['voter_key']] = (string) $r['email_key'];
        }
    } catch (Throwable $e) {
        $bound = [];
    }
    $stat['bindings'] = count($bound);
    foreach ($bound as $vk => $_) {
        pc_voter_note($vk, ['eb_status' => 'registered']);
    }

    /* Every distinct identity that has actually cast a vote. */
    $keys = [];
    try {
        foreach ($db->query('SELECT DISTINCT voter_key FROM pc_votes')->fetchAll() as $r) {
            $keys[] = (string) $r['voter_key'];
        }
    } catch (Throwable $e) {
        return $stat;
    }
    $stat['voters'] = count($keys);

    $known = pc_voter_map($keys);
    $todo = [];
    foreach ($keys as $k) {
        if (strpos($k, 'tel:') === 0) {
            $stat['phone_only']++;
            continue;                       // a phone proves a number, never an address
        }
        if (($known[$k]['email'] ?? null) !== null) {
            continue;                       // recorded at verification; leave it alone
        }
        $todo[$k] = true;
    }
    $stat['unresolved_before'] = count($todo);
    if ($todo === []) {
        return $stat;
    }

    /* Build hash -> address. Both derivations, because a voter may have verified with a
       different spelling of the same inbox than the one they registered with, and the
       normalising form is exactly what exists to collapse those. */
    $cand = [];
    $add = function (array $rows, string $source) use (&$cand): void {
        foreach ($rows as $r) {
            $e = trim((string) $r['email']);
            if ($e === '') {
                continue;
            }
            foreach ([pc_email_identity($e), pc_email_key($e)] as $h) {
                if (!isset($cand[$h])) {
                    $cand[$h] = ['email' => $e, 'first' => (string) $r['first'],
                                 'last' => (string) $r['last'], 'source' => $source];
                }
            }
        }
    };

    $idx = pc_eb_email_index(true, true);   // force a walk, keep plaintext in memory
    $ebRows = pc_eb_plain();
    $stat['eb_rows'] = count($ebRows);
    $stat['eb_available'] = $idx['ok'] && $ebRows !== [];
    $add($ebRows, 'eventbrite');
    $add(pc_site_registrations(), 'site');

    foreach (array_keys($todo) as $k) {
        /* Their voting identity first. Failing that, the address their registration was
           found under -- a bonus claimer may well have voted with a different one, and
           pc_attendee recorded which address actually matched. */
        $m = $cand[$k] ?? null;
        $viaBinding = false;
        if ($m === null && isset($bound[$k]) && isset($cand[$bound[$k]])) {
            $m = $cand[$bound[$k]];
            $viaBinding = true;
        }
        if ($m === null) {
            $stat['still_unresolved']++;
            continue;
        }
        $fields = ['email' => $m['email'], 'channel' => 'email'];
        if ($m['source'] === 'eventbrite') {
            /* Their proven address is a registration for this event. Whether the bonus was
               ever claimed is a separate fact, and the two are not reported as one. */
            $fields['eb_status'] = (isset($bound[$k]) || pc_attendee_verified($k))
                ? 'registered' : 'on_list';
            if ($m['first'] !== '' || $m['last'] !== '') {
                $fields['eb_first'] = $m['first'];
                $fields['eb_last'] = $m['last'];
            }
            $stat['from_eventbrite']++;
        } else {
            $stat['from_site']++;
        }
        if ($viaBinding) {
            $stat['via_binding']++;
        }
        pc_voter_note($k, $fields);
        $stat['resolved']++;
    }
    return $stat;
}
