import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(root, 'data');
const stateFile = join(dataDir, 'service.json');
const logFile = join(dataDir, 'service.log');
const lockFile = join(dataDir, 'service.lock');
const url = 'http://127.0.0.1:4570';
const command = process.argv[2];

function state() {
  try { return JSON.parse(readFileSync(stateFile, 'utf8')); } catch { return null; }
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
    const socket = connect(4570, host);
    socket.setTimeout(700);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}
async function portOpen() {
  return (await Promise.all(['127.0.0.1', '::1'].map(listening))).some(Boolean);
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

async function run() {
  const token = process.argv[3];
  if (!token) throw new Error('missing service token');
  const { preview } = await import('vite');
  await preview({
    plugins: [{
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
          res.end(() => server.httpServer.close(() => process.exit(0)));
        });
      },
    }],
    preview: { host: '127.0.0.1', port: 4570, strictPort: true, open: false },
  });
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
    if (!running && await portOpen()) throw new Error('端口 4570 已被其他服务占用；不会覆盖或停止它');
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
    if (await portOpen()) throw new Error('构建期间端口 4570 被占用；未启动服务');
    const token = randomUUID();
    const output = openSync(logFile, 'a');
    let child;
    try {
      child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'run', token], {
        cwd: root, detached: true, windowsHide: true, stdio: ['ignore', output, output],
      });
    } finally { closeSync(output); }
    if (!child.pid) throw new Error('启动后台进程失败');
    child.unref();
    writeFileSync(stateFile, JSON.stringify({ pid: child.pid, token }, null, 2) + '\n', { mode: 0o600 });
    for (let i = 0; i < 50; i++) {
      if (await identity(token)) {
        console.log(`服务已在后台运行：${url} (PID ${child.pid})`);
        return;
      }
      if (await portOpen() && !await identity(token)) break;
      await pause(100);
    }
    throw new Error(`服务未能启动，请查看 ${logFile}`);
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
  else if (await portOpen()) console.log('端口 4570 被其他服务占用');
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
