<?php
/* NextGen Games — BACK THE NEXT: the store.
 *
 * A player gets NG$10,000 of fictional NextGen capital and decides how much of it to put
 * behind each of the ten finalists. NG$ is not money, not a pledge, and not a vote. This
 * file never reads, writes or counts anything in pc_votes: the game and the People's
 * Choice ballot share a database file and nothing else.
 *
 * WHAT THE SERVER DECIDES, BECAUSE THE BROWSER IS NOT BELIEVED
 *
 *   - who the player is                 a verified email identity, from the existing OTP
 *   - whether the amounts are legal     whole, not negative, only the ten real ids, <= the budget
 *   - whether submissions are open      a setting here, not a hidden button there
 *   - whether anyone may see totals     the same, and the totals endpoint refuses until then
 *
 * ONE SUBMISSION PER VERIFIED EMAIL, AND THE DATABASE IS WHAT ENFORCES IT
 *
 * ngg_portfolios has ident as its PRIMARY KEY and submission is INSERT OR IGNORE followed
 * by a read. A double tap, a refresh mid-request, two phones at once -- whichever arrives
 * second inserts nothing and reads back what the first one wrote. There is no
 * SELECT-then-INSERT for a race to get between, and no code path that can rewrite a
 * submitted row.
 *
 * HONEST LIMIT, stated the way the voting code states its own: one verified email is one
 * wallet. It is not one human. A person with three addresses is three players, and this
 * file does not pretend otherwise.
 */
declare(strict_types=1);

require_once __DIR__ . '/pc-lib.php';
require_once __DIR__ . '/pc-identity.php';

const NGG_BUDGET = 10000;          // NG$, fictional
const NGG_GAME = 'back-the-next';

/* The ten, in the running order for the live show. ids are the game's own and are the only
   keys an allocation may use; `entrant` is how the same founder is known to the rest of the
   site, which is where the page reads their description and film from. Nothing about a
   pitch is written here -- this list is identity and order, not content. */
const NGG_FOUNDERS = [
    ['id' => 'f01', 'entrant' => 'entrant-01', 'name' => 'Caleb Orji',                   'company' => 'Haptol Labs'],
    ['id' => 'f02', 'entrant' => 'entrant-03', 'name' => 'Muyiwa Ogunsola',              'company' => 'Sooz'],
    ['id' => 'f03', 'entrant' => 'entrant-06', 'name' => 'Velma Funebe',                 'company' => 'iBraid'],
    ['id' => 'f04', 'entrant' => 'entrant-07', 'name' => 'Divine Ayomide Fiolu',         'company' => 'BeforeKeys LLC'],
    ['id' => 'f05', 'entrant' => 'entrant-05', 'name' => 'Ethan Edouard',                'company' => 'Lookbook'],
    ['id' => 'f06', 'entrant' => 'entrant-02', 'name' => 'Annrita Karu',                 'company' => 'Credible blossom'],
    ['id' => 'f07', 'entrant' => 'entrant-14', 'name' => 'Kate Mina Lin',                'company' => 'K8Culture Productions'],
    ['id' => 'f08', 'entrant' => 'entrant-12', 'name' => 'Joyson BaLisamore',            'company' => "Jay's Watermelonade"],
    ['id' => 'f09', 'entrant' => 'entrant-04', 'name' => 'Ariel Laura M' . "\u{00E9}" . 'tayer', 'company' => 'The Luminous Lab'],
    ['id' => 'f10', 'entrant' => 'entrant-13', 'name' => 'Ugochinyere Blessing Okogeri',  'company' => 'Offguardz'],
];

/** @return list<string> */
function ngg_ids(): array
{
    static $ids = null;
    if ($ids === null) {
        $ids = array_column(NGG_FOUNDERS, 'id');
    }
    return $ids;
}

/* ---------- storage ---------- */

