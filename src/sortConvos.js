// Pure sorting logic for the conversation list. No React, no side effects.
// Every exported sorter returns a NEW array and never mutates its input.

export const SORT_OPTIONS = [
  { value: 'recent', label: 'Most recent' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'messages', label: 'Most messages' },
  { value: 'title', label: 'Title A–Z' },
];

// Milliseconds for recency comparisons. Prefer lastActivity (ISO string),
// fall back to mtimeMs, then 0 so missing values sort last in desc order.
function activityMs(c) {
  if (c) {
    if (c.lastActivity) {
      const t = new Date(c.lastActivity).getTime();
      if (!Number.isNaN(t)) return t;
    }
    if (typeof c.mtimeMs === 'number' && !Number.isNaN(c.mtimeMs)) return c.mtimeMs;
  }
  return 0;
}

function messageCount(c) {
  const n = c && typeof c.messageCount === 'number' ? c.messageCount : 0;
  return Number.isNaN(n) ? 0 : n;
}

function titleKey(c) {
  return (c && c.title ? String(c.title) : '').toLowerCase();
}

// Case-insensitive locale compare with a numeric-aware, sensible default.
function cmpTitle(a, b) {
  return titleKey(a).localeCompare(titleKey(b), undefined, {
    sensitivity: 'base',
    numeric: true,
  });
}

const SORTERS = {
  recent: (a, b) => activityMs(b) - activityMs(a),
  oldest: (a, b) => activityMs(a) - activityMs(b),
  messages: (a, b) => messageCount(b) - messageCount(a),
  title: cmpTitle,
};

// Returns a NEW sorted array. Unknown sortKey falls back to `recent`.
export function sortConvos(list, sortKey) {
  if (!Array.isArray(list)) return [];
  const sorter = SORTERS[sortKey] || SORTERS.recent;
  return list.slice().sort(sorter);
}
