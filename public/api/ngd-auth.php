<?php
/* ============================================================================
   NEXTGEN DATA — who is allowed in.

   THE SHAPE, AND WHY

   Two ways to sign in, and no third:

     1. The owner, with the admin PIN that already exists. Not a new secret, not a
        default, not a password anybody has to be sent. It is checked against
        NGS_ADMIN_HASH exactly as /admin/ checks it (admin/index.php:53), and against
        the rotated override in the data directory first if one has been written
        (pc-admin-pin.php:110), so rotating the PIN rotates this door too.

     2. A named leadership account, added by the owner from inside the dashboard.
        Stored as a password_hash() -- bcrypt, per-account salt, never reversible --
        in the analytics folder outside the web root.

   WHAT IS DELIBERATELY ABSENT

     - There is no default password. An installation with no accounts and an unset
       NGS_ADMIN_HASH does not fall open; ngd_auth_check() returns false for every
       input. The hidden route is not the security.
     - Nothing here reads or writes the voting database. The PIN override is read as
       TEXT by an explicit path, never through ngs_data_dir() -- which would mkdir and
       drop files -- and never through pc_db(), which would CREATE TABLE.
     - No PIN, password or hash is ever logged, echoed, returned in JSON, or put in a
       URL. Only booleans and display names come back.

   SESSION SCOPE

   The cookie's path is /insights/, which is also where every authenticated endpoint lives.
   That is the same trick the People's Choice dashboard uses on purpose
   (peoples-choice/admin/index.php:9): a request to anything outside /insights/ cannot carry
   the cookie at all, so the session simply does not exist on the public site. It is why
   the reporting endpoints are not in /api/.

   REVOCATION

   Every session records the epoch it was opened under. Rotating the admin PIN moves the
   epoch, and the next request from every older session fails the check. Suspending a
   named account does the same for that account alone.
   ========================================================================= */

declare(strict_types=1);

if (realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === realpath(__FILE__)) {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/ngd-lib.php';

const NGD_SESSION_NAME  = 'ngd_sess';
const NGD_SESSION_PATH  = '/insights/';
const NGD_SESSION_MAX   = 8 * 3600;      // an absolute ceiling on a session's life
const NGD_SESSION_IDLE  = 90 * 60;       // and a shorter one on leaving it unattended
const NGD_TRY_WINDOW    = 900;           // the throttle looks back fifteen minutes
const NGD_TRY_MAX       = 8;             // and allows this many failures from one address

/* ---------------------------------------------------------------------------
   1. THE CREDENTIAL STORE
   ------------------------------------------------------------------------ */

/** The voting data folder for THIS site, found without calling ngs_data_dir(). */
function ngd_site_data_dir(): string
{
    if (defined('NGS_DATA_DIR')) {
        return (string) NGS_DATA_DIR;
    }
    return ngd_sources()['live']['dir'];
}

/**
 * The rotated admin credential, if the owner has ever rotated it.
 *
 * Read as text, never required. pc-admin-pin.php explains at length why executing a
 * file out of the data directory is a path that should not exist (pc-admin-pin.php:66);
 * the same reasoning applies here, and this file only ever needs two hex strings.
 */
function ngd_pin_override(): array
{
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }
    $cache = ['hash' => '', 'salt' => '', 'epoch' => 0];
    $f = ngd_site_data_dir() . '/config.admin.php';
    if (!is_file($f) || !is_readable($f)) {
        return $cache;                      // never rotated: config.php holds the live PIN
    }
    $raw = @file_get_contents($f);
    if (!is_string($raw) || $raw === '') {
        return $cache;
    }
    $hash  = preg_match("/NGS_ADMIN_HASH_V2\s*=\s*'([0-9a-f]{64})'/", $raw, $m) ? $m[1] : '';
    $salt  = preg_match("/NGS_ADMIN_SALT_V2\s*=\s*'([0-9a-f]{16,})'/", $raw, $m) ? $m[1] : '';
    $epoch = preg_match('/NGS_ADMIN_EPOCH\s*=\s*(\d+)/', $raw, $m) ? (int) $m[1] : 0;
    unset($raw);
    if (strlen($hash) !== 64 || strlen($salt) < 16) {
        return $cache;                      // unusable: fall back rather than lock the door
    }
    return $cache = ['hash' => $hash, 'salt' => $salt, 'epoch' => $epoch];
}

function ngd_auth_epoch(): int
{
    return ngd_pin_override()['epoch'];
}

function ngd_users_file(): string
{
    return ngd_var_dir() . '/ngd-users.json';
}

