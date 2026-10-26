// Upload a release archive to Hostinger and trigger the deploy.
//   node tools/deploy.mjs staging.nextgensummit.us release/staging-<sha>.zip
// Build the archive with tools/release.py first; it refuses unless the branch matches the
// target and is identical to GitHub. Never hand a staging archive to the live domain.
// Mirrors hostinger-api-mcp's static-site flow: the TUS create needs BOTH X-Auth (the file
// browser JWT) and X-Auth-Rest (the rest key); with only one of them the edge answers 403.
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

const API = 'https://developers.hostinger.com';
const TOKEN = process.env.HOSTINGER_API_TOKEN;
const [, , DOMAIN, ARCHIVE] = process.argv;
const CHUNK = 10 * 1024 * 1024;
if (!DOMAIN || !ARCHIVE) {
  console.error('usage: node tools/deploy.mjs <domain> <release/....zip>');
  process.exit(1);
}

/* The archive and the domain must agree, and until today nothing checked.
 *
 * release.py writes both builds into the same folder, and the only difference between
 * them is a line appended to api/config.php pointing NGS_DATA_DIR at the review store.
 * Line 4 of this file has always said "Never hand a staging archive to the live domain" --
 * a sentence of intent with nothing enforcing it, which is exactly the shape of the bug
 * that left "Clear all votes" live on production under a heading reading "Staging only".
 *
 * Getting it wrong once points production at a data directory that does not exist, so
 * every total reads zero; makes pc_store_is_review() answer yes on the live site; and
 * flips the attendee-bonus rule. The votes survive, but the site tells the world the
 * competition is empty until somebody notices.
 *
 * Caught here, before a byte is uploaded, because this is the only place that knows both
 * halves. pc-lib.php now cross-checks the hostname as well, for the same reason you want
 * two of anything that matters.
 */
const archiveName = basename(ARCHIVE);
const archiveIsStaging = archiveName.startsWith('staging-');
const domainIsStaging = /(^|\.)staging\./i.test(DOMAIN);
if (archiveIsStaging !== domainIsStaging) {
  console.error(
    `REFUSED: ${archiveName} is a ${archiveIsStaging ? 'STAGING' : 'PRODUCTION'} archive, ` +
    `but ${DOMAIN} is a ${domainIsStaging ? 'STAGING' : 'PRODUCTION'} host.
` +
    `  A staging archive carries NGS_DATA_DIR pointing at the review store. On the live
` +
    `  host that makes every total read zero and re-arms the destructive admin controls.
` +
    `  Build the right one:  python -I tools/release.py ${domainIsStaging ? 'staging' : 'production'}`
  );
  process.exit(1);
}

/* The credential check comes after the pairing check on purpose: the pairing check needs
 * no credentials, and it is the one standing between a wrong word and the live site. It
 * must be reachable, and testable, without a token in the environment. */
if (!TOKEN) { console.error('HOSTINGER_API_TOKEN is not set'); process.exit(1); }

const api = async (path, init = {}) => {
  const r = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${text.slice(0, 300)}`);
  return body;
};

const sites = await api(`/api/hosting/v1/websites?domain=${encodeURIComponent(DOMAIN)}`);
const site = (sites.data || sites).find(s => s.domain === DOMAIN);
if (!site) throw new Error(`no website named ${DOMAIN} on this account`);
console.log(`site     ${site.domain}  ->  ${site.root_directory}`);

const name = basename(ARCHIVE);
const size = statSync(ARCHIVE).size;
const cred = await api('/api/hosting/v1/files/upload-urls',
  { method: 'POST', body: JSON.stringify({ username: site.username, domain: DOMAIN }) });
const target = `${cred.url.replace(/\/$/, '')}/${name}?override=true`;
const auth = { 'X-Auth': cred.auth_key, 'X-Auth-Rest': cred.rest_auth_key };

const create = await fetch(target, {
  method: 'POST',
  headers: { ...auth, 'upload-length': String(size), 'upload-offset': '0' }
});
if (create.status !== 201) throw new Error(`tus create -> ${create.status} ${(await create.text()).slice(0, 300)}`);
console.log(`create   201  ${name}  ${(size / 1048576).toFixed(2)} MB`);

const bytes = readFileSync(ARCHIVE);
for (let off = 0; off < size; off += CHUNK) {
  const end = Math.min(off + CHUNK, size);
  const r = await fetch(target, {
    method: 'PATCH',
    headers: { ...auth, 'Tus-Resumable': '1.0.0', 'Upload-Offset': String(off),
      'Content-Type': 'application/offset+octet-stream' },
    body: bytes.subarray(off, end)
  });
  if (r.status !== 204 && r.status !== 200) throw new Error(`patch @${off} -> ${r.status} ${(await r.text()).slice(0, 300)}`);
  console.log(`patch    ${r.status}  ${off}-${end}  (offset now ${r.headers.get('upload-offset')})`);
}

const out = await api(`/api/hosting/v1/accounts/${site.username}/websites/${DOMAIN}/deploy`,
  { method: 'POST', body: JSON.stringify({ archive_path: name }) });
console.log('deploy  ', JSON.stringify(out).slice(0, 300));