function ngg_tables(): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $db = pc_db();
    if (!$db) {
        return;
    }
    $db->exec('CREATE TABLE IF NOT EXISTS ngg_players (
        ident      TEXT PRIMARY KEY,
        email      TEXT,
        demo       INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        ts         INTEGER NOT NULL
    )');
    $db->exec('CREATE TABLE IF NOT EXISTS ngg_drafts (
        ident      TEXT PRIMARY KEY,
        alloc      TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        ts         INTEGER NOT NULL
    )');
    /* ident is the PRIMARY KEY on purpose: it is the whole of the one-submission rule, and
       it is enforced by the storage layer rather than by anything a request can race. */
    $db->exec('CREATE TABLE IF NOT EXISTS ngg_portfolios (
        ident      TEXT PRIMARY KEY,
        game       TEXT NOT NULL,
        alloc      TEXT NOT NULL,
        invested   INTEGER NOT NULL,
        unspent    INTEGER NOT NULL,
        backed     INTEGER NOT NULL,
        demo       INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        ts         INTEGER NOT NULL,
        ip_hash    TEXT
    )');
    $db->exec('CREATE INDEX IF NOT EXISTS ngg_portfolios_ts ON ngg_portfolios (ts)');
    $db->exec('CREATE TABLE IF NOT EXISTS ngg_settings (
        k TEXT PRIMARY KEY,
        v TEXT NOT NULL
    )');
    $done = true;
}

function ngg_setting(string $k, string $default = ''): string
{
    ngg_tables();
    $db = pc_db();
    if (!$db) {
        return $default;
    }
    try {
        $s = $db->prepare('SELECT v FROM ngg_settings WHERE k = ?');
        $s->execute([$k]);
        $r = $s->fetch();
        return $r ? (string) $r['v'] : $default;
    } catch (Throwable $e) {
        return $default;
    }
}