/**
 * Accounts provisioned with the deployment, from public/api/config.ngd.php.
 *
 * There are two places a leadership account can come from, and they answer different
 * problems. Accounts the owner adds from the dashboard live in ngd-users.json, outside
 * the web root, where no deploy can disturb them. That is right for everything except
 * the FIRST account, because there is no way to put a file outside the web root without
 * a shell, and nobody has one.
 *
 * So provisioning rides along with the release instead: tools/make-ngd-user.php writes a
 * line per account into public/api/config.ngd.php, api/.htaccess already refuses to serve
 * anything matching config.*.php, and .gitignore already keeps config.*.php out of the
 * repository. The file holds bcrypt hashes and no passphrase, so reading it does not let
 * anybody in.
 *
 * READ AS TEXT, NEVER EXECUTED -- the same decision, for the same reason, as
 * pc_admin_override() (pc-admin-pin.php:66): the file holds two strings per account and
 * nothing about it needs to be code, so parsing it removes an execution path that had no
 * reason to exist.
 *
 * @return array<string, array{hash:string,name:string}>
 */
function ngd_seed_accounts(bool $fresh = false): array
{
    static $cache = null;
    if ($cache !== null && !$fresh) {
        return $cache;
    }
    $cache = [];
    $f = __DIR__ . '/config.ngd.php';
    if (!is_file($f) || !is_readable($f)) {
        return $cache;                       // no accounts provisioned; the PIN is the only door
    }
    $raw = @file_get_contents($f);
    if (!is_string($raw) || $raw === '') {
        return $cache;
    }
    foreach (explode("\n", $raw) as $line) {
        if (!preg_match("/^\s*NGD_ACCOUNT\s*=\s*'([^'|]+)\|([^'|]*)\|([^']+)'\s*;/", $line, $m)) {
            continue;
        }
        $u = strtolower(trim($m[1]));
        $hash = trim($m[3]);
        /* Only a real bcrypt/argon hash counts. A line carrying anything else is ignored
           rather than trusted, because a malformed hash that happened to match some input
           would be an open door. */
        if ($u === '' || strlen($hash) < 50 || $hash[0] !== '$') {
            continue;
        }
        $cache[$u] = ['hash' => $hash, 'name' => trim($m[2]) !== '' ? trim($m[2]) : $u];
    }
    unset($raw);
    return $cache;
}

/** @return array<string, array{hash:string,name:string,added:string,active:bool,last:?string}> */
function ngd_users(bool $fresh = false): array
{
    static $cache = null;
    if ($cache !== null && !$fresh) {
        return $cache;
    }
    $cache = [];

    /* Accounts that came with the deployment first, so that one exists even on a server
       where nothing has ever been written outside the web root. */
    foreach (ngd_seed_accounts($fresh) as $u => $r) {
        $cache[$u] = ['hash' => $r['hash'], 'name' => $r['name'], 'added' => '',
                      'active' => true, 'last' => null, 'seeded' => true];
    }

    $f = ngd_users_file();
    if (!is_file($f) || !is_readable($f)) {
        return $cache;
    }
    $raw = @file_get_contents($f);
    if (!is_string($raw) || $raw === '') {
        return $cache;
    }
    $d = json_decode($raw, true);
    if (!is_array($d) || !isset($d['users']) || !is_array($d['users'])) {
        return $cache;
    }

    /* The writable store layers over the top. For a seeded account it carries only the
       things the dashboard is allowed to change -- whether it is suspended, and when it
       last signed in -- and never replaces the hash, so suspending one here cannot be
       undone by editing the file, and a deploy cannot quietly reinstate a suspension the
       owner lifted. */
    foreach ($d['users'] as $u => $r) {
        $u = strtolower((string) $u);
        if (isset($cache[$u]) && !empty($cache[$u]['seeded'])) {
            if (isset($r['active'])) {
                $cache[$u]['active'] = $r['active'] === true;
            }
            if (isset($r['last']) && is_string($r['last'])) {
                $cache[$u]['last'] = $r['last'];
            }
            continue;
        }
        if (!is_array($r) || !isset($r['hash']) || !is_string($r['hash'])) {
            continue;
        }
        $cache[$u] = [
            'hash'   => $r['hash'],
            'name'   => isset($r['name']) && is_string($r['name']) ? $r['name'] : $u,
            'added'  => isset($r['added']) && is_string($r['added']) ? $r['added'] : '',
            'active' => !isset($r['active']) || $r['active'] === true,
            'last'   => isset($r['last']) && is_string($r['last']) ? $r['last'] : null,
            'seeded' => false,
        ];
    }
    return $cache;
}

