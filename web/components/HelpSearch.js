'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Search box for the Help page. The guide itself is rendered on the server, so this filters the
 * page in place: it looks at the text of every `[data-help-section]`, hides the ones that do not
 * contain every word typed, opens the ones that do, and hides the other cards (quick start,
 * install, jump-to) while a search is active. Clearing the box puts everything back as it was.
 */
export default function HelpSearch() {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null); // null when not searching
  const wasOpen = useRef(new Map());
  const inputRef = useRef(null);

  useEffect(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const searching = words.length > 0;

    let count = 0;
    document.querySelectorAll('[data-help-section]').forEach((el) => {
      if (!wasOpen.current.has(el)) wasOpen.current.set(el, el.open);
      if (!searching) {
        el.style.display = '';
        el.open = wasOpen.current.get(el);
        count += 1;
        return;
      }
      const text = el.textContent.toLowerCase();
      const hit = words.every((w) => text.includes(w));
      el.style.display = hit ? '' : 'none';
      if (hit) {
        el.open = true;
        count += 1;
      }
    });

    document.querySelectorAll('[data-help-extra]').forEach((el) => {
      el.style.display = searching ? 'none' : '';
    });

    setFound(searching ? count : null);
  }, [query]);

  // Slash focuses the box, like most search pages. Escape clears it.
  useEffect(() => {
    function onKey(e) {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="card card-pad">
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
        placeholder="Search help: payslip, holiday, break, Mac, leave…   (press / to focus)"
        aria-label="Search help"
        autoComplete="off"
        style={{ width: '100%', fontSize: 15, padding: '10px 14px' }}
      />
      {found !== null && (
        <div className="faint" style={{ marginTop: 8, fontSize: 13 }} role="status">
          {found === 0
            ? 'Nothing found. Try a shorter or different word, or ask HR.'
            : `${found} ${found === 1 ? 'section matches' : 'sections match'}.`}
          {' '}
          <button type="button" className="btn" style={{ padding: '2px 10px' }} onClick={() => setQuery('')}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
