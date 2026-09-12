'use strict';

// Tray popup. Deliberately plain DOM — a build step and a framework would be more machinery
// than four screens of UI deserve.

const app = document.getElementById('app');
let state = null;
let error = null;
let busy = false;

function h(html) {
  return html;
}

function duration(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function render() {
  if (!state) {
    app.innerHTML = h('<div class="muted">Loading…</div>');
    return;
  }

  // Background state broadcasts (queue-drain ticks, status polls) arrive every few seconds
  // regardless of what the employee is doing in this window. Re-rendering the sign-in form
  // from scratch on one of those wiped out whatever the employee had already typed — save
  // and restore the in-progress email/password (and cursor position) across the rebuild so a
  // routine background update never looks like data loss.
  const wasSignInView = !state.signedIn && document.getElementById('email');
  const draft = wasSignInView
    ? {
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
        focusId: document.activeElement?.id,
        selectionStart: document.activeElement?.selectionStart,
        selectionEnd: document.activeElement?.selectionEnd,
      }
    : null;

  app.innerHTML = state.signedIn ? signedInView() : signInView();
  wire();

  if (draft && !state.signedIn) {
    document.getElementById('email').value = draft.email;
    document.getElementById('password').value = draft.password;
    const toFocus = draft.focusId && document.getElementById(draft.focusId);
    if (toFocus) {
      toFocus.focus();
      if (draft.selectionStart != null) {
        toFocus.setSelectionRange(draft.selectionStart, draft.selectionEnd);
      }
    }
  }
}

function signInView() {
  // `error` is set by a failed action taken in this popup (e.g. a bad password just typed);
  // `state.lastError` is set by the agent itself, most importantly when the background
  // uploader discovers the session has died server-side (markSignedOut) — the employee needs
  // to see *that* even though they took no action here that would set the local `error`.
  const message = error || state?.lastError;
  return h(`
    <h1>KD Tracker</h1>
    <p class="muted" style="margin:0 0 14px">Sign in with your work email.</p>
    ${message ? `<div class="error">${escape(message)}</div>` : ''}
    <div class="card">
      <label for="email">Work email</label>
      <input id="email" type="email" autocomplete="username" />
      <label for="password">Password</label>
      <input id="password" type="password" autocomplete="current-password" />
      <button class="primary" id="signin" style="width:100%" ${busy ? 'disabled' : ''}>
        ${busy ? 'Signing in…' : 'Sign in'}
      </button>
    </div>
    <p class="muted hint">
      Once you are signed in this agent records screenshots and activity while you are punched
      in, and never while you are on a break. Use “What is recorded” in the tray menu to read
      the full notice.
    </p>
  `);
}

function signedInView() {
  const shift = state.status || {};
  const working = state.shiftState === 'working';
  const onBreak = state.shiftState === 'on_break';
  const out = !working && !onBreak;

  return h(`
    <h1>${escape(state.employee?.name || 'Signed in')}</h1>
    <p class="muted" style="margin:0 0 14px">${escape(state.employee?.email || '')}</p>

    ${error ? `<div class="error">${escape(error)}</div>` : ''}

    <div class="card">
      <div class="muted" style="font-size:11px;font-weight:650;letter-spacing:.04em">
        ${out ? 'NOT PUNCHED IN' : 'WORKED TODAY'}
      </div>
      <div class="clock">${out ? '—' : duration(shift.workedSeconds)}</div>
      <div style="margin-top:8px">
        ${
          working
            ? `<span class="pill pill-ok">Capturing ${state.audioAllowed ? 'screen and audio' : 'screen only'}</span>`
            : onBreak
              ? '<span class="pill pill-warn">On break — nothing is being captured</span>'
              : '<span class="pill">Idle</span>'
        }
      </div>
    </div>

    <div class="row" style="margin-bottom:12px">
      ${
        out
          ? `<button class="primary" data-punch="punchIn" ${busy ? 'disabled' : ''}>Punch in</button>`
          : `
            <button data-punch="${onBreak ? 'breakEnd' : 'breakStart'}" ${busy ? 'disabled' : ''}>
              ${onBreak ? 'End break' : 'Start break'}
            </button>
            <button class="danger" data-punch="punchOut" ${busy ? 'disabled' : ''}>Punch out</button>
          `
      }
    </div>

    <div class="card">
      <div class="kv"><span class="muted">Connection</span>
        <span>${state.online ? '<span class="pill pill-ok">Online</span>' : '<span class="pill pill-danger">Offline</span>'}</span>
      </div>
      <div class="kv"><span class="muted">Waiting to upload</span><span>${state.queue.pending}</span></div>
      ${
        state.queue.pending
          ? `<div class="kv"><span class="muted">Oldest item</span><span>${Math.round(state.queue.oldestAgeSeconds / 60)} min</span></div>`
          : ''
      }
      ${
        state.queue.abandoned
          ? `<div class="kv"><span class="muted">Rejected by the server</span><span>${state.queue.abandoned}</span></div>`
          : ''
      }
      <div class="row" style="margin-top:10px">
        <button id="drain" ${busy ? 'disabled' : ''}>Upload now</button>
        <button id="signout" ${busy ? 'disabled' : ''}>Sign out</button>
      </div>
    </div>

    <p class="muted hint">
      Nothing is captured while you are punched out or on a break. If you lose connection your
      work is stored on this machine and sent when you are back online — you do not lose the time.
    </p>
  `);
}

function wire() {
  document.getElementById('signin')?.addEventListener('click', async () => {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    await run(() => window.agent.signIn(email, password));
  });

  document.getElementById('signout')?.addEventListener('click', () => run(() => window.agent.signOut()));
  document.getElementById('drain')?.addEventListener('click', () => run(() => window.agent.drainNow()));

  document.querySelectorAll('[data-punch]').forEach((button) => {
    button.addEventListener('click', () => run(() => window.agent.punch(button.dataset.punch)));
  });
}

async function run(fn) {
  busy = true;
  error = null;
  render();

  try {
    await fn();
  } catch (err) {
    error = err?.message || String(err);
  } finally {
    busy = false;
    state = await window.agent.getState();
    render();
  }
}

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

window.agent.onState((next) => {
  state = next;
  if (!busy) render();
});

(async () => {
  state = await window.agent.getState();
  render();
  // The worked-today counter should tick rather than jump on the next sync.
  setInterval(() => {
    if (state?.status && state.shiftState === 'working') {
      state.status.workedSeconds = (state.status.workedSeconds || 0) + 1;
      if (!busy) render();
    }
  }, 1000);
})();