/** Add or replace a leadership account. The plaintext is hashed here and dropped. */
function ngd_user_save(string $username, string $password, string $display): array
{
    $u = strtolower(trim($username));
    if (!preg_match('/^[a-z0-9][a-z0-9._-]{1,30}$/', $u)) {
        return ['ok' => false, 'why' => 'A username may use letters, numbers, dot, dash and underscore, 2 to 31 characters.'];
    }
    if (strlen($password) < 12) {
        return ['ok' => false, 'why' => 'Choose a password of at least 12 characters.'];
    }
    $hash = password_hash($password, PASSWORD_DEFAULT);
    unset($password);
    if (!is_string($hash) || $hash === '') {
        return ['ok' => false, 'why' => 'This server could not hash the password; nothing was saved.'];
    }
    $users = ngd_users(true);
    $users[$u] = [
        'hash'   => $hash,
        'name'   => trim($display) !== '' ? trim($display) : $u,
        'added'  => $users[$u]['added'] ?? ngd_now(),
        'active' => true,
        'last'   => $users[$u]['last'] ?? null,
    ];
    return ngd_users_write($users) ? ['ok' => true] : ['ok' => false, 'why' => 'The account file could not be written.'];
}

function ngd_user_set_active(string $username, bool $active): bool
{
    $u = strtolower(trim($username));
    $users = ngd_users(true);
    if (!isset($users[$u])) {
        return false;
    }
    $users[$u]['active'] = $active;
    return ngd_users_write($users);
}

function ngd_user_remove(string $username): bool
{
    $u = strtolower(trim($username));
    $users = ngd_users(true);
    if (!isset($users[$u])) {
        return false;
    }
    if (!empty($users[$u]['seeded'])) {
        /* It would come back on the next deploy. A delete that silently undoes itself is
           worse than no delete, so this refuses and the dashboard offers Suspend instead. */
        return false;
    }
    unset($users[$u]);
    return ngd_users_write($users);
}

