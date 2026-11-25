'use strict';

// The "Update" window: what is new in the version, an Update button, and (unless the update is
// required) a Later link. The work is done by the main process; this only shows it.

const $ = (id) => document.getElementById(id);
let info = null;

function render(next) {
  info = { ...info, ...next };
  $('ver').textContent = info.version ? `V${info.version}` : '';

  const notes = $('notes');
  notes.textContent = '';
  for (const line of info.notes || []) {
    const li = document.createElement('li');
    li.textContent = line; // text, never HTML
    notes.appendChild(li);
  }

  const working = info.phase === 'downloading' || info.phase === 'installing';
  $('bar').classList.toggle('hidden', !working);
  $('fill').style.width = `${info.phase === 'installing' ? 100 : info.percent || 0}%`;

  const msg = $('msg');
  msg.className = 'msg';
  if (info.phase === 'downloading') msg.textContent = `Downloading… ${info.percent || 0}%`;
  else if (info.phase === 'installing') msg.textContent = 'Installing. WorkInvigilator will restart by itself.';
  else if (info.phase === 'error') { msg.textContent = info.message || 'The update failed. Try again.'; msg.className = 'msg err'; }
  else msg.textContent = '';

  $('sub').textContent = info.working
    ? 'You are on a shift. Capturing pauses for about a minute while it updates, then carries on.'
    : info.currentVersion ? `You have V${info.currentVersion}.` : '';

  const go = $('go');
  go.disabled = working;
  go.textContent = info.manual ? 'Download' : info.phase === 'error' ? 'Try again' : 'Update';
  // A required update has no Later.
  $('later').classList.toggle('hidden', Boolean(info.mandatory) || working);
}

$('go').addEventListener('click', () => window.updateWin.start());
$('later').addEventListener('click', () => window.updateWin.later());

window.updateWin.onChange(render);
window.updateWin.get().then(render);
