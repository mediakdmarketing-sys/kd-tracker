'use client';

import { useRouter, usePathname } from 'next/navigation';

// From / To / Department / Employee. Picking a department or an employee applies straight away
// (the employee list depends on the department, so it has to reload); the dates use Apply.
// The Employee filter only exists once a department is chosen, and clears when it changes.

export default function ProductivityFilters({ from, to, department, employeeId, departments, employees }) {
  const router = useRouter();
  const pathname = usePathname();

  function go(next) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) if (value) params.set(key, value);
    router.push(`${pathname}?${params.toString()}`);
  }

  function apply(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    go({ from: form.get('from'), to: form.get('to'), department, employeeId });
  }

  const dates = () => ({
    from: document.getElementById('from')?.value || from,
    to: document.getElementById('to')?.value || to,
  });

  return (
    <form className="filters" onSubmit={apply}>
      <div className="field">
        <label htmlFor="from">From</label>
        <input id="from" name="from" type="date" defaultValue={from} />
      </div>
      <div className="field">
        <label htmlFor="to">To</label>
        <input id="to" name="to" type="date" defaultValue={to} />
      </div>
      <div className="field">
        <label htmlFor="department">Department</label>
        <select
          id="department"
          value={department}
          onChange={(e) => go({ ...dates(), department: e.target.value })}
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>
      {department && (
        <div className="field">
          <label htmlFor="employeeId">Employee</label>
          <select
            id="employeeId"
            value={employeeId}
            onChange={(e) => go({ ...dates(), department, employeeId: e.target.value })}
          >
            <option value="">All employees</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <button type="submit" className="btn btn-primary">
        Apply
      </button>
    </form>
  );
}
