# Next Gen Summit

The microsite for Next Gen Summit. The site currently collects a **waitlist**; the date, venue and registration form are paused until details are announced.

It's plain HTML, CSS and JavaScript with one small PHP backend for the forms. There is no framework, no build step and no separate database server. Waitlist sign-ups are stored in a SQLite database on the host, and a password-protected admin page shows them.

```
nextgen-summit/
├── README.md
├── tools/make-config.mjs         creates public/api/config.php with a new admin password
└── public/                       everything that goes online (upload its CONTENTS)
    ├── index.html                the site, including the waitlist, volunteer and partner forms
    ├── .htaccess                 security headers, caching, blocks data files
    ├── api/
    │   ├── register.php          receives waitlist, registration, volunteer and partner forms
    │   ├── _lib.php              storage helpers (not web-accessible)
    │   ├── config.php            admin password hash and secrets (not in git, not web-accessible)
    │   ├── config.example.php    template; generate the real file with tools/make-config.mjs
    │   └── .htaccess
    ├── admin/index.php           the admin page: /admin/
    ├── data/                     fallback data folder, locked by .htaccess
    ├── registration-received/    confirmation page when JavaScript is off
    ├── thanks/                   volunteer and partner confirmation page
    └── assets/                   css, js, images
```

## "Who NextGen is for" images

The three photos in the 17—29 section were generated with Higgsfield (Soul 2.0). The 2K originals are kept locally in `source-images/gen/` (ignored by git because of their size). To rebuild the web sizes after replacing an original, run `sh tools/make-gen-images.sh`: it trims the film border, crops each frame to its ratio and writes 600/900/1200px greyscale JPEGs to `public/assets/img/`.

## Updating CSS or JavaScript

Browsers keep `site.css`, `site.js` and `liquid.js` for 7 days (see `.htaccess`). Whenever you change one of them, bump the `?v=` date on every link to it (`index.html`, `registration-received/`, `thanks/`, `admin/index.php`, `api/register.php`) so returning visitors get the new file straight away.

## Search engines

The homepage is indexable, with a canonical link to `https://nextgensummit.us/`. `robots.txt` keeps `/admin/`, `/api/` and `/data/` out of search results and points to `sitemap.xml`. The admin page, form endpoint and confirmation pages each send their own noindex.

## Hosting requirements

Any host with **PHP 7.4 or newer** and Apache or LiteSpeed (`.htaccess` support). Hostinger web hosting qualifies. SQLite (`pdo_sqlite`) is used when available, otherwise submissions go to a JSON Lines file. Netlify and other static-only hosts cannot run the forms.

## Deploying to Hostinger

**Nothing is released that is not on GitHub**, live or staging. Commit, push, then build the upload with:

    python tools/release.py production   # from main          -> release/nextgensummit.us-<commit>.zip
    python tools/release.py staging      # from monday-launch -> release/staging-<commit>.zip

The script stops unless the right branch is checked out, clean, and identical to GitHub. The staging
build adds noindex, drops the sitemap and keeps its own data folder (`nextgen-data-staging`).

1. Deploy the zip from `release/`: the live one to nextgensummit.us, the staging one to staging.nextgensummit.us.
2. Upload and extract into the domain's `public_html` folder (hPanel File Manager, or the Hostinger connector).
3. Turn on SSL for the domain in hPanel, then **Force HTTPS**.
4. Test: join the waitlist once, sign in at `/admin/`, confirm it appears, then delete it.

## Where registrations are stored

`register.php` saves every submission to `nextgen-<random>.sqlite` in a `nextgen-data` folder **next to** `public_html` (outside the website, so it can never be downloaded). If the host does not allow that, it falls back to `public_html/data/`, which `.htaccess` blocks from the web. The file name includes a random key from `config.php`.

**Back up the data** before re-deploying or deleting the site: download the CSV from the admin page, or copy the `nextgen-data` folder in File Manager. Re-uploading the site does not touch `nextgen-data`.

## The admin page

Go to `https://your-domain/admin/` and sign in with the admin password.

- Counts: total registrations, unique emails, college, high school, other, and how many want to volunteer.
- A searchable table of registrations (newest first, times in Eastern Time). Emails that registered more than once are marked "Repeat".
- A second tab for volunteer and partner notes.
- **Export CSV** for Excel or Google Sheets.
- **Delete** for test entries or duplicates.

The admin password lives in `public/api/config.php`, which is **not in this repository** (it holds the password hash and the site secrets). To create it on a new machine or server, or to change the password, run this from the project folder:

```
node tools/make-config.mjs          # creates config.php if missing and prints the password once
node tools/make-config.mjs --force  # replaces it with a new password
```

Then upload the new `config.php` to `public_html/api/`. Replacing it also changes the data key, so the site starts a fresh database file. Export your CSV first.

## Spam protection

- A hidden honeypot field (`bot-field`). Anything that fills it is quietly discarded while the bot sees a success.
- Server-side validation of every field.
- At most 30 submissions per hour from one connection (enough for a whole class on one campus network).

## Waitlist form fields

Posted with `form-name` = `waitlist`. The admin page lists waitlist sign-ups and any earlier registrations together, with a List column telling them apart.

| Field | Name posted | Values |
|---|---|---|
| Name | `name` | required |
| Phone number | `phone` | required; any common format with 7 to 15 digits |
| Email | `email` | required, valid email |

## Restoring the registration form

The original registration form and its confirmation are commented out inside the `#registration` drawer in `public/index.html` (search for `REGISTRATION FORM`). Uncomment that block and delete the waitlist form above it. `site.js` and `register.php` handle either form, so nothing else needs to change. Also restore the date, venue and cost copy you want shown.

## Registration form fields (paused)

| Field | Name posted | Values |
|---|---|---|
| First Name | `first_name` | required |
| Last Name | `last_name` | required |
| Email Address | `email` | required, valid email |
| Education Level | `education_level` | `High School`, `College`, `Other` |
| School Name | `school_name` | required unless Education Level is Other |
| Interested in Volunteering? | `volunteer_interest` | `Yes`, `No` |

The form sends in place and shows its confirmation. With JavaScript off, the browser posts normally and lands on `/registration-received/`. On a plain local preview (file:// or localhost) nothing is sent and the confirmation says so.

## Still to do

- Announce the lineup. Section 04 holds three "to be announced" cards showing an empty stage, so nothing
  suggests who is coming. Replace one card at a time as each speaker is confirmed: swap the picture for
  a portrait, put the name in `.person__role` and the title in `.person__status`, and drop `.person__tag`.
- Host the remaining Unsplash photos locally and credit the photographers.
