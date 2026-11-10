// What a person can be doing right now, and the colour that means it everywhere on the dashboard.
// The same colour marks the tile, the ring, the person's chip and the legend, so it is learnt once.

export const STATES = [
  { key: 'working', label: 'Working', color: '#10b981' },
  { key: 'on_break', label: 'On break', color: '#f59e0b' },
  { key: 'punched_out', label: 'Finished', color: '#0ea5e9' },
  { key: 'not_started', label: 'Not started', color: '#94a3b8' },
  { key: 'on_leave', label: 'On leave', color: '#8b5cf6' },
];

export const BY_KEY = Object.fromEntries(STATES.map((s) => [s.key, s]));

export const FLAG_COLOR = '#f43f5e';

// One colour per department, in a fixed order so a department keeps its colour from visit to visit.
export const DEPARTMENT_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#f97316', '#14b8a6', '#ef4444', '#84cc16'];

export function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}
