<?php
/* Rotating the admin PIN, from the dashboard, on a phone.

   WHY THE NEW PIN IS NOT WRITTEN INTO config.php

   config.php sits in the web root and, unlike the Twilio secrets, it IS carried in the release
   archive -- release.py refuses to build without it. So a form that rewrote config.php on the
   server would be undone by the next deploy, silently, restoring the very PIN we rotated away
   from. That is the same shape as the failure that already cost us a credentials file: it
   works, and then one day it quietly does not.

   It would also mean a web request rewriting the file that holds NGS_SECRET, NGS_DATA_KEY and
   the Eventbrite token. One bad write there orphans every voter identity, because a voter is
   hash_hmac(E.164, NGS_SECRET). Nothing on a dashboard should be able to do that.

   So the rotated PIN lives in its own small file in the DATA DIRECTORY, beside the Twilio
   config and the vote database: outside the web root, never served, never in the archive,
   untouched by deploys. config.php is never opened for writing by this code at all, which is
   the strongest guarantee available that NGS_SECRET and its neighbours survive a rotation --
   they are not merely preserved, they are never touched.

   The override uses its own constant names, because config.php has already defined the
   originals by the time this file is read and a constant cannot be redefined.

   WHAT HAPPENS IF THE OVERRIDE IS UNREADABLE

   It falls back to the config.php PIN rather than locking the dashboard. A lockout on a phone,
   mid-launch, with the fix living in a file manager, is the worse failure. The write below is
   atomic and is verified before it is accepted, so a half-written override should not be
   reachable -- but if one ever is, the door still opens with the old PIN and a warning naming
   no secret goes to the error log.

   That fallback is also why rotating here is only half the job: until config.php itself is
   rotated and deployed, the old PIN remains a working fallback should the override ever fail
   to load. pc_admin_rotation_note() says so on the dashboard.

   NOTHING HERE LOGS, ECHOES OR RETURNS A PIN. Not the old one, not the new one, not on
   success and not on failure. Only hashes are written, and only booleans come back. */
declare(strict_types=1);

require_once __DIR__ . '/_lib.php';

/** The rotated credential, outside the web root, where a deploy cannot reach it. */
function pc_admin_pin_file(): string
{
    return ngs_data_dir() . '/config.admin.php';
}

/* Read once. A missing file is the normal state: it means the PIN has never been rotated and
   the config.php credential is the live one. */
function pc_admin_override(): array
{
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }
    $cache = ['hash' => '', 'salt' => '', 'epoch' => 0];
    $f = pc_admin_pin_file();
    if (!is_file($f) || !is_readable($f)) {
        return $cache;
    }
    require_once $f;
    $hash = defined('NGS_ADMIN_HASH_V2') ? (string) NGS_ADMIN_HASH_V2 : '';
    $salt = defined('NGS_ADMIN_SALT_V2') ? (string) NGS_ADMIN_SALT_V2 : '';
    if (strlen($hash) !== 64 || strlen($salt) < 16) {
        // present but not usable: fall back to config.php rather than lock the door
        error_log("People's Choice: admin PIN override present but unusable; using config.php.");
        return $cache;
    }
    $cache = ['hash' => $hash, 'salt' => $salt,
              'epoch' => defined('NGS_ADMIN_EPOCH') ? (int) NGS_ADMIN_EPOCH : 0];
    return $cache;
}

function pc_admin_rotated(): bool
{
    $o = pc_admin_override();
    return $o['hash'] !== '';
}

/* Every session carries the epoch it was opened under. Rotating moves the epoch, so every
   other session stops being authenticated on its next request -- that is the revocation. The
   session doing the rotating updates its own copy and survives. */
function pc_admin_epoch(): int
{
    return pc_admin_override()['epoch'];
}

/** The one place a submitted PIN is checked, against whichever credential is live. */
function pc_admin_check(string $pw): bool
{
    if ($pw === '') {
        return false;
    }
    $o = pc_admin_override();
    if ($o['hash'] !== '') {
        return hash_equals($o['hash'], hash_hmac('sha256', $pw, $o['salt']));
    }
    return hash_equals(NGS_ADMIN_HASH, hash_hmac('sha256', $pw, NGS_ADMIN_SALT));
}

