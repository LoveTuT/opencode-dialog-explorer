// Move one id from index `from` to index `to`, returning a new array.
// Used by ↑ ↓ buttons; drag preview supplies its own ordered id array.
// Out-of-range or a no-op move returns the original array unchanged.
export const moveId = (ids, from, to) => {
  if (from < 0 || to < 0 || from >= ids.length || to >= ids.length || from === to) return ids;
  const next = ids.slice();
  const [id] = next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
};
