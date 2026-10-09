// Unit test for the ↑ ↓ reorder helper (drag preview supplies the new array).
import assert from 'node:assert/strict';
import { moveId } from '../src/reorder.js';

const base = ['a', 'b', 'c', 'd'];

// Move down one (the ↓ button): swap with the next entry.
assert.deepEqual(moveId(base, 0, 1), ['b', 'a', 'c', 'd']);
// Move up one (the ↑ button).
assert.deepEqual(moveId(base, 3, 2), ['a', 'b', 'd', 'c']);
// Drag: move first to the end and last to the front.
assert.deepEqual(moveId(base, 0, 3), ['b', 'c', 'd', 'a']);
assert.deepEqual(moveId(base, 3, 0), ['d', 'a', 'b', 'c']);
// No-op / out-of-range moves keep the original array identity.
assert.equal(moveId(base, 1, 1), base);
assert.equal(moveId(base, -1, 0), base);
assert.equal(moveId(base, 0, 4), base);
assert.equal(moveId(base, 4, 0), base);
// Original array is never mutated.
const snapshot = [...base];
moveId(base, 0, 2);
assert.deepEqual(base, snapshot);

console.log('reorder: moveId handles buttons, arbitrary moves, no-ops · PASS');
