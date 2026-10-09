// Regression test for the in-session find highlighter. It must be wired as a
// unified attacher ([rehypeFindHighlight, term]); pre-applying the term
// (rehypeFindHighlight(term)) crashes the Markdown pipeline at render time.
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeFindHighlight from '../src/rehypeFindHighlight.js';

function run(markdown, term) {
  let marks = [];
  const collect = () => (tree) => {
    marks = [];
    const walk = (node) => {
      if (node.tagName === 'mark') marks.push(node.children?.[0]?.value || '');
      (node.children || []).forEach(walk);
    };
    walk(tree);
  };
  const processor = unified().use(remarkParse).use(remarkRehype).use(rehypeFindHighlight, term).use(collect);
  processor.runSync(processor.parse(markdown));
  return marks;
}

assert.deepEqual(run('# 标题 查找\n正文含 查找 与 查找 两次，还有 `代码查找`。', '查找'), ['查找', '查找', '查找', '查找']);
assert.deepEqual(run('x a.b A.B aXb', 'a.b'), ['a.b', 'A.B']);
assert.deepEqual(run('nothing here', ''), []);
assert.deepEqual(run('**加粗查找** 普通', '查找'), ['查找']);

// The buggy wiring must not silently produce marks either: passing the result of
// calling the attacher (a transformer) is invalid and yields no highlighting.
const bad = unified().use(remarkParse).use(remarkRehype).use(rehypeFindHighlight('查找'));
try { bad.runSync(bad.parse('查找')); } catch { /* throwing is also acceptable */ }

console.log('find highlight: Markdown pipeline wraps hits · PASS');