function ngd_users_write(array $users): bool
{
    /* A seeded account keeps its hash in config.ngd.php and nowhere else. Only the two
       fields the dashboard may change are written here, so the writable store can never
       become a stale second copy of a credential -- and removing an account's line from
       config.ngd.php really does remove it, rather than leaving a working copy behind. */
    foreach ($users as $u => $r) {
        if (!empty($r['seeded'])) {
            $users[$u] = ['seeded' => true, 'active' => !empty($r['active']),
                          'last' => $r['last'] ?? null];
        }
    }
    $f = ngd_users_file();
    $body = json_encode(['version' => 1, 'updated' => ngd_now(), 'users' => $users],
                        JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    if (!is_string($body)) {
        return false;
    }
    /* Written through a temp file in the same folder and renamed, so a reader never sees a
       half-written account list -- the same care pc_admin_rotate() takes with the PIN. */
    $tmp = $f . '.' . bin2hex(random_bytes(4)) . '.tmp';
    if (@file_put_contents($tmp, $body, LOCK_EX) === false) {
        return false;
    }
    @chmod($tmp, 0640);
    if (!@rename($tmp, $f)) {
        @unlink($tmp);
        return false;
    }
    ngd_users(true);
    return true;
}

function ngd_user_touch(string $username): void
{
    $u = strtolower(trim($username));
    $users = ngd_users(true);
    if (isset($users[$u])) {
        $users[$u]['last'] = ngd_now();
        ngd_users_write($users);
    }
}

/* ---------------------------------------------------------------------------
   2. CHECKING A SIGN-IN
   ------------------------------------------------------------------------ */

/** Is the owner PIN route available at all? config.php may be a stub on some host. */
function ngd_owner_pin_available(): bool
{
    if (defined('NGD_DISABLE_OWNER_PIN') && NGD_DISABLE_OWNER_PIN) {
        return false;
    }
    $o = ngd_pin_override();
    if ($o['hash'] !== '') {
        return true;
    }
    return defined('NGS_ADMIN_HASH') && is_string(NGS_ADMIN_HASH) && strlen(NGS_ADMIN_HASH) === 64
        && defined('NGS_ADMIN_SALT') && is_string(NGS_ADMIN_SALT) && NGS_ADMIN_SALT !== '';
}

/**
 * The one place a submitted credential is checked.
 *
 * An empty username means "the owner, with the admin PIN". Anything else is a named
 * account. Both paths take a comparable amount of time whether or not the name exists:
 * password_verify on a dummy hash when the account is unknown, so the response does not
 * quietly report which usernames are real.
 *
 * @return array{ok:bool, user:?string, name:?string, role:?string}
 */
function ngd_auth_check(string $username, string $password): array
{
    $no = ['ok' => false, 'user' => null, 'name' => null, 'role' => null];
    if ($password === '') {
        return $no;
    }
    $u = strtolower(trim($username));

    if ($u === '' || $u === 'owner') {
        if (!ngd_owner_pin_available()) {
            return $no;
        }
        $o = ngd_pin_override();
        $okPin = $o['hash'] !== ''
            ? hash_equals($o['hash'], hash_hmac('sha256', $password, $o['salt']))
            : hash_equals(NGS_ADMIN_HASH, hash_hmac('sha256', $password, NGS_ADMIN_SALT));
        return $okPin
            ? ['ok' => true, 'user' => 'owner', 'name' => 'Owner', 'role' => 'owner']
            : $no;
    }

    $users = ngd_users();
    $row = $users[$u] ?? null;
    if ($row === null) {
        /* Spend the same work as a real verify so an unknown name is not faster than a
           wrong password. The hash below is a fixed bcrypt of a value nobody has. */
        password_verify($password, '$2y$10$usesomesillystringfore7o2hJ0VjKqD3pAdoQ1XnA2Qmq1Fiy6');
        return $no;
    }
    if (!$row['active']) {
        return $no;
    }
    if (!password_verify($password, $row['hash'])) {
        return $no;
    }
    return ['ok' => true, 'user' => $u, 'name' => $row['name'], 'role' => 'leadership'];
}

/* ---------------------------------------------------------------------------
   3. THE THROTTLE

   Counted in the analytics store, which is a different file from the voting database,
   so a brute-force attempt against this dashboard cannot put a single write anywhere
   near a ballot. If the store is unavailable the throttle fails CLOSED on the count
   but still allows the attempt -- a reporting tool that locks the owner out because a
   log could not be written is the worse failure, and the two-second delay below still
   applies.
   ------------------------------------------------------------------------ */

function ngd_try_check(): array
{
    $db = ngd_events_db();
    if ($db === null) {
        return ['ok' => true, 'retry_after' => 0, 'left' => NGD_TRY_MAX];
    }
    try {
        $cut = time() - NGD_TRY_WINDOW;
        $db->prepare('DELETE FROM ngd_throttle WHERE ts < ?')->execute([time() - 86400]);
        $s = $db->prepare('SELECT COUNT(*) AS n, MIN(ts) AS first FROM ngd_throttle
                           WHERE k = ? AND ok = 0 AND ts >= ?');
        $s->execute(['login:' . ngd_ip_key(), $cut]);
        $r = $s->fetch();
        $n = (int) ($r['n'] ?? 0);
        if ($n >= NGD_TRY_MAX) {
            $retry = max(30, NGD_TRY_WINDOW - (time() - (int) ($r['first'] ?? time())));
            return ['ok' => false, 'retry_after' => $retry, 'left' => 0];
        }
        return ['ok' => true, 'retry_after' => 0, 'left' => NGD_TRY_MAX - $n];
    } catch (Throwable $e) {
        return ['ok' => true, 'retry_after' => 0, 'left' => NGD_TRY_MAX];
    }
}

function ngd_try_note(bool $success): void
{
    $db = ngd_events_db();
    if ($db === null) {
        return;
    }
    try {
        if ($success) {
            /* A good sign-in clears the record for that address, so one fat-fingered
               session does not count against the next one. */
            $db->prepare('DELETE FROM ngd_throttle WHERE k = ?')->execute(['login:' . ngd_ip_key()]);
            return;
        }
        $db->prepare('INSERT INTO ngd_throttle (k, ts, ok) VALUES (?, ?, 0)')
           ->execute(['login:' . ngd_ip_key(), time()]);
    } catch (Throwable $e) {
        // the delay in the caller is the remaining defence
    }
}

/* ---------------------------------------------------------------------------
   4. THE SESSION
   ------------------------------------------------------------------------ */

function ngd_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

function ngd_session_begin(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    session_name(NGD_SESSION_NAME);
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => NGD_SESSION_PATH,
        'secure'   => ngd_https(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
    }
}

function ngd_csrf(): string
{
    ngd_session_begin();
    return (string) $_SESSION['csrf'];
}

function ngd_csrf_ok(?string $given): bool
{
    ngd_session_begin();
    return is_string($given) && $given !== '' && hash_equals((string) ($_SESSION['csrf'] ?? ''), $given);
}

/** The signed-in user, or null. Checks the ceiling, the idle timeout and the epoch. */
function ngd_user(): ?array
{
    ngd_session_begin();
    if (empty($_SESSION['ngd_ok'])) {
        return null;
    }
    $at   = (int) ($_SESSION['ngd_at'] ?? 0);
    $seen = (int) ($_SESSION['ngd_seen'] ?? 0);
    if ($at <= time() - NGD_SESSION_MAX || $seen <= time() - NGD_SESSION_IDLE) {
        ngd_logout();
        return null;
    }
    if ((int) ($_SESSION['ngd_epoch'] ?? 0) !== ngd_auth_epoch()) {
        ngd_logout();                      // the PIN was rotated: this session is revoked
        return null;
    }
    $u = (string) ($_SESSION['ngd_user'] ?? '');
    if ($u !== 'owner') {
        $row = ngd_users()[$u] ?? null;
        if ($row === null || !$row['active']) {
            ngd_logout();                  // the account was suspended or removed
            return null;
        }
    }
    $_SESSION['ngd_seen'] = time();
    return [
        'user' => $u,
        'name' => (string) ($_SESSION['ngd_name'] ?? $u),
        'role' => (string) ($_SESSION['ngd_role'] ?? 'leadership'),
    ];
}

/**
 * Attempt a sign-in. Returns the reason on failure, never which half was wrong.
 * @return array{ok:bool, why:?string, retry_after:int}
 */
function ngd_login(string $username, string $password): array
{
    ngd_session_begin();
    $t = ngd_try_check();
    if (!$t['ok']) {
        return ['ok' => false, 'retry_after' => $t['retry_after'],
                'why' => 'Too many attempts from this connection. Try again in '
                       . max(1, (int) ceil($t['retry_after'] / 60)) . ' minute(s).'];
    }
    $r = ngd_auth_check($username, $password);
    unset($password);
    if (!$r['ok']) {
        ngd_try_note(false);
        usleep(1800000);                   // a flat delay on every failure
        return ['ok' => false, 'retry_after' => 0, 'why' => 'That did not match.'];
    }
    ngd_try_note(true);
    session_regenerate_id(true);
    $_SESSION['ngd_ok']    = true;
    $_SESSION['ngd_user']  = $r['user'];
    $_SESSION['ngd_name']  = $r['name'];
    $_SESSION['ngd_role']  = $r['role'];
    $_SESSION['ngd_at']    = time();
    $_SESSION['ngd_seen']  = time();
    $_SESSION['ngd_epoch'] = ngd_auth_epoch();
    $_SESSION['csrf']      = bin2hex(random_bytes(16));
    if ($r['user'] !== 'owner') {
        ngd_user_touch((string) $r['user']);
    }
    return ['ok' => true, 'why' => null, 'retry_after' => 0];
}

function ngd_logout(): void
{
    ngd_session_begin();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        setcookie(session_name(), '', [
            'expires' => time() - 42000, 'path' => NGD_SESSION_PATH,
            'secure' => ngd_https(), 'httponly' => true, 'samesite' => 'Strict',
        ]);
    }
    @session_destroy();
}

/* ---------------------------------------------------------------------------
   5. HEADERS AND GATES
   ------------------------------------------------------------------------ */

/** Sent by every page and endpoint under /insights/, authenticated or not. */
function ngd_headers(bool $json = false): void
{
    header('X-Robots-Tag: noindex, nofollow, noarchive');
    header('Cache-Control: no-store, no-cache, must-revalidate, private');
    header('Pragma: no-cache');
    header('X-Frame-Options: DENY');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header('Cross-Origin-Opener-Policy: same-origin');
    if ($json) {
        header('Content-Type: application/json; charset=utf-8');
    }
}

/** For the JSON endpoints: answer 401 and stop unless signed in. */
function ngd_require_json(): array
{
    ngd_headers(true);
    $u = ngd_user();
    if ($u === null) {
        http_response_code(401);
        echo json_encode(['ok' => false, 'reason' => 'auth',
                          'message' => 'Sign in at /insights/ first.']);
        exit;
    }
    /* A reporting endpoint should only ever be reached by the dashboard itself. SameSite=Strict
       already means no cross-site request carries the cookie; this is the second lock, and it
       costs one header. */
    $origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
    if ($origin !== '') {
        $host = (string) ($_SERVER['HTTP_HOST'] ?? '');
        if ($host === '' || parse_url($origin, PHP_URL_HOST) !== $host) {
            http_response_code(403);
            echo json_encode(['ok' => false, 'reason' => 'origin']);
            exit;
        }
    }
    return $u;
}
