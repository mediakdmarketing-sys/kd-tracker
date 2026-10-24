import { dateLabel, duration, time } from '@/lib/format';

const ENDED = {
  live: (p, tz) => `Sound heard again at ${time(p.confirmedLiveAt, tz)}`,
  gap: () => 'No further sample (break, punch out or agent closed)',
  ongoing: () => 'Still silent at the last sample',
};

/** "Mon 5 Oct, 10:15" when the day matters, plain "10:15" when it is the same day as `day`. */
function stamp(iso, tz, day) {
  const date = dateLabel(iso, tz);
  return date === day ? time(iso, tz) : `${date}, ${time(iso, tz)}`;
}

/**
 * The microphone log: each row is one stretch where the mic was found muted, with the time it
 * started and the time of the last silent sample. Shared by the employee page, the team
 * leader's member page and HR's company-wide page.
 */
export default function MicLogTable({ periods, timezone, showEmployee = false, emptyText }) {
  if (!periods.length) {
    return <div className="empty">{emptyText || 'No muted microphone found in this period.'}</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {showEmployee && <th>Employee</th>}
            <th>Date</th>
            <th>From</th>
            <th>To</th>
            <th>Muted for</th>
            <th>Samples</th>
            <th>How it ended</th>
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => {
            const day = dateLabel(p.start, timezone);
            return (
              <tr key={`${p.employeeId || ''}${p.start}`}>
                {showEmployee && (
                  <td>
                    <div>{p.employeeName}</div>
                    <div className="faint">{p.department || '—'}</div>
                  </td>
                )}
                <td className="num">{day}</td>
                <td className="num">{time(p.start, timezone)}</td>
                <td className="num">{stamp(p.end, timezone, day)}</td>
                <td className="num">{duration(p.durationSeconds)}</td>
                <td className="num">{p.samples}</td>
                <td className="muted">{ENDED[p.endedBy]?.(p, timezone) || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
