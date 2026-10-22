// Delete contract: id validation, not-found mapping, exact CLI invocation, and
// sidecar cleanup. Runs without ever deleting a real session (the runner is
// injected), so it is safe in `npm test`.
import assert from 'node:assert/strict';
import { removeSession } from '../server/session-remove.js';
import { removeMeta } from '../server/meta.js';

const noop = { run: async () => ({ stdout: '', stderr: '' }) };

await assert.rejects(removeSession('ses_../../etc', noop), /invalid session id/);
await assert.rejects(removeSession('', noop), /invalid session id/);
await assert.rejects(removeSession(undefined, noop), /invalid session id/);
await assert.rejects(removeSession('not-a-session', noop), /invalid session id/);

const notFound = await removeSession('ses_deadbeef0000000000000000', {
  run: async () => { throw new Error('session not found'); },
}).then(() => null, (e) => e);
assert(notFound && /session not found/.test(notFound.message), 'not-found should propagate');

const calls = [];
const ok = await removeSession('ses_deadbeef0000000000000000', {
  bin: 'my-opencode',
  run: async (bin, args) => { calls.push([bin, args]); return { stdout: 'deleted', stderr: '' }; },
});
assert.deepEqual(ok, { id: 'ses_deadbeef0000000000000000', deleted: true });
assert.deepEqual(calls, [['my-opencode', ['session', 'delete', 'ses_deadbeef0000000000000000']]]);

assert.throws(() => removeMeta('bogus', 'x'), /invalid metadata target/);
assert.throws(() => removeMeta('sessions', ''), /invalid metadata target/);
const removed = await removeMeta('sessions', 'ses_nonexistent0000000000000');
assert.deepEqual(removed, { kind: 'sessions', id: 'ses_nonexistent0000000000000', removed: true });

console.log('delete: validation, not-found mapping, CLI invocation, sidecar cleanup · PASS');
