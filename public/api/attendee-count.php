<?php
/* Next Gen Summit: how many people hold a ticket, straight from Eventbrite.
   Answers only {"count": N}. No names, emails, orders or credentials ever leave this file.

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
   Eventbrite is unreachable the last good count is served; with none, {"count": null}. */
declare(strict_types=1);

require __DIR__ . '/_lib.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Robots-Tag: noindex');
header('Cache-Control: no-store');

const NGS_EB_EVENT_ID = '1999190304016';
const NGS_EB_TTL = 15;              // seconds a count is considered fresh
const NGS_EB_KEEP = 86400;          // how long a last good count may stand in during an outage

function ngs_eb_reply(?int $count, int $status = 200): void
{
    http_response_code($status);
    echo json_encode(['count' => $count]);
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
                    $cache = ['count' => ngs_eb_count(function (string $url) use ($token) { return ngs_eb_get($url, $token); }), 'at' => time(), 'checked' => time()];
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
    $good ? ngs_eb_reply($cache['count']) : ngs_eb_reply(null, 503);
} catch (Throwable $e) {
    error_log('Next Gen Summit attendee count: ' . $e->getMessage());
    ngs_eb_reply(null, 503);
}
