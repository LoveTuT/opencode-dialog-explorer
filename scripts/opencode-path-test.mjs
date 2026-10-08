import assert from 'node:assert/strict';
import path from 'node:path';
import { opencodeDbPath } from '../server/opencode-path.js';

assert.equal(opencodeDbPath({ home: '/home/alice', dataHome: undefined, paths: path.posix }), '/home/alice/.local/share/opencode/opencode.db');
assert.equal(opencodeDbPath({ home: '/Users/alice', dataHome: undefined, paths: path.posix }), '/Users/alice/.local/share/opencode/opencode.db');
assert.equal(opencodeDbPath({ home: 'C:\\Users\\Alice', dataHome: undefined, paths: path.win32 }), 'C:\\Users\\Alice\\.local\\share\\opencode\\opencode.db');
assert.equal(opencodeDbPath({ home: '/home/alice', dataHome: '/mnt/data', paths: path.posix }), '/mnt/data/opencode/opencode.db');
assert.equal(opencodeDbPath({ home: 'C:\\Users\\Alice', dataHome: 'D:\\data', paths: path.win32 }), 'D:\\data\\opencode\\opencode.db');
assert.equal(opencodeDbPath({ home: '/home/alice', dataHome: 'relative/data', paths: path.posix }), '/home/alice/.local/share/opencode/opencode.db');
console.log('opencode data paths: Linux, macOS, Windows, XDG override · PASS');