function ngg_set(string $k, string $v): void
{
    ngg_tables();
    $db = pc_db();
    if (!$db) {
        return;
    }
    $db->prepare('INSERT INTO ngg_settings (k, v) VALUES (?, ?)
                  ON CONFLICT(k) DO UPDATE SET v = excluded.v')->execute([$k, $v]);
}

/** Are new submissions being accepted? Open by default: the game is for a live room. */
function ngg_open(): bool
{
    return ngg_setting('open', '1') === '1';
}

/** Has an administrator published the aggregate totals? Hidden by default, always. */
function ngg_revealed(): bool
{
    return ngg_setting('reveal', '0') === '1';
}

/* ---------- validation ----------

   Strict on purpose. The client only ever sends whole numbers, so anything else arriving
   here is either a bug or somebody poking, and both are better off refused than rounded.
   A float is refused even when it happens to be whole: accepting 2500.0 means deciding what
   2500.4 means, and there is no good answer to that in a currency that has no cents. */

/**
 * @param mixed $raw
 * @return array{ok:bool,reason?:string,alloc?:array<string,int>,invested?:int,unspent?:int}
 */
function ngg_validate($raw): array
{
    if ($raw === null || $raw === []) {
        $raw = [];
    }
    if (!is_array($raw)) {
        return ['ok' => false, 'reason' => 'shape'];
    }
    $ids = ngg_ids();
    $alloc = [];
    $total = 0;
    foreach ($raw as $k => $v) {
        if (!is_string($k) || !in_array($k, $ids, true)) {
            return ['ok' => false, 'reason' => 'unknown_founder'];
        }
        if (is_int($v)) {
            $n = $v;
        } elseif (is_string($v) && preg_match('/^\d{1,6}$/', $v)) {
            $n = (int) $v;
        } else {
            /* floats, booleans, nulls, arrays, "1e3", " 100", "-5", "100.0" */
            return ['ok' => false, 'reason' => 'not_whole'];
        }
        if ($n < 0) {
            return ['ok' => false, 'reason' => 'negative'];
        }
        if ($n === 0) {
            continue;                       // nothing behind this founder; not a row
        }
        if (isset($alloc[$k])) {
            return ['ok' => false, 'reason' => 'duplicate'];
        }
        $alloc[$k] = $n;
        $total += $n;
        if ($total > NGG_BUDGET) {
            return ['ok' => false, 'reason' => 'over_budget'];
        }
    }
    /* Stored in the show's running order rather than the order the browser happened to send,
       so two identical portfolios are identical rows. */
    $ordered = [];
    foreach ($ids as $id) {
        if (isset($alloc[$id])) {
            $ordered[$id] = $alloc[$id];
        }
    }
    return ['ok' => true, 'alloc' => $ordered, 'invested' => $total,
            'unspent' => NGG_BUDGET - $total];
}

/* ---------- players ---------- */

function ngg_player_seen(string $ident, ?string $email, bool $demo = false): void
{
    ngg_tables();
    $db = pc_db();
    if (!$db) {
        return;
    }
    $db->prepare('INSERT OR IGNORE INTO ngg_players (ident, email, demo, created_at, ts)
                  VALUES (?, ?, ?, ?, ?)')
       ->execute([$ident, $email, $demo ? 1 : 0, ngs_now(), time()]);
}

/* ---------- drafts ---------- */

/** @return array<string,int> */
function ngg_draft(string $ident): array
{
    ngg_tables();
    $db = pc_db();
    if (!$db) {
        return [];
    }
    $s = $db->prepare('SELECT alloc FROM ngg_drafts WHERE ident = ?');
    $s->execute([$ident]);
    $r = $s->fetch();
    if (!$r) {
        return [];
    }
    $a = json_decode((string) $r['alloc'], true);
    if (!is_array($a)) {
        return [];
    }
    /* Revalidated on the way out. A draft written under an older set of ids, or by hand,
       must not be able to put an impossible wallet in front of a player. */
    $v = ngg_validate($a);
    return $v['ok'] ? $v['alloc'] : [];
}

function ngg_draft_save(string $ident, array $alloc): void
{
    ngg_tables();
    $db = pc_db();
    if (!$db) {
        return;
    }
    $db->prepare('INSERT INTO ngg_drafts (ident, alloc, updated_at, ts) VALUES (?, ?, ?, ?)
                  ON CONFLICT(ident) DO UPDATE SET alloc = excluded.alloc,
                      updated_at = excluded.updated_at, ts = excluded.ts')
       ->execute([$ident, json_encode($alloc, JSON_UNESCAPED_UNICODE), ngs_now(), time()]);
}

/* ---------- the submitted portfolio ---------- */

/** @return array{alloc:array<string,int>,invested:int,unspent:int,backed:int,created_at:string}|null */
function ngg_portfolio(string $ident): ?array
{
    ngg_tables();
    $db = pc_db();
    if (!$db) {
        return null;
    }
    $s = $db->prepare('SELECT alloc, invested, unspent, backed, created_at
                       FROM ngg_portfolios WHERE ident = ?');
    $s->execute([$ident]);
    $r = $s->fetch();
    if (!$r) {
        return null;
    }
    $a = json_decode((string) $r['alloc'], true);
    return [
        'alloc' => is_array($a) ? $a : [],
        'invested' => (int) $r['invested'],
        'unspent' => (int) $r['unspent'],
        'backed' => (int) $r['backed'],
        'created_at' => (string) $r['created_at'],
    ];
}

/**
 * Lock one portfolio in, once.
 *
 * INSERT OR IGNORE then read. Whichever request arrives second writes nothing and is handed
 * what the first one stored, so a double tap and two open tabs both end at the same row and
 * neither gets an error it has to understand. `already` says which happened, because the
 * page says something slightly different in each case -- not because anything differs.
 *
 * $alloc is deliberately untyped. It comes from whatever JSON a request body happened to
 * hold, and `array` here meant that a payload of `"alloc": 42` threw a TypeError before
 * ngg_validate() ever saw it -- a crash instead of a refusal, found by sending exactly that.
 * Everything this function trusts, it validates itself on the next line.
 *
 * @param mixed $alloc
 * @return array{ok:bool,reason?:string,already?:bool,portfolio?:array}
 */
function ngg_submit(string $ident, $alloc, bool $demo = false): array
{
    ngg_tables();
    $db = pc_db();
    if (!$db) {
        return ['ok' => false, 'reason' => 'store'];
    }
    $v = ngg_validate($alloc);
    if (!$v['ok']) {
        return ['ok' => false, 'reason' => $v['reason']];
    }

    $existing = ngg_portfolio($ident);
    if ($existing) {
        return ['ok' => true, 'already' => true, 'portfolio' => $existing];
    }

    try {
        $db->prepare('INSERT OR IGNORE INTO ngg_portfolios
                      (ident, game, alloc, invested, unspent, backed, demo, created_at, ts, ip_hash)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
           ->execute([$ident, NGG_GAME, json_encode($v['alloc'], JSON_UNESCAPED_UNICODE),
                      $v['invested'], $v['unspent'], count($v['alloc']), $demo ? 1 : 0,
                      ngs_now(), time(), ngs_ip_hash()]);
    } catch (Throwable $e) {
        /* A unique-constraint failure here means somebody else got there first, which is
           exactly the outcome wanted. Fall through and read theirs. */
        error_log('NextGen Games: submit insert: ' . $e->getMessage());
    }

    $saved = ngg_portfolio($ident);
    if (!$saved) {
        return ['ok' => false, 'reason' => 'store'];
    }
    /* The draft has done its job. Dropping it means a returning player cannot be shown a
       stale wallet beside their locked portfolio. */
    try {
        $db->prepare('DELETE FROM ngg_drafts WHERE ident = ?')->execute([$ident]);
    } catch (Throwable $e) {
        // a leftover draft is harmless; the portfolio is what the page reads
    }
    return ['ok' => true, 'already' => false, 'portfolio' => $saved];
}

/* ---------- aggregates: administrators, or nobody ----------

   Never called from a public response path. ngg_totals() is the only function in this file
   that knows what the room thinks, and the endpoint that can reach it checks ngg_revealed()
   or an admin session first. Hiding a number in the browser is not hiding it. */

/**
 * @return array{players:int,submitted:int,invested:int,per_founder:array<string,int>,
 *               backers:array<string,int>}
 */
function ngg_totals(): array
{
    ngg_tables();
    $out = ['players' => 0, 'submitted' => 0, 'invested' => 0,
            'per_founder' => [], 'backers' => []];
    foreach (ngg_ids() as $id) {
        $out['per_founder'][$id] = 0;
        $out['backers'][$id] = 0;
    }
    $db = pc_db();
    if (!$db) {
        return $out;
    }
    try {
        $out['players'] = (int) $db->query('SELECT COUNT(*) n FROM ngg_players')->fetch()['n'];
        $s = $db->query('SELECT alloc, invested FROM ngg_portfolios');
        foreach ($s->fetchAll() as $r) {
            $out['submitted']++;
            $out['invested'] += (int) $r['invested'];
            $a = json_decode((string) $r['alloc'], true);
            if (!is_array($a)) {
                continue;
            }
            foreach ($a as $id => $n) {
                if (isset($out['per_founder'][$id]) && is_int($n)) {
                    $out['per_founder'][$id] += $n;
                    $out['backers'][$id]++;
                }
            }
        }
    } catch (Throwable $e) {
        error_log('NextGen Games: totals: ' . $e->getMessage());
    }
    return $out;
}

/* ---------- the demo records, and getting rid of them ----------

   A demo player is one who signed in through the review-store shortcut: their ident begins
   `demo:` and every row they wrote carries demo = 1. Both marks are checked, so a row has
   to be a demo row twice over before it is counted here, and nothing that a real person
   wrote through an email code can match.

   Only the game's own tables are read or touched. pc_votes, pc_voter and the rest of the
   People's Choice store are not named anywhere in these two functions. */

/** @return array{players:list<array>,portfolios:list<array>,drafts:int} */
function ngg_demo_rows(): array
{
    ngg_tables();
    $out = ['players' => [], 'portfolios' => [], 'drafts' => 0];
    $db = pc_db();
    if (!$db) {
        return $out;
    }
    $out['players'] = $db->query("SELECT ident, created_at FROM ngg_players
                                  WHERE demo = 1 AND ident LIKE 'demo:%' ORDER BY ts")->fetchAll();
    $out['portfolios'] = $db->query("SELECT ident, invested, unspent, backed, created_at FROM ngg_portfolios
                                     WHERE demo = 1 AND ident LIKE 'demo:%' ORDER BY ts")->fetchAll();
    $out['drafts'] = (int) $db->query("SELECT COUNT(*) n FROM ngg_drafts
                                       WHERE ident LIKE 'demo:%'")->fetch()['n'];
    return $out;
}

/**
 * Remove the demo rows, after writing them to a file first.
 *
 * The backup goes beside the database, outside the web root, as JSON with a timestamp in
 * its name. It is written and re-read before a single DELETE runs; if it cannot be written,
 * nothing is deleted. Everything happens inside one transaction so a failure part way
 * leaves the store as it was.
 *
 * @return array{ok:bool,reason?:string,backup?:string,removed?:array{players:int,portfolios:int,drafts:int}}
 */
function ngg_purge_demo(): array
{
    ngg_tables();
    $db = pc_db();
    if (!$db) {
        return ['ok' => false, 'reason' => 'store'];
    }
    $rows = ngg_demo_rows();
    $n = count($rows['players']) + count($rows['portfolios']) + $rows['drafts'];
    if ($n === 0) {
        return ['ok' => true, 'backup' => '', 'removed' => ['players' => 0, 'portfolios' => 0, 'drafts' => 0]];
    }

    /* the full rows, not the summary, so a restore is possible */
    $full = [
        'written_at' => ngs_now(),
        'players' => $db->query("SELECT * FROM ngg_players WHERE demo = 1 AND ident LIKE 'demo:%'")->fetchAll(),
        'portfolios' => $db->query("SELECT * FROM ngg_portfolios WHERE demo = 1 AND ident LIKE 'demo:%'")->fetchAll(),
        'drafts' => $db->query("SELECT * FROM ngg_drafts WHERE ident LIKE 'demo:%'")->fetchAll(),
    ];
    try {
        $file = ngs_data_dir() . '/ngg-demo-backup-' . gmdate('Ymd-His') . '.json';
        $json = json_encode($full, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        if ($json === false || @file_put_contents($file, $json, LOCK_EX) === false) {
            return ['ok' => false, 'reason' => 'backup_write'];
        }
        $back = json_decode((string) @file_get_contents($file), true);
        if (!is_array($back) || count($back['portfolios'] ?? []) !== count($full['portfolios'])) {
            return ['ok' => false, 'reason' => 'backup_verify'];
        }
    } catch (Throwable $e) {
        return ['ok' => false, 'reason' => 'backup_write'];
    }

    try {
        $db->beginTransaction();
        $p = $db->exec("DELETE FROM ngg_portfolios WHERE demo = 1 AND ident LIKE 'demo:%'");
        $d = $db->exec("DELETE FROM ngg_drafts WHERE ident LIKE 'demo:%'");
        $u = $db->exec("DELETE FROM ngg_players WHERE demo = 1 AND ident LIKE 'demo:%'");
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        error_log('NextGen Games: demo purge rolled back: ' . $e->getMessage());
        return ['ok' => false, 'reason' => 'delete'];
    }
    return ['ok' => true, 'backup' => basename($file),
            'removed' => ['players' => (int) $u, 'portfolios' => (int) $p, 'drafts' => (int) $d]];
}

/** The ten, with their totals attached, biggest first. Admin and post-reveal only. */
function ngg_standings(): array
{
    $t = ngg_totals();
    $rows = [];
    foreach (NGG_FOUNDERS as $f) {
        $rows[] = [
            'id' => $f['id'], 'name' => $f['name'], 'company' => $f['company'],
            'ngd' => $t['per_founder'][$f['id']] ?? 0,
            'backers' => $t['backers'][$f['id']] ?? 0,
        ];
    }
    usort($rows, function ($a, $b) {
        return $b['ngd'] <=> $a['ngd'] ?: strcmp($a['name'], $b['name']);
    });
    return $rows;
}
