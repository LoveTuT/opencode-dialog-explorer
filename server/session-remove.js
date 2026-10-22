// Permanently delete a session by delegating to OpenCode itself.
//
// OpenCode keeps its data as an event-sourced store (an append-only `event`
// log plus a projected `session`/`message`/`part` view). Deleting rows behind
// OpenCode's back would be undone the next time the projection is rebuilt, so
// the only safe "true delete" is to run OpenCode's own removal path, which also
// emits the `session.deleted` event and cascades child sessions.
//
// We therefore shell out to `opencode session delete <id>`. The id is validated
// against the session-id grammar before it ever reaches the process args.
import { execFile } from 'node:child_process';

const sessionId = /^ses_[A-Za-z0-9]+$/;

function defaultRun(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, {
      timeout: 60_000,
      windowsHide: true,
      // Windows resolves `opencode`/`opencode.cmd` through the shell; the id is
      // regex-validated first, so there is no injection surface.
      shell: process.platform === 'win32',
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || error.message || '');
        reject(new Error(/not found/i.test(detail) ? 'session not found' : `opencode delete failed: ${detail.trim() || error.message}`));
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

export async function removeSession(id, { run = defaultRun, bin = process.env.OCDE_OPENCODE_BIN || 'opencode' } = {}) {
  if (!sessionId.test(id || '')) throw new Error('invalid session id');
  await run(bin, ['session', 'delete', id]);
  return { id, deleted: true };
}
