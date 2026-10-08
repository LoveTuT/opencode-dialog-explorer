import assert from 'node:assert/strict';
import { resumeCommand } from '../server/sources/_shared.js';

const id = 'ses_abc123';
assert.equal(resumeCommand('', id, 'darwin'), `opencode --session ${id}`);
assert.equal(resumeCommand('/Users/Ada/Work files', id, 'darwin'), `opencode '/Users/Ada/Work files' --session ${id}`);
assert.equal(resumeCommand("/Users/Ada/O'Brien/$notes", id, 'darwin'), `opencode '/Users/Ada/O'\\''Brien/$notes' --session ${id}`);
assert.equal(resumeCommand('/mnt/d/Work files', id, 'linux'), `opencode '/mnt/d/Work files' --session ${id}`);
assert.equal(resumeCommand("D:\\Ada's Work\\$notes", id, 'win32'), `opencode 'D:\\Ada''s Work\\$notes' --session ${id}`);
console.log('resume commands: PASS');
