import CompanyLogo from '@/components/CompanyLogo';
import { money } from '@/lib/money';
import { FONT_STACKS } from '@/lib/payslipTemplate';

/**
 * The payslip itself, drawn from the template HR chose in Settings. Used for the real payslip and
 * for the live preview in Settings, so what they see there is what is printed. All colours and
 * sizes are inline so the sheet prints and saves as a PDF with its colours.
 *
 * @param {object} props
 * @param {object} props.slip       see backend pay.service.payslip
 * @param {{name?: string, hasLogo?: boolean, logoUpdatedAt?: number|null}} props.company
 * @param {object} props.template   see backend services/payslipTemplate
 * @param {string} props.monthTitle e.g. "October 2026"
 */
export default function PayslipSheet({ slip, company, template, monthTitle }) {
  const { colors, show } = template;
  const label = { opacity: 0.65, fontSize: 12 };
  const cell = { padding: '9px 10px', borderBottom: '1px solid rgba(0,0,0,.12)' };
  const num = { ...cell, textAlign: 'right', whiteSpace: 'nowrap' };

  const note =
    template.footerNote ||
    `A full day (${slip.dayLimits.fullDayHours}+ hours of work) pays the daily rate, a half day (${slip.dayLimits.halfDayHours}+ hours) pays half, and other work is paid by the hour. Breaks are not counted as work. Bonuses are added on top. Generated on ${new Date(slip.generatedOn).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}.`;

  return (
    <div
      className="payslip"
      style={{
        background: colors.background,
        color: colors.text,
        fontFamily: FONT_STACKS[template.font] || FONT_STACKS.sans,
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid rgba(0,0,0,.12)',
        WebkitPrintColorAdjust: 'exact',
        printColorAdjust: 'exact',
      }}
    >
      <div
        className="payslip-head"
        style={{
          background: colors.headerBackground,
          borderBottom: `3px solid ${colors.accent}`,
          padding: '22px 28px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
          WebkitPrintColorAdjust: 'exact',
          printColorAdjust: 'exact',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {show.logo && <CompanyLogo hasLogo={company.hasLogo} version={company.logoUpdatedAt} />}
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: colors.accent }}>{company.name || 'KD Marketing'}</div>
            <div style={{ opacity: 0.8 }}>
              {template.title} for {monthTitle}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right', ...label }}>
          {show.employeeId && slip.employee.employeeCode ? <div>ID {slip.employee.employeeCode}</div> : null}
          <div>All amounts in US dollars</div>
        </div>
      </div>

      <div className="payslip-body" style={{ padding: '22px 28px 26px' }}>
        <div className="kv-grid" style={{ marginBottom: 18 }}>
          <div><div style={label}>Employee</div><strong>{slip.employee.name}</strong></div>
          {show.email && <div><div style={label}>Email</div>{slip.employee.email}</div>}
          {show.department && <div><div style={label}>Department</div>{slip.employee.department || '—'}</div>}
          <div><div style={label}>Days worked</div><strong>{slip.daysWorked}</strong></div>
          {show.totalHours && <div><div style={label}>Total hours worked</div><strong>{slip.totalHours}</strong></div>}
        </div>

        {show.dayBreakdown && (
          <div className="kv-grid" style={{ marginBottom: 18 }}>
            <div><div style={label}>Full days</div><strong>{slip.fullDays}</strong></div>
            <div><div style={label}>Half days</div><strong>{slip.halfDays}</strong></div>
            <div>
              <div style={label}>Other hours</div>
              <strong>{slip.otherHours}</strong>
              {slip.otherDays > 0 && (
                <span style={label}> over {slip.otherDays} day{slip.otherDays === 1 ? '' : 's'}</span>
              )}
            </div>
          </div>
        )}

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ color: colors.accent }}>
              <th style={{ ...cell, textAlign: 'left', borderBottom: `2px solid ${colors.accent}`, fontSize: 12, letterSpacing: '.04em' }}>EARNINGS</th>
              <th style={{ ...num, borderBottom: `2px solid ${colors.accent}`, fontSize: 12 }}>QTY</th>
              <th style={{ ...num, borderBottom: `2px solid ${colors.accent}`, fontSize: 12 }}>RATE</th>
              <th style={{ ...num, borderBottom: `2px solid ${colors.accent}`, fontSize: 12 }}>AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {slip.lines.map((l, i) => (
              <tr key={i}>
                <td style={cell}>
                  {l.kind === 'full' && 'Full days'}
                  {l.kind === 'half' && 'Half days'}
                  {l.kind === 'partial' && `Other hours (over ${l.days} day${l.days === 1 ? '' : 's'})`}
                </td>
                <td style={num}>{l.kind === 'partial' ? `${l.hours} h` : l.days}</td>
                <td style={num}>
                  {l.kind === 'full' && `${money(l.dailyRate)} / day`}
                  {l.kind === 'half' && `${money(l.dailyRate / 2)} / half day`}
                  {l.kind === 'partial' && `${money(l.hourlyRate)} / hour`}
                </td>
                <td style={num}>{money(l.amount)}</td>
              </tr>
            ))}
            {slip.lines.length === 0 && (
              <tr><td colSpan={4} style={{ ...cell, opacity: 0.65 }}>No paid days this month.</td></tr>
            )}
            <tr>
              <td colSpan={3} style={cell}><strong>Base pay</strong></td>
              <td style={num}><strong>{money(slip.basePay)}</strong></td>
            </tr>
            {slip.bonuses.map((b) => (
              <tr key={b.id}>
                <td colSpan={3} style={cell}>Bonus: {b.reason}</td>
                <td style={num}>{money(b.amount)}</td>
              </tr>
            ))}
            {slip.bonuses.length > 0 && (
              <tr>
                <td colSpan={3} style={cell}><strong>Bonuses</strong></td>
                <td style={num}><strong>{money(slip.bonusTotal)}</strong></td>
              </tr>
            )}
            <tr style={{ color: colors.accent }}>
              <td colSpan={3} style={{ padding: '12px 10px', fontSize: 17, borderTop: `2px solid ${colors.accent}` }}><strong>Net pay</strong></td>
              <td style={{ padding: '12px 10px', fontSize: 17, textAlign: 'right', borderTop: `2px solid ${colors.accent}` }}><strong>{money(slip.netPay)}</strong></td>
            </tr>
          </tbody>
        </table>

        {show.rulesNote && <p style={{ marginTop: 16, fontSize: 12, opacity: 0.75, whiteSpace: 'pre-line' }}>{note}</p>}
      </div>
    </div>
  );
}
