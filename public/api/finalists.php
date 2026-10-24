<?php
/* The Top 10 Pitch Finalists — the one place their details live.

   EDITING THIS FILE IS THE WHOLE JOB. The page, the cards, the dialog and the pitch videos are
   all drawn from the array below, so a finalist is confirmed by filling in one entry. Nothing
   else has to change: not the layout, not the stylesheet, not the script. The tenth can be
   added on the day without touching anything but line items here.

   WHY TEN SLOTS EXIST BEFORE TEN FINALISTS DO

   The page is being built during the voting period, before the line-up is settled. So all ten
   slots are always present and the layout never reflows as names arrive. A slot with
   'confirmed' => false renders as a clearly marked placeholder: no invented name, no invented
   company, no stock portrait standing in for a real person. It says it is a placeholder on its
   face, and it is not linkable or shareable.

   THIS IS NOT THE VOTING LIST. People's Choice runs over twenty semifinalists in its own
   system; these are the ten who pitch live. The two overlap by rule, not by identity, and
   nothing here casts, counts or links to a vote. Do not add voting to this file.

   HOW TO CONFIRM A FINALIST

     1. Set 'confirmed' => true.
     2. Fill in 'first', 'last', and 'venture' (the business or the pitch title).
     3. Add 'summary' (what problem they are solving), 'bio' (who the founder is) and
        'category' as leadership approves them. Each is omitted from the card if empty --
        nothing is invented to fill a gap.
     4. Drop the portrait into assets/img/finalists/ and set 'shot' to the file stem; the page
        expects <stem>-620.jpg and, if you have it, <stem>-900.jpg. Portraits are shown at 5:7,
        matching the speaker cards, and are never cropped to a face or regenerated.
     5. Set 'video' to the YouTube or Vimeo watch URL. Leave it empty and the back of the card
        simply says the pitch is coming, rather than showing a broken player.

   PUBLICATION STATUS is separate from confirmation, deliberately. A finalist can be known to
   us and still not announced. 'status' is one of:

     'placeholder' the slot is empty. Nothing to show.
     'internal'    details are entered but NOT cleared for announcement. The card is visible
                   only behind the preview gate and is marked internal on its face.
     'published'   cleared by leadership. Visible when the page itself is published.

   Anything you leave out is omitted rather than guessed at. */
declare(strict_types=1);

/** Where portraits live, relative to the web root. */
const NGS_FINALIST_IMG = '/assets/img/finalists/';

/**
 * The ten slots, in running order.
 *
 * @return array<int,array<string,mixed>>
 */
function ngs_finalists(): array
{
    $slots = [
        // ---- slot 1 ----------------------------------------------------------------
        [
            'status' => 'placeholder',
            'confirmed' => false,
            'first' => '', 'last' => '',
            'venture' => '',
            'category' => '',
            'summary' => '',          // ABOUT THE BUSINESS: the problem, and their answer to it
            'bio' => '',              // MEET THE FOUNDER
            'shot' => '',
            'video' => '',
        ],
    ];

    /* Slots 2..9 are the same empty shape. Written as a loop rather than eight copies so the
       shape cannot drift between them; fill one in by replacing it with a literal, exactly
       like slot 1 above. */
    for ($i = 2; $i <= 9; $i++) {
        $slots[] = [
            'status' => 'placeholder',
            'confirmed' => false,
            'first' => '', 'last' => '',
            'venture' => '',
            'category' => '',
            'summary' => '',
            'bio' => '',
            'shot' => '',
            'video' => '',
        ];
    }

    /* ---- slot 10: the People's Choice qualifier ----

       Held open on purpose. The tenth place goes to whoever wins the public vote, and that is
       not known until voting closes on 28 October and the result is certified. Nothing here
       reads the leaderboard: a live standing is not a result, and a card that filled itself in
       from a running tally would announce a winner the competition has not declared. Someone
       enters this one by hand, afterwards, like any other. */
    $slots[] = [
        'status' => 'placeholder',
        'confirmed' => false,
        'reserved' => "People's Choice winner",
        'first' => '', 'last' => '',
        'venture' => '',
        'category' => '',
        'summary' => '',
        'bio' => '',
        'shot' => '',
        'video' => '',
    ];

    if (isset($_GET['demo']) && $_GET['demo'] === '1' && ngs_finalists_demo_allowed()
        && empty($slots[0]['confirmed'])) {
        $slots[0] = ngs_finalists_demo();
    }

    $out = [];
    foreach ($slots as $i => $s) {
        $n = str_pad((string) ($i + 1), 2, '0', STR_PAD_LEFT);
        $name = trim(($s['first'] ?? '') . ' ' . ($s['last'] ?? ''));
        $ok = !empty($s['confirmed']) && $name !== '';
        $status = (string) ($s['status'] ?? 'placeholder');
        if (!$ok) {
            $status = 'placeholder';            // nothing entered: nothing to publish
        } elseif (!in_array($status, ['internal', 'published'], true)) {
            $status = 'internal';               // confirmed but unclassified stays unannounced
        }
        $out[] = [
            'id' => 'finalist-' . $n,
            'n' => $n,
            'confirmed' => $ok,
            'status' => $status,
            'published' => $status === 'published',
            'reserved' => (string) ($s['reserved'] ?? ''),
            'first' => $ok ? (string) $s['first'] : 'Finalist',
            'last' => $ok ? (string) $s['last'] : $n,
            'name' => $ok ? $name : 'Finalist ' . $n,
            'venture' => $ok ? (string) $s['venture'] : 'To be announced',
            'category' => $ok ? (string) ($s['category'] ?? '') : '',
            'summary' => $ok ? (string) ($s['summary'] ?? '') : '',
            'bio' => $ok ? (string) ($s['bio'] ?? '') : '',
            'shot' => $ok ? (string) ($s['shot'] ?? '') : '',
            'video' => $ok ? ngs_finalist_video((string) ($s['video'] ?? '')) : null,
        ];
    }
    return $out;
}

