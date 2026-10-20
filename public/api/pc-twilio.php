<?php
/* People's Choice — phone verification.

   Twilio is spoken to from here and nowhere else. The browser never sees a credential, never
   sees a phone number it did not type, and never decides whether a code was correct.

   TWO MODES, and the file decides which:

     MOCK   config.twilio.php absent, or PC_TWILIO_ENABLED false.
            No network call is made and nothing is billed. A real six-digit code is generated
            and held server-side, and on a non-production host it is handed back in the reply
            so the flow can be walked through end to end. That is a testing affordance and it
            is why it is fenced to staging.

     LIVE   enabled, and all four credentials present.
            Twilio Verify sends and checks the code. We never see the code at all.

   The mode is never taken from the request. A browser cannot ask for mock.

   On secrets: this file reads the constants and passes them to curl. It does not log them, does
   not echo them, and does not put them in an error message. pc_twilio_status() deliberately
   reports whether each is DEFINED and never what it is. */
declare(strict_types=1);

require_once __DIR__ . '/pc-rules.php';

/* The credentials live beside this file, on the server only. @include because its absence is a
   normal state -- it means "not configured yet", not an error. */
$pcTwilioConfig = __DIR__ . '/config.twilio.php';
if (is_file($pcTwilioConfig)) {
    require_once $pcTwilioConfig;
}

function pc_twilio_configured(): bool
{
    foreach (['PC_TWILIO_ACCOUNT_SID', 'PC_TWILIO_API_KEY', 'PC_TWILIO_API_SECRET', 'PC_TWILIO_VERIFY_SID'] as $k) {
        if (!defined($k)) {
            return false;
        }
        $v = (string) constant($k);
        if ($v === '' || strpos($v, 'REPLACE_ME') !== false) {
            return false;
        }
    }
    return true;
}

function pc_twilio_live(): bool
{
    return defined('PC_TWILIO_ENABLED') && PC_TWILIO_ENABLED === true && pc_twilio_configured();
}

/* A health report with no secrets in it. Each entry says whether something is present and
   plausible, never what it contains. The prefix checks catch the commonest setup mistake --
   an Account SID pasted into the Verify Service field, and so on. */
function pc_twilio_status(): array
{
    $file = __DIR__ . '/config.twilio.php';
    $defined = function (string $k): bool {
        return defined($k) && (string) constant($k) !== '' && strpos((string) constant($k), 'REPLACE_ME') === false;
    };
    $prefix = function (string $k, string $want): string {
        if (!defined($k)) {
            return 'missing';
        }
        $v = (string) constant($k);
        if ($v === '' || strpos($v, 'REPLACE_ME') !== false) {
            return 'placeholder';
        }
        return strpos($v, $want) === 0 ? 'ok' : 'wrong prefix (expected ' . $want . ')';
    };
    return [
        'file_present' => is_file($file),
        'file_readable' => is_file($file) && is_readable($file),
        'enabled_flag' => defined('PC_TWILIO_ENABLED') ? (PC_TWILIO_ENABLED ? 'true' : 'false') : 'not defined',
        'account_sid' => $prefix('PC_TWILIO_ACCOUNT_SID', 'AC'),
        'api_key' => $prefix('PC_TWILIO_API_KEY', 'SK'),
        'api_secret' => $defined('PC_TWILIO_API_SECRET') ? 'present' : 'missing',
        'verify_sid' => $prefix('PC_TWILIO_VERIFY_SID', 'VA'),
        'configured' => pc_twilio_configured(),
        'mode' => pc_twilio_live() ? 'LIVE (billable)' : 'MOCK (no SMS, nothing billed)',
        'curl_available' => function_exists('curl_init'),
    ];
}

/* ---------- phone numbers ----------
   Everything downstream keys on the E.164 form, so two spellings of one number are one voter.
   Deliberately conservative: a 10-digit number is assumed North American, an 11-digit one
   starting 1 likewise, anything already in + form is kept, and anything else is refused rather
   than guessed at. A wrong guess here would either merge two people or split one. */
