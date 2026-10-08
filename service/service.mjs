import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(root, 'data');
const stateFile = join(dataDir, 'service.json');
const logFile = join(dataDir, 'service.log');
const lockFile = join(dataDir, 'service.lock');
const HOST = '127.0.0.1';
const PORT = 4570;
const url = `http://${HOST}:${PORT}`;
const command = process.argv[2];

function state() {
  try { return JSON.parse(readFileSync(stateFile, 'utf8')); } catch { return null; }
}

function logLine(text) {
  try { mkdirSync(dataDir, { recursive: true }); appendFileSync(logFile, `${text}\n`); } catch { /* ignore */ }
}

async function identity(token) {
  try {
    const response = await fetch(`${url}/api/service/identity`, {
      headers: { 'X-Service-Token': token }, signal: AbortSignal.timeout(900),
    });
    return response.status === 204;
  } catch { return false; }
}

async function listening(host) {
  return new Promise((resolve) => {
    const socket = connect(PORT, host);
    socket.setTimeout(700);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}
async function portOpen() {
  return (await Promise.all([HOST, '::1'].map(listening))).some(Boolean);
}

// Report who is holding the port right now: listening address, owning PID and
// process command line. Only runs on the error path, so the extra process
// spawns (netstat / tasklist / powershell) are acceptable.
function portConflictReport() {
  const entries = [];
  try {
    if (process.platform === 'win32') {
      const net = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true });
      const pids = new Set();
      for (const line of (net.stdout || '').split(/\r?\n/)) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 5 || cols[0].toUpperCase() !== 'TCP') continue;
        if (!cols[1].endsWith(`:${PORT}`)) continue;
        if (cols[3].toUpperCase() !== 'LISTENING') continue;
        if (cols[4] && cols[4] !== '0') pids.add(cols[4]);
      }
      for (const pid of pids) {
        const info = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
          `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { $p.Name + ' :: ' + $p.CommandLine }`],
          { encoding: 'utf8', windowsHide: true });
        const desc = (info.stdout || '').trim().split(/\r?\n/)[0] || '(无法读取进程信息)';
        entries.push(`  PID ${pid}  ${desc}`);
      }
    } else {
      const ss = spawnSync('sh', ['-c', `ss -ltnp 2>/dev/null | grep -E ':${PORT}[[:space:]]'`], { encoding: 'utf8' });
      let out = (ss.stdout || '').trim();
      if (!out) {
        const lsof = spawnSync('sh', ['-c', `lsof -nP -iTCP:${PORT} -sTCP:LISTEN 2>/dev/null`], { encoding: 'utf8' });
        out = (lsof.stdout || '').trim();
      }
      if (out) entries.push(...out.split(/\r?\n/).map((l) => `  ${l.trim()}`));
    }
  } catch { /* diagnostics must never throw */ }
  if (!entries.length) return '';
  return `端口 ${PORT} 当前监听进程：\n${entries.join('\n')}`;
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withLock(action) {
  mkdirSync(dataDir, { recursive: true });
  let fd;
  try { fd = openSync(lockFile, 'wx'); }
  catch { throw new Error('另一个服务操作正在执行；若上次异常退出，请检查 data/service.lock'); }
  closeSync(fd);
  return Promise.resolve().then(action).finally(() => unlinkSync(lockFile));
}

function previewPlugins(token) {
  return [{
    name: 'local-service-identity',
    configurePreviewServer(server) {
      server.middlewares.use('/api/service/identity', (req, res) => {
        res.statusCode = req.headers['x-service-token'] === token ? 204 : 404;
        res.end();
      });
      server.middlewares.use('/api/service/stop', (req, res) => {
        if (req.method !== 'POST' || req.headers['x-service-token'] !== token) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.statusCode = 204;
        res.end(() => {
          const http = server.httpServer;
          http.close(() => process.exit(0));
          // Browser keep-alive connections can make close() wait forever and
          // keep port 4570 held; drop idle connections and add a hard deadline.
          if (typeof http.closeAllConnections === 'function') setTimeout(() => http.closeAllConnections(), 300);
          setTimeout(() => process.exit(0), 2000);
        });
      });
    },
  }];
}

async function run() {
  const token = process.argv[3];
  const failFile = process.argv[4];
  if (!token) throw new Error('missing service token');
  const { preview } = await import('vite');

  // Retry briefly: a previous stop may still be releasing the socket, or the
  // port may be held transiently. Give it a few short attempts before failing.
  const ATTEMPTS = 5;
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      await preview({
        plugins: previewPlugins(token),
        preview: { host: HOST, port: PORT, strictPort: true, open: false },
      });
      return;
    } catch (error) {
      lastError = error;
      const bindError = error?.code === 'EADDRINUSE' || /already in use|EADDRINUSE/i.test(String(error?.message));
      if (!bindError || attempt === ATTEMPTS) break;
      logLine(`端口 ${PORT} 暂不可用（第 ${attempt}/${ATTEMPTS} 次尝试），700ms 后重试…`);
      await pause(700);
    }
  }

  const message = String(lastError?.message || lastError);
  const report = portConflictReport();
  const detail = report ? `${message}\n${report}` : message;
  if (failFile) { try { writeFileSync(failFile, detail + '\n'); } catch { /* ignore */ } }
  logLine(detail);
  process.exit(1);
}

