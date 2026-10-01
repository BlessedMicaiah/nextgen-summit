<?php
/* Next Gen Summit: receives the waitlist, registration, volunteer, partner, question and scholarship forms.
   (Registration is paused while the waitlist is open; its handling below is kept for when it returns.)
   Answers JSON to the site's JavaScript, and redirects to a confirmation page
   when a browser posts the form directly (JavaScript off). */
declare(strict_types=1);

require __DIR__ . '/_lib.php';

header('X-Robots-Tag: noindex');
header('Cache-Control: no-store');

$wantsJson = stripos((string) ($_SERVER['HTTP_ACCEPT'] ?? ''), 'application/json') !== false;
$kind = isset($_POST['form-name']) && is_string($_POST['form-name']) ? $_POST['form-name'] : '';

function ngs_reply(bool $ok, string $kind, string $error, int $status, bool $json, array $fields = []): void
{
    if ($json) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        // $fields names the inputs that need attention, so the page can mark them
        echo json_encode($ok ? ['ok' => true] : ['ok' => false, 'error' => $error, 'fields' => $fields]);
        exit;
    }
    if ($ok) {
        $to = $kind === 'scholarship' ? '/scholarship/received/' : (in_array($kind, ['waitlist', 'registration'], true) ? '/registration-received/' : '/thanks/');
        header('Location: ' . $to, true, 303);
        exit;
    }
    http_response_code($status);
    header('Content-Type: text/html; charset=utf-8');
    $back = ['waitlist' => '/tickets/', 'registration' => '/tickets/', 'question' => '/#faq', 'scholarship' => '/scholarship/'][$kind] ?? '/#involved';
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">'
        . '<title>Not sent yet · Next Gen Summit</title>'
        . '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@144,900,100,0&amp;family=Montserrat:wght@500;600;700;800&amp;display=swap">'
        . '<link rel="stylesheet" href="/assets/css/site.css?v=20260930-01"></head><body>'
        . '<div class="received"><main class="received__main">'
        . '<p class="draft-note">Not sent yet</p><h1 class="done__title wm">almost.</h1>'
        . '<p class="done__text">' . htmlspecialchars($error, ENT_QUOTES, 'UTF-8') . '</p>'
        . '<p style="margin-top:28px"><a class="btn btn--lg" href="' . $back . '">Go back and try again</a></p>'
        . '</main></div></body></html>';
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    ngs_reply(false, $kind, 'Please use the form on the site.', 405, $wantsJson);
}

if (!in_array($kind, NGS_KINDS, true)) {
    ngs_reply(false, 'waitlist', 'That form was not recognized.', 400, $wantsJson);
}

// Honeypot: people never see this field, so anything in it is a bot. Pretend it worked.
if (ngs_text($_POST, 'bot-field', 200) !== '') {
    ngs_reply(true, $kind, '', 200, $wantsJson);
}

$email = ngs_text($_POST, 'email', 254);
$emailOk = filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
$errors = [];

