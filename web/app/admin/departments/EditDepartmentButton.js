'use client';

import { useState } from 'react';
import EditDepartmentModal from './EditDepartmentModal';

/**
 * A small "Edit" button that opens the EditDepartmentModal for one department.
 * Kept as a separate client component so the departments page stays a Server Component.
 */
export default function EditDepartmentButton({ dept, leaders, employees }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="btn"
        onClick={() => setOpen(true)}
      >
        Edit
      </button>

      {open && (
        <EditDepartmentModal
          dept={dept}
          leaders={leaders}
          employees={employees}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
