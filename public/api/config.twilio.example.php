<?php
/* Twilio Verify credentials — TEMPLATE.
   ============================================================================
   Copy this file to  config.twilio.php  ON THE SERVER and fill in the values.

   Do not create config.twilio.php on a laptop and do not commit it:
     - .gitignore excludes config.*.php, so git will not take it
     - api/.htaccess denies config*.php, so the web cannot serve it
     - tools/release.py skips it, so a deploy never carries it anywhere

   That last point matters: a deploy copies files over the top and does not delete
   what it finds, so a config.twilio.php you place on the server stays put through
   every future release. It is written once, by you, and never travels.

   Nothing here is read until PC_TWILIO_ENABLED is true. Until then the voting page
   behaves exactly as it does today and no billable request can be made.
   ============================================================================ */
declare(strict_types=1);

/* The master switch. Leave false until the credentials below are real and a spending
   cap is set in the Twilio Console. With it false, no SMS can be sent by accident. */
const PC_TWILIO_ENABLED = false;

/* From the Twilio Console.
     ACCOUNT SID   Console home, begins AC
     API KEY SID   Account > API keys & tokens, begins SK
     API SECRET    shown ONCE when the key is created; if lost, make a new key
     VERIFY SID    Verify > Services > your service, begins VA              */
const PC_TWILIO_ACCOUNT_SID = 'AC_REPLACE_ME';
const PC_TWILIO_API_KEY     = 'SK_REPLACE_ME';
const PC_TWILIO_API_SECRET  = 'REPLACE_ME';
const PC_TWILIO_VERIFY_SID  = 'VA_REPLACE_ME';

/* Limits enforced by our server, in front of anything Twilio charges for.
   These are the brake on a bill, so they are deliberately tight to begin with. */
const PC_SMS_MAX_PER_NUMBER_PER_DAY = 5;    // codes to one number in a day
const PC_SMS_MIN_SECONDS_BETWEEN    = 60;   // a resend to the same number
const PC_SMS_MAX_PER_IP_PER_HOUR    = 20;   // codes requested from one address

/* ---------------------------------------------------------------------------
   THE TWO HARD STOPS. A Twilio usage alert is an email; it does not stop
   anything. These do, because they refuse to make the call at all.

   Both fail closed: with PC_TWILIO_ENABLED true and the allowlist empty, no
   real message can be sent to anyone. Turning the flag on by itself cannot
   start texting the public.
   --------------------------------------------------------------------------- */

/* Only these numbers may receive a REAL message. Any format is accepted and
   normalised; use the full number including country code. Empty = nobody. */
const PC_SMS_LIVE_ALLOWLIST = [
    // '+14105550143',   <- the one authorised test handset, and nothing else
];

/* A hard ceiling on real messages this server will ever send, counted from the
   log. When it is reached the code refuses to call Twilio, whatever else is
   configured. Raise it deliberately; it is the last thing between a bug and a
   bill. 3 is enough for one test with two retries. */
const PC_SMS_LIVE_MAX_TOTAL = 3;

/* Country allow-list. Restricting this is the single most effective defence against
   SMS pumping, where someone scripts thousands of codes to premium international
   ranges. Set the same restriction in the Twilio Console as well: a setting that
   lives only in our code is one deploy away from being gone. */
const PC_SMS_ALLOWED_COUNTRIES = ['US', 'CA'];