async function stopOwned(saved) {
  const response = await fetch(`${url}/api/service/stop`, {
    method: 'POST', headers: { 'X-Service-Token': saved.token }, signal: AbortSignal.timeout(1500),
  });
  if (response.status !== 204) throw new Error('后台服务拒绝停止请求，未结束任何进程');
  for (let i = 0; i < 50; i++) {
    if (!await identity(saved.token) && !await portOpen()) {
      unlinkSync(stateFile);
      console.log('服务已停止');
      return;
    }
    await pause(100);
  }
  throw new Error('服务尚未停止，请检查后台进程；未清除运行记录');
}

async function start(restart = false) {
  return withLock(async () => {
    const saved = state();
    const running = saved && await identity(saved.token);
    if (running && !restart) {
      console.log(`服务已在运行：${url} (PID ${saved.pid})`);
      return;
    }
    if (!running && await portOpen()) {
      throw new Error([`端口 ${PORT} 已被其他服务占用；不会覆盖或停止它`, portConflictReport()].filter(Boolean).join('\n'));
    }
    if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('需要 Node.js 22 或更新版本');
    const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
    if (!existsSync(vite)) throw new Error('缺少依赖，请先在项目目录执行 npm install');
    console.log('正在构建预览版本…');
    const build = spawnSync(process.execPath, [vite, 'build'], { cwd: root, stdio: 'inherit' });
    if (build.error || build.status !== 0) throw new Error(`构建失败${build.error ? `：${build.error.message}` : ''}`);
    if (running) {
      console.log('正在重启已由本脚本启动的服务…');
      await stopOwned(saved);
    }
    if (await portOpen()) {
      throw new Error([`构建期间端口 ${PORT} 被占用；未启动服务`, portConflictReport()].filter(Boolean).join('\n'));
    }

    const token = randomUUID();
    const failFile = join(dataDir, `service.${token}.fail`);
    try { if (existsSync(failFile)) unlinkSync(failFile); } catch { /* ignore */ }

    const output = openSync(logFile, 'a');
    let child;
    try {
      child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'run', token, failFile], {
        cwd: root, detached: true, windowsHide: true, stdio: ['ignore', output, output],
      });
    } finally { closeSync(output); }
    if (!child.pid) throw new Error('启动后台进程失败');
    writeFileSync(stateFile, JSON.stringify({ pid: child.pid, token }, null, 2) + '\n', { mode: 0o600 });

    // Wait for the child to actually serve the identity endpoint (or to report
    // a bind failure). This uses the real listen result instead of a separate
    // port probe, so there is no probe-vs-bind race window.
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (await identity(token)) { ready = true; break; }
      if (child.exitCode !== null || child.signalCode !== null) break;
      if (existsSync(failFile)) break;
      await pause(100);
    }

    let failure = '';
    try {
      if (existsSync(failFile)) { failure = readFileSync(failFile, 'utf8').trim(); unlinkSync(failFile); }
    } catch { /* ignore */ }
    child.unref();

    if (ready) {
      console.log(`服务已在后台运行：${url} (PID ${child.pid})`);
      return;
    }

    try { unlinkSync(stateFile); } catch { /* ignore */ }
    const tail = existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split(/\r?\n/).slice(-6).join('\n') : '';
    throw new Error([
      `服务未能启动（PID ${child.pid} 已退出）`,
      failure || (tail ? `日志末尾：\n${tail}` : `请查看 ${logFile}`),
    ].join('\n'));
  });
}

async function stop() {
  return withLock(async () => {
    const saved = state();
    if (!saved || !await identity(saved.token)) {
      if (await portOpen()) throw new Error('端口 4570 上不是本脚本启动的服务，未停止任何进程');
      console.log('服务未运行');
      return;
    }
    await stopOwned(saved);
  });
}

async function status() {
  const saved = state();
  if (saved && await identity(saved.token)) console.log(`运行中：${url} (PID ${saved.pid})`);
  else if (await portOpen()) console.log([`端口 ${PORT} 被其他服务占用`, portConflictReport()].filter(Boolean).join('\n'));
  else console.log('服务未运行');
}

try {
  if (command === 'run') await run();
  else if (command === 'start') await start();
  else if (command === 'restart') await start(true);
  else if (command === 'stop') await stop();
  else if (command === 'status') await status();
  else throw new Error('用法：node service/service.mjs start|restart|stop|status');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