function pc_phone_e164(string $raw): ?string
{
    $s = trim($raw);
    $plus = strpos($s, '+') === 0;
    $d = preg_replace('/\D+/', '', $s);
    if ($d === '') {
        return null;
    }
    if ($plus) {
        return strlen($d) >= 8 && strlen($d) <= 15 ? '+' . $d : null;
    }
    if (strlen($d) === 10) {
        return '+1' . $d;
    }
    if (strlen($d) === 11 && $d[0] === '1') {
        return '+' . $d;
    }
    return null;
}

function pc_phone_country(string $e164): string
{
    return strpos($e164, '+1') === 0 ? 'US' : 'XX';   // +1 covers US and CA; Lookup would refine it
}

/** What a voter is allowed to see of their own number. Never the whole thing. */
function pc_phone_mask(string $e164): string
{
    $n = strlen($e164);
    return $n <= 4 ? '****' : str_repeat('*', max(0, $n - 4)) . substr($e164, -4);
}

/** The voting identity a verified number maps to. One number, one identity, irreversibly. */
function pc_phone_key(string $e164): string
{
    return 'tel:' . substr(hash_hmac('sha256', $e164, NGS_SECRET), 0, 32);
}

/* ---------- rate limiting ----------
   In front of anything Twilio charges for, because a bill is the thing that cannot be undone.
   Counted from rows, server-side; the browser has no say. */
function pc_otp_table(): void
{
    $db = pc_db();
    if (!$db) {
        return;
    }
    $db->exec('CREATE TABLE IF NOT EXISTS pc_otp_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone_key  TEXT NOT NULL,
        ip_hash    TEXT,
        action     TEXT NOT NULL,
        ok         INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        ts         INTEGER NOT NULL
    )');
    $db->exec('CREATE INDEX IF NOT EXISTS pc_otp_phone ON pc_otp_log (phone_key, ts)');
    $db->exec('CREATE INDEX IF NOT EXISTS pc_otp_ip ON pc_otp_log (ip_hash, ts)');
}

/* The log records that a code was asked for, not what it was and not whose number it was:
   phone_key is the same one-way hash the voting identity uses. */
