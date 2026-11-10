'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

/**
 * A search box with a dropdown of people. Type to narrow the list, then pick one; the pick is sent
 * as an exact id (`employeeId`) so two people with the same first name are never mixed up. Typing
 * without picking still works: the text is sent as `employee` and matches part of a name.
 *
 * Renders two form fields: `name` (the visible text) and `idName` (hidden, the picked id).
 * If the form has a `department` field, the list follows it.
 */
export default function EmployeeCombobox({ id, name = 'employee', idName = 'employeeId', options = [], defaultText = '', defaultId = '', placeholder }) {
  const listId = useId();
  const root = useRef(null);
  const [text, setText] = useState(defaultText);
  const [pickedId, setPickedId] = useState(defaultId);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [department, setDepartment] = useState('');

  // Follow the Department select in the same form, so the list only offers people from it.
  useEffect(() => {
    const form = root.current?.closest('form');
    const select = form?.elements?.department;
    if (!form || !select) return undefined;
    const read = () => setDepartment(select.value || '');
    read();
    form.addEventListener('change', read);
    return () => form.removeEventListener('change', read);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (root.current && !root.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const shown = useMemo(() => {
    const q = text.trim().toLowerCase();
    // Once someone is picked, show the whole list again so it is easy to change the pick.
    const narrowing = q && !pickedId;
    return options
      .filter((o) => !department || o.department === department)
      .filter((o) => !narrowing || o.name.toLowerCase().includes(q) || (o.department || '').toLowerCase().includes(q))
      .slice(0, 100);
  }, [options, text, pickedId, department]);

  function choose(option) {
    setText(option ? option.name : '');
    setPickedId(option ? option.id : '');
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(shown.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter' && open && active >= 0 && shown[active]) {
      event.preventDefault(); // choose, don't submit the form
      choose(shown[active]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="ec" ref={root}>
      <input
        id={id}
        name={name}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder={placeholder || 'Search or pick a name'}
        value={text}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          setText(e.target.value);
          setPickedId(''); // editing the text drops the exact pick
          setOpen(true);
          setActive(-1);
        }}
      />
      <input type="hidden" name={idName} value={pickedId} />
      {text && (
        <button type="button" className="ec-clear" aria-label="Clear employee" onClick={() => choose(null)}>
          ×
        </button>
      )}
      {open && (
        <ul className="ec-list" id={listId} role="listbox">
          <li role="option" aria-selected={!pickedId && !text} className="ec-item" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(null)}>
            <span className="ec-name">Everyone</span>
          </li>
          {shown.map((o, i) => (
            <li
              key={o.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o.id === pickedId}
              className={`ec-item${i === active ? ' is-active' : ''}${o.id === pickedId ? ' is-picked' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(o)}
            >
              <span className="ec-name">{o.name}</span>
              <span className="ec-meta">
                {o.department || 'No department'}
                {!o.active && ' · inactive'}
              </span>
            </li>
          ))}
          {shown.length === 0 && <li className="ec-empty">No one matches “{text.trim()}”.</li>}
        </ul>
      )}
    </div>
  );
}
