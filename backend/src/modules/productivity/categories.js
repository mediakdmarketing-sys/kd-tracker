'use strict';

// Built-in application categories. Admin overrides in `app_categories` win over these.
//
// Keys are normalised names (see normaliseApp). Anything not listed here and not overridden is
// 'neutral' — the score never punishes an app nobody has classified yet.

const DEFAULTS = {
  // Productive: building, designing, analysing
  code: 'productive',
  'visual studio code': 'productive',
  'visual studio': 'productive',
  'intellij idea': 'productive',
  pycharm: 'productive',
  'android studio': 'productive',
  xcode: 'productive',
  'sublime text': 'productive',
  terminal: 'productive',
  'windows terminal': 'productive',
  powershell: 'productive',
  iterm2: 'productive',
  figma: 'productive',
  photoshop: 'productive',
  illustrator: 'productive',
  excel: 'productive',
  'microsoft excel': 'productive',
  word: 'productive',
  'microsoft word': 'productive',
  powerpoint: 'productive',
  'microsoft powerpoint': 'productive',
  postman: 'productive',
  notion: 'productive',
  jira: 'productive',

  // Neutral: communication and general browsing — useful or not depending on the day
  chrome: 'neutral',
  'google chrome': 'neutral',
  firefox: 'neutral',
  edge: 'neutral',
  'microsoft edge': 'neutral',
  safari: 'neutral',
  slack: 'neutral',
  teams: 'neutral',
  'microsoft teams': 'neutral',
  zoom: 'neutral',
  'zoom.us': 'neutral',
  outlook: 'neutral',
  'microsoft outlook': 'neutral',
  mail: 'neutral',
  explorer: 'neutral',
  finder: 'neutral',

  // Distracting
  spotify: 'distracting',
  netflix: 'distracting',
  youtube: 'distracting',
  vlc: 'distracting',
  steam: 'distracting',
  discord: 'distracting',
  whatsapp: 'distracting',
  telegram: 'distracting',
  instagram: 'distracting',
  facebook: 'distracting',
};

const CATEGORIES = ['productive', 'neutral', 'distracting'];

// What a minute in each category is worth. Neutral gets half credit: it is neither evidence of
// work nor of slacking, and a score that treats it as zero would punish meetings.
const WEIGHT = { productive: 1, neutral: 0.5, distracting: 0 };

/** "Code.exe" / "CODE" / " code " -> "code". */
function normaliseApp(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\.(exe|app)$/, '');
}

function categoryFor(appKey, overrides) {
  return overrides.get(appKey) || DEFAULTS[appKey] || 'neutral';
}

module.exports = { DEFAULTS, CATEGORIES, WEIGHT, normaliseApp, categoryFor };
