/* Exercise the REAL idleLabel + labelVoteButton, lifted out of the shipped file. */
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const grab = (name) => {
  const m = src.match(new RegExp('\n  function ' + name + '[\\s\\S]*?\n  \\}\n'));
  if (!m) { console.error(name + ' not found in ' + process.argv[2]); process.exit(1); }
  return m[0];
};
const body = grab('idleLabel') + grab('labelVoteButton');

let STATE = 'open';
const COPY = { 'open': { vote: 'Vote for this pitch' }, 'closed': { vote: 'Voting closed' },
               'coming-soon': { vote: 'Voting opens soon' } };
/* STATE and COPY are free variables in the lifted code, so hand them in as parameters and
   rebuild per case -- cheaper than faking a module scope. */
const fn = (state) => new Function('STATE', 'COPY', body + '; return labelVoteButton;')(state, COPY);

/* inCard mirrors a gallery button; the profile's button is not inside a .pce */
function btn(id, inCard) {
  return { _a: { 'data-pc-vote': id }, disabled: false, textContent: '',
           getAttribute(k) { return this._a[k]; },
           closest(sel) { return (sel === '.pce' && inCard !== false) ? {} : null; } };
}
let fails = 0;
function t(name, d, id, wantLabel, wantDisabled, inCard) {
  const b = btn(id, inCard);
  fn(STATE)(b, d);
  const ok = b.textContent === wantLabel && b.disabled === wantDisabled;
  if (!ok) { fails++; console.log('FAIL ' + name + '\n   got  ' +
    JSON.stringify(b.textContent) + ' disabled=' + b.disabled + '\n   want ' +
    JSON.stringify(wantLabel) + ' disabled=' + wantDisabled); }
  else console.log('ok   ' + name + '  -> ' + JSON.stringify(b.textContent) +
    (b.disabled ? ' [disabled]' : ''));
}

const UNVERIFIED = { ok: true, verified: false };
const NOVOTE = { ok: true, verified: true, today_entrant: null, remaining: 1, used: 0,
                 bonus_eligible: true, bonus_claimable: false };
const PLUS1_ELIGIBLE = { ok: true, verified: true, today_entrant: 'entrant-01', remaining: 0,
                 used: 1, bonus_eligible: true, bonus_claimable: false };
const PLUS1_CLAIMABLE = { ok: true, verified: true, today_entrant: 'entrant-01', remaining: 2,
                 used: 1, bonus_eligible: false, bonus_claimable: true };
const ALL3 = { ok: true, verified: true, today_entrant: 'entrant-01', remaining: 0, used: 3,
                 bonus_eligible: false, bonus_claimable: false };

console.log('--- voting open ---');
t('not verified, any card',            UNVERIFIED,       'entrant-05', 'Vote', false);
t('verified, has not voted',           NOVOTE,           'entrant-05', 'Vote', false);
t('cast +1, bonus check available',    PLUS1_ELIGIBLE,   'entrant-01', 'View my vote & +2 bonus', false);
t('cast +1, attendee, +2 to claim',    PLUS1_CLAIMABLE,  'entrant-01', 'View my vote & +2 bonus', false);
t('all 3 given, own card',             ALL3,             'entrant-01', 'View my 3 points', false);
t('another founder after +1',          PLUS1_ELIGIBLE,   'entrant-07', 'Today\u2019s vote is used', false);
t('another founder after all 3',       ALL3,             'entrant-07', 'Today\u2019s vote is used', false);

console.log('--- the profile dialog button, same labeller ---');
t('profile, not voted',                UNVERIFIED,       'entrant-05', 'Vote for this pitch', false, false);
t('profile, own founder, bonus open',  PLUS1_ELIGIBLE,   'entrant-01', 'View my vote & +2 bonus', false, false);
t('profile, another founder',          PLUS1_ELIGIBLE,   'entrant-07', 'Today’s vote is used', false, false);

console.log('--- voting closed ---');
STATE = 'closed';
t('closed, own card',                  PLUS1_ELIGIBLE,   'entrant-01', 'Voting closed', true);
t('closed, unverified',                UNVERIFIED,       'entrant-05', 'Voting closed', true);
STATE = 'coming-soon';
t('not open yet',                      UNVERIFIED,       'entrant-05', 'Voting opens soon', true);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall pass');
process.exit(fails ? 1 : 0);
