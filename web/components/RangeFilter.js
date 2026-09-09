'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';

/**
 * Filter bar that writes its state into the URL, so a filtered view is linkable, survives a
 * refresh, and is rendered on the server rather than re-fetched in the browser.
 *
 * @param {Array<{name, label, type, options?, placeholder?}>} fields
 */
export default function RangeFilter({ fields, children }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function apply(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    for (const [key, value] of form.entries()) {
      if (String(value).trim()) next.set(key, String(value).trim());
    }
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <form className="filters" onSubmit={apply}>
      {fields.map((field) => (
        <div className="field" key={field.name}>
          <label htmlFor={field.name}>{field.label}</label>
          {field.type === 'select' ? (
            <select id={field.name} name={field.name} defaultValue={params.get(field.name) || ''}>
              {field.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={field.name}
              name={field.name}
              type={field.type || 'text'}
              placeholder={field.placeholder}
              defaultValue={params.get(field.name) || field.defaultValue || ''}
            />
          )}
        </div>
      ))}

      <button type="submit" className="btn btn-primary">
        Apply
      </button>
      {children}
    </form>
  );
}
