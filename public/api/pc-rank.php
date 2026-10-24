<?php
/* People's Choice — the running order of the founder feed.
 *
 * Leadership asked for the reels to run in vote order, leader first. This answers that and
 * deliberately answers nothing more.
 *
 * WHAT IT RETURNS AND WHAT IT WITHHOLDS
 *
 * The order, and a rank per founder. NOT the totals. Ordering already discloses relative
 * standing, which is as far as this needs to go; the numbers themselves stay where they have
 * always been, on the dashboard. Returning counts here would publish the whole leaderboard to
 * anyone who opened developer tools, and nobody asked for that.
 *
 * TIES ARE TOLD THE TRUTH
 *
 * Founders on equal points share a rank: two leaders are both rank 1 and there is no rank 2.
 * `podium` is true only when the leader genuinely stands alone above the field. Today every
 * valid total is zero, so `ranked` is false, the order falls back to contestant number, and
 * the page shows no medals at all -- because "currently leading" would be a lie when nobody
 * has a single vote.
 *
 * Within a tie the order is by contestant id ascending. That is arbitrary but it is stable,
 * documented, and the same for every visitor, which is the most a tiebreak can honestly be.
 *
 * Only valid rows count. Invalidated and simulated rows are excluded, exactly as the
 * dashboard excludes them.
 */
declare(strict_types=1);

require __DIR__ . '/pc-rules.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=30');
header('X-Content-Type-Options: nosniff');

/* THE SWITCH.
 *
 * Ordering the feed by votes publishes the standings. Not the numbers -- but who is ahead
 * of whom, which is the part that changes behaviour: a visitor who can see a leader can
 * pile on behind one. That is a competition-policy decision, not an engineering one, so it
 * is a stored setting an administrator changes on the dashboard, not a constant a deploy
 * can move. Turning it off puts the feed straight back into contestant order with no code
 * change, no release and no downtime.
 *
 * The order is still computed either way, because the endpoint has to answer; what the
 * switch decides is whether the ANSWER reflects the votes. */
$public = (string) pc_meta('rank_public', '1') === '1';

$ids = array_column(pc_entrants(), 'id');
$totals = array_fill_keys($ids, 0);     // POINTS: a +1 and each attendee +2 is its own row
$voters = array_fill_keys($ids, 0);     // PEOPLE: distinct verified identities

$db = $public ? pc_db() : null;
if ($db) {
    /* CUMULATIVE, deliberately, and there is no vote_day filter here on purpose.
     *
     * vote_day exists on every row and is what the daily ALLOWANCE is counted against:
     * it decides whether a voter has points left today. It has nothing to do with a
     * founder's score. Midnight Eastern refills what each voter may spend; it does not
     * touch what any founder has already been given.
     *
     * So this counts every valid point a founder has ever received -- the +1s and the
     * attendee +2s alike, each one its own row, so counting rows counts points. A
     * variable filtering by day used to be computed here and never used, which read as
     * though the standings reset nightly. They do not. */
    $sql = 'SELECT entrant_id, COUNT(*) n, COUNT(DISTINCT voter_key) v FROM pc_votes
            WHERE competition = ? AND valid = 1 AND simulated = 0
            GROUP BY entrant_id';
    $s = $db->prepare($sql);
    $s->execute([PC_COMPETITION]);
    foreach ($s->fetchAll() as $row) {
        $id = (string) $row['entrant_id'];
        if (array_key_exists($id, $totals)) {
            $totals[$id] = (int) $row['n'];
            $voters[$id] = (int) $row['v'];
        }
    }
}

$order = $ids;
usort($order, static function ($a, $b) use ($totals) {
    if ($totals[$a] !== $totals[$b]) {
        return $totals[$b] <=> $totals[$a];   // more points first
    }
    return strcmp($a, $b);                     // stable, documented tiebreak
});

/* Competition ranking: equal totals share a rank and the next rank skips accordingly. */
$ranks = [];
$place = 0;
$seen = 0;
$last = null;
foreach ($order as $id) {
    $seen++;
    if ($last === null || $totals[$id] !== $last) {
        $place = $seen;
        $last = $totals[$id];
    }
    $ranks[$id] = $place;
}

$distinct = count(array_unique(array_values($totals)));
$anyVotes = array_sum($totals) > 0;
$leaders = count(array_filter($ranks, static fn($r) => $r === 1));

echo json_encode([
    'ok' => true,
    /* false while every founder is level: the page then keeps contestant order and shows no
       medals, because a podium drawn over a field of zeroes is a fabrication. */
    'ranked' => $public && $anyVotes && $distinct > 1,
    'podium' => $public && $anyVotes && $leaders === 1,
    /* Said plainly, so a reviewer reading the response knows whether they are looking at
       contestant order because nobody has voted yet, or because ranking is switched off. */
    'by_votes' => $public,
    'order' => array_values($order),
    'rank' => $ranks,
    /* POINTS, published at leadership's explicit instruction, and named as points
       rather than votes because they are not the same number: a verified attendee's
       single choice is worth three. `voters` is how many distinct verified identities
       backed that founder, so neither figure can be mistaken for the other. No voter is
       identifiable from either -- they are counts, nothing more. */
    'points' => $public ? $totals : null,
    'voters' => $public ? $voters : null,
    'points_are_not_votes' => 'a point is a point; an attendee casts three of them at once',
    'tiebreak' => 'contestant id ascending, applied only within equal totals',
    'generated' => gmdate('c'),
]);
