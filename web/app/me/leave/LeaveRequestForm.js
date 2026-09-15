'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { call } from '@/lib/client';
import { todayIn } from '@/lib/format';

const ACCEPTED_PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
// Mirrors the backend's MAX_UPLOAD_BYTES default (backend/src/config/index.js) — checked here
// too so a too-large file fails instantly instead of after a slow upload just to be rejected.
const MAX_PROOF_BYTES = 5 * 1024 * 1024;

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read the selected file'));
    reader.readAsDataURL(file);
  });
}

const TYPE_OPTIONS = [
  { value: 'sick', label: 'Sick leave (Illness or Injury)', proofRequired: true },
  { value: 'bereavement', label: 'Bereavement leave (Immediate Family)', proofRequired: true },
  { value: 'personal', label: 'Personal leave', proofRequired: false },
  { value: 'emergency', label: 'Emergency leave', proofRequired: true },
  { value: 'vacation', label: 'Company Vacation (Paid)', proofRequired: false },
];

const DAY_PART_OPTIONS = [
  { value: 'full', label: 'Full day' },
  { value: 'half_am', label: 'Half day (AM)' },
  { value: 'half_pm', label: 'Half day (PM)' },
];

export default function LeaveRequestForm({ name, email, timezone }) {
  const router = useRouter();
  const today = todayIn(timezone);

  const [type, setType] = useState('personal');
  const [dayPart, setDayPart] = useState('full');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [reason, setReason] = useState('');
  const [proofFile, setProofFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef(null);

  const proofRequired = TYPE_OPTIONS.find((o) => o.value === type)?.proofRequired;
  const isHalfDay = dayPart !== 'full';

  function handleFileChange(e) {
    const file = e.target.files?.[0] || null;
    setError(null);
    if (!file) {
      setProofFile(null);
      return;
    }
    if (!ACCEPTED_PROOF_TYPES.includes(file.type)) {
      setError('Proof must be a JPEG, PNG, WEBP image, or a PDF.');
      e.target.value = '';
      setProofFile(null);
      return;
    }
    if (file.size > MAX_PROOF_BYTES) {
      setError(`Proof file is too large — max ${Math.round(MAX_PROOF_BYTES / 1024 / 1024)} MB.`);
      e.target.value = '';
      setProofFile(null);
      return;
    }
    setProofFile(file);
  }

  function handleStartChange(value) {
    setStartDate(value);
    // A half day is always a single day — keep the end date locked to it.
    if (isHalfDay || value > endDate) setEndDate(value);
  }

  function handleDayPartChange(value) {
    setDayPart(value);
    if (value !== 'full') setEndDate(startDate);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      const body = { type, dayPart, startDate, endDate, reason: reason.trim() || undefined };
      if (proofFile) {
        body.proofBase64 = await readFileAsBase64(proofFile);
        body.proofContentType = proofFile.type;
        body.proofFileName = proofFile.name;
      }
      await call('/api/leave', { method: 'POST', body });
      setReason('');
      setProofFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad">
      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480 }}
      >
        <div style={{ fontWeight: 650, fontSize: 14 }}>Request time off</div>

        {(name || email) && (
          <div className="faint" style={{ fontSize: 12 }}>
            Submitting as <strong>{name}</strong>{email ? ` · ${email}` : ''}
          </div>
        )}

        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="lv-type">Type of leave</label>
          <select id="lv-type" value={type} onChange={(e) => setType(e.target.value)} disabled={busy}>
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {proofRequired && (
          <div className="notice notice-warn" style={{ fontSize: 12 }}>
            This leave type needs proof — e.g. an authenticated medical certificate with your
            doctor&apos;s details for sick leave. Without it, the leave is treated as no-pay.
          </div>
        )}

        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="lv-daypart">AM / PM / All day</label>
          <select
            id="lv-daypart"
            value={dayPart}
            onChange={(e) => handleDayPartChange(e.target.value)}
            disabled={busy}
          >
            {DAY_PART_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="lv-start">Leave Start Date</label>
            <input
              id="lv-start"
              type="date"
              value={startDate}
              min={today}
              onChange={(e) => handleStartChange(e.target.value)}
              disabled={busy}
              required
            />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="lv-end">Leave End Date</label>
            <input
              id="lv-end"
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={busy || isHalfDay}
              required
            />
            {isHalfDay && (
              <span className="faint" style={{ fontSize: 11 }}>Same as start date for a half day</span>
            )}
          </div>
        </div>

        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="lv-reason">Reason for leave (optional)</label>
          <textarea
            id="lv-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="A short note for whoever reviews this"
            rows={3}
            disabled={busy}
            style={{
              width: '100%',
              padding: '8px 11px',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-sm)',
              font: 'inherit',
              fontSize: 13,
              resize: 'vertical',
            }}
          />
        </div>

        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="lv-proof">
            Proof {proofRequired ? '(required for this leave type)' : '(optional)'}
          </label>
          <input
            id="lv-proof"
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_PROOF_TYPES.join(',')}
            onChange={handleFileChange}
            disabled={busy}
          />
          {proofFile ? (
            <span className="faint" style={{ fontSize: 11 }}>
              {proofFile.name} · {Math.round(proofFile.size / 1024)} KB
            </span>
          ) : (
            <span className="faint" style={{ fontSize: 11 }}>
              JPEG, PNG, WEBP, or PDF — max {Math.round(MAX_PROOF_BYTES / 1024 / 1024)} MB
            </span>
          )}
        </div>

        {error && <div className="notice notice-danger" role="alert">{error}</div>}
        {success && !error && <div className="notice notice-info">Request submitted.</div>}

        <div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Submitting…' : 'Submit request'}
          </button>
        </div>
      </form>
    </div>
  );
}
