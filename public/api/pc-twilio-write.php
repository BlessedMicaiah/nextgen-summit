<?php
/* People's Choice — writing the Twilio settings from the dashboard.

   Why this exists: the credentials have to reach the server somehow, and every route has a
   cost. Pasting them into a chat exposes them to a transcript. Putting them in git exposes
   them forever. Editing a file in Hostinger's File Manager exposes them to nothing, but it is
   fiddly, easy to put in the wrong folder, and we already lost one file that way.

   So: a form on the PIN-protected dashboard, over HTTPS, that writes them to the data
   directory outside the web root. Standard practice for an admin panel, and the values make
   exactly one journey.

   THE RULES THIS FILE KEEPS:
     - values are written, never read back to a screen. The form always renders empty.
     - nothing here is ever logged. Not on success, not on failure.
     - a blank field changes nothing, so the allowlist can be edited without retyping secrets.
     - the file is written outside the web root, with permissions as tight as the host allows.
     - shapes are checked. An Account SID pasted into the Verify field is refused rather than
       written, because that mistake otherwise surfaces as a confusing 404 from Twilio. */
declare(strict_types=1);

require_once __DIR__ . '/pc-twilio.php';

function pc_twilio_file(): string
{
    return ngs_data_dir() . '/config.twilio.php';
}

/** Current values, for merging only. Never returned to a caller that renders. */
function pc_twilio_current(): array
{
    return [
        'account' => defined('PC_TWILIO_ACCOUNT_SID') ? (string) PC_TWILIO_ACCOUNT_SID : '',
        'key' => defined('PC_TWILIO_API_KEY') ? (string) PC_TWILIO_API_KEY : '',
        'secret' => defined('PC_TWILIO_API_SECRET') ? (string) PC_TWILIO_API_SECRET : '',
        'verify' => defined('PC_TWILIO_VERIFY_SID') ? (string) PC_TWILIO_VERIFY_SID : '',
        'enabled' => defined('PC_TWILIO_ENABLED') ? (bool) PC_TWILIO_ENABLED : false,
        'allow' => defined('PC_SMS_LIVE_ALLOWLIST') && is_array(PC_SMS_LIVE_ALLOWLIST)
            ? array_values(PC_SMS_LIVE_ALLOWLIST) : [],
        'budget' => defined('PC_SMS_LIVE_MAX_TOTAL') ? (int) PC_SMS_LIVE_MAX_TOTAL : 3,
    ];
}

/**
 * Merge the submitted fields over what is there and rewrite the file.
 * @return array{ok:bool,error?:string}
 */