/* ---------- the demo card ----------

   With ten empty slots there is nothing to open, so neither the team nor a reviewer can see
   what a confirmed finalist actually looks like -- the flip, the pitch player, the layout with
   a real portrait in it. That matters while the line-up is still being gathered.

   So ?demo=1 fills the first slot with an obviously fake card. It is fenced to staging and
   localhost, exactly like the mock OTP code, so it cannot appear on the live site however the
   URL is typed. It names no real person and claims no real venture: it says "demo card" on its
   face, and the video is Blender Foundation's Big Buck Bunny, which is Creative Commons and
   belongs to nobody in this competition.

   Delete nothing when the real finalists arrive; a confirmed slot 1 simply wins. */
function ngs_finalists_demo_allowed(): bool
{
    $host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
    return strpos($host, 'staging.') === 0
        || strpos($host, 'localhost') === 0
        || strpos($host, '127.0.0.1') === 0;
}

function ngs_finalists_demo(): array
{
    return [
        'status' => 'internal',
        'confirmed' => true,
        'first' => 'Demo', 'last' => 'Card',
        'venture' => 'Example Venture (demo, not a real finalist)',
        'category' => 'Demo only',
        'summary' => 'This is where ABOUT THE BUSINESS goes: the problem the founder is solving '
            . 'and the answer they are proposing, in a couple of sentences supplied by leadership.',
        'bio' => 'This is where MEET THE FOUNDER goes: a short introduction to the person behind '
            . 'the venture. It is omitted entirely until approved copy exists, rather than filled '
            . 'with anything invented.',
        'shot' => '',
        'video' => 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
    ];
}

/** How many of the ten are filled in. Drives the "9 of 10 confirmed" line on the page. */
function ngs_finalists_confirmed(): int
{
    $n = 0;
    foreach (ngs_finalists() as $f) {
        if ($f['confirmed']) {
            $n++;
        }
    }
    return $n;
}

/**
 * Turn a watch URL into something embeddable, or null.
 *
 * Only YouTube and Vimeo are accepted, and only as an id we rebuild the URL from -- a provider
 * URL pasted straight into an iframe src is an open redirect waiting to happen, and a typo in
 * a spreadsheet should fail closed rather than embed whatever it points at.
 *
 * @return array{embed:string,watch:string,poster:?string}|null
 */
function ngs_finalist_video(string $url): ?array
{
    $url = trim($url);
    if ($url === '') {
        return null;
    }
    if (preg_match('~(?:youtube\.com/(?:watch\?v=|embed/|live/)|youtu\.be/)([A-Za-z0-9_-]{6,20})~', $url, $m)) {
        $id = $m[1];
        return [
            'embed' => 'https://www.youtube-nocookie.com/embed/' . $id . '?autoplay=1&rel=0&modestbranding=1',
            'watch' => 'https://www.youtube.com/watch?v=' . $id,
            'poster' => 'https://i.ytimg.com/vi/' . $id . '/hqdefault.jpg',
        ];
    }
    if (preg_match('~vimeo\.com/(?:video/)?(\d{6,12})~', $url, $m)) {
        $id = $m[1];
        return [
            'embed' => 'https://player.vimeo.com/video/' . $id . '?autoplay=1',
            'watch' => 'https://vimeo.com/' . $id,
            'poster' => null,
        ];
    }
    return null;   // unrecognised: the card says the pitch is coming rather than guessing
}