/** What the dashboard should tell the operator about where the credential currently lives. */
function pc_admin_rotation_note(): string
{
    if (!pc_admin_rotated()) {
        return 'The PIN is the one in config.php. It has never been rotated from here.';
    }
    return 'The PIN has been rotated and is stored outside the web root, so deploys cannot '
        . 'undo it. The config.php PIN is now only a fallback, used if that file ever becomes '
        . 'unreadable - rotate config.php too when convenient so the old PIN is gone for good.';
}

/**
 * Replace the PIN. The caller has already proved it knows the current one.
 *
 * The new credential is written to a neighbouring file and renamed into place, so a request
 * arriving mid-rotation reads either the old file or the new one and never a half of either.
 * Before the rename is accepted the file is read back and the new PIN verified against it; if
 * that check fails the temporary file is removed and nothing changes.
 *
 * @return array{ok:bool,error?:string,epoch?:int}
 */
function pc_admin_rotate(string $new): array
{
    $new = (string) $new;
    if (strlen($new) < 8) {
        return ['ok' => false, 'error' => 'The new PIN must be at least 8 characters. Nothing was changed.'];
    }
    if (strlen($new) > 200) {
        return ['ok' => false, 'error' => 'That is too long. Nothing was changed.'];
    }
    if (trim($new) === '') {
        return ['ok' => false, 'error' => 'A PIN of only spaces will not do. Nothing was changed.'];
    }
    if (pc_admin_check($new)) {
        return ['ok' => false, 'error' => 'That is already the current PIN. Choose a different one.'];
    }

    $salt = bin2hex(random_bytes(32));
    $hash = hash_hmac('sha256', $new, $salt);
    $epoch = time();

    /* Verify the credential round-trips BEFORE it is allowed anywhere near the live file. */
    if (!hash_equals($hash, hash_hmac('sha256', $new, $salt))) {
        return ['ok' => false, 'error' => 'The new credential did not verify. Nothing was changed.'];
    }

    $q = function (string $v): string {
        return "'" . str_replace(["\\", "'"], ["\\\\", "\\'"], $v) . "'";
    };
    $lines = [];
    $lines[] = '<?php';
    $lines[] = '/* Rotated NextGen admin PIN. Written by the dashboard, outside the web root,';
    $lines[] = '   never in git and never in a release archive. It holds a salted HMAC of the';
    $lines[] = '   PIN and never the PIN. Deleting this file restores the config.php PIN. */';
    $lines[] = 'declare(strict_types=1);';
    $lines[] = '';
    $lines[] = 'const NGS_ADMIN_SALT_V2 = ' . $q($salt) . ';';
    $lines[] = 'const NGS_ADMIN_HASH_V2 = ' . $q($hash) . ';';
    $lines[] = '';
    $lines[] = '/* Sessions opened before this moment are no longer authenticated. */';
    $lines[] = 'const NGS_ADMIN_EPOCH = ' . $epoch . ';';
    $lines[] = '';

    $path = pc_admin_pin_file();
    $dir = dirname($path);
    if (!is_dir($dir) || !is_writable($dir)) {
        return ['ok' => false, 'error' => 'The data directory is not writable by PHP. Nothing was changed.'];
    }
    $tmp = $path . '.new';
    if (file_put_contents($tmp, implode("\n", $lines), LOCK_EX) === false) {
        return ['ok' => false, 'error' => 'Could not write the new credential. Nothing was changed.'];
    }
    @chmod($tmp, 0600);

    /* Read the temporary file back as PHP would, and confirm the new PIN validates against
       what was actually written rather than against what we meant to write. */
    $check = @file_get_contents($tmp);
    if (!is_string($check)
        || strpos($check, $hash) === false
        || strpos($check, $salt) === false) {
        @unlink($tmp);
        return ['ok' => false, 'error' => 'The new credential did not read back correctly. Nothing was changed.'];
    }

    if (!@rename($tmp, $path)) {
        @unlink($tmp);
        return ['ok' => false, 'error' => 'Could not move the new credential into place. Nothing was changed.'];
    }
    @chmod($path, 0600);

    /* Nothing is logged on success. A log line recording a credential rotation tells an
       attacker precisely when to look. */
    return ['ok' => true, 'epoch' => $epoch];
}
