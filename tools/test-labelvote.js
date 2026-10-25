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
// matcher below looks for \n. During a release that reads as 'idleLabel not found',
// which is an alarming thing to see and was not true.
const src = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const grab = (name) => {
  const m = src.match(new RegExp('\\n  function ' + name + '[\\s\\S]*?\\n  \\}\\n'));
  if (!m) { console.error(name + ' not found in ' + path); process.exit(1); }
  return m[0];
};
/* left() and spread() are one-liners, which the block matcher above cannot see. They are
   lifted the same way -- out of the shipped file, never retyped here. */
const grabLine = (name) => {
  const m = src.match(new RegExp('\\n  function ' + name + '\\(.*\\n'));
  if (!m) { console.error(name + ' not found in ' + path); process.exit(1); }
  return m[0];
};
const body = grabLine('left') + grabLine('spread') + grab('idleLabel') + grab('labelVoteButton');

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

/* ---- the reel rail's own compact labeller ----
   Same server state, a much smaller box, and its own copy. It is tested separately because
   it went live saying "Closed" in both not-open states, so for the days before voting opened
   all twenty founder cards told visitors the vote was over. */
const reel = (state) =>
  new Function('STATE', '$',
    grabLine('left') + grabLine('spread') + grab('labelReelVote') + '; return labelReelVote;')(
    state, (sel, root) => (sel === 'small' ? root.small : null));

function rbtn(id) {
  const cls = new Set();
  return {
    disabled: false, small: { textContent: '' },
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c) },
    on: () => cls.has('reel__act--on'),
    getAttribute: (k) => (k === 'data-pc-vote' ? id : null)
  };
}

function r(name, state, d, id, want) {
  const b = rbtn(id);
  reel(state)(b, d);
  const got = { label: b.small.textContent, disabled: b.disabled, on: b.on() };
  const ok = got.label === want.label && got.disabled === !!want.disabled
          && got.on === !!want.on;
  if (ok) {
    console.log('ok   ' + name + '  -> ' + JSON.stringify(got.label) +
      (got.disabled ? ' [disabled]' : '') + (got.on ? ' [highlighted]' : ''));
  } else {
    fails++;
    console.log('FAIL ' + name + '\n   got  ' + JSON.stringify(got) +
                          '\n   want ' + JSON.stringify(want));
  }
}

console.log('--- the reel rail, where the box fits one word ---');
r('before voting opens, NOT "Closed"', 'coming-soon', VISITOR, 'entrant-05',
  { label: 'Soon', disabled: true });
r('after voting closes',               'closed',      VISITOR, 'entrant-05',
  { label: 'Closed', disabled: true });
r('open, nobody verified yet',         'open',        VISITOR,  'entrant-05', { label: 'Vote' });
r('open, verified, no vote today',     'open',        NOVOTEYET,'entrant-05', { label: 'Vote' });
r('their founder, bonus to come',      'open',        ATTENDEE, 'entrant-01',
  { label: '+2 bonus', on: true });
r('their founder, all three spent',    'open',        ALLTHREE, 'entrant-01',
  { label: 'Voted', on: true });
r('a different founder, after +1',     'open',        PLUS1,    'entrant-07', { label: 'Used' });

/* ---------------------------------------------------------------------------
   The flexible rule, trialled on staging.

   Three votes a day for a registered attendee, spent on whoever they like. The question a
   button answers stops being "which founder did you back" and becomes "how many votes have
   you left", which is why every one of these cases fixes the label for a founder the voter
   has NOT backed -- entrant-07 throughout, while today_entrant is entrant-01.

   Under the old rule all of them read "Today's vote is used". With two votes still in hand
   that sentence is false, and false on nineteen cards at once.
   --------------------------------------------------------------------------- */
const sp = (o) => Object.assign({ verified: true, spread: true, mode: 'daily' }, o);

const S_FRESH3 = sp({ allowance: 3, used: 0, remaining: 3 });
const S_LEFT2  = sp({ allowance: 3, used: 1, remaining: 2, today_entrant: 'entrant-01' });
const S_LEFT1  = sp({ allowance: 3, used: 2, remaining: 1, today_entrant: 'entrant-01' });
const S_SPENT3 = sp({ allowance: 3, used: 3, remaining: 0, today_entrant: 'entrant-01' });
const S_FRESH1 = sp({ allowance: 1, used: 0, remaining: 1 });
const S_SPENT1 = sp({ allowance: 1, used: 1, remaining: 0, today_entrant: 'entrant-05' });
const S_UNVER  = { verified: false, spread: true };

console.log('\n--- the flexible rule: the gallery ---');
STATE = 'open';
t('attendee, nothing spent',        S_FRESH3, 'entrant-07', { label: 'Vote' });
t('attendee, one spent, two left',  S_LEFT2,  'entrant-07', { label: 'Vote · 2 left' });
t('attendee, two spent, one left',  S_LEFT1,  'entrant-07', { label: 'Vote · 1 left' });
t('attendee, all three spent',      S_SPENT3, 'entrant-07', { label: 'All votes used today', ghost: true });
t('the founder they already backed, votes left', S_LEFT2, 'entrant-01', { label: 'Vote · 2 left' });
t('not registered, their one vote intact', S_FRESH1, 'entrant-07', { label: 'Vote' });
t('not registered, vote spent',     S_SPENT1, 'entrant-07', { label: 'All votes used today', ghost: true });
t('not verified at all',            S_UNVER,  'entrant-07', { label: 'Vote' });

console.log('\n--- the flexible rule: the reel rail ---');
r('attendee, nothing spent',        'open', S_FRESH3, 'entrant-07', { label: 'Vote' });
r('attendee, two left',             'open', S_LEFT2,  'entrant-07', { label: '2 left' });
r('attendee, one left',             'open', S_LEFT1,  'entrant-07', { label: '1 left' });
r('attendee, all three spent',      'open', S_SPENT3, 'entrant-07', { label: 'Used', on: true });
r('not registered, vote intact',    'open', S_FRESH1, 'entrant-07', { label: 'Vote' });

console.log(fails ? '\n' + fails + ' FAILED' : '\nall 33 pass');
process.exit(fails ? 1 : 0);