if ($kind === 'waitlist') {
    $data = [
        'name' => ngs_text($_POST, 'name', 120),
        'phone' => ngs_text($_POST, 'phone', 30),
        'email' => $email,
    ];
    if ($data['name'] === '') {
        $errors['name'] = 'Please add your name.';
    }
    // any common format is fine ((410) 555-0123, 410.555.0123, +1 410 555 0123); it just needs 7 to 15 digits
    $digits = preg_replace('/\D+/', '', $data['phone']) ?? '';
    if (strlen($digits) < 7 || strlen($digits) > 15 || !preg_match('/^[0-9+().\-\s]+$/', $data['phone'])) {
        $errors['phone'] = 'Please check your phone number.';
    }
    if (!$emailOk) {
        $errors['email'] = 'Please check your email address.';
    }
} elseif ($kind === 'registration') {
    $data = [
        'first_name' => ngs_text($_POST, 'first_name', 80),
        'last_name' => ngs_text($_POST, 'last_name', 80),
        'email' => $email,
        'education_level' => ngs_text($_POST, 'education_level', 20),
        'school_name' => ngs_text($_POST, 'school_name', 150),
        'volunteer_interest' => ngs_text($_POST, 'volunteer_interest', 3),
    ];
    if ($data['first_name'] === '' || $data['last_name'] === '') {
        $errors['first_name'] = 'Please add your first and last name.';
    }
    if (!$emailOk) {
        $errors['email'] = 'Please check your email address.';
    }
    if (!in_array($data['education_level'], ['High School', 'College', 'Other'], true)) {
        $errors['education_level'] = 'Please choose your education level.';
    } elseif ($data['school_name'] === '' && $data['education_level'] !== 'Other') {
        $errors['school_name'] = 'Please add your school name.';
    }
    if (!in_array($data['volunteer_interest'], ['Yes', 'No'], true)) {
        $errors['volunteer_interest'] = 'Please tell us whether you would like to volunteer.';
    }
} elseif ($kind === 'question') {
    $raw = isset($_POST['question']) && is_string($_POST['question']) ? trim($_POST['question']) : '';
    $data = [
        'name' => ngs_text($_POST, 'name', 120),
        'email' => $email,
        'question' => ngs_text($_POST, 'question', 2000),
        'status' => 'new',
    ];
    if ($data['name'] === '') {
        $errors['name'] = 'Please add your full name.';
    }
    if (!$emailOk) {
        $errors['email'] = 'Please check your email address.';
    }
    if ($data['question'] === '') {
        $errors['question'] = 'Please write your question.';
    } elseif ((function_exists('mb_strlen') ? mb_strlen($raw) : strlen($raw)) > 2000) {
        $errors['question'] = 'Please keep your question under 2,000 characters.';
    }
} elseif ($kind === 'scholarship') {
    // the visible wording of each choice, exactly as the form shows it
    $reasons = [
        'afford' => 'I’m unable to afford a ticket right now',
        'easier' => 'Financial assistance would make it easier for me to attend',
        'other' => 'Other',
    ];
    $reasonKey = ngs_text($_POST, 'reason', 10);
    $whyRaw = isset($_POST['why']) && is_string($_POST['why']) ? trim($_POST['why']) : '';
    $whyWords = count(preg_split('/\s+/u', $whyRaw, -1, PREG_SPLIT_NO_EMPTY) ?: []);
    $data = [
        'name' => ngs_text($_POST, 'name', 120),
        'email' => $email,
        'phone' => ngs_text($_POST, 'phone', 30),
        'organization' => ngs_text($_POST, 'organization', 150),
        'why' => ngs_text($_POST, 'why', 1000),
        'reason' => $reasons[$reasonKey] ?? '',
        'reason_other' => $reasonKey === 'other' ? ngs_text($_POST, 'reason_other', 200) : '',
        'commit' => ngs_text($_POST, 'commit', 3),
        'status' => 'new',
    ];
    if ($data['name'] === '') {
        $errors['name'] = 'Please add your full name.';
    }
    if (!$emailOk) {
        $errors['email'] = 'Please check your email address.';
    }
    $digits = preg_replace('/\D+/', '', $data['phone']) ?? '';
    if (strlen($digits) < 7 || strlen($digits) > 15 || !preg_match('/^[0-9+().\-\s]+$/', $data['phone'])) {
        $errors['phone'] = 'Please check your phone number.';
    }
    if ($data['organization'] === '') {
        $errors['organization'] = 'Please add your school, college or organization.';
    }
    if ($whyWords === 0) {
        $errors['why'] = 'Please tell us why you want to attend.';
    } elseif ($whyWords > 75 || (function_exists('mb_strlen') ? mb_strlen($whyRaw) : strlen($whyRaw)) > 1000) {
        $errors['why'] = 'Please keep your answer to 75 words or fewer.';
    }
    if ($data['reason'] === '') {
        $errors['reason'] = 'Please choose a reason.';
    } elseif ($reasonKey === 'other' && $data['reason_other'] === '') {
        $errors['reason_other'] = 'Please add your reason.';
    }
    if (!in_array($data['commit'], ['Yes', 'No'], true)) {
        $errors['commit'] = 'Please choose Yes or No.';
    }
} else {
    $data = [
        'name' => ngs_text($_POST, 'name', 120),
        'email' => $email,
    ];
    if ($kind === 'partner') {   // volunteers give just a name and email
        $data['organization'] = ngs_text($_POST, 'organization', 150);
    }
    if ($data['name'] === '') {
        $errors['name'] = 'Please add your name.';
    }
    if (!$emailOk) {
        $errors['email'] = 'Please check your email address.';
    }
    if ($kind === 'partner' && $data['organization'] === '') {
        $errors['organization'] = 'Please add your organization.';
    }
}