function pc_twilio_save(array $in): array
{
    $cur = pc_twilio_current();

    $take = function (string $k) use ($in): string {
        return isset($in[$k]) && is_string($in[$k]) ? trim($in[$k]) : '';
    };

    $account = $take('account_sid') !== '' ? $take('account_sid') : $cur['account'];
    $key = $take('api_key') !== '' ? $take('api_key') : $cur['key'];
    $secret = $take('api_secret') !== '' ? $take('api_secret') : $cur['secret'];
    $verify = $take('verify_sid') !== '' ? $take('verify_sid') : $cur['verify'];

    /* Shape checks. The error names the field, never the value. */
    $shape = [
        ['Account SID', $account, 'AC'],
        ['API Key SID', $key, 'SK'],
        ['Verify Service SID', $verify, 'VA'],
    ];
    foreach ($shape as [$label, $val, $want]) {
        if ($val !== '' && strpos($val, $want) !== 0) {
            return ['ok' => false, 'error' => $label . ' should begin with ' . $want . '. Nothing was saved.'];
        }
        if ($val !== '' && strlen($val) < 20) {
            return ['ok' => false, 'error' => $label . ' looks too short. Nothing was saved.'];
        }
    }
    if ($secret !== '' && strlen($secret) < 10) {
        return ['ok' => false, 'error' => 'The API secret looks too short. Nothing was saved.'];
    }

    /* The allowlist, one number per line. Normalised here so the stored form is the same one
       the verification path compares against. */
    $allow = $cur['allow'];
    if (isset($in['allowlist']) && is_string($in['allowlist'])) {
        $raw = preg_split('/[\r\n,]+/', (string) $in['allowlist']);
        $allow = [];
        foreach ($raw as $line) {
            $line = trim($line);
            if ($line === '') {
                continue;
            }
            $e = pc_phone_e164($line);
            if ($e === null) {
                return ['ok' => false, 'error' => 'One of the numbers could not be read. Use the full number with country code. Nothing was saved.'];
            }
            $allow[] = $e;
        }
        $allow = array_values(array_unique($allow));
    }

    $budget = isset($in['budget']) && $in['budget'] !== ''
        ? max(0, min(50, (int) $in['budget'])) : $cur['budget'];

    $enabled = array_key_exists('enabled', $in) ? (bool) $in['enabled'] : $cur['enabled'];

    /* Refuse to arm it without a target. Live with an empty allowlist already sends nothing,
       but saying so here is clearer than letting someone think it is on. */
    if ($enabled && $allow === []) {
        return ['ok' => false, 'error' => 'Add the test number before enabling live SMS. Nothing was saved.'];
    }
    if ($enabled && ($account === '' || $key === '' || $secret === '' || $verify === '')) {
        return ['ok' => false, 'error' => 'All four credentials are needed before enabling live SMS. Nothing was saved.'];
    }

    $q = function (string $v): string {
        return "'" . str_replace(["\\", "'"], ["\\\\", "\\'"], $v) . "'";
    };
    $lines = [];
    $lines[] = '<?php';
    $lines[] = '/* Twilio Verify credentials for the People\'s Choice Award.';
    $lines[] = '   Written by the admin dashboard. Outside the web root, never in git, never in';
    $lines[] = '   an archive, and untouched by deploys. Edit it from the dashboard rather than';
    $lines[] = '   by hand so the shape checks run. */';
    $lines[] = 'declare(strict_types=1);';
    $lines[] = '';
    $lines[] = 'const PC_TWILIO_ENABLED     = ' . ($enabled ? 'true' : 'false') . ';';
    $lines[] = 'const PC_TWILIO_ACCOUNT_SID = ' . $q($account) . ';';
    $lines[] = 'const PC_TWILIO_API_KEY     = ' . $q($key) . ';';
    $lines[] = 'const PC_TWILIO_API_SECRET  = ' . $q($secret) . ';';
    $lines[] = 'const PC_TWILIO_VERIFY_SID  = ' . $q($verify) . ';';
    $lines[] = '';
    $lines[] = '/* Only these numbers may receive a real message. Empty means nobody. */';
    $lines[] = 'const PC_SMS_LIVE_ALLOWLIST = [' . implode(', ', array_map($q, $allow)) . '];';
    $lines[] = '';
    $lines[] = '/* A hard ceiling on real sends ever, counted from the log. */';
    $lines[] = 'const PC_SMS_LIVE_MAX_TOTAL = ' . (int) $budget . ';';
    $lines[] = '';
    $lines[] = "const PC_SMS_ALLOWED_COUNTRIES = ['US', 'CA'];";
    $lines[] = 'const PC_SMS_MAX_PER_NUMBER_PER_DAY = 5;';
    $lines[] = 'const PC_SMS_MIN_SECONDS_BETWEEN    = 60;';
    $lines[] = 'const PC_SMS_MAX_PER_IP_PER_HOUR    = 20;';
    $lines[] = '';

    $path = pc_twilio_file();
    $dir = dirname($path);
    if (!is_dir($dir) || !is_writable($dir)) {
        return ['ok' => false, 'error' => 'The data directory is not writable by PHP. Nothing was saved.'];
    }
    /* Written to a neighbouring file and moved into place, so a half-written config can never
       be included by a request that arrives mid-save. */
    $tmp = $path . '.new';
    if (file_put_contents($tmp, implode("\n", $lines), LOCK_EX) === false) {
        return ['ok' => false, 'error' => 'Could not write the settings file. Nothing was saved.'];
    }
    @chmod($tmp, 0600);
    if (!@rename($tmp, $path)) {
        @unlink($tmp);
        return ['ok' => false, 'error' => 'Could not move the settings file into place.'];
    }
    @chmod($path, 0600);
    /* Deliberately no log line here. A log that records a successful credential write is a log
       that tells an attacker exactly when to look. */
    return ['ok' => true];
}
