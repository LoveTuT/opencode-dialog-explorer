import os from 'node:os';
import path from 'node:path';

// OpenCode uses xdg-basedir for data on every platform (including Windows).
export function opencodeDbPath({ home = os.homedir(), dataHome = process.env.XDG_DATA_HOME, paths = path } = {}) {
  const base = dataHome && paths.isAbsolute(dataHome) ? dataHome : paths.join(home, '.local', 'share');
  return paths.join(base, 'opencode', 'opencode.db');
}