if ($errors) {
    ngs_reply(false, $kind, implode(' ', array_unique(array_values($errors))), 422, $wantsJson, array_keys($errors));
}

try {
    // generous enough for a whole class registering on one campus network
    if (ngs_recent_from_ip(ngs_ip_hash(), 3600) >= 30) {
        ngs_reply(false, $kind, 'Too many submissions from this connection. Please try again in an hour.', 429, $wantsJson);
    }
    // the same question sent twice (a double tap, a retried connection) is kept once
    if ($kind === 'question' && ngs_is_duplicate('question', ['email' => $data['email'], 'question' => $data['question']])) {
        ngs_reply(true, $kind, '', 200, $wantsJson);
    }
    if ($kind === 'scholarship' && ngs_is_duplicate('scholarship', ['email' => $data['email'], 'why' => $data['why']])) {
        ngs_reply(true, $kind, '', 200, $wantsJson);
    }
    ngs_store($kind, $data);
} catch (Throwable $e) {
    error_log('Next Gen Summit form error: ' . $e->getMessage());
    ngs_reply(false, $kind, 'We could not save that right now. Please try again in a moment.', 500, $wantsJson);
}

// the application is saved; the email is a copy for the team, so a failed send never fails the applicant
if ($kind === 'scholarship') {
    ngs_email_scholarship($data);
}

ngs_reply(true, $kind, '', 200, $wantsJson);

/** Sends a new scholarship application to the team inbox, with Reply-To set to the applicant. */
function ngs_email_scholarship(array $d): void
{
    $to = 'hello@nextgensummit.us';
    $from = 'hello@nextgensummit.us';
    $host = preg_replace('/[^a-z0-9.\-]/i', '', (string) ($_SERVER['HTTP_HOST'] ?? 'nextgensummit.us'));
    $oneLine = function ($s) { return trim(preg_replace('/[\r\n]+/', ' ', (string) $s)); };

    $name = $oneLine($d['name'] ?? '');
    $reason = (string) ($d['reason'] ?? '');
    if (($d['reason_other'] ?? '') !== '') {
        $reason .= ': ' . $d['reason_other'];
    }
    $subject = (stripos($host, 'staging.') === 0 ? '[STAGING TEST] ' : '') . 'Scholarship application: ' . $name;
    $body = "A new NextGen Summit scholarship application was submitted.\n\n"
        . 'Full name: ' . $name . "\n"
        . 'Email: ' . $oneLine($d['email'] ?? '') . "\n"
        . 'Phone: ' . $oneLine($d['phone'] ?? '') . "\n"
        . 'School / College / Organization: ' . $oneLine($d['organization'] ?? '') . "\n\n"
        . "Why do you want to attend NextGen Summit?\n" . trim((string) ($d['why'] ?? '')) . "\n\n"
        . "Why are you requesting a scholarship ticket?\n" . $oneLine($reason) . "\n\n"
        . 'Can commit to attending on October 30: ' . $oneLine($d['commit'] ?? '') . "\n\n"
        . 'Submitted: ' . (new DateTime('now', new DateTimeZone('America/New_York')))->format('l, F j, Y \a\t g:i A T') . "\n"
        . 'Review and mark it in the admin: https://' . $host . "/admin/?tab=scholarships\n\n"
        . "Reply to this email to answer the applicant directly.\n";

    $headers = [
        'From: NextGen Summit Website <' . $from . '>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
    ];
    $applicant = filter_var($d['email'] ?? '', FILTER_VALIDATE_EMAIL);
    if ($applicant) {
        $headers[] = 'Reply-To: ' . $applicant;
    }
    $encoded = function_exists('mb_encode_mimeheader') ? mb_encode_mimeheader($subject, 'UTF-8', 'B', "\r\n") : $subject;
    try {
        if (!@mail($to, $encoded, $body, implode("\r\n", $headers), '-f' . $from)) {
            error_log('Next Gen Summit: the scholarship email to ' . $to . ' was not accepted for delivery.');
        }
    } catch (Throwable $e) {
        error_log('Next Gen Summit: scholarship email failed: ' . $e->getMessage());
    }
}
