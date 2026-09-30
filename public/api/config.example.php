<?php
/* Template for public/api/config.php, the site's private settings.
   Do not fill this in by hand. From the project folder run:

       node tools/make-config.mjs

   It writes config.php with a fresh admin password (printed once) and fresh secrets.
   config.php is ignored by git so the real values never reach the repository. */
declare(strict_types=1);

const NGS_ADMIN_SALT = 'generated';
const NGS_ADMIN_HASH = 'generated';
const NGS_SECRET = 'generated';
const NGS_DATA_KEY = 'generated';

// Optional: the homepage ticket counter (api/attendee-count.php) reads Eventbrite with this.
// Eventbrite > Account Settings > Developer Links > API Keys > "Your private token".
// Add it by hand below the generated lines; it stays on the server and is never sent to browsers.
// const NGS_EVENTBRITE_TOKEN = 'paste-the-private-token-here';
