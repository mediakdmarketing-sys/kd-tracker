'use client';

import { useState } from 'react';

/**
 * The greeting HR sends a new employee: where to sign in, the username, the temporary
 * password. Plain text on purpose, so it pastes cleanly into WhatsApp, a chat or an email.
 */
export function inviteMessage({ name, email, password, origin }) {
  const first = String(name || '').trim().split(' ')[0] || 'there';
  return [
    `Hi ${first}, welcome to WorkBuddy! 👋`,
    '',
    'Your account is ready. Here is how to sign in:',
    '',
    `Web link: ${origin}`,
    `Username: ${email}`,
    `Temporary password: ${password}`,
    '',
    'The first time you sign in you will be asked to choose your own password.',
    `After that, the Help page (${origin}/help) shows how to install WorkBuddy on your computer or phone.`,
    '',
    'If anything does not work, just reply to this message.',
  ].join('\n');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and non-secure pages: fall back to selecting a hidden field.
    const field = document.createElement('textarea');
    field.value = text;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(field);
    return ok;
  }
}

/**
 * Shown right after an employee is created, or a password is reset, with the temporary
 * password. It exists only in this card: the server does not keep it in readable form.
 */
export default function InviteCard({ name, email, password, onDone, title = 'Invitation ready' }) {
  const [copied, setCopied] = useState(false);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const message = inviteMessage({ name, email, password, origin });

  async function copy() {
    if (await copyText(message)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    }
  }

  const whatsapp = `https://wa.me/?text=${encodeURIComponent(message)}`;
  const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(
    'Welcome to WorkBuddy'
  )}&body=${encodeURIComponent(message)}`;

  return (
    <div className="card">
      <div className="card-head">
        <h2>{title}</h2>
        <button type="button" className="btn" onClick={onDone}>
          Done
        </button>
      </div>
      <div className="card-pad">
        <div className="notice notice-warn" style={{ marginBottom: 14 }}>
          <strong>Copy this now.</strong> The temporary password is shown only here and cannot be
          read again later. {name} will be asked to choose their own password at first sign-in.
        </div>

        <pre
          style={{
            margin: 0,
            padding: '14px 16px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            font: 'inherit',
            fontSize: 13.5,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            userSelect: 'all',
          }}
        >
          {message}
        </pre>

        <div className="inline" style={{ marginTop: 14, flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="btn btn-primary" onClick={copy}>
            {copied ? 'Copied ✓' : 'Copy message'}
          </button>
          <a className="btn" href={whatsapp} target="_blank" rel="noopener noreferrer">
            Send on WhatsApp
          </a>
          <a className="btn" href={mailto}>
            Open in email app
          </a>
        </div>
      </div>
    </div>
  );
}
