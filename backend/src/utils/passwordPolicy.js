'use strict';

// Rules for a password a PERSON chooses (changing their own, or HR typing one for them).
// A generated temporary password is random and is not checked here.
//
//   HR / admin accounts   at least 12 characters: one of them can read everyone's screenshots,
//                         audio and pay, so it is the account worth guessing
//   everyone else         at least 8 characters
//   everybody             not a well-known password, not made from the person's own name or email,
//                         not one repeated character or an obvious run like 123456789012
//
// "Well known" is judged after undoing the usual tricks: Password123!, P@ssw0rd and PASSWORD all
// become "password".

const MIN_LENGTH = { admin: 12, leader: 8, user: 8 };

// Letters only, lower case. A password is reduced to this form before it is looked up.
const COMMON = new Set([
  'password', 'passwort', 'pass', 'passw', 'passcode', 'passphrase', 'letmein', 'welcome', 'welcome', 'login',
  'admin', 'administrator', 'root', 'user', 'guest', 'test', 'testing', 'tester', 'demo', 'default', 'changeme',
  'change', 'temp', 'temporary', 'secret', 'private', 'master', 'access', 'trustno', 'qwerty', 'qwertyui',
  'qwertyuiop', 'qwertz', 'azerty', 'asdf', 'asdfg', 'asdfgh', 'asdfghj', 'asdfghjk', 'asdfghjkl', 'zxcv',
  'zxcvb', 'zxcvbn', 'zxcvbnm', 'qazwsx', 'qazwsxedc', 'abc', 'abcd', 'abcde', 'abcdef', 'abcdefg', 'abcdefgh',
  'abcdefghi', 'abcdefghij', 'abcdefghijkl', 'iloveyou', 'loveyou', 'loveme', 'monkey', 'dragon', 'football',
  'baseball', 'soccer', 'hockey', 'cricket', 'batman', 'superman', 'spiderman', 'starwars', 'pokemon',
  'sunshine', 'princess', 'shadow', 'michael', 'jennifer', 'jessica', 'charlie', 'donald', 'freedom',
  'whatever', 'computer', 'internet', 'killer', 'hello', 'helloworld', 'hellohello', 'flower', 'summer',
  'winter', 'spring', 'autumn', 'monday', 'friday', 'sunday', 'january', 'february', 'march', 'april', 'may',
  'june', 'july', 'august', 'september', 'october', 'november', 'december', 'company', 'office', 'work',
  'workbuddy', 'kdtracker', 'kdmarketing', 'kdmedia', 'marketing', 'employee', 'manager', 'hrmanager',
  'payroll', 'india', 'tamil', 'tamilnadu', 'chennai', 'madurai', 'srilanka', 'colombo', 'jaffna', 'london',
  'newyork', 'america', 'canada', 'ganesh', 'murugan', 'krishna', 'vinayagar', 'amma', 'appa', 'ammaappa',
  'iloveindia', 'google', 'facebook', 'whatsapp', 'gmail', 'yahoo', 'hotmail', 'outlook', 'microsoft',
]);

// Substitutions people use to dress a word up: p@ssw0rd, $ecret, he11o.
const LOOK_ALIKE = { '@': 'a', '4': 'a', '0': 'o', '3': 'e', '$': 's', '5': 's', '1': 'l', '!': 'i', '7': 't' };

const lettersOnly = (s) => s.replace(/[^a-z]/g, '');
const undoLookAlikes = (s) => [...s].map((c) => LOOK_ALIKE[c] || c).join('');

/**
 * The shapes a password can be reduced to before it is looked up. Digits and symbols on the ends
 * ("Welcome@2026", "2026welcome") are dropped before look-alikes are undone, otherwise the 0 in
 * the year would turn into an "o" and hide the word.
 */
function reductions(password) {
  const lower = password.toLowerCase();
  const trimmed = lower.replace(/^[^a-z]+|[^a-z]+$/g, '');
  return [lettersOnly(lower), lettersOnly(undoLookAlikes(trimmed)), lettersOnly(undoLookAlikes(lower))];
}

/** True for "aaaaaaaaaaaa" and for runs such as "123456789012" or "abcdefghijkl" (up or down). */
function isTrivial(password) {
  if (/^(.)\1+$/.test(password)) return true;
  if (password.length < 6) return false;
  const chars = [...password.toLowerCase()];
  // A step of one up or down; digits wrap round (9 then 0, 0 then 9), as on a keypad row.
  const stepOf = (a, b) => {
    if (/\d/.test(a) && /\d/.test(b)) return ((Number(b) - Number(a) + 10) % 10 === 1 ? 1 : (Number(b) - Number(a) + 10) % 10 === 9 ? -1 : 0);
    return b.charCodeAt(0) - a.charCodeAt(0);
  };
  const steps = chars.slice(1).map((c, i) => stepOf(chars[i], c));
  return steps.every((s) => s === 1) || steps.every((s) => s === -1);
}

/** Words of at least 4 letters from a name or the part of an email before the @. */
function personalWords({ email, name }) {
  const words = [];
  if (email) words.push(String(email).split('@')[0]);
  if (name) words.push(...String(name).split(/\s+/));
  return words.map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, '')).filter((w) => w.length >= 4);
}

/**
 * @param {string} password
 * @param {{ role?: 'admin'|'leader'|'user', email?: string, name?: string }} [who]
 * @returns {string|null} what is wrong with it, in words a person can act on; null when it is fine
 */
function check(password, who = {}) {
  const min = MIN_LENGTH[who.role] || MIN_LENGTH.user;
  const text = String(password ?? '');

  if (text.length < min) {
    return who.role === 'admin'
      ? `An HR / Admin password must be at least ${min} characters. A few words you will remember work well, for example "blue-tea-morning-bus".`
      : `The password must be at least ${min} characters.`;
  }
  if (isTrivial(text)) return 'That password is too easy to guess (a repeated character or an obvious run). Choose something less predictable.';
  if (reductions(text).some((r) => COMMON.has(r))) return 'That is a very common password. Choose something that is not on every attacker’s list.';

  const lower = text.toLowerCase();
  if (personalWords(who).some((w) => lower.includes(w))) {
    return 'The password must not contain your name or email address.';
  }
  return null;
}

module.exports = { check, MIN_LENGTH };
