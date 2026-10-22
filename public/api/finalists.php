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
     3. Add 'blurb' (one or two sentences) and 'category' when they are supplied.
     4. Drop the portrait into assets/img/finalists/ and set 'shot' to the file stem; the page
        expects <stem>-620.jpg and, if you have it, <stem>-900.jpg. Portraits are shown at 5:7,
        matching the speaker cards.
     5. Set 'video' to the YouTube or Vimeo watch URL. Leave it empty and the back of the card
        simply says the pitch is coming, rather than showing a broken player.

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
            'confirmed' => false,
            'first' => '', 'last' => '',
            'venture' => '',
            'category' => '',
            'blurb' => '',
            'shot' => '',
            'video' => '',
        ],
    ];

    /* Slots 2..10 are the same empty shape. Written as a loop rather than nine copies so that
       the shape cannot drift between them; fill one in by replacing it with a literal, exactly
       like slot 1 above. */
    for ($i = 2; $i <= 10; $i++) {
        $slots[] = [
            'confirmed' => false,
            'first' => '', 'last' => '',
            'venture' => '',
            'category' => '',
            'blurb' => '',
            'shot' => '',
            'video' => '',
        ];
    }

    $out = [];
    foreach ($slots as $i => $s) {
        $n = str_pad((string) ($i + 1), 2, '0', STR_PAD_LEFT);
        $name = trim(($s['first'] ?? '') . ' ' . ($s['last'] ?? ''));
        $ok = !empty($s['confirmed']) && $name !== '';
        $out[] = [
            'id' => 'finalist-' . $n,
            'n' => $n,
            'confirmed' => $ok,
            'first' => $ok ? (string) $s['first'] : 'Finalist',
            'last' => $ok ? (string) $s['last'] : $n,
            'name' => $ok ? $name : 'Finalist ' . $n,
            'venture' => $ok ? (string) $s['venture'] : 'To be announced',
            'category' => $ok ? (string) ($s['category'] ?? '') : '',
            'blurb' => $ok ? (string) ($s['blurb'] ?? '') : '',
            'shot' => $ok ? (string) ($s['shot'] ?? '') : '',
            'video' => $ok ? ngs_finalist_video((string) ($s['video'] ?? '')) : null,
        ];
    }
    return $out;
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
