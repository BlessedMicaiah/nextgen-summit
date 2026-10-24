/* What every vote button on the People's Choice page should say, and why.

   This exercises the REAL functions, lifted out of the shipped file rather than copied here,
   so the test cannot quietly drift away from what gets deployed. It is a regression test for
   a specific failure: the gallery once disabled all twenty cards the moment a ballot existed
   in sessionStorage and labelled them "You have already voted" -- including the founder the
   vote had just gone to, which was the only route to an attendee's two bonus points.

   Run:  node tools/test-labelvote.js public/assets/js/peoples-choice.js
*/
const fs = require('fs');

const path = process.argv[2] || 'public/assets/js/peoples-choice.js';
// Normalised, because git hands this file back with CRLF on a Windows checkout and the
// matcher below looks for 
. During a release that reads as 'idleLabel not found',
// which is an alarming thing to see and was not true.
const src = fs.readFileSync(path, 'utf8').replace(/
/g, '
');
const grab = (name) => {
  const m = src.match(new RegExp('\\n  function ' + name + '[\\s\\S]*?\\n  \\}\\n'));
  if (!m) { console.error(name + ' not found in ' + path); process.exit(1); }
  return m[0];
};
const body = grab('idleLabel') + grab('labelVoteButton');

const COPY = {
  'open':        { vote: 'Vote for this pitch' },
  'closed':      { vote: 'Voting closed' },
  'coming-soon': { vote: 'Voting opens soon' }
};
/* STATE and COPY are free variables in the lifted code, so they are handed in as parameters
   and the function is rebuilt per case. Cheaper than faking a module scope. */
const build = (state) =>
  new Function('STATE', 'COPY', body + '; return labelVoteButton;')(state, COPY);

/* A stand-in for a button. inCard false means the profile dialog's, which is not in a .pce. */
function btn(id, inCard) {
  const cls = new Set();
  return {
    disabled: false, textContent: '',
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c) },
    ghost: () => cls.has('btn--ghost'),
    getAttribute: (k) => (k === 'data-pc-vote' ? id : null),
    closest: (sel) => (sel === '.pce' && inCard !== false ? {} : null)
  };
}

let STATE = 'open', fails = 0;

/* want: { label, disabled, ghost } -- ghost meaning outlined rather than solid. Only the
   founder backed today stays solid once a vote exists; the rest are live but must not look
   like the main offer on the page. */
function t(name, d, id, want, inCard) {
  const b = btn(id, inCard);
  build(STATE)(b, d);
  const got = { label: b.textContent, disabled: b.disabled, ghost: b.ghost() };
  const ok = got.label === want.label && got.disabled === !!want.disabled
          && got.ghost === !!want.ghost;
  if (ok) {
    console.log('ok   ' + name + '  -> ' + JSON.stringify(got.label) +
      (got.disabled ? ' [disabled]' : '') + (got.ghost ? ' [outlined]' : ''));
  } else {
    fails++;
    console.log('FAIL ' + name + '\n   got  ' + JSON.stringify(got) +
                          '\n   want ' + JSON.stringify(want));
  }
}

/* The states pc-otp.php reports, named for the person in them. */
const VISITOR   = { ok: true, verified: false };
const NOVOTEYET = { ok: true, verified: true, today_entrant: null, used: 0, remaining: 1,
                    bonus_eligible: true, bonus_claimable: false };
const PLUS1     = { ok: true, verified: true, today_entrant: 'entrant-01', used: 1,
                    remaining: 0, bonus_eligible: true, bonus_claimable: false };
const ATTENDEE  = { ok: true, verified: true, today_entrant: 'entrant-01', used: 1,
                    remaining: 2, bonus_eligible: false, bonus_claimable: true };
const ALLTHREE  = { ok: true, verified: true, today_entrant: 'entrant-01', used: 3,
                    remaining: 0, bonus_eligible: false, bonus_claimable: false };

const USED = 'Today’s vote is used';
const BONUS = 'View my vote & +2 bonus';

console.log('--- the gallery, voting open ---');
t('a visitor who has not verified', VISITOR,  'entrant-05', { label: 'Vote' });
t('verified, has not voted yet',    NOVOTEYET,'entrant-05', { label: 'Vote' });
t('cast +1, can still check their registration',
                                    PLUS1,    'entrant-01', { label: BONUS });
t('cast +1, attendee with +2 to claim',
                                    ATTENDEE, 'entrant-01', { label: BONUS });
t('gave all three to this founder', ALLTHREE, 'entrant-01', { label: 'View my 3 points' });
t('another founder, after +1',      PLUS1,    'entrant-07', { label: USED, ghost: true });
t('another founder, after all 3',   ALLTHREE, 'entrant-07', { label: USED, ghost: true });

console.log('--- the profile dialog, same labeller, its own copy ---');
t('profile, not voted',             VISITOR,  'entrant-05',
  { label: 'Vote for this pitch' }, false);
t('profile, their founder',         PLUS1,    'entrant-01', { label: BONUS }, false);
t('profile, another founder',       PLUS1,    'entrant-07',
  { label: USED, ghost: true }, false);

console.log('--- not open ---');
STATE = 'closed';
t('closed, their own founder',      PLUS1,    'entrant-01',
  { label: 'Voting closed', disabled: true });
t('closed, a visitor',              VISITOR,  'entrant-05',
  { label: 'Voting closed', disabled: true });
STATE = 'coming-soon';
t('not opened yet',                 VISITOR,  'entrant-05',
  { label: 'Voting opens soon', disabled: true });

console.log(fails ? '\n' + fails + ' FAILED' : '\nall ' + 13 + ' pass');
process.exit(fails ? 1 : 0);
