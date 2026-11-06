'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { call, post } from '@/lib/client';

const POLL_MS = 3000;
const POLL_LIMIT = 200; // about ten minutes, then it just waits for the next page load

/** What happened last time this person's payslip was emailed. */
export function EmailStatus({ status, error, sentAt, timesSent = 0 }) {
  if (!status) return <span className="faint">—</span>;
  if (status === 'sent') {
    const when = sentAt ? `Last sent ${new Date(sentAt).toLocaleString()}` : '';
    return (
      <span
        className="pill pill-working"
        title={`${when}${timesSent > 1 ? ` · sent ${timesSent} times: every repeat has a DUPLICATE mark` : ''}`.trim() || undefined}
      >
        {timesSent > 1 ? `Sent ×${timesSent}` : 'Sent'}
      </span>
    );
  }
  if (status === 'failed') {
    return <span className="pill pill-flag" title={error || 'Failed'}>Failed</span>;
  }
  return <span className="pill pill-none">{status === 'sending' ? 'Sending…' : 'Queued'}</span>;
}

/** While anything is still queued, check back and refresh the table until it is all done. */
function useFollowSend(month, active, nonce = 0) {
  const router = useRouter();
  const timer = useRef(null);

  // `nonce` changes with every new send, so a second send starts following again even though
  // `active` never went false in between.
  useEffect(() => {
    if (!active) return undefined;
    let tries = 0;
    timer.current = setInterval(async () => {
      tries += 1;
      try {
        const { rows } = await call(`/api/payroll/payslips/status?month=${month}`);
        router.refresh();
        if (!rows.some((r) => r.status === 'queued' || r.status === 'sending') || tries >= POLL_LIMIT) {
          clearInterval(timer.current);
        }
      } catch {
        // A blip: try again on the next tick.
      }
    }, POLL_MS);
    return () => clearInterval(timer.current);
  }, [active, month, nonce, router]);
}

/** Email one person's payslip. */
export function EmailPayslipButton({ month, employeeId, label = 'Email', status }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // A single send finishes before the request returns; a queued one belongs to the "email all"
  // button, which follows the whole queue (one poll for the page, not one per row).
  const pending = status === 'queued' || status === 'sending';

  async function send() {
    if (
      status === 'sent' &&
      !window.confirm(
        'This payslip was already emailed. Sending it again attaches a PDF marked DUPLICATE (unless its figures have changed since). Send again?'
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await post('/api/payroll/payslips/send', { month, employeeIds: [employeeId] });
      if (res.skipped?.length) setError(res.skipped[0].reason);
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn" onClick={send} disabled={busy || pending}>
        {busy || pending ? 'Sending…' : status === 'sent' ? `Resend` : label}
      </button>
      {error && <div className="faint" style={{ color: 'var(--danger, #a30d33)', fontSize: 12, marginTop: 4 }} role="alert">{error}</div>}
    </>
  );
}

/** Email everyone's payslip for the month. */
export function EmailAllPayslips({ month, count, emailConfigured, pending, alreadySent = 0 }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(pending > 0);
  const [sends, setSends] = useState(0);
  const [message, setMessage] = useState(null);
  useFollowSend(month, active || pending > 0, sends);

  async function send() {
    const repeat =
      alreadySent > 0
        ? `\n\n${alreadySent} ${alreadySent === 1 ? 'person has' : 'people have'} already been sent this month's payslip. They get another copy with the PDF marked DUPLICATE (unless their figures changed since).`
        : '';
    if (
      !window.confirm(
        `Email a payslip for ${month} to ${count} ${count === 1 ? 'person' : 'people'}? Each one gets only their own, at the address on their record.${repeat}`
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await post('/api/payroll/payslips/send', { month });
      setActive(true);
      setSends((n) => n + 1);
      setMessage(
        res.queued === 0
          ? 'Nothing new to send: everyone is already queued or has no payroll for this month.'
          : `Sending ${res.queued} payslip${res.queued === 1 ? '' : 's'}. This takes about a second each; you can leave this page.`
      );
      router.refresh();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-info"
        onClick={send}
        disabled={busy || pending > 0 || !emailConfigured}
        title={emailConfigured ? undefined : 'Email is not set up yet: see Settings'}
      >
        {busy || pending > 0 ? `Sending… (${pending} left)` : 'Email all payslips'}
      </button>
      {message && <div className="notice notice-info" style={{ marginTop: 8 }} role="status">{message}</div>}
    </>
  );
}
