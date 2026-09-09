'use client';

import { useState } from 'react';

/**
 * Password input with a show/hide eye icon toggle.
 * Accepts the same props as a plain <input> (id, value, onChange, disabled, autoComplete).
 * `label` is rendered as a <label> above the input.
 * `inputStyle` allows callers to pass additional inline styles to the <input>.
 */
export default function PasswordField({
  id,
  label,
  value,
  onChange,
  disabled = false,
  autoComplete = 'current-password',
  placeholder,
  inputStyle = {},
}) {
  const [show, setShow] = useState(false);

  return (
    <div>
      {label ? (
        <label
          htmlFor={id}
          style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}
        >
          {label}
        </label>
      ) : null}
      <div style={{ position: 'relative' }}>
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          placeholder={placeholder}
          minLength={8}
          required
          disabled={disabled}
          style={{
            width: '100%',
            padding: '8px 36px 8px 10px',
            border: '1px solid var(--border)',
            borderRadius: 6,
            background: 'var(--bg)',
            color: 'var(--text)',
            font: 'inherit',
            fontSize: 13,
            boxSizing: 'border-box',
            ...inputStyle,
          }}
        />
        <button
          type="button"
          aria-label={show ? 'Hide password' : 'Show password'}
          onClick={() => setShow((s) => !s)}
          disabled={disabled}
          tabIndex={-1}
          style={{
            position: 'absolute',
            right: 0, top: 0, bottom: 0,
            width: 36,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'none',
            border: 'none',
            cursor: disabled ? 'not-allowed' : 'pointer',
            color: 'var(--muted)',
            padding: 0,
            borderRadius: '0 6px 6px 0',
          }}
        >
          {show ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
