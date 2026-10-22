'use client';

import { useState } from 'react';

// A command the reader is meant to paste into a terminal, shown on its own line in a dark
// box with a Copy button, so it can never be mistaken for a sentence of the instructions.

export default function CopyCommand({ command }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (older browser, insecure context): the text stays selectable.
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        margin: '8px 0',
        borderRadius: 10,
        background: '#1a1b2e',
        overflow: 'hidden',
      }}
    >
      <code
        style={{
          flex: 1,
          minWidth: 0,
          padding: '10px 14px',
          color: '#ece9ff',
          fontFamily: 'var(--mono)',
          fontSize: 13,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          userSelect: 'all',
        }}
      >
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy command: ${command}`}
        style={{
          flex: 'none',
          border: 0,
          borderLeft: '1px solid rgba(255,255,255,0.12)',
          background: copied ? 'var(--ok)' : 'rgba(255,255,255,0.08)',
          color: '#fff',
          padding: '0 14px',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