function pc_otp_note(string $phoneKey, string $action, bool $ok): void
{
    pc_otp_table();
    $db = pc_db();
    if (!$db) {
        return;
    }
    $s = $db->prepare('INSERT INTO pc_otp_log (phone_key, ip_hash, action, ok, created_at, ts)
                       VALUES (?, ?, ?, ?, ?, ?)');
    $s->execute([$phoneKey, ngs_ip_hash(), $action, $ok ? 1 : 0, ngs_now(), time()]);
}

function pc_otp_count(string $field, string $value, int $seconds): int
{
    pc_otp_table();
    $db = pc_db();
    if (!$db) {
        return 0;
    }
    $col = $field === 'ip' ? 'ip_hash' : 'phone_key';
    $s = $db->prepare("SELECT COUNT(*) AS n FROM pc_otp_log
                       WHERE $col = ? AND action = 'start' AND ts > ?");
    $s->execute([$value, time() - $seconds]);
    $r = $s->fetch();
    return (int) ($r['n'] ?? 0);
}

function pc_otp_last(string $phoneKey): int
{
    pc_otp_table();
    $db = pc_db();
    if (!$db) {
        return 0;
    }
    $s = $db->prepare("SELECT ts FROM pc_otp_log WHERE phone_key = ? AND action = 'start'
                       ORDER BY ts DESC LIMIT 1");
    $s->execute([$phoneKey]);
    $r = $s->fetch();
    return (int) ($r['ts'] ?? 0);
}

/** @return array{ok:bool,reason?:string,wait?:int} */
function pc_otp_allowed(string $phoneKey): array
{
    $perDay = defined('PC_SMS_MAX_PER_NUMBER_PER_DAY') ? PC_SMS_MAX_PER_NUMBER_PER_DAY : 5;
    $gap = defined('PC_SMS_MIN_SECONDS_BETWEEN') ? PC_SMS_MIN_SECONDS_BETWEEN : 60;
    $perIp = defined('PC_SMS_MAX_PER_IP_PER_HOUR') ? PC_SMS_MAX_PER_IP_PER_HOUR : 20;

    $since = pc_otp_last($phoneKey);
    if ($since > 0 && time() - $since < $gap) {
        return ['ok' => false, 'reason' => 'cooldown', 'wait' => $gap - (time() - $since)];
    }
    if (pc_otp_count('phone', $phoneKey, 86400) >= $perDay) {
        return ['ok' => false, 'reason' => 'number_daily'];
    }
    if (pc_otp_count('ip', ngs_ip_hash(), 3600) >= $perIp) {
        return ['ok' => false, 'reason' => 'ip_hourly'];
    }
    return ['ok' => true];
}

function pc_country_allowed(string $e164): bool
{
    $list = defined('PC_SMS_ALLOWED_COUNTRIES') ? PC_SMS_ALLOWED_COUNTRIES : ['US', 'CA'];
    return in_array(pc_phone_country($e164), $list, true) || in_array('*', $list, true);
}

/* ---------- talking to Twilio ---------- */

function pc_twilio_call(string $path, array $form): array
{
    if (!function_exists('curl_init')) {
        return ['ok' => false, 'status' => 0, 'error' => 'curl unavailable'];
    }
    $url = 'https://verify.twilio.com/v2/Services/' . rawurlencode((string) PC_TWILIO_VERIFY_SID) . $path;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query($form),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        // the credentials go here and nowhere else in this codebase
        CURLOPT_USERPWD => ((string) PC_TWILIO_API_KEY) . ':' . ((string) PC_TWILIO_API_SECRET),
        CURLOPT_HTTPAUTH => CURLAUTH_BASIC,
    ]);
    $body = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    $data = is_string($body) ? json_decode($body, true) : null;
    return ['ok' => $status >= 200 && $status < 300, 'status' => $status,
            'data' => is_array($data) ? $data : [], 'error' => $err];
}

/* Start a verification. In MOCK the code is made here and kept in the caller's session; in
   LIVE Twilio sends it and we never learn it.
   @return array{ok:bool,reason?:string,mock?:bool,code?:string,wait?:int} */
function pc_otp_start(string $e164): array
{
    $key = pc_phone_key($e164);

    if (!pc_country_allowed($e164)) {
        pc_otp_note($key, 'start', false);
        return ['ok' => false, 'reason' => 'country'];
    }
    $gate = pc_otp_allowed($key);
    if (!$gate['ok']) {
        return $gate;
    }

    if (!pc_twilio_live()) {
        pc_otp_note($key, 'start', true);
        return ['ok' => true, 'mock' => true, 'code' => str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT)];
    }

    $res = pc_twilio_call('/Verifications', ['To' => $e164, 'Channel' => 'sms']);
    pc_otp_note($key, 'start', $res['ok']);
    if (!$res['ok']) {
        // the upstream message is not shown to the visitor: it can name the number
        error_log('People\'s Choice: Verify start failed, HTTP ' . $res['status']);
        return ['ok' => false, 'reason' => 'provider'];
    }
    return ['ok' => true, 'mock' => false];
}

/** @return array{ok:bool,reason?:string} */
function pc_otp_check(string $e164, string $code, ?string $expected): array
{
    $key = pc_phone_key($e164);
    $code = preg_replace('/\D+/', '', $code);
    if (strlen($code) !== 6) {
        pc_otp_note($key, 'check', false);
        return ['ok' => false, 'reason' => 'format'];
    }

    if (!pc_twilio_live()) {
        $good = $expected !== null && hash_equals($expected, $code);
        pc_otp_note($key, 'check', $good);
        return $good ? ['ok' => true, 'mock' => true] : ['ok' => false, 'reason' => 'code', 'mock' => true];
    }

    $res = pc_twilio_call('/VerificationCheck', ['To' => $e164, 'Code' => $code]);
    $good = $res['ok'] && (($res['data']['status'] ?? '') === 'approved');
    pc_otp_note($key, 'check', $good);
    if (!$good) {
        return ['ok' => false, 'reason' => $res['status'] === 404 ? 'expired' : 'code'];
    }
    return ['ok' => true, 'mock' => false];
}
