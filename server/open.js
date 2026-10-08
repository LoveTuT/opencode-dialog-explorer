// Opens a filesystem path in the OS default app / file manager.
// Security notes:
//  - The path must exist and be a directory or a regular file (no symlinks to
//    devices, no executing arbitrary binaries — we hand the path to the OS
//    opener, which decides the default handler).
//  - The path is passed to execFile as an args array, never through a shell,
//    so there is no shell-injection surface.
//
// Platform handling:
//  - macOS:   `open`
//  - Windows: `explorer`
//  - Linux:   `xdg-open`
//  - WSL:     `xdg-open` is usually absent, so we hand a Windows-formatted path
//             (via `wslpath -w`) to `explorer.exe` so the folder opens in the
//             Windows Explorer alongside the distro.

import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';

function isWSL() {
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    return /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

// Translate a WSL/Linux path to a Windows path Explorer can open.
// Prefers `wslpath -w` (handles /mnt/c and distro mounts); falls back to
// well-known forms if wslpath is unavailable.
function toWindowsPath(target) {
  try {
    const out = execFileSync('wslpath', ['-w', target], { encoding: 'utf8' }).trim();
    if (out) return out;
  } catch {
    // fall through to manual conversion
  }
  const drive = target.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (drive) return `${drive[1].toUpperCase()}:\\${drive[2].replace(/\//g, '\\')}`;
  const distro = process.env.WSL_DISTRO_NAME || 'Ubuntu';
  return `\\\\wsl.localhost\\${distro}${target.replace(/\//g, '\\')}`;
}

// Returns { cmd, args } for the current platform's opener.
function opener(target) {
  switch (process.platform) {
    case 'darwin':
      return { cmd: 'open', args: [target] };
    case 'win32':
      // `explorer` opens files/folders with their default handler. It does not
      // need a shell. (Note: explorer exits non-zero even on success, which we
      // tolerate below.)
      return { cmd: 'explorer', args: [target] };
    default:
      // Linux / *BSD — but WSL Linux has no usable xdg-open, so route via
      // Windows Explorer with a converted path.
      if (isWSL()) return { cmd: 'explorer.exe', args: [toWindowsPath(target)] };
      return { cmd: 'xdg-open', args: [target] };
  }
}

export function openPath(target) {
  if (typeof target !== 'string' || target.trim() === '') {
    throw new Error('not found');
  }

  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    throw new Error('not found');
  }

  if (!fs.existsSync(target)) {
    throw new Error('not found');
  }

  // Only allow a directory or a regular file. Reject sockets, FIFOs, devices.
  if (!stat.isDirectory() && !stat.isFile()) {
    throw new Error('not found');
  }

  const { cmd, args } = opener(target);

  // Fire and forget: the opener launches the GUI app and we don't wait on it.
  // execFile (no shell) — the path is a literal argument, immune to injection.
  const child = execFile(cmd, args, (err) => {
    // explorer.exe returns a non-zero exit code even when it succeeds, so we
    // intentionally swallow its error. Other openers' errors are ignored too
    // because the process is detached from the request lifecycle by the time
    // this fires; the synchronous validation above is the real guard.
    void err;
  });
  child.on('error', () => {});

  return { ok: true, opened: target, via: cmd };
}
