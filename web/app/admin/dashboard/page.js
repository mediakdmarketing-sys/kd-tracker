import { api, requireUser } from '@/lib/api';
import { todayIn } from '@/lib/format';
import MonthFilter from './MonthFilter';
import AttendanceChart from './AttendanceChart';

export const metadata = { title: 'Dashboard · WorkBuddy' };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function DashboardPage({ searchParams }) {
  const params = await searchParams;
  const user = await requireUser({ adminOnly: true });

  // Default view is the current month alone; picking From and To compares every month between.
  const thisMonth = todayIn(user.timezone).slice(0, 7);
  // Same rules as the filter, applied to the URL too: no future months, and To never before From.
  let from = MONTH.test(params.from || '') ? params.from : thisMonth;
  if (from > thisMonth) from = thisMonth;
  let to = MONTH.test(params.to || '') ? params.to : from;
  if (to > thisMonth) to = thisMonth;
  if (to < from) to = from;

  const data = await api(`/api/admin/attendance-summary?${new URLSearchParams({ from, to })}`);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Average days attended per person in each department, one line per month.</p>
        </div>
      </div>

      <div className="stack">
        <div className="card card-pad">
          <MonthFilter key={`${from}|${to}`} from={from} to={to} maxMonth={thisMonth} />
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Attendance by department</h2>
            <span className="faint">y-axis: days in the month (0–26)</span>
          </div>
          <div className="card-pad">
            <AttendanceChart departments={data.departments} months={data.months} />
          </div>
        </div>
      </div>
    </>
  );
}
