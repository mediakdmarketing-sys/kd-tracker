'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { patch } from '@/lib/client';
import PasswordField from '@/components/PasswordField';

// ---------------------------------------------------------------------------
// Custom confirmation dialog — rendered in a portal so it is never part of
// the SSR tree and cannot cause a hydration mismatch.
// ---------------------------------------------------------------------------
function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }) {
  const cancelRef = useRef(null);
  const [mounted, setMounted] = useState(false);

  // Mount only on the client — portals require document.body.
  useEffect(() => { setMounted(true); }, []);

  // Focus Cancel by default so Enter doesn't accidentally confirm.
  useEffect(() => { if (mounted) cancelRef.current?.focus(); }, [mounted]);

  // Close on Escape.
  useEffect(() => {
    if (!mounted) return;
    function onKey(e) { if (e.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mounted, onCancel]);

  if (!mounted) return null;

  return createPortal(
    <div
      role="presentation"
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cd-title"
        aria-describedby="cd-msg"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '24px 28px',
          maxWidth: 400,
          width: '90vw',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        }}
      >
        <div id="cd-title" style={{ fontWeight: 650, fontSize: 15, marginBottom: 10 }}>
          {title}
        </div>
        <div id="cd-msg" style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.55, marginBottom: 22 }}>
          {message}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button ref={cancelRef} type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function EmployeeActions({ employee, departments = [] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const [dialog, setDialog] = useState(null);

  const [showReset, setShowReset] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetError, setResetError] = useState(null);

  // Role + department edit
  const [showEdit, setShowEdit] = useState(false);
  const [editRole, setEditRole] = useState(employee.role);
  const [editDept, setEditDept] = useState(employee.department || '');
  const [editError, setEditError] = useState(null);

  // Returns a Promise that resolves true/false based on user choice.
  function confirm({ title, message, confirmLabel = 'Confirm', danger = false }) {
    return new Promise((resolve) => {
      setDialog({
        title,
        message,
        confirmLabel,
        danger,
        onConfirm: () => { setDialog(null); resolve(true); },
        onCancel:  () => { setDialog(null); resolve(false); },
      });
    });
  }

  async function update(body, label, dialogOpts) {
    if (dialogOpts) {
      const ok = await confirm(dialogOpts);
      if (!ok) return;
    }
    setBusy(label);
    setError(null);
    try {
      await patch(`/api/admin/employees/${employee.id}`, body);
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  function openReset() {
    setShowReset(true);
    setNewPassword('');
    setConfirmPassword('');
    setResetError(null);
  }

  function closeReset() {
    setShowReset(false);
    setNewPassword('');
    setConfirmPassword('');
    setResetError(null);
  }

  async function submitReset(e) {
    e.preventDefault();
    setResetError(null);

    if (newPassword.length < 8) {
      setResetError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetError('Passwords do not match.');
      return;
    }

    const ok = await confirm({
      title: 'Reset password?',
      message: `${employee.name} will be signed out everywhere immediately and must use the new password to sign back in.`,
      confirmLabel: 'Yes, reset password',
      danger: true,
    });
    if (!ok) return;

    setBusy('reset');
    setResetError(null);
    try {
      await patch(`/api/admin/employees/${employee.id}`, { password: newPassword });
      closeReset();
      router.refresh();
    } catch (err) {
      setResetError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {/* Custom dialog rendered at the top level so it sits above everything */}
      {dialog ? (
        <ConfirmDialog
          title={dialog.title}
          message={dialog.message}
          confirmLabel={dialog.confirmLabel}
          danger={dialog.danger}
          onConfirm={dialog.onConfirm}
          onCancel={dialog.onCancel}
        />
      ) : null}

      <div>
        <div className="btn-row">
          {employee.status === 'active' ? (
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy !== null}
              onClick={() =>
                update(
                  { status: 'inactive' },
                  'deactivate',
                  {
                    title: 'Deactivate employee?',
                    message: `${employee.name} will be signed out everywhere and won't be able to punch in until reactivated.`,
                    confirmLabel: 'Deactivate',
                    danger: true,
                  }
                )
              }
            >
              {busy === 'deactivate' ? 'Deactivating…' : 'Deactivate'}
            </button>
          ) : (
            <button
              type="button"
              className="btn"
              disabled={busy !== null}
              onClick={() => update({ status: 'active' }, 'activate')}
            >
              {busy === 'activate' ? 'Reactivating…' : 'Reactivate'}
            </button>
          )}

          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={showReset ? closeReset : openReset}
          >
            {showReset ? 'Cancel' : 'Reset password'}
          </button>

          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={() => {
              setEditRole(employee.role);
              setEditDept(employee.department || '');
              setEditError(null);
              setShowEdit((v) => !v);
            }}
          >
            {showEdit ? 'Cancel edit' : 'Edit role / dept'}
          </button>

          {employee.consent.audio ? (
            <button
              type="button"
              className="btn"
              disabled={busy !== null}
              onClick={() =>
                update(
                  { consentAudio: false },
                  'audio',
                  {
                    title: 'Turn off audio sampling?',
                    message: `Audio recording will be disabled for ${employee.name}. Do this only at their request.`,
                    confirmLabel: 'Turn off audio',
                    danger: false,
                  }
                )
              }
            >
              {busy === 'audio' ? 'Saving…' : 'Turn off audio'}
            </button>
          ) : null}
        </div>

        {/* Inline password reset form */}
        {showReset ? (
          <form
            onSubmit={submitReset}
            style={{
              marginTop: 14,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '18px 20px',
              maxWidth: 380,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 14, color: 'var(--text)' }}>
              Reset password for {employee.name}
            </div>

            <div style={{ marginBottom: 10 }}>
              <PasswordField
                id="reset-pw"
                label="New password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={busy === 'reset'}
                autoComplete="new-password"
              />
            </div>

            <div style={{ marginBottom: 14 }}>
              <PasswordField
                id="reset-pw-confirm"
                label="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={busy === 'reset'}
                autoComplete="new-password"
              />
            </div>

            {resetError ? (
              <div className="notice notice-danger" style={{ marginBottom: 12 }} role="alert">
                {resetError}
              </div>
            ) : null}

            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
              The employee will be signed out everywhere immediately.
            </div>

            <div className="inline">
              <button type="submit" className="btn btn-primary" disabled={busy === 'reset'}>
                {busy === 'reset' ? 'Saving…' : 'Save new password'}
              </button>
              <button type="button" className="btn" disabled={busy === 'reset'} onClick={closeReset}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        {/* Inline role / department edit form */}
        {showEdit && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy('edit');
              setEditError(null);
              try {
                await patch(`/api/admin/employees/${employee.id}`, {
                  role: editRole,
                  department: editDept || null,
                });
                setShowEdit(false);
                router.refresh();
              } catch (err) {
                setEditError(err.message);
              } finally {
                setBusy(null);
              }
            }}
            style={{
              marginTop: 14,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '18px 20px',
              maxWidth: 480,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text)' }}>
              Edit role &amp; department
            </div>

            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="ea-role">Role</label>
              <select
                id="ea-role"
                value={editRole}
                onChange={(e) => setEditRole(e.target.value)}
                disabled={busy === 'edit'}
              >
                <option value="user">Employee</option>
                <option value="leader">Leader</option>
                <option value="admin">HR / Admin</option>
              </select>
            </div>

            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="ea-dept">Department</label>
              {departments.length > 0 ? (
                <select
                  id="ea-dept"
                  value={editDept}
                  onChange={(e) => setEditDept(e.target.value)}
                  disabled={busy === 'edit'}
                >
                  <option value="">— None —</option>
                  {departments.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              ) : (
                <input
                  id="ea-dept"
                  value={editDept}
                  onChange={(e) => setEditDept(e.target.value)}
                  placeholder="Department name"
                  disabled={busy === 'edit'}
                />
              )}
            </div>

            {editError && (
              <div className="notice notice-danger" role="alert">{editError}</div>
            )}

            <div className="inline">
              <button type="submit" className="btn btn-primary" disabled={busy === 'edit'}>
                {busy === 'edit' ? 'Saving…' : 'Save changes'}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy === 'edit'}
                onClick={() => setShowEdit(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {error ? (
          <div className="notice notice-danger" style={{ marginTop: 10 }} role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </>
  );
}
