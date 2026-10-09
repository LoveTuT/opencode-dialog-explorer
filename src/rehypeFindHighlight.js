// Rehype (unified) attacher that wraps occurrences of a search term in
// <mark class="find-hit"> during Markdown rendering, without mutating the DOM.
//
// It is an attacher: pass it to a unified/remark/rehype pipeline as
// `[rehypeFindHighlight, term]` (not `rehypeFindHighlight(term)`), because the
// processor calls the attacher itself with the term and expects a transformer.
export default function rehypeFindHighlight(options) {
  const term = String(options || '');
  return (tree) => {
    if (!term || !tree) return;
    const lower = term.toLocaleLowerCase();
    const visit = (node) => {
      if (!node || !Array.isArray(node.children)) return;
      const next = [];
      for (const child of node.children) {
        if (child.type === 'text' && String(child.value).toLocaleLowerCase().includes(lower)) {
          const text = String(child.value);
          const lt = text.toLocaleLowerCase();
          let from = 0;
          let idx;
          while ((idx = lt.indexOf(lower, from)) !== -1) {
            if (idx > from) next.push({ type: 'text', value: text.slice(from, idx) });
            next.push({ type: 'element', tagName: 'mark', properties: { className: ['find-hit'] }, children: [{ type: 'text', value: text.slice(idx, idx + term.length) }] });
            from = idx + term.length;
          }
          if (from < text.length) next.push({ type: 'text', value: text.slice(from) });
        } else {
          visit(child);
          next.push(child);
        }
      }
      node.children = next;
    };
    visit(tree);
  };
}
